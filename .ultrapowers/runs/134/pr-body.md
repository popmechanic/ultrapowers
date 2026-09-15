_No summary was signed with this plan._

**Merge-ready**

> Every test that byte-pins BASE text of a file outside its subject's Files, and every duplicate assertion the readers marked pinned-elsewhere, is deleted, and each deletion is proven by a Run: that shows the surviving pin (a grep of the remaining test) still guards the behaviour; the plan lists each deleted test by file and name.

| task | claim | exam | probes | mutant | suite |
|---|---|---|---|---|---|
| 1 | After this run `tests/test_review_peer.py` names no sibling test file and holds no handle on the skill validator, and it asserts the absence of `adversarial` exactly once — in its rglob over `skills/` — while the guards it dropped still hold in the files that own them: `tests/test_compile_plan.py` for the peer pin, `tests/test_validate_skill.py` for the validator. | none | — | — | — |
| 2 | After this run neither `tests/test_harvest_evidence.py` nor `tests/test_harvest_fleet_runs_publish_fold.py` reads another test file's source to prove a deletion or a key set; the absence of the ssh fetcher, the flag allowlist and the bundle key set are each guarded where they live. | none | — | — | — |
| 3 | After this run `tests/test_roles_run_evidence.py` neither greps the role files for shouted imperatives and `adversarial` nor spawns the peer and examiner role sims; the register sweep lives in the role-file exam and the sims run through the fleet bridge. | none | — | — | — |
| 4 | After this run `tests/test_ultrawrite_surface_rules_implementer_check.py` neither counts shouted words in the ultrawrite skill, nor spawns pytest over eight sibling test files, nor runs the skill validator; each of those is held by the files that own it — the proof-modes exam, the suite's own collection, and the validator's tests. | none | — | — | — |
| 5 | After this run none of the four compiler-species test files nor the ultralearn swallows file spawns pytest over a sibling test file; the species exam, the check-cost exam and the three reader files run once each, as the suite's own members. | none | — | — | — |
| 6 | After this run the ultrawrite skill's header-Claim count is asserted once in `tests/test_plan_level_claim.py`, and no test in these four files runs the skill validator — `tests/test_validate_skill.py` and `tests/test_docs_agree_with_code.py` own that. | none | — | — | — |
| 7 | After this run `fleet/tests/test_run_engine.mjs` no longer pins the two reviewer.md rule sentences nor asserts the role files free of shouted imperatives — both live in the role-file exam — while it still reports every role file's prose size on stderr. | none | — | — | — |
| 8 | After this run `fleet/tests/test_run_engine_critic_inputs.mjs` no longer loops over `Claim` and `Context` to assert critic.md names each slot; the role-file exam holds that pin once. | none | — | — | — |
| 9 | After this run `fleet/tests/test_retire.mjs` neither sweeps CONTRACT.md and RUNBOOK.md for an evidence-branch `?ref=` read nor spawns `tests/test_docs_agree_with_code.py`; the sweep is that suite's own test and the suite runs it. | none | — | — | — |
| 10 | After this run none of `test_publish_fold.mjs`, `test_run_engine_suite_passes.mjs`, `test_sandbox_boot.mjs` and `test_run_main.mjs` spawns `tests/test_docs_agree_with_code.py`, `tests/test_fleet_events.py` or the integrated-clean sim; each of those runs once, as the suite's own member. | none | — | — | — |

Residuals: 5 from review

<details><summary>Record</summary>

## fleet run-134 — gate-green

| | |
|---|---|
| verdict | `PASS` |
| target | `popmechanic/ultrapowers` at `1c97ba442c65d882354953d16590b1f8eb0c7a7a` |
| engine | `597c6db1493bdafaeb7f21972856a7e702847aa6` |
| plan | `.ultrapowers/plan.md` at `6ad7c13261bf4ef5295d707d77eb230523e81345` |
| branch | `ultra/integration-run-134` |
| vm | `fleet-r134-2609150818-80ec` |

### Checks

```json
{"mode": "gate", "stamp": "run-134", "reportPath": "/home/exedev/target/.claude/ultrapowers/run-run-134/report.json", "branch": "ultra/integration-run-134", "gateCheck": {"verdict": "PASS", "checks": [{"name": "report-parse", "ok": true, "detail": ""}, {"name": "clean-tree", "ok": true, "detail": ""}, {"name": "wave-merges", "ok": true, "detail": ""}, {"name": "head-match", "ok": true, "detail": ""}, {"name": "git-verified", "ok": true, "detail": ""}, {"name": "ancestry", "ok": true, "detail": ""}, {"name": "deliverables", "ok": true, "detail": ""}], "notes": [], "repo": "/home/exedev/target"}, "gateCheckExit": 0, "suite": {"passed": true, "unattributed": [], "output": "============================= test session starts ==============================\nplatform linux -- Python 3.12.3, pytest-7.4.4, pluggy-1.4.0\nrootdir: /home/exedev/target/.claude/ultrapowers/run-run-134/clones/integration\nconfigfile: pytest.ini\ntestpaths: tests\nplugins: xdist-3.4.0\ncreated: 5/5 workers\n5 workers [1791 items]\n\n........................................................................ [  4%]\n........................................................................ [  8%]\n........................................................................ [ 12%]\n........................................................................ [ 16%]\n........................................................................ [ 20%]\n........................................................................ [ 24%]\n........................................................................ [ 28%]\n........................................................................ [ 32%]\n........................................................................ [ 36%]\n........................................................................ [ 40%]\n........................................................................ [ 44%]\n........................................................................ [ 48%]\n........................................................................ [ 52%]\n........................................................................ [ 56%]\n........................................................................ [ 60%]\n........................................................................ [ 64%]\n........................................................................ [ 68%]\n........................................................................ [ 72%]\n........................................................................ [ 76%]\n........................................................................ [ 80%]\n........................................................................ [ 84%]\n........................................................................ [ 88%]\n........................................................................ [ 92%]\n........................................................................ [ 96%]\n...............................................................          [100%]\n=============================== warnings summary ===============================\ntests/test_harvest_fleet_runs.py::test_two_bundles_unpack_to_separate_directories\ntests/test_harvest_fleet_runs.py::test_two_bundles_unpack_to_separate_directories\ntests/test_harvest_fleet_runs.py::test_a_corrupt_tarball_among_healthy_ones_is_named_and_the_rest_land\ntests/test_harvest_fleet_runs.py::test_an_unreadable_tarball_is_named_in_a_whole_failed_lookup_line\ntests/test_harvest_fleet_runs.py::test_discover_unpacks_a_tarball\n  /usr/lib/python3.12/tarfile.py:2301: DeprecationWarning: Python 3.14 will, by default, filter extracted tar archives and reject files or modify their metadata. Use the filter argument to control this behavior.\n    warnings.warn(\n\n-- Docs: https://docs.pytest.org/en/stable/how-to/capture-warnings.html\n================= 1791 passed, 5 warnings in 287.86s (0:04:47) =================\n"}, "verdict": "PASS"}

```

## Publish fold

- attempt 1: conflict parked on fleet/tests/test_run_engine.mjs

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence/run-134/.ultrapowers/runs/134/publish-fold/receipt.json

### Evidence

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence/run-134/.ultrapowers/runs/134/

- approve-receipt.json
- claude-version.txt
- engine.log
- events.jsonl
- gate-receipt.json
- kata.jsonl
- pr-body.md
- publish-fold
- receipt.json
- report.json
- residuals.jsonl
- status.json
- transcripts

### Plan

https://github.com/popmechanic/ultrapowers/blob/ultra/plan/run-134/.ultrapowers/plan.md

### Residuals

- [ ] task 2 reviewer — unverified: the Claim asserts each deleted pin's subject stays "guarded where it lives", but one half of `test_the_remote_harvest_test_and_the_swallow_quarantine_entry_are_gone` — the assertion that `fleet_fetch` no longer appears in `tests/test_ultralearn_swallows.py`'s quarantine list — has no successor guard inside this diff. The Context table's stated survivor, `test_the_ssh_fetcher_and_its_test_no_longer_exist` (kept at tests/test_harvest_evidence.py, asserting `not (REPO / "tests/test_fleet_fetch.py").exists()` and `"fleet_fetch" not in HARVEST.read_text()`), covers the fetcher module and the harvester's imports, but a stale *string* entry naming `fleet_fetch.py` in a swallow-quarantine list would not fail at import and so is not caught by it. This is a plan-level coverage question, not an implementer defect: `tests/test_ultralearn_swallows.py` is sibling task 5's (popmechanic-ultrapowers#deef) file, and re-adding a cross-file source read inside this task's FILES is precisely what the task forbids. What would settle it: sibling 5's own change to `tests/test_ultralearn_swallows.py` removing the `fleet_fetch` entry, or a guard in the swallow-list's own owning module. Nothing in this diff blocks on it — the two Proof legs that name this deletion (first Run:, third Run:) both show exit 0 in RUN EVIDENCE.
- [ ] task 1 reviewer — Orphaned constant: `PLAN_MARKERS_MD` (tests/test_review_peer.py, the `ROOT / "skills/ultrapowers/references/plan-markers.md"` assignment) was referenced at BASE only by `test_authoring_docs_carry_no_adversarial`, which this patch deletes. Global constraint 3 — "A helper, import or constant that served only a deleted test goes with it
- [ ] task 1 reviewer — one that a kept test still uses stays" — is the only ground for this finding and it carries no `Check:` the driver ran, so it is minor. (The task's own Context enumerates `COMPILE_PLAN_TESTS`, `VALIDATE_SKILL` and `_occurrences` as the constants/helpers to drop and overlooks this one
- [ ] task 1 reviewer — no Machine clause or Proof `Run:` grep mentions it, and removing it changes neither the 12-test collection count nor any pinned literal, so the fix is safe inside this task's FILES.) Every other symbol the deleted code used is correctly retired or still live: `_occurrences` goes with the three `hits == []` lines
- [ ] task 1 reviewer — `re`, `sys`, `subprocess`, `sh`, `SKILL_MD`, `REPORT_FORMAT_MD`, `DEPENDENCY_ANALYSIS_MD`, `ULTRADOCKET_SKILL_MD`, `COMPILER`, `DRIVER`, `SKILLS_DIR` and `LEGACY_CODE_SITES` all still serve kept tests.

</details>

Closes #779
