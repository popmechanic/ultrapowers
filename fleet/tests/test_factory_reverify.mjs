/**
 * fleet/tests/test_factory_reverify.mjs — the exam for "A fold red says
 * which kind it was, and a rig red of the task's own exam re-attempts as
 * the examiner" (derived from #1245 desired states 2 and 3, #1206).
 *
 * The claim: after a fold, every red row `foldRound` appends says whether it
 * is a leg failure or a broken rig (`red: 'leg' | 'rig' | null`), and — only
 * when the plan's `rigToExam` switch is on — an own exam red whose rig
 * broke (`red: 'rig'`) is sent back to the examiner who wrote the exam
 * (`role: 'exam'`) instead of to the implementer, told so by a fact whose
 * first line is `FOLD EXAM-RIG`; every other route (leg reds, sibling reds,
 * the switch off) stays exactly as it is today.
 *
 * Legs, each naming the Machine clause it comes from:
 *
 *   (a) [M1] one rig-output own red, one leg-output own red and one check
 *       red, folded in a single round with `rigToExam: true`: the appended
 *       `fold:red` rows carry `red: 'rig'`, `red: 'leg'` and `red: null`
 *       respectively.
 *   (b) [M2] the rig-output own red alone, `rigToExam: true`: its row's
 *       `reattempt` deep-equals `{ role: 'exam', task: '1' }`, `reattempt`
 *       is called exactly once, with `role: 'exam'`, `task: '1'` and a
 *       `fact` whose text up to the first newline is exactly
 *       `FOLD EXAM-RIG`.
 *   (c) [M3] the leg-output own red alone, `rigToExam: true`: `reattempt`
 *       deep-equals `{ role: 'implement', task: '1' }` and the recorded
 *       call's `role` is `'implement'`; the rig-output own red alone with
 *       `rigToExam` omitted: its row still carries `red: 'rig'` but
 *       `reattempt` deep-equals `{ role: 'implement', task: '1' }`.
 *   (d) [M4] a rig-output red of sibling task `'2'` folded by `'1'`, with
 *       `rigToExam: true`, `enabled: true`, `runExamAt` answering `0` and
 *       `read` answering `null`: the row carries `cause: 'sibling'`,
 *       `red: 'rig'` and `reattempt` deep-equal to
 *       `{ role: 'implement', task: '2' }`.
 *
 * `foldRound` is pure, so this exam supplies every argument as its own
 * in-memory fake: `appendEvent` and `reattempt` record what they are handed
 * (`reattempt` also answers `true` so a round resolves without an
 * `unresolved` retry), `verify` answers a fixed `{ ran: [], reds: [] }`, and
 * `runExamAt`/`read` are only ever given real work in leg (d) — nothing
 * spawns, nothing touches a disk.
 */

import assert from 'node:assert/strict'

import { foldRound } from '../../factory/reverify.mjs'

const HUNKS = 'HUNKS TEXT'

// A red whose output names none of the exam's own assertions — no bracketed
// `[M<n>]` citation — the shape the task says `redKind` reads as `'rig'`.
const rigRed = (id) => ({
  kind: 'exam',
  id,
  exit: 1,
  out: 'TypeError: Cannot read properties of undefined (reading "red")'
})

// A red whose output carries a bracketed `[M1]` citation — the shape the
// task says `redKind` reads as `'leg'`.
const legRed = (id) => ({
  kind: 'exam',
  id,
  exit: 1,
  out: 'AssertionError [ERR_ASSERTION]: (a) [M1] the row is missing'
})

const checkRed = { kind: 'check', cmd: 'true', exit: 1, out: '' }

// A fake `reattempt`/`verify`/`appendEvent`/`runExamAt`/`read` set. Every
// call is recorded so a leg can assert on exactly what `foldRound` sent.
function makeFakes ({ runExamAtAnswer, readAnswer } = {}) {
  const rows = []
  const reattemptCalls = []
  return {
    rows,
    reattemptCalls,
    appendEvent: (row) => { rows.push(row) },
    reattempt: async (action) => { reattemptCalls.push(action); return true },
    verify: async () => ({ ran: [], reds: [] }),
    runExamAt: async () => {
      if (runExamAtAnswer === undefined) throw new Error('runExamAt not expected to be called')
      return runExamAtAnswer
    },
    read: async () => {
      if (readAnswer === undefined) throw new Error('read not expected to be called')
      return readAnswer
    }
  }
}

// ── a. [M1] the red cell on fold:red rows: 'rig' | 'leg' | null ───────────
{
  const fakes = makeFakes()
  const reds = [rigRed('1'), legRed('1'), checkRed]

  await foldRound({
    reds,
    folded: '1',
    headBefore: 'before',
    head: 'after',
    enabled: true,
    hunks: HUNKS,
    runExamAt: fakes.runExamAt,
    read: fakes.read,
    appendEvent: fakes.appendEvent,
    reattempt: fakes.reattempt,
    verify: fakes.verify,
    rigToExam: true
  })

  const foldRedRows = fakes.rows.filter((r) => r.kind === 'fold:red' || r.kind === 'fold:exam-defect')
  assert.equal(foldRedRows.length, 3, '(a) [M1] one fold:red row per red handed in')

  assert.equal(
    foldRedRows[0].red, 'rig',
    "(a) [M1] the rig-output own red's row carries red: 'rig' (redKind of its exit/out)"
  )
  assert.equal(
    foldRedRows[1].red, 'leg',
    "(a) [M1] the leg-output own red's row carries red: 'leg' (redKind of its exit/out)"
  )
  assert.equal(
    foldRedRows[2].red, null,
    "(a) [M1] the check red's row carries red: null"
  )
}

// ── b. [M2] a rig-red own exam re-attempts to its own examiner ────────────
{
  const fakes = makeFakes()
  const reds = [rigRed('1')]

  await foldRound({
    reds,
    folded: '1',
    headBefore: 'before',
    head: 'after',
    enabled: true,
    hunks: HUNKS,
    runExamAt: fakes.runExamAt,
    read: fakes.read,
    appendEvent: fakes.appendEvent,
    reattempt: fakes.reattempt,
    verify: fakes.verify,
    rigToExam: true
  })

  const row = fakes.rows.find((r) => r.kind === 'fold:red' || r.kind === 'fold:exam-defect')
  assert.deepEqual(
    row.reattempt, { role: 'exam', task: '1' },
    "(b) [M2] the rig-output own red's row reattempt is { role: 'exam', task: folded }"
  )

  assert.equal(
    fakes.reattemptCalls.length, 1,
    '(b) [M2] reattempt is called exactly once for the single rig-output own red'
  )
  assert.equal(fakes.reattemptCalls[0].role, 'exam', "(b) [M2] the reattempt call carries role: 'exam'")
  assert.equal(fakes.reattemptCalls[0].task, '1', "(b) [M2] the reattempt call carries task: '1' (folded)")
  assert.equal(
    fakes.reattemptCalls[0].fact.split('\n')[0], 'FOLD EXAM-RIG',
    "(b) [M2] the reattempt call's fact reads FOLD EXAM-RIG up to its first newline"
  )
}

// ── c. [M3] a leg-red own exam still re-attempts as the implementer, and
//      the rig route only fires when rigToExam is true ────────────────────
{
  const fakesLeg = makeFakes()
  await foldRound({
    reds: [legRed('1')],
    folded: '1',
    headBefore: 'before',
    head: 'after',
    enabled: true,
    hunks: HUNKS,
    runExamAt: fakesLeg.runExamAt,
    read: fakesLeg.read,
    appendEvent: fakesLeg.appendEvent,
    reattempt: fakesLeg.reattempt,
    verify: fakesLeg.verify,
    rigToExam: true
  })

  const legRow = fakesLeg.rows.find((r) => r.kind === 'fold:red' || r.kind === 'fold:exam-defect')
  assert.deepEqual(
    legRow.reattempt, { role: 'implement', task: '1' },
    "(c) [M3] the leg-output own red's row reattempt stays { role: 'implement', task: folded }"
  )
  assert.equal(
    fakesLeg.reattemptCalls[0].role, 'implement',
    "(c) [M3] the recorded reattempt call's role is 'implement' for a leg red even with rigToExam: true"
  )

  const fakesOff = makeFakes()
  await foldRound({
    reds: [rigRed('1')],
    folded: '1',
    headBefore: 'before',
    head: 'after',
    enabled: true,
    hunks: HUNKS,
    runExamAt: fakesOff.runExamAt,
    read: fakesOff.read,
    appendEvent: fakesOff.appendEvent,
    reattempt: fakesOff.reattempt,
    verify: fakesOff.verify
    // rigToExam omitted
  })

  const offRow = fakesOff.rows.find((r) => r.kind === 'fold:red' || r.kind === 'fold:exam-defect')
  assert.equal(
    offRow.red, 'rig',
    "(c) [M3] with rigToExam omitted the rig-output own red's row still carries red: 'rig'"
  )
  assert.deepEqual(
    offRow.reattempt, { role: 'implement', task: '1' },
    "(c) [M3] ...but with rigToExam omitted it is still appended with reattempt: { role: 'implement', task: folded }"
  )
}

// ── d. [M4] a sibling red is routed exactly as today, whatever its red cell
{
  const fakes = makeFakes({ runExamAtAnswer: 0, readAnswer: null })

  await foldRound({
    reds: [rigRed('2')],
    folded: '1',
    headBefore: 'before',
    head: 'after',
    enabled: true,
    hunks: HUNKS,
    runExamAt: fakes.runExamAt,
    read: fakes.read,
    appendEvent: fakes.appendEvent,
    reattempt: fakes.reattempt,
    verify: fakes.verify,
    rigToExam: true
  })

  const row = fakes.rows.find((r) => r.kind === 'fold:red' || r.kind === 'fold:exam-defect')
  assert.equal(row.cause, 'sibling', "(d) [M4] a red of another task's exam is attributed cause: 'sibling'")
  assert.equal(row.red, 'rig', "(d) [M4] the sibling red's row still carries its own redKind: 'rig'")
  assert.deepEqual(
    row.reattempt, { role: 'implement', task: '2' },
    "(d) [M4] a sibling red with a null readFoldRed answer re-attempts { role: 'implement', task: sibling } as today"
  )
}

console.log('ALL TESTS PASSED')
