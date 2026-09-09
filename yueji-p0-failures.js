(()=>{
  'use strict';
  if(window.__yuejiP0FailuresInstalled)return;
  window.__yuejiP0FailuresInstalled=true;

  const FAILURE_DB='yueji-weread-failures-v1';
  const FAILURE_STORE='failures';
  const GATEWAY='/.netlify/functions/weread-gateway';
  const SKILL_VERSION='1.0.5';
  const REQUEST_TIMEOUT_MS=18000;
  const RETRY_LIMIT=6;
  const REVIEW_PAGE_LIMIT=6;
  const WR_HIGHLIGHT_MARKER='__YUEJI_WEREAD__';
  const nativeFetch=window.fetch.bind(window);
  let tracking=false,retrying=false;

  const n=v=>Number(v)||0;
  const normalizeText=s=>String(s||'').toLowerCase().replace(/[\s·•:：,，.。!！?？\-—_()（）[\]【】《》<>]/g,'');
  const safeDate=ts=>{
    const num=Number(ts);if(!num)return'';
    const d=new Date(num<1e12?num*1000:num);
    return Number.isNaN(d.getTime())?'':dateKey(d);
  };
  const status=text=>{
    const el=document.getElementById('wereadStatus');
    if(el)el.textContent=text;
  };

  function failureDb(){
    return new Promise((resolve,reject)=>{
      const req=indexedDB.open(FAILURE_DB,1);
      req.onupgradeneeded=()=>{
        const db=req.result;
        if(!db.objectStoreNames.contains(FAILURE_STORE)){
          const s=db.createObjectStore(FAILURE_STORE,{keyPath:'id'});
          s.createIndex('updatedAt','updatedAt',{unique:false});
          s.createIndex('kind','kind',{unique:false});
        }
      };
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error);
      req.onblocked=()=>reject(new Error('失败项数据库被其他页面占用'));
    });
  }
  function txDone(tx,msg){
    return new Promise((resolve,reject)=>{
      tx.oncomplete=resolve;
      tx.onerror=()=>reject(tx.error||new Error(msg));
      tx.onabort=()=>reject(tx.error||new Error(msg));
    });
  }
  async function getFailure(id){
    const db=await failureDb();
    try{return await new Promise((resolve,reject)=>{
      const req=db.transaction(FAILURE_STORE).objectStore(FAILURE_STORE).get(id);
      req.onsuccess=()=>resolve(req.result||null);
      req.onerror=()=>reject(req.error);
    })}finally{db.close()}
  }
  async function listFailures(limit=100){
    const db=await failureDb();
    try{return await new Promise((resolve,reject)=>{
      const rows=[],req=db.transaction(FAILURE_STORE).objectStore(FAILURE_STORE).index('updatedAt').openCursor();
      req.onsuccess=()=>{
        const c=req.result;if(!c||rows.length>=limit)return resolve(rows);
        rows.push(c.value);c.continue();
      };
      req.onerror=()=>reject(req.error);
    })}finally{db.close()}
  }
  async function countFailures(){
    const db=await failureDb();
    try{return await new Promise((resolve,reject)=>{
      const req=db.transaction(FAILURE_STORE).objectStore(FAILURE_STORE).count();
      req.onsuccess=()=>resolve(req.result||0);
      req.onerror=()=>reject(req.error);
    })}finally{db.close()}
  }
  async function putFailure(row,error,extra={}){
    if(!row?.id)return;
    const old=await getFailure(row.id).catch(()=>null),db=await failureDb();
    try{
      const tx=db.transaction(FAILURE_STORE,'readwrite'),done=txDone(tx,'失败项无法保存');
      tx.objectStore(FAILURE_STORE).put({
        ...(old||{}),...row,...extra,
        attempts:n(old?.attempts)+1,
        lastError:String(error?.message||error||'请求失败').slice(0,500),
        updatedAt:Date.now()
      });
      await done;
    }finally{db.close()}
    await updateFailureCount();
  }
  async function clearFailure(id){
    if(!id)return;
    const db=await failureDb();
    try{
      const tx=db.transaction(FAILURE_STORE,'readwrite'),done=txDone(tx,'失败项无法清除');
      tx.objectStore(FAILURE_STORE).delete(id);await done;
    }finally{db.close()}
    await updateFailureCount();
  }
  async function replaceFailure(row){
    const db=await failureDb();
    try{
      const tx=db.transaction(FAILURE_STORE,'readwrite'),done=txDone(tx,'失败断点无法更新');
      tx.objectStore(FAILURE_STORE).put({...row,updatedAt:Date.now()});await done;
    }finally{db.close()}
    await updateFailureCount();
  }
  async function updateFailureCount(){
    const count=await countFailures().catch(()=>n(state.weRead?.failedDetailCount));
    state.weRead=state.weRead&&typeof state.weRead==='object'?state.weRead:{};
    state.weRead.failedDetailCount=count;
    try{save()}catch{}
    return count;
  }

  function bookSnapshot(bookId){
    const b=state.books.find(x=>String(x.weReadBookId||'')===String(bookId));
    return b?{title:b.title||'',author:b.author||'',category:b.category||'',cover:b.weReadCover||b.cover||''}:{};
  }
  function classifyRequest(input,init){
    const url=typeof input==='string'?input:input?.url||'';
    if(!String(url).includes(GATEWAY)||String(init?.method||'GET').toUpperCase()!=='POST')return null;
    let body;try{body=typeof init?.body==='string'?JSON.parse(init.body):init?.body}catch{return null}
    const api=String(body?.api_name||''),bookId=String(body?.bookId||body?.bookid||'');
    if(!bookId)return null;
    if(api==='/book/getprogress')return{id:`progress:${bookId}`,kind:'progress',bookId,...bookSnapshot(bookId)};
    if(api==='/book/bookmarklist')return{id:`marks:${bookId}`,kind:'marks',bookId,...bookSnapshot(bookId)};
    if(api==='/review/list/mine')return{id:`reviews:${bookId}`,kind:'reviews',bookId,synckey:body?.synckey||0,...bookSnapshot(bookId)};
    return null;
  }
  async function inspectResponse(response,row){
    if(!row)return;
    let failed=!response.ok,message=response.statusText||`HTTP ${response.status}`;
    try{
      const data=await response.clone().json();
      if(data?.errcode&&data.errcode!==0){failed=true;message=data.errmsg||data.message||message}
    }catch{}
    if(failed)await putFailure(row,message,row.kind==='reviews'?{synckey:row.synckey||0}:{});
    else await clearFailure(row.id);
  }

  window.fetch=async function(input,init){
    const row=tracking?classifyRequest(input,init):null;
    try{
      const response=await nativeFetch(input,init);
      if(row)await inspectResponse(response,row);
      return response;
    }catch(error){
      if(row)await putFailure(row,error,row.kind==='reviews'?{synckey:row.synckey||0}:{});
      throw error;
    }
  };

  async function directCall(apiName,params){
    const key=localStorage.getItem('yueji-weread-key');
    if(!key)throw new Error('没有 Skill Key');
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),REQUEST_TIMEOUT_MS);
    let response,text,data;
    try{
      response=await nativeFetch(GATEWAY,{
        method:'POST',
        headers:{'Authorization':`Bearer ${key}`,'Content-Type':'application/json'},
        body:JSON.stringify({api_name:apiName,skill_version:SKILL_VERSION,...params}),
        signal:controller.signal
      });
      text=await response.text();
    }catch(error){
      if(error?.name==='AbortError')throw new Error('重试请求超时');
      throw error;
    }finally{clearTimeout(timer)}
    try{data=window.yuejiParseJsonText?await window.yuejiParseJsonText(text):JSON.parse(text)}catch{throw new Error(`微信读书返回了无法解析的响应（${response.status}）`)}
    if(!response.ok||(data?.errcode&&data.errcode!==0))throw new Error(data?.errmsg||data?.message||`微信读书接口错误（${response.status}）`);
    return data?.data&&typeof data.data==='object'?data.data:data;
  }

  function ensureRetryBook(row){
    let b=state.books.find(x=>String(x.weReadBookId||'')===String(row.bookId));
    if(!b&&row.title){
      const nt=normalizeText(row.title);
      b=state.books.find(x=>normalizeText(x.title)===nt);
    }
    if(!b){
      b={key:`wr:${row.bookId}`,title:row.title||'未命名书籍',author:row.author||'',category:row.category||'未分类',progress:0,status:'unread',minutes:0,words:0,color:palette[state.books.length%palette.length],sources:['weread']};
      state.books.push(b);
    }
    b.sources=[...new Set([...(b.sources||[]),'weread'])];b.weReadBookId=String(row.bookId);
    if(!b.author&&row.author)b.author=row.author;
    if((!b.category||b.category==='未分类')&&row.category)b.category=row.category;
    if(row.cover){b.weReadCover=row.cover;b.cover=b.cover||row.cover}
    return b;
  }
  function mergeRetryProgress(row,data){
    const b=ensureRetryBook(row),x=data?.book||data||{},p=n(x.progress);
    if(p||x.isStartReading){
      b.weReadProgress=p;
      if(b.progressSource!=='manual'&&!b.manualProgress)b.progress=Math.max(n(b.progress),p);
      b.status=p>=100?'done':p>0?'reading':b.status;
    }
    const sec=n(x.recordReadingTime);if(sec>0)b.weReadSeconds=sec;
    if(x.updateTime)b.weReadLastRead=safeDate(x.updateTime);
    if(x.finishTime&&!b.finishedDate)b.finishedDate=safeDate(x.finishTime);
  }
  async function saveHighlights(rows){
    if(!rows.length)return;
    if(window.yuejiHighlightsReady)await window.yuejiHighlightsReady;
    if(window.yuejiHighlightsDbReady?.())await window.yuejiPutHighlights(rows);
    else{
      const map=new Map((state.highlights||[]).map(h=>[h.id,h]));
      rows.forEach(h=>map.set(h.id,h));state.highlights=[...map.values()];
    }
  }
  function markRows(row,data){
    const b=ensureRetryBook(row);
    return(data?.updated||[]).filter(x=>x.markText).map(x=>({
      id:`wr-mark:${x.bookmarkId||`${row.bookId}:${normalizeText(x.markText).slice(0,40)}`}`,
      bookKey:b.key,date:safeDate(x.createTime)||todayKey,time:n(x.createTime)*1000,
      quote:x.markText,note:'',bookmark:WR_HIGHLIGHT_MARKER,source:'weread',sourceId:x.bookmarkId||''
    }));
  }
  function reviewRows(row,data){
    const b=ensureRetryBook(row),out=[];
    (data?.reviews||[]).forEach(item=>{
      const r=item.review||item,content=r.content||'',abstract=r.abstract||'';if(!content&&!abstract)return;
      out.push({
        id:`wr-review:${r.reviewId||`${row.bookId}:${normalizeText(content||abstract).slice(0,40)}`}`,
        bookKey:b.key,date:safeDate(r.createTime)||todayKey,time:n(r.createTime)*1000,
        quote:abstract,note:content,bookmark:WR_HIGHLIGHT_MARKER,source:'weread',sourceId:r.reviewId||''
      });
    });
    return out;
  }

  async function retryReviewFailure(row){
    let synckey=row.synckey||0;
    const seen=new Set();
    for(let page=0;page<REVIEW_PAGE_LIMIT;page++){
      const data=await directCall('/review/list/mine',{bookid:row.bookId,synckey,count:20});
      await saveHighlights(reviewRows(row,data));
      if(!data?.hasMore){await clearFailure(row.id);return true}
      const next=data.synckey;
      if(!next||String(next)===String(synckey)||seen.has(String(next))){await clearFailure(row.id);return true}
      seen.add(String(next));synckey=next;
      await replaceFailure({...row,synckey,attempts:n(row.attempts),lastError:row.lastError||''});
      await new Promise(resolve=>setTimeout(resolve,0));
    }
    await replaceFailure({...row,synckey,attempts:n(row.attempts),lastError:'评论页数较多，保留下一页断点'});
    return false;
  }

  async function retryOne(row){
    try{
      if(row.kind==='progress'){
        mergeRetryProgress(row,await directCall('/book/getprogress',{bookId:row.bookId}));
        await clearFailure(row.id);return true;
      }
      if(row.kind==='marks'){
        await saveHighlights(markRows(row,await directCall('/book/bookmarklist',{bookId:row.bookId})));
        await clearFailure(row.id);return true;
      }
      if(row.kind==='reviews')return await retryReviewFailure(row);
      await clearFailure(row.id);return true;
    }catch(error){
      await putFailure(row,error,row.kind==='reviews'?{synckey:row.synckey||0}:{});
      return false;
    }finally{try{save()}catch{}}
  }

  async function retryFailuresFirst(){
    const rows=(await listFailures(RETRY_LIMIT)).slice(0,RETRY_LIMIT);
    if(!rows.length){await updateFailureCount();return 0}
    retrying=true;window.__yuejiP0RetryingFailures=true;
    const previousRunning=Boolean(window.__yuejiWeReadSyncing);
    if(!previousRunning)window.__yuejiWeReadSyncing=true;
    try{
      for(let i=0;i<rows.length;i++){
        status(`正在优先重试上次失败项 ${i+1}/${rows.length}……`);
        await retryOne(rows[i]);
        await new Promise(resolve=>setTimeout(resolve,0));
      }
    }finally{
      retrying=false;window.__yuejiP0RetryingFailures=false;
      if(!previousRunning)window.__yuejiWeReadSyncing=false;
    }
    return await updateFailureCount();
  }

  const originalResume=window.yuejiP0ResumeSync;
  if(typeof originalResume==='function'){
    window.yuejiP0ResumeSync=async function(){
      await retryFailuresFirst();
      tracking=true;
      try{return await originalResume()}
      finally{
        tracking=false;
        const left=await updateFailureCount();
        if(left>0){
          const el=document.getElementById('wereadStatus');
          if(el)el.insertAdjacentHTML('beforeend',`<br><span style="color:var(--muted)">还有 ${left} 个失败项已保留，下次继续同步会优先重试。</span>`);
        }
      }
    };
  }

  document.addEventListener('click',event=>{
    if(!retrying)return;
    const id=event.target?.closest?.('button')?.id;
    if(['wereadConnectBtn','wereadSyncBtn','wereadContinueBtn','wereadRestartBtn'].includes(id)){
      event.preventDefault();event.stopImmediatePropagation();
      status('正在重试上次失败项，请不要重复启动同步。');
    }
  },true);

  updateFailureCount();
  window.yuejiP0FailureCount=()=>countFailures();
  window.yuejiP0FailureList=()=>listFailures();
})();
