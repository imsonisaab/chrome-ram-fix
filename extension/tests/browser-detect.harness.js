// Regression: detectBrowserName() must identify modern Brave, which strips
// "Brave" from navigator.userAgent. Loading pressureClient.js with a Brave-like
// navigator must produce a /pressure?browser=Brave%20Browser URL. Without the
// navigator.brave / UAData-brand checks, Brave falls through to Google Chrome
// and the worker makes discard decisions on Chrome's footprint.
'use strict';
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const SRC = fs.readFileSync('/Users/apple/Documents/chrome-cemetery/extension/governor/lib/pressureClient.js', 'utf8');

function urlRequestedBy(navigatorStub) {
  let requested = null;
  const sandbox = {
    navigator: navigatorStub,
    fetch: (url) => {
      requested = url;
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ level: 0, freePct: 100, swapMB: 0 }) });
    },
    Date, JSON, encodeURIComponent, Promise, setTimeout, clearTimeout,
    globalThis: null,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  return sandbox.GovernorPressure.sample().then(() => requested);
}

(async () => {
  const CHROME_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36';

  // Case 1: modern Brave — no "Brave" in UA, but navigator.brave present.
  const brave = await urlRequestedBy({ userAgent: CHROME_UA, brave: { isBrave: true } });
  assert.ok(brave && brave.includes('Brave%20Browser'),
    `Brave with navigator.brave must be detected as Brave Browser, got: ${brave}`);
  console.log('  brave via navigator.brave -> Brave Browser: OK');

  // Case 2: Brave via UAData brand (navigator.brave absent but brands include Brave).
  const braveBrand = await urlRequestedBy({
    userAgent: CHROME_UA,
    userAgentData: { brands: [{ brand: 'Chromium', version: '157' }, { brand: 'Brave', version: '157' }] },
  });
  assert.ok(braveBrand && braveBrand.includes('Brave%20Browser'),
    `Brave via UAData brand must be detected, got: ${braveBrand}`);
  console.log('  brave via UAData brand -> Brave Browser: OK');

  // Case 3: plain Chrome must still be detected as Google Chrome (no regression).
  const chrome = await urlRequestedBy({ userAgent: CHROME_UA });
  assert.ok(chrome && chrome.includes('Google%20Chrome'),
    `plain Chrome must stay Google Chrome, got: ${chrome}`);
  console.log('  plain Chrome -> Google Chrome: OK');

  // Case 4: legacy Brave with "Brave" literally in UA still works.
  const braveUa = await urlRequestedBy({ userAgent: CHROME_UA.replace('Chrome/', 'Brave/') });
  assert.ok(braveUa && braveUa.includes('Brave%20Browser'),
    `legacy Brave UA must be detected, got: ${braveUa}`);
  console.log('  legacy Brave UA -> Brave Browser: OK');

  console.log('RESULT: BROWSER DETECT HARNESS GREEN');
})().catch(e => { console.error('RESULT: BROWSER DETECT HARNESS RED:', e.message); process.exit(1); });
