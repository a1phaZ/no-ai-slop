import { DETECTOR_VERSION, type Signal } from '../shared/types.ts';
import { extractFeatures, type Features } from './features.ts';

export { DETECTOR_VERSION, extractFeatures };
export type { Features };

export interface ScoreResult {
  score: number;
  raw: number;
  signals: Signal[];
  features: Features;
  version: number;
}

const BIAS = 1.2;

/** Эвристический детектор — фолбэк и интерпретируемая база. */
export function scoreText(text: string): ScoreResult {
  const f = extractFeatures(text);
  const signals: Signal[] = [];
  let raw = 0;

  const add = (id: string, weight: number, detail: string) => {
    if (weight === 0) return;
    signals.push({ id, weight, detail });
    raw += weight;
  };

  if (f.explicitAI) {
    add('explicit_ai', 3, 'прямое упоминание ИИ в тексте');
  }

  if (f.markerHits > 0) {
    add(
      'ai_markers',
      Math.min(f.markerHits, 3) * 0.45,
      `шаблонные фразы: ${f.markers.slice(0, 4).join(', ')}`,
    );
  }

  if (f.length >= 80 && f.emDashPer100 > 0.3) {
    add(
      'em_dash',
      Math.min(f.emDashPer100 / 0.5, 1.6) * 0.3,
      `плотность длинного тире: ${f.emDashPer100.toFixed(2)} на 100 символов`,
    );
  }

  if (f.words >= 25 && f.contractionRatio < 0.015) {
    add('no_contractions', 0.4, 'почти нет сокращений при заметном тексте');
  }

  if (f.informalHits > 0) {
    add('informal', -0.8 * Math.min(f.informalHits, 2), 'разговорные маркеры');
  }

  if (f.sentences >= 3) {
    if (f.burstiness < 0.3) {
      add('uniform_rhythm', 0.5, 'равномерная длина предложений');
    } else if (f.burstiness < 0.45) {
      add('uniform_rhythm', 0.25, 'слабо выраженный ритм предложений');
    }
  }

  if (f.words >= 20 && f.punctuationRatio >= 0.9) {
    add('perfect_punctuation', 0.25, 'идеальная пунктуация');
  }
  if (f.words >= 20 && f.capitalizationRatio >= 0.95) {
    add('perfect_capitalization', 0.15, 'все предложения с заглавной буквы');
  }

  if (f.listLineRatio >= 0.4) {
    add('list_structure', 0.4, 'структура списка');
  }
  if (f.boldLead) {
    add('bold_lead', 0.25, 'жирные вводные в элементах');
  }

  if (
    f.sentences >= 4 &&
    f.shortSentences === 0 &&
    f.avgSentenceLen >= 15 &&
    f.avgSentenceLen <= 23
  ) {
    add('uniform_middling', 0.35, 'предложения ровной средней длины');
  }

  if (f.length > 600 && f.sentences >= 4 && f.shortSentences === 0) {
    add('longform', 0.25, 'длинный текст без коротких фраз');
  }

  const score = 1 / (1 + Math.exp(-(raw - BIAS)));
  return { score, raw, signals, features: f, version: DETECTOR_VERSION };
}
