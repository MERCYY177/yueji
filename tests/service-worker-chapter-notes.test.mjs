import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('offline shell includes release assets and safe fallbacks', async () => {
  const source = await readFile(new URL('../service-worker.js', import.meta.url), 'utf8');
  assert.match(source, /yueji-shell-20260919-r1/);
  assert.match(source, /\.\/yueji-notes-chapters\.js/);
  assert.match(source, /\.\/yueji-notes-entry\.js/);
  assert.match(source, /\.\/yueji-notes-chapters\.css/);
  assert.match(source, /\.\/yueji-theme\.css/);
  assert.match(source, /\.\/yueji-release-ui\.js/);
  assert.match(source, /ignoreSearch:\s*true/);
  assert.match(source, /request\.mode\s*===\s*['"]navigate['"]/);
  assert.match(source, /Response\.error\(\)/);
});
