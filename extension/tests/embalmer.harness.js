// harness: Embalmer v3 capture/restore fidelity + hydrate.js zero-flash boot.
// A fake DOM good enough to exercise the real capture code paths:
//   - input/textarea values, caret selection ranges
//   - contenteditable innerHTML restore WITH script stripping
//   - select / checkbox / radio
//   - window scroll + inner scrollable containers
//   - the native-setter write (React controlled-input path)
//   - password/PII fields must NEVER be captured (security.js boundary)
//   - hydrate.js must boot without throwing on a stripped document
'use strict';
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const path = require('path');
const ROOT = '/Users/apple/Documents/chrome-cemetery';

const SEC = fs.readFileSync(path.join(ROOT, 'extension/embaler/lib/security.js'), 'utf8');
const CAP = fs.readFileSync(path.join(ROOT, 'extension/embaler/lib/capture.js'), 'utf8');
const HYD = fs.readFileSync(path.join(ROOT, 'extension/embaler/lib/hydrate.js'), 'utf8');

// ---------------- fake DOM ----------------
function makeEl(tag, opts) {
  opts = opts || {};
  const el = {
    tagName: tag.toUpperCase(),
    _attrs: Object.assign({}, opts.attrs),
    checked: !!opts.checked,
    innerHTML: opts.innerHTML !== undefined ? opts.innerHTML : '',
    scrollTop: opts.scrollTop || 0,
    scrollLeft: opts.scrollLeft || 0,
    scrollHeight: opts.scrollHeight || 100,
    clientHeight: opts.clientHeight || 100,
    scrollWidth: opts.scrollWidth || 100,
    clientWidth: opts.clientWidth || 100,
    selectionStart: opts.selectionStart || 0,
    selectionEnd: opts.selectionEnd || 0,
    currentTime: opts.currentTime || 0,
    paused: opts.paused !== undefined ? opts.paused : true,
    src: opts.src || '',
    currentSrc: opts.src || '',
    events: [],
    focused: false,
    _nativeValue: opts.value !== undefined ? opts.value : '',
    _nativeWrites: 0,
    get id() { return this._attrs.id || ''; },
    getAttribute(n) { return n in this._attrs ? this._attrs[n] : null; },
    setAttribute(n, v) { this._attrs[n] = String(v); },
    removeAttribute(n) { delete this._attrs[n]; },
    dispatchEvent(e) { this.events.push(e); return true; },
    focus() { this.focused = true; },
    setSelectionRange(a, b) { this.selectionStart = a; this.selectionEnd = b; },
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
    querySelectorAll(sel) { return ALL.filter(e => matchSel(e, sel)); },
  };
  Object.defineProperty(el, 'value', {
    get() { return el._nativeValue; },
    set(v) { el._nativeWrites++; el._nativeValue = v; },
    configurable: true,
  });
  return el;
}
function matchSel(el, sel) {
  if (!sel) return false;
  if (sel.indexOf('#') === 0 && el._attrs.id === sel.slice(1)) return true;
  if (sel.indexOf('[') === 0 && sel.lastIndexOf(']') === sel.length - 1) {
    const body_ = sel.slice(1, -1);
    const eq = body_.indexOf('=');
    const k = eq === -1 ? body_ : body_.slice(0, eq);
    const want = eq === -1 ? '' : body_.slice(eq + 1).replace(/"/g, '');
    if (k === 'contenteditable') return el._attrs['contenteditable'] === 'true';
    return String(el._attrs[k]) === want;
  }
  const tag = sel.toLowerCase();
  if (['input','textarea','select','video','audio'].indexOf(tag) !== -1) return el.tagName === tag.toUpperCase();
  return false;
}

const ALL = [];
const input1 = makeEl('input', { value: 'type kiya hua text', attrs: { id: 'msg' }, selectionStart: 5, selectionEnd: 9 });
const ta1 = makeEl('textarea', { value: 'multiline\nbody', attrs: { id: 'ta' } });
const sel1 = makeEl('select', { value: 'hi', attrs: { id: 'lang' } });
const cb1 = makeEl('input', { checked: true, attrs: { id: 'cb', type: 'checkbox' } });
const ce1 = makeEl('div', { innerHTML: '<b>hello</b><script>alert(1)</script>', attrs: { id: 'rich', contenteditable: 'true' } });
const vid1 = makeEl('video', { attrs: { id: 'v' }, src: 'http://x/v.mp4', currentTime: 42.5 });
const scrollBox = makeEl('div', { attrs: { id: 'scroller' }, scrollTop: 640, scrollLeft: 12, scrollHeight: 4000, clientHeight: 800 });
const pwEl = makeEl('input', { value: 'SuperSecret!', attrs: { id: 'pw', type: 'password' } });
ALL.push(input1, ta1, sel1, cb1, ce1, vid1, scrollBox, pwEl);

const doc = {
  body: { innerHTML: '<div id="app">page body</div>' },
  documentElement: { style: {} },
  activeElement: input1,
  createElement(tag) {
    if (tag === 'template') {
      const t = { content: { querySelectorAll: () => [] }, _safeHtml: '' };
      Object.defineProperty(t, 'innerHTML', {
        get() { return t._safeHtml; },
        set(v) {
          t._safeHtml = String(v)
            .replace(/<\s*script[\s\S]*?<\s*\/\s*script\s*>/gi, '')
            .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
        },
      });
      return t;
    }
    return { setAttribute() {}, remove() {}, style: {} };
  },
  querySelector(sel) { return ALL.filter(e => matchSel(e, sel))[0] || null; },
  querySelectorAll(sel) {
    if (sel.indexOf('contenteditable') !== -1) return [ce1];
    if (sel.indexOf('input') !== -1 || sel.indexOf('textarea') !== -1) return [input1, ta1, cb1, pwEl];
    if (sel.indexOf('select') !== -1) return [sel1];
    if (sel.indexOf('video') !== -1 || sel.indexOf('audio') !== -1) return [vid1];
    if (sel === '*') return ALL;
    return ALL.filter(e => matchSel(e, sel));
  },
};

function makeWin(extra) {
  const w = {
    document: doc,
    location: { href: 'https://example.com/app', host: 'example.com', pathname: '/app', search: '', hash: '#top' },
    history: { state: { route: 'app' } },
    scrollX: 320, scrollY: 2400,
    localStorage: { length: 1, key: () => 'ls', getItem: () => '"v"' },
    sessionStorage: { length: 1, key: () => 'ss', getItem: () => '"rt"' },
    Event: class Ev { constructor(t, o) { this.type = t; Object.assign(this, o || {}); } },
    CSS: { escape: (s) => String(s) },
    performance: { now: () => 12.5 },
    HTMLInputElement: { prototype: {} },
    HTMLTextAreaElement: { prototype: {} },
  };
  return Object.assign(w, extra || {});
}

function loadUMD(src, win) {
  const env = { console, window: win, document: win.document, location: win.location, history: win.history, Event: win.Event, Promise, JSON, Object, Array, Math, Set, Map, String, Number, Date, Error, RegExp, Boolean, setTimeout, parseInt, parseFloat };
  env.require = () => { throw new Error('no require in browser'); };
  vm.createContext(env);
  vm.runInContext(SEC, env);
  // security.js' UMD footer writes to globalThis (= the VM sandbox), while
  // capture.js reads window.__UmdBundle. Mirror it onto the window stub so the
  // lazy shouldCapture lookup finds it exactly like in a real page.
  if (env.__UmdBundle) win.__UmdBundle = env.__UmdBundle;
  vm.runInContext(src, env);
  if (env.__UmdBundle && win.__UmdBundle !== env.__UmdBundle) win.__UmdBundle = env.__UmdBundle;
  const bundle = env.__UmdBundle || (win && win.__UmdBundle) || (env.window && env.window.__UmdBundle);
  if (!bundle || !bundle.Embalmer) throw new Error('UMD export missing');
  return bundle.Embalmer;
}

async function main() {
  let state = null;
  try {
    const w = makeWin();
    const E = loadUMD(CAP, w);
    state = JSON.parse(JSON.stringify(new E(w).capture()));
  } catch (e) { console.error('FAIL capture:', e && e.stack || e); process.exit(1); }

  assert.ok(state && state.v === 3, 'capture must be v3, got ' + (state && state.v));
  assert.deepStrictEqual(state.fields['#msg'], 'type kiya hua text', 'input value captured');
  assert.deepStrictEqual(state.fields['#ta'], 'multiline\nbody', 'textarea captured');
  assert.deepStrictEqual(state.fields['#rich'], '<b>hello</b><script>alert(1)</script>', 'contenteditable innerHTML captured');
  assert.deepStrictEqual(state.selection['#msg'], { start: 5, end: 9 }, 'caret selection captured');
  assert.deepStrictEqual(state.selects['#lang'], 'hi', 'select captured');
  assert.deepStrictEqual(state.checked['#cb'], true, 'checkbox captured');
  assert.deepStrictEqual(state.scrollWindow, { x: 320, y: 2400 }, 'window scroll captured');
  const sc = state.scroll.find(s => s.id === '#scroller');
  assert.ok(sc && sc.t === 640 && sc.l === 12, 'inner scrollable captured');
  assert.deepStrictEqual(state.media, [{ id: '#v', time: 42.5, playing: false }], 'media position captured');
  assert.deepStrictEqual(state.storage.session, { ss: '"rt"' }, 'sessionStorage captured');
  assert.deepStrictEqual(state.storage.local, { ls: '"v"' }, 'localStorage captured');
  assert.strictEqual(state.focused, '#msg', 'active element captured');
  assert.ok(state.dom && state.dom.indexOf('page body') !== -1, 'DOM body snapshot captured');
  const flat = JSON.stringify(state);
  assert.ok(flat.indexOf('SuperSecret') === -1, 'PASSWORD MUST NOT BE CAPTURED');
  console.log('capture v3 fidelity: OK (fields/selection/scroll/media/storage/focused/dom; password excluded)');

  // ---------------- 2. restore fidelity ----------------
  input1._nativeValue = ''; input1._nativeWrites = 0;
  input1.selectionStart = 0; input1.selectionEnd = 0;
  ce1.innerHTML = ''; sel1.value = ''; cb1.checked = false; ta1.value = ''; input1.focused = false;
  try {
    const w2 = makeWin();
    const E2 = loadUMD(CAP, w2);
    const r = new E2(w2).restore(state);
    assert.ok(r && r.applied >= 8, 'restore applied counter = ' + (r && r.applied));
    assert.strictEqual(input1._nativeValue, 'type kiya hua text', 'input value written through NATIVE setter (React path)');
    assert.strictEqual(input1._nativeWrites, 1, 'native setter used exactly once, not twice');
    assert.strictEqual(input1.selectionStart + ',' + input1.selectionEnd, '5,9', 'caret restored');
    assert.strictEqual(ta1.value, 'multiline\nbody', 'textarea restored');
    assert.strictEqual(sel1.value, 'hi', 'select restored');
    assert.strictEqual(cb1.checked, true, 'checkbox restored');
    assert.ok(ce1.innerHTML.indexOf('<b>hello</b>') !== -1, 'contenteditable content restored');
    assert.ok(ce1.innerHTML.indexOf('<script') === -1, 'SCRIPT STRIPPED on restore');
    assert.ok(input1.events.some(e => e.type === 'input'), 'input event dispatched for controlled frameworks');
    assert.ok(input1.focused, 'focus restored to the active element');
    console.log('restore v3 fidelity: OK (native setter 1 write, caret, script strip, events, focus)');
  } catch (e) { console.error('FAIL restore:', e && e.stack || e); process.exit(1); }

  // ---------------- 3. hydrate.js boots clean ----------------
  const listeners = {};
  const hw = {
    location: { href: 'https://example.com/app' },
    history: { scrollRestoration: 'auto' },
    scrollTo(x, y) { this._s = [x, y]; },
    scrollBy() {}, scroll() {},
    requestAnimationFrame(fn) { setTimeout(fn, 0); },
    MutationObserver: class MO { observe() {} },
    addEventListener() {},
    dispatchEvent() {},
    document: {
      readyState: 'loading',
      documentElement: { style: {} },
      createElement: () => ({ style: {} }),
      addEventListener(k, fn) { listeners[k] = fn; },
    },
    CustomEvent: class CE { constructor(t, o) { this.type = t; Object.assign(this, o || {}); } },
    Event: class Ev { constructor(t) { this.type = t; } },
    performance: { now: () => 1 },
    __cemeteryBridge: undefined,
    __UmdBundle: undefined,
  };
  try {
    // a real page already carries the Embalmer UMD from the capture injection
    hw.__UmdBundle = { Embalmer: loadUMD(CAP, hw) };
    const env = { console, setTimeout, setInterval, clearTimeout, clearInterval, window: hw, location: hw.location, history: hw.history };
    env.require = () => { throw new Error('no require in browser'); };
    vm.createContext(env);
    vm.runInContext(HYD, env);
    assert.strictEqual(hw.history.scrollRestoration, 'manual', 'hydrate sets manual scrollRestoration');
    // scroll must be FROZEN until the snapshot lands: a page that scrolls
    // during its own boot must not yank the viewport before our restore.
    hw.scrollTo(10, 20);
    assert.strictEqual(hw._s, undefined, 'scroll frozen while hydrate is pending');
    hw.__cemeteryApplyState({ url: 'https://example.com/app', state });
    hw.scrollTo(11, 22);
    assert.deepStrictEqual(hw._s, [11, 22], 'scroll unfrozen after restore');
    listeners['DOMContentLoaded'] && listeners['DOMContentLoaded']();
    await new Promise(r => setTimeout(r, 30));
    assert.strictEqual(typeof hw.__cemeteryApplyState, 'function', 'apply hook exposed');
    const ok = hw.__cemeteryApplyState({ url: 'https://example.com/app', state });
    assert.ok(ok, 'hydrate applies a handed-over snapshot');
    console.log('hydrate.js boot: OK (manual scrollRestoration, no-throw without bridge, apply hook works)');
  } catch (e) { console.error('FAIL hydrate:', e && e.stack || e); process.exit(1); }

  // ---------------- 4. version mismatch rejected ----------------
  input1._nativeValue = 'kept'; input1._nativeWrites = 0;
  try {
    const w3 = makeWin();
    const E3 = loadUMD(CAP, w3);
    const r3 = new E3(w3).restore({ v: 1, fields: { '#msg': 'stale' } });
    assert.strictEqual(r3, false, 'old-version state must be rejected');
    assert.strictEqual(input1._nativeValue, 'kept', 'rejected state does not clobber current value');
    console.log('version gate: OK (v1 state rejected)');
  } catch (e) { console.error('FAIL version gate:', e && e.stack || e); process.exit(1); }

  console.log('RESULT: EMBALMER v3 HARNESS GREEN');
}

main().catch(e => { console.error('FAIL:', e && e.stack || e); process.exit(1); });
