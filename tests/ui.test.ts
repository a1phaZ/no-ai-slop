import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';

import { renderControl } from '../src/content/ui.ts';
import type { LabelValue } from '../src/shared/types.ts';

function setup() {
  const window = new Window();
  const g = globalThis as unknown as { document: unknown; window: unknown };
  g.document = window.document;
  g.window = window;

  const post = window.document.createElement('div');
  post.id = 'post';
  window.document.body.append(post);
  return { window, post };
}

function buttons(bar: unknown): HTMLButtonElement[] {
  return Array.from((bar as HTMLElement).querySelectorAll('button'));
}

function labelButton(bar: unknown, text: string): HTMLButtonElement | undefined {
  return buttons(bar).find((b) => b.textContent === text);
}

function render(
  post: HTMLElement,
  overrides: Partial<Parameters<typeof renderControl>[1]> = {},
  seen: Array<LabelValue | null> = [],
  hiddenAfter: boolean | null = null,
) {
  return renderControl(post, {
    score: 0.31,
    label: null,
    hidden: false,
    mode: 'blur',
    onLabel: (value) => {
      seen.push(value);
      return { ok: true, hidden: hiddenAfter ?? false };
    },
    ...overrides,
  });
}

test('контрол рисует оценку и две кнопки разметки', () => {
  const { post } = setup();
  const info = render(post as unknown as HTMLElement);

  assert.match(info.bar.textContent ?? '', /AI ~31%/);
  assert.ok(labelButton(info.bar, 'Похоже на ИИ'));
  assert.ok(labelButton(info.bar, 'Похоже, человек'));
  assert.equal(post.classList.contains('nas-blur'), false);
});

test('режим hide скрывает пост, режим blur — размывает', () => {
  const hide = setup();
  render(hide.post as unknown as HTMLElement, { score: 0.9, hidden: true, mode: 'hide' });
  assert.equal(hide.post.classList.contains('nas-hidden'), true);

  const blur = setup();
  render(blur.post as unknown as HTMLElement, { score: 0.9, hidden: true, mode: 'blur' });
  assert.equal(blur.post.classList.contains('nas-blur'), true);
});

test('«Показать» снимает скрытие и убирает себя', () => {
  const { post } = setup();
  const info = render(post as unknown as HTMLElement, { score: 0.9, hidden: true });

  const show = labelButton(info.bar, 'Показать');
  assert.ok(show, 'кнопка «Показать» должна быть');
  show.click();

  assert.equal(post.classList.contains('nas-blur'), false);
  assert.equal(post.dataset.nasRevealed, '1');
  assert.equal(labelButton(info.bar, 'Показать'), undefined);
});

test('«Показать» не создаёт метку', () => {
  const { post } = setup();
  const seen: Array<LabelValue | null> = [];
  const info = render(post as unknown as HTMLElement, { score: 0.9, hidden: true }, seen);

  labelButton(info.bar, 'Показать')?.click();
  assert.deepEqual(seen, []);
});

test('клик по «Похоже на ИИ» ставит метку и подсвечивает кнопку', () => {
  const { post } = setup();
  const seen: Array<LabelValue | null> = [];
  const info = render(post as unknown as HTMLElement, {}, seen);

  labelButton(info.bar, 'Похоже на ИИ')?.click();

  assert.deepEqual(seen, ['ai']);
  assert.equal(labelButton(info.bar, 'Похоже на ИИ')?.getAttribute('aria-pressed'), 'true');
  assert.equal(labelButton(info.bar, 'Похоже, человек')?.getAttribute('aria-pressed'), 'false');
  assert.equal(info.bar.classList.contains('nas-flagged'), true);
});

test('кнопки взаимоисключающие', () => {
  const { post } = setup();
  const seen: Array<LabelValue | null> = [];
  const info = render(post as unknown as HTMLElement, {}, seen);

  labelButton(info.bar, 'Похоже на ИИ')?.click();
  labelButton(info.bar, 'Похоже, человек')?.click();

  assert.deepEqual(seen, ['ai', 'human']);
  assert.equal(labelButton(info.bar, 'Похоже на ИИ')?.getAttribute('aria-pressed'), 'false');
  assert.equal(labelButton(info.bar, 'Похоже, человек')?.getAttribute('aria-pressed'), 'true');
  assert.equal(info.bar.classList.contains('nas-human'), true);
  assert.equal(info.bar.classList.contains('nas-flagged'), false);
});

test('повторный клик снимает метку', () => {
  const { post } = setup();
  const seen: Array<LabelValue | null> = [];
  const info = render(post as unknown as HTMLElement, {}, seen);

  labelButton(info.bar, 'Похоже на ИИ')?.click();
  labelButton(info.bar, 'Похоже на ИИ')?.click();

  assert.deepEqual(seen, ['ai', null]);
  assert.equal(labelButton(info.bar, 'Похоже на ИИ')?.getAttribute('aria-pressed'), 'false');
});

test('пост с готовой меткой отрисован в нужном состоянии', () => {
  const { post } = setup();
  const info = render(post as unknown as HTMLElement, { label: 'human' });

  assert.equal(labelButton(info.bar, 'Похоже, человек')?.getAttribute('aria-pressed'), 'true');
  assert.equal(info.bar.classList.contains('nas-human'), true);
});

test('если сохранение не удалось, состояние кнопок не меняется', () => {
  const { post } = setup();
  const info = renderControl(post as unknown as HTMLElement, {
    score: 0.2,
    label: null,
    hidden: false,
    mode: 'blur',
    onLabel: () => ({ ok: false, hidden: false }),
  });

  labelButton(info.bar, 'Похоже на ИИ')?.click();
  assert.equal(labelButton(info.bar, 'Похоже на ИИ')?.getAttribute('aria-pressed'), 'false');
});

test('метка «человек» показывает заблюренный пост', () => {
  const { post } = setup();
  const seen: Array<LabelValue | null> = [];
  const info = render(post as unknown as HTMLElement, { score: 0.9, hidden: true }, seen, false);

  labelButton(info.bar, 'Похоже, человек')?.click();
  assert.equal(post.classList.contains('nas-blur'), false);
});

test('метка «ИИ» скрывает видимый пост, если решение изменилось', () => {
  const { post } = setup();
  const seen: Array<LabelValue | null> = [];
  const info = render(post as unknown as HTMLElement, { score: 0.6, hidden: false }, seen, true);

  labelButton(info.bar, 'Похоже на ИИ')?.click();
  assert.equal(post.classList.contains('nas-blur'), true);
});
