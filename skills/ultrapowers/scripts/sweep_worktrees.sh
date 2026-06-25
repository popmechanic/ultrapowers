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
# Locked worktrees (possibly a live run's state) are kept by default and
# reported; pass --force to remove them too (and force-delete unmerged branches,
# as before).
#
# Pass --run <runId> to scope removal to a single run's worktrees and branches
# (.claude/worktrees/wf_<runId>-* and worktree-wf_<runId>-*).  When --run is
# not given, RUNID env var is consulted, then the RUN_LOCK file; if none is
# set, the existing repo-wide wf_* behavior is preserved unchanged.
set -euo pipefail

# The MAIN worktree is the first entry of `git worktree list --porcelain`.
# dirname(--git-common-dir) breaks when the git dir sits outside the repo
# (--separate-git-dir) or under a superproject's .git (submodules) — the
# latter would aim branch -d at the WRONG repository.
ROOT="$(git worktree list --porcelain | head -1 | sed 's/^worktree //')"
# If --separate-git-dir was used, worktree list reports the git-dir, not the
# working tree. Fall back to --show-toplevel in that case.
if [ ! -e "$ROOT/.claude" ]; then
  ROOT="$(git rev-parse --show-toplevel)"
fi

FORCE=""
RUN_SCOPE=""

while [ $# -gt 0 ]; do
  case "$1" in
    --force) FORCE="--force" ;;
    --run)
      shift
      RUN_SCOPE="${1:?--run requires a runId argument}"
      ;;
    *)
      echo "usage: sweep_worktrees.sh [--run <runId>] [--force]" >&2
      exit 2
      ;;
  esac
  shift
done

# Fall back to RUNID env or RUN_LOCK file when --run not given
if [ -z "$RUN_SCOPE" ] && [ -n "${RUNID:-}" ]; then
  RUN_SCOPE="$RUNID"
fi
if [ -z "$RUN_SCOPE" ] && [ -f "$ROOT/.claude/ultrapowers/RUN_LOCK" ]; then
  RUN_SCOPE="$(cat "$ROOT/.claude/ultrapowers/RUN_LOCK")"
fi
# --run / RUNID / RUN_LOCK may carry the wf_-prefixed transcript stem (wf_<id>)
# or the bare <id>. The globs below prepend wf_ themselves, so strip a leading
# wf_ to avoid a double-prefix glob (wf_wf_<id>-*) that matches nothing and
# silently sweeps zero (confirmed 2026-06-25 — a wf_-prefixed --run no-op'd a run).
RUN_SCOPE="${RUN_SCOPE#wf_}"

is_locked() {
  git -C "$ROOT" worktree list --porcelain | awk -v wt="$1" '
    $1 == "worktree" { cur = substr($0, 10) }
    $1 == "locked" && cur == wt { found = 1 }
    END { exit !found }'
}

removed_worktrees=0
kept_worktrees=0
# Build glob suffix: scoped = "<runId>-*"; unscoped = "*" (repo-wide, back-compat)
if [ -n "$RUN_SCOPE" ]; then
  WT_SUFFIX="${RUN_SCOPE}-*"
  BR_PATTERN="worktree-wf_${RUN_SCOPE}-*"
else
  WT_SUFFIX="*"
  BR_PATTERN="worktree-wf_*"
fi
for wt in "$ROOT"/.claude/worktrees/wf_${WT_SUFFIX}; do
  [ -e "$wt" ] || continue
  # A lock marks possibly-live state (a concurrent run, an untriaged redirect):
  # keep it unless the caller explicitly forces. The branch survives too —
  # `branch -d` fails while its worktree exists.
  if [ "$FORCE" != "--force" ] && is_locked "$wt"; then
    kept_worktrees=$((kept_worktrees + 1))
    echo "kept (locked — possibly a live run; --force to remove): $wt"
    continue
  fi
  # Removing the worktree the caller is standing in succeeds (every later
  # command uses -C "$ROOT") but leaves their shell in an unlinked directory —
  # say so instead of letting subsequent commands fail confusingly.
  case "$(pwd -P)/" in
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
done < <(git -C "$ROOT" branch --list "$BR_PATTERN" --format='%(refname:short)')

echo "swept: $removed_worktrees worktree(s) removed, $deleted branch(es) deleted, $kept kept, $kept_worktrees locked worktree(s) kept"
