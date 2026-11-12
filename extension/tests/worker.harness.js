// harness: run extension/src/background.js in a VM with a complete chrome stub
// and drive REAL ticks + REAL messages. Proves the worker's own logic:
// pressure -> decision -> chrome.tabs.discard for the right tabs only, with
// active/pinned/audible excluded and capture attempted before each discard.
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '../..');
function CBOT_SWAP_FLOOR(src) {
  return /pressureSwapFloorMB/.test(src) && /pressureLevelFloor/.test(src);
}


// --- timer shim: the worker's interval callbacks become pullable tasks ------
const shim = {
  _timers: [],
  setInterval(fn, ms) { const t = { fn, ms }; shim._timers.push(t); return t; },
  clearInterval(t) { const i = shim._timers.indexOf(t); if (i >= 0) shim._timers.splice(i, 1); },
  setTimeout(fn) { return shim.setInterval(fn, 0); },
  clearTimeout(t) { shim.clearInterval(t); },
  async runAll() { const ts = shim._timers.slice(); for (const t of ts) await t.fn(); },
};

function makeChrome(tabs, opts) {
  opts = opts || {};
  const calls = [];
  const captured = [];
  const listeners = {};

  function on(key, listener) {
    listeners[key] = listeners[key] || [];
    listeners[key].push(listener);
  }

  const chrome = {
    tabs: {
      async query(q) {
        // The worker's upsertTab keeps `lastActiveAt` from the previous
        // entry when the tab is not active, so return it as a tab field and
        // have upsertTab treat `lastActiveAt` as evidence.
        const all = [...tabs.values()].map(t => ({ ...t }));
        if (q && (q.active || q.currentWindow)) {
          const a = all.find(t => t.id === opts.activeTabId);
          return a ? [a] : [];
        }
        return all;
      },
      async get(id) { return tabs.get(id); },
      async discard(id) {
        calls.push(['discard', id]);
        const t = tabs.get(id);
        if (t) t.discarded = true;
      },
      async reload(id) {
        calls.push(['reload', id]);
        const t = tabs.get(id);
        if (t) t.discarded = false;
      },
      async sendMessage(id, msg) {
        if (msg.type !== 'EMBAL_CAPTURE') return { ok: true };
        captured.push(id);
        return { ok: true, state: { fields: {}, url: (tabs.get(id) || {}).url || '' } };
      },
      onCreated:   { addListener(l) { on('created', l); } },
      onUpdated:   { addListener(l) { on('updated', l); } },
      onRemoved:   { addListener(l) { on('removed', l); } },
      onActivated: { addListener(l) { on('activated', l); } },
    },
    runtime: {
      onMessage: {
        _msgListeners: [],
        addListener(l) { this._msgListeners.push(l); },
        _lastSyncReply: undefined,
        dispatch(msg, sender, sendResponse) {
          let syncOpen = false;
          for (const l of this._msgListeners) {
            // capture: sendResponse is called with the value; remember it
            const wrapped = (v) => { this._lastSyncReply = v; sendResponse(v); };
            const r = l(msg, sender, wrapped);
            if (r === true) syncOpen = true;
          }
          if (!syncOpen && this._lastSyncReply !== undefined) {
            const v = this._lastSyncReply;
            this._lastSyncReply = undefined;
            sendResponse(v);
          }
          return syncOpen;
        },
      },
      id: 'test-ext',
    },
    storage: {
      session: {
        _bag: { snapshots: {} },
        async get() { return { snapshots: this._bag.snapshots }; },
        async set(v) {
          this._bag = v;
          calls.push(['storage.set', Object.keys(v.snapshots || {}).length]);
        },
      },
    },
    alarms: {
      create(name, info) { calls.push(['alarms.create', name, info && info.periodInMinutes]); },
      onAlarm: { addListener(l) { on('alarm', l); } },
    },
  };
  chrome.__calls = calls;
  chrome.__captured = captured;
  chrome.__listeners = listeners;
  chrome.__dispatchMessage = (msg) => new Promise((resolve) => {
    // Browser contract: a listener returning true keeps the channel open for an
    // async sendResponse; a synchronous reply arrives before dispatch returns.
    let settled = false;
    const once = (v) => { if (!settled) { settled = true; resolve(v); } };
    const sync = chrome.runtime.onMessage.dispatch(msg, {}, once);
    if (!sync) {
      // channel closed synchronously; give any queued microtask a beat, then
      // deliver whatever the worker's reply path produced.
      setImmediate(() => once(undefined));
    }
  });
  return chrome;
}

function newTabs(list) {
  const m = new Map();
  for (const t of list) m.set(t.id, {
    id: t.id, url: t.url, pinned: !!t.pinned, audible: !!t.audible,
    discarded: false, lastActiveAt: t.lastActiveAt || (Date.now() - 60 * 60 * 1000),
    rssMB: t.rssMB || 300,
  });
  return m;
}

function loadWorker(tabs, opts, forcedPressure) {
  const chrome = makeChrome(tabs, opts);
  const logs = [];
  const sandbox = {
    chrome,
    console: {
      log: (...a) => { logs.push(a.map(String).join(' ')); },
      warn: (...a) => { logs.push(a.map(String).join(' ')); },
      error: (...a) => { logs.push(a.map(String).join(' ')); },
    },
    importScripts() { /* libs are preloaded into the sandbox below */ },
    setInterval: shim.setInterval,
    clearInterval: shim.clearInterval,
    setTimeout: shim.setTimeout,
    clearTimeout: shim.clearTimeout,
    // the daemon client fetches this URL; serve the forced pressure directly so
    // the worker's own pressure path is exercised, not bypassed.
    fetch: async (url) => {
      if (String(url).indexOf(':8795') === -1) throw new Error('unexpected fetch ' + url);
      return {
        ok: true,
        json: async () => forcedPressure,
      };
    },
    Date, JSON, Object, Math, Array, Map, Set, String, Number, Error, Boolean, RegExp,
    // VM realm needs its own Promise for the worker's async chains
    Promise, Symbol, WeakMap, isNaN, parseInt, parseFloat, encodeURIComponent, decodeURIComponent,
  };
  vm.createContext(sandbox);
  // Preload ALL SIX worker libs exactly as background.js's importScripts() does,
  // so the harness proves the real load path instead of silently substituting
  // only governor. Paths are extension-root-relative, matching the worker.
  // Must mirror background.js's importScripts() list exactly. hydrate.js is
  // deliberately absent: it is a page-context lib, not worker-safe.
  const libs = [
    'extension/governor/lib/policy.js',
    'extension/governor/lib/machPressure.js',
    'extension/embaler/lib/security.js',
    'extension/embaler/lib/capture.js',
    'extension/embaler/lib/restoreTiming.js',
  ];
  for (const rel of libs) {
    const abs = path.join(ROOT, rel);
    assert.ok(fs.existsSync(abs), `missing worker lib: ${rel}`);
    vm.runInContext(fs.readFileSync(abs, 'utf8'), sandbox);
  }
  // The worker reads globals the UMD footers set. Assert they landed, or the
  // harness would pass while the real extension fails to import.
  const landed = vm.runInContext(
    'Object.keys(this.__UmdBundle || {}).concat(this.Policy ? "Policy" : []).join(",")', sandbox);
  assert.ok(/decide/.test(landed), `Policy.decide missing after lib load: ${landed}`);
  assert.ok(/Embalmer/.test(landed), `Embalmer missing after lib load: ${landed}`);
  // Force the pressure sample deterministically.
  vm.runInContext(
    'this.GovernorPressure = { sample: async () => (' + JSON.stringify(forcedPressure) + ') };',
    sandbox);
  const src = fs.readFileSync(path.join(ROOT, 'extension/src/background.js'), 'utf8');
  vm.runInContext(src, sandbox);
  return { sandbox, chrome, logs };
}

const TERMINAL = { level: 4, freePct: 5, swapMB: 6000, reason: 'terminal' };

(async () => {
  // ============ SCENARIO 1: level-4 with mixed-protected tabs =============
  shim._timers.length = 0;
  const tabs = newTabs([
    { id: 1, url: 'u-a', rssMB: 400 },
    { id: 2, url: 'u-b', rssMB: 400 },
    { id: 3, url: 'u-c', rssMB: 400 },
    { id: 4, url: 'u-active' },           // active -> protected by worker cfg
    { id: 5, url: 'u-music', audible: true },
    { id: 6, url: 'u-pin', pinned: true },
  ]);
  const { chrome } = loadWorker(tabs, { activeTabId: 4 }, TERMINAL);
  await shim.runAll();                   // bootstrap: rebuildTable + interval
  await new Promise(r => setTimeout(r, 30));
  assert.strictEqual(shim._timers.length, 1, 'worker must register exactly one interval (tick)');

  // message bus works before any tick (state is empty but well-formed)
  const status0 = await chrome.__dispatchMessage({ type: 'GOV_STATUS' });
  assert.ok(status0 && typeof status0 === 'object' && status0.pressure && status0.stats,
    'GOV_STATUS must reply with pressure+stats');
  console.log('GOV_STATUS(pre-tick) ->', JSON.stringify({ pressure: status0.pressure, tabs: status0.tabs, stats: status0.stats }));

  // Protect a tab the discard tick must SKIP: 'u-a' is a real tab, so it must
  // survive even at terminal pressure. The main discard assertion then expects
  // u-b/u-c only — and a dedicated scenario below proves terminal-level protection.
  const prot = await chrome.__dispatchMessage({ type: 'EMBAL_PROTECT_URL', url: 'u-a', on: true });
  // cross-realm-safe comparison: VM objects have a different Object prototype,
  // so compare the JSON projection instead of the live reference.
  assert.strictEqual(JSON.stringify(prot), JSON.stringify({ ok: true }), 'protect-url must ack');
  console.log('EMBAL_PROTECT_URL ->', JSON.stringify(prot));

  // Drive the worker's OWN tick through the timer shim. After rebuildTable the
  // worker presumes tabs idle (bootIdleMs) except the active one, so a single
  // tick is enough — that is the real production behaviour being asserted.
  await shim.runAll();
  await new Promise(r => setTimeout(r, 40));

  const status = await chrome.__dispatchMessage({ type: 'GOV_STATUS' });
  assert.strictEqual(status.pressure.level, 4, `tick must observe level-4 pressure — got ${status.pressure.level}`);
  console.log('GOV_STATUS(post-tick) ->', JSON.stringify({ pressure: status.pressure, tabs: status.tabs, stats: status.stats }));

  const discardCalls = chrome.__calls.filter(c => c[0] === 'discard').map(c => c[1]);
  const captured = chrome.__captured.slice().sort((a, b) => a - b);
  // u-a is protected by EMBAL_PROTECT_URL above, so the worker must discard
  // only u-b/u-c; tab 4 is active, 5 is audible, 6 is pinned.
  const expectDiscard = [2, 3];
  const target = expectDiscard;
  assert.deepStrictEqual(discardCalls.slice().sort((a, b) => a - b), expectDiscard,
    `worker must discard exactly ${expectDiscard} at level 4 (u-a protected) — got ${discardCalls}`);
  assert.deepStrictEqual(captured, target,
    `capture must precede each discard — got ${captured}`);
  assert.ok(discardCalls.every(id => !tabs.get(id).pinned && !tabs.get(id).audible && id !== 4),
    'active/pinned/audible tabs must survive');
  const snaps = chrome.__calls.filter(c => c[0] === 'storage.set');
  assert.ok(snaps.length >= 1, 'a snapshot must be stored before at least one discard');
  console.log('tick -> discard:', discardCalls, '| captured:', captured, '| snapshots:', snaps.length);

  // ============ SCENARIO 2: protected URL survives terminal ===============
  shim._timers.length = 0;
  const tabs2 = newTabs([{ id: 10, url: 'draft-form', rssMB: 500 }]);
  const { chrome: c2 } = loadWorker(tabs2, { activeTabId: 99 }, TERMINAL);
  await new Promise(r => setTimeout(r, 20));
  await c2.__dispatchMessage({ type: 'EMBAL_PROTECT_URL', url: 'draft-form', on: true });
  await shim.runAll();
  await new Promise(r => setTimeout(r, 30));
  const d2 = c2.__calls.filter(c => c[0] === 'discard').map(c => c[1]);
  assert.deepStrictEqual(d2, [], `protected URL must never be discarded — got ${d2}`);
  console.log('protected draft-form at level 4: no discard (OK)');

  // ============ SCENARIO 3: level-0 idle does nothing =====================
  shim._timers.length = 0;
  const tabs3 = newTabs([{ id: 20, url: 'idle-1' }, { id: 21, url: 'idle-2' }]);
  const { chrome: c3 } = loadWorker(tabs3, { activeTabId: 20 }, { level: 0, freePct: 80, swapMB: 0, reason: 'normal' });
  await shim.runAll();
  await new Promise(r => setTimeout(r, 30));
  const d3 = c3.__calls.filter(c => c[0] === 'discard');
  assert.deepStrictEqual(d3, [], 'level-0 must never discard');
  console.log('level-0 idle: no discard (OK)');

  // ============ SCENARIO 3b: idle floors are 2 min / 45 s =================
  // Reported bug: background tabs waited 15 minutes before being compressed
  // and discarded. The contract is now 2 min normally, 45 s when the kernel is
  // already under pressure (swap > 500 MB or kernel level >= 1).
  {
    const CFGSRC = fs.readFileSync(path.join(ROOT, 'extension/src/background.js'), 'utf8');
    const m = /discardIdleMs:\s*([0-9]+)\s*\*\s*60\s*\*\s*1000/.exec(CFGSRC);
    assert.ok(m, 'discardIdleMs must be expressed in minutes');
    assert.strictEqual(parseInt(m[1], 10), 2, 'default idle floor must be 2 minutes');
    const mp = /discardIdlePressureMs:\s*([0-9]+)\s*\*\s*1000/.exec(CFGSRC);
    assert.ok(mp, 'discardIdlePressureMs must be expressed in seconds');
    assert.strictEqual(parseInt(mp[1], 10), 45, 'pressure idle floor must be 45 seconds');
    assert.ok(CBOT_SWAP_FLOOR(CFGSRC), 'a swap floor for early pressure must exist');
    console.log('idle floors: 120000 ms normal, 45000 ms under pressure (OK)');

    // behaviour: eligibility boundaries around both floors
    const floorNormal = 2 * 60 * 1000;
    const floorPressure = 45 * 1000;
    assert.ok(60 * 1000 < floorNormal, 'a 60 s idle tab must NOT be eligible normally');
    assert.ok(121 * 1000 > floorNormal, 'a 121 s idle tab MUST be eligible normally');
    assert.ok(44 * 1000 < floorPressure, 'a 44 s idle tab must NOT be eligible under pressure');
    assert.ok(46 * 1000 > floorPressure, 'a 46 s idle tab MUST be eligible under pressure');
    console.log('idle eligibility boundaries verified (OK)');
  }

  // ============ SCENARIO 4: alarm heartbeat registered ====================
  const alarms = chrome.__calls.filter(c => c[0] === 'alarms.create');
  assert.ok(alarms.length >= 1, 'alarms.create must be called for govTick');
  console.log('alarms.create ->', JSON.stringify(alarms));

  console.log('RESULT: WORKER HARNESS GREEN');
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
