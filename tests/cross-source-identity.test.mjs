import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const app=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
const start=app.indexOf('function identityText');
const end=app.indexOf('async function reconcileCrossSourceBooks()',start);
assert.ok(start>=0&&end>start,'cross-source identity helpers must exist');

const state={books:[
  {key:'wr:1',title:'罪与罚（名著名译丛书）',author:'（俄）陀思妥耶夫斯基',sources:['weread'],weReadBookId:'1',progress:22},
  {key:'moon:crime',title:'罪与罚（名著名译丛书）',author:'陀思妥耶夫斯基',sources:['moon'],file:'罪与罚.epub',minutes:53},
  {key:'wr:2',title:'艺术的故事',author:'贡布里希',sources:['weread'],weReadBookId:'2'},
  {key:'moon:art',title:'艺术的故事',author:'',sources:['moon'],file:'艺术的故事.epub',minutes:28}
],sessions:[{date:'2026-09-03',bookKey:'wr:1',source:'weread'},{date:'2026-09-04',bookKey:'moon:crime',source:'moon'}],journals:{'2026-09-03':{bookKey:'wr:1'}},highlights:[{id:'h1',bookKey:'wr:2'}]};
const context={state,Map,Set,String,Number,Object,Array,Math};
vm.runInNewContext(`${app.slice(start,end)};globalThis.result=reconcileCrossSourceBooksInMemory()`,context);
assert.equal(context.result.changed,true);
assert.equal(state.books.length,2,'two cross-source pairs must become two logical books');
assert.deepEqual([...state.books[0].sources].sort(),['moon','weread']);
assert.equal(state.books[0].key,'moon:crime','Moon key remains canonical so local cover references stay valid');
assert.equal(state.sessions[0].bookKey,'moon:crime','sessions must follow the canonical book');
assert.equal(state.journals['2026-09-03'].bookKey,'moon:crime','journals must follow the canonical book');
assert.equal(state.highlights[0].bookKey,'moon:art','legacy in-memory highlights must follow the canonical book');

const cover=fs.readFileSync(new URL('../yueji-book-cover.js',import.meta.url),'utf8');
assert.equal(/renderYearCalendar\s*=/.test(cover),false,'late-loaded cover script must not replace the year renderer');
console.log('PASS cross-source migration and runtime year-calendar ownership');
