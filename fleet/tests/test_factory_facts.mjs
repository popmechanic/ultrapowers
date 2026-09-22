/**
 * fleet/tests/test_factory_facts.mjs — the exam for "The landing judge is
 * handed each clause's own assertion lines and asked about each clause over
 * them" (#1210).
 *
 * The claim: when a task's patch is judged, the judge sees, for each
 * numbered clause, the test names and assertion lines of the exam that cite
 * that clause and the proof commands that cite it, each with the exit code
 * the run measured, and is asked about each clause over exactly that
 * evidence, with one switch that returns to the bare exit codes.
 *
 * Legs, each naming the Machine clause it comes from:
 *
 *   (a) [M1] `examAssertions` attributes a heading and the assertion lines
 *       under it to the clauses cited in its own or an inherited bracket
 *       tag, trimmed and joined byte-exact; an uncited clause answers `''`;
 *       a tag beyond `clauses.length` attributes nothing.
 *   (b) [M2] `clauseFacts` builds one `{ exam, runs }` entry per clause: the
 *       `runs` are the citing proof lines in line order, off `runLines` when
 *       present and off `proofRuns`/`undefined` otherwise; `exam` carries the
 *       matching `examAsserts` string and `examExit` when `hasExam`, else is
 *       strictly `null`; and when the summed `text` overflows `capChars` the
 *       longest entry's `text` loses its last line, the rest untouched.
 *   (c) [M3] `readLanding` handed `clauseFacts` asks `claim_established`,
 *       `claim_established_given_assertions` and one `M<i>__facts` per
 *       clause — never `claim_established_given_facts` — each `M<i>__facts`
 *       question naming `clause_facts[<i-1>]` and `clauses[<i-1>]`, and its
 *       `state` carrying `clause_facts` and `facts` verbatim.
 *   (d) [M4] the row carries `claimGivenFacts` off whichever given-facts
 *       question was asked and, with `clauseFacts`, `claimGivenFactsPerClause`
 *       (one `noul` per clause, `null` where unanswered); a reading with
 *       nothing but `claim_established` answered still resolves `claim` and
 *       `coverage`; and a reading with `facts` but no `clauseFacts` keeps the
 *       BASE shape — `claim_established_given_facts`, no `__facts` key, no
 *       `state.clause_facts`, no `row.claimGivenFactsPerClause`.
 *
 * `examAssertions` and `clauseFacts` are pure, over in-memory text and
 * arrays; `readLanding` is exercised through `makeJudge({ ask })` with a
 * recording `ask` that never touches a disk, a socket or a child process.
 * `makeJudge` with no `questionsPath`/`policyPath` reads the real
 * `factory/questions.json` and `factory/policy.json` next to `judge.mjs`.
 */

import assert from 'node:assert/strict'

import { examAssertions, clauseFacts } from '../../factory/facts.mjs'
import { makeJudge } from '../../factory/judge.mjs'

// ── a. [M1] examAssertions attributes lines to the clauses they cite ──────
{
  const clauses3 = ['clause one text', 'clause two text', 'clause three text']

  const rawLines = [
    '  // ── a. [M1] the path hit  ',
    "    assert.equal(hit.path, 'a/b.txt')",
    "  assert.equal(hit.why, 'path') // [M1] redundant ",
    '  const ok = true',
    '// ── b. [M2, M3] the shared rule',
    '  def test_two():',
    '    expect(value).toBe(1) // [M9]',
    '  const x = 1',
  ]
  const text = rawLines.join('\n')
  const trimmed = rawLines.map((l) => l.trim())

  const result = examAssertions({ text, clauses: clauses3 })

  assert.deepEqual(
    Object.keys(result).sort(),
    ['M1', 'M2', 'M3'],
    '(a) [M1] the keys are exactly M1..Mn for n = clauses.length'
  )

  assert.equal(
    result.M1,
    [trimmed[0], trimmed[1], trimmed[2]].join('\n'),
    '(a) [M1] M1 is the heading and its two citing assert.equal lines, trimmed, joined byte-exact'
  )
  assert.equal(
    result.M2,
    [trimmed[4], trimmed[5]].join('\n'),
    '(a) [M1] M2 is the [M2, M3] heading plus the inherited def test_two(): line'
  )
  assert.equal(
    result.M3,
    result.M2,
    '(a) [M1] M3 is byte-exact the same lines as M2 — both cited by the same heading'
  )

  for (const key of ['M1', 'M2', 'M3']) {
    assert.ok(
      !result[key].includes('[M9]'),
      `(a) [M1] a citation of a clause beyond n (M9 with n = 3) attributes nothing — not even to ${key}`
    )
    assert.ok(
      !result[key].includes('const x = 1') && !result[key].includes('const ok = true'),
      `(a) [M1] a line that does not count (no assert/def/heading-with-own-citation shape) never reaches ${key}`
    )
  }

  const textNoM2 = [
    '// ── only. [M1, M3] combined',
    'assert.ok(true)',
  ].join('\n')
  const resultNoM2 = examAssertions({ text: textNoM2, clauses: clauses3 })
  assert.equal(resultNoM2.M2, '', "(a) [M1] a clause no line cites answers ''")
}

// ── b. [M2] clauseFacts builds one { exam, runs } entry per clause ────────
{
  const clauses3 = ['c1', 'c2', 'c3']
  const proofRunClauses = [['M1'], [], ['M1', 'M3']]
  const proofRuns = ['echo cmd0', 'echo cmd1', 'echo cmd2']
  const runLines = [
    { cmd: 'echo cmd0 (run)', exit: 0 },
    undefined,
    { cmd: 'echo cmd2 (run)', exit: 1 },
  ]
  const examAsserts = { M1: 'm1 assertion text', M2: 'm2 assertion text', M3: 'm3 assertion text' }
  const examExit = 7

  const withExam = clauseFacts({
    clauses: clauses3, examAsserts, hasExam: true, examExit,
    proofRuns, proofRunClauses, runLines, capChars: 100000,
  })
  assert.equal(withExam.length, 3, '(b) [M2] one entry per clause')
  assert.deepEqual(
    withExam[0].runs,
    [{ cmd: 'echo cmd0 (run)', exit: 0 }, { cmd: 'echo cmd2 (run)', exit: 1 }],
    '(b) [M2] entry 0 (M1): exactly the two citing lines, in line order, off runLines'
  )
  assert.deepEqual(withExam[1].runs, [], '(b) [M2] entry 1 (M2): no citing line, runs is exactly []')
  assert.deepEqual(
    withExam[2].runs,
    [{ cmd: 'echo cmd2 (run)', exit: 1 }],
    '(b) [M2] entry 2 (M3): exactly the one citing line'
  )
  for (let i = 0; i < 3; i += 1) {
    assert.equal(withExam[i].exam.exit, examExit, `(b) [M2] entry ${i}'s exam.exit is examExit`)
    assert.equal(
      withExam[i].exam.text,
      examAsserts['M' + (i + 1)],
      `(b) [M2] entry ${i}'s exam.text equals the matching examAsserts string`
    )
  }

  const noExam = clauseFacts({
    clauses: clauses3, examAsserts, hasExam: false, examExit,
    proofRuns, proofRunClauses, runLines, capChars: 100000,
  })
  for (let i = 0; i < 3; i += 1) {
    assert.equal(noExam[i].exam, null, `(b) [M2] entry ${i}'s exam is strictly null when hasExam is false`)
  }

  // the cap: three texts of 3, 5 and 2 lines, the middle one longest
  const mk = (label, n) => Array.from({ length: n }, (_, k) => label + k).join('\n')
  const text0 = mk('a', 3)
  const text1 = mk('b', 5)
  const text2 = mk('c', 2)
  const capExamAsserts = { M1: text0, M2: text1, M3: text2 }
  const capClauses = ['x', 'y', 'z']
  const capArgs = {
    clauses: capClauses, examAsserts: capExamAsserts, hasExam: true, examExit: 0,
    proofRuns: [], proofRunClauses: [], runLines: [],
  }
  const uncapped = clauseFacts({ ...capArgs, capChars: 100000 })
  const totalUncapped = text0.length + text1.length + text2.length
  const capChars = totalUncapped - 3 // exactly enough to force one line off the longest entry
  const capped = clauseFacts({ ...capArgs, capChars })

  assert.equal(
    capped[0].exam.text,
    uncapped[0].exam.text,
    '(b) [M2] the shorter entry (M1) is byte-identical to the uncapped call'
  )
  assert.equal(
    capped[2].exam.text,
    uncapped[2].exam.text,
    '(b) [M2] the other shorter entry (M3) is byte-identical to the uncapped call'
  )
  assert.equal(
    capped[1].exam.text,
    text1.split('\n').slice(0, -1).join('\n'),
    '(b) [M2] the longest entry (M2) loses exactly its last line'
  )
  const cappedTotal = capped.reduce((s, e) => s + (e.exam && e.exam.text ? e.exam.text.length : 0), 0)
  assert.ok(cappedTotal <= capChars, '(b) [M2] the summed text fits within capChars once cut')
}

// ── c. [M3] readLanding handed clauseFacts asks per-clause facts questions ─
let row1 // shared with leg (d)
let calls1
{
  const clauses = ['clause one', 'clause two', 'clause three']
  const facts = [{ kind: 'exam', exit: 0 }]
  const cf = [
    { exam: { exit: 0, text: 'm1 text' }, runs: [] },
    { exam: { exit: 0, text: 'm2 text' }, runs: [] },
    { exam: { exit: 0, text: 'm3 text' }, runs: [] },
  ]
  const answers = {
    claim_established: { noul: 0.95 },
    claim_established_given_assertions: { noul: 0.77 },
    M1__facts: { noul: 0.9 },
    M3__facts: { noul: 0.2 },
  }
  calls1 = []
  const ask1 = async (arg) => { calls1.push(arg); return answers }
  const judge1 = makeJudge({ ask: ask1 })

  row1 = await judge1.readLanding({ clauses, patch: 'PATCH TEXT', files: {}, facts, clauseFacts: cf })

  assert.equal(calls1.length, 1, '(c) [M3] readLanding handed clauseFacts makes exactly one call')
  const keys1 = Object.keys(calls1[0].questions)
  for (const key of ['claim_established', 'claim_established_given_assertions', 'M1__facts', 'M2__facts', 'M3__facts']) {
    assert.ok(keys1.includes(key), `(c) [M3] the call's questions include ${key}`)
  }
  assert.ok(
    !keys1.includes('claim_established_given_facts'),
    "(c) [M3] the call's questions do not include claim_established_given_facts"
  )
  const q2 = calls1[0].questions.M2__facts.instructions.question
  assert.ok(q2.includes('clause_facts[1]'), '(c) [M3] the M2__facts question names clause_facts[1]')
  assert.ok(q2.includes('clauses[1]'), '(c) [M3] the M2__facts question names clauses[1]')
  assert.deepEqual(
    calls1[0].state.clause_facts, cf,
    '(c) [M3] state.clause_facts deep-equals the clauseFacts array handed'
  )
  assert.deepEqual(calls1[0].state.facts, facts, '(c) [M3] state.facts deep-equals facts')
}

// ── d. [M4] the row's claimGivenFacts and claimGivenFactsPerClause ────────
{
  assert.equal(
    row1.claimGivenFacts, 0.77,
    '(d) [M4] claimGivenFacts is the noul answered to claim_established_given_assertions'
  )
  assert.deepEqual(
    row1.claimGivenFactsPerClause, [0.9, null, 0.2],
    '(d) [M4] claimGivenFactsPerClause is one noul per clause, null where M2__facts went unanswered'
  )

  const clauses = ['clause one', 'clause two', 'clause three']
  const calls2 = []
  const ask2 = async (arg) => { calls2.push(arg); return { claim_established: { noul: 0.5 } } }
  const judge2 = makeJudge({ ask: ask2 })
  const row2 = await judge2.readLanding({ clauses, patch: 'PATCH TEXT', files: {} })
  assert.ok(
    row2 !== null && typeof row2.claim === 'number',
    '(d) [M4] an ask answering only claim_established still resolves a row carrying claim'
  )
  assert.equal(
    row2.coverage.length, 3,
    '(d) [M4] ...and a coverage array of exactly clauses.length entries'
  )

  const facts = [{ kind: 'exam', exit: 0 }]
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
    '(d) [M4] BASE: readLanding with no clauseFacts and non-empty facts asks claim_established_given_facts'
  )
  assert.ok(
    !keys3.some((k) => k.endsWith('__facts')),
    '(d) [M4] BASE: no key ending __facts is asked'
  )
  assert.ok(
    !('clause_facts' in calls3[0].state),
    '(d) [M4] BASE: the call state carries no clause_facts key'
  )
  assert.ok(
    !('claimGivenFactsPerClause' in row3),
    '(d) [M4] BASE: the row carries no claimGivenFactsPerClause key'
  )
}

console.log('ALL TESTS PASSED')
