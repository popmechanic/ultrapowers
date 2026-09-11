## fleet run-92 — parked

| | |
|---|---|
| verdict | `BLOCKED` |
| target | `popmechanic/ultrapowers` at `0e1a4f00b71083503641452bf7cbe1484a27f2d5` |
| engine | `0e1a4f00b71083503641452bf7cbe1484a27f2d5` |
| plan | `.ultrapowers/plan.md` at `8424cf7ae0e41ba1985714e7f98e5c7b28e18954` |
| branch | `ultra/integration-run-92` |
| vm | `fleet-r92-2609102327-002b` |

### Checks

```json
{"mode": "gate", "stamp": "run-92", "reportPath": "/home/exedev/target/.claude/ultrapowers/run-run-92/report.json", "branch": "ultra/integration-run-92", "gateCheck": {"verdict": "BLOCKED", "checks": [{"name": "report-parse", "ok": true, "detail": ""}, {"name": "clean-tree", "ok": true, "detail": ""}, {"name": "wave-merges", "ok": true, "detail": ""}, {"name": "head-match", "ok": true, "detail": ""}, {"name": "git-verified", "ok": false, "detail": "gitVerified is not true \u2014 the completeness critic could not confirm it reviewed the recorded merge HEAD; the review is unverified"}, {"name": "ancestry", "ok": true, "detail": ""}, {"name": "deliverables", "ok": false, "detail": "failed/blocked tasks left declared deliverables unproduced: [{\"task\": \"2\", \"files\": [\"README.md\", \"fleet/CONTRACT.md\", \"fleet/RUNBOOK.md\", \"fleet/sandbox-boot.sh\", \"fleet/tests/_sandbox_boot_helpers.mjs\", \"fleet/tests/test_sandbox_boot.mjs\", \"fleet/tests/test_sandbox_boot_card.mjs\", \"fleet/tests/test_sandbox_boot_join.mjs\", \"fleet/tests/test_sandbox_boot_publish_fold.mjs\", \"fleet/tests/test_sandbox_boot_residuals.mjs\", \"fleet/tests/test_sandbox_boot_selfmerge.mjs\", \"skills/ultrapowers/SKILL.md\", \"tests/test_docs_agree_with_code.py\"]}]"}], "repo": "/home/exedev/target"}, "gateCheckExit": 1, "suite": {"passed": true, "unattributed": [], "output": "============================= test session starts ==============================\nplatform linux -- Python 3.12.3, pytest-7.4.4, pluggy-1.4.0\nrootdir: /home/exedev/target/.claude/ultrapowers/run-run-92/clones/integration\nconfigfile: pytest.ini\ntestpaths: tests\nplugins: xdist-3.4.0\ncreated: 6/6 workers\n6 workers [1618 items]\n\n........................................................................ [  4%]\n........................................................................ [  8%]\n........................................................................ [ 13%]\n........................................................................ [ 17%]\n........................................................................ [ 22%]\n........................................................................ [ 26%]\n........................................................................ [ 31%]\n........................................................................ [ 35%]\n........................................................................ [ 40%]\n........................................................................ [ 44%]\n........................................................................ [ 48%]\n........................................................................ [ 53%]\n........................................................................ [ 57%]\n........................................................................ [ 62%]\n........................................................................ [ 66%]\n........................................................................ [ 71%]\n........................................................................ [ 75%]\n........................................................................ [ 80%]\n........................................................................ [ 84%]\n........................................................................ [ 88%]\n........................................................................ [ 93%]\n........................................................................ [ 97%]\n..................................                                       [100%]\n=============================== warnings summary ===============================\ntests/test_harvest_fleet_runs.py::test_discover_unpacks_a_tarball\ntests/test_harvest_fleet_runs.py::test_two_bundles_unpack_to_separate_directories\ntests/test_harvest_fleet_runs.py::test_two_bundles_unpack_to_separate_directories\ntests/test_harvest_fleet_runs.py::test_a_corrupt_tarball_among_healthy_ones_is_named_and_the_rest_land\ntests/test_harvest_fleet_runs.py::test_an_unreadable_tarball_is_named_in_a_whole_failed_lookup_line\n  /usr/lib/python3.12/tarfile.py:2301: DeprecationWarning: Python 3.14 will, by default, filter extracted tar archives and reject files or modify their metadata. Use the filter argument to control this behavior.\n    warnings.warn(\n\n-- Docs: https://docs.pytest.org/en/stable/how-to/capture-warnings.html\n================= 1618 passed, 5 warnings in 413.44s (0:06:53) =================\n"}, "verdict": "BLOCKED"}

```

### Evidence

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence/run-92/.ultrapowers/runs/92/

- claude-version.txt
- engine.log
- events.jsonl
- gate-receipt.json
- pr-body.md
- publish-fold
- receipt.json
- referee
- report.json
- residuals.jsonl
- status.json
- transcripts

### Plan

https://github.com/popmechanic/ultrapowers/blob/ultra/plan/run-92/.ultrapowers/plan.md

### Residuals

- [ ] task 1 reviewer — unverified: the Claim's second half — "those sentences ride the plan into the run" — cannot be settled by this diff. This patch only documents the plan-side shape in `skills/ultrawrite/SKILL.md`
- [ ] task 1 reviewer — the mechanism that carries a signed `**Summary:**` paragraph into the pull request body lives in `fleet/sandbox-boot.sh` (`plan_summary`), which is sibling task 2's file and is untouched here. All five Machine clauses M1–M5 are evidenced (each Proof `Run:` exited 0, including the `compile_plan.py --check` fixture printing `PLAN OK` and `validate_skill.py skills/ultrawrite`), so the task's own exam is satisfied
- [ ] task 1 reviewer — what remains open is the cross-task agreement. What would settle it: task 2's `fleet/tests/test_sandbox_boot_card.mjs` leg (a), which asserts the rendered `pr-body.md`'s first non-empty line is the stub plan's summary paragraph with the `**Summary:** ` label stripped — i.e. that task 2's reader consumes exactly the shape this paragraph documents (a line beginning `**Summary:** ` directly under the `**Claim:**` line, running to the next blank line, no markdown inside).
- [ ] task 1 reviewer — unverified: the two GLOBAL CONSTRAINTS both govern the published card (nothing above the collapsed record is a hash/JSON fence/file listing/reviewer sentence
- [ ] task 1 reviewer — every card value is read from the plan file, `report.json`, `gate-receipt.json` or the status page). Neither carries a `Check:` the driver ran against this diff, and this diff touches no card-rendering code. Reading them against what it does add: the documented summary is authored and operator-confirmed at plan time and quoted verbatim at publish, which is a read of the plan file rather than a model narration at publish time, and the paragraph is explicitly prose-only ("no markdown inside"), so nothing here introduces a hash or fence above the record. Confirming this end-to-end is task 2's `fleet/tests/test_sandbox_boot_card.mjs`, not this patch.

