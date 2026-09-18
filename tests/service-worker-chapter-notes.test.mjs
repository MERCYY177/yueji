import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('offline shell includes chapter notes assets and uses a new cache generation', async () => {
  const source = await readFile(new URL('../service-worker.js', import.meta.url), 'utf8');
  assert.match(source, /yueji-shell-20260918-r1/);
  assert.match(source, /\.\/yueji-notes-chapters\.js/);
  assert.match(source, /\.\/yueji-notes-chapters\.css/);
});
