import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const core = await readFile(new URL('../yueji-core.js', import.meta.url), 'utf8');
const ui = await readFile(new URL('../yueji-release-ui.js', import.meta.url), 'utf8');
const theme = await readFile(new URL('../yueji-theme.css', import.meta.url), 'utf8');
const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));

test('core loads cool-gray theme and release UI bridge', () => {
  assert.match(core, /yueji-theme\.css\?v=20260918-r2/);
  assert.match(core, /yueji-release-ui\.js\?v=20260918-r2/);
  assert.match(theme, /--paper:\s*#f5f6f8/);
  assert.equal(manifest.background_color, '#f5f6f8');
});

test('release UI refreshes current page after synced data changes', () => {
  assert.match(ui, /addEventListener\(['"]yueji:data-changed['"],\s*refreshActivePage\)/);
  assert.match(ui, /window\.switchPage/);
  assert.match(ui, /window\.yuejiRenderChapterNotes/);
});

test('release UI hides stale WeRead copy and internal markers', () => {
  assert.match(ui, /重新读取逐书进度\/圆圈数据/);
  assert.match(ui, /重新读取逐书进度/);
  assert.match(ui, /更新基础数据/);
  assert.match(ui, /一键完整同步/);
  assert.match(ui, /__YUEJI_WEREAD__/);
});

test('release UI observes only target regions after discovery', () => {
  assert.match(ui, /function watchRoot/);
  assert.match(ui, /watchedRoots/);
  assert.match(ui, /discovery\.disconnect\(\)/);
  assert.doesNotMatch(
    ui,
    /else \{\s*const settings = document\.getElementById\('wereadSettings'\)/,
  );
});
