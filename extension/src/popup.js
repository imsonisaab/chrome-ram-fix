// popup.js — status panel. Reads from the worker's live state.
'use strict';

function paint(s) {
  const p = (s && s.pressure) || {};
  document.getElementById('lvl').textContent = `L${p.level ?? '?'} — ${p.reason ?? '?'}`;
  document.getElementById('lvl').className = 'lvl lvl' + (p.level ?? 0);
  document.getElementById('free').textContent = (p.freePct ?? '?') + '%';
  document.getElementById('swap').textContent = (p.swapMB ?? '?') + ' MB';
  document.getElementById('tabs').textContent = (s && s.tabs != null) ? s.tabs : '?';
  document.getElementById('disc').textContent = (s && s.stats && s.stats.discarded) || 0;
  document.getElementById('rest').textContent = (s && s.stats && s.stats.restored) || 0;
  document.getElementById('src').textContent = p.source ?? '?';
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
