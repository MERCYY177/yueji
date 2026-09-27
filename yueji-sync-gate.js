export function isOfficialSummaryStart(input, init = {}) {
  try {
    const url = typeof input === 'string' ? input : String(input?.url || '');
    if (!url.includes('/.netlify/functions/weread-gateway')) return false;
    if (String(init?.method || 'GET').toUpperCase() !== 'POST') return false;
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
    return body?.api_name === '/readdata/detail' && body?.mode === 'annually';
  } catch {
    return false;
  }
}

export async function waitForPrimarySyncIdle({
  isBusy = () =>
    Boolean(
      globalThis.window?.__yuejiWeReadSyncing ||
        globalThis.document?.getElementById?.('wereadSyncBtn')?.disabled,
    ),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  timeoutMs = 15 * 60 * 1000,
  pollMs = 400,
} = {}) {
  const started = Date.now();
  while (isBusy()) {
    if (Date.now() - started >= timeoutMs)
      throw new Error('等待主微信读书同步结束超时；官方汇总本次未继续读取');
    await sleep(pollMs);
  }
}

function install() {
  if (typeof window === 'undefined' || window.__yuejiSyncGateInstalled) return;
  const nativeFetch = window.fetch?.bind(window);
  if (typeof nativeFetch !== 'function') return;
  window.__yuejiSyncGateInstalled = true;
  window.fetch = async (input, init) => {
    if (isOfficialSummaryStart(input, init)) await waitForPrimarySyncIdle();
    return nativeFetch(input, init);
  };
}

install();
