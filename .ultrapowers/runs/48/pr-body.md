## fleet run-48 — gate-green

| | |
|---|---|
| verdict | `NEEDS_ACK` |
| target | `popmechanic/ultrapowers` at `9395cd11d6b6e0e1b1e5195b5702956d6faf88f6` |
| engine | `9395cd11d6b6e0e1b1e5195b5702956d6faf88f6` |
| plan | `.ultrapowers/plan.md` at `e9afb722f036dc99d46cb4cd31c386e4949664a9` |
| branch | `ultra/integration-run-48` |
| vm | `fleet-r48-2609080654-03dc` |

### Checks

```json
{
  "mode": "gate",
  "stamp": "run-48",
  "reportPath": "/home/exedev/target/.claude/ultrapowers/run-run-48/report.json",
  "branch": "ultra/integration-run-48",
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
        "detail": "skills/ultrawrite/scripts/check_provenance.py \u2014 plan-level `(quoted from #NNN)` resolution against real GitHub (Task 1, Claim clause 2 / M3 / M4) \u2014 The header-quote fetch, the `2 claim quotes` success line and both `provenance: plan-level claim \u2026` failure lines are exercised only through the `_fake_gh` `/bin/sh` seam in tests/test_check_provenance.py. No run in this environment invoked a real `gh issue view \u2026 --json body -q .body`, and this plan's own header is tagged `(elicited)`, so the live path (network, `gh` auth, actual issue #755 body) has not been executed anywhere in the run. The seam pins the argument vector exactly, so the risk is confined to `gh`'s real output shape, not to the script's logic. [structural false-green: sandbox could not execute it against the target]"
      }
    ],
    "repo": "/home/exedev/target"
  },
  "gateCheckExit": 2,
  "acceptance": {
    "disposition": "suite",
    "exit": 0,
    "output": "{\"sealId\": \"(suite)\", \"status\": \"OK\", \"passed\": true, \"exitCode\": 0, \"output\": \"============================= test session starts ==============================\\nplatform linux -- Python 3.12.3, pytest-7.4.4, pluggy-1.4.0\\nrootdir: /tmp/tmp.wxcNCjOjjI/suite-gate\\nconfigfile: pytest.ini\\ntestpaths: tests\\nplugins: xdist-3.4.0\\ncreated: 4/4 workers\\n4 workers [1737 items]\\n\\n........................................................................ [  4%]\\n........................................................................ [  8%]\\n........................................................................ [ 12%]\\n........................................................................ [ 16%]\\n........................................................................ [ 20%]\\n........................................................................ [ 24%]\\n........................................................................ [ 29%]\\n........................................................................ [ 33%]\\n........................................................................ [ 37%]\\n........................................................................ [ 41%]\\n........................................................................ [ 45%]\\n........................................................................ [ 49%]\\n........................................................................ [ 53%]\\n........................................................................ [ 58%]\\n........................................................................ [ 62%]\\n........................................................................ [ 66%]\\n........................................................................ [ 70%]\\n........................................................................ [ 74%]\\n........................................................................ [ 78%]\\n........................................................................ [ 82%]\\n........................................................................ [ 87%]\\n........................................................................ [ 91%]\\n........................................................................ [ 95%]\\n........................................................................ [ 99%]\\n.........                                                                [100%]\\n=============================== warnings summary ===============================\\ntests/test_harvest_fleet_runs.py::test_discover_unpacks_a_tarball\\ntests/test_harvest_fleet_runs.py::test_two_bundles_unpack_to_separate_directories\\ntests/test_harvest_fleet_runs.py::test_two_bundles_unpack_to_separate_directories\\ntests/test_harvest_fleet_runs.py::test_a_corrupt_tarball_among_healthy_ones_is_named_and_the_rest_land\\ntests/test_harvest_fleet_runs.py::test_an_unreadable_tarball_is_named_in_a_whole_failed_lookup_line\\n  /usr/lib/python3.12/tarfile.py:2301: DeprecationWarning: Python 3.14 will, by default, filter extracted tar archives and reject files or modify their metadata. Use the filter argument to control this behavior.\\n    warnings.warn(\\n\\n-- Docs: https://docs.pytest.org/en/stable/how-to/capture-warnings.html\\n================= 1737 passed, 5 warnings in 354.34s (0:05:54) =================\"}\n"
  },
  "verdict": "NEEDS_ACK"
}
```

### Evidence

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence/run-48/.ultrapowers/runs/48/

- acceptance.log
- approve-receipt.json
- claude-version.txt
- engine.log
- events.jsonl
- gate-receipt.json
- pr-body.md
- publish-fold
- receipt.json
- report.json
- standing-approval.json
- status.json
- transcripts

### Plan

https://github.com/popmechanic/ultrapowers/blob/ultra/plan/run-48/.ultrapowers/plan.md
Closes #755
Closes #756
