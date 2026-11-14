// governorDaemon.js — localhost :8795 JSON endpoint for the extension.
// Serves kernel pressure from machPressure.js. No auth (loopback-only bind),
// no input, no writes. This is the ONLY thing the extension can talk to.
'use strict';
const http = require('http');
const path = require('path');
const { sample } = require(path.join(__dirname, 'lib', 'machPressure.js'));

const PORT = parseInt(process.env.GOVERNOR_PORT || '8795', 10);
const HOST = '127.0.0.1';

const server = http.createServer((req, res) => {
  // CORS for the extension origin (chrome-extension://<id>)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
// Liveness probe: cheap, no sampling. install/verify/monitors poll this.
// Echoes the LIVE bound port (not the module default) so callers that bind
// ephemeral ports in tests still get an honest number.
if (req.method === 'GET' && req.url.split('?')[0] === '/health') {
  const bound = server.address();
  const livePort = (bound && typeof bound === 'object') ? bound.port : PORT;
  res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify({ status: 'ok', port: livePort, at: Date.now() }));
  return;
}

  if (req.method !== 'GET' || !req.url.startsWith('/pressure')) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found', paths: ['/pressure', '/health'] }));
    return;
  }
  try {
    // ?browser=Brave+Browser scopes the report to one browser's own footprint.
    // Default: no browser name -> system-wide numbers only (backwards compatible).
    const qs = req.url.split('?')[1] || '';
    const browserName = new URLSearchParams(qs).get('browser') || '';
    const s = sample(browserName);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({
      level: s.level, freePct: s.freePct, swapMB: s.swapMB,
      reason: s.reason, totalMB: s.totalMB, at: Date.now(),
      // browser-scoped: what the extension actually controls
      browser: browserName || null,
      browserMB: s.browserMB, browserPct: s.browserPct,
      browserLevel: s.browserLevel, browserProcs: s.browserProcs,
    }));
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: String(e && e.message || e) }));
  }
});

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`[governor] listening on http://${HOST}:${PORT}/pressure`);
  });
  process.on('SIGTERM', () => server.close(() => process.exit(0)));
  process.on('SIGINT', () => server.close(() => process.exit(0)));
}

module.exports = { server, PORT };
