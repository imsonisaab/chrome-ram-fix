// popup.js — status panel. Reads from the worker's live state.
'use strict';

function paint(s) {
  const p = (s && s.pressure) || {};
  const $ = (id) => document.getElementById(id);
  $('lvl').textContent = `L${p.level ?? '?'} — ${p.reason ?? '?'}`;
  $('lvl').className = 'lvl lvl' + (p.level ?? 0);
  $('free').textContent = (p.freePct ?? '?') + '%';
  $('swap').textContent = (p.swapMB ?? '?') + ' MB';
  $('tabs').textContent = (s && s.tabs != null) ? s.tabs : '?';

  // Real RSS, never a fabricated number. If the worker says the processes API
  // is missing or the value is an estimate, the popup says so instead of
  // showing a confident figure the browser did not report.
  const r = s && s.rssLiveMB;
  if (r && r.liveMB > 0) {
    $('rss').textContent = `${r.liveMB} MB` + (r.estimatedTabs ? ` + ${r.estimatedTabs} est.` : '');
  } else if (r) {
    $('rss').textContent = 'measuring…';
  } else {
    $('rss').textContent = '—';
  }

  $('disc').textContent = (s && s.stats && s.stats.discarded) || 0;
  $('rest').textContent = (s && s.stats && s.stats.restored) || 0;
  $('src').textContent = p.source ?? '?';

  // Honest footer: what is actually working right now.
  const notes = [];
  if (s && s.processesApi === false) notes.push('per-tab RSS unavailable: "processes" permission missing');
  if (s && s.storeBridge === false) notes.push('native store bridge not connected');
  if (s && s.lastError) notes.push('last error: ' + s.lastError);
  $('note').textContent = notes.length ? notes.join(' · ') : 'all systems reporting';
}

async function refresh() {
  try {
    paint(await chrome.runtime.sendMessage({ type: 'GOV_STATUS' }));
  } catch (e) {
    console.error('[governor popup] refresh failed:', e && e.message);
    document.getElementById('lvl').textContent = 'worker unreachable';
  }
}
refresh();
setInterval(refresh, 2000);
