This makes a worker's amendment to the plan a first-class row of the run instead of a sentence buried in a judgment call: when a worker edits a file the plan did not list, reads a clause differently to make the exam pass, or re-aims a sim outside its files, it declares that as a typed amendment, and the driver writes it on the evidence branch, hands it to the reviewer as a lens, prints it on the pull request card and counts it in the release census. It exists because the doctrine said the plan binds while the record showed good workers amending it whenever the amendment was small and honest — run-133's first task made four such changes and merged clean, run-2 died on a reviewer who could not tell whether one was lawful — and a rule that is honoured only sometimes leaves both the author and the reviewer guessing. After this run the plan is a submission the worker may amend in the open, every amendment is on the record per run and per task, the doctrine says so in as many words, and a leg no implementation can pass still parks the task for the plan exactly as it does today.

**Merge-ready**

> After a run I can read every place a worker changed what the plan asked for — which task, what kind of change, what it did and why — on the run's record, in its pull request and in the release's count, and the reviewer judged each change instead of undoing it.

| task | claim | exam | probes | mutant | suite |
|---|---|---|---|---|---|
| 1 | When a worker changes what the plan asked for — a file outside its list, a clause read another way, a sim outside its list re-aimed — it says so in a typed row, and I can read that row on the run's record and on the run's report, per task. | red at BASE → green | — | — | — |
| 2 | The reviewer is handed each amendment the worker declared and judges whether the change is right, and it no longer treats an honest, declared change as something to revert. | red at BASE → green | — | — | — |
| 3 | When I open the run's pull request I see every amendment listed by task, above the folded record, and the contract and the report reference say exactly what the row is. | red at BASE → green | — | — | — |
| 4 | When I read a release's census, each run's row says how many amendments its workers made and the totals line adds them up, so the reading the decision asked for is one number I can watch across releases. | red at BASE → green | — | — | — |
| 5 | When I read the project's doctrine and the authoring skill, they say in plain words that the plan is a submission a worker may amend in the open, not a contract that binds — and the lesson that once said "list every file or die" now says what happens instead. | none | — | — | — |

Residuals: 23 from review

<details><summary>Record</summary>

## fleet run-150 — gate-green

| | |
|---|---|
| verdict | `PASS` |
| target | `popmechanic/ultrapowers` at `41cb53b606146ee16f7904eaf0440531257426f1` |
| engine | `41cb53b606146ee16f7904eaf0440531257426f1` |
| plan | `.ultrapowers/plan.md` at `7f001c8b35d6853864d8c5f9c633fe711c5c7f17` |
| branch | `ultra/integration-run-150` |
| vm | `fleet-r150-2609151814-079e` |

### Checks

```json
{"mode": "gate", "stamp": "run-150", "reportPath": "/home/exedev/target/.claude/ultrapowers/run-run-150/report.json", "branch": "ultra/integration-run-150", "gateCheck": {"verdict": "PASS", "checks": [{"name": "report-parse", "ok": true, "detail": ""}, {"name": "clean-tree", "ok": true, "detail": ""}, {"name": "wave-merges", "ok": true, "detail": ""}, {"name": "head-match", "ok": true, "detail": ""}, {"name": "git-verified", "ok": true, "detail": ""}, {"name": "ancestry", "ok": true, "detail": ""}, {"name": "deliverables", "ok": true, "detail": ""}], "notes": [], "repo": "/home/exedev/target"}, "gateCheckExit": 0, "suite": {"passed": true, "unattributed": [], "output": "============================= test session starts ==============================\nplatform linux -- Python 3.12.3, pytest-7.4.4, pluggy-1.4.0\nrootdir: /home/exedev/target/.claude/ultrapowers/run-run-150/clones/integration\nconfigfile: pytest.ini\ntestpaths: tests\nplugins: xdist-3.4.0\ncreated: 4/4 workers\n4 workers [250 items]\n\n........................................................................ [ 28%]\n........................................................................ [ 57%]\n........................................................................ [ 86%]\n..................................                                       [100%]\n============================= 250 passed in 48.48s =============================\n"}, "verdict": "PASS"}

```

### Evidence

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence/run-150/.ultrapowers/runs/150/

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

https://github.com/popmechanic/ultrapowers/blob/ultra/plan/run-150/.ultrapowers/plan.md

### Residuals

- [ ] task 5 reviewer — unverified: the new doctrine bullet in `CLAUDE.md` and the new `## Task shape` paragraph in `skills/ultrawrite/SKILL.md` assert that a declared amendment appears as a `driver:amendment` row on the evidence branch, as an entry in the reviewer's lens, as a line on the pull request card's list, and as a count in the release census. None of those mechanisms live in this task's FILES — they are sibling-owned (task 1 `fleet/run-engine.mjs`/`fleet/roles/*`, task 2 `fleet/roles/reviewer.md`, task 3 `skills/ultrapowers/references/report-format.md`). This diff is prose only and cannot settle whether the described record actually exists. What would settle it: the siblings' exams — `fleet/tests/test_run_engine_amendments.mjs`, `fleet/tests/test_run_engine_amendment_lens.mjs`, `fleet/tests/test_sandbox_boot_amendments.mjs` and `tests/test_authoring_census*.py` — passing on the integrated tree. Not a missing dependency edge: every criterion of this task's Proof is satisfiable from these three files alone, and all six `Run:` lines show exit 0.
- [ ] task 4 reviewer — plan-defect: M3 quotes the totals format string as `totals: plans=%d risk_override=%d/%d recommended_picked=%d/%d authoring_min=%d run_min=%d amendments=%d` — i.e. without the ` runs=<lo>..<hi>` field the line actually carries at this BASE (41cb53b6, which includes 5aa9af93 "a release's census line says which runs it read"). The Context's line numbers likewise describe the tree at 5a8f1ebd, not this BASE. Taken literally, M3 would require deleting the window field that a merged commit added, contradicting the global constraint that existing shapes only gain. The implementer diverged correctly and disclosed it in the module docstring of tests/test_authoring_census_amendments.py ("M3 quotes the totals format string without the ` runs=<lo>..<hi>` field the line carries at BASE … a stale snapshot, not an instruction to drop the window"), kept the window in skills/ultrawrite/scripts/authoring_census.py:_totals_line, and pinned M3's operative words as an exact ` amendments=<n>` suffix plus an equality check after stripping one optional ` runs=…` field (tests/test_authoring_census_amendments.py, `without_window`/`TOTALS_WITHOUT_WINDOW`). The lawful consequence is that the new exam alone does not pin the window's presence
- [ ] task 4 reviewer — that is pinned by the sibling exam this task also owns — tests/test_authoring_census.py:`TOTALS` (`runs=9..133 … amendments=0`) and the inline literal in `test_d_fetch_then_prints_the_table_over_the_directory` — both green in RUN EVIDENCE, so nothing is left unverified. Fix, if any, is to the task text's M3 quote, which is outside this task's FILES.
- [ ] task 4 reviewer — tests/test_authoring_census_amendments.py:`test_e_the_sibling_exam_is_green_on_this_tree` spawns a nested `python3 -m pytest tests/test_authoring_census.py` subprocess from inside a pytest run. This is exactly what leg (e) asks for (the Proof's second `Run:` line as a leg), and it is green in EXAM EVIDENCE, so it is not a defect — but it means tests/test_authoring_census.py executes twice whenever the whole suite runs, and under `-n auto` the inner run is serial. Advisory only
- [ ] task 4 reviewer — no change required.
- [ ] task 4 reviewer — concern: plan-defect: M3 spells the totals format string as `totals: plans=%d risk_override=%d/%d recommended_picked=%d/%d authoring_min=%d run_min=%d amendments=%d`, omitting the `runs=%s` window BASE's line already carries. I kept `runs=` and appended ` amendments=%d` — M3's own sentence is "the totals line ends ` amendments=<n>`" (an ends-with), the Context says the test's TOTALS literal "gains ` amendments=0`", and dropping `runs=` would regress a record shape the run's global constraints freeze. The line now reads `totals: plans=%d runs=%s risk_override=%d/%d recommended_picked=%d/%d authoring_min=%d run_min=%d amendments=%d`. An exam asserting M3's literal as a whole-line equality rather than a suffix would read this as red
- [ ] task 4 reviewer — leg (b)'s wording ("ends ` amendments=3`") is the reading I implemented. This is a disclosure of an ambiguity I resolved, not a park.
- [ ] task 4 reviewer — concern: plan-defect: the Context's line numbers for `authoring_census.py` are one revision stale (it cites `COLUMNS` at 45, `_totals_line` at 184-201 with the format string at 198-201, `fetch_runs` at 275-312 in a 368-line file
- [ ] task 4 reviewer — BASE's file is 380 lines with `_totals_line` at 193-212 and `fetch_runs` at 286-319). Every symbol it names exists and the edits landed where it describes
- [ ] task 4 reviewer — only the offsets drifted. Disclosure, not a park.
- [ ] task 3 reviewer — unverified: the CONTRACT.md paragraph (M1) and the report-format row (M2) describe producer behavior this patch does not contain — that the engine emits one `driver:amendment` `{task, amends, what, why}` event per entry of a worker's reply's `amendments`, in the reply's own order, mirrors it on the task's hub issue, writes `report.json`'s top-level `amendments` as the same rows (`[]` when none), and draws one `judgmentCalls` line `task <id>: amendment (<amends>): <what> — <why>` per row. Those are sibling-owned (task 1: `fleet/run-engine.mjs`, `fleet/tests/test_run_engine_amendments.mjs`)
- [ ] task 3 reviewer — this diff reads the key only through a stub report, which is exactly what the task's Context says it should do, so M1/M2 are satisfied as documentation clauses and the driver's `Run:` readers (5th, 7th, 8th) confirm the prose. What would settle the described behavior is sibling task 1's engine exam green on the integrated tree. No edit inside this task's FILES answers it.
- [ ] task 3 reviewer — `fleet/sandbox-boot.sh` card row rendering: `flat()` is transcribed faithfully from `residual_read`'s helper (returning "" for a non-string), which is right for `amends`/`what`/`why`, but applying it to the id in `- task %s` means a report row whose `task` is a NUMBER (`{"task": 1, ...}`) renders `- task  — clause: …` with the id silently gone, rather than the `—` the card uses elsewhere for a cell it cannot read. The wave's shared literal and the report-format schema both pin `task` as a string, and this task consumes only a stub, so nothing here is red — but the id is the one field of the row a reader navigates by. Rendering it as `flat(row.get("task")) or EM` (or `str(...)` for a scalar) would keep the row legible if a producer ever writes an integer id.
- [ ] task 1 reviewer — Doctrine drift left outside this task's FILES: with `fleet/roles/implementer.md` and `fleet/roles/fix.md` now routing an edit TAKEN outside FILES to the reply's `amendments` (`amends: files`) instead of an `out-of-FILES:` concern, two texts this task may not touch still describe the retired prefix as live — `fleet/CONTRACT.md:686` ("as against a plain `out-of-FILES:` entry, which is an edit …") and the comment at `fleet/sandbox-boot.sh:2895` ("`out-of-FILES:` alone is an edit the task DID make"). Both paths are sibling-owned (task 3), so no edit inside this tree answers it
- [ ] task 1 reviewer — nothing breaks (`disclosure_items` matches only `out-of-FILES (not taken):`, and `fleet/tests/test_sandbox_boot_disclosures.mjs` feeds the taken prefix as canned report data, so the pytest bridge stays green). Recorded so the operator can decide whether a later plan retires the sentence.
- [ ] task 1 reviewer — Prose wrapping regression in `fleet/roles/implementer.md`: the inserted amendments sentences leave two short, ragged lines mid-paragraph — line 51 ends after "does not belong in `concerns`. Never" and line 57 ends after "You may fix a genuinely defective piece of" — where the rest of the file wraps at a consistent width. Cosmetic only (role size is reported, never gated, and the Proof's `sed`/`tr`/`grep` range test is wrap-insensitive), but rewrapping the paragraph to the file's column would keep it uniform.
- [ ] task 2 reviewer — unverified: cross-task — the Claim ("the reviewer is handed each amendment the worker declared") is established here only over a canned stub that sets `reply.amendments` directly (fleet/tests/test_run_engine_amendment_lens.mjs, `scenario`'s impl/fix branches). A live worker's reply carries that key only once sibling task 1 (popmechanic-ultrapowers#jfr7) adds `amendments` to `IMPLEMENTER_SCHEMA` in fleet/run-engine.mjs, which this patch does not touch and this sim deliberately does not depend on. Nothing in this diff is wrong for it — the task's Context licenses exactly this reading — but the end-to-end leg is not settled by this patch. What would settle it: the integration tree carrying both patches, with the schema pin in fleet/tests/test_run_engine_amendments.mjs green beside fleet/tests/test_run_engine_amendment_lens.mjs.
- [ ] task 2 reviewer — fleet/roles/reviewer.md rule 6's rewrite quietly regrades one case M3 does not name. At BASE the rule ended "A disclosed, correct divergence is lawful
- [ ] task 2 reviewer — block only if it is wrong or undisclosed" — an UNDISCLOSED divergence from plan-supplied code was blocking. The new text routes it to rule 9 ("undeclared … it is a finding there"), and rule 9 grades an undeclared divergence `minor`, so an undisclosed plan divergence drops from blocking to minor. The task authorizes rewriting rule 6, and coherence with rule 9 is the point, so this is lawful rather than scope creep
- [ ] task 2 reviewer — it is flagged because it is a doctrine change beyond M3's six rows, and because rule 9's `undeclared amendment:` clause enumerates "an edit outside FILES, a clause read otherwise or a sim re-aimed" — a plan-code divergence is not literally in that list, so "a finding there" leaves the grade of this one case to inference. If the drop to minor was not intended, rule 6 should say so in its own words (e.g. keep "block only if it is wrong" for a divergence the diff contradicts and name the undisclosed case's grade outright) rather than delegating.
- [ ] task 2 reviewer — concern: plan-defect: leg (e) is worded "a review prompt with no `AMENDMENTS` substring", which under a literal bare-substring reading conflicts with M3 and five of the Proof's own `Run:` legs — those require the word AMENDMENTS to appear in `fleet/roles/reviewer.md`, and the review prompt is `roles.reviewer + …`, so the role text always carries it. Resolved by M2, the authoritative Machine clause, which says "contains no `AMENDMENTS:`" with the colon: reviewer.md never writes AMENDMENTS immediately followed by a colon ("AMENDMENTS, when present", "an `AMENDMENTS` entry", "in AMENDMENTS,"), so a task whose replies declared none has zero `AMENDMENTS:` occurrences. I also verified the stronger form — everything the driver assembles (the prompt from `\nPATCH: ` onward, excluding the role prefix) contains no `AMENDMENTS` at all when nothing was declared. This is a disclosure of an ambiguity I resolved, not a park: the clause is satisfiable and passes.
- [ ] task 2 reviewer — concern: The declared Files list includes `Test: fleet/tests/test_run_engine_amendment_lens.mjs`, which is reserved for the peer's exam and is absent at BASE — I wrote nothing at that path, so the Proof's first `Run:` leg cannot be executed in my tree. Engine legs (a)-(e) were verified with a throwaway harness under `fleet/tests/` (canned rig, `amendmentBlock` unit assertions, green/red-then-fix/exam-concern/no-amendments runs, all passing) that was deleted before the commit
- [ ] task 2 reviewer — `git status` is clean and the diff against BASE is only `fleet/run-engine.mjs` and `fleet/roles/reviewer.md`.

</details>

Closes #990
