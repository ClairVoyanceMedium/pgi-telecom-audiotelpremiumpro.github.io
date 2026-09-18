#!/usr/bin/env bash
set -euo pipefail

: "${POSTGRES_DB:=pgi_telecom}"
: "${POSTGRES_USER:=pgi_telecom}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"
: "${BACKUP_DIR:=./backups}"
: "${COMPOSE_FILE:=infra/docker-compose.production.yml}"

command -v docker >/dev/null 2>&1 || { echo "Missing required command: docker" >&2; exit 1; }
command -v sha256sum >/dev/null 2>&1 || { echo "Missing required command: sha256sum" >&2; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "Docker Compose plugin unavailable" >&2; exit 1; }

compose=(docker compose -f "$COMPOSE_FILE")
if [ -n "${PGI_ENV_FILE:-}" ]; then
  compose=(docker compose --env-file "$PGI_ENV_FILE" -f "$COMPOSE_FILE")
fi

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BACKUP_DIR"
umask 077

file="$BACKUP_DIR/${POSTGRES_DB}_${timestamp}.dump"
partial="$file.partial"

cleanup() {
  rm -f "$partial"
}
trap cleanup EXIT

"${compose[@]}" exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" postgres \
  pg_dump -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  --format=custom --no-owner --no-acl > "$partial"

if [ ! -s "$partial" ]; then
  echo "Backup is empty" >&2
  exit 1
fi

"${compose[@]}" exec -T postgres pg_restore --list < "$partial" >/dev/null

mv "$partial" "$file"
sha256sum "$file" > "$file.sha256"
sha256sum --check "$file.sha256" >/dev/null

trap - EXIT
echo "Backup verified: $file"
