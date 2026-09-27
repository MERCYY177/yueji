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
  if (!Object.keys(dailyByDate).length) {
    for (const value of Object.values(monthly || {})) {
      dailyByDate = mergeDailyBuckets(
        dailyByDate,
        monthlyReadTimesToDaily(value, { timeZoneOffsetMinutes }),
      );
    }
  }
  return {
    yearSummary,
    overallSummary,
    currentMonthSummary,
    dailyByDate,
    monthlyBuckets: monthly,
  };
}
