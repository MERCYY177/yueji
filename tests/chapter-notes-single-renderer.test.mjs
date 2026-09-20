import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

const entryUrl = new URL('../yueji-notes-entry.js', import.meta.url);

test('app note renders are owned by the chapter notes entry and reset chapter pagination', async () => {
  const core = await readFile(new URL('../yueji-core.js', import.meta.url), 'utf8');
  assert.match(core, /import\(['"]\.\/yueji-notes-entry\.js\?v=20260919-r1['"]\)/);
  assert.equal(existsSync(entryUrl), true, 'chapter notes entry module must exist');

  const entry = await readFile(entryUrl, 'utf8');
  assert.match(entry, /renderNotes\s*=\s*chapterNotesRenderEntry/);
  assert.match(entry, /window\.yuejiRenderChapterNotes/);
  assert.match(entry, /renderer\(\{\s*reset:\s*true\s*\}\)/);
});
