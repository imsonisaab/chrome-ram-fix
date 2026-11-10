#!/bin/bash
# run-governor.sh — launchd entry point for the Cemetery governor daemon.
# Resolves its own node (GUI/launchd apps get no shell PATH) and the repo root,
# then execs the pressure daemon on :8795. Never writes inside the repo.
set -u
HERE="$(cd "$(dirname "$(readlink -f "$0" 2>/dev/null || echo "$0")")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
LOG_DIR="$HOME/Library/Logs/BraveCemetery"
mkdir -p "$LOG_DIR" "$HOME/Library/Application Support/BraveCemetery/store" 2>/dev/null
export CEMETERY_DIR="${CEMETERY_DIR:-$HOME/Library/Application Support/BraveCemetery/store}"
export GOVERNOR_PORT="${GOVERNOR_PORT:-8795}"

NODE_BIN=""
for n in $(command -v node) \
         /usr/local/bin/node /opt/homebrew/bin/node /usr/bin/node; do
  [ -x "$n" ] && NODE_BIN="$n" && break
done
[ -n "$NODE_BIN" ] || { echo "node not found" >&2; exit 1; }
exec "$NODE_BIN" "$ROOT/governor/daemon.js"
