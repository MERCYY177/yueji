import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createReadingSnapshot,
  monthsNeedingFallback,
  monthlyReadTimesToDaily,
} from '../yueji-weread-reading.js';

test('annual official totals stay authoritative even when daily sum differs', () => {
  const snapshot = createReadingSnapshot({
    annual: { totalReadTime: 7200, readDays: 12, dailyReadTimes: { '2026-09-01': 60 } },
    year: 2026,
  });
  assert.equal(snapshot.yearSummary.totalReadTimeSeconds, 7200);
  assert.equal(snapshot.yearSummary.readDays, 12);
  assert.equal(snapshot.dailyByDate['2026-09-01'], 60);
});

test('annual daily data avoids monthly fallback requests', () => {
  assert.deepEqual(monthsNeedingFallback({ dailyReadTimes: { '2026-01-01': 60 } }, 2026, 9), []);
});

test('missing annual daily data falls back only through elapsed months', () => {
  assert.deepEqual(monthsNeedingFallback({ totalReadTime: 7200 }, 2026, 3), [1, 2, 3]);
});

test('monthly readTimes timestamp keys become calendar dates without creating absent dates', () => {
  const epoch = Math.floor(new Date('2026-09-02T00:00:00+08:00').getTime() / 1000);
  const daily = monthlyReadTimesToDaily(
    { readTimes: { [epoch]: 900 } },
    { timeZoneOffsetMinutes: 480 },
  );
  assert.deepEqual(daily, { '2026-09-02': 900 });
});

test('missing summaries remain unknown rather than zero', () => {
  const snapshot = createReadingSnapshot({ annual: {}, overall: {}, currentMonth: {}, year: 2026, month: 9 });
  assert.equal(snapshot.yearSummary.totalReadTimeSeconds, null);
  assert.equal(snapshot.overallSummary.readDays, null);
  assert.equal(snapshot.currentMonthSummary.totalReadTimeSeconds, null);
});

test('reading snapshot records which months have authoritative daily completeness', () => {
  const annual = createReadingSnapshot({
    annual: { dailyReadTimes: { '2026-01-03': 60 } },
    year: 2026,
    month: 3,
  });
  assert.deepEqual(annual.completeMonths, ['2026-01', '2026-02', '2026-03']);
  assert.equal(annual.dailySource, 'annual-daily');

  const fallback = createReadingSnapshot({
    annual: {},
    monthly: {
      '01': { readTimes: { '2026-01-03': 60 } },
      '02': { readTimes: {} },
    },
    year: 2026,
    month: 3,
  });
  assert.deepEqual(fallback.completeMonths, ['2026-01', '2026-02']);
  assert.equal(fallback.dailySource, 'monthly-fallback');
});
