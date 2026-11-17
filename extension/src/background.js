// background.js — Governor-driven tab discard worker (MV3 service worker)
// Owns: tab table, pressure subscription, discard decisions, prewarm.
// No framework, no deps. Talks to lib/ via importScripts (extension-root paths).

console.log('[governor] worker starting');
try {
  importScripts('../governor/lib/policy.js', '../governor/lib/pressureClient.js');
  console.log('[governor] imports OK; globalThis.Policy=', typeof globalThis.Policy, 'globalThis.GovernorPressure=', typeof globalThis.GovernorPressure);
} catch (e) {
  console.error('[governor] importScripts FAILED:', e && e.message);
}
var GOVPolicy = (typeof globalThis !== 'undefined' && globalThis.Policy) ? globalThis.Policy
           : (typeof globalThis !== 'undefined' && globalThis.__UmdBundle) ? globalThis.__UmdBundle
           : { decide: function(){return {actions:[]};}, prewarm: function(){return [];} };
var GOVPressure = (typeof globalThis !== 'undefined' && globalThis.GovernorPressure) ? globalThis.GovernorPressure
                    : { async sample(){ return { level:0, freePct:100, swapMB:0, reason:'no-client', source:'fallback' }; } };
console.log('[governor] GOVPolicy=', typeof GOVPolicy, 'decide=', typeof GOVPolicy.decide, 'GP=', typeof GOVPressure);

// (GOVPolicy/GOVPressure now declared above as var)

const CFG = {
  pollMs: 2500,
  maxAttempts: 3,
  // Idle floors are deliberately LONG. A tab discarded while the user is
  // still reading it (or while a response is streaming into it) costs a
  // reload, a re-typing, a dropped SSE stream — that is a net loss. The former
  // reload, a re-typing, a dropped SSE stream — that is a net loss. The former
  // 45 s panic floor fired on tabs the user had literally just left, and it
  // triggered off OTHER apps' memory traffic: on this 16 GB machine swap from
  // unrelated work sat above 500 MB permanently, so the panic rule was
  // effectively always on.
  //
  // There is ONE floor now, 15 min, and pressure never changes it. Two floors
  // were the bug: the short (10 min) one was first keyed to system swap (always
  // true here) and then to the browser's own size, which does not help either —
  // Brave legitimately holds 2.4-2.6 GB on this machine, above the 2048 MB
  // mark, so the 10 min floor was still permanently selected and a tab the user
  // touched 12 minutes ago was discardable.
  discardIdleMs: 15 * 60 * 1000,    // ONE floor: 15 min background idle
  // Kept for diagnostics only (/stats, GOV_STATUS). These numbers describe how
  // loaded the browser is; they never shorten the idle floor.
  pressureBrowserFloorMB: 2048,       // browser >= this MB -> browser is the leak
  pressureLevelFloor: 2,              // L2+ browser level
  bootIdleMs: 30 * 60 * 1000,      // after a SW restart, tabs are presumed idle
  protectAudible: true,            // audio/video playing tabs
  protectPinned: true,
  protectActive: true,             // the focused tab is never touched
  protectTypedMs: 60 * 1000,       // user typed here <60 s ago -> protected
  protectLastAudioMs: 10 * 60 * 1000, // played audio <10 min ago -> protected
  minTabsBeforeDiscard: 6,         // <6 live tabs: nothing is ever discarded
  audioGraceMs: 10 * 60 * 1000,    // policy-side audio grace window
  // Tabs holding a live session we cannot reconstruct. AI consoles mid-reply
  // and streaming video are the two cases that actually cost the user
  // something when cut, so they are protected by URL in addition to the
  // live-socket/DOM-heartbeat signals.
  protectMeetUrls: [               // live sockets / conferencing never die
    'meet.google.com', 'zoom.us', 'teams.microsoft.com', 'web.whatsapp.com',
    'discord.com/channels', 'slack.com', 'whereby.com', 'around.co',
  ],
  protectLiveUrls: [               // AI consoles, streaming, local dev servers
    'chatgpt.com', 'chat.openai.com', 'claude.ai', 'arena.ai', 'gemini.google.com',
    'aistudio.google.com', 'perplexity.ai', 'youtube.com', 'twitch.tv',
    'netflix.com', 'hotstar.com', 'jiohotstar.com', 'meet.google.com',
    'copilot.microsoft.com', 'poe.com', 'huggingface.co',
    'localhost', '127.0.0.1', '0.0.0.0', '[::1]',
  ],
  protectLiveSocket: true,          // open WebSocket / fetch -> do not discard
  busyHeartbeatMs: 60 * 1000,      // DOM mutated <60 s ago -> tab is busy
};

const State = {
  tabs: new Map(),        // tabId -> { id, url, lastActiveAt, rssMB, discarded, pinned, audible, lastTypedAt, liveSocket }
  activeTabId: null,
  pressure: { level: 0, freePct: 100, swapMB: 0, reason: 'normal', source: 'fallback',
              browserMB: 0, browserPct: 0, browserLevel: 0, browserProcs: 0 },
  lastSampleAt: null,
  protectedUrls: new Set(),   // forms mid-edit; populated by content scripts
  wakeCount: 0,
  lastError: null,
  forceTicks: 0,
  warmQueue: [],
  stats: { discarded: 0, restored: 0, reclaimEstimateMB: 0 },
  paused: false,          // set by the context menu
  lastDecision: null,     // why the last pass did (or did not) discard
};

// URLs that hold a live session/stream: killing them loses the session state,
// not just RAM. Covers conferencing (protectMeetUrls) plus AI consoles,
// streaming and local dev servers (protectLiveUrls).
// Matched on hostname, not host: URL.host includes the port, so
// "localhost:3000" would never equal "localhost" and every dev server would
// be discardable.
function isProtectedLiveUrl(url) {
  if (!url) return false;
  try {
    const u = new URL(url);
    const hosts = CFG.protectMeetUrls.concat(CFG.protectLiveUrls);
    return hosts.some(h => u.hostname === h || u.hostname.endsWith('.' + h));
  } catch (_) { return false; }
}

// ---- tab table ------------------------------------------------------------
function upsertTab(tab, explicitAge) {
  const prev = State.tabs.get(tab.id) || { rssMB: 150 };
  State.tabs.set(tab.id, Object.assign(prev, tab, {
    lastActiveAt: explicitAge !== undefined
      ? explicitAge
      : (tab.active ? Date.now() : (prev.lastActiveAt || Date.now())),
  }));
}

async function rebuildTable() {
  const tabs = await chrome.tabs.query({});
  for (const t of tabs) {
    upsertTab({
      id: t.id, url: t.url, pinned: t.pinned,
      audible: t.audible || t.mutedInfo && t.mutedInfo.audible,
      discarded: t.discarded || false,
    });
  }
  // A SW restart has no per-tab "last active" signal from the browser, so the
  // table must be rebuilt with an OLD timestamp for every tab: the worker's own
  // onActivated then ages only the tab the user actually visits. Otherwise a
  // restart marks every tab "just active" and nothing can ever be discarded.
  const boot = Date.now();
  for (const t of State.tabs.values()) {
    t.lastActiveAt = boot - CFG.bootIdleMs;
  }
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  State.activeTabId = active ? active.id : null;
  if (State.activeTabId != null) {
    const cur = State.tabs.get(State.activeTabId);
    if (cur) cur.lastActiveAt = boot;
  }
}

// ---- RSS estimation (processInfo per site: real renderer memory) ----------
// chrome.processes needs the "processes" permission. Without it the API is
// absent, every estimate below silently stays at the 150 MB default, and the
// popup reports "RAM tracked: 0 MB" forever. Detect it once, report it.
const HAS_PROCESSES_API = !!(typeof chrome !== 'undefined' && chrome.processes
  && typeof chrome.processes.getProcessInfo === 'function');
function rssLive() {
  let live = 0;                      // REAL total of live (non-discarded) tabs
  let est = 0;                       // tabs still on the 150 MB default
  for (const t of State.tabs.values()) {
    if (t.discarded) continue;
    if (t.rssReal) live += t.rssMB; else est += 1;
  }
  return { liveMB: Math.round(live), estimatedTabs: est };
}
async function refreshRss() {
  if (!HAS_PROCESSES_API) { State.lastError = State.lastError || 'processes-api-absent'; return; }
  try {
    const infos = await chrome.processes.getProcessInfo(null, true);
    const bySite = new Map();
    for (const p of (infos || [])) {
      for (const t of (p.tabs || [])) {
        bySite.set(t.tabId, Math.round((p.privateMemory || 0) / 1048576));
      }
    }
    for (const [id, tab] of State.tabs) {
      if (bySite.has(id)) { tab.rssMB = bySite.get(id); tab.rssReal = true; }
    }
  } catch (_) { /* processes API absent -> keep estimates */ }
}

// ---- cemetery store bridge -------------------------------------------------
// Persistent compressed snapshots live in the Rust store (cemeteryd) reached via
// the native messaging host. chrome.storage.session is the volatile hot copy.
const STORE_AVAILABLE = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendNativeMessage) ? true : false;

function storePut(key, state) {
  if (!STORE_AVAILABLE) return Promise.resolve(false);
  return new Promise((resolve) => {
    chrome.runtime.sendNativeMessage('com.chrome_ram_fix.bridge', {
      cmd: 'put', key: key,
      payload: btoa(unescape(encodeURIComponent(JSON.stringify(state)))),
    }, (reply) => {
      resolve(!!(reply && reply.ok));
    });
  });
}

function storeWarm(n) {
  if (!STORE_AVAILABLE) return Promise.resolve([]);
  return new Promise((resolve) => {
    chrome.runtime.sendNativeMessage('com.chrome_ram_fix.bridge', { cmd: 'warm', n: n }, (reply) => {
      resolve((reply && reply.keys) || []);
    });
  });
}

function storeGet(key) {
  if (!STORE_AVAILABLE) return Promise.resolve(null);
  return new Promise((resolve) => {
    chrome.runtime.sendNativeMessage('com.chrome_ram_fix.bridge', { cmd: 'get', key: key }, (reply) => {
      if (chrome.runtime.lastError || !reply) return resolve(null);
      if (reply.payload) {
        try {
          let p = JSON.parse(atob(reply.payload));
          // payload is {url, at, state}; pass through the whole envelope
          resolve(p.state ? p : { url: p.url, state: p });
        } catch (e) { resolve(null); }
      } else resolve(null);
    });
  });
}

// FNV-1a 32-bit, same as cemetery::key_for — one slot per URL
function storeKeyFor(url) {
  let h = 0x811c9dc5;
  for (let i = 0; i < url.length; i++) {
    h ^= url.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

// predictive wake: before discarding, ask the store which keys are coldest and
// have them warm so the next click restores in <200ms
async function predictWarm() {
  try {
    const keys = await storeWarm(3);
    if (keys.length) State.warmQueue = keys;
  } catch (_) { State.warmQueue = []; }
}

// ---- the discard/reawaken cycle ------------------------------------------
async function tick() {
  // Paused via the context menu: no sampling, no decisions, nothing touched.
  if (State.paused) return;
  let snap;
  try {
    snap = await GOVPressure.sample();
  } catch (e) {
    State.lastError = String((e && e.message) || e);
    // Keep the last known browser footprint: the popup must not flip to "—"
    // and lose the browser number just because one sample failed.
    const prev = State.pressure || {};
    snap = { level: prev.level ?? 0, freePct: prev.freePct ?? 100, swapMB: prev.swapMB ?? 0,
             reason: prev.reason ?? 'stale', source: 'stale',
             browserMB: prev.browserMB ?? 0, browserPct: prev.browserPct ?? 0,
             browserLevel: prev.browserLevel ?? 0, browserProcs: prev.browserProcs ?? 0 };
  }
  State.pressure = snap;
  State.lastSampleAt = Date.now();

  await predictWarm();
  await refreshRss();   // real per-tab RSS before any discard decision

  // "Under pressure" = the BROWSER is under pressure -- nothing else.
  //
  // State.pressure.level is already browser-scoped by machPressure.js sample()
  // (browserPct of total RAM), because the extension can only ever discard
  // browser tabs. Feeding it a SYSTEM-wide number was the bug that made this
  // engine dangerous: on a 16 GB machine running Hermes + OmniRoute + Chrome,
  // the kernel's swap debt sits at 6-8 GB permanently, so the old
  // `swapMB >= 1024` term pinned the 10-minute panic floor ON forever. Every
  // background tab therefore qualified 10 minutes after the user last touched
  // it, even while Brave itself held only 13% of RAM.
  //
  // Rule: a tab is only reclaimed when the BROWSER is the thing in trouble.
  // Another app's memory traffic is that app's problem; the browser's tabs are
  // the user's work and must not pay for it.
  const now = Date.now();
  // ONE idle floor: 15 minutes. It does not move with pressure.
  //
  // Two floors were the bug. The short (10 min) floor used to be selected by
  // system swap -- 6.5-8 GB permanently on this machine, so it was always on.
  // It was then re-keyed to the browser's own size, which does not help
  // either: Brave legitimately holds 2.4-2.6 GB here, i.e. above the 2048 MB
  // threshold, so the 10 min floor was still permanently active and a tab
  // touched 12 minutes ago was discardable.
  //
  // A shorter floor only pays off in a real emergency, and every real
  // emergency is already covered by gates that do not depend on timing:
  //   - fewer than CFG.minTabsBeforeDiscard live tabs -> nothing is discarded
  //   - the active tab, pinned tabs, audible tabs -> never discarded
  //   - tabs inside audioGraceMs / busyHeartbeatMs -> never discarded
  //   - tabs matching protectLiveUrls -> never discarded
  // What remains is genuinely forgotten background tabs. Waiting 15 minutes
  // instead of 10 costs nothing; discarding one costs the user a reload.
  const idleFloor = CFG.discardIdleMs;

  const liveTabCount = [...State.tabs.values()].filter(t => !t.discarded).length;

  const tabs = [...State.tabs.values()].map(t => {
    const age = now - (t.lastActiveAt || 0);
    // typed-in-the-last-60s, live-socket, live-URL, busy-DOM and recently
    // audible tabs are all protected like pinned ones.
    const typedRecently = (t.lastTypedAt && now - t.lastTypedAt < CFG.protectTypedMs);
    const liveUrl = CFG.protectLiveSocket && isProtectedLiveUrl(t.url);
    const busyDom = (t.lastDomMutAt && now - t.lastDomMutAt < CFG.busyHeartbeatMs);
    const audioRecent = (t.lastAudioAt && now - t.lastAudioAt < CFG.protectLastAudioMs);
    return {
      id: t.id, url: t.url, lastActiveAt: t.lastActiveAt,
      lastAudioAt: t.lastAudioAt || 0,
      rssMB: t.rssMB, discarded: t.discarded,
      // `pinned` means exactly one thing: the user pinned this tab.
      pinned: CFG.protectPinned && !!t.pinned,
      audible: CFG.protectAudible && t.audible,
      // Live-session guards are their OWN fields. Folding them into `pinned`
      // (the old code) meant turning off pin protection also silently
      // disabled AI/stream/busy-DOM/audio protection -- the four guards that
      // actually stop a mid-generation tab from being cut. The policy refuses
      // to discard a tab when any of these is set, independent of each other.
      liveGuard: !!(typedRecently || t.liveSocket || liveUrl || busyDom || audioRecent),
      typedRecently: !!typedRecently,
      liveUrl: !!liveUrl,
      liveSocket: !!t.liveSocket,
      busyDom: !!busyDom,
      audioRecent: !!audioRecent,
      ageMs: age,
      idleMs: idleFloor,
      protected: !!(typedRecently || liveUrl || busyDom || audioRecent),
    };
  });

  const decision = GOVPolicy.decide(State.pressure, tabs, {
    now: Date.now(),
    activeTabId: CFG.protectActive ? State.activeTabId : null,
    protectedUrls: [...State.protectedUrls],
    minTabsBeforeDiscard: CFG.minTabsBeforeDiscard,
    audioGraceMs: CFG.audioGraceMs,
  });
  State.lastDecision = { reason: decision.reason, liveTabs: liveTabCount,
                         minTabs: CFG.minTabsBeforeDiscard, idleFloor, at: now };

  for (const a of decision.actions) {
    if (a.type !== 'discard') continue;
    const tab = State.tabs.get(a.tabId);
    if (!tab || tab.discarded) continue;
    if (Date.now() - (tab.lastActiveAt || 0) < idleFloor) continue; // too young
    // Last-line guards, independent of the policy's own arithmetic: a
    // manually protected tab, an active-socket tab, a busy-DOM tab or a tab
    // that just produced audio is never discarded, at any level.
    if (State.protectedUrls.has(tab.url)) continue;
    if (tab.liveSocket) continue;
    if (tab.lastDomMutAt && Date.now() - tab.lastDomMutAt < CFG.busyHeartbeatMs) continue;
    if (tab.lastAudioAt && Date.now() - tab.lastAudioAt < CFG.protectLastAudioMs) continue;

    // Embaler bridge: capture BEFORE the discard (MV3: background owns the capture
    // call; content script is dead once discarded, so we capture via CDP-lite here).
    try {
      await captureAndMark(tab);
      await chrome.tabs.discard(a.tabId);
      tab.discarded = true;
      State.stats.discarded += 1;
      State.stats.reclaimEstimateMB += tab.rssMB;
    } catch (e) {
      console.warn('discard failed', a.tabId, e);
    }
  }
}

async function captureAndMark(tab) {
  // Snapshot: we ask the tab to dump its own state, then stash by tabId+url.
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { type: 'EMBAL_CAPTURE' });
    if (res && res.state) {
      const bag = await chrome.storage.session.get({ snapshots: {} });
      bag.snapshots[tab.id] = { url: tab.url, at: Date.now(), state: res.state };
      await chrome.storage.session.set({ snapshots: bag.snapshots });
      // durable copy in the compressed Rust store (survives browser restart)
      storePut(storeKeyFor(tab.url), { url: tab.url, at: Date.now(), state: res.state });
    }
  } catch (_) { /* tab mid-navigation: capture skipped, discard still safe */ }
}

async function prewarmFrom(events) {
  const discarded = [...State.tabs.values()].filter(t => t.discarded)
    .map(t => ({ id: t.id, url: t.url }));
  for (const p of GOVPolicy.prewarm(events, discarded)) {
    const t = await chrome.tabs.get(p.tabId).catch(() => null);
    if (t && t.discarded) { await chrome.tabs.reload(p.tabId); State.stats.restored += 1; }
  }
}

// ---- message plumbing -----------------------------------------------------
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.type === 'EMBAL_PROTECT_URL') {
    if (msg.on) State.protectedUrls.add(msg.url); else State.protectedUrls.delete(msg.url);
    reply({ ok: true });
  }
  if (msg.type === 'EMBAL_WAKE_SNAPSHOT') {
    // content.js' hydrate.js asks this at document_start of a waking tab.
    // The Rust store is the source of truth (0.2 ms mmap read); chrome.storage
    // .session is only a fallback when the native host is unavailable.
    (async () => {
      const snap = await storeGet(storeKeyFor(msg.url));
      if (snap) { reply({ state: snap }); return; }
      try {
        const bag = await chrome.storage.session.get({ snapshots: {} });
        const hit = Object.values(bag.snapshots || {}).find(s => s.url === msg.url);
        reply(hit ? { state: hit.state && hit.state.url ? hit : { url: hit.url, state: hit.state } } : {});
      } catch (_) { reply({}); }
    })();
    return true;
  }
  if (msg.type === 'EMBAL_TYPED') {
    // tab-specific typing ping: mark THIS url's tabs as recently typed so the
    // discard skip below keeps them alive.
    const t = Date.now();
    for (const tab of State.tabs.values()) if (tab.url === msg.url) tab.lastTypedAt = t;
    return true;
  }
  if (msg.type === 'EMBAL_LIVE_SOCKET') {
    for (const tab of State.tabs.values()) if (tab.url === msg.url) tab.liveSocket = !!msg.on;
    reply({ ok: true });
    return true;
  }
  if (msg.type === 'EMBAL_BUSY') {
    // Active-stream heartbeat: the page's DOM changed in the last sampling
    // window (an AI answer still arriving, a video advancing, a build log
    // streaming). Mark THIS url's tabs busy so the discard skip above holds.
    const t = Date.now();
    for (const tab of State.tabs.values()) {
      if (tab.url === msg.url) tab.lastDomMutAt = t;
    }
    reply({ ok: true });
    return true;
  }
  if (msg.type === 'EMBAL_AUDIO') {
    // Audio state changed in a tab: remembered as a timestamp, so a tab that
    // was audible in the last 10 minutes stays protected even after it goes
    // quiet (a paused stream is still a stream the user is returning to).
    for (const tab of State.tabs.values()) {
      if (tab.url === msg.url) {
        tab.lastAudioAt = msg.on ? Date.now() : (tab.lastAudioAt || 0);
        if (msg.on) tab.audible = true;
      }
    }
    reply({ ok: true });
    return true;
  }
  if (msg.type === 'GOV_PAUSE') {
    State.paused = !!msg.on;
    reply({ ok: true, paused: State.paused });
    return true;
  }
  if (msg.type === 'GOV_PROTECT_TAB') {
    const t = State.tabs.get(msg.tabId);
    const url = (t && t.url) || msg.url;
    if (msg.on) State.protectedUrls.add(url); else State.protectedUrls.delete(url);
    reply({ ok: true, url });
    return true;
  }
  if (msg.type === 'EMBAL_PROXIMITY') {
    prewarmFrom([{ type: 'proximity', tabId: msg.tabId, index: msg.windowIndex, distanceMs: msg.distanceMs }]);
    reply({ ok: true });
  }
  if (msg.type === 'PING') { reply({ ok: true, ts: Date.now() }); return true; }
  if (msg.type === 'GOV_FORCE_TICK') {
    State.forceTicks += 1;
    tick().then(() => reply({ ok: true, tickedAt: Date.now(), forceTicks: State.forceTicks }))
          .catch(e => reply({ ok: false, error: String(e && e.message) }));
    return true;
  }
  if (msg.type === 'GOV_STATUS') {
    try {
      reply({
        pressure: State.pressure, stats: State.stats, tabs: State.tabs.size,
        source: State.pressure && State.pressure.source,
        lastSampleAt: State.lastSampleAt || null,
        lastError: State.lastError, forceTicks: State.forceTicks,
        warmQueue: State.warmQueue, storeBridge: STORE_AVAILABLE,
        rssLiveMB: rssLive(), processesApi: HAS_PROCESSES_API,
        keepAlive: keepAliveAlive, pollMs: CFG.pollMs,
        alarmsFloorMin: 1,
        paused: State.paused, lastDecision: State.lastDecision,
        protectedUrls: [...State.protectedUrls],
      });
    } catch (e) {
      console.error('[governor] GOV_STATUS err', e && e.message);
      reply({ pressure: {level:0,freePct:100,swapMB:0,reason:'worker-error',source:'error'}, stats:{discarded:0,restored:0}, tabs:0, source:'error', lastSampleAt:null });
    }
  }
  return true;
});

// ---- silent context menu (no toolbar popup, no visible UI) -----------------
// The engine is invisible: no icon, no panel, no popup. The only controls are
// two right-click entries on a page, so a user can always reach a stop switch.
// chrome.contextMenus is idempotent per id, so a worker restart is safe.
function buildContextMenus() {
  if (typeof chrome === 'undefined' || !chrome.contextMenus) return;
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'cemetery-pause', title: 'Pause / Resume ChromeRAMFix',
      contexts: ['page'],
    });
    chrome.contextMenus.create({
      id: 'cemetery-protect', title: 'Protect this tab from sleep',
      contexts: ['page'],
    });
  });
}
buildContextMenus();
if (chrome.contextMenus && chrome.contextMenus.onClicked) {
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (!tab) return;
    if (info.menuItemId === 'cemetery-pause') {
      State.paused = !State.paused;
      badgeState();
      return;
    }
    if (info.menuItemId === 'cemetery-protect') {
      const t = State.tabs.get(tab.id);
      const url = (t && t.url) || tab.url;
      if (url) {
        if (State.protectedUrls.has(url)) State.protectedUrls.delete(url);
        else State.protectedUrls.add(url);
      }
    }
  });
}

// Clicking the toolbar icon toggles pause/resume. The engine is silent by
// design (no popup), so a left click on the icon is the only one-click
// affordance there is — without this handler the icon is a dead button and
// the user has no way to stop it short of the right-click menu.
if (chrome.action && chrome.action.onClicked) {
  chrome.action.onClicked.addListener(() => {
    State.paused = !State.paused;
    badgeState();
    try { chrome.action.setBadgeText({ text: State.paused ? 'II' : '' }); } catch (_) {}
  });
}

// Badge on the toolbar icon: "II" while paused, blank while running. No
// popup, no panel, but the pause state must never be invisible — a user who
// thinks the engine is still active after pausing it is being lied to.
function badgeState() {
  if (typeof chrome === 'undefined' || !chrome.action) return;
  try {
    if (State.paused) {
      chrome.action.setBadgeBackgroundColor({ color: '#888888' });
      chrome.action.setBadgeText({ text: 'II' });
      chrome.action.setTitle({ title: 'ChromeRAMFix — paused' });
    } else {
      chrome.action.setBadgeText({ text: '' });
      chrome.action.setTitle({ title: 'ChromeRAMFix' });
    }
  } catch (_) { /* action API guard: non-critical */ }
}
badgeState();

// ---- lifecycle ------------------------------------------------------------
chrome.tabs.onCreated.addListener(t => upsertTab({ id: t.id, url: t.url, pinned: t.pinned }));
chrome.tabs.onUpdated.addListener((id, info, t) => {
  upsertTab({ id, url: t.url, pinned: t.pinned, discarded: t.discarded, audible: t.audible });
  if (!t.discarded) State.protectedUrls.delete(t.url);
});
chrome.tabs.onRemoved.addListener(id => { State.tabs.delete(id); State.protectedUrls.delete(urlOf(id)); });
function urlOf(id) { const t = State.tabs.get(id); return t ? t.url : null; }

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  State.activeTabId = tabId;
  const t = State.tabs.get(tabId);
  if (t) { t.lastActiveAt = Date.now(); if (!t.discarded) State.protectedUrls.delete(t.url); }
});

// chrome.alarms is clamped to 1 minute minimum by the browser, so CFG.pollMs
// (2.5 s) can never be honoured through the alarm API alone. A discarded tab
// then waits up to a minute for a reclaim pass — exactly the wrong latency
// when a heavy page (game, video, CAD) spikes memory.
//
// The MV3-correct answer is a keepalive port: an open chrome.runtime.connect
// port keeps THIS service worker alive and delivers an immediate message each
// time any page warm_starts. The content script holds the port open; while it
// is open the worker stays resident and setInterval actually runs at pollMs.
// If every port closes (no tabs running the content script) the worker sleeps
// and the 1-minute alarm remains the floor.
let keepAliveAlive = false;
let keepAliveLastMsg = 0;
chrome.runtime.onConnect.addListener((port) => {
  if (!port || port.name !== 'govKeepAlive') return;
  keepAliveAlive = true;
  const beat = setInterval(() => {
    keepAliveLastMsg = Date.now();
    try { port.postMessage({ type: 'GOV_PING', t: keepAliveLastMsg }); } catch (_) { /* port closed */ }
  }, 20000);                       // 20 s heartbeat; the port is the keepalive
  port.onDisconnect.addListener(() => {
    clearInterval(beat);
    keepAliveAlive = false;
  });
  port.onMessage.addListener((m) => {
    if (m && m.type === 'GOV_WAKE') tick();   // page warm-start: discard now
  });
});

chrome.alarms.create('govTick', { periodInMinutes: 1 });   // browser floor: 1 min
chrome.alarms.onAlarm.addListener(a => { if (a.name === 'govTick') tick(); });

let liveTimer = null;
function armLiveTimer() {
  if (liveTimer) return;
  liveTimer = setInterval(tick, CFG.pollMs);
}
function disarmLiveTimer() {
  if (!liveTimer) return;
  clearInterval(liveTimer);
  liveTimer = null;
}
chrome.tabs.onActivated.addListener(() => { disarmLiveTimer(); });   // event-driven wake
rebuildTable().then(() => {
  console.log('[governor] table rebuilt, tabs=', State.tabs.size);
  // While a keepalive port is open the worker is resident: sample at pollMs.
  // Otherwise rely on the 1-minute alarm (the browser's floor).
  armLiveTimer();
}).catch(e => console.error('[governor] rebuildTable failed:', e && e.message));
console.log('[governor] worker up', new Date().toISOString());
