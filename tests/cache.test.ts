import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cacheKey, isFresh, makeEntry } from '../src/detector/cache.ts';
import { fnv1a, normalizeText } from '../src/detector/hash.ts';
import { pruneCache } from '../src/shared/storage.ts';
import { DETECTOR_VERSION, type CacheEntry } from '../src/shared/types.ts';

test('fnv1a детерминирован', () => {
  assert.equal(fnv1a('hello'), fnv1a('hello'));
  assert.notEqual(fnv1a('hello'), fnv1a('world'));
});

test('нормализация игнорирует регистр и пробелы', () => {
  assert.equal(normalizeText('  Hello   World '), 'hello world');
});

test('ключ кэша не зависит от регистра и лишних пробелов', () => {
  assert.equal(cacheKey('Hello   World'), cacheKey('hello world'));
});

test('запись актуальна только для текущей версии детектора', () => {
  const fresh = makeEntry('abc', 0.9);
  assert.ok(isFresh(fresh));

  const stale: CacheEntry = { ...fresh, version: DETECTOR_VERSION + 1 };
  assert.equal(isFresh(stale), false);
  assert.equal(isFresh(undefined), false);
});

test('pruneCache оставляет только самые свежие записи', () => {
  const map: Record<string, CacheEntry> = {};
  for (let i = 0; i < 10; i++) {
    map[`k${i}`] = { hash: `k${i}`, score: 0.5, manual: false, checkedAt: i, version: 1 };
  }

  const pruned = pruneCache(map, 3);
  assert.equal(Object.keys(pruned).length, 3);
  assert.deepEqual(Object.keys(pruned).sort(), ['k7', 'k8', 'k9']);
});

test('pruneCache не трогает кэш меньше лимита', () => {
  const map: Record<string, CacheEntry> = {
    a: makeEntry('a', 0.7),
  };
  assert.equal(pruneCache(map, 10), map);
});
