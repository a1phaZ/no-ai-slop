import { DETECTOR_VERSION, type CacheEntry } from '../shared/types.ts';
import { fnv1a, normalizeText } from './hash.ts';

export function cacheKey(text: string): string {
  return fnv1a(normalizeText(text));
}

export function isFresh(entry: CacheEntry | undefined): entry is CacheEntry {
  return !!entry && entry.version === DETECTOR_VERSION;
}

export function makeEntry(hash: string, score: number, manual = false): CacheEntry {
  return { hash, score, manual, checkedAt: Date.now(), version: DETECTOR_VERSION };
}
