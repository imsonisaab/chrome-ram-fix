#!/bin/bash
# native-host.sh — launcher for the ChromeRAMFix bridge.
# Chrome invokes this with the extension origin; node must come from a PATH the
# GUI app has (HOME/.hermes/tools first, then system fallbacks).
HOST_DIR="$(cd "$(dirname "$0")" && pwd)"
export CEMETERY_DIR="${CEMETERY_DIR:-$HOST_DIR/../cemetery/data}"
export CEMETERY_BIN="${CEMETERY_BIN:-$HOST_DIR/../cemetery/target/release/cemeteryd}"

for NODE_CANDIDATE in \
  "/Users/apple/.hermes/tools/node-26.7.0-darwin-arm64/bin/node" \
  "$(command -v node)" \
  "/opt/homebrew/bin/node" \
  "/usr/local/bin/node"; do
  if [ -x "$NODE_CANDIDATE" ]; then
    exec "$NODE_CANDIDATE" "$HOST_DIR/native-host.js"
  fi
done
echo "no node found for native host" >&2
exit 127
