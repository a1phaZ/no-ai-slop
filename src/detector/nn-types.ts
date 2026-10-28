import type { ModelMetrics } from './model-types.ts';

/** Маленькая нейросеть: стандартизация + один скрытый слой ReLU + сигмоида. */
export interface NnWeights {
  version: number;
  trainedAt: string;
  features: string[];
  hidden: number;
  mean: number[];
  std: number[];
  /** w1[h][j] — вес признака j в скрытом нейроне h. */
  w1: number[][];
  b1: number[];
  w2: number[];
  b2: number;
  temperature: number;
  threshold: number;
  metrics: ModelMetrics;
}
