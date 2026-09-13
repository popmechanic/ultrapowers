This makes the status page's phase cell report only what the run itself is doing. It exists because during run-114 the page and the Viz index read a failed hub write as if it were the run's phase, the moment the proxy started answering 502s. After this run a glance at the page tells you which wave and which worker the run is on, and a bookkeeping hiccup never dresses itself up as progress.

**Merge-ready**

> do: open a run's status page or the Viz index while the hub proxy is failing its writes. see: the phase cell still names the wave and the worker or driver step the run is on, never a kata, transcript, log or capture line.

| task | claim | exam | probes | mutant | suite |
|---|---|---|---|---|---|
| 1 | The projection skips event kinds that are not the run's own progress — `kata:*`, `transcript:*`, `engine:log`, `capture:*` — and takes the last `driver:*`/`worker:*` kind instead (or the last `engine:phase` alone when none has landed since). | red at BASE → green | — | — | — |

Residuals: 3 from review

<details><summary>Record</summary>

## fleet run-116 — gate-green

| | |
|---|---|
| verdict | `PASS` |
| target | `popmechanic/ultrapowers` at `f881d56e0175faa043b1e876773705506c99d318` |
| engine | `f881d56e0175faa043b1e876773705506c99d318` |
| plan | `.ultrapowers/plan.md` at `c4dac55e74c2f50eddabfcffd4c239c8b49e731c` |
| branch | `ultra/integration-run-116` |
| vm | `fleet-r116-2609131548-1931` |

### Checks

```json
{"mode": "gate", "stamp": "run-116", "reportPath": "/home/exedev/target/.claude/ultrapowers/run-run-116/report.json", "branch": "ultra/integration-run-116", "gateCheck": {"verdict": "PASS", "checks": [{"name": "report-parse", "ok": true, "detail": ""}, {"name": "clean-tree", "ok": true, "detail": ""}, {"name": "wave-merges", "ok": true, "detail": ""}, {"name": "head-match", "ok": true, "detail": ""}, {"name": "git-verified", "ok": true, "detail": ""}, {"name": "ancestry", "ok": true, "detail": ""}, {"name": "deliverables", "ok": true, "detail": ""}], "notes": [], "repo": "/home/exedev/target"}, "gateCheckExit": 0, "suite": {"passed": true, "unattributed": [], "output": "============================= test session starts ==============================\nplatform linux -- Python 3.12.3, pytest-7.4.4, pluggy-1.4.0\nrootdir: /home/exedev/target/.claude/ultrapowers/run-run-116/clones/integration\nconfigfile: pytest.ini\ntestpaths: tests\nplugins: xdist-3.4.0\ncreated: 6/6 workers\n6 workers [1561 items]\n\n........................................................................ [  4%]\n........................................................................ [  9%]\n........................................................................ [ 13%]\n........................................................................ [ 18%]\n........................................................................ [ 23%]\n........................................................................ [ 27%]\n........................................................................ [ 32%]\n........................................................................ [ 36%]\n........................................................................ [ 41%]\n........................................................................ [ 46%]\n........................................................................ [ 50%]\n........................................................................ [ 55%]\n........................................................................ [ 59%]\n........................................................................ [ 64%]\n........................................................................ [ 69%]\n........................................................................ [ 73%]\n........................................................................ [ 78%]\n........................................................................ [ 83%]\n........................................................................ [ 87%]\n........................................................................ [ 92%]\n........................................................................ [ 96%]\n.................................................                        [100%]\n=============================== warnings summary ===============================\ntests/test_harvest_fleet_runs.py::test_discover_unpacks_a_tarball\ntests/test_harvest_fleet_runs.py::test_two_bundles_unpack_to_separate_directories\ntests/test_harvest_fleet_runs.py::test_two_bundles_unpack_to_separate_directories\ntests/test_harvest_fleet_runs.py::test_a_corrupt_tarball_among_healthy_ones_is_named_and_the_rest_land\ntests/test_harvest_fleet_runs.py::test_an_unreadable_tarball_is_named_in_a_whole_failed_lookup_line\n  /usr/lib/python3.12/tarfile.py:2301: DeprecationWarning: Python 3.14 will, by default, filter extracted tar archives and reject files or modify their metadata. Use the filter argument to control this behavior.\n    warnings.warn(\n\n-- Docs: https://docs.pytest.org/en/stable/how-to/capture-warnings.html\n================= 1561 passed, 5 warnings in 377.79s (0:06:17) =================\n"}, "verdict": "PASS"}

```

### Evidence

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence/run-116/.ultrapowers/runs/116/

- approve-receipt.json
- claude-version.txt
- engine.log
- events.jsonl
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

https://github.com/popmechanic/ultrapowers/blob/ultra/plan/run-116/.ultrapowers/plan.md

### Residuals

- [ ] task 1 reviewer — concern: plan-defect: leg (e) asks the `**status.json:**` bullet to name the skipped kinds, but the sim's pre-existing case (f) asserts that same bullet contains no literal `engine:phase` (shNo grep -q 'engine:phase'). I resolved it by writing the sentence with "that phase event" instead of the literal kind name
- [ ] task 1 reviewer — the bullet still matches both leg (e) regexes (`kata:\*.*transcript:\*.*engine:log.*capture:\*` and `driver:\*./.worker:\*`) and case (f) stays green. An exam that instead requires the literal `engine:phase` in that bullet would collide with case (f) as written at BASE.
- [ ] task 1 reviewer — concern: KATA_REF is unset in this environment, so no kata comment or label was written.

</details>

Closes #952
