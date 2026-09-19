import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('single renderer entry is shipped in build and offline shell', async () => {
  const build = await readFile(new URL('../scripts/build.mjs', import.meta.url), 'utf8');
  const serviceWorker = await readFile(new URL('../service-worker.js', import.meta.url), 'utf8');

  assert.match(build, /['"]yueji-notes-entry\.js['"]/);
  assert.match(serviceWorker, /['"]\.\/yueji-notes-entry\.js['"]/);
  assert.match(serviceWorker, /yueji-shell-20260919-r1/);
});
