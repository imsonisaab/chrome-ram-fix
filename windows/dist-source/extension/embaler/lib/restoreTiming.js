// restore-timing: WHEN to re-apply captured state on a restored tab.
// A tab wakes from discard in stages; applying too early is lost to
// framework re-render, too late is a visible flash. This is the pure policy.
'use strict';

/**
 * stage timeline for a wake:
 *   t0  navigationCommit  (blank/new document mounted)
 *   t1  domContentLoaded  (DOM present, scripts may re-render)
 *   t2  load             (all subresources done)
 *   t3  settle           (framework hydration complete — React/Angular/vue settle)
 *
 * applyAt: 'domContentLoaded' | 'load' | 'settle'
 * For SPA frameworks the settle signal is a MutationObserver quiescence.
 */
const DEFAULT_STRATEGY = {
  // Pages whose state lives in framework state get restore after settle.
  spaFrameworks: ['react', 'angular', 'vue', 'svelte', 'ember', 'next'],
  defaultApplyAt: 'settle',
  // If the document looks like a plain form (no framework markers), apply earlier
  formApplyAt: 'domContentLoaded',
};

function detectStrategy(doc, strategy) {
  const s = strategy || DEFAULT_STRATEGY;
  const hasFramework = (s.spaFrameworks || []).some(fw => {
    if (fw === 'react') return !!(doc.querySelector('[data-reactroot], [data-react-cheat]') || (doc.defaultView && doc.defaultView.React));
    if (fw === 'angular') return !!(doc.querySelector('[ng-version]') || doc.querySelector('script[src*="angular"]'));
    if (fw === 'vue') return !!(doc.defaultView && doc.defaultView.Vue);
    return !!doc.defaultView && doc.defaultView[fw];
  });
  return {
    hasFramework,
    applyAt: hasFramework ? s.defaultApplyAt : s.formApplyAt,
  };
}

/**
 * shouldRetry(prev, next, attempt) — a framework re-render may wipe our restore.
 * Retry only while the document is still mutating AND we have attempts left.
 */
function shouldRetry(prevState, observedState, attempt, maxAttempts) {
  if (attempt >= maxAttempts) return false;
  if (!prevState || !observedState) return true;
  // value was wiped -> retry
  if (observedState.value !== prevState.value) return true;
  return false;
}

/* UMD footer: same file works in Node (require) and as a browser script.
   In a browser the exported names land on window. */
;(function (g) {
  var ex = { DEFAULT_STRATEGY, detectStrategy, shouldRetry };
  if (typeof module !== 'undefined' && module.exports) { module.exports = ex; }
  else { g.__UmdBundle = Object.assign(g.__UmdBundle || {}, ex); }
})(typeof globalThis !== 'undefined' ? globalThis : this);
