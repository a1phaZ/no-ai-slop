// Генерация AI-постов локально через Ollama. Сеть не нужна.
//
//   ollama pull qwen2.5:3b
//   node training/generate-ai.mjs --model=qwen2.5:3b --count=200 --lang=ru,en
//
// Пишет data/raw/ai.jsonl. Метка 1, генератор и prompt_id сохраняются,
// чтобы потом можно было считать метрики по срезам и не смешивать модели.
import { appendJsonl, detectLang, normalize, number, parseArgs, RAW_DIR, readJsonl, sleep, textHash, printDist, ensureDir } from './lib/util.mjs';
import { resolve } from 'node:path';

const args = parseArgs();
const model = String(args.model ?? 'qwen2.5:3b');
const total = number(args.count, 100);
const langs = String(args.lang ?? 'ru,en').split(',').map((s) => s.trim()).filter(Boolean);
const ollama = String(args.ollama ?? 'http://127.0.0.1:11434');
const out = resolve(RAW_DIR, 'ai.jsonl');
const delay = number(args.delay, 200);
const humanizeRatio = number(args.humanize, 0.25);
const seedBase = number(args.seed, 42);

ensureDir(RAW_DIR);

const TOPICS = {
  en: [
    'a bug that took hours to find',
    'which laptop is worth buying for programming',
    'why code works in debug but fails in release',
    'opinions on a popular framework',
    'how to deal with a difficult coworker',
    'is it worth learning a new language right now',
    'a small win at work this week',
    'why the build is so slow',
    'moving to a new city for a job',
    'a movie everyone loves but you did not',
    'how to stop procrastinating',
    'a purchase you regret',
  ],
  ru: [
    'какой ноутбук выбрать для программирования',
    'почему код работает в дебаге, но падает в релизе',
    'стоит ли учить новый язык прямо сейчас',
    'как справиться с токсичным коллегой',
    'баг, который искал полдня',
    'мнение о популярном фреймворке',
    'переезд в другой город ради работы',
    'фильм, который все хвалят, а вам не зашёл',
    'как перестать откладывать дела',
    'покупка, о которой жалеете',
    'маленькая победа на работе',
    'почему сборка такая медленная',
  ],
};

const LENGTHS = [
  { id: 'short', instruction: 'Короткий пост: 2-4 предложения.' },
  { id: 'medium', instruction: 'Средний пост: 6-10 предложений, один абзац.' },
  { id: 'long', instruction: 'Длинный пост: 3-5 абзацев, с деталями и выводами.' },
];

const REGISTERS = [
  { id: 'casual', instruction: 'Пиши разговорно, как обычный пользователь Reddit.' },
  { id: 'neutral', instruction: 'Пиши нейтрально и по делу.' },
];

function buildPrompt(lang, topic, length, register, humanize) {
  const langName = lang === 'ru' ? 'русском' : 'английском';
  const base = [
    `Напиши пост для Reddit на ${langName} языке.`,
    `Тема: ${topic}.`,
    length.instruction,
    register.instruction,
    'Формат ответа строго такой:',
    'TITLE: <заголовок>',
    'BODY:',
    '<текст поста>',
    'Никаких пояснений до или после.',
  ];
  if (humanize) {
    base.push(
      'Сделай текст похожим на живой пост обычного человека: добавь лёгкие разговорные обороты,',
      'сокращения и одну-две неидеальности. Не упоминай, что это написано ИИ.',
    );
  }
  return base.join('\n');
}

function parsePost(raw) {
  const text = normalize(raw);
  const titleMatch = text.match(/TITLE\s*:\s*(.+?)(?:\s*BODY\s*:|$)/i);
  const bodyMatch = text.match(/BODY\s*:\s*([\s\S]+)/i);
  const title = normalize(titleMatch?.[1] ?? '');
  const body = normalize(bodyMatch?.[1] ?? text);
  if (!body) return null;
  if (body.length < 60 || body.length > 4000) return null;
  if (!title) return { title: body.split(/(?<=[.!?])\s/)[0].slice(0, 90), body };
  return { title: title.slice(0, 140), body };
}

async function generate(prompt, seed) {
  const response = await fetch(`${ollama}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      options: { temperature: 0.9, top_p: 0.95, seed, num_predict: 600 },
    }),
    signal: AbortSignal.timeout(300_000),
  });
  if (!response.ok) throw new Error(`ollama ${response.status}: ${await response.text()}`);
  const json = await response.json();
  return String(json.response ?? '');
}

const existing = readJsonl(out);
const seen = new Set(existing.map((row) => textHash(row.title ?? '', row.text ?? '')));
let written = 0;
let attempts = 0;
const maxAttempts = total * 4;

while (written < total && attempts < maxAttempts) {
  const lang = langs[attempts % langs.length];
  const topics = TOPICS[lang] ?? TOPICS.en;
  const topic = topics[Math.floor(attempts / langs.length) % topics.length];
  const length = LENGTHS[attempts % LENGTHS.length];
  const register = REGISTERS[Math.floor(attempts / 3) % REGISTERS.length];
  const humanize = (attempts / 7) % 1 < humanizeRatio;
  const promptId = `${lang}_${length.id}_${register.id}${humanize ? '_humanized' : ''}`;

  attempts += 1;
  try {
    const raw = await generate(buildPrompt(lang, topic, length, register, humanize), seedBase + attempts);
    const parsed = parsePost(raw);
    if (!parsed) {
      console.warn(`  ${promptId}: пустой/некорректный ответ, пропуск`);
      continue;
    }
    const hash = textHash(parsed.title, parsed.body);
    if (seen.has(hash)) continue;
    seen.add(hash);

    appendJsonl(out, [
      {
        title: parsed.title,
        text: parsed.body,
        label: 1,
        lang: detectLang(`${parsed.title}\n${parsed.body}`),
        source: 'ollama',
        generator: model,
        prompt_id: promptId,
        subreddit: null,
        created_utc: null,
        author_hash: null,
      },
    ]);
    written += 1;
    if (written % 10 === 0) console.log(`  ${written}/${total} (${model})`);
  } catch (err) {
    console.warn(`  ошибка генерации: ${err.message}`);
    await sleep(2000);
  }

  await sleep(delay);
}

printDist('ai.jsonl', readJsonl(out));
console.log(`добавлено: ${written}, попыток: ${attempts}, файл: ${out}`);
