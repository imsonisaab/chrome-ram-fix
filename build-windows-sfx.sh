#!/bin/bash
# ============================================================================
#  build-windows-sfx.sh — append the Base64 payload to the SFX launcher
#  ---------------------------------------------------------------------------
#  Input : dist/windows/                      (installer.bat + windows-host + extension)
#  Output: dist/Chrome-Cemetery-Windows-Installer.cmd.zip.BASE64
#          dist/Chrome-Cemetery-Windows-Installer.cmd   (single double-click file)
#
#  Produces ONE self-extracting .cmd that works on stock Windows 11.
#  It does NOT produce a .exe: iexpress.exe is a Windows-only tool and this Mac
#  has no mingw/wine/pyinstaller, so a runnable PE cannot be honestly built
#  here. build-windows-exe.bat turns this .cmd into a real .exe on the laptop.
# ============================================================================
set -euo pipefail
cd "$(cd "$(dirname "$0")" && pwd)"

SRC="dist/windows"
OUT="dist/Chrome-Cemetery-Windows-Installer.cmd"
LAUNCHER="$SRC/Chrome-Cemetery-Windows-Installer.cmd"
MARK="BASE64PAYLOADSTART"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "[1/3] staging payload"
mkdir -p "$TMP/pkg"
cp -R "$SRC"/. "$TMP/pkg/"
rm -f "$TMP/pkg/Chrome-Cemetery-Windows-Installer.cmd" \
      "$TMP/pkg/Chrome-Cemetery-Windows-Installer.cmd.zip.BASE64"
# the payload must never contain the SFX launcher itself
find "$TMP/pkg" -name 'Chrome-Cemetery-Windows-Installer.cmd' -delete

echo "[2/3] zipping payload"
( cd "$TMP/pkg" && zip -qr "$TMP/payload.zip" . )

echo "[3/3] base64 + appending to launcher"
cp "$LAUNCHER" "$OUT"
{
  echo ""
  echo "REM ------------------------------------------------------------------"
  echo "REM  APPENDED PAYLOAD — do not edit anything below this line."
  echo "REM ------------------------------------------------------------------"
  echo "BASE64PAYLOADSTART"
  # plain base64, wrapped - untouched by any sed mangling
  base64 -b 76 -i "$TMP/payload.zip"
} >> "$OUT"

ls -la "$OUT"
sha256sum "$OUT" 2>/dev/null || shasum -a 256 "$OUT"
echo "self-extracting installer ready: $OUT"
echo "single file, double-click, no tooling needed on Windows 11."
