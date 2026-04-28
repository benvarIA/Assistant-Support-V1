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

required_vars=(INSTANCE_NAME)
for v in "${required_vars[@]}"; do
  if [[ -z "${!v:-}" ]]; then
    echo "Missing required variable in env: ${v}" >&2
    exit 1
  fi
done

INST_DIR="${ROOT_DIR}/instances/${INSTANCE_NAME}"
SEED_DIR="${ROOT_DIR}/seeds/${SEED_NAME}"

if [[ ! -d "${SEED_DIR}" ]]; then
  echo "Seed directory not found: ${SEED_DIR}" >&2
  exit 1
fi

mkdir -p "${INST_DIR}/"{mysql/data,mysql/initdb,tomcat,app}

# Reset runtime directories
rm -rf "${INST_DIR}/mysql/data" "${INST_DIR}/mysql/initdb" "${INST_DIR}/tomcat" "${INST_DIR}/app"
mkdir -p "${INST_DIR}/mysql/data" "${INST_DIR}/mysql/initdb"

# Restore filesystem snapshot
rsync -a "${SEED_DIR}/tomcat/" "${INST_DIR}/tomcat/"
rsync -a "${SEED_DIR}/app/" "${INST_DIR}/app/"

# Place DB seed to be auto-imported on first MySQL startup
if [[ -f "${SEED_DIR}/db/seed.sql" ]]; then
  cp -f "${SEED_DIR}/db/seed.sql" "${INST_DIR}/mysql/initdb/001-seed.sql"
  echo "DB seed prepared: ${INST_DIR}/mysql/initdb/001-seed.sql"
else
  echo "No db/seed.sql found in seed. MySQL will start with empty schema unless initialized separately."
fi

echo "Instance restored from seed: ${SEED_NAME}"
echo "Next: docker compose --env-file ${ENV_FILE} -f ${ROOT_DIR}/docker/docker-compose.iobeya.yml up -d"
