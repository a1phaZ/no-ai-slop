import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';

import { renderControl } from '../src/content/ui.ts';

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

test('контрол с оценкой и кнопкой рисуется даже без скрытия', () => {
  const { post } = setup();
  const info = renderControl(post as unknown as HTMLElement, {
    score: 0.31,
    manual: false,
    hidden: false,
    mode: 'blur',
    onFlag: () => {},
  });

  assert.match(info.bar.textContent ?? '', /AI ~31%/);
  assert.equal(buttons(info.bar).length, 1);
  assert.equal(buttons(info.bar)[0].textContent, 'Возможно AI');
  assert.equal(post.classList.contains('nas-blur'), false);
  assert.equal(post.classList.contains('nas-hidden'), false);
});

test('режим hide скрывает пост, режим blur — размывает', () => {
  const hide = setup();
  renderControl(hide.post as unknown as HTMLElement, {
    score: 0.9,
    manual: false,
    hidden: true,
    mode: 'hide',
    onFlag: () => {},
  });
  assert.equal(hide.post.classList.contains('nas-hidden'), true);

  const blur = setup();
  renderControl(blur.post as unknown as HTMLElement, {
    score: 0.9,
    manual: false,
    hidden: true,
    mode: 'blur',
    onFlag: () => {},
  });
  assert.equal(blur.post.classList.contains('nas-blur'), true);
});

test('«Показать» снимает скрытие и убирает себя', () => {
  const { post } = setup();
  const info = renderControl(post as unknown as HTMLElement, {
    score: 0.9,
    manual: false,
    hidden: true,
    mode: 'blur',
    onFlag: () => {},
  });

  const show = buttons(info.bar).find((b) => b.textContent === 'Показать');
  assert.ok(show, 'кнопка «Показать» должна быть');
  show.click();

  assert.equal(post.classList.contains('nas-blur'), false);
  assert.equal(post.dataset.nasRevealed, '1');
  assert.equal(buttons(info.bar).some((b) => b.textContent === 'Показать'), false);
});

test('«Возможно AI» вызывает onFlag, помечает и блокирует кнопку', () => {
  const { post } = setup();
  let flags = 0;
  const info = renderControl(post as unknown as HTMLElement, {
    score: 0.9,
    manual: false,
    hidden: true,
    mode: 'blur',
    onFlag: () => {
      flags += 1;
    },
  });

  const flag = buttons(info.bar).find((b) => b.textContent === 'Возможно AI');
  assert.ok(flag, 'кнопка «Возможно AI» должна быть');
  flag.click();

  assert.equal(flags, 1);
  assert.equal(flag.disabled, true);
  assert.equal(flag.textContent, 'Помечено');
  assert.equal(info.bar.classList.contains('nas-flagged'), true);
  assert.equal(post.classList.contains('nas-blur'), false);
});

test('уже помеченный пост: кнопка в состоянии «Помечено» и неактивна', () => {
  const { post } = setup();
  const info = renderControl(post as unknown as HTMLElement, {
    score: 0.2,
    manual: true,
    hidden: false,
    mode: 'blur',
    onFlag: () => {},
  });

  const flag = buttons(info.bar)[0];
  assert.equal(flag.textContent, 'Помечено');
  assert.equal(flag.disabled, true);
});
