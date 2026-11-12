# Review — Social Launch Drafts (adversarial)

## Source of truth used for this review

Measured facts supplied by the task brief (not re-derived): p50 **0.048 ms**, p95 **0.084 ms**, max **0.203 ms**; 20 tabs = **5,359 bytes**; per-tab **150–300 MB → 0 MB**; idle **2 min** / **45 s under pressure**; restore **byte-identical**; password/card/OTP stripped; **100% local, zero cloud**. Cross-checked against the repo's own README (`chrome-cemetery/README.md`, which matches all of these, including max 0.203 ms being absent — see note below) and the GitHub-account-suspended constraint.

## Availability of artifacts

| File | State |
|---|---|
| `reddit-post.md` | **MISSING — the agent that was to write it produced no file.** The `marketing/` directory did not exist at all; this review created it. |
| `twitter-thread.md` | **MISSING — never written.** |
| `product-hunt.md` | **MISSING — never written.** |

`ls /Users/apple/Documents/chrome-cemetery` confirms no `marketing/` directory exists; `git status` is clean; `git ls-files` contains no marketing path. No sibling output exists anywhere on disk. **Nothing can be graded against the bar, because nothing was produced.** The defect therefore is total non-delivery, not copy defects.

## Defect table

| file | PASS/FAIL | defect | required fix |
|---|---|---|---|
| `reddit-post.md` | **FAIL** | File does not exist. No draft, no numbers, no branding — zero content to verify. The whole file's content is the defect. | Author it from scratch against the measured facts (p50 0.048 ms / p95 0.084 ms / max 0.203 ms; 20 tabs = 5,359 bytes; 150–300 MB → 0 MB per tab; 2 min / 45 s pressure idle; byte-identical restore; 100% local, zero cloud). Exact product noun **ChromeRAMFix** with **Chrome** as the headline noun in the title. No `/download` or clone-link CTA — the GitHub account is suspended, so link nothing that 404s; use a waitlist/comment CTA. No hype words. Then re-submit for review. |
| `twitter-thread.md` | **FAIL** | File does not exist. Nothing to grade. | Author from scratch; every number must be one of the measured values above and each claim tied to how it was measured (so it reads as test output, not marketing). ChromeRAMFix / Chrome-headline naming. No live-repo or download implication. Then re-submit. |
| `product-hunt.md` | **FAIL** | File does not exist. Nothing to grade. | Author from scratch, same fact whitelist and naming rules, same dead-link prohibition (no GitHub clone URL, no install command, no "download now"). Then re-submit. |
| *(all three)* | **FAIL (process)** | The three files were dispatched and none landed; there is no fallback, partial, or stub in the repo or in git history to salvage. | Re-dispatch with a hard deliverable check: each file must exist, be non-empty, and pass the fact/naming/hype/link gate before the task is reported done. |

## Adversarial notes for whoever rewrites these (traps found in the live README that a copywriter will be tempted to copy)

1. **"max 0.203 ms" is absent from the README** but is in the measured-fact set. If a draft cites latency, citing only p50/p95 while the max is 3.9× the p50 is a survivable choice, but citing "0.2 ms" or "sub-0.25 ms" as a *typical/consistent* number is an inflation — max is the tail, not the norm. Either quote p50 and p95 as the honest pair, or state max explicitly as a worst case.
2. **"80–90% less RAM" (README headline)** is a *brave* framing to reuse: it is derived, not measured as a percentage. Prefer the measured form "150–300 MB → 0 MB per idle tab" or "10–15 tabs from 3–5 GB+ to the active tab only" — the blast-radius of a discount claim is much larger than of a per-tab measurement.
3. **Clone URL `https://github.com/RoyalInnsog/chrome-ram-fix.git` is in the README but is a dead link** (account suspended). It must not appear in any social copy, and no draft may imply the product is installable today.
4. **Stale product strings survive in-tree** (`Brave-RAM-Edition-Windows-Installer.*`, `chrome_cemetery` launchd label, 'Chrome Cemetery' commit subject). If a draft mentions a filename or OS component name, it must be the current one — an installer name that doesn't exist in the product is the kind of detail that gets a launch thread shredded.
5. **~25 MB background footprint and "21/21 unit tests · 4/4 harnesses"** are in the README as measured. They are honest and highly usable for an anti-astroturf posture (admitting the cost, admitting the test scope) — recommend drafts use them rather than omitting them.

## Verdict

All three files FAIL on non-delivery. No copy-level defects could be found because no copy exists. Nothing here is safe to post; nothing here is even wrong. Re-run the authoring pass, then re-review against this document's whitelist.
