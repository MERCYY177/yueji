(()=>{
  'use strict';
  const load=(src,done)=>{
    const s=document.createElement('script');
    s.src=src+'?v=20260907-covers-green-overflow';
    if(done)s.onload=done;
    document.head.appendChild(s);
  };
  load('yueji-fix-core.js',()=>load('yueji-layout.js'));
})();
