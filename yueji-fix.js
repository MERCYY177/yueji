(()=>{
  'use strict';
  const load=(src,done,version='20260907-weread-evidence2')=>{
    const s=document.createElement('script');
    s.src=src+'?v='+version;
    if(done)s.onload=done;
    document.head.appendChild(s);
  };
  load('yueji-weread-evidence.js',()=>load('yueji-fix-core.js',()=>load('yueji-layout.js')));
})();
