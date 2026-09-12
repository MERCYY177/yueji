(() => {
  'use strict';

  const EXT_KEY = 'yueji-weread-key';
  const SYNC_GUARD_KEY = 'yueji-weread-sync-guard-v1';
  const SYNC_DB = 'yueji-weread-sync-v1';
  const SYNC_STORE = 'records';
  const SYNC_DIAGNOSTIC_KEY = 'yueji-weread-last-stage-v1';
  const GATEWAY = '/.netlify/functions/weread-gateway';
  const SKILL_VERSION = '1.0.4';
  const AUTO_SYNC_MS = 6 * 60 * 60 * 1000;
  const REQUEST_TIMEOUT_MS = 18000;
  const SYNC_DEADLINE_MS = 60000;
  const PROGRESS_BATCH_SIZE = 1;
  const API_RESPONSE_MAX_BYTES = 512 * 1024;
  const JSON_WORKER_THRESHOLD = 256 * 1024;
  const WR_SESSION_PREFIX = 'weread-day:';
  const WR_HIGHLIGHT_MARKER = '__YUEJI_WEREAD__';
  const EXT_KEY_PERSIST = 'yueji-weread-key-persist-v1';
  let activeSync = null;
  let fullSyncRunning = false;
  let fullSyncCancelled = false;
  let hiddenBookIds = new Set();
  let bookByWeReadId = new Map();
  let bookByIdentity = new Map();
  let booksByTitle = new Map();

  function sessionStore() {
    try {
      return typeof sessionStorage !== 'undefined' ? sessionStorage : null;
    } catch {
      return null;
    }
  }
  function getSkillKey() {
    return sessionStore()?.getItem(EXT_KEY) || localStorage.getItem(EXT_KEY) || '';
  }
  function setSkillKey(value, persist = false) {
    const key = String(value || '').trim(),
      session = sessionStore();
    session?.removeItem(EXT_KEY);
    localStorage.removeItem(EXT_KEY);
    if (!key) return;
    if (persist || !session) {
      localStorage.setItem(EXT_KEY, key);
      localStorage.setItem(EXT_KEY_PERSIST, '1');
    } else {
      session.setItem(EXT_KEY, key);
      localStorage.removeItem(EXT_KEY_PERSIST);
    }
  }
  function clearSkillKey() {
    sessionStore()?.removeItem(EXT_KEY);
    localStorage.removeItem(EXT_KEY);
    localStorage.removeItem(EXT_KEY_PERSIST);
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const yieldToBrowser = () =>
    new Promise((resolve) => {
      if (globalThis.scheduler?.yield) globalThis.scheduler.yield().then(resolve, resolve);
      else setTimeout(resolve, 0);
    });

  async function parseJsonText(text) {
    const raw = String(text ?? '');
    if (raw.length < JSON_WORKER_THRESHOLD) {
      return JSON.parse(raw);
    }
    if (
      typeof Worker === 'undefined' ||
      typeof Blob === 'undefined' ||
      typeof URL?.createObjectURL !== 'function'
    )
      throw new Error('后台解析不可用，为保护页面已停止读取大数据');
    let worker;
    let workerUrl;
    let timeout;
    try {
      workerUrl = URL.createObjectURL(
        new Blob(
          [
            'self.onmessage=function(event){try{self.postMessage({ok:true,value:JSON.parse(event.data)})}catch(error){self.postMessage({ok:false,message:String(error&&error.message||error)})}}',
          ],
          { type: 'text/javascript' },
        ),
      );
      worker = new Worker(workerUrl);
      return await new Promise((resolve, reject) => {
        timeout = setTimeout(() => reject(new Error('解析数据超时')), REQUEST_TIMEOUT_MS);
        worker.onmessage = (event) =>
          event.data?.ok
            ? resolve(event.data.value)
            : reject(new Error(event.data?.message || '无法解析 JSON'));
        worker.onerror = () => reject(new Error('后台解析器启动失败'));
        worker.postMessage(raw);
      });
    } catch (error) {
      throw error;
    } finally {
      clearTimeout(timeout);
      worker?.terminate();
      if (workerUrl) URL.revokeObjectURL(workerUrl);
    }
  }
  window.yuejiParseJsonText = parseJsonText;

  async function stringifyJsonValue(value) {
    if (
      typeof Worker === 'undefined' ||
      typeof Blob === 'undefined' ||
      typeof URL?.createObjectURL !== 'function'
    ) {
      return JSON.stringify(value, null, 2);
    }
    let worker;
    let workerUrl;
    let timeout;
    try {
      workerUrl = URL.createObjectURL(
        new Blob(
          [
            'self.onmessage=function(event){try{self.postMessage({ok:true,value:JSON.stringify(event.data,null,2)})}catch(error){self.postMessage({ok:false,message:String(error&&error.message||error)})}}',
          ],
          { type: 'text/javascript' },
        ),
      );
      worker = new Worker(workerUrl);
      return await new Promise((resolve, reject) => {
        timeout = setTimeout(() => reject(new Error('生成备份超时')), 30000);
        worker.onmessage = (event) =>
          event.data?.ok
            ? resolve(event.data.value)
            : reject(new Error(event.data?.message || '无法生成备份'));
        worker.onerror = () => reject(new Error('后台备份生成器启动失败'));
        worker.postMessage(value);
      });
    } catch (error) {
      if (/超时|cyclic|circular/i.test(String(error?.message || error))) throw error;
      return JSON.stringify(value, null, 2);
    } finally {
      clearTimeout(timeout);
      worker?.terminate();
      if (workerUrl) URL.revokeObjectURL(workerUrl);
    }
  }
  window.yuejiStringifyJson = stringifyJsonValue;
  const n = (v) => Number(v) || 0;
  const safeDate = (ts) => {
    const num = Number(ts);
    if (!num) return '';
    const d = new Date(num < 1e12 ? num * 1000 : num);
    if (Number.isNaN(d.getTime())) return '';
    return dateKey(d);
  };
  const normalizeText = (s) =>
    String(s || '')
      .toLowerCase()
      .replace(/[\s·•:：,，.。!！?？\-—_()（）\[\]【】《》<>]/g, '');
  const normalizeAuthor = (s) => normalizeText(s).replace(/著|编|译|作者/g, '');
  const sourceName = (s) =>
    s === 'weread' ? '微信读书' : s === 'moon' ? '静读天下' : s === 'manual' ? '手动' : s || '';
  const compactShelfBook = (b) => ({
    bookId: b?.bookId,
    title: b?.title,
    name: b?.name,
    author: b?.author,
    authorName: b?.authorName,
    category: b?.category,
    cover: b?.cover,
    isbn: b?.isbn,
    finishReading: b?.finishReading,
    readUpdateTime: b?.readUpdateTime,
  });
  const compactNotebook = (nb) => ({
    book: compactShelfBook(nb?.book || { bookId: nb?.bookId }),
    bookId: nb?.bookId,
    readingProgress: nb?.readingProgress,
    sort: nb?.sort,
  });

  function isStorageLimitError(error) {
    return (
      error?.name === 'QuotaExceededError' ||
      error?.code === 22 ||
      /quota|storage.*(full|limit)|exceeded/i.test(String(error?.message || error))
    );
  }

  async function saveCheckpoint({ highlights = false, highlightRows = [] } = {}) {
    try {
      if (window.yuejiHighlightsReady) await window.yuejiHighlightsReady;
      if (window.yuejiHighlightsDbReady?.()) {
        if (highlights) await window.yuejiPersistHighlights();
        else if (highlightRows.length) await window.yuejiPutHighlights(highlightRows);
      }
      save();
      return true;
    } catch (error) {
      if (isStorageLimitError(error)) throw new Error('STORAGE_LIMIT');
      throw error;
    }
  }

  function saveBestEffort() {
    try {
      save();
      return true;
    } catch (error) {
      console.warn('Yueji local save skipped', error);
      return false;
    }
  }

  function syncDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(SYNC_DB, 2);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (db.objectStoreNames.contains('snapshots')) db.deleteObjectStore('snapshots');
        if (!db.objectStoreNames.contains(SYNC_STORE))
          db.createObjectStore(SYNC_STORE, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('微信同步数据库被其他页面占用'));
    });
  }
  function syncDbRequest(work, mode = 'readonly') {
    return syncDb().then(
      (db) =>
        new Promise((resolve, reject) => {
          const tx = db.transaction(SYNC_STORE, mode),
            store = tx.objectStore(SYNC_STORE),
            req = work(store);
          let result;
          req.onsuccess = () => {
            result = req.result;
          };
          req.onerror = () => reject(req.error);
          tx.oncomplete = () => {
            db.close();
            resolve(result);
          };
          tx.onerror = () => {
            db.close();
            reject(tx.error || new Error('微信同步暂存失败'));
          };
          tx.onabort = () => {
            db.close();
            reject(tx.error || new Error('微信同步暂存失败'));
          };
        }),
    );
  }
  function compactWeReadMeta(source = state) {
    const { daily, shelfBooks, ...meta } = source.weRead || {};
    return {
      ...meta,
      dailyCount: Object.keys(daily || {}).length,
      shelfTotal: n(source.weRead?.shelfTotal),
    };
  }
  function compactLocalWeReadMeta(source = state) {
    const { daily, shelfBooks, notebooks, reviewCursors, ...meta } = source.weRead || {};
    return {
      ...meta,
      dailyCount: Object.keys(daily || {}).length,
      shelfTotal: n(source.weRead?.shelfTotal),
      notebooksTotal: n(source.weRead?.notebooksTotal),
    };
  }
  function diagnosticStage(stage, detail = {}) {
    try {
      localStorage.setItem(SYNC_DIAGNOSTIC_KEY, JSON.stringify({ stage, detail, at: Date.now() }));
    } catch {}
  }
  async function putSyncRows(rows) {
    if (!rows.length) return;
    const db = await syncDb();
    try {
      for (let start = 0; start < rows.length; start += 50) {
        const tx = db.transaction(SYNC_STORE, 'readwrite'),
          done = new Promise((resolve, reject) => {
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
          }),
          store = tx.objectStore(SYNC_STORE);
        rows.slice(start, start + 50).forEach((row) => store.put(row));
        await done;
        await yieldToBrowser();
      }
    } finally {
      db.close();
    }
  }
  async function persistSyncIncrement({ books = [], sessions = [], includeShelf = false } = {}) {
    diagnosticStage('indexeddb-write', { books: books.length, sessions: sessions.length });
    const rows = [{ id: 'meta', kind: 'meta', savedAt: Date.now(), weRead: compactWeReadMeta() }];
    for (const b of books) {
      const id = String(b.weReadBookId || '');
      if (id) rows.push({ id: `book:${id}`, kind: 'book', value: b });
    }
    for (const s of sessions) {
      if (s.id) rows.push({ id: `session:${s.id}`, kind: 'session', value: s });
    }
    if (includeShelf)
      rows.push({
        id: 'shelf',
        kind: 'shelf',
        value: (state.weRead.shelfBooks || []).map(compactShelfBook),
      });
    await putSyncRows(rows);
    diagnosticStage('indexeddb-complete', { rows: rows.length });
  }
  async function persistMergedWeReadBook({
    book,
    removedWeReadIds = [],
    fromKey = '',
    toKey = '',
  }) {
    if (!book) return;
    const sessions = state.sessions.filter(
      (s) => s.source === 'weread' && String(s.bookKey || '') === String(toKey),
    );
    await persistSyncIncrement({ books: [book], sessions });
    const canonicalId = String(book.weReadBookId || ''),
      stale = [...new Set(removedWeReadIds.map(String))].filter((id) => id && id !== canonicalId);
    if (stale.length) {
      const db = await syncDb();
      try {
        const tx = db.transaction(SYNC_STORE, 'readwrite'),
          done = new Promise((resolve, reject) => {
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
          }),
          store = tx.objectStore(SYNC_STORE);
        stale.forEach((id) => store.delete(`book:${id}`));
        await done;
      } finally {
        db.close();
      }
    }
    diagnosticStage('merge-book-complete', {
      bookId: canonicalId,
      fromKey,
      toKey,
      sessions: sessions.length,
    });
  }
  async function persistSplitWeReadBook(book) {
    if (!book?.weReadBookId) return;
    const sessions = state.sessions.filter(
      (s) => s.source === 'weread' && String(s.bookKey || '') === String(book.key),
    );
    await persistSyncIncrement({ books: [book], sessions });
    diagnosticStage('split-book-complete', {
      bookId: String(book.weReadBookId),
      bookKey: String(book.key),
      sessions: sessions.length,
    });
  }
  async function replaceSyncArchive(source = state) {
    const books = (source.books || []).filter((b) => b.sources?.includes('weread')),
      sessions = (source.sessions || []).filter((s) => s.source === 'weread'),
      rows = [
        { id: 'meta', kind: 'meta', savedAt: Date.now(), weRead: compactWeReadMeta(source) },
        {
          id: 'shelf',
          kind: 'shelf',
          value: (source.weRead?.shelfBooks || []).map(compactShelfBook),
        },
      ];
    for (const b of books) {
      const id = String(b.weReadBookId || '');
      if (id) rows.push({ id: `book:${id}`, kind: 'book', value: b });
    }
    for (const s of sessions) {
      if (s.id) rows.push({ id: `session:${s.id}`, kind: 'session', value: s });
    }
    diagnosticStage('indexeddb-replace', {
      books: books.length,
      sessions: sessions.length,
      rows: rows.length,
    });
    const db = await syncDb();
    try {
      const tx = db.transaction(SYNC_STORE, 'readwrite'),
        done = new Promise((resolve, reject) => {
          tx.oncomplete = resolve;
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        }),
        store = tx.objectStore(SYNC_STORE);
      store.clear();
      rows.forEach((row) => store.put(row));
      await done;
      diagnosticStage('indexeddb-replace-complete', { rows: rows.length });
    } finally {
      db.close();
    }
  }
  async function stageSyncSnapshot() {
    await persistSyncIncrement();
    return true;
  }
  async function clearSyncSnapshot() {}
  async function commitSyncCheckpoint(options = {}) {
    if (options.highlightRows?.length) await persistHighlightRowsOnly(options.highlightRows);
    await persistSyncIncrement(options);
    diagnosticStage('step-complete', { phase: state.weRead.syncPhase });
  }
  async function persistHighlightRowsOnly(rows) {
    if (!rows?.length) return;
    if (window.yuejiHighlightsReady) await window.yuejiHighlightsReady;
    if (window.yuejiHighlightsDbReady?.()) await window.yuejiPutHighlights(rows);
    else state.highlights.push(...rows.filter((x) => !state.highlights.some((y) => y.id === x.id)));
  }
  function restoreCachedWeReadBook(found, incoming) {
    const canonicalKey = String(found.key || incoming.key || ''),
      localSources = (found.sources || []).filter(Boolean),
      hasMoon = localSources.includes('moon'),
      hasManualProgress = found.progressSource === 'manual' || found.manualProgress;
    const local = hasMoon
      ? {
          file: found.file,
          moonPath: found.moonPath,
          moonId: found.moonId,
          cover: found.cover,
          minutes: found.minutes,
          words: found.words,
          days: found.days,
        }
      : {};
    if (hasManualProgress)
      Object.assign(local, {
        progress: found.progress,
        progressSource: found.progressSource,
        manualProgress: found.manualProgress,
        status: found.status,
      });
    Object.assign(found, incoming, local);
    found.key = canonicalKey;
    found.sources = [...new Set([...localSources, ...(incoming.sources || []), 'weread'])];
    if (!local.cover) found.cover = incoming.cover || incoming.weReadCover || '';
    return found;
  }
  async function recoverSyncSnapshot() {
    let rows = [];
    try {
      rows = (await syncDbRequest((store) => store.getAll())) || [];
    } catch (error) {
      console.warn('微信同步数据库读取失败', error);
      return false;
    }
    if (!rows.length) return false;
    const hidden = new Set((state.hiddenWeReadBookIds || []).map(String)),
      meta = rows.find((x) => x.id === 'meta'),
      shelf = rows.find((x) => x.id === 'shelf'),
      keyMap = new Map();
    if (meta?.weRead)
      state.weRead = {
        ...state.weRead,
        ...meta.weRead,
        syncState: meta.weRead.syncState === 'running' ? 'paused' : meta.weRead.syncState,
      };
    if (shelf?.value)
      state.weRead.shelfBooks = shelf.value.filter((b) => !hidden.has(String(b?.bookId || '')));
    const byId = new Map(
        state.books.filter((b) => b.weReadBookId).map((b) => [String(b.weReadBookId), b]),
      ),
      byKey = new Map(state.books.map((b) => [String(b.key), b]));
    for (const row of rows) {
      if (row.kind !== 'book' || !row.value) continue;
      const incoming = row.value;
      if (incoming.weReadBookId && hidden.has(String(incoming.weReadBookId))) continue;
      const found = incoming.weReadBookId
        ? byId.get(String(incoming.weReadBookId))
        : byKey.get(String(incoming.key));
      if (found) {
        if (incoming.key && String(incoming.key) !== String(found.key))
          keyMap.set(String(incoming.key), String(found.key));
        restoreCachedWeReadBook(found, incoming);
      } else {
        state.books.push(incoming);
        byKey.set(String(incoming.key), incoming);
        if (incoming.weReadBookId) byId.set(String(incoming.weReadBookId), incoming);
      }
    }
    const resolveKey = (key) => {
      let value = String(key || ''),
        guard = 0;
      while (keyMap.has(value) && guard++ < 20) value = keyMap.get(value);
      return value;
    };
    const savedSessions = rows
        .filter((x) => x.kind === 'session' && x.value)
        .map((x) => {
          const value = x.value;
          return value.bookKey ? { ...value, bookKey: resolveKey(value.bookKey) } : value;
        }),
      sessionIds = new Set(savedSessions.map((x) => x.id));
    state.sessions = state.sessions
      .filter((s) => s.source !== 'weread' || !sessionIds.has(s.id))
      .concat(savedSessions);
    state.weRead.daily = {};
    savedSessions.forEach((s) => {
      if (s.date) state.weRead.daily[s.date] = n(s.seconds) || n(s.minutes) * 60;
    });
    rebuildBookIndexes();
    return true;
  }

  async function deleteSyncBook(bookId) {
    const id = String(bookId || '');
    if (!id) return;
    const db = await syncDb();
    try {
      const tx = db.transaction(SYNC_STORE, 'readwrite'),
        store = tx.objectStore(SYNC_STORE),
        shelfReq = store.get('shelf');
      shelfReq.onsuccess = () => {
        const row = shelfReq.result;
        if (row?.value) {
          row.value = row.value.filter((b) => String(b?.bookId || '') !== id);
          store.put(row);
        }
      };
      store.delete(`book:${id}`);
      await new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  }
  window.yuejiDeleteWeReadSyncBook = deleteSyncBook;

  window.yuejiCompactExternalState = (value) => {
    const books = (value.books || []).flatMap((b) => {
        const sources = (b.sources || []).filter((x) => x !== 'weread');
        if (!sources.length) return [];
        const copy = { ...b, sources };
        delete copy.weReadBookId;
        delete copy.weReadSeconds;
        delete copy.weReadLastRead;
        delete copy.weReadCover;
        delete copy.readUpdateTime;
        delete copy.finishReading;
        return [copy];
      }),
      weRead = value.weRead ? compactLocalWeReadMeta({ weRead: value.weRead }) : undefined;
    return {
      ...value,
      books,
      sessions: (value.sessions || []).filter((s) => s.source !== 'weread'),
      weRead,
    };
  };
  const compactExternalStateBase = window.yuejiCompactExternalState;
  window.yuejiCompactExternalState = (value) => {
    const result = compactExternalStateBase(value);
    result.books = (result.books || []).map((book) => {
      if (!book.sourceArchives) return book;
      const copy = { ...book, sourceArchives: { moon: book.sourceArchives.moon } };
      if (!copy.sourceArchives.moon) delete copy.sourceArchives;
      return copy;
    });
    return result;
  };
  window.yuejiPersistExternalState = replaceSyncArchive;
  window.yuejiPersistMergedWeReadBook = persistMergedWeReadBook;
  window.yuejiPersistSplitWeReadBook = persistSplitWeReadBook;

  function ensureStateShape() {
    state.weRead = state.weRead && typeof state.weRead === 'object' ? state.weRead : {};
    state.weRead.lastSync = n(state.weRead.lastSync);
    state.weRead.progressCursor = n(state.weRead.progressCursor);
    state.weRead.notesCursor = n(state.weRead.notesCursor);
    state.weRead.progressDone = Boolean(state.weRead.progressDone);
    state.weRead.notesDone = Boolean(state.weRead.notesDone);
    state.weRead.progressTotal = n(state.weRead.progressTotal);
    state.weRead.notebooksTotal = n(state.weRead.notebooksTotal);
    state.weRead.shelfTotal = n(state.weRead.shelfTotal);
    state.weRead.statsDays = n(state.weRead.statsDays);
    state.weRead.statsSyncYear = n(state.weRead.statsSyncYear);
    state.weRead.statsMonthCursor = n(state.weRead.statsMonthCursor);
    state.weRead.statsDone =
      state.weRead.statsDone === undefined
        ? Boolean(state.weRead.lastSync)
        : Boolean(state.weRead.statsDone);
    state.weRead.syncPhase = String(state.weRead.syncPhase || '');
    state.weRead.notebookCursor = state.weRead.notebookCursor ?? '';
    state.weRead.interruptedAt = n(state.weRead.interruptedAt);
    state.weRead.syncState = String(
      state.weRead.syncState || (state.weRead.lastSync ? 'base-complete' : 'idle'),
    );
    state.weRead.reviewCursors =
      state.weRead.reviewCursors && typeof state.weRead.reviewCursors === 'object'
        ? state.weRead.reviewCursors
        : {};
    state.weRead.shelfBooks = Array.isArray(state.weRead.shelfBooks) ? state.weRead.shelfBooks : [];
    state.weRead.notebooks = Array.isArray(state.weRead.notebooks) ? state.weRead.notebooks : [];
    state.weRead.autoRetryBlocked = Boolean(state.weRead.autoRetryBlocked);
    state.weRead.daily =
      state.weRead.daily && typeof state.weRead.daily === 'object' ? state.weRead.daily : {};
    state.books.forEach((b) => {
      if (!Array.isArray(b.sources)) {
        b.sources = [];
        if (b.weReadBookId) b.sources.push('weread');
        if (b.file || b.moonPath || b.moonId) b.sources.push('moon');
        if (!b.sources.length) b.sources.push('manual');
      }
      b.sources = [...new Set(b.sources)];
    });
    state.sessions.forEach((s) => {
      if (!s.source)
        s.source = s.id && String(s.id).startsWith(WR_SESSION_PREFIX) ? 'weread' : 'moon';
    });
    (state.highlights || []).forEach((h) => {
      if (!h.source) h.source = h.bookmark === WR_HIGHLIGHT_MARKER ? 'weread' : 'moon';
    });
    if (state.weRead.syncState === 'running' || localStorage.getItem(SYNC_GUARD_KEY)) {
      state.weRead.syncState = 'paused';
      state.weRead.interruptedAt = Date.now();
      localStorage.removeItem(SYNC_GUARD_KEY);
    }
    rebuildBookIndexes();
    saveBestEffort();
  }

  function bookIdentity(title, author) {
    return `${normalizeText(title)}|${normalizeAuthor(author)}`;
  }
  function rebuildBookIndexes() {
    hiddenBookIds = new Set((state.hiddenWeReadBookIds || []).map(String));
    bookByWeReadId = new Map();
    bookByIdentity = new Map();
    booksByTitle = new Map();
    state.books.forEach((b) => {
      if (b.weReadBookId) bookByWeReadId.set(String(b.weReadBookId), b);
      if (!b.sources?.includes('weread')) return;
      const title = normalizeText(b.title),
        id = bookIdentity(b.title, b.author);
      if (title && !bookByIdentity.has(id)) bookByIdentity.set(id, b);
      if (title) {
        const rows = booksByTitle.get(title) || [];
        rows.push(b);
        booksByTitle.set(title, rows);
      }
    });
  }

  function injectStyles() {
    if (document.getElementById('yuejiExtensionStyles')) return;
    const style = document.createElement('style');
    style.id = 'yuejiExtensionStyles';
    style.textContent = `
      .wr-connect-row{display:grid;grid-template-columns:1fr auto;gap:9px;align-items:center;margin-top:10px}
      .wr-key{width:100%;min-width:0;border:1px solid var(--line);background:var(--card);border-radius:12px;padding:11px 12px;outline:none}
      .wr-key:focus{border-color:rgba(var(--accent-rgb),.65);box-shadow:0 0 0 3px rgba(var(--accent-rgb),.10)}
      .wr-status{margin-top:9px;font-size:12px;line-height:1.65;color:var(--muted)}
      .wr-status strong{color:var(--text);font-weight:700}
      .wr-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
      .wr-progress{margin-top:12px;padding:12px;border:1px solid var(--line);border-radius:16px;background:var(--soft)}
      .wr-progress-head{display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:10px;font-size:12px}
      .wr-progress-head b{font-size:13px;color:var(--text)}
      .wr-progress-head span{color:var(--muted)}
      .wr-progress-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
      .wr-progress-item{padding:9px;border-radius:12px;background:var(--card);border:1px solid var(--line);min-width:0}
      .wr-progress-item span{display:block;color:var(--muted);font-size:10px;margin-bottom:4px}
      .wr-progress-item strong{display:block;color:var(--text);font-size:12px;overflow-wrap:anywhere}
      .wr-sync-report,.wr-evidence-note{margin-top:10px;padding:10px;border-radius:12px;background:var(--card);border:1px solid var(--line);font-size:11px;line-height:1.55}.wr-sync-report>b,.wr-evidence-note>b{display:block;margin-bottom:4px;color:var(--text)}.wr-sync-report>span,.wr-evidence-note>span{color:var(--muted)}.wr-sync-report>div{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}.wr-sync-report em{font-style:normal;padding:4px 7px;border-radius:999px;background:var(--soft);color:var(--text)}
      @media(max-width:520px){.wr-connect-row{grid-template-columns:1fr}.wr-connect-row .primary-btn{width:100%}.wr-progress-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
    `;
    document.head.appendChild(style);
  }

  function injectSettings() {
    const sheet = document.getElementById('settingsSheet');
    if (!sheet || document.getElementById('wereadSettings')) return;
    const first = sheet.querySelector('.settings-section');
    const section = document.createElement('div');
    section.className = 'settings-section';
    section.id = 'wereadSettings';
    section.innerHTML = `
      <h4>微信读书同步</h4>
      <div class="section-sub">输入微信读书 Skill Key 后，点击一次即可连续同步书架、阅读日期、进度、书摘和想法。同步完成前无需重复点击。数据保存在当前设备；手机和电脑需要各自完成一次同步。</div>
      <div class="wr-connect-row">
        <input id="wereadKeyInput" class="wr-key" type="password" autocomplete="off" placeholder="Skill Key">
        <button class="primary-btn" id="wereadConnectBtn">连接并完整同步</button>
      </div>
      <label class="check-line"><input id="wereadRememberKey" type="checkbox"><span>在此设备长期保存 Key（共享设备不建议启用）</span></label>
      <div class="wr-status" id="wereadStatus">尚未连接微信读书。</div>
      <div class="wr-progress" id="wereadProgressPanel"><div class="wr-progress-head"><b>正在恢复本地同步状态……</b></div></div>
      <div class="wr-actions">
        <button class="soft-btn" id="wereadSyncBtn">一键完整同步</button>
        <button class="soft-btn" id="wereadContinueBtn">继续未完成同步</button>
        <details><summary>高级同步选项</summary><button class="soft-btn" id="wereadRestartBtn">重新同步全部</button><button class="soft-btn" id="wereadProgressRefreshBtn">重新读取逐书进度/圆圈数据</button></details>
        <button class="soft-btn" id="wereadStopBtn" disabled>暂停同步</button>
        <button class="soft-btn" id="wereadDisconnectBtn" title="只清除 Skill Key 和连接状态，不删除已经同步到阅迹的数据">断开微信读书</button>
        <label class="soft-btn" style="display:inline-flex;align-items:center;cursor:pointer">导入微信读书 JSON<input id="wereadJsonFile" type="file" accept=".json,application/json" hidden></label>
      </div>`;
    sheet.insertBefore(section, first);
    const key = getSkillKey();
    document.getElementById('wereadKeyInput').value = key;
    document.getElementById('wereadRememberKey').checked =
      localStorage.getItem(EXT_KEY_PERSIST) === '1' && Boolean(localStorage.getItem(EXT_KEY));
    document.getElementById('wereadConnectBtn').addEventListener('click', async () => {
      const val = document.getElementById('wereadKeyInput').value.trim();
      if (!val) return setWeReadStatus('请先填入 Skill Key。', true);
      setSkillKey(val, document.getElementById('wereadRememberKey').checked);
      state.weRead.autoRetryBlocked = false;
      state.weRead.syncPhase = 'verify';
      await syncWeReadComplete({ manual: true });
    });
    document.getElementById('wereadSyncBtn').addEventListener('click', async () => {
      if (!getSkillKey()) return setWeReadStatus('还没有保存 Skill Key。', true);
      state.weRead.autoRetryBlocked = false;
      state.weRead.syncPhase = 'shelf';
      await syncWeReadComplete({ manual: true });
    });
    document.getElementById('wereadContinueBtn').addEventListener('click', async () => {
      if (!getSkillKey()) return setWeReadStatus('还没有保存 Skill Key。', true);
      await syncWeReadComplete({ manual: true });
    });
    document.getElementById('wereadRestartBtn').addEventListener('click', async () => {
      if (!getSkillKey()) return setWeReadStatus('还没有保存 Skill Key。', true);
      state.weRead.syncPhase = 'verify';
      state.weRead.statsSyncYear = 0;
      state.weRead.statsMonthCursor = 0;
      state.weRead.statsDone = false;
      state.weRead.progressCursor = 0;
      state.weRead.progressDone = false;
      state.weRead.notesCursor = 0;
      state.weRead.notesDone = false;
      state.weRead.notebookCursor = '';
      state.weRead.notebooks = [];
      state.weRead.reviewCursors = {};
      await syncWeReadComplete({ manual: true });
    });
    document.getElementById('wereadProgressRefreshBtn').addEventListener('click', async () => {
      if (!getSkillKey()) return setWeReadStatus('还没有保存 Skill Key。', true);
      if (!(state.weRead.shelfBooks || []).length)
        return setWeReadStatus('还没有书架资料，请先点击“更新基础数据”。', true);
      state.weRead.progressCursor = 0;
      state.weRead.progressDone = false;
      state.weRead.syncPhase = 'progress';
      state.weRead.autoRetryBlocked = false;
      delete state.weRead.progressLastResult;
      await syncWeRead({ mode: 'quick', manual: true });
    });
    document.getElementById('wereadStopBtn').addEventListener('click', () => stopFullSync());
    document.getElementById('wereadDisconnectBtn').addEventListener('click', () => {
      clearSkillKey();
      stopActiveSync(false);
      state.weRead.syncState = 'idle';
      saveBestEffort();
      document.getElementById('wereadKeyInput').value = '';
      setWeReadStatus('已断开微信读书。阅迹里已经同步过的数据不会删除。');
      updateSourcePill();
    });
    document.getElementById('wereadJsonFile').addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        await importWeReadFile(file);
        e.target.value = '';
      } catch (err) {
        const msg = String(err?.message || err);
        setWeReadStatus(
          msg === 'STORAGE_LIMIT'
            ? '浏览器本地储存空间不足，导入已停止。原有数据没有删除，请先导出备份。'
            : '导入失败：' + msg,
          true,
        );
      }
    });
    updateWeReadStatus();
  }

  async function importWeReadFile(file) {
    if (window.yuejiHighlightsReady) await window.yuejiHighlightsReady;
    const data = await parseJsonText(await file.text()),
      shelf = data.shelf || data.data?.shelf || data,
      books = Array.isArray(shelf.books)
        ? shelf.books
        : Array.isArray(data.books)
          ? data.books
          : [],
      progressRows = Array.isArray(data.progress)
        ? data.progress
        : Array.isArray(data.progresses)
          ? data.progresses
          : [];
    if (!books.length) throw new Error('文件里没有找到微信读书书架 books[]');
    const progressMap = new Map(
      progressRows.map((x) => [String(x.bookId || x.book?.bookId || ''), x]),
    );
    let imported = 0;
    for (let i = 0; i < books.length; i++) {
      const raw = books[i],
        merged = mergeBookFromWeRead(raw, progressMap.get(String(raw.bookId)));
      if (merged) imported++;
      if ((i + 1) % 25 === 0) {
        setWeReadStatus(`正在分批导入书架 ${i + 1}/${books.length}……`);
        await yieldToBrowser();
      }
    }
    const daily = data.daily || data.readDays || data.readdata?.daily;
    if (daily && typeof daily === 'object' && !Array.isArray(daily)) replaceWeReadDaily(daily);
    state.weRead.shelfBooks = books
      .filter((b) => !hiddenBookIds.has(String(b?.bookId || '')))
      .map(compactShelfBook);
    state.weRead.lastSync = Date.now();
    state.weRead.shelfTotal = imported;
    state.weRead.statsDays = Object.keys(state.weRead.daily || {}).length;
    state.weRead.syncState = 'base-complete';
    state.source = state.books.some((b) => b.sources?.includes('moon'))
      ? '多源阅读档案'
      : '微信读书';
    await persistSyncIncrement({
      books: state.books.filter((b) => b.sources?.includes('weread')),
      sessions: state.sessions.filter((s) => s.source === 'weread'),
      includeShelf: true,
    });
    await saveCheckpoint();
    await window.yuejiRequestPersistentStorage?.();
    renderAllSafe();
    updateSourcePill();
    updateWeReadStatus(`已从 JSON 导入 ${imported} 本书`);
    toast('微信读书 JSON 已导入');
  }

  function setWeReadStatus(text, isError = false) {
    const el = document.getElementById('wereadStatus');
    if (!el) return;
    el.innerHTML = `<span style="${isError ? 'color:#b65b5b' : ''}">${esc(text)}</span>`;
    updateWeReadProgressPanel();
  }

  function syncStateLabel() {
    const key = getSkillKey();
    if (!key) return '未连接';
    return (
      {
        running: '同步中',
        paused: '已暂停',
        error: '部分失败',
        complete: '全部完成',
        'base-complete': '基础数据完成',
        idle: '等待同步',
      }[state.weRead.syncState] || '等待同步'
    );
  }
  function syncPhaseLabel() {
    return (
      {
        verify: '验证连接',
        shelf: '待读书架',
        stats: '待读月份',
        progress: '待读进度',
        notebooks: '待读笔记目录',
        bookmarks: '待读划线',
        reviews: '待读想法',
        complete: '全部完成',
      }[inferSyncPhase()] || '等待同步'
    );
  }
  function syncReportHtml() {
    const r = state.weRead.lastReport;
    if (!r) return '';
    const at = new Date(r.completedAt).toLocaleString('zh-CN', { hour12: false });
    return `<div class="wr-sync-report"><b>最近一次完整同步</b><span>${esc(at)}</span><div><em>${n(r.shelfBooks)} 本书架</em><em>${n(r.readDays)} 个阅读日</em><em>${n(r.progressBooks)} 本已查进度</em><em>${n(r.notebookBooks)} 本有笔记目录</em></div></div>`;
  }
  function updateWeReadProgressPanel() {
    const panel = document.getElementById('wereadProgressPanel');
    if (!panel) return;
    const progressTotal = n(state.weRead.progressTotal),
      notesTotal = n(state.weRead.notebooksTotal),
      progressDone = state.weRead.progressDone ? progressTotal : n(state.weRead.progressCursor),
      notesDone = state.weRead.notesDone ? notesTotal : n(state.weRead.notesCursor),
      last = state.weRead.lastSync
        ? new Date(state.weRead.lastSync).toLocaleString('zh-CN', { hour12: false })
        : '尚未完成',
      monthProgress =
        !state.weRead.statsDone && state.weRead.statsSyncYear
          ? `${Math.min(n(state.weRead.statsMonthCursor), 12)} 月已保存`
          : `${n(state.weRead.statsDays)} 天`,
      lastProgress = state.weRead.progressLastResult,
      lastProgressText = lastProgress
        ? `<small class="wr-diagnostic">最近读取：《${esc(lastProgress.title || '未命名')}》 · ${esc(lastProgress.reason || '已保存')}</small>`
        : '';
    let diagnostic = '';
    try {
      const row = JSON.parse(localStorage.getItem(SYNC_DIAGNOSTIC_KEY) || 'null');
      if (row?.stage && !String(row.stage).endsWith('complete'))
        diagnostic = `<small class="wr-diagnostic">上次中断位置：${esc(row.stage)} · ${esc(new Date(row.at).toLocaleString('zh-CN', { hour12: false }))}</small>`;
    } catch {}
    panel.innerHTML = `<div class="wr-progress-head"><b>${esc(syncStateLabel())} · ${esc(syncPhaseLabel())}</b><span>最后更新：${esc(last)}</span></div><div class="wr-progress-grid"><div class="wr-progress-item"><span>书架</span><strong>${n(state.weRead.shelfTotal)} 本</strong></div><div class="wr-progress-item"><span>阅读统计</span><strong>${esc(monthProgress)}</strong></div><div class="wr-progress-item"><span>阅读进度</span><strong>${progressDone} / ${progressTotal || '待读取'}</strong></div><div class="wr-progress-item"><span>书摘书目</span><strong>${notesDone} / ${notesTotal || '待读取'}</strong></div></div>${lastProgressText}${diagnostic}${syncReportHtml()}`;
  }

  function updateWeReadStatus(extra = '') {
    const el = document.getElementById('wereadStatus');
    if (!el) return;
    const key = getSkillKey();
    if (!key) {
      el.textContent = '尚未连接微信读书。';
      updateWeReadProgressPanel();
      return;
    }
    const last = state.weRead.lastSync ? new Date(state.weRead.lastSync) : null;
    const lastText = last
      ? `${last.getFullYear()}-${pad(last.getMonth() + 1)}-${pad(last.getDate())} ${pad(last.getHours())}:${pad(last.getMinutes())}`
      : '尚未完成首次同步';
    const days = Object.keys(state.weRead.daily || {}).length;
    const wrBooks = state.books.filter((b) => b.sources?.includes('weread')).length;
    const recovery =
      !extra && state.weRead.interruptedAt
        ? '上次同步被浏览器中断，已恢复为暂停；已保存的数据仍然保留。'
        : '';
    el.innerHTML = `<strong>已连接</strong> · 上次同步：${esc(lastText)}<br>已保存 ${days} 天微信读书日级时长 · ${wrBooks} 本微信读书书籍${extra || recovery ? `<br>${esc(extra || recovery)}` : ''}`;
    updateWeReadProgressPanel();
  }

  function syncButtonState(running) {
    [
      'wereadConnectBtn',
      'wereadSyncBtn',
      'wereadContinueBtn',
      'wereadRestartBtn',
      'wereadProgressRefreshBtn',
    ].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.disabled = running;
    });
    const stop = document.getElementById('wereadStopBtn');
    if (stop) stop.disabled = !running;
  }

  function beginSync(mode) {
    if (activeSync) return null;
    activeSync = {
      mode,
      cancelled: false,
      started: Date.now(),
      deadline: Date.now() + SYNC_DEADLINE_MS,
      requests: 0,
      maxRequests: 1,
      controller: null,
    };
    rebuildBookIndexes();
    state.weRead.syncState = 'running';
    state.weRead.interruptedAt = 0;
    try {
      localStorage.setItem(SYNC_GUARD_KEY, JSON.stringify({ mode, started: activeSync.started }));
    } catch {}
    window.__yuejiWeReadSyncing = true;
    syncButtonState(true);
    updateWeReadProgressPanel();
    return activeSync;
  }

  function assertSyncActive(ctx) {
    if (!ctx || ctx !== activeSync || ctx.cancelled) throw new Error('SYNC_PAUSED');
    if (Date.now() > ctx.deadline) throw new Error('SYNC_TIME_LIMIT');
  }

  function stopActiveSync(showStatus = true) {
    if (!activeSync) return;
    activeSync.cancelled = true;
    try {
      activeSync.controller?.abort();
    } catch {}
    state.weRead.syncState = 'paused';
    if (showStatus) setWeReadStatus('正在暂停同步；当前请求结束后会保存已完成的数据。');
  }

  function stopFullSync() {
    fullSyncCancelled = true;
    if (activeSync) stopActiveSync();
    else {
      state.weRead.syncState = 'paused';
      setWeReadStatus('同步已暂停。已完成的数据已经保存，可以稍后继续。');
    }
  }
  window.yuejiStopWeReadSync = stopFullSync;

  async function readApiResponseText(res, ctx) {
    const declared = n(res.headers.get('content-length'));
    if (declared > API_RESPONSE_MAX_BYTES) throw new Error('微信读书单次返回数据过大，已安全停止');
    if (!res.body?.getReader) {
      const text = await res.text();
      if (new Blob([text]).size > API_RESPONSE_MAX_BYTES)
        throw new Error('微信读书单次返回数据过大，已安全停止');
      return text;
    }
    const reader = res.body.getReader(),
      decoder = new TextDecoder(),
      parts = [];
    let total = 0;
    try {
      while (true) {
        if (ctx) assertSyncActive(ctx);
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > API_RESPONSE_MAX_BYTES) {
          await reader.cancel();
          throw new Error('微信读书单次返回数据过大，已安全停止');
        }
        parts.push(decoder.decode(value, { stream: true }));
        if (parts.length % 8 === 0) await yieldToBrowser();
      }
      parts.push(decoder.decode());
      return parts.join('');
    } finally {
      try {
        reader.releaseLock();
      } catch {}
    }
  }

  async function wereadCall(apiName, params = {}, ctx = activeSync) {
    const key = getSkillKey();
    if (!key) throw new Error('没有 Skill Key');
    if (ctx) assertSyncActive(ctx);
    if (ctx && ctx.requests >= ctx.maxRequests) throw new Error('SYNC_REQUEST_LIMIT');
    if (ctx) ctx.requests++;
    const controller = new AbortController();
    if (ctx) ctx.controller = controller;
    const remaining = ctx ? Math.max(1, ctx.deadline - Date.now()) : REQUEST_TIMEOUT_MS;
    const timer = setTimeout(() => controller.abort(), Math.min(REQUEST_TIMEOUT_MS, remaining));
    let res;
    try {
      res = await fetch(GATEWAY, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_name: apiName, skill_version: SKILL_VERSION, ...params }),
        signal: controller.signal,
      });
      let data;
      try {
        diagnosticStage('response-read', { apiName });
        const text = await readApiResponseText(res, ctx);
        diagnosticStage('response-parse', {
          apiName,
          bytes: new TextEncoder().encode(text).byteLength,
        });
        await yieldToBrowser();
        data = await parseJsonText(text);
        diagnosticStage('response-parsed', { apiName });
      } catch (error) {
        if (/^SYNC_|微信读书单次返回数据过大/.test(String(error?.message || ''))) throw error;
        throw new Error(`微信读书返回了无法解析的响应（${res.status}）`);
      }
      if (!res.ok || (data?.errcode && data.errcode !== 0))
        throw new Error(data?.errmsg || data?.message || `微信读书接口错误（${res.status}）`);
      if (ctx) assertSyncActive(ctx);
      return data?.data && typeof data.data === 'object' ? data.data : data;
    } catch (error) {
      if (error?.name === 'AbortError') {
        if (ctx?.cancelled) throw new Error('SYNC_PAUSED');
        if (ctx && Date.now() >= ctx.deadline) throw new Error('SYNC_TIME_LIMIT');
        throw new Error('微信读书响应超时，请稍后重试；已经同步的数据会保留');
      }
      throw error;
    } finally {
      clearTimeout(timer);
      if (ctx?.controller === controller) ctx.controller = null;
    }
  }

  function mergeBookFromWeRead(raw, progress) {
    if (!raw) return null;
    const bookId = String(raw.bookId || progress?.bookId || '');
    if (bookId && hiddenBookIds.has(bookId)) return null;
    const title = raw.title || raw.name || '';
    const author = raw.author || raw.authorName || '';
    let existing = bookId ? bookByWeReadId.get(bookId) : null;
    if (!existing && title) {
      const nt = normalizeText(title),
        na = normalizeAuthor(author);
      existing =
        bookByIdentity.get(`${nt}|${na}`) ||
        (na
          ? (booksByTitle.get(nt) || []).find(
              (b) => !normalizeAuthor(b.author) || normalizeAuthor(b.author) === na,
            )
          : null);
    }
    if (!existing) {
      if (!title) return null;
      existing = {
        key: `wr:${bookId || Date.now()}:${Math.random().toString(36).slice(2, 7)}`,
        title,
        author,
        category: raw.category || '未分类',
        progress: n(progress?.book?.progress),
        status:
          n(progress?.book?.progress) >= 100 || raw.finishReading === 1
            ? 'done'
            : n(progress?.book?.progress) > 0
              ? 'reading'
              : 'unread',
        minutes: 0,
        words: 0,
        color: palette[state.books.length % palette.length],
        sources: ['weread'],
      };
      state.books.push(existing);
      bookByIdentity.set(bookIdentity(existing.title, existing.author), existing);
      const titleKey = normalizeText(existing.title),
        rows = booksByTitle.get(titleKey) || [];
      rows.push(existing);
      booksByTitle.set(titleKey, rows);
    }
    existing.sources = [...new Set([...(existing.sources || []), 'weread'])];
    if (title && (!existing.title || /^未命名(?:书籍)?$/.test(String(existing.title).trim())))
      existing.title = title;
    existing.weReadBookId = bookId || existing.weReadBookId;
    if (bookId) bookByWeReadId.set(bookId, existing);
    existing.weReadCover = raw.cover || existing.weReadCover;
    existing.cover = existing.cover || raw.cover || '';
    if (!existing.author && author) existing.author = author;
    if ((!existing.category || existing.category === '未分类') && raw.category)
      existing.category = raw.category;
    if (raw.isbn && !existing.isbn) existing.isbn = raw.isbn;
    const p = n(progress?.book?.progress);
    if (p || progress?.book?.isStartReading) {
      existing.weReadProgress = p;
      if (existing.progressSource !== 'manual' && !existing.manualProgress)
        existing.progress = Math.max(n(existing.progress), p);
      existing.status = p >= 100 ? 'done' : p > 0 ? 'reading' : existing.status;
    }
    const sec = n(progress?.book?.recordReadingTime);
    if (sec > 0) existing.weReadSeconds = sec;
    if ((sec > 0 || p > 0 || progress?.book?.isStartReading) && !existing.weReadFirstSeenAt)
      existing.weReadFirstSeenAt = todayKey;
    const detailUpdateTime = progress?.book?.updateTime || progress?.updateTime;
    if (detailUpdateTime) existing.weReadLastRead = safeDate(detailUpdateTime);
    else if (raw.readUpdateTime) existing.weReadShelfReadUpdate = safeDate(raw.readUpdateTime);
    if (progress?.book) {
      const oldRows = Array.isArray(existing.weReadSnapshots) ? existing.weReadSnapshots : [];
      const sorted = [...oldRows].sort((a, b) => String(a.date).localeCompare(String(b.date)));
      const previous = sorted.at(-1),
        detailDate = safeDate(detailUpdateTime);
      const started =
        sec > 0 ||
        p > 0 ||
        progress.book.isStartReading === 1 ||
        progress.book.isStartReading === true;
      const hasVerifiedSnapshot = oldRows.some(
        (x) => x?.activity === true || String(x?.evidence || '').startsWith('detail-'),
      );
      const firstDetailedActivity = !hasVerifiedSnapshot && started && !!detailDate;
      const directTimestampActivity = started && !!detailDate;
      const changed = !!previous && (sec > n(previous.seconds) || p > n(previous.progress));
      const snapshotDate = detailDate || (changed ? todayKey : previous?.date || todayKey);
      const sameDate = oldRows.find((x) => x?.date === snapshotDate);
      // A later read of the same cumulative progress is only a baseline refresh.
      // It must never downgrade an already verified activity date and erase its circle.
      const preserveActivity = sameDate?.activity === true;
      const activity = directTimestampActivity || changed || preserveActivity;
      const snapshot = {
        ...sameDate,
        date: snapshotDate,
        progress: Math.max(n(sameDate?.progress), p),
        seconds: Math.max(n(sameDate?.seconds), sec),
        updateTime: Math.max(n(sameDate?.updateTime), n(detailUpdateTime)),
        activity,
        evidence: firstDetailedActivity
          ? 'detail-first'
          : directTimestampActivity
            ? sameDate?.evidence || 'detail-timestamp'
            : changed
              ? 'detail-change'
              : preserveActivity
                ? sameDate.evidence || 'detail-preserved'
                : 'baseline',
      };
      const rows = oldRows.filter((x) => x?.date !== snapshotDate);
      rows.push(snapshot);
      // Reading evidence is historical data, not a short-lived UI cache.
      existing.weReadSnapshots = rows.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    }
    if (progress?.book) {
      const evidenceDate = safeDate(detailUpdateTime);
      existing.weReadProgressEvidence = {
        date: evidenceDate,
        source: 'book-progress',
        progress: p,
        seconds: sec,
      };
    }
    const finishTime = progress?.book?.finishTime;
    if (finishTime && !existing.finishedDate) existing.finishedDate = safeDate(finishTime);
    return existing;
  }

  function replaceWeReadDaily(dailyMap) {
    state.weRead.daily = { ...(state.weRead.daily || {}), ...dailyMap };
    state.sessions = state.sessions.filter((s) => !(s.source === 'weread' && s.aggregate === true));
    Object.entries(state.weRead.daily).forEach(([date, seconds]) => {
      const sec = n(seconds);
      if (sec <= 0) return;
      state.sessions.push({
        id: `${WR_SESSION_PREFIX}${date}`,
        date,
        bookKey: '',
        title: '微信读书',
        minutes: Math.round(sec / 60),
        seconds: sec,
        words: 0,
        source: 'weread',
        aggregate: true,
        precision: 'daily-total',
      });
    });
  }

  function parseReadTimesObject(obj) {
    const out = {};
    if (!obj || typeof obj !== 'object') return out;
    Object.entries(obj).forEach(([ts, sec]) => {
      const d = safeDate(ts);
      if (d && n(sec) >= 0) out[d] = n(sec);
    });
    return out;
  }

  function replaceWeReadMonth(year, month, daily) {
    const prefix = `${year}-${pad(month)}`,
      incoming = daily && typeof daily === 'object' ? daily : {};
    // The upstream month response can temporarily omit a recent day. Merge only
    // dates it explicitly returned so a refresh cannot delete yesterday's data.
    state.weRead.daily = { ...(state.weRead.daily || {}), ...incoming };
    const returnedDates = new Set(Object.keys(incoming).filter((date) => date.startsWith(prefix)));
    state.sessions = state.sessions.filter(
      (s) =>
        !(s.source === 'weread' && s.aggregate === true && returnedDates.has(String(s.date || ''))),
    );
    Object.entries(incoming).forEach(([date, seconds]) => {
      const sec = n(seconds);
      if (date.startsWith(prefix) && sec > 0)
        state.sessions.push({
          id: `${WR_SESSION_PREFIX}${date}`,
          date,
          bookKey: '',
          title: '微信读书',
          minutes: Math.round(sec / 60),
          seconds: sec,
          words: 0,
          source: 'weread',
          aggregate: true,
          precision: 'daily-total',
        });
    });
  }
  async function syncCurrentYearDaily(ctx = activeSync) {
    const now = new Date(),
      year = now.getFullYear(),
      lastMonth = now.getMonth() + 1;
    if (state.weRead.statsSyncYear !== year) {
      state.weRead.statsSyncYear = year;
      state.weRead.statsMonthCursor = 0;
      state.weRead.statsDone = false;
    } else if (state.weRead.statsDone) {
      state.weRead.statsMonthCursor = Math.max(0, lastMonth - 1);
      state.weRead.statsDone = false;
    }
    const completed = Math.max(0, Math.min(n(state.weRead.statsMonthCursor), lastMonth));
    if (completed >= lastMonth) {
      state.weRead.statsDone = true;
      state.weRead.statsMonthCursor = 0;
      return {
        year,
        days: n(state.weRead.statsDays),
        done: true,
        month: lastMonth,
        lastMonth,
        sessions: [],
      };
    }
    const month = completed + 1;
    assertSyncActive(ctx);
    setWeReadStatus(
      `正在同步 ${year} 年 ${month} 月阅读时间（${month}/${lastMonth}）。本次只处理这一个月……`,
    );
    const baseTime = Math.floor(new Date(year, month - 1, 15).getTime() / 1000),
      result = await wereadCall('/readdata/detail', { mode: 'monthly', baseTime }, ctx),
      daily = parseReadTimesObject(result.dailyReadTimes || result.readTimes);
    diagnosticStage('merge-month', { year, month, days: Object.keys(daily).length });
    replaceWeReadMonth(year, month, daily);
    state.weRead.statsMonthCursor = month;
    state.weRead.statsDays = Object.keys(state.weRead.daily).length;
    state.weRead.statsDone = month >= lastMonth;
    if (state.weRead.statsDone) state.weRead.statsMonthCursor = 0;
    return {
      year,
      days: state.weRead.statsDays,
      done: state.weRead.statsDone,
      month,
      lastMonth,
      sessions: state.sessions.filter(
        (s) => s.source === 'weread' && String(s.date || '').startsWith(`${year}-${pad(month)}`),
      ),
    };
  }

  async function syncShelfBase(ctx) {
    setWeReadStatus('正在读取微信读书书架……');
    const shelf = await wereadCall('/shelf/sync', {}, ctx);
    const seen = new Set();
    const books = (Array.isArray(shelf.books) ? shelf.books : []).filter((b) => {
      const id = String(b?.bookId || '');
      if (!id || seen.has(id) || hiddenBookIds.has(id)) return false;
      seen.add(id);
      return true;
    });
    for (let i = 0; i < books.length; i++) {
      assertSyncActive(ctx);
      mergeBookFromWeRead(books[i]);
      if ((i + 1) % 25 === 0) {
        setWeReadStatus(`正在分批整理书架 ${i + 1}/${books.length}……`);
        await yieldToBrowser();
      }
    }
    state.weRead.shelfTotal = books.length;
    state.weRead.shelfBooks = books.map(compactShelfBook);
    return books;
  }

  async function syncProgressBatch(books, ctx) {
    const started = books
      .filter((b) => b.readUpdateTime || b.finishReading === 1)
      .sort((a, b) => n(b.readUpdateTime) - n(a.readUpdateTime));
    state.weRead.progressTotal = started.length;
    if (state.weRead.progressDone)
      return { done: true, completed: started.length, total: started.length };
    const start = Math.min(n(state.weRead.progressCursor), started.length);
    const batch = started.slice(start, start + PROGRESS_BATCH_SIZE);
    let completed = 0,
      changedBooks = [];
    for (const b of batch) {
      assertSyncActive(ctx);
      setWeReadStatus(`正在分批补阅读进度 ${start + completed + 1}/${started.length}……`);
      try {
        const p = await wereadCall('/book/getprogress', { bookId: b.bookId }, ctx),
          merged = mergeBookFromWeRead(b, p),
          evidence = merged?.weReadProgressEvidence;
        if (merged) changedBooks.push(merged);
        state.weRead.progressLastResult = {
          bookId: String(b.bookId || ''),
          title: b.title || b.name || merged?.title || '未命名',
          reason: evidence ? '已保存逐书进度' : '接口没有返回逐书进度',
        };
      } catch (e) {
        if (/^SYNC_/.test(e.message)) throw e;
        state.weRead.progressLastResult = {
          bookId: String(b.bookId || ''),
          title: b.title || b.name || '未命名',
          reason: `读取失败：${String(e?.message || e)}`,
        };
        console.warn('WeRead progress skipped', e);
      }
      completed++;
      await sleep(20);
    }
    const done = start + completed >= started.length;
    state.weRead.progressCursor = done ? 0 : start + completed;
    state.weRead.progressDone = done;
    await stageSyncSnapshot();
    return { done, completed: start + completed, total: started.length, changedBooks };
  }

  async function syncNotebookPage(ctx) {
    const params = { count: 20 },
      previous = state.weRead.notebookCursor;
    if (previous !== '' && previous !== null && previous !== undefined) params.lastSort = previous;
    setWeReadStatus(
      `正在读取微信读书笔记目录${previous !== '' ? '下一页' : '第一页'}。本次只有一个请求……`,
    );
    const data = await wereadCall('/user/notebooks', params, ctx),
      rows = (Array.isArray(data.books) ? data.books : []).map(compactNotebook),
      dedup = new Map(
        (state.weRead.notebooks || []).map((nb) => [
          String(nb?.book?.bookId || nb?.bookId || ''),
          nb,
        ]),
      );
    rows.forEach((nb) => {
      const id = String(nb?.book?.bookId || nb?.bookId || '');
      if (id) dedup.set(id, nb);
    });
    state.weRead.notebooks = [...dedup.values()];
    state.weRead.notebooksTotal = state.weRead.notebooks.length;
    const next = rows.at(-1)?.sort,
      hasNext = Boolean(
        data.hasMore &&
          rows.length &&
          next !== undefined &&
          next !== null &&
          next !== '' &&
          String(next) !== String(previous),
      );
    if (hasNext) {
      state.weRead.notebookCursor = next;
      state.weRead.syncPhase = 'notebooks';
    } else {
      state.weRead.notebookCursor = '';
      state.weRead.notesCursor = Math.min(
        n(state.weRead.notesCursor),
        state.weRead.notebooks.length,
      );
      state.weRead.syncPhase = state.weRead.notebooks.length ? 'bookmarks' : 'complete';
      state.weRead.notesDone = !state.weRead.notebooks.length;
    }
    await stageSyncSnapshot();
    return { done: !hasNext, total: state.weRead.notebooks.length };
  }

  function currentNotebook() {
    return (state.weRead.notebooks || [])[
      Math.min(n(state.weRead.notesCursor), (state.weRead.notebooks || []).length)
    ];
  }
  function finishNotebook() {
    state.weRead.notesCursor = n(state.weRead.notesCursor) + 1;
    const done = state.weRead.notesCursor >= (state.weRead.notebooks || []).length;
    state.weRead.notesDone = done;
    if (done) {
      state.weRead.notesCursor = 0;
      state.weRead.notebooks = [];
      state.weRead.syncPhase = 'complete';
    } else state.weRead.syncPhase = 'bookmarks';
    return done;
  }

  async function syncBookmarkStep(ctx) {
    const nb = currentNotebook();
    if (!nb) {
      state.weRead.notesDone = true;
      state.weRead.syncPhase = 'complete';
      return { done: true };
    }
    const rawBook = nb.book || { bookId: nb.bookId },
      merged = mergeBookFromWeRead(rawBook, { book: { progress: n(nb.readingProgress) } });
    if (!merged || !rawBook.bookId) {
      finishNotebook();
      return { done: state.weRead.notesDone };
    }
    setWeReadStatus(
      `正在读取书摘 ${n(state.weRead.notesCursor) + 1}/${state.weRead.notebooks.length} 的划线。本次只有一个请求……`,
    );
    const marks = await wereadCall('/book/bookmarklist', { bookId: rawBook.bookId }, ctx),
      rows = [];
    (marks.updated || []).forEach((x) => {
      if (!x.markText) return;
      rows.push({
        id: `wr-mark:${x.bookmarkId || `${rawBook.bookId}:${normalizeText(x.markText).slice(0, 40)}`}`,
        bookKey: merged.key,
        date: safeDate(x.createTime) || todayKey,
        time: n(x.createTime) * 1000,
        quote: x.markText,
        note: '',
        bookmark: WR_HIGHLIGHT_MARKER,
        source: 'weread',
        sourceId: x.bookmarkId || '',
      });
    });
    await persistHighlightRowsOnly(rows);
    state.weRead.syncPhase = 'reviews';
    await stageSyncSnapshot();
    return { done: false, count: rows.length };
  }

  async function syncReviewStep(ctx) {
    const nb = currentNotebook();
    if (!nb) {
      state.weRead.notesDone = true;
      state.weRead.syncPhase = 'complete';
      return { done: true };
    }
    const rawBook = nb.book || { bookId: nb.bookId },
      merged = mergeBookFromWeRead(rawBook, { book: { progress: n(nb.readingProgress) } });
    if (!merged || !rawBook.bookId) {
      finishNotebook();
      return { done: state.weRead.notesDone };
    }
    const key = String(rawBook.bookId),
      synckey = state.weRead.reviewCursors[key] || 0;
    setWeReadStatus(
      `正在读取书摘 ${n(state.weRead.notesCursor) + 1}/${state.weRead.notebooks.length} 的想法${synckey ? '下一页' : '第一页'}。本次只有一个请求……`,
    );
    const data = await wereadCall(
        '/review/list/mine',
        { bookid: rawBook.bookId, synckey, count: 20 },
        ctx,
      ),
      rows = [];
    (data.reviews || []).forEach((item) => {
      const r = item.review || item,
        content = r.content || '',
        abstract = r.abstract || '';
      if (!content && !abstract) return;
      rows.push({
        id: `wr-review:${r.reviewId || `${rawBook.bookId}:${normalizeText(content || abstract).slice(0, 40)}`}`,
        bookKey: merged.key,
        date: safeDate(r.createTime) || todayKey,
        time: n(r.createTime) * 1000,
        quote: abstract,
        note: content,
        bookmark: WR_HIGHLIGHT_MARKER,
        source: 'weread',
        sourceId: r.reviewId || '',
      });
    });
    await persistHighlightRowsOnly(rows);
    const next = data.synckey,
      hasNext = Boolean(data.hasMore && next && String(next) !== String(synckey));
    if (hasNext) {
      state.weRead.reviewCursors[key] = next;
      state.weRead.syncPhase = 'reviews';
    } else {
      delete state.weRead.reviewCursors[key];
      finishNotebook();
    }
    await stageSyncSnapshot();
    return { done: state.weRead.notesDone, count: rows.length };
  }

  function inferSyncPhase() {
    if (state.weRead.syncPhase && state.weRead.syncPhase !== 'complete')
      return state.weRead.syncPhase;
    if (!(state.weRead.shelfBooks || []).length) return 'shelf';
    if (!state.weRead.statsDone) return 'stats';
    if (!state.weRead.progressDone) return 'progress';
    if (!state.weRead.notesDone)
      return (state.weRead.notebooks || []).length ? 'bookmarks' : 'notebooks';
    return 'complete';
  }
  async function ensureSyncCapacity() {
    const raw = localStorage.getItem(STORAGE) || '';
    if (raw.length > 4 * 1024 * 1024) throw new Error('STORAGE_LIMIT');
    if (navigator.storage?.estimate) {
      const estimate = await navigator.storage.estimate(),
        remaining = n(estimate.quota) - n(estimate.usage);
      if (estimate.quota && remaining < 8 * 1024 * 1024) throw new Error('STORAGE_LIMIT');
    }
  }

  async function syncWeRead({ mode = 'quick', manual = false, resetDetails = false } = {}) {
    if (window.yuejiHighlightsReady) await window.yuejiHighlightsReady;
    if (window.__yuejiArchiveBusy)
      return setWeReadStatus('网页正在导入或导出数据，请完成后再同步。');
    try {
      await ensureSyncCapacity();
    } catch (error) {
      return setWeReadStatus(
        '浏览器可用储存空间不足，已在请求微信数据之前停止。请先导出备份并清理空间。',
        true,
      );
    }
    const ctx = beginSync(mode);
    if (!ctx) return setWeReadStatus('已有同步任务正在进行，可以先点“暂停同步”。');
    try {
      const phase = inferSyncPhase(),
        books = state.weRead.shelfBooks || [];
      let extra = '',
        changedBooks = [],
        changedSessions = [],
        includeShelf = false;
      diagnosticStage('step-start', { phase });
      if (phase === 'verify') {
        setWeReadStatus('正在验证微信读书连接。本次只有一个请求……');
        await wereadCall('/_list', {}, ctx);
        state.weRead.syncPhase = 'shelf';
        extra = '连接验证成功，程序会自动继续读取书架。';
      } else if (phase === 'shelf') {
        const shelfBooks = await syncShelfBase(ctx);
        changedBooks = state.books.filter((b) => b.sources?.includes('weread'));
        includeShelf = true;
        state.weRead.syncPhase = 'stats';
        state.weRead.progressDone = false;
        state.weRead.progressCursor = 0;
        state.weRead.notesDone = false;
        state.weRead.notesCursor = 0;
        state.weRead.notebookCursor = '';
        state.weRead.notebooks = [];
        state.weRead.reviewCursors = {};
        extra = `已保存 ${shelfBooks.length} 本书架资料，正在继续读取阅读时间……`;
      } else if (phase === 'stats') {
        const stats = await syncCurrentYearDaily(ctx);
        changedSessions = stats.sessions || [];
        state.weRead.syncPhase = stats.done ? 'progress' : 'stats';
        extra = stats.done
          ? `${stats.year} 年阅读时间已经补齐，正在继续读取逐书进度……`
          : `已保存 ${stats.year} 年 ${stats.month} 月数据，正在继续读取下一个月……`;
      } else if (phase === 'progress') {
        const progress = await syncProgressBatch(books, ctx);
        changedBooks = progress.changedBooks || [];
        state.weRead.syncPhase = progress.done ? 'notebooks' : 'progress';
        extra = progress.done
          ? `阅读进度 ${progress.completed}/${progress.total} 已完成，正在继续读取笔记目录……`
          : `已保存阅读进度 ${progress.completed}/${progress.total}，正在继续读取下一本……`;
      } else if (phase === 'notebooks') {
        const result = await syncNotebookPage(ctx);
        extra = result.done
          ? `笔记目录读取完成，共 ${result.total} 本，正在继续读取书摘和想法……`
          : `已保存 ${result.total} 本笔记目录，正在继续读取下一页……`;
      } else if (phase === 'bookmarks') {
        const result = await syncBookmarkStep(ctx);
        extra = result.done
          ? '书摘同步已经完成。'
          : `本书划线已保存 ${result.count || 0} 条，正在继续读取这本书的想法……`;
      } else if (phase === 'reviews') {
        const result = await syncReviewStep(ctx);
        extra = result.done
          ? '全部书摘已经同步完成。'
          : `本页想法已保存 ${result.count || 0} 条，正在自动继续……`;
      } else {
        state.weRead.syncPhase = 'complete';
        state.weRead.syncState = 'complete';
        extra = '微信读书数据已经全部同步完成。';
      }
      state.weRead.lastSync = Date.now();
      state.weRead.autoRetryBlocked = false;
      state.weRead.syncState = state.weRead.syncPhase === 'complete' ? 'complete' : 'paused';
      state.weRead.skillVersion = SKILL_VERSION;
      if (state.weRead.syncPhase === 'complete') {
        state.weRead.lastReport = {
          completedAt: Date.now(),
          shelfBooks: n(state.weRead.shelfTotal),
          readDays: Object.keys(state.weRead.daily || {}).length,
          progressBooks: n(state.weRead.progressTotal),
          notebookBooks: n(state.weRead.notebooksTotal),
        };
      }
      state.source = state.books.some((b) => b.sources?.includes('moon'))
        ? '多源阅读档案'
        : '微信读书';
      await commitSyncCheckpoint({ books: changedBooks, sessions: changedSessions, includeShelf });
      window.yuejiMarkDataRevision?.();
      if (phase === 'progress' && page === 'analytics') {
        renderAnalytics();
      }
      if (manual) await window.yuejiRequestPersistentStorage?.();
      updateSourcePill();
      updateWeReadStatus(extra);
      toast('本次同步步骤已保存');
    } catch (e) {
      const msg = String(e?.message || e);
      if (!/^SYNC_/.test(msg)) console.error(e);
      state.weRead.syncState = /^SYNC_/.test(msg) ? 'paused' : 'error';
      if (msg === 'SYNC_PAUSED')
        setWeReadStatus('同步已暂停。已完成的数据已经保存，可以稍后继续。');
      else if (msg === 'SYNC_TIME_LIMIT')
        setWeReadStatus(
          '本次同步已运行 60 秒并自动暂停。已完成的数据已经保存，请稍后点“继续同步”。',
        );
      else if (msg === 'SYNC_REQUEST_LIMIT')
        setWeReadStatus(
          '本批已达到安全读取上限并自动暂停。已完成的数据已经保存，请稍后点“继续同步”。',
        );
      else if (msg === 'SYNC_BATCH_LIMIT')
        setWeReadStatus('这本书的书摘较多，本批已安全暂停并记住位置。请再次点“继续同步”。');
      else if (msg === 'STORAGE_LIMIT')
        setWeReadStatus(
          '浏览器本地储存空间不足，已停止同步。此前成功保存的数据仍然保留；请先导出备份，之后再考虑迁移到更大容量的储存。',
          true,
        );
      else {
        const cors = /failed to fetch|networkerror|load failed/i.test(msg);
        state.weRead.autoRetryBlocked = true;
        setWeReadStatus(
          cors
            ? '连接失败：微信读书中转服务没有响应。系统不会自动反复重试，已有数据也不会删除。'
            : `同步未完成：${msg}。系统不会自动反复重试，已完成的数据会保留。`,
          true,
        );
        if (manual) toast('微信读书同步未完成');
      }
      try {
        await persistSyncIncrement();
      } catch (error) {
        console.warn('同步错误状态未能写入数据库', error);
      }
      updateSourcePill();
      updateWeReadProgressPanel();
    } finally {
      try {
        localStorage.removeItem(SYNC_GUARD_KEY);
      } catch {}
      if (activeSync === ctx) activeSync = null;
      window.__yuejiWeReadSyncing = false;
      syncButtonState(fullSyncRunning);
    }
  }

  function syncProgressSignature() {
    return [
      inferSyncPhase(),
      n(state.weRead.statsMonthCursor),
      n(state.weRead.progressCursor),
      String(state.weRead.notebookCursor ?? ''),
      n(state.weRead.notesCursor),
      JSON.stringify(state.weRead.reviewCursors || {}),
    ].join('|');
  }

  async function syncWeReadComplete({ manual = false } = {}) {
    if (fullSyncRunning || activeSync)
      return setWeReadStatus('已有完整同步正在进行，可以随时点击“暂停同步”。');
    fullSyncRunning = true;
    fullSyncCancelled = false;
    syncButtonState(true);
    let steps = 0;
    try {
      while (!fullSyncCancelled && inferSyncPhase() !== 'complete' && steps++ < 500) {
        const before = syncProgressSignature();
        await syncWeRead({ mode: 'complete', manual: false });
        if (
          fullSyncCancelled ||
          state.weRead.syncState === 'error' ||
          state.weRead.autoRetryBlocked
        )
          break;
        if (inferSyncPhase() === 'complete') break;
        if (before === syncProgressSignature()) {
          state.weRead.syncState = 'paused';
          setWeReadStatus('同步阶段没有继续推进，已安全暂停；已完成的数据仍然保留。', true);
          break;
        }
        // Keep the gateway below its per-IP rate limit and give mobile browsers
        // a paint opportunity between independently persisted requests.
        await sleep(1100);
      }
      if (steps >= 500 && inferSyncPhase() !== 'complete') {
        state.weRead.syncState = 'paused';
        setWeReadStatus('本次完整同步达到安全步骤上限，已保存进度，可以继续同步。');
      } else if (!fullSyncCancelled && inferSyncPhase() === 'complete') {
        state.weRead.syncState = 'complete';
        const remembered = localStorage.getItem(EXT_KEY_PERSIST) === '1';
        updateWeReadStatus(
          remembered
            ? '同步完成，本次无需再次点击；以后打开阅迹时会自动检查更新。'
            : '同步完成，本次无需再次点击。Skill Key 只保留在当前标签页，关闭网页后再次同步需要重新输入。',
        );
        if (manual) await window.yuejiRequestPersistentStorage?.();
        if (page === 'analytics') {
          renderAnalytics();
        }
        toast('微信读书完整同步已完成');
      }
    } finally {
      fullSyncRunning = false;
      window.__yuejiWeReadSyncing = false;
      syncButtonState(false);
    }
  }

  window.yuejiSyncWeReadComplete = syncWeReadComplete;

  function renderAllSafe() {
    try {
      renderToday();
    } catch {}
    try {
      renderCalendarPage();
    } catch {}
    try {
      renderBookOptions();
    } catch {}
    if (page === 'notes')
      try {
        renderNotes();
      } catch {}
    try {
      if (page === 'analytics') renderAnalytics();
    } catch {}
    try {
      if (page === 'monthly') {
        renderMonthly();
        (window.renderYearWall || renderYearWall)();
      }
    } catch {}
    if (page === 'notes') patchNoteSources();
  }

  function updateSourcePill() {
    const pill = document.getElementById('sourcePill');
    if (!pill) return;
    const hasWr =
      state.books.some((b) => b.sources?.includes('weread')) ||
      Object.keys(state.weRead.daily || {}).length > 0;
    const hasMoon =
      state.books.some((b) => b.sources?.includes('moon')) ||
      state.sessions.some((s) => s.source === 'moon');
    if (hasWr && hasMoon) pill.textContent = '多源档案';
    else if (hasWr) pill.textContent = '微信读书';
  }

  function patchNoteSources() {
    document.querySelectorAll('.note-meta').forEach((el) => {
      if (el.textContent.includes(`静读书摘 · ${WR_HIGHLIGHT_MARKER}`))
        el.textContent = el.textContent.replace(
          `静读书摘 · ${WR_HIGHLIGHT_MARKER}`,
          '微信读书书摘',
        );
      else if (el.textContent.includes(WR_HIGHLIGHT_MARKER))
        el.textContent = el.textContent.replace(WR_HIGHLIGHT_MARKER, '微信读书');
    });
  }

  function installHooks() {
    document
      .getElementById('noteSearch')
      ?.addEventListener('input', () => setTimeout(patchNoteSources, 0));
    document
      .getElementById('noteBookFilter')
      ?.addEventListener('change', () => setTimeout(patchNoteSources, 0));
    document.getElementById('mrproFile')?.addEventListener('change', () =>
      setTimeout(() => {
        ensureStateShape();
        updateSourcePill();
        if (page === 'analytics') renderAnalytics();
      }, 1500),
    );
    const notes = document.getElementById('notesList');
    if (notes)
      new MutationObserver(() => patchNoteSources()).observe(notes, {
        childList: true,
        subtree: true,
      });
  }

  function autoSyncIfNeeded() {
    const key = getSkillKey();
    const persistent = localStorage.getItem(EXT_KEY_PERSIST) === '1';
    if (
      !key ||
      !persistent ||
      state.weRead.autoRetryBlocked ||
      activeSync ||
      fullSyncRunning ||
      document.visibilityState !== 'visible' ||
      !navigator.onLine
    )
      return;
    if (Date.now() - n(state.weRead.lastSync) < AUTO_SYNC_MS) return;
    setWeReadStatus('正在自动检查微信读书更新……');
    state.weRead.syncPhase = 'shelf';
    syncWeReadComplete({ manual: false });
  }

  window.__yuejiWeReadDiagnostics = {
    inferSyncPhase,
    syncWeRead,
    stopActiveSync,
    replaceWeReadMonth,
    ensureStateShape,
    stageSyncSnapshot,
    persistSyncIncrement,
    recoverSyncSnapshot,
    mergeBookFromWeRead,
    deleteSyncBook,
  };
  window.yuejiRefreshWeReadBookIndexes = rebuildBookIndexes;
  window.yuejiPersistMergedWeReadState = () => replaceSyncArchive(state);
  async function init() {
    ensureStateShape();
    let recovered = await recoverSyncSnapshot();
    if (
      !recovered &&
      (state.books.some((b) => b.sources?.includes('weread')) ||
        state.sessions.some((s) => s.source === 'weread'))
    ) {
      diagnosticStage('legacy-migration-start');
      try {
        await replaceSyncArchive(state);
        diagnosticStage('legacy-migration-complete');
        recovered = true;
      } catch (error) {
        console.warn('旧微信数据迁移失败，原数据仍保留', error);
      }
    }
    let reconciled = false;
    try {
      if (window.yuejiHighlightsReady) await window.yuejiHighlightsReady;
      const result = await window.yuejiReconcileCrossSourceBooks?.();
      reconciled = Boolean(result?.changed);
      if (reconciled) {
        rebuildBookIndexes();
        await replaceSyncArchive(state);
      }
    } catch (error) {
      console.warn('跨平台书籍自动归并失败，原书籍仍保留', error);
    }
    injectStyles();
    injectSettings();
    installHooks();
    updateSourcePill();
    patchNoteSources();
    if (recovered || reconciled) {
      renderAllSafe();
      updateWeReadStatus(
        reconciled ? '已合并微信读书与静读天下中的同一本书。' : '微信读书数据已从独立数据库恢复。',
      );
    }
    const schedule = () => autoSyncIfNeeded();
    if (globalThis.requestIdleCallback) requestIdleCallback(schedule, { timeout: 15000 });
    else setTimeout(schedule, 10000);
  }
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
