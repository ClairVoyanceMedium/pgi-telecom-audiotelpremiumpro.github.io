#!/bin/sh
set -eu

release="${PGI_RELEASE_ID:-${VERCEL_GIT_COMMIT_SHA:-}}"
printf '%s' "$release" | grep -Eq '^[0-9a-f]{40}$' || {
  echo "PGI_RELEASE_ID or VERCEL_GIT_COMMIT_SHA must be a 40-character Git SHA" >&2
  exit 1
}

export PGI_RELEASE_ID="$release"
export PGI_RUNTIME_MODE=production
export PGI_API_BASE_URL=/api/v1
export PGI_BACKEND_MODE=production
export PGI_AUTH_MODE=session
export PGI_PROCESS_ROLE=api
export PGI_BACKEND_HOST=0.0.0.0
export PGI_BACKEND_PORT="${PGI_BACKEND_PORT:-${PORT:-8080}}"
export PGI_STATIC_DIR="${PGI_STATIC_DIR:-/app/dist}"
export PGI_DATABASE_URL="${PGI_DATABASE_URL:-${DATABASE_URL:-}}"
export PGI_DATABASE_SSL="${PGI_DATABASE_SSL:-require}"

test -n "$PGI_DATABASE_URL" || {
  echo "PGI_DATABASE_URL or DATABASE_URL is required" >&2
  exit 1
}

# One-off guarded production maintenance for migration 060 only.
# Remove immediately after production reports schema_ready=true.
node backend/apply-withdrawal-060.mjs

node scripts/build-static.mjs
exec node backend/server.mjs
