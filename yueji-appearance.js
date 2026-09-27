import { EXPORT_MODULES, normalizeFontMode, validateCustomFontFile } from './yueji-appearance-model.js';

const SETTINGS_KEY = 'yueji-appearance-settings-v1';
const PROFILE_KEY = 'yueji-profile-v1';
const DB_NAME = 'yueji-appearance-v1';
const STORE = 'assets';
const SYSTEM_FONT = 'system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif';
let customFontUrl = '';

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
  return readJson(PROFILE_KEY, { nickname: '', signature: '' });
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function putCustomFont(file) {
  const db = await openDb();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(file, 'customFont');
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
async function getCustomFont() {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).get('customFont');
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}
function ensureFontStyle() {
  let style = document.getElementById('yuejiAppearanceStyle');
  if (style) return style;
  style = document.createElement('style');
  style.id = 'yuejiAppearanceStyle';
  style.textContent = `@font-face{font-family:YuejiHuiwen;src:url('./assets/fonts/huiwen-mincho.woff') format('woff');font-display:swap}body{font-family:var(--yueji-page-font,${SYSTEM_FONT})}.sheet,.card,button,input,select,textarea{font-family:inherit}`;
  document.head.append(style);
  return style;
}
async function applyPageFont(mode = settings().pageFont) {
  mode = normalizeFontMode(mode);
  ensureFontStyle();
  if (customFontUrl) {
    URL.revokeObjectURL(customFontUrl);
    customFontUrl = '';
  }
  let family = SYSTEM_FONT;
  if (mode === 'huiwen') {
    family = 'YuejiHuiwen,serif';
    try {
      await document.fonts.load('16px YuejiHuiwen');
    } catch {}
  } else if (mode === 'custom') {
    const file = await getCustomFont();
    if (file) {
      customFontUrl = URL.createObjectURL(file);
      const face = new FontFace('YuejiCustom', `url(${customFontUrl})`);
      await face.load();
      document.fonts.add(face);
      family = 'YuejiCustom,sans-serif';
    } else mode = 'system';
  }
  document.documentElement.style.setProperty('--yueji-page-font', family);
  const next = settings();
  next.pageFont = mode;
  writeJson(SETTINGS_KEY, next);
  return mode;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
async function exportFontCss(mode) {
  mode = normalizeFontMode(mode);
  if (mode === 'huiwen') {
    const response = await fetch('./assets/fonts/huiwen-mincho.woff');
    if (!response.ok) throw new Error('汇文明朝体加载失败');
    const url = await fileToDataUrl(await response.blob());
    return {
      family: 'YuejiExportFont',
      css: `@font-face{font-family:YuejiExportFont;src:url('${url}') format('woff')}`,
    };
  }
  if (mode === 'custom') {
    const file = await getCustomFont();
    if (!file) throw new Error('还没有上传自定义字体');
    const url = await fileToDataUrl(file);
    return {
      family: 'YuejiExportFont',
      css: `@font-face{font-family:YuejiExportFont;src:url('${url}')}`,
    };
  }
  return { family: SYSTEM_FONT, css: '' };
}
function collectCss() {
  const chunks = [];
  for (const sheet of [...document.styleSheets]) {
    try {
      for (const rule of [...sheet.cssRules]) chunks.push(rule.cssText);
    } catch {}
  }
  return chunks.join('\n');
}
async function inlineImages(root) {
  for (const image of [...root.querySelectorAll('img')]) {
    const src = image.currentSrc || image.src;
    if (!src || src.startsWith('data:') || src.startsWith('blob:')) continue;
    try {
      const response = await fetch(src, { mode: 'cors', credentials: 'omit' });
      if (!response.ok) throw new Error('image');
      image.src = await fileToDataUrl(await response.blob());
    } catch {
      image.removeAttribute('src');
      image.style.display = 'none';
    }
  }
}
function sourceForExport(key) {
  if (key === 'year-overview' || key === 'year-calendar')
    return document.getElementById('unifiedYearCard');
  if (key === 'bookshelf') return document.querySelector('.page[data-page="library"]');
  if (key === 'book-notes') return document.querySelector('.page[data-page="notes"]');
  if (key === 'stats') return document.querySelector('.page[data-page="analytics"]');
  if (key === 'month-stats') return document.getElementById('statsPanel-month');
  return null;
}
function prepareClone(source, key) {
  const clone = source.cloneNode(true);
  clone.removeAttribute('hidden');
  clone.classList.add('active');
  clone.querySelectorAll('[hidden]').forEach((el) => el.removeAttribute('hidden'));
  clone
    .querySelectorAll('button,input,select,.bottom-nav,.year-wall-actions')
    .forEach((el) => el.remove());
  if (key === 'year-calendar') clone.querySelector('.unified-summary-grid')?.remove();
  if (key === 'book-notes') {
    const selected = document.getElementById('noteBookFilter')?.value || '';
    clone.querySelectorAll('.chapter-book').forEach((details) => {
      if (selected && details.dataset.bookKey !== selected) details.remove();
      else details.open = true;
    });
    clone.querySelectorAll('.chapter-group').forEach((details) => (details.open = true));
  }
  return clone;
}
async function exportElementPng(source, key, options = {}) {
  if (!source) throw new Error('这个模块当前没有可导出的内容');
  await document.fonts.ready;
  const clone = prepareClone(source, key);
  const stage = document.createElement('div');
  stage.style.cssText =
    'position:fixed;left:-100000px;top:0;width:900px;background:var(--paper);padding:32px;z-index:-1;';
  const p = profile();
  if (options.showNickname || options.showDate) {
    const header = document.createElement('header');
    header.style.cssText =
      'margin-bottom:20px;display:flex;justify-content:space-between;gap:20px;align-items:end';
    header.innerHTML = `<div>${
      options.showNickname && p.nickname
        ? `<b style="font-size:24px">${String(p.nickname).replace(/[&<>]/g, '')}</b>`
        : ''
    }${
      options.showNickname && p.signature
        ? `<div style="margin-top:5px;opacity:.65">${String(p.signature).replace(/[&<>]/g, '')}</div>`
        : ''
    }</div>${options.showDate ? `<time>${new Date().toLocaleDateString('zh-CN')}</time>` : ''}`;
    stage.append(header);
  }
  stage.append(clone);
  document.body.append(stage);
  await inlineImages(clone);
  const { family, css: fontCss } = await exportFontCss(
    options.fontMode || settings().pageFont,
  );
  const width = Math.ceil(Math.max(720, stage.scrollWidth));
  const height = Math.ceil(Math.min(30000, Math.max(200, stage.scrollHeight)));
  const css = `${collectCss()}\n${fontCss}\n.export-root,.export-root *{font-family:${family}!important}.export-root{box-sizing:border-box;background:var(--paper);color:var(--ink)}`;
  stage.classList.add('export-root');
  stage.style.position = 'static';
  stage.style.left = 'auto';
  stage.style.top = 'auto';
  stage.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  const html = new XMLSerializer().serializeToString(stage);
  const escapedCss = css
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject width="100%" height="100%"><style>${escapedCss}</style>${html}</foreignObject></svg>`;
  const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  const image = new Image();
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = reject;
    image.src = dataUrl;
  });
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);
  const blob = await new Promise((resolve, reject) =>
    canvas.toBlob(
      (value) => (value ? resolve(value) : reject(new Error('PNG 生成失败'))),
      'image/png',
    ),
  );
  stage.remove();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `yueji-${key}-${new Date().toISOString().slice(0, 10)}.png`;
  a.click();
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
function installProfileAndFontSettings() {
  const sheet = document.getElementById('settingsSheet');
  if (!sheet || document.getElementById('unifiedAppearanceSettings')) return;
  const p = profile();
  const s = settings();
  const section = document.createElement('div');
  section.className = 'settings-section';
  section.id = 'unifiedAppearanceSettings';
  section.innerHTML = `<h4>个人与外观</h4><label class="field"><span>昵称</span><input id="yuejiNickname" value=""></label><label class="field"><span>个性签名</span><input id="yuejiSignature" value=""></label><label class="field"><span>页面字体</span><select id="yuejiPageFont"><option value="system">跟随系统</option><option value="huiwen">汇文明朝体</option><option value="custom">自定义字体</option></select></label><label class="soft-btn file-inline">上传自定义字体<input id="yuejiCustomFont" type="file" accept=".woff2,.woff,.ttf,.otf" hidden></label><div class="section-sub" id="yuejiFontStatus">自定义字体只保存在当前浏览器。</div>`;
  sheet.insertBefore(
    section,
    document.getElementById('wereadSettings') || sheet.querySelector('.settings-section'),
  );
  const nickname = section.querySelector('#yuejiNickname');
  const signature = section.querySelector('#yuejiSignature');
  const font = section.querySelector('#yuejiPageFont');
  nickname.value = p.nickname || '';
  signature.value = p.signature || '';
  font.value = normalizeFontMode(s.pageFont);
  const saveProfile = () =>
    writeJson(PROFILE_KEY, {
      nickname: nickname.value.trim(),
      signature: signature.value.trim(),
    });
  nickname.addEventListener('change', saveProfile);
  signature.addEventListener('change', saveProfile);
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
  if (!section) return;
  section.innerHTML = `<h4>导出图片</h4><div class="section-sub">所有图片导出都集中在这里；内容页不再显示导出按钮。</div><label class="field"><span>导出内容</span><select id="yuejiExportModule">${EXPORT_MODULES.map((x) => `<option value="${x.key}">${x.label}</option>`).join('')}</select></label><label class="field"><span>导出字体</span><select id="yuejiExportFont"><option value="system">系统字体</option><option value="huiwen">汇文明朝体</option><option value="custom">自定义字体</option></select></label><label class="check-line"><input id="yuejiExportNickname" type="checkbox" checked><span>显示昵称 / 个性签名</span></label><label class="check-line"><input id="yuejiExportDate" type="checkbox" checked><span>显示导出日期</span></label><button class="primary-btn" id="yuejiExportPng">生成 PNG</button><div class="section-sub" id="yuejiExportStatus"></div>`;
  section.querySelector('#yuejiExportFont').value = normalizeFontMode(settings().pageFont);
  section.querySelector('#yuejiExportPng').onclick = async () => {
    const button = section.querySelector('#yuejiExportPng');
    const status = section.querySelector('#yuejiExportStatus');
    const key = section.querySelector('#yuejiExportModule').value;
    try {
      button.disabled = true;
      status.textContent = '正在生成图片……';
      await exportElementPng(sourceForExport(key), key, {
        fontMode: section.querySelector('#yuejiExportFont').value,
        showNickname: section.querySelector('#yuejiExportNickname').checked,
        showDate: section.querySelector('#yuejiExportDate').checked,
      });
      status.textContent = 'PNG 已生成。';
    } catch (error) {
      status.textContent = `导出失败：${error?.message || error}`;
    } finally {
      button.disabled = false;
    }
  };
}
async function install() {
  await applyPageFont();
  installProfileAndFontSettings();
  installExportSettings();
  installChapterCollapse();
}
if (document.readyState === 'complete') setTimeout(install, 140);
else window.addEventListener('load', () => setTimeout(install, 140), { once: true });
