const SUMMARY_KEY = 'yueji-reading-summary-v1';

function loadSummary() {
  try {
    return JSON.parse(localStorage.getItem(SUMMARY_KEY) || 'null');
  } catch {
    return null;
  }
}

function activeStatsTab() {
  return document.querySelector('#statsTabs [data-stats-tab].active')?.dataset.statsTab || 'overview';
}

function monthMarkup(snapshot, month) {
  const year = Number(snapshot?.year) || new Date().getFullYear();
  const daily = snapshot?.dailyByDate || {};
  const monthKey = `${year}-${String(month).padStart(2, '0')}`;
  const completeMonths = new Set(Array.isArray(snapshot?.completeMonths) ? snapshot.completeMonths : []);
  const complete = completeMonths.has(monthKey);
  const values = Object.entries(daily)
    .filter(([key, value]) => key.startsWith(`${monthKey}-`) && Number(value) > 0)
    .map(([, value]) => Number(value));
  const max = Math.max(1, ...values);
  const first = new Date(year, month - 1, 1);
  const days = new Date(year, month, 0).getDate();
  const pad = (first.getDay() + 6) % 7;
  const cells = Array.from({ length: pad }, () => '<i class="stats-calendar-day pad"></i>');
  for (let day = 1; day <= days; day++) {
    const key = `${monthKey}-${String(day).padStart(2, '0')}`;
    const has = Object.prototype.hasOwnProperty.call(daily, key);
    const seconds = has ? Number(daily[key]) : null;
    const read = Number(seconds) > 0;
    const level = read ? Math.max(0.22, Math.min(0.9, seconds / max)) : 0;
    const cls = read ? ' read' : !has && !complete ? ' missing' : '';
    const title = has
      ? `${key} · ${Math.round(Number(seconds || 0) / 60)} 分钟`
      : complete
        ? `${key} · 0 分钟`
        : `${key} · 暂无日级明细`;
    cells.push(`<i class="stats-calendar-day${cls}" style="--level:${level}" title="${title}"></i>`);
  }
  return `<section class="stats-calendar-month"><strong>${month}月${complete ? '' : ' · 明细待补'}</strong><div class="stats-calendar-week">${['一','二','三','四','五','六','日'].map((x) => `<span>${x}</span>`).join('')}</div><div class="stats-calendar-days">${cells.join('')}</div></section>`;
}

function relocateAnnualCard() {
  const analytics = document.querySelector('.page[data-page="analytics"]');
  const annual = document.getElementById('unifiedYearCard');
  const official = document.getElementById('unifiedOfficialStats');
  if (!analytics || !annual) return false;
  if (!analytics.contains(annual)) (official || document.getElementById('statsTabs'))?.insertAdjacentElement('afterend', annual);
  annual.classList.add('stats-annual-calendar-card');
  return true;
}

function renderStatsCalendars(snapshot = loadSummary()) {
  const monthCard = document.getElementById('statsCalendarCard');
  const annualCard = document.getElementById('unifiedYearCard');
  const officialCard = document.getElementById('unifiedOfficialStats');
  if (!monthCard) return;
  const tab = activeStatsTab();
  monthCard.hidden = tab !== 'month';
  if (annualCard) annualCard.hidden = tab !== 'year';
  if (officialCard) officialCard.hidden = tab === 'year';
  if (tab !== 'month') return;
  const year = Number(snapshot?.year) || new Date().getFullYear();
  const month = Number(snapshot?.month) || new Date().getMonth() + 1;
  monthCard.querySelector('[data-stats-calendar-title]').textContent = `${year}年${month}月 阅读日历`;
  monthCard.querySelector('[data-stats-calendar-body]').innerHTML = monthMarkup(snapshot, month);
}

function installStyles() {
  if (document.getElementById('statsCalendarStyles')) return;
  const style = document.createElement('style');
  style.id = 'statsCalendarStyles';
  style.textContent = `
    #statsCalendarCard,.stats-annual-calendar-card{margin:0 0 16px}.stats-calendar-grid{display:grid;gap:14px;margin-top:14px}.stats-calendar-grid.month-only{grid-template-columns:minmax(0,420px)}.stats-calendar-month{padding:10px;border:1px solid var(--line);border-radius:14px}.stats-calendar-month>strong{display:block;margin-bottom:8px;font-size:.8rem}.stats-calendar-week,.stats-calendar-days{display:grid;grid-template-columns:repeat(7,1fr);gap:3px}.stats-calendar-week span{font-size:.55rem;text-align:center;color:var(--muted)}.stats-calendar-day{aspect-ratio:1;border-radius:3px;background:var(--soft);font-size:0}.stats-calendar-day.read{background:rgba(var(--accent-rgb),var(--level))}.stats-calendar-day.missing{outline:1px dashed color-mix(in srgb,var(--muted) 25%,transparent);outline-offset:-1px;background:transparent}.stats-calendar-day.pad{background:transparent}
  `;
  document.head.append(style);
}

function install() {
  installStyles();
  const analytics = document.querySelector('.page[data-page="analytics"]');
  const tabs = document.getElementById('statsTabs');
  if (!analytics || !tabs) return false;
  relocateAnnualCard();
  let card = document.getElementById('statsCalendarCard');
  if (!card) {
    card = document.createElement('div');
    card.id = 'statsCalendarCard';
    card.className = 'card';
    card.innerHTML = `<div class="section-head"><div><div class="section-title" data-stats-calendar-title>本月阅读日历</div><div class="section-sub">本月显示单月格子；“今年”显示完整 12 个月；“全部”只看累计统计。</div></div></div><div data-stats-calendar-body class="stats-calendar-grid month-only"></div>`;
    const official = document.getElementById('unifiedOfficialStats');
    (official || tabs).insertAdjacentElement('afterend', card);
  }
  tabs.addEventListener('click', () => queueMicrotask(() => {
    relocateAnnualCard();
    renderStatsCalendars();
  }));
  window.addEventListener('yueji:reading-summary', (event) => {
    relocateAnnualCard();
    renderStatsCalendars(event.detail);
  });
  renderStatsCalendars();
  return true;
}

function boot() {
  if (install()) return;
  const observer = new MutationObserver(() => {
    relocateAnnualCard();
    if (install()) observer.disconnect();
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === 'complete') setTimeout(boot, 80);
else window.addEventListener('load', () => setTimeout(boot, 80), { once: true });
