#!/usr/bin/env bash
# WorkBuddy skin guardian script (macOS / Linux / Git Bash)
#
# Note: taskkill only kills the process by name (WorkBuddyAI.exe), it does not
#       kill bash itself, so this script survives the host being restarted.
#
# The app path is DISCOVERED automatically (no hardcoded drive letters), so a
# fresh clone works on any machine. Override with WORKBUDDY_EXE if needed.

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG="$SELF_DIR/apply-result.log"

PORT="${PORT:-9333}"
THEME="${THEME:-last}"

find_exe() {
  if [ -n "$WORKBUDDY_EXE" ] && [ -f "$WORKBUDDY_EXE" ]; then
    printf '%s\n' "$WORKBUDDY_EXE"; return 0
  fi
  # Ask the CLI's own doctor command first - it already knows the layout of
  # every supported platform and is the single source of truth.
  if command -v node >/dev/null 2>&1; then
    local fromCli
    fromCli="$(node "$SELF_DIR/src/cli.mjs" doctor 2>/dev/null \
      | sed -n 's/.*"app"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
    if [ -n "$fromCli" ] && [ -f "$fromCli" ]; then
      printf '%s\n' "$fromCli"; return 0
    fi
  fi
  # Fall back to common install locations
  for cand in \
    "$HOME/Applications/WorkBuddy.app/Contents/MacOS/WorkBuddy" \
    "/Applications/WorkBuddy.app/Contents/MacOS/WorkBuddy" \
    "$LOCALAPPDATA/Programs/workbuddy/WorkBuddy.exe" \
    "$LOCALAPPDATA/workbuddy/WorkBuddy.exe"; do
    [ -f "$cand" ] && { printf '%s\n' "$cand"; return 0; }
  done
  return 1
}

echo "[$(date '+%F %T')] bash apply-ai START" >> "$LOG"

EXE="$(find_exe)" || {
  echo "[$(date '+%F %T')] ERROR: WorkBuddy not found. Set WORKBUDDY_EXE." >> "$LOG"
  exit 1
}
echo "[$(date '+%F %T')] exe=$EXE port=$PORT theme=$THEME" >> "$LOG"

if [ "$(uname -s)" = "Darwin" ]; then
  echo "[$(date '+%F %T')] quitting WorkBuddy (osascript) ..." >> "$LOG"
  osascript -e 'quit app "WorkBuddy"' >> "$LOG" 2>&1
  sleep 5
  echo "[$(date '+%F %T')] relaunch with CDP $PORT ..." >> "$LOG"
  "$EXE" --remote-debugging-port="$PORT" >> "$LOG" 2>&1 &
else
  PROC="$(basename "$EXE" .exe)"
  echo "[$(date '+%F %T')] killing $PROC ..." >> "$LOG"
  MSYS_NO_PATHCONV=1 taskkill /F /IM "$PROC.exe" >> "$LOG" 2>&1
  sleep 5
  echo "[$(date '+%F %T')] relaunch with CDP $PORT ..." >> "$LOG"
  "$EXE" --remote-debugging-port="$PORT" >> "$LOG" 2>&1 &
fi

sleep 18

cd "$SELF_DIR" || exit 1
echo "[$(date '+%F %T')] applying theme $THEME ..." >> "$LOG"
node src/cli.mjs apply --port "$PORT" --theme "$THEME" >> "$LOG" 2>&1
sleep 2
echo "[$(date '+%F %T')] status:" >> "$LOG"
node src/cli.mjs status --port "$PORT" >> "$LOG" 2>&1

echo "[$(date '+%F %T')] bash apply-ai END" >> "$LOG"
