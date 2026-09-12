This is the release of everything the 2026-09-12 sitting landed, and it is also the proof that the landed engine works, because the release itself runs through it. The run changes two version numbers and one line of the project's own instructions, opens a pull request, and merges it with no hand on the button, while the hub shows each step as it happens. If it lands, the engine that now narrates itself live, re-runs a flaky exam before parking, survives an edge hiccup and lets the janitor read the hub can ship itself; if it does not, the release waits and the record says why.

**Merge-ready**

> do: launch the release plan on the merged engine. see: a PR that bumps the plugin to 0.3.26 in both manifests, opened and merged by the sandbox itself, its every event on the hub as it happens; then I tag v0.3.26.

| task | claim | exam | probes | mutant | suite |
|---|---|---|---|---|---|
| 1 | The plugin's version reads 0.3.26 in both places it is written and in the project's own instructions, which still say a release is a plan the fleet runs, merged by the sandbox, then tagged by me. | red at BASE → green | — | — | — |

Residuals: 2 from review

- deferred:external — Task 1 — the plan-level Claim's release flow: "a PR that bumps the plugin to 0.3.26 in both manifests, opened and merged by the sandbox itself, its every event on the hub as it happens" — The tree-side deliverable is complete and verified statically (both manifests and CLAUDE.md:262 read 0.3.26). The PR being opened and squash-merged by the sandbox, and each driver:*/worker:*/engine:phase event landing on the hub project within a minute of its engine ts, are engine behaviors that occur after this read and against github.com and the hub — this read-only environment cannot execute or observe them. The squash title requirement is already met in-tree: HEAD 4ca171fb's subject is the plan's H1 verbatim. [structural false-green: sandbox could not execute it against the target]

<details><summary>Record</summary>

## fleet run-114 — gate-green

| | |
|---|---|
| verdict | `NEEDS_ACK` |
| target | `popmechanic/ultrapowers` at `52b6355149bfd9742f606e4cfb08b64b0e551f41` |
| engine | `52b6355149bfd9742f606e4cfb08b64b0e551f41` |
| plan | `.ultrapowers/plan.md` at `9b1e9840ad8ee907a36ab96c5ed23fb3b1f9e3fe` |
| branch | `ultra/integration-run-114` |
| vm | `fleet-r114-2609122057-d1ec` |

### Checks

```json
{"mode": "gate", "stamp": "run-114", "reportPath": "/home/exedev/target/.claude/ultrapowers/run-run-114/report.json", "branch": "ultra/integration-run-114", "gateCheck": {"verdict": "NEEDS_ACK", "checks": [{"name": "report-parse", "ok": true, "detail": ""}, {"name": "clean-tree", "ok": true, "detail": ""}, {"name": "wave-merges", "ok": true, "detail": ""}, {"name": "head-match", "ok": true, "detail": ""}, {"name": "git-verified", "ok": true, "detail": ""}, {"name": "ancestry", "ok": true, "detail": ""}, {"name": "deliverables", "ok": true, "detail": ""}], "notes": [], "repo": "/home/exedev/target"}, "gateCheckExit": 2, "suite": {"passed": true, "unattributed": [], "output": "============================= test session starts ==============================\nplatform linux -- Python 3.12.3, pytest-7.4.4, pluggy-1.4.0\nrootdir: /home/exedev/target/.claude/ultrapowers/run-run-114/clones/integration\nconfigfile: pytest.ini\ntestpaths: tests\nplugins: xdist-3.4.0\ncreated: 6/6 workers\n6 workers [1554 items]\n\n........................................................................ [  4%]\n........................................................................ [  9%]\n........................................................................ [ 13%]\n........................................................................ [ 18%]\n........................................................................ [ 23%]\n........................................................................ [ 27%]\n........................................................................ [ 32%]\n........................................................................ [ 37%]\n........................................................................ [ 41%]\n........................................................................ [ 46%]\n........................................................................ [ 50%]\n........................................................................ [ 55%]\n........................................................................ [ 60%]\n........................................................................ [ 64%]\n........................................................................ [ 69%]\n........................................................................ [ 74%]\n........................................................................ [ 78%]\n........................................................................ [ 83%]\n........................................................................ [ 88%]\n........................................................................ [ 92%]\n........................................................................ [ 97%]\n..........................................                               [100%]\n=============================== warnings summary ===============================\ntests/test_harvest_fleet_runs.py::test_discover_unpacks_a_tarball\ntests/test_harvest_fleet_runs.py::test_two_bundles_unpack_to_separate_directories\ntests/test_harvest_fleet_runs.py::test_two_bundles_unpack_to_separate_directories\ntests/test_harvest_fleet_runs.py::test_a_corrupt_tarball_among_healthy_ones_is_named_and_the_rest_land\ntests/test_harvest_fleet_runs.py::test_an_unreadable_tarball_is_named_in_a_whole_failed_lookup_line\n  /usr/lib/python3.12/tarfile.py:2301: DeprecationWarning: Python 3.14 will, by default, filter extracted tar archives and reject files or modify their metadata. Use the filter argument to control this behavior.\n    warnings.warn(\n\n-- Docs: https://docs.pytest.org/en/stable/how-to/capture-warnings.html\n================= 1554 passed, 5 warnings in 367.23s (0:06:07) =================\n"}, "verdict": "NEEDS_ACK"}

```

### Evidence

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence/run-114/.ultrapowers/runs/114/

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

https://github.com/popmechanic/ultrapowers/blob/ultra/plan/run-114/.ultrapowers/plan.md

### Residuals

- [ ] deferred:external — Task 1 — the plan-level Claim's release flow: "a PR that bumps the plugin to 0.3.26 in both manifests, opened and merged by the sandbox itself, its every event on the hub as it happens" — The tree-side deliverable is complete and verified statically (both manifests and CLAUDE.md:262 read 0.3.26). The PR being opened and squash-merged by the sandbox, and each driver:*/worker:*/engine:phase event landing on the hub project within a minute of its engine ts, are engine behaviors that occur after this read and against github.com and the hub — this read-only environment cannot execute or observe them. The squash title requirement is already met in-tree: HEAD 4ca171fb's subject is the plan's H1 verbatim. [structural false-green: sandbox could not execute it against the target]
- [ ] task 1 reviewer — Footprint note only: the diff adds `tests/exams/run_114/__init__.py` (an empty package marker), a path outside the declared FILES block. It is the package marker for the exam directory the task's Context authorizes ("the examiner writes it under `tests/exams/<run>/`"), it contains no logic, and `ROOT = HERE.parents[3]` in the exam resolves correctly from that landing path, so no change is needed — it is recorded here because the path is not named in FILES.

</details>

