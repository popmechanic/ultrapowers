# The driver runs each green proof once and pre-authorizes the ack its own Run: settled

**Grammar:** claims-v1

**Claim:** A task whose iter-0 proofs are green runs each proof exactly once, and a deferred:manual ack that cites a green Run: the driver executed lands in the PR body's residual list instead of parking the run. (elicited)

**Goal:** #713 and #753 — two defects of the deterministic driver, one in the engine's per-task
proof pass and one in the driver's ack decision, both read off live runs. #713: runs 27 and 28
(ledger rows 12f3b788982a2f3f, 80a045f84c7917c0) and run-12's events show every `Run:`, exam and
`Check:` command executed twice per task, at `iter: 0` and `iter: 1`, with no fix between and
identical results. The mechanism, named at BASE: `fleet/run-engine.mjs:1300-1314` runs the driver's
own pre-review pass (`prePass` → `runCommands(0)`, `runExam(0)`, `runChecks(0)`), and when it is
green nothing is kept but the fact — then the review loop at `fleet/run-engine.mjs:1365` opens with
`runCommands(iter)`, `runExam(iter)`, `runChecks(iter)` at `iter = 1` (lines 1372–1376),
unconditionally, on the same tree the pass just measured. The comment above them says "once per
review round" and it is: the pre-review pass is a third execution site nobody made the round
conditional on. After this run the round-1 referee reads the pass's own evidence and a fresh
execution happens only after a fix has landed. #753: run-39 (#706 held solo — task done, review
clean, 0 fix rounds, suite green) parked `NEEDS_ACK` on one `deferred:manual` ack whose detail said
the sentence's presence was settled by the driver's integrated `Run:` evidence and only whether the
prose reads correctly was human judgment; run-40 parked on the same class. `ackDecision`
(`fleet/run-main.mjs:262`) pre-authorizes only `deferred:runtime` and `deferred:external` (#243's
closed list). After this run a manual ack whose detail cites, verbatim, a `Run:` command the driver
executed on the adopted tree with exit 0 is pre-authorized; a manual ack citing none still parks.
**Closes:** #713 #753

**Tech Stack:** Node 22 ESM (`fleet/*.mjs`); the engine sims run the real engine below the agent
seam (real git, clones, patch capture, the fold kernel and the real `sh` seam) with canned
judgments, through `rig()` of `fleet/tests/_engine_helpers.mjs`; the driver sim
`fleet/tests/test_run_main.mjs` drives `runMain` with an `exec` stub that writes the real
`gate-receipt.json` shape (`gateCheck.acks`) and a `runEngineFn` that returns a canned report. The
suite is `python3 -m pytest` from the repo root, which bridges every `fleet/tests/test_*.mjs`
through `tests/test_fleet_suite.py` (sentinel `ALL TESTS PASSED`, no network).

**Exam command:** node {paths}

**Parallelization rationale:** one wave, width 2. The engine's proof pass (Task 1) and the driver's
ack decision (Task 2) are two contracts over two files (`fleet/run-engine.mjs` and
`fleet/run-main.mjs`), two exam files and disjoint Files blocks; neither consumes a symbol the other
produces, and neither needs the other's runtime behaviour — the ack decision reads
`report.integratedRuns`, which the integrated pass writes at BASE and Task 1 does not touch. No
chain is drawn.

## Global Constraints

- Check: `git diff --quiet $ULTRA_BASE -- skills/ultrapowers/scripts/gate_check.py skills/ultrapowers/scripts/ultra_gate.py skills/ultrapowers/scripts/run_acceptance.sh`
- The verification periphery is frozen (0.1.0): the gate scripts named in the Check above are
  byte-identical to BASE — the ack's `type` and `detail` are still the strings
  `gate_check.py` writes today.
- No leg this plan adds to any `fleet/tests/test_*.mjs` compares the tree to BASE, reads
  `ULTRA_BASE` as a base to diff against, or embeds a 40-hex commit sha; the `BASE_SHA` constant
  `fleet/tests/test_run_engine_proof_runs.mjs` already carries at BASE stays exactly as it is.
- The run record stays data: `driver:proof-run`, `driver:exam-run` and `driver:check-run` events
  keep their BASE fields (`task`, `cmd`, `exit`, `iter`, and `minor` on a check), and
  `driver:ack-decision` keeps `approve` and `reason`.
- The parked reason literal `non-pre-authorized ack(s): deferred:manual` is unchanged for a manual
  ack that cites no executed evidence (`tests/test_fleet_events.py` pins it).
- Every assertion that stands at BASE in the sims a task's Files names still holds, except the ones
  that task's Context names as re-scoped with what replaces them; the new legs sit under a comment
  naming their task.
- `fleet/roles/critic.md` keeps the shape `fleet/tests/test_roles_peer.mjs` pins: it opens with
  `You are the editor's completeness read of the whole submission.`, carries `1. Claim` and
  `2. Context` exactly once each, no line beginning `3. `, `4. ` or `5. `, and neither the word
  `checklist` nor `cannot-verify` in any case.

**Acceptance:** suite — the committed suite is the verification.

### Task 1: The driver runs a green proof once before the first review

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/run-engine.mjs`
- Modify: `fleet/tests/test_run_engine_pre_review.mjs`
- Modify: `fleet/tests/test_run_engine_exam_evidence.mjs`
- Modify: `fleet/tests/test_run_engine_implementer_suite.mjs`
- Modify: `fleet/tests/test_run_engine_review_economy.mjs`
- Modify: `fleet/tests/test_run_engine_integrated_runs.mjs`
- Test: `fleet/tests/test_run_engine_proof_runs.mjs`

**Claim:** A task whose iter-0 proofs are all green has exactly one `driver:proof-run` per proof bullet. (quoted from #713)
Machine: M1. For a task whose every `proofRuns` command, exam and non-minor `Check:` exits 0 on the
driver's pre-review pass, the run's `events.jsonl` carries, for that task, exactly one
`driver:proof-run` per `proofRuns` entry, exactly one `driver:exam-run` when the task has a
runnable exam, and exactly one `driver:check-run` per `Check:`, every one of them `iter: 0` and
before the task's first `review:` dispatch; and the `review:<id>:1` prompt's `RUN EVIDENCE:`,
`EXAM EVIDENCE` and `CHECK EVIDENCE` blocks carry that pass's commands, exits and outputs.
M2. When the pre-review pass is red, the one `fix:<id>:0` repair round and the one re-execution
that follows it happen as at BASE (both executions `iter: 0`), and the `review:<id>:1` prompt
carries the re-execution's evidence with no third execution before it.
M3. A review-round fix (`fix:<id>:1`) is followed by one fresh execution of every command at
`iter: 2`, and the `review:<id>:2` prompt carries that execution's output and not round 1's.
M4. The order of the driver's own executions around the referee is BASE's — implementer, the
pre-review pass, `review:<id>:1`, the integrated pass on the adopted tree — and the task row's
`proofFixes`, `fixIterations`, `reviewVerdict` and `status` are what BASE reports for the same
canned judgments.
M5. Every assertion of the five Modify sims that pinned a second execution at `iter: 1` is
re-scoped to the single execution, and each of the five prints `ALL TESTS PASSED`.

**Authorized-by:** #713 (bug, determinism); the 2026-09-06 reading of runs 27/28 (ledger rows
12f3b788982a2f3f, 80a045f84c7917c0); #589 (the driver executes `Run:` proofs) and #638 (the
driver executes the exam).

**Interfaces:**
- Consumes: `runEngine({ args, agent, parallel, exec, paths, log, phase, rolesDir, patchBase })`
- Produces: nothing a sibling consumes — the event record and the review prompt are read by the referee and by a sense pass, never by a task

**Context:** The mechanism at BASE, by line: `fleet/run-engine.mjs:1252-1283` define
`runCommands(iter)`, `runExam(iter)` and `runChecks(iter)`, each appending one event per execution
with the `iter` it was given; `fleet/run-engine.mjs:1300-1314` is `prePass`, which calls all three
at `iter` 0 and returns only the reds, discarding the evidence; a red pass buys `fix:<id>:0` and a
second `prePass` (line 1345, still `iter` 0); then the review loop `for (let iter = 1; iter <= 2;
iter++)` at line 1365 calls `runCommands(iter)`, `runExam(iter)`, `runChecks(iter)` at lines
1372–1376 before building the reviewer prompt, on the same clone and the same tree the pass just
measured — there is no fix between the green pass and round 1, so the second execution is
unconditional. The change: keep the last pre-review pass's evidence (runs, exam, checks — the same
`{ cmd, exit, stdout }` records `runCommands` returns) and hand it to round 1; execute afresh only
at round 2, which follows `fix:<id>:1`. A task with no `proofRuns`, no runnable exam and no
`Check:` skips the pass at BASE (`if (proofRuns.length || constraintChecks.length ||
examRunnable)`) and its round-1 blocks are empty either way. `minorNoted` de-duplicates the minor
Check judgment call at BASE; with one execution it is pushed once as before. Nothing about the
integrated pass changes: `driver:integrated-run` (line ~1987) is a separate site on the adopted
tree and keeps executing every merged task's `Run:` once per wave. The `iter` field stays the
number of the pass that produced the execution — `0` for the driver's own pass and its
post-repair repeat, `2` for the execution after a review fix — so the sense pass that counts
executions per iter keeps its meaning. Re-scoped BASE pins, all owned here (the task-side rule:
an assertion that counted or ordered the `iter: 1` execution now counts the single pass):
`fleet/tests/test_run_engine_proof_runs.mjs` — the order pin at line 143 (`['impl:T1',
'proof-run', 'proof-run', 'review:T1:1', 'proof-run']` becomes one `proof-run` before the review),
the `[0, 1]` / `[0, 0, 1, 1]` / `[0, 0, 1]` iter pins at lines 153, 190, 397 and 503 and the
event counts and command lists beside them, and the header comment's M1 sentence saying execution
happens TWICE before the first review; `fleet/tests/test_run_engine_pre_review.mjs` — line 327
(the green second pass precedes an `iter === 1` event; now: precedes the `review:T1:1` dispatch)
and lines 469–472 (the `[M3]` review-round `driver:check-run` at `iter: 1` — now: the two checks
have exactly one event each, at `iter: 0`, and the `CHECK EVIDENCE` block of `review:T1:1`
carries both); `fleet/tests/test_run_engine_exam_evidence.mjs` — the order at lines 192–196
(`'exam-run', 'exam-run', 'exam-run'` becomes two: wave 0's red-at-BASE probe and the pass) and
the `events.length, 2` / `[0, 1]` pins at lines 198–206; `fleet/tests/test_run_engine_implementer_suite.mjs`
— lines 251–256 (`round1.length, 1` becomes: no `driver:exam-run` at `iter` 1, and the
`review:T1:1` prompt's `EXAM EVIDENCE` line `$ <T1_CMD>` is the pass's);
`fleet/tests/test_run_engine_review_economy.mjs` — the `TOGGLE` scenario at lines 218–245, whose
command is green on its first execution and red on its second, relied on the second execution
being round 1's: re-scope it so round 1's canned reviewer returns one blocking issue, the fix
`fix:A:1` lands, the fresh `iter: 2` execution reads red, the task ends `fix-loop-exhausted`, and
`reviewEconomy.blockingFindings` counts only the reviewer's one — the driver-minted red is still
not a reviewer's finding; `fleet/tests/test_run_engine_integrated_runs.mjs` — lines 549–553
(four `driver:proof-run` events, two at `iter` 1, become two events, both at `iter` 0). The
review-loop comment at lines 1366–1370 ("Once per review round, not once per task …") is
rewritten to say what is now true: round 1 reads the pass, round 2 executes afresh.
**BASE facts:** (generated at 89e06af)
- `proofRuns` at `fleet/run-engine.mjs:1017` blob 8694de1
- `proofFixes` at `fleet/run-engine.mjs:1145` blob 8694de1
- `status` at `fleet/claude-token.mjs:358` blob b7e8e7b
- `fleet/run-engine.mjs` blob 8694de1
- `fleet/run-engine.mjs` blob 8694de1
- `prePass` at `fleet/run-engine.mjs:1300` blob 8694de1
- `runCommands` at `fleet/run-engine.mjs:1252` blob 8694de1
- `fleet/tests/test_run_engine_proof_runs.mjs` blob 7d57d3f
- `fleet/tests/test_run_engine_pre_review.mjs` blob b2dccab
- `fleet/tests/test_run_engine_exam_evidence.mjs` blob 7ab5c73
- `fleet/tests/test_run_engine_implementer_suite.mjs` blob 7f142f7
- `fleet/tests/test_run_engine_review_economy.mjs` blob ec3fc9b
- `TOGGLE` at `fleet/tests/test_run_engine_pre_review.mjs:506` blob b2dccab
- `fleet/tests/test_run_engine_integrated_runs.mjs` blob aec720f
- `done` at `fleet/run-worker.mjs:953` blob da08fc7
- `clean` at `fleet/claude-token.mjs:109` blob b7e8e7b
- `failed` at `fleet/run-engine.mjs:911` blob 8694de1
- `fleet/run-engine.mjs` blob 8694de1

**Proof:**
- Test: `fleet/tests/test_run_engine_proof_runs.mjs`
- Run: `node fleet/tests/test_run_engine_pre_review.mjs | grep -q 'ALL TESTS PASSED'`
- Run: `node fleet/tests/test_run_engine_exam_evidence.mjs | grep -q 'ALL TESTS PASSED'`
- Run: `node fleet/tests/test_run_engine_implementer_suite.mjs | grep -q 'ALL TESTS PASSED'`
- Run: `node fleet/tests/test_run_engine_review_economy.mjs | grep -q 'ALL TESTS PASSED'`
- Run: `node fleet/tests/test_run_engine_integrated_runs.mjs | grep -q 'ALL TESTS PASSED'`
- Legs, under a comment naming this task (`#713 Task 1`), each on its own rig with a canned
  reviewer that passes unless the leg says otherwise: (a) one task with `proofRuns` of two
  commands in Proof order, a `Check:` and a runnable exam, every one green: the task's
  `driver:proof-run` events are exactly two, the first command then the second, both `exit` 0 and
  `iter` 0; its `driver:exam-run` events are exactly one and its `driver:check-run` events
  exactly one, both `iter` 0; the last of those events precedes the `review:T1:1` dispatch in the
  run's order file; no event of the three kinds for the task carries `iter` 1; and the
  `review:T1:1` prompt's `RUN EVIDENCE:` block quotes both commands with `exit 0` and the line only
  the task's own clone could print — a BASE engine, which records each of the four commands twice,
  fails the counts [M1]; (b) one command that is green on every execution: the recorded order is
  exactly `['impl:T1', 'proof-run', 'review:T1:1', 'proof-run']` (the last being the integrated
  pass), the task row is `status` `done`, `reviewVerdict` `clean`, `fixIterations` 0,
  `proofFixes` 0, and no `fix:` label was dispatched [M1, M4]; (c) a command that reads a file the
  repair round writes (red first, green after `fix:T1:0`): the dispatch order is `impl:T1`,
  `fix:T1:0`, `review:T1:1`; the task's `driver:proof-run` events are exactly two, exits `[1, 0]`
  and iters `[0, 0]`; the `review:T1:1` `RUN EVIDENCE:` block carries `exit 0` and what the command
  printed after the repair and not `exit 1`; and the row reports `proofFixes` 1, `fixIterations`
  0 — an engine that executes a third time before round 1 fails the count [M2]; (d) a command that
  prints the content of a file the review fix rewrites, with a canned reviewer returning one
  blocking issue in round 1 and PASS in round 2: the dispatch order is `impl:T1`, `review:T1:1`,
  `fix:T1:1`, `review:T1:2`; the task's `driver:proof-run` events are exactly two, iters `[0, 2]`;
  the `review:T1:2` prompt's `RUN EVIDENCE:` block carries the post-fix content and not the
  pre-fix content; and the row reports `fixIterations` 1, `reviewVerdict` `fixed` [M3]; (e) a
  command red on every execution: the dispatch order is `impl:T1`, `fix:T1:0`, no `review:`; the
  events are exactly two with exits `[3, 3]` and iters `[0, 0]`; and the row is `status` `failed`,
  `reviewVerdict` `proof-red`, `proofFixes` 1 — BASE's own shape, unchanged [M2, M4]; (f) the first `Run:` exits 0 —
  `fleet/tests/test_run_engine_pre_review.mjs` prints its sentinel with its `iter === 1` pins
  re-scoped, and a copy still asserting a `driver:check-run` at `iter` 1 prints none [M5]; (g)
  the second `Run:` exits 0 — `fleet/tests/test_run_engine_exam_evidence.mjs` prints its sentinel
  with its three-`exam-run` order and `[0, 1]` pins re-scoped, and a copy still expecting two
  post-patch `driver:exam-run` events prints none [M5]; (h) the third `Run:` exits 0 —
  `fleet/tests/test_run_engine_implementer_suite.mjs` prints its sentinel with its
  `round1.length, 1` pin re-scoped, and a copy still expecting a `driver:exam-run` at `iter` 1
  prints none [M5]; (i) the fourth `Run:` exits 0 — `fleet/tests/test_run_engine_review_economy.mjs`
  prints its sentinel with the `TOGGLE` scenario re-scoped so the red surfaces at `iter` 2 after
  a reviewer-driven fix, and a copy still expecting the toggle's second execution in round 1
  prints none [M5]; (j) the fifth `Run:` exits 0 — `fleet/tests/test_run_engine_integrated_runs.mjs`
  prints its sentinel with its four-event, two-at-`iter`-1 pin re-scoped to two events at
  `iter` 0, and a copy still counting four prints none [M5].

**Stale-if:**
- path-absent: `fleet/run-engine.mjs`
- path-absent: `fleet/tests/test_run_engine_proof_runs.mjs`
- path-absent: `fleet/tests/test_run_engine_pre_review.mjs`
- issue-closed: #713

### Task 2: A manual ack settled by the driver's own executed Run: is pre-authorized

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/run-main.mjs`
- Modify: `fleet/roles/critic.md`
- Modify: `skills/ultrapowers/references/report-format.md`
- Test: `fleet/tests/test_run_main.mjs`

**Claim:** The ack decision pre-authorizes a `deferred:manual` ack whose `detail` cites `Run:` evidence the driver executed and that exited 0 (quoted from #753)
Machine: M1. `ackDecision(gateReceipt, report)` approves a `NEEDS_ACK` receipt whose acks are each
`deferred:runtime`, `deferred:external`, or a `deferred:manual` ack whose `detail` contains,
verbatim, the `cmd` of at least one entry of `report.integratedRuns` with `exit` 0 and contains the
`cmd` of no entry with a non-zero `exit`; its `reason` names `#753` when a manual ack was
pre-authorized this way; and in `runMain` such a run emits `driver:ack-decision` with `approve`
true, writes `standing-approval.json` whose `ackList` holds that ack, issues `--approve`, and
returns verdict `approved` with exit code 0.
M2. A `deferred:manual` ack whose `detail` contains no `cmd` of a green `report.integratedRuns`
entry — a detail that names none, a report with no `integratedRuns` or an empty one, or a receipt
read with no report — is not pre-authorized, and one whose `detail` contains the `cmd` of a red
entry is not pre-authorized even when it also contains a green one: `ackDecision` returns
`approve` false with `reason` exactly `non-pre-authorized ack(s): deferred:manual`, and in
`runMain` the run returns verdict `needs-ack` with exit code 1, no `standing-approval.json` and no
`--approve` call.
M3. `deferred:runtime` and `deferred:external` acks approve with BASE's reason literal
(`<n> deferred runtime/external ack(s) — pre-authorized (#243)`) when no manual ack was
pre-authorized; a `coverage` ack and a `deferred:plan-defect` ack still park, whatever the
report's `integratedRuns` holds; and `acksOf` reads `gateCheck.acks` only.
M4. `fleet/roles/critic.md` tells the critic that a `manual` item whose presence the driver's
executed evidence settles quotes that command verbatim, as the `$ <cmd>` line of the
INTEGRATED RUN EVIDENCE block gives it, in the item's `why`; and
`skills/ultrapowers/references/report-format.md`'s `deferredVerification` row and its Approve
bullet say that a `deferred:manual` ack whose detail quotes a green integrated `Run:` verbatim is
pre-authorized and that one quoting none is not.

**Authorized-by:** #753 (bug, fleet); #243 (the closed pre-authorized list this widens by one
mechanical case); #592 (a prose deliverable proves itself with `Run:` commands); #711 (the
residual sink, open — see Context).

**Interfaces:**
- Consumes: `acksOf(gateReceipt)`
- Consumes: `criticDecision(report)`
- Produces: `ackDecision(gateReceipt, report)`

**Context:** The ack's shape is `gate_check.py`'s and is frozen: for each item of the report's
`deferredVerification` it appends `{ type: 'deferred:' + reason, detail: deliverable + ' — ' +
why }` (lines 132–140; the `[structural false-green …]` suffix is added for `runtime`/`external`
only), and `ultra_gate.py` nests that object under `gateCheck` — `acksOf` at
`fleet/run-main.mjs:259` is the one reader and stays so. `runMain` already reads the report at
`readJson(resultPath)` for `criticDecision` (line 724), so the same object reaches
`ackDecision(gr, report)` at line 739; the report's `integratedRuns` is the driver's own
re-execution of every merged task's `Run:` on the adopted tree, `[{ task, cmd, exit, stdout }]`
(`fleet/run-engine.mjs:1986`, rendered to the critic as `$ <cmd>` / `exit <n>` lines by
`integratedRunEvidenceBlock`), so the citation test is a verbatim substring of an executed
command: `detail.includes(run.cmd)` for a run with `exit === 0`, and no `detail.includes(run.cmd)`
for a run with `exit !== 0`. Citing is the critic's act and verifying is the driver's — the critic
is told (in `fleet/roles/critic.md`, beside its existing sentence that `manual` is for human
judgment and not for a command the driver ran) that when a `manual` item's presence is settled by
the driver's evidence and only the judgment remains, its `why` quotes the settling command
verbatim from the `$` line; a paraphrase is not a citation and parks as today, which is the safe
failure. The signature gains a second argument with a default (`report = {}`), so the BASE calls
`ackDecision(gr([...]))` in the sim keep their meaning: with no report no manual ack is
pre-authorized. The two reason literals: the parked one stays exactly
`non-pre-authorized ack(s): deferred:manual` (pinned by `tests/test_fleet_events.py:35` and
`tests/test_fleet_events.py:127`, which the fifth `Run:` runs), and BASE's approving one, `<n> deferred runtime/external ack(s) —
pre-authorized (#243)`, is unchanged when no manual ack was pre-authorized. A `deferred:plan-defect`
ack (the engine's own, `fleet/run-engine.mjs:2234`) is never pre-authorized, as `report-format.md`
says. What "the PR body's residual list" is at BASE: the sandbox renders the whole gate receipt
into the PR body's `### Checks` section (`fleet/sandbox-boot.sh:1206-1211`, `cat
gate-receipt.json`) and lists `standing-approval.json` under `### Evidence`, so a pre-authorized
ack is already in the body a reader opens; #711's checklist-and-follow-up-issue sink is open and
not built here — this task changes what parks, not what the card renders. `fleet/CONTRACT.md`
names the ack rule only as "the two-move rule's approval" (lines 197, 243) and is untouched; the
rule's prose lives in `skills/ultrapowers/references/report-format.md` (the `deferredVerification`
row, line 107, which today says a command the driver executed is never `manual`, and the Approve
bullet, line 150, which today lists `runtime` or `external` as the whole pre-authorized set) —
both gain the manual-with-verbatim-citation case; `fleet/tests/test_exam_edited_patches.mjs`
pins one other row of that table (`tasks[].proposedPatches`) as a whole line, which is why the
second `Run:` is there. The sim harness: `makeExecStub({ acks, gateExit })` in
`fleet/tests/test_run_main.mjs:337-343` writes the acks into the nested receipt, and
`runEngineFn` returns the report `runMain` writes to `workflow-result.json` — so a leg gives the
fake report an `integratedRuns` array and the fake gate a manual ack whose `detail` embeds a
command string of that array.
**BASE facts:** (generated at 89e06af)
- `detail` at `fleet/doctor.mjs:621` blob f9a1174
- `cmd` at `fleet/confine-hook.mjs:224` blob e0cd408
- `reason` at `fleet/run-engine.mjs:633` blob 8694de1
- `runMain` at `fleet/run-main.mjs:482` blob 97baef8
- `integratedRuns` at `fleet/run-engine.mjs:828` blob 8694de1
- `ackDecision` at `fleet/run-main.mjs:262` blob 97baef8
- `coverage` at `fleet/run-engine.mjs:2263` blob 8694de1
- `acksOf` at `fleet/run-main.mjs:259` blob 97baef8
- `fleet/roles/critic.md` blob 093bda9
- `manual` at `fleet/tests/test_run_engine_shallow.mjs:64` blob bc1cd56
- `why` at `fleet/doctor.mjs:437` blob f9a1174
- `skills/ultrapowers/references/report-format.md` blob 654d902
- `deferredVerification` at `fleet/run-engine.mjs:2237` blob 8694de1
- `fleet/run-main.mjs:259` blob 97baef8 line 259 `export const acksOf = (gateReceipt) =>`
- `criticDecision` at `fleet/run-main.mjs:278` blob 97baef8
- `fleet/run-engine.mjs:1986` blob 8694de1 line 1986 `integratedRuns.push({ task: t.id, cmd, exit: r.code, stdout:`
- `integratedRunEvidenceBlock` at `fleet/run-engine.mjs:316` blob 8694de1
- `fleet/run-engine.mjs:2234` blob 8694de1 line 2234 `planDeferred.push({ deliverable: p.task, reason: 'plan-defec`
- `fleet/sandbox-boot.sh` blob f2adff7
- `fleet/CONTRACT.md` blob 486545c
- `fleet/tests/test_exam_edited_patches.mjs` blob 048392d
- `fleet/tests/test_run_main.mjs` blob 20959b2
- `R` at `tests/test_ab_runner.py:22` blob 8d6cfbf
- `integrationBranch` at `fleet/run-engine.mjs:736` blob 8694de1
- `type` at `fleet/doctor.mjs:379` blob f9a1174
- `proposedPatches` at `fleet/run-engine.mjs:1142` blob 8694de1
- `fleet/run-main.mjs` blob 97baef8
- `fleet/tests/test_run_main.mjs` blob 20959b2

**Proof:**
- Test: `fleet/tests/test_run_main.mjs`
- Run: `node fleet/tests/test_roles_peer.mjs | grep -q 'ALL TESTS PASSED'`
- Run: `node fleet/tests/test_exam_edited_patches.mjs | grep -q 'ALL TESTS PASSED'`
- Run: `grep -n 'verbatim' fleet/roles/critic.md`
- Run: `grep -n 'deferred:manual' skills/ultrapowers/references/report-format.md`
- Run: `python3 -m pytest -q tests/test_fleet_events.py`
- Legs, under a comment naming this task (`#753 Task 2`), with `CMD_GREEN` a command string of
  the leg's choosing (say `sh -c 'grep -q sweep fleet/RUNBOOK.md'`), `CMD_RED` a second, and a
  report `R` whose `integratedRuns` is `[{ task: 'T1', cmd: CMD_GREEN, exit: 0, stdout: '' },
  { task: 'T1', cmd: CMD_RED, exit: 2, stdout: '' }]`: (a) pure —
  `ackDecision(gr([{ type: 'deferred:manual', detail: 'fleet/RUNBOOK.md §Rollback — settled by `'
  + CMD_GREEN + '`; whether it reads well is judgment' }]), R)` has `approve` true and a `reason`
  containing `#753`; the same with a second ack `{ type: 'deferred:external' }` also approves —
  BASE's decision, which parks on any `deferred:manual` type, fails both, and a decision that
  approves without reading `report.integratedRuns` fails the third row of the leg after next
  [M1]; (b) flow — `runMain` with `gateExit` 2, that manual ack, and a `runEngineFn` returning
  `R` (plus `integrationBranch`, `waveMerges: []`, `tasks: []`): exit code 0, verdict `approved`,
  `standing-approval.json` exists with `ackList` of length 1 whose one entry's `type` is
  `deferred:manual`, the `events.jsonl` `driver:ack-decision` event has `approve` true, and a
  call containing `--approve` was made [M1]; (c) pure, four rows, each `approve` false with
  `reason` exactly `non-pre-authorized ack(s): deferred:manual`: the manual ack with `detail`
  `'fleet/RUNBOOK.md §Rollback — whether it reads well is judgment'` against `R`; the citing ack
  of the first leg against a report `{}` and against `{ integratedRuns: [] }`; the citing ack of the
  first leg with no second argument; and an ack whose detail contains both CMD_GREEN and CMD_RED against
  `R` — a decision that pre-authorizes on any citation, or ignores the red entry, fails one of the
  four [M2]; (d) flow — `runMain` with `gateExit` 2, the non-citing manual ack, and `R`: exit code
  1, verdict `needs-ack`, no `standing-approval.json`, no call containing `--approve` [M2]; (e)
  pure — `ackDecision(gr([{ type: 'deferred:runtime' }, { type: 'deferred:external' }]), R)` approves
  with `reason` exactly `2 deferred runtime/external ack(s) — pre-authorized (#243)`;
  `ackDecision(gr([{ type: 'coverage', detail: CMD_GREEN }]), R)` and
  `ackDecision(gr([{ type: 'deferred:plan-defect', detail: CMD_GREEN }]), R)` each have `approve`
  false — a decision keyed on the detail alone fails both; and `acksOf({ acks: [{ type:
  'coverage' }] })` is `[]` [M3]; (f) the third `Run:` prints at least one line of
  `fleet/roles/critic.md` that names `manual` on the same line as `verbatim`, the fourth prints
  at least one line of `report-format.md` naming `deferred:manual` and `verbatim`, and the first,
  second and fifth `Run:` exit 0 — a role file that gained a `3. ` duty or the word `checklist`,
  or a report-format edit that broke the `proposedPatches` row, fails one of them [M4].

**Stale-if:**
- path-absent: `fleet/run-main.mjs`
- path-absent: `fleet/tests/test_run_main.mjs`
- path-absent: `fleet/roles/critic.md`
- issue-closed: #753
