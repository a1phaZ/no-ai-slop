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
  avgWordLen: number;
  commaPerSentence: number;
  semicolonCount: number;
  questionCount: number;
  exclamationCount: number;
  uniqueWordRatio: number;
}

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
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
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
  const commas = (text.match(/,/g) ?? []).length;

  const upperStart = sentences.filter((s) => /^[A-ZА-ЯЁ]/.test(s)).length;

  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  const listLines = lines.filter((l) => /^(?:[-*•]|\d+[.)])\s+/.test(l)).length;

  const uniqueWords = new Set(wordList.map((w) => w.toLowerCase())).size;
  const totalWordChars = wordList.reduce((a, w) => a + w.length, 0);

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
    avgWordLen: wordCount > 0 ? totalWordChars / wordCount : 0,
    commaPerSentence: sentences.length ? commas / sentences.length : 0,
    semicolonCount: (text.match(/;/g) ?? []).length,
    questionCount: (text.match(/\?/g) ?? []).length,
    exclamationCount: (text.match(/!/g) ?? []).length,
    uniqueWordRatio: wordCount > 0 ? uniqueWords / wordCount : 0,
  };
}
