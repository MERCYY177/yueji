export function chapterNotesRenderEntry() {
  const renderer = window.yuejiRenderChapterNotes;
  if (typeof renderer === 'function') return renderer({ reset: true });
}

function installChapterNotesEntry() {
  try {
    if (typeof renderNotes !== 'function') return false;
    renderNotes = chapterNotesRenderEntry;
    window.__yuejiNotesRendererOwner = 'chapter';
    return true;
  } catch (error) {
    window.Yueji?.errors?.capture?.(error, {
      area: 'notes',
      stage: 'single-renderer-entry',
      recoverable: true,
    });
    return false;
  }
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (!installChapterNotesEntry() && document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', installChapterNotesEntry, { once: true });
}
