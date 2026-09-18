const WE_READ_MARKER = '__YUEJI_WEREAD__';
let refreshQueued = false;
const watchedRoots = new WeakSet();

function replaceText(root, from, to) {
  if (!root || !from) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const next = String(node.nodeValue || '').replaceAll(from, to);
    if (next !== node.nodeValue) node.nodeValue = next;
  }
}

function sanitizeSettings(root) {
  if (!root) return;
  replaceText(root, '重新读取逐书进度/圆圈数据', '重新读取逐书进度');
  replaceText(root, '请先点击“更新基础数据”', '请先点击“一键完整同步”');
}

function sanitizeNotes(root) {
  if (root) replaceText(root, WE_READ_MARKER, '微信读书');
}

export function sanitizeReleaseUi(root = document) {
  const settings = root.querySelector?.('#wereadSettings') || document.getElementById('wereadSettings');
  const notes = root.querySelector?.('#notesList') || document.getElementById('notesList');
  sanitizeSettings(settings);
  sanitizeNotes(notes);
}

function watchRoot(root, sanitizer) {
  if (!root || watchedRoots.has(root)) return false;
  watchedRoots.add(root);
  sanitizer(root);
  if ('MutationObserver' in window) {
    new MutationObserver(() => sanitizer(root)).observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }
  return true;
}

function attachTargetedObservers() {
  watchRoot(document.getElementById('wereadSettings'), sanitizeSettings);
  watchRoot(document.getElementById('notesList'), sanitizeNotes);
}

function activePageName() {
  return document.querySelector('.page.active')?.dataset.page || '';
}

export function refreshActivePage() {
  if (refreshQueued) return;
  refreshQueued = true;
  requestAnimationFrame(() => {
    refreshQueued = false;
    const pageName = activePageName();
    try {
      window.renderBookOptions?.();
    } catch {}
    try {
      if (pageName === 'notes') window.yuejiRenderChapterNotes?.();
      else {
        if (pageName === 'today') window.renderToday?.();
        if (pageName && typeof window.switchPage === 'function') window.switchPage(pageName);
      }
    } catch {}
    sanitizeReleaseUi();
  });
}

function bootstrap() {
  sanitizeReleaseUi();
  attachTargetedObservers();
  window.addEventListener('yueji:data-changed', refreshActivePage);
  if ('MutationObserver' in window && document.body && !document.getElementById('wereadSettings')) {
    const discovery = new MutationObserver(() => {
      attachTargetedObservers();
      if (document.getElementById('wereadSettings')) discovery.disconnect();
    });
    discovery.observe(document.body, { childList: true, subtree: true });
  }
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
  else bootstrap();
}
