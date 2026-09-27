import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const chrome = process.env.CHROME_BIN;
if (!chrome) throw new Error('CHROME_BIN is required');
const GATEWAY = 'https://yueji-weread-gateway.xiaoshu10088.workers.dev/api/weread';
const cover = 'https://covers.test/crime.svg';
const updateTime = Math.floor(new Date('2026-09-27T09:30:00+08:00').getTime() / 1000);

const browser = await chromium.launch({
  executablePath: chrome,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

try {
  const context = await browser.newContext();
  const page = await context.newPage();
  const gatewayRequests = [];

  await page.route(cover, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="180"><rect width="120" height="180" fill="#789"/><text x="60" y="90" text-anchor="middle" fill="white">CRIME</text></svg>',
    });
  });

  await page.route(GATEWAY, async (route) => {
    const body = route.request().postDataJSON?.() || {};
    gatewayRequests.push(body);
    if (body.api_name === '/book/getprogress') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            book: {
              bookId: 'crime-weread',
              progress: 100,
              updateTime,
              recordReadingTime: 3600,
            },
          },
        }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"data":{}}' });
  });

  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'load' });
  await page.evaluate(() => {
    sessionStorage.setItem('yueji-weread-key', 'browser-finished-key-1234567890');
  });
  await page.reload({ waitUntil: 'load' });

  await page.waitForFunction(() => typeof window.Yueji?.reconcileWeReadFinishedBooks === 'function');
  await page.waitForFunction(() => typeof window.Yueji?.repairWeReadFinishedDates === 'function');
  await page.waitForSelector('#wereadSettings', { state: 'attached', timeout: 15000 });

  // Full WeRead books/shelf live in the extension's IndexedDB-backed runtime state,
  // not in compact localStorage. Seed the regression at that authoritative layer so
  // this test cannot race the asynchronous IndexedDB restore step.
  await page.evaluate(({ cover }) => {
    state.source = '微信读书';
    state.books = [
      {
        key: 'crime',
        title: '罪与罚',
        author: '陀思妥耶夫斯基',
        sources: ['weread'],
        weReadBookId: 'crime-weread',
        progress: 0,
        status: 'unread',
        cover: '',
        weReadCover: '',
      },
    ];
    state.sessions = [];
    state.weRead = {
      ...(state.weRead || {}),
      shelfBooks: [
        {
          bookId: 'crime-weread',
          title: '罪与罚',
          author: '陀思妥耶夫斯基',
          finishReading: '1',
          cover,
        },
      ],
    };
  }, { cover });

  await page.evaluate(async () => {
    await window.Yueji.reconcileWeReadFinishedBooks({ fetchMissingDates: true });
    await window.Yueji.repairWeReadFinishedDates({ fetchMissingDates: true });
  });

  await page.waitForFunction(() => {
    try {
      const book = state.books?.find((item) => item.weReadBookId === 'crime-weread');
      return book?.progress === 100 && book?.status === 'done' && book?.finishedDate === '2026-09-27';
    } catch {
      return false;
    }
  });

  const repaired = await page.evaluate(() =>
    state.books.find((item) => item.weReadBookId === 'crime-weread'),
  );
  assert.equal(repaired.progress, 100);
  assert.equal(repaired.status, 'done');
  assert.equal(repaired.finishedDate, '2026-09-27');
  assert.equal(repaired.weReadCover, cover);
  assert.equal(repaired.weReadProgressEvidence?.date, '2026-09-27');
  assert.equal(repaired.weReadProgressEvidence?.progress, 100);

  await page.evaluate(() => {
    if (!state.sessions.some((row) => row.id === 'crime-month-browser')) {
      state.sessions.push({
        id: 'crime-month-browser',
        date: '2026-09-27',
        bookKey: 'crime',
        minutes: 30,
        source: 'weread',
      });
    }
    document.getElementById('monthPicker').value = '2026-09';
    renderMonthly();
  });

  await page.waitForFunction(
    ({ cover }) => {
      const finished = document.getElementById('monthFinished')?.textContent || '';
      const img = document.querySelector('#monthSeenBooks img[data-cover-key="crime"]');
      return finished.includes('罪与罚') && img?.getAttribute('src') === cover;
    },
    { cover },
  );

  const monthly = await page.evaluate(() => ({
    finished: document.getElementById('monthFinished')?.textContent || '',
    src: document.querySelector('#monthSeenBooks img[data-cover-key="crime"]')?.getAttribute('src') || '',
  }));
  assert.match(monthly.finished, /罪与罚/);
  assert.equal(monthly.src, cover);

  await page.evaluate(() => {
    const year = document.getElementById('yearWallYear');
    if (year) year.value = '2026';
    window.renderYearWall?.();
    window.Yueji?.applyCoverFallbacks?.();
  });
  await page.waitForFunction(
    ({ cover }) => {
      const img = document.querySelector('#yearWallPreview img[data-cover-key="crime"]');
      return img?.getAttribute('src') === cover;
    },
    { cover },
  );

  const yearly = await page.locator('#yearWallPreview img[data-cover-key="crime"]').getAttribute('src');
  assert.equal(yearly, cover);

  console.log(
    `Browser regression OK: finished date falls back to verified progress updateTime; monthly/year covers remain live; gateway requests=${gatewayRequests.length}`,
  );
} finally {
  await browser.close();
}
