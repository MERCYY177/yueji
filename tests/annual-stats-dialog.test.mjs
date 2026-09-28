import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const fix = await readFile(new URL('../yueji-annual-ui-fix.js', import.meta.url), 'utf8');
const core = await readFile(new URL('../yueji-core.js', import.meta.url), 'utf8');

test('feature dialogs use a real theme background and readable text', () => {
  assert.match(fix, /\.feature-panel\s*\{[^}]*background\s*:\s*var\(--card\)[^}]*color\s*:\s*var\(--ink\)/i);
  assert.match(fix, /\.feature-panel-head\s*\{[^}]*background\s*:\s*color-mix\(in srgb,var\(--card\)/i);
});

test('official WeRead stats hide unavailable book totals instead of showing misleading blanks', () => {
  assert.match(fix, /data-official-books/);
  assert.match(fix, /data-official-finished/);
  assert.match(fix, /classList\.add\('yueji-annual-hide'\)/);
  assert.match(fix, /只展示微信稳定返回的汇总字段/);
});

test('year overview uses local finished-book state instead of missing official book totals', () => {
  assert.match(fix, /已读书籍/);
  assert.match(fix, /data-local-finished-books/);
  assert.match(fix, /finishReading\s*===\s*true/);
  assert.match(fix, /progress\s*>=\s*99\.95/);
  assert.match(fix, /data-kpi="books"/);
  assert.match(fix, /data-kpi="finished"/);
  assert.match(fix, /local-finished-grid/);
});

test('annual cleanup loads immediately after the unified summary module', () => {
  assert.match(core, /yueji-unified\.js[^']*'\)\)\s*\.then\(\(\) => import\('\.\/yueji-annual-ui-fix\.js/);
});
