(()=>{
  'use strict';

  const GUIDE_KEY='yueji-onboarding-seen-v2';
  const DEMO_KEYS=new Set(['crime','art','deadpool','stranger']);

  function injectStyles(){
    if(document.getElementById('yuejiOnboardingStyles'))return;
    const s=document.createElement('style');
    s.id='yuejiOnboardingStyles';
    s.textContent=`
      .hero-mark.yueji-read-mark{color:var(--accent)!important;font-weight:900!important;font-family:Georgia,"Times New Roman",serif!important}
      .yueji-guide{position:fixed;inset:0;z-index:140;display:none;align-items:center;justify-content:center;padding:18px;background:rgba(0,0,0,.42);backdrop-filter:blur(6px)}
      .yueji-guide.show{display:flex}
      .yueji-guide-panel{width:min(460px,100%);background:var(--card);border:1px solid var(--line);border-radius:24px;padding:22px;box-shadow:0 28px 90px rgba(0,0,0,.28)}
      .yueji-guide-panel h3{margin:2px 0 7px;font-size:1.45rem}.yueji-guide-panel>p{margin:0 0 18px;color:var(--muted);font-size:.82rem;line-height:1.65}
      .yueji-guide-steps{display:grid;gap:10px}.yueji-guide-step{display:grid;grid-template-columns:30px 1fr;gap:11px;padding:12px;border:1px solid var(--line);border-radius:16px;background:var(--soft)}
      .yueji-guide-step>i{width:30px;height:30px;border-radius:50%;display:grid;place-items:center;background:rgba(var(--accent-rgb),.15);color:var(--accent);font-style:normal;font-weight:800}.yueji-guide-step b{display:block;font-size:.9rem;margin-bottom:3px}.yueji-guide-step span{display:block;color:var(--muted);font-size:.76rem;line-height:1.55}
      .yueji-guide-actions{display:flex;gap:9px;margin-top:18px}.yueji-guide-actions button{flex:1}.yueji-guide-replay{width:100%;margin-top:4px}
      @media(max-width:520px){.yueji-guide{align-items:flex-end;padding:10px}.yueji-guide-panel{border-radius:24px 24px 16px 16px}}
    `;
    document.head.appendChild(s);
  }

  function isLegacyDemoOnly(){
    if(typeof state==='undefined'||!state||!Array.isArray(state.books))return false;
    if(state.books.length!==4)return false;
    return state.books.every(b=>DEMO_KEYS.has(String(b.key||'')));
  }

  function replaceWithBlank(){
    if(!isLegacyDemoOnly())return false;
    const y=new Date().getFullYear();
    const accent=state.accent||'#5f8f7b';
    state={
      source:'网页记录',accent,
      challengeStart:`${y}-01-01`,challengeEnd:`${y}-12-31`,
      books:[],sessions:[],journals:{},highlights:[],importedAt:'',
      weRead:{lastSync:0,daily:{}},bookTrash:[],hiddenWeReadBookIds:[]
    };
    try{save();renderAll()}catch(e){console.error(e)}
    return true;
  }

  function removeDemoControl(){
    const btn=document.getElementById('loadDemo');
    if(btn)btn.remove();
  }

  function syncReadMark(){
    const el=document.getElementById('todayMark');if(!el)return;
    if(el.textContent.trim()==='✓')el.textContent='√';
    const active=el.textContent.trim()==='√';
    el.classList.toggle('yueji-read-mark',active);
    if(active){el.style.color='var(--accent)';el.style.fontWeight='900'}
    else{el.style.removeProperty('color');el.style.removeProperty('font-weight')}
  }

  function installReadMarkWatcher(){
    syncReadMark();
    const el=document.getElementById('todayMark');if(!el)return;
    new MutationObserver(syncReadMark).observe(el,{childList:true,characterData:true,subtree:true});
  }

  function installGuide(){
    if(document.getElementById('yuejiGuide'))return;
    const d=document.createElement('div');
    d.id='yuejiGuide';d.className='yueji-guide';
    d.innerHTML=`<div class="yueji-guide-panel">
      <h3>阅迹怎么用</h3>
      <p>第一次使用时这里没有任何演示书，先导入你自己的阅读数据。</p>
      <div class="yueji-guide-steps">
        <div class="yueji-guide-step"><i>1</i><div><b>导入数据</b><span>设置里连接微信读书 Skill Key，或者导入静读天下 `.mrstd / .mrpro`。</span></div></div>
        <div class="yueji-guide-step"><i>2</i><div><b>看日历和书库</b><span>日历记录哪天读过；书库整理书籍、进度和封面。</span></div></div>
        <div class="yueji-guide-step"><i>3</i><div><b>留下笔记和统计</b><span>摘录、感想、阅读演化、月报和年报都会随着真实数据生成。</span></div></div>
      </div>
      <div class="yueji-guide-actions"><button class="soft-btn" data-guide-close>知道了</button><button class="primary-btn" data-guide-settings>去导入</button></div>
    </div>`;
    document.body.appendChild(d);
    const close=()=>{d.classList.remove('show');localStorage.setItem(GUIDE_KEY,'1')};
    d.addEventListener('click',e=>{
      if(e.target===d||e.target.closest('[data-guide-close]'))close();
      if(e.target.closest('[data-guide-settings]')){close();document.getElementById('settingsBtn')?.click()}
    });

    const settings=document.getElementById('settingsSheet');
    if(settings&&!document.getElementById('replayOnboarding')){
      const sec=document.createElement('div');sec.className='settings-section';
      sec.innerHTML='<h4>使用帮助</h4><button class="soft-btn yueji-guide-replay" id="replayOnboarding">查看新手教程</button>';
      settings.appendChild(sec);
      sec.querySelector('button').onclick=()=>{try{closeSheets()}catch{}d.classList.add('show')};
    }
    if(localStorage.getItem(GUIDE_KEY)!=='1')setTimeout(()=>d.classList.add('show'),120);
  }

  injectStyles();
  replaceWithBlank();
  removeDemoControl();
  installReadMarkWatcher();
  installGuide();
})();
