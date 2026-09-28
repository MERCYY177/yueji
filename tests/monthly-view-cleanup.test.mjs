import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../yueji-weread-date-evidence.js', import.meta.url), 'utf8');

test('monthly view hides redundant side cards while keeping their DOM hooks alive', () => {
  assert.match(source, /\.monthly-side\s*\{[^}]*display\s*:\s*none\s*!important/i);
  assert.match(source, /\.monthly-layout\s*\{[^}]*grid-template-columns\s*:\s*minmax\(0,\s*1fr\)\s*!important/i);
});

test('monthly book cards hide internal evidence labels', () => {
  assert.match(source, /\.month-book-evidence\s*\{[^}]*display\s*:\s*none\s*!important/i);
});

test('monthly summary removes WeRead snapshot-ranking disclaimers', () => {
  assert.match(source, /微信进度记录显示/);
  assert.match(source, /微信读书没有提供逐书分钟/);
  assert.match(source, /MutationObserver/);
});

test('monthly summary removes local journal count copy', () => {
  assert.match(source, /留下了.*篇手记/);
});
