(()=>{
  'use strict';
  document.title='阅迹';
  const load=(src,done)=>{
    const s=document.createElement('script');
    s.src=src+'?v=20260910-evidence-v2';
    if(done)s.onload=done;
    document.head.appendChild(s);
  };
  load('yueji-p1-identity-migration.js',()=>load('yueji-weread-evidence.js',()=>load('yueji-fix-core.js',()=>load('yueji-layout.js',()=>load('yueji-book-cover.js',()=>load('yueji-onboarding.js'))))));
})();
