// tests: governor daemon — live endpoint contract
'use strict';
const { test, run } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { server } = require('../daemon.js');

let base;
test.before(() => new Promise(res => server.listen(0, '127.0.0.1', () => {
  base = `http://127.0.0.1:${server.address().port}`;
  res();
})));
test.after(() => new Promise(res => server.close(res)));

function get(p) {
  return new Promise((resolve, reject) => {
    http.get(base + p, r => {
      let b = '';
      r.on('data', c => b += c);
      r.on('end', () => resolve({ status: r.statusCode, headers: r.headers, body: b }));
    }).on('error', reject);
  });
}

test('GET /pressure -> 200 JSON with level/freePct/swapMB', async () => {
  const r = await get('/pressure');
  assert.strictEqual(r.status, 200);
  assert.ok(/json/.test(r.headers['content-type']), 'must be JSON');
  assert.strictEqual(r.headers['cache-control'], 'no-store');
  const j = JSON.parse(r.body);
  assert.ok(j.level >= 0 && j.level <= 4, `level ${j.level}`);
  assert.ok(j.freePct >= 0 && j.freePct <= 100);
  assert.ok(typeof j.swapMB === 'number');
  assert.ok(typeof j.at === 'number');
});

test('OPTIONS /pressure -> 204 CORS preflight ok', async () => {
  const r = await new Promise((resolve, reject) => {
    const req = http.request(base + '/pressure', { method: 'OPTIONS' }, res => {
      let b = ''; res.on('data', c => b += c);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
    });
    req.on('error', reject); req.end();
  });
  assert.strictEqual(r.status, 204);
  assert.ok(r.headers['access-control-allow-origin']);
});

test('unknown path -> 404 with allowed paths', async () => {
  const r = await get('/nope');
  assert.strictEqual(r.status, 404);
  assert.ok(JSON.parse(r.body).paths.includes('/pressure'));
});

test('GET /health is 200 liveness probe', async () => {
  const r = await get('/health');
  assert.strictEqual(r.status, 200);
  const j = JSON.parse(r.body);
  assert.strictEqual(j.status, 'ok');
  assert.strictEqual(j.port, server.address().port, 'health echoes the live bound port');
  assert.ok(typeof j.at === 'number' && j.at > 0, 'health carries timestamp');
  assert.strictEqual(r.headers['cache-control'], 'no-store');
});

test('GET /stats exposes extension-liveness truth', async () => {
  // poll /pressure once so lastPressureAgeMs has a real sample to report
  const pr = await get('/pressure');
  assert.strictEqual(pr.status, 200);
  const r = await get('/stats');
  assert.strictEqual(r.status, 200);
  const j = JSON.parse(r.body);
  assert.strictEqual(r.headers['cache-control'], 'no-store');
  assert.ok(j.uptimeMs >= 0, 'uptime measured');
  assert.ok(j.pressureHits >= 1, 'counted the /pressure poll we just made');
  assert.ok(j.healthHits >= 0);
  assert.ok(j.statsHits >= 1, 'counted this call too');
  assert.strictEqual(typeof j.lastPressureAt, 'number');
  assert.ok(j.lastPressureAt > 0, 'a real sample landed');
  assert.ok(typeof j.lastPressureAgeMs === 'number', 'age present after a poll');
  assert.ok(j.lastPressureAgeMs >= 0 && j.lastPressureAgeMs < 60000, 'age is fresh');
  assert.strictEqual(j.port, server.address().port, 'live bound port echoed');
});

test('unknown path 404 lists /stats in advertised paths', async () => {
  const r = await get('/definitely-not-a-route');
  assert.strictEqual(r.status, 404);
  assert.ok(JSON.parse(r.body).paths.includes('/stats'));
});

run();
