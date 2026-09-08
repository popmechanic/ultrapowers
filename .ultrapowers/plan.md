# An examiner cannot kill the fleet by pattern, and a pair-retry keeps its finished half

**Grammar:** claims-v1

**Claim:** An examiner cannot kill the fleet by pattern, and a pair-retry keeps its finished half (elicited)

**Goal:** #762 — the Claim above is the issue's title verbatim, the operator's sentence, signed before
authoring; it is tagged `(elicited)` rather than `(quoted from #762)` because `check_provenance.py`
string-matches a quoted plan-level claim against the issue BODY, which does not carry the title
sentence (author's choice in the operator's stead, 2026-09-08 — the tag flips the day the sentence
is added to the body). Run-34 (#723, sense pass 2026-09-08): the examiner ran
`pkill -f 'node fleet/tests/test_sandbox_boot.mjs'` to clean up a prototype; `fleet/run-worker.mjs`
spawns `[cli, '-p', prompt]` with the whole prompt on argv, and the examiner prompt carries
`TEST COMMAND: node fleet/tests/test_sandbox_boot.mjs`, so the pattern matched the examiner's own
`claude -p` process — worker end `class=sigterm exit=143`, no envelope. `impl:1` had finished 103 s
earlier (`class=success`, patch captured), but `Promise.all([examCall, implCall])` rejects on the
examiner's throw and `runTask`'s catch resets the task clone and re-enters `runTaskInner` whole:
the implementer was re-run from scratch (746 s). Two changes, one wave, either alone a win: the
confine hook refuses the self-matching kill (the worker hands it the TEST COMMAND in the
environment), and the driver's pair retry after a dead examiner keeps a finished implementer and
re-dispatches the examiner alone.
**Closes:** #762

**Tech Stack:** Node 22 ESM (`fleet/*.mjs`). The hook is a pure `decide()` plus a stdin→JSON CLI,
pinned by `fleet/tests/test_confine_hook.mjs`; the engine sims run the real engine below the agent
seam (real git, real clones, real patch capture, the real fold kernel through the real `sh` seam)
with canned judgments — `rig()` of `fleet/tests/_engine_helpers.mjs`, whose repo's suite is
`bash check.sh`; `fleet/tests/test_run_engine_examiner.mjs` has its own `rig()` with a `rolesDir`
seam. The suite is `python3 -m pytest` from the repo root, which bridges every
`fleet/tests/test_*.mjs` through `tests/test_fleet_suite.py` (sentinel `ALL TESTS PASSED`, no
network).

**Exam command:** node {paths}

**Parallelization rationale:** one wave, width 2 — both tasks `Review: peer` (a boundary and a
retry lane: a miss in either is invisible on a green run and costs a live run to see). Task 1 is
the hook and the worker's environment (`fleet/confine-hook.mjs`, `fleet/run-worker.mjs`); Task 2
is the driver's pair lane in `fleet/run-engine.mjs`. The Files blocks are disjoint and neither
consumes a symbol the other produces, so nothing orders them. A sibling plan (#763) edits
`fleet/run-engine.mjs`'s red-suite receipt text and `fleet/tests/test_run_engine*.mjs`
concurrently as a separate run; same-file text folds and Task 2 depends on none of it.

## Global Constraints

- Check: `git diff --quiet $ULTRA_BASE -- skills/ultrapowers/scripts/gate_check.py skills/ultrapowers/scripts/ultra_gate.py skills/ultrapowers/scripts/run_acceptance.sh`
- Check: `git diff --quiet $ULTRA_BASE -- fleet/roles`
- The fix is mechanism, not prose: no role file gains a sentence about `pkill`, and no advisory,
  comment or document this plan touches states a hard cap or a numeric ceiling.
- The hook stays fail-closed and its verdicts at BASE stand: every assertion in
  `fleet/tests/test_confine_hook.mjs` at BASE still holds, a quoted `pkill` inside a string is data
  (the #475 masking rule), and a kill that names a pid is not the hook's business.
- The implementer's own retry ladder is unchanged: an implementer that throws, returns `null`
  (`AGENT_NULL`) or loses its coordinates takes exactly the lane it takes at BASE; only the
  dead-examiner-beside-a-finished-implementer case gets a new lane.
- The worker env gains one variable, `FLEET_TEST_CMD`, and nothing else; every other key of the
  child environment is what BASE passes.

**Acceptance:** suite — the committed suite is the verification.

### Task 1: The confine hook refuses a kill pattern that would match the worker itself

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/confine-hook.mjs`
- Modify: `fleet/run-worker.mjs`
- Test: `fleet/tests/test_confine_hook.mjs`
- Test: `fleet/tests/test_run_worker.mjs`

**Claim:** the confine hook refuses a Bash command whose argv contains `pkill -f`/`killall` with a pattern that matches a role prompt's TEST COMMAND (or any `claude` process) — the reason names the self-match (quoted from #762)
Machine: M1. With `FLEET_TEST_CMD` set to `node fleet/tests/test_sandbox_boot.mjs` in the
hook's environment, `decide()` on a `Bash` tool input returns a `deny` for each of
`pkill -f 'node fleet/tests/test_sandbox_boot.mjs'`, `pkill -9 -f test_sandbox_boot`,
`killall -q test_sandbox_boot.mjs`, `pkill -f 'fleet/tests/.*\.mjs'` and
`true; pkill -f test_sandbox_boot` — the last a kill that is not the command's first word — and
each reason contains the offending pattern, the string `TEST COMMAND` and the string `claude -p`
— the pattern is tried as a regular expression against the value of `FLEET_TEST_CMD`, or as a
literal substring when it is not a valid regular expression, and the kill is found wherever it
sits in the command, not only as its first word.
M2. Both with `FLEET_TEST_CMD` set as in M1 and with it absent from the environment, `decide()`
returns a `deny` whose reason contains `claude` for each of `pkill -f claude`, `pkill claude` and
`killall claude`, and, with it set as in M1, for `echo x && pkill -f claude` and
`cd /tmp; killall claude` — the `claude` target is tried on every kill pattern, not only when no
TEST COMMAND is known, and a kill after `&&`, `;` or a `cd` is found as one at the head is.
M3. With `FLEET_TEST_CMD` set as in M1, `decide()` returns `allow` for each of
`pkill -f my-proto-server`, `kill 1234`, `kill -TERM 1234`, `pkill -f prototype && echo done` and
`echo "pkill -f claude"` — a pattern matching neither the TEST COMMAND nor `claude`, a kill by
pid, and a quoted `pkill` that is data.
M4. The hook CLI, fed the M1 `pkill -f` input on stdin with `FLEET_TEST_CMD` and `FLEET_RUN_DIR`
in its environment, prints a `hookSpecificOutput.permissionDecision` of `deny` whose
`permissionDecisionReason` is the M1 reason, and appends one line to
`<FLEET_RUN_DIR>/confine-denials.jsonl` whose `reason` is that same string.
M5. `createRunWorker`'s spawn of the CLI passes a child environment whose `FLEET_TEST_CMD` is
the value of the prompt's first `TEST COMMAND:` line (`node fleet/tests/test_sandbox_boot.mjs`
for a prompt carrying `TEST COMMAND: node fleet/tests/test_sandbox_boot.mjs`), and a prompt with
no `TEST COMMAND:` line spawns a child whose environment has no `FLEET_TEST_CMD` key.

**Authorized-by:** #762 (bug, fleet); #723 run-34's record; the hook's own contract
(`fleet/confine-hook.mjs` header: the boundary for the enumerable, statically resolvable forms).

**Interfaces:**
- Consumes: none
- Produces: `FLEET_TEST_CMD`

**Context:** The hook cannot see the prompt — it reads the PreToolUse JSON on stdin
(`{tool_name, tool_input, cwd}`) and its own environment, which Claude Code inherits from the
worker process. So the worker is what tells it: `createRunWorker` in `fleet/run-worker.mjs`
already reads the prompt for the `FILES:` line (`fleet/run-waves.mjs:419`, the
`/^FILES:[ \t]*(.+)$/m` fallback) and builds the child from `runProcess({ cli, argv, cwd, env,
prompt, … })` at line 828, spawning `spawnFn(cli, ['-p', prompt].concat(argv), { cwd, env, … })`
at 925 with the run-wide `env` object. The engine's line is `testCmdLine` in
`fleet/run-engine.mjs:222` — `'\nTEST COMMAND: ' + cmd`, one line, the value to end of line —
so the per-dispatch env is `{ ...env, FLEET_TEST_CMD: <that value> }` and, for a prompt without
the line, `env` with no such key (delete it rather than pass an empty string, so a stale value
from the run-wide env cannot leak into a reviewer's hook). A `spawnFn` stub receives that env as
its third argument's `env`, which is how a leg reads it without a real CLI. In
`fleet/confine-hook.mjs`, the `Bash` branch of `decide()` starts at line 223 and the tokenizer
at 178–201 already yields `tok[i].m` (the masked text: a quoted `pkill` is NUL bytes, never the
command) and `tok[i].o` (the original): the kill check reads the command token from `.m` and
the pattern from `.o`, scans every token of the command for `pkill`/`killall` (or a `/pkill`
path tail) — a kill after `&&`, `;`, `|` or a leading `cd` is the same kill — and for each one
walks the tokens after it up to the next `|`, `;` or `&` token, treats tokens starting with `-` as flags, and takes the rest as
patterns; `pkill` without `-f` matches process names only, so its pattern is tried against
`claude` alone, while `pkill -f` and `killall` are tried against both `claude` and
`FLEET_TEST_CMD`. A pattern "matches" when `new RegExp(pattern).test(target)` is true, or, when
the constructor throws, when `target.includes(pattern)`. The deny string is what the model reads
back, so it must say why: something like `confine-hook: pkill -f '<pattern>' would match this
worker's own claude -p process — its argv carries the prompt, TEST COMMAND included (<value>).
Kill by pid (kill <pid>) instead.` The deny path is otherwise the existing one: the CLI emits
the decision JSON and appends `{ts, source: 'hook', tool, reason}` to
`<FLEET_RUN_DIR>/confine-denials.jsonl` — M4 asserts nothing new about that machinery, only
that the new reason rides it. The conceded residual, stated as the hook's header states its
others: a pattern that matches some other line of the prompt (a FILES path, a word of the task
body) still matches the argv and is not caught — the TEST COMMAND is the line run-34 died on and
the one the worker can name; the VM is the backstop for the rest. `fleet/tests/test_confine_hook.mjs`
runs the CLI with a `baseEnv` that strips `FLEET_RUN_DIR` (line 150) and sets env per call; the
`decide()` legs toggle `process.env` inside a try block with a finally as the `FLEET_RUN_DIR` block at
109–140 does. No existing test names `pkill` or `killall` (`git grep` over `fleet/`, `skills/`,
`tests/` at BASE finds none), so no pin of the old allow exists to own.
**BASE facts:** (generated at d26bbdc)
- `claude` at `fleet/tests/test_doctor.mjs:462` blob 0f9de8d
- `deny` at `fleet/tests/test_confine_hook.mjs:169` blob 05bbf3e
- `reason` at `fleet/run-engine.mjs:634` blob 3148252
- `createRunWorker` at `fleet/run-worker.mjs:750` blob da08fc7
- `fleet/confine-hook.mjs` blob e0cd408
- `fleet/run-worker.mjs` blob da08fc7
- `fleet/run-waves.mjs:419` blob 27f25b5 line 419 `const m = /^FILES:[ \t]*(.+)$/m.exec(String(prompt == null ?`
- `env` at `fleet/launch.mjs:616` blob 6150d59
- `testCmdLine` at `fleet/run-engine.mjs:222` blob 3148252
- `fleet/run-engine.mjs:222` blob 3148252 line 222 `const testCmdLine = (task, testCmd) => {`
- `spawnFn` at `fleet/tests/test_run_main.mjs:194` blob ef647cb
- `fleet/tests/test_confine_hook.mjs` blob 05bbf3e
- `baseEnv` at `fleet/run-engine.mjs:479` blob 3148252

**Proof:**
- Test: `fleet/tests/test_confine_hook.mjs`
- Test: `fleet/tests/test_run_worker.mjs`
- Legs (in `fleet/tests/test_confine_hook.mjs` through the CLI leg, then in
  `fleet/tests/test_run_worker.mjs` for the three `createRunWorker` legs): (a) with `FLEET_TEST_CMD` set to `node fleet/tests/test_sandbox_boot.mjs`,
  `pkill -f 'node fleet/tests/test_sandbox_boot.mjs'` yields a verdict with `deny` and no `allow`,
  the reason containing `node fleet/tests/test_sandbox_boot.mjs`, `TEST COMMAND` and `claude -p`
  [M1]; (b) same env, `pkill -9 -f test_sandbox_boot` yields `deny` and no `allow`, the reason
  containing `test_sandbox_boot`, `TEST COMMAND` and `claude -p` [M1]; (c) same env,
  `killall -q test_sandbox_boot.mjs` yields `deny` and no `allow`, the reason containing
  `test_sandbox_boot.mjs`, `TEST COMMAND` and `claude -p` [M1]; (d) same env,
  `pkill -f 'fleet/tests/.*\.mjs'` — a pattern that is only a regular-expression match — yields
  `deny` and no `allow`, the reason containing `fleet/tests/.*\.mjs`, `TEST COMMAND` and
  `claude -p` [M1]; (e) with `FLEET_TEST_CMD` set to `node test_sandbox_boot.mjs (x`,
  `pkill -f 'test_sandbox_boot.mjs (x'` — an unbalanced parenthesis, not a valid regular
  expression, so the literal fallback is the only match — yields `deny` and no `allow`, the
  reason containing `test_sandbox_boot.mjs (x`, `TEST COMMAND` and `claude -p` [M1];
  (f) same env as the first leg, `true; pkill -f test_sandbox_boot` — the kill after a `;`,
  not the command's first word — yields `deny` and no `allow`, the reason containing
  `test_sandbox_boot`, `TEST COMMAND` and `claude -p` [M1];
  (g) with `FLEET_TEST_CMD` deleted from `process.env`, `pkill -f claude` yields `deny` and no
  `allow`, the reason containing `claude` [M2]; (h) same env, `pkill claude` yields `deny` and
  no `allow`, the reason containing `claude` [M2]; (i) same env, `killall claude` yields `deny`
  and no `allow`, the reason containing `claude` [M2]; (j) with `FLEET_TEST_CMD` set to
  `node fleet/tests/test_sandbox_boot.mjs` — the value the worker sets on every live dispatch,
  and one that `claude` does not match — `pkill -f claude` yields `deny` and no `allow`, the
  reason containing `claude` [M2]; (k) same env, `pkill claude` yields `deny` and no `allow`,
  the reason containing `claude` [M2]; (l) same env, `killall claude` yields `deny` and no
  `allow`, the reason containing `claude` [M2]; (m) same env, `echo x && pkill -f claude` — the
  kill after `&&` — yields `deny` and no `allow`, the reason containing `claude` [M2]; (n) same
  env, `cd /tmp; killall claude` — the kill after a `cd` and a `;` — yields `deny` and no
  `allow`, the reason containing `claude` [M2]; (o) with `FLEET_TEST_CMD` set as in the first
  leg, `pkill -f my-proto-server` yields `allow` and no `deny` [M3]; (p) same env, `kill 1234`
  yields `allow` and no `deny` [M3]; (q) same env, `kill -TERM 1234` yields `allow` and no
  `deny` [M3]; (r) same env, `pkill -f prototype && echo done` yields `allow` and no `deny`
  [M3]; (s) same env, `echo "pkill -f claude"` yields `allow` and no `deny` [M3]; (t) the CLI,
  run with the first leg's input on stdin and both variables in its env against a fresh temp
  run dir, prints `permissionDecision` `deny` with a `permissionDecisionReason` equal to the
  `deny` string `decide()` returns for the same input under the same env, and leaves exactly
  one line in that dir's `confine-denials.jsonl` whose `reason` equals that same string [M4];
  (u) `createRunWorker` with a `spawnFn` stub that records its options and returns a fake child
  emitting a success envelope: a prompt carrying `TEST COMMAND: node fleet/tests/test_sandbox_boot.mjs`
  spawns with `env.FLEET_TEST_CMD` equal to `node fleet/tests/test_sandbox_boot.mjs` [M5];
  (v) the same worker, a prompt whose line `TEST COMMAND: bash first.sh` precedes a later line
  `TEST COMMAND: bash second.sh` spawns with `env.FLEET_TEST_CMD` equal to `bash first.sh` [M5];
  (w) the same worker, created with an `env` whose `FLEET_TEST_CMD` is `stale`, spawns a prompt
  with no `TEST COMMAND:` line with an `env` on which `hasOwnProperty('FLEET_TEST_CMD')` is
  false [M5].
- Run: node fleet/tests/test_confine_hook.mjs | grep -q 'ALL TESTS PASSED'
- Run: node fleet/tests/test_run_worker.mjs | grep -q 'ALL TESTS PASSED'

**Stale-if:**
- path-absent: `fleet/confine-hook.mjs`
- path-absent: `fleet/run-worker.mjs`
- issue-closed: #762

### Task 2: A dead examiner beside a finished implementer re-dispatches the examiner alone

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/run-engine.mjs`
- Test: `fleet/tests/test_run_engine_examiner.mjs`

**Claim:** the driver's retry after a dead examiner re-dispatches the examiner only when the implementer of the same pair ended `success` with its patch captured, keeping the captured patch (quoted from #762)
Machine: M1. On a one-task run whose `exam:<id>` dispatch rejects with a `WORKER_SIGTERM` error
before `impl:<id>` has returned, and whose `impl:<id>` then resolves `DONE` with a
driver-captured `patch` and `headSha`, the driver dispatches `exam:<id>` exactly twice and
`impl:<id>` exactly once in the whole run, the second `exam:<id>` prompt equals the first and
its clone `exam-<id>` holds no file the first examiner left, the `review:<id>:1` prompt's patch
carries the hunk the one implementer wrote, the graded clone's Proof path holds the bytes the
second examiner wrote, and the row ends `status` `done` with `exam` `red`.
M2. When the second `exam:<id>` dispatch rejects too, no third is made, `impl:<id>` is still
dispatched once, the row ends `done` with `exam` `blocked`, and `report.judgmentCalls` has an
entry that starts `task <id>: examiner` and contains `proceeds unexamined`.
M3. When `exam:<id>` and `impl:<id>` both reject with `WORKER_SIGTERM` on their first dispatch,
the lane at BASE stands: `impl:<id>` and `exam:<id>` are each dispatched twice, and
`report.judgmentCalls` has an entry containing `retrying once at`.
M4. On the M1 run, `report.judgmentCalls` has exactly one entry that starts
`task <id>: examiner died` and contains `re-dispatching the examiner alone`, and
`<runDir>/events.jsonl` has exactly one line whose `kind` is `driver:exam-redispatch` with
`task` `<id>`; on a run whose examiner returns `DONE` first time, no entry and no such line.
M5. When `exam:<id>` rejects with `WORKER_SIGTERM` on its first dispatch and `impl:<id>` then
resolves with `status` `BLOCKED` — a reply that is not a kept one — the lane at BASE stands:
`impl:<id>` and `exam:<id>` are each dispatched twice, `report.judgmentCalls` has no entry
containing `re-dispatching the examiner alone`, and `<runDir>/events.jsonl` has no line whose
`kind` is `driver:exam-redispatch` — the examiner-alone lane opens only on a kept implementer
reply, never on an implementer that merely returned.

**Authorized-by:** #762 (bug, fleet); #723 run-34's record; #653 (the pair — two clones, one
handoff, awaited neither before the other).

**Interfaces:**
- Consumes: none
- Produces: nothing a sibling consumes — the new event kind and judgment call are read by the exam and the operator, never by a task

**Context:** The seam, by line in `fleet/run-engine.mjs` at BASE `d26bbdc`: `runTaskInner`
builds the pair at 1141–1149 — `examCall` (null when `examReady` is false) and `implCall`, then
`const [ex, implReply] = await Promise.all([examCall, implCall])`. A worker that dies at exit
143 leaves `agent()` by a throw (`fleet/run-worker.mjs`'s default case: `WORKER_SIGTERM: SIGTERM:
killed with no envelope (exit 143)`, with `workerVerdict` and `label` attached), so `Promise.all`
rejects the moment the examiner does — while `implCall` may still be running, un-awaited — and
the rejection climbs to `runTask` (1608–1648), whose catch classifies the message
(`isInfraFault` → park; `isSchemaTrip` → escalate; else same tier), runs
`resetTaskClone(task.id, baseShaForTask)` (962: `git reset --hard` + `git clean -fdq` on
`task-<id>`) and re-enters `runTaskInner` whole, which re-cuts `exam-<id>` and dispatches BOTH
labels again. That is run-34's lost 746 s. The new shape settles both halves before deciding:
await each of the pair to a `{ok, value | error}` record (`Promise.allSettled` or an equivalent
wrapper), then — if the implementer rejected, rethrow its error and the lane at BASE runs
unchanged (M3); if the examiner rejected and the implementer's reply is not a kept one, rethrow
the examiner's error (the pair lane, as at BASE); if the examiner rejected and the implementer's
reply IS a kept one — `impl.status` is `DONE` or `DONE_WITH_CONCERNS` and `hasCoordinates(impl)`
(951: `r.headSha && r.patch`, set by `withPatchCapture` from the task clone against BASE) —
push the judgment call, append the event, re-cut `exam-<id>` exactly as the `examReady` closure
at 1071–1096 does (`fs.rmSync` + `cloneAtBase` from `cloneSourceFor(baseShaForTask)` + the
`bootstrapCmd`), and dispatch `exam:<id>` once more with the same prompt and options; a second
rejection is caught and leaves `ex` `null`, which the verdict block at 1182–1193 already reads
as `examiner returned no reply — no exam recorded; the implementer proceeds unexamined` with
`exam = 'blocked'`. `impl === null` (an `AGENT_NULL` reply) is still thrown at 1151 before any of
this and still parks. The run-worker already supports a second dispatch of one label: attempt 2
derives its session id from `<label>#2` and its evidence dir is `<label>.2` (run-55's lesson,
`fleet/run-worker.mjs` `dispatched`), so nothing there changes. The judgment call names the
death and the decision in one line — `task <id>: examiner died (<message>) — the implementer
ended success with its patch captured; re-dispatching the examiner alone` — and the event is
`{ kind: 'driver:exam-redispatch', task: <id>, detail: <message> }` through `appendEvent`
(705), whose sink is `<runDir>/events.jsonl`. The `withPatchCapture` wrapper captures on every
worktree dispatch, so the examiner's second attempt overwrites `exam-<id>.patch` and never
`task-<id>.patch`; the implementer's captured patch is the object the driver already holds in
`impl.patch` and is retaken at the handoff (1230–1245) from the untouched `task-<id>` clone —
"keeping the captured patch" is the absence of `resetTaskClone` and of a second `impl:<id>`.
For the sims: `fleet/tests/test_run_engine_examiner.mjs`'s own `rig()` (lines 41–70) threads
`rolesDir` and returns `{ run, base, repo, runDir, clonesDir, patchesDir, integ }`; its stub
receives `(prompt, opts, cwd)` and may throw — a thrown
`Object.assign(new Error('WORKER_SIGTERM: SIGTERM: killed with no envelope (exit 143)'),
{ workerVerdict: { outcome: 'retry', class: 'sigterm' }, label })` is what the real worker
throws. `test_run_engine_exam_together.mjs` (150–190) shows the deferred-promise shape for
"the examiner rejects before the implementer returns": hold the implementer's reply behind a
promise the examiner's throw resolves. The examiner sim's `entry()` (72–83) carries `testCmd:
'bash t1_test.sh'` and `proofTests: ['t1_test.sh']`; `examOk(cwd)` writes the red-at-BASE exam;
`doneImpl(cwd)` is the implementer's canned reply. The review prompt reaches the stub as
`prompt` on the `review:T1:1` dispatch and carries the patch text. No sim at BASE dispatches an
examiner that throws (`git grep` over `fleet/tests/` for `WORKER_SIGTERM` finds only
`test_run_worker.mjs`'s classifier legs), so no pin of the whole-pair retry after an examiner
death exists to own; `test_run_engine_examiner.mjs`'s existing legs on a `BLOCKED` examiner
(the `task T1: examiner` judgment call, `exam` `blocked`) stand and M2 reuses their wording.
The sibling plan for #763 edits this file's red-suite receipt text in another region
concurrently; nothing here reads it.
**BASE facts:** (generated at d26bbdc)
- `patch` at `fleet/run-engine.mjs:1578` blob 3148252
- `headSha` at `fleet/run-engine.mjs:1828` blob 3148252
- `status` at `fleet/claude-token.mjs:358` blob b7e8e7b
- `done` at `fleet/run-worker.mjs:953` blob da08fc7
- `exam` at `fleet/publish-fold.mjs:160` blob 6797792
- `red` at `fleet/publish-fold.mjs:876` blob 6797792
- `blocked` at `fleet/run-engine.mjs:1685` blob 3148252
- `kind` at `fleet/lobby.mjs:418` blob 62d348b
- `task` at `fleet/run-engine.mjs:1943` blob 3148252
- `fleet/run-engine.mjs` blob 3148252
- `runTaskInner` at `fleet/run-engine.mjs:980` blob 3148252
- `examCall` at `fleet/run-engine.mjs:1141` blob 3148252
- `examReady` at `fleet/run-engine.mjs:1071` blob 3148252
- `implCall` at `fleet/run-engine.mjs:1146` blob 3148252
- `fleet/run-worker.mjs` blob da08fc7
- `runTask` at `fleet/run-engine.mjs:1608` blob 3148252
- `isInfraFault` at `fleet/run-engine.mjs:74` blob 3148252
- `isSchemaTrip` at `fleet/run-engine.mjs:70` blob 3148252
- `withPatchCapture` at `fleet/run-waves.mjs:192` blob 27f25b5
- `cloneAtBase` at `fleet/run-waves.mjs:61` blob 27f25b5
- `bootstrapCmd` at `fleet/run-engine.mjs:769` blob 3148252
- `ex` at `fleet/tests/test_claude_token.mjs:184` blob 15a4988
- `dispatched` at `fleet/run-worker.mjs:778` blob da08fc7
- `appendEvent` at `fleet/run-engine.mjs:705` blob 3148252
- `resetTaskClone` at `fleet/run-engine.mjs:962` blob 3148252
- `fleet/tests/test_run_engine_examiner.mjs` blob 11dea88
- `rolesDir` at `fleet/tests/test_exam_edited_patches.mjs:31` blob 628c82c
- `prompt` at `fleet/tests/probe_addcwd_scope.mjs:57` blob b43a48c
- `T1` at `fleet/tests/test_publish_fold.mjs:233` blob a98efe7

**Proof:**
- Test: `fleet/tests/test_run_engine_examiner.mjs`
- Legs: (a) a stub whose first `exam:T1` call throws `WORKER_SIGTERM` immediately and whose
  `impl:T1` writes `one.txt` and returns after the throw: the dispatched labels count
  `exam:T1` twice and `impl:T1` once, the two exam prompts are equal, the second exam's clone
  holds no `left-behind` file the first stub attempt wrote, the `review:T1:1` prompt contains
  `from T1`, `<clonesDir>/task-T1/t1_test.sh` equals the second examiner's bytes, and the row is
  `done` with `exam` `red` [M1]; (b) a stub whose `exam:T1` throws on both calls: three
  `exam:T1` dispatches never happen, `impl:T1` is dispatched once, the row is `done` with
  `exam` `blocked`, and a judgment call starts `task T1: examiner` and contains
  `proceeds unexamined` [M2]; (c) a stub whose first `exam:T1` and first `impl:T1` both throw
  `WORKER_SIGTERM` and whose second calls succeed: `impl:T1` and `exam:T1` each counted exactly
  twice — neither once nor three times — no judgment call contains `re-dispatching the examiner
  alone`, and a judgment call contains `retrying once at` [M3]; (d) on the (a) run, exactly one judgment
  call starts `task T1: examiner died` and contains `re-dispatching the examiner alone`, and
  `<runDir>/events.jsonl` parsed line by line has exactly one `driver:exam-redispatch` with
  `task` `T1`; on a run whose examiner returns `DONE` first time, zero of each [M4]; (e) a
  stub whose first `exam:T1` throws `WORKER_SIGTERM` and whose first `impl:T1` writes nothing
  and returns `{status: 'BLOCKED', summary: 'cannot'}` after the throw, and whose second calls
  succeed as (c)'s do: `impl:T1` and `exam:T1` each counted exactly twice, no judgment call
  contains `re-dispatching the examiner alone`, and `<runDir>/events.jsonl` parsed line by
  line has zero `driver:exam-redispatch` lines [M5].
- Run: node fleet/tests/test_run_engine_examiner.mjs | grep -q 'ALL TESTS PASSED'
- Run: node fleet/tests/test_run_engine_exam_together.mjs | grep -q 'ALL TESTS PASSED'
- Run: node fleet/tests/test_run_engine.mjs | grep -q 'ALL TESTS PASSED'

**Stale-if:**
- path-absent: `fleet/run-engine.mjs`
- path-absent: `fleet/tests/test_run_engine_examiner.mjs`
- issue-closed: #762
