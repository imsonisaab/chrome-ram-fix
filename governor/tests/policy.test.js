// tests: Governor discard policy
'use strict';
const { test, run } = require('node:test');
const assert = require('node:assert');
const { decide, prewarm } = require('../lib/policy.js');

const NOW = 1_700_000_000_000;
function tab(id, lastActiveAt, rss, extra) {
  return Object.assign({ id, url: 'https://x.test/' + id, title: id, lastActiveAt, rssMB: rss }, extra || {});
}
// coldest = smallest lastActiveAt
const tabs = [
  tab('a', NOW - 60000, 400),      // very cold
  tab('b', NOW - 30000, 200),
  tab('c', NOW - 10000, 200),
  tab('d', NOW - 1000, 100),       // active
  tab('pinned', NOW - 90000, 100, { pinned: true }),
  tab('music', NOW - 80000, 100, { audible: true }),
];

test('level 0/1 -> no actions', () => {
  for (const lvl of [0, 1]) {
    const r = decide({ level: lvl, freePct: 70, swapMB: 100, reason: 'x' }, tabs, { now: NOW, activeTabId: 'd' });
    assert.strictEqual(r.actions.length, 0, `level ${lvl}`);
    assert.strictEqual(r.reason, 'no-discard');
  }
});

test('level 2 -> only coldest, ~25% of RSS', () => {
  const r = decide({ level: 2, freePct: 25, swapMB: 500, reason: 'critical' }, tabs, { now: NOW, activeTabId: 'd' });
  const ids = r.actions.map(a => a.tabId);
  assert.deepStrictEqual(ids, ['a'], `expected coldest only, got ${ids}`);
  assert.strictEqual(r.projectedReclaimMB, 400);
  assert.ok(!ids.includes('d'), 'active tab never discarded');
  assert.ok(!ids.includes('pinned'), 'pinned never discarded');
  assert.ok(!ids.includes('music'), 'audible never discarded');
});

test('level 3 -> aggressive: hits ~60% target, still protects active/pinned/audible', () => {
  const r = decide({ level: 3, freePct: 12, swapMB: 2500, reason: 'severe' }, tabs, { now: NOW, activeTabId: 'd' });
  const ids = r.actions.map(a => a.tabId);
  assert.ok(ids.includes('a') && ids.includes('b'), `expected a+b, got ${ids}`);
  assert.ok(!ids.includes('d') && !ids.includes('pinned') && !ids.includes('music'));
  assert.ok(r.projectedReclaimMB >= 360, `projected ${r.projectedReclaimMB}`);
});

test('level 4 -> discards every eligible tab', () => {
  const r = decide({ level: 4, freePct: 5, swapMB: 5000, reason: 'terminal' }, tabs, { now: NOW, activeTabId: 'd' });
  const ids = r.actions.map(a => a.tabId);
  assert.deepStrictEqual(ids, ['a', 'b', 'c'], `expected all eligible, got ${ids}`);
  assert.strictEqual(r.projectedReclaimMB, 800);
});

test('protectedUrls (mid-edit forms) are never discarded', () => {
  const r = decide({ level: 4, freePct: 4, swapMB: 6000, reason: 'terminal' }, tabs, {
    now: NOW, activeTabId: 'd', protectedUrls: ['https://x.test/a'],
  });
  const ids = r.actions.map(a => a.tabId);
  assert.ok(!ids.includes('a'), 'form-holding url must survive even level 4');
  assert.ok(ids.includes('b') && ids.includes('c'));
});

test('prewarm: proximity events map to discarded tabs, closest first', () => {
  const discarded = [{ id: 'x', windowIndex: 3, url: 'https://x.test/x' }, { id: 'y', windowIndex: 7, url: 'https://x.test/y' }];
  const r = prewarm([
    { type: 'proximity', index: 7, distanceMs: 90 },
    { type: 'proximity', index: 3, distanceMs: 400 },
  ], discarded);
  const high = r.find(p => p.priority === 'high');
  assert.ok(high && high.tabId === 'y', `closest should be high, got ${JSON.stringify(r)}`);
  assert.strictEqual(r.length, 2);
});

// ---- real-world night scenario (verified live on this Mac) ----------------
const NIGHT_TABS = [
  { id: 1, url: 'https://gymflow-3svy.onrender.com/dashboard', rssMB: 180, lastActiveAt: Date.now() - 3 * 3600e3 },
  { id: 2, url: 'https://www.youtube.com/watch?v=I4kB3onwjpw', rssMB: 210, lastActiveAt: Date.now() - 2 * 3600e3 },
  { id: 3, url: 'https://chatgpt.com/c/68a', rssMB: 340, lastActiveAt: Date.now() - 4 * 3600e3 },
  { id: 4, url: 'https://web.whatsapp.com/', audible: true, rssMB: 110, lastActiveAt: Date.now() - 5 * 3600e3 },
  { id: 5, url: 'https://roblox.com/games/x', audible: true, rssMB: 260, lastActiveAt: Date.now() - 5 * 3600e3 },
  { id: 6, url: 'https://mail.google.com/mail/u/0/#inbox', rssMB: 130, lastActiveAt: Date.now() - 6 * 3600e3 },
  { id: 7, url: 'http://localhost:3000/settings', rssMB: 90, lastActiveAt: Date.now() - 10 * 3600e3 },
];
function night(level) {
  return decide({ level, freePct: [80, 45, 25, 10, 5][level], swapMB: level * 1500, reason: 'test' },
    NIGHT_TABS, { now: Date.now(), activeTabId: 3 });
}
test('real-night L0/L1: no discards when healthy', () => {
  assert.deepStrictEqual(night(0).actions, []);
  assert.deepStrictEqual(night(1).actions, []);
});
test('real-night: audible WhatsApp + Roblox never discarded at any level', () => {
  for (const lvl of [0, 1, 2, 3, 4]) {
    const ids = night(lvl).actions.map(a => a.tabId);
    assert.ok(!ids.includes(4), `whatsapp discarded at L${lvl}`);
    assert.ok(!ids.includes(5), `roblox discarded at L${lvl}`);
  }
});
test('real-night: active tab never discarded at any level', () => {
  for (const lvl of [0, 1, 2, 3, 4]) {
    assert.ok(!night(lvl).actions.map(a => a.tabId).includes(3), `active tab 3 at L${lvl}`);
  }
});
test('real-night: escalation L2 -> L4 grows reclaim, coldest first', () => {
  const ids = lvl => night(lvl).actions.map(a => a.tabId);
  assert.deepStrictEqual(ids(2), [7, 6]);
  assert.deepStrictEqual(ids(3), [7, 6, 1]);
  assert.deepStrictEqual(ids(4), [7, 6, 1, 2]);
  assert.ok(night(4).projectedReclaimMB > night(3).projectedReclaimMB);
  assert.ok(night(3).projectedReclaimMB > night(2).projectedReclaimMB);
});

run();
