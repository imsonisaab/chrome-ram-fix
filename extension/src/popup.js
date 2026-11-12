// popup.js — status panel. Browser numbers first; system numbers are context only.
// The point of this panel is the browser's own footprint, because that is the
// only thing the engine can influence. System-wide totals are shown small and
// labelled as system, so a user never mistakes a machine-wide number for the
// browser's.
'use strict';

function paint(s) {
  const p = (s && s.pressure) || {};
  const $ = (id) => document.getElementById(id);

  // ---- browser (what the extension controls) ----
  const bLevel = p.browserLevel ?? p.level ?? 0;
  $('blvl').textContent = `L${bLevel}${p.reason ? ' — ' + p.reason : ''}`;
  $('blvl').className = 'lvl lvl' + bLevel;

  const bmb = p.browserMB;
  $('bmb').textContent = (typeof bmb === 'number' && bmb > 0) ? `${bmb} MB` : '—';
  $('bpct').textContent = (typeof p.browserPct === 'number' && p.browserPct > 0) ? `${p.browserPct}%` : '—';
  $('bprocs').textContent = (typeof p.browserProcs === 'number' && p.browserProcs > 0) ? p.browserProcs : '—';

  $('disc').textContent = (s && s.stats && s.stats.discarded) || 0;
  $('rest').textContent = (s && s.stats && s.stats.restored) || 0;

  // ---- system (context) ----
  $('free').textContent = (p.freePct ?? '?') + '%';
  $('swap').textContent = (p.swapMB ?? '?') + ' MB';

  $('src').textContent = p.source ?? '?';

  // Honest footer: what is actually working right now.
  const notes = [];
  if (s && s.processesApi === false) notes.push('per-tab RSS unavailable: "processes" permission missing');
  if (s && s.storeBridge === false) notes.push('native store bridge not connected');
  if (s && s.lastError) notes.push('last error: ' + s.lastError);
  $('note').textContent = notes.length ? notes.join(' · ') : 'browser scoped · daemon live';
}

async function refresh() {
  try {
    paint(await chrome.runtime.sendMessage({ type: 'GOV_STATUS' }));
  } catch (e) {
    console.error('[governor popup] refresh failed:', e && e.message);
    const el = document.getElementById('blvl');
    if (el) el.textContent = 'worker unreachable';
  }
}
refresh();
setInterval(refresh, 2000);