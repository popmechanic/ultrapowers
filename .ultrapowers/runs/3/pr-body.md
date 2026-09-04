## fleet run-3 — gate-green

| | |
|---|---|
| verdict | `PASS` |
| target | `popmechanic/ultrapowers` at `2cc873fb2d040fbe081f35ff0ababc408eaa6500` |
| engine | `2cc873fb2d040fbe081f35ff0ababc408eaa6500` |
| plan | `.ultrapowers/plan.md` at `65dc7f50bff7e36ae6ada43aa83ee7103014c93d` |
| branch | `ultra/integration-run-3` |
| vm | `fleet-r3-2609040904-f56b` |

### Checks

```json
{
  "mode": "gate",
  "stamp": "run-3",
  "reportPath": "/home/exedev/target/.claude/ultrapowers/run-run-3/report.json",
  "branch": "ultra/integration-run-3",
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
    "output": "{\"sealId\": \"(suite)\", \"status\": \"OK\", \"passed\": true, \"exitCode\": 0, \"output\": \"============================= test session starts ==============================\\nplatform linux -- Python 3.12.3, pytest-7.4.4, pluggy-1.4.0\\nrootdir: /tmp/tmp.HMqPFLjcbe/suite-gate\\nconfigfile: pytest.ini\\ntestpaths: tests\\nplugins: xdist-3.4.0\\ncreated: 8/8 workers\\n8 workers [1475 items]\\n\\n........................................................................ [  4%]\\n......................................................................... [  9%]\\n........................................................................ [ 14%]\\n........................................................................ [ 19%]\\n........................................................................ [ 24%]\\n........................................................................ [ 29%]\\n........................................................................ [ 34%]\\n........................................................................ [ 39%]\\n........................................................................ [ 44%]\\n........................................................................ [ 48%]\\n........................................................................ [ 53%]\\n........................................................................ [ 58%]\\n........................................................................ [ 63%]\\n........................................................................ [ 68%]\\n........................................................................ [ 73%]\\n........................................................................ [ 78%]\\n........................................................................ [ 83%]\\n........................................................................ [ 87%]\\n........................................................................ [ 92%]\\n........................................................................ [ 97%]\\n..................................                                       [100%]\\n=============================== warnings summary ===============================\\ntests/test_harvest_fleet_runs.py::test_discover_unpacks_a_tarball\\ntests/test_harvest_fleet_runs.py::test_two_bundles_unpack_to_separate_directories\\ntests/test_harvest_fleet_runs.py::test_two_bundles_unpack_to_separate_directories\\ntests/test_harvest_fleet_runs.py::test_a_corrupt_tarball_among_healthy_ones_is_named_and_the_rest_land\\ntests/test_harvest_fleet_runs.py::test_an_unreadable_tarball_is_named_in_a_whole_failed_lookup_line\\n  /usr/lib/python3.12/tarfile.py:2301: DeprecationWarning: Python 3.14 will, by default, filter extracted tar archives and reject files or modify their metadata. Use the filter argument to control this behavior.\\n    warnings.warn(\\n\\n-- Docs: https://docs.pytest.org/en/stable/how-to/capture-warnings.html\\n================= 1475 passed, 5 warnings in 136.99s (0:02:16) =================\"}\n"
  },
  "verdict": "PASS"
}
```

### Evidence

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence-run-3/.ultrapowers/runs/3/

- engine.log
- events.jsonl
- gate-receipt.json
- pr-body.md
- receipt.json
- report.json
- status.json

### Plan

https://github.com/popmechanic/ultrapowers/blob/ultra/plan-run-3/.ultrapowers/plan.md
