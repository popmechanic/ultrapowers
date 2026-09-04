## fleet run-2 — parked

| | |
|---|---|
| verdict | `BLOCKED` |
| target | `popmechanic/ultrapowers` at `2cc873fb2d040fbe081f35ff0ababc408eaa6500` |
| engine | `2cc873fb2d040fbe081f35ff0ababc408eaa6500` |
| plan | `.ultrapowers/plan.md` at `9750df5d73726cccfa75fd0604a1e639ec57f889` |
| branch | `ultra/integration-run-2` |
| vm | `fleet-r2-2609040859-2052` |

### Checks

```json
{
  "mode": "gate",
  "stamp": "run-2",
  "reportPath": "/home/exedev/target/.claude/ultrapowers/run-run-2/report.json",
  "branch": "ultra/integration-run-2",
  "gateCheck": {
    "verdict": "BLOCKED",
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
        "ok": false,
        "detail": "failed/blocked tasks left declared deliverables unproduced: [{\"task\": \"1\", \"files\": [\"skills/ultralearn/SKILL.md\", \"skills/ultralearn/scripts/_readers.py\", \"skills/ultralearn/scripts/fleet_slice.py\", \"skills/ultralearn/scripts/harvest_fleet_runs.py\", \"skills/ultralearn/scripts/harvest_runs.py\", \"tests/test_harvest_fleet_runs.py\", \"tests/test_harvest_runs.py\"]}]"
      }
    ],
    "acks": [
      {
        "type": "coverage",
        "detail": "green suite but 1/2 tasks merged \u2014 a passing suite over an incomplete merge is a false-green"
      }
    ],
    "repo": "/home/exedev/target"
  },
  "gateCheckExit": 1,
  "acceptance": {
    "disposition": "suite",
    "exit": 0,
    "output": "{\"sealId\": \"(suite)\", \"status\": \"OK\", \"passed\": true, \"exitCode\": 0, \"output\": \"============================= test session starts ==============================\\nplatform linux -- Python 3.12.3, pytest-7.4.4, pluggy-1.4.0\\nrootdir: /tmp/tmp.FZvwETlVnc/suite-gate\\nconfigfile: pytest.ini\\ntestpaths: tests\\nplugins: xdist-3.4.0\\ncreated: 4/4 workers\\n4 workers [1469 items]\\n\\n........................................................................ [  4%]\\n........................................................................ [  9%]\\n........................................................................ [ 14%]\\n........................................................................ [ 19%]\\n........................................................................ [ 24%]\\n........................................................................ [ 29%]\\n........................................................................ [ 34%]\\n........................................................................ [ 39%]\\n........................................................................ [ 44%]\\n........................................................................ [ 49%]\\n........................................................................ [ 53%]\\n........................................................................ [ 58%]\\n........................................................................ [ 63%]\\n........................................................................ [ 68%]\\n........................................................................ [ 73%]\\n........................................................................ [ 78%]\\n........................................................................ [ 83%]\\n........................................................................ [ 88%]\\n........................................................................ [ 93%]\\n........................................................................ [ 98%]\\n.............................                                            [100%]\\n=============================== warnings summary ===============================\\ntests/test_harvest_fleet_runs.py::test_discover_unpacks_a_tarball\\ntests/test_harvest_fleet_runs.py::test_two_bundles_unpack_to_separate_directories\\ntests/test_harvest_fleet_runs.py::test_two_bundles_unpack_to_separate_directories\\ntests/test_harvest_fleet_runs.py::test_a_corrupt_tarball_among_healthy_ones_is_named_and_the_rest_land\\ntests/test_harvest_fleet_runs.py::test_an_unreadable_tarball_is_named_in_a_whole_failed_lookup_line\\n  /usr/lib/python3.12/tarfile.py:2301: DeprecationWarning: Python 3.14 will, by default, filter extracted tar archives and reject files or modify their metadata. Use the filter argument to control this behavior.\\n    warnings.warn(\\n\\n-- Docs: https://docs.pytest.org/en/stable/how-to/capture-warnings.html\\n================= 1469 passed, 5 warnings in 104.74s (0:01:44) =================\"}\n"
  },
  "verdict": "BLOCKED"
}
```

### Evidence

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence-run-2/.ultrapowers/runs/2/

- engine.log
- events.jsonl
- gate-receipt.json
- pr-body.md
- receipt.json
- report.json
- status.json

### Plan

https://github.com/popmechanic/ultrapowers/blob/ultra/plan-run-2/.ultrapowers/plan.md
