/**
 * fleet/tests/test_factory_retry.mjs — the exam for "A worker the gateway
 * kills before its first turn is sent once more, and a referee that died is
 * not a review" (Authorized-by #1219; map #1131).
 *
 * Five referees died on the gateway on runs 209-212 — `API Error: 529
 * Overloaded` on 209, 210 (twice) and 211, `500 Internal server error` on
 * 212 — each recorded on its `dispatch:end` row's `error`, each followed by
 * a `referee` row claiming zero findings, and the task adopted as if
 * reviewed. `factory/retry.mjs` is a new, pure, import-nothing module
 * exporting `isGatewayError`, `infraBackoffMs`, `shouldRetry` and
 * `retrying`; `factory/engine.mjs`'s `makeRefoldDispatch` now takes
 * `{ worker, appendEvent, policy, sleep }` and re-dispatches once, labelled
 * `<label>:retry` with `retry_of`, when the first attempt's error is a
 * gateway shape and it produced no assistant turn.
 *
 * Legs, each naming the Machine clause it comes from:
 *
 *   (a) [M1] `shouldRetry({ error, turns, policy })`: exactly `true` for the
 *       gateway 529 message with `turns` `0` and a policy whose backoff cell
 *       is `60000`; exactly `false` when `turns` is `1`, when `error` is
 *       `'boom'`, when `error` is `null`, and when the cell's `value` is `0`
 *       — each varied one at a time off the same base call;
 *   (b) [M2] `makeRefoldDispatch` with a `worker` that throws the M1 error
 *       string once then resolves a sentinel: the resolved value is the
 *       sentinel by identity, `sleep` was called exactly once with `60000`,
 *       `appendEvent` received exactly four rows in the kind order
 *       `dispatch:start, dispatch:end, dispatch:start, dispatch:end`, rows
 *       three and four carry `label: 'resolve:refold:1:retry'` and
 *       `retry_of: 'resolve:refold:1'`, rows one and two carry
 *       `label: 'resolve:refold:1'` and no `retry_of` key, row two's `error`
 *       is the M1 string and row four's is exactly `null`, and the worker's
 *       second call argument has `label: 'resolve:refold:1:retry'`;
 *   (c) [M3] no second attempt when the rule does not hold: a `'boom'`-
 *       throwing worker, a worker that reports one assistant turn before
 *       throwing the M1 string, and the M1 string against a policy whose
 *       cell is `0` each yield exactly two rows and zero `sleep` calls; a
 *       worker that throws the M1 string on both calls yields exactly four
 *       rows, one `sleep` call, and an answer whose `error` is a string;
 *   (d) [M4] read against the diff by the plan's own `Run:` greps and the
 *       policy-file check, not this file — pinned here only by import shape.
 *
 * This exam is pure: importing `factory/engine.mjs` runs nothing (its CLI
 * entry is guarded), `factory/retry.mjs` imports nothing itself, and every
 * `worker`/`appendEvent`/`sleep` is written here — no child process, no
 * disk, no network, no rig.
 */

import assert from 'node:assert/strict'

import { shouldRetry } from '../../factory/retry.mjs'
import { makeRefoldDispatch } from '../../factory/engine.mjs'

const GATEWAY_ERROR =
  'Claude Code returned an error result: API Error: 529 Overloaded. This is a server-side issue, usually temporary — try again in a moment.'

const BACKOFF_POLICY = { dispatch: { infra_backoff_ms: { value: 60000 } } }
const NO_BACKOFF_POLICY = { dispatch: { infra_backoff_ms: { value: 0 } } }

const BASE_OPTS = {
  taskId: undefined,
  label: 'resolve:refold:1',
  role: 'resolve',
  cwd: '/w',
  prompt: 'p',
  systemPrompt: 's',
  model: 'm',
  files: [],
  readOnly: true,
}

// ── a. [M1] shouldRetry: true on the gateway shape, false on each variation ──
{
  assert.equal(
    shouldRetry({ error: GATEWAY_ERROR, turns: 0, policy: BACKOFF_POLICY }),
    true,
    '(a) [M1] shouldRetry is exactly true for the gateway 529 error, turns 0, backoff 60000',
  )

  assert.equal(
    shouldRetry({ error: GATEWAY_ERROR, turns: 1, policy: BACKOFF_POLICY }),
    false,
    '(a) [M1] shouldRetry is exactly false when turns is 1',
  )

  assert.equal(
    shouldRetry({ error: 'boom', turns: 0, policy: BACKOFF_POLICY }),
    false,
    "(a) [M1] shouldRetry is exactly false when error is 'boom'",
  )

  assert.equal(
    shouldRetry({ error: null, turns: 0, policy: BACKOFF_POLICY }),
    false,
    '(a) [M1] shouldRetry is exactly false when error is null',
  )

  assert.equal(
    shouldRetry({ error: GATEWAY_ERROR, turns: 0, policy: NO_BACKOFF_POLICY }),
    false,
    "(a) [M1] shouldRetry is exactly false when the cell's value is 0",
  )
}

// ── b. [M2] makeRefoldDispatch: one retry on a gateway death with no turns ──
{
  const sentinel = { result: { structured_output: { status: 'RESOLVED', hunks: [] } }, denials: [] }
  const rows = []
  const sleepCalls = []
  const sleep = async (ms) => { sleepCalls.push(ms) }

  let callCount = 0
  const workerArgs = []
  const worker = async (arg) => {
    callCount += 1
    workerArgs.push(arg)
    if (callCount === 1) throw GATEWAY_ERROR
    return sentinel
  }

  const dispatch = makeRefoldDispatch({
    worker,
    appendEvent: (row) => rows.push(row),
    policy: BACKOFF_POLICY,
    sleep,
  })

  const resolved = await dispatch(BASE_OPTS)

  assert.equal(resolved, sentinel, '(b) [M2] the call resolves exactly the sentinel object, by identity')

  assert.deepEqual(sleepCalls, [60000], '(b) [M2] sleep was called exactly once, with 60000')

  assert.equal(rows.length, 4, '(b) [M2] appendEvent received exactly four rows')
  assert.deepEqual(
    rows.map((r) => r.kind),
    ['dispatch:start', 'dispatch:end', 'dispatch:start', 'dispatch:end'],
    '(b) [M2] the row kinds are exactly dispatch:start, dispatch:end, dispatch:start, dispatch:end in order',
  )

  const [row1, row2, row3, row4] = rows

  assert.equal(row1.label, 'resolve:refold:1', '(b) [M2] the first row carries label resolve:refold:1')
  assert.equal('retry_of' in row1, false, '(b) [M2] the first row carries no retry_of key')

  assert.equal(row2.label, 'resolve:refold:1', '(b) [M2] the second row carries label resolve:refold:1')
  assert.equal('retry_of' in row2, false, '(b) [M2] the second row carries no retry_of key')
  assert.equal(row2.error, GATEWAY_ERROR, "(b) [M2] the second row's error is the M1 gateway string")

  assert.equal(row3.label, 'resolve:refold:1:retry', '(b) [M2] the third row carries label resolve:refold:1:retry')
  assert.equal(row3.retry_of, 'resolve:refold:1', '(b) [M2] the third row carries retry_of resolve:refold:1')

  assert.equal(row4.label, 'resolve:refold:1:retry', '(b) [M2] the fourth row carries label resolve:refold:1:retry')
  assert.equal(row4.retry_of, 'resolve:refold:1', '(b) [M2] the fourth row carries retry_of resolve:refold:1')
  assert.equal(row4.error, null, "(b) [M2] the fourth row's error is exactly null")

  assert.equal(workerArgs.length, 2, '(b) [M2] the worker was called exactly twice')
  assert.equal(
    workerArgs[1].label,
    'resolve:refold:1:retry',
    "(b) [M2] the worker's second call received an argument whose label is resolve:refold:1:retry",
  )
}

// ── c. [M3] no second attempt when the rule does not hold ──────────────────
{
  // a worker that throws 'boom': not a gateway shape, no retry
  {
    const rows = []
    const sleepCalls = []
    const dispatch = makeRefoldDispatch({
      worker: async () => { throw 'boom' },
      appendEvent: (row) => rows.push(row),
      policy: BACKOFF_POLICY,
      sleep: async (ms) => { sleepCalls.push(ms) },
    })
    await dispatch(BASE_OPTS)
    assert.equal(rows.length, 2, "(c) [M3] a 'boom' worker yields exactly two rows")
    assert.equal(sleepCalls.length, 0, "(c) [M3] a 'boom' worker never calls sleep")
  }

  // a worker that reports one assistant turn before throwing the M1 string: turns !== 0, no retry
  {
    const rows = []
    const sleepCalls = []
    const dispatch = makeRefoldDispatch({
      worker: async (arg) => {
        await arg.onMessage({ type: 'assistant', message: { content: [] } })
        throw GATEWAY_ERROR
      },
      appendEvent: (row) => rows.push(row),
      policy: BACKOFF_POLICY,
      sleep: async (ms) => { sleepCalls.push(ms) },
    })
    await dispatch(BASE_OPTS)
    assert.equal(rows.length, 2, '(c) [M3] a worker with one assistant turn before the gateway throw yields exactly two rows')
    assert.equal(sleepCalls.length, 0, '(c) [M3] a worker with one assistant turn before the gateway throw never calls sleep')
  }

  // the M1 gateway throw against a policy cell of value 0: no retry
  {
    const rows = []
    const sleepCalls = []
    const dispatch = makeRefoldDispatch({
      worker: async () => { throw GATEWAY_ERROR },
      appendEvent: (row) => rows.push(row),
      policy: NO_BACKOFF_POLICY,
      sleep: async (ms) => { sleepCalls.push(ms) },
    })
    await dispatch(BASE_OPTS)
    assert.equal(rows.length, 2, "(c) [M3] the gateway throw against a policy cell of value 0 yields exactly two rows")
    assert.equal(sleepCalls.length, 0, "(c) [M3] the gateway throw against a policy cell of value 0 never calls sleep")
  }

  // a worker that throws the M1 string on both calls: one retry, still dies, error is a string
  {
    const rows = []
    const sleepCalls = []
    const dispatch = makeRefoldDispatch({
      worker: async () => { throw GATEWAY_ERROR },
      appendEvent: (row) => rows.push(row),
      policy: BACKOFF_POLICY,
      sleep: async (ms) => { sleepCalls.push(ms) },
    })
    const answer = await dispatch(BASE_OPTS)
    assert.equal(rows.length, 4, '(c) [M3] a worker that throws the gateway string on both calls yields exactly four rows')
    assert.equal(sleepCalls.length, 1, '(c) [M3] a worker that throws the gateway string on both calls calls sleep exactly once')
    assert.equal(typeof answer.error, 'string', "(c) [M3] the resulting answer's error has typeof 'string'")
  }
}

console.log('ALL TESTS PASSED')
