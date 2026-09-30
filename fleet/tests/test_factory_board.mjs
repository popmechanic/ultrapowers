/**
 * fleet/tests/test_factory_board.mjs — the exam for `factory/board.mjs`'s
 * CLI: the one module that talks to Kata, holding the run's close, so the
 * boot only ever calls it (Authorized-by #1222, map #1131 rule 6; CLAUDE.md
 * "`board.mjs` is the only module that talks to Kata and never fails a
 * run"). The spoke's `spoke-config`, `wait` and `install` are gone (#1390),
 * and with them the legs that drove them.
 *
 * The Machine clauses under test, restated so a reader can map every
 * assertion back to the contract:
 *
 *   M3 `close-run` against a 200-answering stub sends exactly three POSTs,
 *      in task-then-run order, each with the right path, Idempotency-Key,
 *      no `authorization` header, and a body of the given shape; the events
 *      file gains three `board:close` rows in order.
 *   M4 `close-run` never fails the run: a 500-answering stub still exits 0
 *      (rows carry `code: 500`); a missing kata.json exits 0, sends
 *      nothing, and writes the one documented skip row.
 *
 * Legs, each naming the clause it proves: (c) [M3] close-run's three POSTs
 * and its three event rows; (d) [M4] close-run's never-fails shape over a
 * 500 stub and a missing kata.json. The stub answers `{}`, so the rows'
 * receipts (`event_id`, `event_at`) read null here and are not asserted.
 *
 * The CLI is driven as a child process, every spawn's `env` built by
 * `simEnv` from `./_helpers.mjs` (`test_sims_are_hermetic.mjs` names any
 * spawn whose `env` is not). The admin host is a `node:http` server on
 * `127.0.0.1:0`, recording method/path/headers/body per request.
 * Everything lives under `fs.mkdtempSync(path.join(os.tmpdir(), …))`.
 *
 * `execFileSync` is *synchronous*: it blocks this process's own event loop
 * until the child exits, so a stub `http` server hosted here could never
 * `accept()` a connection from a child that is itself waiting on that same
 * stub — a real deadlock. Every leg drives the CLI with `spawn` wrapped in
 * a promise (`runCliAsync`) so this process's event loop stays free to
 * service the stub while the child runs.
 *
 * Assumed of the code under test: the CLI's subcommands, flags and
 * exit/stdout/stderr shapes are exactly as the task's Context section spells
 * them out — this exam does not re-derive them from `factory/boot.sh`,
 * which is a sibling task's file.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { simEnv } from './_helpers.mjs'

const MODULE = fileURLToPath(new URL('../../factory/board.mjs', import.meta.url))

const mkdir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'board-exam-'))

/** Runs the CLI as a child process asynchronously, never throwing: resolves
 *  `{ stdout, stderr, status }` once the child exits (or is killed past
 *  `timeoutMs`). Used by every leg, each of which also runs a stub `http`
 *  server in this process (see the header comment on why `execFileSync`
 *  cannot be). */
const runCliAsync = (args, { bin, home, timeoutMs } = {}) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [MODULE, ...args], { env: simEnv({ bin, home }) })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => { stdout += d })
    child.stderr.on('data', (d) => { stderr += d })
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs ?? 10000)
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ stdout, stderr, status: code })
    })
  })

/** A recording HTTP stub on 127.0.0.1: every request is captured (method,
 *  path, headers, body), and answered the status `statusFor` names — a
 *  number, or a function of the recorded request. */
const startStub = (statusFor) =>
  new Promise((resolve) => {
    const requests = []
    const server = http.createServer((req, res) => {
      const chunks = []
      req.on('data', (c) => chunks.push(c))
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8')
        const rec = { method: req.method, path: req.url, headers: req.headers, body }
        requests.push(rec)
        const status = typeof statusFor === 'function' ? statusFor(rec) : statusFor
        res.writeHead(status, { 'content-type': 'application/json' })
        res.end('{}')
      })
    })
    server.listen(0, '127.0.0.1', () => resolve({ server, requests, url: `http://127.0.0.1:${server.address().port}` }))
  })

const closeStub = (stub) => new Promise((resolve) => stub.server.close(resolve))

const readEventRows = (file) =>
  fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.length > 0).map((l) => JSON.parse(l))

// ══════════════════════════════════════════════════════════════════════════
// (c) [M3] `close-run` against a 200-answering stub
// ══════════════════════════════════════════════════════════════════════════

{
  const root = mkdir()
  const kataJson = path.join(root, 'kata.json')
  fs.writeFileSync(kataJson, JSON.stringify({
    project: { id: 31 },
    run: { uid: 'r-uid' },
    tasks: { 1: { uid: 't1' }, 2: { uid: 't2' } },
  }))
  const eventsPath = path.join(root, 'events.jsonl')
  const prUrl = 'https://github.com/o/r/pull/9'

  const stub = await startStub(200)
  try {
    const result = await runCliAsync([
      'close-run',
      '--kata-json', kataJson,
      '--run', 'run-9',
      '--pr', prUrl,
      '--admin-url', stub.url,
      '--events', eventsPath,
      '--title', 'T',
    ], { timeoutMs: 15000 })
    assert.equal(result.status, 0,
      '(c) [M3] close-run exits 0 against a 200-answering stub; got status ' + JSON.stringify(result.status) +
      ', stderr ' + JSON.stringify(result.stderr))

    assert.equal(stub.requests.length, 3,
      '(c) [M3] the stub recorded exactly three requests; got ' + stub.requests.length)
    for (const rec of stub.requests) {
      assert.equal(rec.method, 'POST', '(c) [M3] every request is a POST; got ' + JSON.stringify(rec.method))
    }

    const expectedPaths = [
      '/api/v1/projects/31/issues/t1/actions/close',
      '/api/v1/projects/31/issues/t2/actions/close',
      '/api/v1/projects/31/issues/r-uid/actions/close',
    ]
    assert.deepEqual(stub.requests.map((r) => r.path), expectedPaths,
      '(c) [M3] the three POSTs land, in order, on task 1, task 2, then the run; got ' +
      JSON.stringify(stub.requests.map((r) => r.path)))

    const expectedKeys = ['run-9:task:1:close', 'run-9:task:2:close', 'run-9:run:close']
    assert.deepEqual(stub.requests.map((r) => r.headers['idempotency-key']), expectedKeys,
      '(c) [M3] their Idempotency-Key headers are exactly the three keys, in order; got ' +
      JSON.stringify(stub.requests.map((r) => r.headers['idempotency-key'])))

    for (const rec of stub.requests) {
      assert.equal(rec.headers.authorization, undefined,
        '(c) [M3] no request carries an authorization header; ' + rec.path + ' had ' +
        JSON.stringify(rec.headers.authorization))
      assert.ok(String(rec.headers['content-type'] || '').startsWith('application/json'),
        '(c) [M3] every request carries content-type: application/json; ' + rec.path + ' had ' +
        JSON.stringify(rec.headers['content-type']))
    }

    for (const rec of stub.requests) {
      const parsed = JSON.parse(rec.body)
      assert.equal(parsed.actor, 'sandbox:run-9',
        '(c) [M3] ' + rec.path + '\'s body actor is sandbox:run-9; got ' + JSON.stringify(parsed.actor))
      assert.equal(parsed.reason, 'done',
        '(c) [M3] ' + rec.path + '\'s body reason is done; got ' + JSON.stringify(parsed.reason))
      assert.equal(parsed.retry_protocol, 'close-v1',
        '(c) [M3] ' + rec.path + '\'s body retry_protocol is close-v1; got ' + JSON.stringify(parsed.retry_protocol))
      assert.ok(typeof parsed.message === 'string' && parsed.message.length >= 40,
        '(c) [M3] ' + rec.path + '\'s body message is a string of at least 40 characters; got ' +
        JSON.stringify(parsed.message))
      assert.deepEqual(parsed.evidence, [{ type: 'pr', url: prUrl }],
        '(c) [M3] ' + rec.path + '\'s body evidence is exactly [{type:"pr",url:<pr>}]; got ' +
        JSON.stringify(parsed.evidence))
    }

    const rows = readEventRows(eventsPath)
    assert.equal(rows.length, 3, '(c) [M3] the events file gained exactly three rows; got ' + rows.length)
    assert.deepEqual(rows.map((r) => r.kind), ['board:close', 'board:close', 'board:close'],
      '(c) [M3] every row\'s kind is board:close; got ' + JSON.stringify(rows.map((r) => r.kind)))
    assert.deepEqual(rows.map((r) => r.what), ['task 1', 'task 2', 'run'],
      '(c) [M3] the rows\' what is task 1, task 2, run, in that order; got ' +
      JSON.stringify(rows.map((r) => r.what)))
    assert.deepEqual(rows.map((r) => r.code), [200, 200, 200],
      '(c) [M3] every row\'s code is the number 200; got ' + JSON.stringify(rows.map((r) => r.code)))
    for (const row of rows) {
      assert.equal(typeof row.ts, 'string', '(c) [M3] every row carries a string ts')
      assert.ok(row.ts.length > 0, '(c) [M3] every row\'s ts is non-empty')
    }
  } finally {
    await closeStub(stub)
  }
}

// ══════════════════════════════════════════════════════════════════════════
// (d) [M4] `close-run` never fails the run
// ══════════════════════════════════════════════════════════════════════════

{
  const root = mkdir()
  const kataJson = path.join(root, 'kata.json')
  fs.writeFileSync(kataJson, JSON.stringify({
    project: { id: 31 },
    run: { uid: 'r-uid' },
    tasks: { 1: { uid: 't1' }, 2: { uid: 't2' } },
  }))
  const eventsPath = path.join(root, 'events.jsonl')

  const stub = await startStub(500)
  try {
    const result = await runCliAsync([
      'close-run',
      '--kata-json', kataJson,
      '--run', 'run-9',
      '--pr', 'https://github.com/o/r/pull/9',
      '--admin-url', stub.url,
      '--events', eventsPath,
      '--title', 'T',
    ], { timeoutMs: 15000 })
    assert.equal(result.status, 0,
      '(d) [M4] close-run against a 500-answering stub still exits 0; got status ' + JSON.stringify(result.status) +
      ', stderr ' + JSON.stringify(result.stderr))
    const rows = readEventRows(eventsPath)
    assert.equal(rows.length, 3,
      '(d) [M4] close-run against a 500-answering stub still gains exactly three event rows; got ' + rows.length)
    assert.deepEqual(rows.map((r) => r.code), [500, 500, 500],
      '(d) [M4] all three rows carry code 500; got ' + JSON.stringify(rows.map((r) => r.code)))
  } finally {
    await closeStub(stub)
  }
}

{
  const root = mkdir()
  const kataJson = path.join(root, 'nope.kata.json') // never written
  const eventsPath = path.join(root, 'events.jsonl')

  const stub = await startStub(200)
  try {
    const result = await runCliAsync([
      'close-run',
      '--kata-json', kataJson,
      '--run', 'run-9',
      '--pr', 'https://github.com/o/r/pull/9',
      '--admin-url', stub.url,
      '--events', eventsPath,
      '--title', 'T',
    ], { timeoutMs: 15000 })
    assert.equal(result.status, 0,
      '(d) [M4] close-run over a missing --kata-json exits 0; got status ' + JSON.stringify(result.status) +
      ', stderr ' + JSON.stringify(result.stderr))
    assert.equal(stub.requests.length, 0,
      '(d) [M4] a missing --kata-json sends no request; got ' + stub.requests.length)

    const rows = readEventRows(eventsPath)
    assert.equal(rows.length, 1,
      '(d) [M4] the events file gained exactly one row; got ' + rows.length)
    const { ts, ...rest } = rows[0]
    assert.equal(typeof ts, 'string', '(d) [M4] the one row carries a string ts')
    assert.deepEqual(rest, { kind: 'board:close', what: 'run', code: null, skipped: 'no kata.json to read' },
      '(d) [M4] the row is, less ts, exactly {kind:"board:close",what:"run",code:null,' +
      'skipped:"no kata.json to read"}; got ' + JSON.stringify(rest))
  } finally {
    await closeStub(stub)
  }
}

console.log('ALL TESTS PASSED')
