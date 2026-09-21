/**
 * fleet/tests/test_factory_judge_facts.mjs — the exam for *the judge takes
 * measured facts and settled clauses*: Jev's whole-claim reading is taken
 * twice — as today, and again with the measured facts in front of it — and a
 * clause a command already proved is not put to Jev at all.
 *
 * This file is the Proof's `Test:`, written whole at the path the Proof
 * names. Every relative import is written for THIS directory: `../../` is
 * the repository root, so `../../factory/judge.mjs` is `factory/judge.mjs`.
 *
 * The Machine clauses under test (M5 is proven by the Proof's own `python3`
 * `Run:` line against `factory/questions.json`, not by this file):
 *
 *   M1 — `readLanding({ clauses, patch, files })` with no `facts` and no
 *        `settled` key calls `ask` once with exactly the `state` (`{
 *        clauses, patch, files }`) and exactly the question keys it sends
 *        today — `claim_established` and one `M<i>__f<j>` per (clause, file)
 *        pair — and resolves `{ claim, coverage }` with no other key.
 *   M2 — With `settled: [1, null, 0]` over three clauses and two files, the
 *        questions sent carry no key beginning `M1__` and none beginning
 *        `M3__`, still carry `M2__f0` and `M2__f1`, and the resolved
 *        `coverage` is `[1, <the larger of the two M2 answers>, 0]`.
 *   M3 — With a non-empty `facts` array, the `state` sent also carries
 *        `facts` (that array, unchanged) and the questions also carry
 *        `claim_established_given_facts`; the resolved row carries
 *        `claimGivenFacts` as that answer's number, and `claim` is still the
 *        `claim_established` answer.
 *   M4 — With non-empty `facts` and an `ask` whose answers lack
 *        `claim_established_given_facts`, the row still resolves with
 *        `claimGivenFacts: null` and the same `claim` and `coverage` — a
 *        record-only question never fails the reading.
 *
 * The legs, in the order they run here:
 *
 *   (a) [M1] two clauses, two files, no `facts`/`settled`: the recorded
 *       call's state keys, question keys, and the row's own keys.
 *   (b) [M2] three clauses, two files, `settled: [1, null, 0]`: no `M1__` or
 *       `M3__` key sent, both `M2__` keys sent, `coverage` deep-equals
 *       `[1, 0.7, 0]`.
 *   (c) [M3] one `facts` entry: the sent `state.facts`, the sent
 *       `claim_established_given_facts` question key, and the row's
 *       `claim`/`claimGivenFacts`.
 *   (d) [M4] the same call with `claim_established_given_facts` unanswered:
 *       the row still resolves, `claimGivenFacts` is `null`, `claim` and
 *       `coverage` are unchanged from leg (c).
 *
 * Nothing here opens a socket or spawns a process: `ask` is an in-process
 * recording stub, and `makeJudge` is pointed at a small fixture pair of
 * `questions.json`/`policy.json` written to a temp directory for this run,
 * so the exam does not depend on the exact wording the real
 * `factory/questions.json` carries (that wording, and the new question's
 * shape, is `M5`'s own proof).
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** The deliverable, imported dynamically: a tree without it reports the
 *  ABSENT MODULE as an assertion of leg (a) rather than dying at load with no
 *  leg named at all. */
let judgeModule = null
let judgeImportError = null
try {
  judgeModule = await import('../../factory/judge.mjs')
} catch (error) {
  judgeImportError = error
}
assert.ok(judgeImportError === null,
  '(a) [M1] `factory/judge.mjs` is importable. Got: ' +
  String(judgeImportError && (judgeImportError.message || judgeImportError)))
assert.equal(typeof judgeModule.makeJudge, 'function',
  '(a) [M1] it exports `makeJudge({ ask, questionsPath, policyPath, log })`; got ' +
  JSON.stringify(typeof judgeModule.makeJudge))

// ══════════════════════════════════════════════════════════════════════════
// Fixtures: a minimal questions.json/policy.json, independent of the real
// files' exact wording, carrying only what `readLanding`'s construction and
// pairwise-template filling touch.
// ══════════════════════════════════════════════════════════════════════════

const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'judge-facts-exam-'))
const questionsPath = path.join(fixtureDir, 'questions.json')
const policyPath = path.join(fixtureDir, 'policy.json')

fs.writeFileSync(questionsPath, JSON.stringify({
  sets: {
    landing: {
      questions: {
        claim_established: {
          type: 'noul',
          instructions: { question: 'Does `patch` establish every clause in `clauses`?' },
          criteria: { true: 'yes', false: 'no' },
        },
        claim_established_given_facts: {
          type: 'noul',
          instructions: {
            question: 'Given `patch` and `facts`, is every clause in `clauses` established?',
          },
          criteria: { true: 'yes', false: 'no' },
          note: 'Record-only fixture question.',
        },
      },
      pairwise: {
        type: 'noul',
        instructions: { question: 'Does file `<j>` carry clause `<i>`?' },
        criteria: { true: 'yes', false: 'no' },
      },
    },
  },
}))
fs.writeFileSync(policyPath, JSON.stringify({}))

/** A recording `ask`: every call is pushed to `calls`, and the answer for
 *  each question key it is sent comes from `answerFor(key)` — `undefined`
 *  leaves that key out of the answers object entirely, the shape of a Jev
 *  reply that never mentions a question it was not able to answer. */
const makeAsk = (answerFor) => {
  const calls = []
  const ask = async ({ state, questions }) => {
    calls.push({ state, questions })
    const answers = {}
    for (const key of Object.keys(questions)) {
      const value = answerFor(key)
      if (value !== undefined) answers[key] = value
    }
    return answers
  }
  return { ask, calls }
}

const sorted = (arr) => [...arr].sort()

// ══════════════════════════════════════════════════════════════════════════
// (a) [M1] two clauses, two files, no `facts`/`settled` — today's shape
// ══════════════════════════════════════════════════════════════════════════

{
  const { ask, calls } = makeAsk(() => 0.5)
  const judge = judgeModule.makeJudge({ ask, questionsPath, policyPath })

  const row = await judge.readLanding({
    clauses: ['clause zero', 'clause one'],
    patch: 'diff --git a/x b/x',
    files: { f0: 'diff for f0', f1: 'diff for f1' },
  })

  assert.equal(calls.length, 1,
    '(a) [M1] `readLanding` calls `ask` exactly once; got ' + calls.length + ' calls')

  const { state, questions } = calls[0]
  assert.deepEqual(sorted(Object.keys(state)), ['clauses', 'files', 'patch'],
    '(a) [M1] the sent `state` carries exactly `{ clauses, patch, files }`; got keys ' +
    JSON.stringify(sorted(Object.keys(state))))

  assert.deepEqual(sorted(Object.keys(questions)),
    ['M1__f0', 'M1__f1', 'M2__f0', 'M2__f1', 'claim_established'],
    '(a) [M1] the sent questions are `claim_established` and one `M<i>__f<j>` per ' +
    '(clause, file) pair, clauses counted from M1 and files from f0; got keys ' +
    JSON.stringify(sorted(Object.keys(questions))))

  assert.ok(row !== null, '(a) [M1] a fully-answered call resolves a row, not null')
  assert.deepEqual(sorted(Object.keys(row)), ['claim', 'coverage'],
    '(a) [M1] the resolved row is `{ claim, coverage }` with no other key; got keys ' +
    JSON.stringify(sorted(Object.keys(row))))
  assert.equal(row.claim, 0.5,
    '(a) [M1] `claim` is the `claim_established` answer; got ' + JSON.stringify(row.claim))
  assert.deepEqual(row.coverage, [0.5, 0.5],
    '(a) [M1] `coverage[i]` is the best of clause i\'s pairwise answers; got ' +
    JSON.stringify(row.coverage))
}

// ══════════════════════════════════════════════════════════════════════════
// (b) [M2] three clauses, two files, settled: [1, null, 0]
// ══════════════════════════════════════════════════════════════════════════

{
  const { ask, calls } = makeAsk((key) => {
    if (key === 'claim_established') return 0.6
    if (key === 'M2__f0') return 0.2
    if (key === 'M2__f1') return 0.7
    return undefined
  })
  const judge = judgeModule.makeJudge({ ask, questionsPath, policyPath })

  const row = await judge.readLanding({
    clauses: ['clause zero', 'clause one', 'clause two'],
    patch: 'diff --git a/x b/x',
    files: { f0: 'diff for f0', f1: 'diff for f1' },
    settled: [1, null, 0],
  })

  assert.equal(calls.length, 1, '(b) [M2] `readLanding` calls `ask` exactly once')
  const sentKeys = Object.keys(calls[0].questions)

  assert.ok(!sentKeys.some((k) => k.startsWith('M1__')),
    '(b) [M2] a settled clause (M1, settled 1) sends none of its pairwise questions; ' +
    'sent keys were ' + JSON.stringify(sorted(sentKeys)))
  assert.ok(!sentKeys.some((k) => k.startsWith('M3__')),
    '(b) [M2] a settled clause (M3, settled 0) sends none of its pairwise questions; ' +
    'sent keys were ' + JSON.stringify(sorted(sentKeys)))
  assert.ok(sentKeys.includes('M2__f0') && sentKeys.includes('M2__f1'),
    '(b) [M2] the unsettled clause (M2, settled null) still sends both its pairwise ' +
    'questions; sent keys were ' + JSON.stringify(sorted(sentKeys)))

  assert.ok(row !== null, '(b) [M2] a fully-answered call resolves a row, not null')
  assert.deepEqual(row.coverage, [1, 0.7, 0],
    '(b) [M2] `coverage` is the settled entries verbatim at their index and the larger ' +
    'of the two M2 pairwise answers at index 1; got ' + JSON.stringify(row.coverage))
}

// ══════════════════════════════════════════════════════════════════════════
// (c) [M3] a non-empty `facts` array
// ══════════════════════════════════════════════════════════════════════════

const FACTS = [{ kind: 'exam', exit: 0 }]

{
  const { ask, calls } = makeAsk((key) => {
    if (key === 'claim_established') return 0.3
    if (key === 'claim_established_given_facts') return 0.9
    if (key === 'M1__f0') return 0.9
    return undefined
  })
  const judge = judgeModule.makeJudge({ ask, questionsPath, policyPath })

  const row = await judge.readLanding({
    clauses: ['clause zero'],
    patch: 'diff --git a/x b/x',
    files: { f0: 'diff for f0' },
    facts: FACTS,
  })

  assert.equal(calls.length, 1, '(c) [M3] `readLanding` calls `ask` exactly once')
  const { state, questions } = calls[0]

  assert.deepEqual(state.facts, FACTS,
    '(c) [M3] the sent `state` also carries `facts`, that array unchanged; got ' +
    JSON.stringify(state.facts))
  assert.ok(Object.keys(questions).includes('claim_established_given_facts'),
    '(c) [M3] the sent questions also carry `claim_established_given_facts`; sent keys ' +
    'were ' + JSON.stringify(sorted(Object.keys(questions))))

  assert.ok(row !== null, '(c) [M3] a fully-answered call resolves a row, not null')
  assert.equal(row.claim, 0.3,
    '(c) [M3] `claim` is still the `claim_established` answer; got ' + JSON.stringify(row.claim))
  assert.equal(row.claimGivenFacts, 0.9,
    '(c) [M3] the row carries `claimGivenFacts` as the new question\'s answer; got ' +
    JSON.stringify(row.claimGivenFacts))
  assert.deepEqual(row.coverage, [0.9],
    '(c) [M3] `coverage` still resolves from the pairwise answers; got ' +
    JSON.stringify(row.coverage))
}

// ══════════════════════════════════════════════════════════════════════════
// (d) [M4] the same call, but `ask` never answers `claim_established_given_facts`
// ══════════════════════════════════════════════════════════════════════════

{
  const { ask, calls } = makeAsk((key) => {
    if (key === 'claim_established') return 0.3
    if (key === 'M1__f0') return 0.9
    return undefined // claim_established_given_facts is asked, but never answered
  })
  const judge = judgeModule.makeJudge({ ask, questionsPath, policyPath })

  const row = await judge.readLanding({
    clauses: ['clause zero'],
    patch: 'diff --git a/x b/x',
    files: { f0: 'diff for f0' },
    facts: FACTS,
  })

  assert.equal(calls.length, 1, '(d) [M4] `readLanding` calls `ask` exactly once')
  assert.ok(row !== null,
    '(d) [M4] a missing answer to the record-only `claim_established_given_facts` ' +
    'question does not fail the reading; got row === null')
  assert.equal(row.claimGivenFacts, null,
    '(d) [M4] with no answer for the new question, `claimGivenFacts` is `null`; got ' +
    JSON.stringify(row.claimGivenFacts))
  assert.equal(row.claim, 0.3,
    '(d) [M4] `claim` is unchanged from leg (c) — still the `claim_established` answer; ' +
    'got ' + JSON.stringify(row.claim))
  assert.deepEqual(row.coverage, [0.9],
    '(d) [M4] `coverage` is unchanged from leg (c); got ' + JSON.stringify(row.coverage))
}

console.log('test_factory_judge_facts.mjs: all assertions passed')
