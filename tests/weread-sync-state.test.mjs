import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../yueji-extension.js',import.meta.url),'utf8');
const memory=new Map([['yueji-weread-key','test-skill-key-1234567890']]);
const localStorage={getItem:key=>memory.has(key)?memory.get(key):null,setItem:(key,value)=>memory.set(key,String(value)),removeItem:key=>memory.delete(key)};
const idbRows=new Map();let idbCreated=false,clearCount=0;
function idbOperation(tx,action){const req={result:undefined};setTimeout(()=>{try{req.result=action();req.onsuccess?.();setTimeout(()=>tx.oncomplete?.(),0)}catch(error){req.error=error;req.onerror?.();tx.onerror?.()}},0);return req}
const idbDatabase={objectStoreNames:{contains:name=>idbCreated&&name==='records'},createObjectStore(){idbCreated=true;return{}},deleteObjectStore(){},transaction(){const tx={};tx.objectStore=()=>({put:row=>idbOperation(tx,()=>{idbRows.set(row.id,structuredClone(row));return row.id}),get:id=>idbOperation(tx,()=>structuredClone(idbRows.get(id))),getAll:()=>idbOperation(tx,()=>structuredClone([...idbRows.values()])),delete:id=>idbOperation(tx,()=>idbRows.delete(id)),clear:()=>idbOperation(tx,()=>{clearCount++;idbRows.clear()})});return tx},close(){}};
const indexedDB={open(){const req={result:idbDatabase};setTimeout(()=>{if(!idbCreated)req.onupgradeneeded?.();req.onsuccess?.()},0);return req}};
const state={source:'',accent:'#5f8f7b',books:[],sessions:[],highlights:[],journals:{},weRead:{syncPhase:'verify',daily:{},reviewCursors:{},shelfBooks:[],notebooks:[]}};
let requestCount=0,saveCount=0,pauseNext=false,largeNext=false,mediumNext=false;
const detailUpdateTime=Math.floor(new Date().setHours(8,0,0,0)/1000);
const json=value=>new Response(JSON.stringify({data:value}),{status:200,headers:{'content-type':'application/json'}});
const fetch=async(_url,options)=>{
  requestCount++;
  if(pauseNext)return await new Promise((resolve,reject)=>{options.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true})});
  if(largeNext){largeNext=false;return new Response('x'.repeat(2*1024*1024+1),{status:200})}
  if(mediumNext){mediumNext=false;return new Response(JSON.stringify({data:{padding:'x'.repeat(300*1024)}}),{status:200})}
  const body=JSON.parse(options.body),api=body.api_name;
  if(api==='/_list')return json({apis:[]});
  if(api==='/shelf/sync')return json({books:[{bookId:'book-1',title:'测试书',author:'作者',readUpdateTime:Date.now()/1000}]});
  if(api==='/readdata/detail'){const date=new Date(body.baseTime*1000),stamp=Math.floor(new Date(date.getFullYear(),date.getMonth(),2).getTime()/1000);return json({dailyReadTimes:{[stamp]:600}})}
  if(api==='/book/getprogress')return json({book:{bookId:'book-1',progress:35,isStartReading:1,recordReadingTime:600,updateTime:detailUpdateTime}});
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
const savesBeforeSync=saveCount;

async function oneStep(expectedPhase){const before=requestCount;await api.syncWeRead({mode:'continue',manual:false});assert.equal(requestCount-before,1,`phase ${expectedPhase} must issue exactly one request`)}

await oneStep('verify');assert.equal(state.weRead.syncPhase,'shelf');
await oneStep('shelf');assert.equal(state.weRead.syncPhase,'stats');assert.equal(state.books.length,1);
assert.equal(state.books[0].weReadSnapshots?.length||0,0,'shelf readUpdateTime must never create a dated reading snapshot');
let guard=0;while(state.weRead.syncPhase==='stats'&&guard++<12)await oneStep('stats');
assert.equal(state.weRead.syncPhase,'progress');
await oneStep('progress');assert.equal(state.weRead.syncPhase,'notebooks');assert.equal(state.books[0].progress,35);
assert.equal(state.books[0].weReadSnapshots.length,1,'first detailed progress with a valid update time must create one snapshot');
assert.equal(state.books[0].weReadSnapshots[0].date,dateKey(new Date(detailUpdateTime*1000)),'first detailed activity must use the detail timestamp date');
assert.equal(state.books[0].weReadSnapshots[0].activity,true,'started detailed progress must be accepted as first verified activity');
assert.equal(state.books[0].weReadSnapshots[0].evidence,'detail-first','first activity must retain its evidence type');
state.books[0].weReadSnapshots=[{date:context.todayKey,progress:35,seconds:600,activity:false}];
api.mergeBookFromWeRead({bookId:'book-1',title:'测试书',author:'作者'},{book:{progress:35,isStartReading:1,recordReadingTime:600,updateTime:detailUpdateTime}});
assert.equal(state.books[0].weReadSnapshots.length,1,'a legacy ambiguous baseline must be replaced instead of leaving a duplicate circle');
assert.equal(state.books[0].weReadSnapshots[0].activity,true,'a legacy baseline must upgrade when detailed timestamp evidence becomes available');
await oneStep('notebooks');assert.equal(state.weRead.syncPhase,'bookmarks');
await oneStep('bookmarks');assert.equal(state.weRead.syncPhase,'reviews');
await oneStep('reviews');assert.equal(state.weRead.syncPhase,'complete');assert.equal(state.highlights.length,2);
assert.equal(saveCount,savesBeforeSync,'network sync must not serialize the full archive into localStorage');

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

mediumNext=true;state.weRead.syncPhase='verify';
await api.syncWeRead({mode:'continue',manual:false});
assert.equal(state.weRead.syncState,'error','large JSON must stop safely when a worker is unavailable');

state.books[0].progress=77;
await api.persistSyncIncrement({books:[state.books[0]]});
state.books[0].progress=1;
const recovered=await api.recoverSyncSnapshot();
assert.equal(recovered,true,'IndexedDB sync records must be detected');
assert.equal(state.books[0].progress,77,'IndexedDB sync records must restore book changes');
assert.equal(idbRows.has('book:book-1'),true,'incremental book record must remain durable');

state.books[0].progress=82;state.books[0].progressSource='manual';
api.mergeBookFromWeRead({bookId:'book-1',title:'测试书',author:'作者'},{book:{progress:12,isStartReading:1}});
assert.equal(state.books[0].progress,82,'manual progress must not be overwritten by WeRead progress');
assert.equal(state.books[0].weReadProgress,12,'WeRead progress should still be retained as source data');

const canonical={...state.books[0],key:'moon:test-book',sources:['moon','weread'],progress:82};
state.books=[canonical];
context.yuejiRefreshWeReadBookIndexes();
api.mergeBookFromWeRead({bookId:'book-1',title:'测试书',author:'作者'},{book:{progress:44,isStartReading:1}});
assert.equal(state.books.length,1,'continuing sync after a cross-source merge must not recreate a WeRead duplicate');
assert.equal(state.books[0].key,'moon:test-book','sync index must point to the merged canonical book without requiring a reload');
assert.equal(state.books[0].weReadProgress,44,'continued sync must update the merged canonical book');
const clearsBeforeTargetedMerge=clearCount;
await context.yuejiPersistMergedWeReadBook({book:state.books[0],removedWeReadIds:['book-1','obsolete-book'],fromKey:'wr:old-book-1',toKey:'moon:test-book'});
assert.equal(clearCount,clearsBeforeTargetedMerge,'targeted book merge must not clear the complete WeRead database');
assert.equal(idbRows.get('book:book-1').value.key,'moon:test-book','targeted merge must persist the canonical book key');

// A pre-merge WeRead cache must not overwrite the Moon canonical key or revive a duplicate after reload.
idbRows.set('book:book-1',{id:'book:book-1',kind:'book',value:{key:'wr:old-book-1',weReadBookId:'book-1',title:'测试书',author:'作者',sources:['weread'],weReadProgress:45,weReadSnapshots:[{date:'2026-09-10',progress:45,activity:true}]}});
idbRows.set('session:weread-day:old',{id:'session:weread-day:old',kind:'session',value:{id:'weread-day:old',date:'2026-09-10',bookKey:'wr:old-book-1',source:'weread',minutes:10}});
await api.recoverSyncSnapshot();
assert.equal(state.books.length,1,'cached pre-merge WeRead row must not revive a second logical book');
assert.equal(state.books[0].key,'moon:test-book','cache recovery must preserve the Moon canonical key');
assert.deepEqual([...state.books[0].sources].sort(),['moon','weread'],'cache recovery must preserve both source memberships');
assert.equal(state.sessions.find(row=>row.id==='weread-day:old').bookKey,'moon:test-book','cached WeRead evidence must be remapped to the canonical book');
await context.yuejiPersistMergedWeReadState();
assert.equal([...idbRows.values()].filter(row=>row.kind==='book').length,1,'full merged persistence must remove stale book rows');
assert.equal(idbRows.get('book:book-1').value.key,'moon:test-book','the durable WeRead row must store the canonical key');

state.hiddenWeReadBookIds=['book-1'];state.books=[];
await api.recoverSyncSnapshot();
assert.equal(state.books.some(book=>book.weReadBookId==='book-1'),false,'hidden WeRead books must not reappear during IndexedDB recovery');
state.hiddenWeReadBookIds=[];
const bulkBooks=Array.from({length:500},(_,i)=>({key:`wr:bulk-${i}`,weReadBookId:`bulk-${i}`,title:`压力书籍 ${i}`,sources:['weread']}));
const bulkSessions=Array.from({length:5000},(_,i)=>({id:`weread-day:stress-${i}`,date:`2026-${pad(i%12+1)}-${pad(i%28+1)}`,bookKey:'',minutes:1,seconds:60,source:'weread',aggregate:true}));
const savesBeforeBulk=saveCount;
await api.persistSyncIncrement({books:bulkBooks,sessions:bulkSessions});
await new Promise(resolve=>setTimeout(resolve,25));
assert.equal(saveCount,savesBeforeBulk,'large incremental writes must not invoke full localStorage serialization');
assert.equal([...idbRows.values()].filter(row=>row.kind==='book').length,501,'500 additional books must be stored as independent records');
assert.equal([...idbRows.values()].filter(row=>row.kind==='session'&&String(row.id).startsWith('session:weread-day:stress-')).length,5000,'5000 sessions must be stored as independent records');

await api.deleteSyncBook('book-1');
await new Promise(resolve=>setTimeout(resolve,20));
assert.equal(idbRows.has('book:book-1'),false,'deleting a WeRead book must remove its independent IndexedDB record');
assert.equal((idbRows.get('shelf')?.value||[]).some(book=>String(book.bookId)==='book-1'),false,'deleting a WeRead book must also remove it from the cached shelf');
memory.set('yueji-archive-v1','x'.repeat(4*1024*1024+1));state.weRead.syncPhase='verify';
const beforeCapacity=requestCount;
await api.syncWeRead({mode:'continue',manual:false});
assert.equal(requestCount,beforeCapacity,'capacity failure must stop before the network request');

console.log('PASS state machine, deduplication, incremental IndexedDB, pause, response cap and capacity guard');
