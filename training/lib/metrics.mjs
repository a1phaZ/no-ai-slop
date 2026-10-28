// Метрики, калибровка и выбор порога — общие для train/evaluate.
// Чистые функции без ввода-вывода.

export function metrics(scores, labels, threshold = 0.5) {
  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;
  for (let i = 0; i < scores.length; i++) {
    const predicted = scores[i] >= threshold ? 1 : 0;
    if (predicted === 1 && labels[i] === 1) tp += 1;
    else if (predicted === 1 && labels[i] === 0) fp += 1;
    else if (predicted === 0 && labels[i] === 0) tn += 1;
    else fn += 1;
  }
  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  const accuracy = (tp + tn) / Math.max(1, tp + tn + fp + fn);
  return { tp, fp, tn, fn, precision, recall, f1, accuracy };
}

/** Brier + Expected Calibration Error по бинам уверенности. */
export function calibration(scores, labels, bins = 10) {
  const stats = Array.from({ length: bins }, () => ({ count: 0, confidence: 0, positive: 0 }));
  let brier = 0;
  for (let i = 0; i < scores.length; i++) {
    brier += (scores[i] - labels[i]) ** 2;
    const bin = Math.min(bins - 1, Math.floor(scores[i] * bins));
    stats[bin].count += 1;
    stats[bin].confidence += scores[i];
    stats[bin].positive += labels[i];
  }
  let ece = 0;
  for (const bin of stats) {
    if (bin.count === 0) continue;
    const confidence = bin.confidence / bin.count;
    const accuracy = bin.positive / bin.count;
    ece += (bin.count / scores.length) * Math.abs(confidence - accuracy);
  }
  return { brier: brier / Math.max(1, scores.length), ece };
}

/**
 * Precision-first порог: максимум recall при precision >= minPrecision.
 * Если такого порога нет — откат на максимум F1.
 * При равном recall выбираем более высокий порог (меньше ложных срабатываний).
 */
export function pickThreshold(scores, labels, { minPrecision = 0.9, step = 0.01 } = {}) {
  let bestPrecision = null;
  let bestF1 = null;

  for (let t = 0.05; t <= 0.9501; t += step) {
    const threshold = Number(t.toFixed(2));
    const m = metrics(scores, labels, threshold);
    if (m.tp + m.fp === 0) continue;

    if (m.precision >= minPrecision) {
      if (
        !bestPrecision ||
        m.recall > bestPrecision.metrics.recall + 1e-9 ||
        (Math.abs(m.recall - bestPrecision.metrics.recall) <= 1e-9 &&
          threshold > bestPrecision.threshold)
      ) {
        bestPrecision = { threshold, metrics: m };
      }
    }

    if (!bestF1 || m.f1 > bestF1.metrics.f1 + 1e-9) {
      bestF1 = { threshold, metrics: m };
    }
  }

  const chosen = bestPrecision ?? bestF1 ?? {
    threshold: 0.5,
    metrics: metrics(scores, labels, 0.5),
  };
  return { ...chosen, strategy: bestPrecision ? 'precision' : 'f1' };
}

/** Все точки порога — для отчёта evaluate. */
export function thresholdSweep(scores, labels, step = 0.05) {
  const rows = [];
  for (let t = 0.05; t <= 0.9501; t += step) {
    const threshold = Number(t.toFixed(2));
    rows.push({ threshold, ...metrics(scores, labels, threshold) });
  }
  return rows;
}

/** Подбор температуры: p = sigmoid(logit / T), минимизируем NLL на валидации. */
export function fitTemperature(logits, labels, { min = 0.5, max = 3, step = 0.01 } = {}) {
  let best = { temperature: 1, nll: Infinity };
  for (let t = min; t <= max + 1e-9; t += step) {
    const temperature = Number(t.toFixed(2));
    let nll = 0;
    for (let i = 0; i < logits.length; i++) {
      const z = logits[i] / temperature;
      // log(1 + exp(-z)) и log(1 + exp(z)) — устойчивый softplus.
      const posLoss = z >= 0 ? Math.log1p(Math.exp(-z)) : -z + Math.log1p(Math.exp(z));
      const negLoss = z >= 0 ? z + Math.log1p(Math.exp(-z)) : Math.log1p(Math.exp(z));
      nll += labels[i] === 1 ? posLoss : negLoss;
    }
    nll /= Math.max(1, logits.length);
    if (nll < best.nll - 1e-12) best = { temperature, nll };
  }
  return best;
}

export function sigmoid(z) {
  if (z >= 0) return 1 / (1 + Math.exp(-z));
  const e = Math.exp(z);
  return e / (1 + e);
}

export function logit(p) {
  return Math.log(p / (1 - p));
}

export function formatMetrics(m) {
  return `acc=${m.accuracy.toFixed(3)} prec=${m.precision.toFixed(3)} rec=${m.recall.toFixed(3)} f1=${m.f1.toFixed(3)} (tp=${m.tp} fp=${m.fp} tn=${m.tn} fn=${m.fn})`;
}
