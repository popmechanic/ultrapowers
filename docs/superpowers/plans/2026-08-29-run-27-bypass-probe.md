# Plan: run-27 — the bypassPermissions posture, validated live

A width-2 plan whose purpose is to validate one measured change on a real run:
the implementer/writeSide roles now run `--permission-mode bypassPermissions`
with the confine-hook and `--disallowedTools` kept (both boundaries measured to
hold under bypass, probes 2026-08-29 — `probe_bypass_vs_hook.mjs`,
`probe_disallowed_vs_bypass.mjs`). Same shape as the run-26 probe: two disjoint
create-only tasks, each pinned by a test the committed suite runs, so the gate
verifies the work in runtime form. Fresh files — the run-26 probe's
deliverables exist at BASE and are not reused.

**Acceptance:** suite — probe run; verified by the committed test suite
(including each task's new pinning test) staying green.

### Task 1: Document the fleet roles directory

**Type:** implementation
**Depends-on:** none

**Files:**
- Create: `fleet/roles/README.md`
- Test: `tests/test_roles_readme.py`

Create `fleet/roles/README.md`: a short note (under 25 lines) explaining that
these files are the engine's judgment-role prompts — read at dispatch by
`fleet/run-engine.mjs`, one file per role (implementer, reviewer, fix,
resolver, reconcile, critic), each capped at 350 words by a pinning test, with
no bake step (this directory is the single copy). Mention that choreography
(git, kernel invocations) lives in the driver, never in these prompts
(#366 Amendment 10).

Then create `tests/test_roles_readme.py`: a pytest test that reads
`fleet/roles/README.md` (resolve it relative to the repo root, e.g. from this
test file's parent's parent) and asserts the file exists, is non-empty, and
mentions both `run-engine.mjs` and `Amendment 10`.

### Task 2: Document the fleet probes

**Type:** implementation
**Depends-on:** none

**Files:**
- Create: `fleet/tests/PROBES.md`
- Test: `tests/test_probes_readme.py`

Create `fleet/tests/PROBES.md`: a short note (under 25 lines) explaining the
`probe_*.mjs` convention — probes spend real tokens against a real `claude -p`
and are deliberately not named `test_*.mjs` so CI and the suite never run them;
they run where a credential lives (the orchestrator or a sandbox). List the
current probes with one line each: `probe_confine_live.mjs`,
`probe_run_worker_live.mjs`, `probe_bypass_vs_hook.mjs`,
`probe_disallowed_vs_bypass.mjs`.

Then create `tests/test_probes_readme.py`: a pytest test that reads
`fleet/tests/PROBES.md` (resolve it relative to the repo root) and asserts the
file exists, is non-empty, and mentions both `probe_bypass_vs_hook.mjs` and
`claude -p`.
