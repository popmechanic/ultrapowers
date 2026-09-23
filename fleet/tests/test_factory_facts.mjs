/**
 * fleet/tests/test_factory_facts.mjs — the exam for "The examiner leaves the
 * engine and the facts stay".
 *
 * The claim: with the exam gone, a landing's facts come from the task's own
 * proof `Run:` lines and the tests the engine selected against the patch —
 * `factory/facts.mjs`'s `settledCoverage`, `observedFacts` and `clauseFacts`
 * read exactly those two sources, never an exam file or its assertions — and
 * `factory/judge.mjs`'s `readLanding`, handed `facts`/`settled`/`clauseFacts`,
 * asks Jev one `M<i>__facts` question per clause plus a record-only
 * `claim_established_given_facts`, over exactly that evidence, without ever
 * gating the reading on the answer.
 *
 * Legs:
 *
 *   (a) `settledCoverage`: entry `i` is `null` when no proof line cites
 *       `M<i+1>`, `1` when every citing line exited `0`, `0` when a citing
 *       line exited non-zero or has no result in `runLines` at all.
 *   (b) `observedFacts`: one `{ kind: 'run:line', cmd, exit, cites }` per
 *       proof line that either cites a clause or whose command contains one
 *       of the clauses' own backticked literals, followed by one
 *       `{ kind: 'test', path, exit }` per selected test, in order; facts
 *       drop off the end until the array fits `capBytes`.
 *   (c) `clauseFacts`: one `{ runs, tests }` entry per clause — `runs` the
 *       citing proof lines in line order (off `runLines` when present, the
 *       raw `proofRuns` command and `undefined` exit otherwise), `tests` the
 *       selected tests named under that clause's key in `covers`.
 *   (d) `readLanding` handed `facts`/`settled`/`clauseFacts` asks
 *       `claim_established`, `claim_established_given_facts` and one
 *       `M<i>__facts` per clause, skips a settled clause's own pairwise
 *       `M<i>__f<j>` questions (its coverage is `settled[i]` verbatim), and
 *       its row carries `claimGivenFacts` and `claimGivenFactsPerClause`; a
 *       reading with nothing but `claim_established` still resolves `claim`
 *       and `coverage`; a reading with `facts` but no `clauseFacts` keeps the
 *       BASE shape — `claim_established_given_facts` asked, no `__facts` key,
 *       no `state.clause_facts`, no `row.claimGivenFactsPerClause`.
 *
 * `settledCoverage`, `observedFacts` and `clauseFacts` are pure, over
 * in-memory arrays; `readLanding` is exercised through `makeJudge({ ask })`
 * with a recording `ask` that never touches a disk, a socket or a child
 * process. `makeJudge` with no `questionsPath`/`policyPath` reads the real
 * `factory/questions.json` and `factory/policy.json` next to `judge.mjs`.
 */

import assert from 'node:assert/strict'

import { settledCoverage, observedFacts, clauseFacts } from '../../factory/facts.mjs'
import { makeJudge } from '../../factory/judge.mjs'

// ── a. settledCoverage: null / 1 / 0 per clause ────────────────────────────
{
  const clauses = ['A', 'B', 'C', 'D']
  const proofRunClauses = [['M1'], [], ['M1', 'M3'], ['M2'], ['M1']]
  const runLines = [
    { cmd: 'x0', exit: 0 },
    undefined,
    { cmd: 'x2', exit: 1 },
    { cmd: 'x3', exit: 0 },
    // no entry at index 4
  ]
  const result = settledCoverage({ clauses, proofRunClauses, runLines })
  assert.equal(result[0], 0, '(a) M1 is cited by a line that exited non-zero -> 0')
  assert.equal(result[1], 1, '(a) M2 is cited only by a line that exited 0 -> 1')
  assert.equal(result[2], 0, '(a) M3 is cited only by the line that exited non-zero -> 0')
  assert.equal(result[3], null, '(a) M4 is cited by no line at all -> null')

  const missing = settledCoverage({
    clauses: ['E'], proofRunClauses: [['M1']], runLines: [],
  })
  assert.equal(missing[0], 0, '(a) a citing line with no result in runLines at all -> 0')
}

// ── b. observedFacts: citing/literal-matching run lines, then tests ───────
{
  const clauses = ['clause with `lit1` inside', 'clause two `lit2` here']
  const proofRuns = [
    'echo something',
    'echo lit1 appears',
    'echo unrelated',
    'echo cites via array',
  ]
  const proofRunClauses = [[], [], [], ['M1']]
  const runLines = [
    { cmd: 'echo something (run)', exit: 0 },
    { cmd: 'echo lit1 appears (run)', exit: 0 },
    undefined,
    { cmd: 'echo cites via array (run)', exit: 1 },
  ]
  const tests = [{ path: 'a/test.mjs', exit: 0 }, { path: 'b/test.mjs', exit: 1 }]

  const full = observedFacts({ clauses, proofRuns, proofRunClauses, runLines, tests, capBytes: 100000 })
  assert.deepEqual(full, [
    { kind: 'run:line', cmd: 'echo lit1 appears (run)', exit: 0, cites: [] },
    { kind: 'run:line', cmd: 'echo cites via array (run)', exit: 1, cites: ['M1'] },
    { kind: 'test', path: 'a/test.mjs', exit: 0 },
    { kind: 'test', path: 'b/test.mjs', exit: 1 },
  ], '(b) a line neither citing nor matching a literal is left out; matching/citing lines and every selected test are kept, in order')

  const capBytes = Buffer.byteLength(JSON.stringify(full), 'utf8') - 1
  const capped = observedFacts({ clauses, proofRuns, proofRunClauses, runLines, tests, capBytes })
  assert.deepEqual(capped, full.slice(0, -1), '(b) facts drop off the end until the array fits capBytes')
}

// ── c. clauseFacts: per-clause { runs, tests } ─────────────────────────────
{
  const clauses = ['c1', 'c2']
  const proofRuns = ['line0', 'line1', 'line2']
  const proofRunClauses = [['M1'], ['M2'], ['M1', 'M2']]
  const runLines = [
    { cmd: 'l0(run)', exit: 0 },
    { cmd: 'l1(run)', exit: 1 },
    undefined,
  ]
  const tests = [{ path: 'p1', exit: 0 }, { path: 'p2', exit: 1 }]
  const covers = { M1: ['p1'], M2: ['p2', 'pX'] }

  const result = clauseFacts({ clauses, proofRuns, proofRunClauses, runLines, tests, covers })
  assert.equal(result.length, 2, '(c) one entry per clause')
  assert.deepEqual(
    result[0].runs,
    [{ cmd: 'l0(run)', exit: 0 }, { cmd: 'line2', exit: undefined }],
    '(c) entry 0 (M1): the citing lines in line order, off runLines when present, else the raw proofRuns command with exit undefined'
  )
  assert.deepEqual(
    result[0].tests, [{ path: 'p1', exit: 0 }],
    '(c) entry 0 (M1): the selected tests named under covers.M1'
  )
  assert.deepEqual(
    result[1].runs,
    [{ cmd: 'l1(run)', exit: 1 }, { cmd: 'line2', exit: undefined }],
    '(c) entry 1 (M2): the citing lines in line order'
  )
  assert.deepEqual(
    result[1].tests,
    [{ path: 'p2', exit: 1 }, { path: 'pX', exit: undefined }],
    '(c) entry 1 (M2): a covers path absent from tests still appears, with exit undefined'
  )
}

// ── d. readLanding handed facts/settled/clauseFacts ───────────────────────
let row1 // shared with the BASE checks below
let calls1
{
  const clauses = ['clause one', 'clause two', 'clause three']
  const files = { 'a.mjs': 'A TEXT' }
  const facts = [{ kind: 'run:line', cmd: 'x', exit: 0, cites: ['M1'] }]
  const settled = [null, 1, null]
  const cf = [
    { runs: [{ cmd: 'x', exit: 0 }], tests: [] },
    { runs: [], tests: [] },
    { runs: [], tests: [{ path: 'p3', exit: 0 }] },
  ]
  const answers = {
    claim_established: { noul: 0.95 },
    claim_established_given_facts: { noul: 0.77 },
    M1__facts: { noul: 0.9 },
    M3__facts: { noul: 0.2 },
    M1__f0: { noul: 0.4 },
    M3__f0: { noul: 0.6 },
  }
  calls1 = []
  const ask1 = async (arg) => { calls1.push(arg); return answers }
  const judge1 = makeJudge({ ask: ask1 })

  row1 = await judge1.readLanding({ clauses, patch: 'PATCH TEXT', files, facts, settled, clauseFacts: cf })

  assert.equal(calls1.length, 1, '(d) readLanding handed clauseFacts makes exactly one call')
  const keys1 = Object.keys(calls1[0].questions)
  for (const key of ['claim_established', 'claim_established_given_facts', 'M1__facts', 'M2__facts', 'M3__facts']) {
    assert.ok(keys1.includes(key), `(d) the call's questions include ${key}`)
  }
  assert.ok(
    !keys1.includes('M2__f0'),
    "(d) clause M2 is settled (settled[1] === 1) so its pairwise M2__f0 question is never asked"
  )
  assert.ok(
    keys1.includes('M1__f0') && keys1.includes('M3__f0'),
    '(d) the two unsettled clauses still get their own pairwise per-file questions'
  )
  const q2 = calls1[0].questions.M2__facts.instructions.question
  assert.ok(q2.includes('clause_facts[1]'), '(d) the M2__facts question names clause_facts[1]')
  assert.ok(q2.includes('clauses[1]'), '(d) the M2__facts question names clauses[1]')
  assert.deepEqual(
    calls1[0].state.clause_facts, cf,
    '(d) state.clause_facts deep-equals the clauseFacts array handed'
  )
  assert.deepEqual(calls1[0].state.facts, facts, '(d) state.facts deep-equals facts')

  assert.equal(
    row1.claimGivenFacts, 0.77,
    '(d) claimGivenFacts is the noul answered to claim_established_given_facts'
  )
  assert.deepEqual(
    row1.claimGivenFactsPerClause, [0.9, null, 0.2],
    '(d) claimGivenFactsPerClause is one noul per clause, null where M2__facts went unanswered'
  )
  assert.equal(row1.coverage[1], 1, "(d) the settled clause's coverage entry is settled[1] verbatim")
}

// ── BASE shapes readLanding keeps unchanged ────────────────────────────────
{
  const clauses = ['clause one', 'clause two', 'clause three']
  const calls2 = []
  const ask2 = async (arg) => { calls2.push(arg); return { claim_established: { noul: 0.5 } } }
  const judge2 = makeJudge({ ask: ask2 })
  const row2 = await judge2.readLanding({ clauses, patch: 'PATCH TEXT', files: {} })
  assert.ok(
    row2 !== null && typeof row2.claim === 'number',
    'an ask answering only claim_established still resolves a row carrying claim'
  )
  assert.equal(row2.coverage.length, 3, '...and a coverage array of exactly clauses.length entries')

  const facts = [{ kind: 'run:line', cmd: 'x', exit: 0, cites: [] }]
  const calls3 = []
  const ask3 = async (arg) => {
    calls3.push(arg)
    return { claim_established: { noul: 0.5 }, claim_established_given_facts: { noul: 0.4 } }
  }
  const judge3 = makeJudge({ ask: ask3 })
  const row3 = await judge3.readLanding({ clauses, patch: 'PATCH TEXT', files: {}, facts })
  const keys3 = Object.keys(calls3[0].questions)
  assert.ok(
    keys3.includes('claim_established_given_facts'),
    'BASE: readLanding with no clauseFacts and non-empty facts asks claim_established_given_facts'
  )
  assert.ok(!keys3.some((k) => k.endsWith('__facts')), 'BASE: no key ending __facts is asked')
  assert.ok(!('clause_facts' in calls3[0].state), 'BASE: the call state carries no clause_facts key')
  assert.ok(!('claimGivenFactsPerClause' in row3), 'BASE: the row carries no claimGivenFactsPerClause key')
}

console.log('ALL TESTS PASSED')
