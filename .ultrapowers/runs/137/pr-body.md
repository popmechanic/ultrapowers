This makes the compiler read each task's Stale-if lines against the base a run launches on, so a task the world has already moved past is refused on the laptop before any sandbox is paid for. It exists because the five predicates every plan carries have been parsed and then ignored by everything since the grammar landed. After this run, launching a plan whose task is stale prints the predicate that holds and stops, and an issue predicate the laptop cannot read is printed as a note on the launch line rather than blocking the launch.

**Merge-ready**

> A stale task should be refused or skipped with a judgment call, not built.

| task | claim | exam | probes | mutant | suite |
|---|---|---|---|---|---|
| 1 | When I compile a plan at a base with `--check --base`, a task whose Stale-if predicate is already true at that base is refused, and the line I read names the task and the predicate that holds; an issue predicate the machine cannot read is a note after the verdict, not a refusal. | red at BASE → green | — | — | — |
| 2 | When I launch a plan and the compiler notes a Stale-if predicate it could not read, that note is printed on my launch line beside the base facts, and a predicate that holds still refuses the launch on the laptop with the compiler's own line. | red at BASE → green | — | — | — |

Residuals: 5 from review

<details><summary>Record</summary>

## fleet run-137 — gate-green

| | |
|---|---|
| verdict | `PASS` |
| target | `popmechanic/ultrapowers` at `a94143bb79f780a63e41e751418b9a3d3a9d2db2` |
| engine | `a94143bb79f780a63e41e751418b9a3d3a9d2db2` |
| plan | `.ultrapowers/plan.md` at `9886c381d8af32d8f900878ccf439d045a3bb4a2` |
| branch | `ultra/integration-run-137` |
| vm | `fleet-r137-2609150924-0e55` |

### Checks

```json
{"mode": "gate", "stamp": "run-137", "reportPath": "/home/exedev/target/.claude/ultrapowers/run-run-137/report.json", "branch": "ultra/integration-run-137", "gateCheck": {"verdict": "PASS", "checks": [{"name": "report-parse", "ok": true, "detail": ""}, {"name": "clean-tree", "ok": true, "detail": ""}, {"name": "wave-merges", "ok": true, "detail": ""}, {"name": "head-match", "ok": true, "detail": ""}, {"name": "git-verified", "ok": true, "detail": ""}, {"name": "ancestry", "ok": true, "detail": ""}, {"name": "deliverables", "ok": true, "detail": ""}], "notes": [], "repo": "/home/exedev/target"}, "gateCheckExit": 0, "suite": {"passed": true, "unattributed": [], "output": "============================= test session starts ==============================\nplatform linux -- Python 3.12.3, pytest-7.4.4, pluggy-1.4.0\nrootdir: /home/exedev/target/.claude/ultrapowers/run-run-137/clones/integration\nconfigfile: pytest.ini\ntestpaths: tests\nplugins: xdist-3.4.0\ncreated: 3/3 workers\n3 workers [173 items]\n\n........................................................................ [ 41%]\n........................................................................ [ 83%]\n.............................                                            [100%]\n============================= 173 passed in 39.53s =============================\n"}, "verdict": "PASS"}

```

### Evidence

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence/run-137/.ultrapowers/runs/137/

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

https://github.com/popmechanic/ultrapowers/blob/ultra/plan/run-137/.ultrapowers/plan.md

### Residuals

- [ ] task 2 reviewer — Cosmetic prose wrap in CLAUDE.md: the edit to the `fleet/` Layout bullet leaves an orphan line `  reads the pool from` (21 chars) in a paragraph otherwise hard-wrapped to ~95 columns. The content is correct and both Proof `Run:` greps and exam leg (d) still pass after a reflow
- [ ] task 2 reviewer — this is purely the fill. Nothing else in the diff is affected.
- [ ] task 2 reviewer — unverified: the Claim's first half — "when the compiler notes a Stale-if predicate it could not read, that note is printed on my launch line" — is settled by this diff only through a hand-written `exec` seam (fleet/tests/test_launch_compile_facts.mjs `fakeExec`). That `compile_plan.py --check --base` actually emits `STALE fact: task <id>: <entry> unreadable at BASE — <reason>` on a clean compile (and the `… holds at BASE` line on exit 2) is sibling task 1's surface (skills/ultrapowers/scripts/compile_plan.py), absent at BASE. This is the correct seam for this task — Interfaces declares Consumes: none and depends_on is empty, so this is not a missing dependency edge — but the end-to-end sentence the new fleet/RUNBOOK.md §Per run paragraph now asserts to the operator (including the two literal line shapes) is only true once task 1 lands. What would settle it: a run of the real compiler against a plan carrying a Stale-if entry unreadable at `--base`, checking the launcher's printed launch line carries the compiler's line verbatim.
- [ ] task 1 reviewer — Double evaluation: `evaluate_stale_if` is invoked twice per compile — once inside `collect_violations` (`...[0]`, skills/ultrapowers/scripts/compile_plan.py, inside the existing `if base_tree is not None:` block) and again in `main()`'s `--check` branch (`...[1]`, after `base_fact_lines`). The task's Context asks for "one call to `evaluate_stale_if` per compile, whichever function owns it". The divergence is disclosed in both code comments and it is not wrong — the two calls select disjoint halves of the return, so no line is printed twice, and M4's once-per-issue-number property survives because `_ISSUE_STATE_CACHE` is process-global (test_d_gh_is_run_once_per_issue_number_however_many_tasks_name_it pins it, so a regression would be caught). The cost is that every `path-exists`/`path-absent`/`sha-matches` predicate re-runs its `git ls-tree`/`hash-object` read a second time, and M4's guarantee now rests on a module-level cache rather than on structure. If you want it structural, have `main()` compute `evaluate_stale_if` once against the tasks it already parses and pass the refusals down, or memoize the pair on the `BaseTree`.
- [ ] task 1 reviewer — `_STALE_ENTRY_RE` (skills/ultrapowers/scripts/compile_plan.py, new Stale-if block) is looser than the parser's `STALE_PREDICATE_RE` at line 241: it accepts `\s*:\s*` where the grammar accepts only `:`. So an entry written `path-absent : \`missing.py\`` is refused once by the grammar ("Stale-if entry is not a predicate") and, if the predicate holds, refused a second time as a `STALE fact:` line — two violations for one malformed line. Nothing in the Machine clauses pins this either way and no leg exercises it, but matching the parser's own regex (or reusing `STALE_PREDICATE_RE` to gate the entry before splitting the head) would keep the evaluator from speaking about lines the grammar has already rejected.

</details>

Closes #538
