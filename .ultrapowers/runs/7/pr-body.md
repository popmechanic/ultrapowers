## fleet run-7 — parked

| | |
|---|---|
| verdict | `NEEDS_ACK` |
| target | `popmechanic/ultrapowers` at `13c0e15721705018fb5ba2cba918af5c91811cc4` |
| engine | `13c0e15721705018fb5ba2cba918af5c91811cc4` |
| plan | `.ultrapowers/plan.md` at `2e7b2410896fb31e16dbe53287f30620f6d9a60b` |
| branch | `ultra/integration-run-7` |
| vm | `fleet-r7-2609042023-ffe7` |

### Checks

```json
{
  "mode": "gate",
  "stamp": "run-7",
  "reportPath": "/home/exedev/target/.claude/ultrapowers/run-run-7/report.json",
  "branch": "ultra/integration-run-7",
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
        "detail": "Task 1 \u2014 `fleet/sandbox-boot.sh` publish path (Claim: \"A run the engine approved reaches me as a ready pull request\") \u2014 The integrated tree is verified end-to-end up to the REST boundary: `fleet/tests/test_sandbox_boot_approved.mjs` (driver-run, exit 0) asserts the recorded POST payload carries `\"draft\":false`, `status.json` ends at `done` with the PR URL, and the log line is `outcome: gate-green (verdict=NEEDS_ACK, approved by the two-move rule)`. What no clone can execute is the far side of that POST \u2014 GitHub actually rendering a non-draft PR against `https://<host>/api/v3/repos/<owner>/<repo>/pulls`, which the sim reaches through a stub `curl`. Nothing in the tree is missing; only the live GitHub leg is unexercisable here. [structural false-green: sandbox could not execute it against the target]"
      },
      {
        "type": "deferred:external",
        "detail": "Task 2 \u2014 the fold commit's subject (Claim: \"A run's squash-merge keeps the plan's title\") \u2014 The antecedent is fully verified in the tree: `tests/test_fold_wave_subject.py` (6 passed) pins `%s` = the `--subject` text and `%b` = `frontier fold wave <N>`, and `fleet/tests/test_run_engine_fold_subject.mjs` (exit 0) pins the integration branch head's `%s`/`%b` for the plan-with-H1, no-planPath, no-`# `-line and unreadable-plan cases. The last step of the Claim \u2014 GitHub's squash-merge adopting that commit subject as the merge commit's subject \u2014 happens on github.int.exe.xyz at merge time and cannot be executed in a clone. [structural false-green: sandbox could not execute it against the target]"
      }
    ],
    "repo": "/home/exedev/target"
  },
  "gateCheckExit": 2,
  "acceptance": {
    "disposition": "suite",
    "exit": 0,
    "output": "{\"sealId\": \"(suite)\", \"status\": \"OK\", \"passed\": true, \"exitCode\": 0, \"output\": \"============================= test session starts ==============================\\nplatform linux -- Python 3.12.3, pytest-7.4.4, pluggy-1.4.0\\nrootdir: /tmp/tmp.RnF58pBP7f/suite-gate\\nconfigfile: pytest.ini\\ntestpaths: tests\\nplugins: xdist-3.4.0\\ncreated: 8/8 workers\\n8 workers [1378 items]\\n\\n........................................................................ [  5%]\\n........................................................................ [ 10%]\\n........................................................................ [ 15%]\\n........................................................................ [ 20%]\\n........................................................................ [ 26%]\\n........................................................................ [ 31%]\\n........................................................................ [ 36%]\\n........................................................................ [ 41%]\\n........................................................................ [ 47%]\\n........................................................................ [ 52%]\\n........................................................................ [ 57%]\\n......................................................................... [ 62%]\\n........................................................................ [ 67%]\\n........................................................................ [ 73%]\\n........................................................................ [ 78%]\\n........................................................................ [ 83%]\\n........................................................................ [ 88%]\\n........................................................................ [ 94%]\\n........................................................................ [ 99%]\\n.........                                                                [100%]\\n=============================== warnings summary ===============================\\ntests/test_harvest_fleet_runs.py::test_discover_unpacks_a_tarball\\ntests/test_harvest_fleet_runs.py::test_two_bundles_unpack_to_separate_directories\\ntests/test_harvest_fleet_runs.py::test_two_bundles_unpack_to_separate_directories\\ntests/test_harvest_fleet_runs.py::test_a_corrupt_tarball_among_healthy_ones_is_named_and_the_rest_land\\ntests/test_harvest_fleet_runs.py::test_an_unreadable_tarball_is_named_in_a_whole_failed_lookup_line\\n  /usr/lib/python3.12/tarfile.py:2301: DeprecationWarning: Python 3.14 will, by default, filter extracted tar archives and reject files or modify their metadata. Use the filter argument to control this behavior.\\n    warnings.warn(\\n\\n-- Docs: https://docs.pytest.org/en/stable/how-to/capture-warnings.html\\n================= 1378 passed, 5 warnings in 91.19s (0:01:31) ==================\"}\n"
  },
  "verdict": "NEEDS_ACK"
}
```

### Evidence

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence-run-7/.ultrapowers/runs/7/

- engine.log
- events.jsonl
- gate-receipt.json
- pr-body.md
- receipt.json
- report.json
- status.json

### Plan

https://github.com/popmechanic/ultrapowers/blob/ultra/plan-run-7/.ultrapowers/plan.md
