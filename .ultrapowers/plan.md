# A worker that dies before its first token says why, a reconcile with no reply is asked once more, a schema trip and a role are read off values rather than wording, and the driver's shell sees the sandbox toolchain first (#1054, #410, #1051)

**Grammar:** claims-v1

**Claim:** do: run a plan on the fleet; see: a worker that died before its first token says why on the record, a reconcile that produced no reply is asked once more before the epoch is blocked, a schema trip is escalated on the worker's own verdict class and a worker's role is the one its dispatch declared — never read off the wording of a message or a label — and every command the driver runs sees the sandbox's toolchain first on its PATH. (elicited)
**Summary:** This plan closes three holes in the seam between the engine and its workers, each one seen on a real run: a reconcile worker that died silently and took the epoch with it (run-20), two decisions still made by matching prose that a rename would break without a sound, and an npm package that shadowed the sandbox's own Bun under the suite. It exists because each of those turned a green-looking run into a parked one with nothing on the record to say why. After it, the record names why a worker died, the epoch gets one more chance before it is blocked, the escalation lever and the worker's role are values the code declares, and the driver's commands find the sandbox's toolchain before anything a package install dropped into the tree.

**Goal:** Close #1054 (a typed reason on `worker:end` for a death before the first token; one retry of the reconcile dispatch on a no-reply before the epoch is blocked), #410 (read `workerVerdict.class` off the thrown error instead of `isSchemaTrip`'s regex; declare `role` at dispatch instead of deriving it from the label's prefix) and the engine half of #1051 (the driver's shell commands see the sandbox toolchain directory first on `PATH`).
**Closes:** #1054 #410 #1051

**Tech Stack:** Node ESM (`fleet/run-engine.mjs`, `fleet/run-worker.mjs`), engine sims under `fleet/tests/test_*.mjs` bridged by `tests/test_fleet_suite.py`.

**Spec:** none — the three issues are the signed input: #1054, #410 and #1051, each read with its comments on 2026-09-16.

**Parallelization rationale:** one wave of width 5. Every task is its own contract on a distinct region of the seam: the worker's `worker:end` envelope (Task 1), the engine's reconcile round (Task 2), the engine's retry-tier decision (Task 3), the dispatch-site role declaration across both files (Task 4) and the engine's shell adapter (Task 5). Four tasks modify `fleet/run-engine.mjs`, three modify `fleet/run-worker.mjs` and four touch `fleet/CONTRACT.md`; those are text edits in separate regions and fold at the epoch. The one adjacent pair is Task 2 and Task 4, which both edit the reconcile dispatch's option object (`fleet/run-engine.mjs` ~4682 at BASE): Task 2 wraps the call, Task 4 adds one `role:` key to its options — the fold's resolver is the measurement if they collide, per the doctrine. No task consumes a sibling's runtime behaviour, so no chain.

## Global Constraints

- Check: git diff --quiet $ULTRA_BASE -- fleet/roles/
- Check: node fleet/tests/test_sims_are_hermetic.mjs | grep -q 'ALL TESTS PASSED'
- Findings are about the result — what the tree, the record and the sims now do — never about the order the work was done in, the number of commits, or whether a test was written before its code.
- No sim under `fleet/tests/` names a sibling `test_*.mjs` or `pytest` in a spawn; every spawn passes an env derived from `simEnv`; imports are written for `fleet/tests/` depth (`../run-engine.mjs`, `./_helpers.mjs`).
- A field added to an event the engine or the worker appends to `events.jsonl` is named in `fleet/CONTRACT.md` in the same task that adds it.

### Task 1: A death before the first token carries a typed reason on `worker:end`

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/run-worker.mjs`
- Modify: `fleet/CONTRACT.md`
- Test: `fleet/tests/test_worker_end_reason.mjs`

**Claim:** do: read the record of a worker that exited without ever reaching the model; see: its `worker:end` line says which of two things happened — the process never started, or it ran and exited with no reply — with the exit code or errno and the last of what it wrote to stderr. (derived)
Machine: M1. Every `worker:end` event `createRunWorker`'s `agent()` emits carries a `reason` key: `null` when a result envelope was read off the child's stdout, and otherwise an object `{ kind, code, stderr }`. M2. `kind` is `spawn-error` when the child's `error` event fired before any `close` (the process never started), with `code` the error's `code` string (`E2BIG`, `ENOENT`, …); `kind` is `no-envelope` when the child ran and closed with no result envelope on stdout, with `code` the exit code as a number. M3. `stderr` is the last 400 characters of what the child wrote to stderr, `''` when it wrote nothing. M4. The error `agent()` throws for such a dispatch carries the same object at `workerVerdict.reason`. M5. `fleet/CONTRACT.md` names `reason` on `worker:end` with both kinds, `spawn-error` and `no-envelope`.

**Authorized-by:** #1054 (question 1: "a claude -p that died before its first token … should be a typed event, not a silent exit 1"); #1051 §Desired state 3 ("The reconcile worker's instant failure carries a reason on `worker:end`")

**Interfaces:**
- Consumes: none
- Produces: `worker:end.reason` — `null | { kind: 'spawn-error' | 'no-envelope', code: string | number, stderr: string }`

**Context:** The shape at BASE: `runProcess` (`fleet/run-worker.mjs` ~1097–1141) resolves `{ exitCode, stdout, stderr, timedOut }`; a spawn `error` is folded into `stderr` and exits `127`, so the two deaths are indistinguishable downstream today. `classify` (~426) answers `{ outcome: 'fail-task', class: 'no-envelope', detail: 'no result envelope on stdout (exit N)' }` for any dispatch with no envelope, and the `worker:end` at ~997 carries `outcome/class/status/trace/meter` and nothing about why. Run-20's `reconcile:wave1:1` on tinyapp-fixture ended `exitCode 1, class error, meter all zeros` in ~1 s, and nothing on the event said whether the bearer, the stdin prompt, an `E2BIG` or a lobby fault killed it (n=1, run-20, 2026-09-16). The 400-character cap is the same tail `gitOf` keeps for a git failure (`.slice(-400)` at ~1150). A `sigterm`/timeout death (`exitCode 143`) is a `no-envelope` reason with `code` `143` — it is not a third kind. The sandbox projection (`fleet/sandbox-boot.sh` `project`) and the hub mirror post the `worker:end` line verbatim, so nothing else needs to learn the key. The event's other keys are unchanged; `classify`'s exported signature is not pinned here — the exam reads the event and the thrown error, through a `spawnFn` stub, exactly as `fleet/tests/test_worker_prompt_stdin.mjs` drives the worker.

**Proof:**
- Test: `fleet/tests/test_worker_end_reason.mjs`
- Guard: `fleet/tests/test_worker_end_reason.mjs`
- Legs: (a) a `spawnFn` stub whose child writes `boom` to stderr, nothing to stdout, and closes with code `1`: `await agent(prompt, opts)` rejects, the last `worker:end` event carries `reason` deep-equal to `{ kind: 'no-envelope', code: 1, stderr: 'boom' }` [M1, M2, M3]; (b) on that same dispatch the rejection's `workerVerdict.reason` is deep-equal to the event's `reason` [M4]; (c) a stub whose child emits an `error` event carrying `code: 'E2BIG'` and never `close`s on its own: the `worker:end` `reason.kind` is `spawn-error` and `reason.code` is `'E2BIG'` [M2]; (d) a stub whose child writes 1,000 distinct characters to stderr and closes `1`: `reason.stderr` has length 400 and equals the last 400 of what was written [M3]; (e) a stub that writes nothing to stderr and closes `2`: `reason` is `{ kind: 'no-envelope', code: 2, stderr: '' }` [M2, M3]; (f) a stub that prints a success envelope and closes `0`: `reason` is exactly `null` and `agent()` resolves [M1]; (g) a stub that prints an envelope and closes `1` with `is_error` true: `reason` is `null` — an envelope was read, so the class says what happened and no reason is invented [M1]; (h) the two `Run:` greps below, one per kind, exit 0 against `fleet/CONTRACT.md` [M5].
- Run: grep -q "spawn-error" fleet/CONTRACT.md
- Run: grep -q "no-envelope" fleet/CONTRACT.md

**Stale-if:**
- issue-closed: #1054
- path-absent: `fleet/run-worker.mjs`

### Task 2: A reconcile that produced no reply is dispatched once more before the epoch is blocked

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/run-engine.mjs`
- Modify: `fleet/CONTRACT.md`
- Test: `fleet/tests/test_run_engine_reconcile_retry.mjs`

**Claim:** do: fold a wave whose candidate suite is red and whose reconcile worker dies without answering; see: the driver asks a fresh reconcile worker the same question once more, records that it did, and only blocks the epoch when the second one has no reply either. (derived)
Machine: M1. In the wave-fold's reconcile round, a dispatch whose reply is `null`, or whose call threw an error not beginning `RUN_FATAL`, is dispatched a second time with a byte-identical prompt and the same `label`, `model` and `schema` before the attempt is read as no reply. M2. The second dispatch's reply, when it is an object, is the attempt's reply — a `FIXED` there is committed and the suite re-run exactly as a first-dispatch `FIXED` is at BASE. M3. A second no-reply ends the round as at BASE: the `judgmentCalls` entry `wave <n>: reconcile attempt <a> produced no reply` and the epoch's `TEST_FAILED` route, with no third dispatch. M4. Each re-dispatch appends one `driver:reconcile-retry` event `{ wave, attempt, class }` to `events.jsonl` — `class` the thrown error's `workerVerdict.class` when it carries one, `null` for a `null` reply — and one `judgmentCalls` entry `wave <n>: reconcile attempt <a> produced no reply (<class>) — re-dispatched once`. M5. A first dispatch whose reply is an object, or whose throw begins `RUN_FATAL`, is never re-dispatched. M6. `fleet/CONTRACT.md` names `driver:reconcile-retry` with its three keys.

**Authorized-by:** #1054 (question 2: "whether the driver retries once on 'no reply' (as it does on a schema trip) before parking")

**Interfaces:**
- Consumes: none
- Produces: `driver:reconcile-retry` — event `{ wave, attempt, class }`

**Context:** The loop at BASE (`fleet/run-engine.mjs` ~4675–4718): `for (attempt = 1; attempt <= 2 && suite.code !== 0; …)` dispatches `reconcile:wave<n>:<attempt>` with `model: TIER.mostCapable, schema: RECONCILE_SCHEMA`; a throw not beginning `RUN_FATAL` becomes `rec = null`, and `if (!rec || rec.status !== 'FIXED') { judgmentCalls.push(… ' produced no reply'); break }` — so attempt 2 is reached only after a `FIXED` attempt 1 whose suite stayed red, and a dead worker on attempt 1 blocks the epoch at once. That is what run-20 paid: `reconcile:wave1:1` exited 1 with zero tokens, `BLOCKED`, tasks 2–5 never dispatched (n=1, run-20, 2026-09-16). The re-dispatch is immediate — no backoff: the infra lane's `INFRA_BACKOFF_MS` (`retryInfraNull`, ~2296) is the answer to an overloaded API, and a reconcile is one worker per epoch, not a storm. The re-dispatch keeps the label; the worker derives the second attempt's session id and evidence directory (`<label>.2`) from its own per-label `dispatched` count, so nothing here renames it. The `class` on the event is read off the caught error's `workerVerdict` — the worker attaches `{ workerVerdict, label }` to every non-fatal throw (~1070); a sim's stub throws an `Error` with that property assigned. A `BLOCKED` reply is an object and is read as at BASE, never retried. The `judgmentCalls` literal for the retry entry is exact; the BASE literal ` produced no reply` for the final no-reply stays byte-identical so `test_run_engine_ready_set.mjs`'s and `test_run_engine_lockfile_regen.mjs`'s canned-`BLOCKED` routes are untouched (neither exercises a no-reply). The exam's run shape is the rig's one-task run whose `check.sh` goes red after the implementer's write, as `fleet/tests/test_run_engine_ready_set.mjs` provokes the reconcile route; `report.waveMerges[].status` is `TEST_FAILED` for the blocked epoch and `MERGED` for an adopted one.

**Proof:**
- Test: `fleet/tests/test_run_engine_reconcile_retry.mjs`
- Guard: `fleet/tests/test_run_engine_reconcile_retry.mjs`
- Legs: (a) a stub whose first `reconcile:wave1:1` call throws an `Error` with `workerVerdict: { class: 'no-envelope' }` and whose second returns `{ status: 'FIXED', summary: 's' }` after writing the fix that turns `check.sh` green: exactly two `reconcile:wave1:1` dispatches were recorded, their prompts are byte-identical and their `model` and `schema` deep-equal, and the epoch's merge status is `MERGED` [M1, M2]; (b) on that run `events.jsonl` holds exactly one `driver:reconcile-retry` event, deep-equal to `{ wave: 1, attempt: 1, class: 'no-envelope' }` on those three keys, and `judgmentCalls` holds the entry `wave 1: reconcile attempt 1 produced no reply (no-envelope) — re-dispatched once` [M4]; (c) a stub whose first call returns `null` and whose second returns `FIXED` with the fix: two dispatches, `MERGED`, and the event's `class` is `null` [M1, M2, M4]; (d) a stub that throws `{ workerVerdict: { class: 'error' } }` on both calls: exactly two dispatches, no third, `judgmentCalls` holds `wave 1: reconcile attempt 1 produced no reply` as its final reconcile entry, and the epoch's merge status is `TEST_FAILED` [M3]; (e) a stub whose first call returns `{ status: 'BLOCKED', summary: 'b' }`: exactly one dispatch and no `driver:reconcile-retry` event [M5]; (f) a stub whose first call throws `new Error('RUN_FATAL: sim')`: exactly one `reconcile:wave1:1` dispatch, and the throw reaches the sim [M5]. Leg (a) is the falsifier of BASE, where the same stub records one dispatch and `TEST_FAILED`; (g) the `Run:` grep below exits 0 against `fleet/CONTRACT.md` [M6].
- Run: grep -q "driver:reconcile-retry" fleet/CONTRACT.md

**Stale-if:**
- issue-closed: #1054
- path-absent: `fleet/run-engine.mjs`

### Task 3: The retry tier is decided by the worker's verdict class, not by the wording of its message

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/run-engine.mjs`
- Modify: `fleet/run-worker.mjs`
- Test: `fleet/tests/test_run_engine_schema_escalation.mjs`

**Claim:** do: rename or reword what a worker says when it fails; see: a schema trip still gets the stronger model and any other failure still gets the same-tier retry, because the driver reads the class the worker attached, not the sentence it wrote. (derived)
Machine: M1. When a task's worker call throws an error whose `workerVerdict.class` is `max-turns` or `no-structured-output`, the task is retried once at `escalateTier(task.tier)` and its `judgmentCalls` entry carries `(schema trip → escalate)`. M2. When the thrown error carries any other `workerVerdict.class` (`no-envelope`, `error`, `budget`, `api-error`, `sigterm`), or no `workerVerdict` at all, the task is retried once at its own tier and the entry carries `(same tier)` — whatever the message says, a message containing `schema` or `StructuredOutput` included. M3. `fleet/run-engine.mjs` exports no `isSchemaTrip`, and neither `fleet/run-engine.mjs` nor `fleet/run-worker.mjs` contains the token `isSchemaTrip` anywhere, comments included.

**Authorized-by:** #410 §1 ("The real fix … read `err.workerVerdict.class` and delete `isSchemaTrip` outright. A class is a value; a sentence is not.") and its 2026-09-11 comment ("The fix … read `workerVerdict.class`")

**Interfaces:**
- Consumes: none
- Produces: nothing new — `isSchemaTrip` is removed

**Context:** At BASE the lever is `isSchemaTrip` (`fleet/run-engine.mjs` 143–144, a regex `/schema|structuredoutput|did not conform|required propert|invalid (?:enum|json)/i` over the thrown message) read at 4278 in `runTask`'s catch: `capabilityFixable = isSchemaTrip(msg)`; `retryTier = capabilityFixable ? escalateTier(task.tier) : (task.tier || 'standard')`; the entry `'task <id>: agent error at <tier> — retrying once at <retryTier> (schema trip → escalate)' | '(same tier)' + ': ' + msg`. The worker attaches `{ workerVerdict: verdict, label }` to every non-fatal throw (`fleet/run-worker.mjs` ~1069–1070); the two classes `classify` answers for a schema contract unmet are `max-turns` (~524) and `no-structured-output` (~538) — both carry `retry` outcomes and the text `(schema contract unmet)`, which is the wording the regex has been matching. The comment carriers of the token, which a zero-count grep counts: `fleet/run-engine.mjs` 136–142 (the classifier banner, which also names a `fleet/tests/test_run_worker.mjs` that no longer exists), `fleet/run-worker.mjs` 517–519 (the `max_turns` branch's "wording is load-bearing" paragraph), 1038–1040 and 1058–1061 (the `fail-run` and `default` cases). `looksStructural` and `isInfraFault` stay exactly as they are — the infra marker `AGENT_NULL` is checked first at 4266 and this task does not touch that branch. No sim outside this task's Test pins `isSchemaTrip` (`git grep isSchemaTrip` at BASE hits only the two source files). The exam observes the tier through the stub: the engine passes `model: baseModel` on `impl:<id>` dispatches, where `baseModel` is `resolvedModel(tierName)` (~2700); at the retry the model is the retry tier's, so the second `impl:T1` dispatch's `opts.model` reads `TIER.mostCapable` under escalation and `TIER.standard` under a same-tier retry (`TIER = { standard: 'sonnet', mostCapable: 'opus' }`, `escalateTier` exported at 125). The rig's stub receives `(prompt, opts, cwd)`; a throw from the stub is what the engine catches.

**Proof:**
- Test: `fleet/tests/test_run_engine_schema_escalation.mjs`
- Guard: `fleet/tests/test_run_engine_schema_escalation.mjs`
- Legs: (a) a one-task run whose first `impl:T1` call throws an `Error('WORKER_MAX_TURNS: x')` carrying `workerVerdict: { class: 'max-turns' }` and whose second returns a done reply: two `impl:T1` dispatches, the second's `opts.model` equals `TIER.mostCapable`, the task ends `done`, and `judgmentCalls` holds an entry containing `(schema trip → escalate)` [M1]; (b) the same with `workerVerdict: { class: 'no-structured-output' }`: the second's `opts.model` equals `TIER.mostCapable` [M1]; (c) a first call that throws `Error('StructuredOutput did not conform to schema')` carrying `workerVerdict: { class: 'error' }`: the second's `opts.model` equals `TIER.standard` and the entry contains `(same tier)` — at BASE this message escalates [M2]; (d) a first call that throws `Error('schema')` with no `workerVerdict` property: the second's `opts.model` equals `TIER.standard` and the entry contains `(same tier)` [M2]; (e) for each of `no-envelope`, `budget`, `api-error`, `sigterm` as `workerVerdict.class` with a message `'WORKER_X: schema'`: the retry's `opts.model` equals `TIER.standard` [M2]; (f) `import * as engine from '../run-engine.mjs'` has no `isSchemaTrip` export [M3].
- Run: test "$(grep -c isSchemaTrip fleet/run-engine.mjs fleet/run-worker.mjs | cut -d: -f2 | paste -sd+ - | bc)" = 0

**Stale-if:**
- issue-closed: #410
- path-absent: `fleet/run-engine.mjs`

### Task 4: A worker's role is declared where it is dispatched, never derived from its label

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/run-engine.mjs`
- Modify: `fleet/run-worker.mjs`
- Modify: `fleet/run-main.mjs`
- Modify: `fleet/CONTRACT.md`
- Modify: `fleet/tests/test_worker_kata_env.mjs`
- Modify: `fleet/tests/test_worker_prompt_stdin.mjs`
- Modify: `fleet/tests/probe_run_worker_live.mjs`
- Modify: `fleet/tests/probe_confine_live.mjs`
- Test: `fleet/tests/test_worker_role_declared.mjs`

**Claim:** do: add a dispatch site or rename a label; see: the worker refuses to start until that site says which role it is, and the tool allowlist, permission mode and writable root it gets are the declared role's — a label's spelling decides nothing. (derived)
Machine: M1. `createRunWorker`'s `agent(prompt, opts)` requires `opts.role`, one of `examiner`, `implementer`, `reviewer`, `resolver`, `writeSide`; a dispatch with no `role`, or a `role` outside that set, throws before `spawnFn` is called, with a message naming `role`. M2. The declared role is the one the worker uses: it is the `role` on that dispatch's `worker:start` and `worker:end` events and the argument handed to `promptFileFor`, `settingsFor`, `addDirsFor`, `timeoutMsFor` and `effortFor`, and the argv handed to `spawnFn` carries `--permission-mode` followed by `ROLES[role].permissionMode`, `--allowedTools` exactly when `ROLES[role].allowedTools` is set and `--disallowedTools` exactly when `ROLES[role].disallowedTools` is set — even when the label's prefix would have named another role. M3. `fleet/run-worker.mjs` exports no `roleForLabel`, and the token `roleForLabel` occurs in none of `fleet/run-worker.mjs`, `fleet/run-engine.mjs`, `fleet/run-main.mjs`. M4. Every dispatch `fleet/run-engine.mjs` makes declares its role: for each of the label families `exam:<id>` (examiner), `impl:<id>` (implementer), `fix:<id>:0` (implementer), `review:<id>:<iter>` (reviewer), `reconcile:wave<n>:<a>` (writeSide) and `resolve:wave<n>:<i>:<a>` (resolver), the `opts.role` the engine passes is that role. M5. `fleet/CONTRACT.md` names `role` as a required dispatch option and, within 400 characters of that word, lists its five values `examiner`, `implementer`, `reviewer`, `resolver`, `writeSide` in that order.

**Authorized-by:** #410 §2 ("the role is *derived from prose* rather than *declared* … declaring `opts.role` at the … call sites") and its 2026-09-11 comment ("declare `role` at dispatch")

**Interfaces:**
- Consumes: none
- Produces: `opts.role` — a required dispatch option, one of `examiner | implementer | reviewer | resolver | writeSide`

**Context:** At BASE `roleForLabel` (`fleet/run-worker.mjs` 192–210) switches on `label.split(':')[0]` — `exam`→examiner, `impl`/`fix`→implementer, `review`→reviewer, `resolve`→resolver, `merge`/`reconcile`→writeSide, the literal `integration`→critic, `setup`→writeSide — and throws on an unknown prefix; `agent()` calls it at 946 and the role then reaches `buildArgs` (allowlist, permission mode), `promptFileFor`, `settingsFor`, `addDirsFor`, `timeoutMsFor`, `effortFor` and both worker events. `critic` (the retired `integration` label, #964), `merge` and `setup` are dispatched by nothing at BASE and are not in M1's set. The engine's dispatch sites, each an `agent(prompt, opts)` whose options object gains `role:` — `fleet/run-engine.mjs` 1269 (`resolve:…`, inside `resolveConflicts`, options `{ label, schema: RESOLVER_SCHEMA }`), 3106 (`examOpts`, reused at 4206 for `exam:<id>:2` by spread), 3111 (`impl:<id>`), 3715 (`fix:<id>:0`), 3979 (`reviewOpts`, `review:<id>:<iter>`), 4682 (`reconcile:wave<n>:<a>`) — six option objects, seven labels. The `factsFor(…, { label, task })` calls at 3103, 3296, 3972 and 4482 are records, not dispatches, and take no role. Direct callers of `createRunWorker(...).agent` outside the engine that pass a label alone and must now declare a role: `fleet/tests/test_worker_kata_env.mjs` (348 and its `{ label, isolation }` table at 356–358), `fleet/tests/test_worker_prompt_stdin.mjs` (203, 281), `fleet/tests/probe_run_worker_live.mjs` and `fleet/tests/probe_confine_live.mjs` (live probes, run by hand); `fleet/tests/test_run_engine_infra_retry.mjs`'s worker (702) is handed the engine's own options and needs no edit. `fleet/run-main.mjs` 520–522 names `roleForLabel` in a comment (the comment carrier for M3's zero-count). `fleet/run-waves.mjs` and `fleet/sandbox-boot.sh` read `label`, never the role's derivation, and are untouched; `worker:start`/`worker:end` keep their `role` key. The exam's engine half records `opts.role` by label in the rig's stub over runs that provoke each family: a task with a Proof `Test:` path dispatches `exam:`; a red `proofRuns` command dispatches `fix:<id>:0`; a red `check.sh` after the fold dispatches `reconcile:`; the resolver is driven through the exported `resolveConflicts({ … agent })` with an injected agent, as `fleet/tests/test_resolver_brief.mjs` does, so no conflict has to be manufactured.

**Proof:**
- Test: `fleet/tests/test_worker_role_declared.mjs`
- Guard: `fleet/tests/test_worker_role_declared.mjs`
- Legs: (a) `agent('p', { label: 'impl:1' })` against a `spawnFn` stub rejects with a message containing `role`, and the stub was never called [M1]; (b) `agent('p', { label: 'impl:1', role: 'janitor' })` rejects the same way, stub never called [M1]; (c) for each of `examiner`, `implementer`, `reviewer`, `resolver`, `writeSide` as `opts.role` with `label: 'impl:1'` and a stub child that prints a success envelope: `agent()` resolves, the `worker:start` and `worker:end` events carry that `role`, the sim's `promptFileFor`, `settingsFor`, `addDirsFor`, `timeoutMsFor` and `effortFor` each recorded that role as their argument, and the argv the stub received carries `--permission-mode` followed by `ROLES[role].permissionMode`, contains `--allowedTools` iff `ROLES[role].allowedTools` is set and `--disallowedTools` iff `ROLES[role].disallowedTools` is set — five rows, one assertion set per row [M1, M2]; (d) `label: 'impl:1', role: 'reviewer'`: the events' `role` is `reviewer`, the argv carries `--permission-mode dontAsk` and `--allowedTools` and no `--disallowedTools` — not the implementer's `bypassPermissions` row the label's prefix names at BASE [M2]; (e) `import * as worker from '../run-worker.mjs'` has no `roleForLabel` export [M3]; (f) a rig-driven one-task run with a Proof `Test:` path, a red `proofRuns` command, a passing reviewer and a `check.sh` that is red after the fold: the recorded `opts.role` is `examiner` for the `exam:T1` dispatch [M4]; (g) `implementer` for `impl:T1` [M4]; (h) `implementer` for `fix:T1:0` [M4]; (i) `reviewer` for the `review:T1:1` dispatch [M4]; (j) `writeSide` for `reconcile:wave1:1` [M4]; (k) `resolveConflicts` with an injected agent over one conflict: the `resolve:…` dispatch's `opts.role` is `resolver` [M4]. Legs (a) and (d) are the falsifiers of BASE, where (a) resolves instead of rejecting and (d) reports `implementer`; (l) the second `Run:` below exits 0 against `fleet/CONTRACT.md`: with newlines joined, the word `role` is followed within 400 characters by `examiner`, then `implementer`, `reviewer`, `resolver` and `writeSide`, each within 80 characters of the one before — at BASE the contract carries no `writeSide` at all [M5].
- Run: test "$(grep -c roleForLabel fleet/run-worker.mjs fleet/run-engine.mjs fleet/run-main.mjs | cut -d: -f2 | paste -sd+ - | bc)" = 0
- Run: tr '\n' ' ' < fleet/CONTRACT.md | grep -q 'role.\{0,400\}examiner.\{0,80\}implementer.\{0,80\}reviewer.\{0,80\}resolver.\{0,80\}writeSide'

**Stale-if:**
- issue-closed: #410
- path-absent: `fleet/run-worker.mjs`

### Task 5: Every command the driver runs sees the sandbox toolchain first on its PATH

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/run-engine.mjs`
- Modify: `fleet/CONTRACT.md`
- Modify: `fleet/tests/test_run_engine_reuse.mjs`
- Test: `fleet/tests/test_run_engine_shell_path.mjs`

**Claim:** do: run a suite, a proof, a check or an exam through the driver on a tree whose package install dropped its own `bun` into `node_modules/.bin`; see: the command's PATH starts with the sandbox's toolchain directory, so a direct `bun` or `bunx` is the sandbox's, whatever the login profile or the tree put on PATH. (derived)
Machine: M1. Every shell command the engine runs through its `bash -lc` adapter — the suite (`testCmd`), a Proof `Run:` command, a Global `Check:` command and a task's exam command — sees a `PATH` whose first entry is `args.toolchainBin` when that is a non-empty string, else `TOOLCHAIN_BIN`, followed by the PATH it would otherwise have had. M2. `fleet/run-engine.mjs` exports `TOOLCHAIN_BIN` equal to `/usr/local/bin`. M3. The prefix survives a login profile that reassigns `PATH`: with a `HOME` whose `.bash_profile` prepends a sentinel directory, the command's first entry is still the toolchain directory and the sentinel appears after it. M4. The `cmd` recorded on `driver:proof-run`, `driver:check-run` and `driver:exam-run` events carries no PATH prefix: the first two are the command as the plan wrote it, the third is the `examRunCmd` the driver composes at BASE (the task's `testCmd` with its Proof `Test:` path substituted by the exam's landing path), and none of the three contains the toolchain directory or the token `PATH=`. M5. `fleet/CONTRACT.md` names `TOOLCHAIN_BIN` and its default.

**Authorized-by:** #1051 §Desired state 1 ("the run's `PATH` is arranged so `/usr/local/bin/bun` (the pinned toolchain) precedes `node_modules/.bin` for the suite command … the first is the fleet's job and holds for every target")

**Interfaces:**
- Consumes: none
- Produces: `TOOLCHAIN_BIN` — exported string `/usr/local/bin`

**Context:** The one choke point at BASE is `shOf` (`fleet/run-engine.mjs` 1120–1122): `exec('bash', ['-lc', cmd], { cwd, env, timeoutMs: SHELL_TIMEOUT_MS })`, reached by every `sh(...)` — the bootstrap (2566, 2990, 4606, 5098), the suite (4623, 4717), exam runs (3241, 3397), proof `Run:`s (3378, 5344), `Check:`s (3420, 5376) and the lockfile regenerator (4549). `env` is `examEnv(...)`/`baseEnv(...)` or `undefined` (then `execSeam` spawns with `process.env`). The prefix rides inside the command string handed to `bash -lc`, not in `env.PATH`, because `-l` sources the profile after the environment is set and a profile may reassign PATH: measured on the laptop 2026-09-16, `PATH=/tmp/zz-first:$PATH bash -lc 'echo $PATH'` printed a PATH beginning `/usr/local/bin:/System/Cryptexes/…` with `/tmp/zz-first` no longer first (macOS `path_helper`); Debian's `/etc/profile` assigns `PATH=` for a login shell the same way. The sandbox installs Bun at `/usr/local/bin/bun` (`fleet/setup-script.mjs` 128, `BUN_VERSION = '1.4.2'` since #1058). What this does not reach, stated so the reviewer does not look for it: `bun run <script>` prepends the tree's `node_modules/.bin` to PATH itself — measured 2026-09-16 with bun 1.4.2, a fake `node_modules/.bin/bun` won under `bun run t` whatever PATH said and lost under a direct `bun --version` once the toolchain directory preceded it — so a fixture whose suite is a `bun run` script needs #1051's second disjunct (an `overrides` pin), which is the fixture's and not this plan's; the greenfield default suite `bunx tsc --noEmit && bun test` is direct and is what this holds for. `fleet/publish-fold.mjs` 1112 runs the publish fold's suite through its own `bash -lc` and is out of this task's scope. The one pin of the adapter's argv at BASE is `fleet/tests/test_run_engine_reuse.mjs` 496, `call.argv[1] === TEST_CMD`, which must read the tail of the argument (`endsWith(TEST_CMD)`) once the prefix is inside it — that file is in Files for exactly that line. The event `cmd` values are read from the plan's command (`driver:proof-run {task, cmd, exit, iter}` etc., `fleet/CONTRACT.md` 104–106) before the adapter is called, so M4 is a pin that the prefix stays inside the adapter. The exam observes PATH by giving the rig commands of the form `printf %s "$PATH" > <absolute temp file>` and reading the first `:`-separated entry; the rig takes `toolchainBin` through `extraArgs`, `proofRuns` on a task, `constraintChecks` through `extraArgs`, and a task `testCmd` with `proofTests` for the exam pass. A sim's `HOME` for leg (c) is set by wrapping the rig's `exec` seam with an env built from `simEnv({ home: <temp home> , env: <the engine's env> })` — never `process.env`.

**Proof:**
- Test: `fleet/tests/test_run_engine_shell_path.mjs`
- Guard: `fleet/tests/test_run_engine_shell_path.mjs`
- Legs: (a) a run with `toolchainBin` set to a fresh temp directory and `testCmd` writing `$PATH` to a file: the file's first `:` entry equals that directory and the remainder is non-empty [M1]; (b) a task whose `proofRuns` command writes `$PATH` to a second file: first entry equals the directory [M1]; (c) a `constraintChecks` command writing to a third file: first entry equals the directory [M1]; (d) a task whose exam command (`testCmd` with a `proofTests` path) writes to a fourth file: first entry equals the directory [M1]; (e) a run with no `toolchainBin`: the suite's first entry is `/usr/local/bin`, and `engine.TOOLCHAIN_BIN === '/usr/local/bin'` [M1, M2]; (f) with the exec seam's env carrying a `HOME` whose `.bash_profile` runs `PATH=<sentinel>:$PATH` — the sentinel a second temp directory — the suite's first entry is still `toolchainBin` and the sentinel occurs later in the same PATH string, proving the profile ran and did not win [M3]; (g) the `driver:proof-run` and `driver:check-run` events of runs (b) and (c) carry `cmd` equal to the command string the sim handed the rig; the `driver:exam-run` event of run (d) carries `cmd` equal to the task's `testCmd` with its `proofTests` path substituted by that exam's landing path — in this sim the landing equals the path, so equal to the string handed; and none of the three contains the `toolchainBin` directory or the token `PATH=` [M4]. Leg (a) is the falsifier of BASE, where the first entry is whatever the profile left; (h) the `Run:` below exits 0 against `fleet/CONTRACT.md`: with newlines joined, the token `TOOLCHAIN_BIN` is followed within 200 characters by its default `/usr/local/bin` [M5].
- Run: tr '\n' ' ' < fleet/CONTRACT.md | grep -q 'TOOLCHAIN_BIN.\{0,200\}/usr/local/bin'

**Stale-if:**
- issue-closed: #1051
- path-absent: `fleet/run-engine.mjs`
