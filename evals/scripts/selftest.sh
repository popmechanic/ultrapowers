#!/usr/bin/env bash
# Harness self-test: prove every held-out acceptance suite is SATISFIABLE.
# For each fixture, overlay the reference solution onto the baseline project and
# require both the project suite and the acceptance suite to pass 100%.
# Run this before spending a dollar on the matrix — a buggy acceptance test
# would poison every cell that touches its fixture.
set -euo pipefail

EVALS_DIR="$(cd "$(dirname "$0")/.." && pwd)"
fail=0

for fixture_dir in "$EVALS_DIR"/fixtures/*/; do
  name="$(basename "$fixture_dir")"
  tmp="$(mktemp -d)"
  cp -R "$fixture_dir/project/." "$tmp/"
  cp -R "$fixture_dir/reference/." "$tmp/"
  mkdir "$tmp/.acceptance"
  cp "$fixture_dir"/acceptance/*.py "$tmp/.acceptance/"
  echo "=== $name ==="
  if ! (cd "$tmp" && python3 -m pytest tests/ .acceptance/ -q --tb=short -p no:cacheprovider | tail -2); then
    fail=1
  fi
  rm -rf "$tmp"
done

[ "$fail" -eq 0 ] && echo "selftest: all acceptance suites satisfiable" || exit 1
