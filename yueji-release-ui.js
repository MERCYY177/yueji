const WE_READ_MARKER = '__YUEJI_WEREAD__';
let refreshQueued = false;

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

export function sanitizeReleaseUi(root = document) {
  const settings = root.querySelector?.('#wereadSettings') || document.getElementById('wereadSettings');
  if (settings) {
    replaceText(settings, '重新读取逐书进度/圆圈数据', '重新读取逐书进度');
    replaceText(settings, '请先点击“更新基础数据”', '请先点击“一键完整同步”');
  }
  const notes = root.querySelector?.('#notesList') || document.getElementById('notesList');
  if (notes) replaceText(notes, WE_READ_MARKER, '微信读书');
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
      if (pageName === 'today') window.renderToday?.();
      if (pageName && typeof window.switchPage === 'function') window.switchPage(pageName);
    } catch {}
    try {
      if (pageName === 'notes') window.yuejiRenderChapterNotes?.();
    } catch {}
    sanitizeReleaseUi();
  });
}

function bootstrap() {
  sanitizeReleaseUi();
  window.addEventListener('yueji:data-changed', refreshActivePage);
  if ('MutationObserver' in window && document.body) {
    new MutationObserver((records) => {
      if (
        records.some((record) =>
          [...record.addedNodes].some(
            (node) =>
              node.nodeType === Node.ELEMENT_NODE &&
              (node.matches?.('#wereadSettings,#notesList') ||
                node.querySelector?.('#wereadSettings,#notesList')),
          ),
        )
      )
        sanitizeReleaseUi();
      else {
        const settings = document.getElementById('wereadSettings');
        const notes = document.getElementById('notesList');
        if (settings || notes) sanitizeReleaseUi();
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  }
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
  else bootstrap();
}
