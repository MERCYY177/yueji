import assert from 'node:assert/strict';
import fs from 'node:fs';

const extension = fs.readFileSync(new URL('../yueji-extension.js', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');

assert.match(
  extension,
  /function\s+isWeReadFinished\s*\(/,
  'WeRead completion must use one normalized predicate instead of strict finishReading === 1 checks',
);
assert.doesNotMatch(
  extension,
  /finishReading\s*===\s*1/,
  'boolean/string finishReading values must not be dropped by strict numeric comparisons',
);
assert.match(
  extension,
  /finished\s*\?\s*100\s*:/,
  'a book explicitly marked finished by WeRead must render as 100% even when progress detail is missing',
);
assert.match(
  app,
  /data-cover-fallback=/,
  'year-wall covers must carry a source-cover fallback when no local IndexedDB blob exists',
);
assert.match(
  app,
  /img\.src\s*=\s*img\.dataset\.coverFallback/,
  'cover hydration must fall back to book.cover / book.weReadCover when IndexedDB has no blob',
);
