(()=>{'use strict';

const N=v=>Number(v)||0;
const SL=s=>s==='weread'?'微信读书':s==='moon'?'静读天下':s==='manual'?'手动':s||'';
const ex=s=>String(s||'').replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]));

function datesFor(b,source){
  const out=[];
  if(source==='all'||source==='moon'){
    state.sessions.forEach(s=>{
      if(s.bookKey===b.key&&s.date&&s.source!=='weread')out.push(s.date);
    });
  }
  if((source==='all'||source==='weread')&&b.weReadLastRead)out.push(b.weReadLastRead);
  if(b.finishedDate)out.push(b.finishedDate);
  return [...new Set(out.filter(Boolean))].sort();
}

function minutesFor(b,source){
  let mins=0;
  if(source==='all'||source==='weread')mins+=N(b.weReadSeconds)/60;
  if(source==='all'||source==='moon'){
    const local=state.sessions.filter(s=>s.bookKey===b.key&&s.source!=='weread').reduce((a,s)=>a+N(s.minutes),0);
    mins+=local||N(b.minutes);
  }
  return mins;
}

function noteCountFor(b){
  const h=window.yuejiHighlightCountForBook?.(b.key)??(state.highlights||[]).filter(x=>x.bookKey===b.key).length;
  const j=Object.values(state.journals||{}).filter(x=>x.bookKey===b.key&&(String(x.quote||'').trim()||String(x.thought||'').trim())).length;
  return h+j;
}

function sourceTone(b){
  const src=b.sources||[];
  if(src.includes('weread')&&src.includes('moon'))return 'deep';
  if(src.includes('weread'))return 'main';
  if(src.includes('moon'))return 'mid';
  return 'soft';
}

function injectStyles(){
  if(document.getElementById('yuejiEvolutionGreenStyles'))return;
  const s=document.createElement('style');
  s.id='yuejiEvolutionGreenStyles';
  s.textContent=`
    #readingEvolutionCard.evolution-card{padding:0!important;overflow:hidden!important;background:var(--card)!important}
    .evo-green-shell{
      --evo-bg:#f3f7f4;--evo-deep:#345b4d;--evo-main:#5f8f7b;--evo-mid:#86aa99;
      --evo-soft:#bdd2c7;--evo-pale:#dfeae4;--evo-line:#c7d9d0;--evo-text:#2f493f;
      padding:24px 22px 18px;background:linear-gradient(180deg,#f8faf8 0%,var(--evo-bg) 100%);color:var(--evo-text)
    }
    .evo-simple-head{padding:4px 0 20px;border-bottom:1px solid var(--evo-line);text-align:center}
    .evo-simple-head h3{margin:0;font-family:"Songti SC","STSong",serif;font-size:38px;line-height:1.1;font-weight:500;letter-spacing:.08em;color:var(--evo-deep)}
    .evo-green-shell .evolution-toolbar{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin:16px 0 12px}
    .evo-green-shell .seg{background:var(--evo-pale);border:1px solid color-mix(in srgb,var(--evo-line) 85%,transparent)}
    .evo-green-shell .seg button{color:var(--evo-text)}
    .evo-green-shell .seg button.active{background:#fff;color:var(--evo-deep);box-shadow:0 2px 8px rgba(52,91,77,.10)}
    .evo-green-scroll{position:relative;overflow-x:auto;overflow-y:hidden;border:1px solid var(--evo-line);border-radius:18px;background:rgba(255,255,255,.52);scrollbar-width:thin}
    .evo-green-scroll svg{display:block;width:max(100%,860px);height:auto}
    .evo-green-tip{position:absolute;z-index:5;display:none;max-width:245px;padding:10px 11px;border-radius:12px;background:#f9fcfa;border:1px solid var(--evo-line);box-shadow:0 12px 30px rgba(52,91,77,.14);font-size:11px;line-height:1.6;color:var(--evo-text);pointer-events:none}
    .evo-green-tip b{display:block;font-size:13px;margin-bottom:3px;color:var(--evo-deep)}
    .evo-green-legend{display:flex;gap:15px;flex-wrap:wrap;margin-top:11px;font-size:10px;line-height:1.5;color:#668176}
    .evo-green-legend span:before{content:"";display:inline-block;width:17px;height:1px;margin-right:6px;vertical-align:middle;background:var(--evo-main)}
    .evo-green-legend .ring:before{width:9px;height:9px;border:1px solid var(--evo-main);border-radius:50%;background:transparent}
    .evo-green-legend .dot:before{width:8px;height:8px;border-radius:50%;background:var(--evo-main)}
    .evo-green-empty{padding:44px 20px;text-align:center;color:#789086;font-size:13px}
    @media(max-width:620px){
      .evo-green-shell{padding:18px 13px 14px}
      .evo-simple-head{padding-bottom:16px}.evo-simple-head h3{font-size:31px}
      .evo-green-shell .evolution-toolbar{align-items:stretch}
      .evo-green-shell .evolution-toolbar .seg{max-width:100%;overflow:auto}
      .evo-green-scroll svg{width:860px}
    }
    @media(prefers-color-scheme:dark){
      .evo-green-shell{--evo-bg:#151d19;--evo-deep:#c7dfd3;--evo-main:#83aa98;--evo-mid:#6f9484;--evo-soft:#577466;--evo-pale:#223029;--evo-line:#34493f;--evo-text:#dce8e2;background:linear-gradient(180deg,#171f1b 0%,#121915 100%)}
      .evo-green-shell .seg button.active{background:#26372f}
      .evo-green-scroll{background:rgba(255,255,255,.025)}
      .evo-green-tip{background:#1d2923}
      .evo-green-legend{color:#9db8aa}
    }
  `;
  document.head.appendChild(s);
}

function shell(){
  const c=document.getElementById('readingEvolutionCard');
  if(!c)return null;
  if(c.dataset.greenTimeline==='1'&&c.querySelector('.evo-green-shell'))return c;
  c.dataset.greenTimeline='1';
  c.innerHTML=`<div class="evo-green-shell">
    <div class="evo-simple-head"><h3>阅读演化</h3></div>
    <div class="evolution-toolbar">
      <div class="seg" id="evolutionRangeSeg">
        <button class="active" data-evo-range="year">今年</button>
        <button data-evo-range="12m">近12个月</button>
        <button data-evo-range="all">全部</button>
      </div>
      <div class="seg" id="evolutionSourceSeg">
        <button class="active" data-evo-source="all">全部</button>
        <button data-evo-source="weread">微信读书</button>
        <button data-evo-source="moon">静读天下</button>
      </div>
    </div>
    <div class="evo-green-scroll" id="evolutionCanvas"><div class="evo-green-tip" id="evolutionTip"></div></div>
    <div class="evo-green-legend">
      <span>连线＝阅读先后</span>
      <span class="ring">外圈＝留下过书摘 / 感悟</span>
      <span class="dot">圆点＝一本书</span>
      <span>圆点大小＝真实阅读时长</span>
    </div>
  </div>`;
  c.dataset.range='year';
  c.dataset.source='all';
  c.querySelector('#evolutionRangeSeg').onclick=e=>{
    const b=e.target.closest('[data-evo-range]');if(!b)return;
    c.dataset.range=b.dataset.evoRange;
    b.parentElement.querySelectorAll('button').forEach(x=>x.classList.toggle('active',x===b));
    render();
  };
  c.querySelector('#evolutionSourceSeg').onclick=e=>{
    const b=e.target.closest('[data-evo-source]');if(!b)return;
    c.dataset.source=b.dataset.evoSource;
    b.parentElement.querySelectorAll('button').forEach(x=>x.classList.toggle('active',x===b));
    render();
  };
  return c;
}

function dayOfYear(key){
  const d=parseDate(key),start=new Date(d.getFullYear(),0,1);
  return Math.floor((d-start)/86400000);
}
function daysInYear(y){return ((y%4===0&&y%100!==0)||y%400===0)?366:365}

function buildCurve(a,b){
  const dx=b.x-a.x;
  const c1x=a.x+dx*.42,c2x=b.x-dx*.42;
  return `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} C ${c1x.toFixed(1)} ${a.y.toFixed(1)}, ${c2x.toFixed(1)} ${b.y.toFixed(1)}, ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
}

function render(){
  const c=shell(),v=document.getElementById('evolutionCanvas');
  if(!c||!v)return;
  const range=c.dataset.range||'year',source=c.dataset.source||'all',now=new Date();

  const sessionMap=new Map();
  state.sessions.forEach(s=>{if(!s.bookKey||s.source==='weread')return;const row=sessionMap.get(s.bookKey)||{dates:[],minutes:0};if(s.date)row.dates.push(s.date);row.minutes+=N(s.minutes);sessionMap.set(s.bookKey,row)});
  let items=state.books.map(b=>{
    const local=sessionMap.get(b.key)||{dates:[],minutes:0},ds=[];
    if(source==='all'||source==='moon')ds.push(...local.dates);
    if((source==='all'||source==='weread')&&b.weReadLastRead)ds.push(b.weReadLastRead);
    if(b.finishedDate)ds.push(b.finishedDate);
    const dates=[...new Set(ds.filter(Boolean))].sort(),mins=(source==='all'||source==='weread'?N(b.weReadSeconds)/60:0)+(source==='all'||source==='moon'?(local.minutes||N(b.minutes)):0);
    return {b,dates,date:dates.at(-1)||'',first:dates[0]||'',mins,notes:noteCountFor(b)};
  }).filter(x=>x.date).filter(x=>source==='all'||x.b.sources?.includes(source));

  if(!items.length){
    v.innerHTML='<div class="evo-green-empty">这个范围还没有可以定位到真实日期的阅读记录。</div><div class="evo-green-tip" id="evolutionTip"></div>';
    return;
  }

  let start;
  if(range==='year')start=new Date(now.getFullYear(),0,1);
  else if(range==='12m')start=new Date(now.getFullYear(),now.getMonth()-11,1);
  else{
    const d=parseDate(items.map(x=>x.first||x.date).sort()[0]);
    start=new Date(d.getFullYear(),0,1);
  }
  const sk=dateKey(start),ek=todayKey;
  items=items.filter(x=>x.date>=sk&&x.date<=ek);
  if(!items.length){
    v.innerHTML='<div class="evo-green-empty">这个范围还没有可以定位到真实日期的阅读记录。</div><div class="evo-green-tip" id="evolutionTip"></div>';
    return;
  }

  const years=[...new Set(items.map(x=>+x.date.slice(0,4)))].sort((a,b)=>a-b);
  const W=1080,L=92,R=28,T=64,rowH=178,B=34,H=T+years.length*rowH+B;
  const chartW=W-L-R,maxM=Math.max(1,...items.map(x=>x.mins));
  const yIndex=new Map(years.map((y,i)=>[y,i]));

  const groups=new Map();
  items.forEach(x=>{const k=x.date;(groups.get(k)||groups.set(k,[]).get(k)).push(x)});
  groups.forEach(g=>g.sort((a,b)=>String(a.b.title||'').localeCompare(String(b.b.title||''),'zh-CN')));

  const pos=items.map(x=>{
    const year=+x.date.slice(0,4),idx=yIndex.get(year)||0;
    const frac=dayOfYear(x.date)/Math.max(1,daysInYear(year)-1);
    const group=groups.get(x.date)||[x],gi=group.indexOf(x);
    const offset=(gi-(group.length-1)/2)*16;
    const r=x.mins>0?5+8*Math.log1p(x.mins)/Math.log1p(maxM):5;
    return {...x,x:L+frac*chartW,y:T+idx*rowH+rowH*.54+offset,r};
  }).sort((a,b)=>a.date.localeCompare(b.date)||String(a.b.title||'').localeCompare(String(b.b.title||''),'zh-CN'));

  const monthX=m=>L+((new Date(2024,m,1)-new Date(2024,0,1))/(new Date(2025,0,1)-new Date(2024,0,1)))*chartW;
  const monthGrid=Array.from({length:12},(_,m)=>{
    const x=monthX(m);
    return `<line x1="${x}" y1="${T-18}" x2="${x}" y2="${H-B}" stroke="var(--evo-line)" stroke-width="1" stroke-dasharray="2 6" opacity=".72"/>
      <text x="${x+3}" y="${T-28}" font-size="10" fill="var(--evo-main)">${m+1}月</text>`;
  }).join('');

  const yearRows=years.map((y,i)=>{
    const top=T+i*rowH,cy=top+rowH*.54;
    return `<line x1="${L}" y1="${top}" x2="${W-R}" y2="${top}" stroke="var(--evo-line)" stroke-width="1" opacity=".8"/>
      <text x="18" y="${cy+4}" font-family="Georgia,serif" font-size="24" font-weight="600" fill="var(--evo-deep)">${y}</text>`;
  }).join('')+`<line x1="${L}" y1="${T+years.length*rowH}" x2="${W-R}" y2="${T+years.length*rowH}" stroke="var(--evo-line)" stroke-width="1" opacity=".8"/>`;

  const path=pos.slice(1).map((p,i)=>`<path d="${buildCurve(pos[i],p)}" fill="none" stroke="var(--evo-main)" stroke-width="1.35" stroke-linecap="round" opacity=".52"/>`).join('');

  const nodes=pos.map((p,i)=>{
    const tone=sourceTone(p.b),fill=tone==='deep'?'var(--evo-deep)':tone==='main'?'var(--evo-main)':tone==='mid'?'var(--evo-mid)':'var(--evo-soft)';
    const ring=p.notes>0?`<circle cx="${p.x}" cy="${p.y}" r="${(p.r+5).toFixed(1)}" fill="none" stroke="var(--evo-main)" stroke-width="1" opacity=".58"/>`:'';
    return `<g data-evo-i="${i}" style="cursor:pointer">${ring}<circle cx="${p.x}" cy="${p.y}" r="${p.r.toFixed(1)}" fill="${fill}" stroke="#f8faf8" stroke-width="1.8" opacity=".93"/></g>`;
  }).join('');

  v.innerHTML=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="阅读演化时间线">${monthGrid}${yearRows}${path}${nodes}</svg><div class="evo-green-tip" id="evolutionTip"></div>`;

  const tip=v.querySelector('#evolutionTip');
  v.querySelectorAll('[data-evo-i]').forEach(el=>{
    const p=pos[+el.dataset.evoI];
    const show=e=>{
      const rect=v.getBoundingClientRect();
      tip.style.display='block';
      tip.style.left=`${Math.min(rect.width-250,Math.max(8,e.clientX-rect.left+12))}px`;
      tip.style.top=`${Math.max(8,e.clientY-rect.top-8)}px`;
      const sources=(p.b.sources||[]).map(SL).filter(Boolean).join(' · ')||'未标记来源';
      tip.innerHTML=`<b>${ex(p.b.title||'未命名')}</b>${ex(p.date)}<br>${p.mins>0?`真实累计阅读约 ${Math.round(p.mins)} 分钟<br>`:''}${ex(sources)}${p.notes?`<br>书摘 / 感悟 ${p.notes} 条`:''}`;
    };
    el.onmouseenter=show;el.onmousemove=show;el.onmouseleave=()=>tip.style.display='none';
  });
}

function annual(){
  const w=document.querySelector('.year-wall');
  if(!w)return;
  w.hidden=false;w.style.removeProperty('display');
  const title=w.querySelector('.section-title');
  if(title)title.textContent='年度报告 · My Year in Books';
  try{renderYearWall()}catch(e){console.warn(e)}
}

function init(){
  injectStyles();shell();if(typeof page!=='undefined'&&page==='analytics')render();annual();
  const oldSwitch=switchPage;
  switchPage=function(p){
    oldSwitch(p);
    setTimeout(()=>{
      if(p==='analytics'){shell();render()}
      if(p==='monthly')annual();
    },20);
  };
  const card=document.getElementById('readingEvolutionCard');
  if(card){
    new MutationObserver(()=>{
      if(!card.querySelector('.evo-green-shell'))setTimeout(()=>{shell();render()},0);
    }).observe(card,{childList:true,subtree:false});
  }
}

document.readyState==='loading'?document.addEventListener('DOMContentLoaded',init,{once:true}):setTimeout(init,0);
})();
