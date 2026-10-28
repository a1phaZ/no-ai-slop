// Импорт пользовательских меток (экспорт из настроек расширения).
//
//   node training/import-labels.mjs --file=~/Downloads/no-ai-slop-labels.jsonl
//   node training/import-labels.mjs --file=... --mode=train
//
// eval (по умолчанию) — честная проверка на «настоящей жизни», в обучение не идёт.
// train — только после порога ~200 меток; строки попадут в data/raw/user.jsonl,
// сплиты назначит build-dataset.mjs (группа = хэш текста).
import { resolve } from 'node:path';

import {
  EVAL_DIR,
  RAW_DIR,
  detectLang,
  number,
  parseArgs,
  printDist,
  readJsonl,
  textHash,
  writeJsonl,
} from './lib/util.mjs';

const args = parseArgs();
if (!args.file) {
  console.error('укажите --file=<экспорт меток.jsonl>');
  process.exit(1);
}

const mode = String(args.mode ?? 'eval');
if (mode !== 'eval' && mode !== 'train') {
  console.error('--mode должен быть eval или train');
  process.exit(1);
}

const input = resolve(String(args.file));
const minLen = number(args['min-len'], 40);
const maxRows = number(args['max'], 2000);
const userWeight = number(args['user-weight'], 1);
const force = Boolean(args.force);

const labels = readJsonl(input);
if (labels.length === 0) {
  console.error('файл пуст или не содержит JSONL');
  process.exit(1);
}

const rows = [];
const seen = new Set();
let skipped = 0;
for (const label of labels) {
  const text = String(label.text ?? '').trim();
  const title = String(label.title ?? '').trim();
  if (!text || (label.label !== 'ai' && label.label !== 'human')) {
    skipped += 1;
    continue;
  }
  if (text.length < minLen) {
    skipped += 1;
    continue;
  }

  const hash = label.hash ?? textHash(title, text);
  if (seen.has(hash)) {
    skipped += 1;
    continue;
  }
  seen.add(hash);

  rows.push({
    title,
    text,
    label: label.label === 'ai' ? 1 : 0,
    lang: label.lang ?? detectLang(`${title}\n${text}`),
    source: 'user',
    generator: null,
    prompt_id: null,
    subreddit: null,
    created_utc: typeof label.createdAt === 'number' ? Math.round(label.createdAt / 1000) : null,
    author_hash: null,
    near_dup: null,
    hash,
    split: mode === 'train' ? null : 'eval_user',
    /** Оценка детектора в момент разметки — для анализа ошибок. */
    detectorScore: typeof label.score === 'number' ? label.score : null,
    detectorVersion: label.detectorVersion ?? null,
    modelVersion: label.modelVersion ?? null,
    modelId: label.modelId ?? null,
    sample_weight: mode === 'train' ? userWeight : null,
  });

  if (rows.length >= maxRows) break;
}

if (rows.length === 0) {
  console.error('после фильтрации не осталось корректных меток');
  process.exit(1);
}

const MIN_TRAIN = 200;
if (mode === 'train' && rows.length < MIN_TRAIN && !force) {
  const out = resolve(String(args.out ?? resolve(EVAL_DIR, 'user.jsonl')));
  writeJsonl(out, rows);
  printDist('user.jsonl (eval-only)', rows);
  console.warn(
    `меток ${rows.length} < ${MIN_TRAIN}: пока только eval. Для обучения нужен --force или больше меток.`,
  );
  console.log(`файл: ${out}`);
  process.exit(0);
}

const out = resolve(
  String(
    args.out ??
      (mode === 'train' ? resolve(RAW_DIR, 'user.jsonl') : resolve(EVAL_DIR, 'user.jsonl')),
  ),
);
writeJsonl(out, rows);
printDist(mode === 'train' ? 'user.jsonl (train)' : 'user.jsonl (eval)', rows);
if (skipped > 0) console.log(`пропущено некорректных/дублирующихся записей: ${skipped}`);
if (mode === 'train') {
  console.log('Дальше: node training/build-dataset.mjs (подхватит data/raw/user.jsonl).');
} else {
  console.log('Этот срез используется только для оценки, пока меток мало.');
}
console.log(`файл: ${out}`);
