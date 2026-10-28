// Сбор реальных человеческих постов Reddit до эпохи ChatGPT (до 11.2022).
// Источник: arctic-shift (публичное зеркало Pushshift), без ключей и регистрации.
//
//   node training/fetch-human.mjs --subreddits=rust,AskReddit --max-per-sub=200
//   node training/fetch-human.mjs --window-minutes=60 --max-windows=48 --delay=1000
//   node training/fetch-human.mjs --limit=3 --delay=5000  # для «тяжёлых» сабреддитов
//
// Ограничения зеркала: rate-limit и медленные запросы на больших диапазонах,
// поэтому идём небольшими окнами (по умолчанию 1 час) с паузами и ретраями.
import { appendJsonl, authorHash, detectLang, ensureDir, normalize, number, parseArgs, RAW_DIR, readJsonl, sleep, textHash, printDist } from './lib/util.mjs';
import { resolve } from 'node:path';

const API = 'https://arctic-shift.photon-reddit.com/api/posts/search';

const args = parseArgs();
const subreddits = String(
  args.subreddits ??
    'rust,programming,AskReddit,AmITheAsshole,relationship_advice,personalfinance,technology,NoStupidQuestions',
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const after = String(args.after ?? '2021-01-01T00:00:00Z');
const before = String(args.before ?? '2022-11-01T00:00:00Z');
const maxPerSub = number(args['max-per-sub'], 500);
const minLen = number(args['min-len'], 80);
const pageLimit = Math.min(100, Math.max(1, number(args.limit, 100)));
const delay = number(args.delay, 4000);
const windowMinutes = Math.max(1, number(args['window-minutes'], 60));
const maxWindows = number(args['max-windows'], 0);
const out = resolve(String(args.out ?? resolve(RAW_DIR, 'human.jsonl')));
const allowNsfw = Boolean(args['allow-nsfw']);
const startedAt = Date.now();

ensureDir(RAW_DIR);

const WINDOW_MS = windowMinutes * 60 * 1000;

function timeWindows(fromIso, toIso) {
  const windows = [];
  let cursor = Date.parse(fromIso);
  const end = Date.parse(toIso);
  while (cursor < end) {
    const next = Math.min(cursor + WINDOW_MS, end);
    windows.push([new Date(cursor).toISOString(), new Date(next).toISOString()]);
    cursor = next;
  }
  return windows;
}

async function fetchPage(params, attempt = 0) {
  const url = new URL(API);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(90_000) });
    const json = await response.json();
    if (json?.error) throw new Error(json.error);
    if (!Array.isArray(json?.data)) throw new Error('неожиданный ответ');
    return json.data;
  } catch (err) {
    if (attempt >= 5) throw err;
    const wait = Math.min(delay * 2 ** attempt, 120_000);
    console.warn(`  ретрай ${attempt + 1}/5 через ${Math.round(wait / 1000)}с: ${err.message}`);
    await sleep(wait);
    return fetchPage(params, attempt + 1);
  }
}

/** Убирает URL/картинки: link-посты не должны попадать в текстовый датасет. */
function stripUrls(text) {
  return normalize(
    String(text ?? '')
      .replace(/https?:\/\/\S+/gi, ' ')
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, ' $1 ')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, ' $1 '),
  );
}

function isUsable(post) {
  if (!post || typeof post.selftext !== 'string') return false;
  if (post.stickied || post.archived) return false;
  if (post.over_18 && !allowNsfw) return false;
  const author = post.author ?? '';
  if (!author || author === '[deleted]' || author === 'AutoModerator') return false;
  const body = stripUrls(post.selftext);
  const title = normalize(post.title);
  if (body.length < minLen) return false;
  if (title.length < 5) return false;
  if (/\b(i am a bot|this action was performed automatically)\b/i.test(body)) return false;
  if (body === '[removed]' || body === '[deleted]') return false;
  return true;
}

function toRow(post) {
  const title = normalize(post.title);
  const text = stripUrls(post.selftext);
  return {
    title,
    text,
    label: 0,
    lang: detectLang(`${title}\n${text}`),
    source: 'reddit',
    generator: null,
    prompt_id: null,
    subreddit: post.subreddit ?? null,
    created_utc: post.created_utc ?? null,
    author_hash: authorHash(post.author),
  };
}

const existing = readJsonl(out);
const seen = new Set(existing.map((row) => textHash(row.title ?? '', row.text ?? '')));
let written = existing.length;

for (const subreddit of subreddits) {
  let total = 0;
  const windows = timeWindows(after, before);

  let windowCount = 0;
  for (const [from, to] of windows) {
    if (total >= maxPerSub) break;
    if (maxWindows > 0 && windowCount >= maxWindows) break;
    windowCount += 1;

    let posts;
    try {
      posts = await fetchPage({ subreddit, after: from, before: to, limit: pageLimit, sort: 'asc' });
    } catch (err) {
      console.warn(`  ${subreddit} ${from.slice(0, 10)}: пропуск (${err.message})`);
      continue;
    }

    const rows = [];
    for (const post of posts) {
      if (total + rows.length >= maxPerSub) break;
      if (!isUsable(post)) continue;
      const row = toRow(post);
      const hash = textHash(row.title, row.text);
      if (seen.has(hash)) continue;
      seen.add(hash);
      rows.push(row);
    }

    if (rows.length > 0) {
      appendJsonl(out, rows);
      written += rows.length;
      total += rows.length;
      console.log(`  ${subreddit} ${from.slice(0, 10)}: +${rows.length} (всего по сабреддиту: ${total})`);
    }

    await sleep(delay);
  }
}

const all = readJsonl(out);
printDist(out.split(/[\\/]/).pop() ?? 'human.jsonl', all);
const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
console.log(
  `добавлено: ${written - existing.length}, всего: ${all.length}, окно: ${windowMinutes} мин, время: ${elapsed}с, файл: ${out}`,
);
