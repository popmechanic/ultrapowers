# Docket suite-disposition path

_Spec — 2026-06-30. Status: approved design, awaiting implementation plan._

Surfaced by the first live `/ultradocket plan → run` shakedown against ultrapowers's
own open issues. The triage and gate worked; the drain could not build any entry.

## Problem

The build drain (`/ultradocket run`) is **seal-only** end to end. Two load-bearing
pieces assume every queued plan carries a held-out sealed exam:

1. **`compile_docket.py`** (the drain's first step) raises if *any* `queued` entry
   lacks a `Seal`:

   ```python
   no_seal = [e.issue for e in entries if not e.seal]
   if no_seal:
       raise ValueError(f"queued docket entries missing a Seal: {no_seal}")
   ```

2. **Drain step 3** (the correctness gate) is exclusively
   `run_acceptance.sh <sealId> <branch> <sha256>` — it administers a *sealed* exam
   keyed by seal-id.

But a `**Acceptance:** suite` plan deliberately authors **no held-out exam**
(`ultraplan/SKILL.md`: "building ultrapowers itself → suite"; "the engine binds
acceptance to the committed test result, `acceptance.passed === tests.passed`").
So a suite plan never produces a seal. It can therefore neither be `queued`
(rejected by #1) nor gated (no seal for #2).

**Confirmed live.** A queue containing one suite (seal-less) entry makes
`compile_docket` raise `ValueError: queued docket entries missing a Seal` and exit
1 with a raw traceback. The blast radius is the **whole queue**: the seal check
fans across all queued entries and raises before computing any order, so a single
suite entry blocks every *sealed* entry from draining too. A control with only the
sealed entry compiles cleanly — proving the seal-less entry is the poison.

ultrapowers's own backlog is **100% suite-disposition** (engine/skill/doc work, no
held-out exam). Pointed at itself, the docket can triage and plan, but cannot drain.

## Goals

- The drain builds `suite`-disposition plans, gated by a **deterministic,
  exit-code-authority** check it cannot game — preserving the safety guarantee
  ("nothing reaches the integration line or `main` without clearing a check it
  can't touch").
- The existing **sealed** path is byte-for-byte unchanged.
- No new persisted state, no new docket field. The plan's `**Acceptance:**` line
  is the single source of truth.

## Non-goals (v2 seams)

- Plan-declared suite command (v1 runs the repo's documented gate).
- Bounded autonomous salvage on red (v1 stays red → park).
- A non-trivial `waived` auto-merge policy (v1 parks waived for the operator).

## Design

`suite` becomes a first-class drain disposition. Disposition authority is the
**plan**, read from the `acceptance.mode` that `compile_plan` already emits — no
new docket field, no extra compile cost. Three surgical touch points.

### 1. `compile_docket.py` — compile-then-validate

Today the seal check runs *before* writes are resolved. Reorder to resolve each
queued plan **once** up front, capturing both `writes` **and** `acceptance.mode`
from the single `compile_plan` invocation already made, then validate per-entry:

| `acceptance.mode` | requirement |
|---|---|
| `sealed`  | must carry a `Seal` (today's rule, now *scoped to sealed*) |
| `suite`   | **legal without a Seal** |
| `waived`  | legal without a Seal; flagged for operator park at the gate |
| missing / uncompilable plan | friendly per-entry park reason, naming the plan |

Making the check per-entry (not a blanket pre-raise) also removes the raw-traceback
failure: every rejection becomes a named, friendly park reason, matching the prose's
"Never surface a raw stack trace" guarantee.

`plan_writes` grows to return `(writes, mode)` (or a small dataclass); its single
`compile_plan` subprocess already carries `acceptance` in its JSON.

### 2. Drain step 3 — branch the correctness gate on disposition

The drain reads each entry's disposition (from the compiled plan) and dispatches:

- **`sealed`** → `run_acceptance.sh <sealId> <branch> <sha256>` — unchanged.
- **`suite`** → the **committed-suite gate**: run the repo's documented test gate
  (`python3 -m pytest`, `pytest.ini`-scoped) on the plan's branch, in a **detached
  worktree**, exit-code authority. It emits the **same JSON contract** as
  `run_acceptance.sh` (`{status, passed, exitCode, output, redKind?}`, `sealId`
  rendered as `(suite)`), so step-4 merge-or-park is **byte-for-byte unchanged**:
  exit 0 ⇒ merge into the docket integration line and advance `queued → executed`;
  non-zero ⇒ park with the failure as the reason.
- **`waived`** → **park for the operator** at the end gate (never auto-merge
  unverified work). Specified so the drain is total over all three dispositions,
  though this backlog never hits it.

The committed-suite gate is implemented as a **new mode of `run_acceptance.sh`**,
which already runs a suite-in-a-worktree (`--baseline --suite DIR --branch BASE
--run CMD`). A `--suite-gate --branch B [--run CMD]` mode reuses that
worktree/bootstrap/emit machinery, defaulting `--run` to `python3 -m pytest`.
(Alternative considered: a sibling `run_suite_gate.sh`. Rejected for v1 — the
machinery and JSON contract already live in `run_acceptance.sh`; one runner is the
simpler, less-drift-prone choice.)

### 3. Sweep step 5 — write-back without a seal for suite plans

Disposition is decided at planning time (the `**Acceptance:**` line the sealing
step already chooses). The sweep's write-back becomes disposition-aware:

- **`sealed`** → issue the seal, then advance `planned → queued` (today's flow).
- **`suite`** → advance `accepted → planned → queued` directly, **no seal** — the
  entry carries `Plan` + `Engine`, no `Seal`.
- The prose's "if *sealing* fails → entry stays `planned`" is clarified to apply
  **only to the `sealed` disposition**; suite and waived never seal, so they are
  not "sealing failures" and are not stranded at `planned`.

## Safety argument

The merge keys stay on the deterministic side. Nothing reaches the docket
integration line or `main` without clearing a deterministic, exit-code gate the
non-deterministic executor cannot touch — now **"sealed exam *or* committed
suite,"** with `waived` parked for explicit operator disposition. The single
pre-merge end gate is unchanged; suite entries present their `pytest` runner JSON
as evidence exactly where sealed entries present theirs.

## Testing

Mirror the existing seal coverage in `tests/test_compile_docket.py`:

- a `suite` (seal-less) `queued` entry now **compiles** — inverts
  `test_queued_entry_without_seal_fails_loud` into a `sealed`-only assertion;
- a `sealed` entry without a `Seal` **still fails loud**;
- a mixed `sealed` + `suite` queue compiles, order is score-descending;
- `compile_docket` reads `acceptance.mode` from the real compiler over real plans.

Drift pins for the `ultradocket/SKILL.md` prose changes (steps 3 and 5), consistent
with `tests/test_no_prompt_drift.py` / `test_recommendation_rubric.py` conventions.

## Compatibility

The sealed flow is untouched. The one behavioral change to an existing test is
intentional: `test_queued_entry_without_seal_fails_loud` is re-scoped to assert the
loud failure for **sealed** entries only.

## Disposition (this is itself suite work)

`**Acceptance:** suite` — this is ultrapowers's own engine/skill change; the
committed `pytest` suite + the new tests + drift pins + adversarial review are the
verification. Note the bootstrap: this plan cannot be built *by* the drain (the
suite path does not exist yet), so it is built via the normal single-feature
`/ultrapowers` flow; once landed, the drain handles suite plans thereafter.
