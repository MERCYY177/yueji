const ARCHIVE_KEY = 'yueji-archive-v1';

function readLocalBooks() {
  try {
    const archive = JSON.parse(localStorage.getItem(ARCHIVE_KEY) || 'null');
    return Array.isArray(archive?.books) ? archive.books : [];
  } catch {
    return [];
  }
}

function isFinishedBook(book = {}) {
  const progress = Number(book.progress ?? book.weReadProgress ?? book.readingProgress);
  return (
    book.finishReading === true ||
    (Number.isFinite(progress) && progress >= 99.95) ||
    Boolean(book.finishTime || book.finishedDate)
  );
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (char) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[char],
  );
}

function escapeAttr(value = '') {
  return escapeHtml(value).replace(/`/g, '&#096;');
}

function injectFixStyles() {
  if (document.getElementById('yuejiAnnualUiFixStyles')) return;
  const style = document.createElement('style');
  style.id = 'yuejiAnnualUiFixStyles';
  style.textContent = `
    .feature-panel{background:var(--card)!important;color:var(--ink)!important}
    .feature-panel-head{background:color-mix(in srgb,var(--card) 92%,transparent)!important;color:var(--ink)!important}
    .yueji-annual-hide{display:none!important}
    .unified-summary-grid.annual-two-column{grid-template-columns:repeat(2,minmax(0,1fr))!important}
    .local-finished-books{margin-top:18px;padding-top:18px;border-top:1px solid var(--line)}
    .local-finished-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:12px}
    .local-finished-head b{font-size:1rem}.local-finished-head span{color:var(--muted);font-size:.78rem}
    .local-finished-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(92px,118px));gap:14px}
    .local-finished-book{min-width:0}.local-finished-cover{width:100%;aspect-ratio:2/3;border-radius:10px;overflow:hidden;background:var(--soft);border:1px solid var(--line);display:grid;place-items:center}
    .local-finished-cover img{width:100%;height:100%;object-fit:cover;display:block}.local-finished-cover i{padding:10px;font-style:normal;font-size:.68rem;line-height:1.4;text-align:center;color:var(--muted)}
    .local-finished-book b{display:block;margin-top:6px;font-size:.72rem;line-height:1.35;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    @media(max-width:560px){.local-finished-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
  `;
  document.head.appendChild(style);
}

function finishedBookCard(book) {
  const title = String(book.title || book.name || book.file || '未命名书籍');
  const cover = String(book.cover || book.weReadCover || '').trim();
  const visual = cover
    ? `<img src="${escapeAttr(cover)}" alt="${escapeAttr(title)}" loading="lazy">`
    : `<i>${escapeHtml(title)}</i>`;
  return `<div class="local-finished-book"><div class="local-finished-cover">${visual}</div><b title="${escapeAttr(title)}">${escapeHtml(title)}</b></div>`;
}

function renderLocalFinishedBooks(card) {
  let section = card.querySelector('[data-local-finished-books]');
  if (!section) {
    section = document.createElement('section');
    section.className = 'local-finished-books';
    section.dataset.localFinishedBooks = '1';
    section.innerHTML = `<div class="local-finished-head"><b>已读书籍</b><span data-local-finished-count>0 本</span></div><div class="local-finished-grid"></div>`;
    const calendar = card.querySelector('#unifiedYearGrid');
    card.insertBefore(section, calendar || card.querySelector('.unified-sync-note') || null);
  }
  const finished = readLocalBooks().filter(isFinishedBook);
  const count = section.querySelector('[data-local-finished-count]');
  const grid = section.querySelector('.local-finished-grid');
  const nextCount = `${finished.length} 本`;
  const nextHtml = finished.length
    ? finished.map(finishedBookCard).join('')
    : '<div class="empty-text">还没有可确认的已读书籍。</div>';
  if (count.textContent !== nextCount) count.textContent = nextCount;
  if (grid.dataset.renderedHtml !== nextHtml) {
    grid.innerHTML = nextHtml;
    grid.dataset.renderedHtml = nextHtml;
  }
}

function cleanYearOverview() {
  const card = document.getElementById('unifiedYearCard');
  if (!card) return false;
  const grid = card.querySelector('.unified-summary-grid');
  if (grid) {
    grid.classList.add('annual-two-column');
    grid.querySelector('[data-kpi="books"]')?.closest('.unified-summary-item')?.classList.add('yueji-annual-hide');
    grid.querySelector('[data-kpi="finished"]')?.closest('.unified-summary-item')?.classList.add('yueji-annual-hide');
  }
  const subtitle = card.querySelector('.section-sub');
  const nextSubtitle = '微信读书官方阅读时长与天数 + 阅迹本地已读书籍 + 真实日级日历';
  if (subtitle && subtitle.textContent !== nextSubtitle) subtitle.textContent = nextSubtitle;
  renderLocalFinishedBooks(card);
  return true;
}

function cleanOfficialStats() {
  const card = document.getElementById('unifiedOfficialStats');
  if (!card) return false;
  const grid = card.querySelector('.unified-summary-grid');
  if (grid) {
    grid.classList.add('annual-two-column');
    grid.querySelector('[data-official-books]')?.closest('.unified-summary-item')?.classList.add('yueji-annual-hide');
    grid.querySelector('[data-official-finished]')?.closest('.unified-summary-item')?.classList.add('yueji-annual-hide');
  }
  const small = card.querySelector('.unified-official-title small');
  const stableText = '只展示微信稳定返回的汇总字段';
  if (small && small.textContent !== stableText) small.textContent = stableText;
  const note = card.querySelector('[data-official-note]');
  if (note && /没有返回的字段|缺失字段/.test(note.textContent || '')) {
    note.textContent = (note.textContent || '')
      .replace(/；没有返回的字段显示“暂无数据”。?/g, '。')
      .replace(/；缺失字段不会按 0 处理。?/g, '。');
  }
  return true;
}

function cleanLegacyMetrics() {
  document.getElementById('monthSummary')?.closest('.card')?.classList.add('yueji-annual-hide');
  document.querySelectorAll('#kpiGrid .kpi, #monthlyKpis .monthly-kpi').forEach((card) => {
    if ([...card.querySelectorAll('span')].some((span) => (span.textContent || '').includes('阅读字数'))) {
      card.classList.add('yueji-annual-hide');
    }
  });
}

function applyFixes() {
  injectFixStyles();
  cleanLegacyMetrics();
  const yearReady = cleanYearOverview();
  const officialReady = cleanOfficialStats();
  return yearReady && officialReady;
}

function install() {
  applyFixes();
  const observer = new MutationObserver(() => applyFixes());
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener('yueji:reading-summary', () => queueMicrotask(applyFixes));
  window.addEventListener('storage', (event) => {
    if (event.key === ARCHIVE_KEY) applyFixes();
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setTimeout(install, 120), { once: true });
} else {
  setTimeout(install, 120);
}
