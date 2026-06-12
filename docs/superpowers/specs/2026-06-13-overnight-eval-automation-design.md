# Overnight eval automation — design

**Date:** 2026-06-13 (approved by Marcus in-session)
**Goal:** run the remaining eval-matrix cells unattended overnight, removing the
human from launch, gate approval, usage capture, and scoring. Tonight's scope:
the 9 remaining B-condition runs. The same machinery runs the C cells next week;
condition A (serial executor) automation is deferred.

## Approved protocol amendments

1. **Scripted gates.** Headless runs receive standing answers up front: approve
   the wave plan exactly as proposed (condition B; condition C additionally
   revises `tierOverrides: {cheap:'opus', standard:'opus'}`), and stop at the
   pre-merge gate without merging or finishing the branch. Approval content is
   identical to the human-gated rep-1 runs; every automated row is tagged
   `automated headless run` in notes. Mixed human/auto gating across reps of a
   cell is accepted and documented.
2. **Per-run weekly-% replaced by token accounting.** `weekly_pct` is null on
   automated rows; cost comes from `extract_tokens.py` (validated to the cent
   against the Claude Code client display). The operator takes one `/usage`
   snapshot before bed and one in the morning; the batch delta cross-checks
   the summed per-run estimates.

## Components

### `evals/scripts/autoscore.py`
Mechanical replacement for the hand-scoring done on reps 1. Given
`fixture run_dir --condition --rep --wall-clock-s N`:
- finds the integration branch (`git branch --list 'ultra/integration-*'`);
  fails loudly if absent (run incomplete);
- computes cost by harvesting every transcript file under the run's
  project dirs (`~/.claude/projects/-private-tmp-eval-runs-<id>*`, which
  covers worktree-split continuations), deduplicated, using the
  `extract_tokens` accounting;
- parses `fixIterations` / task statuses from the workflow result in the
  transcript → `--fix-rounds` (sum) and `--blocked-tasks` (non-done count);
  defaults to 0 with a note if no result summary is found;
- delegates the actual scoring/diff capture to the existing `score_run.py`
  (unchanged), passing auto-generated notes.

### `evals/scripts/night_runner.sh`
Serial queue. Usage: `night_runner.sh <fixture>:<cond>:<rep> ...`
Per entry: `prepare_run.sh` → `claude -p` headless in the run dir
(`--output-format json --dangerously-skip-permissions`), with the fixed
gate-answer prompt → process exit defines the gate moment (wall clock =
process duration, includes ~10s CLI startup; acceptable) → `autoscore.py` →
`git commit` of the scored row. One `pull --rebase && push` at the end.

Guards:
- **Capacity ceiling:** halt the queue when the night's cumulative extracted
  cost exceeds $70 (≈ 9–10 weekly points; 87% + that ≈ 96%).
- **Per-run timeout:** 45 min via a bash watchdog (macOS has no GNU
  `timeout`), then kill and continue.
- **Two consecutive failures abort the queue** (one failure logs and skips —
  reps provide redundancy; two in a row implies systemic breakage).

Log: `/tmp/eval-runs/night-runner.log`. Launch wrapped in `caffeinate -i` so
the Mac cannot sleep mid-queue.

### README amendment
Short "Automated execution" subsection under the Protocol recording both
amendments.

## Tonight's queue

Smoke run first, watched live: `chained:B:1` — verifies the two assumptions
that need verification, not faith: gate behavior under `claude -p`, and the
headless JSON output shape. If its scored row matches the shape of today's
hand-scored rows, launch the remaining queue:
`chained:B:2 chained:B:3 degrade:B:2 degrade:B:3 wide:B:2 wide:B:3 mixed:B:2 mixed:B:3`.

## Error handling
- Failed run (nonzero exit, no integration branch, score failure): logged,
  skipped, counted toward the consecutive-failure abort.
- Push failure at end of night: rows stay committed locally; reconciled in the
  morning session.

## Morning wrap (operator: one screenshot)
Operator sends the morning `/usage` snapshot; the session reconciles the batch
weekly-delta against summed per-run costs, regenerates `report.py`, pushes
anything unpushed. No new judgable pairs are created tonight (judging needs
rep-matched cross-condition pairs; A/C reps don't exist yet).

## Out of scope
- Condition A headless automation (different executor invocation; design when
  the A cells are scheduled).
- Parallel execution (would contaminate the wall-clock metric via contention).
- Automated judging of new pairs (none are created tonight).
