export const NAV_ITEMS = [
  { key: 'today', label: '首页' },
  { key: 'calendar', label: '书架' },
  { key: 'notes', label: '笔记' },
  { key: 'analytics', label: '统计' },
];

export function formatMetric(value) {
  if (value === null || value === undefined || value === '') return '暂无数据';
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString('zh-CN') : '暂无数据';
}

export function formatDuration(seconds) {
  if (seconds === null || seconds === undefined || seconds === '') return '暂无数据';
  const value = Number(seconds);
  if (!Number.isFinite(value)) return '暂无数据';
  const minutes = Math.round(value / 60);
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = value / 3600;
  return Number.isInteger(hours) ? `${hours} 小时` : `${hours.toFixed(1)} 小时`;
}

export function statsView(key) {
  const views = {
    month: { key: 'month', label: '本月', mode: 'monthly' },
    year: { key: 'year', label: '今年', mode: 'annually' },
    all: { key: 'all', label: '全部', mode: 'overall' },
  };
  return views[key] || views.year;
}
