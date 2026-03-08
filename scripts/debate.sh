#!/bin/bash
#
# AI Debate - Shell entrypoint
#
# Subcommands:
#   debate.sh start --topic "주제" --agents "claude,gemini,codex"
#   debate.sh round --debate-dir DIR --stage STAGE --round N
#   debate.sh status --debate-dir DIR
#   debate.sh check-consensus --debate-dir DIR --round N
#   debate.sh results --debate-dir DIR
#   debate.sh finalize --debate-dir DIR
#   debate.sh clean --debate-dir DIR
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() {
  cat <<EOF
AI Debate - 터미널 AI Agent 끝장 토론

Usage:
  $(basename "$0") start --topic "주제" [--agents "claude,gemini,codex"]
  $(basename "$0") round --debate-dir DIR --stage STAGE --round N
  $(basename "$0") status --debate-dir DIR
  $(basename "$0") check-consensus --debate-dir DIR --round N
  $(basename "$0") results --debate-dir DIR
  $(basename "$0") finalize --debate-dir DIR
  $(basename "$0") clean --debate-dir DIR
EOF
}

if [ $# -eq 0 ]; then
  usage
  exit 1
fi

case "$1" in
  -h|--help|help)
    usage
    exit 0
    ;;
esac

if ! command -v node >/dev/null 2>&1; then
  echo "Error: Node.js is required." >&2
  exit 127
fi

exec node "$SCRIPT_DIR/debate-job.js" "$@"
