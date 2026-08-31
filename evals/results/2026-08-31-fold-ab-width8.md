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

## Results

*(appended after both cells ran — see below)*
