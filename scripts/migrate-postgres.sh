#!/bin/sh
set -eu

: "${PGHOST:=postgres}"
: "${PGPORT:=5432}"
: "${PGDATABASE:=pgi_telecom}"
: "${PGUSER:=pgi_telecom}"
: "${MIGRATIONS_DIR:=/migrations}"

if [ -z "${PGPASSWORD:-}" ]; then
  echo "PGPASSWORD is required" >&2
  exit 1
fi

psql -v ON_ERROR_STOP=1 <<'SQL'
CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  checksum char(64) NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);
SQL

found=0
for file in "$MIGRATIONS_DIR"/*.sql; do
  [ -f "$file" ] || continue
  found=1
  version="$(basename "$file" .sql)"
  case "$version" in
    *[!A-Za-z0-9_.-]*|'')
      echo "Invalid migration filename: $file" >&2
      exit 1
      ;;
  esac

  checksum="$(sha256sum "$file" | awk '{print $1}')"
  current="$(psql -At -v ON_ERROR_STOP=1 -c "SELECT checksum FROM schema_migrations WHERE version='$version';")"

  if [ -n "$current" ]; then
    if [ "$current" != "$checksum" ]; then
      echo "Migration checksum mismatch: $version" >&2
      exit 1
    fi
    echo "SKIP $version (already applied)"
    continue
  fi

  echo "APPLY $version"
  {
    cat "$file"
    printf "\nINSERT INTO schema_migrations(version,checksum) VALUES ('%s','%s');\n" "$version" "$checksum"
  } | psql -v ON_ERROR_STOP=1 --single-transaction

  recorded="$(psql -At -v ON_ERROR_STOP=1 -c "SELECT checksum FROM schema_migrations WHERE version='$version';")"
  if [ "$recorded" != "$checksum" ]; then
    echo "Migration verification failed: $version" >&2
    exit 1
  fi
done

if [ "$found" -eq 0 ]; then
  echo "No migration files found in $MIGRATIONS_DIR" >&2
  exit 1
fi

echo "Database migrations: OK"
