This is the release of everything the 2026-09-10 sitting landed, and it is also the proof that the landed engine works, because the release itself runs through it. The run changes two version numbers and one paragraph of the project's own instructions, opens a pull request, and merges it with no continuous-integration service and no hand on the button. If it lands, the engine that deleted the ceremony, re-gated the merge, rewrote the card and lit the fleet's page can ship itself; if it does not, the release waits and the record says why.

**Merge-ready**

> do: launch the release plan on the merged engine. see: a PR that bumps the plugin to 0.3.25 in both manifests, opened and merged by the sandbox itself with no CI and no hand merge; then I tag v0.3.25 and the fleet that shipped the queue is the fleet that shipped its own release.

| task | claim | exam | probes | mutant | suite |
|---|---|---|---|---|---|
| 1 | The plugin's version reads 0.3.25 in both places it is written, and the project's instructions say a release is a plan the fleet runs, merged by the sandbox, then tagged by me. | red at BASE → green | — | — | — |

Residuals: 9 from review

- deferred:external — The plan-level Claim's ceremony: "a PR that bumps the plugin to 0.3.25 in both manifests, opened and merged by the sandbox itself with no CI and no hand merge; then I tag v0.3.25" (run-102.md:5), plus the Goal's post-merge `gh release create v0.3.25`. — The tree half of this Claim is met and verified above, but whether the PR is opened and squash-merged by the sandbox with no CI and no hand on the button — and the operator's subsequent tag and release — are acts that happen after this read, against GitHub, and cannot be observed from the integrated tree. [structural false-green: sandbox could not execute it against the target]

<details><summary>Record</summary>

## fleet run-102 — gate-green

| | |
|---|---|
| verdict | `NEEDS_ACK` |
| target | `popmechanic/ultrapowers` at `00a431193fe97368e5ba5ae5829ef996889959e7` |
| engine | `00a431193fe97368e5ba5ae5829ef996889959e7` |
| plan | `.ultrapowers/plan.md` at `6f44fb655585bd0d0c490ffeb7dabb3006f36a19` |
| branch | `ultra/integration-run-102` |
| vm | `fleet-r102-2609111744-483d` |

### Checks

```json
{"mode": "gate", "stamp": "run-102", "reportPath": "/home/exedev/target/.claude/ultrapowers/run-run-102/report.json", "branch": "ultra/integration-run-102", "gateCheck": {"verdict": "NEEDS_ACK", "checks": [{"name": "report-parse", "ok": true, "detail": ""}, {"name": "clean-tree", "ok": true, "detail": ""}, {"name": "wave-merges", "ok": true, "detail": ""}, {"name": "head-match", "ok": true, "detail": ""}, {"name": "git-verified", "ok": true, "detail": ""}, {"name": "ancestry", "ok": true, "detail": ""}, {"name": "deliverables", "ok": true, "detail": ""}], "repo": "/home/exedev/target"}, "gateCheckExit": 2, "suite": {"passed": true, "unattributed": [], "output": "============================= test session starts ==============================\nplatform linux -- Python 3.12.3, pytest-7.4.4, pluggy-1.4.0\nrootdir: /home/exedev/target/.claude/ultrapowers/run-run-102/clones/integration\nconfigfile: pytest.ini\ntestpaths: tests\nplugins: xdist-3.4.0\ncreated: 6/6 workers\n6 workers [1632 items]\n\n........................................................................ [  4%]\n........................................................................ [  8%]\n........................................................................ [ 13%]\n........................................................................ [ 17%]\n........................................................................ [ 22%]\n........................................................................ [ 26%]\n........................................................................ [ 30%]\n........................................................................ [ 35%]\n........................................................................ [ 39%]\n........................................................................ [ 44%]\n........................................................................ [ 48%]\n........................................................................ [ 52%]\n........................................................................ [ 57%]\n........................................................................ [ 61%]\n........................................................................ [ 66%]\n........................................................................ [ 70%]\n........................................................................ [ 75%]\n........................................................................ [ 79%]\n........................................................................ [ 83%]\n........................................................................ [ 88%]\n........................................................................ [ 92%]\n........................................................................ [ 97%]\n................................................                         [100%]\n=============================== warnings summary ===============================\ntests/test_harvest_fleet_runs.py::test_two_bundles_unpack_to_separate_directories\ntests/test_harvest_fleet_runs.py::test_two_bundles_unpack_to_separate_directories\ntests/test_harvest_fleet_runs.py::test_a_corrupt_tarball_among_healthy_ones_is_named_and_the_rest_land\ntests/test_harvest_fleet_runs.py::test_an_unreadable_tarball_is_named_in_a_whole_failed_lookup_line\ntests/test_harvest_fleet_runs.py::test_discover_unpacks_a_tarball\n  /usr/lib/python3.12/tarfile.py:2301: DeprecationWarning: Python 3.14 will, by default, filter extracted tar archives and reject files or modify their metadata. Use the filter argument to control this behavior.\n    warnings.warn(\n\n-- Docs: https://docs.pytest.org/en/stable/how-to/capture-warnings.html\n================= 1632 passed, 5 warnings in 385.81s (0:06:25) =================\n"}, "verdict": "NEEDS_ACK"}

```

### Evidence

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence/run-102/.ultrapowers/runs/102/

- approve-receipt.json
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
- standing-approval.json
- status.json
- transcripts

### Plan

https://github.com/popmechanic/ultrapowers/blob/ultra/plan/run-102/.ultrapowers/plan.md

### Residuals

- [ ] deferred:external — The plan-level Claim's ceremony: "a PR that bumps the plugin to 0.3.25 in both manifests, opened and merged by the sandbox itself with no CI and no hand merge; then I tag v0.3.25" (run-102.md:5), plus the Goal's post-merge `gh release create v0.3.25`. — The tree half of this Claim is met and verified above, but whether the PR is opened and squash-merged by the sandbox with no CI and no hand on the button — and the operator's subsequent tag and release — are acts that happen after this read, against GitHub, and cannot be observed from the integrated tree. [structural false-green: sandbox could not execute it against the target]
- [ ] task 1 reviewer — Exam soft spot (advisory only — this run's exam evidence shows 8 passed, 0 skipped, so every leg actually ran). In tests/exams/run_102/test_release_0_3_25.py, `_read_base` returns None whenever `git show <base>:<path>` fails, and the two "changed nothing but the version" tests (`test_leg_a_plugin_json_changed_nothing_but_the_version`, `test_leg_a_marketplace_json_changed_nothing_but_the_version`) then `pytest.skip`. On any clone where the BASE object is not reachable — a shallow checkout, or the evidence tag fetched without history — the strongest half of leg (a) [M1] ("no other key in either file changes") turns green by vanishing rather than by being checked. Since the first `Run:` command already carries the same deep-equal assertion and exited 0 here, M1 is settled for this submission
- [ ] task 1 reviewer — the note is for anyone re-running the exam elsewhere. If it is ever re-run, prefer failing the test when BASE is unreachable (`pytest.fail`) over skipping it.
- [ ] task 1 reviewer — Recorded, not a defect: the driver's footprint arithmetic flags `tests/exams/run_102/__init__.py` and `tests/exams/run_102/test_release_0_3_25.py` as paths outside FILES (which names the exam as `tests/test_release_0_3_25.py`). The task's own Context authorizes exactly this relocation — "it is unguarded (a one-run fact), so the examiner writes it under `tests/exams/<run>/` and it stays on the evidence tag" — and the driver's exam-files line confirms `tests/test_release_0_3_25.py at tests/exams/run_102/test_release_0_3_25.py exists
- [ ] task 1 reviewer — exam ran, exit 0`. The `__init__.py` is the package marker that placement requires. No edit is needed
- [ ] task 1 reviewer — this entry exists so the operator reading the run report does not re-open the footprint line.
- [ ] task 1 reviewer — Exam hygiene (advisory, no change required): the two "changed nothing but the version" legs in tests/exams/run_102/test_release_0_3_25.py (test_leg_a_plugin_json_changed_nothing_but_the_version, test_leg_a_marketplace_json_changed_nothing_but_the_version) call pytest.skip when `git show <BASE_SHA>:<path>` fails, and BASE_SHA is hard-coded to 00a43119 with only $ULTRA_BASE overriding it. On a clone where that object is unreachable (shallow fetch, evidence tag without the base commit) both legs degrade to a silent skip rather than a failure, so M1's "no other key in either file changes" half would be vacuously green there. In this run it did not bite — EXAM EVIDENCE shows 8 passed / 0 skipped, and the Proof's first `Run:` independently deep-equals both BASE documents against the tree at exit 0 — so M1 is settled on this tree. Recorded only because the exam file rides the evidence tag.
- [ ] task 1 reviewer — path outside FILES: `tests/exams/run_102/__init__.py`
- [ ] task 1 reviewer — path outside FILES: `tests/exams/run_102/test_release_0_3_25.py`

</details>

Closes #886
Closes #892
Closes #887
