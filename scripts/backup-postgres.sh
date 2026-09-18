#!/usr/bin/env bash
set -euo pipefail

: "${POSTGRES_DB:=pgi_telecom}"
: "${POSTGRES_USER:=pgi_telecom}"
: "${BACKUP_DIR:=./backups}"

for command in pg_dump pg_restore sha256sum; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Missing required command: $command" >&2
    exit 1
  fi
done

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BACKUP_DIR"
umask 077

file="$BACKUP_DIR/${POSTGRES_DB}_${timestamp}.dump"
partial="$file.partial"

cleanup() {
  rm -f "$partial"
}
trap cleanup EXIT

pg_dump \
  --format=custom \
  --no-owner \
  --no-acl \
  --dbname="$POSTGRES_DB" \
  --username="$POSTGRES_USER" \
  --file="$partial"

if [ ! -s "$partial" ]; then
  echo "Backup is empty" >&2
  exit 1
fi

# Vérifie que le catalogue du dump est réellement lisible par pg_restore.
pg_restore --list "$partial" >/dev/null

mv "$partial" "$file"
sha256sum "$file" > "$file.sha256"
sha256sum --check "$file.sha256" >/dev/null

trap - EXIT
echo "Backup verified: $file"
