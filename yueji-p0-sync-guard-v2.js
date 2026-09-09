(()=>{
  'use strict';
  if(window.__yuejiP0SyncGuardV2Installed)return;
  window.__yuejiP0SyncGuardV2Installed=true;

  const LEASE_KEY='yueji-weread-sync-lease-v2';
  const LOCK_DB='yueji-weread-lock-v1';
  const LOCK_STORE='locks';
  const LOCK_ID='weread-sync';
  const QUEUE_DB='yueji-weread-resume-v1';
  const META_STORE='meta';
  const PROGRESS_STORE='progressQueue';
  const NOTEBOOK_STORE='notebookQueue';
  const OWNER=globalThis.crypto?.randomUUID?.()||`tab-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const LEASE_MS=15000;
  const HEARTBEAT_MS=4000;
  const START_GRACE_MS=12000;
  let heartbeat=0,monitor=0,leaseStartedAt=0,seenRunning=false,bypassButton='';

  const n=v=>Number(v)||0;
  const setStatus=(text,isError=false)=>{
    const el=document.getElementById('wereadStatus');
    if(el)el.innerHTML=`<span style="${isError?'color:#b65b5b':''}">${String(text).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#039;'}[m]))}</span>`;
  };
  const leaseLive=lease=>lease&&Number(lease.expiresAt)>Date.now();
  const mirrorLease=lease=>{try{if(lease)localStorage.setItem(LEASE_KEY,JSON.stringify(lease));else localStorage.removeItem(LEASE_KEY)}catch{}};

  function lockDb(){
    return new Promise((resolve,reject)=>{
      const req=indexedDB.open(LOCK_DB,1);
      req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains(LOCK_STORE))req.result.createObjectStore(LOCK_STORE,{keyPath:'id'})};
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error);
      req.onblocked=()=>reject(new Error('同步互斥锁数据库被其他页面占用'));
    });
  }

  async function readAuthoritativeLease(){
    const db=await lockDb();
    try{return await new Promise((resolve,reject)=>{
      const req=db.transaction(LOCK_STORE).objectStore(LOCK_STORE).get(LOCK_ID);
      req.onsuccess=()=>resolve(req.result||null);req.onerror=()=>reject(req.error);
    })}finally{db.close()}
  }

  async function acquireLease(reason='sync'){
    const db=await lockDb();
    let granted=false,row=null;
    try{
      await new Promise((resolve,reject)=>{
        const tx=db.transaction(LOCK_STORE,'readwrite'),store=tx.objectStore(LOCK_STORE),get=store.get(LOCK_ID);
        get.onsuccess=()=>{
          const current=get.result;
          if(leaseLive(current)&&current.owner!==OWNER)return;
          const now=Date.now();
          row={id:LOCK_ID,owner:OWNER,reason,startedAt:current?.owner===OWNER?current.startedAt||now:now,expiresAt:now+LEASE_MS};
          store.put(row);granted=true;
        };
        get.onerror=()=>reject(get.error);
        tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('同步互斥锁事务失败'));
      });
    }finally{db.close()}
    if(!granted)return false;
    leaseStartedAt=Date.now();seenRunning=false;mirrorLease(row);startHeartbeat();return true;
  }

  async function refreshLease(){
    let stillOwner=false,row=null;
    try{
      const db=await lockDb();
      try{
        await new Promise((resolve,reject)=>{
          const tx=db.transaction(LOCK_STORE,'readwrite'),store=tx.objectStore(LOCK_STORE),get=store.get(LOCK_ID);
          get.onsuccess=()=>{
            const current=get.result;
            if(current?.owner!==OWNER)return;
            row={...current,expiresAt:Date.now()+LEASE_MS};store.put(row);stillOwner=true;
          };
          get.onerror=()=>reject(get.error);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
        });
      }finally{db.close()}
    }catch(error){console.warn('Yueji sync lease heartbeat failed',error);return}
    if(stillOwner){mirrorLease(row);return}
    lostLease();
  }

  async function releaseLease(){
    stopHeartbeat();
    try{
      const db=await lockDb();
      try{
        await new Promise((resolve,reject)=>{
          const tx=db.transaction(LOCK_STORE,'readwrite'),store=tx.objectStore(LOCK_STORE),get=store.get(LOCK_ID);
          get.onsuccess=()=>{if(get.result?.owner===OWNER)store.delete(LOCK_ID)};
          get.onerror=()=>reject(get.error);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
        });
      }finally{db.close()}
    }catch(error){console.warn('Yueji sync lease release delayed',error)}
    const mirror=(()=>{try{return JSON.parse(localStorage.getItem(LEASE_KEY)||'null')}catch{return null}})();
    if(mirror?.owner===OWNER)mirrorLease(null);
  }

  function lostLease(){
    stopHeartbeat();window.__yuejiWeReadSyncStarting=false;
    if(window.__yuejiWeReadSyncing){
      const stop=document.getElementById('wereadStopBtn');
      if(stop&&!stop.disabled)stop.click();
      setStatus('这个页面的同步锁已经转交给另一个阅迹页面，本页已停止继续写入。已保存的数据不会删除。',true);
    }
  }
  function startHeartbeat(){
    if(!heartbeat)heartbeat=setInterval(()=>refreshLease(),HEARTBEAT_MS);
    if(!monitor)monitor=setInterval(()=>{
      const running=Boolean(window.__yuejiWeReadSyncing);
      if(running){seenRunning=true;window.__yuejiWeReadSyncStarting=false}
      if(seenRunning&&!running){releaseLease();return}
      if(!seenRunning&&Date.now()-leaseStartedAt>START_GRACE_MS){window.__yuejiWeReadSyncStarting=false;releaseLease()}
    },250);
  }
  function stopHeartbeat(){if(heartbeat){clearInterval(heartbeat);heartbeat=0}if(monitor){clearInterval(monitor);monitor=0}}

  function openQueueDb(){return new Promise((resolve,reject)=>{const req=indexedDB.open(QUEUE_DB);let created=false;req.onupgradeneeded=()=>{created=true};req.onsuccess=()=>resolve({db:req.result,created});req.onerror=()=>reject(req.error);req.onblocked=()=>reject(new Error('同步断点数据库被其他页面占用'))})}
  function deleteQueueDb(){return new Promise((resolve,reject)=>{const req=indexedDB.deleteDatabase(QUEUE_DB);req.onsuccess=resolve;req.onerror=()=>reject(req.error);req.onblocked=()=>reject(new Error('同步断点数据库正在被其他页面占用'))})}
  function getOne(db,store,key){return new Promise((resolve,reject)=>{const req=db.transaction(store).objectStore(store).get(key);req.onsuccess=()=>resolve(req.result||null);req.onerror=()=>reject(req.error)})}
  function count(db,store){return new Promise((resolve,reject)=>{const req=db.transaction(store).objectStore(store).count();req.onsuccess=()=>resolve(req.result||0);req.onerror=()=>reject(req.error)})}
  async function resetQueueState(reason){
    await deleteQueueDb();state.weRead=state.weRead&&typeof state.weRead==='object'?state.weRead:{};
    Object.assign(state.weRead,{resumeQueueVersion:0,progressCursor:0,notesCursor:0,progressTotal:0,notebooksTotal:0,progressDone:false,notesDone:false,queueRepairReason:reason,queueRepairedAt:Date.now()});
    try{save()}catch{}return{repaired:true,reason};
  }
  async function validateResumeQueue(){
    state.weRead=state.weRead&&typeof state.weRead==='object'?state.weRead:{};
    let opened;try{opened=await openQueueDb()}catch(error){return{ok:false,error}}
    const {db,created}=opened;
    try{
      const names=db.objectStoreNames,storesOk=names.contains(META_STORE)&&names.contains(PROGRESS_STORE)&&names.contains(NOTEBOOK_STORE);
      if(created||!storesOk){db.close();return{ok:true,...await resetQueueState('queue-schema-missing')}}
      const meta=await getOne(db,META_STORE,'queue');if(!meta)return{ok:true,empty:true};
      const progressCount=await count(db,PROGRESS_STORE),notebookCount=await count(db,NOTEBOOK_STORE),pc=n(state.weRead.progressCursor),nc=n(state.weRead.notesCursor);
      if(n(meta.baseSyncAt)!==n(state.weRead.lastSync))return{ok:true,stale:true};
      if(!state.weRead.progressDone&&n(state.weRead.progressTotal)>0&&progressCount===0){db.close();return{ok:true,...await resetQueueState('progress-queue-empty')}}
      if(meta.notebookBuildComplete&&!state.weRead.notesDone&&n(state.weRead.notebooksTotal)>0&&notebookCount===0){db.close();return{ok:true,...await resetQueueState('notebook-queue-empty')}}
      let repaired=false;
      if(pc>progressCount){state.weRead.progressCursor=0;state.weRead.progressDone=false;state.weRead.queueRepairReason='progress-cursor-out-of-range';state.weRead.queueRepairedAt=Date.now();repaired=true}
      if(meta.notebookBuildComplete&&nc>notebookCount){state.weRead.notesCursor=0;state.weRead.notesDone=false;state.weRead.queueRepairReason='notes-cursor-out-of-range';state.weRead.queueRepairedAt=Date.now();repaired=true}
      if(meta.notebookBuildComplete&&n(meta.notebookOrder)<notebookCount){db.close();return{ok:true,...await resetQueueState('notebook-order-invalid')}}
      state.weRead.progressTotal=progressCount;if(meta.notebookBuildComplete)state.weRead.notebooksTotal=notebookCount;try{save()}catch{}
      return{ok:true,progressCount,notebookCount,repaired};
    }finally{try{db.close()}catch{}}
  }

  async function heldByOther(){const lease=await readAuthoritativeLease().catch(()=>null);return leaseLive(lease)&&lease.owner!==OWNER}
  async function runContinue(){
    window.__yuejiWeReadSyncStarting=true;
    if(await heldByOther()){window.__yuejiWeReadSyncStarting=false;return setStatus('另一个阅迹页面正在同步。当前页面没有启动第二个任务。',true)}
    if(!await acquireLease('continue')){window.__yuejiWeReadSyncStarting=false;return setStatus('另一个阅迹页面刚刚取得同步锁。当前页面没有启动第二个任务。',true)}
    try{
      setStatus('正在校验本地断点……');const health=await validateResumeQueue();if(!health.ok)throw health.error||new Error('断点校验失败');
      if(health.repaired)setStatus('检测到旧断点异常，已经回到可验证的位置继续。');
      if(typeof window.yuejiP0ResumeSync!=='function')throw new Error('继续同步模块尚未加载完成');
      await window.yuejiP0ResumeSync();
    }catch(error){window.__yuejiWeReadSyncStarting=false;releaseLease();console.error('Yueji P0 queue guard failed',error);setStatus(`继续同步没有启动：${error?.message||error}。现有阅读数据没有删除。`,true)}
  }

  async function runLegacyButton(button,id){
    window.__yuejiWeReadSyncStarting=true;
    if(await heldByOther()){window.__yuejiWeReadSyncStarting=false;return setStatus('另一个阅迹页面正在同步。当前页面已阻止重复启动。',true)}
    if(!await acquireLease(id)){window.__yuejiWeReadSyncStarting=false;return setStatus('另一个阅迹页面刚刚取得同步锁。当前任务没有重复启动。',true)}
    bypassButton=id;
    try{button.click()}finally{bypassButton=''}
  }

  if(state.weRead?.syncState==='running'&&!window.__yuejiWeReadSyncing){state.weRead.syncState='paused';state.weRead.interruptedAt=Date.now();try{save()}catch{}}

  document.addEventListener('click',event=>{
    const button=event.target?.closest?.('button');if(!button)return;const id=button.id;
    if(bypassButton===id)return;
    if(id==='wereadContinueBtn'){event.preventDefault();event.stopImmediatePropagation();runContinue();return}
    if(!['wereadConnectBtn','wereadSyncBtn','wereadRestartBtn'].includes(id))return;
    event.preventDefault();event.stopImmediatePropagation();runLegacyButton(button,id);
  },true);

  window.addEventListener('pagehide',()=>{if(!window.__yuejiWeReadSyncing)releaseLease()});
  window.yuejiP0ValidateResumeQueue=validateResumeQueue;
  window.yuejiP0SyncLeaseInfo=async()=>({owner:OWNER,lease:await readAuthoritativeLease().catch(()=>null),starting:Boolean(window.__yuejiWeReadSyncStarting),running:Boolean(window.__yuejiWeReadSyncing)});
})();
