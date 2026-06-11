#!/usr/bin/env bash
# Sweep ultrapowers engine artifacts after a run.
#
# Removes every engine worktree under .claude/worktrees/wf_* (the BRANCHES
# carry the commits — a worktree directory is never the only copy of work),
# then deletes worktree-wf_* branches that are fully merged into HEAD.
# Unmerged branches (failed/blocked tasks) are KEPT for inspection; pass
# --force to delete those too once they have been triaged.
#
# Run from anywhere inside the target repo (including from inside an engine
# worktree), typically at the Step-5 Approve path with the integration branch
# (or post-merge main) checked out, so "merged into HEAD" means what you expect.
#
# Run it only AFTER the run completes — it removes every wf_* worktree,
# including locked ones. Do not sweep while another ultrapowers run is active
# in this repo: in-flight uncommitted worktree state is unrecoverable.
set -euo pipefail

GIT_COMMON="$(git rev-parse --path-format=absolute --git-common-dir)"
ROOT="$(dirname "$GIT_COMMON")"
FORCE="${1:-}"
if [ -n "$FORCE" ] && [ "$FORCE" != "--force" ]; then
  echo "usage: sweep_worktrees.sh [--force]" >&2
  exit 2
fi

removed_worktrees=0
for wt in "$ROOT"/.claude/worktrees/wf_*; do
  [ -e "$wt" ] || continue
  # Removing the worktree the caller is standing in succeeds (every later
  # command uses -C "$ROOT") but leaves their shell in an unlinked directory —
  # say so instead of letting subsequent commands fail confusingly.
  case "$PWD/" in
    "$wt"/*) echo "note: removing your current directory ($wt) — cd \"$ROOT\" afterwards" >&2 ;;
  esac
  # --force --force also removes locked worktrees; a stale directory git no
  # longer recognizes falls through to rm -rf. The sweep never aborts mid-loop.
  # Increment only on a successful removal so the summary is accurate.
  if git -C "$ROOT" worktree remove --force --force "$wt" 2>/dev/null; then
    removed_worktrees=$((removed_worktrees + 1))
  elif rm -rf "$wt" 2>/dev/null; then
    removed_worktrees=$((removed_worktrees + 1))
  else
    echo "warn: could not fully remove $wt — inspect manually" >&2
  fi
done
git -C "$ROOT" worktree prune

deleted=0
kept=0
while IFS= read -r br; do
  [ -n "$br" ] || continue
  if git -C "$ROOT" branch -d "$br" >/dev/null 2>&1; then
    deleted=$((deleted + 1))
  elif [ "$FORCE" = "--force" ] && git -C "$ROOT" branch -D "$br" >/dev/null 2>&1; then
    deleted=$((deleted + 1))
  else
    kept=$((kept + 1))
    if [ "$FORCE" = "--force" ]; then
      echo "kept (cannot delete — likely checked out; resolve manually): $br"
    elif git -C "$ROOT" merge-base --is-ancestor "$br" HEAD 2>/dev/null; then
      echo "kept (merged but undeletable — likely checked out): $br"
    else
      echo "kept (unmerged — failed/blocked work; --force to delete): $br"
    fi
  fi
done < <(git -C "$ROOT" branch --list 'worktree-wf_*' --format='%(refname:short)')

echo "swept: $removed_worktrees worktree(s) removed, $deleted branch(es) deleted, $kept kept"
