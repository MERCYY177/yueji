(() => {
  'use strict';

  const GUIDE_KEY = 'yueji-onboarding-seen-v4';
  const LEGACY_DEMO_KEYS = new Set(['crime', 'art', 'deadpool', 'stranger']);

  function injectStyles() {
    if (document.getElementById('yuejiOnboardingStyles')) return;
    const s = document.createElement('style');
    s.id = 'yuejiOnboardingStyles';
    s.textContent = `
      #todayMark.yueji-read-mark{color:var(--accent)!important;font-weight:900!important;font-family:Arial,"PingFang SC",sans-serif!important;font-size:2.65rem!important;line-height:1!important}
      .yueji-guide{position:fixed;inset:0;z-index:200;display:none;align-items:center;justify-content:center;padding:18px;background:rgba(0,0,0,.48);backdrop-filter:blur(7px)}
      .yueji-guide.show{display:flex}
      .yueji-guide-panel{width:min(450px,100%);background:var(--card);border:1px solid var(--line);border-radius:24px;padding:22px;box-shadow:0 28px 90px rgba(0,0,0,.34)}
      .yueji-guide-panel h3{margin:0 0 7px;font-size:1.4rem}.yueji-guide-panel>p{margin:0 0 17px;color:var(--muted);font-size:.82rem;line-height:1.65}
      .yueji-guide-steps{display:grid;gap:10px}.yueji-guide-step{display:grid;grid-template-columns:30px 1fr;gap:11px;padding:12px;border:1px solid var(--line);border-radius:16px;background:var(--soft)}
      .yueji-guide-step>i{width:30px;height:30px;border-radius:50%;display:grid;place-items:center;background:rgba(var(--accent-rgb),.15);color:var(--accent);font-style:normal;font-weight:900}.yueji-guide-step b{display:block;font-size:.9rem;margin-bottom:3px}.yueji-guide-step span{display:block;color:var(--muted);font-size:.76rem;line-height:1.55}
      .yueji-guide-actions{display:flex;gap:9px;margin-top:18px}.yueji-guide-actions button{flex:1}.yueji-guide-replay{width:100%}
      @media(max-width:520px){.yueji-guide{align-items:center;padding:12px}.yueji-guide-panel{max-height:calc(100dvh - 24px);overflow-y:auto;border-radius:24px}}
    `;
    document.head.appendChild(s);
  }

  function isLegacyDemo() {
    if (typeof state === 'undefined' || !state || !Array.isArray(state.books)) return false;
    if (state.source === '演示数据') return true;
    if (state.importedAt || state.weRead?.lastSync) return false;
    return (
      state.books.length === 4 &&
      state.books.every((b) => LEGACY_DEMO_KEYS.has(String(b.key || '')))
    );
  }

  function purgeLegacyDemo() {
    try {
      localStorage.removeItem('yueji-allow-demo-v1');
    } catch {}
    document.getElementById('loadDemo')?.remove();
    if (!isLegacyDemo()) return false;
    const y = new Date().getFullYear(),
      accent = state.accent || '#5f8f7b';
    state = {
      source: '网页记录',
      accent,
      books: [],
      sessions: [],
      journals: {},
      highlights: [],
      importedAt: '',
      weRead: { lastSync: 0, daily: {} },
      bookTrash: [],
      hiddenWeReadBookIds: [],
    };
    save();
    renderAll();
    if (typeof renderHomeDashboard === 'function') renderHomeDashboard();
    if (typeof renderLibrary === 'function') renderLibrary();
    return true;
  }

  function syncReadMark() {
    const el = document.getElementById('todayMark');
    if (!el) return;
    // This function is also a MutationObserver callback. Only write values that
    // actually differ, otherwise replacing the text node would trigger the
    // observer again forever and starve clicks on an otherwise empty archive.
    if (el.textContent !== '📖') el.textContent = '📖';
    if (el.classList.contains('yueji-read-mark')) el.classList.remove('yueji-read-mark');
    if (el.style.getPropertyValue('color')) el.style.removeProperty('color');
    if (el.style.getPropertyValue('font-weight')) el.style.removeProperty('font-weight');
  }

  function watchReadMark() {
    const el = document.getElementById('todayMark');
    if (!el) return;
    syncReadMark();
    new MutationObserver(syncReadMark).observe(el, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  }

  function installGuide() {
    if (document.getElementById('yuejiGuide')) return;
    const d = document.createElement('div');
    d.id = 'yuejiGuide';
    d.className = 'yueji-guide';
    d.innerHTML = `<div class="yueji-guide-panel">
      <h3>阅迹怎么用</h3>
      <p>第一次使用只需要做一件事：把自己的阅读数据导进来。没有导入任何东西时，阅迹不会放任何演示书。</p>
      <div class="yueji-guide-steps">
        <div class="yueji-guide-step"><i>1</i><div><b>导入数据</b><span>设置里连接微信读书 Skill Key，或导入静读天下 <code>.mrstd / .mrpro</code> 备份。</span></div></div>
        <div class="yueji-guide-step"><i>2</i><div><b>日历与书库</b><span>日历看哪天读过；书库看读过什么、当前进度，也可以手动更换封面。</span></div></div>
        <div class="yueji-guide-step"><i>3</i><div><b>笔记与统计</b><span>书摘和感想会按书整理；统计里查看总览、月报和年报。</span></div></div>
      </div>
      <div class="yueji-guide-actions"><button class="soft-btn" data-guide-close>知道了</button><button class="primary-btn" data-guide-settings>去导入数据</button></div>
    </div>`;
    document.body.appendChild(d);
    const close = () => {
      d.classList.remove('show');
      localStorage.setItem(GUIDE_KEY, '1');
    };
    d.addEventListener('click', (e) => {
      if (e.target === d || e.target.closest('[data-guide-close]')) close();
      if (e.target.closest('[data-guide-settings]')) {
        close();
        document.getElementById('settingsBtn')?.click();
      }
    });

    const settings = document.getElementById('settingsSheet');
    if (settings && !document.getElementById('replayOnboarding')) {
      const sec = document.createElement('div');
      sec.className = 'settings-section';
      sec.innerHTML =
        '<h4>使用帮助</h4><button class="soft-btn yueji-guide-replay" id="replayOnboarding">查看新手教程</button>';
      settings.appendChild(sec);
      sec.querySelector('button').onclick = () => {
        try {
          closeSheets();
        } catch {}
        d.classList.add('show');
      };
    }
    if (localStorage.getItem(GUIDE_KEY) !== '1') setTimeout(() => d.classList.add('show'), 120);
  }

  function deleteYuejiDatabase(name) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = resolve;
      request.onerror = () => reject(request.error || new Error('DELETE_FAILED'));
      request.onblocked = () => reject(new Error('DELETE_BLOCKED'));
    });
  }

  function installClearAll() {
    const settings = document.getElementById('settingsSheet');
    if (!settings || document.getElementById('clearAllYuejiData')) return;
    const section = document.createElement('div');
    section.className = 'settings-section danger-zone';
    section.innerHTML =
      '<h4>危险操作</h4><b>清除阅迹全部数据</b><p class="section-sub">删除当前设备上的书库、阅读记录、书摘、感悟、自定义封面、回收记录、微信同步数据和 Skill Key，将阅迹恢复到首次使用状态。</p><button class="danger-btn" id="clearAllYuejiData">清除全部数据</button>';
    settings.appendChild(section);
    const dialog = document.createElement('div');
    dialog.className = 'feature-dialog';
    dialog.id = 'clearAllDialog';
    dialog.innerHTML = `<div class="feature-panel" style="max-width:560px"><div class="feature-panel-head"><b>确认清除全部数据</b></div><div class="delete-options"><p>即将删除当前设备上的：</p><p>• 全部书籍<br>• 微信读书与静读天下阅读记录<br>• 每日手记、摘录与感悟<br>• 自定义封面<br>• 删除回收记录<br>• 微信读书同步缓存和同步进度<br>• Skill Key 与连接状态</p><b>删除后无法直接恢复。</b><label class="field"><span>输入“清除”后确认</span><input id="clearAllConfirmText" autocomplete="off"></label><div class="settings-actions"><button class="soft-btn" id="clearAllBackup">先导出备份</button><button class="soft-btn" id="clearAllCancel">取消</button><button class="danger-btn" id="clearAllConfirm" disabled>确认清除</button></div><div id="clearAllStatus" class="import-status"></div></div></div>`;
    document.body.appendChild(dialog);
    const input = document.getElementById('clearAllConfirmText');
    const confirm = document.getElementById('clearAllConfirm');
    section.querySelector('button').onclick = () => dialog.classList.add('show');
    document.getElementById('clearAllCancel').onclick = () => dialog.classList.remove('show');
    document.getElementById('clearAllBackup').onclick = () =>
      document.getElementById('exportBackup')?.click();
    input.oninput = () => (confirm.disabled = input.value.trim() !== '清除');
    confirm.onclick = async () => {
      confirm.disabled = true;
      window.yuejiStopWeReadSync?.();
      try {
        await Promise.all(
          ['yueji-highlights-v1', 'yueji-covers-v1', 'yueji-weread-sync-v1'].map(
            deleteYuejiDatabase,
          ),
        );
        Object.keys(localStorage)
          .filter((key) => key.startsWith('yueji-'))
          .forEach((key) => localStorage.removeItem(key));
        Object.keys(sessionStorage)
          .filter((key) => key.startsWith('yueji-'))
          .forEach((key) => sessionStorage.removeItem(key));
        location.reload();
      } catch (error) {
        document.getElementById('clearAllStatus').textContent =
          String(error?.message) === 'DELETE_BLOCKED'
            ? '数据暂时无法清除，请关闭其他阅迹页面后重试。'
            : '数据清除失败，当前数据没有被标记为成功清除。';
        confirm.disabled = false;
      }
    };
  }

  injectStyles();
  purgeLegacyDemo();
  watchReadMark();
  installGuide();
  installClearAll();
})();
