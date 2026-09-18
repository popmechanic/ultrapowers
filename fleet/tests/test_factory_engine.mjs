// fleet/tests/test_factory_engine.mjs — the exam for "The engine closes the
// loop — every sensor posts, every worker is handed what is known, a short
// landing gets one more attempt, and readiness is re-read on every
// adoption", against `factory/engine.mjs`.
//
// Six Machine clauses, six drives, in the order the clauses read:
//
//   M1  DRIVE 1  — --kata-url/--kata-project/--kata-json wiring: the board
//                  reaches Kata through the fake client, task.uid comes off
//                  the kata-json file, and factoryTools is handed the board.
//       DRIVE B  — (2nd half) a fake board's setState sequence: dispatched
//                  then adopted for a landing task, dispatched then parked
//                  for one the run parks.
//       DRIVE 3  — no --kata-url and no injected board: the fixture drive
//                  still resolves the five keys and still adopts everything.
//   M2  DRIVE B  — every post kind a landing produces: exam-note, landing
//                  (exit code, claim, lowest-covered clause + its score),
//                  finding:<grade>, conflict, worker-error, park.
//   M3  DRIVE C  — every dispatched prompt for a task carries board.factsFor
//                  appended as "\n\nHAND-OFF:\n<facts>"; a task with no facts
//                  carries no such suffix.
//   M4  DRIVE D  — a red exam, or a lowest-clause coverage under the policy
//                  floor, buys exactly one more implementer dispatch in the
//                  same clone before the landing is measured again; a second
//                  red buys nothing more; policy.json documents the knob.
//   M5  DRIVE E  — the loop folds on every adoption and re-reads readiness
//                  immediately: a task whose only predecessor already landed
//                  is dispatched while an unrelated sibling from the same
//                  initial ready set is still in flight; a parked
//                  predecessor parks its dependent too, by name.
//   M6  DRIVE F  — every tool_use a worker's message stream emits becomes a
//                  'worker:tool' row; a Bash tool_use whose command contains
//                  the task's test command also becomes a 'worker:test-run'
//                  row carrying whether the tool_result was red.
//
// Below the agent seam this exam is deliberately real: real git repositories,
// real clones (`factory/engine.mjs`'s own `cloneAtBase`), the real
// `skills/ultrapowers/scripts/plan_parse.py` compiler subprocess, and the
// real `skills/ultrapowers/kernel/fold_wave.py` kernel for every fold this
// exam does not itself have a reason to intercept. Only `deps.worker`,
// `deps.judge`, `deps.sh` (for its exam-command leg only — the kernel leg of
// `sh` passes straight through to the real kernel unless a case overrides
// one call by task id), `deps.git` (a real, hermetic `git`, never
// `defaultSh`'s bare `process.env`) and `deps.board`/`deps.tools`/`deps.kata`
// are faked, because those are exactly the seams `runEngine(rawArgs, deps)`
// exposes for this.
//
// Every subprocess this exam spawns directly (git, the kernel) is given
// `env: simEnv()` from `./_helpers.mjs` — never `process.env` — so the run is
// hermetic regardless of the box it executes on.
//
// ── the readings this exam is written on (hand-in notes) ────────────────────
//
// - M3's 'resolve' role (a resolver dispatch, fired only when the kernel's
//   fold leaves hunks `open`) is not separately exercised for the HAND-OFF
//   suffix. Constructing a genuine open-hunk merge conflict deterministically
//   would need two real, non-fast-forward-mergeable patches against the same
//   anchor, which none of this file's other scenarios need; DRIVE C proves
//   the suffix on the other four of the five roles (exam, implement, referee,
//   the blocking-finding fix) instead, and the mechanism is one line
//   (`dispatch`'s own `opts.prompt`) shared by all five call sites.
//
// - M4's redispatch is proven for "a red exam" and for "a lowest-clause
//   coverage under the policy floor" (DRIVE D scenarios 1-4) and
//   policy.json's landing.redispatch object is checked by exact equality.
//   The sub-case of the policy's `enabled` flag turned off — provable only by
//   redirecting the file `runEngine` reads it from — is NOT asserted here:
//   the one existing precedent in `factory/engine.mjs` for a policy-path
//   override (`args.policy`) is wired solely into `buildDeps`'s judge
//   construction (`buildDeps` runs before `runEngine`, and `runEngine` itself
//   reads its OWN policy document — today only for `supervisorMode` — off the
//   hardcoded `POLICY_PATH` constant, with no override read anywhere in
//   `runEngine`'s body). Asserting against a guessed flag name risks a false
//   red against a correct implementation that instead reads the real
//   `factory/policy.json` directly (exactly as `supervisorMode` already
//   does), so this sub-case is left unencoded rather than encoded weakly.
//
// - M6's "a Bash tool_use whose command contains the task's test command OR
//   one of its proofTests paths" is proven only on the boundary between a
//   command that matches and one that matches neither — every fixture task's
//   compiler-derived `testCmd` is `'node ' + <the one proofTests path>`, so
//   the path is already a substring of the command in every case this file
//   can construct without hand-authoring a `testCmd` the compiler would
//   never derive; the two arms of the OR are not independently isolated.

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
let importError = null
try {
  engineMod = await import('../../factory/engine.mjs')
} catch (e) {
  importError = e
}
assert.equal(importError, null,
  'factory/engine.mjs must import cleanly — got ' + show(importError && (importError.stack || importError.message)))
const { runEngine } = engineMod
assert.equal(typeof runEngine, 'function', 'factory/engine.mjs must export runEngine')

// ── scratch-dir bookkeeping ──────────────────────────────────────────────────

const TMP_DIRS = []
const mkTmp = (prefix) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  TMP_DIRS.push(d)
  return d
}

// ── shared fixture plumbing ──────────────────────────────────────────────────

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
// grammar: a `### Task <id>: <title>` heading, a pre-slot `- Create:` file
// bullet, a standalone `Machine: M1. ... M2. ...` paragraph anywhere in the
// body, an `**Interfaces:**` slot (drives dag_edges) and a `**Proof:**` slot
// whose `- Test: \`fleet/tests/test_….mjs\`` bullet derives `testCmd` as
// `'node ' + that path`.
function taskBlock ({ id, title, creates, clause1, clause2, consumes = 'nothing', produces = 'nothing', testPath }) {
  return [
    '### Task ' + id + ': ' + title,
    '',
    '- Create: `' + creates + '`',
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
    '**Context:** fixture task for the engine exam.',
    '',
  ].join('\n')
}

function buildPlan (blocks) {
  return '# Fixture plan\n\n' + blocks.join('\n')
}

// A stub board: `post`/`setState` record in call order; `factsFor` by default
// renders whatever was posted for that task so far (mirroring the real
// board's "facts accumulate" shape closely enough for M3's HAND-OFF checks),
// unless a case overrides it with a fixed function for exact-equality
// assertions immune to dispatch-ordering details this exam does not pin down.
function makeStubBoard ({ factsFor } = {}) {
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
    settled: async () => null,
  }
}

// A recording worker: every dispatch is pushed (in true call order, since the
// push happens synchronously before any behavior runs) to `calls`, then a
// per-label `behaviors` override runs if one was given, else a role-shaped
// default answer — for 'implement'/'exam' a note file is written into the
// dispatch's own clone so a real patch exists for the real kernel to fold.
function makeWorker ({ calls, behaviors = {} }) {
  return async (opts) => {
    calls.push({ label: opts.label, task: opts.task, role: opts.role, prompt: opts.prompt, cwd: opts.cwd, onMessage: opts.onMessage })
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

// A single `sh` fake shared by both of `factory/engine.mjs`'s uses of it: the
// kernel (`python3 <fold_wave.py path> fold|materialize|resolve ...`, cwd
// always the exam-7 repo root) and each candidate's own exam command (cwd the
// candidate's own clone). Kernel calls pass straight through to the real
// kernel via a real `spawnSync`, UNLESS `kernelOverrides` names a
// `'<verb>:<taskId>'` key (the task id read off the `--patch` flag's
// `id=path@anchor` value) — letting one case force a synthetic
// fold-does-not-complete answer with no real merge conflict. Exam-command
// calls are looked up in `examScript` by `path.basename(cwd)`, defaulting to
// exit 0 when unset.
function makeSh ({ examScript = {}, kernelOverrides = {} } = {}) {
  const counters = new Map()
  return (cmd, argv = [], cwd, input) => {
    if (cmd === 'python3' && String(argv[0] || '').endsWith('fold_wave.py')) {
      const verb = argv[1]
      const pi = argv.indexOf('--patch')
      const raw = pi >= 0 ? String(argv[pi + 1]) : ''
      const taskId = raw.split('=')[0]
      const key = verb + ':' + taskId
      if (Object.prototype.hasOwnProperty.call(kernelOverrides, key)) return kernelOverrides[key]
      return spawnSync(cmd, argv, { cwd, input, encoding: 'utf8', env: ENV, maxBuffer: 64 * 1024 * 1024 })
    }
    const key = path.basename(String(cwd || ''))
    const script = examScript[key]
    const list = Array.isArray(script) ? script : script ? [script] : [{ status: 0, stdout: '' }]
    const i = counters.get(key) || 0
    counters.set(key, i + 1)
    const entry = list[Math.min(i, list.length - 1)]
    return { status: entry.status ?? 0, stdout: entry.stdout ?? '', stderr: entry.stderr ?? '' }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// (a)/M1 — DRIVE 1: --kata-url/--kata-project/--kata-json wiring.
// ════════════════════════════════════════════════════════════════════════════
{
  const dir = mkTmp('fx-engine-d1-')
  const repo = makeRepoDir(path.join(dir, 'target'))
  const runDir = path.join(dir, 'run')
  const planPath = path.join(dir, 'plan.md')
  fs.writeFileSync(planPath, buildPlan([
    taskBlock({
      id: '1', title: 'kata wiring', creates: 'pkg/one.py',
      clause1: 'Task 1 writes its file.', clause2: 'Task 1 reports success.',
      testPath: 'fleet/tests/test_d1_stub.mjs',
    }),
  ]))
  const kataJsonPath = path.join(dir, 'kata.json')
  fs.writeFileSync(kataJsonPath, JSON.stringify({ tasks: { 1: { uid: 'U1' } } }))

  const kataCalls = []
  const fakeKata = {
    comment: async (projectId, uid, body) => { kataCalls.push({ method: 'comment', projectId, uid, body }); return { ok: true } },
    getIssue: async (uid) => ({ uid, comments: [], metadata: {} }),
    patchMetadata: async (projectId, uid, patch) => { kataCalls.push({ method: 'patchMetadata', projectId, uid, patch }); return { ok: true } },
    listIssues: async () => [],
  }

  const toolsCalls = []
  const deps = {
    worker: makeWorker({ calls: [] }),
    judge: {},
    sh: makeSh({}),
    git: realGit,
    tools: async (arg) => { toolsCalls.push(arg); return null },
    kata: fakeKata,
    log: () => {},
  }

  await runEngine({
    plan: planPath, target: repo, runDir,
    kataUrl: 'http://127.0.0.1:1', kataProject: 12, kataJson: kataJsonPath,
  }, deps)

  assert.ok(toolsCalls.length >= 1,
    '(a)/M1: with --kata-url/--kata-project/--kata-json, factoryTools\' deps.tools is called at least once')
  assert.equal(toolsCalls[0].task && toolsCalls[0].task.uid, 'U1',
    '(a)/M1: the tools call carries task.uid read from the kata-json file — got ' + show(toolsCalls[0].task))
  assert.equal(typeof toolsCalls[0].board, 'object',
    '(a)/M1: the tools call carries a board (built with makeBoard over the kata client on --kata-url)')
  assert.equal(typeof (toolsCalls[0].board && toolsCalls[0].board.post), 'function',
    '(a)/M1: the board passed to tools has a post function reaching the fake client')

  await toolsCalls[0].board.post('1', 'probe', 'from-tools-board')
  const probe = kataCalls.find((c) => c.method === 'comment' && c.uid === 'U1' && c.body === '[probe]\nfrom-tools-board')
  assert.ok(probe, '(a)/M1: the board passed to tools reaches the fake client\'s comment with (12, \'U1\', …) — calls: ' + show(kataCalls))
  assert.equal(probe.projectId, 12, '(a)/M1: the board\'s post reaches comment with projectId 12 — got ' + show(probe.projectId))
}

// ════════════════════════════════════════════════════════════════════════════
// (a)/M1 (2nd half) + (b)/M2 — DRIVE B: a fake board's state sequence and
// every post kind a landing produces.
// ════════════════════════════════════════════════════════════════════════════
{
  const dir = mkTmp('fx-engine-db-')
  const repo = makeRepoDir(path.join(dir, 'target'))
  const runDir = path.join(dir, 'run')
  const planPath = path.join(dir, 'plan.md')
  fs.writeFileSync(planPath, buildPlan([
    taskBlock({ id: 'TL', title: 'lands cleanly', creates: 'pkg/tl.py',
      clause1: 'Task TL writes its file.', clause2: 'Task TL reports success clearly.',
      testPath: 'fleet/tests/test_tl_stub.mjs' }),
    taskBlock({ id: 'TF', title: 'is refereed', creates: 'pkg/tf.py',
      clause1: 'Task TF writes its file.', clause2: 'Task TF is reviewed by a referee.',
      testPath: 'fleet/tests/test_tf_stub.mjs' }),
    taskBlock({ id: 'TC', title: 'conflicts', creates: 'pkg/tc.py',
      clause1: 'Task TC writes its file.', clause2: 'Task TC may conflict with a sibling.',
      testPath: 'fleet/tests/test_tc_stub.mjs' }),
    taskBlock({ id: 'TW', title: 'worker dies', creates: 'pkg/tw.py',
      clause1: 'Task TW writes its file.', clause2: 'Task TW may crash before writing.',
      testPath: 'fleet/tests/test_tw_stub.mjs' }),
  ]))

  const judgeB = {
    readTask: async ({ id }) => ({ k: 1, referee: id === 'TF' }),
    readLanding: async () => ({ claim: 0.9, coverage: [0.9, 0.3] }),
    gradeFinding: async () => 'minor',
  }
  const callsB = []
  const workerB = makeWorker({
    calls: callsB,
    behaviors: {
      'impl:TW:0': async () => { throw new Error('boom: worker rejected the implementation') },
      'referee:TF': async () => ({
        result: {
          result: 'referee found one thing',
          structured_output: { findings: [{ detail: 'formatting looks off', path: 'pkg/tf.py' }] },
          total_cost_usd: 0.001,
        }, denials: [],
      }),
    },
  })
  const shB = makeSh({ kernelOverrides: { 'fold:TC': { status: 0, stdout: JSON.stringify({ complete: false, open: [] }) } } })
  const boardB = makeStubBoard()

  await runEngine({ plan: planPath, target: repo, runDir }, {
    worker: workerB, judge: judgeB, sh: shB, git: realGit, board: boardB, log: () => {},
  })

  const postsFor = (id) => boardB.posts.filter((p) => p.task === id)
  const statesFor = (id) => boardB.stateLog.filter((s) => s.task === id).map((s) => s.state)

  assert.deepEqual(statesFor('TL'), ['dispatched', 'adopted'],
    '(a)/M1: a task that lands gets factory.state set dispatched then adopted — got ' + show(statesFor('TL')))
  assert.deepEqual(statesFor('TW'), ['dispatched', 'parked'],
    '(a)/M1: a task the run parks gets factory.state set dispatched then parked — got ' + show(statesFor('TW')))

  for (const id of ['TL', 'TF', 'TC', 'TW']) {
    const examNote = postsFor(id).find((p) => p.kind === 'exam-note')
    assert.ok(examNote, '(b)/M2: ' + id + ' gets an exam-note post after the exam worker returns — posts: ' + show(postsFor(id)))
    assert.equal(examNote.text, 'exam:' + id + ' done',
      '(b)/M2: exam-note\'s text equals the exam worker\'s final text — got ' + show(examNote.text))
  }

  const clauseTextFor = {
    TL: 'Task TL reports success clearly.', TF: 'Task TF is reviewed by a referee.',
    TC: 'Task TC may conflict with a sibling.', TW: 'Task TW may crash before writing.',
  }
  for (const id of ['TL', 'TF', 'TC', 'TW']) {
    const landing = postsFor(id).find((p) => p.kind === 'landing')
    assert.ok(landing, '(b)/M2: ' + id + ' gets a landing post after measurement — posts: ' + show(postsFor(id)))
    assert.ok(landing.text.includes('0'),
      '(b)/M2: landing text carries the exam exit code — got ' + show(landing.text))
    assert.ok(landing.text.includes('0.9'),
      '(b)/M2: landing text carries the judge\'s claim reading — got ' + show(landing.text))
    assert.ok(landing.text.includes(clauseTextFor[id]),
      '(b)/M2: landing text names the lowest-covered clause — got ' + show(landing.text))
    assert.ok(landing.text.includes('0.3'),
      '(b)/M2: landing text carries the lowest-covered clause\'s score — got ' + show(landing.text))
  }

  const findingPost = postsFor('TF').find((p) => p.kind === 'finding:minor')
  assert.ok(findingPost, '(b)/M2: TF gets a finding:minor post for its one referee finding — posts: ' + show(postsFor('TF')))
  assert.ok(findingPost.text.includes('formatting looks off'),
    '(b)/M2: finding:minor\'s text is the finding\'s text — got ' + show(findingPost.text))

  const conflictPost = postsFor('TC').find((p) => p.kind === 'conflict')
  assert.ok(conflictPost, '(b)/M2: TC gets a conflict post when its fold does not complete — posts: ' + show(postsFor('TC')))
  const parkPostTC = postsFor('TC').find((p) => p.kind === 'park')
  assert.ok(parkPostTC, '(b)/M2: TC gets a park post with the reason when it parks — posts: ' + show(postsFor('TC')))

  const werrPost = postsFor('TW').find((p) => p.kind === 'worker-error')
  assert.ok(werrPost, '(b)/M2: TW gets a worker-error post when its worker ends in error — posts: ' + show(postsFor('TW')))
  assert.ok(werrPost.text.includes('boom: worker rejected the implementation'),
    '(b)/M2: worker-error\'s text carries the rejection\'s message — got ' + show(werrPost.text))
  const parkPostTW = postsFor('TW').find((p) => p.kind === 'park')
  assert.ok(parkPostTW, '(b)/M2: TW gets a park post with the reason when it parks — posts: ' + show(postsFor('TW')))
}

// ════════════════════════════════════════════════════════════════════════════
// (a)/M1 (3rd sub-scenario) — DRIVE 3: no --kata-url, no injected board.
// ════════════════════════════════════════════════════════════════════════════
{
  const dir = mkTmp('fx-engine-d3-')
  const repo = makeRepoDir(path.join(dir, 'target'))
  const runDir = path.join(dir, 'run')
  const planPath = path.join(dir, 'plan.md')
  fs.writeFileSync(planPath, buildPlan([
    taskBlock({ id: '1', title: 'first', creates: 'pkg/d3one.py',
      clause1: 'Task 1 writes its file.', clause2: 'Task 1 reports success.',
      testPath: 'fleet/tests/test_d3_one_stub.mjs' }),
    taskBlock({ id: '2', title: 'second', creates: 'pkg/d3two.py',
      clause1: 'Task 2 needs nothing.', clause2: 'Task 2 writes its own file.',
      testPath: 'fleet/tests/test_d3_two_stub.mjs' }),
  ]))

  const result = await runEngine({ plan: planPath, target: repo, runDir }, {
    worker: makeWorker({ calls: [] }),
    judge: {},
    sh: makeSh({}),
    git: realGit,
    log: () => {},
  })

  assert.deepEqual(Object.keys(result).sort(), ['adopted', 'cost_usd', 'done', 'head', 'wall_ms'],
    '(a)/M1: with no --kata-url and no board, runEngine still resolves exactly the five keys — got ' + show(Object.keys(result)))
  assert.equal(result.done, true,
    '(a)/M1: the fixture drive adopts every task — got done=' + show(result.done))
  assert.deepEqual([...result.adopted].sort(), ['1', '2'],
    '(a)/M1: the fixture drive adopts every task — got adopted=' + show(result.adopted))
}

// ════════════════════════════════════════════════════════════════════════════
// (c)/M3 — DRIVE C: every dispatched prompt carries board.factsFor appended.
// ════════════════════════════════════════════════════════════════════════════
{
  const dir = mkTmp('fx-engine-dc-')
  const repo = makeRepoDir(path.join(dir, 'target'))
  const runDir = path.join(dir, 'run')
  const planPath = path.join(dir, 'plan.md')
  fs.writeFileSync(planPath, buildPlan([
    taskBlock({ id: '1', title: 'has facts', creates: 'pkg/c1.py',
      clause1: 'Task 1 writes its file.', clause2: 'Task 1 is reviewed by a referee.',
      testPath: 'fleet/tests/test_c1_stub.mjs' }),
    taskBlock({ id: '3', title: 'has no facts', creates: 'pkg/c3.py',
      clause1: 'Task 3 writes its file.', clause2: 'Task 3 reports success.',
      testPath: 'fleet/tests/test_c3_stub.mjs' }),
  ]))

  const FACTS1 = '[exam-note]\nleg (c) measures M3'
  const boardC = makeStubBoard({ factsFor: async (id) => (id === '1' ? FACTS1 : '') })
  const judgeC = {
    readTask: async ({ id }) => ({ k: 1, referee: id === '1' }),
    readLanding: async () => ({ claim: 0.9, coverage: [0.9, 0.9] }),
    gradeFinding: async () => 'blocking',
  }
  const callsC = []
  const workerC = makeWorker({
    calls: callsC,
    behaviors: {
      'referee:1': async () => ({
        result: {
          result: 'referee found one',
          structured_output: { findings: [{ detail: 'needs a fix', path: 'pkg/c1.py' }] },
          total_cost_usd: 0.001,
        }, denials: [],
      }),
    },
  })

  await runEngine({ plan: planPath, target: repo, runDir }, {
    worker: workerC, judge: judgeC, sh: makeSh({}), git: realGit, board: boardC, log: () => {},
  })

  const HANDOFF1 = '\n\nHAND-OFF:\n' + FACTS1
  const forTask1 = callsC.filter((c) => c.task === '1')
  assert.ok(forTask1.length >= 3,
    '(c)/M3: task 1 dispatches at least exam, implement and referee — got ' + show(forTask1.map((c) => c.label)))
  for (const c of forTask1) {
    assert.ok(c.prompt.endsWith(HANDOFF1),
      '(c)/M3: every prompt dispatched for task 1 (' + c.label + ') ends with "\\n\\nHAND-OFF:\\n" + board.factsFor(task.id) — got tail ' +
      show(c.prompt.slice(-140)))
  }

  const forTask3 = callsC.filter((c) => c.task === '3')
  assert.ok(forTask3.length >= 2,
    '(c)/M3: task 3 dispatches at least exam and implement — got ' + show(forTask3.map((c) => c.label)))
  for (const c of forTask3) {
    assert.ok(!c.prompt.includes('HAND-OFF:'),
      '(c)/M3: no prompt for task 3 contains HAND-OFF: since board.factsFor(\'3\') is empty — got ' + c.label)
  }
}

// ════════════════════════════════════════════════════════════════════════════
// (d)/M4 — DRIVE D: a red exam, or low lowest-clause coverage, buys exactly
// one more implementer dispatch, in the same clone, before re-measuring.
// ════════════════════════════════════════════════════════════════════════════
async function runRedispatchCase ({ label, examStatuses, coverage }) {
  const dir = mkTmp('fx-engine-dd-' + label + '-')
  const repo = makeRepoDir(path.join(dir, 'target'))
  const runDir = path.join(dir, 'run')
  const planPath = path.join(dir, 'plan.md')
  fs.writeFileSync(planPath, buildPlan([
    taskBlock({
      id: 'R', title: 'redispatch ' + label, creates: 'pkg/r_' + label + '.py',
      clause1: 'Task R writes its file cleanly.', clause2: 'Task R reports a claim.',
      testPath: 'fleet/tests/test_r_' + label + '_stub.mjs',
    }),
  ]))

  const calls = []
  const worker = makeWorker({ calls })
  const judge = {
    readTask: async () => ({ k: 1, referee: false }),
    readLanding: async () => ({ claim: 1, coverage }),
  }
  const sh = makeSh({ examScript: { 'impl-R-0': examStatuses.map((s) => ({ status: s })) } })
  const board = makeStubBoard()

  await runEngine({ plan: planPath, target: repo, runDir }, { worker, judge, sh, git: realGit, board, log: () => {} })

  const events = fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
  const implCalls = calls.filter((c) => c.task === 'R' && c.role === 'implement')
  return { calls, implCalls, events, board }
}

{
  const { implCalls, events, board } = await runRedispatchCase({ label: 'exitfix', examStatuses: [1, 0], coverage: [0.9, 0.9] })
  assert.equal(implCalls.length, 2,
    '(d)/M4: a red first exam gets exactly one more implementer dispatch, in the same clone, before measuring again — got ' +
    implCalls.length + ' implementer dispatches')
  assert.ok(implCalls[1].prompt.includes('HAND-OFF:'),
    '(d)/M4: the second implementer dispatch carries the hand-off')
  const landingRow = events.find((e) => e.kind === 'landing' && e.task === 'R')
  assert.ok(landingRow, '(d)/M4: task R lands and events.jsonl carries its landing row — events: ' + show(events))
  assert.equal(landingRow.examExit, 0,
    '(d)/M4: the landing row carries the kept second measurement\'s exam exit 0 — got ' + show(landingRow.examExit))
  const redispatchPost = board.posts.find((p) => p.task === 'R' && p.kind === 'redispatch')
  assert.ok(redispatchPost, '(b)/M2: a redispatch post is made when a second attempt starts — posts: ' + show(board.posts))
}

{
  const { implCalls } = await runRedispatchCase({ label: 'bothred', examStatuses: [1, 1], coverage: [0.9, 0.9] })
  assert.equal(implCalls.length, 2,
    '(d)/M4: the engine never dispatches a third implementer, even when the second attempt is also red — got ' + implCalls.length)
}

{
  const { implCalls } = await runRedispatchCase({ label: 'lowcov', examStatuses: [0, 0], coverage: [0.9, 0.3] })
  assert.equal(implCalls.length, 2,
    '(d)/M4: a lowest clause coverage below the redispatch floor (0.3 < 0.5) triggers one more implementer dispatch — got ' + implCalls.length)
}

{
  const { implCalls } = await runRedispatchCase({ label: 'okcov', examStatuses: [0], coverage: [0.9, 0.6] })
  assert.equal(implCalls.length, 1,
    '(d)/M4: a lowest clause coverage at or above the redispatch floor (0.6 >= 0.5) never triggers redispatch — got ' + implCalls.length)
}

{
  const policy = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'factory/policy.json'), 'utf8'))
  assert.deepEqual(policy.landing && policy.landing.redispatch, {
    enabled: true, coverage_floor: 0.5, n: 0, window: 'none', basis: 'judgment', experiment: true, rollback: 'enabled = false',
  }, '(d)/M4: factory/policy.json parses with landing.redispatch deep-equal to the clause\'s object — got ' +
    show(policy.landing && policy.landing.redispatch))
}

// ════════════════════════════════════════════════════════════════════════════
// (e)/M5 — DRIVE E: fold on every adoption, re-read readiness immediately.
// ════════════════════════════════════════════════════════════════════════════
{
  const dir = mkTmp('fx-engine-e1-')
  const repo = makeRepoDir(path.join(dir, 'target'))
  const runDir = path.join(dir, 'run')
  const planPath = path.join(dir, 'plan.md')
  fs.writeFileSync(planPath, buildPlan([
    taskBlock({ id: '1', title: 'predecessor', creates: 'pkg/e1_one.py',
      clause1: 'Task 1 writes its file.', clause2: 'Task 1 produces an interface.',
      produces: 'ifaceE', testPath: 'fleet/tests/test_e1_one_stub.mjs' }),
    taskBlock({ id: '2', title: 'dependent', creates: 'pkg/e1_two.py',
      clause1: 'Task 2 waits on task 1.', clause2: 'Task 2 writes its own file.',
      consumes: 'ifaceE', testPath: 'fleet/tests/test_e1_two_stub.mjs' }),
    taskBlock({ id: '3', title: 'independent', creates: 'pkg/e1_three.py',
      clause1: 'Task 3 needs nothing.', clause2: 'Task 3 writes its own file.',
      testPath: 'fleet/tests/test_e1_three_stub.mjs' }),
  ]))

  let release3
  const gate3 = new Promise((resolve) => { release3 = resolve })
  const calls = []
  const worker = makeWorker({
    calls,
    behaviors: {
      'exam:3': async () => { await gate3; return { result: { result: 'exam:3 done', total_cost_usd: 0 }, denials: [] } },
    },
  })
  const boardE1 = makeStubBoard()
  const runPromise = runEngine({ plan: planPath, target: repo, runDir }, {
    worker, judge: { readTask: async () => ({ k: 1, referee: false }) },
    sh: makeSh({}), git: realGit, board: boardE1, log: () => {},
  })

  const deadline = Date.now() + 10000
  while (Date.now() < deadline && !calls.some((c) => c.label === 'impl:2:0')) {
    await new Promise((r) => setTimeout(r, 15))
  }
  const dispatchedImpl2 = calls.some((c) => c.label === 'impl:2:0')
  const task1Landed = boardE1.posts.some((p) => p.task === '1' && p.kind === 'landing')
  const task3StillGated = calls.filter((c) => c.task === '3').every((c) => c.label === 'exam:3')
  release3()
  const result = await runPromise

  assert.ok(dispatchedImpl2,
    '(e)/M5: task 2\'s implementer is dispatched once task 1 (its only predecessor) adopts — no dispatch seen within the wait window; calls: ' +
    show(calls.map((c) => c.label)))
  assert.ok(task1Landed,
    '(e)/M5: task 2\'s implementer dispatch happens after task 1\'s landing row is posted')
  assert.ok(task3StillGated,
    '(e)/M5: task 2\'s implementer is dispatched while task 3 — a sibling from the same initial ready set — is still in flight, held on its exam worker')
  assert.deepEqual([...result.adopted].sort(), ['1', '2', '3'],
    '(e)/M5: sanity — all three tasks eventually adopt once task 3 is released')
}

{
  const dir = mkTmp('fx-engine-e2-')
  const repo = makeRepoDir(path.join(dir, 'target'))
  const runDir = path.join(dir, 'run')
  const planPath = path.join(dir, 'plan.md')
  fs.writeFileSync(planPath, buildPlan([
    taskBlock({ id: '1', title: 'predecessor parks', creates: 'pkg/e2_one.py',
      clause1: 'Task 1 writes its file.', clause2: 'Task 1 produces an interface.',
      produces: 'ifaceE2', testPath: 'fleet/tests/test_e2_one_stub.mjs' }),
    taskBlock({ id: '2', title: 'dependent', creates: 'pkg/e2_two.py',
      clause1: 'Task 2 waits on task 1.', clause2: 'Task 2 writes its own file.',
      consumes: 'ifaceE2', testPath: 'fleet/tests/test_e2_two_stub.mjs' }),
    taskBlock({ id: '3', title: 'independent', creates: 'pkg/e2_three.py',
      clause1: 'Task 3 needs nothing.', clause2: 'Task 3 writes its own file.',
      testPath: 'fleet/tests/test_e2_three_stub.mjs' }),
  ]))

  const calls2 = []
  const worker2 = makeWorker({
    calls: calls2,
    behaviors: { 'impl:1:0': async () => { throw new Error('boom: predecessor worker crashed') } },
  })
  const board2 = makeStubBoard()
  await runEngine({ plan: planPath, target: repo, runDir }, {
    worker: worker2, judge: { readTask: async () => ({ k: 1, referee: false }) },
    sh: makeSh({}), git: realGit, board: board2, log: () => {},
  })

  assert.ok(!calls2.some((c) => c.task === '2'),
    '(e)/M5: task 2 is never dispatched once its predecessor (task 1) parks — dispatches for task 2: ' +
    show(calls2.filter((c) => c.task === '2').map((c) => c.label)))
  const events = fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
  const parkedRow2 = events.find((e) => e.kind === 'parked' && e.task === '2')
  assert.ok(parkedRow2, '(e)/M5: task 2 gets a parked row once task 1 parks — events: ' + show(events.map((e) => e.kind + ':' + e.task)))
  assert.ok(/\b1\b/.test(String(parkedRow2.reason)),
    '(e)/M5: the parked row\'s reason names the parked predecessor (task 1) — got ' + show(parkedRow2.reason))
}

// ════════════════════════════════════════════════════════════════════════════
// (f)/M6 — DRIVE F: worker:tool and worker:test-run telemetry, unconditional.
// ════════════════════════════════════════════════════════════════════════════
{
  const dir = mkTmp('fx-engine-f-')
  const repo = makeRepoDir(path.join(dir, 'target'))
  const runDir = path.join(dir, 'run')
  const planPath = path.join(dir, 'plan.md')
  fs.writeFileSync(planPath, buildPlan([
    taskBlock({ id: 'M6', title: 'telemetry', creates: 'pkg/m6.py',
      clause1: 'Task M6 writes its file.', clause2: 'Task M6 runs its own test.',
      testPath: 'fleet/tests/test_m6_stub.mjs' }),
  ]))

  const TEST_CMD = 'node fleet/tests/test_m6_stub.mjs'
  const calls = []
  const worker = makeWorker({
    calls,
    behaviors: {
      'impl:M6:0': async (opts) => {
        fs.writeFileSync(path.join(opts.cwd, 'note.txt'), 'impl\n')
        if (typeof opts.onMessage === 'function') {
          await opts.onMessage({
            type: 'assistant',
            message: {
              content: [
                { type: 'tool_use', id: 'tu1', name: 'Edit', input: { file_path: 'a.py' } },
                { type: 'tool_use', id: 'tu2', name: 'Bash', input: { command: TEST_CMD } },
                { type: 'tool_use', id: 'tu3', name: 'Bash', input: { command: 'ls -la' } },
              ],
            },
          })
          await opts.onMessage({
            type: 'user',
            message: {
              content: [
                { type: 'tool_result', tool_use_id: 'tu2', is_error: true, content: 'FAILED' },
                { type: 'tool_result', tool_use_id: 'tu3', is_error: false, content: 'ok' },
              ],
            },
          })
        }
        return { result: { result: 'impl:M6:0 done', total_cost_usd: 0 }, denials: [] }
      },
    },
  })

  await runEngine({ plan: planPath, target: repo, runDir }, {
    worker, judge: { readTask: async () => ({ k: 1, referee: false }) },
    sh: makeSh({}), git: realGit, board: makeStubBoard(), log: () => {},
  })

  const events = fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
  const toolRows = events.filter((e) => e.kind === 'worker:tool' && e.task === 'M6')
  const editRow = toolRows.find((r) => r.tool === 'Edit')
  assert.ok(editRow, '(f)/M6: a worker:tool row is appended for the Edit tool_use — rows: ' + show(toolRows))
  assert.equal(editRow.target, 'a.py',
    '(f)/M6: the Edit row\'s target is the input\'s file_path — got ' + show(editRow.target))
  assert.equal(editRow.label, 'impl:M6:0',
    '(f)/M6: the tool row carries the dispatch label — got ' + show(editRow.label))

  const bashRows = toolRows.filter((r) => r.tool === 'Bash')
  assert.equal(bashRows.length, 2,
    '(f)/M6: a worker:tool row is appended for every Bash tool_use, matching or not — got ' + bashRows.length)
  const bashMatch = bashRows.find((r) => r.target === TEST_CMD)
  assert.ok(bashMatch, '(f)/M6: the matching Bash row\'s target is the command — got ' + show(bashRows))
  const bashOther = bashRows.find((r) => r.target === 'ls -la')
  assert.ok(bashOther, '(f)/M6: the non-matching Bash tool_use still gets a worker:tool row — got ' + show(bashRows))

  const testRunRows = events.filter((e) => e.kind === 'worker:test-run' && e.task === 'M6')
  assert.equal(testRunRows.length, 1,
    '(f)/M6: worker:test-run is appended only for the Bash call whose command contains the task\'s test command — got ' + show(testRunRows))
  assert.equal(testRunRows[0].cmd, TEST_CMD,
    '(f)/M6: the worker:test-run row carries the matched command — got ' + show(testRunRows[0]))
  assert.equal(testRunRows[0].red, true,
    '(f)/M6: red is the tool_result\'s is_error — got ' + show(testRunRows[0].red))
  assert.equal(testRunRows[0].label, 'impl:M6:0',
    '(f)/M6: the worker:test-run row carries the dispatch label — got ' + show(testRunRows[0].label))
}

// ── cleanup ───────────────────────────────────────────────────────────────
for (const d of TMP_DIRS) {
  try { fs.rmSync(d, { recursive: true, force: true }) } catch { /* best effort */ }
}

console.log('test_factory_engine.mjs: all assertions passed')
