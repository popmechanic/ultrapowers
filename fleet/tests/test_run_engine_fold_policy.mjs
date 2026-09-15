// fleet/tests/test_run_engine_fold_policy.mjs — the exam for "a lane folds only
// when the fold releases a queued task, ends the run, or adopts a result that
// has aged a suite's length".
//
// At BASE every landing folds. The claim under test narrows that: a lane that
// frees claims an epoch only when the fold would BUY something — a task made
// ready, the run closed out, or a result that has waited long enough that
// holding it any longer is just latency — and the record says WHICH, in a `why`
// key on the event the fold appends.
//
// The Machine clauses under test, restated:
//   M1 — a lane that frees claims an epoch only when at least one of three holds
//        AT THAT INSTANT, and the `driver:wave-adopted` (or
//        `driver:wave-blocked`) event it produces carries `why` naming which:
//          `released` — some task not yet dispatched, not failed and not
//            downstream of a failed or blocked task, that is not ready now, has
//            every predecessor an edge names either adopted or among the pending
//            results; the event also carries `released: [<those task ids>]` in
//            plan order;
//          `end` — after this landing no worker is in flight, no fold is
//            running, no task is ready and nothing is pending but these results;
//          `aged` — the oldest pending result has waited `foldAgeMs` ms or more
//            since it landed (so `0` holds at the landing itself).
//   M2 — `foldAgeMs` is read from the run's arguments when it is a non-negative
//        number; otherwise it is the larger of `60000` and the wall, in
//        milliseconds, of the baseline suite the run measured (the age clause is
//        off until the baseline has settled). `foldAgeMs: 0` is BASE's rule:
//        every landing folds at its own instant.
//   M3 — three tasks, no edges, three different landing times, `foldAgeMs`
//        large: all three adopted in exactly one epoch with `why: 'end'`. The
//        same run with `foldAgeMs: 0`: more than one epoch, the first
//        `why: 'aged'`.
//   M4 — A, B, C with A->C and B->C, A landing first: A and B adopted TOGETHER in
//        one epoch with `why: 'released'` and `released: ['C']`, and only once B
//        has landed; C dispatched after that adoption on its head; C's own
//        landing adopted in a second epoch with `why: 'end'`. And a run where A
//        lands and nothing else lands for longer than a small `foldAgeMs` while
//        B is still running adopts A alone with `why: 'aged'`.
//   M5 — a lane waiting with nothing ready and results pending wakes ON ITS OWN
//        when the oldest pending result reaches `foldAgeMs`, without another
//        landing.
//   M6 — `fleet/CONTRACT.md`'s evidence bullet states the three triggers and
//        `foldAgeMs` with its default and its `0` reading, and still carries, in
//        this order, the words `epoch`, `ready`, `slot frees`,
//        `driver:wave-adopted` and `descendant`.
//   M7 — the three sims this task edits pass on the patched tree; the ready-set
//        sim passes `foldAgeMs: 0` in its eight non-fold-trigger scenarios and
//        not in `c1`; the other two carry `foldAgeMs: 0` in their rigs; and
//        every other sim under `fleet/tests/` passes through the bridge.
//   M8 — with `foldAgeMs: 0`, a result that lands while a fold is RUNNING is
//        adopted by the next epoch and never by the one in flight.
//
// The Proof legs, and where each is answered:
//   (a) [M1] `why` on every epoch event, and the released ids       — the sweep
//            at the foot of this file, over every run driven above
//   (b) [M2] the default threshold, `0`, and a non-number           — three runs
//   (c) [M3] one epoch under a large threshold, many under `0`      — two runs
//   (d) [M4] the released epoch and the aged one                    — two runs
//   (e) [M5] the lane woke on its own timer                         — read off
//            the aged run of leg (d)
//   (f) [M6] the contract's evidence bullet                         — its `Run:`
//            line, and repeated here with that line's own semantics
//   (g) [M7] the three sibling sims                                 — their two
//            `Run:` lines and the bridge's ALONE for the running; read here only
//            as TEXT, for the `foldAgeMs: 0` each one owes
//   (h) [M8] the mid-fold landing partition                         — two runs
//
// ── how this sim reads what the engine did ──────────────────────────────────
// The shape is `test_run_engine_ready_set.mjs`'s, copied and not imported (a sim
// that imported another sim would be one file's failure reported under two
// names): real git repos, real clones, real capture, the real fold kernel
// through the real exec seam, and only `agent` canned. The canned worker appends
// its own `worker:start` / `worker:end` lines — `worker:start` carrying the
// clone's HEAD, which legs (a) and (d) read the anchor off — into the same
// `<runDir>/events.jsonl` the engine appends its `driver:` events to, so that one
// file is the total order every ordering assertion below reads.
//
// THE SIBLING SIMS ARE READ, NEVER RUN. Leg (g)'s last clause is a question
// about three other files' TEXT. `fs.readFileSync` is how it is asked: no
// `existsSync`, no `statSync`, no spawn — which is exactly what
// `test_sims_are_hermetic.mjs` forbids a sim to do with a sibling's name.
//
// HOLDS ARE BOUNDED. Every "wait until X is on the log" gives up after HOLD_MS
// and returns, so a BASE engine — which never says most of what is waited for
// here — fails an assertion instead of hanging.
//
// WHY THIS IS RED AT BASE. `args.foldAgeMs` is read by nothing at BASE and no
// event carries `why`, so BASE folds at every landing: leg (b)'s first run folds
// three epochs where one is owed, and the sweep at the foot finds `why` missing
// on every event of every run.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSeam } from '../run-main.mjs'
import { makeRepo, rig, passReview, doneImpl, gitSync } from './_engine_helpers.mjs'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-fold-policy-'))
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }))

// How long a stub waits for the log to say what it is waiting for, and how long
// the exec seam holds leg (h)'s first fold. Long enough that a loaded box is not
// the reason a correct engine goes red; bounded so a BASE engine fails an
// assertion instead of hanging.
const HOLD_MS = 8000
const POLL_MS = 20

// The gap between two staggered landings in legs (b) and (c). Comfortably longer
// than the baseline suite leg (b) slows to ~200 ms, and nothing beside the 60 s
// default — which is the whole point of the pair.
const STAGGER_MS = 500
// Leg (d)'s aged run: B is held this long, and the threshold is a small
// fraction of it, so the epoch that adopts A alone can only have come from the
// age clause firing while B was still open.
const AGED_THRESHOLD_MS = 300
const AGED_HOLD_MS = 2000
// Leg (e)'s window: the adoption is owed within one second of A's `worker:end`
// plus the threshold. A lane that folded only on B's landing would be a second
// and a half late; one that woke on its own timer lands well inside it.
const WAKE_SLACK_MS = 1000

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
  let text = ''
  try { text = fs.readFileSync(file, 'utf8') } catch { return [] }
  return text.split('\n').filter(Boolean)
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
const epochEventsOf = (log) => log.filter((e) =>
  e.kind === 'driver:wave-adopted' || e.kind === 'driver:wave-blocked')
const indexOfEvent = (log, e) => log.indexOf(e)
const firstIndex = (log, pred) => log.findIndex(pred)
/** What the log says the worker was handed: the clone HEAD it opened on. */
const headAt = (log, i) => (log[i] && log[i].head) || null
/** A readable dump for a failed ordering assertion. */
const shownLog = (log) => log
  .map((e, i) => i + ' ' + e.kind + ' ' + (e.label || JSON.stringify(e.tasks || []) || '') +
    (e.why ? ' why=' + e.why : ''))
  .join(' | ')
/** The epochs, as the summary a failed count assertion should print. */
const shownEpochs = (log) => JSON.stringify(epochEventsOf(log)
  .map((e) => ({ kind: e.kind, wave: e.wave, tasks: e.tasks, why: e.why, released: e.released })))

// ── the canned worker's own two lines ───────────────────────────────────────
// Every canned dispatch mirrors them, implementers and judgments alike, so the
// log is the order the run really had. `ts` is the sim's own wall clock, in the
// same unit and from the same clock as the engine's `appendEvent` — leg (e)
// subtracts one from the other.
const openWorker = (runDir, label, extra = {}) =>
  appendLine(runDir, { kind: 'worker:start', label, ts: Date.now(), ...extra })
const workerStart = (runDir, label, cwd) =>
  openWorker(runDir, label, { cwd, head: gitSync(['rev-parse', 'HEAD'], cwd) })
const workerEnd = (runDir, label, extra = {}) =>
  appendLine(runDir, { kind: 'worker:end', label, ts: Date.now(), ...extra })
/** The canned referee, enveloped. A judgment's `worker:end` is the last thing
 *  that happens to a task before its result is recorded. */
const cannedReview = (runDir, label) => {
  openWorker(runDir, label)
  const reply = passReview()
  workerEnd(runDir, label)
  return reply
}
/** Has this task's referee returned — the last envelope of its pipeline? */
const judgedEnded = (log, id) => log.some((e) => e.kind === 'worker:end' &&
  typeof e.label === 'string' && e.label.startsWith('review:' + id + ':'))

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
// such call's begin and end in order, and `hold` — leg (h)'s — is awaited
// before the FIRST `fold` is delegated and never again.
const KERNEL_VERBS = new Set(['fold', 'resolve', 'materialize', 'emit-weave'])
function kernelSeam({ hold = null } = {}) {
  const calls = []
  let step = 0
  let live = 0
  let maxLive = 0
  let held = false
  const seamExec = async (cmd, argv, opts) => {
    const verb = (cmd === 'python3' && Array.isArray(argv) && KERNEL_VERBS.has(String(argv[1])))
      ? String(argv[1]) : null
    if (!verb) return execSeam(cmd, argv, opts)
    if (verb === 'fold' && hold && !held) { held = true; await hold() }
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
  return { exec: seamExec, calls, maxLive: () => maxLive }
}

// ── one scenario ────────────────────────────────────────────────────────────
// Every run this exam drives lands in RUNS, which the leg (a) sweep at the foot
// of the file reads. `ageArgs` is spread into the engine's arguments as it
// stands: `{}` is leg (b)'s "absent", `{ foldAgeMs: 0 }` is BASE's rule, and
// `{ foldAgeMs: 'x' }` is leg (b)'s non-number.
const RUNS = []
let seq = 0
async function drive({ tag, tasks, edges = [], width, makeStub, repoFiles = {},
                       ageArgs = {}, hold = null }) {
  seq += 1
  const stamp = 'fp' + seq + tag
  const repo = makeRepo(path.join(tmp, 'repo-' + stamp), repoFiles)
  const runDir = path.join(tmp, 'run-' + stamp)
  const seam = kernelSeam({ hold: hold ? () => hold(runDir) : null })
  const stub = makeStub(runDir)
  const built = rig({
    repo, runDir, waves: [tasks], edges, stamp, exec: seam.exec,
    stub: (prompt, opts, cwd) => stub(prompt, opts, cwd),
    extraArgs: { width, infraBackoffMs: 0, ...ageArgs },
  })
  const report = await built.run()
  const rec = { tag, stamp, repo, runDir, integ: built.integ, base: built.base,
                report, seam, log: readEvents(runDir) }
  RUNS.push(rec)
  return rec
}

/** The implementer every plain scenario cans: write, close. */
const plainImpl = (runDir, opts, cwd, id) => {
  fs.writeFileSync(path.join(cwd, id + '.txt'), 'from ' + id + '\n')
  const reply = doneImpl(cwd)
  workerEnd(runDir, opts.label)
  return reply
}

/**
 * X, Y, Z land at three different times: Y opens its work only once X's
 * implementer has returned and then waits `gap` more, and Z the same behind Y.
 * The three landings are therefore `gap`-apart instants and not a race — which
 * is the precondition legs (b) and (c) need before they can ask how many epochs
 * the run folded.
 */
const staggeredStub = (gap) => (runDir) => async (prompt, opts, cwd) => {
  const [kind, id] = opts.label.split(':')
  if (kind === 'review') return cannedReview(runDir, opts.label)
  if (kind !== 'impl') throw new Error('unexpected dispatch: ' + opts.label)
  workerStart(runDir, opts.label, cwd)
  if (id === 'Y') {
    await waitUntil(() => readEvents(runDir).some((e) => isEnd(e, 'impl:X')))
    await sleep(gap)
  } else if (id === 'Z') {
    await waitUntil(() => readEvents(runDir).some((e) => isEnd(e, 'impl:Y')))
    await sleep(gap)
  }
  return plainImpl(runDir, opts, cwd, id)
}

const THREE = () => [taskOf('X'), taskOf('Y'), taskOf('Z')]
/** A suite that takes about 200 ms — leg (b)'s measured baseline wall. */
const SLOW_SUITE = '#!/bin/bash\nsleep 0.2\n[ ! -f BROKEN ]\n'

// ════════════════════════════════════════════════════════════════════════════
// leg (b) — where the threshold comes from [M2]
//
// The same three-task, no-edge, staggered run three times, differing only in
// what the run's arguments say about `foldAgeMs`:
//
//   absent  -> the threshold is `max(60000, baselineWallMs)`. The baseline
//              suite here takes about 200 ms, so `60000` is the larger and the
//              three landings — half a second apart — never age into a fold.
//              Nothing is released (no edges) and the run only ENDS once, so
//              exactly one epoch folds, and it is `why: 'end'`.
//              A threshold read as the baseline's own wall instead of the
//              larger of the two would fire at each landing and fold three.
//   'x'     -> not a number, so the same default applies.
//   0       -> the age clause is true at the landing's own instant, which is
//              BASE's fold-at-every-landing rule, and the first epoch says so.
// ════════════════════════════════════════════════════════════════════════════
{
  assert.match(SLOW_SUITE, /sleep 0\.2/,
    '(b)/M2: sim precondition — the suite these three runs measure their baseline on is the one ' +
    'that sleeps 200 ms, so `max(60000, baselineWallMs)` and `baselineWallMs` are different ' +
    'answers: ' + JSON.stringify(SLOW_SUITE))

  const run = await drive({
    tag: 'b1', tasks: THREE(), edges: [], width: 3,
    repoFiles: { 'check.sh': SLOW_SUITE },
    ageArgs: {},
    makeStub: staggeredStub(STAGGER_MS),
  })
  const log = run.log
  const adoptions = adoptionsOf(log)
  assert.deepEqual(run.report.tasks.map((r) => [r.task, r.status]).sort(),
    [['X', 'done'], ['Y', 'done'], ['Z', 'done']],
    '(b)/M2: sim precondition — all three tasks finish: ' +
    JSON.stringify(run.report.tasks.map((r) => ({ task: r.task, status: r.status }))))
  assert.equal(adoptions.length, 1,
    '(b)/M2: with `foldAgeMs` absent the threshold is the larger of 60000 and the ~200 ms ' +
    'baseline wall, i.e. 60000 — three landings ' + STAGGER_MS + ' ms apart release nothing and ' +
    'age into nothing, so the run folds ONCE, when it ends: ' + shownEpochs(log) + ' | ' +
    shownLog(log))
  assert.deepEqual([...(adoptions[0] || { tasks: [] }).tasks].sort(), ['X', 'Y', 'Z'],
    '(b)/M2: and that one epoch carries all three: ' + JSON.stringify(adoptions[0] || null))
  assert.equal((adoptions[0] || {}).why, 'end',
    '(b)/M2: the trigger was the run ending — after the last landing nothing is in flight, ' +
    'nothing is folding, nothing is ready and nothing is pending but these results: ' +
    JSON.stringify(adoptions[0] || null))
}

{
  const run = await drive({
    tag: 'b2', tasks: THREE(), edges: [], width: 3,
    repoFiles: { 'check.sh': SLOW_SUITE },
    ageArgs: { foldAgeMs: 0 },
    makeStub: staggeredStub(STAGGER_MS),
  })
  const log = run.log
  const adoptions = adoptionsOf(log)
  assert.ok(adoptions.length >= 2,
    '(b)/M2: `foldAgeMs: 0` makes the age clause true at the landing\'s own instant — BASE\'s ' +
    'rule — so the same run folds at its first landing rather than once at the end: ' +
    shownEpochs(log) + ' | ' + shownLog(log))
  assert.deepEqual((adoptions[0] || { tasks: [] }).tasks, ['X'],
    '(b)/M2: the first epoch is X alone, folded at X\'s own landing: ' +
    JSON.stringify(adoptions[0] || null))
  assert.equal((adoptions[0] || {}).why, 'aged',
    '(b)/M2: and the trigger is the age clause — the oldest pending result has waited 0 ms, ' +
    'which is `foldAgeMs` or more: ' + JSON.stringify(adoptions[0] || null))
}

{
  const run = await drive({
    tag: 'b3', tasks: THREE(), edges: [], width: 3,
    repoFiles: { 'check.sh': SLOW_SUITE },
    ageArgs: { foldAgeMs: 'x' },
    makeStub: staggeredStub(STAGGER_MS),
  })
  const log = run.log
  const adoptions = adoptionsOf(log)
  assert.equal(adoptions.length, 1,
    '(b)/M2: `foldAgeMs` is read from the arguments only when it is a NON-NEGATIVE NUMBER — ' +
    "`'x'` is neither, so the default applies and the run folds once: " + shownEpochs(log) +
    ' | ' + shownLog(log))
  assert.equal((adoptions[0] || {}).why, 'end',
    '(b)/M2: with the default threshold the only trigger left is the run ending: ' +
    JSON.stringify(adoptions[0] || null))
}

// ════════════════════════════════════════════════════════════════════════════
// leg (c) — one epoch under a large threshold, more than one under `0` [M3]
//
// The same plan as leg (b) with the threshold said out loud: ten minutes, which
// no staggered landing of this run can reach, against `0`, which every landing
// reaches at its own instant.
// ════════════════════════════════════════════════════════════════════════════
{
  const run = await drive({
    tag: 'c1', tasks: THREE(), edges: [], width: 3,
    ageArgs: { foldAgeMs: 600000 },
    makeStub: staggeredStub(STAGGER_MS),
  })
  const log = run.log
  const adoptions = adoptionsOf(log)
  assert.deepEqual(run.report.tasks.map((r) => [r.task, r.status]).sort(),
    [['X', 'done'], ['Y', 'done'], ['Z', 'done']],
    '(c)/M3: sim precondition — all three tasks finish: ' +
    JSON.stringify(run.report.tasks.map((r) => ({ task: r.task, status: r.status }))))
  assert.equal(adoptions.length, 1,
    '(c)/M3: three tasks with no edges landing at three different times, `foldAgeMs: 600000` — ' +
    'no landing releases anything and none ages, so exactly ONE epoch folds: ' +
    shownEpochs(log) + ' | ' + shownLog(log))
  assert.deepEqual([...(adoptions[0] || { tasks: [] }).tasks].sort(), ['X', 'Y', 'Z'],
    '(c)/M3: and it adopts all three: ' + JSON.stringify(adoptions[0] || null))
  assert.equal((adoptions[0] || {}).why, 'end',
    '(c)/M3: with `why: \'end\'` — the fold that closed the run out: ' +
    JSON.stringify(adoptions[0] || null))
}

{
  const run = await drive({
    tag: 'c2', tasks: THREE(), edges: [], width: 3,
    ageArgs: { foldAgeMs: 0 },
    makeStub: staggeredStub(STAGGER_MS),
  })
  const log = run.log
  const adoptions = adoptionsOf(log)
  assert.ok(adoptions.length >= 2,
    '(c)/M3: the same run with `foldAgeMs: 0` — the age clause true at the landing\'s own ' +
    'instant — folds in more than one epoch: ' + shownEpochs(log) + ' | ' + shownLog(log))
  assert.equal((adoptions[0] || {}).why, 'aged',
    '(c)/M3: and the first of them is the age clause firing at the first landing: ' +
    JSON.stringify(adoptions[0] || null))
}

// ════════════════════════════════════════════════════════════════════════════
// leg (d), first half — the fold that releases a queued task [M4]
//
// A, B, C with A -> C and B -> C, width 3, `foldAgeMs` ten minutes. A lands
// first and its landing buys NOTHING: C's other predecessor B is neither adopted
// nor pending, so C stays queued, and B is still in flight so the run has not
// ended. B's landing is the one that buys something — with A and B both among
// the pending results, every predecessor an edge names for C is accounted for —
// so THAT is where the epoch is claimed, it carries A and B together, and it
// says `released: ['C']`. C then goes out on the head that epoch left.
// ════════════════════════════════════════════════════════════════════════════
{
  const run = await drive({
    tag: 'd1', tasks: [taskOf('A'), taskOf('B'), taskOf('C')],
    edges: [['A', 'C'], ['B', 'C']], width: 3,
    ageArgs: { foldAgeMs: 600000 },
    makeStub: (runDir) => async (prompt, opts, cwd) => {
      const [kind, id] = opts.label.split(':')
      if (kind === 'review') return cannedReview(runDir, opts.label)
      if (kind !== 'impl') throw new Error('unexpected dispatch: ' + opts.label)
      workerStart(runDir, opts.label, cwd)
      if (id === 'B') {
        // B returns only once A's whole pipeline has — so A lands first, and
        // "A's landing released nothing" is a fact about the rule rather than
        // about which stub won a race.
        await waitUntil(() => judgedEnded(readEvents(runDir), 'A'))
        await sleep(STAGGER_MS)
      }
      return plainImpl(runDir, opts, cwd, id)
    },
  })
  const log = run.log
  const adoptions = adoptionsOf(log)
  assert.deepEqual(run.report.tasks.map((r) => [r.task, r.status]).sort(),
    [['A', 'done'], ['B', 'done'], ['C', 'done']],
    '(d)/M4: sim precondition — all three tasks finish: ' +
    JSON.stringify(run.report.tasks.map((r) => ({ task: r.task, status: r.status }))))
  assert.equal(adoptions.length, 2,
    '(d)/M4: A\'s landing releases nothing (C\'s other predecessor B is still in flight) and ends ' +
    'nothing, so it folds no epoch; B\'s landing releases C, and C\'s landing ends the run — ' +
    'exactly two epochs: ' + shownEpochs(log) + ' | ' + shownLog(log))
  const first = adoptions[0] || { tasks: [] }
  const second = adoptions[1] || { tasks: [] }
  assert.deepEqual(first.tasks, ['A', 'B'],
    '(d)/M4: the first epoch adopts A and B TOGETHER, in plan order — A was captured and ' +
    'unadopted at the instant B\'s landing claimed: ' + JSON.stringify(adoptions[0] || null))
  assert.equal(first.why, 'released',
    '(d)/M4: and its trigger is the queued task it frees: ' + JSON.stringify(adoptions[0] || null))
  assert.deepEqual(first.released, ['C'],
    '(d)/M4: which the event names — the tasks not yet dispatched, not ready now, whose every ' +
    'named predecessor is adopted or among these results, in plan order: ' +
    JSON.stringify(adoptions[0] || null))
  const endB = firstIndex(log, (e) => isEnd(e, 'impl:B'))
  assert.ok(endB !== -1 && indexOfEvent(log, first) > endB,
    '(d)/M4: that epoch is folded only ONCE B has landed — before B landed, C had a predecessor ' +
    'that was neither adopted nor pending, and nothing was released: ' + shownLog(log))
  const startC = firstIndex(log, (e) => isStart(e, 'impl:C'))
  assert.ok(startC !== -1 && startC > indexOfEvent(log, first),
    '(d)/M4: C is dispatched AFTER that adoption — the release is what made it ready: ' +
    shownLog(log))
  assert.equal(headAt(log, startC), first.headSha,
    '(d)/M4: and on that epoch\'s own head (' + String(first.headSha) + '), not on the run base ' +
    run.base + ': ' + JSON.stringify(log[startC]))
  assert.deepEqual(second.tasks, ['C'],
    '(d)/M4: C\'s own landing is adopted in a second epoch: ' + JSON.stringify(adoptions[1] || null))
  assert.equal(second.why, 'end',
    '(d)/M4: whose trigger is the run ending — nothing in flight, nothing folding, nothing ready ' +
    'and nothing pending but C: ' + JSON.stringify(adoptions[1] || null))
}

// ════════════════════════════════════════════════════════════════════════════
// leg (d), second half, and leg (e) — the fold a result ages into [M4, M5]
//
// A and B, no edges, width 2. A returns at once; B is held two seconds. A's
// landing releases nothing (B is the only other task and it is already
// dispatched) and ends nothing (B is in flight), and at that instant A has aged
// 0 ms against a threshold of 300 — so the landing itself claims no epoch. The
// lane then has nothing ready, nothing to dispatch and a pending result, and the
// ONLY thing that can fold it is the lane waking on its own when A reaches 300
// ms. That is leg (e): the adoption's `ts` lands inside a second of A's
// `worker:end` plus the threshold, while B has not landed at all.
// ════════════════════════════════════════════════════════════════════════════
let agedRun = null
{
  agedRun = await drive({
    tag: 'd2', tasks: [taskOf('A'), taskOf('B')], edges: [], width: 2,
    ageArgs: { foldAgeMs: AGED_THRESHOLD_MS },
    makeStub: (runDir) => async (prompt, opts, cwd) => {
      const [kind, id] = opts.label.split(':')
      if (kind === 'review') return cannedReview(runDir, opts.label)
      if (kind !== 'impl') throw new Error('unexpected dispatch: ' + opts.label)
      workerStart(runDir, opts.label, cwd)
      if (id === 'B') await sleep(AGED_HOLD_MS)
      return plainImpl(runDir, opts, cwd, id)
    },
  })
  const log = agedRun.log
  const adoptions = adoptionsOf(log)
  const endA = firstIndex(log, (e) => isEnd(e, 'impl:A'))
  const endB = firstIndex(log, (e) => isEnd(e, 'impl:B'))
  assert.ok(endA !== -1 && endB !== -1,
    '(d)/M4: sim precondition — both implementers return: ' + shownLog(log))
  const first = adoptions[0] || { tasks: [] }
  assert.deepEqual(first.tasks, ['A'],
    '(d)/M4: A is adopted ALONE — B was still running, so nothing else had landed to join it: ' +
    shownEpochs(log) + ' | ' + shownLog(log))
  assert.equal(first.why, 'aged',
    '(d)/M4: and the only clause that can have fired is the age one: A released nothing (B was ' +
    'already dispatched) and ended nothing (B was in flight), so the ' + AGED_THRESHOLD_MS +
    ' ms threshold is what bought the fold: ' + JSON.stringify(adoptions[0] || null))
  assert.ok(indexOfEvent(log, first) < endB,
    '(d)/M4: that adoption precedes `worker:end impl:B` — it happened while B was still open: ' +
    shownLog(log))

  // [M5] the lane woke on its own. A's `worker:end` is the last thing the sim
  // wrote before A's result was recorded; the adoption is owed within a second
  // of that plus the threshold. A lane that could only be woken by a landing
  // would have waited out B's two-second hold.
  const endATs = log[endA].ts
  const adoptTs = first.ts
  assert.equal(typeof adoptTs, 'number',
    '(e)/M5: sim precondition — the adoption event carries the `ts` this leg reads: ' +
    JSON.stringify(adoptions[0] || null))
  assert.ok(adoptTs >= endATs,
    '(e)/M5: sim precondition — the adoption follows A\'s `worker:end` in wall time: ' +
    (adoptTs - endATs) + ' ms')
  assert.ok(adoptTs - endATs <= AGED_THRESHOLD_MS + WAKE_SLACK_MS,
    '(e)/M5: the lane waiting with nothing ready and a pending result woke ON ITS OWN when A ' +
    'reached ' + AGED_THRESHOLD_MS + ' ms, without another landing — the adoption is owed within ' +
    WAKE_SLACK_MS + ' ms of A\'s `worker:end` plus the threshold, and it came ' +
    (adoptTs - endATs) + ' ms after it. B was held ' + AGED_HOLD_MS + ' ms, so a lane that only ' +
    'ever wakes on a landing lands outside this window: ' + shownLog(log))
  const endBTs = log[endB].ts
  assert.ok(adoptTs < endBTs,
    '(e)/M5: and B had not landed when it happened — B\'s `worker:end` is ' +
    (endBTs - adoptTs) + ' ms later: ' + shownLog(log))
}

// ════════════════════════════════════════════════════════════════════════════
// leg (h) — a result that lands while a fold is running [M8]
//
// The pin this task's edits would otherwise delete from the tree, carried here.
// X, Y and Z, width 3, `foldAgeMs: 0`, stubs ending in that order. The exec seam
// holds the kernel's FIRST `fold` until Y's and Z's whole pipelines are on the
// log: X's landing opened an epoch, and Y's and Z's landings arrive while that
// epoch is still folding. Exactly two adoptions must follow — the held one
// carrying X alone, and ONE more carrying Y and Z together, because a result
// that lands while a fold is running is adopted by the fold AFTER it and never
// by the one already in flight.
// ════════════════════════════════════════════════════════════════════════════
{
  const run = await drive({
    tag: 'h1', tasks: THREE(), edges: [], width: 3,
    ageArgs: { foldAgeMs: 0 },
    hold: (runDir) => waitUntil(() => {
      const log = readEvents(runDir)
      return log.some((e) => isEnd(e, 'impl:Y')) && log.some((e) => isEnd(e, 'impl:Z')) &&
        judgedEnded(log, 'Y') && judgedEnded(log, 'Z')
    }),
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
  const holdsBegun = run.seam.calls.filter((c) => c.verb === 'fold' && c.at === 'begin')
  assert.ok(holdsBegun.length >= 1,
    '(h)/M8: sim precondition — the exec seam saw the kernel `fold` it held: ' +
    JSON.stringify(run.seam.calls))
  assert.equal(adoptions.length, 2,
    '(h)/M8: with `foldAgeMs: 0` X\'s landing folds one epoch; Y\'s and Z\'s landings arrive while ' +
    'it is folding and are folded together by the next lane — exactly two epochs, not one and ' +
    'not three: ' + shownEpochs(log) + ' | ' + shownLog(log))
  const epoch = (i) => adoptions[i] || { tasks: [] }
  assert.deepEqual(epoch(0).tasks, ['X'],
    '(h)/M8: the first epoch is X alone — it was the only captured, unadopted result when the ' +
    'fold began: ' + JSON.stringify(adoptions[0] || null))
  assert.deepEqual([...epoch(1).tasks].sort(), ['Y', 'Z'],
    '(h)/M8: the second epoch folds Y and Z TOGETHER, and never into the fold already in ' +
    'flight: ' + JSON.stringify(adoptions[1] || null))
  assert.ok(indexOfEvent(log, epoch(0)) < indexOfEvent(log, epoch(1)),
    '(h)/M8: epochs are appended in fold order: ' + shownLog(log))
  assert.ok(run.seam.maxLive() <= 1,
    '(h)/M8: and only one fold ran at a time — the exec seam saw ' + run.seam.maxLive() +
    ' kernel calls in flight at once')
}

// The same three tasks with `foldAgeMs: 0` and nothing held: however many epochs
// the landings happen to fall into, each task is in exactly one of them.
{
  const run = await drive({
    tag: 'h2', tasks: THREE(), edges: [], width: 3,
    ageArgs: { foldAgeMs: 0 },
    makeStub: (runDir) => async (prompt, opts, cwd) => {
      const [kind, id] = opts.label.split(':')
      if (kind === 'review') return cannedReview(runDir, opts.label)
      if (kind !== 'impl') throw new Error('unexpected dispatch: ' + opts.label)
      workerStart(runDir, opts.label, cwd)
      return plainImpl(runDir, opts, cwd, id)
    },
  })
  const log = run.log
  const adopted = adoptionsOf(log).flatMap((e) => (Array.isArray(e.tasks) ? e.tasks : []))
  assert.deepEqual([...adopted].sort(), ['X', 'Y', 'Z'],
    '(h)/M8: with `foldAgeMs: 0` and no hold, the three tasks are adopted once each — every ' +
    'result reaches exactly one epoch, and none is adopted twice or dropped: ' +
    shownEpochs(log) + ' | ' + shownLog(log))
}

// ════════════════════════════════════════════════════════════════════════════
// leg (a), the sweep — across EVERY run this exam drove [M1]
//
// Two questions of every epoch event of every run above. First: it says WHY it
// folded, and the answer is one of the three clauses — an epoch that folded for
// no stated reason is the BASE rule wearing the new record's clothes. Second:
// an adoption that folded because it released work names the work it released,
// and each named id really is dispatched after that event, on that event's own
// head.
//
// The released-ids half is asked of `driver:wave-adopted` alone: a blocked epoch
// carries no `headSha` to dispatch anything on, and the tasks it would have
// released never go out at all.
// ════════════════════════════════════════════════════════════════════════════
const WHYS = ['aged', 'end', 'released']
{
  assert.ok(RUNS.length >= 9,
    '(a)/M1: sim precondition — every scenario above registered its run: ' + RUNS.length +
    ' registered')
  for (const run of RUNS) {
    const where = ' [run ' + run.tag + ']'
    const log = run.log
    const epochs = epochEventsOf(log)
    assert.ok(epochs.length >= 1,
      '(a)/M1: sim precondition — every run of this exam folds at least one epoch' + where +
      ': ' + shownLog(log))

    for (const e of epochs) {
      assert.ok(WHYS.includes(e.why),
        '(a)/M1: every `' + e.kind + '` names which of the three clauses claimed its epoch — ' +
        '`why` is one of ' + JSON.stringify(WHYS) + ', and a lane that folded for none of them ' +
        'folded for no reason the record can state' + where + ': ' + JSON.stringify(e))
    }

    for (const e of adoptionsOf(log)) {
      if (e.why !== 'released') {
        // Absent or empty — either says the same thing. What an epoch claimed
        // for some other reason may not do is NAME work it released.
        assert.ok(e.released === undefined || (Array.isArray(e.released) && e.released.length === 0),
          '(a)/M1: `released` ids travel with `why: \'released\'` and with nothing else' + where +
          ': ' + JSON.stringify(e))
        continue
      }
      assert.ok(Array.isArray(e.released) && e.released.length > 0,
        '(a)/M1: an adoption that folded because it released a queued task carries a non-empty ' +
        '`released` array of task ids' + where + ': ' + JSON.stringify(e))
      const at = indexOfEvent(log, e)
      for (const id of e.released) {
        const start = firstIndex(log, (x) => isStart(x, 'impl:' + id))
        assert.ok(start !== -1 && start > at,
          '(a)/M1: `' + id + '` is named as released by epoch ' + e.wave + ', so it is dispatched ' +
          'AFTER that event' + where + ': ' + shownLog(log))
        assert.equal(headAt(log, start), e.headSha,
          '(a)/M1: and on the head that epoch left (' + String(e.headSha) + ')' + where + ': ' +
          JSON.stringify(log[start]))
      }
    }

    // A red epoch would have to carry `why` like any other; none of the runs
    // above builds one, and that is recorded here rather than assumed.
    assert.deepEqual(blocksOf(log).map((e) => e.wave), [],
      '(a)/M1: sim precondition — no scenario of this exam folds a red epoch, so every epoch ' +
      'event swept above is an adoption' + where + ': ' + shownEpochs(log))
  }
}

// ════════════════════════════════════════════════════════════════════════════
// leg (f) — the contract's evidence bullet [M6]
//
// The same region the fourth `Run:` line takes — from the line opening "The
// engine's own wave record" through the line opening "The driver's own
// executions" — joined into one line, and the same ordered words.
// ════════════════════════════════════════════════════════════════════════════
{
  const contract = fs.readFileSync(fileURLToPath(new URL('../CONTRACT.md', import.meta.url)), 'utf8')
  const lines = contract.split('\n')
  const from = lines.findIndex((l) => /^ {4}The engine.s own wave record/.test(l))
  assert.ok(from !== -1,
    '(f)/M6: sim precondition — fleet/CONTRACT.md still has the evidence bullet that opens ' +
    '"The engine\'s own wave record"')
  let to = lines.slice(from + 1).findIndex((l) => /^ {4}The driver.s own executions/.test(l))
  to = to === -1 ? lines.length - 1 : from + 1 + to
  const bullet = lines.slice(from, to + 1).join(' ')

  // The `Run:` line's own regex, byte for byte.
  assert.match(bullet,
    /epoch[\s\S]*ready[\s\S]*slot frees[\s\S]*release[\s\S]*end[\s\S]*foldAgeMs[\s\S]*60[\s\S]*driver:wave-adopted[\s\S]*descendant/,
    '(f)/M6: the evidence bullet states the three triggers and the threshold where the record ' +
    'already stated how work is scheduled — `epoch`, `ready`, `slot frees`, then release, end ' +
    'and `foldAgeMs` with its default, then `driver:wave-adopted` and `descendant`, in that ' +
    'order:\n' + JSON.stringify(bullet))
  // And M6's five words on their own, so a reader can see the older pin survive
  // the rewrite rather than infer it from the longer one.
  assert.match(bullet, /epoch[\s\S]*ready[\s\S]*slot frees[\s\S]*driver:wave-adopted[\s\S]*descendant/,
    '(f)/M6: and it still carries, in this order, `epoch`, `ready`, `slot frees`, ' +
    '`driver:wave-adopted` and `descendant`:\n' + JSON.stringify(bullet))
  assert.ok(bullet.includes('foldAgeMs'),
    '(f)/M6: the threshold is named by the name the arguments carry:\n' + JSON.stringify(bullet))
  assert.match(bullet, /aged|older than|age/,
    '(f)/M6: the third trigger — a result that has aged the threshold — is stated and not only ' +
    'the other two:\n' + JSON.stringify(bullet))
  assert.match(bullet, /(^|[^\w`])`?0`?([^\w]|$)/,
    '(f)/M6: and `foldAgeMs`\'s `0` reading — fold at every landing — is stated too:\n' +
    JSON.stringify(bullet))
}

// ════════════════════════════════════════════════════════════════════════════
// leg (g) — what the three edited sims owe [M7]
//
// The RUNNING of them is their own two `Run:` lines and the bridge's, which is
// the third: a sim may not run another sim. What is asked here is the text.
//
// The ready-set sim's subject is the ready set and not the fold trigger, so
// every scenario of it except `c1` — which this task re-aims at the new rule —
// must reach the engine with `foldAgeMs: 0`, the BASE rule, or its BASE
// expectations stop holding. `c1` alone must NOT, since it is the scenario that
// now expects one epoch of all three.
//
// Where the literal sits is the sim's business: inside each scenario's own
// `drive({ … })`, or in that sim's `drive` helper, which singles `c1` out. Both
// shapes say the same thing and both are accepted below; a sim that passes it
// nowhere, or passes it to `c1` too, is not.
// ════════════════════════════════════════════════════════════════════════════
{
  /** A sibling sim's source, read and never run — no `existsSync`, no spawn. */
  const siblingSource = (name) => {
    try {
      return fs.readFileSync(fileURLToPath(new URL('./' + name, import.meta.url)), 'utf8')
    } catch (error) {
      return null
    }
  }

  const READY_SET = 'test_run_engine_ready_set.mjs'
  const readySet = siblingSource(READY_SET)
  assert.ok(typeof readySet === 'string' && readySet.length > 0,
    '(g)/M7: sim precondition — the ready-set sim this task edits is beside this file and is ' +
    'read as text')

  /** The text of one scenario: from its `tag: '<id>'` to whichever comes first,
   *  the next scenario's tag or the `}` that closes the block at column 0. */
  const scenarioText = (src, tag) => {
    const at = src.indexOf("tag: '" + tag + "'")
    if (at === -1) return null
    const rest = src.slice(at + 1)
    const nextTag = rest.search(/tag: '/)
    const nextBlock = rest.search(/\n\}/)
    const ends = [nextTag, nextBlock].filter((i) => i !== -1)
    return ends.length === 0 ? rest : rest.slice(0, Math.min(...ends))
  }
  /** The ready-set sim's `drive` helper, as text: from its declaration to the
   *  `}` that closes it at column 0. */
  const driveHelper = (src) => {
    const at = src.search(/(async\s+)?function\s+drive\s*\(|const\s+drive\s*=/)
    if (at === -1) return ''
    const rest = src.slice(at)
    const end = rest.search(/\n\}/)
    return end === -1 ? rest : rest.slice(0, end)
  }
  const helper = driveHelper(readySet)
  // The helper shape: it carries the zero AND names `c1` as the one scenario
  // that does not get it.
  const helperPassesZero = helper.includes('foldAgeMs') && /c1/.test(helper)

  const EIGHT = ['a1', 'a2', 'b1', 'b2', 'd1', 'd2', 'e1', 'e2']
  for (const tag of EIGHT) {
    const text = scenarioText(readySet, tag)
    assert.ok(text !== null,
      '(g)/M7: sim precondition — the ready-set sim still has a scenario tagged `' + tag + '`')
    assert.ok(/foldAgeMs:\s*0/.test(text) || helperPassesZero,
      '(g)/M7: scenario `' + tag + '` of the ready-set sim is not about the fold trigger, so it ' +
      'reaches the engine with `foldAgeMs: 0` — BASE\'s fold-at-every-landing rule — and its ' +
      'BASE expectations hold unchanged. Neither its own `drive({ … })` call nor that sim\'s ' +
      '`drive` helper passes it.')
  }
  const c1 = scenarioText(readySet, 'c1')
  assert.ok(c1 !== null,
    '(g)/M7: sim precondition — the ready-set sim still has the scenario tagged `c1`')
  assert.equal(/foldAgeMs/.test(c1), false,
    '(g)/M7: and `c1` is the one scenario that does NOT pass it — it is re-aimed at the new rule ' +
    'and runs under the default threshold, folding X, Y and Z in one epoch: ' +
    JSON.stringify(c1.slice(0, 400)))
  assert.ok(/foldAgeMs:\s*0/.test(readySet),
    '(g)/M7: and the literal is really in that sim somewhere — eight scenarios owe it')

  for (const name of ['test_run_engine_joined_proofs.mjs', 'test_run_engine_proof_runs.mjs']) {
    const src = siblingSource(name)
    assert.ok(typeof src === 'string' && src.length > 0,
      '(g)/M7: sim precondition — ' + name + ' is beside this file and is read as text')
    assert.ok(/foldAgeMs:\s*0/.test(src),
      '(g)/M7: ' + name + ' paces a reviewer against a fold per landing, so its rig passes ' +
      '`foldAgeMs: 0` — under the new rule the fold it waits for never runs and the sim waits ' +
      'forever')
  }
}

console.log('ALL TESTS PASSED')
