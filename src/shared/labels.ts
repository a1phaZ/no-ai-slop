import type { LabelEntry, LabelLanguage, LabelValue } from './types.ts';

/** Доля кириллицы/латиницы среди букв — достаточный сигнал для языка поста. */
export function detectLang(text: string): LabelLanguage {
  const cyrillic = (text.match(/[а-яё]/gi) ?? []).length;
  const latin = (text.match(/[a-z]/gi) ?? []).length;
  const total = cyrillic + latin;
  if (total === 0) return 'other';
  if (cyrillic / total >= 0.3) return 'ru';
  if (latin / total >= 0.3) return 'en';
  return 'other';
}

export interface LabelInput {
  hash: string;
  title: string;
  text: string;
  label: LabelValue;
  score: number;
  detectorVersion: number;
  modelVersion: number;
  modelId?: string;
}

export function buildLabelEntry(input: LabelInput, createdAt = Date.now()): LabelEntry {
  return {
    hash: input.hash,
    title: input.title,
    text: input.text,
    label: input.label,
    score: input.score,
    detectorVersion: input.detectorVersion,
    modelVersion: input.modelVersion,
    modelId: input.modelId,
    lang: detectLang(`${input.title}\n${input.text}`),
    length: input.text.length,
    createdAt,
  };
}

/** Одна метка — одна строка JSON (JSONL) для последующего импорта в датасет. */
export function labelsToJsonl(labels: LabelEntry[]): string {
  return labels.map((label) => JSON.stringify(label)).join('\n') + (labels.length ? '\n' : '');
}

/** Принимает JSONL или JSON-массив; некорректные строки молча пропускает. */
export function parseLabels(text: string): LabelEntry[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      return Array.isArray(parsed) ? parsed.filter(isLabelEntry) : [];
    } catch {
      return [];
    }
  }

  const result: LabelEntry[] = [];
  for (const line of trimmed.split('\n')) {
    const row = line.trim();
    if (!row) continue;
    try {
      const parsed: unknown = JSON.parse(row);
      if (isLabelEntry(parsed)) result.push(parsed);
    } catch {
      // пропускаем битую строку
    }
  }
  return result;
}

export function isLabelEntry(value: unknown): value is LabelEntry {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.hash === 'string' &&
    v.hash.length > 0 &&
    typeof v.title === 'string' &&
    typeof v.text === 'string' &&
    (v.label === 'ai' || v.label === 'human') &&
    typeof v.score === 'number' &&
    typeof v.createdAt === 'number'
  );
}

export function exportFilename(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  return `no-ai-slop-labels-${stamp}.jsonl`;
}
