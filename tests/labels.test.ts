import { test } from 'node:test';
import assert from 'node:assert/strict';

import { mergeLabels, upsertLabel } from '../src/shared/storage.ts';
import { buildLabelEntry, detectLang, exportFilename, labelsToJsonl, parseLabels } from '../src/shared/labels.ts';
import type { LabelEntry } from '../src/shared/types.ts';

function make(hash: string, label: 'ai' | 'human' = 'ai', createdAt = 1): LabelEntry {
  return buildLabelEntry(
    {
      hash,
      title: 't',
      text: 'body',
      label,
      score: 0.7,
      detectorVersion: 3,
      modelVersion: 1,
    },
    createdAt,
  );
}

test('detectLang распознаёт русский и английский', () => {
  assert.equal(detectLang('Привет, как дела?'), 'ru');
  assert.equal(detectLang('hello, how are you?'), 'en');
  assert.equal(detectLang('123 !!!'), 'other');
});

test('buildLabelEntry заполняет язык и длину', () => {
  const entry = make('abc');
  assert.equal(entry.hash, 'abc');
  assert.equal(entry.label, 'ai');
  assert.equal(entry.lang, 'en');
  assert.equal(entry.length, 4);
  assert.equal(entry.createdAt, 1);
});

test('upsertLabel добавляет новую метку', () => {
  const result = upsertLabel([], make('a'));
  assert.equal(result.ok, true);
  assert.equal(result.labels.length, 1);
  assert.equal(result.added, true);
});

test('upsertLabel заменяет существующую метку по хэшу', () => {
  const first = upsertLabel([], make('a', 'ai', 1));
  assert.ok(first.ok);
  const second = upsertLabel(first.labels, make('a', 'human', 2), 'human');
  assert.ok(second.ok);
  assert.equal(second.labels.length, 1);
  assert.equal(second.added, false);
  assert.equal(second.labels[0].label, 'human');
});

test('upsertLabel с value=null снимает метку', () => {
  const added = upsertLabel([], make('a'));
  assert.ok(added.ok);
  const removed = upsertLabel(added.labels, make('a'), null);
  assert.ok(removed.ok);
  assert.equal(removed.labels.length, 0);
});

test('upsertLabel блокирует новую метку при лимите, но позволяет правку', () => {
  const full = [make('a'), make('b')];

  const rejected = upsertLabel(full, make('c'), 'ai', 2);
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.equal(rejected.reason, 'limit');

  const edited = upsertLabel(full, make('a', 'human'), 'human', 2);
  assert.equal(edited.ok, true);
  assert.equal(edited.labels.length, 2);
});

test('mergeLabels: побеждает более свежая метка', () => {
  const current = [make('a', 'ai', 10), make('b', 'human', 10)];
  const incoming = [make('a', 'human', 20), make('c', 'ai', 20)];

  const merged = mergeLabels(current, incoming);
  assert.equal(merged.length, 3);
  assert.equal(merged.find((l) => l.hash === 'a')?.label, 'human');
});

test('mergeLabels игнорирует мусор', () => {
  const merged = mergeLabels([], [{ nope: true } as unknown as LabelEntry]);
  assert.equal(merged.length, 0);
});

test('mergeLabels соблюдает лимит', () => {
  const current = [make('a', 'ai', 1), make('b', 'ai', 2), make('c', 'ai', 3)];
  const merged = mergeLabels([], current, 2);
  assert.equal(merged.length, 2);
  assert.deepEqual(merged.map((l) => l.hash), ['b', 'c']);
});

test('JSONL: сериализация и обратный разбор', () => {
  const labels = [make('a', 'ai'), make('b', 'human')];
  const jsonl = labelsToJsonl(labels);
  assert.equal(jsonl.trim().split('\n').length, 2);

  const parsed = parseLabels(jsonl);
  assert.equal(parsed.length, 2);
  assert.deepEqual(parsed.map((l) => l.label), ['ai', 'human']);
});

test('parseLabels понимает JSON-массив и пропускает битые строки', () => {
  const labels = [make('a')];
  const arrayForm = parseLabels(JSON.stringify(labels));
  assert.equal(arrayForm.length, 1);

  const mixed = parseLabels(`${JSON.stringify(make('a'))}\n{ broken\n${JSON.stringify(make('b'))}`);
  assert.equal(mixed.length, 2);

  assert.deepEqual(parseLabels(''), []);
  assert.deepEqual(parseLabels('не json'), []);
});

test('exportFilename содержит дату', () => {
  const name = exportFilename(new Date(2026, 9, 19));
  assert.equal(name, 'no-ai-slop-labels-20261019.jsonl');
});
