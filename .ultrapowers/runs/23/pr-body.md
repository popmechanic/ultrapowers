## fleet run-23 — gate-green

| | |
|---|---|
| verdict | `NEEDS_ACK` |
| target | `popmechanic/ultrapowers` at `e04154b702407ac1efabaa22db6e21eab706a5f1` |
| engine | `e04154b702407ac1efabaa22db6e21eab706a5f1` |
| plan | `.ultrapowers/plan.md` at `05e7d27648eff23dbe0bb0f73854082da3bdc83e` |
| branch | `ultra/integration-run-23` |
| vm | `fleet-r23-2609051933-ca80` |

### Checks

```json
{
  "mode": "gate",
  "stamp": "run-23",
  "reportPath": "/home/exedev/target/.claude/ultrapowers/run-run-23/report.json",
  "branch": "ultra/integration-run-23",
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
        "detail": "Task 2 \u2014 the `**Closes:**` paragraph in skills/ultrawrite/SKILL.md:37\u201339 (\"The sandbox reads exactly that line from `.ultrapowers/plan.md` and appends one `Closes #N` per number to the pull request body\") \u2014 The reader it describes does not exist anywhere in this tree: no `Closes` handling appears under `fleet/` (only `fenceCloses` in fleet/fitness.mjs, unrelated), and the Global Constraints freeze fleet/sandbox-boot.sh at BASE. The plan states this deliberately \u2014 the sentence is the skill half of #679 whose mechanism another bundle builds \u2014 so the prose is authorized and structurally complete, but the end-to-end behavior (a plan's Closes line actually closing tickets on merge) cannot be exercised from this tree. [structural false-green: sandbox could not execute it against the target]"
      },
      {
        "type": "deferred:external",
        "detail": "Task 3 \u2014 the `$ULTRA_BASE` rule in skills/ultrawrite/SKILL.md:320\u2013325 (\"the driver sets, in the environment of every `Check:` and `Run:` it executes, to the run's base sha\") \u2014 `ULTRA_BASE` appears nowhere under `fleet/` in this tree; the engine half is #632's open part, built by another bundle, and fleet/run-engine.mjs is frozen at BASE by the Global Constraints. The documented sentence is present and authorized, but that a `- Check: git diff --quiet $ULTRA_BASE -- fleet/` would actually resolve cannot be verified here. [structural false-green: sandbox could not execute it against the target]"
      }
    ],
    "repo": "/home/exedev/target"
  },
  "gateCheckExit": 2,
  "acceptance": {
    "disposition": "suite",
    "exit": 0,
    "output": "{\"sealId\": \"(suite)\", \"status\": \"OK\", \"passed\": true, \"exitCode\": 0, \"output\": \"============================= test session starts ==============================\\nplatform linux -- Python 3.12.3, pytest-7.4.4, pluggy-1.4.0\\nrootdir: /tmp/tmp.2EvMfccbmS/suite-gate\\nconfigfile: pytest.ini\\ntestpaths: tests\\nplugins: xdist-3.4.0\\ncreated: 4/4 workers\\n4 workers [1618 items]\\n\\n........................................................................ [  4%]\\n........................................................................ [  8%]\\n........................................................................ [ 13%]\\n........................................................................ [ 17%]\\n........................................................................ [ 22%]\\n........................................................................ [ 26%]\\n........................................................................ [ 31%]\\n........................................................................ [ 35%]\\n........................................................................ [ 40%]\\n........................................................................ [ 44%]\\n........................................................................ [ 48%]\\n........................................................................ [ 53%]\\n........................................................................ [ 57%]\\n........................................................................ [ 62%]\\n........................................................................ [ 66%]\\n........................................................................ [ 71%]\\n........................................................................ [ 75%]\\n........................................................................ [ 80%]\\n........................................................................ [ 84%]\\n........................................................................ [ 88%]\\n........................................................................ [ 93%]\\n........................................................................ [ 97%]\\n..................................                                       [100%]\\n=============================== warnings summary ===============================\\ntests/test_harvest_fleet_runs.py::test_discover_unpacks_a_tarball\\ntests/test_harvest_fleet_runs.py::test_two_bundles_unpack_to_separate_directories\\ntests/test_harvest_fleet_runs.py::test_two_bundles_unpack_to_separate_directories\\ntests/test_harvest_fleet_runs.py::test_a_corrupt_tarball_among_healthy_ones_is_named_and_the_rest_land\\ntests/test_harvest_fleet_runs.py::test_an_unreadable_tarball_is_named_in_a_whole_failed_lookup_line\\n  /usr/lib/python3.12/tarfile.py:2301: DeprecationWarning: Python 3.14 will, by default, filter extracted tar archives and reject files or modify their metadata. Use the filter argument to control this behavior.\\n    warnings.warn(\\n\\n-- Docs: https://docs.pytest.org/en/stable/how-to/capture-warnings.html\\n================= 1618 passed, 5 warnings in 133.00s (0:02:13) =================\"}\n"
  },
  "verdict": "NEEDS_ACK"
}
```

### Evidence

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence-run-23/.ultrapowers/runs/23/

- approve-receipt.json
- engine.log
- events.jsonl
- gate-receipt.json
- pr-body.md
- receipt.json
- report.json
- standing-approval.json
- status.json

### Plan

https://github.com/popmechanic/ultrapowers/blob/ultra/plan-run-23/.ultrapowers/plan.md
