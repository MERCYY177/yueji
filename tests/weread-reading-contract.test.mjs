import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('WeRead gateway preserves official reading summary fields', async () => {
  const source = await readFile(new URL('../netlify/functions/weread-gateway.mjs', import.meta.url), 'utf8');
  const readdata = source.match(/apiName === '\/readdata\/detail'[\s\S]*?else if \(apiName === '\/book\/getprogress'/)?.[0] || '';
  assert.match(readdata, /totalReadTime/);
  assert.match(readdata, /readDays/);
  assert.match(readdata, /dailyReadTimes/);
  assert.match(readdata, /readTimes/);
});
