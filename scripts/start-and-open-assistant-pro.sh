#!/usr/bin/env bash
set -euo pipefail

PORT="${PORT:-2999}"
URL="http://127.0.0.1:${PORT}"
LAUNCHER="/home/bvarisellaz/Assistant Pro/scripts/launch-assistant-pro.sh"
LOG_FILE="/tmp/assistant-pro-desktop-launch-${PORT}.log"

notify() {
  if command -v notify-send >/dev/null 2>&1; then
    notify-send "Assistant Pro" "$1" || true
  fi
}

{
  echo "[$(date -Is)] Lancement d'Assistant Pro..."
  "$LAUNCHER"
  echo "[$(date -Is)] Ouverture de $URL"
} >>"$LOG_FILE" 2>&1 || {
  notify "Échec du lancement. Logs : $LOG_FILE"
  exit 1
}

# Ouvre explicitement dans Chrome/Chromium si disponible, sinon navigateur par défaut.
if command -v google-chrome >/dev/null 2>&1; then
  setsid -f google-chrome "$URL" >/dev/null 2>&1 || true
elif command -v google-chrome-stable >/dev/null 2>&1; then
  setsid -f google-chrome-stable "$URL" >/dev/null 2>&1 || true
elif command -v chromium >/dev/null 2>&1; then
  setsid -f chromium "$URL" >/dev/null 2>&1 || true
elif command -v chromium-browser >/dev/null 2>&1; then
  setsid -f chromium-browser "$URL" >/dev/null 2>&1 || true
else
  xdg-open "$URL" >/dev/null 2>&1 || true
fi

notify "Assistant Pro est lancé : $URL"
