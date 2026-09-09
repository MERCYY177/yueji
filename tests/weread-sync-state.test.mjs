import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../yueji-extension.js',import.meta.url),'utf8');
const memory=new Map([['yueji-weread-key','test-skill-key-1234567890']]);
const localStorage={getItem:key=>memory.has(key)?memory.get(key):null,setItem:(key,value)=>memory.set(key,String(value)),removeItem:key=>memory.delete(key)};
const idbRows=new Map();let idbCreated=false;
function idbOperation(tx,action){const req={result:undefined};setTimeout(()=>{try{req.result=action();req.onsuccess?.();setTimeout(()=>tx.oncomplete?.(),0)}catch(error){req.error=error;req.onerror?.();tx.onerror?.()}},0);return req}
const idbDatabase={objectStoreNames:{contains:name=>idbCreated&&name==='snapshots'},createObjectStore(){idbCreated=true;return{}},transaction(){const tx={};tx.objectStore=()=>({put:row=>idbOperation(tx,()=>{idbRows.set(row.id,structuredClone(row));return row.id}),get:id=>idbOperation(tx,()=>structuredClone(idbRows.get(id))),delete:id=>idbOperation(tx,()=>idbRows.delete(id))});return tx},close(){}};
const indexedDB={open(){const req={result:idbDatabase};setTimeout(()=>{if(!idbCreated)req.onupgradeneeded?.();req.onsuccess?.()},0);return req}};
const state={source:'',accent:'#5f8f7b',books:[],sessions:[],highlights:[],journals:{},weRead:{syncPhase:'verify',daily:{},reviewCursors:{},shelfBooks:[],notebooks:[]}};
let requestCount=0,saveCount=0,pauseNext=false,largeNext=false;
const json=value=>new Response(JSON.stringify({data:value}),{status:200,headers:{'content-type':'application/json'}});
const fetch=async(_url,options)=>{
  requestCount++;
  if(pauseNext)return await new Promise((resolve,reject)=>{options.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true})});
  if(largeNext){largeNext=false;return new Response('x'.repeat(2*1024*1024+1),{status:200})}
  const body=JSON.parse(options.body),api=body.api_name;
  if(api==='/_list')return json({apis:[]});
  if(api==='/shelf/sync')return json({books:[{bookId:'book-1',title:'测试书',author:'作者',readUpdateTime:Date.now()/1000}]});
  if(api==='/readdata/detail'){const date=new Date(body.baseTime*1000),stamp=Math.floor(new Date(date.getFullYear(),date.getMonth(),2).getTime()/1000);return json({dailyReadTimes:{[stamp]:600}})}
  if(api==='/book/getprogress')return json({book:{bookId:'book-1',progress:35,isStartReading:1,recordReadingTime:600}});
  if(api==='/user/notebooks')return json({books:[{book:{bookId:'book-1',title:'测试书',author:'作者'},readingProgress:35,sort:10}],hasMore:false});
  if(api==='/book/bookmarklist')return json({updated:[{bookmarkId:'mark-1',markText:'划线内容',createTime:Date.now()/1000}]});
  if(api==='/review/list/mine')return json({reviews:[{review:{reviewId:'review-1',content:'想法内容',abstract:'摘录',createTime:Date.now()/1000}}],hasMore:false});
  throw new Error(`unexpected api ${api}`);
};
const pad=value=>String(value).padStart(2,'0');
const dateKey=date=>`${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`;
const context={console:{warn(){},error(){}},window:null,document:{readyState:'loading',addEventListener(){},getElementById(){return null},querySelectorAll(){return[]}},localStorage,indexedDB,navigator:{onLine:true,storage:{estimate:async()=>({usage:1024,quota:100*1024*1024})}},state,save(){saveCount++;memory.set('yueji-archive-v1',JSON.stringify(state))},fetch,Response,Request,Headers,Blob,TextDecoder,TextEncoder,AbortController,DOMException,setTimeout,clearTimeout,structuredClone,URL,Date,Math,JSON,Object,Array,Map,Set,Promise,Number,String,Boolean,RegExp,Error,globalThis:null,pad,dateKey,todayKey:dateKey(new Date()),palette:['#5f8f7b'],esc:value=>String(value),toast(){},page:'home',STORAGE:'yueji-archive-v1'};
context.window=context;context.globalThis=context;
vm.runInNewContext(source,context,{filename:'yueji-extension.js'});
const api=context.__yuejiWeReadDiagnostics;
assert.ok(api,'diagnostic API should be installed');
api.ensureStateShape();

async function oneStep(expectedPhase){const before=requestCount;await api.syncWeRead({mode:'continue',manual:false});assert.equal(requestCount-before,1,`phase ${expectedPhase} must issue exactly one request`)}

await oneStep('verify');assert.equal(state.weRead.syncPhase,'shelf');
await oneStep('shelf');assert.equal(state.weRead.syncPhase,'stats');assert.equal(state.books.length,1);
let guard=0;while(state.weRead.syncPhase==='stats'&&guard++<12)await oneStep('stats');
assert.equal(state.weRead.syncPhase,'progress');
await oneStep('progress');assert.equal(state.weRead.syncPhase,'notebooks');assert.equal(state.books[0].progress,35);
await oneStep('notebooks');assert.equal(state.weRead.syncPhase,'bookmarks');
await oneStep('bookmarks');assert.equal(state.weRead.syncPhase,'reviews');
await oneStep('reviews');assert.equal(state.weRead.syncPhase,'complete');assert.equal(state.highlights.length,2);
assert.ok(saveCount>0,'completed steps must be committed');

state.weRead.syncPhase='stats';state.weRead.statsDone=true;
await oneStep('repeat-current-month');
const aggregate=state.sessions.filter(row=>row.source==='weread'&&row.aggregate);
assert.equal(new Set(aggregate.map(row=>row.id)).size,aggregate.length,'repeated month must not duplicate aggregate sessions');

state.weRead.syncPhase='verify';pauseNext=true;
const pending=api.syncWeRead({mode:'continue',manual:false});
await new Promise(resolve=>setTimeout(resolve,0));
api.stopActiveSync(false);
await pending;
assert.equal(state.weRead.syncState,'paused','aborted request must finish in paused state');

pauseNext=false;largeNext=true;state.weRead.syncPhase='verify';
await api.syncWeRead({mode:'continue',manual:false});
assert.equal(state.weRead.syncState,'error','oversized client response must stop with an error state');

state.books[0].progress=77;
await api.stageSyncSnapshot();
state.books[0].progress=1;
const recovered=await api.recoverSyncSnapshot();
assert.equal(recovered,true,'pending IndexedDB snapshot must be detected');
assert.equal(state.books[0].progress,77,'pending IndexedDB snapshot must restore book changes');
assert.equal(idbRows.has('pending'),false,'committed recovery snapshot must be removed');

memory.set('yueji-archive-v1','x'.repeat(4*1024*1024+1));state.weRead.syncPhase='verify';
const beforeCapacity=requestCount;
await api.syncWeRead({mode:'continue',manual:false});
assert.equal(requestCount,beforeCapacity,'capacity failure must stop before the network request');

console.log('PASS state machine, deduplication, persistence, pause, response cap and capacity guard');
