import assert from 'node:assert/strict';
import fs from 'node:fs';

const app=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
const extension=fs.readFileSync(new URL('../yueji-extension.js',import.meta.url),'utf8');
const features=fs.readFileSync(new URL('../yueji-features.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');

assert.match(app,/function shouldReconcileBooks\(a,b\)\{return sameSourceDuplicate\(a,b\)\}/,'cross-source records must never be merged automatically');
assert.match(extension,/if\(!b\.sources\?\.includes\('weread'\)\)return/,'WeRead title indexes must not absorb Moon-only books');
assert.doesNotMatch(extension,/state\.books\.find\(b=>window\.yuejiCrossSourceMatch/,'WeRead import must not mutate a Moon-only book by title matching');
assert.match(features,/系统不会再自动跨来源合并/,'merge manager must explain that cross-source matching is suggestion-only');
assert.match(features,/已经合并 ·/,'merge manager must reveal previously merged books');
assert.match(features,/data-split-book/,'previously merged books must offer a reversible split action');
assert.match(app,/window\.yuejiSplitMergedBook=splitMergedBook/,'split action must have a state implementation');
assert.match(extension,/window\.yuejiPersistSplitWeReadBook=persistSplitWeReadBook/,'split WeRead records must be persisted incrementally');
const split=app.match(/async function splitMergedBook[\s\S]*?window\.yuejiSplitMergedBook=splitMergedBook/)?.[0]||'';
assert.ok(split.indexOf('await window.yuejiPersistSplitWeReadBook')<split.indexOf('save();return'),'a split must persist its WeRead record before committing local state');
assert.match(split,/catch\(error\)[\s\S]*?try\{save\(\)\}catch\{\}/,'a failed split must persist the rolled-back local state');
assert.match(app,/queueHighlightWrite\(async\(\)=>/,'source-specific highlight remapping must share the IndexedDB write queue');

assert.match(extension,/state\.weRead\.lastReport=/,'a completed sync must save a durable summary');
assert.match(extension,/最近一次完整同步/,'the sync panel must render the latest completion report');
assert.match(extension,/书架更新时间不等于当天阅读/,'circle evidence must be explained without pretending shelf metadata is activity');
assert.match(extension,/function progressEvidenceSummary/,'the completion report must explain why some books did not receive circles');
assert.match(extension,/noCircleTitles/,'the completion report must retain a bounded list of books without circle evidence');
assert.match(features,/if\(scale<\.5\)throw new Error\('LONG_PREVIEW_SVG'\)/,'very long exports must avoid an unreadably downscaled or crash-prone PNG');
assert.match(features,/避免手机生成超大 PNG 时卡死/,'mobile users must be told when a long export uses the safe vector fallback');
assert.match(features,/PREVIEW_CANCELLED/,'closing a long mobile preview must cancel incremental preparation work');
assert.match(features,/i%20===0/,'long exports must yield regularly instead of monopolizing the mobile main thread');
assert.equal((html.match(/20260910-p2-v1/g)||[]).length,4,'all runtime scripts must use the same fresh P2 cache key');

console.log('PASS P2 merge control, sync report, evidence explanation and long-export safeguards');
