import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../yueji-weread-finished-cover-fix.js', import.meta.url), 'utf8');
const core = fs.readFileSync(new URL('../yueji-core.js', import.meta.url), 'utf8');
const build = fs.readFileSync(new URL('../scripts/build.mjs', import.meta.url), 'utf8');
const serviceWorker = fs.readFileSync(new URL('../service-worker.js', import.meta.url), 'utf8');

const state = {
  books: [
    {
      key: 'crime',
      title: '罪与罚',
      weReadBookId: 'crime-weread',
      sources: ['weread'],
      progress: 0,
      status: 'unread',
    },
  ],
  weRead: {
    shelfBooks: [
      {
        bookId: 'crime-weread',
        title: '罪与罚',
        finishReading: '1',
        cover: 'https://example.test/crime.jpg',
      },
    ],
  },
};
let saved = 0;
let rendered = 0;
class HTMLImageElement {}
const context = {
  window: null,
  globalThis: null,
  state,
  save() {
    saved++;
  },
  renderAll() {
    rendered++;
  },
  sessionStorage: { getItem: () => null },
  document: {
    readyState: 'complete',
    getElementById: () => null,
    addEventListener() {},
  },
  MutationObserver: class {
    observe() {}
  },
  HTMLImageElement,
  setTimeout,
  clearTimeout,
  Date,
  Number,
  String,
  Boolean,
  Map,
  Set,
  Promise,
  console,
};
context.window = context;
context.globalThis = context;
context.Yueji = {};
vm.runInNewContext(source, context, { filename: 'yueji-weread-finished-cover-fix.js' });

assert.equal(context.Yueji.isWeReadFinished({ finishReading: true }), true);
assert.equal(context.Yueji.isWeReadFinished({ finishReading: '1' }), true);
assert.equal(context.Yueji.isWeReadFinished({ finishReading: 'true' }), true);
assert.equal(context.Yueji.isWeReadFinished({ finishReading: 0, progress: 100 }), true);
assert.equal(context.Yueji.isWeReadFinished({ finishReading: 0, progress: 20 }), false);
assert.equal(state.books[0].progress, 100, 'finished shelf evidence must repair a stale 0% progress');
assert.equal(state.books[0].status, 'done', 'finished shelf evidence must repair the local status');
assert.equal(state.books[0].weReadCover, 'https://example.test/crime.jpg');
assert.ok(saved > 0, 'repaired finished-book state must be persisted');
assert.ok(rendered > 0, 'repaired state must refresh the UI');

assert.match(source, /img\.dataset\.coverFallback\s*=\s*fallback/);
assert.match(source, /img\.src\s*=\s*img\.dataset\.coverFallback/);
assert.match(core, /yueji-weread-finished-cover-fix\.js/);
assert.match(build, /yueji-weread-finished-cover-fix\.js/);
assert.match(serviceWorker, /yueji-weread-finished-cover-fix\.js/);
