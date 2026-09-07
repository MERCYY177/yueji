(() => {
  'use strict';

  const EXT_KEY = 'yueji-weread-key';
  const GATEWAY = 'https://i.weread.qq.com/api/agent/gateway';
  const SKILL_VERSION = '1.0.5';
  const AUTO_SYNC_MS = 6 * 60 * 60 * 1000;
  const WR_SESSION_PREFIX = 'weread-day:';
  const WR_HIGHLIGHT_MARKER = '__YUEJI_WEREAD__';

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const n = v => Number(v) || 0;
  const safeDate = ts => {
    const num = Number(ts);
    if (!num) return '';
    const d = new Date(num < 1e12 ? num * 1000 : num);
    if (Number.isNaN(d.getTime())) return '';
    return dateKey(d);
  };
  const normalizeText = s => String(s || '').toLowerCase().replace(/[\s·•:：,，.。!！?？\-—_()（）\[\]【】《》<>]/g, '');
  const normalizeAuthor = s => normalizeText(s).replace(/著|编|译|作者/g, '');
  const sourceName = s => s === 'weread' ? '微信读书' : s === 'moon' ? '静读天下' : s === 'manual' ? '手动' : s || '';

  function ensureStateShape() {
    state.weRead = state.weRead && typeof state.weRead === 'object' ? state.weRead : {};
    state.weRead.lastSync = n(state.weRead.lastSync);
    state.weRead.daily = state.weRead.daily && typeof state.weRead.daily === 'object' ? state.weRead.daily : {};
    state.books.forEach(b => {
      if (!Array.isArray(b.sources)) {
        b.sources = [];
        if (b.weReadBookId) b.sources.push('weread');
        if (b.file || b.moonPath || b.moonId) b.sources.push('moon');
        if (!b.sources.length) b.sources.push('manual');
      }
      b.sources = [...new Set(b.sources)];
    });
    state.sessions.forEach(s => {
      if (!s.source) s.source = s.id && String(s.id).startsWith(WR_SESSION_PREFIX) ? 'weread' : 'moon';
    });
    (state.highlights || []).forEach(h => {
      if (!h.source) h.source = h.bookmark === WR_HIGHLIGHT_MARKER ? 'weread' : 'moon';
    });
    save();
  }

  function injectStyles() {
    if (document.getElementById('yuejiExtensionStyles')) return;
    const style = document.createElement('style');
    style.id = 'yuejiExtensionStyles';
    style.textContent = `
      .wr-connect-row{display:grid;grid-template-columns:1fr auto;gap:9px;align-items:center;margin-top:10px}
      .wr-key{width:100%;min-width:0;border:1px solid var(--line);background:var(--card);border-radius:12px;padding:11px 12px;outline:none}
      .wr-key:focus{border-color:rgba(var(--accent-rgb),.65);box-shadow:0 0 0 3px rgba(var(--accent-rgb),.10)}
      .wr-status{margin-top:9px;font-size:12px;line-height:1.65;color:var(--muted)}
      .wr-status strong{color:var(--text);font-weight:700}
      .wr-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
      .evolution-card{overflow:hidden}
      .evolution-toolbar{display:flex;gap:8px;flex-wrap:wrap;justify-content:space-between;align-items:center;margin:8px 0 12px}
      .evolution-toolbar .seg{max-width:100%;overflow:auto;scrollbar-width:none}
      .evolution-toolbar .seg::-webkit-scrollbar{display:none}
      .evolution-canvas{position:relative;border:1px solid var(--line);border-radius:18px;background:linear-gradient(180deg,rgba(var(--accent-rgb),.025),transparent);overflow:hidden}
      .evolution-canvas svg{display:block;width:100%;height:auto;min-height:420px}
      .evo-label{font-size:10px;fill:var(--muted)}
      .evo-year{font-size:10px;fill:var(--muted);font-weight:600}
      .evo-node{cursor:pointer;transition:opacity .15s ease}
      .evo-node:hover{opacity:.72}
      .evo-empty{padding:34px 18px;text-align:center;color:var(--muted);font-size:13px}
      .evo-note{margin-top:10px;font-size:11px;line-height:1.65;color:var(--muted)}
      .evo-tip{position:absolute;z-index:3;display:none;max-width:220px;padding:9px 10px;border-radius:12px;background:var(--card);border:1px solid var(--line);box-shadow:var(--shadow);font-size:11px;line-height:1.55;pointer-events:none}
      .evo-tip b{display:block;font-size:12px;margin-bottom:2px;color:var(--text)}
      @media(max-width:520px){.wr-connect-row{grid-template-columns:1fr}.wr-connect-row .primary-btn{width:100%}.evolution-canvas svg{min-height:390px}}
    `;
    document.head.appendChild(style);
  }

  function injectSettings() {
    const sheet = document.getElementById('settingsSheet');
    if (!sheet || document.getElementById('wereadSettings')) return;
    const first = sheet.querySelector('.settings-section');
    const section = document.createElement('div');
    section.className = 'settings-section';
    section.id = 'wereadSettings';
    section.innerHTML = `
      <h4>微信读书同步</h4>
      <div class="section-sub">输入微信读书 Skill Key。连接后，阅迹会在打开网页时自动补齐阅读统计、书籍进度和个人书摘；已经进入微信读书云端书架的导入书也会读取，只留在手机文件夹里的书不会读取。Key 只保存在当前浏览器，不进入阅迹 JSON 备份。</div>
      <div class="wr-connect-row">
        <input id="wereadKeyInput" class="wr-key" type="password" autocomplete="off" placeholder="Skill Key">
        <button class="primary-btn" id="wereadConnectBtn">连接并同步</button>
      </div>
      <div class="wr-status" id="wereadStatus">尚未连接微信读书。</div>
      <div class="wr-actions">
        <button class="soft-btn" id="wereadSyncBtn">立即同步</button>
        <button class="soft-btn" id="wereadDisconnectBtn">断开连接</button>
        <label class="soft-btn" style="display:inline-flex;align-items:center;cursor:pointer">导入微信读书 JSON<input id="wereadJsonFile" type="file" accept=".json,application/json" hidden></label>
      </div>`;
    sheet.insertBefore(section, first);
    const key = localStorage.getItem(EXT_KEY) || '';
    document.getElementById('wereadKeyInput').value = key;
    document.getElementById('wereadConnectBtn').addEventListener('click', async () => {
      const val = document.getElementById('wereadKeyInput').value.trim();
      if (!val) return setWeReadStatus('请先填入 Skill Key。', true);
      localStorage.setItem(EXT_KEY, val);
      await syncWeRead({ full: !state.weRead.lastSync, manual: true });
    });
    document.getElementById('wereadSyncBtn').addEventListener('click', async () => {
      if (!localStorage.getItem(EXT_KEY)) return setWeReadStatus('还没有保存 Skill Key。', true);
      await syncWeRead({ full: false, manual: true });
    });
    document.getElementById('wereadDisconnectBtn').addEventListener('click', () => {
      localStorage.removeItem(EXT_KEY);
      document.getElementById('wereadKeyInput').value = '';
      setWeReadStatus('已断开微信读书。阅迹里已经同步过的数据不会删除。');
      updateSourcePill();
    });
    document.getElementById('wereadJsonFile').addEventListener('change',async e=>{const file=e.target.files?.[0];if(!file)return;try{await importWeReadFile(file);e.target.value=''}catch(err){setWeReadStatus('导入失败：'+String(err?.message||err),true)}});
    updateWeReadStatus();
  }

  async function importWeReadFile(file){
    const data=JSON.parse(await file.text()),shelf=data.shelf||data.data?.shelf||data,books=Array.isArray(shelf.books)?shelf.books:Array.isArray(data.books)?data.books:[],progressRows=Array.isArray(data.progress)?data.progress:Array.isArray(data.progresses)?data.progresses:[];
    if(!books.length)throw new Error('文件里没有找到微信读书书架 books[]');
    const progressMap=new Map(progressRows.map(x=>[String(x.bookId||x.book?.bookId||''),x]));
    let imported=0;books.forEach(raw=>{const merged=mergeBookFromWeRead(raw,progressMap.get(String(raw.bookId)));if(merged)imported++});
    const daily=data.daily||data.readDays||data.readdata?.daily;if(daily&&typeof daily==='object'&&!Array.isArray(daily))replaceWeReadDaily(daily);
    state.weRead.lastSync=Date.now();state.source=state.books.some(b=>b.sources?.includes('moon'))?'多源阅读档案':'微信读书';save();renderAllSafe();updateSourcePill();updateWeReadStatus(`已从 JSON 导入 ${imported} 本书`);toast('微信读书 JSON 已导入');
  }

  function setWeReadStatus(text, isError = false) {
    const el = document.getElementById('wereadStatus');
    if (!el) return;
    el.innerHTML = `<span style="${isError ? 'color:#b65b5b' : ''}">${esc(text)}</span>`;
  }

  function updateWeReadStatus(extra = '') {
    const el = document.getElementById('wereadStatus');
    if (!el) return;
    const key = localStorage.getItem(EXT_KEY);
    if (!key) { el.textContent = '尚未连接微信读书。'; return; }
    const last = state.weRead.lastSync ? new Date(state.weRead.lastSync) : null;
    const lastText = last ? `${last.getFullYear()}-${pad(last.getMonth()+1)}-${pad(last.getDate())} ${pad(last.getHours())}:${pad(last.getMinutes())}` : '尚未完成首次同步';
    const days = Object.keys(state.weRead.daily || {}).length;
    const wrBooks = state.books.filter(b => b.sources?.includes('weread')).length;
    el.innerHTML = `<strong>已连接</strong> · 上次同步：${esc(lastText)}<br>已保存 ${days} 天微信读书日级时长 · ${wrBooks} 本微信读书书籍${extra ? `<br>${esc(extra)}` : ''}`;
  }

  async function wereadCall(apiName, params = {}) {
    const key = localStorage.getItem(EXT_KEY);
    if (!key) throw new Error('没有 Skill Key');
    const res = await fetch(GATEWAY, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_name: apiName, skill_version: SKILL_VERSION, ...params })
    });
    let data;
    try { data = await res.json(); } catch { throw new Error(`微信读书返回了无法解析的响应（${res.status}）`); }
    if (!res.ok || data?.errcode && data.errcode !== 0) throw new Error(data?.errmsg || data?.message || `微信读书接口错误（${res.status}）`);
    return data?.data && typeof data.data === 'object' ? data.data : data;
  }

  function mergeBookFromWeRead(raw, progress) {
    if (!raw) return null;
    const bookId = String(raw.bookId || progress?.bookId || '');
    if(bookId&&(state.hiddenWeReadBookIds||[]).map(String).includes(bookId))return null;
    const title = raw.title || raw.name || '';
    const author = raw.author || raw.authorName || '';
    let existing = state.books.find(b => bookId && String(b.weReadBookId || '') === bookId);
    if (!existing && title) {
      const nt = normalizeText(title), na = normalizeAuthor(author);
      existing = state.books.find(b => normalizeText(b.title) === nt && (!na || !normalizeAuthor(b.author) || normalizeAuthor(b.author) === na));
    }
    if (!existing) {
      existing = { key:`wr:${bookId || Date.now()}:${Math.random().toString(36).slice(2,7)}`, title:title || '未命名书籍', author, category:raw.category || '未分类', progress:n(progress?.book?.progress), status:n(progress?.book?.progress)>=100 || raw.finishReading===1 ? 'done' : n(progress?.book?.progress)>0 ? 'reading' : 'unread', minutes:0, words:0, color:palette[state.books.length % palette.length], sources:['weread'] };
      state.books.push(existing);
    }
    existing.sources = [...new Set([...(existing.sources || []), 'weread'])];
    existing.weReadBookId = bookId || existing.weReadBookId;
    existing.weReadCover = raw.cover || existing.weReadCover;
    existing.cover = existing.cover || raw.cover || '';
    if (!existing.author && author) existing.author = author;
    if ((!existing.category || existing.category === '未分类') && raw.category) existing.category = raw.category;
    if (raw.isbn && !existing.isbn) existing.isbn = raw.isbn;
    const p = n(progress?.book?.progress);
    if (p || progress?.book?.isStartReading) {
      existing.weReadProgress = p;
      if (!existing.manualProgress) existing.progress = Math.max(n(existing.progress), p);
      existing.status = p >= 100 ? 'done' : p > 0 ? 'reading' : existing.status;
    }
    const sec = n(progress?.book?.recordReadingTime);
    if (sec > 0) existing.weReadSeconds = sec;
    const updateTime = progress?.book?.updateTime || raw.readUpdateTime;
    if (updateTime) existing.weReadLastRead = safeDate(updateTime);
    const finishTime = progress?.book?.finishTime;
    if (finishTime && !existing.finishedDate) existing.finishedDate = safeDate(finishTime);
    return existing;
  }

  function replaceWeReadDaily(dailyMap) {
    state.weRead.daily = { ...(state.weRead.daily || {}), ...dailyMap };
    state.sessions = state.sessions.filter(s => !(s.source === 'weread' && s.aggregate === true));
    Object.entries(state.weRead.daily).forEach(([date, seconds]) => {
      const sec = n(seconds); if (sec <= 0) return;
      state.sessions.push({ id:`${WR_SESSION_PREFIX}${date}`, date, bookKey:'', title:'微信读书', minutes:Math.round(sec/60), seconds:sec, words:0, source:'weread', aggregate:true, precision:'daily-total' });
    });
  }

  function parseReadTimesObject(obj) {
    const out = {};
    if (!obj || typeof obj !== 'object') return out;
    Object.entries(obj).forEach(([ts, sec]) => { const d = safeDate(ts); if (d && n(sec) >= 0) out[d] = n(sec); });
    return out;
  }

  async function fetchHistoryDaily(overall, full) {
    const daily = {};
    const nowYear = new Date().getFullYear();
    let firstYear = nowYear;
    if (full && overall?.registTime) firstYear = new Date(n(overall.registTime) * 1000).getFullYear();
    if (!full && state.weRead.lastSync) firstYear = Math.max(new Date(state.weRead.lastSync).getFullYear() - 1, nowYear - 1);
    firstYear = Math.max(2000, Math.min(firstYear, nowYear));
    for (let year = firstYear; year <= nowYear; year++) {
      setWeReadStatus(`正在同步 ${year} 年阅读时间……`);
      const baseTime = Math.floor(new Date(year, 5, 15).getTime() / 1000);
      const annual = await wereadCall('/readdata/detail', { mode:'annually', baseTime });
      Object.assign(daily, parseReadTimesObject(annual.dailyReadTimes));
      if (!annual.dailyReadTimes || !Object.keys(annual.dailyReadTimes).length) {
        const monthBuckets = annual.readTimes || {};
        const months = Object.entries(monthBuckets).filter(([,sec]) => n(sec)>0).map(([ts]) => new Date(n(ts)*1000).getMonth()+1);
        const uniqMonths = [...new Set(months.length ? months : Array.from({length:12},(_,i)=>i+1))];
        for (const month of uniqMonths) {
          if (year===nowYear && month>new Date().getMonth()+1) continue;
          const monthBase = Math.floor(new Date(year, month-1, 15).getTime()/1000);
          const m = await wereadCall('/readdata/detail', { mode:'monthly', baseTime:monthBase });
          Object.assign(daily, parseReadTimesObject(m.readTimes));
          await sleep(40);
        }
      }
      await sleep(50);
    }
    return daily;
  }

  async function mapConcurrent(items, limit, worker) {
    const out = new Array(items.length); let index = 0;
    async function runner(){ while(index<items.length){ const i=index++; try{out[i]=await worker(items[i],i)}catch(e){out[i]={__error:e}} } }
    await Promise.all(Array.from({length:Math.min(limit,items.length||1)},runner));
    return out;
  }

  async function syncShelfAndProgress() {
    setWeReadStatus('正在同步微信读书书架和阅读进度……');
    const shelf = await wereadCall('/shelf/sync');
    const books = Array.isArray(shelf.books) ? shelf.books : [];
    const started = books.filter(b => b.readUpdateTime || b.finishReading===1);
    const progressResults = await mapConcurrent(started,3,async b => { const p=await wereadCall('/book/getprogress',{bookId:b.bookId}); await sleep(30); return {raw:b,progress:p}; });
    const progressById = new Map(progressResults.filter(x=>x&&!x.__error).map(x=>[String(x.raw.bookId),x.progress]));
    books.forEach(b=>mergeBookFromWeRead(b,progressById.get(String(b.bookId))));
    return books.length;
  }

  async function fetchAllNotebooks() {
    const all=[]; let lastSort;
    for(let guard=0;guard<100;guard++){
      const params={count:20}; if(lastSort) params.lastSort=lastSort;
      const data=await wereadCall('/user/notebooks',params); const rows=Array.isArray(data.books)?data.books:[]; all.push(...rows);
      if(!data.hasMore||!rows.length) break; lastSort=rows[rows.length-1].sort;
    }
    return all;
  }

  async function syncNotes() {
    setWeReadStatus('正在同步微信读书书摘和想法……');
    const notebooks = await fetchAllNotebooks();
    const existingNonWr = (state.highlights||[]).filter(h=>h.source!=='weread' && h.bookmark!==WR_HIGHLIGHT_MARKER);
    const wrHighlights=[];
    await mapConcurrent(notebooks,3,async nb=>{
      const rawBook=nb.book||{bookId:nb.bookId}; const merged=mergeBookFromWeRead(rawBook,{book:{progress:n(nb.readingProgress)}});
      if(!merged||!rawBook.bookId) return;
      try{
        const marks=await wereadCall('/book/bookmarklist',{bookId:rawBook.bookId});
        (marks.updated||[]).forEach(x=>{ if(!x.markText)return; wrHighlights.push({id:`wr-mark:${x.bookmarkId||Math.random()}`,bookKey:merged.key,date:safeDate(x.createTime)||todayKey,time:n(x.createTime)*1000,quote:x.markText,note:'',bookmark:WR_HIGHLIGHT_MARKER,source:'weread',sourceId:x.bookmarkId||''}); });
      }catch(e){console.warn('WeRead bookmarks skipped',e)}
      try{
        let synckey=0;
        for(let guard=0;guard<100;guard++){
          const data=await wereadCall('/review/list/mine',{bookid:rawBook.bookId,synckey,count:20});
          (data.reviews||[]).forEach(item=>{ const r=item.review||item,content=r.content||'',abstract=r.abstract||''; if(!content&&!abstract)return; wrHighlights.push({id:`wr-review:${r.reviewId||Math.random()}`,bookKey:merged.key,date:safeDate(r.createTime)||todayKey,time:n(r.createTime)*1000,quote:abstract,note:content,bookmark:WR_HIGHLIGHT_MARKER,source:'weread',sourceId:r.reviewId||''}); });
          if(!data.hasMore)break; synckey=data.synckey||0; if(!synckey)break;
        }
      }catch(e){console.warn('WeRead reviews skipped',e)}
      await sleep(35);
    });
    const dedup=new Map(); wrHighlights.forEach(h=>dedup.set(h.id,h)); state.highlights=[...existingNonWr,...dedup.values()];
    return notebooks.length;
  }

  async function syncWeRead({full=false,manual=false}={}) {
    if(window.__yuejiWeReadSyncing)return; window.__yuejiWeReadSyncing=true;
    try{
      setWeReadStatus('正在连接微信读书……');
      await wereadCall('/_list');
      const overall=await wereadCall('/readdata/detail',{mode:'overall'});
      const daily=await fetchHistoryDaily(overall,full); replaceWeReadDaily(daily);
      const bookCount=await syncShelfAndProgress(); const noteBooks=await syncNotes();
      state.weRead.lastSync=Date.now(); state.weRead.skillVersion=SKILL_VERSION; state.weRead.registTime=overall?.registTime||state.weRead.registTime||0;
      state.source=state.books.some(b=>b.sources?.includes('moon'))?'多源阅读档案':'微信读书'; save();
      renderAllSafe(); updateSourcePill(); updateWeReadStatus(`本次同步：${Object.keys(daily).length} 天日级统计 · ${bookCount} 个书架条目 · ${noteBooks} 本有笔记书籍`); toast('微信读书已同步');
    }catch(e){
      console.error(e); const msg=String(e?.message||e); const cors=/failed to fetch|networkerror|load failed/i.test(msg);
      setWeReadStatus(cors?'连接失败：GitHub Pages 浏览器版无法直接跨域访问微信读书网关。Skill Key 和原始数据没有被修改；请改用下方“导入微信读书 JSON”。':`同步失败：${msg}`,true); if(manual)toast('微信读书同步失败');
    }finally{window.__yuejiWeReadSyncing=false}
  }

  function renderAllSafe(){
    try{renderToday()}catch{} try{renderCalendar()}catch{} try{renderBookOptions()}catch{} try{renderNotes()}catch{}
    try{if(page==='analytics')renderAnalytics()}catch{} try{if(page==='monthly'){renderMonthly();renderYearWall()}}catch{}
    renderEvolution(); patchNoteSources();
  }

  function updateSourcePill(){
    const pill=document.getElementById('sourcePill'); if(!pill)return;
    const hasWr=state.books.some(b=>b.sources?.includes('weread'))||Object.keys(state.weRead.daily||{}).length>0;
    const hasMoon=state.books.some(b=>b.sources?.includes('moon'))||state.sessions.some(s=>s.source==='moon');
    if(hasWr&&hasMoon)pill.textContent='多源档案'; else if(hasWr)pill.textContent='微信读书';
  }

  function patchNoteSources(){
    document.querySelectorAll('.note-meta').forEach(el=>{
      if(el.textContent.includes(`静读书摘 · ${WR_HIGHLIGHT_MARKER}`)) el.textContent=el.textContent.replace(`静读书摘 · ${WR_HIGHLIGHT_MARKER}`,'微信读书书摘');
      else if(el.textContent.includes(WR_HIGHLIGHT_MARKER)) el.textContent=el.textContent.replace(WR_HIGHLIGHT_MARKER,'微信读书');
    });
  }

  function injectEvolution(){
    const analytics=document.querySelector('.page[data-page="analytics"]'); if(!analytics||document.getElementById('readingEvolutionCard'))return;
    const card=document.createElement('div'); card.className='card evolution-card'; card.id='readingEvolutionCard';
    card.innerHTML=`<div class="section-head"><div><div class="section-title">阅读演化</div><div class="section-sub">看兴趣随时间怎样迁移。只使用真实日期与真实阅读时长，不用划线数量反推阅读分钟。</div></div></div><div class="evolution-toolbar"><div class="seg" id="evolutionRangeSeg"><button class="active" data-evo-range="year">今年</button><button data-evo-range="12m">近12个月</button><button data-evo-range="all">全部</button></div><div class="seg" id="evolutionSourceSeg"><button class="active" data-evo-source="all">全部</button><button data-evo-source="weread">微信读书</button><button data-evo-source="moon">静读天下</button></div></div><div class="evolution-canvas" id="evolutionCanvas"><div class="evo-tip" id="evolutionTip"></div></div><div class="evo-note">节点位置＝实际阅读日期 × 你给书设置的分类；节点大小只参考可验证的阅读时长。一本书来自两个平台时会合并成同一个节点。</div>`;
    analytics.appendChild(card); card.dataset.range='year'; card.dataset.source='all';
    card.querySelector('#evolutionRangeSeg').addEventListener('click',e=>{const b=e.target.closest('[data-evo-range]');if(!b)return;card.dataset.range=b.dataset.evoRange;b.parentElement.querySelectorAll('button').forEach(x=>x.classList.toggle('active',x===b));renderEvolution()});
    card.querySelector('#evolutionSourceSeg').addEventListener('click',e=>{const b=e.target.closest('[data-evo-source]');if(!b)return;card.dataset.source=b.dataset.evoSource;b.parentElement.querySelectorAll('button').forEach(x=>x.classList.toggle('active',x===b));renderEvolution()});
  }

  function readingMinutesForBook(b,sourceFilter){
    let mins=0; if(sourceFilter==='all'||sourceFilter==='weread')mins+=n(b.weReadSeconds)/60;
    if(sourceFilter==='all'||sourceFilter==='moon'){const moon=state.sessions.filter(s=>s.bookKey===b.key&&s.source!=='weread').reduce((a,s)=>a+n(s.minutes),0);mins+=moon||n(b.minutes)}
    return mins;
  }
  function actualDateForBook(b,sourceFilter){
    const dates=[]; if(sourceFilter==='all'||sourceFilter==='moon')state.sessions.forEach(s=>{if(s.bookKey===b.key&&s.date&&s.source!=='weread')dates.push(s.date)});
    if((sourceFilter==='all'||sourceFilter==='weread')&&b.weReadLastRead)dates.push(b.weReadLastRead); if(b.finishedDate)dates.push(b.finishedDate); dates.sort(); return dates[dates.length-1]||'';
  }
  function escapeXml(s=''){return String(s).replace(/[<>&"']/g,ch=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[ch]))}

  function renderEvolution(){
    const card=document.getElementById('readingEvolutionCard'),canvas=document.getElementById('evolutionCanvas'); if(!card||!canvas)return;
    const range=card.dataset.range||'year',sourceFilter=card.dataset.source||'all',now=new Date(); let start;
    if(range==='year')start=new Date(now.getFullYear(),0,1); else if(range==='12m')start=new Date(now.getFullYear(),now.getMonth()-11,1); else start=new Date(2000,0,1);
    const startKey=dateKey(start),endKey=todayKey;
    const raw=state.books.map(b=>({b,date:actualDateForBook(b,sourceFilter),mins:readingMinutesForBook(b,sourceFilter)})).filter(x=>x.date&&x.date>=startKey&&x.date<=endKey).filter(x=>sourceFilter==='all'||x.b.sources?.includes(sourceFilter));
    if(!raw.length){canvas.innerHTML='<div class="evo-empty">这个范围还没有可以定位到真实日期的阅读记录。</div><div class="evo-tip" id="evolutionTip"></div>';return}
    const catCount={};raw.forEach(x=>catCount[x.b.category||'未分类']=(catCount[x.b.category||'未分类']||0)+1);let cats=Object.entries(catCount).sort((a,b)=>b[1]-a[1]).map(x=>x[0]);
    if(cats.length>6){const keep=cats.slice(0,5);raw.forEach(x=>{if(!keep.includes(x.b.category||'未分类'))x.displayCategory='其他'});cats=[...keep,'其他']}
    const w=360,h=Math.max(430,range==='all'?560:470),left=44,right=12,top=36,bottom=24,usableW=w-left-right,usableH=h-top-bottom;
    const startMs=parseDate(startKey).getTime(),endMs=parseDate(endKey).getTime()||Date.now(),maxMins=Math.max(1,...raw.map(x=>x.mins));
    const xForCat=cat=>left+(cats.indexOf(cat)+.5)*(usableW/cats.length),yForDate=d=>top+((parseDate(d).getTime()-startMs)/Math.max(1,endMs-startMs))*usableH,rFor=m=>m>0?4.5+6*Math.log1p(m)/Math.log1p(maxMins):4.5;
    raw.sort((a,b)=>a.date.localeCompare(b.date));
    const positions=raw.map((x,i)=>{const cat=x.displayCategory||x.b.category||'未分类',baseX=xForCat(cat),jitter=((i*37)%9-4)*1.25;return{...x,cat,x:Math.max(left+4,Math.min(w-right-4,baseX+jitter)),y:yForDate(x.date),r:rFor(x.mins)}});
    const lines=positions.slice(1).map((p,i)=>{const a=positions[i],mx=(a.x+p.x)/2;return`<path d="M ${a.x.toFixed(1)} ${a.y.toFixed(1)} C ${mx.toFixed(1)} ${a.y.toFixed(1)}, ${mx.toFixed(1)} ${p.y.toFixed(1)}, ${p.x.toFixed(1)} ${p.y.toFixed(1)}" fill="none" stroke="rgba(var(--accent-rgb),.20)" stroke-width="1" stroke-dasharray="2 4"/>`}).join('');
    const catLabels=cats.map(c=>`<text x="${xForCat(c)}" y="18" text-anchor="middle" class="evo-label">${escapeXml(c.length>5?c.slice(0,5):c)}</text>`).join('');
    const yearMarks=[];for(let y=start.getFullYear();y<=now.getFullYear();y++){const d=`${y}-01-01`;if(d<startKey||d>endKey)continue;const yy=yForDate(d);yearMarks.push(`<line x1="${left}" y1="${yy}" x2="${w-right}" y2="${yy}" stroke="rgba(128,128,128,.12)"/><text x="4" y="${yy+3}" class="evo-year">${y}</text>`)}
    const nodes=positions.map((p,i)=>`<circle class="evo-node" data-evo-index="${i}" cx="${p.x}" cy="${p.y}" r="${p.r.toFixed(1)}" fill="${p.b.color||palette[i%palette.length]||'#777'}" fill-opacity=".88" stroke="var(--card)" stroke-width="1.5"><title>${escapeXml(p.b.title||'未命名')}</title></circle>`).join('');
    canvas.innerHTML=`<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="阅读演化图">${catLabels}${yearMarks.join('')}${lines}${nodes}</svg><div class="evo-tip" id="evolutionTip"></div>`;
    const tip=canvas.querySelector('#evolutionTip'); canvas.querySelectorAll('[data-evo-index]').forEach(el=>{const p=positions[Number(el.dataset.evoIndex)];const show=ev=>{const rect=canvas.getBoundingClientRect();tip.style.display='block';tip.style.left=`${Math.min(rect.width-230,Math.max(8,ev.clientX-rect.left+10))}px`;tip.style.top=`${Math.max(8,ev.clientY-rect.top-8)}px`;const sources=(p.b.sources||[]).map(sourceName).filter(Boolean).join(' · ');tip.innerHTML=`<b>${esc(p.b.title||'未命名')}</b>${esc(p.date)} · ${esc(p.cat)}<br>${p.mins>0?`真实阅读时长约 ${Math.round(p.mins)} 分钟<br>`:''}${esc(sources)}`};el.addEventListener('mousemove',show);el.addEventListener('mouseenter',show);el.addEventListener('mouseleave',()=>tip.style.display='none')});
  }

  function installHooks(){
    const originalSwitchPage=switchPage; switchPage=function(p){originalSwitchPage(p);if(p==='analytics')setTimeout(renderEvolution,0);if(p==='notes')setTimeout(patchNoteSources,0)};
    document.getElementById('noteSearch')?.addEventListener('input',()=>setTimeout(patchNoteSources,0)); document.getElementById('noteBookFilter')?.addEventListener('change',()=>setTimeout(patchNoteSources,0));
    document.getElementById('mrproFile')?.addEventListener('change',()=>setTimeout(()=>{ensureStateShape();updateSourcePill();renderEvolution()},1500));
    const notes=document.getElementById('notesList'); if(notes)new MutationObserver(()=>patchNoteSources()).observe(notes,{childList:true,subtree:true});
  }

  async function autoSyncIfNeeded(){const key=localStorage.getItem(EXT_KEY);if(!key)return;if(Date.now()-n(state.weRead.lastSync)<AUTO_SYNC_MS)return;await syncWeRead({full:!state.weRead.lastSync,manual:false})}

  function init(){ensureStateShape();injectStyles();injectSettings();injectEvolution();installHooks();updateSourcePill();renderEvolution();patchNoteSources();setTimeout(autoSyncIfNeeded,700)}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
