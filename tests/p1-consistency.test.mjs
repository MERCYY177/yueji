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
assert.doesNotMatch(evolutionDate,/weReadLastRead|weReadShelfReadUpdate|readUpdateTime/,'the WeRead view must never turn shelf metadata into a reading circle');
assert.match(evolutionDate,/yuejiVerifiedWeReadActivityDates/,'reading evolution must use verified WeRead activity dates');
const core=fs.readFileSync(new URL('../yueji-fix-core.js',import.meta.url),'utf8');
const itemStart=core.indexOf('function weReadTrack');
const itemEnd=core.indexOf('function render()',itemStart);
assert.ok(itemStart>=0&&itemEnd>itemStart,'evolution evidence builder must be independently testable');
const evolutionState={books:[{key:'merged:1',sources:['moon','weread'],weReadSeconds:7200},{key:'weread:trace',sources:['weread'],weReadSeconds:3600,weReadShelfReadUpdate:'2026-09-05',readUpdateTime:'2026-09-06'},{key:'manual:1',sources:['manual']}],sessions:[{bookKey:'merged:1',source:'moon',date:'2026-09-01',minutes:30},{bookKey:'merged:1',source:'manual',date:'2026-09-03',minutes:99}],journals:{j:{bookKey:'manual:1',read:true,date:'2026-09-04'}}};
const evolutionContext={state:evolutionState,window:{yuejiVerifiedWeReadActivityDates:b=>b.key==='merged:1'?['2026-09-02']:[]},N:v=>Number(v)||0,noteCountFor:()=>0,dateKey:d=>d.toISOString().slice(0,10),Set,Map,Object,Array,Number,Date};
vm.runInNewContext(`${core.slice(itemStart,itemEnd)};globalThis.moon=buildEvolutionItems('moon');globalThis.weread=buildEvolutionItems('weread');globalThis.all=buildEvolutionItems('all')`,evolutionContext);
assert.equal(evolutionContext.moon.length,1,'Moon view must exclude manual-only and WeRead-only evidence');
assert.equal(evolutionContext.moon[0].date,'2026-09-01');
assert.equal(evolutionContext.moon[0].evidenceSource,'moon');
assert.equal(evolutionContext.weread.length,1,'WeRead view must contain only books with verified reading changes');
assert.equal(evolutionContext.weread.find(x=>x.b.key==='merged:1').date,'2026-09-02');
assert.equal(evolutionContext.weread.find(x=>x.b.key==='merged:1').evidenceSource,'weread');
assert.equal(evolutionContext.weread.some(x=>x.b.key==='weread:trace'),false,'an imported shelf-only book must not create a circle');
assert.equal(evolutionContext.all.filter(x=>x.b.key==='merged:1').length,1,'a merged book must remain one node in the combined view');
assert.match(core,/s\.source!==['"]moon['"]/,'Moon filter must accept only Moon Reader evidence, not every non-WeRead row');
assert.match(core,/evidenceSource/,'each evolution node must carry its own reading-evidence source');
assert.match(core,/data-evidence-source/,'the rendered node must expose its evidence source for styling and inspection');
assert.match(core,/window\.yuejiRenderEvolution=render/,'the corrected evolution renderer must be the shared runtime entry point');
assert.doesNotMatch(features,/h\+Math\.floor\(dataIndex\/levels\.length\)\*16/,'theme depth colors must not drift into a different hue as the book index grows');
assert.match(features,/mergeSelectedBooks/,'book merge manager must remain usable when automatic matching finds no candidate');
assert.match(features,/mergeWeReadBook[\s\S]*mergeMoonBook/,'manual merging must use separate WeRead and Moon Reader selectors');
assert.match(features,/只能合并一条微信读书记录和一条静读天下记录/,'manual merging must reject same-source and already-merged records');
assert.match(features,/function isMergeCandidate/,'confirmed merge must be guarded by a same-book candidate check');
assert.match(features,/at\.length>=2&&at===bt&&\(!aa\|\|!ba\|\|aa===ba\)/,'merge candidates must have the same normalized title and compatible authors');
assert.match(features,/请仅在你确认是同一本书时继续/,'non-exact manual merging must display both records and require explicit confirmation');
assert.match(features,/mergeBooksShortcut/,'library must expose a visible shortcut to the merge manager');
const mergeHandler=features.match(/async function runMerge[\s\S]*?function updateDuplicateBooks/)?.[0]||'';
assert.doesNotMatch(mergeHandler,/renderAll\(/,'confirmed merge must not redraw every page while the settings sheet is open');
assert.doesNotMatch(features,/scrollIntoView/,'the merge shortcut must not move the document scroll position on mobile Firefox');
assert.match(features,/scrollSettingsTo/,'merge navigation must scroll only inside the settings sheet');
const confirmedMerge=app.match(/async function mergeConfirmedBookPair[\s\S]*?return combined}/)?.[0]||'';
assert.match(confirmedMerge,/yuejiPersistMergedWeReadBook/,'confirmed merging must persist only the affected WeRead book');
assert.doesNotMatch(confirmedMerge,/yuejiPersistMergedWeReadState/,'confirmed merging must not clear and rewrite the entire WeRead archive');
assert.match(app,/window\.yuejiRenderEvolution\?\.\(\)/,'state refreshes must use the corrected evolution renderer');
assert.match(extension,/window\.yuejiRenderEvolution\|\|renderEvolution/,'Moon imports must not overwrite the corrected chart with the legacy renderer');
assert.match(extension,/function renderEvolution\(\)\{\s*if\(window\.yuejiRenderEvolution\)return window\.yuejiRenderEvolution\(\)/,'every legacy render call must forward to the corrected renderer once it is available');
assert.doesNotMatch(extension.slice(extension.indexOf('function readingMinutesForBook'),extension.indexOf('function escapeXml')),/s\.source!==['"]weread['"]/,'the startup fallback renderer must not treat every non-WeRead row as Moon evidence');
assert.doesNotMatch(core,/function datesFor\(|function minutesFor\(/,'obsolete source-mixing helpers must not remain as a future fallback path');

console.log('PASS P1 cross-module statistics, manual evidence, duplicate review and export cleanup');
