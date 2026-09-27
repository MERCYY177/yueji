import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EXPORT_MODULES,
  normalizeFontMode,
  validateCustomFontFile,
} from '../yueji-appearance-model.js';

test('font mode defaults to system and accepts Huiwen/custom', () => {
  assert.equal(normalizeFontMode(''), 'system');
  assert.equal(normalizeFontMode('huiwen'), 'huiwen');
  assert.equal(normalizeFontMode('custom'), 'custom');
  assert.equal(normalizeFontMode('unknown'), 'system');
});

test('custom font validation accepts common font files and rejects huge or unrelated files', () => {
  assert.equal(validateCustomFontFile({ name: 'mine.woff2', size: 1024 }).ok, true);
  assert.equal(validateCustomFontFile({ name: 'mine.otf', size: 1024 }).ok, true);
  assert.equal(validateCustomFontFile({ name: 'mine.png', size: 1024 }).ok, false);
  assert.equal(validateCustomFontFile({ name: 'mine.ttf', size: 30 * 1024 * 1024 }).ok, false);
});

test('export choices live in one settings registry', () => {
  assert.deepEqual(
    EXPORT_MODULES.map((x) => x.key),
    ['year-overview', 'year-calendar', 'bookshelf', 'book-notes', 'stats', 'month-stats'],
  );
});
