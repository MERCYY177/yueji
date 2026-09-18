import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { collapseDuplicateNotes } from '../yueji-notes-chapters.js';

test('duplicate review without chapter metadata inherits known chapter from matching quote', () => {
  const rows = collapseDuplicateNotes([
    {
      id: 'review',
      quote: '同一句原文',
      thought: '我的想法',
      time: 20,
    },
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

test('chapter runtime survives nav rebuilds and data refreshes', async () => {
  const source = await readFile(new URL('../yueji-notes-chapters.js', import.meta.url), 'utf8');
  assert.match(source, /document\.addEventListener\(['"]click['"]/);
  assert.match(source, /yueji:data-changed/);
  assert.match(source, /window\.yuejiRenderChapterNotes\s*=\s*renderChapterNotes/);
  assert.match(source, /yueji-notes-chapters\.css\?v=20260918-r2/);
});
