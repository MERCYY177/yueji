import test from 'node:test';
import assert from 'node:assert/strict';
import gateway from '../netlify/functions/weread-gateway.mjs';

test('bookmark gateway preserves chapter metadata needed by chapter notes', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        data: {
          updated: [
            {
              bookmarkId: 'b1',
              markText: '测试划线',
              createTime: 1,
              chapterUid: 9001,
              chapterIdx: 3,
              range: '128-146',
            },
          ],
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  try {
    const req = new Request('https://yueji.test/.netlify/functions/weread-gateway', {
      method: 'POST',
      headers: {
        authorization: 'Bearer 12345678901234567890',
        origin: 'https://yueji.test',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ api_name: '/book/bookmarklist', bookId: 'book-1' }),
    });
    const res = await gateway(req);
    const body = await res.json();
    assert.deepEqual(body.data.updated[0], {
      bookmarkId: 'b1',
      markText: '测试划线',
      createTime: 1,
      chapterUid: 9001,
      chapterIdx: 3,
      range: '128-146',
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('review gateway preserves chapter metadata when WeRead returns it', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        data: {
          reviews: [
            {
              review: {
                reviewId: 'r1',
                content: '批注',
                abstract: '原文',
                createTime: 2,
                chapterUid: 9001,
                chapterIdx: 3,
                range: '128-146',
              },
            },
          ],
          synckey: 0,
          hasMore: false,
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  try {
    const req = new Request('https://yueji.test/.netlify/functions/weread-gateway', {
      method: 'POST',
      headers: {
        authorization: 'Bearer 12345678901234567890',
        origin: 'https://yueji.test',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ api_name: '/review/list/mine', bookid: 'book-1', count: 20 }),
    });
    const res = await gateway(req);
    const body = await res.json();
    assert.equal(body.data.reviews[0].review.chapterUid, 9001);
    assert.equal(body.data.reviews[0].review.chapterIdx, 3);
    assert.equal(body.data.reviews[0].review.range, '128-146');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
