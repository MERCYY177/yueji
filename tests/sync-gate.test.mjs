import test from 'node:test';
import assert from 'node:assert/strict';
import { isOfficialSummaryStart, waitForPrimarySyncIdle } from '../yueji-sync-gate.js';

test('only the annual official summary start request is gated', () => {
  const request = (mode) => ({
    method: 'POST',
    body: JSON.stringify({ api_name: '/readdata/detail', mode }),
  });
  assert.equal(
    isOfficialSummaryStart('/.netlify/functions/weread-gateway', request('annually')),
    true,
  );
  assert.equal(
    isOfficialSummaryStart('/.netlify/functions/weread-gateway', request('monthly')),
    false,
  );
  assert.equal(
    isOfficialSummaryStart('/.netlify/functions/weread-gateway', {
      method: 'POST',
      body: JSON.stringify({ api_name: '/shelf/sync' }),
    }),
    false,
  );
});

test('official summary waits until primary sync is fully idle', async () => {
  let busyChecks = 0;
  let sleeps = 0;
  await waitForPrimarySyncIdle({
    isBusy: () => ++busyChecks < 4,
    sleep: async () => {
      sleeps++;
    },
    timeoutMs: 1000,
    pollMs: 1,
  });
  assert.equal(busyChecks, 4);
  assert.equal(sleeps, 3);
});
