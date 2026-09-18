#!/usr/bin/env bash
set -euo pipefail

dump="${1:-}"
if [ -z "$dump" ] || [ ! -s "$dump" ]; then
  echo "Usage: $0 /path/to/backup.dump" >&2
  exit 2
fi

: "${POSTGRES_USER:=pgi_telecom}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"
: "${COMPOSE_FILE:=infra/docker-compose.production.yml}"

command -v docker >/dev/null 2>&1 || { echo "Missing required command: docker" >&2; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "Docker Compose plugin unavailable" >&2; exit 1; }

if [ -f "$dump.sha256" ]; then
  sha256sum --check "$dump.sha256"
fi

compose=(docker compose -f "$COMPOSE_FILE")
if [ -n "${PGI_ENV_FILE:-}" ]; then
  compose=(docker compose --env-file "$PGI_ENV_FILE" -f "$COMPOSE_FILE")
fi

drill_db="pgi_restore_drill_$(date -u +%Y%m%d%H%M%S)"

cleanup() {
  "${compose[@]}" exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" postgres \
    dropdb -h 127.0.0.1 -U "$POSTGRES_USER" --if-exists "$drill_db" >/dev/null 2>&1 || true
}
trap cleanup EXIT

"${compose[@]}" exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" postgres \
  createdb -h 127.0.0.1 -U "$POSTGRES_USER" "$drill_db"

"${compose[@]}" exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" postgres \
  pg_restore -h 127.0.0.1 -U "$POSTGRES_USER" -d "$drill_db" \
  --exit-on-error --no-owner --no-acl < "$dump"

ok="$("${compose[@]}" exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" postgres \
  psql -h 127.0.0.1 -U "$POSTGRES_USER" -d "$drill_db" -Atc \
  "SELECT (to_regclass('public.calls') IS NOT NULL AND to_regclass('public.experts') IS NOT NULL AND to_regclass('public.outbox_events') IS NOT NULL)::text;")"

if [ "$ok" != "true" ] && [ "$ok" != "t" ]; then
  echo "Restore drill failed schema validation" >&2
  exit 1
fi

echo "Restore drill passed: $dump"
