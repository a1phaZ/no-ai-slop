// Обучение линейной модели (логистическая регрессия) на training/dataset.jsonl.
// Пишет src/detector/weights.ts. Запуск: node training/train.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractFeatures } from '../src/detector/features.ts';
import { FEATURE_NAMES, toVector } from '../src/detector/vector.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const datasetPath = resolve(root, 'training/dataset.jsonl');
const outPath = resolve(root, 'src/detector/weights.ts');

const SEED = 20261019;
const TRAIN_RATIO = 0.6;
const VAL_RATIO = 0.2;
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

const rows = readFileSync(datasetPath, 'utf8')
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => JSON.parse(line));

if (rows.length === 0) throw new Error('датасет пуст');

const X = rows.map((row) => toVector(extractFeatures(row.text)));
const y = rows.map((row) => row.label);
const D = FEATURE_NAMES.length;

const rand = mulberry32(SEED);
const order = X.map((_, i) => i);
for (let i = order.length - 1; i > 0; i--) {
  const j = Math.floor(rand() * (i + 1));
  [order[i], order[j]] = [order[j], order[i]];
}
const shuffledX = order.map((i) => X[i]);
const shuffledY = order.map((i) => y[i]);

const nTrain = Math.floor(rows.length * TRAIN_RATIO);
const nVal = Math.floor(rows.length * VAL_RATIO);
const trainX = shuffledX.slice(0, nTrain);
const trainY = shuffledY.slice(0, nTrain);
const valX = shuffledX.slice(nTrain, nTrain + nVal);
const valY = shuffledY.slice(nTrain, nTrain + nVal);
const testX = shuffledX.slice(nTrain + nVal);
const testY = shuffledY.slice(nTrain + nVal);

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
  },
};

const header = [
  '// АВТОГЕНЕРАЦИЯ — не редактировать вручную.',
  '// Источник: training/train.mjs, датасет: training/dataset.jsonl',
  `// Обучено: ${payload.trainedAt}, примеров: ${rows.length}`,
  `// Метрики (test): accuracy=${payload.metrics.accuracy} precision=${payload.metrics.precision} recall=${payload.metrics.recall} f1=${payload.metrics.f1}`,
  "import type { ModelWeights } from './model-types.ts';",
  '',
].join('\n');

writeFileSync(
  outPath,
  `${header}export const WEIGHTS: ModelWeights = ${JSON.stringify(payload, null, 2)};\n`,
);

const fmt = (m) =>
  `acc=${m.accuracy.toFixed(3)} prec=${m.precision.toFixed(3)} rec=${m.recall.toFixed(3)} f1=${m.f1.toFixed(3)} (tp=${m.tp} fp=${m.fp} tn=${m.tn} fn=${m.fn})`;

console.log(`датасет: ${rows.length} (train ${trainX.length} / val ${valX.length} / test ${testX.length})`);
console.log(`выбранный порог (val): ${bestThreshold}`);
console.log(`train: ${fmt(trainMetrics)}`);
console.log(`val:   ${fmt(valMetrics)}`);
console.log(`test:  ${fmt(testMetrics)}`);
console.log(`веса -> src/detector/weights.ts`);

const top = weights
  .map((w, j) => ({ name: FEATURE_NAMES[j], w }))
  .sort((a, b) => Math.abs(b.w) - Math.abs(a.w))
  .slice(0, 8);
console.log('топ признаков:', top.map((t) => `${t.name}=${t.w.toFixed(2)}`).join(', '));
