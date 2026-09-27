import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/src/index.mjs';
import { readFile } from 'node:fs/promises';

const ORIGIN = 'https://mercyy177.github.io';
const WORKER_URL = 'https://yueji-weread-gateway.xiaoshu10088.workers.dev/api/weread';

function request(method = 'POST', origin = ORIGIN) {
  const options = {
    method,
    headers: {
      origin,
      authorization: `Bearer ${'x'.repeat(24)}`,
      'content-type': 'application/json',
    },
  };
  if (method === 'POST') options.body = JSON.stringify({ api_name: '/readdata/detail', mode: 'annually' });
  return new Request(WORKER_URL, options);
}

test('Worker allows GitHub Pages CORS preflight and rejects foreign origins', async () => {
  const preflight = await worker.fetch(request('OPTIONS'), {});
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), ORIGIN);
  assert.match(preflight.headers.get('access-control-allow-headers') || '', /authorization/i);

  const rejected = await worker.fetch(request('POST', 'https://evil.example'), {});
  assert.equal(rejected.status, 403);
});

test('Worker forwards allowed GitHub Pages requests and preserves official reading totals', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url, init) => {
      assert.equal(String(url), 'https://i.weread.qq.com/api/agent/gateway');
      assert.equal(init.method, 'POST');
      return new Response(
        JSON.stringify({ data: { totalReadTime: 3600, readDays: 12, dailyReadTimes: { '2026-09-27': 900 } } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };
    const response = await worker.fetch(request(), {});
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), ORIGIN);
    const payload = await response.json();
    assert.equal(payload.data.totalReadTime, 3600);
    assert.equal(payload.data.readDays, 12);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('GitHub Pages runtime rewrites the legacy gateway path to Cloudflare', async () => {
  const core = await readFile(new URL('../yueji-core.js', import.meta.url), 'utf8');
  assert.match(core, /yueji-weread-gateway\.xiaoshu10088\.workers\.dev\/api\/weread/);
  assert.match(core, /\.netlify\/functions\/weread-gateway/);
  assert.match(core, /globalThis\.fetch\s*=/);

  const pagesWorkflow = await readFile(new URL('../.github/workflows/pages.yml', import.meta.url), 'utf8');
  assert.match(pagesWorkflow, /npm run check/);
  assert.match(pagesWorkflow, /path:\s*dist/);
  assert.doesNotMatch(pagesWorkflow, /path:\s*\.\s*$/m);
});
