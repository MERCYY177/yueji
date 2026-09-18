import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

const moduleUrl = new URL('../yueji-notes-chapters.js', import.meta.url);

test('chapter notes module exists and groups notes by chapter in reading order', async () => {
  assert.equal(existsSync(moduleUrl), true, 'chapter notes module should exist');
  const { groupNotesByChapter } = await import(moduleUrl.href);
  const groups = groupNotesByChapter([
    { id: 'late', chapterIdx: 4, range: '30-35', quote: 'B' },
    { id: 'first', chapterIdx: 3, range: '12-18', quote: 'A' },
    { id: 'early', chapterIdx: 4, range: '10-15', quote: 'C' },
    { id: 'unknown', quote: 'D', time: 1 },
  ]);
  assert.deepEqual(
    groups.map((group) => [group.label, group.items.map((item) => item.id)]),
    [
      ['第 4 章', ['first']],
      ['第 5 章', ['early', 'late']],
      ['未标章节', ['unknown']],
    ],
  );
});

test('chapter label can be inferred from existing location text for old notes', async () => {
  assert.equal(existsSync(moduleUrl), true, 'chapter notes module should exist');
  const { chapterMeta } = await import(moduleUrl.href);
  assert.deepEqual(chapterMeta({ label: '《罪与罚》第三章' }), {
    key: 'label:3',
    label: '第 3 章',
    order: 3,
  });
});

test('chapter metadata enrichment keeps API order and range fields', async () => {
  assert.equal(existsSync(moduleUrl), true, 'chapter notes module should exist');
  const { chapterPatchFromBookmark } = await import(moduleUrl.href);
  assert.deepEqual(
    chapterPatchFromBookmark({ chapterUid: 9001, chapterIdx: 3, range: '128-146' }),
    { chapterUid: '9001', chapterIdx: 3, range: '128-146' },
  );
});

test('duplicate highlight and review collapse into one quote card with comment', async () => {
  assert.equal(existsSync(moduleUrl), true, 'chapter notes module should exist');
  const { collapseDuplicateNotes } = await import(moduleUrl.href);
  const merged = collapseDuplicateNotes([
    { id: 'mark', quote: '她怎么，在等待出现奇迹吗？', thought: '', chapterIdx: 3 },
    { id: 'review', quote: '她怎么，在等待出现奇迹吗？', thought: '怎么写的我都要流泪了。', chapterIdx: 3 },
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].thought, '怎么写的我都要流泪了。');
});

test('bookmark rows inherit chapter title and order from the bookmark-list chapters table', async () => {
  const { mergeBookmarksWithChapters } = await import(moduleUrl.href);
  assert.deepEqual(
    mergeBookmarksWithChapters(
      [{ bookmarkId: 'b1', chapterUid: 9001, range: '128-146' }],
      [{ chapterUid: 9001, chapterIdx: 3, title: '第四章' }],
    ),
    [
      {
        bookmarkId: 'b1',
        chapterUid: 9001,
        chapterIdx: 3,
        chapterTitle: '第四章',
        range: '128-146',
      },
    ],
  );
});

test('repeated chapter titles stay separate and follow API chapter index order', async () => {
  const { groupNotesByChapter } = await import(moduleUrl.href);
  const groups = groupNotesByChapter([
    { id: 'part2', chapterIdx: 20, chapterTitle: '第一章', quote: 'later' },
    { id: 'part1', chapterIdx: 8, chapterTitle: '第一章', quote: 'earlier' },
  ]);
  assert.deepEqual(
    groups.map((group) => group.items.map((item) => item.id)),
    [['part1'], ['part2']],
  );
});
