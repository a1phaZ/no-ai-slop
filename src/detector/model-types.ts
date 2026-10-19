export interface ModelMetrics {
  n: number;
  trainN: number;
  valN: number;
  testN: number;
  threshold: number;
  accuracy: number;
  precision: number;
  recall: number;
  f1: number;
  /** Среднеквадратичная ошибка вероятностей — калибровка. */
  brier?: number;
  /** Expected Calibration Error. */
  ece?: number;
}

/** Веса линейной модели: стандартизация + логистическая регрессия. */
export interface ModelWeights {
  version: number;
  trainedAt: string;
  features: string[];
  mean: number[];
  std: number[];
  weights: number[];
  bias: number;
  threshold: number;
  metrics: ModelMetrics;
}
