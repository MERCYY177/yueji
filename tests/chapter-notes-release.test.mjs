import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  collapseDuplicateNotes,
  captureBookmarkChapterMetadata,
  captureReviewChapterMetadata,
  decorateWeReadRows,
} from '../yueji-notes-chapters.js';

test('duplicate review without chapter metadata inherits known chapter from matching quote', () => {
  const rows = collapseDuplicateNotes([
    { id: 'review', quote: '同一句原文', thought: '我的想法', time: 20 },
    {
      id: 'mark',
      quote: '同一句原文',
      chapterUid: '9001',
      chapterIdx: 3,
      chapterTitle: '第四章',
      range: '128-146',
      time: 10,
    },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].thought, '我的想法');
  assert.equal(rows[0].chapterUid, '9001');
  assert.equal(rows[0].chapterIdx, 3);
  assert.equal(rows[0].chapterTitle, '第四章');
});

test('normal sync responses decorate rows with chapter metadata without extra gateway reads', async () => {
  captureBookmarkChapterMetadata({
    data: {
      updated: [{ bookmarkId: 'b1', chapterUid: 9001, markText: '原文' }],
      chapters: [{ chapterUid: 9001, chapterIdx: 3, title: '第四章' }],
    },
  });
  captureReviewChapterMetadata({
    data: {
      reviews: [
        {
          review: {
            reviewId: 'r1',
            chapterUid: 9001,
            chapterIdx: 3,
            chapterTitle: '第四章',
            range: '128-146',
          },
        },
      ],
    },
  });
  const rows = decorateWeReadRows([
    { id: 'wr-mark:b1', source: 'weread', sourceId: 'b1', quote: '原文' },
    { id: 'wr-review:r1', source: 'weread', sourceId: 'r1', quote: '原文', note: '想法' },
  ]);
  assert.equal(rows[0].chapterTitle, '第四章');
  assert.equal(rows[0].chapterIdx, 3);
  assert.equal(rows[1].chapterUid, '9001');
  assert.equal(rows[1].range, '128-146');

  const source = await readFile(new URL('../yueji-notes-chapters.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /async function enrichBookChapters/);
  assert.doesNotMatch(source, /fetch\(GATEWAY/);
  assert.match(source, /window\.fetch\s*=\s*async/);
  assert.match(source, /window\.yuejiPutHighlights\s*=\s*wrapped/);
});

test('chapter runtime survives nav rebuilds and avoids localStorage book metadata', async () => {
  const source = await readFile(new URL('../yueji-notes-chapters.js', import.meta.url), 'utf8');
  assert.match(source, /document\.addEventListener\(['"]click['"]/);
  assert.match(source, /yueji:data-changed/);
  assert.match(source, /window\.yuejiRenderChapterNotes\s*=\s*renderChapterNotes/);
  assert.match(source, /yueji-notes-chapters\.css\?v=20260918-r2/);
  assert.match(source, /noteBookFilter/);
  assert.doesNotMatch(source, /books:\s*Array\.isArray\(saved\.books\)/);
});
