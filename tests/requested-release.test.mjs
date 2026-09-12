import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const onboarding = fs.readFileSync(new URL('../yueji-onboarding.js', import.meta.url), 'utf8');
const extension = fs.readFileSync(new URL('../yueji-extension.js', import.meta.url), 'utf8');

assert.doesNotMatch(
  app + html,
  /challengeStart|challengeEnd|challengeGrid|challengeRead|阅读挑战日期/,
);
assert.match(app, /function renderYearCalendar/);
assert.match(onboarding, /indexedDB\.deleteDatabase/);
assert.doesNotMatch(onboarding, /localStorage\.clear/);
assert.match(onboarding, /yueji-highlights-v1/);
assert.match(onboarding, /yueji-covers-v1/);
assert.match(onboarding, /yueji-weread-sync-v1/);
assert.match(extension, /syncWeReadComplete/);
assert.match(extension, /source: 'book-progress'/);
assert.match(extension, /正在自动检查微信读书更新/);
console.log('PASS auto sync, clear-all and natural year calendar');
