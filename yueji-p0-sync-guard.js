(()=>{
  'use strict';

  const LEASE_KEY='yueji-weread-sync-lease-v1';
  const QUEUE_DB='yueji-weread-resume-v1';
  const META_STORE='meta';
  const PROGRESS_STORE='progressQueue';
  const NOTEBOOK_STORE='notebookQueue';
  const OWNER=globalThis.crypto?.randomUUID?.()||`tab-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const LEASE_MS=15000;
  const HEARTBEAT_MS=4000;
  const START_GRACE_MS=2500;
  let heartbeat=0,monitor=0,leaseStartedAt=0,seenRunning=false;

  const n=v=>Number(v)||0;
  const readLease=()=>{try{return JSON.parse(localStorage.getItem(LEASE_KEY)||'null')}catch{return null}};
  const writeLease=lease=>localStorage.setItem(LEASE_KEY,JSON.stringify(lease));
  const leaseLive=lease=>lease&&Number(lease.expiresAt)>Date.now();
  const heldByOther=()=>{const lease=readLease();return leaseLive(lease)&&lease.owner!==OWNER};
  const setStatus=(text,isError=false)=>{
    const el=document.getElementById('wereadStatus');
    if(el)el.innerHTML=`<span style="${isError?'color:#b65b5b':''}">${String(text).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]))}</span>`;
  };

  function acquireLease(reason='sync'){
    const current=readLease();
    if(leaseLive(current)&&current.owner!==OWNER)return false;
    leaseStartedAt=Date.now();
    seenRunning=false;
    writeLease({owner:OWNER,reason,startedAt:current?.owner===OWNER?current.startedAt||Date.now():Date.now(),expiresAt:Date.now()+LEASE_MS});
    startHeartbeat();
    return true;
  }
  function refreshLease(){
    const current=readLease();
    if(!current||current.owner!==OWNER)return stopHeartbeat();
    writeLease({...current,expiresAt:Date.now()+LEASE_MS});
  }
  function releaseLease(){
    const current=readLease();
    if(current?.owner===OWNER)localStorage.removeItem(LEASE_KEY);
    stopHeartbeat();
  }
  function startHeartbeat(){
    if(!heartbeat)heartbeat=setInterval(refreshLease,HEARTBEAT_MS);
    if(!monitor)monitor=setInterval(()=>{
      const running=Boolean(window.__yuejiWeReadSyncing);
      if(running)seenRunning=true;
      if(seenRunning&&!running){releaseLease();return}
      if(!seenRunning&&Date.now()-leaseStartedAt>START_GRACE_MS)releaseLease();
    },200);
  }
  function stopHeartbeat(){
    if(heartbeat){clearInterval(heartbeat);heartbeat=0}
    if(monitor){clearInterval(monitor);monitor=0}
  }

  function openQueueDb(){
    return new Promise((resolve,reject)=>{
      const req=indexedDB.open(QUEUE_DB);
      let created=false;
      req.onupgradeneeded=()=>{created=true};
      req.onsuccess=()=>resolve({db:req.result,created});
      req.onerror=()=>reject(req.error);
      req.onblocked=()=>reject(new Error('同步断点数据库被其他页面占用'));
    });
  }
  function deleteQueueDb(){
    return new Promise((resolve,reject)=>{
      const req=indexedDB.deleteDatabase(QUEUE_DB);
      req.onsuccess=()=>resolve();
      req.onerror=()=>reject(req.error);
      req.onblocked=()=>reject(new Error('同步断点数据库正在被其他页面占用'));
    });
  }
  function getOne(db,store,key){
    return new Promise((resolve,reject)=>{
      const req=db.transaction(store).objectStore(store).get(key);
      req.onsuccess=()=>resolve(req.result||null);
      req.onerror=()=>reject(req.error);
    });
  }
  function count(db,store){
    return new Promise((resolve,reject)=>{
      const req=db.transaction(store).objectStore(store).count();
      req.onsuccess=()=>resolve(req.result||0);
      req.onerror=()=>reject(req.error);
    });
  }
  async function resetQueueState(reason){
    try{await deleteQueueDb()}catch(error){console.warn('Yueji queue reset delayed',error);throw error}
    state.weRead=state.weRead&&typeof state.weRead==='object'?state.weRead:{};
    state.weRead.resumeQueueVersion=0;
    state.weRead.progressCursor=0;
    state.weRead.notesCursor=0;
    state.weRead.progressTotal=0;
    state.weRead.notebooksTotal=0;
    state.weRead.queueRepairReason=reason;
    state.weRead.queueRepairedAt=Date.now();
    try{save()}catch{}
    return{repaired:true,reason};
  }

  async function validateResumeQueue(){
    state.weRead=state.weRead&&typeof state.weRead==='object'?state.weRead:{};
    let opened;
    try{opened=await openQueueDb()}catch(error){return{ok:false,error}}
    const {db,created}=opened;
    try{
      const names=db.objectStoreNames;
      const storesOk=names.contains(META_STORE)&&names.contains(PROGRESS_STORE)&&names.contains(NOTEBOOK_STORE);
      if(created||!storesOk){db.close();await resetQueueState('queue-schema-missing');return{ok:true,repaired:true,reason:'queue-schema-missing'}}
      const meta=await getOne(db,META_STORE,'queue');
      if(!meta)return{ok:true,empty:true};
      const progressCount=await count(db,PROGRESS_STORE),notebookCount=await count(db,NOTEBOOK_STORE);
      const pc=n(state.weRead.progressCursor),nc=n(state.weRead.notesCursor);
      const baseMatches=n(meta.baseSyncAt)===n(state.weRead.lastSync);
      if(!baseMatches)return{ok:true,stale:true};
      if(!state.weRead.progressDone&&n(state.weRead.progressTotal)>0&&progressCount===0){
        db.close();await resetQueueState('progress-queue-empty');return{ok:true,repaired:true,reason:'progress-queue-empty'}
      }
      if(meta.notebookBuildComplete&&!state.weRead.notesDone&&n(state.weRead.notebooksTotal)>0&&notebookCount===0){
        db.close();await resetQueueState('notebook-queue-empty');return{ok:true,repaired:true,reason:'notebook-queue-empty'}
      }
      if(pc>progressCount){
        state.weRead.progressCursor=0;
        state.weRead.progressDone=false;
        state.weRead.queueRepairReason='progress-cursor-out-of-range';
        state.weRead.queueRepairedAt=Date.now();
      }
      if(meta.notebookBuildComplete&&nc>notebookCount){
        state.weRead.notesCursor=0;
        state.weRead.notesDone=false;
        state.weRead.queueRepairReason='notes-cursor-out-of-range';
        state.weRead.queueRepairedAt=Date.now();
      }
      if(meta.notebookBuildComplete&&n(meta.notebookOrder)<notebookCount){
        db.close();await resetQueueState('notebook-order-invalid');return{ok:true,repaired:true,reason:'notebook-order-invalid'}
      }
      state.weRead.progressTotal=progressCount;
      if(meta.notebookBuildComplete)state.weRead.notebooksTotal=notebookCount;
      try{save()}catch{}
      return{ok:true,progressCount,notebookCount,repaired:Boolean(state.weRead.queueRepairReason&&state.weRead.queueRepairedAt)};
    }finally{
      if(db.objectStoreNames.length)try{db.close()}catch{}
    }
  }

  async function runContinue(){
    if(heldByOther())return setStatus('另一个阅迹页面正在同步。为避免两份任务互相覆盖，请先等另一页结束或关闭另一页。',true);
    if(!acquireLease('continue'))return setStatus('另一个阅迹页面正在同步。当前页面没有启动第二个任务。',true);
    try{
      setStatus('正在校验本地断点……');
      const health=await validateResumeQueue();
      if(!health.ok)throw health.error||new Error('断点校验失败');
      if(health.repaired)setStatus('检测到旧断点异常，已经安全重建；接下来会从可验证的位置继续。');
      if(typeof window.yuejiP0ResumeSync!=='function')throw new Error('继续同步模块尚未加载完成');
      await window.yuejiP0ResumeSync();
    }catch(error){
      releaseLease();
      console.error('Yueji P0 queue guard failed',error);
      setStatus(`继续同步没有启动：${error?.message||error}。现有阅读数据没有删除。`,true);
    }
  }

  document.addEventListener('click',event=>{
    const button=event.target?.closest?.('button');
    if(!button)return;
    const id=button.id;
    if(id==='wereadContinueBtn'){
      event.preventDefault();event.stopImmediatePropagation();
      runContinue();
      return;
    }
    if(!['wereadConnectBtn','wereadSyncBtn','wereadRestartBtn'].includes(id))return;
    if(heldByOther()){
      event.preventDefault();event.stopImmediatePropagation();
      setStatus('另一个阅迹页面正在同步。当前页面已阻止重复启动。',true);
      return;
    }
    if(!acquireLease(id)){
      event.preventDefault();event.stopImmediatePropagation();
      setStatus('同步任务没有重复启动。');
    }
  },true);

  window.addEventListener('storage',event=>{
    if(event.key!==LEASE_KEY)return;
    const lease=readLease();
    if(window.__yuejiWeReadSyncing&&leaseLive(lease)&&lease.owner!==OWNER){
      console.warn('Another Yueji tab acquired the sync lease unexpectedly');
    }
  });
  window.addEventListener('pagehide',()=>{
    if(!window.__yuejiWeReadSyncing)releaseLease();
  });

  window.yuejiP0ValidateResumeQueue=validateResumeQueue;
  window.yuejiP0SyncLeaseInfo=()=>({owner:OWNER,lease:readLease(),heldByOther:heldByOther()});
})();
