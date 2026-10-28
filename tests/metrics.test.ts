import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  calibration,
  fitTemperature,
  metrics,
  pickThreshold,
  sigmoid,
} from '../training/lib/metrics.mjs';

test('metrics считает confusion matrix и F1', () => {
  const result = metrics([0.9, 0.8, 0.2, 0.1], [1, 0, 1, 0], 0.5);
  assert.deepEqual(
    { tp: result.tp, fp: result.fp, tn: result.tn, fn: result.fn },
    { tp: 1, fp: 1, tn: 1, fn: 1 },
  );
  assert.equal(result.precision, 0.5);
  assert.equal(result.recall, 0.5);
  assert.equal(result.f1, 0.5);
});

test('pickThreshold предпочитает precision при заданном минимуме', () => {
  const picked = pickThreshold([0.95, 0.9, 0.85, 0.2, 0.1], [1, 1, 0, 1, 0], {
    minPrecision: 0.9,
  });
  assert.equal(picked.strategy, 'precision');
  assert.ok(picked.threshold >= 0.9);
  assert.equal(picked.metrics.precision, 1);
});

test('pickThreshold откатывается на F1, если precision недостижим', () => {
  const picked = pickThreshold([0.9, 0.8, 0.2, 0.1], [1, 0, 1, 0], { minPrecision: 1.1 });
  assert.equal(picked.strategy, 'f1');
  assert.ok(picked.metrics.f1 > 0);
});

test('calibration идеальных вероятностей даёт нулевой Brier', () => {
  const result = calibration([1, 0, 1, 0], [1, 0, 1, 0]);
  assert.equal(result.brier, 0);
  assert.ok(result.ece < 1e-9);
});

test('fitTemperature возвращает положительную температуру и конечный NLL', () => {
  const result = fitTemperature([4, -4, 3, -3], [1, 0, 1, 0]);
  assert.ok(result.temperature >= 0.5 && result.temperature <= 3);
  assert.ok(Number.isFinite(result.nll));
});

test('sigmoid монотонен и ограничен', () => {
  assert.ok(sigmoid(-10) < 0.001);
  assert.ok(sigmoid(10) > 0.999);
  assert.ok(sigmoid(0) === 0.5);
});
