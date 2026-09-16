This stops paying a reviewer to re-read a task whose own state exam already proved it would catch a wrong answer: when the planted fault was caught, the driver's proofs and checks still gate the task, the fold and the pre-merge gate still run, only the reviewer's second reading is skipped, and the two sentences that told the examiner and the reviewer to hunt for hollow exams by hand come out of the role files, since the planted fault is that hunt. It is an experiment at n=0, recorded on #836: the reviewer was 12 to 20 percent of judging spend on the last three fixture runs, and this is the one lever that spend can move without touching what gates a merge. It is read as escapes and judging share over the next three TinyApp runs against the 63/59/65 percent judging baseline of runs 13, 12 and 16, and the rollback is one switch, reviewOnStateExams back to on, which restores the reviewer on every task.

**Merge-ready**

> A task whose state exam killed its mutant gets no reviewer, and the role files say so.

| task | claim | exam | probes | mutant | suite |
|---|---|---|---|---|---|
| 1 | A task whose state exam killed its mutant gets no reviewer, and one switch brings the reviewer back on every task. | red at BASE → green | 7/7 | — | — |
| 2 | The role files no longer tell the examiner and the reviewer to hunt for a hollow exam by hand, because the planted fault is that hunt. | none | — | — | — |
| 3 | When I open the run's pull request, the task table's mutant cell tells me a task's reviewer was skipped because its mutant was killed. | red at BASE → green | 4/4 | — | — |

Residuals: 5 from review

Amendments: 2 from workers

- task 1 — files: fleet/tests/test_run_engine_review_economy.mjs — left byte-identical to BASE; I wrote none of the legs (a)–(d) the task's Context describes into it — it is the path the Proof's `Test:` line names, so it is reserved for the peer's exam and the driver lays that file over it after I return. I verified M1–M4 against a scratch copy of those legs written and run outside the working tree (importing fleet/tests/_engine_helpers.mjs by absolute path) and deleted it; all four legs pass, including the `extraArgs: { reviewOnStateExams: false }` half of (a), the `STATE EXAM:` prompt assertions of (b), the three records of (c) and both halves of (d).
- task 1 — files: fleet/run-engine.mjs — the review prompt now renders `stateExamBlock(stateExamRows)`, reusing the rows the skip predicate reads a few lines above, rather than calling `stateExamRowsOf(runDirAbs, task.id)` a second time — the two reads are at the same point in the task's life (both after the pre-review repair round's own exam pass, nothing writes the record between them), so the value is identical and the record is read once per task; the comment above the call was reworded to say the rows are read in the round rather than at the pre-review pass. `stateExamBlock`'s own behaviour is unchanged — test_run_engine_state_exams.mjs passes.

<details><summary>Record</summary>

## fleet run-156 — gate-green

| | |
|---|---|
| verdict | `PASS` |
| target | `popmechanic/ultrapowers` at `901fc874923210207e041f947407b8ea519c1ab2` |
| engine | `901fc874923210207e041f947407b8ea519c1ab2` |
| plan | `.ultrapowers/plan.md` at `462543e1954e8395b56e5677315c6ba65d6d3aa2` |
| branch | `ultra/integration-run-156` |
| vm | `fleet-r156-2609160556-3ada` |

### Checks

```json
{"mode": "gate", "stamp": "run-156", "reportPath": "/home/exedev/target/.claude/ultrapowers/run-run-156/report.json", "branch": "ultra/integration-run-156", "gateCheck": {"verdict": "PASS", "checks": [{"name": "report-parse", "ok": true, "detail": ""}, {"name": "clean-tree", "ok": true, "detail": ""}, {"name": "wave-merges", "ok": true, "detail": ""}, {"name": "head-match", "ok": true, "detail": ""}, {"name": "git-verified", "ok": true, "detail": ""}, {"name": "ancestry", "ok": true, "detail": ""}, {"name": "deliverables", "ok": true, "detail": ""}], "notes": [], "repo": "/home/exedev/target"}, "gateCheckExit": 0, "suite": {"passed": true, "unattributed": [], "output": "============================= test session starts ==============================\nplatform linux -- Python 3.12.3, pytest-7.4.4, pluggy-1.4.0\nrootdir: /home/exedev/target/.claude/ultrapowers/run-run-156/clones/integration\nconfigfile: pytest.ini\ntestpaths: tests\nplugins: xdist-3.4.0\ncreated: 3/3 workers\n3 workers [278 items]\n\n........................................................................ [ 25%]\n........................................................................ [ 51%]\n........................................................................ [ 77%]\n..............................................................           [100%]\n======================== 278 passed in 84.38s (0:01:24) ========================\n"}, "verdict": "PASS"}

```

### Evidence

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence/run-156/.ultrapowers/runs/156/

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

https://github.com/popmechanic/ultrapowers/blob/ultra/plan/run-156/.ultrapowers/plan.md

### Residuals

- [ ] task 2 reviewer — Stale cross-reference left behind by this (lawful) deletion, in a file this task may not touch: `fleet/run-engine.mjs:540-546` comments that a killed mutant is "exactly what duty 5 asks a reviewer to establish by hand" — the duty-5 sentence that asked for that hunt (`A test that still passes with the behavior it names deleted is a finding…`) is precisely what this diff removes from `fleet/roles/reviewer.md:24-27`. The emitted `STATE EXAM:` prompt text at lines 550-552 still reads sensibly against the shortened rule 5, and `fleet/tests/test_run_engine_state_exams.mjs:342` only pins the string `duty 5`, so nothing breaks
- [ ] task 2 reviewer — only the comment's rationale is now false. `fleet/run-engine.mjs` is a SIBLING FILES path (task 1, popmechanic-ultrapowers#xhw3), so the fix lies outside this task's FILES and must not be made here — actor `plan`. Suggested wording for whoever owns that file: say the block settles duty 5's exam-file question because the driver's mutant is the hollow-exam check, without claiming the role file still asks a reviewer to perform it.
- [ ] task 3 reviewer — unverified: the card's new branch keys on the literal `skipped-mutant-killed`, but nothing in this diff ties that literal to the producer of it — Task 1's engine (`tasks[].reviewVerdict`). Every fixture in `fleet/tests/test_sandbox_boot_card_cells.mjs` is a `replace` over the rig's `DEFAULT_REPORT` written by the sim, so a divergence in spelling between `fleet/run-engine.mjs`'s verdict string and `fleet/sandbox-boot.sh`'s comparison would leave both tasks' exams green while every real card renders `killed`. The task text itself scopes this out ("this task never needs that engine — the card reads a `report.json` the sim writes"), so the fix does not lie inside this task's FILES. What would settle it: a post-merge grep that the two literals agree (e.g. the integrated suite asserting `grep -c 'skipped-mutant-killed'` is non-zero in both `fleet/run-engine.mjs` and `fleet/sandbox-boot.sh`), or one end-to-end leg in a later task reading a card rendered from an engine-written report.
- [ ] task 1 reviewer — unverified: `fleet/CONTRACT.md` is declared by this task's own Files block (`Modify: fleet/CONTRACT.md`) and appears in the FILES header, but it is ALSO listed under SIBLING FILES for task 3 (popmechanic-ultrapowers#khj1) and in this task's own factsheet `siblingOwned`. The diff's CONTRACT hunk is therefore authorized by the task text — it is not an out-of-scope edit and it is required by M5 and by the Proof's `sed`/`grep` over the Exam environment bullet — but two concurrently-dispatched tasks own the same file. This patch alone cannot settle whether task 3's hunk lands in or near the `- **Exam environment:**` bullet (line 189 region). What would settle it: the wave's fold plus a re-run of `sed -n '/^- \*\*Exam environment:\*\*/,/^- \*\*Launch order/p' fleet/CONTRACT.md | tr '\n' ' ' | grep -q 'reviewOnStateExams.*off.*true.*skipped-mutant-killed'` on the integrated tree (the integrated `Run:` re-execution, #887, already does this). Raised for the operator's attention, not against this diff.
- [ ] task 1 reviewer — The skip predicate the Context specifies (and which fleet/run-engine.mjs implements faithfully at the `// ── the reviewer a killed mutant buys nothing from (#836)` block) does not consider `examEdited`. A reachable path: the pre-review pass goes red, the one `fix:<id>:0` round edits an exam path to turn it green, the repeat pass is green, the state-exam record reads every mutant killed — and the round is skipped, so nobody applies reviewer.md rule 8 to the `EXAM EDITED DIFF` hunks. That is the one lens loss the task's Context does not enumerate (it names Global Constraints, Interfaces, code quality and amendments). It is not a divergence from the plan — the diff does exactly what M1 and the Context spell — and the driver still records the paths under `tasks[].examEdited` plus a matching `judgmentCalls` entry, so a loosened exam is visible at the gate rather than invisible. If the operator wants it closed rather than recorded, the fix is one more conjunct in the same predicate — e.g. `(examEdited === null || examEdited.length === 0)` beside `examConcerns.length === 0` — but that is a change to the plan's Machine clause M1, not something this submission should carry unasked.

</details>

