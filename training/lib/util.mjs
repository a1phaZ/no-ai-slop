// Общие утилиты офлайн-пайплайна датасета.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { fnv1a } from '../../src/detector/hash.ts';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const DATA_DIR = resolve(ROOT, 'data');
export const RAW_DIR = resolve(DATA_DIR, 'raw');
export const EVAL_DIR = resolve(DATA_DIR, 'eval');

export function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
}

export function readJsonl(path) {
  if (!existsSync(path)) return [];
  const text = readFileSync(path, 'utf8');
  const rows = [];
  let skipped = 0;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      rows.push(JSON.parse(trimmed));
    } catch {
      skipped += 1;
    }
  }
  if (skipped > 0) console.warn(`  пропущено битых строк в ${path}: ${skipped}`);
  return rows;
}

export function writeJsonl(path, rows) {
  ensureDir(dirname(path));
  const body = rows.map((row) => JSON.stringify(row)).join('\n');
  writeFileSync(path, body + (rows.length ? '\n' : ''));
}

export function appendJsonl(path, rows) {
  ensureDir(dirname(path));
  if (rows.length === 0) return;
  appendFileSync(path, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
}

export function parseArgs(argv = process.argv.slice(2)) {
  const args = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const eq = arg.indexOf('=');
    if (eq === -1) args[arg.slice(2)] = true;
    else args[arg.slice(2, eq)] = arg.slice(eq + 1);
  }
  return args;
}

export function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

export function normalize(text) {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function textHash(title, text) {
  return fnv1a(normalize(`${title}\n${text}`).toLowerCase());
}

export function authorHash(author) {
  return author ? fnv1a(`author:${author}`) : null;
}

export function detectLang(text) {
  const cyrillic = (text.match(/[а-яё]/gi) ?? []).length;
  const latin = (text.match(/[a-z]/gi) ?? []).length;
  if (cyrillic + latin === 0) return 'other';
  if (cyrillic / (cyrillic + latin) >= 0.3) return 'ru';
  if (latin / (cyrillic + latin) >= 0.3) return 'en';
  return 'other';
}

/** Детерминированный ГПСЧ — сплиты воспроизводимы. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(array, rand) {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function dist(rows) {
  const byLabel = { 0: 0, 1: 0 };
  const byLang = {};
  const bySource = {};
  for (const row of rows) {
    byLabel[row.label] = (byLabel[row.label] ?? 0) + 1;
    byLang[row.lang ?? 'other'] = (byLang[row.lang ?? 'other'] ?? 0) + 1;
    bySource[row.source ?? 'unknown'] = (bySource[row.source ?? 'unknown'] ?? 0) + 1;
  }
  return { byLabel, byLang, bySource };
}

export function printDist(name, rows) {
  const d = dist(rows);
  console.log(
    `${name}: ${rows.length} | label ${JSON.stringify(d.byLabel)} | lang ${JSON.stringify(d.byLang)}`,
  );
  if (Object.keys(d.bySource).length > 1) {
    console.log(`  источники: ${JSON.stringify(d.bySource)}`);
  }
}
