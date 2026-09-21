# Jev judges over the record: a command-proved clause reads its command, the claim is read with and without the measured facts, and the end of a run is rows with one audit row

**Grammar:** claims-v1

**Claim:** When I read a factory run's record, a clause that one of the plan's own commands already proved shows that command's result as its coverage instead of a guess from the diff; Jev's whole-claim reading is taken twice — as today, and again with the measured facts in front of it — so I can compare them; and everything the boot did at the end (each hub close, the leave, each merge attempt and re-fold) is a row, with one final row listing anything a finished run should have and doesn't. (elicited)
**Summary:** This gives the factory's judge the measured facts it has been blind to, and makes the end of a run part of the record. It exists because Jev read true clauses low whenever they left nothing in a diff — 0.43 and 0.31 on clauses a command had proved in the same landing (n=3 tasks, run-200) — and because no factory run had ever closed its hub issue and nothing recorded that (n=9 runs, 189–196 and fixture 36). You get readings that agree with the exams, a side-by-side to decide the new question on after five runs, and a record that says what is missing; the command-settled coverage is an experiment, and its rollback is one switch in the policy file.

**Goal:** #1167, all of it but per-leg exam results (deferred to its own ticket — an exam answers one exit code today): cited `Run:` exits become clause coverage by arithmetic, observed facts enter the landing state for a second, record-only claim question, the boot's outcomes become rows, and a done run ends with a computed `run:audit` row.

**Tech Stack:** Node 24 ESM for the factory and its exams, no new npm dependency; bash for the boot, `python3` standard library where it must parse JSON.
Spec: none on disk — issue #1167 and its two comments of 2026-09-21 are the brief, and everything a worker needs is in its Context. The sandbox holds no spec.

**Parallelization rationale:** one wave, width 4. No task consumes another's runtime behaviour: the judge task and the engine task share the `readLanding` call shape as a literal in both Contexts (the engine's exam reads its pure module, never the judge); the boot task and the audit task share the row shapes and the audit's command line as literals (the boot's exam never runs the audit). No two tasks share a file.

## Global Constraints

- Check: git diff --quiet $ULTRA_BASE -- skills fleet/launch.mjs fleet/fleet-bootstrap.sh factory/roles factory/worker.mjs factory/select.mjs factory/board.mjs
- Observed and claimed stay apart: only measured results — an exam's exit, a `Run:` line's exit — may enter Jev's state or a coverage number. A worker's note never does.
- Relevance, not volume: facts are selected by the clauses' own literals and citations and capped in bytes; the whole board is never handed to Jev.
- The old questions are not reworded: `claim_established` and the `M<i>__f<j>` pair keep their exact strings, and the old claim reading keeps scoring and gating exactly as it does today.
- Hub writes are never the run's failure: a row about a close, a leave or a merge records what happened and changes no state and no exit code.
- Every new row is a fact code computed — an exit code, an http code, an id, a list of missing row names — never prose a model wrote.

### Task 1: The judge takes measured facts and settled clauses — it skips what a command settled and asks the claim a second time with the facts, for the record only

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `factory/judge.mjs`
- Modify: `factory/questions.json`
- Test: `fleet/tests/test_factory_judge_facts.mjs`

**Claim:** Jev's whole-claim reading is taken twice — as today, and again with the measured facts in front of it — and a clause a command already proved is not put to Jev at all. (derived)
Machine: M1. `readLanding({ clauses, patch, files })` with no `facts` and no `settled` key calls `ask` once with exactly the `state` (`{ clauses, patch, files }`) and exactly the question keys it sends today — `claim_established` and one `M<i>__f<j>` per (clause, file) pair — and resolves `{ claim, coverage }` with no other key.
M2. With `settled: [1, null, 0]` over three clauses and two files, the questions sent carry no key beginning `M1__` and none beginning `M3__`, still carry `M2__f0` and `M2__f1`, and the resolved `coverage` is `[1, <the larger of the two M2 answers>, 0]`.
M3. With a non-empty `facts` array, the `state` sent also carries `facts` (that array, unchanged) and the questions also carry `claim_established_given_facts`; the resolved row carries `claimGivenFacts` as that answer's number, and `claim` is still the `claim_established` answer.
M4. With non-empty `facts` and an `ask` whose answers lack `claim_established_given_facts`, the row still resolves with `claimGivenFacts: null` and the same `claim` and `coverage` — a record-only question never fails the reading.
M5. `factory/questions.json` carries `sets.landing.questions.claim_established_given_facts` with `"type": "noul"`, an `instructions.question` that names both `patch` and `facts`, and a `note` beginning `Record-only`; `sets.landing.state` lists `facts`; and the `claim_established` object is unchanged — the sha256 of its `json.dumps(..., sort_keys=True)` is `ebdf96fbc153cfc920f54e8adc3862848bef1d0fd72b15afe01e59afde4e9f0f`.

**Authorized-by:** #1167 (desired state 1 and 3); the operator's signed Claim of 2026-09-21.

**Interfaces:**
- Consumes: none
- Produces: `readLanding({ clauses, patch, files, facts, settled })`

**Context:** You see this task body and nothing else. `factory/judge.mjs` exports `makeJudge({ ask, questionsPath, policyPath, log })`; `ask` is `({ state, questions }) -> answers | null`, so an exam hands in a recording stub and reads what was sent — no network. `readLanding` today builds `questions = { claim_established, M<i>__f<j>… }` (clauses counted from M1, files from f0, the pairwise template at `sets.landing.pairwise` filled with the zero-based clause index) and calls `askOnce('landing', { clauses, patch, files }, questions, read)`; an answer is a number or `{ noul: number }`. Three siblings run beside you and none touches your files: one wires `factory/engine.mjs` to call `readLanding` with the two new keys — `facts`, an array of `{ kind: 'exam', exit }` and `{ kind: 'run:line', cmd, exit, cites }` objects, and `settled`, an array as long as `clauses` whose entries are `1`, `0` or `null` (`null` means "not settled, ask Jev") — and two work on the boot. A settled entry is a command's exit code turned into coverage, so its value goes into `coverage` at that index as given and its pairwise questions are not sent. The new question is a DIFFERENT question from `claim_established`, which was read over recorded runs at its exact string — so you add a question and never edit that one; keep the file's rule that `factory/judge.mjs` carries no decimal literal. Suggested wording for the new question, yours to tighten: "Given `patch` (a unified diff) and `facts` (results the engine measured after applying it: the task's exam exit code and the exit codes of the plan's own proof commands, each with the clauses it cites), is every clause in `clauses` established as delivered?", criteria true "Every clause is satisfied by code in the patch or by a measured fact that proves it", false "At least one clause is unmet by the patch and unproved by any fact".

**Proof:**
- Test: `fleet/tests/test_factory_judge_facts.mjs`
- Run: python3 -c "import json,hashlib; q=json.load(open('factory/questions.json'))['sets']['landing']; assert hashlib.sha256(json.dumps(q['questions']['claim_established'],sort_keys=True).encode()).hexdigest()=='ebdf96fbc153cfc920f54e8adc3862848bef1d0fd72b15afe01e59afde4e9f0f'; n=q['questions']['claim_established_given_facts']; assert n['type']=='noul' and 'patch' in n['instructions']['question'] and 'facts' in n['instructions']['question'] and n['note'].startswith('Record-only'); assert 'facts' in q['state']" [M5]
- Legs: (a) [M1] a recording `ask` answering every key it is sent with `0.5`: for two clauses and two files and no `facts`/`settled`, the one recorded call's `Object.keys(state)`, sorted, are `clauses, files, patch`, its question keys, sorted, are `claim_established, M1__f0, M1__f1, M2__f0, M2__f1`, and the row's keys are exactly `claim, coverage`; (b) [M2] three clauses, two files, `settled: [1, null, 0]`, an `ask` answering `M2__f0` `0.2` and `M2__f1` `0.7`: no sent key starts `M1__` or `M3__`, both `M2__` keys are sent, and `coverage` deep-equals `[1, 0.7, 0]`; (c) [M3] `facts: [{ kind: 'exam', exit: 0 }]` and an `ask` answering `claim_established` `0.3` and `claim_established_given_facts` `0.9`: the sent `state.facts` deep-equals the array, the sent keys include `claim_established_given_facts`, and the row has `claim === 0.3` and `claimGivenFacts === 0.9`; (d) [M4] the same call with an `ask` that omits `claim_established_given_facts`: the row is not `null`, `claimGivenFacts === null`, `claim === 0.3`.

**Stale-if:**
- path-absent: `factory/judge.mjs`
- issue-closed: #1167

### Task 2: The engine turns a cited command's exit into that clause's coverage, selects the observed facts for Jev, and records both readings

**Type:** implementation
**Review:** peer

**Files:**
- Create: `factory/facts.mjs`
- Modify: `factory/engine.mjs`
- Modify: `factory/policy.json`
- Test: `fleet/tests/test_factory_facts.mjs`

**Claim:** A clause that one of the plan's own commands already proved shows that command's result as its coverage instead of a guess from the diff, and the measured facts reach Jev selected and capped. (derived)
Machine: M1. `settledCoverage({ clauses, proofRunClauses, runLines })` returns an array as long as `clauses`: entry `i` is `null` when no run line cites `M<i+1>`, `1` when every line citing it has `exit === 0`, and `0` when any line citing it has a non-zero exit or has no result in `runLines`.
M2. `observedFacts({ clauses, hasExam, examExit, proofRuns, proofRunClauses, runLines, capBytes })` returns, in order, `{ kind: 'exam', exit: examExit }` exactly when `hasExam` is true, then one `{ kind: 'run:line', cmd, exit, cites }` per run line that cites at least one clause or whose `cmd` contains one of the clauses' backticked literals of 3 or more characters — and no object for a line that does neither.
M3. `observedFacts` drops facts from the END until `JSON.stringify` of the array is at most `capBytes` bytes long, and takes no note, no worker text and no board reading as input: its only inputs are the seven named keys.
M4. `factory/policy.json` carries `landing.facts` with `enabled: true`, `cap_bytes: 4000`, `experiment: true`, `n: 0`, and a `rollback` string naming `enabled = false`.
M5. In `factory/engine.mjs`, `measure` reads `landing.facts.enabled`: when true it hands `readLanding` the `facts` from `observedFacts` and the `settled` from `settledCoverage` and appends one `landing:facts` row `{ kind, task, settled, claim, claimGivenFacts, facts }` (`facts` a count); when false it hands neither and appends no such row, which is today's behaviour.

**Authorized-by:** #1167 (desired state 1, 2 and 3, and its Rollback); the operator's signed Claim of 2026-09-21.

**Interfaces:**
- Consumes: none
- Produces: `settledCoverage({ clauses, proofRunClauses, runLines })`
- Produces: `observedFacts({ clauses, hasExam, examExit, proofRuns, proofRunClauses, runLines, capBytes })`

**Context:** You see this task body and nothing else. In `factory/engine.mjs`, `measure` runs a candidate's exam (`examExit`), then the task's own Proof `Run:` lines through `runLines` — each result is `{ cmd, exit, tail }`, in the order of `task.proofRuns` — and only THEN asks Jev: `read('readLanding', { task, cwd, clauses, patch, files })`, returning `{ …, claim, coverage, runLines }`. So the facts exist before the question is asked and were never shown to it. `task.proofRunClauses` is parallel to `task.proofRuns`: entry `k` is the sorted clause ids line `k` cites, such as `["M3"]`, or `[]` for an uncited guard; `task.clauses` is the array of Machine clause texts, M1 first; `task.testCmd` is `null` for a task with no exam (then `hasExam` is false). Run-200 is the reading this answers (n=3 tasks): clauses a cited command had proved in the same landing read 0.43 and 0.31 from the diff alone, because an absence leaves nothing in a diff. A sibling task changes `factory/judge.mjs` so `readLanding` accepts two more keys and you do not touch that file: `facts` — the array `observedFacts` returns — and `settled` — the array `settledCoverage` returns, where a `1` or `0` entry means "code settled this clause, do not ask" and comes back in `coverage` at that index; its row gains `claimGivenFacts` (a number or `null`), a second, record-only claim reading. `claim` keeps scoring candidates exactly as today — `claimGivenFacts` is only written to the row. The literal rule for M2 is `literalsOf` in `factory/hunks.mjs` (every backticked span of at least 3 characters in the clause texts); import it rather than re-deriving it. Policy cells in `factory/policy.json` each carry `n`, `window`, `basis`, `experiment` and `rollback` — copy the shape of the existing `proofs` cell. Keep the new logic in the pure module so its exam needs no engine run; the engine is over its size budget, so the wiring is a few lines, not a framework. The other two siblings work on `factory/boot.sh` and a new `factory/audit.mjs`.

**Proof:**
- Test: `fleet/tests/test_factory_facts.mjs`
- Run: python3 -c "import json; c=json.load(open('factory/policy.json'))['landing']['facts']; assert c['enabled'] is True and c['cap_bytes']==4000 and c['experiment'] is True and c['n']==0 and 'enabled = false' in c['rollback']" [M4]
- Run: grep -q "settledCoverage" factory/engine.mjs && grep -q "observedFacts" factory/engine.mjs && grep -q "landing:facts" factory/engine.mjs [M5]
- Legs: (a) [M1] three clauses, `proofRunClauses: [["M1"], ["M3"], ["M3"], []]`, `runLines` exits `[0, 0, 2, 1]`: the result deep-equals `[1, null, 0]`; and with `runLines` holding only the first result, entry 2 is still `0` (a cited line with no result is not proof); (b) [M2] clauses ``["M1. `alpha.txt` exists", "M2. prose only"]``, `hasExam: true`, `examExit: 0`, run lines `test -f alpha.txt` (uncited), `true` cited `["M2"]`, and `echo unrelated` (uncited): the result's kinds and cmds are, in order, `exam`, `run:line test -f alpha.txt`, `run:line true` — three objects, none for `echo unrelated` — and with `hasExam: false` the first object is absent; (c) [M3] the same call with `capBytes` set to the byte length of the first two facts' `JSON.stringify` plus 1 returns exactly those two, and `observedFacts.length === 1` (it destructures one argument).

**Stale-if:**
- path-exists: `factory/facts.mjs`
- issue-closed: #1167

### Task 3: What the boot does at the end of a run is rows — each hub close, the leave, each merge attempt and re-fold — committed before the tags, with the audit row after them

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `factory/boot.sh`
- Test: `fleet/tests/test_factory_boot_rows.mjs`

**Claim:** Everything the boot did at the end (each hub close, the leave, each merge attempt and re-fold) is a row in the run's record. (derived)
Machine: M1. `bash factory/boot.sh event-row <file> board:close what=run code=200` appends exactly the line `{"kind":"board:close","what":"run","code":200}` and a newline to `<file>`, creating it if absent, and exits 0; a value that is an integer or the word `null`, `true` or `false` is written bare, and every other value as a JSON string.
M2. `bash factory/boot.sh event-row <file> refold ok=false reason='kernel said "no"'` appends exactly `{"kind":"refold","ok":false,"reason":"kernel said \"no\""}`; two calls leave two lines, the first untouched.
M3. `bash factory/boot.sh` with no argument still prints a usage line on stderr and exits 2, and `bash -n factory/boot.sh` exits 0.
M4. Every end-of-run outcome writes its row through that one writer, called inside the boot with the same `<kind> key=value` arguments (`board:close what=… code=…`, `board:leave rc=…`, `merge code=…`, `refold ok=…`), into the evidence copy of `events.jsonl`: `close_issue` a `board:close` row with `what` and the http `code` (`null` when none came back) on a 2xx and on a refusal alike; each `close skipped` path a `board:close` row with `code=null` and a `skipped` reason; `board_down` a `board:leave` row with kata's exit code as `rc`; each merge request a `merge` row with its http `code`; `refold_onto` a `refold` row with `ok` and, when refused, its `reason`.
M5. `publish` runs, after `close_run` and before `record_tags`: the audit command `fleet_node "$ENGINE_REPO_DIR/factory/audit.mjs" <events file> <state>` with `--bound` when the board was bound, appending its one stdout line to the same events file, and then one more `evidence_commit` — so the rows written after the last commit ride the evidence tag.

**Authorized-by:** #1167, comment of 2026-09-21T20:11Z (item 1, and where item 2's row is appended); the operator's signed Claim of 2026-09-21.

**Interfaces:**
- Consumes: none
- Produces: `boot.sh event-row <file> <kind> [key=value ...]`

**Context:** You see this task body and nothing else; nobody else touches `factory/boot.sh`. The defect: no factory run had ever closed its hub issue (n=9 runs, 189–196 and fixture 36) and nothing in the record said so, because a skipped close, a refused close and a failed `federation leave` were each a `log` line on a VM that gets deleted. Since then each is one log line; this makes each one row. The file's dispatch is a `case "${1:-}"` at the bottom with `boot`, `kata-ids` and `kata-task-uids` arms and a `usage: boot.sh boot` line that exits 2 — add an `event-row` arm so the writer is examinable without running a boot. While the engine runs, a relay copies `$RUN_DIR/events.jsonl` over `$EVIDENCE_DIR/$EVIDENCE_REL/events.jsonl`; it stops when the engine ends, and `publish` already appends its `publish:pr` row straight to the evidence copy with a `printf` — write yours to that same file, and use the file's own `json_escape` for strings. In `publish` the order today is `write_status … ; evidence_commit "$RUN_ID: $state"`, then `close_run "$state"`, then `record_tags`, which pushes the evidence HEAD as the tag — so anything written during `close_run` is after the last commit and never reaches the tag; that is what M5's extra commit fixes. `close_run` calls `board_down` itself, which clears `BOARD_BOUND`, so read whether the board was bound BEFORE `close_run` runs. A sibling creates `factory/audit.mjs`; you only call it, with exactly this command line — `node factory/audit.mjs <events.jsonl> <state> [--bound]` — and it prints one JSON line and exits 0; a missing file or a non-zero exit must cost the run nothing (`|| true`), like every hub write here. The merge loop is `maybe_self_merge` (it reads `MERGE_HTTP_CODE` after each `send_merge`) and `refold_onto` (its failure reason is the local `reason`, or the refused force-with-lease push). The boot is over its size budget: one small writer and one call per outcome, no framework. The other two siblings work on `factory/judge.mjs` and `factory/engine.mjs`.

**Proof:**
- Test: `fleet/tests/test_factory_boot_rows.mjs`
- Run: bash -n factory/boot.sh
- Run: test "$(grep -c "board:close what=" factory/boot.sh)" -ge 2 && grep -q "board:leave rc=" factory/boot.sh && grep -q "merge code=" factory/boot.sh && grep -q "refold ok=" factory/boot.sh [M4]
- Run: awk '/^publish\(\)/,/^}/' factory/boot.sh | tr '\n' ' ' | grep -q 'close_run.*audit\.mjs.*evidence_commit.*record_tags' [M5]
- Legs: (a) [M1] in a temp directory, the M1 command on an absent file: exit status `0` and the file's bytes are exactly `{"kind":"board:close","what":"run","code":200}\n`; then `event-row <file> board:close what='task 3' code=null skipped='no kata.json'` appends exactly `{"kind":"board:close","what":"task 3","code":null,"skipped":"no kata.json"}\n`; (b) [M2] the M2 command appends exactly `{"kind":"refold","ok":false,"reason":"kernel said \"no\""}\n`, every line of the file parses with `JSON.parse`, and the earlier lines are byte-unchanged; (c) [M3] `bash factory/boot.sh` with no argument exits `2` with a non-empty stderr and an empty stdout, and `bash -n factory/boot.sh` exits `0`.

**Stale-if:**
- path-absent: `factory/boot.sh`
- issue-closed: #1167

### Task 4: A finished run's record ends with one computed row naming what it should have and doesn't

**Type:** implementation
**Review:** peer

**Files:**
- Create: `factory/audit.mjs`
- Test: `fleet/tests/test_factory_audit.mjs`

**Claim:** A finished run's record carries one final row listing anything it should have and doesn't. (derived)
Machine: M1. `auditRows(rows, { state, bound })` returns `{ kind: 'run:audit', state, missing }`; for any `state` other than `done`, `missing` is `[]`.
M2. For `state: 'done'`, every task that has a `landing` row and no `fold:verify` row with the same `task` contributes the string `fold:verify task <id>`, in the order of the `landing` rows.
M3. For `state: 'done'` with `bound: true`, after those come: `board:close task <id>` for every landed task with no `board:close` row whose `what` is `task <id>` and whose `code` is an integer from 200 to 299; then `board:close run` under the same rule for `what: 'run'`; then `board:leave` when no `board:leave` row has `rc === 0`. With `bound: false` none of the three kinds is ever listed.
M4. `node factory/audit.mjs <events.jsonl> <state> [--bound]` reads the file as JSON lines, skipping any line that does not parse, prints exactly one line — `JSON.stringify` of that object — and exits 0; an unreadable file is audited as no rows, still one line, still exit 0.

**Authorized-by:** #1167, comment of 2026-09-21T20:11Z (item 2); the operator's signed Claim of 2026-09-21.

**Interfaces:**
- Consumes: none
- Produces: `auditRows(rows, { state, bound })`

**Context:** You see this task body and nothing else. A run's record is `events.jsonl`, one JSON object per line, each with a `kind`. The engine writes a `landing` row `{ kind: 'landing', task: '<id>', … }` for every task it adopts and a `fold:verify` row `{ kind: 'fold:verify', task: '<id>', ran, attempt }` when it re-checks the folded tree. A sibling task makes the boot write, at the end of a run, `{ "kind": "board:close", "what": "task <id>" | "run", "code": <http code or null> }` (with a `skipped` reason when it never sent the close) and `{ "kind": "board:leave", "rc": <kata's exit code> }`, and then calls exactly `node factory/audit.mjs <events.jsonl> <state> [--bound]`, appending your one stdout line to that same file — so whatever happens, print one line and exit 0: the audit is a fact for the record and must never cost a run. The reason it exists: nine factory runs ended `done` without ever closing their hub issue (n=9 runs, 189–196 and fixture 36), and a skipped close and a successful one left the same record — nothing. Absence is a fact code computes; this row is that computation, and it judges nothing: a name is in `missing` or it is not. `bound` says the run had a hub board at all — a hubless run is not missing a close it could never send. Task ids are strings and may be non-numeric. Pure ESM, standard library only; the default export and the CLI live in the one file (run the CLI only when the file is the entry point). The other siblings work on `factory/judge.mjs`, `factory/engine.mjs` and `factory/boot.sh`.

**Proof:**
- Test: `fleet/tests/test_factory_audit.mjs`
- Legs: (a) [M1] rows with a `landing` for task `1` and nothing else, `state: 'parked'`, `bound: true`: the result deep-equals `{ kind: 'run:audit', state: 'parked', missing: [] }`; (b) [M2] `landing` rows for tasks `2` then `1` and a `fold:verify` for `1` only, `state: 'done'`, `bound: false`: `missing` deep-equals `['fold:verify task 2']`; (c) [M3] the same two landings, both verified, with `board:close` rows `what: 'task 2', code: 200`, `what: 'task 1', code: 409`, `what: 'run', code: null, skipped: 'x'`, and `board:leave rc: 6`, `bound: true`: `missing` deep-equals `['board:close task 1', 'board:close run', 'board:leave']`; with every close at `200` and `rc: 0` it is `[]`; and with `bound: false` over the first set it is `[]`; (d) [M4] the CLI over a temp file holding those rows plus one line `not json`, arguments `done --bound`: status `0`, stdout is exactly one line and `JSON.parse` of it deep-equals leg (c)'s first object; over a path that does not exist: status `0` and stdout parses to `{ kind: 'run:audit', state: 'done', missing: [] }`.

**Stale-if:**
- path-exists: `factory/audit.mjs`
- issue-closed: #1167
