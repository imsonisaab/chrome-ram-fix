#!/bin/bash
# chain_watch.sh — keep the overnight chain alive. If any process in the chain
# (overnight.sh -> sync_brave.sh -> gclient -> git) dies, restart from the right
# step. Cheap: one check a minute, no polling loops that burn tokens.
BASE="/Users/apple/Documents/chrome-cemetery"
LOG="$BASE/chain_watch.log"
STOP="$BASE/STOP"
[ -f "$STOP" ] && exit 0
say(){ echo "[$(date '+%F %T')] $*" >> "$LOG"; }

alive(){ pgrep -f "$1" >/dev/null 2>&1; }

# THE CHAIN IS ALIVE EVEN WITH NO overnight.sh: an orphaned init.js/gclient
# keeps working after a conductor dies (verified live: killing the conductor at
# 13:26 left init.js 20123 -> sync.js -> gclient 20289 -> git clone 94191 still
# downloading at 5.4 MiB/s). Relaunching a conductor in that state spawns a
# SECOND gclient and a second full chromium clone. So the guard is: any live
# process in the chain means wait, not launch.
#
# Self-match discipline: pgrep -f "overnight.sh" run from a shell whose own
# cmdline names that script matches ITSELF. Every pattern here is bracketed.
for proc in '[o]vernight.sh' '[s]ync_brave.sh' '[n]pm run init' '[i]nit.js' '[s]ync.js --init' '[g]client.py' '[a]utoninja'; do
  if alive "$proc"; then
    case "$proc" in
      *overnight*) say "chain alive ($proc) — nothing to do" ;;
      *gclient*)   say "orphaned gclient still syncing — waiting, not relaunching (a new conductor would spawn a duplicate clone)" ;;
      *sync_brave*|*'npm run init'*|*init.js*|*sync.js*) say "orphaned sync process alive ($proc) — waiting, not relaunching" ;;
      *autoninja*) say "build already running — waiting" ;;
    esac
    exit 0
  fi
done
say "overnight.sh not running"
if [ -f "$BASE/dist/Brave-Browser-arm64.zip" ]; then
  say "deliverable already exists, standalone"; exit 0
fi
# sync.status may never appear when the sync_brave.sh parent died (verified:
# the orphan tree's npm-run-sync has PPID 1, so line 94 of sync_brave.sh never
# runs). Detect completion independently: the chromium solution landed on disk
# and nothing is downloading any more.
CHROMIUM="$BASE/brave-core/src/src/.git"
if [ -f "$BASE/sync.status" ] || { [ -d "$CHROMIUM" ] && ! alive '[g]client.py'; }; then
  if [ -f "$BASE/sync.status" ]; then
    say "sync.status present -> resuming at build"
  else
    [ -d "$CHROMIUM" ] && say "chromium checkout landed and gclient is gone -> treating sync as complete, resuming at build"
    [ -f "$BASE/sync.status" ] && rm -f "$BASE/sync.status"
  fi
  if alive "[a]utoninja"; then say "build already running — waiting"; exit 0; fi
  nohup bash -c "export PATH=/Users/apple/.hermes/tools/node-26.7.0-darwin-arm64/bin:\$PATH; bash '$BASE/build_brave.sh'" >> "$BASE/build.log" 2>&1 &
  exit 0
fi
# Killing a conductor WITHOUT killing its sync_brave.sh child leaves an orphan
# that keeps retrying and spawns duplicate chromium clones (seen twice this
# session). So: never pkill a bare script name — trace the tree first.
# Self-match trap: pgrep -f "overnight.sh" from a shell whose own command line
# contains that string matches ITSELF. Use [o]vernight.sh or ps aux + grep to
# confirm a kill actually landed.

# A live gclient means the DOWNLOAD is still running even though no conductor
# exists (I killed the conductor while gclient kept going). Starting a new
# conductor here makes init.js spawn a SECOND gclient -> a second full chromium
# clone in a different temp dir (seen live: 12GB + 1.5GB in parallel, bandwidth
# split). So: wait for gclient, do not relaunch.
say "resuming from sync"
nohup bash "$BASE/overnight.sh" >> "$BASE/overnight.stdout.log" 2>&1 &
exit 0
