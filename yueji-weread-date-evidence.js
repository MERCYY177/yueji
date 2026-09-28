(() => {
  'use strict';

  const n = (v) => Number(v) || 0;
  const getState = () => {
    try {
      return typeof state !== 'undefined' && state && Array.isArray(state.books) ? state : null;
    } catch {
      return null;
    }
  };

  function hasVerifiedWeReadReading(book) {
    if (!book || !Array.isArray(book.sources) || !book.sources.includes('weread')) return false;
    return (
      n(book.weReadSeconds) > 0 ||
      n(book.weReadProgress) > 0 ||
      book.weReadStarted === true ||
      book.weReadStarted === 1
    );
  }

  // A shelf/progress import is only a baseline. It becomes a dated reading
  // event after a later snapshot proves that progress or reading time grew.
  function verifiedWeReadActivityDates(book) {
    const rows = (Array.isArray(book?.weReadSnapshots) ? book.weReadSnapshots : [])
      .filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(String(x?.date || '')))
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const dates = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i],
        previous = rows[i - 1];
      const explicit =
        row.activity === true ||
        /^detail-(?:first|timestamp|change|preserved)$/.test(String(row.evidence || ''));
      if (
        explicit ||
        (previous &&
          (n(row.seconds) > n(previous.seconds) || n(row.progress) > n(previous.progress)))
      )
        dates.push(row.date);
    }
    // Compatibility for pre-snapshot archives: an old detail timestamp is
    // usable only when the same book also has positive reading evidence.
    if (
      !dates.length &&
      hasVerifiedWeReadReading(book) &&
      /^\d{4}-\d{2}-\d{2}$/.test(String(book?.weReadLastRead || ''))
    )
      dates.push(book.weReadLastRead);
    return [...new Set(dates)];
  }
  window.yuejiVerifiedWeReadActivityDates = verifiedWeReadActivityDates;

  function cleanAmbiguousWeReadDates() {
    const st = getState();
    if (!st) return false;
    let changed = false;
    st.books.forEach((book) => {
      if (!book || !Array.isArray(book.sources) || !book.sources.includes('weread')) return;
      if (book.weReadLastRead && !hasVerifiedWeReadReading(book)) {
        if (!book.weReadShelfReadUpdate) book.weReadShelfReadUpdate = book.weReadLastRead;
        delete book.weReadLastRead;
        changed = true;
      }
    });
    return changed;
  }

  let originalSave;
  try {
    originalSave = typeof save === 'function' ? save : null;
  } catch {
    originalSave = null;
  }
  if (originalSave) {
    const wrappedSave = function (...args) {
      cleanAmbiguousWeReadDates();
      return originalSave.apply(this, args);
    };
    try {
      save = wrappedSave;
    } catch {
      window.save = wrappedSave;
    }
  }

  const persistClean = () => {
    if (!cleanAmbiguousWeReadDates()) return;
    try {
      if (originalSave) originalSave();
      else {
        const st = getState();
        if (st) localStorage.setItem('yueji-archive-v1', JSON.stringify(st));
      }
    } catch (e) {
      console.warn('WeRead evidence cleanup save skipped', e);
    }
  };

  // Keep imported shelf timestamps out of daily activity and exact-date stats.
  persistClean();
  setTimeout(persistClean, 900);
  setTimeout(persistClean, 2500);
})();

(() => {
  'use strict';

  function installMonthlyPresentationCleanup() {
    if (!document.getElementById('yuejiMonthlyPresentationCleanup')) {
      const style = document.createElement('style');
      style.id = 'yuejiMonthlyPresentationCleanup';
      style.textContent = `
        .monthly-side { display: none !important; }
        .monthly-layout { grid-template-columns: minmax(0, 1fr) !important; }
        .month-book-evidence { display: none !important; }
      `;
      document.head.appendChild(style);
    }

    const summary = document.getElementById('monthSummary');
    if (!summary || summary.dataset.monthlyCleanupBound === '1') return;
    summary.dataset.monthlyCleanupBound = '1';

    const cleanSummary = () => {
      const current = summary.textContent || '';
      const cleaned = current
        .replace(/微信进度记录显示《[^》]+》较活跃，但微信总时长无法按书拆分。/g, '')
        .replace(/微信读书没有提供逐书分钟，因此不生成虚假的图书排行。/g, '');
      if (cleaned !== current) summary.textContent = cleaned;
    };

    cleanSummary();
    new MutationObserver(cleanSummary).observe(summary, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  }

  if (typeof document === 'undefined') return;
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', installMonthlyPresentationCleanup, { once: true });
  else installMonthlyPresentationCleanup();
})();
