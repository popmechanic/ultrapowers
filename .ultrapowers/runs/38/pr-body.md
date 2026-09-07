## fleet run-38 — gate-green

| | |
|---|---|
| verdict | `NEEDS_ACK` |
| target | `popmechanic/ultrapowers` at `9cd8190ffb5e68b1de0eb9eac44b116ab0631d28` |
| engine | `9cd8190ffb5e68b1de0eb9eac44b116ab0631d28` |
| plan | `.ultrapowers/plan.md` at `2686ff203fa5e35ad9279941cd1e3895c751f76e` |
| branch | `ultra/integration-run-38` |
| vm | `fleet-r38-2609072014-ae9d` |

### Checks

```json
{
  "mode": "gate",
  "stamp": "run-38",
  "reportPath": "/home/exedev/target/.claude/ultrapowers/run-run-38/report.json",
  "branch": "ultra/integration-run-38",
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
        "type": "deferred:runtime",
        "detail": "Task 1 \u2014 the end-to-end gate-mode composition: the real frozen `skills/ultrapowers/scripts/ultra_gate.py` reading the driver-rewritten `<run dir>/receipt.json` and handing the wrapped `testCmd` to `run_acceptance.sh`, on a real sandbox box. \u2014 The composition is verified in two halves, not end to end: `fleet/tests/test_run_main.mjs` legs (a)/(b) stub `ultra_gate.py` (it only snapshots `receipt.json` at call time), while legs (c)/(d) invoke the real `run_acceptance.sh --suite-gate` directly with `acceptanceWrap(...)`. `ultra_gate.py` itself is never executed in this environment, so the seam between the two halves \u2014 the frozen gate actually passing that receipt string through as `--run` and keeping its 4000-char tail \u2014 rests on the frozen script being unchanged (which the `git diff --quiet $ULTRA_BASE` check confirms) rather than on an executed leg. [structural false-green: sandbox could not execute it against the target]"
      },
      {
        "type": "deferred:external",
        "detail": "Task 2 \u2014 publication of `.ultrapowers/runs/<N>/acceptance.log` onto the real `ultra/evidence-run-<N>` branch (the `push_evidence` add/commit/push path in `fleet/sandbox-boot.sh`). \u2014 `fleet/tests/_sandbox_boot_helpers.mjs` stubs `git`, `gh`, `curl`, `systemd-run`, `systemctl` and `claude` through a PATH shim, so the rig verifies that `collect_evidence` places the byte-identical 9000-byte log into the evidence worktree at `.ultrapowers/runs/7/acceptance.log` beside `gate-receipt.json`, but the subsequent staging, commit and push to a real remote are never executed here. No network or VM is available in this environment. [structural false-green: sandbox could not execute it against the target]"
      }
    ],
    "repo": "/home/exedev/target"
  },
  "gateCheckExit": 2,
  "acceptance": {
    "disposition": "suite",
    "exit": 0,
    "output": "{\"sealId\": \"(suite)\", \"status\": \"OK\", \"passed\": true, \"exitCode\": 0, \"output\": \"============================= test session starts ==============================\\nplatform linux -- Python 3.12.3, pytest-7.4.4, pluggy-1.4.0\\nrootdir: /tmp/tmp.iZvmlvkQsj/suite-gate\\nconfigfile: pytest.ini\\ntestpaths: tests\\nplugins: xdist-3.4.0\\ncreated: 4/4 workers\\n4 workers [1666 items]\\n\\n........................................................................ [  4%]\\n........................................................................ [  8%]\\n........................................................................ [ 12%]\\n........................................................................ [ 17%]\\n........................................................................ [ 21%]\\n........................................................................ [ 25%]\\n........................................................................ [ 30%]\\n........................................................................ [ 34%]\\n........................................................................ [ 38%]\\n........................................................................ [ 43%]\\n........................................................................ [ 47%]\\n........................................................................ [ 51%]\\n........................................................................ [ 56%]\\n........................................................................ [ 60%]\\n........................................................................ [ 64%]\\n........................................................................ [ 69%]\\n........................................................................ [ 73%]\\n........................................................................ [ 77%]\\n........................................................................ [ 82%]\\n........................................................................ [ 86%]\\n........................................................................ [ 90%]\\n........................................................................ [ 95%]\\n........................................................................ [ 99%]\\n..........                                                               [100%]\\n=============================== warnings summary ===============================\\ntests/test_harvest_fleet_runs.py::test_two_bundles_unpack_to_separate_directories\\ntests/test_harvest_fleet_runs.py::test_two_bundles_unpack_to_separate_directories\\ntests/test_harvest_fleet_runs.py::test_a_corrupt_tarball_among_healthy_ones_is_named_and_the_rest_land\\ntests/test_harvest_fleet_runs.py::test_an_unreadable_tarball_is_named_in_a_whole_failed_lookup_line\\ntests/test_harvest_fleet_runs.py::test_discover_unpacks_a_tarball\\n  /usr/lib/python3.12/tarfile.py:2301: DeprecationWarning: Python 3.14 will, by default, filter extracted tar archives and reject files or modify their metadata. Use the filter argument to control this behavior.\\n    warnings.warn(\\n\\n-- Docs: https://docs.pytest.org/en/stable/how-to/capture-warnings.html\\n================= 1666 passed, 5 warnings in 350.38s (0:05:50) =================\"}\n"
  },
  "verdict": "NEEDS_ACK"
}
```

### Evidence

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence/run-38/.ultrapowers/runs/38/

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

https://github.com/popmechanic/ultrapowers/blob/ultra/plan/run-38/.ultrapowers/plan.md
Closes #739
