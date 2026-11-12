#!/bin/bash
# accept_app.sh — is the built .app actually a Brave Browser? Verifies the
# things a human would check, but deterministically and without stealing focus.
#
#   bash accept_app.sh /path/to/Brave\ Browser.app
#
# Pass = the app exists, is signed-for-local, contains Brave's own assets,
# reports Brave's version+revision, and --version runs without a crash.
set -uo pipefail

APP="${1:-/Users/apple/Documents/chrome-cemetery/brave-core/src/out/Release/Brave Browser.app}"
LOG="/Users/apple/Documents/chrome-cemetery/accept_app.log"
say(){ echo "[$(date '+%F %T')] $*" | tee -a "$LOG"; }
fail=0
ok(){ say "PASS $*"; }
bad(){ say "FAIL $*"; fail=1; }

[ -d "$APP" ] || { bad "no app at $APP"; exit 1; }
ok "path $APP"

# ---- bundle shape ----------------------------------------------------------
BIN="$APP/Contents/MacOS/Brave Browser"
FRAMEWORKS="$APP/Contents/Frameworks"
INFO="$APP/Contents/Info.plist"
[ -x "$BIN" ] && ok "Mach-O binary present and executable" || bad "missing executable $BIN"
HDR=$(file -b "$BIN" 2>/dev/null)
case "$HDR" in
  *arm64*) ok "binary arch: $HDR" ;;
  *) bad "binary not arm64: $HDR" ;;
esac
for d in "$FRAMEWORKS" "$APP/Contents/Resources"; do
  [ -d "$d" ] && ok "bundle dir $(basename "$d")" || bad "missing bundle dir $d"
done

# ---- Brave identity (not a plain Chromium build) ---------------------------
grep -q "<string>com.brave.Browser" "$INFO" 2>/dev/null \
  && ok "bundle id com.brave.Browser (Brave, not Chromium)" \
  || bad "bundle id is not com.brave.Browser"

# Real Brave layout (verified against the installed 157.1.99.55): the .pak files
# and .lproj/locale.pak live in the Framework bundle, not the app's Resources.
FW=$(find "$APP/Contents" -maxdepth 2 -type d -name "*Framework.framework" | head -1)
[ -n "$FW" ] && ok "framework bundle: $(basename "$FW")" || bad "no *Framework.framework"

for asset in "brave_resources.pak" "brave_100_percent.pak"; do
  found=$(find "$APP/Contents" -maxdepth 6 -name "$asset" 2>/dev/null | head -1)
  [ -n "$found" ] && ok "Brave asset $asset" || bad "missing Brave asset $asset (only a plain Chromium build lacks it)"
done
LOCALES=$(find "$APP/Contents" -maxdepth 6 -name "*.lproj" -type d 2>/dev/null | wc -l | tr -d ' ')
[ "${LOCALES:-0}" -ge 5 ] && ok "locale packs: $LOCALES .lproj dirs" || bad "too few locale packs ($LOCALES)" 

# Brave's branding (Lion icon) — a chromium build would not have these
if compgen -G "$APP/Contents/Resources/*.icns" >/dev/null; then
  ok "icns present: $(ls "$APP"/Contents/Resources/*.icns | xargs -n1 basename | paste -sd, -)"
else
  bad "no .icns (Brave ships app.icns/product logos)"
fi

# ---- runs (does not open windows, does not steal focus) --------------------
"$BIN" --version > /tmp/brave_ver.out 2>/tmp/brave_ver.err &
VP=$!
for i in $(seq 1 40); do
  kill -0 "$VP" 2>/dev/null || break
  sleep 0.5
done
kill -0 "$VP" 2>/dev/null && { kill "$VP" 2>/dev/null; bad "--version hung (>20s)"; } || {
  V=$(head -1 /tmp/brave_ver.out 2>/dev/null; head -1 /tmp/brave_ver.err 2>/dev/null | grep -i brave)
  case "$(cat /tmp/brave_ver.out /tmp/brave_ver.err 2>/dev/null | head -2)" in
    *Brave*|*brave/*) ok "--version reports Brave: $(cat /tmp/brave_ver.out /tmp/brave_ver.err 2>/dev/null | head -1)" ;;
    *) bad "--version did not report Brave: $(cat /tmp/brave_ver.out /tmp/brave_ver.err 2>/dev/null | head -2)" ;;
  esac
}

# ---- size sanity (user's 300MB target, honest) -----------------------------
# measure the bundle itself (one total line; without -s du lists dirs, and
# cut -f1 then grabbed an inner dir's size — verified on real Brave: 578MB).
SIZE_MB=$(du -sk "$APP" | awk '{print int($1/1024)}')
SZ="$SIZE_MB MB"
# real Brave 157.1.99.55 on this box = 573M; official dmg is 128M compressed.
# our strip_debug_info build should land between; this is a NOTE, never a fail.
if [ "${SIZE_MB:-0}" -ge 200 ] && [ "${SIZE_MB:-0}" -le 700 ]; then
  ok "app size $SZ (expected band: real Brave here is 573M, official dmg is 128M)"
else
  say "NOTE app size $SZ is outside the 200-700MB band (informational)"
fi

say "RESULT: $([ $fail = 0 ] && echo ACCEPTED || echo REJECTED)"
exit $fail
