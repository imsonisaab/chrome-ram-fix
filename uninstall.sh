#!/bin/bash
# uninstall.sh — clean removal of Brave Browser RAM Edition.
#
# REMOVES:
#   - the RAM Edition app bundles (/Applications + ~/Applications)
#   - the native messaging host registration
#   - the launchd agents (governor daemon, watchdog, chainwatch, scheduler)
#   - the runtime store + logs under ~/Library/.../ChromeRAMFix
#
# NEVER TOUCHES:
#   - your Brave profile, bookmarks, passwords, cookies, history
#   - the real /Applications/Brave Browser.app or any Brave install
#   - the repo itself (source stays; remove by hand if you want)
#
#   bash uninstall.sh              # interactive, asks before deleting
#   bash uninstall.sh --yes        # non-interactive
#   bash uninstall.sh --purge      # also delete the state store (saved tabs)

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE="$HOME/Library/Application Support/ChromeRAMFix"
LOGS="$HOME/Library/Logs/ChromeRAMFix"
STORE="$STATE/store"

PURGE=0
ASSUME_YES=0
for a in "$@"; do
  case "$a" in
    --purge) PURGE=1 ;;
    -y|--yes) ASSUME_YES=1 ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    *) echo "unknown flag: $a"; exit 1 ;;
  esac
done

c_grn='\033[0;32m'; c_yel='\033[0;33m'; c_red='\033[0;31m'; c_off='\033[0m'
ok()   { printf "${c_grn}[OK]${c_off} %s\n" "$*"; }
warn() { printf "${c_yel}[..]${c_off} %s\n" "$*"; }
gone() { printf "${c_red}[--]${c_off} %s\n" "$*"; }

confirm() { # confirm <prompt>
  [ "$ASSUME_YES" = 1 ] && return 0
  read -r -p "$1 [y/N] " reply
  [[ "$reply" =~ ^[Yy] ]]
}

echo "=== Brave Browser RAM Edition uninstaller ==="

# ---------- 1. launchd agents ----------
echo "[1/5] unloading launchd agents"
for d in "$HOME/Library/LaunchAgents" "$ROOT/launchd"; do
  [ -d "$d" ] || continue
  for pl in "$d"/*.plist; do
    [ -f "$pl" ] || continue
    L="$(/usr/bin/plutil -extract Label raw "$pl" 2>/dev/null || basename "$pl" .plist)"
    case "$L" in
      *chrome-cemetery*|*chrome_ram_fix*|*level3*)
        launchctl bootout "gui/$UID/$L" >/dev/null 2>&1 || launchctl unload "$pl" >/dev/null 2>&1 || true
        rm -f "$d/$L.plist"
        gone "agent: $L"
        ;;
    esac
  done
done
# any daemon still holding port 8795
PID_ON_PORT="$(lsof -ti tcp:8795 2>/dev/null || true)"
[ -n "$PID_ON_PORT" ] && kill $PID_ON_PORT 2>/dev/null && gone "governor daemon pid $PID_ON_PORT"
ok "agents cleared"

# ---------- 2. native messaging host ----------
echo "[2/5] native messaging host"
for d in "$HOME/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts" \
         "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"; do
  [ -f "$d/com.chrome_ram_fix.bridge.json" ] || continue
  rm -f "$d/com.chrome_ram_fix.bridge.json"
  gone "host: $d/com.chrome_ram_fix.bridge.json"
done
ok "host unregistered"

# ---------- 3. app bundles ----------
echo "[3/5] app bundles"
for APP in "/Applications/Brave Browser RAM Edition.app" \
           "$HOME/Applications/Brave Browser RAM Edition.app" \
           "$HOME/Applications/Brave Browser.app.bak"; do
  if [ -d "$APP" ]; then
    if confirm "delete $APP ?"; then
      rm -rf "$APP" && gone "app: $APP"
    else
      warn "kept: $APP"
    fi
  fi
done
ok "apps handled"

# ---------- 4. state + logs ----------
echo "[4/5] state and logs"
[ -d "$LOGS" ] && { confirm "delete logs at $LOGS ?" && rm -rf "$LOGS" && gone "logs" || warn "kept: $LOGS"; }
if [ "$PURGE" = 1 ]; then
  [ -d "$STORE" ] && rm -rf "$STORE" && gone "store: $STORE (saved tab states purged)"
  [ -d "$STATE" ]  && rm -rf "$STATE"  && gone "state dir"
else
  if [ -d "$STORE" ]; then
    warn "kept: $STORE (saved tab states — rerun with --purge to delete)"
    warn "kept: $STATE"
  fi
fi

# ---------- 5. report ----------
echo "[5/5] report"
ok "uninstall complete"
echo
echo "NOT touched (by design):"
echo "  - your Brave profile/brave-core checkout: $ROOT"
echo "  - the real Brave Browser.app in /Applications"
echo "  - BraveSoftware/Brave-Browser profile data"
