#!/usr/bin/env bash
# Lockfile-keyed warm dependency cache + hardlink-clone helper (spec §2.3a).
#
# The engine re-bootstraps every fresh worktree (pip install -e ., bun install,
# …) per worktree, per task, per fix-round — the dominant run cost. This helper
# lets the engine bootstrap a dependency tree ONCE into a warm cache keyed by the
# lockfile's content hash, then hardlink-clone it into each worktree near-
# instantly.
#
# CORRECTNESS NEVER DEPENDS ON THIS CACHE. A `restore` miss exits 3 so the caller
# runs a normal install; a changed lockfile misses by construction.
#
# Usage:
#   warm_cache.sh restore  <lockfile> <target_dir>   # exit 0 = HIT, exit 3 = MISS
#   warm_cache.sh populate <lockfile> <source_dir>   # cache <source_dir>; idempotent
set -euo pipefail

CACHE="${CLAUDE_PLUGIN_DATA:-$HOME/.ultrapowers/cache}/deps"

usage() {
  echo "usage: warm_cache.sh restore  <lockfile> <target_dir>   (exit 0=HIT, 3=MISS)" >&2
  echo "       warm_cache.sh populate <lockfile> <source_dir>   (cache deps; idempotent)" >&2
  exit 2
}

hash_lockfile() {
  local lockfile="$1" line
  if command -v shasum >/dev/null 2>&1; then
    line="$(shasum -a 256 "$lockfile")"
  elif command -v sha256sum >/dev/null 2>&1; then
    line="$(sha256sum "$lockfile")"
  else
    echo "error: neither shasum nor sha256sum is available to hash the lockfile" >&2
    exit 1
  fi
  printf '%s' "${line%% *}"
}

clone_tree() {
  local src="$1" dst="$2"
  mkdir -p "$dst"
  # Try a hardlink-clone (near-instant); fall back to a deep copy when hardlinks
  # are unsupported or cross-device (cache dir on a different filesystem than the
  # worktree). Try-then-fallback instead of a probe: the old probe ran in $TMPDIR
  # — possibly a different fs than the real cache->worktree clone — and, unguarded
  # under `set -e`, a genuine cross-device `cp -al` ABORTED the whole restore. This
  # attempts the real clone and recovers.
  cp -al "$src/." "$dst/" 2>/dev/null || cp -aR "$src/." "$dst/"
}

cmd_restore() {
  [ "$#" -eq 2 ] || usage
  local lockfile="$1" target_dir="$2" hash entry
  [ -f "$lockfile" ] || { echo "error: lockfile not found or not a file: $lockfile" >&2; exit 2; }
  hash="$(hash_lockfile "$lockfile")"
  entry="$CACHE/$hash"
  if [ ! -d "$entry" ]; then
    echo "warm_cache: MISS $hash (no entry) — caller should run a real install" >&2
    exit 3
  fi
  clone_tree "$entry" "$target_dir"
  echo "warm_cache: HIT $hash -> $target_dir"
  exit 0
}

cmd_populate() {
  [ "$#" -eq 2 ] || usage
  local lockfile="$1" source_dir="$2" hash entry tmp
  [ -f "$lockfile" ] || { echo "error: lockfile not found or not a file: $lockfile" >&2; exit 2; }
  [ -d "$source_dir" ] || { echo "error: source_dir not found or not a directory: $source_dir" >&2; exit 2; }
  hash="$(hash_lockfile "$lockfile")"
  entry="$CACHE/$hash"
  mkdir -p "$CACHE"
  if [ -d "$entry" ]; then
    echo "warm_cache: already cached $hash (no-op)"
    exit 0
  fi
  tmp="$(mktemp -d "$CACHE/.tmp.XXXXXX")"
  clone_tree "$source_dir" "$tmp"
  if mv "$tmp" "$entry" 2>/dev/null; then
    echo "warm_cache: cached $hash"
  else
    rm -rf "$tmp"
    echo "warm_cache: already cached $hash (won by a concurrent populate)"
  fi
  exit 0
}

[ "$#" -ge 1 ] || usage
subcommand="$1"; shift
case "$subcommand" in
  restore)  cmd_restore  "$@" ;;
  populate) cmd_populate "$@" ;;
  *)        usage ;;
esac
