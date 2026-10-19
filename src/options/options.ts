import { loadSettings, saveSettings } from '../shared/settings.ts';
import {
  LABELS_MAX,
  loadLabels,
  loadStats,
  mergeLabels,
  saveLabels,
  saveStats,
} from '../shared/storage.ts';
import { exportFilename, labelsToJsonl, parseLabels } from '../shared/labels.ts';
import type { DetectorMode, HideMode, Settings } from '../shared/types.ts';

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

let statusTimer: number | undefined;

function setStatus(message: string, isError = false): void {
  const status = el('labelsStatus');
  status.textContent = message;
  status.classList.toggle('error', isError);
  status.hidden = false;
  if (statusTimer !== undefined) window.clearTimeout(statusTimer);
  statusTimer = window.setTimeout(() => {
    status.hidden = true;
  }, 4000);
}

async function renderLabelStats(): Promise<void> {
  const labels = await loadLabels();
  const count = labels.length;
  el('labelsCount').textContent = String(count);
  el('labelsMax').textContent = String(LABELS_MAX);

  const progress = el<HTMLProgressElement>('labelsProgress');
  progress.max = LABELS_MAX;
  progress.value = count;

  const ratio = count / LABELS_MAX;
  el('labelsWarning').hidden = ratio < 1;
  el('labelsHint').hidden = ratio < 0.8 || ratio >= 1;
}

function download(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'application/x-ndjson' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function exportLabels(): Promise<void> {
  const labels = await loadLabels();
  if (labels.length === 0) {
    setStatus('Меток пока нет — нечего экспортировать.', true);
    return;
  }
  download(labelsToJsonl(labels), exportFilename(new Date()));
  setStatus(`Экспортировано меток: ${labels.length}.`);
}

async function importLabels(file: File): Promise<void> {
  const text = await file.text();
  const incoming = parseLabels(text);
  if (incoming.length === 0) {
    setStatus('В файле не найдено корректных меток.', true);
    return;
  }
  const merged = mergeLabels(await loadLabels(), incoming);
  await saveLabels(merged);
  await syncStats(merged);
  await renderLabelStats();
  setStatus(`Импортировано: ${incoming.length}, всего: ${merged.length}.`);
}

/** Пересчитывает счётчики меток, не трогая hidden/scanned. */
async function syncStats(labels: { label: 'ai' | 'human' }[]): Promise<void> {
  const stats = await loadStats();
  await saveStats({
    ...stats,
    labeled: labels.length,
    manual: labels.filter((l) => l.label === 'ai').length,
  });
}

async function clearLabels(): Promise<void> {
  const labels = await loadLabels();
  if (labels.length === 0) {
    setStatus('Меток нет.');
    return;
  }
  if (!window.confirm(`Удалить все метки (${labels.length})? Действие необратимо.`)) return;
  await saveLabels([]);
  await syncStats([]);
  await renderLabelStats();
  setStatus('Метки удалены.');
}

async function render(): Promise<void> {
  const settings = await loadSettings();

  el<HTMLInputElement>('enabled').checked = settings.enabled;
  el<HTMLSelectElement>('mode').value = settings.mode;
  el<HTMLSelectElement>('detector').value = settings.detector;
  el<HTMLInputElement>('scanOldReddit').checked = settings.scanOldReddit;
  el<HTMLInputElement>('debug').checked = settings.debug;

  const range = el<HTMLInputElement>('threshold');
  range.value = String(Math.round(settings.threshold * 100));
  el('thresholdValue').textContent = `${Math.round(settings.threshold * 100)}%`;

  await renderLabelStats();
}

function wire(): void {
  el<HTMLInputElement>('enabled').addEventListener('change', (e) => {
    persist({ enabled: (e.target as HTMLInputElement).checked });
  });

  el<HTMLSelectElement>('mode').addEventListener('change', (e) => {
    persist({ mode: (e.target as HTMLSelectElement).value as HideMode });
  });

  el<HTMLSelectElement>('detector').addEventListener('change', (e) => {
    persist({ detector: (e.target as HTMLSelectElement).value as DetectorMode });
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

  el<HTMLButtonElement>('exportLabels').addEventListener('click', () => {
    void exportLabels();
  });

  const fileInput = el<HTMLInputElement>('importFile');
  el<HTMLButtonElement>('importLabels').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (file) void importLabels(file);
  });

  el<HTMLButtonElement>('clearLabels').addEventListener('click', () => {
    void clearLabels();
  });
}

wire();
void render();
