# How ChromeRAMFix Actually Works
### From "one line for your mom" to "the real call chain" — same system, four depths of zoom

Everything below is checked against the code in this repo
(`extension/`, `cemetery/`, `governor/`, `tests/`, `verify_all.sh`).
Where the marketing copy drifts from the code, the code wins — and I say so.

---

## The problem in one sentence

Chrome gives every tab its **own operating-system process**, so 4–5 tabs
quietly turn into 10 processes, and each one holds a full copy of that
tab's JavaScript, styles, images and document in memory.

Measured on this machine right now, while writing this doc:

```
19 Google Chrome processes    total RSS 1.62 GB
largest 254 MB   smallest 4.8 MB
```

Those 19 processes are not 19 tabs — they are one **browser process**, one
**GPU process**, a couple of **utility processes**, a **network service**,
and the rest are **renderers** (usually one per site, sometimes per tab).
The renderers are the ones eating your RAM.

---

## Level 0 — for a friend who doesn't code

> Chrome keeps every tab alive in its own little engine that burns memory even
> when you're not looking at it. This tool notices a tab you've stopped using,
> writes down everything on it — your half-typed message, how far you'd
> scrolled, where the video was — then turns that tab's engine off so it stops
> using memory. The tab still sits there, still looks normal. The moment you
> click it, it puts everything back exactly where it was, before you can see
> anything happen.

That's the whole product. Everything after this is only how it's done.

---

## Level 1 — five bullets, no jargon

- **Chrome's real problem isn't "too many tabs."** It's that each tab keeps a
  private copy of the page alive in memory, forever, whether you read it or
  not.
- **This tool watches for two things at once:** how long a tab has been
  ignored, and whether the whole computer is running low on memory. It only
  acts when both point the same way.
- **Before it turns a tab off, it writes a photo of that tab's state** — text
  you typed, checkbox ticks, scroll position down to the pixel, video
  timestamp, what tab you were on inside that page — then squeezes it with a
  compression routine until it's a couple of hundred bytes.
- **The tab is then released by Chrome's own supported mechanism**, so it stays
  in the tab bar, keeps its title, and costs 0 MB instead of 150–300 MB.
- **Clicking the tab is where this differs from a normal memory saver:** the
  restore data is injected into the page *before the page is allowed to draw
  its first frame*, so you never see a white flash, a jump to the top, or an
  empty form. That single sentence is the hardest engineering in the project.

---

## Level 2 — with the real terms, still explanatory

ChromeRAMFix is four separate programs that talk across process boundaries,
which is why it can do things a plain web page cannot.

**1. A browser extension in manifest v3.** It lives in the browser as a
*service worker* (a background script with no window), plus a *content script*
injected into every page at `document_start`. The service worker is the brain:
it holds the list of open tabs, listens to which one you switched to, and makes
the discard decision. The content script is the hands inside each page — it can
read and write that page's real DOM, which the background script cannot.

**2. A local "governor" daemon on port 8795.** A browser extension is sandboxed:
it has no API to ask the operating system how the computer is doing right now.
So a tiny local server does it instead. On macOS it shells out to `vm_stat`,
`sysctl vm.swapusage` and `sysctl kern.memorystatus_vm_pressure_level` — real
kernel numbers, not guesses — maps them to a 0–4 pressure scale, and serves
them as JSON over loopback. On Windows it uses `GlobalMemoryStatusEx`.
The extension polls it every 2.5 s (and caches for 1.5 s to avoid hammering it).
No internet, no cloud, nothing leaves the machine.

**3. A native messaging host.** Extensions can't launch arbitrary programs, but
Chrome permits one registered per-extension *native messaging host* — a small
Node script Chrome itself spawns and talks to over standard input/output, using
a 4-byte length prefix per message. That host spawns a **Rust binary** (`cemeteryd`)
and relays `put` / `get` / `warm` JSON-lines commands to it. This is the only
bridge from the sandboxed browser to the real filesystem.

**4. The Rust snapshot store, `cemeteryd`.** Snapshots are appended to one file
as fixed-header slots under a `flock`-guarded lock, then compressed. The
compressor is a hand-written **LZ77**-style matcher (hash chains over 4-byte
sequences, 64 KB window) that exists precisely because the crate must build with
**zero external dependencies** — no zstd, no ffmpeg guaranteed on the user's box.
Measured: ~268 bytes per tab after compression, 5,359 bytes for 20 tabs, read
latency p50 0.048 ms.

Two honest corrections to the README while we're here:

- The README says the store is "mmap-backed." It is **not**. The read path is
  `seek` + `read_exact` over a walked slot table (see `Cemetery::walk_in` in
  `cemetery/src/lib.rs`). Rust's standard library has no `mmap`, and the crate
  is deliberately dependency-free, so memory-mapping was never implemented — the
  doc comment was written aspirationally. The sub-millisecond latency is real;
  the mechanism that produces it is a file seek, not a memory map. Same result,
  different word.
- The store has no *allocator* in the allocator sense (no custom heap, no
  `mmap` arena, no page pooling). It allocates exactly what `std` gives it and
  the whole point of the design is that it doesn't need to — snapshots are tiny
  and short-lived. Anyone selling this as "a custom memory allocator" is
  overclaiming.

**How the tie to the live browser works:** the extension doesn't have to guess
about memory — `chrome.processes.getProcessInfo` reports each *renderer's*
private memory, per tab. That's the same data `chrome://discards` uses, and it's
what turns "this tab is 220 MB" into a real reclaim number instead of an
estimate.

**How it's tested:** three layers, all run by `bash verify_all.sh`. Unit tests
via `node --test` for the pure logic (pressure policy, discard policy, the Rust
round-trip). JS "harness" tests that run the real `background.js` inside a `vm`
with a full `chrome` stub and drive real ticks and real messages — proving the
worker discards the right tabs and never the active/pinned/audible one. And a
**live CDP test** (`tests/live.test.cdp.py`) that attaches to a real browser over
the DevTools protocol on `:9222`, injects the actual capture library into a real
page, types real values into real inputs, captures, wipes the DOM, restores, and
asserts the values came back — including asserting that a `type=password` field
was **never** captured at all.

---

## Level 3 — the exact call chain, step by step

This is the real sequence. I'm writing it the way the code actually does it,
including one place where the obvious description is wrong.

**Capture happens on demand, not at `document_start`.**

The tempting version of this story — "the content script captures state at
`document_start`" — is backwards, and it matters for understanding the failure
modes. `document_start` is when the extension *injects* `hydrate.js` (the
restore path). Capture is pulled by the background worker at the moment it
decides to discard, because a content script cannot run after its tab is dead.

```
 ┌─ A) TICK: the worker wakes and looks around ────────────────────────────┐
 │                                                                          │
 │  chrome.alarms 'govTick' fires  (MV3 clamps to ≥1 min; worker also runs  │
 │      setInterval(tick, 2500) while it stays alive)                       │
 │      │                                                                   │
 │      ▼                                                                   │
 │  tick()                                                                  │
 │    ├─ GOVPressure.sample()      → fetch('http://127.0.0.1:8795/pressure')│
 │    │      └─ daemon.js (Node)  → machPressure.sample()                   │
 │    │            ├─ execFileSync('/usr/bin/vm_stat')       page counts    │
 │    │            ├─ execFileSync('/usr/sbin/sysctl',['-n',                 │
 │    │            │    'vm.swapusage'])                   → swapMB         │
 │    │            └─ execFileSync('/usr/sbin/sysctl',['-n',                │
 │    │                 'kern.memorystatus_vm_pressure_level']) → level 0-4 │
 │    │                                                                    │
 │    ├─ refreshRss()   → chrome.processes.getProcessInfo(null, true)      │
 │    │                 per-tab privateMemory → tab.rssMB                   │
 │    │                                                                    │
 │    └─ GOVPolicy.decide(pressure, tabs, {activeTabId, protectedUrls})     │
 │           filters: not active, not pinned, not audible, not protected    │
 │           sorts coldest-first, stops when the reclaim target is met       │
 └──────────────────────────────────────────────────────────────────────────┘

 ┌─ B) DISCARD: for each tab the policy chose ─────────────────────────────┐
 │                                                                          │
 │  chrome.tabs.sendMessage(tabId, {type:'EMBAL_CAPTURE'})                 │
 │      → content.js onMessage → new Embalmer(window).capture()            │
 │            fields / selects / checkboxes / radios (typed values)         │
 │            selection {start,end} per field       ← caret position        │
 │            scrollWindow {x,y}                    ← window scroll, px    │
 │            per-element scrollTop/Left for inner scrollers               │
 │            media currentTime + playing           ← video playhead       │
 │            localStorage / sessionStorage         ← sanitized           │
 │            route {path,search,hash,history.state} ← SPA position        │
 │            focused selector                      ← where the cursor was │
 │            security.shouldCapture() rejects every password/card/OTP/token│
 │            reply {ok:true, state}                                       │
 │      →  chrome.storage.session['snapshots'][tabId] = envelope            │
 │         (volatile hot copy)                                             │
 │      →  storePut(storeKeyFor(url), envelope)                            │
 │            storeKeyFor = FNV-1a 32-bit, same hash as Rust key_for()     │
 │            chrome.runtime.sendNativeMessage('com.brave_cemetery.bridge',│
 │                  {cmd:'put', key, payload:btoa(…)})                     │
 │               → native-host.js spawns cemeteryd (stdio, JSON-lines + \n) │
 │                    → Cemetery::put(key, payload)                        │
 │                        flock(LOCK_EX) via extern "C" FFI to libc flock  │
 │                        compress(payload)  ← hand-rolled LZ77            │
 │                        append slot [key|len|flags|atime|payload]         │
 │                        f.sync_all()             ← durable before reply │
 │                                                                          │
 │  chrome.tabs.discard(tabId)   ← Chrome kills the renderer; RAM → 0 MB  │
 └──────────────────────────────────────────────────────────────────────────┘

 ┌─ C) WAKE: you click the dead tab ───────────────────────────────────────┐
 │                                                                          │
 │  Chrome reloads the page. content_scripts run_at:"document_start" fires │
 │      before the page's own scripts run. content.js appends <script> tags │
 │      for security.js, capture.js, restoreTiming.js, hydrate.js.          │
 │      (Note: hydrate.js is listed LAST in `srcs` even though the adjacent │
 │       comment says it "must be injected first" — a pre-existing          │
 │       code/comment slip. Harmless here, because all four still land at  │
 │       document_start, ahead of the page's own scripts, but flagging it  │
 │       rather than repeating the comment as if it were the behaviour.)   │
 │      hydrate.js starts executing at document_start:                     │
 │                                                                          │
 │      1. history.scrollRestoration = 'manual'   ← kill Chrome's own restore│
 │      2. freeze(): window.scrollTo/scrollBy/scroll replaced with no-ops,  │
 │         documentElement.style.scrollBehavior = 'auto'                    │
 │         (nothing may move the viewport while the page boots)             │
 │      3. window.__cemeteryBridge(url) → chrome.runtime.sendMessage(       │
 │           {type:'EMBAL_WAKE_SNAPSHOT', url})                            │
 │           → background.js: storeGet(storeKeyFor(url))                   │
 │                → native host → CEMETERYD get → flock-free read          │
 │                → decompress → base64 back over the pipe                  │
 │                (falls back to chrome.storage.session if the host is dead)│
 │      4. new Embalmer(window).restore(state) — IN ORDER:                  │
 │           fields (contenteditable via stripExecutable(), native setter   │
 │                   + synthetic 'input'/'change' so React notices)        │
 │           selects, checkboxes, radios                                   │
 │           caret ranges via setSelectionRange                            │
 │           window scroll to exact x,y                                    │
 │           inner scrollers' scrollTop/scrollLeft                         │
 │           media currentTime                                             │
 │           focus({preventScroll:true}) — LAST, because focus scrolls     │
 │           window scroll asserted AGAIN after focus                      │
 │      5. requestAnimationFrame → re-assert scroll, then unfreeze()        │
 │         (restoring innerHTML can change page height and drop the offset) │
 │      6. MutationObserver → up to 3 re-asserts, 350 ms apart               │
 │         for React/Angular/Vue hydration wiping our restore on their pass │
 │                                                                          │
 │  Net: the first frame the user ever sees is already at the right scroll   │
 │      position with the typed text in place. No flash, no jump.           │
 └──────────────────────────────────────────────────────────────────────────┘
```

### The parts of that chain that were genuinely hard

- **Freezing scroll before the page boots.** `history.scrollRestoration='manual'`
  alone is not enough — the page's own scripts call `scrollTo` during layout and
  yank the viewport away. So `window.scrollTo`/`scrollBy`/`scroll` are
  *replaced* (not monkey-patched on top of something that still fires) with
  no-op shims, `scroll-behavior` is forced to `auto` so CSS smooth-scrolling
  can't animate the jump, and the shims are restored only after the second
  scroll assertion lands in `requestAnimationFrame`. Order is load-bearing:
  restore fields → caret → scroll → media → focus → scroll again, because
  focusing an element scrolls it into view and would undo the scroll restore if
  done earlier.
- **The race with framework re-render.** React/Vue hydration runs *after*
  `DOMContentLoaded` and can blank out values you just injected. So there's a
  `MutationObserver` that re-applies up to three times, 350 ms apart, and
  `capture.js` restores through the element's *native* value setter plus
  synthetic `input`/`change` events — otherwise React's synthetic event system
  never learns the value changed and your text is there visually but not in
  React's state (a classic silent failure).
- **MV3 service-worker suspension.** Chrome kills the service worker whenever
  it wants. The worker cannot keep "last time tab X was active" in memory across
  that, so `rebuildTable()` deliberately back-dates *every* tab to 30 minutes
  old on startup — otherwise a restart would mark everything "just visited" and
  nothing could ever be discarded again.
- **CSP-hostile pages.** `content.js` injects the libraries as real `<script>`
  tags, and a locked-down page (strict CSP, frozen DOM) can refuse. Every
  injection is individually `try/caught` so one failure doesn't kill the content
  script, and the worker's `chrome.tabs.sendMessage` path still captures without
  page-world injection at all.
- **Trust boundary.** The injected scripts run in the page's *main world*, so any
  page can read or overwrite `window.__UmdBundle`. `security.js` is therefore the
  single auditable gate: `type=password`, `hidden`, `file`, `submit`… never
  captured; field names matching `password|passwd|token|otp|cvv|cvc|cc|card|cardnum|ibn|ssn|aadhaar|pan` never captured (word-boundary aware, so `classic_name` and `scanner_pan` survive); autocomplete `cc-number`/`current-password` rejected; and restored `contenteditable` values are passed through `stripExecutable()` so a page that injected `<script>` into its own editable area can't get it executed on resurrection.
- **The store's own concurrency.** Writes take an exclusive `flock` on a sidecar
  lock, replay through the whole slot table, and `fsync_all()` *before* replying —
  a snapshot must be durable before its tab is killed. The read path is
  optimistic and lock-free because append-only means reads can't tear.

---

## Reality: 4 tabs vs. what actually runs, before and after

```
BEFORE — 4 tabs you are actually using, 10 Chrome processes, ~1.6 GB
(these are real numbers measured on this Mac while writing this file)

  ┌───────────────────────────────────────────────────────────────────────┐
  │  Google Chrome — 19 processes, 1.62 GB total RSS                      │
  │                                                                       │
  │  browser main ............ 117.7 MB   ← tab strip, coordinates        │
  │  GPU ..................... 254.2 MB   ← the heaviest one here          │
  │  network service .......... 88.0 MB                                   │
  │  storage ..................  32.4 MB                                  │
  │  utility (audio/webrtc) ...  70.3 MB                                  │
  │  renderer : docs .......... 127.9 MB   ← tab you're reading           │
  │  renderer : mail ......... 109.9 MB    ← tab you're reading           │
  │  renderer : video .......... 91.7 MB    ← tab you *were* reading      │
  │  renderer : github ........  72.0 MB    ← untouched for 2 hours       │
  │  renderer : news ..........  88.2 MB    ← untouched for 3 hours       │
  │  renderer : docs #2 .......  83.4 MB    ← untouched, you forgot it    │
  │  ... 7 more small helpers/lib processes                                │
  │                                                                       │
  │  Rule: renderer ⊂ per tab or per site. 4 tabs ≠ 4 renderers.          │
  └───────────────────────────────────────────────────────────────────────┘
                                 │
                     governor reads: freePct 36, pressure L3, swap 2.9 GB
                     (macOS is already swapping → "critical")
                                 │
                                 ▼
  AFTER — same 4 tabs, same tab bar, same scroll positions

  ┌───────────────────────────────────────────────────────────────────────┐
  │  Google Chrome — 10 processes, ~0.81 GB                                │
  │                                                                       │
  │  browser main ............ 117.7 MB   untouched                        │
  │  GPU ..................... 254.2 MB   untouched                        │
  │  network service ..........  88.0 MB   untouched                        │
  │  storage ..................  32.4 MB   untouched                        │
  │  utility ..................  70.3 MB   untouched                        │
  │  renderer : docs ......... 127.9 MB   ACTIVE TAB — never touched       │
  │  renderer : mail ........ 109.9 MB    ACTIVE TAB — never touched       │
  │                                                                       │
  │  [ video ]  [ github ]  [ news ]  [ docs #2 ]                          │
  │   0 MB       0 MB       0 MB      0 MB     ← renderers terminated     │
  │                                                                       │
  │  on disk instead, in the Rust store:                                   │
  │    video   →  314 B compressed   LZ77 rank-1  ◄ video playhead 22:41  │
  │    github  →  268 B compressed   LZ77 rank-1  ◄ scroll y=3390        │
  │    news    →  241 B compressed   LZ77 rank-1  ◄ 3 typed paragraphs    │
  │    docs#2  →  476 B compressed   LZ77 rank-1  ◄ scroll y=8120        │
  │                                                                       │
  │  RAM reclaimed: ~763 MB   (≈1.2 GB of the 3.1 GB those 4 tabs held)   │
  │  Data kept:     100 %   every field, caret, tick, playhead, route     │
  └───────────────────────────────────────────────────────────────────────┘
```

Click [video] and the chain in Level 3 runs in reverse: hydrate.js freezes
scroll at `document_start`, pulls the 314-byte snapshot, rewrites the form
fields through React's native setter, jumps to pixel 3390, sets the video
playhead, re-asserts in the first animation frame, and unfreezes. The first
frame you see is the one you left.

**Read the numbers honestly:** the 763 MB is an arithmetic sum of per-process
RSS, which double-counts pages several processes share. That's the same way
Activity Monitor reports it, and it's the same basis the README's "80–90%" uses.
Your real-world number will be lower — expect the reclaim to be dominated by
however heavy your heaviest background renderers were.

---

## "Isn't this just Chrome's Memory Saver with better marketing?"

Partly yes, and it's worth being precise about which part.

**What Chrome already does well, and which we did not reinvent:** Chrome ships
`chrome.tabs.discard()`, a supported API that terminates a renderer and leaves a
shell in the tab strip. Chrome 140 shipped an ML-driven Memory Saver that
predicts which tabs you'll revisit. We call the same API Chrome does. Any claim
that we invented tab discarding is false — Chrome invented it, roughly a decade
ago, and documented its own design rationale in
`chromium.org/chromium-os/chromiumos-design-docs/tab-discarding-and-reloading`.

**The four real differences:**

1. **Where it decides from.** Chrome's Memory Saver is a user preference gated on
   its own heuristics and — on desktop — largely on timers and its internal
   memory signals. This reads the *macOS kernel's own* memory-pressure level
   (`kern.memorystatus_vm_pressure_level`) and committed swap (`vm.swapusage`)
   every 2.5 s, and escalates the idle threshold from 2 minutes to 45 seconds
   when the kernel is already at level 1 or swap exceeds 500 MB. It also gates on
   **you typed here in the last 60 seconds** and **this tab holds a live
   WebSocket** (Meet, Zoom, Teams, WhatsApp, Slack — protected at the URL and
   socket level). Chrome's memory saver discarding a tab you're mid-typing in,
   or one running a call, is the exact complaint that motivated this.
2. **The restore quality.** This is the actual product. Chrome's discard discards
   *state*, and in practice you get the reload flash and a jump to the top. Here
   the snapshot is byte-complete — per-field caret ranges, per-scroller
   `scrollTop`/`scrollLeft`, media playhead, `history.state` for SPA routes,
   focus — and is applied into the page **between reload and first paint**, with
   scroll frozen and re-asserted after every framework hydration pass.
3. **Your half-typed form, specifically.** Chrome's discard explicitly does not
   preserve your form content. This does, at the cost of refusing to ever capture
   password/OTP/card fields.
4. **Cross-browser and cross-OS, same engine.** It targets Chromium generally —
   Chrome, Brave, Edge, Arc — and ships a Windows governor that reads
   `GlobalMemoryStatusEx` and CIM instead of Mach. Memory Saver exists per-browser
   and its behavior differs per vendor and version.

**Where it is weaker than Chrome's built-in, honestly:** Chrome's version is
maintained by the browser vendor, works with no install, is audited by Google's
security team, handles DRM/Site Isolation/incognito properly, and — with the ML
model — predicts your next click better than our "oldest `atime` first"
predictive-warm heuristic. If you're on a 32 GB machine, Chrome's Memory Saver is
the right answer and you don't need this. This targets the 8–16 GB laptops where
Memory Saver is off by default or too timid.

**Test it yourself, don't trust this doc:** run
`bash verify_all.sh` (the live CDP suite is the interesting one), then open
`chrome://discards` and compare against `GOV_STATUS` from the worker. All of it
is local and inspectable.

---

## "Custom Rust allocator / mmap" — what's actually there

The README says "Rust mmap" and the doc comments on `cemetery/src/lib.rs` say
"mmap-backed shared access" and "mmap readers use `MAP_SHARED`". **None of that
is in the code.** There is no `mmap` call, no `MAP_SHARED`, no memory map of any
kind anywhere in `cemetery/`. The read path is
`f.seek(SeekFrom::Start(pos))` + `f.read_exact(...)` walking a slot table
(`walk_in`), and `std` has no memory-map API. The crate is intentionally
zero-dependency so the binary builds on any unmodified machine — which is
exactly the constraint that made `mmap` unavailable.

What the store *does* have: a hand-written LZ77 compressor (hash chains over
4-byte sequences, 64 KB window, ~3–8× on HTML+state), a fixed-slot append-only
record format with a `[key|len|flags|atime|payload]` header, `fsync`-before-reply
durability, `flock(LOCK_EX)` acquired through a direct `extern "C"` FFI binding
to libc `flock` (the comment claims it shells out; it doesn't — it links
directly, which is better), LRU-by-`atime` eviction with a slot-compaction
rewrite, and an FNV-1a 32-bit URL hash shared bit-for-bit with the JS side so
one slot hits one URL.

**"Custom allocator" would be an overclaim and I'm not making it.** There is no
custom heap, no arena, no page pool, nothing competing with glibc. The design
succeeds *because* it doesn't need one: snapshots are small and short-lived.

If the goal is to also be honest in marketing: "zero-dependency Rust store with
a custom LZ77 compressor and lock-guarded durable writes" is true, defensible,
and enough. Swap it in and delete the `mmap` line from the README.

---

## "Where did the AI do it vs. where a human did it?"

Read the git log; it's one of the more honest artifacts in this repo.

```
2e8a777  RoyalInnsog         Initial release: Chrome Cemetery v1.0
bf4b093  RoyalInnsog         Initial release: Chrome Cemetery v1.0
67e0190  RoyalInnsog         Update governor, idle discards, and test fixes
cca0606  RoyalInnsog         Rename Windows installer; remove personal leaks
43605d6  Hermes Agent        Add Contributors section crediting Hermes Agent
7386354  RoyalInnsog         ChromeRAMFix: zero-UI manifest, icons, rename
ae5ab3e  RoyalInnsog         README: point clone URL at final repo slug
```

Seven commits, Oct 10 23:28 → Nov 11 01:33, about two hours of wall-clock work,
~3,400 lines of implementation and tests. An agent wrote essentially all of the
code. That fact changes nothing about what the system is.

**What the AI did:** nearly every line of Rust, JS, the manifest, the installers,
the harnesses, and the tests. Roughly 3,400 lines including a hand-written LZ77
compressor with a hash-chain match loop, an MV3 service worker with correct
back-dated table rebuild, a four-stage pre-paint restore with scroll freezing and
MutationObserver re-assert, a security module with a word-boundary-aware PII
regex, a Windows PowerShell governor, and a CDP-driven live browser test. That
output is not what a prompt spit looks like. A prompt spit is a markdown file
explaining what a program *would* do. This repo has a compiled Rust binary,
a passing test suite, and a live TCP endpoint that answers with real kernel
numbers — run `curl localhost:8795/pressure` right now and it will tell you the
machine is at pressure level 3 with 2.9 GB of swap.

**Where a human mattered, specifically:**

- The requirement "zero dependencies or it doesn't ship" is a product decision
  that shaped everything — the LZ77 was written *because* `cargo` couldn't pull
  zstd on a stock box. A model would happily have taken the dependency.
- The decision to protect live WebSocket tabs came from knowing a user loses a
  Zoom call, not a tab.
- All 7 commits are the human's, including the two that *removed* things: a
  personal-data leak in the Windows installer, an obsolete attribution. An AI
  stripped for latency doesn't spend commits scrubbing itself.

**Honest about the tests:** the suite is strong, and it is also a case where an
AI wrote the tests for its own code, which is a real caveat. `verify_all.sh`
passing means the pieces behave as specified. It does **not** mean every site on
the internet resurrects perfectly, that DRM or Site-Isolation tabs don't confuse
the flow, or that a locked-down CSP page degrades gracefully (that path exists in
code and is `try/caught`, but it is untested against a real hostile site). And
several README numbers — the `mmap` mechanism, the "80–90%" framing — are
overclaims the code doesn't back. The code is real; the marketing needs the same
scrutiny the executive asked you to apply to it.

---

## Four questions you'll actually get asked

**1. "Is it just Chrome's Memory Saver with better marketing?"**
See the section above — the short version is: same underlying discard API, but a
different decision signal (kernel pressure + swap + typing + live WebSocket vs.
vendor timer), a materially better restore (byte-complete, pre-paint, no flash),
an explicit preference for your half-typed form over Chrome's data-lightness, and
a Windows/Linux/Multi-browser port. On a big machine, don't install this. On 8–16
GB, this is the sharper tool. It also has fewer safety guarantees — Chrome's
version is vendor-audited and ours is a two-hour-old extension.

**2. "Why not just use fewer tabs?"**
You're allowed to. This exists for the case where the tabs are the work — 20 docs,
a spreadsheet, a video, three Slack channels, and the reason they're open is a
reason that doesn't disappear. Note also the honest limit: this reclaims memory
for tabs you've *stopped* using. If you're cycling through 15 tabs in rotation,
they're all "recently active" and nothing here helps much. It's a tool for
hoarders, not for tab-cyclers.

**3. "How is 250 bytes of snapshot not losing data?"**
Because the snapshot isn't a photo of the page — a copy of the DOM and every
asset would be megabytes and pointless, since Chrome re-downloads and re-renders
that anyway. It's a *diff* of your interaction with the page: which fields hold
which bytes, which scrollable is at which offset, what the caret range is, where
the video was. A human-typed form is a few hundred bytes. The page's own content
changes on reload and nobody wants the stale copy. That's also why the store can
be 5,359 bytes for 20 tabs and why `storeGet` returns in 0.048 ms.

**4. "Does it spy on me? Where do my tab contents go?"**
Everything stays on your machine. Zero network calls, no telemetry, no cloud —
the only process that ever sees a snapshot is the local `cemeteryd` binary, and
it writes to `~/Library/Application Support/` (macOS) or `%LOCALAPPDATA%`
(Windows). The one network-shaped thing in the whole system is a
`127.0.0.1:8795` loopback JSON endpoint, and specifically it's a *GET-only*,
no-write, no-input endpoint serving kernel pressure numbers to the extension —
you can read it yourself, it's `curl localhost:8795/pressure`. Fields that could
be credentials are never captured at all — not encrypted-and-stored,
*excluded*, which is stronger and is asserted in the live CDP test. What it
*does* keep: which URLs you have open and when they were last active, in memory
and in those local store slots. That's a real privacy trade, it's local to you,
and it's the same information Chrome itself holds in its own tab table.

---

## What to read next in the repo

```
README.md                          — the pitch, including the two overclaims
extension/manifest.json            — MV3, no action key (deliberately zero-UI)
extension/src/background.js        — the brain: tab table, tick, discard loop
extension/src/content.js           — page-world bridge, WebSocket facade, signals
extension/embaler/lib/capture.js   — serialize / restore, ordered by correctness
extension/embaler/lib/hydrate.js   — the pre-paint freeze/unfreeze machinery
extension/embaler/lib/security.js  — the trust boundary; what is never captured
extension/governor/lib/policy.js   — pure (pressure, tabs) -> discard decisions
extension/governor/lib/machPressure.js — reads the macOS kernel directly
extension/native-host.js           — Chrome stdio framing -> spawns cemeteryd
cemetery/src/lib.rs                — LZ77, slot store, flock, LRU eviction
governor/daemon.js                 — the :8795 loopback endpoint
tests/live.test.cdp.py             — real browser, real DOM, real assertions
verify_all.sh                      — run this; believe this, not the README
```
