/**
 * fleet/tests/test_factory_judge_select.mjs — the exam for *the two selection
 * readers*: Jev says which of a set of candidate tests already establishes a
 * clause, and which of them would go red if a patch broke what they touch.
 *
 * This file is the Proof's `Test:`, written whole at the path the Proof
 * names. It imports `factory/judge.mjs` — the deliverable this task writes —
 * and reads `factory/questions.json` and `factory/policy.json` directly; it
 * creates none of the three.
 *
 * The Machine clauses under test, restated so a reader can map every
 * assertion back to the contract:
 *
 *   M1 — `factory/questions.json` gains a set `select` whose `questions` has
 *        keys exactly `covers` and `guards`, both `type` `noul`, the `covers`
 *        instructions carrying both `<i>` and `<j>` and the `guards`
 *        instructions carrying `<j>`; `factory/policy.json` gains `select`
 *        deep-equal to the literal object the task states.
 *   M2 — `makeJudge(...)` answers `readCovering({ clauses, tests })` that
 *        puts one question per (clause, test) pair under `M<i+1>__t<j>` in a
 *        single `ask` whose state is `{ clauses, tests }` with `tests` keyed
 *        `t0`, `t1`, … by text, and resolves `{ covered, scores }` where
 *        `scores[i][j]` is the pair's noul and `covered[i]` is the path of
 *        clause `i`'s highest-scoring test when that score is at or above
 *        `policy.select.t_covers.value`, else `null`.
 *   M3 — it answers `readGuards({ patch, tests })` that puts one question per
 *        test under `g<j>` in a single `ask` whose state is `{ patch, tests }`
 *        keyed the same way, and resolves `{ selected, scores }` where
 *        `scores[j]` is the test's noul and `selected` is the paths at or
 *        above `policy.select.t_guards.value`, highest score first, ties in
 *        the order given, at most `policy.select.max_run` of them.
 *   M4 — either reader resolves `null` after one `log` line beginning `jev:`
 *        when `ask` resolves `null`, rejects, or leaves a needed key
 *        unanswered; with an empty `tests` it resolves `null` without calling
 *        `ask`; the seven readers the judge answered before are still
 *        answered.
 *
 * The Proof's legs, and where each is answered below:
 *
 *   (a) [M1] `factory/questions.json` and `factory/policy.json` parsed and
 *            checked against the task's literals.
 *   (b) [M2] `readCovering` over two clauses and two tests, against a fake
 *            `ask`.
 *   (c) [M3] `readGuards` over five tests, against a fake `ask`; then again
 *            with a copied policy raising `t_guards.value`.
 *   (d) [M4] the three lanes that answer nothing, and the judge's full key
 *            set.
 *
 * Assumption this exam makes about the code under test, since the task fixes
 * the reader contracts but not their internals: `readCovering` and
 * `readGuards` are read off the object `makeJudge({...})` returns, exactly as
 * the seven existing readers are (`factory/judge.mjs`'s own `askOnce` /
 * `refuse` shape, per the task's Context) — this exam calls them as plain
 * methods of that object and makes no assumption about how the module gets
 * there internally. It also assumes `tests[].path` is returned verbatim
 * (never transformed) as the string identifying a test in `covered` and
 * `selected`, since the task states covered/selected values as bare paths
 * like `'a'` and `'p4'`.
 *
 * Nothing here starts a process, reads a credential or opens a socket: the
 * two readers are functions over the judge's `ask`, so the exam hands them a
 * fake `ask` that records its argument and answers canned answers.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')

const QUESTIONS_PATH = path.join(ROOT, 'factory', 'questions.json')
const POLICY_PATH = path.join(ROOT, 'factory', 'policy.json')

/** The deliverable, imported dynamically: a tree without it reports the
 *  ABSENT MODULE as an assertion of leg (b) rather than dying at load with no
 *  leg named at all. */
let mod = null
let modImportError = null
try {
  mod = await import('../../factory/judge.mjs')
} catch (error) {
  modImportError = error
}
assert.ok(modImportError === null,
  '(b) [M2] `factory/judge.mjs` is importable — the module this task modifies. Got: ' +
  String(modImportError && (modImportError.message || modImportError)))

const { makeJudge } = mod
assert.equal(typeof makeJudge, 'function',
  '(b) [M2] `factory/judge.mjs` exports `makeJudge`; got ' + JSON.stringify(typeof makeJudge))

// ══════════════════════════════════════════════════════════════════════════
// (a) [M1] the `select` set of `questions.json` and the `select` policy cell
// ══════════════════════════════════════════════════════════════════════════

const questionsDoc = JSON.parse(fs.readFileSync(QUESTIONS_PATH, 'utf8'))
const policyDoc = JSON.parse(fs.readFileSync(POLICY_PATH, 'utf8'))

const selectSet = (questionsDoc.sets || {}).select
assert.ok(selectSet && typeof selectSet === 'object',
  '(a) [M1] `factory/questions.json`\'s `sets` gains a `select` set; got ' +
  JSON.stringify(selectSet))

const selectQuestions = selectSet.questions
assert.ok(selectQuestions && typeof selectQuestions === 'object',
  '(a) [M1] `sets.select.questions` is an object; got ' + JSON.stringify(selectQuestions))
assert.deepEqual(Object.keys(selectQuestions).slice().sort(), ['covers', 'guards'],
  '(a) [M1] `sets.select.questions` has keys exactly `covers` and `guards`; got ' +
  JSON.stringify(Object.keys(selectQuestions)))
assert.equal(selectQuestions.covers && selectQuestions.covers.type, 'noul',
  '(a) [M1] `sets.select.questions.covers.type` is `noul`; got ' +
  JSON.stringify(selectQuestions.covers && selectQuestions.covers.type))
assert.equal(selectQuestions.guards && selectQuestions.guards.type, 'noul',
  '(a) [M1] `sets.select.questions.guards.type` is `noul`; got ' +
  JSON.stringify(selectQuestions.guards && selectQuestions.guards.type))

const coversSerialized = JSON.stringify(selectQuestions.covers && selectQuestions.covers.instructions)
assert.ok(coversSerialized.includes('<i>'),
  '(a) [M1] `sets.select.questions.covers.instructions` carries `<i>` somewhere in it; got ' +
  coversSerialized)
assert.ok(coversSerialized.includes('<j>'),
  '(a) [M1] `sets.select.questions.covers.instructions` carries `<j>` somewhere in it; got ' +
  coversSerialized)

const guardsSerialized = JSON.stringify(selectQuestions.guards && selectQuestions.guards.instructions)
assert.ok(guardsSerialized.includes('<j>'),
  '(a) [M1] `sets.select.questions.guards.instructions` carries `<j>` somewhere in it; got ' +
  guardsSerialized)

const WANT_POLICY_SELECT = {
  enabled: true,
  t_covers: { value: 0.8, n: 0, window: 'none', basis: 'judgment', experiment: true, rollback: 1.01 },
  t_guards: { value: 0.5, n: 0, window: 'none', basis: 'judgment', experiment: true, rollback: 1.01 },
  max_candidates: 8,
  max_run: 3,
  timeout_seconds: 300,
  n: 0,
  window: 'none',
  basis: 'judgment',
  experiment: true,
  rollback: 'enabled = false',
}
assert.deepEqual(policyDoc.select, WANT_POLICY_SELECT,
  '(a) [M1] `factory/policy.json`\'s `select` is deep-equal to the task\'s literal object; got ' +
  JSON.stringify(policyDoc.select))

// ══════════════════════════════════════════════════════════════════════════
// helpers shared by the reader legs
// ══════════════════════════════════════════════════════════════════════════

/** A fake `ask`: records every call's `{ state, questions }` argument and
 *  answers `answer(arg)`, which may return an answers object, `null`,
 *  reject, or throw. */
const fakeAsk = (answer) => {
  const calls = []
  const ask = async (arg) => { calls.push(arg); return answer(arg) }
  return { calls, ask }
}

/** A recording `log`. */
const recorder = () => {
  const lines = []
  return { lines, log: (line) => { lines.push(line) } }
}

// ══════════════════════════════════════════════════════════════════════════
// (b) [M2] `readCovering`: one pairwise question per (clause, test), keyed
// `M<i+1>__t<j>`, `state.tests` keyed `t0`, `t1`, … by text
// ══════════════════════════════════════════════════════════════════════════

{
  const clauses = ['clause zero', 'clause one']
  const tests = [{ path: 'a', text: 'A' }, { path: 'b', text: 'B' }]
  const answers = {
    M1__t0: 0.9,
    M1__t1: 0.85,
    M2__t0: 0.3,
    M2__t1: 0.79,
  }
  const { calls, ask } = fakeAsk(async () => answers)
  const { log } = recorder()
  const judge = makeJudge({ ask, questionsPath: QUESTIONS_PATH, policyPath: POLICY_PATH, log })
  assert.equal(typeof judge.readCovering, 'function',
    '(b) [M2] `makeJudge({...})` answers `readCovering`, a function; got ' +
    JSON.stringify(typeof judge.readCovering))

  const got = await judge.readCovering({ clauses, tests })

  assert.deepEqual(got, {
    covered: ['a', null],
    scores: [[0.9, 0.85], [0.3, 0.79]],
  },
  '(b) [M2] `readCovering` resolves `covered` — clause 0\'s best test `a` scored 0.9 (>= the ' +
  '0.8 `t_covers` threshold), clause 1\'s best test `b` scored 0.79 (below it, so `null`) — ' +
  'and `scores[i][j]`, the raw pair nouls in order; got ' + JSON.stringify(got))

  assert.equal(calls.length, 1,
    '(b) [M2] `readCovering` calls `ask` exactly once; got ' + calls.length)
  assert.deepEqual(Object.keys(calls[0].questions).slice().sort(),
    ['M1__t0', 'M1__t1', 'M2__t0', 'M2__t1'],
    '(b) [M2] that one `ask` call\'s `questions` has keys exactly `M1__t0`, `M1__t1`, ' +
    '`M2__t0`, `M2__t1` — one per (clause, test) pair, clause counted from M1; got ' +
    JSON.stringify(Object.keys(calls[0].questions)))
  assert.deepEqual(Object.keys(calls[0].state).slice().sort(), ['clauses', 'tests'],
    '(b) [M2] the `ask` call\'s `state` has keys exactly `clauses` and `tests`; got ' +
    JSON.stringify(Object.keys(calls[0].state)))
  assert.deepEqual(calls[0].state.clauses, clauses,
    '(b) [M2] `state.clauses` is the `clauses` array as given; got ' +
    JSON.stringify(calls[0].state.clauses))
  assert.deepEqual(calls[0].state.tests, { t0: 'A', t1: 'B' },
    '(b) [M2] `state.tests` is keyed `t0`, `t1`, … by each test\'s `text`; got ' +
    JSON.stringify(calls[0].state.tests))
}

// ══════════════════════════════════════════════════════════════════════════
// (c) [M3] `readGuards`: one question per test, keyed `g<j>`, ranked
// descending at or above `t_guards.value`, capped at `max_run`
// ══════════════════════════════════════════════════════════════════════════

{
  const tests = ['p0', 'p1', 'p2', 'p3', 'p4'].map((p) => ({ path: p, text: p + '-text' }))
  const patch = 'PATCH DIFF TEXT'
  const answers = { g0: 0.4, g1: 0.9, g2: 0.6, g3: 0.7, g4: 0.95 }
  const { calls, ask } = fakeAsk(async () => answers)
  const { log } = recorder()
  const judge = makeJudge({ ask, questionsPath: QUESTIONS_PATH, policyPath: POLICY_PATH, log })
  assert.equal(typeof judge.readGuards, 'function',
    '(c) [M3] `makeJudge({...})` answers `readGuards`, a function; got ' +
    JSON.stringify(typeof judge.readGuards))

  const got = await judge.readGuards({ patch, tests })

  assert.deepEqual(got, {
    selected: ['p4', 'p1', 'p3'],
    scores: [0.4, 0.9, 0.6, 0.7, 0.95],
  },
  '(c) [M3] `readGuards` resolves `selected` — of the four tests at or above the 0.5 ' +
  '`t_guards` threshold (p1 0.9, p2 0.6, p3 0.7, p4 0.95; p0 0.4 excluded), the top ' +
  '`max_run` = 3 highest-scoring paths, highest first — and `scores[j]`, the raw per-test ' +
  'nouls in order; got ' + JSON.stringify(got))

  assert.equal(calls.length, 1,
    '(c) [M3] `readGuards` calls `ask` exactly once; got ' + calls.length)
  assert.deepEqual(Object.keys(calls[0].questions).slice().sort(), ['g0', 'g1', 'g2', 'g3', 'g4'],
    '(c) [M3] that one `ask` call\'s `questions` has keys exactly `g0`..`g4`, one per test; ' +
    'got ' + JSON.stringify(Object.keys(calls[0].questions)))
  assert.deepEqual(Object.keys(calls[0].state).slice().sort(), ['patch', 'tests'],
    '(c) [M3] the `ask` call\'s `state` has keys exactly `patch` and `tests`; got ' +
    JSON.stringify(Object.keys(calls[0].state)))
  assert.equal(calls[0].state.patch, patch,
    '(c) [M3] `state.patch` is the `patch` given; got ' + JSON.stringify(calls[0].state.patch))
  assert.deepEqual(calls[0].state.tests,
    { t0: 'p0-text', t1: 'p1-text', t2: 'p2-text', t3: 'p3-text', t4: 'p4-text' },
    '(c) [M3] `state.tests` is keyed `t0`, `t1`, … by each test\'s `text`, the same way ' +
    '`readCovering` keys it; got ' + JSON.stringify(calls[0].state.tests))
}

{
  // A copied policy document with `select.t_guards.value` raised to 0.92: only
  // `p4` (0.95) survives the threshold now.
  const tests = ['p0', 'p1', 'p2', 'p3', 'p4'].map((p) => ({ path: p, text: p + '-text' }))
  const answers = { g0: 0.4, g1: 0.9, g2: 0.6, g3: 0.7, g4: 0.95 }
  const { ask } = fakeAsk(async () => answers)
  const { log } = recorder()

  const raisedPolicy = JSON.parse(JSON.stringify(policyDoc))
  raisedPolicy.select.t_guards.value = 0.92
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'judge-select-'))
  const tmpPolicyPath = path.join(tmpDir, 'policy.json')
  fs.writeFileSync(tmpPolicyPath, JSON.stringify(raisedPolicy), 'utf8')

  const judge = makeJudge({ ask, questionsPath: QUESTIONS_PATH, policyPath: tmpPolicyPath, log })
  const got = await judge.readGuards({ patch: 'p', tests })

  assert.ok(got && typeof got === 'object',
    '(c) [M3] with a raised `select.t_guards.value`, `readGuards` still resolves an object; ' +
    'got ' + JSON.stringify(got))
  assert.deepEqual(got.selected, ['p4'],
    '(c) [M3] with a copied policy whose `select.t_guards.value` is 0.92, only `p4` (0.95) ' +
    'is at or above it, so `selected` is `[\'p4\']`; got ' + JSON.stringify(got && got.selected))
}

// ══════════════════════════════════════════════════════════════════════════
// (d) [M4] the three lanes that answer nothing, and the judge's full key set
// ══════════════════════════════════════════════════════════════════════════

{
  // `ask` resolves `null` -> `readCovering` resolves `null`, one `jev:` line.
  const { ask } = fakeAsk(async () => null)
  const { lines, log } = recorder()
  const judge = makeJudge({ ask, questionsPath: QUESTIONS_PATH, policyPath: POLICY_PATH, log })
  const got = await judge.readCovering({
    clauses: ['c0'],
    tests: [{ path: 'a', text: 'A' }],
  })
  assert.equal(got, null,
    '(d) [M4] `readCovering` resolves `null` when `ask` itself resolves `null`; got ' +
    JSON.stringify(got))
  assert.equal(lines.length, 1,
    '(d) [M4] and `log` is called exactly once on that lane; got ' + JSON.stringify(lines))
  assert.equal(typeof lines[0] === 'string' && lines[0].startsWith('jev:'), true,
    '(d) [M4] with a string beginning `jev:`; got ' + JSON.stringify(lines[0]))
}

{
  // `ask` rejects -> `readGuards` resolves `null`, one `jev:` line, no throw.
  const { ask } = fakeAsk(async () => { throw new Error('boom') })
  const { lines, log } = recorder()
  const judge = makeJudge({ ask, questionsPath: QUESTIONS_PATH, policyPath: POLICY_PATH, log })
  let got = 'NOT SET'
  let threw = null
  try {
    got = await judge.readGuards({ patch: 'p', tests: [{ path: 'a', text: 'A' }] })
  } catch (error) {
    threw = error
  }
  assert.equal(threw, null,
    '(d) [M4] `readGuards` throws nothing when `ask` rejects — Jev gates nothing. Got: ' +
    String(threw && (threw.message || threw)))
  assert.equal(got, null,
    '(d) [M4] and it resolves `null`; got ' + JSON.stringify(got))
  assert.equal(lines.length, 1,
    '(d) [M4] with `log` called exactly once; got ' + JSON.stringify(lines))
  assert.equal(typeof lines[0] === 'string' && lines[0].startsWith('jev:'), true,
    '(d) [M4] beginning `jev:`; got ' + JSON.stringify(lines[0]))
}

{
  // `ask` answers only `g0` for two tests -> `readGuards` resolves `null`, a
  // needed key (`g1`) is unanswered.
  const tests = [{ path: 'a', text: 'A' }, { path: 'b', text: 'B' }]
  const { ask } = fakeAsk(async () => ({ g0: 0.9 }))
  const { lines, log } = recorder()
  const judge = makeJudge({ ask, questionsPath: QUESTIONS_PATH, policyPath: POLICY_PATH, log })
  const got = await judge.readGuards({ patch: 'p', tests })
  assert.equal(got, null,
    '(d) [M4] `readGuards` resolves `null` when `ask` answers `g0` alone and leaves `g1` ' +
    'unanswered; got ' + JSON.stringify(got))
  assert.equal(lines.length, 1,
    '(d) [M4] with `log` called exactly once, one `jev:` line; got ' + JSON.stringify(lines))
  assert.equal(typeof lines[0] === 'string' && lines[0].startsWith('jev:'), true,
    '(d) [M4] beginning `jev:`; got ' + JSON.stringify(lines[0]))
}

{
  // An empty `tests` resolves `null` from both readers without calling `ask`
  // at all.
  const { calls, ask } = fakeAsk(async () => ({}))
  const { log } = recorder()
  const judge = makeJudge({ ask, questionsPath: QUESTIONS_PATH, policyPath: POLICY_PATH, log })

  const coveringGot = await judge.readCovering({ clauses: ['c0'], tests: [] })
  assert.equal(coveringGot, null,
    '(d) [M4] `readCovering` resolves `null` when `tests` is empty; got ' +
    JSON.stringify(coveringGot))

  const guardsGot = await judge.readGuards({ patch: 'p', tests: [] })
  assert.equal(guardsGot, null,
    '(d) [M4] `readGuards` resolves `null` when `tests` is empty; got ' +
    JSON.stringify(guardsGot))

  assert.equal(calls.length, 0,
    '(d) [M4] and neither call reached `ask` at all — an empty `tests` never asks Jev ' +
    'anything; got ' + calls.length + ' call(s)')
}

{
  // The judge's full key set: the seven readers that existed before this
  // task, plus the two this task adds, each a function.
  const { ask } = fakeAsk(async () => ({}))
  const { log } = recorder()
  const judge = makeJudge({ ask, questionsPath: QUESTIONS_PATH, policyPath: POLICY_PATH, log })
  const wantKeys = [
    'readTask', 'readLanding', 'gradeFinding', 'readNote', 'readAmendment',
    'readSupervisor', 'readSettled', 'readCovering', 'readGuards',
  ]
  assert.deepEqual(Object.keys(judge).slice().sort(), wantKeys.slice().sort(),
    '(d) [M4] the object `makeJudge` answers has the keys `readTask`, `readLanding`, ' +
    '`gradeFinding`, `readNote`, `readAmendment`, `readSupervisor`, `readSettled`, ' +
    '`readCovering` and `readGuards`, and no others; got ' + JSON.stringify(Object.keys(judge)))
  for (const key of wantKeys) {
    assert.equal(typeof judge[key], 'function',
      '(d) [M4] `judge.' + key + '` is a function; got ' + JSON.stringify(typeof judge[key]))
  }
}

console.log('ALL TESTS PASSED')
