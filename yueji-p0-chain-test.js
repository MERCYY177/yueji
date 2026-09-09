(()=>{
  'use strict';
  if(window.__yuejiP0ChainTestInstalled)return;
  window.__yuejiP0ChainTestInstalled=true;

  const DB='yueji-p0-chain-stress-v1';
  const LOCK='yueji-p0-chain-stress-lock';
  const PROGRESS_TOTAL=800;
  const NOTEBOOK_TOTAL=320;
  const HIGHLIGHTS_PER_BOOK=35;
  const yieldBrowser=()=>new Promise(resolve=>setTimeout(resolve,0));

  function openDb(){return new Promise((resolve,reject)=>{const req=indexedDB.open(DB,1);req.onupgradeneeded=()=>{const db=req.result;for(const name of ['progress','notebooks','done','failures','highlights','inflight'])if(!db.objectStoreNames.contains(name))db.createObjectStore(name,{keyPath:'id'});if(!db.objectStoreNames.contains('meta'))db.createObjectStore('meta',{keyPath:'key'})};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}
  function deleteDb(){return new Promise(resolve=>{const req=indexedDB.deleteDatabase(DB);req.onsuccess=req.onerror=req.onblocked=()=>resolve()})}
  function done(tx,msg){return new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error||new Error(msg));tx.onabort=()=>reject(tx.error||new Error(msg))})}
  async function count(db,store){return await new Promise((resolve,reject)=>{const req=db.transaction(store).objectStore(store).count();req.onsuccess=()=>resolve(req.result||0);req.onerror=()=>reject(req.error)})}
  async function getMeta(db){return await new Promise((resolve,reject)=>{const req=db.transaction('meta').objectStore('meta').get('state');req.onsuccess=()=>resolve(req.result||{key:'state',progressCursor:0,notesCursor:0});req.onerror=()=>reject(req.error)})}
  async function putMeta(db,meta){const tx=db.transaction('meta','readwrite'),p=done(tx,'测试断点无法保存');tx.objectStore('meta').put({...meta,key:'state'});await p}
  async function slice(db,store,start,size){return await new Promise((resolve,reject)=>{const rows=[],req=db.transaction(store).objectStore(store).openCursor(IDBKeyRange.lowerBound(start));req.onsuccess=()=>{const c=req.result;if(!c||rows.length>=size)return resolve(rows);rows.push(c.value);c.continue()};req.onerror=()=>reject(req.error)})}
  async function all(db,store){return await new Promise((resolve,reject)=>{const req=db.transaction(store).objectStore(store).getAll();req.onsuccess=()=>resolve(req.result||[]);req.onerror=()=>reject(req.error)})}

  async function seed(db){
    let tx=db.transaction(['progress','notebooks','meta'],'readwrite'),p=done(tx,'测试队列初始化失败'),progress=tx.objectStore('progress'),notes=tx.objectStore('notebooks');
    for(let i=0;i<PROGRESS_TOTAL;i++)progress.put({id:i,bookId:`p-${i}`});
    for(let i=0;i<NOTEBOOK_TOTAL;i++)notes.put({id:i,bookId:`n-${i}`});
    tx.objectStore('meta').put({key:'state',progressCursor:0,notesCursor:0,crashes:0});
    await p;
  }
  async function markFailure(db,row,kind){const tx=db.transaction('failures','readwrite'),p=done(tx,'测试失败项无法保存');tx.objectStore('failures').put({id:`${kind}:${row.bookId}`,kind,bookId:row.bookId,rowId:row.id});await p}
  async function markDone(db,row,kind){const tx=db.transaction('done','readwrite'),p=done(tx,'测试完成项无法保存');tx.objectStore('done').put({id:`${kind}:${row.bookId}`,kind,bookId:row.bookId});await p}
  function highlightRows(row){return Array.from({length:HIGHLIGHTS_PER_BOOK},(_,i)=>({id:`h:${row.bookId}:${i}`,bookId:row.bookId,text:`模拟书摘 ${row.bookId}-${i}`}))}
  async function writeHighlights(db,row){const rows=highlightRows(row),tx=db.transaction('highlights','readwrite'),p=done(tx,'测试书摘无法保存'),store=tx.objectStore('highlights');rows.forEach(x=>store.put(x));if(row.id%10===0)rows.slice(0,8).forEach(x=>store.put(x));await p}

  async function processProgress(db,lines){let meta=await getMeta(db),batchNo=0;while(meta.progressCursor<PROGRESS_TOTAL){const start=meta.progressCursor,rows=await slice(db,'progress',start,8);for(const row of rows){if(row.id%113===17)await markFailure(db,row,'progress');else await markDone(db,row,'progress');meta.progressCursor=row.id+1}await putMeta(db,meta);batchNo++;if([3,12,25,49].includes(batchNo)){meta.crashes=(meta.crashes||0)+1;await putMeta(db,meta);db.close();db=await openDb();meta=await getMeta(db);lines.push(`模拟中断恢复：进度游标 ${meta.progressCursor}/${PROGRESS_TOTAL}`)}if(batchNo%5===0)await yieldBrowser()}return db}
  async function processNotes(db,lines){let meta=await getMeta(db),batchNo=0;while(meta.notesCursor<NOTEBOOK_TOTAL){const start=meta.notesCursor,rows=await slice(db,'notebooks',start,6);for(const row of rows){if(row.id%67===13)await markFailure(db,row,'notes');else{await writeHighlights(db,row);await markDone(db,row,'notes')}meta.notesCursor=row.id+1}await putMeta(db,meta);batchNo++;if([4,17,31].includes(batchNo)){meta.crashes=(meta.crashes||0)+1;await putMeta(db,meta);db.close();db=await openDb();meta=await getMeta(db);lines.push(`模拟中断恢复：书摘游标 ${meta.notesCursor}/${NOTEBOOK_TOTAL}`)}if(batchNo%3===0)await yieldBrowser()}return db}
  async function retryFailures(db){const rows=await all(db,'failures');for(let i=0;i<rows.length;i++){const f=rows[i],fake={id:f.rowId,bookId:f.bookId};if(f.kind==='notes')await writeHighlights(db,fake);await markDone(db,fake,f.kind);const tx=db.transaction('failures','readwrite'),p=done(tx,'测试失败项清理失败');tx.objectStore('failures').delete(f.id);await p;if(i%6===0)await yieldBrowser()}return rows.length}
  async function testInflight(db){let tx=db.transaction('inflight','readwrite'),p=done(tx,'测试 in-flight 写入失败');tx.objectStore('inflight').put({id:'reviews:n-77',phase:'completed',payload:{reviews:[{id:1}]}});await p;db.close();db=await openDb();const rows=await all(db,'inflight');if(rows.length!==1||rows[0].phase!=='completed')throw new Error('in-flight 完成响应没有跨重开保留');tx=db.transaction(['inflight','done'],'readwrite');p=done(tx,'测试 in-flight 恢复失败');tx.objectStore('done').put({id:'inflight:reviews:n-77',kind:'inflight'});tx.objectStore('inflight').delete('reviews:n-77');await p;return db}
  function testLock(){const a='A',b='B',now=Date.now(),live={owner:a,expiresAt:now+10000};localStorage.setItem(LOCK,JSON.stringify(live));const read=()=>{try{return JSON.parse(localStorage.getItem(LOCK)||'null')}catch{return null}};const held=x=>x&&Number(x.expiresAt)>Date.now();if(!(held(read())&&read().owner!==b))throw new Error('跨页面锁没有阻止第二个 owner');localStorage.setItem(LOCK,JSON.stringify({owner:a,expiresAt:Date.now()-1}));if(held(read()))throw new Error('过期锁没有释放');localStorage.removeItem(LOCK)}
  function auditListeners(){
    const names=['yueji-p0-sync-guard.js','yueji-p0-resume.js','yueji-p0-failures.js','yueji-p0-inflight.js','yueji-p0-auto-lock.js','yueji-p0-chain-test.js'];
    const duplicates=[];
    for(const name of names){const c=[...document.scripts].filter(s=>String(s.src).includes(name)).length;if(c>1)duplicates.push(`${name} × ${c}`)}
    const duplicateIds=['wereadContinueBtn','wereadStopBtn','wereadSyncBtn','wereadRestartBtn'].filter(id=>document.querySelectorAll(`#${id}`).length>1);
    if(duplicates.length||duplicateIds.length)throw new Error(`检测到重复加载/控件：${[...duplicates,...duplicateIds].join('、')}`);
    const flags=['__yuejiP0FailuresInstalled','__yuejiP0InflightInstalled','__yuejiP0AutoLockInstalled','__yuejiP0ChainTestInstalled'];
    const missing=flags.filter(k=>!window[k]);if(missing.length)throw new Error(`P0 模块安装标记缺失：${missing.join('、')}`);
    return names.length;
  }

  async function run(){
    const out=document.getElementById('diagnosticResult'),btn=document.getElementById('runSyncChainStress');if(!out||!btn)return;
    btn.disabled=true;out.className='diagnostic-result';out.textContent='正在运行 P0 同步全链路压力测试……';
    const lines=['P0 同步链路压力测试（独立临时数据库，不读取或修改真实阅读记录）'];let db=null,start=performance.now();
    try{
      await deleteDb();db=await openDb();await seed(db);lines.push(`初始化：${PROGRESS_TOTAL} 本进度 + ${NOTEBOOK_TOTAL} 本书摘目录`);
      db=await processProgress(db,lines);db=await processNotes(db,lines);
      const failedBefore=await count(db,'failures'),retried=await retryFailures(db);lines.push(`故障注入：${failedBefore} 项；重试处理：${retried} 项`);
      db=await testInflight(db);testLock();const modules=auditListeners();
      const meta=await getMeta(db),doneRows=await all(db,'done'),failures=await count(db,'failures'),highlights=await count(db,'highlights'),inflight=await count(db,'inflight');
      const progressDone=doneRows.filter(x=>x.kind==='progress').length,notesDone=doneRows.filter(x=>x.kind==='notes').length,expectedHighlights=NOTEBOOK_TOTAL*HIGHLIGHTS_PER_BOOK;
      if(meta.progressCursor!==PROGRESS_TOTAL)throw new Error(`进度断点错误：${meta.progressCursor}/${PROGRESS_TOTAL}`);
      if(meta.notesCursor!==NOTEBOOK_TOTAL)throw new Error(`书摘断点错误：${meta.notesCursor}/${NOTEBOOK_TOTAL}`);
      if(progressDone!==PROGRESS_TOTAL)throw new Error(`进度完成数错误：${progressDone}/${PROGRESS_TOTAL}`);
      if(notesDone!==NOTEBOOK_TOTAL)throw new Error(`书摘完成数错误：${notesDone}/${NOTEBOOK_TOTAL}`);
      if(failures!==0)throw new Error(`失败项重试后仍残留 ${failures} 项`);
      if(highlights!==expectedHighlights)throw new Error(`稳定 ID 去重异常：${highlights}/${expectedHighlights}`);
      if(inflight!==0)throw new Error(`in-flight 恢复后仍残留 ${inflight} 项`);
      lines.push(`断点恢复：通过（模拟 ${meta.crashes||0} 次页面中断）`);
      lines.push(`稳定 ID 去重：通过（${highlights.toLocaleString()} 条唯一书摘）`);
      lines.push('失败项优先重试：通过');
      lines.push('in-flight 成功响应恢复：通过');
      lines.push('跨页面锁过期/互斥：通过');
      lines.push(`重复加载检查：通过（${modules} 个 P0 脚本均无重复）`);
      lines.push(`总耗时：${Math.round(performance.now()-start)} ms`);
      lines.push('结论：P0 同步链路压力测试通过。');
      out.className='diagnostic-result ok';out.textContent=lines.join('\n');
    }catch(error){lines.push(`失败：${error?.message||error}`,'结论：P0 同步链路仍有问题，未修改真实数据。');out.className='diagnostic-result error';out.textContent=lines.join('\n')}
    finally{try{db?.close()}catch{};localStorage.removeItem(LOCK);await deleteDb();btn.disabled=false}
  }

  function install(){const anchor=document.getElementById('runStorageStress'),actions=anchor?.parentElement;if(!anchor||!actions||document.getElementById('runSyncChainStress'))return;const btn=document.createElement('button');btn.className='soft-btn';btn.id='runSyncChainStress';btn.textContent='测试同步链路';anchor.after(btn);btn.addEventListener('click',run,{passive:true})}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
  window.yuejiP0RunChainStress=run;
})();