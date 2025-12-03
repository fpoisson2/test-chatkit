#!/bin/sh
set -euo pipefail

DOMAIN_RAW="${CLOUDFLARE_TUNNEL_HOSTNAME:?CLOUDFLARE_TUNNEL_HOSTNAME is required}"
DOMAIN="${DOMAIN_RAW#https://}"
DOMAIN="${DOMAIN#http://}"
DOMAIN="${DOMAIN%%/*}"

TOKEN_VALUE="${CLOUDFLARE_TUNNEL_TOKEN:-${TUNNEL_TOKEN:-}}"
TUNNEL_ID="${CLOUDFLARE_TUNNEL_ID:-}"

if [ -z "$TUNNEL_ID" ]; then
  if [ -z "$TOKEN_VALUE" ]; then
    echo "CLOUDFLARE_TUNNEL_TOKEN (or TUNNEL_TOKEN) is required to derive the tunnel id." >&2
    exit 1
  fi
  TOKEN_PART=$(printf %s "$TOKEN_VALUE" | cut -d. -f2)
  case $((${#TOKEN_PART} % 4)) in
    2) TOKEN_PART="${TOKEN_PART}==" ;;
    3) TOKEN_PART="${TOKEN_PART}=" ;;
    1) TOKEN_PART="${TOKEN_PART}===" ;;
  esac
  PAYLOAD=$(printf %s "$TOKEN_PART" | tr "-_" "/+" | base64 -d 2>/dev/null || true)
  TUNNEL_ID=$(printf %s "$PAYLOAD" | sed -n 's/.*"tunnel_id":"\([^"]*\)".*/\1/p' | head -n1)
fi

if [ -z "$TUNNEL_ID" ]; then
  echo "Unable to derive tunnel id from token; set CLOUDFLARE_TUNNEL_ID explicitly." >&2
  exit 1
fi

cloudflared tunnel --no-autoupdate route dns --overwrite-dns "$TUNNEL_ID" "$DOMAIN"
exec cloudflared tunnel --no-autoupdate run --token "${TOKEN_VALUE:?CLOUDFLARE_TUNNEL_TOKEN is required}"
