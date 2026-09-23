# A rig red goes back to the examiner, and the record says which kind of red it was

**Grammar:** claims-v1

**Claim:** When an exam is red for a reason none of its legs names — its own rig, not the code — it goes back to the examiner who wrote it before any implementer is sent against it, and a fold red of that kind goes to the examiner too; the record says of every red whether it was a leg or the rig. (elicited)
**Summary:** Two of the last twenty-two runs parked because the exam's own scaffolding could not reach the code it was meant to test, and the implementer, who may not edit the exam, was sent against it twice and lost both times. This plan has the examiner prove its rig before handing in, routes a rig red back to the examiner, and marks each red on the record as a leg or the rig. Runs stop parking on exams that could never pass, and you can count how often it happens.

**Goal:** Close #1245's three desired states — the examiner's hand-in is checked by the engine's own run of the exam at BASE and a rig red buys one examiner fix round before any implementer goes out; a fold red of `cause: own` that is a rig red re-attempts as the examiner, not a second implementer; and every `fold:red` row carries `red: leg | rig` — with one computable classifier and one policy cell that rolls the whole thing back.
**Closes:** #1245

**Tech Stack:** Node 22 ESM (`factory/*.mjs`), sims under `fleet/tests/test_*.mjs` that exit non-zero on a failed assertion and print `ALL TESTS PASSED`, bridged by `python3 -m pytest`; `factory/policy.json` for every threshold; `factory/roles/*.md` for the judgment prompts.

**Spec:** #1245 (the reading of runs 202–223, n=22 factory runs, 2026-09-21/22: run-215 task 3, run-223 task 2 and run-223 task 4 were each red on the exam's own rig, and two of them parked the run after the implementer lost twice against an exam it may not edit).

## Global Constraints

- A red is classified by a computable rule over the exam's own exit code and captured output, never by a judgment: a red whose output carries no bracketed `M<n>` citation, or whose exit is the runner's `124` timeout, is the rig's; every other red is a leg's. The rule lives in one module, `factory/redkind.mjs`, and every caller reads it from there.
- The record's `red` cell takes exactly three values — the strings `leg` and `rig`, and `null` for a red that is not an exam's (a `Check:` line) — and no row invents a fourth.
- Every new switch is one cell of `factory/policy.json` carrying `n`, `window`, `basis`, `experiment` and `rollback`, and the whole of this plan rolls back with `exam.rig_red.enabled = false`: with it false the routes are exactly today's and only the `red` cell and the `exam:self-check` rows remain.
- Every sim this plan adds is pure — it imports the module under test and writes its own fakes; it spawns no process, reads no disk outside its own imports, and names no sibling sim.
- Check: git diff --quiet $ULTRA_BASE -- factory/union.mjs factory/worker.mjs factory/judge.mjs factory/questions.json factory/boot.sh fleet/fleet-bootstrap.sh skills/ultrapowers/kernel

### Task 1: One rule says whether a red was a leg's or the rig's

**Type:** implementation
**Review:** peer

**Files:**
- Create: `factory/redkind.mjs`
- Test: `fleet/tests/test_factory_redkind.mjs`

**Claim:** Given only what the engine already captured from an exam run — its exit code and its output — a caller can ask whether the red was a leg failing or the rig breaking, and can ask whether a rig red at this attempt still buys the examiner one more round. (derived)
Machine: M1. `redKind({ exit, out })` returns exactly `'leg'` when `exit` is non-zero and not `124` and `out` contains at least one bracketed span carrying an `M<n>` token (a match of `/\[[^\]]*\bM\d+\b[^\]]*\]/`); it returns exactly `'rig'` when `exit` is non-zero and `out` contains no such span, and exactly `'rig'` whenever `exit` is `124` whatever `out` carries; it returns exactly `null` when `exit` is `0`. M2. A non-string `out` — `undefined`, `null` — is read as the empty string, so `redKind({ exit: 1, out: undefined })` is exactly `'rig'` and never throws. M3. `rigRound({ attempt, red, enabled })` returns exactly `true` only when `attempt` is `1`, `red` is `'rig'` and `enabled` is `true`; each of `attempt: 2`, `red: 'leg'`, `red: null` and `enabled: false`, varied one at a time off that base call, returns exactly `false`. M4. `factory/redkind.mjs` imports nothing: it has no `import` statement.

**Authorized-by:** #1245 desired states 1–3 (the one rule the self-check, the fold route and the `red` cell all read); CLAUDE.md §Doctrine, "Verification is mechanical and fast" (a fact computed from the output, never a judgment).

**Interfaces:**
- Consumes: none
- Produces: `redKind({ exit, out }) -> 'leg' | 'rig' | null`
- Produces: `rigRound({ attempt, red, enabled }) -> boolean`

**Context:** The module is the shared literal of this plan: the engine's exam self-check (in `factory/engine.mjs`) and the fold round (in `factory/reverify.mjs`) both import it, so its two exports are named exactly as the Produces lines spell them, as named exports of an ES module, with a `default` export carrying both. The citation span is the same one `examAssertions` in `factory/facts.mjs` reads a clause citation from (`bracketRe = /\[[^\]]*\]/g` then `/\bM\d+\b/g` inside it): a node `assert` failure prints its message — `AssertionError [ERR_ASSERTION]: (a) [M1] …` — and a pytest failure prints `AssertionError: (a) [M1] …`, so a leg red carries its citation in the output, where a `TypeError` outside an assertion, a `MODULE_NOT_FOUND`, a rig that deadlocks until the runner's `timeout` kills it at exit `124` (run-215's `spawnSync` rig), or a helper that never passes the dependency it was meant to pass (run-223's `launchIn`) carries none. Known mis-read, owed as a reading and not fixed here: node 22 echoes the throwing source line above an uncaught error, so a rig exception thrown by the argument expression of an assertion whose message carries `[M<n>]` reads as `'leg'`; #1245 §Reading owed counts exactly this ("how often the self-check is wrong about a rig red"). `rigRound` is the whole of the "at most one examiner round" rule: the engine calls it with the row it just wrote and the policy cell `exam.rig_red.enabled` (a cell another task of this plan adds to `factory/policy.json`; this module never reads the policy file). The sim is pure: it imports `../../factory/redkind.mjs` and computes over literal strings; M4 is a `Run:` grep, not a leg.

**Proof:**
- Test: `fleet/tests/test_factory_redkind.mjs`
- Guard: `fleet/tests/test_factory_redkind.mjs`
- Legs: (a) `redKind` over `{ exit: 1, out: 'AssertionError [ERR_ASSERTION]: (a) [M1] the row is missing' }` is exactly `'leg'`, over `{ exit: 1, out: 'TypeError: Cannot read properties of undefined' }` is exactly `'rig'`, over `{ exit: 124, out: '(a) [M1] started' }` is exactly `'rig'`, and over `{ exit: 0, out: '(a) [M1] ok' }` is exactly `null` [M1]; (b) `redKind({ exit: 1, out: undefined })` and `redKind({ exit: 1, out: null })` each return exactly `'rig'` without throwing [M2]; (c) `rigRound({ attempt: 1, red: 'rig', enabled: true })` is exactly `true`, and the four one-at-a-time variations — `attempt: 2`, `red: 'leg'`, `red: null`, `enabled: false` — are each exactly `false` [M3]; (d) the `Run:` line below: the module has no import line [M4].
- Run: test 0 -eq $(grep -c '^import ' factory/redkind.mjs) [M4]

**Stale-if:**
- issue-closed: #1245

### Task 2: A fold red says which kind it was, and a rig red of the task's own exam re-attempts as the examiner

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `factory/reverify.mjs`
- Modify: `factory/policy.json`
- Test: `fleet/tests/test_factory_reverify.mjs`

**Claim:** After a fold, every red row on the record says whether a leg failed or the rig broke, and when the folded task's own exam is red on its rig the worker sent back is the examiner who wrote it, told so, instead of another implementer against an exam that cannot pass. (derived)
Machine: M1. Every `fold:red` and `fold:exam-defect` row `foldRound` appends carries a `red` cell: exactly `redKind({ exit: red.exit, out: red.out })` for a red of `kind: 'exam'`, and exactly `null` for a red of `kind: 'check'`. M2. `foldRound` takes one more argument, `rigToExam`; with `rigToExam === true`, an exam red whose `cause` is `'own'` and whose `red` is `'rig'` is appended with `reattempt: { role: 'exam', task: <folded> }`, and the one `reattempt` call it produces carries `role: 'exam'`, `task: <folded>` and a `fact` whose first line is exactly `FOLD EXAM-RIG`. M3. With `rigToExam === true`, an own red whose `red` is `'leg'` is appended with `reattempt: { role: 'implement', task: <folded> }` and `reattempt` is called with `role: 'implement'`, exactly as today; and with `rigToExam` absent or `false`, an own red whose `red` is `'rig'` still carries `red: 'rig'` on its row but is appended with `reattempt: { role: 'implement', task: <folded> }`. M4. A sibling red is routed exactly as today whatever its `red` cell: with `rigToExam: true`, `enabled: true`, `runExamAt` answering `0` and `read` answering `null`, a red of a sibling task with rig output is appended with `cause: 'sibling'`, `red: 'rig'` and `reattempt: { role: 'implement', task: <sibling> }`. M5. `factory/policy.json` carries a top-level `exam` object whose `rig_red` cell has `enabled` exactly `true`, `n` exactly `0`, `window` exactly `"none"`, `experiment` exactly `true` and `rollback` exactly `"enabled = false"`.

**Authorized-by:** #1245 desired states 2 and 3; #1206 (the route it extends: an exam broken by a sibling already re-attempts as its examiner); CLAUDE.md §Doctrine, "Test doctrine" (a flip taken under the floor is an `experiment` carrying its `rollback`).

**Interfaces:**
- Consumes: `redKind({ exit, out }) -> 'leg' | 'rig' | null`
- Produces: `foldRound({ reds, folded, headBefore, head, enabled, hunks, runExamAt, read, appendEvent, reattempt, verify, rigToExam }) -> Promise<{ unresolved, actions }>`

**Context:** `foldRound` in `factory/reverify.mjs` is pure — its arguments are its whole world — and today it attributes each red (`cause: 'own'` when `red.id` is the folded task, `'sibling'` for another exam, `'check'` for a check line), routes every own red to `{ role: 'implement', task: folded }`, and only a sibling red that was green before the fold and that `readFoldRed` calls an exam defect goes to `{ role: 'exam', task: owner }` under `kind: 'fold:exam-defect'`. The `row` object it appends today has the keys `kind, task, fold, head_before, head, exit, exam, cmd, owner, cause, green_before, reattempt` and sometimes `score`; the `red` cell is added beside `cause`, computed by `redKind` imported from `./redkind.mjs` (the module another task of this plan creates: `'leg'` when the output carries a bracketed `M<n>` citation, `'rig'` when it carries none or the exit is `124`, `null` at exit `0`) over the red's full `out`, not the 2000-character `assertionOf` tail. The new route is the smallest one: before today's `if (!on) … else if (cause !== 'sibling') …` chain, an own exam red with `red === 'rig'` and `rigToExam === true` takes `reattemptFor = { role: 'exam', task: folded }` and its `kind` stays `'fold:red'`; the engine's `reattempt` already dispatches `role: 'exam'` with `EXAM_MD`, the task's `proofTests` and `examPrompt` (it is what #1206's route uses), so nothing in the engine has to change for the dispatch itself. `factFor(role, assertions, hunks)` builds the fact the re-attempted worker reads; it gains a third shape for the rig route whose first line is `FOLD EXAM-RIG` and whose second paragraph says, in these terms: this exam is red for a reason none of its legs names — an exception outside an assertion, a timeout, or a helper that never reaches the seam — so the exam's own rig is what to fix, not the implementation, and the assertions and fold hunks follow as they do for the other two shapes. `noteAction` collapses reds to one action per `role|task` key, so the fact shape is chosen per action from the role and a `rig` flag the action carries. The sim named for this surface does not exist at BASE (no sim imports `factory/reverify.mjs`), so `fleet/tests/test_factory_reverify.mjs` is opened for it and is pure: it imports `foldRound` from `../../factory/reverify.mjs`, writes `appendEvent`, `reattempt` (recording its argument, answering `true`), `verify` (answering `{ ran: [], reds: [] }`), `runExamAt` and `read` as its own fakes, and never spawns. A rig red for the sim is `{ kind: 'exam', id: '1', exit: 1, out: 'TypeError: Cannot read properties of undefined (reading "red")' }` and a leg red is the same with `out: 'AssertionError [ERR_ASSERTION]: (a) [M1] the row is missing'`; a check red is `{ kind: 'check', cmd: 'true', exit: 1, out: '' }`. The policy cell is the plan's one switch — the engine (another task of this plan) reads `(policyDoc.exam || {}).rig_red || {}` and passes `rigToExam: cell.enabled === true` into `foldRound` and the same cell into its exam self-check — written as a new top-level key `"exam"` placed directly after the `"speculate"` object and before `"fold"`, in the shape every cell of the file already has: `{ "rig_red": { "enabled": true, "n": 0, "window": "none", "basis": "judgment", "experiment": true, "rollback": "enabled = false", "unread": "<the #1245 reading: 3 exams on 2 of 22 runs (202-223, 2026-09-21/22) red on their own rig; the pre-registered reading per release is parks by exam-rig defect, examiner fix rounds per run, and self-checks wrong about a rig red>" } }`. Until the engine passes it, `rigToExam` is `undefined` and the route is off, which is M3's second half.

**Proof:**
- Test: `fleet/tests/test_factory_reverify.mjs`
- Guard: `fleet/tests/test_factory_reverify.mjs`
- Legs: (a) one rig-output own red and one leg-output own red, each through its own `foldRound` call with `rigToExam: true`: the appended `fold:red` rows carry `red: 'rig'` and `red: 'leg'` respectively, and a check red's row carries `red: null` [M1]; (b) the rig-output own red with `rigToExam: true`: its row's `reattempt` deep-equals `{ role: 'exam', task: '1' }`, `reattempt` was called exactly once, with `role: 'exam'`, `task: '1'`, and a `fact` whose text up to the first newline is exactly `FOLD EXAM-RIG` [M2]; (c) the leg-output own red with `rigToExam: true` has `reattempt` deep-equal to `{ role: 'implement', task: '1' }` and the recorded call's `role` is `'implement'`; the rig-output own red with `rigToExam` omitted has `red: 'rig'` on its row and `reattempt` deep-equal to `{ role: 'implement', task: '1' }` [M3]; (d) a rig-output red of sibling `'2'` folded by `'1'` with `rigToExam: true`, `enabled: true`, `runExamAt` answering `0` and `read` answering `null`: its row carries `cause: 'sibling'`, `red: 'rig'` and `reattempt` deep-equal to `{ role: 'implement', task: '2' }` [M4]; (e) the `Run:` line below reads the five cell values off the file [M5].
- Run: python3 -c "import json,sys; c=json.load(open('factory/policy.json'))['exam']['rig_red']; sys.exit(0 if c['enabled'] is True and c['n']==0 and c['window']=='none' and c['experiment'] is True and c['rollback']=='enabled = false' else 1)" [M5]

**Stale-if:**
- issue-closed: #1245

### Task 3: The engine runs the exam at BASE when the examiner hands in, and a rig red buys one examiner round before any implementer

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `factory/engine.mjs`
- Test: `fleet/tests/test_factory_exam_selfcheck.mjs`

**Claim:** When an examiner hands in, the engine itself runs the exam where no implementation exists and writes down what kind of red it got; an exam red on its own rig goes back to that examiner once, with the output in hand, before a single implementer is sent against it. (derived)
Machine: M1. `factory/engine.mjs` exports `selfCheckExam({ task, runExam, dispatchExaminer, appendEvent, enabled })`: it calls `runExam()` once, which answers `{ exit, out }`, and appends exactly one row `{ kind: 'exam:self-check', task, attempt: 1, exit, red }` with `red` exactly `redKind({ exit, out })`; when that `red` is `'leg'` or `null`, `dispatchExaminer` is called zero times and no second row is appended. M2. When that `red` is `'rig'` and `enabled` is `true`, the events happen in exactly this order: the `attempt: 1` row is appended, `dispatchExaminer` is called exactly once with an argument whose `fact` begins with the line `EXAM RIG-RED` and contains the first run's exit and the last 1500 characters of its `out`, `runExam()` is called a second time, and a row `{ kind: 'exam:self-check', task, attempt: 2, exit, red }` is appended from that second answer; when the second answer is a rig red too, the totals are still exactly two `runExam` calls, one `dispatchExaminer` call and two rows. M3. When `enabled` is not `true` and the first `red` is `'rig'`, `runExam` is called exactly once, `dispatchExaminer` zero times, and the one row carries `red: 'rig'`. M4. `examine` calls `selfCheckExam` after the `exam-note` post and before the exam files are read for the implementer clones, with `runExam` running the task's own commands in the exam clone through the module-level `runTaskExams`, `dispatchExaminer` dispatching `role: 'exam'` under the label `'exam:' + task.id + ':rig'` in that same clone and tool server with the exam prompt followed by the `fact`, and `enabled` read from `(policyDoc.exam || {}).rig_red || {}`; `reverifyAfterFold` passes `rigToExam: cell.enabled === true` into `foldRound` off the same cell.

**Authorized-by:** #1245 desired state 1 (the hand-in is checked by a run of the exam at BASE, and a rig red is the examiner's own fix round before any implementer) and desired state 2 (the fold route is switched by the same cell); CLAUDE.md §Doctrine, "A factory worker sees its own task body and nothing else" (the examiner is handed the engine's output, not asked to guess).

**Interfaces:**
- Consumes: `redKind({ exit, out }) -> 'leg' | 'rig' | null`
- Consumes: `rigRound({ attempt, red, enabled }) -> boolean`
- Consumes: `foldRound({ reds, folded, headBefore, head, enabled, hunks, runExamAt, read, appendEvent, reattempt, verify, rigToExam }) -> Promise<{ unresolved, actions }>`
- Produces: `selfCheckExam({ task, runExam, dispatchExaminer, appendEvent, enabled }) -> Promise<{ rows }>`

**Context:** `selfCheckExam` is a module-level export of `factory/engine.mjs` beside `makeRefoldDispatch` — pure over its arguments, no `fs`, no `sh`, no clone — so a sim drives it with fakes exactly as `fleet/tests/test_factory_refold_dispatch.mjs` drives `makeRefoldDispatch`; importing `factory/engine.mjs` runs nothing (its CLI entry is guarded by `invokedDirectly`). Its rule is `rigRound({ attempt: 1, red, enabled })` from `./redkind.mjs` (the module another task of this plan creates, imported as `import { redKind, rigRound } from './redkind.mjs'` beside the other `./` imports): one more round when it answers `true`, never a loop — `rigRound` at `attempt: 2` is `false` by that module's own contract. `fact` is the block the examiner reads: first line `EXAM RIG-RED`, then a sentence saying the engine ran the exam where no implementation exists and it was red for a reason no leg names — fix the rig, not a leg — then `exit <n>` and the last 1500 characters of the output. The call site is `examine(task, anchor)` (around line 1366 at BASE), which clones at `anchor`, builds the exam's tool server, returns early with an `exam:skipped` row for a task with no `proofTests`, reads covering tests, dispatches the examiner (`dispatch({ role: 'exam', label: 'exam:' + task.id, taskId, cwd: examDir, model, systemPrompt: EXAM_MD, files: task.proofTests, mcpServers, prompt: await withHandoff(await examPrompt(task, coveredBlock), task.id) })`), posts the `exam-note`, then reads the exam files off `examDir` into `examFiles` for every implementer clone. The self-check goes between the `exam-note` post and that read: `runExam` is `() => { const r = runTaskExams({ tasks: [task], dir: examDir, sh, timeoutSeconds: DEFAULT_TIMEOUT_SECONDS }); return { exit: r.ran[0].exit, out: r.reds[0] ? r.reds[0].out : '' } }` (`runTaskExams` is the module-level runner `reverifyAfterFold` and `runRefold` already use, answering `{ ran: [{ task, exit }], reds: [{ task, exit, out }] }`), and `dispatchExaminer` is `({ fact }) => dispatch({ role: 'exam', label: 'exam:' + task.id + ':rig', taskId: task.id, cwd: examDir, model, systemPrompt: EXAM_MD, files: task.proofTests, mcpServers, prompt: await withHandoff(await examPrompt(task, coveredBlock) + '\n\n' + fact, task.id) })` after a `board.post(task.id, 'exam-rig', fact)`; `sh`, `appendEvent`, `board`, `dispatch`, `examPrompt`, `withHandoff`, `EXAM_MD`, `model` and `policyDoc` are all in scope inside `runEngine`. Under `speculate.exam_at_zero` (true at BASE) `examine` runs for every task at minute zero in clones of `runBase`, so the self-check is one exam run per task at minute zero — the exam red on the absent implementation, which is the point: a leg red there is the examiner's proof that its rig reaches the seam. A green self-check (`exit: 0`, `red: null`) is recorded and not routed; it is not this plan's question. Whatever the second row reads, implementers go out as today. The shared literals: the row kind `exam:self-check`, the label suffix `:rig`, the block heading `EXAM RIG-RED`, the policy cell `exam.rig_red` with `enabled` (added to `factory/policy.json` by another task of this plan; absent, `cell.enabled === true` is false and both routes are off, which is the rollback). `foldRound` is called once, in `reverifyAfterFold`, with an object literal of eleven keys; `rigToExam` is the twelfth. The sim is pure and new, named for the surface (no sim examines the exam self-check at BASE): it imports `selfCheckExam` from `../../factory/engine.mjs`, writes `runExam` (answering a queue of `{ exit, out }`), `dispatchExaminer` (recording its argument) and `appendEvent` (recording rows) as its own fakes, and records the order of every call in one shared list so M2's ordering is a fact it reads back. A rig answer for the sim is `{ exit: 1, out: 'TypeError: Cannot read properties of undefined (reading "red")' }`, a leg answer `{ exit: 1, out: 'AssertionError [ERR_ASSERTION]: (a) [M1] the row is missing' }`.

**Proof:**
- Test: `fleet/tests/test_factory_exam_selfcheck.mjs`
- Guard: `fleet/tests/test_factory_exam_selfcheck.mjs`
- Legs: (a) a leg answer with `enabled: true`: `runExam` called exactly once, `dispatchExaminer` exactly zero times, `appendEvent` received exactly one row deep-equal to `{ kind: 'exam:self-check', task: '1', attempt: 1, exit: 1, red: 'leg' }` [M1]; (b) two rig answers with `enabled: true`: the shared call list reads exactly `['row', 'dispatch', 'run', 'row']` after the first `run`, `dispatchExaminer` was called exactly once with a `fact` whose text up to the first newline is exactly `EXAM RIG-RED` and which contains `exit 1` and the first answer's `out`, `runExam` was called exactly twice, and the two rows carry `attempt: 1` and `attempt: 2` in that order, both `red: 'rig'` [M2]; (c) a rig answer with `enabled: false`: `runExam` exactly once, `dispatchExaminer` exactly zero times, one row with `red: 'rig'` [M3]; (d) the `Run:` greps below, read against the diff by the reviewer for the placement M4 states [M4].
- Run: grep -q "from './redkind.mjs'" factory/engine.mjs [M4]
- Run: grep -q "':rig'" factory/engine.mjs [M4]
- Run: grep -q "rigToExam" factory/engine.mjs [M4]
- Run: node fleet/tests/test_factory_refold_dispatch.mjs | grep -q 'ALL TESTS PASSED'

**Stale-if:**
- issue-closed: #1245

### Task 4: The examiner's brief says its exam must be red on a leg, and that a rig red comes back to it

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `factory/roles/exam.md`

**Claim:** An examiner reading its brief learns that the redness it hands in must be a leg's — an assertion naming its clause — and that an exam red on its own rig comes back to it, with the engine's output, before any implementer is sent. (derived)
Machine: M1. `factory/roles/exam.md` carries, in this order within one paragraph, the operative halves `red on an assertion`, `names its clause`, `not on the rig`, and names the three rig shapes in order: `exception outside an assertion`, `timeout`, `never reaches the seam`. M2. The same file says, in order, `engine runs your exam`, `before any implementer`, and `comes back to you once`. M3. The paragraphs that stand at BASE keep standing: the file still carries `run_exam`, `simEnv()`, `COVERED:` and `Do not run git commands`, each once or more.

**Authorized-by:** #1245 desired state 1 (the hand-in proves the rig); CLAUDE.md §Conventions, "Judgment prompts are data files" (the role file is the single copy, its size reported and never gated).

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** `factory/roles/exam.md` is 45 lines at BASE and already says "Expect the exam to be red when you run it, and expect that redness to read as the absent implementation rather than as a typo, a bad import, or a fixture you forgot to create." That paragraph is where the new sentences go, replacing its second half with the stronger rule: the engine runs your exam itself when you hand in, where no implementation exists, and reads the red — red on an assertion that names its clause is the hand-in; red on the rig — an exception outside an assertion, a timeout, a helper that never reaches the seam — is not, and comes back to you once, with the engine's output under `EXAM RIG-RED`, before any implementer is sent against your exam. The examiner also learns what the `EXAM RIG-RED` block in a later prompt means and that the fix is to the rig, never to weaken a leg. Style pin: no shouted imperatives (the one surviving role-file pin). The size is reported, not gated: `wc -w` on the file rides the pull request as a design note. Nothing else in the file changes; the three rig shapes and the two route sentences use the exact words the Machine line pins, in that order, so the `Run:` lines below find them.

**Proof:**
- Run: tr '\n' ' ' < factory/roles/exam.md | grep -q 'red on an assertion.*names its clause.*not on the rig.*exception outside an assertion.*timeout.*never reaches the seam' [M1]
- Run: tr '\n' ' ' < factory/roles/exam.md | grep -q 'engine runs your exam.*before any implementer.*comes back to you once' [M2]
- Run: grep -q 'run_exam' factory/roles/exam.md && grep -q 'simEnv()' factory/roles/exam.md && grep -q 'COVERED:' factory/roles/exam.md && grep -q 'Do not run git commands' factory/roles/exam.md [M3]
- Run: wc -w factory/roles/exam.md

**Stale-if:**
- issue-closed: #1245
