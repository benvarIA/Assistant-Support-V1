#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${1:-${ROOT_DIR}/.env}"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Missing env file: ${ENV_FILE}" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

if [[ -z "${INSTANCE_NAME:-}" ]]; then
  echo "Missing INSTANCE_NAME in env" >&2
  exit 1
fi

COMPOSE_FILE="${ROOT_DIR}/docker/docker-compose.iobeya.yml"
INST_DIR="${ROOT_DIR}/instances/${INSTANCE_NAME}"

docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" down -v --remove-orphans || true
rm -rf "${INST_DIR}/mysql/data" "${INST_DIR}/mysql/initdb"

echo "Instance runtime destroyed: ${INSTANCE_NAME}"
echo "App/tomcat files are kept in ${INST_DIR}"
