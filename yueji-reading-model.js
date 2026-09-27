const asFiniteOrNull = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const pad = (value) => String(value).padStart(2, '0');

function dateKeyFromEpoch(value, offsetMinutes = 0) {
  const number = Number(value);
  if (!Number.isFinite(number) || !number) return '';
  const milliseconds = number < 1e12 ? number * 1000 : number;
  const shifted = new Date(milliseconds + Number(offsetMinutes || 0) * 60_000);
  if (Number.isNaN(shifted.getTime())) return '';
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

function normalizeDateKey(rawKey, context = {}) {
  const key = String(rawKey || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(key)) return key;
  if (/^\d{8}$/.test(key)) return `${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}`;
  if (/^\d{10,13}$/.test(key)) return dateKeyFromEpoch(Number(key), context.timeZoneOffsetMinutes);
  return '';
}

export function normalizePeriodSummary(raw = {}, mode, context = {}) {
  if (!['monthly', 'annually', 'overall'].includes(mode)) {
    throw new TypeError(`Unsupported reading period mode: ${mode}`);
  }
  const totalReadTimeSeconds = asFiniteOrNull(raw.totalReadTime ?? raw.totalReadTimeSeconds);
  const readDays = asFiniteOrNull(raw.readDays);
  const booksRead = asFiniteOrNull(raw.booksRead ?? raw.books_read);
  const booksFinished = asFiniteOrNull(raw.booksFinished ?? raw.books_finished);
  const notesCount = asFiniteOrNull(raw.notesCount ?? raw.notes_count);
  const hasDaily = raw.dailyReadTimes && typeof raw.dailyReadTimes === 'object';
  const hasBuckets = raw.readTimes && (Array.isArray(raw.readTimes) || typeof raw.readTimes === 'object');
  return {
    mode,
    year: context.year ?? null,
    month: context.month ?? null,
    totalReadTimeSeconds,
    readDays,
    booksRead,
    booksFinished,
    notesCount,
    readTimes: raw.readTimes ?? null,
    dailyReadTimes: raw.dailyReadTimes ?? null,
    sourceCompleteness: {
      summary: totalReadTimeSeconds !== null || readDays !== null,
      daily: Boolean(hasDaily),
      buckets: Boolean(hasBuckets),
    },
  };
}

export function normalizeDailyReadTimes(raw = {}, context = {}) {
  const source = raw.dailyReadTimes && typeof raw.dailyReadTimes === 'object' ? raw.dailyReadTimes : raw;
  const result = {};
  for (const [rawKey, rawValue] of Object.entries(source || {})) {
    const key = normalizeDateKey(rawKey, context);
    if (!key) continue;
    result[key] = asFiniteOrNull(rawValue);
  }
  return result;
}

export function mergeDailyBuckets(base = {}, incoming = {}) {
  const result = { ...(base || {}) };
  for (const [key, value] of Object.entries(incoming || {})) {
    if (!(key in result) || result[key] === null || value !== null) result[key] = value;
  }
  return result;
}

export function bookCompletionEvidence(book = {}) {
  const reasons = [];
  if (book.finishReading === true) reasons.push('finishReading');
  const progress = asFiniteOrNull(book.progress ?? book.readingProgress);
  if (progress !== null && progress >= 100) reasons.push('progress');
  if (book.finishTime !== null && book.finishTime !== undefined && book.finishTime !== '') reasons.push('finishTime');
  return { finished: reasons.length > 0, reasons };
}

const normalizeIdentityText = (value) =>
  String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[《》〈〉「」『』“”"'‘’·•:：,，.。!！?？\-—_()（）\[\]【】<>\s]/g, '');

const normalizeAuthor = (value) => normalizeIdentityText(value).replace(/著|编|译|作者/g, '');

export function mergeBookIdentity(existing = {}, incoming = {}) {
  const source = String(incoming.source || '');
  const sourceId = String(incoming.sourceId ?? incoming.bookId ?? incoming.weReadBookId ?? '');
  const existingSourceId = source
    ? String(existing.sourceIds?.[source] ?? (source === 'weread' ? existing.weReadBookId : '') ?? '')
    : '';
  if (source && sourceId && existingSourceId && sourceId === existingSourceId) {
    return { matches: true, reason: 'source-id' };
  }

  const leftTitle = normalizeIdentityText(existing.title ?? existing.name);
  const rightTitle = normalizeIdentityText(incoming.title ?? incoming.name);
  const leftAuthor = normalizeAuthor(existing.author ?? existing.authorName);
  const rightAuthor = normalizeAuthor(incoming.author ?? incoming.authorName);
  if (leftTitle && rightTitle && leftTitle === rightTitle && leftAuthor && rightAuthor && leftAuthor === rightAuthor) {
    return { matches: true, reason: 'title-author' };
  }
  return { matches: false, reason: 'different' };
}
