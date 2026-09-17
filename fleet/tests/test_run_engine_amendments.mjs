/**
 * fleet/tests/test_run_engine_amendments.mjs — a worker declares an amendment
 * and the driver writes it on the record.
 *
 * When a worker changes what the plan asked for — a file outside its list, a
 * clause read another way, a sim outside its list re-aimed — it says so in a
 * typed row, and that row is readable on the run's record (`events.jsonl`) and
 * on the run's report (`report.json`), per task.
 *
 * Everything below the agent seam is the real thing: real git repos, real
 * clones at BASE, real patch capture, the real fold kernel through the real
 * exec seam. Only `agent` is canned — which is exactly the seam the driver owns
 * — so every row this file counts is one the engine actually appended.
 *
 * ── the shared literal ──────────────────────────────────────────────────────
 *
 * An amendment row is `{task, amends, what, why}` with `amends` one of
 * `clause` | `files` | `sim`. The field is named `amends`, NOT `kind`, because
 * `kind` is every event's own type field (`kind: 'driver:amendment'`) and the
 * boot's page projection reads events by `kind`. Every leg below asserts the
 * row's field NAME as well as its value, so an implementation that spelled the
 * row field `kind` fails on the name rather than on the count.
 *
 * ── the Machine clauses under test ──────────────────────────────────────────
 *
 *   M1 — `IMPLEMENTER_SCHEMA` gains an optional `amendments` property: an array
 *        of objects each requiring `amends` (enum exactly `clause`, `files`,
 *        `sim`), `what` (string) and `why` (string); the schema's own
 *        `required` list is unchanged (`status`, `summary`, `startHead`).
 *   M2 — for every implementer reply (`impl:<id>`) and every fix reply
 *        (`fix:<id>:0`) whose `amendments` is a non-empty array, the driver
 *        appends to `<runDir>/events.jsonl` one
 *        `{kind: 'driver:amendment', task: <id>, amends, what, why}` per entry,
 *        in the reply's order, each carrying the log's own `id` and `ts` — the
 *        implementer's before that task's first `driver:proof-run` line, the
 *        fix round's after it — and pushes one `judgmentCalls` line per entry,
 *        `task <id>: amendment (<amends>): <what> — <why>`.
 *   M3 — the report carries `amendments`: one `{task, amends, what, why}` per
 *        event in the order the events were appended, and `[]` on a run whose
 *        replies declared none — the key is present on every report.
 *   M4 — a reply with no `amendments` key or an empty array appends no event
 *        and pushes no such line; a `DONE_WITH_CONCERNS` reply's `concerns`
 *        entries still reach `judgmentCalls` verbatim as `task <id>: <concern>`
 *        exactly as at BASE, and no other report field changes.
 *   M5 — `fleet/roles/implementer.md`'s judgment-rules paragraph tells the
 *        worker to declare each out-of-FILES edit taken (`amends: files`), each
 *        clause read otherwise (`amends: clause`) and each sim re-aimed
 *        (`amends: sim`), each with `what` and `why`, while still carrying the
 *        `out-of-FILES (not taken):` sentence and the
 *        `plan-defect: leg (x) cannot pass …` sentence; and
 *        `fleet/roles/fix.md`'s same-judgment-rules sentence names
 *        `amendments` for the same three kinds.
 *
 * ── the Proof legs, and where each is asked ─────────────────────────────────
 *
 *   (a) [M1] the imported `IMPLEMENTER_SCHEMA`'s `properties.amendments`
 *   (b) [M2] two implementer amendments, in order, before the first
 *            `driver:proof-run`
 *   (c) [M2] one FIX-round amendment, after the first `driver:proof-run`, and
 *            its one `judgmentCalls` line
 *   (d) [M2] leg (b)'s two `judgmentCalls` lines, one each
 *   (e) [M3] leg (b)'s `report.amendments`, and `[]` with the key present on a
 *            two-task run that declared none
 *   (f) [M4] a `DONE_WITH_CONCERNS` reply with no `amendments` key, and the
 *            same reply with `amendments: []`
 *   (g) [M5] the Proof's third and fourth `Run:` lines, asked here in-process
 *            with the same range-then-match semantics those two lines have, so
 *            this sim says what those commands say
 *   (h) [M2] the Proof's second `Run:` line: the bridge over every sim on the
 *            patched tree. A sim may not spawn `pytest` or another sim, so that
 *            leg is the driver's own `Run:` line and is not encodable inside
 *            this file; what this file owes it is to BE one of the sims that
 *            bridge runs, which it is.
 *
 * ── the readings this exam is written on ────────────────────────────────────
 *
 *   • A STUB REPLY IS NEVER VALIDATED against `IMPLEMENTER_SCHEMA` — the schema
 *     is the CLI's `--json-schema` contract, not an in-process check. So leg (a)
 *     reads the exported constant directly, and legs (b)–(f) drive the
 *     concerns/amendments seam with canned replies that the schema never sees.
 *     A schema that gained `amendments` without a seam that reads it passes
 *     leg (a) and fails (b)–(f); a seam without the schema is the reverse.
 *
 *   • POSITIONS ARE READ AGAINST `driver:proof-run`, not against worker
 *     envelopes: the rig does not run the worker process, so no
 *     `worker:start` / `worker:end` line reaches `events.jsonl` on its own. The
 *     engine writes `driver:proof-run` itself for a task that has `proofRuns`,
 *     and M2 pins the implementer's rows before the first such line and the fix
 *     round's after it — which is exactly the divider legs (b) and (c) use.
 *
 *   • LEG (c)'s RED-THEN-GREEN is a command that READS a file only the fix
 *     round writes (`cat fixed.txt`): red on the driver's own pre-review pass
 *     (the file is absent), which buys one `fix:<id>:0` round, and green on the
 *     re-execution once that round has written it. That is the one shape in
 *     which a `fix:<id>:0` reply exists to carry an amendment AND the task
 *     still finishes, so the same run can be read for the event, its position
 *     and its `judgmentCalls` line.
 *
 *   • `events.jsonl` IS READ BY COPY, never by import: split, parse, drop
 *     blanks. An absent file reads as no records, so an engine that appends
 *     none fails the count assertion rather than throwing ENOENT.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * TASK 4 (#1095 proposal 3) — every declared amendment carries Jev's
 * `compelled`, `plan_fault` and `magnitude` reads.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Everything above this line is the file as it was written at BASE for #990 and
 * is UNCHANGED: Task 4's clauses say the eight legs (a)–(h) still pass on the
 * patched tree, so this task EXTENDS the file — its own legs are lettered
 * (a4)–(d4), its own run helper is its own, and no helper, literal or assertion
 * above is reshaped by it. The section that carries them is at the bottom of
 * this file, under the banner naming this task.
 *
 * ── the Machine clauses under test (Task 4) ─────────────────────────────────
 *
 *   T4-M1 — with a `jev` client, each entry of a worker's reply's `amendments`
 *           is read through
 *           `readAmendment(jev, {title, claim, amendment: {amends, what, why}}, log)`
 *           — `readAmendment`, `AMENDMENT_QUESTIONS` and `taskClaimOf` from
 *           `fleet/jev-questions.mjs`, and `claim` from
 *           `taskClaimOf(<the plan file's text>, task.id)` — BEFORE its
 *           `driver:amendment` event is appended, and both that event and the
 *           report's `amendments` row carry `jev: {compelled, plan_fault,
 *           magnitude}` (the three numbers) or `jev: null` when the read
 *           resolved `null`, in the reply's order as at BASE.
 *   T4-M2 — without a `jev` client the row is `{task, amends, what, why}` with
 *           NO `jev` key, byte for byte the BASE shape, and this file's eight
 *           legs written at BASE pass on the patched tree.
 *   T4-M3 — a read that resolves `null` or throws changes nothing else: the
 *           task's `status`, `reviewVerdict`, the `judgmentCalls` line
 *           `task <id>: amendment (<amends>): <what> — <why>`, `tests.passed`
 *           and the merge decision are what they are without the read, and the
 *           engine throws nothing.
 *   T4-M4 — `fleet/CONTRACT.md`'s amendment paragraph in the evidence bullet
 *           and `skills/ultrapowers/references/report-format.md`'s `amendments`
 *           row both say the row carries `jev: {compelled, plan_fault,
 *           magnitude}` when a reader was handed in, `null` when the read did
 *           not answer, absent without one, and that the reads gate nothing.
 *
 * ── the Proof legs (Task 4), and where each is asked ────────────────────────
 *
 *   (a4) [T4-M1] one run through `rig({…, jev: fake})` declaring two
 *                amendments (`files` then `clause`) whose fake answers once and
 *                then `null`: the two calls, their `questions` and `state`, the
 *                two events' `jev` values, `report.amendments`, and each row's
 *                position before that task's first `driver:proof-run`
 *   (b4) [T4-M2] the same run with no `jev`: no `jev` key anywhere
 *   (c4) [T4-M3] the (a4) run and a run whose `ask` THROWS for the second
 *                entry, both read against (b4)'s report
 *   (d4) [T4-M4] the Proof's two document `Run:` lines
 *
 * ── the readings Task 4's legs are written on ───────────────────────────────
 *
 *   • THE ENGINE'S CALL IS READ THROUGH A RECORDING FAKE, not by stubbing
 *     `fleet/jev-questions.mjs`. `AMENDMENT_QUESTIONS` and `taskClaimOf` are
 *     IMPORTED here and the fake's arguments are compared against them, so any
 *     implementation that puts the sitting's questions and the plan's Claim to
 *     the client — through `readAmendment`, which is what T4-M1 names — passes,
 *     and one that invents its own questions or reads no plan fails on the
 *     argument rather than on a mock that was never installed.
 *
 *   • `claim` NEEDS A PLAN ON DISK. `taskClaimOf` reads the plan's text, and
 *     the engine already opens `args.planPath` for its H1, so leg (a4)'s rig
 *     passes one through `extraArgs` and the fixture carries a SECOND
 *     `### Task T2:` section: a reader that walked past the first section's end
 *     would carry the wrong Claim into `state` and fail the deep-equal.
 *
 *   • ORDER IS READ TWICE. T4-M1 says "in the reply's order as at BASE", so the
 *     rows are read both by their index in `events.jsonl` (the divider BASE's
 *     leg (b) uses) and by their `id` — `appendEvent` stamps `ulid(ts)`, which
 *     is monotonic within a process, so `id` sorting IS the record's order.
 *
 *   • LEG (d4) IS ASKED IN-PROCESS, exactly as BASE's leg (g) asks this file's
 *     other two document `Run:` lines: a sim may not spawn another proof's
 *     shell pipeline, so the two commands' range-then-match semantics are
 *     reproduced here — the same range, the same flattening, the same pattern
 *     with the BRE's literal `(`, `)`, `{` and `}` escaped for a JS regex.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { IMPLEMENTER_SCHEMA } from '../run-engine.mjs'
import { rig, makeRepo, passReview, doneImpl } from './_engine_helpers.mjs'
// Task 4 [T4-M1] — the sitting's question set and the plan's Claim reader, the
// two things the engine's `readAmendment` call is made of. Imported, never
// copied: a reworded question is a different question, and this file must fail
// if the engine put a different one.
import { AMENDMENT_QUESTIONS, taskClaimOf } from '../jev-questions.mjs'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-amendments-'))
// Removed on exit, red or green (rmSync unlinks a tree's `skills` symlink
// rather than following it into the repo).
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }))
const ROLES_DIR = fileURLToPath(new URL('../roles/', import.meta.url))

// ── the record every leg reads ──────────────────────────────────────────────
const readEvents = (runDir) => {
  const file = path.join(runDir, 'events.jsonl')
  if (!fs.existsSync(file)) return []
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l) } catch { return null } })
    .filter(Boolean)
}
const amendmentsOf = (log, id) =>
  log.filter((e) => e.kind === 'driver:amendment' && e.task === id)
const firstProofRunIndex = (log, id) =>
  log.findIndex((e) => e.kind === 'driver:proof-run' && e.task === id)
// The row as the shared literal spells it, projected off an event so the
// assertion reads the FIELD NAMES the contract names and nothing else.
const rowOf = (e) => ({ task: e.task, amends: e.amends, what: e.what, why: e.why })
// Every `judgmentCalls` line this task minted for an amendment, whatever else
// the run had to say (a red pre-review pass mints a line of its own).
const amendmentCallsOf = (report) =>
  report.judgmentCalls.filter((l) => l.includes(': amendment ('))
const CALL = (id, a) => 'task ' + id + ': amendment (' + a.amends + '): ' + a.what + ' — ' + a.why

// ── the task shape, and the rows the canned replies declare ─────────────────
const mkTask = (id, files, over = {}) => ({
  id, title: id.toLowerCase(), files, tier: 'standard', review: 'lean',
  writes: files, commutes: [], proofTests: [], proofRuns: [],
  body: 'task ' + id + ' body', ...over,
})

const AMEND_FILES = {
  amends: 'files',
  what: 'fleet/roles/fix.md — added the amendments sentence',
  why: 'the clause names the file and FILES did not',
}
const AMEND_SIM = {
  amends: 'sim',
  what: 'check.sh — re-aimed at the new marker',
  why: 'the old aim measured a path the task moved',
}
const AMEND_CLAUSE = {
  amends: 'clause',
  what: 'M2 read as one event per entry rather than one per reply',
  why: 'one row per reply cannot carry two amendments',
}

// One wave, one run, one report — with the stub's dispatch labels recorded, so
// every block can state its own sim preconditions off what was dispatched.
let seq = 0
const runWave = async ({ tasks, stub }) => {
  seq += 1
  const slug = 'am' + seq
  const repo = makeRepo(path.join(tmp, 'repo-' + slug))
  const runDir = path.join(tmp, 'run-' + slug)
  const labels = []
  const wrapped = (prompt, opts, cwd) => { labels.push(opts.label); return stub(prompt, opts, cwd) }
  const { run } = rig({
    repo, runDir, stub: wrapped, stamp: slug, waves: [tasks],
    // `foldAgeMs: 0` — every landing folds, the way an adopted epoch runs. The
    // fold trigger is another exam's subject; nothing here reads it.
    extraArgs: { foldAgeMs: 0 },
  })
  const report = await run()
  return { report, labels, runDir, log: readEvents(runDir) }
}

// ══════════════════════════════════════════════════════════════════════════
// (a) [M1] the schema gains an optional `amendments` array, and `required` is
//          unchanged
// ══════════════════════════════════════════════════════════════════════════
{
  const props = IMPLEMENTER_SCHEMA.properties
  assert.ok(props && typeof props === 'object',
    '(a) [M1] sim precondition: `IMPLEMENTER_SCHEMA` is an object with `properties`')
  const am = props.amendments
  assert.ok(am && typeof am === 'object',
    '(a) [M1] `IMPLEMENTER_SCHEMA` gains an `amendments` property — the worker has no way to ' +
    'declare an amendment until the CLI\'s own contract has a place for one. Properties: ' +
    JSON.stringify(Object.keys(props)))
  assert.equal(am.type, 'array',
    '(a) [M1] `amendments` is of type `array` — one row per amendment, not one string: ' +
    JSON.stringify(am))
  const items = am.items
  assert.ok(items && typeof items === 'object',
    '(a) [M1] `amendments.items` describes the row: ' + JSON.stringify(am))
  assert.deepEqual([...(items.required || [])].sort(), ['amends', 'what', 'why'],
    '(a) [M1] each row requires exactly `amends`, `what` and `why` — `amends`, never `kind`, ' +
    'because `kind` is the event\'s own type field: ' + JSON.stringify(items.required))
  const itemProps = items.properties || {}
  assert.ok(itemProps.amends && typeof itemProps.amends === 'object',
    '(a) [M1] the row\'s `amends` is described: ' + JSON.stringify(Object.keys(itemProps)))
  assert.deepEqual(itemProps.amends.enum, ['clause', 'files', 'sim'],
    '(a) [M1] `amends` is an enum deep-equal to [\'clause\', \'files\', \'sim\'] — the three ' +
    'kinds the plan\'s shared literal names, in that order and no others: ' +
    JSON.stringify(itemProps.amends))
  assert.equal(itemProps.what && itemProps.what.type, 'string',
    '(a) [M1] `what` is a string: ' + JSON.stringify(itemProps.what))
  assert.equal(itemProps.why && itemProps.why.type, 'string',
    '(a) [M1] `why` is a string: ' + JSON.stringify(itemProps.why))
  assert.deepEqual(IMPLEMENTER_SCHEMA.required, ['status', 'summary', 'startHead'],
    '(a) [M1] and the schema\'s own `required` list is UNCHANGED — `amendments` is optional, ' +
    'so a reply that has nothing to amend is still a valid reply: ' +
    JSON.stringify(IMPLEMENTER_SCHEMA.required))
}

// ══════════════════════════════════════════════════════════════════════════
// (b) [M2] two implementer amendments: two events, in reply order, both before
//          the task's first `driver:proof-run`
// (d) [M2] and one `judgmentCalls` line each, in the same run
// (e) [M3] and `report.amendments` deep-equal to the two rows, in that order
// ══════════════════════════════════════════════════════════════════════════
const twoAmendments = await (async () => {
  const GREEN = "sh -c 'echo green'"
  const out = await runWave({
    tasks: [mkTask('T1', ['one.txt'], { proofRuns: [GREEN] })],
    stub: (prompt, opts, cwd) => {
      const kind = opts.label.split(':')[0]
      if (kind === 'impl') {
        fs.writeFileSync(path.join(cwd, 'one.txt'), 'from T1\n')
        // DONE, not DONE_WITH_CONCERNS: M2 reads `amendments` whatever the
        // reply's status is, and a row is not a concern.
        return { ...doneImpl(cwd), amendments: [AMEND_FILES, AMEND_SIM] }
      }
      if (kind === 'review') return passReview()
      throw new Error('unexpected dispatch: ' + opts.label)
    },
  })
  assert.ok(out.labels.includes('impl:T1'),
    '(b) [M2] sim precondition: the implementer was dispatched — ' + JSON.stringify(out.labels))
  assert.ok(!out.labels.some((l) => l.startsWith('fix:')),
    '(b) [M2] sim precondition: the green `Run:` bought no repair round, so every amendment on ' +
    'this run is the IMPLEMENTER\'s — ' + JSON.stringify(out.labels))
  return out
})()

{
  const { report, log } = twoAmendments
  const ams = amendmentsOf(log, 'T1')
  assert.equal(ams.length, 2,
    '(b) [M2] a reply declaring two amendments leaves exactly two `driver:amendment` lines in ' +
    'events.jsonl — one per entry, no more and no fewer. Found: ' + JSON.stringify(ams))
  assert.deepEqual(ams.map(rowOf), [{ task: 'T1', ...AMEND_FILES }, { task: 'T1', ...AMEND_SIM }],
    '(b) [M2] each line carries `task` the task\'s id and the three fields VERBATIM, in the ' +
    'reply\'s order (`files` then `sim`) — not sorted, not deduplicated, not reworded: ' +
    JSON.stringify(ams.map(rowOf)))
  for (const e of ams) {
    assert.equal(typeof e.id, 'string',
      '(b) [M2] the line carries the log\'s own `id` as a string — it is an event of the record, ' +
      'stamped like every other: ' + JSON.stringify(e))
    assert.ok(e.id.length > 0, '(b) [M2] and that `id` is not empty: ' + JSON.stringify(e))
    assert.equal(typeof e.ts, 'number',
      '(b) [M2] and the log\'s own `ts` as a number: ' + JSON.stringify(e))
  }

  // The divider: the implementer's rows are appended before the driver's own
  // pre-review pass runs the task's `Run:` command.
  const pr = firstProofRunIndex(log, 'T1')
  assert.notEqual(pr, -1,
    '(b) [M2] sim precondition: the task\'s one green `Run:` command left a `driver:proof-run` ' +
    'line to read positions against — ' + JSON.stringify(log.map((e) => e.kind)))
  for (const e of ams) {
    assert.ok(log.indexOf(e) < pr,
      '(b) [M2] an IMPLEMENTER\'s amendment is appended BEFORE that task\'s first ' +
      '`driver:proof-run` line — the declaration belongs to the reply that made it, not to the ' +
      'pass that followed. Kinds in order: ' + JSON.stringify(log.map((x) => x.kind)))
  }

  // (d) [M2] one judgment line per entry, with the exact text the clause spells.
  assert.deepEqual(amendmentCallsOf(report), [CALL('T1', AMEND_FILES), CALL('T1', AMEND_SIM)],
    '(d) [M2] `judgmentCalls` carries exactly one `task <id>: amendment (<amends>): <what> — ' +
    '<why>` line per entry, one each and in the reply\'s order: ' +
    JSON.stringify(report.judgmentCalls))

  // (e) [M3] the report's own key: the same rows, in the order the events went.
  assert.ok(Object.prototype.hasOwnProperty.call(report, 'amendments'),
    '(e) [M3] the report carries an `amendments` key: ' + JSON.stringify(Object.keys(report)))
  assert.deepEqual(report.amendments,
    [{ task: 'T1', ...AMEND_FILES }, { task: 'T1', ...AMEND_SIM }],
    '(e) [M3] `report.amendments` is one `{task, amends, what, why}` per event, in the order the ' +
    'events were appended — the report and the record say the same thing: ' +
    JSON.stringify(report.amendments))
}

// ══════════════════════════════════════════════════════════════════════════
// (c) [M2] a FIX round's amendment: one event, AFTER the task's first
//          `driver:proof-run`, and exactly one `judgmentCalls` line
// ══════════════════════════════════════════════════════════════════════════
{
  // The command reads a file only the fix round writes: red on the driver's own
  // pre-review pass, green on the re-execution after `fix:T1:0`.
  const CMD = "sh -c 'cat fixed.txt'"
  const { report, labels, log } = await runWave({
    tasks: [mkTask('T2', ['one.txt'], { proofRuns: [CMD] })],
    stub: (prompt, opts, cwd) => {
      const kind = opts.label.split(':')[0]
      if (kind === 'impl') {
        fs.writeFileSync(path.join(cwd, 'one.txt'), 'from T2\n')
        // No `amendments` key at all: the only row on this run is the fix
        // round's, so its position cannot be the implementer's by accident.
        return doneImpl(cwd)
      }
      if (kind === 'fix') {
        fs.writeFileSync(path.join(cwd, 'fixed.txt'), 'repaired-by-the-fix-round\n')
        return { ...doneImpl(cwd), amendments: [AMEND_CLAUSE] }
      }
      if (kind === 'review') return passReview()
      throw new Error('unexpected dispatch: ' + opts.label)
    },
  })
  assert.ok(labels.includes('fix:T2:0'),
    '(c) [M2] sim precondition: the red pre-review pass bought the one repair round whose reply ' +
    'carries the amendment — ' + JSON.stringify(labels))

  const ams = amendmentsOf(log, 'T2')
  assert.equal(ams.length, 1,
    '(c) [M2] a fix reply declaring one amendment leaves exactly one `driver:amendment` line — ' +
    'the fix round is read on the same terms as the implementer, and the implementer here ' +
    'declared none. Found: ' + JSON.stringify(ams))
  assert.deepEqual(rowOf(ams[0]), { task: 'T2', ...AMEND_CLAUSE },
    '(c) [M2] naming the task and carrying the three fields verbatim: ' + JSON.stringify(ams[0]))
  assert.equal(typeof ams[0].id, 'string',
    '(c) [M2] with the log\'s own `id`: ' + JSON.stringify(ams[0]))
  assert.equal(typeof ams[0].ts, 'number',
    '(c) [M2] and its own `ts`: ' + JSON.stringify(ams[0]))

  const pr = firstProofRunIndex(log, 'T2')
  assert.notEqual(pr, -1,
    '(c) [M2] sim precondition: the task\'s `Run:` command left a `driver:proof-run` line — ' +
    JSON.stringify(log.map((e) => e.kind)))
  assert.ok(log.indexOf(ams[0]) > pr,
    '(c) [M2] a FIX round\'s amendment is appended AFTER that task\'s first `driver:proof-run` ' +
    'line — the round it belongs to is the one the red pass bought, which ran after that pass. ' +
    'Kinds in order: ' + JSON.stringify(log.map((x) => x.kind)))

  assert.deepEqual(amendmentCallsOf(report), [CALL('T2', AMEND_CLAUSE)],
    '(c) [M2] and `judgmentCalls` carries exactly one `task <id>: amendment (clause): <what> — ' +
    '<why>` line for it: ' + JSON.stringify(report.judgmentCalls))
  assert.deepEqual(report.amendments, [{ task: 'T2', ...AMEND_CLAUSE }],
    '(c) [M3] with the report saying the same: ' + JSON.stringify(report.amendments))
}

// ══════════════════════════════════════════════════════════════════════════
// (e) [M3] a run whose replies declared none: `amendments` deep-equal to [],
//          and the key PRESENT
// ══════════════════════════════════════════════════════════════════════════
{
  const { report, log } = await runWave({
    tasks: [mkTask('A', ['a1.txt']), mkTask('B', ['b1.txt'])],
    stub: (prompt, opts, cwd) => {
      const kind = opts.label.split(':')[0]
      if (kind === 'impl') {
        fs.writeFileSync(path.join(cwd, opts.label === 'impl:A' ? 'a1.txt' : 'b1.txt'),
          'from ' + opts.label + '\n')
        return doneImpl(cwd)
      }
      if (kind === 'review') return passReview()
      throw new Error('unexpected dispatch: ' + opts.label)
    },
  })
  assert.equal(report.tasks.length, 2,
    '(e) [M3] sim precondition: both tasks ran — ' + JSON.stringify(report.tasks))
  assert.ok(Object.prototype.hasOwnProperty.call(report, 'amendments'),
    '(e) [M3] the `amendments` key is present on EVERY report, including one whose replies ' +
    'declared nothing — a reader of report.json never has to test for the key: ' +
    JSON.stringify(Object.keys(report)))
  assert.deepEqual(report.amendments, [],
    '(e) [M3] and it is deep-equal to [] there — an empty list, not null and not absent: ' +
    JSON.stringify(report.amendments))
  assert.deepEqual(log.filter((e) => e.kind === 'driver:amendment'), [],
    '(e) [M2] with no `driver:amendment` line on the record either: ' +
    JSON.stringify(log.map((e) => e.kind)))
}

// ══════════════════════════════════════════════════════════════════════════
// (f) [M4] a reply with no `amendments` key, and one with `amendments: []`:
//          no event, no line — and its `concerns` still reach `judgmentCalls`
//          verbatim, exactly as at BASE
// ══════════════════════════════════════════════════════════════════════════
{
  const CONCERN = 'out-of-FILES (not taken): a.txt — owed'
  // Two runs, the same reply but for the key: absent, then empty. M4 says both
  // are silent, so both are driven rather than argued.
  for (const [name, extra] of [['no `amendments` key', {}],
                               ['`amendments: []`', { amendments: [] }]]) {
    const { report, log } = await runWave({
      tasks: [mkTask('T3', ['one.txt'])],
      stub: (prompt, opts, cwd) => {
        const kind = opts.label.split(':')[0]
        if (kind === 'impl') {
          fs.writeFileSync(path.join(cwd, 'one.txt'), 'from T3\n')
          return { ...doneImpl(cwd), status: 'DONE_WITH_CONCERNS', concerns: [CONCERN], ...extra }
        }
        if (kind === 'review') return passReview()
        throw new Error('unexpected dispatch: ' + opts.label)
      },
    })
    assert.deepEqual(log.filter((e) => e.kind === 'driver:amendment'), [],
      '(f) [M4] ' + name + ': no `driver:amendment` line is appended — silence is not an ' +
      'amendment: ' + JSON.stringify(log.map((e) => e.kind)))
    assert.deepEqual(amendmentCallsOf(report), [],
      '(f) [M4] ' + name + ': and no `amendment (` line is pushed to `judgmentCalls`: ' +
      JSON.stringify(report.judgmentCalls))
    assert.deepEqual(report.amendments, [],
      '(f) [M3] ' + name + ': the report\'s key is still there, still []: ' +
      JSON.stringify(report.amendments))
    // The BASE behaviour the new seam sits beside, unchanged: the concern
    // itself, verbatim, prefixed only with `task <id>: `.
    assert.deepEqual(report.judgmentCalls.filter((l) => l.includes('out-of-FILES')),
      ['task T3: ' + CONCERN],
      '(f) [M4] ' + name + ': the `DONE_WITH_CONCERNS` reply\'s concern still reaches ' +
      '`judgmentCalls` verbatim as `task <id>: <concern>`, exactly as at BASE — the amendments ' +
      'seam is beside `noteConcerns`, not instead of it: ' + JSON.stringify(report.judgmentCalls))
  }
}

// ══════════════════════════════════════════════════════════════════════════
// (g) [M5] the two role paragraphs say what the worker must declare
// ══════════════════════════════════════════════════════════════════════════
// The Proof's third `Run:` is
//   sed -n '/^Judgment rules:/,/^$/p' fleet/roles/implementer.md | tr '\n' ' ' \
//     | grep -q 'amendments.*files.*clause.*sim.*what.*why.*out-of-FILES (not taken):.*plan-defect: leg (x) cannot pass'
// and the fourth is
//   sed -n '/^The same judgment rules/,/^$/p' fleet/roles/fix.md | tr '\n' ' ' \
//     | grep -q 'amendments.*files.*clause.*sim.*plan-defect:.*sibling'
// — an anchored line through the next blank line, flattened to one line, then
// matched. These are those ranges, read the same way, in this process. The
// grep patterns are BREs, in which `(` and `)` are literal characters; they are
// escaped below and mean exactly the same thing.
{
  // The sed range: the first line matching the anchor, through the first blank
  // line at or after it (inclusive, as sed prints it). A paragraph broken in
  // two ends the range early, which is the point — the Proof's command reads
  // the paragraph as ONE paragraph and so does this.
  const paragraph = (file, anchor) => {
    const lines = fs.readFileSync(path.join(ROLES_DIR, file), 'utf8').split('\n')
    const start = lines.findIndex((l) => anchor.test(l))
    assert.notEqual(start, -1,
      '(g) [M5] sim precondition: fleet/roles/' + file + ' still has the line the Proof\'s sed ' +
      'range is anchored on (' + String(anchor) + ')')
    let end = lines.findIndex((l, i) => i >= start && l.trim() === '')
    if (end === -1) end = lines.length - 1
    return lines.slice(start, end + 1).join(' ')
  }

  const impl = paragraph('implementer.md', /^Judgment rules:/)
  assert.match(impl,
    /amendments[\s\S]*files[\s\S]*clause[\s\S]*sim[\s\S]*what[\s\S]*why[\s\S]*out-of-FILES \(not taken\):[\s\S]*plan-defect: leg \(x\) cannot pass/,
    '(g) [M5] fleet/roles/implementer.md\'s judgment-rules paragraph tells the worker to declare ' +
    'in `amendments` each out-of-FILES edit TAKEN (`files`), each clause read otherwise ' +
    '(`clause`) and each sim re-aimed (`sim`), each with `what` and `why` — and still carries ' +
    'the `out-of-FILES (not taken):` sentence and the `plan-defect: leg (x) cannot pass` ' +
    'sentence, in the order the Proof\'s Run: line greps for them, all inside ONE paragraph. ' +
    'The paragraph read: ' + JSON.stringify(impl))

  const fix = paragraph('fix.md', /^The same judgment rules/)
  assert.match(fix,
    /amendments[\s\S]*files[\s\S]*clause[\s\S]*sim[\s\S]*plan-defect:[\s\S]*sibling/,
    '(g) [M5] and fleet/roles/fix.md\'s same-judgment-rules sentence names `amendments` for the ' +
    'same three kinds, keeping `plan-defect:` and the sibling-owned-paths sentence, in the order ' +
    'the Proof\'s fourth Run: line greps for them. The paragraph read: ' + JSON.stringify(fix))
}

// ══════════════════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════════════════
// TASK 4 (#1095 proposal 3) — Jev's three reads beside every declared
// amendment. Legs (a4)–(d4); nothing above this banner is touched by them.
// ══════════════════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════════════════

// ── the run every Task 4 leg drives, differing only in its `jev` ────────────
// The task's own title, and the Claim the plan fixture gives it. `state.task`
// is built from these two and from nothing else, so both are literals here and
// the plan below is their only other home.
const T4_TITLE = 'the one task this run dispatches'
const T4_CLAIM = "do: declare two amendments; see: Jev's three reads beside each row. (derived)"
// The plan `args.planPath` names. A SECOND task section follows T1's: a reader
// that walked past the first section's end would carry `not this one` into
// `state.task.claim` and fail leg (a4)'s deep-equal rather than pass by luck.
const T4_PLAN = [
  '# the amendment reads, driven on one task',
  '',
  '### Task T1: ' + T4_TITLE,
  '',
  '**Claim:** ' + T4_CLAIM,
  '',
  '**Files:**',
  '- Modify: `one.txt`',
  '',
  '### Task T2: a second section, so T1\'s ends before it',
  '',
  '**Claim:** not this one',
  '',
].join('\n')

// A `jev` client that is a RECORDER, never a network: every `ask` argument is
// kept in order, and the reply is the next entry of `script` — an `Error` entry
// is thrown rather than returned, which is how leg (c4) drives a throwing read.
const fakeJev = (script) => {
  const calls = []
  return {
    calls,
    ask: async (arg) => {
      const { state, questions } = arg || {}
      // Only an AMENDMENT read is this exam's business. Since run-182 (#1096)
      // the same client is also asked a `jev:tier` question at every dispatch
      // and every review (a state with `task` and, at review, `patch` — never
      // `amendment`); those reads are `test_run_engine_jev_tier.mjs`'s to pin,
      // so they consume no scripted answer here and land in no `calls` entry.
      if (!(state && state.amendment)) return null
      calls.push({ state, questions })
      const answer = script[calls.length - 1]
      if (answer instanceof Error) throw answer
      return answer
    },
  }
}

// The sitting's own reply shape (the Proof's literal), and the flat row the
// reader makes of it — `noul` for the two `noul` questions, `score` for the
// score, and nothing else of the answer objects carried through.
const T4_ANSWERS = {
  compelled: { type: 'noul', noul: 0.8 },
  plan_fault: { type: 'noul', noul: 0.1 },
  magnitude: { type: 'score', score: 1.6, legend: {}, probabilities: {}, confidence: 0.7 },
}
const T4_JEV_ROW = { compelled: 0.8, plan_fault: 0.1, magnitude: 1.6 }

// One wave, one task, one green `Run:`, one implementer reply declaring
// `files` then `clause`. `jev` is the ONLY thing that varies: passing
// `undefined` reaches an engine with no client at all (the rig omits the key),
// which is exactly the comparison legs (b4) and (c4) rest on.
const runAmendRun = async (jev) => {
  seq += 1
  const slug = 'am' + seq
  const repo = makeRepo(path.join(tmp, 'repo-' + slug))
  const runDir = path.join(tmp, 'run-' + slug)
  const planPath = path.join(tmp, 'plan-' + slug + '.md')
  fs.writeFileSync(planPath, T4_PLAN)
  const labels = []
  const { run } = rig({
    repo,
    runDir,
    stamp: slug,
    waves: [[mkTask('T1', ['one.txt'], { title: T4_TITLE, proofRuns: ["sh -c 'echo green'"] })]],
    jev,
    extraArgs: { foldAgeMs: 0, planPath },
    stub: (prompt, opts, cwd) => {
      labels.push(opts.label)
      const kind = opts.label.split(':')[0]
      if (kind === 'impl') {
        fs.writeFileSync(path.join(cwd, 'one.txt'), 'from T1\n')
        return { ...doneImpl(cwd), amendments: [AMEND_FILES, AMEND_CLAUSE] }
      }
      if (kind === 'review') return passReview()
      throw new Error('unexpected dispatch: ' + opts.label)
    },
  })
  const report = await run()
  return { report, labels, runDir, log: readEvents(runDir) }
}

// The row as the record carries it WITH a reading: the four BASE fields and the
// `jev` key, and nothing else — so an implementation that spilled the answer
// objects, or renamed `plan_fault`, fails on the shape.
const jevRowOf = (e) => ({ ...rowOf(e), jev: e.jev })

// ══════════════════════════════════════════════════════════════════════════
// (a4) [T4-M1] the two reads, their arguments, the two events' `jev` values,
//              the report's rows, and the position of each row
// ══════════════════════════════════════════════════════════════════════════
const t4WithJev = await (async () => {
  // Answered for the FIRST entry, `null` for the second: one run carries both
  // the read that answered and the read that did not, which is what the leg
  // and (through `null`) T4-M3 both ask of it.
  const fake = fakeJev([T4_ANSWERS, null])
  const out = await runAmendRun(fake)
  return { ...out, fake }
})()

{
  const { report, log, labels, fake } = t4WithJev

  assert.equal(taskClaimOf(T4_PLAN, 'T1'), T4_CLAIM,
    '(a4) [T4-M1] sim precondition: `taskClaimOf` — the function T4-M1 names, imported from ' +
    'fleet/jev-questions.mjs — reads exactly ' + JSON.stringify(T4_CLAIM) + ' off this run\'s ' +
    'plan fixture for task T1, so the `claim` asserted below is the plan\'s own line and not a ' +
    'literal this file invented: ' + JSON.stringify(taskClaimOf(T4_PLAN, 'T1')))
  assert.ok(labels.includes('impl:T1'),
    '(a4) [T4-M1] sim precondition: the implementer was dispatched — ' + JSON.stringify(labels))
  assert.ok(!labels.some((l) => l.startsWith('fix:')),
    '(a4) [T4-M1] sim precondition: the green `Run:` bought no repair round, so both amendments ' +
    'on this run are the implementer\'s — ' + JSON.stringify(labels))

  // ── the calls ────────────────────────────────────────────────────────────
  assert.equal(fake.calls.length, 2,
    '(a4) [T4-M1] the client is asked exactly ONCE PER ENTRY of the reply\'s `amendments` — two ' +
    'entries, two calls, no more and no fewer (not one call carrying both, not a call per ' +
    'reply). Calls: ' + JSON.stringify(fake.calls.map((c) => c.state)))
  for (const [i, call] of fake.calls.entries()) {
    assert.deepEqual(call.questions, AMENDMENT_QUESTIONS,
      '(a4) [T4-M1] call ' + (i + 1) + '\'s `questions` is deep-equal to `AMENDMENT_QUESTIONS` ' +
      'as fleet/jev-questions.mjs exports it — the calibration of #1095\'s reading was made ' +
      'against those exact strings, so a reworded or re-ordered set is a different question and ' +
      'its numbers mean something else: ' + JSON.stringify(call.questions))
  }
  assert.deepEqual(fake.calls[0].state,
    { task: { title: T4_TITLE, claim: T4_CLAIM }, amendment: { ...AMEND_FILES } },
    '(a4) [T4-M1] the FIRST call\'s `state` is deep-equal to `{task: {title, claim}, amendment: ' +
    '{amends, what, why}}` — the compiled task\'s own `title`, the Claim ' +
    '`taskClaimOf(<the plan file\'s text>, task.id)` reads, and the reply\'s FIRST entry ' +
    '(`files`) verbatim: ' + JSON.stringify(fake.calls[0].state))
  assert.deepEqual(fake.calls[1].state,
    { task: { title: T4_TITLE, claim: T4_CLAIM }, amendment: { ...AMEND_CLAUSE } },
    '(a4) [T4-M1] and the SECOND call\'s `state` carries the reply\'s second entry (`clause`), ' +
    'in that order — the reads go in the reply\'s order, not sorted and not batched: ' +
    JSON.stringify(fake.calls[1].state))

  // ── the events ───────────────────────────────────────────────────────────
  const ams = amendmentsOf(log, 'T1')
  assert.equal(ams.length, 2,
    '(a4) [T4-M1] a reply declaring two amendments still leaves exactly two `driver:amendment` ' +
    'lines with a client handed in — a read adds a field to a row, it does not add or drop one: ' +
    JSON.stringify(ams))
  assert.deepEqual(ams.map(jevRowOf), [
    { task: 'T1', ...AMEND_FILES, jev: T4_JEV_ROW },
    { task: 'T1', ...AMEND_CLAUSE, jev: null },
  ],
    '(a4) [T4-M1] each `driver:amendment` line carries `task`, `amends`, `what` and `why` as at ' +
    'BASE AND `jev` — `{compelled, plan_fault, magnitude}`, the reader\'s three flattened ' +
    'numbers (0.8, 0.1, 1.6 off the sitting\'s `noul`/`noul`/`score` reply), on the entry whose ' +
    'read answered, and `jev: null` on the entry whose read resolved `null` — in the reply\'s ' +
    'order: ' + JSON.stringify(ams.map(jevRowOf)))
  assert.ok(Object.prototype.hasOwnProperty.call(ams[1], 'jev'),
    '(a4) [T4-M1] and the unanswered entry\'s `jev` key is PRESENT and null, never absent: with ' +
    'a client handed in the row always says what the read came to, and `null` is what "it did ' +
    'not answer" reads as: ' + JSON.stringify(ams[1]))

  // ── the report ───────────────────────────────────────────────────────────
  assert.deepEqual(report.amendments, [
    { task: 'T1', ...AMEND_FILES, jev: T4_JEV_ROW },
    { task: 'T1', ...AMEND_CLAUSE, jev: null },
  ],
    '(a4) [T4-M1] `report.amendments` deep-equals those same two rows, with the same `jev` ' +
    'values in the same order — the report and the record say the same thing about the reads, ' +
    'exactly as they do about the four BASE fields: ' + JSON.stringify(report.amendments))

  // ── the position: the read happens BEFORE the event is appended, so the ──
  // event still lands where BASE put it.
  const pr = firstProofRunIndex(log, 'T1')
  assert.notEqual(pr, -1,
    '(a4) [T4-M1] sim precondition: the task\'s one green `Run:` command left a ' +
    '`driver:proof-run` line to read positions against — ' + JSON.stringify(log.map((e) => e.kind)))
  const prRow = log[pr]
  assert.equal(typeof prRow.id, 'string',
    '(a4) [T4-M1] sim precondition: that `driver:proof-run` line carries the log\'s own `id`: ' +
    JSON.stringify(prRow))
  for (const e of ams) {
    assert.equal(typeof e.id, 'string',
      '(a4) [T4-M1] an amendment line still carries the log\'s own `id`: ' + JSON.stringify(e))
    assert.ok(String(e.id) < String(prRow.id),
      '(a4) [T4-M1] and that `id` SORTS BEFORE the id of that task\'s first `driver:proof-run` ' +
      'line, as at BASE — `appendEvent` stamps a monotonic `ulid(ts)`, so an awaited read that ' +
      'let the pre-review pass run first would show up here. Amendment id ' +
      JSON.stringify(e.id) + ', proof-run id ' + JSON.stringify(prRow.id))
    assert.ok(log.indexOf(e) < pr,
      '(a4) [T4-M1] and it is appended before that line on the record too — the declaration ' +
      'belongs to the reply that made it, whatever the read cost. Kinds in order: ' +
      JSON.stringify(log.map((x) => x.kind)))
  }
}

// ══════════════════════════════════════════════════════════════════════════
// (b4) [T4-M2] the same run with NO client: the BASE row, byte for byte, with
//              no `jev` key on the event or on the report row
// ══════════════════════════════════════════════════════════════════════════
// The eight legs (a)–(h) written at BASE are the other half of this leg. They
// are above, unchanged, and they run in this same process before this line —
// so the `ALL TESTS PASSED` sentinel the Proof's first `Run:` line greps is
// printed only if they all held, which is what that `Run:` line attests.
const t4NoJev = await runAmendRun(undefined)

{
  const { report, log, labels } = t4NoJev
  assert.ok(labels.includes('impl:T1') && !labels.some((l) => l.startsWith('fix:')),
    '(b4) [T4-M2] sim precondition: the same dispatches as leg (a4)\'s run — ' +
    JSON.stringify(labels))

  const ams = amendmentsOf(log, 'T1')
  assert.equal(ams.length, 2,
    '(b4) [T4-M2] the same two `driver:amendment` lines: ' + JSON.stringify(ams))
  for (const e of ams) {
    assert.equal(Object.prototype.hasOwnProperty.call(e, 'jev'), false,
      '(b4) [T4-M2] with NO `jev` key at all on the event — not `jev: null`, ABSENT. A run that ' +
      'was handed no client asked nothing, and a row that says `null` would claim a read that ' +
      'never happened: ' + JSON.stringify(e))
  }
  assert.deepEqual(ams.map(rowOf),
    [{ task: 'T1', ...AMEND_FILES }, { task: 'T1', ...AMEND_CLAUSE }],
    '(b4) [T4-M2] and the four BASE fields verbatim, in the reply\'s order: ' +
    JSON.stringify(ams.map(rowOf)))

  for (const row of report.amendments) {
    assert.equal(Object.prototype.hasOwnProperty.call(row, 'jev'), false,
      '(b4) [T4-M2] the report\'s rows carry no `jev` key either: ' + JSON.stringify(row))
  }
  assert.deepEqual(report.amendments,
    [{ task: 'T1', ...AMEND_FILES }, { task: 'T1', ...AMEND_CLAUSE }],
    '(b4) [T4-M2] `report.amendments` is `{task, amends, what, why}` per row, byte for byte the ' +
    'BASE shape — a run with no client behaves as BASE did: ' + JSON.stringify(report.amendments))
}

// ══════════════════════════════════════════════════════════════════════════
// (c4) [T4-M3] a read that resolved `null` and a read that THREW change
//              nothing else: both runs are read against (b4)'s no-client run
// ══════════════════════════════════════════════════════════════════════════
{
  // The second run of this leg: the first entry answers, the second THROWS.
  // `readAmendment` catches it and resolves `null`; nothing may reach the
  // engine's callers, and the run must resolve.
  const boom = fakeJev([T4_ANSWERS, new Error('boom')])
  let threw = null
  let thrown = null
  try {
    thrown = await runAmendRun(boom)
  } catch (e) {
    threw = e
  }
  assert.equal(threw, null,
    '(c4) [T4-M3] a `jev.ask` that THROWS leaves the run resolving — a failed read is one log ' +
    'line, never an error out of the engine, never a park. The engine threw: ' +
    String(threw && threw.stack ? threw.stack : threw))
  assert.equal(boom.calls.length, 2,
    '(c4) [T4-M3] sim precondition: the throwing client was still asked once per entry — the ' +
    'first read is not abandoned by the second\'s throw and the second is not skipped: ' +
    JSON.stringify(boom.calls.map((c) => c.state)))

  const base = t4NoJev.report
  assert.equal(base.tasks.length, 1,
    '(c4) [T4-M3] sim precondition: the no-client run of leg (b4) reported one task, which is ' +
    'the reading both runs below are held against: ' + JSON.stringify(base.tasks))

  for (const [name, { report, log }] of [
    ['the read that resolved `null` (leg (a4)\'s run)', t4WithJev],
    ['the read that THREW', thrown],
  ]) {
    const ams = amendmentsOf(log, 'T1')
    assert.equal(ams.length, 2,
      '(c4) [T4-M3] ' + name + ': both `driver:amendment` lines are still there: ' +
      JSON.stringify(ams))
    assert.equal(ams[1].jev, null,
      '(c4) [T4-M3] ' + name + ': the second row\'s `jev` is `null` — a read that did not answer ' +
      'leaves the row saying so, and nothing else of the row moves: ' + JSON.stringify(ams[1]))
    assert.deepEqual(rowOf(ams[1]), { task: 'T1', ...AMEND_CLAUSE },
      '(c4) [T4-M3] ' + name + ': and its four BASE fields are what they are without the read: ' +
      JSON.stringify(ams[1]))

    assert.equal(report.tasks.length, base.tasks.length,
      '(c4) [T4-M3] ' + name + ': the same number of task rows as the no-client run: ' +
      JSON.stringify(report.tasks))
    assert.equal(report.tasks[0].status, base.tasks[0].status,
      '(c4) [T4-M3] ' + name + ': `report.tasks[0].status` equals the no-client run\'s (' +
      JSON.stringify(base.tasks[0].status) + ') — Jev answers no fact, so no status turns on ' +
      'one: ' + JSON.stringify(report.tasks[0].status))
    assert.equal(report.tasks[0].reviewVerdict, base.tasks[0].reviewVerdict,
      '(c4) [T4-M3] ' + name + ': and `reviewVerdict` equals the no-client run\'s (' +
      JSON.stringify(base.tasks[0].reviewVerdict) + '): ' +
      JSON.stringify(report.tasks[0].reviewVerdict))

    assert.deepEqual(amendmentCallsOf(report), amendmentCallsOf(base),
      '(c4) [T4-M3] ' + name + ': `report.judgmentCalls` carries the same ' +
      '`task <id>: amendment (<amends>): <what> — <why>` lines the no-client run pushed — the ' +
      'line is the worker\'s own words and no read edits it: ' +
      JSON.stringify(report.judgmentCalls))
    assert.deepEqual(amendmentCallsOf(report), [CALL('T1', AMEND_FILES), CALL('T1', AMEND_CLAUSE)],
      '(c4) [T4-M3] ' + name + ': and those two lines are exactly `task T1: amendment ' +
      '(<amends>): <what> — <why>`, one per entry, in the reply\'s order: ' +
      JSON.stringify(amendmentCallsOf(report)))

    assert.equal(report.tests.passed, base.tests.passed,
      '(c4) [T4-M3] ' + name + ': `report.tests.passed` equals the no-client run\'s (' +
      JSON.stringify(base.tests.passed) + ') — the suite is the suite: ' +
      JSON.stringify(report.tests.passed))

    // The merge decision, as the leg spells it: how many epochs merged, what
    // each came to, and which waves were blocked.
    assert.equal(report.waveMerges.length, base.waveMerges.length,
      '(c4) [T4-M3] ' + name + ': the same number of `waveMerges` as the no-client run: ' +
      JSON.stringify(report.waveMerges.map((m) => m && m.status)))
    for (const [i, m] of report.waveMerges.entries()) {
      assert.equal(m && m.status, base.waveMerges[i] && base.waveMerges[i].status,
        '(c4) [T4-M3] ' + name + ': `waveMerges[' + i + '].status` equals the no-client run\'s (' +
        JSON.stringify(base.waveMerges[i] && base.waveMerges[i].status) + ') — the merge ' +
        'decision is what it would have been without the read: ' + JSON.stringify(m && m.status))
    }
    assert.deepEqual(report.blockedWaves, base.blockedWaves,
      '(c4) [T4-M3] ' + name + ': and `report.blockedWaves` deep-equals the no-client run\'s: ' +
      JSON.stringify(report.blockedWaves))
  }
}

// ══════════════════════════════════════════════════════════════════════════
// (d4) [T4-M4] the two document `Run:` lines
// ══════════════════════════════════════════════════════════════════════════
// The Proof's second `Run:` is
//   sed -n '/^    One more kind records what a worker asked the PLAN for/,/^    One more kind records what a worker ran/p' fleet/CONTRACT.md \
//     | tr '\n' ' ' | grep -q 'driver:amendment.*task, amends, what, why.*clause.*files.*sim.*hub issue.*amendments.*jev: {compelled, plan_fault, magnitude}.*null.*absent.*gate'
// and the third is
//   grep '^| .amendments. |' skills/ultrapowers/references/report-format.md \
//     | grep -q 'jev: {compelled, plan_fault, magnitude}.*null.*absent.*gate'
// — asked here in-process for the reason BASE's leg (g) gives for its own two:
// a sim may not spawn another proof's shell pipeline. The ranges are the same
// ranges, flattened the same way; the patterns are BREs, in which `(`, `)`,
// `{` and `}` are literal characters, escaped below and meaning the same thing.
{
  const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
  const readDoc = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8').split('\n')

  // ── the CONTRACT paragraph ───────────────────────────────────────────────
  // `sed -n '/start/,/end/p'`: the first line matching `start`, through the
  // first line at or after it matching `end`, inclusive — and through the last
  // line of the file when no later line matches `end`.
  const CONTRACT = 'fleet/CONTRACT.md'
  const START = /^ {4}One more kind records what a worker asked the PLAN for/
  const END = /^ {4}One more kind records what a worker ran/
  const lines = readDoc(CONTRACT)
  const start = lines.findIndex((l) => START.test(l))
  assert.notEqual(start, -1,
    '(d4) [T4-M4] sim precondition: ' + CONTRACT + ' still has the line the Proof\'s sed range ' +
    'opens on (' + String(START) + ') — the amendment paragraph of the evidence bullet')
  let end = lines.findIndex((l, i) => i > start && END.test(l))
  if (end === -1) end = lines.length - 1
  const paragraph = lines.slice(start, end + 1).join(' ')
  assert.match(paragraph,
    /driver:amendment[\s\S]*task, amends, what, why[\s\S]*clause[\s\S]*files[\s\S]*sim[\s\S]*hub issue[\s\S]*amendments[\s\S]*jev: \{compelled, plan_fault, magnitude\}[\s\S]*null[\s\S]*absent[\s\S]*gate/,
    '(d4) [T4-M4] ' + CONTRACT + '\'s amendment paragraph says, in the order the Proof\'s `Run:` ' +
    'line greps for them, everything it said at BASE (`driver:amendment`, the `{task, amends, ' +
    'what, why}` literal, the three `amends` values, the hub-issue mirror and `report.json`\'s ' +
    '`amendments`) AND that the row carries `jev: {compelled, plan_fault, magnitude}` when a ' +
    'reader was handed in, `null` when the read did not answer, is absent without one, and ' +
    'gates nothing — the reads sit after the BASE sentences, which keep their order. The ' +
    'paragraph read: ' + JSON.stringify(paragraph))

  // ── the report-format row ────────────────────────────────────────────────
  const FORMAT = 'skills/ultrapowers/references/report-format.md'
  const ROW = /^\| .amendments. \|/
  const rows = readDoc(FORMAT).filter((l) => ROW.test(l))
  assert.ok(rows.length > 0,
    '(d4) [T4-M4] sim precondition: ' + FORMAT + ' still has the `amendments` row the Proof\'s ' +
    'third `Run:` line greps for (' + String(ROW) + ')')
  assert.ok(
    rows.some((l) => /jev: \{compelled, plan_fault, magnitude\}[\s\S]*null[\s\S]*absent[\s\S]*gate/.test(l)),
    '(d4) [T4-M4] and that row says the field carries `jev: {compelled, plan_fault, magnitude}` ' +
    'when a reader was handed in, `null` when the read did not answer, absent without one, and ' +
    'that the reads gate nothing — in that order. The row(s) read: ' + JSON.stringify(rows))
}

// (h) [M2] the Proof's second `Run:` line — the bridge over every sim on the
// patched tree — is the driver's own, for the reason the header gives: a sim
// may not spawn `pytest` or another sim. This file's part in that leg is to be
// one of the sims the bridge collects, and the sentinel below is what the
// bridge and the Proof's first `Run:` line read. It is printed only if every
// assertion above held.
console.log('ALL TESTS PASSED')
