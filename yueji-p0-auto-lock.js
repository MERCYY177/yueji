(()=>{
  'use strict';
  if(window.__yuejiP0AutoLockInstalled)return;
  window.__yuejiP0AutoLockInstalled=true;

  const AUTO_SYNC_MS=6*60*60*1000;
  const gate=window.__yuejiP0AutoGate||{};
  const started=Number(gate.startedAt)||Date.now();
  const delay=Math.max(0,900-(Date.now()-started));

  setTimeout(async()=>{
    try{if(window.yuejiP0InflightReady)await window.yuejiP0InflightReady}catch(error){console.warn('Yueji inflight recovery did not finish before auto sync',error)}
    const previousBlocked=Boolean(gate.previousBlocked);
    if(state.weRead&&typeof state.weRead==='object')state.weRead.autoRetryBlocked=previousBlocked;
    delete window.__yuejiP0AutoGate;

    const key=localStorage.getItem('yueji-weread-key');
    const lastSync=Number(state.weRead?.lastSync)||0;
    const due=Date.now()-lastSync>=AUTO_SYNC_MS;
    if(previousBlocked||state.weRead?.p0RuntimeHealthy===false||!key||!due||window.__yuejiWeReadSyncing||window.__yuejiWeReadSyncStarting||window.__yuejiArchiveBusy)return;

    const button=document.getElementById('wereadSyncBtn');
    if(!button||button.disabled)return;
    window.__yuejiP0AutoTrigger=true;
    try{button.click()}finally{queueMicrotask(()=>{window.__yuejiP0AutoTrigger=false})}
  },delay);
})();
