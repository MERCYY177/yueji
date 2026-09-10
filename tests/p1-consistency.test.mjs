import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const app=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
const start=app.indexOf('function effectiveSessions');
const end=app.indexOf('function dayData',start);
assert.ok(start>=0&&end>start,'shared reading-evidence helpers must exist');
const state={sessions:[],journals:{manual:{date:'2026-09-03',read:true,bookKey:'moon:1'},other:{date:'2026-08-03',read:true,bookKey:'moon:2'}}};
const context={state,window:{},Set,Map,String,Object,Array,$:()=>({value:'2026-09'})};
vm.runInNewContext(`${app.slice(start,end)};globalThis.rows=effectiveSessions([
 {date:'2026-09-01',source:'weread',aggregate:true,minutes:60},
 {date:'2026-09-01',source:'weread',bookKey:'wr:1',minutes:20},
 {date:'2026-09-01',source:'moon',bookKey:'moon:1',minutes:15}
]);globalThis.dates=effectiveReadDates([{date:'2026-09-01',source:'weread',aggregate:true,minutes:60}],{prefix:'2026-09'});globalThis.manual=manualBooksInPeriod('2026-09')`,context);
assert.equal(context.rows.reduce((sum,row)=>sum+(+row.minutes||0),0),75,'daily WeRead total must replace same-day per-book WeRead rows without removing Moon Reader time');
assert.deepEqual([...context.dates].sort(),['2026-09-01','2026-09-03'],'manual reading days must join the matching report period only');
assert.deepEqual([...context.manual],['moon:1'],'manual book attribution must join the matching month only');

const layout=fs.readFileSync(new URL('../yueji-layout.js',import.meta.url),'utf8');
assert.doesNotMatch(layout,/if\(b\.weReadLastRead\)dates\.push/,'home recent books must not use a shelf timestamp as reading evidence');
assert.match(layout,/yuejiEffectiveSessions/,'home and overview statistics must share the effective-session rule');
const features=fs.readFileSync(new URL('../yueji-features.js',import.meta.url),'utf8');
assert.match(features,/state\.journals[\s\S]*?months\[/,'annual read report must include manually attributed reading');
assert.match(features,/yuejiMergeConfirmedBookPair/,'ambiguous cross-source duplicates must offer a user-confirmed merge path');
assert.match(features,/releaseExportFontCache/,'large export fonts must be released after preview generation');
const activity=app.match(/function monthWeReadActivity\(val\)[\s\S]*?return candidates[^\n]+/)?.[0]||'';
assert.doesNotMatch(activity,/weReadLastRead/,'monthly activity must not fall back to a shelf timestamp');
const extension=fs.readFileSync(new URL('../yueji-extension.js',import.meta.url),'utf8');
const evolutionDate=extension.match(/function actualDateForBook[\s\S]*?\n  }/)?.[0]||'';
assert.doesNotMatch(evolutionDate,/weReadLastRead/,'reading evolution must not turn a shelf timestamp into a reading event');
assert.match(evolutionDate,/yuejiVerifiedWeReadActivityDates/,'reading evolution must use verified WeRead activity dates');

console.log('PASS P1 cross-module statistics, manual evidence, duplicate review and export cleanup');
