# Critic Blocking Channel (#474) Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the integration critic a field in which it can say **blocking**, and
give that word a consumer that stops the run. Today the system can stop for *"I
couldn't check this"* and cannot stop for *"I checked this and it's broken."*

**Spec:** GitHub issue #474 is the spec. Two operator decisions were taken before
authoring and are binding on this plan:

1. **The brake is driver-side.** `run-main.mjs` refuses to approve.
   `gate_check.py` and `ultra_gate.py` are not opened — the 0.1.0 freeze says the
   gate scripts change only for an eval-measured regression, and #474 is an
   incident narrative. The receipt's silence is paid down by a sibling receipt
   and the PR body, not by editing the gate. `ackDecision` is the precedent:
   driver-side logic that decides approve-vs-park by reading a receipt.
2. **The critic's finding shape is unified with the reviewer's.**
   `CRITIC_SCHEMA.findings` becomes `[{severity, detail}]` — the same object
   `REVIEWER_SCHEMA.issues` already carries. This *deletes* a vocabulary rather
   than adding a field (`skills/ultralearn/references/distilling-proposals.md`,
   structural-first).

**Architecture:** Three edits along one path, in the order the data flows.
`run-engine.mjs` produces the typed finding; `run-main.mjs` consumes it as a
refusal; `drive.mjs` and `report-format.md` make the artifacts truthful as a set.

**The subtle part, and the reason Task 2 is not a one-liner.** The driver's
existing refusal lives *inside* the gate's exit-code branch:
`fleet/run-main.mjs:546` reads `if (gate.code === 2)` and only then consults
`ackDecision`. A clean `PASS` (`gate.code === 0`) falls straight through to
`--approve`. run-26 — the corpus's only clean `PASS` — shipped four unrouted
critic findings, two of which are still live in this repo. **A refusal wired into
the `code === 2` branch would not have caught it.** The new check must sit
outside that branch and apply to every non-failing gate outcome.

**Tech Stack:** Node (the `fleet/` engine, its own `fleet/package.json` deps) and
the existing `node:test`-free assert-based sims. No new dependencies.

## Global Constraints

- **The verification periphery is FROZEN (0.1.0).** No task changes
  `gate_check.py`, `ultra_gate.py`, `run_acceptance.sh`, or the compiler's
  diagnostic vocabulary. At the end of this run those four are byte-identical to
  their state at BASE.
- **`kernel/vendor/manyana.py` is byte-identical** to its sha-pinned copy.
- **No direct Anthropic API calls.** No `anthropic` SDK and no
  `ANTHROPIC_API_KEY` in any file this plan touches.
- **One finding vocabulary when the run ends.** No field of `report.json` carries
  a bare finding string, and `fleet/run-engine.mjs` declares the
  `blocking`/`minor` pair exactly once — `REVIEWER_SCHEMA` and `CRITIC_SCHEMA`
  share it. Two separate literal enums is a constraint violation.
- **`fleet/roles/critic.md` stays ≤ 350 words**, pinned by
  `fleet/tests/test_run_engine.mjs`. It is 260 words at BASE, so there is real
  budget; do not pay for the new sentence by deleting a normative rule.
- **Old evidence stays readable.** Every consumer of `completenessFindings`
  added or changed here accepts a bare string as well as an object. Runs 1–32
  wrote strings and their bundles are still read by the sensor.
- **Concurrency-safe tests.** Same-wave suites run at the same time on one
  machine. Every new fixture is built under a per-test temp dir; no test reads or
  writes a fixed temp path or binds a port.
- **A check that cannot fail is not a check.** Every test added here must have
  been observed to fail before its implementation exists. Any test whose
  assertion would hold against an empty implementation is a plan violation.

**Acceptance:** suite — every deliverable is deterministic code with a pinned
output shape, and the committed suite plus per-task review is the whole
verification. The one thing the suite cannot reach is whether a real critic uses
the new field correctly; that is the operator smoke probe at the end, read off
this run's own PR.

---

### Task 1: One finding shape

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `fleet/run-engine.mjs`
- Modify: `fleet/roles/critic.md`
- Modify: `fleet/tests/_engine_helpers.mjs`
- Test: `fleet/tests/test_run_engine.mjs`
- Test: `fleet/tests/test_run_engine_critic_inputs.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `SEVERITY` — one exported frozen enum literal `['blocking', 'minor']`, used
    by **both** `REVIEWER_SCHEMA.issues[].severity` and
    `CRITIC_SCHEMA.findings[].severity`.
  - `CRITIC_SCHEMA.findings: {type: 'array', items: {type: 'object', required:
    ['severity','detail'], properties: {severity: {enum: SEVERITY}, detail:
    {type: 'string'}}}}`.
  - `report.completenessFindings` — the same array of objects, unchanged in name
    and position.

At BASE, `fleet/run-engine.mjs:124-133` declares `CRITIC_SCHEMA.findings` as
`{type: 'array', items: {type: 'string'}}` and `REVIEWER_SCHEMA` (`:80-93`)
declares its own `severity: {enum: ['blocking','minor']}` literal. The engine
also synthesizes two fallback findings as bare strings — at `:1182` (*"no wave
merged — completeness review skipped (the tree is at BASE)"*) and `:1223`
(*"integration review did not run — completeness unverified; check the tree
before merging"*). Both become objects. **Both carry severity `blocking`**: each
already fails the run through `gitVerified`, so this is a vocabulary change with
no behavioural consequence, and it is what the standing decision below
authorizes.

`fleet/tests/_engine_helpers.mjs:87` — `cleanCritic()` returns
`{findings: [], deferredVerification: []}`. Empty stays empty; the helper needs a
sibling that returns a critic result carrying findings, since Tasks 2 and 3 both
need one and neither may reach into the other's fixture.

**Parallelization rationale:** this task owns the *shape*. Tasks 2 and 3 are two
independent consumers of it — a driver decision and a renderer — with disjoint
`Files:` blocks, so they run together in wave 2 once the shape is fixed. Fixing
the schema first is also the right engineering order regardless of parallelism:
two consumers agreeing on a shape defined in one place is the whole point of
unifying the vocabulary.

- [ ] **Step 1: Write the failing tests**

In `fleet/tests/test_run_engine.mjs`, replace the assertion at `:80`
(`assert.deepEqual(report.completenessFindings, [])`) with assertions that hold
the new shape, and add:

```js
// #474 — one severity vocabulary, declared once.
import { CRITIC_SCHEMA, REVIEWER_SCHEMA, SEVERITY } from '../run-engine.mjs'
assert.deepEqual(SEVERITY, ['blocking', 'minor'])
assert.equal(CRITIC_SCHEMA.properties.findings.items.properties.severity.enum, SEVERITY,
  'critic severity must be the SAME array object as SEVERITY, not a copy')
assert.equal(REVIEWER_SCHEMA.properties.issues.items.properties.severity.enum, SEVERITY,
  'reviewer severity must be the SAME array object as SEVERITY, not a copy')
```

`assert.equal` on arrays is reference identity in `node:assert/strict`; that is
deliberate here — a second literal spelling of the pair passes `deepEqual` and
fails this.

Add a source-level pin in the same file, because the constraint is about the file
and not only about the exports:

```js
const engineSrc = fs.readFileSync(new URL('../run-engine.mjs', import.meta.url), 'utf8')
assert.equal((engineSrc.match(/'blocking',\s*'minor'/g) || []).length, 1,
  'the blocking/minor pair is spelled exactly once in run-engine.mjs (#474)')
```

Then, in `fleet/tests/test_run_engine_critic_inputs.mjs`, add the two
fallback-finding cases:

```js
// no wave merged: the synthesized finding is a typed object, and it is blocking.
assert.equal(report.completenessFindings.length, 1)
const f = report.completenessFindings[0]
assert.deepEqual(Object.keys(f).sort(), ['detail', 'severity'])
assert.equal(f.severity, 'blocking')
assert.match(f.detail, /no wave merged/)
```

and the equivalent for the dead-critic path (`/integration review did not run/`).

Run both files. Expected: **FAIL** — `SEVERITY` is not exported, the source pin
counts 1 occurrence but of the reviewer's literal only after the critic's is
added, and the fallback findings are strings.

- [ ] **Step 2: Make them pass**

Extract `SEVERITY` in `fleet/run-engine.mjs` beside the other schema exports.
Point `REVIEWER_SCHEMA.issues[].severity.enum` and the new
`CRITIC_SCHEMA.findings[].severity.enum` at it — the same array object, not a
copy. Convert both synthesized fallback findings to
`{severity: 'blocking', detail: <the existing string, unchanged>}`. The strings
themselves are load-bearing (`test_run_engine_critic_inputs.mjs` matches on
them); keep them word for word.

Leave `report.completenessFindings: review.findings || []` at `:1333` alone — it
passes through whatever the schema produced, which is now objects.

- [ ] **Step 3: Add the fixture sibling**

In `fleet/tests/_engine_helpers.mjs`, beside `cleanCritic`, add
`criticWithFindings(findings)` returning
`{findings, deferredVerification: []}`, so Tasks 2 and 3 each build their own
inputs from one helper rather than hand-rolling shapes that can drift apart.

- [ ] **Step 4: Teach the critic which is which**

In `fleet/roles/critic.md`, item 4 currently reads *"Report each shortfall as a
finding string — specific, with file paths."* Replace it with instruction that
each finding is an object with `severity` and `detail`, and draw the line the
run depends on:

- `blocking` — you checked it and it is wrong: a deliverable absent or
  incoherent with its neighbours, a cannot-verify item that **fails** against the
  integrated tree, a defect you can name in a file. This stops the run.
- `minor` — worth an issue but not worth stopping a merge for.

Say explicitly that severity is a judgment about the *defect*, not about how
confident the critic is, and that a shortfall it could not execute belongs in
`deferredVerification`, not in a `blocking` finding. **Word budget:** the file is
260/350 at BASE; the replacement must leave it ≤ 350. Do not remove any existing
normative sentence to pay for this — there is 90 words of room.

- [ ] **Step 5: Verify**

Run `node fleet/tests/test_run_engine.mjs` and
`node fleet/tests/test_run_engine_critic_inputs.mjs`.
Expected: both print `ALL TESTS PASSED`.

Run `node -e "const s=require('fs').readFileSync('fleet/roles/critic.md','utf8'); console.log(s.split(/\s+/).filter(Boolean).length)"`.
Expected: a number ≤ 350.

---

### Task 2: The driver refuses, on every gate path

**Type:** implementation
**Depends-on:** 1
**Review:** adversarial

**Files:**
- Modify: `fleet/run-main.mjs`
- Test: `fleet/tests/test_run_main.mjs`

**Interfaces:**
- Consumes: `report.completenessFindings` as `[{severity, detail}]` (Task 1).
- Produces:
  - `criticDecision(report) -> {approve: boolean, reason: string, blocking: object[]}`
    — exported beside `ackDecision`, a pure function of the report.
  - `run-<stamp>/critic-block.json` on refusal:
    `{stamp, integrationBranch, gateVerdict, blocking}`.
  - A `driver:critic-decision` event on the event log, carrying `approve` and
    `reason` — the same shape `driver:ack-decision` already emits at `:549`.
  - The refusal's verdict string: `critic-blocking`.

`criticDecision` is a sibling of `ackDecision` (`fleet/run-main.mjs:193`) and
should read like one: a short pure function with a comment naming what it exists
to prevent. It returns `approve: false` when any element of
`completenessFindings` has `severity === 'blocking'`; a bare string element is
**not** blocking (old evidence, and the critic that wrote it had no way to say
so). Everything else approves.

**Where it goes, precisely.** In `runMain`, at BASE:

```
:539  const gate = await exec(py, [ultra_gate.py, --stamp, --result])
:542  if (gate.code !== 0 && gate.code !== 2)  → fail('gate-blocked')
:546  if (gate.code === 2) { ackDecision … fail('needs-ack') … standing-approval }
:565  stage('approve') → ultra_gate --approve
```

The critic check goes **after the `gate.code !== 0 && !== 2` bail and before the
`gate.code === 2` branch**, so it governs both surviving paths. On refusal it
writes `critic-block.json`, emits the event, and returns
`fail('critic-blocking', …)` — `ultra_gate --approve` is never invoked and no
`approve-receipt.json` is written. Its precedence over the ack path is
deliberate and is the third acceptance probe below: a run whose gate is
`NEEDS_ACK` over a pre-authorized `deferred:runtime` ack, carrying a blocking
finding, is refused. **The #243 pre-authorization covers "the sandbox could not
execute this"; it was never a licence to merge a named defect.**

Read the report from `resultPath`, which `runMain` already holds — not from the
gate receipt, which does not carry the field.

**Parallelization rationale:** the driver decision and the PR renderer (Task 3)
share no file and no symbol. This one is the brake; that one is the disclosure.
They are separable because the report is the interface between them, and Task 1
fixed it.

- [ ] **Step 1: Write the failing tests**

In `fleet/tests/test_run_main.mjs`, beside the existing `ackDecision` block at
`:54`, add a `criticDecision` block:

```js
// ── criticDecision — the brake #474 added ────────────────────────────────────
{
  const rep = (findings) => ({ completenessFindings: findings })
  assert.ok(criticDecision(rep([])).approve, 'no findings approves')
  assert.ok(criticDecision(rep([{ severity: 'minor', detail: 'x' }])).approve,
    'a minor finding is not a brake')
  const blocked = criticDecision(rep([
    { severity: 'minor', detail: 'x' },
    { severity: 'blocking', detail: 'task 2 deliverable absent' },
  ]))
  assert.ok(!blocked.approve)
  assert.equal(blocked.blocking.length, 1)
  assert.match(blocked.reason, /deliverable absent/)
  assert.ok(criticDecision(rep(['an old bare string finding'])).approve,
    'pre-#474 evidence carries no severity and cannot block')
  assert.ok(criticDecision({}).approve, 'a report with no findings field approves')
}
```

Then extend the existing `runMain` flow test — the one that already stubs the
scripts and exercises the two-move rule's both branches — with three cases.
Follow that block's existing stubbing idiom rather than inventing a second one:

- **PASS + blocking finding.** Gate stub exits 0; `resultPath`'s report carries
  one `blocking` finding. Assert: the returned verdict is `critic-blocking`; the
  `--approve` stub was never invoked; no `approve-receipt.json` exists in the run
  dir; `critic-block.json` exists and its `blocking[0].detail` is that finding's;
  its `gateVerdict` is `PASS`.
- **PASS + minor finding.** Same, with `severity: 'minor'`. Assert the run
  approves exactly as it does at BASE — `approve-receipt.json` written, verdict
  `approved`.
- **NEEDS_ACK over a pre-authorized ack + blocking finding.** Gate stub exits 2
  with `gateCheck.acks = [{type: 'deferred:runtime'}]`. Assert the verdict is
  `critic-blocking`, **not** `approved` — and that `standing-approval.json` was
  not written, since the run never reached the pre-authorization record.

Run `node fleet/tests/test_run_main.mjs`. Expected: **FAIL** —
`criticDecision` is not exported, and every flow case approves.

- [ ] **Step 2: Make them pass**

Add `criticDecision` and wire it in at the call site described above. Keep the
comment discipline of the surrounding file: say in the comment that the check is
outside the `gate.code === 2` branch **on purpose**, and name run-26 as the run
that proves a clean `PASS` can carry unrouted findings.

- [ ] **Step 3: Verify**

Run `node fleet/tests/test_run_main.mjs`. Expected: `ALL TESTS PASSED`.

---

### Task 3: The artifacts tell the truth as a set

**Type:** implementation
**Depends-on:** 1

**Files:**
- Modify: `fleet/drive.mjs`
- Modify: `skills/ultrapowers/references/report-format.md`
- Modify: `fleet/RUNBOOK.md`
- Test: `fleet/tests/test_drive_pr.mjs`

**Interfaces:**
- Consumes: `report.completenessFindings` / `receipt.completenessFindings` as
  `[{severity, detail}]` (Task 1).
- Produces: a PR body whose findings section is grouped by severity, blocking
  first; the `completenessFindings` documentation in `report-format.md` restated
  for the object shape and the driver-side consumer.

At BASE, `fleet/drive.mjs:218-222` renders one flat list and already degrades a
non-string element through `JSON.stringify` — so an old bundle is readable today
and must stay readable, but a new typed finding currently renders as raw JSON.

The section becomes two labelled groups, blocking first, each with its own count,
and — when the blocking group is non-empty — a sentence stating that these are
why the driver did not approve and that a `PASS` gate receipt beside them is
expected rather than a contradiction. That sentence is the whole payment for
operator decision 1: the gate is honest about what *it* checked, and the PR body
carries what the gate does not read.

Bare-string elements (pre-#474 evidence) render under the minor group, since they
carry no severity and `criticDecision` treats them as non-blocking. The renderer
must not throw on a malformed element.

In `skills/ultrapowers/references/report-format.md`, the JSON schema block at
`:55` and the field-reference row at `:91` both describe
`completenessFindings` as an array of strings. Update both to the object shape.
The row already carries a long history of the critic's detach discipline —
**keep all of it** and add: what the two severities mean; that the consumer is
`run-main.mjs`'s `criticDecision`, not `gate_check.py`, which still never reads
this field; and that a refused run therefore leaves a `PASS` or `NEEDS_ACK`
receipt beside a `critic-block.json`.

`fleet/RUNBOOK.md:584` instructs the operator to *"Harvest `report.json`'s
`completenessFindings` into issues explicitly"* — a manual step that existed
because nothing machine-read the field. Narrow it to the `minor` group and say
why: the blocking group now stops the run, so it needs no manual harvest.

**Parallelization rationale:** pure disclosure — a renderer and two documents,
sharing no file with Task 2. It depends on Task 1 only for the shape it renders.

- [ ] **Step 1: Write the failing tests**

In `fleet/tests/test_drive_pr.mjs`, the fixture at `:99` carries
`completenessFindings: ['socket leak in shim teardown (run-14 precedent)']`.
**Keep that case** — it is now the old-evidence regression — and assert the
string appears under the minor group and the renderer does not throw. Add a case
with a mixed array:

```js
completenessFindings: [
  { severity: 'minor', detail: 'unused export in fleet/store.mjs' },
  { severity: 'blocking', detail: 'task 2 deliverable absent from the tree' },
],
```

Assert on the rendered body: a blocking group heading carrying the count `1`
appears **before** the minor group heading (compare `indexOf`); both details
appear as plain text with no `{` or `"severity"` in the rendered line; and the
body contains the sentence explaining that the blocking findings are why the run
was not approved. Add a malformed case (`[null, 42]`) asserting the renderer
produces a body rather than throwing.

Run `node fleet/tests/test_drive_pr.mjs`. Expected: **FAIL**.

- [ ] **Step 2: Make them pass**

Rewrite the findings section of `fleet/drive.mjs`'s body builder. Update the
trailing italic note at `:232` if it no longer describes what renders.

- [ ] **Step 3: Update the two documents**

`skills/ultrapowers/references/report-format.md` (schema block and field row) and
`fleet/RUNBOOK.md:584`, per the descriptions above.

- [ ] **Step 4: Verify**

Run `node fleet/tests/test_drive_pr.mjs`. Expected: `ALL TESTS PASSED`.
Run `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers`.
Expected: `skill ok`.

---

### Task 4: Full suite

**Type:** gate
**Depends-on:** 1, 2, 3

- [ ] **Step 1: Run the full suite**

Run: `python3 -m pytest -n auto`
Expected: PASS, zero failures. `tests/test_fleet_suite.py` bridges every
`fleet/tests/test_*.mjs`, so the four files this plan touches are covered there
too. No pre-existing test changes its result.

- [ ] **Step 2: Validate the skill directories**

Run: `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers`
and `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultraplan`
Expected: both print `skill ok` — the same two checks CI runs.

- [ ] **Step 3: Confirm the freeze held**

Run: `git diff --stat BASE -- skills/ultrapowers/scripts/gate_check.py skills/ultrapowers/scripts/ultra_gate.py skills/ultrapowers/scripts/run_acceptance.sh kernel/vendor/manyana.py`
Expected: empty output. Any change here is a Global Constraints violation, not a
judgment call.

---

## Standing decisions

Pre-authorized. The run takes these branches, records them as judgment calls, and
does not park.

1. **Extracting the shared severity enum to one exported constant is
   authorized**, including editing `REVIEWER_SCHEMA` to consume it. Task 1's
   reference-identity assertions expect exactly this.
2. **Giving both synthesized fallback findings severity `blocking` is
   authorized.** Both already fail the run through `gitVerified`, so this changes
   vocabulary and not behaviour.
3. **Adding a test file under `fleet/tests/` is authorized** where an existing
   file has no natural home for a claim; deleting a test whose only subject is
   the bare-string shape is authorized.
4. **The exact key names inside `critic-block.json` beyond the four named are
   authorized**, as is the exact wording of the PR body's explanatory sentence
   and of the two documentation edits.
5. **A `deferred:manual` ack on documentation wording is pre-authorized** —
   `report-format.md` and `RUNBOOK.md` read correctly if the words are present
   and name nothing deleted.

## Out of scope

- **A `BLOCKED` verdict from `gate_check.py`.** Decided against on the record
  (operator decision 1). If the driver-side refusal proves insufficient, that is
  a freeze exception argued separately with eval numbers.
- **`judgmentCalls`** — the report's *second* advisory-only array that
  `gate_check.py` never reads. Same defect class, different field. Not fixed
  here, and not to be fixed by accident.
- **#300 and #301**, which #474 says close as a consequence of this. They close
  on the record after a run demonstrates the channel, not in this diff.
- **Re-reading the redirect-rate canary.** The metric stays invalid until a run
  exercises this channel; that is a measurement, not a code change.

## Operator smoke

The suite proves the brake works against synthetic reports. It cannot prove a
real critic uses the field correctly. Read these off **this run's own PR**:

- **do:** open the PR the orchestrator opened for run-33 and find the
  completeness-critic section. **see:** findings grouped under two labelled
  headings, or a stated zero — not a flat list, and no raw JSON.

- **do:** `grep -c "'blocking', 'minor'" fleet/run-engine.mjs` on the merged
  branch. **see:** `1`.

- **do:** in the run's evidence bundle, `cat report.json | python3 -c "import
  json,sys; print(json.load(sys.stdin)['completenessFindings'])"`. **see:** a
  list of objects with `severity` and `detail`, or an empty list — never a list
  of strings. A list of strings means the role prompt did not take.

- **do:** `grep -n "critic-decision" <run-dir>/events.jsonl`. **see:** exactly
  one `driver:critic-decision` event, with `approve` matching what the run
  actually did. Its absence means the check never ran.
