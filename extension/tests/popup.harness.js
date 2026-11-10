// harness: popup.js paint() must render every GOV_STATUS field, and must never
// throw on a missing/partial status (worker unreachable, stale daemon).
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');
const ROOT = path.resolve(__dirname, '../..');
const POPUP = fs.readFileSync(ROOT + '/extension/src/popup.js', 'utf8');

// Minimal DOM: exactly the ids popup.html declares.
function makeDom() {
  const els = {};
  for (const id of ['lvl', 'free', 'swap', 'tabs', 'disc', 'rest', 'src']) {
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
  // 1) full live status — every field lands in the right element
  {
    const live = {
      pressure: { level: 2, freePct: 23, swapMB: 717, reason: 'critical', source: 'daemon' },
      tabs: 7, stats: { discarded: 2, restored: 3, reclaimEstimateMB: 340 },
      source: 'daemon', lastSampleAt: 1794170367432,
    };
    const { dom } = run(live);
    await new Promise(r => setImmediate(r));
    assert.strictEqual(dom.els.lvl.textContent, 'L2 — critical');
    assert.strictEqual(dom.els.lvl.className, 'lvl lvl2');
    assert.strictEqual(String(dom.els.free.textContent), '23%');
    assert.strictEqual(String(dom.els.swap.textContent), '717 MB');
    assert.strictEqual(String(dom.els.tabs.textContent), '7');
    assert.strictEqual(String(dom.els.disc.textContent), '2');
    assert.strictEqual(String(dom.els.rest.textContent), '3');
    assert.strictEqual(String(dom.els.src.textContent), 'daemon');
    console.log('live status painted field-by-field: OK');
  }

  // 2) stale snapshot (daemon down) still renders, says so
  {
    const stale = { pressure: { level: 4, freePct: 2, swapMB: 6800, reason: 'terminal', source: 'stale:old' }, tabs: 9, stats: { discarded: 6, restored: 1, reclaimEstimateMB: 900 } };
    const { dom } = run(stale);
    await new Promise(r => setImmediate(r));
    assert.strictEqual(dom.els.lvl.className, 'lvl lvl4');
    assert.strictEqual(String(dom.els.src.textContent), 'stale:old');
    console.log('stale snapshot paints with source visible: OK');
  }

  // 3) worker unreachable — must show the human-readable failure, not crash
  {
    const { dom } = run(Promise.reject(new Error('no worker')));
    await new Promise(r => setImmediate(r));
    assert.strictEqual(String(dom.els.lvl.textContent), 'worker unreachable');
    console.log('worker unreachable -> readable message: OK');
  }

  // 4) empty/undefined status must not throw
  {
    const { dom } = run(undefined);
    await new Promise(r => setImmediate(r));
    assert.ok(dom.els.lvl.textContent.length > 0, 'something must render');
    console.log('undefined status degrades without throwing: OK');
  }

  console.log('RESULT: POPUP HARNESS GREEN');
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
