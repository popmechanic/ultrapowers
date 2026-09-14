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

Residuals: 11 from review

<details><summary>Record</summary>

## fleet run-124 — gate-green

| | |
|---|---|
| verdict | `NEEDS_ACK` |
| target | `popmechanic/ultrapowers` at `1c97ba442c65d882354953d16590b1f8eb0c7a7a` |
| engine | `a8a8b9eb461cd54b08399ac8d9d0abba40c07c98` |
| plan | `.ultrapowers/plan.md` at `34530667a149c0fc6aa95142ca4cea99fc28a15e` |
| branch | `ultra/integration-run-124` |
| vm | `fleet-r124-2609141602-4b9f` |

### Checks

```json
{"mode": "gate", "stamp": "run-124", "reportPath": "/home/exedev/target/.claude/ultrapowers/run-run-124/report.json", "branch": "ultra/integration-run-124", "gateCheck": {"verdict": "NEEDS_ACK", "checks": [{"name": "report-parse", "ok": true, "detail": ""}, {"name": "clean-tree", "ok": true, "detail": ""}, {"name": "wave-merges", "ok": true, "detail": ""}, {"name": "head-match", "ok": true, "detail": ""}, {"name": "git-verified", "ok": true, "detail": ""}, {"name": "ancestry", "ok": true, "detail": ""}, {"name": "deliverables", "ok": true, "detail": ""}], "notes": [], "repo": "/home/exedev/target"}, "gateCheckExit": 2, "suite": {"passed": true, "unattributed": [], "output": "============================= test session starts ==============================\nplatform linux -- Python 3.12.3, pytest-7.4.4, pluggy-1.4.0\nrootdir: /home/exedev/target/.claude/ultrapowers/run-run-124/clones/integration\nconfigfile: pytest.ini\ntestpaths: tests\nplugins: xdist-3.4.0\ncreated: 6/6 workers\n6 workers [1791 items]\n\n........................................................................ [  4%]\n........................................................................ [  8%]\n........................................................................ [ 12%]\n........................................................................ [ 16%]\n........................................................................ [ 20%]\n........................................................................ [ 24%]\n........................................................................ [ 28%]\n........................................................................ [ 32%]\n........................................................................ [ 36%]\n........................................................................ [ 40%]\n........................................................................ [ 44%]\n........................................................................ [ 48%]\n........................................................................ [ 52%]\n........................................................................ [ 56%]\n........................................................................ [ 60%]\n........................................................................ [ 64%]\n........................................................................ [ 68%]\n........................................................................ [ 72%]\n........................................................................ [ 76%]\n........................................................................ [ 80%]\n........................................................................ [ 84%]\n........................................................................ [ 88%]\n........................................................................ [ 92%]\n........................................................................ [ 96%]\n...............................................................          [100%]\n=============================== warnings summary ===============================\ntests/test_harvest_fleet_runs.py::test_discover_unpacks_a_tarball\ntests/test_harvest_fleet_runs.py::test_two_bundles_unpack_to_separate_directories\ntests/test_harvest_fleet_runs.py::test_two_bundles_unpack_to_separate_directories\ntests/test_harvest_fleet_runs.py::test_a_corrupt_tarball_among_healthy_ones_is_named_and_the_rest_land\ntests/test_harvest_fleet_runs.py::test_an_unreadable_tarball_is_named_in_a_whole_failed_lookup_line\n  /usr/lib/python3.12/tarfile.py:2301: DeprecationWarning: Python 3.14 will, by default, filter extracted tar archives and reject files or modify their metadata. Use the filter argument to control this behavior.\n    warnings.warn(\n\n-- Docs: https://docs.pytest.org/en/stable/how-to/capture-warnings.html\n================= 1791 passed, 5 warnings in 293.40s (0:04:53) =================\n"}, "verdict": "NEEDS_ACK"}

```

## Publish fold

- attempt 1: conflict parked on fleet/tests/test_run_engine.mjs

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence/run-124/.ultrapowers/runs/124/publish-fold/receipt.json

### Evidence

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence/run-124/.ultrapowers/runs/124/

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
- standing-approval.json
- status.json
- transcripts

### Plan

https://github.com/popmechanic/ultrapowers/blob/ultra/plan/run-124/.ultrapowers/plan.md

### Residuals

- [ ] task 1 reviewer — unverified: the task's Acceptance is `suite — the committed suite is the verification`, but the evidence in hand executes only the four Proof `Run:` commands (this file, plus the single `tests/test_compile_plan.py::test_review_marker_emits_adversarial_slot` node) and the three constraint `Check:` diffs — not the whole committed suite. The one cross-reference to this path I can see at BASE, `tests/test_ultrawrite_surface_rules_implementer_check.py:102` (`test_m5_the_tests_that_read_the_skill_still_pass`), runs `tests/test_review_peer.py` as a subprocess and is settled by Run 4's `exit 0`
- [ ] task 1 reviewer — nothing else in the tree names this file. What would settle the rest is a full-suite run on the integrated tree after the sibling tasks land — a cross-task claim this single-file diff cannot carry. No action for this diff.
- [ ] task 2 reviewer — unverified: the Claim's clause that the absence of the ssh fetcher is "guarded where it lives" is only partly settled by this diff. The deleted `test_the_remote_harvest_test_and_the_swallow_quarantine_entry_are_gone` carried a second assertion — `"fleet_fetch" not in tests/test_ultralearn_swallows.py` — and the surviving guard the Context names for it, `test_the_ssh_fetcher_and_its_test_no_longer_exist`, only pins that `skills/ultralearn/scripts/fleet_fetch.py` and `tests/test_fleet_fetch.py` are absent and that the harvester's source does not mention `fleet_fetch`. The Context's rationale ("any surviving reference would fail at import") does not hold for a `NOT_YET_SWEPT` quarantine-list *string* naming a deleted path, which is what the deleted assertion actually pinned
- [ ] task 2 reviewer — nothing in either file this task owns covers it after the deletion. `tests/test_ultralearn_swallows.py` is sibling task 5's, so this diff cannot settle it and it does not block here. What would settle it: task 5's tree showing `fleet_fetch` removed from that file's quarantine list, or the full suite green after both tasks land.
- [ ] task 3 reviewer — unverified: the Acceptance line is `suite — the committed suite is the verification`, and the evidence present covers only the three Proof `Run:` commands (which include `pytest tests/test_roles_run_evidence.py`, exit 0) and the three constraint `Check:` diffs (all exit 0)
- [ ] task 3 reviewer — a full-suite run is not in evidence and the diff alone cannot settle it. What would settle it: a green whole-suite run at HEAD. Grounds for confidence short of that: the two deleted names (`test_the_two_role_files_keep_their_register`, `test_both_role_exams_still_pass_with_their_verbatim_pins`) appear nowhere else in the tree, so no other suite file asserts their presence, and the patch adds no lines at all — it is a pure deletion confined to `tests/test_roles_run_evidence.py`.
- [ ] task 4 reviewer — unverified: M2's surviving-guard leg is checked in this clone only, where sibling task 6's edits to `tests/test_proof_modes_documented.py` are not yet applied. This diff cannot settle that the shout guard survives the fold: task 6 also edits that file (deleting `test_leg_e_m5_validate_skill_prints_skill_ok`, keeping `test_leg_e_m5_no_shouted_whole_word_is_added_to_the_three_files`). Read at BASE, the guard is real — `tests/test_proof_modes_documented.py:52` defines that test, `:58` sweeps `SKILL_PATH, EXAMINER_PATH, MARKERS_PATH` and `:63` asserts `counts == BASE_SHOUT_COUNTS` — and task 6's own Proof pins it present with a collect-count of exactly 1, so the edge is declared on both sides. What would settle it: re-running this task's second `Run:` bullet on the integrated tree after task 6 lands. No action needed inside this diff.
- [ ] task 5 reviewer — unverified: the Acceptance line is "suite — the committed suite is the verification", but the captured evidence exercises only the five edited files (`python3 -m pytest -q ... five paths` → exit 0, 116 passed) plus the three GLOBAL CONSTRAINT `Check:` diffs. Nothing in this patch can be wrong across the rest of the suite — all six removals are whole top-level test functions and the two companion removals are file-local (`SPECIES_EXAM` in tests/test_compile_plan_sha_unguarded.py, `import subprocess`/`import sys` in tests/test_ultralearn_swallows.py, each used at BASE only by the test being deleted
- [ ] task 5 reviewer — the four compiler files keep those imports because 8–11 other `subprocess.`/`sys.` uses remain in each) — so this is recorded, not a defect. A full `python3 -m pytest -q` at integration would settle it.
- [ ] task 6 reviewer — Stale module docstring in `tests/test_skill_setup_section.py`. The deletion of `test_validate_skill_accepts_the_ultrapowers_skill` (and of the `subprocess`/`sys` imports) leaves the header claiming the file still re-pins "the four things ... the launch line's flags, the walk, the VM name shape, `validate_skill.py`" (line 24) and that it "runs one local Python script" (line 29). Neither is true after the patch: the file now re-pins three things and runs no subprocess. Nothing in the task's Machine clauses or Proof covers the docstring, and the suite is green either way, so this is advisory only — but it is the one place in the four edited files where a reference to the removed validator run survives.
- [ ] task 9 reviewer — unverified: the Acceptance line is "suite — the committed suite is the verification", but the evidence behind this submission is scoped to this task's own Proof `Run:` commands — the three greps plus `tests/test_fleet_suite.py::test_fleet_mjs[test_retire.mjs]` (all exit 0). Whole-suite green over the fold of all ten sibling deletions is a cross-task property this one-file diff cannot settle. Nothing in the diff plausibly reaches beyond fleet/tests/test_retire.mjs: the two deleted blocks (BASE 869–875 branchRefs loop, 877–883 pytest spawn) and the tail comment at BASE 1558–1560 are self-contained, and the `spawnSync` import (fleet/tests/test_retire.mjs:103) and `REPO_ROOT` (:842) correctly stay because kept code at :903, :1228 and :1488 still uses them. What would settle it: a full `python3 -m pytest -q -p no:cacheprovider` on the integrated branch after all ten tasks fold.

</details>

Closes #779
