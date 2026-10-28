export interface MetricsResult {
  tp: number;
  fp: number;
  tn: number;
  fn: number;
  precision: number;
  recall: number;
  f1: number;
  accuracy: number;
}

export interface CalibrationResult {
  brier: number;
  ece: number;
}

export interface PickedThreshold {
  threshold: number;
  metrics: MetricsResult;
  strategy: 'precision' | 'f1';
}

export function metrics(
  scores: number[],
  labels: number[],
  threshold?: number,
): MetricsResult;

export function calibration(scores: number[], labels: number[], bins?: number): CalibrationResult;

export function pickThreshold(
  scores: number[],
  labels: number[],
  options?: { minPrecision?: number; step?: number },
): PickedThreshold;

export function thresholdSweep(
  scores: number[],
  labels: number[],
  step?: number,
): Array<MetricsResult & { threshold: number }>;

export function fitTemperature(
  logits: number[],
  labels: number[],
  options?: { min?: number; max?: number; step?: number },
): { temperature: number; nll: number };

export function sigmoid(z: number): number;
export function logit(p: number): number;
export function formatMetrics(metrics: MetricsResult): string;
