(() => {
  'use strict';

  const SESSION_KEY = 'yueji-weread-key';
  const SYNC_BUTTON_IDS = new Set([
    'wereadConnectBtn',
    'wereadSyncBtn',
    'wereadContinueBtn',
    'wereadRestartBtn',
    'wereadProgressRefreshBtn',
  ]);

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function finishFlag(value) {
    if (value === true || value === 1) return true;
    const normalized = String(value ?? '').trim().toLowerCase();
    return normalized === '1' || normalized === 'true';
  }

  function safeDate(value) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return String(value);
    const number = Number(value);
    if (!number) return '';
    const date = new Date(number < 1e12 ? number * 1000 : number);
    if (Number.isNaN(date.getTime())) return '';
    const pad = (part) => String(part).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function archiveState() {
    try {
      return typeof state !== 'undefined' && state && typeof state === 'object' ? state : null;
    } catch {
      return null;
    }
  }

  function completed(raw = {}, book = {}) {
    const progress = Number(
      book?.weReadProgress ?? book?.progress ?? raw?.progress ?? raw?.readingProgress,
    );
    return (
      finishFlag(raw?.finishReading) ||
      finishFlag(book?.finishReading) ||
      book?.status === 'done' ||
      (Number.isFinite(progress) && progress >= 99.95)
    );
  }

  function verifiedLocalFinishedDate(book = {}, raw = {}) {
    const direct = safeDate(book?.finishTime || raw?.finishTime);
    if (direct) return direct;

    const evidence = book?.weReadProgressEvidence;
    if (
      evidence &&
      Number(evidence.progress) >= 99.95 &&
      /^\d{4}-\d{2}-\d{2}$/.test(String(evidence.date || ''))
    )
      return String(evidence.date);

    if (
      Number(book?.weReadProgress ?? book?.progress) >= 99.95 &&
      /^\d{4}-\d{2}-\d{2}$/.test(String(book?.weReadLastRead || ''))
    )
      return String(book.weReadLastRead);

    // The shelf endpoint pairs finishReading with readUpdateTime. Use that
    // timestamp only when the same shelf row explicitly says the book is
    // finished; never use an ordinary shelf update as completion evidence.
    if (finishFlag(raw?.finishReading)) {
      const shelfFinished = safeDate(raw?.readUpdateTime);
      if (shelfFinished) return shelfFinished;
    }

    return '';
  }

  async function fetchProgress(bookId) {
    const key = sessionStorage.getItem(SESSION_KEY) || '';
    if (!key || !bookId) return null;
    const gateway = window.Yueji?.wereadGateway || '/.netlify/functions/weread-gateway';
    const response = await fetch(gateway, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_name: '/book/getprogress',
        skill_version: '1.0.4',
        bookId: String(bookId),
      }),
    });
    const payload = await response.json();
    if (!response.ok || (payload?.errcode && payload.errcode !== 0)) return null;
    const data = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
    return data?.book && typeof data.book === 'object' ? data.book : data;
  }

  async function persist(archive) {
    if (typeof window.yuejiPersistMergedWeReadState === 'function') {
      await window.yuejiPersistMergedWeReadState();
    } else if (typeof window.yuejiPersistExternalState === 'function') {
      await window.yuejiPersistExternalState(archive);
    }
    try {
      if (typeof save === 'function') save();
    } catch {}
  }

  function refresh() {
    try {
      window.Yueji?.renderFinishedForMonth?.();
    } catch {}
    try {
      if (typeof renderMonthly === 'function' && document.getElementById('monthFinished')) renderMonthly();
    } catch {}
    try {
      window.Yueji?.renderFinishedForMonth?.();
    } catch {}
  }

  async function repairFinishedDates({ fetchMissingDates = true } = {}) {
    const archive = archiveState();
    if (!archive?.books?.length) return false;
    const shelf = Array.isArray(archive.weRead?.shelfBooks) ? archive.weRead.shelfBooks : [];
    const shelfById = new Map(
      shelf.filter((item) => item?.bookId).map((item) => [String(item.bookId), item]),
    );
    let changed = false;

    for (const book of archive.books) {
      const id = String(book?.weReadBookId || '');
      if (!id) continue;
      const raw = shelfById.get(id) || book;
      if (!completed(raw, book)) continue;

      // Normalize explicit completion to the numeric value expected by older
      // sync paths so future progress refreshes do not skip string/boolean flags.
      if (finishFlag(raw?.finishReading) && book.finishReading !== 1) {
        book.finishReading = 1;
        changed = true;
      }
      if (finishFlag(raw?.finishReading) && raw.finishReading !== 1) {
        raw.finishReading = 1;
        changed = true;
      }

      if (book?.finishedDate) continue;

      let date = verifiedLocalFinishedDate(book, raw);
      if (!date && fetchMissingDates) {
        try {
          const detail = await fetchProgress(id);
          const detailProgress = Number(detail?.progress);
          const detailFinished =
            finishFlag(detail?.finishReading) ||
            (Number.isFinite(detailProgress) && detailProgress >= 99.95) ||
            completed(raw, book);
          if (detail && detailFinished) {
            date = safeDate(detail.finishTime);
            if (!date && Number.isFinite(detailProgress) && detailProgress >= 99.95)
              date = safeDate(detail.updateTime);
            if (!date && finishFlag(raw?.finishReading)) date = safeDate(detail.updateTime);
            if (detail.updateTime && !book.weReadLastRead)
              book.weReadLastRead = safeDate(detail.updateTime);
            if (Number.isFinite(detailProgress) && detailProgress >= 0) {
              book.weReadProgress = Math.max(Number(book.weReadProgress || 0), detailProgress);
              book.weReadProgressEvidence = {
                date: safeDate(detail.updateTime),
                source: 'book-progress',
                progress: detailProgress,
                seconds: Number(detail.recordReadingTime || 0),
              };
            }
          }
        } catch (error) {
          window.Yueji?.errors?.capture?.(error, {
            area: 'weread',
            stage: 'finished-date-progress-fallback',
            recoverable: true,
            quiet: true,
          });
        }
      }

      if (date) {
        book.finishedDate = date;
        book.finishedDateSource = book.finishTime || raw.finishTime
          ? 'weread-finish-time'
          : finishFlag(raw?.finishReading) && raw?.readUpdateTime
            ? 'weread-shelf-finished-read-update'
            : 'weread-progress-update';
        changed = true;
      }
    }

    if (changed) {
      await persist(archive);
      refresh();
    }
    return changed;
  }

  async function waitForFinishedFix(timeoutMs = 15000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (typeof window.Yueji?.reconcileWeReadFinishedBooks === 'function') return true;
      await sleep(50);
    }
    return false;
  }

  async function waitForPrimarySyncIdle(timeoutMs = 15 * 60 * 1000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const disabled = [...SYNC_BUTTON_IDS].some((id) => document.getElementById(id)?.disabled);
      if (!window.__yuejiWeReadSyncing && !disabled) return true;
      await sleep(350);
    }
    return false;
  }

  function installSyncRecovery() {
    document.addEventListener(
      'click',
      (event) => {
        const button = event.target?.closest?.('button');
        if (!button || !SYNC_BUTTON_IDS.has(button.id)) return;
        setTimeout(async () => {
          await waitForPrimarySyncIdle();
          await repairFinishedDates({ fetchMissingDates: true });
        }, 0);
      },
      true,
    );
  }

  async function init() {
    window.Yueji = window.Yueji || {};
    window.Yueji.repairWeReadFinishedDates = repairFinishedDates;
    installSyncRecovery();
    await waitForFinishedFix();
    try {
      await window.Yueji.reconcileWeReadFinishedBooks?.({
        fetchMissingDates: Boolean(sessionStorage.getItem(SESSION_KEY)),
      });
    } catch {}
    await repairFinishedDates({
      fetchMissingDates: Boolean(sessionStorage.getItem(SESSION_KEY)),
    });
    refresh();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else void init();
})();
