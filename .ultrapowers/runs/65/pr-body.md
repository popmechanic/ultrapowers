## fleet run-65 — gate-green

| | |
|---|---|
| verdict | `NEEDS_ACK` |
| target | `popmechanic/ultrapowers` at `1c97ba442c65d882354953d16590b1f8eb0c7a7a` |
| engine | `1c97ba442c65d882354953d16590b1f8eb0c7a7a` |
| plan | `.ultrapowers/plan.md` at `0ca2781dd40e3a1bf402d089faefb5e282cbc423` |
| branch | `ultra/integration-run-65` |
| vm | `fleet-r65-2609081940-eeb7` |

### Checks

```json
{
  "mode": "gate",
  "stamp": "run-65",
  "reportPath": "/home/exedev/target/.claude/ultrapowers/run-run-65/report.json",
  "branch": "ultra/integration-run-65",
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
        "detail": "fleet/sandbox-boot.sh \u2014 file_followup / followup_labels against the live GitHub edge (POST /repos/$TARGET_REPO/issues and GET /repos/$TARGET_REPO/issues/<n>) \u2014 Every GitHub call is exercised only through the rig's stub curl arms in fleet/tests/_sandbox_boot_helpers.mjs:256-271, which synthesize the issue document and the 201/422/404 answers. Real-edge behavior \u2014 GitHub creating a label named on issue creation when the gh-<owner>-<repo> integration has push access (the plan's authoring notes record this as exercised by no sim), and the real /issues response shape the html_url is read from \u2014 cannot be executed here. [structural false-green: sandbox could not execute it against the target]"
      }
    ],
    "repo": "/home/exedev/target"
  },
  "gateCheckExit": 2,
  "acceptance": {
    "disposition": "suite",
    "exit": 0,
    "output": "{\"sealId\": \"(suite)\", \"status\": \"OK\", \"passed\": true, \"exitCode\": 0, \"output\": \"============================= test session starts ==============================\\nplatform linux -- Python 3.12.3, pytest-7.4.4, pluggy-1.4.0\\nrootdir: /tmp/tmp.ZSmSeglqtt/suite-gate\\nconfigfile: pytest.ini\\ntestpaths: tests\\nplugins: xdist-3.4.0\\ncreated: 6/6 workers\\n6 workers [1818 items]\\n\\n........................................................................ [  3%]\\n........................................................................ [  7%]\\n........................................................................ [ 11%]\\n........................................................................ [ 15%]\\n........................................................................ [ 19%]\\n........................................................................ [ 23%]\\n........................................................................ [ 27%]\\n........................................................................ [ 31%]\\n........................................................................ [ 35%]\\n........................................................................ [ 39%]\\n........................................................................ [ 43%]\\n........................................................................ [ 47%]\\n........................................................................ [ 51%]\\n........................................................................ [ 55%]\\n........................................................................ [ 59%]\\n........................................................................ [ 63%]\\n........................................................................ [ 67%]\\n........................................................................ [ 71%]\\n........................................................................ [ 75%]\\n........................................................................ [ 79%]\\n........................................................................ [ 83%]\\n........................................................................ [ 87%]\\n........................................................................ [ 91%]\\n........................................................................ [ 95%]\\n........................................................................ [ 99%]\\n..................                                                       [100%]\\n=============================== warnings summary ===============================\\ntests/test_harvest_fleet_runs.py::test_discover_unpacks_a_tarball\\ntests/test_harvest_fleet_runs.py::test_two_bundles_unpack_to_separate_directories\\ntests/test_harvest_fleet_runs.py::test_two_bundles_unpack_to_separate_directories\\ntests/test_harvest_fleet_runs.py::test_a_corrupt_tarball_among_healthy_ones_is_named_and_the_rest_land\\ntests/test_harvest_fleet_runs.py::test_an_unreadable_tarball_is_named_in_a_whole_failed_lookup_line\\n  /usr/lib/python3.12/tarfile.py:2301: DeprecationWarning: Python 3.14 will, by default, filter extracted tar archives and reject files or modify their metadata. Use the filter argument to control this behavior.\\n    warnings.warn(\\n\\n-- Docs: https://docs.pytest.org/en/stable/how-to/capture-warnings.html\\n================= 1818 passed, 5 warnings in 338.07s (0:05:38) =================\"}\n"
  },
  "verdict": "NEEDS_ACK"
}
```

### Evidence

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence/run-65/.ultrapowers/runs/65/

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

https://github.com/popmechanic/ultrapowers/blob/ultra/plan/run-65/.ultrapowers/plan.md
Closes #711
