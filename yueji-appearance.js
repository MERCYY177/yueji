import { EXPORT_MODULES, normalizeFontMode, validateCustomFontFile } from './yueji-appearance-model.js';

const SETTINGS_KEY = 'yueji-appearance-settings-v1';
const PROFILE_KEY = 'yueji-profile-v1';
const FONT_DB = 'yueji-appearance-v1';
const FONT_STORE = 'fonts';
const FONT_ID = 'custom-page-font';
const SYSTEM_FONT =
  'system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif';

function readJson(key, fallback) {
  try {
    return { ...fallback, ...(JSON.parse(localStorage.getItem(key) || 'null') || {}) };
  } catch {
    return { ...fallback };
  }
}
function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}
function settings() {
  return readJson(SETTINGS_KEY, { pageFont: 'system' });
}
function profile() {
  return readJson(PROFILE_KEY, { credit: '', nickname: '', signature: '' });
}
function exportCredit() {
  const p = profile();
  return String(p.credit || p.nickname || '').trim();
}
function openFontDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(FONT_DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(FONT_STORE)) req.result.createObjectStore(FONT_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function putCustomFont(file) {
  const db = await openFontDb();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(FONT_STORE, 'readwrite');
      tx.objectStore(FONT_STORE).put(file, FONT_ID);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
async function getCustomFont() {
  const db = await openFontDb();
  try {
    return await new Promise((resolve, reject) => {
      const req = db.transaction(FONT_STORE).objectStore(FONT_STORE).get(FONT_ID);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}
function ensureAppearanceStyle() {
  if (document.getElementById('yuejiAppearanceStyle')) return;
  const style = document.createElement('style');
  style.id = 'yuejiAppearanceStyle';
  style.textContent = `
    @font-face{font-family:YuejiHuiwen;src:url('./assets/fonts/huiwen-mincho.woff') format('woff');font-display:swap}
    :root{--yueji-page-font:${SYSTEM_FONT}}
    body,button,input,select,textarea{font-family:var(--yueji-page-font)}
  `;
  document.head.appendChild(style);
}
let customFontUrl = '';
async function applyPageFont(mode = settings().pageFont) {
  ensureAppearanceStyle();
  mode = normalizeFontMode(mode);
  if (customFontUrl) {
    URL.revokeObjectURL(customFontUrl);
    customFontUrl = '';
  }
  let family = SYSTEM_FONT;
  if (mode === 'huiwen') family = 'YuejiHuiwen,serif';
  if (mode === 'custom') {
    try {
      const blob = await getCustomFont();
      if (!blob) mode = 'system';
      else {
        customFontUrl = URL.createObjectURL(blob);
        const face = new FontFace('YuejiCustom', `url(${customFontUrl})`);
        await face.load();
        document.fonts.add(face);
        family = 'YuejiCustom,' + SYSTEM_FONT;
      }
    } catch {
      mode = 'system';
    }
  }
  document.documentElement.style.setProperty('--yueji-page-font', family);
  const next = settings();
  next.pageFont = mode;
  writeJson(SETTINGS_KEY, next);
  return mode;
}
function dataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
async function inlineImages(root) {
  for (const img of root.querySelectorAll('img')) {
    if (!img.src || img.src.startsWith('data:')) continue;
    try {
      const res = await fetch(img.src, { mode: 'cors', credentials: 'omit' });
      if (!res.ok) throw new Error('image');
      img.src = await dataUrl(await res.blob());
    } catch {
      img.removeAttribute('src');
      img.style.visibility = 'hidden';
    }
  }
}
async function fontCssForExport(mode) {
  mode = normalizeFontMode(mode);
  if (mode === 'huiwen') {
    try {
      const res = await fetch('./assets/fonts/huiwen-mincho.woff');
      if (res.ok) {
        const src = await dataUrl(await res.blob());
        return {
          family: 'YuejiExportFont,serif',
          css: `@font-face{font-family:YuejiExportFont;src:url('${src}') format('woff')}`,
        };
      }
    } catch {}
  }
  if (mode === 'custom') {
    const blob = await getCustomFont();
    if (blob) {
      const src = await dataUrl(blob);
      return {
        family: 'YuejiExportFont,' + SYSTEM_FONT,
        css: `@font-face{font-family:YuejiExportFont;src:url('${src}')}`,
      };
    }
  }
  return { family: SYSTEM_FONT, css: '' };
}
function sourceForExport(key) {
  const map = {
    'year-overview': '#unifiedYearCard',
    'year-calendar': '#unifiedYearGrid',
    bookshelf: '.page[data-page="library"]',
    'book-notes': '#notesList',
    statistics: '.page[data-page="analytics"]',
    'month-stats': '#statsPanel-month',
  };
  return document.querySelector(map[key]);
}
function exportTitle(key) {
  return EXPORT_MODULES.find((x) => x.key === key)?.label || '阅迹';
}
function exportMetaHtml(credit, showDate) {
  const bits = [];
  if (credit) bits.push(`<b>${escapeHtml(credit)}</b>`);
  if (showDate) bits.push(`<span>${new Date().toLocaleDateString('zh-CN')}</span>`);
  return bits.length ? `<div class="yueji-export-meta">${bits.join(' · ')}</div>` : '';
}
function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (m) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[m],
  );
}
function clonedExportTarget(source, key) {
  if (!source) throw new Error('当前没有可导出的内容');
  const clone = source.cloneNode(true);
  clone.querySelectorAll('button,.round-btn,.soft-btn,.primary-btn,input,select').forEach((x) => x.remove());
  if (key === 'book-notes') clone.querySelectorAll('details').forEach((details) => (details.open = true));
  return clone;
}
async function exportElementPng(source, key, options) {
  const clone = clonedExportTarget(source, key);
  await inlineImages(clone);
  const font = await fontCssForExport(options.fontMode);
  const width = Math.max(720, Math.ceil(source.getBoundingClientRect().width || source.scrollWidth || 900));
  const estimatedHeight = Math.max(900, Math.ceil(source.scrollHeight || source.getBoundingClientRect().height || 900));
  if (estimatedHeight > 24000) throw new Error('内容过长，请缩小导出范围后重试');
  const height = Math.min(24000, estimatedHeight + 180);
  const paper = getComputedStyle(document.documentElement).getPropertyValue('--paper').trim() || '#f5f6f8';
  const ink = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim() || '#202124';
  const styleText = [...document.styleSheets]
    .flatMap((sheet) => {
      try {
        return [...sheet.cssRules].map((rule) => rule.cssText);
      } catch {
        return [];
      }
    })
    .join('\n');
  const body = `<div class="yueji-export-root"><h1>${escapeHtml(exportTitle(key))}</h1>${exportMetaHtml(options.credit, options.showDate)}${clone.outerHTML}</div>`;
  const css = `${font.css}${styleText}
    html,body{margin:0;background:${paper};color:${ink};font-family:${font.family}}
    .yueji-export-root{box-sizing:border-box;width:${width}px;padding:56px;background:${paper};min-height:${height}px}
    .yueji-export-root>h1{margin:0 0 10px;font-size:34px}.yueji-export-meta{margin-bottom:28px;color:#73777d;font-size:14px}
    .yueji-export-root .sheet,.yueji-export-root .overlay,.yueji-export-root .bottom-nav{display:none!important}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml"><style>${css.replace(/<\/style/gi, '<\\/style')}</style>${body}</div></foreignObject></svg>`;
  const encoded = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  const img = new Image();
  img.decoding = 'async';
  img.src = encoded;
  await img.decode();
  const scale = Math.min(2, 12000 / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.drawImage(img, 0, 0, width, height);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('浏览器没有生成 PNG');
  const a = document.createElement('a');
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = `yueji-${key}-${new Date().toISOString().slice(0, 10)}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function collapseChapterBodies() {
  document
    .querySelectorAll('#notesList .chapter-group[open]')
    .forEach((details) => details.removeAttribute('open'));
}
function installChapterCollapse() {
  const list = document.getElementById('notesList');
  if (!list) return;
  collapseChapterBodies();
  new MutationObserver(collapseChapterBodies).observe(list, { childList: true, subtree: true });
}
function installAppearanceSettings() {
  const sheet = document.getElementById('settingsSheet');
  if (!sheet || document.getElementById('unifiedAppearanceSettings')) return;
  const s = settings();
  const section = document.createElement('div');
  section.className = 'settings-section';
  section.id = 'unifiedAppearanceSettings';
  section.innerHTML = `<h4>外观</h4><label class="field"><span>页面字体</span><select id="yuejiPageFont"><option value="system">跟随系统</option><option value="huiwen">汇文明朝体</option><option value="custom">自定义字体</option></select></label><label class="soft-btn file-inline">上传自定义字体<input id="yuejiCustomFont" type="file" accept=".woff2,.woff,.ttf,.otf" hidden></label><div class="section-sub" id="yuejiFontStatus">自定义字体只保存在当前浏览器。</div>`;
  sheet.insertBefore(
    section,
    document.getElementById('wereadSettings') || sheet.querySelector('.settings-section'),
  );
  const font = section.querySelector('#yuejiPageFont');
  font.value = normalizeFontMode(s.pageFont);
  font.addEventListener('change', async () => {
    const applied = await applyPageFont(font.value);
    font.value = applied;
  });
  section.querySelector('#yuejiCustomFont').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const valid = validateCustomFontFile(file);
    if (!valid.ok) {
      section.querySelector('#yuejiFontStatus').textContent = valid.reason;
      event.target.value = '';
      return;
    }
    await putCustomFont(file);
    section.querySelector('#yuejiFontStatus').textContent =
      `已保存 ${file.name}，只在当前浏览器使用。`;
    font.value = 'custom';
    await applyPageFont('custom');
    event.target.value = '';
  });
}
function installExportSettings() {
  const section = document.getElementById('unifiedExportSettings');
  if (!section) return false;
  if (document.getElementById('yuejiExportModule')) return true;
  section.innerHTML = `<h4>导出图片</h4><div class="section-sub">所有图片导出都集中在这里；内容页不再显示导出按钮。</div><label class="field"><span>导出内容</span><select id="yuejiExportModule">${EXPORT_MODULES.map((x) => `<option value="${x.key}">${x.label}</option>`).join('')}</select></label><label class="field"><span>导出署名（可选）</span><input id="yuejiExportCredit" placeholder="例如：小树"></label><label class="field"><span>导出字体</span><select id="yuejiExportFont"><option value="system">系统字体</option><option value="huiwen">汇文明朝体</option><option value="custom">自定义字体</option></select></label><label class="check-line"><input id="yuejiExportDate" type="checkbox" checked><span>显示导出日期</span></label><button class="primary-btn" id="yuejiExportPng">生成 PNG</button><div class="section-sub" id="yuejiExportStatus"></div>`;
  section.querySelector('#yuejiExportFont').value = normalizeFontMode(settings().pageFont);
  const credit = section.querySelector('#yuejiExportCredit');
  credit.value = exportCredit();
  credit.addEventListener('change', () => writeJson(PROFILE_KEY, { credit: credit.value.trim() }));
  section.querySelector('#yuejiExportPng').onclick = async () => {
    const button = section.querySelector('#yuejiExportPng');
    const status = section.querySelector('#yuejiExportStatus');
    const key = section.querySelector('#yuejiExportModule').value;
    try {
      button.disabled = true;
      status.textContent = '正在生成图片……';
      const exportCreditValue = credit.value.trim();
      writeJson(PROFILE_KEY, { credit: exportCreditValue });
      await exportElementPng(sourceForExport(key), key, {
        fontMode: section.querySelector('#yuejiExportFont').value,
        credit: exportCreditValue,
        showDate: section.querySelector('#yuejiExportDate').checked,
      });
      status.textContent = 'PNG 已生成。';
    } catch (error) {
      status.textContent = `导出失败：${error?.message || error}`;
    } finally {
      button.disabled = false;
    }
  };
  return true;
}
function installExportSettingsWhenReady() {
  if (installExportSettings()) return;
  const observer = new MutationObserver(() => {
    if (installExportSettings()) observer.disconnect();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  setTimeout(() => observer.disconnect(), 15000);
}
async function install() {
  await applyPageFont();
  installAppearanceSettings();
  installExportSettingsWhenReady();
  installChapterCollapse();
}
if (document.readyState === 'complete') setTimeout(install, 140);
else window.addEventListener('load', () => setTimeout(install, 140), { once: true });