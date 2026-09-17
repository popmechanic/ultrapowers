/**
 * fleet/tests/test_jev_questions.mjs — the exam for Task 1: *the question sets
 * and the two readers over the merged Jev client* — the sitting's exact
 * questions, the task's own Claim as context, and numbers and one word back.
 *
 * This file is the Proof's `Test:`, written whole at the path the Proof names.
 * Every relative import is written for THIS directory: `../` is the
 * repository's `fleet/`, `./` is `fleet/tests/`.
 *
 * The Machine clauses under test, restated so a reader can map every assertion
 * back to the contract:
 *
 *   M1 — `fleet/jev-questions.mjs` exports `NOTE_QUESTIONS`, an object whose
 *        keys are exactly `stuck`, `plan_defect`, `divergence`, `kind`,
 *        `operator_should_read` with `type` `noul`, `noul`, `noul`, `choice`,
 *        `score` respectively; `AMENDMENT_QUESTIONS`, keys exactly
 *        `compelled`, `plan_fault`, `magnitude`, types `noul`, `noul`,
 *        `score`; each of the eight questions carrying the `instructions` and
 *        `criteria` the Context spells verbatim; and `NOTE_MAX_CHARS` equal to
 *        `20000`.
 *   M2 — `taskClaimOf(planText, id)` returns the text after `**Claim:**` on the
 *        FIRST such line of the `### Task <id>:` section of `planText`,
 *        trimmed, provenance tag included, and `''` when the plan has no such
 *        section or no such line.
 *   M3 — `readNote(jev, { title, claim, role, note }, log)` calls `jev.ask`
 *        EXACTLY ONCE with an argument deep-equal to `{ state: { task: {
 *        title, claim }, note: <note cut to NOTE_MAX_CHARS characters>, role },
 *        questions: NOTE_QUESTIONS }` and resolves to the FLATTENED `{ stuck,
 *        plan_defect, divergence, note_kind, operator_should_read }` — the
 *        three `noul` numbers, the `kind` answer's `choice` string under
 *        `note_kind`, the `score` number — or `null` when `ask` resolves
 *        `null`, when it throws, or when the answers lack any of the five, in
 *        which case `log` is called exactly once with a line beginning `jev:`.
 *        `readAmendment(jev, { title, claim, amendment }, log)` calls
 *        `jev.ask` exactly once with `{ state: { task: { title, claim },
 *        amendment: { amends, what, why } }, questions: AMENDMENT_QUESTIONS }`
 *        and resolves `{ compelled, plan_fault, magnitude }` the same way, or
 *        `null` under the same rules.
 *   M4 — neither function reads a file, the network or `process.env`, and a
 *        `jev` of `null` or `undefined` resolves `null` from both without
 *        calling anything.
 *   M5 — `fleet/tests/README.md` gains one line for `test_jev_questions.mjs`
 *        under `## The singletons`.
 *
 * The Proof's legs, and where each is answered below:
 *
 *   (a) [M1] the two key orders, the eight `type` values, `NOTE_MAX_CHARS`,
 *            and every question's `instructions` and `criteria` deep-equal to
 *            the literals this file carries, copied from the Context.
 *   (b) [M2] `taskClaimOf` over one plan fixture: a section with a Claim
 *            followed by a `Machine:` line, a section with none, an id with no
 *            section at all.
 *   (c) [M3] a fake `jev` recording its one `ask` argument: the two happy
 *            paths, then the three lanes that answer nothing.
 *   (d) [M4] a `jev` of `null` and of `undefined`, and a static read of the
 *            module's own source.
 *   (e) [M5] the range the Proof's `Run:` line greps, read here with sed's own
 *            semantics, carries this file's basename.
 *
 * Nothing here opens a socket and nothing here reaches the real edge: the two
 * readers are functions OVER the client's `ask`, so the exam hands them a fake
 * `jev` whose `ask` records its argument and answers canned answers.
 * `test_sims_are_hermetic.mjs` is what forbids the real one.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')

/** The deliverable, imported dynamically: a tree without it reports the ABSENT
 *  MODULE as an assertion of leg (a) rather than dying at load with no leg
 *  named at all. */
let mod = null
let modImportError = null
try {
  mod = await import('../jev-questions.mjs')
} catch (error) {
  modImportError = error
}
assert.ok(modImportError === null,
  '(a) [M1] `fleet/jev-questions.mjs` is importable — the module this task creates. Got: ' +
  String(modImportError && (modImportError.message || modImportError)))

const { NOTE_QUESTIONS, AMENDMENT_QUESTIONS, NOTE_MAX_CHARS, taskClaimOf, readNote, readAmendment } = mod

assert.equal(typeof taskClaimOf, 'function',
  '(b) [M2] it exports `taskClaimOf(planText, id)`; got ' + JSON.stringify(typeof taskClaimOf))
assert.equal(typeof readNote, 'function',
  '(c) [M3] it exports `readNote(jev, args, log)`; got ' + JSON.stringify(typeof readNote))
assert.equal(typeof readAmendment, 'function',
  '(c) [M3] it exports `readAmendment(jev, args, log)`; got ' +
  JSON.stringify(typeof readAmendment))

// ══════════════════════════════════════════════════════════════════════════
// (a) [M1] the two question sets, verbatim from the sitting's `jev_notes.py`
// ══════════════════════════════════════════════════════════════════════════

/** The shared context string the five note questions carry, character for
 *  character as the Context spells it. */
const CTX = 'A worker (an implementer, examiner or fix session) on a fleet task ' +
  'posted this note on the task\'s issue while working. The task\'s Claim is given.'

/** The literals, copied from the Context. Each question's `instructions` and
 *  `criteria` are deep-equalled against these below. */
const WANT_NOTE = {
  stuck: {
    type: 'noul',
    instructions: {
      question: 'Does `note` say the worker cannot proceed, is blocked, or needs a person ' +
        'to decide something?',
      context: CTX,
    },
    criteria: {
      true: 'It reports a blocker, a question it cannot settle, or asks for a human',
      false: 'It reports progress, an approach, or a hand-in',
    },
  },
  plan_defect: {
    type: 'noul',
    instructions: {
      question: 'Does `note` say the task text itself is wrong: a clause, leg, path or ' +
        'literal that is contradictory, absent at base, or impossible to satisfy?',
      context: CTX,
    },
    criteria: {
      true: 'It names a defect in the task text or proof, not in its own work',
      false: 'It does not fault the task text',
    },
  },
  divergence: {
    type: 'noul',
    instructions: {
      question: 'Does `note` disclose that the worker did something the task text did not ' +
        'ask for or forbade: an edit outside its Files, a changed clause, a substituted ' +
        'approach?',
      context: CTX,
    },
    criteria: {
      true: 'It discloses a divergence from the task as written',
      false: 'It stays within the task as written, or says nothing about scope',
    },
  },
  kind: {
    type: 'choice',
    instructions: {
      question: 'What kind of note is `note`?',
      context: CTX,
    },
    criteria: {
      approach: 'A plan of attack before or at the start of work',
      progress: 'A mid-work status with no decision needed',
      handin: 'A completion report: what landed, its commit, its evidence',
      blocker: 'A problem that stops the work',
      disclosure: 'An explanation of a divergence or a judgment call already made',
      reading: 'An examiner\'s reading of the legs or the base before writing',
      other: 'None of these',
    },
  },
  operator_should_read: {
    type: 'score',
    instructions: {
      question: 'Should the operator, who never reads code, be shown `note`?',
      context: CTX,
    },
    // The `score` criteria are arrays of `{what}` objects exactly as the
    // sitting sent them, in the order the legend counts up.
    criteria: [
      { what: 'No: routine narration' },
      { what: 'Maybe: a judgment call worth knowing after the run' },
      { what: 'Yes, after the run: a decision or divergence that affects the plan' },
      { what: 'Yes, now: the worker needs a person' },
    ],
  },
}

const WANT_AMENDMENT = {
  // The amendment questions' `instructions` are plain strings: the Context
  // spells them without the `{question, context}` wrapper the note questions
  // carry, and the exam holds them to that.
  compelled: {
    type: 'noul',
    instructions: 'Does `amendment.why` show the change was forced: the task as written ' +
      'could not pass its own proof, contradicted the base, or contradicted a sibling?',
    criteria: {
      true: 'No implementation of the task as written could have merged',
      false: 'The worker preferred a different shape; the task as written was passable',
    },
  },
  plan_fault: {
    type: 'noul',
    instructions: 'Is the root cause in `amendment` a defect in the task text that its ' +
      'author should have caught, rather than a fact only visible while implementing?',
    criteria: {
      true: 'A careful author reading the base would have written it right',
      false: 'It only became visible in the tree, or it is a preference',
    },
  },
  magnitude: {
    type: 'score',
    instructions: 'How far does `amendment.what` move the task from what was signed?',
    criteria: [
      { what: 'Cosmetic: a path spelling, a line number, a comment' },
      { what: 'Local: one clause or one extra file, same intent' },
      { what: 'Substantive: a clause\'s meaning, a leg dropped or changed' },
      { what: 'Reframed: the task now does something else' },
    ],
  },
}

assert.ok(NOTE_QUESTIONS && typeof NOTE_QUESTIONS === 'object' && !Array.isArray(NOTE_QUESTIONS),
  '(a) [M1] `NOTE_QUESTIONS` is an object of questions; got ' + JSON.stringify(NOTE_QUESTIONS))
assert.deepEqual(Object.keys(NOTE_QUESTIONS),
  ['stuck', 'plan_defect', 'divergence', 'kind', 'operator_should_read'],
  '(a) [M1] `Object.keys(NOTE_QUESTIONS)` is exactly `stuck`, `plan_defect`, `divergence`, ' +
  '`kind`, `operator_should_read`, in that order; got ' + JSON.stringify(Object.keys(NOTE_QUESTIONS)))
assert.deepEqual(
  Object.keys(NOTE_QUESTIONS).map((k) => NOTE_QUESTIONS[k] && NOTE_QUESTIONS[k].type),
  ['noul', 'noul', 'noul', 'choice', 'score'],
  '(a) [M1] with those five `type` values in order — `noul`, `noul`, `noul`, `choice`, ' +
  '`score`; got ' +
  JSON.stringify(Object.keys(NOTE_QUESTIONS).map((k) => NOTE_QUESTIONS[k] && NOTE_QUESTIONS[k].type)))

assert.ok(AMENDMENT_QUESTIONS && typeof AMENDMENT_QUESTIONS === 'object' &&
  !Array.isArray(AMENDMENT_QUESTIONS),
  '(a) [M1] `AMENDMENT_QUESTIONS` is an object of questions; got ' +
  JSON.stringify(AMENDMENT_QUESTIONS))
assert.deepEqual(Object.keys(AMENDMENT_QUESTIONS), ['compelled', 'plan_fault', 'magnitude'],
  '(a) [M1] `Object.keys(AMENDMENT_QUESTIONS)` is exactly `compelled`, `plan_fault`, ' +
  '`magnitude`, in that order; got ' + JSON.stringify(Object.keys(AMENDMENT_QUESTIONS)))
assert.deepEqual(
  Object.keys(AMENDMENT_QUESTIONS).map((k) => AMENDMENT_QUESTIONS[k] && AMENDMENT_QUESTIONS[k].type),
  ['noul', 'noul', 'score'],
  '(a) [M1] with `noul`, `noul`, `score` in that order; got ' + JSON.stringify(
    Object.keys(AMENDMENT_QUESTIONS).map((k) => AMENDMENT_QUESTIONS[k] && AMENDMENT_QUESTIONS[k].type)))

assert.equal(NOTE_MAX_CHARS, 20000,
  '(a) [M1] `NOTE_MAX_CHARS` is 20000 — the cut on a note\'s text, under the client\'s own ' +
  '`JEV_STATE_MAX_BYTES`; got ' + JSON.stringify(NOTE_MAX_CHARS))

// Every one of the eight questions, `instructions` and `criteria` against the
// literals above: the sitting's wording is the calibration, so a paraphrase is
// a different question.
for (const [id, want] of Object.entries(WANT_NOTE)) {
  assert.deepEqual(NOTE_QUESTIONS[id].instructions, want.instructions,
    '(a) [M1] `NOTE_QUESTIONS.' + id + '.instructions` is the Context\'s literal — the ' +
    'question and the shared `context` sentence, verbatim; got ' +
    JSON.stringify(NOTE_QUESTIONS[id].instructions))
  assert.deepEqual(NOTE_QUESTIONS[id].criteria, want.criteria,
    '(a) [M1] `NOTE_QUESTIONS.' + id + '.criteria` is the Context\'s literal; got ' +
    JSON.stringify(NOTE_QUESTIONS[id].criteria))
}
for (const [id, want] of Object.entries(WANT_AMENDMENT)) {
  assert.deepEqual(AMENDMENT_QUESTIONS[id].instructions, want.instructions,
    '(a) [M1] `AMENDMENT_QUESTIONS.' + id + '.instructions` is the Context\'s literal ' +
    'string; got ' + JSON.stringify(AMENDMENT_QUESTIONS[id].instructions))
  assert.deepEqual(AMENDMENT_QUESTIONS[id].criteria, want.criteria,
    '(a) [M1] `AMENDMENT_QUESTIONS.' + id + '.criteria` is the Context\'s literal; got ' +
    JSON.stringify(AMENDMENT_QUESTIONS[id].criteria))
}

// The three shapes the leg names by name, said again in the leg's own terms so
// a failure reads as the leg rather than as one entry of the sweep above.
assert.deepEqual(Object.keys(NOTE_QUESTIONS.kind.criteria).slice().sort(),
  ['approach', 'blocker', 'disclosure', 'handin', 'other', 'progress', 'reading'],
  '(a) [M1] `NOTE_QUESTIONS.kind.criteria` has exactly the seven keys `approach`, ' +
  '`progress`, `handin`, `blocker`, `disclosure`, `reading`, `other`; got ' +
  JSON.stringify(Object.keys(NOTE_QUESTIONS.kind.criteria)))
assert.deepEqual(NOTE_QUESTIONS.operator_should_read.criteria,
  WANT_NOTE.operator_should_read.criteria,
  '(a) [M1] `NOTE_QUESTIONS.operator_should_read.criteria` is the four `{what}` objects, ' +
  'in order; got ' + JSON.stringify(NOTE_QUESTIONS.operator_should_read.criteria))
assert.deepEqual(
  (AMENDMENT_QUESTIONS.magnitude.criteria || []).map((c) => String(c && c.what).split(':')[0]),
  ['Cosmetic', 'Local', 'Substantive', 'Reframed'],
  '(a) [M1] `AMENDMENT_QUESTIONS.magnitude.criteria` is the four `{what}` objects beginning ' +
  '`Cosmetic`, `Local`, `Substantive`, `Reframed`, in order; got ' +
  JSON.stringify(AMENDMENT_QUESTIONS.magnitude.criteria))

// ══════════════════════════════════════════════════════════════════════════
// (b) [M2] `taskClaimOf`: the Claim line of one section, and `''` otherwise
// ══════════════════════════════════════════════════════════════════════════

/** A plan text in the shape the compiler reads: Task 7 carries a Claim and a
 *  `Machine:` line after it, Task 8 carries none, and Task 10 follows Task 8 —
 *  so a reader that runs past a section boundary answers Task 8 with Task 10's
 *  Claim, and a reader that takes the last such line answers Task 10 with its
 *  second one. */
const PLAN = [
  '# A plan',
  '',
  'Some prose before any task.',
  '',
  '### Task 7: the seventh',
  '',
  '**Type:** implementation',
  '',
  '**Claim:** do: x; see: y. (derived)',
  'Machine: M1. the machine clause that follows the Claim line, and is not part of it.',
  '',
  '### Task 8: the eighth',
  '',
  '**Type:** implementation',
  'Machine: M1. a section with no Claim line at all.',
  '',
  '### Task 10: the tenth',
  '',
  '**Claim:**   first claim of ten. (derived)   ',
  'Machine: M1. something.',
  '',
  '**Claim:** second claim of ten. (derived)',
  '',
].join('\n')

assert.equal(taskClaimOf(PLAN, '7'), 'do: x; see: y. (derived)',
  '(b) [M2] `taskClaimOf(text, \'7\')` is the text after `**Claim:**` on that section\'s ' +
  'Claim line, trimmed and with the provenance tag included — `do: x; see: y. (derived)`; ' +
  'got ' + JSON.stringify(taskClaimOf(PLAN, '7')))
assert.equal(taskClaimOf(PLAN, '8'), '',
  '(b) [M2] a section whose Claim line is absent answers `\'\'` — Task 10\'s Claim belongs ' +
  'to Task 10; got ' + JSON.stringify(taskClaimOf(PLAN, '8')))
assert.equal(taskClaimOf(PLAN, '9'), '',
  '(b) [M2] an id the plan has no `### Task 9:` section for answers `\'\'`; got ' +
  JSON.stringify(taskClaimOf(PLAN, '9')))
assert.equal(taskClaimOf(PLAN, '10'), 'first claim of ten. (derived)',
  '(b) [M2] the FIRST `**Claim:**` line of the section, trimmed of the whitespace around ' +
  'it; got ' + JSON.stringify(taskClaimOf(PLAN, '10')))
assert.equal(taskClaimOf('', '7'), '',
  '(b) [M2] and a plan with no sections at all answers `\'\'`; got ' +
  JSON.stringify(taskClaimOf('', '7')))

// ══════════════════════════════════════════════════════════════════════════
// (c) [M3] the two readers over a fake `jev`: one call, numbers and one word
// ══════════════════════════════════════════════════════════════════════════

/** A fake `jev`: `ask` records every call's arguments and answers `answer()` —
 *  which may return an answers object, return `null`, reject, or throw. */
const fakeJev = (answer) => {
  const calls = []
  return { calls, ask: (...argv) => { calls.push(argv); return answer(argv) } }
}

/** A recording `log`, the readers' optional third argument. */
const recorder = () => {
  const lines = []
  return { lines, log: (line) => { lines.push(line) } }
}

const NOTE_ANSWERS = {
  stuck: { type: 'noul', noul: 0.96 },
  plan_defect: { type: 'noul', noul: 0.02 },
  divergence: { type: 'noul', noul: 0.01 },
  kind: { type: 'choice', choice: 'blocker', probabilities: {}, confidence: 0.9 },
  operator_should_read: { type: 'score', score: 2.7, legend: {}, probabilities: {}, confidence: 0.8 },
}
const AMENDMENT_ANSWERS = {
  compelled: { type: 'noul', noul: 0.8 },
  plan_fault: { type: 'noul', noul: 0.1 },
  magnitude: { type: 'score', score: 1.6, legend: {}, probabilities: {}, confidence: 0.7 },
}

const CLAIM = 'do: x; see: y. (derived)'
const LONG_NOTE = 'n'.repeat(25000)
const CUT_NOTE = 'n'.repeat(20000)

{
  const jev = fakeJev(async () => NOTE_ANSWERS)
  const { lines, log } = recorder()
  const got = await readNote(jev, { title: 'T', claim: CLAIM, role: 'impl', note: LONG_NOTE }, log)

  assert.deepEqual(got, {
    stuck: 0.96,
    plan_defect: 0.02,
    divergence: 0.01,
    note_kind: 'blocker',
    operator_should_read: 2.7,
  },
  '(c) [M3] `readNote` resolves the FLATTENED reading — the three `noul` numbers, the ' +
  '`kind` answer\'s `choice` string as `note_kind`, the `score` number — and nothing else; ' +
  'got ' + JSON.stringify(got))

  assert.equal(jev.calls.length, 1,
    '(c) [M3] `readNote` calls `jev.ask` exactly once; got ' + jev.calls.length)
  assert.deepEqual(jev.calls[0][0], {
    state: { task: { title: 'T', claim: CLAIM }, note: CUT_NOTE, role: 'impl' },
    questions: NOTE_QUESTIONS,
  },
  '(c) [M3] with one argument deep-equal to `{ state: { task: { title, claim }, note: ' +
  '<note cut to NOTE_MAX_CHARS characters>, role }, questions: NOTE_QUESTIONS }` — the ' +
  'sitting\'s state shape exactly, the 25000-character note cut to 20000. Got a state of ' +
  JSON.stringify(jev.calls[0][0] && jev.calls[0][0].state, (k, v) =>
    (typeof v === 'string' && v.length > 60 ? v.slice(0, 40) + '…(' + v.length + ' chars)' : v)) +
  ' and questions ' + (jev.calls[0][0] && jev.calls[0][0].questions === NOTE_QUESTIONS
    ? 'deep-equal to NOTE_QUESTIONS' : JSON.stringify(jev.calls[0][0] && jev.calls[0][0].questions)))
  assert.deepEqual(lines, [],
    '(c) [M3] an answered note is no log line; got ' + JSON.stringify(lines))
}

{
  const jev = fakeJev(async () => AMENDMENT_ANSWERS)
  const { lines, log } = recorder()
  const amendment = { amends: 'files', what: 'w', why: 'y' }
  const got = await readAmendment(jev, { title: 'T', claim: 'c', amendment }, log)

  assert.deepEqual(got, { compelled: 0.8, plan_fault: 0.1, magnitude: 1.6 },
    '(c) [M3] `readAmendment` resolves `{ compelled, plan_fault, magnitude }` — two `noul` ' +
    'numbers and the `score` number; got ' + JSON.stringify(got))
  assert.equal(jev.calls.length, 1,
    '(c) [M3] `readAmendment` calls `jev.ask` exactly once; got ' + jev.calls.length)
  assert.deepEqual(jev.calls[0][0], {
    state: { task: { title: 'T', claim: 'c' }, amendment: { amends: 'files', what: 'w', why: 'y' } },
    questions: AMENDMENT_QUESTIONS,
  },
  '(c) [M3] with one argument deep-equal to `{ state: { task: { title, claim }, amendment: ' +
  '{ amends, what, why } }, questions: AMENDMENT_QUESTIONS }`; got ' +
  JSON.stringify(jev.calls[0][0]))
  assert.deepEqual(lines, [],
    '(c) [M3] an answered amendment is no log line; got ' + JSON.stringify(lines))
}

// The three lanes that answer nothing: `ask` resolves `null`, `ask` throws, and
// `ask` answers a partial set. Each is `null` out of both readers, exactly one
// `jev:` log line, and no throw of any kind.
const SILENT_LANES = [
  ['`ask` resolves `null`', () => async () => null],
  ['`ask` throws `new Error(\'boom\')`', () => () => { throw new Error('boom') }],
  ['`ask` rejects — the same throw, in its promise form', () => async () => { throw new Error('boom') }],
  ['`ask` answers `{ stuck }` alone, the rest missing', () => async () => ({ stuck: { type: 'noul', noul: 0.5 } })],
]

for (const [what, makeAnswer] of SILENT_LANES) {
  for (const [name, call] of [
    ['readNote', (jev, log) => readNote(jev, { title: 'T', claim: CLAIM, role: 'impl', note: 'n' }, log)],
    ['readAmendment', (jev, log) => readAmendment(jev,
      { title: 'T', claim: 'c', amendment: { amends: 'files', what: 'w', why: 'y' } }, log)],
  ]) {
    const jev = fakeJev(makeAnswer())
    const { lines, log } = recorder()
    let got = 'NOT SET'
    let threw = null
    try {
      got = await call(jev, log)
    } catch (error) {
      threw = error
    }
    assert.equal(threw, null,
      '(c) [M3] `' + name + '` throws nothing when ' + what + ' — Jev gates nothing, so no ' +
      'failed call leaves the reader as an exception. Got: ' +
      String(threw && (threw.message || threw)))
    assert.equal(got, null,
      '(c) [M3] `' + name + '` resolves `null` when ' + what + '; got ' + JSON.stringify(got))
    assert.equal(lines.length, 1,
      '(c) [M3] and `log` is called exactly once on that lane — one line, never a park and ' +
      'never a throw; got ' + JSON.stringify(lines))
    assert.equal(typeof lines[0] === 'string' && lines[0].startsWith('jev:'), true,
      '(c) [M3] with a string beginning `jev:`; got ' + JSON.stringify(lines[0]))
  }
}

// ══════════════════════════════════════════════════════════════════════════
// (d) [M4] no `jev`, no call at all — and a module that reaches nothing
// ══════════════════════════════════════════════════════════════════════════

for (const [name, call] of [
  ['readNote', (jev, log) => readNote(jev, { title: 'T', claim: CLAIM, role: 'impl', note: 'n' }, log)],
  ['readAmendment', (jev, log) => readAmendment(jev,
    { title: 'T', claim: 'c', amendment: { amends: 'files', what: 'w', why: 'y' } }, log)],
]) {
  for (const [label, absent] of [['null', null], ['undefined', undefined]]) {
    const { lines, log } = recorder()
    let got = 'NOT SET'
    let threw = null
    try {
      got = await call(absent, log)
    } catch (error) {
      threw = error
    }
    assert.equal(threw, null,
      '(d) [M4] `' + name + '(' + label + ', …)` throws nothing — a run with no `jev` client ' +
      'behaves as BASE does. Got: ' + String(threw && (threw.message || threw)))
    assert.equal(got, null,
      '(d) [M4] `' + name + '(' + label + ', …)` resolves `null`; got ' + JSON.stringify(got))
    assert.deepEqual(lines, [],
      '(d) [M4] and `log` is never called — an absent client is not a failed call; got ' +
      JSON.stringify(lines))
  }
}

// The module's own source: no credential, no file, no socket. The leg reads the
// SOURCE, so the strings below must be absent from comments too.
const SOURCE = fs.readFileSync(path.join(ROOT, 'fleet', 'jev-questions.mjs'), 'utf8')

/** Every module specifier the source imports or requires, however written. */
const specifiers = (src) => {
  const found = []
  const patterns = [
    /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)(['"])([^'"]+)\1/g,
    /\bimport\s+(['"])([^'"]+)\1/g,
  ]
  for (const re of patterns) {
    let m
    while ((m = re.exec(src)) !== null) found.push(m[2])
  }
  return found
}

const FORBIDDEN = ['node:fs', 'node:http', 'node:https', 'node:child_process']
const reached = specifiers(SOURCE).filter((s) =>
  FORBIDDEN.some((f) => s === f || s.startsWith(f + '/')))
assert.deepEqual(reached, [],
  '(d) [M4] `fleet/jev-questions.mjs` imports none of `node:fs`, `node:http`, `node:https`, ' +
  '`node:child_process` — the readers read no file and open no socket. It imports: ' +
  JSON.stringify(reached))
assert.equal(SOURCE.includes('process.env'), false,
  '(d) [M4] and the module\'s source carries no occurrence of `process.env` anywhere, ' +
  'comments included — no reader of this fleet reads an environment for a key')
assert.equal(SOURCE.includes('fetch('), false,
  '(d) [M4] and no occurrence of `fetch(` — the readers are functions OVER the client\'s ' +
  '`ask`, and the client is the one thing that calls the edge')

// ══════════════════════════════════════════════════════════════════════════
// (e) [M5] the README line, read by the Proof's own `Run:` command
// ══════════════════════════════════════════════════════════════════════════

// Run: sed -n '/^## The singletons/,/^## /p' fleet/tests/README.md | grep -q '<this file>'
//
// Read here rather than spawned: `test_sims_are_hermetic.mjs`'s M4 rule refuses
// any spawn in a sim whose command — or an identifier bound to one — carries a
// `test_*.mjs` name, and this `Run:` line carries this file's own. So the range
// is taken in JS with sed's own semantics (from the first line matching
// `^## The singletons` through the next line matching `^## `, inclusive) and
// matched for the same basename, which is the same read the driver's `Run:`
// line makes — and the driver still runs that line itself.
const README = fs.readFileSync(path.join(ROOT, 'fleet', 'tests', 'README.md'), 'utf8')
const sedRange = (text, start, end) => {
  const out = []
  let open = false
  for (const line of text.split('\n')) {
    if (!open) {
      if (start.test(line)) { open = true; out.push(line) }
      continue
    }
    out.push(line)
    if (end.test(line)) break
  }
  return out
}
const singletons = sedRange(README, /^## The singletons/, /^## /)
assert.ok(singletons.length > 0,
  '(e) [M5] sim precondition: `## The singletons` is still a section of ' +
  '`fleet/tests/README.md` — the range the Proof\'s `Run:` line reads')
assert.equal(singletons.some((line) => /test_jev_questions\.mjs/.test(line)), true,
  '(e) [M5] `fleet/tests/README.md` gains one line for `test_jev_questions.mjs` under ' +
  '`## The singletons` — the section the Proof\'s `Run:` line greps. The section read: ' +
  JSON.stringify(singletons.join('\n')))

console.log('ALL TESTS PASSED')
