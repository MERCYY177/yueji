(()=>{
  'use strict';
  if(window.__yuejiP0InflightInstalled)return;
  window.__yuejiP0InflightInstalled=true;

  const DB_NAME='yueji-weread-inflight-v1';
  const STORE='records';
  const GATEWAY='/.netlify/functions/weread-gateway';
  const WR_HIGHLIGHT_MARKER='__YUEJI_WEREAD__';
  const nativeFetch=window.fetch.bind(window);
  const n=v=>Number(v)||0;
  const normalizeText=s=>String(s||'').toLowerCase().replace(/[\s·•:：,，.。!！?？\-—_()（）[\]【】《》<>]/g,'');
  const safeDate=ts=>{const num=Number(ts);if(!num)return'';const d=new Date(num<1e12?num*1000:num);return Number.isNaN(d.getTime())?'':dateKey(d)};

  function dbOpen(){return new Promise((resolve,reject)=>{const req=indexedDB.open(DB_NAME,1);req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains(STORE)){const s=db.createObjectStore(STORE,{keyPath:'id'});s.createIndex('updatedAt','updatedAt',{unique:false})}};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);req.onblocked=()=>reject(new Error('同步恢复日志被其他页面占用'))})}
  function txDone(tx,msg){return new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error||new Error(msg));tx.onabort=()=>reject(tx.error||new Error(msg))})}
  async function put(row){const db=await dbOpen();try{const tx=db.transaction(STORE,'readwrite'),done=txDone(tx,'同步恢复日志无法保存');tx.objectStore(STORE).put({...row,updatedAt:Date.now()});await done}finally{db.close()}}
  async function remove(id){const db=await dbOpen();try{const tx=db.transaction(STORE,'readwrite'),done=txDone(tx,'同步恢复日志无法清理');tx.objectStore(STORE).delete(id);await done}finally{db.close()}}
  async function all(){const db=await dbOpen();try{return await new Promise((resolve,reject)=>{const req=db.transaction(STORE).objectStore(STORE).index('updatedAt').getAll();req.onsuccess=()=>resolve(req.result||[]);req.onerror=()=>reject(req.error)})}finally{db.close()}}
  async function count(){const db=await dbOpen();try{return await new Promise((resolve,reject)=>{const req=db.transaction(STORE).objectStore(STORE).count();req.onsuccess=()=>resolve(req.result||0);req.onerror=()=>reject(req.error)})}finally{db.close()}}

  function bookSnapshot(bookId){const b=state.books.find(x=>String(x.weReadBookId||'')===String(bookId));return b?{bookKey:b.key,title:b.title||'',author:b.author||'',category:b.category||'',cover:b.weReadCover||b.cover||''}:{}}
  function classify(input,init){
    const url=typeof input==='string'?input:input?.url||'';
    if(!String(url).includes(GATEWAY)||String(init?.method||'GET').toUpperCase()!=='POST')return null;
    let body;try{body=typeof init?.body==='string'?JSON.parse(init.body):init?.body}catch{return null}
    const api=String(body?.api_name||''),bookId=String(body?.bookId||body?.bookid||'');if(!bookId)return null;
    const base={api,bookId,...bookSnapshot(bookId)};
    if(api==='/book/getprogress')return{id:`progress:${bookId}`,kind:'progress',...base};
    if(api==='/book/bookmarklist')return{id:`marks:${bookId}`,kind:'marks',...base};
    if(api==='/review/list/mine')return{id:`reviews:${bookId}`,kind:'reviews',synckey:body?.synckey||0,...base};
    return null;
  }
  function normalizePayload(raw){return raw?.data&&typeof raw.data==='object'?raw.data:raw}
  async function successfulPayload(response){if(!response?.ok)return null;try{const raw=await response.clone().json();if(raw?.errcode&&raw.errcode!==0)return null;return normalizePayload(raw)}catch{return null}}

  window.fetch=async function(input,init){
    const row=classify(input,init);
    if(row)try{await put({...row,phase:'pending',startedAt:Date.now()})}catch(error){console.warn('Yueji inflight pending log skipped',error)}
    let response;
    try{response=await nativeFetch(input,init)}catch(error){throw error}
    if(row){
      const payload=await successfulPayload(response);
      if(payload){
        try{
          await put({...row,phase:'completed',payload,completedAt:Date.now()});
          setTimeout(()=>remove(row.id).catch(()=>{}),60000);
        }catch(error){console.warn('Yueji inflight completed log skipped',error)}
      }else remove(row.id).catch(()=>{});
    }
    return response;
  };

  function findBook(row){
    let b=state.books.find(x=>row.bookKey&&x.key===row.bookKey)||state.books.find(x=>String(x.weReadBookId||'')===String(row.bookId));
    if(!b&&row.title){const nt=normalizeText(row.title);b=state.books.find(x=>normalizeText(x.title)===nt)}
    return b||null;
  }
  function mergeProgress(row,payload){
    const b=findBook(row);if(!b)return false;const x=payload?.book||payload||{},p=n(x.progress);
    if(p||x.isStartReading){b.weReadProgress=p;if(b.progressSource!=='manual'&&!b.manualProgress)b.progress=Math.max(n(b.progress),p);b.status=p>=100?'done':p>0?'reading':b.status}
    const sec=n(x.recordReadingTime);if(sec>0)b.weReadSeconds=sec;
    if(x.updateTime)b.weReadLastRead=safeDate(x.updateTime);
    if(x.finishTime&&!b.finishedDate)b.finishedDate=safeDate(x.finishTime);
    return true;
  }
  async function saveHighlights(rows){
    if(!rows.length)return;
    if(window.yuejiHighlightsReady)await window.yuejiHighlightsReady;
    if(window.yuejiHighlightsDbReady?.())await window.yuejiPutHighlights(rows);
    else{const map=new Map((state.highlights||[]).map(h=>[h.id,h]));rows.forEach(h=>map.set(h.id,h));state.highlights=[...map.values()]}
  }
  function markRows(row,payload){const b=findBook(row);if(!b)return[];return(payload?.updated||[]).filter(x=>x.markText).map(x=>({id:`wr-mark:${x.bookmarkId||`${row.bookId}:${normalizeText(x.markText).slice(0,40)}`}`,bookKey:b.key,date:safeDate(x.createTime)||todayKey,time:n(x.createTime)*1000,quote:x.markText,note:'',bookmark:WR_HIGHLIGHT_MARKER,source:'weread',sourceId:x.bookmarkId||''}))}
  function reviewRows(row,payload){const b=findBook(row),out=[];if(!b)return out;(payload?.reviews||[]).forEach(item=>{const r=item.review||item,content=r.content||'',abstract=r.abstract||'';if(!content&&!abstract)return;out.push({id:`wr-review:${r.reviewId||`${row.bookId}:${normalizeText(content||abstract).slice(0,40)}`}`,bookKey:b.key,date:safeDate(r.createTime)||todayKey,time:n(r.createTime)*1000,quote:abstract,note:content,bookmark:WR_HIGHLIGHT_MARKER,source:'weread',sourceId:r.reviewId||''})});return out}

  async function replay(row){
    if(row.phase!=='completed'||!row.payload)return false;
    if(row.kind==='progress')return mergeProgress(row,row.payload);
    if(row.kind==='marks'){const rows=markRows(row,row.payload);if(!findBook(row))return false;await saveHighlights(rows);return true}
    if(row.kind==='reviews'){
      const b=findBook(row);if(!b)return false;
      await saveHighlights(reviewRows(row,row.payload));
      state.weRead=state.weRead&&typeof state.weRead==='object'?state.weRead:{};
      state.weRead.reviewCursors=state.weRead.reviewCursors&&typeof state.weRead.reviewCursors==='object'?state.weRead.reviewCursors:{};
      const key=String(row.bookId);
      if(row.payload?.hasMore&&row.payload?.synckey)state.weRead.reviewCursors[key]=row.payload.synckey;
      else delete state.weRead.reviewCursors[key];
      return true;
    }
    return false;
  }

  async function recover(){
    const rows=await all().catch(error=>{console.warn('Yueji inflight log unavailable',error);return[]});
    if(!rows.length){state.weRead&&(state.weRead.inflightRecoveryCount=0);return{replayed:0,pending:0}}
    let replayed=0,pending=0;
    for(const row of rows){
      if(row.phase!=='completed'){pending++;await remove(row.id).catch(()=>{});continue}
      try{
        const ok=await replay(row);
        if(ok){replayed++;try{save()}catch{};await remove(row.id)}
      }catch(error){console.warn('Yueji inflight replay deferred',row.id,error)}
      await new Promise(resolve=>setTimeout(resolve,0));
    }
    state.weRead=state.weRead&&typeof state.weRead==='object'?state.weRead:{};
    state.weRead.inflightRecoveryCount=replayed;
    state.weRead.inflightRecoveredAt=replayed?Date.now():n(state.weRead.inflightRecoveredAt);
    try{save()}catch{}
    if(replayed){try{renderAll()}catch{};const el=document.getElementById('wereadStatus');if(el)el.textContent=`已恢复 ${replayed} 个上次中断前成功返回的同步结果。`}
    return{replayed,pending};
  }

  const ready=recover();
  window.yuejiP0InflightReady=ready;
  const resume=window.yuejiP0ResumeSync;
  if(typeof resume==='function')window.yuejiP0ResumeSync=async function(){await ready;return resume()};
  window.yuejiP0InflightInfo=async()=>({count:await count(),rows:await all()});
})();