# Fold vs serialize at width 8 — the measurement 0.3.0 still owed

**Status:** pre-registered protocol. Predictions committed BEFORE either cell ran
(sitting 2 of the merge-frontier sprint; #360's Amendment-9 comment names this the
standing measurement owed by 0.3.0). The 2026-08-30 A/B re-established fold's advantage
on the One Driver engine, but its widest contended wave was **4** (`contend-big`);
measured dispatch width is flat to 12 and the default is 8 (`2026-08-28-wave-width.md`).
Whether same-file overlap pays **at width 8** has never been measured. This is that cell.

## Method

- **Fixture:** `evals/fixtures/contend-wide` — eight independent implementation tasks all
  editing `clitool/cli.py` (own parser line, own helper, own line in `main`), suite
  acceptance. Compiled arm identity verified before running: fold = **1 wave of 8**,
  serialize = **8 single-task waves**.
- **Rig:** `evals/ab_runner.py`, both arms, serial, local (laptop subscription), same as
  the 2026-08-30 twelve-cell run. Engine ref = current main. Rows append to
  `evals/results/runs.jsonl`.
- **Order:** runs AFTER the #454 concurrent-drain arms, so the `/usage` reads of that
  measurement are not contaminated by local cells.

## Pre-registered predictions

1. **Wall ratio (fold/serialize) < 0.5**, point prediction **0.30–0.45** — extrapolating
   contend-big's 0.358 at width 4: twice the serialized waves, but smaller per-task work,
   so per-wave fixed cost (suite pass, wave choreography) dominates the serialize arm.
2. **Arm identity holds:** the fold cell folds one 8-way contended wave; the serialize
   cell runs 8 waves. If either compiles differently, the cell is invalid, not evidence.
3. **Token ratio (fold/serialize) between 0.8 and 1.4** — the 08-30 run put the fold
   token penalty at 1.09× aggregate, inverting to 0.93× on the biggest serialize chain.
4. **Noise floor:** ±5% (established by the 08-30 identical-shape fixtures). A wall ratio
   above 0.9 would be inconclusive rather than a refutation.

## Results (cells ran 2026-09-01 00:32–00:52 UTC, serial, laptop, engine `dbf6ec1`)

**The predicted band missed. At width 8 under total contention, fold's wall advantage
vanishes — and the event log says exactly why.**

| arm | verdict | wall | waves | output tok | cost |
|---|---|---|---|---|---|
| fold | approved | 579.2s | 1 × 8 | 78,692 | $7.81 |
| serialize | approved | 586.2s | 8 × 1 | 42,530 | $4.40 |

- **Wall ratio 0.988** — inside the ±5% noise floor. Per the pre-registered reading rule
  (prediction 4), that is *inconclusive on wall*, not a measured serialize win; but the
  predicted 0.30–0.45 band is cleanly missed.
- **Token prediction REFUTED:** fold/serialize output-token ratio **1.85** (predicted
  0.8–1.4). Fold paid nearly double.
- **Arm identity held** (prediction 2): 1 wave of 8 vs 8 waves of 1; both cells gate-green.

## The mechanism (from `events.jsonl`, per-role wall)

| role | fold | serialize |
|---|---|---|
| implementers | 8 workers, 295s total (parallel) | 8 workers, 286s total (sequential) |
| **resolvers** | **7 dispatches, 419s (sequential)** | 0 |
| reviews | 8, 153s | 8, 178s |
| integration | 79s | 114s |

Fold parallelized ~286s of sequential implementation — and then handed back **419s of
sequential resolver chain**, because the kernel contract dispatches one resolver at a time
and an 8-way single-file contention produced 7 of them. **The serialization did not
disappear; it moved from the wave axis to the resolver axis, and at this task size the
resolver chain is longer than the implementation chain it replaced.**

This reconciles cleanly with the width-4 lineage instead of contradicting it: contend-big's
0.358× win came from *large* tasks (minutes of implementation serialized away, few
resolutions); contend-wide's tasks are small and maximally contended. **Fold's advantage
is not monotonic in width — it scales with (serial implementation time saved) minus
(resolver-chain length), and the second term grows with the number of tasks contending on
one file.**

## Two confounds, stated

1. **The suite here is ~free** (the fixture's tests run in seconds), so serialize's 7 extra
   waves paid almost no suite tax. On the fleet, where a suite pass is ~90s, those waves
   would cost serialize ~10 more minutes — the #443 billing argument for fold survives
   wherever suite passes are expensive; it just didn't bite in this local cell.
2. **Total contention is the worst case for fold by construction** — every task edits the
   one file. Real plans mix contended and clean files; the 08-30 aggregate (0.594×) remains
   the representative number.

## Decision returned

**The default does not change** — fold showed no wall or quality regression even in its
worst case, and its suite-pass economics dominate on real substrates. What changes is the
efficiency *thesis*: "fold pays more the wider the wave" is now bounded. The measured
frontier for kernel work (#360) is the **resolver chain**: at high contention width it is
the new serial bottleneck, and hunk-group-parallel resolution (or resolver batching) is
the lever that would make width-8 contention actually pay. Token cost of extreme-width
folding (1.85×) goes on the record as the price of that resolver chain.
