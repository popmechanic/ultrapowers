/**
 * fleet/tests/test_factory_referee_trigger.mjs — the exam for "The referee is
 * dispatched on the lowest-covered clause as well as on the rung, and the
 * record says which trigger fired" (Authorized-by #1209; map #1131 rule 3).
 *
 * `factory/referee.mjs` exports one pure synchronous function,
 * `refereeTrigger({ coverage, clauses, rung, policy })`, answering
 * `{ dispatch, trigger, clause, fact }`. This exam is hermetic: it imports
 * only `refereeTrigger`, passes plain policy objects of its own making, and
 * never touches `factory/policy.json`, a child process, disk or network. The
 * engine wiring (M5) and the policy.json cell (M4) are read against the diff
 * by the plan's own `Run:` lines, not by this file.
 *
 * Legs, each naming the Machine clause it comes from:
 *
 *   (a) [M1] the lowest-covered `clause` — its `m`, `text`, `score` — for a
 *       range of `coverage`/`clauses` shapes, including a tie (lowest `m`
 *       wins), a non-numeric entry (reads as 0), a missing clause text
 *       ('(no clause text)'), and `coverage` that is not a non-empty array
 *       (`clause` is `null`);
 *   (b) [M2] the coverage trigger and the rung trigger, singly, together and
 *       neither, driving `trigger` and `dispatch`, plus the cell-absent case
 *       where the coverage trigger never fires;
 *   (c) [M3] `fact` — present and shaped only when the coverage trigger
 *       fired, `null` otherwise (rung-only and none).
 *
 * Assumption about the code under test: `refereeTrigger` accepts the four
 * named options in one object and does not require `fs`, network or any
 * other ambient state — it is evaluated purely on its arguments, so every
 * leg below passes a complete, self-contained argument object (a `clauses`
 * array sized to whatever `coverage` needs, even where that leg's
 * assertions don't inspect `clause.text`, so a defensive `clauses[m - 1]`
 * lookup never throws).
 */

import assert from 'node:assert/strict'

import { refereeTrigger } from '../../factory/referee.mjs'

// ── a. [M1] the lowest-covered clause scan ──────────────────────────────────
{
  const r1 = refereeTrigger({
    coverage: [0.95, 0.39, 1],
    clauses: ['a', 'b', 'c'],
    rung: false,
    policy: {}
  })
  assert.deepEqual(
    r1.clause,
    { m: 2, text: 'b', score: 0.39 },
    '(a) [M1] coverage [0.95, 0.39, 1] over clauses a,b,c: clause deep-equals { m: 2, text: "b", score: 0.39 }'
  )

  const r2 = refereeTrigger({
    coverage: [0.5, 0.5],
    clauses: ['a', 'b'],
    rung: false,
    policy: {}
  })
  assert.equal(r2.clause.m, 1, '(a) [M1] a tie at 0.5/0.5 answers the lowest m (1)')

  const r3 = refereeTrigger({
    coverage: [0.9, 'x'],
    clauses: ['a', 'b'],
    rung: false,
    policy: {}
  })
  assert.equal(r3.clause.m, 2, '(a) [M1] a non-numeric coverage entry ("x") reads as 0 and is the lowest, m=2')
  assert.equal(r3.clause.score, 'x', '(a) [M1] clause.score is that entry of coverage exactly as given ("x")')

  const r4 = refereeTrigger({
    coverage: [0.2],
    clauses: [],
    rung: false,
    policy: {}
  })
  assert.equal(
    r4.clause.text,
    '(no clause text)',
    '(a) [M1] clauses[m - 1] absent (clauses: []) answers clause.text "(no clause text)"'
  )

  const r5 = refereeTrigger({
    coverage: [],
    clauses: [],
    rung: false,
    policy: {}
  })
  assert.equal(r5.clause, null, '(a) [M1] coverage: [] (empty array) answers clause: null')

  const r6 = refereeTrigger({
    coverage: undefined,
    clauses: [],
    rung: false,
    policy: {}
  })
  assert.equal(r6.clause, null, '(a) [M1] coverage: undefined (not a non-empty array) answers clause: null')
}

// ── b. [M2] the coverage trigger and the rung trigger ───────────────────────
const POLICY_08 = { task: { referee: { min_coverage: { value: 0.8 } } } }

const bCoverageOnly = refereeTrigger({
  coverage: [0.95, 0.39, 1],
  clauses: ['a', 'b', 'c'],
  rung: false,
  policy: POLICY_08
})
const bRungOnly = refereeTrigger({
  coverage: [0.95, 0.9],
  clauses: ['a', 'b'],
  rung: true,
  policy: POLICY_08
})
const bBoth = refereeTrigger({
  coverage: [0.95, 0.39],
  clauses: ['a', 'b'],
  rung: true,
  policy: POLICY_08
})
const bNone = refereeTrigger({
  coverage: [0.95, 0.9],
  clauses: ['a', 'b'],
  rung: false,
  policy: POLICY_08
})
const bNoneEmptyCoverage = refereeTrigger({
  coverage: [],
  clauses: [],
  rung: false,
  policy: POLICY_08
})
const bNoCell = refereeTrigger({
  coverage: [0.1],
  clauses: ['z'],
  rung: false,
  policy: {}
})

{
  assert.equal(bCoverageOnly.trigger, 'coverage', '(b) [M2] coverage below 0.8, rung false: trigger is "coverage"')
  assert.equal(bCoverageOnly.dispatch, true, '(b) [M2] coverage below 0.8, rung false: dispatch is true')

  assert.equal(bRungOnly.trigger, 'rung', '(b) [M2] coverage above 0.8, rung true: trigger is "rung"')
  assert.equal(bRungOnly.dispatch, true, '(b) [M2] coverage above 0.8, rung true: dispatch is true')

  assert.equal(bBoth.trigger, 'both', '(b) [M2] coverage below 0.8 and rung true: trigger is "both"')
  assert.equal(bBoth.dispatch, true, '(b) [M2] coverage below 0.8 and rung true: dispatch is true')

  assert.equal(bNone.trigger, 'none', '(b) [M2] coverage above 0.8 and rung false: trigger is "none"')
  assert.equal(bNone.dispatch, false, '(b) [M2] coverage above 0.8 and rung false: dispatch is false')

  assert.equal(
    bNoneEmptyCoverage.trigger,
    'none',
    '(b) [M2] coverage: [] (no clause, so the coverage trigger cannot fire) and rung false: trigger is "none"'
  )

  assert.equal(
    bNoCell.trigger,
    'none',
    '(b) [M2] policy {} (min_coverage cell absent) and low coverage: the coverage trigger never fires, trigger is "none"'
  )
  assert.equal(bNoCell.dispatch, false, '(b) [M2] policy {} and low coverage: dispatch is false')
}

// ── c. [M3] fact is the hand-off string only when the coverage trigger fired ──
{
  assert.equal(typeof bCoverageOnly.fact, 'string', '(c) [M3] the "coverage" answer has a fact that is a string')
  assert.ok(
    bCoverageOnly.fact.startsWith('LOWEST-COVERED CLAUSE'),
    `(c) [M3] fact begins "LOWEST-COVERED CLAUSE": ${bCoverageOnly.fact}`
  )
  assert.ok(bCoverageOnly.fact.includes('M2'), `(c) [M3] fact contains M<clause.m> ("M2"): ${bCoverageOnly.fact}`)
  assert.ok(bCoverageOnly.fact.includes('0.39'), `(c) [M3] fact contains the text of clause.score ("0.39"): ${bCoverageOnly.fact}`)
  assert.ok(bCoverageOnly.fact.includes('b'), `(c) [M3] fact contains clause.text ("b"): ${bCoverageOnly.fact}`)

  assert.equal(
    typeof bBoth.fact,
    'string',
    '(c) [M3] the "both" answer (coverage trigger also fired) has a fact that is a string, not null'
  )

  assert.equal(bRungOnly.fact, null, '(c) [M3] the "rung" answer (coverage trigger did not fire) has fact exactly null')
  assert.equal(bNone.fact, null, '(c) [M3] a "none" answer has fact exactly null')
  assert.equal(bNoneEmptyCoverage.fact, null, '(c) [M3] a "none" answer (empty coverage) has fact exactly null')
  assert.equal(bNoCell.fact, null, '(c) [M3] a "none" answer (cell absent) has fact exactly null')
}

console.log('ALL TESTS PASSED')
