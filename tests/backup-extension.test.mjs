import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../yueji-backup-extension.js', import.meta.url), 'utf8');

function storage(seed = {}) {
  const data = new Map(Object.entries(seed));
  return {
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(key, String(value));
    },
    removeItem(key) {
      data.delete(key);
    },
    dump() {
      return Object.fromEntries(data);
    },
  };
}

function boot(seed = {}) {
  const localStorage = storage(seed);
  let restoredPayload = null;
  const events = [];
  const context = {
    localStorage,
    buildPortableBackup: async () => ({ books: [{ key: 'a' }], localCovers: [{ bookKey: 'a' }] }),
    replaceArchiveData: async (value) => {
      restoredPayload = value;
      return true;
    },
    CustomEvent: class {
      constructor(type, init = {}) {
        this.type = type;
        this.detail = init.detail;
      }
    },
    window: {
      dispatchEvent(event) {
        events.push(event);
      },
    },
  };
  vm.runInNewContext(source, context);
  return { context, localStorage, events, getRestoredPayload: () => restoredPayload };
}

test('portable backup includes profile, appearance and official summary but never a Skill Key', async () => {
  const { context } = boot({
    'yueji-appearance-settings-v1': JSON.stringify({ pageFont: 'huiwen' }),
    'yueji-profile-v1': JSON.stringify({ nickname: '小树', signature: 'hello' }),
    'yueji-reading-summary-v1': JSON.stringify({ year: 2026, yearSummary: { readDays: 12 } }),
    'yueji-weread-key': 'secret-must-not-export',
  });
  const payload = await context.buildPortableBackup();
  assert.equal(payload.yuejiUnified.appearance.pageFont, 'huiwen');
  assert.equal(payload.yuejiUnified.profile.nickname, '小树');
  assert.equal(payload.yuejiUnified.officialReadingSummary.year, 2026);
  assert.equal(payload.yuejiUnified.customFontIncluded, false);
  assert.equal(JSON.stringify(payload).includes('secret-must-not-export'), false);
  assert.deepEqual(payload.books, [{ key: 'a' }]);
  assert.deepEqual(payload.localCovers, [{ bookKey: 'a' }]);
});

test('portable restore strips metadata before the original archive importer and restores UI metadata', async () => {
  const { context, localStorage, events, getRestoredPayload } = boot();
  const input = {
    books: [{ key: 'b' }],
    yuejiUnified: {
      appearance: { pageFont: 'system' },
      profile: { nickname: 'D', signature: '' },
      officialReadingSummary: { year: 2026, overallSummary: { readDays: 30 } },
    },
  };
  assert.equal(await context.replaceArchiveData(input, false), true);
  assert.equal(JSON.stringify(getRestoredPayload()), JSON.stringify({ books: [{ key: 'b' }] }));
  const saved = localStorage.dump();
  assert.equal(JSON.parse(saved['yueji-appearance-settings-v1']).pageFont, 'system');
  assert.equal(JSON.parse(saved['yueji-profile-v1']).nickname, 'D');
  assert.equal(JSON.parse(saved['yueji-reading-summary-v1']).year, 2026);
  assert.ok(events.some((event) => event.type === 'yueji:reading-summary'));
  assert.ok(events.some((event) => event.type === 'yueji:unified-settings-restored'));
});
