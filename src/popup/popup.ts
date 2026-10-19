import { loadSettings, saveSettings } from '../shared/settings.ts';
import { sendMessage, type StatsResponse } from '../shared/messages.ts';
import type { HideMode } from '../shared/types.ts';

function el<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`element #${id} not found`);
  return found as T;
}

async function refreshStats(): Promise<void> {
  const response = await sendMessage<StatsResponse>({ type: 'stats:get' });
  if (!response) return;
  el('hidden').textContent = String(response.stats.hidden);
  el('labeled').textContent = String(response.stats.labeled);
  el('scanned').textContent = String(response.stats.scanned);
}

async function render(): Promise<void> {
  const settings = await loadSettings();

  el<HTMLInputElement>('enabled').checked = settings.enabled;
  el<HTMLSelectElement>('mode').value = settings.mode;

  const range = el<HTMLInputElement>('threshold');
  range.value = String(Math.round(settings.threshold * 100));
  el('thresholdValue').textContent = `${Math.round(settings.threshold * 100)}%`;

  await refreshStats();
}

function wire(): void {
  el<HTMLInputElement>('enabled').addEventListener('change', (e) => {
    void saveSettings({ enabled: (e.target as HTMLInputElement).checked });
  });

  el<HTMLSelectElement>('mode').addEventListener('change', (e) => {
    void saveSettings({ mode: (e.target as HTMLSelectElement).value as HideMode });
  });

  const range = el<HTMLInputElement>('threshold');
  range.addEventListener('input', () => {
    el('thresholdValue').textContent = `${range.value}%`;
  });
  range.addEventListener('change', () => {
    void saveSettings({ threshold: Number(range.value) / 100 });
  });

  el<HTMLButtonElement>('reset').addEventListener('click', () => {
    void sendMessage({ type: 'stats:reset' }).then(refreshStats);
  });

  el<HTMLButtonElement>('options').addEventListener('click', () => {
    void chrome.runtime.openOptionsPage?.();
  });
}

wire();
void render();
