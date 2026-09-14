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

Residuals: 6 from review

<details><summary>Record</summary>

## fleet run-129 — gate-green

| | |
|---|---|
| verdict | `PASS` |
| target | `popmechanic/ultrapowers` at `1c97ba442c65d882354953d16590b1f8eb0c7a7a` |
| engine | `690d22315650be28f65b42040d58a5008f22de9f` |
| plan | `.ultrapowers/plan.md` at `d9ea9f6469cebbac3ce3019b8de3b40073846165` |
| branch | `ultra/integration-run-129` |
| vm | `fleet-r129-2609142017-1c24` |

### Checks

```json
{"mode": "gate", "stamp": "run-129", "reportPath": "/home/exedev/target/.claude/ultrapowers/run-run-129/report.json", "branch": "ultra/integration-run-129", "gateCheck": {"verdict": "PASS", "checks": [{"name": "report-parse", "ok": true, "detail": ""}, {"name": "clean-tree", "ok": true, "detail": ""}, {"name": "wave-merges", "ok": true, "detail": ""}, {"name": "head-match", "ok": true, "detail": ""}, {"name": "git-verified", "ok": true, "detail": ""}, {"name": "ancestry", "ok": true, "detail": ""}, {"name": "deliverables", "ok": true, "detail": ""}], "notes": [], "repo": "/home/exedev/target"}, "gateCheckExit": 0, "suite": {"passed": true, "unattributed": [], "output": "============================= test session starts ==============================\nplatform linux -- Python 3.12.3, pytest-7.4.4, pluggy-1.4.0\nrootdir: /home/exedev/target/.claude/ultrapowers/run-run-129/clones/integration\nconfigfile: pytest.ini\ntestpaths: tests\nplugins: xdist-3.4.0\ncreated: 6/6 workers\n6 workers [1791 items]\n\n........................................................................ [  4%]\n........................................................................ [  8%]\n........................................................................ [ 12%]\n........................................................................ [ 16%]\n........................................................................ [ 20%]\n........................................................................ [ 24%]\n........................................................................ [ 28%]\n........................................................................ [ 32%]\n........................................................................ [ 36%]\n........................................................................ [ 40%]\n........................................................................ [ 44%]\n........................................................................ [ 48%]\n........................................................................ [ 52%]\n........................................................................ [ 56%]\n........................................................................ [ 60%]\n........................................................................ [ 64%]\n........................................................................ [ 68%]\n........................................................................ [ 72%]\n........................................................................ [ 76%]\n........................................................................ [ 80%]\n........................................................................ [ 84%]\n........................................................................ [ 88%]\n........................................................................ [ 92%]\n........................................................................ [ 96%]\n...............................................................          [100%]\n=============================== warnings summary ===============================\ntests/test_harvest_fleet_runs.py::test_discover_unpacks_a_tarball\ntests/test_harvest_fleet_runs.py::test_two_bundles_unpack_to_separate_directories\ntests/test_harvest_fleet_runs.py::test_two_bundles_unpack_to_separate_directories\ntests/test_harvest_fleet_runs.py::test_a_corrupt_tarball_among_healthy_ones_is_named_and_the_rest_land\ntests/test_harvest_fleet_runs.py::test_an_unreadable_tarball_is_named_in_a_whole_failed_lookup_line\n  /usr/lib/python3.12/tarfile.py:2301: DeprecationWarning: Python 3.14 will, by default, filter extracted tar archives and reject files or modify their metadata. Use the filter argument to control this behavior.\n    warnings.warn(\n\n-- Docs: https://docs.pytest.org/en/stable/how-to/capture-warnings.html\n================= 1791 passed, 5 warnings in 294.50s (0:04:54) =================\n"}, "verdict": "PASS"}

```

## Publish fold

- attempt 1: conflict parked on fleet/tests/test_run_engine.mjs

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence/run-129/.ultrapowers/runs/129/publish-fold/receipt.json

### Evidence

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence/run-129/.ultrapowers/runs/129/

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

https://github.com/popmechanic/ultrapowers/blob/ultra/plan/run-129/.ultrapowers/plan.md

### Residuals

- [ ] task 5 reviewer — unverified: the Claim's second half — "the species exam, the check-cost exam and the three reader files run once each" — is a cross-task property this diff cannot settle. The diff (and its M2 exam, Run 7) only establishes that the five re-run targets exist under tests/ and that pytest.ini scopes the suite to tests/, plus that these five files no longer spawn pytest (Run 6, exit 0). At BASE the only other in-repo spawner of one of those targets is tests/test_ultrawrite_surface_rules_implementer_check.py:107 (its eight-file re-run, which includes tests/test_compile_plan_check_cost.py) — a SIBLING FILES path this task correctly does not touch (sibling task 4 deletes it). What would settle it: after the fold, a repo-wide `! grep -rn '"-m", "pytest"' tests/ fleet/tests/` (or a grep for those five target paths inside subprocess argv) showing no surviving re-run of test_compile_plan_proof_species.py, test_compile_plan_check_cost.py, test_readers.py, test_fleet_slice.py or test_merge_ledger.py. No criterion of this task is blocked by it — this is advisory only.
- [ ] task 5 reviewer — Stale module docstrings: two of the edited files still advertise, in their header M-clause prose, the very leg the diff deleted. tests/test_compile_plan_sha_unguarded.py line 31 ends its M4 summary with "and `tests/test_compile_plan_proof_species.py` still passes." — the only thing that established that was the now-deleted test_the_five_species_exam_still_passes. tests/test_compile_plan_one_sided.py line 34 ends its M4 summary with "— that whole exam still passes", likewise now unheld (the preceding clause about the five-species fixture printing five lines is still covered by kept tests, so only the trailing clause is stale). The header now describes a guarantee the file does not carry, which invites a later reader to reinstate the sibling re-run. Trimming those two prose clauses is consistent with Global Constraint 1 (test files only) and does not touch an assertion, so Constraint 3 is not in play. Left as minor: no Machine clause or Proof Run asks for it, and Run 3/Run 2 and the suite (116 passed) are unaffected either way.
- [ ] task 9 reviewer — Stale header docblock clause: the file's leg summary at the top of fleet/tests/test_retire.mjs still reads "(l) M7 — the two documents each declare the skip, carrying `— skipped`, and the docs-pin suite is green over both." (BASE lines 58–59). The second half of that sentence describes the `spawnSync('python3', ['-m','pytest','tests/test_docs_agree_with_code.py',…])` block this patch correctly deletes, so the header now advertises a leg the sim no longer runs. The task's Context named only the tail comment near BASE line 1558 as going with the block, so this is not a required deletion and the Proof's first `Run:` still passes (the clause names no `test_docs_agree_with_code` literal) — but it is a comment that served only the deleted block, which Global Constraint 3's spirit sends with it. Fix is inside this task's FILES.
- [ ] task 10 reviewer — Stale section comment in fleet/tests/test_publish_fold.mjs:1615. The (h) block header still reads "the contract's two sentences, and the Proof's two Run: legs", but after this pass the block executes only one Run: leg — the GREP over fleet/CONTRACT.md — since the `python3 -m pytest -q tests/test_docs_agree_with_code.py` pin (and its own comment) was correctly removed. Nothing the task requires hangs on it: M1 is satisfied (RUN evidence, first Run: exit 0, zero occurrences of test_docs_agree_with_code in the file) and the deleted rows match the Context table exactly, including the KEEP rows (two `engine:phase` seds in test_sandbox_boot.mjs, the rfLines `deferred:manual`/`verbatim` pin in test_run_main.mjs — second Run: exit 0). The helpers the deletions left behind are all still used by kept assertions (`runIn`/`REPO` at test_publish_fold.mjs:1662,1669
- [ ] task 10 reviewer — `spawnSync` at test_run_engine_suite_passes.mjs:232
- [ ] task 10 reviewer — `sh` at test_run_main.mjs:904-922), so no orphaned import or constant remains. This is a one-word comment nit in a pass whose subject is removing exactly this kind of staleness.

</details>

Closes #779
