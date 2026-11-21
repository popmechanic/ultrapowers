import assert from 'node:assert/strict'

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

const reply = (status, body) => ({ status, text: async () => String(body) })

const recordingFetch = (answer) => {
  const calls = []
  return { calls, fetchImpl: (...argv) => { calls.push(argv); return answer(argv) } }
}

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
  const { calls, fetchImpl } = recordingFetch(async () => reply(200, GREEN_BODY))
  await jev.makeJevClient({ baseUrl: 'https://jev.invalid', fetchImpl })
    .ask({ state: STATE, questions: QUESTIONS })
  assert.equal(calls.length === 1 ? calls[0][0] : null, WANT_URL,
    '(a) [M1] a baseUrl with no trailing slash reaches the same URL — `' + WANT_URL +
    '`; got ' + JSON.stringify(calls.map((c) => c[0])))
}

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
  const { value, threw } = await askWith({ answer: () => { throw new Error('sync boom') } })
  assert.equal(threw, null,
    '(b) [M2] a `fetchImpl` that throws SYNCHRONOUSLY: `ask` still never rejects. It threw: ' +
    String(threw && (threw.stack || threw.message || threw)))
  assert.equal(value, null,
    '(b) [M2] a `fetchImpl` that throws synchronously also resolves `null`; got ' +
    JSON.stringify(value))
}

console.log('ALL TESTS PASSED')
