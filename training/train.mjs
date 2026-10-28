// Обучение линейной модели (логистическая регрессия) на собранном датасете.
//
//   node training/train.mjs
//   node training/train.mjs --input=data/dataset.jsonl --min-precision=0.9
//
// Читает data/dataset.jsonl, если он есть; иначе — seed-датасет training/dataset.jsonl.
// Пишет src/detector/weights.ts и печатает метрики по срезам + калибровку.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractFeatures } from '../src/detector/features.ts';
import { FEATURE_NAMES, toVector } from '../src/detector/vector.ts';
import { loadDataset, splitIndices, textOf, weightOf } from './lib/dataset.mjs';
import {
  calibration,
  fitTemperature,
  formatMetrics,
  metrics,
  pickThreshold,
  sigmoid,
} from './lib/metrics.mjs';
import { number, parseArgs } from './lib/util.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = parseArgs();
const dataPath = resolve(root, 'data/dataset.jsonl');
const seedPath = resolve(root, 'training/dataset.jsonl');
const source = args.input ? resolve(String(args.input)) : existsSync(dataPath) ? dataPath : seedPath;
const outPath = resolve(root, 'src/detector/weights.ts');

const SEED = number(args.seed, 20261019);
const EPOCHS = number(args.epochs, 4000);
const LR = number(args.lr, 0.35);
const L2 = number(args.l2, 0.01);
const MIN_PRECISION = number(args['min-precision'], 0.9);

console.log(`датасет: ${source}`);

const rows = loadDataset(source);
if (rows.length === 0) throw new Error('датасет пуст');

if (source === dataPath && rows.length < 500) {
  console.warn(
    `ВНИМАНИЕ: собранный датасет маленький (${rows.length}). Метрики будут нестабильны — добавьте данных.`,
  );
}

const X = rows.map((row) => toVector(extractFeatures(textOf(row))));
const y = rows.map((row) => row.label);
const w = rows.map(weightOf);
const D = FEATURE_NAMES.length;

const splits = splitIndices(rows, SEED);
const { train: trainIdx, val: valIdx, test: testIdx } = splits;
if (trainIdx.length === 0 || valIdx.length === 0 || testIdx.length === 0) {
  throw new Error(
    `некорректные сплиты: train=${trainIdx.length}, val=${valIdx.length}, test=${testIdx.length}`,
  );
}

const trainX = trainIdx.map((i) => X[i]);
const trainY = trainIdx.map((i) => y[i]);
const trainW = trainIdx.map((i) => w[i]);
const valX = valIdx.map((i) => X[i]);
const valY = valIdx.map((i) => y[i]);
const testX = testIdx.map((i) => X[i]);
const testY = testIdx.map((i) => y[i]);

// Взвешенная стандартизация по train.
const mean = new Array(D).fill(0);
const std = new Array(D).fill(0);
const totalW = trainW.reduce((a, b) => a + b, 0) || 1;
for (let j = 0; j < D; j++) {
  let sum = 0;
  for (let i = 0; i < trainX.length; i++) sum += trainW[i] * trainX[i][j];
  mean[j] = sum / totalW;
  let sq = 0;
  for (let i = 0; i < trainX.length; i++) sq += trainW[i] * (trainX[i][j] - mean[j]) ** 2;
  std[j] = Math.sqrt(sq / totalW) || 1;
}

const normalize = (x) => x.map((v, j) => (v - mean[j]) / std[j]);
const nTrainX = trainX.map(normalize);
const nValX = valX.map(normalize);
const nTestX = testX.map(normalize);

let weights = new Array(D).fill(0);
let bias = 0;

for (let epoch = 0; epoch < EPOCHS; epoch++) {
  const gradW = new Array(D).fill(0);
  let gradB = 0;
  for (let i = 0; i < nTrainX.length; i++) {
    let z = bias;
    for (let j = 0; j < D; j++) z += weights[j] * nTrainX[i][j];
    const err = (sigmoid(z) - trainY[i]) * trainW[i];
    for (let j = 0; j < D; j++) gradW[j] += err * nTrainX[i][j];
    gradB += err;
  }
  for (let j = 0; j < D; j++) {
    weights[j] -= LR * (gradW[j] / totalW + L2 * weights[j]);
  }
  bias -= LR * (gradB / totalW);
}

/** Логит до калибровки: z = bias + sum(w * x). */
const logitsWith = (x) => {
  let z = bias;
  for (let j = 0; j < D; j++) z += weights[j] * x[j];
  return z;
};

// Temperature scaling: не меняем bias, чтобы сохранить калибровку вероятностей.
const valLogits = nValX.map(logitsWith);
const { temperature } = fitTemperature(valLogits, valY);
const scoreWith = (x) => sigmoid(logitsWith(x) / temperature);

// Precision-first: максимум recall при precision >= MIN_PRECISION.
const valScores = valLogits.map((z) => sigmoid(z / temperature));
const picked = pickThreshold(valScores, valY, { minPrecision: MIN_PRECISION });
const threshold = picked.threshold;

const trainScores = nTrainX.map(scoreWith);
const valScoresFinal = valScores;
const testScores = nTestX.map(scoreWith);
const trainMetrics = metrics(trainScores, trainY, threshold);
const valMetrics = metrics(valScoresFinal, valY, threshold);
const testMetrics = metrics(testScores, testY, threshold);
const testCalibration = calibration(testScores, testY);

function nextVersion(path) {
  if (!existsSync(path)) return 1;
  const text = readFileSync(path, 'utf8');
  const found = text.match(/"version":\s*(\d+)/);
  return found ? Number(found[1]) + 1 : 1;
}

const round = (v) => Number(v.toFixed(6));
const payload = {
  version: nextVersion(outPath),
  trainedAt: new Date().toISOString(),
  features: [...FEATURE_NAMES],
  mean: mean.map(round),
  std: std.map(round),
  weights: weights.map(round),
  bias: round(bias),
  temperature,
  threshold,
  metrics: {
    n: rows.length,
    trainN: trainX.length,
    valN: valX.length,
    testN: testX.length,
    threshold,
    thresholdStrategy: picked.strategy,
    minPrecision: MIN_PRECISION,
    accuracy: round(testMetrics.accuracy),
    precision: round(testMetrics.precision),
    recall: round(testMetrics.recall),
    f1: round(testMetrics.f1),
    brier: round(testCalibration.brier),
    ece: round(testCalibration.ece),
  },
};

const header = [
  '// АВТОГЕНЕРАЦИЯ — не редактировать вручную.',
  '// Источник: training/train.mjs',
  `// Датасет: ${source}`,
  `// Обучено: ${payload.trainedAt}, примеров: ${rows.length}`,
  `// Калибровка: T=${temperature}, порог=${threshold} (${picked.strategy}, precision>=${MIN_PRECISION})`,
  `// Метрики (test): accuracy=${payload.metrics.accuracy} precision=${payload.metrics.precision} recall=${payload.metrics.recall} f1=${payload.metrics.f1} brier=${payload.metrics.brier} ece=${payload.metrics.ece}`,
  "import type { ModelWeights } from './model-types.ts';",
  '',
].join('\n');

writeFileSync(
  outPath,
  `${header}export const WEIGHTS: ModelWeights = ${JSON.stringify(payload, null, 2)};\n`,
);

console.log(
  `примеров: ${rows.length} (train ${trainX.length} / val ${valX.length} / test ${testX.length})`,
);
console.log(`temperature: ${temperature}`);
console.log(`порог (val, ${picked.strategy}): ${threshold}`);
console.log(`train: ${formatMetrics(trainMetrics)}`);
console.log(`val:   ${formatMetrics(valMetrics)}`);
console.log(`test:  ${formatMetrics(testMetrics)}`);
console.log(
  `калибровка (test): brier=${testCalibration.brier.toFixed(3)} ece=${testCalibration.ece.toFixed(3)}`,
);

// Метрики по срезам — чтобы «1.0» не прятала провал на русском или на humanized.
const testScoreByIndex = new Map(testIdx.map((i, k) => [i, testScores[k]]));

function slice(name, predicate) {
  const idx = testIdx.filter((i) => predicate(rows[i]));
  if (idx.length === 0) return;
  const labels = idx.map((i) => y[i]);
  if (labels.every((v) => v === labels[0])) {
    console.log(`  ${name} (n=${idx.length}): только один класс — метрика не показательна`);
    return;
  }
  const scores = idx.map((i) => testScoreByIndex.get(i));
  const m = metrics(scores, labels, threshold);
  console.log(`  ${name} (n=${idx.length}): ${formatMetrics(m)}`);
}

console.log('срезы (test):');
slice('lang=ru', (row) => (row.lang ?? 'other') === 'ru');
slice('lang=en', (row) => (row.lang ?? 'other') === 'en');
slice('len<200', (row) => String(row.text ?? '').length < 200);
slice('len 200-800', (row) => {
  const len = String(row.text ?? '').length;
  return len >= 200 && len <= 800;
});
slice('len>800', (row) => String(row.text ?? '').length > 800);
for (const sourceName of [...new Set(rows.map((r) => r.source ?? 'unknown'))]) {
  slice(`source=${sourceName}`, (row) => (row.source ?? 'unknown') === sourceName);
}

const top = weights
  .map((value, j) => ({ name: FEATURE_NAMES[j], w: value }))
  .sort((a, b) => Math.abs(b.w) - Math.abs(a.w))
  .slice(0, 8);
console.log('топ признаков:', top.map((t) => `${t.name}=${t.w.toFixed(2)}`).join(', '));
console.log('веса -> src/detector/weights.ts');
