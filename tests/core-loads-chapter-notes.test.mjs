import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('core loads chapter notes and release bridge modules', async () => {
  const source = await readFile(new URL('../yueji-core.js', import.meta.url), 'utf8');
  assert.match(source, /import\(['"]\.\/yueji-notes-chapters\.js\?v=20260918-r2['"]\)/);
  assert.match(source, /import\(['"]\.\/yueji-release-ui\.js\?v=20260918-r2['"]\)/);
});
