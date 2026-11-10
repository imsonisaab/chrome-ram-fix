// pressureClient.js — Governor's kernel sampler, browser-side.
// MV3 extension host can't spawn `vm_stat`, so this wraps the host app's
// governor daemon (localhost JSON) with a last-known fallback. The daemon is
// authoritative; this never guesses.
'use strict';

const GovernorPressure = (() => {
  const URL_ = 'http://127.0.0.1:8795/pressure';
  let last = { level: 0, freePct: 100, swapMB: 0, reason: 'normal', source: 'fallback' };
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
        last = { level: s.level, freePct: s.freePct, swapMB: s.swapMB, reason: s.reason, source: 'daemon' };
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
