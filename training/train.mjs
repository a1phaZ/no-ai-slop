// Обучение линейной модели (логистическая регрессия) на собранном датасете.
//
//   node training/train.mjs
//
// Читает data/dataset.jsonl, если он есть; иначе — seed-датасет training/dataset.jsonl.
// Пишет src/detector/weights.ts и печатает метрики по срезам + калибровку.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractFeatures } from '../src/detector/features.ts';
import { FEATURE_NAMES, toVector } from '../src/detector/vector.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataPath = resolve(root, 'data/dataset.jsonl');
const seedPath = resolve(root, 'training/dataset.jsonl');
const outPath = resolve(root, 'src/detector/weights.ts');

const SEED = 20261019;
const EPOCHS = 4000;
const LR = 0.35;
const L2 = 0.01;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sigmoid(z) {
  if (z >= 0) return 1 / (1 + Math.exp(-z));
  const e = Math.exp(z);
  return e / (1 + e);
}

function logit(p) {
  return Math.log(p / (1 - p));
}

function metrics(scores, labels, threshold) {
  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;
  for (let i = 0; i < scores.length; i++) {
    const predicted = scores[i] >= threshold ? 1 : 0;
    if (predicted === 1 && labels[i] === 1) tp += 1;
    else if (predicted === 1 && labels[i] === 0) fp += 1;
    else if (predicted === 0 && labels[i] === 0) tn += 1;
    else fn += 1;
  }
  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  const accuracy = (tp + tn) / Math.max(1, tp + tn + fp + fn);
  return { tp, fp, tn, fn, precision, recall, f1, accuracy };
}

/** Доля ошибки калибровки: насколько средняя уверенность расходится с точностью. */
function calibration(scores, labels) {
  const bins = 10;
  const stats = Array.from({ length: bins }, () => ({ count: 0, confidence: 0, positive: 0 }));
  let brier = 0;
  for (let i = 0; i < scores.length; i++) {
    brier += (scores[i] - labels[i]) ** 2;
    const bin = Math.min(bins - 1, Math.floor(scores[i] * bins));
    stats[bin].count += 1;
    stats[bin].confidence += scores[i];
    stats[bin].positive += labels[i];
  }
  let ece = 0;
  for (const bin of stats) {
    if (bin.count === 0) continue;
    const confidence = bin.confidence / bin.count;
    const accuracy = bin.positive / bin.count;
    ece += (bin.count / scores.length) * Math.abs(confidence - accuracy);
  }
  return { brier: brier / scores.length, ece };
}

const source = existsSync(dataPath) ? dataPath : seedPath;
console.log(`датасет: ${source}`);

const rows = readFileSync(source, 'utf8')
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => JSON.parse(line));

if (rows.length === 0) throw new Error('датасет пуст');

if (source === dataPath && rows.length < 500) {
  console.warn(
    `ВНИМАНИЕ: собранный датасет маленький (${rows.length}). Метрики будут нестабильны — добавьте данных.`,
  );
}

const texts = rows.map((row) => `${row.title ?? ''}\n${row.text ?? ''}`.trim());
const X = texts.map((text) => toVector(extractFeatures(text)));
const y = rows.map((row) => row.label);
const D = FEATURE_NAMES.length;

// Сплиты: если они уже заданы в датасете — уважаем группы, иначе режем случайно.
const hasSplits = rows.some((row) => row.split);
let trainIdx;
let valIdx;
let testIdx;

if (hasSplits) {
  trainIdx = rows.map((_, i) => i).filter((i) => rows[i].split === 'train');
  valIdx = rows.map((_, i) => i).filter((i) => rows[i].split === 'val');
  testIdx = rows.map((_, i) => i).filter((i) => rows[i].split === 'test');
} else {
  const rand = mulberry32(SEED);
  const order = X.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const nTrain = Math.floor(rows.length * 0.6);
  const nVal = Math.floor(rows.length * 0.2);
  trainIdx = order.slice(0, nTrain);
  valIdx = order.slice(nTrain, nTrain + nVal);
  testIdx = order.slice(nTrain + nVal);
}

if (trainIdx.length === 0 || valIdx.length === 0 || testIdx.length === 0) {
  throw new Error(`некорректные сплиты: train=${trainIdx.length}, val=${valIdx.length}, test=${testIdx.length}`);
}

const trainX = trainIdx.map((i) => X[i]);
const trainY = trainIdx.map((i) => y[i]);
const valX = valIdx.map((i) => X[i]);
const valY = valIdx.map((i) => y[i]);
const testX = testIdx.map((i) => X[i]);
const testY = testIdx.map((i) => y[i]);

const mean = new Array(D).fill(0);
const std = new Array(D).fill(0);
for (let j = 0; j < D; j++) {
  let sum = 0;
  for (const x of trainX) sum += x[j];
  mean[j] = sum / trainX.length;
  let sq = 0;
  for (const x of trainX) sq += (x[j] - mean[j]) ** 2;
  std[j] = Math.sqrt(sq / trainX.length) || 1;
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
    const err = sigmoid(z) - trainY[i];
    for (let j = 0; j < D; j++) gradW[j] += err * nTrainX[i][j];
    gradB += err;
  }
  const n = nTrainX.length;
  for (let j = 0; j < D; j++) {
    weights[j] -= LR * (gradW[j] / n + L2 * weights[j]);
  }
  bias -= LR * (gradB / n);
}

const scoreWith = (x) => {
  let z = bias;
  for (let j = 0; j < D; j++) z += weights[j] * x[j];
  return sigmoid(z);
};

let bestThreshold = 0.5;
let bestF1 = -1;
for (let t = 0.05; t <= 0.95; t += 0.01) {
  const m = metrics(nValX.map(scoreWith), valY, t);
  const closer = Math.abs(t - 0.5) < Math.abs(bestThreshold - 0.5);
  if (m.f1 > bestF1 + 1e-9 || (Math.abs(m.f1 - bestF1) <= 1e-9 && closer)) {
    bestF1 = m.f1;
    bestThreshold = Number(t.toFixed(2));
  }
}

// Сдвигаем bias так, чтобы «естественная» граница 0.5 совпадала с найденным порогом.
bias -= logit(bestThreshold);

const trainScores = nTrainX.map(scoreWith);
const valScores = nValX.map(scoreWith);
const testScores = nTestX.map(scoreWith);
const trainMetrics = metrics(trainScores, trainY, 0.5);
const valMetrics = metrics(valScores, valY, 0.5);
const testMetrics = metrics(testScores, testY, 0.5);
const testCalibration = calibration(testScores, testY);

const round = (v) => Number(v.toFixed(6));
const payload = {
  version: 1,
  trainedAt: new Date().toISOString(),
  features: [...FEATURE_NAMES],
  mean: mean.map(round),
  std: std.map(round),
  weights: weights.map(round),
  bias: round(bias),
  threshold: 0.5,
  metrics: {
    n: rows.length,
    trainN: trainX.length,
    valN: valX.length,
    testN: testX.length,
    threshold: bestThreshold,
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
  `// Метрики (test): accuracy=${payload.metrics.accuracy} precision=${payload.metrics.precision} recall=${payload.metrics.recall} f1=${payload.metrics.f1} brier=${payload.metrics.brier} ece=${payload.metrics.ece}`,
  "import type { ModelWeights } from './model-types.ts';",
  '',
].join('\n');

writeFileSync(
  outPath,
  `${header}export const WEIGHTS: ModelWeights = ${JSON.stringify(payload, null, 2)};\n`,
);

const fmt = (m) =>
  `acc=${m.accuracy.toFixed(3)} prec=${m.precision.toFixed(3)} rec=${m.recall.toFixed(3)} f1=${m.f1.toFixed(3)} (tp=${m.tp} fp=${m.fp} tn=${m.tn} fn=${m.fn})`;

console.log(`примеров: ${rows.length} (train ${trainX.length} / val ${valX.length} / test ${testX.length})`);
console.log(`выбранный порог (val): ${bestThreshold}`);
console.log(`train: ${fmt(trainMetrics)}`);
console.log(`val:   ${fmt(valMetrics)}`);
console.log(`test:  ${fmt(testMetrics)}`);
console.log(`калибровка (test): brier=${testCalibration.brier.toFixed(3)} ece=${testCalibration.ece.toFixed(3)}`);

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
  const m = metrics(scores, labels, 0.5);
  console.log(`  ${name} (n=${idx.length}): ${fmt(m)}`);
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
  .map((w, j) => ({ name: FEATURE_NAMES[j], w }))
  .sort((a, b) => Math.abs(b.w) - Math.abs(a.w))
  .slice(0, 8);
console.log('топ признаков:', top.map((t) => `${t.name}=${t.w.toFixed(2)}`).join(', '));
console.log('веса -> src/detector/weights.ts');
