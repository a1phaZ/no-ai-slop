import type { Features } from './features.ts';

/** Порядок признаков в векторе. Менять нельзя без переобучения модели. */
export const FEATURE_NAMES = [
  'log_length',
  'log_words',
  'sentences',
  'marker_hits',
  'em_dash_per100',
  'contraction_ratio',
  'informal_hits',
  'burstiness',
  'avg_sentence_len',
  'short_sentences',
  'capitalization_ratio',
  'punctuation_ratio',
  'list_line_ratio',
  'bold_lead',
  'avg_word_len',
  'comma_per_sentence',
  'semicolon_count',
  'question_count',
  'exclamation_count',
  'unique_word_ratio',
] as const;

export function toVector(f: Features): number[] {
  return [
    Math.log1p(f.length),
    Math.log1p(f.words),
    f.sentences,
    f.markerHits,
    f.emDashPer100,
    f.contractionRatio,
    f.informalHits,
    f.burstiness,
    f.avgSentenceLen,
    f.shortSentences,
    f.capitalizationRatio,
    f.punctuationRatio,
    f.listLineRatio,
    f.boldLead ? 1 : 0,
    f.avgWordLen,
    f.commaPerSentence,
    f.semicolonCount,
    f.questionCount,
    f.exclamationCount,
    f.uniqueWordRatio,
  ];
}
