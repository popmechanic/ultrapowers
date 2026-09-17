The card files every reviewer leftover among a thousand nits, and its one rule for 'unverified' catches none of the 118 the reviewer itself labelled. This plan asks a calibrated classifier about each leftover as the card is written and puts the few it scores as act-now in a short section at the top, with the rule and the full list untouched below. You read ten lines instead of eighty; after five runs the record says whether you acted on them, and the rollback is deleting the section.

**Merge-ready**

> The PR card gains one section, "Act on these", listing rows at attention ≥ 2.5, capped at ten; the full list stays below it unchanged. Nothing gates on it.

| task | claim | exam | probes | mutant | suite |
|---|---|---|---|---|---|
| 1 | do: open the run's pull request; see: above the `Residuals:` line, an `Act on these` section of at most ten rows — the residuals Jev scored at attention 2.5 or higher, highest first, each with its actor, status and subject — and nothing there at all when no row scored that high; below it, the residual count, the errands, the amendments and the record's checklist exactly as they were. | red at BASE → green | — | — | — |
| 2 | do: open the contract's evidence listing and its Publish bullet, and the runbook's Traps; see: the ledger row's `jev` object and the `residuals-jev.jsonl` cache named beside `residuals.jsonl`, the card's `Act on these: <q> of <n>` section described between the task table and the `Residuals:` sentence as an experiment with its rollback, the bullet's later sentence about what may stand above the record admitting those rows, and a `TypeSafe` Traps label saying how the classifier is reached and that nothing gates on it. | none | — | — | — |

Residuals: 6 from review

Amendments: 1 from workers

- task 2 — clause: M1 — the evidence listing states the `jev` object's fields in prose (`kind.status`, `kind.subject`, `actor`, `attention`, `claim_false`, `confidence`, `model`) rather than as a JSON literal, and states the keys-sorted fact on the `residuals.jsonl` key list instead. — The Context's row shape has `jev`'s keys sorted (actor, attention, claim_false, confidence, kind, model), while M1's proof pins `kind.status` and `kind.subject` before `actor`. A JSON literal cannot be both sorted and in the proof's order, so the sortedness is asserted and the fields are enumerated in the order the exam reads.

<details><summary>Record</summary>

## fleet run-181 — gate-green

| | |
|---|---|
| verdict | `PASS` |
| target | `popmechanic/ultrapowers` at `b16dbdb1e97ab49d6d4a2958907bfd3ec7cd3194` |
| engine | `b16dbdb1e97ab49d6d4a2958907bfd3ec7cd3194` |
| plan | `.ultrapowers/plan.md` at `870f3e111eacffac24c454311a4efad5f17be68d` |
| branch | `ultra/integration-run-181` |
| vm | `fleet-r181-2609170807-f868` |

### Checks

```json
{"mode": "gate", "stamp": "run-181", "reportPath": "/home/exedev/target/.claude/ultrapowers/run-run-181/report.json", "branch": "ultra/integration-run-181", "gateCheck": {"verdict": "PASS", "checks": [{"name": "report-parse", "ok": true, "detail": ""}, {"name": "clean-tree", "ok": true, "detail": ""}, {"name": "wave-merges", "ok": true, "detail": ""}, {"name": "head-match", "ok": true, "detail": ""}, {"name": "git-verified", "ok": true, "detail": ""}, {"name": "ancestry", "ok": true, "detail": ""}, {"name": "deliverables", "ok": true, "detail": ""}], "notes": [], "repo": "/home/exedev/target"}, "gateCheckExit": 0, "suite": {"passed": true, "unattributed": [], "output": "============================= test session starts ==============================\nplatform linux -- Python 3.12.3, pytest-7.4.4, pluggy-1.4.0\nrootdir: /home/exedev/target/.claude/ultrapowers/run-run-181/clones/integration\nconfigfile: pytest.ini\ntestpaths: tests\nplugins: xdist-3.4.0\ncreated: 3/3 workers\n3 workers [439 items]\n\n........................................................................ [ 16%]\n........................................................................ [ 32%]\n........................................................................ [ 49%]\n........................................................................ [ 65%]\n........................................................................ [ 82%]\n........................................................................ [ 98%]\n.......                                                                  [100%]\n======================= 439 passed in 181.56s (0:03:01) ========================\n"}, "verdict": "PASS"}

```

### Evidence

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence/run-181/.ultrapowers/runs/181/

- approve-receipt.json
- claude-version.txt
- engine.log
- events.jsonl
- frontier
- gate-receipt.json
- kata.jsonl
- pr-body.md
- publish-fold
- receipt.json
- report.json
- residuals-jev.jsonl
- residuals.jsonl
- status.json
- transcripts

### Plan

https://github.com/popmechanic/ultrapowers/blob/ultra/plan/run-181/.ultrapowers/plan.md

### Residuals

- [ ] task 2 reviewer — unverified: the two sims the Context names as readers of the Publish bullet — `fleet/tests/test_sandbox_boot_card_cells.mjs` leg (c) and `fleet/tests/test_sandbox_boot_amendments.mjs` leg (e) — appear in no RUN/CHECK evidence for this task (the only checks run were the `fleet/roles/` diff and `test_sims_are_hermetic.mjs`). I settled them by reading the readers themselves rather than by execution: leg (c)'s reader folds `/| task | claim | exam | probes | mutant | suite |/,/Residuals: <n> from review/` and greps `mutant.*skipped-mutant-killed.*killed, reviewer skipped` — the new `Act on these` clause is inserted after `every other row reads \`killed\`;` and before `then \`Residuals: <n> from review\``, so it only widens the range and leaves the pinned order intact
- [ ] task 2 reviewer — leg (e) folds the whole Publish bullet and greps `Residuals: <n> from review.*Amendments: <n> from workers.*Amendments: none`, all three of which sit below the insertion, untouched. Running `node fleet/tests/test_sandbox_boot_card_cells.mjs` and `node fleet/tests/test_sandbox_boot_amendments.mjs` on this tree would settle it by execution.
- [ ] task 2 reviewer — unverified literal in the authority document: the new evidence-listing sentence states `claim_false` and the three `confidence` scores are "each from 0 to 1". The task's Context pins only `jev.attention` a score from 0 to 3 and gives `claim_false`/`confidence` as bare `<number>`
- [ ] task 2 reviewer — nothing in this tree pins the 0–1 range (the sibling's fixtures in `fleet/tests/test_sandbox_boot_residuals.mjs` merely happen to use probabilities like 0.05/0.88, and `fleet/sandbox-boot.sh:2430-2434` copies the model's `noul`/`confidence` through unchecked). `fleet/CONTRACT.md` is the authority for every literal, so either drop the range or cite where the TypeSafe reply schema pins it. Blocks nothing — the M1 exam does not read the range and all nine `Run:` lines are green.
- [ ] task 2 reviewer — cosmetic wrap in `fleet/CONTRACT.md`: both Publish-bullet edits leave short ragged lines mid-paragraph where the file otherwise fills to ~100 columns — `body opens with the plan's \`**Summary:**\` paragraph` (≈50 cols, after the `— the errands and the \`Act on these\` rows excepted.` insertion) and `\`Act on these\` rows, and no other reviewer` (≈45 cols, in the rewritten later sentence). Reflowing those two paragraphs would leave the same bytes to the greps — every `Run:` folds the window with `tr` first — while matching the surrounding prose.
- [ ] task 1 reviewer — `act_now` couples the `rows` argv document to the stdin checklist by POSITION — `scores[n]` for `items[n]` — and fails open when the two disagree: `jev = scores[n] if n < len(scores) else None` silently drops the tail if ROWS is short, and a ROWS longer or shifted relative to `items` would label a residual with another residual's actor/status/subject rather than erroring. The coupling is sound at BASE (both modes walk the same `items` list in `residual_read` 2448–2476, and `flat()` guarantees one checklist line per item), so this is not reachable today and the comment block documents the invariant well. But the one load-bearing assumption of the section is unasserted: a future edit to `residual_read`'s checklist rendering — an item printed on two lines, a name that does not start the line with `- [ ] ` — would mislabel rows on the card instead of dropping the section. A one-line fail-closed guard at the top of `act_now` costs nothing and makes the invariant the code's, not the comment's.

</details>

Closes #1093
