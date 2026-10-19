import { DETECTOR_VERSION, type Signal } from '../shared/types.ts';

export { DETECTOR_VERSION };

const EN_MARKERS = [
  "as an ai language model",
  'as an ai',
  "in today's fast-paced world",
  "in today's digital age",
  'in the ever-evolving',
  "it's important to note",
  'it is important to note',
  "it's worth noting",
  'it is worth noting',
  'delve into',
  'navigate the complexities',
  'unlock the potential',
  'a testament to',
  'rich tapestry',
  'in conclusion',
  'furthermore',
  'moreover',
  'additionally',
  'when it comes to',
  'game-changer',
  'seamlessly',
  'cutting-edge',
  'elevate your',
];

const RU_MARKERS = [
  'как ии',
  'как языковая модель',
  'в современном мире',
  'в современном мире технологий',
  'важно отметить',
  'стоит отметить',
  'необходимо подчеркнуть',
  'стоит подчеркнуть',
  'играет важную роль',
  'играет ключевую роль',
  'нельзя не отметить',
  'таким образом',
  'более того',
  'кроме того',
  'в заключение',
  'в конечном итоге',
  'является неотъемлемой частью',
  'широкий спектр',
  'ключевую роль',
  'открывает новые возможности',
];

const INFORMAL_MARKERS = [
  'lol',
  'tbh',
  'imo',
  'imho',
  'btw',
  'idk',
  'kinda',
  'gonna',
  'wanna',
  'dunno',
  'omg',
  'wtf',
  'smh',
  'ngl',
  'afaik',
  'lmao',
  'блин',
  'хз',
  'норм',
  'короч',
  'вообщем',
  'щас',
  'походу',
  'имхо',
  'жесть',
  'фигня',
];

export interface Features {
  length: number;
  words: number;
  sentences: number;
  markerHits: number;
  markers: string[];
  emDashPer100: number;
  contractionRatio: number;
  informalHits: number;
  burstiness: number;
  avgSentenceLen: number;
  shortSentences: number;
  capitalizationRatio: number;
  punctuationRatio: number;
  listLineRatio: number;
  boldLead: boolean;
  explicitAI: boolean;
}

export interface ScoreResult {
  score: number;
  raw: number;
  signals: Signal[];
  features: Features;
  version: number;
}

function words(text: string): string[] {
  return text.match(/[a-zа-яё0-9']+/gi) ?? [];
}

function splitSentences(text: string): string[] {
  return text
    .split(/[.!?…]+|\n{2,}/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function countMatches(text: string, patterns: string[]): { hits: number; found: string[] } {
  const lower = text.toLowerCase();
  const found = patterns.filter((p) => lower.includes(p));
  return { hits: found.length, found };
}

function contractionCount(text: string): number {
  return (text.match(/\b\w+'(?:s|t|re|ve|ll|d|m)\b/gi) ?? []).length;
}

function stdDev(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

export function extractFeatures(text: string): Features {
  const length = text.length;
  const wordList = words(text);
  const wordCount = wordList.length;
  const sentences = splitSentences(text);

  const sentenceLengths = sentences.map((s) => words(s).length).filter((n) => n > 0);
  const mean = sentenceLengths.length
    ? sentenceLengths.reduce((a, b) => a + b, 0) / sentenceLengths.length
    : 0;
  const burstiness = mean > 0 ? stdDev(sentenceLengths) / mean : 0;

  const markers = countMatches(text, [...EN_MARKERS, ...RU_MARKERS]);
  const informal = countMatches(text, INFORMAL_MARKERS);

  const emDash = (text.match(/—/g) ?? []).length;
  const punctuationMarks = (text.match(/[.!?…]/g) ?? []).length;

  const upperStart = sentences.filter((s) => /^[A-ZА-ЯЁ]/.test(s)).length;

  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  const listLines = lines.filter((l) => /^(?:[-*•]|\d+[.)])\s+/.test(l)).length;

  return {
    length,
    words: wordCount,
    sentences: sentences.length,
    markerHits: markers.hits,
    markers: markers.found,
    emDashPer100: length > 0 ? (emDash / length) * 100 : 0,
    contractionRatio: wordCount > 0 ? contractionCount(text) / wordCount : 0,
    informalHits: informal.hits,
    burstiness,
    avgSentenceLen: mean,
    shortSentences: sentenceLengths.filter((n) => n < 6).length,
    capitalizationRatio: sentences.length ? upperStart / sentences.length : 0,
    punctuationRatio: sentences.length ? punctuationMarks / sentences.length : 0,
    listLineRatio: lines.length >= 3 ? listLines / lines.length : 0,
    boldLead: /\*\*[^*\n]+\*\*/.test(text),
    explicitAI: /as an ai|как ии|как языковая модель/i.test(text),
  };
}

const BIAS = 1.2;

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
