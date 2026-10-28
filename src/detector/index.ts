import { DETECTOR_VERSION, type DetectionResult } from '../shared/types.ts';
import { extractFeatures } from './features.ts';
import { linearModelId, modelAvailable, predictModel } from './model.ts';
import { nnAvailable, nnModelId, predictNN } from './nn.ts';
import { scoreText } from './heuristics.ts';

export type DetectorMode = 'model' | 'linear' | 'heuristics';

export { MODEL_VERSION } from './model.ts';
export { NN_MODEL_VERSION } from './nn.ts';

/**
 * Идентификатор модели, которая будет использована для режима.
 * Нужен кэшу, чтобы оценки разных моделей не смешивались.
 */
export function modelIdFor(mode: DetectorMode): string {
  if (mode === 'model' && nnAvailable()) return nnModelId();
  if (mode !== 'heuristics' && modelAvailable()) return linearModelId();
  return `heuristic@${DETECTOR_VERSION}`;
}

/**
 * Единая точка входа детектора.
 * `model` — нейросеть, если она есть, иначе линейная модель;
 * `linear` — только логистическая регрессия;
 * `heuristics` — только правила.
 * При ошибке модели — фолбэк на следующий уровень.
 */
export function detect(text: string, mode: DetectorMode = 'model'): DetectionResult {
  const features = extractFeatures(text);

  if (mode === 'model' && nnAvailable()) {
    try {
      const { score, signals } = predictNN(features);
      return {
        score,
        signals,
        source: 'model',
        textLength: text.length,
        version: DETECTOR_VERSION,
        modelId: nnModelId(),
      };
    } catch {
      // намеренно падаем на линейную модель ниже
    }
  }

  if (mode !== 'heuristics' && modelAvailable()) {
    try {
      const { score, signals } = predictModel(features);
      return {
        score,
        signals,
        source: 'model',
        textLength: text.length,
        version: DETECTOR_VERSION,
        modelId: linearModelId(),
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
    modelId: `heuristic@${heuristic.version}`,
  };
}
