import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const extension = fs.readFileSync(new URL('../yueji-extension.js', import.meta.url), 'utf8');
const evidence = fs.readFileSync(
  new URL('../yueji-weread-date-evidence.js', import.meta.url),
  'utf8',
);
const features = fs.readFileSync(new URL('../yueji-features.js', import.meta.url), 'utf8');
const gateway = fs.readFileSync(
  new URL('../netlify/functions/weread-gateway.mjs', import.meta.url),
  'utf8',
);
const style = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8');
const onboarding = fs.readFileSync(new URL('../yueji-onboarding.js', import.meta.url), 'utf8');

assert.match(html, /vendor\/jszip\.min\.js/, 'JSZip must be served from the same site');
assert.match(html, /vendor\/sql-asm\.js/, 'sql.js must be served from the same site');
assert.doesNotMatch(html, /cdnjs\.cloudflare\.com/, 'runtime scripts must not depend on a CDN');
assert.equal(
  manifest.icons.some((icon) => icon.sizes === '192x192'),
  true,
);
assert.equal(
  manifest.icons.some((icon) => icon.sizes === '512x512'),
  true,
);
assert.equal(fs.existsSync(new URL('../service-worker.js', import.meta.url)), true);
assert.equal(
  fs.existsSync(new URL('../yueji-fix.js', import.meta.url)),
  false,
  'legacy loader must be removed',
);

assert.match(
  extension,
  /if\s*\(!title\)\s*return null/,
  'partial notebook rows must not create unnamed books',
);
assert.match(extension, /\^未命名/, 'a later complete shelf row must replace a placeholder title');
assert.match(extension, /sessionStorage/, 'the default key lifetime must be limited to the tab');
assert.match(
  features,
  /all\.slice\(\s*60\s*\)/,
  'large monthly exports must cap one mobile canvas',
);
assert.match(features, /8_000_000/, 'canvas exports must enforce a safe pixel budget');
assert.doesNotMatch(
  features,
  /yearBaseCache\.clear\(\);\s*yearCoverCache\.clear/,
  'data revisions must not discard unchanged cover blobs',
);
assert.match(
  style,
  /input,\s*textarea,\s*select,\s*button\s*\{\s*font-size:\s*16px/,
  'mobile controls must not trigger iOS focus zoom',
);

assert.match(gateway, /REQUEST_MAX_BYTES/, 'gateway must limit request bodies');
assert.match(gateway, /API_FIELDS/, 'gateway must rebuild API-specific payloads');
assert.match(gateway, /rateLimit/, 'gateway must have platform rate limiting');
assert.match(gateway, /origin !== expected/, 'gateway must reject browser cross-origin use');
assert.match(
  extension,
  /async function syncWeReadComplete/,
  'one click must drive every persisted WeRead sync phase',
);
assert.match(
  extension,
  /await sleep\(1100\)/,
  'complete sync must remain below the gateway rate limit',
);
assert.match(
  extension,
  /手机和电脑需要各自完成一次同步/,
  'the settings panel must explain per-device storage',
);
const readMarkSource = onboarding.match(/function syncReadMark\(\)\s*\{[\s\S]*?\n  \}/)?.[0];
assert.ok(readMarkSource, 'the home read-mark normalizer must remain testable');
let textWrites = 0;
const readMark = {
  _text: '📖',
  get textContent() {
    return this._text;
  },
  set textContent(value) {
    textWrites += 1;
    this._text = value;
  },
  classList: { contains: () => false, remove: () => {} },
  style: { getPropertyValue: () => '', removeProperty: () => {} },
};
const readMarkContext = { document: { getElementById: () => readMark } };
vm.runInNewContext(`${readMarkSource};syncReadMark();syncReadMark();`, readMarkContext);
assert.equal(textWrites, 0, 'an unchanged read mark must not retrigger its own MutationObserver');

const start = evidence.indexOf('function hasVerifiedWeReadReading');
const end = evidence.indexOf('window.yuejiVerifiedWeReadActivityDates');
const source = evidence.slice(start, end);
const context = { result: null };
vm.runInNewContext(
  `const n=value=>Number(value)||0;${source};result=verifiedWeReadActivityDates({sources:['weread'],weReadProgress:20,weReadLastRead:'2024-05-06'});`,
  context,
);
assert.deepEqual(
  [...context.result],
  ['2024-05-06'],
  'legacy positive detail dates must remain visible',
);

console.log('PASS release hardening, PWA, privacy, gateway and compatibility guards');
