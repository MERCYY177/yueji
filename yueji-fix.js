(()=>{
  'use strict';
  document.title='阅迹';
  const load=(src,done)=>{
    const s=document.createElement('script');
    s.src=src+'?v=20260909-p0-resume1';
    if(done)s.onload=done;
    document.head.appendChild(s);
  };
  load('yueji-weread-evidence.js',()=>load('yueji-fix-core.js',()=>load('yueji-layout.js',()=>load('yueji-book-cover.js',()=>load('yueji-onboarding.js',()=>load('yueji-p0-resume.js'))))));
})();
