#!/bin/bash
# install_agents.sh — install governor/watchdog/scheduler daemons as LaunchAgents
# so they survive reboots (his Mac reboots; his build must not need him).
# Idempotent: re-running rewrites + reloads the same files.
set -euo pipefail

BASE="/Users/apple/Documents/chrome-cemetery"
AGENTS="$HOME/Library/LaunchAgents"
NODE="/Users/apple/.hermes/tools/node-26.7.0-darwin-arm64/bin/node"
PY="/usr/bin/python3"
# launchd-spawned processes are TCC-denied in ~/Documents, so the Level-3
# scheduler (which reads/writes files) runs from Application Support.
L3_APP="/Users/apple/Library/Application Support/LEVEL_3"
mkdir -p "$AGENTS" "$BASE/logs" "$(dirname "$L3_APP")"

# launchd-spawned processes are TCC-denied in ~/Documents (verified: bash fails
# with 'Operation not permitted' and python with errno 1), so every file a
# LaunchAgent must EXECUTE lives in Application Support. Documents keeps the
# canonical copy; this script mirrors it on each install.
mkdir -p "$L3_APP"
cp "$L3_APP/copy-src.sh" /dev/null 2>/dev/null || true
for f in agent_scheduler.py config.yaml bridge.py; do
  cp "/Users/apple/Documents/LEVEL_3/$f" "$L3_APP/$f"
done
cp "$BASE/chain_watch.sh" "$L3_APP/chain_watch.sh"
chmod +x "$L3_APP/chain_watch.sh"
# watchdog.js and its lib must sit together (they resolve each other by
# relative path); rewrite the require so the mirrored copy finds the lib.
rm -rf "$L3_APP/watchdog_lib"
cp -R "$BASE/watchdog/lib" "$L3_APP/watchdog_lib"
cp "$BASE/watchdog/watchdog.js" "$L3_APP/watchdog.js"
sed -i '' "s|__dirname, 'watchdog.log'|'$L3_APP', 'watchdog.log'|" "$L3_APP/watchdog.js"
sed -i '' "s|require('./lib/|require('./watchdog_lib/|" "$L3_APP/watchdog.js"

install() {
  local label="$1"; shift
  local plist="$AGENTS/${label}.plist"
  cat > "$plist"
  launchctl unload "$plist" 2>/dev/null || true
  launchctl load "$plist"
  echo "installed + loaded $label"
}

install com.chrome-ram-fix.governor <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.chrome-ram-fix.governor</string>
  <key>ProgramArguments</key>
  <array><string>$NODE</string><string>$BASE/governor/daemon.js</string></array>
  <key>WorkingDirectory</key><string>$BASE</string>
  <key>EnvironmentVariables</key><dict>
    <key>GOVERNOR_PORT</key><string>8795</string>
    <key>PATH</key><string>/Users/apple/.hermes/tools/node-26.7.0-darwin-arm64/bin:/usr/bin:/bin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$BASE/logs/governor.out.log</string>
  <key>StandardErrorPath</key><string>$BASE/logs/governor.err.log</string>
</dict></plist>
PLIST

install com.chrome-cemetery.watchdog <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.chrome-cemetery.watchdog</string>
  <key>ProgramArguments</key>
  <array><string>$NODE</string><string>$L3_APP/watchdog.js</string></array>
  <key>WorkingDirectory</key><string>$BASE</string>
  <key>EnvironmentVariables</key><dict>
    <key>WATCHDOG_POLL_MS</key><string>60000</string>
    <key>PATH</key><string>/Users/apple/.hermes/tools/node-26.7.0-darwin-arm64/bin:/usr/bin:/bin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$BASE/logs/watchdog.out.log</string>
  <key>StandardErrorPath</key><string>$BASE/logs/watchdog.err.log</string>
</dict></plist>
PLIST

install com.level3.scheduler <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.level3.scheduler</string>
  <key>ProgramArguments</key>
  <array><string>$PY</string><string>$L3_APP/agent_scheduler.py</string></array>
  <key>WorkingDirectory</key><string>$L3_APP</string>
  <key>StartInterval</key><integer>300</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$L3_APP/logs/scheduler.out.log</string>
  <key>StandardErrorPath</key><string>$L3_APP/logs/scheduler.err.log</string>
</dict></plist>
PLIST

install com.chrome-cemetery.chainwatch <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.chrome-cemetery.chainwatch</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>$L3_APP/chain_watch.sh</string></array>
  <key>StartInterval</key><integer>120</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$L3_APP/logs/chainwatch.out.log</string>
  <key>StandardErrorPath</key><string>$L3_APP/logs/chainwatch.err.log</string>
</dict></plist>
PLIST

echo
echo "verify:"
launchctl list | grep -E "chrome-cemetery|level3" || echo "(none listed)"
echo "governor:"; curl -s --max-time 3 http://127.0.0.1:8795/pressure || echo " (not yet)"
echo; echo "scheduler (manual first run to prove TCC-safe path):"
"$PY" "$L3_APP/agent_scheduler.py" | head -3 || true
