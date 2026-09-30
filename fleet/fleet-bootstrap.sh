#!/usr/bin/env bash
# fleet/fleet-bootstrap.sh — the image's only moving part, installed root-owned and
# 0555 at /usr/local/lib/fleet/bootstrap.sh by the first-boot setup script, started
# by fleet-run@<N>.service, which passes the run number as $1 (optional, checked) and, from its ExecStopPost=, `died` as $2.
#
# Immutable on purpose. run-68 died because the boot script re-exec'd itself from
# a checkout that replaced it at its own path while bash kept reading the old
# inode. So no run ever overwrites this file: it reads the assignment once, clones
# the engine it names into a content-addressed directory, and execs THAT checkout's
# boot script. A boot-script fix ships as an engine sha; the image is rebuilt for
# tools only. Writes engines/ and fleet-boot.log under FLEET_HOME (/home/exedev).
set -euo pipefail
home="${FLEET_HOME:-/home/exedev}"
say() { printf '%s bootstrap: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" | tee -a "$home/fleet-boot.log" >&2; }
# $2 is the mode: absent is `boot`; `died` is the unit's ExecStopPost= (#1445),
# where a refusal is logged and exits 0 — a stop-post never fails the stop.
mode="${2:-boot}"
case "$mode" in boot) no=1 ;; died) no=0 ;; *) say "unknown mode $mode — refusing"; exit 1 ;; esac

# One read, no waiting: the launcher writes the comment before it starts the
# unit, so an empty or malformed one is a launcher bug and the run fails here.
comment="$(curl -fsS https://reflection.int.exe.xyz/comment | sed -n 's/.*"comment"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')" \
  || { say 'reflection /comment unreachable'; exit "$no"; }
say "comment: ${comment:-<empty>}${1:+ (unit run=$1)}"
# The unit instance and the comment name the same run, or this is the wrong box.
run="$(printf '%s\n' "$comment" | tr ' ' '\n' | sed -n 's/^run=\([0-9]\{1,\}\)$/\1/p' | head -n 1)"
[ -z "${1:-}" ] || [ "$1" = "$run" ] || { say "unit run=$1 but the comment says run=${run:-<none>} — refusing"; exit "$no"; }
sha="$(printf '%s\n' "$comment" | tr ' ' '\n' | sed -n 's/^engine=\([0-9a-f]\{40\}\)$/\1/p' | head -n 1)"
[ -n "$sha" ] || { say 'no engine=<40 hex> in the comment — nothing to run'; exit "$no"; }

dst="$home/engines/$sha"
# Never clone at stop time: a death with no engine has no boot script to write it.
[ "$mode" = boot ] || [ -d "$dst" ] || { say "died: no engine at $sha — nothing to write"; exit 0; }
if [ -d "$dst" ]; then
  say "engine $sha already present"
else
  # Clone beside the final name and mv last: a clone that dies halfway is never
  # mistaken for an engine, and the next attempt starts by discarding it.
  say "cloning engine at $sha"
  rm -rf "$dst.tmp"; mkdir -p "$home/engines"
  git clone -q https://github.com/popmechanic/ultrapowers.git "$dst.tmp"
  git -C "$dst.tmp" checkout -q "$sha"
  mv "$dst.tmp" "$dst"
fi
# A pre-factory sha carries no factory/boot.sh and is no longer launchable.
boot="$dst/factory/boot.sh"
[ -f "$boot" ] || { say "engine $sha carries no factory/boot.sh"; exit "$no"; }
say "exec $boot $mode"
FLEET_ASSIGNMENT="$comment" exec "$boot" "$mode"
