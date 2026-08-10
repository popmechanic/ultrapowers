# Docket tooling seams from the drain shakedown (#122) — design

**Date:** 2026-08-10
**Status:** trim-reviewed, awaiting operator review
**Acceptance:** suite
**Origin:** docket sweep (issue #122, accepted score 6.5). All three seams were
hit and worked around by hand during the 2026-08-07 drain; every future drain
re-hits them.

## Background

The 2026-08-07 drain (15 issues / 11 plans) surfaced three places where the
docket tooling forced improvisation:

1. **Acceptance grammar mismatch.** The planning sweep wrote `**Acceptance:**
   suite.` in 6 plans; `compile_plan`'s `ACCEPT_SUITE` requires
   `suite — <rationale>`. The drain normalized all six mechanically mid-run.
2. **`compile_docket` rejects PLAN-TOGETHER clusters.** Queued entries sharing
   a Plan path raise `duplicate Plan paths` — but the sweep deliberately
   produces shared-plan pairs (#117+#105, #113+#118, #103+#102, #111+#109).
   The drain hand-deduped by plan and re-derived score/collision logic.
3. **Drain mode leaves `wf-runs.json` empty.** Launch IDs are recorded by the
   Step-5 gate driver, which the drain bypasses by design; `ultra_gate.py
   --teardown` then reports `wfRuns: []` and the sweep set is reconstructed by
   hand.

## Design

### 1. Sweep guidance names the compiling Acceptance form (prose only)

The ultradocket SKILL.md sweep section (step 3, the plan step) gains one
sentence: plans written by the sweep must carry the exact compiling form
`**Acceptance:** suite — <one-line rationale>` (or the sealed/waived
equivalents), verified by invoking the existing `compile_plan.py --check` step
(the check lives in ultraplan's pipeline already — the sentence names the
grammar so it passes first time; trim review finding 1). The grammar itself is
eval-gated compiler vocabulary and is **not** widened. (Mechanism confirmed at
review: `**Acceptance:** suite.` falls through all three `compile_plan`
regexes to `mode: "missing"`.)

### 2. `compile_docket` learns PLAN-TOGETHER cluster semantics

The drain's hand-improvised dedup, promoted into the compiler:

- **Unit = unique Plan path.** Queued entries sharing a Plan path form one
  cluster; the `duplicate Plan paths` raise is deleted (it rejected a shape the
  sweep is designed to produce).
- A cluster's **score** is the max of its members' scores (rank by the
  strongest member — matches how the drain ordered).
- `order` stays a list of plan paths (unchanged shape, now deduped);
  collisions and the parallelism projection operate on units, as they
  effectively did.
- The result gains a `units` map: plan path → list of member issue ids, so the
  drain can advance every member entry together (`docket_lib.transition` per
  member at merge/park — the "entries advance together" rule the sweep already
  promises).
- **Member disagreement raises friendly** (trim review finding 3): cluster
  members must agree on `Engine` (the drain dispatches one executor per unit)
  and, for sealed clusters, on `Seal`; a disagreeing cluster raises a friendly
  error naming the members — the one genuinely malformed cluster shape.
- The existing per-entry checks (missing Plan, sealed entry missing Seal) are
  untouched and run before unitization — they are regression-covered, not new
  cluster semantics (trim review finding 2).
- **Accepted loss, recorded** (trim review finding 4): the deleted
  `duplicate Plan paths` raise also caught accidental copy-paste duplicates;
  after this change an accident is indistinguishable from a deliberate
  PLAN-TOGETHER pair and silently clusters. Accepted: the sweep writes Plan
  paths mechanically, and a wrongly-clustered pair still advances together
  through the same gate rather than corrupting anything.

### 3. Drain-mode launch-ID recording (derive the sweep set)

`ultra_gate.py` (frozen) already *reads* `run-<stamp>/wf-runs.json` at teardown
and approve. The gap is only that nothing *writes* it when the drain launches
directly. Fix on the unfrozen side:

- New helper `skills/ultradocket/scripts/record_wf_run.py <stamp> <wf_runId>`:
  creates/merges `run-<stamp>/wf-runs.json`. Shape is pinned (trim review
  finding 6): a **bare JSON array of run-id strings, sorted, no wrapping key**
  — exactly what the frozen `ultra_gate.load_wf_runs` parses and
  `record_wf_runs` writes. To make shape drift impossible by construction, the
  helper **imports** `load_wf_runs`/`record_wf_runs` from the frozen
  `ultra_gate` module rather than reimplementing them (reading a frozen module
  is free; trim review finding 8). Idempotent: recording the same ID twice is
  a no-op.
- Coordinates pinned (trim review finding 7): `<stamp>` is the drain's
  **run-lock stamp** (one per drain, not per entry), and the run dir resolves
  as `<git rev-parse --show-toplevel>/.claude/ultrapowers/run-<stamp>/` —
  exactly the frozen reader's resolution, never cwd-relative.
- The ultradocket SKILL.md drain section (step 2, the `ultrapowers` engine
  branch) gains one sentence: immediately after each Workflow launch, record
  the runtime ID with `record_wf_run.py`. Teardown and approve then derive the
  sweep set exactly as in single-run mode — no frozen file is touched.

## Non-goals

- No change to `compile_plan.py`'s Acceptance grammar (`ACCEPT_SUITE` stays).
- No change to frozen `ultra_gate.py` / `gate_check.py` / `run_lock.sh`.
- No drain-loop state machine changes beyond the two SKILL sentences; the
  cluster advance rule already exists in prose ("entries advance together") —
  part 2 gives it the compiler shape it needs.

## Tests (pytest)

`tests/test_compile_docket.py`:
1. Two queued entries sharing a Plan → one unit, order deduped, `units` maps
   the plan to both issue ids, score = max.
2. Cluster collision: a cluster and a disjoint plan sharing a write path →
   collision reported once, on the plan pair.
3. Sealed cluster with one member missing Seal → friendly raise naming it
   (regression coverage of the existing pre-unitization check, not new
   semantics).
4. Cluster members disagreeing on `Engine` → friendly raise naming the members.
5. Single-entry behavior byte-identical to today (regression).

`tests/test_record_wf_run.py` (new, small):
6. Fresh stamp → file created with the ID; second call same ID → no dup;
   second call new ID → appended. The assertion **round-trips through the
   frozen `ultra_gate.load_wf_runs`** (never a hand-written shape assumption).

## Acceptance

`suite` — self-contained dev tooling (scripts + tests + SKILL prose); the
committed pytest suite is the verification.

## Complexity accounting

`complexityEffect: structural` overall — part 2 deletes a raise and promotes an
improvised dedup into the compiler's own semantics; part 3 fills a read-side
contract that already exists (the reviewer noted part 3 is more precisely a
gap-filling additive helper — accepted nuance); part 1 is one sentence of
authoring guidance. One new small script (`record_wf_run.py`) whose entire job
is calling the frozen module's own read/write functions.

## Trim review

**Author disclosure (Adds/Removes):** Adds — cluster/unit semantics + `units`
key in `compile_docket`, `record_wf_run.py`, two SKILL sentences, tests.
Removes — the `duplicate Plan paths` raise, the drain's two hand-improvised
procedures (plan dedup, sweep-set reconstruction).

**Reviewer verdicts** (fresh-context dispatch; grounded in issue #122,
`compile_docket.py`, `docket_lib.py`, ultradocket SKILL.md, and the frozen
`ultra_gate.py` reader spans):

1. Sweep grammar sentence — OK; one-word calibration (the sweep *invokes* the
   existing `--check`, which lives in ultraplan's pipeline). → **Adopted**.
2. Sealed-cluster bullet restates the existing pre-unitization `no_seal` check
   — **TRIM**. → **Adopted**: reframed (with its test) as regression coverage,
   not new cluster semantics.
3. Cluster member disagreement on `Engine`/`Seal` undefined —
   **UNDERSPECIFIED**. → **Adopted**: friendly raise naming the members.
4. Deleted raise loses accidental-duplicate detection — OK with unacknowledged
   loss. → **Adopted**: loss recorded as accepted, with rationale.
5. `units` semantics vs the drain's real advance logic — OK (verified against
   the drain's transition path).
6. Test 5's "same key it consumes" implies a keyed object; the frozen reader
   parses a **bare sorted string array** — **UNDERSPECIFIED** (wording
   landmine). → **Adopted**: exact shape named in the spec; the test
   round-trips through `ultra_gate.load_wf_runs`.
7. Stamp identity and run-dir resolution unstated — **UNDERSPECIFIED**. →
   **Adopted**: run-lock stamp, `git rev-parse --show-toplevel` resolution.
8. Import the frozen module's read/merge instead of reimplementing —
   suggestion. → **Adopted** (drift impossible by construction).
9. Scope — OK: no expansion beyond the issue's three seams.

**Reviewer grade:** `netConceptDelta: flat` — additions and deletions offset,
"provided findings 2 and 6 are adopted"; both were.
