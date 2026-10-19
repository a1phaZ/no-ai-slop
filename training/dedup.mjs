// Точный и почти-точный дедуп (SimHash + бэндинг), чтобы один и тот же текст
// не попал одновременно в train и test.
//
//   node training/dedup.mjs
//   node training/dedup.mjs --input=data/raw/human.jsonl --out=data/raw/all.jsonl
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { RAW_DIR, number, parseArgs, printDist, readJsonl, textHash, writeJsonl } from './lib/util.mjs';

const args = parseArgs();
const hammingLimit = number(args.hamming, 3);
const out = resolve(String(args.out ?? resolve(RAW_DIR, 'all.jsonl')));

function tokens(text) {
  const words = String(text).toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
  if (words.length < 3) return words;
  const shingles = [];
  for (let i = 0; i + 2 < words.length; i++) shingles.push(words.slice(i, i + 3).join(' '));
  return shingles;
}

const MASK = 0xffffffffffffffffn;
const PRIME = 0x100000001b3n;

function hash64(str) {
  let hash = 0xcbf29ce484222325n;
  const bytes = Buffer.from(str, 'utf8');
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = (hash * PRIME) & MASK;
  }
  return hash;
}

function simhash(text) {
  const vector = new Array(64).fill(0);
  const list = tokens(text);
  if (list.length === 0) return 0n;
  for (const token of list) {
    const hash = hash64(token);
    for (let bit = 0; bit < 64; bit++) {
      vector[bit] += (hash >> BigInt(bit)) & 1n ? 1 : -1;
    }
  }
  let result = 0n;
  for (let bit = 0; bit < 64; bit++) {
    if (vector[bit] > 0) result |= 1n << BigInt(bit);
  }
  return result;
}

function hamming(a, b) {
  let diff = a ^ b;
  let count = 0;
  while (diff) {
    count += Number(diff & 1n);
    diff >>= 1n;
  }
  return count;
}

function inputFiles() {
  if (args.input) return [resolve(String(args.input))];
  if (!existsSync(RAW_DIR)) return [];
  return readdirSync(RAW_DIR)
    .filter((name) => name.endsWith('.jsonl') && name !== 'all.jsonl')
    .map((name) => resolve(RAW_DIR, name));
}

const rows = [];
for (const file of inputFiles()) {
  const loaded = readJsonl(file);
  console.log(`${file}: ${loaded.length}`);
  rows.push(...loaded);
}

// 1. Точный дедуп по тексту.
const byHash = new Map();
for (const row of rows) {
  const hash = textHash(row.title ?? '', row.text ?? '');
  if (!byHash.has(hash)) byHash.set(hash, row);
}
const unique = [...byHash.values()];
console.log(`после точного дедупа: ${unique.length} (было ${rows.length})`);

// 2. Почти-дубликаты: бэндинг по 16-битным полосам + union-find.
const parent = unique.map((_, i) => i);
const find = (i) => {
  while (parent[i] !== i) {
    parent[i] = parent[parent[i]];
    i = parent[i];
  }
  return i;
};
const union = (a, b) => {
  const ra = find(a);
  const rb = find(b);
  if (ra !== rb) parent[rb] = ra;
};

const simhashes = unique.map((row) => simhash(`${row.title ?? ''}\n${row.text ?? ''}`));
const bands = new Map();
const BAND_BITS = 16;
const BAND_COUNT = 64 / BAND_BITS;

for (let i = 0; i < simhashes.length; i++) {
  for (let band = 0; band < BAND_COUNT; band++) {
    const value = (simhashes[i] >> BigInt(band * BAND_BITS)) & 0xffffn;
    const key = `${band}:${value}`;
    const list = bands.get(key);
    if (list) list.push(i);
    else bands.set(key, [i]);
  }
}

for (const list of bands.values()) {
  if (list.length < 2) continue;
  for (let k = 1; k < list.length; k++) {
    if (hamming(simhashes[list[0]], simhashes[list[k]]) <= hammingLimit) {
      union(list[0], list[k]);
    }
  }
}

const clusterSizes = new Map();
for (let i = 0; i < unique.length; i++) {
  const root = find(i);
  clusterSizes.set(root, (clusterSizes.get(root) ?? 0) + 1);
}

let clusters = 0;
const result = unique.map((row, i) => {
  const root = find(i);
  const size = clusterSizes.get(root) ?? 1;
  if (size > 1 && root === i) clusters += 1;
  return { ...row, near_dup: `c${root}` };
});

writeJsonl(out, result);
console.log(`near-dup кластеров (>1): ${clusters}`);
printDist('all.jsonl', result);
console.log(`файл: ${out}`);
