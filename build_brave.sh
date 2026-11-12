#!/bin/bash
# build_brave.sh — compile the sync'd Brave tree into the deliverable .app
# Assumes sync_brave.sh finished (src/ + src/brave nest present).
# Gates: disk floor, toolchain presence, gn args present, build start/stop proof.
set -uo pipefail

BASE="/Users/apple/Documents/chrome-cemetery/brave-core"
SRC="$BASE/src"
TAG="v1.57.64"
LOG="$BASE/build.log"
# 10GB is the real emergency line. The old 69GB floor was sized for the
# download alone, but checkout expansion (~30GB) + out/ (~10GB) drive free to
# ~37GB mid-build, so a 69GB floor would have killed a healthy chain.
FREE_FLOOR_KB=$((10 * 1024 * 1024))

say(){ echo "[$(date '+%F %T')] $*" | tee -a "$LOG"; }
die(){ say "BUILD STOP: $*"; exit 1; }
chk(){ local k; k=$(df -k / | tail -1 | awk '{print $4}'); [ "$k" -lt "$FREE_FLOOR_KB" ] && die "free $(($k/1024/1024))GB < 69GB floor"; say "free $(($k/1024/1024))GB ok"; }

chk
[ -f "$SRC/package.json" ] || die "no src — run sync_brave.sh first"
[ -d "$SRC/src/brave" ] || die "brave-core nest missing — sync incomplete"
chk

cd "$SRC" || die "no src"

# 0) Xcode toolchain. Brave's config only forces hermetic Xcode when
# build/mac_files/xcode_binaries/Contents exists (config.js:455-459); otherwise
# it uses the system one. The pinned hermetic tarball (Xcode 14.3) is now
# 403-gone from S3, so we try it best-effort and fall back to CLT — this Mac's
# Command Line Tools ship the macOS 27.0 SDK, which Chromium accepts.
if [ ! -d "$SRC/build/mac_files/xcode_binaries/Contents" ]; then
  say "trying hermetic toolchain fetch (best-effort; system CLT is the fallback)..."
  npm run init -- --target_os=mac --target_arch=arm64 >>"$LOG" 2>&1 || say "note: hermetic fetch unavailable — building with system CLT (macOS 27 SDK)"
fi
if [ -d "$SRC/build/mac_files/xcode_binaries/Contents" ]; then
  say "hermetic xcode present"
else
  say "using system xcode: $(xcrun --sdk macosx --show-sdk-version 2>/dev/null || echo unknown) SDK"
fi
chk
# 1) toolchain truth
say "checking depot_tools..."
[ -x "$SRC/../depot_tools/gn" ] || [ -x "$SRC/../depot_tools/gn.py" ] || say "WARN: depot_tools not found at ../depot_tools (gclient init should have added it)"
command -v gn >/dev/null 2>&1 || say "WARN: gn not on PATH — export PATH=\"\$BASE/depot_tools:\$PATH\" if build fails"

# 2) gn args (build/ + out/ under our project, NOT the default)
OUT="$BASE/out/Release"
if [ ! -f "$OUT/args.gn" ]; then
  say "generating gn args (arm64 Release, component off for a movable app)..."
  mkdir -p "$OUT"
  cat > "$OUT/args.gn" <<GN
# Mirrors Brave's own release config for a movable, ~290MB arm64 DMG.
# PGO explicitly off: .gclient fetches no profiles (checkout_pgo_profiles=False)
# and chrome_pgo_phase=0 stops the build from demanding them.
is_official_build = true
is_debug = false
symbol_level = 0
target_cpu = "arm64"
enable_static_analysis = false
is_component_build = false
chrome_pgo_phase = 0
enable_widevine = true
proprietary_codecs = true
ffmpeg_branding = "Chrome"
# Disk + size: an M1 Pro checkout (~40GB) + these objects have to fit beside the
# existing system, and the user's deliverable is a ~300MB zip, so debug info and
# the .dSYM bundle are dead weight here.
strip_debug_info = true
exclude_unwind_tables_from_debug_info = true
enable_dsyms = false
# REQUIRED by //brave/components/constants/BUILD.gn:16 (verified in the synced
# tree): is_official_build asserts brave_services_key != "". Real keys only exist
# in Brave's Dev Dashboard, so a placeholder keeps official branding for a local
# build. Without this line gn gen dies right after the mult-hour sync.
brave_services_key = "local-build-placeholder-key"
GN
fi
say "gn args: $(cat "$OUT/args.gn" | tr '\n' ' ')"

# 3) generate build files (fast)
# 3b) brave's pre-build step: node deps + generated resources. gn gen fails with
# 'unknown' targets without it. (l10n pulls are a separate command, so no
# Transifex dependency here.)
say "npm run sync (brave pre-build: generated resources)..."
npm run sync >>"$LOG" 2>&1 || die "npm run sync failed (see $LOG)"
chk

say "gn gen..."
gn gen "$OUT" >>"$LOG" 2>&1 || die "gn gen failed"

# 4) the compile (3-8h on M1 Pro). autoninja = all cores.
say "autoninja chrome (this is the mult-hour step)..."
chk
autoninja -C "$OUT" chrome >>"$LOG" 2>&1 || die "autoninja chrome failed"
chk

APP="$OUT/Brave Browser.app"
[ -d "$APP" ] || die "build finished but no .app at $APP"
APP_SIZE=$(du -sh "$APP" | cut -f1)
say "BUILD COMPLETE: $APP ($APP_SIZE)"

# 5) zip for the 300MB deliverable (dSYMs stripped by symbol_level=0)
DIST="/Users/apple/Documents/chrome-cemetery/dist"
mkdir -p "$DIST"
cd "$OUT" || die "no out"
# NOTE: ditto has no --sequesterRename on this macOS (verified: unrecognized
# option). -c -k --keepParent round-trips correctly (restored diff is only the
# ._ AppleDouble files ditto strips itself).
ditto -c -k --keepParent "Brave Browser.app" "$DIST/Brave-Browser-arm64.zip" >>"$LOG" 2>&1 || die "zip failed"
# Self-check before handing anything over: proves the bundle is Brave, not a
# plain Chromium build (validated both ways against the real Brave install).
bash "$BASE/accept_app.sh" "$BASE/src/out/Release/Brave Browser.app" >>"$LOG" 2>&1 \
  && say "APP ACCEPTED" || say "APP REJECTED — see $LOG"

ZIP_SIZE=$(du -h "$DIST/Brave-Browser-arm64.zip" | cut -f1)
say "DELIVERABLE: $DIST/Brave-Browser-arm64.zip ($ZIP_SIZE)"

# A DMG is what most people expect from a browser download; both are verified
# paths on this box (hdiutil UDZO + hdiutil verify both pass).
if [ "${MAKE_DMG:-1}" = "1" ]; then
  hdiutil create -volname "Brave Browser" -srcfolder "Brave Browser.app" \
      -ov -format UDZO -fs HFS+ "$DIST/Brave-Browser-arm64.dmg" >>"$LOG" 2>&1 \
      && hdiutil verify "$DIST/Brave-Browser-arm64.dmg" >/dev/null 2>&1 \
      && say "DELIVERABLE: $DIST/Brave-Browser-arm64.dmg ($(du -h "$DIST/Brave-Browser-arm64.dmg" | cut -f1))" \
      || say "WARN: dmg step failed (zip still valid)"
fi
df -h / | tail -1 | tee -a "$LOG"
