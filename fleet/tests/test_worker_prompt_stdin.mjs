/**
 * fleet/tests/test_worker_prompt_stdin.mjs — the exam for Task 1: *the worker
 * hands every prompt to the child on stdin, never on argv*.
 *
 * This file is the Proof's `Test: fleet/tests/test_worker_prompt_stdin.mjs`,
 * written where the Proof names it. Every relative import is written for THIS
 * directory: `../` is the repository's `fleet/`, `./` is `fleet/tests/`.
 *
 * The prompt transport is a surface of its own — the worker's only other sim,
 * `test_worker_kata_env.mjs`, owns the env surface — so it gets its own file,
 * named for it.
 *
 * The legs, and what each asserts. Every assertion below names its leg and the
 * Machine clause it comes from, so a reader can map this file back to the
 * contract:
 *
 *   (a) [M1] One dispatch of a prompt of EXACTLY 200,000 UTF-8 bytes, built
 *       from a repeated line carrying an em-dash, through
 *       `agent(prompt, { label: 'impl:1' })` against a `spawnFn` whose child
 *       records what is written to its `stdin`: the bytes the child's stdin
 *       received are byte-identical to the prompt, and its stdin was ended
 *       (EOF) by the worker. The spawn options' `stdio` is
 *       `['pipe', 'pipe', 'pipe']` (Produces). A worker that still passes the
 *       prompt as argv writes nothing to stdin and fails the byte comparison;
 *       one that writes without ending fails the EOF assertion.
 *   (b) [M2] On that same dispatch, for every element of the recorded argv
 *       `Buffer.byteLength(el, 'utf8') <= 4096`, the argv contains the element
 *       `-p`, and no element `includes(prompt.slice(0, 64))`. The BASE shape
 *       — `['-p', prompt].concat(argv)` — fails the first and the third.
 *   (c) [M3] A second dispatch whose stub child emits its result envelope and
 *       `close(0)` on `setImmediate`, and whose `stdin.end` schedules an
 *       `error` event carrying `code: 'EPIPE'` on the stdin AFTER that close:
 *       `await agent(...)` resolves to the envelope's `structured_output`,
 *       `{ ok: true }`, and no `uncaughtException`/`unhandledRejection` fired
 *       during it. A worker that ends the child's stdin without first
 *       attaching an `error` listener fails this leg by crashing the process
 *       — an unlistened `error` on a stream is an uncaught exception, which
 *       would cost the engine and not one worker.
 *   (d) [M1] The kata-env sim, whose stub now carries a stdin. That leg's live
 *       proof is the Proof's FIRST `Run:` —
 *       `node fleet/tests/test_worker_kata_env.mjs | grep -q 'ALL TESTS
 *       PASSED'` — because a `test_*.mjs` may not spawn another
 *       (`test_sims_are_hermetic.mjs`, M4). Here it is encoded as a static
 *       read of that file's source: its `spawnFn` stub, up to the `return
 *       child` that closes it, names `stdin`. At BASE the word does not occur
 *       in that file at all.
 *
 * Nothing here spawns a `claude` or reaches a network: the worker's process
 * seam is the injected `spawnFn`, the child is a fake, and the environment the
 * worker is handed comes from `simEnv()`. The sim's own `spawnFn` is not a
 * `node:child_process` call, so the hermetic probe's `inherit` rule does not
 * read it.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { fileURLToPath } from 'node:url'

import { createRunWorker } from '../run-worker.mjs'
import { simEnv } from './_helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'worker-prompt-stdin-')))
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }))

// ══ the fixture prompt ═════════════════════════════════════════════════════
// M1's prompt: exactly 200,000 bytes of UTF-8, carrying multi-byte characters.
// 200,000 is over Linux's `MAX_ARG_STRLEN` (131,072 bytes for ONE argv
// element, whatever `ARG_MAX` says) — the cap run-14 died `spawn E2BIG` on
// with a 193,611-byte resolver brief — so a prompt of this size cannot ride on
// argv at all, and the byte comparison in leg (a) is what says where it went
// instead.
//
// The em-dash is not decoration: it is three bytes, so a transport that
// re-encodes or truncates on a chunk boundary shows up as a length or a byte
// mismatch rather than passing quietly. The line is repeated to just under the
// target and the remainder is padded with ASCII, which can never split a
// multi-byte character, so the total lands on 200,000 exactly.
const LINE = 'the brief carries an em-dash — and keeps going, line '
function promptOfExactly (bytes) {
  let out = ''
  for (let n = 0; ; n += 1) {
    const next = LINE + n + '\n'
    if (Buffer.byteLength(out, 'utf8') + Buffer.byteLength(next, 'utf8') > bytes) break
    out += next
  }
  return out + 'x'.repeat(bytes - Buffer.byteLength(out, 'utf8'))
}

const PROMPT = promptOfExactly(200000)
assert.equal(Buffer.byteLength(PROMPT, 'utf8'), 200000,
  '(a) [M1] the fixture prompt is exactly 200,000 bytes of UTF-8')
assert.ok(PROMPT.includes('—'),
  '(a) [M1] and it carries multi-byte characters')
assert.ok(Buffer.byteLength(PROMPT, 'utf8') > PROMPT.length,
  '(a) [M1] — more bytes than characters, so it is genuinely multi-byte')

// The one-line envelope the stub child prints. `agent()` returns its
// `structured_output` on success.
const ENVELOPE = JSON.stringify({
  type: 'result', subtype: 'success', is_error: false, session_id: 's',
  structured_output: { ok: true }, usage: {}, total_cost_usd: 0,
}) + '\n'

// ══ the stub child ═════════════════════════════════════════════════════════

/**
 * A stdin the worker can write to, which keeps every byte it is handed.
 *
 * It accepts BOTH shapes a caller might use — `end(prompt)`, and
 * `write(prompt)` followed by `end()` — so leg (a) pins the bytes and the EOF,
 * which is what M1 says, and not one particular call. A trailing callback
 * argument in either position is honoured, as a real `Writable` would.
 */
function makeStdin ({ onEnd } = {}) {
  const stdin = new EventEmitter()
  stdin.chunks = []
  stdin.ended = false
  stdin.endCalls = 0
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
  stdin.write = (chunk, encoding, cb) => {
    take(chunk, encoding)
    callback(encoding, cb)
    return true
  }
  stdin.end = (chunk, encoding, cb) => {
    take(chunk, encoding)
    stdin.ended = true
    stdin.endCalls += 1
    stdin.writable = false
    callback(chunk, encoding, cb)
    if (onEnd) onEnd(stdin)
    return stdin
  }
  return stdin
}

/**
 * The child `spawnFn` answers with: stdout and stderr emitters carrying a
 * no-op `setEncoding`, a `kill`, and a recording `stdin`. It prints the
 * envelope and closes with `0` on `setImmediate` — so the close always
 * precedes anything `onStdinEnd` schedules on a later turn, which is the
 * ordering M3 describes.
 */
function makeChild ({ onStdinEnd } = {}) {
  const child = new EventEmitter()
  child.stdout = new EventEmitter(); child.stdout.setEncoding = () => {}
  child.stderr = new EventEmitter(); child.stderr.setEncoding = () => {}
  child.kill = () => {}
  child.stdin = makeStdin({ onEnd: onStdinEnd })
  setImmediate(() => {
    child.stdout.emit('data', ENVELOPE)
    child.emit('close', 0, null)
  })
  return child
}

/** A worker with its own run directory, its own `cwd`, and an injected spawn. */
function workerFor (name, spawnFn) {
  const runDir = path.join(tmp, name)
  const workersDir = path.join(runDir, 'workers')
  const cwd = path.join(runDir, 'clone')
  const home = path.join(runDir, 'home')
  for (const d of [workersDir, cwd, home]) fs.mkdirSync(d, { recursive: true })
  return createRunWorker({
    runId: 'run-prompt-stdin',
    workersDir,
    cwdFor: () => cwd,
    cli: 'claude',
    env: simEnv({ home }),
    spawnFn,
  })
}

// ══════════════════════════════════════════════════════════════════════════
// (a) [M1] the prompt reaches the child whole, on stdin, and the stdin is ended
// (b) [M2] and nothing prompt-sized is on the command line
// ══════════════════════════════════════════════════════════════════════════
{
  const seen = []
  const agent = workerFor('m1-m2', (cli, argv, opts) => {
    const child = makeChild()
    seen.push({ cli, argv, opts: opts || {}, child })
    return child
  })

  const out = await agent(PROMPT, { label: 'impl:1' })

  assert.equal(seen.length, 1, '(a) [M1] the dispatch spawned exactly one `claude`')
  const { cli, argv, opts, child } = seen[0]
  assert.equal(cli, 'claude', '(a) [M1] spawned the configured cli')
  assert.deepEqual(out, { ok: true },
    "(a) [M1] and `agent()` resolved with the envelope's `structured_output`")

  // ── (a) [M1] the bytes ────────────────────────────────────────────────────
  const written = Buffer.concat(child.stdin.chunks)
  assert.equal(written.length, Buffer.byteLength(PROMPT, 'utf8'),
    '(a) [M1] the child\'s stdin received the whole 200,000-byte prompt — it received ' +
    written.length + ' bytes. A worker that still passes the prompt as an argv element ' +
    'writes nothing to stdin at all.')
  assert.ok(written.equals(Buffer.from(PROMPT, 'utf8')),
    '(a) [M1] and the bytes it received are byte-identical to the prompt')

  // ── (a) [M1] the EOF ──────────────────────────────────────────────────────
  assert.ok(child.stdin.endCalls >= 1,
    '(a) [M1] the worker ended the child\'s stdin (EOF). A prompt written without an ' +
    'end leaves the CLI waiting on a pipe that never closes.')
  assert.equal(child.stdin.ended, true,
    '(a) [M1] and the stdin is ended after the dispatch')

  // ── (a) Produces: the stdio the spawn asks for ───────────────────────────
  // `createRunWorker(cfg)`'s `runProcess` now spawns with
  // `stdio: ['pipe', 'pipe', 'pipe']` — stdin can only carry the prompt if it
  // is a pipe, and BASE's `'ignore'` is the shape being replaced.
  assert.deepEqual(opts.stdio, ['pipe', 'pipe', 'pipe'],
    "(a) [Produces] the spawn's `stdio` is ['pipe', 'pipe', 'pipe']")

  // ── (b) [M2] the argv ─────────────────────────────────────────────────────
  assert.ok(Array.isArray(argv), '(b) [M2] the spawn was handed an argv array')
  const head = PROMPT.slice(0, 64)
  for (let i = 0; i < argv.length; i += 1) {
    const el = argv[i]
    assert.equal(typeof el, 'string', '(b) [M2] argv element ' + i + ' is a string')
    const bytes = Buffer.byteLength(el, 'utf8')
    assert.ok(bytes <= 4096,
      '(b) [M2] no element of the argv is longer than 4,096 bytes — element ' + i +
      ' is ' + bytes + ' bytes. The largest legitimate element today is a ' +
      '`--json-schema` value of 460 bytes; anything this size is a prompt.')
    assert.ok(!el.includes(head),
      '(b) [M2] no element of the argv contains the prompt\'s first 64 bytes — element ' +
      i + ' does')
  }
  assert.ok(argv.includes('-p'),
    '(b) [M2] the argv contains the element `-p` — the boolean print flag, with no ' +
    'positional prompt after it')
}

// ══════════════════════════════════════════════════════════════════════════
// (c) [M3] a child that exits before reading its stdin does not crash the engine
// ══════════════════════════════════════════════════════════════════════════
{
  // The child prints its envelope and closes with `0` on `setImmediate`; the
  // worker's `stdin.end` then schedules an `EPIPE` error on a LATER turn, so
  // the error always lands after the close — the live shape, where the CLI has
  // already answered and gone before the pipe was drained.
  //
  // An `error` event on a stream with no listener is an uncaught exception.
  // Recording listeners are installed only around the awaited dispatch and its
  // drain, and removed in a `finally` BEFORE any assertion runs, so an
  // assertion failure here can never be swallowed by them.
  const SHORT = 'second dispatch — the child answers and exits before it reads\n'
  const agent = workerFor('m3', () => makeChild({
    onStdinEnd: (stdin) => setImmediate(() => {
      stdin.emit('error', Object.assign(new Error('write EPIPE'),
        { code: 'EPIPE', errno: -32, syscall: 'write' }))
    }),
  }))

  const crashes = []
  const record = (e) => crashes.push(String((e && e.stack) || (e && e.message) || e))
  process.on('uncaughtException', record)
  process.on('unhandledRejection', record)
  let out, thrown = null
  try {
    out = await agent(SHORT, { label: 'impl:2' })
    // Two turns past the dispatch, so anything `stdin.end` scheduled has run.
    await new Promise((r) => setImmediate(() => setImmediate(() => setTimeout(r, 10))))
  } catch (e) {
    thrown = e
  } finally {
    process.off('uncaughtException', record)
    process.off('unhandledRejection', record)
  }

  assert.equal(thrown, null,
    '(c) [M3] the write failure is not thrown out of `agent()` — it threw: ' +
    String(thrown && (thrown.stack || thrown.message)))
  assert.deepEqual(out, { ok: true },
    "(c) [M3] `agent()` resolves with the envelope's `structured_output`; the EPIPE is " +
    'neither thrown nor reported as a worker failure')
  assert.equal(crashes.length, 0,
    '(c) [M3] no `uncaughtException`/`unhandledRejection` fired during the dispatch. A ' +
    'worker that ends the child\'s stdin without first attaching an `error` listener ' +
    'crashes the whole engine here, not one worker. Recorded:\n' + crashes.join('\n---\n'))
}

// ══════════════════════════════════════════════════════════════════════════
// (d) [M1] the kata-env sim's stub carries a stdin
// ══════════════════════════════════════════════════════════════════════════
{
  // The worker now writes to `child.stdin`, so every stub `spawnFn` in the tree
  // must give its child one. `fleet/tests/test_worker_kata_env.mjs` holds the
  // only other such stub; without a stdin, `child.stdin.end(prompt)` throws
  // there and that sim stops printing its sentinel.
  //
  // The leg's LIVE proof is the Proof's first `Run:` —
  // `node fleet/tests/test_worker_kata_env.mjs | grep -q 'ALL TESTS PASSED'`.
  // It is not run from here: `test_sims_are_hermetic.mjs`'s M4 forbids a
  // `test_*.mjs` spawning another. So this reads the source instead.
  // Read, never `existsSync`: `test_sims_are_hermetic.mjs`'s M4 leg (e) names
  // any sim that hands a sibling's `test_*.mjs` name to an existence check, so
  // the name is read as source and the read's own failure is the report.
  const simPath = path.join(HERE, 'test_worker_kata_env.mjs')
  let sim = null
  try { sim = fs.readFileSync(simPath, 'utf8') } catch (e) { sim = null }
  assert.ok(typeof sim === 'string',
    '(d) [M1] fleet/tests/test_worker_kata_env.mjs is in the tree and readable')
  const start = sim.indexOf('const spawnFn')
  assert.ok(start !== -1,
    '(d) [M1] and it still declares its stub `const spawnFn`')
  const end = sim.indexOf('return child', start)
  assert.ok(end !== -1,
    '(d) [M1] whose body answers with a stub child (`return child`)')
  assert.match(sim.slice(start, end), /\bstdin\b/,
    '(d) [M1] and that stub child carries a `stdin` — an object with `on` and `end`, or ' +
    'a Writable. At BASE it has `stdout`, `stderr` and `kill` and no stdin, so the ' +
    'worker\'s `child.stdin.end(prompt)` would throw there.')
}

console.log('ALL TESTS PASSED')
