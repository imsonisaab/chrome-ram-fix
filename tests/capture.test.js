// tests: Embalmer capture/restore contract — TDD GREEN step
// NOTE: jsdom has no layout engine (scrollTop is always 0), so scrollable
// elements get a mocked scrollTop/scrollLeft via Object.defineProperty.
// Real-Brave verification happens in tests/live.test.cdp (real engine).
const { test, run } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const { Embalmer } = require('../extension/embaler/lib/capture.js');

function scrollableEl(dom, id) {
  const el = dom.window.document.getElementById(id);
  let top = 0, left = 0;
  Object.defineProperty(el, 'scrollTop', { get: () => top, set: (v) => { top = v; }, configurable: true });
  Object.defineProperty(el, 'scrollLeft', { get: () => left, set: (v) => { left = v; }, configurable: true });
  Object.defineProperty(el, 'scrollHeight', { get: () => 10000, configurable: true });
  Object.defineProperty(el, 'clientHeight', { get: () => 500, configurable: true });
  Object.defineProperty(el, 'scrollWidth', { get: () => 0, configurable: true });
  Object.defineProperty(el, 'clientWidth', { get: () => 0, configurable: true });
  return el;
}

function makePage(html) {
  return new JSDOM(html, { url: 'https://example.test/page?q=1', pretendToBeVisual: true });
}

test('captures scroll position per scrolling element', () => {
  const dom = makePage('<div id="a"></div>');
  scrollableEl(dom, 'a').scrollTop = 1234;
  const state = new Embalmer(dom.window).capture();
  assert.strictEqual(state.scroll.find(s => s.id === '#a').t, 1234);
});

test('captures input values including controlled-component fields', () => {
  const dom = makePage(`
    <input id="name" value="Rahul">
    <input id="email" type="email" value="">
    <textarea id="bio">line1
line2</textarea>
    <select id="city"><option value="sfo">San Francisco</option><option value="nyc">New York</option></select>
    <input id="agree" type="checkbox" checked>
    <input id="plan" type="radio" name="plan" value="gold" checked>
    <input id="pw" type="password" value="secret123">
  `);
  const d = dom.window.document;
  d.getElementById('email').value = 'r@x.in';
  d.getElementById('city').value = 'nyc';

  const state = new Embalmer(dom.window).capture();
  assert.strictEqual(state.fields['#name'], 'Rahul');
  assert.strictEqual(state.fields['#email'], 'r@x.in');
  assert.strictEqual(state.fields['#bio'], 'line1\nline2');
  assert.strictEqual(state.selects['#city'], 'nyc');
  assert.strictEqual(state.checked['#agree'], true);
  assert.strictEqual(state.radios['plan'], 'gold');
  assert.strictEqual(state.fields['#pw'], undefined, 'password must NEVER be captured');
});

test('captures caret + selection ranges in text inputs and textareas', () => {
  const dom = makePage('<input id="t" value="abcdefgh">');
  const el = dom.window.document.getElementById('t');
  el.selectionStart = 2; el.selectionEnd = 5;
  const state = new Embalmer(dom.window).capture();
  assert.deepStrictEqual(state.selection['#t'], { start: 2, end: 5 });
});

test('captures SPA route + history state', () => {
  const dom = makePage('<div></div>');
  dom.window.history.pushState({ page: 47 }, '', '/list?page=47');
  const state = new Embalmer(dom.window).capture();
  assert.strictEqual(state.route.path, '/list');
  assert.strictEqual(state.route.search, '?page=47');
  assert.strictEqual(state.route.state.page, 47);
});

test('round-trip: restore injects captured state into fresh DOM', () => {
  // mock scroll geometry BEFORE capture so scrollables() detects the element
  const src = makePage('<div id="s"></div><input id="f" value="">');
  scrollableEl(src, 's').scrollTop = 500;
  src.window.document.getElementById('f').value = 'restored-value';
  const state = new Embalmer(src.window).capture();

  const dst = makePage('<div id="s"></div><input id="f" value="">');
  const sEl = scrollableEl(dst, 's');      // attach mock first (fresh 0)
  new Embalmer(dst.window).restore(state);
  assert.strictEqual(sEl.scrollTop, 500);  // then read — restore wrote 500
  assert.strictEqual(dst.window.document.getElementById('f').value, 'restored-value');
});

run();
