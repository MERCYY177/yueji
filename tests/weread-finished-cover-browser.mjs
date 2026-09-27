import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const chrome = process.env.CHROME_BIN;
if (!chrome) throw new Error('CHROME_BIN is required');
const GATEWAY = 'https://yueji-weread-gateway.xiaoshu10088.workers.dev/api/weread';
const cover =
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="180"><rect width="120" height="180" fill="#789"/><text x="60" y="90" text-anchor="middle" fill="white">CRIME</text></svg>');
const finishTime = Math.floor(new Date('2026-09-27T09:30:00+08:00').getTime() / 1000);

const browser = await chromium.launch({
  executablePath: chrome,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

try {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.route(GATEWAY, async (route) => {
    const body = route.request().postDataJSON?.() || {};
    if (body.api_name === '/book/getprogress') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            book: {
              bookId: 'crime-weread',
              progress: 100,
              finishTime,
              finishReading: true,
            },
          },
        }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"data":{}}' });
  });

  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'load' });
  await page.evaluate(
    ({ cover }) => {
      localStorage.setItem(
        'yueji-archive-v1',
        JSON.stringify({
          source: '微信读书',
          accent: '#5f8f7b',
          books: [
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
          ],
          sessions: [],
          journals: {},
          highlights: [],
          weRead: {
            shelfBooks: [
              {
                bookId: 'crime-weread',
                title: '罪与罚',
                author: '陀思妥耶夫斯基',
                finishReading: '1',
                cover,
              },
            ],
          },
          importedAt: '2026-09-27T00:00:00.000Z',
        }),
      );
      sessionStorage.setItem('yueji-weread-key', 'browser-finished-key-1234567890');
    },
    { cover },
  );
  await page.reload({ waitUntil: 'load' });

  await page.waitForFunction(() => {
    const data = JSON.parse(localStorage.getItem('yueji-archive-v1') || '{}');
    const book = data.books?.find((item) => item.weReadBookId === 'crime-weread');
    return book?.progress === 100 && book?.status === 'done' && book?.finishedDate === '2026-09-27';
  });

  const repaired = await page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem('yueji-archive-v1') || '{}');
    return data.books.find((item) => item.weReadBookId === 'crime-weread');
  });
  assert.equal(repaired.progress, 100);
  assert.equal(repaired.status, 'done');
  assert.equal(repaired.finishedDate, '2026-09-27');
  assert.equal(repaired.weReadCover, cover);

  await page.evaluate(() => {
    const year = document.getElementById('yearWallYear');
    if (year) year.value = '2026';
    window.renderYearWall?.();
  });
  await page.waitForFunction(() => {
    const img = document.querySelector('#yearWallPreview img[data-cover-key="crime"]');
    return Boolean(img?.dataset.coverFallback && img.getAttribute('src'));
  });
  const image = await page.locator('#yearWallPreview img[data-cover-key="crime"]').evaluate((img) => ({
    fallback: img.dataset.coverFallback,
    src: img.getAttribute('src'),
  }));
  assert.equal(image.fallback, cover);
  assert.equal(image.src, cover);

  console.log('Browser regression OK: WeRead finished state repaired and annual wall uses source cover fallback');
} finally {
  await browser.close();
}
