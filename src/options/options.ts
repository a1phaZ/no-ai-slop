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
import { DETECTOR_VERSION, type DetectorMode, type HideMode, type Settings } from '../shared/types.ts';
import { WEIGHTS } from '../detector/weights.ts';
import { NN_WEIGHTS } from '../detector/nn-weights.ts';
import { NN_MODEL_VERSION, nnAvailable } from '../detector/nn.ts';

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

function persist(patch: Partial<Settings>): Promise<Settings> {
  return saveSettings(patch).then((next) => {
    flashSaved();
    return next;
  });
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

async function renderLabelStats(settings?: Settings): Promise<void> {
  const current = settings ?? (await loadSettings());
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

  const ai = labels.filter((label) => label.label === 'ai').length;
  el('labelsAi').textContent = String(ai);
  el('labelsHuman').textContent = String(count - ai);

  const byLang: Record<string, number> = { ru: 0, en: 0, other: 0 };
  for (const label of labels) byLang[label.lang] = (byLang[label.lang] ?? 0) + 1;
  el('labelsLangs').textContent =
    `Языки: ru ${byLang.ru ?? 0} · en ${byLang.en ?? 0} · other ${byLang.other ?? 0}`;

  if (count === 0) {
    el('labelsAgreement').textContent = '—';
  } else {
    const agree = labels.filter(
      (label) => (label.label === 'ai') === (label.score >= current.threshold),
    ).length;
    el('labelsAgreement').textContent =
      `С текущим порогом ${Math.round(current.threshold * 100)}% совпадает: ` +
      `${agree} из ${count} (${Math.round((agree / count) * 100)}%)`;
  }
}

/** Карточка активной модели: версия, дата обучения, метрики и рекомендованный порог. */
function renderModelInfo(settings: Settings): void {
  const useNn = settings.detector === 'model' && nnAvailable();
  const useLinear =
    settings.detector === 'linear' || (settings.detector === 'model' && !nnAvailable());

  let name = 'Эвристики';
  let version = DETECTOR_VERSION;
  let trainedAt = '';
  let metrics: {
    accuracy: number;
    precision: number;
    recall: number;
    f1: number;
    brier?: number;
    ece?: number;
  } | null = null;
  let recommended: number | null = null;

  if (useNn) {
    name = 'Нейросеть (MLP)';
    version = NN_MODEL_VERSION;
    trainedAt = NN_WEIGHTS.trainedAt;
    metrics = NN_WEIGHTS.metrics;
    recommended = NN_WEIGHTS.threshold;
  } else if (useLinear) {
    name = 'Линейная модель';
    version = WEIGHTS.version;
    trainedAt = WEIGHTS.trainedAt;
    metrics = WEIGHTS.metrics;
    recommended = WEIGHTS.threshold;
  }

  el('modelName').textContent = `${name} · v${version}`;
  el('modelTrained').textContent = trainedAt
    ? `Обучена: ${new Date(trainedAt).toLocaleString('ru-RU')}`
    : 'Правила, без обучения';

  if (metrics) {
    const pct = (value: number) => `${Math.round(value * 100)}%`;
    const calibration = [
      metrics.brier === undefined ? '' : `Brier ${metrics.brier.toFixed(3)}`,
      metrics.ece === undefined ? '' : `ECE ${metrics.ece.toFixed(3)}`,
    ]
      .filter(Boolean)
      .join(' · ');
    el('modelMetrics').textContent =
      `test: acc ${pct(metrics.accuracy)} · prec ${pct(metrics.precision)} · ` +
      `rec ${pct(metrics.recall)} · F1 ${pct(metrics.f1)}` +
      (calibration ? ` · ${calibration}` : '');
  } else {
    el('modelMetrics').textContent = 'Метрики не применимы к эвристикам';
  }

  const current = `в настройках ${Math.round(settings.threshold * 100)}%`;
  el('modelThreshold').textContent =
    recommended === null
      ? `Порог: ${current}`
      : `Рекомендуемый порог: ${Math.round(recommended * 100)}% · ${current}`;
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

  renderModelInfo(settings);
  await renderLabelStats(settings);
}

function wire(): void {
  el<HTMLInputElement>('enabled').addEventListener('change', (e) => {
    persist({ enabled: (e.target as HTMLInputElement).checked });
  });

  el<HTMLSelectElement>('mode').addEventListener('change', (e) => {
    persist({ mode: (e.target as HTMLSelectElement).value as HideMode });
  });

  el<HTMLSelectElement>('detector').addEventListener('change', (e) => {
    void persist({ detector: (e.target as HTMLSelectElement).value as DetectorMode }).then(
      (next) => {
        renderModelInfo(next);
        void renderLabelStats(next);
      },
    );
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
    void persist({ threshold: Number(range.value) / 100 }).then((next) => {
      void renderLabelStats(next);
    });
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
