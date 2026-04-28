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

required_vars=(INSTANCE_NAME IOBEYA_PACKAGE_DIR MYSQL_DATABASE MYSQL_USER MYSQL_PASSWORD MYSQL_PORT_HOST)
for v in "${required_vars[@]}"; do
  if [[ -z "${!v:-}" ]]; then
    echo "Missing required variable in env: ${v}" >&2
    exit 1
  fi
done

LIQUIBASE_DIR="${IOBEYA_PACKAGE_DIR}/liquibase/mysql"
CHANGELOG_JAR="${IOBEYA_PACKAGE_DIR}/liquibase/iobeya-sql-changelog.jar"

if [[ ! -d "${LIQUIBASE_DIR}" || ! -f "${CHANGELOG_JAR}" ]]; then
  echo "Liquibase files not found in package. Expected:" >&2
  echo "  ${LIQUIBASE_DIR}" >&2
  echo "  ${CHANGELOG_JAR}" >&2
  exit 1
fi

cat <<EOT
Database init command (run manually when ready):

docker run --rm \\
  --network ${INSTANCE_NAME}-net \\
  -v "${IOBEYA_PACKAGE_DIR}/liquibase:/liquibase" \\
  -w /liquibase/mysql \\
  eclipse-temurin:21-jre \\
  java -jar /liquibase/iobeya-sql-changelog.jar \\
  --url="jdbc:mysql://mysql:3306/${MYSQL_DATABASE}?useSSL=false&allowPublicKeyRetrieval=true&serverTimezone=UTC" \\
  --username="${MYSQL_USER}" \\
  --password="${MYSQL_PASSWORD}" \\
  --changeLogFile=db/changelog/db.changelog-master.xml update

EOT
