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
  // Smart pressure tuning — a real user kills a tab 3-5 min after they leave
  // it; earlier than that and you resurrect tabs they were still reading.
  // Aggressive idle policy: 2 minutes background idle -> eligible; 45 seconds
  // when the kernel is already swapping hard (swap > 500 MB) or at pressure
  // >= L1. Below 2 min users lose tabs they were still reading.
  discardIdleMs: 2 * 60 * 1000,     // 2 min background idle -> eligible
  discardIdlePressureMs: 45 * 1000, // swap>500MB or pressure>=L1: 45 s rule
  pressureSwapFloorMB: 500,         // swap above this = "under pressure" early
  pressureLevelFloor: 1,            // kernel pressure >= L1 = "under pressure"
  bootIdleMs: 30 * 60 * 1000,      // after a SW restart, tabs are presumed idle
  protectAudible: true,            // audio/video playing tabs
  protectPinned: true,
  protectActive: true,             // the focused tab is never touched
  protectTypedMs: 60 * 1000,       // user typed here <60 s ago -> protected
  protectMeetUrls: [               // live sockets / conferencing never die
    'meet.google.com', 'zoom.us', 'teams.microsoft.com', 'web.whatsapp.com',
    'discord.com/channels', 'slack.com', 'whereby.com', 'around.co',
  ],
  protectLiveSocket: true,          // open WebSocket / fetch -> do not discard
};

const State = {
  tabs: new Map(),        // tabId -> { id, url, lastActiveAt, rssMB, discarded, pinned, audible, lastTypedAt, liveSocket }
  activeTabId: null,
  pressure: { level: 0, freePct: 100, swapMB: 0, reason: 'normal', source: 'fallback' },
  lastSampleAt: null,
  protectedUrls: new Set(),   // forms mid-edit; populated by content scripts
  wakeCount: 0,
  lastError: null,
  forceTicks: 0,
  warmQueue: [],
  stats: { discarded: 0, restored: 0, reclaimEstimateMB: 0 },
};

// URLs that hold a live session/stream: killing them loses the session state,
// not just RAM. Derived from CFG.protectMeetUrls.
function isProtectedLiveUrl(url) {
  if (!url) return false;
  try {
    const u = new URL(url);
    return CFG.protectMeetUrls.some(h => u.host === h || u.host.endsWith('.' + h));
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
  let snap;
  try {
    snap = await GOVPressure.sample();
  } catch (e) {
    State.lastError = String((e && e.message) || e);
    snap = { level: State.pressure.level, freePct: State.pressure.freePct, swapMB: State.pressure.swapMB, reason: State.pressure.reason, source: 'stale' };
  }
  State.pressure = snap;
  State.lastSampleAt = Date.now();

  await predictWarm();
  await refreshRss();   // real per-tab RSS before any discard decision

  const now = Date.now();
  // "Under pressure" = kernel pressure >= L1 OR swap already over the floor.
  // Either one drops the idle floor to the aggressive 45 s rule.
  const underPressure = State.pressure.level >= CFG.pressureLevelFloor
    || State.pressure.swapMB >= CFG.pressureSwapFloorMB;
  const idleFloor = underPressure ? CFG.discardIdlePressureMs : CFG.discardIdleMs;

  const tabs = [...State.tabs.values()].map(t => {
    const age = now - (t.lastActiveAt || 0);
    // typed-in-the-last-60s and live-socket tabs are protected like pinned ones
    const typedRecently = (t.lastTypedAt && now - t.lastTypedAt < CFG.protectTypedMs);
    const liveUrl = CFG.protectLiveSocket && isProtectedLiveUrl(t.url);
    return {
      id: t.id, url: t.url, lastActiveAt: t.lastActiveAt,
      rssMB: t.rssMB, discarded: t.discarded,
      pinned: CFG.protectPinned && (t.pinned || typedRecently || t.liveSocket || liveUrl),
      audible: CFG.protectAudible && t.audible,
      ageMs: age,
      idleMs: idleFloor,
      protected: typedRecently || liveUrl,   // reason tag for UI/telemetry
    };
  });

  const decision = GOVPolicy.decide(State.pressure, tabs, {
    now: Date.now(),
    activeTabId: CFG.protectActive ? State.activeTabId : null,
    protectedUrls: [...State.protectedUrls],
  });

  for (const a of decision.actions) {
    if (a.type !== 'discard') continue;
    const tab = State.tabs.get(a.tabId);
    if (!tab || tab.discarded) continue;
    if (Date.now() - (tab.lastActiveAt || 0) < idleFloor) continue; // too young

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
      });
    } catch (e) {
      console.error('[governor] GOV_STATUS err', e && e.message);
      reply({ pressure: {level:0,freePct:100,swapMB:0,reason:'worker-error',source:'error'}, stats:{discarded:0,restored:0}, tabs:0, source:'error', lastSampleAt:null });
    }
  }
  return true;
});

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
