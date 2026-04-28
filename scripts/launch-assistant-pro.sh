#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/home/bvarisellaz/Assistant Pro/ReactApp/Support Assistant"
HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-2999}"
LOCAL_URL="http://127.0.0.1:${PORT}"
LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
LAN_URL="${LAN_IP:+http://${LAN_IP}:${PORT}}"
LOG_FILE="/tmp/support-assistant-dev-${PORT}.log"
PID_FILE="/tmp/support-assistant-dev-${PORT}.pid"

cd "$APP_DIR"

if [ ! -d node_modules ]; then
  echo "Installation des dépendances..."
  npm install
fi

# Déjà en écoute ?
if lsof -iTCP:"$PORT" -sTCP:LISTEN -nP >/dev/null 2>&1; then
  echo "Assistant Pro déjà lancé."
  echo "Local: $LOCAL_URL"
  [ -n "$LAN_URL" ] && echo "LAN:   $LAN_URL"
  echo "Logs:  $LOG_FILE"
  exit 0
fi

# Démarrage détaché et robuste
setsid npm run dev -- --host "$HOST" --port "$PORT" --strictPort > "$LOG_FILE" 2>&1 < /dev/null &
SERVER_PID=$!
echo "$SERVER_PID" > "$PID_FILE"

sleep 2
if ! lsof -iTCP:"$PORT" -sTCP:LISTEN -nP >/dev/null 2>&1; then
  echo "Échec du démarrage. Logs: $LOG_FILE"
  tail -n 40 "$LOG_FILE" || true
  exit 1
fi

echo "Assistant Pro lancé."
echo "Local: $LOCAL_URL"
[ -n "$LAN_URL" ] && echo "LAN:   $LAN_URL"
echo "PID:   $SERVER_PID"
echo "Logs:  $LOG_FILE"
echo "PID file: $PID_FILE"
