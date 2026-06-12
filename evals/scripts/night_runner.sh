#!/usr/bin/env bash
# Serial overnight queue for automated eval runs (conditions B and C).
# Usage:  caffeinate -i bash evals/scripts/night_runner.sh chained:B:2 degrade:B:2 ...
# Each entry is <fixture>:<condition>:<rep>. Logs to /tmp/eval-runs/night-runner.log.
set -uo pipefail

EVALS_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_DIR="$(dirname "$EVALS_DIR")"
RUNS_DIR="/tmp/eval-runs"
LOG="$RUNS_DIR/night-runner.log"
COST_CEILING_USD=70      # halt the queue past this (≈9-10 weekly points)
RUN_TIMEOUT_S=2700       # 45 min per run, then kill and move on
mkdir -p "$RUNS_DIR"

log() { echo "[$(date '+%H:%M:%S')] $*" | tee -a "$LOG"; }

night_start_epoch=$(date +%s)

night_cost() {
  python3 - "$EVALS_DIR/results/runs.jsonl" "$night_start_epoch" <<'PY'
import json, sys
total = 0.0
for line in open(sys.argv[1]):
    if not line.strip():
        continue
    r = json.loads(line)
    if r.get("scored_epoch", 0) >= float(sys.argv[2]):
        total += r.get("cost_usd", 0)
print(f"{total:.2f}")
PY
}

prompt_for() {
  local cond="$1"
  local knobs=""
  if [ "$cond" = "C" ]; then
    knobs="At the wave-plan gate, FIRST revise the knobs to tierOverrides: {cheap: 'opus', standard: 'opus'} (change nothing else), then approve the revised plan. "
  else
    knobs="Approve the wave plan exactly as proposed - no knob changes. "
  fi
  cat <<EOF
/ultrapowers docs/plans/plan.md

You are running non-interactively with standing operator answers; do not use
AskUserQuestion, apply these answers wherever the skill calls for operator
input: ${knobs}When the run reaches the pre-merge gate, print the pre-merge
report and STOP. Do not approve the merge, do not invoke the finishing skill,
do not merge to main, do not delete branches or sweep worktrees. End your
turn at the gate.
EOF
}

consecutive_failures=0
for entry in "$@"; do
  IFS=: read -r fixture cond rep <<<"$entry"
  run_id="${fixture}-${cond}-${rep}"
  run_dir="$RUNS_DIR/$run_id"
  log "=== $run_id ==="

  cost_so_far=$(night_cost)
  if python3 -c "import sys; sys.exit(0 if float('$cost_so_far') > $COST_CEILING_USD else 1)"; then
    log "CAPACITY HALT: night cost \$$cost_so_far exceeds ceiling \$$COST_CEILING_USD - stopping queue"
    break
  fi

  if ! bash "$EVALS_DIR/scripts/prepare_run.sh" "$fixture" "$run_dir" >>"$LOG" 2>&1; then
    log "FAIL: prepare_run for $run_id"
    consecutive_failures=$((consecutive_failures + 1))
    [ "$consecutive_failures" -ge 2 ] && { log "ABORT: 2 consecutive failures"; break; }
    continue
  fi

  start=$(date +%s)
  ( cd "$run_dir" && claude -p "$(prompt_for "$cond")" \
      --output-format json --dangerously-skip-permissions \
      > "$run_dir/.headless-result.json" 2>>"$LOG" ) &
  run_pid=$!
  ( sleep "$RUN_TIMEOUT_S" && kill "$run_pid" 2>/dev/null && echo "TIMEOUT kill $run_id" >>"$LOG" ) &
  watchdog=$!
  wait "$run_pid"; run_rc=$?
  kill "$watchdog" 2>/dev/null
  wall=$(( $(date +%s) - start ))
  log "$run_id headless exit=$run_rc wall=${wall}s"

  if python3 "$EVALS_DIR/scripts/autoscore.py" "$fixture" "$run_dir" \
       --condition "$cond" --rep "$rep" --wall-clock-s "$wall" 2>>"$LOG" | tee -a "$LOG"; then
    consecutive_failures=0
    ( cd "$REPO_DIR" && git add evals/results && \
      git commit -qm "autoscore: $run_id (overnight queue)" ) >>"$LOG" 2>&1
  else
    log "FAIL: autoscore for $run_id"
    consecutive_failures=$((consecutive_failures + 1))
    [ "$consecutive_failures" -ge 2 ] && { log "ABORT: 2 consecutive failures"; break; }
  fi
done

log "queue finished; night cost \$$(night_cost). Attempting push."
( cd "$REPO_DIR" && git pull -q --rebase origin main && git push -q origin main ) >>"$LOG" 2>&1 \
  && log "pushed" || log "push failed - rows remain committed locally"
