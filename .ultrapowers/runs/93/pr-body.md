## fleet run-93 — parked

| | |
|---|---|
| verdict | `BLOCKED` |
| target | `popmechanic/ultrapowers` at `0e1a4f00b71083503641452bf7cbe1484a27f2d5` |
| engine | `0e1a4f00b71083503641452bf7cbe1484a27f2d5` |
| plan | `.ultrapowers/plan.md` at `40ea135d8155e074fdf22c3db0e35bc268b82106` |
| branch | `ultra/integration-run-93` |
| vm | `fleet-r93-2609110038-0f08` |

### Checks

```json
{"mode": "gate", "stamp": "run-93", "reportPath": "/home/exedev/target/.claude/ultrapowers/run-run-93/report.json", "branch": "ultra/integration-run-93", "gateCheck": {"verdict": "BLOCKED", "checks": [{"name": "report-parse", "ok": true, "detail": ""}, {"name": "clean-tree", "ok": true, "detail": ""}, {"name": "wave-merges", "ok": true, "detail": ""}, {"name": "head-match", "ok": true, "detail": ""}, {"name": "git-verified", "ok": true, "detail": ""}, {"name": "ancestry", "ok": true, "detail": ""}, {"name": "deliverables", "ok": false, "detail": "failed/blocked tasks left declared deliverables unproduced: [{\"task\": \"2\", \"files\": [\"CLAUDE.md\", \"fleet/CONTRACT.md\", \"fleet/RUNBOOK.md\", \"fleet/sandbox-boot.sh\", \"fleet/tests/_sandbox_boot_helpers.mjs\", \"fleet/tests/test_sandbox_boot.mjs\", \"fleet/tests/test_sandbox_boot_viz.mjs\"]}]"}], "repo": "/home/exedev/target"}, "gateCheckExit": 1, "suite": {"passed": true, "unattributed": [], "output": "============================= test session starts ==============================\nplatform linux -- Python 3.12.3, pytest-7.4.4, pluggy-1.4.0\nrootdir: /home/exedev/target/.claude/ultrapowers/run-run-93/clones/integration\nconfigfile: pytest.ini\ntestpaths: tests\nplugins: xdist-3.4.0\ncreated: 6/6 workers\n6 workers [1619 items]\n\n........................................................................ [  4%]\n........................................................................ [  8%]\n........................................................................ [ 13%]\n........................................................................ [ 17%]\n........................................................................ [ 22%]\n........................................................................ [ 26%]\n........................................................................ [ 31%]\n........................................................................ [ 35%]\n........................................................................ [ 40%]\n........................................................................ [ 44%]\n........................................................................ [ 48%]\n........................................................................ [ 53%]\n........................................................................ [ 57%]\n........................................................................ [ 62%]\n........................................................................ [ 66%]\n........................................................................ [ 71%]\n........................................................................ [ 75%]\n........................................................................ [ 80%]\n........................................................................ [ 84%]\n........................................................................ [ 88%]\n........................................................................ [ 93%]\n........................................................................ [ 97%]\n...................................                                      [100%]\n=============================== warnings summary ===============================\ntests/test_harvest_fleet_runs.py::test_discover_unpacks_a_tarball\ntests/test_harvest_fleet_runs.py::test_two_bundles_unpack_to_separate_directories\ntests/test_harvest_fleet_runs.py::test_two_bundles_unpack_to_separate_directories\ntests/test_harvest_fleet_runs.py::test_a_corrupt_tarball_among_healthy_ones_is_named_and_the_rest_land\ntests/test_harvest_fleet_runs.py::test_an_unreadable_tarball_is_named_in_a_whole_failed_lookup_line\n  /usr/lib/python3.12/tarfile.py:2301: DeprecationWarning: Python 3.14 will, by default, filter extracted tar archives and reject files or modify their metadata. Use the filter argument to control this behavior.\n    warnings.warn(\n\n-- Docs: https://docs.pytest.org/en/stable/how-to/capture-warnings.html\n================= 1619 passed, 5 warnings in 411.06s (0:06:51) =================\n"}, "verdict": "BLOCKED"}

```

### Evidence

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence/run-93/.ultrapowers/runs/93/

- claude-version.txt
- engine.log
- events.jsonl
- gate-receipt.json
- pr-body.md
- publish-fold
- receipt.json
- referee
- report.json
- residuals.jsonl
- status.json
- transcripts

### Plan

https://github.com/popmechanic/ultrapowers/blob/ultra/plan/run-93/.ultrapowers/plan.md

### Residuals

- [ ] critic — Context cross-check, whole-tree: the shared event literal `{"kind":"driver:wave-adopted","wave":<n>,"tasks":[<ids>],"headSha":"<40-hex>"}` / `{"kind":"driver:wave-blocked","wave":<n>,"tasks":[<ids>],"detail":"<text>"}` is carried in both tasks' Context slots, but only the producer side exists in the tree. `fleet/run-engine.mjs:2950-2951` and `:2744` emit exactly that shape (and `fleet/CONTRACT.md:49-52` spells both kinds with `headSha`, satisfying the global constraint that every added kind be named there), so there is no disagreement to report — but the two kinds have no reader anywhere in the tree, since task 2's projector was to be their only consumer. This is a consequence of the finding above rather than a defect in task 1; it is worth an issue only so the orphaned producer is not mistaken for finished work if task 2 is re-run separately.
- [ ] task 1 reviewer — Coverage gap between the Claim and the Machine clauses: `foldWave` has a third terminal outcome, `{status:'CONFLICT', detail}` (fleet/run-engine.mjs:2458, via `blocked(reason)` when the fold path is blocked), and the caller also pushes `SKIPPED` rows when a wave has no mergeable results (fleet/run-engine.mjs:2896, :2899). Both are waves that were blocked in the Claim's plain sense ("when a wave was blocked, naming the tasks each time"), and neither emits `driver:wave-blocked` — the diff gates only on `merge.status === 'TEST_FAILED'` plus `parkOnRedBaseline`. The implementer is faithful here: M2 names exactly "reconcile exhaustion or on a red baseline", M3 counts one event per `waveMerges` row with status `TEST_FAILED`, and the Context enumerates the same two exits and says "one place per status", so emitting more would exceed the exam. Recording it because the consequence is downstream: task 2's projection maps `failed` off `driver:wave-blocked`, so a CONFLICT wave's tasks will read as whatever their last worker event said rather than failed. Whether the record should cover CONFLICT/SKIPPED waves is the plan's call, not a fix this task can make on its own terms.
- [ ] task 1 reviewer — Exam does not pin the one place the adopted event's `tasks` differs from the whole wave. M1 reads "the ids the wave merged in plan order" and the diff correctly uses `waveTasks` (fleet/run-engine.mjs:2908 — `WAVES[w]` narrowed to the mergeable rows) rather than the `waveIds(w)` helper it uses for the blocked events. But every green leg in fleet/tests/test_run_engine_wave_events.mjs has all of the wave's tasks merging, so a regression from `waveTasks.map(...)` to `waveIds(w)` would still pass the exam. A leg with one task merging and one failing (stub returns a BLOCKED impl for task 2), asserting `adopted[0].tasks` is `['1']` while the row's `branches` is `['1']`, would make the narrowing observable. Not blocking: the legs the Proof names are all present and green, and the implementer disclosed the choice in the comment at the call site.
- [ ] task 1 reviewer — fleet/tests/test_run_engine_wave_events.mjs imports `gitSync` from `./_engine_helpers.mjs` and never uses it
- [ ] task 1 reviewer — `base`, `clonesDir`, `integ` and `logs` are likewise returned by `rigWithEvents` and never read by any leg. Harmless, but it is leftover rig surface copied from the sibling sims.

