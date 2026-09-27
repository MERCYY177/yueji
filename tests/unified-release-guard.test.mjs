import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function text(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('core clears legacy persistent Skill Key before extension boot and loads the backup bridge', async () => {
  const core = await text('yueji-core.js');
  assert.match(core, /localStorage\.removeItem\('yueji-weread-key'\)/);
  assert.match(core, /localStorage\.removeItem\('yueji-weread-key-persist-v1'\)/);
  assert.match(core, /yueji-backup-extension\.js/);
});

test('unified UI keeps four primary tabs and treats incomplete calendar months as unknown', async () => {
  const unified = await text('yueji-unified.js');
  assert.match(unified, /nav\.querySelector\('\[data-go="calendar"\]'\)\?\.remove\(\)/);
  assert.match(unified, /replaceChildren\(\.\.\.\[today, library, notes, analytics\]/);
  assert.match(unified, /completeMonths = new Set/);
  assert.match(unified, /暂无日级明细/);
  assert.match(unified, /本月/);
  assert.match(unified, /今年/);
  assert.match(unified, /全部/);
});

test('official summary sync gate is installed before the unified summary module', async () => {
  const core = await text('yueji-core.js');
  const gate = await text('yueji-sync-gate.js');
  assert.match(core, /import\('\.\/yueji-sync-gate\.js[^']*'\)\s*\.then\(\(\) => import\('\.\/yueji-unified\.js/);
  assert.match(gate, /function waitForPrimarySyncIdle/);
  assert.match(gate, /wereadSyncBtn/);
  assert.match(gate, /__yuejiWeReadSyncing/);
  assert.match(gate, /mode === 'annually'/);
});

test('notes are collapsed for browsing but fully expanded only in exported note images', async () => {
  const appearance = await text('yueji-appearance.js');
  assert.match(appearance, /collapseChapterBodies/);
  assert.match(appearance, /chapter-group\[open\]/);
  assert.match(appearance, /key === 'book-notes'/);
  assert.match(appearance, /details\.open = true/);
});

test('single-book note export chooses a book and exhausts paginated notes first', async () => {
  const picker = await text('yueji-export-book-picker.js');
  const core = await text('yueji-core.js');
  assert.match(core, /yueji-export-book-picker\.js/);
  assert.match(picker, /选择书籍/);
  assert.match(picker, /yuejiRenderChapterNotes/);
  assert.match(picker, /chapter-load-more/);
  assert.match(picker, /loadAllSelectedBookNotes/);
});

test('build and service worker both include all unified runtime modules', async () => {
  const build = await text('scripts/build.mjs');
  const serviceWorker = await text('service-worker.js');
  for (const asset of [
    'yueji-reading-model.js',
    'yueji-weread-reading.js',
    'yueji-unified-ui-model.js',
    'yueji-sync-gate.js',
    'yueji-unified.js',
    'yueji-appearance-model.js',
    'yueji-appearance.js',
    'yueji-export-book-picker.js',
    'yueji-backup-extension.js',
  ]) {
    assert.ok(build.includes(asset), `${asset} missing from build`);
    assert.ok(serviceWorker.includes(asset), `${asset} missing from service worker`);
  }
});
