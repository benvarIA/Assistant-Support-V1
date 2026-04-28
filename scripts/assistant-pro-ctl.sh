#!/usr/bin/env bash
set -euo pipefail

PORT="${PORT:-2999}"
LOG_FILE="/tmp/support-assistant-dev-${PORT}.log"
PID_FILE="/tmp/support-assistant-dev-${PORT}.pid"

start() {
  PORT="$PORT" /home/bvarisellaz/Assistant\ Pro/scripts/launch-assistant-pro.sh
}

stop() {
  pids="$(lsof -tiTCP:"$PORT" -sTCP:LISTEN -nP 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    kill $pids 2>/dev/null || true
    sleep 1
  fi
  rm -f "$PID_FILE"
  echo "Assistant Pro arrêté (port $PORT)"
}

status() {
  if lsof -iTCP:"$PORT" -sTCP:LISTEN -nP >/dev/null 2>&1; then
    lan_ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
    echo "UP"
    echo "Local: http://127.0.0.1:$PORT"
    [ -n "$lan_ip" ] && echo "LAN:   http://$lan_ip:$PORT"
    echo "Logs:  $LOG_FILE"
  else
    echo "DOWN (rien en écoute sur $PORT)"
  fi
}

open_app() {
  url="http://127.0.0.1:$PORT"
  if command -v google-chrome >/dev/null 2>&1; then
    setsid -f google-chrome "$url" >/dev/null 2>&1 || true
  else
    xdg-open "$url" >/dev/null 2>&1 || true
  fi
  echo "Ouverture: $url"
}

logs() { tail -n 100 "$LOG_FILE"; }

case "${1:-}" in
  start) start ;;
  stop) stop ;;
  restart) stop; start ;;
  status) status ;;
  open) open_app ;;
  logs) logs ;;
  *) echo "Usage: $0 {start|stop|restart|status|open|logs}"; exit 1 ;;
esac
