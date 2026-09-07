(()=>{
  'use strict';

  const SOURCE_PREFIX='__yueji_source_cover__:';
  let previewUrl='';

  function injectStyles(){
    if(document.getElementById('yuejiBookCoverStyles'))return;
    const s=document.createElement('style');
    s.id='yuejiBookCoverStyles';
    s.textContent=`
      .book-cover-editor{margin:14px 0;padding:14px;border:1px solid var(--line);border-radius:16px;background:var(--soft)}
      .book-cover-editor-head{display:flex;align-items:center;gap:14px}
      .book-cover-preview{position:relative;width:78px;aspect-ratio:2/3;flex:none;border-radius:7px;overflow:hidden;border:1px solid var(--line);background:var(--card);display:grid;place-items:center}
      .book-cover-preview img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:none}
      .book-cover-preview.has-image img{display:block}
      .book-cover-preview span{padding:8px;text-align:center;color:var(--muted);font-size:.7rem;line-height:1.35}
      .book-cover-preview.has-image span{display:none}
      .book-cover-editor-copy{min-width:0;flex:1}.book-cover-editor-copy b{display:block;margin-bottom:5px}.book-cover-editor-copy small{display:block;color:var(--muted);line-height:1.55}
      .book-cover-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
      .book-cover-file{display:inline-flex;align-items:center;justify-content:center;cursor:pointer}
      @media(max-width:520px){.book-cover-editor-head{align-items:flex-start}.book-cover-preview{width:68px}}
    `;
    document.head.appendChild(s);
  }

  function deleteCoverBlob(key){
    return coverDb().then(db=>new Promise((resolve,reject)=>{
      const tx=db.transaction('covers','readwrite');
      tx.objectStore('covers').delete(key);
      tx.oncomplete=()=>{db.close();resolve()};
      tx.onerror=()=>{db.close();reject(tx.error)};
    }));
  }

  async function normalizeImage(file){
    if(!file?.type?.startsWith('image/'))throw new Error('请选择图片文件');
    const bmp=await createImageBitmap(file);
    const maxW=1200,maxH=1800,scale=Math.min(1,maxW/bmp.width,maxH/bmp.height);
    const w=Math.max(1,Math.round(bmp.width*scale)),h=Math.max(1,Math.round(bmp.height*scale));
    const c=document.createElement('canvas');c.width=w;c.height=h;
    c.getContext('2d').drawImage(bmp,0,0,w,h);bmp.close?.();
    const blob=await new Promise(resolve=>c.toBlob(resolve,'image/webp',.9));
    return blob||file;
  }

  function installEditor(){
    const sheet=document.getElementById('bookSheet'),note=document.getElementById('bookDataNote');
    if(!sheet||!note||document.getElementById('bookCoverEditor'))return;
    const box=document.createElement('div');
    box.id='bookCoverEditor';box.className='book-cover-editor';
    box.innerHTML=`
      <div class="book-cover-editor-head">
        <div class="book-cover-preview" id="bookCoverPreview"><img alt="图书封面"><span>暂无封面</span></div>
        <div class="book-cover-editor-copy"><b>图书封面</b><small>可以自己选择图片替换封面。自定义封面保存在当前浏览器，不会被微信读书再次同步覆盖。</small>
          <div class="book-cover-actions">
            <label class="soft-btn book-cover-file">选择 / 更换封面<input id="bookCoverFile" type="file" accept="image/*" hidden></label>
            <button class="soft-btn" id="restoreBookCover" type="button">恢复来源封面</button>
          </div>
        </div>
      </div>`;
    note.before(box);

    document.getElementById('bookCoverFile').addEventListener('change',async e=>{
      const file=e.target.files?.[0],key=document.getElementById('bookKey')?.value,b=key?book(key):null;
      if(!file||!b)return;
      try{
        const existing=await getCover(key).catch(()=>null);
        if(existing&&!b.manualCover){
          const sourceBackup=await getCover(SOURCE_PREFIX+key).catch(()=>null);
          if(!sourceBackup)await putCovers([{bookKey:SOURCE_PREFIX+key,blob:existing}]);
        }
        const blob=await normalizeImage(file);
        await putCovers([{bookKey:key,blob}]);
        b.manualCover=true;delete b.visualColor;save();
        await refreshPreview(key);
        try{renderAll()}catch{}
        toast('封面已更新');
      }catch(err){console.error(err);toast('这个封面无法读取')}
      e.target.value='';
    });

    document.getElementById('restoreBookCover').addEventListener('click',async()=>{
      const key=document.getElementById('bookKey')?.value,b=key?book(key):null;if(!b)return;
      try{
        const source=await getCover(SOURCE_PREFIX+key).catch(()=>null);
        if(source)await putCovers([{bookKey:key,blob:source}]);
        else await deleteCoverBlob(key);
        b.manualCover=false;delete b.visualColor;save();
        await refreshPreview(key);
        try{renderAll()}catch{}
        toast(source||b.cover||b.weReadCover?'已恢复来源封面':'已移除自定义封面');
      }catch(err){console.error(err);toast('暂时无法恢复封面')}
    });
  }

  async function refreshPreview(key){
    const wrap=document.getElementById('bookCoverPreview');if(!wrap)return;
    const img=wrap.querySelector('img'),b=book(key);if(!b)return;
    if(previewUrl){URL.revokeObjectURL(previewUrl);previewUrl=''}
    let src='';
    try{const blob=await getCover(key);if(blob){previewUrl=URL.createObjectURL(blob);src=previewUrl}}catch{}
    if(!src)src=b.cover||b.weReadCover||'';
    if(src){img.onload=()=>wrap.classList.add('has-image');img.onerror=()=>wrap.classList.remove('has-image');img.src=src;wrap.classList.add('has-image')}
    else{img.removeAttribute('src');wrap.classList.remove('has-image')}
    const btn=document.getElementById('restoreBookCover');if(btn)btn.hidden=!b.manualCover;
  }

  function wrapOpenBook(){
    if(window.__yuejiBookCoverOpenWrapped)return;window.__yuejiBookCoverOpenWrapped=true;
    const original=openBook;
    openBook=function(key){original(key);setTimeout(()=>refreshPreview(key),0)};
  }

  function fixYearCalendar(){
    renderYearCalendar=function(){
      const y=calendarDate.getFullYear(),wrap=$('challengeGrid');wrap.innerHTML='';let count=0;
      for(let m=0;m<12;m++){
        const first=new Date(y,m,1).getDay(),last=new Date(y,m+1,0).getDate(),el=document.createElement('div');
        el.className='month-block';el.innerHTML=`<div class="month-name">${m+1}月</div>`;
        const grid=document.createElement('div');grid.className='month-days';
        for(let i=0;i<first;i++){const x=document.createElement('i');x.className='cal-day out';grid.append(x)}
        for(let n=1;n<=last;n++){
          const key=dateKey(new Date(y,m,n)),dd=dayData(key),b=document.createElement('button');b.className='cal-day';
          if(dd.read){b.classList.add('read');count++}
          if(dd.journal?.thought||dd.journal?.quote)b.classList.add('note');
          if(key===todayKey)b.classList.add('today');
          b.title=fmtDate(key);b.onclick=()=>openJournal(key);grid.append(b);
        }
        el.append(grid);wrap.append(el);
      }
      $('challengeRead').textContent=count;
    };
    if(typeof calendarView!=='undefined'&&calendarView==='year')renderCalendarPage();
  }

  function init(){injectStyles();installEditor();wrapOpenBook();fixYearCalendar()}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else setTimeout(init,0);
})();
