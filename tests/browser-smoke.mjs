import assert from 'node:assert/strict';
import { stat } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const chrome = process.env.CHROME_BIN;
if (!chrome) throw new Error('CHROME_BIN is required');

const GATEWAY = 'https://yueji-weread-gateway.xiaoshu10088.workers.dev/api/weread';
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
    guideVisible: document.getElementById('yuejiGuide')?.classList.contains('show') || false,
    settingsSections: [...document.querySelectorAll('#settingsSheet .settings-section')].map(
      (x) => x.id || x.querySelector('h4')?.textContent || '',
    ),
    yuejiVersion: window.Yueji?.version || '',
    wereadGateway: window.Yueji?.wereadGateway || '',
    yuejiErrors: window.Yueji?.errors?.history || [],
  }));
  console.log(`[browser diagnostics:${label}] ${JSON.stringify(result)}`);
  return result;
}

function fakeGatewayPayload(apiName, body = {}) {
  if (apiName === '/readdata/detail') {
    return {
      data: {
        totalReadTime: body.mode === 'overall' ? 7200 : 3600,
        readDays: body.mode === 'overall' ? 20 : 10,
        dailyReadTimes: body.mode === 'annually' ? { '2026-09-27': 900 } : undefined,
        readTimes: {},
      },
    };
  }
  if (apiName === '/shelf/sync') return { data: { books: [] } };
  if (apiName === '/user/notebooks') return { data: { books: [], hasMore: false } };
  if (apiName === '/book/bookmarklist') return { data: { updated: [], chapters: [], removed: [] } };
  if (apiName === '/review/list/mine')
    return { data: { reviews: [], hasMore: false, removed: [], synckey: '' } };
  if (apiName === '/book/getprogress') return { data: { book: {}, bookId: body.bookId } };
  return { data: {} };
}

async function verifyCalendarPlacement(page) {
  assert.equal(
    await page.locator('.page[data-page="today"] #unifiedYearCard').count(),
    0,
    'home page must not contain the annual calendar card',
  );
  await page.click('.bottom-nav [data-go="analytics"]');
  await page.click('#statsTabs [data-stats-tab="month"]');
  await page.waitForFunction(() => {
    const month = document.getElementById('statsCalendarCard');
    const year = document.getElementById('unifiedYearCard');
    return month && !month.hidden && year?.hidden;
  });
  assert.equal(await page.locator('#statsCalendarCard .stats-calendar-month').count(), 1);

  await page.click('#statsTabs [data-stats-tab="year"]');
  await page.waitForFunction(() => {
    const month = document.getElementById('statsCalendarCard');
    const year = document.getElementById('unifiedYearCard');
    return month?.hidden && year && !year.hidden;
  });
  assert.equal(
    await page.locator('#unifiedYearGrid .unified-month').count(),
    12,
    'year statistics must show all 12 months',
  );

  await page.click('#statsTabs [data-stats-tab="overview"]');
  await page.waitForFunction(() => {
    const month = document.getElementById('statsCalendarCard');
    const year = document.getElementById('unifiedYearCard');
    return month?.hidden && year?.hidden;
  });
  await page.click('.bottom-nav [data-go="today"]');
}

try {
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  const gatewayRequests = [];
  await page.route(GATEWAY, async (route) => {
    const request = route.request();
    const body = request.postDataJSON?.() || {};
    gatewayRequests.push({ url: request.url(), body });
    await route.fulfill({
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'access-control-allow-origin': 'http://127.0.0.1:4173',
        'access-control-allow-headers': 'authorization, content-type',
      },
      body: JSON.stringify(fakeGatewayPayload(body.api_name, body)),
    });
  });
  page.on('console', (message) => {
    if (message.type() === 'error') console.error('[browser console]', message.text());
  });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error?.stack || error)));

  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'load' });
  await page.waitForSelector('#unifiedYearCard', { state: 'attached', timeout: 15000 });
  await page.waitForSelector('#statsCalendarCard', { state: 'attached', timeout: 15000 });
  await page.waitForTimeout(600);
  const initialDiagnostics = await runtimeDiagnostics(page, 'initial');
  assert.equal(initialDiagnostics.wereadGateway, GATEWAY);
  if (!initialDiagnostics.exportModule)
    throw new Error(`Export module did not mount: ${JSON.stringify(initialDiagnostics)}`);

  const guideClose = page.locator('#yuejiGuide.show [data-guide-close]');
  if (await guideClose.isVisible()) await guideClose.click();

  const navLabels = await page.locator('.bottom-nav .nav-btn').allTextContents();
  assert.equal(navLabels.length, 4, `expected four primary tabs, got ${navLabels.length}`);
  assert.deepEqual(
    navLabels.map((text) => text.replace(/[^\u4e00-\u9fff]/g, '')),
    ['首页', '书架', '笔记', '统计'],
  );

  const statLabels = await page.locator('#statsTabs [data-stats-tab]').allTextContents();
  assert.deepEqual(statLabels.map((x) => x.trim()), ['本月', '今年', '全部']);
  await verifyCalendarPlacement(page);

  const exportLabels = await page.locator('#yuejiExportModule option').allTextContents();
  assert.deepEqual(exportLabels.map((x) => x.trim()), [
    '年度概览',
    '全年日历',
    '书架',
    '某一本书的笔记',
    '阅读统计',
    '当前月份统计',
  ]);

  await page.evaluate(() => {
    localStorage.setItem('yueji-weread-key', 'browser-smoke-secret');
    localStorage.setItem('yueji-weread-key-persist-v1', '1');
    localStorage.setItem(
      'yueji-archive-v1',
      JSON.stringify({
        source: '浏览器测试',
        accent: '#5f8f7b',
        books: [
          {
            key: 'browser-smoke-book',
            title: '浏览器测试书',
            author: '测试作者',
            category: '测试',
            progress: 25,
            status: 'reading',
            minutes: 15,
            words: 1000,
            days: 1,
            color: '#66788d',
            sources: ['manual'],
          },
        ],
        sessions: [
          {
            id: 'browser-smoke-session',
            date: '2026-09-27',
            bookKey: 'browser-smoke-book',
            minutes: 15,
            words: 1000,
            source: 'manual',
          },
        ],
        journals: {},
        highlights: [],
        importedAt: '2026-09-27T00:00:00.000Z',
      }),
    );
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#unifiedYearCard', { state: 'attached', timeout: 15000 });
  await page.waitForSelector('#statsCalendarCard', { state: 'attached', timeout: 15000 });
  await page.waitForFunction(() => window.Yueji?.wereadGateway?.includes('workers.dev'));
  const keyState = await page.evaluate(() => ({
    local: localStorage.getItem('yueji-weread-key'),
    persist: localStorage.getItem('yueji-weread-key-persist-v1'),
    session: sessionStorage.getItem('yueji-weread-key'),
  }));
  assert.equal(keyState.local, null);
  assert.equal(keyState.persist, null);
  assert.equal(keyState.session, 'browser-smoke-secret');
  await verifyCalendarPlacement(page);

  assert.ok(
    gatewayRequests.every((item) => item.url === GATEWAY),
    'all WeRead browser requests must use the Cloudflare Worker endpoint',
  );

  await page.click('#settingsBtn');
  await page.waitForSelector('#yuejiExportModule', { state: 'visible', timeout: 10000 });
  await page.waitForSelector('#wereadRememberKey', { state: 'attached', timeout: 15000 });
  assert.equal(await page.locator('#wereadRememberKey').isChecked(), false);
  assert.equal(await page.locator('#wereadRememberKey').locator('xpath=..').isVisible(), false);
  assert.equal(await page.locator('#yuejiNickname').count(), 0);
  assert.equal(await page.locator('#yuejiSignature').count(), 0);
  assert.equal(await page.locator('#yuejiExportCredit').isVisible(), true);

  await page.waitForFunction(() => document.querySelectorAll('#noteBookFilter option').length > 1);
  await page.selectOption('#yuejiExportModule', 'book-notes');
  await page.waitForFunction(() => {
    const field = document.getElementById('yuejiExportBookField');
    const picker = document.getElementById('yuejiExportBook');
    return field && !field.hidden && picker && picker.options.length > 0 && picker.value;
  });
  assert.equal(await page.locator('#yuejiExportBook').inputValue(), 'browser-smoke-book');

  await page.selectOption('#yuejiExportModule', 'year-overview');
  await page.fill('#yuejiExportCredit', '小树');
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
  console.log('Browser smoke OK: calendar lives in stats, compact settings, Cloudflare routing, PNG export');
} finally {
  await browser.close();
}