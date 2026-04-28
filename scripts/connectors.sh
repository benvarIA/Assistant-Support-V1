#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PERSIST_DIR="${PERSIST_DIR:-$ROOT_DIR/.codex/persistant/token}"

M365_SCRIPT="$ROOT_DIR/skills/microsoft-365-workspace/scripts/ms_graph_cli.py"
JIRA_SCRIPT="$ROOT_DIR/skills/jira-workspace/scripts/jira_cli.py"

export M365_PERSIST_DIR="$PERSIST_DIR"
export JIRA_PERSIST_DIR="$PERSIST_DIR"

mkdir -p "$PERSIST_DIR"

migrate_outlook_cache() {
  local old_dir="$ROOT_DIR/codex/persistant/token"
  local new_dir="$PERSIST_DIR"

  if [[ -f "$old_dir/m365_config.json" && ! -f "$new_dir/m365_config.json" ]]; then
    cp "$old_dir/m365_config.json" "$new_dir/m365_config.json"
  fi
  if [[ -f "$old_dir/m365_token.json" && ! -f "$new_dir/m365_token.json" ]]; then
    cp "$old_dir/m365_token.json" "$new_dir/m365_token.json"
  fi
}

run_outlook_status() {
  if python3 -u "$M365_SCRIPT" auth status >/tmp/m365_status.json 2>/tmp/m365_status.err; then
    echo "[OK] Outlook connecté"
    cat /tmp/m365_status.json
  else
    echo "[KO] Outlook non connecté"
    cat /tmp/m365_status.err
  fi
}

run_jira_status() {
  if python3 -u "$JIRA_SCRIPT" auth status >/tmp/jira_status.json 2>/tmp/jira_status.err; then
    echo "[OK] Jira connecté"
    cat /tmp/jira_status.json
  else
    echo "[KO] Jira non connecté"
    cat /tmp/jira_status.err
  fi
}

jira_is_connected() {
  python3 -u "$JIRA_SCRIPT" auth status >/tmp/jira_status.json 2>/tmp/jira_status.err
}

usage() {
  cat <<USAGE
Usage:
  scripts/connectors.sh status
  scripts/connectors.sh login outlook
  scripts/connectors.sh login jira
  scripts/connectors.sh login all
  scripts/connectors.sh outlook <args...>
  scripts/connectors.sh jira <args...>

Notes:
  - Persistance commune: $PERSIST_DIR
  - Outlook utilise: skills/microsoft-365-workspace/scripts/ms_graph_cli.py
  - Jira utilise: skills/jira-workspace/scripts/jira_cli.py
USAGE
}

main() {
  migrate_outlook_cache

  local cmd="${1:-}"
  case "$cmd" in
    status)
      run_outlook_status
      echo ""
      run_jira_status
      ;;

    login)
      local target="${2:-}"
      case "$target" in
        outlook)
          python3 -u "$M365_SCRIPT" auth login
          ;;
        jira)
          if jira_is_connected; then
            echo "[SKIP] Jira déjà connecté"
            cat /tmp/jira_status.json
          else
            python3 -u "$JIRA_SCRIPT" auth setup
          fi
          ;;
        all)
          python3 -u "$M365_SCRIPT" auth login
          if jira_is_connected; then
            echo "[SKIP] Jira déjà connecté"
            cat /tmp/jira_status.json
          else
            python3 -u "$JIRA_SCRIPT" auth setup
          fi
          ;;
        *)
          usage
          exit 1
          ;;
      esac
      ;;

    outlook)
      shift
      python3 -u "$M365_SCRIPT" "$@"
      ;;

    jira)
      shift
      python3 -u "$JIRA_SCRIPT" "$@"
      ;;

    *)
      usage
      exit 1
      ;;
  esac
}

main "$@"
