/**
 * fleet/tests/test_factory_judge_fold_red.mjs — the exam for *the fold-red
 * reader*: `readFoldRed`, the judge's eighth door, which asks Jev one
 * question over two facts — a failing exam's assertion text and the folding
 * patch's hunks — and turns the one `noul` answer into an exam-defect
 * verdict against a policy threshold.
 *
 * This file is the Proof's `Test:`, written whole at the path the Proof
 * names. `../../` from `fleet/tests/` is the repository root.
 *
 * The Proof also carries a `Run:` — a `python3` one-liner over
 * `factory/questions.json` straight, checked separately from this file. That
 * line IS leg (a), proving M1's questions-document shape (the `fold_red`
 * set, its one `noul` question naming both facts, its `state`/`calibrated`/
 * prose keys, and that the other nine sets are untouched). This file does
 * not re-derive that hash; it exercises `readFoldRed` itself, legs (b) and
 * (c), against the *real* `factory/questions.json` — so a `fold_red` set
 * that does not match what `readFoldRed` actually sends to `ask` fails here
 * too, even though the exact question text is M1's proof, not this file's.
 *
 * Legs, mapped to the Machine clauses:
 *
 *   (b) [M2] a green answer (`{ exact_shape_broken: { noul: 0.9 } }`)
 *       resolves `{ examDefect: true, score: 0.9 }`; `ask` was called
 *       exactly once, with `state` deep-equal to `{ assertion, hunks }` (and
 *       so carrying no `who`) and `questions` exactly `{ exact_shape_broken:
 *       <the file's own question> }`. A bare-number answer of `0.5` resolves
 *       `{ examDefect: false, score: 0.5 }` (below the 0.8 threshold). With
 *       the policy's `fold.attribution` cell absent, the same `0.9` answer
 *       resolves `examDefect: false` (score still read).
 *   (c) [M3] `ask` resolving `null`, rejecting, or answering `{}` (missing
 *       `exact_shape_broken`) each resolve `readFoldRed` to `null` without
 *       throwing; and the green call of leg (b) left exactly one `emit` row
 *       with `kind: 'jev'`, `site: 'fold_red'`, `task`/`label` off `who`,
 *       and `answered: true`.
 *
 * What this file assumes of the code under test: `factory/judge.mjs`
 * exports `makeJudge` returning an object carrying `readFoldRed`, built the
 * same way the file's other readers are (`askOnce`), and
 * `factory/questions.json` carries the `fold_red` set M1 describes (this
 * file reads it from the real document rather than retyping its text, so it
 * stays a lever on the actual plumbing rather than a second copy of M1's own
 * proof). `factory/policy.json`'s `fold` key holds no `attribution` cell
 * today (a sibling task adds it); this file supplies its own temp policy
 * documents rather than depending on that sibling having landed.
 *
 * No network, no child process: `ask` and `emit` are recording functions
 * this file defines, never `factory/jev-client.mjs` or a real emit sink.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// ─── bootstrap: the module under test ───────────────────────────────────
let judge = null
let judgeImportError = null
try {
  judge = await import('../../factory/judge.mjs')
} catch (error) {
  judgeImportError = error
}
assert.equal(judgeImportError, null,
  '[M2] `factory/judge.mjs` is importable — the module this task modifies. Got: ' +
  String(judgeImportError && (judgeImportError.message || judgeImportError)))
assert.equal(typeof judge.makeJudge, 'function',
  '[M2] it exports `makeJudge(...)`; got ' + JSON.stringify(typeof judge.makeJudge))

// ─── the real questions document, read straight — never retyped ────────
const REAL_QUESTIONS_URL = new URL('../../factory/questions.json', import.meta.url)
const realQuestions = JSON.parse(fs.readFileSync(REAL_QUESTIONS_URL, 'utf8'))
const realFoldRedSet = ((realQuestions.sets || {}).fold_red) || {}
const realFoldRedQuestion = (realFoldRedSet.questions || {}).exact_shape_broken

// ─── temp policy documents this exam writes itself ──────────────────────
const REAL_POLICY_URL = new URL('../../factory/policy.json', import.meta.url)
const realPolicy = JSON.parse(fs.readFileSync(REAL_POLICY_URL, 'utf8'))
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'judge-fold-red-'))

const policyWithThreshold = {
  ...realPolicy,
  fold: { ...(realPolicy.fold || {}), attribution: { t_exam_defect: { value: 0.8 } } },
}
const policyWithThresholdPath = path.join(tmpDir, 'policy-with-threshold.json')
fs.writeFileSync(policyWithThresholdPath, JSON.stringify(policyWithThreshold))

const policyWithoutAttribution = { ...realPolicy, fold: { ...(realPolicy.fold || {}) } }
delete policyWithoutAttribution.fold.attribution
const policyWithoutAttributionPath = path.join(tmpDir, 'policy-without-attribution.json')
fs.writeFileSync(policyWithoutAttributionPath, JSON.stringify(policyWithoutAttribution))

/** A recording `ask`: pushes each call's single `{ state, questions }`
 *  argument and answers with `answer` — a value, or a function of that
 *  argument, so a case can inspect what it was sent before deciding. */
const recordingAsk = (answer) => {
  const calls = []
  const ask = async (argv) => {
    calls.push(argv)
    return typeof answer === 'function' ? answer(argv) : answer
  }
  return { calls, ask }
}

/** A recording `emit`: pushes every row it is handed, verbatim. */
const recordingEmit = () => {
  const rows = []
  return { rows, emit: (row) => rows.push(row) }
}

const makeJudgeWith = ({ ask, emit, policyPath = policyWithThresholdPath }) =>
  judge.makeJudge({ ask, emit, questionsPath: REAL_QUESTIONS_URL, policyPath })

const WHO = { task: '2', label: 'fold:3' }
const ASSERTION = 'A'
const HUNKS = 'H'

// ══════════════════════════════════════════════════════════════════════════
// (b) [M2] one call, the right state and question, and the threshold split
// ══════════════════════════════════════════════════════════════════════════

{
  // The green case: a noul of 0.9 against the 0.8 threshold is a defect.
  const { calls, ask } = recordingAsk({ exact_shape_broken: { noul: 0.9 } })
  const { rows, emit } = recordingEmit()
  const j = makeJudgeWith({ ask, emit })
  assert.equal(typeof j.readFoldRed, 'function',
    '[M2] `makeJudge(...)` returns an object carrying `readFoldRed`; got ' +
    JSON.stringify(Object.keys(j)))

  const result = await j.readFoldRed({ assertion: ASSERTION, hunks: HUNKS, who: WHO })
  assert.deepEqual(result, { examDefect: true, score: 0.9 },
    '[M2] a 0.9 answer, at or above the 0.8 policy threshold, resolves ' +
    '`{ examDefect: true, score: 0.9 }` — score is the answer\'s noul; got ' +
    JSON.stringify(result))

  assert.equal(calls.length, 1,
    '[M2] `readFoldRed` asks Jev exactly once; got ' + calls.length + ' call(s)')
  assert.deepEqual(calls[0].state, { assertion: ASSERTION, hunks: HUNKS },
    '[M2] the state sent is exactly `{ assertion, hunks }` — the two facts, and no `who`; got ' +
    JSON.stringify(calls[0].state))
  assert.deepEqual(Object.keys(calls[0].questions), ['exact_shape_broken'],
    '[M2] the one question put to Jev is `exact_shape_broken`; got ' +
    JSON.stringify(Object.keys(calls[0].questions)))
  assert.deepEqual(calls[0].questions.exact_shape_broken, realFoldRedQuestion,
    '[M2] and it is the question `factory/questions.json` itself carries under ' +
    '`sets.fold_red.questions.exact_shape_broken` — not a retyped copy; got ' +
    JSON.stringify(calls[0].questions.exact_shape_broken) + ', file has ' +
    JSON.stringify(realFoldRedQuestion))

  // ── (c) [M3] the one emit row this green call wrote ──
  assert.equal(rows.length, 1,
    '[M3] the call writes exactly one `jev` row through `emit`; got ' + rows.length)
  const row = rows[0]
  assert.equal(row.kind, 'jev',
    '[M3] the row\'s `kind` is `\'jev\'`; got ' + JSON.stringify(row.kind))
  assert.equal(row.site, 'fold_red',
    '[M3] the row\'s `site` is `\'fold_red\'`; got ' + JSON.stringify(row.site))
  assert.equal(row.task, WHO.task,
    '[M3] the row\'s `task` comes off `who.task`; got ' + JSON.stringify(row.task))
  assert.equal(row.label, WHO.label,
    '[M3] the row\'s `label` comes off `who.label`; got ' + JSON.stringify(row.label))
  assert.equal(row.answered, true,
    '[M3] the row\'s `answered` is `true` for a call Jev answered; got ' +
    JSON.stringify(row.answered))
}

{
  // Below the threshold: 0.5 < 0.8 is not a defect, but score is still reported.
  const { ask } = recordingAsk({ exact_shape_broken: 0.5 })
  const j = makeJudgeWith({ ask, emit: () => {} })
  const result = await j.readFoldRed({ assertion: ASSERTION, hunks: HUNKS, who: WHO })
  assert.deepEqual(result, { examDefect: false, score: 0.5 },
    '[M2] a bare-number answer of 0.5, below the 0.8 policy threshold, resolves ' +
    '`{ examDefect: false, score: 0.5 }`; got ' + JSON.stringify(result))
}

{
  // With the policy cell absent, `examDefect` is false even for a 0.9 answer.
  const { ask } = recordingAsk({ exact_shape_broken: { noul: 0.9 } })
  const j = makeJudgeWith({ ask, emit: () => {}, policyPath: policyWithoutAttributionPath })
  const result = await j.readFoldRed({ assertion: ASSERTION, hunks: HUNKS, who: WHO })
  assert.deepEqual(result, { examDefect: false, score: 0.9 },
    '[M2] with `policy.fold.attribution.t_exam_defect` absent, `examDefect` is `false` ' +
    'regardless of the answer (a missing threshold makes any `>=` comparison false), while ' +
    '`score` still reads the answer\'s noul; got ' + JSON.stringify(result))
}

// ══════════════════════════════════════════════════════════════════════════
// (c) [M3] no answer -> `null`, and never a throw
// ══════════════════════════════════════════════════════════════════════════

{
  const { ask } = recordingAsk(null)
  const j = makeJudgeWith({ ask, emit: () => {} })
  const result = await j.readFoldRed({ assertion: ASSERTION, hunks: HUNKS, who: WHO })
  assert.equal(result, null,
    '[M3] `ask` resolving `null` makes `readFoldRed` resolve `null`; got ' +
    JSON.stringify(result))
}

{
  const ask = async () => { throw new Error('jev unreachable') }
  const j = makeJudgeWith({ ask, emit: () => {} })
  let result = 'UNSET'
  let threw = null
  try {
    result = await j.readFoldRed({ assertion: ASSERTION, hunks: HUNKS, who: WHO })
  } catch (error) {
    threw = error
  }
  assert.equal(threw, null,
    '[M3] `ask` rejecting never makes `readFoldRed` throw. It threw: ' +
    String(threw && (threw.stack || threw.message || threw)))
  assert.equal(result, null,
    '[M3] and it resolves `null` instead; got ' + JSON.stringify(result))
}

{
  const { ask } = recordingAsk({})
  const j = makeJudgeWith({ ask, emit: () => {} })
  const result = await j.readFoldRed({ assertion: ASSERTION, hunks: HUNKS, who: WHO })
  assert.equal(result, null,
    '[M3] an answer lacking `exact_shape_broken` (`{}`) makes `readFoldRed` resolve `null`; ' +
    'got ' + JSON.stringify(result))
}

console.log('ALL TESTS PASSED')
