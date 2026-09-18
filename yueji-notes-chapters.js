const STORAGE = 'yueji-archive-v1';
const HIGHLIGHTS_DB = 'yueji-highlights-v1';
const HIGHLIGHTS_STORE = 'highlights';
const GATEWAY = '/.netlify/functions/weread-gateway';
const SKILL_VERSION = '1.0.4';
const PAGE_SIZE = 80;

function normalizeText(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s·•:：,，.。!！?？'"“”‘’\-—_()（）\[\]【】《》〈〉<>]/g, '');
}

function chineseNumber(value) {
  const text = String(value || '').trim();
  if (/^\d+$/.test(text)) return Number(text);
  const digit = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const unit = { 十: 10, 百: 100, 千: 1000 };
  let total = 0;
  let current = 0;
  for (const char of text) {
    if (digit[char] !== undefined) current = digit[char];
    else if (unit[char]) {
      total += (current || 1) * unit[char];
      current = 0;
    } else return NaN;
  }
  return total + current;
}

function inferredChapterNumber(note) {
  const candidates = [note?.chapterTitle, note?.chapterName, note?.label, note?.bookmark]
    .filter(Boolean)
    .map(String);
  for (const text of candidates) {
    const zh = text.match(/第?([零一二两三四五六七八九十百千\d]+)[章节回]/);
    if (zh) {
      const n = chineseNumber(zh[1]);
      if (Number.isFinite(n) && n > 0) return n;
    }
    const en = text.match(/\bchapter\s*(\d+)\b/i);
    if (en) return Number(en[1]);
  }
  return null;
}

export function chapterMeta(note = {}) {
  const title = String(note.chapterTitle || note.chapterName || '').trim();
  if (title) {
    const inferred = inferredChapterNumber({ chapterTitle: title });
    return {
      key: note.chapterUid ? `uid:${note.chapterUid}` : `title:${title}`,
      label: title,
      order: Number.isFinite(inferred) ? inferred : Number.MAX_SAFE_INTEGER - 2,
    };
  }
  const idx = Number(note.chapterIdx ?? note.chapterIndex);
  if (Number.isFinite(idx) && idx >= 0) {
    const chapterNumber = idx + 1;
    return {
      key: note.chapterUid ? `uid:${note.chapterUid}` : `idx:${idx}`,
      label: `第 ${chapterNumber} 章`,
      order: chapterNumber,
    };
  }
  const inferred = inferredChapterNumber(note);
  if (Number.isFinite(inferred) && inferred > 0)
    return { key: `label:${inferred}`, label: `第 ${inferred} 章`, order: inferred };
  if (note.chapterUid)
    return {
      key: `uid:${note.chapterUid}`,
      label: '未命名章节',
      order: Number.MAX_SAFE_INTEGER - 1,
    };
  return { key: '_unknown', label: '未标章节', order: Number.MAX_SAFE_INTEGER };
}

function rangeStart(value) {
  const raw = Array.isArray(value) ? value[0] : value;
  const match = String(raw ?? '').match(/-?\d+/);
  return match ? Number(match[0]) : Number.MAX_SAFE_INTEGER;
}

export function groupNotesByChapter(items = []) {
  const groups = new Map();
  for (const item of items) {
    const meta = chapterMeta(item);
    if (!groups.has(meta.key)) groups.set(meta.key, { ...meta, items: [] });
    groups.get(meta.key).items.push(item);
  }
  const out = [...groups.values()].sort((a, b) => a.order - b.order || a.label.localeCompare(b.label, 'zh-CN'));
  out.forEach((group) =>
    group.items.sort(
      (a, b) =>
        rangeStart(a.range ?? a.chapterRange ?? a.position) -
          rangeStart(b.range ?? b.chapterRange ?? b.position) ||
        Number(a.time || a.sortTime || 0) - Number(b.time || b.sortTime || 0),
    ),
  );
  return out;
}

export function chapterPatchFromBookmark(item = {}) {
  const patch = {};
  if (item.chapterUid !== undefined && item.chapterUid !== null && item.chapterUid !== '')
    patch.chapterUid = String(item.chapterUid);
  const idx = Number(item.chapterIdx ?? item.chapterIndex);
  if (Number.isFinite(idx) && idx >= 0) patch.chapterIdx = idx;
  if (item.chapterTitle || item.chapterName)
    patch.chapterTitle = String(item.chapterTitle || item.chapterName);
  if (item.range !== undefined && item.range !== null) patch.range = item.range;
  return patch;
}

export function collapseDuplicateNotes(items = []) {
  const out = [];
  const byQuote = new Map();
  for (const raw of items) {
    const item = { ...raw };
    const quoteKey = normalizeText(item.quote);
    const chapter = chapterMeta(item).key;
    const key = quoteKey ? `${chapter}|${quoteKey}` : '';
    if (!key || !byQuote.has(key)) {
      out.push(item);
      if (key) byQuote.set(key, item);
      continue;
    }
    const keep = byQuote.get(key);
    if (!keep.thought && item.thought) keep.thought = item.thought;
    if (!keep.note && item.note) keep.note = item.note;
    for (const field of ['chapterUid', 'chapterIdx', 'chapterTitle', 'range', 'label'])
      if ((keep[field] === undefined || keep[field] === '') && item[field] !== undefined) keep[field] = item[field];
    keep.time = Math.min(Number(keep.time || Infinity), Number(item.time || Infinity));
  }
  return out;
}

function esc(value = '') {
  return String(value).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[m]);
}

function formatDate(key) {
  const m = String(key || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  return m ? `${m[1]}年${Number(m[2])}月${Number(m[3])}日` : String(key || '');
}

function loadState() {
  try {
    const state = JSON.parse(localStorage.getItem(STORAGE) || '{}');
    return {
      books: Array.isArray(state.books) ? state.books : [],
      journals: state.journals && typeof state.journals === 'object' ? state.journals : {},
    };
  } catch {
    return { books: [], journals: {} };
  }
}

function getSkillKey() {
  try {
    return sessionStorage.getItem('yueji-weread-key') || localStorage.getItem('yueji-weread-key') || '';
  } catch {
    return '';
  }
}

function highlightDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(HIGHLIGHTS_DB);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function enrichRows(book, bookmarks) {
  if (!bookmarks.length) return 0;
  const db = await highlightDb();
  try {
    const byId = new Map();
    const byText = new Map();
    for (const item of bookmarks) {
      const patch = chapterPatchFromBookmark(item);
      if (!Object.keys(patch).length) continue;
      if (item.bookmarkId) byId.set(String(item.bookmarkId), patch);
      const text = normalizeText(item.markText);
      if (text && !byText.has(text)) byText.set(text, patch);
    }
    if (!byId.size && !byText.size) return 0;
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(HIGHLIGHTS_STORE, 'readwrite');
      const store = tx.objectStore(HIGHLIGHTS_STORE);
      const index = store.index('bookKey');
      const req = index.openCursor(IDBKeyRange.only(String(book.key)));
      let changed = 0;
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return;
        const row = cursor.value;
        const sourceId = String(row.sourceId || '').trim();
        const patch = byId.get(sourceId) || byText.get(normalizeText(row.quote));
        if (patch) {
          const next = { ...row, ...patch };
          const different = Object.entries(patch).some(([key, value]) => String(row[key] ?? '') !== String(value ?? ''));
          if (different) {
            cursor.update(next);
            changed++;
          }
        }
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => resolve(changed);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

const enrichedThisSession = new Set();
async function enrichBookChapters(book) {
  if (!book?.weReadBookId || enrichedThisSession.has(String(book.key))) return false;
  const key = getSkillKey();
  if (!key) return false;
  enrichedThisSession.add(String(book.key));
  try {
    const res = await fetch(GATEWAY, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_name: '/book/bookmarklist',
        skill_version: SKILL_VERSION,
        bookId: book.weReadBookId,
      }),
    });
    if (!res.ok) return false;
    const payload = await res.json();
    const data = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
    const rows = Array.isArray(data?.updated) ? data.updated : [];
    const changed = await enrichRows(book, rows);
    return changed > 0;
  } catch (error) {
    console.warn('Yueji chapter enrichment skipped', error);
    return false;
  }
}

let renderLimit = PAGE_SIZE;
let renderVersion = 0;
let scheduled = 0;

function noteKind() {
  return document.querySelector('#noteKindSeg button.active')?.dataset.kind || 'all';
}

function pageActive() {
  return document.querySelector(".page[data-page='notes']")?.classList.contains('active');
}

function bookOf(state, key) {
  return state.books.find((book) => String(book.key) === String(key));
}

function journalRows(state) {
  return Object.values(state.journals || {}).map((j) => ({
    id: `journal-${j.date}`,
    bookKey: String(j.bookKey || ''),
    date: j.date,
    time: Date.parse(`${j.date}T00:00:00`) || 0,
    quote: j.quote || '',
    thought: j.thought || '',
    label: j.what || '',
    type: 'journal',
  }));
}

function noteMatches(note, selected, kind, query) {
  if (selected && String(note.bookKey) !== String(selected)) return false;
  if (kind === 'quotes' && !String(note.quote || '').trim()) return false;
  if (kind === 'thoughts' && !String(note.thought || note.note || '').trim()) return false;
  return !query || `${note.quote || ''} ${note.thought || note.note || ''} ${note.label || ''}`.toLowerCase().includes(query);
}

function noteCard(note) {
  const quote = String(note.quote || '').trim();
  const thought = String(note.thought || note.note || '').trim();
  const location = note.label && !/第?[零一二两三四五六七八九十百千\d]+[章节回]/.test(note.label) ? note.label : '';
  return `<article class="chapter-note-card ${quote && thought ? 'has-comment' : ''}">${location ? `<div class="chapter-note-location">${esc(location)}</div>` : ''}${quote ? `<div class="chapter-note-quote">${esc(quote)}</div>` : ''}${thought ? `<div class="chapter-note-comment">${esc(thought)}</div>` : ''}<time>${esc(formatDate(note.date))}</time></article>`;
}

function chapterBlock(group) {
  return `<details class="chapter-group" open><summary><span>${esc(group.label)}</span><small>${group.items.length} 条</small><i>⌄</i></summary><div class="chapter-items">${group.items.map(noteCard).join('')}</div></details>`;
}

function bookBlock(state, key, notes, open) {
  const book = bookOf(state, key);
  const collapsed = collapseDuplicateNotes(notes);
  const groups = groupNotesByChapter(collapsed);
  const quoteCount = collapsed.filter((n) => String(n.quote || '').trim()).length;
  const thoughtCount = collapsed.filter((n) => String(n.thought || n.note || '').trim()).length;
  const chapterCount = groups.filter((group) => group.key !== '_unknown').length;
  return `<details class="chapter-book" data-book-key="${esc(key)}" ${open ? 'open' : ''}><summary class="chapter-book-summary"><span><b>${esc(book?.title || '未关联书籍')}</b><small>${collapsed.length} 条 · ${quoteCount} 条摘录 · ${thoughtCount} 条感想${chapterCount ? ` · ${chapterCount} 个章节` : ''}</small></span><i>⌄</i></summary><div class="chapter-book-body">${groups.map(chapterBlock).join('')}</div></details>`;
}

export async function renderChapterNotes() {
  if (typeof document === 'undefined' || !pageActive()) return;
  const list = document.getElementById('notesList');
  const queryFn = window.yuejiQueryHighlights;
  if (!list || typeof queryFn !== 'function') return;
  const version = ++renderVersion;
  const selected = document.getElementById('noteBookFilter')?.value || '';
  const query = String(document.getElementById('noteSearch')?.value || '').trim().toLowerCase();
  const kind = noteKind();
  const state = loadState();
  try {
    if (window.yuejiHighlightsReady) await window.yuejiHighlightsReady;
    const result = await queryFn({ bookKey: selected, query, kind, limit: renderLimit + 1 });
    if (version !== renderVersion || !pageActive()) return;
    const items = journalRows(state).filter((row) => noteMatches(row, selected, kind, query));
    result.rows.slice(0, renderLimit).forEach((h) =>
      items.push({
        ...h,
        bookKey: String(h.bookKey || ''),
        thought: h.note || '',
        label: h.bookmark === '__YUEJI_WEREAD__' ? '' : h.bookmark || '',
      }),
    );
    items.sort((a, b) => Number(b.time || b.sortTime || 0) - Number(a.time || a.sortTime || 0));
    const groups = new Map();
    for (const item of items) {
      const key = item.bookKey || '_none';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    }
    const ordered = [...groups.entries()].sort(
      (a, b) => Number(b[1][0]?.time || b[1][0]?.sortTime || 0) - Number(a[1][0]?.time || a[1][0]?.sortTime || 0),
    );
    const more = Boolean(result.hasMore || result.rows.length > renderLimit);
    list.innerHTML = ordered.length
      ? `<div class="chapter-notes-root">${ordered.map(([key, notes]) => bookBlock(state, key, notes, Boolean(selected))).join('')}${more ? '<button class="soft-btn chapter-load-more" type="button">继续加载更多</button>' : ''}</div>`
      : '<div class="card empty-text">这里没有符合条件的内容。</div>';
    list.querySelector('.chapter-load-more')?.addEventListener('click', () => {
      renderLimit += PAGE_SIZE;
      renderChapterNotes();
    });
    list.querySelectorAll('.chapter-book').forEach((details) => {
      details.addEventListener('toggle', async () => {
        if (!details.open) return;
        const book = bookOf(state, details.dataset.bookKey);
        if (await enrichBookChapters(book)) renderChapterNotes();
      });
    });
    if (selected) {
      const selectedBook = bookOf(state, selected);
      if (await enrichBookChapters(selectedBook)) renderChapterNotes();
    }
  } catch (error) {
    if (version === renderVersion) list.innerHTML = '<div class="card empty-text">书摘数据库暂时无法读取，请稍后重试。</div>';
  }
}

function scheduleRender(reset = false) {
  if (reset) renderLimit = PAGE_SIZE;
  clearTimeout(scheduled);
  scheduled = setTimeout(() => renderChapterNotes(), 0);
}

function injectStyle() {
  if (document.querySelector('link[data-yueji-chapter-notes]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'yueji-notes-chapters.css?v=20260918-r1';
  link.dataset.yuejiChapterNotes = '1';
  document.head.append(link);
}

function bootstrap() {
  injectStyle();
  const list = document.getElementById('notesList');
  const search = document.getElementById('noteSearch');
  const filter = document.getElementById('noteBookFilter');
  const kind = document.getElementById('noteKindSeg');
  search?.addEventListener('input', () => scheduleRender(true));
  filter?.addEventListener('change', () => scheduleRender(true));
  kind?.addEventListener('click', () => scheduleRender(true));
  document.querySelector(".nav-btn[data-go='notes']")?.addEventListener('click', () => scheduleRender(true));
  if (list && 'MutationObserver' in window) {
    const observer = new MutationObserver(() => {
      if (!pageActive()) return;
      if (list.querySelector('.chapter-notes-root')) return;
      scheduleRender(false);
    });
    observer.observe(list, { childList: true });
  }
  if (pageActive()) scheduleRender(true);
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
  else bootstrap();
}
