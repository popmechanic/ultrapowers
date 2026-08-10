#!/usr/bin/env bash
# Deterministic run-state actor for /ultrapowers concurrency safety.
#
# waves.js has no shell/git/runId, so the orchestrator (SKILL.md) drives this
# at setup/gate time to prevent concurrent runs from corrupting each other's
# checkout ([d3329657e0b6fbec] / [02b3fec6c5122a9c]).
#
# Commands:
#   acquire  <id>  — write RUN_LOCK (the live runId) iff absent or same id;
#                    exit non-zero with a refusal if a DIFFERENT id holds it
#   check    <id>  — exit 0 iff RUN_LOCK holds <id>; non-zero otherwise
#   release  <id>  — remove RUN_LOCK iff it holds <id> (no-op if mismatch)
#
# This script never moves a checkout.  The snapshot/restore family it used to
# carry was retired in #104: since #84 the engine integrates in a dedicated
# worktree and the gate resolves branch refs, so the session checkout is never
# moved and needs no restoring.  The launch-time dirty baseline the gate still
# reads (DIRTY_SNAPSHOT) is written by ultra_run.py's dirty-baseline stage.
#
# Advisory: all operations are idempotent and silent on success so the caller
# can chain them with &&.
set -eu

ROOT="$(git rev-parse --show-toplevel)"
DIR="$ROOT/.claude/ultrapowers"
LOCK="$DIR/RUN_LOCK"
mkdir -p "$DIR"

cmd="${1:-}"
arg="${2:-}"

case "$cmd" in
  acquire)
    if [ -f "$LOCK" ] && [ "$(cat "$LOCK")" != "$arg" ]; then
      echo "RUN_LOCK held by $(cat "$LOCK") — another /ultrapowers run is live in this repo; serialize runs (see CLAUDE.md). Refusing $arg." >&2
      exit 1
    fi
    printf '%s' "$arg" > "$LOCK"
    ;;

  check)
    [ -f "$LOCK" ] && [ "$(cat "$LOCK")" = "$arg" ]
    ;;

  release)
    if [ -f "$LOCK" ] && [ "$(cat "$LOCK")" = "$arg" ]; then
      rm -f "$LOCK"
    fi
    ;;

  *)
    echo "usage: run_lock.sh acquire|check|release <id>" >&2
    exit 2
    ;;
esac
