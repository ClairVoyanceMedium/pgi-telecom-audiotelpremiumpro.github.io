#!/usr/bin/env bash
set -euo pipefail

dump="${1:-}"
if [ -z "$dump" ] || [ ! -s "$dump" ]; then
  echo "Usage: $0 /path/to/backup.dump" >&2
  exit 2
fi

: "${POSTGRES_DB:=pgi_telecom}"
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

started_epoch="$(date +%s)"
file_epoch="$(stat -c %Y "$dump" 2>/dev/null || echo "$started_epoch")"
observed_rpo=$(( started_epoch > file_epoch ? started_epoch - file_epoch : 0 ))
drill_db="pgi_restore_drill_$(date -u +%Y%m%d%H%M%S)"
drill_status="failed"
drill_id=""

recording_table="$("${compose[@]}" exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" postgres   psql -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc   "SELECT (to_regclass('public.disaster_recovery_drills') IS NOT NULL)::text;" 2>/dev/null || true)"
if [ "$recording_table" = "true" ] || [ "$recording_table" = "t" ]; then
  evidence_ref="restore-drill:$(basename "$dump")"
  drill_id="$("${compose[@]}" exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" postgres     psql -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At     -v evidence="$evidence_ref" -c     "INSERT INTO disaster_recovery_drills(drill_type,source_region,target_region,status,evidence_ref) VALUES('restore','eu-primary','eu-primary','running',:'evidence') RETURNING id;" | tail -n1)"
fi

finish() {
  code=$?
  trap - EXIT
  "${compose[@]}" exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" postgres     dropdb -h 127.0.0.1 -U "$POSTGRES_USER" --if-exists "$drill_db" >/dev/null 2>&1 || true
  if [ -n "$drill_id" ]; then
    completed_epoch="$(date +%s)"
    observed_rto=$(( completed_epoch - started_epoch ))
    "${compose[@]}" exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" postgres       psql -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"       -v id="$drill_id" -v status="$drill_status" -v rpo="$observed_rpo" -v rto="$observed_rto"       -c "UPDATE disaster_recovery_drills SET completed_at=now(),status=:'status',observed_rpo_seconds=:'rpo'::int,observed_rto_seconds=:'rto'::int WHERE id=:'id'::bigint;" >/dev/null 2>&1 || true
  fi
  exit "$code"
}
trap finish EXIT

"${compose[@]}" exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" postgres   createdb -h 127.0.0.1 -U "$POSTGRES_USER" "$drill_db"

"${compose[@]}" exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" postgres   pg_restore -h 127.0.0.1 -U "$POSTGRES_USER" -d "$drill_db"   --exit-on-error --no-owner --no-acl < "$dump"

ok="$("${compose[@]}" exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" postgres   psql -h 127.0.0.1 -U "$POSTGRES_USER" -d "$drill_db" -Atc   "SELECT (to_regclass('public.calls') IS NOT NULL AND to_regclass('public.experts') IS NOT NULL AND to_regclass('public.outbox_events') IS NOT NULL)::text;")"

if [ "$ok" != "true" ] && [ "$ok" != "t" ]; then
  echo "Restore drill failed schema validation" >&2
  exit 1
fi

drill_status="passed"
echo "Restore drill passed: $dump"
