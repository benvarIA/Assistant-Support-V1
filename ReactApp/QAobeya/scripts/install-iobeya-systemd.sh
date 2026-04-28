#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_NAME="iobeya"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
CTL_SCRIPT="${ROOT_DIR}/scripts/iobeyactl.sh"

if [[ ! -x "${CTL_SCRIPT}" ]]; then
  echo "Missing executable control script: ${CTL_SCRIPT}" >&2
  exit 1
fi

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root: sudo $0" >&2
  exit 1
fi

cat > "${SERVICE_FILE}" <<UNIT
[Unit]
Description=iObeya stack (docker compose)
After=docker.service network-online.target
Wants=network-online.target
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=${ROOT_DIR}
ExecStart=${CTL_SCRIPT} start
ExecStop=${CTL_SCRIPT} stop
ExecReload=${CTL_SCRIPT} restart
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable "${SERVICE_NAME}.service"

echo "Installed ${SERVICE_FILE}"
echo "Use: systemctl start|stop|restart|status ${SERVICE_NAME}"
