/**
 * fleet/tests/test_factory_facts.mjs — the exam for Task: *the engine turns a
 * cited command's exit into that clause's coverage, selects the observed
 * facts for Jev, and records both readings*.
 *
 * This file is the Proof's `Test:`, written whole at the path the Proof
 * names. It exercises `factory/facts.mjs` alone — the new pure module the
 * task creates — through its two exports. The wiring this task also does in
 * `factory/engine.mjs` and `factory/policy.json` (M4, M5) carries its own
 * dedicated Proof `Run:` commands (a `python3 -c` policy check and a `grep`
 * over the engine) and is not re-proved here.
 *
 * The Machine clauses under test, restated so a reader can map every
 * assertion back to the contract:
 *
 *   M1 — `settledCoverage({ clauses, proofRunClauses, runLines })` returns an
 *        array as long as `clauses`: entry `i` is `null` when no run line
 *        cites `M<i+1>`, `1` when every line citing it has `exit === 0`, and
 *        `0` when any line citing it has a non-zero exit or has no result in
 *        `runLines`.
 *   M2 — `observedFacts({ clauses, hasExam, examExit, proofRuns,
 *        proofRunClauses, runLines, capBytes })` returns, in order,
 *        `{ kind: 'exam', exit: examExit }` exactly when `hasExam` is true,
 *        then one `{ kind: 'run:line', cmd, exit, cites }` per run line that
 *        cites at least one clause or whose `cmd` contains one of the
 *        clauses' backticked literals of 3 or more characters — and no
 *        object for a line that does neither.
 *   M3 — `observedFacts` drops facts from the END until `JSON.stringify` of
 *        the array is at most `capBytes` bytes long, and takes no note, no
 *        worker text and no board reading as input: its only inputs are the
 *        seven named keys.
 *
 * The legs, in the order they run here:
 *
 *   (a) [M1] three clauses, a run line citing each of M1 and M3 (M3 twice),
 *       one uncited: the settled array, and a second call whose `runLines`
 *       is truncated to prove an uncited-in-`runLines` line is not proof.
 *   (b) [M2] an exam plus three proof lines — one uncited but literal-
 *       matching, one cited, one neither — proving the inclusion rule and
 *       the ordering, with and without an exam.
 *   (c) [M3] the same facts, capped to force a drop from the end, plus the
 *       one-argument arity that shows the function destructures a single
 *       object rather than reading extra positional inputs.
 *
 * Nothing here touches the engine, the board, a note or worker text:
 * `observedFacts` and `settledCoverage` are called directly with plain
 * objects built in this file.
 */
import assert from 'node:assert/strict'

/** The deliverable, imported dynamically: a tree without it reports the
 *  ABSENT MODULE as an assertion rather than dying at load with no leg
 *  named at all. */
let facts = null
let importError = null
try {
  facts = await import('../../factory/facts.mjs')
} catch (error) {
  importError = error
}
assert.ok(importError === null,
  '`factory/facts.mjs` is importable — the module this task creates. Got: ' +
  String(importError && (importError.message || importError)))
assert.equal(typeof facts.settledCoverage, 'function',
  'it exports `settledCoverage({ clauses, proofRunClauses, runLines })`; got ' +
  JSON.stringify(typeof facts.settledCoverage))
assert.equal(typeof facts.observedFacts, 'function',
  'it exports `observedFacts({ clauses, hasExam, examExit, proofRuns, proofRunClauses, ' +
  'runLines, capBytes })`; got ' + JSON.stringify(typeof facts.observedFacts))

// ══════════════════════════════════════════════════════════════════════════
// (a) [M1] settledCoverage
// ══════════════════════════════════════════════════════════════════════════

{
  const clauses = ['M1. first clause', 'M2. second clause, never cited', 'M3. third clause']
  // Four run lines, in order: line0 cites M1 and is green; line1 and line2
  // both cite M3, one green one red; line3 cites nothing.
  const proofRunClauses = [['M1'], ['M3'], ['M3'], []]
  const runLines = [
    { cmd: 'cmd0', exit: 0 },
    { cmd: 'cmd1', exit: 0 },
    { cmd: 'cmd2', exit: 2 },
    { cmd: 'cmd3', exit: 1 },
  ]

  const result = facts.settledCoverage({ clauses, proofRunClauses, runLines })
  assert.equal(result.length, clauses.length,
    '(a) [M1] `settledCoverage` returns an array as long as `clauses`; got length ' +
    JSON.stringify(result.length))
  assert.deepEqual(result, [1, null, 0],
    '(a) [M1] entry 0 (M1, one citing line, exit 0) is `1`; entry 1 (M2, no citing line) ' +
    'is `null`; entry 2 (M3, two citing lines, one exit 2) is `0`. Got ' +
    JSON.stringify(result))

  // A cited line whose result is simply absent from `runLines` is not proof
  // either — it must read as `0`, the same as a line with a non-zero exit.
  const partialRunLines = runLines.slice(0, 1)
  const partial = facts.settledCoverage({ clauses, proofRunClauses, runLines: partialRunLines })
  assert.equal(partial[2], 0,
    '(a) [M1] M3 is cited by lines 1 and 2, but `runLines` here carries only line 0 — a ' +
    'cited line with no result in `runLines` is not proof, so entry 2 stays `0`; got ' +
    JSON.stringify(partial[2]))
}

// ══════════════════════════════════════════════════════════════════════════
// (b) [M2] observedFacts — inclusion and ordering
// ══════════════════════════════════════════════════════════════════════════

{
  const clauses = ['M1. `alpha.txt` exists', 'M2. prose only, no backticks of note']
  const proofRuns = ['test -f alpha.txt', 'true', 'echo unrelated']
  // line0 cites nothing but its cmd contains the backticked literal
  // `alpha.txt` (>= 3 chars) from clause M1; line1 is cited directly; line2
  // neither cites a clause nor contains any clause literal.
  const proofRunClauses = [[], ['M2'], []]
  const runLines = [
    { cmd: 'test -f alpha.txt', exit: 0 },
    { cmd: 'true', exit: 0 },
    { cmd: 'echo unrelated', exit: 3 },
  ]

  const withExam = facts.observedFacts({
    clauses, hasExam: true, examExit: 0, proofRuns, proofRunClauses, runLines, capBytes: 1e6,
  })
  assert.equal(withExam.length, 3,
    '(b) [M2] with an exam: one exam fact plus the two included run-line facts, and none ' +
    'for the uncited, non-matching `echo unrelated` line; got length ' +
    JSON.stringify(withExam.length) + ' (' + JSON.stringify(withExam) + ')')
  assert.deepEqual(withExam[0], { kind: 'exam', exit: 0 },
    '(b) [M2] the first fact is `{ kind: \'exam\', exit: examExit }` when `hasExam` is ' +
    'true; got ' + JSON.stringify(withExam[0]))
  assert.equal(withExam[1].kind, 'run:line',
    '(b) [M2] the second fact is a `run:line` fact; got ' + JSON.stringify(withExam[1]))
  assert.equal(withExam[1].cmd, 'test -f alpha.txt',
    '(b) [M2] it is `test -f alpha.txt` — included though uncited, because its `cmd` ' +
    'contains the clause\'s backticked literal `alpha.txt`; got ' +
    JSON.stringify(withExam[1].cmd))
  assert.equal(withExam[2].kind, 'run:line',
    '(b) [M2] the third fact is a `run:line` fact; got ' + JSON.stringify(withExam[2]))
  assert.equal(withExam[2].cmd, 'true',
    '(b) [M2] it is `true` — included because it cites `M2`; got ' +
    JSON.stringify(withExam[2].cmd))
  assert.ok(!withExam.some((f) => f.kind === 'run:line' && f.cmd === 'echo unrelated'),
    '(b) [M2] no fact names `echo unrelated` — it neither cites a clause nor contains a ' +
    'clause literal; got ' + JSON.stringify(withExam))

  const withoutExam = facts.observedFacts({
    clauses, hasExam: false, examExit: 0, proofRuns, proofRunClauses, runLines, capBytes: 1e6,
  })
  assert.equal(withoutExam.length, 2,
    '(b) [M2] with `hasExam: false`, the leading exam fact is absent, leaving only the ' +
    'two run-line facts; got length ' + JSON.stringify(withoutExam.length) + ' (' +
    JSON.stringify(withoutExam) + ')')
  assert.equal(withoutExam[0].kind, 'run:line',
    '(b) [M2] with no exam, the first fact is the first included run-line fact, not an ' +
    'exam fact; got ' + JSON.stringify(withoutExam[0]))
  assert.equal(withoutExam[0].cmd, 'test -f alpha.txt',
    '(b) [M2] and it names `test -f alpha.txt`; got ' + JSON.stringify(withoutExam[0].cmd))

  // ════════════════════════════════════════════════════════════════════════
  // (c) [M3] the cap, and the one-argument arity
  // ════════════════════════════════════════════════════════════════════════

  const capBytes = JSON.stringify(withExam.slice(0, 2)).length + 1
  const capped = facts.observedFacts({
    clauses, hasExam: true, examExit: 0, proofRuns, proofRunClauses, runLines, capBytes,
  })
  assert.deepEqual(capped, withExam.slice(0, 2),
    '(c) [M3] with `capBytes` set to the byte length of the first two facts\' ' +
    '`JSON.stringify` plus 1, facts are dropped from the END until the array fits — ' +
    'exactly the first two facts remain; got ' + JSON.stringify(capped))

  assert.equal(facts.observedFacts.length, 1,
    '(c) [M3] `observedFacts` destructures a single object argument — its only inputs ' +
    'are the seven named keys, never a note, worker text or board reading passed ' +
    'alongside; got function arity ' + JSON.stringify(facts.observedFacts.length))
}

console.log('ALL TESTS PASSED')
