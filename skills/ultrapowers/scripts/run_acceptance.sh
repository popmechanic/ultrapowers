#!/usr/bin/env bash
# Administer a sealed acceptance exam against a branch. Deterministic: no
# agents, no interpretation. Emits exactly one JSON object on stdout.
# Exit 0 iff the seal verified AND the exam passed.
#
# Usage: run_acceptance.sh <seal-id> <branch> <expected-sha256>
#                          [--vault DIR] [--repo DIR]
# Spec: docs/superpowers/specs/2026-06-12-sealed-acceptance-design.md
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

emit() { # status passed exit_code output  → prints JSON, never fails
  STATUS="$1" PASSED="$2" CODE="$3" OUTPUT="$4" SEAL="$SEAL_ID" python3 - <<'EOF'
import json, os
print(json.dumps({
    "sealId": os.environ["SEAL"],
    "status": os.environ["STATUS"],
    "passed": os.environ["PASSED"] == "true",
    "exitCode": int(os.environ["CODE"]),
    "output": os.environ["OUTPUT"][-8000:],
}))
EOF
}

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
WT="$(mktemp -d)/exam"
cleanup() { git -C "$REPO" worktree remove --force "$WT" >/dev/null 2>&1 || true; }
trap cleanup EXIT

if ! git -C "$REPO" worktree add --detach "$WT" "$BRANCH" >/dev/null 2>&1; then
  emit ERROR false 1 "could not create exam worktree for branch $BRANCH in $REPO"
  exit 1
fi
mkdir -p "$WT/.ultra-acceptance"
cp -R "$SUITE/." "$WT/.ultra-acceptance/"

# No-tests-ran defense (closes the false-green path): a green exit only earns a
# pass if the sealed suite actually executed at least one test. A runCmd that
# never touches the suite (e.g. exits 0 trivially) or one that collects zero
# tests proves nothing — accepting it would let an unbuilt feature pass the
# exam. The sentinel conftest writes a marker the moment any collected test
# runs; it only ever tightens the gate (absent marker on a green exit => ERROR)
# and can never turn a red exam green.
RAN_MARKER="$WT/.ultra-acceptance/.__ran__"
cat > "$WT/.ultra-acceptance/conftest.py" <<EOF
import pathlib
def pytest_runtest_call(item):
    pathlib.Path(__file__).with_name(".__ran__").write_text("1")
EOF

OUT="$( (cd "$WT" && eval "$RUN_CMD") 2>&1 )"
CODE=$?
# A NON-zero exit is left untouched — a collection error from a missing module
# (feature absent) is an honest red per the spec, and an already-failing exam
# can never false-green regardless of the marker.
if [ "$CODE" -eq 0 ]; then
  if [ ! -f "$RAN_MARKER" ]; then
    emit ERROR false 1 "exam exited 0 but ran no sealed tests (zero tests collected or runCmd never executed the suite) — refusing to false-green:
$OUT"
    exit 1
  fi
  emit OK true 0 "$OUT"
  exit 0
fi
emit OK false "$CODE" "$OUT"
exit 1
