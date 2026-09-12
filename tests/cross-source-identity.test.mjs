import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const start = app.indexOf('function identityText');
const end = app.indexOf('async function reconcileCrossSourceBooks()', start);
assert.ok(start >= 0 && end > start, 'cross-source identity helpers must exist');

const state = {
  books: [
    {
      key: 'wr:1',
      title: '罪与罚（名著名译丛书）',
      author: '（俄）陀思妥耶夫斯基',
      sources: ['weread'],
      weReadBookId: '1',
      progress: 22,
    },
    {
      key: 'moon:crime',
      title: '罪与罚（名著名译丛书）',
      author: '陀思妥耶夫斯基',
      sources: ['moon'],
      file: '罪与罚.epub',
      minutes: 53,
    },
    {
      key: 'wr:2',
      title: '艺术的故事',
      author: '贡布里希',
      sources: ['weread'],
      weReadBookId: '2',
    },
    {
      key: 'moon:art',
      title: '艺术的故事',
      author: '',
      sources: ['moon'],
      file: 'books/艺术的故事.epub',
      minutes: 28,
    },
    {
      key: 'moon:art-stale',
      title: '艺术的故事',
      author: '',
      sources: ['moon'],
      file: '艺术的故事.epub',
      minutes: 28,
    },
  ],
  sessions: [
    { date: '2026-09-03', bookKey: 'wr:1', source: 'weread' },
    { date: '2026-09-04', bookKey: 'moon:crime', source: 'moon', minutes: 53 },
    { date: '2026-09-05', bookKey: 'moon:art-stale', source: 'moon', minutes: 28 },
  ],
  journals: { '2026-09-03': { bookKey: 'wr:1' } },
  highlights: [{ id: 'h1', bookKey: 'wr:2' }],
};
const context = {
  state,
  Map,
  Set,
  String,
  Number,
  Object,
  Array,
  Math,
  canonicalFile: (value) =>
    String(value || '')
      .replace(/\\/g, '/')
      .split('/')
      .pop()
      .toLowerCase(),
};
vm.runInNewContext(
  `${app.slice(start, end)};globalThis.result=reconcileCrossSourceBooksInMemory()`,
  context,
);
assert.equal(context.result.changed, true);
assert.equal(
  state.books.length,
  4,
  'automatic reconciliation must remove only same-source importer duplicates',
);
assert.equal(
  state.books.some((book) => book.sources.includes('moon') && book.sources.includes('weread')),
  false,
  'cross-source books must remain separate until the user confirms',
);
assert.equal(
  state.sessions[0].bookKey,
  'wr:1',
  'WeRead sessions must not be silently moved to Moon Reader',
);
assert.equal(
  state.journals['2026-09-03'].bookKey,
  'wr:1',
  'journals must not be silently moved across sources',
);
assert.equal(
  state.highlights[0].bookKey,
  'wr:2',
  'WeRead highlights must not be silently moved across sources',
);
assert.equal(
  state.books.filter((book) => book.title === '艺术的故事' && book.sources.includes('moon')).length,
  1,
  'path aliases for the same Moon Reader file must not survive as duplicate books',
);

const cover = fs.readFileSync(new URL('../yueji-book-cover.js', import.meta.url), 'utf8');
assert.equal(
  /renderYearCalendar\s*=/.test(cover),
  false,
  'late-loaded cover script must not replace the year renderer',
);
console.log('PASS cross-source migration and runtime year-calendar ownership');
