// tests: Governor pressure classification + kernel sample
'use strict';
const { test, run } = require('node:test');
const assert = require('node:assert');
const { classify, sample } = require('../lib/machPressure.js');

const base = { pageSize: 16384, compressed: 0, purgeable: 0 };

test('classify: 80% free -> level 0 normal', () => {
  const snap = { ...base, free: 8000, active: 1000, inactive: 200, speculative: 0, wired: 800, swapMB: 100 };
  const r = classify(snap);
  assert.strictEqual(r.level, 0);
  assert.strictEqual(r.reason, 'normal');
  assert.ok(r.freePct >= 60, `freePct ${r.freePct}`);
});

test('classify: 45% free -> level 1 warn', () => {
  const snap = { ...base, free: 4500, active: 3000, inactive: 1000, speculative: 0, wired: 1500, swapMB: 300 };
  const r = classify(snap);
  assert.strictEqual(r.level, 1);
  assert.strictEqual(r.reason, 'warn');
});

test('classify: 20% free -> level 3 severe (below 15% usable)', () => {
  const snap = { ...base, free: 1000, active: 6000, inactive: 3000, speculative: 0, wired: 4000, swapMB: 500 };
  const r = classify(snap);
  assert.ok(r.level >= 2, `got ${r.level}`);
});

test('classify: high swap escalates alone without free% dropping', () => {
  // 70% free, tiny swap -> normal. Same memory, swap 3GB -> severe.
  const relaxed = { ...base, free: 7000, active: 1000, inactive: 500, speculative: 0, wired: 1500, swapMB: 300 };
  assert.strictEqual(classify(relaxed).level, 0, '70% free + tiny swap = normal');
  const swapped = { ...relaxed, swapMB: 3000 };
  assert.ok(classify(swapped).level >= 3, 'swap>2GB must escalate without free% dropping');
});

test('classify: swap alone escalates at exactly 2048MB boundary', () => {
  const snap = { ...base, free: 7000, active: 1000, inactive: 500, speculative: 0, wired: 1500, swapMB: 2049 };
  assert.ok(classify(snap).level >= 3);
});

test('classify: 5% free -> level 4 terminal', () => {
  const snap = { ...base, free: 200, active: 8000, inactive: 500, speculative: 0, wired: 5000, swapMB: 6000 };
  const r = classify(snap);
  assert.strictEqual(r.level, 4);
  assert.strictEqual(r.reason, 'terminal');
});

test('live sample: reads real kernel state, returns sane numbers', () => {
  const s = sample();
  assert.ok(s.level >= 0 && s.level <= 4, `level ${s.level}`);
  assert.ok(s.freePct >= 0 && s.freePct <= 100);
  assert.ok(s.totalMB > 0, `totalMB ${s.totalMB}`);
  assert.ok(s.raw.vmStat.pageSize >= 4096, 'page size sane');
});

test('sample(): machine pressure never enters the discard-path level', () => {
  // A 16 GB machine pushed to L2 by Hermes/OmniRoute/other apps while the
  // browser itself is calm (3 tabs, ~900 MB). The extension can only discard
  // browser tabs, so the level it acts on must be the browser's own; the
  // machine number stays visible only as systemLevel for diagnostics.
  const live = sample('Brave Browser');
  assert.ok(typeof live.systemLevel === 'number',
    'systemLevel must stay exposed for diagnostics');
  assert.ok(typeof live.level === 'number', 'level stays numeric');
  assert.strictEqual(live.level, live.browserLevel,
    'discard-path level must equal the browser-owned level, not the machine one');
});

run();

// --- regression: the launchd daemon reported 0 swap and stayed "normal" -----
// Root causes: (1) vm_stat/sysctl were resolved off PATH, and launchd-spawned
// processes often have no /usr/sbin or /usr/bin; (2) the kernel's own pressure
// level was never consulted, so page-math alone could read "60% free" while
// the kernel was already swapping hard.
test('sample(): returns a NON-ZERO swap under a launchd-like PATH', () => {
  const s = sample();
  assert.ok(typeof s.swapMB === 'number' && Number.isFinite(s.swapMB),
    `swapMB must be a number, got ${s.swapMB}`);
  assert.ok(s.totalMB >= 1024, `totalMB should be a plausible RAM size, got ${s.totalMB}`);
});

test('sample(): reports the kernel memorystatus level', () => {
  const s = sample();
  // null is allowed only when the kernel knob is genuinely unavailable; on a
  // real Mac this must be a number in 1..4.
  if (s.kernelLevel !== null) {
    assert.ok(s.kernelLevel >= 1 && s.kernelLevel <= 5,
      `kernelLevel out of range: ${s.kernelLevel}`);
  }
});

test('classify(): kernel level overrides optimistic page math', () => {
  // 70% free by page math, but the kernel says level 4 (critical): must win.
  const snap = { pageSize: 16384, free: 7000, active: 1000, inactive: 800,
                 speculative: 0, wired: 1200, compressed: 0, purgeable: 0, swapMB: 500 };
  const r = classify(snap, 4);
  assert.strictEqual(r.level, 4);
  assert.strictEqual(r.reason, 'terminal');
});

test('classify(): page math still wins when the kernel is calm', () => {
  const snap = { pageSize: 16384, free: 7000, active: 1000, inactive: 800,
                 speculative: 0, wired: 1200, compressed: 0, purgeable: 0, swapMB: 100 };
  const r = classify(snap, 0);
  assert.strictEqual(r.level, 0);
});

test('classify(): a null kernel level never crashes classification', () => {
  const snap = { pageSize: 16384, free: 4500, active: 3000, inactive: 1000,
                 speculative: 0, wired: 1500, compressed: 0, purgeable: 0, swapMB: 300 };
  const r = classify(snap, null);
  assert.strictEqual(r.level, 1);
});

