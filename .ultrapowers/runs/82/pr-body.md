## fleet run-82 — gate-green

| | |
|---|---|
| verdict | `PASS` |
| target | `popmechanic/ultrapowers` at `3fb782b6de9a3cdbd17dbab957f718df15b8399d` |
| engine | `3fb782b6de9a3cdbd17dbab957f718df15b8399d` |
| plan | `.ultrapowers/plan.md` at `19bd70e70e45c421a9da9e7e6d2a2bcf5a57f5b6` |
| branch | `ultra/integration-run-82` |
| vm | `fleet-r82-2609091835-1265` |

### Checks

```json
{"mode": "gate", "stamp": "run-82", "reportPath": "/home/exedev/target/.claude/ultrapowers/run-run-82/report.json", "branch": "ultra/integration-run-82", "gateCheck": {"verdict": "PASS", "checks": [{"name": "report-parse", "ok": true, "detail": ""}, {"name": "clean-tree", "ok": true, "detail": ""}, {"name": "wave-merges", "ok": true, "detail": ""}, {"name": "head-match", "ok": true, "detail": ""}, {"name": "git-verified", "ok": true, "detail": ""}, {"name": "ancestry", "ok": true, "detail": ""}, {"name": "deliverables", "ok": true, "detail": ""}], "repo": "/home/exedev/target"}, "gateCheckExit": 0, "acceptance": {"disposition": "suite", "exit": 0, "output": "{\"sealId\": \"(suite)\", \"status\": \"OK\", \"passed\": true, \"exitCode\": 0, \"output\": \"============================= test session starts ==============================\\nplatform linux -- Python 3.12.3, pytest-7.4.4, pluggy-1.4.0\\nrootdir: /tmp/tmp.nBGNpCN4ep/suite-gate\\nconfigfile: pytest.ini\\ntestpaths: tests\\nplugins: xdist-3.4.0\\ncreated: 6/6 workers\\n6 workers [1910 items]\\n\\n......................................................................... [  3%]\\n........................................................................ [  7%]\\n........................................................................ [ 11%]\\n........................................................................ [ 15%]\\n........................................................................ [ 18%]\\n........................................................................ [ 22%]\\n........................................................................ [ 26%]\\n........................................................................ [ 30%]\\n........................................................................ [ 33%]\\n........................................................................ [ 37%]\\n........................................................................ [ 41%]\\n........................................................................ [ 45%]\\n........................................................................ [ 49%]\\n........................................................................ [ 52%]\\n........................................................................ [ 56%]\\n........................................................................ [ 60%]\\n........................................................................ [ 64%]\\n........................................................................ [ 67%]\\n........................................................................ [ 71%]\\n........................................................................ [ 75%]\\n........................................................................ [ 79%]\\n........................................................................ [ 82%]\\n........................................................................ [ 86%]\\n........................................................................ [ 90%]\\n........................................................................ [ 94%]\\n........................................................................ [ 98%]\\n.....................................                                    [100%]\\n=============================== warnings summary ===============================\\ntests/test_harvest_fleet_runs.py::test_discover_unpacks_a_tarball\\ntests/test_harvest_fleet_runs.py::test_two_bundles_unpack_to_separate_directories\\ntests/test_harvest_fleet_runs.py::test_two_bundles_unpack_to_separate_directories\\ntests/test_harvest_fleet_runs.py::test_a_corrupt_tarball_among_healthy_ones_is_named_and_the_rest_land\\ntests/test_harvest_fleet_runs.py::test_an_unreadable_tarball_is_named_in_a_whole_failed_lookup_line\\n  /usr/lib/python3.12/tarfile.py:2301: DeprecationWarning: Python 3.14 will, by default, filter extracted tar archives and reject files or modify their metadata. Use the filter argument to control this behavior.\\n    warnings.warn(\\n\\n-- Docs: https://docs.pytest.org/en/stable/how-to/capture-warnings.html\\n================= 1910 passed, 5 warnings in 470.65s (0:07:50) =================\"}\n"}, "verdict": "PASS"}

```

## Publish fold

- attempt 1: folded
- attempt 2: folded
- attempt 3: folded

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence/run-82/.ultrapowers/runs/82/publish-fold/receipt.json

### Evidence

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence/run-82/.ultrapowers/runs/82/

- acceptance.log
- approve-receipt.json
- claude-version.txt
- engine.log
- events.jsonl
- gate-receipt.json
- pr-body.md
- publish-fold
- receipt.json
- referee
- report.json
- status.json
- transcripts

### Plan

https://github.com/popmechanic/ultrapowers/blob/ultra/plan/run-82/.ultrapowers/plan.md

### Residuals

- [ ] task 1 reviewer — `placeholderLead` is exported from fleet/referee-linker.mjs but nothing outside the module imports it — the declared interface for this task is `Produces: PLACEHOLDER_TOKENS` only, and no leg of either sim reads `placeholderLead`. It is the module's only internal-use-only helper carrying an `export`, so it widens the public surface past what the task declares without buying a test. Dropping the keyword (the function stays exactly where it is, still called from `linkProduces`) keeps the module's exported names equal to what the plan promised. Nothing in the Proof breaks: the M5 legs import `PLACEHOLDER_TOKENS`, not this.
- [ ] task 1 reviewer — Extra public surface beyond the declared interface: `fleet/referee-linker.mjs` exports `placeholderLead` as well as `PLACEHOLDER_TOKENS`, but the task's Produces slot names only `PLACEHOLDER_TOKENS`, and no test or caller in the diff (or elsewhere in the patch) reads `placeholderLead` — it is used once, inside `linkProduces` in the same module. The `export` keyword adds an unrequested API another module can start depending on
- [ ] task 1 reviewer — the helper itself is right where it belongs. Dropping the keyword changes no behavior and no leg (leg (p) reads only `refereeLinker.PLACEHOLDER_TOKENS`).
- [ ] task 1 reviewer — Cross-runtime coupling in the node linker sim: legs (p), (q) and (t) of `fleet/tests/test_referee_linker.mjs` now read `skills/ultrapowers/scripts/compile_plan.py` from disk and shell out to `python3 -m pytest tests/test_compile_plan.py -k test_placeholder_token_set`, so `node fleet/tests/test_referee_linker.mjs` fails on a tree where the Python toolchain or pytest is absent, or where the linker is exercised outside the repo root (leg (q) resolves ROOT as `HERE/../..`). This is plan-directed — the Proof's Legs list names exactly these as legs of the sim, and M5/M7 pin the compiler's spelling and `test_placeholder_token_set` — and the same facts are already covered independently by four `Run:` probes (grep, sed, and the pytest selection), all green in RUN EVIDENCE. Recorded for the operator: the JS suite is no longer self-contained. Nothing to change inside this task's FILES without dropping legs the plan requires.

Closes #842
