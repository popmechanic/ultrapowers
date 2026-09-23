/**
 * fleet/tests/test_factory_exam_selfcheck.mjs — the exam for "The engine runs
 * the exam at BASE when the examiner hands in, and a rig red buys one
 * examiner round before any implementer" (Authorized-by #1245 desired state 1
 * and 2).
 *
 * `factory/engine.mjs` exports `selfCheckExam({ task, runExam,
 * dispatchExaminer, appendEvent, enabled })`: a pure, module-level function
 * beside `makeRefoldDispatch` — no `fs`, no `sh`, no clone — so this sim
 * drives it with fakes exactly as `fleet/tests/test_factory_refold_dispatch.mjs`
 * drives `makeRefoldDispatch`. `runExam` and `dispatchExaminer` push into one
 * shared `calls` list (`'run'` / `'dispatch'` / `'row'`) so M2's ordering is a
 * fact read back off that list, not inferred.
 *
 * Legs, each naming the Machine clause it comes from:
 *
 *   (a) [M1] a leg answer (`exit: 1`, an `AssertionError` out) with
 *       `enabled: true`: `runExam` is called exactly once, `dispatchExaminer`
 *       exactly zero times, and `appendEvent` received exactly one row
 *       deep-equal to `{ kind: 'exam:self-check', task: '1', attempt: 1,
 *       exit: 1, red: 'leg' }`;
 *   (b) [M2] two rig answers (`exit: 1`, a `TypeError` out) with
 *       `enabled: true`: the shared call list reads exactly
 *       `['row', 'dispatch', 'run', 'row']` once the leading first-`run`
 *       entry is dropped, `dispatchExaminer` was called exactly once with a
 *       `fact` whose text up to the first newline is exactly `EXAM RIG-RED`
 *       and which contains `exit 1` and the first answer's `out`, `runExam`
 *       was called exactly twice, and the two rows carry `attempt: 1` and
 *       `attempt: 2` in that order, both `red: 'rig'`;
 *   (c) [M3] a rig answer with `enabled: false`: `runExam` exactly once,
 *       `dispatchExaminer` exactly zero times, one row with `red: 'rig'`.
 *
 * (M4's placement claim is read against the diff by the plan's own `Run:`
 * greps, not this file.)
 *
 * This exam is pure: importing `factory/engine.mjs` runs nothing (its CLI
 * entry is guarded by `invokedDirectly`), and every `runExam` /
 * `dispatchExaminer` / `appendEvent` is written here — no child process, no
 * disk, no network, no rig. It assumes `redKind` (from the sibling module
 * `./redkind.mjs`) classifies an `AssertionError [ERR_ASSERTION]` out as
 * `'leg'` and a `TypeError: Cannot read properties of undefined` out as
 * `'rig'`, exactly as the task's own canonical examples specify.
 */

import assert from 'node:assert/strict'

import { selfCheckExam } from '../../factory/engine.mjs'

const LEG_OUT = 'AssertionError [ERR_ASSERTION]: (a) [M1] the row is missing'
const RIG_OUT_1 = 'TypeError: Cannot read properties of undefined (reading "red")'
const RIG_OUT_2 = 'TypeError: Cannot read properties of undefined (reading "red") - attempt 2'

// A queue-driven, synchronous fake for runExam: each call shifts the next
// queued { exit, out } answer and records a 'run' entry on the shared list.
function makeRunExam (calls, queue) {
  let i = 0
  return () => {
    calls.push('run')
    const answer = queue[i]
    i += 1
    return answer
  }
}

// ── a. [M1] a leg answer: dispatchExaminer never called, one row appended ──
{
  const calls = []
  const rows = []
  const runExam = makeRunExam(calls, [{ exit: 1, out: LEG_OUT }])
  let dispatchCount = 0
  const dispatchExaminer = async (arg) => { dispatchCount += 1; calls.push('dispatch'); return arg }
  const appendEvent = (row) => { calls.push('row'); rows.push(row) }

  const result = await selfCheckExam({
    task: '1',
    runExam,
    dispatchExaminer,
    appendEvent,
    enabled: true,
  })

  const runCalls = calls.filter((c) => c === 'run').length
  assert.equal(runCalls, 1, '(a) [M1] runExam was called exactly once')
  assert.equal(dispatchCount, 0, '(a) [M1] dispatchExaminer was called exactly zero times')
  assert.equal(rows.length, 1, '(a) [M1] appendEvent received exactly one row')
  assert.deepEqual(
    rows[0],
    { kind: 'exam:self-check', task: '1', attempt: 1, exit: 1, red: 'leg' },
    '(a) [M1] the one row is deep-equal to the exact literal the clause names'
  )
  assert.deepEqual(result.rows, rows, "(a) [M1] selfCheckExam's own { rows } answer matches what appendEvent received")
}

// ── b. [M2] two rig answers: one examiner round, in the exact order ────────
{
  const calls = []
  const rows = []
  const dispatchArgs = []
  const runExam = makeRunExam(calls, [
    { exit: 1, out: RIG_OUT_1 },
    { exit: 1, out: RIG_OUT_2 },
  ])
  const dispatchExaminer = async (arg) => {
    calls.push('dispatch')
    dispatchArgs.push(arg)
    return arg
  }
  const appendEvent = (row) => { calls.push('row'); rows.push(row) }

  const result = await selfCheckExam({
    task: '1',
    runExam,
    dispatchExaminer,
    appendEvent,
    enabled: true,
  })

  // calls[0] is the first runExam call that happens before any row can be
  // appended; drop it and read the rest of the order back.
  assert.equal(calls[0], 'run', '(b) [M2] the very first call recorded is the first runExam call')
  assert.deepEqual(
    calls.slice(1),
    ['row', 'dispatch', 'run', 'row'],
    '(b) [M2] after the first run, the order is exactly: row, dispatch, run, row'
  )

  assert.equal(dispatchArgs.length, 1, '(b) [M2] dispatchExaminer was called exactly once')
  const fact = dispatchArgs[0].fact
  assert.equal(typeof fact, 'string', "(b) [M2] dispatchExaminer's argument carries a fact string")
  const firstLine = fact.split('\n')[0]
  assert.equal(firstLine, 'EXAM RIG-RED', '(b) [M2] the fact\'s text up to the first newline is exactly EXAM RIG-RED')
  assert.ok(fact.includes('exit 1'), "(b) [M2] the fact contains the first run's exit")
  assert.ok(fact.includes(RIG_OUT_1), "(b) [M2] the fact contains the first run's out")

  const runCalls = calls.filter((c) => c === 'run').length
  assert.equal(runCalls, 2, '(b) [M2] runExam was called exactly twice in total')

  assert.equal(rows.length, 2, '(b) [M2] exactly two rows were appended in total')
  assert.equal(rows[0].attempt, 1, '(b) [M2] the first row carries attempt: 1')
  assert.equal(rows[0].red, 'rig', '(b) [M2] the first row carries red: rig')
  assert.equal(rows[1].attempt, 2, '(b) [M2] the second row carries attempt: 2')
  assert.equal(rows[1].red, 'rig', '(b) [M2] the second row carries red: rig, even on a second rig red')
  assert.deepEqual(result.rows, rows, "(b) [M2] selfCheckExam's own { rows } answer matches both rows, in order")
}

// ── c. [M3] a rig answer with enabled not true: no examiner round at all ───
{
  const calls = []
  const rows = []
  const runExam = makeRunExam(calls, [{ exit: 1, out: RIG_OUT_1 }])
  let dispatchCount = 0
  const dispatchExaminer = async (arg) => { dispatchCount += 1; calls.push('dispatch'); return arg }
  const appendEvent = (row) => { calls.push('row'); rows.push(row) }

  const result = await selfCheckExam({
    task: '1',
    runExam,
    dispatchExaminer,
    appendEvent,
    enabled: false,
  })

  const runCalls = calls.filter((c) => c === 'run').length
  assert.equal(runCalls, 1, '(c) [M3] runExam was called exactly once when enabled is not true')
  assert.equal(dispatchCount, 0, '(c) [M3] dispatchExaminer was called exactly zero times when enabled is not true')
  assert.equal(rows.length, 1, '(c) [M3] exactly one row was appended')
  assert.equal(rows[0].red, 'rig', '(c) [M3] that one row carries red: rig even though no examiner round ran')
  assert.equal(rows[0].attempt, 1, '(c) [M3] that one row carries attempt: 1')
  assert.deepEqual(result.rows, rows, "(c) [M3] selfCheckExam's own { rows } answer matches the one row")
}

console.log('ALL TESTS PASSED')
