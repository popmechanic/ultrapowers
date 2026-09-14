This is the release of everything the 2026-09-13 sitting landed, and the proof that the landed engine works, because the release itself runs through it. The run changes two version numbers and one line of the project's own instructions, opens a pull request, and merges it with no hand on the button, while its worker, for the first time, carries the reference to its own hub issue. If it lands, the engine that now lets workers speak on the tracker, leaves a parked run open as a question for a person, and has shown that folding tasks one at a time gives the same tree as folding the wave can ship itself; if it does not, the release waits and the record says why.

**Merge-ready**

> do: launch the release plan on the merged engine. see: a PR that bumps the plugin to 0.3.27 in both manifests, opened and merged by the sandbox itself, and on its task's hub issue the first note a worker has ever written there; then I tag v0.3.27.

| task | claim | exam | probes | mutant | suite |
|---|---|---|---|---|---|
| 1 | The plugin's version reads 0.3.27 in both places it is written and in the project's own instructions, which still say a release is a plan the fleet runs, merged by the sandbox, then tagged by me. | red at BASE → green | — | — | — |

Residuals: 3 from review

- deferred:external — The plan-level Claim's out-of-tree half: "a PR that bumps the plugin to 0.3.27 in both manifests, opened and merged by the sandbox itself, and on its task's hub issue the first note a worker has ever written there" — plus the operator's follow-on `gh release create v0.3.27`. — The tree half of this Claim is complete and verified (both manifests and CLAUDE.md read 0.3.27, diff limited to those three lines). The PR open/merge and the worker's hub-issue comment under `impl:1@run-123` are post-gate run behaviors against the GitHub hub: run-run-123/events.jsonl records no issue- or comment-class event at read time, and no INTEGRATED RUN EVIDENCE block covers them. The tag is explicitly the operator's own step after the merge. None of this is executable from the integrated tree, so it routes to acknowledgement rather than silently passing. [structural false-green: sandbox could not execute it against the target]

<details><summary>Record</summary>

## fleet run-123 — gate-green

| | |
|---|---|
| verdict | `NEEDS_ACK` |
| target | `popmechanic/ultrapowers` at `47c936d0216fcae1293711b66e0299bc995a81e6` |
| engine | `47c936d0216fcae1293711b66e0299bc995a81e6` |
| plan | `.ultrapowers/plan.md` at `e2c714f8936e9fca4b6e537d4162735f203c3644` |
| branch | `ultra/integration-run-123` |
| vm | `fleet-r123-2609141527-7868` |

### Checks

```json
{"mode": "gate", "stamp": "run-123", "reportPath": "/home/exedev/target/.claude/ultrapowers/run-run-123/report.json", "branch": "ultra/integration-run-123", "gateCheck": {"verdict": "NEEDS_ACK", "checks": [{"name": "report-parse", "ok": true, "detail": ""}, {"name": "clean-tree", "ok": true, "detail": ""}, {"name": "wave-merges", "ok": true, "detail": ""}, {"name": "head-match", "ok": true, "detail": ""}, {"name": "git-verified", "ok": true, "detail": ""}, {"name": "ancestry", "ok": true, "detail": ""}, {"name": "deliverables", "ok": true, "detail": ""}], "notes": [], "repo": "/home/exedev/target"}, "gateCheckExit": 2, "suite": {"passed": true, "unattributed": [], "output": "============================= test session starts ==============================\nplatform linux -- Python 3.12.3, pytest-7.4.4, pluggy-1.4.0\nrootdir: /home/exedev/target/.claude/ultrapowers/run-run-123/clones/integration\nconfigfile: pytest.ini\ntestpaths: tests\nplugins: xdist-3.4.0\ncreated: 6/6 workers\n6 workers [1577 items]\n\n........................................................................ [  4%]\n........................................................................ [  9%]\n........................................................................ [ 13%]\n........................................................................ [ 18%]\n........................................................................ [ 22%]\n........................................................................ [ 27%]\n........................................................................ [ 31%]\n........................................................................ [ 36%]\n........................................................................ [ 41%]\n........................................................................ [ 45%]\n........................................................................ [ 50%]\n........................................................................ [ 54%]\n........................................................................ [ 59%]\n........................................................................ [ 63%]\n........................................................................ [ 68%]\n........................................................................ [ 73%]\n........................................................................ [ 77%]\n........................................................................ [ 82%]\n........................................................................ [ 86%]\n........................................................................ [ 91%]\n........................................................................ [ 95%]\n.................................................................        [100%]\n=============================== warnings summary ===============================\ntests/test_harvest_fleet_runs.py::test_discover_unpacks_a_tarball\ntests/test_harvest_fleet_runs.py::test_two_bundles_unpack_to_separate_directories\ntests/test_harvest_fleet_runs.py::test_two_bundles_unpack_to_separate_directories\ntests/test_harvest_fleet_runs.py::test_a_corrupt_tarball_among_healthy_ones_is_named_and_the_rest_land\ntests/test_harvest_fleet_runs.py::test_an_unreadable_tarball_is_named_in_a_whole_failed_lookup_line\n  /usr/lib/python3.12/tarfile.py:2301: DeprecationWarning: Python 3.14 will, by default, filter extracted tar archives and reject files or modify their metadata. Use the filter argument to control this behavior.\n    warnings.warn(\n\n-- Docs: https://docs.pytest.org/en/stable/how-to/capture-warnings.html\n================= 1577 passed, 5 warnings in 451.42s (0:07:31) =================\n"}, "verdict": "NEEDS_ACK"}

```

### Evidence

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence/run-123/.ultrapowers/runs/123/

- approve-receipt.json
- claude-version.txt
- engine.log
- events.jsonl
- exams
- gate-receipt.json
- kata.jsonl
- pr-body.md
- publish-fold
- receipt.json
- report.json
- residuals.jsonl
- standing-approval.json
- status.json
- transcripts

### Plan

https://github.com/popmechanic/ultrapowers/blob/ultra/plan/run-123/.ultrapowers/plan.md

### Residuals

- [ ] deferred:external — The plan-level Claim's out-of-tree half: "a PR that bumps the plugin to 0.3.27 in both manifests, opened and merged by the sandbox itself, and on its task's hub issue the first note a worker has ever written there" — plus the operator's follow-on `gh release create v0.3.27`. — The tree half of this Claim is complete and verified (both manifests and CLAUDE.md read 0.3.27, diff limited to those three lines). The PR open/merge and the worker's hub-issue comment under `impl:1@run-123` are post-gate run behaviors against the GitHub hub: run-run-123/events.jsonl records no issue- or comment-class event at read time, and no INTEGRATED RUN EVIDENCE block covers them. The tag is explicitly the operator's own step after the merge. None of this is executable from the integrated tree, so it routes to acknowledgement rather than silently passing. [structural false-green: sandbox could not execute it against the target]
- [ ] task 1 reviewer — Footprint note, recorded and accepted, not a defect to fix: the exam lands at `tests/exams/run_123/test_release_0_3_27.py` with a new empty `tests/exams/run_123/__init__.py`, while the Files block declares `Test: tests/test_release_0_3_27.py`. The task's own Context authorizes exactly this ("the examiner writes it under `tests/exams/<run>/` and it stays on the evidence tag"), the factsheet marks the path driver-owned, and the driver's own exam command graded that path (`python3 -m pytest -q tests/exams/run_123/test_release_0_3_27.py`, exit 0). The `__init__.py` is what makes the run's exam directory importable
- [ ] task 1 reviewer — removing it would break the exam, so no patch is proposed. The divergence lives in the task's Files-block spelling versus the run's landing convention, which no edit inside this tree answers.

</details>

