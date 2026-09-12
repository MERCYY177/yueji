import assert from 'node:assert/strict';
import fs from 'node:fs';

const normalizeCode = (value) =>
  String(value)
    .replace(/\s+/g, ' ')
    .replace(/\s*([{}()[\];,:?=+*<>!|&])\s*/g, '$1');
const strictMatch = assert.match.bind(assert),
  strictDoesNotMatch = assert.doesNotMatch.bind(assert);
assert.match = (actual, pattern, message) => strictMatch(normalizeCode(actual), pattern, message);
assert.doesNotMatch = (actual, pattern, message) =>
  strictDoesNotMatch(normalizeCode(actual), pattern, message);

const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const extension = fs.readFileSync(new URL('../yueji-extension.js', import.meta.url), 'utf8');
const features = fs.readFileSync(new URL('../yueji-features.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const style = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8');

assert.match(
  app,
  /function shouldReconcileBooks\(a,\s*b\)\s*\{\s*return sameSourceDuplicate\(a,\s*b\);?\s*\}/,
  'cross-source records must never be merged automatically',
);
assert.match(
  extension,
  /if\(!b\.sources\?\.includes\('weread'\)\)return/,
  'WeRead title indexes must not absorb Moon-only books',
);
assert.doesNotMatch(
  extension,
  /state\.books\.find\(b=>window\.yuejiCrossSourceMatch/,
  'WeRead import must not mutate a Moon-only book by title matching',
);
assert.match(
  features,
  /系统不会再自动跨来源合并/,
  'merge manager must explain that cross-source matching is suggestion-only',
);
assert.match(features, /已经合并 ·/, 'merge manager must reveal previously merged books');
assert.match(
  features,
  /data-split-book/,
  'previously merged books must offer a reversible split action',
);
assert.match(
  app,
  /window\.yuejiSplitMergedBook=splitMergedBook/,
  'split action must have a state implementation',
);
assert.match(
  app,
  /sourceArchives=\{/,
  'cross-source merges must preserve independent source records',
);
assert.match(app, /splitMergedBookLossless/, 'new merges must split from preserved source records');
assert.match(
  extension,
  /window\.yuejiPersistSplitWeReadBook=persistSplitWeReadBook/,
  'split WeRead records must be persisted incrementally',
);
const splitStart = app.indexOf('async function splitMergedBook');
const splitEnd = app.indexOf('window.yuejiSplitMergedBook', splitStart);
const split = app.slice(splitStart, splitEnd);
const normalizedSplit = normalizeCode(split);
assert.ok(
  normalizedSplit.indexOf('await window.yuejiPersistSplitWeReadBook') <
    normalizedSplit.indexOf('save();return'),
  'a split must persist its WeRead record before committing local state',
);
assert.match(
  split,
  /catch\(error\)[\s\S]*?try\{save\(\);?\}catch\{\}/,
  'a failed split must persist the rolled-back local state',
);
assert.match(
  app,
  /queueHighlightWrite\(async\(\)=>/,
  'source-specific highlight remapping must share the IndexedDB write queue',
);

assert.match(
  extension,
  /state\.weRead\.lastReport=/,
  'a completed sync must save a durable summary',
);
assert.match(
  extension,
  /最近一次完整同步/,
  'the sync panel must render the latest completion report',
);
assert.match(
  features,
  /if\(scale<0?\.5\)throw new Error\('LONG_PREVIEW_SVG'\)/,
  'very long exports must avoid an unreadably downscaled or crash-prone PNG',
);
assert.match(
  features,
  /避免手机生成超大 PNG 时卡死/,
  'mobile users must be told when a long export uses the safe vector fallback',
);
assert.match(
  features,
  /PREVIEW_CANCELLED/,
  'closing a long mobile preview must cancel incremental preparation work',
);
assert.match(
  features,
  /i\s*%\s*20===0/,
  'long exports must yield regularly instead of monopolizing the mobile main thread',
);
assert.match(
  features,
  /card\?\.id===['"]monthCalendarWrap['"]\?preparedCalendarPng/,
  'month calendar preview must use its prepared PNG renderer',
);
assert.match(
  features,
  /renderCalendarPng=async function[\s\S]*renderMonthCalendar/,
  'calendar export must rebuild the current month before capture',
);
assert.match(features, /renderMonthlyPng/, 'monthly reports must use a dedicated PNG renderer');
assert.match(
  features,
  /openModulePreview\(null,[\s\S]*preparedMonthlyPng\)/,
  'the monthly export action must rebuild the report before capture',
);
assert.match(
  features,
  /function roundedPath/,
  'canvas exports must not depend on the newer roundRect browser API',
);
assert.match(
  features,
  /yearReportRenderVersion/,
  'stale annual report renders must not overwrite a newer mode selection',
);
assert.match(
  features,
  /yearReportCache/,
  'annual report calculations must be reusable across mode switches',
);
assert.match(
  features,
  /ensureYearIndexes/,
  'annual report indexes must be rebuilt only when data changes',
);
assert.match(
  app,
  /\(window\.renderYearWall\|\|renderYearWall\)\(\)/,
  'page changes must use the optimized annual renderer instead of repainting the legacy wall',
);
assert.match(
  app,
  /window\.yuejiMarkDataRevision=\(\)=>\{sessionDateIndex=null;markDataRevision\(\);window\.dispatchEvent/,
  'incremental sync must invalidate caches and notify visible reports without a full archive save',
);
assert.match(
  extension,
  /window\.yuejiMarkDataRevision\?\.\(\)/,
  'each completed sync step must invalidate live UI caches',
);
assert.doesNotMatch(
  extension,
  /weReadSnapshots=rows[^\n]+slice\(-120\)/,
  'historical WeRead activity must not disappear after 120 snapshots',
);
assert.match(
  app,
  /yueji:data-changed/,
  'data mutations must expose a lightweight cache invalidation signal',
);
assert.doesNotMatch(
  app,
  /addEventListener\(['"]yueji:data-changed/,
  'data invalidation must not synchronously repaint every report',
);
assert.match(
  features,
  /for\(const s of state\.sessions\|\|\[\]\)/,
  'annual book identity must use raw per-book sessions independently of aggregate totals',
);
assert.match(
  features,
  /const scale=Math\.min\(w\s*\/\s*bmp\.width,h\s*\/\s*bmp\.height\)/,
  'exported covers must preserve their full aspect ratio',
);
const layout = fs.readFileSync(new URL('../yueji-layout.js', import.meta.url), 'utf8');
assert.doesNotMatch(
  layout,
  /if\(statsTab===['"]year['"]\)renderYearWall\(\)/,
  'statistics tabs must not call the legacy annual renderer directly',
);
assert.match(
  layout,
  /if\(statsTab===['"]year['"]\)\(window\.renderYearWall\|\|renderYearWall\)\(\)/,
  'statistics tabs must route annual rendering through the optimized renderer',
);
assert.match(
  app,
  /微信进度变化证据/,
  'monthly reports must include books backed by verified WeRead progress dates',
);
assert.match(app, /month-book-cover cover-art/, 'monthly reports must render real cover elements');
assert.match(html, /<title>阅迹<\/title>/, 'the initial browser title must be 阅迹');
assert.match(
  style,
  /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/,
  'mobile KPI columns must be allowed to shrink without overflowing',
);
assert.match(
  style,
  /\.library-top-row \.search\{[^}]*min-width:0/,
  'the mobile search box must be allowed to shrink inside its card',
);
const cacheKeys = [
  ...html.matchAll(/(?:style\.css|yueji-core\.js|app\.js|yueji-[^"?]+\.js)\?v=([^"']+)/g),
].map((row) => row[1]);
assert.ok(
  cacheKeys.length >= 10 && new Set(cacheKeys).size === 1,
  'stylesheet and runtime scripts must share one fresh cache key',
);
assert.doesNotMatch(
  html,
  /src="yueji-fix\.js/,
  'runtime scripts must use a deterministic static order instead of a nested loader',
);

const layoutInstallStart = layout.indexOf('function install()');
const layoutInstallEnd = layout.indexOf('document.readyState', layoutInstallStart);
const layoutInstall = layout.slice(layoutInstallStart, layoutInstallEnd);
assert.doesNotMatch(
  layoutInstall,
  /renderLibrary\(\)|coreRenderAnalytics\(\)|renderMonthly\(\)|renderYearWall/,
  'startup must not eagerly render hidden library and report modules',
);
assert.match(
  layoutInstall,
  /switchPage\(initialPage\)/,
  'startup must render only the visible page',
);
const yearModeInstallStart = features.indexOf('function installYearModes()');
const yearModeInstallEnd = features.indexOf('\n  function ', yearModeInstallStart + 1);
const yearModeInstall = features.slice(yearModeInstallStart, yearModeInstallEnd);
assert.doesNotMatch(
  yearModeInstall,
  /renderYearReport\(\);\s*$/,
  'annual reports must render only after their tab is opened',
);
assert.doesNotMatch(
  features,
  /new MutationObserver\(\(\)=>decorateModules\(\)\)/,
  'ordinary DOM updates must not rescan every report card',
);
assert.match(features, /打开设置后加载重复书籍/, 'quadratic duplicate review must be lazy-loaded');

console.log('PASS P2 merge control, sync report, evidence explanation and long-export safeguards');
