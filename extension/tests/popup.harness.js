// harness: popup.js paint() must render every GOV_STATUS field, and must never
// throw on a missing/partial status (worker unreachable, stale daemon).
// Fields are browser-first: the popup is about the browser's own footprint.
'use strict';
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const ROOT = '/Users/apple/Documents/chrome-cemetery';
const POPUP = fs.readFileSync(ROOT + '/extension/src/popup.js', 'utf8');

// Minimal DOM: exactly the ids popup.html declares.
function makeDom() {
  const els = {};
  for (const id of ['blvl', 'bmb', 'bpct', 'bprocs', 'disc', 'rest', 'free', 'swap', 'src', 'note']) {
    els[id] = { textContent: '', className: '' };
  }
  return {
    els,
    getElementById: (id) => els[id] || null,
  };
}

function run(status) {
  const dom = makeDom();
  let sent = 0;
  const env = {
    console, Date, JSON, Object, Math, Promise,
    setInterval: () => {},
    document: dom,
    chrome: { runtime: { sendMessage: () => { sent++; return Promise.resolve(status); } } },
  };
  vm.createContext(env);
  vm.runInContext(POPUP, env);
  return { dom, sent };
}

(async () => {
  // 1) full live status: browser fields lead, system fields are context
  {
    const live = {
      pressure: { level: 4, freePct: 21, swapMB: 4336, reason: 'terminal', source: 'daemon',
                  browserMB: 2675, browserPct: 17, browserLevel: 1, browserProcs: 26 },
      tabs: 7, stats: { discarded: 2, restored: 3 },
      source: 'daemon', storeBridge: true, processesApi: true,
    };
    const { dom } = run(live);
    await new Promise(r => setImmediate(r));
    assert.strictEqual(String(dom.els.blvl.textContent), 'L1 — terminal');
    assert.strictEqual(String(dom.els.blvl.className), 'lvl lvl1');
    assert.strictEqual(String(dom.els.bmb.textContent), '2675 MB');
    assert.strictEqual(String(dom.els.bpct.textContent), '17%');
    assert.strictEqual(String(dom.els.bprocs.textContent), '26');
    assert.strictEqual(String(dom.els.disc.textContent), '2');
    assert.strictEqual(String(dom.els.rest.textContent), '3');
    assert.strictEqual(String(dom.els.free.textContent), '21%');
    assert.strictEqual(String(dom.els.swap.textContent), '4336 MB');
    assert.strictEqual(String(dom.els.src.textContent), 'daemon');
    assert.strictEqual(String(dom.els.note.textContent), 'browser scoped · daemon live');
    console.log('live status painted browser-first: OK');
  }

  // 1b) browser level escalates the badge even when the system level is low
  {
    const live = {
      pressure: { level: 1, freePct: 55, swapMB: 100, reason: 'browser 51%',
                  browserMB: 8000, browserPct: 51, browserLevel: 4, browserProcs: 40 },
      tabs: 3, stats: {}, storeBridge: true, processesApi: true,
    };
    const { dom } = run(live);
    await new Promise(r => setImmediate(r));
    assert.strictEqual(String(dom.els.blvl.className), 'lvl lvl4');
    assert.match(String(dom.els.blvl.textContent), /L4/);
    console.log('browser-level escalation shown: OK');
  }

  // 1c) missing processes API must be named in the footer, not hidden
  {
    const live = {
      pressure: { level: 2, freePct: 23, swapMB: 717, reason: 'critical',
                  browserMB: 900, browserPct: 6, browserLevel: 0, browserProcs: 9 },
      tabs: 7, stats: {}, storeBridge: false, processesApi: false,
      lastError: 'processes-api-absent',
    };
    const { dom } = run(live);
    await new Promise(r => setImmediate(r));
    assert.match(String(dom.els.note.textContent), /per-tab RSS unavailable/);
    assert.match(String(dom.els.note.textContent), /processes-api-absent/);
    console.log('missing processes API reported honestly: OK');
  }

  // 2) stale snapshot (daemon down) still renders, says so
  {
    const stale = { pressure: { level: 4, freePct: 2, swapMB: 6800, reason: 'terminal',
                                source: 'stale:old', browserMB: 2100, browserPct: 13,
                                browserLevel: 1, browserProcs: 19 },
                    tabs: 9, stats: { discarded: 6, restored: 1 } };
    const { dom } = run(stale);
    await new Promise(r => setImmediate(r));
    assert.strictEqual(String(dom.els.src.textContent), 'stale:old');
    assert.strictEqual(String(dom.els.bmb.textContent), '2100 MB');
    console.log('stale snapshot paints with source visible: OK');
  }

  // 3) worker unreachable — must show the human-readable failure, not crash
  {
    const { dom } = run(Promise.reject(new Error('no worker')));
    await new Promise(r => setImmediate(r));
    assert.strictEqual(String(dom.els.blvl.textContent), 'worker unreachable');
    console.log('worker unreachable -> readable message: OK');
  }

  // 4) empty/undefined status must not throw
  {
    const { dom } = run(undefined);
    await new Promise(r => setImmediate(r));
    assert.ok(dom.els.blvl.textContent.length > 0, 'something must render');
    console.log('undefined status degrades without throwing: OK');
  }

  console.log('RESULT: POPUP HARNESS GREEN');
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });