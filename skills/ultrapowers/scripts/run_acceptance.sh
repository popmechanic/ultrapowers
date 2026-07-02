#!/usr/bin/env bash
# Administer a sealed acceptance exam against a branch. Deterministic: no
# agents, no interpretation. Emits exactly one JSON object on stdout.
# Exit 0 iff the seal verified AND the exam passed.
#
# Usage: run_acceptance.sh <seal-id> <branch> <expected-sha256>
#                          [--vault DIR] [--repo DIR]
#    or: run_acceptance.sh --baseline --suite DIR --branch BASE --run CMD
#                          [--bootstrap CMD] [--repo DIR]   (seal-time RED proof)
# Spec: docs/superpowers/specs/2026-06-15-sealed-acceptance-env-bootstrap-design.md
set -uo pipefail

SEAL_ID="(baseline)"; BRANCH=""; EXPECTED=""
VAULT="${HOME}/.ultrapowers/acceptance"
REPO="$(pwd)"
B_SUITE=""; B_RUN=""; B_BOOT=""
SG_RUN="python3 -m pytest"
SG_BASE=""
MODE="sealed"
if [ "${1:-}" = "--baseline" ]; then
  MODE="baseline"; shift
  while [ $# -gt 0 ]; do
    case "$1" in
      --suite)     B_SUITE="$2"; shift 2 ;;
      --branch)    BRANCH="$2";  shift 2 ;;
      --run)       B_RUN="$2";   shift 2 ;;
      --bootstrap) B_BOOT="$2";  shift 2 ;;
      --repo)      REPO="$2";    shift 2 ;;
      *) echo "unknown argument: $1" >&2; exit 2 ;;
    esac
  done
  : "${B_SUITE:?--baseline requires --suite}"
  : "${BRANCH:?--baseline requires --branch}"
  : "${B_RUN:?--baseline requires --run}"
elif [ "${1:-}" = "--suite-gate" ]; then
  MODE="suite-gate"; SEAL_ID="(suite)"; shift
  while [ $# -gt 0 ]; do
    case "$1" in
      --branch) BRANCH="$2"; shift 2 ;;
      --run)    SG_RUN="$2"; shift 2 ;;
      --base)   SG_BASE="$2"; shift 2 ;;
      --repo)   REPO="$2";   shift 2 ;;
      *) echo "unknown argument: $1" >&2; exit 2 ;;
    esac
  done
  : "${BRANCH:?--suite-gate requires --branch}"
  if [ -z "$SG_BASE" ]; then
    echo "run_acceptance: warning — --suite-gate without --base: harness-JS sim guard disarmed (a branch that changed harnesses/*.js rides a Python-only green; pass --base <ref> to arm it)" >&2
  fi
else
  SEAL_ID="${1:?usage: run_acceptance.sh <seal-id> <branch> <sha256> [--vault DIR] [--repo DIR]}"
  BRANCH="${2:?missing branch}"
  EXPECTED="${3:?missing expected sha256}"
  shift 3
  while [ $# -gt 0 ]; do
    case "$1" in
      --vault) VAULT="$2"; shift 2 ;;
      --repo)  REPO="$2";  shift 2 ;;
      *) echo "unknown argument: $1" >&2; exit 2 ;;
    esac
  done
fi
HERE="$(cd "$(dirname "$0")" && pwd)"

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

# Shared exam core, used by the sealed gate path (and, in Task 2, --baseline).
# Creates a detached worktree of $2, mounts the suite at .ultra-acceptance/,
# runs the optional bootstrap, then the run command, and classifies into R_*
# globals WITHOUT emitting or exiting — each caller owns its own exit contract.
EXAM_WT=""
cleanup() {
  if [ -n "$EXAM_WT" ]; then
    git -C "$REPO" worktree remove --force "$EXAM_WT" >/dev/null 2>&1 || true
    rm -rf "$(dirname "$EXAM_WT")" 2>/dev/null || true
  fi
}
trap cleanup EXIT

run_exam() { # $1=suite_dir $2=branch $3=run_cmd $4=bootstrap_cmd
  local SUITE_DIR="$1" BR="$2" RUN_CMD="$3" BOOT="$4"
  R_REDKIND=""
  EXAM_WT="$(mktemp -d)/exam"
  if ! git -C "$REPO" worktree add --detach "$EXAM_WT" "$BR" >/dev/null 2>&1; then
    R_STATUS=ERROR; R_PASSED=false; R_CODE=1
    R_OUTPUT="could not create exam worktree for branch $BR in $REPO"; return 0
  fi
  mkdir -p "$EXAM_WT/.ultra-acceptance"
  cp -R "$SUITE_DIR/." "$EXAM_WT/.ultra-acceptance/"
  local RAN_MARKER="$EXAM_WT/.ultra-acceptance/.__ran__"
  # Inject the pytest ran-marker plugin only for pytest suites; non-pytest
  # frameworks detect "tests ran" from the runner's own output via RAN_PATTERN.
  if [ "${FRAMEWORK:-pytest}" = "pytest" ]; then
    cat > "$EXAM_WT/.ultra-acceptance/conftest.py" <<'CONF'
import pathlib
def pytest_runtest_call(item):
    pathlib.Path(__file__).with_name(".__ran__").write_text("1")
CONF
  fi
  # Bootstrap the worktree's environment (editable install / dep setup) before
  # the suite so the repo's own libraries import. A failed bootstrap is an ENV
  # error, never a red: the environment could not be prepared.
  if [ -n "$BOOT" ]; then
    local BOUT BCODE
    BOUT="$( (cd "$EXAM_WT" && eval "$BOOT") 2>&1 )"; BCODE=$?
    if [ "$BCODE" -ne 0 ]; then
      R_STATUS=EXAM_BOOTSTRAP_ERROR; R_PASSED=false; R_CODE=$BCODE
      R_OUTPUT="bootstrap failed (exit $BCODE): $BOOT
$BOUT"; return 0
    fi
  fi
  local OUT CODE ran
  OUT="$( (cd "$EXAM_WT" && eval "$RUN_CMD") 2>&1 )"; CODE=$?
  # Determine whether any tests actually ran. For pytest: check the injected
  # ran-marker file. For non-pytest frameworks: match the runner's stdout/stderr
  # against the manifest's ranPattern (a configurable extended regex).
  ran=0
  if [ "${FRAMEWORK:-pytest}" = "pytest" ]; then
    [ -f "$RAN_MARKER" ] && ran=1
  elif [ -n "${RAN_PATTERN:-}" ] && printf '%s' "$OUT" | grep -Eq "${RAN_PATTERN}"; then
    ran=1
  fi
  if [ "$CODE" -eq 0 ]; then
    # No-tests-ran defense (false-green guard): a green exit earns a pass only
    # if the sealed suite actually executed a test.
    if [ "$ran" -eq 0 ]; then
      R_STATUS=ERROR; R_PASSED=false; R_CODE=1
      R_OUTPUT="exam exited 0 but ran no sealed tests (zero tests collected or runCmd never executed the suite) — refusing to false-green:
$OUT"
    else
      R_STATUS=OK; R_PASSED=true; R_CODE=0; R_OUTPUT="$OUT"
    fi
  else
    # Non-zero WITH a tests-ran signal => a test executed and failed (assertion
    # red). WITHOUT it => nothing executed (collection/import red). The bootstrap
    # above means an env-caused collection error can no longer reach here, so a
    # surviving collection red is genuine feature-absence.
    R_STATUS=OK; R_PASSED=false; R_CODE=$CODE; R_OUTPUT="$OUT"
    if [ "$ran" -eq 1 ]; then R_REDKIND=assertion; else R_REDKIND=collection; fi
  fi
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
  EXAM_WT="$(mktemp -d)/suite-gate"
  if ! git -C "$REPO" worktree add --detach "$EXAM_WT" "$BRANCH" >/dev/null 2>&1; then
    emit ERROR false 1 "could not create suite-gate worktree for branch $BRANCH in $REPO"
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

# ── Baseline mode (seal-time RED proof through the exact gate execution core) ──
if [ "$MODE" = baseline ]; then
  FRAMEWORK="${FRAMEWORK:-pytest}"; RAN_PATTERN="${RAN_PATTERN:-}"
  run_exam "$B_SUITE" "$BRANCH" "$B_RUN" "$B_BOOT"
  if [ "$R_STATUS" = OK ] && [ "$R_PASSED" = false ]; then
    emit PROVEN_RED false "$R_CODE" "$R_OUTPUT" "$R_REDKIND"; exit 0
  fi
  if [ "$R_STATUS" = OK ] && [ "$R_PASSED" = true ]; then
    emit GREEN_AT_BASELINE true "$R_CODE" "$R_OUTPUT" "$R_REDKIND"; exit 1
  fi
  emit "$R_STATUS" "$R_PASSED" "$R_CODE" "$R_OUTPUT" "$R_REDKIND"; exit 1
fi

# ── Sealed gate path ──────────────────────────────────────────────────────────
SUITE="$VAULT/$SEAL_ID/suite"
MANIFEST="$VAULT/$SEAL_ID/manifest.json"
if [ ! -d "$SUITE" ] || [ ! -f "$MANIFEST" ]; then
  emit SEAL_MISSING false 1 "vault entry not found: $VAULT/$SEAL_ID"
  exit 1
fi

ACTUAL="$(python3 "$HERE/seal_hash.py" "$SUITE")"
if [ "$ACTUAL" != "$EXPECTED" ]; then
  emit SEAL_BROKEN false 1 "suite hash $ACTUAL does not match recorded $EXPECTED"
  exit 1
fi

# Read all four manifest fields in ONE python3 pass (was four json.load spawns).
# A missing/unreadable manifest or empty runCmd yields an empty first line, which
# the runCmd guard below converts to a clean ERROR — never a crash, never a false-green.
read_manifest() {
  python3 -c '
import json, sys
try:
    m = json.load(open(sys.argv[1]))
except Exception:
    m = {}
print(m.get("runCmd") or "")
print(m.get("bootstrapCmd") or "")
print(m.get("framework") or "pytest")
print(m.get("ranPattern") or "")
' "$1"
}
{ IFS= read -r RUN_CMD
  IFS= read -r BOOTSTRAP_CMD
  IFS= read -r FRAMEWORK
  IFS= read -r RAN_PATTERN
} < <(read_manifest "$MANIFEST")

if [ -z "$RUN_CMD" ]; then
  emit ERROR false 1 "manifest missing or invalid runCmd: $MANIFEST"
  exit 1
fi

run_exam "$SUITE" "$BRANCH" "$RUN_CMD" "$BOOTSTRAP_CMD"
emit "$R_STATUS" "$R_PASSED" "$R_CODE" "$R_OUTPUT" "$R_REDKIND"
if [ "$R_STATUS" = OK ] && [ "$R_PASSED" = true ]; then exit 0; fi
exit 1
