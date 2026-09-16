/**
 * fleet/tests/test_worker_end_reason.mjs — the exam for Task 1: *a death before
 * the first token carries a typed reason on `worker:end`*.
 *
 * This file is the Proof's `Test: fleet/tests/test_worker_end_reason.mjs`,
 * written where the Proof names it. Every relative import is written for THIS
 * directory: `../` is the repository's `fleet/`, `./` is `fleet/tests/`.
 *
 * WHAT THE CLAIM ASKS FOR. Read the record of a worker that exited without ever
 * reaching the model, and the `worker:end` line says which of two things
 * happened — the process never started, or it ran and exited with no reply —
 * with the exit code or errno and the last of what it wrote to stderr. At BASE
 * the two deaths are indistinguishable downstream: `runProcess` folds a spawn
 * `error` into `stderr` and settles `127`, `classify` answers the same
 * `no-envelope` class for both, and the `worker:end` at run-worker.mjs:997
 * carries `outcome/class/status/trace/meter` and nothing about why.
 *
 * THE MACHINE CLAUSES, restated:
 *
 *   M1  Every `worker:end` event `createRunWorker`'s `agent()` emits carries a
 *       `reason` KEY: `null` when a result envelope was read off the child's
 *       stdout, and otherwise an object `{ kind, code, stderr }`.
 *   M2  `kind` is `spawn-error` when the child's `error` event fired before any
 *       `close` (the process never started), with `code` the error's `code`
 *       string (`E2BIG`, `ENOENT`, …); `kind` is `no-envelope` when the child
 *       ran and closed with no result envelope on stdout, with `code` the exit
 *       code as a NUMBER.
 *   M3  `stderr` is the last 400 characters of what the child wrote to stderr,
 *       `''` when it wrote nothing.
 *   M4  The error `agent()` throws for such a dispatch carries the same object
 *       at `workerVerdict.reason`.
 *   M5  `fleet/CONTRACT.md` names `reason` on `worker:end` with both kinds,
 *       `spawn-error` and `no-envelope`.
 *
 * THE LEGS, and what each asserts. Every assertion below names its leg and the
 * clause it comes from, so a reader can map this file back to the contract:
 *
 *   (a) [M1, M2, M3] A `spawnFn` stub whose child writes `boom` to stderr,
 *       nothing to stdout, and closes with code `1`: `await agent(prompt,
 *       opts)` rejects, and the last `worker:end` event carries `reason`
 *       deep-equal to `{ kind: 'no-envelope', code: 1, stderr: 'boom' }`.
 *   (b) [M4] On that same dispatch, the rejection's `workerVerdict.reason` is
 *       deep-equal to the event's `reason`.
 *   (c) [M2] A stub whose child emits an `error` event carrying `code: 'E2BIG'`
 *       and never `close`s on its own: the `worker:end` `reason.kind` is
 *       `spawn-error` and `reason.code` is `'E2BIG'`. Besides those two the leg
 *       pins only the object's KEY SET, `{ kind, code, stderr }` from M1, and
 *       that `stderr` is a string — leg (c) says nothing about what stderr text
 *       a process that never started should carry, and an exam that invented a
 *       value would be pinning one implementation rather than the clause.
 *   (d) [M3] A stub whose child writes 1,000 distinct characters to stderr and
 *       closes `1`: `reason.stderr` has length 400 and equals the last 400 of
 *       what was written.
 *   (e) [M2, M3] A stub that writes nothing to stderr and closes `2`: `reason`
 *       is `{ kind: 'no-envelope', code: 2, stderr: '' }`.
 *   (f) [M1] A stub that prints a success envelope and closes `0`: `reason` is
 *       exactly `null` and `agent()` resolves.
 *   (g) [M1] A stub that prints an envelope and closes `1` with `is_error`
 *       true: `reason` is `null` — an envelope was read, so the class says what
 *       happened and no reason is invented.
 *   (h) [M5] The two `Run:` greps, one per kind, exit 0 against
 *       `fleet/CONTRACT.md`.
 *
 * ON LEG (h)'s FORM. The Proof's two `Run:` lines — `grep -q "spawn-error"
 * fleet/CONTRACT.md` and `grep -q "no-envelope" fleet/CONTRACT.md` — are run
 * live by the driver, as the Proof names them; they are not replaced here. What
 * this file asserts is the SAME PREDICATE in-process, against the same file,
 * read through `import.meta.url` rather than a literal absolute path: both
 * literals are present. It is read rather than spawned because `simEnv`'s
 * `PATH` carries `node`, `python3`, `git`, `bash` and `sh` and no `grep`, so a
 * hermetic spawn of `grep` is not available to a sim here
 * (`fleet/tests/_helpers.mjs`, and `test_sims_are_hermetic.mjs` M2). Beside the
 * two grep predicates the leg also asserts M5's own words — that `reason` is
 * named ON `worker:end`, with both kinds — as a paragraph-sized window around
 * some occurrence of `worker:end` holding all three words. Any prose that says
 * what M5 says satisfies it; no particular sentence is pinned.
 *
 * Nothing here spawns a process or reaches a network: the worker's process seam
 * is the injected `spawnFn`, every child is a fake, and the environment the
 * worker is handed comes from `simEnv()`.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { fileURLToPath } from 'node:url'

import { createRunWorker } from '../run-worker.mjs'
import { simEnv } from './_helpers.mjs'
import { deadlineBudget } from './deadline-slack.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'worker-end-reason-')))
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }))

// ══ the rig ════════════════════════════════════════════════════════════════

/**
 * A stdin the worker can write to. `runProcess` attaches an `error` listener
 * and then calls `child.stdin.end(prompt)` before anything else happens, so
 * every stub child needs one or the dispatch throws before it reaches the
 * behaviour under test. It keeps what it is handed; no leg reads it.
 */
function makeStdin () {
  const stdin = new EventEmitter()
  stdin.chunks = []
  stdin.ended = false
  stdin.writable = true
  const take = (chunk, encoding) => {
    if (chunk === null || chunk === undefined || typeof chunk === 'function') return
    stdin.chunks.push(Buffer.isBuffer(chunk)
      ? chunk
      : Buffer.from(String(chunk), typeof encoding === 'string' ? encoding : 'utf8'))
  }
  const callback = (...args) => {
    const cb = args.find((a) => typeof a === 'function')
    if (cb) setImmediate(cb)
  }
  stdin.setDefaultEncoding = () => stdin
  stdin.cork = () => {}
  stdin.uncork = () => {}
  stdin.destroy = () => { stdin.writable = false }
  stdin.write = (chunk, encoding, cb) => { take(chunk, encoding); callback(encoding, cb); return true }
  stdin.end = (chunk, encoding, cb) => {
    take(chunk, encoding)
    stdin.ended = true
    stdin.writable = false
    callback(chunk, encoding, cb)
    return stdin
  }
  return stdin
}

/**
 * A stub child. `act(child)` runs on `setImmediate` — after `runProcess` has
 * attached its `stdout`/`stderr`/`error`/`close` listeners and written the
 * prompt, which it does synchronously with the spawn — and is the whole of what
 * this particular child does.
 */
function makeChild (act) {
  const child = new EventEmitter()
  child.stdout = new EventEmitter(); child.stdout.setEncoding = () => {}
  child.stderr = new EventEmitter(); child.stderr.setEncoding = () => {}
  child.kill = () => {}
  child.stdin = makeStdin()
  setImmediate(() => act(child))
  return child
}

/**
 * A worker with its own run directory, its own `cwd`, an injected spawn, and an
 * `events` array that collects every `onEvent` the dispatch emits.
 *
 * `spawnSyncFn` is stubbed to a non-zero answer so that no leg can reach a real
 * `curl`: none of these envelopes is a 403, so the reflection probe is never
 * asked, and this is a belt on that.
 */
function workerFor (name, act) {
  const runDir = path.join(tmp, name)
  const workersDir = path.join(runDir, 'workers')
  const cwd = path.join(runDir, 'clone')
  const home = path.join(runDir, 'home')
  for (const d of [workersDir, cwd, home]) fs.mkdirSync(d, { recursive: true })
  const events = []
  const agent = createRunWorker({
    runId: 'run-end-reason',
    workersDir,
    cwdFor: () => cwd,
    cli: 'claude',
    env: simEnv({ home }),
    spawnFn: () => makeChild(act),
    spawnSyncFn: () => ({ status: 1, stdout: '', stderr: 'no curl in a sim', error: null }),
    onEvent: (e) => events.push(e),
  })
  return { agent, events }
}

/** The last `worker:end` this dispatch emitted, or null when it emitted none. */
function lastEnd (events) {
  const ends = events.filter((e) => e && e.kind === 'worker:end')
  return ends.length ? ends[ends.length - 1] : null
}

/**
 * Await one dispatch and answer `{ value }` or `{ error }` — both outcomes are
 * data here, since half these legs end in a rejection by design.
 *
 * Raced against a wall-clock budget so that a dispatch which never settles
 * fails NAMING ITS LEG rather than hanging until the suite's own timeout kills
 * the file with nothing said. The budget is scaled by `deadline-slack.mjs`, the
 * one multiplier the suite's deadlines use; every child here answers on the
 * next turn of the event loop, so any real wait is a wedge.
 */
async function settle (leg, promise) {
  const budget = deadlineBudget(5000)
  let timer = null
  const guard = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(
      leg + ' — `agent()` never settled within ' + budget + ' ms. The dispatch is wedged: ' +
      'its child has already answered, so nothing is left to wait for.')), budget)
  })
  try {
    return await Promise.race([
      promise.then((value) => ({ value, error: null })).catch((error) => ({ value: undefined, error })),
      guard,
    ])
  } finally {
    clearTimeout(timer)
  }
}

/** The one-line envelope a stub child prints when it has a reply to give. */
const envelopeLine = (fields) => JSON.stringify({
  type: 'result', subtype: 'success', session_id: 's', usage: {}, total_cost_usd: 0, ...fields,
}) + '\n'

const PROMPT = 'the brief a worker that never reached the model was handed\n'

// Every dispatch below declares `role: 'implementer'`. The role is not read off
// the label — `assertDeclaredRole` refuses a dispatch without one BEFORE the
// spawn, so an opts without it would throw ahead of `runProcess` and the legs
// here would read a dispatch that never had a child rather than one that died
// before its first token. The role itself is nothing to these legs: `reason`
// is about the child's death, not about the allowlist it was handed.

// ══════════════════════════════════════════════════════════════════════════
// (a) [M1, M2, M3] the child ran, wrote `boom` to stderr, and closed 1
// (b) [M4]         and the rejection carries the same object
// ══════════════════════════════════════════════════════════════════════════
{
  const { agent, events } = workerFor('a-b', (child) => {
    child.stderr.emit('data', 'boom')
    child.emit('close', 1, null)
  })

  const { value, error } = await settle('(a) [M1]', agent(PROMPT, { label: 'impl:1', role: 'implementer' }))

  assert.ok(error,
    '(a) [M1] `agent()` rejects for a dispatch with no envelope on stdout — it resolved with ' +
    JSON.stringify(value))

  const end = lastEnd(events)
  assert.ok(end,
    '(a) [M1] the dispatch emitted a `worker:end` event')
  assert.ok(Object.prototype.hasOwnProperty.call(end, 'reason'),
    '(a) [M1] every `worker:end` carries a `reason` KEY. This one carries only: ' +
    Object.keys(end).join(', ') + '. At BASE the event is built from ' +
    '`outcome/class/status/trace/meter` and nothing says why a worker died before its first ' +
    'token.')
  assert.deepEqual(end.reason, { kind: 'no-envelope', code: 1, stderr: 'boom' },
    '(a) [M1, M2, M3] the child ran and closed with no result envelope on stdout, so `reason` is ' +
    "`{ kind: 'no-envelope', code: 1, stderr: 'boom' }` — `kind` the second of the two deaths " +
    '(M2), `code` the exit code as a NUMBER (M2), `stderr` the last 400 characters of what the ' +
    'child wrote (M3). It carries: ' + JSON.stringify(end.reason))

  // ── (b) [M4] the thrown error carries the same object ─────────────────────
  assert.ok(error.workerVerdict && typeof error.workerVerdict === 'object',
    '(b) [M4] the thrown error carries its `workerVerdict` — it threw: ' +
    String((error && error.message) || error))
  assert.ok(Object.prototype.hasOwnProperty.call(error.workerVerdict, 'reason'),
    '(b) [M4] and that verdict carries a `reason` key. It carries only: ' +
    Object.keys(error.workerVerdict).join(', '))
  assert.deepEqual(error.workerVerdict.reason, end.reason,
    '(b) [M4] the error `agent()` throws for such a dispatch carries the SAME object at ' +
    '`workerVerdict.reason` as the event does. Event: ' + JSON.stringify(end.reason) +
    '; thrown: ' + JSON.stringify(error.workerVerdict.reason))
}

// ══════════════════════════════════════════════════════════════════════════
// (c) [M2] the process never started: `error` before any `close`
// ══════════════════════════════════════════════════════════════════════════
{
  // The shape run-14 died on: a brief too large for `MAX_ARG_STRLEN`, refused by
  // the kernel at `execve`. Node emits `error` on the child and the process
  // never runs, so no `close` of its own ever follows — the stub does exactly
  // that and nothing else.
  const { agent, events } = workerFor('c', (child) => {
    child.emit('error', Object.assign(new Error('spawn claude E2BIG'),
      { code: 'E2BIG', errno: -7, syscall: 'spawn claude', path: 'claude' }))
  })

  const { error } = await settle('(c) [M2]', agent(PROMPT, { label: 'impl:2', role: 'implementer' }))
  assert.ok(error,
    '(c) [M2] a dispatch whose process never started does not resolve')

  const end = lastEnd(events)
  assert.ok(end,
    '(c) [M2] the dispatch emitted a `worker:end` event')
  assert.ok(Object.prototype.hasOwnProperty.call(end, 'reason'),
    '(c) [M1] and it carries a `reason` key. It carries only: ' + Object.keys(end).join(', '))
  assert.ok(end.reason && typeof end.reason === 'object' && !Array.isArray(end.reason),
    '(c) [M1] `reason` is an object here — no envelope was read off stdout. It is: ' +
    JSON.stringify(end.reason))
  assert.deepEqual(Object.keys(end.reason).slice().sort(), ['code', 'kind', 'stderr'],
    '(c) [M1] and that object is `{ kind, code, stderr }` — exactly those three keys. It has: ' +
    Object.keys(end.reason).join(', '))
  assert.equal(end.reason.kind, 'spawn-error',
    "(c) [M2] `kind` is `spawn-error` when the child's `error` event fired before any `close` — " +
    'the process never started. It is: ' + JSON.stringify(end.reason.kind) + '. At BASE this ' +
    'death is folded into stderr and settled 127, indistinguishable from a child that ran.')
  assert.equal(end.reason.code, 'E2BIG',
    "(c) [M2] and `code` is the error's own `code` string, `'E2BIG'` — not an exit code and not " +
    'a number. It is: ' + JSON.stringify(end.reason.code))
  assert.equal(typeof end.reason.stderr, 'string',
    '(c) [M3] `stderr` is a string on every reason object. Leg (c) pins no value for it: a ' +
    'process that never started wrote nothing of its own.')
}

// ══════════════════════════════════════════════════════════════════════════
// (d) [M3] the 400-character tail
// ══════════════════════════════════════════════════════════════════════════
{
  // 1,000 DISTINCT characters, so "the last 400" has exactly one answer and an
  // implementation that kept the first 400, or the last 400 of one chunk,
  // cannot coincide with it. U+0100…U+04E7: distinct, and each a single UTF-16
  // code unit, so `.length` counts characters — which is what M3 says, and what
  // the `.slice(-400)` tail `gitOf` keeps for a git failure does.
  let BIG = ''
  for (let i = 0; i < 1000; i += 1) BIG += String.fromCharCode(0x100 + i)
  assert.equal(BIG.length, 1000,
    '(d) [M3] the fixture is 1,000 characters')
  assert.equal(new Set(BIG).size, 1000,
    '(d) [M3] and all 1,000 are distinct')

  // Three chunks, as a pipe would deliver them, and the last 400 characters
  // straddle the last two — so a worker that reports one chunk rather than the
  // accumulated text fails here.
  const CHUNKS = [BIG.slice(0, 400), BIG.slice(400, 750), BIG.slice(750)]
  assert.equal(CHUNKS.join(''), BIG,
    '(d) [M3] the chunks reassemble to the fixture')

  const { agent, events } = workerFor('d', (child) => {
    for (const c of CHUNKS) child.stderr.emit('data', c)
    child.emit('close', 1, null)
  })

  const { error } = await settle('(d) [M3]', agent(PROMPT, { label: 'impl:3', role: 'implementer' }))
  assert.ok(error,
    '(d) [M3] a dispatch with no envelope on stdout rejects')

  const end = lastEnd(events)
  assert.ok(end && Object.prototype.hasOwnProperty.call(end, 'reason'),
    '(d) [M1] the `worker:end` carries a `reason` key')
  assert.ok(end.reason && typeof end.reason === 'object',
    '(d) [M1] and `reason` is an object — no envelope was read. It is: ' +
    JSON.stringify(end.reason))
  assert.equal(end.reason.stderr.length, 400,
    '(d) [M3] `stderr` is the LAST 400 characters of what the child wrote — the child wrote ' +
    '1,000, so this is 400 long. It is ' + String(end.reason.stderr.length) + ' long.')
  assert.equal(end.reason.stderr, BIG.slice(-400),
    '(d) [M3] and it equals the last 400 of what was written, character for character — not the ' +
    'first 400, not the last chunk, not a byte-counted tail.')
}

// ══════════════════════════════════════════════════════════════════════════
// (e) [M2, M3] nothing on stderr, closed 2
// ══════════════════════════════════════════════════════════════════════════
{
  const { agent, events } = workerFor('e', (child) => {
    child.emit('close', 2, null)
  })

  const { error } = await settle('(e) [M2]', agent(PROMPT, { label: 'impl:4', role: 'implementer' }))
  assert.ok(error,
    '(e) [M2] a dispatch with no envelope on stdout rejects')

  const end = lastEnd(events)
  assert.ok(end && Object.prototype.hasOwnProperty.call(end, 'reason'),
    '(e) [M1] the `worker:end` carries a `reason` key. It carries only: ' +
    Object.keys(end || {}).join(', '))
  assert.deepEqual(end.reason, { kind: 'no-envelope', code: 2, stderr: '' },
    "(e) [M2, M3] `reason` is `{ kind: 'no-envelope', code: 2, stderr: '' }` — `code` the exit " +
    'code as a number, whatever number it is, and `stderr` the empty string when the child wrote ' +
    'nothing (M3), never null and never absent. It is: ' + JSON.stringify(end.reason))
}

// ══════════════════════════════════════════════════════════════════════════
// (f) [M1] an envelope was read: `reason` is exactly null
// ══════════════════════════════════════════════════════════════════════════
{
  const { agent, events } = workerFor('f', (child) => {
    child.stdout.emit('data', envelopeLine({ is_error: false, structured_output: { ok: true } }))
    child.emit('close', 0, null)
  })

  const { value, error } = await settle('(f) [M1]', agent(PROMPT, { label: 'impl:5', role: 'implementer' }))
  assert.equal(error, null,
    '(f) [M1] `agent()` resolves for a child that printed a success envelope and closed 0 — it ' +
    'threw: ' + String((error && (error.stack || error.message)) || error))
  assert.deepEqual(value, { ok: true },
    "(f) [M1] and resolves with the envelope's `structured_output`")

  const end = lastEnd(events)
  assert.ok(end,
    '(f) [M1] the dispatch emitted a `worker:end` event')
  assert.ok(Object.prototype.hasOwnProperty.call(end, 'reason'),
    '(f) [M1] which carries a `reason` KEY — every `worker:end` does, including the ones that ' +
    'succeeded. It carries only: ' + Object.keys(end).join(', '))
  assert.equal(end.reason, null,
    '(f) [M1] and `reason` is exactly `null` when a result envelope was read off the child\'s ' +
    'stdout. It is: ' + JSON.stringify(end.reason))
}

// ══════════════════════════════════════════════════════════════════════════
// (g) [M1] an envelope was read and it reported an error: still null
// ══════════════════════════════════════════════════════════════════════════
{
  const { agent, events } = workerFor('g', (child) => {
    child.stdout.emit('data', envelopeLine({
      is_error: true, result: 'the worker reported a failure', structured_output: null,
    }))
    child.emit('close', 1, null)
  })

  const { error } = await settle('(g) [M1]', agent(PROMPT, { label: 'impl:6', role: 'implementer' }))
  assert.ok(error,
    '(g) [M1] a worker whose envelope reports `is_error` still fails its task')

  const end = lastEnd(events)
  assert.ok(end && Object.prototype.hasOwnProperty.call(end, 'reason'),
    '(g) [M1] the `worker:end` carries a `reason` key. It carries only: ' +
    Object.keys(end || {}).join(', '))
  assert.equal(end.reason, null,
    '(g) [M1] `reason` is `null` here too: an envelope WAS read off stdout, so this is not a ' +
    'death before the first token. The class says what happened and no reason is invented. It ' +
    'is: ' + JSON.stringify(end.reason))
  assert.equal(end.class, 'error',
    "(g) [M1] and the class is still `error`, read off the envelope as it was at BASE — the " +
    "event's other keys are unchanged by this task")
}

// ══════════════════════════════════════════════════════════════════════════
// (h) [M5] fleet/CONTRACT.md names `reason` on `worker:end` with both kinds
// ══════════════════════════════════════════════════════════════════════════
{
  // The same predicate as the Proof's two `Run:` lines, asserted in-process:
  //   grep -q "spawn-error" fleet/CONTRACT.md
  //   grep -q "no-envelope" fleet/CONTRACT.md
  // Both greps are run live by the driver; this is the exam's own reading of
  // them, against the same file, resolved from this file's location rather than
  // a literal absolute path.
  const contractPath = path.join(HERE, '..', 'CONTRACT.md')
  let contract = null
  try { contract = fs.readFileSync(contractPath, 'utf8') } catch { contract = null }
  assert.equal(typeof contract, 'string',
    '(h) [M5] fleet/CONTRACT.md is in the tree and readable')

  assert.ok(contract.includes('spawn-error'),
    '(h) [M5] fleet/CONTRACT.md names the kind `spawn-error` — the Proof\'s first `Run:`, ' +
    '`grep -q "spawn-error" fleet/CONTRACT.md`. At BASE the file has no occurrence of it.')
  assert.ok(contract.includes('no-envelope'),
    '(h) [M5] fleet/CONTRACT.md names the kind `no-envelope` — the Proof\'s second `Run:`, ' +
    '`grep -q "no-envelope" fleet/CONTRACT.md`. At BASE the file has no occurrence of it either, ' +
    'though `classify` has answered that class since long before this task.')

  // And M5's own words: `reason` named ON `worker:end`, with both kinds — not
  // three words scattered across a 1,000-line document. A paragraph-sized
  // window around SOME occurrence of `worker:end` must hold all three. Any
  // prose that says what M5 says passes; no sentence is pinned.
  const WINDOW = 1200
  let named = false
  let best = ''
  for (let i = contract.indexOf('worker:end'); i !== -1; i = contract.indexOf('worker:end', i + 1)) {
    const w = contract.slice(Math.max(0, i - WINDOW), i + WINDOW)
    if (w.includes('reason') && w.includes('spawn-error') && w.includes('no-envelope')) { named = true; break }
    if (w.includes('reason')) best = w
  }
  assert.ok(named,
    '(h) [M5] fleet/CONTRACT.md names `reason` ON `worker:end`, with both kinds: some occurrence ' +
    'of `worker:end` has `reason`, `spawn-error` and `no-envelope` all within ' + WINDOW +
    ' characters of it. Naming the two kinds somewhere else in the document is not the clause — ' +
    'the reader has to be able to tell that they are what the key on that event carries.' +
    (best ? '' : ' No occurrence of `worker:end` has `reason` near it at all.'))
}

console.log('ALL TESTS PASSED')
