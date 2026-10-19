import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createZip } from './lib/zip.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = resolve(root, 'dist');

async function assertDir(path) {
  try {
    const info = await stat(path);
    if (!info.isDirectory()) throw new Error('not a directory');
  } catch {
    throw new Error(`нет папки ${path} — сначала выполните "npm run build"`);
  }
}

async function walk(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full)));
    else files.push(full);
  }
  return files;
}

await assertDir(distDir);

const files = (await walk(distDir)).sort();
const entries = [];
for (const file of files) {
  entries.push({
    name: relative(distDir, file).split('\\').join('/'),
    data: await readFile(file),
  });
}

const zip = createZip(entries);
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const outFile = resolve(root, `no-ai-slop-${pkg.version}.zip`);
await writeFile(outFile, zip);

console.log(
  `package -> no-ai-slop-${pkg.version}.zip (${entries.length} файлов, ${(zip.length / 1024).toFixed(1)} KB)`,
);
