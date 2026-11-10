# Brave RAM Edition — Windows install (DELL_SONI)

Same engine that runs on the Mac: kernel-pressure-driven tab discarding with a
zero-flash state store. No showpiece popup, no toolbar clutter — it runs
silently in the background of your normal Brave.

## Install

1. Copy the whole `Brave-RAM-Edition-Windows-Installer` folder to the laptop.
2. Double-click **`Brave-RAM-Edition-Windows-Installer.cmd`**.
   It is a single self-contained file: it unpacks its own payload and runs the
   installer. No tooling, no admin rights.
3. Restart Brave. Nothing appears in the UI; that is the point.

**Want a `.exe` icon instead of a `.cmd`?** Copy the folder to the laptop and
run `build-windows-exe.bat` once — it wraps the same file with `iexpress`
(already installed on Windows 11) into
`Brave-RAM-Edition-Windows-Installer.exe`. This has to happen on Windows:
`iexpress.exe` ships only with Windows, and the Mac build machine has no
cross-compiler, so producing a runnable PE there is not possible. We deliberately
ship a working `.cmd` rather than a fake "exe" that Windows would refuse to run.

Prerequisites: **Node.js LTS** (https://nodejs.org). PowerShell 5.1 ships with
Windows 11. **No admin rights required.**

## What it does

| # | Action | Where |
|---|---|---|
| 1 | Copies the engine | `%LOCALAPPDATA%\BraveCemetery\` |
| 2 | Registers the native messaging host | `…\Brave-Browser\NativeMessagingHosts\com.brave_cemetery.bridge.json` |
| 3 | Force-loads the unpacked extension | `HKCU\SOFTWARE\Policies\BraveSoftware\Brave-Browser\ExtensionInstallForcelist` |
| 4 | Hidden background governor (logon task) | Scheduled Task `BraveCemeteryGovernor` |
| 5 | Starts the governor now | `http://127.0.0.1:8795/pressure` |

## Verify it is alive

```bat
curl http://127.0.0.1:8795/pressure
```

Expected (Windows):

```json
{"level":1,"freePct":52,"swapMB":814,"reason":"warn","totalMB":16384,
 "kernelLevel":41,"platform":"windows","at":1731840000000}
```

- `swapMB` is real committed pagefile usage in MB — from `GlobalMemoryStatusEx` + `Win32_OperatingSystem`.
- `kernelLevel` is the Windows memory load, 0–100.
- `level`/`reason` use the exact same 0–4 thresholds as the macOS governor.

## Discard timing

| Situation | Idle before a background tab is compressed + discarded |
|---|---|
| Normal | **2 minutes** |
| Swap already > 500 MB, or kernel pressure ≥ L1 | **45 seconds** |

Audible tabs, pinned tabs, the focused tab, live-meeting URLs and anything you
typed in within 60 s are never discarded.

## Uninstall

Double-click **`uninstall-windows.bat`** (add `--purge` to also delete saved
tab states). It removes only the RAM-Edition engine. Your Brave install,
profile, history, cookies and passwords are never touched.
