# The factory stops doing work that cannot matter, and its record says when and how long

**Grammar:** claims-v1

**Claim:** do: run a plan on the factory and read its record afterwards; see: no worker was sent to do work that could not matter — no examiner for a task with no exam, no second attempt for a landing whose exam had passed — every row says when it happened and each worker's row says how long it took, a test a worker ran and failed reads as failed, the few tests a patch touches are actually put to Jev, and a run that finished has its issue on the hub closed, so its sandbox is reaped without anyone looking. (elicited)
**Summary:** This is a cleanup of the factory from what its first day of runs measured. It exists because the factory sent an examiner to a task with nothing to examine and a second implementer to two landings whose exams had already passed (run-193, n=1 run, 7 tasks), because the record could say how long a task took but not which worker took it, and because every finished sandbox had to be removed by hand. You get shorter and cheaper runs, a record that can answer why a run was slow, and sandboxes that clean up after themselves.

**Goal:** Six small tasks carrying seven repairs, each read off a run's own record on 2026-09-18, none a new capability. The re-attempt floor fired on a green exam on run-193 tasks 2 and 6 and run-194 task 7 and changed nothing (n=3 firings over 2 runs); the operator's rule, picked 2026-09-18: a green exam settles it, and a clause proven only by `Run:` commands never counts. An examiner was dispatched to a prose task with no exam file on runs 192, 193 and 194 (26 tool calls on run-193's). Rows carry no time, so run-193's 54 minutes could be read per task and not per role. 49 of run-193's 56 worker test-run rows masked their exit behind a pipe or an echo, so `red` read false on examiners' runs that were red by construction — the exit cannot be read from the stream, so it comes from a tool the engine runs. Landing test selection has never reached Jev on this repository: on all 8 of run-194's tasks the state was 156,442 to 420,841 bytes against the client's 120,000-byte budget, because every candidate test's whole file was sent. And every finished factory sandbox (runs 191–194) was removed by hand because the boot never closes the hub's run issue; the close follows the old boot's rule (#937, #964): on `done` only. This is the first run with the board live and with the five full-width switches on; this plan writes no ordering, and five of its six tasks edit `factory/engine.mjs` at once. Nothing under the old engine moves.
**Closes:** #1150 #1151 #1152 #1153

**Tech Stack:** Node 24 ESM for the engine, the tools and the finder, with no new npm dependency; Python 3 standard library for the parser; bash for the boot; the Claude Agent SDK's in-process MCP server as `factory/tools.mjs` already uses it.
Spec: `docs/superpowers/specs/2026-09-17-jev-factory.md` §The loop, and map #1131 with #1150–#1153 on the target — laptop only; what a worker needs is in its Context.

## Global Constraints

- Nothing here adds a judgment: every change is code deciding a fact — a file's absence, an exit code, a timestamp, a byte count — or code withholding a question Jev cannot answer.
- A repair is never the run's failure: a refused hub close, a tool that cannot run, an excerpt that finds no line — each is one row or one log line, and the run proceeds as it would have.
- Models never run git; the engine's own `child_process` runs every command a tool offers.
- Check: git diff --quiet $ULTRA_BASE -- ':(glob)fleet/run-*.mjs' fleet/sandbox-boot.sh fleet/fleet-bootstrap.sh fleet/roles fleet/kata-client.mjs fleet/launch.mjs skills/ultrapowers/kernel skills/ultrapowers/scripts/compile_plan.py

### Task 1: A task with no exam file gets no examiner

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `factory/engine.mjs`
- Test: `fleet/tests/test_factory_exam_skip.mjs`

**Claim:** A task that names no exam file is not sent an examiner: its implementer starts without one, and the record says the exam was skipped and why. (derived)
Machine: M1. For a task whose `proofTests` is empty, `examine` dispatches no worker, posts no `exam-note`, asks no covering reading, appends exactly one `{ kind: 'exam:skipped', task, reason: 'no exam file' }` row, and resolves the same shape it resolves for any task, with `examFiles` `[]` and `taskCovering` `[]`. M2. That task's implementers are dispatched and its landing is measured and adopted as for any other task. M3. A task whose `proofTests` is non-empty is examined exactly as before.

**Authorized-by:** #1152; run-193's record (task 6's examiner: 26 tool calls, nothing written; n=3 prose tasks over runs 192–194)

**Interfaces:**
- Consumes: none
- Produces: nothing

**Context:** `factory/engine.mjs` has `examine(task, anchor)`: it clones the anchor as `exam-<id>`, builds the worker's tool server, runs the covering selection when `policy.select.enabled`, dispatches the exam worker (`role: 'exam'`, `label: 'exam:' + task.id`), posts the examiner's final text to the board as `exam-note`, reads the exam files back, and resolves `{ examDir, mcpServers, taskCovering, examFiles }`. `land(task, anchor)` awaits that result — from `examPromises` when `policy.speculate.exam_at_zero` is true, else by calling `examine` itself — and hands `examFiles` to each implementer's clone. A task with no `- Test:` path has `proofTests` `[]` and `testCmd` `null`; its landing is read by Jev alone, and that stays. The tool server is still built for such a task, because its implementers use it. Keep the edit inside `examine`: four sibling tasks are editing this file at the same moment — the re-attempt decision in `land`, `appendEvent` and `dispatch`, the tool server's construction, and the landing selection. The exam is the fake-driven rig of `fleet/tests/_engine_helpers.mjs` (`makeRepo`, a fake `worker` recording its dispatch labels, a fake `judge`, a fake `sh`, a fake board recording `post`), a policy copy handed in as `args.policy` whose `pairs.mode` is `off` and whose `fold.reverify.enabled` and `select.enabled` are false, on a plan fixture with one prose task and one task that names an exam file; it prints `ALL TESTS PASSED` as its last line when every assertion held.

**Proof:**
- Test: `fleet/tests/test_factory_exam_skip.mjs`
- Legs: (a) on the fixture, no dispatch label is `exam:1` for the prose task 1, the fake board recorded no `exam-note` post for task 1, the fake judge's `readCovering` was not called for task 1, and `events.jsonl` carries exactly one row `{ kind: 'exam:skipped', task: '1', reason: 'no exam file' }` [M1]; (b) the labels contain `impl:1:0`, `events.jsonl` carries a `landing` row for task 1, and the run resolves `done` true with task 1 in `adopted` [M2]; (c) the labels contain `exam:2` before `impl:2:0`, the board recorded an `exam-note` post for task 2, and there is no `exam:skipped` row for task 2 [M3].

**Stale-if:**
- path-absent: `factory/engine.mjs`

### Task 2: A green exam settles it — the re-attempt floor reads only what Jev can see

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `skills/ultrapowers/scripts/plan_parse.py`
- Modify: `factory/engine.mjs`
- Test: `tests/test_plan_parse.py`
- Test: `fleet/tests/test_factory_floor.mjs`

**Claim:** A landing whose own exam ran and passed is never sent back for a second attempt on Jev's coverage alone, and a clause that only a command proves never counts toward that decision — the parser says which clauses those are; a red exam still buys the one more attempt it always did. (derived)
Machine: M1. Every task object `plan_parse.py <plan.md>` prints gains one field, `runOnlyClauses`: the ascending list of clause numbers `n` such that at least one leg of the Proof's `- Legs:` text cites `[M<n>]` and every leg citing it contains the text `Run:`; a leg is the text from one `(<lowercase letter>)` marker to the next, the Legs text runs from `- Legs:` to the end of the Proof slot, and a task with no such clause prints `[]`; the task object's other fields, the top-level keys and `--unguarded` are what they were. M2. When a task has a `testCmd` and the best candidate's exam exited 0, a lowest coverage under `policy.landing.redispatch.coverage_floor` does not make the landing short. M3. For a task with no `testCmd`, the lowest coverage is taken over the clauses whose 1-based number is not in the task's `runOnlyClauses`; with every clause excluded, coverage does not make the landing short. M4. A non-zero exam exit, and a catch, make the landing short exactly as before. M5. After each such decision the engine appends `{ kind: 'floor', task, exam: <exit or null>, lowest, excluded, fired }`, `excluded` the clause numbers left out and `fired` whether coverage alone made the landing short.

**Authorized-by:** #1151 and its reading (the floor fired on a green exam on run-193 tasks 2 and 6 and run-194 task 7 and changed nothing, n=3 firings over 2 runs); the operator's pick of 2026-09-18: "a green exam settles it", and a clause proven only by `Run:` commands never counts

**Interfaces:**
- Consumes: none
- Produces: `plan_parse.py <plan.md>`

**Context:** Two files, one rule. `skills/ultrapowers/scripts/plan_parse.py` parses a claims-v1 plan for the factory engine; `_parse_task_body` reads the Proof slot line by line through `slot_lines("proof")` (each yielded with a flag saying whether it sits inside a code fence — skip fenced lines), and `public_view` is the one place a task's printed fields are chosen. A Proof's legs are one bullet, usually one long line: `- Legs: (a) the first Run: line establishes … [M1]; (b) f() equals 3 [M2]; (c) …`, with `Run:` usually written in backticks, and a leg may cite more than one clause. In `factory/engine.mjs`'s `land`, step 3.5 decides `short`: `best.examExit !== 0`, or the minimum of `best.coverage` under `Number(redispatchPolicy.coverage_floor)`, or `caught` (a selected test that went red); a short landing with `redispatchPolicy.enabled === true` gets exactly one more implementer, labelled `impl:<id>:redispatch`. `best.coverage[i]` is Jev's reading for clause `i + 1`; Jev reads the diff, so a clause a command decides — "the skill still validates", "the rows still number 16" — shows nothing in any diff and reads low while true (0.19, 0.40 and 0.24 on runs 192–193), and a clause an exam has just proven does not need a second opinion to buy a second worker. The engine reads each task from the parser's answer, so the new field arrives on the task object; treat an absent field as `[]`. A prose task has `testCmd` `null` and its `examExit` reads 0 because no command ran, which is why M2 asks for a `testCmd` and not merely an exit of 0. Keep the engine edit inside that step: four sibling tasks are editing this file at the same moment — `examine`'s front, `appendEvent` and `dispatch`, the tool server's construction, and the landing selection. The parser's exam file `tests/test_plan_parse.py` exists, is guarded, and pins the task-object key set as `TASK_FIELDS`: this task's exam EXTENDS that file — its legs grouped under a comment naming this task — and adds the new field to that pin; it runs the parser as a subprocess. The engine's exam is the fake-driven rig of `fleet/tests/_engine_helpers.mjs` (`makeRepo`, a fake `worker` recording dispatch labels, a fake `judge` whose `readLanding` answers a configured coverage, a fake `sh` answering a configured exit for the task's test command) over plan fixtures whose Legs text produces the `runOnlyClauses` each leg names, through the real parser; a policy copy handed in as `args.policy` whose `pairs.mode` is `off` and whose `fold.reverify.enabled` and `select.enabled` are false; it prints `ALL TESTS PASSED` as its last line when every assertion held.

**Proof:**
- Test: `tests/test_plan_parse.py`
- Test: `fleet/tests/test_factory_floor.mjs`
- Guard: `tests/test_plan_parse.py`
- Legs: (a) for a task whose Legs text holds three legs — leg a containing `Run:` and citing `[M1]`, leg b without `Run:` citing `[M2]`, leg c containing `Run:` and citing `[M2]` and `[M3]` — the printed `runOnlyClauses` is `[1, 3]`, in `tasks` and in `launch_waves` alike; a task with no `- Legs:` line prints `[]`; every task object's key set is the earlier set plus `runOnlyClauses` and nothing else, the top-level key set is unchanged, and `--unguarded` on a plan with one unguarded Test path still prints exactly that path and a newline [M1]; (b) with a `testCmd`, exam exit 0 and coverage `[0.9, 0.2]` under a floor of 0.5, the dispatch labels for the task contain exactly one beginning `impl:` and the `floor` row reads `fired` false [M2]; (c) for a task with no `testCmd`, coverage `[0.9, 0.2]` and a plan whose clause 2 is cited only by a `Run:` leg, there is exactly one `impl:` label and the `floor` row's `excluded` is `[2]` and `lowest` is 0.9; with a plan whose clause 2 is cited by a leg without `Run:` there are exactly two, the second `impl:<id>:redispatch`, and `fired` is true; with both clauses cited only by `Run:` legs there is one [M3]; (d) with a `testCmd` and exam exit 1 there are exactly two `impl:` labels whatever the coverage [M4]; (e) every drive above left exactly one `floor` row per measurement decision, with the keys `kind`, `task`, `exam`, `lowest`, `excluded`, `fired` [M5].

**Stale-if:**
- path-absent: `factory/engine.mjs`

### Task 3: Every row says when, and every worker's rows say how long

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `factory/engine.mjs`
- Test: `fleet/tests/test_factory_rows.mjs`

**Claim:** Every row of a run's record carries the time it was written, and every worker the run dispatches leaves a row when it starts and a row when it ends saying what it was, how long it took and what it cost — so why a run was slow can be read off the record by role and not only by task. (derived)
Machine: M1. Every row the engine appends to `events.jsonl` carries `ts`, an ISO-8601 UTC timestamp with milliseconds ending `Z`, set at the moment of the append, and a row's other cells are what they were. M2. Every dispatch appends `{ kind: 'dispatch:start', task, label, role }` before the worker is called and `{ kind: 'dispatch:end', task, label, role, wall_ms, cost_usd, error }` after it returns or throws, `wall_ms` a non-negative integer, `cost_usd` the worker's reported `total_cost_usd` or 0, and `error` the worker's error text or `null`. M3. A worker that throws still leaves its `dispatch:end` row, and the run goes on as it did before.

**Authorized-by:** #1153; the operator's question on run-193 ("Why so long?"), which the record could answer per task and not per role

**Interfaces:**
- Consumes: none
- Produces: nothing

**Context:** `factory/engine.mjs` writes its record through one function, `appendEvent(row)`, which serialises the row onto `events.jsonl`; every row kind in the file goes through it. Every worker goes through one door, `dispatch(opts)`: it sets the task's board state on first dispatch, calls `worker({...})` inside a `try`, turns a thrown error into `answer = { result: null, denials: [], error }` and posts it as `worker-error`, and adds `result.total_cost_usd` to the run's cost. `opts` carries `role`, `label` and `taskId`. The boot reads `events.jsonl` with `awk`, matching `"kind"`, `"task"` and a few other cells by name, so an added cell is safe and a renamed one is not: add `ts`, rename nothing. Put `ts` first or last in the row, consistently. Keep the edit inside `appendEvent` and `dispatch`: four sibling tasks are editing this file at the same moment — `examine`'s front, the re-attempt decision in `land`, the tool server's construction, and the landing selection. The exam is the fake-driven rig of `fleet/tests/_engine_helpers.mjs` (`makeRepo`, a fake `worker` answering `{ result: { total_cost_usd: 0.25 } }` and, for one configured label, rejecting with `boom`), a policy copy handed in as `args.policy` whose `pairs.mode` is `off` and whose `fold.reverify.enabled` and `select.enabled` are false; it prints `ALL TESTS PASSED` as its last line when every assertion held.

**Proof:**
- Test: `fleet/tests/test_factory_rows.mjs`
- Legs: (a) every line of `events.jsonl` parses to an object whose `ts` matches `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$`, the `ts` values are non-decreasing down the file, and the `landing` row still carries `task`, `k`, `examExit`, `claim`, `coverage`, `candidateSha` and `wall_ms` [M1]; (b) for every dispatch label the fake worker saw there is exactly one `dispatch:start` row and exactly one `dispatch:end` row with that `label`, the start above the end and the `role` equal on both; and for every label whose fake worker resolved, the end row carries `wall_ms` an integer at least 0, `cost_usd` 0.25 and `error` `null` [M2]; (c) for the label whose fake worker rejects with `boom`, the `dispatch:end` row's `error` contains `boom` and its `cost_usd` is 0, and the run still resolves its five keys [M3].

**Stale-if:**
- path-absent: `factory/engine.mjs`

### Task 4: A worker runs its exam through a tool, so a failed run reads as failed

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `factory/tools.mjs`
- Modify: `factory/engine.mjs`
- Modify: `factory/roles/exam.md`
- Modify: `factory/roles/implement.md`
- Test: `fleet/tests/test_factory_run_exam.mjs`

**Claim:** A worker has one tool that runs its task's exam and tells it the real result, and every use of it is on the record with its real exit code; a test run the engine only glimpsed through the worker's shell says that its result is unknown, instead of saying it passed. (derived)
Machine: M1. `factoryTools({ kata, projectId, task, candidates, board, runExam })` registers a sixth tool named `run_exam`, taking no arguments, whose handler awaits `runExam()` and answers one text block `exit <code>` followed by a newline and the run's output tail; with no `runExam` it answers the text `run_exam unavailable`; the returned config's enumerable keys are still exactly `type`, `name`, `instance`. M2. The engine builds one tool server per dispatch, handing it a `runExam` that runs the task's `testCmd` through `sh` in that dispatch's own `cwd`, resolves `{ exit, tail }` with `tail` the last 1,500 characters of output, and appends `{ kind: 'worker:test-run', task, label, cmd, exit, red, via: 'run_exam' }` with `red` true exactly when `exit` is not 0; for a task with no `testCmd` it hands no `runExam`. M3. A test run the engine sees only as a Bash call in the worker's stream appends its row with `exit: null`, `red: null` and `via: 'bash'`. M4. `factory/roles/exam.md` and `factory/roles/implement.md` each name the `run_exam` tool as the way to run the task's exam.

**Authorized-by:** the operator's signed Claim of 2026-09-18 ("a test a worker ran and failed reads as failed"); run-193's record (49 of 56 `worker:test-run` rows masked their exit behind a pipe or an echo, and `red` read false on examiners' runs that were red by construction)

**Interfaces:**
- Consumes: none
- Produces: `factoryTools({ kata, projectId, task, candidates, board, runExam }) -> the SDK MCP server config named 'factory'`

**Context:** `factory/tools.mjs` builds the in-process MCP server a worker holds: `note`, `hand`, `settled`, `sibling_fact`, `task_facts`. Every handler answers a text block and catches a rejection as text; the tool definitions hang off the returned config non-enumerably as `tools` and `handlers`, which is how an exam invokes a handler directly; the SDK import is resolved by the file's own `load(...)` fallback out of `fleet/node_modules`. In `factory/engine.mjs` the server is built ONCE per task, inside `examine`, through the `tools` dep (`await tools({ task: { id, uid, files }, candidates: [], board })`, present only when the run has a board), and the same `mcpServers` object is handed to the examiner, every implementer, the re-dispatch and the fix — so a tool cannot know which clone its caller stands in. This task makes the engine build the server per dispatch instead, at each call site that passes `mcpServers` today, so `runExam` closes over that dispatch's `cwd` and `label`; `buildDeps`'s `tools` function passes `runExam` through to `factoryTools`. The engine's `onMessageFor(label, taskId)` writes a `worker:test-run` row when a Bash `tool_result` matches the task's test command, with `red` read from the result's `is_error` — which a failing command behind `| tail` or `; echo EXIT:$?` does not set, and 49 of 56 such rows on run-193 were masked that way. The stream cannot give the exit, so that row stops claiming one. `sh(cmd, argv, cwd)` is the seam a sim fakes; the test command is split on whitespace as `measure` does, and `exitOf` and `outOf` read the answer. The two briefs are short prose: say, in each file's own register, that `run_exam` runs the task's exam and answers its real exit code and output, and that it is the way to run the exam. Keep the engine edits to the tool server's construction and `onMessageFor`'s one row: four sibling tasks are editing this file at the same moment — the exam dispatch inside `examine`, the re-attempt decision in `land`, `appendEvent` and the body of `dispatch`, and the landing selection. The exam drives `factoryTools` directly with a fake `runExam`, and drives `runEngine` with the fake rig of `fleet/tests/_engine_helpers.mjs` and a fake `tools` dep that records the `runExam` it is handed and calls it; a policy copy handed in as `args.policy` whose `pairs.mode` is `off` and whose `fold.reverify.enabled` and `select.enabled` are false; it prints `ALL TESTS PASSED` as its last line when every assertion held.

**Proof:**
- Test: `fleet/tests/test_factory_run_exam.mjs`
- Run: grep -q 'run_exam' factory/roles/exam.md
- Run: grep -q 'run_exam' factory/roles/implement.md
- Legs: (a) the registered tool names are exactly `note`, `hand`, `settled`, `sibling_fact`, `task_facts`, `run_exam`; invoking `run_exam` with a fake `runExam` resolving `{ exit: 1, tail: 'AssertionError: x' }` answers a text block equal to `exit 1\nAssertionError: x`; with no `runExam` it answers `run_exam unavailable`; `Object.keys` of the returned config is exactly `['type', 'name', 'instance']` [M1]; (b) on a rig drive, the fake `tools` dep was called once per dispatch, each time with a `runExam`; calling the one handed to `impl:1:0` makes the fake `sh` see the task's test command with that implementer's clone as its `cwd`, resolves `{ exit: 1, tail }` when the fake `sh` answers exit 1, and appends `{ kind: 'worker:test-run', task: '1', label: 'impl:1:0', exit: 1, red: true, via: 'run_exam' }`; with the fake `sh` answering 0 the row reads `exit: 0, red: false`; for a task with no `testCmd` the `tools` dep was handed no `runExam` [M2]; (c) with a fake worker emitting a Bash `tool_use` of the task's test command and its `tool_result` with `is_error` false, the row appended reads `exit: null`, `red: null`, `via: 'bash'` [M3]; (d) the two `Run:` lines establish each brief names the tool [M4].

**Stale-if:**
- path-absent: `factory/tools.mjs`

### Task 5: The tests a patch touches are actually put to Jev — the lines that matter, inside the budget

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `factory/select.mjs`
- Modify: `factory/engine.mjs`
- Test: `fleet/tests/test_factory_select_excerpt.mjs`

**Claim:** When the engine asks Jev which existing tests guard a patch, it shows Jev the parts of each test that mention what the patch touches, small enough that the question is always actually asked — where today every such question is too large and is never sent. (derived)
Machine: M1. `excerptFor(text, hits, cap)`, exported by `factory/select.mjs`, answers the lines of `text` that contain at least one entry of `hits` — a hit containing `/` or `.` matched as a substring, any other as a whole word — each with the 3 lines before and after it, overlapping windows merged, windows in file order and separated by one line holding only `…`, whole lines only and at most `cap` characters; when no line contains a hit it answers the first `cap` characters of `text` cut at a line end. M2. In the engine, the text of each candidate test handed to `readGuards` is `excerptFor(<the file's text>, <that candidate's hits>, 3000)` and the text handed to `readCovering` is `excerptFor(<the file's text>, <that candidate's hits>, 6000)`. M3. Before either reader is asked, candidates are dropped from the end of the finder's list until the serialized `tests` argument is at most 60,000 bytes, and a drop appends `{ kind: 'select:trimmed', task, kept, dropped }`.

**Authorized-by:** run-194's engine log (n=1 run, 8 tasks, 2026-09-18): on 8 of 8 tasks `jev: state <156,442 to 420,841> bytes over the 120000-byte budget; no call made` and `jev: select.guards: no answers`; #1133

**Interfaces:**
- Consumes: none
- Produces: `excerptFor(text, hits, cap) -> string`

**Context:** `factory/select.mjs` exports `candidateTests({ files, read, paths, symbols, exclude, cap })`, which answers `[{ path, hits }]` — `hits` the needles found in that test file, a needle containing `/` or `.` matched as a substring and any other as a whole word (not flanked by an identifier character), case-sensitive. `factory/engine.mjs` uses it twice: in `examine`, where each candidate's text goes to `readCovering` as `readExamFile(c.path).slice(0, 6000)`, and in `land`'s `runSelection`, where each candidate's text goes to `readGuards` as the WHOLE file. This repository's test files run to 50–100 KB, the finder answers up to 8 of them, and the Jev client refuses any state over 120,000 bytes before it makes a call — so on run-194 no landing selection question was ever sent, and the feature ran dark through its own rollback path. A head slice is the wrong repair (it is the mistake `hunksCarrying` was written to undo for patches): what Jev needs of a test is the lines that mention what the patch touches. Keep the engine edits to those two `tests` constructions: four sibling tasks are editing this file at the same moment — the exam dispatch inside `examine`, the re-attempt decision in `land`, `appendEvent` and `dispatch`, and the tool server's construction. The exam drives `excerptFor` with literal strings, and drives `runEngine` with the fake rig of `fleet/tests/_engine_helpers.mjs` on a fixture repository holding one 100,000-character test file that names the task's symbol on one line and seven more like it, with a fake `judge` whose `readGuards` and `readCovering` record their arguments, and a policy copy handed in as `args.policy` whose `pairs.mode` is `off` and whose `fold.reverify.enabled` is false; it prints `ALL TESTS PASSED` as its last line when every assertion held.

**Proof:**
- Test: `fleet/tests/test_factory_select_excerpt.mjs`
- Legs: (a) for a 20-line text whose lines are `line 1` … `line 20` with line 10 replaced by `call make_widget(3)`, `excerptFor(text, ['make_widget'], 3000)` equals lines 7 through 13 joined by newlines; with a second hit on line 12 the answer is lines 7 through 15 with no `…` line; with hits on lines 3 and 18 the answer is lines 1 through 6, a line `…`, then lines 15 through 20; a line reading `make_widgets(3)` is not a hit for `make_widget`; with `cap` 20 the answer is whole lines totalling at most 20 characters; with no hit anywhere and `cap` 25 the answer is the first whole lines of the text totalling at most 25 characters [M1]; (b) on the rig drive the fake `readGuards` was called, every `tests[i].text` it received is at most 3,000 characters and contains the task's symbol, and every `tests[i].text` the fake `readCovering` received is at most 6,000 characters [M2]; (c) on that drive the serialized `tests` argument of each reader is at most 60,000 bytes; on a fixture with thirty candidate test files that each carry the symbol on a hundred lines, under a policy copy whose `select.max_candidates` is 30, the `tests` argument `readGuards` received is at most 60,000 bytes and `events.jsonl` carries a `select:trimmed` row whose `kept` plus `dropped` is 30 with `dropped` at least 1 [M3].

**Stale-if:**
- path-absent: `factory/select.mjs`

### Task 6: A finished run's issue on the hub is closed, so its sandbox is reaped

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `factory/boot.sh`
- Test: `fleet/tests/test_factory_boot_close.mjs`

**Claim:** When a run ends done, its issue on the hub is closed with the pull request as the evidence, so the next launch removes the finished sandbox without anyone looking; a run that parked or failed stays open for a person, and a hub that refuses the close costs the run nothing. (derived)
Machine: M1. When the run's final state is `done` and `$FLEET_HOME/plans/run-<N>.kata.json` exists, the boot sends exactly one `POST https://kata.int.exe.xyz/api/v1/projects/<project.id>/issues/<run.uid>/actions/close` with the headers `content-type: application/json` and `Idempotency-Key: run-<N>:run:close` and a JSON body whose `actor` is `sandbox:run-<N>`, `reason` is `done`, `message` is `run-<N> done: ` followed by the plan's first heading, ` — ` and the pull request's URL, `evidence` is `[{ "type": "pr", "url": <the pull request's URL> }]` and `retry_protocol` is `close-v1`; the ids are read from that file's `project.id` and `run.uid`; the request is sent after the pull request is opened. M2. When the final state is `parked` or `failed`, or that file does not exist, or it names no `run.uid`, no close request is sent. M3. A close that the hub refuses or that cannot connect is exactly one log line beginning `board:`, and the run's final state and the boot's exit code are what they are without this step.

**Authorized-by:** #1150, corrected by the old boot's own rule (#937, #964: the run issue closes on `done` only, with the pull request as evidence; a parked or failed run stays open for the operator); CLAUDE.md "A `done` close needs a ≥40-character message (run-111)" and "Hub writes are never the run's failure"

**Interfaces:**
- Consumes: none
- Produces: `factory/boot.sh boot`

**Context:** `factory/boot.sh` reaches every external program through a `fleet_*` wrapper (`fleet_curl`, `fleet_git`, `fleet_python3`, …) so an exam can stub it on `PATH`. `publish "$code"` pushes the integration branch, opens the pull request with one `fleet_curl` POST to the GitHub edge host, reads `PR_URL` from the answer, and writes the final state — `done` when the engine's exit code was 0, else `parked` — then `record_tags`; `boot()` calls `board_down` after it. The launcher writes the run's Kata identities onto the plan commit as `.ultrapowers/kata.json`, and `board_up` copies that blob to `$FLEET_HOME/plans/run-<N>.kata.json` before it tries to bring the spoke up, so the file exists whether or not the spoke ever bound; its shape is `{"url":…,"project":{"id":<integer>,"uid":…,"name":…},"run":{"uid":…,"short_id":…},"tasks":{…}}`. The close goes to the hub's administration host, `https://kata.int.exe.xyz`, where the exe.dev edge injects the hub's bearer for a VM tagged `fleet` — the boot sends no `authorization` header and holds no credential; it does not go through the local spoke. Kata refuses a `done` close whose evidence is empty or whose message is under 40 characters, which the message above always clears. The janitor on the laptop asks the hub for the run issue's state and reaps a VM whose run is closed, which is the whole point: until now every finished factory sandbox (runs 191–194) read `stale … state=open` and was removed by hand. `plan_title` already answers the plan's first heading; `json_escape` escapes a string for a JSON body; `RUN_ID` is `run-<N>`. The script runs under `set -u` on bash 3.2 and bash 5. The exam is the stub-on-`PATH` shape the earlier boot exams used: a temporary `FLEET_HOME`; stubs for `curl`, `git`, `npm`, `claude`, `systemd-run`, `systemctl`, `node`, `python3`, `tar`, `sha256sum` and `kata` first on `PATH`, each appending its argv (and, for `curl`, its `-d` body and `-H` headers) to a log under `FLEET_HOME`; `FLEET_ASSIGNMENT` `run=7 plan=<40 hex> target=acme/t base=<40 hex> engine=<40 hex>`; `FLEET_COMMIT_SECONDS=1` and `FLEET_KATA_WAIT_SECONDS=1`; the stub `git show <plan>:.ultrapowers/kata.json` answering a small kata.json or failing; the stub `git rev-parse HEAD` in the target answering a sha other than base so the run reaches `publish`; `env: simEnv(...)` from `fleet/tests/_helpers.mjs`, never `process.env`. Any fixture path the exam invents must NOT have the shape `fleet/tests/test_<name>.mjs` — the suite's hermetic-sims rule reads such a string as one sim naming another. It asserts on recorded argv and bodies, never on timing, and prints `ALL TESTS PASSED` as its last line when every assertion held.

**Proof:**
- Test: `fleet/tests/test_factory_boot_close.mjs`
- Legs: (a) with the stub engine exiting 0, the stub `git` answering a kata.json whose `project.id` is 12 and `run.uid` is `01RUN`, and the pull request POST answering a URL: the stub `curl` log shows exactly one request to `https://kata.int.exe.xyz/api/v1/projects/12/issues/01RUN/actions/close`, after the pull request POST, carrying the header `Idempotency-Key: run-7:run:close` and no `authorization` header, and its body parses to `actor` `sandbox:run-7`, `reason` `done`, `evidence` deep-equal to `[{ type: 'pr', url: <that URL> }]`, `retry_protocol` `close-v1`, and a `message` at least 40 characters long that begins `run-7 done: ` and ends with that URL [M1]; (b) for each of: the stub engine exiting 2, the stub `git` failing the kata.json blob, and a kata.json with no `run` key — the stub `curl` log shows no request whose URL contains `/actions/close` [M2]; (c) with the stub `curl` exiting 22 on the close request, the boot log carries exactly one line beginning `board:` that mentions the close, and the final `status.json` state and the boot's exit code equal those of drive (a) [M3].

**Stale-if:**
- path-absent: `factory/boot.sh`
