import { DEFAULT_SETTINGS, type Settings } from './types.ts';

const SETTINGS_KEY = 'settings';

function clamp01(value: number): number {
  if (Number.isNaN(value)) return DEFAULT_SETTINGS.threshold;
  return Math.min(1, Math.max(0, value));
}

export function normalizeSettings(raw: Partial<Settings> | undefined): Settings {
  const merged = { ...DEFAULT_SETTINGS, ...(raw ?? {}) };
  return {
    ...merged,
    threshold: clamp01(merged.threshold),
    detector: merged.detector === 'heuristics' ? 'heuristics' : 'model',
  };
}

export async function loadSettings(): Promise<Settings> {
  const raw = await chrome.storage.sync.get(SETTINGS_KEY);
  return normalizeSettings(raw[SETTINGS_KEY] as Partial<Settings> | undefined);
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = normalizeSettings({ ...(await loadSettings()), ...patch });
  await chrome.storage.sync.set({ [SETTINGS_KEY]: next });
  return next;
}
