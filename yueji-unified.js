import { createReadingSnapshot, monthsNeedingFallback } from './yueji-weread-reading.js';
import { formatDuration, formatMetric } from './yueji-unified-ui-model.js';

const SUMMARY_KEY = 'yueji-reading-summary-v1';
const SESSION_KEY = 'yueji-weread-key';
const LEGACY_KEY = 'yueji-weread-key';
const LEGACY_PERSIST = 'yueji-weread-key-persist-v1';
const GATEWAY = '/.netlify/functions/weread-gateway';

function loadCachedSummary() {
  try {
    return JSON.parse(localStorage.getItem(SUMMARY_KEY) || 'null');
  } catch {
    return null;
  }
}
function saveCachedSummary(value) {
  localStorage.setItem(SUMMARY_KEY, JSON.stringify(value));
}
function migrateLegacyKeyToSession() {
  try {
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy && !sessionStorage.getItem(SESSION_KEY)) sessionStorage.setItem(SESSION_KEY, legacy);
    localStorage.removeItem(LEGACY_KEY);
    localStorage.removeItem(LEGACY_PERSIST);
  } catch {}
}
async function wereadCall(key, apiName, params = {}) {
  const response = await fetch(GATEWAY, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_name: apiName, skill_version: '1.0.4', ...params }),
  });
  const payload = await response.json();
  if (!response.ok || (payload?.errcode && payload.errcode !== 0))
    throw new Error(payload?.errmsg || payload?.message || `微信读书接口错误（${response.status}）`);
  return payload?.data && typeof payload.data === 'object' ? payload.data : payload;
}
function monthBaseTime(year, month) {
  return Math.floor(new Date(year, month - 1, 15, 12, 0, 0).getTime() / 1000);
}
export async function syncOfficialReadingSummary() {
  const key = sessionStorage.getItem(SESSION_KEY) || '';
  if (!key) return loadCachedSummary();
  const now = new Date(),
    year = now.getFullYear(),
    month = now.getMonth() + 1;
  const annual = await wereadCall(key, '/readdata/detail', {
    mode: 'annually',
    baseTime: monthBaseTime(year, month),
  });
  const overall = await wereadCall(key, '/readdata/detail', {
    mode: 'overall',
    baseTime: monthBaseTime(year, month),
  });
  const currentMonth = await wereadCall(key, '/readdata/detail', {
    mode: 'monthly',
    baseTime: monthBaseTime(year, month),
  });
  const monthly = {};
  for (const m of monthsNeedingFallback(annual, year, month)) {
    monthly[String(m).padStart(2, '0')] =
      m === month
        ? currentMonth
        : await wereadCall(key, '/readdata/detail', {
            mode: 'monthly',
            baseTime: monthBaseTime(year, m),
          });
  }
  const snapshot = createReadingSnapshot({
    annual,
    overall,
    currentMonth,
    monthly,
    year,
    month,
    timeZoneOffsetMinutes: -now.getTimezoneOffset(),
  });
  const value = { ...snapshot, syncedAt: Date.now(), year, month };
  saveCachedSummary(value);
  window.dispatchEvent(new CustomEvent('yueji:reading-summary', { detail: value }));
  return value;
}

function injectStyles() {
  if (document.getElementById('yuejiUnifiedStyles')) return;
  const style = document.createElement('style');
  style.id = 'yuejiUnifiedStyles';
  style.textContent = `
    .unified-year-card{margin-top:16px}.unified-summary-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-top:14px}.unified-summary-item{padding:14px;border:1px solid var(--line);border-radius:16px;background:var(--soft)}.unified-summary-item b{display:block;font-size:1.25rem}.unified-summary-item span{display:block;margin-top:5px;color:var(--muted);font-size:.72rem}.unified-year-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin-top:18px}.unified-month{padding:10px;border:1px solid var(--line);border-radius:14px}.unified-month>strong{display:block;margin-bottom:8px;font-size:.8rem}.unified-week,.unified-days{display:grid;grid-template-columns:repeat(7,1fr);gap:3px}.unified-week span{font-size:.55rem;text-align:center;color:var(--muted)}.unified-day{aspect-ratio:1;border-radius:3px;background:var(--soft);font-size:0}.unified-day.read{background:rgba(var(--accent-rgb),var(--level))}.unified-day.missing{outline:1px dashed color-mix(in srgb,var(--muted) 25%,transparent);outline-offset:-1px;background:transparent}.unified-day.pad{background:transparent}.unified-settings-export{display:grid;gap:8px}.unified-settings-export button{width:100%;text-align:left}.unified-sync-note{margin-top:7px;color:var(--muted);font-size:.72rem}.unified-official-card{margin:0 0 16px}.unified-official-title{display:flex;justify-content:space-between;gap:12px;align-items:end}.unified-official-title small{color:var(--muted);font-size:.7rem}.yueji-unified-hide{display:none!important}
    @media(max-width:760px){.unified-summary-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.unified-year-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:430px){.unified-year-grid{grid-template-columns:1fr}}
  `;
  document.head.append(style);
}
function renderCalendar(snapshot) {
  const target = document.getElementById('unifiedYearGrid');
  if (!target) return;
  const year = snapshot?.year || new Date().getFullYear();
  const daily = snapshot?.dailyByDate || {};
  const completeMonths = new Set(Array.isArray(snapshot?.completeMonths) ? snapshot.completeMonths : []);
  const max = Math.max(
    1,
    ...Object.values(daily)
      .filter((v) => Number.isFinite(Number(v)))
      .map(Number),
  );
  const weekdays = ['一', '二', '三', '四', '五', '六', '日'];
  target.innerHTML = Array.from({ length: 12 }, (_, index) => {
    const month = index + 1;
    const monthKey = `${year}-${String(month).padStart(2, '0')}`;
    const monthComplete = completeMonths.has(monthKey);
    const first = new Date(year, index, 1);
    const days = new Date(year, month, 0).getDate();
    const pad = (first.getDay() + 6) % 7;
    const cells = Array.from({ length: pad }, () => '<i class="unified-day pad"></i>');
    for (let day = 1; day <= days; day++) {
      const key = `${monthKey}-${String(day).padStart(2, '0')}`;
      const has = Object.prototype.hasOwnProperty.call(daily, key);
      const seconds = has ? daily[key] : null;
      const read = Number(seconds) > 0;
      const level = read ? Math.max(0.22, Math.min(0.9, Number(seconds) / max)) : 0;
      const cls = read ? ' read' : !has && !monthComplete ? ' missing' : '';
      const title = has
        ? `${key} · ${Math.round(Number(seconds || 0) / 60)} 分钟`
        : monthComplete
          ? `${key} · 0 分钟`
          : `${key} · 暂无日级明细`;
      cells.push(`<i class="unified-day${cls}" style="--level:${level}" title="${title}"></i>`);
    }
    return `<div class="unified-month"><strong>${month}月${monthComplete ? '' : ' · 明细待补'}</strong><div class="unified-week">${weekdays.map((x) => `<span>${x}</span>`).join('')}</div><div class="unified-days">${cells.join('')}</div></div>`;
  }).join('');
}
function renderSummary(snapshot = loadCachedSummary()) {
  const card = document.getElementById('unifiedYearCard');
  if (!card) return;
  const summary = snapshot?.yearSummary || {};
  const year = snapshot?.year || new Date().getFullYear();
  card.querySelector('[data-unified-year-title]').textContent = `${year} 阅读一年`;
  card.querySelector('[data-kpi="time"]').textContent = formatDuration(summary.totalReadTimeSeconds);
  card.querySelector('[data-kpi="days"]').textContent = formatMetric(summary.readDays);
  card.querySelector('[data-kpi="books"]').textContent = formatMetric(summary.booksRead);
  card.querySelector('[data-kpi="finished"]').textContent = formatMetric(summary.booksFinished);
  const note = card.querySelector('.unified-sync-note');
  const completeness = snapshot?.dailySource === 'annual-daily'
    ? '日历来自年度日级明细。'
    : snapshot?.dailySource === 'monthly-fallback'
      ? '年度接口未给出日级明细，已按月补齐可确认月份。'
      : '当前还没有可确认的日级明细。';
  note.textContent = snapshot?.syncedAt
    ? `阅读统计更新于 ${new Date(snapshot.syncedAt).toLocaleString('zh-CN', { hour12: false })} · ${completeness}`
    : '同步微信读书后，这里显示官方年度统计；缺失数据不会被写成 0。';
  renderCalendar(snapshot);
}
function installHome() {
  const home = document.querySelector('.page[data-page="today"]');
  if (!home || document.getElementById('unifiedYearCard')) return;
  const card = document.createElement('div');
  card.id = 'unifiedYearCard';
  card.className = 'card unified-year-card';
  card.innerHTML = `<div class="section-head"><div><div class="section-title" data-unified-year-title>阅读一年</div><div class="section-sub">微信读书官方年度汇总 + 真实日级日历</div></div></div><div class="unified-summary-grid"><div class="unified-summary-item"><b data-kpi="time">暂无数据</b><span>今年阅读时长</span></div><div class="unified-summary-item"><b data-kpi="days">暂无数据</b><span>今年阅读天数</span></div><div class="unified-summary-item"><b data-kpi="books">暂无数据</b><span>今年读过</span></div><div class="unified-summary-item"><b data-kpi="finished">暂无数据</b><span>今年读完</span></div></div><div id="unifiedYearGrid" class="unified-year-grid"></div><div class="unified-sync-note"></div>`;
  const dashboard = document.getElementById('homeDashboard');
  home.insertBefore(card, dashboard || null);
  renderSummary();
}
function installFourTabs() {
  const nav = document.querySelector('.bottom-nav');
  if (!nav) return;
  nav.querySelector('[data-go="calendar"]')?.remove();
  const today = nav.querySelector('[data-go="today"]');
  const library = nav.querySelector('[data-go="library"]');
  const notes = nav.querySelector('[data-go="notes"]');
  const analytics = nav.querySelector('[data-go="analytics"]');
  if (today) today.innerHTML = '<span>⌂</span>首页';
  if (library) library.innerHTML = '<span>▤</span>书架';
  nav.replaceChildren(...[today, library, notes, analytics].filter(Boolean));
}
function activeStatsTab() {
  return document.querySelector('#statsTabs [data-stats-tab].active')?.dataset.statsTab || 'overview';
}
function periodSummary(snapshot, tab) {
  if (!snapshot) return {};
  if (tab === 'month') return snapshot.currentMonthSummary || {};
  if (tab === 'year') return snapshot.yearSummary || {};
  return snapshot.overallSummary || {};
}
function renderOfficialStats(snapshot = loadCachedSummary(), tab = activeStatsTab()) {
  const card = document.getElementById('unifiedOfficialStats');
  if (!card) return;
  const summary = periodSummary(snapshot, tab);
  const label = tab === 'month' ? '本月' : tab === 'year' ? '今年' : '全部';
  card.querySelector('[data-official-label]').textContent = `${label} · 微信读书官方统计`;
  card.querySelector('[data-official-time]').textContent = formatDuration(summary.totalReadTimeSeconds);
  card.querySelector('[data-official-days]').textContent = formatMetric(summary.readDays);
  card.querySelector('[data-official-books]').textContent = formatMetric(summary.booksRead);
  card.querySelector('[data-official-finished]').textContent = formatMetric(summary.booksFinished);
  card.querySelector('[data-official-note]').textContent = snapshot?.syncedAt
    ? `官方汇总更新于 ${new Date(snapshot.syncedAt).toLocaleString('zh-CN', { hour12: false })}；没有返回的字段显示“暂无数据”。`
    : '连接微信读书并同步后显示；缺失字段不会按 0 处理。';
}
function installOfficialStats() {
  const analytics = document.querySelector('.page[data-page="analytics"]');
  const tabs = document.getElementById('statsTabs');
  if (!analytics || !tabs || document.getElementById('unifiedOfficialStats')) return;
  const card = document.createElement('div');
  card.id = 'unifiedOfficialStats';
  card.className = 'card unified-official-card';
  card.innerHTML = `<div class="unified-official-title"><b data-official-label>微信读书官方统计</b><small>官方汇总与本地聚合分开显示</small></div><div class="unified-summary-grid"><div class="unified-summary-item"><b data-official-time>暂无数据</b><span>阅读时长</span></div><div class="unified-summary-item"><b data-official-days>暂无数据</b><span>阅读天数</span></div><div class="unified-summary-item"><b data-official-books>暂无数据</b><span>读过</span></div><div class="unified-summary-item"><b data-official-finished>暂无数据</b><span>读完</span></div></div><div class="unified-sync-note" data-official-note></div>`;
  tabs.insertAdjacentElement('afterend', card);
  tabs.addEventListener('click', () => queueMicrotask(() => renderOfficialStats(loadCachedSummary(), activeStatsTab())));
  renderOfficialStats();
}
function installStatsTabs() {
  const tabs = document.getElementById('statsTabs');
  if (!tabs) return;
  const month = tabs.querySelector('[data-stats-tab="month"]');
  const year = tabs.querySelector('[data-stats-tab="year"]');
  const all = tabs.querySelector('[data-stats-tab="overview"]');
  if (month) month.textContent = '本月';
  if (year) year.textContent = '今年';
  if (all) all.textContent = '全部';
  tabs.replaceChildren(...[month, year, all].filter(Boolean));
}
function disablePersistentKey() {
  migrateLegacyKeyToSession();
  const remember = document.getElementById('wereadRememberKey');
  if (!remember) return false;
  remember.checked = false;
  remember.closest('label')?.classList.add('yueji-unified-hide');
  localStorage.removeItem(LEGACY_KEY);
  localStorage.removeItem(LEGACY_PERSIST);
  return true;
}
function installSummarySyncHooks() {
  const bind = () => {
    if (!disablePersistentKey()) return false;
    for (const id of [
      'wereadConnectBtn',
      'wereadSyncBtn',
      'wereadContinueBtn',
      'wereadRestartBtn',
    ]) {
      const button = document.getElementById(id);
      if (!button || button.dataset.unifiedSummaryHook) continue;
      button.dataset.unifiedSummaryHook = '1';
      button.addEventListener('click', () => {
        queueMicrotask(() => {
          disablePersistentKey();
          syncOfficialReadingSummary().catch((error) => {
            window.Yueji?.errors?.capture(error, {
              area: 'weread',
              stage: 'official-summary',
              recoverable: true,
            });
          });
        });
      });
    }
    return true;
  };
  if (bind()) return;
  const observer = new MutationObserver(() => {
    if (bind()) observer.disconnect();
  });
  observer.observe(document.body, { childList: true, subtree: true });
}
function installExportSettings() {
  const sheet = document.getElementById('settingsSheet');
  if (!sheet || document.getElementById('unifiedExportSettings')) return;
  document
    .querySelectorAll('.year-wall-actions')
    .forEach((x) => x.classList.add('yueji-unified-hide'));
  const section = document.createElement('div');
  section.className = 'settings-section';
  section.id = 'unifiedExportSettings';
  section.innerHTML = `<h4>导出图片</h4><div class="section-sub">导出入口统一放在这里，内容页不再摆导出按钮。</div><div class="unified-settings-export"><button class="soft-btn" id="exportYearBooks">年度书墙</button><button class="soft-btn" id="exportReadingYear">阅读一年</button></div>`;
  sheet.appendChild(section);
  section.querySelector('#exportYearBooks').onclick = () => document.getElementById('saveYearWall')?.click();
  section.querySelector('#exportReadingYear').onclick = () => window.print();
}
function install() {
  injectStyles();
  installFourTabs();
  installStatsTabs();
  installHome();
  installOfficialStats();
  installSummarySyncHooks();
  installExportSettings();
  window.addEventListener('yueji:reading-summary', (event) => {
    renderSummary(event.detail);
    renderOfficialStats(event.detail);
  });
  migrateLegacyKeyToSession();
  if (sessionStorage.getItem(SESSION_KEY))
    syncOfficialReadingSummary().catch((error) =>
      window.Yueji?.errors?.capture(error, {
        area: 'weread',
        stage: 'official-summary',
        recoverable: true,
      }),
    );
}

if (document.readyState === 'complete') setTimeout(install, 50);
else window.addEventListener('load', () => setTimeout(install, 50), { once: true });
