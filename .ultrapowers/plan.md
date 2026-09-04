# Judging waste: the driver runs the checks, a plan defect parks instead of looping, the referee stops deferring

**Grammar:** claims-v1

**Claim:** After this run, no fix round is dispatched on a finding the implementer cannot act
on, no reviewer defers a requirement to the critic, and a red Run: or Check: is repaired
before any referee reads the patch — while blocking findings on real defects keep landing.
(elicited)

**Goal:** The role-time census of runs 72–74 (358 worker-minutes, $118): fix rounds were 24% of
worker time and 1 of 4 succeeded — the 3 failures were findings the implementer could not act on
(a constraint string, a plan proof); ~45 `cannotVerify` items produced 0 fixes and 1 park; the
critic's blocking findings were 100% redundant with the deliverables check. Seven decisions
were grilled with the operator on 2026-09-04 (memory `tardigrade-effect-research-2026-09-04`,
handoff `2026-09-04-five-wide-then-the-walk.md` §Judging waste): (1) constraints are two
kinds — a `- Check: <cmd>` bullet is driver-executed, a prose bullet is the referee's lens;
(2) a deterministic pre-review round repairs a red Run:/Check: once before any referee is
dispatched; (3) every reviewer issue names its `actor` — a `plan` issue merges-and-parks, it
never loops the implementer; (4) `cannotVerify` is deleted, an unsettled requirement is a
`minor` finding prefixed `unverified:`; (5) the critic is narrowed to the Claim and the shared
literals; (6) two economy numbers are reported per run, nothing is targeted. Success is waste
only, quality held: reviewer-minutes and dollars are reported, never targeted.

**Tech Stack:** Node 24 ESM (`fleet/run-engine.mjs`), role prompts as data (`fleet/roles/*.md`),
engine sims under `fleet/tests/` on the shared rig (`_engine_helpers.mjs`: real git, real fold,
stubbed `agent`), sentinel `ALL TESTS PASSED`; pytest for `tests/test_roles_run_evidence.py`.

**Spec:** the grilling record in the handoff (untracked, `docs/superpowers/` — every fact a worker
needs is in Context below); tickets #232 (the census), #525, #551.

**Parallelization rationale:** One wave, width 2. Task 1 is the engine and the report reference
with three new sims; Task 2 is the four role files and the exams that pin them. The engine reads
role files verbatim and no sim of Task 1 asserts on role text, so neither waits. Task 1's
compiler half — parsing `- Check:` into `constraintChecks` — is the concurrent plan
`2026-09-04-proof-gate-species-and-check.md`; the two agree on one literal (Context of Task 1)
and the seam is exercised by the first live launch after both merge, not by either suite.

## Global Constraints

- The frozen periphery is untouched: `skills/ultrapowers/scripts/gate_check.py`,
  `ultra_gate.py` and `run_acceptance.sh` are byte-identical to BASE, and so is
  `fleet/run-main.mjs` — its `ackDecision` still pre-authorizes exactly `deferred:runtime` and
  `deferred:external`, which is what makes a `deferred:plan-defect` ack park.
- No role's tool posture changes: `fleet/run-worker.mjs` is byte-identical to BASE.
- A run whose tasks carry no `Run:`, whose `args.constraintChecks` is absent and whose reviewers
  return no issues leaves every prompt the engine builds byte-identical to BASE's (the run-51
  rule: empty evidence renders nothing).
- The role files keep the register the directory keeps: no `NEVER`/`ALWAYS`/`MUST`, no
  `adversarial`.
- The word `cannotVerify` appears in none of `fleet/run-engine.mjs`, `fleet/roles/*.md`,
  `skills/ultrapowers/references/report-format.md`.
- Every engine sim prints `ALL TESTS PASSED` under 120 s with no network.

**Acceptance:** suite — the committed suite is the verification.

### Task 1: The driver runs every check before review, routes findings by actor, and reports what a reviewer-minute bought

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/run-engine.mjs`
- Modify: `skills/ultrapowers/references/report-format.md`
- Test: `fleet/tests/test_run_engine_pre_review.mjs`
- Test: `fleet/tests/test_run_engine_actor_routing.mjs`
- Test: `fleet/tests/test_run_engine_review_economy.mjs`

**Claim:** A red Run: or Check: is repaired before any referee reads the patch, a plan defect
parks the run instead of looping the implementer, and the run report says what a
reviewer-minute bought. (derived)
Machine: M1. `args.constraintChecks` is read as an array of `{ cmd, minor }` (entries with an
empty or non-string `cmd` dropped, `minor` coerced to boolean; absent or malformed reads as
`[]`), and for every task, after the implementer's patch is captured and before any `review:`
worker is dispatched, the driver executes each of the task's `proofRuns` and then each
`constraintChecks` command in the task's clone through the same `sh` seam as the suite,
appending one `driver:proof-run` event `{ task, cmd, exit, iter: 0 }` per Run: and one
`driver:check-run` event `{ task, cmd, exit, minor, iter: 0 }` per Check:. M2. When that pass
shows a non-zero exit on any Run: or any non-minor Check:, the driver dispatches exactly one
`fix:<id>:0` worker (`roles.fix` plus the task body, TEST COMMAND, FILES, SIBLING FILES, GLOBAL
CONSTRAINTS and INTERFACES blocks, then `\n\nBlocking issues to resolve:\n` and, per red
command, `- the Proof's Run: command failed: <cmd> — exit <n>` or `- the Global Constraints
Check: command failed: <cmd> — exit <n>`, each followed by `\n  output (last 4,000
characters):\n` and the recorded tail), re-captures, and repeats the pass with `iter: 0`; if
that second pass is still red the task returns `status: 'failed'`, `reviewVerdict:
'proof-red'`, `proofFixes: 1`, `notes` naming every red command, and no `review:` worker is
ever dispatched for it; if green, review proceeds with `proofFixes: 1`; a first pass that is
all green proceeds with `proofFixes: 0` and no `fix:<id>:0` worker; a red `minor` check never
dispatches a fix and pushes one judgment call `task <id>: minor Check: \`<cmd>\` exited <n>`.
M3. Each review round still re-executes the Run: commands and now the Check: commands
too (events with `iter` = the round), and the reviewer prompt carries, directly after the RUN
EVIDENCE block, a block that begins `CHECK EVIDENCE: the driver executed each Global
Constraints \`Check:\` command itself, in this task's own clone, on the tree the patch above
describes — stdout and stderr combined, last 4,000 characters. A blocking check that exited
non-zero is already the fix loop's; a check marked (minor) is recorded here for the referee's
attention and blocks nothing.` followed by, per command, `$ <cmd>`, `exit <n>` (with ` (minor)`
appended for a minor check) and the output; with no `constraintChecks` the block is absent; a
non-zero non-minor check in a review round is a blocking issue `the Global Constraints Check:
command failed: <cmd> — exit <n>` exactly as a red Run: is. M4. After a wave's candidate is
adopted and its merged tasks' integrated Run: commands have run, the driver executes each
`constraintChecks` command once in the integration clone, records `{ cmd, exit, stdout, minor }`
under a new report key `integratedChecks` and one `driver:integrated-check` event `{ cmd,
exit, minor, wave }` per command; a non-zero non-minor exit appends the blocking completeness
finding `{ severity: 'blocking', detail: 'integrated Check: <cmd> exited <n> on the adopted
tree' }` the #474 brake reads, a non-zero minor one pushes a judgment call only; the critic's
prompt carries, directly after the INTEGRATED RUN EVIDENCE block, a block that begins
`INTEGRATED CHECK EVIDENCE: the driver executed each Global Constraints \`Check:\` command
itself, on the adopted integration tree — this is the authoritative result.` followed by the
same per-command lines, absent when there are no checks. M5. `REVIEWER_SCHEMA`'s issue object
gains `actor: { enum: ['implementer', 'plan'] }` in its `required` list; the driver reads an
issue's actor as `plan` when it says `plan`, and otherwise as `implementer` — except that a
blocking issue whose `detail` begins `plan-defect:` and names, in backticks, a token containing
`/` or `.` that is not in the task's `files`, is re-routed to `plan` with the judgment call
`task <id>: plan-defect names \`<token>\` outside FILES — routed to the plan`; blocking
`implementer` issues drive the fix round exactly as today (the fix prompt lists only them);
blocking `plan` issues drive no fix round and no re-review — when no blocking `implementer`
issue remains the task merges as today (`clean` or `fixed`) with `plan-defect: <detail>` in
its `notes`, and for every task whose final `status` is `done` the report's
`deferredVerification` carries one `{ deliverable: <task id>, reason: 'plan-defect', why:
<detail> }` per distinct plan-actor blocking detail, with the judgment call `task <id>:
plan-defect deferred to the gate — <detail>`; run through the frozen `gate_check.py` such a
report yields an ack of type `deferred:plan-defect` and `run-main.mjs`'s `ackDecision` refuses
it. M6. The `cannotVerify` channel is gone: the schema property, the accumulator, the
CANNOT-VERIFY checklist in the critic's prompt and the no-wave-merged judgment calls, so the
string `cannotVerify` does not occur in `fleet/run-engine.mjs`. M7. The report carries
`reviewEconomy: { reviewerMs, blockingFindings, blockingPerReviewerMinute, pairRounds,
r2MarginalBlocking }` — `reviewerMs` the sum of wall-clock milliseconds of every `review:`
agent call measured individually (a concurrent pair contributes both durations),
`blockingFindings` the count of reviewer-returned blocking issues after de-duplication across
the run (driver-minted Run:/Check: issues excluded), `blockingPerReviewerMinute` =
`blockingFindings / (reviewerMs / 60000)` and `0` when `reviewerMs` is `0`, `pairRounds` the
number of review rounds that dispatched a pair, `r2MarginalBlocking` the count, across pair
rounds, of blocking issues returned by reviewer 2 whose `severity|detail` key reviewer 1 did
not return. M8. A run whose tasks carry no `proofRuns`, whose `args.constraintChecks` is
absent and whose reviewers return no issues yields every captured prompt of every role
(implementer, reviewer, critic) byte-identical to the same run on BASE's engine,
`integratedChecks` deep-equal to `[]`, `proofFixes: 0` on every task row and `reviewEconomy`
present. M9. `skills/ultrapowers/references/report-format.md` documents each of the four
additions — a `proofFixes` row under `tasks[]`, `proof-red` in the `tasks[].reviewVerdict`
row, an `integratedChecks` row naming `{ cmd, exit, stdout, minor }`, a `reviewEconomy` row
naming its five fields, and `plan-defect` in both the `deferredVerification` schema enum and
its row — and no longer carries the `cannotVerify (per reviewer)` row or the sentence in the
`completenessFindings` row about the CANNOT-VERIFY checklist.

**Authorized-by:** the 2026-09-04 grilling, decisions 1–4, 6 and 7 (handoff §Judging waste);
#232 (the census); #604 (the driver's own execution is authoritative — extended from Run: to
Check:); #474 (typed completeness findings); #551 (the exam is the submission's grading).

**Interfaces:**
- Consumes: none
- Produces: `checkEvidenceBlock(checks: Array<{cmd, exit, stdout, minor}>) -> string`
- Produces: `integratedCheckEvidenceBlock(checks: Array<{cmd, exit, stdout, minor}>) -> string`
- Produces: `report.reviewEconomy`
- Produces: `report.integratedChecks`

**Context:** THE SHARED LITERAL with the concurrent compiler plan: `compile_plan.py --emit-args`
will write a top-level key `constraintChecks` — a JSON array, in section order, of
`{ "cmd": "<the command, verbatim, whole-value backticks stripped>", "minor": <bool> }`, `[]`
when `## Global Constraints` has no `- Check:` bullet; `run-main.mjs` spreads the whole args
file into the engine's `args`, so the engine reads `args.constraintChecks` and nothing else
changes upstream. On BASE nothing writes that key, so every sim passes it through the rig's
`extraArgs` (`rig({ …, extraArgs: { constraintChecks: [{ cmd: 'test -e c.txt', minor: false }] } })`).
The per-task pipeline today (`runTaskInner`): after `hasCoordinates(impl)` and before `for
(let iter = 1; iter <= 2; iter++)`, insert the pre-review pass; the existing per-round
`runEvidence` loop (`const r = await sh(cmd, cloneDir); runEvidence.push({ cmd, exit: r.code,
stdout: tail(r.stdout + r.stderr) }); appendEvent({ kind: 'driver:proof-run', … iter })`) is
the shape to mirror, and the fix round's dispatch (`agent(roles.fix + taskBodyBlock(task,
wavesPath) + testCmdLine(task, workerTestCmd) + filesLine(task) + siblingsStr +
globalConstraintsBlock + interfacesLine(task) + '\n\nBlocking issues to resolve:\n' + …, {
label: 'fix:' + task.id + ':' + iter, isolation: 'worktree', model: TIER.mostCapable, schema:
IMPLEMENTER_SCHEMA })`) followed by `stripUntrustedPatch`, `noteConcerns`, `noteDrift('the
fix round')`, the lost-coordinates and BLOCKED checks, is the shape of the `fix:<id>:0`
round — use the same helper sequence, then re-run the pass. The review prompt is assembled as
`roles.reviewer + taskBodyBlock + '\nPATCH: ' + … + priorAdvisoriesBlock(priorMinors) + (EXAM
EDITED) + runEvidenceBlock(runEvidence)` — append `checkEvidenceBlock(checkEvidence)` last;
`runEvidenceBlock` (exported) is the rendering to mirror, and `integratedRunEvidenceBlock` is
the critic-side one — `integratedCheckEvidenceBlock` is appended directly after it in the
critic prompt. The integrated pass lives in the wave loop under `if (merge.status ===
'MERGED')`, after the `for (const t of waveTasks)` integrated-Run loop, cwd `integ`, pushing
onto `integratedFindings` for the brake. Issue handling in the review round: after `issues`
is de-duplicated and the Run:/Check: reds are appended, partition `issues.filter(severity ===
'blocking')` by actor; the actor validator reads `task.files` (the compiled `files` list of the
wave entry) and backticked tokens of the detail (`/\`([^\`]+)\`/g`). `deferredVerification` is
built at the end (`(review.deferredVerification || []).concat(shallowDeferred ? … : [])`) —
concatenate the plan-defect items there, filtered to tasks whose `taskResults` row is
`status: 'done'`. `REVIEWER_SCHEMA` is at the top of the file (`required: ['severity',
'detail']` on the issue object today). Timing: wrap each `agent(reviewPrompt, reviewOpts(…))`
call in `Date.now()` before/after and accumulate; for the pair, wrap each of the two promises
individually before `Promise.all`. The `tail` helper is the 4,000-character tail;
`appendEvent({ kind, … })` writes `events.jsonl` in the run dir; `judgmentCalls` is the array
the report returns. The report literal at the end of `runEngine` returns `integratedRuns`
beside `tests` — add `integratedChecks` and `reviewEconomy` beside it. `tests/test_report_runbook.py`
scrapes every `reviewVerdict:` literal from `fleet/run-engine.mjs` and requires each to appear
in `report-format.md`'s field reference, so the `proof-red` row is not optional. In
`report-format.md`, the `tasks[].proposedPatches` row and the `deferredVerification` row's
sentence `a command the driver executed is never \`manual\`` are pinned verbatim by sims this
task does not own (`fleet/tests/test_exam_edited_patches.mjs`, `tests/test_roles_run_evidence.py`)
— extend the `deferredVerification` row, do not rewrite it, and leave the `proposedPatches`
row byte-identical. The sim rig: `rig({ repo, runDir, waves, stub, testCmd, extraArgs })` from
`_engine_helpers.mjs`, `makeRepo` builds a repo whose suite is `bash check.sh` (green unless a
`BROKEN` marker exists), the stub receives `(prompt, opts, cwd)` and switches on
`opts.label.split(':')[0]` (`exam`, `impl`, `review`, `fix`, exact `integration`), answering
`impl` by writing files and `doneImpl(cwd)`, `review` by `passReview()` or `{ verdict:
'FIX_REQUIRED', issues: [...] }`, `integration` by `cleanCritic()`. Worker events are the
worker's, not the engine's, so a sim proves dispatch order from the stub: at each dispatch,
read `events.jsonl` in the run dir and record how many `driver:proof-run` / `driver:check-run`
records precede it. The BASE-pin idiom is `fleet/tests/test_run_engine_integrated_runs.mjs`
lines 290–320: guard with `git cat-file -e <sha>^{commit}` (skip with a printed line in a
shallow clone), copy `fleet/` minus `tests` to a temp tree, overwrite `run-engine.mjs` from
`git show <sha>:fleet/run-engine.mjs`, symlink `skills`, import it, drive both engines through
the same run dir; the sha for this plan's BASE is `2cc873fb2d040fbe081f35ff0ababc408eaa6500`
(0.3.11). `gate_check.py`'s CLI is `--run-id <id> --branch <name> --report <path> --repo
<dir>`; it exits 2 and prints `{ verdict: 'NEEDS_ACK', checks, acks }` when the report carries
a `deferredVerification` item, each ack typed `deferred:<reason>`; `ackDecision` is exported
from `fleet/run-main.mjs` and reads `gateCheck.acks`. The judgment-call and finding strings
above are literals: the fix round and the census read them.

**Proof:**
- Test: `fleet/tests/test_run_engine_pre_review.mjs`
- Test: `fleet/tests/test_run_engine_actor_routing.mjs`
- Test: `fleet/tests/test_run_engine_review_economy.mjs`
- Run: `! grep -q cannotVerify fleet/run-engine.mjs`
- Run: `python3 -m pytest -q tests/test_report_runbook.py tests/test_roles_run_evidence.py`
- Run: `grep -q 'proofFixes' skills/ultrapowers/references/report-format.md && grep -q 'proof-red' skills/ultrapowers/references/report-format.md && grep -q 'integratedChecks' skills/ultrapowers/references/report-format.md && grep -q 'reviewEconomy' skills/ultrapowers/references/report-format.md && grep -q 'plan-defect' skills/ultrapowers/references/report-format.md && ! grep -q 'cannotVerify' skills/ultrapowers/references/report-format.md && ! grep -qi 'CANNOT-VERIFY checklist' skills/ultrapowers/references/report-format.md`
- Legs: (a) in `test_run_engine_pre_review.mjs`, a task with `proofRuns: ['test -e a.txt']` and
  `extraArgs.constraintChecks` of `[{cmd:'test -e c.txt', minor:false}, {cmd:'test -e
  m.txt', minor:true}, {cmd:'', minor:false}, {cmd: 7}]` where the implementer writes only
  `a.txt`: `events.jsonl` holds, before any `review:` dispatch, one `driver:proof-run` for
  `test -e a.txt` with `exit 0` and `iter 0` and two `driver:check-run` records in check
  order (`test -e c.txt` exit 1 `minor false`, `test -e m.txt` exit 1 `minor true`), both
  `iter 0`, and no record for the empty or numeric entries; a rig with `constraintChecks:
  'nope'` runs with no check event and no throw [M1]; (b) in the same file, the implementer
  first writes `a.txt` only, so `test -e c.txt` is red: the dispatch order is
  `impl:T1`, `fix:T1:0`, then `review:T1:1`; the `fix:T1:0` prompt begins with the fix role
  text, carries the TEST COMMAND, FILES, SIBLING FILES, GLOBAL CONSTRAINTS and INTERFACES
  blocks, then
  `\n\nBlocking issues to resolve:\n- the Global Constraints Check: command failed: test -e
  c.txt — exit 1\n  output (last 4,000 characters):\n` and no `- the Proof's Run:` line and
  no line for the minor check; the stub's fix writes `c.txt`, the pass repeats (a second
  `driver:check-run` for `test -e c.txt` with exit 0 and `iter 0` precedes `review:T1:1`),
  the task merges with `reviewVerdict 'clean'`, `proofFixes 1`, `fixIterations 0`; a run
  whose fix writes nothing ends with `status 'failed'`, `reviewVerdict 'proof-red'`,
  `proofFixes 1`, `notes` containing `test -e c.txt` and `exit 1`, zero `review:` labels
  dispatched and zero merged tasks; a run with `proofRuns: ['test -e a.txt']` and no `constraintChecks` whose implementer
  writes nothing: the dispatch order is `impl:T1`, `fix:T1:0`, `review:T1:1`, the fix
  prompt carries `- the Proof's Run: command failed: test -e a.txt — exit 1` followed by
  `\n  output (last 4,000 characters):\n`, a second `driver:proof-run` for `test -e a.txt`
  with exit 0 and `iter 0` precedes `review:T1:1` once the fix writes `a.txt`, and the
  merged row carries `proofFixes 1`; the same run with a fix that writes nothing ends
  `status 'failed'`, `reviewVerdict 'proof-red'`, `proofFixes 1`, `notes` containing `test
  -e a.txt` and `exit 1`, zero `review:` labels; a run whose implementer writes `a.txt` and `c.txt`
  dispatches no `fix:` label and reports `proofFixes 0`; a run where only the minor check is
  red dispatches no `fix:` label, merges, and `judgmentCalls` contains exactly one string
  matching `task T1: minor Check: \`test -e m.txt\` exited 1` [M2]; (c) the captured
  `review:T1:1` prompt carries the RUN EVIDENCE block and then the CHECK EVIDENCE opening
  sentence verbatim, followed by `$ test -e c.txt`, `exit 0`, `$ test -e m.txt`, `exit 1
  (minor)` in that order; `events.jsonl` holds a `driver:check-run` for each check with
  `iter 1`; a stub reviewer that answers `PASS` while the implementer's round-1 tree has
  deleted `c.txt` (the review-round pass finds it red) yields a fix round whose prompt lists
  `- the Global Constraints Check: command failed: test -e c.txt — exit 1`; and a run with no
  `constraintChecks` has no `CHECK EVIDENCE` substring in any prompt [M3]; (d) one wave-1 task
  A that writes `a.txt`, with checks `[{cmd:'test -e a.txt', minor:false}, {cmd:'test -e
  z.txt', minor:true}]`: on the adopted tree `report.integratedChecks` is exactly two
  entries in that order with `exit 0` and `exit 1` and `minor` `false`/`true`,
  `events.jsonl` holds two `driver:integrated-check` records carrying `wave 1`, the minor
  red pushes one judgment call and no finding, and `completenessFindings` is `[]`; a second
  run with two wave-1 tasks A (writes `a.txt`) and B (writes `b.txt`) and the single
  non-minor check `test ! -e a.txt -o ! -e b.txt` — green in each clone, where the other's
  file is absent, red on the fold — dispatches no `fix:` label, merges both, and yields a
  `severity 'blocking'` completeness finding whose `detail` is `integrated Check: test ! -e
  a.txt -o ! -e b.txt exited 1 on the adopted tree`, `judgmentCalls` names it, and the
  captured critic prompt carries the INTEGRATED CHECK EVIDENCE opening sentence directly
  after the INTEGRATED RUN EVIDENCE block, then `$ test ! -e a.txt -o ! -e b.txt`, `exit 1`;
  with no checks, `integratedChecks` is `[]`, no `driver:integrated-check` event exists, and
  the critic prompt has no `INTEGRATED CHECK EVIDENCE` substring [M4]; (e) in `test_run_engine_actor_routing.mjs`,
  `REVIEWER_SCHEMA.properties.issues.items.properties.actor` deep-equals `{ enum:
  ['implementer', 'plan'] }` and `required` deep-equals `['severity', 'detail', 'actor']`; a
  reviewer returning `FIX_REQUIRED` with one blocking issue `{ actor: 'plan', detail:
  'plan-defect: M2 cannot hold' }` dispatches no `fix:` label and no second `review:` label,
  the task row is `status 'done'`, `reviewVerdict 'clean'`, `fixIterations 0`, `notes`
  contains `plan-defect: M2 cannot hold`, `report.deferredVerification` deep-equals
  `[{ deliverable: 'T1', reason: 'plan-defect', why: 'plan-defect: M2 cannot hold' }]`,
  `judgmentCalls` contains `task T1: plan-defect deferred to the gate — plan-defect: M2
  cannot hold`; the report written to disk and run through `python3
  skills/ultrapowers/scripts/gate_check.py --run-id sim --branch <integrationBranch>
  --report <file> --repo <integ>` exits 2 with an ack whose `type` is
  `deferred:plan-defect`, and `ackDecision({ gateCheck: { acks: [{ type:
  'deferred:plan-defect' }] } }).approve` is `false`; a reviewer returning two blocking issues,
  one `actor 'implementer'` (`v1 is wrong`) and one `actor 'plan'`, dispatches `fix:T1:1`
  whose `Blocking issues to resolve:` section lists `- v1 is wrong` and not the plan issue,
  then `review:T1:2`, and the merged row's `deferredVerification` still carries the plan
  item once even though round 2 returned it again; an issue with no `actor` field and detail
  `v1 is wrong` drives a fix round as today; a blocking issue `{ actor: 'implementer',
  detail: 'plan-defect: the exam at `other/exam.sh` cannot pass' }` on a task whose `files`
  is `['a.txt']` is routed to `plan` — no fix round, the judgment call `task T1: plan-defect
  names \`other/exam.sh\` outside FILES — routed to the plan` present — while the same
  issue on a task whose `files` includes `other/exam.sh` drives a fix round; and a plan-actor
  task whose implementer fails review on a separate implementer issue twice
  (`fix-loop-exhausted`) contributes no `deferredVerification` item [M5]; (f) in
  `test_run_engine_review_economy.mjs`, `REVIEWER_SCHEMA.properties.issues.items.properties`
  has no `cannotVerify` key and `REVIEWER_SCHEMA.properties` has no `cannotVerify` key; a
  reviewer that returns an extra `cannotVerify: [{requirement:'x', why:'y'}]` field beside
  a `PASS` merges the task, the captured critic prompt has no `CANNOT-VERIFY` substring and
  no `x` line, and `judgmentCalls` has no entry containing `cannot-verify`; the file
  `fleet/run-engine.mjs` read as text has no `cannotVerify` substring [M6]; (g) with a
  `peer` task whose round-1 reviewer 1 `await`s a 30 ms timer and reviewer 2 a 200 ms timer
  before both return `PASS`: `reviewEconomy.reviewerMs >= 230` and `reviewerMs < 1000` (a
  per-round maximum would read about 200 and fail the lower bound; the sum reads about 230),
  `pairRounds === 1`, `blockingFindings === 0`, `blockingPerReviewerMinute === 0`; a second
  `peer` run whose round-1 reviewers each wait 30 ms and return blocking issues — reviewer 1
  `[{severity:'blocking', detail:'d1', actor:'implementer'}]`, reviewer 2
  `[{severity:'blocking', detail:'d1', actor:'implementer'}, {severity:'blocking',
  detail:'d2', actor:'implementer'}]` — and whose round-2 pair (the re-review after the fix)
  each wait 30 ms and return `PASS`: `reviewerMs >= 120` (four reviewers, summed) and `<
  1000`, `blockingFindings === 2` (`d1` counted once), `pairRounds === 2`,
  `r2MarginalBlocking === 1` (`d2`), and `blockingPerReviewerMinute` equals `2 / (reviewerMs
  / 60000)` to six decimals; a run with a stub reviewer that returns instantly still has
  `reviewerMs` a finite number `>= 0`; a run whose only red is a driver-minted `Run:` failure
  reports `blockingFindings === 0` [M7]; (h) a run whose two
  tasks carry no `proofRuns`, no `constraintChecks` and clean reviews yields every captured
  prompt (labels `impl`, `review`, `integration`) byte-identical to the same run on BASE's
  engine (`git show 2cc873fb2d040fbe081f35ff0ababc408eaa6500:fleet/run-engine.mjs`, the
  integrated-runs pin idiom, skipped with a printed line in a shallow clone),
  `integratedChecks` deep-equal to `[]`, every task row `proofFixes === 0`, and
  `reviewEconomy` an object with exactly the five keys [M8]; (i) the third Run: exits 0 only
  when `report-format.md` names `proofFixes`, `proof-red`, `integratedChecks`,
  `reviewEconomy` and `plan-defect` and no longer contains `cannotVerify` or `CANNOT-VERIFY
  checklist`; the second Run: exits 0 only when `tests/test_report_runbook.py` (every
  `reviewVerdict:` literal documented) and `tests/test_roles_run_evidence.py` (the
  `integratedRuns` row and the `deferredVerification` row's `never \`manual\`` sentence,
  intact) both pass [M9]; the first Run: exits non-zero if `cannotVerify` survives anywhere
  in the engine [M6].

**Stale-if:**
- path-absent: `fleet/tests/_engine_helpers.mjs`
- path-absent: `fleet/tests/test_run_engine_integrated_runs.mjs`
- issue-closed: #232

### Task 2: The roles say what the driver settles, what an actor is, and what the editor reads

**Type:** implementation

**Files:**
- Modify: `fleet/roles/reviewer.md`
- Modify: `fleet/roles/critic.md`
- Modify: `fleet/roles/fix.md`
- Modify: `fleet/roles/README.md`
- Modify: `fleet/tests/test_roles_peer.mjs`
- Modify: `fleet/tests/test_run_engine.mjs`
- Modify: `fleet/tests/test_run_engine_critic_inputs.mjs`
- Modify: `fleet/tests/test_exam_edited_patches.mjs`
- Modify: `tests/test_roles_run_evidence.py`

**Claim:** The referee names who can act on each finding and never defers one; the editor reads
the Claim and the shared literals and nothing the driver or the compiler already settled.
(derived)
Machine: M1. `fleet/roles/reviewer.md` no longer contains `cannotVerify`, and one paragraph of
it states that every issue names its `actor` — `implementer` when the fix lies inside this
task's own `FILES` and the diff can carry it, `plan` when the defect is the task's own text (a
wrong exam, a Machine clause the tree cannot satisfy, a `plan-defect:` whose fix lies outside
`FILES`) — and that a `plan` issue is `never sent to a fix round` and `parks` the run at the
gate. M2. One paragraph of `reviewer.md` states that a requirement the diff `cannot settle` is
a `minor` finding prefixed `unverified:`. M3. One paragraph of `reviewer.md` states that a
finding grounded only in a `prose` GLOBAL CONSTRAINT (one with no `Check:` the driver ran) is
`minor`. M4. The paragraph carrying rule 7 states that a requirement about `how the work was
produced` `is not a finding`. M5. The RUN EVIDENCE paragraph states that asking for a settled
command's `re-execution` `is not a finding`. M6. A CHECK EVIDENCE paragraph of `reviewer.md`
states that a blocking check that exited non-zero is the `fix loop`'s and that a `(minor)`
check `blocks nothing`. M7. `fleet/roles/critic.md` no longer contains `cannot-verify`,
`checklist` or an `Interfaces:` duty; its mandate list is exactly two numbered duties, `1.
Claim` and `2. Context`, each a line appearing exactly once and no line beginning `3. `, `4. `
or `5. `; the INTEGRATED RUN EVIDENCE paragraph is present with the seven phrases
`tests/test_roles_run_evidence.py` pins and names `INTEGRATED CHECK EVIDENCE`; the
`deferredVerification` reason list `browser, runtime, external, manual` is unchanged. M8.
`fleet/roles/fix.md` has one paragraph naming the `referee`, a Proof `Run:`, a Global
Constraints `Check:` and `exit non-zero` together — the three sources of a blocking issue. M9.
`fleet/roles/README.md` no longer says `question for the editor` and says `unverified:`. M10.
The four files carry no `NEVER`/`ALWAYS`/`MUST` and no `adversarial`. M11. The exams that pin
these files pass on the rewritten text: `fleet/tests/test_roles_peer.mjs` carries none of the
constants `REFEREE_SENTENCES`, `FIX_SENTENCE`, `IMPLEMENTER_SENTENCE` and pins `unverified:`;
`fleet/tests/test_run_engine.mjs` no longer names `cannotVerify`;
`fleet/tests/test_exam_edited_patches.mjs` carries no `sha256` digest; and each of
`test_roles_peer.mjs`, `test_run_engine.mjs`, `test_run_engine_critic_inputs.mjs`,
`test_exam_edited_patches.mjs` prints `ALL TESTS PASSED` while `tests/test_roles_run_evidence.py`
passes under pytest.

**Authorized-by:** the 2026-09-04 grilling, decisions 1, 3, 4 and 5; #612 (the audit's verdict on
`test_roles_peer.mjs`: register sweeps stay, verbatim sentence legs go — the operator's call,
#556 stance); #604 (the driver's execution is authoritative).

**Interfaces:**
- Consumes: none
- Produces: nothing

**Context:** The engine's block openings, verbatim, so the prose names what the referee will see:
per task, `RUN EVIDENCE: the driver executed each of the Proof's \`Run:\` commands itself, in
this task's own clone, on the tree the patch above describes — stdout and stderr combined,
last 4,000 characters.` and, new from the concurrent engine task, `CHECK EVIDENCE: the driver
executed each Global Constraints \`Check:\` command itself, in this task's own clone, on the
tree the patch above describes — stdout and stderr combined, last 4,000 characters. A
blocking check that exited non-zero is already the fix loop's; a check marked (minor) is
recorded here for the referee's attention and blocks nothing.`; for the critic, `INTEGRATED
RUN EVIDENCE: …` (unchanged) and `INTEGRATED CHECK EVIDENCE: the driver executed each Global
Constraints \`Check:\` command itself, on the adopted integration tree — this is the
authoritative result.` The reviewer's reply schema gains a required `actor` per issue
(`implementer` | `plan`); the engine routes a blocking `plan` issue to no fix round and to a
`deferred:plan-defect` gate ack. Today's `reviewer.md` lines to change: rule 7 (`is neither a
finding nor a \`cannotVerify\` entry, even when the task or a global constraint states it`),
the RUN EVIDENCE paragraph's `is neither a finding nor a \`cannotVerify\` entry`, the two
closing sentences `A requirement the diff cannot settle is a question for the editor: put it
under \`cannotVerify\` with why, never among the findings.` and `Say what would settle it; the
critic checks it against the integrated tree.` (both deleted); rule 6 keeps its severity rule
and gains the actor. Today's `critic.md`: the intro names `a cannot-verify checklist
escalated by the per-task referees`; the mandate list is five duties (`1. Claim`, `2.
Interfaces`, `3. Context`, `4. Proof`, `5. The cannot-verify checklist`); the `blocking`
definition names `an interface pair that does not line up`, `a Proof leg with no test, a
checklist item that fails against the tree` — after this task it names a Claim unmet and a
Context literal implemented two ways. Duty 2 is settled by the compiler's edges plus the
INTEGRATED RUN EVIDENCE, duty 4 by the wave-0 examiner plus the proof gate, "task N did not
land" by the deliverables check (`missingDeliverables`). `fix.md` opens `You are fixing your
own prior implementation of this task, in the same tree — … The referee found the blocking
issues listed below.` `README.md` line 17: `and what a diff cannot settle is a question for the
editor rather than a finding against the author.` The sims: `test_roles_peer.mjs` legs — (a)
no `adversarial` in any role file, (b) three verbatim referee sentences (delete), (c) three
regex rule pins (`plan-defect:…blocking…FILES`, `red-then-green`, `neither a finding nor a
\`cannotVerify\` entry` — rewrite the third as `/unverified:/` and keep the negative assertion
against `fix.md`), (d) one verbatim `fix.md` sentence (delete), (e) one verbatim
`implementer.md` sentence (delete), (f) the critic opener + `deferredVerification` + five
exactly-once counts (rewrite: `1. Claim` and `2. Context` once each, `3.`/`4.`/`5.` absent),
(g) shout sweep, (h) README names all seven role files. `test_run_engine.mjs` lines 157–162
assert `/red-then-green/` and `/neither a finding nor a \`cannotVerify\` entry/` on the
reviewer text. `test_run_engine_critic_inputs.mjs` block 8 (lines ~302–322) asserts
`critic.md` says `Stale-if and Authorized-by are not yours to judge` and carries a per-slot
check for Claim/Interfaces/Context/Proof. `test_exam_edited_patches.mjs` legs (d)+(e) (lines
185–205) freeze sha256 digests of `test_run_engine.mjs`, `test_run_engine_fixloop.mjs`,
`test_run_engine_cap_width.mjs`, `test_run_engine_proposed_patch.mjs` and re-run each —
editing `test_run_engine.mjs` breaks the digest, so both legs go (a frozen digest of a
sibling file is a pin that cannot fail for any reason a reader would want). `tests/test_roles_run_evidence.py`
holds `REVIEWER_PARAGRAPH` (an awk over blank-line records requiring `RUN EVIDENCE`, `exit
0`, `settled`, `neither a finding nor a .cannotVerify`, `re-execution`, `non-zero`, `fix
loop.s, not the referee`) with a liveness twin, `CRITIC_PARAGRAPH` (unchanged phrases), the
four-reasons grep, the register test, a test that shells out to both role sims, and the
report-format legs — keep every test, change only the deleted phrase to `not a finding`.

**Proof:**
- Run: `! grep -q 'cannotVerify' fleet/roles/reviewer.md && awk 'BEGIN{RS=""} /actor/ && /implementer/ && /plan/ && /never sent to a fix round/ && /parks/ {f=1} END{exit !f}' fleet/roles/reviewer.md`
- Run: `awk 'BEGIN{RS=""} /cannot settle/ && /minor/ && /unverified:/ {f=1} END{exit !f}' fleet/roles/reviewer.md`
- Run: `awk 'BEGIN{RS=""} /prose/ && /GLOBAL CONSTRAINT/ && /minor/ {f=1} END{exit !f}' fleet/roles/reviewer.md`
- Run: `awk 'BEGIN{RS=""} /how the work was produced/ && /is not a finding/ {f=1} END{exit !f}' fleet/roles/reviewer.md`
- Run: `awk 'BEGIN{RS=""} /RUN EVIDENCE/ && /re-execution/ && /is not a finding/ {f=1} END{exit !f}' fleet/roles/reviewer.md`
- Run: `awk 'BEGIN{RS=""} /CHECK EVIDENCE/ && /fix loop/ && /\(minor\)/ && /blocks nothing/ {f=1} END{exit !f}' fleet/roles/reviewer.md`
- Run: `! grep -qi 'cannot-verify' fleet/roles/critic.md && ! grep -qi 'checklist' fleet/roles/critic.md && ! grep -q 'Interfaces:' fleet/roles/critic.md && test "$(grep -c '^1\. Claim' fleet/roles/critic.md)" -eq 1 && test "$(grep -c '^2\. Context' fleet/roles/critic.md)" -eq 1 && ! grep -qE '^(3|4|5)\. ' fleet/roles/critic.md && awk 'BEGIN{RS=""} /INTEGRATED RUN EVIDENCE/ && /authoritative/ && /re-execution/ && /settled/ && /not a .deferredVerification/ && /human judgment/ && /not for a command the driver ran/ {f=1} END{exit !f}' fleet/roles/critic.md && grep -q 'INTEGRATED CHECK EVIDENCE' fleet/roles/critic.md && grep -q 'browser, runtime, external, manual' fleet/roles/critic.md`
- Run: `awk 'BEGIN{RS=""} /referee/ && /Run:/ && /Check:/ && /exit non-zero/ {f=1} END{exit !f}' fleet/roles/fix.md && ! grep -q 'question for the editor' fleet/roles/README.md && grep -q 'unverified:' fleet/roles/README.md`
- Run: `! grep -nE '\b(NEVER|ALWAYS|MUST)\b' fleet/roles/reviewer.md fleet/roles/critic.md fleet/roles/fix.md fleet/roles/README.md && ! grep -qi 'adversarial' fleet/roles/reviewer.md fleet/roles/critic.md fleet/roles/fix.md fleet/roles/README.md`
- Run: `! grep -q 'REFEREE_SENTENCES' fleet/tests/test_roles_peer.mjs && ! grep -q 'FIX_SENTENCE' fleet/tests/test_roles_peer.mjs && ! grep -q 'IMPLEMENTER_SENTENCE' fleet/tests/test_roles_peer.mjs && grep -q 'unverified:' fleet/tests/test_roles_peer.mjs && ! grep -q 'cannotVerify' fleet/tests/test_run_engine.mjs && ! grep -q 'sha256' fleet/tests/test_exam_edited_patches.mjs && node fleet/tests/test_roles_peer.mjs | grep -q 'ALL TESTS PASSED' && node fleet/tests/test_run_engine.mjs | grep -q 'ALL TESTS PASSED' && node fleet/tests/test_run_engine_critic_inputs.mjs | grep -q 'ALL TESTS PASSED' && node fleet/tests/test_exam_edited_patches.mjs | grep -q 'ALL TESTS PASSED' && python3 -m pytest -q tests/test_roles_run_evidence.py`
- Legs: (a) the first Run: exits non-zero if `cannotVerify` survives in the reviewer file or
  if no single blank-line-delimited paragraph carries all five actor phrases (`actor`,
  `implementer`, `plan`, `never sent to a fix round`, `parks`) [M1]; (b) the second exits
  non-zero unless one paragraph carries `cannot settle`, `minor` and `unverified:` together
  [M2]; (c) the third exits non-zero unless one paragraph carries `prose`, `GLOBAL
  CONSTRAINT` and `minor` together [M3]; (d) the fourth exits non-zero unless one paragraph
  carries `how the work was produced` and `is not a finding` together [M4]; (e) the fifth
  exits non-zero unless one paragraph carries `RUN EVIDENCE`, `re-execution` and `is not a
  finding` together [M5]; (f) the sixth exits non-zero unless one paragraph carries `CHECK
  EVIDENCE`, `fix loop`, `(minor)` and `blocks nothing` together [M6]; (g) the seventh exits
  non-zero if the critic file still says `cannot-verify`, `checklist` or `Interfaces:`, if
  `1. Claim` or `2. Context` is not a line appearing exactly once, if any line begins `3. `,
  `4. ` or `5. `, if the INTEGRATED RUN EVIDENCE paragraph lost any of its seven phrases, or
  if `INTEGRATED CHECK EVIDENCE` or the four-reason list is absent [M7]; (h) the eighth
  exits non-zero if no paragraph of `fix.md` names the referee, `Run:`, `Check:` and `exit
  non-zero` together, or if the README still says `question for the editor` or lacks
  `unverified:` [M8, M9]; (i) the ninth exits non-zero on any shouted whole word or any
  `adversarial` in the four files [M10]; (j) the tenth exits non-zero if any of the three
  verbatim-sentence constants survives in the peer sim, if that sim does not pin
  `unverified:`, if `test_run_engine.mjs` still names `cannotVerify`, if a `sha256` digest
  survives in `test_exam_edited_patches.mjs`, if any of the four sims fails to print `ALL
  TESTS PASSED`, or if the pytest file fails [M11].

**Stale-if:**
- path-absent: `fleet/roles/reviewer.md`
- path-absent: `fleet/roles/critic.md`
- path-absent: `tests/test_roles_run_evidence.py`
- issue-closed: #232
