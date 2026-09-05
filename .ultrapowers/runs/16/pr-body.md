## fleet run-16 — gate-green

| | |
|---|---|
| verdict | `PASS` |
| target | `popmechanic/ultrapowers` at `c32c08f9129b3266de17168678fd539d0723bb76` |
| engine | `c32c08f9129b3266de17168678fd539d0723bb76` |
| plan | `.ultrapowers/plan.md` at `97ba8436e3561d639b5835dbefb1c6671e0a6324` |
| branch | `ultra/integration-run-16` |
| vm | `fleet-r16-2609050926-f406` |

### Checks

```json
{
  "mode": "gate",
  "stamp": "run-16",
  "reportPath": "/home/exedev/target/.claude/ultrapowers/run-run-16/report.json",
  "branch": "ultra/integration-run-16",
  "gateCheck": {
    "verdict": "PASS",
    "checks": [
      {
        "name": "report-parse",
        "ok": true,
        "detail": ""
      },
      {
        "name": "clean-tree",
        "ok": true,
        "detail": ""
      },
      {
        "name": "wave-merges",
        "ok": true,
        "detail": ""
      },
      {
        "name": "head-match",
        "ok": true,
        "detail": ""
      },
      {
        "name": "git-verified",
        "ok": true,
        "detail": ""
      },
      {
        "name": "ancestry",
        "ok": true,
        "detail": ""
      },
      {
        "name": "deliverables",
        "ok": true,
        "detail": ""
      }
    ],
    "acks": [],
    "repo": "/home/exedev/target"
  },
  "gateCheckExit": 0,
  "acceptance": {
    "disposition": "suite",
    "exit": 0,
    "output": "{\"sealId\": \"(suite)\", \"status\": \"OK\", \"passed\": true, \"exitCode\": 0, \"output\": \"============================= test session starts ==============================\\nplatform linux -- Python 3.12.3, pytest-7.4.4, pluggy-1.4.0\\nrootdir: /tmp/tmp.TXtv8IC4pC/suite-gate\\nconfigfile: pytest.ini\\ntestpaths: tests\\nplugins: xdist-3.4.0\\ncreated: 8/8 workers\\n8 workers [1545 items]\\n\\n........................................................................ [  4%]\\n........................................................................ [  9%]\\n........................................................................ [ 13%]\\n........................................................................ [ 18%]\\n......................................................................... [ 23%]\\n........................................................................ [ 28%]\\n........................................................................ [ 32%]\\n........................................................................ [ 37%]\\n........................................................................ [ 42%]\\n........................................................................ [ 46%]\\n........................................................................ [ 51%]\\n........................................................................ [ 55%]\\n........................................................................ [ 60%]\\n........................................................................ [ 65%]\\n........................................................................ [ 69%]\\n........................................................................ [ 74%]\\n........................................................................ [ 79%]\\n........................................................................ [ 83%]\\n........................................................................ [ 88%]\\n........................................................................ [ 93%]\\n........................................................................ [ 97%]\\n................................                                         [100%]\\n=============================== warnings summary ===============================\\ntests/test_harvest_fleet_runs.py::test_discover_unpacks_a_tarball\\ntests/test_harvest_fleet_runs.py::test_two_bundles_unpack_to_separate_directories\\ntests/test_harvest_fleet_runs.py::test_two_bundles_unpack_to_separate_directories\\ntests/test_harvest_fleet_runs.py::test_a_corrupt_tarball_among_healthy_ones_is_named_and_the_rest_land\\ntests/test_harvest_fleet_runs.py::test_an_unreadable_tarball_is_named_in_a_whole_failed_lookup_line\\n  /usr/lib/python3.12/tarfile.py:2301: DeprecationWarning: Python 3.14 will, by default, filter extracted tar archives and reject files or modify their metadata. Use the filter argument to control this behavior.\\n    warnings.warn(\\n\\n-- Docs: https://docs.pytest.org/en/stable/how-to/capture-warnings.html\\n================= 1545 passed, 5 warnings in 96.71s (0:01:36) ==================\"}\n"
  },
  "verdict": "PASS"
}
```

### Evidence

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence-run-16/.ultrapowers/runs/16/

- engine.log
- events.jsonl
- gate-receipt.json
- pr-body.md
- receipt.json
- report.json
- status.json

### Plan

https://github.com/popmechanic/ultrapowers/blob/ultra/plan-run-16/.ultrapowers/plan.md
