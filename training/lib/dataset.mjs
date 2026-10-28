// Загрузка датасета и сплиты — общие для train / train-nn / evaluate.
import { readJsonl, mulberry32, shuffle } from './util.mjs';

/** Строки датасета: title + text, метка 0/1, опциональные source/lang/split. */
export function loadDataset(path) {
  return readJsonl(path).filter(
    (row) => (row.label === 0 || row.label === 1) && String(row.text ?? '').trim().length > 0,
  );
}

export function textOf(row) {
  return `${row.title ?? ''}\n${row.text ?? ''}`.trim();
}

/** Если в датасете есть split — уважаем групповые сплиты, иначе режем 60/20/20. */
export function splitIndices(rows, seed = 20261019) {
  const hasSplits = rows.some((row) => row.split);
  if (hasSplits) {
    const pick = (split) => rows.map((_, i) => i).filter((i) => rows[i].split === split);
    return { train: pick('train'), val: pick('val'), test: pick('test') };
  }

  const rand = mulberry32(seed);
  const order = shuffle(
    rows.map((_, i) => i),
    rand,
  );
  const nTrain = Math.floor(rows.length * 0.6);
  const nVal = Math.floor(rows.length * 0.2);
  return {
    train: order.slice(0, nTrain),
    val: order.slice(nTrain, nTrain + nVal),
    test: order.slice(nTrain + nVal),
  };
}

/** Вес строки: пользовательские метки можно усилить через sample_weight. */
export function weightOf(row) {
  const value = Number(row.sample_weight);
  return Number.isFinite(value) && value > 0 ? value : 1;
}

/** Разбивает индексы на срезы по языку, источнику и длине. */
export function slices(rows, indices) {
  const defs = [];
  const langs = new Set(rows.map((row) => row.lang ?? 'other'));
  for (const lang of langs) {
    defs.push([`lang=${lang}`, (row) => (row.lang ?? 'other') === lang]);
  }
  const sources = new Set(rows.map((row) => row.source ?? 'unknown'));
  for (const source of sources) {
    defs.push([`source=${source}`, (row) => (row.source ?? 'unknown') === source]);
  }
  defs.push(['len<80', (row) => String(row.text ?? '').length < 80]);
  defs.push(['len 80-200', (row) => {
    const len = String(row.text ?? '').length;
    return len >= 80 && len < 200;
  }]);
  defs.push(['len 200-800', (row) => {
    const len = String(row.text ?? '').length;
    return len >= 200 && len <= 800;
  }]);
  defs.push(['len>800', (row) => String(row.text ?? '').length > 800]);

  return defs
    .map(([name, predicate]) => ({ name, idx: indices.filter((i) => predicate(rows[i])) }))
    .filter((slice) => slice.idx.length > 0);
}
