import assert from 'node:assert/strict';
import { stat } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const chrome = process.env.CHROME_BIN;
if (!chrome) throw new Error('CHROME_BIN is required');

const browser = await chromium.launch({
  executablePath: chrome,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

async function runtimeDiagnostics(page, label) {
  const result = await page.evaluate(() => ({
    readyState: document.readyState,
    unifiedYearCard: Boolean(document.getElementById('unifiedYearCard')),
    unifiedExportSettings: Boolean(document.getElementById('unifiedExportSettings')),
    exportModule: Boolean(document.getElementById('yuejiExportModule')),
    appearanceSettings: Boolean(document.getElementById('unifiedAppearanceSettings')),
    appearanceStyle: Boolean(document.getElementById('yuejiAppearanceStyle')),
    exportBookPicker: Boolean(document.getElementById('yuejiExportBook')),
    settingsSheet: Boolean(document.getElementById('settingsSheet')),
    settingsSections: [...document.querySelectorAll('#settingsSheet .settings-section')].map((x) => x.id || x.querySelector('h4')?.textContent || ''),
    yuejiVersion: window.Yueji?.version || '',
    yuejiErrors: window.Yueji?.errors?.history || [],
  }));
  console.log(`[browser diagnostics:${label}] ${JSON.stringify(result)}`);
  return result;
}

try {
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error') console.error('[browser console]', message.text());
  });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error?.stack || error)));

  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'load' });
  await page.waitForSelector('#unifiedYearCard', { timeout: 15000 });
  await page.waitForTimeout(600);
  const initialDiagnostics = await runtimeDiagnostics(page, 'initial');
  if (!initialDiagnostics.exportModule)
    throw new Error(`Export module did not mount: ${JSON.stringify(initialDiagnostics)}`);

  const navLabels = await page.locator('.bottom-nav .nav-btn').allTextContents();
  assert.equal(navLabels.length, 4, `expected four primary tabs, got ${navLabels.length}`);
  assert.deepEqual(
    navLabels.map((text) => text.replace(/[^\u4e00-\u9fff]/g, '')),
    ['首页', '书架', '笔记', '统计'],
  );

  const statLabels = await page.locator('#statsTabs [data-stats-tab]').allTextContents();
  assert.deepEqual(statLabels.map((x) => x.trim()), ['本月', '今年', '全部']);

  const exportLabels = await page.locator('#yuejiExportModule option').allTextContents();
  assert.deepEqual(exportLabels.map((x) => x.trim()), [
    '年度概览',
    '全年日历',
    '书架',
    '某一本书的笔记',
    '阅读统计',
    '当前月份统计',
  ]);

  // Legacy releases could persist the Skill Key. A reload must migrate it to
  // sessionStorage and clear both legacy localStorage entries before sync boot.
  await page.evaluate(() => {
    localStorage.setItem('yueji-weread-key', 'browser-smoke-secret');
    localStorage.setItem('yueji-weread-key-persist-v1', '1');
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#unifiedYearCard', { timeout: 15000 });
  const keyState = await page.evaluate(() => ({
    local: localStorage.getItem('yueji-weread-key'),
    persist: localStorage.getItem('yueji-weread-key-persist-v1'),
    session: sessionStorage.getItem('yueji-weread-key'),
  }));
  assert.equal(keyState.local, null);
  assert.equal(keyState.persist, null);
  assert.equal(keyState.session, 'browser-smoke-secret');

  await page.click('#settingsBtn');
  await page.waitForSelector('#loadDemo', { state: 'visible', timeout: 10000 });
  await page.waitForSelector('#yuejiExportModule', { state: 'visible', timeout: 10000 });

  // The old "remember Key" control remains only for compatibility in the
  // extension markup; unified UI must force it hidden and unchecked even while
  // the rest of the settings sheet is visible.
  await page.waitForSelector('#wereadRememberKey', { state: 'attached', timeout: 15000 });
  assert.equal(await page.locator('#wereadRememberKey').isChecked(), false);
  assert.equal(await page.locator('#wereadRememberKey').locator('xpath=..').isVisible(), false);

  // Populate deterministic local data so the Settings-based single-book export
  // picker can be tested without any real WeRead credentials.
  page.once('dialog', (dialog) => dialog.accept());
  await page.click('#loadDemo');
  await page.waitForFunction(() => document.querySelectorAll('#noteBookFilter option').length > 1);
  await page.selectOption('#yuejiExportModule', 'book-notes');
  await page.waitForFunction(() => {
    const field = document.getElementById('yuejiExportBookField');
    const picker = document.getElementById('yuejiExportBook');
    return field && !field.hidden && picker && picker.options.length > 0 && picker.value;
  });

  // Exercise the actual SVG -> Canvas -> PNG path in Chromium. This catches the
  // tainted-canvas class of failures that static tests cannot see.
  await page.selectOption('#yuejiExportModule', 'year-overview');
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 20000 }),
    page.click('#yuejiExportPng'),
  ]);
  const path = await download.path();
  assert.ok(path, 'PNG download did not produce a file path');
  const info = await stat(path);
  assert.ok(info.size > 500, `PNG download is unexpectedly small: ${info.size} bytes`);
  assert.match(download.suggestedFilename(), /^yueji-year-overview-\d{4}-\d{2}-\d{2}\.png$/);

  assert.deepEqual(pageErrors, [], `browser page errors:\n${pageErrors.join('\n')}`);
  console.log('Browser smoke OK: four tabs, stats tabs, Skill Key migration, book picker, PNG export');
} finally {
  await browser.close();
}
