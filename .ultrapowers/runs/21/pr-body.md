## fleet run-21 — gate-green

| | |
|---|---|
| verdict | `PASS` |
| target | `popmechanic/ultrapowers` at `e04154b702407ac1efabaa22db6e21eab706a5f1` |
| engine | `e04154b702407ac1efabaa22db6e21eab706a5f1` |
| plan | `.ultrapowers/plan.md` at `f54977dae7c2d4bc8b10fef3506ccbfdd23bab2e` |
| branch | `ultra/integration-run-21` |
| vm | `fleet-r21-2609051932-02a4` |

### Checks

```json
{
  "mode": "gate",
  "stamp": "run-21",
  "reportPath": "/home/exedev/target/.claude/ultrapowers/run-run-21/report.json",
  "branch": "ultra/integration-run-21",
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
    "output": "{\"sealId\": \"(suite)\", \"status\": \"OK\", \"passed\": true, \"exitCode\": 0, \"output\": \"============================= test session starts ==============================\\nplatform linux -- Python 3.12.3, pytest-7.4.4, pluggy-1.4.0\\nrootdir: /tmp/tmp.s4ktdI1vRZ/suite-gate\\nconfigfile: pytest.ini\\ntestpaths: tests\\nplugins: xdist-3.4.0\\ncreated: 4/4 workers\\n4 workers [1643 items]\\n\\n........................................................................ [  4%]\\n........................................................................ [  8%]\\n........................................................................ [ 13%]\\n........................................................................ [ 17%]\\n........................................................................ [ 21%]\\n........................................................................ [ 26%]\\n........................................................................ [ 30%]\\n........................................................................ [ 35%]\\n........................................................................ [ 39%]\\n........................................................................ [ 43%]\\n........................................................................ [ 48%]\\n........................................................................ [ 52%]\\n........................................................................ [ 56%]\\n........................................................................ [ 61%]\\n........................................................................ [ 65%]\\n........................................................................ [ 70%]\\n........................................................................ [ 74%]\\n........................................................................ [ 78%]\\n........................................................................ [ 83%]\\n........................................................................ [ 87%]\\n........................................................................ [ 92%]\\n........................................................................ [ 96%]\\n...........................................................              [100%]\\n=============================== warnings summary ===============================\\ntests/test_harvest_fleet_runs.py::test_two_bundles_unpack_to_separate_directories\\ntests/test_harvest_fleet_runs.py::test_two_bundles_unpack_to_separate_directories\\ntests/test_harvest_fleet_runs.py::test_a_corrupt_tarball_among_healthy_ones_is_named_and_the_rest_land\\ntests/test_harvest_fleet_runs.py::test_an_unreadable_tarball_is_named_in_a_whole_failed_lookup_line\\ntests/test_harvest_fleet_runs.py::test_discover_unpacks_a_tarball\\n  /usr/lib/python3.12/tarfile.py:2301: DeprecationWarning: Python 3.14 will, by default, filter extracted tar archives and reject files or modify their metadata. Use the filter argument to control this behavior.\\n    warnings.warn(\\n\\n-- Docs: https://docs.pytest.org/en/stable/how-to/capture-warnings.html\\n================= 1643 passed, 5 warnings in 127.61s (0:02:07) =================\"}\n"
  },
  "verdict": "PASS"
}
```

### Evidence

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence-run-21/.ultrapowers/runs/21/

- approve-receipt.json
- engine.log
- events.jsonl
- gate-receipt.json
- pr-body.md
- receipt.json
- report.json
- status.json

### Plan

https://github.com/popmechanic/ultrapowers/blob/ultra/plan-run-21/.ultrapowers/plan.md
