#!/usr/bin/env node
// native-host.js — the bridge between the Governor extension and cemeteryd.
//
// The extension (background.js) sends EMBAL_STORE / EMBAL_FETCH messages via
// chrome.runtime.sendNativeMessage. Chrome's native messaging runs this script
// as a subprocess and pipes stdio. Every request is one length-prefixed JSON
// message; every reply is one length-prefixed JSON message.
//
// Protocol (inside the framed messages):
//   {"cmd":"put","key":12345,"payload":"<base64>"}  -> {"ok":true}
//   {"cmd":"get","key":12345}                       -> {"ok":true,"payload":"<base64>"}
//   {"cmd":"warm","n":3}                            -> {"ok":true,"keys":[...]}
//   {"cmd":"keys"} / {"cmd":"touch","key":N} / {"cmd":"size"}
//
// CEMETERY_DIR env points at the store; the daemon binary is resolved from
// CEMETERY_BIN or the repo-relative default.

'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const CEMETERY_DIR = process.env.CEMETERY_DIR || path.join(REPO, 'cemetery', 'data');
const BIN = process.env.CEMETERY_BIN ||
  path.join(REPO, 'cemetery', 'target', 'release', 'cemeteryd');

let daemon = null;

function ensureDaemon() {
  if (daemon && !daemon.killed) return daemon;
  if (!fs.existsSync(BIN)) {
    throw new Error('cemeteryd not built: ' + BIN);
  }
  daemon = spawn(BIN, ['serve'], {
    env: Object.assign({}, process.env, { CEMETERY_DIR }),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  daemon.stderr.on('data', (d) => process.stderr.write(d));
  daemon.on('exit', () => { daemon = null; });
  return daemon;
}

function rpc(request) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = ensureDaemon();
    } catch (e) {
      reject(e);
      return;
    }
    let buf = '';
    let settled = false;
    const onData = (chunk) => {
      buf += chunk.toString('utf8');
      let nl = buf.indexOf('\n');
      while (nl !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line) {
          finish(null, line);
          return;
        }
        nl = buf.indexOf('\n');
      }
    };
    function finish(err, line) {
      if (settled) return;
      settled = true;
      child.stdout.removeListener('data', onData);
      clearTimeout(timer);
      if (err) {
        reject(err);
        return;
      }
      try {
        resolve(JSON.parse(line));
      } catch (e) {
        reject(new Error('bad daemon reply: ' + line));
      }
    }
    const timer = setTimeout(() => finish(new Error('daemon timeout'), null), 2000);
    child.stdout.on('data', onData);
    try {
      child.stdin.write(JSON.stringify(request) + '\n');
    } catch (e) {
      finish(e, null);
    }
  });
}

// ---- native messaging framing (4-byte LE length prefix) -------------------
function writeMessage(obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  const head = Buffer.allocUnsafe(4);
  head.writeUInt32LE(body.length, 0);
  process.stdout.write(Buffer.concat([head, body]));
}

function readMessages(onMessage) {
  let acc = Buffer.alloc(0);
  process.stdin.on('data', (chunk) => {
    acc = Buffer.concat([acc, chunk]);
    while (acc.length >= 4) {
      const len = acc.readUInt32LE(0);
      if (acc.length < 4 + len) break;
      const body = acc.slice(4, 4 + len);
      acc = acc.slice(4 + len);
      let req = null;
      try {
        req = JSON.parse(body.toString('utf8'));
      } catch (e) {
        writeMessage({ ok: false, error: 'bad json' });
        continue;
      }
      onMessage(req);
    }
  });
  process.stdin.on('end', () => process.exit(0));
}

readMessages((req) => {
  Promise.resolve()
    .then(() => rpc(req))
    .then((reply) => writeMessage(reply))
    .catch((e) => writeMessage({ ok: false, error: String((e && e.message) || e) }));
});
