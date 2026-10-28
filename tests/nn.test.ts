import { test } from 'node:test';
import assert from 'node:assert/strict';

import { extractFeatures } from '../src/detector/features.ts';
import { detect, modelIdFor } from '../src/detector/index.ts';
import { NN_WEIGHTS } from '../src/detector/nn-weights.ts';
import { nnAvailable, nnModelId, predictNN } from '../src/detector/nn.ts';
import { FEATURE_NAMES } from '../src/detector/vector.ts';
import type { NnWeights } from '../src/detector/nn-types.ts';

const AI_TEXT =
  "In today's fast-paced world, building reliable software requires discipline. " +
  "It's important to note that consistency compounds over time. " +
  'Furthermore, clear documentation reduces future maintenance costs. ' +
  'In conclusion, invest deliberately in the systems you depend on.';

const HUMAN_TEXT =
  "lol i tried this last night tbh. it kinda worked but setup was a pain. " +
  "gonna mess with it tomorrow, idk if it's worth the price though";

test('NN доступна и размерности согласованы', () => {
  assert.ok(NN_WEIGHTS.version > 0);
  assert.ok(nnAvailable());
  assert.equal(NN_WEIGHTS.features.length, FEATURE_NAMES.length);
  assert.equal(NN_WEIGHTS.mean.length, FEATURE_NAMES.length);
  assert.equal(NN_WEIGHTS.std.length, FEATURE_NAMES.length);
  assert.equal(NN_WEIGHTS.w1.length, NN_WEIGHTS.hidden);
  assert.equal(NN_WEIGHTS.w2.length, NN_WEIGHTS.hidden);
  assert.ok(NN_WEIGHTS.w1.every((row) => row.length === FEATURE_NAMES.length));
});

test('predictNN возвращает оценку 0..1 и сигналы по убыванию вклада', () => {
  for (const text of [AI_TEXT, HUMAN_TEXT, '', 'ok']) {
    const { score, signals } = predictNN(extractFeatures(text));
    assert.ok(score >= 0 && score <= 1, `score=${score}`);
    assert.ok(signals.length > 0);
    for (let i = 1; i < signals.length; i++) {
      assert.ok(Math.abs(signals[i - 1].weight) >= Math.abs(signals[i].weight));
    }
  }
});

test('NN ранжирует AI-текст выше человеческого', () => {
  const ai = predictNN(extractFeatures(AI_TEXT)).score;
  const human = predictNN(extractFeatures(HUMAN_TEXT)).score;
  assert.ok(ai > human, `${ai} <= ${human}`);
  assert.ok(ai >= 0.5, `AI score=${ai}`);
  assert.ok(human < 0.5, `human score=${human}`);
});

test('nnAvailable ложно при несовпадающих размерностях', () => {
  const broken: NnWeights = { ...NN_WEIGHTS, w2: [1, 2, 3] };
  assert.equal(nnAvailable(broken), false);
});

test('modelIdFor выбирает модель по режиму', () => {
  assert.equal(modelIdFor('model'), nnModelId());
  assert.match(modelIdFor('linear'), /^linear@\d+$/);
  assert.match(modelIdFor('heuristics'), /^heuristic@\d+$/);
});

test('detect прокидывает modelId активной модели', () => {
  assert.equal(detect(AI_TEXT, 'model').modelId, nnModelId());
  assert.match(detect(AI_TEXT, 'linear').modelId, /^linear@\d+$/);
  assert.match(detect(AI_TEXT, 'heuristics').modelId, /^heuristic@\d+$/);
});

test('линейный режим не использует NN', () => {
  const result = detect(AI_TEXT, 'linear');
  assert.equal(result.source, 'model');
  assert.notEqual(result.modelId, nnModelId());
});
