/**
 * fleet/tests/test_run_engine_hub_mirror.mjs — the exam for Task 3: *a named
 * plan defect reaches the run's issue — one comment per note that faults the
 * task text*.
 *
 * This file is the Proof's `Test: fleet/tests/test_run_engine_hub_mirror.mjs`.
 * The run left no `EXAM PATHS:` line for it, so it is written where the Proof
 * names it, and every relative path below is written for THIS directory:
 * `../` is the repository's `fleet/`, `../../` is the checkout root.
 *
 * ── what each Machine clause asserts, restated ──────────────────────────────
 *   M1 — a `jev:note` row reaching `mirrorToHub` (the one function both the
 *        engine's own `appendEvent` and its event-log subscription deliver to)
 *        with `read` `true` and `plan_defect >= 0.7` posts EXACTLY ONE comment
 *        on the RUN issue, body `plan-defect: task <task> (<role>) —
 *        <sentence>`, on the engine's serialized hub chain, drained before the
 *        engine returns.
 *   M2 — a `jev:note` row with `plan_defect < 0.7`, one with `read` `false`,
 *        and one with no `sentence` post nothing; and the `jev:note` row's own
 *        JSON line goes where run-177's routing puts every `jev:` row — the
 *        task's issue when the row names a task the record knows — and never,
 *        in its JSON form, on the run issue.
 *   M3 — the mirror posts once per `commentUid`: a second `jev:note` row
 *        carrying the same `commentUid` posts nothing.
 *   M4 — `fleet/CONTRACT.md`'s LIVE-view paragraph in the `**Kata record
 *        (engine):**` bullet says a `jev:note` line is routed like every
 *        `jev:` row and that one reading `plan_defect >= 0.7` is, besides, one
 *        `plan-defect: task <id> (<role>) — <sentence>` comment on the run's
 *        issue, once per note, and that nothing blocks on it.
 *   M5 — a `comment` the hub refuses for that post (a throwing `kata.comment`)
 *        is one `kata:write-failed` row with `what` `comment` and the run
 *        issue's uid, and the run resolves with the task's `status` and
 *        `reviewVerdict` what they are when the post succeeds.
 *
 * ── the legs, and where each is answered ────────────────────────────────────
 * Every assertion below names its leg and the clause it comes from, so a
 * reader can map this file back to the contract.
 *   (a) [M1] `planDefectComment(...)` on the clause's own row, equal to the
 *       full body string; and run A — one task `1`, a fake hub, `kataRecord`
 *       in its args, the real `makeEventLog` through the rig's `eventLog`
 *       passthrough, and an `impl:1` stub that pushes the `C1` note row
 *       through `eventLog.onEvent` while the run is live — leaving exactly one
 *       comment on the run uid whose body equals
 *       `plan-defect: task 1 (impl) — the Context names an import that does
 *       not exist`.
 *   (b) [M2] `planDefectComment` on the four rows that earn no comment; and
 *       run B — run A plus those three pushed rows — leaving no further
 *       `plan-defect:` comment on the run uid, no `{"kind":"jev:note"` body
 *       there at all, and each pushed row's own JSON line on the task-1 uid.
 *   (c) [M3] run C — the `C1` row, the same row again, then a `C2` row —
 *       leaving the `plan-defect:` count on the run uid at 1 after the repeat
 *       and at 2 after `C2`.
 *   (d) [M4] the Proof's CONTRACT `Run:` line.
 *   (e) [M5] run E — run A with a `comment` that throws `503` for every body
 *       beginning `plan-defect:`.
 *
 * ── the rig ─────────────────────────────────────────────────────────────────
 * One sim shape for every run leg: a one-task plan (`1`, over `1.txt`), the
 * hub on through `_engine_helpers.mjs`'s `fakeHub` and `kataRecord` through
 * `extraArgs`, exactly as `test_jev_client.mjs`'s routing leg drives one.
 * Below the agent seam the rig is REAL, as in every sibling engine sim: real
 * git repositories, real `cloneAtBase` clones, the real capture, the real fold
 * kernel through the real `execSeam`. Only `agent` is stubbed, and the hub is
 * the in-memory fake. Nothing here opens a socket and nothing here spawns a
 * process.
 *
 * The event log is the REAL `makeEventLog` from `fleet/run-waves.mjs` (the
 * task's `Consumes:`), pointed at the run's own `events.jsonl`, and the note
 * rows are pushed through its `onEvent` from inside the `impl:1` stub — while
 * the run is live, with the engine's subscription (`mirrorLogLine`) in place,
 * so each row reaches `mirrorToHub` the way the engine's own `appendEvent`
 * would deliver it.
 *
 * ── five readings this file is written on ───────────────────────────────────
 *   • Every hub read happens AFTER `run()` has resolved and with no extra
 *     wait of any kind. That is how M1's "drained before the engine returns"
 *     is proven: a post still pending when the engine returned is a post this
 *     file does not see.
 *   • Legs (b), (c) and (e) each get their OWN run rather than extra pushes
 *     into run A's. (e) demands EXACTLY ONE `kata:write-failed`, which can
 *     only hold if the run it repeats made exactly one plan-defect post — so
 *     "the run of (a)" is the one-row run, and (b)'s "three more rows" and
 *     (c)'s second push are each that run extended.
 *   • (c)'s `C2` row carries a sentence of its own. The leg pins only its
 *     `commentUid`; giving it (a)'s sentence would make the two bodies
 *     byte-identical and "exactly one comment whose body equals (a)'s"
 *     unreadable against "at 2". Distinct sentence, distinct body, both counts
 *     exact.
 *   • M2's "the row's own JSON line" is asserted as an EQUALITY against the
 *     line the record actually got: a second subscriber of this file's own on
 *     the same event log captures `(event, line)` for every `jev:note` append,
 *     so the expected body is the record's bytes and not a re-spelling of
 *     them. A subscriber is a view and never the record's failure
 *     (`makeEventLog`), so adding one changes nothing the engine does.
 *   • Leg (d)'s `Run:` line is a document grep, and it is emulated HERE, in
 *     process — the `sed -n '/a/,/b/p' | tr '\n' ' ' | grep` shape translated
 *     pattern for pattern (the shell's BRE has `(`, `)`, `<` and `>` literal;
 *     only `.` and `\.` carry meaning). That is the convention the sibling
 *     sims already use for a CONTRACT paragraph, and it keeps this file free
 *     of child processes.
 *
 * `planDefectComment` is reached through a NAMESPACE import of
 * `../run-engine.mjs`: a named import of an export BASE has not got is a
 * link-time error that would take every other leg down with it and name no
 * leg at all.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { makeEventLog } from '../run-waves.mjs'
import * as engine from '../run-engine.mjs'
import { makeRepo, rig, gitSync, fakeHub, passReview, cleanCritic, doneImpl } from './_engine_helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hub-mirror-')))
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }))

// ══════════════════════════════════════════════════════════════════════════
// the shared literals: the row, the record, the plan
// ══════════════════════════════════════════════════════════════════════════

/** The `jev:note` row as the note read (Task 2, a later wave) appends it —
 *  the shared literal the Context spells: `read` `true` with the five answers
 *  as plain numbers and strings. `over` replaces fields; a field named in
 *  `without` is dropped outright (that is how "no `sentence`" is built, rather
 *  than by an `undefined` value JSON would drop silently anyway). */
const noteRow = (over = {}, without = []) => {
  const row = {
    kind: 'jev:note',
    task: '1',
    role: 'impl',
    actor: 'implementer',
    commentUid: 'C1',
    eventId: 'E1',
    chars: 137,
    read: true,
    stuck: 0.12,
    plan_defect: 0.81,
    divergence: 0.33,
    note_kind: 'plan-defect',
    operator_should_read: 0.55,
    model: 'jev-1.13.0',
    sentence: 'the Context names an import that does not exist',
    ...over,
  }
  for (const key of without) delete row[key]
  return row
}

const SENTENCE_A = 'the Context names an import that does not exist'
const SENTENCE_C2 = 'the Files slot names a path this plan never writes'
const BODY_A = 'plan-defect: task 1 (impl) — ' + SENTENCE_A
const BODY_C2 = 'plan-defect: task 1 (impl) — ' + SENTENCE_C2

const PROJECT_ID = 11
const RUN_UID = 'RUN-UID'
const TASK_UID = 'TASK-1-UID'
/** The fake's issues; their revisions must equal the record's, since a sheet
 *  read whose revision disagrees is fatal to the engine. */
const ISSUES = () => ({
  [RUN_UID]: { revision: 1, short_id: 'run1', metadata: {} },
  [TASK_UID]: { revision: 1, short_id: 'tk11', metadata: {} },
})
/** The record, spelled as the launcher writes it. */
const RECORD = () => ({
  url: 'https://kata.invalid',
  project: { id: PROJECT_ID, uid: 'PROJ', name: 'ultrapowers' },
  run: { uid: RUN_UID, revision: 1 },
  tasks: { 1: { uid: TASK_UID, short_id: 'tk11', revision: 1 } },
})

/** A wave's task, the shape the rig's sims spell. */
const taskOf = (id) => ({
  id, title: 'task ' + id, files: [id + '.txt'], tier: 'standard', review: 'lean',
  writes: [id + '.txt'], commutes: [], testCmd: 'bash check.sh', proofTests: [], proofRuns: [],
  body: 'sim task ' + id,
})

/** The run's own record, read back off disk. */
const eventsIn = (runDir) => {
  let text = ''
  try { text = fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8') } catch { return [] }
  return text.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('{'))
    .map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
}

/**
 * One hub-on run of the one-task plan. `rows` are pushed through the run's own
 * `eventLog.onEvent`, in order, from inside the `impl:1` stub — while the run
 * is live. `wrapComment` may replace the fake's `comment` (leg (e)).
 *
 * Returns the report, the fake, and the `(event, line)` pairs this file's own
 * subscriber saw for every `jev:note` append — the record's bytes, for M2.
 */
const hubRun = async ({ tag, rows, wrapComment }) => {
  const repo = makeRepo(path.join(tmp, 'repo-' + tag))
  const runDir = path.join(tmp, 'run-' + tag)
  const base = gitSync(['rev-parse', 'HEAD'], repo)
  const hub = fakeHub({ projectId: PROJECT_ID, issues: ISSUES() })
  if (wrapComment) hub.kata.comment = wrapComment(hub.kata.comment)

  const eventLog = makeEventLog({ file: path.join(runDir, 'events.jsonl'), runId: tag, base })
  // This file's own view of the log: the exact line each pushed row was
  // recorded as. A subscriber never reaches the append and never fails the
  // record (`makeEventLog`), so the engine's run is the run it would have had.
  const pushed = []
  eventLog.subscribe((e, line) => {
    if (String((e && e.kind) || '') === 'jev:note') pushed.push({ event: e, line })
  })

  const labels = []
  const { run } = rig({
    repo, runDir, waves: [[taskOf('1')]], stamp: 'mirror-' + tag,
    kata: hub.kata,
    eventLog,
    extraArgs: { kataRecord: RECORD(), attentionPollMs: 3600000 },
    stub: (prompt, opts, cwd) => {
      const label = String(opts.label)
      labels.push(label)
      if (label === 'impl:1') {
        fs.writeFileSync(path.join(cwd, '1.txt'), 'from ' + label + '\n')
        for (const row of rows) eventLog.onEvent(row)
        return doneImpl(cwd)
      }
      if (label === 'integration') return cleanCritic()
      if (label.startsWith('review:')) return passReview()
      if (label.startsWith('fix:')) return doneImpl(cwd)
      return { status: 'BLOCKED', summary: 'sim: unexpected dispatch ' + label }
    },
  })
  // No wait of any kind between here and the reads: what the hub has when
  // `run()` resolves is what "drained before the engine returns" means.
  const report = await run()
  return { report, hub, pushed, labels, runDir }
}

const planDefectBodies = (hub, uid) => hub.commentsOn(uid).filter((b) => b.startsWith('plan-defect:'))
const jsonNoteBodies = (hub, uid) => hub.commentsOn(uid).filter((b) => b.startsWith('{"kind":"jev:note"'))

// ══════════════════════════════════════════════════════════════════════════
// (a) [M1] the body `planDefectComment` answers, and the one comment it earns
// ══════════════════════════════════════════════════════════════════════════

assert.equal(typeof engine.planDefectComment, 'function',
  '(a) [M1] `fleet/run-engine.mjs` exports `planDefectComment(row)` at module scope — the ' +
  'task\'s `Produces:`, and the symbol every leg below drives. Got ' +
  JSON.stringify(typeof engine.planDefectComment))

assert.equal(
  engine.planDefectComment({ kind: 'jev:note', task: '3', role: 'impl', read: true,
    plan_defect: 0.7, sentence: 'leg two cannot pass as written' }),
  'plan-defect: task 3 (impl) — leg two cannot pass as written',
  '(a) [M1] `planDefectComment` answers the body `plan-defect: task <task> (<role>) — ' +
  '<sentence>` for a `jev:note` row with `read` true, a numeric `plan_defect` >= 0.7 (0.7 ' +
  'itself is inside the threshold) and a string `sentence` — the Proof\'s own row, its full ' +
  'body string')

const runA = await hubRun({ tag: 'a', rows: [noteRow()] })
const rowA = runA.report.tasks.find((t) => t && t.task === '1')
assert.equal(rowA && rowA.status, 'done',
  '(a) [M1] sim precondition (and the Claim\'s "nothing blocked by it"): the hub-on run took ' +
  'task 1 to `done` with the note row pushed through its event log. Labels dispatched: ' +
  JSON.stringify(runA.labels) + '. Got ' + JSON.stringify(runA.report.tasks))

assert.deepEqual(runA.hub.commentsOn(RUN_UID).filter((b) => b === BODY_A), [BODY_A],
  '(a) [M1] a `jev:note` row with `read` true and `plan_defect` 0.81, pushed through the run\'s ' +
  'event log while the run was live, leaves EXACTLY ONE comment on the RUN issue (' + RUN_UID +
  ') whose body equals ' + JSON.stringify(BODY_A) + ' — and it is there the moment `run()` ' +
  'resolves, which is M1\'s "drained before the engine returns". Comments on the run issue: ' +
  JSON.stringify(runA.hub.commentsOn(RUN_UID)))

assert.deepEqual(planDefectBodies(runA.hub, RUN_UID), [BODY_A],
  '(a) [M1] and it is the ONLY `plan-defect:` comment the run issue got — one note, one ' +
  'comment. Got ' + JSON.stringify(planDefectBodies(runA.hub, RUN_UID)))

// ══════════════════════════════════════════════════════════════════════════
// (b) [M2] the rows that earn no comment, and where the row's JSON line goes
// ══════════════════════════════════════════════════════════════════════════

const NULL_ROWS = [
  ['a `plan_defect` below the threshold (0.69)', noteRow({ plan_defect: 0.69, commentUid: 'N1' })],
  ['`read` false (with `plan_defect` 0.9)', noteRow({ read: false, plan_defect: 0.9, commentUid: 'N2' })],
  ['no `sentence`', noteRow({ commentUid: 'N3' }, ['sentence'])],
  ['a kind that is not `jev:note` (`driver:amendment`)',
    noteRow({ kind: 'driver:amendment', commentUid: 'N4' })],
]
for (const [why, row] of NULL_ROWS) {
  assert.equal(engine.planDefectComment(row), null,
    '(b) [M2] `planDefectComment` answers `null` for a row with ' + why + ' — it earns no ' +
    'comment at all. Row: ' + JSON.stringify(row))
}

// Run B is run A with the three rows M2 names pushed after it, the same way.
// The `driver:amendment` row is not among them: M2's run half names three, and
// a `driver:`-kinded line off the event log is run-main's own and is never the
// engine's subscription's to post (`mirrorLogLine`), so pushing it here would
// assert a rule this clause does not make.
const B_ROWS = [
  noteRow(),
  noteRow({ plan_defect: 0.69, commentUid: 'N1' }),
  noteRow({ read: false, plan_defect: 0.9, commentUid: 'N2' }),
  noteRow({ commentUid: 'N3' }, ['sentence']),
]
const runB = await hubRun({ tag: 'b', rows: B_ROWS })
const rowB = runB.report.tasks.find((t) => t && t.task === '1')
assert.equal(rowB && rowB.status, 'done',
  '(b) [M2] sim precondition: the four-row run took task 1 to `done`. Labels dispatched: ' +
  JSON.stringify(runB.labels) + '. Got ' + JSON.stringify(runB.report.tasks))

assert.deepEqual(planDefectBodies(runB.hub, RUN_UID), [BODY_A],
  '(b) [M2] the three further rows — `plan_defect` 0.69, `read` false, no `sentence` — add NO ' +
  'comment beginning `plan-defect:` to the run issue: the only one there is still the ' +
  'qualifying row\'s. Got ' + JSON.stringify(planDefectBodies(runB.hub, RUN_UID)))

assert.deepEqual(jsonNoteBodies(runB.hub, RUN_UID), [],
  '(b) [M2] and no comment on the run issue has a body beginning `{"kind":"jev:note"` — the ' +
  'row never reaches the run issue in its JSON form. Got ' +
  JSON.stringify(jsonNoteBodies(runB.hub, RUN_UID)))

assert.equal(runB.pushed.length, 4,
  '(b) [M2] sim precondition: the run\'s event log recorded all four pushed `jev:note` rows; ' +
  'got ' + runB.pushed.length)
const onTaskB = runB.hub.commentsOn(TASK_UID)
for (const { event, line } of runB.pushed) {
  assert.deepEqual(onTaskB.filter((b) => b === line), [line],
    '(b) [M2] every `jev:note` row\'s own JSON line goes where run-177\'s routing puts every ' +
    '`jev:` row — the task\'s issue, the row naming task `1` which the record knows — exactly ' +
    'once and byte for byte as the record has it. Missing for `commentUid` ' +
    JSON.stringify(event.commentUid) + '. Comments on ' + TASK_UID + ': ' +
    JSON.stringify(onTaskB))
}
assert.equal(jsonNoteBodies(runB.hub, TASK_UID).length, 4,
  '(b) [M2] four rows pushed, four `jev:note` JSON lines on the task issue — no row is ' +
  'dropped and none is doubled. Got ' + JSON.stringify(jsonNoteBodies(runB.hub, TASK_UID)))
assert.deepEqual(planDefectBodies(runB.hub, TASK_UID), [],
  '(b) [M2] and no `plan-defect:` comment is on the task issue: that comment is the RUN ' +
  'issue\'s alone. Got ' + JSON.stringify(planDefectBodies(runB.hub, TASK_UID)))

// ══════════════════════════════════════════════════════════════════════════
// (c) [M3] once per `commentUid`
// ══════════════════════════════════════════════════════════════════════════

const runC = await hubRun({
  tag: 'c',
  rows: [noteRow(), noteRow(), noteRow({ commentUid: 'C2', sentence: SENTENCE_C2 })],
})
const rowC = runC.report.tasks.find((t) => t && t.task === '1')
assert.equal(rowC && rowC.status, 'done',
  '(c) [M3] sim precondition: the three-row run took task 1 to `done`. Labels dispatched: ' +
  JSON.stringify(runC.labels) + '. Got ' + JSON.stringify(runC.report.tasks))

assert.deepEqual(runC.hub.commentsOn(RUN_UID).filter((b) => b === BODY_A), [BODY_A],
  '(c) [M3] the `C1` row pushed a SECOND time posts nothing: the run issue carries its body ' +
  'exactly once, so the `plan-defect:` count stood at 1 after the repeat. Got ' +
  JSON.stringify(planDefectBodies(runC.hub, RUN_UID)))
assert.deepEqual(planDefectBodies(runC.hub, RUN_UID), [BODY_A, BODY_C2],
  '(c) [M3] and a row carrying a DIFFERENT `commentUid` (`C2`) takes the count to 2 — the ' +
  'mirror posts once per `commentUid`, in push order. Got ' +
  JSON.stringify(planDefectBodies(runC.hub, RUN_UID)))

// ══════════════════════════════════════════════════════════════════════════
// (d) [M4] the CONTRACT paragraph
// ══════════════════════════════════════════════════════════════════════════
// The Proof's `Run:` line, emulated in process:
//   sed -n '/^  Every capture of the graded patch/,/^  The worker.s raised hand:/p' \
//     fleet/CONTRACT.md | tr '\n' ' ' |
//   grep -q 'jev:note.*plan_defect.*0\.7.*plan-defect: task <id> (<role>) — <sentence>.*run.s issue.*once per note.*blocks'
// `sed`'s range is inclusive of both matching lines; `tr` turns every newline
// into a space; the shell's BRE has `(`, `)`, `<` and `>` literal, so only `.`
// and `\.` are translated.
{
  const contract = path.join(ROOT, 'fleet', 'CONTRACT.md')
  const lines = fs.readFileSync(contract, 'utf8').split('\n')
  const from = lines.findIndex((l) => /^  Every capture of the graded patch/.test(l))
  assert.ok(from !== -1,
    '(d) [M4] sim precondition: `fleet/CONTRACT.md` has the `  Every capture of the graded ' +
    'patch` line the Proof\'s `sed` range starts at')
  const to = lines.findIndex((l, i) => i > from && /^  The worker.s raised hand:/.test(l))
  assert.ok(to !== -1,
    '(d) [M4] sim precondition: the `  The worker\'s raised hand:` line follows it, closing the ' +
    'range')
  const paragraph = lines.slice(from, to + 1).join(' ') + ' '
  assert.match(paragraph,
    /jev:note.*plan_defect.*0\.7.*plan-defect: task <id> \(<role>\) — <sentence>.*run.s issue.*once per note.*blocks/,
    '(d) [M4] the LIVE-view paragraph of the `**Kata record (engine):**` bullet says, in this ' +
    'order, that a `jev:note` line is routed like every `jev:` row and that one reading ' +
    '`plan_defect` >= 0.7 is besides one `plan-defect: task <id> (<role>) — <sentence>` comment ' +
    'on the run\'s issue, once per note, and that nothing blocks on it — the Proof\'s `Run:` ' +
    'line, emulated here. The paragraph as it stands: ' + JSON.stringify(paragraph))
}

// ══════════════════════════════════════════════════════════════════════════
// (e) [M5] a refused post is one `kata:write-failed`, and blocks nothing
// ══════════════════════════════════════════════════════════════════════════

const refused = []
const runE = await hubRun({
  tag: 'e',
  rows: [noteRow()],
  // Every body beginning `plan-defect:` is refused, and refused BEFORE the
  // fake records it — so a comment the hub never accepted is on no issue.
  wrapComment: (real) => async (project, uid, body) => {
    if (String(body).startsWith('plan-defect:')) {
      refused.push({ uid, body })
      throw new Error('503')
    }
    return real(project, uid, body)
  },
})
const rowE = runE.report.tasks.find((t) => t && t.task === '1')

assert.deepEqual(refused, [{ uid: RUN_UID, body: BODY_A }],
  '(e) [M5] sim precondition: the fake was asked for exactly one `plan-defect:` post, on the ' +
  'run issue, with the body of (a) — and refused it with a 503. Got ' + JSON.stringify(refused))

assert.equal(rowE && rowE.status, rowA.status,
  '(e) [M5] a `comment` the hub refuses for that post does not change the task\'s `status`: it ' +
  'is what it is when the post succeeds (' + JSON.stringify(rowA.status) + '). Got ' +
  JSON.stringify(rowE && rowE.status))
assert.equal(rowE && rowE.reviewVerdict, rowA.reviewVerdict,
  '(e) [M5] nor its `reviewVerdict`: ' + JSON.stringify(rowA.reviewVerdict) + ' either way. ' +
  'Got ' + JSON.stringify(rowE && rowE.reviewVerdict))

for (const uid of [RUN_UID, TASK_UID]) {
  assert.deepEqual(planDefectBodies(runE.hub, uid), [],
    '(e) [M5] and the refused comment is on NO issue — not on ' + uid + ', not as a retry ' +
    'anywhere else. Got ' + JSON.stringify(planDefectBodies(runE.hub, uid)))
}

const failures = eventsIn(runE.runDir).filter((e) => String(e.kind || '') === 'kata:write-failed')
const commentFailures = failures.filter((e) => e.what === 'comment' && e.uid === RUN_UID)
assert.equal(commentFailures.length, 1,
  '(e) [M5] the refusal is EXACTLY ONE `kata:write-failed` row in `events.jsonl` whose `what` ' +
  'is `comment` and whose `uid` is the record\'s `run.uid` (' + RUN_UID + ') — one row, not a ' +
  'throw out of the engine and not a park. Every `kata:write-failed` row of the run: ' +
  JSON.stringify(failures))

// The sentinel the suite greps for (`tests/test_fleet_suite.py`): printed only
// if every assertion above held.
console.log('ALL TESTS PASSED')
