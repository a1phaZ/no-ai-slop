// Сборка обучающего набора: балансировка классов и групповые сплиты.
// Группа = автор / near-dup кластер / текст — целиком попадает в один сплит,
// иначе тест утекает через почти-дубликаты.
//
//   node training/build-dataset.mjs
//   node training/build-dataset.mjs --input=data/raw/all.jsonl,data/raw/user.jsonl
//   node training/build-dataset.mjs --user-max=500 --user-weight=2
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  DATA_DIR,
  RAW_DIR,
  detectLang,
  mulberry32,
  number,
  parseArgs,
  printDist,
  readJsonl,
  shuffle,
  textHash,
  writeJsonl,
} from './lib/util.mjs';

const args = parseArgs();
const defaultInputs = [resolve(RAW_DIR, 'all.jsonl'), resolve(RAW_DIR, 'user.jsonl')].filter(
  (path) => existsSync(path),
);
const inputs = args.input
  ? String(args.input)
      .split(',')
      .map((path) => resolve(path.trim()))
  : defaultInputs.length > 0
    ? defaultInputs
    : [resolve(RAW_DIR, 'all.jsonl')];
const output = resolve(String(args.out ?? resolve(DATA_DIR, 'dataset.jsonl')));
const maxPerClass = number(args['max-per-class'], 1500);
const userMax = number(args['user-max'], 500);
const userWeightArg = args['user-weight'] === undefined ? null : number(args['user-weight'], 1);
const userWeight = userWeightArg ?? 1;
const seed = number(args.seed, 20261019);
const minLen = number(args['min-len'], 40);
const maxLen = number(args['max-len'], 6000);

const raw = inputs.flatMap((path) => {
  const rows = readJsonl(path);
  console.log(`  ${path}: ${rows.length}`);
  return rows;
});
if (raw.length === 0) {
  console.error('нет данных: сначала запустите fetch-human / import-public / generate-ai / import-labels.');
  process.exit(1);
}

// Дедуп по хэшу текста. Пользовательская метка важнее автоматической.
const byHash = new Map();
for (const row of raw) {
  const computed = textHash(row.title, row.text);
  const existing = byHash.get(computed);
  if (!existing || (row.source === 'user' && existing.source !== 'user')) {
    byHash.set(computed, row);
  }
}

function hasBody(text) {
  const withoutUrls = String(text ?? '')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .trim();
  return withoutUrls.length >= minLen;
}

const clean = [];
for (const row of byHash.values()) {
  const text = String(row.text ?? '').trim();
  if (text.length < minLen || text.length > maxLen) continue;
  if (!hasBody(text)) continue;
  if (row.label !== 0 && row.label !== 1) continue;
  const isUser = row.source === 'user';
  clean.push({
    title: String(row.title ?? '').trim(),
    text,
    label: row.label,
    lang: row.lang ?? detectLang(`${row.title ?? ''}\n${text}`),
    source: row.source ?? 'unknown',
    generator: row.generator ?? null,
    prompt_id: row.prompt_id ?? null,
    subreddit: row.subreddit ?? null,
    created_utc: row.created_utc ?? null,
    author_hash: row.author_hash ?? null,
    near_dup: row.near_dup ?? null,
    hash: row.hash ?? textHash(row.title, row.text),
    sample_weight: isUser
      ? (userWeightArg ??
        (Number.isFinite(Number(row.sample_weight)) && Number(row.sample_weight) > 0
          ? Number(row.sample_weight)
          : userWeight))
      : 1,
  });
}

if (clean.length === 0) {
  console.error('после фильтрации не осталось строк');
  process.exit(1);
}

// Ограничиваем вклад пользовательских меток, чтобы они не вытеснили корпус.
const userRows = clean.filter((row) => row.source === 'user');
if (userRows.length > userMax) {
  const keep = new Set(shuffle(userRows, mulberry32(seed ^ 0x51ed270b)).slice(0, userMax));
  for (let i = clean.length - 1; i >= 0; i--) {
    if (clean[i].source === 'user' && !keep.has(clean[i])) clean.splice(i, 1);
  }
  console.log(`  user: ограничено ${userMax} строками (было ${userRows.length})`);
}

// Балансировка отдельно по языкам: длинный английский корпус не должен
// вытеснить русский, и наоборот.
const balanced = [];
for (const lang of [...new Set(clean.map((r) => r.lang))]) {
  const subset = clean.filter((r) => r.lang === lang);
  const ai = subset.filter((r) => r.label === 1);
  const human = subset.filter((r) => r.label === 0);
  const target = Math.min(maxPerClass, ai.length, human.length, Math.ceil(subset.length / 2));
  if (target === 0) {
    console.warn(`  ${lang}: пропуск — нет одного из классов (ai=${ai.length}, human=${human.length})`);
    continue;
  }
  const rand = mulberry32(seed);
  balanced.push(...shuffle(ai, rand).slice(0, target), ...shuffle(human, rand).slice(0, target));
  console.log(`  ${lang}: по ${target} на класс`);
}

if (balanced.length === 0) {
  console.error('не удалось сбалансировать: нужны оба класса хотя бы в одном языке');
  process.exit(1);
}

// Групповые сплиты.
function groupKey(row) {
  // prompt_id держит вместе вопрос HC3 и ответы на него.
  return row.prompt_id ?? row.author_hash ?? row.near_dup ?? row.hash ?? textHash(row.title, row.text);
}

const groups = new Map();
for (const row of balanced) {
  const key = groupKey(row);
  const list = groups.get(key);
  if (list) list.push(row);
  else groups.set(key, [row]);
}

const rand = mulberry32(seed ^ 0x9e3779b9);
const shuffledGroups = shuffle([...groups.values()], rand);

const totals = { train: 0, val: 0, test: 0 };
for (const row of balanced) row.split = null;

const targets = {
  train: balanced.length * 0.7,
  val: balanced.length * 0.15,
  test: balanced.length * 0.15,
};

for (const rows of shuffledGroups) {
  // Кладём группу в сплит, который сильнее всего отстаёт от цели.
  let best = 'train';
  let bestDeficit = -Infinity;
  for (const split of ['train', 'val', 'test']) {
    const deficit = targets[split] - totals[split];
    if (deficit > bestDeficit) {
      bestDeficit = deficit;
      best = split;
    }
  }
  for (const row of rows) row.split = best;
  totals[best] += rows.length;
}

const dataset = balanced.map((row) => ({ ...row }));
writeJsonl(output, dataset);

printDist('dataset.jsonl', dataset);
console.log('сплиты:', totals);
for (const split of ['train', 'val', 'test']) {
  const rows = dataset.filter((r) => r.split === split);
  const ai = rows.filter((r) => r.label === 1).length;
  const langs = rows.reduce((acc, r) => {
    acc[r.lang] = (acc[r.lang] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`  ${split}: ${rows.length} (ai=${ai}, human=${rows.length - ai}) lang=${JSON.stringify(langs)}`);
}
console.log(`файл: ${output}`);
