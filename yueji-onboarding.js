(()=>{
  'use strict';

  const GUIDE_KEY='yueji-onboarding-seen-v4';
  const LEGACY_DEMO_KEYS=new Set(['crime','art','deadpool','stranger']);

  function injectStyles(){
    if(document.getElementById('yuejiOnboardingStyles'))return;
    const s=document.createElement('style');
    s.id='yuejiOnboardingStyles';
    s.textContent=`
      #todayMark.yueji-read-mark{color:var(--accent)!important;font-weight:900!important;font-family:Arial,"PingFang SC",sans-serif!important;font-size:2.65rem!important;line-height:1!important}
      .yueji-guide{position:fixed;inset:0;z-index:200;display:none;align-items:center;justify-content:center;padding:18px;background:rgba(0,0,0,.48);backdrop-filter:blur(7px)}
      .yueji-guide.show{display:flex}
      .yueji-guide-panel{width:min(450px,100%);background:var(--card);border:1px solid var(--line);border-radius:24px;padding:22px;box-shadow:0 28px 90px rgba(0,0,0,.34)}
      .yueji-guide-panel h3{margin:0 0 7px;font-size:1.4rem}.yueji-guide-panel>p{margin:0 0 17px;color:var(--muted);font-size:.82rem;line-height:1.65}
      .yueji-guide-steps{display:grid;gap:10px}.yueji-guide-step{display:grid;grid-template-columns:30px 1fr;gap:11px;padding:12px;border:1px solid var(--line);border-radius:16px;background:var(--soft)}
      .yueji-guide-step>i{width:30px;height:30px;border-radius:50%;display:grid;place-items:center;background:rgba(var(--accent-rgb),.15);color:var(--accent);font-style:normal;font-weight:900}.yueji-guide-step b{display:block;font-size:.9rem;margin-bottom:3px}.yueji-guide-step span{display:block;color:var(--muted);font-size:.76rem;line-height:1.55}
      .yueji-guide-actions{display:flex;gap:9px;margin-top:18px}.yueji-guide-actions button{flex:1}.yueji-guide-replay{width:100%}
      @media(max-width:520px){.yueji-guide{align-items:flex-end;padding:10px}.yueji-guide-panel{border-radius:24px 24px 16px 16px}}
    `;
    document.head.appendChild(s);
  }

  function isLegacyDemo(){
    if(typeof state==='undefined'||!state||!Array.isArray(state.books))return false;
    if(state.source==='演示数据')return true;
    if(state.importedAt||state.weRead?.lastSync)return false;
    return state.books.length===4&&state.books.every(b=>LEGACY_DEMO_KEYS.has(String(b.key||'')));
  }

  function purgeLegacyDemo(){
    try{localStorage.removeItem('yueji-allow-demo-v1')}catch{}
    document.getElementById('loadDemo')?.remove();
    if(!isLegacyDemo())return false;
    const y=new Date().getFullYear(),accent=state.accent||'#5f8f7b';
    state={
      source:'网页记录',accent,
      challengeStart:`${y}-01-01`,challengeEnd:`${y}-12-31`,
      books:[],sessions:[],journals:{},highlights:[],importedAt:'',
      weRead:{lastSync:0,daily:{}},bookTrash:[],hiddenWeReadBookIds:[]
    };
    save();
    renderAll();
    if(typeof renderHomeDashboard==='function')renderHomeDashboard();
    if(typeof renderLibrary==='function')renderLibrary();
    return true;
  }

  function syncReadMark(){
    const el=document.getElementById('todayMark');if(!el)return;
    const hasRead=el.textContent.trim()==='✓'||el.textContent.trim()==='√';
    if(hasRead){
      el.textContent='√';
      el.classList.add('yueji-read-mark');
      el.style.setProperty('color','var(--accent)','important');
      el.style.setProperty('font-weight','900','important');
    }else{
      el.classList.remove('yueji-read-mark');
      el.style.removeProperty('color');el.style.removeProperty('font-weight');
    }
  }

  function watchReadMark(){
    const el=document.getElementById('todayMark');if(!el)return;
    syncReadMark();
    new MutationObserver(syncReadMark).observe(el,{childList:true,characterData:true,subtree:true});
  }

  function installGuide(){
    if(document.getElementById('yuejiGuide'))return;
    const d=document.createElement('div');d.id='yuejiGuide';d.className='yueji-guide';
    d.innerHTML=`<div class="yueji-guide-panel">
      <h3>阅迹怎么用</h3>
      <p>第一次使用只需要做一件事：把自己的阅读数据导进来。没有导入任何东西时，阅迹不会放任何演示书。</p>
      <div class="yueji-guide-steps">
        <div class="yueji-guide-step"><i>1</i><div><b>导入数据</b><span>设置里连接微信读书 Skill Key，或导入静读天下 <code>.mrstd / .mrpro</code> 备份。</span></div></div>
        <div class="yueji-guide-step"><i>2</i><div><b>日历与书库</b><span>日历看哪天读过；书库看读过什么、当前进度，也可以手动更换封面。</span></div></div>
        <div class="yueji-guide-step"><i>3</i><div><b>笔记与统计</b><span>书摘和感想会按书整理；统计里查看总览、阅读演化、月报和年报。</span></div></div>
      </div>
      <div class="yueji-guide-actions"><button class="soft-btn" data-guide-close>知道了</button><button class="primary-btn" data-guide-settings>去导入数据</button></div>
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
  purgeLegacyDemo();
  watchReadMark();
  installGuide();
})();
