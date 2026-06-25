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
#   snapshot       — record current branch + HEAD sha to CHECKOUT_SNAPSHOT
#   restore        — checkout the branch/sha recorded in CHECKOUT_SNAPSHOT
#
# Advisory: never force-moves a tree.  All operations are idempotent and silent
# on success so the caller can chain them with &&.
set -eu

ROOT="$(git rev-parse --show-toplevel)"
DIR="$ROOT/.claude/ultrapowers"
LOCK="$DIR/RUN_LOCK"
SNAP="$DIR/CHECKOUT_SNAPSHOT"
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

  snapshot)
    branch="$(git -C "$ROOT" branch --show-current)"
    sha="$(git -C "$ROOT" rev-parse HEAD)"
    printf '%s\t%s' "$branch" "$sha" > "$SNAP"
    ;;

  restore)
    if [ ! -f "$SNAP" ]; then
      echo "run_lock.sh restore: no snapshot to restore (run 'snapshot' first)" >&2
      exit 1
    fi
    b="$(cut -f1 "$SNAP")"
    h="$(cut -f2 "$SNAP")"
    if [ -n "$b" ]; then
      git -C "$ROOT" checkout "$b"
    else
      git -C "$ROOT" checkout "$h"
    fi
    ;;

  *)
    echo "usage: run_lock.sh acquire|check|release <id> | snapshot | restore" >&2
    exit 2
    ;;
esac
