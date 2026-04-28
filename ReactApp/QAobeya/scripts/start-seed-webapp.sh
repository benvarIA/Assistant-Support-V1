#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${1:-${ROOT_DIR}/.env}"
PORT="${SEED_WEBAPP_PORT:-8787}"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Env file introuvable: ${ENV_FILE}" >&2
  exit 1
fi

cd "${ROOT_DIR}"
exec node tools/seed-agent/web-app.mjs --env "${ENV_FILE}" --port "${PORT}"
