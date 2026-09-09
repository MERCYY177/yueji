(()=>{
  'use strict';
  if(window.__yuejiP0RuntimeAuditInstalled)return;
  window.__yuejiP0RuntimeAuditInstalled=true;

  const REQUIRED_FLAGS=['__yuejiP0SyncGuardV2Installed','__yuejiP0FailuresInstalled','__yuejiP0InflightInstalled','__yuejiP0ChainTestInstalled'];
  const REQUIRED_FUNCTIONS=['yuejiP0ValidateResumeQueue','yuejiP0ResumeSync','yuejiP0FailureCount','yuejiP0InflightInfo','yuejiP0RunChainStress'];
  const SCRIPT_ORDER=['yueji-p0-sync-guard-v2.js','yueji-p0-resume.js','yueji-p0-failures.js','yueji-p0-inflight.js','yueji-p0-chain-test.js','yueji-p0-runtime-audit.js'];
  let report=null;

  function scriptMatches(name){return[...document.scripts].filter(s=>String(s.src||'').includes(name))}
  function status(text){const el=document.getElementById('wereadStatus');if(el)el.textContent=text}

  function runAudit(){
    const errors=[],warnings=[];
    const missingFlags=REQUIRED_FLAGS.filter(k=>!window[k]);
    if(missingFlags.length)errors.push(`模块标记缺失：${missingFlags.join('、')}`);
    const missingFunctions=REQUIRED_FUNCTIONS.filter(k=>typeof window[k]!=='function');
    if(missingFunctions.length)errors.push(`模块函数缺失：${missingFunctions.join('、')}`);

    const duplicateScripts=[];
    for(const name of SCRIPT_ORDER){const count=scriptMatches(name).length;if(count>1)duplicateScripts.push(`${name} × ${count}`)}
    if(duplicateScripts.length)errors.push(`P0 脚本重复加载：${duplicateScripts.join('、')}`);
    if(scriptMatches('yueji-p0-sync-guard.js').length)errors.push('旧版同步锁仍在页面中，已阻止同步以避免双重监听。');

    const positions=SCRIPT_ORDER.map(name=>({name,index:[...document.scripts].findIndex(s=>String(s.src||'').includes(name))}));
    for(let i=1;i<positions.length;i++){
      if(positions[i-1].index>=0&&positions[i].index>=0&&positions[i].index<positions[i-1].index){errors.push(`P0 加载顺序异常：${positions[i].name} 早于 ${positions[i-1].name}`);break}
    }

    const buttonIds=['wereadConnectBtn','wereadSyncBtn','wereadContinueBtn','wereadRestartBtn','wereadStopBtn'];
    const duplicateIds=buttonIds.filter(id=>document.querySelectorAll(`#${id}`).length>1);
    if(duplicateIds.length)errors.push(`同步控件重复：${duplicateIds.join('、')}`);
    if(state.weRead?.syncState==='running'&&!window.__yuejiWeReadSyncing){warnings.push('检测到上次异常关闭留下的 running 状态；同步锁模块应已将它恢复为 paused。')}

    const healthy=errors.length===0;
    state.weRead=state.weRead&&typeof state.weRead==='object'?state.weRead:{};
    state.weRead.p0RuntimeHealthy=healthy;
    state.weRead.p0RuntimeAuditAt=Date.now();
    state.weRead.p0RuntimeErrors=errors.slice(0,8);
    try{save()}catch{}
    report={healthy,errors,warnings,checkedAt:Date.now(),scripts:positions};
    if(!healthy){state.weRead.autoRetryBlocked=true;try{save()}catch{};status(`P0 同步保护没有完整加载：${errors[0]} 已暂停自动同步和继续同步，现有阅读数据没有删除。`)}
    return report;
  }

  document.addEventListener('click',event=>{
    const id=event.target?.closest?.('button')?.id;
    if(!['wereadConnectBtn','wereadSyncBtn','wereadContinueBtn','wereadRestartBtn'].includes(id))return;
    if(state.weRead?.p0RuntimeHealthy!==false)return;
    event.preventDefault();event.stopImmediatePropagation();
    status('P0 同步保护当前不完整，本页没有启动同步。刷新页面后可再次检查；现有阅读数据不会删除。');
  },true);

  report=runAudit();
  window.yuejiP0RuntimeAudit=runAudit;
  window.yuejiP0RuntimeAuditReport=()=>report;
})();
