The project keeps a meter that says which tests have ever caught a real defect. Seven engine simulations have had fifteen chances and caught nothing, so this run deletes them, as the doctrine says ballast goes. It also fixes two ways the meter could mislead: a brand-new test was being judged against runs that happened before it existed, and the harness that runs every simulation was showing up as a test that never caught anything. After this run the meter's list of deletion candidates is one you can act on without a second look.

**Parked:** parked: gate verdict BLOCKED

> do: run the suite. see: seven sims that caught nothing in fifteen runs are gone and it is still green; and the counter's report now counts a test's window only from the run after it landed and never lists the bridge that runs the sims.

| task | claim | exam | probes | mutant | suite |
|---|---|---|---|---|---|
| 1 | Seven sims that caught nothing in fifteen runs are gone, nothing left in the tree names them, and the bridge still collects the rest. | none | — | — | — |
| 2 | The counter's report counts a test's window only from the run after it landed and never lists the bridge that runs the sims. | red at BASE, task failed | — | — | — |

Residuals: 31 from review

<details><summary>Record</summary>

## fleet run-98 — parked

| | |
|---|---|
| verdict | `BLOCKED` |
| target | `popmechanic/ultrapowers` at `eefdffe4bc1a6d581e6f3309771421e8c9cdcbf4` |
| engine | `eefdffe4bc1a6d581e6f3309771421e8c9cdcbf4` |
| plan | `.ultrapowers/plan.md` at `84362db7380caac691a616881a761cc56e3ff77a` |
| branch | `ultra/integration-run-98` |
| vm | `fleet-r98-2609110652-36da` |

### Checks

```json
{"mode": "gate", "stamp": "run-98", "reportPath": "/home/exedev/target/.claude/ultrapowers/run-run-98/report.json", "branch": "ultra/integration-run-98", "gateCheck": {"verdict": "BLOCKED", "checks": [{"name": "report-parse", "ok": true, "detail": ""}, {"name": "clean-tree", "ok": true, "detail": ""}, {"name": "wave-merges", "ok": true, "detail": ""}, {"name": "head-match", "ok": true, "detail": ""}, {"name": "git-verified", "ok": true, "detail": ""}, {"name": "ancestry", "ok": true, "detail": ""}, {"name": "deliverables", "ok": false, "detail": "failed/blocked tasks left declared deliverables unproduced: [{\"task\": \"2\", \"files\": [\"skills/ultralearn/SKILL.md\", \"skills/ultralearn/scripts/catch_counter.py\", \"skills/ultralearn/scripts/catch_report.py\", \"tests/test_catch_report_window.py\", \"tests/test_ultralearn_catch_report.py\", \"tests/test_ultralearn_catches.py\"]}]"}], "repo": "/home/exedev/target"}, "gateCheckExit": 1, "suite": {"passed": true, "unattributed": [], "output": "============================= test session starts ==============================\nplatform linux -- Python 3.12.3, pytest-7.4.4, pluggy-1.4.0\nrootdir: /home/exedev/target/.claude/ultrapowers/run-run-98/clones/integration\nconfigfile: pytest.ini\ntestpaths: tests\nplugins: xdist-3.4.0\ncreated: 6/6 workers\n6 workers [1615 items]\n\n........................................................................ [  4%]\n........................................................................ [  8%]\n........................................................................ [ 13%]\n........................................................................ [ 17%]\n........................................................................ [ 22%]\n........................................................................ [ 26%]\n........................................................................ [ 31%]\n........................................................................ [ 35%]\n........................................................................ [ 40%]\n........................................................................ [ 44%]\n........................................................................ [ 49%]\n........................................................................ [ 53%]\n........................................................................ [ 57%]\n........................................................................ [ 62%]\n........................................................................ [ 66%]\n........................................................................ [ 71%]\n........................................................................ [ 75%]\n........................................................................ [ 80%]\n........................................................................ [ 84%]\n........................................................................ [ 89%]\n........................................................................ [ 93%]\n........................................................................ [ 98%]\n...............................                                          [100%]\n=============================== warnings summary ===============================\ntests/test_harvest_fleet_runs.py::test_two_bundles_unpack_to_separate_directories\ntests/test_harvest_fleet_runs.py::test_two_bundles_unpack_to_separate_directories\ntests/test_harvest_fleet_runs.py::test_a_corrupt_tarball_among_healthy_ones_is_named_and_the_rest_land\ntests/test_harvest_fleet_runs.py::test_an_unreadable_tarball_is_named_in_a_whole_failed_lookup_line\ntests/test_harvest_fleet_runs.py::test_discover_unpacks_a_tarball\n  /usr/lib/python3.12/tarfile.py:2301: DeprecationWarning: Python 3.14 will, by default, filter extracted tar archives and reject files or modify their metadata. Use the filter argument to control this behavior.\n    warnings.warn(\n\n-- Docs: https://docs.pytest.org/en/stable/how-to/capture-warnings.html\n================= 1615 passed, 5 warnings in 383.08s (0:06:23) =================\n"}, "verdict": "BLOCKED"}

```

### Evidence

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence/run-98/.ultrapowers/runs/98/

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

https://github.com/popmechanic/ultrapowers/blob/ultra/plan/run-98/.ultrapowers/plan.md

### Residuals

- [ ] critic — Global Constraint ("A deletion is whole: no test, mention or bridge entry survives that names a deleted file, except history…") — three surviving mentions of deleted `fleet/tests/test_run_engine.mjs` sit outside the constraint's enumerated history exceptions (CLAUDE.md's Doctrine section, `tests/fixtures/`, `docs/`), and two of them read in the present tense rather than as history: `fleet/tests/test_roles_peer.mjs:37` ("The first two are the expressions `fleet/tests/test_run_engine.mjs` pins") and `fleet/tests/test_roles_peer.mjs:77` ("Held here as well as in test_run_engine.mjs so a role-file edit fails against its own test file") — with that sim gone, those pins are now held only in test_roles_peer.mjs, so the comment misstates the tree; `fleet/tests/test_weave_emit.mjs:6` ("Same seams as test_run_engine.mjs") points at a file a reader cannot open. Task 1's Context does explicitly bless all three as history and stay, and the constraint's `Check:` command exits 0, so this is a wording shortfall rather than a broken deletion — but the two test_roles_peer.mjs comments should be reworded to the past tense.
- [ ] task 1 reviewer — FILES under-declares the paths the task's own Context requires. The Context says "Every remaining reference to any of the seven basenames under `fleet/`, `skills/`, `tests/` (outside `tests/fixtures/`) is an error to fix here", and the global constraint ("a deletion is whole") forces the same, but FILES names only 11 paths while 11 further paths had to be edited to carry it: `fleet/run-engine.mjs`, `fleet/tests/README.md`, `test_run_engine_blind_sensor.mjs`, `test_run_engine_proof_runs.mjs`, `test_run_engine_red_suite_record.mjs`, `test_run_engine_referee.mjs`, `test_run_engine_state_exams.mjs`, `test_run_engine_wave_events.mjs`, `test_run_main_engine_dir.mjs`, `test_sandbox_boot_state_exams.mjs`, `test_sims_are_hermetic.mjs`. I read each of those hunks: all are comment rewrites or the removal of a list entry/leg whose only subject was a deleted sim (leg (g) of `test_run_engine_proof_runs.mjs`, the `test_run_engine_exam_evidence.mjs` entry in `NESTED_AT_BASE`, the `test_sandbox_boot_approval_evidence.mjs` sibling names). No unrelated refactor, no debug code, and none of the 11 collides with task 2's SIBLING FILES. The defect is the task text's scope list, not the diff, and no edit inside this tree answers it.
- [ ] task 1 reviewer — Three present-tense mentions of a deleted sim survive, which the global constraint's exception list does not cover. The constraint exempts history only in "CLAUDE.md's Doctrine section, a fixture plan under `tests/fixtures/`, or a plan under `docs/`"
- [ ] task 1 reviewer — the Context instead rules that `fleet/tests/test_roles_peer.mjs:37,77` and `fleet/tests/test_weave_emit.mjs:6` "mention `test_run_engine.mjs` as history and stay". Two of the three do not read as history: `test_roles_peer.mjs:37` says "The first two are the expressions `fleet/tests/test_run_engine.mjs` pins" and `:77` says "Held here as well as in test_run_engine.mjs so a role-file edit fails against its own test file" — both assert a co-holder that no longer exists, so a reader is told a second pin backs these rules when none does. (`test_weave_emit.mjs:6`, "Same seams as test_run_engine.mjs", is genuinely retrospective.) The constraint's `Check:` (`tests/test_fleet_suite_collection.py`) ran and exited 0
- [ ] task 1 reviewer — it does not grade mentions, so this rests on my reading of the prose, and the fix lies in two files outside FILES. Worth a follow-up reword of those two comments to past tense ("the expressions the deleted `test_run_engine.mjs` pinned (#344, #441)", "held here alone since that sim was deleted").
- [ ] task 1 reviewer — `tests/test_fleet_suite.py`: the comment above `SLOW_FIRST` is now stale against the tuple it documents. The list went from seven names to five, but lines 55-58 still read "40.9 s, 33.3 s, 30.7 s, 17.0 s, 13.3 s, 12.6 s, 10.6 s" (seven walls — the trailing 12.6 s and 10.6 s were `test_run_engine_exam_evidence.mjs` and `test_publish_fold.mjs`, in list order) and "so the seven longest go out first". Nothing asserts on the comment, and the same block already says "A name that leaves fleet/tests/ simply drops out of the list", so this is accuracy only — but this file is in FILES and the diff edits the tuple three lines below.
- [ ] task 1 reviewer — `fleet/tests/test_run_engine_proof_runs.mjs:860-862`: the diff removes leg (g) (the `test_run_engine_exam_evidence.mjs` probe) from the loop table but leaves the header describing the old shape — "#713 Task 1 legs (f)-(j): the five re-scoped sims" and "the driver executes those five commands". Four legs remain: (f), (h), (i), (j). No assertion reads the comment, and the loop itself is correct (each surviving entry names a sim that still exists), so this is accuracy only
- [ ] task 1 reviewer — the diff already edits this file, so it can carry the fix.
- [ ] task 1 reviewer — path outside FILES: `fleet/run-engine.mjs`
- [ ] task 1 reviewer — path outside FILES: `fleet/tests/README.md`
- [ ] task 1 reviewer — path outside FILES: `fleet/tests/test_run_engine_blind_sensor.mjs`
- [ ] task 1 reviewer — path outside FILES: `fleet/tests/test_run_engine_proof_runs.mjs`
- [ ] task 1 reviewer — path outside FILES: `fleet/tests/test_run_engine_red_suite_record.mjs`
- [ ] task 1 reviewer — path outside FILES: `fleet/tests/test_run_engine_referee.mjs`
- [ ] task 1 reviewer — path outside FILES: `fleet/tests/test_run_engine_state_exams.mjs`
- [ ] task 1 reviewer — path outside FILES: `fleet/tests/test_run_engine_wave_events.mjs`
- [ ] task 1 reviewer — path outside FILES: `fleet/tests/test_run_main_engine_dir.mjs`
- [ ] task 1 reviewer — path outside FILES: `fleet/tests/test_sandbox_boot_state_exams.mjs`
- [ ] task 1 reviewer — path outside FILES: `fleet/tests/test_sims_are_hermetic.mjs`
- [ ] task 1 reviewer — top-level tests +0 / −12 across the patch: net drop of 12, removing `the three sims the Proof runs are still there for the bridge  [M5 / leg (e)]`, `the boot script parses  [rig]`, `the approve receipt reaches the evidence worktree byte for byte  [M1 / leg (a)]`, `the standing approval reaches the evidence worktree byte for byte  [M1 / leg (a)]`, `a PASS run that wrote neither approval commits neither  [M1 / leg (b)]`, `the PASS run\`, `the approved NEEDS_ACK run\`, `CONTRACT.md\`, `every worker slice reaches the evidence worktree byte for byte  [#702 Task 2 / M1 / leg (a)]`, `the copied transcripts directory holds the two names and nothing nested  [#702 Task 2 / M1 / leg (a)]`, `a run whose engine wrote no transcripts commits none  [#702 Task 2 / M1 / leg (a)]`, `CONTRACT.md\` with no removal declared in the task
- [ ] task 1 reviewer — concern: plan-defect: the Context asserts "no surviving sim names one of the seven that way (checked at BASE)" for existsSync pins, and that only test_run_record_keys.mjs and fleet/roles/README.md must move with the deletions. That is wrong at BASE eefdffe4 — four surviving sims pin a deleted file and go red on deletion: fleet/tests/test_run_engine_state_exams.mjs:564 (existsSync on test_run_engine_exam_evidence.mjs), fleet/tests/test_sandbox_boot_state_exams.mjs:262 SIBLING_SIMS (existsSync on test_sandbox_boot_approval_evidence.mjs), fleet/tests/test_sims_are_hermetic.mjs:846,850,851 (NESTED_AT_BASE asserts both the file and its siblings exist), and fleet/tests/test_run_engine_proof_runs.mjs:963 leg (g), which readFileSync's test_run_engine_exam_evidence.mjs to splice a probe copy. Fixed task-locally by dropping the deleted names from those name-read lists and removing leg (g) whole
- [ ] task 1 reviewer — leg (g)'s pin (two post-patch driver:exam-run events) has no home left now that the sim it re-scoped is gone, and its nearest survivor is leg (h). Declared FILES could not have covered this.
- [ ] task 1 reviewer — concern: out-of-FILES: fleet/tests/test_run_engine_state_exams.mjs — dropped test_run_engine_exam_evidence.mjs from leg (l)'s existsSync list (four siblings to three) and reworded the leg header. Required: the assertion fails on the deleted path.
- [ ] task 1 reviewer — concern: out-of-FILES: fleet/tests/test_sandbox_boot_state_exams.mjs — SIBLING_SIMS narrowed to ['test_sandbox_boot.mjs'], plus its header and leg (g) comments reworded. Required: leg (g)'s existsSync fails on the deleted path.
- [ ] task 1 reviewer — concern: out-of-FILES: fleet/tests/test_sims_are_hermetic.mjs — removed the test_run_engine_exam_evidence.mjs NESTED_AT_BASE entry and its two sibling-list occurrences
- [ ] task 1 reviewer — site-count prose nine->eight. Required: leg (e) asserts each named file and sibling exists.
- [ ] task 1 reviewer — concern: out-of-FILES: fleet/tests/test_run_engine_proof_runs.mjs — removed leg (g), whose copyWithProbe read the deleted test_run_engine_exam_evidence.mjs. Required: readFileSync throws on the deleted path.
- [ ] task 1 reviewer — concern: out-of-FILES: six stale prose mentions reworded so no mention names a deleted file (global constraint): fleet/run-engine.mjs:586, fleet/tests/test_run_engine_referee.mjs:32, fleet/tests/test_run_engine_wave_events.mjs:27, fleet/tests/test_run_engine_red_suite_record.mjs:25, fleet/tests/test_run_engine_blind_sensor.mjs:32, fleet/tests/test_run_main_engine_dir.mjs:143
- [ ] task 1 reviewer — and fleet/tests/README.md dropped its test_run_main.mjs bullet.
- [ ] task 1 reviewer — concern: Three mentions survive because the task's Context explicitly rules them history that stays: fleet/tests/test_roles_peer.mjs:37 and :77, and fleet/tests/test_weave_emit.mjs:6. Worth flagging that :77 reads present-tense — "Held here as well as in test_run_engine.mjs so a role-file edit fails against its own test file" — which is no longer true now that the file is gone. I left it as the task directs rather than reword against explicit instruction
- [ ] task 1 reviewer — the roles/README.md rewording already redirects the shouted-imperative pin to test_roles_peer.mjs itself.

</details>

