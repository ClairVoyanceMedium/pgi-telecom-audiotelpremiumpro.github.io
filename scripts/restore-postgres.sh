#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 <backup.dump>" >&2
  exit 64
fi

: "${POSTGRES_DB:=pgi_telecom}"
: "${POSTGRES_USER:=pgi_telecom}"

file="$1"
test -f "$file"
test -f "$file.sha256"
sha256sum -c "$file.sha256"

pg_restore   --clean   --if-exists   --no-owner   --no-acl   --dbname="$POSTGRES_DB"   --username="$POSTGRES_USER"   "$file"

echo "Restore completed from: $file"
