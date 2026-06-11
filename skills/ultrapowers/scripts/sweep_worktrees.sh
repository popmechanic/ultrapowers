#!/usr/bin/env bash
# Sweep ultrapowers engine artifacts after a run.
#
# Removes every engine worktree under .claude/worktrees/wf_* (the BRANCHES
# carry the commits — a worktree directory is never the only copy of work),
# then deletes worktree-wf_* branches that are fully merged into HEAD.
# Unmerged branches (failed/blocked tasks) are KEPT for inspection; pass
# --force to delete those too once they have been triaged.
#
# Run from anywhere inside the target repo, typically at the Step-5 Approve
# path with the integration branch (or post-merge main) checked out, so
# "merged into HEAD" means what you expect.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
FORCE="${1:-}"

removed_worktrees=0
for wt in "$ROOT"/.claude/worktrees/wf_*; do
  [ -e "$wt" ] || continue
  git -C "$ROOT" worktree remove --force "$wt"
  removed_worktrees=$((removed_worktrees + 1))
done
git -C "$ROOT" worktree prune

deleted=0
kept=0
while IFS= read -r br; do
  [ -n "$br" ] || continue
  if git -C "$ROOT" branch -d "$br" >/dev/null 2>&1; then
    deleted=$((deleted + 1))
  elif [ "$FORCE" = "--force" ]; then
    git -C "$ROOT" branch -D "$br" >/dev/null
    deleted=$((deleted + 1))
  else
    kept=$((kept + 1))
    echo "kept (unmerged — failed/blocked work; --force to delete): $br"
  fi
done < <(git -C "$ROOT" branch --list 'worktree-wf_*' --format='%(refname:short)')

echo "swept: $removed_worktrees worktree(s) removed, $deleted branch(es) deleted, $kept kept"
