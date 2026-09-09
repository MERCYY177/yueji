(()=>{
  'use strict';
  document.title='阅迹';
  const wr=state.weRead&&typeof state.weRead==='object'?state.weRead:(state.weRead={});
  window.__yuejiP0AutoGate={previousBlocked:Boolean(wr.autoRetryBlocked),startedAt:Date.now()};
  wr.autoRetryBlocked=true;
  const load=(src,done)=>{
    const s=document.createElement('script');
    s.src=src+'?v=20260909-p0-resume4';
    if(done)s.onload=done;
    document.head.appendChild(s);
  };
  load('yueji-weread-evidence.js',()=>load('yueji-fix-core.js',()=>load('yueji-layout.js',()=>load('yueji-book-cover.js',()=>load('yueji-onboarding.js',()=>load('yueji-p0-sync-guard.js',()=>load('yueji-p0-resume.js',()=>load('yueji-p0-failures.js',()=>load('yueji-p0-auto-lock.js')))))))));
})();
