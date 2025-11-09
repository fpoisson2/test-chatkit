#!/bin/sh
set -eu

DEFAULT_DSN="postgresql://litellm:litellm@${LITELLM_DB_HOST:-127.0.0.1}:${LITELLM_DB_PORT:-5433}/${LITELLM_POSTGRES_DB:-litellm}"

EFFECTIVE_DSN="${LITELLM_DATABASE_URL:-}"
if [ -z "$EFFECTIVE_DSN" ]; then
  EFFECTIVE_DSN="$DEFAULT_DSN"
fi

export LITELLM_DATABASE_URL="$EFFECTIVE_DSN"
export DATABASE_URL="$EFFECTIVE_DSN"
export PRISMA_DATABASE_URL="$EFFECTIVE_DSN"

exec litellm --config /app/config.yaml --port "${LITELLM_PORT:-4000}"
