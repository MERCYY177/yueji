import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const evidence=fs.readFileSync(new URL('../yueji-weread-evidence.js',import.meta.url),'utf8');
const context={window:{},setTimeout(){},console,localStorage:{setItem(){}}};
vm.runInNewContext(evidence,context);
const dates=context.window.yuejiVerifiedWeReadActivityDates;

assert.deepEqual([...dates({weReadSnapshots:[{date:'2026-09-09',progress:42,seconds:9000}]})],[],
  'the first imported progress snapshot is a baseline, not a dated reading event');
assert.deepEqual([...dates({weReadSnapshots:[
  {date:'2026-09-09',progress:42,seconds:9000},
  {date:'2026-09-10',progress:44,seconds:9300}
]})],['2026-09-10'],'a later increase is a verified reading event');
assert.deepEqual([...dates({weReadSnapshots:[
  {date:'2026-09-09',progress:42,seconds:9000},
  {date:'2026-09-10',progress:42,seconds:9000}
]})],[],'an unchanged later snapshot is not a reading event');
assert.deepEqual([...dates({weReadSnapshots:[
  {date:'2026-09-10',progress:42,seconds:9000,activity:true}
]})],['2026-09-10'],'same-day growth retained by the sync merger is accepted');

const features=fs.readFileSync(new URL('../yueji-features.js',import.meta.url),'utf8');
assert.doesNotMatch(features,/const d=b\.weReadLastRead\|\|b\.finishedDate/,
  'annual read report must not use the shelf/import timestamp');
assert.match(features,/yuejiVerifiedWeReadActivityDates/,
  'annual read report must use verified per-book activity');

const core=fs.readFileSync(new URL('../yueji-fix-core.js',import.meta.url),'utf8');
assert.doesNotMatch(core,/&&b\.weReadLastRead\)ds\.push/,
  'evolution must not create nodes from imported shelf timestamps');
assert.match(core,/yuejiVerifiedWeReadActivityDates/,
  'evolution must use verified per-book activity');

const app=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
const yearCalendar=app.match(/function renderYearCalendar\(\)[\s\S]*?\$\('challengeRead'\)\.textContent=count\}/)?.[0]||'';
assert.ok(yearCalendar,'year calendar renderer must exist');
assert.doesNotMatch(yearCalendar,/challengeStart|challengeEnd/,
  'year calendar must not hide dates outside the separate challenge range');
assert.match(app,/function calendarDataYears\(\)/,'year choices must be derived from stored reading data');
assert.match(app,/state\.sessions\.forEach\(s=>add\(s\.date\)\)/,'imported session years must populate the selector');
assert.match(app,/calendarYearSelect/,'year calendar must expose a direct year selector');
assert.match(app,/function moveCalendarPeriod\(direction\)/,'calendar arrows must navigate the available data years');
assert.match(app,/target=years\[index-direction\]/,'year arrows must move through data-derived years instead of empty years');
assert.match(app,/prev\.disabled=.*years\.length-1/,'year navigation must stop at the oldest available data year');
assert.match(features,/function syncYearReportOptions\(\)/,'annual report must use the same data-derived year choices');
assert.doesNotMatch(features,/yearWallYear[^\n]+type="number"/,'annual report year must not rely on manual number entry');

const yearFn=app.match(/function calendarDataYears\(\)\{[\s\S]*?return \[\.\.\.years\][^}]+\}/)?.[0];
assert.ok(yearFn,'data-year collector must be testable');
const yearContext={
  today:new Date('2026-09-10T00:00:00Z'),
  state:{
    sessions:[{date:'2025-02-03'},{date:'2023-12-20'}],
    journals:{x:{date:'2025-08-01'}},
    books:[{finishedDate:'2023-06-01'}]
  },
  window:{yuejiVerifiedWeReadActivityDates:()=>['2025-04-09']}
};
vm.runInNewContext(`${yearFn};globalThis.result=calendarDataYears()`,yearContext);
assert.deepEqual([...yearContext.result],[2026,2025,2023],
  'year choices must include every stored year and exclude invented empty years');

console.log('P1 reading evidence and year-calendar rules passed');
