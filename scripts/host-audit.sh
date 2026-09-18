#!/usr/bin/env bash
set -euo pipefail

backend_base="${1:-}"
front_base="${2:-}"
env_file="${3:-}"

failures=0
warnings=0

fail(){ echo "FAIL  $*"; failures=$((failures+1)); }
warn(){ echo "WARN  $*"; warnings=$((warnings+1)); }
ok(){ echo "OK    $*"; }

[[ "$backend_base" =~ ^/[A-Za-z0-9._/-]+$ ]] || { echo "Usage: $0 BACKEND_BASE FRONT_BASE ENV_FILE" >&2; exit 2; }
[[ "$front_base" =~ ^/[A-Za-z0-9._/-]+$ ]] || { echo "Usage: $0 BACKEND_BASE FRONT_BASE ENV_FILE" >&2; exit 2; }
[[ "$env_file" =~ ^/[A-Za-z0-9._/-]+$ ]] || { echo "Usage: $0 BACKEND_BASE FRONT_BASE ENV_FILE" >&2; exit 2; }
[ -r "$env_file" ] || { echo "Environment file is not readable: $env_file" >&2; exit 2; }

set -a
# Trusted administrator-owned environment file.
# shellcheck disable=SC1090
source "$env_file"
set +a

: "${PGI_MAX_BACKUP_AGE_HOURS:=30}"
: "${PGI_MIN_FREE_DISK_GB:=5}"
: "${PGI_MAX_CDR_LAG_SECONDS:=900}"
: "${PGI_MAX_OUTBOX_PENDING:=100}"
: "${PGI_REQUIRE_RELEASE_ALIGNMENT:=true}"

for pair in   "PGI_MAX_BACKUP_AGE_HOURS:$PGI_MAX_BACKUP_AGE_HOURS:1:720"   "PGI_MIN_FREE_DISK_GB:$PGI_MIN_FREE_DISK_GB:1:10000"   "PGI_MAX_CDR_LAG_SECONDS:$PGI_MAX_CDR_LAG_SECONDS:30:86400"   "PGI_MAX_OUTBOX_PENDING:$PGI_MAX_OUTBOX_PENDING:0:1000000"
do
  IFS=: read -r name value min max <<< "$pair"
  if [[ ! "$value" =~ ^[0-9]+$ ]] || [ "$value" -lt "$min" ] || [ "$value" -gt "$max" ]; then
    echo "Invalid $name" >&2
    exit 2
  fi
done

for command in curl docker df find stat awk grep sed date readlink; do
  command -v "$command" >/dev/null 2>&1 || { echo "Missing required command: $command" >&2; exit 2; }
done

release_from_link(){
  local base="$1" target
  [ -L "$base/current" ] || return 1
  target="$(readlink "$base/current")"
  [[ "$target" =~ ^releases/([0-9a-f]{40})$ ]] || return 1
  printf '%s\n' "${BASH_REMATCH[1]}"
}

backend_release="$(release_from_link "$backend_base" || true)"
front_release="$(release_from_link "$front_base" || true)"

if [ -z "$backend_release" ]; then fail "backend current release symlink is invalid"; else ok "backend release ${backend_release:0:12}"; fi
if [ -z "$front_release" ]; then fail "front current release symlink is invalid"; else ok "front release ${front_release:0:12}"; fi

if [ "$PGI_REQUIRE_RELEASE_ALIGNMENT" = "true" ] && [ -n "$backend_release" ] && [ -n "$front_release" ]; then
  if [ "$backend_release" = "$front_release" ]; then
    ok "front/backend release alignment"
  else
    fail "front/backend release mismatch: ${front_release:0:12} vs ${backend_release:0:12}"
  fi
fi

health="$(curl --silent --show-error --max-time 5 http://127.0.0.1:8080/api/v1/health 2>/dev/null || true)"
if [ -z "$health" ] || ! printf '%s' "$health" | grep -F '"status":"ok"' >/dev/null; then
  fail "backend /health unavailable"
else
  ok "backend /health"
  if [ -n "$backend_release" ] && ! printf '%s' "$health" | grep -F "\"release\":\"$backend_release\"" >/dev/null; then
    fail "backend health release does not match current symlink"
  fi
fi

if curl --fail --silent --show-error --max-time 5 http://127.0.0.1:8080/api/v1/ready >/dev/null 2>&1; then
  ok "backend /ready"
else
  fail "backend /ready is degraded"
fi

metrics="$(curl --fail --silent --show-error --max-time 5 http://127.0.0.1:8080/metrics 2>/dev/null || true)"
metric(){
  local name="$1"
  printf '%s\n' "$metrics" | awk -v key="$name" '$1==key {print $2; exit}'
}

if [ -z "$metrics" ]; then
  fail "local Prometheus metrics unavailable"
else
  ok "local Prometheus metrics"
  calls_total="$(metric pgi_calls_total)"
  outbox_pending="$(metric pgi_outbox_pending)"
  cdr_lag="$(metric pgi_cdr_lag_seconds)"
  experts_available="$(metric pgi_experts_available)"

  if [[ "$outbox_pending" =~ ^[0-9]+([.][0-9]+)?$ ]]; then
    outbox_int="${outbox_pending%.*}"
    if [ "$outbox_int" -gt "$PGI_MAX_OUTBOX_PENDING" ]; then
      fail "outbox pending=$outbox_int exceeds $PGI_MAX_OUTBOX_PENDING"
    else
      ok "outbox pending=$outbox_int"
    fi
  else
    fail "outbox metric is invalid"
  fi

  if [ "${PGI_REQUIRE_OPERATOR:-false}" = "true" ] && [[ "$calls_total" =~ ^[0-9]+([.][0-9]+)?$ ]] && [ "${calls_total%.*}" -gt 0 ]; then
    if [[ "$cdr_lag" =~ ^[0-9]+([.][0-9]+)?$ ]]; then
      cdr_int="${cdr_lag%.*}"
      if [ "$cdr_int" -gt "$PGI_MAX_CDR_LAG_SECONDS" ]; then
        fail "CDR lag=${cdr_int}s exceeds ${PGI_MAX_CDR_LAG_SECONDS}s"
      else
        ok "CDR lag=${cdr_int}s"
      fi
    else
      fail "CDR lag metric is invalid"
    fi
  fi

  if [ "${PGI_REQUIRE_OPERATOR:-false}" = "true" ] && [[ "$experts_available" =~ ^[0-9]+([.][0-9]+)?$ ]] && [ "${experts_available%.*}" -eq 0 ]; then
    warn "no expert currently available"
  fi
fi

front_config="$front_base/current/assets/config.js"
if [ ! -s "$front_config" ]; then
  fail "front production config is missing"
elif [ -n "$front_release" ]; then
  configured_release="$(grep -oE '"releaseId":[[:space:]]*"[0-9a-f]{40}"' "$front_config" | head -n1 | grep -oE '[0-9a-f]{40}' || true)"
  if [ "$configured_release" = "$front_release" ]; then
    ok "front config release identity"
  else
    fail "front config release does not match current symlink"
  fi
fi

free_kb="$(df -Pk "$backend_base" | awk 'NR==2 {print $4}')"
required_kb=$((PGI_MIN_FREE_DISK_GB*1024*1024))
if [[ "$free_kb" =~ ^[0-9]+$ ]] && [ "$free_kb" -ge "$required_kb" ]; then
  free_gb=$((free_kb/1024/1024))
  ok "disk free=${free_gb}GiB"
else
  fail "free disk below ${PGI_MIN_FREE_DISK_GB}GiB"
fi

backup_dir="$backend_base/backups"
latest_backup="$(find "$backup_dir" -maxdepth 1 -type f -name "${POSTGRES_DB:-pgi_telecom}_*.dump" -printf '%T@ %p\n' 2>/dev/null | sort -nr | head -n1 | cut -d' ' -f2- || true)"
calls_int=0
if [[ "${calls_total:-}" =~ ^[0-9]+([.][0-9]+)?$ ]]; then calls_int="${calls_total%.*}"; fi

if [ -z "$latest_backup" ]; then
  if [ "$calls_int" -gt 0 ]; then
    fail "no PostgreSQL backup found for a database containing calls"
  else
    warn "no PostgreSQL backup yet; database has no calls"
  fi
else
  backup_mtime="$(stat -c %Y "$latest_backup")"
  now_epoch="$(date +%s)"
  backup_age_hours=$(((now_epoch-backup_mtime)/3600))
  if [ "$backup_age_hours" -gt "$PGI_MAX_BACKUP_AGE_HOURS" ]; then
    fail "latest PostgreSQL backup is ${backup_age_hours}h old"
  else
    ok "latest PostgreSQL backup age=${backup_age_hours}h"
  fi
  if [ ! -s "$latest_backup.sha256" ] || ! (cd "$(dirname "$latest_backup")" && sha256sum --check "$(basename "$latest_backup").sha256" >/dev/null 2>&1); then
    fail "latest PostgreSQL backup checksum is missing or invalid"
  else
    ok "latest PostgreSQL backup checksum"
  fi
fi

compose_file="$backend_base/current/infra/docker-compose.production.yml"
if [ -s "$compose_file" ]; then
  compose=(docker compose --env-file "$env_file" -f "$compose_file")
  for service in postgres api; do
    cid="$("${compose[@]}" ps -q "$service" 2>/dev/null || true)"
    if [ -z "$cid" ]; then
      fail "container $service is not running"
      continue
    fi
    state="$(docker inspect -f '{{.State.Status}}' "$cid" 2>/dev/null || true)"
    health_state="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$cid" 2>/dev/null || true)"
    if [ "$state" != "running" ]; then
      fail "container $service state=$state"
    elif [ "$service" = "api" ] && [ "$health_state" != "healthy" ]; then
      fail "container api health=$health_state"
    else
      ok "container $service state=$state health=$health_state"
    fi
  done
else
  fail "backend current compose file is missing"
fi

echo "AUDIT failures=$failures warnings=$warnings"
[ "$failures" -eq 0 ]
