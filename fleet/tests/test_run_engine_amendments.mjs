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
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { IMPLEMENTER_SCHEMA } from '../run-engine.mjs'
import { rig, makeRepo, passReview, doneImpl } from './_engine_helpers.mjs'

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

// (h) [M2] the Proof's second `Run:` line — the bridge over every sim on the
// patched tree — is the driver's own, for the reason the header gives: a sim
// may not spawn `pytest` or another sim. This file's part in that leg is to be
// one of the sims the bridge collects, and the sentinel below is what the
// bridge and the Proof's first `Run:` line read. It is printed only if every
// assertion above held.
console.log('ALL TESTS PASSED')
