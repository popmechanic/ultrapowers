#!/usr/bin/env bash
# fleet/fleet-bootstrap.sh — the golden's only moving part, installed at
# /home/exedev/fleet-bootstrap.sh and started by fleet-run.service.
#
# Immutable on purpose. run-68 died because the boot script re-exec'd itself from
# a checkout that replaced it at its own path while bash kept reading the old
# inode. So no run ever overwrites this file: it reads the assignment once, clones
# the engine the assignment names into its own content-addressed directory, and
# execs THAT checkout's boot script. A boot-script fix ships as an engine sha; the
# golden is rebuilt for tools only.
#
# Writes /home/exedev/engines/ and /home/exedev/fleet-boot.log, nothing else.
# FLEET_HOME relocates both for the exam and is unset in production.
set -euo pipefail
home="${FLEET_HOME:-/home/exedev}"
say() { printf '%s bootstrap: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" | tee -a "$home/fleet-boot.log" >&2; }

# One read, no waiting: the launcher writes the comment before it starts the
# unit, so an empty or malformed one is a launcher bug and the run fails here.
comment="$(curl -fsS https://reflection.int.exe.xyz/comment | sed -n 's/.*"comment"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')" \
  || { say 'reflection /comment unreachable'; exit 1; }
say "comment: ${comment:-<empty>}"
sha="$(printf '%s\n' "$comment" | tr ' ' '\n' | sed -n 's/^engine=\([0-9a-f]\{40\}\)$/\1/p' | head -n 1)"
[ -n "$sha" ] || { say 'no engine=<40 hex> in the comment — nothing to run'; exit 1; }

dst="$home/engines/$sha"
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
say "exec $dst/fleet/sandbox-boot.sh boot"
FLEET_ASSIGNMENT="$comment" exec "$dst/fleet/sandbox-boot.sh" boot
