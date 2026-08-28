#!/usr/bin/env bash
# Administer the committed-suite gate for a suite-disposition plan.
# Deterministic: no agents, no interpretation. Emits exactly one JSON object on
# stdout. Exit 0 iff the suite passed (and, when --base is given and harness JS
# changed, the harness sims passed too).
#
# Usage: run_acceptance.sh --suite-gate --branch BRANCH [--run CMD]
#                          [--bootstrap CMD] [--base REF] [--repo DIR]
# The sealed-exam and --baseline modes died with the sealing subsystem
# (One Driver Phase 0, row 7); any other invocation is a usage error (exit 2).
set -uo pipefail

SEAL_ID="(suite)"; BRANCH=""
REPO="$(pwd)"
SG_RUN="python3 -m pytest"
SG_BASE=""; SG_BOOT=""
MODE="suite-gate"
if [ "${1:-}" = "--suite-gate" ]; then
  shift
  while [ $# -gt 0 ]; do
    case "$1" in
      --branch)    BRANCH="$2";  shift 2 ;;
      --run)       SG_RUN="$2";  shift 2 ;;
      --base)      SG_BASE="$2"; shift 2 ;;
      --bootstrap) SG_BOOT="$2"; shift 2 ;;
      --repo)      REPO="$2";    shift 2 ;;
      *) echo "unknown argument: $1" >&2; exit 2 ;;
    esac
  done
  : "${BRANCH:?--suite-gate requires --branch}"
  if [ -z "$SG_BASE" ]; then
    echo "run_acceptance: warning — --suite-gate without --base: harness-JS sim guard disarmed (a branch that changed harnesses/*.js rides a Python-only green; pass --base <ref> to arm it)" >&2
  fi
else
  echo "usage: run_acceptance.sh --suite-gate --branch BRANCH [--run CMD] [--bootstrap CMD] [--base REF] [--repo DIR]" >&2
  exit 2
fi

emit() { # status passed exit_code output [redKind] → prints JSON, never fails
  OUTPUT_TAIL="$(printf '%s' "$4" | tail -c 8000)"
  STATUS="$1" PASSED="$2" CODE="$3" OUTPUT="$OUTPUT_TAIL" REDKIND="${5:-}" SEAL="$SEAL_ID" python3 - <<'EOF'
import json, os
obj = {
    "sealId": os.environ["SEAL"],
    "status": os.environ["STATUS"],
    "passed": os.environ["PASSED"] == "true",
    "exitCode": int(os.environ["CODE"]),
    "output": os.environ["OUTPUT"][-8000:],
}
rk = os.environ.get("REDKIND", "")
if rk:
    obj["redKind"] = rk
print(json.dumps(obj))
EOF
}

# Suite-gate worktree bookkeeping: cleanup removes the detached worktree and its temp parent on every exit.
EXAM_WT=""
cleanup() {
  if [ -n "$EXAM_WT" ]; then
    git -C "$REPO" worktree remove --force "$EXAM_WT" >/dev/null 2>&1 || true
    rm -rf "$(dirname "$EXAM_WT")" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# Prepare an exam worktree's environment (editable install / dep setup) before
# any suite runs in it. Shared by the sealed exam core and the suite gate so
# both classify a failed bootstrap identically: an ENV error, never a red — the
# environment could not be prepared, so nothing was measured about the code.
# An empty command is a no-op success (no bootstrap was asked for).
provision_worktree() { # $1=worktree $2=bootstrap_cmd → P_OK/P_CODE/P_OUTPUT
  P_OK=true; P_CODE=0; P_OUTPUT=""
  [ -z "$2" ] && return 0
  P_OUTPUT="$( (cd "$1" && eval "$2") 2>&1 )"; P_CODE=$?
  [ "$P_CODE" -ne 0 ] && P_OK=false
  return 0
}

# ── Harness JS-behavioral sims (issue #79) ────────────────────────────────────
# After a green pytest suite-gate, if the branch changed harness JS, run the
# harness .mjs sims so JS behavior is exit-code-gated too. Sets J_* globals;
# never emits or exits. node exits 0 for a no-op script, so a pass requires exit
# 0 AND a printed sentinel — exit code alone would re-open the false-green hole.
run_js_sims() { # $1=worktree $2=base_ref  → sets J_STATUS J_PASSED J_CODE J_OUTPUT J_REDKIND
  local WT="$1" BASE="$2"
  J_STATUS=OK; J_PASSED=true; J_CODE=0; J_OUTPUT=""; J_REDKIND=""
  # Detection: did this branch touch harness JS vs the base? Three-dot diffs
  # against the merge-base, correct even if the base line advanced.
  local CHANGED
  CHANGED="$(git -C "$WT" diff --name-only "$BASE"...HEAD 2>/dev/null \
              | grep -E '^skills/ultrapowers/harnesses/.*\.js$' || true)"
  if [ -z "$CHANGED" ]; then
    return 0   # harnesses untouched → nothing to run, gate stays green
  fi
  # node is required to exercise the JS. Missing node is an environment error,
  # never feature-absence — do not false-green by silently skipping.
  if ! command -v node >/dev/null 2>&1; then
    J_STATUS=ERROR; J_PASSED=false; J_CODE=1
    J_OUTPUT="harness JS changed but 'node' is not on PATH — cannot run harness sims:
$CHANGED"; return 0
  fi
  # Discover harness sims: the tests/*.mjs that exercise the harness (reference
  # harnesses/). Excludes the viewer specs (which reference viewer/).
  local SIMS="" f
  for f in "$WT"/tests/*.mjs; do
    [ -e "$f" ] || continue
    if grep -q 'harnesses/' "$f"; then SIMS="$SIMS $f"; fi
  done
  if [ -z "${SIMS// /}" ]; then
    # Harness JS changed but nothing exercises it → refuse to green unverified JS.
    J_STATUS=ERROR; J_PASSED=false; J_CODE=1
    J_OUTPUT="harness JS changed but no harness sim (tests/*.mjs referencing harnesses/) exists to exercise it — refusing to green unverified JS:
$CHANGED"; return 0
  fi
  local SENTINEL='ALL (SCENARIOS|TESTS) PASSED'
  local sim SOUT SCODE ACC=""
  for sim in $SIMS; do
    SOUT="$( (cd "$WT" && node "$sim") 2>&1 )"; SCODE=$?
    ACC="$ACC
--- sim $(basename "$sim") (exit $SCODE) ---
$SOUT"
    if [ "$SCODE" -ne 0 ]; then
      J_STATUS=OK; J_PASSED=false; J_CODE=$SCODE; J_REDKIND=assertion
      J_OUTPUT="harness sim $(basename "$sim") failed (exit $SCODE):$ACC"; return 0
    fi
    if ! printf '%s' "$SOUT" | grep -Eq "$SENTINEL"; then
      J_STATUS=ERROR; J_PASSED=false; J_CODE=1
      J_OUTPUT="harness sim $(basename "$sim") exited 0 but printed no pass sentinel (/$SENTINEL/) — refusing to false-green:$ACC"; return 0
    fi
  done
  J_STATUS=OK; J_PASSED=true; J_CODE=0; J_OUTPUT="harness sims passed:$ACC"
  return 0
}

# ── Suite-gate mode (committed-suite gate for suite-disposition plans) ────────
# Runs the repo's OWN committed suite (already on the branch) in a detached
# worktree. No held-out suite is mounted. pytest exit codes are the authority:
# 0 => pass; 5 => no tests collected (false-green guard); anything else => red.
if [ "$MODE" = "suite-gate" ]; then
  # Emptiness is judged on a whitespace-stripped COPY: `eval "   "` also exits 0,
  # so a blank-looking --run is the same false green as an empty one (#105).
  # SG_RUN itself stays unmodified — only the check uses the stripped copy.
  SG_RUN_STRIPPED="$(printf '%s' "${SG_RUN:-}" | tr -d '[:space:]')"
  if [ -z "$SG_RUN_STRIPPED" ]; then
    emit ERROR false 2 "--suite-gate requires a non-empty --run command (an empty or whitespace-only command evals to exit 0 — refusing a false green)"
    exit 1
  fi
  # Canonical temp parent, same two-step guard as the sealed exam core above.
  TMP="$(mktemp -d)"
  [ -n "$TMP" ] && TMP="$(cd "$TMP" && pwd -P)"
  [ -n "$TMP" ] || { emit ERROR false 1 "could not create a canonical temp parent for the suite-gate worktree (mktemp -d / pwd -P failed)"; exit 1; }
  EXAM_WT="$TMP/suite-gate"
  if ! git -C "$REPO" worktree add --detach "$EXAM_WT" "$BRANCH" >/dev/null 2>&1; then
    emit ERROR false 1 "could not create suite-gate worktree for branch $BRANCH in $REPO"
    exit 1
  fi
  # Same environment preparation the sealed exam gets: a suite whose deps are
  # not installed in the fresh worktree would otherwise red as feature-absence.
  provision_worktree "$EXAM_WT" "${SG_BOOT:-}"
  if [ "$P_OK" != true ]; then
    emit EXAM_BOOTSTRAP_ERROR false "$P_CODE" "bootstrap failed (exit $P_CODE): ${SG_BOOT}
$P_OUTPUT"
    exit 1
  fi
  OUT="$( (cd "$EXAM_WT" && eval "$SG_RUN") 2>&1 )"; CODE=$?
  if [ "$CODE" -eq 0 ]; then
    # pytest green. If a base was given AND this branch changed harness JS, also
    # run the harness .mjs sims so JS behavior is exit-code-gated (issue #79).
    if [ -n "$SG_BASE" ]; then
      run_js_sims "$EXAM_WT" "$SG_BASE"
      if [ "$J_STATUS" != OK ] || [ "$J_PASSED" != true ]; then
        emit "$J_STATUS" "$J_PASSED" "$J_CODE" "pytest passed; $J_OUTPUT" "$J_REDKIND"
        exit 1
      fi
      emit OK true 0 "$OUT
$J_OUTPUT"; exit 0
    fi
    emit OK true 0 "$OUT"; exit 0
  elif [ "$CODE" -eq 5 ]; then
    emit ERROR false 5 "committed suite collected no tests — refusing to false-green:
$OUT"; exit 1
  else
    emit OK false "$CODE" "$OUT" assertion; exit 1
  fi
fi
