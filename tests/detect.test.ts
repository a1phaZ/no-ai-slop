import { test } from 'node:test';
import assert from 'node:assert/strict';

import { detect } from '../src/detector/index.ts';

const AI_TEXT =
  "In today's fast-paced world, building reliable software requires discipline. " +
  "It's important to note that consistency compounds over time. " +
  'Furthermore, clear documentation reduces future maintenance costs. ' +
  'In conclusion, invest deliberately in the systems you depend on.';

const HUMAN_TEXT =
  'honestly idk why people still use this. it is slow as hell and the ui makes no sense';

test('режим heuristics даёт источник heuristic', () => {
  const result = detect(HUMAN_TEXT, 'heuristics');
  assert.equal(result.source, 'heuristic');
  assert.ok(result.version > 0);
});

test('режим model даёт источник model', () => {
  const result = detect(HUMAN_TEXT, 'model');
  assert.equal(result.source, 'model');
});

test('оба режима разделяют AI и человеческий текст', () => {
  for (const mode of ['model', 'heuristics'] as const) {
    const ai = detect(AI_TEXT, mode).score;
    const human = detect(HUMAN_TEXT, mode).score;
    assert.ok(ai > human, `${mode}: ${ai} <= ${human}`);
  }
});

test('detect возвращает непустые признаки и длину текста', () => {
  const result = detect(AI_TEXT, 'model');
  assert.ok(result.signals.length > 0);
  assert.equal(result.textLength, AI_TEXT.length);
});

test('пустой текст не даёт высокой оценки', () => {
  assert.ok(detect('', 'model').score < 0.5);
  assert.ok(detect('', 'heuristics').score < 0.5);
});
