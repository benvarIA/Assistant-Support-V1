#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${1:-${ROOT_DIR}/.env}"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Missing env file: ${ENV_FILE}" >&2
  echo "Copy .env.example to .env (or pass path as first argument)." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

required_vars=(
  INSTANCE_NAME MYSQL_DATABASE MYSQL_USER MYSQL_PASSWORD
  IOBEYA_PACKAGE_DIR ROOT_AUTHORIZE_URI ROOT_TOKEN_URI
)

for v in "${required_vars[@]}"; do
  if [[ -z "${!v:-}" ]]; then
    echo "Missing required variable in env: ${v}" >&2
    exit 1
  fi
done

if [[ ! -d "${IOBEYA_PACKAGE_DIR}" ]]; then
  echo "IOBEYA_PACKAGE_DIR not found: ${IOBEYA_PACKAGE_DIR}" >&2
  exit 1
fi

WEBAPP_SRC=""
if [[ -d "${IOBEYA_PACKAGE_DIR}/iobeya" ]]; then
  WEBAPP_SRC="${IOBEYA_PACKAGE_DIR}/iobeya"
elif [[ -d "${IOBEYA_PACKAGE_DIR}/webapp" ]]; then
  WEBAPP_SRC="${IOBEYA_PACKAGE_DIR}/webapp"
else
  echo "Package content missing: expected '${IOBEYA_PACKAGE_DIR}/iobeya' or '${IOBEYA_PACKAGE_DIR}/webapp'" >&2
  exit 1
fi

if [[ ! -d "${IOBEYA_PACKAGE_DIR}/liquibase" ]]; then
  echo "Package content missing: ${IOBEYA_PACKAGE_DIR}/liquibase" >&2
  exit 1
fi

INST_DIR="${ROOT_DIR}/instances/${INSTANCE_NAME}"
mkdir -p "${INST_DIR}/"{mysql/data,mysql/initdb,tomcat/conf,tomcat/lib,app/data/index,app/data/temp,app/data/cache,app/assets,app/logs,app/settings/plugins,app/docBase}

# Render ROOT.xml and log4j2.xml from templates.
envsubst < "${ROOT_DIR}/templates/ROOT.xml.tpl" > "${INST_DIR}/tomcat/conf/ROOT.xml"
envsubst < "${ROOT_DIR}/templates/log4j2.xml.tpl" > "${INST_DIR}/app/settings/log4j2.xml"

# Copy webapp exploded directory from package (doc says root app deployment only from 4.40+)
rsync -a --delete "${WEBAPP_SRC}/" "${INST_DIR}/app/docBase/iobeya/"

# Reset JDBC candidates to keep a single clear driver in tomcat/lib
find "${INST_DIR}/tomcat/lib" -maxdepth 1 -type f \( -iname '*mysql*connector*.jar' -o -iname '*mariadb*.jar' \) -delete || true

# Copy JDBC driver(s) provided in package if present
if compgen -G "${WEBAPP_SRC}/WEB-INF/lib/*mysql*.jar" > /dev/null; then
  cp -f "${WEBAPP_SRC}"/WEB-INF/lib/*mysql*.jar "${INST_DIR}/tomcat/lib/" || true
fi
if compgen -G "${WEBAPP_SRC}/WEB-INF/lib/*mariadb*.jar" > /dev/null; then
  cp -f "${WEBAPP_SRC}"/WEB-INF/lib/*mariadb*.jar "${INST_DIR}/tomcat/lib/" || true
fi

# Preferred source: existing Tomcat lib on Windows/WSL (if provided)
if [[ -n "${TOMCAT_WINDOWS_LIB_DIR:-}" ]]; then
  preferred_jar="$(find "${TOMCAT_WINDOWS_LIB_DIR}" -maxdepth 1 -type f \( -iname '*mysql*connector*.jar' -o -iname '*mariadb*.jar' \) | head -n 1 || true)"
  if [[ -n "${preferred_jar}" ]]; then
    cp -f "${preferred_jar}" "${INST_DIR}/tomcat/lib/mysql-connector-java.jar"
  fi
fi

# Fallback source: package liquibase folder
if ! compgen -G "${INST_DIR}/tomcat/lib/*mysql*connector*.jar" > /dev/null && [[ -f "${IOBEYA_PACKAGE_DIR}/liquibase/mysql/mysql-connector-java.jar" ]]; then
  cp -f "${IOBEYA_PACKAGE_DIR}/liquibase/mysql/mysql-connector-java.jar" "${INST_DIR}/tomcat/lib/"
fi

# Save immutable copy of source files for traceability when available
if [[ -f "${IOBEYA_PACKAGE_DIR}/ROOT.xml" ]]; then
  cp -f "${IOBEYA_PACKAGE_DIR}/ROOT.xml" "${INST_DIR}/app/settings/ROOT.xml.source"
fi
if [[ -f "${IOBEYA_PACKAGE_DIR}/log4j2.xml" ]]; then
  cp -f "${IOBEYA_PACKAGE_DIR}/log4j2.xml" "${INST_DIR}/app/settings/log4j2.xml.source"
elif [[ -f "${IOBEYA_PACKAGE_DIR}/settings/log4j2.xml" ]]; then
  cp -f "${IOBEYA_PACKAGE_DIR}/settings/log4j2.xml" "${INST_DIR}/app/settings/log4j2.xml.source"
fi

echo "Prepared instance: ${INSTANCE_NAME}"
echo "Instance directory: ${INST_DIR}"
echo "Next: run scripts/check-prereqs.sh then docker compose --env-file <env> -f docker/docker-compose.iobeya.yml config"
