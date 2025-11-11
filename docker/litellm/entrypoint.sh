#!/bin/sh
set -eu

fallback="postgresql://postgres:postgres@litellmdb:5432/litellm"

# Prefer an explicit LiteLLM DSN when provided
if [ "${LITELLM_DATABASE_URL:-}" != "" ]; then
  export DATABASE_URL="$LITELLM_DATABASE_URL"
fi

# Ensure Prisma always sees a postgres:// URL
case "${DATABASE_URL:-}" in
  postgres://*|postgresql://*)
    :
    ;;
  *)
    export DATABASE_URL="$fallback"
    ;;
esac

exec litellm "$@"
