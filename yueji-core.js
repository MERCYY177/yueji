(() => {
  'use strict';

  const existing = window.Yueji || {};
  const listeners = new Map();
  const redact = (value) =>
    String(value ?? '')
      .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
      .replace(/(?:skill[-_ ]?key)["'\s:=]+[^\s"']+/gi, 'skill-key=[redacted]');

  const errors = existing.errors || {
    history: [],
    capture(error, context = {}) {
      const entry = {
        at: new Date().toISOString(),
        area: String(context.area || 'app'),
        stage: String(context.stage || ''),
        recoverable: context.recoverable !== false,
        message: redact(error?.message || error || 'Unknown error'),
      };
      this.history.push(entry);
      if (this.history.length > 30) this.history.shift();
      if (!context.quiet) console.warn(`[Yueji:${entry.area}]`, entry.message);
      return entry;
    },
  };

  const boot = existing.boot || {
    register(name, initializer) {
      listeners.set(name, initializer);
    },
    async start(names = [...listeners.keys()]) {
      for (const name of names) {
        const initializer = listeners.get(name);
        if (!initializer) continue;
        try {
          await initializer();
        } catch (error) {
          errors.capture(error, { area: 'boot', stage: name, recoverable: false });
          throw error;
        }
      }
    },
  };

  window.Yueji = Object.assign(existing, { version: '20260911-r1', errors, boot });

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    window.addEventListener(
      'load',
      () => {
        navigator.serviceWorker.register('./service-worker.js').catch((error) => {
          errors.capture(error, { area: 'pwa', stage: 'register', recoverable: true });
        });
      },
      { once: true },
    );
  }
})();
