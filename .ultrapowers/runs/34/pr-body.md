## fleet run-34 — gate-green

| | |
|---|---|
| verdict | `NEEDS_ACK` |
| target | `popmechanic/ultrapowers` at `00fb22436c9fad7f6e37de3f11f73f709675ad35` |
| engine | `00fb22436c9fad7f6e37de3f11f73f709675ad35` |
| plan | `.ultrapowers/plan.md` at `bdae90caa9ed02729269e29c182508d372ce3ab9` |
| branch | `ultra/integration-run-34` |
| vm | `fleet-r34-2609071533-dc71` |

### Checks

```json
{
  "mode": "gate",
  "stamp": "run-34",
  "reportPath": "/home/exedev/target/.claude/ultrapowers/run-run-34/report.json",
  "branch": "ultra/integration-run-34",
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
        "detail": "fleet/sandbox-boot.sh \u2014 the phase evidence commits as seen on a real run's `ultra/evidence-run-<N>` history (`git log --format='%s'` listing one subject per relayed phase between `run-<N>: running` and the `publishing` commit), at the production 30 s FLEET_STATUS_INTERVAL, against a real remote and real systemd \u2014 The plan's Rule 5 states this half is read off a live run after the change lands, never from a sandbox. Every exam here drives the script through the PATH shim that stubs git, systemd-run, systemctl and curl (fleet/tests/_sandbox_boot_helpers.mjs), so real push/`pull --rebase` contention on GitHub, real unit-kill timing against the EVIDENCE_LOCK, and the engine's own phase spellings are structurally covered by the sims but not executed in this environment. [structural false-green: sandbox could not execute it against the target]"
      }
    ],
    "repo": "/home/exedev/target"
  },
  "gateCheckExit": 2,
  "acceptance": {
    "disposition": "suite",
    "exit": 0,
    "output": "{\"sealId\": \"(suite)\", \"status\": \"OK\", \"passed\": true, \"exitCode\": 0, \"output\": \"============================= test session starts ==============================\\nplatform linux -- Python 3.12.3, pytest-7.4.4, pluggy-1.4.0\\nrootdir: /tmp/tmp.6YLanrQxtE/suite-gate\\nconfigfile: pytest.ini\\ntestpaths: tests\\nplugins: xdist-3.4.0\\ncreated: 4/4 workers\\n4 workers [1666 items]\\n\\n........................................................................ [  4%]\\n........................................................................ [  8%]\\n........................................................................ [ 12%]\\n........................................................................ [ 17%]\\n........................................................................ [ 21%]\\n........................................................................ [ 25%]\\n........................................................................ [ 30%]\\n........................................................................ [ 34%]\\n........................................................................ [ 38%]\\n........................................................................ [ 43%]\\n........................................................................ [ 47%]\\n........................................................................ [ 51%]\\n........................................................................ [ 56%]\\n........................................................................ [ 60%]\\n........................................................................ [ 64%]\\n........................................................................ [ 69%]\\n........................................................................ [ 73%]\\n........................................................................ [ 77%]\\n........................................................................ [ 82%]\\n........................................................................ [ 86%]\\n........................................................................ [ 90%]\\n........................................................................ [ 95%]\\n........................................................................ [ 99%]\\n..........                                                               [100%]\\n=============================== warnings summary ===============================\\ntests/test_harvest_fleet_runs.py::test_two_bundles_unpack_to_separate_directories\\ntests/test_harvest_fleet_runs.py::test_two_bundles_unpack_to_separate_directories\\ntests/test_harvest_fleet_runs.py::test_a_corrupt_tarball_among_healthy_ones_is_named_and_the_rest_land\\ntests/test_harvest_fleet_runs.py::test_an_unreadable_tarball_is_named_in_a_whole_failed_lookup_line\\ntests/test_harvest_fleet_runs.py::test_discover_unpacks_a_tarball\\n  /usr/lib/python3.12/tarfile.py:2301: DeprecationWarning: Python 3.14 will, by default, filter extracted tar archives and reject files or modify their metadata. Use the filter argument to control this behavior.\\n    warnings.warn(\\n\\n-- Docs: https://docs.pytest.org/en/stable/how-to/capture-warnings.html\\n================= 1666 passed, 5 warnings in 326.11s (0:05:26) =================\"}\n"
  },
  "verdict": "NEEDS_ACK"
}
```

### Evidence

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence/run-34/.ultrapowers/runs/34/

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

https://github.com/popmechanic/ultrapowers/blob/ultra/plan/run-34/.ultrapowers/plan.md
Closes #723
