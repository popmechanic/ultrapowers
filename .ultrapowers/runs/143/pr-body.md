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

Residuals: 7 from review

<details><summary>Record</summary>

## fleet run-143 — gate-green

| | |
|---|---|
| verdict | `PASS` |
| target | `popmechanic/ultrapowers` at `1c97ba442c65d882354953d16590b1f8eb0c7a7a` |
| engine | `e0526443db3ea88a6e91d39f89234e295d1b1fa5` |
| plan | `.ultrapowers/plan.md` at `37c5be592a19d77d2fccfe083632f508c4622dce` |
| branch | `ultra/integration-run-143` |
| vm | `fleet-r143-2609151642-ac7d` |

### Checks

```json
{"mode": "gate", "stamp": "run-143", "reportPath": "/home/exedev/target/.claude/ultrapowers/run-run-143/report.json", "branch": "ultra/integration-run-143", "gateCheck": {"verdict": "PASS", "checks": [{"name": "report-parse", "ok": true, "detail": ""}, {"name": "clean-tree", "ok": true, "detail": ""}, {"name": "wave-merges", "ok": true, "detail": ""}, {"name": "head-match", "ok": true, "detail": ""}, {"name": "git-verified", "ok": true, "detail": ""}, {"name": "ancestry", "ok": true, "detail": ""}, {"name": "deliverables", "ok": true, "detail": ""}], "notes": [], "repo": "/home/exedev/target"}, "gateCheckExit": 0, "suite": {"passed": true, "unattributed": [], "output": "============================= test session starts ==============================\nplatform linux -- Python 3.12.3, pytest-7.4.4, pluggy-1.4.0\nrootdir: /home/exedev/target/.claude/ultrapowers/run-run-143/clones/integration\nconfigfile: pytest.ini\ntestpaths: tests\nplugins: xdist-3.4.0\ncreated: 5/5 workers\n5 workers [1791 items]\n\n........................................................................ [  4%]\n........................................................................ [  8%]\n........................................................................ [ 12%]\n........................................................................ [ 16%]\n........................................................................ [ 20%]\n........................................................................ [ 24%]\n........................................................................ [ 28%]\n........................................................................ [ 32%]\n........................................................................ [ 36%]\n........................................................................ [ 40%]\n........................................................................ [ 44%]\n........................................................................ [ 48%]\n........................................................................ [ 52%]\n........................................................................ [ 56%]\n........................................................................ [ 60%]\n........................................................................ [ 64%]\n........................................................................ [ 68%]\n........................................................................ [ 72%]\n........................................................................ [ 76%]\n........................................................................ [ 80%]\n........................................................................ [ 84%]\n........................................................................ [ 88%]\n........................................................................ [ 92%]\n........................................................................ [ 96%]\n...............................................................          [100%]\n=============================== warnings summary ===============================\ntests/test_harvest_fleet_runs.py::test_two_bundles_unpack_to_separate_directories\ntests/test_harvest_fleet_runs.py::test_two_bundles_unpack_to_separate_directories\ntests/test_harvest_fleet_runs.py::test_a_corrupt_tarball_among_healthy_ones_is_named_and_the_rest_land\ntests/test_harvest_fleet_runs.py::test_an_unreadable_tarball_is_named_in_a_whole_failed_lookup_line\ntests/test_harvest_fleet_runs.py::test_discover_unpacks_a_tarball\n  /usr/lib/python3.12/tarfile.py:2301: DeprecationWarning: Python 3.14 will, by default, filter extracted tar archives and reject files or modify their metadata. Use the filter argument to control this behavior.\n    warnings.warn(\n\n-- Docs: https://docs.pytest.org/en/stable/how-to/capture-warnings.html\n================= 1791 passed, 5 warnings in 296.01s (0:04:56) =================\n"}, "verdict": "PASS"}

```

## Publish fold

- attempt 1: conflict parked on fleet/tests/test_run_engine.mjs

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence/run-143/.ultrapowers/runs/143/publish-fold/receipt.json

### Evidence

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence/run-143/.ultrapowers/runs/143/

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

https://github.com/popmechanic/ultrapowers/blob/ultra/plan/run-143/.ultrapowers/plan.md

### Residuals

- [ ] task 2 reviewer — unverified: the deleted `test_the_remote_harvest_test_and_the_swallow_quarantine_entry_are_gone` carried a second assertion — that `tests/test_ultralearn_swallows.py` no longer names `fleet_fetch` (its NOT_YET_SWEPT quarantine entry). The Context table names `test_the_ssh_fetcher_and_its_test_no_longer_exist` as the surviving guard, but that test only checks `skills/ultralearn/scripts/fleet_fetch.py` and `tests/test_fleet_fetch.py` are absent and that `harvest_fleet_runs.py` never mentions `fleet_fetch` (tests/test_harvest_evidence.py:518-524)
- [ ] task 2 reviewer — a stale `fleet_fetch.py` string left in the swallows quarantine list is inert data and would not fail at import, so after this pass nothing in this task's FILES pins it. Nothing in this diff can settle it — `tests/test_ultralearn_swallows.py` is sibling-owned (task 5, popmechanic-ultrapowers#gx1c), and that sibling's pass appears to be what removes the entry. What would settle it: confirming at integration that `fleet_fetch` no longer appears in `tests/test_ultralearn_swallows.py`, or that some kept guard outside this task pins its absence. Recorded, not blocking: the deletion is the one the task explicitly authorizes with that surviving guard named.
- [ ] task 6 reviewer — concern: Proof leg (e) reads red in this sandbox for an environment reason rather than a tree reason, and it needs no fix: `grep -q 'validate_skill.py "${s%/}"' .github/workflows/ci.yml` returns 1 under the sandbox's ugrep-backed `grep` shim, which treats the mid-pattern `$` as an end-of-line anchor, while GNU /usr/bin/grep matches the line at .github/workflows/ci.yml:48. That file is untouched against BASE (the scope Check over `.github` is clean), and the leg's other three greps — test_ultrawrite_skill_validates, test_validate_skill_accepts_it, test_validate_skill_accepts_the_ultrapowers_skill — all match. The same shim would have failed this leg at BASE
- [ ] task 6 reviewer — it asserts only files this task may not modify.
- [ ] task 6 reviewer — concern: tests/test_proof_modes_documented.py's module docstring claimed the file proves `skills/ultrawrite/SKILL.md` still validates, which stopped being true once its only validator test was deleted, so the docstring now names tests/test_validate_skill.py and tests/test_docs_agree_with_code.py as the owners of that run. This is the 4-line insertion in the diff
- [ ] task 6 reviewer — it adds no shouted whole word, so that file's own surviving M5 leg stays green.
- [ ] task 1 reviewer — Stale section header in `tests/test_review_peer.py`: the banner `# ── M4: the authoring docs say peer, and never say adversarial ──` now sits over a section whose only remaining test (`test_skill_md_documents_the_peer_marker`) makes the positive assertion only — the "never say adversarial" half moved to `test_only_the_two_code_sites_under_skills_say_adversarial` when `test_authoring_docs_carry_no_adversarial` was deleted. Nothing in the Machine clauses or the Proof greps touches this line, so it blocks nothing, but the comment now describes a guard the section no longer carries.

</details>

Closes #779
