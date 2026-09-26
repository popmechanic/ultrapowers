/**
 * fleet/tests/test_jev_client.mjs — the exam for Task 1: *the Jev client* —
 * one POST at the edge hostname, `null` on any failure.
 *
 * This file is the Proof's `Test:`, written whole at the path the Proof names.
 * Every relative import is written for THIS directory: `../` is the
 * repository's `fleet/`, `./` is `fleet/tests/`.
 *
 * Legs (c) through (g) and this header's M3 through M7 paragraphs examined
 * the old engine's `jev:` seam (`runEngine`, `runMain`, the rig, the old
 * boot's env lines, `fleet/CONTRACT.md`) — every one of them needed the old
 * rig, the old engine, `run-main` or `sandbox-boot.sh`, all of which left the
 * tree with the old engine (*the old engine leaves the tree, and the factory
 * clones at base with its own code*). What is left is what examines
 * `factory/jev-client.mjs` alone: its exports, its constants, its one call, and
 * that every failure is `null` and one log line.
 *
 * The Machine clauses under test, restated so a reader can map every assertion
 * back to the contract:
 *
 *   M1 — `factory/jev-client.mjs` exports `JEV_PATH` = `/v1/systemone`,
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
 *
 * The legs, in the order they run here:
 *
 *   (a) [M1] the four constants and the one green call.
 *   (b) [M2] the five failures, plus a `fetchImpl` that throws synchronously.
 *
 * Nothing here opens a socket. The client is reached only through an injected
 * `fetchImpl` whose reply carries the two members `httpTransport` reads —
 * `status` and `text()`.
 */
import assert from 'node:assert/strict'

/** The deliverable, imported dynamically: a tree without it reports the ABSENT
 *  MODULE as an assertion of leg (a) rather than dying at load with no leg
 *  named at all. */
let jev = null
let jevImportError = null
try {
  jev = await import('../../factory/jev-client.mjs')
} catch (error) {
  jevImportError = error
}
assert.ok(jevImportError === null,
  '(a) [M1] `factory/jev-client.mjs` is importable — the module this task creates. Got: ' +
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

console.log('ALL TESTS PASSED')
