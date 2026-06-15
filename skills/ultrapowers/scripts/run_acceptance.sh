#!/usr/bin/env bash
# Administer a sealed acceptance exam against a branch. Deterministic: no
# agents, no interpretation. Emits exactly one JSON object on stdout.
# Exit 0 iff the seal verified AND the exam passed.
#
# Usage: run_acceptance.sh <seal-id> <branch> <expected-sha256>
#                          [--vault DIR] [--repo DIR]
# Spec: docs/superpowers/specs/2026-06-15-sealed-acceptance-env-bootstrap-design.md
set -uo pipefail

SEAL_ID="${1:?usage: run_acceptance.sh <seal-id> <branch> <sha256> [--vault DIR] [--repo DIR]}"
BRANCH="${2:?missing branch}"
EXPECTED="${3:?missing expected sha256}"
shift 3
VAULT="${HOME}/.ultrapowers/acceptance"
REPO="$(pwd)"
while [ $# -gt 0 ]; do
  case "$1" in
    --vault) VAULT="$2"; shift 2 ;;
    --repo)  REPO="$2";  shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
HERE="$(cd "$(dirname "$0")" && pwd)"

emit() { # status passed exit_code output [redKind] → prints JSON, never fails
  STATUS="$1" PASSED="$2" CODE="$3" OUTPUT="$4" REDKIND="${5:-}" SEAL="$SEAL_ID" python3 - <<'EOF'
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
cleanup() { [ -n "$EXAM_WT" ] && git -C "$REPO" worktree remove --force "$EXAM_WT" >/dev/null 2>&1 || true; }
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
  cat > "$EXAM_WT/.ultra-acceptance/conftest.py" <<'CONF'
import pathlib
def pytest_runtest_call(item):
    pathlib.Path(__file__).with_name(".__ran__").write_text("1")
CONF
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
  local OUT CODE
  OUT="$( (cd "$EXAM_WT" && eval "$RUN_CMD") 2>&1 )"; CODE=$?
  if [ "$CODE" -eq 0 ]; then
    # No-tests-ran defense (false-green guard): a green exit earns a pass only
    # if the sealed suite actually executed a test.
    if [ ! -f "$RAN_MARKER" ]; then
      R_STATUS=ERROR; R_PASSED=false; R_CODE=1
      R_OUTPUT="exam exited 0 but ran no sealed tests (zero tests collected or runCmd never executed the suite) — refusing to false-green:
$OUT"
    else
      R_STATUS=OK; R_PASSED=true; R_CODE=0; R_OUTPUT="$OUT"
    fi
  else
    # Non-zero WITH a tests-ran marker => a test executed and failed (assertion
    # red). WITHOUT it => nothing executed (collection/import red). The bootstrap
    # above means an env-caused collection error can no longer reach here, so a
    # surviving collection red is genuine feature-absence.
    R_STATUS=OK; R_PASSED=false; R_CODE=$CODE; R_OUTPUT="$OUT"
    if [ -f "$RAN_MARKER" ]; then R_REDKIND=assertion; else R_REDKIND=collection; fi
  fi
  return 0
}

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

if ! RUN_CMD="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["runCmd"])' "$MANIFEST" 2>/dev/null)" \
   || [ -z "$RUN_CMD" ]; then
  emit ERROR false 1 "manifest missing or invalid runCmd: $MANIFEST"
  exit 1
fi
BOOTSTRAP_CMD="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("bootstrapCmd") or "")' "$MANIFEST" 2>/dev/null || true)"

run_exam "$SUITE" "$BRANCH" "$RUN_CMD" "$BOOTSTRAP_CMD"
emit "$R_STATUS" "$R_PASSED" "$R_CODE" "$R_OUTPUT" "$R_REDKIND"
if [ "$R_STATUS" = OK ] && [ "$R_PASSED" = true ]; then exit 0; fi
exit 1
