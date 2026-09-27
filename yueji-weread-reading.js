import {
  normalizePeriodSummary,
  normalizeDailyReadTimes,
  mergeDailyBuckets,
} from './yueji-reading-model.js';

export function monthsNeedingFallback(annual = {}, year, throughMonth = 12) {
  const daily = annual?.dailyReadTimes;
  if (daily && typeof daily === 'object' && Object.keys(daily).length) return [];
  const end = Math.max(0, Math.min(12, Number(throughMonth) || 0));
  return Array.from({ length: end }, (_, index) => index + 1);
}

export function monthlyReadTimesToDaily(raw = {}, context = {}) {
  const source =
    raw.dailyReadTimes && typeof raw.dailyReadTimes === 'object'
      ? raw.dailyReadTimes
      : raw.readTimes && typeof raw.readTimes === 'object'
        ? raw.readTimes
        : {};
  return normalizeDailyReadTimes(source, context);
}

export function createReadingSnapshot({
  annual = {},
  overall = {},
  currentMonth = {},
  monthly = {},
  year = null,
  month = null,
  timeZoneOffsetMinutes = 0,
} = {}) {
  const yearSummary = normalizePeriodSummary(annual, 'annually', { year });
  const overallSummary = normalizePeriodSummary(overall, 'overall');
  const currentMonthSummary = normalizePeriodSummary(currentMonth, 'monthly', { year, month });
  let dailyByDate = normalizeDailyReadTimes(annual, { timeZoneOffsetMinutes });
  let dailySource = 'missing';
  let completeMonths = [];
  if (Object.keys(dailyByDate).length) {
    dailySource = 'annual-daily';
    const through = Math.max(0, Math.min(12, Number(month) || 12));
    completeMonths = Array.from(
      { length: through },
      (_, index) => `${year}-${String(index + 1).padStart(2, '0')}`,
    );
  } else {
    const completed = [];
    for (const [monthKey, value] of Object.entries(monthly || {})) {
      dailyByDate = mergeDailyBuckets(
        dailyByDate,
        monthlyReadTimesToDaily(value, { timeZoneOffsetMinutes }),
      );
      const numericMonth = Number(monthKey);
      if (year && numericMonth >= 1 && numericMonth <= 12)
        completed.push(`${year}-${String(numericMonth).padStart(2, '0')}`);
    }
    if (completed.length) {
      dailySource = 'monthly-fallback';
      completeMonths = [...new Set(completed)].sort();
    }
  }
  return {
    yearSummary,
    overallSummary,
    currentMonthSummary,
    dailyByDate,
    monthlyBuckets: monthly,
    dailySource,
    completeMonths,
  };
}
