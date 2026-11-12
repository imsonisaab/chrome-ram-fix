# ChromeRAMFix: Twitter/X launch thread

Deliverables: 10-tweet launch thread, single-tweet variant, 5 pull-quote cards, pinned-reply technical FAQ, self-critique.

Posting status: drafts only. The launch link in the README points at a suspended GitHub account, so no repo URL is placed in any tweet. Swap the placeholder in tweet 10 before posting.

All tweets are straight-quote, no-URL, and verified under 280 characters.

---

## 1. The launch thread

**1/** I keep 15 tabs open. Chrome is using 4.2 GB of my RAM and the fans spin up whenever I switch apps.

Chrome's built-in memory saver fixes this by reloading tabs on restore. Half-typed form, gone. Scroll position, back to top. White flash.

That's not a fix. That's a trade.

**2/** So I built ChromeRAMFix.

It compresses idle tabs to disk and terminates their renderer process. A 300 MB tab drops to 0 MB. Click it, and it comes back byte-identical, before the page paints.

15 background tabs, 3-5 GB down to ~0.

**3/** The numbers, because numbers or it didn't happen:

- store read p50: 0.048 ms
- store read p95: 0.084 ms
- 20 tabs on disk: 5,359 bytes total
- engine footprint: ~25 MB RSS
- restore fidelity: byte-identical

**4/** The reason it doesn't feel janky:

Our content script fires at document_start and pushes your recovered state in before requestAnimationFrame. Inputs, caret, scroll coordinates, media playhead.

You click a tab and it's just there. No flash, no reload, no lost work.

**5/** What it never touches:

- the tab you're reading
- pinned tabs
- anything playing audio or video
- Meet, Zoom, Teams, WhatsApp Web, Discord, Slack
- tabs you touched in the last 60 seconds

Idle before discard: 2 minutes. Under memory pressure: 45 seconds.

**6/** It reads actual OS memory pressure instead of guessing.

macOS: sysctl vm.swapusage plus kern.memorystatus_vm_pressure_level
Windows: GlobalMemoryStatusEx plus Win32_OperatingSystem

Machine is fine, tabs stay live. Swap is thrashing, it acts now.

**7/** Privacy, stated plainly:

Passwords, card fields, OTP boxes and auth tokens are stripped before state hits the disk. Nothing leaves your machine. No cloud, no telemetry, no account.

Bookmarks, cookies and Keychain entries are never touched.

**8/** Stack, for the curious:

- Rust snapshot store, zero crates, LZ77 + mmap
- Node governor on :8795, publishes pressure
- MV3 extension, zero UI, no badge, no popup
- PowerShell governor for Windows 10/11

macOS and Windows. Starts at login via launchd.

**9/** Test results: 21/21 unit, 4/4 harnesses, plus live Chrome DevTools Protocol round-trip assertions on forms, scroll offsets and UTF-8 payloads.

The bar was byte-identical restore. Not close enough. Byte-identical.

**10/** I built this because Chrome's memory saver kept eating my work and I got tired of negotiating with it.

If your Mac feels slow for reasons that aren't your fault, this is what I was missing. [repo link]

RT the first tweet if it helps someone.

---

## 2. Single-tweet variant

Chrome's memory saver reloads idle tabs, which eats half-typed forms, resets scroll, and throws a white flash. So I built the alternative: idle tabs compress to disk in 0.048 ms, the renderer dies, RAM drops to 0 MB, and a click restores the tab byte-identical before paint.

---

## 3. Pull-quote cards

Pair each with the matching screenshot or metric panel.

1. **"300 MB tab. 0 MB after discard. Restored byte-identical before the first paint."**
   *Pair with: RAM column of Chrome Task Manager before/after.*

2. **"Chrome's memory saver reloads your tabs. It reloads your half-typed form with them."**
   *Pair with: two-panel shot of lost input vs. restored input.*

3. **"0.048 ms to read a compressed tab. My tab does not notice."**
   *Pair with: p50/p95 latency table or benchmark output.*

4. **"Passwords, card fields and OTPs are stripped before anything is written to disk. Nothing leaves your machine."**
   *Pair with: security.js strip log or local storage path.*

5. **"The bar was byte-identical restore. Not close enough. Byte-identical."**
   *Pair with: terminal output of verify_all.sh going green.*

---

## 4. Pinned reply: technical FAQ

Keep this posted under tweet 1 and drop the link to it under any question.

**Q: Is this just chrome.tabs.discard() with extra steps?**
No. The native discard API throws the tab state away. We serialize DOM state, form inputs, exact scroll coordinates, audio/video playheads and SPA history first, then compress, then discard. That's the part Chrome skips.

**Q: How fast is the snapshot?**
Store read p50 is 0.048 ms, p95 0.084 ms, across 200 consecutive get requests on a persistent stdio IPC loop, timed with Python perf_counter. 20 tabs compressed is 5,359 bytes, about 268 bytes per tab.

**Q: Does it lose my work when a tab comes back?**
The round-trip tests assert byte-identical restore on forms, caret position, scroll offsets and UTF-8 payloads. hydrate.js runs at document_start, so the recovered state lands before requestAnimationFrame and before the first paint.

**Q: What stops it from killing a tab I care about?**
Protected list: active tab, pinned tabs, anything playing media, conferencing and messaging tabs (Meet, Zoom, Teams, WhatsApp Web, Discord, Slack), and anything you interacted with in the last 60 seconds.

**Q: How does it decide when to discard?**
Reads real OS memory pressure, not a timer heuristic. macOS uses sysctl vm.swapusage and kern.memorystatus_vm_pressure_level. Windows uses GlobalMemoryStatusEx and Win32_OperatingSystem. Idle threshold is 2 minutes normally, 45 seconds under pressure.

**Q: Does it touch my passwords or cookies?**
No. Password, card, OTP and auth token fields are stripped by the serializer before anything is written to disk. No telemetry, no cloud, no account. Your Keychain and cookie jar are untouched.

**Q: How much does the engine itself cost?**
About 25 MB RSS for the daemon plus native messaging bridge. The store is a zero-crate Rust binary using LZ77, FLOCK for locking and an LRU eviction policy.

**Q: Which browsers and OSes?**
Any Chromium browser on macOS (Apple Silicon and Intel) and Windows 10/11: Chrome, Brave, Edge, Arc. Installs as an unpacked MV3 extension plus a launchd agent.

**Q: How do I uninstall?**
`bash uninstall.sh --yes`. It removes the engine and the launchd agent and never touches browser profiles.

**Q: Is it open source?**
MIT. Link below.

---

## 5. Self-critique

**Weakest tweet: 6/, the OS pressure reading tweet.**

Why:

- It's the only tweet whose content is entirely implementation detail with no felt benefit attached. Every other tweet answers "what does this do for me" or "why should I believe you." This one answers "how did he do it," and the answer (two sysctl names and a Win32 call) is inert to most of the audience. Technically literate readers nod; everyone else scrolls.
- The payload is a name-dump. `kern.memorystatus_vm_pressure_level` is 35 characters of a word that no one has ever typed voluntarily. In a thread that's otherwise tuned for rhythm, that line drags the scan rate down and breaks the visual line length.
- It sits at the emotional dead zone. Slide 4 is the "it feels magic" tweet, slide 5 is the "what it won't break" tweet. Slide 6 interrupts that arc with plumbing, and the thread only gets back to stakes at 9/ and 10/.
- The argument is also weaker than it looks. Anyone can claim to read a sysctl. It reads as a credibility gesture rather than evidence, because there's no number attached. Compare to 3/, where the claim is the number.

Fix if revised: fold the sysctl names into the FAQ (they're already there, and they read better there) and use the tweet slot for a contrast instead: Chrome's saver refreshes on a timer, this reads swap usage, so the behavior tracks the machine actually struggling. One concrete consequence beats two symbol names.
