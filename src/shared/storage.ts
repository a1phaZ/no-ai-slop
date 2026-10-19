import type { CacheEntry, LabelEntry, LabelValue, Stats } from './types.ts';
import { isLabelEntry } from './labels.ts';

const CACHE_KEY = 'cache';
const STATS_KEY = 'stats';
const LABELS_KEY = 'labels';
export const CACHE_MAX = 2000;
/** Лимит меток: ~2.4 МБ при 10 МБ квоты storage.local. */
export const LABELS_MAX = 2000;

export const DEFAULT_STATS: Stats = { hidden: 0, manual: 0, labeled: 0, scanned: 0 };

export async function loadStats(): Promise<Stats> {
  const raw = await chrome.storage.local.get(STATS_KEY);
  return { ...DEFAULT_STATS, ...(raw[STATS_KEY] as Partial<Stats> | undefined) };
}

export async function saveStats(stats: Stats): Promise<void> {
  await chrome.storage.local.set({ [STATS_KEY]: stats });
}

export async function loadCache(): Promise<Record<string, CacheEntry>> {
  const raw = await chrome.storage.local.get(CACHE_KEY);
  return (raw[CACHE_KEY] as Record<string, CacheEntry> | undefined) ?? {};
}

/** Обрезает кэш до CACHE_MAX, оставляя самые свежие записи. */
export function pruneCache(map: Record<string, CacheEntry>, max = CACHE_MAX): Record<string, CacheEntry> {
  const keys = Object.keys(map);
  if (keys.length <= max) return map;
  const sorted = keys.sort((a, b) => map[b].checkedAt - map[a].checkedAt);
  const kept: Record<string, CacheEntry> = {};
  for (const key of sorted.slice(0, max)) kept[key] = map[key];
  return kept;
}

export async function saveCache(map: Record<string, CacheEntry>): Promise<void> {
  await chrome.storage.local.set({ [CACHE_KEY]: pruneCache(map) });
}

// --- Метки пользователей -------------------------------------------------

/** Метки хранятся как массив: порядок нужен для стабильного экспорта. */
export async function loadLabels(): Promise<LabelEntry[]> {
  const raw = await chrome.storage.local.get(LABELS_KEY);
  const value = raw[LABELS_KEY];
  return Array.isArray(value) ? (value as LabelEntry[]) : [];
}

export type UpsertResult =
  | { ok: true; labels: LabelEntry[]; added: boolean }
  | { ok: false; reason: 'limit'; labels: LabelEntry[] };

/**
 * Добавляет или заменяет метку по хэшу.
 * `value === null` удаляет метку. При достижении лимита новая метка не пишется.
 */
export function upsertLabel(
  labels: LabelEntry[],
  entry: LabelEntry,
  value: LabelValue | null = entry.label,
  max = LABELS_MAX,
): UpsertResult {
  const without = labels.filter((l) => l.hash !== entry.hash);
  if (value === null) {
    return { ok: true, labels: without, added: false };
  }
  const exists = without.length !== labels.length;
  if (!exists && labels.length >= max) {
    return { ok: false, reason: 'limit', labels };
  }
  const next: LabelEntry = { ...entry, label: value };
  return { ok: true, labels: [...without, next], added: !exists };
}

export async function saveLabels(labels: LabelEntry[]): Promise<void> {
  await chrome.storage.local.set({ [LABELS_KEY]: labels });
}

/** Слияние импортированных меток с текущими; конфликты решает более свежая. */
export function mergeLabels(current: LabelEntry[], incoming: LabelEntry[], max = LABELS_MAX): LabelEntry[] {
  const byHash = new Map<string, LabelEntry>();
  for (const entry of current) byHash.set(entry.hash, entry);
  for (const entry of incoming) {
    if (!isLabelEntry(entry)) continue;
    const existing = byHash.get(entry.hash);
    if (!existing || entry.createdAt >= existing.createdAt) byHash.set(entry.hash, entry);
  }
  return [...byHash.values()].sort((a, b) => a.createdAt - b.createdAt).slice(-max);
}
