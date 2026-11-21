#!/usr/bin/env bash
set -euo pipefail
home="${FLEET_HOME:-/home/exedev}"
say() { printf '%s bootstrap: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" | tee -a "$home/fleet-boot.log" >&2; }
mode="${2:-boot}"
case "$mode" in boot) no=1 ;; died) no=0 ;; *) say "unknown mode $mode — refusing"; exit 1 ;; esac

comment="$(curl -fsS https://reflection.int.exe.xyz/comment | sed -n 's/.*"comment"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')" \
  || { say 'reflection /comment unreachable'; exit "$no"; }
say "comment: ${comment:-<empty>}${1:+ (unit run=$1)}"
run="$(printf '%s\n' "$comment" | tr ' ' '\n' | sed -n 's/^run=\([0-9]\{1,\}\)$/\1/p' | head -n 1)"
[ -z "${1:-}" ] || [ "$1" = "$run" ] || { say "unit run=$1 but the comment says run=${run:-<none>} — refusing"; exit "$no"; }
sha="$(printf '%s\n' "$comment" | tr ' ' '\n' | sed -n 's/^engine=\([0-9a-f]\{40\}\)$/\1/p' | head -n 1)"
[ -n "$sha" ] || { say 'no engine=<40 hex> in the comment — nothing to run'; exit "$no"; }

dst="$home/engines/$sha"
[ "$mode" = boot ] || [ -d "$dst" ] || { say "died: no engine at $sha — nothing to write"; exit 0; }
if [ -d "$dst" ]; then
  say "engine $sha already present"
else
  say "cloning engine at $sha"
  rm -rf "$dst.tmp"; mkdir -p "$home/engines"
  git clone -q https://github.com/popmechanic/ultrapowers.git "$dst.tmp"
  git -C "$dst.tmp" checkout -q "$sha"
  mv "$dst.tmp" "$dst"
fi
boot="$dst/factory/boot.sh"
[ -f "$boot" ] || { say "engine $sha carries no factory/boot.sh"; exit "$no"; }
say "exec $boot $mode"
FLEET_ASSIGNMENT="$comment" exec "$boot" "$mode"
