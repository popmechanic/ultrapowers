/**
 * fleet/tests/test_factory_judge_pair.mjs — the exam for *the pair readers —
 * Jev says fold, look or chain, and says whether a real patch changes what
 * its consumer assumed*.
 *
 * This file is the Proof's `Test:`, written whole at the path the Proof
 * names. It imports `makeJudge` from `../../factory/judge.mjs` — written for
 * THIS directory, `../../` is the repository root — and reads
 * `factory/questions.json` / `factory/policy.json` directly off disk for the
 * document-shape leg. It never runs another exam, the package suite, the
 * linter or the typecheck; every claim below is proved by importing
 * `factory/judge.mjs` and calling what it exports, or by parsing the two JSON
 * documents it reads.
 *
 * No `COVERED:` block was handed to this exam, so every clause below is
 * proved here; none is skipped as already-established elsewhere.
 *
 * ── what each Machine clause asserts, restated ──────────────────────────────
 *   M1 — `factory/questions.json` gains a set `pair` whose `questions` has
 *        keys exactly `verdict`, `where_producer`, `where_consumer`,
 *        `ordering_matters`, `needs_behaviour`, `changes_consumer`; `verdict`
 *        is `type` `score` with exactly three levels `0`, `1`, `2`; the two
 *        `where_` questions are `type` `choice`; the other three `noul`.
 *        `factory/policy.json` gains `pairs`, `speculate` and `fold`
 *        deep-equal to the three literals the clause names, and
 *        `resolve.union.mode` becomes `live`.
 *   M2 — `readPair(state)` puts `verdict`, the two `where_` questions,
 *        `ordering_matters` and `needs_behaviour` in a single `ask` with that
 *        state — each `where_` question's options being the names of the
 *        state's shared outlines followed by `imports`, `new top-level code`
 *        and `cannot tell` — and resolves `{ verdict, score, where, answers }`
 *        with `verdict` `fold` below the 0/1 midpoint, `chain` at or above the
 *        1/2 midpoint, else `look`, and `where` the two choices.
 *   M3 — `readPairCandidate({ hunks, consumer })` puts `changes_consumer` once
 *        and resolves `{ changes, score }` with `changes` true when the noul
 *        is at or above `policy.pairs.t_changes_consumer.value`.
 *   M4 — when `ask` resolves `null`, rejects, or leaves the question it needs
 *        unanswered, `readPair` resolves `{ verdict: 'look', score: null,
 *        where: null, answers: null }` and `readPairCandidate` resolves
 *        `null`, both after one `log` line beginning `jev:`; the nine readers
 *        the judge answered before are still answered.
 *
 * ── the legs, and where each is answered ────────────────────────────────────
 *   (a) [M1] both JSON documents, parsed and read directly off disk.
 *   (b) [M2] a fake `ask`, the shared-outline state, the four verdict scores.
 *   (c) [M3] a fake `ask` answering `changes_consumer`, at the default policy
 *       threshold and at a copied one.
 *   (d) [M4] a fake `ask` resolving `null`, rejecting, and leaving the needed
 *       answer out, for both readers; the judge's eleven reader names.
 *
 * ── what this exam assumes about the code under test ───────────────────────
 * `makeJudge({ ask, questionsPath, policyPath, log })` returns an object with
 * `readPair` and `readPairCandidate` (plus the nine readers named in the
 * Context). `ask` is called as `ask({ state, questions })`, per every other
 * reader in `factory/judge.mjs`; a `score` answer is either a bare number or
 * `{ score }`, a `choice` answer either a bare string or `{ choice }`. Where a
 * clause names no exact `ask`-call shape for `readPairCandidate` (M3, unlike
 * M2's "in a single ask with that state"), this exam checks only the count
 * (once) and the one question key, not a state shape.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeJudge } from '../../factory/judge.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const QUESTIONS_PATH = path.join(ROOT, 'factory', 'questions.json')
const POLICY_PATH = path.join(ROOT, 'factory', 'policy.json')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'judge-pair-'))
process.on('exit', () => { try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* best effort */ } })

// A fake `ask`: records every `{ state, questions }` argument it was called
// with, and answers whatever the caller configured — resolving, rejecting or
// answering an incomplete object, per scenario.
const fakeAsk = (answerFn) => {
  const calls = []
  return { calls, ask: async (arg) => { calls.push(arg); return answerFn(arg) } }
}

// A `log`: records every line it was called with, as strings.
const recorder = () => {
  const lines = []
  return { lines, log: (line) => { lines.push(String(line)) } }
}

const NINE_READERS = [
  'readTask', 'readLanding', 'gradeFinding', 'readNote', 'readAmendment',
  'readSupervisor', 'readSettled', 'readCovering', 'readGuards',
]

// ════════════════════════════════════════════════════════════════════════════
// (a) [M1] — the two JSON documents
// ════════════════════════════════════════════════════════════════════════════
const questionsDoc = JSON.parse(fs.readFileSync(QUESTIONS_PATH, 'utf8'))
const pairSet = (questionsDoc.sets || {}).pair || {}
const pairQ = pairSet.questions || {}

assert.deepEqual(Object.keys(pairQ).sort(),
  ['changes_consumer', 'needs_behaviour', 'ordering_matters', 'verdict', 'where_consumer', 'where_producer'],
  '[M1] `factory/questions.json` sets.pair.questions has keys exactly `verdict`, `where_producer`, ' +
  '`where_consumer`, `ordering_matters`, `needs_behaviour`, `changes_consumer`: ' +
  JSON.stringify(Object.keys(pairQ)))

assert.equal((pairQ.verdict || {}).type, 'score',
  '[M1] `verdict` is `type` `score`: ' + JSON.stringify(pairQ.verdict))
const verdictLevelKeys = Object.keys((pairQ.verdict || {}).criteria || {}).map(Number).sort((a, b) => a - b)
assert.deepEqual(verdictLevelKeys, [0, 1, 2],
  '[M1] `verdict` has exactly three levels, keyed `0`, `1`, `2`: ' +
  JSON.stringify((pairQ.verdict || {}).criteria))

assert.equal((pairQ.where_producer || {}).type, 'choice',
  '[M1] `where_producer` is `type` `choice`: ' + JSON.stringify(pairQ.where_producer))
assert.equal((pairQ.where_consumer || {}).type, 'choice',
  '[M1] `where_consumer` is `type` `choice`: ' + JSON.stringify(pairQ.where_consumer))
assert.equal((pairQ.ordering_matters || {}).type, 'noul',
  '[M1] `ordering_matters` is `type` `noul`: ' + JSON.stringify(pairQ.ordering_matters))
assert.equal((pairQ.needs_behaviour || {}).type, 'noul',
  '[M1] `needs_behaviour` is `type` `noul`: ' + JSON.stringify(pairQ.needs_behaviour))
assert.equal((pairQ.changes_consumer || {}).type, 'noul',
  '[M1] `changes_consumer` is `type` `noul`: ' + JSON.stringify(pairQ.changes_consumer))

const policyDoc = JSON.parse(fs.readFileSync(POLICY_PATH, 'utf8'))

const WANT_PAIRS = {
  mode: 'live',
  t_changes_consumer: { value: 0.8, n: 0, window: 'none', basis: 'judgment', experiment: true, rollback: 1.01 },
  n: 0, window: 'none', basis: 'judgment', experiment: true, rollback: 'mode = off',
}
assert.deepEqual(policyDoc.pairs, WANT_PAIRS,
  '[M1] `factory/policy.json` gains `pairs` deep-equal to the clause\'s literal: ' +
  JSON.stringify(policyDoc.pairs))

const WANT_SPECULATE = {
  exam_at_zero: true, on_candidate: true, n: 0, window: 'none', basis: 'judgment',
  experiment: true, rollback: 'exam_at_zero = false, on_candidate = false',
}
assert.deepEqual(policyDoc.speculate, WANT_SPECULATE,
  '[M1] `factory/policy.json` gains `speculate` deep-equal to the clause\'s literal: ' +
  JSON.stringify(policyDoc.speculate))

const WANT_FOLD = {
  reverify: {
    enabled: true, max_run: 6, timeout_seconds: 300, n: 0, window: 'none',
    basis: 'judgment', experiment: true, rollback: 'enabled = false',
  },
}
assert.deepEqual(policyDoc.fold, WANT_FOLD,
  '[M1] `factory/policy.json` gains `fold` deep-equal to the clause\'s literal: ' +
  JSON.stringify(policyDoc.fold))

assert.equal(((policyDoc.resolve || {}).union || {}).mode, 'live',
  '[M1] `resolve.union.mode` becomes `live`: ' + JSON.stringify((policyDoc.resolve || {}).union))

// ════════════════════════════════════════════════════════════════════════════
// (b) [M2] — readPair
// ════════════════════════════════════════════════════════════════════════════
// The state a caller hands `readPair`: two tasks and one shared file whose
// outline names `measure` then `foldIn` — the Proof's own fixture.
const STATE = {
  producer: {
    id: 'P', title: 'produce measure', claim: 'do: add `measure`; see: it exports. (derived)',
    machine: 'M1. `measure` is exported.', interfaces: { produces: ['measure(x) -> number'] },
    files: ['shared/util.mjs'], context: 'P builds the shared helper.',
  },
  consumer: {
    id: 'C', title: 'consume measure', claim: 'do: call `measure`; see: it folds in. (derived)',
    machine: 'M1. `foldIn` calls `measure`.', interfaces: { consumes: ['measure(x) -> number'] },
    files: ['shared/util.mjs'], context: 'C folds `measure` into its own pass.',
    legs: ['(a) `foldIn` calls `measure` [M1]'],
  },
  shared: [{
    path: 'shared/util.mjs', exists_at_base: true,
    outline: [{ name: 'measure', kind: 'function' }, { name: 'foldIn', kind: 'function' }],
    producer_hits: 1, consumer_hits: 1,
  }],
  shape: { symbol: 'measure', stated_in_consumer: true },
}
const WANT_OPTIONS = ['measure', 'foldIn', 'imports', 'new top-level code', 'cannot tell']
const FIVE_KEYS = ['verdict', 'where_producer', 'where_consumer', 'ordering_matters', 'needs_behaviour']

const verdictAnswers = (score) => ({
  verdict: { type: 'score', score },
  where_producer: { type: 'choice', choice: 'measure', confidence: 0.9 },
  where_consumer: { type: 'choice', choice: 'foldIn', confidence: 0.9 },
  ordering_matters: { type: 'noul', noul: 0.2 },
  needs_behaviour: { type: 'noul', noul: 0.9 },
})

// score 0.3: below the 0/1 midpoint (0.5) -> fold. This is also the leg that
// checks the call shape and the where_ options, once.
{
  const fake = fakeAsk(async () => verdictAnswers(0.3))
  const judge = makeJudge({ ask: fake.ask, questionsPath: QUESTIONS_PATH, policyPath: POLICY_PATH })
  const result = await judge.readPair(STATE)

  assert.equal(fake.calls.length, 1,
    '[M2] `readPair` puts its questions in A SINGLE `ask` call: ' + JSON.stringify(fake.calls.length))
  const call = fake.calls[0]
  assert.deepEqual(call.state, STATE,
    '[M2] and calls it WITH THAT STATE, unchanged: ' + JSON.stringify(call.state))
  assert.deepEqual(Object.keys(call.questions || {}).sort(), [...FIVE_KEYS].sort(),
    '[M2] the one `ask` carries questions keyed exactly `verdict`, `where_producer`, ' +
    '`where_consumer`, `ordering_matters`, `needs_behaviour`: ' +
    JSON.stringify(Object.keys(call.questions || {})))
  assert.equal(call.questions.verdict.type, 'score',
    '[M2] `verdict` in the call is the score question: ' + JSON.stringify(call.questions.verdict))
  assert.equal(call.questions.ordering_matters.type, 'noul',
    '[M2] `ordering_matters` in the call is a noul question: ' + JSON.stringify(call.questions.ordering_matters))
  assert.equal(call.questions.needs_behaviour.type, 'noul',
    '[M2] `needs_behaviour` in the call is a noul question: ' + JSON.stringify(call.questions.needs_behaviour))
  assert.deepEqual(call.questions.where_producer.options, WANT_OPTIONS,
    '[M2] `where_producer`\'s options deep-equal the state\'s shared outline names ' +
    '(`measure`, `foldIn`) followed by `imports`, `new top-level code`, `cannot tell`: ' +
    JSON.stringify(call.questions.where_producer.options))
  assert.deepEqual(call.questions.where_consumer.options, WANT_OPTIONS,
    '[M2] and `where_consumer`\'s options are the same list: ' +
    JSON.stringify(call.questions.where_consumer.options))

  assert.equal(result.verdict, 'fold',
    '[M2] a score below the 0/1 midpoint (0.3 < 0.5) resolves `verdict` `fold`: ' + JSON.stringify(result))
  assert.equal(result.score, 0.3,
    '[M2] and `score` is the noul Jev answered, 0.3: ' + JSON.stringify(result))
  assert.deepEqual(result.where, { producer: 'measure', consumer: 'foldIn' },
    '[M2] and `where` is `{ producer, consumer }`, the two choices: ' + JSON.stringify(result.where))
  assert.deepEqual(result.answers, verdictAnswers(0.3),
    '[M2] and `answers` is the raw reply `ask` returned: ' + JSON.stringify(result.answers))
}

// The three further verdict readings: 0.5 -> look, 1.49 -> look, 1.5 -> chain.
const verdictOf = async (score) => {
  const fake = fakeAsk(async () => verdictAnswers(score))
  const judge = makeJudge({ ask: fake.ask, questionsPath: QUESTIONS_PATH, policyPath: POLICY_PATH })
  return (await judge.readPair(STATE)).verdict
}
assert.equal(await verdictOf(0.5), 'look',
  '[M2] a score at the 0/1 midpoint (0.5) is neither below it nor at/above the 1/2 midpoint: `look`')
assert.equal(await verdictOf(1.49), 'look',
  '[M2] 1.49 is below the 1/2 midpoint (1.5) and not below the 0/1 one: `look`')
assert.equal(await verdictOf(1.5), 'chain',
  '[M2] a score at or above the 1/2 midpoint (1.5) resolves `verdict` `chain`')

// ════════════════════════════════════════════════════════════════════════════
// (c) [M3] — readPairCandidate
// ════════════════════════════════════════════════════════════════════════════
const HUNKS = [
  'diff --git a/shared/util.mjs b/shared/util.mjs',
  '--- a/shared/util.mjs', '+++ b/shared/util.mjs',
  '@@ -1,1 +1,1 @@',
  '-export const measure = (x) => x',
  '+export const measure = (x, unit) => x * unit',
].join('\n')
const CONSUMER = {
  id: 'C', title: 'consume measure',
  machine: 'M1. `foldIn` calls `measure(x)` with one argument.',
  context: 'C assumes `measure` takes one argument.',
}

const candidateAnswers = (noul) => ({ changes_consumer: { type: 'noul', noul } })

{
  const fake = fakeAsk(async () => candidateAnswers(0.85))
  const judge = makeJudge({ ask: fake.ask, questionsPath: QUESTIONS_PATH, policyPath: POLICY_PATH })
  const result = await judge.readPairCandidate({ hunks: HUNKS, consumer: CONSUMER })

  assert.equal(fake.calls.length, 1,
    '[M3] `readPairCandidate` puts `changes_consumer` in a single `ask` call: ' +
    JSON.stringify(fake.calls.length))
  assert.deepEqual(Object.keys(fake.calls[0].questions || {}), ['changes_consumer'],
    '[M3] and that one call carries exactly the `changes_consumer` question: ' +
    JSON.stringify(Object.keys(fake.calls[0].questions || {})))
  assert.deepEqual(result, { changes: true, score: 0.85 },
    '[M3] a noul (0.85) at or above the default `policy.pairs.t_changes_consumer.value` ' +
    '(0.8) resolves `{ changes: true, score: 0.85 }`: ' + JSON.stringify(result))
}
{
  const fake = fakeAsk(async () => candidateAnswers(0.7))
  const judge = makeJudge({ ask: fake.ask, questionsPath: QUESTIONS_PATH, policyPath: POLICY_PATH })
  const result = await judge.readPairCandidate({ hunks: HUNKS, consumer: CONSUMER })
  assert.deepEqual(result, { changes: false, score: 0.7 },
    '[M3] a noul (0.7) below the default threshold (0.8) resolves `changes: false`: ' +
    JSON.stringify(result))
}
{
  // A copied policy document whose `pairs.t_changes_consumer.value` is 0.6 —
  // the same 0.7 noul now clears the (lower) threshold.
  const copied = JSON.parse(fs.readFileSync(POLICY_PATH, 'utf8'))
  copied.pairs = { ...(copied.pairs || {}), t_changes_consumer: { ...((copied.pairs || {}).t_changes_consumer), value: 0.6 } }
  const copiedPolicyPath = path.join(tmp, 'policy-0.6.json')
  fs.writeFileSync(copiedPolicyPath, JSON.stringify(copied))

  const fake = fakeAsk(async () => candidateAnswers(0.7))
  const judge = makeJudge({ ask: fake.ask, questionsPath: QUESTIONS_PATH, policyPath: copiedPolicyPath })
  const result = await judge.readPairCandidate({ hunks: HUNKS, consumer: CONSUMER })
  assert.deepEqual(result, { changes: true, score: 0.7 },
    '[M3] against a copied policy whose `pairs.t_changes_consumer.value` is 0.6, the same ' +
    '0.7 noul now clears the threshold: `changes: true`: ' + JSON.stringify(result))
}

// ════════════════════════════════════════════════════════════════════════════
// (d) [M4] — a judge that does not answer says look, never fold
// ════════════════════════════════════════════════════════════════════════════
// Three ways `ask` can fail to answer: resolve `null`, reject, or resolve an
// object missing the one answer the reader needs.
const NULL_LOOK = { verdict: 'look', score: null, where: null, answers: null }

const pairFailure = async (askImpl) => {
  const rec = recorder()
  const judge = makeJudge({ ask: askImpl, questionsPath: QUESTIONS_PATH, policyPath: POLICY_PATH, log: rec.log })
  const result = await judge.readPair(STATE)
  return { result, lines: rec.lines, judge }
}
const candidateFailure = async (askImpl) => {
  const rec = recorder()
  const judge = makeJudge({ ask: askImpl, questionsPath: QUESTIONS_PATH, policyPath: POLICY_PATH, log: rec.log })
  const result = await judge.readPairCandidate({ hunks: HUNKS, consumer: CONSUMER })
  return { result, lines: rec.lines, judge }
}
const oneJevLine = (lines, who) => {
  assert.equal(lines.length, 1,
    '[M4] ' + who + ' logs EXACTLY ONE line on a refused call: ' + JSON.stringify(lines))
  assert.ok(lines[0].startsWith('jev:'),
    '[M4] ' + who + '\'s one line begins `jev:`: ' + JSON.stringify(lines[0]))
}

// -- ask resolves null --
{
  const { result, lines } = await pairFailure(async () => null)
  assert.deepEqual(result, NULL_LOOK,
    '[M4] `readPair`, with `ask` resolving `null`, resolves `{ verdict: \'look\', score: null, ' +
    'where: null, answers: null }` — never `fold`: ' + JSON.stringify(result))
  oneJevLine(lines, '`readPair` (ask -> null)')
}
{
  const { result, lines } = await candidateFailure(async () => null)
  assert.equal(result, null,
    '[M4] `readPairCandidate`, with `ask` resolving `null`, resolves `null`: ' + JSON.stringify(result))
  oneJevLine(lines, '`readPairCandidate` (ask -> null)')
}

// -- ask rejects --
{
  const { result, lines } = await pairFailure(async () => { throw new Error('jev is down') })
  assert.deepEqual(result, NULL_LOOK,
    '[M4] `readPair`, with `ask` rejecting, resolves the same `look`/`null` row: ' + JSON.stringify(result))
  oneJevLine(lines, '`readPair` (ask rejects)')
}
{
  const { result, lines } = await candidateFailure(async () => { throw new Error('jev is down') })
  assert.equal(result, null,
    '[M4] `readPairCandidate`, with `ask` rejecting, resolves `null`: ' + JSON.stringify(result))
  oneJevLine(lines, '`readPairCandidate` (ask rejects)')
}

// -- ask leaves the needed answer unanswered --
{
  // `verdict` itself is missing; the other four are answered.
  const incomplete = {
    where_producer: { type: 'choice', choice: 'measure' },
    where_consumer: { type: 'choice', choice: 'foldIn' },
    ordering_matters: { type: 'noul', noul: 0.2 },
    needs_behaviour: { type: 'noul', noul: 0.9 },
  }
  const { result, lines, judge: judgeD } = await pairFailure(async () => incomplete)
  assert.deepEqual(result, NULL_LOOK,
    '[M4] `readPair`, with `verdict` left unanswered, resolves the same `look`/`null` row — ' +
    'never `fold` or `chain`: ' + JSON.stringify(result))
  oneJevLine(lines, '`readPair` (verdict unanswered)')

  // The nine earlier readers, plus the two this task adds, are all still
  // answered on this same judge — a failed pair reading breaks nothing else.
  const keys = Object.keys(judgeD)
  for (const name of NINE_READERS) {
    assert.equal(typeof judgeD[name], 'function',
      '[M4] the object `makeJudge` answers still has `' + name + '` as a function after a ' +
      'refused pair reading: ' + typeof judgeD[name])
  }
  assert.equal(typeof judgeD.readPair, 'function',
    '[M4] and `readPair` itself is a function on that object: ' + typeof judgeD.readPair)
  assert.equal(typeof judgeD.readPairCandidate, 'function',
    '[M4] and so is `readPairCandidate`: ' + typeof judgeD.readPairCandidate)
  assert.deepEqual(keys.sort(), [...NINE_READERS, 'readPair', 'readPairCandidate'].sort(),
    '[M4] and the object carries exactly the nine earlier reader names plus these two, no ' +
    'more and no fewer: ' + JSON.stringify(keys.sort()))
}
{
  // `changes_consumer` itself is missing.
  const { result, lines } = await candidateFailure(async () => ({}))
  assert.equal(result, null,
    '[M4] `readPairCandidate`, with `changes_consumer` left unanswered, resolves `null`: ' +
    JSON.stringify(result))
  oneJevLine(lines, '`readPairCandidate` (changes_consumer unanswered)')
}

console.log('ok — fleet/tests/test_factory_judge_pair.mjs: ' +
  'the pair question set and policy cells (M1), readPair\'s fold/look/chain over a single ' +
  'ask (M2), readPairCandidate\'s changes_consumer threshold (M3), and the look/null a judge ' +
  'that does not answer always gives (M4)')
console.log('ALL TESTS PASSED')
