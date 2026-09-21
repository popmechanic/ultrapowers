/**
 * fleet/tests/test_factory_judge_rows.mjs — the exam for "The judge's one door
 * writes a row per call, takes a `who`, and carries the union reading and the
 * supervisor's second reader".
 *
 * `factory/judge.mjs` already exists; this task modifies it. Every reader goes
 * through one function, `askOnce(what, state, questions, read)`, and this exam
 * proves the row `askOnce` now writes on every call, the `who` plumbing every
 * reader accepts, and two new readers: `readSupervisorObserved` and
 * `readUnion`. It hands `makeJudge` a recording `ask`, a recording `emit` and a
 * fake `now`, reads the real `factory/questions.json` and `factory/policy.json`
 * (neither overridden, since the Proof's own numbers — the `supervisor`
 * question set's four keys, the `resolve` set's three union questions, and
 * `policy.json`'s `resolve.union` thresholds 0.9 / 0.2 / 0.2 — are exactly
 * what those files already carry), and never opens a socket.
 *
 * The Machine clauses under test, restated:
 *   M1 — one row per `ask` call: keys exactly `kind, site, task, label, keys,
 *        values, state_bytes, ms, answered`; `kind` is `jev`; `keys` is
 *        `Object.keys` of the questions sent, in order; `values` is the
 *        answers object exactly as `ask` resolved it; `state_bytes` is
 *        `Buffer.byteLength(JSON.stringify(state))` of the state sent; `ms` is
 *        `now()` after minus `now()` before (`now` defaults to `Date.now`);
 *        `answered` is `true`.
 *   M2 — `ask` resolving `null` or throwing: the reader resolves what it
 *        resolves today, and the one row carries `answered: false`,
 *        `values: null`.
 *   M3 — a `who: { task, label }` on the argument: the row's `task`/`label`
 *        are those values, or `null` when absent; `who` is never a key of the
 *        state handed to `ask`; for `readNote`, `readAmendment`,
 *        `readSupervisor` the state is the argument minus `who`, every other
 *        key unchanged.
 *   M4 — a throwing `emit`, or no `emit`, changes no reading and throws
 *        nothing; a reader that never calls `ask` (`readGuards` over empty
 *        `tests`) emits no row.
 *   M5 — the row's `site` is the name handed to `askOnce`; the new
 *        `readSupervisorObserved(arg)` puts the `supervisor` set's four
 *        questions over its argument without `who`, resolves flat answers
 *        like `readSupervisor`, and emits site `supervisor.observed`.
 *   M6 — the new `readUnion({ hunks, who })` puts the `resolve` set's
 *        `independent_additions`, `shared_anchor`, `ordering_matters`
 *        questions over `{ hunks }` at site `resolve.union`, and resolves
 *        `{ union: true }` / `{ union: false }` / `null` per policy.
 *
 * Legs, each naming the Machine clause it comes from:
 *   (a) [M1] a recording `ask`/`emit`, `now` returning 1000 then 1250:
 *       `readTask` emits exactly one row of the exact key set, `kind: 'jev'`,
 *       `site: 'task'`, `ms: 250`, `answered: true`, `keys`/`values`/
 *       `state_bytes` all read off the recorded call.
 *   (b) [M2] an `ask` resolving `null`, then one that throws: each time
 *       `readTask` resolves `null` and emits one row, `answered: false`,
 *       `values: null`.
 *   (c) [M3] `readSupervisor` with and without `who`.
 *   (d) [M4] a throwing `emit`, no `emit`, and `readGuards` over empty tests.
 *   (e) [M5] `readSupervisorObserved`.
 *   (f) [M6] `readUnion` against the real policy's `resolve.union`.
 */

import assert from 'node:assert/strict'

import { makeJudge } from '../../factory/judge.mjs'

/** A recording `ask`: every call is pushed to `calls` as `{ state, questions
 *  }`, and `answer` (a plain value, or a function of the call) supplies the
 *  resolution — which may itself throw or resolve `null`. */
const recordingAsk = (answer) => {
  const calls = []
  const ask = async (call) => {
    calls.push({ state: call.state, questions: call.questions })
    return typeof answer === 'function' ? answer(call) : answer
  }
  return { calls, ask }
}

/** A recording `emit`: every row pushed to `rows`, in call order. */
const recordingEmit = () => {
  const rows = []
  return { rows, emit: (row) => rows.push(row) }
}

const ROW_KEYS = ['answered', 'keys', 'kind', 'label', 'ms', 'site', 'state_bytes', 'task', 'values']

// ══════════════════════════════════════════════════════════════════════════
// (a) [M1] one row per call, the whole shape
// ══════════════════════════════════════════════════════════════════════════
{
  const { calls, ask } = recordingAsk(
    { difficulty: 1, design_open: 0.2, review_difficulty: 1, doc_or_prose_only: 0.1 })
  const { rows, emit } = recordingEmit()
  const nowValues = [1000, 1250]
  let nowCalls = 0
  const now = () => nowValues[nowCalls++]

  const judge = makeJudge({ ask, emit, now })
  const result = await judge.readTask({ title: 't', body: 'b' })

  assert.equal(rows.length, 1,
    '(a) [M1] a call that calls `ask` calls `emit` exactly once; got ' + rows.length + ' row(s)')
  const row = rows[0]
  assert.deepEqual(Object.keys(row).sort(), ROW_KEYS,
    '(a) [M1] the row\'s keys are exactly `kind, site, task, label, keys, values, state_bytes, ' +
    'ms, answered`; got ' + JSON.stringify(Object.keys(row).sort()))
  assert.equal(row.kind, 'jev',
    '(a) [M1] `kind` is `jev`; got ' + JSON.stringify(row.kind))
  assert.equal(row.site, 'task',
    '(a) [M1] `readTask` hands `askOnce` the site `task`; got ' + JSON.stringify(row.site))
  assert.equal(row.ms, 250,
    '(a) [M1] `ms` is `now()` read after the call minus `now()` read before it (1250 - 1000 = ' +
    '250); got ' + JSON.stringify(row.ms))
  assert.equal(row.answered, true,
    '(a) [M1] a call that answered carries `answered: true`; got ' + JSON.stringify(row.answered))
  assert.equal(calls.length, 1,
    '(a) [M1] `readTask` called `ask` exactly once; got ' + calls.length)
  assert.deepEqual(row.keys, Object.keys(calls[0].questions),
    '(a) [M1] `keys` is `Object.keys` of the questions `ask` was sent, IN ORDER; got ' +
    JSON.stringify(row.keys) + ' for questions ' + JSON.stringify(Object.keys(calls[0].questions)))
  assert.deepEqual(row.values,
    { difficulty: 1, design_open: 0.2, review_difficulty: 1, doc_or_prose_only: 0.1 },
    '(a) [M1] `values` is the answers object exactly as `ask` resolved it; got ' +
    JSON.stringify(row.values))
  const wantBytes = Buffer.byteLength(JSON.stringify(calls[0].state))
  assert.equal(row.state_bytes, wantBytes,
    '(a) [M1] `state_bytes` is `Buffer.byteLength(JSON.stringify(state))` of the state `ask` was ' +
    'sent (' + wantBytes + '); got ' + JSON.stringify(row.state_bytes))
  assert.ok(result && typeof result === 'object',
    '(a) [M1] the reader itself still resolves its usual reading; got ' + JSON.stringify(result))
}

// `now` defaults to `Date.now` when omitted — the row still carries a finite,
// non-negative `ms`.
{
  const { ask } = recordingAsk(
    { difficulty: 1, design_open: 0.2, review_difficulty: 1, doc_or_prose_only: 0.1 })
  const { rows, emit } = recordingEmit()
  const judge = makeJudge({ ask, emit })
  await judge.readTask({ title: 't', body: 'b' })
  assert.equal(rows.length, 1,
    '(a) [M1] one row even with no `now` supplied; got ' + rows.length)
  assert.equal(typeof rows[0].ms, 'number',
    '(a) [M1] `now` defaults to `Date.now`, so `ms` is still a number; got ' +
    JSON.stringify(rows[0].ms))
  assert.ok(Number.isFinite(rows[0].ms) && rows[0].ms >= 0,
    '(a) [M1] and that number is finite and non-negative; got ' + JSON.stringify(rows[0].ms))
}

// ══════════════════════════════════════════════════════════════════════════
// (b) [M2] `ask` resolving `null`, or throwing: one row, `answered: false`
// ══════════════════════════════════════════════════════════════════════════
{
  const { rows, emit } = recordingEmit()
  const judge = makeJudge({ ask: async () => null, emit })
  const result = await judge.readTask({ title: 't', body: 'b' })
  assert.equal(result, null,
    '(b) [M2] `ask` resolving `null`: `readTask` resolves `null`, as it does today; got ' +
    JSON.stringify(result))
  assert.equal(rows.length, 1,
    '(b) [M2] `ask` resolving `null`: exactly one row is emitted; got ' + rows.length)
  assert.equal(rows[0].answered, false,
    '(b) [M2] `ask` resolving `null`: the row carries `answered: false`; got ' +
    JSON.stringify(rows[0].answered))
  assert.equal(rows[0].values, null,
    '(b) [M2] `ask` resolving `null`: the row carries `values: null`; got ' +
    JSON.stringify(rows[0].values))
}
{
  const { rows, emit } = recordingEmit()
  const judge = makeJudge({ ask: async () => { throw new Error('ask boom') }, emit })
  const result = await judge.readTask({ title: 't', body: 'b' })
  assert.equal(result, null,
    '(b) [M2] `ask` throwing: `readTask` resolves `null`, as it does today; got ' +
    JSON.stringify(result))
  assert.equal(rows.length, 1,
    '(b) [M2] `ask` throwing: exactly one row is emitted; got ' + rows.length)
  assert.equal(rows[0].answered, false,
    '(b) [M2] `ask` throwing: the row carries `answered: false`; got ' +
    JSON.stringify(rows[0].answered))
  assert.equal(rows[0].values, null,
    '(b) [M2] `ask` throwing: the row carries `values: null`; got ' + JSON.stringify(rows[0].values))
}

// ══════════════════════════════════════════════════════════════════════════
// (c) [M3] `who` on the argument: row `task`/`label`, and stripped from state
// ══════════════════════════════════════════════════════════════════════════
{
  const supervisorAnswers =
    { stuck: 0.1, off_track: 0.1, needs_human: 0.1, done_not_exited: 0.1 }
  const { calls, ask } = recordingAsk(supervisorAnswers)
  const { rows, emit } = recordingEmit()
  const judge = makeJudge({ ask, emit })
  await judge.readSupervisor(
    { label: 'exam:1', task: '1', transcript: 'x', who: { task: '1', label: 'exam:1' } })

  assert.equal(calls.length, 1,
    '(c) [M3] `readSupervisor` called `ask` exactly once; got ' + calls.length)
  assert.deepEqual(Object.keys(calls[0].state).sort(), ['label', 'task', 'transcript'],
    '(c) [M3] for `readSupervisor` the state sent to `ask` is the argument minus `who`, every ' +
    'other key unchanged (so `who` is never a key of it); got ' +
    JSON.stringify(Object.keys(calls[0].state).sort()))
  assert.equal(rows[0].task, '1',
    '(c) [M3] the row\'s `task` is `who.task`; got ' + JSON.stringify(rows[0].task))
  assert.equal(rows[0].label, 'exam:1',
    '(c) [M3] the row\'s `label` is `who.label`; got ' + JSON.stringify(rows[0].label))
}
{
  const supervisorAnswers =
    { stuck: 0.1, off_track: 0.1, needs_human: 0.1, done_not_exited: 0.1 }
  const { ask } = recordingAsk(supervisorAnswers)
  const { rows, emit } = recordingEmit()
  const judge = makeJudge({ ask, emit })
  await judge.readSupervisor({ label: 'exam:1', task: '1', transcript: 'x' })

  assert.equal(rows[0].task, null,
    '(c) [M3] no `who` on the argument: the row\'s `task` is `null`; got ' +
    JSON.stringify(rows[0].task))
  assert.equal(rows[0].label, null,
    '(c) [M3] no `who` on the argument: the row\'s `label` is `null`; got ' +
    JSON.stringify(rows[0].label))
}

// ══════════════════════════════════════════════════════════════════════════
// (d) [M4] a throwing `emit`, no `emit`, and a reader that never calls `ask`
// ══════════════════════════════════════════════════════════════════════════
{
  const taskAnswers = { difficulty: 1, design_open: 0.2, review_difficulty: 1, doc_or_prose_only: 0.1 }
  const arg = { title: 't', body: 'b' }

  const quiet = recordingAsk(taskAnswers)
  const baseline = await makeJudge({ ask: quiet.ask, emit: () => {} }).readTask(arg)

  const throwingAsk = recordingAsk(taskAnswers)
  let threwFromEmit = null
  let withThrowingEmit
  try {
    withThrowingEmit = await makeJudge({
      ask: throwingAsk.ask, emit: () => { throw new Error('emit boom') },
    }).readTask(arg)
  } catch (error) { threwFromEmit = error }
  assert.equal(threwFromEmit, null,
    '(d) [M4] an `emit` that throws: the call itself throws nothing. It threw: ' +
    String(threwFromEmit && (threwFromEmit.stack || threwFromEmit.message || threwFromEmit)))
  assert.deepEqual(withThrowingEmit, baseline,
    '(d) [M4] an `emit` that throws changes no reading; got ' + JSON.stringify(withThrowingEmit) +
    ' vs the quiet-emit reading ' + JSON.stringify(baseline))

  const noEmitAsk = recordingAsk(taskAnswers)
  const withNoEmit = await makeJudge({ ask: noEmitAsk.ask }).readTask(arg)
  assert.deepEqual(withNoEmit, baseline,
    '(d) [M4] no `emit` at all changes no reading; got ' + JSON.stringify(withNoEmit) +
    ' vs the quiet-emit reading ' + JSON.stringify(baseline))
}
{
  const { rows, emit } = recordingEmit()
  const judge = makeJudge({ ask: async () => { throw new Error('ask must not be called') }, emit })
  const result = await judge.readGuards({ patch: 'p', tests: [] })
  assert.equal(rows.length, 0,
    '(d) [M4] `readGuards` over an empty `tests` returns without calling `ask`, so it emits no ' +
    'row; got ' + rows.length + ' row(s)')
  assert.equal(result, null,
    '(d) [M4] `readGuards` over an empty `tests` still resolves `null`, as it does today; got ' +
    JSON.stringify(result))
}

// ══════════════════════════════════════════════════════════════════════════
// (e) [M5] `readSupervisorObserved`: site `supervisor.observed`, no `who`
// ══════════════════════════════════════════════════════════════════════════
{
  const observedAnswers = { stuck: 0.2, off_track: 0.2, needs_human: 0.2, done_not_exited: 0.2 }
  const { calls, ask } = recordingAsk(observedAnswers)
  const { rows, emit } = recordingEmit()
  const judge = makeJudge({ ask, emit })

  assert.equal(typeof judge.readSupervisorObserved, 'function',
    '(e) [M5] `makeJudge` produces a `readSupervisorObserved` reader; got ' +
    JSON.stringify(typeof judge.readSupervisorObserved))

  const result = await judge.readSupervisorObserved(
    { observed: { edits: 2 }, who: { task: '3', label: 'impl:3:0' } })

  assert.equal(calls.length, 1,
    '(e) [M5] `readSupervisorObserved` called `ask` exactly once; got ' + calls.length)
  assert.deepEqual(calls[0].state, { observed: { edits: 2 } },
    '(e) [M5] it puts the four questions over its argument WITHOUT `who`; the state sent to ' +
    '`ask` is `{ observed }`; got ' + JSON.stringify(calls[0].state))
  assert.deepEqual(Object.keys(calls[0].questions), ['stuck', 'off_track', 'needs_human', 'done_not_exited'],
    '(e) [M5] the questions sent are the `supervisor` set\'s four: `stuck, off_track, ' +
    'needs_human, done_not_exited`; got ' + JSON.stringify(Object.keys(calls[0].questions)))
  assert.equal(rows[0].site, 'supervisor.observed',
    '(e) [M5] the row\'s `site` is `supervisor.observed`, so the census can tell the two ' +
    'supervisor readings apart; got ' + JSON.stringify(rows[0].site))
  assert.deepEqual(result, observedAnswers,
    '(e) [M5] it resolves the flat answers, as `readSupervisor` does; got ' + JSON.stringify(result))
}

// ══════════════════════════════════════════════════════════════════════════
// (f) [M6] `readUnion`: the `resolve.union` reading, over `{ hunks }`
// ══════════════════════════════════════════════════════════════════════════
{
  const hunks = [{ path: 'a.js', text: 'diff a' }, { path: 'b.js', text: 'diff b' }]

  // The real `factory/policy.json`'s `resolve.union` is exactly
  // `{ independent_additions: 0.9, shared_anchor_max: 0.2, ordering_matters_max: 0.2 }`
  // today, so `makeJudge` is left to read its own default `policyPath` here.

  {
    const { calls, ask } = recordingAsk(
      { independent_additions: 0.95, shared_anchor: 0.1, ordering_matters: 0.1 })
    const { rows, emit } = recordingEmit()
    const judge = makeJudge({ ask, emit })

    assert.equal(typeof judge.readUnion, 'function',
      '(f) [M6] `makeJudge` produces a `readUnion` reader; got ' + JSON.stringify(typeof judge.readUnion))

    const result = await judge.readUnion({ hunks, who: { task: 't1', label: 'impl:t1:0' } })
    assert.deepEqual(result, { union: true },
      '(f) [M6] independent_additions 0.95 >= 0.9, shared_anchor 0.1 <= 0.2, ordering_matters ' +
      '0.1 <= 0.2: resolves `{ union: true }`; got ' + JSON.stringify(result))
    assert.equal(calls.length, 1,
      '(f) [M6] `readUnion` called `ask` exactly once; got ' + calls.length)
    assert.deepEqual(calls[0].state, { hunks },
      '(f) [M6] it puts the three questions over the state `{ hunks }` — `who` is never a key ' +
      'of it; got ' + JSON.stringify(calls[0].state))
    assert.deepEqual(Object.keys(calls[0].questions).sort(),
      ['independent_additions', 'ordering_matters', 'shared_anchor'],
      '(f) [M6] the questions sent are `independent_additions`, `shared_anchor`, ' +
      '`ordering_matters`; got ' + JSON.stringify(Object.keys(calls[0].questions).sort()))
    assert.equal(rows[0].site, 'resolve.union',
      '(f) [M6] the row\'s `site` is `resolve.union`; got ' + JSON.stringify(rows[0].site))
  }
  {
    const { ask } = recordingAsk(
      { independent_additions: 0.95, shared_anchor: 0.3, ordering_matters: 0.1 })
    const judge = makeJudge({ ask })
    const result = await judge.readUnion({ hunks })
    assert.deepEqual(result, { union: false },
      '(f) [M6] shared_anchor 0.3 > shared_anchor_max 0.2: resolves `{ union: false }`; got ' +
      JSON.stringify(result))
  }
  {
    const { ask } = recordingAsk({ independent_additions: 0.95, ordering_matters: 0.1 })
    const judge = makeJudge({ ask })
    const result = await judge.readUnion({ hunks })
    assert.equal(result, null,
      '(f) [M6] a missing `shared_anchor` answer: resolves `null`; got ' + JSON.stringify(result))
  }
}

console.log('ALL TESTS PASSED')
