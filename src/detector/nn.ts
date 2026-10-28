import type { Signal } from '../shared/types.ts';
import type { Features } from './features.ts';
import type { NnWeights } from './nn-types.ts';
import { sigmoid } from './model.ts';
import { FEATURE_NAMES, toVector } from './vector.ts';
import { NN_WEIGHTS } from './nn-weights.ts';

/** Версия нейросети — попадает в идентификатор кэша и метки. */
export const NN_MODEL_VERSION = NN_WEIGHTS.version;

export function nnModelId(weights: NnWeights = NN_WEIGHTS): string {
  return `nn@${weights.version}`;
}

/** Проверяет, что размерности весов совпадают с текущим вектором признаков. */
export function nnAvailable(weights: NnWeights = NN_WEIGHTS): boolean {
  const d = FEATURE_NAMES.length;
  return (
    Array.isArray(weights.w1) &&
    weights.w1.length === weights.hidden &&
    weights.w1.every((row) => Array.isArray(row) && row.length === d) &&
    weights.b1.length === weights.hidden &&
    weights.w2.length === weights.hidden &&
    weights.mean.length === d &&
    weights.std.length === d &&
    weights.features.length === d
  );
}

/**
 * Прямой проход MLP: standardize -> ReLU -> sigmoid с temperature scaling.
 * Сигналы — top-5 по чувствительности выхода к признаку (saliency).
 */
export function predictNN(
  features: Features,
  weights: NnWeights = NN_WEIGHTS,
): { score: number; signals: Signal[] } {
  const x = toVector(features);
  const d = x.length;
  const hidden = weights.hidden;

  const z1 = new Array<number>(hidden);
  const a1 = new Array<number>(hidden);
  for (let h = 0; h < hidden; h++) {
    let sum = weights.b1[h];
    for (let j = 0; j < d; j++) {
      const std = weights.std[j] || 1;
      sum += weights.w1[h][j] * ((x[j] - weights.mean[j]) / std);
    }
    z1[h] = sum;
    a1[h] = sum > 0 ? sum : 0;
  }

  let z2 = weights.b2;
  for (let h = 0; h < hidden; h++) z2 += weights.w2[h] * a1[h];

  const temperature = weights.temperature && weights.temperature > 0 ? weights.temperature : 1;
  const score = sigmoid(z2 / temperature);

  // d(z2)/d(x_j) = sum_h w2[h] * relu'(z1[h]) * w1[h][j] / std[j]
  const saliency = new Array<number>(d).fill(0);
  for (let h = 0; h < hidden; h++) {
    if (z1[h] <= 0) continue;
    const factor = weights.w2[h];
    for (let j = 0; j < d; j++) {
      const std = weights.std[j] || 1;
      saliency[j] += (factor * weights.w1[h][j]) / std;
    }
  }

  const signals: Signal[] = saliency
    .map((weight, j) => ({
      id: weights.features[j] ?? FEATURE_NAMES[j],
      weight,
      detail: `${weights.features[j] ?? FEATURE_NAMES[j]}=${x[j].toFixed(3)}`,
    }))
    .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))
    .slice(0, 5);

  return { score, signals };
}
