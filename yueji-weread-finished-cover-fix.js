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

  function normalizeText(value) {
    return String(value || '')
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[\s·•:：,，.。!！?？'"“”‘’\-—_()（）[\]【】《》〈〉<>]/g, '');
  }

  function normalizeAuthor(value) {
    return normalizeText(value).replace(/著|编著|主编|编|译者|翻译|译|作者/g, '');
  }

  async function waitForWeReadRuntimeReady(timeoutMs = 15000) {
    if (typeof localStorage === 'undefined') return true;
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (document.getElementById('wereadSettings')) return true;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return false;
  }

  function archiveState() {
    try {
      if (typeof state !== 'undefined' && state && typeof state === 'object') return state;
    } catch {}
    try {
      if (typeof localStorage !== 'undefined' && typeof localStorage.getItem === 'function') {
        const raw = localStorage.getItem(STORAGE_KEY);
        const archive = raw ? JSON.parse(raw) : null;
        if (archive && typeof archive === 'object') return archive;
      }
    } catch {}
    return null;
  }

  async function persistArchive(archive) {
    if (!archive || typeof archive !== 'object') return;
    if (typeof window.yuejiPersistExternalState === 'function') {
      await window.yuejiPersistExternalState(archive);
    }
    if (typeof save === 'function') {
      save();
      return;
    }
    try {
      if (typeof localStorage !== 'undefined' && typeof localStorage.setItem === 'function')
        localStorage.setItem(STORAGE_KEY, JSON.stringify(archive));
    } catch {}
  }

  function findBookByKey(key) {
    const archive = archiveState();
    return (archive?.books || []).find((item) => String(item?.key || '') === String(key || '')) || null;
  }

  function coverForBookKey(key) {
    const archive = archiveState();
    if (!archive) return '';
    const target = findBookByKey(key);
    if (!target) return '';
    const direct = String(
      target?.manualCover ||
        target?.cover ||
        target?.weReadCover ||
        target?.sourceArchives?.weread?.cover ||
        target?.sourceArchives?.weread?.weReadCover ||
        '',
    ).trim();
    if (direct) return direct;

    const id = String(target?.weReadBookId || target?.sourceArchives?.weread?.weReadBookId || '');
    if (id) {
      const sibling = (archive.books || []).find(
        (item) => String(item?.weReadBookId || '') === id && (item?.cover || item?.weReadCover),
      );
      const siblingCover = String(sibling?.cover || sibling?.weReadCover || '').trim();
      if (siblingCover) return siblingCover;
      const shelf = (archive.weRead?.shelfBooks || []).find(
        (item) => String(item?.bookId || '') === id,
      );
      const shelfCover = String(shelf?.cover || '').trim();
      if (shelfCover) return shelfCover;
    }

    const title = normalizeText(target?.title),
      author = normalizeAuthor(target?.author);
    if (!title) return '';
    const sibling = (archive.books || []).find((item) => {
      if (item === target) return false;
      if (normalizeText(item?.title) !== title) return false;
      const otherAuthor = normalizeAuthor(item?.author);
      return (!author || !otherAuthor || author === otherAuthor) && (item?.cover || item?.weReadCover);
    });
    return String(sibling?.cover || sibling?.weReadCover || '').trim();
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

  function refreshDerivedPanels() {
    try {
      if (typeof renderMonthly === 'function' && document.getElementById('monthFinished')) renderMonthly();
    } catch (error) {
      window.Yueji?.errors?.capture?.(error, {
        area: 'ui',
        stage: 'refresh-monthly-after-weread-reconcile',
        recoverable: true,
        quiet: true,
      });
    }
    try {
      if (typeof renderYearWall === 'function' && document.getElementById('yearWallPreview'))
        (window.renderYearWall || renderYearWall)();
    } catch (error) {
      window.Yueji?.errors?.capture?.(error, {
        area: 'ui',
        stage: 'refresh-year-wall-after-weread-reconcile',
        recoverable: true,
        quiet: true,
      });
    }
  }

  async function reconcileWeReadFinishedBooks({ fetchMissingDates = true } = {}) {
    if (typeof localStorage !== 'undefined') await waitForWeReadRuntimeReady();
    const archive = archiveState();
    if (!archive?.books?.length) {
      refreshDerivedPanels();
      return false;
    }
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
      const sourceCover = String(raw?.cover || '').trim();
      if (sourceCover && !target.weReadCover) {
        target.weReadCover = sourceCover;
        changed = true;
      }
      if (sourceCover && !target.cover) {
        target.cover = sourceCover;
        changed = true;
      }
      const directFinishedDate = safeDate(raw?.finishTime || target?.finishTime);
      if (!target.finishedDate && directFinishedDate) {
        target.finishedDate = directFinishedDate;
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
            if (detail.finishReading !== undefined && target.finishReading !== detail.finishReading) {
              target.finishReading = detail.finishReading;
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
      }
    }
    refreshDerivedPanels();
    applyCoverFallbacks();
    return changed;
  }

  function addCoverFallback(img) {
    if (!(img instanceof HTMLImageElement) || !img.dataset.coverKey) return;
    const fallback = coverForBookKey(img.dataset.coverKey);
    if (!fallback) return;
    img.dataset.coverFallback = fallback;
    img.referrerPolicy = 'no-referrer';
    const parent = img.closest(
      '.cover-art,.layout-cover-art,.home-recent-cover,.month-book-cover,.poster-cover,.note-book-cover,.day-cover',
    );
    if (img.dataset.coverFallbackBound !== '1') {
      img.dataset.coverFallbackBound = '1';
      img.addEventListener('load', () => parent?.classList.add('has-image'));
      img.addEventListener('error', () => {
        parent?.classList.remove('has-image');
      });
    }
    if (!img.getAttribute('src')) img.src = img.dataset.coverFallback;
  }

  function applyCoverFallbacks(root = document) {
    if (!root) return;
    if (root instanceof HTMLImageElement) addCoverFallback(root);
    root.querySelectorAll?.('img[data-cover-key]').forEach(addCoverFallback);
  }

  function applyYearCoverFallbacks(root = document.getElementById('yearWallPreview')) {
    applyCoverFallbacks(root);
  }

  function patchHydrateCovers() {
    const current = window.hydrateCovers;
    if (typeof current !== 'function' || current.__yuejiDirectCoverFallback) return false;
    const wrapped = async function (root = document) {
      applyCoverFallbacks(root);
      const result = await current(root);
      applyCoverFallbacks(root);
      return result;
    };
    wrapped.__yuejiDirectCoverFallback = true;
    window.hydrateCovers = wrapped;
    return true;
  }

  function observeCoverNodes() {
    applyCoverFallbacks(document);
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes || []) {
          if (node?.nodeType === 1) applyCoverFallbacks(node);
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
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
          applyCoverFallbacks();
        }, 0);
      },
      true,
    );
  }

  function init() {
    window.Yueji = window.Yueji || {};
    window.Yueji.isWeReadFinished = isWeReadFinished;
    window.Yueji.reconcileWeReadFinishedBooks = reconcileWeReadFinishedBooks;
    window.Yueji.applyCoverFallbacks = applyCoverFallbacks;
    window.Yueji.applyYearCoverFallbacks = applyYearCoverFallbacks;
    window.Yueji.coverForBookKey = coverForBookKey;
    patchHydrateCovers();
    observeCoverNodes();
    installSyncRecovery();
    void reconcileWeReadFinishedBooks({
      fetchMissingDates: Boolean(sessionStorage.getItem(SESSION_KEY)),
    }).then(() => {
      patchHydrateCovers();
      refreshDerivedPanels();
      applyCoverFallbacks();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
