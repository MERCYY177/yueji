(()=>{
  'use strict';
  if(window.__yuejiP0ProgressFirstInstalled)return;
  window.__yuejiP0ProgressFirstInstalled=true;

  const QUEUE_DB='yueji-weread-resume-v1';
  const PROGRESS_STORE='progressQueue';
  const GATEWAY='/.netlify/functions/weread-gateway';
  const SKILL_VERSION='1.0.5';
  const REQUEST_TIMEOUT_MS=8000;

  const n=v=>Number(v)||0;
  const safeDate=ts=>{const num=Number(ts);if(!num)return'';const d=new Date(num<1e12?num*1000:num);return Number.isNaN(d.getTime())?'':dateKey(d)};
  const setStatus=text=>{const el=document.getElementById('wereadStatus');if(el)el.textContent=text};

  function openExistingQueue(){
    return new Promise((resolve,reject)=>{
      const req=indexedDB.open(QUEUE_DB);
      let created=false;
      req.onupgradeneeded=()=>{created=true};
      req.onsuccess=()=>resolve({db:req.result,created});
      req.onerror=()=>reject(req.error);
    });
  }
  function getRow(db,i){
    return new Promise((resolve,reject)=>{
      const req=db.transaction(PROGRESS_STORE).objectStore(PROGRESS_STORE).get(i);
      req.onsuccess=()=>resolve(req.result||null);
      req.onerror=()=>reject(req.error);
    });
  }
  function countRows(db){
    return new Promise((resolve,reject)=>{
      const req=db.transaction(PROGRESS_STORE).objectStore(PROGRESS_STORE).count();
      req.onsuccess=()=>resolve(req.result||0);
      req.onerror=()=>reject(req.error);
    });
  }
  async function apiCall(bookId){
    const key=localStorage.getItem('yueji-weread-key');
    if(!key)throw new Error('没有 Skill Key');
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),REQUEST_TIMEOUT_MS);
    let response,text,data;
    try{
      response=await fetch(GATEWAY,{method:'POST',headers:{'Authorization':`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({api_name:'/book/getprogress',skill_version:SKILL_VERSION,bookId}),signal:controller.signal});
      text=await response.text();
    }finally{clearTimeout(timer)}
    try{data=window.yuejiParseJsonText?await window.yuejiParseJsonText(text):JSON.parse(text)}catch{throw new Error(`微信读书返回了无法解析的响应（${response.status}）`)}
    if(!response.ok||(data?.errcode&&data.errcode!==0))throw new Error(data?.errmsg||data?.message||`微信读书接口错误（${response.status}）`);
    return data?.data&&typeof data.data==='object'?data.data:data;
  }
  function merge(row,payload){
    const book=state.books.find(x=>String(x.weReadBookId||'')===String(row.bookId));
    if(!book)return false;
    const x=payload?.book||payload||{},p=n(x.progress);
    if(p||x.isStartReading){book.weReadProgress=p;if(book.progressSource!=='manual'&&!book.manualProgress)book.progress=Math.max(n(book.progress),p);book.status=p>=100?'done':p>0?'reading':book.status}
    const sec=n(x.recordReadingTime);if(sec>0)book.weReadSeconds=sec;
    if(x.updateTime)book.weReadLastRead=safeDate(x.updateTime);
    if(x.finishTime&&!book.finishedDate)book.finishedDate=safeDate(x.finishTime);
    return true;
  }

  async function runPriority(){
    if(state.weRead?.progressDone||n(state.weRead?.resumeQueueVersion)!==1)return{processed:0,skipped:true};
    let opened;
    try{opened=await openExistingQueue()}catch{return{processed:0,skipped:true}}
    const {db,created}=opened;
    try{
      if(created||!db.objectStoreNames.contains(PROGRESS_STORE))return{processed:0,skipped:true};
      const total=await countRows(db);if(!total)return{processed:0,skipped:true};
      const cursor=Math.min(n(state.weRead?.progressCursor),total);
      if(cursor>=total){state.weRead.progressDone=true;state.weRead.progressCursor=0;try{save()}catch{};return{processed:0,done:true}}
      const row=await getRow(db,cursor);if(!row)return{processed:0,skipped:true};
      setStatus(`先补一条阅读进度 ${cursor+1}/${total}，再继续书摘目录……`);
      let payload;
      try{payload=await apiCall(row.bookId)}catch(error){console.warn('Yueji priority progress deferred',row.bookId,error);return{processed:0,error:String(error?.message||error)}}
      if(!merge(row,payload))return{processed:0,skipped:true};
      const next=cursor+1,done=next>=total;
      state.weRead.progressTotal=total;
      state.weRead.progressCursor=done?0:next;
      state.weRead.progressDone=done;
      try{save()}catch{}
      return{processed:1,done,total,next:done?total:next};
    }finally{try{db.close()}catch{}}
  }

  const original=window.yuejiP0ResumeSync;
  if(typeof original==='function')window.yuejiP0ResumeSync=async function(){await runPriority();return original()};
  window.yuejiP0ProgressFirst=runPriority;
})();