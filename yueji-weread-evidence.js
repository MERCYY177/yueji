(()=>{
  'use strict';

  const n=v=>Number(v)||0;

  function hasVerifiedWeReadReading(book){
    if(!book||!Array.isArray(book.sources)||!book.sources.includes('weread'))return false;
    return n(book.weReadSeconds)>0 || n(book.weReadProgress)>0 || book.weReadStarted===true || book.weReadStarted===1;
  }

  function cleanAmbiguousWeReadDates(){
    if(!window.state||!Array.isArray(state.books))return false;
    let changed=false;
    state.books.forEach(book=>{
      if(!book||!Array.isArray(book.sources)||!book.sources.includes('weread'))return;
      if(book.weReadLastRead&&!hasVerifiedWeReadReading(book)){
        // Keep the shelf timestamp for provenance/debugging, but do not let it
        // masquerade as a verified book-level reading date in 阅读演化.
        if(!book.weReadShelfReadUpdate)book.weReadShelfReadUpdate=book.weReadLastRead;
        delete book.weReadLastRead;
        changed=true;
      }
    });
    return changed;
  }

  const originalSave=window.save;
  if(typeof originalSave==='function'){
    window.save=function(...args){
      cleanAmbiguousWeReadDates();
      return originalSave.apply(this,args);
    };
  }

  if(cleanAmbiguousWeReadDates()&&typeof originalSave==='function'){
    originalSave();
  }

  document.addEventListener('DOMContentLoaded',()=>{
    if(cleanAmbiguousWeReadDates()&&typeof originalSave==='function')originalSave();
  },{once:true});
})();
