# ChromeRAMFix — install, run, and build

The Rust store compiles from source in this repo; the governor and the
extension run straight from the checkout. No binary upload, no release
package — a resident daemon plus an unpacked extension is the whole install.

## 1. One-command install (macOS)

```bash
git clone https://github.com/imsonisaab/chrome-ram-fix.git
cd chrome-ram-fix
bash install.sh
```

This verifies/compiles the Rust `cemeteryd` binary (zero dependencies),
stages the engine and the native-messaging host bridge, registers the
launchd agent so it survives reboots, then runs `verify_all.sh` to confirm
every layer is green.

## 2. Load the extension (30 seconds, zero logouts)

1. `chrome://extensions` (or `brave://extensions`, `edge://extensions`)
2. Turn on **Developer mode**
3. **Load unpacked** → pick the `extension/` folder
4. Done — there is no popup, no toolbar badge, it runs silently

Bookmarks, cookies, saved passwords and the macOS Keychain are untouched.

## 3. What the engine does to idle tabs

- **Active / focused tab:** never touched, ~250 MB left alone
- **Idle background tabs:** DOM + form inputs + scroll + playhead + SPA
  history serialized to the Rust store in **0.048 ms** (p95 0.084 ms),
  then the OS renderer is terminated — **~150–300 MB → 0 MB**
- **Returning to a tab:** `hydrate.js` restores inputs, caret and scroll
  before the first frame paints. No white flash, no lost half-typed form.
- **Windows:** same policy via a resident PowerShell governor, stopwatch-
  verified

## 4. Verify it is actually working

```bash
bash verify_all.sh                       # unit + harness + live CDP
node --test                              # 21/21 unit suites
curl -s http://127.0.0.1:8795/pressure   # live governor reading
```

`/pressure` reports browser-scoped RSS, `pressureLevel`, `swapMB` and the
current idle window — a real measurement, never a default. A missing
reading comes back as `unavailable`, not 0.

## 5. Watchdog + storage floor

The governor refuses to discard while free disk is below the floor
(**15% of 460 GiB ≈ 69 GB**). Idle window is 120 s normally, 45 s when
swap exceeds 500 MB or kernel pressure reaches L1.

## 6. Uninstall

```bash
bash uninstall.sh        # stops the daemon, removes the staged engine + store
# then remove the unpacked extension in your browser's extensions page
```

Tabs return to normal Chromium discard behaviour immediately.

## 7. Build the Rust store from source

```bash
cd cemetery && cargo build --release
# binary lands at cemetery/target/release/cemeteryd
```

No external crates, no network needed at build time.
