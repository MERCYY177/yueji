const UPSTREAM = 'https://i.weread.qq.com/api/agent/gateway';
const UPSTREAM_TIMEOUT_MS = 15000;
const UPSTREAM_MAX_BYTES = 2 * 1024 * 1024;
const CLIENT_MAX_BYTES = 512 * 1024;
const REQUEST_MAX_BYTES = 64 * 1024;

const ALLOWED_APIS = new Set([
  '/_list',
  '/readdata/detail',
  '/shelf/sync',
  '/book/getprogress',
  '/user/notebooks',
  '/book/bookmarklist',
  '/review/list/mine',
]);

const API_FIELDS = {
  '/_list': [],
  '/readdata/detail': ['mode', 'baseTime'],
  '/shelf/sync': [],
  '/book/getprogress': ['bookId'],
  '/user/notebooks': ['count', 'lastSort'],
  '/book/bookmarklist': ['bookId'],
  '/review/list/mine': ['bookid', 'synckey', 'count'],
};

const json = (data, status = 200, extraHeaders = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...extraHeaders,
    },
  });

async function readBoundedText(response) {
  const declared = Number(response.headers.get('content-length')) || 0;
  if (declared > UPSTREAM_MAX_BYTES) throw new Error('UPSTREAM_TOO_LARGE');
  if (!response.body?.getReader) {
    const body = await response.text();
    if (new TextEncoder().encode(body).byteLength > UPSTREAM_MAX_BYTES)
      throw new Error('UPSTREAM_TOO_LARGE');
    return body;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > UPSTREAM_MAX_BYTES) {
        await reader.cancel();
        throw new Error('UPSTREAM_TOO_LARGE');
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join('');
  } finally {
    try {
      reader.releaseLock();
    } catch {}
  }
}

const pick = (value, keys) =>
  Object.fromEntries(
    keys.filter((key) => value?.[key] !== undefined).map((key) => [key, value[key]]),
  );
const compactBook = (book) =>
  pick(book || {}, [
    'bookId',
    'title',
    'name',
    'author',
    'authorName',
    'category',
    'cover',
    'isbn',
    'finishReading',
    'readUpdateTime',
  ]);
function compactPayload(apiName, payload) {
  if (!payload || typeof payload !== 'object' || (payload.errcode && payload.errcode !== 0))
    return payload;
  const wrapped = payload.data && typeof payload.data === 'object';
  const source = wrapped ? payload.data : payload;
  let data;
  if (apiName === '/shelf/sync')
    data = { books: (Array.isArray(source.books) ? source.books : []).map(compactBook) };
  else if (apiName === '/readdata/detail')
    data = pick(source, ['dailyReadTimes', 'readTimes', 'registTime']);
  else if (apiName === '/book/getprogress')
    data = {
      book: pick(source.book || source, [
        'progress',
        'isStartReading',
        'recordReadingTime',
        'updateTime',
        'finishTime',
      ]),
      bookId: source.bookId,
    };
  else if (apiName === '/user/notebooks')
    data = {
      books: (Array.isArray(source.books) ? source.books : []).map((item) => ({
        book: compactBook(item.book || item),
        bookId: item.bookId,
        readingProgress: item.readingProgress,
        sort: item.sort,
      })),
      hasMore: Boolean(source.hasMore),
    };
  else if (apiName === '/book/bookmarklist')
    data = {
      updated: (Array.isArray(source.updated) ? source.updated : []).map((item) =>
        pick(item, ['bookmarkId', 'markText', 'createTime']),
      ),
    };
  else if (apiName === '/review/list/mine')
    data = {
      reviews: (Array.isArray(source.reviews) ? source.reviews : []).map((item) => ({
        review: pick(item.review || item, ['reviewId', 'content', 'abstract', 'createTime']),
      })),
      synckey: source.synckey,
      hasMore: Boolean(source.hasMore),
    };
  else data = source;
  return wrapped ? { ...pick(payload, ['errcode', 'errmsg', 'message']), data } : data;
}

export default async (request) => {
  if (request.method !== 'POST') {
    return json({ message: '只允许 POST 请求' }, 405, { allow: 'POST' });
  }

  const declaredRequestBytes = Number(request.headers.get('content-length')) || 0;
  if (declaredRequestBytes > REQUEST_MAX_BYTES) return json({ message: '请求内容过大' }, 413);
  const origin = request.headers.get('origin');
  if (origin) {
    let expected = '';
    try {
      expected = new URL(request.url).origin;
    } catch {}
    if (expected && origin !== expected)
      return json({ message: '不允许跨站调用微信读书网关' }, 403, { vary: 'Origin' });
  }

  const authorization = request.headers.get('authorization') || '';
  if (!authorization.startsWith('Bearer ') || authorization.length < 20) {
    return json({ message: '缺少有效的微信读书 Skill Key' }, 401);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ message: '请求内容不是有效 JSON' }, 400);
  }

  const apiName = String(payload?.api_name || '');
  if (!ALLOWED_APIS.has(apiName)) {
    return json({ message: '这个微信读书接口不在阅迹允许列表中' }, 403);
  }

  // WeRead's current official Skill version is 1.0.4.
  // Force the proxy to report the supported version even if an older cached
  // front-end sends another value.
  const allowed = API_FIELDS[apiName] || [],
    safePayload = { api_name: apiName, skill_version: '1.0.4' };
  for (const field of allowed)
    if (payload[field] !== undefined) safePayload[field] = payload[field];
  if ('count' in safePayload)
    safePayload.count = Math.max(1, Math.min(50, Number(safePayload.count) || 20));
  for (const field of ['bookId', 'bookid', 'lastSort', 'synckey'])
    if (field in safePayload && String(safePayload[field]).length > 160)
      return json({ message: '请求参数无效' }, 400);

  try {
    const upstream = await fetch(UPSTREAM, {
      method: 'POST',
      headers: {
        authorization,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(safePayload),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });

    const body = await readBoundedText(upstream);
    let compactBody = body;
    try {
      compactBody = JSON.stringify(compactPayload(apiName, JSON.parse(body)));
    } catch {}
    if (new TextEncoder().encode(compactBody).byteLength > CLIENT_MAX_BYTES) {
      return json({ message: '微信读书整理后的单次数据仍然过大，已安全停止' }, 413);
    }
    return new Response(compactBody, {
      status: upstream.status,
      headers: {
        'content-type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      },
    });
  } catch (error) {
    console.error('WeRead gateway failed', error);
    if (error?.message === 'UPSTREAM_TOO_LARGE') {
      return json({ message: '微信读书单次返回数据过大，已安全停止；请缩小同步范围后重试' }, 413);
    }
    const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    return json(
      {
        message: timedOut ? '微信读书响应超时，请稍后继续同步' : '暂时无法连接微信读书，请稍后重试',
      },
      timedOut ? 504 : 502,
    );
  }
};

export const config = {
  path: '/.netlify/functions/weread-gateway',
  rateLimit: { windowLimit: 60, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};
