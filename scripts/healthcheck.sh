#!/usr/bin/env bash
set -euo pipefail

url="${PGI_API_URL:?PGI_API_URL is required}"
timeout="${PGI_HEALTH_TIMEOUT_SECONDS:-5}"

body="$(curl --fail --silent --show-error --max-time "$timeout" "$url/api/v1/health")"
printf '%s
' "$body"

case "$body" in
  *'"status":"ok"'*|*'"status": "ok"'*) exit 0 ;;
  *) echo "Health payload is not OK" >&2; exit 1 ;;
esac
