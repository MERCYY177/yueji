const STORAGE = 'yueji-archive-v1';
const PAGE_SIZE = 80;
const WE_READ_MARKER = '__YUEJI_WEREAD__';
const GATEWAY_PATH = '/.netlify/functions/weread-gateway';

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
  const idx = Number(note.chapterIdx ?? note.chapterIndex);
  if (title) {
    const inferred = inferredChapterNumber({ chapterTitle: title });
    return {
      key: note.chapterUid
        ? `uid:${note.chapterUid}`
        : Number.isFinite(idx) && idx >= 0
          ? `idx:${idx}`
          : `title:${title}`,
      label: title,
      order:
        Number.isFinite(idx) && idx >= 0
          ? idx + 1
          : Number.isFinite(inferred)
            ? inferred
            : Number.MAX_SAFE_INTEGER - 2,
    };
  }
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

function rangeIdentity(note = {}) {
  const value = note.range ?? note.chapterRange ?? note.position;
  if (value === undefined || value === null || value === '') return '';
  const raw = Array.isArray(value) ? value.join('-') : String(value);
  const numbers = raw.match(/\d+/g);
  return numbers?.length ? numbers.join('-') : raw.trim();
}

export function groupNotesByChapter(items = []) {
  const groups = new Map();
  for (const item of items) {
    const meta = chapterMeta(item);
    if (!groups.has(meta.key)) groups.set(meta.key, { ...meta, items: [] });
    groups.get(meta.key).items.push(item);
  }
  const out = [...groups.values()].sort(
    (a, b) => a.order - b.order || a.label.localeCompare(b.label, 'zh-CN'),
  );
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

export function mergeBookmarksWithChapters(bookmarks = [], chapters = []) {
  const chapterByUid = new Map(
    chapters
      .filter((chapter) => chapter?.chapterUid !== undefined && chapter?.chapterUid !== null)
      .map((chapter) => [String(chapter.chapterUid), chapter]),
  );
  return bookmarks.map((bookmark) => {
    const chapter = chapterByUid.get(String(bookmark?.chapterUid ?? ''));
    if (!chapter) return { ...bookmark };
    return {
      ...bookmark,
      ...(chapter.chapterIdx !== undefined ? { chapterIdx: chapter.chapterIdx } : {}),
      ...(chapter.title || chapter.chapterTitle || chapter.chapterName
        ? { chapterTitle: String(chapter.title || chapter.chapterTitle || chapter.chapterName) }
        : {}),
    };
  });
}

function mergeDuplicateInto(keep, item) {
  if (!keep.thought && item.thought) keep.thought = item.thought;
  if (!keep.note && item.note) keep.note = item.note;
  const keepMeta = chapterMeta(keep);
  const itemMeta = chapterMeta(item);
  const shouldInheritChapter = keepMeta.key === '_unknown' && itemMeta.key !== '_unknown';
  for (const field of ['chapterUid', 'chapterIdx', 'chapterTitle', 'chapterName', 'range', 'label']) {
    if (
      (shouldInheritChapter || keep[field] === undefined || keep[field] === '') &&
      item[field] !== undefined &&
      item[field] !== ''
    )
      keep[field] = item[field];
  }
  keep.time = Math.min(Number(keep.time || Infinity), Number(item.time || Infinity));
}

export function collapseDuplicateNotes(items = []) {
  const out = [];
  const byQuote = new Map();
  for (const raw of items) {
    const item = { ...raw };
    const quoteKey = normalizeText(item.quote);
    if (!quoteKey) {
      out.push(item);
      continue;
    }
    const itemMeta = chapterMeta(item);
    const itemRange = rangeIdentity(item);
    const candidates = byQuote.get(quoteKey) || [];
    const keep = candidates.find((existing) => {
      const existingMeta = chapterMeta(existing);
      const existingRange = rangeIdentity(existing);
      if (existingRange && itemRange && existingRange !== itemRange) return false;
      return (
        existingMeta.key === itemMeta.key ||
        existingMeta.key === '_unknown' ||
        itemMeta.key === '_unknown'
      );
    });
    if (!keep) {
      out.push(item);
      candidates.push(item);
      byQuote.set(quoteKey, candidates);
      continue;
    }
    mergeDuplicateInto(keep, item);
  }
  return out;
}

const bookmarkChapterPatches = new Map();
const reviewChapterPatches = new Map();

function payloadData(payload) {
  return payload?.data && typeof payload.data === 'object' ? payload.data : payload;
}

export function captureBookmarkChapterMetadata(payload = {}) {
  const data = payloadData(payload) || {};
  const rows = mergeBookmarksWithChapters(
    Array.isArray(data.updated) ? data.updated : [],
    Array.isArray(data.chapters) ? data.chapters : [],
  );
  for (const row of rows) {
    if (!row?.bookmarkId) continue;
    const patch = chapterPatchFromBookmark(row);
    if (Object.keys(patch).length) bookmarkChapterPatches.set(String(row.bookmarkId), patch);
  }
  return bookmarkChapterPatches.size;
}

export function captureReviewChapterMetadata(payload = {}) {
  const data = payloadData(payload) || {};
  for (const item of Array.isArray(data.reviews) ? data.reviews : []) {
    const review = item?.review || item;
    if (!review?.reviewId) continue;
    const patch = chapterPatchFromBookmark(review);
    if (Object.keys(patch).length) reviewChapterPatches.set(String(review.reviewId), patch);
  }
  return reviewChapterPatches.size;
}

export function decorateWeReadRows(rows = []) {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    if (row?.source !== 'weread' && row?.bookmark !== WE_READ_MARKER) return row;
    const sourceId = String(row?.sourceId || '');
    if (!sourceId) return row;
    const patch = String(row.id || '').startsWith('wr-review:')
      ? reviewChapterPatches.get(sourceId)
      : bookmarkChapterPatches.get(sourceId);
    return patch ? { ...row, ...patch } : row;
  });
}

function installWeReadChapterCapture() {
  if (typeof window === 'undefined' || window.__yuejiChapterCaptureInstalled) return;
  window.__yuejiChapterCaptureInstalled = true;
  const nativeFetch = window.fetch?.bind(window);
  if (typeof nativeFetch === 'function') {
    window.fetch = async (input, init) => {
      const response = await nativeFetch(input, init);
      try {
        const url = typeof input === 'string' ? input : String(input?.url || '');
        if (url.includes(GATEWAY_PATH) && typeof init?.body === 'string') {
          const request = JSON.parse(init.body);
          if (request?.api_name === '/book/bookmarklist')
            captureBookmarkChapterMetadata(await response.clone().json());
          else if (request?.api_name === '/review/list/mine')
            captureReviewChapterMetadata(await response.clone().json());
        }
      } catch (error) {
        console.warn('Yueji chapter metadata capture skipped', error);
      }
      return response;
    };
  }

  const wrapWriter = () => {
    const original = window.yuejiPutHighlights;
    if (typeof original !== 'function' || original.__yuejiChapterWrapped) return false;
    const wrapped = (rows) => original(decorateWeReadRows(rows));
    wrapped.__yuejiChapterWrapped = true;
    wrapped.__yuejiOriginal = original;
    window.yuejiPutHighlights = wrapped;
    return true;
  };
  if (!wrapWriter()) {
    const timer = setInterval(() => {
      if (wrapWriter()) clearInterval(timer);
    }, 50);
    setTimeout(() => clearInterval(timer), 10000);
  }
}

function esc(value = '') {
  return String(value).replace(/[&<>"']/g, (m) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[m],
  );
}

function formatDate(key) {
  const m = String(key || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  return m ? `${m[1]}年${Number(m[2])}月${Number(m[3])}日` : String(key || '');
}

function loadJournals() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE) || '{}');
    return saved.journals && typeof saved.journals === 'object' ? saved.journals : {};
  } catch {
    return {};
  }
}

function bookTitle(key) {
  const select = document.getElementById('noteBookFilter');
  const option = [...(select?.options || [])].find((item) => String(item.value) === String(key));
  return String(option?.textContent || '').trim() || '未关联书籍';
}

let renderLimit = PAGE_SIZE;
let renderVersion = 0;

function noteKind() {
  return document.querySelector('#noteKindSeg button.active')?.dataset.kind || 'all';
}

function pageActive() {
  return document.querySelector(".page[data-page='notes']")?.classList.contains('active');
}

function journalRows() {
  return Object.values(loadJournals()).map((j) => ({
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
  return (
    !query ||
    `${note.quote || ''} ${note.thought || note.note || ''} ${note.label || ''}`
      .toLowerCase()
      .includes(query)
  );
}

function noteCard(note) {
  const quote = String(note.quote || '').trim();
  const thought = String(note.thought || note.note || '').trim();
  const location =
    note.label && !/第?[零一二两三四五六七八九十百千\d]+[章节回]/.test(note.label)
      ? note.label
      : '';
  return `<article class="chapter-note-card ${quote && thought ? 'has-comment' : ''}">${location ? `<div class="chapter-note-location">${esc(location)}</div>` : ''}${quote ? `<div class="chapter-note-quote">${esc(quote)}</div>` : ''}${thought ? `<div class="chapter-note-comment">${esc(thought)}</div>` : ''}<time>${esc(formatDate(note.date))}</time></article>`;
}

function chapterBlock(group) {
  return `<details class="chapter-group" open><summary><span>${esc(group.label)}</span><small>${group.items.length} 条</small><i>⌄</i></summary><div class="chapter-items">${group.items.map(noteCard).join('')}</div></details>`;
}

function bookBlock(key, notes, open) {
  const collapsed = collapseDuplicateNotes(notes);
  const groups = groupNotesByChapter(collapsed);
  const quoteCount = collapsed.filter((n) => String(n.quote || '').trim()).length;
  const thoughtCount = collapsed.filter((n) => String(n.thought || n.note || '').trim()).length;
  const chapterCount = groups.filter((group) => group.key !== '_unknown').length;
  return `<details class="chapter-book" data-book-key="${esc(key)}" ${open ? 'open' : ''}><summary class="chapter-book-summary"><span><b>${esc(bookTitle(key))}</b><small>${collapsed.length} 条 · ${quoteCount} 条摘录 · ${thoughtCount} 条感想${chapterCount ? ` · ${chapterCount} 个章节` : ''}</small></span><i>⌄</i></summary><div class="chapter-book-body">${groups.map(chapterBlock).join('')}</div></details>`;
}

export async function renderChapterNotes(options = {}) {
  if (options?.reset) renderLimit = PAGE_SIZE;
  if (typeof document === 'undefined' || !pageActive()) return;
  const list = document.getElementById('notesList');
  const queryFn = window.yuejiQueryHighlights;
  if (!list || typeof queryFn !== 'function') return;
  const version = ++renderVersion;
  const selected = document.getElementById('noteBookFilter')?.value || '';
  const query = String(document.getElementById('noteSearch')?.value || '')
    .trim()
    .toLowerCase();
  const kind = noteKind();
  try {
    if (window.yuejiHighlightsReady) await window.yuejiHighlightsReady;
    const result = await queryFn({ bookKey: selected, query, kind, limit: renderLimit + 1 });
    if (version !== renderVersion || !pageActive()) return;
    const items = journalRows().filter((row) => noteMatches(row, selected, kind, query));
    result.rows.slice(0, renderLimit).forEach((h) =>
      items.push({
        ...h,
        bookKey: String(h.bookKey || ''),
        thought: h.note || '',
        label: h.bookmark === WE_READ_MARKER ? '' : h.bookmark || '',
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
      (a, b) =>
        Number(b[1][0]?.time || b[1][0]?.sortTime || 0) -
        Number(a[1][0]?.time || a[1][0]?.sortTime || 0),
    );
    const more = Boolean(result.hasMore || result.rows.length > renderLimit);
    list.innerHTML = ordered.length
      ? `<div class="chapter-notes-root">${ordered
          .map(([key, notes]) => bookBlock(key, notes, Boolean(selected)))
          .join('')}${more ? '<button class="soft-btn chapter-load-more" type="button">继续加载更多</button>' : ''}</div>`
      : '<div class="card empty-text">这里没有符合条件的内容。</div>';
    list.querySelector('.chapter-load-more')?.addEventListener('click', () => {
      renderLimit += PAGE_SIZE;
      renderChapterNotes();
    });
  } catch (error) {
    if (version === renderVersion)
      list.innerHTML =
        '<div class="card empty-text">书摘数据库暂时无法读取，请稍后重试。</div>';
  }
}

function injectStyle() {
  if (document.querySelector('link[data-yueji-chapter-notes]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'yueji-notes-chapters.css?v=20260918-r2';
  link.dataset.yuejiChapterNotes = '1';
  document.head.append(link);
}

function bootstrap() {
  injectStyle();
  if (pageActive()) renderChapterNotes({ reset: true });
}

if (typeof window !== 'undefined') {
  installWeReadChapterCapture();
  window.yuejiRenderChapterNotes = renderChapterNotes;
}
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
  else bootstrap();
}
