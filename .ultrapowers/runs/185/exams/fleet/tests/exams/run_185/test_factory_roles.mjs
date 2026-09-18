/**
 * fleet/tests/exams/run_185/test_factory_roles.mjs — the exam for Task 4:
 * *three roles — produce and discover, never grade, in nine hundred words*.
 *
 * This file is the Proof's `Test: fleet/tests/test_factory_roles.mjs`, written
 * at the landing path the run's exam handoff names for it
 * (`fleet/tests/exams/run_185/`). Every path below is resolved from THIS
 * directory, not from the path the Proof maps from and not from the caller's
 * cwd: `../../../..` is the repository root, so `ROOT/factory/roles/` is the
 * directory the three briefs land in.
 *
 * The Claim under test: the three people the factory hires — the one who
 * builds, the one who writes the exam first, the one who resolves a conflict —
 * each get a brief short enough to read in a minute that tells them what to
 * make and never how they will be marked.
 *
 * The Machine clauses, restated:
 *
 *   M1 — the three files `factory/roles/implement.md`, `factory/roles/exam.md`
 *        and `factory/roles/resolve.md` exist, and their word counts sum to
 *        900 or fewer.
 *   M2 — `implement.md` names each of the literal prompt sections `TASK:`,
 *        `FILES:`, `TEST COMMAND:`, `INTERFACES:` and `AMENDMENTS:` once, tells
 *        the worker it may edit only the listed files, to iterate against the
 *        test command, to declare a divergence as an amendment rather than hide
 *        it, and to post a hand-in note through the `note` tool naming what it
 *        exported; `exam.md` tells the worker to write only the exam files the
 *        task names, to assert exactly the Machine clauses, and not to create
 *        the module under test; `resolve.md` states the three rules — carry
 *        every line both sides had, never drop a side without saying so in the
 *        narration, invent nothing that appears in neither side nor the
 *        narration — and names the reply shape
 *        `{ status, hunks: [{ id, content }], notes }`.
 *   M3 — none of the three files contains any of the words `blocking`,
 *        `minor`, `severity` or `verdict`, and none contains the tokens `MUST`,
 *        `NEVER` or `ALWAYS` in capitals.
 *   M4 — no file states that the worker may run `git` — the string `git ` does
 *        not appear in `implement.md` or `exam.md` except inside the sentence
 *        that forbids it.
 *
 * The Proof legs, and where each is answered below — every assertion names its
 * leg and the clause it comes from, so a reader can map this file back to the
 * contract:
 *
 *   (a) [M1] each of the three paths exists and is non-empty, and the sum of
 *            their whitespace-separated word counts is at most 900.
 *   (b) [M2] `implement.md` carries each of the five literal prompt sections
 *            exactly once, a sentence with `only` and either `listed` or
 *            `FILES`, a sentence with `TEST COMMAND` and either `iterate`,
 *            `rerun` or `until`, the word `amendment`, and a sentence with
 *            `note` and `export`; `exam.md` carries a sentence with `only` and
 *            `exam` or `Test`, the word `Machine`, and a phrase with `not` and
 *            `create`; `resolve.md` carries `both`, `narration`, `invent` and
 *            each of the five reply-shape tokens `status`, `hunks`, `id`,
 *            `content`, `notes`.
 *   (c) [M3] for each of `blocking`, `minor`, `severity`, `verdict`: no
 *            case-insensitive whole-word match in any of the three files; for
 *            each of `MUST`, `NEVER`, `ALWAYS`: no case-sensitive whole-word
 *            match in any of the three. (Also the Proof's second `Run:`.)
 *   (d) [M4] in `implement.md` and `exam.md`, every line containing `git `
 *            also contains `not` or `never`.
 *
 * The readings this file pins, where a leg's words leave a choice:
 *
 *   - (a) the sum is of the three PER-FILE word counts, as the leg words it.
 *     That is the Proof's `cat … | wc -w` plus at most one word per file that
 *     ends without a trailing newline (where `cat` would fuse two words), so
 *     the leg's form is the stricter of the two and passing it passes the
 *     `Run:` line.
 *   - (b) "a sentence" in a markdown brief: the text is cut at blank lines and
 *     at the start of a new block (list marker, heading, blockquote), then at
 *     terminal `.`/`!`/`?`. A sentence wrapped across two lines therefore stays
 *     one sentence, and two adjacent bullets do not merge into one.
 *   - (b) `only` is its own word and not the tail of a hyphenated one: a brief
 *     calling the rest of the tree `read-only` has not thereby said the worker
 *     may edit only the listed files.
 *   - (b) `amendment` is matched as a lowercase or initial-capital whole word,
 *     which is the leg's own typography and a different word from the
 *     `AMENDMENTS:` section header the same clause already pins exactly once.
 *   - (b) `not` in "a phrase with `not` and `create`" is the leg's word
 *     verbatim, not widened to `never` or `cannot`.
 *   - (d) the trigger is the literal `git ` with its trailing space, as the leg
 *     spells it, and "contains `not` or `never`" is read as a substring so that
 *     `cannot` satisfies it.
 *
 * Nothing here spawns a process, reaches a network, or writes a file: the exam
 * reads the three briefs and nothing else, and it imports no module under test.
 * At BASE it is red on leg (a) — `factory/roles/` holds none of the three
 * files yet.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
// fleet/tests/exams/run_185 → exams → tests → fleet → the repository root.
const ROOT = path.resolve(HERE, '..', '..', '..', '..')
const ROLES = path.join(ROOT, 'factory', 'roles')

/** The three briefs, by the names the Proof and the Files slot spell. */
const IMPLEMENT = 'factory/roles/implement.md'
const EXAM = 'factory/roles/exam.md'
const RESOLVE = 'factory/roles/resolve.md'
const FILES = [IMPLEMENT, EXAM, RESOLVE]

/** The ceiling M1 names, and the Proof's first `Run:` line. */
const WORD_CEILING = 900

const abs = (rel) => path.join(ROOT, rel)

/** `wc -w`'s own rule: words are runs of non-whitespace. */
const wordCount = (text) => text.split(/\s+/).filter(Boolean).length

/** Non-overlapping occurrences of a literal. */
const countOf = (text, literal) => text.split(literal).length - 1

/** A whole-word matcher. `flags` carries `i` where the leg is case-blind. */
const word = (w, flags = 'i') => new RegExp('\\b' + w + '\\b', flags)

/**
 * `only` as its own word, and not the tail of a hyphenated one: a brief that
 * calls the rest of the tree `read-only` has not thereby told the worker it may
 * edit only the listed files, and `\bonly\b` alone would have accepted it.
 */
const ONLY = /(?<![\w-])only(?![\w-])/i

/**
 * The markdown sentence unit the (b) legs are read against: cut at blank lines
 * and at the start of a new block, then at terminal punctuation. Continuation
 * lines stay with their sentence; adjacent bullets stay apart.
 */
const NEW_BLOCK = /^\s*(?:[-*+]\s|\d+[.)]\s|#{1,6}\s|>\s|\||```)/
const sentences = (text) => {
  const blocks = []
  let cur = []
  const flush = () => { if (cur.length) blocks.push(cur.join(' ')); cur = [] }
  for (const line of text.split('\n')) {
    if (line.trim() === '') { flush(); continue }
    if (NEW_BLOCK.test(line)) flush()
    cur.push(line.trim())
  }
  flush()
  return blocks
    .flatMap((block) => block.split(/(?<=[.!?])\s+/))
    .map((s) => s.trim())
    .filter(Boolean)
}

/** The first sentence satisfying every regex in `needs`, or null. */
const sentenceWith = (text, needs) =>
  sentences(text).find((s) => needs.every((re) => re.test(s))) ?? null

// ── (a) [M1]: the three briefs exist, are non-empty, and sum to ≤ 900 words ──
// The first assertion of the exam is also its reading at BASE: the three files
// are not written yet, so this is where an unimplemented task goes red.
const text = {}
{
  for (const rel of FILES) {
    assert.ok(fs.existsSync(abs(rel)),
      '(a) [M1]: `' + rel + '` exists — the three briefs the factory hires ' +
      'against are the three files the task creates. Looked at: ' + abs(rel))
    assert.ok(fs.statSync(abs(rel)).isFile(),
      '(a) [M1]: `' + rel + '` is a regular file, not a directory: ' + abs(rel))
    text[rel] = fs.readFileSync(abs(rel), 'utf8')
    assert.ok(text[rel].trim().length > 0,
      '(a) [M1]: `' + rel + '` is non-empty — a brief with nothing in it tells ' +
      'a worker nothing. Bytes: ' + text[rel].length)
  }

  const counts = FILES.map((rel) => [rel, wordCount(text[rel])])
  const total = counts.reduce((sum, [, n]) => sum + n, 0)
  assert.ok(total <= WORD_CEILING,
    '(a) [M1]: the three briefs sum to at most ' + WORD_CEILING + ' ' +
    'whitespace-separated words — a minute\'s reading each, against the six ' +
    'files and 5,983 words they replace. Got ' + total + ': ' +
    counts.map(([rel, n]) => rel + '=' + n).join(', '))
  console.log('(a) [M1]: word counts ' +
    counts.map(([rel, n]) => path.basename(rel) + '=' + n).join(' ') +
    ' total=' + total + ' ceiling=' + WORD_CEILING)
}

// ── (b) [M2]: implement.md — the five sections, once each ───────────────────
{
  const SECTIONS = ['TASK:', 'FILES:', 'TEST COMMAND:', 'INTERFACES:', 'AMENDMENTS:']
  for (const section of SECTIONS) {
    assert.equal(countOf(text[IMPLEMENT], section), 1,
      '(b) [M2]: `implement.md` names the literal prompt section `' + section +
      '` exactly once — the engine assembles these five, in this order, and a ' +
      'role file names them so the worker knows the brief\'s shape. Occurrences: ' +
      countOf(text[IMPLEMENT], section))
  }
}

// ── (b) [M2]: implement.md — the four things it tells the worker ────────────
{
  const only = sentenceWith(text[IMPLEMENT], [ONLY, /\blisted\b|FILES/i])
  assert.ok(only !== null,
    '(b) [M2]: `implement.md` carries a sentence with `only` and either ' +
    '`listed` or `FILES` — the worker may edit only the listed files. No ' +
    'sentence of the brief carries both.')

  const iterate = sentenceWith(text[IMPLEMENT], [/TEST COMMAND/, /iterat|re-?run|\buntil\b/i])
  assert.ok(iterate !== null,
    '(b) [M2]: `implement.md` carries a sentence with `TEST COMMAND` and one ' +
    'of `iterate`, `rerun` or `until` — the worker iterates against the test ' +
    'command. No sentence of the brief carries both.')

  assert.ok(/\b[Aa]mendments?\b/.test(text[IMPLEMENT]),
    '(b) [M2]: `implement.md` carries the word `amendment` — a divergence is ' +
    'declared as an amendment rather than hidden. The all-capitals ' +
    '`AMENDMENTS:` section header is a different word and does not answer this.')

  const note = sentenceWith(text[IMPLEMENT], [word('notes?'), /export/i])
  assert.ok(note !== null,
    '(b) [M2]: `implement.md` carries a sentence with `note` and `export` — ' +
    'the worker posts a hand-in note through the `note` tool naming what it ' +
    'exported. No sentence of the brief carries both.')
}

// ── (b) [M2]: exam.md — write the named exams, assert the clauses, build nothing ──
{
  const only = sentenceWith(text[EXAM], [ONLY, /exam|test/i])
  assert.ok(only !== null,
    '(b) [M2]: `exam.md` carries a sentence with `only` and `exam` or `Test` — ' +
    'the worker writes only the exam files the task names. No sentence of the ' +
    'brief carries both.')

  assert.ok(word('machine').test(text[EXAM]),
    '(b) [M2]: `exam.md` carries the word `Machine` — the exam asserts exactly ' +
    'the Machine clauses, which is the one thing it is written against.')

  const create = sentenceWith(text[EXAM], [word('not'), /creat/i])
  assert.ok(create !== null,
    '(b) [M2]: `exam.md` carries a phrase with `not` and `create` — the ' +
    'examiner does not create the module under test, which is what keeps the ' +
    'exam red at BASE for the one right reason. No sentence of the brief ' +
    'carries both.')
}

// ── (b) [M2]: resolve.md — the three rules and the reply shape ──────────────
{
  const RULES = [
    ['both', 'carry every line both sides had'],
    ['narration', 'never drop a side without saying so in the narration'],
    ['invent\\w*', 'invent nothing that appears in neither side nor the narration'],
  ]
  for (const [token, rule] of RULES) {
    assert.ok(word(token).test(text[RESOLVE]),
      '(b) [M2]: `resolve.md` carries `' + token.replace('\\w*', '') + '` — the ' +
      'rule *' + rule + '*, restated in a sentence.')
  }

  const SHAPE = ['status', 'hunks', 'id', 'content', 'notes']
  for (const token of SHAPE) {
    assert.ok(word(token).test(text[RESOLVE]),
      '(b) [M2]: `resolve.md` names `' + token + '` — the reply shape is ' +
      '`{ status, hunks: [{ id, content }], notes }`, and a resolver that is ' +
      'not told the shape cannot answer in it.')
  }
}

// ── (c) [M3]: no grading vocabulary, no shouted imperatives ─────────────────
// Also the Proof's second `Run:`, which greps the same four words over the same
// three files and expects zero hits.
{
  const GRADING = ['blocking', 'minor', 'severity', 'verdict']
  const SHOUTED = ['MUST', 'NEVER', 'ALWAYS']
  const hitsOf = (body, re) => body.split('\n')
    .map((line, n) => [n + 1, line])
    .filter(([, line]) => re.test(line))
    .map(([n, line]) => n + ': ' + line.trim().slice(0, 160))

  for (const rel of FILES) {
    for (const w of GRADING) {
      assert.deepEqual(hitsOf(text[rel], word(w, 'i')), [],
        '(c) [M3]: `' + rel + '` contains no whole word `' + w + '` in any ' +
        'case — a role file states what to produce and what to look for, never ' +
        'how a finding is graded; the referee discovers and Jev grades. Lines ' +
        'that do: ' + JSON.stringify(hitsOf(text[rel], word(w, 'i'))))
    }
    for (const w of SHOUTED) {
      assert.deepEqual(hitsOf(text[rel], word(w, '')), [],
        '(c) [M3]: `' + rel + '` contains no whole word `' + w + '` in ' +
        'capitals — the shouted imperatives CLAUDE.md §Conventions pins ' +
        'against. Lines that do: ' + JSON.stringify(hitsOf(text[rel], word(w, ''))))
    }
  }
}

// ── (d) [M4]: `git ` appears only where it is forbidden ─────────────────────
{
  for (const rel of [IMPLEMENT, EXAM]) {
    const offenders = text[rel].split('\n')
      .map((line, n) => [n + 1, line])
      .filter(([, line]) => line.includes('git '))
      .filter(([, line]) => !/not|never/i.test(line))
      .map(([n, line]) => n + ': ' + line.trim().slice(0, 160))
    assert.deepEqual(offenders, [],
      '(d) [M4]: every line of `' + rel + '` carrying the string `git ` also ' +
      'carries `not` or `never` — models never run git; every `git` invocation ' +
      'is the engine\'s own `child_process`, and the only sentence naming it ' +
      'is the one that forbids it. Lines that name it otherwise: ' +
      JSON.stringify(offenders))
  }
}

console.log('ALL TESTS PASSED')
