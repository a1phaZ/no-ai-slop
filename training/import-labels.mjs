// Импорт пользовательских меток (экспорт из настроек расширения) в eval-срез.
// Метки людей — «настоящая жизнь»: сначала только оценка, в train не подмешиваем.
//
//   node training/import-labels.mjs --file=~/Downloads/no-ai-slop-labels-20261019.jsonl
import { resolve } from 'node:path';

import { DATA_DIR, EVAL_DIR, detectLang, parseArgs, printDist, readJsonl, textHash, writeJsonl } from './lib/util.mjs';

const args = parseArgs();
if (!args.file) {
  console.error('укажите --file=<экспорт меток.jsonl>');
  process.exit(1);
}

const input = resolve(String(args.file));
const out = resolve(String(args.out ?? resolve(EVAL_DIR, 'user.jsonl')));

const labels = readJsonl(input);
if (labels.length === 0) {
  console.error('файл пуст или не содержит JSONL');
  process.exit(1);
}

const rows = [];
let skipped = 0;
for (const label of labels) {
  const text = String(label.text ?? '').trim();
  const title = String(label.title ?? '').trim();
  if (!text || (label.label !== 'ai' && label.label !== 'human')) {
    skipped += 1;
    continue;
  }
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
    split: 'eval_user',
    /** Оценка детектора в момент разметки — для анализа ошибок. */
    detectorScore: typeof label.score === 'number' ? label.score : null,
    detectorVersion: label.detectorVersion ?? null,
    modelVersion: label.modelVersion ?? null,
    hash: label.hash ?? textHash(title, text),
  });
}

writeJsonl(out, rows);
printDist('user.jsonl', rows);
if (skipped > 0) console.log(`пропущено некорректных записей: ${skipped}`);
console.log(`файл: ${out}`);
console.log('Этот срез используется только для оценки, пока меток мало.');
