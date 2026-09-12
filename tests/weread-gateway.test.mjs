import assert from 'node:assert/strict';
import handler from '../netlify/functions/weread-gateway.mjs';

const originalFetch = globalThis.fetch;
const request = (apiName) =>
  new Request('https://example.test/.netlify/functions/weread-gateway', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${'x'.repeat(16)}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ api_name: apiName }),
  });

try {
  const books = Array.from({ length: 500 }, (_, i) => ({
    bookId: String(i),
    title: `书 ${i}`,
    author: '作者',
    cover: `https://img/${i}`,
    unused: 'x'.repeat(1500),
  }));
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ data: { books, hugeUnused: 'y'.repeat(100000) } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  const compact = await handler(request('/shelf/sync'));
  assert.equal(compact.status, 200);
  const text = await compact.text(),
    payload = JSON.parse(text);
  assert.equal(payload.data.books.length, 500);
  assert.equal(payload.data.books[0].unused, undefined);
  assert.ok(
    new TextEncoder().encode(text).byteLength < 512 * 1024,
    'trimmed response must fit the client cap',
  );

  globalThis.fetch = async () => new Response('x'.repeat(2 * 1024 * 1024 + 1), { status: 200 });
  const oversized = await handler(request('/shelf/sync'));
  assert.equal(
    oversized.status,
    413,
    'oversized upstream response must be rejected before reaching the browser',
  );
  console.log('PASS gateway field trimming and upstream response cap');
} finally {
  globalThis.fetch = originalFetch;
}
