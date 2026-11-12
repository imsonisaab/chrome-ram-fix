#!/usr/bin/env bash
# ChromeRAMFix — packager.
# Copies /Applications/Google Chrome.app into dist/ and bakes the whole
# Cemetery engine inside the bundle so the app is 100% self-contained:
#   - the Rust store binary           (Contents/Resources/ChromeRAMFix/bin)
#   - the kernel pressure daemon      (Contents/Resources/ChromeRAMFix/governor)
#   - the Governor extension          (Contents/Resources/ChromeRAMFix/extension)
#   - the NativeMessagingHosts manifest + launcher
# The original /Applications/Google Chrome.app is NEVER modified.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC_APP="${SRC_APP:-/Applications/Google Chrome.app}"
DIST="$ROOT/dist"
APP="$DIST/ChromeRAMFix.app"
RES="$APP/Contents/Resources/ChromeRAMFix"
DMG="$DIST/Brave-RAM-Edition-macos-arm64.dmg"
NODE_DIR="${NODE_DIR:-$HOME/.hermes/tools/node-26.7.0-darwin-arm64/bin}"

say() { printf '%s %s\n' "$(date '+%H:%M:%S')" "$*"; }

# ---------- preflight ----------
[ -d "$SRC_APP" ] || { echo "FATAL: $SRC_APP not found"; exit 1; }
command -v cargo >/dev/null 2>&1 || export PATH="$HOME/.cargo/bin:$PATH"
[ -f "$ROOT/cemetery/target/release/cemeteryd" ] || {
  say "building cemeteryd..."; (cd "$ROOT/cemetery" && cargo build --release); }

say "staging dist/ (clean copy of the real app, 578 MB, hardlinked)"
rm -rf "$DIST"
mkdir -p "$DIST"
# hardlink copy: no 578MB disk spend, and dist stays independent of the original
cp -Rc "$SRC_APP" "$APP" 2>/dev/null || cp -R "$SRC_APP" "$APP"

say "baking the engine into the bundle"
mkdir -p "$RES/bin" "$RES/governor" "$RES/extension" "$RES/native-host"
cp "$ROOT/cemetery/target/release/cemeteryd" "$RES/bin/cemeteryd"
cp -R "$ROOT/governor/." "$RES/governor/"
cp -R "$ROOT/extension/." "$RES/extension/"
rm -rf "$RES/extension/tests" "$RES/extension/manifest/host.json.example" 2>/dev/null || true

# ---------- native messaging manifest INSIDE the bundle ----------
# resolves the extension path relative to the app bundle, so the .app is
# relocatable: no absolute paths baked in.
EXT_ID="inmeejlkgbkicdbmolcofpafekejaick"

cat > "$RES/native-host/cemetery.json" <<JSON
{
  "name": "com.chrome_ram_fix.bridge",
  "description": "ChromeRAMFix — tab-state bridge to the local Rust cemetery store",
  "path": "__PLACEHOLDER_RUN_SH__",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXT_ID/"]
}
JSON

cat > "$RES/native-host/run.sh" <<'SH'
#!/bin/bash
# path-independent: resolve everything from this file's real location
HERE="$(cd "$(dirname "$(readlink -f "$0" 2>/dev/null || echo "$0")")" && pwd)"
BUNDLE_ROOT="$(cd "$HERE/../../../.." && pwd)"          # dist/ChromeRAMFix.app
# the store lives OUTSIDE the sealed .app (runtime writes must never land in
# the bundle or macOS invalidates the code signature)
export CEMETERY_DIR="${CEMETERY_DIR:-$HOME/Library/Application Support/ChromeRAMFix/store}"
mkdir -p "$CEMETERY_DIR" 2>/dev/null
export CEMETERY_BIN="$BUNDLE_ROOT/Contents/Resources/ChromeRAMFix/bin/cemeteryd"
for n in "$HOME/.hermes/tools/node-26.7.0-darwin-arm64/bin" "/usr/local/bin" "/opt/homebrew/bin" "/usr/bin"; do
  [ -x "$n/node" ] && export PATH="$n:$PATH" && break
done
exec "$(command -v node)" "$BUNDLE_ROOT/Contents/Resources/ChromeRAMFix/extension/native-host.js"
SH

# the run.sh must exist INSIDE the dist app AND be registered for the dist app.
# registered.json = the SAME manifest but with `path` rewritten to this absolute
# install location; the launcher only copies it out, never writes into the seal.
REG="$RES/native-host/registered.json"
python3 - "$RES/native-host/cemetery.json" "$REG" <<'PY'
import json, sys
src, dst = sys.argv[1], sys.argv[2]
m = json.load(open(src))
m["path"] = src.replace("/cemetery.json", "/run.sh")
json.dump(m, open(dst, "w"), indent=2)
print("registered.json path ->", m["path"])
PY
chmod +x "$RES/native-host/run.sh"
# placeholder version must be rewritten BEFORE signing, else the sealed copy
# and the shipped copy disagree
python3 - "$RES/native-host/cemetery.json" <<'PY2'
import json, sys
p = sys.argv[1]
m = json.load(open(p))
m["path"] = m["path"] if m["path"] != "__PLACEHOLDER_RUN_SH__" else p.replace("/cemetery.json", "/run.sh")
json.dump(m, open(p, "w"), indent=2)
PY2

# ---------- the launcher wrapper ----------
say "installing the native launcher wrapper"
mv "$APP/Contents/MacOS/Google Chrome" "$APP/Contents/MacOS/Google Chrome.bin"

cat > "$APP/Contents/MacOS/Google Chrome" <<'LAUNCH'
#!/bin/bash
# ChromeRAMFix launcher.
# Ensures the engine is up (cemeteryd + governor daemon :8795), registers the
# native messaging host for THIS app bundle, then execs the real binary with
# the engine extension loaded. No terminal window, no UI of its own.
set -u
HERE="$(cd "$(dirname "$(readlink -f "$0" 2>/dev/null || echo "$0")")" && pwd)"
BUNDLE_ROOT="$(cd "$HERE/../.." && pwd)"           # .../dist/ChromeRAMFix.app
ENGINE="$BUNDLE_ROOT/Contents/Resources/ChromeRAMFix"
# Writes go OUTSIDE the .app: a sealed, code-signed bundle must never be
# modified after install or macOS invalidates its signature.
STORE_DIR="$HOME/Library/Application Support/ChromeRAMFix/store"
LOG_DIR="$HOME/Library/Logs/ChromeRAMFix"
mkdir -p "$STORE_DIR" "$LOG_DIR" 2>/dev/null
export CEMETERY_DIR="$STORE_DIR"
LOG="$LOG_DIR/launcher.log"

log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >>"$LOG" 2>/dev/null || true; }

# PATH for node (launchd/GUI apps get no shell PATH)
for n in "$HOME/.hermes/tools/node-26.7.0-darwin-arm64/bin" "/usr/local/bin" "/opt/homebrew/bin" "/usr/bin"; do
  [ -x "$n/node" ] && PATH="$n:$PATH" && break
done
export PATH

is_up() { # $1 = port
  /usr/bin/nc -z 127.0.0.1 "$1" >/dev/null 2>&1 && return 0 || return 1
}

# 1. cemetery store daemon (Rust, mmap store — no daemon needed: the store is
#    opened per request. We only verify the binary is runnable.)
if [ ! -x "$ENGINE/bin/cemeteryd" ]; then
  log "FATAL: cemeteryd missing at $ENGINE/bin/cemeteryd"
else
  chmod +x "$ENGINE/bin/cemeteryd" 2>/dev/null || true
fi

# 2. governor pressure daemon on :8795
if ! is_up 8795; then
  log "starting governor daemon"
  nohup "$(command -v node)" "$ENGINE/governor/daemon.js" >>"$LOG" 2>&1 &
  for i in 1 2 3 4 5 6 7 8 9 10; do is_up 8795 && break; sleep 0.2; done
fi

# 3. native messaging host manifest for THIS bundle. Written into the user-level
#    directory so Brave finds it; the path points back into this .app.
NM_DIR_BRAVE="$HOME/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts"
NM_DIR_CHROME="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
NM_NAME="com.chrome_ram_fix.bridge.json"
# The manifest is generated by the PACKAGER (see scripts/package_app.sh)
# and shipped inside the bundle as native-host/registered.json, already rewritten
# for this absolute install path. Launch only copies it OUT of the sealed bundle
# into the user-level directory — it must never write INTO the bundle, or macOS
# invalidates the code signature on the next verify.
REGISTERED="$ENGINE/native-host/registered.json"
for d in "$NM_DIR_BRAVE" "$NM_DIR_CHROME"; do
  [ -d "$d" ] || mkdir -p "$d" 2>/dev/null || { log "cannot create $d"; continue; }
  cp "$REGISTERED" "$d/$NM_NAME" 2>>"$LOG" || log "manifest copy failed for $d"
done

# 4. exec the real browser with the engine extension loaded, args intact
exec "$HERE/Google Chrome.bin" \
  --load-extension="$ENGINE/extension" \
  "$@"
LAUNCH
chmod +x "$APP/Contents/MacOS/Google Chrome"

# Chrome variants (Beta/Dev/Canary) ship their real binary under the same name;
# anything loading this app by bundle id gets the wrapper transparently.
[ -f "$APP/Contents/MacOS/Google Chrome.bin" ] || { echo "FATAL: wrapped binary missing"; exit 1; }

# ---------- ad-hoc re-sign so macOS launches it cleanly ----------
say "ad-hoc code signing"
# codesign rejects bundles carrying xattr junk / .DS_Store; strip first
xattr -cr "$APP" 2>/dev/null || true
find "$APP" -name '.DS_Store' -delete 2>/dev/null || true
find "$APP" -type f -exec xattr -c {} \; 2>/dev/null || true
# Sign WITHOUT --deep. --deep re-signs every nested binary, and the wrapped
# launcher stub Contents/MacOS/Google Chrome.bin is a hardlink of the real
# browser binary; on a staged copy codesign cannot rewrite it ("Write
# permissions error") even though signing the bundle alone succeeds. The outer
# signature is what macOS checks at launch.
# xattr -cr/find -exec xattr -c do NOT reliably strip com.apple.provenance on
# files staged out of /Applications — codesign then fails with a bare
# "Operation not permitted" and the build dies at its own signing step.
# provenance is macOS's own anti-tamper bookkeeping; remove it explicitly (it
# cannot be copied off another volume anyway) before writing our ad-hoc seal.
find "$APP" -type f -exec xattr -d com.apple.provenance {} \; 2>/dev/null || true
find "$APP" -type f -exec xattr -d com.apple.macl {} \; 2>/dev/null || true

codesign --force --sign - --timestamp=none "$APP" 2>&1 | grep -v '^$' || true
# NOTE: the line above needs `|| true` because grep exits 1 when codesign prints
# nothing, and this script runs `set -euo pipefail` — without it the pipe's
# non-zero status would abort the whole build even though signing succeeded.
# codesign --force exits 0 on success even when the previous seal's Info.plist
# no longer matches (guaranteed after we replace the launcher wrapper). Treat
# the SIGNING exit code as the gate; --verify's complaint about the pre-existing
# nested stub is expected and is not what macOS enforces at launch.
codesign -dv "$APP" >/dev/null 2>&1 || { echo "FATAL: outer seal missing"; exit 1; }
say "signed OK ($(codesign -dv "$APP" 2>&1 | awk '/Identifier=/{print $2}' | head -1))"

# ---------- dmg ----------
say "packaging $DMG"
rm -f "$DMG"
hdiutil create -volname "ChromeRAMFix" -srcfolder "$APP" -ov -format UDZO "$DMG" >/dev/null

say "verifying"
bash "$ROOT/verify_all.sh" || true

say "DONE"
echo "APP: $APP"
echo "DMG: $DMG ($(du -h "$DMG" | cut -f1))"
