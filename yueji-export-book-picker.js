function bookOptions() {
  const source = document.getElementById('noteBookFilter');
  return [...(source?.options || [])]
    .filter((option) => option.value)
    .map((option) => ({ value: String(option.value), label: String(option.textContent || '').trim() }));
}

function waitForNotesMutation(timeoutMs = 5000) {
  const list = document.getElementById('notesList');
  if (!list) return Promise.reject(new Error('笔记列表不存在'));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      observer.disconnect();
      reject(new Error('继续加载笔记超时'));
    }, timeoutMs);
    const observer = new MutationObserver(() => {
      clearTimeout(timer);
      observer.disconnect();
      resolve();
    });
    observer.observe(list, { childList: true, subtree: true });
  });
}

async function loadAllSelectedBookNotes(status) {
  for (let page = 0; page < 100; page++) {
    const more = document.querySelector('#notesList .chapter-load-more');
    if (!more) return;
    if (status) status.textContent = `正在继续加载这本书的笔记（第 ${page + 2} 批）……`;
    const changed = waitForNotesMutation();
    more.click();
    await changed;
  }
  if (document.querySelector('#notesList .chapter-load-more'))
    throw new Error('这本书的笔记过多，已达到单次导出安全上限');
}

function installPicker() {
  const section = document.getElementById('unifiedExportSettings');
  const moduleSelect = document.getElementById('yuejiExportModule');
  const exportButton = document.getElementById('yuejiExportPng');
  if (!section || !moduleSelect || !exportButton) return false;
  if (document.getElementById('yuejiExportBook')) return true;

  const field = document.createElement('label');
  field.className = 'field';
  field.id = 'yuejiExportBookField';
  field.hidden = true;
  field.innerHTML = '<span>选择书籍</span><select id="yuejiExportBook"></select>';
  moduleSelect.closest('.field')?.insertAdjacentElement('afterend', field);
  const picker = field.querySelector('select');

  const refreshOptions = () => {
    const previous = picker.value;
    const rows = bookOptions();
    picker.innerHTML = rows.length
      ? rows
          .map(
            (row) =>
              `<option value="${row.value.replace(/"/g, '&quot;')}">${row.label.replace(/[&<>]/g, '')}</option>`,
          )
          .join('')
      : '<option value="">暂无书籍</option>';
    const currentFilter = document.getElementById('noteBookFilter')?.value || '';
    if (rows.some((row) => row.value === previous)) picker.value = previous;
    else if (rows.some((row) => row.value === currentFilter)) picker.value = currentFilter;
  };
  const updateVisibility = () => {
    field.hidden = moduleSelect.value !== 'book-notes';
    if (!field.hidden) refreshOptions();
  };

  moduleSelect.addEventListener('change', updateVisibility);
  picker.addEventListener('focus', refreshOptions);
  updateVisibility();

  exportButton.addEventListener(
    'click',
    async (event) => {
      if (moduleSelect.value !== 'book-notes') return;
      const selected = picker.value;
      const status = document.getElementById('yuejiExportStatus');
      if (!selected) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (status) status.textContent = '请先选择要导出的书籍。';
        return;
      }
      if (exportButton.dataset.noteExportPrepared === selected) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      exportButton.disabled = true;
      if (status) status.textContent = '正在准备这本书的完整章节笔记……';
      const filter = document.getElementById('noteBookFilter');
      const notesPage = document.querySelector('.page[data-page="notes"]');
      const wasActive = notesPage?.classList.contains('active');
      const previousFilter = filter?.value || '';
      try {
        if (!filter || !notesPage || typeof window.yuejiRenderChapterNotes !== 'function')
          throw new Error('笔记模块尚未准备好');
        filter.value = selected;
        notesPage.classList.add('active');
        await window.yuejiRenderChapterNotes({ reset: true });
        await loadAllSelectedBookNotes(status);
        exportButton.dataset.noteExportPrepared = selected;
        exportButton.disabled = false;
        exportButton.click();
      } catch (error) {
        exportButton.disabled = false;
        if (status) status.textContent = `准备笔记失败：${error?.message || error}`;
      } finally {
        delete exportButton.dataset.noteExportPrepared;
        if (!wasActive) notesPage?.classList.remove('active');
        if (filter && previousFilter !== selected) filter.value = previousFilter;
      }
    },
    true,
  );
  return true;
}

function boot() {
  if (installPicker()) return;
  const observer = new MutationObserver(() => {
    if (installPicker()) observer.disconnect();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  setTimeout(() => observer.disconnect(), 15000);
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (document.readyState === 'complete') setTimeout(boot, 180);
  else window.addEventListener('load', () => setTimeout(boot, 180), { once: true });
}
