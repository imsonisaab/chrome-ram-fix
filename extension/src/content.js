// content.js — Embaler bridge in every tab.
// Jobs: (1) run the Embaler capture on demand, (2) protect URLs with unsaved
// edits, (3) report visibility transitions for prewarm.
'use strict';

(async () => {
  // document can be null in exotic contexts (XML/PDF viewer) — injecting the
  // Embaler bridge would throw there and kill the whole content script.
  if (!document) return;
  // Inject the Embalmer modules as real scripts so their module-scoped
  // `require`/`window` wiring behaves like in tests.
  // SECURITY (web-accessible resources): these run in the PAGE's main world.
  // Any page can therefore read/overwrite `window.__UmdBundle`. We must never
  // trust anything the page says about state — the restore path only ever
  // uses data that came from OUR native host for THIS origin, and capture.js
  // re-validates the version tag before applying anything.
  const srcs = [
    '/embaler/lib/security.js',
    '/embaler/lib/capture.js',
    '/embaler/lib/restoreTiming.js',
    '/embaler/lib/hydrate.js',   // ZERO-FLASH wake: must be injected first
  ];
  // hydrate.js is synchronous and page-speed critical: inject it via a real
  // script tag appended at document_start so it runs before the page's own
  // scripts execute their first layout.
  for (const s of srcs) {
    try {
      await new Promise((res) => {
        const el = document.createElement('script');
        el.src = chrome.runtime.getURL(s);
        el.onload = () => el.remove();
        document.documentElement.appendChild(el);
        setTimeout(res, 60);
      });
    } catch (e) {
      // A locked-down page (CSP forbidding script tags, no createElement) must
      // not kill the content script: keep going without the lib injection; the
      // worker's chrome.tabs.sendMessage path still works.
      console.warn('embaler inject failed for', s, e && e.message);
    }
  }

  // The wake bridge: hydrate.js calls (url) => snapshot. It asks the extension
  // background, which reads the Rust store through the native host. If the
  // native bridge is unavailable, hydrate falls back to chrome.storage.session
  // through this same channel.
  try {
    window.__cemeteryBridge = (url) => new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: 'EMBAL_WAKE_SNAPSHOT', url }, (resp) => {
          if (chrome.runtime.lastError || !resp) return resolve(null);
          resolve(resp.state || null);
        });
      } catch (e) { resolve(null); }
    });
  } catch (_) { /* no bridge: hydrate stays dormant, tab still works */ }

  window.__embalerReady = true;
})();

// --- protect forms with unsaved edits -------------------------------------
// document can be null in exotic contexts (XML/PDF viewer, detached frames);
// the whole observer block must simply not install there.
if (document) {
function currentSignature() {
  let nodes;
  try {
    nodes = document.querySelectorAll('input, textarea, [contenteditable="true"]');
  } catch (e) {
    return null;   // a page that cannot be queried has no editable fields to protect
  }
  const out = [];
  for (const el of nodes) {
    const v = el.value || el.innerHTML || '';
    const base = el.defaultValue || '';
    if (v !== base && v !== '') out.push(el.id || el.name || el.tagName);
  }
  return out.length ? out.join(',') : null;
}
function reportProtect() {
  const dirty = currentSignature();
  chrome.runtime.sendMessage({ type: 'EMBAL_PROTECT_URL', url: location.href, on: !!dirty }).catch(() => {});
}
// typing signal: the worker protects any tab typed-in in the last 60 s, so a
// half-finished message survives a pressure spike even if signature sampling
// (4 s interval) has not run yet.
let lastTypedSent = 0;
function reportTyped() {
  const t = Date.now();
  if (t - lastTypedSent < 2000) return;   // coalesce: at most one ping / 2 s
  lastTypedSent = t;
  chrome.runtime.sendMessage({ type: 'EMBAL_TYPED', url: location.href, at: t }).catch(() => {});
}
// live socket signal: an open WebSocket / EventSource means the page holds a
// session that cannot be resurrected (subscribe, call, chat). Tell the worker.
function probeLiveSockets() {
  let live = false;
  try {
    const ws = window.__cemeteryLiveWs instanceof Set && window.__cemeteryLiveWs.size;
    const es = window.__cemeteryLiveEs instanceof Set && window.__cemeteryLiveEs.size;
    live = !!(ws || es);
  } catch (_) { live = false; }
  chrome.runtime.sendMessage({ type: 'EMBAL_LIVE_SOCKET', url: location.href, on: live }).catch(() => {});
}
try {
  const NativeWs = window.WebSocket;
  if (typeof NativeWs === 'function') {
    const live = new Set();
    window.__cemeteryLiveWs = live;
    // preserve construct behaviour: with `new` we must return the real socket,
    // so the wrapper is only a tracking facade, never the socket itself.
    function CemeteryWs(url, protocols) {
      const s = protocols === undefined ? new NativeWs(url) : new NativeWs(url, protocols);
      live.add(s);
      s.addEventListener('close', () => { live.delete(s); });
      s.addEventListener('error', () => { live.delete(s); });
      return s;
    }
    CemeteryWs.prototype = NativeWs.prototype;
    CemeteryWs.CONNECTING = 0;
    CemeteryWs.OPEN = 1;
    CemeteryWs.CLOSING = 2;
    CemeteryWs.CLOSED = 3;
    window.WebSocket = CemeteryWs;
  }
  const NativeEs = window.EventSource;
  if (typeof NativeEs === 'function') {
    const live = new Set();
    window.__cemeteryLiveEs = live;
    function CemeteryEs(url, cfg) {
      const s = cfg === undefined ? new NativeEs(url) : new NativeEs(url, cfg);
      live.add(s);
      s.addEventListener('error', () => { live.delete(s); });
      return s;
    }
    CemeteryEs.prototype = NativeEs.prototype;
    CemeteryEs.CONNECTING = 0;
    CemeteryEs.OPEN = 1;
    CemeteryEs.CLOSED = 2;
    window.EventSource = CemeteryEs;
  }
} catch (_) { /* wrapped best-effort: an odd page may freeze these globals */ }
document.addEventListener('input', reportTyped, true);
document.addEventListener('keydown', reportTyped, true);
document.addEventListener('compositionstart', reportTyped, true);
setInterval(probeLiveSockets, 5000);
probeLiveSockets();

// --- capture / restore on worker request ----------------------------------
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.type === 'EMBAL_CAPTURE') {
    try {
      const E = (window.__UmdBundle && window.__UmdBundle.Embalmer) ||
                window.Embalmer ||
                (typeof Embalmer !== 'undefined' ? Embalmer : null);
      if (!E) return reply({ ok: false, why: 'embaler-not-injected' });
      const state = JSON.parse(JSON.stringify(new E(window).capture()));
      reply({ ok: true, state });
    } catch (e) { reply({ ok: false, why: String(e) }); }
  }
  if (msg.type === 'EMBAL_RESTORE') {
    try {
      const E = (window.__UmdBundle && window.__UmdBundle.Embalmer) ||
                window.Embalmer ||
                (typeof Embalmer !== 'undefined' ? Embalmer : null);
      new E(window).restore(msg.state); reply({ ok: true }); }
    catch (e) { reply({ ok: false, why: String(e) }); }
  }
  return true; // async reply
});

// --- prewarm signal -------------------------------------------------------
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    chrome.runtime.sendMessage({ type: 'EMBAL_PROXIMITY', distanceMs: 0 }).catch(() => {});
  }
});
}
