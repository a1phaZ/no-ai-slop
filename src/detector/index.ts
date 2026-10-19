import { DETECTOR_VERSION, type DetectionResult } from '../shared/types.ts';
import { extractFeatures } from './features.ts';
import { modelAvailable, predictModel } from './model.ts';
import { scoreText } from './heuristics.ts';

export type DetectorMode = 'model' | 'heuristics';

export { MODEL_VERSION } from './model.ts';

/**
 * Единая точка входа детектора.
 * Пытается применить модель; при её отсутствии/ошибке падает на эвристики.
 */
export function detect(text: string, mode: DetectorMode = 'model'): DetectionResult {
  const features = extractFeatures(text);

  if (mode === 'model' && modelAvailable()) {
    try {
      const { score, signals } = predictModel(features);
      return {
        score,
        signals,
        source: 'model',
        textLength: text.length,
        version: DETECTOR_VERSION,
      };
    } catch {
      // намеренно падаем в эвристики ниже
    }
  }

  const heuristic = scoreText(text);
  return {
    score: heuristic.score,
    signals: heuristic.signals,
    source: 'heuristic',
    textLength: text.length,
    version: heuristic.version,
  };
}
