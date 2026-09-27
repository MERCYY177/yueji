(() => {
  'use strict';

  const APPEARANCE_KEY = 'yueji-appearance-settings-v1';
  const PROFILE_KEY = 'yueji-profile-v1';
  const SUMMARY_KEY = 'yueji-reading-summary-v1';
  const META_KEY = 'yuejiUnified';

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
      if (meta?.officialReadingSummary)
        window.dispatchEvent(
          new CustomEvent('yueji:reading-summary', { detail: meta.officialReadingSummary }),
        );
      window.dispatchEvent(new CustomEvent('yueji:unified-settings-restored'));
      return result;
    };
  }
})();
