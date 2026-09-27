export const EXPORT_MODULES = [
  { key: 'year-overview', label: '年度概览' },
  { key: 'year-calendar', label: '全年日历' },
  { key: 'bookshelf', label: '书架' },
  { key: 'book-notes', label: '某一本书的笔记' },
  { key: 'stats', label: '阅读统计' },
  { key: 'month-stats', label: '当前月份统计' },
];

export function normalizeFontMode(value) {
  return ['system', 'huiwen', 'custom'].includes(value) ? value : 'system';
}

export function validateCustomFontFile(file = {}) {
  const name = String(file.name || '').toLowerCase();
  const size = Number(file.size) || 0;
  const extensionOk = /\.(woff2?|ttf|otf)$/.test(name);
  if (!extensionOk) return { ok: false, reason: '只支持 WOFF2 / WOFF / TTF / OTF 字体' };
  if (size <= 0 || size > 20 * 1024 * 1024)
    return { ok: false, reason: '字体文件必须小于 20MB' };
  return { ok: true, reason: '' };
}
