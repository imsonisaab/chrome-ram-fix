// Governor decision policy — which tabs to discard at which pressure level.
// Pure function: (pressure, tabs) -> { actions: [...], prewarm: [...] }
'use strict';

/**
 * tabs: [{ id, url, title, lastActiveAt, lastAudioAt, rssMB, discarded, pinned, audible }]
 * pressure: { level, freePct, swapMB, reason }
 *
 * Policy (coldest = least-recently-active first):
 *   level 0-1 : nothing (1 = cache trim hint only)
 *   level 2   : discard coldest until projected reclaim >= 25% of tab RSS
 *   level 3   : discard aggressively (target >= 60% of non-discarded tabs)
 *   level 4   : discard everything discardable + signal emergency
 * Never discards: the active (focused) tab, pinned tabs, audible tabs, or
 *   tabs that played audio within `audioGraceMs`.
 *
 * HARD FLOOR (minTabsBeforeDiscard): if the browser is holding fewer than
 * minTabsBeforeDiscard live tabs, discarding is refused outright. A user
 * working with 2-5 open tabs has no forgotten background furniture — those
 * tabs are the work. L4 from other apps' memory traffic must not cost them a
 * reload. Default 6, i.e. 6+ tabs before anything is eligible at all.
 */
const DEFAULTS = { minTabsBeforeDiscard: 6, audioGraceMs: 10 * 60 * 1000 };

function decide(pressure, tabs, opts) {
  const now = (opts && opts.now) || Date.now();
  const activeTabId = (opts && opts.activeTabId) || null;
  const protectedUrls = (opts && opts.protectedUrls) || []; // forms mid-edit, calls
  const minTabs = (opts && opts.minTabsBeforeDiscard) ?? DEFAULTS.minTabsBeforeDiscard;
  const audioGraceMs = (opts && opts.audioGraceMs) ?? DEFAULTS.audioGraceMs;
  const actions = [];
  const live = tabs.filter(t => t && !t.discarded);
  if (pressure.level < 2 || live.length === 0) {
    return { actions, projectedReclaimMB: 0, reason: 'no-discard' };
  }

  // Not enough tabs open: a handful of live tabs is the user's current work,
  // not reclaimable background. No level, no swap, overrides this.
  if (live.length < minTabs) {
    return { actions: [], projectedReclaimMB: 0,
             reason: `too-few-tabs (${live.length}/${minTabs})`,
             liveTabs: live.length, minTabsBeforeDiscard: minTabs };
  }

  const protectedIds = new Set([activeTabId]);
  const protectedUrlSet = new Set(protectedUrls);
  const audioGrace = (t) => t.lastAudioAt && (now - t.lastAudioAt) < audioGraceMs;

  let candidates = live
    .filter(t => !protectedIds.has(t.id) && !protectedUrlSet.has(t.url))
    .filter(t => !t.pinned && !t.audible && !audioGrace(t))
    .sort((a, b) => (a.lastActiveAt - b.lastActiveAt)); // coldest first

  const totalRssMB = candidates.reduce((s, t) => s + (t.rssMB || 150), 0);
  const target = pressure.level === 2 ? totalRssMB * 0.25
              : pressure.level === 3 ? totalRssMB * 0.60
              : totalRssMB; // level 4: everything eligible

  let projected = 0;
  for (const t of candidates) {
    if (projected >= target && pressure.level !== 4) break;
    actions.push({ type: 'discard', tabId: t.id, url: t.url, reason: pressure.reason });
    projected += (t.rssMB || 150);
  }

  return { actions, projectedReclaimMB: Math.round(projected), reason: pressure.reason, level: pressure.level };
}

/** Prewarm: which discarded tabs to warm before the user likely returns.
 *  proximity = pointer/switch activity observed near that tab's stripe. */
function prewarm(events, discardedTabs) {
  const out = [];
  for (const ev of events || []) {
    if (ev.type !== 'proximity') continue;
    const tab = discardedTabs.find(t => t.id === ev.tabId || t.windowIndex === ev.index);
    if (tab && !out.includes(tab.id)) {
      out.push({ tabId: tab.id, url: tab.url, priority: ev.distanceMs < 150 ? 'high' : 'normal' });
    }
  }
  return out;
}

/* UMD footer: same file works in Node (require) and as a browser script.
   In a browser the exported names land on window. */
;(function (g) {
  var ex = { decide, prewarm };
  g.Policy = ex;
  if (typeof module !== 'undefined' && module.exports) { module.exports = ex; }
  else { g.__UmdBundle = Object.assign(g.__UmdBundle || {}, ex); }
})(typeof globalThis !== 'undefined' ? globalThis : this);
