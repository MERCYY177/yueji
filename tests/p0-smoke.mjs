import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';
import { webcrypto } from 'node:crypto';
import { indexedDB, IDBKeyRange } from 'fake-indexeddb';

const VERSION='20260909-p0-final1';
const ORDER=[
  'yueji-p0-sync-guard-v2.js',
  'yueji-p0-resume.js',
  'yueji-p0-progress-first.js',
  'yueji-p0-failures.js',
  'yueji-p0-inflight.js',
  'yueji-p0-chain-test.js',
  'yueji-p0-runtime-audit.js',
  'yueji-p0-auto-lock.js'
];

class MemoryStorage {
  constructor(){this.map=new Map()}
  getItem(k){return this.map.has(String(k))?this.map.get(String(k)):null}
  setItem(k,v){this.map.set(String(k),String(v))}
  removeItem(k){this.map.delete(String(k))}
  clear(){this.map.clear()}
}

const statusEl={textContent:'',innerHTML:'',insertAdjacentHTML(_where,html){this.innerHTML+=html}};
const scripts=[];
const document={
  scripts,
  readyState:'complete',
  addEventListener(){},
  removeEventListener(){},
  querySelectorAll(){return[]},
  getElementById(id){return id==='wereadStatus'?statusEl:null}
};

const localStorage=new MemoryStorage();
const state={
  weRead:{
    lastSync:Date.now(),
    syncState:'running',
    progressCursor:0,
    progressTotal:1,
    progressDone:false,
    notesCursor:0,
    notebooksTotal:0,
    notesDone:true,
    reviewCursors:{},
    resumeQueueVersion:1,
    autoRetryBlocked:true
  },
  books:[{key:'wr:b1',weReadBookId:'b1',title:'Mock Book',author:'Mock',sources:['weread'],progress:0,status:'unread'}],
  sessions:[],
  highlights:[]
};
let saveCount=0;

function shortTimer(fn,ms,...args){
  const handle=setTimeout(fn,ms,...args);
  if(Number(ms)>=1000)handle.unref?.();
  return handle;
}
function shortInterval(fn,ms,...args){const handle=setInterval(fn,ms,...args);handle.unref?.();return handle}
function dateKey(d){const x=new Date(d);return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`}

const baseFetch=async()=>new Response(JSON.stringify({
  data:{book:{progress:42,isStartReading:true,recordReadingTime:120,updateTime:1710000000}}
}),{status:200,headers:{'content-type':'application/json'}});

const sandbox={
  console,
  state,
  document,
  localStorage,
  indexedDB,
  IDBKeyRange,
  performance,
  crypto:webcrypto,
  fetch:baseFetch,
  Response,
  Request,
  Headers,
  URL,
  AbortController,
  setTimeout:shortTimer,
  clearTimeout,
  setInterval:shortInterval,
  clearInterval,
  queueMicrotask,
  location:{href:'https://example.test/'},
  navigator:{},
  dateKey,
  todayKey:'2026-09-09',
  palette:['#777'],
  save(){saveCount++},
  renderAll(){},
  renderToday(){},
  renderCalendar(){},
  renderBookOptions(){},
  toast(){},
  addEventListener(){},
  removeEventListener(){},
  __yuejiP0AssetVersion:VERSION,
  __yuejiP0AutoGate:{previousBlocked:false,startedAt:Date.now()},
  __yuejiWeReadSyncing:false,
  __yuejiArchiveBusy:false
};
sandbox.window=sandbox;
sandbox.globalThis=sandbox;
const context=vm.createContext(sandbox);

async function seedResumeQueue(){
  await new Promise((resolve,reject)=>{
    const req=indexedDB.open('yueji-weread-resume-v1',1);
    req.onupgradeneeded=()=>{
      const db=req.result;
      if(!db.objectStoreNames.contains('meta'))db.createObjectStore('meta',{keyPath:'key'});
      if(!db.objectStoreNames.contains('progressQueue'))db.createObjectStore('progressQueue',{keyPath:'i'});
      if(!db.objectStoreNames.contains('notebookQueue')){
        const s=db.createObjectStore('notebookQueue',{keyPath:'bookId'});
        s.createIndex('order','order',{unique:false});
      }
    };
    req.onerror=()=>reject(req.error);
    req.onsuccess=()=>{
      const db=req.result;
      const tx=db.transaction(['meta','progressQueue'],'readwrite');
      tx.objectStore('meta').put({key:'queue',version:1,baseSyncAt:state.weRead.lastSync,notebookBuildComplete:true,notebookOrder:0,notebookNextSort:null});
      tx.objectStore('progressQueue').put({i:0,bookId:'b1',title:'Mock Book',author:'Mock'});
      tx.oncomplete=()=>{db.close();resolve()};
      tx.onerror=()=>reject(tx.error);
    };
  });
}

await seedResumeQueue();

const fix=await fs.readFile('yueji-fix.js','utf8');
assert.ok(fix.includes(`const ASSET_VERSION='${VERSION}'`),'yueji-fix.js must expose the expected asset version');
let previous=-1;
for(const file of ORDER){
  const pos=fix.indexOf(file);
  assert.ok(pos>previous,`loader order is wrong around ${file}`);
  previous=pos;
}

for(const file of ORDER){
  scripts.push({src:`https://example.test/${file}?v=${VERSION}`});
  const source=await fs.readFile(file,'utf8');
  vm.runInContext(source,context,{filename:file});
}

assert.equal(state.weRead.syncState,'paused','stale running state should be normalized to paused by the guard');
assert.equal(typeof sandbox.yuejiP0ResumeSync,'function');
assert.equal(typeof sandbox.yuejiP0ProgressFirst,'function');
assert.equal(typeof sandbox.yuejiP0FailureCount,'function');
assert.equal(typeof sandbox.yuejiP0InflightInfo,'function');
assert.equal(typeof sandbox.yuejiP0RuntimeAudit,'function');
assert.equal(typeof sandbox.yuejiP0RunChainStress,'function');

let report=sandbox.yuejiP0RuntimeAudit();
assert.equal(report.healthy,true,`runtime audit should be healthy: ${report.errors?.join('; ')}`);
assert.equal(report.assetVersion,VERSION);

localStorage.setItem('yueji-weread-key','test-key');
const priority=await sandbox.yuejiP0ProgressFirst();
assert.equal(priority.processed,1,'priority progress should advance exactly one queue item');
assert.equal(state.books[0].progress,42,'priority progress should merge the API progress');
assert.equal(state.weRead.progressDone,true,'single-item progress queue should complete');
assert.equal(state.weRead.progressCursor,0,'completed progress queue should reset cursor');
assert.ok(saveCount>0,'state changes should be checkpointed');

const inflight=await sandbox.yuejiP0InflightInfo();
assert.ok(inflight.count>=1,'successful priority request should pass through the in-flight safety wrapper');

scripts.push({src:`https://example.test/yueji-p0-resume.js?v=${VERSION}`});
report=sandbox.yuejiP0RuntimeAudit();
assert.equal(report.healthy,false,'runtime audit should reject duplicate P0 scripts');
scripts.pop();
state.weRead.autoRetryBlocked=false;
report=sandbox.yuejiP0RuntimeAudit();
assert.equal(report.healthy,true,'runtime audit should recover after duplicate script is removed');

localStorage.removeItem('yueji-weread-key');
await sandbox.yuejiP0ResumeSync();
assert.match(`${statusEl.textContent} ${statusEl.innerHTML}`,/Skill Key/,'the fully wrapped resume chain should execute and reach the guarded no-key exit');

console.log(JSON.stringify({
  ok:true,
  assetVersion:VERSION,
  scripts:ORDER.length,
  priorityProgress:state.books[0].progress,
  inflightCount:inflight.count,
  runtimeHealthy:report.healthy,
  saveCount
},null,2));
