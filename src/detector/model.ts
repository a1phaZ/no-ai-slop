import type { Signal } from '../shared/types.ts';
import type { Features } from './features.ts';
import type { ModelWeights } from './model-types.ts';
import { FEATURE_NAMES, toVector } from './vector.ts';
import { WEIGHTS } from './weights.ts';

export function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z));
}

/** Версия обученной модели — пишется в метки пользователей. */
export const MODEL_VERSION = WEIGHTS.version;

/** Модель готова к использованию, если её размерность совпадает с текущим вектором признаков. */
export function modelAvailable(weights: ModelWeights = WEIGHTS): boolean {
  return (
    Array.isArray(weights.weights) &&
    weights.weights.length === FEATURE_NAMES.length &&
    weights.features.length === FEATURE_NAMES.length &&
    weights.mean.length === FEATURE_NAMES.length &&
    weights.std.length === FEATURE_NAMES.length
  );
}

export function predictModel(
  features: Features,
  weights: ModelWeights = WEIGHTS,
): { score: number; signals: Signal[] } {
  const x = toVector(features);
  const contributions: Signal[] = [];
  let z = weights.bias;

  for (let i = 0; i < x.length; i++) {
    const std = weights.std[i] || 1;
    const normalized = (x[i] - weights.mean[i]) / std;
    const contribution = weights.weights[i] * normalized;
    z += contribution;
    contributions.push({
      id: weights.features[i],
      weight: contribution,
      detail: `${weights.features[i]}=${x[i].toFixed(3)}`,
    });
  }

  contributions.sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));
  return { score: sigmoid(z), signals: contributions.slice(0, 5) };
}
