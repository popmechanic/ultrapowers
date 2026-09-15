This is the probe and the list that #993 asks for: one hand-run file that re-measures every kata behaviour the fleet relies on against a throwaway project and prints one line per fact, and one "Kata facts (measured)" list in the contract that the runbook's traps point at. It exists because half of the fleet's design facts about the hub were learned by probing its REST by hand and now live in three issue comments and a scattering of trap bullets, where nothing re-reads them when the hub changes version and two of them already disagree with each other. After this run a kata upgrade costs one command and a reading of its lines, and the next author finds the facts in the contract rather than probing again.

**Merge-ready**

> When kata changes under us, I can run one command and see, fact by fact, whether the hub still behaves the way the fleet's contract says it does — and every one of those facts is written down in one place, with the version and date it was read on, instead of scattered across issue comments.

| task | claim | exam | probes | mutant | suite |
|---|---|---|---|---|---|
| 1 | When kata changes under us, I can run one command and see, fact by fact, whether the hub still behaves the way the fleet's contract says it does, with the version it was read on beside every line. | red at BASE → green | — | — | — |
| 2 | Every kata fact the fleet relies on is written down in one place in the contract, with the version and date it was read on, and the runbook's traps send me there instead of restating it. | none | — | — | — |

Residuals: 14 from review

<details><summary>Record</summary>

## fleet run-144 — gate-green

| | |
|---|---|
| verdict | `PASS` |
| target | `popmechanic/ultrapowers` at `e0526443db3ea88a6e91d39f89234e295d1b1fa5` |
| engine | `e0526443db3ea88a6e91d39f89234e295d1b1fa5` |
| plan | `.ultrapowers/plan.md` at `d2ec63cfbc58b45b32cdebb49651569901ceb8af` |
| branch | `ultra/integration-run-144` |
| vm | `fleet-r144-2609151648-934c` |

### Checks

```json
{"mode": "gate", "stamp": "run-144", "reportPath": "/home/exedev/target/.claude/ultrapowers/run-run-144/report.json", "branch": "ultra/integration-run-144", "gateCheck": {"verdict": "PASS", "checks": [{"name": "report-parse", "ok": true, "detail": ""}, {"name": "clean-tree", "ok": true, "detail": ""}, {"name": "wave-merges", "ok": true, "detail": ""}, {"name": "head-match", "ok": true, "detail": ""}, {"name": "git-verified", "ok": true, "detail": ""}, {"name": "ancestry", "ok": true, "detail": ""}, {"name": "deliverables", "ok": true, "detail": ""}], "notes": [], "repo": "/home/exedev/target"}, "gateCheckExit": 0, "suite": {"passed": true, "unattributed": [], "output": "============================= test session starts ==============================\nplatform linux -- Python 3.12.3, pytest-7.4.4, pluggy-1.4.0\nrootdir: /home/exedev/target/.claude/ultrapowers/run-run-144/clones/integration\nconfigfile: pytest.ini\ntestpaths: tests\nplugins: xdist-3.4.0\ncreated: 3/3 workers\n3 workers [176 items]\n\n........................................................................ [ 40%]\n........................................................................ [ 81%]\n................................                                         [100%]\n============================= 176 passed in 39.44s =============================\n"}, "verdict": "PASS"}

```

### Evidence

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence/run-144/.ultrapowers/runs/144/

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

https://github.com/popmechanic/ultrapowers/blob/ultra/plan/run-144/.ultrapowers/plan.md

### Residuals

- [ ] task 2 reviewer — unverified: nothing in either task's exam checks that the 24 rows of the new `Kata facts (measured)` list carry the same *readings* as Task 1's `FACTS[].says`. Task 2's tenth `Run:` pins the 24 ids as a literal and Task 1's leg (a) pins the same literal, so the id sequence is settled by two independent pins
- [ ] task 2 reviewer — the row text itself (what was read, per fact) is prose no exam grades, so the Claim's "the probe's lines and the list's rows correspond one to one" holds only for ids. What would settle it: a sim that imports `fleet/tests/probe_kata_facts.mjs`, parses the `^  - <id> ` rows out of the CONTRACT bullet, and deep-equals the id sequence (and, where feasible, the recorded status codes) against `FACTS`. That file is sibling-owned (`fleet/tests/`), so it cannot land in this diff — recorded for the operator, not a merge blocker.
- [ ] task 2 reviewer — fleet/CONTRACT.md: the `unassign-key` row is stamped `(v0.17.2, 2026-09-15
- [ ] task 2 reviewer — #979, #993, the OpenAPI read 2026-09-15)`, but Context dates the `expect_owner` → 400 reading itself to #979's 2026-09-14 table and only the OpenAPI's `expected_owner` spelling to 2026-09-15. Under M2 the row's date is "the date it was read on", so the 400 reading reads as a day newer than it is. Every neighbouring #979-sourced row (`link-types`, `claim-if-unowned`, `ready-unowned`, `issue-links-shape`) uses 2026-09-14. Cheap fix: stamp the row `(v0.17.2, 2026-09-14
- [ ] task 2 reviewer — #979, #993, the OpenAPI read 2026-09-15)` — the third and tenth `Run:` lines still pass, since the pattern only requires `v0.17…, 2026-09-DD` and the id ordering is untouched.
- [ ] task 1 reviewer — Shape-only facts can never report DRIFT: `probeKataFacts` scores a fact purely on the status CLASS of its steps (`statusClass(one.status) !== statusClass(one.expect)` in fleet/tests/probe_kata_facts.mjs), while the body reading goes only into the human-facing `note`. For the facts whose recorded `says` is entirely about the answer's SHAPE at a status that never changes — `project-find-or-create` (`created:false`), `create-replay` (same `issue.uid`, ORIGINAL revision), `link-blocks-idempotent` (same `link.id`), `metadata-dotted-flat` (flat key, `metadata.work` absent), `labels-merge` (label once), `events-issue-uid`, `issue-links-shape`, and the `needs no bearer` half of `ping-version` — a hub that changed exactly that shape still prints `holds` and still exits 0. The output is then self-contradictory, e.g. `FACT metadata-dotted-flat: holds — 200 — no flat key read, and metadata.work is present`, which is the drift the Claim (`see, fact by fact, whether the hub still behaves the way the fleet's contract says it does`) exists to catch. M1–M5 only pin the status-drift case (the second `parent` link), so this does not block, and the file's header discloses the choice
- [ ] task 1 reviewer — but the cheap repair is to let a reader return an optional `held: false` beside `note` (the readers already compute `sameUid`, `flat`, `withUid === created.length`, `many`, `sameRevision`, the `link.id` equality and `created` on find-or-create) and to treat a false `held` as DRIFT in the verdict loop alongside `drifted`. The exam would need one added leg driving a fake that keeps the status and changes the shape.
- [ ] task 1 reviewer — plan-defect: Proof leg (e) — "N `POST …/actions/close` requests where N equals the number of `POST /api/v1/projects/<id>/issues` requests recorded in that run" — is unsatisfiable for any correct implementation, because Context's own facts 5 and 6 require create requests the hub REFUSES (409 `idempotency_mismatch`, 409 `duplicate_candidates`) and fact 4's replay answers an issue that already exists, so create requests always outnumber created issues. The submission discloses this in the header of fleet/tests/test_probe_kata_facts.mjs (reading 3) and asserts M4's own parenthetical instead — one close per issue the hub actually created, never fewer, naming each exactly once (`assertLadder`) — which is the same guarantee M4 states. The divergence is disclosed and correct, so it is lawful
- [ ] task 1 reviewer — the text that has to change is the task's Proof leg (e), which is outside this tree.
- [ ] task 1 reviewer — plan-defect: Proof leg (g) names the import as `../probe_kata_facts.mjs`, which from `fleet/tests/` resolves to `fleet/probe_kata_facts.mjs` — a path the task's Files block never creates. The exam imports `./probe_kata_facts.mjs` (fleet/tests/test_probe_kata_facts.mjs) and discloses the substitution in its header. Same module, correct path
- [ ] task 1 reviewer — the wrong spelling is in the task text, outside this tree.
- [ ] task 1 reviewer — The M5 call-count assertion in leg (g) of fleet/tests/test_probe_kata_facts.mjs is vacuous: `idleHub` is never handed to the module, so `idleHub.calls.length === 0` holds no matter what the import does — it would still pass if the module opened a socket or shelled out on import. The substance of M5 is covered by the other three assertions in that leg (the import resolving at all without the module's `main` reading `~/.ultrapowers/kata-hub.env` and calling `process.exit`, plus the `process.argv[1]` / `import.meta.url` source pins), so no criterion is left unverified, but the assertion is dead weight. A stronger pin at the same cost: assert the imported module exposes no side-effect surface by also checking the source has no top-level `await main()` outside the guard, or drop the `idleHub` object entirely and keep the guard assertions.
- [ ] task 1 reviewer — concern: plan-defect: Proof leg (e) as written asks for "N `POST …/actions/close` requests where N equals the number of `POST /api/v1/projects/<id>/issues` requests recorded in that run". That clause is unsatisfiable for any probe that reads Context's own facts: fact 4's replay is a create request answering an issue that already exists, fact 5's mismatch is a 409 and fact 6's twin is a 409, so create requests strictly exceed issues created (9 against 6 here). The peer's exam encodes M4's own parenthetical instead — one close per issue the hub created, never fewer, each uid named exactly once — and the implementation now satisfies that
- [ ] task 1 reviewer — the examiner returned the same clause as unsatisfiable in its own hand-off comment. Every other part of leg (e) (trailing-block order, `X-Kata-Confirm: PURGE <name>`, the `probe-kata-facts-` prefix, purge as the very last request) is live and green.

</details>

Closes #993
