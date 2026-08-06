#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${AITEAM_ENV_FILE:-$ROOT_DIR/backend/app/config/.env.local}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing environment file: $ENV_FILE" >&2
  exit 1
fi

set -a
source "$ENV_FILE"
set +a

export DASHSCOPE_API_KEY="${EMBEDDING_API_KEY:-${ZW_AI_EMBEDDING_API_KEY:-}}"
export GBRAIN_EMBEDDING_MODEL="dashscope:text-embedding-v3"
export GBRAIN_EMBEDDING_DIMENSIONS="1024"
export OPENAI_BASE_URL="${MODEL_BASE_URL:-${ZW_AI_HIGRESS_BASE_URL:-https://api.openai.com/v1}}"
export OPENAI_API_KEY="${OPENAI_API_KEY:-${ZW_AI_HIGRESS_API_KEY:-${HIGRESS_API_KEY:-}}}"
export GBRAIN_CHAT_MODEL="openai:gpt-5.5"
export GBRAIN_ADMIN_BOOTSTRAP_TOKEN="${GBRAIN_ADMIN_BOOTSTRAP_TOKEN:-$(cat "$HOME/.gbrain/admin-token")}"

exec "${BUN_BIN:-$HOME/.bun/bin/bun}" "$ROOT_DIR/backend/gbrain/src/cli.ts" serve \
  --http \
  --port "${GBRAIN_PORT:-3131}" \
  --bind "${GBRAIN_HOST:-127.0.0.1}"
