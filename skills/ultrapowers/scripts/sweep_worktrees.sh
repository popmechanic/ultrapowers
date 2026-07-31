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
#
# Pass --all for an explicit repo-wide sweep that ignores the RUNID/RUN_LOCK
# fallback entirely (mutually exclusive with --run).
#
# Every invocation ends with a leftover accounting: one `left behind: ...`
# line per remaining .claude/worktrees/wf_* entry this sweep did not remove,
# plus a summary total — silent only when nothing remains.
#
# Pass --audit [--age-hours N] for a report-only janitor pass: it removes and
# deletes nothing (always exits 0), and flags every engine worktree/branch
# that does not belong to the RUN_LOCK'd live run and is older than N hours
# (default 24). Mutually exclusive with --run/--all/--force.
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
ALL_SCOPE=""
AUDIT=""
AGE_HOURS="24"

while [ $# -gt 0 ]; do
  case "$1" in
    --force) FORCE="--force" ;;
    --all) ALL_SCOPE="yes" ;;
    --run)
      shift
      RUN_SCOPE="${1:?--run requires a runId argument}"
      ;;
    --audit) AUDIT="yes" ;;
    --age-hours)
      shift
      AGE_HOURS="${1:?--age-hours requires a number}"
      ;;
    *)
      echo "usage: sweep_worktrees.sh [--run <runId> | --all] [--force] | --audit [--age-hours <N>]" >&2
      exit 2
      ;;
  esac
  shift
done
if [ -n "$ALL_SCOPE" ] && [ -n "$RUN_SCOPE" ]; then
  echo "sweep_worktrees.sh: --all and --run are mutually exclusive" >&2
  exit 2
fi
if [ -n "$AUDIT" ] && { [ -n "$FORCE" ] || [ -n "$ALL_SCOPE" ] || [ -n "$RUN_SCOPE" ]; }; then
  echo "sweep_worktrees.sh: --audit is report-only and takes no sweep flags" >&2
  exit 2
fi

# Compute the set of locked worktree paths ONCE (a single porcelain pass) instead
# of re-running `git worktree list` for every worktree — the old per-worktree call
# was O(N^2) in worktree count, worst exactly when a wide run left the most.
LOCKED_PATHS="$(git -C "$ROOT" worktree list --porcelain | awk '
  $1 == "worktree" { cur = substr($0, 10) }
  $1 == "locked"   { print cur }')"
is_locked() {
  # Membership test against the precomputed newline-delimited set — no git call.
  printf '%s\n' "$LOCKED_PATHS" | grep -Fxq -- "$1"
}

human_kb() {
  awk -v kb="$1" 'BEGIN {
    if (kb >= 1048576)   printf "%.1fG", kb / 1048576
    else if (kb >= 1024) printf "%.0fM", kb / 1024
    else                 printf "%dK", kb }'
}
# BSD stat wants `-f %m`, GNU coreutils wants `-c %Y`, and each REJECTS the
# other's flag — but not symmetrically: GNU's -f is --file-system and takes NO
# format argument, so `stat -f %m DIR` parses as two FILE operands, prints a
# multi-line filesystem block for DIR on STDOUT, and still exits 1. Streaming
# the attempts straight into a `||` chain therefore CONCATENATES that block
# with the fallback's epoch on Linux, and the arithmetic below dies on it under
# `set -euo pipefail` (`File: unbound variable`) — a sweep that is green on
# macOS and red in CI. Capture each attempt so a failed one's stdout is
# discarded, and accept only a plain epoch; this function always prints a number.
mtime_of() {
  local m=""
  m="$(stat -f %m "$1" 2>/dev/null)" || m=""
  case "$m" in ''|*[!0-9]*) m="$(stat -c %Y "$1" 2>/dev/null)" || m="" ;; esac
  case "$m" in ''|*[!0-9]*) m="$(date +%s)" ;; esac
  printf '%s' "$m"
}

# ── audit mode (report-only janitor) ───────────────────────────────────────
# "Kept for inspection" degrades to kept-forever unless something re-surfaces
# it (Findings 2+3, vibes.diy 2026-07-31). Flags engine worktrees and
# worktree-wf_* branches that belong to no live (RUN_LOCK'd) run and are older
# than --age-hours (default 24 — freshly-kept triage evidence is not nagged).
# Removes nothing, deletes nothing, always exits 0. Placed BEFORE the
# RUNID/RUN_LOCK fallback below so audit never consumes/narrows via that
# fallback — it reads RUN_LOCK itself, only to compute the live-run exemption.
if [ -n "$AUDIT" ]; then
  live=""
  if [ -f "$ROOT/.claude/ultrapowers/RUN_LOCK" ]; then
    live="$(cat "$ROOT/.claude/ultrapowers/RUN_LOCK")"
    live="${live#wf_}"
  fi
  now="$(date +%s)"
  cutoff=$((AGE_HOURS * 3600))
  orphans=0
  orphan_kb=0
  stale=0
  for wt in "$ROOT"/.claude/worktrees/wf_*; do
    [ -e "$wt" ] || continue
    name="$(basename "$wt")"
    if [ -n "$live" ]; then
      case "$name" in "wf_${live}-"*) continue ;; esac
    fi
    age=$(( now - $(mtime_of "$wt") ))
    [ "$age" -lt "$cutoff" ] && continue
    orphans=$((orphans + 1))
    kb="$(du -sk "$wt" 2>/dev/null | cut -f1 || true)"
    case "$kb" in ''|*[!0-9]*) kb=0 ;; esac
    orphan_kb=$((orphan_kb + kb))
    lock=""
    if is_locked "$wt"; then lock=", locked"; fi
    echo "orphan worktree: $wt ($(human_kb "$kb"), $((age / 86400))d old${lock})"
  done
  while IFS= read -r br; do
    [ -n "$br" ] || continue
    if [ -n "$live" ]; then
      case "$br" in "worktree-wf_${live}-"*) continue ;; esac
    fi
    ct="$(git -C "$ROOT" log -1 --format=%ct "$br" 2>/dev/null)" || ct=""
    case "$ct" in ''|*[!0-9]*) ct="$now" ;; esac
    age=$(( now - ct ))
    [ "$age" -lt "$cutoff" ] && continue
    stale=$((stale + 1))
    if git -C "$ROOT" merge-base --is-ancestor "$br" HEAD 2>/dev/null; then
      state="merged"
    else
      state="unmerged — failed/blocked work kept for inspection"
    fi
    echo "stale branch: $br ($state, last commit $((age / 86400))d ago)"
  done < <(git -C "$ROOT" branch --list "worktree-wf_*" --format='%(refname:short)')
  if [ "$orphans" -eq 0 ] && [ "$stale" -eq 0 ]; then
    echo "audit: clean (no orphan worktrees or stale branches older than ${AGE_HOURS}h${live:+; live run ${live} exempt})"
  else
    echo "audit: $orphans orphan worktree(s) ($(human_kb "$orphan_kb")), $stale stale branch(es) older than ${AGE_HOURS}h${live:+; live run ${live} exempt} — triage, then remove with sweep_worktrees.sh --all [--force]"
  fi
  exit 0
fi

# Fall back to RUNID env or RUN_LOCK file when neither --run nor --all given.
# The RUN_LOCK fallback is the stale-lock scoping trap (vibes.diy 2026-07-31):
# a leftover lock silently narrows an intended repo-wide sweep to one run —
# so inheriting it is announced, and --all bypasses the fallback entirely.
if [ -z "$ALL_SCOPE" ]; then
  if [ -z "$RUN_SCOPE" ] && [ -n "${RUNID:-}" ]; then
    RUN_SCOPE="$RUNID"
  fi
  if [ -z "$RUN_SCOPE" ] && [ -f "$ROOT/.claude/ultrapowers/RUN_LOCK" ]; then
    RUN_SCOPE="$(cat "$ROOT/.claude/ultrapowers/RUN_LOCK")"
    echo "note: scope inherited from RUN_LOCK (${RUN_SCOPE}) — a stale lock silently narrows the sweep; pass --all for a repo-wide sweep"
  fi
fi
# --run / RUNID / RUN_LOCK may carry the wf_-prefixed transcript stem (wf_<id>)
# or the bare <id>. The globs below prepend wf_ themselves, so strip a leading
# wf_ to avoid a double-prefix glob (wf_wf_<id>-*) that matches nothing and
# silently sweeps zero (confirmed 2026-06-25 — a wf_-prefixed --run no-op'd a run).
RUN_SCOPE="${RUN_SCOPE#wf_}"

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

# ── leftover accounting ────────────────────────────────────────────────────
# A scoped sweep says nothing about non-matching wf_* dirs — that silence is
# how ~23 GB sat invisible for a month (vibes.diy 2026-07-31). Account for
# every engine worktree this invocation did NOT remove, loudly, with size and
# age; silent only when the directory is genuinely clean. (human_kb/mtime_of
# are defined earlier, alongside is_locked, so the audit block above can share
# them too.)
now="$(date +%s)"
left_n=0
left_kb=0
for wt in "$ROOT"/.claude/worktrees/wf_*; do
  [ -e "$wt" ] || continue
  left_n=$((left_n + 1))
  # `du` exits nonzero on an unreadable subtree — and on a still-live locked
  # worktree whose files move under it — which `pipefail` would turn into a
  # mid-report abort. Reporting leftovers is stdout, never a failure: swallow
  # the status INSIDE the substitution (keeping any partial total du printed)
  # and accept only a plain number.
  kb="$(du -sk "$wt" 2>/dev/null | cut -f1 || true)"
  case "$kb" in ''|*[!0-9]*) kb=0 ;; esac
  left_kb=$((left_kb + kb))
  days=$(( (now - $(mtime_of "$wt")) / 86400 ))
  lock=""
  if is_locked "$wt"; then lock=", locked — possibly live"; fi
  echo "left behind: $wt ($(human_kb "$kb"), ${days}d old${lock})"
done
if [ "$left_n" -gt 0 ]; then
  echo "left behind: $left_n worktree(s), $(human_kb "$left_kb") total — outside this sweep's scope (repo-wide sweep: --all)"
fi
