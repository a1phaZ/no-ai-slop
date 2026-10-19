import { loadSettings, saveSettings } from '../shared/settings.ts';
import type { HideMode, Settings } from '../shared/types.ts';

function el<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`element #${id} not found`);
  return found as T;
}

let savedTimer: number | undefined;

function flashSaved(): void {
  const badge = el('saved');
  badge.hidden = false;
  if (savedTimer !== undefined) window.clearTimeout(savedTimer);
  savedTimer = window.setTimeout(() => {
    badge.hidden = true;
  }, 1500);
}

function persist(patch: Partial<Settings>): void {
  void saveSettings(patch).then(flashSaved);
}

async function render(): Promise<void> {
  const settings = await loadSettings();

  el<HTMLInputElement>('enabled').checked = settings.enabled;
  el<HTMLSelectElement>('mode').value = settings.mode;
  el<HTMLInputElement>('scanOldReddit').checked = settings.scanOldReddit;
  el<HTMLInputElement>('debug').checked = settings.debug;

  const range = el<HTMLInputElement>('threshold');
  range.value = String(Math.round(settings.threshold * 100));
  el('thresholdValue').textContent = `${Math.round(settings.threshold * 100)}%`;
}

function wire(): void {
  el<HTMLInputElement>('enabled').addEventListener('change', (e) => {
    persist({ enabled: (e.target as HTMLInputElement).checked });
  });

  el<HTMLSelectElement>('mode').addEventListener('change', (e) => {
    persist({ mode: (e.target as HTMLSelectElement).value as HideMode });
  });

  el<HTMLInputElement>('scanOldReddit').addEventListener('change', (e) => {
    persist({ scanOldReddit: (e.target as HTMLInputElement).checked });
  });

  el<HTMLInputElement>('debug').addEventListener('change', (e) => {
    persist({ debug: (e.target as HTMLInputElement).checked });
  });

  const range = el<HTMLInputElement>('threshold');
  range.addEventListener('input', () => {
    el('thresholdValue').textContent = `${range.value}%`;
  });
  range.addEventListener('change', () => {
    persist({ threshold: Number(range.value) / 100 });
  });
}

wire();
void render();
