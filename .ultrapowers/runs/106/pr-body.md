The mechanical referee (#729, 0.3.23) is deleted whole, on the reading of runs 70–102: 80 findings, none escalated by a reviewer, three `referee-red` tasks all false positives, and none of the reviewers' 14 blocking findings inside the referee's six checks. After this run the engine's pre-review pass is the `Run:`/`Check:`/exam pass it was before #729, the reviewer role carries its pre-#729 footprint and interface duties, the report no longer counts referee findings, and `fleet/referee.mjs`, its linker, their sims, their 133 fixture files and the record's `referee/` copy are gone. The old shape stays in git as the rollback.

**Parked:** parked: gate verdict BLOCKED

> do: launch a run on the merged engine and read its report. see: no task is failed or sent to a fix round by the driver's own arithmetic over the patch — the reviewers find footprint and interface issues themselves, every `peer` task buys both reviewers — and the run's record carries no `referee/` directory.

| task | claim | exam | probes | mutant | suite |
|---|---|---|---|---|---|
| 1 | A task whose patch strays outside its FILES is not sent to a fix round by the driver: it goes straight to review, a `peer` task always gets both reviewers, and the reviewer is told — as it was before #729 — that the footprint and the interfaces are its own duties. | red at BASE, task failed | — | — | — |
| 2 | The referee's thirty fixture directories are gone from the suite, the hermetic probe no longer looks for the linker sim, and the fleet bridge still collects. | red at BASE, task failed | — | — | — |
| 3 | The evidence the sandbox commits for a run carries `transcripts/` and `state-exams/` as before and never a `referee/` directory — even when the run directory holds one — and the contract no longer promises one. | red at BASE → green | — | — | — |

Residuals: 5 from review

<details><summary>Record</summary>

## fleet run-106 — parked

| | |
|---|---|
| verdict | `BLOCKED` |
| target | `popmechanic/ultrapowers` at `258df95a5b082e6240c6a71fa28c0cf43ba7abbc` |
| engine | `258df95a5b082e6240c6a71fa28c0cf43ba7abbc` |
| plan | `.ultrapowers/plan.md` at `889551dc7be1393cdc731fe532c392f13e71af16` |
| branch | `ultra/integration-run-106` |
| vm | `fleet-r106-2609111851-e39c` |

### Checks

```json
{"mode": "gate", "stamp": "run-106", "reportPath": "/home/exedev/target/.claude/ultrapowers/run-run-106/report.json", "branch": "ultra/integration-run-106", "gateCheck": {"verdict": "BLOCKED", "checks": [{"name": "report-parse", "ok": true, "detail": ""}, {"name": "clean-tree", "ok": true, "detail": ""}, {"name": "wave-merges", "ok": true, "detail": ""}, {"name": "head-match", "ok": true, "detail": ""}, {"name": "git-verified", "ok": true, "detail": ""}, {"name": "ancestry", "ok": true, "detail": ""}, {"name": "deliverables", "ok": false, "detail": "failed/blocked tasks left declared deliverables unproduced: [{\"task\": \"1\", \"files\": [\"fleet/roles/reviewer.md\", \"fleet/run-engine.mjs\", \"fleet/tests/test_run_engine_exam_edits.mjs\", \"fleet/tests/test_run_engine_integrated_runs.mjs\", \"fleet/tests/test_run_engine_pre_review.mjs\", \"fleet/tests/test_run_engine_proof_runs.mjs\", \"fleet/tests/test_run_engine_review_economy.mjs\", \"fleet/tests/test_run_engine_review_pair.mjs\", \"fleet/tests/test_run_engine_reviewer_prompt.mjs\", \"fleet/tests/test_run_engine_state_exams.mjs\", \"fleet/tests/test_run_record_keys.mjs\", \"skills/ultrapowers/references/report-format.md\"]}, {\"task\": \"2\", \"files\": [\"fleet/tests/test_sim_inventory.mjs\", \"fleet/tests/test_sims_are_hermetic.mjs\"]}]"}], "repo": "/home/exedev/target"}, "gateCheckExit": 1, "suite": {"passed": true, "unattributed": [], "output": "============================= test session starts ==============================\nplatform linux -- Python 3.12.3, pytest-7.4.4, pluggy-1.4.0\nrootdir: /home/exedev/target/.claude/ultrapowers/run-run-106/clones/integration\nconfigfile: pytest.ini\ntestpaths: tests\nplugins: xdist-3.4.0\ncreated: 6/6 workers\n6 workers [1625 items]\n\n........................................................................ [  4%]\n......................................................................... [  8%]\n........................................................................ [ 13%]\n........................................................................ [ 17%]\n........................................................................ [ 22%]\n........................................................................ [ 26%]\n........................................................................ [ 31%]\n........................................................................ [ 35%]\n...............................s........................................ [ 39%]\n........................................................................ [ 44%]\n........................................................................ [ 48%]\n........................................................................ [ 53%]\n........................................................................ [ 57%]\n........................................................................ [ 62%]\n........................................................................ [ 66%]\n........................................................................ [ 70%]\n........................................................................ [ 75%]\n........................................................................ [ 79%]\n........................................................................ [ 84%]\n........................................................................ [ 88%]\n........................................................................ [ 93%]\n........................................................................ [ 97%]\n........................................                                 [100%]\n=============================== warnings summary ===============================\ntests/test_harvest_fleet_runs.py::test_discover_unpacks_a_tarball\ntests/test_harvest_fleet_runs.py::test_two_bundles_unpack_to_separate_directories\ntests/test_harvest_fleet_runs.py::test_two_bundles_unpack_to_separate_directories\ntests/test_harvest_fleet_runs.py::test_a_corrupt_tarball_among_healthy_ones_is_named_and_the_rest_land\ntests/test_harvest_fleet_runs.py::test_an_unreadable_tarball_is_named_in_a_whole_failed_lookup_line\n  /usr/lib/python3.12/tarfile.py:2301: DeprecationWarning: Python 3.14 will, by default, filter extracted tar archives and reject files or modify their metadata. Use the filter argument to control this behavior.\n    warnings.warn(\n\n-- Docs: https://docs.pytest.org/en/stable/how-to/capture-warnings.html\n=========== 1624 passed, 1 skipped, 5 warnings in 380.32s (0:06:20) ============\n"}, "verdict": "BLOCKED"}

```

### Evidence

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence/run-106/.ultrapowers/runs/106/

- claude-version.txt
- engine.log
- events.jsonl
- exams
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

https://github.com/popmechanic/ultrapowers/blob/ultra/plan/run-106/.ultrapowers/plan.md

### Residuals

- [ ] task 3 reviewer — unverified: the GLOBAL CONSTRAINT ("the fleet, the skills and the tests carry no trace of the mechanical referee") is not settled by this patch. CHECK EVIDENCE for the constraint's grep exits 1, and every surviving hit it prints is in `skills/ultrapowers/references/report-format.md` (the `refereeFindings` / `refereeBlocking` / `refereeSkippedPairs` reviewEconomy rows, the `referee-red` verdict, "the driver's referee"), which is a SIBLING-owned file (task 1's scope) and therefore absent from this clone's tree. Nothing in this task's own FILES contributes a hit: `test "$(grep -ci referee fleet/sandbox-boot.sh)" = 0` exits 0, the two negated CONTRACT greps exit 0, and this task's exam is under `fleet/tests/exams/`, which the check excludes. What would settle it: re-running the constraint's grep on the integrated tree after sibling task 1 lands its `report-format.md` edit. The driver already marked this check `(minor)`
- [ ] task 3 reviewer — recorded here so the operator reads it in the run report rather than as a pass on this diff.
- [ ] task 3 reviewer — Recorded, not blocking: the Proof's `Test:` path is `fleet/tests/test_sandbox_boot_evidence_copy.mjs` but the file landed at `fleet/tests/exams/run_106/test_sandbox_boot_evidence_copy.mjs` — a disclosed, correct divergence, authorized verbatim by the task's Context ("The exam is unguarded, so it lands at `fleet/tests/exams/<slug>/` and imports `../../_sandbox_boot_helpers.mjs` at that depth"). The import at that depth resolves correctly (`exams/run_106/../../` → `fleet/tests/`), `REPO_ROOT` four levels up resolves to the repository root, and every helper the exam imports (`SCRIPT`, `RUN_PATH`, `STUBS`, `PRELUDE`, `makeHome`, `bootAsync`, `runDir`, `evidenceDir`, `runTests`, `ENV`) is exported by `fleet/tests/_sandbox_boot_helpers.mjs` at BASE. The driver's REFEREE line "path outside FILES" is this same fact
- [ ] task 3 reviewer — noted so it is not counted twice.
- [ ] task 3 reviewer — path outside FILES: `fleet/tests/exams/run_106/test_sandbox_boot_evidence_copy.mjs`

</details>

Closes #911
Closes #861
