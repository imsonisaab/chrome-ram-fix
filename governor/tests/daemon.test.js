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

test('GET /health -> 404 (only /pressure and 404 advertised)', async () => {
  const r = await get('/health');
  assert.strictEqual(r.status, 404);
});

run();
