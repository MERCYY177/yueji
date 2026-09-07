(()=>{
  'use strict';
  const load=(src,done)=>{
    const s=document.createElement('script');
    s.src=src+'?v=20260907-weread-evidence';
    if(done)s.onload=done;
    document.head.appendChild(s);
  };
  load('yueji-weread-evidence.js',()=>load('yueji-fix-core.js',()=>load('yueji-layout.js')));
})();
