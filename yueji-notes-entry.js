export function chapterNotesRenderEntry() {
  const renderer = window.yuejiRenderChapterNotes;
  if (typeof renderer === 'function') return renderer({ reset: true });
}

function installChapterNotesEntry() {
  try {
    renderNotes = chapterNotesRenderEntry;
    window.__yuejiNotesRendererOwner = 'chapter';
  } catch (error) {
    window.Yueji?.errors?.capture?.(error, {
      area: 'notes',
      stage: 'single-renderer-entry',
      recoverable: true,
    });
  }
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', installChapterNotesEntry, { once: true });
  else installChapterNotesEntry();
}
