# A/B: reviewer routing keyed on SIBLING FILES (#285 + #245)

Spec: `docs/superpowers/specs/2026-08-26-reviewer-routing-sibling-files.md`
(adoption gate + instrument precondition defined there). Arms: **A** = main
`c758831` (0.2.22 routing: "route by blast radius … when in doubt, gate");
**B** = `claw/routing-285` (mechanical two-condition routing on SIBLING
FILES). Instrument: `evals/fixtures/flawed-routing` (class-2 seed: FIELDS
insertion order, own-file fix, downstream consumers; class-1 seed: wire
version 1-vs-2 spanning serialize.py and sibling-owned store.py). One cell
per arm plus two arm-B regression cells, run serially via `ab_runner.py`.

## Cells

| Cell | Fixture | Arm | Wall | Out-tokens | Gate | Sealed acceptance |
|------|---------|-----|------|-----------|------|-------------------|
| 20260827033055-flawed-routing-A-serialize | flawed-routing | A (`c758831`) | 888 s | 82,907 | **BLOCKED** | **3 failed** / 1 passed |
| 20260827034634-flawed-routing-B-serialize | flawed-routing | B (`claw/routing-285` @ `f8fdaa1`) | 1,205 s | 132,708 | **PASS** (all checks) | **4/4 passed** |
| 20260827040951-contend-B-serialize | contend | B | 612 s | 48,722 | **PASS** (identity valid: 3 waw edges) | 7/7 passed |
| 20260827042018-mixed-B-serialize | mixed | B | 854 s | 72,005 | **PASS** (all checks; 6/6 tasks clean) | 7/7 passed |

The flawed-routing rows and the mixed row carry `invalid: arm-identity` — the Task-12
serialize-identity gate expects ≥2 write-after-write edges and these fixtures
seed none (flawed-routing: disjoint files by design; mixed: no contention). The identity check is inapplicable to
this instrument, not a cell failure; recorded per protocol.

## Per-seed routing outcomes (the adoption metrics)

**Class-2 seed (FIELDS order — own-file interface defect, consumers downstream):**

- **Arm A:** Task 1 reviewer CONFIRMED the defect (probe-level detail in its
  notes), kept severity `minor` ("cross-task interface surface" under the old
  rule), `fixIterations: 0` — the defect merged, the completeness critic
  blocked ("NOT READY TO MERGE — 2 blocking plan-requirement violations"),
  the sealed acceptance failed 3 tests at the gate, pre-merge verdict
  **BLOCKED**. A full redirect round is owed. **Mis-route reproduced —
  instrument precondition met.**
- **Arm B:** Task 1 resolved in-wave (`reviewVerdict: fixed`,
  `fixIterations: 1`), integrated tree carries `FIELDS = {"name": str,
  "email": str}`, acceptance's order tests green. **No redirect owed.**

**Class-1 seed (wire version spans serialize.py + sibling-owned store.py):**

- **Arm A:** Task 3's implementer applied the own-file half (v: 2, disclosed
  `plan-defect:`); store.py stayed 1 (fence respected); the disagreement
  surfaced at the gate as a critic blocker. Zero cross-sibling edits, zero
  `blocked-after-fix`.
- **Arm B — both new conditions exercised verbatim:** Task 3's reviewer:
  "Applying the fix would require editing apistub/store.py, a SIBLING FILES
  path owned by Task 4, so this is reported minor to route to the pre-merge
  gate rather than blocking here" — **condition (1) fired, minor→gate**.
  Task 4's reviewer routed its cross-file-agreement test gap to the gate as
  "observable only with two merged branches present" — **condition (2)
  fired**. Task 4's implementer separately corrected its own-file constant
  (task-local, disclosed, lawful under the unchanged implementer line).
  Zero cross-sibling edits, zero `blocked-after-fix`, no over-promotion.

**Counters (both discriminating cells):** fix-loop exhaustions 0;
`blocked-after-fix` 0; falseBlocks 0. Arm B's in-cell cost is higher
(+37% wall, +60% out-tokens — the fix rounds run inside the wave), which is
the priced trade: arm A still owes a full redirect round (~155k out-tokens/
round observed in prior distills), a critic re-run, a fresh gate, and an
operator turn that arm B does not.

## Adoption gate (spec) — verdict

1. Arm B resolves class-2 in the fix loop where arm A routes it to the gate — **MET**.
2. Class-1 routes `minor` directly with zero `blocked-after-fix` — **MET in
   arm B** (conditions (1) and (2) both cited by name); arm A gated it via
   the critic. No mis-promotion observed in either arm.
3. No fix-loop exhaustions — **MET** (0 in both cells).
4. Regression cells green on their own gates — **MET** (contend: gate PASS,
   identity valid, 0 fix iterations, sealed 7/7; mixed: gate PASS, 6/6 tasks
   clean, sealed 7/7; zero exhaustions, zero blocked-after-fix, zero
   falseBlocks in both).

**VERDICT: ADOPT.** All four clauses met; the branch merges. The routing
replacement demonstrably converts the class-2 mis-route (arm A: gate BLOCKED,
acceptance 3-red, redirect owed) into an in-wave fix-loop resolution (arm B:
gate PASS, acceptance 4/4) while both new gate-routing conditions were
exercised by name and the sibling fence held everywhere.

## Notes for the record

- One run per arm (plus regressions); reviewer behavior is stochastic. The
  spec's re-run allowance was not needed: arm A reproduced the mis-route and
  arm B exercised both routing conditions on the first run of each.
- The implementers in both arms occasionally pre-fixed task-local halves of
  the seeds under disclosed `plan-defect:` divergences — lawful under the
  (unchanged) implementer line, and it did not blunt the instrument: the
  routing-relevant findings still formed and routed per-arm as predicted.
- Known residual (recorded in the spec, watch-item): downstream-owned files
  are covered by neither condition; the deleted "when in doubt, gate" was
  their only (unreliable) catch. Dual creation still conflicts at wave merge.
