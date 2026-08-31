#!/usr/bin/env bash
# fleet/update-cli.sh — the Claude Code version-update workflow (operator, laptop-run).
#
# Version drift is EVENT-driven, not time-driven: sandboxes clone fleet-golden,
# whose `claude` is baked into the image (no apt backing, no boot-time fetch),
# and the auto-updater is frozen (DISABLE_AUTOUPDATER=1 in the worker env;
# the /usr/local/bin install is root-owned besides). So the ONLY moment CLI
# drift can enter the fleet is this script — and the parity probes run here,
# at that moment, instead of on any schedule.
#
#   bash fleet/update-cli.sh            # update golden + orchestrator to latest
#   bash fleet/update-cli.sh 2.1.185    # pin a specific version
#
# What runs, deliberately minimal: ONLY the four live parity probes (the
# CLI-contract surface — envelope shapes, exit classes, permission semantics
# under bypass, the confine boundary). Never the pytest suite: it tests OUR
# code, which did not change. Probes run on the ORCHESTRATOR (the golden holds
# no credentials by design, spec §"golden image"); golden and orchestrator are
# updated together and asserted identical, so the probed binary IS the workers'.
#
# On any red: the fleet is NOT left on the new version — the script prints the
# exeuntu rollback for both hosts and exits 1.
set -euo pipefail

GOLDEN=fleet-golden.exe.xyz
ORCH=fleet-orchestrator.exe.xyz
VERSION="${1:-}"
UPDATE_ARGS=""
[ -n "$VERSION" ] && UPDATE_ARGS="--version $VERSION"

PROBES=(
  "probe_confine_live.mjs:CONFINEMENT VERIFIED"
  "probe_bypass_vs_hook.mjs:DENY HELD"
  "probe_disallowed_vs_bypass.mjs:VERDICT: BINDS"
  "probe_run_worker_live.mjs:ALL PROBES PASSED"
  # Permission-boundary semantics (#457): a CLI release can change either of
  # these silently, and both are load-bearing for the read-only roles.
  "probe_dontask_readonly_bash.mjs:READ-ONLY BASH REACHABLE"
  "probe_substitution_in_allowed_tail.mjs:SUBSTITUTION BLOCKED"
  # The PATH half of the same question. probe_dontask_readonly_bash tests only
  # an in-cwd path; this one reproduces the production shape (a read-only role
  # reading `wavesPath` and `patches/` from a PARENT of its cwd) and pins that
  # `--add-dir` reaches Bash. A CLI release that changes it re-parks every run.
  "probe_addcwd_scope.mjs:ALL TESTS PASSED"
)

echo "== current versions"
PRIOR_GOLDEN=$(ssh "$GOLDEN" 'claude --version' | awk '{print $1}')
PRIOR_ORCH=$(ssh "$ORCH" 'claude --version' | awk '{print $1}')
echo "   golden:       $PRIOR_GOLDEN"
echo "   orchestrator: $PRIOR_ORCH"

echo "== updating claude on both hosts ${VERSION:+(pin $VERSION)}"
ssh "$GOLDEN" "sudo exeuntu update claude $UPDATE_ARGS"
ssh "$ORCH" "sudo exeuntu update claude $UPDATE_ARGS"
NEW_GOLDEN=$(ssh "$GOLDEN" 'claude --version' | awk '{print $1}')
NEW_ORCH=$(ssh "$ORCH" 'claude --version' | awk '{print $1}')
echo "   golden:       $PRIOR_GOLDEN -> $NEW_GOLDEN"
echo "   orchestrator: $PRIOR_ORCH -> $NEW_ORCH"
if [ "$NEW_GOLDEN" != "$NEW_ORCH" ]; then
  echo "FAIL: hosts diverged ($NEW_GOLDEN vs $NEW_ORCH) — the probed binary would not be the workers'." >&2
  exit 1
fi

# A fresh, shallow, throwaway checkout for the probes: the orchestrator's
# /home/exedev/repo is the drive's working checkout and is not disturbed. The
# probes import only node builtins + fleet-local modules — no npm install.
echo "== running the parity probes on the orchestrator (main tip)"
FAILED=""
ssh "$ORCH" 'rm -rf /tmp/cli-probe && git clone -q --depth 1 https://github.com/popmechanic/ultrapowers /tmp/cli-probe'
for entry in "${PROBES[@]}"; do
  probe="${entry%%:*}"
  sentinel="${entry#*:}"
  echo "-- $probe"
  if out=$(ssh "$ORCH" "cd /tmp/cli-probe && CLAUDE_CODE_OAUTH_TOKEN=\$(cat /home/exedev/.fleet/claude-oauth-token) node fleet/tests/$probe" 2>&1) \
     && grep -qF "$sentinel" <<<"$out"; then
    echo "   ok — ${sentinel}"
  else
    echo "   RED"
    echo "$out" | tail -12 | sed 's/^/   | /'
    FAILED="$FAILED $probe"
  fi
done
ssh "$ORCH" 'rm -rf /tmp/cli-probe' || true

if [ -n "$FAILED" ]; then
  cat >&2 <<EOF

PROBES RED:$FAILED
The CLI contract moved. Do not run the fleet on $NEW_GOLDEN. Roll back both hosts:
  ssh $GOLDEN 'sudo exeuntu update claude --version $PRIOR_GOLDEN'
  ssh $ORCH 'sudo exeuntu update claude --version $PRIOR_ORCH'
Then file the drift (what changed, which probe, the output above) before retrying.
EOF
  exit 1
fi

echo "== all probes green — the fleet is on claude $NEW_GOLDEN"
echo "   (record: $PRIOR_GOLDEN -> $NEW_GOLDEN, $(date -u +%Y-%m-%dT%H:%MZ))"
