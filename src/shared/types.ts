export type HideMode = 'blur' | 'hide';

export type DetectorMode = 'model' | 'heuristics';

export interface Settings {
  enabled: boolean;
  mode: HideMode;
  /** Порог уверенности 0..1. Пост скрывается при score >= threshold. */
  threshold: number;
  /** Какой детектор использовать: обученная модель или эвристики. */
  detector: DetectorMode;
  scanOldReddit: boolean;
  debug: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  mode: 'blur',
  threshold: 0.55,
  detector: 'model',
  scanOldReddit: true,
  debug: false,
};

export interface Signal {
  id: string;
  /** Вклад в сырую сумму (может быть отрицательным — «человеческий» признак). */
  weight: number;
  detail: string;
}

export type DetectionSource = 'model' | 'heuristic' | 'cache';

export interface DetectionResult {
  score: number;
  signals: Signal[];
  source: DetectionSource;
  textLength: number;
  version: number;
}

export interface CacheEntry {
  hash: string;
  score: number;
  /** Помечено пользователем кнопкой «Возможно AI». */
  manual: boolean;
  checkedAt: number;
  version: number;
}

export interface Stats {
  hidden: number;
  manual: number;
  scanned: number;
}

export const DETECTOR_VERSION = 3;
