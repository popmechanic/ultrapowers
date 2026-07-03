# Deterministic driver — collapse the orchestrator choreography into two entry points

**Date:** 2026-07-03
**Origin:** 2026-07-03 ultralearn distill (18 runs, 238 findings) + the operator's
fragility critique: edge-case-responsive guards accrete complexity; the fix is to
shrink the surface where edge cases breed, not to guard each one.
**Acceptance:** suite

## Problem

The engine (`waves.js`) barely fails in the field. The friction lives in the
choreography around it: SKILL.md Steps 1–4b and Step 5's mechanics are prose
rituals re-derived every session by an LLM — the least deterministic executor
available. Ledger classes caused by exactly this, all observed through engine
0.0.30:

- **Two-id dance** — lock acquired under a provisional stamp, engine mints
  `wf_<runId>`, four separate runs re-derived the reconciliation from source
  and one diverged.
- **Launch-args schema guessing** — per-task tier placement is undiscoverable
  from `--emit-args`; the identical two-bounce launch rejection occurred in
  three runs (0.0.29–0.0.30).
- **Envelope rediscovery** — gate fields live under `result.*` in the Workflow
  tool's wrapper; four-plus runs probed the top level first and saw nulls at
  the single most consequential decision point.
- **Mislocated/mis-sequenced gate mechanics** — a wrong-cwd `gate_check`
  produced a spurious BLOCKED; stale-lock leftovers from aborted runs blocked
  later launches because release-on-every-terminal-path is a prose rule.
- **Pre-existing dirt stash dances** — the clean-tree gate check cannot tell
  operator dirt that predates the run from a worktree-discipline violation;
  orchestrators improvise stash/restore choreography every time (and the check's
  message falsely accuses agents).

Each of these could be patched with another prose rule or guard. That is the
accretion spiral. The structural fix: make the deterministic parts *actually
deterministic* — scripts, not prose — and leave the LLM only the judgment calls.

## Design

Two entry points, both emitting a single JSON receipt with an authoritative exit
code. Both orchestrate the existing scripts (`compile_plan.py`, `run_lock.sh`,
`gate_check.py`, `run_acceptance.sh`, `sweep_worktrees.sh`) — they replace the
*choreography*, not the pieces.

### `ultra_run.py <plan> [--stamp <stamp>]` — pre-launch driver

One invocation performs, in order, fail-closed (non-zero exit names the failing
stage):

1. **Preflights** — self-host engine skew (when applicable), superpowers
   compatibility, "inside a git repository" check, and a **worktree-capability
   probe** (`git worktree add --detach` to a temp path, then remove) so a
   session that cannot cut worktrees fails here for pennies instead of after a
   full launch (a sev-3 total-failure class in the ledger).
2. **Compile** — invokes the compiler with `--emit-launch`/`--emit-args` to
   canonical paths under `.claude/ultrapowers/run-<stamp>/`.
3. **Install** — the idempotent committed-workflow copy (Step 4a's loop).
4. **Lock + snapshot** — `run_lock.sh acquire <stamp>` + `snapshot`. **The stamp
   is the lock id for the whole run**; `wf_<runId>` is used only for worktree
   sweeps. The snapshot additionally records `git status --porcelain` so the
   gate can distinguish pre-existing dirt from new dirt.
5. **Deterministic knob derivation** — `baseBranch` (from
   `git symbolic-ref`), plus the probe payload and its expected assertions
   (`echoWaves`, `echoFirstId`), pre-computed into the receipt.

**Receipt** (`run-<stamp>/receipt.json` + stdout): preflight results, the
compile transparency object (waves, edges, conflicts by kind, labels,
acceptance disposition, dispositions), paths to the launch file and args
skeleton, the derived `baseBranch`, the probe payload/assertions, and an
explicit `llmDerives` list naming exactly what the orchestrator still owns:
per-task `tier` (slots pre-emitted as `"tier": null` on each task in the launch
file — closing the schema-guessing class at the source), `testCmd`,
`bootstrapCmd`, review-depth overrides.

The LLM then: judges `heuristic: true` dispositions, fills the tier slots,
renders Step 3, launches the probe and the saved workflow via the Workflow tool
(only the LLM can call tools), passing the receipt's skeleton with its knobs
merged.

### `ultra_gate.py --stamp <stamp> --result <path>` — gate driver (grows `gate_check.py`'s role)

Takes the **raw Workflow tool result** (envelope and all). One invocation:

1. **Restore** — `run_lock.sh restore` (checkout back to the pre-launch
   snapshot).
2. **Unwrap** — extracts `result.*` from the envelope itself; the LLM never
   parses the envelope again. Saves the report verbatim to
   `run-<stamp>/report.json`.
3. **Gate checks** — the existing `gate_check.py` battery, with two changes:
   the clean-tree check compares against the snapshot's recorded dirty set and
   blocks only on **new** dirt (pre-existing operator files pass through with a
   note, and the failure message stops accusing agents for dirt that predates
   the run); every receipt echoes the resolved repo root and lock path so a
   wrong-cwd invocation is self-diagnosing.
4. **Acceptance** — administers per disposition (sealed / suite-gate / waived),
   read from the compile receipt persisted at `ultra_run` time; exit code is
   the authority, JSON rendered verbatim.

**Receipt**: verdict `PASS` (exit 0) / `NEEDS_ACK` (2) / `BLOCKED` (1),
per-check results, acceptance result, and render-ready data. The LLM renders
the report per `report-format.md`, presents Approve/Salvage/Redirect, and owns
those decisions.

Two subcommands close the terminal-path classes:

- `ultra_gate.py --approve --stamp <stamp>` — checkout integration branch,
  `sweep_worktrees.sh --run <wf-runId>`, `run_lock.sh release <stamp>`.
- `ultra_gate.py --teardown --stamp <stamp>` — release the lock, keep worktrees
  as triage evidence (prints the sweep command). Every non-relaunch exit runs
  this, so stale locks stop wedging the next run.

## What stays with the LLM (unchanged by design)

Marker judgment on heuristic dispositions; per-task tier and review-depth
derivation; the Step-3 transparency render; Workflow/probe tool calls; gate
presentation and the Approve/Salvage/Redirect decision; Salvage/Redirect wave
construction; the fallback route. The drivers prepare and verify — they never
decide.

## SKILL.md consequence

Steps 1, 2 (mechanics), 4a, 4a½ (prep), 4b collapse to "run `ultra_run.py`,
read the receipt"; Step 5.1–5.4 collapse to "run `ultra_gate.py`, read the
receipt". The prose that remains is judgment guidance. **The standing-concepts
ratchet must go DOWN**: `skillWords` and `skillSteps` decrease; `lockVerbs`,
`gateChecks` may move but `standingConcepts` must not exceed 62 (current
baseline).

## Out of scope (tracked separately)

- Integration-in-a-dedicated-worktree (#84) — would delete snapshot/restore
  outright; this spec's snapshot-dirt-baseline work is compatible interim.
- Plan-grammar narrowing / authoring-time validation (#85).
- Spec-pins-contract exam rule (#86).
- Review-depth heuristic deletion evaluation (#87).
- Any change to `waves.js` behavior.

## Acceptance

`suite` — pytest covers: each `ultra_run` stage fail-closed (bad plan, missing
git repo, worktree-incapable dir, lock held); receipt shape and `llmDerives`
completeness; tier slots present in the emitted launch file; `ultra_gate`
envelope unwrap (top-level nulls + nested `result`), new-dirt-only clean-tree
logic (pre-existing dirt passes, new dirt blocks), acceptance dispatch per
disposition, `--approve`/`--teardown` lock lifecycle. The SKILL.md re-layer is
pinned by the existing validate_skill + ratchet (concepts non-increasing,
`skillWords` decreasing).
