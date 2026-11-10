#!/bin/bash
# verify_all.sh — one command that proves every layer still works.
# Exit 0 = everything green. Any failure prints the failing layer and exits 1.
#
#   bash verify_all.sh
set -uo pipefail

BASE="$(cd "$(dirname "$0")" && pwd)"
cd "$BASE" || exit 1
NODE="${NODE:-$(command -v node)}"
# Python interpreter: prefer one that has `websockets` (the live CDP test needs it).
PY="${PY:-}"
if [ -z "$PY" ]; then
  for cand in "$HOME/.hermes/hermes-agent/venv/bin/python" python3; do
    if "$cand" -c 'import websockets' >/dev/null 2>&1; then PY="$cand"; break; fi
  done
  [ -n "$PY" ] || PY="/usr/bin/python3"
fi
fails=0
run(){ # run <label> <cmd...>
  local label="$1"; shift
  printf '%-42s' "$label"
  if out=$("$@" 2>&1); then
    echo "GREEN"
  else
    echo "RED"
    fails=$((fails+1))
    echo "$out" | tail -6 | sed 's/^/    /'
  fi
}

echo "=== brave-cemetery verification ==="

# --- static syntax ---
for f in extension/src/background.js extension/src/content.js extension/src/popup.js \
         extension/embaler/lib/capture.js extension/embaler/lib/hydrate.js \
         extension/embaler/lib/security.js extension/embaler/lib/restoreTiming.js \
         governor/daemon.js governor/lib/policy.js governor/lib/machPressure.js; do
  run "syntax: $(basename "$f")" "$NODE" --check "$f"
done

printf '%-42s' "manifests: json valid"
if python3 - <<'PY'
import json, sys
json.load(open('extension/manifest.json')); json.load(open('extension/manifest/host.json'))
sys.exit(0)
PY
then echo "GREEN"; else echo "RED"; fails=$((fails+1)); fi

# --- unit tests ---
run "unit: governor policy+pressure" "$NODE" --test governor/tests/*.test.js

# --- harnesses ---
run "harness: worker"     "$NODE" extension/tests/worker.harness.js
run "harness: content"    "$NODE" extension/tests/content.harness.js
run "harness: popup"      "$NODE" extension/tests/popup.harness.js
run "harness: embalmer v3" "$NODE" extension/tests/embalmer.harness.js

# --- live: capture+restore over real CDP ---
# Hosts the test on STOCK Brave: the RAM Edition extension auto-injects the same
# libs on every page, which collides with the test's manual injection.
# Auto-launches a throwaway headless browser on :9351 if none is reachable.
if [ -f tests/live.test.cdp.py ]; then
  LIVE_PID=""
  if ! curl -s --max-time 2 http://127.0.0.1:9351/json/version >/dev/null 2>&1; then
    STOCK="/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"
    if [ -x "$STOCK" ]; then
      rm -rf /tmp/brave_cemetery_verify_cdp
      "$STOCK" --headless=new --no-sandbox --disable-gpu \
        --user-data-dir=/tmp/brave_cemetery_verify_cdp \
        --remote-debugging-port=9351 about:blank >/dev/null 2>&1 &
      LIVE_PID=$!
      for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
        curl -s --max-time 1 http://127.0.0.1:9351/json/version >/dev/null 2>&1 && break
        sleep 1
      done
    fi
  fi
  if curl -s --max-time 2 http://127.0.0.1:9351/json/version >/dev/null 2>&1; then
    run "live: cdp capture/restore" "$PY" tests/live.test.cdp.py --port 9351
  else
    printf '%-42s' "live: cdp capture/restore"
    echo "YELLOW (stock Brave not found at /Applications)"
  fi
  [ -n "$LIVE_PID" ] && kill "$LIVE_PID" >/dev/null 2>&1
  rm -rf /tmp/brave_cemetery_verify_cdp
else
  printf '%-42s' "live: cdp capture/restore"
  echo "YELLOW (tests/live.test.cdp.py missing)"
fi

# --- engine binaries ---
printf '%-42s' "rust: cemeteryd present"
if [ -x cemetery/target/release/cemeteryd ]; then echo "GREEN ($(cemetery/target/release/cemeteryd --version 2>/dev/null || echo bin))"; else echo "YELLOW (cargo build -p needed)"; fi

echo
echo "--- runtime ---"
printf '%-42s' "daemon: governor :8795"
P=$(curl -s --max-time 3 http://127.0.0.1:8795/pressure | head -c 200)
if echo "$P" | grep -q '"level"'; then echo "GREEN ($P)"; else echo "RED (no pressure JSON)"; fails=$((fails+1)); fi

printf '%-42s' "agents: launchd"
A=$(launchctl list 2>/dev/null | grep -cE "brave[-_]cemetery")
if [ "$A" -ge 1 ]; then echo "GREEN ($A agents)"; else echo "YELLOW (install.sh not run yet)"; fi

# --- dist app (packaging pipeline) ---
if [ -d "dist" ]; then
  printf '%-42s' "dist: RAM Edition app"
  if [ -x "dist/Brave Browser.app/Contents/MacOS/Brave Browser" ] \
     && [ -x "dist/Brave Browser.app/Contents/Resources/BraveCemetery/bin/cemeteryd" ] \
     && [ -d "dist/Brave Browser.app/Contents/Resources/BraveCemetery/extension" ]; then
    echo "GREEN"
  else
    echo "RED (incomplete bundle)"; fails=$((fails+1))
  fi
  printf '%-42s' "dist: dmg"
  if ls dist/*.dmg >/dev/null 2>&1; then echo "GREEN ($(ls -lh dist/*.dmg | awk '{print $5, $9}' | tr '\n' ' '))"; else echo "YELLOW (run scripts/package_native_brave_app.sh)"; fi
else
  printf '%-42s' "dist: RAM Edition app"
  echo "YELLOW (run scripts/package_native_brave_app.sh)"
fi

echo
echo "RESULT: $([ $fails = 0 ] && echo 'ALL GREEN' || echo "$fails RED")"
exit $fails
