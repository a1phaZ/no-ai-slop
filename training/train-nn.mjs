// Обучение маленькой нейросети (MLP 20 -> hidden -> 1) на том же датасете.
//
//   node training/train-nn.mjs
//   node training/train-nn.mjs --hidden=16 --epochs=1500 --min-precision=0.9
//
// Пишет src/detector/nn-weights.ts. Модель синхронная и без зависимостей,
// поэтому работает в content script без WASM/CSP-проблем.
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
import { mulberry32, number, parseArgs } from './lib/util.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = parseArgs();
const dataPath = resolve(root, 'data/dataset.jsonl');
const seedPath = resolve(root, 'training/dataset.jsonl');
const source = args.input ? resolve(String(args.input)) : existsSync(dataPath) ? dataPath : seedPath;
const outPath = resolve(root, 'src/detector/nn-weights.ts');

const SEED = number(args.seed, 20261019);
const HIDDEN = number(args.hidden, 16);
const EPOCHS = number(args.epochs, 1500);
const LR = number(args.lr, 0.01);
const L2 = number(args.l2, 0.0001);
const PATIENCE = number(args.patience, 150);
const MIN_PRECISION = number(args['min-precision'], 0.9);

console.log(`датасет: ${source}`);
const rows = loadDataset(source);
if (rows.length === 0) throw new Error('датасет пуст');

const X = rows.map((row) => toVector(extractFeatures(textOf(row))));
const y = rows.map((row) => row.label);
const w = rows.map(weightOf);
const D = FEATURE_NAMES.length;

const { train: trainIdx, val: valIdx, test: testIdx } = splitIndices(rows, SEED);
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

const rand = mulberry32(SEED);
const he = () => Math.sqrt(2 / D);
const params = {
  w1: Array.from({ length: HIDDEN }, () => Array.from({ length: D }, () => (rand() * 2 - 1) * he())),
  b1: new Array(HIDDEN).fill(0),
  w2: Array.from({ length: HIDDEN }, () => (rand() * 2 - 1) * Math.sqrt(2 / HIDDEN)),
  b2: 0,
};

const grads = {
  w1: Array.from({ length: HIDDEN }, () => new Array(D).fill(0)),
  b1: new Array(HIDDEN).fill(0),
  w2: new Array(HIDDEN).fill(0),
  b2: 0,
};

const adamM = {
  w1: Array.from({ length: HIDDEN }, () => new Array(D).fill(0)),
  b1: new Array(HIDDEN).fill(0),
  w2: new Array(HIDDEN).fill(0),
  b2: 0,
};
const adamV = {
  w1: Array.from({ length: HIDDEN }, () => new Array(D).fill(0)),
  b1: new Array(HIDDEN).fill(0),
  w2: new Array(HIDDEN).fill(0),
  b2: 0,
};

function forward(x, p = params) {
  const z1 = new Array(HIDDEN).fill(0);
  const a1 = new Array(HIDDEN).fill(0);
  for (let h = 0; h < HIDDEN; h++) {
    let sum = p.b1[h];
    for (let j = 0; j < D; j++) sum += p.w1[h][j] * x[j];
    z1[h] = sum;
    a1[h] = sum > 0 ? sum : 0;
  }
  let z2 = p.b2;
  for (let h = 0; h < HIDDEN; h++) z2 += p.w2[h] * a1[h];
  return { z1, a1, z2 };
}

function logits(x, p = params) {
  return forward(x, p).z2;
}

function binaryLoss(x, label, weight) {
  const z = logits(x);
  const pos = z >= 0 ? Math.log1p(Math.exp(-z)) : -z + Math.log1p(Math.exp(z));
  const neg = z >= 0 ? z + Math.log1p(Math.exp(-z)) : Math.log1p(Math.exp(z));
  return weight * (label === 1 ? pos : neg);
}

function evaluateLoss(xs, ys, ws) {
  let loss = 0;
  let total = 0;
  for (let i = 0; i < xs.length; i++) {
    loss += binaryLoss(xs[i], ys[i], ws[i]);
    total += ws[i];
  }
  return loss / Math.max(1, total);
}


let best = null;
let bestLoss = Infinity;
let stale = 0;
let step = 0;

for (let epoch = 0; epoch < EPOCHS; epoch++) {
  for (const g of grads.w1) g.fill(0);
  grads.b1.fill(0);
  grads.w2.fill(0);
  grads.b2 = 0;

  for (let i = 0; i < nTrainX.length; i++) {
    const x = nTrainX[i];
    const label = trainY[i];
    const weight = trainW[i];
    const { z1, a1, z2 } = forward(x);
    const dz2 = (sigmoid(z2) - label) * weight;
    for (let h = 0; h < HIDDEN; h++) {
      grads.w2[h] += dz2 * a1[h];
      const dz1 = dz2 * params.w2[h] * (z1[h] > 0 ? 1 : 0);
      grads.b1[h] += dz1;
      for (let j = 0; j < D; j++) grads.w1[h][j] += dz1 * x[j];
    }
    grads.b2 += dz2;
  }

  step += 1;
  const b1 = 0.9;
  const b2 = 0.999;
  const eps = 1e-8;
  const lr = LR * Math.sqrt(1 - b2 ** step) / (1 - b1 ** step);

  for (let h = 0; h < HIDDEN; h++) {
    for (let j = 0; j < D; j++) {
      const g = grads.w1[h][j] / totalW + L2 * params.w1[h][j];
      adamM.w1[h][j] = b1 * adamM.w1[h][j] + (1 - b1) * g;
      adamV.w1[h][j] = b2 * adamV.w1[h][j] + (1 - b2) * g * g;
      params.w1[h][j] -= (lr * adamM.w1[h][j]) / (Math.sqrt(adamV.w1[h][j]) + eps);
    }
    const gb = grads.b1[h] / totalW;
    adamM.b1[h] = b1 * adamM.b1[h] + (1 - b1) * gb;
    adamV.b1[h] = b2 * adamV.b1[h] + (1 - b2) * gb * gb;
    params.b1[h] -= (lr * adamM.b1[h]) / (Math.sqrt(adamV.b1[h]) + eps);

    const gw = grads.w2[h] / totalW + L2 * params.w2[h];
    adamM.w2[h] = b1 * adamM.w2[h] + (1 - b1) * gw;
    adamV.w2[h] = b2 * adamV.w2[h] + (1 - b2) * gw * gw;
    params.w2[h] -= (lr * adamM.w2[h]) / (Math.sqrt(adamV.w2[h]) + eps);
  }
  const gb2 = grads.b2 / totalW;
  adamM.b2 = b1 * adamM.b2 + (1 - b1) * gb2;
  adamV.b2 = b2 * adamV.b2 + (1 - b2) * gb2 * gb2;
  params.b2 -= (lr * adamM.b2) / (Math.sqrt(adamV.b2) + eps);

  const valLoss = evaluateLoss(nValX, valY, valIdx.map((i) => w[i]));
  if (valLoss < bestLoss - 1e-6) {
    bestLoss = valLoss;
    best = {
      w1: params.w1.map((row) => [...row]),
      b1: [...params.b1],
      w2: [...params.w2],
      b2: params.b2,
    };
    stale = 0;
  } else {
    stale += 1;
    if (stale >= PATIENCE) break;
  }
}

if (best) Object.assign(params, best);

const valLogits = nValX.map((x) => logits(x));
const { temperature } = fitTemperature(valLogits, valY);
const valScores = valLogits.map((z) => sigmoid(z / temperature));
const picked = pickThreshold(valScores, valY, { minPrecision: MIN_PRECISION });
const threshold = picked.threshold;

const scoreWith = (x) => sigmoid(logits(x) / temperature);
const trainScores = nTrainX.map(scoreWith);
const testScores = nTestX.map(scoreWith);
const trainMetrics = metrics(trainScores, trainY, threshold);
const valMetrics = metrics(valScores, valY, threshold);
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
  hidden: HIDDEN,
  mean: mean.map(round),
  std: std.map(round),
  w1: params.w1.map((row) => row.map(round)),
  b1: params.b1.map(round),
  w2: params.w2.map(round),
  b2: round(params.b2),
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
  '// Источник: training/train-nn.mjs',
  `// Датасет: ${source}`,
  `// Обучено: ${payload.trainedAt}, примеров: ${rows.length}, hidden=${HIDDEN}`,
  `// Калибровка: T=${temperature}, порог=${threshold} (${picked.strategy}, precision>=${MIN_PRECISION})`,
  `// Метрики (test): accuracy=${payload.metrics.accuracy} precision=${payload.metrics.precision} recall=${payload.metrics.recall} f1=${payload.metrics.f1} brier=${payload.metrics.brier} ece=${payload.metrics.ece}`,
  "import type { NnWeights } from './nn-types.ts';",
  '',
].join('\n');

writeFileSync(
  outPath,
  `${header}export const NN_WEIGHTS: NnWeights = ${JSON.stringify(payload, null, 2)};\n`,
);

console.log(
  `примеров: ${rows.length} (train ${trainX.length} / val ${valX.length} / test ${testX.length}), hidden=${HIDDEN}`,
);
console.log(`temperature: ${temperature}`);
console.log(`порог (val, ${picked.strategy}): ${threshold}`);
console.log(`train: ${formatMetrics(trainMetrics)}`);
console.log(`val:   ${formatMetrics(valMetrics)}`);
console.log(`test:  ${formatMetrics(testMetrics)}`);
console.log(
  `калибровка (test): brier=${testCalibration.brier.toFixed(3)} ece=${testCalibration.ece.toFixed(3)}`,
);
console.log(`веса -> ${outPath}`);
