(() => {
  'use strict';

  const APPEARANCE_KEY = 'yueji-appearance-settings-v1';
  const PROFILE_KEY = 'yueji-profile-v1';
  const SUMMARY_KEY = 'yueji-reading-summary-v1';
  const META_KEY = 'yuejiUnified';
  const SYSTEM_FONT =
    'system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif';

  function readJson(key) {
    try {
      return JSON.parse(localStorage.getItem(key) || 'null');
    } catch {
      return null;
    }
  }

  function writeJson(key, value) {
    try {
      if (value && typeof value === 'object') localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  }

  function refreshVisibleSettings(meta) {
    const profile = meta?.profile || {};
    const appearance = meta?.appearance || {};
    const nickname = document.getElementById('yuejiNickname');
    const signature = document.getElementById('yuejiSignature');
    const font = document.getElementById('yuejiPageFont');
    const fontStatus = document.getElementById('yuejiFontStatus');
    if (nickname) nickname.value = profile.nickname || '';
    if (signature) signature.value = profile.signature || '';
    if (font) font.value = appearance.pageFont || 'system';
    if (appearance.pageFont === 'huiwen')
      document.documentElement.style.setProperty('--yueji-page-font', 'YuejiHuiwen,serif');
    else if (appearance.pageFont !== 'custom')
      document.documentElement.style.setProperty('--yueji-page-font', SYSTEM_FONT);
    if (appearance.pageFont === 'custom' && fontStatus)
      fontStatus.textContent = '备份已恢复自定义字体设置，但字体文件不在 JSON 中；如当前设备没有原字体，请重新上传。';
  }

  if (typeof buildPortableBackup === 'function') {
    const originalBuildPortableBackup = buildPortableBackup;
    buildPortableBackup = async function () {
      const payload = await originalBuildPortableBackup();
      return {
        ...payload,
        [META_KEY]: {
          version: 1,
          appearance: readJson(APPEARANCE_KEY),
          profile: readJson(PROFILE_KEY),
          officialReadingSummary: readJson(SUMMARY_KEY),
          customFontIncluded: false,
        },
      };
    };
  }

  if (typeof replaceArchiveData === 'function') {
    const originalReplaceArchiveData = replaceArchiveData;
    replaceArchiveData = async function (value, demoMode = false) {
      const source = value && typeof value === 'object' ? value : {};
      const meta = source[META_KEY];
      const portable = { ...source };
      delete portable[META_KEY];
      if (meta && typeof meta === 'object') {
        writeJson(APPEARANCE_KEY, meta.appearance);
        writeJson(PROFILE_KEY, meta.profile);
        writeJson(SUMMARY_KEY, meta.officialReadingSummary);
      }
      const result = await originalReplaceArchiveData(portable, demoMode);
      if (meta && typeof meta === 'object') refreshVisibleSettings(meta);
      if (meta?.officialReadingSummary)
        window.dispatchEvent(
          new CustomEvent('yueji:reading-summary', { detail: meta.officialReadingSummary }),
        );
      window.dispatchEvent(new CustomEvent('yueji:unified-settings-restored'));
      return result;
    };
  }
})();
