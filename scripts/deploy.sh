#!/bin/bash
# deploy.sh — push the repo's governor/engine/extension sources to every place
# that actually runs them, then restart what needs a restart.
#
# WHY: there are FOUR copies of the engine:
#   1. <repo>/governor/lib/machPressure.js            — source of truth
#   2. <repo>/extension/governor/lib/machPressure.js  — what the SW imports
#   3. $ENGINE_ROOT/governor/lib/machPressure.js      — launchd runs THIS
#   4. <repo>/dist/.../extension/                     — packaged app's copy
# launchd is TCC-denied in ~/Documents, so the daemon MUST run from Application
# Support. Patching the repo alone changes nothing live until mirrored here.
set -euo pipefail

BASE="/Users/apple/Documents/chrome-cemetery"
ENGINE_ROOT="$HOME/Library/Application Support/ChromeRAMFix/engine"
NODE="/Users/apple/.hermes/tools/node-26.7.0-darwin-arm64/bin/node"

say() { printf '%s %s\n' "$(date '+%H:%M:%S')" "$*"; }

# 1. extension/ is the source of truth for libs (the SW imports it); push it
#    DOWN into governor/ so the repo has one copy, not two diverging ones.
for f in machPressure.js policy.js; do
  cp -f "$BASE/extension/governor/lib/$f" "$BASE/governor/lib/$f"
done
say "repo copies synced"

# 2. mirror to the launchd-run engine root (TCC-safe location)
mkdir -p "$ENGINE_ROOT/governor/lib" "$ENGINE_ROOT/extension/governor/lib"
cp -Rf "$BASE/governor/."  "$ENGINE_ROOT/governor/"
cp -Rf "$BASE/extension/." "$ENGINE_ROOT/extension/"
say "mirrored to Application Support"

# 3. syntax-check before restart
for f in "$BASE/governor/daemon.js" "$BASE/governor/lib/"*.js "$BASE/extension/governor/lib/"*.js; do
  "$NODE" --check "$f"
done
say "syntax OK"

# 4. restart governor so it re-reads machPressure.js (KeepAlive respawns it)
PID="$(pgrep -f "$ENGINE_ROOT/governor/daemon.js" | head -1 || true)"
if [ -n "$PID" ]; then
  say "restarting governor (pid $PID)"
  kill "$PID"
  for _ in $(seq 10); do
    sleep 1
    curl -s --max-time 2 http://127.0.0.1:8795/pressure >/dev/null 2>&1 && break
  done
fi

say "live: $(curl -s --max-time 3 http://127.0.0.1:8795/pressure || echo '(no response)')"
say "DONE"
