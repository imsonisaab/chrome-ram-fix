// hydrate.js — ZERO-FLASH tab resurrection, runs in the PAGE (main world) at
// document_start, before first paint. Injected by content.js into every page.
//
// Flow on wake:
//   1. document_start: scrollRestoration manual + scroll frozen (no jump while
//      the page's own scripts run their layout)
//   2. the snapshot is fetched from the Rust store (cemeteryd) via the
//      extension background bridge (async) — typically <1 ms after the store
//      is warm (mmap)
//   3. DOMContentLoaded: apply fields + caret + storage BEFORE paint
//   4. requestAnimationFrame: re-assert and unfreeze so the first painted
//      frame is already at the exact saved scroll offset
//   5. MutationObserver quiescence: re-assert for SPA frameworks that wipe
//      restored values on their own hydration pass
'use strict';

(function () {
  const BRIDGE = '__cemeteryBridge';   // installed by content.js: (url) => Promise<snap|state>
  const DOC = () => (window && window.document) || null;

  // ---- 1. BEFORE the document scripts: kill automatic scroll restoration ---
  if ('scrollRestoration' in history) {
    try { history.scrollRestoration = 'manual'; } catch (_) {}
  }
  // Freeze scroll while loading: a page that scrolls during its own boot would
  // yank the viewport away from the restored offset before we apply it.
  const noScroll = function noScroll() { /* window has no scroll API (worker/test) */ };
  const realScrollTo = typeof window.scrollTo === 'function' ? window.scrollTo.bind(window) : noScroll;
  const realScrollBy = typeof window.scrollBy === 'function' ? window.scrollBy.bind(window) : noScroll;
  const realScroll = typeof window.scroll === 'function' ? window.scroll.bind(window) : noScroll;
  let frozen = true;
  function freeze() {
    if (typeof window.scrollTo === 'function') {
      window.scrollTo = function st(x, y) { if (!frozen) return realScrollTo(x, y); };
    }
    if (typeof window.scrollBy === 'function') {
      window.scrollBy = function sb(x, y) { if (!frozen) return realScrollBy(x, y); };
    }
    if (typeof window.scroll === 'function') {
      window.scroll = function sc(x, y) { if (!frozen) return realScroll(x, y); };
    }
    const d0 = DOC(); if (d0 && d0.documentElement) d0.documentElement.style.scrollBehavior = 'auto';
  }
  function unfreeze() {
    if (!frozen) return;
    frozen = false;
    if (typeof window.scrollTo === 'function') window.scrollTo = realScrollTo;
    if (typeof window.scrollBy === 'function') window.scrollBy = realScrollBy;
    if (typeof window.scroll === 'function') window.scroll = realScroll;
    try { const d1 = DOC(); if (d1 && d1.documentElement) d1.documentElement.style.scrollBehavior = ''; } catch (_) {}
  }
  freeze();

  let applied = false;
  let appliedAt = 0;

  function parseSnapshot(raw) {
    if (!raw) return null;
    let s = raw;
    try {
      if (typeof s === 'string') s = JSON.parse(s);
      if (s && s.payload && typeof s.payload === 'string') {
        try { s = JSON.parse(s.payload); } catch (_) { try { s = JSON.parse(atob(s.payload)); } catch (_e) {} }
      }
    } catch (_) { return null; }
    if (!s) return null;
    if (!s.state) return null;
    return s;
  }

  function bridgeGet(url) {
    const b = window[BRIDGE];
    if (typeof b !== 'function') return Promise.resolve(null);
    try { return Promise.resolve(b(url)).then(parseSnapshot); } catch (e) { return Promise.resolve(null); }
  }

  function applyState(snap) {
    if (!snap) return false;
    const state = snap.state || snap;
    const E = (window.__UmdBundle && window.__UmdBundle.Embalmer) || window.Embalmer;
    if (typeof E !== 'function') return false;
    try {
      const r = new E(window).restore(state);
      applied = true;
      const nowFn = (window.performance && typeof window.performance.now === 'function')
        ? window.performance.now.bind(window.performance)
        : () => Date.now();
      appliedAt = nowFn();
      const w = window;
      const CE = w.CustomEvent || class CustomEventShim {
        constructor(t, o) { this.type = t; this.detail = (o || {}).detail; }
      };
      w.dispatchEvent(new CE('cemetery:restored', {
        detail: { url: snap.url, at: appliedAt, applied: r && r.applied },
      }));
      return true;
    } catch (e) {
      const w2 = window;
      const CE2 = w2.CustomEvent || class CustomEventShim2 {
        constructor(t, o) { this.type = t; this.detail = (o || {}).detail; }
      };
      w2.dispatchEvent(new CE2('cemetery:restore-failed', { detail: { error: String(e && e.message || e) } }));
      return false;
    }
  }

  let pending = null;
  function ensureFetch() {
    if (pending) return pending;
    const href = (window.location && window.location.href) || '';
    pending = bridgeGet(href).then((snap) => {
      const ok = applyState(snap);
      if (!ok) unfreeze();
      return ok;
    });
    return pending;
  }

  const d1 = DOC();
  if (d1 && d1.readyState === 'loading') {
    d1.addEventListener('DOMContentLoaded', () => ensureFetch());
  } else {
    ensureFetch();
  }

  // ---- 3. pre-paint re-assert on the first real frame ----------------------
  let rafDone = false;
  function rafApply() {
    if (rafDone) return;
    rafDone = true;
    ensureFetch().then(() => {
      // re-assert scroll AFTER the first layout: innnerHTML writes in step 3
      // can change page height and drop the offset a fraction of a pixel
      const st = window.__cemeteryLastState;
      if (st && st.scrollWindow && (st.scrollWindow.x || st.scrollWindow.y)) {
        realScrollTo(st.scrollWindow.x, st.scrollWindow.y);
      }
      unfreeze();
    });
  }
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(rafApply);
  else setTimeout(rafApply, 0);

  // ---- 4. SPA re-render guard: re-assert after quiescence ------------------
  let reasserts = 0;
  function watchSpa() {
    if (typeof MutationObserver !== 'function') return;
    const obs = new MutationObserver(() => {
      setTimeout(() => {
        if (frozen || !applied || reasserts >= 3) return;
        const st = window.__cemeteryLastState;
        if (!st) return;
        const E = (window.__UmdBundle && window.__UmdBundle.Embalmer) || window.Embalmer;
        if (typeof E !== 'function') return;
        try { new E(window).restore(st); reasserts++; } catch (_) {}
      }, 350);
    });
    try { const d2 = DOC(); if (d2 && d2.documentElement) obs.observe(d2.documentElement, { childList: true, subtree: true }); } catch (_) {}
  }
  const d3 = DOC();
  if (d3 && d3.readyState === 'loading') {
    d3.addEventListener('DOMContentLoaded', watchSpa);
  } else {
    watchSpa();
  }

  // The content script hands us the state directly if it already holds it —
  // saves one async hop and makes the restore deterministic.
  window.__cemeteryApplyState = (snap) => {
    const s = parseSnapshot(snap);
    if (!s) return false;
    window.__cemeteryLastState = s.state;
    const ok = applyState(s);
    if (ok) {
      const st = s.state;
      if (st && st.scrollWindow && (st.scrollWindow.x || st.scrollWindow.y)) {
        realScrollTo(st.scrollWindow.x, st.scrollWindow.y);
      }
    }
    unfreeze();
    return ok;
  };
})();
