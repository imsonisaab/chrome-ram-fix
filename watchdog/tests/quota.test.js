// tests: quota enforcement (15% floor) + real disk eval
'use strict';
const { test, run } = require('node:test');
const assert = require('node:assert');
const { evaluate } = require('../lib/quota.js');

const GB = 1024 ** 3;

test('20% free -> ok, no purge', () => {
  const r = evaluate({ totalBytes: 460 * GB, freeBytes: 92 * GB });
  assert.strictEqual(r.level, 'ok');
  assert.deepStrictEqual(r.purgeCandidates, []);
  assert.ok(r.freeGB >= r.floorGB);
});

test('exactly 15% free -> ok (boundary inclusive)', () => {
  const r = evaluate({ totalBytes: 460 * GB, freeBytes: 69 * GB });
  assert.strictEqual(r.level, 'ok', `expected ok at boundary, got ${r.level}`);
  assert.strictEqual(r.floorGB, 69);
});

test('14% free -> trim with allow-list', () => {
  const r = evaluate({ totalBytes: 460 * GB, freeBytes: 64 * GB });
  assert.strictEqual(r.level, 'trim');
  assert.ok(r.purgeCandidates.length > 0);
  assert.ok(r.purgeCandidates.every(p => p.includes('build') || p.includes('out') || p.includes('headless')),
    'purge must only target build outputs, never user data');
  assert.ok(r.purgeCandidates.includes('/brave-cemetery/build'));
});

test('10% free -> stop (below hard floor)', () => {
  const r = evaluate({ totalBytes: 460 * GB, freeBytes: 46 * GB });
  assert.strictEqual(r.level, 'stop');
});

test('custom floor 20% works', () => {
  const r = evaluate({ totalBytes: 460 * GB, freeBytes: 85 * GB }, { floorPct: 20 });
  assert.strictEqual(r.level, 'trim');
  assert.strictEqual(r.floorGB, 92);
});

test('live disk evaluate returns sane level on this Mac', () => {
  const { execFileSync } = require('child_process');
  // SAFE-BY-BOUNDARY: hardcoded argv, no interpolation; df only reads kernel stats.
  const line = execFileSync('df', ['-k', '/'], { encoding: 'utf8' }).trim().split('\n')[1].trim().split(/\s+/);
  const totalKB = parseInt(line[1], 10), freeKB = parseInt(line[3], 10);
  const r = evaluate({ totalBytes: totalKB * 1024, freeBytes: freeKB * 1024 });
  assert.ok(['ok', 'trim', 'stop'].includes(r.level));
  assert.ok(r.totalGB > 100, `totalGB ${r.totalGB}`);
  assert.ok(r.floorGB === 69, `floorGB should be 69 on 460GiB, got ${r.floorGB}`);
});

run();
