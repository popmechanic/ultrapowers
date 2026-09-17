/**
 * fleet/tests/test_run_engine_jev_tier.mjs — the exam for Task 2 of run-182:
 * *a `jev:tier` row beside every task's tier — at dispatch, and
 * `review_difficulty` over the patch at review dispatch*.
 *
 * This file is the Proof's `Test:` path and the run left it where the Proof
 * named it, so every relative import below is written for `fleet/tests/`.
 *
 * ── what each Machine clause asserts, restated ──────────────────────────────
 *   M1 — on each entry into `runTaskInner`, directly after `economics` is set,
 *        the driver calls `jevRow` once with `row`
 *        `{kind: 'jev:tier', task: task.id, at: 'dispatch', tierChosen:
 *        economics.tier}` — `economics.tier` being the MODEL name (`sonnet`
 *        for a `standard` task, `opus` for `most-capable`) and never the
 *        tier's own name — state `{task: {title, claim, proof, files,
 *        proofTests}}` and the three dispatch questions of the shared literal
 *        keyed `difficulty`, `lifecycle_or_concurrency`, `design_open`; on an
 *        answer ONE `{kind, task, at, tierChosen, answers}` row is appended,
 *        posted on the task's hub issue when a hub is on.
 *   M2 — in each review round, BEFORE the reviewer is dispatched, the driver
 *        calls `jevRow` once with `row` `{kind: 'jev:tier', task: task.id,
 *        at: 'review', round: iter, tierChosen: economics.tier}`, state
 *        `{task: {title, claim, files}, patch}` where `patch` is the TEXT of
 *        the captured patch file, and the two review questions of the shared
 *        literal keyed `review_difficulty`, `doc_or_prose_only`; on an answer
 *        one such row is appended, posted the same way.
 *   M3 — no `jev:tier` row is appended when `ask` resolves `null` or when the
 *        engine was handed no `jev`.
 *   M4 — for the same canned replies, a run with `jev` and a run without it
 *        dispatch the same worker labels in the same order with the same
 *        `model` option on every `impl:` and `review:` dispatch, and end with
 *        the same `tier`, `reviewVerdict` and `status` per task on the report.
 *
 * ── the legs, and where each is answered ────────────────────────────────────
 * Every assertion below names its leg and the clause it comes from, so a
 * reader can map this file back to the contract.
 *   (a) [M1] run A — the two-task run with `jev` and a hub on: exactly two
 *       `jev:tier` rows with `at` `dispatch`, one per task, each `tierChosen`
 *       `sonnet` and `answers` carrying exactly `difficulty`,
 *       `lifecycle_or_concurrency`, `design_open`; each such row precedes, by
 *       position in `events.jsonl`, that task's first `driver:proof-run` or,
 *       absent one, that task's first `at: 'review'` row; the recorded
 *       dispatch requests number two and carry the three questions and the
 *       state the clause spells; and each row's line, verbatim, is among
 *       `commentsOn(<that task's uid>)`.
 *   (b) [M2] run A again — exactly two `at: 'review'` rows, `round` `1`,
 *       `tierChosen` `sonnet`, `answers` exactly `review_difficulty` and
 *       `doc_or_prose_only`; two recorded review requests with the two
 *       questions, the `{patch, task}` state, and a `patch` carrying
 *       `diff --git a/<that task's file> b/<that task's file>`; each row's
 *       line among that task's comments.
 *   (c) [M3] run B — every request answered `500`: zero `jev:tier` rows, both
 *       tasks `done`. Run C — no `jev` at all: zero `jev:tier` rows. Run D —
 *       one `standard` task and one `most-capable` task: `sonnet` against
 *       `opus` on the two dispatch rows.
 *   (d) [M4] run A against run C — the same scenario with `jev` and without:
 *       the same sequence of dispatched `(label, opts.model)` pairs, and per
 *       task the same `tier`, `reviewVerdict` and `status` on the report.
 *
 * ── the rig ─────────────────────────────────────────────────────────────────
 * The shared engine rig (`rig`, `fakeHub`, `makeRepo` from
 * `_engine_helpers.mjs`), so everything below the agent seam is real: real git
 * repositories, real `cloneAtBase` clones, the real capture, the real fold
 * kernel through the real `execSeam`. The Jev client is the REAL
 * `makeJevClient` over an injected `fetchImpl` that records each request's
 * parsed body and answers `200` with one entry per question id it received —
 * so what the engine sent is read off the record, and no sim opens a socket.
 * The hub is `fakeHub`'s in-memory store plus the matching `kataRecord`
 * through `extraArgs`, its issue revisions equal to the record's.
 *
 * ── two readings this file is written on ────────────────────────────────────
 *   • THE PLAN'S SHAPE. The two tasks are one wave with the one dependency
 *     edge `A -> B`, not two concurrent tasks. Leg (d) pins "the same sequence
 *     of dispatched `(label, opts.model)` pairs" between a jev-on and a
 *     jev-off run; the engine flattens `waves` into one ready-set plan and the
 *     rig's `parallel` is `Promise.all`, so two CONCURRENT tasks interleave
 *     their dispatches differently once a task awaits `jev.ask` — and leg (d)
 *     would be red for a reason that is not the implementation. The edge makes
 *     the dispatch order a fact of the plan. Nothing in the task text fixes
 *     the wave layout: it asks for "a two-task plan (`A` and `B`)" yielding
 *     "two dispatch rows and two review rows", which this is.
 *   • THE QUESTION LITERALS. M1 and M2 name "the three dispatch questions of
 *     the shared literal" and "the two review questions of the shared
 *     literal", and the task spells all five verbatim. So beyond the legs'
 *     `type` and four-criteria-levels checks, each question object the engine
 *     sent is deep-equalled against the literal transcribed below. That is the
 *     clause's own words, not one implementation's shape.
 *   • Leg (a)'s ordering clause has two arms. This plan carries no `proofRuns`
 *     and no `proofTests`, so no `driver:proof-run` row exists and the live
 *     arm is "that task's first `jev:tier` row with `at` `review`" — asserted
 *     as such, with the `driver:proof-run` arm read first exactly as the leg
 *     words it.
 *
 * ── why this is red at BASE, for one reason ─────────────────────────────────
 * `fleet/run-engine.mjs` at BASE calls `jevRow` from no site at all: the seam
 * exists (#1107) and nothing rides it. So run A's `events.jsonl` holds zero
 * `jev:tier` rows where leg (a) wants two, and the fake `fetchImpl` records
 * zero requests where it wants two. Every import below resolves at BASE and
 * every fixture is built here, so the failure is the absent implementation and
 * nothing else.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { makeJevClient } from '../jev-client.mjs'
import { rig, makeRepo, fakeHub, passReview, doneImpl } from './_engine_helpers.mjs'

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'engine-jev-tier-')))
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }))

// ── the literals the clauses spell, spelled once ────────────────────────────
const KIND = 'jev:tier'
const PROJECT_ID = 11
const RUN_UID = 'RUN0'
const UID = { A: 'U-A', B: 'U-B' }
// The model names `TIER` carries — what `economics.tier` is, and what M1's
// `tierChosen` therefore has to be. Never `standard`/`most-capable`.
const SONNET = 'sonnet'
const OPUS = 'opus'
// One file per task, written by that task's own implementer, and the line the
// captured patch of that task must carry (leg (b)).
const FILE_OF = { A: 'tA.txt', B: 'tB.txt' }
const diffLineFor = (id) => 'diff --git a/' + FILE_OF[id] + ' b/' + FILE_OF[id]

// Task A's body: a `**Claim:**` line followed by a `Machine: M1.` line and,
// after the blank line, a `**Proof:**` line — so `claim` carries the Claim
// sentence and its `Machine:` restatement together and `proof` carries the
// Proof line's text. Task B's body carries neither marker, so both are ''.
const A_CLAIM_SENTENCE = 'do: dispatch task A; see: one jev:tier row beside its tier.'
const A_MACHINE_LINE = 'Machine: M1. the row is appended at dispatch.'
const A_PROOF_TEXT = 'Test: fleet/tests/sim_a.mjs — leg (a) the row is on the record.'
const A_BODY = [
  '**Claim:** ' + A_CLAIM_SENTENCE,
  A_MACHINE_LINE,
  '',
  '**Proof:** ' + A_PROOF_TEXT,
  '',
].join('\n')
const B_BODY = 'sim task B'

// ── the five questions, verbatim (M1, M2: "the shared literal") ─────────────
const CTX_D = '`task.claim` is a signed Claim followed by numbered Machine ' +
  'clauses (M1, M2, ...) that restate it mechanically. `task.proof` names a ' +
  'Test file, Legs (a), (b), ... each tagged with the clause it falsifies, ' +
  'and Run: shell lines that must exit 0.'
const CTX_R = 'A referee (an expensive model) is about to read `patch`, the ' +
  'diff a task produced, against `task` (its Claim and Files), and return ' +
  'findings. Judge the patch, not the task text.'

const DISPATCH_QUESTIONS = {
  difficulty: {
    type: 'score',
    instructions: {
      question: 'How hard is `task` to implement correctly inside its stated files, ' +
        'for a capable engineer with the codebase open?',
      context: CTX_D,
    },
    criteria: [
      { what: 'Routine: a local edit with an obvious shape',
        signals: ['one file', 'a literal or a doc sentence'] },
      { what: 'Moderate: a few files, one seam, the legs say exactly what to build' },
      { what: 'Hard: concurrency, ordering, a loop or lifecycle, several interacting files, ' +
        'or legs that constrain each other' },
      { what: 'Very hard: a design decision the task leaves open, or a behaviour that ' +
        'depends on state the excerpt does not show' },
    ],
  },
  lifecycle_or_concurrency: {
    type: 'noul',
    instructions: {
      question: 'Does implementing `task` involve ordering, retries, locks, async control ' +
        'flow, cleanup, or process lifecycle?',
      context: CTX_D,
    },
    criteria: { true: 'Yes', false: 'No' },
  },
  design_open: {
    type: 'noul',
    instructions: {
      question: 'Does `task` leave a design decision open that the implementer must make ' +
        'before its legs can pass?',
      context: CTX_D,
    },
    criteria: {
      true: 'A choice the text does not settle stands between the implementer and the legs',
      false: 'The text and legs settle every choice that matters',
    },
  },
}

const REVIEW_QUESTIONS = {
  review_difficulty: {
    type: 'score',
    instructions: { question: 'How hard is `patch` to review well?', context: CTX_R },
    criteria: [
      { what: 'Routine: docs, a literal, a renamed string, a test fixture; a skim settles it',
        signals: ['only .md or comments change', 'a constant'] },
      { what: 'Straightforward: one seam in one or two files, the intent is legible from the diff' },
      { what: 'Careful: several files interact, a loop or state machine changes, or a ' +
        "test's meaning changes" },
      { what: 'Expert: concurrency, ordering, error recovery, a protocol or persisted format, ' +
        'or code the diff alone cannot show is safe' },
    ],
  },
  doc_or_prose_only: {
    type: 'noul',
    instructions: {
      question: 'Does `patch` change only prose: markdown, comments, doc strings, role text?',
      context: CTX_R,
    },
    criteria: { true: 'No executable line changes', false: 'Code, tests, config or scripts change' },
  },
}

const DISPATCH_KEYS = Object.keys(DISPATCH_QUESTIONS).sort()          // design_open, difficulty, lifecycle_or_concurrency
const REVIEW_KEYS = Object.keys(REVIEW_QUESTIONS).sort()             // doc_or_prose_only, review_difficulty
// The keys `appendEvent` leaves on a row of its own, beside the clause's.
const STAMP_KEYS = ['id', 'ts']
const DISPATCH_ROW_KEYS = ['answers', 'at', 'kind', 'task', 'tierChosen'].concat(STAMP_KEYS).sort()
const REVIEW_ROW_KEYS = ['answers', 'at', 'kind', 'round', 'task', 'tierChosen'].concat(STAMP_KEYS).sort()

// ── reading a run back ──────────────────────────────────────────────────────
const linesOf = (runDir) => {
  const file = path.join(runDir, 'events.jsonl')
  if (!fs.existsSync(file)) return []
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
}
const parseLine = (l) => { try { return JSON.parse(l) } catch { return null } }
const fieldsOf = (e, keys) => {
  const out = {}
  for (const k of keys) out[k] = (e || {})[k]
  return out
}

// ── the Jev client, real, over a recording fetch ────────────────────────────
// One entry per question id received, shaped by that question's own `type` —
// so `answers` keys equal `questions` keys and nothing the engine did not ask
// for comes back. `mode` 'answers' replies 200; 'error' replies 500 on every
// request, which is the client's refusal lane and therefore `ask` → `null`.
const scoreAnswer = () =>
  ({ type: 'score', score: 1.2, legend: {}, probabilities: {}, confidence: 0.8 })
const noulAnswer = () => ({ type: 'noul', noul: 0.5 })

function recordingJev ({ mode = 'answers' } = {}) {
  const requests = []
  const logs = []
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(String((options || {}).body || '{}'))
    requests.push({ url: String(url), state: body.state, questions: body.questions, model: body.model })
    if (mode === 'error') {
      return { status: 500, text: async () => 'upstream said no' }
    }
    const answers = {}
    for (const [id, q] of Object.entries(body.questions || {})) {
      answers[id] = (q && q.type === 'score') ? scoreAnswer() : noulAnswer()
    }
    return { status: 200, text: async () => JSON.stringify({ model: 'jev-1.13.0', answers }) }
  }
  const client = makeJevClient({
    baseUrl: 'https://typesafe.invalid', fetchImpl, log: (l) => logs.push(String(l)),
  })
  return { client, requests, logs }
}

// ── one run of the plan ─────────────────────────────────────────────────────
// `jevMode` — 'answers' | 'error' | 'off'. `tierB` — task B's plan tier.
const mkTask = (id, over = {}) => ({
  id,
  title: 'sim task ' + id + ' title',
  files: [FILE_OF[id]],
  tier: 'standard',
  review: 'peer',
  writes: [FILE_OF[id]],
  commutes: [],
  proofTests: [],
  proofRuns: [],
  body: id === 'A' ? A_BODY : B_BODY,
  ...over,
})

async function driveRun ({ label, jevMode = 'answers', tierB = 'standard' }) {
  const repo = makeRepo(path.join(tmp, 'repo-' + label))
  const runDir = path.join(tmp, 'run-' + label)
  const jev = jevMode === 'off' ? null : recordingJev({ mode: jevMode })
  const hub = fakeHub({
    projectId: PROJECT_ID,
    issues: {
      [RUN_UID]: { revision: 1, short_id: 'run0', metadata: {} },
      [UID.A]: { revision: 1, short_id: 'aa11', metadata: {} },
      [UID.B]: { revision: 1, short_id: 'bb22', metadata: {} },
    },
  })
  const kataRecord = {
    url: 'https://kata.invalid',
    project: { id: PROJECT_ID, uid: 'PROJ0', name: 'ultrapowers' },
    run: { uid: RUN_UID, revision: 1 },
    tasks: { A: { uid: UID.A, short_id: 'aa11', revision: 1 },
             B: { uid: UID.B, short_id: 'bb22', revision: 1 } },
  }
  const dispatched = []
  const stub = (prompt, opts, cwd) => {
    dispatched.push({ label: String(opts.label), model: opts.model })
    const [kind, id] = String(opts.label).split(':')
    if (kind === 'impl' || kind === 'fix') {
      fs.writeFileSync(path.join(cwd, FILE_OF[id]), 'written by ' + opts.label + '\n')
      return doneImpl(cwd)
    }
    if (kind === 'review') return passReview()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const tasks = [mkTask('A'), mkTask('B', { tier: tierB })]
  const { run } = rig({
    repo,
    runDir,
    waves: [tasks],
    // The one edge: it serialises A before B, so the dispatch order leg (d)
    // compares is a fact of the plan and not of microtask interleaving.
    edges: [['A', 'B']],
    stub,
    stamp: 'jt-' + label,
    kata: hub.kata,
    ...(jev ? { jev: jev.client } : {}),
    extraArgs: {
      kataRecord,
      // The worker's raised hand is not this exam's subject: a poll far longer
      // than the sim keeps the hub's log to the calls this run actually makes.
      attentionPollMs: 3600000,
    },
  })
  const report = await run()
  const lines = linesOf(runDir)
  const events = lines.map(parseLine)
  const jevIdx = []
  for (let i = 0; i < events.length; i++) if (events[i] && events[i].kind === KIND) jevIdx.push(i)
  return {
    label, report, hub, runDir, lines, events, dispatched,
    requests: jev ? jev.requests : [],
    clientLogs: jev ? jev.logs : [],
    // A `jev:tier` row with the line it was written as and its position.
    rows: jevIdx.map((i) => ({ row: events[i], line: lines[i], index: i })),
    rowsAt: (at) => jevIdx.map((i) => ({ row: events[i], line: lines[i], index: i }))
      .filter((r) => r.row.at === at),
    firstIndexOf: (pred) => events.findIndex((e) => Boolean(e) && pred(e)),
    pairs: dispatched.map((d) => [d.label, d.model]),
    rowOf: (id) => report.tasks.find((r) => r && r.task === id),
    requestsWith: (key) => (jev ? jev.requests : [])
      .filter((r) => r.questions && Object.prototype.hasOwnProperty.call(r.questions, key)),
  }
}

// The four runs this file reads. Run A answers, run B refuses, run C has no
// client at all, run D mixes the two tiers.
const A = await driveRun({ label: 'a', jevMode: 'answers' })
const B = await driveRun({ label: 'b', jevMode: 'error' })
const C = await driveRun({ label: 'c', jevMode: 'off' })
const D = await driveRun({ label: 'd', jevMode: 'answers', tierB: 'most-capable' })

const dbg = (run) => ' — run ' + run.label + ' rows: ' +
  JSON.stringify(run.rows.map((r) => fieldsOf(r.row, ['kind', 'task', 'at', 'round', 'tierChosen']))) +
  '; requests: ' + run.requests.length +
  '; client logs: ' + JSON.stringify(run.clientLogs)

// ════════════════════════════════════════════════════════════════════════════
// (a) [M1] the dispatch row, its state, its questions, its place and its
//     comment
// ════════════════════════════════════════════════════════════════════════════
{
  const rows = A.rowsAt('dispatch')
  assert.equal(rows.length, 2,
    '(a) [M1] the two-task run with `jev` and a hub on must leave in `events.jsonl` ' +
    'exactly two `' + KIND + '` rows with `at` `dispatch` — one per task' + dbg(A))

  for (const id of ['A', 'B']) {
    const mine = rows.filter((r) => r.row.task === id)
    assert.equal(mine.length, 1,
      '(a) [M1] exactly one `at: "dispatch"` row names task ' + id + dbg(A))
    const { row } = mine[0]

    assert.deepEqual(fieldsOf(row, ['kind', 'task', 'at', 'tierChosen']),
      { kind: KIND, task: id, at: 'dispatch', tierChosen: SONNET },
      '(a) [M1] task ' + id + "'s dispatch row is `{kind: '" + KIND + "', task: '" + id +
      "', at: 'dispatch', tierChosen: '" + SONNET + "'}` — `tierChosen` is `economics.tier`, " +
      "the MODEL name a `standard` task resolves to, never the tier's own name: " +
      JSON.stringify(row))

    assert.deepEqual(Object.keys(row).sort(), DISPATCH_ROW_KEYS,
      '(a) [M1] and ONE such row is appended and nothing else rides on it — its keys are the ' +
      "clause's four plus `answers`, over `appendEvent`'s own `id` and `ts`: " +
      JSON.stringify(Object.keys(row).sort()))

    assert.deepEqual(Object.keys(row.answers || {}).sort(), DISPATCH_KEYS,
      '(a) [M1] its `answers` carry exactly the keys `difficulty`, ' +
      '`lifecycle_or_concurrency`, `design_open`: ' + JSON.stringify(row.answers))
  }

  // ── the row's place in the file ───────────────────────────────────────────
  // The leg's two arms, read in the order it words them: that task's first
  // `driver:proof-run`, or — this plan naming no `Run:` line, so there is
  // none — that task's first `at: 'review'` row.
  for (const id of ['A', 'B']) {
    const mine = rows.filter((r) => r.row.task === id)[0]
    const proofRun = A.firstIndexOf((e) => e.kind === 'driver:proof-run' && e.task === id)
    const firstReview = A.firstIndexOf((e) => e.kind === KIND && e.task === id && e.at === 'review')
    const bound = proofRun !== -1 ? proofRun : firstReview
    assert.notEqual(bound, -1,
      '(a) [M1] task ' + id + ' must leave either a `driver:proof-run` row or a `' + KIND +
      '` row with `at` `review` for its dispatch row to precede' + dbg(A))
    assert.ok(mine.index < bound,
      '(a) [M1] task ' + id + "'s dispatch row must precede, by position in `events.jsonl`, " +
      'that task\'s first `driver:proof-run` (index ' + proofRun + ') or, absent one, that ' +
      "task's first `" + KIND + '` row with `at` `review` (index ' + firstReview + ') — the ' +
      'dispatch row is at index ' + mine.index)
  }

  // ── what the engine actually sent ─────────────────────────────────────────
  const reqs = A.requestsWith('difficulty')
  assert.equal(reqs.length, 2,
    "(a) [M1] the fake `fetchImpl`'s recorded dispatch requests — those whose `questions` " +
    'carry `difficulty` — number two, one per task' + dbg(A))

  for (const req of reqs) {
    const q = req.questions
    assert.equal(q.difficulty.type, 'score',
      '(a) [M1] `questions.difficulty.type` is `score`: ' + JSON.stringify(q.difficulty.type))
    assert.equal((q.difficulty.criteria || []).length, 4,
      '(a) [M1] and `difficulty` carries four `criteria` levels: ' +
      JSON.stringify(q.difficulty.criteria))
    assert.equal(q.lifecycle_or_concurrency.type, 'noul',
      '(a) [M1] `questions.lifecycle_or_concurrency.type` is `noul`: ' +
      JSON.stringify(q.lifecycle_or_concurrency.type))
    assert.equal(q.design_open.type, 'noul',
      '(a) [M1] `questions.design_open.type` is `noul`: ' + JSON.stringify(q.design_open.type))

    // M1's "the three dispatch questions of the SHARED LITERAL", which the task
    // spells verbatim — so the three are equal to it, and there is no fourth.
    assert.deepEqual(q, DISPATCH_QUESTIONS,
      '(a) [M1] the dispatch call sends the three questions of the shared literal, verbatim ' +
      'as the task spells them, and no other: ' + JSON.stringify(q))

    assert.deepEqual(Object.keys(req.state), ['task'],
      "(a) [M1] `Object.keys(state)` is `['task']`: " + JSON.stringify(Object.keys(req.state)))
    assert.deepEqual(Object.keys(req.state.task).sort(),
      ['claim', 'files', 'proof', 'proofTests', 'title'],
      "(a) [M1] `Object.keys(state.task)` sorted is `['claim', 'files', 'proof', " +
      "'proofTests', 'title']`: " + JSON.stringify(Object.keys(req.state.task).sort()))
  }

  // Which request belongs to which task is read off `state.task.title`, which
  // the same clause pins — so the per-task halves below are not an assumption
  // about the order the two calls were made in.
  for (const id of ['A', 'B']) {
    const plan = mkTask(id)
    const mine = reqs.filter((r) => r.state.task.title === plan.title)
    assert.equal(mine.length, 1,
      '(a) [M1] exactly one dispatch request carries `state.task.title` equal to task ' + id +
      "'s title " + JSON.stringify(plan.title) + ': ' +
      JSON.stringify(reqs.map((r) => r.state.task.title)))
    const st = mine[0].state.task
    assert.deepEqual(st.files, plan.files,
      '(a) [M1] `state.task.files` deep-equals task ' + id + "'s files: " + JSON.stringify(st.files))
    assert.deepEqual(st.proofTests, plan.proofTests,
      '(a) [M1] `state.task.proofTests` deep-equals task ' + id + "'s `proofTests`: " +
      JSON.stringify(st.proofTests))
  }

  // Task A's body carries the three markers; task B's carries none.
  const aState = reqs.filter((r) => r.state.task.title === mkTask('A').title)[0].state.task
  assert.ok(String(aState.claim).includes(A_CLAIM_SENTENCE),
    '(a) [M1] a task whose body carries a `**Claim:**` line followed by a `Machine: M1.` line ' +
    'sends a `state.task.claim` containing the Claim sentence ' +
    JSON.stringify(A_CLAIM_SENTENCE) + ': ' + JSON.stringify(aState.claim))
  assert.ok(String(aState.claim).includes('M1.'),
    '(a) [M1] and containing `M1.` — the Claim and its `Machine:` restatement travel together: ' +
    JSON.stringify(aState.claim))
  assert.ok(String(aState.proof).includes(A_PROOF_TEXT),
    "(a) [M1] and a `state.task.proof` containing the Proof line's text " +
    JSON.stringify(A_PROOF_TEXT) + ': ' + JSON.stringify(aState.proof))

  const bState = reqs.filter((r) => r.state.task.title === mkTask('B').title)[0].state.task
  assert.equal(bState.claim, '',
    '(a) [M1] a task whose body is ' + JSON.stringify(B_BODY) + ' sends `claim` as the empty ' +
    'string: ' + JSON.stringify(bState.claim))
  assert.equal(bState.proof, '',
    '(a) [M1] and `proof` as the empty string: ' + JSON.stringify(bState.proof))

  // ── the hub ───────────────────────────────────────────────────────────────
  for (const id of ['A', 'B']) {
    const mine = rows.filter((r) => r.row.task === id)[0]
    assert.ok(A.hub.commentsOn(UID[id]).includes(mine.line),
      "(a) [M1] each dispatch row's line, verbatim, is among `commentsOn(" +
      JSON.stringify(UID[id]) + ')` — the row is posted on that task\'s hub issue when a hub ' +
      'is on.\nthe line: ' + mine.line + '\nthe comments: ' +
      JSON.stringify(A.hub.commentsOn(UID[id]), null, 2))
  }
}

// ════════════════════════════════════════════════════════════════════════════
// (b) [M2] the review row, its state (including the patch TEXT), its
//     questions and its comment
// ════════════════════════════════════════════════════════════════════════════
{
  const rows = A.rowsAt('review')
  assert.equal(rows.length, 2,
    '(b) [M2] the same run leaves exactly two `' + KIND + '` rows with `at` `review`, one per ' +
    'task' + dbg(A))

  for (const id of ['A', 'B']) {
    const mine = rows.filter((r) => r.row.task === id)
    assert.equal(mine.length, 1,
      '(b) [M2] exactly one `at: "review"` row names task ' + id + dbg(A))
    const { row } = mine[0]

    assert.deepEqual(fieldsOf(row, ['kind', 'task', 'at', 'round', 'tierChosen']),
      { kind: KIND, task: id, at: 'review', round: 1, tierChosen: SONNET },
      '(b) [M2] task ' + id + "'s review row is `{kind: '" + KIND + "', task: '" + id +
      "', at: 'review', round: iter, tierChosen: economics.tier}` — one review round ran, so " +
      '`round` is `1` and `tierChosen` is `' + SONNET + '`: ' + JSON.stringify(row))

    assert.deepEqual(Object.keys(row).sort(), REVIEW_ROW_KEYS,
      '(b) [M2] and one such row is appended, carrying the clause\'s five fields and ' +
      '`answers` over `appendEvent`\'s own `id` and `ts`: ' + JSON.stringify(Object.keys(row).sort()))

    assert.deepEqual(Object.keys(row.answers || {}).sort(), REVIEW_KEYS,
      '(b) [M2] its `answers` carry exactly `review_difficulty` and `doc_or_prose_only`: ' +
      JSON.stringify(row.answers))
  }

  const reqs = A.requestsWith('review_difficulty')
  assert.equal(reqs.length, 2,
    '(b) [M2] the recorded review requests — those whose `questions` carry ' +
    '`review_difficulty` — number two, one per task' + dbg(A))

  for (const req of reqs) {
    const q = req.questions
    assert.equal(q.review_difficulty.type, 'score',
      '(b) [M2] `questions.review_difficulty.type` is `score`: ' +
      JSON.stringify(q.review_difficulty.type))
    assert.equal((q.review_difficulty.criteria || []).length, 4,
      '(b) [M2] and `review_difficulty` carries four `criteria` levels: ' +
      JSON.stringify(q.review_difficulty.criteria))
    assert.equal(q.doc_or_prose_only.type, 'noul',
      '(b) [M2] `questions.doc_or_prose_only.type` is `noul`: ' +
      JSON.stringify(q.doc_or_prose_only.type))

    // M2's "the two review questions of the shared literal", verbatim.
    assert.deepEqual(q, REVIEW_QUESTIONS,
      '(b) [M2] the review call sends the two questions of the shared literal, verbatim as the ' +
      'task spells them, and no other: ' + JSON.stringify(q))

    assert.deepEqual(Object.keys(req.state).sort(), ['patch', 'task'],
      "(b) [M2] `Object.keys(state)` sorted is `['patch', 'task']`: " +
      JSON.stringify(Object.keys(req.state).sort()))
    assert.deepEqual(Object.keys(req.state.task).sort(), ['claim', 'files', 'title'],
      "(b) [M2] `Object.keys(state.task)` sorted is `['claim', 'files', 'title']` — the review " +
      "state carries the task's Claim and Files, not its Proof: " +
      JSON.stringify(Object.keys(req.state.task).sort()))
  }

  for (const id of ['A', 'B']) {
    const plan = mkTask(id)
    const mine = reqs.filter((r) => r.state.task.title === plan.title)
    assert.equal(mine.length, 1,
      '(b) [M2] exactly one review request carries `state.task.title` equal to task ' + id +
      "'s title " + JSON.stringify(plan.title) + ': ' +
      JSON.stringify(reqs.map((r) => r.state.task.title)))
    const st = mine[0].state
    assert.deepEqual(st.task.files, plan.files,
      '(b) [M2] `state.task.files` deep-equals task ' + id + "'s files: " +
      JSON.stringify(st.task.files))
    assert.ok(String(st.patch).includes(diffLineFor(id)),
      '(b) [M2] `state.patch` is the TEXT of the captured patch file and so carries ' +
      JSON.stringify(diffLineFor(id)) + ' — not the patch file\'s PATH: ' +
      JSON.stringify(String(st.patch).slice(0, 400)))
  }

  // `claim` as in leg (a): A's carries the Claim sentence and `M1.`, B's is ''.
  const aClaim = reqs.filter((r) => r.state.task.title === mkTask('A').title)[0].state.task.claim
  assert.ok(String(aClaim).includes(A_CLAIM_SENTENCE) && String(aClaim).includes('M1.'),
    "(b) [M2] `state.task.claim` as in leg (a) — task A's carries the Claim sentence and " +
    '`M1.`: ' + JSON.stringify(aClaim))
  const bClaim = reqs.filter((r) => r.state.task.title === mkTask('B').title)[0].state.task.claim
  assert.equal(bClaim, '',
    "(b) [M2] and task B's body carries no `**Claim:**` line, so its `claim` is the empty " +
    'string: ' + JSON.stringify(bClaim))

  for (const id of ['A', 'B']) {
    const mine = rows.filter((r) => r.row.task === id)[0]
    assert.ok(A.hub.commentsOn(UID[id]).includes(mine.line),
      "(b) [M2] each review row's line is among `commentsOn(" + JSON.stringify(UID[id]) +
      ')`.\nthe line: ' + mine.line + '\nthe comments: ' +
      JSON.stringify(A.hub.commentsOn(UID[id]), null, 2))
  }
}

// ════════════════════════════════════════════════════════════════════════════
// (c) [M3] no row when `ask` resolves null, none when there is no `jev` — and
//     the tier the row names is the model name
// ════════════════════════════════════════════════════════════════════════════
{
  assert.deepEqual(B.rows.map((r) => r.row), [],
    '(c) [M3] a run whose `fetchImpl` answers status 500 for every request leaves ZERO `' +
    KIND + '` rows: `ask` resolves `null` and `jevRow` appends nothing' + dbg(B))
  assert.deepEqual(B.report.tasks.map((t) => [t.task, t.status]).sort(),
    [['A', 'done'], ['B', 'done']],
    '(c) [M3] and both tasks are `done` — a refused call costs the run nothing: ' +
    JSON.stringify(B.report.tasks.map((t) => fieldsOf(t, ['task', 'status', 'reviewVerdict']))))

  assert.deepEqual(C.rows.map((r) => r.row), [],
    '(c) [M3] a run with no `jev` leaves zero `' + KIND + '` rows' + dbg(C))

  // One task of each tier in a third run: `tierChosen` is the MODEL name.
  const dRows = D.rowsAt('dispatch')
  assert.equal(dRows.length, 2,
    '(c) [M3] the third run — one `standard` task and one `most-capable` task — leaves two ' +
    '`at: "dispatch"` rows' + dbg(D))
  const dTier = (id) => (dRows.filter((r) => r.row.task === id)[0] || { row: {} }).row.tierChosen
  assert.equal(dTier('A'), SONNET,
    '(c) [M3] a task with a `standard` tier records `tierChosen` `' + SONNET + '`: ' +
    JSON.stringify(dTier('A')))
  assert.equal(dTier('B'), OPUS,
    '(c) [M3] where a task with tier `most-capable` records `' + OPUS + '`: ' +
    JSON.stringify(dTier('B')))
}

// ════════════════════════════════════════════════════════════════════════════
// (d) [M4] with `jev` and without: the same dispatches, the same report rows
// ════════════════════════════════════════════════════════════════════════════
{
  assert.deepEqual(A.pairs, C.pairs,
    "(d) [M4] leg (a)'s scenario run with `jev` and without yields the same sequence of " +
    'dispatched `(label, opts.model)` pairs — the rows read no verdict, route, tier or model ' +
    'choice.\nwith jev:    ' + JSON.stringify(A.pairs) +
    '\nwithout jev: ' + JSON.stringify(C.pairs))

  // Named here so the leg is answered about the dispatches it is about: every
  // `impl:` carries the implementer's model and every `review:` the reviewer's.
  assert.deepEqual(A.pairs.filter(([l]) => l.startsWith('impl:') || l.startsWith('review:')),
    C.pairs.filter(([l]) => l.startsWith('impl:') || l.startsWith('review:')),
    '(d) [M4] and the same `model` option on every `impl:` and `review:` dispatch.\n' +
    'with jev:    ' + JSON.stringify(A.pairs.filter(([l]) => l.startsWith('impl:') || l.startsWith('review:'))) +
    '\nwithout jev: ' + JSON.stringify(C.pairs.filter(([l]) => l.startsWith('impl:') || l.startsWith('review:'))))

  const shape = (run) => ['A', 'B'].map((id) =>
    fieldsOf(run.rowOf(id) || {}, ['task', 'tier', 'reviewVerdict', 'status']))
  assert.deepEqual(shape(A), shape(C),
    '(d) [M4] and, per task, the same `tier`, `reviewVerdict` and `status` on the report.\n' +
    'with jev:    ' + JSON.stringify(shape(A)) +
    '\nwithout jev: ' + JSON.stringify(shape(C)))
}

console.log('ok - jev:tier: the dispatch row, the review row, the four silences, ' +
  'and the seam that moves no dispatch')
// The sentinel the bridge and the suite's `Run:` line read, printed only if
// every assertion above held.
console.log('ALL TESTS PASSED')
