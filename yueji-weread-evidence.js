(()=>{
  'use strict';

  const n=v=>Number(v)||0;
  const getState=()=>{
    try{return typeof state!=='undefined'&&state&&Array.isArray(state.books)?state:null}catch{return null}
  };

  function hasVerifiedWeReadReading(book){
    if(!book||!Array.isArray(book.sources)||!book.sources.includes('weread'))return false;
    return n(book.weReadSeconds)>0 || n(book.weReadProgress)>0 || book.weReadStarted===true || book.weReadStarted===1;
  }

  function cleanAmbiguousWeReadDates(){
    const st=getState();
    if(!st)return false;
    let changed=false;
    st.books.forEach(book=>{
      if(!book||!Array.isArray(book.sources)||!book.sources.includes('weread'))return;
      if(book.weReadLastRead&&!hasVerifiedWeReadReading(book)){
        if(!book.weReadShelfReadUpdate)book.weReadShelfReadUpdate=book.weReadLastRead;
        delete book.weReadLastRead;
        changed=true;
      }
    });
    return changed;
  }

  let originalSave;
  try{originalSave=typeof save==='function'?save:null}catch{originalSave=null}
  if(originalSave){
    const wrappedSave=function(...args){
      cleanAmbiguousWeReadDates();
      return originalSave.apply(this,args);
    };
    try{save=wrappedSave}catch{window.save=wrappedSave}
  }

  const persistClean=()=>{
    if(!cleanAmbiguousWeReadDates())return;
    try{
      if(originalSave)originalSave();
      else{
        const st=getState();
        if(st)localStorage.setItem('yueji-archive-v1',JSON.stringify(st));
      }
    }catch(e){console.warn('WeRead evidence cleanup save skipped',e)}
  };

  // Clean already-synced false reading dates immediately and again after the
  // initial auto-sync window. This only removes the derived book-level date;
  // the original shelf timestamp remains in weReadShelfReadUpdate.
  persistClean();
  setTimeout(persistClean,900);
  setTimeout(persistClean,2500);
})();
