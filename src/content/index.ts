import { loadSettings, normalizeSettings } from '../shared/settings.ts';
import { loadCache, loadLabels, saveCache, saveLabels, upsertLabel } from '../shared/storage.ts';
import { buildLabelEntry } from '../shared/labels.ts';
import { sendMessage } from '../shared/messages.ts';
import {
  DEFAULT_SETTINGS,
  DETECTOR_VERSION,
  type CacheEntry,
  type DetectionResult,
  type LabelEntry,
  type LabelValue,
  type Settings,
} from '../shared/types.ts';
import { MODEL_VERSION, detect } from '../detector/index.ts';
import { cacheKey, isFresh, makeEntry } from '../detector/cache.ts';
import { collectPosts, type PostNode } from './reddit.ts';
import { renderControl, type Applied } from './ui.ts';

/** При ручной метке пост перепроверяется «мягче». */
const MANUAL_FACTOR = 0.6;
const CACHE_FLUSH_MS = 1000;
const RESCAN_DEBOUNCE_MS = 300;
/** На сколько постов ниже оценка считается «подтверждённой меткой». */
const LABEL_SCORE_FACTOR = 0.85;

interface Runtime {
  settings: Settings;
  cache: Record<string, CacheEntry>;
  labels: Map<string, LabelEntry>;
}

let runtime: Runtime;
const applied = new Map<HTMLElement, Applied>();
const counted = new Set<string>();
let cacheDirty = false;
let cacheTimer: number | undefined;
let rescanTimer: number | undefined;

function log(...args: unknown[]): void {
  if (runtime?.settings.debug) console.debug('[no-ai-slop]', ...args);
}

function persistCacheSoon(): void {
  cacheDirty = true;
  if (cacheTimer !== undefined) return;
  cacheTimer = window.setTimeout(() => {
    cacheTimer = undefined;
    if (!cacheDirty) return;
    cacheDirty = false;
    void saveCache(runtime.cache);
  }, CACHE_FLUSH_MS);
}

interface Analysis {
  entry: CacheEntry;
  fresh: DetectionResult | null;
}

function analyze(text: string): Analysis {
  const key = cacheKey(text);
  const cached = runtime.cache[key];
  if (isFresh(cached)) return { entry: cached, fresh: null };

  const result = detect(text, runtime.settings.detector);
  const entry = makeEntry(key, result.score);
  runtime.cache[key] = entry;
  persistCacheSoon();
  return { entry, fresh: result };
}

/**
 * Порог для поста с учётом явной метки:
 * «ИИ» — мягче (прячем увереннее), «человек» — жёстче (показываем).
 */
function thresholdFor(label: LabelValue | null): number {
  const base = runtime.settings.threshold;
  if (label === 'ai') return base * MANUAL_FACTOR;
  if (label === 'human') return Math.min(1, base / LABEL_SCORE_FACTOR);
  return base;
}

function shouldHide(entry: CacheEntry, label: LabelValue | null): boolean {
  return entry.score >= thresholdFor(label);
}

/**
 * Сохраняет метку. Возвращает false, если не удалось (лимит хранилища).
 * Текст поста сохраняется только здесь — для будущего датасета.
 */
function labelPost(post: PostNode, entry: CacheEntry, value: LabelValue | null): boolean {
  const previous = runtime.labels.get(entry.hash);
  const labelEntry = buildLabelEntry({
    hash: entry.hash,
    title: post.title,
    text: post.body,
    label: value ?? previous?.label ?? 'human',
    score: entry.score,
    detectorVersion: DETECTOR_VERSION,
    modelVersion: MODEL_VERSION,
  });

  const result = upsertLabel([...runtime.labels.values()], labelEntry, value);
  if (!result.ok) {
    log('лимит меток: сохраните экспорт и очистите хранилище');
    return false;
  }

  runtime.labels = new Map(result.labels.map((l) => [l.hash, l]));
  void saveLabels(result.labels);

  const wasAi = previous?.label === 'ai' ? 1 : 0;
  const isAi = value === 'ai' ? 1 : 0;
  const wasLabeled = previous ? 1 : 0;
  const isLabeled = value ? 1 : 0;

  void sendMessage({
    type: 'stats:add',
    labeled: isLabeled - wasLabeled,
    manual: isAi - wasAi,
  });

  log(value === null ? 'метка снята' : `метка: ${value}`, entry.hash);
  return true;
}

function processPost(post: PostNode): void {
  if (post.el.dataset.nasProcessed === '1') return;
  post.el.dataset.nasProcessed = '1';

  if (post.el.dataset.nasRevealed === '1') return;

  const text = `${post.title}\n${post.body}`.trim();
  if (text.length === 0) return;

  const { entry, fresh } = analyze(text);
  const label = runtime.labels.get(entry.hash)?.label ?? null;
  const canHide = post.contentEl !== null;
  const decideHidden = (value: LabelValue | null): boolean =>
    canHide && shouldHide(entry, value);
  const hidden = decideHidden(label);

  const info = renderControl(post.el, {
    target: post.contentEl,
    score: entry.score,
    label,
    hidden,
    mode: runtime.settings.mode,
    onLabel: (value) => {
      if (!labelPost(post, entry, value)) return { ok: false, hidden };
      return { ok: true, hidden: decideHidden(value) };
    },
  });
  applied.set(post.el, info);

  void sendMessage({ type: 'stats:add', scanned: 1 });
  log(
    'пост',
    post.id || '?',
    `score=${entry.score.toFixed(2)}`,
    hidden ? '(скрыт)' : '',
    label ? `[метка: ${label}]` : '',
    fresh
      ? `[${fresh.source}] ${fresh.signals.map((s) => s.id).join(', ')}`
      : '[кэш]',
  );

  if (hidden) {
    const countKey = post.id || entry.hash;
    if (!counted.has(countKey)) {
      counted.add(countKey);
      void sendMessage({ type: 'stats:add', hidden: 1 });
    }
  }
}

function scanAll(): void {
  if (!runtime.settings.enabled) return;
  for (const post of collectPosts(document, runtime.settings.scanOldReddit)) {
    processPost(post);
  }
}

function scheduleScan(): void {
  if (rescanTimer !== undefined) return;
  rescanTimer = window.setTimeout(() => {
    rescanTimer = undefined;
    scanAll();
  }, RESCAN_DEBOUNCE_MS);
}

function revertAll(): void {
  for (const info of applied.values()) info.remove();
  applied.clear();
  for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-nas-processed]'))) {
    delete el.dataset.nasProcessed;
    delete el.dataset.nasRevealed;
  }
}

function observe(): void {
  const observer = new MutationObserver(() => {
    if (runtime.settings.enabled) scheduleScan();
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

function watchSettings(): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync' || !changes.settings) return;
    const next = normalizeSettings(changes.settings.newValue as Partial<Settings>);
    const prev = runtime.settings;
    const structureChanged =
      next.mode !== prev.mode ||
      next.threshold !== prev.threshold ||
      next.detector !== prev.detector ||
      next.scanOldReddit !== prev.scanOldReddit;
    const enabledChanged = next.enabled !== prev.enabled;
    runtime.settings = next;

    if (!next.enabled) {
      revertAll();
      return;
    }
    if (enabledChanged || structureChanged) {
      revertAll();
      scanAll();
    }
  });
}

async function init(): Promise<void> {
  try {
    const [settings, cache, labels] = await Promise.all([
      loadSettings(),
      loadCache(),
      loadLabels(),
    ]);
    runtime = {
      settings,
      cache,
      labels: new Map(labels.map((l) => [l.hash, l])),
    };
  } catch (err) {
    console.warn('[no-ai-slop] не удалось загрузить данные, беру значения по умолчанию', err);
    runtime = { settings: { ...DEFAULT_SETTINGS }, cache: {}, labels: new Map() };
  }

  if (runtime.settings.enabled) scanAll();
  observe();
  watchSettings();
  log('инициализировано', `меток: ${runtime.labels.size}`);
}

void init();
