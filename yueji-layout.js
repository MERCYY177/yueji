(() => {
  'use strict';

  let statsTab = 'overview';
  let libraryView = 'covers';
  let libraryFilterLocal = 'all';

  function injectLayoutStyles() {
    if (document.getElementById('yuejiLayoutStyles')) return;
    const s = document.createElement('style');
    s.id = 'yuejiLayoutStyles';
    s.textContent = `
    .home-section-title{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;margin-bottom:14px}.home-section-title b{font-size:1.02rem}.home-section-title button{border:0;background:transparent;color:var(--accent);font-weight:700;padding:0}.home-month-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.home-mini-kpi{padding:14px;border-radius:17px;background:var(--soft);border:1px solid var(--line)}.home-mini-kpi b{display:block;font-size:1.35rem;margin-bottom:4px}.home-mini-kpi span{font-size:.72rem;color:var(--muted)}
    #homeDashboard{min-width:0}.home-recent-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;min-width:0;overflow:hidden}.home-recent-book{display:grid;grid-template-columns:52px minmax(0,1fr);gap:11px;align-items:center;border:0;background:transparent;padding:0;text-align:left;min-width:0;max-width:100%;overflow:hidden}.home-recent-book>span:last-child{display:block;min-width:0;max-width:100%;overflow:hidden}.home-recent-cover{width:52px;aspect-ratio:2/3;border-radius:5px;overflow:hidden;background:var(--soft);border:1px solid var(--line);position:relative}.home-recent-cover img{display:block;position:absolute;inset:0;width:100%;height:100%;object-fit:cover}.home-recent-cover.has-image i{display:none}.home-recent-cover i{position:absolute;inset:6px;display:grid;place-items:center;text-align:center;font-style:normal;font-family:"Songti SC","STSong",serif;font-size:.55rem;line-height:1.35;color:var(--muted)}.home-recent-book b,.home-recent-book small{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.home-recent-book small{margin-top:4px;color:var(--muted);font-size:.72rem}.home-recent-progress{height:4px;background:var(--line);border-radius:99px;margin-top:8px;overflow:hidden}.home-recent-progress i{display:block;height:100%;background:var(--accent);border-radius:inherit}
    .home-foot-wrap{display:flex;align-items:flex-end;gap:14px}.home-foot-meta{min-width:100px}.home-foot-meta b{font-size:1.4rem;display:block}.home-foot-meta span{font-size:.72rem;color:var(--muted)}.home-foot-grid{flex:1;display:grid;grid-template-rows:repeat(7,8px);grid-auto-flow:column;grid-auto-columns:1fr;gap:3px;min-width:0}.home-foot-cell{border-radius:2px;background:var(--soft)}.home-foot-cell.read{background:rgba(var(--accent-rgb),var(--level))}
    .library-head{display:flex;justify-content:space-between;align-items:flex-end;gap:14px;margin:5px 3px 18px}.library-head h2{margin:3px 0 0;font-family:"Songti SC","STSong",serif;font-size:2rem}.library-tools{display:grid;gap:12px}.library-top-row{display:flex;gap:10px;align-items:center}.library-top-row .search{flex:1}.library-sub-row{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}.library-count{font-size:.78rem;color:var(--muted)}
    .layout-cover-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(128px,1fr));gap:22px 15px}.layout-cover-card{display:block;overflow:hidden;border:0;background:transparent;padding:0;text-align:left;min-width:0;width:100%}.layout-cover-art{display:block;position:relative;width:100%;min-width:0;aspect-ratio:2/3;border-radius:7px;overflow:hidden;background:var(--soft);border:1px solid var(--line)}.layout-cover-art img{display:block;position:absolute;inset:0;width:100%;height:100%;object-fit:cover}.layout-cover-art i{position:absolute;inset:12px;display:grid;place-items:center;text-align:center;font-family:"Songti SC","STSong",serif;font-style:normal;line-height:1.5;overflow:hidden}.layout-cover-art.has-image i{display:none}.layout-cover-info{display:block;min-width:0;padding:9px 2px 0}.layout-cover-info b,.layout-cover-info small{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.layout-cover-info b{font-size:.86rem}.layout-cover-info small{font-size:.71rem;color:var(--muted);margin-top:4px}.layout-cover-progress{height:4px;background:var(--line);border-radius:99px;margin-top:7px;overflow:hidden}.layout-cover-progress i{display:block;height:100%;background:var(--accent)}
    .library-wall{display:grid;gap:0;border:1px solid var(--line);border-radius:18px;overflow:hidden;background:var(--card)}.wall-row{display:flex;align-items:flex-end;gap:4px;min-height:178px;padding:22px 16px 0;border-bottom:12px solid var(--line);overflow:hidden}.wall-row:last-child{border-bottom:0}.wall-spine{border:1px solid color-mix(in srgb,var(--ink) 15%,transparent);border-bottom:0;border-radius:4px 4px 0 0;min-width:34px;width:var(--w);height:var(--h);padding:8px 5px;background:color-mix(in srgb,var(--soft) 88%,var(--accent));writing-mode:vertical-rl;text-orientation:mixed;font-family:"Songti SC","STSong",serif;font-size:.72rem;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
    .stats-tabs{display:flex;gap:4px;padding:4px;margin-bottom:16px;background:var(--soft);border:1px solid var(--line);border-radius:16px;overflow:auto}.stats-tabs button{flex:1;min-width:72px;border:0;background:transparent;border-radius:12px;padding:10px 12px;color:var(--muted);font-weight:700}.stats-tabs button.active{background:var(--card);color:var(--ink);box-shadow:0 2px 8px rgba(0,0,0,.06)}.stats-panel[hidden]{display:none!important}.stats-hidden-legacy{display:none!important}.stats-overview-stack{display:grid;gap:16px}.stats-overview-stack>.card{margin:0}.stats-progress-card{width:100%}
    .timeline-matrix-wrap{overflow-x:auto}.timeline-matrix{display:grid;gap:5px;min-width:620px}.timeline-head-row,.timeline-data-row{display:grid;grid-template-columns:54px repeat(12,minmax(34px,1fr));gap:5px;align-items:center}.timeline-head-row span,.timeline-year{font-size:.7rem;color:var(--muted);text-align:center}.timeline-year{text-align:left}.timeline-cell{height:26px;border-radius:5px;background:var(--soft)}
    @media(max-width:760px){.home-month-grid{grid-template-columns:repeat(2,1fr)}.home-recent-grid{grid-template-columns:1fr}.home-recent-book{grid-template-columns:46px 1fr}.home-recent-cover{width:46px}.home-foot-wrap{display:block}.home-foot-meta{margin-bottom:10px}.layout-cover-grid{grid-template-columns:repeat(3,minmax(0,1fr));gap:18px 10px}.wall-row{padding-left:10px;padding-right:10px}.stats-tabs button{flex:none}.library-head{display:block}.library-head .section-sub{margin-top:5px}}
    @media(max-width:390px){.layout-cover-grid{grid-template-columns:repeat(3,minmax(0,1fr));gap:16px 8px}.library-top-row{display:grid}.home-month-grid{gap:8px}}
  `;
    document.head.appendChild(s);
  }

  function minsLabel(m) {
    m = Math.max(0, Math.round(Number(m) || 0));
    if (m < 60) return `${m} 分钟`;
    const h = Math.floor(m / 60),
      r = m % 60;
    return r ? `${h}小时${r}分钟` : `${h}小时`;
  }

  function latestDateForBook(b, sessionLatest) {
    const dates = [];
    if (sessionLatest?.get(b.key)) dates.push(sessionLatest.get(b.key));
    dates.push(...(window.yuejiVerifiedBookDates?.(b) || []));
    if (b.finishedDate) dates.push(b.finishedDate);
    return dates.sort().at(-1) || '';
  }

  function bookCoverHtml(b, cls = 'home-recent-cover') {
    const url = b.cover || b.weReadCover || '';
    return `<span class="${cls}${url ? ' has-image' : ''}">${`<img data-cover-key="${esc(b.key)}" ${url ? `src="${esc(url)}"` : ''} alt="" referrerpolicy="no-referrer" onload="this.parentElement.classList.add('has-image')" onerror="this.style.display='none';this.parentElement.classList.remove('has-image')">`}<i>${esc(b.title || '未命名')}</i></span>`;
  }

  function installHome() {
    const p = document.querySelector('.page[data-page="today"]');
    if (!p || document.getElementById('homeDashboard')) return;
    const wrap = document.createElement('div');
    wrap.id = 'homeDashboard';
    wrap.innerHTML = `
    <div class="card" id="homeMonthCard"><div class="home-section-title"><b>本月概览</b><button data-home-stats="month">查看月报 →</button></div><div class="home-month-grid" id="homeMonthGrid"></div></div>
    <div class="card"><div class="home-section-title"><b>最近在读</b><button data-home-go="library">查看书库 →</button></div><div class="home-recent-grid" id="homeRecentBooks"></div></div>
    <div class="card"><div class="home-section-title"><b>今年足迹</b><button data-home-go="calendar">查看完整日历 →</button></div><div class="home-foot-wrap"><div class="home-foot-meta" id="homeFootMeta"></div><div class="home-foot-grid" id="homeFootGrid"></div></div></div>`;
    p.appendChild(wrap);
    wrap.addEventListener('click', (e) => {
      const g = e.target.closest('[data-home-go]');
      if (g) {
        switchPage(g.dataset.homeGo);
        return;
      }
      const st = e.target.closest('[data-home-stats]');
      if (st) {
        switchPage('analytics');
        showStatsTab(st.dataset.homeStats);
      }
    });
  }

  function renderHomeDashboard() {
    if (!document.getElementById('homeDashboard')) return;
    const mk = todayKey.slice(0, 7);
    const raw = state.sessions.filter((s) => s.date?.startsWith(mk)),
      ss = window.yuejiEffectiveSessions?.(raw) || effectiveSessions(raw);
    const mins = ss.reduce((a, s) => a + (+s.minutes || 0), 0);
    const days =
      window.yuejiEffectiveReadDates?.(raw, { prefix: mk }) || new Set(ss.map((s) => s.date));
    const bookKeys = new Set([
      ...raw.map((s) => s.bookKey).filter(Boolean),
      ...(window.yuejiManualBooksInPeriod?.(mk) || []),
    ]);
    const books = [...bookKeys].filter((key) => {
      const b = book(key);
      return b && !b.hidden;
    }).length;
    const finished = state.books.filter(
      (b) => !b.hidden && String(b.finishedDate || '').startsWith(mk),
    ).length;
    document.getElementById('homeMonthGrid').innerHTML = [
      ['阅读天数', days.size, '天'],
      ['阅读时长', minsLabel(mins), ''],
      ['看过', books, '本'],
      ['读完', finished, '本'],
    ]
      .map(
        (x) =>
          `<div class="home-mini-kpi"><b>${esc(x[1])}</b><span>${x[0]}${x[2] ? ` · ${x[2]}` : ''}</span></div>`,
      )
      .join('');

    const sessionLatest = new Map();
    state.sessions.forEach((s) => {
      if (s.bookKey && s.date && s.date > (sessionLatest.get(s.bookKey) || ''))
        sessionLatest.set(s.bookKey, s.date);
    });
    const recent = state.books
      .filter((b) => !b.hidden)
      .map((b) => ({ b, d: latestDateForBook(b, sessionLatest) }))
      .filter((x) => x.d)
      .sort((a, b) => b.d.localeCompare(a.d))
      .slice(0, 3);
    document.getElementById('homeRecentBooks').innerHTML = recent.length
      ? recent
          .map(
            ({ b, d }) =>
              `<button class="home-recent-book" data-home-book="${esc(b.key)}">${bookCoverHtml(b)}<span><b>${esc(b.title || '未命名')}</b><small>${esc(b.author || '')} · ${Math.round(+b.progress || 0)}%</small><span class="home-recent-progress"><i style="width:${Math.max(0, Math.min(100, +b.progress || 0))}%"></i></span></span></button>`,
          )
          .join('')
      : '<div class="empty-text">还没有最近阅读记录。</div>';
    document
      .querySelectorAll('[data-home-book]')
      .forEach((x) => (x.onclick = () => openBook(x.dataset.homeBook)));
    hydrateCovers(document.getElementById('homeRecentBooks'));

    const yr = today.getFullYear();
    const yearDays = new Set();
    state.sessions.forEach((s) => {
      if (s.date?.startsWith(`${yr}-`)) yearDays.add(s.date);
    });
    Object.values(state.journals || {}).forEach((j) => {
      if (j.date?.startsWith(`${yr}-`) && j.read) yearDays.add(j.date);
    });
    document.getElementById('homeFootMeta').innerHTML =
      `<b>${yearDays.size} 天</b><span>${yr} 年已留下阅读记录</span>`;
    const cells = [];
    for (let i = 55; i >= 0; i--) {
      const d = addDays(today, -i),
        k = dateKey(d),
        dd = dayData(k),
        level = dd.read ? Math.min(0.9, 0.25 + (dd.minutes || 1) / 120) : 0;
      cells.push(
        `<i class="home-foot-cell${dd.read ? ' read' : ''}" style="--level:${level}" title="${esc(k)}${dd.read ? ` · ${dd.minutes} 分钟` : ''}"></i>`,
      );
    }
    document.getElementById('homeFootGrid').innerHTML = cells.join('');
  }

  function installLibrary() {
    if (document.querySelector('.page[data-page="library"]')) return;
    const notes = document.querySelector('.page[data-page="notes"]');
    const p = document.createElement('section');
    p.className = 'page';
    p.dataset.page = 'library';
    p.innerHTML = `<div class="library-head"><div><div class="kicker">READING LIBRARY</div><h2>书库</h2><div class="section-sub">同一本书来自多个阅读器时仍只保留一份档案。</div></div></div><div class="card library-tools"><div class="library-top-row" id="libraryTopRow"></div><div class="library-sub-row"><div class="seg" id="librarySegHolder"></div><div style="display:flex;align-items:center;gap:10px"><span class="library-count" id="libraryCountHolder"></span><div class="seg" id="libraryViewSeg"><button class="active" data-library-view="covers">封面</button><button data-library-view="wall">书墙</button></div></div></div></div><div class="card"><div id="libraryDisplay"></div></div>`;
    notes.parentNode.insertBefore(p, notes);

    const search = document.getElementById('bookSearch');
    search.className = 'search';
    search.placeholder = '搜索书名 / 作者';
    document.getElementById('libraryTopRow').appendChild(search);
    const seg = document.getElementById('librarySeg');
    seg.className = 'seg';
    seg.innerHTML =
      '<button class="active" data-filter="all">全部</button><button data-filter="reading">阅读中</button><button data-filter="done">读完</button><button data-filter="unread">未开始</button>';
    document.getElementById('librarySegHolder').replaceWith(seg);
    const count = document.getElementById('libraryCount');
    document.getElementById('libraryCountHolder').replaceWith(count);
    count.className = 'library-count';
    const shelf = document.getElementById('bookshelf');
    document.getElementById('libraryDisplay').appendChild(shelf);
    const table = document.getElementById('bookTable');
    table.hidden = true;

    search.oninput = () => renderLibrary();
    seg.onclick = (e) => {
      const b = e.target.closest('[data-filter]');
      if (!b) return;
      libraryFilterLocal = b.dataset.filter;
      seg.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
      renderLibrary();
    };
    document.getElementById('libraryViewSeg').onclick = (e) => {
      const b = e.target.closest('[data-library-view]');
      if (!b) return;
      libraryView = b.dataset.libraryView;
      b.parentElement
        .querySelectorAll('button')
        .forEach((x) => x.classList.toggle('active', x === b));
      renderLibrary();
    };
  }

  function renderLibraryLayout() {
    const root = document.getElementById('bookshelf');
    if (!root) return;
    const q = (document.getElementById('bookSearch')?.value || '').trim().toLowerCase();
    const visibleBooks = state.books.filter((b) => !b.hidden);
    const arr = visibleBooks.filter(
      (b) =>
        (libraryFilterLocal === 'all' || statusOf(b) === libraryFilterLocal) &&
        `${b.title || ''} ${b.author || ''} ${b.file || ''}`.toLowerCase().includes(q),
    );
    const count = document.getElementById('libraryCount');
    if (count) count.textContent = `${arr.length} / ${visibleBooks.length} 本`;
    if (!arr.length) {
      root.className = '';
      root.innerHTML = '<div class="empty-text">没有符合条件的书。</div>';
      return;
    }
    if (libraryView === 'wall') {
      root.className = 'library-wall';
      const rows = [];
      for (let i = 0; i < arr.length; i += 14) rows.push(arr.slice(i, i + 14));
      root.innerHTML = rows
        .map(
          (row, ri) =>
            `<div class="wall-row">${row.map((b, i) => `<button class="wall-spine" data-layout-book="${esc(b.key)}" style="--w:${34 + ((i + ri) % 5) * 4}px;--h:${112 + ((i * 13 + ri * 9) % 58)}px" title="${esc(b.title || '未命名')}">${esc(b.title || '未命名')}</button>`).join('')}</div>`,
        )
        .join('');
    } else {
      root.className = 'layout-cover-grid';
      root.innerHTML = arr
        .map((b) => {
          const url = b.cover || b.weReadCover || '';
          return `<button class="layout-cover-card" data-layout-book="${esc(b.key)}"><span class="layout-cover-art${url ? ' has-image' : ''}"><img data-cover-key="${esc(b.key)}" ${url ? `src="${esc(url)}"` : ''} alt="" loading="lazy" referrerpolicy="no-referrer" onload="this.parentElement.classList.add('has-image')" onerror="this.style.display='none';this.parentElement.classList.remove('has-image')"><i>${esc(b.title || '未命名')}</i></span><span class="layout-cover-info"><b>${esc(b.title || '未命名')}</b><small>${esc(b.author || '')} · ${Math.round(+b.progress || 0)}%</small><span class="layout-cover-progress"><i style="width:${Math.max(0, Math.min(100, +b.progress || 0))}%"></i></span></span></button>`;
        })
        .join('');
    }
    root
      .querySelectorAll('[data-layout-book]')
      .forEach((x) => (x.onclick = () => openBook(x.dataset.layoutBook)));
    hydrateCovers(root);
  }

  function readDaySet() {
    return (
      window.yuejiEffectiveReadDates?.() ||
      new Set(
        effectiveSessions()
          .map((x) => x.date)
          .filter(Boolean),
      )
    );
  }
  function streakStats() {
    const set = readDaySet(),
      arr = [...set].sort();
    let max = 0,
      run = 0,
      prev = '';
    arr.forEach((k) => {
      if (prev && dateKey(addDays(parseDate(prev), 1)) === k) run++;
      else run = 1;
      max = Math.max(max, run);
      prev = k;
    });
    let anchor = set.has(todayKey) ? todayKey : dateKey(addDays(today, -1));
    if (!set.has(anchor)) return { current: 0, max };
    let current = 0,
      d = parseDate(anchor);
    while (set.has(dateKey(d))) {
      current++;
      d = addDays(d, -1);
    }
    return { current, max };
  }
  function renderOverviewStats() {
    const kpi = document.getElementById('kpiGrid');
    if (!kpi) return;
    const rows = window.yuejiEffectiveSessions?.() || effectiveSessions(),
      total = rows.reduce((a, s) => a + (+s.minutes || 0), 0),
      days = readDaySet(),
      st = streakStats();
    const byDay = {};
    rows.forEach((s) => {
      if (s.date) byDay[s.date] = (byDay[s.date] || 0) + (+s.minutes || 0);
    });
    const maxDay = Math.max(0, ...Object.values(byDay));
    const finished = state.books.filter((b) => !b.hidden && statusOf(b) === 'done').length,
      visibleBooks = state.books.filter((b) => !b.hidden);
    const noteCount =
      (window.yuejiHighlightCount?.() ?? (state.highlights || []).length) +
      Object.values(state.journals || {}).filter(
        (j) => String(j.quote || '').trim() || String(j.thought || '').trim(),
      ).length;
    const vals = [
      ['藏书', visibleBooks.length, '本'],
      ['读完', finished, '本'],
      ['总阅读时长', minsLabel(total), ''],
      ['阅读天数', days.size, '天'],
      ['当前连续', st.current, '天'],
      ['最长连续', st.max, '天'],
      ['单日最高', minsLabel(maxDay), ''],
      ['书摘 / 感悟', noteCount, '条'],
    ];
    kpi.innerHTML = vals
      .map(
        (x) =>
          `<div class="kpi"><b>${esc(x[1])}</b><span>${x[0]}${x[2] ? ` · ${x[2]}` : ''}</span></div>`,
      )
      .join('');
    renderTimelineMatrix();
  }
  function renderTimelineMatrix() {
    const el = document.getElementById('timelineHeat');
    if (!el) return;
    const rows = window.yuejiEffectiveSessions?.() || effectiveSessions(),
      dates = rows.filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s.date || '')).map((s) => s.date);
    if (!dates.length) {
      el.className = '';
      el.innerHTML = '<div class="empty-text">还没有阅读时间数据。</div>';
      return;
    }
    const minY = Math.min(...dates.map((d) => +d.slice(0, 4))),
      maxY = Math.max(today.getFullYear(), ...dates.map((d) => +d.slice(0, 4)));
    const years = [];
    for (let y = minY; y <= maxY; y++) years.push(y);
    const sums = {};
    rows.forEach((s) => {
      if (!s.date) return;
      const k = s.date.slice(0, 7);
      sums[k] = (sums[k] || 0) + (+s.minutes || 0);
    });
    const max = Math.max(1, ...Object.values(sums));
    el.className = 'timeline-matrix-wrap';
    el.innerHTML = `<div class="timeline-matrix"><div class="timeline-head-row"><span></span>${Array.from({ length: 12 }, (_, i) => `<span>${i + 1}月</span>`).join('')}</div>${years
      .map(
        (y) =>
          `<div class="timeline-data-row"><b class="timeline-year">${y}</b>${Array.from(
            { length: 12 },
            (_, i) => {
              const v = sums[`${y}-${pad(i + 1)}`] || 0,
                a = v ? 0.12 + (0.78 * v) / max : 0;
              return `<i class="timeline-cell" style="${v ? `background:rgba(var(--accent-rgb),${a})` : ''}" title="${y}年${i + 1}月 · ${Math.round(v)} 分钟"></i>`;
            },
          ).join('')}</div>`,
      )
      .join('')}</div>`;
  }

  function installCalendarAnnual() {
    const wrap = document.getElementById('yearCalendarWrap');
    if (!wrap || document.getElementById('calendarYearWallCard')) return;
    const card = document.createElement('div');
    card.id = 'calendarYearWallCard';
    card.className = 'year-wall card';
    card.hidden = true;
    card.innerHTML = `<div class="section-head"><div><div class="section-title">My Year in Books</div><div class="section-sub">跟随上方选择的年份，只收录有真实阅读证据的书；它和年度打卡会同时保留。</div></div><div class="year-wall-actions"><button class="soft-btn" id="saveCalendarYearWall">预览图片</button></div></div><div id="calendarYearWallPreview" class="year-wall-preview"></div>`;
    wrap.insertAdjacentElement('afterend', card);
    document.getElementById('saveCalendarYearWall').onclick = () => {
      document.getElementById('yearWallYear').value = String(calendarDate.getFullYear());
      document.getElementById('saveYearWall').click();
    };
  }
  async function renderCalendarAnnual() {
    const card = document.getElementById('calendarYearWallCard');
    if (!card) return;
    const year = calendarDate.getFullYear();
    document.getElementById('yearWallYear').value = year;
    await (window.renderYearWall || renderYearWall)();
    const preview = document.getElementById('calendarYearWallPreview');
    preview.innerHTML = document.getElementById('yearWallPreview').innerHTML;
    await hydrateCovers(preview);
  }

  function installStatsStructure() {
    const analytics = document.querySelector('.page[data-page="analytics"]');
    if (!analytics || document.getElementById('statsTabs')) return;
    const head = analytics.querySelector('.analytics-head');
    const sub = head?.querySelector('.section-sub');
    if (sub) sub.textContent = '汇总微信读书、静读天下与手动记录。';
    const tabs = document.createElement('div');
    tabs.className = 'stats-tabs';
    tabs.id = 'statsTabs';
    tabs.innerHTML =
      '<button class="active" data-stats-tab="overview">总览</button><button data-stats-tab="month">月报</button><button data-stats-tab="year">年报</button>';
    head.after(tabs);
    ['overview', 'month', 'year'].forEach((n, i) => {
      const p = document.createElement('div');
      p.className = 'stats-panel';
      p.id = `statsPanel-${n}`;
      if (i) p.hidden = true;
      analytics.appendChild(p);
    });
    const overview = document.getElementById('statsPanel-overview');
    overview.classList.add('stats-overview-stack');
    const kpi = document.getElementById('kpiGrid');
    overview.appendChild(kpi);
    const two = analytics.querySelector('.analytics-two');
    if (two) {
      const progress = two.children[1];
      if (progress) {
        progress.classList.add('stats-progress-card');
        overview.appendChild(progress);
      }
      const legacy = document.createElement('div');
      legacy.className = 'stats-hidden-legacy';
      while (two.firstChild) legacy.appendChild(two.firstChild);
      two.replaceWith(legacy);
    }
    const timeline = document.getElementById('timelineHeat')?.closest('.card');
    if (timeline) overview.appendChild(timeline);

    const monthly = document.querySelector('.page[data-page="monthly"]');
    if (monthly) {
      const yearWall = monthly.querySelector('.year-wall');
      if (yearWall) document.getElementById('statsPanel-year').appendChild(yearWall);
      [...monthly.children].forEach((ch) =>
        document.getElementById('statsPanel-month').appendChild(ch),
      );
      monthly.dataset.page = 'legacy-monthly';
      monthly.hidden = true;
    }
    tabs.onclick = (e) => {
      const b = e.target.closest('[data-stats-tab]');
      if (!b) return;
      showStatsTab(b.dataset.statsTab);
    };
  }
  function showStatsTab(tab) {
    statsTab = tab || 'overview';
    document
      .querySelectorAll('#statsTabs [data-stats-tab]')
      .forEach((b) => b.classList.toggle('active', b.dataset.statsTab === statsTab));
    document
      .querySelectorAll('.stats-panel')
      .forEach((p) => (p.hidden = p.id !== `statsPanel-${statsTab}`));
    if (statsTab === 'overview') renderOverviewStats();
    if (statsTab === 'month') renderMonthly();
    if (statsTab === 'year') (window.renderYearWall || renderYearWall)();
  }

  function rebuildBottomNav() {
    const nav = document.querySelector('.bottom-nav');
    if (!nav) return;
    nav.innerHTML =
      '<button class="nav-btn active" data-go="today"><span>⌂</span>首页</button><button class="nav-btn" data-go="calendar"><span>▦</span>日历</button><button class="nav-btn" data-go="library"><span>▤</span>书库</button><button class="nav-btn" data-go="notes"><span>✎</span>笔记</button><button class="nav-btn" data-go="analytics"><span>◫</span>统计</button>';
    nav.querySelectorAll('.nav-btn').forEach((b) => (b.onclick = () => switchPage(b.dataset.go)));
  }

  let coreRenderAnalytics;
  function patchCore() {
    const oldLibrary = renderLibrary;
    renderLibrary = function () {
      return renderLibraryLayout();
    };
    const oldCalendar = renderCalendarPage;
    renderCalendarPage = function () {
      oldCalendar();
      const annual = document.getElementById('calendarYearWallCard');
      if (annual) annual.hidden = calendarView !== 'year';
      if (calendarView === 'year') renderCalendarAnnual();
    };
    coreRenderAnalytics = renderAnalytics;
    renderAnalytics = function () {
      coreRenderAnalytics();
      renderOverviewStats();
    };
    const oldSwitch = switchPage;
    switchPage = function (p) {
      oldSwitch(p);
      if (p === 'today') renderHomeDashboard();
      if (p === 'library') renderLibrary();
      if (p === 'analytics') {
        showStatsTab(statsTab);
      }
    };
    const oldAll = renderAll;
    renderAll = function () {
      oldAll();
      renderHomeDashboard();
      if (page === 'library') renderLibrary();
      if (page === 'analytics') {
        renderOverviewStats();
      }
    };
  }

  function install() {
    injectLayoutStyles();
    installHome();
    installLibrary();
    installCalendarAnnual();
    installStatsStructure();
    rebuildBottomNav();
    patchCore();
    const initialPage = page === 'monthly' ? 'analytics' : page;
    switchPage(initialPage);
  }

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', () => setTimeout(install, 0), { once: true })
    : setTimeout(install, 0);
})();
