## fleet run-43 — gate-green

| | |
|---|---|
| verdict | `NEEDS_ACK` |
| target | `popmechanic/ultrapowers` at `9cd8190ffb5e68b1de0eb9eac44b116ab0631d28` |
| engine | `9cd8190ffb5e68b1de0eb9eac44b116ab0631d28` |
| plan | `.ultrapowers/plan.md` at `6b4164d512bbce4ffab8b9f7befbb0a537dc2f58` |
| branch | `ultra/integration-run-43` |
| vm | `fleet-r43-2609072102-9db9` |

### Checks

```json
{
  "mode": "gate",
  "stamp": "run-43",
  "reportPath": "/home/exedev/target/.claude/ultrapowers/run-run-43/report.json",
  "branch": "ultra/integration-run-43",
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
        "detail": "fleet/retire.mjs \u2014 the status read (`repos/<t>/contents/.ultrapowers/runs/<N>/status.json?ref=ultra/evidence-run-<N>`) and the open-PR read (`repos/<t>/pulls?state=open&head=<owner>:ultra/integration-run-<N>`) against a real GitHub target \u2014 Both reads are exercised only through the `exec` seam (`fleet/tests/test_retire.mjs` makeSeam, `passthrough: []`) and the temporary PATH shims the process legs write; no network call is made, so the real contents envelope shape and GitHub's `head=` filter semantics are asserted against fixtures, not the service. The gate's logic, ordering, line literals and dry-run parity are fully covered by the committed sim, which the driver ran green. [structural false-green: sandbox could not execute it against the target]"
      }
    ],
    "repo": "/home/exedev/target"
  },
  "gateCheckExit": 2,
  "acceptance": {
    "disposition": "suite",
    "exit": 0,
    "output": "{\"sealId\": \"(suite)\", \"status\": \"OK\", \"passed\": true, \"exitCode\": 0, \"output\": \"============================= test session starts ==============================\\nplatform linux -- Python 3.12.3, pytest-7.4.4, pluggy-1.4.0\\nrootdir: /tmp/tmp.0hgsZr6xQu/suite-gate\\nconfigfile: pytest.ini\\ntestpaths: tests\\nplugins: xdist-3.4.0\\ncreated: 4/4 workers\\n4 workers [1666 items]\\n\\n........................................................................ [  4%]\\n........................................................................ [  8%]\\n........................................................................ [ 12%]\\n........................................................................ [ 17%]\\n........................................................................ [ 21%]\\n........................................................................ [ 25%]\\n........................................................................ [ 30%]\\n........................................................................ [ 34%]\\n........................................................................ [ 38%]\\n........................................................................ [ 43%]\\n........................................................................ [ 47%]\\n........................................................................ [ 51%]\\n........................................................................ [ 56%]\\n........................................................................ [ 60%]\\n........................................................................ [ 64%]\\n........................................................................ [ 69%]\\n........................................................................ [ 73%]\\n........................................................................ [ 77%]\\n........................................................................ [ 82%]\\n........................................................................ [ 86%]\\n........................................................................ [ 90%]\\n........................................................................ [ 95%]\\n........................................................................ [ 99%]\\n..........                                                               [100%]\\n=============================== warnings summary ===============================\\ntests/test_harvest_fleet_runs.py::test_two_bundles_unpack_to_separate_directories\\ntests/test_harvest_fleet_runs.py::test_two_bundles_unpack_to_separate_directories\\ntests/test_harvest_fleet_runs.py::test_a_corrupt_tarball_among_healthy_ones_is_named_and_the_rest_land\\ntests/test_harvest_fleet_runs.py::test_an_unreadable_tarball_is_named_in_a_whole_failed_lookup_line\\ntests/test_harvest_fleet_runs.py::test_discover_unpacks_a_tarball\\n  /usr/lib/python3.12/tarfile.py:2301: DeprecationWarning: Python 3.14 will, by default, filter extracted tar archives and reject files or modify their metadata. Use the filter argument to control this behavior.\\n    warnings.warn(\\n\\n-- Docs: https://docs.pytest.org/en/stable/how-to/capture-warnings.html\\n================= 1666 passed, 5 warnings in 346.05s (0:05:46) =================\"}\n"
  },
  "verdict": "NEEDS_ACK"
}
```

### Evidence

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence/run-43/.ultrapowers/runs/43/

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

https://github.com/popmechanic/ultrapowers/blob/ultra/plan/run-43/.ultrapowers/plan.md
Closes #706
