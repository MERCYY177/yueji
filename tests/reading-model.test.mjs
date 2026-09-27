import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePeriodSummary,
  normalizeDailyReadTimes,
  mergeDailyBuckets,
  bookCompletionEvidence,
  mergeBookIdentity,
} from '../yueji-reading-model.js';

test('period summary preserves upstream totals and distinguishes missing from zero', () => {
  const annual = normalizePeriodSummary({ totalReadTime: 7200, readDays: 12 }, 'annually', { year: 2026 });
  assert.equal(annual.mode, 'annually');
  assert.equal(annual.totalReadTimeSeconds, 7200);
  assert.equal(annual.readDays, 12);
  assert.equal(annual.year, 2026);
  const missing = normalizePeriodSummary({}, 'overall');
  assert.equal(missing.totalReadTimeSeconds, null);
  assert.equal(missing.readDays, null);
  const zero = normalizePeriodSummary({ totalReadTime: 0, readDays: 0 }, 'monthly', { year: 2026, month: 9 });
  assert.equal(zero.totalReadTimeSeconds, 0);
  assert.equal(zero.readDays, 0);
  assert.equal(zero.mode, 'monthly');
});

test('dailyReadTimes supports date and epoch keys without inventing missing dates', () => {
  const epoch = Math.floor(new Date('2026-09-02T00:00:00+08:00').getTime() / 1000);
  const daily = normalizeDailyReadTimes({ dailyReadTimes: { '2026-09-01': 1200, [epoch]: 900 } }, { timeZoneOffsetMinutes: 480 });
  assert.equal(daily['2026-09-01'], 1200);
  assert.equal(daily['2026-09-02'], 900);
  assert.equal(daily['2026-09-03'], undefined);
});

test('mergeDailyBuckets keeps explicit zero and lets known incoming data fill missing entries', () => {
  const merged = mergeDailyBuckets({ '2026-09-01': null, '2026-09-02': 0 }, { '2026-09-01': 600, '2026-09-03': null });
  assert.deepEqual(merged, { '2026-09-01': 600, '2026-09-02': 0, '2026-09-03': null });
});

test('book completion accepts any authoritative completion evidence', () => {
  assert.equal(bookCompletionEvidence({ finishReading: true }).finished, true);
  assert.equal(bookCompletionEvidence({ progress: 100 }).finished, true);
  assert.equal(bookCompletionEvidence({ finishTime: 123 }).finished, true);
  assert.equal(bookCompletionEvidence({ progress: 65 }).finished, false);
});

test('book identity merges stable source id or normalized title+author but not same title with different author', () => {
  const byId = mergeBookIdentity(
    { title: '黑暗的左手', author: '厄休拉·勒古恩', sourceIds: { weread: 'wr1' } },
    { title: 'The Left Hand of Darkness', author: 'Ursula K. Le Guin', source: 'weread', sourceId: 'wr1' },
  );
  assert.equal(byId.matches, true);
  assert.equal(byId.reason, 'source-id');

  const byText = mergeBookIdentity(
    { title: ' 黑暗的左手 ', author: '厄休拉·勒古恩' },
    { title: '《黑暗的左手》', author: '厄休拉 勒古恩' },
  );
  assert.equal(byText.matches, true);
  assert.equal(byText.reason, 'title-author');

  const collision = mergeBookIdentity(
    { title: '同名书', author: '作者甲' },
    { title: '同名书', author: '作者乙' },
  );
  assert.equal(collision.matches, false);
});
