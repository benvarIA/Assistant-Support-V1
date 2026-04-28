#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

INSTANCE_NAME="${1:-iObeya443-temp}"
HTTP_PORT="${2:-8080}"
MYSQL_PORT="${3:-3306}"

OUT_FILE="${ROOT_DIR}/.env"
cp -f "${ROOT_DIR}/.env.example" "${OUT_FILE}"

sed -i "s|^INSTANCE_NAME=.*|INSTANCE_NAME=${INSTANCE_NAME}|" "${OUT_FILE}"
sed -i "s|^HTTP_PORT_HOST=.*|HTTP_PORT_HOST=${HTTP_PORT}|" "${OUT_FILE}"
sed -i "s|^MYSQL_PORT_HOST=.*|MYSQL_PORT_HOST=${MYSQL_PORT}|" "${OUT_FILE}"

echo "Created ${OUT_FILE}"
echo "Single-instance mode configured: ${INSTANCE_NAME} (${HTTP_PORT}/${MYSQL_PORT})"
echo "Now edit at least: IOBEYA_PACKAGE_DIR, ROOT_AUTHORIZE_URI, ROOT_TOKEN_URI, passwords"
