// security.js — what the Embalmer must NEVER capture, and what must never be restored.
// Kept as one pure, auditable module: this is the trust boundary of the whole system.
'use strict';

const NEVER_CAPTURE_TYPES = new Set([
  'password', 'hidden', 'file', 'image', 'submit', 'button', 'reset',
]);

// Field names that signal PII/credentials even with a benign type attribute.
// Triggers: otp_code, cc_number, userCVV, Aadhaar_Number, session_token.
// Must NOT trigger: classic_name, scanner_pan (false-friend words).
// Border before = word char that is not part of a longer alpha run, i.e. we
// also treat a lower->UPPER transition as a boundary (camelCase).
const SENSITIVE_NAME = /(^|[^a-z]|[a-z](?=[A-Z]))(password|passwd|pass|pwd|secret|token|otp|cvv|cvc|cc|cardnum|cardnum|card|ccnum|iban|ssn|aadhaar|pan)([^a-z]|$)/i;

// Autocomplete tokens browsers themselves treat as sensitive.
const SENSITIVE_AUTOCOMPLETE = /\b(current-password|new-password|cc-number|cc-csc|cc-exp|cc-name)\b/i;

/** capture(el) or null — null means "skip this element entirely". */
function shouldCapture(el) {
  if (!el) return false;
  if (el.tagName === 'TEXTAREA') {
    return !(el.getAttribute('data-sensitive') === 'true');
  }
  if (el.tagName !== 'INPUT') return false;
  const type = (el.getAttribute('type') || 'text').toLowerCase();
  if (NEVER_CAPTURE_TYPES.has(type)) return false;
  if (SENSITIVE_NAME.test(el.getAttribute('name') || '')) return false;
  if (SENSITIVE_NAME.test(el.getAttribute('id') || '')) return false;
  if (SENSITIVE_AUTOCOMPLETE.test(el.getAttribute('autocomplete') || '')) return false;
  if (el.getAttribute('data-sensitive') === 'true') return false;
  return true;
}

/** Storage keys that must be dropped before persisting a snapshot. */
function sanitizeStorage(bag) {
  const out = {};
  for (const [k, v] of Object.entries(bag || {})) {
    if (SENSITIVE_NAME.test(k)) continue;
    // sessions/auth/payment markers are deliberately kept ONLY when the
    // chrome storage.sync/hosted-auth flow manages them itself.
    out[k] = v;
  }
  return out;
}

/* UMD footer: same file works in Node (require) and as a browser script.
   In a browser the exported names land on window. */
;(function (g) {
  var ex = { shouldCapture, sanitizeStorage, SENSITIVE_NAME, NEVER_CAPTURE_TYPES };
  if (typeof module !== 'undefined' && module.exports) { module.exports = ex; }
  else { g.__UmdBundle = Object.assign(g.__UmdBundle || {}, ex); }
})(typeof globalThis !== 'undefined' ? globalThis : this);
