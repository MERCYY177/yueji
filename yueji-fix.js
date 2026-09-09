(()=>{
  'use strict';
  document.title='阅迹';
  const wr=state.weRead&&typeof state.weRead==='object'?state.weRead:(state.weRead={});
  const ASSET_VERSION='20260909-p0-final1';
  window.__yuejiP0AssetVersion=ASSET_VERSION;
  window.__yuejiP0AutoGate={previousBlocked:Boolean(wr.autoRetryBlocked),startedAt:Date.now()};
  wr.autoRetryBlocked=true;
  const loaded=window.__yuejiLoadedScripts||(window.__yuejiLoadedScripts=new Set());
  const load=(src,done)=>{
    if(loaded.has(src)){if(done)queueMicrotask(done);return}
    loaded.add(src);
    const s=document.createElement('script');
    s.src=src+'?v='+ASSET_VERSION;
    s.onload=()=>{if(done)done()};
    s.onerror=()=>loaded.delete(src);
    document.head.appendChild(s);
  };
  load('yueji-weread-evidence.js',()=>load('yueji-fix-core.js',()=>load('yueji-layout.js',()=>load('yueji-book-cover.js',()=>load('yueji-onboarding.js',()=>load('yueji-p0-sync-guard-v2.js',()=>load('yueji-p0-resume.js',()=>load('yueji-p0-progress-first.js',()=>load('yueji-p0-failures.js',()=>load('yueji-p0-inflight.js',()=>load('yueji-p0-chain-test.js',()=>load('yueji-p0-runtime-audit.js',()=>load('yueji-p0-auto-lock.js')))))))))))));
})();