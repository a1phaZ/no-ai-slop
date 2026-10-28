import type { HideMode, LabelValue } from '../shared/types.ts';

export interface ControlOptions {
  /** Оценка AI-вероятности 0..1. */
  score: number;
  /** Текущая метка пользователя, если есть. */
  label: LabelValue | null;
  /** Оценка выше порога — пост нужно заблюрить/скрыть. */
  hidden: boolean;
  mode: HideMode;
  /**
   * Элемент, который размывается/скрывается (тело поста, медиа-превью).
   * `null` — скрывать нечего, заголовок не трогаем.
   * Не задан — сам пост (обратная совместимость).
   */
  target?: HTMLElement | null;
  /**
   * null — метка снята повторным кликом.
   * ok=false — сохранить не удалось (например, лимит), состояние не меняем.
   */
  onLabel: (value: LabelValue | null) => { ok: boolean; hidden: boolean };
}

export interface Applied {
  bar: HTMLElement;
  /** Переприменить скрытие с новым решением (после смены настроек или метки). */
  setHidden: (hidden: boolean) => void;
  remove: () => void;
}

const LABELS: Record<LabelValue, string> = {
  ai: 'Похоже на ИИ',
  human: 'Похоже, человек',
};

function button(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    onClick();
  });
  return b;
}

/**
 * Рисует контрол под постом: оценку и две кнопки разметки.
 * Если пост выше порога — дополнительно размывает/скрывает его.
 */
export function renderControl(el: HTMLElement, opts: ControlOptions): Applied {
  const bar = document.createElement('div');
  bar.className = 'nas-bar';

  const score = document.createElement('span');
  score.className = 'nas-score';
  score.textContent = `AI ~${Math.round(opts.score * 100)}%`;

  const target = opts.target === undefined ? el : opts.target;

  let hidden = opts.hidden;
  let revealed = el.dataset.nasRevealed === '1';

  const clearHidden = () => target?.classList.remove('nas-blur', 'nas-hidden');
  const applyHidden = () => {
    if (!hidden || revealed || !target) {
      clearHidden();
      return;
    }
    target.classList.toggle('nas-hidden', opts.mode === 'hide');
    target.classList.toggle('nas-blur', opts.mode === 'blur');
  };

  const reveal = () => {
    revealed = true;
    el.dataset.nasRevealed = '1';
    clearHidden();
  };

  bar.append(score);

  if (opts.hidden && target) {
    const show = button('Показать', () => {
      reveal();
      show.remove();
    });
    bar.append(show);
  }

  let current = opts.label;
  const buttons = {} as Record<LabelValue, HTMLButtonElement>;

  const paint = () => {
    for (const value of ['ai', 'human'] as LabelValue[]) {
      buttons[value].setAttribute('aria-pressed', String(current === value));
    }
    bar.classList.toggle('nas-flagged', current === 'ai');
    bar.classList.toggle('nas-human', current === 'human');
  };

  const setLabel = (value: LabelValue) => {
    const next = current === value ? null : value;
    const result = opts.onLabel(next);
    if (!result.ok) return;
    current = next;
    hidden = result.hidden;
    paint();
    applyHidden();
    if (current === 'human') reveal();
  };

  for (const value of ['ai', 'human'] as LabelValue[]) {
    const b = button(LABELS[value], () => setLabel(value));
    b.className = `nas-label nas-label-${value}`;
    buttons[value] = b;
    bar.append(b);
  }

  paint();
  el.parentElement?.insertBefore(bar, el);
  applyHidden();

  return {
    bar,
    setHidden: (next) => {
      hidden = next;
      applyHidden();
    },
    remove: () => {
      clearHidden();
      bar.remove();
    },
  };
}
