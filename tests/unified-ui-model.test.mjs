import test from 'node:test';
import assert from 'node:assert/strict';
import { NAV_ITEMS, formatDuration, formatMetric, statsView } from '../yueji-unified-ui-model.js';

test('unified Yueji exposes exactly four primary tabs', () => {
  assert.deepEqual(NAV_ITEMS.map((x) => x.label), ['首页', '书架', '笔记', '统计']);
  assert.equal(NAV_ITEMS.length, 4);
});

test('missing metrics render as unavailable while a real zero remains zero', () => {
  assert.equal(formatMetric(null), '暂无数据');
  assert.equal(formatMetric(undefined), '暂无数据');
  assert.equal(formatMetric(0), '0');
});

test('duration formatting does not turn missing into zero minutes', () => {
  assert.equal(formatDuration(null), '暂无数据');
  assert.equal(formatDuration(0), '0 分钟');
  assert.equal(formatDuration(7200), '2 小时');
});

test('stats views map to monthly annually and overall semantics', () => {
  assert.equal(statsView('month').mode, 'monthly');
  assert.equal(statsView('year').mode, 'annually');
  assert.equal(statsView('all').mode, 'overall');
});
