## fleet run-1 — parked

| | |
|---|---|
| verdict | `NEEDS_ACK` |
| target | `popmechanic/ultrapowers` at `2cc873fb2d040fbe081f35ff0ababc408eaa6500` |
| engine | `2cc873fb2d040fbe081f35ff0ababc408eaa6500` |
| plan | `.ultrapowers/plan.md` at `cd9008ae43ddc38f8d8c1a6ea9a7f104c165cf4c` |
| branch | `ultra/integration-run-1` |
| vm | `fleet-r1-2609040858-6370` |

### Checks

```json
{
  "mode": "gate",
  "stamp": "run-1",
  "reportPath": "/home/exedev/target/.claude/ultrapowers/run-run-1/report.json",
  "branch": "ultra/integration-run-1",
  "gateCheck": {
    "verdict": "NEEDS_ACK",
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
    "acks": [
      {
        "type": "deferred:external",
        "detail": "Driver-side execution of the `constraintChecks` entries compile_plan.py now emits (task 1), and the `(minor)` recorded-never-dispatched behavior SKILL.md documents (task 3, M3). \u2014 The executor is scoped to the concurrent engine plan `2026-09-04-judging-waste.md`; no code in this tree reads the key, so the run-in-every-clone / once-on-the-adopted-tree / minor-not-dispatched behavior cannot be exercised here. Everything on this run's side of that seam is verified: the parse, the three payloads, and the refusal are covered by `tests/test_compile_plan_check_constraints.py`, which the driver's `python3 -m pytest -n auto` ran green. [structural false-green: sandbox could not execute it against the target]"
      }
    ],
    "repo": "/home/exedev/target"
  },
  "gateCheckExit": 2,
  "acceptance": {
    "disposition": "suite",
    "exit": 0,
    "output": "{\"sealId\": \"(suite)\", \"status\": \"OK\", \"passed\": true, \"exitCode\": 0, \"output\": \"============================= test session starts ==============================\\nplatform linux -- Python 3.12.3, pytest-7.4.4, pluggy-1.4.0\\nrootdir: /tmp/tmp.BClCO4Eo6H/suite-gate\\nconfigfile: pytest.ini\\ntestpaths: tests\\nplugins: xdist-3.4.0\\ncreated: 4/4 workers\\n4 workers [1512 items]\\n\\n........................................................................ [  4%]\\n........................................................................ [  9%]\\n........................................................................ [ 14%]\\n........................................................................ [ 19%]\\n........................................................................ [ 23%]\\n........................................................................ [ 28%]\\n........................................................................ [ 33%]\\n........................................................................ [ 38%]\\n........................................................................ [ 42%]\\n........................................................................ [ 47%]\\n........................................................................ [ 52%]\\n........................................................................ [ 57%]\\n........................................................................ [ 61%]\\n........................................................................ [ 66%]\\n........................................................................ [ 71%]\\n........................................................................ [ 76%]\\n........................................................................ [ 80%]\\n........................................................................ [ 85%]\\n........................................................................ [ 90%]\\n........................................................................ [ 95%]\\n........................................................................ [100%]\\n=============================== warnings summary ===============================\\ntests/test_harvest_fleet_runs.py::test_discover_unpacks_a_tarball\\ntests/test_harvest_fleet_runs.py::test_two_bundles_unpack_to_separate_directories\\ntests/test_harvest_fleet_runs.py::test_two_bundles_unpack_to_separate_directories\\ntests/test_harvest_fleet_runs.py::test_a_corrupt_tarball_among_healthy_ones_is_named_and_the_rest_land\\ntests/test_harvest_fleet_runs.py::test_an_unreadable_tarball_is_named_in_a_whole_failed_lookup_line\\n  /usr/lib/python3.12/tarfile.py:2301: DeprecationWarning: Python 3.14 will, by default, filter extracted tar archives and reject files or modify their metadata. Use the filter argument to control this behavior.\\n    warnings.warn(\\n\\n-- Docs: https://docs.pytest.org/en/stable/how-to/capture-warnings.html\\n================= 1512 passed, 5 warnings in 152.17s (0:02:32) =================\"}\n"
  },
  "verdict": "NEEDS_ACK"
}
```

### Evidence

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence-run-1/.ultrapowers/runs/1/

- engine.log
- events.jsonl
- gate-receipt.json
- pr-body.md
- receipt.json
- report.json
- status.json

### Plan

https://github.com/popmechanic/ultrapowers/blob/ultra/plan-run-1/.ultrapowers/plan.md
