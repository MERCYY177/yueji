import netlifyGateway from '../../netlify/functions/weread-gateway.mjs';

const DEFAULT_ALLOWED_ORIGINS = ['https://mercyy177.github.io'];

function allowedOrigins(env = {}) {
  const configured = String(env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return new Set([...DEFAULT_ALLOWED_ORIGINS, ...configured]);
}

function corsHeaders(origin) {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-max-age': '86400',
    vary: 'Origin',
  };
}

function json(data, status, origin = '') {
  const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
  if (origin) Object.assign(headers, corsHeaders(origin));
  return new Response(JSON.stringify(data), { status, headers });
}

export async function handleRequest(request, env = {}) {
  const url = new URL(request.url);
  if (url.pathname !== '/api/weread') return json({ message: 'Not Found' }, 404);

  const origin = request.headers.get('origin') || '';
  const allowed = allowedOrigins(env);
  if (!origin || !allowed.has(origin)) return json({ message: '不允许这个来源调用微信读书网关' }, 403);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ message: '只允许 POST 请求' }), {
      status: 405,
      headers: { ...corsHeaders(origin), allow: 'POST, OPTIONS', 'content-type': 'application/json; charset=utf-8' },
    });
  }

  const headers = new Headers(request.headers);
  // The original gateway's same-origin guard is kept as an internal defense.
  // Rewrite Origin only for the internal call after the public GitHub Pages origin
  // has already passed the explicit allowlist above.
  headers.set('origin', url.origin);
  const internalRequest = new Request(request, { headers });
  const upstreamResponse = await netlifyGateway(internalRequest);
  const responseHeaders = new Headers(upstreamResponse.headers);
  for (const [key, value] of Object.entries(corsHeaders(origin))) responseHeaders.set(key, value);
  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: responseHeaders,
  });
}

export default {
  fetch(request, env) {
    return handleRequest(request, env);
  },
};
