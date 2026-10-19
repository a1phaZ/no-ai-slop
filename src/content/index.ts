import { loadSettings, normalizeSettings } from '../shared/settings.ts';
import { loadCache, saveCache } from '../shared/storage.ts';
import { sendMessage } from '../shared/messages.ts';
import { DEFAULT_SETTINGS, type CacheEntry, type Settings } from '../shared/types.ts';
import { scoreText } from '../detector/heuristics.ts';
import { cacheKey, isFresh, makeEntry } from '../detector/cache.ts';
import { collectPosts, type PostNode } from './reddit.ts';
import { renderControl, type Applied } from './ui.ts';

/** При ручной метке пост перепроверяется «мягче». */
const MANUAL_FACTOR = 0.6;
const CACHE_FLUSH_MS = 1000;
const RESCAN_DEBOUNCE_MS = 300;

interface Runtime {
  settings: Settings;
  cache: Record<string, CacheEntry>;
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

function analyze(text: string): CacheEntry {
  const key = cacheKey(text);
  let entry = runtime.cache[key];
  if (!isFresh(entry)) {
    entry = makeEntry(key, scoreText(text).score);
    runtime.cache[key] = entry;
    persistCacheSoon();
  }
  return entry;
}

function shouldHide(entry: CacheEntry): boolean {
  const threshold = entry.manual
    ? runtime.settings.threshold * MANUAL_FACTOR
    : runtime.settings.threshold;
  return entry.score >= threshold;
}

function flagPost(entry: CacheEntry): void {
  if (entry.manual) return;
  runtime.cache[entry.hash] = { ...entry, manual: true, checkedAt: Date.now() };
  persistCacheSoon();
  void sendMessage({ type: 'stats:add', manual: 1 });
  log('помечено вручную', entry.hash);
}

function processPost(post: PostNode): void {
  if (post.el.dataset.nasProcessed === '1') return;
  post.el.dataset.nasProcessed = '1';

  if (post.el.dataset.nasRevealed === '1') return;

  const text = `${post.title}\n${post.body}`.trim();
  if (text.length === 0) return;

  const entry = analyze(text);
  const hidden = shouldHide(entry);

  const info = renderControl(post.el, {
    score: entry.score,
    manual: entry.manual,
    hidden,
    mode: runtime.settings.mode,
    onFlag: () => flagPost(entry),
  });
  applied.set(post.el, info);

  void sendMessage({ type: 'stats:add', scanned: 1 });
  log('пост', post.id || '?', 'score=', entry.score.toFixed(2), hidden ? '(скрыт)' : '');

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
    runtime = { settings: await loadSettings(), cache: await loadCache() };
  } catch (err) {
    console.warn('[no-ai-slop] не удалось загрузить настройки, беру значения по умолчанию', err);
    runtime = { settings: { ...DEFAULT_SETTINGS }, cache: {} };
  }

  if (runtime.settings.enabled) scanAll();
  observe();
  watchSettings();
  log('инициализировано');
}

void init();
