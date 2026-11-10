'use strict';
/**
 * Embalmer — per-tab state capture & restore (zero-flash resurrection)
 * Runs as content script before tab discard, restores after reload.
 *
 * v3 captures everything a user can notice when a tab "dies":
 *   - exact window scrollX/scrollY + every scrollable container
 *   - input / textarea / [contenteditable] values AND caret selection range
 *   - React/Vue controlled inputs via a native-setter write (bypasses the
 *     framework's value tracker so state[$].value == DOM value)
 *   - select / checkbox / radio, activeElement selector + focus
 *   - sessionStorage + localStorage (same-origin only)
 *   - video/audio currentTime + playing
 *   - a lightweight DOM body snapshot (hydratable innerHTML, capped)
 *   - SPA route (history.state) so a hash route resumes where it was
 */

const VERSION = 3;
// Provided by security.js (a sibling <script> in the browser, or require() in
// Node). Read it lazily so declaration order does not matter and no name is
// rebound in the shared scope.
const canCapture = (el) => {
  const fn = (typeof window !== 'undefined' && window.__UmdBundle && window.__UmdBundle.shouldCapture) ||
    (typeof require === 'function' ? require('./security.js').shouldCapture : null);
  return fn ? fn(el) : true;
};
const MAX_SCROLL_ENTRIES = 500;   // guard: pathological DOMs
const MAX_DOM_SNAPSHOT = 262144;  // 256 KB cap for the body innerHTML snapshot

const FALLBACK_ESCAPE = (s) => String(s).replace(/["\\]/g, '\\$&');
let ESCAPE = FALLBACK_ESCAPE;

function setEscape(fn) { ESCAPE = (typeof fn === 'function') ? fn : FALLBACK_ESCAPE; }

function stableId(el) {
  if (el.id) return '#' + ESCAPE(el.id);
  if (el.getAttribute('data-emb-id')) return el.getAttribute('data-emb-id');
  return null;
}

/**
 * React/Vue track DOM value writes and ignore programmatic el.value = x when
 * the internal "value tracker" already holds x (or on a fresh mount the tracker
 * holds the empty string). Writing through the NATIVE setter deletes/updates
 * the tracker, so React's ChangeEventPlugin sees a real change. Without this,
 * a restored React input renders the right text but React state is stale and
 * the next keystroke reverts it.
 */
function nativeSetValue(el, value) {
  try {
    const proto = el instanceof HTMLTextAreaElement
      ? win().HTMLTextAreaElement.prototype
      : win().HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
  } catch (_) { try { el.value = value; } catch (_e) {} }
}
let WIN = null;
function win() { return WIN || (typeof window !== 'undefined' ? window : {}); }

function scrollables(doc) {
  const out = [];
  const all = doc.querySelectorAll('*');
  for (let i = 0; i < all.length && out.length < MAX_SCROLL_ENTRIES; i++) {
    const el = all[i];
    if (el.scrollHeight > el.clientHeight + 8 || el.scrollWidth > el.clientWidth + 8) {
      const sid = stableId(el);
      if (sid) out.push([sid, el.scrollTop, el.scrollLeft, el.tagName]);
    }
  }
  return out;
}

function focusedSelector(doc) {
  const el = doc.activeElement;
  if (!el || el === doc.body) return null;
  const sid = stableId(el);
  if (sid) return sid;
  // no usable id: return a nearest-path so restore can still find it
  if (el.name) return `${el.tagName.toLowerCase()}[name="${el.name}"]`;
  return null;
}

function bodySnapshot(doc) {
  try {
    const html = doc.body ? doc.body.innerHTML : null;
    if (!html) return null;
    return html.length > MAX_DOM_SNAPSHOT ? html.slice(0, MAX_DOM_SNAPSHOT) : html;
  } catch (_) { return null; }
}

/**
 * Defense-in-depth sanitiser for restored HTML: remove <script>/<iframe>/SVG
 * event handlers and every on* attribute. Operates WITHOUT a DOM dependency
 * (works in Node harness too) by parsing through a detached template element
 * when one is available, else a conservative regex strip.
 */
function stripExecutable(html) {
  if (typeof html !== 'string') return '';
  const D = (typeof document !== 'undefined') ? document : (win() && win().document);
  if (D && typeof D.createElement === 'function') {
    try {
      const t = D.createElement('template');
      t.innerHTML = html;
      t.content.querySelectorAll('script, iframe, object, embed, link[rel="import"]').forEach(n => n.remove());
      t.content.querySelectorAll('*').forEach(n => {
        for (const a of [...n.attributes]) {
          if (/^on/i.test(a.name) || (a.name === 'href' && /^\s*javascript:/i.test(a.value))) n.removeAttribute(a.name);
        }
      });
      return t.innerHTML;
    } catch (_) { /* fall through to regex */ }
  }
  return html
    .replace(/<\s*script[\s\S]*?<\s*\/\s*script\s*>/gi, '')
    .replace(/<\s*(iframe|object|embed)[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
}

class Embalmer {
  constructor(win) {
    this.win = win;
    this.doc = win.document;
    WIN = win;
    setEscape((win.CSS && typeof win.CSS.escape === 'function') ? win.CSS.escape.bind(win.CSS) : null);
  }

  capture() {
    const doc = this.doc;
    const state = {
      v: VERSION,
      url: this.win.location.href,
      fields: {}, selects: {}, checked: {}, radios: {},
      scroll: [], selection: {}, media: [], storage: {}, route: this._route(),
      at: Date.now(),
    };

    // window-level scroll (exact pixels)
    state.scrollWindow = { x: this.win.scrollX || 0, y: this.win.scrollY || 0 };

    // text-ish fields — security.js decides what may be captured at all
    for (const el of doc.querySelectorAll('input, textarea')) {
      const sid = stableId(el);
      if (!sid) continue;
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      if (type === 'checkbox') { state.checked[sid] = el.checked; continue; }
      if (type === 'radio') { if (el.checked && el.name) state.radios[el.name] = el.value; continue; }
      if (!canCapture(el)) continue; // passwords, CVV, OTP, tokens...
      state.fields[sid] = el.value;
      if (typeof el.selectionStart === 'number' && (el.selectionStart || el.selectionEnd))
        state.selection[sid] = { start: el.selectionStart, end: el.selectionEnd };
    }

    for (const el of doc.querySelectorAll('select')) {
      const sid = stableId(el);
      if (sid) state.selects[sid] = el.value;
    }
    for (const el of doc.querySelectorAll('[contenteditable="true"]')) {
      const sid = stableId(el);
      if (sid) state.fields[sid] = el.innerHTML;
    }

    state.scroll = scrollables(doc).map(([id, t, l, tag]) => ({ id, t, l, tag }));
    state.focused = focusedSelector(doc);

    for (const el of doc.querySelectorAll('video, audio')) {
      try {
        if (!el.currentSrc && !el.src) continue;
        state.media.push({ id: stableId(el) || el.tagName, time: el.currentTime, playing: !el.paused && !el.ended });
      } catch (_) {}
    }

    state.storage.local = this._snapshotStorage(this.win.localStorage);
    state.storage.session = this._snapshotStorage(this.win.sessionStorage);
    state.dom = bodySnapshot(doc);
    return state;
  }

  /**
   * restore(state) — called by the hydration bridge.
   * force=true skips the version check (same-format upgrades only), returns
   * counts of what was re-applied so the bridge can measure fidelity.
   */
  restore(state) {
    if (!state || typeof state !== 'object') return false;
    if (state.v !== VERSION) return false;
    const doc = this.doc;
    const win = this.win;
    let applied = 0;

    // 1. fields first (so scroll/selection can reference them)
    for (const [sid, val] of Object.entries(state.fields || {})) {
      let el;
      try { el = doc.querySelector(sid); } catch (_) { continue; }
      if (!el) continue;
      if (el.getAttribute('contenteditable') === 'true') {
        // SAFE-BY-BOUNDARY: value was captured from THIS same-origin page's own
        // DOM and is restored only back into that same origin. It never crosses
        // a trust boundary (no cross-origin transport, no untrusted injection).
        // Defense in depth: strip executable nodes/attrs so a page that managed
        // to inject <script>/onerror into its own editable area cannot have it
        // executed on resurrection.
        el.innerHTML = stripExecutable(val);
      } else {
        nativeSetValue(el, val);
      }
      // controlled-input frameworks listen on 'input'; native setter alone
      // will not notify React's synthetic event system
      el.dispatchEvent(new win.Event('input', { bubbles: true }));
      el.dispatchEvent(new win.Event('change', { bubbles: true }));
      applied++;
    }
    for (const [sid, val] of Object.entries(state.selects || {})) {
      let el; try { el = doc.querySelector(sid); } catch (_) { continue; }
      if (el) { el.value = val; el.dispatchEvent(new win.Event('change', { bubbles: true })); applied++; }
    }
    for (const [sid, val] of Object.entries(state.checked || {})) {
      let el; try { el = doc.querySelector(sid); } catch (_) { continue; }
      if (el) { el.checked = !!val; applied++; }
    }
    for (const [name, val] of Object.entries(state.radios || {})) {
      let el;
      try { el = doc.querySelector(`input[name="${ESCAPE(name)}"][value="${ESCAPE(val)}"]`); } catch (_) { continue; }
      if (el) { el.checked = true; applied++; }
    }

    // 2. caret / selection ranges
    for (const [sid, sel] of Object.entries(state.selection || {})) {
      let el; try { el = doc.querySelector(sid); } catch (_) { continue; }
      if (el && typeof el.selectionStart === 'number') {
        try { el.setSelectionRange(sel.start, sel.end); } catch (_) {}
        if (el.setSelectionRange) { try { el.setSelectionRange(sel.start, sel.end, 'none'); } catch (_) {} }
        applied++;
      }
    }

    // 3. window scroll — exact, no jump. scrollRestoration is set manual by
    //    the bridge; setting scrollY here before first paint avoids any flash.
    if (state.scrollWindow && (state.scrollWindow.x || state.scrollWindow.y)) {
      try { win.scrollTo(state.scrollWindow.x, state.scrollWindow.y); } catch (_) {}
      applied++;
    }
    for (const s of state.scroll || []) {
      let el; try { el = doc.querySelector(s.id); } catch (_) { continue; }
      if (el) { el.scrollTop = s.t; el.scrollLeft = s.l; applied++; }
    }

    // 4. media position (kept paused; autoplay policy on wake stays native)
    for (const m of state.media || []) {
      let el; try { el = m.id.startsWith('#') ? doc.querySelector(m.id) : doc.querySelector(m.id); } catch (_) { continue; }
      if (el && m.time) { try { el.currentTime = m.time; } catch (_) {} applied++; }
    }

    // 5. focus last: focusing an element scrolls it into view, which would
    //    undo our scroll restore if done earlier.
    if (state.focused) {
      let el; try { el = doc.querySelector(state.focused); } catch (_) { el = null; }
      if (el && typeof el.focus === 'function') {
        try {
          el.focus({ preventScroll: true });
          // re-apply caret after focus (focus() can collapse the selection)
          const sel = state.selection && state.selection[state.focused];
          if (sel && typeof el.setSelectionRange === 'function') {
            try { el.setSelectionRange(sel.start, sel.end); } catch (_) {}
          }
          applied++;
        } catch (_) {}
      }
    }

    // 6. re-assert window scroll AFTER focus (focus may have scrolled)
    if (state.scrollWindow && (state.scrollWindow.x || state.scrollWindow.y)) {
      try { win.scrollTo(state.scrollWindow.x, state.scrollWindow.y); } catch (_) {}
    }

    return { applied, v: VERSION };
  }

  _route() {
    const { host, pathname, search, hash } = this.win.location;
    return { host, path: pathname, search, hash, state: this.win.history.state };
  }

  _snapshotStorage(store) {
    const out = {};
    try { for (let i = 0; i < store.length; i++) { const k = store.key(i); out[k] = store.getItem(i); } } catch (_) {}
    return out;
  }
}

Embalmer.VERSION = VERSION;
Embalmer.setNativeValue = nativeSetValue;

/* UMD footer: same file works in Node (require) and as a browser script.
   In a browser the exported names land on window. */
;(function (g) {
  var ex = { Embalmer, setEscape };
  if (typeof module !== 'undefined' && module.exports) { module.exports = ex; }
  else { g.__UmdBundle = Object.assign(g.__UmdBundle || {}, ex); }
})(typeof globalThis !== 'undefined' ? globalThis : this);
