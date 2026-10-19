import { test } from 'node:test';
import assert from 'node:assert/strict';

import { extractFeatures } from '../src/detector/features.ts';
import { FEATURE_NAMES, toVector } from '../src/detector/vector.ts';
import { modelAvailable, predictModel } from '../src/detector/model.ts';
import { WEIGHTS } from '../src/detector/weights.ts';
import type { ModelWeights } from '../src/detector/model-types.ts';

const AI_TEXT =
  "In today's fast-paced world, building reliable software requires discipline. " +
  "It's important to note that consistency compounds over time. " +
  'Furthermore, clear documentation reduces future maintenance costs. ' +
  'In conclusion, invest deliberately in the systems you depend on.';

const HUMAN_TEXT =
  "lol i tried this last night tbh. it kinda worked but setup was a pain. " +
  "gonna mess with it tomorrow, idk if it's worth the price though";

test('вектор признаков согласован с именами', () => {
  const vector = toVector(extractFeatures(HUMAN_TEXT));
  assert.equal(vector.length, FEATURE_NAMES.length);
  assert.ok(vector.every((v) => Number.isFinite(v)), 'вектор должен быть из чисел');
});

test('обученная модель доступна и размерности согласованы', () => {
  assert.ok(WEIGHTS.version > 0, 'модель должна быть обучена');
  assert.ok(modelAvailable());
  assert.equal(WEIGHTS.features.length, FEATURE_NAMES.length);
  assert.equal(WEIGHTS.weights.length, FEATURE_NAMES.length);
  assert.equal(WEIGHTS.mean.length, FEATURE_NAMES.length);
  assert.equal(WEIGHTS.std.length, FEATURE_NAMES.length);
});

test('predictModel возвращает оценку в диапазоне 0..1', () => {
  for (const text of [AI_TEXT, HUMAN_TEXT, '', 'ok']) {
    const { score } = predictModel(extractFeatures(text));
    assert.ok(score >= 0 && score <= 1, `score=${score}`);
  }
});

test('модель ранжирует AI-текст выше человеческого', () => {
  const ai = predictModel(extractFeatures(AI_TEXT)).score;
  const human = predictModel(extractFeatures(HUMAN_TEXT)).score;
  assert.ok(ai > human, `${ai} <= ${human}`);
  assert.ok(ai >= 0.5, `AI score=${ai}`);
  assert.ok(human < 0.5, `human score=${human}`);
});

test('predictModel отдаёт признаки-вклады в порядке убывания вклада', () => {
  const { signals } = predictModel(extractFeatures(AI_TEXT));
  assert.ok(signals.length > 0);
  for (let i = 1; i < signals.length; i++) {
    assert.ok(Math.abs(signals[i - 1].weight) >= Math.abs(signals[i].weight));
  }
});

test('modelAvailable ложно при несовпадающих размерностях', () => {
  const broken: ModelWeights = { ...WEIGHTS, weights: [1, 2, 3] };
  assert.equal(modelAvailable(broken), false);
});

test('веса содержат метрики обучения', () => {
  assert.ok(WEIGHTS.metrics.n > 0);
  assert.ok(WEIGHTS.metrics.accuracy >= 0 && WEIGHTS.metrics.accuracy <= 1);
  assert.ok(WEIGHTS.metrics.f1 >= 0 && WEIGHTS.metrics.f1 <= 1);
});
