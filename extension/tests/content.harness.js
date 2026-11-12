// harness: extension/src/content.js must load and never throw in odd pages — a
// stripped DOM (missing documentElement/createElement) must degrade silently,
// not throw. Also proves the UMD globals it depends on are actually present.
'use strict';
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const path = require('path');
const ROOT = '/Users/apple/Documents/chrome-cemetery';

const SEC = fs.readFileSync(path.join(ROOT, 'extension/embaler/lib/security.js'), 'utf8');
const CAP = fs.readFileSync(path.join(ROOT, 'extension/embaler/lib/capture.js'), 'utf8');
const CONTENT = fs.readFileSync(path.join(ROOT, 'extension/src/content.js'), 'utf8');

// A real timer shim so pending work can be pulled when needed.
const shim = {
  _timers: [],
  setInterval(fn, ms) { const t = { fn, ms }; shim._timers.push(t); return t; },
  clearInterval(t) { const i = shim._timers.indexOf(t); if (i >= 0) shim._timers.splice(i, 1); },
  // A content script's one-shot `setTimeout(res, 60)` must actually fire, or the
  // injection Promise never resolves and the whole IIFE stalls.
  setTimeout(fn) { const t = shim.setInterval(fn, 0); return t; },
  clearTimeout(t) { shim.clearInterval(t); },
  async runAll() { for (const t of shim._timers.slice()) await t.fn(); },
};

function makeEnv(documentStub) {
  const listeners = {};
  const messages = [];
  const win = {
    __UmdBundle: undefined,
    addEventListener(k, l) { listeners[k] = (listeners[k] || []).concat(l); },
    document: documentStub,
  };
  const env = {
    console,
    setInterval: shim.setInterval,
    clearInterval: shim.clearInterval,
    setTimeout: shim.setTimeout,
    clearTimeout: shim.clearTimeout,
    Date, JSON, Object, Math, Array, Map, Set, String, Number, Error, Boolean, RegExp, Promise, Symbol,
    location: { href: 'http://127.0.0.1:8791/fixture', origin: 'http://127.0.0.1:8791' },
    navigator: { userAgent: 'harness' },
    chrome: {
      runtime: {
        id: 'test-ext',
        getURL: (p) => 'chrome-extension://test-ext' + p,
        // MV3 promise form: content.js calls sendMessage(...).catch(...)
        sendMessage(msg, cb) {
          messages.push(msg);
          if (cb) cb({});
          return Promise.resolve({ ok: true });
        },
        onMessage: { addListener(l) { listeners['runtime'] = (listeners['runtime'] || []).concat(l); } },
      },
    },
  };
  env.window = win;
  env.self = env;
  env.document = documentStub;   // content scripts also touch bare `document`
  return { env, listeners, messages, win };
}

async function scenario(label, documentStub, extraAssert) {
  shim._timers.length = 0;
  const { env, win } = makeEnv(documentStub);
  vm.createContext(env);
  for (const s of [SEC, CAP, CONTENT]) vm.runInContext(s, env);
  await shim.runAll();
  await new Promise(r => setImmediate(r));
  if (extraAssert) await extraAssert(env, win);
  console.log(label + ': OK');
}

(async () => {
  await scenario('content.js loads on a normal page', {
    documentElement: { appendChild() {}, removeChild() {} }, body: null,
    createElement() { return { textContent: '', setAttribute() {}, remove() {} }; },
    querySelectorAll() { return []; },
    addEventListener() {}, readyState: 'complete',
  });

  await scenario('content.js loads with document=null', null);

  await scenario('content.js loads when createElement throws', {
    documentElement: {}, body: null,
    createElement() { throw new Error('no elements allowed'); },
    querySelectorAll() { return []; },
    addEventListener() {}, readyState: 'loading',
  });

  await scenario('content.js loads when querySelectorAll throws', {
    documentElement: { appendChild() {}, removeChild() {} }, body: null,
    createElement() { return { setAttribute() {}, remove() {} }; },
    querySelectorAll() { throw new Error('no querying'); },
    addEventListener() {}, readyState: 'complete',
  });

  await scenario('UMD globals the content script depends on', {
    documentElement: { appendChild() {}, removeChild() {} }, body: null,
    createElement() { return { setAttribute() {}, remove() {} }; },
    querySelectorAll() { return []; },
    addEventListener() {}, readyState: 'complete',
  }, async (env, win) => {
    // The UMD footer writes to globalThis, which inside the VM is the sandbox
    // object itself (env), not env.window.
    const bundle = env.__UmdBundle || win.__UmdBundle;
    assert.ok(bundle && bundle.Embalmer, 'Embalmer must be exported');
    assert.strictEqual(typeof bundle.shouldCapture, 'function');
    assert.strictEqual(typeof bundle.sanitizeStorage, 'function');
    console.log('UMD exports present: Embalmer/shouldCapture/sanitizeStorage');
  });

  console.log('RESULT: CONTENT HARNESS GREEN');
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
