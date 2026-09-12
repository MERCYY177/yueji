import { cp, mkdir, readFile, rm, stat } from 'node:fs/promises';

const output = 'dist';
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const entries = [
  'index.html',
  'style.css',
  'manifest.json',
  'service-worker.js',
  'yueji-core.js',
  'app.js',
  'yueji-extension.js',
  'yueji-p1-identity-migration.js',
  'yueji-weread-date-evidence.js',
  'yueji-layout.js',
  'yueji-book-cover.js',
  'yueji-onboarding.js',
  'yueji-features.js',
  'netlify.toml',
  'assets',
  'vendor',
];
for (const entry of entries) await cp(entry, `${output}/${entry}`, { recursive: true });
const html = await readFile(`${output}/index.html`, 'utf8');
for (const asset of [
  'style.css',
  'vendor/jszip.min.js',
  'vendor/sql-asm.js',
  'app.js',
  'yueji-features.js',
]) {
  if (!html.includes(asset)) throw new Error(`Build output does not reference ${asset}`);
  await stat(`${output}/${asset}`);
}
console.log('Build OK: dist/');
