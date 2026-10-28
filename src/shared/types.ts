export type HideMode = 'blur' | 'hide';

export type DetectorMode = 'model' | 'linear' | 'heuristics';

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
  /** Конкретная модель: `nn@N`, `linear@N` или `heuristic@N`. */
  modelId: string;
}

export interface CacheEntry {
  hash: string;
  score: number;
  /** Устарело: ручные метки теперь живут в отдельном хранилище `labels`. */
  manual: boolean;
  checkedAt: number;
  version: number;
  /** Идентификатор модели, которой получена оценка (`nn@N`/`linear@N`/...). */
  model: string;
}

/** Явная метка пользователя. */
export type LabelValue = 'ai' | 'human';

export type LabelLanguage = 'en' | 'ru' | 'other';

/**
 * Размеченный пользователем пост — единица будущего датасета.
 * Хранится отдельно от кэша: кэш режется по свежести, метки терять нельзя.
 */
export interface LabelEntry {
  /** fnv1a(normalize(title + "\n" + body)) — тот же ключ, что и у кэша. */
  hash: string;
  title: string;
  text: string;
  label: LabelValue;
  /** Оценка детектора в момент разметки. */
  score: number;
  detectorVersion: number;
  modelVersion: number;
  /** Идентификатор модели, если известен (`nn@N`/`linear@N`). */
  modelId?: string;
  lang: LabelLanguage;
  length: number;
  createdAt: number;
}

export interface Stats {
  hidden: number;
  /** Посты, размеченные как «похоже на ИИ». */
  manual: number;
  /** Всего меток (ИИ + человек). */
  labeled: number;
  scanned: number;
}

export const DETECTOR_VERSION = 3;
