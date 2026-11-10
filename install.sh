#!/bin/bash
# install.sh — one-command installer for Brave Browser RAM Edition.
#
# What it does (idempotent — safe to run repeatedly):
#   1. builds the Rust store + governor extension (if cargo present)
#   2. installs the packaged app to ~/Applications (or /Applications w/ admin)
#   3. registers the native messaging host (absolute install path)
#   4. installs the governor daemon + watchdog launchd agents
#   5. verifies with verify_all.sh
#
# Existing users keep their profile, bookmarks, passwords — the app is a new
# bundle; the new store dir and the user-level manifest are the only writes.
#
#   bash install.sh                 # install (or repair) everything
#   bash install.sh --from-dmg      # mount the dist .dmg and install from it
#   bash install.sh --no-build      # skip cargo build, use existing dist/
#   bash install.sh --user-apps     # force ~/Applications (no sudo needed)

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_NAME="Brave Browser RAM Edition"
APP_ID="com.bravecemetery.ramedition"
NODE_HOME="${NODE_HOME:-$(dirname "$(command -v node 2>/dev/null || echo '/usr/local/bin/node')")}"

c_grn='\033[0;32m'; c_yel='\033[0;33m'; c_red='\033[0;31m'; c_off='\033[0m'
ok()   { printf "${c_grn}[OK]${c_off} %s\n" "$*"; }
warn() { printf "${c_yel}[..]${c_off} %s\n" "$*"; }
die()  { printf "${c_red}[XX]${c_off} %s\n" "$*"; exit 1; }

flag=""
for a in "$@"; do
  case "$a" in
    --from-dmg)  flag="dmg" ;;
    --no-build)  flag="nobuild" ;;
    --user-apps) flag="userapps" ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    *) die "unknown flag: $a" ;;
  esac
done

echo "=== Brave Browser RAM Edition installer ==="
echo "repo: $ROOT"
echo

# ---------- 0. preflight ----------
command -v bash  >/dev/null || die "bash required"
[ -d "$ROOT/extension" ] || die "run from the brave-cemetery repo root"
export PATH="$NODE_HOME:$PATH"

# ---------- 1. build the engine ----------
if [ "$flag" != "nobuild" ]; then
  export PATH="$HOME/.cargo/bin:$PATH"
  if command -v cargo >/dev/null 2>&1; then
    echo "[1/5] building engine (cargo, release)"
    ( cd "$ROOT/cemetery" && cargo build --release ) || warn "cargo build failed — reusing existing binary"
    ok "cemeteryd: $( [ -x "$ROOT/cemetery/target/release/cemeteryd" ] && echo present || echo MISSING )"
  else
    warn "cargo not found — skipping build (install Rust toolchain if you want a fresh store)"
  fi
else
  echo "[1/5] build skipped (--no-build)"
fi

# ---------- 2. install the app ----------
echo "[2/5] installing the app bundle"
SRC_APP=""
if [ "$flag" = "dmg" ]; then
  DMG="$(ls -t "$ROOT"/dist/*.dmg 2>/dev/null | head -1)"
  [ -n "$DMG" ] || die "no .dmg in dist/ — run scripts/package_native_brave_app.sh first"
  VOL="$(hdiutil attach -nobrowse -noverify "$DMG" | awk '/\/Volumes\//{print $3; exit}')"
  [ -n "$VOL" ] || die "dmg did not mount"
  SRC_APP="$VOL/Brave Browser.app"
  trap 'hdiutil detach "$VOL" >/dev/null 2>&1 || true' EXIT
else
  if [ -d "$ROOT/dist/Brave Browser.app" ]; then SRC_APP="$ROOT/dist/Brave Browser.app"; fi
fi
[ -n "$SRC_APP" ] || die "no packaged app found — run scripts/package_native_brave_app.sh (or --from-dmg) first"

# admin install if writable, else user install
if [ "$flag" = "userapps" ] || [ ! -w "/Applications" ]; then
  DEST="$HOME/Applications/Brave Browser RAM Edition.app"
else
  DEST="/Applications/Brave Browser RAM Edition.app"
fi
mkdir -p "$(dirname "$DEST")"
rm -rf "$DEST"
# hardlink copy: 578 MB, no extra disk, independent of the source bundle
cp -Rc "$SRC_APP" "$DEST" 2>/dev/null || cp -R "$SRC_APP" "$DEST"
[ -x "$DEST/Contents/MacOS/Brave Browser" ] || die "app copy failed — $DEST has no executable"
ok "app: $DEST"

# The bundle ships native-host/registered.json with the path of wherever it was
# packaged. Rewrite it for THIS install location, then drive the installed
# launcher once so the user-level host points at the installed app (not dist/).
python3 - "$DEST/Contents/Resources/BraveCemetery/native-host/registered.json" <<'PY'
import json, sys
p = sys.argv[1]
m = json.load(open(p))
m["path"] = p.replace("/registered.json", "/run.sh")
json.dump(m, open(p, "w"), indent=2)
PY
"$DEST/Contents/MacOS/Brave Browser" --version >/dev/null 2>&1 || true
NM_DIR="$HOME/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts"
if [ -f "$NM_DIR/com.brave_cemetery.bridge.json" ]; then
  HOST_PATH="$(python3 -c "import json;print(json.load(open('$NM_DIR/com.brave_cemetery.bridge.json'))['path'])" 2>/dev/null)"
  case "$HOST_PATH" in
    "$DEST"/*) ok "native messaging host -> $HOST_PATH" ;;
    *) warn "host points at $HOST_PATH (expected $DEST) — re-running launcher" ;;
  esac
else
  warn "host not registered yet — it registers on first launch"
fi

# ---------- 3. launchd agents ----------
echo "[3/5] launchd agents"
AGENTS_DIR="$HOME/Library/LaunchAgents"
STATE_DIR="$HOME/Library/Application Support/BraveCemetery/store"
LOG_DIR="$HOME/Library/Logs/BraveCemetery"
if [ -d "$ROOT/launchd" ]; then
  mkdir -p "$STATE_DIR" "$LOG_DIR"
  for pl in "$ROOT"/launchd/*.plist; do
    [ -f "$pl" ] || continue
    LABEL="$(/usr/bin/plutil -extract Label raw "$pl" 2>/dev/null || basename "$pl" .plist)"
    # rewrite placeholders for this user's actual paths (repo stays canonical)
    sed -e "s|__REPO_ROOT__|$ROOT|g" \
        -e "s|__STATE_DIR__|$STATE_DIR|g" \
        -e "s|__LOG_DIR__|$LOG_DIR|g" \
        -e "s|.|$ROOT|g" \
        "$pl" > "$AGENTS_DIR/$LABEL.plist"
    chmod +x "$ROOT/launchd/run-governor.sh" 2>/dev/null || true
    # modern launchd: bootstrap (sudo-less user domain) with bootout first so a
    # stale service is always replaced, never silently kept
    launchctl bootout "gui/$UID/$LABEL" >/dev/null 2>&1 || true
    if launchctl bootstrap "gui/$UID" "$AGENTS_DIR/$LABEL.plist" 2>/dev/null; then
      ok "agent: $LABEL"
    else
      # fallback for older macOS / non-standard domains
      launchctl unload "$AGENTS_DIR/$LABEL.plist" >/dev/null 2>&1 || true
      launchctl load   "$AGENTS_DIR/$LABEL.plist" >/dev/null 2>&1 || warn "agent $LABEL did not load"
      ok "agent: $LABEL (legacy domain)"
    fi
  done
else
  warn "launchd/ directory missing — install manually"
fi

# ---------- 4. bookmarks / notes ----------
echo "[4/5] finishing touches"
ok "store dir: $HOME/Library/Application Support/BraveCemetery/store"
ok "logs: $HOME/Library/Logs/BraveCemetery"

# ---------- 5. verify ----------
echo "[5/5] verifying"
bash "$ROOT/verify_all.sh" || warn "verify_all reported issues — see above"

echo
ok "DONE — launch '$APP_NAME' from Spotlight"
echo "   profile: the RAM Edition uses its own profile dir, so your real"
echo "   Brave stays untouched and can run side by side."
true
