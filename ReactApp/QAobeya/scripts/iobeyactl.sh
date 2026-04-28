#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${IOBEYA_ENV_FILE:-${ROOT_DIR}/.env}"
COMPOSE_FILE="${ROOT_DIR}/docker/docker-compose.iobeya.yml"

usage() {
  cat <<USAGE
Usage: $(basename "$0") <start|stop|restart|status|logs|ps|down> [--] [extra docker compose args]

Environment overrides:
  IOBEYA_ENV_FILE  Path to env file (default: ${ROOT_DIR}/.env)
USAGE
}

need_files() {
  [[ -f "${ENV_FILE}" ]] || { echo "Missing env file: ${ENV_FILE}" >&2; exit 1; }
  [[ -f "${COMPOSE_FILE}" ]] || { echo "Missing compose file: ${COMPOSE_FILE}" >&2; exit 1; }
}

run_compose() {
  docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" "$@"
}

cmd="${1:-}"
shift || true

case "${cmd}" in
  start)
    need_files
    run_compose up -d "$@"
    ;;
  stop)
    need_files
    run_compose stop "$@"
    ;;
  restart)
    need_files
    run_compose restart "$@"
    ;;
  status|ps)
    need_files
    run_compose ps "$@"
    ;;
  logs)
    need_files
    run_compose logs -f --tail=200 "$@"
    ;;
  down)
    need_files
    run_compose down "$@"
    ;;
  *)
    usage
    exit 1
    ;;
esac
