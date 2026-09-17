/**
 * fleet/tests/test_jev_client.mjs — the exam for Task 1: *the Jev client and
 * the engine's `jev` seam* — one POST at the edge hostname, `null` on any
 * failure, `jev:` rows routed to the hub like `driver:` rows.
 *
 * This file is the Proof's `Test:`, written whole at the path the Proof names.
 * Every relative import is written for THIS directory: `../` is the
 * repository's `fleet/`, `./` is `fleet/tests/`.
 *
 * The Machine clauses under test, restated so a reader can map every assertion
 * back to the contract:
 *
 *   M1 — `fleet/jev-client.mjs` exports `JEV_PATH` = `/v1/systemone`,
 *        `JEV_MODEL` = `jev-latest`, `JEV_TIMEOUT_MS` = `10000`,
 *        `JEV_STATE_MAX_BYTES` = `120000`, and `makeJevClient({ baseUrl,
 *        fetchImpl = globalThis.fetch, timeoutMs = JEV_TIMEOUT_MS, log = () =>
 *        {} })` returning `{ ask }`. `ask({ state, questions })` calls
 *        `fetchImpl` EXACTLY ONCE, first argument the `baseUrl` stripped of
 *        trailing slashes plus `/v1/systemone`, second argument an init whose
 *        `method` is `POST`, whose `headers` carry a key lowercasing to
 *        `content-type` with value `application/json` and NO key lowercasing
 *        to `authorization`, whose `body` parses to an object with exactly the
 *        keys `state`, `model`, `questions` and `model` `jev-latest`, and
 *        whose `signal` is an `AbortSignal`; and it resolves to the reply's
 *        `answers` object when the status is 200–299 and the body parses as
 *        JSON carrying an `answers` object.
 *   M2 — `ask` resolves `null`, NEVER rejects, and calls `log` exactly once
 *        with a string beginning `jev:` for each of: a status outside 200–299;
 *        a `fetchImpl` that rejects (an `AbortError` included); a body that is
 *        not JSON or carries no `answers` object; and a `state` whose
 *        `JSON.stringify` length exceeds `JEV_STATE_MAX_BYTES`, for which
 *        `fetchImpl` is not called at all.
 *   M3 — `runEngine` accepts an optional top-level `jev` beside `kata`, and
 *        rejects BEFORE any dispatch with an `Error` whose message begins
 *        `jev:` when `jev` is present and `jev.ask` is not a function; and
 *        `kataUidFor` routes a `jev:`-prefixed kind by the `driver:` rule — a
 *        line the `eventLog` subscription receives is posted verbatim on the
 *        issue of the task its `task` field names when the record knows that
 *        task, on the run's issue otherwise, while an `engine:log` line is
 *        posted on no issue, as at BASE.
 *   M4 — `runMainInner` takes a `jevClientFor` dep defaulting to `(baseUrl) =>
 *        makeJevClient({ baseUrl, log })` and hands `runEngineFn` a `jev` key
 *        equal to `jevClientFor(env.TYPESAFE_BASE_URL)` exactly when
 *        `env.TYPESAFE_BASE_URL` is a non-empty string, and no `jev` key at
 *        all otherwise.
 *   M5 — `fleet/sandbox-boot.sh` declares `TYPESAFE_PROXY_URL` beside
 *        `ANTHROPIC_PROXY_URL`; the engine unit's `env` list carries
 *        `"TYPESAFE_BASE_URL=$TYPESAFE_PROXY_URL"` directly after
 *        `"ANTHROPIC_BASE_URL=$ANTHROPIC_PROXY_URL"`; the publish-fold unit's
 *        `env` list carries no `TYPESAFE` entry.
 *   M6 — `fleet/CONTRACT.md`'s engine unit line carries
 *        `TYPESAFE_BASE_URL=https://typesafe.int.exe.xyz` after
 *        `CLAUDE_CODE_OAUTH_TOKEN=placeholder`; the paragraph after
 *        `driver:suite-runs` names the three kinds, `POST /v1/systemone`, the
 *        one-log-line-and-no-row rule and that nothing reads them; the
 *        `Integration naming` bullet names the `typesafe` http-proxy; and
 *        `fleet/tests/README.md` gains one line each for the four sims.
 *   M7 — `_engine_helpers.mjs`'s `rig` takes optional `jev` and `eventLog` and
 *        passes each to `runEngine` as a top-level key exactly when given, as
 *        it passes `kata`; and it exports `fakeHub({ projectId, issues })`
 *        returning `{ kata, calls, commentsOn }`.
 *
 * The legs, in the order they run here:
 *
 *   (a) [M1] the four constants and the one green call.
 *   (b) [M2] the five failures, plus a `fetchImpl` that throws synchronously.
 *   (g) [M7] `fakeHub`'s three keys and its client's six methods — asserted
 *       where the hub is first built, because leg (c) cannot be driven without
 *       it; the rig's `jev` passthrough half of (g) follows leg (c).
 *   (c) [M3] the hub-on rig run: the four lines through the engine's own
 *       `eventLog` subscription, and where each one landed.
 *   (g) [M7] the rig's `jev` passthrough: a live client runs a plan to `done`,
 *       a `jev` with no `ask` rejects before any dispatch, no `jev` at all runs
 *       the same plan to `done`, and `eventLog.subscribe` was called once.
 *   (d) [M4] `runMain` driven four times, one per sub-case of the clause.
 *   (e) [M5] the boot's three `Run:` lines.
 *   (f) [M6] the contract's and the README's five `Run:` lines.
 *
 * The eight `Run:` lines of legs (e) and (f) are the driver's to execute; they
 * are cheap to read and are read HERE too, in process — a `sed -n '/a/,/b/p' |
 * tr '\n' ' ' | grep` emulation, translated pattern for pattern (parentheses
 * and braces escaped where the shell's BRE has them literal). Nothing is
 * spawned for them: `test_sims_are_hermetic.mjs` names a spawn whose call text
 * carries a `test_*.mjs` literal a sibling run, and the README `Run:` line
 * greps for four of those names.
 *
 * Nothing here opens a socket. The client is reached only through an injected
 * `fetchImpl` whose reply carries the two members `httpTransport` reads —
 * `status` and `text()` — and the hub only through the rig's own fake. Below
 * the agent seam the rig is the real thing: real git repositories, real clones
 * at BASE, the real capture, the real fold kernel through the real `execSeam`.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { runMain } from '../run-main.mjs'
import { simEnv } from './_helpers.mjs'
import { ENV, makeRepo, rig, passReview, cleanCritic, doneImpl } from './_engine_helpers.mjs'
// The same module by namespace, for the symbol this task ADDS to it: a named
// import of an export BASE does not have is a link-time error that takes every
// other leg down with it.
import * as engineHelpers from './_engine_helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jev-client-')))
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }))

/** The deliverable, imported dynamically: a tree without it reports the ABSENT
 *  MODULE as an assertion of leg (a) rather than dying at load with no leg
 *  named at all. */
let jev = null
let jevImportError = null
try {
  jev = await import('../jev-client.mjs')
} catch (error) {
  jevImportError = error
}
assert.ok(jevImportError === null,
  '(a) [M1] `fleet/jev-client.mjs` is importable — the module this task creates. Got: ' +
  String(jevImportError && (jevImportError.message || jevImportError)))
assert.equal(typeof jev.makeJevClient, 'function',
  '(a) [M1] it exports `makeJevClient({ baseUrl, fetchImpl, timeoutMs, log })`; got ' +
  JSON.stringify(typeof jev.makeJevClient))

// ══════════════════════════════════════════════════════════════════════════
// (a) [M1] the four constants, and the one call a green answer makes
// ══════════════════════════════════════════════════════════════════════════

assert.equal(jev.JEV_PATH, '/v1/systemone',
  '(a) [M1] `JEV_PATH` is `/v1/systemone` — the edge\'s one endpoint; got ' +
  JSON.stringify(jev.JEV_PATH))
assert.equal(jev.JEV_MODEL, 'jev-latest',
  '(a) [M1] `JEV_MODEL` is `jev-latest`; got ' + JSON.stringify(jev.JEV_MODEL))
assert.equal(jev.JEV_TIMEOUT_MS, 10000,
  '(a) [M1] `JEV_TIMEOUT_MS` is 10000; got ' + JSON.stringify(jev.JEV_TIMEOUT_MS))
assert.equal(jev.JEV_STATE_MAX_BYTES, 120000,
  '(a) [M1] `JEV_STATE_MAX_BYTES` is 120000 — the state budget, on the state\'s own ' +
  'JSON; got ' + JSON.stringify(jev.JEV_STATE_MAX_BYTES))

/** The reply shape a sim hands back: what `httpTransport` reads of a response,
 *  and nothing else — `status` and `text()`. */
const reply = (status, body) => ({ status, text: async () => String(body) })

/** A `fetchImpl` that records every call's two arguments and answers with
 *  `answer(argv)` — which may return a promise, reject, or throw outright. */
const recordingFetch = (answer) => {
  const calls = []
  return { calls, fetchImpl: (...argv) => { calls.push(argv); return answer(argv) } }
}

/** `[name, value]` pairs of a headers container, whatever the shape: M1 says
 *  "a key that lowercases to `content-type`", so the exam reads a plain
 *  object, a `Map`, a pair array and a `Headers` alike rather than pinning
 *  one of them. */
const headerEntries = (headers) => {
  if (!headers) return []
  if (typeof headers.entries === 'function') return [...headers.entries()]
  if (Array.isArray(headers)) return headers.map((pair) => [pair[0], pair[1]])
  return Object.entries(headers)
}
const headerValue = (headers, name) => {
  const hit = headerEntries(headers).find(([k]) => String(k).toLowerCase() === name)
  return hit === undefined ? null : String(hit[1])
}
const headerNames = (headers) => headerEntries(headers).map(([k]) => String(k).toLowerCase())

const GREEN_BODY = '{"model":"jev-1.13.0","answers":{"q":{"type":"noul","noul":0.9}},' +
  '"usage":{"input_tokens":1,"output_tokens":1}}'
const QUESTIONS = { q: { type: 'noul', instructions: 'x' } }
const STATE = { s: 1 }
const WANT_URL = 'https://jev.invalid/v1/systemone'

{
  const { calls, fetchImpl } = recordingFetch(async () => reply(200, GREEN_BODY))
  const logs = []
  const client = jev.makeJevClient({ baseUrl: 'https://jev.invalid/', fetchImpl,
    log: (l) => logs.push(l) })
  assert.equal(typeof client.ask, 'function',
    '(a) [M1] `makeJevClient(...)` returns `{ ask }`; got ' + JSON.stringify(Object.keys(client)))

  const answers = await client.ask({ state: STATE, questions: QUESTIONS })
  assert.deepEqual(answers, { q: { type: 'noul', noul: 0.9 } },
    '(a) [M1] a 200 whose body carries an `answers` object resolves to THAT object — ' +
    'the reply\'s `answers`, not the reply; got ' + JSON.stringify(answers))

  assert.equal(calls.length, 1,
    '(a) [M1] `ask` calls `fetchImpl` exactly once — one POST, no retry; got ' + calls.length)
  const [url, init] = calls[0]
  assert.equal(url, WANT_URL,
    '(a) [M1] the first argument is the baseUrl stripped of trailing slashes plus ' +
    '`/v1/systemone` — `' + WANT_URL + '`; got ' + JSON.stringify(url))
  assert.ok(init && typeof init === 'object',
    '(a) [M1] the second argument is the request init; got ' + JSON.stringify(init))
  assert.equal(init.method, 'POST',
    '(a) [M1] its `method` is `POST`; got ' + JSON.stringify(init.method))
  assert.equal(headerValue(init.headers, 'content-type'), 'application/json',
    '(a) [M1] its headers carry a key lowercasing to `content-type` with value ' +
    '`application/json`; got ' + JSON.stringify(headerEntries(init.headers)))
  assert.equal(headerNames(init.headers).includes('authorization'), false,
    '(a) [M1] and NO key lowercasing to `authorization` — the edge injects the bearer, ' +
    'the box never holds it; got ' + JSON.stringify(headerNames(init.headers)))
  let sent = null
  try { sent = JSON.parse(String(init.body)) } catch { sent = null }
  assert.ok(sent && typeof sent === 'object' && !Array.isArray(sent),
    '(a) [M1] its `body` parses to an object; got ' + JSON.stringify(init.body))
  assert.deepEqual(Object.keys(sent).sort(), ['model', 'questions', 'state'],
    '(a) [M1] with exactly the keys `state`, `model`, `questions`, in any order; got ' +
    JSON.stringify(Object.keys(sent)))
  assert.equal(sent.model, 'jev-latest',
    '(a) [M1] whose `model` is `jev-latest`; got ' + JSON.stringify(sent.model))
  assert.deepEqual(sent.state, STATE,
    '(a) [M1] whose `state` is the state it was handed; got ' + JSON.stringify(sent.state))
  assert.deepEqual(sent.questions, QUESTIONS,
    '(a) [M1] and whose `questions` are the questions it was handed; got ' +
    JSON.stringify(sent.questions))
  assert.ok(init.signal instanceof AbortSignal,
    '(a) [M1] its `signal` is an `AbortSignal` — the timeout, on the call itself; got ' +
    Object.prototype.toString.call(init.signal))
  assert.deepEqual(logs, [],
    '(a) [M1] an answered call is no log line at all; got ' + JSON.stringify(logs))
}

{
  // The same URL from a baseUrl with no trailing slash: "stripped of trailing
  // slashes" is the rule, not "one slash removed".
  const { calls, fetchImpl } = recordingFetch(async () => reply(200, GREEN_BODY))
  await jev.makeJevClient({ baseUrl: 'https://jev.invalid', fetchImpl })
    .ask({ state: STATE, questions: QUESTIONS })
  assert.equal(calls.length === 1 ? calls[0][0] : null, WANT_URL,
    '(a) [M1] a baseUrl with no trailing slash reaches the same URL — `' + WANT_URL +
    '`; got ' + JSON.stringify(calls.map((c) => c[0])))
}

// ══════════════════════════════════════════════════════════════════════════
// (b) [M2] every failure is `null` and ONE log line — and never a rejection
// ══════════════════════════════════════════════════════════════════════════

/** One `ask` against one canned answer, with its own log sink. Never rethrows:
 *  whether `ask` rejected is itself an assertion below. */
const askWith = async ({ answer, state = STATE }) => {
  const logs = []
  const { calls, fetchImpl } = recordingFetch(answer)
  const client = jev.makeJevClient({ baseUrl: 'https://jev.invalid', fetchImpl,
    log: (l) => logs.push(l) })
  let value = 'UNSET'
  let threw = null
  try { value = await client.ask({ state, questions: QUESTIONS }) } catch (error) { threw = error }
  return { value, threw, logs, calls }
}

const abortError = () => {
  const error = new Error('The operation was aborted')
  error.name = 'AbortError'
  return error
}

const FAILURES = [
  { tag: 'a status outside 200–299 (500, with a JSON body)',
    answer: async () => reply(500, '{"error":"boom"}') },
  { tag: 'a `fetchImpl` that rejects with an `AbortError` — the timeout lane',
    answer: async () => { throw abortError() } },
  { tag: 'a 200 whose body is not JSON', answer: async () => reply(200, 'not json') },
  { tag: 'a 200 whose body carries no `answers` object',
    answer: async () => reply(200, '{"model":"x","usage":{}}') },
]

for (const failure of FAILURES) {
  const { value, threw, logs, calls } = await askWith({ answer: failure.answer })
  assert.equal(threw, null,
    '(b) [M2] ' + failure.tag + ': `ask` never rejects. It threw: ' +
    String(threw && (threw.stack || threw.message || threw)))
  assert.equal(value, null,
    '(b) [M2] ' + failure.tag + ': `ask` resolves `null`; got ' + JSON.stringify(value))
  assert.equal(logs.length, 1,
    '(b) [M2] ' + failure.tag + ': exactly one log line — a failed call is one log line ' +
    'and no row. Got ' + JSON.stringify(logs))
  assert.equal(typeof logs[0], 'string',
    '(b) [M2] ' + failure.tag + ': that line is a string; got ' + JSON.stringify(logs[0]))
  assert.ok(String(logs[0]).startsWith('jev:'),
    '(b) [M2] ' + failure.tag + ': and it begins `jev:`; got ' + JSON.stringify(logs[0]))
  assert.equal(calls.length, 1,
    '(b) [M2] ' + failure.tag + ': one call was made and never retried; got ' + calls.length)
}

{
  // The budget, checked on the state's own JSON BEFORE any call.
  const overBudget = 'x'.repeat(120001)
  const { value, threw, logs, calls } = await askWith({
    answer: async () => reply(200, GREEN_BODY), state: overBudget,
  })
  assert.equal(threw, null,
    '(b) [M2] an over-budget state: `ask` never rejects. It threw: ' +
    String(threw && (threw.stack || threw.message || threw)))
  assert.equal(value, null,
    '(b) [M2] an over-budget state (`JSON.stringify` longer than `JEV_STATE_MAX_BYTES`) ' +
    'resolves `null`; got ' + JSON.stringify(value))
  assert.equal(logs.length, 1,
    '(b) [M2] with exactly one log line; got ' + JSON.stringify(logs))
  assert.ok(String(logs[0]).startsWith('jev:'),
    '(b) [M2] beginning `jev:`; got ' + JSON.stringify(logs[0]))
  assert.equal(calls.length, 0,
    '(b) [M2] and `fetchImpl` was not called AT ALL — the budget is checked before the ' +
    'call; got ' + calls.length + ' call(s)')
}

{
  // A seam that throws synchronously is the same lane: `ask` resolves `null`.
  const { value, threw } = await askWith({ answer: () => { throw new Error('sync boom') } })
  assert.equal(threw, null,
    '(b) [M2] a `fetchImpl` that throws SYNCHRONOUSLY: `ask` still never rejects. It threw: ' +
    String(threw && (threw.stack || threw.message || threw)))
  assert.equal(value, null,
    '(b) [M2] a `fetchImpl` that throws synchronously also resolves `null`; got ' +
    JSON.stringify(value))
}

// ══════════════════════════════════════════════════════════════════════════
// the rig's hub, lifted (leg (g) [M7], asserted where leg (c) first needs it)
// ══════════════════════════════════════════════════════════════════════════

assert.equal(typeof engineHelpers.fakeHub, 'function',
  '(g) [M7] `fleet/tests/_engine_helpers.mjs` exports `fakeHub({ projectId, issues })` — ' +
  'the in-memory hub client of `test_run_engine_state_handshake.mjs`, lifted into the rig; ' +
  'got ' + JSON.stringify(typeof engineHelpers.fakeHub))

const PROJECT_ID = 7
const RUN_UID = 'RUN0'
const UID_A = 'U-A'
const ISSUES = () => ({
  [RUN_UID]: { revision: 1, short_id: 'run0', metadata: {} },
  [UID_A]: { revision: 1, short_id: 'aa11', metadata: {} },
})
/** The record, spelled as the launcher writes it; its issue revisions are the
 *  fake's, because a sheet read whose revision disagrees is fatal. */
const RECORD = () => ({
  url: 'https://kata.invalid',
  project: { id: PROJECT_ID, uid: 'PROJ0', name: 'ultrapowers' },
  run: { uid: RUN_UID, revision: 1 },
  tasks: { A: { uid: UID_A, short_id: 'aa11', revision: 1 } },
})

const hub = engineHelpers.fakeHub({ projectId: PROJECT_ID, issues: ISSUES() })
assert.ok(hub && typeof hub === 'object',
  '(g) [M7] `fakeHub(...)` answers an object; got ' + JSON.stringify(hub))
assert.ok(hub.kata && typeof hub.kata === 'object',
  '(g) [M7] carrying `kata`, the client the engine is handed; got ' + JSON.stringify(hub.kata))
assert.ok(Array.isArray(hub.calls),
  '(g) [M7] carrying `calls`, every call in order; got ' + JSON.stringify(typeof hub.calls))
assert.equal(typeof hub.commentsOn, 'function',
  '(g) [M7] and `commentsOn(uid)`, the comment bodies on one issue; got ' +
  JSON.stringify(typeof hub.commentsOn))
for (const method of ['getIssue', 'claim', 'patchMetadata', 'comment', 'addLabel', 'close']) {
  assert.equal(typeof hub.kata[method], 'function',
    '(g) [M7] `fakeHub(...).kata` carries the client\'s six methods — `' + method +
    '` among them; got ' + JSON.stringify(Object.keys(hub.kata)))
}

// ══════════════════════════════════════════════════════════════════════════
// (c) [M3] `jev:` lines route like `driver:` lines; `engine:log` routes nowhere
// ══════════════════════════════════════════════════════════════════════════

/** A wave's task, the shape the rig's sims spell. */
const taskOf = (id) => ({
  id, title: 'task ' + id, files: [id + '.txt'], tier: 'standard', review: 'lean',
  writes: [id + '.txt'], commutes: [], testCmd: 'bash check.sh', proofTests: [], proofRuns: [],
  body: 'sim task ' + id,
})

/** The run's own record, read back off disk. */
const eventsIn = (runDir) => {
  let text = ''
  try { text = fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8') } catch { return [] }
  return text.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('{'))
    .map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
}

const LINES = { A: 'LINE-A', R: 'LINE-R', Z: 'LINE-Z', L: 'LINE-L' }
const cRunDir = path.join(tmp, 'run-c')
/** The engine's own subscription callback, captured from the rig's `eventLog`. */
const subscribed = []
const cLabels = []
/** How many callbacks the `impl:A` stub found when it ran — read AFTER the run
 *  rather than asserted inside the stub, so a tree where the rig passes no
 *  `eventLog` at all fails on this leg's own assertion and not as a dispatch
 *  that threw somewhere inside the engine. */
let subscribedAtDispatch = null
{
  const repo = makeRepo(path.join(tmp, 'repo-c'))
  const eventLog = {
    subscribe: (cb) => { subscribed.push(cb); return () => {} },
    onEvent: () => {}, log: () => {}, phase: () => {},
  }
  const { run } = rig({
    repo, runDir: cRunDir, waves: [[taskOf('A')]], stamp: 'jev-c',
    kata: hub.kata,
    eventLog,
    extraArgs: { kataRecord: RECORD(), attentionPollMs: 3600000 },
    stub: (prompt, opts, cwd) => {
      const label = String(opts.label)
      cLabels.push(label)
      if (label === 'impl:A') {
        fs.writeFileSync(path.join(cwd, 'A.txt'), 'from ' + label + '\n')
        subscribedAtDispatch = subscribed.length
        // The four lines, off the log the engine subscribed to — this task has
        // no row producer of its own, so the subscription IS the seam under test.
        if (subscribed.length === 1) {
          subscribed[0]({ kind: 'jev:finding', task: 'A' }, LINES.A)
          subscribed[0]({ kind: 'jev:suite-red' }, LINES.R)
          subscribed[0]({ kind: 'jev:tier', task: 'ZZ' }, LINES.Z)
          subscribed[0]({ kind: 'engine:log' }, LINES.L)
        }
        return doneImpl(cwd)
      }
      if (label === 'integration') return cleanCritic()
      if (label.startsWith('review:')) return passReview()
      if (label.startsWith('fix:')) return doneImpl(cwd)
      return { status: 'BLOCKED', summary: 'sim: unexpected dispatch ' + label }
    },
  })
  const report = await run()
  const rowA = report.tasks.find((t) => t && t.task === 'A')
  assert.equal(rowA && rowA.status, 'done',
    '(c) [M3] sim precondition: the hub-on run took task A to `done` — the routing is ' +
    'read off a run that finished. Labels dispatched: ' + JSON.stringify(cLabels) +
    '. Got ' + JSON.stringify(report.tasks))
  assert.equal(subscribedAtDispatch, 1,
    '(c) [M3] with a hub on, the engine had subscribed to the `eventLog` the rig passed ' +
    'through — exactly one subscription, in place before `impl:A` was dispatched; got ' +
    JSON.stringify(subscribedAtDispatch))

  // The comments are drained at the run's end, so they are read only here.
  const onTask = hub.commentsOn(UID_A)
  const onRun = hub.commentsOn(RUN_UID)
  assert.ok(onTask.includes(LINES.A),
    '(c) [M3] a `jev:finding` naming task A is posted VERBATIM on task A\'s issue (' +
    UID_A + ') — the `driver:` rule, reached by the `jev:` prefix. Comments there: ' +
    JSON.stringify(onTask))
  assert.equal(onTask.includes(LINES.R), false,
    '(c) [M3] and the run-wide `jev:suite-red` line is NOT on task A\'s issue. Comments ' +
    'there: ' + JSON.stringify(onTask))
  assert.ok(onRun.includes(LINES.R),
    '(c) [M3] a `jev:suite-red` line, naming no task, is posted on the run\'s issue (' +
    RUN_UID + '). Comments there: ' + JSON.stringify(onRun))
  assert.ok(onRun.includes(LINES.Z),
    '(c) [M3] and so is a `jev:tier` line naming a task the record does not know (`ZZ`). ' +
    'Comments there: ' + JSON.stringify(onRun))
  assert.equal(onRun.includes(LINES.A),
    false,
    '(c) [M3] task A\'s own line is not ALSO on the run\'s issue — one line, one issue. ' +
    'Comments there: ' + JSON.stringify(onRun))
  const strayed = hub.calls.filter((c) => c && c.method === 'comment' &&
    String(c.body || '').includes(LINES.L))
  assert.deepEqual(strayed, [],
    '(c) [M3] an `engine:log` line is posted on NO issue, as at BASE; got ' +
    JSON.stringify(strayed))

  const jevRows = eventsIn(cRunDir).filter((e) => String(e.kind || '').startsWith('jev:'))
  assert.deepEqual(jevRows, [],
    '(c) [M3] and the run\'s `events.jsonl` carries no row whose kind begins `jev:` — ' +
    'this task appends none; the three row tasks do. Got ' + JSON.stringify(jevRows))
}

// ══════════════════════════════════════════════════════════════════════════
// (g) [M7] the rig's `jev` and `eventLog` passthroughs
// ══════════════════════════════════════════════════════════════════════════

assert.equal(subscribed.length, 1,
  '(g) [M7] in leg (c) the sim\'s `eventLog.subscribe` was called exactly once — which ' +
  'only the rig\'s `eventLog` passthrough could have carried to the engine; got ' +
  subscribed.length)

/** The one-task plan of leg (g), run with whatever `jev` the case hands in. */
const plainRun = async ({ tag, jevArg }) => {
  const repo = makeRepo(path.join(tmp, 'repo-' + tag))
  const runDir = path.join(tmp, 'run-' + tag)
  const labels = []
  const { run } = rig({
    repo, runDir, waves: [[taskOf('A')]], stamp: 'jev-' + tag,
    ...(jevArg === undefined ? {} : { jev: jevArg }),
    stub: (prompt, opts, cwd) => {
      const label = String(opts.label)
      labels.push(label)
      if (label.startsWith('impl:')) {
        fs.writeFileSync(path.join(cwd, 'A.txt'), 'from ' + label + '\n')
        return doneImpl(cwd)
      }
      if (label === 'integration') return cleanCritic()
      if (label.startsWith('review:')) return passReview()
      if (label.startsWith('fix:')) return doneImpl(cwd)
      return { status: 'BLOCKED', summary: 'sim: unexpected dispatch ' + label }
    },
  })
  let report = null
  let threw = null
  try { report = await run() } catch (error) { threw = error }
  return { report, threw, labels }
}

{
  const live = await plainRun({ tag: 'g-live', jevArg: { ask: async () => null } })
  assert.equal(live.threw, null,
    '(g) [M7] a rig handed a live `jev` runs — it threw: ' +
    String(live.threw && (live.threw.stack || live.threw.message || live.threw)))
  const row = live.report.tasks.find((t) => t && t.task === 'A')
  assert.equal(row && row.status, 'done',
    '(g) [M7] `rig({ …, jev: { ask } })` runs a one-task plan to `done`; got ' +
    JSON.stringify(live.report.tasks))
}

{
  const broken = await plainRun({ tag: 'g-broken', jevArg: {} })
  assert.ok(broken.threw instanceof Error,
    '(g) [M7] `rig({ …, jev: {} }).run()` REJECTS — a `jev` whose `ask` is not a ' +
    'function is refused, and the rejection is one only the rig\'s `jev` passthrough ' +
    'could have carried to the engine. It resolved instead: ' +
    JSON.stringify(broken.report && broken.report.tasks))
  assert.ok(String(broken.threw.message).startsWith('jev:'),
    '(g) [M7] with an `Error` whose message begins `jev:`; got ' +
    JSON.stringify(String(broken.threw.message)))
  assert.deepEqual(broken.labels, [],
    '(g) [M7] and it rejects BEFORE any dispatch — no stub was reached; got ' +
    JSON.stringify(broken.labels))
}

{
  const none = await plainRun({ tag: 'g-none', jevArg: undefined })
  assert.equal(none.threw, null,
    '(g) [M7] a rig handed NO `jev` runs as it does at BASE — it threw: ' +
    String(none.threw && (none.threw.stack || none.threw.message || none.threw)))
  const row = none.report.tasks.find((t) => t && t.task === 'A')
  assert.equal(row && row.status, 'done',
    '(g) [M7] `rig` with no `jev` runs the same one-task plan to `done` — the key is ' +
    'passed exactly when given, as `kata` is; got ' + JSON.stringify(none.report.tasks))
}

// ══════════════════════════════════════════════════════════════════════════
// (d) [M4] the `jev` key run-main hands the engine, and when it hands none
// ══════════════════════════════════════════════════════════════════════════
//
// The flow of `fleet/tests/test_worker_kata_env.mjs`: a stub `exec` playing the
// python scripts, a stub `runEngineFn` that records what it was handed, a
// faked `kataClientFor`, and a `makeAgent` that spawns nothing. The engine is
// stubbed, so the client the default builds is never called.

const RUN_ID = 'run-177'
const RUNMAIN_WAVES = () => [[
  { id: '3', title: 't3', files: ['a.txt'], tier: null, review: 'lean',
    writes: ['a.txt'], commutes: [] },
]]

const mkdir = (p) => { fs.mkdirSync(p, { recursive: true }); return p }

async function runMainFlow ({ name, env, jevClientFor }) {
  const target = mkdir(path.join(tmp, 'rm-' + name))
  const git = (argv, cwd) => execFileSync('git', argv,
    { cwd, env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  git(['init', '-q', '-b', 'fleet-base'], target)
  git(['config', 'user.email', 't@example.com'], target)
  git(['config', 'user.name', 't'], target)
  fs.writeFileSync(path.join(target, 'a.txt'), 'base\n')
  git(['add', '-A'], target)
  git(['commit', '-q', '-m', 'base'], target)

  const planPath = path.join(target, 'plan.md')
  fs.writeFileSync(planPath, '# plan\n')
  const runDir = path.join(target, '.claude/ultrapowers', name)
  const argsFile = path.join(runDir, 'args.json')
  const exec = async (cmd, argv, opts = {}) => {
    if (cmd === 'git') {
      try {
        return { code: 0, stdout: execFileSync('git', argv,
          { cwd: opts.cwd, env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }),
          stderr: '' }
      } catch (e) {
        return { code: 1, stdout: '', stderr: String((e && (e.stderr || e.message)) || e) }
      }
    }
    if (cmd === 'claude' && argv[0] === 'auth') {
      return { code: 0, stdout: JSON.stringify({ authMethod: 'oauth', subscriptionType: 'max' }),
               stderr: '' }
    }
    const script = path.basename(argv[0])
    if (script === 'ultra_run.py' && argv.includes('--validate-knobs')) {
      return { code: 0, stdout: '{"ok": true}', stderr: '' }
    }
    if (script === 'ultra_run.py') {
      mkdir(runDir)
      fs.writeFileSync(argsFile, JSON.stringify({
        waves: RUNMAIN_WAVES(), wavesPath: path.join(runDir, 'launch.json'),
        edges: [], acceptance: { mode: 'suite' }, waveLabels: ['w1'],
        globalConstraints: '', planPath: argv[1],
        pluginRoot: target, runDir, testCmd: 'true',
      }, null, 2))
      const receipt = { ok: true, baseBranch: 'fleet-base', argsFile, testCmd: 'true' }
      fs.writeFileSync(path.join(runDir, 'receipt.json'), JSON.stringify(receipt))
      return { code: 0, stdout: JSON.stringify(receipt), stderr: '' }
    }
    if (script === 'finalize_report.py') return { code: 0, stdout: '', stderr: '' }
    if (script === 'ultra_gate.py' && argv.includes('--approve')) {
      return { code: 0, stdout: JSON.stringify({ mode: 'suite', stamp: RUN_ID }), stderr: '' }
    }
    if (script === 'ultra_gate.py') {
      fs.writeFileSync(path.join(runDir, 'gate-receipt.json'), JSON.stringify({
        verdict: 'PASS', gateCheck: { verdict: 'PASS', checks: [], acks: [] }, gateCheckExit: 0,
      }))
      return { code: 0, stdout: '', stderr: '' }
    }
    throw new Error('exec stub: unexpected ' + cmd + ' ' + argv.join(' '))
  }
  let received = null
  await runMain(
    { planPath, runId: RUN_ID, repoDir: target, tier: 'mostCapable', overlap: null,
      testCmd: null, bootstrapCmd: null, cli: 'claude' },
    {
      exec,
      log: () => {},
      env,
      kataClientFor: () => ({
        async getIssue () { throw new Error('run-main sim: the engine is stubbed') },
        async comment () { return { revision: 1 } },
      }),
      ...(jevClientFor === undefined ? {} : { jevClientFor }),
      runEngineFn: async (deps) => {
        received = deps
        return { integrationBranch: 'ultra/integration-' + RUN_ID, waveMerges: [], tasks: [] }
      },
      makeAgent: (opts) => ({ agent: async () => null, patchInput: opts.patchesDir }),
    },
  )
  assert.ok(received,
    '(d) [M4] sim precondition (' + name + '): the flow reached the engine call — ' +
    '`runEngineFn` recorded its deps')
  return received
}

{
  const depsInjected = await runMainFlow({
    name: 'jev-injected',
    env: { ...simEnv(), TYPESAFE_BASE_URL: 'https://jev.invalid' },
    jevClientFor: (u) => ({ ask: async () => null, url: u }),
  })
  assert.ok(depsInjected.jev && typeof depsInjected.jev === 'object',
    '(d) [M4] with `TYPESAFE_BASE_URL` set, run-main hands the engine a `jev` key; got ' +
    JSON.stringify(depsInjected.jev))
  assert.equal(depsInjected.jev.url, 'https://jev.invalid',
    '(d) [M4] equal to `jevClientFor(env.TYPESAFE_BASE_URL)` — the dep was called with ' +
    'that base url and nothing else; got ' + JSON.stringify(depsInjected.jev.url))
}

{
  const depsDefault = await runMainFlow({
    name: 'jev-default',
    env: { ...simEnv(), TYPESAFE_BASE_URL: 'https://jev.invalid' },
  })
  assert.ok(depsDefault.jev && typeof depsDefault.jev === 'object',
    '(d) [M4] with NO `jevClientFor` dep the DEFAULT built one — `(baseUrl) => ' +
    'makeJevClient({ baseUrl, log })`; got ' + JSON.stringify(depsDefault.jev))
  assert.equal(typeof depsDefault.jev.ask, 'function',
    '(d) [M4] and what it built is the real client: `deps.jev.ask` is a function. The ' +
    'stub engine never calls it, so no request leaves this sim. Got ' +
    JSON.stringify(typeof depsDefault.jev.ask))
}

{
  const depsUnset = await runMainFlow({ name: 'jev-unset', env: { ...simEnv() } })
  assert.equal('jev' in depsUnset, false,
    '(d) [M4] with no `TYPESAFE_BASE_URL` in the environment there is no `jev` key AT ' +
    'ALL — on the laptop and in every sim, no client is built and no call is made. Got ' +
    JSON.stringify(Object.keys(depsUnset)))
}

{
  const depsEmpty = await runMainFlow({
    name: 'jev-empty', env: { ...simEnv(), TYPESAFE_BASE_URL: '' },
  })
  assert.equal('jev' in depsEmpty, false,
    '(d) [M4] and an EMPTY `TYPESAFE_BASE_URL` is not a non-empty string: no `jev` key ' +
    'either. Got ' + JSON.stringify(Object.keys(depsEmpty)))
}

// ══════════════════════════════════════════════════════════════════════════
// the `Run:` lines of legs (e) and (f), read in process
// ══════════════════════════════════════════════════════════════════════════

const readAt = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

/** `sed -n '/start/,/end/p'` over a file's lines: from the first line matching
 *  `start` through the first LATER line matching `end` (to the end of the file
 *  when there is none), returned as `[]` when `start` never matched. */
const sedRange = (text, start, end) => {
  const lines = String(text).split('\n')
  const from = lines.findIndex((l) => start.test(l))
  if (from === -1) return []
  for (let i = from + 1; i < lines.length; i += 1) {
    if (end.test(lines[i])) return lines.slice(from, i + 1)
  }
  return lines.slice(from)
}
/** …piped through `tr '\n' ' '`: the range as one line. */
const joined = (lines) => lines.join(' ')
/** `grep -c PATTERN`: how many LINES match. */
const countLines = (text, re) => String(text).split('\n').filter((l) => re.test(l)).length

// ── (e) [M5] the boot ───────────────────────────────────────────────────────

const boot = readAt('fleet/sandbox-boot.sh')

// Run: grep -q '^TYPESAFE_PROXY_URL="https://typesafe.int.exe.xyz"$' fleet/sandbox-boot.sh
assert.ok(countLines(boot, /^TYPESAFE_PROXY_URL="https:\/\/typesafe\.int\.exe\.xyz"$/) >= 1,
  '(e) [M5] `fleet/sandbox-boot.sh` declares `TYPESAFE_PROXY_URL="https://typesafe.int.exe.xyz"` ' +
  'on a line of its own, beside `ANTHROPIC_PROXY_URL` — https only, because a followed 301 ' +
  'turns a POST into a GET. (Proof `Run:` line 1)')

// Run: sed -n '/--unit=fleet-engine-$RUN_N/,/node "$ENGINE_REPO_DIR\/fleet\/run-main.mjs"/p' …
const engineUnit = sedRange(boot,
  new RegExp(String.raw`--unit=fleet-engine-\$RUN_N`),
  new RegExp(String.raw`node "\$ENGINE_REPO_DIR/fleet/run-main\.mjs"`))
assert.ok(engineUnit.length > 0,
  '(e) [M5] sim precondition: the engine unit\'s `systemd-run` call is still in the boot — ' +
  'the range the Proof\'s second `Run:` line reads')
assert.ok(new RegExp(String.raw`ANTHROPIC_BASE_URL=\$ANTHROPIC_PROXY_URL" *\\ *"TYPESAFE_BASE_URL=\$TYPESAFE_PROXY_URL"`)
  .test(joined(engineUnit)),
  '(e) [M5] the engine unit\'s `env` list carries `"TYPESAFE_BASE_URL=$TYPESAFE_PROXY_URL"` ' +
  'DIRECTLY AFTER `"ANTHROPIC_BASE_URL=$ANTHROPIC_PROXY_URL"`. (Proof `Run:` line 2) The ' +
  'range read: ' + JSON.stringify(joined(engineUnit)))

// Run: test "$(sed -n '/--unit=fleet-fold-$RUN_N/,/node "…publish-fold.mjs"/p' … | grep -c TYPESAFE)" = 0
const foldUnit = sedRange(boot,
  new RegExp(String.raw`--unit=fleet-fold-\$RUN_N`),
  new RegExp(String.raw`node "\$ENGINE_REPO_DIR/fleet/publish-fold\.mjs"`))
assert.ok(foldUnit.length > 0,
  '(e) [M5] sim precondition: the publish-fold unit\'s call is still in the boot — the ' +
  'range the Proof\'s third `Run:` line reads')
assert.equal(foldUnit.filter((l) => /TYPESAFE/.test(l)).length, 0,
  '(e) [M5] and the publish-fold unit\'s `env` list carries NO `TYPESAFE` entry — the fold ' +
  'runs no engine. (Proof `Run:` line 3) The range read: ' + JSON.stringify(joined(foldUnit)))

// ── (f) [M6] the contract and the index ─────────────────────────────────────

const contract = readAt('fleet/CONTRACT.md')

// Run: sed -n '/^  - engine: .systemd-run --user --unit=fleet-engine-<N>/,/^    cwd ./p' … | grep -q …
const contractEngine = sedRange(contract,
  /^ {2}- engine: .systemd-run --user --unit=fleet-engine-<N>/,
  /^ {4}cwd ./)
assert.ok(contractEngine.length > 0,
  '(f) [M6] sim precondition: `fleet/CONTRACT.md`\'s engine unit bullet is still there — ' +
  'the range the Proof\'s fourth `Run:` line reads')
assert.ok(/CLAUDE_CODE_OAUTH_TOKEN=placeholder *TYPESAFE_BASE_URL=https:\/\/typesafe.int.exe.xyz/
  .test(joined(contractEngine)),
  '(f) [M6] the contract\'s engine unit line carries ' +
  '`TYPESAFE_BASE_URL=https://typesafe.int.exe.xyz` after ' +
  '`CLAUDE_CODE_OAUTH_TOKEN=placeholder`. (Proof `Run:` line 4) The range read: ' +
  JSON.stringify(joined(contractEngine)))

// Run: sed -n '/driver:suite-runs. .{task, count, slices}/,/^    Receipts (2026-09-16)/p' … | grep -q …
const threeKinds = sedRange(contract,
  /driver:suite-runs. .\{task, count, slices\}/,
  /^ {4}Receipts \(2026-09-16\)/)
assert.ok(threeKinds.length > 0,
  '(f) [M6] sim precondition: the `driver:suite-runs` paragraph is still there — the range ' +
  'the Proof\'s fifth `Run:` line reads')
assert.ok(/jev:finding.*jev:tier.*jev:suite-red.*POST \/v1\/systemone.*one log line and no row.*read by nothing/
  .test(joined(threeKinds)),
  '(f) [M6] the paragraph after `driver:suite-runs` names `jev:finding`, `jev:tier` and ' +
  '`jev:suite-red`, `POST /v1/systemone`, that a failed call is one log line and no row, ' +
  'and that they are read by nothing — in that order. (Proof `Run:` line 5) The range ' +
  'read: ' + JSON.stringify(joined(threeKinds)))

// Run: sed -n '/^- \*\*Integration naming:\*\*/,/^- \*\*/p' fleet/CONTRACT.md | grep -q 'typesafe.*http-proxy'
const naming = sedRange(contract, /^- \*\*Integration naming:\*\*/, /^- \*\*/)
assert.ok(naming.length > 0,
  '(f) [M6] sim precondition: the `Integration naming` bullet is still there — the range ' +
  'the Proof\'s sixth `Run:` line reads')
assert.ok(/typesafe.*http-proxy/.test(joined(naming)),
  '(f) [M6] the `Integration naming` bullet names the `typesafe` **http-proxy**, created on ' +
  '`tag:fleet` like the rest. (Proof `Run:` line 6) The bullet read: ' +
  JSON.stringify(joined(naming)))

// Run: test "$(grep -c 'test_jev_client.mjs\|test_run_engine_jev_finding.mjs\|…' fleet/tests/README.md)" = 4
const readme = readAt('fleet/tests/README.md')
const indexed = countLines(readme,
  /test_jev_client\.mjs|test_run_engine_jev_finding\.mjs|test_run_engine_jev_tier\.mjs|test_run_engine_jev_suite_red\.mjs/)
assert.equal(indexed, 4,
  '(f) [M6] `fleet/tests/README.md` gains one line each for `test_jev_client.mjs`, ' +
  '`test_run_engine_jev_finding.mjs`, `test_run_engine_jev_tier.mjs` and ' +
  '`test_run_engine_jev_suite_red.mjs` — four lines naming them. (Proof `Run:` line 7) ' +
  'Got ' + indexed)

// Run: test "$(grep -c 'typesafe.int.exe.xyz' fleet/CONTRACT.md)" -ge 1
assert.ok(countLines(contract, /typesafe\.int\.exe\.xyz/) >= 1,
  '(f) [M6] and the sandbox hostname `typesafe.int.exe.xyz` is present in the contract at ' +
  'least once. (Proof `Run:` line 8)')

console.log('ALL TESTS PASSED')
