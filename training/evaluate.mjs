// Оценка текущего детектора на отложенных данных и реальных метках.
//
//   node training/evaluate.mjs
//   node training/evaluate.mjs --input=data/dataset.jsonl --user=data/eval/user.jsonl
//   node training/evaluate.mjs --modes=model,linear,heuristics --threshold=0.55
//
// Пишет data/eval/report.json (без текстов постов — только хэши и оценки).
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { detect, modelIdFor } from '../src/detector/index.ts';
import { WEIGHTS } from '../src/detector/weights.ts';
import { NN_WEIGHTS } from '../src/detector/nn-weights.ts';
import { nnAvailable } from '../src/detector/nn.ts';
import { loadDataset, slices, splitIndices, textOf } from './lib/dataset.mjs';
import {
  calibration,
  formatMetrics,
  metrics,
  pickThreshold,
  thresholdSweep,
} from './lib/metrics.mjs';
import { EVAL_DIR, ensureDir, number, parseArgs, textHash } from './lib/util.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = parseArgs();
const dataPath = resolve(root, 'data/dataset.jsonl');
const seedPath = resolve(root, 'training/dataset.jsonl');
const inputPath = args.input
  ? resolve(String(args.input))
  : existsSync(dataPath)
    ? dataPath
    : seedPath;
const userPath = args.user ? resolve(String(args.user)) : resolve(EVAL_DIR, 'user.jsonl');
const outPath = resolve(String(args.out ?? resolve(EVAL_DIR, 'report.json')));

const modes = String(args.modes ?? 'model,linear,heuristics')
  .split(',')
  .map((m) => m.trim())
  .filter((m) => m === 'model' || m === 'linear' || m === 'heuristics');

const dataset = loadDataset(inputPath);
if (dataset.length === 0) {
  console.error(`датасет пуст: ${inputPath}`);
  process.exit(1);
}

// Для собранного датасета берём test-сплит; для seed — его случайный test.
const { test: testIdx } = splitIndices(dataset);
const testRows = testIdx.map((i) => dataset[i]);
const testIndices = testRows.map((_, i) => i);

const userRows = existsSync(userPath) ? loadDataset(userPath) : [];
const userIndices = userRows.map((_, i) => i);

function thresholdFor(mode) {
  if (args.threshold) return number(args.threshold, 0.55);
  if (mode === 'model' && nnAvailable()) return NN_WEIGHTS.threshold;
  if (mode !== 'heuristics') return WEIGHTS.threshold;
  return 0.55;
}

function evaluate(rows, indices, mode, threshold) {
  const predictions = indices.map((i) => detect(textOf(rows[i]), mode));
  const scores = predictions.map((p) => p.score);
  const labels = indices.map((i) => rows[i].label);
  const modelIds = [...new Set(predictions.map((p) => p.modelId))];
  const m = metrics(scores, labels, threshold);
  const cal = calibration(scores, labels);
  const picked = pickThreshold(scores, labels, {
    minPrecision: number(args['min-precision'], 0.9),
  });

  const sliceReports = slices(rows, indices).map(({ name, idx }) => {
    const sliceLabels = idx.map((i) => rows[i].label);
    if (sliceLabels.every((v) => v === sliceLabels[0])) {
      return { name, n: idx.length, note: 'только один класс' };
    }
    const sliceScores = idx.map((i) => scores[indices.indexOf(i)]);
    return {
      name,
      n: idx.length,
      metrics: metrics(sliceScores, sliceLabels, threshold),
    };
  });

  const errors = indices
    .map((i, k) => ({
      label: rows[i].label,
      score: scores[k],
      predicted: scores[k] >= threshold ? 1 : 0,
      lang: rows[i].lang ?? 'other',
      source: rows[i].source ?? 'unknown',
      length: String(rows[i].text ?? '').length,
      hash: rows[i].hash ?? textHash(rows[i].title, rows[i].text),
    }))
    .filter((e) => e.predicted !== e.label)
    .sort((a, b) => (a.label === 1 ? b.score - a.score : a.score - b.score))
    .slice(0, 20);

  return {
    mode,
    modelIds,
    threshold,
    n: rows.length,
    metrics: m,
    calibration: cal,
    recommendedThreshold: picked,
    sweep: thresholdSweep(scores, labels, 0.05),
    slices: sliceReports,
    errors,
  };
}

function printResult(name, result) {
  console.log(`\n=== ${name} ===`);
  console.log(`модель: ${result.modelIds.join(', ')}, порог: ${result.threshold}`);
  console.log(formatMetrics(result.metrics));
  console.log(
    `калибровка: brier=${result.calibration.brier.toFixed(3)} ece=${result.calibration.ece.toFixed(3)}`,
  );
  const rec = result.recommendedThreshold;
  console.log(
    `рекомендуемый порог: ${rec.threshold} (${rec.strategy}, precision>=${number(args['min-precision'], 0.9)})`,
  );
  if (result.slices.length > 0) {
    console.log('срезы:');
    for (const slice of result.slices) {
      if ('note' in slice) {
        console.log(`  ${slice.name} (n=${slice.n}): ${slice.note}`);
      } else {
        console.log(`  ${slice.name} (n=${slice.n}): ${formatMetrics(slice.metrics)}`);
      }
    }
  }
  if (result.errors.length > 0) {
    console.log('ошибки (до 20):');
    for (const e of result.errors) {
      console.log(
        `  label=${e.label} score=${e.score.toFixed(3)} ${e.lang}/${e.source} len=${e.length} hash=${e.hash}`,
      );
    }
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  dataset: inputPath,
  userLabels: existsSync(userPath) ? userPath : null,
  minPrecision: number(args['min-precision'], 0.9),
  results: [],
};

for (const mode of modes) {
  const threshold = thresholdFor(mode);
  console.log(`\n### ${inputPath} | ${mode}`);
  const result = evaluate(testRows, testIndices, mode, threshold);
  printResult(`test | ${mode} | ${modelIdFor(mode)}`, result);
  report.results.push({ split: 'test', ...result });

  if (userRows.length > 0) {
    console.log(`\n### ${userPath} | ${mode}`);
    const userResult = evaluate(userRows, userIndices, mode, threshold);
    printResult(`user | ${mode} | ${modelIdFor(mode)}`, userResult);
    report.results.push({ split: 'user', ...userResult });
  }
}

ensureDir(dirname(outPath));
writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`\nотчёт -> ${outPath}`);
