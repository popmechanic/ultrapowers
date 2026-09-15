This is the release of the 2026-09-14 and 2026-09-15 sittings, run through the engine it releases. The wave loop is gone: a task is dispatched as soon as its predecessors are adopted, a stuck worker re-edges instead of failing, a fold happens only when it makes a task ready, ends the run, or a result has waited a suite's length, and the kata hub holds one project per target with every run's issue filed beside the last. Alongside it the compiler evaluates a plan's Stale-if lines at the launch base, the interaction exam reaches ultrawrite, the report reference describes the engine as it is, and a relaunch reuses the tasks a parked run already finished.

**Merge-ready**

> After this run 0.3.29 is released: a task starts the moment what it depends on has folded in, a fold is paid only when it releases work, and a plan I relaunch files on the hub beside its earlier run instead of being refused.

| task | claim | exam | probes | mutant | suite |
|---|---|---|---|---|---|
| 1 | The plugin's version reads 0.3.29 in both places it is written and in the project's own instructions, which still say a release is a plan the fleet runs, merged by the sandbox, then tagged by the operator. | red at BASE → green | — | — | — |

Residuals: 3 from review

<details><summary>Record</summary>

## fleet run-142 — gate-green

| | |
|---|---|
| verdict | `PASS` |
| target | `popmechanic/ultrapowers` at `fdb2dd2755ada15c8a00159ea9919c3bf6b2ae2a` |
| engine | `fdb2dd2755ada15c8a00159ea9919c3bf6b2ae2a` |
| plan | `.ultrapowers/plan.md` at `266cc49016c87f5b1e6175c5bf964b9b0a889392` |
| branch | `ultra/integration-run-142` |
| vm | `fleet-r142-2609151623-e267` |

### Checks

```json
{"mode": "gate", "stamp": "run-142", "reportPath": "/home/exedev/target/.claude/ultrapowers/run-run-142/report.json", "branch": "ultra/integration-run-142", "gateCheck": {"verdict": "PASS", "checks": [{"name": "report-parse", "ok": true, "detail": ""}, {"name": "clean-tree", "ok": true, "detail": ""}, {"name": "wave-merges", "ok": true, "detail": ""}, {"name": "head-match", "ok": true, "detail": ""}, {"name": "git-verified", "ok": true, "detail": ""}, {"name": "ancestry", "ok": true, "detail": ""}, {"name": "deliverables", "ok": true, "detail": ""}], "notes": [], "repo": "/home/exedev/target"}, "gateCheckExit": 0, "suite": {"passed": true, "unattributed": [], "output": "============================= test session starts ==============================\nplatform linux -- Python 3.12.3, pytest-7.4.4, pluggy-1.4.0\nrootdir: /home/exedev/target/.claude/ultrapowers/run-run-142/clones/integration\nconfigfile: pytest.ini\ntestpaths: tests\nplugins: xdist-3.4.0\ncreated: 3/3 workers\n3 workers [188 items]\n\n........................................................................ [ 38%]\n........................................................................ [ 76%]\n............................................                             [100%]\n============================= 188 passed in 45.83s =============================\n"}, "verdict": "PASS"}

```

### Evidence

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence/run-142/.ultrapowers/runs/142/

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
- status.json
- transcripts

### Plan

https://github.com/popmechanic/ultrapowers/blob/ultra/plan/run-142/.ultrapowers/plan.md

### Residuals

- [ ] task 1 reviewer — Footprint note: the diff adds an empty package marker `tests/exams/run_142/__init__.py`, a path outside the task's FILES list (which names the exam as `tests/test_release_0_3_29.py`). No change is required — the task's Context relocates the exam to `tests/exams/<run>/`, M3 and the fifth `Run:` line both explicitly admit anything under `tests/exams/`, and the footprint check exited 0 with the file present. Recording it so the run report shows the complete footprint rather than the three modified files alone.
- [ ] task 1 reviewer — unverified: the Claim's prose content — that CLAUDE.md still says a release is a plan the fleet runs, merged by the sandbox, then tagged by the operator — is established only by substring greps (`a release is a fleet plan`, `merged by the`, `gh release create`), which would also pass over surrounding prose that contradicted them. This diff touches exactly one line of CLAUDE.md and leaves the rest of the bullet at BASE, so nothing in the patch can have broken it
- [ ] task 1 reviewer — what would settle it fully is a reading of the whole bullet, which is outside what this diff changed.

</details>

