# Planning-eval fixtures

A *planning* eval (not execution): does ultraplan's decomposition-shaping reveal
real parallelism without manufacturing it? Rides the micro-loop
(`evals/scripts/run-micro.py`).

- `samples.json` — specs spanning three regimes. `_regime` and
  `_ground_truth_width` are scorer-only (the `_` prefix hides them from the model).
  Ground truth is the honest max wave width of the work's true dependency
  structure (`linear` traps are 1).
  **Only `_`-prefixed *keys* are hidden — never write the honest width into the
  visible `spec` prose (spell numbers out, e.g. "four services", not "4"), or you
  leak the answer to the model and the eval measures nothing.**
- `variants.json` — `ultraplan-current` (decompose only) vs `ultraplan-shaped`
  (the shaping recipe). The loop auto-injects `control-no-guidance` as the floor.

## Run (operator-invoked; spends API)

Efficacy — shaped should widen latent/contract specs:

    evals/scripts/run-micro.py --variants evals/planning-fixtures/variants.json \
        --samples evals/planning-fixtures/samples.json --scorer wave_width --n 5

Honesty — shaped mean must be 0 (no width above ground truth, anywhere):

    evals/scripts/run-micro.py --variants evals/planning-fixtures/variants.json \
        --samples evals/planning-fixtures/samples.json --scorer wave_overshoot --n 5

Validated: shaped `wave_width` mean > current on latent/contract, shaped
`wave_overshoot` mean == 0 across all samples, and shaped does not widen the
linear traps.
