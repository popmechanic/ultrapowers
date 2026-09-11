// fleet/tests/test_run_engine_wave_events.mjs — #898 task 1: the run's event
// log says when each wave's work LANDED on the integration branch, and when a
// wave was BLOCKED, naming the tasks each time.
//
// The exam is written against the task's Machine clauses, leg by leg. Every
// assertion names the leg it belongs to and the clause it comes from, so a
// reader can map this file back to the contract:
//
//   M1  when a wave's candidate is adopted the engine appends one
//       {"kind":"driver:wave-adopted","wave":<n>,"tasks":[<ids>],"headSha":"<sha>"}
//       — `wave` the 1-based wave number, `tasks` the ids the wave merged in
//       plan order, `headSha` the adopted head — after the adoption and before
//       the next `engine:phase`.
//   M2  when a wave ends TEST_FAILED (reconcile exhaustion, or a red baseline)
//       the engine appends one
//       {"kind":"driver:wave-blocked","wave":<n>,"tasks":[<ids>],"detail":"<text>"}
//       with `detail` the same text that wave's `waveMerges` row carries.
//   M3  a green one-wave run's log carries exactly one `driver:wave-adopted`
//       and zero `driver:wave-blocked`; a run parked on a red baseline carries
//       zero `driver:wave-adopted` and one `driver:wave-blocked` per
//       `waveMerges` row with status `TEST_FAILED` (a `SKIPPED` row emits none).
//   M4  fleet/CONTRACT.md names both kinds, and the line naming
//       `driver:wave-adopted` also names `headSha`.
//
// Legs: (a) M1, (b) M2 + M3, (c) M3, (d) M4.
//
// The rig is test_run_engine_baseline.mjs's shape — `makeRepo`, the agent seam
// stubbed, everything below it real — with one addition this exam needs: the
// engine's `log`/`phase` seams are wired into `<runDir>/events.jsonl` through
// the production `makeEventLog`, and the stub agent emits the
// `worker:start`/`worker:end` envelope run-worker emits in a real run. So the
// event log a leg reads back carries the same `engine:phase` and `worker:end`
// lines a real run's does, stamped by the same monotonic `ulid` the engine
// stamps its own events with — which is what makes "sorts after" and "before
// the next phase" readable here at all.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeRepo, provision, gitSync, passReview, cleanCritic, doneImpl } from './_engine_helpers.mjs'
import { makeCwdFor, withPatchCapture, defaultTaskIdOf, makeEventLog } from '../run-waves.mjs'
import { execSeam } from '../run-main.mjs'
import { runEngine } from '../run-engine.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const CONTRACT = path.join(ROOT, 'fleet', 'CONTRACT.md')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-wave-events-'))

// ── the rig ──────────────────────────────────────────────────────────────────

// The plan entry shape the sibling engine sims use.
const task = (id, over = {}) => ({
  id, title: 'task ' + id, files: [id + '.txt'], tier: 'standard', review: 'lean',
  writes: [id + '.txt'], commutes: [], body: 'sim task ' + id, ...over,
})

function rigWithEvents({ repo, runDir, waves, edges = [], stub, stamp }) {
  const taskIds = waves.flat().map((t) => t.id)
  const { base, clonesDir, patchesDir, integ } = provision({ repo, runDir, taskIds })
  // The production sink, at the path the engine's own appendEvent writes to.
  const eventLog = makeEventLog({ file: path.join(runDir, 'events.jsonl'), runId: stamp, base })
  const patchBase = { current: base }
  const cwdFor = makeCwdFor({ clonesDir })
  const labels = []
  const inner = async (prompt, opts) => {
    labels.push(opts.label)
    eventLog.onEvent({ kind: 'worker:start', label: opts.label, role: 'sim' })
    try {
      return await stub(prompt, opts, cwdFor(opts))
    } finally {
      eventLog.onEvent({ kind: 'worker:end', label: opts.label, role: 'sim' })
    }
  }
  const agent = withPatchCapture({
    agent: inner, clonesDir, base: () => patchBase.current, patchesDir,
    taskIdOf: defaultTaskIdOf,
  })
  const logs = []
  const run = () => runEngine({
    args: {
      waves, edges, testCmd: 'bash check.sh',
      acceptance: { mode: 'suite', reason: 'sim' }, stamp,
      integrationBranch: 'ultra/integration-' + stamp,
      dependencyEdges: edges.map(([a, b]) => a + ' -> ' + b),
      patchInput: patchesDir,
    },
    agent,
    parallel: (thunks) => Promise.all(thunks.map((t) => t())),
    exec: execSeam,
    paths: { repoDir: repo, runDir, clonesDir },
    log: (l) => { logs.push(String(l)); eventLog.log(l) },
    phase: (p) => eventLog.phase(p),
    patchBase,
  })
  return { run, base, clonesDir, integ, logs, labels, runDir }
}

// The run's own record, read back. An absent file reads as no records, so an
// engine that writes none fails a count assertion rather than an ENOENT.
const readEvents = (runDir) => {
  const file = path.join(runDir, 'events.jsonl')
  if (!fs.existsSync(file)) return []
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l) } catch { return null } })
    .filter(Boolean)
}
const ofKind = (evs, kind) => evs.filter((e) => e.kind === kind)
const adoptedIn = (evs) => ofKind(evs, 'driver:wave-adopted')
const blockedIn = (evs) => ofKind(evs, 'driver:wave-blocked')

// The last `worker:end` of one task — the labels are `impl:<id>`,
// `review:<id>:<iter>[:<pass>]`, `fix:<id>:<iter>`.
const WORKER_KINDS = ['impl', 'review', 'fix']
const lastWorkerEnd = (evs, id) => {
  const ends = evs.filter((e) => e.kind === 'worker:end' && typeof e.label === 'string' &&
    WORKER_KINDS.includes(e.label.split(':')[0]) && e.label.split(':')[1] === id)
  return ends.length ? ends[ends.length - 1] : null
}
const phasesBetween = (evs, afterId, beforeId) =>
  ofKind(evs, 'engine:phase').filter((e) => e.id > afterId && e.id < beforeId).map((e) => e.phase)
const phasesAfter = (evs, id) => ofKind(evs, 'engine:phase').filter((e) => e.id > id).map((e) => e.phase)

// Every `driver:wave-adopted` sits after the last worker of every task of its
// wave, and before the phase the engine announces next — M1's placement, asked
// of one event and one wave's ids.
const assertPlacement = (evs, event, ids, leg) => {
  let latest = null
  for (const id of ids) {
    const end = lastWorkerEnd(evs, id)
    assert.ok(end, leg + ' [M1]: task ' + id + ' ran a worker in this sim — the rig records ' +
      'worker:end for every dispatch, so a missing one is the rig, not the engine')
    assert.ok(event.id > end.id,
      leg + ' [M1]: the driver:wave-adopted line is appended AFTER task ' + id + '\'s last ' +
      'worker:end (' + end.label + ') — ids are the log\'s sort key: ' +
      JSON.stringify({ adopted: event.id, workerEnd: end.id }))
    if (latest === null || end.id > latest) latest = end.id
  }
  assert.deepEqual(phasesBetween(evs, latest, event.id), [],
    leg + ' [M1]: and no engine:phase is announced between that last worker:end and the ' +
    'adoption — the event belongs to the wave that just landed')
  assert.ok(phasesAfter(evs, event.id).length >= 1,
    leg + ' [M1]: a later engine:phase exists, so "before the next engine:phase" is a real ' +
    'ordering and not a vacuous one: ' + JSON.stringify(ofKind(evs, 'engine:phase').map((e) => e.phase)))
}

const HEX40 = /^[0-9a-f]{40}$/

// ── (a) a green one-wave run: one adoption, named and placed [M1] ────────────
{
  const repo = makeRepo(path.join(tmp, 'repo-a'))
  const runDir = path.join(tmp, 'run-a')
  const stub = (prompt, opts, cwd) => {
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') {
      const id = opts.label.split(':')[1]
      fs.writeFileSync(path.join(cwd, id + '.txt'), 'from ' + id + '\n')
      return doneImpl(cwd)
    }
    if (kind === 'review') return passReview()
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('leg (a): unexpected dispatch ' + opts.label)
  }
  const r = rigWithEvents({
    repo, runDir, waves: [[task('1'), task('2')]], edges: [], stub, stamp: 'we-a',
  })
  const report = await r.run()
  const evs = readEvents(runDir)

  assert.equal(report.waveMerges[0].status, 'MERGED',
    'leg (a) [M1]: the one wave merges — ' + JSON.stringify(report.judgmentCalls))

  const adopted = adoptedIn(evs)
  assert.equal(adopted.length, 1,
    'leg (a) [M1] [M3]: a green one-wave run\'s events.jsonl carries EXACTLY ONE ' +
    'driver:wave-adopted line — a missing line and a second one both fail: ' +
    JSON.stringify(adopted))
  assert.equal(adopted[0].wave, 1,
    'leg (a) [M1]: its `wave` is the 1-based wave number 1 — ' + JSON.stringify(adopted[0]))
  assert.deepEqual(adopted[0].tasks, ['1', '2'],
    'leg (a) [M1]: its `tasks` are the ids the wave merged, in plan order — a wrong order ' +
    'fails: ' + JSON.stringify(adopted[0].tasks))
  assert.match(String(adopted[0].headSha), HEX40,
    'leg (a) [M1]: its `headSha` is a 40-hex sha — ' + JSON.stringify(adopted[0].headSha))
  assert.equal(adopted[0].headSha, report.waveMerges[0].headSha,
    'leg (a) [M1]: and it is the head the run adopted, the same sha waveMerges[0] carries — ' +
    'a wrong sha fails: ' + JSON.stringify({ event: adopted[0].headSha,
                                             row: report.waveMerges[0].headSha }))
  assertPlacement(evs, adopted[0], ['1', '2'], 'leg (a)')

  // ── (c) the same green run carries no blocked line [M3] ────────────────────
  assert.deepEqual(blockedIn(evs), [],
    'leg (c) [M3]: a green run carries ZERO driver:wave-blocked lines: ' +
    JSON.stringify(blockedIn(evs)))
}

// ── (a) a green two-wave run: one adoption per wave, each its own [M1] ───────
{
  const repo = makeRepo(path.join(tmp, 'repo-a2'))
  const runDir = path.join(tmp, 'run-a2')
  const stub = (prompt, opts, cwd) => {
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') {
      const id = opts.label.split(':')[1]
      fs.writeFileSync(path.join(cwd, id + '.txt'), 'from ' + id + '\n')
      return doneImpl(cwd)
    }
    if (kind === 'review') return passReview()
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('leg (a) two-wave: unexpected dispatch ' + opts.label)
  }
  // Task 2 is in wave 2 because it consumes task 1's symbol — the dependency
  // edge is what puts it there, and what makes the two adoptions sequential.
  const r = rigWithEvents({
    repo, runDir, waves: [[task('1')], [task('2')]], edges: [['1', '2']], stub, stamp: 'we-a2',
  })
  const report = await r.run()
  const evs = readEvents(runDir)

  assert.equal(report.waveMerges[0].status, 'MERGED',
    'leg (a) [M1]: wave 1 merges — ' + JSON.stringify(report.judgmentCalls))
  assert.equal(report.waveMerges[1].status, 'MERGED',
    'leg (a) [M1]: wave 2 merges — ' + JSON.stringify(report.judgmentCalls))

  const adopted = adoptedIn(evs)
  assert.equal(adopted.length, 2,
    'leg (a) [M1]: a green two-wave run carries EXACTLY TWO driver:wave-adopted lines — one ' +
    'line fails: ' + JSON.stringify(adopted))
  assert.deepEqual(adopted.map((e) => e.wave), [1, 2],
    'leg (a) [M1]: the first is wave 1 and the second is wave 2, in that id order — a repeated ' +
    'wave 1 fails: ' + JSON.stringify(adopted.map((e) => e.wave)))
  assert.ok(adopted[0].id < adopted[1].id,
    'leg (a) [M1]: and the ids are in that order too: ' +
    JSON.stringify(adopted.map((e) => e.id)))
  assert.deepEqual(adopted[0].tasks, ['1'],
    'leg (a) [M1]: wave 1\'s line names only wave 1\'s task — ' + JSON.stringify(adopted[0]))
  assert.deepEqual(adopted[1].tasks, ['2'],
    'leg (a) [M1]: wave 2\'s line names only wave 2\'s task — ' + JSON.stringify(adopted[1]))
  assert.equal(adopted[0].headSha, report.waveMerges[0].headSha,
    'leg (a) [M1]: wave 1\'s headSha is waveMerges[0].headSha — ' +
    JSON.stringify({ event: adopted[0].headSha, row: report.waveMerges[0].headSha }))
  assert.equal(adopted[1].headSha, report.waveMerges[1].headSha,
    'leg (a) [M1]: wave 2\'s headSha is waveMerges[1].headSha — ' +
    JSON.stringify({ event: adopted[1].headSha, row: report.waveMerges[1].headSha }))
  assert.notEqual(adopted[0].headSha, adopted[1].headSha,
    'leg (a) [M1]: each line carries the head ITS wave adopted — a shared sha fails')
  for (const e of adopted) {
    assert.match(String(e.headSha), HEX40,
      'leg (a) [M1]: each headSha is a 40-hex sha — ' + JSON.stringify(e.headSha))
  }
  assertPlacement(evs, adopted[0], ['1'], 'leg (a) wave 1')
  assertPlacement(evs, adopted[1], ['2'], 'leg (a) wave 2')

  assert.deepEqual(blockedIn(evs), [],
    'leg (c) [M3]: a green two-wave run carries zero driver:wave-blocked lines: ' +
    JSON.stringify(blockedIn(evs)))
}

// ── (b) reconcile exhaustion: one blocked line, carrying the row's detail ────
{
  const repo = makeRepo(path.join(tmp, 'repo-b'))
  const runDir = path.join(tmp, 'run-b')
  let reconciles = 0
  const stub = (prompt, opts, cwd) => {
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') {
      fs.writeFileSync(path.join(cwd, '1.txt'), 'useful work\n')
      fs.writeFileSync(path.join(cwd, 'BROKEN'), 'oops\n')
      return doneImpl(cwd)
    }
    if (kind === 'review') return passReview()
    // Refusing, every attempt the engine is willing to make.
    if (kind === 'reconcile') { reconciles += 1; return { status: 'BLOCKED', summary: 'not fixable here' } }
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('leg (b): unexpected dispatch ' + opts.label)
  }
  // `proofTests` names a path of the task, so the candidate's red stays
  // ATTRIBUTED to it and the wave takes the reconcile route rather than the
  // adopt-and-record one (#871).
  const r = rigWithEvents({
    repo, runDir, stub, stamp: 'we-b',
    waves: [[task('1', { proofTests: ['fleet/tests/test_wave_events_sim.mjs'] })]],
  })
  const report = await r.run()
  const evs = readEvents(runDir)

  assert.ok(reconciles >= 1,
    'leg (b) [M2]: the reconcile agent was dispatched and refused — ' + JSON.stringify(r.labels))
  assert.equal(report.waveMerges[0].status, 'TEST_FAILED',
    'leg (b) [M2]: the wave ends TEST_FAILED after reconcile exhaustion — ' +
    JSON.stringify(report.waveMerges))

  const blocked = blockedIn(evs)
  assert.equal(blocked.length, 1,
    'leg (b) [M2]: exactly one driver:wave-blocked line — ' + JSON.stringify(blocked))
  assert.equal(blocked[0].wave, 1,
    'leg (b) [M2]: its `wave` is 1 — ' + JSON.stringify(blocked[0]))
  assert.deepEqual(blocked[0].tasks, ['1'],
    'leg (b) [M2]: its `tasks` name the wave\'s ids — an empty list fails: ' +
    JSON.stringify(blocked[0].tasks))
  assert.equal(blocked[0].detail, report.waveMerges[0].detail,
    'leg (b) [M2]: its `detail` is the same text the wave\'s waveMerges row carries — a ' +
    'drifted detail fails: ' + JSON.stringify({ event: blocked[0].detail,
                                                row: report.waveMerges[0].detail }))
  assert.ok(String(blocked[0].detail).startsWith('candidate suite failed after reconcile attempts: '),
    'leg (b) [M2]: which is the candidate\'s own block, not a summary the event invented — ' +
    JSON.stringify(blocked[0].detail))
  assert.deepEqual(adoptedIn(evs), [],
    'leg (b) [M1] [M3]: nothing was adopted, so the run carries zero driver:wave-adopted ' +
    'lines: ' + JSON.stringify(adoptedIn(evs)))
}

// ── (b) + (c) a red baseline: one blocked line for the parked wave, none for
//     the SKIPPED one, and no adoption anywhere [M2] [M3] ────────────────────
{
  const repo = makeRepo(path.join(tmp, 'repo-c'), { BROKEN: 'red at BASE\n' })
  const runDir = path.join(tmp, 'run-c')
  const stub = (prompt, opts) => {
    throw new Error('leg (b) red baseline: nothing may be dispatched — got ' + opts.label)
  }
  const r = rigWithEvents({
    repo, runDir, stub, stamp: 'we-c', edges: [],
    waves: [[task('1'), task('2')], [task('3')]],
  })
  const report = await r.run()
  const evs = readEvents(runDir)

  assert.strictEqual(report.baseline.passed, false,
    'leg (b) [M2]: check.sh is red on BASE — ' + JSON.stringify(report.baseline))
  assert.equal(report.waveMerges[0].status, 'TEST_FAILED',
    'leg (b) [M2]: wave 1 is TEST_FAILED on the baseline\'s own block — ' +
    JSON.stringify(report.waveMerges))
  assert.equal(report.waveMerges[1].status, 'SKIPPED',
    'leg (c) [M3]: and wave 2 is SKIPPED — ' + JSON.stringify(report.waveMerges))

  const blocked = blockedIn(evs)
  assert.equal(blocked.length, 1,
    'leg (c) [M3]: exactly ONE driver:wave-blocked line — one per waveMerges row with status ' +
    'TEST_FAILED, and the SKIPPED wave emits none: ' + JSON.stringify(blocked))
  assert.equal(blocked[0].wave, 1,
    'leg (b) [M2]: its `wave` is 1 — ' + JSON.stringify(blocked[0]))
  assert.deepEqual(blocked[0].tasks, ['1', '2'],
    'leg (b) [M2]: its `tasks` are the wave\'s ids in plan order — a wave parked before any ' +
    'dispatch still names the tasks it was going to run, so an empty list fails: ' +
    JSON.stringify(blocked[0].tasks))
  assert.equal(blocked[0].detail, report.waveMerges[0].detail,
    'leg (b) [M2]: its `detail` is the row\'s text, byte for byte — ' +
    JSON.stringify({ event: blocked[0].detail, row: report.waveMerges[0].detail }))
  assert.ok(String(blocked[0].detail).startsWith('baseline: the suite is RED on BASE'),
    'leg (b) [M2]: which begins "baseline: the suite is RED on BASE" — ' +
    JSON.stringify(blocked[0].detail))
  assert.deepEqual(adoptedIn(evs), [],
    'leg (b) [M3]: a run parked on a red baseline carries ZERO driver:wave-adopted lines: ' +
    JSON.stringify(adoptedIn(evs)))
}

// ── (d) the contract names both kinds [M4] ───────────────────────────────────
{
  assert.ok(fs.existsSync(CONTRACT), 'leg (d) [M4]: fleet/CONTRACT.md is the record\'s schema')
  const lines = fs.readFileSync(CONTRACT, 'utf8').split('\n')
  for (const kind of ['driver:wave-adopted', 'driver:wave-blocked']) {
    const hits = lines.filter((l) => l.includes(kind))
    assert.ok(hits.length >= 1,
      'leg (d) [M4]: fleet/CONTRACT.md names ' + kind + ' — every kind the engine appends is ' +
      'spelled in the contract, and grep -c finds none')
  }
  const first = lines.find((l) => l.includes('driver:wave-adopted'))
  assert.ok(first.includes('headSha'),
    'leg (d) [M4]: and the line naming driver:wave-adopted also names headSha — the field the ' +
    'kind exists to carry: ' + JSON.stringify(first))
}

fs.rmSync(tmp, { recursive: true, force: true })
console.log('ALL TESTS PASSED')
