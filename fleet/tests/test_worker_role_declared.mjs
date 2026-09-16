/**
 * fleet/tests/test_worker_role_declared.mjs — the exam for Task 4: *a worker's
 * role is declared where it is dispatched, never derived from its label*.
 *
 * This file is the Proof's `Test: fleet/tests/test_worker_role_declared.mjs`,
 * written where the Proof names it. Every relative import below is written for
 * THIS directory: `../` is the repository's `fleet/`, `./` is `fleet/tests/`.
 *
 * The Claim: add a dispatch site or rename a label; the worker refuses to start
 * until that site says which role it is, and the tool allowlist, permission
 * mode and writable root it gets are the DECLARED role's — a label's spelling
 * decides nothing.
 *
 * The Machine clauses, restated:
 *
 *   M1 — `createRunWorker`'s `agent(prompt, opts)` requires `opts.role`, one of
 *        `examiner`, `implementer`, `reviewer`, `resolver`, `writeSide`; a
 *        dispatch with no `role`, or a `role` outside that set, throws BEFORE
 *        `spawnFn` is called, with a message naming `role`.
 *   M2 — the declared role is the one the worker uses: it is the `role` on that
 *        dispatch's `worker:start` and `worker:end` events and the argument
 *        handed to `promptFileFor`, `settingsFor`, `addDirsFor`, `timeoutMsFor`
 *        and `effortFor`, and the argv handed to `spawnFn` carries
 *        `--permission-mode` followed by `ROLES[role].permissionMode`,
 *        `--allowedTools` exactly when `ROLES[role].allowedTools` is set and
 *        `--disallowedTools` exactly when `ROLES[role].disallowedTools` is set
 *        — even when the label's prefix would have named another role.
 *   M3 — `fleet/run-worker.mjs` exports no `roleForLabel`, and the token
 *        `roleForLabel` occurs in none of `fleet/run-worker.mjs`,
 *        `fleet/run-engine.mjs`, `fleet/run-main.mjs`.
 *   M4 — every dispatch `fleet/run-engine.mjs` makes declares its role, for
 *        each of the label families `exam:<id>` (examiner), `impl:<id>`
 *        (implementer), `fix:<id>:0` (implementer), `review:<id>:<iter>`
 *        (reviewer), `reconcile:wave<n>:<a>` (writeSide) and
 *        `resolve:wave<n>:<i>:<a>` (resolver).
 *   M5 — `fleet/CONTRACT.md` names `role` as a required dispatch option and,
 *        within 400 characters of that word, lists its five values `examiner`,
 *        `implementer`, `reviewer`, `resolver`, `writeSide` in that order.
 *
 * The Proof legs, and where each is answered below. Every assertion names its
 * leg and the clause it comes from, so a reader can map this file back to the
 * contract:
 *
 *   (a) [M1] `agent('p', { label: 'impl:1' })` against a `spawnFn` stub rejects
 *            with a message containing `role`, and the stub was never called.
 *            One of the two falsifiers of BASE, where `roleForLabel('impl:1')`
 *            answers `implementer` and the dispatch RESOLVES.
 *   (b) [M1] `agent('p', { label: 'impl:1', role: 'janitor' })` rejects the
 *            same way, stub never called.
 *   (c) [M1, M2] five rows, one per declared role, each with `label: 'impl:1'`
 *            and a stub child that prints a success envelope: `agent()`
 *            resolves, the `worker:start` and `worker:end` events carry that
 *            role, the sim's `promptFileFor`, `settingsFor`, `addDirsFor`,
 *            `timeoutMsFor` and `effortFor` each recorded that role as their
 *            argument, and the argv the stub received carries
 *            `--permission-mode` followed by `ROLES[role].permissionMode`,
 *            contains `--allowedTools` iff `ROLES[role].allowedTools` is set
 *            and `--disallowedTools` iff `ROLES[role].disallowedTools` is set.
 *   (d) [M2] `label: 'impl:1', role: 'reviewer'`: the events' `role` is
 *            `reviewer`, the argv carries `--permission-mode dontAsk` and
 *            `--allowedTools` and no `--disallowedTools` — not the
 *            implementer's `bypassPermissions` row the label's prefix names at
 *            BASE. The second falsifier of BASE, which reports `implementer`.
 *   (e) [M3] `import * as worker from '../run-worker.mjs'` has no
 *            `roleForLabel` export. (The Proof's first `Run:` — the token's
 *            zero count across the three sources — is encoded beside it, since
 *            M3 names the token and not only the export.)
 *   (f) [M4] a rig-driven one-task run with a Proof `Test:` path, a red
 *            `proofRuns` command, a passing reviewer and a `check.sh` that is
 *            red after the fold: the recorded `opts.role` is `examiner` for the
 *            `exam:T1` dispatch.
 *   (g) [M4] `implementer` for `impl:T1`.
 *   (h) [M4] `implementer` for `fix:T1:0`.
 *   (i) [M4] `reviewer` for the `review:T1:1` dispatch.
 *   (j) [M4] `writeSide` for `reconcile:wave1:1`.
 *   (k) [M4] `resolveConflicts` with an injected agent over one conflict: the
 *            `resolve:…` dispatch's `opts.role` is `resolver`.
 *   (l) [M5] the Proof's second `Run:`, encoded here: with newlines joined, the
 *            word `role` in `fleet/CONTRACT.md` is followed within 400
 *            characters by `examiner`, then `implementer`, `reviewer`,
 *            `resolver` and `writeSide`, each within 80 characters of the one
 *            before. At BASE the contract carries no `writeSide` at all.
 *
 * Nothing here spawns a `claude` or reaches a network. The worker's process
 * seam is the injected `spawnFn` and its child is a fake; the engine legs run
 * the shared rig (`./_engine_helpers.mjs`), which is real below the agent seam
 * and whose every child is handed a `simEnv()` environment; `resolveConflicts`
 * is driven directly with its `agent` and `runCli` seams injected as fakes.
 * Every path this sim writes is under one `mkdtemp` directory in `os.tmpdir()`,
 * removed on exit.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { fileURLToPath } from 'node:url'

// Read through the namespace, never by name: leg (e) is an assertion ABOUT the
// module's exports, and at BASE a named import of a symbol the task deletes
// would link fine while after the task it would not — the namespace form lets
// every leg report rather than letting one link error kill the file.
import * as worker from '../run-worker.mjs'
import { resolveConflicts } from '../run-engine.mjs'
import { simEnv } from './_helpers.mjs'
import { rig, makeRepo, passReview, doneImpl } from './_engine_helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FLEET = path.join(HERE, '..')
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'worker-role-declared-')))
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }))

// The five values M1 names, in the order M1 and M5 name them.
const ROLE_NAMES = ['examiner', 'implementer', 'reviewer', 'resolver', 'writeSide']

assert.equal(typeof worker.createRunWorker, 'function',
  'sim precondition: `fleet/run-worker.mjs` exports `createRunWorker`')
assert.equal(typeof worker.ROLES, 'object',
  'sim precondition: `fleet/run-worker.mjs` exports the `ROLES` table the argv is read against')
for (const role of ROLE_NAMES) {
  assert.ok(worker.ROLES[role],
    'sim precondition: `ROLES` carries the row `' + role + '` M1 names')
}

// ══ the worker rig ═════════════════════════════════════════════════════════
// A `createRunWorker` whose process seam is a fake child, whose five per-role
// lookups record the argument they were handed, and whose events are kept.

/** The one-line envelope the stub child prints; `agent()` returns its `structured_output`. */
const ENVELOPE = JSON.stringify({
  type: 'result', subtype: 'success', is_error: false, session_id: 's',
  structured_output: { ok: true }, usage: {}, total_cost_usd: 0,
}) + '\n'

/** A stdin the worker can attach an `error` listener to and end. */
function makeStdin () {
  const stdin = new EventEmitter()
  stdin.chunks = []
  stdin.write = (chunk) => { if (chunk != null) stdin.chunks.push(String(chunk)); return true }
  stdin.end = (chunk) => { if (chunk != null && typeof chunk !== 'function') stdin.chunks.push(String(chunk)); return stdin }
  stdin.destroy = () => {}
  stdin.setDefaultEncoding = () => stdin
  return stdin
}

/** The stub child: prints the success envelope and closes 0 on `setImmediate`. */
function makeChild () {
  const child = new EventEmitter()
  child.stdout = new EventEmitter(); child.stdout.setEncoding = () => {}
  child.stderr = new EventEmitter(); child.stderr.setEncoding = () => {}
  child.stdin = makeStdin()
  child.kill = () => {}
  setImmediate(() => {
    child.stdout.emit('data', ENVELOPE)
    child.emit('close', 0, null)
  })
  return child
}

/**
 * One worker, its own run directory, its own fake spawn.
 *
 * `seen` holds what each per-role lookup was handed: `promptFileFor`,
 * `settingsFor`, `timeoutMsFor` and `effortFor` take the role alone;
 * `addDirsFor(opts, role)` takes it second, and the SECOND argument is what is
 * recorded — leg (c) reads the role each was given, not the arity.
 */
function workerRig (name) {
  const runDir = path.join(tmp, name)
  const workersDir = path.join(runDir, 'workers')
  const cwd = path.join(runDir, 'clone')
  const home = path.join(runDir, 'home')
  for (const d of [workersDir, cwd, home]) fs.mkdirSync(d, { recursive: true })
  const spawns = []
  const events = []
  const seen = {
    promptFileFor: [], settingsFor: [], addDirsFor: [], timeoutMsFor: [], effortFor: [],
  }
  const agent = worker.createRunWorker({
    runId: 'run-role-declared',
    workersDir,
    cwdFor: () => cwd,
    cli: 'claude',
    env: simEnv({ home }),
    promptFileFor: (role) => { seen.promptFileFor.push(role); return path.join(runDir, 'prompt.md') },
    settingsFor: (role) => { seen.settingsFor.push(role); return path.join(runDir, 'settings.json') },
    addDirsFor: (opts, role) => { seen.addDirsFor.push(role); return [] },
    timeoutMsFor: (role) => { seen.timeoutMsFor.push(role); return 30 * 1000 },
    effortFor: (role) => { seen.effortFor.push(role); return 'medium' },
    onEvent: (e) => events.push(e),
    spawnFn: (cli, argv, opts) => {
      const child = makeChild()
      spawns.push({ cli, argv: Array.isArray(argv) ? argv.slice() : argv, opts: opts || {}, child })
      return child
    },
  })
  return { agent, spawns, events, seen }
}

/** Every event of a kind this dispatch appended, in order. */
const eventsOf = (events, kind) => events.filter((e) => e && e.kind === kind)

// ══════════════════════════════════════════════════════════════════════════
// (a) [M1] a dispatch with NO role refuses, before any process is spawned
// ══════════════════════════════════════════════════════════════════════════
{
  const { agent, spawns, events } = workerRig('leg-a')

  let thrown = null
  try {
    await agent('p', { label: 'impl:1' })
  } catch (e) {
    thrown = e
  }

  assert.ok(thrown !== null,
    '(a) [M1] `agent(\'p\', { label: \'impl:1\' })` REJECTS: `opts.role` is a required ' +
    'dispatch option and this dispatch declares none. At BASE `roleForLabel` reads the ' +
    '`impl` prefix, answers `implementer`, and the dispatch resolves — which is the whole ' +
    'defect: the role came from the label\'s spelling.')
  assert.ok(String((thrown && thrown.message) || thrown).includes('role'),
    '(a) [M1] and the message names `role`, so a new dispatch site is told what it omitted. ' +
    'It said: ' + JSON.stringify(String((thrown && thrown.message) || thrown)))
  assert.equal(spawns.length, 0,
    '(a) [M1] and the refusal came BEFORE `spawnFn` was called — no process was started for a ' +
    'dispatch whose role is unknown. Spawns recorded: ' + spawns.length)
  assert.deepEqual(eventsOf(events, 'worker:start'), [],
    '(a) [M1] and no `worker:start` was appended: there is no worker to start')
}

// ══════════════════════════════════════════════════════════════════════════
// (b) [M1] a role outside the set refuses the same way
// ══════════════════════════════════════════════════════════════════════════
{
  const { agent, spawns } = workerRig('leg-b')

  let thrown = null
  try {
    await agent('p', { label: 'impl:1', role: 'janitor' })
  } catch (e) {
    thrown = e
  }

  assert.ok(thrown !== null,
    '(b) [M1] `role: \'janitor\'` REJECTS: the option is one of `' + ROLE_NAMES.join('`, `') +
    '` and nothing else. A role outside the set that fell back to the label\'s prefix would ' +
    'hand a typo the implementer\'s bypassPermissions posture.')
  assert.ok(String((thrown && thrown.message) || thrown).includes('role'),
    '(b) [M1] and the message names `role`. It said: ' +
    JSON.stringify(String((thrown && thrown.message) || thrown)))
  assert.equal(spawns.length, 0,
    '(b) [M1] and `spawnFn` was never called. Spawns recorded: ' + spawns.length)
}

// ══════════════════════════════════════════════════════════════════════════
// (c) [M1, M2] five rows: the declared role is the one the worker uses
// ══════════════════════════════════════════════════════════════════════════
// The label is `impl:1` on every row — the prefix that names `implementer` at
// BASE — so each row where the declared role is NOT `implementer` is also a
// direct reading of M2's "even when the label's prefix would have named
// another role".
for (const role of ROLE_NAMES) {
  const row = worker.ROLES[role]
  const { agent, spawns, events, seen } = workerRig('leg-c-' + role)

  const out = await agent('p', { label: 'impl:1', role })

  assert.deepEqual(out, { ok: true },
    '(c) [M1] role `' + role + '`: the dispatch is accepted and `agent()` resolves with the ' +
    'envelope\'s `structured_output`')
  assert.equal(spawns.length, 1,
    '(c) [M1] role `' + role + '`: exactly one child was spawned')

  // ── the events ───────────────────────────────────────────────────────────
  const starts = eventsOf(events, 'worker:start')
  const ends = eventsOf(events, 'worker:end')
  assert.equal(starts.length, 1,
    '(c) [M2] role `' + role + '`: one `worker:start` was appended')
  assert.equal(ends.length, 1,
    '(c) [M2] role `' + role + '`: one `worker:end` was appended')
  assert.equal(starts[0].role, role,
    '(c) [M2] role `' + role + '`: the `worker:start` event carries the DECLARED role, not the ' +
    'one the `impl:` prefix names. It carries: ' + JSON.stringify(starts[0].role))
  assert.equal(ends[0].role, role,
    '(c) [M2] role `' + role + '`: and so does `worker:end`. It carries: ' +
    JSON.stringify(ends[0].role))

  // ── the five per-role lookups ────────────────────────────────────────────
  for (const fn of ['promptFileFor', 'settingsFor', 'addDirsFor', 'timeoutMsFor', 'effortFor']) {
    assert.deepEqual(seen[fn], [role],
      '(c) [M2] role `' + role + '`: `' + fn + '` was called exactly once and handed the ' +
      'declared role. It was handed: ' + JSON.stringify(seen[fn]) + '. `promptFileFor` ' +
      'resolves `roles/<role>.md` and `settingsFor` the confine settings, so a lookup handed ' +
      'the label\'s role gets a worker the wrong preamble and the wrong hook.')
  }

  // ── the argv ─────────────────────────────────────────────────────────────
  const argv = spawns[0].argv
  assert.ok(Array.isArray(argv),
    '(c) [M2] role `' + role + '`: the spawn was handed an argv array')
  assert.equal(argv.filter((a) => a === '--permission-mode').length, 1,
    '(c) [M2] role `' + role + '`: the argv carries exactly one `--permission-mode`')
  assert.equal(argv[argv.indexOf('--permission-mode') + 1], row.permissionMode,
    '(c) [M2] role `' + role + '`: `--permission-mode` is followed by `ROLES.' + role +
    '.permissionMode` (`' + row.permissionMode + '`). The argv has: ' +
    JSON.stringify(argv[argv.indexOf('--permission-mode') + 1]))
  assert.equal(argv.includes('--allowedTools'), Boolean(row.allowedTools),
    '(c) [M2] role `' + role + '`: `--allowedTools` is on the argv EXACTLY when `ROLES.' +
    role + '.allowedTools` is set (it is ' + (row.allowedTools ? 'set' : 'not set') + ')')
  assert.equal(argv.includes('--disallowedTools'), Boolean(row.disallowedTools),
    '(c) [M2] role `' + role + '`: `--disallowedTools` is on the argv EXACTLY when `ROLES.' +
    role + '.disallowedTools` is set (it is ' + (row.disallowedTools ? 'set' : 'not set') + ')')
}

// ══════════════════════════════════════════════════════════════════════════
// (d) [M2] an `impl:` label declared `reviewer` gets the REVIEWER's posture
// ══════════════════════════════════════════════════════════════════════════
// The row leg (c) already walked, spelled out against the literal values the
// Proof names — `dontAsk`, an allowlist, no denylist — so the falsifier reads
// as itself rather than as a lookup in a table the implementation supplies.
{
  const { agent, spawns, events } = workerRig('leg-d')

  await agent('p', { label: 'impl:1', role: 'reviewer' })

  assert.equal(spawns.length, 1, '(d) [M2] one child was spawned')
  const starts = eventsOf(events, 'worker:start')
  const ends = eventsOf(events, 'worker:end')
  assert.deepEqual(starts.map((e) => e.role), ['reviewer'],
    '(d) [M2] the one `worker:start` event\'s `role` is `reviewer` — the declared role, not ' +
    'the `implementer` the `impl:` prefix names at BASE. It carries: ' +
    JSON.stringify(starts.map((e) => e.role)))
  assert.deepEqual(ends.map((e) => e.role), ['reviewer'],
    '(d) [M2] and so does the one `worker:end`. It carries: ' +
    JSON.stringify(ends.map((e) => e.role)))

  const argv = spawns[0].argv
  assert.equal(argv[argv.indexOf('--permission-mode') + 1], 'dontAsk',
    '(d) [M2] the argv carries `--permission-mode dontAsk` — the reviewer\'s posture. At BASE ' +
    'this label spawns with `bypassPermissions`, which is the whole of what a label deciding ' +
    'the posture costs. The argv has: ' +
    JSON.stringify(argv[argv.indexOf('--permission-mode') + 1]))
  assert.equal(argv.includes('--allowedTools'), true,
    '(d) [M2] and it carries `--allowedTools` — for the allowlist roles the allowlist IS the ' +
    'boundary for writes: ' + JSON.stringify(argv))
  assert.equal(argv.includes('--disallowedTools'), false,
    '(d) [M2] and no `--disallowedTools`, which is the implementer\'s row and not this one: ' +
    JSON.stringify(argv))
}

// ══════════════════════════════════════════════════════════════════════════
// (e) [M3] the derivation is gone: no export, and no token
// ══════════════════════════════════════════════════════════════════════════
{
  assert.equal(worker.roleForLabel, undefined,
    '(e) [M3] `fleet/run-worker.mjs` exports no `roleForLabel`. The derivation is DELETED, ' +
    'not merely unused: an exported label→role switch beside a declared `opts.role` is a ' +
    'second answer to the same question, and the next dispatch site would find it. It is ' +
    'currently: ' + typeof worker.roleForLabel)
  assert.equal(Object.prototype.hasOwnProperty.call(worker, 'roleForLabel'), false,
    '(e) [M3] and the name is not on the module namespace at all')

  // The Proof's first `Run:`, encoded: the token's count across the three
  // sources is zero. M3 names the TOKEN, not only the export — the comment in
  // `fleet/run-main.mjs` (520-522) that names it is as much a hit as the
  // definition, because a reader who finds the name there goes looking for a
  // function that no longer decides anything.
  const SOURCES = ['run-worker.mjs', 'run-engine.mjs', 'run-main.mjs']
  for (const name of SOURCES) {
    const src = fs.readFileSync(path.join(FLEET, name), 'utf8')
    const hits = src.split('\n')
      .map((line, i) => [i + 1, line])
      .filter(([, line]) => line.includes('roleForLabel'))
    assert.deepEqual(hits, [],
      '(e) [M3] the token `roleForLabel` occurs nowhere in `fleet/' + name + '` — comments ' +
      'included. Lines that carry it: ' +
      JSON.stringify(hits.map(([n, line]) => n + ': ' + line.trim())))
  }
}

// ══════════════════════════════════════════════════════════════════════════
// (f)-(j) [M4] every family the engine dispatches declares its role
// ══════════════════════════════════════════════════════════════════════════
// ONE rig-driven run provokes all five, exactly as the task's Context asks: the
// task carries a Proof `Test:` path (so an examiner is dispatched beside the
// implementer), a `proofRuns` command that is red until the repair round writes
// its marker (so the driver's pre-review pass buys one `fix:T1:0`), a passing
// reviewer (so `review:T1:1` is dispatched), and an implementer that writes the
// rig's `BROKEN` marker, which makes the run-wide `bash check.sh` red on the
// folded candidate and buys exactly one `reconcile:wave1:1`.
//
// Everything below the agent seam is the rig's real thing — real git repos,
// real clones, the real capture, the real fold kernel, the real `sh` — so every
// label read here is a dispatch the engine actually made, and `opts.role` is
// read off the options object the engine handed the seam.
const roleByLabel = {}
const dispatchOrder = []
{
  const repo = makeRepo(path.join(tmp, 'repo-engine'))
  const runDir = path.join(tmp, 'run-engine')
  // Red at BASE (the implementer's clone has no `one.txt`), green on the patch:
  // an exam that is green at BASE establishes nothing and the driver says so.
  const EXAM = '#!/bin/bash\n[ -f one.txt ]\n'
  // Red until the repair round writes `fixed.txt`.
  const RED_RUN = "sh -c 'test -f fixed.txt'"

  const stub = (prompt, opts, cwd) => {
    dispatchOrder.push(opts.label)
    roleByLabel[opts.label] = Object.prototype.hasOwnProperty.call(opts, 'role')
      ? opts.role : '(no role declared)'
    const kind = opts.label.split(':')[0]
    if (kind === 'exam') {
      fs.writeFileSync(path.join(cwd, 't1_test.sh'), EXAM)
      return { status: 'DONE', summary: 'exam written' }
    }
    if (kind === 'impl') {
      fs.writeFileSync(path.join(cwd, 'one.txt'), 'from T1\n')
      fs.writeFileSync(path.join(cwd, 'BROKEN'), 'the marker check.sh reads\n')
      return doneImpl(cwd)
    }
    if (kind === 'fix') {
      fs.writeFileSync(path.join(cwd, 'fixed.txt'), 'the marker the Run: proof reads\n')
      return doneImpl(cwd)
    }
    if (kind === 'review') return passReview()
    if (kind === 'reconcile') {
      // cwd is the integration clone (the reconcile dispatch carries no
      // `isolation: 'worktree'`), which is where the red candidate lives.
      fs.rmSync(path.join(cwd, 'BROKEN'), { force: true })
      return { status: 'FIXED', summary: 'removed the marker' }
    }
    // Recorded above before this throw, so an unexpected family still shows in
    // `dispatchOrder` rather than only as an engine error.
    throw new Error('unexpected dispatch: ' + opts.label)
  }

  const FILES = ['one.txt', 'BROKEN', 'fixed.txt', 't1_test.sh']
  const task = {
    id: 'T1', title: 'the role is declared at the dispatch', files: FILES,
    tier: 'standard', review: 'peer', writes: FILES, commutes: [],
    interfaces: { consumes: [], produces: [] },
    testCmd: 'bash t1_test.sh', proofTests: ['t1_test.sh'], proofRuns: [RED_RUN],
    body: '**Claim:** the tree gains one.txt\n' +
      'Machine: M1. The tree holds `one.txt`.\n\n' +
      '**Proof:**\n- Test: `t1_test.sh`\n- Legs: (a) the exam is green on the patch [M1]',
  }

  const { run } = rig({
    repo, runDir, stub, stamp: 'rd1', waves: [[task]], testCmd: 'bash check.sh',
    // The fold-at-every-landing reading (#1006): the fold trigger is another
    // exam's subject, and this run folds at its landing so the candidate suite
    // runs and the reconcile family is provoked.
    extraArgs: { foldAgeMs: 0 },
  })
  const report = await run()

  // ── sim preconditions: the five families were each dispatched once ───────
  const EXPECTED = ['exam:T1', 'impl:T1', 'fix:T1:0', 'review:T1:1', 'reconcile:wave1:1']
  assert.deepEqual(dispatchOrder, EXPECTED,
    'sim precondition: the run dispatched exactly one worker of each of the five families ' +
    'M4 names, in that order. It dispatched: ' + JSON.stringify(dispatchOrder) +
    ' (report: ' + JSON.stringify(report.tasks) + ')')

  // ── (f) [M4] the examiner ────────────────────────────────────────────────
  assert.equal(roleByLabel['exam:T1'], 'examiner',
    '(f) [M4] the `exam:T1` dispatch declares `role: \'examiner\'`. The examiner is a role of ' +
    'its own precisely because `promptFileFor` resolves `roles/<role>.md`, and the one agent ' +
    'that must not be told to make the suite green is the one writing the thing that measures ' +
    'it. It declared: ' + JSON.stringify(roleByLabel['exam:T1']))

  // ── (g) [M4] the implementer ─────────────────────────────────────────────
  assert.equal(roleByLabel['impl:T1'], 'implementer',
    '(g) [M4] the `impl:T1` dispatch declares `role: \'implementer\'`. It declared: ' +
    JSON.stringify(roleByLabel['impl:T1']))

  // ── (h) [M4] the pre-review repair round ─────────────────────────────────
  assert.equal(roleByLabel['fix:T1:0'], 'implementer',
    '(h) [M4] the `fix:T1:0` dispatch declares `role: \'implementer\'` — the repair round is ' +
    'the implementer again, and says so rather than spelling a prefix that happens to map ' +
    'there. It declared: ' + JSON.stringify(roleByLabel['fix:T1:0']))

  // ── (i) [M4] the referee ─────────────────────────────────────────────────
  assert.equal(roleByLabel['review:T1:1'], 'reviewer',
    '(i) [M4] the `review:T1:1` dispatch declares `role: \'reviewer\'`. It declared: ' +
    JSON.stringify(roleByLabel['review:T1:1']))

  // ── (j) [M4] the reconciler ──────────────────────────────────────────────
  assert.equal(roleByLabel['reconcile:wave1:1'], 'writeSide',
    '(j) [M4] the `reconcile:wave1:1` dispatch declares `role: \'writeSide\'` — the role that ' +
    'writes to the integration clone. It declared: ' +
    JSON.stringify(roleByLabel['reconcile:wave1:1']))
}

// ══════════════════════════════════════════════════════════════════════════
// (k) [M4] the resolver, driven through the exported `resolveConflicts`
// ══════════════════════════════════════════════════════════════════════════
// No conflict has to be manufactured: `resolveConflicts({ … agent })` is the
// engine's own dispatch site for the `resolve:…` family, and it takes its agent
// as a seam — the same way `fleet/tests/test_resolver_brief.mjs` drives it.
{
  const root = fs.mkdtempSync(path.join(tmp, 'leg-k-'))
  const waveDir = fs.mkdtempSync(path.join(root, 'wave-'))
  const open = [{ i: 1, path: 'a.txt', hunksFile: path.join(root, 'h1'), epoch: 1 }]

  // The fake resolver: records the options it was handed, answers RESOLVED.
  const calls = []
  const agent = async (prompt, opts) => {
    calls.push({ label: opts && opts.label,
      role: opts && Object.prototype.hasOwnProperty.call(opts, 'role')
        ? opts.role : '(no role declared)' })
    return { status: 'RESOLVED', hunks: [{ id: 'h1', content: 'x' }], notes: '' }
  }
  // The fake kernel CLI: the one conflict's `resolve` completes the stop.
  const runCli = async () => ({ code: 0, parsed: { applied: true, complete: true, selfChecks: 'ok' } })

  const out = await resolveConflicts({
    agent, runCli, roles: { resolver: 'ROLE\n' }, common: [], taskArgs: [], commutesArgs: [],
    open, contendingBlock: '\nBLOCK', waveDir, labelPrefix: 'resolve:wave1',
  })

  assert.equal(out.ok, true,
    '(k) [M4] sim precondition — the one-conflict stop drains: ' + out.reason)
  assert.equal(calls.length, 1,
    '(k) [M4] sim precondition — one brief for the one open conflict. Got ' + calls.length +
    ': ' + JSON.stringify(calls))
  assert.equal(calls[0].label, 'resolve:wave1:1:1',
    '(k) [M4] sim precondition — the dispatch is the `resolve:wave<n>:<i>:<a>` family: ' +
    JSON.stringify(calls[0].label))
  assert.equal(calls[0].role, 'resolver',
    '(k) [M4] the `resolve:…` dispatch declares `role: \'resolver\'` — since Amendment 10 the ' +
    'driver writes the kernel reply directory from the schema reply, so the resolver is ' +
    'read-only and is NOT the write-side role its label once shared. It declared: ' +
    JSON.stringify(calls[0].role))
}

// ══════════════════════════════════════════════════════════════════════════
// (l) [M5] the contract names the option and lists its five values
// ══════════════════════════════════════════════════════════════════════════
// The Proof's second `Run:`, encoded as that command reads it: newlines joined
// to spaces, then the one window. At BASE the contract carries no `writeSide`
// at all, so this is red there whatever else it says about `role`.
{
  const contract = fs.readFileSync(path.join(FLEET, 'CONTRACT.md'), 'utf8')
  const joined = contract.replace(/\n/g, ' ')
  const WINDOW = /role.{0,400}examiner.{0,80}implementer.{0,80}reviewer.{0,80}resolver.{0,80}writeSide/
  assert.match(joined, WINDOW,
    '(l) [M5] `fleet/CONTRACT.md`, with its newlines joined, carries the word `role` followed ' +
    'within 400 characters by `examiner`, then `implementer`, `reviewer`, `resolver` and ' +
    '`writeSide`, each within 80 characters of the one before — the required dispatch option ' +
    'and its five values, in that order, in one window. This is the Proof\'s second `Run:` ' +
    'line, encoded. The contract currently carries `writeSide` ' +
    (contract.includes('writeSide') ? 'somewhere, but not in that window' : 'nowhere at all') + '.')
}

console.log('ALL TESTS PASSED')
