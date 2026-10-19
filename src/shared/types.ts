export type HideMode = 'blur' | 'hide';

export interface Settings {
  enabled: boolean;
  mode: HideMode;
  /** Порог уверенности 0..1. Пост скрывается при score >= threshold. */
  threshold: number;
  scanOldReddit: boolean;
  debug: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  mode: 'blur',
  threshold: 0.55,
  scanOldReddit: true,
  debug: false,
};

export interface Signal {
  id: string;
  /** Вклад в сырую сумму (может быть отрицательным — «человеческий» признак). */
  weight: number;
  detail: string;
}

export type DetectionSource = 'heuristic' | 'cache';

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

export const DETECTOR_VERSION = 2;
