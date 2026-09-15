_No summary was signed with this plan._

**Parked:** parked: gate verdict BLOCKED

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

Residuals: 10 from review

<details><summary>Record</summary>

## fleet run-141 — parked

| | |
|---|---|
| verdict | `BLOCKED` |
| target | `popmechanic/ultrapowers` at `1c97ba442c65d882354953d16590b1f8eb0c7a7a` |
| engine | `fdb2dd2755ada15c8a00159ea9919c3bf6b2ae2a` |
| plan | `.ultrapowers/plan.md` at `cca306feb3e30ad31bc80bd97aa49d35171091db` |
| branch | `ultra/integration-run-141` |
| vm | `fleet-r141-2609151617-3147` |

### Checks

```json
{"mode": "gate", "stamp": "run-141", "reportPath": "/home/exedev/target/.claude/ultrapowers/run-run-141/report.json", "branch": "ultra/integration-run-141", "gateCheck": {"verdict": "BLOCKED", "checks": [{"name": "report-parse", "ok": true, "detail": ""}, {"name": "clean-tree", "ok": true, "detail": ""}, {"name": "wave-merges", "ok": false, "detail": "merge-sha guard unavailable \u2014 result lacks waveMerges[last].headSha (budget-exhausted or SKIPPED-only run); inspect and redirect/re-run"}, {"name": "head-match", "ok": false, "detail": "skipped \u2014 no recorded merge headSha to compare"}, {"name": "git-verified", "ok": false, "detail": "gitVerified is not true \u2014 the completeness critic could not confirm it reviewed the recorded merge HEAD; the review is unverified"}, {"name": "ancestry", "ok": true, "detail": ""}, {"name": "deliverables", "ok": true, "detail": ""}], "notes": [], "repo": "/home/exedev/target"}, "gateCheckExit": 1, "suite": {"passed": false, "unattributed": [], "output": "not run \u2014 no wave merged"}, "verdict": "BLOCKED"}

```

## Publish fold

- attempt 1: conflict parked on fleet/tests/test_run_engine.mjs

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence/run-141/.ultrapowers/runs/141/publish-fold/receipt.json

### Evidence

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence/run-141/.ultrapowers/runs/141/

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

### Plan

https://github.com/popmechanic/ultrapowers/blob/ultra/plan/run-141/.ultrapowers/plan.md

### Residuals

- [ ] task 1 reviewer — reused from run-134
- [ ] task 2 reviewer — reused from run-134
- [ ] task 3 reviewer — reused from run-134
- [ ] task 6 reviewer — reused from run-134
- [ ] task 7 reviewer — reused from run-134
- [ ] task 8 reviewer — reused from run-134
- [ ] task 9 reviewer — reused from run-134
- [ ] task 10 reviewer — reused from run-134
- [ ] task 4 reviewer — reused from run-134
- [ ] task 5 reviewer — reused from run-134

</details>

Closes #779
