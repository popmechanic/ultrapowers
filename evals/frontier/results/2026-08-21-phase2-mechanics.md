# Phase-2 mechanics re-run (spec §2d, plan Task 12) — 2026-08-21

Engine pinned at `main` (`19c4264`, the Phase-2 merge). Three cells, T15 rig
(`evals/ab_runner.py`), fold arm, new compiler. Rows in
`evals/results/runs.jsonl`; cell dirs under `evals/results/cells/`.

## Cells

| cell | fixture | wall | tokens | identity | gate |
|---|---|---|---|---|---|
| 20260821164250-contend-prod-B-fold | contend-prod | 1379.7s | 221,297 | fold: 0 write-after-write dag_edges, 1 contended wave route-away confirmed | **PASS** |
| 20260821170649-contend-big-B-fold | contend-big | 1585.0s | 271,059 | same | BLOCKED |
| 20260821173428-contend-big-B-fold (rerun-of 17:06 row) | contend-big | 1649.0s | 258,092 | same | BLOCKED |

## Hard gates on the machinery under test — green in all three cells

Arm identity (0 non-kept edges — the §2a kept vocabulary enforced by the
new `assert_arm_identity` check); contended wave routed to the fold path;
`selfChecks: ok` (shuffle + replay); **zero fallbacks** on the contended
wave; every park named (no parks occurred); resolver dispatches succeeded
(3 on contend-prod, 2 per contend-big attempt). First live exercise of the
Phase-2 plumbing, all correct:

- `autoResolved` reported by a live merge agent through the new
  `FOLD_SCHEMA` field and re-baked STEP wording (value 0 — correct; no
  fixture plan declares `Commutes:`).
- First production `composition-unpinned` rows, byte-exact to the pinned
  shape: `composition-unpinned: wave 1 app/registry.py — writers 1,2,3,4;
  undeclared: 1,2,3,4` (contend-prod); `… writers 2,3,4; undeclared: 2,3,4`
  (contend-big attempt 2). These discharge the three `deferred:runtime`
  gate acks of run-20260820221449.
- The auto-union itself did not fire live (no declared surfaces exist in
  the fixtures) — its coverage remains the 12 kernel tests incl. the
  weave-inertness pin; a live reading awaits the first naturally declared
  plan (canary, §2d sense passes).

## Deviation from the pre-registered §2d hard gates — operator-adjudicated

The §2d mechanics gate asks for the sealed exam green on the integrated
tree. contend-prod: green. **contend-big: red in both attempts** — one
fixture task per attempt failed `fix-loop-exhausted`, a *different* task
each time (attempt 1: task 4 audit-query; attempt 2: task 1
schema-validation), so that feature's exam tests failed. Post-mortems show
the same mechanism both times: most-capable reviewers mutation-tested the
fixture's own acceptance tests, found them non-discriminating (a tie-break
test whose fixture data is already alphabetical; six bare
`pytest.raises(ValueError)` sites where the spec demands the error name
the key), and refused sign-off; the fix cap exhausted arguing with the
frozen fixture. The merge seams were perfect in both attempts while the
failure moved between unrelated feature tasks — the signature of fixture
decay, not engine regression, and consistent with the recorded floor
drift on this fixture (25–35% in 5 days, 2026-08-19 revalidation).

**Operator decision (2026-08-21): release 0.2.17 on this evidence; file
the recalibration.** Filed as #187 (re-shape contend-big's tests to be
discriminating, re-verify floors per §1e, re-seal). Meta-finding recorded
there: calibrated fixtures decay against rising reviewer capability and
need recalibration on the same clock.

## Integration-spanning acceptance

This run is the multi-plan effort's integration acceptance (Phase-1
resolver + Phase-2 compiler on one tree): satisfied by contend-prod's full
PASS plus the machinery-green contend-big cells, with the exam deviation
adjudicated above.

## Planning-cost observation (§2d, non-gate)

Phase-2 plan: 6,006 words, authored in one session turn-block (single
authoring pass + one grammar fix; compiled PLAN OK first try after one
Files-label fix). Recorded against the Phase-1 baseline for the sense-pass
read; no gate attached.
