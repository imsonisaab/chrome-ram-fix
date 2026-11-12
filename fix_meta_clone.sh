#!/bin/bash
# fix_meta_clone.sh — repair the broken .gclient geometry, then clone chromium
# ONCE into brave-core/src/ so init.js's mkdir target has a parent.
#
# Verified geometry (gclient resolves each solution relative to the .gclient
# file's own directory):
#   brave-core/.gclient  + solution "src"  ->  brave-core/src          (chromium)
#                                        "src/brave" ->  brave-core/src/src/brave
# init.js mkdirs brave-core/src/src/brave, which needs brave-core/src/src to
# EXIST FIRST. Our .gclient sat at brave-core/src/.gclient, so gclient cloned
# into _gclient_src_* temp dirs and could never produce src/src.
set -uo pipefail
BASE="/Users/apple/Documents/chrome-cemetery"
SRC="$BASE/brave-core/src"
LOG="$BASE/fix_meta_clone.log"
say(){ echo "[$(date '+%F %T')] $*" | tee -a "$LOG"; }

cd "$BASE" || exit 1

# 1) move the gclient config UP one level: src/.gclient -> brave-core/.gclient
if [ -f "$SRC/.gclient" ] && [ ! -f "$BASE/.gclient" ]; then
  mv "$SRC/.gclient" "$BASE/.gclient"
  say "moved .gclient: src/.gclient -> brave-core/.gclient"
fi
# solution paths are relative to the CONFIG dir now, so "src" = brave-core/src
# (the checkout we already have) and "src/brave" = brave-core/src/src/brave —
# exactly where init.js expects it. Nothing else to rewrite.
grep -n '"name"' "$BASE/.gclient"

# 2) create src/src — the parent init.js mkdirs under. The 6.9GB in
# _gclient_src_* is NOT reusable: gclient's temp naming is per-run, and the
# abandoned attempt left it unlinked from .gclient. Resuming a fresh run with
# the fixed config is the only honest path.
rm -f "$BASE/STOP" "$SRC/sync.status"
mkdir -p "$SRC/src"
say "src/src created -> init.js can now mkdir src/src/brave"
