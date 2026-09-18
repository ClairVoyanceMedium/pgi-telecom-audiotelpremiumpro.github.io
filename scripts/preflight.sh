#!/usr/bin/env bash
set -euo pipefail

fail=0

need_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "FAIL missing command: $1"
    fail=1
  else
    echo "OK   command: $1"
  fi
}

need_env() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    echo "FAIL missing environment variable: $name"
    fail=1
  else
    echo "OK   environment: $name"
  fi
}

need_command docker
need_command curl
need_command openssl

need_env PGI_ENV
need_env PGI_API_URL
need_env POSTGRES_DB
need_env POSTGRES_USER
need_env POSTGRES_PASSWORD

if [ "${PGI_ENV:-}" = "production" ]; then
  need_env SVA_NUMBER
  need_env SVA_TARIFF_CODE
  need_env SVA_HOST_CARRIER
  need_env SIP_PRIMARY_HOST
  need_env SIP_TRANSPORT
  need_env SIP_PORT
fi

if command -v df >/dev/null 2>&1; then
  free_kb="$(df -Pk . | awk 'NR==2 {print $4}')"
  if [ "${free_kb:-0}" -lt 5242880 ]; then
    echo "WARN less than 5 GB free disk space"
  else
    echo "OK   disk space"
  fi
fi

if [ "$fail" -ne 0 ]; then
  echo "Preflight failed."
  exit 1
fi

echo "Preflight passed."
