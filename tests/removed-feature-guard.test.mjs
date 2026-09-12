import assert from 'node:assert/strict';
import fs from 'node:fs';

const productionFiles = [
  'index.html',
  'style.css',
  'service-worker.js',
  'app.js',
  'yueji-core.js',
  'yueji-extension.js',
  'yueji-p1-identity-migration.js',
  'yueji-weread-date-evidence.js',
  'yueji-layout.js',
  'yueji-book-cover.js',
  'yueji-onboarding.js',
  'yueji-features.js',
];
const productionSource = productionFiles
  .map((file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'))
  .join('\n');

for (const residue of [
  'readingEvolutionCard',
  'evolutionCanvas',
  'evolutionRangeSeg',
  'evolutionSourceSeg',
  'yuejiRenderEvolution',
  'yuejiBuildEvolutionItems',
  '微信圆圈',
  '阅读演化',
]) {
  assert.equal(productionSource.includes(residue), false, `removed feature residue: ${residue}`);
}

assert.equal(fs.existsSync(new URL('../yueji-fix-core.js', import.meta.url)), false);
assert.equal(fs.existsSync(new URL('../yueji-weread-evidence.js', import.meta.url)), false);
assert.match(productionSource, /yuejiVerifiedWeReadActivityDates/);
console.log('PASS removed feature guard and strict WeRead date evidence retention');
