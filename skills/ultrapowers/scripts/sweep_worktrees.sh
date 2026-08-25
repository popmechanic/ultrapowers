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
# Before removing a worktree the sweep TERM/KILLs processes still running out
# of it, and afterwards reaps orphaned processes whose command line references
# an engine worktree path that no longer exists (dev servers the engine's
# mid-run wave-merge sweep left behind). Kept worktrees' processes are never
# touched. See "process reaping" below.
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
# (default 24). Mutually exclusive with --run/--all/--force; --age-hours is
# meaningless without --audit and is rejected (exit 2) rather than ignored.
# The live-run exemption is only as precise as RUN_LOCK: the lock holds the
# ultra_run STAMP, while a live run's TASK worktrees are named
# wf_<workflowRunId>-<n>, which no stamp glob matches. So while a lock is held
# the audit calls its findings CANDIDATES and never advises a repo-wide sweep.
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
AGE_GIVEN=""

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
      AGE_GIVEN="yes"
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
# --age-hours only means anything to the report-only pass. Silently ignoring it
# on a sweep let an operator believe they had scoped a DESTRUCTIVE run by age.
if [ -n "$AGE_GIVEN" ] && [ -z "$AUDIT" ]; then
  echo "sweep_worktrees.sh: --age-hours applies only to --audit (report-only)" >&2
  exit 2
fi
# Validate the threshold HERE, before any state is touched. Left unvalidated it
# reached `cutoff=$((AGE_HOURS * 3600))` INSIDE the audit block, where bash
# raises an arithmetic syntax error that aborts the `if` body BEFORE its
# `exit 0` — control then fell through into the destructive sweep below, so
# `--audit --age-hours 24.5` removed worktrees, deleted branches, and still
# exited 0 (reproduced on bash 3.2.57). A report-only flag must never sweep.
case "$AGE_HOURS" in
  ''|*[!0-9]*|???????*)
    echo "sweep_worktrees.sh: --age-hours requires a non-negative integer of at most 6 digits" >&2
    exit 2
    ;;
esac
# Digits-only is still not safe to hand to `$(( ))`: bash reads a LEADING-ZERO
# integer as OCTAL. `--age-hours 09` (invalid octal) therefore raised the same
# `value too great for base` abort the check above was added to prevent, and
# fell through into the destructive sweep exactly as 24.5 did — verified on
# bash 3.2.57: the audited worktree was REMOVED and its branch DELETED, exit 0.
# Octal-valid values failed silently instead: `010` audited an EIGHT-hour
# threshold while the summary said "older than 010h". Hours are decimal, so
# normalize once here and every later use — the arithmetic below and the
# threshold echoed in the summary lines — agrees on one value.
AGE_HOURS=$((10#$AGE_HOURS))

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

# ── process reaping ────────────────────────────────────────────────────────
# Removing a worktree directory does not stop processes still running out of
# it: dev servers spawned by task test suites (wrangler/miniflare workerd and
# kin) reparent to PID 1 when their task's agent exits and pin the deleted
# files and RAM for days (Julian 2026-08-14: 221 orphaned workerd processes
# across 3 runs, several GB held via deleted-but-open files). Recurred, so the
# sweep reaps: TERM, a short grace, then KILL.
#
# Matching is by COMMAND LINE (`ps -A -ww -o pid=,command=`, `-ww` = unlimited
# width — procps truncates at 80 columns off a tty and would hide the path;
# identical on macOS and Linux): it catches executables and script args under the worktree
# path, including processes whose directory is ALREADY deleted, since the dead
# path survives in the command string. It cannot see a process whose cwd alone
# is inside the worktree (the command shows no path); lsof could, but is far
# too slow to run per sweep. The needle rides in the awk ENVIRONMENT, not its
# argv, so the scan's own transient processes never match themselves.

# The sweep may legally run from INSIDE a worktree being removed — the copy of
# this script in that worktree has the worktree path on its own command line.
# Exclude this process and its whole ancestor chain so the sweep never reaps
# itself or the harness shell that launched it.
self_and_ancestors() {
  local pid=$$ out="" i=0
  while [ -n "$pid" ] && [ "$pid" -gt 1 ] 2>/dev/null && [ "$i" -lt 20 ]; do
    out="$out $pid"
    i=$((i + 1))
    pid="$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d '[:space:]')" || break
  done
  printf '%s ' "$out"
}
SELF_TREE="$(self_and_ancestors)"

# PIDs whose command line contains $1 at a path boundary (next char is /,
# space, or end — so sweeping wf_1 can never match a live wf_12).
pids_matching() {
  ps -A -ww -o pid=,command= | NEEDLE="$1" awk '
    {
      needle = ENVIRON["NEEDLE"]
      i = index($0, needle)
      if (i == 0) next
      c = substr($0, i + length(needle), 1)
      if (c != "" && c != "/" && c != " ") next
      print $1
    }'
}

# Emit "pid<TAB>worktree-path" for every process referencing an engine
# worktree path under this repo (the wf_ dir name contains no / or space,
# so it ends at the first of either).
scan_engine_procs() {
  ps -A -ww -o pid=,command= | NEEDLE="$ROOT/.claude/worktrees/" awk '
    {
      needle = ENVIRON["NEEDLE"]
      i = index($0, needle)
      if (i == 0) next
      rest = substr($0, i + length(needle))
      if (substr(rest, 1, 3) != "wf_") next
      split(rest, parts, /[\/ ]/)
      print $1 "\t" needle parts[1]
    }'
}

# ── validate-knobs probe worktrees ─────────────────────────────────────────
# `ultra_run.py --validate-knobs` cuts a detached probe at
# .claude/ultrapowers/wt-knob-<pid> and removes it in a `finally` — which a
# SIGKILL mid-suite skips, and the wf_* globs above never see the leftover
# (#251). The pid in the name is the liveness test: a live pid is a probe in
# progress, a dead one is a full checkout nobody will ever remove.
probe_alive() {
  local pid="${1##*wt-knob-}"
  case "$pid" in ''|*[!0-9]*) return 1 ;; esac
  kill -0 "$pid" 2>/dev/null
}

# TERM the given pids, poll up to ~5s for them to exit, KILL survivors.
# Reaping never fails the sweep — a pid may vanish between scan and signal.
kill_with_grace() {
  [ $# -gt 0 ] || return 0
  kill -TERM "$@" 2>/dev/null || true
  local i pid alive=""
  for i in 1 2 3 4 5 6 7 8 9 10; do
    alive=""
    for pid in "$@"; do
      if kill -0 "$pid" 2>/dev/null; then alive="$alive $pid"; fi
    done
    [ -z "$alive" ] && return 0
    sleep 0.5
  done
  # alive is a space-separated pid list
  # shellcheck disable=SC2086
  kill -KILL $alive 2>/dev/null || true
}

# Reap every process still running out of worktree path $1 (called only for
# worktrees this sweep is actually about to remove — kept/locked ones are
# possibly-live state and their processes are left alone).
reap_under() {
  local wt="$1" pid pids="" n
  for pid in $(pids_matching "$wt"); do
    case "$SELF_TREE" in *" $pid "*) continue ;; esac
    pids="$pids $pid"
  done
  [ -n "$pids" ] || return 0
  # shellcheck disable=SC2086
  n="$(echo $pids | wc -w | tr -d ' ')"
  echo "reaped: $n process(es) still running out of $wt"
  # shellcheck disable=SC2086
  kill_with_grace $pids
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
    if is_locked "$wt"; then lock=", locked — possibly live; verify before removing"; fi
    echo "orphan worktree: $wt ($(human_kb "$kb"), $((age / 86400))d old${lock})"
  done
  for wt in "$ROOT"/.claude/ultrapowers/wt-knob-*; do
    [ -e "$wt" ] || continue
    probe_alive "$wt" && continue
    orphans=$((orphans + 1))
    kb="$(du -sk "$wt" 2>/dev/null | cut -f1 || true)"
    case "$kb" in ''|*[!0-9]*) kb=0 ;; esac
    orphan_kb=$((orphan_kb + kb))
    echo "orphan probe worktree: $wt ($(human_kb "$kb"), validate-knobs pid ${wt##*wt-knob-} is gone)"
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
  # Report-only: a process referencing a DELETED engine worktree path is a
  # leak by definition (its files are gone; no live run can be using it).
  # The audit names it; only a sweep reaps it.
  while IFS=$(printf '\t') read -r pid wtpath; do
    [ -n "$pid" ] || continue
    case "$SELF_TREE" in *" $pid "*) continue ;; esac
    [ -e "$wtpath" ] && continue
    echo "orphan process: pid $pid still running out of deleted $wtpath — a sweep will reap it"
  done < <(scan_engine_procs)
  if [ "$orphans" -eq 0 ] && [ "$stale" -eq 0 ]; then
    echo "audit: clean (no orphan worktrees or stale branches older than ${AGE_HOURS}h${live:+; live run ${live} exempt})"
  elif [ -n "$live" ]; then
    # RUN_LOCK holds the ultra_run STAMP; a live run's TASK worktrees are named
    # wf_<workflowRunId>-<n>, so only wf_<stamp>-integration can match the
    # exemption glob and the rest of the live run looks exactly like an orphan.
    # No pre-gate artifact links stamp to workflowRunId, so precise exemption is
    # impossible — make the ADVICE safe instead: never name the repo-wide sweep
    # that would corrupt the run these candidates may belong to.
    echo "audit: $orphans orphan-candidate worktree(s) ($(human_kb "$orphan_kb")), $stale stale branch(es) older than ${AGE_HOURS}h — RUN_LOCK ${live} is held: entries may belong to the live run; do NOT sweep repo-wide until it concludes"
  else
    echo "audit: $orphans orphan worktree(s) ($(human_kb "$orphan_kb")), $stale stale branch(es) older than ${AGE_HOURS}h — triage, then remove with sweep_worktrees.sh --all [--force]"
  fi
  exit 0
fi
# Reaching here with AUDIT set means the block above aborted past its `exit 0`.
# That is not hypothetical: a bash expansion error inside an `if` body does NOT
# honour `set -e`, so both malformed --age-hours values found so far (24.5, then
# 08) silently continued into the DESTRUCTIVE sweep below and swept. Both are
# now rejected at parse time; this stop makes the whole class unreachable rather
# than one input at a time — a report-only flag must never remove anything.
if [ -n "$AUDIT" ]; then
  echo "sweep_worktrees.sh: internal error — the audit pass did not complete; nothing was swept" >&2
  exit 2
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
  # Kill what still runs out of this worktree BEFORE removing it — otherwise
  # the processes outlive the directory and pin its deleted files (the leak
  # the orphan pass below exists to mop up after the fact).
  reap_under "$wt"
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
# Probe worktrees are the driver's, not a run's: a dead pid is garbage under
# any scope, a live pid is a validate-knobs still running its suite.
for wt in "$ROOT"/.claude/ultrapowers/wt-knob-*; do
  [ -e "$wt" ] || continue
  if probe_alive "$wt"; then
    kept_worktrees=$((kept_worktrees + 1))
    echo "kept (probe pid ${wt##*wt-knob-} is alive): $wt"
    continue
  fi
  if git -C "$ROOT" worktree remove --force --force "$wt" 2>/dev/null; then
    removed_worktrees=$((removed_worktrees + 1))
  elif rm -rf "$wt" 2>/dev/null; then
    removed_worktrees=$((removed_worktrees + 1))
  else
    echo "warn: could not fully remove $wt — inspect manually" >&2
  fi
done
git -C "$ROOT" worktree prune

# ── orphan-process pass ────────────────────────────────────────────────────
# The engine's wave-merge removes consumed worktrees MID-RUN without killing
# what they spawned; the deleted path survives in each process's command line.
# A process referencing an engine worktree path that no longer exists on disk
# is garbage regardless of --run scope (its files are deleted; no live run can
# be using it) — reap repo-wide. Worktrees that still exist (kept, locked,
# out-of-scope) may be live state: their processes are left alone.
orphan_pids=""
while IFS=$(printf '\t') read -r pid wtpath; do
  [ -n "$pid" ] || continue
  case "$SELF_TREE" in *" $pid "*) continue ;; esac
  case " $orphan_pids " in *" $pid "*) continue ;; esac
  [ -e "$wtpath" ] && continue
  orphan_pids="$orphan_pids $pid"
  echo "orphan process: pid $pid still running out of deleted $wtpath — reaping"
done < <(scan_engine_procs)
if [ -n "$orphan_pids" ]; then
  # shellcheck disable=SC2086
  kill_with_grace $orphan_pids
fi

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
  # Two different reasons land here — out-of-scope (a narrower --run/RUNID/
  # RUN_LOCK glob) and locked (kept even by a repo-wide sweep) — so the summary
  # names both remedies. Claiming "outside this sweep's scope" was factually
  # wrong for a locked leftover of an --all sweep, and advised a no-op.
  echo "left behind: $left_n worktree(s), $(human_kb "$left_kb") total — not removed by this sweep (out-of-scope: --all sweeps repo-wide; locked: --force)"
fi
