#!/usr/bin/env bash
# Instantiate a fixture into a fresh run directory.
# Usage: prepare_run.sh <fixture> <run_dir>
# Copies the fixture project + frozen plan (NEVER the acceptance tests),
# initializes git, commits, tags `eval-baseline`, records the start timestamp,
# and sanity-checks that the baseline suite is green.
set -euo pipefail

EVALS_DIR="$(cd "$(dirname "$0")/.." && pwd)"
FIXTURE="${1:?usage: prepare_run.sh <fixture> <run_dir>}"
RUN_DIR="${2:?usage: prepare_run.sh <fixture> <run_dir>}"
SRC="$EVALS_DIR/fixtures/$FIXTURE"

[ -d "$SRC/project" ] || { echo "unknown fixture: $FIXTURE" >&2; exit 1; }
[ -e "$RUN_DIR" ] && { echo "refusing to overwrite existing $RUN_DIR" >&2; exit 1; }

mkdir -p "$RUN_DIR"
cp -R "$SRC/project/." "$RUN_DIR/"
mkdir -p "$RUN_DIR/docs/plans"
cp "$SRC/plan.md" "$RUN_DIR/docs/plans/plan.md"

cd "$RUN_DIR"
python3 - "$FIXTURE" <<'PY'
import json, sys, time
json.dump({"fixture": sys.argv[1], "started_epoch": time.time()},
          open(".eval_meta.json", "w"))
PY

git init -q
# Self-contained repo: no signing, local identity — eval runs must not depend
# on (or pollute) the operator's global git configuration.
git config commit.gpgsign false
git config tag.gpgsign false
git config user.name "eval harness"
git config user.email "eval@ultrapowers.local"
git add -A
git commit -qm "eval baseline: $FIXTURE"
git tag eval-baseline

echo "baseline suite:"
python3 -m pytest tests/ -q

echo
echo "run directory ready: $RUN_DIR"
echo "plan: docs/plans/plan.md  (clock started; score_run.py stops it)"
