#!/bin/bash
# overnight.sh — the one command that carries this project to the deliverable.
#
#   bash overnight.sh            # foreground, logs to brave-core/overnight.log
#   bash overnight.sh --bg &     # background; survives this terminal
#
# Chain: sync (retry+resume) -> npm deps -> gn gen -> autoninja -> zip
# Every step is idempotent, so a crash/reboot/drop resumes from where it stopped.
set -uo pipefail

BASE="/Users/apple/Documents/chrome-cemetery"
SRC="$BASE/src"
LOG="$BASE/overnight.log"
STOP="$BASE/STOP"
# 10GB is the real emergency line. The old 69GB floor was sized for the
# download alone, but checkout expansion (~30GB) + out/ (~10GB) drive free to
# ~37GB mid-build, so a 69GB floor would have killed a healthy chain.
FREE_FLOOR_KB=$((10 * 1024 * 1024))

say(){ echo "[$(date '+%F %T')] $*" | tee -a "$LOG"; }
stop(){ say "STOP: $*"; echo "$*" > "$STOP"; exit 1; }
chk(){ local k; k=$(df -k / | tail -1 | awk '{print $4}'); [ "$k" -lt "$FREE_FLOOR_KB" ] && stop "free $(($k/1024/1024))GB < 69GB floor"; }

# run_with_retry <label> <max_attempts> <cmd...>
run_with_retry(){
  local label="$1" max="$2"; shift 2
  local a=0 wait=30
  while :; do
    a=$((a+1))
    say "$label (attempt $a/$max)"
    "$@" >>"$LOG" 2>&1 && { say "$label: OK"; return 0; }
    [ "$a" -ge "$max" ] && { say "$label gave up after $a attempts"; return 1; }
    say "$label failed; retry in ${wait}s"; sleep "$wait"; wait=$((wait*2)); chk
  done
}

say "=== OVERNIGHT START $(date '+%F %T') ==="
rm -f "$STOP" "$SRC/sync.status"

# ---- STEP 1: daemons (governor :8795 / watchdog / scheduler) ---------------
say "step 1/5: daemons"
bash "$BASE/install_agents.sh" >>"$LOG" 2>&1 || say "WARN: install_agents had errors (see log)"
chk

# ---- STEP 2: source sync ---------------------------------------------------
say "step 2/5: source sync (this is the mult-GB, resumable step)"
run_with_retry "gclient sync" 8 bash "$BASE/sync_brave.sh" || stop "sync gave up"
[ -f "$SRC/sync.status" ] || stop "sync did not report DONE"
chk

# ---- STEP 3: compile --------------------------------------------------------
say "step 3/5: compile (gn gen + npm pre-builds + autoninja)"
export PATH="$SRC/third_party/depot_tools:$PATH"
run_with_retry "build_brave.sh" 3 bash "$BASE/build_brave.sh" || stop "build gave up"
chk

# ---- STEP 4: verify the artifact exists and is not empty -------------------
DIST="$BASE/dist/Brave-Browser-arm64.zip"
[ -f "$DIST" ] || stop "no artifact at $DIST"
SZ=$(du -sh "$DIST" | cut -f1)
say "step 4/5: artifact $DIST ($SZ)"

# ---- STEP 5: is the .app actually a Brave? (acceptance gate) ---------------
APP_PATH="$BASE/brave-core/src/out/Release/Brave Browser.app"
say "step 4b: acceptance gate on $APP_PATH"
bash "$BASE/accept_app.sh" "$APP_PATH" >>"$LOG" 2>&1 \
  && say "APP ACCEPTED by accept_app.sh" \
  || say "APP REJECTED by accept_app.sh — see $LOG for the failing check"

# ---- STEP 6: regression (every layer, one command) ------------------------
say "step 6/6: verification (verify_all.sh)"
# verify_all.sh runs node suites + all harnesses + e2e + live CDP + scheduler +
# the live daemon and launchd agents, and exits non-zero if any layer is red.
bash "$BASE/verify_all.sh" >>"$LOG" 2>&1 || say "WARN: verification saw RED checks (see log)"

say "=== OVERNIGHT COMPLETE: deliverable ready ==="
say "deliverable: $DIST ($SZ)"
say "regression results are in $LOG (WARN lines, if any, are above)"
df -h / | tail -1 | tee -a "$LOG"
