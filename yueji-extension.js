(() => {
  'use strict';

  const EXT_KEY = 'yueji-weread-key';
  const SYNC_GUARD_KEY = 'yueji-weread-sync-guard-v1';
  const SYNC_DB = 'yueji-weread-sync-v1';
  const SYNC_STORE = 'records';
  const SYNC_DIAGNOSTIC_KEY = 'yueji-weread-last-stage-v1';
  const GATEWAY = '/.netlify/functions/weread-gateway';
  const SKILL_VERSION = '1.0.4';
  const AUTO_SYNC_MS = 6 * 60 * 60 * 1000;
  const REQUEST_TIMEOUT_MS = 18000;
  const SYNC_DEADLINE_MS = 60000;
  const PROGRESS_BATCH_SIZE = 1;
  const API_RESPONSE_MAX_BYTES = 512 * 1024;
  const JSON_WORKER_THRESHOLD = 256 * 1024;
  const WR_SESSION_PREFIX = 'weread-day:';
  const WR_HIGHLIGHT_MARKER = '__YUEJI_WEREAD__';
  let activeSync = null;
  let hiddenBookIds = new Set();
  let bookByWeReadId = new Map();
  let bookByIdentity = new Map();
  let booksByTitle = new Map();

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const yieldToBrowser = () => new Promise(resolve => {
    if (globalThis.scheduler?.yield) globalThis.scheduler.yield().then(resolve, resolve);
    else setTimeout(resolve, 0);
  });

  async function parseJsonText(text) {
    const raw = String(text ?? '');
    if (raw.length < JSON_WORKER_THRESHOLD) {
      return JSON.parse(raw);
    }
    if (typeof Worker === 'undefined' || typeof Blob === 'undefined' || typeof URL?.createObjectURL !== 'function') throw new Error('后台解析不可用，为保护页面已停止读取大数据');
    let worker;
    let workerUrl;
    let timeout;
    try {
      workerUrl = URL.createObjectURL(new Blob([
        "self.onmessage=function(event){try{self.postMessage({ok:true,value:JSON.parse(event.data)})}catch(error){self.postMessage({ok:false,message:String(error&&error.message||error)})}}"
      ], { type: 'text/javascript' }));
      worker = new Worker(workerUrl);
      return await new Promise((resolve, reject) => {
        timeout = setTimeout(() => reject(new Error('解析数据超时')), REQUEST_TIMEOUT_MS);
        worker.onmessage = event => event.data?.ok ? resolve(event.data.value) : reject(new Error(event.data?.message || '无法解析 JSON'));
        worker.onerror = () => reject(new Error('后台解析器启动失败'));
        worker.postMessage(raw);
      });
    } catch (error) {
      throw error;
    } finally {
      clearTimeout(timeout);
      worker?.terminate();
      if (workerUrl) URL.revokeObjectURL(workerUrl);
    }
  }
  window.yuejiParseJsonText = parseJsonText;

  async function stringifyJsonValue(value) {
    if (typeof Worker === 'undefined' || typeof Blob === 'undefined' || typeof URL?.createObjectURL !== 'function') {
      return JSON.stringify(value, null, 2);
    }
    let worker;
    let workerUrl;
    let timeout;
    try {
      workerUrl = URL.createObjectURL(new Blob([
        "self.onmessage=function(event){try{self.postMessage({ok:true,value:JSON.stringify(event.data,null,2)})}catch(error){self.postMessage({ok:false,message:String(error&&error.message||error)})}}"
      ], { type: 'text/javascript' }));
      worker = new Worker(workerUrl);
      return await new Promise((resolve, reject) => {
        timeout = setTimeout(() => reject(new Error('生成备份超时')), 30000);
        worker.onmessage = event => event.data?.ok ? resolve(event.data.value) : reject(new Error(event.data?.message || '无法生成备份'));
        worker.onerror = () => reject(new Error('后台备份生成器启动失败'));
        worker.postMessage(value);
      });
    } catch (error) {
      if (/超时|cyclic|circular/i.test(String(error?.message || error))) throw error;
      return JSON.stringify(value, null, 2);
    } finally {
      clearTimeout(timeout);
      worker?.terminate();
      if (workerUrl) URL.revokeObjectURL(workerUrl);
    }
  }
  window.yuejiStringifyJson = stringifyJsonValue;
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
  const compactShelfBook = b => ({bookId:b?.bookId,title:b?.title,name:b?.name,author:b?.author,authorName:b?.authorName,category:b?.category,cover:b?.cover,isbn:b?.isbn,finishReading:b?.finishReading,readUpdateTime:b?.readUpdateTime});
  const compactNotebook = nb => ({book:compactShelfBook(nb?.book||{bookId:nb?.bookId}),bookId:nb?.bookId,readingProgress:nb?.readingProgress,sort:nb?.sort});

  function isStorageLimitError(error) {
    return error?.name === 'QuotaExceededError' || error?.code === 22 || /quota|storage.*(full|limit)|exceeded/i.test(String(error?.message||error));
  }

  async function saveCheckpoint({highlights=false,highlightRows=[]}={}) {
    try { if(window.yuejiHighlightsReady)await window.yuejiHighlightsReady;if(window.yuejiHighlightsDbReady?.()){if(highlights)await window.yuejiPersistHighlights();else if(highlightRows.length)await window.yuejiPutHighlights(highlightRows)}save(); return true; }
    catch (error) {
      if (isStorageLimitError(error)) throw new Error('STORAGE_LIMIT');
      throw error;
    }
  }

  function saveBestEffort() {
    try { save(); return true; }
    catch (error) { console.warn('Yueji local save skipped', error); return false; }
  }

  function syncDb(){return new Promise((resolve,reject)=>{const req=indexedDB.open(SYNC_DB,2);req.onupgradeneeded=()=>{const db=req.result;if(db.objectStoreNames.contains('snapshots'))db.deleteObjectStore('snapshots');if(!db.objectStoreNames.contains(SYNC_STORE))db.createObjectStore(SYNC_STORE,{keyPath:'id'})};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);req.onblocked=()=>reject(new Error('微信同步数据库被其他页面占用'))})}
  function syncDbRequest(work,mode='readonly'){return syncDb().then(db=>new Promise((resolve,reject)=>{const tx=db.transaction(SYNC_STORE,mode),store=tx.objectStore(SYNC_STORE),req=work(store);let result;req.onsuccess=()=>{result=req.result};req.onerror=()=>reject(req.error);tx.oncomplete=()=>{db.close();resolve(result)};tx.onerror=()=>{db.close();reject(tx.error||new Error('微信同步暂存失败'))};tx.onabort=()=>{db.close();reject(tx.error||new Error('微信同步暂存失败'))}}))}
  function compactWeReadMeta(source=state){const {daily,shelfBooks,...meta}=source.weRead||{};return{...meta,dailyCount:Object.keys(daily||{}).length,shelfTotal:n(source.weRead?.shelfTotal)}}
  function compactLocalWeReadMeta(source=state){const {daily,shelfBooks,notebooks,reviewCursors,...meta}=source.weRead||{};return{...meta,dailyCount:Object.keys(daily||{}).length,shelfTotal:n(source.weRead?.shelfTotal),notebooksTotal:n(source.weRead?.notebooksTotal)}}
  function diagnosticStage(stage,detail={}){try{localStorage.setItem(SYNC_DIAGNOSTIC_KEY,JSON.stringify({stage,detail,at:Date.now()}))}catch{}}
  async function putSyncRows(rows){if(!rows.length)return;const db=await syncDb();try{for(let start=0;start<rows.length;start+=50){const tx=db.transaction(SYNC_STORE,'readwrite'),done=new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error)}),store=tx.objectStore(SYNC_STORE);rows.slice(start,start+50).forEach(row=>store.put(row));await done;await yieldToBrowser()}}finally{db.close()}}
  async function persistSyncIncrement({books=[],sessions=[],includeShelf=false}={}){diagnosticStage('indexeddb-write',{books:books.length,sessions:sessions.length});const rows=[{id:'meta',kind:'meta',savedAt:Date.now(),weRead:compactWeReadMeta()}];for(const b of books){const id=String(b.weReadBookId||'');if(id)rows.push({id:`book:${id}`,kind:'book',value:b})}for(const s of sessions){if(s.id)rows.push({id:`session:${s.id}`,kind:'session',value:s})}if(includeShelf)rows.push({id:'shelf',kind:'shelf',value:(state.weRead.shelfBooks||[]).map(compactShelfBook)});await putSyncRows(rows);diagnosticStage('indexeddb-complete',{rows:rows.length})}
  async function replaceSyncArchive(source=state){const db=await syncDb();try{const tx=db.transaction(SYNC_STORE,'readwrite'),done=new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error)});tx.objectStore(SYNC_STORE).clear();await done}finally{db.close()}const books=(source.books||[]).filter(b=>b.sources?.includes('weread')),sessions=(source.sessions||[]).filter(s=>s.source==='weread');const original=state;try{state=source;await persistSyncIncrement({books,sessions,includeShelf:true})}finally{state=original}}
  async function stageSyncSnapshot(){await persistSyncIncrement();return true}
  async function clearSyncSnapshot(){}
  async function commitSyncCheckpoint(options={}){if(options.highlightRows?.length)await persistHighlightRowsOnly(options.highlightRows);await persistSyncIncrement(options);diagnosticStage('step-complete',{phase:state.weRead.syncPhase})}
  async function persistHighlightRowsOnly(rows){if(!rows?.length)return;if(window.yuejiHighlightsReady)await window.yuejiHighlightsReady;if(window.yuejiHighlightsDbReady?.())await window.yuejiPutHighlights(rows);else state.highlights.push(...rows.filter(x=>!state.highlights.some(y=>y.id===x.id)))}
  async function recoverSyncSnapshot(){let rows=[];try{rows=await syncDbRequest(store=>store.getAll())||[]}catch(error){console.warn('微信同步数据库读取失败',error);return false}if(!rows.length)return false;const hidden=new Set((state.hiddenWeReadBookIds||[]).map(String)),meta=rows.find(x=>x.id==='meta'),shelf=rows.find(x=>x.id==='shelf');if(meta?.weRead)state.weRead={...state.weRead,...meta.weRead,syncState:meta.weRead.syncState==='running'?'paused':meta.weRead.syncState};if(shelf?.value)state.weRead.shelfBooks=shelf.value.filter(b=>!hidden.has(String(b?.bookId||'')));const byId=new Map(state.books.filter(b=>b.weReadBookId).map(b=>[String(b.weReadBookId),b])),byKey=new Map(state.books.map(b=>[String(b.key),b]));for(const row of rows){if(row.kind!=='book'||!row.value)continue;const incoming=row.value;if(incoming.weReadBookId&&hidden.has(String(incoming.weReadBookId)))continue;const found=incoming.weReadBookId?byId.get(String(incoming.weReadBookId)):byKey.get(String(incoming.key));if(found)Object.assign(found,incoming);else state.books.push(incoming)}const savedSessions=rows.filter(x=>x.kind==='session'&&x.value).map(x=>x.value),sessionIds=new Set(savedSessions.map(x=>x.id));state.sessions=state.sessions.filter(s=>s.source!=='weread'||!sessionIds.has(s.id)).concat(savedSessions);state.weRead.daily={};savedSessions.forEach(s=>{if(s.date)state.weRead.daily[s.date]=n(s.seconds)||n(s.minutes)*60});rebuildBookIndexes();return true}

  async function deleteSyncBook(bookId){const id=String(bookId||'');if(!id)return;const db=await syncDb();try{const tx=db.transaction(SYNC_STORE,'readwrite'),store=tx.objectStore(SYNC_STORE),shelfReq=store.get('shelf');shelfReq.onsuccess=()=>{const row=shelfReq.result;if(row?.value){row.value=row.value.filter(b=>String(b?.bookId||'')!==id);store.put(row)}};store.delete(`book:${id}`);await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error)})}finally{db.close()}}
  window.yuejiDeleteWeReadSyncBook=deleteSyncBook;

  window.yuejiCompactExternalState=value=>{const books=(value.books||[]).flatMap(b=>{const sources=(b.sources||[]).filter(x=>x!=='weread');if(!sources.length)return[];const copy={...b,sources};delete copy.weReadBookId;delete copy.weReadSeconds;delete copy.weReadLastRead;delete copy.weReadCover;delete copy.readUpdateTime;delete copy.finishReading;return[copy]}),weRead=value.weRead?compactLocalWeReadMeta({weRead:value.weRead}):undefined;return{...value,books,sessions:(value.sessions||[]).filter(s=>s.source!=='weread'),weRead}}
  window.yuejiPersistExternalState=replaceSyncArchive;

  function ensureStateShape() {
    state.weRead = state.weRead && typeof state.weRead === 'object' ? state.weRead : {};
    state.weRead.lastSync = n(state.weRead.lastSync);
    state.weRead.progressCursor = n(state.weRead.progressCursor);
    state.weRead.notesCursor = n(state.weRead.notesCursor);
    state.weRead.progressDone = Boolean(state.weRead.progressDone);
    state.weRead.notesDone = Boolean(state.weRead.notesDone);
    state.weRead.progressTotal = n(state.weRead.progressTotal);
    state.weRead.notebooksTotal = n(state.weRead.notebooksTotal);
    state.weRead.shelfTotal = n(state.weRead.shelfTotal);
    state.weRead.statsDays = n(state.weRead.statsDays);
    state.weRead.statsSyncYear = n(state.weRead.statsSyncYear);
    state.weRead.statsMonthCursor = n(state.weRead.statsMonthCursor);
    state.weRead.statsDone = state.weRead.statsDone === undefined ? Boolean(state.weRead.lastSync) : Boolean(state.weRead.statsDone);
    state.weRead.syncPhase = String(state.weRead.syncPhase || '');
    state.weRead.notebookCursor = state.weRead.notebookCursor ?? '';
    state.weRead.interruptedAt = n(state.weRead.interruptedAt);
    state.weRead.syncState = String(state.weRead.syncState || (state.weRead.lastSync ? 'base-complete' : 'idle'));
    state.weRead.reviewCursors = state.weRead.reviewCursors && typeof state.weRead.reviewCursors === 'object' ? state.weRead.reviewCursors : {};
    state.weRead.shelfBooks = Array.isArray(state.weRead.shelfBooks) ? state.weRead.shelfBooks : [];
    state.weRead.notebooks = Array.isArray(state.weRead.notebooks) ? state.weRead.notebooks : [];
    state.weRead.autoRetryBlocked = Boolean(state.weRead.autoRetryBlocked);
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
    if(state.weRead.syncState==='running'||localStorage.getItem(SYNC_GUARD_KEY)){state.weRead.syncState='paused';state.weRead.interruptedAt=Date.now();localStorage.removeItem(SYNC_GUARD_KEY)}
    rebuildBookIndexes();
    saveBestEffort();
  }

  function bookIdentity(title,author){return `${normalizeText(title)}|${normalizeAuthor(author)}`}
  function rebuildBookIndexes(){
    hiddenBookIds=new Set((state.hiddenWeReadBookIds||[]).map(String));
    bookByWeReadId=new Map();bookByIdentity=new Map();booksByTitle=new Map();
    state.books.forEach(b=>{
      if(b.weReadBookId)bookByWeReadId.set(String(b.weReadBookId),b);
      const title=normalizeText(b.title),id=bookIdentity(b.title,b.author);if(title&&!bookByIdentity.has(id))bookByIdentity.set(id,b);
      if(title){const rows=booksByTitle.get(title)||[];rows.push(b);booksByTitle.set(title,rows)}
    });
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
      .wr-progress{margin-top:12px;padding:12px;border:1px solid var(--line);border-radius:16px;background:var(--soft)}
      .wr-progress-head{display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:10px;font-size:12px}
      .wr-progress-head b{font-size:13px;color:var(--text)}
      .wr-progress-head span{color:var(--muted)}
      .wr-progress-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
      .wr-progress-item{padding:9px;border-radius:12px;background:var(--card);border:1px solid var(--line);min-width:0}
      .wr-progress-item span{display:block;color:var(--muted);font-size:10px;margin-bottom:4px}
      .wr-progress-item strong{display:block;color:var(--text);font-size:12px;overflow-wrap:anywhere}
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
      @media(max-width:520px){.wr-connect-row{grid-template-columns:1fr}.wr-connect-row .primary-btn{width:100%}.wr-progress-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.evolution-canvas svg{min-height:390px}}
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
      <div class="section-sub">输入微信读书 Skill Key。连接或自动更新时先轻量同步书架和当年阅读统计；阅读进度与个人书摘按小批次继续同步，避免手机卡死。已经进入微信读书云端书架的导入书也会读取，只留在手机文件夹里的书不会读取。Key 只保存在当前浏览器，不进入阅迹 JSON 备份。</div>
      <div class="wr-connect-row">
        <input id="wereadKeyInput" class="wr-key" type="password" autocomplete="off" placeholder="Skill Key">
        <button class="primary-btn" id="wereadConnectBtn">连接并同步</button>
      </div>
      <div class="wr-status" id="wereadStatus">尚未连接微信读书。</div>
      <div class="wr-progress" id="wereadProgressPanel"><div class="wr-progress-head"><b>正在恢复本地同步状态……</b></div></div>
      <div class="wr-actions">
        <button class="soft-btn" id="wereadSyncBtn">更新基础数据</button>
        <button class="soft-btn" id="wereadContinueBtn">继续未完成同步</button>
        <button class="soft-btn" id="wereadRestartBtn">重新同步全部</button>
        <button class="soft-btn" id="wereadStopBtn" disabled>暂停同步</button>
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
      state.weRead.autoRetryBlocked = false;
      state.weRead.syncPhase = 'verify';
      await syncWeRead({ mode: 'quick', manual: true });
    });
    document.getElementById('wereadSyncBtn').addEventListener('click', async () => {
      if (!localStorage.getItem(EXT_KEY)) return setWeReadStatus('还没有保存 Skill Key。', true);
      state.weRead.autoRetryBlocked = false;
      state.weRead.syncPhase = 'shelf';
      await syncWeRead({ mode: 'quick', manual: true });
    });
    document.getElementById('wereadContinueBtn').addEventListener('click', async () => {
      if (!localStorage.getItem(EXT_KEY)) return setWeReadStatus('还没有保存 Skill Key。', true);
      await syncWeRead({ mode: 'continue', manual: true });
    });
    document.getElementById('wereadRestartBtn').addEventListener('click', async () => {
      if (!localStorage.getItem(EXT_KEY)) return setWeReadStatus('还没有保存 Skill Key。', true);
      state.weRead.syncPhase='verify';state.weRead.statsSyncYear=0;state.weRead.statsMonthCursor=0;state.weRead.statsDone=false;state.weRead.progressCursor=0;state.weRead.progressDone=false;state.weRead.notesCursor=0;state.weRead.notesDone=false;state.weRead.notebookCursor='';state.weRead.notebooks=[];state.weRead.reviewCursors={};
      await syncWeRead({ mode: 'quick', manual: true, resetDetails: true });
    });
    document.getElementById('wereadStopBtn').addEventListener('click', () => stopActiveSync());
    document.getElementById('wereadDisconnectBtn').addEventListener('click', () => {
      localStorage.removeItem(EXT_KEY);
      stopActiveSync(false);
      state.weRead.syncState = 'idle';
      saveBestEffort();
      document.getElementById('wereadKeyInput').value = '';
      setWeReadStatus('已断开微信读书。阅迹里已经同步过的数据不会删除。');
      updateSourcePill();
    });
    document.getElementById('wereadJsonFile').addEventListener('change',async e=>{const file=e.target.files?.[0];if(!file)return;try{await importWeReadFile(file);e.target.value=''}catch(err){const msg=String(err?.message||err);setWeReadStatus(msg==='STORAGE_LIMIT'?'浏览器本地储存空间不足，导入已停止。原有数据没有删除，请先导出备份。':'导入失败：'+msg,true)}});
    updateWeReadStatus();
  }

  async function importWeReadFile(file){
    if(window.yuejiHighlightsReady)await window.yuejiHighlightsReady;
    const data=await parseJsonText(await file.text()),shelf=data.shelf||data.data?.shelf||data,books=Array.isArray(shelf.books)?shelf.books:Array.isArray(data.books)?data.books:[],progressRows=Array.isArray(data.progress)?data.progress:Array.isArray(data.progresses)?data.progresses:[];
    if(!books.length)throw new Error('文件里没有找到微信读书书架 books[]');
    const progressMap=new Map(progressRows.map(x=>[String(x.bookId||x.book?.bookId||''),x]));
    let imported=0;
    for(let i=0;i<books.length;i++){
      const raw=books[i],merged=mergeBookFromWeRead(raw,progressMap.get(String(raw.bookId)));if(merged)imported++;
      if((i+1)%25===0){setWeReadStatus(`正在分批导入书架 ${i+1}/${books.length}……`);await yieldToBrowser()}
    }
    const daily=data.daily||data.readDays||data.readdata?.daily;if(daily&&typeof daily==='object'&&!Array.isArray(daily))replaceWeReadDaily(daily);
    state.weRead.shelfBooks=books.filter(b=>!hiddenBookIds.has(String(b?.bookId||''))).map(compactShelfBook);state.weRead.lastSync=Date.now();state.weRead.shelfTotal=imported;state.weRead.statsDays=Object.keys(state.weRead.daily||{}).length;state.weRead.syncState='base-complete';state.source=state.books.some(b=>b.sources?.includes('moon'))?'多源阅读档案':'微信读书';await persistSyncIncrement({books:state.books.filter(b=>b.sources?.includes('weread')),sessions:state.sessions.filter(s=>s.source==='weread'),includeShelf:true});await saveCheckpoint();await window.yuejiRequestPersistentStorage?.();renderAllSafe();updateSourcePill();updateWeReadStatus(`已从 JSON 导入 ${imported} 本书`);toast('微信读书 JSON 已导入');
  }

  function setWeReadStatus(text, isError = false) {
    const el = document.getElementById('wereadStatus');
    if (!el) return;
    el.innerHTML = `<span style="${isError ? 'color:#b65b5b' : ''}">${esc(text)}</span>`;
    updateWeReadProgressPanel();
  }

  function syncStateLabel(){const key=localStorage.getItem(EXT_KEY);if(!key)return'未连接';return({running:'同步中',paused:'已暂停',error:'部分失败',complete:'全部完成','base-complete':'基础数据完成',idle:'等待同步'})[state.weRead.syncState]||'等待同步'}
  function syncPhaseLabel(){return({verify:'验证连接',shelf:'待读书架',stats:'待读月份',progress:'待读进度',notebooks:'待读笔记目录',bookmarks:'待读划线',reviews:'待读想法',complete:'全部完成'})[inferSyncPhase()]||'等待同步'}
  function updateWeReadProgressPanel(){const panel=document.getElementById('wereadProgressPanel');if(!panel)return;const progressTotal=n(state.weRead.progressTotal),notesTotal=n(state.weRead.notebooksTotal),progressDone=state.weRead.progressDone?progressTotal:n(state.weRead.progressCursor),notesDone=state.weRead.notesDone?notesTotal:n(state.weRead.notesCursor),last=state.weRead.lastSync?new Date(state.weRead.lastSync).toLocaleString('zh-CN',{hour12:false}):'尚未完成',monthProgress=!state.weRead.statsDone&&state.weRead.statsSyncYear?`${Math.min(n(state.weRead.statsMonthCursor),12)} 月已保存`:`${n(state.weRead.statsDays)} 天`;let diagnostic='';try{const row=JSON.parse(localStorage.getItem(SYNC_DIAGNOSTIC_KEY)||'null');if(row?.stage&&!String(row.stage).endsWith('complete'))diagnostic=`<small class="wr-diagnostic">上次中断位置：${esc(row.stage)} · ${esc(new Date(row.at).toLocaleString('zh-CN',{hour12:false}))}</small>`}catch{}panel.innerHTML=`<div class="wr-progress-head"><b>${esc(syncStateLabel())} · ${esc(syncPhaseLabel())}</b><span>最后更新：${esc(last)}</span></div><div class="wr-progress-grid"><div class="wr-progress-item"><span>书架</span><strong>${n(state.weRead.shelfTotal)} 本</strong></div><div class="wr-progress-item"><span>阅读统计</span><strong>${esc(monthProgress)}</strong></div><div class="wr-progress-item"><span>阅读进度</span><strong>${progressDone} / ${progressTotal || '待读取'}</strong></div><div class="wr-progress-item"><span>书摘书目</span><strong>${notesDone} / ${notesTotal || '待读取'}</strong></div></div>${diagnostic}`}

  function updateWeReadStatus(extra = '') {
    const el = document.getElementById('wereadStatus');
    if (!el) return;
    const key = localStorage.getItem(EXT_KEY);
    if (!key) { el.textContent = '尚未连接微信读书。'; updateWeReadProgressPanel(); return; }
    const last = state.weRead.lastSync ? new Date(state.weRead.lastSync) : null;
    const lastText = last ? `${last.getFullYear()}-${pad(last.getMonth()+1)}-${pad(last.getDate())} ${pad(last.getHours())}:${pad(last.getMinutes())}` : '尚未完成首次同步';
    const days = Object.keys(state.weRead.daily || {}).length;
    const wrBooks = state.books.filter(b => b.sources?.includes('weread')).length;
    const recovery=!extra&&state.weRead.interruptedAt?'上次同步被浏览器中断，已恢复为暂停；已保存的数据仍然保留。':'';
    el.innerHTML = `<strong>已连接</strong> · 上次同步：${esc(lastText)}<br>已保存 ${days} 天微信读书日级时长 · ${wrBooks} 本微信读书书籍${extra||recovery ? `<br>${esc(extra||recovery)}` : ''}`;
    updateWeReadProgressPanel();
  }

  function syncButtonState(running) {
    ['wereadConnectBtn','wereadSyncBtn','wereadContinueBtn','wereadRestartBtn'].forEach(id=>{const el=document.getElementById(id);if(el)el.disabled=running});
    const stop=document.getElementById('wereadStopBtn'); if(stop)stop.disabled=!running;
  }

  function beginSync(mode) {
    if (activeSync) return null;
    activeSync = { mode, cancelled:false, started:Date.now(), deadline:Date.now()+SYNC_DEADLINE_MS, requests:0, maxRequests:1, controller:null };
    rebuildBookIndexes();state.weRead.syncState='running';state.weRead.interruptedAt=0;try{localStorage.setItem(SYNC_GUARD_KEY,JSON.stringify({mode,started:activeSync.started}))}catch{}window.__yuejiWeReadSyncing = true; syncButtonState(true);updateWeReadProgressPanel(); return activeSync;
  }

  function assertSyncActive(ctx) {
    if (!ctx || ctx !== activeSync || ctx.cancelled) throw new Error('SYNC_PAUSED');
    if (Date.now() > ctx.deadline) throw new Error('SYNC_TIME_LIMIT');
  }

  function stopActiveSync(showStatus=true) {
    if (!activeSync) return;
    activeSync.cancelled = true;
    try { activeSync.controller?.abort(); } catch {}
    state.weRead.syncState='paused';if (showStatus) setWeReadStatus('正在暂停同步；当前请求结束后会保存已完成的数据。');
  }

  async function readApiResponseText(res,ctx){const declared=n(res.headers.get('content-length'));if(declared>API_RESPONSE_MAX_BYTES)throw new Error('微信读书单次返回数据过大，已安全停止');if(!res.body?.getReader){const text=await res.text();if(new Blob([text]).size>API_RESPONSE_MAX_BYTES)throw new Error('微信读书单次返回数据过大，已安全停止');return text}const reader=res.body.getReader(),decoder=new TextDecoder(),parts=[];let total=0;try{while(true){if(ctx)assertSyncActive(ctx);const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>API_RESPONSE_MAX_BYTES){await reader.cancel();throw new Error('微信读书单次返回数据过大，已安全停止')}parts.push(decoder.decode(value,{stream:true}));if(parts.length%8===0)await yieldToBrowser()}parts.push(decoder.decode());return parts.join('')}finally{try{reader.releaseLock()}catch{}}}

  async function wereadCall(apiName, params = {}, ctx = activeSync) {
    const key = localStorage.getItem(EXT_KEY);
    if (!key) throw new Error('没有 Skill Key');
    if (ctx) assertSyncActive(ctx);
    if (ctx && ctx.requests >= ctx.maxRequests) throw new Error('SYNC_REQUEST_LIMIT');
    if (ctx) ctx.requests++;
    const controller = new AbortController();
    if (ctx) ctx.controller = controller;
    const remaining=ctx?Math.max(1,ctx.deadline-Date.now()):REQUEST_TIMEOUT_MS;
    const timer = setTimeout(() => controller.abort(), Math.min(REQUEST_TIMEOUT_MS,remaining));
    let res;
    try {
      res = await fetch(GATEWAY, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_name: apiName, skill_version: SKILL_VERSION, ...params }),
        signal: controller.signal
      });
      let data;
      try {diagnosticStage('response-read',{apiName});const text=await readApiResponseText(res,ctx);diagnosticStage('response-parse',{apiName,bytes:new TextEncoder().encode(text).byteLength});await yieldToBrowser();data=await parseJsonText(text);diagnosticStage('response-parsed',{apiName})} catch(error){if(/^SYNC_|微信读书单次返回数据过大/.test(String(error?.message||'')))throw error;throw new Error(`微信读书返回了无法解析的响应（${res.status}）`);}
      if (!res.ok || data?.errcode && data.errcode !== 0) throw new Error(data?.errmsg || data?.message || `微信读书接口错误（${res.status}）`);
      if (ctx) assertSyncActive(ctx);
      return data?.data && typeof data.data === 'object' ? data.data : data;
    } catch (error) {
      if (error?.name === 'AbortError') {
        if (ctx?.cancelled) throw new Error('SYNC_PAUSED');
        if(ctx&&Date.now()>=ctx.deadline)throw new Error('SYNC_TIME_LIMIT');
        throw new Error('微信读书响应超时，请稍后重试；已经同步的数据会保留');
      }
      throw error;
    } finally {
      clearTimeout(timer);
      if (ctx?.controller === controller) ctx.controller = null;
    }
  }

  function mergeBookFromWeRead(raw, progress) {
    if (!raw) return null;
    const bookId = String(raw.bookId || progress?.bookId || '');
    if(bookId&&hiddenBookIds.has(bookId))return null;
    const title = raw.title || raw.name || '';
    const author = raw.author || raw.authorName || '';
    let existing = bookId ? bookByWeReadId.get(bookId) : null;
    if (!existing && title) {
      const nt = normalizeText(title), na = normalizeAuthor(author);
      existing = bookByIdentity.get(`${nt}|${na}`) || (na?(booksByTitle.get(nt)||[]).find(b=>!normalizeAuthor(b.author)||normalizeAuthor(b.author)===na):null);
    }
    if (!existing) {
      existing = { key:`wr:${bookId || Date.now()}:${Math.random().toString(36).slice(2,7)}`, title:title || '未命名书籍', author, category:raw.category || '未分类', progress:n(progress?.book?.progress), status:n(progress?.book?.progress)>=100 || raw.finishReading===1 ? 'done' : n(progress?.book?.progress)>0 ? 'reading' : 'unread', minutes:0, words:0, color:palette[state.books.length % palette.length], sources:['weread'] };
      state.books.push(existing);
      bookByIdentity.set(bookIdentity(existing.title,existing.author),existing);
      const titleKey=normalizeText(existing.title),rows=booksByTitle.get(titleKey)||[];rows.push(existing);booksByTitle.set(titleKey,rows);
    }
    existing.sources = [...new Set([...(existing.sources || []), 'weread'])];
    existing.weReadBookId = bookId || existing.weReadBookId;
    if(bookId)bookByWeReadId.set(bookId,existing);
    existing.weReadCover = raw.cover || existing.weReadCover;
    existing.cover = existing.cover || raw.cover || '';
    if (!existing.author && author) existing.author = author;
    if ((!existing.category || existing.category === '未分类') && raw.category) existing.category = raw.category;
    if (raw.isbn && !existing.isbn) existing.isbn = raw.isbn;
    const p = n(progress?.book?.progress);
    if (p || progress?.book?.isStartReading) {
      existing.weReadProgress = p;
      if (existing.progressSource!=='manual'&&!existing.manualProgress) existing.progress = Math.max(n(existing.progress), p);
      existing.status = p >= 100 ? 'done' : p > 0 ? 'reading' : existing.status;
    }
    const sec = n(progress?.book?.recordReadingTime);
    if (sec > 0) existing.weReadSeconds = sec;
    const updateTime = progress?.book?.updateTime || raw.readUpdateTime;
    if (updateTime) existing.weReadLastRead = safeDate(updateTime);
    if(progress?.book){const oldRows=Array.isArray(existing.weReadSnapshots)?existing.weReadSnapshots:[],previous=[...oldRows].sort((a,b)=>String(a.date).localeCompare(String(b.date))).at(-1),changed=!!previous&&(sec>n(previous.seconds)||p>n(previous.progress));const snapshot={date:todayKey,progress:p,seconds:sec,updateTime:n(updateTime),activity:changed||previous?.activity===true};const rows=oldRows.filter(x=>x?.date!==todayKey);rows.push(snapshot);existing.weReadSnapshots=rows.sort((a,b)=>String(a.date).localeCompare(String(b.date))).slice(-120)}
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

  function replaceWeReadMonth(year,month,daily){const prefix=`${year}-${pad(month)}`,next={...(state.weRead.daily||{})};Object.keys(next).forEach(date=>{if(date.startsWith(prefix))delete next[date]});Object.assign(next,daily);state.weRead.daily=next;state.sessions=state.sessions.filter(s=>!(s.source==='weread'&&s.aggregate===true&&String(s.date||'').startsWith(prefix)));Object.entries(daily).forEach(([date,seconds])=>{const sec=n(seconds);if(sec>0)state.sessions.push({id:`${WR_SESSION_PREFIX}${date}`,date,bookKey:'',title:'微信读书',minutes:Math.round(sec/60),seconds:sec,words:0,source:'weread',aggregate:true,precision:'daily-total'})})}
  async function syncCurrentYearDaily(ctx=activeSync){const now=new Date(),year=now.getFullYear(),lastMonth=now.getMonth()+1;if(state.weRead.statsSyncYear!==year){state.weRead.statsSyncYear=year;state.weRead.statsMonthCursor=0;state.weRead.statsDone=false}else if(state.weRead.statsDone){state.weRead.statsMonthCursor=Math.max(0,lastMonth-1);state.weRead.statsDone=false}const completed=Math.max(0,Math.min(n(state.weRead.statsMonthCursor),lastMonth));if(completed>=lastMonth){state.weRead.statsDone=true;state.weRead.statsMonthCursor=0;return{year,days:n(state.weRead.statsDays),done:true,month:lastMonth,lastMonth,sessions:[]}}const month=completed+1;assertSyncActive(ctx);setWeReadStatus(`正在同步 ${year} 年 ${month} 月阅读时间（${month}/${lastMonth}）。本次只处理这一个月……`);const baseTime=Math.floor(new Date(year,month-1,15).getTime()/1000),result=await wereadCall('/readdata/detail',{mode:'monthly',baseTime},ctx),daily=parseReadTimesObject(result.dailyReadTimes||result.readTimes);diagnosticStage('merge-month',{year,month,days:Object.keys(daily).length});replaceWeReadMonth(year,month,daily);state.weRead.statsMonthCursor=month;state.weRead.statsDays=Object.keys(state.weRead.daily).length;state.weRead.statsDone=month>=lastMonth;if(state.weRead.statsDone)state.weRead.statsMonthCursor=0;return{year,days:state.weRead.statsDays,done:state.weRead.statsDone,month,lastMonth,sessions:state.sessions.filter(s=>s.source==='weread'&&String(s.date||'').startsWith(`${year}-${pad(month)}`))}}

  async function syncShelfBase(ctx) {
    setWeReadStatus('正在读取微信读书书架……');
    const shelf = await wereadCall('/shelf/sync', {}, ctx);
    const seen = new Set();
    const books = (Array.isArray(shelf.books) ? shelf.books : []).filter(b=>{
      const id=String(b?.bookId||''); if(!id||seen.has(id)||hiddenBookIds.has(id))return false; seen.add(id); return true;
    });
    for(let i=0;i<books.length;i++){
      assertSyncActive(ctx); mergeBookFromWeRead(books[i]);
      if((i+1)%25===0){setWeReadStatus(`正在分批整理书架 ${i+1}/${books.length}……`);await yieldToBrowser()}
    }
    state.weRead.shelfTotal=books.length;
    state.weRead.shelfBooks=books.map(compactShelfBook);
    return books;
  }

  async function syncProgressBatch(books, ctx) {
    const started=books.filter(b=>b.readUpdateTime||b.finishReading===1).sort((a,b)=>n(b.readUpdateTime)-n(a.readUpdateTime));
    state.weRead.progressTotal=started.length;
    if(state.weRead.progressDone)return {done:true,completed:started.length,total:started.length};
    const start=Math.min(n(state.weRead.progressCursor),started.length);
    const batch=started.slice(start,start+PROGRESS_BATCH_SIZE); let completed=0;
    for(const b of batch){
      assertSyncActive(ctx); setWeReadStatus(`正在分批补阅读进度 ${start+completed+1}/${started.length}……`);
      try{const p=await wereadCall('/book/getprogress',{bookId:b.bookId},ctx);mergeBookFromWeRead(b,p)}catch(e){if(/^SYNC_/.test(e.message))throw e;console.warn('WeRead progress skipped',e)}
      completed++; await sleep(20);
    }
    const done=start+completed>=started.length; state.weRead.progressCursor=done?0:start+completed; state.weRead.progressDone=done; await stageSyncSnapshot();
    return {done,completed:start+completed,total:started.length};
  }

  async function syncNotebookPage(ctx){const params={count:20},previous=state.weRead.notebookCursor;if(previous!==''&&previous!==null&&previous!==undefined)params.lastSort=previous;setWeReadStatus(`正在读取微信读书笔记目录${previous!==''?'下一页':'第一页'}。本次只有一个请求……`);const data=await wereadCall('/user/notebooks',params,ctx),rows=(Array.isArray(data.books)?data.books:[]).map(compactNotebook),dedup=new Map((state.weRead.notebooks||[]).map(nb=>[String(nb?.book?.bookId||nb?.bookId||''),nb]));rows.forEach(nb=>{const id=String(nb?.book?.bookId||nb?.bookId||'');if(id)dedup.set(id,nb)});state.weRead.notebooks=[...dedup.values()];state.weRead.notebooksTotal=state.weRead.notebooks.length;const next=rows.at(-1)?.sort,hasNext=Boolean(data.hasMore&&rows.length&&next!==undefined&&next!==null&&next!==''&&String(next)!==String(previous));if(hasNext){state.weRead.notebookCursor=next;state.weRead.syncPhase='notebooks'}else{state.weRead.notebookCursor='';state.weRead.notesCursor=Math.min(n(state.weRead.notesCursor),state.weRead.notebooks.length);state.weRead.syncPhase=state.weRead.notebooks.length?'bookmarks':'complete';state.weRead.notesDone=!state.weRead.notebooks.length}await stageSyncSnapshot();return{done:!hasNext,total:state.weRead.notebooks.length}}

  function currentNotebook(){return (state.weRead.notebooks||[])[Math.min(n(state.weRead.notesCursor),(state.weRead.notebooks||[]).length)]}
  function finishNotebook(){state.weRead.notesCursor=n(state.weRead.notesCursor)+1;const done=state.weRead.notesCursor>=(state.weRead.notebooks||[]).length;state.weRead.notesDone=done;if(done){state.weRead.notesCursor=0;state.weRead.notebooks=[];state.weRead.syncPhase='complete'}else state.weRead.syncPhase='bookmarks';return done}

  async function syncBookmarkStep(ctx){const nb=currentNotebook();if(!nb){state.weRead.notesDone=true;state.weRead.syncPhase='complete';return{done:true}}const rawBook=nb.book||{bookId:nb.bookId},merged=mergeBookFromWeRead(rawBook,{book:{progress:n(nb.readingProgress)}});if(!merged||!rawBook.bookId){finishNotebook();return{done:state.weRead.notesDone}}setWeReadStatus(`正在读取书摘 ${n(state.weRead.notesCursor)+1}/${state.weRead.notebooks.length} 的划线。本次只有一个请求……`);const marks=await wereadCall('/book/bookmarklist',{bookId:rawBook.bookId},ctx),rows=[];(marks.updated||[]).forEach(x=>{if(!x.markText)return;rows.push({id:`wr-mark:${x.bookmarkId||`${rawBook.bookId}:${normalizeText(x.markText).slice(0,40)}`}`,bookKey:merged.key,date:safeDate(x.createTime)||todayKey,time:n(x.createTime)*1000,quote:x.markText,note:'',bookmark:WR_HIGHLIGHT_MARKER,source:'weread',sourceId:x.bookmarkId||''})});await persistHighlightRowsOnly(rows);state.weRead.syncPhase='reviews';await stageSyncSnapshot();return{done:false,count:rows.length}}

  async function syncReviewStep(ctx){const nb=currentNotebook();if(!nb){state.weRead.notesDone=true;state.weRead.syncPhase='complete';return{done:true}}const rawBook=nb.book||{bookId:nb.bookId},merged=mergeBookFromWeRead(rawBook,{book:{progress:n(nb.readingProgress)}});if(!merged||!rawBook.bookId){finishNotebook();return{done:state.weRead.notesDone}}const key=String(rawBook.bookId),synckey=state.weRead.reviewCursors[key]||0;setWeReadStatus(`正在读取书摘 ${n(state.weRead.notesCursor)+1}/${state.weRead.notebooks.length} 的想法${synckey?'下一页':'第一页'}。本次只有一个请求……`);const data=await wereadCall('/review/list/mine',{bookid:rawBook.bookId,synckey,count:20},ctx),rows=[];(data.reviews||[]).forEach(item=>{const r=item.review||item,content=r.content||'',abstract=r.abstract||'';if(!content&&!abstract)return;rows.push({id:`wr-review:${r.reviewId||`${rawBook.bookId}:${normalizeText(content||abstract).slice(0,40)}`}`,bookKey:merged.key,date:safeDate(r.createTime)||todayKey,time:n(r.createTime)*1000,quote:abstract,note:content,bookmark:WR_HIGHLIGHT_MARKER,source:'weread',sourceId:r.reviewId||''})});await persistHighlightRowsOnly(rows);const next=data.synckey,hasNext=Boolean(data.hasMore&&next&&String(next)!==String(synckey));if(hasNext){state.weRead.reviewCursors[key]=next;state.weRead.syncPhase='reviews'}else{delete state.weRead.reviewCursors[key];finishNotebook()}await stageSyncSnapshot();return{done:state.weRead.notesDone,count:rows.length}}

  function inferSyncPhase(){if(state.weRead.syncPhase&&state.weRead.syncPhase!=='complete')return state.weRead.syncPhase;if(!(state.weRead.shelfBooks||[]).length)return'shelf';if(!state.weRead.statsDone)return'stats';if(!state.weRead.progressDone)return'progress';if(!state.weRead.notesDone)return(state.weRead.notebooks||[]).length?'bookmarks':'notebooks';return'complete'}
  async function ensureSyncCapacity(){const raw=localStorage.getItem(STORAGE)||'';if(raw.length>4*1024*1024)throw new Error('STORAGE_LIMIT');if(navigator.storage?.estimate){const estimate=await navigator.storage.estimate(),remaining=n(estimate.quota)-n(estimate.usage);if(estimate.quota&&remaining<8*1024*1024)throw new Error('STORAGE_LIMIT')}}

  async function syncWeRead({mode='quick',manual=false,resetDetails=false}={}) {
    if(window.yuejiHighlightsReady)await window.yuejiHighlightsReady;
    if(window.__yuejiArchiveBusy)return setWeReadStatus('网页正在导入或导出数据，请完成后再同步。');
    try{await ensureSyncCapacity()}catch(error){return setWeReadStatus('浏览器可用储存空间不足，已在请求微信数据之前停止。请先导出备份并清理空间。',true)}
    const ctx=beginSync(mode); if(!ctx)return setWeReadStatus('已有同步任务正在进行，可以先点“暂停同步”。');
    try{
      const phase=inferSyncPhase(),books=state.weRead.shelfBooks||[];let extra='',changedBooks=[],changedSessions=[],includeShelf=false;diagnosticStage('step-start',{phase});
      if(phase==='verify'){setWeReadStatus('正在验证微信读书连接。本次只有一个请求……');await wereadCall('/_list',{},ctx);state.weRead.syncPhase='shelf';extra='连接验证成功。再次点击“继续未完成同步”读取书架。'}
      else if(phase==='shelf'){const shelfBooks=await syncShelfBase(ctx);changedBooks=state.books.filter(b=>b.sources?.includes('weread'));includeShelf=true;state.weRead.syncPhase='stats';state.weRead.progressDone=false;state.weRead.progressCursor=0;state.weRead.notesDone=false;state.weRead.notesCursor=0;state.weRead.notebookCursor='';state.weRead.notebooks=[];state.weRead.reviewCursors={};extra=`已保存 ${shelfBooks.length} 本书架资料。再次点击读取一个月的阅读时间。`}
      else if(phase==='stats'){const stats=await syncCurrentYearDaily(ctx);changedSessions=stats.sessions||[];state.weRead.syncPhase=stats.done?'progress':'stats';extra=stats.done?`${stats.year} 年阅读时间已经补齐。再次点击读取一本书的进度。`:`已保存 ${stats.year} 年 ${stats.month} 月数据。再次点击读取下一个月。`}
      else if(phase==='progress'){const before=n(state.weRead.progressCursor),progress=await syncProgressBatch(books,ctx),raw=books[Math.min(before,Math.max(0,books.length-1))];if(raw?.bookId){const changed=bookByWeReadId.get(String(raw.bookId));if(changed)changedBooks=[changed]}state.weRead.syncPhase=progress.done?'notebooks':'progress';extra=progress.done?`阅读进度 ${progress.completed}/${progress.total} 已完成。再次点击读取笔记目录第一页。`:`已保存阅读进度 ${progress.completed}/${progress.total}。再次点击读取下一本。`}
      else if(phase==='notebooks'){const result=await syncNotebookPage(ctx);extra=result.done?`笔记目录读取完成，共 ${result.total} 本。再次点击读取第一本书的划线。`:`已保存 ${result.total} 本笔记目录。再次点击读取下一页。`}
      else if(phase==='bookmarks'){const result=await syncBookmarkStep(ctx);extra=result.done?'书摘同步已经完成。':`本书划线已保存 ${result.count||0} 条。再次点击读取这本书的想法。`}
      else if(phase==='reviews'){const result=await syncReviewStep(ctx);extra=result.done?'全部书摘已经同步完成。':`本页想法已保存 ${result.count||0} 条。再次点击继续当前书或下一本书。`}
      else{state.weRead.syncPhase='complete';state.weRead.syncState='complete';extra='微信读书数据已经全部同步完成。';}
      state.weRead.lastSync=Date.now();state.weRead.autoRetryBlocked=false;state.weRead.syncState=state.weRead.syncPhase==='complete'?'complete':'paused';
      state.weRead.skillVersion=SKILL_VERSION;
      state.source=state.books.some(b=>b.sources?.includes('moon'))?'多源阅读档案':'微信读书';await commitSyncCheckpoint({books:changedBooks,sessions:changedSessions,includeShelf});
      if(manual)await window.yuejiRequestPersistentStorage?.();updateSourcePill();updateWeReadStatus(extra);toast('本次同步步骤已保存');
    }catch(e){
      const msg=String(e?.message||e); if(!/^SYNC_/.test(msg))console.error(e);
      state.weRead.syncState=/^SYNC_/.test(msg)?'paused':'error';
      if(msg==='SYNC_PAUSED')setWeReadStatus('同步已暂停。已完成的数据已经保存，可以稍后继续。');
      else if(msg==='SYNC_TIME_LIMIT')setWeReadStatus('本次同步已运行 60 秒并自动暂停。已完成的数据已经保存，请稍后点“继续同步”。');
      else if(msg==='SYNC_REQUEST_LIMIT')setWeReadStatus('本批已达到安全读取上限并自动暂停。已完成的数据已经保存，请稍后点“继续同步”。');
      else if(msg==='SYNC_BATCH_LIMIT')setWeReadStatus('这本书的书摘较多，本批已安全暂停并记住位置。请再次点“继续同步”。');
      else if(msg==='STORAGE_LIMIT')setWeReadStatus('浏览器本地储存空间不足，已停止同步。此前成功保存的数据仍然保留；请先导出备份，之后再考虑迁移到更大容量的储存。',true);
      else{const cors=/failed to fetch|networkerror|load failed/i.test(msg);state.weRead.autoRetryBlocked=true;setWeReadStatus(cors?'连接失败：微信读书中转服务没有响应。系统不会自动反复重试，已有数据也不会删除。':`同步未完成：${msg}。系统不会自动反复重试，已完成的数据会保留。`,true);if(manual)toast('微信读书同步未完成')}
      try{await persistSyncIncrement()}catch(error){console.warn('同步错误状态未能写入数据库',error)}
      updateSourcePill();updateWeReadProgressPanel();
    }finally{try{localStorage.removeItem(SYNC_GUARD_KEY)}catch{}if(activeSync===ctx)activeSync=null;window.__yuejiWeReadSyncing=false;syncButtonState(false)}
  }

  function renderAllSafe(){
    try{renderToday()}catch{} try{renderCalendar()}catch{} try{renderBookOptions()}catch{} if(page==='notes')try{renderNotes()}catch{}
    try{if(page==='analytics')renderAnalytics()}catch{} try{if(page==='monthly'){renderMonthly();renderYearWall()}}catch{}
    if(page==='notes')patchNoteSources();
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
    const originalSwitchPage=switchPage; switchPage=function(p){originalSwitchPage(p);if(p==='analytics'&&!document.getElementById('readingEvolutionCard')?.dataset.greenTimeline)setTimeout(renderEvolution,0);if(p==='notes')setTimeout(patchNoteSources,0)};
    document.getElementById('noteSearch')?.addEventListener('input',()=>setTimeout(patchNoteSources,0)); document.getElementById('noteBookFilter')?.addEventListener('change',()=>setTimeout(patchNoteSources,0));
    document.getElementById('mrproFile')?.addEventListener('change',()=>setTimeout(()=>{ensureStateShape();updateSourcePill();if(page==='analytics')renderEvolution()},1500));
    const notes=document.getElementById('notesList'); if(notes)new MutationObserver(()=>patchNoteSources()).observe(notes,{childList:true,subtree:true});
  }

  function autoSyncIfNeeded(){const key=localStorage.getItem(EXT_KEY);if(!key||state.weRead.autoRetryBlocked||document.visibilityState!=='visible'||!navigator.onLine)return;if(Date.now()-n(state.weRead.lastSync)<AUTO_SYNC_MS)return;setWeReadStatus('微信读书数据可以更新。为避免手机自动卡顿，请在方便时点击“同步基础数据”。')}

  window.__yuejiWeReadDiagnostics={inferSyncPhase,syncWeRead,stopActiveSync,replaceWeReadMonth,ensureStateShape,stageSyncSnapshot,persistSyncIncrement,recoverSyncSnapshot,mergeBookFromWeRead,deleteSyncBook};
  async function init(){ensureStateShape();let recovered=await recoverSyncSnapshot();if(!recovered&&(state.books.some(b=>b.sources?.includes('weread'))||state.sessions.some(s=>s.source==='weread'))){diagnosticStage('legacy-migration-start');try{await replaceSyncArchive(state);diagnosticStage('legacy-migration-complete');recovered=true}catch(error){console.warn('旧微信数据迁移失败，原数据仍保留',error)}}injectStyles();injectSettings();injectEvolution();installHooks();updateSourcePill();patchNoteSources();if(recovered){renderAllSafe();updateWeReadStatus('微信读书数据已从独立数据库恢复。')}const schedule=()=>autoSyncIfNeeded();if(globalThis.requestIdleCallback)requestIdleCallback(schedule,{timeout:15000});else setTimeout(schedule,10000)}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
