#!/bin/bash
# make_browser_libs.sh — make the embaler/governor libs loadable BOTH in Node
# (tests, daemon) and as plain <script> tags / importScripts (extension).
# Rewrites CommonJS module.exports to a UMD footer. Idempotent.
set -euo pipefail
cd /Users/apple/Documents/chrome-cemetery

umd_footer() {
  # $1 = exports object name list, e.g. "Embalmer" or "{ foo, bar }"
  cat <<EOF

/* UMD footer: same file works in Node (require) and as a browser script.
   In a browser the exported names land on window. */
;(function (g) {
  var ex = $1;
  if (typeof module !== 'undefined' && module.exports) { module.exports = ex; }
  else { g.__UmdBundle = Object.assign(g.__UmdBundle || {}, ex); }
})(typeof globalThis !== 'undefined' ? globalThis : this);
EOF
}

fix_file() {
  local file="$1"; shift
  local names="$1"; shift
  local tmp
  tmp="$(mktemp)"
  python3 - "$file" "$names" <<'PY'
import re, sys
path, names = sys.argv[1], sys.argv[2]
s = open(path).read()
# strip existing CommonJS footer lines and any prior UMD footer
s = re.sub(r"\n*/\* UMD footer.*?\}\)\([^\n]*\);\n", "\n", s, flags=re.S)
s = re.sub(r"\nif \(typeof module !== 'undefined'.*?module\.exports = .*?;\n", "\n", s, flags=re.S)
s = re.sub(r"\nmodule\.exports = .*?;\n", "\n", s)
open(path, 'w').write(s.rstrip() + "\n")
PY
  printf '%s' "$(cat "$tmp")" > /dev/null
  umd_footer "$names" >> "$file"
  rm -f "$tmp"
  echo "  fixed $file -> $names"
}

# Canonical location is extension/ (those files ship inside the .app).
# This script only re-applies the UMD footer in place; it never copies between
# trees, so the extension's v3 capture.js can never be clobbered by a stale copy.
echo "canonical (extension) copies:"
fix_file extension/embaler/lib/security.js "{ shouldCapture, sanitizeStorage, SENSITIVE_NAME, NEVER_CAPTURE_TYPES }"
fix_file extension/embaler/lib/capture.js "{ Embalmer, setEscape }"
fix_file extension/embaler/lib/restoreTiming.js "{ DEFAULT_STRATEGY, detectStrategy, shouldRetry }"
fix_file governor/lib/policy.js "{ decide, prewarm }"
fix_file governor/lib/machPressure.js "{ vmStat, swapUsage, classify, sample }"

# Mirror the governor libs into the extension so one set of files ships with the .app
cp governor/lib/policy.js extension/governor/lib/policy.js
cp governor/lib/machPressure.js extension/governor/lib/machPressure.js
echo "  governor mirrored"

echo "tests (must still pass):"
export PATH="/Users/apple/.hermes/tools/node-26.7.0-darwin-arm64/bin:$PATH"
node --test tests/capture.test.js governor/tests/policy.test.js governor/tests/pressure.test.js 2>&1 | grep -E "^ℹ (tests|pass|fail)"
