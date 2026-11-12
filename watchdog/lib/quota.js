// quota.js — the 15% storage floor, enforced as pure logic.
'use strict';

/**
 * evaluate({ totalBytes, freeBytes, configuredFloorPct }) -> decision
 * Floor is a percentage (default 15). Decision:
 *   level: 'ok' | 'trim' | 'stop'
 *   trimCandidates: which dirs the watchdog may purge (allow-list only)
 */
const DEFAULT = { floorPct: 15, hardFloorPct: 12 };
const PURGE_ALLOWLIST = ['/brave-cemetery/build', '/brave-cemetery/out', '/hermes-headless-profile'];

function evaluate(disk, cfg) {
  const c = Object.assign({}, DEFAULT, cfg || {});
  const total = disk.totalBytes, free = disk.freeBytes;
  const totalGB = total / (1024 ** 3), freeGB = free / (1024 ** 3);
  const freePct = total > 0 ? (free / total) * 100 : 0;
  const floorGB = totalGB * (c.floorPct / 100);
  const hardGB = totalGB * (c.hardFloorPct / 100);

  let level = 'ok';
  if (freeGB < hardGB || freePct < c.hardFloorPct) level = 'stop';
  else if (freeGB < floorGB || freePct < c.floorPct) level = 'trim';

  return {
    level,
    freeGB: Math.round(freeGB * 10) / 10,
    totalGB: Math.round(totalGB * 10) / 10,
    freePct: Math.round(freePct * 10) / 10,
    floorGB: Math.round(floorGB),
    hardFloorGB: Math.round(hardGB),
    purgeCandidates: level === 'trim' ? PURGE_ALLOWLIST.slice() : [],
  };
}

module.exports = { evaluate, DEFAULT, PURGE_ALLOWLIST };
