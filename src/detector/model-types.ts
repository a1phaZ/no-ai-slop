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
  /** Как выбирался порог: precision-first или F1-фолбэк. */
  thresholdStrategy?: 'precision' | 'f1';
  /** Целевая precision при выборе порога. */
  minPrecision?: number;
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
  /** Temperature scaling: p = sigmoid(z / temperature). */
  temperature?: number;
  /** Рекомендуемый порог, выбранный на валидации. */
  threshold: number;
  metrics: ModelMetrics;
}
