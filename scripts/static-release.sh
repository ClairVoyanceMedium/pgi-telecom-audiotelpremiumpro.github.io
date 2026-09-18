#!/usr/bin/env bash
set -euo pipefail

action="${1:-}"
base="${2:-}"
release="${3:-}"
keep="${4:-5}"

fail(){ echo "FAIL: $*" >&2; exit 1; }

[[ "$base" =~ ^/[A-Za-z0-9._/-]+$ ]] || fail "invalid absolute release base"
[[ "$keep" =~ ^[1-9][0-9]?$ ]] || fail "invalid retention count"

releases="$base/releases"
current="$base/current"
previous="$base/previous"

atomic_link(){
  local target="$1" link="$2" tmp
  tmp="$link.next.$$"
  ln -s "$target" "$tmp"
  mv -Tf "$tmp" "$link"
}

case "$action" in
  promote)
    [[ "$release" =~ ^[0-9a-fA-F]{7,64}$ ]] || fail "invalid release id"
    release_dir="$releases/$release"
    [ -s "$release_dir/index.html" ] || fail "release missing index.html"
    [ -s "$release_dir/assets/app.js" ] || fail "release missing assets/app.js"
    [ -s "$release_dir/assets/config.js" ] || fail "release missing assets/config.js"

    mkdir -p "$releases"
    old=""
    if [ -L "$current" ]; then
      old="$(readlink "$current")"
    fi

    if [ -n "$old" ] && [ "$old" != "releases/$release" ] && [ -d "$base/$old" ]; then
      atomic_link "$old" "$previous"
    fi
    atomic_link "releases/$release" "$current"
    echo "PROMOTED $release"
    ;;

  rollback)
    if [ ! -L "$previous" ]; then
      rm -f -- "$current"
      echo "ROLLED_BACK to no active release (no previous release available)"
      exit 0
    fi
    target="$(readlink "$previous")"
    [ -d "$base/$target" ] || fail "previous release target missing"
    old=""
    if [ -L "$current" ]; then old="$(readlink "$current")"; fi
    atomic_link "$target" "$current"
    if [ -n "$old" ] && [ -d "$base/$old" ]; then
      atomic_link "$old" "$previous"
    fi
    echo "ROLLED_BACK to ${target#releases/}"
    ;;

  verify)
    [ -L "$current" ] || fail "current release symlink missing"
    target="$(readlink "$current")"
    [ -s "$base/$target/index.html" ] || fail "current release invalid"
    [ -s "$base/$target/assets/app.js" ] || fail "current app.js missing"
    [ -s "$base/$target/assets/config.js" ] || fail "current config.js missing"
    printf '%s\n' "${target#releases/}"
    ;;

  prune)
    mkdir -p "$releases"
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
        echo "PRUNED $(basename "$dir")"
      fi
    done < <(find "$releases" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' | sort -nr | cut -d' ' -f2-)
    ;;

  *)
    fail "usage: $0 {promote|rollback|verify|prune} BASE [RELEASE] [KEEP]"
    ;;
esac
