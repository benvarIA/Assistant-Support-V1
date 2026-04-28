#!/usr/bin/env bash
set -euo pipefail

PORT="${PORT:-2999}"
URL="http://127.0.0.1:${PORT}"
LAUNCHER="/home/bvarisellaz/Assistant Pro/scripts/launch-assistant-pro.sh"
LOG_FILE="/tmp/assistant-pro-windows-launch-${PORT}.log"

{
  echo "[$(date -Is)] Lancement d'Assistant Pro depuis le bureau Windows..."
  "$LAUNCHER"
  echo "[$(date -Is)] Ouverture dans Chrome Windows: $URL"
} >>"$LOG_FILE" 2>&1 || {
  if command -v powershell.exe >/dev/null 2>&1; then
    powershell.exe -NoProfile -Command "Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('Echec du lancement Assistant Pro. Logs WSL: $LOG_FILE','Assistant Pro')" >/dev/null 2>&1 || true
  fi
  exit 1
}

# Ouvre explicitement Chrome côté Windows. Si Chrome n'est pas résolu, fallback navigateur Windows par défaut.
if command -v powershell.exe >/dev/null 2>&1; then
  powershell.exe -NoProfile -ExecutionPolicy Bypass -Command \
    "try { Start-Process 'chrome.exe' '$URL' } catch { Start-Process '$URL' }" \
    >/dev/null 2>&1 || true
elif command -v cmd.exe >/dev/null 2>&1; then
  cmd.exe /C "start chrome $URL" >/dev/null 2>&1 || cmd.exe /C "start $URL" >/dev/null 2>&1 || true
else
  xdg-open "$URL" >/dev/null 2>&1 || true
fi
