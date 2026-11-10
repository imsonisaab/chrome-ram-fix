#!/usr/bin/env node
'use strict';
const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const PORT = parseInt(process.env.GOVERNOR_PORT || '8795', 10);
const HOST = '127.0.0.1';
const HERE = __dirname;

function readMessage() {
  const header = fs.readFileSync(0, Buffer.alloc(4), 0, 4);
  if (header.length === 0) return null;
  const len = header.readUInt32LE(0);
  if (!len || len > 64 * 1024 * 1024) return null;
  const parts = [];
  let got = 0;
  while (got < len) {
    const want = Math.min(len - got, 1 << 16);
    let buf;
    try {
      buf = fs.readFileSync(0, Buffer.alloc(want), 0, want, null);
    } catch (_) {
      buf = Buffer.alloc(0);
    }
    if (buf.length === 0) throw new Error('stdin ended mid-message');
    parts.push(buf);
    got += buf.length;
  }
  return Buffer.concat(parts).toString('utf8');
}

function writeMessage(str) {
  const body = Buffer.from(String(str), 'utf8');
  const head = Buffer.alloc(4);
  head.writeUInt32LE(body.length, 0);
  fs.writeFileSync(1, Buffer.concat([head, body]));
}

function governorRequest(obj) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(obj);
    const req = http.request(
      { host: HOST, port: PORT, path: '/bridge', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { data += c; });
        res.on('end', () => resolve(data));
      });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

let starting = null;
function ensureGovernor() {
  if (starting) return starting;
  starting = new Promise((resolve) => {
    const probe = http.get({ host: HOST, port: PORT, path: '/health', timeout: 700 }, (res) => {
      res.resume();
      resolve(true);
    });
    probe.on('error', () => {
      const ps = path.join(HERE, 'governor-ps.ps1');
      const child = spawn('powershell.exe', [
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', ps,
      ], { detached: true, stdio: 'ignore', windowsHide: true });
      child.unref();
      setTimeout(resolve, 900);
    });
    probe.on('timeout', () => { probe.destroy(); resolve(true); });
  });
  return starting;
}

(async () => {
  while (true) {
    let msg;
    try { msg = readMessage(); } catch (_) { break; }
    if (msg === null) break;
    let req;
    try { req = JSON.parse(msg); } catch (_) { continue; }
    await ensureGovernor();
    try {
      const reply = await governorRequest(req);
      writeMessage(reply && reply.length ? reply : '{"ok":true}');
    } catch (e) {
      writeMessage(JSON.stringify({ ok: false, error: String(e && e.message || e) }));
    }
  }
})().catch(() => process.exit(0));
