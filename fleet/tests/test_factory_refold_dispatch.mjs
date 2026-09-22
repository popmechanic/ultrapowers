/**
 * fleet/tests/test_factory_refold_dispatch.mjs — the exam for "The re-fold's
 * dispatch writes a worker's error on its dispatch:end row" (Authorized-by
 * #1207; map #1131).
 *
 * On run-207 a re-fold's dispatched resolver threw before its first turn, and
 * the reason went nowhere: the `--refold` entry's own `dispatch` folded the
 * error into the answer it returned but wrote a bare `dispatch:end` row, so
 * the record showed only a 642 ms gap between `dispatch:start` and
 * `dispatch:end` with no `worker:*` row between them. `factory/engine.mjs`
 * now exports `makeRefoldDispatch({ worker, appendEvent })`, answering an
 * async `dispatch(opts)` whose `dispatch:end` row carries the error text.
 *
 * Legs, each naming the Machine clause it comes from:
 *
 *   (a) [M1] a worker that rejects an `Error` with a 600-character message,
 *       and a worker that rejects the bare string `'boom'`: the call never
 *       rejects, resolves `{ result: null, denials: [] , error: <first 500
 *       chars> }`, and `appendEvent` received exactly two rows in order —
 *       `dispatch:start` then `dispatch:end` — each carrying `task`, `label`,
 *       `role` off `opts`, the second also carrying that same `error` string;
 *   (b) [M2] a worker that records its one argument and resolves a sentinel
 *       object: the call resolves exactly that sentinel by identity, the
 *       `dispatch:end` row's `error` is exactly `null`, the worker was called
 *       exactly once with an argument built off `opts` as M2 describes, and
 *       that argument's `onDenied` appends the row it is handed through
 *       `appendEvent`;
 *   (c) [M3] read against the diff by the plan's own `Run:` greps, not this
 *       file — the export is defined at module level, and `runRefold`'s body
 *       assigns a `makeRefoldDispatch(` call.
 *
 * This exam is pure: importing `factory/engine.mjs` runs nothing (its CLI
 * entry is guarded by `invokedDirectly`), and every `worker`/`appendEvent` is
 * written here — no child process, no disk, no network, no rig.
 */

import assert from 'node:assert/strict'

import { makeRefoldDispatch } from '../../factory/engine.mjs'

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

// ── a. [M1] a rejecting worker: the call never rejects, and the error is folded ──
{
  const longMessage = 'x'.repeat(600)
  const rows = []
  const dispatch = makeRefoldDispatch({
    worker: async () => { throw new Error(longMessage) },
    appendEvent: (row) => rows.push(row),
  })

  const answer = await dispatch(BASE_OPTS)

  assert.equal(answer.result, null, '(a) [M1] answer.result is exactly null')
  assert.ok(Array.isArray(answer.denials), '(a) [M1] answer.denials is an array')
  assert.equal(answer.denials.length, 0, '(a) [M1] answer.denials has length exactly 0')
  assert.equal(typeof answer.error, 'string', '(a) [M1] answer.error is a string')
  assert.equal(answer.error.length, 500, '(a) [M1] answer.error has length exactly 500')
  assert.equal(answer.error, 'x'.repeat(500), "(a) [M1] answer.error equals the message's first 500 characters")

  assert.equal(rows.length, 2, '(a) [M1] appendEvent received exactly two rows')
  const [startRow, endRow] = rows
  assert.equal(startRow.kind, 'dispatch:start', '(a) [M1] the first row\'s kind is dispatch:start')
  assert.equal(startRow.label, 'resolve:refold:1', '(a) [M1] the first row carries opts.label')
  assert.equal(startRow.role, 'resolve', '(a) [M1] the first row carries opts.role')
  assert.equal(startRow.task, BASE_OPTS.taskId, '(a) [M1] the first row carries opts.task')

  assert.equal(endRow.kind, 'dispatch:end', '(a) [M1] the second row\'s kind is dispatch:end')
  assert.equal(endRow.label, 'resolve:refold:1', '(a) [M1] the second row carries opts.label')
  assert.equal(endRow.role, 'resolve', '(a) [M1] the second row carries opts.role')
  assert.equal(endRow.task, BASE_OPTS.taskId, '(a) [M1] the second row carries opts.task')
  assert.equal(endRow.error, 'x'.repeat(500), '(a) [M1] the second row\'s error equals the same string the answer carries')

  // a bare-string rejection: error is the string itself, unmodified
  const rows2 = []
  const dispatch2 = makeRefoldDispatch({
    worker: async () => { throw 'boom' },
    appendEvent: (row) => rows2.push(row),
  })
  const answer2 = await dispatch2(BASE_OPTS)
  assert.equal(answer2.error, 'boom', "(a) [M1] a bare-string rejection's answer.error is exactly 'boom'")
  assert.equal(rows2.length, 2, '(a) [M1] the bare-string case also appends exactly two rows')
  assert.equal(rows2[1].kind, 'dispatch:end', '(a) [M1] the bare-string case\'s second row is dispatch:end')
  assert.equal(rows2[1].error, 'boom', "(a) [M1] the bare-string case's dispatch:end row's error is exactly 'boom'")
}

// ── b. [M2] a resolving worker: the sentinel passes through, and onDenied appends ──
{
  const sentinel = { result: { structured_output: { status: 'RESOLVED', hunks: [] } }, denials: [] }
  const filesArg = []
  const rows = []
  let callCount = 0
  let recordedArg = null

  const worker = async (arg) => {
    callCount += 1
    recordedArg = arg
    return sentinel
  }

  const dispatch = makeRefoldDispatch({ worker, appendEvent: (row) => rows.push(row) })
  const opts = { ...BASE_OPTS, files: filesArg }
  const resolved = await dispatch(opts)

  assert.equal(resolved, sentinel, '(b) [M2] the call resolves exactly the sentinel object, by identity')

  assert.equal(rows.length, 2, '(b) [M2] appendEvent received exactly two rows')
  const endRow = rows[1]
  assert.equal(endRow.kind, 'dispatch:end', '(b) [M2] the second row\'s kind is dispatch:end')
  assert.equal(endRow.error, null, '(b) [M2] the second row\'s error is exactly null')

  assert.equal(callCount, 1, '(b) [M2] worker was called exactly once')
  assert.ok(recordedArg, '(b) [M2] worker was called with an argument')
  assert.equal(recordedArg.cwd, '/w', '(b) [M2] the argument\'s cwd comes off opts')
  assert.equal(recordedArg.prompt, 'p', '(b) [M2] the argument\'s prompt comes off opts')
  assert.equal(recordedArg.systemPrompt, 's', '(b) [M2] the argument\'s systemPrompt comes off opts')
  assert.equal(recordedArg.model, 'm', '(b) [M2] the argument\'s model comes off opts')
  assert.equal(recordedArg.files, filesArg, '(b) [M2] the argument\'s files is identical to the files given')
  assert.equal(recordedArg.role, 'resolve', '(b) [M2] the argument\'s role comes off opts')
  assert.equal(recordedArg.label, 'resolve:refold:1', '(b) [M2] the argument\'s label comes off opts')
  assert.equal(recordedArg.task, opts.taskId, '(b) [M2] the argument\'s task is opts.taskId')
  assert.equal(recordedArg.readOnly, true, '(b) [M2] the argument\'s readOnly is true when opts.readOnly is true')
  assert.equal(recordedArg.schema, null, '(b) [M2] the argument\'s schema is null when opts.schema was not given')
  assert.equal(typeof recordedArg.onDenied, 'function', '(b) [M2] the argument\'s onDenied is a function')

  const deniedRow = { kind: 'worker:denied', tool: 'Bash' }
  recordedArg.onDenied(deniedRow)
  const deniedRows = rows.filter((r) => r.kind === 'worker:denied')
  assert.equal(deniedRows.length, 1, '(b) [M2] calling onDenied left exactly one worker:denied row in appendEvent')
}

// ── c. [M2] schema passes through when opts.schema is given ────────────────
{
  const schema = { type: 'object' }
  let recordedArg = null
  const dispatch = makeRefoldDispatch({
    worker: async (arg) => { recordedArg = arg; return { result: null, denials: [] } },
    appendEvent: () => {},
  })
  await dispatch({ ...BASE_OPTS, schema })
  assert.equal(recordedArg.schema, schema, '(c) [M2] the argument\'s schema is opts.schema when one was given')
}

// ── #1228: the dispatch:end row carries the dispatched model and the ids the result reports ──

// ── d. [M1] a worker with a null result: model is opts.model, models is null ──
{
  const rows = []
  const dispatch = makeRefoldDispatch({
    worker: async () => ({ result: null, denials: [] }),
    appendEvent: (row) => rows.push(row),
  })

  await dispatch(BASE_OPTS)

  assert.equal(rows.length, 2, '(d) [M1] appendEvent received exactly two rows')
  const endRow = rows[1]
  assert.equal(endRow.kind, 'dispatch:end', '(d) [M1] the second row\'s kind is dispatch:end')
  assert.equal(endRow.model, 'm', '(d) [M1] the second row\'s model is exactly opts.model')
  assert.equal(endRow.models, null, '(d) [M1] the second row\'s models is exactly null when result is null')
}

// ── e. [M2] a worker whose result carries modelUsage: models is its keys, sorted ──
{
  const rows = []
  const dispatch = makeRefoldDispatch({
    worker: async () => ({
      result: {
        modelUsage: {
          'claude-opus-5-5': { inputTokens: 1 },
          'claude-haiku-5': { inputTokens: 1 },
        },
      },
      denials: [],
    }),
    appendEvent: (row) => rows.push(row),
  })

  await dispatch(BASE_OPTS)

  assert.equal(rows.length, 2, '(e) [M2] appendEvent received exactly two rows')
  const endRow = rows[1]
  assert.equal(endRow.kind, 'dispatch:end', '(e) [M2] the second row\'s kind is dispatch:end')
  assert.equal(endRow.model, 'm', '(e) [M2] the second row\'s model is exactly opts.model')
  assert.deepEqual(
    endRow.models,
    ['claude-haiku-5', 'claude-opus-5-5'],
    '(e) [M2] the second row\'s models deep-equals the modelUsage keys sorted ascending, not insertion order'
  )
}

console.log('ALL TESTS PASSED')
