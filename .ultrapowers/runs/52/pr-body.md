## fleet run-52 — gate-green

| | |
|---|---|
| verdict | `NEEDS_ACK` |
| target | `popmechanic/ultrapowers` at `1c2c89e340ec099a8c94571cdd60f79e3e5c5a00` |
| engine | `1c2c89e340ec099a8c94571cdd60f79e3e5c5a00` |
| plan | `.ultrapowers/plan.md` at `c14179b39ee2a9ded98814d046458afb33643acc` |
| branch | `ultra/integration-run-52` |
| vm | `fleet-r52-2609080935-eed5` |

### Checks

```json
{
  "mode": "gate",
  "stamp": "run-52",
  "reportPath": "/home/exedev/target/.claude/ultrapowers/run-run-52/report.json",
  "branch": "ultra/integration-run-52",
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
        "detail": "skills/ultrapowers/SKILL.md \u00a7Client step 3 read-state recipe \u2014 `gh api 'repos/<repo>/contents/.ultrapowers/runs/<N>/status.json?ref=ultra/evidence/run-<N>' --jq .content | base64 -d` \u2014 The Claim's operator sentence ends in a live GitHub read of a finished run's tag returning the record and not a 404; this sandbox has no network or target repository, so the recipe's end-to-end behavior cannot be executed. Statically it is consistent with the ref the boot actually writes \u2014 `fleet/sandbox-boot.sh` `record_tags` sets `refs/tags/ultra/evidence/$RUN_ID` (line 1687) and verifies it before deleting the branches \u2014 and with `fleet/CONTRACT.md` \u00a7Literals *The two tags* and `fleet/RUNBOOK.md` \u00a7Per run *Watch*, which spell the same literal. [structural false-green: sandbox could not execute it against the target]"
      }
    ],
    "repo": "/home/exedev/target"
  },
  "gateCheckExit": 2,
  "acceptance": {
    "disposition": "suite",
    "exit": 0,
    "output": "{\"sealId\": \"(suite)\", \"status\": \"OK\", \"passed\": true, \"exitCode\": 0, \"output\": \"============================= test session starts ==============================\\nplatform linux -- Python 3.12.3, pytest-7.4.4, pluggy-1.4.0\\nrootdir: /tmp/tmp.mvmDrG1q9d/suite-gate\\nconfigfile: pytest.ini\\ntestpaths: tests\\nplugins: xdist-3.4.0\\ncreated: 6/6 workers\\n6 workers [1737 items]\\n\\n........................................................................ [  4%]\\n........................................................................ [  8%]\\n........................................................................ [ 12%]\\n........................................................................ [ 16%]\\n........................................................................ [ 20%]\\n........................................................................ [ 24%]\\n........................................................................ [ 29%]\\n........................................................................ [ 33%]\\n........................................................................ [ 37%]\\n........................................................................ [ 41%]\\n......................................................................... [ 45%]\\n........................................................................ [ 49%]\\n........................................................................ [ 53%]\\n........................................................................ [ 58%]\\n........................................................................ [ 62%]\\n........................................................................ [ 66%]\\n........................................................................ [ 70%]\\n........................................................................ [ 74%]\\n........................................................................ [ 78%]\\n........................................................................ [ 82%]\\n........................................................................ [ 87%]\\n........................................................................ [ 91%]\\n........................................................................ [ 95%]\\n........................................................................ [ 99%]\\n........                                                                 [100%]\\n=============================== warnings summary ===============================\\ntests/test_harvest_fleet_runs.py::test_discover_unpacks_a_tarball\\ntests/test_harvest_fleet_runs.py::test_two_bundles_unpack_to_separate_directories\\ntests/test_harvest_fleet_runs.py::test_two_bundles_unpack_to_separate_directories\\ntests/test_harvest_fleet_runs.py::test_a_corrupt_tarball_among_healthy_ones_is_named_and_the_rest_land\\ntests/test_harvest_fleet_runs.py::test_an_unreadable_tarball_is_named_in_a_whole_failed_lookup_line\\n  /usr/lib/python3.12/tarfile.py:2301: DeprecationWarning: Python 3.14 will, by default, filter extracted tar archives and reject files or modify their metadata. Use the filter argument to control this behavior.\\n    warnings.warn(\\n\\n-- Docs: https://docs.pytest.org/en/stable/how-to/capture-warnings.html\\n================= 1737 passed, 5 warnings in 288.59s (0:04:48) =================\"}\n"
  },
  "verdict": "NEEDS_ACK"
}
```

### Evidence

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence/run-52/.ultrapowers/runs/52/

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

https://github.com/popmechanic/ultrapowers/blob/ultra/plan/run-52/.ultrapowers/plan.md
Closes #710
