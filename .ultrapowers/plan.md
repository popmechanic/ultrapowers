# A plan-defect against a Proof leg parks the task for the plan, and a strengthening exam edit is accepted

**Grammar:** claims-v1

**Claim:** When an implementer's first exam-red reply names a `plan-defect:` against a Proof leg (the actor-routing rule the engine already has for reviewer findings, `run-engine.mjs` ~1342), the driver does not dispatch the fix round for that task: it records the task as `failed` with actor `plan`, keeps the wave moving, and the gate row (#701) names the leg. (quoted from #722)

**Goal:** #722 and #700 — two lanes of the fix/park machinery in `fleet/run-engine.mjs`, both
found by ultralearn on the 0.3.17 epoch and both about a round the engine spends on a defect no
worker can repair. #722 (run-32 task 3): the peer's exam asserted what no implementation could
produce, the implementer said so as `plan-defect:` on its first red, and the driver still bought
the `fix:3:0` repair round (~10 min of a mostCapable worker) before ending the task `failed` and
blocking at the gate. #700 (run-25 task 7): the implementer made the peer's exam STRICTER, the
referee blocked on ownership alone under rule 8 of `fleet/roles/reviewer.md`, and the fix cap
turned that block into `fix-loop-exhausted` with 7/8 merged work stranded. The operator decided
#700 as option (a) on 2026-09-08: the referee's rule names the exception — an exam edit that only
strengthens the exam (every original assertion kept, new ones added) is recorded and accepted,
not blocked; (b), an ownership block with its own round outside the cap, was not chosen and is
not built here. For the referee to apply (a) it has to see what changed against the peer's bytes,
which today it cannot: the exam path is absent at BASE, so PATCH shows the edited exam only as a
whole-file add. So this plan is three contracts in one wave: the implementer's plan-defect park
(#722), the peer-vs-submission diff the driver appends under EXAM EDITED (#700's mechanism), and
rule 8 reworded to name the exception (#700's decision).
**Closes:** #722 #700

**Tech Stack:** Node 22 ESM (`fleet/*.mjs`); the engine sims run the real engine below the agent
seam (real git, real clones, real patch capture and the real fold kernel through the real `sh`
seam) with canned judgments — the shared `rig()` of `fleet/tests/_engine_helpers.mjs` (its repo's
suite is `bash check.sh`, its roles are the real seven under `fleet/roles/`) or a per-file rig of
the same shape with its own `rolesDir`. The suite is `python3 -m pytest` from the repo root, which
bridges every `fleet/tests/test_*.mjs` through `tests/test_fleet_suite.py` (sentinel
`ALL TESTS PASSED`, 300 s per file, no network). Judgment prompts are the plain files
`fleet/roles/*.md`, read at dispatch by `loadRoles()`.

**Parallelization rationale:** one wave, width 3. Task 1 (#722) and Task 2 (#700's mechanism)
both modify `fleet/run-engine.mjs` in different regions — the pre-review pass at lines 1423–1465
and the `planDeferred` loop at 2265–2270 for Task 1; the review-prompt assembly at line 1492 for
Task 2 — and same-file text edits fold. Task 3 (#700's decision) rewrites one numbered item of
`fleet/roles/reviewer.md` and consumes nothing at runtime from Task 2: the literal it names, the
`EXAM EDITED DIFF <path>:` block header, is a shared shape written into both Contexts, and a
referee reading a rule that names a block the driver does not yet append is a wording, not a
red tree. No chain: no task needs another's runtime behaviour.

## Global Constraints

- Check: `git diff --quiet $ULTRA_BASE -- skills/ultrapowers/scripts/gate_check.py skills/ultrapowers/scripts/ultra_gate.py skills/ultrapowers/scripts/run_acceptance.sh`
- The verification periphery is frozen (0.1.0) and the Check above is its pin; the gate row this
  plan produces is read by the frozen gate from `report.deferredVerification` exactly as at BASE
  (`{ deliverable, reason, why }` → an ack typed `deferred:<reason>`), never by a gate edit.
- No sim this plan adds or edits compares the tree to BASE, reads `ULTRA_BASE` as a base to diff
  against, or embeds a 40-hex commit sha; every sha a leg asserts is read from the sim's own
  repository at run time.
- Every task row the engine returned at BASE keeps its keys and their meaning; the one new row
  key, `actor`, is present only on a row the implementer's plan-defect parked, and absent from
  every other row.
- Every assertion that stands at BASE in the sims a task's Files names still holds, except the
  ones that task's Context names as re-scoped with what replaces them; new legs sit in the exam
  file named for their surface, under a comment naming the task.
- No file under `fleet/roles/` or `skills/` gains an upper-case whole-word NEVER, ALWAYS or MUST
  (`fleet/tests/test_run_engine_exam_fix_edit.mjs` leg (g) is the lens), and rule 6 of
  `fleet/roles/reviewer.md` keeps the phrase order its two pins read (`plan-defect:` … `blocking`
  … `FILES`, each within 80 characters of the last).

**Acceptance:** suite — the committed suite is the verification.

### Task 1: The implementer's plan-defect against a Proof leg parks the task for the plan

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/run-engine.mjs`
- Modify: `fleet/roles/implementer.md`
- Modify: `skills/ultrapowers/references/report-format.md`
- Test: `fleet/tests/test_run_engine_actor_routing.mjs`

**Claim:** When an implementer's first exam-red reply names a `plan-defect:` against a Proof leg (the actor-routing rule the engine already has for reviewer findings, `run-engine.mjs` ~1342), the driver does not dispatch the fix round for that task: it records the task as `failed` with actor `plan`, keeps the wave moving, and the gate row (#701) names the leg. (quoted from #722)
Machine: M1. On a task whose implementer reply is `DONE_WITH_CONCERNS` with a `concerns` entry
matching `/^plan-defect:[\s\S]*\([a-z]\)/` (the prefix, then somewhere a leg label — one
lowercase letter in parentheses), when the driver's pre-review pass finds the task's exam red
(`the Proof's exam failed: <cmd> — exit <n>` among its reds), no `fix:<id>:0` agent and no
`review:<id>:*` agent is dispatched: the labels dispatched for that task are exactly `exam:<id>`
and `impl:<id>`.
M2. That task's report row is `status: 'failed'`, `reviewVerdict: 'plan-defect'`,
`actor: 'plan'`, `fixIterations: 0`, `proofFixes: 0`, `exam: 'red'`, and its `notes` is the
matching concern entries joined by `; ` — so the leg's label and the concern's own text are in
`notes`.
M3. A sibling task in the same wave with no such concern merges as at BASE: with two tasks in the
wave, `coverage.tasks_merged` is 1, the sibling's row is `done`, and the wave's merge is
`MERGED`.
M4. `report.deferredVerification` carries exactly one item
`{ deliverable: <id>, reason: 'plan-defect', why: <the matching concern verbatim> }` for the
parked task; the frozen `gate_check.py` on that report exits 1 with verdict `BLOCKED` (its
`deliverables` check fails on the parked task's files) and its `acks` carry exactly one item of
type `deferred:plan-defect` whose `detail` contains the concern's text; and
`report.judgmentCalls` has exactly one entry equal to
`task <id>: plan-defect against a Proof leg named by the implementer — no fix round dispatched; failed with actor plan — <concern>`.
M5. A `DONE_WITH_CONCERNS` reply whose `plan-defect:` concern names no leg label — no
`(<lowercase letter>)` anywhere in it — with the same red exam dispatches `fix:<id>:0` as at BASE,
and its row has no `actor` key.
M6. A reply carrying a leg-labelled `plan-defect:` concern whose pre-review pass is GREEN
dispatches no `fix:<id>:0`, proceeds to `review:<id>:1`, and on a PASS review ends `done` with
no `actor` key and no `deferredVerification` item.
M7. A task that ended `fix-loop-exhausted` contributes no `deferredVerification` item, as at
BASE.
M8. `fleet/roles/implementer.md` tells the implementer the shape: its judgment-rules paragraph
contains the literal `plan-defect: leg (` and the phrase `naming the leg by its label`; and
`skills/ultrapowers/references/report-format.md` has exactly one line beginning
`| \`tasks[].reviewVerdict\` |`, which names `plan-defect` and still carries the sentence
`An edited exam is never a verdict of its own: it is recorded under \`examEdited\` and reviewed (2026-09-02).`,
one line beginning `| \`tasks[].actor\` |` that names `plan`, and its `deferredVerification` row
names the parked task's item.

**Authorized-by:** #722 (bug, peer-review); the actor-routing rule for reviewer findings already
in `fleet/run-engine.mjs` (`routeToPlan`, lines 1587–1606 at BASE `1c97ba44`) and its sim
`fleet/tests/test_run_engine_actor_routing.mjs`; #556 (an exam edit is reviewed, never refused —
untouched here); #663 (the implementer may not edit the exam — the reason it can only REPORT the
leg).

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** Nothing here is a sibling's to consume: the new row key, the verdict and the
judgment-call literal are read by the exam, the gate and the operator. The sim's parking concern
is one string, PARK_CONCERN =
`plan-defect: leg (a) asserts a.txt reads "impossible", which no implementation of this task can produce`
— the legs name it by that name. Every literal below was read at BASE `1c97ba44`. The lane to add sits in
`runTaskInner` of `fleet/run-engine.mjs` at the pre-review pass: `let reds = await prePass()` and
`if (reds.length) {` at line 1423, whose body today dispatches `agent(roles.fix + …, { label:
'fix:' + task.id + ':0', isolation: 'worktree', model: TIER.mostCapable, schema:
IMPLEMENTER_SCHEMA })`, then re-runs the pass and, still red, returns the `proof-red` row at
lines 1454–1463. The exam's red line is built by `const EXAM_FAIL = (e) => 'the Proof\'s exam
failed: ' + e.cmd + ' — exit ' + e.exit` and pushed by `prePass` as `reds.push({ line:
EXAM_FAIL(e), stdout: e.stdout })` when `preExam.exit !== 0`. The implementer's reply is `impl`,
schema `IMPLEMENTER_SCHEMA` (`status` one of `DONE`, `DONE_WITH_CONCERNS`, `NEEDS_CONTEXT`,
`BLOCKED`; `concerns: string[]`), and `noteConcerns(impl)` at lines 1003–1010 already pushes every
concern of a `DONE_WITH_CONCERNS` reply as a judgment call `'task ' + task.id + ': ' + c` — that
call stays, so a parked task has two calls, that one and M4's. The new lane goes BEFORE the
`fix:<id>:0` dispatch: when `reds` contains the exam's line and `impl.status ===
'DONE_WITH_CONCERNS'` and some `impl.concerns` entry matches `/^plan-defect:[\s\S]*\([a-z]\)/`,
return the M2 row instead — the same row shape as the sibling returns (`{ task, baseCorrected,
status: 'failed', branch: '', exam, reviewVerdict, notes, tier: economics.tier, review:
economics.review, fixIterations: 0, proposedPatches, proofFixes, ...examEditedField() }`) plus
`actor: 'plan'`, and record the concern for the gate. A red `Run:` or `Check:` beside the red
exam does not change the decision: the exam's red plus the implementer's leg-naming concern is
the whole condition. Where it fires, the wave already keeps moving: a `failed` row is excluded
from the fold by `isMergeable` (`r.status === 'done' && hasCoordinates(r)`, line 970) and joins
`missingDeliverables` (lines 2298–2305), so M3 is the substrate as it stands, and the sim only
pins it. The reviewer-findings actor rule this mirrors is `routeToPlan` at lines 1587–1606:
`planDefects.push({ task: task.id, detail })` for a blocking issue whose `actor === 'plan'` or
whose detail begins `plan-defect:` naming a backticked path outside FILES, with the judgment call
`'task ' + task.id + ': plan-defect names \`' + token + '\` outside FILES — routed to the plan'`.
The gate row is built at lines 2265–2270:

    const planDeferred = []
    for (const p of planDefects) {
      if (!doneTaskIds.has(p.task)) continue
      planDeferred.push({ deliverable: p.task, reason: 'plan-defect', why: p.detail })
      judgmentCalls.push('task ' + p.task + ': plan-defect deferred to the gate — ' + p.detail)
    }

— keyed on `done` rows on purpose (its comment: a failed task is already accounted under
`missingDeliverables`). The parked row is the one failed row that DOES carry a plan question, so
M4 adds its item beside that loop without widening the loop: keep a separate record of parked
tasks (id + concern) and push `{ deliverable, reason: 'plan-defect', why: concern }` for each,
with M4's judgment call pushed once at the park, not again here; M7 is the existing rule and its
existing assertion (`ar6` in the sim, "a task that is not `done` contributes no plan-defect
item") must keep passing. `gate_check.py`'s `emit()` returns 1 with verdict `BLOCKED` when any
check fails and still prints every ack: the `deliverables` check fails with detail
`failed/blocked tasks left declared deliverables unproduced: [{"task": "<id>", "files": [...]}]`,
and each `deferredVerification` item becomes `{ type: 'deferred:' + reason, detail: deliverable +
' — ' + why }`. The sim's rig: `fleet/tests/test_run_engine_actor_routing.mjs` uses the shared
`rig()` from `_engine_helpers.mjs` (real seven roles — `loadRoles()` reads `fleet/roles/`, and
`examiner.md` is there — so a wave entry with `proofTests: ['t1_test.sh']` and `testCmd: 'bash
t1_test.sh'` gets an `exam:<id>` dispatch beside `impl:<id>`; `mkTask` there sets `proofTests:
[]`, so the new block passes both keys through its `over` argument); the stub signature is
`(prompt, opts, cwd)` with `opts.label` one of `exam:<id>`, `impl:<id>`, `fix:<id>:<n>`,
`review:<id>:<n>`, `integration`; an examiner stub writes the exam file into `cwd` and returns
`{ status: 'DONE', summary, startHead: 'ignored' }`; a `DONE_WITH_CONCERNS` reply is
`{ status: 'DONE_WITH_CONCERNS', summary, startHead: gitSync(['rev-parse','HEAD'], cwd),
concerns: [...] }`. The exam that "asserts a value the fixture cannot produce":
`#!/bin/bash\n[ "$(cat a.txt)" = "impossible" ]\n` — red at BASE (`a.txt` is `line1\nline2\nline3\n`
in `makeRepo`) and red after an implementer that writes `implemented\n`. The gate invocation the
file already uses (block `ar1`): `spawnSync('python3', [path.join(SCRIPTS, 'gate_check.py'),
'--run-id', 'sim', '--branch', branch, '--report', reportPath, '--repo', integ])` after writing
the report to `<runDir>/workflow-result.json`. For M3 the sim builds a two-task wave through
`rig({ waves: [[taskA, taskB]] })` (`oneTaskRun` is one task by construction — write a sibling
helper rather than widening it), the sibling owning `b.txt` with no `proofTests`. Existing
assertions in that file all stand; the new legs go under a comment naming this task.
`report-format.md` at BASE: exactly one `| \`tasks[].reviewVerdict\` |` row (pinned to exactly
one, carrying the 2026-09-02 sentence, by `fleet/tests/test_run_engine_exam_fix_edit.mjs` leg
(f)); no `tasks[].actor` row; the `deferredVerification` row (line 105) says a `plan-defect` item
sits "on tasks whose final `status` is `done`" — amend that clause to add the parked row; the JSON
schema block near line 20 lists the task item's properties (`"reviewVerdict": {"type":"string"}`,
…) — add `"actor": {"type":"string"}` there. `fleet/roles/implementer.md`'s judgment-rules
paragraph begins at line 38 (`Judgment rules: treat FILES as your expected footprint…`) and
already says to disclose a fixed plan-supplied defect as a `concerns` entry prefixed
`plan-defect:`; add, in that paragraph, the sentence that names the park: a Proof leg no
implementation can satisfy — one that reads state your code creates, or asserts a shape a
sibling's contract forbids — is reported, not worked around: a `concerns` entry
`plan-defect: leg (x) …`, naming the leg by its label, and the driver then parks the task for the
plan instead of buying a fix round. Plain prose, no shouted verbs (leg (g) of
`test_run_engine_exam_fix_edit.mjs` walks every role file for a gained upper-case NEVER, ALWAYS
or MUST). `fix.md` is not in this task's Files and needs no edit: the round it describes is the
one this lane does not dispatch.

**Proof:**
- Test: `fleet/tests/test_run_engine_actor_routing.mjs`
- Run: `node fleet/tests/test_run_engine_actor_routing.mjs | grep -q 'ALL TESTS PASSED'`
- Run: `node fleet/tests/test_run_engine_exam_fix_edit.mjs | grep -q 'ALL TESTS PASSED'`
- Run: `node fleet/tests/test_run_engine_pre_review.mjs | grep -q 'ALL TESTS PASSED'`
- Run: `grep -q 'plan-defect: leg (' fleet/roles/implementer.md && grep -q 'naming the leg by its label' fleet/roles/implementer.md`
- Run: `test "$(grep -c 'tasks\[\]\.reviewVerdict' skills/ultrapowers/references/report-format.md)" = 1 && grep 'tasks\[\]\.reviewVerdict' skills/ultrapowers/references/report-format.md | grep -q 'plan-defect' && grep 'tasks\[\]\.actor' skills/ultrapowers/references/report-format.md | grep -q 'plan' && grep 'deferredVerification. | no |' skills/ultrapowers/references/report-format.md | grep -q 'actor'`
- Legs: (a) a one-wave, two-task run whose task T1 has a red-at-BASE exam
  `[ "$(cat a.txt)" = "impossible" ]` and an implementer stub returning `DONE_WITH_CONCERNS` with
  `concerns: [PARK_CONCERN]` (the Context's string, which names its leg by label) dispatches,
  for T1, exactly the labels `exam:T1` and `impl:T1` — the stub throws on any `fix:T1:*` or
  `review:T1:*` label, so a dispatched fix round fails the leg [M1]; (b) T1's row is
  `status: 'failed'`, `reviewVerdict: 'plan-defect'`, `actor: 'plan'`, `fixIterations: 0`,
  `proofFixes: 0`, `exam: 'red'`, and `notes` equals PARK_CONCERN — so it carries the leg label
  and the text [M2]; (c) the sibling T2 (files `b.txt`, no `proofTests`, a PASS review) has `status: 'done'`,
  `report.coverage.tasks_merged` is 1 and `waveMerges[0].status` is `MERGED` [M3]; (d)
  `report.deferredVerification` deep-equals
  `[{ deliverable: 'T1', reason: 'plan-defect', why: PARK_CONCERN }]`; the report written to
  `<runDir>/workflow-result.json` and handed to `gate_check.py --run-id sim --branch <branch>
  --report <path> --repo <integration clone>` gives exit status 1, `verdict: 'BLOCKED'`, a failing
  check named `deliverables`, and `acks` whose `type` list deep-equals `['deferred:plan-defect']`
  with that ack's `detail` containing PARK_CONCERN; and `report.judgmentCalls` has exactly
  one entry equal to `task T1: plan-defect against a Proof leg named by the implementer — no fix round dispatched; failed with actor plan — ` + PARK_CONCERN
  [M4]; (e) the same rig with `concerns: ['plan-defect: the exam cannot pass on this fixture']`
  (no leg label) dispatches `fix:T1:0`, and the row has no `actor` key (`'actor' in row` is
  false) [M5]; (f) `concerns: [PARK_CONCERN]` with a green exam
  (`[ "$(cat a.txt)" = "implemented" ]`) dispatches no `fix:T1:0`, dispatches `review:T1:1`, and
  on a PASS review the row is `done` with no `actor` key and `report.deferredVerification` is
  `[]` [M6]; (g) the file's existing `ar6` block still holds: a `fix-loop-exhausted` row
  contributes no `deferredVerification` item [M7]; (h) the two `Run:` greps over
  `implementer.md` and `report-format.md` exit 0 — an `implementer.md` without either literal, a
  `report-format.md` with two reviewVerdict rows or none naming `plan-defect`, with no actor
  row, or whose `deferredVerification` row does not say `actor`, exits 1 — and
  `test_run_engine_exam_fix_edit.mjs` prints `ALL TESTS PASSED` on the edited documents, which a
  `reviewVerdict` row that lost the 2026-09-02 sentence fails [M8].

**Stale-if:**
- path-absent: `fleet/tests/test_run_engine_actor_routing.mjs`
- path-absent: `fleet/roles/implementer.md`
- issue-closed: #722

### Task 2: The referee sees what an exam edit changed against the peer's bytes

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/run-engine.mjs`
- Test: `fleet/tests/test_run_engine_exam_edits.mjs`

**Claim:** A referee told that the exam was edited is shown, for each edited path, exactly what changed against the peer's bytes — so an edit that only strengthens the exam can be accepted and recorded, and one that drops an assertion can be blocked, on the hunks rather than on ownership. (derived)
Machine: M1. When a task's `examEdited` is non-empty, the review prompt carries, directly after
its `EXAM EDITED: <paths>` line, one block per edited path that begins with the line
`EXAM EDITED DIFF <path>:` and continues with a unified diff (`---`/`+++` header lines, `@@`
hunk headers, `-`/`+` content lines) from the bytes the examiner left at that path to the bytes
at that path in the graded tree; a path the examiner left absent diffs from empty.
M2. A fix-round edit that keeps the peer's line `[ -f one.txt ]` and appends the line
`[ "$(cat one.txt)" = "from T1" ]` yields, in that block, a content line
`+[ "$(cat one.txt)" = "from T1" ]` and no line beginning `-` other than the `---` header; with a
PASS re-review the row is `status: 'done'`, `reviewVerdict: 'fixed'`,
`examEdited: ['t1_test.sh']`, `exam: 'red'`, and the integration branch's `t1_test.sh` holds
both lines.
M3. A fix-round edit that replaces the peer's `[ -f one.txt ]` with `exit 0` yields, in that
block, the content line `-[ -f one.txt ]`; with a re-review returning one `blocking` issue whose
detail begins `the exam was weakened`, the row is `status: 'failed'`,
`reviewVerdict: 'fix-loop-exhausted'`, `examEdited: ['t1_test.sh']`, and
`coverage.tasks_merged` is 0.
M4. With no edit, the review prompt has no `EXAM EDITED:` line and no `EXAM EDITED DIFF` block;
and the judgment call for an edit stays exactly one entry naming the moved path, as at BASE.

**Authorized-by:** #700 (bug, peer-review) — the operator's decision of 2026-09-08 for option
(a), whose application needs the peer-vs-submission hunks; #556 (recorded as `examEdited`, named
to the referee, reviewed — never refused by the driver: the rule this task keeps and equips);
#551.

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** The block header `EXAM EDITED DIFF <path>:` is a shared literal that Task 3's rule
names — a shape written into both Contexts, not a symbol a sibling imports. Every literal below
was read at BASE `1c97ba44`. The review prompt is assembled in
`runTaskInner` of `fleet/run-engine.mjs` at line 1492:
`(examEdited && examEdited.length ? '\nEXAM EDITED: ' + examEdited.join(', ') : '')` between
`priorAdvisoriesBlock(priorMinors)` and `runEvidenceBlock(runEvidence)`. `examEdited` is the
array of Proof paths whose blob in the graded clone no longer matches the sha recorded at the
handoff (`examBlobs`, `[path, sha]` pairs from `git hash-object` — WITHOUT `-w`, so the sha names
no object in any store); the peer's bytes themselves survive in the examiner's clone
`<clonesDir>/exam-<id>` (`examDir`), which nothing removes during the task, at the same relative
path, and were copied into the graded clone at the handoff (lines 1288–1319:
`fs.copyFileSync(path.resolve(examDir, p), dest)` for every `[p, sha]` of `examinerBlobs` with a
non-null sha). So the diff M1 wants is between `<examDir>/<p>` (or empty, when the examiner left
`p` absent — `examinerBlobs` has a null sha for it) and `<cloneDir>/<p>`: `git diff --no-index
<a> <b>` produces it and exits 1 when the files differ, which is the expected exit here, not an
error; an alternative is `git hash-object -w` on both files in the graded clone and `git diff
<blobA> <blobB>` (exit 0, verified at authoring). Either way the content lines are what the
legs read — `-[ -f one.txt ]`, `+[ "$(cat one.txt)" = "from T1" ]` — never the header paths.
Two prompt pins stand at BASE and stay: `fleet/tests/test_run_engine_exam_together.mjs` line 319
asserts `prompt.includes('EXAM EDITED: t1_test.sh')`, and the first block of
`fleet/tests/test_run_engine_exam_edits.mjs` asserts `!prompts['review:T1:1'].includes('\nEXAM
EDITED: ')` for an unedited exam — so the `EXAM EDITED: <paths>` line keeps its exact text and
the new blocks follow it. Why the block is needed at all: `patchAgainstBase` diffs the graded
clone against BASE, where the Proof path does not exist, so PATCH shows an edited exam as a
whole-file add — the referee cannot see which lines the peer wrote. The sim file's rig is its
own (`rig({ waves, stub })` with a temp `rolesDir` holding the six real roles plus a sim
`examiner.md`); its helpers are `RED_AT_BASE = '#!/bin/bash\n[ -f one.txt ]\n'`, `examOk(cwd,
files)`, `writeOne(cwd)` (writes `one.txt` as `from T1\n`), `editExam(cwd)` (the weakening
rewrite to `exit 0`), `entry()` for the wave entry, and the stub shape `(prompt, opts, cwd)`
keyed on `opts.label` (`exam:T1`, `impl:T1`, `review:T1:1`, `fix:T1:1`, `review:T1:2`,
`integration`). Its second block already runs a weakening fix-round edit against a canned
blocking review and asserts `failed` / `fix-loop-exhausted` / `examEdited: ['t1_test.sh']`; the
new legs extend that shape under a comment naming this task, capturing the `review:T1:2` prompt
to read the block. The strengthening edit is a file the fix stub writes as
`RED_AT_BASE + '[ "$(cat one.txt)" = "from T1" ]\n'` — green on the tree `writeOne` made, so the
driver's round-2 exam evidence is green and the canned PASS carries the merge. The integration
branch's copy of `t1_test.sh` is read with `git show ultra/integration-<stamp>:t1_test.sh` in
the integration clone the rig returns (`integ`), where `stamp` is the rig's own. The judgment
call in M4 is the one `noteDrift` pushes: `'task ' + task.id + ': the fix round edited the exam
— ' + fresh.join(', ') + ' no longer matches the blob recorded at BASE; the review reads the
patch, exam hunks included'` — unchanged.

**Proof:**
- Test: `fleet/tests/test_run_engine_exam_edits.mjs`
- Run: `node fleet/tests/test_run_engine_exam_edits.mjs | grep -q 'ALL TESTS PASSED'`
- Run: `node fleet/tests/test_run_engine_exam_together.mjs | grep -q 'ALL TESTS PASSED'`
- Run: `node fleet/tests/test_run_engine_exam_fix_edit.mjs | grep -q 'ALL TESTS PASSED'`
- Legs: (a) after a blocking first review and a fix round that appends
  `[ "$(cat one.txt)" = "from T1" ]` to the peer's `t1_test.sh`, the captured `review:T1:2`
  prompt contains the line `EXAM EDITED: t1_test.sh` followed, before the `RUN EVIDENCE` text,
  by a line `EXAM EDITED DIFF t1_test.sh:` and then a `@@` hunk header [M1]; (b) that block
  contains the line `+[ "$(cat one.txt)" = "from T1" ]` and, after its `+++` header line, no
  line beginning `-` (`/\n-(?!--)/` does not match the block) [M2]; (c) on that run the row is
  `done` / `fixed` / `examEdited: ['t1_test.sh']` / `exam: 'red'`, `coverage.tasks_merged` is 1,
  and `git show ultra/integration-<stamp>:t1_test.sh` in the integration clone contains both
  `[ -f one.txt ]` and `[ "$(cat one.txt)" = "from T1" ]` [M2]; (d) with the fix round instead
  rewriting `t1_test.sh` to `#!/bin/bash\nexit 0 …` and the `review:T1:2` stub returning
  `{ verdict: 'FIX_REQUIRED', issues: [{ severity: 'blocking', detail: 'the exam was weakened — the peer\'s [ -f one.txt ] is gone', actor: 'implementer' }] }`,
  the captured `review:T1:2` prompt's block contains the line `-[ -f one.txt ]`, and the row is
  `failed` / `fix-loop-exhausted` / `examEdited: ['t1_test.sh']` with `coverage.tasks_merged` 0
  [M3]; (e) a Proof path the examiner left absent (`proofTests: ['t1_test.sh', 't1_extra.sh']`,
  examiner writes only the first) that the fix round creates yields a block
  `EXAM EDITED DIFF t1_extra.sh:` whose every content line begins `+` [M1]; (f) the file's first
  block still passes: an unedited exam gives a `review:T1:1` prompt with neither `\nEXAM EDITED: `
  nor `EXAM EDITED DIFF` — a prompt carrying either string fails the leg — and the file's
  existing assertions of exactly one judgment call naming the edited path still pass, so a
  second call for the same edit fails them [M4].

**Stale-if:**
- path-absent: `fleet/tests/test_run_engine_exam_edits.mjs`
- issue-closed: #700

### Task 3: Rule 8 names the strengthening exception

**Type:** implementation

**Files:**
- Modify: `fleet/roles/reviewer.md`

**Claim:** the referee's rule names the exception: an exam edit that only strengthens the exam (every original assertion kept, new ones added) is recorded and accepted, not blocked (quoted from #700)
Machine: M1. Item 8 of `fleet/roles/reviewer.md` — the lines from the one beginning
`8. EXAM EDITED` up to the paragraph beginning `Every issue names` — states, in this order, that
an edit that only strengthens the exam (every original assertion kept, new ones added — any tree
that passes the edited exam passes the peer's) is recorded and accepted, not blocked.
M2. The same item states that an edit that drops or loosens an assertion the peer wrote is
blocking, naming the assertion, and keeps the other exception — the exam itself was wrong (a pin
no correct implementation could satisfy, a bad import, a fixture it never created) and the hunk
changes only that.
M3. Item 8 names `EXAM EDITED DIFF` as where the change is read: the block the driver appends
under the EXAM EDITED line, since PATCH shows the exam only as new against BASE.
M4. The file gains no upper-case whole-word NEVER, ALWAYS or MUST against BASE, and its rule 6
still carries `plan-defect:` … `blocking` … `FILES` within 80 characters of each other, so
`fleet/tests/test_run_engine_exam_fix_edit.mjs`, `fleet/tests/test_run_engine.mjs`,
`fleet/tests/test_roles_peer.mjs` and `tests/test_roles_run_evidence.py` all pass on the edited
file.

**Authorized-by:** #700 (bug, peer-review) — the operator's decision of 2026-09-08 for option
(a), whose words are the Claim; #556 (the collaborative-review shape (a) restores); #232.

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** The rule names the block header `EXAM EDITED DIFF <path>:`, a shared literal with
Task 2's Context — a shape, not a symbol. Rule 8 at BASE `1c97ba44` is lines 35–39 of
`fleet/roles/reviewer.md`:

    8. EXAM EDITED, when present, names the Proof `Test:` paths the submission
       changed after a peer wrote them. The exam is the submission's grading, so
       such a hunk is blocking unless the exam itself was wrong — a pin no correct
       implementation could satisfy, a bad import, a fixture it never created —
       and the hunk changes only that. Say which.

followed at line 41 by the paragraph `Every issue names its \`actor\`: …`. Replace the item's
text with one that (M1) names the strengthening exception in the operator's words — the
parenthetical `(every original assertion kept, new ones added` verbatim, since the `Run:` pins
it — and states it as `recorded and accepted, not blocked`; (M2) says an edit that `drops or
loosens an assertion the peer wrote` is `blocking`, naming the assertion, and keeps the
wrong-exam exception with its three examples and `changes only that`; (M3) points the referee at
the `EXAM EDITED DIFF` block the driver appends under the EXAM EDITED line (one block per edited
path, a unified diff from the peer's bytes to the submission's — Task 2 appends it; a referee
reading this rule on a tree where the block is not yet appended reads PATCH instead, which shows
the exam as a whole-file add against BASE). Keep it a numbered item `8.` with the same
indentation as items 1–7 (three spaces on continuation lines), and keep `Say which.` or an
equivalent instruction to name the exception applied. Register: plain prose, no shouted
imperatives — `fleet/tests/test_run_engine_exam_fix_edit.mjs` leg (g) walks every file changed
since its frozen `d6efce4` outside `tests/` and `fleet/tests/` for a gained upper-case NEVER,
ALWAYS or MUST, and `fleet/tests/test_run_engine.mjs` line 157 and
`fleet/tests/test_roles_peer.mjs` line 44 pin rule 6 with the regex
`/\`plan-defect:\`[\s\S]{0,80}blocking[\s\S]{0,80}FILES/` — rule 6 is not this task's to touch.
`tests/test_roles_run_evidence.py` pins the RUN EVIDENCE paragraph of the same file (seven
phrases in one paragraph) — also untouched. The run-25 case this rule now covers: the
implementer dropped a fallback that let a returned array satisfy the exam and required the
lines on stdout — every tree that passes the edited exam passes the peer's, so under the new
item it is accepted and recorded; the run-53 case (a brittle pin) stays under the wrong-exam
exception.

**Proof:**
- Run: `sed -n '/^8\. EXAM EDITED/,/^Every issue names/p' fleet/roles/reviewer.md | tr '\n' ' ' | grep -q 'only strengthens the exam (every original assertion kept, new ones added.*recorded and accepted, not blocked'`
- Run: `sed -n '/^8\. EXAM EDITED/,/^Every issue names/p' fleet/roles/reviewer.md | tr '\n' ' ' | grep -q 'drops or loosens an assertion the peer wrote.*blocking' && sed -n '/^8\. EXAM EDITED/,/^Every issue names/p' fleet/roles/reviewer.md | tr '\n' ' ' | grep -q 'exam itself was wrong.*no correct implementation could satisfy.*bad import.*fixture it never created.*changes only that'`
- Run: `sed -n '/^8\. EXAM EDITED/,/^Every issue names/p' fleet/roles/reviewer.md | grep -q 'EXAM EDITED DIFF'`
- Run: `node fleet/tests/test_run_engine_exam_fix_edit.mjs | grep -q 'ALL TESTS PASSED' && node fleet/tests/test_run_engine.mjs | grep -q 'ALL TESTS PASSED' && node fleet/tests/test_roles_peer.mjs | grep -q 'ALL TESTS PASSED' && python3 -m pytest -q tests/test_roles_run_evidence.py`
- Legs: (a) the first `Run:` exits 0: within item 8 alone (the `sed` range from the line
  beginning `8. EXAM EDITED` to the line beginning `Every issue names`), the phrase
  `only strengthens the exam (every original assertion kept, new ones added` precedes
  `recorded and accepted, not blocked` [M1]; (b) the second `Run:` exits 0: the same range has
  `drops or loosens an assertion the peer wrote` before `blocking`, and `exam itself was wrong`
  before `no correct implementation could satisfy`, `bad import`, `fixture it never created` and
  `changes only that`, in that order [M2]; (c) the third `Run:` exits 0: the range names
  `EXAM EDITED DIFF`, and an item 8 that names it nowhere — or names it only outside the range,
  in another item — exits 1 [M3]; (d) the fourth `Run:` exits 0: the shout walk, the two rule-6 pins and
  the RUN EVIDENCE paragraph pin all pass on the edited file — a gained NEVER, ALWAYS or MUST, a
  broken rule 6, or a broken evidence paragraph fails it [M4].

**Stale-if:**
- path-absent: `fleet/roles/reviewer.md`
- issue-closed: #700
