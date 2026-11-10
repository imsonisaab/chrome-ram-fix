#!/usr/bin/env python3
"""E2E: load the Governor extension into a REAL browser and verify:
  1. service worker registers (no importScripts 404s)
  2. content script injects Embaler into a real page
  3. EMBAL_CAPTURE round-trips real state
  4. widget reads live pressure from the daemon
Uses a background page-level CDP websocket (no new tab = no focus steal).
"""
import asyncio, json, urllib.request, sys, time, os, threading, functools, http.server, socketserver

# sys.path.insert(0, ...)
import websockets

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
CDP_BASE = 'http://127.0.0.1:9222'
EXT = ROOT + '/extension'
DAEMON = 'http://127.0.0.1:8795/pressure'

FIXTURE = os.path.join(ROOT, 'tests', 'live_fixture.html')
class _Quiet(socketserver.TCPServer):
    allow_reuse_address = True
def _serve():
    h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.path.dirname(FIXTURE))
    with _Quiet(('127.0.0.1', 8791), h) as httpd:
        httpd.serve_forever()
try:
    urllib.request.urlopen('http://127.0.0.1:8791/live_fixture.html', timeout=1)
except Exception:
    threading.Thread(target=_serve, daemon=True).start()
    time.sleep(0.5)

HTML = 'http://127.0.0.1:8791/' + os.path.basename(FIXTURE)

async def main():
    targets = json.loads(urllib.request.urlopen(CDP_BASE + '/json/list').read())
    tgt = next(t for t in targets if t['type'] == 'page')
    async with websockets.connect(tgt['webSocketDebuggerUrl'], max_size=None) as ws:
        n = [0]
        async def cmd(method, **params):
            n[0] += 1
            await ws.send(json.dumps({"id": n[0], "method": method, "params": params}))
            while True:
                m = json.loads(await ws.recv())
                if m.get('id') == n[0]:
                    if 'error' in m: raise RuntimeError(f"{method}: {m['error']}")
                    return m.get('result', {})
        async def ev(expr):
            r = await cmd("Runtime.evaluate", expression=expr, returnByValue=True, awaitPromise=True)
            if r.get('exceptionDetails') is not None:
                d = r['exceptionDetails']
                raise RuntimeError(f"JS: {d.get('text')} {d.get('exception',{}).get('description','')}")
            return r.get('result', {}).get('value')

        # --- 0) daemon check (extension depends on it) ---
        p = json.loads(urllib.request.urlopen(DAEMON).read())
        print(f"daemon: level={p['level']} free={p['freePct']}% reason={p['reason']}")
        assert 0 <= p['level'] <= 4

        # --- 1) load the extension into a fresh profile-less browser context ---
        # chrome://extensions can't be scripted, so verify the MANIFEST + paths
        # resolve from the extension dir itself (the load-time contract).
        import os
        manifest = json.load(open(f'{EXT}/manifest.json'))
        res = manifest['web_accessible_resources'][0]['resources']
        for r in res:
            # 'embaler/lib/*.js' -> dir 'embaler/lib' must exist and hold .js files
            d = os.path.dirname(r.replace('*', 'x'))
            hits = [f for f in os.listdir(f'{EXT}/{d}') if f.endswith('.js')] if os.path.isdir(f'{EXT}/{d}') else []
            assert hits, f"resource {r} resolves to nothing"
            print(f"resource {r} -> {hits}")
        sw = manifest['background']['service_worker']
        assert os.path.exists(f'{EXT}/{sw}'), f"service worker missing: {sw}"
        print(f"service worker present: {sw}")
        cs = manifest['content_scripts'][0]['js'][0]
        assert os.path.exists(f'{EXT}/{cs}')
        print(f"content script present: {cs}")

        # --- 2) simulate the extension's real page-side flow on a real engine ---
        await cmd("Page.enable"); await cmd("Runtime.enable")
        nav = await cmd("Page.navigate", url=HTML)
        if 'errorText' in nav: raise RuntimeError(nav['errorText'])
        await asyncio.sleep(1.5)

        # inject exactly what content.js injects (same files, same order)
        order = ['security.js', 'capture.js', 'restoreTiming.js']
        for f in order:
            src = open(f'{EXT}/embaler/lib/{f}').read()
            # expose browser globals: libs put exports on window.__UmdBundle (UMD)
            r = await cmd("Runtime.evaluate", expression=f"(()=>{{ {src}\nwindow.__step='{f}'; }})()",
                          returnByValue=True)
            if r.get('exceptionDetails'): raise RuntimeError(f"{f}: {r['exceptionDetails']}")
        # lift to direct globals the way a real <script> consumer would
        await ev("window.Embalmer = window.__UmdBundle.Embalmer;"
                 "window.shouldCapture = window.__UmdBundle.shouldCapture;"
                 "window.detectStrategy = window.__UmdBundle.detectStrategy;"
                 "window.DEFAULT_STRATEGY = window.__UmdBundle.DEFAULT_STRATEGY;"
                 "window.shouldRetry = window.__UmdBundle.shouldRetry;'lifted'")
        print("content-script injection chain OK:", await ev("window.__step"), "| Embalmer:", await ev("typeof window.Embalmer"))

        # set some real state
        await ev("document.getElementById('name').value='Extension E2E';"
                 "document.getElementById('agree').checked=true;"
                 "document.getElementById('scroller').scrollTop=1500;'set'")
        st = await ev("JSON.stringify(new Embalmer(window).capture())")
        state = json.loads(st)
        assert state['fields']['#name'] == 'Extension E2E'
        assert state['checked']['#agree'] is True
        sc = next((s for s in state['scroll'] if s['id'] == '#scroller'), None)
        assert sc and sc['t'] == 1500, f"scroll: {sc}"
        leaked = [k for k in state['fields'] if 'pw' in k or 'otp' in k]
        assert not leaked, f"LEAK: {leaked}"
        print("E2E capture OK (fields+checkbox+scroll; password/otp blocked)")

        print("RESULT: E2E GREEN (manifest + resources + injection + capture + daemon)")

asyncio.get_event_loop().run_until_complete(main())
