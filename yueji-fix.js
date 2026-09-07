(()=>{'use strict';

const N=v=>Number(v)||0;
const SL=s=>s==='weread'?'微信读书':s==='moon'?'静读天下':s==='manual'?'手动':s||'';
const CATS=[
  {label:'文学小说',sub:'LITERATURE',alpha:.92,aliases:['文学','小说','文学小说','经典','诗歌','散文','随笔','传记','fiction','literature','novel'],kw:['文学','小说','诗集','散文','随笔','传记','fiction','literature','novel']},
  {label:'哲学思想',sub:'PHILOSOPHY',alpha:.80,aliases:['哲学','思想','宗教','哲学思想','哲学宗教','philosophy','religion'],kw:['哲学','思想','宗教','伦理','存在主义','自由意志','意义','尼采','康德','黑格尔','philosophy','religion']},
  {label:'心理学',sub:'PSYCHOLOGY',alpha:.66,aliases:['心理','心理学','精神分析','psychology'],kw:['心理','精神分析','人格','认知','情绪','创伤','梦境','自我','psychology']},
  {label:'历史社会',sub:'HISTORY / SOCIETY',alpha:.52,aliases:['历史','社会','社科','政治','文化','社会科学','history','society'],kw:['历史','社会','政治','文化','人类学','传播','媒介','社会学','history','society']},
  {label:'科技未来',sub:'SCIENCE & TECH',alpha:.43,aliases:['科学','科技','技术','计算机','互联网','人工智能','science','technology','tech'],kw:['科学','科技','技术','人工智能','ai','算法','互联网','代码','宇宙','物理','生物','science','technology']},
  {label:'经济商业',sub:'BUSINESS',alpha:.58,aliases:['经济','商业','金融','管理','投资','理财','business','economics'],kw:['经济','商业','金融','管理','投资','理财','财富','business','economics']},
  {label:'艺术设计',sub:'ART & DESIGN',alpha:.36,aliases:['艺术','设计','美术','绘画','摄影','建筑','art','design'],kw:['艺术','美术','绘画','设计','建筑','摄影','视觉','审美','美学','art','design']},
  {label:'漫画图像',sub:'COMICS / GRAPHIC',alpha:.70,aliases:['漫画','漫画图像','图像小说','comics','comic','manga','graphic novel'],kw:['漫画','comic','comics','manga','deadpool','死侍','漫威','marvel']},
  {label:'其他',sub:'OTHERS',alpha:.73,aliases:['其他','其它','other','others'],kw:[]}
];

function norm(s=''){return String(s).trim().toLowerCase().replace(/\s+/g,' ')}
function rawCategory(b){return String(b?.category||'').trim()}
function categoryIndex(b){
  const raw=norm(rawCategory(b));
  if(raw){
    for(let i=0;i<CATS.length;i++){
      if(CATS[i].aliases.some(a=>raw===norm(a)||raw.includes(norm(a)))) return i;
    }
  }
  const text=norm([b?.title,b?.author,rawCategory(b)].filter(Boolean).join(' '));
  const order=[6,1,2,3,4,5,7,0];
  for(const i of order){
    if(CATS[i].kw.some(k=>text.includes(norm(k)))) return i;
  }
  return CATS.length-1;
}
function datesFor(b,s){
  const a=[];
  if(s==='all'||s==='moon') state.sessions.forEach(x=>{if(x.bookKey===b.key&&x.date&&x.source!=='weread')a.push(x.date)});
  if((s==='all'||s==='weread')&&b.weReadLastRead)a.push(b.weReadLastRead);
  if(b.finishedDate)a.push(b.finishedDate);
  return [...new Set(a.filter(Boolean))].sort();
}
function minutesFor(b,s){
  let m=0;
  if(s==='all'||s==='weread')m+=N(b.weReadSeconds)/60;
  if(s==='all'||s==='moon'){
    const x=state.sessions.filter(q=>q.bookKey===b.key&&q.source!=='weread').reduce((z,q)=>z+N(q.minutes),0);
    m+=x||N(b.minutes);
  }
  return m;
}
function notesFor(b){
  const h=(state.highlights||[]).filter(x=>x.bookKey===b.key).length;
  const j=Object.values(state.journals||{}).filter(x=>x.bookKey===b.key&&(String(x.quote||'').trim()||String(x.thought||'').trim())).length;
  return h+j;
}
function ex(s=''){return String(s).replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]))}
function hash(s=''){let h=0;for(const c of String(s)){h=(h*31+c.charCodeAt(0))|0}return Math.abs(h)}
function curve(a,b,bend=.45){
  const dx=b.x-a.x,dy=b.y-a.y,c1x=a.x+dx*bend,c1y=a.y+dy*.16,c2x=b.x-dx*bend,c2y=b.y-dy*.16;
  return `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
}

function injectPosterStyles(){
  if(document.getElementById('yuejiEvolutionPosterStyles'))return;
  const s=document.createElement('style');s.id='yuejiEvolutionPosterStyles';s.textContent=`
    .evolution-card{padding:0!important;overflow:hidden!important;background:var(--card)!important}
    .evo-shell{padding:26px 24px 18px}
    .evo-poster-head{position:relative;min-height:148px;border-bottom:1px solid color-mix(in srgb,var(--ink) 55%,transparent)}
    .evo-kicker{position:absolute;left:0;top:0;font-size:10px;font-weight:800;letter-spacing:.13em;text-transform:uppercase;color:color-mix(in srgb,var(--ink) 68%,transparent)}
    .evo-titlebox{position:absolute;inset:14px 0 0;text-align:center;pointer-events:none}
    .evo-titlebox h3{margin:0;font-family:"Songti SC","STSong",Georgia,serif;font-size:50px;line-height:1;font-weight:500;letter-spacing:.02em}
    .evo-titlebox .ghost{margin-top:-20px;font-family:Georgia,"Times New Roman",serif;font-size:43px;line-height:1;color:color-mix(in srgb,var(--ink) 27%,transparent);letter-spacing:.02em}
    .evo-titlebox small{display:block;margin-top:12px;font-size:8px;font-weight:700;letter-spacing:.36em;color:color-mix(in srgb,var(--ink) 48%,transparent);text-transform:uppercase}
    .evolution-toolbar{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin:16px 0 12px}
    .evo-scroll{position:relative;overflow-x:auto;overflow-y:hidden;border:1px solid var(--line);border-radius:17px;background:color-mix(in srgb,var(--card) 94%,var(--paper));scrollbar-width:thin}
    .evo-scroll svg{display:block;width:max(100%,900px);height:auto}
    .evo-tip{position:absolute;z-index:5;display:none;max-width:240px;padding:10px 11px;border-radius:12px;background:color-mix(in srgb,var(--card) 96%,transparent);border:1px solid var(--line);box-shadow:var(--shadow);font-size:11px;line-height:1.55;pointer-events:none}
    .evo-tip b{display:block;font-size:13px;margin-bottom:3px;color:var(--ink)}
    .evo-legend{display:flex;gap:14px;flex-wrap:wrap;margin-top:10px;font-size:10px;color:var(--muted);line-height:1.5}
    .evo-legend span:before{content:"";display:inline-block;width:16px;height:1px;vertical-align:middle;margin-right:5px;background:currentColor;opacity:.5}
    .evo-legend .dash:before{background:repeating-linear-gradient(90deg,currentColor 0 3px,transparent 3px 6px)}
    .evo-legend .ring:before{width:9px;height:9px;border:1px solid currentColor;border-radius:50%;background:transparent}
    @media(max-width:620px){
      .evo-shell{padding:20px 14px 14px}
      .evo-poster-head{min-height:124px}
      .evo-titlebox h3{font-size:39px}
      .evo-titlebox .ghost{font-size:34px;margin-top:-16px}
      .evo-titlebox small{font-size:6.5px;letter-spacing:.26em}
      .evolution-toolbar{align-items:stretch}
      .evolution-toolbar .seg{max-width:100%;overflow:auto}
      .evo-scroll svg{width:900px}
    }`;
  document.head.appendChild(s)
}

function shell(){
  const c=document.getElementById('readingEvolutionCard');if(!c)return null;
  if(c.dataset.poster==='1')return c;
  c.dataset.poster='1';
  c.innerHTML=`<div class="evo-shell">
    <div class="evo-poster-head">
      <div class="evo-kicker">◉ JOURNEY ATLAS</div>
      <div class="evo-titlebox"><h3>阅读演化</h3><div class="ghost">EVOLUTION</div><small>THE INTERSECTION OF TIME, GENRES AND BOOKS</small></div>
    </div>
    <div class="evolution-toolbar">
      <div class="seg" id="evolutionRangeSeg"><button class="active" data-evo-range="year">今年</button><button data-evo-range="12m">近12个月</button><button data-evo-range="all">全部</button></div>
      <div class="seg" id="evolutionSourceSeg"><button class="active" data-evo-source="all">全部</button><button data-evo-source="weread">微信读书</button><button data-evo-source="moon">静读天下</button></div>
    </div>
    <div class="evo-scroll" id="evolutionCanvas"><div class="evo-tip" id="evolutionTip"></div></div>
    <div class="evo-legend"><span>实线＝阅读先后</span><span class="dash">虚线＝同分类轨迹</span><span class="ring">外圈＝这本书留下过书摘 / 感悟</span><span>圆点大小＝真实阅读时长</span></div>
  </div>`;
  c.dataset.range='year';c.dataset.source='all';
  c.querySelector('#evolutionRangeSeg').onclick=e=>{const b=e.target.closest('[data-evo-range]');if(!b)return;c.dataset.range=b.dataset.evoRange;b.parentElement.querySelectorAll('button').forEach(x=>x.classList.toggle('active',x===b));render()};
  c.querySelector('#evolutionSourceSeg').onclick=e=>{const b=e.target.closest('[data-evo-source]');if(!b)return;c.dataset.source=b.dataset.evoSource;b.parentElement.querySelectorAll('button').forEach(x=>x.classList.toggle('active',x===b));render()};
  return c
}

function render(){
  const c=shell(),v=document.getElementById('evolutionCanvas');if(!c||!v)return;
  const rg=c.dataset.range||'year',sf=c.dataset.source||'all',now=new Date();
  let raw=state.books.map(b=>{
    const ds=datesFor(b,sf),idx=categoryIndex(b);
    return {b,ds,date:ds.at(-1)||'',first:ds[0]||'',mins:minutesFor(b,sf),notes:notesFor(b),ci:idx,cat:CATS[idx]};
  }).filter(x=>x.date).filter(x=>sf==='all'||x.b.sources?.includes(sf));
  if(!raw.length){v.innerHTML='<div class="evo-empty" style="padding:42px;text-align:center;color:var(--muted)">这个范围还没有可以定位到真实日期的阅读记录。</div><div class="evo-tip" id="evolutionTip"></div>';return}

  let start;
  if(rg==='year') start=new Date(now.getFullYear(),0,1);
  else if(rg==='12m') start=new Date(now.getFullYear(),now.getMonth()-11,1);
  else {const d=parseDate(raw.map(x=>x.first||x.date).sort()[0]);start=new Date(d.getFullYear(),d.getMonth(),1)}
  const sk=dateKey(start),ek=todayKey;
  raw=raw.filter(x=>x.date>=sk&&x.date<=ek);
  if(!raw.length){v.innerHTML='<div class="evo-empty" style="padding:42px;text-align:center;color:var(--muted)">这个范围还没有可以定位到真实日期的阅读记录。</div><div class="evo-tip" id="evolutionTip"></div>';return}

  const years=[...new Set(raw.map(x=>+x.date.slice(0,4)))].sort((a,b)=>a-b);
  const W=1120,L=115,R=45,T=118,rowH=210,B=54,H=T+years.length*rowH+B;
  const chartW=W-L-R,step=chartW/(CATS.length-1),xCat=i=>L+i*step;
  const maxM=Math.max(1,...raw.map(x=>x.mins));
  const yYear=new Map(years.map((y,i)=>[y,T+i*rowH]));
  const cluster=new Map();
  raw.forEach(x=>{const k=`${x.date.slice(0,4)}-${x.ci}`;if(!cluster.has(k))cluster.set(k,[]);cluster.get(k).push(x)});
  cluster.forEach(g=>g.sort((a,b)=>a.date.localeCompare(b.date)));

  const pos=raw.map(x=>{
    const year=+x.date.slice(0,4),month=Math.max(1,Math.min(12,+x.date.slice(5,7)||1));
    const group=cluster.get(`${year}-${x.ci}`)||[x],gi=group.indexOf(x);
    const stack=(gi-(group.length-1)/2)*Math.min(28,Math.max(12,rowH/8));
    const seed=hash(`${x.b.key}-${x.b.title}`),jx=((seed%101)-50)*.34;
    const y0=yYear.get(year)+30+((month-1)/11)*(rowH-60)+stack;
    const minY=yYear.get(year)+24,maxY=yYear.get(year)+rowH-24;
    const r=x.mins>0?5+8*Math.log1p(x.mins)/Math.log1p(maxM):5;
    return {...x,x:xCat(x.ci)+jx,y:Math.max(minY,Math.min(maxY,y0)),r}
  }).sort((a,b)=>a.date.localeCompare(b.date));

  const defs=`<defs><marker id="yj-arrow" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto"><path d="M 0 1 L 6 4 L 0 7" fill="none" stroke="color-mix(in srgb,var(--ink) 38%,transparent)" stroke-width="1.1"/></marker></defs>`;
  const cols=CATS.map((cat,i)=>`<g>
    <line x1="${xCat(i)}" y1="${T-12}" x2="${xCat(i)}" y2="${T+years.length*rowH-8}" stroke="color-mix(in srgb,var(--ink) 10%,transparent)" stroke-width="1" stroke-dasharray="2 5"/>
    <text x="${xCat(i)}" y="${T-72}" text-anchor="middle" font-family='"Songti SC","STSong",serif' font-size="22" font-weight="600" fill="var(--ink)">${ex(cat.label)}</text>
    <text x="${xCat(i)}" y="${T-48}" text-anchor="middle" font-family="monospace" font-size="8.5" letter-spacing=".06em" fill="color-mix(in srgb,var(--ink) 46%,transparent)">${ex(cat.sub)}</text>
  </g>`).join('');

  const rows=years.map((y,i)=>{
    const yy=T+i*rowH;
    return `<g><line x1="${L-78}" x2="${W-R}" y1="${yy}" y2="${yy}" stroke="color-mix(in srgb,var(--ink) 9%,transparent)"/>
    <text x="${L-92}" y="${yy+rowH*.48}" text-anchor="end" font-family="Georgia,serif" font-size="28" font-weight="600" fill="var(--ink)">${y}</text>
    <text x="${L-92}" y="${yy+rowH*.48+20}" text-anchor="end" font-family="monospace" font-size="8" fill="color-mix(in srgb,var(--ink) 44%,transparent)">1月-12月</text></g>`
  }).join('')+`<line x1="${L-78}" x2="${W-R}" y1="${T+years.length*rowH}" y2="${T+years.length*rowH}" stroke="color-mix(in srgb,var(--ink) 9%,transparent)"/>`;

  const byCat=CATS.map((_,i)=>pos.filter(p=>p.ci===i));
  const dash=byCat.flatMap(g=>g.slice(0,-1).map((a,i)=>`<path d="${curve(a,g[i+1],.42)}" fill="none" stroke="color-mix(in srgb,var(--ink) 8%,transparent)" stroke-width="1" stroke-dasharray="2 6"/>`)).join('');
  const solid=pos.slice(0,-1).map((a,i)=>{
    const b=pos[i+1],arrow=i%4===0?' marker-end="url(#yj-arrow)"':'';
    return `<path d="${curve(a,b,.46)}" fill="none" stroke="color-mix(in srgb,var(--ink) 31%,transparent)" stroke-width="1.15" stroke-linecap="round"${arrow}/>`
  }).join('');

  const nodes=pos.map((p,i)=>{
    const ring=p.notes>0?`<circle cx="${p.x}" cy="${p.y}" r="${(p.r+6).toFixed(1)}" fill="none" stroke="color-mix(in srgb,var(--ink) 42%,transparent)" stroke-width="1"/>`:'';
    return `<g data-poster-i="${i}" style="cursor:pointer"><circle cx="${p.x}" cy="${p.y}" r="${p.r.toFixed(1)}" fill="color-mix(in srgb,var(--ink) ${Math.round(p.cat.alpha*100)}%,transparent)" stroke="color-mix(in srgb,var(--ink) 25%,transparent)" stroke-width="${Math.min(3,1+Math.log2(p.notes+1)).toFixed(1)}" opacity=".78"><title>${ex(p.b.title||'未命名')}</title></circle>${ring}</g>`
  }).join('');

  const footer=`<line x1="${L-78}" x2="${W-R}" y1="${H-28}" y2="${H-28}" stroke="color-mix(in srgb,var(--ink) 10%,transparent)"/><text x="${L-78}" y="${H-10}" font-family="monospace" font-size="8" letter-spacing=".05em" fill="color-mix(in srgb,var(--ink) 40%,transparent)">节点：一本书 · 实线：阅读先后 · 浅色虚线：同分类轨迹 · 外圈：留有书摘/感悟</text><text x="${W-R}" y="${H-10}" text-anchor="end" font-family="monospace" font-size="8" fill="color-mix(in srgb,var(--ink) 40%,transparent)">阅迹 · READING EVOLUTION</text>`;

  v.innerHTML=`<svg data-evo-poster="1" viewBox="0 0 ${W} ${H}" role="img" aria-label="阅读演化图">${defs}${cols}${rows}${dash}${solid}${nodes}${footer}</svg><div class="evo-tip" id="evolutionTip"></div>`;
  const tip=v.querySelector('#evolutionTip');
  v.querySelectorAll('[data-poster-i]').forEach(el=>{
    const p=pos[+el.dataset.posterI];
    const show=e=>{
      const rect=v.getBoundingClientRect();
      tip.style.display='block';
      tip.style.left=`${Math.min(rect.width-248,Math.max(8,e.clientX-rect.left+12))}px`;
      tip.style.top=`${Math.max(8,e.clientY-rect.top-12)}px`;
      const ss=(p.b.sources||[]).map(SL).filter(Boolean).join(' · ');
      const raw=rawCategory(p.b),rawLine=raw&&norm(raw)!==norm(p.cat.label)?`<br><span style="opacity:.64">原始分类：${esc(raw)}</span>`:'';
      tip.innerHTML=`<b>${esc(p.b.title||'未命名')}</b>${esc(p.b.author||'作者待补充')}<br>${esc(p.date)} · ${esc(p.cat.label)}${p.mins>0?`<br>真实累计阅读约 ${Math.round(p.mins)} 分钟`:''}<br>书摘 / 感悟 ${p.notes} 条${ss?` · ${esc(ss)}`:''}${rawLine}`;
    };
    el.addEventListener('pointerenter',show);el.addEventListener('pointermove',show);el.addEventListener('pointerleave',()=>tip.style.display='none');
    el.addEventListener('click',show);
  })
}

function annual(){
  const w=document.querySelector('.year-wall');if(!w)return;
  w.hidden=false;w.style.removeProperty('display');w.style.removeProperty('visibility');
  const t=w.querySelector('.section-title');if(t)t.textContent='年度报告 · My Year in Books';
  try{renderYearWall()}catch(e){console.warn(e)}
}

function init(){
  injectPosterStyles();shell();render();annual();
  const old=switchPage;
  switchPage=function(p){old(p);setTimeout(()=>{if(p==='analytics'){shell();render()}if(p==='monthly')annual()},30)};
  const v=document.getElementById('evolutionCanvas');
  if(v)new MutationObserver(()=>{const s=v.querySelector('svg');if(s&&s.getAttribute('data-evo-poster')!=='1')setTimeout(render,0)}).observe(v,{childList:true});
}
document.readyState==='loading'?document.addEventListener('DOMContentLoaded',init,{once:true}):setTimeout(init,0);
})();