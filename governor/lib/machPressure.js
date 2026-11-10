// Governor v0.1 — macOS memory-pressure reader (kernel truth)
// Chromium's own memory-pressure signal is disabled by design on macOS, so the
// Governor synthesises one from two always-available kernel sources:
//   vm_stat                    -> page counts (free/inactive/active/wired)
//   sysctl vm.swapusage        -> swap committed (early pressure signal)
// Level model mirrors memory_pressure(8) reporting:
//   0 normal, 1 warn, 2 critical, 3 severe, 4 terminal
'use strict';
const { execFileSync } = require('child_process');

// launchd/WindowServer-spawned processes get a minimal PATH that frequently
// omits /usr/sbin and /usr/bin. Resolve the kernel tools by absolute path and
// verify executability once, so swap/pressure is never silently 0.
const FIRST_EXISTING = (cands) => cands.find((p) => {
  try { execFileSync('/bin/test', ['-x', p], { stdio: 'ignore' }); return true; } catch (_) { return false; }
});
const VM_STAT_BIN = FIRST_EXISTING(['/usr/bin/vm_stat', '/usr/sbin/vm_stat']);
const SYSCTL_BIN = FIRST_EXISTING(['/usr/sbin/sysctl', '/usr/bin/sysctl']);
const MEMORY_PRESSURE_BIN = FIRST_EXISTING(['/usr/bin/memory_pressure', '/usr/sbin/memory_pressure']);
const SWAP_FLOOR_MB = parseInt(process.env.GOVERNOR_SWAP_FLOOR_MB || '0', 10) || 0;

function vmStat() {
  if (!VM_STAT_BIN) return { pageSize: 16384, free: 0, active: 0, inactive: 0, speculative: 0, wired: 0, compressed: 0, purgeable: 0, missing: true };
  const out = execFileSync(VM_STAT_BIN, [], { encoding: 'utf8', timeout: 4000 });
  const pageSize = /page size of (\d+) bytes/.exec(out);
// macOS 13+ vm_stat prints "Pages free:" with whitespace padding (not \t).
// Accept both "Pages free:   123." and "Pages free:\t123".
const PAGE_RE = (label) => new RegExp(`Pages ${label}:\\s+(\\d+)`);
  const num = (re) => { const m = re.exec(out); return m ? parseInt(m[1].replace(/\./g, ''), 10) : 0; };
  return {
    pageSize: pageSize ? parseInt(pageSize[1], 10) : 16384,
    free:        num(PAGE_RE('free')),
    active:      num(PAGE_RE('active')),
    inactive:    num(PAGE_RE('inactive')),
    speculative: num(PAGE_RE('speculative')),
    wired:       num(PAGE_RE('wired down')),
    compressed:  num(PAGE_RE('occupied by compressor')),
    purgeable:   num(PAGE_RE('purgeable')),
  };
}

function swapUsage() {
  try {
    if (!SYSCTL_BIN) return { usedMB: 0, missing: true };
    const out = execFileSync(SYSCTL_BIN, ['-n', 'vm.swapusage'], { encoding: 'utf8', timeout: 4000 });
    // "total = 2048.00M  used = 1536.00M  free = 512.00M (encrypted)"
    const used = /used = ([\d.]+)([MG])/.exec(out);
    if (!used) return { usedMB: 0, missing: true };
    const mb = parseFloat(used[1]) * (used[2] === 'G' ? 1024 : 1);
    // Some containers report the value in KB even though the letter says M.
    const fixed = mb > 1048576 ? mb / 1024 : mb;
    return { usedMB: Math.max(fixed, SWAP_FLOOR_MB) };
  } catch (_) { return { usedMB: SWAP_FLOOR_MB }; }
}

// Real kernel pressure, read from the kernel's own memorystatus knob.
// memory_pressure(8) only reports stats on macOS — it has no read-only "what is
// the level right now" mode. kern.memorystatus_vm_pressure_level is the live
// value the kernel itself maintains (1 normal .. 4 critical).
function kernelPressureLevel() {
  try {
    if (!SYSCTL_BIN) return null;
    const out = execFileSync(SYSCTL_BIN, ['-n', 'kern.memorystatus_vm_pressure_level'], { encoding: 'utf8', timeout: 4000 });
    const n = parseInt(String(out).trim(), 10);
    return Number.isFinite(n) ? n : null;
  } catch (_) { return null; }
}

/**
 * classify(raw) -> { level, freePct, swapMB, reason }
 * Pure. Thresholds are calibrated for a 16GB M1 Pro running a browser:
 *   >=60% free            -> 0 normal
 *   35-60% free           -> 1 warn      (start backgrounding caches)
 *   15-35% free           -> 2 critical  (discard coldest tabs)
 *   <15% free OR swap>2G  -> 3 severe    (discard aggressively + tell extension)
 *   <8% free OR swap>4G   -> 4 terminal  (emergency: flush everything discardable)
 */
function classify(snap, kLevel) {
  const total = snap.free + snap.active + snap.inactive + snap.speculative + snap.wired + SnapSafe(snap.compressed);
  const usable = snap.free + snap.inactive + snap.speculative + SnapSafe(snap.purgeable);
  const freePct = total > 0 ? Math.round((usable / total) * 100) : 0;
  let level = 0, reason = 'normal';
  if (freePct < 8 || snap.swapMB > 4096) { level = 4; reason = 'terminal'; }
  else if (freePct < 15 || snap.swapMB > 2048) { level = 3; reason = 'severe'; }
  else if (freePct < 35) { level = 2; reason = 'critical'; }
  else if (freePct < 60) { level = 1; reason = 'warn'; }
  // Kernel pressure from memory_pressure(8) is authoritative when available;
  // page math alone reads "60% free" while the kernel is already swapping hard.
  const kernel = typeof kLevel === 'number' ? kLevel : null;
  if (kernel !== null && kernel > level) {
    level = Math.min(kernel, 4);
    reason = ['normal', 'warn', 'critical', 'severe', 'terminal'][level] || reason;
  }
  return { level, freePct, swapMB: Math.round(snap.swapMB), reason, totalMB: Math.round(total * snap.pageSize / 1048576) };
}
function SnapSafe(n) { return typeof n === 'number' ? n : 0; }

function sample() {
  const vs = vmStat();
  const sw = swapUsage();
  const kLevel = kernelPressureLevel();
  const out = Object.assign(classify({ ...vs, swapMB: sw.usedMB }, kLevel), { raw: { vmStat: vs, swap: sw, kernelLevel: kLevel } });
  out.kernelLevel = kLevel;
  return out;
}

/* UMD footer: same file works in Node (require) and as a browser script.
   In a browser the exported names land on window. */
;(function (g) {
  var ex = { vmStat, swapUsage, classify, sample, kernelPressureLevel };
  if (typeof module !== 'undefined' && module.exports) { module.exports = ex; }
  else { g.__UmdBundle = Object.assign(g.__UmdBundle || {}, ex); }
})(typeof globalThis !== 'undefined' ? globalThis : this);
