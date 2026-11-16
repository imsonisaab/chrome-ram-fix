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

// ---- minimum open tabs guard (user directive, 2026-11) ---------------------
// "With only 2 tabs open... never discard anything." A handful of live tabs is
// the user's current work, not reclaimable background furniture.
function twoTabs() {
  return [
    tab('a', NOW - 60000, 400),
    tab('b', NOW - 30000, 200),
  ];
}
test('too-few-tabs: <=5 live tabs never discarded, even at L4', () => {
  for (const lvl of [2, 3, 4]) {
    const r = decide({ level: lvl, freePct: 5, swapMB: 6000, reason: 'terminal' },
      twoTabs(), { now: NOW });
    assert.strictEqual(r.actions.length, 0, `level ${lvl} discarded with 2 tabs`);
    assert.match(r.reason, /too-few-tabs/);
  }
});
test('too-few-tabs: 5 tabs is still too few, 6 is the floor', () => {
  const five = [1, 2, 3, 4, 5].map(i => tab('t' + i, NOW - 60000 * i, 300));
  const r5 = decide({ level: 4, freePct: 5, swapMB: 6000, reason: 'terminal' }, five, { now: NOW });
  assert.strictEqual(r5.actions.length, 0, '5 tabs must be left alone');
  assert.strictEqual(r5.reason, 'too-few-tabs (5/6)');

  const six = [1, 2, 3, 4, 5, 6].map(i => tab('t' + i, NOW - 60000 * i, 300));
  const r6 = decide({ level: 4, freePct: 5, swapMB: 6000, reason: 'terminal' }, six, { now: NOW });
  assert.strictEqual(r6.actions.length, 6, '6+ tabs: normal policy resumes');
  assert.ok(!/too-few-tabs/.test(r6.reason));
});
test('too-few-tabs: discarded tabs do not count toward the floor', () => {
  // 8 tabs, 3 already discarded -> 5 live -> nothing may be discarded.
  const mixed = [...[1, 2, 3, 4, 5, 6, 7, 8].map(i => tab('t' + i, NOW - 60000 * i, 300))];
  mixed[0].discarded = true; mixed[1].discarded = true; mixed[2].discarded = true;
  const r = decide({ level: 4, freePct: 5, swapMB: 6000, reason: 'terminal' }, mixed, { now: NOW });
  assert.strictEqual(r.actions.length, 0, 'only 5 live tabs -> no discard');
  assert.match(r.reason, /too-few-tabs/);
});
test('too-few-tabs guard is overridable only by explicit opt-out', () => {
  const r = decide({ level: 4, freePct: 5, swapMB: 6000, reason: 'terminal' },
    twoTabs(), { now: NOW, minTabsBeforeDiscard: 0 });
  assert.strictEqual(r.actions.length, 2, 'explicit 0 restores the old behaviour');
});

// ---- audio grace (streaming tab that went quiet) ---------------------------
test('recently audible tab is protected for audioGraceMs, even at L4', () => {
  const six = [1, 2, 3, 4, 5, 6].map(i =>
    tab('t' + i, NOW - 60000 * i, 300, i === 3 ? { lastAudioAt: NOW - 3 * 60 * 1000 } : null));
  const r = decide({ level: 4, freePct: 5, swapMB: 6000, reason: 'terminal' },
    six, { now: NOW, audioGraceMs: 10 * 60 * 1000 });
  assert.strictEqual(r.actions.length, 5, 'audio tab survives, others go');
  assert.ok(!r.actions.map(a => a.tabId).includes('t3'));
});
test('audio grace expires: 15-min-old audio does not protect at L4', () => {
  const six = [1, 2, 3, 4, 5, 6].map(i =>
    tab('t' + i, NOW - 60000 * i, 300, i === 3 ? { lastAudioAt: NOW - 15 * 60 * 1000 } : null));
  const r = decide({ level: 4, freePct: 5, swapMB: 6000, reason: 'terminal' },
    six, { now: NOW, audioGraceMs: 10 * 60 * 1000 });
  assert.strictEqual(r.actions.length, 6, 'grace window has passed');
});


  // ---- live-session guards are independent of `pinned` ----------------------
  // Regression: background.js folded liveUrl / liveSocket / busyDom /
  // audioRecent into the `pinned` flag, so a user who turned OFF pin
  // protection also lost every live-session guard -- an AI tab mid-generation
  // and a streaming tab both became discardable again. Each guard is now its
  // own field and the policy refuses on ANY of them, whatever `pinned` says.
  test('liveUrl tab survives L4 even when pinned is false', () => {
    const six = [1, 2, 3, 4, 5, 6].map(i => tab('t' + i, NOW - 60000 * i, 300));
    six[2].liveUrl = true;
    const r = decide({ level: 4, freePct: 5, swapMB: 6000, reason: 'terminal' }, six, { now: NOW });
    assert.ok(!r.actions.map(a => a.tabId).includes('t3'), 'live-URL tab must survive');
    assert.strictEqual(r.actions.length, 5, 'the other five go');
  });

  test('liveGuard alone protects a tab with pinned false and no URL match', () => {
    const six = [1, 2, 3, 4, 5, 6].map(i => tab('t' + i, NOW - 60000 * i, 300));
    six[1].pinned = false;
    six[1].liveGuard = true;
    const r = decide({ level: 4, freePct: 5, swapMB: 6000, reason: 'terminal' }, six, { now: NOW });
    assert.ok(!r.actions.map(a => a.tabId).includes('t2'), 'liveGuard must protect');
  });

  test('busyDom / liveSocket / audioRecent / typedRecently each protect alone', () => {
    const fields = ['busyDom', 'liveSocket', 'audioRecent', 'typedRecently'];
    for (const field of fields) {
      const six = [1, 2, 3, 4, 5, 6].map(i => tab('t' + i, NOW - 60000 * i, 300));
      six[0][field] = true;
      six[0].pinned = false;
      const r = decide({ level: 4, freePct: 5, swapMB: 6000, reason: 'terminal' }, six, { now: NOW });
      assert.ok(!r.actions.map(a => a.tabId).includes('t1'),
        field + ' alone must protect, independent of pinned');
      assert.strictEqual(r.actions.length, 5, field + ' protects exactly one tab');
    }
  });

  test('turning off pin protection does not remove live guards', () => {
    const six = [1, 2, 3, 4, 5, 6].map(i => tab('t' + i, NOW - 60000 * i, 300));
    six[4].liveUrl = true;
    six[4].pinned = false;
    const r = decide({ level: 4, freePct: 5, swapMB: 6000, reason: 'terminal' }, six, { now: NOW });
    assert.ok(!r.actions.map(a => a.tabId).includes('t5'),
      'liveUrl still protects when pinned is explicitly false');
  });


run();
