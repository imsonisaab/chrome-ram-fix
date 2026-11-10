#!/usr/bin/env python3
"""Live proof: Embaler capture/restore on a REAL browser engine (CDP :9222).

Uses the FIRST existing page-level websocket (no new tab = no focus steal risk).
Injects embaler/lib/capture.js + security.js, types real values, captures, wipes,
restores, asserts on real DOM.
"""
import asyncio, json, urllib.request, urllib.parse, sys, os
import websockets

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
CDP_BASE = 'http://127.0.0.1:9222'
_port = None
# Port: --port <p> or CEMETERY_CDP_PORT env; default stays 9222.
for _i, _a in enumerate(sys.argv):
    if _a == '--port' and _i + 1 < len(sys.argv):
        _port = sys.argv[_i + 1]
    elif _a.startswith('--port='):
        _port = _a.split('=', 1)[1]
_port = _port or _os.environ.get('CEMETERY_CDP_PORT')
if _port:
    CDP_BASE = 'http://127.0.0.1:%s' % _port
CAP = open(f'{ROOT}/extension/embaler/lib/capture.js').read()
SEC = open(f'{ROOT}/extension/embaler/lib/security.js').read()
# The libs now ship as UMD: in a browser the exports land on window.__UmdBundle.
# Inject them raw (the same bytes the extension loads), then lift the names to
# window exactly like a real <script> consumer would.
LIB_JS = (
    "window.__UmdBundle = undefined;\n" + SEC + "\n" + CAP + "\n"
    + "window.Embalmer = window.__UmdBundle.Embalmer;\n"
    + "window.shouldCapture = window.__UmdBundle.shouldCapture;\n"
    + "window.sanitizeStorage = window.__UmdBundle.sanitizeStorage;"
)

import threading, http.server, functools, socketserver, os, socket as _socket
FIXTURE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'live_fixture.html')
# The fixture port must be genuinely free. A stale process (e.g. a Brave helper
# still serving a local tab on 8791) makes the browser load a foreign page and
# the whole run fails on a null #name — which looks like a product bug. So pick
# the first free port and refuse to run on a busy one.
def _free_port(preferred=8791):
    for p in [preferred] + [preferred + n for n in range(1, 200)]:
        with _socket.socket() as s:
            s.setsockopt(_socket.SOL_SOCKET, _socket.SO_REUSEADDR, 1)
            try:
                s.bind(('127.0.0.1', p)); return p
            except OSError:
                continue
    raise RuntimeError('no free port for the fixture server')
PORT = int(os.environ.get('FIXTURE_PORT', '0')) or _free_port()
class _Quiet(socketserver.TCPServer):
    allow_reuse_address = True
def _serve():
    h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.path.dirname(FIXTURE))
    with _Quiet(('127.0.0.1', PORT), h) as httpd:
        httpd.serve_forever()
threading.Thread(target=_serve, daemon=True).start()
HTML = 'http://127.0.0.1:%d/' % PORT + os.path.basename(FIXTURE)

async def main():
    # Fresh page target per run: reusing a stale target's websocket URL hangs the
    # whole suite when the browser was restarted between runs.
    tgt = json.loads(urllib.request.urlopen(urllib.request.Request(
        CDP_BASE + '/json/new?about:blank', method='PUT')).read())
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
                raise RuntimeError(f"JS: {r.get('exceptionDetails',{})}")
            return r.get('result', {}).get('value')

        await cmd("Page.enable")
        await cmd("Runtime.enable")
        # Navigate to a FRESH url each run so a previous run's target can't stall us
        await cmd("Page.navigate", url=HTML)
        for _ in range(50):
            await asyncio.sleep(0.1)
            try:
                if await ev("location.href") == HTML \
                        and await ev("document.readyState") == 'complete':
                    break
            except Exception:
                pass
        else:
            raise RuntimeError(f"navigation to {HTML} never settled")

        # Inject as top-level scripts (no IIFE): the UMD footer reuses the same
        # scope as the file's own declarations, so wrapping would double-declare.
        for chunk in [SEC, CAP]:
            r = await cmd("Runtime.evaluate", expression=chunk, returnByValue=False)
            if r.get('exceptionDetails'): raise RuntimeError(f"inject: {r['exceptionDetails']}")
        await ev("window.Embalmer = window.__UmdBundle.Embalmer;"
                 "window.shouldCapture = window.__UmdBundle.shouldCapture;"
                 "window.sanitizeStorage = window.__UmdBundle.sanitizeStorage;'lifted'")
        print("lib injected into real engine")

        await ev("document.getElementById('name').value='Rahul Sharma';"
                 "document.getElementById('name').dispatchEvent(new Event('input',{bubbles:true}));"
                 "document.getElementById('email').value='rahul@example.in';"
                 "document.getElementById('agree').checked=true;"
                 "document.getElementById('scroller').scrollTop=3200;"
                 "window.history.pushState({page:7},'','/list?page=7');'set'")
        print("state set")

        st = await ev("JSON.stringify(new Embalmer(window).capture())")
        state = json.loads(st)
        print("fields:", state['fields'])
        print("checked:", state['checked'])
        print("scroll:", state['scroll'])
        print("route:", state['route'])
        leaked = [k for k in state['fields'] if 'pw' in k or 'otp' in k]
        assert not leaked, f"SECRET LEAK: {leaked}"
        assert state['checked'].get('#agree') is True
        sc = next((s for s in state['scroll'] if s['id'] == '#scroller'), None)
        assert sc and sc['t'] > 1000, f"real scroll missed: {sc}"
        print("PASS: real-engine capture OK (scroll + checkbox, password/otp blocked)")

        await ev("document.getElementById('name').value='';"
                 "document.getElementById('agree').checked=false;"
                 "document.getElementById('scroller').scrollTop=0;"
                 "window.history.pushState({},'','/');'wiped'")
        await ev(f"new Embalmer(window).restore({st})")
        name = await ev("document.getElementById('name').value")
        agree = await ev("document.getElementById('agree').checked")
        stp = await ev("document.getElementById('scroller').scrollTop")
        print(f"after restore: name={name!r} agree={agree} scrollTop={stp}")
        assert name == 'Rahul Sharma', f"field restore failed: {name}"
        assert agree is True, "checkbox restore failed"
        assert stp > 1000, f"scroll restore failed: {stp}"
        print("PASS: real-engine restore OK (value+checkbox+scroll re-applied)")
        print("RESULT: LIVE GREEN (real-engine assertions passed)")

asyncio.get_event_loop().run_until_complete(main())
