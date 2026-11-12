# Adversarial Review — Video Script & Plain-Language Explainer

Reviewer scope: sibling artifacts `video/script-final.md` (shot table + FFmpeg drawtext commands),
`marketing/how-it-works-plain.md` (4-level explanation).

## VERDICT UP FRONT

**There is nothing to review. Neither file exists.**

Not a partial delivery, not a stub, not in git history — the files were never written. `video/`
does not exist as a directory. `marketing/` contains only `twitter-thread.md` and a sibling's
`REVIEW-social.md`. Both target paths were re-checked ~10 minutes apart over the course of this
review and no write ever landed. `git status` is clean apart from the untracked `marketing/` dir;
`git stash list` is empty; no alternate branch holds the work.

So the honest outcome is **FAIL × 4 criteria, all for the same reason: non-delivery.** Per the
no-fabrication rule I did not invent plausible script text, plausible drawtext commands, or
plausible explanation paragraphs to grade. Below I report only what I *did* execute, which is the
part of the brief that is independently checkable: the toolchain those commands would need, and
the real call chain those claims would need to match.

---

## Defect table

| file | PASS/FAIL | defect | required fix |
|---|---|---|---|
| `video/script-final.md` | **FAIL** | Does not exist. No shot table, no drawtext commands, no font paths. Nothing to execute. | Write it, then submit. Every drawtext command must actually run (see hard blocker below). |
| `video/script-final.md` — FFmpeg commands | **FAIL (blocked)** | Cannot be verified, and on this machine **no drawtext command can run at all**: the installed FFmpeg 9.0.2 (homebrew, `/Users/apple/Documents/toolchains/homebrew/bin/ffmpeg`) has **no `drawtext` filter**. `ffmpeg -filters \| grep -c drawtext` → `0`. `--buildconf` lists no `freetype`/`fontconfig`/`harfbuzz`/`fribidi`/`libass`. Exact error on the probe command: `[AVFilterGraph @ 0x7b82c18200] No such filter: 'drawtext'` / `Error opening output file /tmp/ov_test.png.` / `Error opening files: Filter not found`. | Reinstall FFmpeg with the text deps (`brew reinstall ffmpeg` with freetype+fontconfig+libass, or `--with-libass` style build). Fonts do exist on disk (`/System/Library/Fonts/Supplemental/Arial.ttf` present, `ls` OK), so this is purely an FFmpeg build problem, not a missing-font problem. Then re-run the full probe from the brief. |
| `video/script-final.md` — ASCII diagram | **FAIL (unverifiable)** | No diagram shipped. No line widths to count. | Keep every line ≤100 chars in monospace. Note the repo's own README diagram already hits **185 chars max** (`awk` over its code fence) — do not copy that as a reference; it wraps in most viewers. |
| `marketing/how-it-works-plain.md` | **FAIL** | Does not exist. No 4 levels, no claims. | Write it against the source chain below, then submit. |
| `marketing/how-it-works-plain.md` — Level 3 technical chain | **FAIL (unverifiable)** | The claimed chain cannot be checked because the doc doesn't exist. For the rewrite, the chain *is* real — I traced every hop in the source (evidence below). Two of the five hops as stated in the brief are imprecise and must be written carefully. | Use the verified wording in "Verified chain" below. |
| `marketing/how-it-works-plain.md` — honest-engineering section | **FAIL (unverifiable)** | Nothing to grade. | Must credit both: `README.md:181-184` names **Hermes Agent (Nous Research)** for "architecture, implementation, testing, and packaging" and **RoyalInnsog** as owner/maintainer. Claiming hand-written-from-scratch or entirely-AI-generated are both false. Name real components: Rust `cemeteryd` store (zero crates, own LZ77 + mmap), Node governor on `:8795`, MV3 extension with zero UI, Embaler libs, launchd agent. |

---

## Verified chain (for whoever writes Level 3)

I read `extension/src/background.js`, `extension/src/content.js`, `extension/embaler/lib/hydrate.js`,
`extension/governor/lib/policy.js`, `extension/governor/lib/pressureClient.js`, `extension/native-host.js`,
`extension/manifest.json`, `governor/daemon.js`, `cemetery/src/lib.rs`.

Confirmed hops:

1. **Content script at `document_start` — TRUE.** `manifest.json:33` `"run_at": "document_start"`,
   `content.js:26-34` injects `/embaler/lib/hydrate.js` first via a real script tag at document start.
   Caveat: the content script's *capture* role is pull-based — `background.js:246` sends
   `EMBAL_CAPTURE` and `content.js:151-158` replies via `new E(window).capture()`. "capture at
   document_start" is only true for the **restore/hydrate** path, not the discard-capture path.
   The brief's phrasing conflates them.
2. **Governor `:8795` decision — PARTLY IMPRECISE.** The decision is made **inside the extension**,
   not by the daemon: `background.js:217` calls `GOVPolicy.decide(...)` (pure JS, `policy.js`).
   `:8795` only supplies the **pressure sample** (`pressureClient.js:8` → `http://127.0.0.1:8795/pressure`,
   `background.js:184`). Live check: daemon is running (PID 33327, LISTEN on 127.0.0.1:8795) and
   returns `{"level":3,"freePct":34,"swapMB":2924,"reason":"severe","totalMB":15742,...}`.
   `/health` advertises itself but is **not implemented** — `daemon.js:18-20` returns
   `{"error":"not found","paths":["/pressure","/health"]}` for anything that isn't `/pressure*`.
3. **`chrome.tabs.discard()` — TRUE.** `background.js:233`, guarded at 226-227 (already-discarded /
   too-young skip). Capture happens first via `captureAndMark()` at line 232.
4. **`cemeteryd` store — TRUE.** `background.js:252` `storePut()` → `native-host.js` spawns
   `cemeteryd serve` (`Cargo.toml` bin name `cemeteryd`), JSON-lines RPC, 4-byte LE native-message
   framing. Store format `CMTR`, own LZ77-ish compressor, mmap readers — `cemetery/src/lib.rs:1-13,65-66`.
   I ran the binary directly: `put`/`get`/`keys`/`warm`/`size` all work, UTF-8 payload round-tripped
   (probe file written to `cemetery/data/`, which is gitignored; I removed it).
   Note the FNV-1a key is JS-side (`background.js:162-169`), and `storePut` at line 252 is **not
   awaited** — fire-and-forget. Restore prefers the store and falls back to `chrome.storage.session`
   (`background.js:276-284`).
5. **`hydrate.js` pre-paint restore — TRUE.** `hydrate.js` freezes scroll at document_start, applies
   state on `DOMContentLoaded`, re-asserts on first `requestAnimationFrame`, re-asserts again on
   MutationObserver quiescence, dispatches `cemetery:restored`. Reachable via the
   `EMBAL_WAKE_SNAPSHOT` message (`background.js:272-286`) through the `window.__cemeteryBridge`
   installed by `content.js:48-55`.

Real chain wording that survives review:
`content.js@document_start injects hydrate.js → background.js tick() samples :8795/pressure → GOVPolicy.decide() (in-extension, not the daemon) → captureAndMark() sends EMBAL_CAPTURE, then chrome.tabs.discard() → storePut() → native-host.js → cemeteryd serve (CMTR store, LZ77+mmap) → EMBAL_WAKE_SNAPSHOT + hydrate.js pre-paint restore`

---

## Adversarial notes

- The FFmpeg gap is the single most expensive finding here: if the sibling wrote 20-40 drawtext
  commands, **every one of them fails on this box.** Fix the toolchain before re-rendering, or the
  whole video deliverable is unbuildable regardless of script quality.
- Do **not** describe the governor daemon as "the thing that decides what to discard." It publishes
  a number; the extension decides. A technically literate audience catches this immediately.
- The pressure sample is debounced to 1500 ms and holds last-known on daemon-down, marked
  `source:'stale:...'` (`pressureClient.js`). "Reads real OS memory pressure" is honest; "reads it
  live every tick" is not.
- `chrome.storage.session` is a real fallback path, so "100% durable on disk" needs the qualifier
  "when the native host is available."
- Repo naming is mid-transition (manifest still says `ChromeRAMFix` / `com.brave_cemetery.bridge`
  while README/title say ChromeRAMFix and commits say "Chrome Cemetery"). Any caption or overlay in
  the video must pick the current strings or it will look wrong next to the shipped manifest.
