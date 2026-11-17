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
// Inject Embaler libs into the PAGE main world. External script tags and
// window.eval are both blocked by page CSP on many sites. chrome.scripting
// with world:"MAIN" (permission added in manifest) is the reliable path.
// Ask the background worker to do it — content scripts share the tab id.
try {
  chrome.runtime.sendMessage({ type: 'EMBAL_INJECT_LIBS' }, () => {
    void chrome.runtime.lastError;
  });
} catch (_) {}
// Give the injection a tick to land before the wake bridge is installed;
// capture() degrades gracefully if the libs never arrive.
await new Promise((res) => setTimeout(res, 120));

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
  govSend({ type: 'EMBAL_PROTECT_URL', url: location.href, on: !!dirty });
}
// typing signal: the worker protects any tab typed-in in the last 60 s, so a
// half-finished message survives a pressure spike even if signature sampling
// (4 s interval) has not run yet.
let lastTypedSent = 0;
function reportTyped() {
  const t = Date.now();
  if (t - lastTypedSent < 2000) return;   // coalesce: at most one ping / 2 s
  lastTypedSent = t;
  govSend({ type: 'EMBAL_TYPED', url: location.href, at: t });
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
  govSend({ type: 'EMBAL_LIVE_SOCKET', url: location.href, on: live });
}

// --- active-stream heartbeat ------------------------------------------------
// An AI console mid-answer, a build log, a stock ticker: the page looks idle
// to chrome.tabs (no clicks, no typing, audio off) but its content is arriving
// right now, and discarding it cuts the stream off. A MutationObserver on the
// document is the cheapest signal that something is still writing to the DOM.
// Only the fact "it changed" is reported — never what changed: this must not
// become a page-content exfiltration path.
let lastBusySent = 0;
function reportBusy() {
  const t = Date.now();
  if (t - lastBusySent < 5000) return;          // coalesce: at most one / 5 s
  lastBusySent = t;
  govSend({ type: 'EMBAL_BUSY', url: location.href, at: t });
}
let domBeat = null;
function startDomHeartbeat() {
  if (domBeat) return;
  try {
    let pending = false;
    domBeat = new MutationObserver(() => { pending = true; });
    domBeat.observe(document.documentElement, {
      childList: true, subtree: true, characterData: true,
    });
    // Sample on a slow interval so a chatty page cannot flood the worker.
    setInterval(() => {
      if (!pending) return;
      pending = false;
      reportBusy();
    }, 15000);                                   // 4 busy pings / minute max
  } catch (_) {
    // No MutationObserver (or a detached doc): the URL allowlist and the
    // live-socket check still cover the important streaming cases.
    domBeat = null;
  }
}

// --- audio state ------------------------------------------------------------
// Audible tabs are already protected; this also catches the tab that went
// quiet 3 minutes ago, which the tab events alone report as silent.
function reportAudio(on) {
  govSend({ type: 'EMBAL_AUDIO', url: location.href, on: !!on });
}
function startAudioWatch() {
  try {
    const els = document.querySelectorAll('video, audio');
    for (const el of els) {
      if (el.__cemeteryAudioWatched) continue;
      el.__cemeteryAudioWatched = true;
      el.addEventListener('play', () => reportAudio(true), { passive: true });
      el.addEventListener('pause', () => reportAudio(false), { passive: true });
    }
  } catch (_) { /* querySelectorAll can throw in a torn-down document */ }
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
// --- non-silent worker messaging ------------------------------------------
// A suspended MV3 worker cannot be reached by a bare sendMessage: the promise
// rejects with "Could not establish connection". Every governor signal used
// to end in `.catch(() => {})`, which discarded that rejection and with it
// the signal -- typed / busy-DOM / audio / live-socket / protect / proximity.
// The guards those feed then never engaged, and the governor saw an idle tab.
//
// Retry once (that retry is the wake) and say so out loud if it still fails.
let __govWarned = Object.create(null);
function govWarn(type) {
  if (__govWarned[type]) return;         // once per type per page, not per send
  __govWarned[type] = true;
  try { console.warn('[ChromeRAMFix] worker unreachable for ' + type); } catch (_) {}
}

function govSend(msg) {
  const fire = (onFail) => {
    try {
      const p = chrome.runtime.sendMessage(msg, () => {
        void chrome.runtime.lastError;   // reading it marks it handled
      });
      if (p && typeof p.catch === 'function') p.catch(onFail);
    } catch (_) {
      onFail();
    }
  };
  fire(() => fire(() => govWarn(msg && msg.type)));
}

// --- keep the service worker resident ------------------------------------
// MV3 suspends an idle worker after ~30 s. The worker polls every
// CFG.pollMs (2.5 s) ONLY while it believes it is resident, so an unopened
// keepalive port means the governor actually samples once a minute on the
// alarms -- stale pressure data behind every discard decision. Hold the port
// open for the life of the page; the worker's own 20 s heartbeat rides it.
//
// GOV_WAKE is the warm-start path: back/forward-cache restore, tab reopen.
// The page is about to be read, so the worker should look NOW rather than
// waiting for its next tick.
let govPort = null;
try {
  govPort = chrome.runtime.connect({ name: 'govKeepAlive' });
  govPort.onDisconnect.addListener(() => { govPort = null; });
} catch (_) {
  // Worker restarting / extension reloading: the alarms still cover us.
  govPort = null;
}

function govWake() {
  // Port first: cheap, and it keeps the worker resident. If the port is gone
  // (worker suspended, extension reloaded) postMessage delivers nothing, so
  // fall back to a message -- the only path that can wake a sleeper.
  try {
    if (govPort) {
      govPort.postMessage({ type: 'GOV_WAKE' });
      return;
    }
  } catch (_) { /* port died mid-call: fall through */ }
  govSend({ type: 'GOV_WAKE' });
}

// pageshow fires on initial load AND on every bfcache restore, which is the
// exact moment a discarded tab comes back.
window.addEventListener('pageshow', govWake);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') govWake();
});

document.addEventListener('input', reportTyped, true);
document.addEventListener('keydown', reportTyped, true);
document.addEventListener('compositionstart', reportTyped, true);
setInterval(probeLiveSockets, 5000);
probeLiveSockets();
startDomHeartbeat();
setInterval(startAudioWatch, 5000);   // players mount late on streaming sites

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
    govSend({ type: 'EMBAL_PROXIMITY', distanceMs: 0 });
  }
});
}
