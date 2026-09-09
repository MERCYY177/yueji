(() => {
  'use strict';

  const EXT_KEY='yueji-weread-key';
  const GATEWAY='/.netlify/functions/weread-gateway';
  const SKILL_VERSION='1.0.5';
  const QUEUE_DB='yueji-weread-resume-v1';
  const META_STORE='meta';
  const PROGRESS_STORE='progressQueue';
  const NOTEBOOK_STORE='notebookQueue';
  const REQUEST_TIMEOUT_MS=18000;
  const RUN_DEADLINE_MS=55000;
  const PROGRESS_BATCH_SIZE=8;
  const NOTES_BATCH_SIZE=6;
  const NOTEBOOK_BUILD_PAGES_PER_RUN=6;
  const REVIEW_PAGES_PER_RUN=6;
  const WR_HIGHLIGHT_MARKER='__YUEJI_WEREAD__';
  let activeResume=null;

  const n=v=>Number(v)||0;
  const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
  const yieldToBrowser=()=>new Promise(resolve=>{
    if(globalThis.scheduler?.yield)globalThis.scheduler.yield().then(resolve,resolve);
    else setTimeout(resolve,0);
  });
  const safeDate=ts=>{
    const num=Number(ts);if(!num)return'';
    const d=new Date(num<1e12?num*1000:num);
    return Number.isNaN(d.getTime())?'':dateKey(d);
  };
  const normalizeText=s=>String(s||'').toLowerCase().replace(/[\s·•:：,，.。!！?？\-—_()（）[\]【】《》<>]/g,'');
  const normalizeAuthor=s=>normalizeText(s).replace(/著|编|译|作者/g,'');

  function queueDb(){
    return new Promise((resolve,reject)=>{
      const req=indexedDB.open(QUEUE_DB,1);
      req.onupgradeneeded=()=>{
        const db=req.result;
        if(!db.objectStoreNames.contains(META_STORE))db.createObjectStore(META_STORE,{keyPath:'key'});
        if(!db.objectStoreNames.contains(PROGRESS_STORE))db.createObjectStore(PROGRESS_STORE,{keyPath:'i'});
        if(!db.objectStoreNames.contains(NOTEBOOK_STORE)){
          const s=db.createObjectStore(NOTEBOOK_STORE,{keyPath:'bookId'});
          s.createIndex('order','order',{unique:false});
        }
      };
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error);
      req.onblocked=()=>reject(new Error('同步断点数据库被其他页面占用'));
    });
  }
  function txDone(tx,msg){
    return new Promise((resolve,reject)=>{
      tx.oncomplete=resolve;
      tx.onerror=()=>reject(tx.error||new Error(msg));
      tx.onabort=()=>reject(tx.error||new Error(msg));
    });
  }
  async function getMeta(db){
    return await new Promise((resolve,reject)=>{
      const req=db.transaction(META_STORE).objectStore(META_STORE).get('queue');
      req.onsuccess=()=>resolve(req.result||null);
      req.onerror=()=>reject(req.error);
    });
  }
  async function putMeta(db,meta){
    const tx=db.transaction(META_STORE,'readwrite');
    tx.objectStore(META_STORE).put({...meta,key:'queue'});
    await txDone(tx,'同步断点无法保存');
  }
  async function storeCount(db,name){
    return await new Promise((resolve,reject)=>{
      const req=db.transaction(name).objectStore(name).count();
      req.onsuccess=()=>resolve(req.result||0);
      req.onerror=()=>reject(req.error);
    });
  }
  async function resetQueues(db,meta,progressRows){
    let tx=db.transaction([META_STORE,PROGRESS_STORE,NOTEBOOK_STORE],'readwrite');
    const done=txDone(tx,'同步队列无法重建');
    const p=tx.objectStore(PROGRESS_STORE),nb=tx.objectStore(NOTEBOOK_STORE);
    p.clear();nb.clear();
    progressRows.forEach((row,i)=>p.put({...row,i}));
    tx.objectStore(META_STORE).put({...meta,key:'queue'});
    await done;
  }
  async function progressSlice(db,start,count){
    return await new Promise((resolve,reject)=>{
      const rows=[],store=db.transaction(PROGRESS_STORE).objectStore(PROGRESS_STORE);
      const req=store.openCursor(IDBKeyRange.lowerBound(start));
      req.onsuccess=()=>{
        const c=req.result;
        if(!c||rows.length>=count)return resolve(rows);
        rows.push(c.value);c.continue();
      };
      req.onerror=()=>reject(req.error);
    });
  }
  async function notebookSlice(db,start,count){
    return await new Promise((resolve,reject)=>{
      const rows=[],idx=db.transaction(NOTEBOOK_STORE).objectStore(NOTEBOOK_STORE).index('order');
      const req=idx.openCursor(IDBKeyRange.lowerBound(start));
      req.onsuccess=()=>{
        const c=req.result;
        if(!c||rows.length>=count)return resolve(rows);
        rows.push(c.value);c.continue();
      };
      req.onerror=()=>reject(req.error);
    });
  }
  async function putNotebookPage(db,rows,startOrder){
    const tx=db.transaction(NOTEBOOK_STORE,'readwrite'),done=txDone(tx,'书摘队列无法保存');
    const store=tx.objectStore(NOTEBOOK_STORE);let order=startOrder;
    for(const raw of rows){
      const book=raw?.book||raw||{},bookId=String(book.bookId||raw?.bookId||'');
      if(!bookId)continue;
      store.put({
        bookId,order:order++,
        title:String(book.title||book.name||''),
        author:String(book.author||book.authorName||''),
        category:String(book.category||''),
        cover:String(book.cover||''),
        readingProgress:n(raw?.readingProgress)
      });
    }
    await done;
    return order;
  }

  async function reindexNotebooks(db){
    const rows=await new Promise((resolve,reject)=>{
      const req=db.transaction(NOTEBOOK_STORE).objectStore(NOTEBOOK_STORE).index('order').getAll();
      req.onsuccess=()=>resolve(req.result||[]);
      req.onerror=()=>reject(req.error);
    });
    const tx=db.transaction(NOTEBOOK_STORE,'readwrite'),done=txDone(tx,'书摘队列无法整理');
    const store=tx.objectStore(NOTEBOOK_STORE);store.clear();
    rows.forEach((row,i)=>store.put({...row,order:i}));
    await done;
    return rows.length;
  }

  function progressRowsFromState(){
    return state.books
      .filter(b=>b?.sources?.includes('weread')&&b.weReadBookId&&(b.weReadLastRead||b.finishedDate||n(b.weReadProgress)>0||n(b.progress)>0||b.status==='done'))
      .map(b=>({
        bookId:String(b.weReadBookId),
        title:String(b.title||''),
        author:String(b.author||''),
        sortDate:String(b.weReadLastRead||b.finishedDate||'')
      }))
      .sort((a,b)=>a.sortDate.localeCompare(b.sortDate)||a.bookId.localeCompare(b.bookId));
  }

  async function ensureQueues(){
    const db=await queueDb();
    try{
      const baseSyncAt=n(state.weRead?.lastSync);
      let meta=await getMeta(db);
      const progressCount=await storeCount(db,PROGRESS_STORE);
      const needsReset=!meta||n(meta.baseSyncAt)!==baseSyncAt||meta.version!==1||(!progressCount&&!state.weRead?.progressDone&&n(state.weRead?.progressTotal)>0);
      if(needsReset){
        const progressRows=progressRowsFromState();
        meta={
          version:1,baseSyncAt,
          notebookBuildComplete:false,
          notebookNextSort:null,
          notebookOrder:0,
          createdAt:Date.now()
        };
        await resetQueues(db,meta,progressRows);
        state.weRead.progressTotal=progressRows.length;
        if(!state.weRead.progressDone)state.weRead.progressCursor=0;
        if(!state.weRead.notesDone)state.weRead.notesCursor=0;
        state.weRead.resumeQueueVersion=1;
        save();
      }else{
        state.weRead.progressTotal=progressCount;
      }
      return {db,meta};
    }catch(error){
      db.close();
      throw error;
    }
  }

  function assertActive(ctx){
    if(!ctx||ctx!==activeResume||ctx.cancelled)throw new Error('SYNC_PAUSED');
    if(Date.now()>ctx.deadline)throw new Error('SYNC_TIME_LIMIT');
  }
  async function apiCall(apiName,params,ctx){
    assertActive(ctx);
    const key=localStorage.getItem(EXT_KEY);
    if(!key)throw new Error('没有 Skill Key');
    if(ctx.requests>=ctx.maxRequests)throw new Error('SYNC_REQUEST_LIMIT');
    ctx.requests++;
    const controller=new AbortController();
    ctx.controller=controller;
    const timer=setTimeout(()=>controller.abort(),REQUEST_TIMEOUT_MS);
    let res,text,data;
    try{
      res=await fetch(GATEWAY,{
        method:'POST',
        headers:{'Authorization':`Bearer ${key}`,'Content-Type':'application/json'},
        body:JSON.stringify({api_name:apiName,skill_version:SKILL_VERSION,...(params||{})}),
        signal:controller.signal
      });
      text=await res.text();
    }catch(error){
      if(error?.name==='AbortError'){
        if(ctx.cancelled)throw new Error('SYNC_PAUSED');
        throw new Error('微信读书响应超时，请稍后继续；已经保存的数据不会丢失');
      }
      throw error;
    }finally{
      clearTimeout(timer);
      if(ctx.controller===controller)ctx.controller=null;
    }
    try{data=window.yuejiParseJsonText?await window.yuejiParseJsonText(text):JSON.parse(text)}
    catch{throw new Error(`微信读书返回了无法解析的响应（${res.status}）`)}
    if(!res.ok||(data?.errcode&&data.errcode!==0))throw new Error(data?.errmsg||data?.message||`微信读书接口错误（${res.status}）`);
    assertActive(ctx);
    return data?.data&&typeof data.data==='object'?data.data:data;
  }

  function findOrCreateBook(row){
    let b=state.books.find(x=>String(x.weReadBookId||'')===String(row.bookId));
    if(!b&&row.title){
      const nt=normalizeText(row.title),na=normalizeAuthor(row.author);
      b=state.books.find(x=>normalizeText(x.title)===nt&&(!na||!normalizeAuthor(x.author)||normalizeAuthor(x.author)===na));
    }
    if(!b){
      b={
        key:`wr:${row.bookId}`,title:row.title||'未命名书籍',author:row.author||'',
        category:row.category||'未分类',progress:n(row.readingProgress),status:n(row.readingProgress)>0?'reading':'unread',
        minutes:0,words:0,color:palette[state.books.length%palette.length],sources:['weread']
      };
      state.books.push(b);
    }
    b.sources=[...new Set([...(b.sources||[]),'weread'])];
    b.weReadBookId=String(row.bookId);
    if(!b.author&&row.author)b.author=row.author;
    if((!b.category||b.category==='未分类')&&row.category)b.category=row.category;
    if(row.cover){b.weReadCover=row.cover;b.cover=b.cover||row.cover}
    return b;
  }
  function mergeProgress(row,payload){
    const b=findOrCreateBook(row),bookData=payload?.book||payload||{};
    const p=n(bookData.progress);
    if(p||bookData.isStartReading){
      b.weReadProgress=p;
      if(b.progressSource!=='manual'&&!b.manualProgress)b.progress=Math.max(n(b.progress),p);
      b.status=p>=100?'done':p>0?'reading':b.status;
    }
    const sec=n(bookData.recordReadingTime);
    if(sec>0)b.weReadSeconds=sec;
    const updateTime=bookData.updateTime;
    if(updateTime)b.weReadLastRead=safeDate(updateTime);
    const finishTime=bookData.finishTime;
    if(finishTime&&!b.finishedDate)b.finishedDate=safeDate(finishTime);
    return b;
  }

  async function saveHighlights(rows){
    if(!rows.length)return;
    if(window.yuejiHighlightsReady)await window.yuejiHighlightsReady;
    if(window.yuejiHighlightsDbReady?.())await window.yuejiPutHighlights(rows);
    else{
      const map=new Map((state.highlights||[]).map(h=>[h.id,h]));
      rows.forEach(h=>map.set(h.id,h));
      state.highlights=[...map.values()];
    }
  }

  async function ensureNotebookQueue(db,meta,ctx){
    if(state.weRead.notesDone)return meta;
    if(meta.notebookBuildComplete){
      state.weRead.notebooksTotal=await storeCount(db,NOTEBOOK_STORE);
      return meta;
    }
    let lastSort=meta.notebookNextSort??null,order=n(meta.notebookOrder),pages=0;
    const seen=new Set();
    while(!meta.notebookBuildComplete&&pages<NOTEBOOK_BUILD_PAGES_PER_RUN){
      assertActive(ctx);
      setStatus(lastSort?'正在从上次位置继续整理书摘目录……':'正在建立可恢复的书摘同步队列……');
      const params={count:20};if(lastSort!==null&&lastSort!=='')params.lastSort=lastSort;
      const data=await apiCall('/user/notebooks',params,ctx);
      const rows=Array.isArray(data.books)?data.books:[];
      order=await putNotebookPage(db,rows,order);
      pages++;
      const next=rows[rows.length-1]?.sort;
      if(!data.hasMore||!rows.length||next===undefined||next===null||next===''||String(next)===String(lastSort)||seen.has(String(next))){
        meta.notebookBuildComplete=true;
        meta.notebookNextSort=null;
      }else{
        seen.add(String(next));lastSort=next;meta.notebookNextSort=next;
      }
      meta.notebookOrder=order;
      await putMeta(db,meta);
      state.weRead.notebooksTotal=await storeCount(db,NOTEBOOK_STORE);
      save();
      await yieldToBrowser();
    }
    if(!meta.notebookBuildComplete)throw new Error('SYNC_QUEUE_BUILD_LIMIT');
    state.weRead.notebooksTotal=await reindexNotebooks(db);
    meta.notebookOrder=state.weRead.notebooksTotal;
    await putMeta(db,meta);
    save();
    return meta;
  }

  async function syncProgressQueue(db,ctx){
    const total=await storeCount(db,PROGRESS_STORE);
    state.weRead.progressTotal=total;
    if(state.weRead.progressDone)return{done:true,completed:total,total};
    const start=Math.min(n(state.weRead.progressCursor),total);
    const rows=await progressSlice(db,start,PROGRESS_BATCH_SIZE);
    let completed=0;
    for(const row of rows){
      assertActive(ctx);
      setStatus(`从断点继续补阅读进度 ${start+completed+1}/${total}……`);
      try{
        const p=await apiCall('/book/getprogress',{bookId:row.bookId},ctx);
        mergeProgress(row,p);
      }catch(error){
        if(/^SYNC_/.test(String(error?.message||'')))throw error;
        console.warn('WeRead progress queue row skipped',row.bookId,error);
      }
      completed++;
      state.weRead.progressCursor=start+completed;
      if(completed%2===0){save();await yieldToBrowser()}
    }
    const done=start+completed>=total;
    state.weRead.progressCursor=done?0:start+completed;
    state.weRead.progressDone=done;
    save();
    return{done,completed:start+completed,total};
  }

  async function syncNotebook(row,ctx){
    const b=findOrCreateBook(row),bookId=row.bookId,rows=[];
    try{
      const marks=await apiCall('/book/bookmarklist',{bookId},ctx);
      (marks.updated||[]).forEach(x=>{
        if(!x.markText)return;
        rows.push({
          id:`wr-mark:${x.bookmarkId||`${bookId}:${normalizeText(x.markText).slice(0,40)}`}`,
          bookKey:b.key,date:safeDate(x.createTime)||todayKey,time:n(x.createTime)*1000,
          quote:x.markText,note:'',bookmark:WR_HIGHLIGHT_MARKER,source:'weread',sourceId:x.bookmarkId||''
        });
      });
    }catch(error){
      if(/^SYNC_/.test(String(error?.message||'')))throw error;
      console.warn('WeRead bookmarks skipped',bookId,error);
    }

    const reviewKey=String(bookId),seen=new Set();
    let synckey=state.weRead.reviewCursors?.[reviewKey]||0;
    state.weRead.reviewCursors=state.weRead.reviewCursors&&typeof state.weRead.reviewCursors==='object'?state.weRead.reviewCursors:{};
    for(let page=0;page<REVIEW_PAGES_PER_RUN;page++){
      assertActive(ctx);
      try{
        const data=await apiCall('/review/list/mine',{bookid:bookId,synckey,count:20},ctx),pageRows=[];
        (data.reviews||[]).forEach(item=>{
          const r=item.review||item,content=r.content||'',abstract=r.abstract||'';
          if(!content&&!abstract)return;
          pageRows.push({
            id:`wr-review:${r.reviewId||`${bookId}:${normalizeText(content||abstract).slice(0,40)}`}`,
            bookKey:b.key,date:safeDate(r.createTime)||todayKey,time:n(r.createTime)*1000,
            quote:abstract,note:content,bookmark:WR_HIGHLIGHT_MARKER,source:'weread',sourceId:r.reviewId||''
          });
        });
        await saveHighlights([...rows.splice(0),...pageRows]);
        if(!data.hasMore){
          delete state.weRead.reviewCursors[reviewKey];
          save();return;
        }
        const next=data.synckey;
        if(!next||String(next)===String(synckey)||seen.has(String(next))){
          delete state.weRead.reviewCursors[reviewKey];
          save();return;
        }
        seen.add(String(next));synckey=next;state.weRead.reviewCursors[reviewKey]=synckey;
        save();await yieldToBrowser();
      }catch(error){
        if(/^SYNC_/.test(String(error?.message||'')))throw error;
        console.warn('WeRead reviews skipped',bookId,error);
        await saveHighlights(rows.splice(0));
        return;
      }
    }
    await saveHighlights(rows.splice(0));
    throw new Error('SYNC_BATCH_LIMIT');
  }

  async function syncNotesQueue(db,ctx){
    const total=await storeCount(db,NOTEBOOK_STORE);
    state.weRead.notebooksTotal=total;
    if(state.weRead.notesDone)return{done:true,completed:total,total};
    const start=Math.min(n(state.weRead.notesCursor),total);
    const rows=await notebookSlice(db,start,NOTES_BATCH_SIZE);
    let completed=0;
    for(const row of rows){
      assertActive(ctx);
      setStatus(`从断点继续同步书摘 ${start+completed+1}/${total}……`);
      await syncNotebook(row,ctx);
      completed++;
      state.weRead.notesCursor=start+completed;
      save();
      await yieldToBrowser();
    }
    const done=start+completed>=total;
    state.weRead.notesCursor=done?0:start+completed;
    state.weRead.notesDone=done;
    save();
    return{done,completed:start+completed,total};
  }

  function panel(){
    const p=document.getElementById('wereadProgressPanel');if(!p)return;
    const pt=n(state.weRead?.progressTotal),nt=n(state.weRead?.notebooksTotal);
    const pd=state.weRead?.progressDone?pt:n(state.weRead?.progressCursor);
    const nd=state.weRead?.notesDone?nt:n(state.weRead?.notesCursor);
    const labels={running:'同步中',paused:'已暂停',error:'部分失败',complete:'全部完成','base-complete':'基础数据完成',idle:'等待同步'};
    const last=state.weRead?.lastSync?new Date(state.weRead.lastSync).toLocaleString('zh-CN',{hour12:false}):'尚未完成';
    p.innerHTML=`<div class="wr-progress-head"><b>${esc(labels[state.weRead?.syncState]||'等待同步')}</b><span>基础更新：${esc(last)}</span></div><div class="wr-progress-grid"><div class="wr-progress-item"><span>书架</span><strong>${n(state.weRead?.shelfTotal)} 本</strong></div><div class="wr-progress-item"><span>阅读统计</span><strong>${n(state.weRead?.statsDays)} 天</strong></div><div class="wr-progress-item"><span>阅读进度</span><strong>${pd} / ${pt||'待读取'}</strong></div><div class="wr-progress-item"><span>书摘书目</span><strong>${nd} / ${nt||'待读取'}</strong></div></div>`;
  }
  function setStatus(text,isError=false){
    const el=document.getElementById('wereadStatus');
    if(el)el.innerHTML=`<span style="${isError?'color:#b65b5b':''}">${esc(text)}</span>`;
    panel();
  }
  function setButtons(running){
    ['wereadConnectBtn','wereadSyncBtn','wereadContinueBtn','wereadRestartBtn'].forEach(id=>{
      const el=document.getElementById(id);if(el)el.disabled=running;
    });
    const stop=document.getElementById('wereadStopBtn');if(stop)stop.disabled=!running;
  }
  function renderSafe(){
    try{renderAll()}catch{
      try{renderToday()}catch{}
      try{renderCalendar()}catch{}
      try{renderBookOptions()}catch{}
    }
  }
  function stopResume(){
    if(!activeResume)return;
    activeResume.cancelled=true;
    try{activeResume.controller?.abort()}catch{}
    state.weRead.syncState='paused';
    try{save()}catch{}
    setStatus('同步已暂停。队列和断点已经保存，下次会从当前位置继续。');
  }

  async function resumeSync(){
    if(!localStorage.getItem(EXT_KEY))return setStatus('还没有保存 Skill Key。',true);
    if(window.__yuejiArchiveBusy)return setStatus('网页正在导入或导出数据，请完成后再同步。');
    if(activeResume||window.__yuejiWeReadSyncing)return setStatus('已有同步任务正在进行，可以先暂停。');
    const ctx={cancelled:false,controller:null,started:Date.now(),deadline:Date.now()+RUN_DEADLINE_MS,requests:0,maxRequests:42};
    activeResume=ctx;window.__yuejiWeReadSyncing=true;
    state.weRead.syncState='running';setButtons(true);panel();
    let db;
    try{
      setStatus('正在读取本地同步断点……');
      const ensured=await ensureQueues();db=ensured.db;
      let meta=ensured.meta;
      meta=await ensureNotebookQueue(db,meta,ctx);
      const progress=await syncProgressQueue(db,ctx);
      const notes=await syncNotesQueue(db,ctx);
      state.weRead.detailSyncAt=Date.now();
      state.weRead.syncState=progress.done&&notes.done?'complete':'paused';
      save();
      renderSafe();
      setStatus(progress.done&&notes.done
        ?`未完成数据已经全部补齐：阅读进度 ${progress.total}/${progress.total} · 书摘 ${notes.total}/${notes.total}。`
        :`本批已保存：阅读进度 ${progress.completed}/${progress.total} · 书摘 ${notes.completed}/${notes.total}。再次点“继续未完成同步”会从这里接着走。`);
      try{toast(progress.done&&notes.done?'微信读书补充同步完成':'本批断点已保存')}catch{}
    }catch(error){
      const msg=String(error?.message||error);
      state.weRead.syncState=/^SYNC_/.test(msg)?'paused':'error';
      if(msg==='SYNC_PAUSED')setStatus('同步已暂停。队列和断点已经保存，下次会从当前位置继续。');
      else if(msg==='SYNC_TIME_LIMIT')setStatus('本批运行到安全时限，已自动暂停并保存断点。再次点“继续未完成同步”即可接着处理。');
      else if(msg==='SYNC_REQUEST_LIMIT')setStatus('本批达到安全请求上限，已自动暂停并保存断点。再次点“继续未完成同步”即可接着处理。');
      else if(msg==='SYNC_QUEUE_BUILD_LIMIT')setStatus('书摘目录较多，本批已保存目录断点。再次点“继续未完成同步”会继续建队列，不会从头扫描。');
      else if(msg==='SYNC_BATCH_LIMIT')setStatus('当前这本书的书摘较多，已经记住页码断点。再次继续时会从这本书的下一页接着同步。');
      else{console.error('Yueji P0 resume sync failed',error);setStatus(`同步未完成：${msg}。已保存的队列和数据不会删除。`,true)}
      try{save()}catch{}
      renderSafe();
    }finally{
      db?.close();
      if(activeResume===ctx)activeResume=null;
      window.__yuejiWeReadSyncing=false;
      setButtons(false);panel();
    }
  }

  document.addEventListener('click',event=>{
    const button=event.target?.closest?.('button');
    if(!button)return;
    if(button.id==='wereadContinueBtn'){
      event.preventDefault();event.stopImmediatePropagation();
      resumeSync();
    }else if(button.id==='wereadStopBtn'&&activeResume){
      event.preventDefault();event.stopImmediatePropagation();
      stopResume();
    }
  },true);

  window.yuejiP0ResumeSync=resumeSync;
  window.yuejiP0ResumeQueueInfo=async()=>{
    const db=await queueDb();
    try{
      return{meta:await getMeta(db),progress:await storeCount(db,PROGRESS_STORE),notebooks:await storeCount(db,NOTEBOOK_STORE)};
    }finally{db.close()}
  };
})();