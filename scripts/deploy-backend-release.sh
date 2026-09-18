#!/usr/bin/env bash
set -euo pipefail

action="${1:-}"
base="${2:-}"
env_file="${3:-}"
release="${4:-}"
version="${5:-}"
keep="${6:-3}"

fail(){ echo "FAIL: $*" >&2; exit 1; }

[[ "$base" =~ ^/[A-Za-z0-9._/-]+$ ]] || fail "invalid absolute app base"
[[ "$env_file" =~ ^/[A-Za-z0-9._/-]+$ ]] || fail "invalid absolute environment file"
[ -r "$env_file" ] || fail "environment file is not readable"
[[ "$release" =~ ^[0-9a-fA-F]{7,64}$ ]] || fail "invalid release id"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-.][A-Za-z0-9.]+)?$ ]] || fail "invalid semantic version"
[[ "$keep" =~ ^[1-9][0-9]?$ ]] || fail "invalid retention count"

set -a
# Trusted administrator-owned environment file.
# shellcheck disable=SC1090
source "$env_file"
set +a

release_dir="$base/releases/$release"
compose_file="$release_dir/infra/docker-compose.production.yml"
current="$base/current"
previous="$base/previous"
backups="$base/backups"

[ -s "$release_dir/package.json" ] || fail "release missing package.json"
[ -s "$compose_file" ] || fail "release missing production compose"
[ -s "$release_dir/scripts/preflight.sh" ] || fail "release missing preflight"
[ -s "$release_dir/scripts/backup-postgres.sh" ] || fail "release missing backup script"
[ -s "$release_dir/scripts/restore-drill.sh" ] || fail "release missing restore drill"

compose=(docker compose --env-file "$env_file" -f "$compose_file")

atomic_link(){
  local target="$1" link="$2" tmp
  tmp="$link.next.$$"
  ln -s "$target" "$tmp"
  mv -Tf "$tmp" "$link"
}

wait_ready(){
  local expected="$1"
  local attempt health
  for attempt in $(seq 1 45); do
    if curl --fail --silent --show-error --max-time 4 "http://127.0.0.1:8080/api/v1/ready" >/dev/null 2>&1; then
      health="$(curl --fail --silent --show-error --max-time 4 "http://127.0.0.1:8080/api/v1/health" 2>/dev/null || true)"
      if printf '%s' "$health" | grep -F "\"version\":\"$expected\"" >/dev/null; then
        echo "READY version $expected"
        return 0
      fi
    fi
    sleep 2
  done
  return 1
}

running_postgres(){
  local cid
  cid="$("${compose[@]}" ps -q postgres 2>/dev/null || true)"
  [ -n "$cid" ] && [ "$(docker inspect -f '{{.State.Running}}' "$cid" 2>/dev/null || true)" = "true" ]
}

backup_and_drill(){
  mkdir -p "$backups"
  PGI_ENV_FILE="$env_file" COMPOSE_FILE="$compose_file" BACKUP_DIR="$backups" \
    bash "$release_dir/scripts/backup-postgres.sh"
  local latest
  latest="$(find "$backups" -maxdepth 1 -type f -name '*.dump' -printf '%T@ %p\n' | sort -nr | head -n1 | cut -d' ' -f2-)"
  [ -n "$latest" ] || fail "backup file not found after backup"
  PGI_ENV_FILE="$env_file" COMPOSE_FILE="$compose_file" \
    bash "$release_dir/scripts/restore-drill.sh" "$latest"
}

rollback_previous(){
  local old_target old_dir old_version old_compose
  [ -L "$current" ] || return 1
  old_target="$(readlink "$current")"
  old_dir="$base/$old_target"
  [ -s "$old_dir/package.json" ] || return 1
  old_version="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$old_dir/package.json" | head -n1)"
  [ -n "$old_version" ] || return 1
  old_compose="$old_dir/infra/docker-compose.production.yml"
  [ -s "$old_compose" ] || return 1

  echo "ROLLBACK backend to $old_version"
  PGI_VERSION="$old_version" docker compose --env-file "$env_file" -f "$old_compose" \
    up -d --build --remove-orphans

  if ! wait_ready "$old_version"; then
    echo "ROLLBACK FAILED: previous backend did not become ready" >&2
    return 1
  fi
  return 0
}

prune_releases(){
  local current_target previous_target count dir rel
  current_target="$(readlink "$current" 2>/dev/null || true)"
  previous_target="$(readlink "$previous" 2>/dev/null || true)"
  count=0
  while IFS= read -r dir; do
    rel="releases/$(basename "$dir")"
    if [ "$rel" = "$current_target" ] || [ "$rel" = "$previous_target" ]; then
      continue
    fi
    count=$((count+1))
    if [ "$count" -gt "$keep" ]; then
      rm -rf -- "$dir"
      echo "PRUNED backend $(basename "$dir")"
    fi
  done < <(find "$base/releases" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' | sort -nr | cut -d' ' -f2-)
}

case "$action" in
  deploy)
    (cd "$release_dir" && PGI_ENV_FILE="$env_file" bash scripts/preflight.sh)

    if running_postgres; then
      echo "Existing PostgreSQL detected: backup and restore drill required."
      backup_and_drill
    else
      echo "First deployment: no existing PostgreSQL volume is running."
    fi

    old_target="$(readlink "$current" 2>/dev/null || true)"

    echo "DEPLOY backend $version"
    if ! PGI_VERSION="$version" "${compose[@]}" up -d --build --remove-orphans; then
      echo "Deployment command failed." >&2
      rollback_previous || true
      exit 1
    fi

    if ! wait_ready "$version"; then
      echo "New backend failed readiness." >&2
      rollback_previous || true
      exit 1
    fi

    if [ -n "$old_target" ] && [ "$old_target" != "releases/$release" ] && [ -d "$base/$old_target" ]; then
      atomic_link "$old_target" "$previous"
    fi
    atomic_link "releases/$release" "$current"
    prune_releases
    echo "PROMOTED backend $version ($release)"
    ;;

  verify)
    wait_ready "$version"
    ;;

  *)
    fail "usage: $0 deploy|verify BASE ENV_FILE RELEASE VERSION [KEEP]"
    ;;
esac
