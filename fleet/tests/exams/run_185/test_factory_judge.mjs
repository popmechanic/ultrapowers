/**
 * fleet/tests/exams/run_185/test_factory_judge.mjs — the exam for Task 2: *the
 * judge — every question read from the file, every threshold read from the
 * policy*.
 *
 * This is the Proof's `Test:` file (`fleet/tests/test_factory_judge.mjs`),
 * written at the landing path the run's `EXAM PATHS` line names. Every path in
 * it is written for THIS directory: four levels up is the repository root, so
 * `../../../../factory/judge.mjs` is the deliverable and `factory/questions.json`
 * and `factory/policy.json` are read off the root at test time.
 *
 * Nothing here opens a socket and nothing here reaches the real edge: `ask` is
 * `fleet/jev-client.mjs`'s `{ state, questions } -> answers | null`, and the
 * judge is a reader OVER it, so every call below is answered by a recording
 * fake. No credential is read, constructed or expected.
 *
 * NO THRESHOLD IS A LITERAL IN THIS FILE EITHER. Every number a vector below is
 * built from is read out of `factory/policy.json` at test time and moved by one
 * hundredth; the same file the judge must read is the file this exam grades it
 * against.
 *
 * The Machine clauses under test, restated so a reader can map each assertion
 * back to the contract:
 *
 *   M1 — `makeJudge({ ask, questionsPath, policyPath, log })` reads both JSON
 *        files, and `readLanding({ clauses, patch, files })` calls `ask` ONCE
 *        with `state` carrying those three keys and `questions` whose keys are
 *        exactly `claim_established` plus one `M<i>__f<j>` per (clause, file)
 *        pair, each pair question built from `sets.landing.pairwise` with `<i>`
 *        and `<j>` substituted, and resolves `{ claim, coverage }` where
 *        `claim` is the `claim_established` noul and `coverage[i]` is the
 *        maximum `M<i+1>__f<j>` noul over `j`.
 *   M2 — `gradeFinding({ task, finding, hunks, siblingFacts })` calls `ask`
 *        ONCE with `sets.landing.questions` minus `claim_established`, and
 *        resolves `'blocking'` exactly when `borne_out >= t1_borne_out.value`,
 *        `claim_false >= t2_claim_false.value`, `actor.choice === 'implementer'`,
 *        `fixable_in_files >= t3_fixable_in_files.value`, `process_only <
 *        t4_process_only.value`, and not (`status.choice === 'unverified'` with
 *        `status.confidence >= t_status_unverified.value`); `'plan'` when not
 *        blocking and `actor.choice === 'plan'` with `actor.confidence >=
 *        t5_actor_plan.value` and `fixable_in_files < t5_fixable_guard.value`;
 *        `'minor'` otherwise — every one of those seven numbers read from
 *        `policy.landing.severity` and none a literal in `factory/judge.mjs`.
 *   M3 — `readTask({ title, body })` puts `sets.task.questions` and resolves
 *        `{ k, referee, answers }`, `k` 2 exactly when `difficulty.score >=
 *        policy.task.k.difficulty_rung` or `design_open >=
 *        policy.task.k.design_open`, else 1; `referee` true exactly when
 *        `review_difficulty.score >= policy.task.referee.review_difficulty_rung`.
 *   M4 — `readNote`, `readAmendment` and `readSupervisor` each put their set's
 *        questions once and resolve the flat answers object; and every reader —
 *        all six — resolves `null` when `ask` resolves `null`, rejects, or
 *        answers without a key the reader needs, calling `log` once with a
 *        string beginning `jev:` on that lane.
 *   M5 — `factory/judge.mjs` is 200 lines or fewer.
 *
 * The Proof's legs, and where each is answered below:
 *
 *   (a) [M1] one `ask` from `readLanding`, its five question keys, the
 *            substituted `M2__f1` text, and `claim` 0.9 / `coverage`
 *            `[0.8, 0.5]`.
 *   (b) [M2] the blocking vector, the two `unverified` lanes, and each of the
 *            five conjuncts moved alone.
 *   (c) [M2] the plan route and its two refusals.
 *   (d) [M2] no `0\.[0-9]` in the source of `factory/judge.mjs`.
 *   (e) [M3] the three `k` vectors and the four `referee` vectors.
 *   (f) [M4] six readers x three silent lanes: `null`, and one `jev:` line.
 *   (g) [M1][M2][M3][M4] the question object and the state keys of each call,
 *            and what the three flat readers resolve.
 *   (h) [M5] the line count of `factory/judge.mjs`.
 *
 * Two readings this exam takes where a leg leaves a spelling open, recorded on
 * the task's issue as well:
 *
 *   - Answers are the shapes the replay recorded, which the Context spells:
 *     `{ type: 'noul', noul }`, `{ type: 'choice', choice, confidence,
 *     probabilities }`, `{ type: 'score', score }`. M1's "the
 *     `claim_established` noul" and M2's `actor.choice` / `status.confidence`
 *     read those objects, so the fakes answer objects and never bare numbers.
 *   - Leg (g) says `readNote`, `readAmendment` and `readSupervisor` resolve an
 *     object "deep-equal to the answers the fake `ask` returned": the answers
 *     object is passed through, not flattened into numbers the way
 *     `fleet/jev-questions.mjs` flattens its own. M4's word "flat" reads as
 *     "the answers object itself", against `readTask`'s `{ k, referee, answers }`
 *     and `readLanding`'s `{ claim, coverage }`.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
// This file lands at `fleet/tests/exams/run_185/`, so four levels up is the
// repository root — the directory `factory/` and `fleet/` sit in.
const ROOT = path.resolve(HERE, '..', '..', '..', '..')
const QUESTIONS_PATH = path.join(ROOT, 'factory', 'questions.json')
const POLICY_PATH = path.join(ROOT, 'factory', 'policy.json')
const JUDGE_PATH = path.join(ROOT, 'factory', 'judge.mjs')

// ══════════════════════════════════════════════════════════════════════════
// Sim preconditions: the two inputs the Context pins, read here exactly as the
// judge must read them. A failure in this block is a defect in the exam's own
// footing, not in the deliverable, and says so.
// ══════════════════════════════════════════════════════════════════════════

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'))

assert.ok(fs.existsSync(QUESTIONS_PATH),
  'sim precondition: `factory/questions.json` is at BASE — the Stale-if names it')
assert.ok(fs.existsSync(POLICY_PATH),
  'sim precondition: `factory/policy.json` is at BASE — the Stale-if names it')

const QUESTIONS = readJson(QUESTIONS_PATH)
const POLICY = readJson(POLICY_PATH)
const SETS = QUESTIONS.sets
const PAIRWISE = SETS.landing.pairwise

for (const name of ['task', 'landing', 'note', 'amendment', 'supervisor']) {
  assert.equal(typeof SETS?.[name]?.questions, 'object',
    'sim precondition: `sets.' + name + '.questions` is an object in `factory/questions.json`')
}
assert.ok(typeof PAIRWISE?.instructions?.question === 'string' &&
  PAIRWISE.instructions.question.includes('<i>') && PAIRWISE.instructions.question.includes('<j>'),
  'sim precondition: `sets.landing.pairwise.instructions.question` carries the literal ' +
  '`<i>` and `<j>` tokens the judge substitutes')
assert.equal(PAIRWISE.type, 'noul',
  'sim precondition: `sets.landing.pairwise.type` is `noul`')

/** One `policy.landing.severity` threshold, read at test time. */
const sev = (key) => {
  const value = POLICY?.landing?.severity?.[key]?.value
  assert.equal(typeof value, 'number',
    'sim precondition: `policy.landing.severity.' + key + '.value` is a number in ' +
    '`factory/policy.json`; got ' + JSON.stringify(value))
  return value
}

const T1 = sev('t1_borne_out')
const T2 = sev('t2_claim_false')
const T3 = sev('t3_fixable_in_files')
const T4 = sev('t4_process_only')
const T_STATUS = sev('t_status_unverified')
const T5 = sev('t5_actor_plan')
const T5_GUARD = sev('t5_fixable_guard')

const DIFFICULTY_RUNG = POLICY?.task?.k?.difficulty_rung
const DESIGN_OPEN = POLICY?.task?.k?.design_open
const REVIEW_RUNG = POLICY?.task?.referee?.review_difficulty_rung
for (const [what, value] of [['task.k.difficulty_rung', DIFFICULTY_RUNG],
  ['task.k.design_open', DESIGN_OPEN], ['task.referee.review_difficulty_rung', REVIEW_RUNG]]) {
  assert.equal(typeof value, 'number',
    'sim precondition: `policy.' + what + '` is a number in `factory/policy.json`; got ' +
    JSON.stringify(value))
}

/** One hundredth above / below a policy value, rounded so the arithmetic of the
 *  move cannot decide a comparison the leg means to pin. */
const round = (v) => Number(v.toFixed(4))
const up = (v) => round(v + 0.01)
const down = (v) => round(v - 0.01)

// ══════════════════════════════════════════════════════════════════════════
// The deliverable, imported dynamically: a tree without it reports the ABSENT
// MODULE as a named assertion rather than dying at load with no leg named.
// ══════════════════════════════════════════════════════════════════════════

let mod = null
let modImportError = null
try {
  mod = await import('../../../../factory/judge.mjs')
} catch (error) {
  modImportError = error
}
assert.ok(modImportError === null,
  '(a) [M1] `factory/judge.mjs` is importable — the module this task creates. Got: ' +
  String(modImportError && (modImportError.message || modImportError)))

const { makeJudge } = mod
assert.equal(typeof makeJudge, 'function',
  '(a) [M1] `factory/judge.mjs` exports `makeJudge({ ask, questionsPath, policyPath, log })`; ' +
  'got ' + JSON.stringify(typeof makeJudge))

/** The six readers `makeJudge` produces, in the order the Interfaces line
 *  spells them. */
const READERS = ['readTask', 'readLanding', 'gradeFinding', 'readNote', 'readAmendment',
  'readSupervisor']

/** A judge over one fake `ask` and one `log`, with the two real JSON paths. */
const judgeWith = (ask, log = () => {}) => {
  const judge = makeJudge({ ask, questionsPath: QUESTIONS_PATH, policyPath: POLICY_PATH, log })
  assert.ok(judge && typeof judge === 'object',
    '(g) [M1] `makeJudge({ ask, questionsPath, policyPath, log })` returns the readers object; ' +
    'got ' + JSON.stringify(judge))
  for (const name of READERS) {
    assert.equal(typeof judge[name], 'function',
      '(g) [M1] the object `makeJudge` returns carries `' + name + '` — the Produces line names ' +
      'all six of { ' + READERS.join(', ') + ' }; got ' + JSON.stringify(typeof judge[name]))
  }
  return judge
}

/** A fake `ask` that records every `{ state, questions }` it is handed and
 *  answers a canned answers object (or one computed from the call). */
const recording = (answer) => {
  const calls = []
  const ask = async (arg) => {
    calls.push(arg)
    return typeof answer === 'function' ? answer(arg) : answer
  }
  return { calls, ask }
}

// The three answer shapes the replay recorded, as the Context spells them.
const noul = (v) => ({ type: 'noul', noul: v })
const score = (v) => ({ type: 'score', score: v })
const pick = (name, confidence, alternatives = []) => {
  const rest = alternatives.filter((a) => a !== name)
  const probabilities = { [name]: confidence }
  const share = rest.length ? round((1 - confidence) / rest.length) : 0
  for (const a of rest) probabilities[a] = share
  return { type: 'choice', choice: name, confidence, probabilities }
}
/** A choice's own options, read off the question file rather than spelled here. */
const optionsOf = (set, question) => Object.keys(SETS[set].questions[question].criteria)

// ══════════════════════════════════════════════════════════════════════════
// (a) [M1] `readLanding` — one call, the pair questions, the two numbers back
// ══════════════════════════════════════════════════════════════════════════

const LANDING_STATE = { clauses: ['c1', 'c2'], patch: 'p', files: { f0: 'a', f1: 'b' } }

// Answered BY KEY, not by position: `coverage[i]` is the maximum over `j`, and
// the leg's expected `[0.8, 0.5]` is what these four keys produce.
const LANDING_ANSWERS = {
  claim_established: noul(0.9),
  M1__f0: noul(0.2),
  M1__f1: noul(0.8),
  M2__f0: noul(0.5),
  M2__f1: noul(0.1),
}

const landingFake = recording(LANDING_ANSWERS)
const landing = await judgeWith(landingFake.ask).readLanding(LANDING_STATE)

assert.equal(landingFake.calls.length, 1,
  '(a) [M1] `readLanding({ clauses, patch, files })` calls `ask` exactly ONCE; it was called ' +
  landingFake.calls.length + ' time(s)')

const landingCall = landingFake.calls[0]
assert.ok(landingCall && typeof landingCall === 'object' &&
  landingCall.questions && typeof landingCall.questions === 'object',
  '(a) [M1] the `readLanding` call is `{ state, questions }` with a `questions` object; got ' +
  JSON.stringify(landingCall))

assert.deepStrictEqual(Object.keys(landingCall.questions).sort(),
  ['M1__f0', 'M1__f1', 'M2__f0', 'M2__f1', 'claim_established'],
  '(a) [M1] the `questions` keys are EXACTLY `claim_established` plus one `M<i>__f<j>` per ' +
  '(clause, file) pair — two clauses and two files make four pairs. Got: ' +
  JSON.stringify(Object.keys(landingCall.questions).sort()))

const pairQuestion = landingCall.questions.M2__f1
assert.ok(pairQuestion && typeof pairQuestion?.instructions?.question === 'string',
  '(a) [M1] `M2__f1` is a question built from `sets.landing.pairwise`, carrying ' +
  '`instructions.question`; got ' + JSON.stringify(pairQuestion))
assert.equal(pairQuestion.type, 'noul',
  '(a) [M1] `M2__f1.type` is `noul`, the type `sets.landing.pairwise` carries; got ' +
  JSON.stringify(pairQuestion.type))
assert.equal(pairQuestion.instructions.question.includes('files.f1'), true,
  '(a) [M1] `M2__f1.instructions.question` contains `files.f1` — `<j>` substituted. Got: ' +
  JSON.stringify(pairQuestion.instructions.question))
assert.equal(pairQuestion.instructions.question.includes('clauses[1]'), true,
  '(a) [M1] `M2__f1.instructions.question` contains `clauses[1]` — `<i>` substituted. Got: ' +
  JSON.stringify(pairQuestion.instructions.question))
assert.equal(pairQuestion.instructions.question.includes('<i>'), false,
  '(a) [M1] `M2__f1.instructions.question` carries no leftover `<i>` token. Got: ' +
  JSON.stringify(pairQuestion.instructions.question))
assert.equal(pairQuestion.instructions.question.includes('<j>'), false,
  '(a) [M1] `M2__f1.instructions.question` carries no leftover `<j>` token. Got: ' +
  JSON.stringify(pairQuestion.instructions.question))

for (const key of ['M1__f0', 'M1__f1', 'M2__f0', 'M2__f1']) {
  const text = landingCall.questions[key]?.instructions?.question
  assert.equal(typeof text === 'string' && !text.includes('<i>') && !text.includes('<j>'), true,
    '(a) [M1] `' + key + '` is built from `sets.landing.pairwise` with `<i>` and `<j>` ' +
    'SUBSTITUTED — no token survives into the question put to Jev. Got: ' + JSON.stringify(text))
}

assert.ok(landing && typeof landing === 'object',
  '(a) [M1] `readLanding` resolves `{ claim, coverage }`; got ' + JSON.stringify(landing))
assert.strictEqual(landing.claim, 0.9,
  '(a) [M1] `claim` is the `claim_established` noul, answered 0.9; got ' +
  JSON.stringify(landing.claim))
assert.deepStrictEqual(landing.coverage, [0.8, 0.5],
  '(a) [M1] `coverage[i]` is the MAXIMUM `M<i+1>__f<j>` noul over `j` — max(0.2, 0.8) then ' +
  'max(0.5, 0.1). Got: ' + JSON.stringify(landing.coverage))

// (g) [M1] the same call's `state` carries the three keys `readLanding` was given.
assert.deepStrictEqual(Object.keys(landingCall.state ?? {}).sort(), ['clauses', 'files', 'patch'],
  '(g) [M1] the `readLanding` call\'s `state` has keys exactly `clauses`, `patch`, `files`. ' +
  'Got: ' + JSON.stringify(Object.keys(landingCall.state ?? {}).sort()))

// ══════════════════════════════════════════════════════════════════════════
// (b) (c) [M2] `gradeFinding` — the severity rule, one conjunct at a time
// ══════════════════════════════════════════════════════════════════════════

const FINDING_ARGS = {
  task: { claim: 'the claim', machine: 'M1 ...', files: ['factory/judge.mjs'] },
  finding: { text: 'the finding' },
  hunks: '--- a/factory/judge.mjs\n+++ b/factory/judge.mjs\n@@\n+line\n',
  siblingFacts: [],
}

const actorAnswer = (name, confidence) => pick(name, confidence, optionsOf('landing', 'actor'))
const statusAnswer = (name, confidence) => pick(name, confidence, optionsOf('landing', 'status'))

/**
 * The blocking vector of leg (b): `borne_out`, `claim_false` and
 * `fixable_in_files` each one hundredth ABOVE their thresholds, `process_only`
 * one hundredth BELOW `t4`, `actor` `implementer`, `status` `verified` — with
 * one conjunct moved by `over`.
 *
 * `settled_by_fact` is answered `no_fact` throughout: it is a `choice`, it is
 * not one of M2's six conjuncts, and `no_fact` is the answer that cannot
 * promote a vector this leg says is minor.
 */
const findingAnswers = (over = {}) => ({
  borne_out: noul(up(T1)),
  actor: actorAnswer('implementer', 0.99),
  claim_false: noul(up(T2)),
  fixable_in_files: noul(up(T3)),
  defect_visible: noul(0.95),
  status: statusAnswer('verified', 0.95),
  subject: pick('implementation', 0.9, optionsOf('landing', 'subject')),
  process_only: noul(down(T4)),
  scope_only: noul(0.05),
  settled_by_fact: pick('no_fact', 0.9, optionsOf('landing', 'settled_by_fact')),
  ...over,
})

/** One grading, with its own fake, so every vector is a fresh single call. */
const grade = async (over) => {
  const fake = recording(findingAnswers(over))
  const out = await judgeWith(fake.ask).gradeFinding(FINDING_ARGS)
  return { out, fake }
}

const blocking = await grade({})
assert.strictEqual(blocking.out, 'blocking',
  '(b) [M2] the blocking vector — borne_out, claim_false, fixable_in_files each one hundredth ' +
  'above t1/t2/t3, process_only one hundredth below t4, actor `implementer`, status ' +
  '`verified` — resolves `blocking`. Got: ' + JSON.stringify(blocking.out))

const unverifiedHigh = await grade({ status: statusAnswer('unverified', up(T_STATUS)) })
assert.strictEqual(unverifiedHigh.out, 'minor',
  '(b) [M2] the same vector with `status` `unverified` at confidence one hundredth ABOVE ' +
  't_status_unverified resolves `minor` — the NOT(...) conjunct fires. Got: ' +
  JSON.stringify(unverifiedHigh.out))

const unverifiedLow = await grade({ status: statusAnswer('unverified', down(T_STATUS)) })
assert.strictEqual(unverifiedLow.out, 'blocking',
  '(b) [M2] the same vector with `status` `unverified` at confidence one hundredth BELOW ' +
  't_status_unverified resolves `blocking` — an unverified below the threshold does not ' +
  'demote. Got: ' + JSON.stringify(unverifiedLow.out))

const conjunctsMovedAlone = [
  ['borne_out one hundredth below t1_borne_out', { borne_out: noul(down(T1)) }],
  ['claim_false one hundredth below t2_claim_false', { claim_false: noul(down(T2)) }],
  ['fixable_in_files one hundredth below t3_fixable_in_files',
    { fixable_in_files: noul(down(T3)) }],
  ['process_only one hundredth above t4_process_only', { process_only: noul(up(T4)) }],
  ['actor `nobody`', { actor: actorAnswer('nobody', 0.99) }],
]
for (const [what, over] of conjunctsMovedAlone) {
  const moved = await grade(over)
  assert.strictEqual(moved.out, 'minor',
    '(b) [M2] the blocking vector with ' + what + ' — that one conjunct moved ALONE — resolves ' +
    '`minor`. Got: ' + JSON.stringify(moved.out))
}

const planRoute = await grade({
  actor: actorAnswer('plan', up(T5)),
  fixable_in_files: noul(down(T5_GUARD)),
})
assert.strictEqual(planRoute.out, 'plan',
  '(c) [M2] `actor` `plan` at confidence one hundredth above t5_actor_plan with ' +
  '`fixable_in_files` one hundredth below t5_fixable_guard resolves `plan`. Got: ' +
  JSON.stringify(planRoute.out))

const planGuarded = await grade({
  actor: actorAnswer('plan', up(T5)),
  fixable_in_files: noul(up(T5_GUARD)),
})
assert.strictEqual(planGuarded.out, 'minor',
  '(c) [M2] the same with `fixable_in_files` one hundredth ABOVE t5_fixable_guard resolves ' +
  '`minor` — the guard refuses a plan route the answer contradicts. Got: ' +
  JSON.stringify(planGuarded.out))

const planUnderConfident = await grade({
  actor: actorAnswer('plan', down(T5)),
  fixable_in_files: noul(down(T5_GUARD)),
})
assert.strictEqual(planUnderConfident.out, 'minor',
  '(c) [M2] the same with `actor` `plan` at confidence one hundredth BELOW t5_actor_plan ' +
  'resolves `minor`. Got: ' + JSON.stringify(planUnderConfident.out))

// (g) [M2] the blocking vector's own call: one `ask`, the landing questions
// minus `claim_established`, and the four state keys.
assert.equal(blocking.fake.calls.length, 1,
  '(g) [M2] `gradeFinding` makes exactly ONE `ask` call; it made ' +
  blocking.fake.calls.length)

const gradeCall = blocking.fake.calls[0]
const WANT_FINDING_QUESTIONS = { ...SETS.landing.questions }
delete WANT_FINDING_QUESTIONS.claim_established
assert.deepStrictEqual(gradeCall.questions, WANT_FINDING_QUESTIONS,
  '(g) [M2] the `gradeFinding` call\'s `questions` is deep-equal to `sets.landing.questions` of ' +
  '`factory/questions.json` with the `claim_established` key REMOVED — a reworded question is a ' +
  'different question. Got keys: ' + JSON.stringify(Object.keys(gradeCall.questions ?? {})))
assert.deepStrictEqual(Object.keys(gradeCall.state ?? {}).sort(),
  ['finding', 'hunks', 'sibling_facts', 'task'],
  '(g) [M2] the `gradeFinding` call\'s `state` has keys exactly `task`, `finding`, `hunks`, ' +
  '`sibling_facts`. Got: ' + JSON.stringify(Object.keys(gradeCall.state ?? {}).sort()))

// ══════════════════════════════════════════════════════════════════════════
// (d) [M2] not one threshold is a literal in `factory/judge.mjs`
// ══════════════════════════════════════════════════════════════════════════

assert.ok(fs.existsSync(JUDGE_PATH),
  '(d) [M2] `factory/judge.mjs` exists to be read — the file this task creates')
const JUDGE_SRC = fs.readFileSync(JUDGE_PATH, 'utf8')

const literalLines = JUDGE_SRC.split('\n')
  .map((line, i) => [i + 1, line])
  .filter(([, line]) => /0\.[0-9]/.test(line))
assert.equal(literalLines.length, 0,
  '(d) [M2] the source of `factory/judge.mjs` contains NO numeric literal matching ' +
  '`0\\.[0-9]` — every number the judge compares against is read from `factory/policy.json`. ' +
  'Lines that match: ' + JSON.stringify(literalLines))

// ══════════════════════════════════════════════════════════════════════════
// (e) [M3] `readTask` — `k` off the two rungs, `referee` off its own
// ══════════════════════════════════════════════════════════════════════════

const taskAnswers = (over = {}) => ({
  difficulty: score(0),
  lifecycle_or_concurrency: noul(0.2),
  design_open: noul(0),
  review_difficulty: score(0),
  doc_or_prose_only: noul(0),
  ...over,
})

const readTaskWith = async (over) => {
  const fake = recording(taskAnswers(over))
  const out = await judgeWith(fake.ask).readTask({ title: 'Task 2: the judge', body: 'the body' })
  assert.ok(out && typeof out === 'object',
    '(e) [M3] `readTask({ title, body })` resolves `{ k, referee, answers }`; got ' +
    JSON.stringify(out))
  return { out, fake }
}

const kOnDifficulty = await readTaskWith({
  difficulty: score(DIFFICULTY_RUNG),
  design_open: noul(0),
})
assert.strictEqual(kOnDifficulty.out.k, 2,
  '(e) [M3] `difficulty.score` EQUAL to `policy.task.k.difficulty_rung` with `design_open` 0 ' +
  'resolves `k` 2. Got: ' + JSON.stringify(kOnDifficulty.out.k))

const kOnDesignOpen = await readTaskWith({
  difficulty: score(DIFFICULTY_RUNG - 1),
  design_open: noul(DESIGN_OPEN),
})
assert.strictEqual(kOnDesignOpen.out.k, 2,
  '(e) [M3] `difficulty.score` one BELOW the rung with `design_open` EQUAL to ' +
  '`policy.task.k.design_open` resolves `k` 2 — the rule is an OR. Got: ' +
  JSON.stringify(kOnDesignOpen.out.k))

const kNeither = await readTaskWith({
  difficulty: score(DIFFICULTY_RUNG - 1),
  design_open: noul(down(DESIGN_OPEN)),
})
assert.strictEqual(kNeither.out.k, 1,
  '(e) [M3] `difficulty.score` one below the rung with `design_open` one hundredth below ' +
  '`policy.task.k.design_open` resolves `k` 1. Got: ' + JSON.stringify(kNeither.out.k))

for (const doc of [0, 1]) {
  const refereeOn = await readTaskWith({
    review_difficulty: score(REVIEW_RUNG),
    doc_or_prose_only: noul(doc),
  })
  assert.strictEqual(refereeOn.out.referee, true,
    '(e) [M3] `review_difficulty.score` EQUAL to `review_difficulty_rung` resolves `referee` ' +
    'true, whatever `doc_or_prose_only` answers (here ' + doc + '). Got: ' +
    JSON.stringify(refereeOn.out.referee))

  const refereeOff = await readTaskWith({
    review_difficulty: score(REVIEW_RUNG - 1),
    doc_or_prose_only: noul(doc),
  })
  assert.strictEqual(refereeOff.out.referee, false,
    '(e) [M3] `review_difficulty.score` one BELOW the rung resolves `referee` false, whatever ' +
    '`doc_or_prose_only` answers (here ' + doc + ') — `doc_or_prose_only` gates nothing. Got: ' +
    JSON.stringify(refereeOff.out.referee))
}

// (g) [M3] `readTask`'s own call and what it carries out.
assert.equal(kOnDifficulty.fake.calls.length, 1,
  '(g) [M3] `readTask` makes exactly ONE `ask` call; it made ' + kOnDifficulty.fake.calls.length)
assert.deepStrictEqual(kOnDifficulty.fake.calls[0].questions, SETS.task.questions,
  '(g) [M3] the `readTask` call\'s `questions` is deep-equal to `sets.task.questions` of ' +
  '`factory/questions.json`. Got keys: ' +
  JSON.stringify(Object.keys(kOnDifficulty.fake.calls[0].questions ?? {})))
assert.deepStrictEqual(kOnDifficulty.out.answers,
  taskAnswers({ difficulty: score(DIFFICULTY_RUNG), design_open: noul(0) }),
  '(g) [M3] `readTask` resolves an object whose `answers` is deep-equal to the answers the fake ' +
  '`ask` returned. Got: ' + JSON.stringify(kOnDifficulty.out.answers))

// ══════════════════════════════════════════════════════════════════════════
// (g) [M4] the three flat readers — their set's questions once, the answers back
// ══════════════════════════════════════════════════════════════════════════

const NOTE_ARGS = {
  title: 'Task 2: the judge',
  claim: 'the claim',
  role: 'implementer',
  note: 'the note body',
  candidates: [],
}
const NOTE_ANSWERS = {
  stuck: noul(0.42),
  plan_defect: noul(0.11),
  divergence: noul(0.05),
  kind: pick('progress', 0.77, optionsOf('note', 'kind')),
  operator_should_read: score(1),
  settles_interface: noul(0.2),
  which: { type: 'choice', choice: 'none', confidence: 0.9, probabilities: { none: 0.9 } },
}

const AMENDMENT_ARGS = {
  amendment: { what: 'what', why: 'why', clause_before: 'before', clause_after: 'after' },
  sibling: { claim: 'sibling claim', machine: 'M1 ...', consumes: [] },
}
const AMENDMENT_ANSWERS = {
  compelled: noul(0.61),
  plan_fault: noul(0.33),
  magnitude: score(1),
  changes_consumer: noul(0.12),
}

const SUPERVISOR_ARGS = {
  inferred: { notes: [], attention: 'ok', blocked_by: [] },
  observed: {
    elapsed_vs_median: 1.2,
    diff_stat: '1 file changed',
    paths_touched: ['factory/judge.mjs'],
    task_files: ['factory/judge.mjs'],
    suite_runs: 0,
    exam_exit: 1,
    prior_tick: null,
  },
}
const SUPERVISOR_ANSWERS = {
  stuck: noul(0.13),
  off_track: noul(0.07),
  needs_human: noul(0.02),
  done_not_exited: noul(0.31),
}

const FLAT_READERS = [
  ['readNote', 'note', NOTE_ARGS, NOTE_ANSWERS],
  ['readAmendment', 'amendment', AMENDMENT_ARGS, AMENDMENT_ANSWERS],
  ['readSupervisor', 'supervisor', SUPERVISOR_ARGS, SUPERVISOR_ANSWERS],
]
for (const [reader, set, args, answers] of FLAT_READERS) {
  const fake = recording(answers)
  const out = await judgeWith(fake.ask)[reader](args)
  assert.equal(fake.calls.length, 1,
    '(g) [M4] `' + reader + '` puts its set\'s questions exactly ONCE; `ask` was called ' +
    fake.calls.length + ' time(s)')
  assert.deepStrictEqual(fake.calls[0].questions, SETS[set].questions,
    '(g) [M4] the `' + reader + '` call\'s `questions` is deep-equal to `sets.' + set +
    '.questions` of `factory/questions.json` — a reworded question is a different question. ' +
    'Got keys: ' + JSON.stringify(Object.keys(fake.calls[0].questions ?? {})))
  assert.deepStrictEqual(out, answers,
    '(g) [M4] `' + reader + '` resolves an object deep-equal to the answers the fake `ask` ' +
    'returned — the flat answers object. Got: ' + JSON.stringify(out))
}

// ══════════════════════════════════════════════════════════════════════════
// (f) [M4] six readers, three silent lanes: `null`, and one `jev:` line
// ══════════════════════════════════════════════════════════════════════════

const READER_ARGS = {
  readTask: { title: 'Task 2: the judge', body: 'the body' },
  readLanding: LANDING_STATE,
  gradeFinding: FINDING_ARGS,
  readNote: NOTE_ARGS,
  readAmendment: AMENDMENT_ARGS,
  readSupervisor: SUPERVISOR_ARGS,
}
const LANES = [
  ['`ask` resolves `null`', async () => null],
  ['`ask` rejects', async () => { throw new Error('edge down') }],
  ['`ask` answers `{}`', async () => ({})],
]

for (const reader of READERS) {
  for (const [lane, ask] of LANES) {
    const lines = []
    const judge = judgeWith(ask, (line) => lines.push(line))
    let out
    let thrown = null
    try {
      out = await judge[reader](READER_ARGS[reader])
    } catch (error) {
      thrown = error
    }
    assert.ok(thrown === null,
      '(f) [M4] `' + reader + '` on the lane where ' + lane + ' does not throw — it resolves ' +
      '`null`. Got: ' + String(thrown && (thrown.message || thrown)))
    assert.strictEqual(out, null,
      '(f) [M4] `' + reader + '` resolves `null` when ' + lane + '. Got: ' + JSON.stringify(out))
    assert.equal(lines.length, 1,
      '(f) [M4] `' + reader + '` calls `log` EXACTLY ONCE when ' + lane + '; it was called ' +
      lines.length + ' time(s): ' + JSON.stringify(lines))
    assert.equal(typeof lines[0], 'string',
      '(f) [M4] `' + reader + '` logs a STRING when ' + lane + '; got ' +
      JSON.stringify(typeof lines[0]))
    assert.equal(lines[0].startsWith('jev:'), true,
      '(f) [M4] `' + reader + '`\'s log line begins `jev:` when ' + lane + '. Got: ' +
      JSON.stringify(lines[0]))
  }
}

// ══════════════════════════════════════════════════════════════════════════
// (h) [M5] `factory/judge.mjs` is 200 lines or fewer
// ══════════════════════════════════════════════════════════════════════════

// Counted the way the Proof's own `Run:` line counts it: `wc -l` is the number
// of newline characters in the file.
const lineCount = (JUDGE_SRC.match(/\n/g) ?? []).length
assert.ok(lineCount <= 200,
  '(h) [M5] `factory/judge.mjs` is at most 200 lines — `wc -l` counts ' + lineCount)

console.log('ALL TESTS PASSED')
