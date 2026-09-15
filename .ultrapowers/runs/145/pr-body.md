This is the authoring side of the factory's cost, put on the same record as the run's. It exists because the three plans of 2026-09-14 ran in 16, 30 and 108 sandbox minutes but each took about two hours of session to author, every one was sent to the fleet by the risk override, and the recommended option was picked nine times of nine — none of which the record could show. After this run each plan's gate record carries its authoring minutes, hub probes, gate tally, routing branch and every question with its pick, one script reads a release's runs into one table, and ultrawrite says honestly that a Claim is drafted by the author and confirmed by you.

**Merge-ready**

> After a sitting, every plan's record says what authoring it cost and which option I picked on every question I was asked, and a release reads those beside its runs' clocks — so the risk override's share and the Recommended-pick rate are numbers I can see, not impressions.

| task | claim | exam | probes | mutant | suite |
|---|---|---|---|---|---|
| 1 | When I compile a plan whose record carries its authoring cost, the compile tells me that cost in one line; a malformed record is refused, and a plan with no such record compiles exactly as before. | red at BASE → green | — | — | — |
| 2 | At a release I run one command over the runs it bundles and see, per plan, what authoring cost beside what the run cost, and at the bottom how many plans the risk override sent to the fleet and how often the recommended option was picked. | red at BASE → green | — | — | — |
| 3 | When I read how a plan's Claim comes to be, the skill and the project's own instructions say what actually happens — the author drafts it and I confirm it in one touch — and they tell the author to write down every question I was asked and what I picked, so a recommendation I take every time is retired as a rule. | none | — | — | — |
| 4 | When I launch a plan, the launch line tells me what authoring it cost, among the fact lines that end it, without my opening the record. | red at BASE → green | — | — | — |

Residuals: 9 from review

<details><summary>Record</summary>

## fleet run-145 — gate-green

| | |
|---|---|
| verdict | `PASS` |
| target | `popmechanic/ultrapowers` at `e0526443db3ea88a6e91d39f89234e295d1b1fa5` |
| engine | `e0526443db3ea88a6e91d39f89234e295d1b1fa5` |
| plan | `.ultrapowers/plan.md` at `daf80d786d82dec73f1314eb7be8d700bdb0e989` |
| branch | `ultra/integration-run-145` |
| vm | `fleet-r145-2609151651-b3b3` |

### Checks

```json
{"mode": "gate", "stamp": "run-145", "reportPath": "/home/exedev/target/.claude/ultrapowers/run-run-145/report.json", "branch": "ultra/integration-run-145", "gateCheck": {"verdict": "PASS", "checks": [{"name": "report-parse", "ok": true, "detail": ""}, {"name": "clean-tree", "ok": true, "detail": ""}, {"name": "wave-merges", "ok": true, "detail": ""}, {"name": "head-match", "ok": true, "detail": ""}, {"name": "git-verified", "ok": true, "detail": ""}, {"name": "ancestry", "ok": true, "detail": ""}, {"name": "deliverables", "ok": true, "detail": ""}], "notes": [], "repo": "/home/exedev/target"}, "gateCheckExit": 0, "suite": {"passed": true, "unattributed": [], "output": "============================= test session starts ==============================\nplatform linux -- Python 3.12.3, pytest-7.4.4, pluggy-1.4.0\nrootdir: /home/exedev/target/.claude/ultrapowers/run-run-145/clones/integration\nconfigfile: pytest.ini\ntestpaths: tests\nplugins: xdist-3.4.0\ncreated: 4/4 workers\n4 workers [209 items]\n\n........................................................................ [ 34%]\n........................................................................ [ 68%]\n.................................................................        [100%]\n============================= 209 passed in 44.20s =============================\n"}, "verdict": "PASS"}

```

### Evidence

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence/run-145/.ultrapowers/runs/145/

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

https://github.com/popmechanic/ultrapowers/blob/ultra/plan/run-145/.ultrapowers/plan.md

### Residuals

- [ ] task 4 reviewer — unverified: the end-to-end Claim ("the launch line tells me what authoring it cost") depends on the compiler actually emitting an `AUTHORING fact:` line under `--check --base`, which is sibling task 1's work (skills/ultrapowers/scripts/compile_plan.py). This patch settles only the launcher half: legs (a)-(c) drive `verifyPlanCompiles`/`renderLaunch` through this file's own `fakeExec`, so they prove the passthrough carries whatever the compiler prints, not that the compiler prints it. The literal used in the exam (`AUTHORING fact: 118 min to PLAN OK, 12 hub probes, 4 gate dispatches, 1 rejected, routing risk->ultrapowers, 1 questions, 1/1 recommended picked`) and in the RUNBOOK sentence both match the Context's shared literal byte for byte, so the halves agree on paper. What would settle it: an integration run of `node fleet/launch.mjs` (or a compile of a plan whose record carries `authoring`) against the merged tree, after task 1 lands. Grading minor because no edit inside this task's FILES can establish it.
- [ ] task 3 reviewer — unverified: cross-task reference. Both edited documents now name a file that does not exist at BASE and is created by sibling task 2 (`skills/ultrawrite/scripts/authoring_census.py`): CLAUDE.md's `skills/ultrawrite/` Layout bullet ("`scripts/authoring_census.py` (`--fetch` a run range, `totals:` for the release notes)") and SKILL.md's proof-gate paragraph ("`python3 $UW/authoring_census.py --fetch <owner>/<repo> --runs <A>..<B> --into <dir>`"). This task's Context explicitly authorizes naming it, and no exam in this task or in the tree pins the path's existence, so nothing here blocks
- [ ] task 3 reviewer — the prose becomes accurate only once task 2 lands in the same fold. What would settle it: the merged tree carrying `skills/ultrawrite/scripts/authoring_census.py` with a `--fetch`/`--runs`/`--into` interface and a `totals:` last line, as task 2's M1/M3 specify. Note the invocation form differs between the two documents ($UW-relative in SKILL.md, repo-relative in CLAUDE.md)
- [ ] task 3 reviewer — that is the local idiom of each file — `UW=${CLAUDE_PLUGIN_ROOT}/skills/ultrawrite/scripts` is defined ten lines above in the same SKILL.md section, beside the existing `$UW/extract_gate_input.py` and `$UW/check_provenance.py` invocations — and is not a defect.
- [ ] task 2 reviewer — Silent skips in `skills/ultrawrite/scripts/authoring_census.py`. `_load_json` (lines 68-81 of the new file) maps an unreadable/malformed `gate-verdicts.json` onto `None`, and `census_rows` then drops the directory entirely (`if not isinstance(record, dict): continue`). M1 says "one tab-separated row per `run-<N>` directory that holds a `gate-verdicts.json`"
- [ ] task 2 reviewer — a directory holding a corrupt record does hold one, so that run vanishes from the table and from the headline `plans=<rows>` count with nothing printed anywhere. The same shape recurs in `render_register`, which `continue`s past a question whose `options` is not a list. No exam leg exercises either case, and the RUN/EXAM evidence is green, so this blocks nothing — but a census whose job is to count a release should say what it could not read. Suggested fix, inside this task's own FILES: in `census_rows`, when `(entry / RECORD_NAME).exists()` but the parse failed, print one line to stderr naming the run (e.g. `census: run %d has an unreadable gate record — skipped`) before the `continue`, mirroring the stderr line `fetch_runs` already prints for a skipped run.
- [ ] task 2 reviewer — `_run_minutes` (authoring_census.py lines 89-103) returns `int((b - a).total_seconds() // 60)` with no floor at zero, so a `status.json` whose `updatedAt` precedes `startedAt` (clock skew across VMs, or a hand-edited fixture) yields a negative `run_min` that then feeds `_sum(rows, "run_min")` in the totals line. M1 only defines the column for a forward-running pair, so this is unpinned by the exam rather than wrong
- [ ] task 2 reviewer — a `max(0, ...)` — or treating a negative span as unparseable and returning `None` so the column reads `-` — would keep the release total honest.
- [ ] task 1 reviewer — Code quality (duplicated read path, not a behaviour defect): `_authoring_tally` in `skills/ultrapowers/scripts/compile_plan.py` (~line 1122) re-implements the read/parse/`isinstance(record, dict)` logic of `_authoring_object` just above it, and `authoring_fact_line` ends up parsing `<stem>.gate-verdicts.json` three times for one line — once via its own `_authoring_object`, once more inside the `authoring_record_violations(plan_path)` guard, and a third time via `_authoring_tally`. One private `_verdict_record(plan_path) -> dict | None` that does the exists/`json.loads`/dict check once, with `_authoring_object` and `_authoring_tally` both reading its result (and `authoring_fact_line` passing the already-computed violations rather than recomputing them), would remove the copy and the redundant I/O without changing a single observable line. Nothing in the exam is affected — the behaviour is correct as written and settled by EXAM EVIDENCE (15 passed, exit 0).

</details>

Closes #988
Closes #991
