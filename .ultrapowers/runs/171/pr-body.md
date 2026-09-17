This plan puts one prover behind each claim: an exam proves its own sentence and never runs other verifications, a wave's fold runs only the tests that wave touched, and an implementer iterates against its own proofs while the whole suite runs once at publish. It exists because on the TinyApp fixture 19 of 29 exam files spawned other exams, whole packages, the linter or the typecheck from inside their legs, so one leg took 573 seconds, the fold's suite grew from 2.4 to 19 minutes over four runs (n=4 fixture runs ending at run-24, 2026-09-17), and run-24's task 2 died on an unrelated exam's nested run when a plain exam takes 1.4 seconds. After it a fold costs what the wave changed, a plan that breaks the rule is turned back on the laptop, and the record says whether workers took the sentence — the fixture's own cleanup is a separate plan.

**Merge-ready**

> do: launch a TinyApp plan whose exams each prove their own claim; see: each wave folds in the time its own exams take instead of the whole suite's, an exam that reaches for another exam, the linter or the typecheck is refused at the plan's own check before any sandbox exists, a worker that keeps re-running the whole suite is counted on the run's record, and publish still runs everything once before the pull request opens.

| task | claim | exam | probes | mutant | suite |
|---|---|---|---|---|---|
| 1 | do: write a TinyApp plan whose `Run:` line runs two exams at once, then copy the reference's Check line into a plan whose exam file reaches for `bun test`, `bun run`, `Bun.spawn`, `spawnSync` or `execSync`; see: the compiler turns the first plan back at its own check with a line that says one Run, one exam, the copied Check exits 1 on the second tree and prints the offending exam's path where a clean tree exits 0, and the authoring reference, the gotchas and the examiner's role each say the rule in one sentence. | red at BASE → green | — | — | — |
| 2 | do: launch a plan against a Bun or pytest target and watch a wave fold; see: the fold's suite is the target's runner over the sorted list of test files that wave touched or named as its exams, one log line names that command, the reconcile round re-runs the same command, publish still runs the whole suite, and a target the launcher cannot derive a scoped runner for folds exactly as it does today. | red at BASE → green | 6/6 | — | — |
| 3 | do: read the brief an implementer and a fix round are handed, then read a finished run's record; see: both briefs say to run the task's own proofs and never the project's whole suite because the fold runs it once per merge, and the record carries, for every task an implementer worked, one row counting how many times its workers ran the bare suite anyway — a reading, not a block. | red at BASE → green | 7/7 | — | — |

Residuals: 11 from review

Amendments: 2 from workers

- task 1 — clause: M2 / leg (e) say `--check` exits non-zero "with the string on stderr"; at BASE `--check` prints its entire violation list to stdout (compile_plan.py, `print("\n\n".join(violations))`). I read it additively: stdout's verdict list is byte-unchanged, and the sweep refusal is additionally echoed to stderr in the `--check` branch, following the declared-dependencies refusals a few lines above that already ride both channels. `EXAM_SWEEP_REFUSAL` names the lead-in once so the builder and the echo filter cannot drift. — Moving the violation list to stderr would change the channel for every refusal the compiler draws and break the existing edges exam's M4 leg, while leaving it on stdout alone would make leg (e) as written unsatisfiable. Echoing satisfies both readings.
- task 3 — clause: M3's "the `tool_use` blocks of the slice's `assistant` records" — `bareSuiteRunCount` treats a record or block that omits `type` as the assistant / tool_use shape it can only be, rather than skipping it. — The reduced slice `run-worker.mjs` writes always carries `type`, so this changes nothing about a real slice and every shape M3 names is counted exactly as M3 names it. The leniency exists so a hand-built exam line that leaves `type` off still counts what its command says, instead of failing on bookkeeping the clause is not about.

<details><summary>Record</summary>

## fleet run-171 — gate-green

| | |
|---|---|
| verdict | `PASS` |
| target | `popmechanic/ultrapowers` at `08bb21f56b3911dad32e4c983b435e510aee2f89` |
| engine | `08bb21f56b3911dad32e4c983b435e510aee2f89` |
| plan | `.ultrapowers/plan.md` at `8ec49179d6652c90e845e133dcfa1c80c6c4298f` |
| branch | `ultra/integration-run-171` |
| vm | `fleet-r171-2609170332-61db` |

### Checks

```json
{"mode": "gate", "stamp": "run-171", "reportPath": "/home/exedev/target/.claude/ultrapowers/run-run-171/report.json", "branch": "ultra/integration-run-171", "gateCheck": {"verdict": "PASS", "checks": [{"name": "report-parse", "ok": true, "detail": ""}, {"name": "clean-tree", "ok": true, "detail": ""}, {"name": "wave-merges", "ok": true, "detail": ""}, {"name": "head-match", "ok": true, "detail": ""}, {"name": "git-verified", "ok": true, "detail": ""}, {"name": "ancestry", "ok": true, "detail": ""}, {"name": "deliverables", "ok": true, "detail": ""}], "notes": [], "repo": "/home/exedev/target"}, "gateCheckExit": 0, "suite": {"passed": true, "unattributed": [], "output": "============================= test session starts ==============================\nplatform linux -- Python 3.12.3, pytest-7.4.4, pluggy-1.4.0\nrootdir: /home/exedev/target/.claude/ultrapowers/run-run-171/clones/integration\nconfigfile: pytest.ini\ntestpaths: tests\nplugins: xdist-3.4.0\ncreated: 3/3 workers\n3 workers [414 items]\n\n........................................................................ [ 17%]\n........................................................................ [ 34%]\n........................................................................ [ 52%]\n........................................................................ [ 69%]\n........................................................................ [ 86%]\n......................................................                   [100%]\n======================= 414 passed in 163.14s (0:02:43) ========================\n"}, "verdict": "PASS"}

```

### Evidence

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence/run-171/.ultrapowers/runs/171/

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
- residuals.jsonl
- status.json
- transcripts

### Plan

https://github.com/popmechanic/ultrapowers/blob/ultra/plan/run-171/.ultrapowers/plan.md

### Residuals

- [ ] task 3 reviewer — fleet/CONTRACT.md line 210 says `driver:suite-runs` is "one row per task an implementer worked", but the engine writes the row at a single site (fleet/run-engine.mjs:4090) that only tasks reaching a reviewer pass: a task that parks `proof-red`, loses coordinates, ends `blocked-after-fix`, or is re-edged onto a sibling had an implementer work it and leaves no row. The following sentence (lines 222–223) states the real site correctly, so the two sentences together are only mildly inconsistent — but the opening clause overstates coverage in the file that is the record. This is the placement Task 3's own Context authorizes ("one `appendEvent(...)` on the path that leads to the reviewer, written once"), so the fix is the contract wording, not the call site.
- [ ] task 3 reviewer — fleet/run-engine.mjs:1006-1008 (the comment above `SUITE_SEGMENT_SPLIT`) states that "splitting on single `|` as well means `||` yields an empty middle segment, which no runner matches". That is not what the regex does: `/&&|\|\||;|\|/` tries `\|\|` before `\|`, so `bun test || true` splits into exactly two segments and no empty middle segment is ever produced. The behaviour is right (the exam's `bun test || true` leg counts 1)
- [ ] task 3 reviewer — only the explanation is wrong, and in this codebase the comment is load-bearing for the next reader.
- [ ] task 3 reviewer — concern: plan-defect: leg (e) asserts the task's report row is `merged` "exactly as the sim's existing scenario is", but `report.json`'s `tasks[].status` is never the string `merged` anywhere in fleet/run-engine.mjs — the successful terminal status is `done` with `reviewVerdict` `clean` (the engine's only `merged` is the wave fold's `MERGED` disposition, a different field, and no sim under fleet/tests/ asserts `'merged'`). I read the leg under its own qualifier — the row is whatever the sim's existing scenario produces — and verified out-of-tree that the leg (e) scenario yields labels [impl:T1, fix:T1:0, review:T1:1], one `driver:suite-runs` row {task:'T1', count:3, slices:2} positioned after both `transcript:slice` rows and before the reviewer, and a row of {status:'done', reviewVerdict:'clean'}. Flagging it so a peer exam that asserts the literal string `merged` is read as an exam-side wording slip rather than a missing implementation.
- [ ] task 2 reviewer — Table O of `fleet/tests/test_run_engine_reconcile_retry.mjs` pins M7 with two hard-coded sha256 digests of `fleet/publish-fold.mjs` and `skills/ultrapowers/scripts/ultra_gate.py`, plus an exact source-text match (`publish.includes("const suite = await exec('bash', ['-lc', testCmd], { cwd: integ })")`). M7 is a run-scoped property ("byte-identical to BASE"), and the Proof already pays for it with the `git diff --quiet $ULTRA_BASE` and `! grep -q foldTestCmd` Run: lines, both of which the driver ran green. Frozen into a permanent sim, these byte pins will red the whole reconcile-retry file the first time anyone legitimately edits either file for a reason unrelated to this claim — a false red in a sim that otherwise tests the fold. The `BASE_SHA` fallback literal `08bb21f5...` has the same shelf life. Suggested: keep the behavioural assertions (neither file names `foldTestCmd`/`foldTestPattern`/`foldSuiteCommand`
- [ ] task 2 reviewer — publish still runs its `testCmd`, matched loosely) and the conditional `git diff --quiet $ULTRA_BASE` leg, and drop the two sha256 equality assertions and the exact-source-line `includes`.
- [ ] task 2 reviewer — `tests/test_ultra_run_fold_test_cmd.py::test_leg_c_covers_every_rule_detect_test_cmd_can_return` documents itself as closing leg (c) over the detection ladder — "a rung added without a derivation decision cannot slip past this exam" — but the ladder is a hard-coded literal set inside the test. A rung added to `detect_test_cmd` (which now returns the nine names at `skills/ultrapowers/scripts/ultra_run.py` 62–91) would not appear in that set and would slip past, so the docstring states a guarantee the test does not provide. Either derive the set from the source (e.g. `re.findall(r'return [^,]+, "([a-z0-9-]+)"', RUN.read_text())` restricted to the `detect_test_cmd` body) and assert it equals the literal set, or soften the docstring to say the set is a hand-maintained mirror.
- [ ] task 2 reviewer — In `fleet/run-engine.mjs`, `if (foldCmd !== testCmd) log('wave ' + waveNumber + ' fold suite: ' + foldCmd)` is emitted unconditionally, one line above `let suite = bootstrapRed || await sh(foldCmd, integ)`. On the #825 bootstrap-red path the suite never runs, so the record carries `wave <n> fold suite: <command>` for a command this fold did not execute — the same reading confusion the comment directly below it ("quotes the install and none of them quotes a suite that never ran on this candidate") exists to prevent. It is defensible, since the reconcile prompt's `TEST COMMAND:` line does carry `foldCmd` on that path, and M4 states the log unconditionally
- [ ] task 2 reviewer — flagging it so the operator can decide. If it should be tightened, guard the log with `if (!bootstrapRed && foldCmd !== testCmd)`.
- [ ] task 2 reviewer — unverified: the Claim is end-to-end ("launch a plan against a Bun or pytest target and watch a wave fold"), but the diff pins the two halves separately and never the seam between them. The pytest exam asserts `foldTestCmd`/`foldTestPattern` land in `.claude/ultrapowers/run-<stamp>/args.json`
- [ ] task 2 reviewer — the mjs exam injects them through `rig`'s `extraArgs`, which `fleet/tests/_engine_helpers.mjs` (line 113) spreads straight into `runEngine({args})` — the args file and `run-main.mjs`'s `...argsObj` spread are bypassed. Nothing in this patch asserts that the key an args file carries reaches `args.foldTestCmd`. The risk is low, since both exams independently pin the same literal key names and the spread is unchanged BASE behaviour, but what would settle it is one leg that writes an args file carrying the two keys and drives it through `run-main.mjs`, or a named existing sim that already covers the `...argsObj` spread for an arbitrary key.

</details>

