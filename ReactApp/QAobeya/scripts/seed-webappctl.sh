#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-${ROOT_DIR}/.env}"
PORT="${SEED_WEBAPP_PORT:-8787}"
PID_FILE="${ROOT_DIR}/logs/seed-webapp.pid"
LOG_FILE="${ROOT_DIR}/logs/seed-webapp.log"

usage() {
  echo "Usage: $0 {start|stop|restart|status|logs} [env_file]"
}

if [[ $# -lt 1 ]]; then
  usage
  exit 1
fi

CMD="$1"
if [[ $# -ge 2 ]]; then
  ENV_FILE="$2"
fi

is_running() {
  [[ -f "${PID_FILE}" ]] && kill -0 "$(cat "${PID_FILE}")" 2>/dev/null
}

wait_ready() {
  local tries=15
  for _ in $(seq 1 "${tries}"); do
    if curl -fsS "http://localhost:${PORT}/api/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.4
  done
  return 1
}

start() {
  if [[ ! -f "${ENV_FILE}" ]]; then
    echo "Env file introuvable: ${ENV_FILE}" >&2
    exit 1
  fi

  mkdir -p "${ROOT_DIR}/logs"

  if is_running; then
    echo "seed-webapp deja demarree (pid $(cat "${PID_FILE}"))"
    exit 0
  fi

  nohup node "${ROOT_DIR}/tools/seed-agent/web-app.mjs" --env "${ENV_FILE}" --port "${PORT}" >>"${LOG_FILE}" 2>&1 &
  echo $! > "${PID_FILE}"
  if is_running && wait_ready; then
    echo "seed-webapp demarree: http://localhost:${PORT} (pid $(cat "${PID_FILE}"))"
  else
    rm -f "${PID_FILE}"
    echo "Echec demarrage. Voir logs: ${LOG_FILE}" >&2
    exit 1
  fi
}

stop() {
  if ! [[ -f "${PID_FILE}" ]]; then
    echo "seed-webapp non demarree"
    exit 0
  fi

  local pid
  pid="$(cat "${PID_FILE}")"
  if kill -0 "${pid}" 2>/dev/null; then
    kill "${pid}" || true
    sleep 0.6
    if kill -0 "${pid}" 2>/dev/null; then
      kill -9 "${pid}" || true
    fi
  fi
  rm -f "${PID_FILE}"
  echo "seed-webapp arretee"
}

status() {
  if is_running; then
    echo "seed-webapp RUNNING pid=$(cat "${PID_FILE}") port=${PORT}"
  else
    rm -f "${PID_FILE}" 2>/dev/null || true
    echo "seed-webapp STOPPED"
    exit 1
  fi
}

show_logs() {
  touch "${LOG_FILE}"
  tail -n 80 "${LOG_FILE}"
}

case "${CMD}" in
  start) start ;;
  stop) stop ;;
  restart) stop || true; start ;;
  status) status ;;
  logs) show_logs ;;
  *) usage; exit 1 ;;
esac
