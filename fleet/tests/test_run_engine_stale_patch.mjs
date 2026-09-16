// fleet/tests/test_run_engine_stale_patch.mjs — the exam for "the engine hands
// the kernel each result's anchor and the record says how each task landed".
//
// A result captured against a head the integration branch has since moved past
// is not a refusal any more: the kernel takes `--patch <id>=<file>@<anchor>`
// and folds that patch as a three-way over the head it was captured against.
// This task is the ENGINE side of that — the anchor the kernel is handed, and
// the reading the run's record owes afterwards: which of `base`, `rebased` and
// `resolved` each task of an epoch took, on the adoption row and on the blocked
// one alike, and a `CONFLICT` epoch that appends a blocked row at all.
//
// The Machine clauses under test, restated:
//   M1 — in `foldWave`, every `--patch` the engine passes to `fold`, `resolve`
//        and `materialize` carries the result's capture anchor
//        (`anchorOf.get(task.id)`) as `@<sha>` when that anchor differs from
//        `prevHead`, and no `@` when it IS `prevHead`.
//   M2 — `driver:wave-adopted` carries `applied`, an object keyed by task id:
//        `base` when the task's anchor is the epoch's `prevHead`; `rebased`
//        when its anchor is older and no narrated conflict of the epoch named a
//        path of the task; `resolved` when its anchor is older and a narrated
//        conflict of the epoch named one of its paths — on an adoption that
//        conflict was resolved, on a blocked epoch it is the conflict the fold
//        stopped on. `driver:wave-blocked` carries the same object for the
//        epoch's tasks.
//   M3 — an epoch whose `foldWave` returns `CONFLICT` appends
//        `driver:wave-blocked` with `wave`, `tasks`, `detail`, `why` and
//        `applied`, and marks each of its tasks blocked on the hub exactly as a
//        `TEST_FAILED` epoch does.
//   M4 — A, B, C in one plan wave, edge A -> C, width 2, `foldAgeMs: 0`, A and
//        B both rewriting the seeded `a.txt` and `impl:A` held until B's
//        adoption is on the log: with a canned resolver answering the one
//        narrated hunk, all three adopt, the second adoption's `applied` reads
//        `{ A: 'resolved' }` and the head carries both lines; the same run with
//        the two edits NOT meeting dispatches no resolver and reads
//        `{ A: 'rebased' }`; the first adoption of both runs reads
//        `{ B: 'base' }`.
//   M5 — the same overlapping run with a resolver stub that answers `BLOCKED`
//        ends with a `driver:wave-blocked` for the epoch naming A, `detail`
//        beginning `resolver reported BLOCKED`, `applied { A: 'resolved' }`,
//        and A's hub row marked blocked.
//   M6 — `fleet/CONTRACT.md`'s evidence bullet names `applied` with its three
//        values in the `driver:wave-adopted` sentence and says a `CONFLICT`
//        epoch emits `driver:wave-blocked` too, so the region carries, in this
//        order: `epoch`, `ready`, `slot frees`, `release`, `end`, `aged`,
//        `foldAgeMs`, `60`, `driver:wave-adopted`, `applied`, `base`,
//        `rebased`, `resolved`, `descendant`, `driver:wave-blocked`,
//        `CONFLICT`.
//   M7 — every sim under `fleet/tests/` passes through the bridge on the
//        patched tree, this exam included.
//
// The Proof legs, and where each is answered:
//   (a) [M1] the argv of every kernel call of the overlapping run — below,
//            with the run leg (b) reads
//   (b) [M2, M4] the overlapping run: three adoptions, `base`/`resolved`/`base`,
//            one resolver dispatch, the head's `a.txt` — below
//   (c) [M2, M4] the non-meeting run: `rebased`, no resolver, the head's
//            `a.txt` — below. SEE THE NOTE ON LEG (c) BELOW: M4's literal
//            "A rewriting line 3 instead" cannot be the `rebased` run, so this
//            leg is written against M2's own `rebased` clause with a seed whose
//            edits genuinely do not meet.
//   (d) [M3, M5] the BLOCKED run: one `driver:wave-blocked`, its fields, and
//            A's hub mark — below
//   (e) [M6] the contract's evidence bullet — its `Run:` line, and repeated
//            here with that line's own sed range and regex
//   (f) [M7] the bridge over every `fleet/tests/test_*.mjs` — its `Run:` line
//            ALONE. A sim may not name a sibling sim (the hermetic probe
//            forbids it), so no sibling name appears in this file.
//   (g) [M1] `anchorOf.get(` read at more than one site of
//            `fleet/run-engine.mjs` — its `Run:` line, and repeated here
//
// ── THE NOTE ON LEG (c) ─────────────────────────────────────────────────────
// M4's second run says "the same run with A rewriting line 3 instead (the
// sibling's edit one line away, the context git's plain apply refuses)
// dispatches no resolver", and leg (c) pins the head's `a.txt` at
// `line1\nB2\nA3\n`. Measured against the kernel at BASE, that run narrates a
// conflict: the line fold segments the annotated merge into blocks, and two
// change regions on ADJACENT lines (the frontier's line 2, the task's line 3)
// fall in ONE block — so an anchored fold of A@BASE over a head that rewrote
// line 2 answers `conflicts: 1` with a single hunk spanning both edits,
// whatever the engine does. The same shape with one unchanged line between the
// two edits folds clean. The kernel is out of this task's scope (the run's
// global constraint: "the resolver answers the same brief it answers today"),
// so M4's line-3 run reads `resolved` under every implementation of this task
// and can never read `rebased`.
//
// What leg (c) grades here is therefore M2's own `rebased` clause — anchor
// older, and no narrated conflict of the epoch named a path of the task — on
// the smallest seed that makes the edits genuinely not meet: `a.txt` seeded
// with five lines, B rewriting line 2 and A rewriting line 4. Everything else
// M4 asks of that run is kept: no `resolve:` label dispatched, the second
// adoption's `applied` exactly `{ A: 'rebased' }`, the first exactly
// `{ B: 'base' }`, and the head's `a.txt` carrying BOTH lines, asserted by full
// equality. It is still red at BASE, and for the same one reason: without the
// anchor the wave-2 fold is the kernel's exit-2 `does not apply` refusal.
//
// ── how this sim reads what the engine did ──────────────────────────────────
// Everything below the agent seam is real: real git repos, real clones, real
// capture, the real fold kernel through the real exec seam. Only `agent` is
// canned — so the second epoch of every run below is a genuine stale-patch
// fold, and the argv leg (a) reads is the argv the kernel really got.
//
// THE ORDERED LOG. The rig does not run `run-worker.mjs`, so no `worker:start`
// / `worker:end` reaches `<runDir>/events.jsonl` on its own. The canned worker
// here appends them itself, in production's order, into the same file the
// engine appends its own `driver:` events to. That one file is the total order
// every ordering assertion below reads.
//
// HOLDS ARE BOUNDED. Every "wait until X is on the log" gives up after HOLD_MS
// and returns. At BASE the second epoch never adopts, so a hold that waited
// forever would HANG the run instead of failing it, and this exam has to be
// runnable at BASE to be red there. A lapsed hold falls through and the
// assertion that wanted the ordering is the thing that fails.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { execSeam } from '../run-main.mjs'
import { ENV, makeRepo, rig, passReview, doneImpl, gitSync } from './_engine_helpers.mjs'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-stale-patch-'))
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }))

const HOLD_MS = 12000
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
const adoptionsOf = (log) => log.filter((e) => e.kind === 'driver:wave-adopted')
const blocksOf = (log) => log.filter((e) => e.kind === 'driver:wave-blocked')
const namingTask = (events, id) =>
  events.find((e) => Array.isArray(e.tasks) && e.tasks.includes(id))
/** A readable dump for a failed assertion. */
const shownLog = (log) => log
  .map((e, i) => i + ' ' + e.kind + ' ' + (e.label || JSON.stringify(e.tasks || []) || ''))
  .join(' | ')

// ── the canned worker's own two lines ───────────────────────────────────────
const openWorker = (runDir, label, extra = {}) =>
  appendLine(runDir, { kind: 'worker:start', label, ...extra })
const workerStart = (runDir, label, cwd) =>
  openWorker(runDir, label, { cwd, head: gitSync(['rev-parse', 'HEAD'], cwd) })
const workerEnd = (runDir, label, extra = {}) =>
  appendLine(runDir, { kind: 'worker:end', label, ...extra })
/** The canned referee, enveloped. */
const cannedReview = (runDir, label) => {
  openWorker(runDir, label)
  const reply = passReview()
  workerEnd(runDir, label)
  return reply
}
// The task shape every scenario uses: no proof paths, so the only workers
// dispatched are `impl:`, `review:` and — when the fold narrates — `resolve:`.
const taskOf = (id, over = {}) => ({
  id, title: 'task ' + id, files: [id + '.txt'], tier: 'standard', review: 'lean',
  writes: [id + '.txt'], commutes: [],
  testCmd: 'bash check.sh', proofTests: [], proofRuns: [],
  body: 'sim task ' + id,
  ...over,
})
/** The implementer every plain scenario cans: open, (hold), write, close. */
const plainImpl = (runDir, opts, cwd, id) => {
  fs.writeFileSync(path.join(cwd, id + '.txt'), 'from ' + id + '\n')
  const reply = doneImpl(cwd)
  workerEnd(runDir, opts.label)
  return reply
}
/** Rewrite the 1-based line `n` of `a.txt` in the worker's own clone, leaving
 *  every other line and the final newline as they were. */
const rewriteLine = (cwd, n, text) => {
  const file = path.join(cwd, 'a.txt')
  const lines = fs.readFileSync(file, 'utf8').split('\n')
  lines[n - 1] = text
  fs.writeFileSync(file, lines.join('\n'))
}
/** A blob of the integration clone, byte for byte — `gitSync` trims, and every
 *  content assertion below is a full-equality one. */
const showBlob = (cwd, ref) =>
  execFileSync('git', ['show', ref], { cwd, env: ENV, encoding: 'utf8' })

// ── the exec seam, recording the kernel's argv ──────────────────────────────
// The fold is `exec('python3', [KERNEL, <verb>, …])`. This wrapper records each
// such call's WHOLE argv, so leg (a) can read the `--patch` specs the kernel
// was handed, per verb and per wave.
const KERNEL_VERBS = new Set(['fold', 'resolve', 'materialize', 'emit-weave'])
/** The value after each `--patch` in an argv, in order. */
const patchSpecsOf = (argv) => argv
  .map((a, i) => (a === '--patch' ? argv[i + 1] : null))
  .filter((a) => typeof a === 'string')
/** The value after `--wave`, as a number, or null. */
const waveOf = (argv) => {
  const i = argv.indexOf('--wave')
  return i === -1 ? null : Number(argv[i + 1])
}
function kernelSeam () {
  const calls = []
  const exec = async (cmd, argv, opts) => {
    const verb = (cmd === 'python3' && Array.isArray(argv) && KERNEL_VERBS.has(String(argv[1])))
      ? String(argv[1]) : null
    if (!verb) return execSeam(cmd, argv, opts)
    const flat = argv.map(String)
    calls.push({ verb, argv: flat, wave: waveOf(flat), patches: patchSpecsOf(flat) })
    return execSeam(cmd, argv, opts)
  }
  return { exec, calls }
}
/** A readable dump of the kernel calls, for a failed leg (a). */
const shownCalls = (calls) => JSON.stringify(
  calls.map((c) => ({ verb: c.verb, wave: c.wave, patches: c.patches })))

// ── one scenario ────────────────────────────────────────────────────────────
let seq = 0
async function drive ({ tag, tasks, edges = [], width, makeStub, repoFiles = {},
                        foldAgeMs = null, kata = undefined, kataRecord = undefined }) {
  seq += 1
  const stamp = 'sp' + seq + tag
  const repo = makeRepo(path.join(tmp, 'repo-' + stamp), repoFiles)
  const runDir = path.join(tmp, 'run-' + stamp)
  const seam = kernelSeam()
  const labels = []
  const stub = makeStub(runDir)
  const built = rig({
    repo, runDir, waves: [tasks], edges, stamp, exec: seam.exec,
    stub: (prompt, opts, cwd) => { labels.push(opts.label); return stub(prompt, opts, cwd) },
    ...(kata === undefined ? {} : { kata }),
    extraArgs: { width, infraBackoffMs: 0,
                 ...(foldAgeMs === null ? {} : { foldAgeMs }),
                 ...(kataRecord === undefined ? {} : { kataRecord }) },
  })
  const report = await built.run()
  return { tag, stamp, runDir, integ: built.integ, base: built.base,
           report, labels, calls: seam.calls, log: readEvents(runDir) }
}

// ── the run every leg but (e) and (g) is read off ────────────────────────────
// A, B and C in ONE plan wave with the one edge A -> C, width 2. A and B are
// the ready pair; C is not ready until A has been ADOPTED. `impl:A` is held
// until B's adoption is on the log, which is what makes the question askable at
// all: B's whole epoch — fold, candidate, suite, adopt — has to happen while A
// is still in flight, so that A's patch is captured against the RUN BASE and
// folded onto a head that has moved past it.
//
// `aLine`/`bLine` are the lines of the seeded `a.txt` each rewrites; `resolver`
// is the canned reply for the one narrated hunk, or null for a run that must
// dispatch no resolver at all.
const staleRun = ({ tag, seed, bLine, bText, aLine, aText, resolver,
                    kata, kataRecord }) => drive({
  tag,
  tasks: [taskOf('A', { files: ['a.txt'], writes: ['a.txt'] }),
          taskOf('B', { files: ['a.txt'], writes: ['a.txt'] }),
          taskOf('C')],
  edges: [['A', 'C']],
  width: 2,
  // Every landing folds at its own instant, which is the reading M4 names.
  foldAgeMs: 0,
  ...(seed === undefined ? {} : { repoFiles: { 'a.txt': seed } }),
  kata,
  kataRecord,
  makeStub: (runDir) => async (prompt, opts, cwd) => {
    const [kind, id] = String(opts.label).split(':')
    if (kind === 'review') return cannedReview(runDir, opts.label)
    if (kind === 'resolve') {
      if (!resolver) throw new Error('unexpected resolver dispatch: ' + opts.label)
      openWorker(runDir, opts.label)
      workerEnd(runDir, opts.label)
      return resolver
    }
    if (kind !== 'impl') throw new Error('unexpected dispatch: ' + opts.label)
    workerStart(runDir, opts.label, cwd)
    if (id === 'A') {
      // Held until B has been adopted: A's clone, and so A's captured patch,
      // is anchored at the run BASE while the branch has moved to B's head.
      await waitUntil(() => namingTask(adoptionsOf(readEvents(runDir)), 'B') !== undefined)
      rewriteLine(cwd, aLine, aText)
    } else if (id === 'B') {
      // Held only until A is open, so "both were in flight" is a fact about the
      // scheduler and not about which stub won a race.
      await waitUntil(() => readEvents(runDir).some((e) => isStart(e, 'impl:A')), OVERLAP_MS)
      rewriteLine(cwd, bLine, bText)
    } else {
      fs.writeFileSync(path.join(cwd, id + '.txt'), 'from ' + id + '\n')
    }
    const reply = doneImpl(cwd)
    workerEnd(runDir, opts.label)
    return reply
  },
})

// The resolver's two canned replies, in `RESOLVER_SCHEMA`'s own shape: the one
// narrated hunk of the overlapping fold is `h1`, and the resolution keeps both
// tasks' lines, A's first.
const RESOLVED_REPLY = { status: 'RESOLVED', hunks: [{ id: 'h1', content: 'A2\nB2\n' }], notes: '' }
const BLOCKED_REPLY = { status: 'BLOCKED', hunks: [], notes: 'cannot' }

// ════════════════════════════════════════════════════════════════════════════
// legs (a) and (b) — the anchor on the argv [M1], and the `resolved` reading
// [M2, M4]
//
// A and B both rewrite line 2 of the seeded `a.txt`. B lands and adopts first;
// A's patch is captured against the run BASE and folded onto B's head, where
// its edit meets B's — one narrated conflict, one resolver dispatch, one
// adoption.
// ════════════════════════════════════════════════════════════════════════════
{
  const run = await staleRun({
    tag: 'resolved', bLine: 2, bText: 'B2', aLine: 2, aText: 'A2',
    resolver: RESOLVED_REPLY,
  })
  const log = run.log
  const calls = run.calls

  // ── leg (a) [M1] — what the kernel was handed ─────────────────────────────
  const atWave = (n, verb) => calls.filter((c) => c.wave === n && c.verb === verb)
  const fold1 = atWave(1, 'fold')
  assert.equal(fold1.length, 1,
    '(a)/M1: sim precondition — the first epoch folds once: ' + shownCalls(calls))
  assert.equal(fold1[0].patches.length, 1,
    '(a)/M1: the first epoch folds B alone: ' + shownCalls(calls))
  assert.ok(/^B=/.test(fold1[0].patches[0]) && !fold1[0].patches[0].includes('@'),
    '(a)/M1: B was dispatched at the run base and the first epoch folds onto that same base, ' +
    'so its `--patch` carries NO `@<anchor>` — the anchor is an addition to the stale-patch ' +
    'path, never a rewrite of the same-anchor one: ' + JSON.stringify(fold1[0].patches))

  const fold2 = atWave(2, 'fold')
  const resolve2 = atWave(2, 'resolve')
  const mat2 = atWave(2, 'materialize')
  const anchored = new RegExp('^A=.+@' + run.base + '$')
  assert.equal(fold2.length, 1,
    '(a)/M1: sim precondition — the second epoch folds once: ' + shownCalls(calls))
  assert.equal(fold2[0].patches.length, 1,
    '(a)/M1: the second epoch folds A alone: ' + shownCalls(calls))
  assert.match(fold2[0].patches[0], anchored,
    '(a)/M1: the second epoch\'s `fold` carries `--patch A=<file>@' + run.base + '` — A\'s ' +
    'capture anchor (`anchorOf.get("A")`, the run base it was dispatched at) differs from the ' +
    'epoch\'s `prevHead` (B\'s adopted head), so the engine hands the kernel that anchor: ' +
    JSON.stringify(fold2[0].patches))
  assert.ok(resolve2.length >= 1,
    '(a)/M1, (b)/M4: the second epoch narrates a conflict and drives `resolve`: ' +
    shownCalls(calls))
  for (const c of resolve2) {
    assert.equal(c.patches.length, 1,
      '(a)/M1: every `resolve` of the second epoch carries A\'s one patch: ' + shownCalls(calls))
    assert.match(c.patches[0], anchored,
      '(a)/M1: every `resolve` of the second epoch carries the SAME anchored spec its `fold` ' +
      'did — `--patch A=<file>@' + run.base + '`: ' + JSON.stringify(c.patches))
  }
  assert.equal(mat2.length, 1,
    '(a)/M1: sim precondition — the second epoch materializes once: ' + shownCalls(calls))
  assert.match(mat2[0].patches[0], anchored,
    '(a)/M1: and so does its `materialize` — `--patch A=<file>@' + run.base + '`: ' +
    JSON.stringify(mat2[0].patches))

  // ── leg (b) [M2, M4] — the three adoptions and what each says ─────────────
  const adoptions = adoptionsOf(log)
  assert.deepEqual(adoptions.map((e) => e.tasks), [['B'], ['A'], ['C']],
    '(b)/M4: the run ends with A, B and C all adopted, in that fold order — B alone (A still in ' +
    'flight), then A alone onto B\'s head, then C alone onto A\'s: ' + shownLog(log))
  assert.deepEqual(adoptions[0].applied, { B: 'base' },
    '(b)/M2: B\'s anchor IS its epoch\'s `prevHead` (both the run base), so the first adoption ' +
    'reads `base`: ' + JSON.stringify(adoptions[0]))
  assert.deepEqual(adoptions[1].applied, { A: 'resolved' },
    '(b)/M2: A\'s anchor is older than its epoch\'s `prevHead` AND a narrated conflict of that ' +
    'epoch named `a.txt`, one of A\'s files, which the resolver then resolved — so the second ' +
    'adoption reads `resolved`: ' + JSON.stringify(adoptions[1]))
  assert.deepEqual(adoptions[2].applied, { C: 'base' },
    '(b)/M2: C was dispatched on A\'s adopted head and folds onto it, so the third adoption ' +
    'reads `base`: ' + JSON.stringify(adoptions[2]))

  const resolverLabels = run.labels.filter((l) => String(l).startsWith('resolve:'))
  assert.deepEqual(resolverLabels, ['resolve:wave2:1:1'],
    '(b)/M4: exactly one resolver is dispatched, for conflict 1 of epoch 2 on its first attempt ' +
    '— `resolve:wave2:1:1`: ' + JSON.stringify(run.labels))

  assert.equal(showBlob(run.integ, adoptions[1].headSha + ':a.txt'), 'line1\nA2\nB2\nline3\n',
    '(b)/M4: the second adoption\'s head carries the resolver\'s answer to the one narrated ' +
    'hunk — A\'s line then B\'s, between the untouched `line1` and `line3`')
  assert.deepEqual(run.report.tasks.map((r) => [r.task, r.status]).sort(),
    [['A', 'done'], ['B', 'done'], ['C', 'done']],
    '(b)/M4: sim precondition — all three tasks finish: ' +
    JSON.stringify(run.report.tasks.map((r) => ({ task: r.task, status: r.status }))))
}

// ════════════════════════════════════════════════════════════════════════════
// leg (c) — the `rebased` reading [M2, M4]
//
// The same run, with B's and A's edits NOT meeting: five seeded lines, B on
// line 2 and A on line 4. A's patch is still captured against the run BASE and
// still folded onto a head that has moved past it — the unanchored apply would
// still refuse — but the anchored three-way narrates nothing, so no resolver is
// dispatched and the epoch reads `rebased`.
//
// (See THE NOTE ON LEG (c) at the head of this file for why this is the seed
// rather than M4's literal "A rewriting line 3".)
// ════════════════════════════════════════════════════════════════════════════
{
  const run = await staleRun({
    tag: 'rebased', seed: 'line1\nline2\nline3\nline4\nline5\n',
    bLine: 2, bText: 'B2', aLine: 4, aText: 'A4',
    resolver: null,
  })
  const log = run.log
  const adoptions = adoptionsOf(log)
  assert.deepEqual(adoptions.map((e) => e.tasks), [['B'], ['A'], ['C']],
    '(c)/M4: sim precondition — the run ends with A, B and C all adopted, in that fold order: ' +
    shownLog(log))
  assert.deepEqual(adoptions[0].applied, { B: 'base' },
    '(c)/M2: the first adoption of this run reads `base` too — B\'s anchor is its epoch\'s ' +
    '`prevHead`: ' + JSON.stringify(adoptions[0]))
  assert.deepEqual(adoptions[1].applied, { A: 'rebased' },
    '(c)/M2: A\'s anchor is older than its epoch\'s `prevHead` and NO narrated conflict of that ' +
    'epoch named a path of A — the fold narrated none at all — so the second adoption reads ' +
    '`rebased`: ' + JSON.stringify(adoptions[1]))
  assert.deepEqual(run.labels.filter((l) => String(l).startsWith('resolve:')), [],
    '(c)/M4: a fold that narrates nothing dispatches no resolver: ' + JSON.stringify(run.labels))
  assert.equal(showBlob(run.integ, adoptions[1].headSha + ':a.txt'),
    'line1\nB2\nline3\nA4\nline5\n',
    '(c)/M4: the second adoption\'s head carries BOTH lines — B\'s on line 2 from the epoch ' +
    'before it, A\'s on line 4 from the patch rebased over its own anchor')
}

// ════════════════════════════════════════════════════════════════════════════
// leg (d) — the blocked epoch [M3, M5]
//
// The overlapping run again, with a resolver that answers `BLOCKED`. The fold
// returns `CONFLICT`, which at BASE appends nothing at all: M3 makes it a
// blocked row like any other, carrying the epoch's `applied`, and marks its
// tasks blocked on the hub exactly as a `TEST_FAILED` epoch does.
//
// The hub is the injected fake below — the client's method names over an
// in-memory store, every call recorded in order. `kataMark` is `addLabel` +
// `patchMetadata` + `comment` on the task's issue, and its `work.attention_msg`
// is `attentionMsg(status, verdict)`, so A's `status: 'blocked'` mark is
// readable from the recorded patch verbatim.
// ════════════════════════════════════════════════════════════════════════════
{
  const PROJECT_ID = 7
  const UID = { A: 'U-A', B: 'U-B', C: 'U-C' }
  const store = new Map([
    ['RUN0', { revision: 1, metadata: {}, labels: [], status: 'open', owner: null }],
    ['U-A', { revision: 1, metadata: {}, labels: [], status: 'open', owner: null }],
    ['U-B', { revision: 1, metadata: {}, labels: [], status: 'open', owner: null }],
    ['U-C', { revision: 1, metadata: {}, labels: [], status: 'open', owner: null }],
  ])
  const shortOf = { RUN0: 'run9', 'U-A': 'aa11', 'U-B': 'bb22', 'U-C': 'cc33' }
  const calls = []
  const need = (uid) => {
    const iss = store.get(uid)
    if (!iss) throw new Error('fake kata: no issue ' + JSON.stringify(uid))
    return iss
  }
  const record = (method, uid, fields, answer) => { calls.push({ method, uid, ...fields }); return answer }
  const kata = {
    async getIssue (uid) {
      const iss = need(uid)
      return record('getIssue', uid, {}, {
        uid, revision: iss.revision, short_id: shortOf[uid], metadata: iss.metadata,
        status: iss.status, owner: iss.owner, project_id: PROJECT_ID,
      })
    },
    async claim (project, uid) {
      const iss = need(uid); iss.owner = 'engine'; iss.revision += 1
      return record('claim', uid, {}, { uid, revision: iss.revision, short_id: shortOf[uid] })
    },
    async patchMetadata (project, uid, patch, revision) {
      const iss = need(uid); iss.metadata = { ...iss.metadata, ...patch }; iss.revision += 1
      return record('patchMetadata', uid, { patch }, { uid, revision: iss.revision, short_id: shortOf[uid] })
    },
    async comment (project, uid, body) {
      const iss = need(uid); iss.revision += 1
      return record('comment', uid, { body }, { uid, revision: iss.revision })
    },
    async addLabel (project, uid, label) {
      const iss = need(uid); iss.labels.push(label); iss.revision += 1
      return record('addLabel', uid, { label }, { uid, revision: iss.revision })
    },
    async close (project, uid, opts) {
      const iss = need(uid); iss.status = 'closed'; iss.revision += 1
      return record('close', uid, { opts }, { uid, revision: iss.revision })
    },
  }
  const kataRecord = {
    url: 'https://kata.int.exe.xyz',
    project: { id: PROJECT_ID, uid: 'PROJ0', name: 'ultrapowers' },
    run: { uid: 'RUN0', revision: 1 },
    tasks: { A: { uid: UID.A, short_id: shortOf[UID.A], revision: 1 },
             B: { uid: UID.B, short_id: shortOf[UID.B], revision: 1 },
             C: { uid: UID.C, short_id: shortOf[UID.C], revision: 1 } },
  }

  const run = await staleRun({
    tag: 'blocked', bLine: 2, bText: 'B2', aLine: 2, aText: 'A2',
    resolver: BLOCKED_REPLY, kata, kataRecord,
  })
  const log = run.log

  // The detail the park carries, spelled the way `resolveConflicts` spells it:
  // the reason for a BLOCKED reply is `resolver reported <status> on <path>`,
  // and `blocked()` puts it on the row and the event verbatim.
  const DETAIL = 'resolver reported BLOCKED on a.txt'

  const blocks = blocksOf(log)
  assert.equal(blocks.length, 1,
    '(d)/M3: an epoch whose fold returns `CONFLICT` appends `driver:wave-blocked` like any other ' +
    'red epoch — at BASE a CONFLICT falls through to the blocked-wave bookkeeping with NO event ' +
    'at all, and this is the assertion that says the event exists: ' + shownLog(log))
  const blockedEvent = blocks[0]
  assert.equal(blockedEvent.wave, 2,
    '(d)/M3: the blocked row names the epoch that folded — the second: ' +
    JSON.stringify(blockedEvent))
  assert.deepEqual(blockedEvent.tasks, ['A'],
    '(d)/M3: and exactly that epoch\'s tasks, in plan order — A alone: ' +
    JSON.stringify(blockedEvent))
  assert.equal(blockedEvent.detail, DETAIL,
    '(d)/M5: its `detail` is the `waveMerges` row\'s own, verbatim — the resolver\'s BLOCKED ' +
    'reply on the narrated path: ' + JSON.stringify(blockedEvent))
  assert.ok(String(blockedEvent.detail).startsWith('resolver reported BLOCKED'),
    '(d)/M5: `detail` begins `resolver reported BLOCKED`: ' + JSON.stringify(blockedEvent))
  assert.deepEqual(blockedEvent.applied, { A: 'resolved' },
    '(d)/M2, M5: the blocked row carries the same `applied` an adoption would — A\'s anchor is ' +
    'older and a narrated conflict of the epoch named `a.txt`, one of A\'s files, so it reads ' +
    '`resolved`: the narrated conflict named A\'s path, and the event\'s `detail` is what became ' +
    'of it: ' + JSON.stringify(blockedEvent))
  assert.ok(['released', 'end', 'aged'].includes(blockedEvent.why),
    '(d)/M3: and the trigger reading every epoch event owes — one of `released`, `end`, `aged`: ' +
    JSON.stringify(blockedEvent))

  // The hub mark: `kataMark(t.id, { status: 'blocked', … })` per task of the
  // epoch, exactly as the `TEST_FAILED` guard does it.
  const forA = calls.filter((c) => c.uid === UID.A)
  const marks = forA.filter((c) => c.method === 'patchMetadata' &&
    c.patch && typeof c.patch['work.attention_msg'] === 'string' &&
    c.patch['work.attention_msg'].startsWith('blocked: '))
  assert.equal(marks.length, 1,
    '(d)/M3: the epoch marks A blocked on the hub exactly as a TEST_FAILED epoch does — one ' +
    '`patchMetadata` carrying the `blocked` status mark: ' + JSON.stringify(forA))
  assert.deepEqual(marks[0].patch,
    { 'work.attention': 'needs-human',
      'work.attention_msg': 'blocked: wave 2 blocked: ' + DETAIL },
    '(d)/M3: and the mark is the blocked one `kataMark` writes — `needs-human`, with ' +
    '`attentionMsg(\'blocked\', \'wave 2 blocked: \' + detail)` as its message: ' +
    JSON.stringify(marks[0]))
  assert.ok(forA.some((c) => c.method === 'addLabel' && c.label === 'needs-review'),
    '(d)/M3: work the driver could not fold is a question for someone — A\'s issue is labelled ' +
    '`needs-review` beside the mark: ' + JSON.stringify(forA))
  assert.ok(!forA.some((c) => c.method === 'close'),
    '(d)/M3: and it is left OPEN — a blocked epoch marks its tasks, it does not close them: ' +
    JSON.stringify(forA))

  // A landed in no head, so the branch is where B's epoch left it and the run
  // adopted B alone.
  assert.deepEqual(adoptionsOf(log).map((e) => e.tasks), [['B']],
    '(d)/M3: sim precondition — the blocked epoch adopted nothing, so B\'s is the run\'s one ' +
    'adoption and C, which an edge points at A from, never became ready: ' + shownLog(log))
}

// ════════════════════════════════════════════════════════════════════════════
// leg (e) — the contract's evidence bullet [M6]
//
// The region the fourth `Run:` line takes — from the line opening "The engine's
// own wave record" through the line opening "The driver's own executions" —
// joined into one line, and the same ordered words.
// ════════════════════════════════════════════════════════════════════════════
{
  const contract = fs.readFileSync(fileURLToPath(new URL('../CONTRACT.md', import.meta.url)), 'utf8')
  const lines = contract.split('\n')
  const from = lines.findIndex((l) => /^ {4}The engine.s own wave record/.test(l))
  assert.ok(from !== -1,
    '(e)/M6: sim precondition — fleet/CONTRACT.md still has the evidence bullet that opens ' +
    '"The engine\'s own wave record"')
  let to = lines.slice(from + 1).findIndex((l) => /^ {4}The driver.s own executions/.test(l))
  to = to === -1 ? lines.length - 1 : from + 1 + to
  const bullet = lines.slice(from, to + 1).join(' ')

  // The `Run:` line's own regex, word for word and in its order.
  assert.match(bullet,
    /epoch[\s\S]*ready[\s\S]*slot frees[\s\S]*release[\s\S]*end[\s\S]*aged[\s\S]*foldAgeMs[\s\S]*60[\s\S]*driver:wave-adopted[\s\S]*applied[\s\S]*base[\s\S]*rebased[\s\S]*resolved[\s\S]*descendant[\s\S]*driver:wave-blocked[\s\S]*CONFLICT/,
    '(e)/M6: the evidence bullet\'s `driver:wave-adopted` sentence names `applied` with its ' +
    'three values `base`, `rebased` and `resolved`, and its `driver:wave-blocked` clause says a ' +
    '`CONFLICT` epoch emits it too — so the region carries, in this order: `epoch`, `ready`, ' +
    '`slot frees`, `release`, `end`, `aged`, `foldAgeMs`, `60`, `driver:wave-adopted`, ' +
    '`applied`, `base`, `rebased`, `resolved`, `descendant`, `driver:wave-blocked`, ' +
    '`CONFLICT`:\n' + JSON.stringify(bullet))
  // And the key and its three values spelled as the record spells them, so the
  // ordered words cannot be answered by three bare English words that happen to
  // fall in that order.
  for (const word of ['`applied`', '`base`', '`rebased`', '`resolved`']) {
    assert.ok(bullet.includes(word),
      '(e)/M6: the bullet names ' + word + ' as the record spells it — `applied` and each of ' +
      'its three values, with their meanings:\n' + JSON.stringify(bullet))
  }
}

// ════════════════════════════════════════════════════════════════════════════
// leg (g) — the anchor is read at fold time [M1]
//
// The fifth `Run:` line, with that line's own semantics: `anchorOf.get(` at
// more than one site of `fleet/run-engine.mjs` — the one at BASE, where a
// dispatch's capture reads its anchor, and the fold's.
// ════════════════════════════════════════════════════════════════════════════
{
  const engine = fs.readFileSync(fileURLToPath(new URL('../run-engine.mjs', import.meta.url)), 'utf8')
  const sites = engine.split('\n')
    .map((line, i) => ({ n: i + 1, line }))
    .filter(({ line }) => line.includes('anchorOf.get('))
  assert.ok(sites.length >= 2,
    '(g)/M1: `anchorOf.get(` is read at more than one site of fleet/run-engine.mjs — the one ' +
    'at BASE, where a dispatch\'s own capture reads the head it went out on, and the fold\'s, ' +
    'where `foldWave` reads each result\'s anchor to put on the kernel\'s `--patch`. Sites ' +
    'found: ' + JSON.stringify(sites.map(({ n, line }) => n + ': ' + line.trim().slice(0, 100))))
}

// ════════════════════════════════════════════════════════════════════════════
// TASK 2 — "A fold conflict leaves a receipt" — leg (a) [M1]
//
// M1, restated: `receiptPaths(list)`, exported from `fleet/run-engine.mjs`,
// returns the distinct strings of `list` in lexical order; and a
// `driver:wave-blocked` event whose fold ended `CONFLICT` carries `paths` —
// `receiptPaths` over the `path` of every row of that epoch's `conflicts.json`
// — and `evidence` `{ read, against }`, where `read` is the row's own `detail`
// and `against` is `epoch <n> onto <sha>` with the 40-hex head the fold was
// made onto. (A `driver:wave-blocked` whose fold ended `TEST_FAILED` carries
// neither key — the other half of M1, graded by leg (b) in the ready-set sim,
// which is where that rig's parked run lives.)
//
// Leg (a) is answered in two halves below.
//
// The FIRST half is the pure export: the sort-and-dedupe rule itself, pinned
// once, `['z.txt', 'a.txt', 'a.txt', 'm/x.txt']` -> `['a.txt', 'm/x.txt',
// 'z.txt']` and `[]` -> `[]`, both by full equality.
//
// The SECOND half is the BLOCKED-resolver run of this rig: B is adopted first
// and A's fold onto B's head is the epoch that stops. That is the same shape
// leg (d) above drives, but leg (d)'s `run` is block-scoped, so the run is
// driven again here rather than reached for — this file's own idiom, and it
// keeps this block independent of anything above it.
//
// `receiptPaths` is reached through `await import(…)` rather than a top-level
// named import on purpose: at BASE the export is absent, and a named import of
// an absent export is an ESM LINK error, which would kill this whole file
// before legs (a) through (g) could report. The namespace form lets this block
// fail as "the export is not there yet" and leaves every other leg readable.
// ════════════════════════════════════════════════════════════════════════════
{
  const engineModule = await import('../run-engine.mjs')
  const receiptPaths = engineModule.receiptPaths

  assert.equal(typeof receiptPaths, 'function',
    '(a)/M1: `receiptPaths` is exported from fleet/run-engine.mjs — the sort-and-dedupe rule ' +
    'pinned once, where the wave loop uses it. At BASE there is no such export, and this is ' +
    'the assertion that says so. Exported names beginning `receipt`: ' +
    JSON.stringify(Object.keys(engineModule).filter((k) => k.toLowerCase().includes('receipt'))))

  assert.deepEqual(receiptPaths(['z.txt', 'a.txt', 'a.txt', 'm/x.txt']),
    ['a.txt', 'm/x.txt', 'z.txt'],
    '(a)/M1: `receiptPaths(list)` returns the DISTINCT strings of `list` in LEXICAL order — ' +
    'the duplicate `a.txt` appears once and the input order is not kept. Got: ' +
    JSON.stringify(receiptPaths(['z.txt', 'a.txt', 'a.txt', 'm/x.txt'])))

  assert.deepEqual(receiptPaths([]), [],
    '(a)/M1: and the empty list is the empty list: ' + JSON.stringify(receiptPaths([])))

  // The BLOCKED-resolver run: A and B both rewrite line 2 of the seeded
  // `a.txt`, B adopts first, and A's fold onto B's head narrates the one
  // conflict the canned resolver answers BLOCKED.
  const run = await staleRun({
    tag: 'receipt', bLine: 2, bText: 'B2', aLine: 2, aText: 'A2',
    resolver: BLOCKED_REPLY,
  })
  const log = run.log

  const blocks = blocksOf(log)
  assert.equal(blocks.length, 1,
    '(a)/M1: sim precondition — the BLOCKED-resolver run ends in exactly one ' +
    '`driver:wave-blocked` row, the epoch whose fold stopped on the conflict nobody resolved: ' +
    shownLog(log))
  const row = blocks[0]

  const adoptions = adoptionsOf(log)
  assert.equal(adoptions.length, 1,
    '(a)/M1: sim precondition — and exactly one `driver:wave-adopted` row, B\'s, whose head is ' +
    'the head A\'s fold was made onto: ' + shownLog(log))
  const onto = adoptions[0].headSha
  assert.match(String(onto), /^[0-9a-f]{40}$/,
    '(a)/M1: sim precondition — that adoption names a 40-hex head: ' +
    JSON.stringify(adoptions[0]))
  assert.notEqual(onto, run.base,
    '(a)/M1: sim precondition — and it is NOT the run\'s BASE sha (' + String(run.base) + '), ' +
    'which is the whole point of this rig: A\'s patch was captured at BASE and folded onto the ' +
    'head B\'s epoch left. `against` naming BASE and `against` naming this head are different ' +
    'strings, so the assertion below can tell them apart.')

  assert.deepEqual(row.paths, ['a.txt'],
    '(a)/M1: the `CONFLICT` epoch\'s blocked row carries `paths` — `receiptPaths` over the ' +
    '`path` of every row of that epoch\'s `conflicts.json`, which narrated the one path ' +
    '`a.txt`. At BASE the row carries no `paths` key at all. Row: ' + JSON.stringify(row))

  assert.equal(row.detail, 'resolver reported BLOCKED on a.txt',
    '(a)/M1: sim precondition — the row\'s `detail` is the resolver\'s BLOCKED reply on the ' +
    'narrated path, verbatim: ' + JSON.stringify(row))
  assert.ok(row.evidence && typeof row.evidence === 'object',
    '(a)/M1: and it carries `evidence`, the `{ read, against }` reading a receipt is: ' +
    JSON.stringify(row))
  assert.equal(row.evidence.read, row.detail,
    '(a)/M1: `evidence.read` is the row\'s own `detail` — a receipt states what was OBSERVED, ' +
    'and what was observed is what the fold reported: ' + JSON.stringify(row))
  assert.equal(row.evidence.against, 'epoch ' + row.wave + ' onto ' + onto,
    '(a)/M1: and `evidence.against` is exactly `epoch <that row\'s wave> onto <the headSha of ' +
    'the run\'s one driver:wave-adopted row>` — what the fold was folding ONTO. A value ' +
    'carrying the run\'s BASE sha (' + String(run.base) + '), or another epoch number, fails ' +
    'this leg. Row: ' + JSON.stringify(row))
}

// Task 1 of the receipts plan — "a red exam and a resolver miss leave a
// receipt" (kata popmechanic-ultrapowers#d56q).
//
// The Machine clause these legs grade, restated:
//   M2 — `resolveConflicts` is called from the wave loop with
//        `onEvent: appendEvent`, so each resolver dispatch of a wave fold
//        appends one `resolver:reply` event `{label, conflict, attempt,
//        status}`; a row whose `status` is not `RESOLVED` also carries `paths`
//        `[<the conflicted path>]` and `evidence` whose `read` begins with that
//        status and whose `against` names the conflict's hunks file; a row whose
//        `status` is `RESOLVED` carries neither key.
//
// The Proof legs answered here:
//   (c) [M2] the BLOCKED-resolver run of this rig: exactly one `resolver:reply`
//       on the log, `label` `resolve:wave2:1:1`, `status` `BLOCKED`, `paths`
//       exactly `['a.txt']`, `evidence.read` beginning `BLOCKED`,
//       `evidence.against` ending in the basename of the conflict's hunks file.
//   (d) [M2] the RESOLVED run of the same rig: exactly one `resolver:reply`,
//       `status` `RESOLVED`, with no `paths` key and no `evidence` key.
//
// At BASE the wave loop passes no `onEvent`, so `resolveConflicts` emits
// nothing and both legs fail on the count of the rows themselves.
//
// The rig is the overlapping run legs (a), (b) and (d) above drive — A and B
// both rewriting line 2 of the seeded `a.txt`, `impl:A` held until B has
// adopted — with one addition: the resolver's own brief is KEPT, because it is
// where the conflict's hunks file is named (`resolveConflicts` writes
// `HUNKS FILE: <path>` into every dispatch), and leg (c) reads that basename
// off the brief rather than guessing at the kernel's layout.
const receiptRun = async ({ tag, resolver }) => {
  const seen = { prompt: null }
  const run = await drive({
    tag,
    tasks: [taskOf('A', { files: ['a.txt'], writes: ['a.txt'] }),
            taskOf('B', { files: ['a.txt'], writes: ['a.txt'] }),
            taskOf('C')],
    edges: [['A', 'C']],
    width: 2,
    foldAgeMs: 0,
    makeStub: (runDir) => async (prompt, opts, cwd) => {
      const [kind, id] = String(opts.label).split(':')
      if (kind === 'review') return cannedReview(runDir, opts.label)
      if (kind === 'resolve') {
        seen.prompt = String(prompt)
        openWorker(runDir, opts.label)
        workerEnd(runDir, opts.label)
        return resolver
      }
      if (kind !== 'impl') throw new Error('unexpected dispatch: ' + opts.label)
      workerStart(runDir, opts.label, cwd)
      if (id === 'A') {
        await waitUntil(() => namingTask(adoptionsOf(readEvents(runDir)), 'B') !== undefined)
        rewriteLine(cwd, 2, 'A2')
      } else if (id === 'B') {
        await waitUntil(() => readEvents(runDir).some((e) => isStart(e, 'impl:A')), OVERLAP_MS)
        rewriteLine(cwd, 2, 'B2')
      } else {
        fs.writeFileSync(path.join(cwd, id + '.txt'), 'from ' + id + '\n')
      }
      const reply = doneImpl(cwd)
      workerEnd(runDir, opts.label)
      return reply
    },
  })
  return { ...run, seen }
}
const repliesOf = (log) => log.filter((e) => e.kind === 'resolver:reply')

// ── leg (c) [M2]: the BLOCKED reply's row is a receipt ──────────────────────
{
  const run = await receiptRun({ tag: 'receipt-blocked', resolver: BLOCKED_REPLY })
  assert.deepEqual(run.labels.filter((l) => String(l).startsWith('resolve:')),
    ['resolve:wave2:1:1'],
    '(c)/M2: sim precondition — the second epoch narrates one conflict and dispatches one ' +
    'resolver: ' + JSON.stringify(run.labels))

  const replies = repliesOf(run.log)
  assert.equal(replies.length, 1,
    '(c)/M2: exactly ONE `resolver:reply` event on the run\'s own log — the wave loop calls ' +
    '`resolveConflicts` with `onEvent: appendEvent`, so each resolver dispatch of a wave fold ' +
    'appends its row; at BASE the wave loop passes no `onEvent` and the log carries none: ' +
    shownLog(run.log))
  const reply = replies[0]
  assert.equal(reply.label, 'resolve:wave2:1:1',
    '(c)/M2: the row names the dispatch it reports — conflict 1 of epoch 2, first attempt: ' +
    JSON.stringify(reply))
  assert.equal(reply.conflict, 1, '(c)/M2: its `conflict`: ' + JSON.stringify(reply))
  assert.equal(reply.attempt, 1, '(c)/M2: its `attempt`: ' + JSON.stringify(reply))
  assert.equal(reply.status, 'BLOCKED',
    '(c)/M2: and the status the resolver answered: ' + JSON.stringify(reply))

  assert.deepEqual(reply.paths, ['a.txt'],
    '(c)/M2: a row whose status is not `RESOLVED` carries `paths` — exactly the conflicted ' +
    'path, which file the miss was about: ' + JSON.stringify(reply))
  assert.ok(reply.evidence && typeof reply.evidence.read === 'string' &&
            typeof reply.evidence.against === 'string',
    '(c)/M2: and an `evidence` object of two strings: ' + JSON.stringify(reply))
  assert.ok(reply.evidence.read.startsWith('BLOCKED'),
    '(c)/M2: whose `read` begins with that status — what the driver read: ' +
    JSON.stringify(reply.evidence.read))

  // The hunks file, off the brief the resolver was actually handed.
  const m = /HUNKS FILE: (\S+)/.exec(String(run.seen.prompt || ''))
  assert.ok(m,
    '(c)/M2: sim precondition — the resolver\'s brief names its hunks file: ' +
    JSON.stringify(String(run.seen.prompt || '').slice(0, 400)))
  const hunksBase = path.basename(m[1])
  assert.ok(reply.evidence.against.endsWith(hunksBase),
    '(c)/M2: and whose `against` ends in the basename of the conflict\'s hunks file (`' +
    hunksBase + '`) — the thing the reading was made against: ' +
    JSON.stringify(reply.evidence.against))
}

// ── leg (d) [M2]: a RESOLVED reply's row is not a receipt ───────────────────
{
  const run = await receiptRun({ tag: 'receipt-resolved', resolver: RESOLVED_REPLY })
  assert.deepEqual(run.labels.filter((l) => String(l).startsWith('resolve:')),
    ['resolve:wave2:1:1'],
    '(d)/M2: sim precondition — one resolver dispatch: ' + JSON.stringify(run.labels))

  const replies = repliesOf(run.log)
  assert.equal(replies.length, 1,
    '(d)/M2: exactly one `resolver:reply` event for the one dispatch — a resolved conflict is ' +
    'reported too, it simply carries no receipt: ' + shownLog(run.log))
  const reply = replies[0]
  assert.equal(reply.label, 'resolve:wave2:1:1', '(d)/M2: ' + JSON.stringify(reply))
  assert.equal(reply.status, 'RESOLVED', '(d)/M2: ' + JSON.stringify(reply))
  assert.equal('paths' in reply, false,
    '(d)/M2: a `RESOLVED` row carries no `paths` key — a receipt states what the driver could ' +
    'not settle, and this one settled: ' + JSON.stringify(reply))
  assert.equal('evidence' in reply, false,
    '(d)/M2: and no `evidence` key: ' + JSON.stringify(reply))
}
console.log('ALL TESTS PASSED')
