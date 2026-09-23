/**
 * fleet/tests/test_factory_reverify.mjs — the exam for "The examiner leaves
 * the engine and the facts stay".
 *
 * The claim: `factory/reverify.mjs`'s `proofsTouched` names which already
 * adopted tasks a fold's own touched paths put back in play — the folded
 * task itself first, then the rest of `adopted` in their own order, filtered
 * to a task that shares a touched path AND has something to run (its own
 * `proofRuns` or a non-empty `selected[task.id]`), capped at `cap`. And
 * `foldRound` attributes each red the fold check found to its owner and
 * cause (`own` | `sibling` | `check`), reads `green_before` for a sibling red
 * only when `enabled`, collapses every red down to one `{ role: 'implement',
 * task }` re-attempt per task (a check red's owner is the folded task
 * itself), runs that round once, and — everyone re-attempted successfully —
 * calls `verify()` and reports what is still red.
 *
 * Legs:
 *
 *   (a) `proofsTouched`: the folded task always comes first when it
 *       qualifies; the rest of `adopted`, in adoption order, filtered to a
 *       task that both shares a touched path and has a non-empty `proofRuns`
 *       or a non-empty `selected[task.id]`; capped at `cap`.
 *   (b) `foldRound` attribution: a probe/test red whose id is the folded
 *       task is `cause: 'own'`; a probe/test red of another task is
 *       `cause: 'sibling'`; a check red is `cause: 'check'`, `owner: null`;
 *       every `fold:red` row carries exactly one of `probe`/`test`/`cmd`
 *       non-null, matching the red's own kind.
 *   (c) `green_before`: read via `runProofsAt(red.id, headBefore)` only for
 *       a sibling red and only when `enabled` is `true` — never for an own
 *       or a check red, never when `enabled` is not `true`.
 *   (d) reattempt collapsing: two reds that land on the same task (whether
 *       both own, or a check red alongside an own red) produce exactly one
 *       `reattempt` call for that task, always `{ role: 'implement', task }`,
 *       and its `fact` carries every one of that task's own assertions.
 *   (e) an unsuccessful reattempt appends `fold:unresolved` for every red
 *       handed in and answers `{ unresolved: true }` without ever calling
 *       `verify`.
 *   (f) a successful round calls `verify()`, appends `fold:verify` with
 *       `attempt: 2` and its own `ran`, appends `fold:unresolved` for
 *       whatever `verify()` still reports red, and answers
 *       `unresolved: <verify's reds is non-empty>`; a `verify()` that throws
 *       or answers nothing is the same `unresolved: true` an unsuccessful
 *       reattempt gives, over the ORIGINAL reds.
 *
 * `proofsTouched` and `foldRound` are pure, so this exam supplies every
 * argument as its own in-memory fake — nothing spawns, nothing touches disk.
 */

import assert from 'node:assert/strict'

import { proofsTouched, foldRound } from '../../factory/reverify.mjs'

const HUNKS = 'HUNKS TEXT'

const probeRed = (id) => ({ kind: 'probe', id, exit: 1, out: 'probe ' + id + ' failed' })
const testRed = (id, testPath) => ({ kind: 'test', id, path: testPath, exit: 1, out: 'test ' + testPath + ' failed' })
const checkRed = { kind: 'check', cmd: 'true', exit: 1, out: 'check failed' }

/** A fake `reattempt`/`verify`/`appendEvent`/`runProofsAt` set. Every call is
 *  recorded so a leg can assert on exactly what `foldRound` sent. */
function makeFakes ({ runProofsAtAnswer, reattemptAnswer = true, verifyAnswer = { ran: [], reds: [] } } = {}) {
  const rows = []
  const reattemptCalls = []
  const runProofsAtCalls = []
  return {
    rows,
    reattemptCalls,
    runProofsAtCalls,
    appendEvent: (row) => { rows.push(row) },
    reattempt: async (action) => { reattemptCalls.push(action); return reattemptAnswer },
    verify: async () => {
      if (verifyAnswer instanceof Error) throw verifyAnswer
      return verifyAnswer
    },
    runProofsAt: async (id, sha) => {
      runProofsAtCalls.push({ id, sha })
      if (runProofsAtAnswer === undefined) throw new Error('runProofsAt not expected to be called')
      return runProofsAtAnswer
    },
  }
}

// ── a. proofsTouched: folded first, adoption order, qualifies, capped ─────
{
  const tasks = [
    { id: '1', files: ['a.mjs'], proofRuns: ['node a.mjs'] },
    { id: '2', files: ['b.mjs'], proofRuns: [] },
    { id: '3', files: ['c.mjs'], proofRuns: ['node c.mjs'] },
    { id: '4', files: ['a.mjs'], proofRuns: [] },
  ]
  const selected = { 2: ['tests/test_b.mjs'] }
  const touched = ['a.mjs', 'b.mjs']

  const result = proofsTouched({
    folded: '1', touched, adopted: ['4', '2', '3', '1'], tasks, selected, cap: 10,
  })
  assert.deepEqual(
    result.map((t) => t.id), ['1', '2'],
    'the folded task comes first, then the rest of adopted in adoption order, filtered to a task that shares a touched path and qualifies'
  )
  // task 3 does not share a.mjs/b.mjs -> excluded; task 4 shares a.mjs but
  // has empty proofRuns and no selected entry of its own -> excluded too.
  assert.ok(!result.some((t) => t.id === '4'), 'a task that shares a touched path but has no proofRuns and no selected tests does not qualify')
  assert.ok(!result.some((t) => t.id === '3'), 'a task that qualifies but shares no touched path is excluded')

  const capped = proofsTouched({
    folded: '1', touched, adopted: ['2', '1'], tasks, selected, cap: 1,
  })
  assert.deepEqual(capped.map((t) => t.id), ['1'], 'the result is capped at `cap` entries overall')

  const noFolded = proofsTouched({
    folded: '9', touched: ['zzz.mjs'], adopted: ['1', '2'], tasks, selected, cap: 10,
  })
  assert.deepEqual(noFolded, [], 'a folded id with no matching task and no adopted task touching the path answers []')
}

// ── b. foldRound attribution: own / sibling / check, and the probe/test/cmd
//      cell shape ──────────────────────────────────────────────────────────
{
  const fakes = makeFakes()
  const reds = [probeRed('1'), testRed('2', 'tests/test_b.mjs'), checkRed]

  const outcome = await foldRound({
    reds, folded: '1', headBefore: 'before', head: 'after',
    enabled: true, hunks: HUNKS,
    runProofsAt: fakes.runProofsAt, appendEvent: fakes.appendEvent,
    reattempt: fakes.reattempt, verify: fakes.verify,
  })

  const foldRedRows = fakes.rows.filter((r) => r.kind === 'fold:red')
  assert.equal(foldRedRows.length, 3, 'one fold:red row per red handed in')

  assert.equal(foldRedRows[0].cause, 'own', "the folded task's own probe red is cause: 'own'")
  assert.equal(foldRedRows[0].owner, '1', "its owner is the folded task's own id")
  assert.deepEqual(
    { probe: foldRedRows[0].probe, test: foldRedRows[0].test, cmd: foldRedRows[0].cmd },
    { probe: '1', test: null, cmd: null },
    'a probe red carries its id under probe, test and cmd null'
  )

  assert.equal(foldRedRows[1].cause, 'sibling', "another task's test red is cause: 'sibling'")
  assert.equal(foldRedRows[1].owner, '2', 'its owner is the sibling task id')
  assert.deepEqual(
    { probe: foldRedRows[1].probe, test: foldRedRows[1].test, cmd: foldRedRows[1].cmd },
    { probe: null, test: 'tests/test_b.mjs', cmd: null },
    'a test red carries its path under test, probe and cmd null'
  )

  assert.equal(foldRedRows[2].cause, 'check', "a check red is cause: 'check'")
  assert.equal(foldRedRows[2].owner, null, "a check red's owner is null")
  assert.deepEqual(
    { probe: foldRedRows[2].probe, test: foldRedRows[2].test, cmd: foldRedRows[2].cmd },
    { probe: null, test: null, cmd: 'true' },
    'a check red carries its cmd under cmd, probe and test null'
  )

  assert.equal(outcome.unresolved, false, 'every reattempt succeeded and verify answered no reds -> resolved')
}

// ── c. green_before: only for a sibling red, only when enabled ────────────
{
  const fakesGreen = makeFakes({ runProofsAtAnswer: 0 })
  await foldRound({
    reds: [probeRed('1'), probeRed('2'), checkRed],
    folded: '1', headBefore: 'before', head: 'after',
    enabled: true, hunks: HUNKS,
    runProofsAt: fakesGreen.runProofsAt, appendEvent: fakesGreen.appendEvent,
    reattempt: fakesGreen.reattempt, verify: fakesGreen.verify,
  })
  assert.equal(fakesGreen.runProofsAtCalls.length, 1, 'runProofsAt is called exactly once, for the one sibling red')
  assert.deepEqual(fakesGreen.runProofsAtCalls[0], { id: '2', sha: 'before' }, 'runProofsAt is called with (red.id, headBefore)')
  const rows = fakesGreen.rows.filter((r) => r.kind === 'fold:red')
  assert.equal(rows.find((r) => r.owner === '1').green_before, null, "an own red's green_before is null")
  assert.equal(rows.find((r) => r.owner === '2').green_before, true, "the sibling red's green_before is true when runProofsAt answers 0")
  assert.equal(rows.find((r) => r.cause === 'check').green_before, null, "a check red's green_before is null")

  const fakesRed = makeFakes({ runProofsAtAnswer: 1 })
  await foldRound({
    reds: [probeRed('2')], folded: '1', headBefore: 'before', head: 'after',
    enabled: true, hunks: HUNKS,
    runProofsAt: fakesRed.runProofsAt, appendEvent: fakesRed.appendEvent,
    reattempt: fakesRed.reattempt, verify: fakesRed.verify,
  })
  assert.equal(
    fakesRed.rows.find((r) => r.kind === 'fold:red').green_before, false,
    "the sibling red's green_before is false when runProofsAt answers non-zero"
  )

  const fakesOff = makeFakes()
  await foldRound({
    reds: [probeRed('2')], folded: '1', headBefore: 'before', head: 'after',
    enabled: false, hunks: HUNKS,
    runProofsAt: fakesOff.runProofsAt, appendEvent: fakesOff.appendEvent,
    reattempt: fakesOff.reattempt, verify: fakesOff.verify,
  })
  assert.equal(fakesOff.runProofsAtCalls.length, 0, 'runProofsAt is never called when enabled is not true')
  assert.equal(
    fakesOff.rows.find((r) => r.kind === 'fold:red').green_before, null,
    "the sibling red's green_before is null when enabled is not true"
  )
}

// ── d. reattempt collapsing: one call per task, always role implement ─────
{
  const fakes = makeFakes()
  await foldRound({
    reds: [probeRed('1'), testRed('1', 'tests/test_a.mjs'), checkRed],
    folded: '1', headBefore: 'before', head: 'after',
    enabled: true, hunks: HUNKS,
    runProofsAt: fakes.runProofsAt, appendEvent: fakes.appendEvent,
    reattempt: fakes.reattempt, verify: fakes.verify,
  })
  assert.equal(fakes.reattemptCalls.length, 1, 'two own reds and a check red (whose owner is the folded task) collapse to one reattempt call')
  assert.deepEqual(fakes.reattemptCalls[0], { role: 'implement', task: '1', fact: fakes.reattemptCalls[0].fact }, 'the single call is { role: implement, task: folded }')
  assert.ok(fakes.reattemptCalls[0].fact.includes('probe 1 failed'), "the fact carries the probe red's own assertion")
  assert.ok(fakes.reattemptCalls[0].fact.includes('test tests/test_a.mjs failed'), "the fact carries the test red's own assertion")
  assert.ok(fakes.reattemptCalls[0].fact.includes('check failed'), "the fact carries the check red's own assertion")
  assert.ok(fakes.reattemptCalls[0].fact.includes(HUNKS), 'the fact carries the fold hunks')

  const fakesSibling = makeFakes({ runProofsAtAnswer: 0 })
  await foldRound({
    reds: [probeRed('1'), probeRed('2')],
    folded: '1', headBefore: 'before', head: 'after',
    enabled: true, hunks: HUNKS,
    runProofsAt: fakesSibling.runProofsAt, appendEvent: fakesSibling.appendEvent,
    reattempt: fakesSibling.reattempt, verify: fakesSibling.verify,
  })
  assert.equal(fakesSibling.reattemptCalls.length, 2, 'an own red and a sibling red are two separate tasks -> two reattempt calls')
  assert.deepEqual(
    fakesSibling.reattemptCalls.map((c) => c.task).sort(), ['1', '2'],
    'one reattempt call per distinct task'
  )
  for (const call of fakesSibling.reattemptCalls) assert.equal(call.role, 'implement', 'every reattempt call is role: implement')
}

// ── e. an unsuccessful reattempt: fold:unresolved for every red, no verify ─
{
  const fakes = makeFakes({ reattemptAnswer: false })
  let verifyCalled = false
  const outcome = await foldRound({
    reds: [probeRed('1'), testRed('2', 'tests/test_b.mjs')],
    folded: '1', headBefore: 'before', head: 'after',
    enabled: true, hunks: HUNKS,
    runProofsAt: fakes.runProofsAt, appendEvent: fakes.appendEvent,
    reattempt: fakes.reattempt,
    verify: async () => { verifyCalled = true; return { ran: [], reds: [] } },
  })
  assert.equal(outcome.unresolved, true, 'an unsuccessful reattempt answers unresolved: true')
  assert.equal(verifyCalled, false, 'verify is never called after an unsuccessful reattempt')
  const unresolvedRows = fakes.rows.filter((r) => r.kind === 'fold:unresolved')
  assert.equal(unresolvedRows.length, 2, 'fold:unresolved is appended for every red handed in')
}

// ── f. a successful round calls verify, reports remaining reds ────────────
{
  const fakes = makeFakes({ verifyAnswer: { ran: [{ id: '1', kind: 'probe', exit: 0 }], reds: [] } })
  const outcome = await foldRound({
    reds: [probeRed('1')], folded: '1', headBefore: 'before', head: 'after',
    enabled: true, hunks: HUNKS,
    runProofsAt: fakes.runProofsAt, appendEvent: fakes.appendEvent,
    reattempt: fakes.reattempt, verify: fakes.verify,
  })
  assert.equal(outcome.unresolved, false, 'a clean verify answers unresolved: false')
  const verifyRow = fakes.rows.find((r) => r.kind === 'fold:verify')
  assert.ok(verifyRow, 'a fold:verify row is appended')
  assert.equal(verifyRow.attempt, 2, "the fold:verify row's attempt is 2")
  assert.deepEqual(verifyRow.ran, [{ id: '1', kind: 'probe', exit: 0 }], "the fold:verify row's ran is verify()'s own ran")

  const stillRed = probeRed('1')
  const fakesStillRed = makeFakes({ verifyAnswer: { ran: [], reds: [stillRed] } })
  const outcomeStillRed = await foldRound({
    reds: [probeRed('1')], folded: '1', headBefore: 'before', head: 'after',
    enabled: true, hunks: HUNKS,
    runProofsAt: fakesStillRed.runProofsAt, appendEvent: fakesStillRed.appendEvent,
    reattempt: fakesStillRed.reattempt, verify: fakesStillRed.verify,
  })
  assert.equal(outcomeStillRed.unresolved, true, 'a verify that still reports reds answers unresolved: true')
  assert.equal(
    fakesStillRed.rows.filter((r) => r.kind === 'fold:unresolved').length, 1,
    "fold:unresolved is appended for verify()'s own remaining reds"
  )

  const fakesThrows = makeFakes({ verifyAnswer: new Error('verify: boom') })
  const outcomeThrows = await foldRound({
    reds: [probeRed('1'), probeRed('2')], folded: '1', headBefore: 'before', head: 'after',
    enabled: true, hunks: HUNKS,
    runProofsAt: fakesThrows.runProofsAt, appendEvent: fakesThrows.appendEvent,
    reattempt: fakesThrows.reattempt, verify: fakesThrows.verify,
  })
  assert.equal(outcomeThrows.unresolved, true, 'a throwing verify answers unresolved: true, the same as an unsuccessful reattempt')
  assert.equal(
    fakesThrows.rows.filter((r) => r.kind === 'fold:unresolved').length, 2,
    'a throwing verify appends fold:unresolved for every ORIGINAL red, not none'
  )
  assert.ok(
    !fakesThrows.rows.some((r) => r.kind === 'fold:verify'),
    'a throwing verify never appends a fold:verify row'
  )
}

console.log('ALL TESTS PASSED')
