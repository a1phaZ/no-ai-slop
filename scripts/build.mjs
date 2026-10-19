import { build, context } from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outdir = resolve(root, 'dist');
const watch = process.argv.includes('--watch');

const entryPoints = {
  background: resolve(root, 'src/background.ts'),
  content: resolve(root, 'src/content/index.ts'),
  popup: resolve(root, 'src/popup/popup.ts'),
  options: resolve(root, 'src/options/options.ts'),
};

const staticFiles = [
  ['src/content/content.css', 'content.css'],
  ['src/popup/popup.html', 'popup.html'],
  ['src/popup/popup.css', 'popup.css'],
  ['src/options/options.html', 'options.html'],
  ['src/options/options.css', 'options.css'],
];

async function copyStatic() {
  await mkdir(outdir, { recursive: true });

  const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  const manifest = JSON.parse(await readFile(resolve(root, 'src/manifest.json'), 'utf8'));
  manifest.version = pkg.version;
  await writeFile(resolve(outdir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  for (const [from, to] of staticFiles) {
    await cp(resolve(root, from), resolve(outdir, to));
  }
}

const options = {
  entryPoints,
  bundle: true,
  format: 'iife',
  target: ['chrome110'],
  outdir,
  sourcemap: watch ? 'inline' : false,
  minify: !watch,
  logLevel: 'info',
};

await rm(outdir, { recursive: true, force: true });

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  await copyStatic();
  console.log('watching src/ ...');
} else {
  await build(options);
  await copyStatic();
  console.log('build -> dist/');
}
