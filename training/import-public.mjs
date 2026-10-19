// Публичные датасеты без ключей и регистрации.
//
// HC3 (reddit_eli5): реальные вопросы Reddit + ответы ChatGPT.
//   node training/import-public.mjs --hc3 --max=1500
//
// Ручной импорт скачанного датасета (RuATD, SemEval M4 и т.п.):
//   node training/import-public.mjs --file=data/raw/ruatd.jsonl --label=1 --source=ruatd
import { appendJsonl, detectLang, ensureDir, normalize, number, parseArgs, RAW_DIR, readJsonl, sleep, textHash, printDist } from './lib/util.mjs';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const args = parseArgs();
const out = resolve(RAW_DIR, 'public.jsonl');
ensureDir(RAW_DIR);

const existing = readJsonl(out);
const seen = new Set(existing.map((row) => textHash(row.title ?? '', row.text ?? '')));

function add(rows) {
  const fresh = [];
  for (const row of rows) {
    const hash = textHash(row.title ?? '', row.text ?? '');
    if (seen.has(hash)) continue;
    seen.add(hash);
    fresh.push(row);
  }
  appendJsonl(out, fresh);
  return fresh.length;
}

async function hc3() {
  const config = String(args.config ?? 'reddit_eli5');
  const max = number(args.max, 1500);
  const includeAnswers = !args['no-answers'];
  const pageSize = 100;
  const base = 'https://datasets-server.huggingface.co/rows';
  let offset = 0;
  let added = 0;

  while (added < max) {
    const url = new URL(base);
    url.searchParams.set('dataset', 'Hello-SimpleAI/HC3');
    url.searchParams.set('config', config);
    url.searchParams.set('split', 'train');
    url.searchParams.set('offset', String(offset));
    url.searchParams.set('length', String(pageSize));

    let rows;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const json = await response.json();
      rows = json.rows ?? [];
      if (rows.length === 0) break;
    } catch (err) {
      console.warn(`  HC3 offset=${offset}: ${err.message}`);
      break;
    }

    const batch = [];
    for (const item of rows) {
      const row = item.row ?? {};
      const question = normalize(row.question ?? '');
      if (question.length >= 40) {
        batch.push({
          title: question.slice(0, 120),
          text: question,
          label: 0,
          lang: detectLang(question),
          source: 'hc3_human',
          generator: null,
          prompt_id: null,
          subreddit: null,
          created_utc: null,
          author_hash: null,
        });
      }

      if (includeAnswers) {
        for (const answer of row.human_answers ?? []) {
          const text = normalize(answer);
          if (text.length >= 80) {
            batch.push({
              title: '',
              text,
              label: 0,
              lang: detectLang(text),
              source: 'hc3_human_answer',
              generator: null,
              prompt_id: null,
              subreddit: null,
              created_utc: null,
              author_hash: null,
            });
          }
        }
      }

      for (const answer of row.chatgpt_answers ?? []) {
        const text = normalize(answer);
        if (text.length >= 80) {
          batch.push({
            title: '',
            text,
            label: 1,
            lang: detectLang(text),
            source: 'hc3_chatgpt',
            generator: 'chatgpt',
            prompt_id: null,
            subreddit: null,
            created_utc: null,
            author_hash: null,
          });
        }
      }
    }

    added += add(batch);
    offset += pageSize;
    console.log(`  HC3: offset=${offset}, добавлено=${added}`);
    if (rows.length < pageSize) break;
    await sleep(500);
  }
  return added;
}

function fromFile() {
  const path = resolve(String(args.file));
  const label = number(args.label, 1);
  const source = String(args.source ?? 'public');
  const textField = String(args['text-field'] ?? 'text');
  const titleField = String(args['title-field'] ?? 'title');
  const raw = readFileSync(path, 'utf8');

  let items;
  try {
    items = JSON.parse(raw);
  } catch {
    items = raw
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line));
  }
  if (!Array.isArray(items)) throw new Error('ожидался массив или JSONL');

  const rows = [];
  for (const item of items) {
    const text = normalize(item[textField] ?? '');
    if (text.length < 40) continue;
    rows.push({
      title: normalize(item[titleField] ?? ''),
      text,
      label: item.label === 0 || item.label === 1 ? item.label : label,
      lang: detectLang(text),
      source,
      generator: item.generator ?? null,
      prompt_id: item.prompt_id ?? null,
      subreddit: item.subreddit ?? null,
      created_utc: item.created_utc ?? null,
      author_hash: null,
    });
  }
  return add(rows);
}

let added = 0;
if (args.hc3) added = await hc3();
if (args.file) added += fromFile();

if (!args.hc3 && !args.file) {
  console.log('укажите --hc3 и/или --file=<path>');
  process.exitCode = 1;
} else {
  printDist('public.jsonl', readJsonl(out));
  console.log(`добавлено: ${added}, файл: ${out}`);
}
