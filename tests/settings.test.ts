import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeSettings } from '../src/shared/settings.ts';
import { DEFAULT_SETTINGS, type DetectorMode } from '../src/shared/types.ts';

test('normalizeSettings сохраняет linear', () => {
  assert.equal(normalizeSettings({ detector: 'linear' }).detector, 'linear');
});

test('normalizeSettings сохраняет heuristics и model', () => {
  assert.equal(normalizeSettings({ detector: 'heuristics' }).detector, 'heuristics');
  assert.equal(normalizeSettings({ detector: 'model' }).detector, 'model');
});

test('normalizeSettings заменяет неизвестный детектор на model', () => {
  assert.equal(
    normalizeSettings({ detector: 'nonsense' as unknown as DetectorMode }).detector,
    'model',
  );
});

test('normalizeSettings ограничивает порог диапазоном 0..1', () => {
  assert.equal(normalizeSettings({ threshold: -1 }).threshold, 0);
  assert.equal(normalizeSettings({ threshold: 2 }).threshold, 1);
  assert.equal(normalizeSettings({ threshold: Number.NaN }).threshold, DEFAULT_SETTINGS.threshold);
});
