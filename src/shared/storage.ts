import type { CacheEntry, Stats } from './types.ts';

const CACHE_KEY = 'cache';
const STATS_KEY = 'stats';
export const CACHE_MAX = 2000;

export const DEFAULT_STATS: Stats = { hidden: 0, manual: 0, scanned: 0 };

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
