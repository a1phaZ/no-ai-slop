import type { HideMode } from '../shared/types.ts';

export interface ControlOptions {
  /** Оценка AI-вероятности 0..1. */
  score: number;
  /** Пост уже помечен вручную. */
  manual: boolean;
  /** Оценка выше порога — пост нужно заблюрить/скрыть. */
  hidden: boolean;
  mode: HideMode;
  onFlag: () => void;
}

export interface Applied {
  bar: HTMLElement;
  /** Переприменить режим скрытия (после смены настроек). */
  applyHidden: () => void;
  remove: () => void;
}

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
 * Рисует контрол под постом: оценку и кнопку «Возможно AI».
 * Если пост выше порога — дополнительно размывает/скрывает его.
 */
export function renderControl(el: HTMLElement, opts: ControlOptions): Applied {
  const bar = document.createElement('div');
  bar.className = 'nas-bar';

  const score = document.createElement('span');
  score.className = 'nas-score';
  score.textContent = `AI ~${Math.round(opts.score * 100)}%`;

  const clearHidden = () => el.classList.remove('nas-blur', 'nas-hidden');
  const applyHidden = () => {
    if (el.dataset.nasRevealed === '1') return;
    el.classList.toggle('nas-hidden', opts.mode === 'hide');
    el.classList.toggle('nas-blur', opts.mode === 'blur');
  };

  const reveal = () => {
    clearHidden();
    el.dataset.nasRevealed = '1';
  };

  bar.append(score);

  if (opts.hidden) {
    const show = button('Показать', () => {
      reveal();
      show.remove();
    });
    bar.append(show);
  }

  const flag = button(opts.manual ? 'Помечено' : 'Возможно AI', () => {
    reveal();
    flag.disabled = true;
    flag.textContent = 'Помечено';
    bar.classList.add('nas-flagged');
    opts.onFlag();
  });
  flag.disabled = opts.manual;
  if (opts.manual) bar.classList.add('nas-flagged');
  bar.append(flag);

  el.parentElement?.insertBefore(bar, el);
  if (opts.hidden) applyHidden();

  return {
    bar,
    applyHidden,
    remove: () => {
      clearHidden();
      bar.remove();
    },
  };
}
