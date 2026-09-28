import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const unified = await readFile(new URL('../yueji-unified.js', import.meta.url), 'utf8');

test('feature dialogs use a real theme background and readable text', () => {
  assert.match(unified, /\.feature-panel\s*\{[^}]*background\s*:\s*var\(--card\)[^}]*color\s*:\s*var\(--ink\)/i);
  assert.match(unified, /\.feature-panel-head\s*\{[^}]*background\s*:\s*color-mix\(in srgb,var\(--card\)/i);
});

test('official WeRead stats only show fields that are reliably returned', () => {
  assert.match(unified, /data-official-time/);
  assert.match(unified, /data-official-days/);
  assert.doesNotMatch(unified, /data-official-books/);
  assert.doesNotMatch(unified, /data-official-finished/);
});

test('year overview uses local finished-book state instead of missing official book totals', () => {
  assert.match(unified, /已读书籍/);
  assert.match(unified, /data-local-finished-books/);
  assert.match(unified, /finishReading\s*===\s*true/);
  assert.match(unified, /progress[^\n]*>=\s*99\.95/);
  assert.doesNotMatch(unified, /data-kpi="books"/);
  assert.doesNotMatch(unified, /data-kpi="finished"/);
});
