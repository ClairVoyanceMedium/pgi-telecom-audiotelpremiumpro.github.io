#!/usr/bin/env bash
set -euo pipefail

: "${POSTGRES_DB:=pgi_telecom}"
: "${POSTGRES_USER:=pgi_telecom}"
: "${BACKUP_DIR:=./backups}"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BACKUP_DIR"
umask 077

file="$BACKUP_DIR/${POSTGRES_DB}_${timestamp}.dump"

pg_dump   --format=custom   --no-owner   --no-acl   --dbname="$POSTGRES_DB"   --username="$POSTGRES_USER"   --file="$file"

sha256sum "$file" > "$file.sha256"
echo "Backup created: $file"
