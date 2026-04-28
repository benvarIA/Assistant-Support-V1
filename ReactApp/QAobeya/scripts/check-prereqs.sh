#!/usr/bin/env bash
set -euo pipefail

missing=0

check_cmd() {
  local cmd="$1"
  local label="$2"
  if command -v "$cmd" >/dev/null 2>&1; then
    echo "OK    ${label}: $(command -v "$cmd")"
  else
    echo "MISS  ${label}: command '$cmd' not found"
    missing=1
  fi
}

check_cmd docker "Docker Engine CLI"
check_cmd envsubst "gettext/envsubst"
check_cmd rsync "rsync"
check_cmd unzip "unzip"
check_cmd curl "curl"

if command -v docker >/dev/null 2>&1; then
  if docker compose version >/dev/null 2>&1; then
    echo "OK    Docker Compose plugin: $(docker compose version | head -n 1)"
  else
    echo "MISS  Docker Compose plugin: 'docker compose' unavailable"
    missing=1
  fi
fi

if [[ ${missing} -eq 1 ]]; then
  echo "Prerequisites missing. Install missing tools before deployment." >&2
  exit 1
fi

echo "All prerequisites look available."
