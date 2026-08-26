#!/bin/bash
# hygiene_check.sh — close-of-run git hygiene check (#253).
#
# Report-only by default: prints ONE JSON receipt on stdout and exits 0 iff
# every check is clean. `--fix` applies the safe subset only — deleting LOCAL
# engine branches already merged into the expected branch, and deleting
# MERGED-by-ancestry remote branches (never proto/* or the expected branch).
# Dirt is named, never auto-stashed; unmerged branches are kept as evidence.
#
# Run at the single close point of a run: the /ultrapowers Step-5 Approve
# wrap-up and the /ultradocket drain close (before the merge to main, and at
# close). A red receipt is a NEEDS_ACK-style block on the finishing handoff —
# surface it, never skip it silently.
#
# Checks (issue #253; the run-*/heads/ sub-check is dropped — #259 deleted
# that convention, so there are no slots left to validate):
#   branch      — checkout is on the expected branch (--branch, default main)
#   tree        — working tree clean (git status --porcelain empty)
#   sync        — after `git fetch --prune`, HEAD == origin/<branch>
#                 (ahead/behind reported; a branch with no upstream is clean)
#   worktrees   — `git worktree list` is the primary checkout only (after
#                 `git worktree prune`), and no .claude/worktrees/wf_* or
#                 .claude/ultrapowers/wt-* leftover directories exist
#   run_lock    — no .claude/ultrapowers/RUN_LOCK
#   local_branches  — worktree-wf_* / ultra/integration-* / ultra/docket-*:
#                 merged → stale (deleted under --fix); unmerged → kept
#                 evidence (informational, never red)
#   remote_branches — origin branches merged into origin/<branch> by ancestry,
#                 excluding <branch>, proto/*, claw/proto-* → stale (deleted
#                 under --fix)
#   processes   — no lingering engine processes (node tests/*.mjs,
#                 fold_wave.py, pytest run out of a wf_* worktree path)
#   ci          — informational only: `gh` status of origin/<branch> HEAD;
#                 never affects the exit code
#
# Usage: hygiene_check.sh [--branch <name>] [--fix] [--no-fetch]
#   --no-fetch skips the network fetch (sync compares against the local
#   remote-tracking ref); for offline use and tests.
set -u

BRANCH="main"
FIX="no"
FETCH="yes"
while [ $# -gt 0 ]; do
  case "$1" in
    --branch) BRANCH="${2:?--branch needs a name}"; shift ;;
    --fix) FIX="yes" ;;
    --no-fetch) FETCH="no" ;;
    *) echo "usage: hygiene_check.sh [--branch <name>] [--fix] [--no-fetch]" >&2; exit 2 ;;
  esac
  shift
done

ROOT="$(git rev-parse --show-toplevel)" || exit 2
cd "$ROOT"

# Each check appends one line: <name>\t<ok|red|info>\t<detail>
RESULTS="$(mktemp)"
FIXED="$(mktemp)"
trap 'rm -f "$RESULTS" "$FIXED"' EXIT
note() { printf '%s\t%s\t%s\n' "$1" "$2" "$3" >> "$RESULTS"; }

# ── branch + tree ────────────────────────────────────────────────────────────
CUR="$(git branch --show-current)"
if [ "$CUR" = "$BRANCH" ]; then
  note branch ok "$CUR"
else
  note branch red "on '$CUR', expected '$BRANCH'"
fi

DIRT="$(git status --porcelain)"
if [ -z "$DIRT" ]; then
  note tree ok "clean"
else
  note tree red "dirty (never auto-stashed): $(printf '%s' "$DIRT" | head -5 | tr '\n' ';')"
fi

# ── sync ─────────────────────────────────────────────────────────────────────
if git remote get-url origin >/dev/null 2>&1; then
  if [ "$FETCH" = "yes" ]; then
    git fetch --prune origin >/dev/null 2>&1 || note sync red "git fetch --prune failed"
  fi
  if git rev-parse --verify --quiet "origin/$BRANCH" >/dev/null; then
    AHEAD="$(git rev-list --count "origin/$BRANCH..$BRANCH" 2>/dev/null || echo '?')"
    BEHIND="$(git rev-list --count "$BRANCH..origin/$BRANCH" 2>/dev/null || echo '?')"
    if [ "$AHEAD" = "0" ] && [ "$BEHIND" = "0" ]; then
      note sync ok "in sync with origin/$BRANCH"
    else
      note sync red "ahead $AHEAD / behind $BEHIND of origin/$BRANCH"
    fi
  else
    note sync ok "no origin/$BRANCH upstream"
  fi
else
  note sync ok "no origin remote"
fi

# ── worktrees ────────────────────────────────────────────────────────────────
git worktree prune >/dev/null 2>&1 || true
EXTRA_WT="$(git worktree list --porcelain | awk '/^worktree /{print $2}' | grep -vFx "$ROOT" || true)"
LEFTOVER="$(ls -d .claude/worktrees/wf_* .claude/ultrapowers/wt-* 2>/dev/null || true)"
if [ -z "$EXTRA_WT" ] && [ -z "$LEFTOVER" ]; then
  note worktrees ok "primary checkout only"
else
  note worktrees red "$(printf '%s %s' "$EXTRA_WT" "$LEFTOVER" | tr '\n' ' ')"
fi

# ── run lock ─────────────────────────────────────────────────────────────────
if [ -f .claude/ultrapowers/RUN_LOCK ]; then
  note run_lock red "RUN_LOCK held by $(cat .claude/ultrapowers/RUN_LOCK)"
else
  note run_lock ok "absent"
fi

# ── local engine branches ────────────────────────────────────────────────────
REMAIN_LOCAL=""; KEPT_LOCAL=""
for b in $(git for-each-ref --format='%(refname:short)' \
    'refs/heads/worktree-wf_*' 'refs/heads/ultra/integration-*' 'refs/heads/ultra/docket-*'); do
  if git merge-base --is-ancestor "$b" "$BRANCH" 2>/dev/null; then
    if [ "$FIX" = "yes" ] && git branch -D "$b" >/dev/null 2>&1; then
      echo "deleted local branch $b" >> "$FIXED"
    else
      REMAIN_LOCAL="$REMAIN_LOCAL $b"
    fi
  else
    KEPT_LOCAL="$KEPT_LOCAL $b"
  fi
done
if [ -n "$REMAIN_LOCAL" ]; then
  note local_branches red "merged (stale):$REMAIN_LOCAL"
else
  note local_branches ok "none stale${KEPT_LOCAL:+; kept (unmerged evidence):$KEPT_LOCAL}"
fi

# ── remote engine debris ─────────────────────────────────────────────────────
REMAIN_REMOTE=""
if git rev-parse --verify --quiet "origin/$BRANCH" >/dev/null; then
  for rb in $(git for-each-ref --format='%(refname:short)' 'refs/remotes/origin/*' \
      | sed 's|^origin/||' | grep -v '^HEAD$'); do
    case "$rb" in
      "$BRANCH"|proto/*|claw/proto-*) continue ;;
    esac
    if git merge-base --is-ancestor "origin/$rb" "origin/$BRANCH" 2>/dev/null; then
      if [ "$FIX" = "yes" ] && git push origin --delete "$rb" >/dev/null 2>&1; then
        echo "deleted remote branch $rb" >> "$FIXED"
      else
        REMAIN_REMOTE="$REMAIN_REMOTE $rb"
      fi
    fi
  done
fi
if [ -n "$REMAIN_REMOTE" ]; then
  note remote_branches red "merged (stale):$REMAIN_REMOTE"
else
  note remote_branches ok "none stale"
fi

# ── lingering engine processes ───────────────────────────────────────────────
# cmdline-based, like the sweep's reaping predicate: a lingering engine process
# names a test .mjs, the fold kernel, or an explicit pytest invocation, AND
# references this repo or a wf_ worktree path. The pipeline excludes itself
# (grep/pgrep/this script) — the pattern otherwise matches its own cmdline.
PROCS="$(pgrep -lf 'node tests/[a-z_]*\.mjs|fold_wave\.py|python[0-9.]* -m pytest' 2>/dev/null \
  | grep -E "$ROOT|wf_" | grep -vE 'hygiene_check| grep -E |pgrep' || true)"
if [ -z "$PROCS" ]; then
  note processes ok "none"
else
  note processes red "$(printf '%s' "$PROCS" | head -3 | tr '\n' ';')"
fi

# ── CI (informational only) ──────────────────────────────────────────────────
if command -v gh >/dev/null 2>&1 && [ "$FETCH" = "yes" ]; then
  CI="$(gh run list --branch "$BRANCH" --limit 1 --json status,conclusion \
        --jq '.[0] | (.status + "/" + (.conclusion // ""))' 2>/dev/null || echo unavailable)"
  note ci info "$CI"
else
  note ci info "skipped"
fi

# ── receipt ──────────────────────────────────────────────────────────────────
python3 - "$RESULTS" "$FIXED" <<'EOF'
import json, sys
checks, clean = {}, True
for line in open(sys.argv[1]):
    name, state, detail = line.rstrip("\n").split("\t", 2)
    checks[name] = {"ok": state != "red", "state": state, "detail": detail}
    if state == "red":
        clean = False
fixed = [l.rstrip("\n") for l in open(sys.argv[2])]
print(json.dumps({"clean": clean, "fixed": fixed, "checks": checks}, indent=2))
sys.exit(0 if clean else 1)
EOF
