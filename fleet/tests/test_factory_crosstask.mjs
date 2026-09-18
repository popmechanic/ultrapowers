// fleet/tests/test_factory_crosstask.mjs — the exam for "Across tasks — a
// worker's note settles an interface for its siblings, and a patch that grew
// into a sibling's files makes that sibling wait", against
// `factory/engine.mjs`, `factory/judge.mjs`, `factory/questions.json` and
// `factory/policy.json`.
//
// Four Machine clauses, four legs, in the order the clauses read:
//
//   M1  (a) — factory/questions.json gains `sets.settled` (`settles_interface`,
//             `which`), factory/policy.json gains `settled.t_settles`, and
//             `makeJudge(...)` answers a seventh reader `readSettled` over a
//             scripted `ask`.
//   M2  (b) — DRIVE B: once an adopted task's newest `[note]` fact and its
//             patch-derived candidates make `readSettled` answer a symbol, the
//             engine writes `interface.settled` through the Kata client and
//             appends a `settled` event row; with no `[note]` fact, `readSettled`
//             is never called.
//   M3  (c) — DRIVE C: every prompt for a task carries one `SETTLED:` line,
//             directly after `INTERFACES:`, for each predecessor whose
//             `board.settled` answers one; a task waiting on nothing carries
//             none.
//   M4  (d) — DRIVE D: an adopted landing whose patch touches a path outside
//             its own files, but inside an undispatched sibling's files, edges
//             that sibling (an `edge` event row, and `board.post(sibling,
//             'edge', …)`); a sibling already dispatched gets no edge.
//
// Below the agent seam this exam is deliberately real: real git repositories,
// real clones (`factory/engine.mjs`'s own `cloneAtBase`), the real
// `skills/ultrapowers/scripts/plan_parse.py` compiler subprocess, and the real
// `skills/ultrapowers/kernel/fold_wave.py` kernel for every fold. Only
// `deps.worker`, `deps.judge`, `deps.board`, `deps.kata` (leg (b) only) and
// `deps.sh`'s exam-command lane are faked, `deps.git` is a real, hermetic
// `git` — never `defaultSh`'s bare `process.env`.
//
// Every subprocess this exam spawns directly (git, the kernel) is given
// `env: simEnv()` from `./_helpers.mjs` — never `process.env` — so the run is
// hermetic regardless of the box it executes on.
//
// ── hand-in notes ────────────────────────────────────────────────────────────
//
// - M2's "or no candidates" arm is not separately proven: Proof leg (b) only
//   asks for the "with no [note] fact" sub-case, so that is the only absence
//   this file drives.
//
// - "The Kata client" M2 writes `interface.settled` through is not named more
//   precisely than that by the Machine clause. `factory/board.mjs` is not in
//   this task's Modify list and exposes no method that writes an arbitrary
//   metadata key (only `setState`, fixed to `factory.state`), so the only
//   seam left for a new write is `deps.kata` directly, exactly as
//   `factory/engine.mjs` already uses it when it builds its own board over
//   `--kata-url`. This exam injects `deps.kata` as a fake Kata client
//   alongside a plain stub `deps.board` (so `args.kataJson`'s `uidFor` still
//   resolves) on that inference; if the real implementation reaches Kata by
//   some other route entirely, leg (b)'s Kata-side assertions would stay red
//   against a correct implementation.
//
// - M4's "before readiness is next read" ordering is not independently
//   timed. DRIVE D's first scenario holds the waiting sibling (task 3) back
//   with its own, unrelated predecessor (a gated task G) rather than by
//   racing the engine's internal readiness pass, so the exam cannot tell
//   "readiness was re-read after the edge landed" apart from "G simply had
//   not finished yet". What IS asserted directly — the `edge` event row and
//   the `board.post('3', 'edge', …)` call — is the discriminating part: a
//   `runEngine` that never implements M4 emits neither.

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { simEnv } from './_helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..', '..')
const ENV = simEnv()

const show = (value) => {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return text && text.length > 400 ? text.slice(0, 400) + '…' : text
}

let engineMod = null
let engineImportError = null
try {
  engineMod = await import('../../factory/engine.mjs')
} catch (e) {
  engineImportError = e
}
assert.equal(engineImportError, null,
  'factory/engine.mjs must import cleanly — got ' + show(engineImportError && (engineImportError.stack || engineImportError.message)))
const { runEngine } = engineMod
assert.equal(typeof runEngine, 'function', 'factory/engine.mjs must export runEngine')

let judgeMod = null
let judgeImportError = null
try {
  judgeMod = await import('../../factory/judge.mjs')
} catch (e) {
  judgeImportError = e
}
assert.equal(judgeImportError, null,
  'factory/judge.mjs must import cleanly — got ' + show(judgeImportError && (judgeImportError.stack || judgeImportError.message)))
const { makeJudge } = judgeMod
assert.equal(typeof makeJudge, 'function', 'factory/judge.mjs must export makeJudge')

// ── scratch-dir bookkeeping ──────────────────────────────────────────────────

const TMP_DIRS = []
const mkTmp = (prefix) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  TMP_DIRS.push(d)
  return d
}

// ── shared fixture plumbing (same shapes as fleet/tests/test_factory_engine.mjs) ─

function realGit (argv, cwd) {
  const r = spawnSync('git', argv, { cwd, encoding: 'utf8', env: ENV, maxBuffer: 64 * 1024 * 1024 })
  if (r.status !== 0) {
    throw new Error('git ' + argv.join(' ') + ': ' + String(r.stderr || r.error || '').slice(0, 500))
  }
  return String(r.stdout || '')
}

function makeRepoDir (dir) {
  fs.mkdirSync(dir, { recursive: true })
  realGit(['init', '-q', '-b', 'main'], dir)
  realGit(['config', 'user.email', 'exam@test'], dir)
  realGit(['config', 'user.name', 'exam'], dir)
  fs.writeFileSync(path.join(dir, 'README.md'), 'fixture\n')
  realGit(['add', '-A'], dir)
  realGit(['commit', '-q', '-m', 'base'], dir)
  return dir
}

// A plan-markdown task block satisfying skills/ultrapowers/scripts/plan_parse.py's
// grammar. `extraFiles` adds further `- Modify:` bullets beside the one
// `- Create:` bullet, so `task.files` can carry more than one path (M4 needs a
// sibling whose `files` names a path it did not itself create).
function taskBlock ({ id, title, creates, extraFiles = [], clause1, clause2, consumes = 'nothing', produces = 'nothing', testPath }) {
  const fileLines = ['- Create: `' + creates + '`', ...extraFiles.map((f) => '- Modify: `' + f + '`')]
  return [
    '### Task ' + id + ': ' + title,
    '',
    ...fileLines,
    '',
    '**Claim:** exercises the machine below.',
    '',
    'Machine: M1. ' + clause1 + ' M2. ' + clause2,
    '',
    '**Interfaces:**',
    '- Consumes: ' + consumes,
    '- Produces: ' + produces,
    '',
    '**Proof:**',
    '- Test: `' + testPath + '`',
    '',
    '**Context:** fixture task for the cross-task exam.',
    '',
  ].join('\n')
}

function buildPlan (blocks) {
  return '# Fixture plan\n\n' + blocks.join('\n')
}

// A stub board: `post`/`setState` record in call order; `factsFor` and
// `settled` default to the "nothing known" shape unless a case overrides them.
function makeStubBoard ({ factsFor, settled } = {}) {
  const posts = []
  const stateLog = []
  const defaultFactsFor = async (task) =>
    posts.filter((p) => p.task === task).map((p) => '[' + p.kind + ']\n' + p.text).join('\n\n')
  return {
    posts,
    stateLog,
    post: async (task, kind, text) => { posts.push({ task, kind, text: String(text) }); return null },
    factsFor: factsFor || defaultFactsFor,
    setState: async (task, state) => { stateLog.push({ task, state }) },
    states: async () => ({}),
    settled: settled || (async () => null),
  }
}

// A recording worker: every dispatch is pushed to `calls`, then a per-label
// `behaviors` override runs if one was given, else a role-shaped default
// answer, matching fleet/tests/test_factory_engine.mjs's own `makeWorker`.
function makeWorker ({ calls, behaviors = {} }) {
  return async (opts) => {
    calls.push({ label: opts.label, task: opts.task, role: opts.role, prompt: opts.prompt, cwd: opts.cwd })
    const handler = behaviors[opts.label]
    if (handler) return handler(opts)
    if (opts.role === 'referee') {
      return { result: { result: 'referee saw nothing', structured_output: { findings: [] }, total_cost_usd: 0.001 }, denials: [] }
    }
    if (opts.role === 'resolve') {
      return { result: { result: 'cannot resolve', structured_output: { status: 'BLOCKED', hunks: [], notes: '' }, total_cost_usd: 0 }, denials: [] }
    }
    const rel = 'note_' + String(opts.label).replace(/[^A-Za-z0-9]/g, '_') + '.txt'
    fs.writeFileSync(path.join(opts.cwd, rel), 'written by ' + opts.label + '\n')
    return { result: { result: opts.label + ' done', total_cost_usd: 0.001 }, denials: [] }
  }
}

// The one `sh` fake this exam needs: the kernel passes straight through to
// the real kernel via a real `spawnSync`; every exam-command call answers
// exit 0 with empty output — no fixture task here has a real proof file to
// run for real.
function makeSh () {
  return (cmd, argv = [], cwd, input) => {
    if (cmd === 'python3' && String(argv[0] || '').endsWith('fold_wave.py')) {
      return spawnSync(cmd, argv, { cwd, input, encoding: 'utf8', env: ENV, maxBuffer: 64 * 1024 * 1024 })
    }
    return { status: 0, stdout: '', stderr: '' }
  }
}

// An in-memory Kata client, for leg (b) only: `comment` and `patchMetadata`
// record every call; `getIssue` answers whatever has accumulated.
function makeKata () {
  const calls = []
  const store = new Map()
  const issueFor = (uid) => {
    if (!store.has(uid)) store.set(uid, { comments: [], metadata: {} })
    return store.get(uid)
  }
  return {
    calls,
    comment: async (projectId, uid, body) => {
      calls.push({ method: 'comment', projectId, uid, body })
      issueFor(uid).comments.push({ body })
      return { ok: true }
    },
    getIssue: async (uid) => {
      const i = issueFor(uid)
      return { uid, comments: i.comments, metadata: i.metadata }
    },
    patchMetadata: async (projectId, uid, patch) => {
      calls.push({ method: 'patchMetadata', projectId, uid, patch })
      Object.assign(issueFor(uid).metadata, patch)
      return { ok: true }
    },
    listIssues: async () => [...store.entries()].map(([uid, v]) => ({ uid, metadata: v.metadata })),
  }
}

const readEvents = (runDir) =>
  fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))

// ════════════════════════════════════════════════════════════════════════════
// (a)/M1 — questions.json / policy.json shape, and makeJudge's readSettled.
// ════════════════════════════════════════════════════════════════════════════
{
  const questionsDoc = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'factory/questions.json'), 'utf8'))
  const settledSet = questionsDoc.sets && questionsDoc.sets.settled
  assert.ok(settledSet && settledSet.questions,
    '(a)/M1: factory/questions.json gains a set `settled` carrying a `questions` object — got ' + show(settledSet))
  assert.deepEqual(Object.keys(settledSet.questions).sort(), ['settles_interface', 'which'],
    '(a)/M1: `sets.settled.questions` holds keys exactly `settles_interface` and `which` — got ' +
    show(Object.keys(settledSet.questions)))

  const policyDoc = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'factory/policy.json'), 'utf8'))
  assert.deepEqual(policyDoc.settled && policyDoc.settled.t_settles, {
    value: 0.8, n: 0, window: 'none', basis: 'judgment', experiment: true, rollback: 1.01,
  }, '(a)/M1: factory/policy.json\'s `settled.t_settles` is deep-equal to the clause\'s object — got ' +
    show(policyDoc.settled && policyDoc.settled.t_settles))
}

function makeScriptedAsk (answers) {
  const calls = []
  return { calls, ask: async ({ state, questions }) => { calls.push({ state, questions }); return answers } }
}

{
  const { calls, ask } = makeScriptedAsk({
    settles_interface: { type: 'noul', noul: 0.9 },
    which: { type: 'choice', choice: 'catalog', confidence: 0.9 },
  })
  const judge = makeJudge({ ask, log: () => {} })
  assert.equal(typeof judge.readSettled, 'function',
    '(a)/M1: makeJudge(...) answers a seventh reader readSettled({ note, candidates })')
  const result = await judge.readSettled({ note: 'I exported catalog and it is settled', candidates: ['catalog', 'x'] })
  assert.deepEqual(result, { symbol: 'catalog' },
    '(a)/M1: readSettled resolves { symbol } when settles_interface (0.9) is at or above the 0.8 threshold and which names a candidate — got ' +
    show(result))
  assert.equal(calls.length, 1,
    '(a)/M1: readSettled puts the settled set to ask() exactly once — got ' + calls.length + ' calls')
}

{
  const { ask } = makeScriptedAsk({
    settles_interface: { type: 'noul', noul: 0.7 },
    which: { type: 'choice', choice: 'catalog', confidence: 0.9 },
  })
  const judge = makeJudge({ ask, log: () => {} })
  const result = await judge.readSettled({ note: 'note', candidates: ['catalog'] })
  assert.equal(result, null,
    '(a)/M1: readSettled resolves null when settles_interface (0.7) is below the 0.8 threshold — got ' + show(result))
}

{
  const { ask } = makeScriptedAsk({
    settles_interface: { type: 'noul', noul: 0.9 },
    which: { type: 'choice', choice: 'none', confidence: 0.9 },
  })
  const judge = makeJudge({ ask, log: () => {} })
  const result = await judge.readSettled({ note: 'note', candidates: ['catalog'] })
  assert.equal(result, null,
    '(a)/M1: readSettled resolves null when which answers none — got ' + show(result))
}

{
  const { ask } = makeScriptedAsk({
    settles_interface: { type: 'noul', noul: 0.9 },
    which: { type: 'choice', choice: 'zzz', confidence: 0.9 },
  })
  const judge = makeJudge({ ask, log: () => {} })
  const result = await judge.readSettled({ note: 'note', candidates: ['catalog', 'x'] })
  assert.equal(result, null,
    '(a)/M1: readSettled resolves null when which answers a choice that is not one of the candidates — got ' + show(result))
}

{
  const logs = []
  const judge = makeJudge({ ask: async () => null, log: (s) => logs.push(s) })
  const result = await judge.readSettled({ note: 'note', candidates: ['catalog'] })
  assert.equal(result, null,
    '(a)/M1: readSettled resolves null when ask() answers null — got ' + show(result))
  assert.equal(logs.length, 1,
    '(a)/M1: readSettled logs exactly one line when ask() does not answer — got ' + show(logs))
  assert.ok(logs[0].startsWith('jev:'),
    '(a)/M1: that one log line begins "jev:" — got ' + show(logs[0]))
}

// ════════════════════════════════════════════════════════════════════════════
// (b)/M2 — DRIVE B: an adopted task's newest [note] fact settles an interface
// through the Kata client, and events.jsonl carries the settled row.
// ════════════════════════════════════════════════════════════════════════════
{
  const dir = mkTmp('fx-cross-db-')
  const repo = makeRepoDir(path.join(dir, 'target'))
  const runDir = path.join(dir, 'run')
  const planPath = path.join(dir, 'plan.md')
  fs.writeFileSync(planPath, buildPlan([
    taskBlock({
      id: '1', title: 'settles catalog', creates: 'a.mjs',
      clause1: 'Task 1 adds an export.', clause2: 'Task 1 hands it to its siblings.',
      testPath: 'fleet/tests/test_db_one_stub.mjs',
    }),
  ]))

  const kataJsonPath = path.join(dir, 'kata.json')
  fs.writeFileSync(kataJsonPath, JSON.stringify({ tasks: { 1: { uid: 'U1' } } }))
  const kata = makeKata()

  const readSettledCalls = []
  const judgeB = {
    readTask: async () => ({ k: 1, referee: false }),
    readLanding: async () => ({ claim: 1, coverage: [1] }),
    readSettled: async (arg) => { readSettledCalls.push(arg); return { symbol: 'catalog' } },
  }
  const callsB = []
  const workerB = makeWorker({
    calls: callsB,
    behaviors: {
      'impl:1:0': async (opts) => {
        fs.writeFileSync(path.join(opts.cwd, 'a.mjs'), 'export function catalog () {}\n')
        return { result: { result: 'impl:1:0 done', total_cost_usd: 0 }, denials: [] }
      },
    },
  })
  const boardB = makeStubBoard({
    factsFor: async (id) => (id === '1' ? '[note]\nI exported catalog and it is settled' : ''),
  })

  await runEngine({ plan: planPath, target: repo, runDir, kataJson: kataJsonPath, kataProject: 77 }, {
    worker: workerB, judge: judgeB, sh: makeSh(), git: realGit, board: boardB, kata, log: () => {},
  })

  assert.equal(readSettledCalls.length, 1,
    '(b)/M2: after task 1 adopts, readSettled is put once for its newest [note] fact — got ' + readSettledCalls.length + ' calls')
  assert.ok(Array.isArray(readSettledCalls[0].candidates) && readSettledCalls[0].candidates.includes('catalog'),
    '(b)/M2: readSettled is called with candidates containing the export the patch adds — got ' +
    show(readSettledCalls[0].candidates))

  const patchCall = kata.calls.find((c) => c.method === 'patchMetadata' && c.uid === 'U1')
  assert.ok(patchCall, '(b)/M2: the Kata client sees patchMetadata on task 1\'s uid — calls: ' + show(kata.calls))
  const raw = patchCall.patch && patchCall.patch['interface.settled']
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
  assert.ok(parsed, '(b)/M2: the patchMetadata call carries an interface.settled value — got ' + show(patchCall.patch))
  assert.ok(/^[0-9a-f]{40}$/.test(String(parsed.sha)),
    '(b)/M2: interface.settled\'s sha is 40 hex characters — got ' + show(parsed.sha))
  assert.deepEqual(parsed, { symbol: 'catalog', file: 'a.mjs', task: '1', sha: parsed.sha },
    '(b)/M2: interface.settled parses to exactly { symbol: catalog, file: a.mjs, task: 1, sha } — got ' + show(parsed))

  const events = readEvents(runDir)
  const settledRow = events.find((e) => e.kind === 'settled')
  assert.deepEqual(settledRow, { kind: 'settled', task: '1', symbol: 'catalog', file: 'a.mjs' },
    '(b)/M2: events.jsonl carries { kind: settled, task: 1, symbol: catalog, file: a.mjs } — events: ' + show(events))
}

{
  const dir = mkTmp('fx-cross-db2-')
  const repo = makeRepoDir(path.join(dir, 'target'))
  const runDir = path.join(dir, 'run')
  const planPath = path.join(dir, 'plan.md')
  fs.writeFileSync(planPath, buildPlan([
    taskBlock({
      id: '2', title: 'no note', creates: 'b.mjs',
      clause1: 'Task 2 adds an export.', clause2: 'Task 2 says nothing about it.',
      testPath: 'fleet/tests/test_db_two_stub.mjs',
    }),
  ]))
  const kataJsonPath = path.join(dir, 'kata.json')
  fs.writeFileSync(kataJsonPath, JSON.stringify({ tasks: { 2: { uid: 'U2' } } }))
  const kata2 = makeKata()
  const readSettledCalls2 = []
  const judgeB2 = {
    readTask: async () => ({ k: 1, referee: false }),
    readLanding: async () => ({ claim: 1, coverage: [1] }),
    readSettled: async (arg) => { readSettledCalls2.push(arg); return { symbol: 'whatever' } },
  }
  const workerB2 = makeWorker({
    calls: [],
    behaviors: {
      'impl:2:0': async (opts) => {
        fs.writeFileSync(path.join(opts.cwd, 'b.mjs'), 'export function shipped () {}\n')
        return { result: { result: 'impl:2:0 done', total_cost_usd: 0 }, denials: [] }
      },
    },
  })
  // Default factsFor renders whatever the run itself posted — exam-note,
  // landing, and so on — never a [note] fact, since no worker's note tool is
  // exercised in this fixture.
  const boardB2 = makeStubBoard()

  await runEngine({ plan: planPath, target: repo, runDir, kataJson: kataJsonPath, kataProject: 77 }, {
    worker: workerB2, judge: judgeB2, sh: makeSh(), git: realGit, board: boardB2, kata: kata2, log: () => {},
  })

  assert.equal(readSettledCalls2.length, 0,
    '(b)/M2: with no [note] fact posted for task 2, readSettled is never called — got ' + readSettledCalls2.length + ' calls')
}

// ════════════════════════════════════════════════════════════════════════════
// (c)/M3 — DRIVE C: every prompt for a waiting sibling carries a SETTLED: line
// for each predecessor whose board.settled answers one.
// ════════════════════════════════════════════════════════════════════════════
{
  const dir = mkTmp('fx-cross-dc-')
  const repo = makeRepoDir(path.join(dir, 'target'))
  const runDir = path.join(dir, 'run')
  const planPath = path.join(dir, 'plan.md')
  fs.writeFileSync(planPath, buildPlan([
    taskBlock({
      id: '1', title: 'predecessor', creates: 'p.mjs',
      clause1: 'Task 1 writes its file.', clause2: 'Task 1 produces an interface.',
      produces: 'ifaceX', testPath: 'fleet/tests/test_dc_one_stub.mjs',
    }),
    taskBlock({
      id: '2', title: 'dependent', creates: 'q.mjs',
      clause1: 'Task 2 waits on task 1.', clause2: 'Task 2 writes its own file.',
      consumes: 'ifaceX', testPath: 'fleet/tests/test_dc_two_stub.mjs',
    }),
    taskBlock({
      id: '3', title: 'independent', creates: 'r.mjs',
      clause1: 'Task 3 needs nothing.', clause2: 'Task 3 writes its own file.',
      testPath: 'fleet/tests/test_dc_three_stub.mjs',
    }),
  ]))

  const SHA = 'a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1'
  const SETTLED = { symbol: 'catalog', file: 'a.mjs', task: '1', sha: SHA }
  const boardC = makeStubBoard({ settled: async (id) => (id === '1' ? SETTLED : null) })
  const judgeC = { readTask: async () => ({ k: 1, referee: false }), readLanding: async () => ({ claim: 1, coverage: [1] }) }
  const callsC = []
  const workerC = makeWorker({ calls: callsC })

  await runEngine({ plan: planPath, target: repo, runDir }, {
    worker: workerC, judge: judgeC, sh: makeSh(), git: realGit, board: boardC, log: () => {},
  })

  const SETTLED_LINE = 'SETTLED: catalog in a.mjs (task 1, ' + SHA + ')'
  const forTask2 = callsC.filter((c) => c.task === '2')
  assert.ok(forTask2.length >= 2,
    '(c)/M3: task 2 dispatches at least an exam and an implementer — got ' + show(forTask2.map((c) => c.label)))
  for (const c of forTask2) {
    assert.ok(c.prompt.includes('INTERFACES:\nConsumes: ifaceX\nProduces: nothing\n' + SETTLED_LINE),
      '(c)/M3: prompt ' + c.label + ' carries "' + SETTLED_LINE + '" directly after its INTERFACES: block — got tail ' +
      show(c.prompt.slice(-260)))
  }

  const forTask3 = callsC.filter((c) => c.task === '3')
  assert.ok(forTask3.length >= 2,
    '(c)/M3: task 3 dispatches at least an exam and an implementer — got ' + show(forTask3.map((c) => c.label)))
  for (const c of forTask3) {
    assert.ok(!c.prompt.includes('SETTLED:'),
      '(c)/M3: task 3 waits on nothing, so no prompt for it contains SETTLED: — got ' + c.label + ' prompt tail ' +
      show(c.prompt.slice(-200)))
  }
}

// ════════════════════════════════════════════════════════════════════════════
// (d)/M4 — DRIVE D: an adopted landing whose patch reaches into a sibling's
// undispatched files edges that sibling; a sibling already dispatched gets none.
// ════════════════════════════════════════════════════════════════════════════
{
  const dir = mkTmp('fx-cross-dd1-')
  const repo = makeRepoDir(path.join(dir, 'target'))
  const runDir = path.join(dir, 'run')
  const planPath = path.join(dir, 'plan.md')
  fs.writeFileSync(planPath, buildPlan([
    taskBlock({
      id: '1', title: 'amends shared.md', creates: 'a.mjs',
      clause1: 'Task 1 writes its own file.', clause2: 'Task 1 also touches a shared path.',
      testPath: 'fleet/tests/test_dd1_one_stub.mjs',
    }),
    taskBlock({
      id: 'G', title: 'gate', creates: 'g.mjs',
      clause1: 'Task G writes its own file.', clause2: 'Task G produces an interface.',
      produces: 'ifaceG', testPath: 'fleet/tests/test_dd1_gate_stub.mjs',
    }),
    taskBlock({
      id: '3', title: 'owns shared.md', creates: 'c.mjs', extraFiles: ['shared.md'],
      clause1: 'Task 3 waits on task G.', clause2: 'Task 3 also owns a shared path.',
      consumes: 'ifaceG', testPath: 'fleet/tests/test_dd1_three_stub.mjs',
    }),
  ]))

  let releaseG
  const gateG = new Promise((resolve) => { releaseG = resolve })
  const callsD1 = []
  const workerD1 = makeWorker({
    calls: callsD1,
    behaviors: {
      'impl:1:0': async (opts) => {
        fs.writeFileSync(path.join(opts.cwd, 'a.mjs'), 'own file\n')
        fs.writeFileSync(path.join(opts.cwd, 'shared.md'), 'amended by task 1\n')
        return { result: { result: 'impl:1:0 done', total_cost_usd: 0 }, denials: [] }
      },
      // Held indefinitely: task 3's only DAG predecessor never adopts until
      // this exam releases it, so task 3 stays out of the ready set (never
      // dispatched) for as long as the exam needs to observe task 1 landing.
      'exam:G': async () => { await gateG; return { result: { result: 'exam:G done', total_cost_usd: 0 }, denials: [] } },
    },
  })
  const boardD1 = makeStubBoard()
  const runPromise = runEngine({ plan: planPath, target: repo, runDir }, {
    worker: workerD1, judge: { readTask: async () => ({ k: 1, referee: false }) },
    sh: makeSh(), git: realGit, board: boardD1, log: () => {},
  })

  const adoptDeadline = Date.now() + 10000
  while (Date.now() < adoptDeadline && !boardD1.stateLog.some((s) => s.task === '1' && s.state === 'adopted')) {
    await new Promise((r) => setTimeout(r, 15))
  }
  assert.ok(boardD1.stateLog.some((s) => s.task === '1' && s.state === 'adopted'),
    '(d)/M4: task 1 adopts within the wait window — stateLog: ' + show(boardD1.stateLog))

  const edgeDeadline = Date.now() + 10000
  while (Date.now() < edgeDeadline && !boardD1.posts.some((p) => p.task === '3' && p.kind === 'edge')) {
    await new Promise((r) => setTimeout(r, 15))
  }
  const task3DispatchedBeforeRelease = callsD1.some((c) => c.task === '3')
  releaseG()
  const result = await runPromise

  assert.ok(!task3DispatchedBeforeRelease,
    '(d)/M4: task 3 is not yet dispatched by the time task 1 has adopted (it is held on gate task G) — dispatches for task 3 seen before release: ' +
    show(callsD1.filter((c) => c.task === '3').map((c) => c.label)))
  assert.ok(callsD1.some((c) => c.task === '3'),
    '(d)/M4: task 3 is eventually dispatched, only after task 1\'s adoption (and G\'s release) — no dispatch for task 3 ever seen')

  const events = readEvents(runDir)
  const edgeRow = events.find((e) => e.kind === 'edge' && e.to === '3')
  assert.deepEqual(edgeRow, { kind: 'edge', from: '1', to: '3', why: 'files-amendment', path: 'shared.md' },
    '(d)/M4: events.jsonl carries { kind: edge, from: 1, to: 3, why: files-amendment, path: shared.md } — events: ' + show(events))

  const edgePost = boardD1.posts.find((p) => p.task === '3' && p.kind === 'edge')
  assert.ok(edgePost, '(d)/M4: board.post(\'3\', \'edge\', …) is called — posts for task 3: ' +
    show(boardD1.posts.filter((p) => p.task === '3')))
  assert.ok(/\b1\b/.test(edgePost.text) && edgePost.text.includes('shared.md'),
    '(d)/M4: the edge post\'s text names the adopted task (1) and the path (shared.md) — got ' + show(edgePost.text))

  assert.deepEqual([...result.adopted].sort(), ['1', '3', 'G'],
    '(d)/M4: sanity — all three tasks eventually adopt once task G is released')
}

{
  const dir = mkTmp('fx-cross-dd2-')
  const repo = makeRepoDir(path.join(dir, 'target'))
  const runDir = path.join(dir, 'run')
  const planPath = path.join(dir, 'plan.md')
  fs.writeFileSync(planPath, buildPlan([
    taskBlock({
      id: '1', title: 'amends shared.md, late', creates: 'a2.mjs',
      clause1: 'Task 1 writes its own file.', clause2: 'Task 1 also touches a shared path.',
      testPath: 'fleet/tests/test_dd2_one_stub.mjs',
    }),
    taskBlock({
      id: '3', title: 'owns shared.md, independent', creates: 'c2.mjs', extraFiles: ['shared.md'],
      clause1: 'Task 3 needs nothing.', clause2: 'Task 3 also owns a shared path.',
      testPath: 'fleet/tests/test_dd2_three_stub.mjs',
    }),
  ]))

  let releaseImpl1
  const gateImpl1 = new Promise((resolve) => { releaseImpl1 = resolve })
  const callsD2 = []
  const workerD2 = makeWorker({
    calls: callsD2,
    behaviors: {
      // Held so task 3 — independent, dispatched immediately — is
      // observably already dispatched before task 1 ever lands.
      'impl:1:0': async (opts) => {
        await gateImpl1
        fs.writeFileSync(path.join(opts.cwd, 'a2.mjs'), 'own file\n')
        fs.writeFileSync(path.join(opts.cwd, 'shared.md'), 'amended by task 1, late\n')
        return { result: { result: 'impl:1:0 done', total_cost_usd: 0 }, denials: [] }
      },
    },
  })
  const boardD2 = makeStubBoard()
  const runPromise = runEngine({ plan: planPath, target: repo, runDir }, {
    worker: workerD2, judge: { readTask: async () => ({ k: 1, referee: false }) },
    sh: makeSh(), git: realGit, board: boardD2, log: () => {},
  })

  const deadline = Date.now() + 10000
  while (Date.now() < deadline && !callsD2.some((c) => c.task === '3')) {
    await new Promise((r) => setTimeout(r, 15))
  }
  assert.ok(callsD2.some((c) => c.task === '3'),
    '(d)/M4: task 3 (independent, no predecessor) is dispatched before task 1\'s gated implementer is released')
  releaseImpl1()
  await runPromise

  const events = readEvents(runDir)
  const edgeRow = events.find((e) => e.kind === 'edge' && e.to === '3')
  assert.equal(edgeRow, undefined,
    '(d)/M4: task 3, already dispatched, gains no files-amendment edge when task 1 later lands touching shared.md — got ' +
    show(edgeRow))
}

// ── cleanup ───────────────────────────────────────────────────────────────
for (const d of TMP_DIRS) {
  try { fs.rmSync(d, { recursive: true, force: true }) } catch { /* best effort */ }
}

console.log('test_factory_crosstask.mjs: all assertions passed')
