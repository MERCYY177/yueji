(() => {
  'use strict';

  const SYNC_BUTTON_IDS = new Set([
    'wereadConnectBtn',
    'wereadSyncBtn',
    'wereadContinueBtn',
    'wereadRestartBtn',
  ]);
  const SESSION_KEY = 'yueji-weread-key';
  const STORAGE_KEY = 'yueji-archive-v1';

  function finishFlag(value) {
    if (value === true || value === 1) return true;
    const normalized = String(value ?? '')
      .trim()
      .toLowerCase();
    return normalized === '1' || normalized === 'true';
  }

  function isWeReadFinished(raw = {}, detail = {}) {
    const progress = Number(detail?.progress ?? raw?.progress ?? raw?.readingProgress);
    return (
      finishFlag(raw?.finishReading) ||
      finishFlag(detail?.finishReading) ||
      (Number.isFinite(progress) && progress >= 99.95) ||
      Boolean(raw?.finishTime || detail?.finishTime || raw?.finishedDate || detail?.finishedDate)
    );
  }

  function safeDate(value) {
    const number = Number(value);
    if (!number) return '';
    const date = new Date(number < 1e12 ? number * 1000 : number);
    if (Number.isNaN(date.getTime())) return '';
    const pad = (part) => String(part).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function archiveState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const archive = raw ? JSON.parse(raw) : null;
      return archive && typeof archive === 'object' ? archive : null;
    } catch {
      return null;
    }
  }

  async function persistArchive(archive) {
    if (!archive || typeof archive !== 'object') return;
    if (typeof replaceArchiveData === 'function') {
      await replaceArchiveData(archive, false);
      if (typeof renderAll === 'function') renderAll();
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(archive));
  }

  function findBookByKey(key) {
    const archive = archiveState();
    return (archive?.books || []).find((item) => String(item?.key || '') === String(key || '')) || null;
  }

  async function fetchProgress(bookId) {
    const key = sessionStorage.getItem(SESSION_KEY) || '';
    if (!key || !bookId) return null;
    const gateway = window.Yueji?.wereadGateway || '/.netlify/functions/weread-gateway';
    const response = await fetch(gateway, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
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

  async function reconcileWeReadFinishedBooks({ fetchMissingDates = true } = {}) {
    const archive = archiveState();
    if (!archive?.books?.length) return false;
    const shelf = Array.isArray(archive.weRead?.shelfBooks) ? archive.weRead.shelfBooks : [];
    const shelfById = new Map(
      shelf
        .filter((item) => item?.bookId)
        .map((item) => [String(item.bookId), item]),
    );
    let changed = false;

    for (const target of archive.books) {
      const id = String(target?.weReadBookId || '');
      if (!id) continue;
      const raw = shelfById.get(id) || target;
      if (!isWeReadFinished(raw, target)) continue;

      const manualProgress = target.progressSource === 'manual';
      if (raw?.finishReading !== undefined && target.finishReading !== raw.finishReading) {
        target.finishReading = raw.finishReading;
        changed = true;
      }
      if (raw?.cover && !target.weReadCover) {
        target.weReadCover = raw.cover;
        changed = true;
      }
      if (raw?.cover && !target.cover) {
        target.cover = raw.cover;
        changed = true;
      }
      if (!manualProgress && Number(target.progress || 0) < 99.95) {
        target.progress = 100;
        changed = true;
      }
      if ((!manualProgress || Number(target.progress || 0) >= 99.95) && target.status !== 'done') {
        target.status = 'done';
        changed = true;
      }

      if (!target.finishedDate && fetchMissingDates) {
        try {
          const detail = await fetchProgress(id);
          if (detail && isWeReadFinished(raw, detail)) {
            const finishedDate = safeDate(detail.finishTime);
            if (finishedDate) {
              target.finishedDate = finishedDate;
              target.finishTime = detail.finishTime;
              changed = true;
            }
            if (!manualProgress && Number(target.progress || 0) < 99.95) {
              target.progress = 100;
              changed = true;
            }
            if ((!manualProgress || Number(target.progress || 0) >= 99.95) && target.status !== 'done') {
              target.status = 'done';
              changed = true;
            }
          }
        } catch (error) {
          window.Yueji?.errors?.capture?.(error, {
            area: 'weread',
            stage: 'finished-date-recovery',
            recoverable: true,
            quiet: true,
          });
        }
      }
    }

    if (changed) {
      try {
        await persistArchive(archive);
      } catch (error) {
        window.Yueji?.errors?.capture?.(error, {
          area: 'weread',
          stage: 'finished-archive-persist',
          recoverable: true,
          quiet: true,
        });
        localStorage.setItem(STORAGE_KEY, JSON.stringify(archive));
      }
    }
    return changed;
  }

  function addCoverFallback(img) {
    if (!(img instanceof HTMLImageElement) || !img.dataset.coverKey) return;
    const source = findBookByKey(img.dataset.coverKey);
    const fallback = String(source?.cover || source?.weReadCover || '').trim();
    if (!fallback) return;
    img.dataset.coverFallback = fallback;
    if (!img.getAttribute('src')) img.src = img.dataset.coverFallback;
    if (img.dataset.coverFallbackBound === '1') return;
    img.dataset.coverFallbackBound = '1';
    img.addEventListener('error', () => {
      if (img.dataset.coverFallbackApplied === '1' || !img.dataset.coverFallback) return;
      img.dataset.coverFallbackApplied = '1';
      img.src = img.dataset.coverFallback;
    });
  }

  function applyYearCoverFallbacks(root = document.getElementById('yearWallPreview')) {
    if (!root) return;
    root.querySelectorAll('img[data-cover-key]').forEach(addCoverFallback);
  }

  function observeYearWall() {
    const root = document.getElementById('yearWallPreview');
    if (!root) return;
    applyYearCoverFallbacks(root);
    const observer = new MutationObserver(() => applyYearCoverFallbacks(root));
    observer.observe(root, { childList: true, subtree: true });
  }

  async function waitForPrimarySyncIdle(timeoutMs = 15 * 60 * 1000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const disabled = [...SYNC_BUTTON_IDS].some((id) => document.getElementById(id)?.disabled);
      if (!window.__yuejiWeReadSyncing && !disabled) return true;
      await new Promise((resolve) => setTimeout(resolve, 350));
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
          await reconcileWeReadFinishedBooks({ fetchMissingDates: true });
          applyYearCoverFallbacks();
        }, 0);
      },
      true,
    );
  }

  function init() {
    window.Yueji = window.Yueji || {};
    window.Yueji.isWeReadFinished = isWeReadFinished;
    window.Yueji.reconcileWeReadFinishedBooks = reconcileWeReadFinishedBooks;
    window.Yueji.applyYearCoverFallbacks = applyYearCoverFallbacks;
    observeYearWall();
    installSyncRecovery();
    void reconcileWeReadFinishedBooks({
      fetchMissingDates: Boolean(sessionStorage.getItem(SESSION_KEY)),
    }).then(() => applyYearCoverFallbacks());
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();