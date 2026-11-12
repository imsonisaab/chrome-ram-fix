// pressureClient.js — Governor's kernel sampler, browser-side.
// MV3 extension host can't spawn `vm_stat`, so this wraps the host app's
// governor daemon (localhost JSON) with a last-known fallback. The daemon is
// authoritative; this never guesses.
'use strict';

const GovernorPressure = (() => {
  // Scoped to THIS browser: the daemon reports the browser's own footprint plus
  // a browser level, so the extension acts on the browser rather than on the
  // whole machine (Hermes, omniroute, other apps are not its to kill).
  // Any Chromium browser works: the daemon matches the process name it is given.
  function detectBrowserName() {
    try {
      const ua = (navigator && navigator.userAgent) || '';
      if (/Edg\//.test(ua)) return 'Microsoft Edge';
      if (/OPR\//.test(ua)) return 'Opera';
      if (/Brave/.test(ua) || /BraveBrowser/.test(ua)) return 'Brave Browser';
      if (/Chrome\//.test(ua)) return 'Google Chrome';
    } catch (_) { /* fall through */ }
    return 'Google Chrome';
  }
  const BROWSER_NAME = detectBrowserName();
  const URL_ = 'http://127.0.0.1:8795/pressure?browser=' + encodeURIComponent(BROWSER_NAME);
  let last = { level: 0, freePct: 100, swapMB: 0, reason: 'normal', source: 'fallback',
               browserMB: 0, browserPct: 0, browserLevel: 0, browserProcs: 0 };
  let lastOk = 0;

  async function fetchOnce() {
    const r = await fetch(URL_, { cache: 'no-store' });
    if (!r.ok) throw new Error('governor daemon ' + r.status);
    return r.json();
  }

  return {
    async sample() {
      const age = Date.now() - lastOk;
      if (age < 1500) return last;          // debounce: don't hammer the daemon
      try {
        const s = await fetchOnce();
        last = {
          level: s.level, freePct: s.freePct, swapMB: s.swapMB, reason: s.reason,
          source: 'daemon',
          browserMB: s.browserMB || 0, browserPct: s.browserPct || 0,
          browserLevel: s.browserLevel || 0, browserProcs: s.browserProcs || 0,
        };
        lastOk = Date.now();
      } catch (_) {
        // Daemon down: hold last known state, mark stale. policy handles level<=1 safely.
        last = Object.assign({}, last, { source: 'stale:' + (age > 30000 ? 'old' : 'recent') });
      }
      return last;
    },
    get lastKnown() { return last; },
  };
})();

// UMD footer: assign (not declare) so the binding lands on the global object in a
// service worker, where a top-level `const` stays scoped to this script.
;(function (g) {
  g.GovernorPressure = GovernorPressure;
  if (typeof module !== 'undefined' && module.exports) module.exports = { GovernorPressure };
})(typeof globalThis !== 'undefined' ? globalThis : self);
