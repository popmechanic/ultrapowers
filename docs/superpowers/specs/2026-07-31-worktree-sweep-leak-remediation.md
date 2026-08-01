# Worktree-sweep leak remediation

**Date:** 2026-07-31
**Origin:** field post-mortem from vibes.diy — ~32 GB of engine exhaust in
`.claude/worktrees/`, forensically attributed per run. The operator handed a
four-requirement work order ("decide implementation yourself; these are the
requirements"). This spec is the implementation decision record.

**Freeze note:** `ultra_gate.py` sits in the frozen verification periphery
(CLAUDE.md, 0.1.0). This change is explicitly authorized by the operator's
work order, which names the file (requirement 1) and rests on measured field
data, not an incident narrative alone. Scope is confined to sweep/janitor
bookkeeping: gate checks, acceptance administration, and verdict logic are
untouched. `run_lock.sh` and `gate_check.py` are not modified.

## The failure class

The engine mints IDs in two schemes — the operator-chosen **stamp**
(`20260702-150227`, names the lock + integration worktree `wf_<stamp>-…`) and
the runtime **wf_runId** per Workflow invocation (`wf_1d170a73-a62`, names
task worktrees `wf_<runId>-<n>`). A resumed run (Salvage/Redirect) mints a
**new** wf_runId per relaunch. Cleanup coverage was assembled by the
orchestrating model threading each ID into individual sweep calls; any ID it
never threads is a silent multi-GB leak, because:

1. a scoped sweep says nothing about non-matching `wf_*` dirs it left behind
   (Finding 1, ~23 GB);
2. unmerged `worktree-wf_*` branches are "kept for inspection" with nothing
   that ever re-surfaces them (Finding 2);
3. terminal teardown keeps worktrees as triage evidence and relies on the
   operator remembering the removal commands (Finding 3);
4. a stale RUN_LOCK silently scopes even an intended repo-wide sweep down to
   one run (observed hazard).

## Design

### R1 — approve sweeps every run ID the pipeline ever minted

**Derive, don't record-by-hand.** The gate driver already saves each launch's
report verbatim; `result.tasks[].branch` carries `worktree-wf_<runId>-<n>` for
that launch. So:

- **Gate mode** (`ultra_gate.py --result …`): after unwrapping the report,
  extract the set of wf run IDs from `tasks[].branch` (pattern
  `^worktree-(wf_[0-9a-f]{8}-[0-9a-z]{3})-`; non-matching branches are
  skipped, never fatal) and union them into `run-<stamp>/wf-runs.json` (a
  sorted JSON list). Every relaunch reaches the gate again, so the file
  accumulates the union across all launches with no orchestrator threading.
  The receipt echoes the file (`wfRuns`).
- **Approve mode** (`--approve`): sweep once per ID in the union of
  `wf-runs.json` ∪ `{--wf-run}` (kept as belt/back-compat) ∪ `{wf_<stamp>}`
  (the dedicated integration worktree). `swept` in the approve receipt becomes
  a map `id → summary line`. One gate call, total coverage.

### R2 — the sweep accounts for what it did NOT remove

After its removal pass, `sweep_worktrees.sh` always enumerates **all**
remaining `.claude/worktrees/wf_*` entries (repo-wide, regardless of scope)
and prints one line per leftover — path, size (`du`), age in days (mtime),
`locked` marker — plus a totals line naming the flags that would remove them.
Silent only when nothing remains. Exit code unchanged (reporting, not
failure); a live locked run is *reported*, not treated as an error.

### R3 — janitor path + stale-RUN_LOCK scoping fix

- `sweep_worktrees.sh --audit`: report-only. Flags orphan `wf_*` worktrees
  and stale `worktree-wf_*` branches whose run ID does not match the current
  RUN_LOCK (the live run is exempt), guarded by age (`--age-hours`, default
  24) so freshly-kept triage evidence isn't nagged immediately. Removes
  nothing; exit 0.
- **Surfacing without operator memory:** `ultra_run.py` preflight runs the
  audit as a non-blocking advisory — findings land in the receipt (stage
  detail) and stdout, so the *next* run surfaces the previous run's
  leftovers. Never blocks a launch.
- **Stale-RUN_LOCK trap:** new `--all` flag = explicit repo-wide sweep that
  ignores the RUNID/RUN_LOCK fallback. When scope is inherited from RUN_LOCK
  (no `--run`/`RUNID` given), the sweep says so loudly and points at `--all`.
  Legacy no-arg behavior otherwise unchanged.

### R4 — docs (SKILL.md)

- Approve bullet: one `ultra_gate.py --approve` call performs the full sweep
  set (all recorded wf run IDs + `wf_<stamp>`); the separate manual
  `sweep_worktrees.sh --run wf_<stamp>` call is deleted from the ritual.
- Plain statement: a manual-merge wrap-up (any path bypassing
  `ultra_gate.py`) must still perform the full sweep set —
  `sweep_worktrees.sh --all` once no other run is live — and `bootstrapCmd`
  makes every leaked worktree a multi-GB leak.
- Teardown bullet: name `--audit` and note the next run's preflight
  re-surfaces kept evidence.

## Acceptance

`suite` disposition. New/updated pytest coverage in `test_sweep_worktrees.py`
(leftover accounting, `--all`, RUN_LOCK-fallback notice, `--audit` semantics),
`test_ultra_gate.py` (wf-runs.json derivation + union across gate calls;
approve sweeps recorded IDs + stamp in a real repo), `test_ultra_run.py`
(advisory audit stage present, non-blocking). No harness JS touched, so no
`.mjs` sim obligations.
