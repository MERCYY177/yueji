import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const app=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
const extension=fs.readFileSync(new URL('../yueji-extension.js',import.meta.url),'utf8');
const features=fs.readFileSync(new URL('../yueji-features.js',import.meta.url),'utf8');

const match=app.match(/function effectiveSessions\([\s\S]*?return out\}/);
assert.ok(match,'effective session rule must exist');
const context={state:{sessions:[]},Map};
vm.runInNewContext(`${match[0]};globalThis.effectiveSessions=effectiveSessions`,context);
const rows=[
  {date:'2026-09-01',source:'weread',aggregate:true,minutes:40},
  {date:'2026-09-01',source:'weread',bookKey:'wr:1',minutes:12},
  {date:'2026-09-01',source:'moon',bookKey:'moon:1',minutes:15},
  {date:'2026-09-02',source:'weread',bookKey:'wr:1',minutes:10},
];
const effective=context.effectiveSessions(rows);
assert.equal(effective.reduce((sum,row)=>sum+row.minutes,0),65,'WeRead daily total must replace same-day per-book WeRead time without removing Moon time');
assert.equal(effective.some(row=>row.date==='2026-09-01'&&row.bookKey==='wr:1'),false,'same-day WeRead detail must not be double counted');
assert.equal(effective.some(row=>row.date==='2026-09-02'&&row.bookKey==='wr:1'),true,'per-book WeRead time remains valid when no daily total exists');

assert.match(app,/IntersectionObserver/,'remote covers must be lazy-loaded near the viewport');
assert.match(app,/coverFetchQueue/,'remote covers must use a throttled queue');
assert.match(app,/6\*60\*60\*1000/,'failed remote covers must have a retry cooldown');
assert.match(app,/compactRemoteCover/,'remote covers must be compressed before caching');
assert.match(extension,/progressSource!==['"]manual['"]/,'manual progress must win over WeRead progress');
assert.match(extension,/hidden\.has\(String\(incoming\.weReadBookId\)\)/,'hidden WeRead books must be filtered during recovery');
assert.match(extension,/weReadSnapshots/,'WeRead progress snapshots must be retained for future activity comparisons');
assert.match(extension,/firstDetailedActivity=!hasVerifiedSnapshot&&started&&!!detailDate/,'first detailed progress with a valid timestamp must create verified activity');
assert.match(extension,/weReadShelfReadUpdate = safeDate\(raw\.readUpdateTime\)/,'shelf metadata must be stored separately from detailed activity evidence');
assert.doesNotMatch(extension,/progress\?\.book\?\.updateTime \|\| raw\.readUpdateTime/,'detail and shelf timestamps must never be collapsed into one activity timestamp');
assert.match(extension,/wereadProgressRefreshBtn/,'users must be able to restart only the per-book circle evidence stage');
assert.match(extension,/微信圆圈/,'sync status must expose how many books currently have verified circles');
assert.match(extension,/n\(b\.readUpdateTime\)-n\(a\.readUpdateTime\)/,'circle evidence must query the most recently read books first');
assert.match(extension,/最近读取：《/,'circle sync must show which book was queried and why it did or did not create a circle');
assert.match(extension,/return \{done,completed:start\+completed,total:started\.length,changedBooks\}/,'the sorted progress batch must return the exact books it changed');
assert.match(extension,/changedBooks=progress\.changedBooks\|\|\[\]/,'the checkpoint must persist the sorted book actually queried, not the original shelf index');
assert.match(extension,/phase===['"]progress['"]&&page===['"]analytics['"]\)\{renderAnalytics\(\);window\.yuejiRenderEvolution/,'a circle checkpoint must refresh only analytics instead of redrawing the entire application');
assert.match(extension,/yuejiPersistMergedWeReadBook=persistMergedWeReadBook/,'confirmed merging must use targeted WeRead persistence');
const mergePersistence=extension.match(/async function persistMergedWeReadBook[\s\S]*?\n  async function replaceSyncArchive/)?.[0]||'';
assert.ok(mergePersistence,'targeted merge persistence must be independently inspectable');
assert.doesNotMatch(mergePersistence,/\.clear\(/,'merging one book must never clear the complete WeRead database');
assert.match(features,/yuejiDeleteWeReadSyncBook/,'full deletion must remove the WeRead IndexedDB record');
assert.match(features,/疑似重复书籍组/,'diagnostics must report possible duplicate books');
assert.match(features,/孤立阅读记录/,'diagnostics must report orphan reading sessions');
assert.match(app,/无法判断哪本读得最多/,'monthly report must explain unavailable per-book WeRead attribution');
assert.match(app,/这不是逐书分钟排行/,'progress activity must be labelled separately from exact per-book minutes');
assert.match(features,/assets\/fonts\/lxgw-neo-zhisong\.woff/,'export picker must include LXGW Neo ZhiSong');
assert.match(features,/assets\/fonts\/clear-han-serif\.woff/,'export picker must include Clear Han Serif');
assert.match(features,/assets\/fonts\/huiwen-mincho\.woff/,'export picker must include Huiwen Mincho');
assert.match(features,/字体仅用于导出的图片/,'font choice must be scoped to image export');
assert.match(features,/@font-face/,'selected export font must be embedded in the generated image');
assert.match(features,/cache:'force-cache'/,'large font files must use browser cache');
for(const file of ['lxgw-neo-zhisong.woff','clear-han-serif.woff','huiwen-mincho.woff']){
  const size=fs.statSync(new URL(`../assets/fonts/${file}`,import.meta.url)).size;
  assert.ok(size>100_000&&size<16*1024*1024,`${file} must be a valid bounded webfont asset`);
}
const style=fs.readFileSync(new URL('../style.css',import.meta.url),'utf8');
assert.match(style,/\.sheet>\.sheet-head\{position:sticky;top:-12px/,'sheet close controls must stay reachable while the mobile sheet scrolls');

console.log('PASS P1 cover caching, source priority, calendar totals, delete recovery and export font rules');
