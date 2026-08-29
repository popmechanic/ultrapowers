# Plan: first self-hosted run probe (runId 24)

A deliberately small, width-2 plan whose purpose is to exercise the One Driver
engine (`fleet/run-main.mjs`) end to end on a real sandbox for the first time:
provision → two parallel workers → driver-captured patches (against BASE) →
fold → independent review → gate → PR. Both tasks CREATE new files and are
disjoint by construction (no shared path, no ordering), which is the width-2
wave the live-parity bar (spec §9) asks for. Creating rather than modifying
also exercises the untracked-file capture path (`git add -A` in
`withPatchCapture`). Each task pins its own evidence with a `Test:` that the
committed suite runs, so the gate verifies the work in runtime form rather than
by human judgment.

**Acceptance:** suite — probe run; verified by the committed test suite (including each task's new pinning test) staying green, not a held-out exam.

### Task 1: Document the fleet test directory

**Type:** implementation
**Depends-on:** none

**Files:**
- Create: `fleet/tests/README.md`
- Test: `tests/test_fleet_readme.py`

Create `fleet/tests/README.md`: a short index of what the `fleet/` test suite
covers. Include a one-sentence intro noting these are the fleet engine's tests
(run via `node` and joined into the Python suite through
`tests/test_fleet_suite.py`), then a bullet list naming the main areas under
test — the worker dispatcher (`test_run_worker.mjs`), the waves loader and
patch capture (`test_run_waves.mjs`), the deterministic engine entry
(`test_run_main.mjs`), the implementer confinement boundary
(`test_confine_hook.mjs`), the drive CLI (`test_drive_one.mjs`), and the shim
(`test_shim*.mjs`). One line each. Keep it under 30 lines.

Then create `tests/test_fleet_readme.py`: a pytest test that reads
`fleet/tests/README.md` (resolve it relative to the repo root, e.g. from this
test file's parent's parent) and asserts the file exists, is non-empty, and
mentions both `test_run_main.mjs` and `test_confine_hook.mjs`. This pins the
README's presence and key content in runtime form.

### Task 2: Note that plans/ is historical

**Type:** implementation
**Depends-on:** none

**Files:**
- Create: `docs/superpowers/plans/README.md`
- Test: `tests/test_plans_readme.py`

Create `docs/superpowers/plans/README.md`: a short note explaining that, since
version 0.3.0, the machine-derived per-wave plan is disposable and this
`plans/` directory is **historical** — the signed artifact that drives a run is
now the intent document under `docs/superpowers/intents/`. Two or three
sentences, pointing the reader to `intents/` and to `CLAUDE.md`.

Then create `tests/test_plans_readme.py`: a pytest test that reads
`docs/superpowers/plans/README.md` (resolve it relative to the repo root) and
asserts the file exists, is non-empty, and contains both the word `historical`
and a reference to `intents`. This pins the note's presence and key content in
runtime form.
