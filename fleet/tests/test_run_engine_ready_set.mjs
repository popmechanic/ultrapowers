// fleet/tests/test_run_engine_ready_set.mjs — the exam for "the driver keeps
// its slots full from a ready set and folds whatever has landed when a slot
// frees".
//
// A task starts the moment everything it depends on has been folded in, and
// never waits for the rest of its wave. The wave barrier — dispatch the whole
// layer, wait for all of it, fold once — is replaced by a ready set read at
// dispatch time and an EPOCH: the fold a lane performs when a slot frees,
// captured and unadopted results are waiting, and the fold would release a
// queued task, end the run or adopt a result that has aged out (#1006).
//
// The Machine clauses under test, restated:
//   M1 — a task is READY when it has not been dispatched, is not failed and is
//        not downstream of a failed or blocked task, and every task an edge
//        names as its predecessor has been adopted. The engine dispatches a
//        ready task whenever a slot is free; the number of tasks in flight
//        never exceeds the width `W` the run's arguments carry as `width`; and
//        a task's clone is anchored at the adopted head of the moment it is
//        dispatched.
//   M2 — a lane that frees folds ALL the captured, unadopted mergeable results
//        as one epoch onto the current head, and it folds when the fold would
//        do one of three things (#1006): RELEASE a queued task, END the run, or
//        adopt a result that has aged past `foldAgeMs`. On `MERGED` it appends
//        `driver:wave-adopted {wave: <epoch>, tasks, headSha, why}` — `why`
//        naming which of the three — epochs numbered 1, 2, … in fold order,
//        each epoch's `headSha` a descendant of the previous epoch's; only one
//        fold runs at a time. `foldAgeMs: 0` makes the age clause true at every
//        landing's own instant, which is the rule before #1006 and the reading
//        every scenario below but `c1` is written against; `c1` passes no
//        `foldAgeMs` at all and is the one that reads the new trigger.
//   M3 — a task lands in exactly one epoch; a red epoch marks exactly its own
//        tasks blocked (`driver:wave-blocked` with that epoch's ids) and makes
//        their consumers unready; a task that never became ready is recorded
//        `unfinished` with the reason (`blocked — depends on a failed task`).
//   M4 — a `parked-infra` result is re-dispatched once when a slot frees, on
//        the head of that moment, instead of at a wave barrier; the red-baseline
//        park still happens before any fold and no fold is attempted after it.
//   M5 — `fleet/run-engine.mjs` carries none of the four strings `CONCURRENCY`,
//        `waveLabel`, `waveIds` and `barrier: retrying`.
//   M6 — the three sims this task edits and the five it does not each print
//        `ALL TESTS PASSED` on the patched tree.
//   M7 — `fleet/CONTRACT.md`'s evidence bullet carries, in this order, the
//        words `epoch`, `ready`, `slot frees`, `driver:wave-adopted` and
//        `descendant`.
//
// The Proof legs, and where each is answered:
//   (a) [M1] the ready set and the anchor            — below, two scenarios
//   (b) [M1] the width bound                         — below, two scenarios
//   (c) [M2] one epoch per fold, serialized          — below, one scenario plus
//            the cross-run sweep at the foot of this file
//   (d) [M3] a failed predecessor, and a red epoch   — below, two scenarios
//   (e) [M4] the infra re-dispatch, and the red baseline — below, two scenarios
//   (f) [M5] the four strings                        — its `Run:` line, and
//            repeated here so the exam grades it too
//   (g) [M6] the eight sims                          — its `Run:` lines ALONE.
//            A sim may not name a sibling sim (the hermetic probe forbids it),
//            so those eight names appear nowhere in this file.
//   (h) [M7] the contract bullet                     — its `Run:` line, and
//            repeated here with that line's own semantics
//
// ── how this sim reads what the engine did ──────────────────────────────────
// Everything below the agent seam is real: real git repos, real clones, real
// capture, the real fold kernel through the real exec seam. Only `agent` is
// canned.
//
// THE ORDERED LOG. The rig does not run `run-worker.mjs`, so no `worker:start`
// / `worker:end` reaches `<runDir>/events.jsonl` on its own. The canned worker
// here appends them itself, in production's order — `worker:start` on entry
// (carrying the clone's HEAD, which is what leg (a) and leg (e) read the anchor
// off), `worker:end` immediately before returning — into the same file the
// engine appends its own `driver:` events to. That one file is the total order
// every ordering assertion below reads. Sim-only synchronisation uses marker
// FILES beside it, never a new event kind.
//
// HOLDS ARE BOUNDED. Every "wait until X is on the log" in a stub gives up
// after HOLD_MS and returns. At BASE — where the fold happens only at the wave
// barrier, after every worker of the wave has returned — a hold that waited
// forever would hang the run instead of failing it, and the exam has to be
// runnable at BASE to be red there. So a lapsed hold falls through and the
// assertion that wanted the ordering is the thing that fails.
//
// WIDTH. `extraArgs: { width: n }` is how a scenario sets its slots. `args.width`
// is read by nothing at BASE, so a BASE engine dispatches the whole wave at once
// and every width leg is red there.
//
// EPOCH NUMBERING. Leg (c) reads the `wave` field of the adoptions as "1..k
// consecutive in log order". A run of this exam can also fold a RED epoch,
// which consumes an epoch number and appends `driver:wave-blocked` instead — so
// the sweep asks for the consecutive run over BOTH kinds in log order, which is
// the same assertion on a run whose every epoch merged.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSeam } from '../run-main.mjs'
import { makeRepo, rig, passReview, doneImpl, gitSync } from './_engine_helpers.mjs'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-ready-set-'))
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }))

// How long a stub waits for the log to say what it is waiting for. Long enough
// that a loaded box is not the reason a correct engine goes red; bounded so a
// BASE engine, which will never say it, fails an assertion instead of hanging.
const HOLD_MS = 8000
// The shorter hold, used where the wait is only there to make two lanes
// OVERLAP: a width bound is the thing under test, so the hold must not be the
// thing that serialises them.
const OVERLAP_MS = 2500
const POLL_MS = 20

const sleep = (ms) => new Promise((resolve) => { globalThis.setTimeout(resolve, ms) })

/** Poll `fn` until it is true or `ms` elapses. Never throws, never hangs. */
const waitUntil = async (fn, ms = HOLD_MS) => {
  const deadline = Date.now() + ms
  for (;;) {
    let ok = false
    try { ok = Boolean(fn()) } catch { ok = false }
    if (ok) return true
    if (Date.now() >= deadline) return false
    await sleep(POLL_MS)
  }
}

// ── the record every leg reads ──────────────────────────────────────────────
// An absent file reads as no records, so an engine that writes none fails an
// assertion rather than throwing ENOENT.
const eventsFile = (runDir) => path.join(runDir, 'events.jsonl')
const readEvents = (runDir) => {
  const file = eventsFile(runDir)
  if (!fs.existsSync(file)) return []
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l) } catch { return null } })
    .filter(Boolean)
}
const appendLine = (runDir, e) => {
  fs.appendFileSync(eventsFile(runDir), JSON.stringify(e) + '\n')
}

const isImpl = (e) => typeof e.label === 'string' && e.label.startsWith('impl:')
const isStart = (e, label) => e.kind === 'worker:start' && e.label === label
const isEnd = (e, label) => e.kind === 'worker:end' && e.label === label
const adoptionsOf = (log) => log.filter((e) => e.kind === 'driver:wave-adopted')
const blocksOf = (log) => log.filter((e) => e.kind === 'driver:wave-blocked')
const namingTask = (events, id) =>
  events.find((e) => Array.isArray(e.tasks) && e.tasks.includes(id))
const indexOfEvent = (log, e) => log.indexOf(e)
const firstIndex = (log, pred) => log.findIndex(pred)
const allIndexes = (log, pred) => log.map((e, i) => (pred(e) ? i : -1)).filter((i) => i !== -1)
/** What the log says the worker was handed: the clone HEAD it opened on. */
const headAt = (log, i) => (log[i] && log[i].head) || null
/** A readable dump for a failed ordering assertion. */
const shownLog = (log) => log
  .map((e, i) => i + ' ' + e.kind + ' ' + (e.label || JSON.stringify(e.tasks || []) || ''))
  .join(' | ')

// ── the canned worker's own two lines ───────────────────────────────────────
// EVERY canned dispatch mirrors them, implementers and judgments alike, so the
// log is the order the run really had. Only an implementer's carries `head`:
// legs (a) and (e) read the anchor off it, and a judgment runs in the
// integration clone rather than in the task's.
const openWorker = (runDir, label, extra = {}) =>
  appendLine(runDir, { kind: 'worker:start', label, ...extra })
const workerStart = (runDir, label, cwd) =>
  openWorker(runDir, label, { cwd, head: gitSync(['rev-parse', 'HEAD'], cwd) })
const workerEnd = (runDir, label, extra = {}) =>
  appendLine(runDir, { kind: 'worker:end', label, ...extra })
/** The canned referee, enveloped. A judgment's `worker:end` is the last thing
 *  that happens to a task before its result is recorded, which is what leg (c)
 *  holds its fold against. */
const cannedReview = (runDir, label) => {
  openWorker(runDir, label)
  const reply = passReview()
  workerEnd(runDir, label)
  return reply
}
/** The canned reconcile agent: it refuses, so a red candidate stays red. */
const cannedReconcile = (runDir, label) => {
  openWorker(runDir, label)
  const reply = { status: 'BLOCKED', summary: 'sim: no reconcile' }
  workerEnd(runDir, label)
  return reply
}
// The task shape every scenario uses: one file of its own, no proof paths, so
// the only workers dispatched are `impl:` and `review:`.
const taskOf = (id, over = {}) => ({
  id, title: 'task ' + id, files: [id + '.txt'], tier: 'standard', review: 'lean',
  writes: [id + '.txt'], commutes: [],
  testCmd: 'bash check.sh', proofTests: [], proofRuns: [],
  body: 'sim task ' + id,
  ...over,
})

// ── the exec seam, recording the kernel ─────────────────────────────────────
// The fold is `exec('python3', [KERNEL, <verb>, …])`. This wrapper records each
// such call's begin and end in order, so leg (c) can ask whether two folds ever
// overlapped, and leg (e) can ask whether any fold ran at all.
const KERNEL_VERBS = new Set(['fold', 'resolve', 'materialize', 'emit-weave'])
function kernelSeam() {
  const calls = []
  let step = 0
  let live = 0
  let maxLive = 0
  const exec = async (cmd, argv, opts) => {
    const verb = (cmd === 'python3' && Array.isArray(argv) && KERNEL_VERBS.has(String(argv[1])))
      ? String(argv[1]) : null
    if (!verb) return execSeam(cmd, argv, opts)
    calls.push({ verb, at: 'begin', step: step++ })
    live += 1
    if (live > maxLive) maxLive = live
    try {
      return await execSeam(cmd, argv, opts)
    } finally {
      live -= 1
      calls.push({ verb, at: 'end', step: step++ })
    }
  }
  return { exec, calls, maxLive: () => maxLive }
}

// ── one scenario ────────────────────────────────────────────────────────────
// Every run this exam drives lands in RUNS, which the leg (c) sweep at the foot
// of the file reads.
const RUNS = []
let seq = 0
async function drive({ tag, tasks, edges = [], width, makeStub, repoFiles = {},
                       foldAgeMs = null }) {
  seq += 1
  const stamp = 'rs' + seq + tag
  const repo = makeRepo(path.join(tmp, 'repo-' + stamp), repoFiles)
  const runDir = path.join(tmp, 'run-' + stamp)
  const seam = kernelSeam()
  const labels = []
  const stub = makeStub(runDir)
  const built = rig({
    repo, runDir, waves: [tasks], edges, stamp, exec: seam.exec,
    stub: (prompt, opts, cwd) => { labels.push(opts.label); return stub(prompt, opts, cwd) },
    // `foldAgeMs` is left OUT when a scenario passes none, so that scenario runs
    // on the engine's own default threshold; every scenario that passes `0`
    // wants the fold-at-every-landing rule its assertions were written against.
    extraArgs: { width, infraBackoffMs: 0,
                 ...(foldAgeMs === null ? {} : { foldAgeMs }) },
  })
  const report = await built.run()
  const rec = { tag, stamp, runDir, integ: built.integ, base: built.base,
                report, labels, seam, log: readEvents(runDir) }
  RUNS.push(rec)
  return rec
}

/** The implementer every plain scenario cans: open, (hold), write, close. */
const plainImpl = (runDir, opts, cwd, id) => {
  fs.writeFileSync(path.join(cwd, id + '.txt'), 'from ' + id + '\n')
  const reply = doneImpl(cwd)
  workerEnd(runDir, opts.label)
  return reply
}

/** `git merge-base --is-ancestor a b`, as a boolean, in the integration clone. */
const isAncestor = (integ, a, b) => {
  try { gitSync(['merge-base', '--is-ancestor', a, b], integ); return true } catch { return false }
}

// ════════════════════════════════════════════════════════════════════════════
// leg (a) — the ready set, and the anchor of the moment [M1]
//
// A, B and C in ONE plan wave with the one edge A -> C, width 2. A and B are
// the ready pair; C is not ready until A has been ADOPTED, not merely finished.
// `impl:A` is held until B's adoption is on the log, which is what makes the
// question askable at all: B's whole epoch — fold, candidate, suite, adopt —
// has to happen while a task of the same plan wave is still in flight.
// ════════════════════════════════════════════════════════════════════════════
{
  const run = await drive({
    tag: 'a1', tasks: [taskOf('A'), taskOf('B'), taskOf('C')],
    edges: [['A', 'C']], width: 2,
    // This scenario's subject is not the fold trigger, so it takes `foldAgeMs: 0`
    // — every landing folds at its own instant, which is what it was written
    // against and what #1006 keeps as the `0` reading.
    foldAgeMs: 0,
    makeStub: (runDir) => async (prompt, opts, cwd) => {
      const [kind, id] = opts.label.split(':')
      if (kind === 'review') return cannedReview(runDir, opts.label)
      if (kind !== 'impl') throw new Error('unexpected dispatch: ' + opts.label)
      workerStart(runDir, opts.label, cwd)
      if (id === 'A') {
        // Held until B has been adopted — a fold that happens while this
        // worker is open is exactly what M2 asks for.
        await waitUntil(() => namingTask(adoptionsOf(readEvents(runDir)), 'B') !== undefined)
      } else if (id === 'B') {
        // Held only until A is open, so "both started before either ended" is
        // a fact about the scheduler and not about which stub won a race.
        await waitUntil(() => readEvents(runDir).some((e) => isStart(e, 'impl:A')), OVERLAP_MS)
      }
      return plainImpl(runDir, opts, cwd, id)
    },
  })
  const log = run.log
  const startA = firstIndex(log, (e) => isStart(e, 'impl:A'))
  const startB = firstIndex(log, (e) => isStart(e, 'impl:B'))
  const startC = firstIndex(log, (e) => isStart(e, 'impl:C'))
  const firstEnd = firstIndex(log, (e) => e.kind === 'worker:end' && isImpl(e))
  assert.ok(startA !== -1 && startB !== -1,
    '(a)/M1: sim precondition — A and B are the ready pair and both are dispatched: ' +
    shownLog(log))

  // [M1] A and B are in flight together: both ready, and two slots.
  assert.ok(firstEnd !== -1 && startA < firstEnd && startB < firstEnd,
    '(a)/M1: `worker:start impl:A` and `worker:start impl:B` both precede any `worker:end` — ' +
    'the two ready tasks hold the two slots at once: ' + shownLog(log))

  // [M2] B's landing folded an epoch of its own while A was still open.
  const adoptB = namingTask(adoptionsOf(log), 'B') || { tasks: [] }
  assert.ok(adoptB.headSha !== undefined,
    '(a)/M2: B\'s landing must fold an epoch of its own — no `driver:wave-adopted` names B: ' +
    shownLog(log))
  assert.deepEqual(adoptB.tasks, ['B'],
    '(a)/M2: the epoch B\'s landing folded carries exactly the results captured and unadopted ' +
    'at that moment, which is B alone (A is still in flight, C has not started): ' +
    JSON.stringify(adoptB))
  const endA = firstIndex(log, (e) => isEnd(e, 'impl:A'))
  assert.ok(endA !== -1 && indexOfEvent(log, adoptB) < endA,
    '(a)/M2: the `driver:wave-adopted` listing B precedes `worker:end impl:A` — a slot that ' +
    'freed folded what had landed instead of waiting for the rest of the wave: ' + shownLog(log))

  // [M1] C waits for A's ADOPTION, and is anchored on it.
  const adoptA = namingTask(adoptionsOf(log), 'A') || { tasks: [] }
  assert.ok(adoptA.headSha !== undefined,
    '(a)/M1: A\'s landing must fold its own epoch — no `driver:wave-adopted` names A: ' +
    shownLog(log))
  assert.deepEqual(adoptA.tasks, ['A'],
    '(a)/M2: A landed alone, so its epoch carries A alone: ' + JSON.stringify(adoptA))
  assert.ok(startC !== -1,
    '(a)/M1: C becomes ready once A is adopted and must be dispatched: ' + shownLog(log))
  assert.ok(startC > indexOfEvent(log, adoptA),
    '(a)/M1: `worker:start impl:C` follows the `driver:wave-adopted` listing A — an edge is ' +
    'satisfied by ADOPTION, not by the predecessor merely returning: ' + shownLog(log))
  assert.equal(headAt(log, startC), adoptA.headSha,
    '(a)/M1: C\'s clone HEAD at its start is the adopted head of that moment (' +
    String(adoptA.headSha) + '), not the run base ' + run.base + ': ' +
    JSON.stringify(log[startC]))
  assert.deepEqual(run.report.tasks.map((r) => [r.task, r.status]).sort(),
    [['A', 'done'], ['B', 'done'], ['C', 'done']],
    '(a)/M1: sim precondition — all three tasks finish: ' +
    JSON.stringify(run.report.tasks.map((r) => ({ task: r.task, status: r.status }))))
}

// Same three tasks, width 3, NO edges: a plan wave without an edge is no order,
// so C is ready from the start and must not wait for anyone's adoption. A and B
// are held until all three are open, so that the claim is about C's dispatch
// and not about which stub returned first.
{
  const run = await drive({
    tag: 'a2', tasks: [taskOf('A'), taskOf('B'), taskOf('C')], edges: [], width: 3,
    // This scenario's subject is not the fold trigger, so it takes `foldAgeMs: 0`
    // — every landing folds at its own instant, which is what it was written
    // against and what #1006 keeps as the `0` reading.
    foldAgeMs: 0,
    makeStub: (runDir) => async (prompt, opts, cwd) => {
      const [kind, id] = opts.label.split(':')
      if (kind === 'review') return cannedReview(runDir, opts.label)
      if (kind !== 'impl') throw new Error('unexpected dispatch: ' + opts.label)
      workerStart(runDir, opts.label, cwd)
      if (id !== 'C') {
        await waitUntil(() => {
          const open = new Set(readEvents(runDir)
            .filter((e) => e.kind === 'worker:start' && isImpl(e)).map((e) => e.label))
          return open.size >= 3
        }, OVERLAP_MS)
      }
      return plainImpl(runDir, opts, cwd, id)
    },
  })
  const log = run.log
  const startC = firstIndex(log, (e) => isStart(e, 'impl:C'))
  const firstAdopt = firstIndex(log, (e) => e.kind === 'driver:wave-adopted')
  assert.ok(startC !== -1, '(a)/M1: sim precondition — C is dispatched: ' + shownLog(log))
  assert.ok(firstAdopt === -1 || startC < firstAdopt,
    '(a)/M1: with no edge naming a predecessor, C is ready at once and starts before either ' +
    'adoption — readiness is computed from the edges, never from the plan wave\'s shape: ' +
    shownLog(log))
}

// ════════════════════════════════════════════════════════════════════════════
// leg (b) — the width bound [M1]
//
// Two independent tasks, and nothing but `width` to tell them apart. Each stub
// holds until TWO distinct implementers are open, or the overlap hold lapses:
// at width 2 that makes the overlap certain, and at width 1 it can never be
// satisfied, so the first stub falls through and the run is serial on the
// engine's own bound rather than on a race.
// ════════════════════════════════════════════════════════════════════════════
const twoOpenStub = (runDir) => async (prompt, opts, cwd) => {
  const [kind, id] = opts.label.split(':')
  if (kind === 'review') return cannedReview(runDir, opts.label)
  if (kind !== 'impl') throw new Error('unexpected dispatch: ' + opts.label)
  workerStart(runDir, opts.label, cwd)
  await waitUntil(() => {
    const seen = new Set(readEvents(runDir)
      .filter((e) => e.kind === 'worker:start' && isImpl(e)).map((e) => e.label))
    return seen.size >= 2
  }, OVERLAP_MS)
  return plainImpl(runDir, opts, cwd, id)
}

/** The most implementers the log ever had open at once. */
const maxOpenImpl = (log) => {
  let open = 0
  let max = 0
  for (const e of log) {
    if (!isImpl(e)) continue
    if (e.kind === 'worker:start') { open += 1; if (open > max) max = open }
    if (e.kind === 'worker:end') open -= 1
  }
  return max
}

{
  const run = await drive({
    tag: 'b1', tasks: [taskOf('P'), taskOf('Q')], edges: [], width: 1,
    // This scenario's subject is not the fold trigger, so it takes `foldAgeMs: 0`
    // — every landing folds at its own instant, which is what it was written
    // against and what #1006 keeps as the `0` reading.
    foldAgeMs: 0,
    makeStub: twoOpenStub,
  })
  const log = run.log
  const starts = allIndexes(log, (e) => e.kind === 'worker:start' && isImpl(e))
  const ends = allIndexes(log, (e) => e.kind === 'worker:end' && isImpl(e))
  assert.equal(starts.length, 2,
    '(b)/M1: sim precondition — both tasks are dispatched: ' + shownLog(log))
  assert.equal(maxOpenImpl(log), 1,
    '(b)/M1: with width 1 no two `impl:` workers are ever open at the same instant — ' +
    'the number in flight never exceeds the width the run\'s arguments carry: ' + shownLog(log))
  assert.ok(starts[1] > ends[0],
    '(b)/M1: with width 1 the second `worker:start` follows the first `worker:end`: ' +
    shownLog(log))
}

{
  const run = await drive({
    tag: 'b2', tasks: [taskOf('P'), taskOf('Q')], edges: [], width: 2,
    // This scenario's subject is not the fold trigger, so it takes `foldAgeMs: 0`
    // — every landing folds at its own instant, which is what it was written
    // against and what #1006 keeps as the `0` reading.
    foldAgeMs: 0,
    makeStub: twoOpenStub,
  })
  const log = run.log
  const starts = allIndexes(log, (e) => e.kind === 'worker:start' && isImpl(e))
  const firstEnd = firstIndex(log, (e) => e.kind === 'worker:end' && isImpl(e))
  assert.equal(starts.length, 2,
    '(b)/M1: sim precondition — both tasks are dispatched: ' + shownLog(log))
  assert.ok(firstEnd !== -1 && starts[0] < firstEnd && starts[1] < firstEnd,
    '(b)/M1: with width 2 both implementers start before either ends — two free slots are ' +
    'two tasks in flight: ' + shownLog(log))
  assert.equal(maxOpenImpl(log), 2,
    '(b)/M1: and the run really held two at once: ' + shownLog(log))
}

// ════════════════════════════════════════════════════════════════════════════
// leg (c) — one epoch per fold, and the fold nobody is waiting for [M2]
//
// X, Y and Z, no edges, width 3, stubs ending in that order — and no
// `foldAgeMs`, so this is the one scenario of this file that runs on the
// engine's own default threshold. Nothing an edge names waits on X, so X's
// landing releases nobody; the run is not over while Y and Z are in flight; and
// a minute is longer than this run takes. So the first two landings fold
// NOTHING, and the last one — with no worker left in flight and nothing ready —
// folds all three as one epoch, `why: 'end'`. That is the whole economy of
// #1006: three tasks, one fold, one candidate suite instead of three.
// ════════════════════════════════════════════════════════════════════════════
{
  const run = await drive({
    tag: 'c1', tasks: [taskOf('X'), taskOf('Y'), taskOf('Z')], edges: [], width: 3,
    makeStub: (runDir) => async (prompt, opts, cwd) => {
      const [kind, id] = opts.label.split(':')
      if (kind === 'review') return cannedReview(runDir, opts.label)
      if (kind !== 'impl') throw new Error('unexpected dispatch: ' + opts.label)
      workerStart(runDir, opts.label, cwd)
      if (id === 'Y') {
        await waitUntil(() => readEvents(runDir).some((e) => isEnd(e, 'impl:X')))
      } else if (id === 'Z') {
        await waitUntil(() => readEvents(runDir).some((e) => isEnd(e, 'impl:Y')))
      }
      return plainImpl(runDir, opts, cwd, id)
    },
  })
  const log = run.log
  const adoptions = adoptionsOf(log)
  assert.equal(adoptions.length, 1,
    '(c)/M2: no landing of a run with no edges releases anything, so the only fold is the one ' +
    'that ends the run — exactly one epoch, not three: ' +
    JSON.stringify(adoptions.map((e) => ({ wave: e.wave, tasks: e.tasks, why: e.why }))) + ' | ' +
    shownLog(log))
  // Indexed through a default, so a run that folded fewer epochs than the
  // count above demands still reads as the assertion it failed rather than as
  // a TypeError in the sim.
  const epoch = (i) => adoptions[i] || { tasks: [] }
  assert.deepEqual([...epoch(0).tasks].sort(), ['X', 'Y', 'Z'],
    '(c)/M2: that one epoch folds all three TOGETHER — a lane folds everything captured and ' +
    'unadopted, not one result per fold: ' + JSON.stringify(adoptions[0] || null))
  assert.equal(epoch(0).why, 'end',
    '(c)/M2: and it names its trigger — nothing was in flight, nothing was folding and nothing ' +
    'was ready when it was claimed: ' + JSON.stringify(adoptions[0] || null))
  const folds = run.seam.calls.filter((c) => c.verb === 'fold' && c.at === 'begin')
  assert.equal(folds.length, 1,
    '(c)/M2: one epoch is one kernel fold — the run paid for a single candidate suite: ' +
    JSON.stringify(run.seam.calls))
}

// ════════════════════════════════════════════════════════════════════════════
// leg (d) — a failed predecessor, and a red epoch [M3]
//
// (d) first half: A answers BLOCKED, the edge A -> C stands. C is downstream of
// a failed task, so it is never ready, never dispatched, and recorded with the
// reason; B, which depends on nothing, is still approved.
// ════════════════════════════════════════════════════════════════════════════
{
  const run = await drive({
    tag: 'd1', tasks: [taskOf('A'), taskOf('B'), taskOf('C')],
    edges: [['A', 'C']], width: 2,
    // This scenario's subject is not the fold trigger, so it takes `foldAgeMs: 0`
    // — every landing folds at its own instant, which is what it was written
    // against and what #1006 keeps as the `0` reading.
    foldAgeMs: 0,
    makeStub: (runDir) => async (prompt, opts, cwd) => {
      const [kind, id] = opts.label.split(':')
      if (kind === 'review') return cannedReview(runDir, opts.label)
      if (kind !== 'impl') throw new Error('unexpected dispatch: ' + opts.label)
      workerStart(runDir, opts.label, cwd)
      if (id === 'A') {
        workerEnd(runDir, opts.label)
        return { status: 'BLOCKED', summary: 'sim: A cannot proceed' }
      }
      return plainImpl(runDir, opts, cwd, id)
    },
  })
  const log = run.log
  const rowOf = (id) => run.report.tasks.find((r) => r.task === id) || null
  assert.equal((rowOf('A') || {}).status, 'failed',
    '(d)/M3: sim precondition — a BLOCKED implementer fails its task: ' + JSON.stringify(rowOf('A')))
  assert.equal(firstIndex(log, (e) => isStart(e, 'impl:C')), -1,
    '(d)/M3: C is downstream of a failed task, so it never becomes ready and no worker of ' +
    'any kind is dispatched for it: ' + shownLog(log))
  assert.ok(run.report.unfinished.includes('C: blocked — depends on a failed task'),
    '(d)/M3: a task that never became ready is recorded `unfinished` with that reason: ' +
    JSON.stringify(run.report.unfinished))
  assert.equal((rowOf('B') || {}).status, 'done',
    '(d)/M3: B depends on nothing and is still approved: ' + JSON.stringify(rowOf('B')))
  assert.equal((rowOf('B') || {}).reviewVerdict, 'clean',
    '(d)/M3: B\'s review is clean: ' + JSON.stringify(rowOf('B')))
  const adoptB = namingTask(adoptionsOf(log), 'B') || { tasks: [] }
  assert.ok(adoptB.headSha !== undefined && adoptB.tasks.indexOf('A') === -1 &&
            adoptB.tasks.indexOf('C') === -1,
    '(d)/M3: B lands in an epoch of its own — neither the failed task nor the blocked one is ' +
    'in it: ' + JSON.stringify(adoptB) + ' | ' + shownLog(log))
}

// (d) second half: a suite that turns red the moment B's file exists. B's epoch
// cannot be made green, so it is blocked — and the block names B's epoch's ids
// and ONLY those. A, which lands later and is independent, still folds an epoch
// of its own onto the head B's epoch left untouched.
{
  const run = await drive({
    tag: 'd2', tasks: [taskOf('A'), taskOf('B')], edges: [], width: 2,
    // This scenario's subject is not the fold trigger, so it takes `foldAgeMs: 0`
    // — every landing folds at its own instant, which is what it was written
    // against and what #1006 keeps as the `0` reading.
    foldAgeMs: 0,
    // Exits non-zero and prints NOTHING once B.txt exists: an output naming no
    // path is not the unattributed-red route, so the candidate takes the
    // reconcile route and the reconcile agent's refusal makes the epoch red.
    repoFiles: { 'check.sh': '#!/bin/bash\n[ ! -f B.txt ]\n' },
    makeStub: (runDir) => async (prompt, opts, cwd) => {
      const [kind, id] = opts.label.split(':')
      if (kind === 'review') return cannedReview(runDir, opts.label)
      if (kind === 'reconcile') return cannedReconcile(runDir, opts.label)
      if (kind !== 'impl') throw new Error('unexpected dispatch: ' + opts.label)
      workerStart(runDir, opts.label, cwd)
      if (id === 'A') {
        // Held until B's epoch has been declared red, so the two epochs are
        // ordered and the leg's question — does A still fold? — is askable.
        await waitUntil(() => blocksOf(readEvents(runDir)).length > 0)
      }
      return plainImpl(runDir, opts, cwd, id)
    },
  })
  const log = run.log
  const blocked = blocksOf(log)
  assert.equal(blocked.length, 1,
    '(d)/M3: exactly one epoch goes red — B\'s: ' +
    JSON.stringify(blocked.map((e) => ({ wave: e.wave, tasks: e.tasks }))) + ' | ' + shownLog(log))
  const redEpoch = blocked[0] || { tasks: [] }
  assert.deepEqual(redEpoch.tasks, ['B'],
    '(d)/M3: a red epoch marks EXACTLY its own tasks blocked — A was not in it and must not ' +
    'be named by it: ' + JSON.stringify(blocked[0] || null))
  const adoptA = namingTask(adoptionsOf(log), 'A') || { tasks: [] }
  assert.ok(adoptionsOf(log).some((e) => Array.isArray(e.tasks) && e.tasks.includes('A')),
    '(d)/M3: A is independent and lands later — its own epoch still folds onto the head the ' +
    'red epoch left where it found it: ' + shownLog(log))
  assert.deepEqual(adoptA.tasks, ['A'],
    '(d)/M3: and carries A alone: ' + JSON.stringify(adoptA))
  assert.ok(indexOfEvent(log, redEpoch) !== -1 && indexOfEvent(log, redEpoch) < indexOfEvent(log, adoptA),
    '(d)/M3: B\'s epoch is red BEFORE A\'s epoch folds — one fold at a time, in order: ' +
    shownLog(log))
  assert.notEqual(redEpoch.wave, adoptA.wave,
    '(d)/M3: a task lands in exactly one epoch, and the red epoch is not A\'s: ' +
    JSON.stringify([redEpoch.wave, adoptA.wave]))
}

// ════════════════════════════════════════════════════════════════════════════
// leg (e) — the infra re-dispatch, and the red baseline [M4]
//
// A's implementer dies once, in production's order: the `worker:end` envelope
// carrying the infra class and the status, and THEN the `null` the engine reads
// as a death. B is held until that death is on record, so the re-dispatch's
// question is unambiguous: does A go out again when a slot frees — after some
// other lane's landing — or only after the whole wave has been collected?
// ════════════════════════════════════════════════════════════════════════════
{
  const run = await drive({
    tag: 'e1', tasks: [taskOf('A'), taskOf('B')], edges: [], width: 2,
    // This scenario's subject is not the fold trigger, so it takes `foldAgeMs: 0`
    // — every landing folds at its own instant, which is what it was written
    // against and what #1006 keeps as the `0` reading.
    foldAgeMs: 0,
    makeStub: (runDir) => {
      const dead = path.join(runDir, 'A-died')
      let attempts = 0
      return async (prompt, opts, cwd) => {
        const [kind, id] = opts.label.split(':')
        if (kind === 'review') return cannedReview(runDir, opts.label)
        if (kind !== 'impl') throw new Error('unexpected dispatch: ' + opts.label)
        workerStart(runDir, opts.label, cwd)
        if (id === 'A') {
          attempts += 1
          if (attempts === 1) {
            workerEnd(runDir, opts.label, { class: 'infra', status: 529 })
            fs.writeFileSync(dead, 'A died once\n')
            return null
          }
        } else if (id === 'B') {
          await waitUntil(() => fs.existsSync(dead))
        }
        return plainImpl(runDir, opts, cwd, id)
      }
    },
  })
  const log = run.log
  const startsA = allIndexes(log, (e) => isStart(e, 'impl:A'))
  assert.equal(startsA.length, 2,
    '(e)/M4: a parked-infra result is re-dispatched exactly once — two `worker:start impl:A` ' +
    'lines, no more and no fewer: ' + shownLog(log))
  const adoptB = namingTask(adoptionsOf(log), 'B') || { tasks: [] }
  assert.ok(adoptB.headSha !== undefined,
    '(e)/M4: sim precondition — B lands and folds its own epoch: ' + shownLog(log))
  assert.deepEqual(adoptB.tasks, ['B'],
    '(e)/M4: A was parked and captured nothing, so B\'s epoch carries B alone: ' +
    JSON.stringify(adoptB))
  assert.ok(startsA[1] > indexOfEvent(log, adoptB),
    '(e)/M4: A\'s second dispatch follows the OTHER lane\'s landing — a slot freeing, not a ' +
    'wave barrier, is what buys the retry: ' + shownLog(log))
  assert.equal(headAt(log, startsA[1]), adoptB.headSha,
    '(e)/M4: and it is re-dispatched on the head of that moment (' + String(adoptB.headSha) +
    '), not on the head its first attempt had: ' + JSON.stringify(log[startsA[1]]))
  const rowA = run.report.tasks.find((r) => r.task === 'A') || null
  assert.equal((rowA || {}).status, 'done',
    '(e)/M4: the re-dispatch recovers the task: ' + JSON.stringify(rowA) + ' | ' +
    run.report.judgmentCalls.join(' | '))
}

// The red baseline, unchanged: a repository already failing when the run opened
// parks before any fold, and no fold is attempted after it.
{
  const run = await drive({
    tag: 'e2', tasks: [taskOf('A'), taskOf('B')], edges: [], width: 2,
    // This scenario's subject is not the fold trigger, so it takes `foldAgeMs: 0`
    // — every landing folds at its own instant, which is what it was written
    // against and what #1006 keeps as the `0` reading.
    foldAgeMs: 0,
    // `check.sh` is `[ ! -f BROKEN ]`, and BROKEN is committed at BASE.
    repoFiles: { BROKEN: 'the suite was red before this run opened\n' },
    makeStub: (runDir) => async (prompt, opts, cwd) => {
      const [kind, id] = opts.label.split(':')
      if (kind === 'review') return cannedReview(runDir, opts.label)
      if (kind === 'reconcile') return cannedReconcile(runDir, opts.label)
      if (kind !== 'impl') throw new Error('unexpected dispatch: ' + opts.label)
      workerStart(runDir, opts.label, cwd)
      return plainImpl(runDir, opts, cwd, id)
    },
  })
  const folds = run.seam.calls.filter((c) => c.verb === 'fold' && c.at === 'begin')
  assert.equal(folds.length, 0,
    '(e)/M4: the red-baseline park happens before any fold and no fold is attempted after it — ' +
    'the exec seam recorded ' + folds.length + ' kernel `fold` call(s): ' +
    JSON.stringify(run.seam.calls))
  assert.equal(adoptionsOf(run.log).length, 0,
    '(e)/M4: and nothing is adopted: ' + shownLog(run.log))
  const parked = run.report.waveMerges.filter((m) => m.status === 'TEST_FAILED')
  assert.equal(parked.length, 1,
    '(e)/M4: the park is recorded exactly once: ' + JSON.stringify(run.report.waveMerges))
  assert.match(String(parked[0].detail), /inherited that red/,
    '(e)/M4: and reads as the baseline\'s red, not as a fold\'s: ' + JSON.stringify(parked[0]))
  assert.ok(blocksOf(run.log).length >= 1,
    '(e)/M4: the park appends its `driver:wave-blocked` as at BASE: ' + shownLog(run.log))
}

// ════════════════════════════════════════════════════════════════════════════
// leg (c), the sweep — across EVERY run this exam drove [M2]
//
// Four questions of every run: a task lands in exactly one epoch; the epochs
// are numbered 1..k consecutively in log order (counting a red epoch, which
// consumes a number and appends `driver:wave-blocked` in place of an adoption);
// each adopted head is a descendant of the one before it; and the kernel's
// folds were strictly serial.
// ════════════════════════════════════════════════════════════════════════════
{
  assert.ok(RUNS.length >= 8,
    'sim precondition: every scenario above registered its run — ' + RUNS.length + ' registered')
  for (const run of RUNS) {
    const where = ' [run ' + run.tag + ']'
    const adoptions = adoptionsOf(run.log)

    // Exactly one epoch per adopted task.
    const seen = new Map()
    for (const e of adoptions) {
      for (const id of (Array.isArray(e.tasks) ? e.tasks : [])) {
        seen.set(id, (seen.get(id) || 0) + 1)
      }
    }
    const twice = [...seen.entries()].filter(([, n]) => n > 1).map(([id]) => id)
    assert.deepEqual(twice, [],
      '(c)/M2: a task lands in exactly one epoch — these were adopted more than once' + where +
      ': ' + JSON.stringify(adoptions.map((e) => ({ wave: e.wave, tasks: e.tasks }))))

    // 1..k consecutive in log order, over every epoch the run folded.
    const epochs = run.log
      .filter((e) => e.kind === 'driver:wave-adopted' || e.kind === 'driver:wave-blocked')
      .map((e) => e.wave)
    assert.deepEqual(epochs, epochs.map((_, i) => i + 1),
      '(c)/M2: epochs are numbered 1, 2, … in fold order' + where + ': ' + JSON.stringify(epochs))

    // Each adopted head a descendant of the previous one.
    for (let i = 1; i < adoptions.length; i++) {
      const prev = adoptions[i - 1].headSha
      const cur = adoptions[i].headSha
      assert.match(String(cur), /^[0-9a-f]{40}$/,
        '(c)/M2: every adoption names a head' + where + ': ' + JSON.stringify(adoptions[i]))
      assert.ok(isAncestor(run.integ, prev, cur),
        '(c)/M2: epoch ' + adoptions[i].wave + '\'s head ' + cur + ' is a descendant of epoch ' +
        adoptions[i - 1].wave + '\'s ' + prev + ' — each epoch folds onto the head the last one ' +
        'left' + where)
    }

    // One fold at a time.
    assert.ok(run.seam.maxLive() <= 1,
      '(c)/M2: only one fold runs at a time — the exec seam saw ' + run.seam.maxLive() +
      ' kernel calls in flight at once' + where)
    let open = null
    for (const c of run.seam.calls) {
      if (c.verb === 'fold' && c.at === 'begin') {
        assert.equal(open, null,
          '(c)/M2: no `fold` starts before the previous fold\'s `materialize` returns' + where +
          ': ' + JSON.stringify(run.seam.calls))
        open = c.step
      }
      if (c.verb === 'materialize' && c.at === 'end') open = null
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// leg (f) — the four strings the engine no longer carries [M5]
//
// The same count its `Run:` line takes: lines of `fleet/run-engine.mjs` that
// carry any of the four, comments included.
// ════════════════════════════════════════════════════════════════════════════
{
  const src = fs.readFileSync(fileURLToPath(new URL('../run-engine.mjs', import.meta.url)), 'utf8')
  const needles = ['CONCURRENCY', 'waveLabel', 'waveIds', 'barrier: retrying']
  const hits = src.split('\n')
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => needles.some((s) => line.includes(s)))
  assert.equal(hits.length, 0,
    '(f)/M5: fleet/run-engine.mjs carries none of ' + JSON.stringify(needles) +
    ' — the wave barrier\'s own vocabulary, comments included. Still there: ' +
    JSON.stringify(hits.map(({ line, n }) => n + ': ' + line.trim().slice(0, 100))))
}

// ════════════════════════════════════════════════════════════════════════════
// leg (h) — the contract's evidence bullet [M7]
//
// The same region its `Run:` line takes: from the line naming the engine's own
// wave record through the first line naming `driver:exam-run`, joined into one
// line, carrying the five words in that order.
// ════════════════════════════════════════════════════════════════════════════
{
  const contract = fs.readFileSync(fileURLToPath(new URL('../CONTRACT.md', import.meta.url)), 'utf8')
  const lines = contract.split('\n')
  const from = lines.findIndex((l) => /The engine.s own wave record/.test(l))
  assert.ok(from !== -1,
    '(h)/M7: sim precondition — fleet/CONTRACT.md still has the evidence bullet that opens ' +
    '"The engine\'s own wave record"')
  let to = lines.slice(from + 1).findIndex((l) => l.includes('driver:exam-run'))
  to = to === -1 ? lines.length - 1 : from + 1 + to
  const bullet = lines.slice(from, to + 1).join(' ')
  assert.match(bullet, /epoch.*ready.*slot frees.*driver:wave-adopted.*descendant/,
    '(h)/M7: the evidence bullet must carry, in this order, `epoch`, `ready`, `slot frees`, ' +
    '`driver:wave-adopted` and `descendant` — what the record now says about how work is ' +
    'scheduled and folded:\n' + JSON.stringify(bullet))
}

// ════════════════════════════════════════════════════════════════════════════
// TASK 2 — "A fold conflict leaves a receipt" — leg (b) [M1]
//
// M1's negative clause, restated: a `driver:wave-blocked` event whose fold
// ended `TEST_FAILED` carries NEITHER key — no `paths`, no `evidence`. A
// receipt names the files a fold stopped on; a fold that reached a candidate
// and found the suite red stopped on no file, so it names none.
//
// Leg (b) reads that off this rig's PARKED run — the red-baseline scenario
// whose `report.waveMerges` carry `TEST_FAILED` and whose park appends its
// `driver:wave-blocked` before any fold. No new run is driven: every scenario
// above registered itself in `RUNS`, so the rows are already on the log this
// file read.
//
// This is the one leg of this task's exam that is GREEN at BASE, and by
// construction: at BASE no blocked row carries a receipt at all. It stays green
// under a correct implementation and goes red under one that hangs a receipt on
// every blocked row rather than on the `CONFLICT` ones alone.
//
// The rows are read back off `<runDir>/events.jsonl`, so `hasOwnProperty` on
// the parsed object is the question being asked: a key JSON never wrote is a
// key the record does not carry.
// ════════════════════════════════════════════════════════════════════════════
{
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k)

  const parkedRuns = RUNS.filter((r) => r.report &&
    Array.isArray(r.report.waveMerges) &&
    r.report.waveMerges.some((m) => m && m.status === 'TEST_FAILED'))
  assert.ok(parkedRuns.length >= 1,
    '(b)/M1: sim precondition — this rig drove a parked run whose `waveMerges` carry ' +
    '`TEST_FAILED`. Registered runs and their merge statuses: ' + JSON.stringify(RUNS.map(
      (r) => ({ tag: r.tag, statuses: (r.report.waveMerges || []).map((m) => m && m.status) }))))

  for (const parkedRun of parkedRuns) {
    const parkedBlocks = blocksOf(parkedRun.log)
    assert.ok(parkedBlocks.length >= 1,
      '(b)/M1: sim precondition — the parked run [' + parkedRun.tag + '] appended its ' +
      '`driver:wave-blocked`: ' + shownLog(parkedRun.log))

    for (const row of parkedBlocks) {
      assert.equal(has(row, 'paths'), false,
        '(b)/M1: the parked run [' + parkedRun.tag + ']\'s `TEST_FAILED` `driver:wave-blocked` ' +
        'row has NO `paths` key — a fold that ended on a red suite stopped on no file, and a ' +
        'receipt names files: ' + JSON.stringify(row))
      assert.equal(has(row, 'evidence'), false,
        '(b)/M1: and no `evidence` key either — the two keys are a receipt together, and a ' +
        '`TEST_FAILED` epoch carries neither: ' + JSON.stringify(row))
    }
  }

  // The same question of every OTHER run of this rig that folded no `CONFLICT`
  // epoch — which, at BASE, is all of them. A run that does fold one is out of
  // this leg's scope: M1 gives a `CONFLICT` epoch a receipt, and leg (a) of the
  // stale-patch rig is where that half is graded.
  for (const r of RUNS) {
    const conflicted = (r.report.waveMerges || []).some((m) => m && m.status === 'CONFLICT')
    if (conflicted) continue
    for (const row of blocksOf(r.log)) {
      assert.equal(has(row, 'paths') || has(row, 'evidence'), false,
        '(b)/M1: run [' + r.tag + '] folded no `CONFLICT` epoch, so none of its ' +
        '`driver:wave-blocked` rows may carry `paths` or `evidence`: ' + JSON.stringify(row))
    }
  }
}

console.log('ALL TESTS PASSED')
