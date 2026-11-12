// watchdog.js — storage-floor enforcement daemon (LaunchAgent-able).
// Polls disk; at 'trim' purges ONLY allow-listed paths; at 'stop' halts builds.
// HARD RULE: never delete anything unless its real path is under one of the
// roots below. Symlinks resolved first so a crafted link cannot escape.
// Runs headless; every action logged for audit.
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { evaluate } = require('./lib/quota.js');

const LOG = process.env.WATCHDOG_LOG || path.join(__dirname, 'watchdog.log');
const POLL_MS = parseInt(process.env.WATCHDOG_POLL_MS || '60000', 10);
const DRY_RUN = process.env.WATCHDOG_DRY_RUN === '1';
const STOP_FILE = '/Users/apple/Documents/brave-cemetery/brave-core/STOP';

// Allow-list mirrors PROTECT_LIST.yaml PURGE_SCOPE. The hard rule: any path NOT
// under one of these roots is undeletable by the watchdog, no matter the disk
// state. BUILD_HERE is where our own artifacts live; SCRATCH_OUT is disposable.
const BUILD_HERE  = '/Users/apple/Documents/brave-cemetery/build';
const OUT_HERE    = '/Users/apple/Documents/brave-cemetery/brave-core/out';
const SCRATCH_OUT = '/Users/apple/.hermes/cache/scratch/brave_ram/out';
const PURGEABLE_ROOTS = [
  BUILD_HERE, OUT_HERE, SCRATCH_OUT,
  '/tmp/hermes_headless_profile', '/tmp/gf_headless',
].map(p => require('path').resolve(p));

function log(line) {
  const s = `[${new Date().toISOString()}] ${line}`;
  fs.appendFileSync(LOG, s + '\n');
  console.log(s);
}

function disk() {
  const out = execFileSync('df', ['-k', '/'], { encoding: 'utf8' }).trim().split('\n')[1].trim().split(/\s+/);
  return { totalBytes: parseInt(out[1], 10) * 1024, freeBytes: parseInt(out[3], 10) * 1024 };
}

function isUnderPurgeable(p) {
  let real;
  try { real = fs.realpathSync(p); } catch (_) { real = require('path').resolve(p); }
  return PURGEABLE_ROOTS.some(r => real === r || real.startsWith(r + '/'));
}

function purgeDir(d) {
  if (!isUnderPurgeable(d)) { log(`REFUSE purge (not allow-listed): ${d}`); return 0; }
  if (!fs.existsSync(d)) return 0;
  const before = disk().freeBytes;
  if (DRY_RUN) { log(`DRY-RUN purge: ${d}`); return 0; }
  try {
    execFileSync('rm', ['-rf', d]);
    const freed = Math.max(0, disk().freeBytes - before);
    log(`purged ${d} (+${Math.round(freed / 1048576)}MB free)`);
    return freed;
  } catch (e) { log(`purge FAILED ${d}: ${e.message}`); return 0; }
}

function tick() {
  const q = evaluate(disk(), { floorPct: 15 });
  log(`disk free=${q.freeGB}GB (${q.freePct}%) level=${q.level}`);
  if (q.level === 'trim') {
    // purge deepest-first, then verify the floor is back to 'ok'
    for (const c of [...q.purgeCandidates, SCRATCH_OUT]) purgeDir(c);
    const after = evaluate(disk(), { floorPct: 15 });
    log(`post-purge free=${after.freeGB}GB level=${after.level}`);
  } else if (q.level === 'stop') {
    fs.writeFileSync(STOP_FILE, `watchdog: disk floor reached at ${new Date().toISOString()}\n`);
    log('STOP: below hard floor — build halted via STOP marker (purge limited to allow-list)');
  }
}

if (require.main === module) {
  log(`watchdog up (poll ${POLL_MS}ms, dry_run=${DRY_RUN}, roots=${PURGEABLE_ROOTS.length})`);
  tick();
  const iv = setInterval(tick, POLL_MS);
  process.on('SIGTERM', () => { clearInterval(iv); process.exit(0); });
  process.on('SIGINT', () => { clearInterval(iv); process.exit(0); });
}

module.exports = { tick, isUnderPurgeable, PURGEABLE_ROOTS, disk };
