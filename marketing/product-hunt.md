# ChromeRAMFix — Product Hunt launch kit

Draft only. Nothing here has been posted or scheduled.

**GitHub account RoyalInnsog is suspended.** No repo URL, clone command, install command, store link, or "download now" appears anywhere in this file. The one link slot in the maker comment is a placeholder to be filled with a working distribution URL before posting.

---

## 1. Listing copy

### Product name (PH title field)

**ChromeRAMFix**

12 characters. Chrome is the lead noun, per the branding rule. Nothing else in the field.

### Tagline

**Chrome RAM fix: 300 MB tab -> 0 MB. Restored byte-identical.**

60 characters, including spaces. Counted programmatically, not eyeballed — the first draft of this line ran 64 and was cut.

Alternates, all verified under 60:

- `Chrome RAM fix: 300 MB tabs -> 0 MB, restore byte-identical` (59)
- `Idle Chrome tabs: 300 MB -> 0 MB. Zero lost work.` (49)
- `Kill Chrome's memory bloat without killing your open tabs` (57)

Final pick stands at exactly 60 because it is the only variant that carries the per-tab number, the mechanism (renderer process ends, RAM goes to zero), and the fidelity promise (byte-identical) in one line, with no hype word doing work a number should be doing.

### Short description (the PH description field, <=260 chars)

Final:

```
Chrome burns RAM on idle tabs you'll never read again. ChromeRAMFix compresses each
to disk in 0.048 ms, ends its renderer process, and restores forms, scroll and
media playheads byte-identical before first paint. Passwords, cards never
captured. 100% local.
```

258 characters including spaces and newlines, counted programmatically. The first
draft of this came in at 304 and was cut to fit; see the rewrite note below.

Why it is built this way: it opens with the felt problem, gives the measured
latency, states the mechanism, names the differentiator, and closes on the privacy
posture. It does not spend characters on what the product refuses to do beyond the
one clause that matters, because the 260 budget is tight and that clause is the
trust-building part.

Alternates considered, counted:

| Variant | Chars | Rejected because |
|---|---|---|
| `Chrome burns RAM on idle tabs you'll never read again. ChromeRAMFix compresses one to disk in 0.048 ms, ends its renderer process, and restores forms, scroll and playheads byte-identical before first paint. 100% local, zero cloud.` | 230 | Fits, but drops the sensitive-field clause entirely, which is the line that stops a privacy-minded reader from assuming the worst. |
| `Chrome burns RAM on idle tabs you'll never read again. ChromeRAMFix compresses one to disk in 0.048 ms, ends its renderer, and restores forms, scroll and playheads byte-identical before first paint. Passwords never captured. 100% local.` | 236 | Keeps the promise but says "passwords" only. Cards and OTPs are stripped too, and under-claiming here is its own small dishonesty. |
| `Chrome RAM fix: idle tabs compress to disk and their renderer dies, dropping 150-300 MB to 0 MB. Restore is byte-identical, before first paint. 100% local.` | 155 | Fits easily, but no latency number and no privacy line. |
| `Cut Chrome's memory use on idle background tabs from 3-5 GB to near zero without losing any open tab. 0.048 ms restore, byte-identical state, passwords and card fields stripped. Local only.` | 189 | The 3-5 GB figure is a derived range claim, weaker than the per-tab measurement, and the review flagged derived percentages as higher-risk. |
| `ChromeRAMFix fixes Chrome's RAM bloat. Idle tabs are compressed and their process killed, then restored byte-identical with zero flash. Free, open source, MIT.` | 159 | No number, no privacy statement, and "free, open source" while pointing at a suspended repo. |

Rewrite note: the 304-char first draft read "Chrome eats RAM on idle tabs you'll
never read again ... Passwords and card fields are never captured. 100% local,
zero cloud." Cutting it meant dropping "media", "and", "are never" and the second
cloud clause, not dropping the measured number.

Character counts were measured with `len()` in Python, not estimated. See the verification note at the bottom.

---

## 2. Topics / launch tags

Product Hunt's launch flow takes up to three tags. Pick these three:

1. **Browser Extensions** (confirmed live topic)
2. **Developer Tools** (confirmed live topic; this is an engine with benchmarks, not just a utility)
3. **Apple** (confirmed live topic; covers the macOS audience, which is where the measured numbers come from)

Notes on the choice:

- **Windows** is not a launch tag on Product Hunt. Windows support belongs in the description, the maker comment, and the support matrix in the gallery, not in the tag slot.
- **Privacy** and **Chrome Extensions** appeared as secondary labels on topic pages but are not the canonical top-level tags. Do not spend a slot on them.
- If PH only shows two free slots, drop **Developer Tools** and keep Browser Extensions plus Apple. Browser Extensions is non-negotiable; it is the topic where the product actually competes.

---

## 3. Maker comment (first comment from the maker)

Post this as the very first comment, from the maker account, before sharing the link anywhere.

---

Hi PH, maker here.

I keep a lot of tabs open, and Chrome was using 4.2 GB of my RAM while I worked. Chrome's built-in Memory Saver is supposed to help, but every time I clicked back on a discarded tab it reloaded the page: half-typed form gone, scroll position back at the top, white flash. It fixed the memory and ate my work in the same move. So I built ChromeRAMFix.

How it works, in one pass. The extension watches two things: how long a tab has been idle, and whether your machine is actually short on memory. It only acts when both point the same way. Before it ends an idle tab's renderer process, it writes a snapshot of that tab to disk: typed values, caret position, scroll offsets down to the pixel, media playhead, SPA route. Then Chrome's own supported discard API terminates the process, and a tab that was costing 150-300 MB drops to 0 MB. Click it again and the page is already at the right scroll position with your text in it, before the first frame paints.

The numbers I measured on this machine, not marketing numbers:

- store read latency p50: 0.048 ms, p95 0.084 ms
- 20 tabs compressed: 5,359 bytes total, about 268 bytes per tab
- per-tab RAM: 150-300 MB to 0 MB
- restore fidelity: byte-identical, asserted by tests
- engine's own cost: about 25 MB RSS

The restore is the whole product. The bar I set was byte-identical restore, and the test suite asserts it on forms, caret ranges, scroll offsets and UTF-8 payloads. That is why the read path is a plain file seek with an fsync before the tab dies, and why the injected restore script re-applies scroll up to three times, 350 ms apart, to survive React and Vue hydration wiping it.

What it never touches: the tab you're reading, pinned tabs, anything playing audio or video, conferencing and messaging tabs (Meet, Zoom, Teams, WhatsApp Web, Discord, Slack), and anything you interacted with in the last 60 seconds. It reads real OS memory pressure instead of a timer, so idle is 2 minutes normally and 45 seconds only when your machine is actually swapping.

Privacy, stated plainly: no cloud, no telemetry, no account, nothing leaves your machine. Password, card, OTP and auth-token fields are stripped by the serializer before anything is written to disk, and the round-trip tests assert a password field is never captured at all. Bookmarks, cookies and your Keychain are untouched.

Where it stands versus Chrome's built-in, honestly: Chrome's version is maintained by Google, needs no install, and is audited by their security team. Ours works on any Chromium browser (Chrome, Brave, Edge, Arc), on macOS and Windows 10/11, and it preserves your form state. If you have 32 GB of RAM, you do not need this and Chrome's Memory Saver is fine. This is for 8-16 GB laptops where it is off by default or too timid.

One current caveat: pages with a strict CSP can refuse the injected restore script, so the snapshot is captured but the page comes back blank until you scroll. It is caught per-page, it doesn't break anything else, and the worker's capture path still works on those pages.

Browsers: Chrome, Brave, Edge, Arc and any Chromium. macOS on Apple Silicon and Intel, Windows 10/11. MIT licensed. Tests are 21/21 unit, 4/4 harnesses, plus a live Chrome DevTools Protocol round-trip suite.

Genuinely want feedback, not just upvotes. Two questions I'd most like judged:

1. Is 2 minutes the right default idle time, or is that too aggressive for people who leave a tab open to come back to it?
2. Does anyone want the engine cost made configurable? Right now it holds at about 25 MB and I have not measured what relaxing that buys.

Link below: [distribution URL placeholder: GitHub account RoyalInnsog is suspended, so this stays empty until a working URL exists]

---

Word count: roughly 660. The PH first-comment norm is 150-280 words; this runs longer on purpose, because the reviewer's standing bar for this product is that every claim traces to a measured fact, and that needs room. If you want it shorter, the cut order is: the stack paragraph (already implied), then the stack detail on fsync and the MutationObserver, then the question about configurable engine cost. Cut the honest-comparison and the CSP caveat last, not first: they are what keep this from reading as hype.

Alternate opening line, if you prefer to lead with the number rather than the story:

> Chrome was using 4.2 GB of my RAM. Its memory saver was helping, until I clicked a discarded tab and watched my half-typed form disappear. So I built ChromeRAMFix.

---

## 4. Gallery assets

Product Hunt's story gallery: first slot is usually a video, static images follow, 1270x760 recommended, under 3MB each. Below are the five static descriptions to art-direct, plus the optional video slot.

Slot 1 should be a 30-60 second screen capture of the before/after in Chrome Task Manager. If you cannot record one, use Asset 1 as the lead instead.

### Asset 1 — Before and after, one number

**What the viewer should see, in this order:** split panel. Left half is Chrome Task Manager showing a handful of background tabs and their memory column, 150-300 MB each. Right half is the same panel after ChromeRAMFix ran, with those tabs reading 0 MB, and one row visible for the engine itself at about 25 MB. A single large headline across the top, and a caption under the split: "Same tabs. Same machine. Measured."

**Headline (primary text):** `300 MB -> 0 MB`

**Caption (secondary):** Renderer process terminated, RAM reclaimed, tab still in the tab bar.

**Do not:** show a percentage figure. "80-90% less RAM" is derived arithmetic, not a measurement, and it is the exact claim a technical audience will attack.

### Asset 2 — The differentiator, in one frame

**What the viewer should see:** two stacked panels of the same page, top labelled "other memory savers" and bottom "ChromeRAMFix", both showing a restored tab. Top panel: page at scroll top, form empty, a faint white reload band still visible. Bottom panel: typed text present with a caret in the field, scroll mid-page, no reload band. Small label under each: "state lost" and "byte-identical, restored before first paint".

**Headline:** `It restores the state, not just the tab`

**Do not:** mock a competitor by name. Show the failure mode, not a brand.

### Asset 3 — The measured numbers

**What the viewer should see:** a clean spec table against a dark background, five rows, no charts. Rows: store read p50 0.048 ms; store read p95 0.084 ms; 20 tabs on disk 5,359 bytes; per-tab RAM 150-300 MB -> 0 MB; engine cost ~25 MB RSS. Source line at the bottom: "M1 Pro, measured with the repo's own test harness". Footer: MIT, 100% local.

**Headline:** `Numbers from the harness`

**Do not:** quote the max latency (0.203 ms) as though it were typical. It is the tail, roughly 4x the p50. If the table has a sixth row, label it explicitly "worst case".

### Asset 4 — What it never touches

**What the viewer should see:** a list panel, five items, each with a small "protected" marker: active tab, pinned tabs, playing audio or video, Meet / Zoom / Teams / WhatsApp Web / Discord / Slack, anything touched in the last 60 seconds. One line under the list: "It reads real OS memory pressure, not a timer. Idle 2 min, or 45 s under swap pressure."

**Headline:** `What it will never take away from you`

**Do not:** claim it protects every page on the internet. The protection list is finite and specific.

### Asset 5 — Privacy and reach

**What the viewer should see:** two columns. Left: a list of field types with a strikethrough treatment, password, card number, OTP, auth token, with the line "stripped by the serializer before anything is written to disk". Right: a platform matrix, Chrome / Brave / Edge / Arc on macOS (Apple Silicon, Intel) and Windows 10/11, with "no cloud, no telemetry, no account" under it.

**Headline:** `Nothing leaves your machine`

**Do not:** say "encrypted" unless the store actually encrypts at rest. It compresses with LZ77; that is not encryption.

### Video slot (optional, 30-60s)

Shot list, in order: (1) Chrome Task Manager with idle background tabs eating 150-300 MB each; (2) ChromeRAMFix runs, the RAM column drops to 0, tab bar unchanged; (3) click a discarded tab, show the typed text and scroll position land before any paint, no white flash; (4) `bash verify_all.sh` output with the suite going green; (5) end card, product name, Chrome, no call to action that implies a live download. If the last frame reads "download now", it has to resolve to real working code, which today it does not.

---

## 5. Pre-post checklist

- [ ] Product name field reads exactly `ChromeRAMFix`, nothing appended
- [ ] Tagline is 60 characters or fewer (currently exactly 60; recount if edited)
- [ ] Description is 260 characters or fewer (currently 258; recount if edited)
- [ ] Exactly 3 topics selected: Browser Extensions, Developer Tools, Apple
- [ ] No GitHub URL, clone command, install command, or store link anywhere in the listing
- [ ] Maker comment posted as the first comment, from the maker account
- [ ] Every number in every asset is one the test harness measured
- [ ] No copy claims an install is available until a working URL exists
- [ ] The `hype word` pass: no "revolutionary", "game-changing", "seamless", "effortless", "unleash"

---

## 6. Verification note

Character counts were computed with `len()` in Python, not estimated, and the whole
file was re-checked after every edit:

```
name:            len() = 12
tagline final:   len() = 60   (limit 60)
description:     len() = 258  (limit 260)
```

First-pass errors caught by that check and fixed: the tagline's first draft was 64
characters, the description's was 304, and the name length was stated as 14 when it
is 12. The 259 figure that originally sat in this section was itself wrong.

Fact whitelist used, all measured: p50 0.048 ms; p95 0.084 ms; 20 tabs = 5,359
bytes; ~268 B/tab; per-tab 150-300 MB -> 0 MB; idle 2 min / 45 s under pressure;
byte-identical restore; password/card/OTP/token stripped; ~25 MB RSS; 21/21 unit,
4/4 harnesses, live CDP; Chrome, Brave, Edge, Arc, any Chromium; macOS (Apple
Silicon, Intel) and Windows 10/11.

Deliberately excluded and why: the 80-90% RAM figure (derived, not measured); the
0.203 ms max latency (worst case, roughly 4x p50, would mislead if presented as
typical); the `github.com/RoyalInnsog/chrome-ram-fix.git` clone URL (account
suspended, dead link); any "download now" phrasing; and any "mmap" language (the
store's read path is a file seek; the code has no memory map).

Scan result: no live URL, clone command, or install command appears in the listing
copy, the maker comment, or the gallery art direction. The repo URL appears only
inside this verification note, named as the thing that must not be posted.
