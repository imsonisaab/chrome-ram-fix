#!/bin/bash
# ============================================================================
#  install-no-app.sh — install the RAM Edition engine INTO the user's own Brave
#  ---------------------------------------------------------------------------
#  User's hard rule: exactly ONE Brave on the Mac — the real
#  /Applications/Brave Browser.app with the real profile, history, cookies and
#  Keychain. No second app bundle may exist anywhere, because an ad-hoc signed
#  duplicate breaks macOS Keychain password lookup ("Brave Safe Storage") and
#  silently loses access to logged-in accounts.
#
#  So this installer:
#    1. copies ONLY the engine (extension, governor libs, native host, cemeteryd)
#       into the engine root — an invisible payload, not an app
#    2. registers the native messaging host with the user's real Brave profile
#    3. installs the hidden Governor launchd agent (no UI, no dock icon)
#    4. verifies /pressure is live
#
#  It never copies, replaces, symlinks or signs a second .app.
#  Reverse with uninstall.sh (which also never touches the real app/profile).
# ============================================================================
set -euo pipefail
cd "$(cd "$(dirname "$0")" && pwd)"

NODE="${NODE:-$(command -v node 2>/dev/null || echo '/usr/local/bin/node')/node}"
command -v "$NODE" >/dev/null 2>&1 || NODE=node
PY="${PY:-python3}"

# ---------- 0. engine root (NOT an app bundle) ------------------------------
ENGINE_ROOT="${ENGINE_ROOT:-$HOME/Library/Application Support/BraveCemetery/engine}"
mkdir -p "$ENGINE_ROOT"

echo "[1/5] staging engine into $ENGINE_ROOT"
cp -R governor/.                       "$ENGINE_ROOT/governor/"
cp -R extension/.                      "$ENGINE_ROOT/extension/"
mkdir -p "$ENGINE_ROOT/bin" "$ENGINE_ROOT/native-host"
cp cemetery/target/release/cemeteryd   "$ENGINE_ROOT/bin/cemeteryd"
cp launchd/run-governor.sh             "$ENGINE_ROOT/run-governor.sh"
cp governor/daemon.js                  "$ENGINE_ROOT/governor/daemon.js"
chmod +x "$ENGINE_ROOT/run-governor.sh" "$ENGINE_ROOT/bin/cemeteryd"
echo "  engine staged (extension + governor + daemon + cemeteryd)"

# ---------- 1. resident governor (hidden, no app, no UI) --------------------
echo "[2/5] launchd agent (background, invisible)"
AGENT_SRC="$PWD/launchd/com.brave_cemetery.governor.plist"
mkdir -p "$HOME/Library/LaunchAgents"
# point the plist at the engine root, not the repo
NODE="$HOME/.hermes/tools/node-26.7.0-darwin-arm64/bin/node"
[ -x "$NODE" ] || NODE="$(command -v node)"
sed -e "s|__GOVERNOR_DAEMON__|$NODE|" -e "s|__DAEMON_JS__|$ENGINE_ROOT/governor/daemon.js|" "$AGENT_SRC" \
  > "$HOME/Library/LaunchAgents/com.brave_cemetery.governor.plist"
plutil -lint "$HOME/Library/LaunchAgents/com.brave_cemetery.governor.plist"
launchctl bootout "gui/$UID/com.brave_cemetery.governor" 2>/dev/null || true
launchctl bootstrap "gui/$UID" "$HOME/Library/LaunchAgents/com.brave_cemetery.governor.plist"

# register the repo copy too, so `bash verify_all.sh` can find it
cp "$AGENT_SRC" "$PWD/launchd/com.brave_cemetery.governor.plist" 2>/dev/null || true

# ---------- 2. native messaging host for the REAL profile -------------------
echo "[3/5] native messaging host registration"
HOST_DIR="$HOME/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts"
mkdir -p "$HOST_DIR"
cat > "$HOST_DIR/com.brave_cemetery.bridge.json" <<JSON
{
  "name": "com.brave_cemetery.bridge",
  "description": "Brave RAM Edition — tab-state bridge (engine, no app)",
  "path": "$ENGINE_ROOT/native-host/bridge.sh",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://inmeejlkgbkicdbmolcofpafekejaick/"]
}
JSON
# self-locating bridge for the engine root (never depends on an .app bundle)
cat > "$ENGINE_ROOT/native-host/bridge.sh" <<'BRIDGE'
#!/bin/bash
# Brave RAM Edition native messaging bridge — engine install (no app bundle)
HERE="$(cd "$(dirname "$(readlink -f "$0" 2>/dev/null || echo "$0")")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
export CEMETERY_DIR="${CEMETERY_DIR:-$HOME/Library/Application Support/BraveCemetery/store}"
mkdir -p "$CEMETERY_DIR" 2>/dev/null
export CEMETERY_BIN="$ROOT/bin/cemeteryd"
for n in "$HOME/.hermes/tools/node-26.7.0-darwin-arm64/bin" "/usr/local/bin" "/opt/homebrew/bin" "/usr/bin"; do
  [ -x "$n/node" ] && export PATH="$n:$PATH" && break
done
exec "$(command -v node)" "$ROOT/extension/native-host.js"
BRIDGE
chmod +x "$ENGINE_ROOT/native-host/bridge.sh"
echo "  host -> $HOST_DIR/com.brave_cemetery.bridge.json"

# ---------- 3. make the extension loadable from the REAL profile ------------
# macOS TCC blocks an agent from writing Brave's "External Extensions" folder
# from the terminal, and Chrome has ignored that folder for unpacked installs
# since v75 anyway. So the engine ships where the user can load it once from
# chrome://extensions -- "Load unpacked" -- which is the supported path.
echo "[4/5] extension staged for one-time load unpacked"
echo "  path: $ENGINE_ROOT/extension"
open "chrome://extensions" >/dev/null 2>&1 || true

# ---------- 4. verify -------------------------------------------------------
echo "[5/5] verifying"
for i in 1 2 3 4 5; do
  if curl -s --max-time 2 http://127.0.0.1:8795/pressure | grep -q level; then
    curl -s http://127.0.0.1:8795/pressure; echo
    echo "resident governor live — no app bundle, no popup."
    exit 0
  fi
  sleep 1
done
echo "[WARN] governor not answering on :8795 — check ~/Library/Logs/BraveCemetery"
exit 1
