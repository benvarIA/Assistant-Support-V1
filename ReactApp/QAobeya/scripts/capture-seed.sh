#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${1:-${ROOT_DIR}/.env}"
SEED_NAME="${2:-iobeya443-empty}"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Missing env file: ${ENV_FILE}" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

required_vars=(INSTANCE_NAME MYSQL_USER MYSQL_PASSWORD MYSQL_DATABASE)
for v in "${required_vars[@]}"; do
  if [[ -z "${!v:-}" ]]; then
    echo "Missing required variable in env: ${v}" >&2
    exit 1
  fi
done

INST_DIR="${ROOT_DIR}/instances/${INSTANCE_NAME}"
SEED_DIR="${ROOT_DIR}/seeds/${SEED_NAME}"

if [[ ! -d "${INST_DIR}" ]]; then
  echo "Instance directory not found: ${INST_DIR}" >&2
  exit 1
fi

mkdir -p "${SEED_DIR}/"{app,tomcat,db}

# Snapshot filesystem parts needed by iObeya runtime
rsync -a --delete "${INST_DIR}/app/" "${SEED_DIR}/app/"
rsync -a --delete "${INST_DIR}/tomcat/" "${SEED_DIR}/tomcat/"

# Capture DB seed if MySQL container is running
MYSQL_CONTAINER="${INSTANCE_NAME}-mysql"
if docker ps --format '{{.Names}}' | grep -Fxq "${MYSQL_CONTAINER}"; then
  echo "MySQL container running, exporting SQL seed..."
  docker exec "${MYSQL_CONTAINER}" sh -lc \
    "mysqldump -u\"${MYSQL_USER}\" -p\"${MYSQL_PASSWORD}\" --single-transaction --set-gtid-purged=OFF \"${MYSQL_DATABASE}\"" \
    > "${SEED_DIR}/db/seed.sql"
  echo "DB seed exported: ${SEED_DIR}/db/seed.sql"
else
  echo "MySQL container not running; DB seed not exported."
  echo "You can re-run this script after startup to capture db/seed.sql."
fi

echo "Seed captured in: ${SEED_DIR}"
