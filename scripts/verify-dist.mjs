import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';

const root = path.resolve('dist');
const mustExist = async (relative) => {
  const clean = String(relative || '').replace(/^\.\//, '').split('?')[0];
  if (!clean) return;
  await access(path.join(root, clean), constants.R_OK);
};

const required = [
  'index.html',
  'style.css',
  'yueji-theme.css',
  'manifest.json',
  'service-worker.js',
  'yueji-core.js',
  'yueji-release-ui.js',
  'yueji-notes-chapters.js',
  'yueji-notes-chapters.css',
];
for (const file of required) await mustExist(file);

const sw = await readFile(path.join(root, 'service-worker.js'), 'utf8');
for (const match of sw.matchAll(/['"]\.\/([^'"]+)['"]/g)) {
  if (match[1]) await mustExist(match[1]);
}

const core = await readFile(path.join(root, 'yueji-core.js'), 'utf8');
for (const match of core.matchAll(/import\(['"]\.\/([^?'"\)]+)(?:\?[^'"]*)?['"]\)/g))
  await mustExist(match[1]);
for (const match of core.matchAll(/href\s*=\s*['"]\.\/([^?'"\)]+)(?:\?[^'"]*)?['"]/g))
  await mustExist(match[1]);

const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
for (const icon of manifest.icons || []) await mustExist(icon.src);

console.log('Release artifact OK: referenced assets exist in dist/');
