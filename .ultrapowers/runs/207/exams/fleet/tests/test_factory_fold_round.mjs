/**
 * fleet/tests/test_factory_fold_round.mjs — the exam for "A fold's reds go
 * through one round — attributed, judged once, re-attempted by the right
 * worker, verified once more" (derived from #1164, run-196, run-195).
 *
 * `factory/reverify.mjs` exports `foldRound`, a pure function: everything it
 * touches — the reds, the fold's identity, the clone hashes, `hunks`, and the
 * five callbacks `runExamAt`, `read`, `appendEvent`, `reattempt`, `verify` —
 * arrives as an argument, so this exam drives it with recording fakes and
 * never clones, spawns a process, or touches `factory/engine.mjs`. It imports
 * only `../../factory/reverify.mjs`.
 *
 * The Machine clauses under test, restated:
 *   M1 — one appended row per red, carrying its attribution (`task`, `fold`,
 *        `head_before`, `head`, `exit`, `exam`, `cmd`, `owner`, `cause`,
 *        `green_before`) and a first-cut `reattempt`; `runExamAt` is called
 *        only for a sibling exam red, to read `green_before`.
 *   M2 — a sibling red whose exam was green before the fold is the only case
 *        `read('readFoldRed', ...)` is asked about; an `examDefect: true`
 *        answer turns the row into `fold:exam-defect` with `reattempt: {role:
 *        'exam', task: owner}`; anything else keeps it `fold:red` with
 *        `reattempt: {role: 'implement', task: owner}`; an own red, a check
 *        red, or a sibling red that was not green before never calls `read`.
 *   M3 — `actions` collapses the rows' `reattempt`s to one per distinct
 *        (role, task), each carrying a `fact` built from the assertions and
 *        `hunks` behind it, prefixed by kind.
 *   M4 — the round attempts each action once; only if every `reattempt`
 *        resolves `true` does it call `verify()` once and read its answer
 *        into `fold:verify` (attempt 2) and `fold:unresolved` rows; any other
 *        outcome (a false, a rejection) stops the round with one
 *        `fold:unresolved` row per red and no `verify` call; `foldRound`
 *        itself never rejects.
 *   M5 — `enabled` not exactly `true` short-circuits M1/M2 entirely: every
 *        red is folded into one `fold:red` / `{role: 'implement', task:
 *        folded}` row, with `runExamAt` and `read` untouched, and M4 still
 *        governs the single resulting action.
 *
 * Legs, each naming the Machine clause(s) it comes from:
 *   (a) [M1][M2][M3] a sibling exam red whose exam was green before the fold
 *       and whose judge calls it an exam defect.
 *   (b) [M2][M3] the same red judged NOT a defect (or the judge call
 *       rejecting) — falls back to `fold:red` / `implement`.
 *   (c) [M1] an own exam red plus a check red, together, with no judging.
 *   (d) [M1][M2] a sibling red whose exam was NOT green before the fold
 *       (`false`, or `runExamAt` rejecting) — never judged.
 *   (e) [M4] the one-round shape: verify only after every reattempt is
 *       `true`, `fold:unresolved` on a lingering red, and a short-circuit the
 *       moment one action's reattempt is not `true` (or rejects).
 *   (f) [M5] `enabled: false` collapses everything to one action, untouched
 *       `runExamAt`/`read`, with M4 still holding.
 *
 * Assumptions this exam makes about `foldRound`, beyond the Machine text:
 *   - `appendEvent` is called once per row, in the order the rows are
 *     produced (per-red rows first, in `reds` order, then the M4 rows), and
 *     each call's sole argument is the row object.
 *   - `read` is called as `read('readFoldRed', { assertion, hunks, who })`
 *     — a two-argument call, name then payload.
 *   - `runExamAt` is called as `runExamAt(id, headBefore)`.
 *   - `reattempt` is called with the action object itself; `verify` is
 *     called with no meaningful argument this exam depends on.
 *   - a "call" is recorded as the array of arguments the fake received, so
 *     `fn.calls[i]` is that call's `arguments` array.
 */

import assert from 'node:assert/strict'

import { foldRound } from '../../factory/reverify.mjs'

// ── Recording fakes ─────────────────────────────────────────────────────────

class Rejected {
  constructor (err) { this.err = err }
}
const rejects = (message) => new Rejected(new Error(message))

/**
 * `behavior` is either a plain value every call resolves to, or a function
 * of the call's arguments returning a value (or a `Rejected`). Every call's
 * argument list is pushed to `.calls` before the behavior runs.
 */
function fake (behavior) {
  const calls = []
  const fn = async (...args) => {
    calls.push(args)
    const outcome = typeof behavior === 'function' ? behavior(...args) : behavior
    if (outcome instanceof Rejected) throw outcome.err
    return outcome
  }
  fn.calls = calls
  return fn
}

const rowsOf = (appendEvent) => appendEvent.calls.map((c) => c[0])

// ── Fixtures shared across legs ──────────────────────────────────────────────

const OUT_A = 'AssertionError: expected ["kind","task"], got ["kind","task","ts"]'
const HUNKS_A = '@@ -1 +1 @@ +  ts: now()'
const RED_A = { kind: 'exam', id: '2', exit: 1, out: OUT_A }

const VERIFY_CLEAN = { ran: [{ task: '3', exit: 0 }, { task: '2', exit: 0 }], reds: [] }

/** The base `foldRound` argument set legs (a), (b), (e), (f) share. */
const baseArgs = (overrides = {}) => ({
  reds: [RED_A],
  folded: '3',
  headBefore: 'aaa',
  head: 'bbb',
  enabled: true,
  hunks: HUNKS_A,
  ...overrides
})

// ══════════════════════════════════════════════════════════════════════════
// (a) [M1][M2][M3] sibling exam red, green before, judged an exam defect
// ══════════════════════════════════════════════════════════════════════════
{
  const runExamAt = fake(0)
  const read = fake({ examDefect: true, score: 0.9 })
  const appendEvent = fake(undefined)
  const reattempt = fake(true)
  const verify = fake(VERIFY_CLEAN)

  const result = await foldRound({
    ...baseArgs(),
    runExamAt, read, appendEvent, reattempt, verify
  })

  assert.deepEqual(runExamAt.calls, [['2', 'aaa']],
    `(a) [M1] runExamAt is called once, with (id, headBefore). Got: ${JSON.stringify(runExamAt.calls)}`)

  assert.equal(read.calls.length, 1,
    `(a) [M2] read is called exactly once. Got ${read.calls.length} call(s).`)
  assert.equal(read.calls[0][0], 'readFoldRed',
    `(a) [M2] read is called with the name 'readFoldRed'. Got: ${JSON.stringify(read.calls[0][0])}`)
  const readArg = read.calls[0][1]
  assert.equal(readArg.assertion, OUT_A,
    `(a) [M2] read's argument carries the red's out as \`assertion\`. Got: ${JSON.stringify(readArg.assertion)}`)
  assert.equal(readArg.hunks, HUNKS_A,
    `(a) [M2] read's argument carries \`hunks\` verbatim. Got: ${JSON.stringify(readArg.hunks)}`)
  assert.deepEqual(readArg.who, { task: '2', label: 'fold:3' },
    `(a) [M2] read's argument carries \`who: {task: owner, label: 'fold:' + folded}\`. Got: ${JSON.stringify(readArg.who)}`)

  const rows = rowsOf(appendEvent)
  const row0 = rows[0]
  assert.equal(row0.kind, 'fold:exam-defect',
    `(a) [M2] the row's kind is 'fold:exam-defect'. Got: ${JSON.stringify(row0.kind)}`)
  assert.equal(row0.task, '3', `(a) [M1] row.task is 'folded'. Got: ${JSON.stringify(row0.task)}`)
  assert.equal(row0.fold, '3', `(a) [M1] row.fold is 'folded'. Got: ${JSON.stringify(row0.fold)}`)
  assert.equal(row0.head_before, 'aaa', `(a) [M1] row.head_before is headBefore. Got: ${JSON.stringify(row0.head_before)}`)
  assert.equal(row0.head, 'bbb', `(a) [M1] row.head is head. Got: ${JSON.stringify(row0.head)}`)
  assert.equal(row0.exam, '2', `(a) [M1] row.exam is the exam id. Got: ${JSON.stringify(row0.exam)}`)
  assert.equal(row0.cmd, null, `(a) [M1] an exam red carries cmd: null. Got: ${JSON.stringify(row0.cmd)}`)
  assert.equal(row0.owner, '2', `(a) [M1] a sibling red's owner is the exam id. Got: ${JSON.stringify(row0.owner)}`)
  assert.equal(row0.cause, 'sibling', `(a) [M1] a sibling red's cause is 'sibling'. Got: ${JSON.stringify(row0.cause)}`)
  assert.equal(row0.green_before, true, `(a) [M1] green_before is true when runExamAt resolves 0. Got: ${JSON.stringify(row0.green_before)}`)
  assert.equal(row0.exit, 1, `(a) [M1] row.exit carries the red's exit. Got: ${JSON.stringify(row0.exit)}`)
  assert.equal(row0.score, 0.9, `(a) [M2] a fold:exam-defect row carries the answer's score. Got: ${JSON.stringify(row0.score)}`)
  assert.deepEqual(row0.reattempt, { role: 'exam', task: '2' },
    `(a) [M2] row.reattempt is {role: 'exam', task: owner}. Got: ${JSON.stringify(row0.reattempt)}`)

  assert.ok(!rows.some((r) => r.kind === 'fold:red'),
    `(a) [M2] no appended row has kind 'fold:red'. Got kinds: ${JSON.stringify(rows.map((r) => r.kind))}`)

  assert.equal(result.actions.length, 1,
    `(a) [M3] actions collapses to one entry. Got: ${JSON.stringify(result.actions)}`)
  const action0 = result.actions[0]
  assert.equal(action0.role, 'exam', `(a) [M3] the action's role is 'exam'. Got: ${JSON.stringify(action0.role)}`)
  assert.equal(action0.task, '2', `(a) [M3] the action's task is the owner. Got: ${JSON.stringify(action0.task)}`)
  assert.ok(action0.fact.startsWith('FOLD EXAM-DEFECT'),
    `(a) [M3] the exam-role action's fact starts with 'FOLD EXAM-DEFECT'. Got: ${JSON.stringify(action0.fact.slice(0, 40))}`)
  assert.ok(action0.fact.includes('carries these keys'),
    `(a) [M3] the fact contains 'carries these keys'. Got: ${JSON.stringify(action0.fact)}`)
  assert.ok(action0.fact.includes(OUT_A),
    `(a) [M3] the fact contains the red's assertion. Got: ${JSON.stringify(action0.fact)}`)
  assert.ok(action0.fact.includes(HUNKS_A),
    `(a) [M3] the fact contains hunks. Got: ${JSON.stringify(action0.fact)}`)

  // The 2000-character cap on the assertion handed to `read`.
  const longOut = 'x'.repeat(1000) + 'y'.repeat(2000)
  assert.equal(longOut.length, 3000)
  const read2 = fake({ examDefect: false, score: 0 })
  await foldRound({
    ...baseArgs({ reds: [{ kind: 'exam', id: '2', exit: 1, out: longOut }] }),
    runExamAt: fake(0), read: read2, appendEvent: fake(undefined), reattempt: fake(true), verify: fake(VERIFY_CLEAN)
  })
  assert.equal(read2.calls.length, 1, '(a) [M2] read is called once for the long-out case too.')
  assert.equal(read2.calls[0][1].assertion, longOut.slice(-2000),
    `(a) [M2] the assertion handed to read is the last 2000 characters of a 3000-character out. ` +
    `Got length ${read2.calls[0][1].assertion.length}.`)
}

// ══════════════════════════════════════════════════════════════════════════
// (b) [M2][M3] same sibling red, judged NOT a defect, and a read that rejects
// ══════════════════════════════════════════════════════════════════════════
{
  const run = async (readBehavior) => {
    const appendEvent = fake(undefined)
    const reattempt = fake(true)
    const result = await foldRound({
      ...baseArgs(),
      runExamAt: fake(0), read: fake(readBehavior), appendEvent, reattempt, verify: fake(VERIFY_CLEAN)
    })
    return { rows: rowsOf(appendEvent), result }
  }

  const notDefect = await run({ examDefect: false, score: 0.3 })
  assert.equal(notDefect.rows[0].kind, 'fold:red',
    `(b) [M2] a non-defect answer keeps the row 'fold:red'. Got: ${JSON.stringify(notDefect.rows[0].kind)}`)
  assert.deepEqual(notDefect.rows[0].reattempt, { role: 'implement', task: '2' },
    `(b) [M2] its reattempt is {role: 'implement', task: owner}. Got: ${JSON.stringify(notDefect.rows[0].reattempt)}`)
  assert.equal(notDefect.result.actions.length, 1)
  assert.ok(notDefect.result.actions[0].fact.startsWith('FOLD RED'),
    `(b) [M3] the implement-role action's fact starts with 'FOLD RED'. Got: ${JSON.stringify(notDefect.result.actions[0].fact.slice(0, 20))}`)
  assert.ok(notDefect.result.actions[0].fact.includes(HUNKS_A),
    `(b) [M3] the fact contains hunks. Got: ${JSON.stringify(notDefect.result.actions[0].fact)}`)

  const readRejects = await run(rejects('judge unavailable'))
  assert.equal(readRejects.rows[0].kind, 'fold:red',
    `(b) [M2] a rejecting read also keeps the row 'fold:red'. Got: ${JSON.stringify(readRejects.rows[0].kind)}`)
  assert.deepEqual(readRejects.rows[0].reattempt, { role: 'implement', task: '2' },
    `(b) [M2] a rejecting read still reattempts implement/owner. Got: ${JSON.stringify(readRejects.rows[0].reattempt)}`)
}

// ══════════════════════════════════════════════════════════════════════════
// (c) [M1] an own exam red and a check red together — no judging at all
// ══════════════════════════════════════════════════════════════════════════
{
  const ownRed = { kind: 'exam', id: '3', exit: 1, out: 'x' }
  const checkRed = { kind: 'check', cmd: 'git diff --quiet', exit: 1, out: 'y' }
  const runExamAt = fake(0)
  const read = fake({ examDefect: true, score: 1 })
  const appendEvent = fake(undefined)
  const reattempt = fake(true)
  const verify = fake(VERIFY_CLEAN)

  const result = await foldRound({
    ...baseArgs({ reds: [ownRed, checkRed] }),
    runExamAt, read, appendEvent, reattempt, verify
  })

  assert.equal(runExamAt.calls.length, 0, `(c) [M1] runExamAt is called zero times. Got ${runExamAt.calls.length}.`)
  assert.equal(read.calls.length, 0, `(c) [M2] read is called zero times. Got ${read.calls.length}.`)

  const rows = rowsOf(appendEvent)
  assert.equal(rows[0].cause, 'own', `(c) [M1] the own red's cause is 'own'. Got: ${JSON.stringify(rows[0].cause)}`)
  assert.equal(rows[0].owner, '3', `(c) [M1] the own red's owner is folded. Got: ${JSON.stringify(rows[0].owner)}`)
  assert.equal(rows[0].green_before, null, `(c) [M1] the own red's green_before is null. Got: ${JSON.stringify(rows[0].green_before)}`)

  assert.equal(rows[1].cause, 'check', `(c) [M1] the check red's cause is 'check'. Got: ${JSON.stringify(rows[1].cause)}`)
  assert.equal(rows[1].owner, null, `(c) [M1] the check red's owner is null. Got: ${JSON.stringify(rows[1].owner)}`)
  assert.equal(rows[1].exam, null, `(c) [M1] the check red's exam is null. Got: ${JSON.stringify(rows[1].exam)}`)
  assert.equal(rows[1].cmd, 'git diff --quiet', `(c) [M1] the check red's cmd carries the check's cmd. Got: ${JSON.stringify(rows[1].cmd)}`)

  assert.deepEqual(rows[0].reattempt, { role: 'implement', task: '3' },
    `(c) [M1] the own red's reattempt is {role: 'implement', task: folded}. Got: ${JSON.stringify(rows[0].reattempt)}`)
  assert.deepEqual(rows[1].reattempt, { role: 'implement', task: '3' },
    `(c) [M1] the check red's reattempt is {role: 'implement', task: folded}. Got: ${JSON.stringify(rows[1].reattempt)}`)

  assert.equal(result.actions.length, 1, `(c) [M3] both reds collapse to one action. Got: ${JSON.stringify(result.actions)}`)
  assert.equal(reattempt.calls.length, 1, `(c) [M4] reattempt is called exactly once. Got ${reattempt.calls.length}.`)
}

// ══════════════════════════════════════════════════════════════════════════
// (d) [M1][M2] sibling red NOT green before the fold — never judged
// ══════════════════════════════════════════════════════════════════════════
{
  const run = async (runExamAtBehavior) => {
    const read = fake({ examDefect: true, score: 1 })
    const appendEvent = fake(undefined)
    const result = await foldRound({
      ...baseArgs(),
      runExamAt: fake(runExamAtBehavior), read, appendEvent, reattempt: fake(true), verify: fake(VERIFY_CLEAN)
    })
    return { rows: rowsOf(appendEvent), read, result }
  }

  const wasRed = await run(1)
  assert.equal(wasRed.rows[0].green_before, false,
    `(d) [M1] green_before is false for any non-zero exit. Got: ${JSON.stringify(wasRed.rows[0].green_before)}`)
  assert.equal(wasRed.read.calls.length, 0, `(d) [M2] read is called zero times when green_before is false. Got ${wasRed.read.calls.length}.`)
  assert.deepEqual(wasRed.rows[0].reattempt, { role: 'implement', task: '2' },
    `(d) [M2] its reattempt is {role: 'implement', task: owner}. Got: ${JSON.stringify(wasRed.rows[0].reattempt)}`)

  const rejected = await run(rejects('clone failed'))
  assert.equal(rejected.rows[0].green_before, null,
    `(d) [M1] green_before is null when runExamAt rejects. Got: ${JSON.stringify(rejected.rows[0].green_before)}`)
  assert.equal(rejected.read.calls.length, 0, `(d) [M2] read is called zero times when runExamAt rejects. Got ${rejected.read.calls.length}.`)
  assert.deepEqual(rejected.rows[0].reattempt, { role: 'implement', task: '2' },
    `(d) [M2] its reattempt is still {role: 'implement', task: owner}. Got: ${JSON.stringify(rejected.rows[0].reattempt)}`)
}

// ══════════════════════════════════════════════════════════════════════════
// (e) [M4] one round: verify only after every reattempt is true
// ══════════════════════════════════════════════════════════════════════════
{
  // -- every reattempt true, no reds left: unresolved false, one fold:verify row
  {
    const appendEvent = fake(undefined)
    const reattempt = fake(true)
    const verify = fake(VERIFY_CLEAN)
    const result = await foldRound({
      ...baseArgs(),
      runExamAt: fake(0), read: fake({ examDefect: true, score: 0.9 }), appendEvent, reattempt, verify
    })
    const rows = rowsOf(appendEvent)
    assert.deepEqual(rows.map((r) => r.kind), ['fold:exam-defect', 'fold:verify'],
      `(e) [M4] the row kinds, in order, are the red row then one fold:verify. Got: ${JSON.stringify(rows.map((r) => r.kind))}`)
    assert.equal(rows[1].task, '3', `(e) [M4] the fold:verify row's task is folded. Got: ${JSON.stringify(rows[1].task)}`)
    assert.equal(rows[1].attempt, 2, `(e) [M4] the fold:verify row's attempt is 2. Got: ${JSON.stringify(rows[1].attempt)}`)
    assert.deepEqual(rows[1].ran, VERIFY_CLEAN.ran,
      `(e) [M4] the fold:verify row's ran is verify's answer. Got: ${JSON.stringify(rows[1].ran)}`)
    assert.equal(reattempt.calls.length, 1, `(e) [M4] reattempt is called exactly once. Got ${reattempt.calls.length}.`)
    assert.equal(verify.calls.length, 1, `(e) [M4] verify is called exactly once. Got ${verify.calls.length}.`)
    assert.equal(result.unresolved, false, `(e) [M4] unresolved is false when verify answers no reds. Got: ${JSON.stringify(result.unresolved)}`)
  }

  // -- verify still finds a red: unresolved true, one fold:unresolved row
  {
    const appendEvent = fake(undefined)
    const reattempt = fake(true)
    const verify = fake({ ran: [{ task: '3', exit: 0 }, { task: '2', exit: 1 }], reds: [{ kind: 'exam', id: '2', exit: 1, out: 'x' }] })
    const result = await foldRound({
      ...baseArgs(),
      runExamAt: fake(0), read: fake({ examDefect: true, score: 0.9 }), appendEvent, reattempt, verify
    })
    const rows = rowsOf(appendEvent)
    assert.equal(result.unresolved, true, `(e) [M4] unresolved is true when verify still finds a red. Got: ${JSON.stringify(result.unresolved)}`)
    const unresolvedRows = rows.filter((r) => r.kind === 'fold:unresolved')
    assert.equal(unresolvedRows.length, 1,
      `(e) [M4] exactly one fold:unresolved row is appended. Got: ${JSON.stringify(rows.map((r) => r.kind))}`)
    assert.equal(unresolvedRows[0].task, '3', `(e) [M4] the fold:unresolved row's task is folded. Got: ${JSON.stringify(unresolvedRows[0].task)}`)
    assert.equal(unresolvedRows[0].exam, '2', `(e) [M4] the fold:unresolved row's exam is the still-red exam. Got: ${JSON.stringify(unresolvedRows[0].exam)}`)
    assert.equal(reattempt.calls.length, 1, `(e) [M4] reattempt is still called exactly once. Got ${reattempt.calls.length}.`)
  }

  // -- two sibling defects, reattempt resolves false: short-circuit
  {
    const twoReds = [
      { kind: 'exam', id: '2', exit: 1, out: 'two-a' },
      { kind: 'exam', id: '4', exit: 1, out: 'two-b' }
    ]
    const appendEvent = fake(undefined)
    const reattempt = fake(false)
    const verify = fake(VERIFY_CLEAN)
    const result = await foldRound({
      ...baseArgs({ reds: twoReds }),
      runExamAt: fake(0), read: fake({ examDefect: true, score: 0.9 }), appendEvent, reattempt, verify
    })
    assert.equal(result.actions.length, 2,
      `(e) [M3][M4] two distinct owners make two actions. Got: ${JSON.stringify(result.actions)}`)
    assert.equal(reattempt.calls.length, 1,
      `(e) [M4] a reattempt that resolves false stops after the first call. Got ${reattempt.calls.length}.`)
    assert.equal(verify.calls.length, 0,
      `(e) [M4] verify is never called once a reattempt is not true. Got ${verify.calls.length}.`)
    const rows = rowsOf(appendEvent)
    const unresolvedRows = rows.filter((r) => r.kind === 'fold:unresolved')
    assert.equal(unresolvedRows.length, 2,
      `(e) [M4] one fold:unresolved row per entry of reds on short-circuit. Got: ${JSON.stringify(rows.map((r) => r.kind))}`)
    assert.equal(result.unresolved, true, `(e) [M4] unresolved is true on short-circuit. Got: ${JSON.stringify(result.unresolved)}`)
  }

  // -- a rejecting reattempt: foldRound still resolves, unresolved true
  {
    const reattempt = fake(rejects('dispatch failed'))
    const result = await foldRound({
      ...baseArgs(),
      runExamAt: fake(0), read: fake({ examDefect: true, score: 0.9 }), appendEvent: fake(undefined), reattempt, verify: fake(VERIFY_CLEAN)
    })
    assert.equal(result.unresolved, true,
      `(e) [M4] a rejecting reattempt still resolves the round, with unresolved true. Got: ${JSON.stringify(result.unresolved)}`)
  }
}

// ══════════════════════════════════════════════════════════════════════════
// (f) [M5] enabled anything but exactly true collapses to one implement action
// ══════════════════════════════════════════════════════════════════════════
{
  const runExamAt = fake(0)
  const read = fake({ examDefect: true, score: 0.9 })
  const appendEvent = fake(undefined)
  const reattempt = fake(true)
  const verify = fake(VERIFY_CLEAN)

  const result = await foldRound({
    ...baseArgs({ enabled: false }),
    runExamAt, read, appendEvent, reattempt, verify
  })

  assert.equal(runExamAt.calls.length, 0, `(f) [M5] runExamAt is called zero times when disabled. Got ${runExamAt.calls.length}.`)
  assert.equal(read.calls.length, 0, `(f) [M5] read is called zero times when disabled. Got ${read.calls.length}.`)

  const rows = rowsOf(appendEvent)
  assert.equal(rows[0].kind, 'fold:red', `(f) [M5] the row's kind is 'fold:red' when disabled. Got: ${JSON.stringify(rows[0].kind)}`)
  assert.deepEqual(rows[0].reattempt, { role: 'implement', task: '3' },
    `(f) [M5] its reattempt is {role: 'implement', task: folded}. Got: ${JSON.stringify(rows[0].reattempt)}`)

  assert.equal(result.actions.length, 1, `(f) [M5] actions collapses to the one action. Got: ${JSON.stringify(result.actions)}`)
  assert.equal(result.actions[0].role, 'implement', `(f) [M5] the action's role is 'implement'. Got: ${JSON.stringify(result.actions[0].role)}`)
  assert.equal(result.actions[0].task, '3', `(f) [M5] the action's task is folded. Got: ${JSON.stringify(result.actions[0].task)}`)

  assert.equal(verify.calls.length, 1,
    `(f) [M5] M4 still holds: verify is called once after the sole reattempt resolves true. Got ${verify.calls.length}.`)
}

console.log('ALL TESTS PASSED')
