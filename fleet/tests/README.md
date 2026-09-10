# fleet/tests

These are the fleet engine's own tests — `.mjs` suites run under `node` and
joined into the Python suite through `tests/test_fleet_suite.py`.

Main areas under test:

- `test_run_worker.mjs` — the worker dispatcher: launching one implementer,
  handing it its task, and reaping the result.
- `test_run_waves.mjs` — the waves loader and patch capture: reading the wave
  plan and turning each finished clone into a diff against its base.
- `test_run_main.mjs` — the deterministic engine entry: argument handling and
  the top-level run control flow.
- `test_confine_hook.mjs` — the implementer confinement boundary: which tool
  calls a task's clone is allowed to make.
- `test_run_engine*.mjs` — the engine kernel: wave scheduling, review pairing,
  the fix loop, the examiner, and the gate.
- `_helpers.mjs` — the rig's environment: `simEnv()` builds the environment
  every process a sim starts runs under, so a sim sees what it was handed and
  never the box it runs on. `test_sims_are_hermetic.mjs` is the probe that
  keeps it true.
