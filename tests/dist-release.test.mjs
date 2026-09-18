import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const build = await readFile(new URL('../scripts/build.mjs', import.meta.url), 'utf8');
const verify = await readFile(new URL('../scripts/verify-dist.mjs', import.meta.url), 'utf8');

test('production build includes all release enhancement assets', () => {
  for (const asset of [
    'yueji-theme.css',
    'yueji-release-ui.js',
    'yueji-notes-chapters.js',
    'yueji-notes-chapters.css',
  ]) assert.match(build, new RegExp(asset.replaceAll('.', '\\.')));
});

test('build executes final dist verification', () => {
  assert.match(build, /import\(['"]\.\/verify-dist\.mjs['"]\)/);
  assert.match(verify, /service-worker\.js/);
  assert.match(verify, /yueji-core\.js/);
  assert.match(verify, /manifest\.json/);
});
