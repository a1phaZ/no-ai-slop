// Публичные датасеты без ключей и регистрации.
//
// HC3 (reddit_eli5): реальные вопросы Reddit + ответы ChatGPT.
//   node training/import-public.mjs --hc3 --max=1500
//
// CoAT / RuATD (русский, human vs machine):
//   node training/import-public.mjs --coat --coat-split=train --max=2000
//   node training/import-public.mjs --coat --coat-split=validation --out=data/eval/coat-val.jsonl
//
// SemEval-2024 Task 8 (multilingual, human vs machine):
//   node training/import-public.mjs --semeval --semeval-split=train --max=2000
//
// Ручной импорт скачанного датасета (M4 и т.п.):
//   node training/import-public.mjs --file=data/raw/m4.jsonl --label=1 --source=m4
import { appendJsonl, detectLang, ensureDir, normalize, number, parseArgs, RAW_DIR, readJsonl, sleep, textHash, printDist } from './lib/util.mjs';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const args = parseArgs();
const out = resolve(String(args.out ?? resolve(RAW_DIR, 'public.jsonl')));
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

/** HF datasets-server часто отвечает 429; повторяем с экспоненциальной паузой. */
async function fetchRows(dataset, config, split, offset, pageSize) {
  const url = new URL('https://datasets-server.huggingface.co/rows');
  url.searchParams.set('dataset', dataset);
  url.searchParams.set('config', config);
  url.searchParams.set('split', split);
  url.searchParams.set('offset', String(offset));
  url.searchParams.set('length', String(pageSize));

  let lastError;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}`);
        error.status = response.status;
        throw error;
      }
      const json = await response.json();
      return json.rows ?? [];
    } catch (err) {
      lastError = err;
      if (err.status && err.status !== 429 && err.status < 500) throw err;
      const wait = Math.min(2000 * 2 ** attempt, 30_000);
      console.warn(`  ${dataset} offset=${offset}: ${err.message}, повтор через ${Math.round(wait / 1000)}с`);
      await sleep(wait);
    }
  }
  throw lastError;
}

async function hc3() {
  const config = String(args.config ?? 'reddit_eli5');
  const max = number(args.max, 1500);
  const includeAnswers = !args['no-answers'];
  const pageSize = 100;
  let offset = number(args['hc3-offset'] ?? args.offset, 0);
  let added = 0;

  while (added < max) {
    let rows;
    try {
      rows = await fetchRows('Hello-SimpleAI/HC3', config, 'train', offset, pageSize);
      if (rows.length === 0) break;
    } catch (err) {
      console.warn(`  HC3 offset=${offset}: ${err.message}`);
      break;
    }

    const batch = [];
    for (const item of rows) {
      const row = item.row ?? {};
      const question = normalize(row.question ?? '');
      const promptId = question ? textHash(question) : null;
      if (question.length >= 40) {
        batch.push({
          title: question.slice(0, 120),
          text: question,
          label: 0,
          lang: detectLang(question),
          source: 'hc3_human',
          generator: null,
          prompt_id: promptId,
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
              prompt_id: promptId,
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
            prompt_id: promptId,
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

async function coat() {
  const config = String(args['coat-config'] ?? 'binary');
  const split = String(args['coat-split'] ?? 'train');
  const max = number(args.max, 2000);
  const pageSize = 100;
  let offset = number(args['coat-offset'] ?? args.offset, 0);
  let added = 0;

  while (added < max) {
    let rows;
    try {
      rows = await fetchRows('RussianNLP/coat', config, split, offset, pageSize);
      if (rows.length === 0) break;
    } catch (err) {
      console.warn(`  CoAT offset=${offset}: ${err.message}`);
      break;
    }

    const batch = [];
    for (const item of rows) {
      const row = item.row ?? {};
      const text = normalize(row.text ?? '');
      if (text.length < 40) continue;
      const label = row.label === 0 || row.label === 1 ? row.label : null;
      if (label === null) continue;
      batch.push({
        title: '',
        text,
        label,
        lang: detectLang(text),
        source: label === 1 ? 'coat_machine' : 'coat_human',
        generator: label === 1 ? 'coat' : null,
        prompt_id: null,
        subreddit: null,
        created_utc: null,
        author_hash: null,
      });
    }

    added += add(batch);
    offset += pageSize;
    console.log(`  CoAT ${split}: offset=${offset}, добавлено=${added}`);
    if (rows.length < pageSize) break;
    await sleep(300);
  }
  return added;
}

async function semeval() {
  const config = String(args['semeval-config'] ?? 'subtaskA_multilingual');
  const split = String(args['semeval-split'] ?? 'train');
  const max = number(args.max, 2000);
  const pageSize = 100;
  let offset = number(args['semeval-offset'] ?? args.offset, 0);
  let added = 0;

  while (added < max) {
    let rows;
    try {
      rows = await fetchRows('d0rj/SemEval2024-task8', config, split, offset, pageSize);
      if (rows.length === 0) break;
    } catch (err) {
      console.warn(`  SemEval offset=${offset}: ${err.message}`);
      break;
    }

    const batch = [];
    for (const item of rows) {
      const row = item.row ?? {};
      const text = normalize(row.text ?? '');
      if (text.length < 40) continue;
      if (row.label !== 0 && row.label !== 1) continue;
      batch.push({
        title: '',
        text,
        label: row.label,
        lang: detectLang(text),
        source: `semeval_${row.source ?? 'unknown'}`,
        generator: row.model ?? null,
        prompt_id: row.id === undefined || row.id === null ? null : `semeval:${row.id}`,
        subreddit: null,
        created_utc: null,
        author_hash: null,
      });
    }

    added += add(batch);
    offset += pageSize;
    console.log(`  SemEval ${split}: offset=${offset}, добавлено=${added}`);
    if (rows.length < pageSize) break;
    await sleep(300);
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
if (args.hc3) added += await hc3();
if (args.coat) added += await coat();
if (args.semeval) added += await semeval();
if (args.file) added += fromFile();

if (!args.hc3 && !args.coat && !args.semeval && !args.file) {
  console.log('укажите --hc3, --coat, --semeval и/или --file=<path>');
  process.exitCode = 1;
} else {
  printDist(out.split(/[\\/]/).pop() ?? 'public.jsonl', readJsonl(out));
  console.log(`добавлено: ${added}, файл: ${out}`);
}
