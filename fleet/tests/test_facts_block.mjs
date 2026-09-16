/**
 * fleet/tests/test_facts_block.mjs — the exam for *the matcher and the FACTS
 * renderer*: given a run's rows and the files a brief is about, one function
 * picks the receipts on those files, keeps the block short, and renders nothing
 * at all when there is nothing to say.
 *
 * This file is the Proof's `Test: fleet/tests/test_facts_block.mjs`, written
 * where the Proof names it. Every relative import is written for THIS
 * directory: `../` is the repository's `fleet/`, `./` is `fleet/tests/`.
 *
 * The Machine clauses under test, restated:
 *
 *   M1 — `factsBlock(rows, paths)`, exported from `fleet/facts-block.mjs`,
 *        returns `''` when no row matches, and a row matches exactly when its
 *        `kind` is one of `RECEIPT_KINDS` (exported: `driver:exam-run`,
 *        `resolver:reply`, `driver:wave-blocked`, `driver:publish-fold`,
 *        `driver:finding`, `driver:finding-refuted`, `handshake:finding`), its
 *        `paths` is a non-empty array of strings, its `evidence` is an object
 *        whose `read` and `against` are strings, and at least one element of its
 *        `paths` equals, as a string, one element of `paths`.
 *   M2 — a non-empty result begins `\n\nFACTS: this run's record holds <n>
 *        receipt(s) on the files of this brief — what the driver observed, never
 *        what to do; a finding that rests on one names it as receipt <id>.` and
 *        continues with one line per matching row, `\n- receipt <id> <kind>
 *        [<paths joined by ', '>] read: <read> — against: <against>`, followed
 *        by ` — verdict: <verdict>` when the row has a string `verdict`, the
 *        rows in ascending `id`.
 *   M3 — when more than `FACTS_MAX_ROWS` (exported, `20`) rows match, the block
 *        carries the 20 with the greatest `id` and `<n>` is `20`; a `read` or
 *        `against` longer than `FACTS_FIELD_MAX` (exported, `500`) is rendered
 *        cut to 499 characters plus `…`.
 *   M4 — `receiptRows(file)`, exported from the same module, parses one
 *        `events.jsonl` file into its rows, skipping lines that are not JSON
 *        objects, and returns `[]` for a file that does not exist; it reads no
 *        other path.
 *
 * The Proof legs, in the Proof's own order, and where each is answered below:
 *
 *   (a) [M1] `RECEIPT_KINDS` deep-equals the seven kinds; each of the seven,
 *            carried by one well-formed receipt row on `a.txt`, renders against
 *            `['a.txt']` a block with exactly one `- receipt` line naming that
 *            kind; `factsBlock([], ['a.txt'])` is `''`; a `driver:exam-run` row
 *            with `paths ['b.txt']` renders `''` against `['a.txt']` and a block
 *            against `['a.txt', 'b.txt']`; a `driver:proof-run` row renders
 *            `''`; a `driver:finding` row with no `evidence` renders `''`; a row
 *            with `paths ['dir/a.txt']` renders `''` against `['a.txt']`
 *   (b) [M2] two matching rows, ids `01B` (carrying `verdict: 'flaky'`) and
 *            `01A`: the result equals, byte for byte, the header with
 *            `2 receipt(s)`, then the `01A` line, then the `01B` line — the
 *            `01B` line ending ` — verdict: flaky`, the `01A` line carrying no
 *            `verdict`
 *   (c) [M3] 25 matching rows, ids `01A00` through `01A24`: exactly 20
 *            `- receipt` lines, the first `01A05`, the last `01A24`, and a
 *            header saying `20 receipt(s)`
 *   (d) [M3] a 700-character `read` renders a `read` of exactly 500 characters
 *            ending in `…`; a 500-character `against` is rendered whole
 *   (e) [M4] `receiptRows` over a file of three lines — one receipt row, one
 *            `engine:log` row, one line `not json` — returns two objects in file
 *            order, and over a path that does not exist returns `[]`
 *
 * Beside the legs, the clause text each leg leaves unasked is asked once, under
 * the clause it comes from and never under a leg's name: M1's "non-empty array
 * of strings" and "an object whose `read` and `against` are strings", M2's "when
 * the row has a STRING `verdict`", M3's two exported bounds, and M4's "lines
 * that are not JSON objects" for the JSON that parses to something other than an
 * object.
 *
 * ── the readings this exam is written on ────────────────────────────────────
 *
 *   • M2's HEADER SENTENCE ENDS `… names it as receipt <id>.`, and `<id>` is
 *     rendered LITERALLY while `<n>` is substituted. A block carries n rows,
 *     each with its own id, so there is no id to put there; the `<id>` is the
 *     FORM a judge is told to cite a receipt in, part of the block's own header
 *     sentence. Leg (b) asks for a byte-for-byte equality on a two-row block, so
 *     this exam must take one reading, and this is the only one coherent at
 *     n = 2. The header is typed once, below, as `header(n)`.
 *   • A ROW'S `[<paths>]` IS THE ROW'S OWN `paths`, all of them, joined by
 *     `', '` — M2 says "its `paths`", not "the paths that matched". Leg (b)'s
 *     `01A` row carries two paths so the join is exercised by the same byte
 *     comparison the leg asks for.
 *   • ASCENDING `id` IS A STRING ORDER (the Context: ids are ULIDs, lexically
 *     ordered by time, so ascending is append order and greatest is newest).
 *     Leg (c)'s 25 rows are therefore handed to `factsBlock` NEWEST FIRST — the
 *     reverse of the order the block must render — so that a renderer which
 *     merely kept the argument's order cannot pass, and its `01A00`…`01A24` ids
 *     are zero-padded so lexical and numeric ascent agree.
 *   • `…` IS ONE JavaScript CHARACTER (U+2026), so M3's cut is 499 + 1 = 500,
 *     which is what leg (d) counts.
 *   • THIS FILE SPAWNS NOTHING and opens no path outside the one `mkdtemp`
 *     directory it creates: legs (a)–(d) build rows in memory, and leg (e)
 *     writes its `events.jsonl` under `os.tmpdir()`.
 *   • THE IMPORT IS DYNAMIC so a tree without the module reports the first
 *     assertion below rather than dying at load with a resolution error.
 *
 * WHY THIS IS RED AT BASE. `fleet/facts-block.mjs` does not exist, so the
 * dynamic import fails and the first assertion names it as the absent
 * deliverable.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'facts-block-'))
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }))

/** A value, cut for an assertion message. */
const show = (value) => {
  const text = typeof value === 'string' ? JSON.stringify(value) : JSON.stringify(value ?? null)
  return text.length > 600 ? text.slice(0, 600) + '…' : text
}

// ── the deliverable ─────────────────────────────────────────────────────────
let mod = null
let importError = null
try {
  mod = await import('../facts-block.mjs')
} catch (error) {
  importError = error
}

assert.equal(importError, null,
  '(a)/M1: `fleet/facts-block.mjs` must exist and export `factsBlock`, `receiptRows`, ' +
  '`RECEIPT_KINDS`, `FACTS_MAX_ROWS` and `FACTS_FIELD_MAX` — importing it failed: ' +
  String(importError && importError.message ? importError.message : importError))

const { factsBlock, receiptRows, RECEIPT_KINDS, FACTS_MAX_ROWS, FACTS_FIELD_MAX } = mod

for (const [name, value] of [['factsBlock', factsBlock], ['receiptRows', receiptRows]]) {
  assert.equal(typeof value, 'function',
    '(a)/M1: `fleet/facts-block.mjs` exports `' + name + '` as a function, got ' + typeof value)
}

// ── the literals the Machine clauses spell, spelled once ────────────────────

/** M1's `RECEIPT_KINDS`, in the clause's own order. */
const KINDS = [
  'driver:exam-run',
  'resolver:reply',
  'driver:wave-blocked',
  'driver:publish-fold',
  'driver:finding',
  'driver:finding-refuted',
  'handshake:finding',
]

/** M2's header sentence, `<n>` substituted and `<id>` left as the form it is. */
const header = (n) =>
  '\n\nFACTS: this run\'s record holds ' + n + ' receipt(s) on the files of this brief — ' +
  'what the driver observed, never what to do; a finding that rests on one names it as receipt <id>.'

/** M2's row line, written from the clause rather than from the implementation. */
const rowLine = (id, kind, paths, read, against, verdict) =>
  '\n- receipt ' + id + ' ' + kind + ' [' + paths.join(', ') + '] ' +
  'read: ' + read + ' — against: ' + against +
  (verdict === undefined ? '' : ' — verdict: ' + verdict)

/** The `- receipt` lines of a block. */
const receiptLines = (block) =>
  String(block).split('\n').filter((line) => line.startsWith('- receipt '))

/** The id a `- receipt` line names: `- receipt <id> <kind> …`. */
const idOf = (line) => line.split(' ')[2]

/** A well-formed receipt row on the given paths. */
const row = (id, kind, paths, extra = {}) => ({
  id,
  kind,
  paths,
  evidence: { read: 'the exam ran red', against: 'the mutant' },
  ...extra,
})

const READ = 'the exam ran red'
const AGAINST = 'the mutant'

// ── (a) [M1] the seven kinds, and the seven shapes that do not match ────────

assert.deepEqual(RECEIPT_KINDS, KINDS,
  '(a)/M1: `RECEIPT_KINDS` deep-equals the seven kinds of the clause, in its order: ' +
  show(RECEIPT_KINDS))

for (const kind of KINDS) {
  const block = factsBlock([row('01A', kind, ['a.txt'])], ['a.txt'])
  const lines = receiptLines(block)
  assert.equal(lines.length, 1,
    '(a)/M1: one well-formed receipt row of kind `' + kind + '` on `a.txt`, against ' +
    '`[\'a.txt\']`, renders a block with exactly one `- receipt` line — got ' + lines.length +
    ': ' + show(block))
  assert.equal(lines[0].includes(kind), true,
    '(a)/M1: that one `- receipt` line names the kind `' + kind + '`: ' + show(lines[0]))
  assert.equal(block, header(1) + rowLine('01A', kind, ['a.txt'], READ, AGAINST),
    '(a)/M2: and the whole block is the header with `1 receipt(s)` and that one line, byte ' +
    'for byte: ' + show(block))
}

assert.equal(factsBlock([], ['a.txt']), '',
  '(a)/M1: `factsBlock([], [\'a.txt\'])` is the empty string — nothing to say renders nothing ' +
  'at all: ' + show(factsBlock([], ['a.txt'])))

{
  const elsewhere = row('01A', 'driver:exam-run', ['b.txt'])
  assert.equal(factsBlock([elsewhere], ['a.txt']), '',
    '(a)/M1: a `driver:exam-run` row whose `paths` is `[\'b.txt\']` matches none of ' +
    '`[\'a.txt\']`, so the block is the empty string: ' + show(factsBlock([elsewhere], ['a.txt'])))
  assert.equal(
    factsBlock([elsewhere], ['a.txt', 'b.txt']),
    header(1) + rowLine('01A', 'driver:exam-run', ['b.txt'], READ, AGAINST),
    '(a)/M1: the same row against `[\'a.txt\', \'b.txt\']` matches on `b.txt` and renders a ' +
    'block: ' + show(factsBlock([elsewhere], ['a.txt', 'b.txt'])))
}

assert.equal(factsBlock([row('01A', 'driver:proof-run', ['a.txt'])], ['a.txt']), '',
  '(a)/M1: `driver:proof-run` is not one of `RECEIPT_KINDS`, so a well-formed receipt of that ' +
  'kind on `a.txt` renders the empty string')

assert.equal(factsBlock([{ id: '01A', kind: 'driver:finding', paths: ['a.txt'] }], ['a.txt']), '',
  '(a)/M1: a `driver:finding` row with `paths [\'a.txt\']` and no `evidence` is not a receipt, ' +
  'so it renders the empty string')

assert.equal(factsBlock([row('01A', 'driver:finding', ['dir/a.txt'])], ['a.txt']), '',
  '(a)/M1: the match is exact string equality — `dir/a.txt` never matches `a.txt` — so a row ' +
  'on `[\'dir/a.txt\']` against `[\'a.txt\']` renders the empty string')

// ── [M1] the clause's remaining shapes, asked once each ─────────────────────

for (const [why, candidate] of [
  ['its `paths` is empty, and M1 asks for a NON-EMPTY array',
    { id: '01A', kind: 'driver:finding', paths: [], evidence: { read: READ, against: AGAINST } }],
  ['its `paths` is not an array',
    { id: '01A', kind: 'driver:finding', paths: 'a.txt', evidence: { read: READ, against: AGAINST } }],
  ['its `paths` carries an element that is not a string, and M1 asks for an array OF STRINGS',
    { id: '01A', kind: 'driver:finding', paths: ['a.txt', 7], evidence: { read: READ, against: AGAINST } }],
  ['its `evidence` is null, and M1 asks for an OBJECT whose `read` and `against` are strings',
    { id: '01A', kind: 'driver:finding', paths: ['a.txt'], evidence: null }],
  ['its `evidence.read` is not a string',
    { id: '01A', kind: 'driver:finding', paths: ['a.txt'], evidence: { read: 7, against: AGAINST } }],
  ['its `evidence.against` is missing',
    { id: '01A', kind: 'driver:finding', paths: ['a.txt'], evidence: { read: READ } }],
  ['it carries no `kind` at all',
    { id: '01A', paths: ['a.txt'], evidence: { read: READ, against: AGAINST } }],
]) {
  assert.equal(factsBlock([candidate], ['a.txt']), '',
    '[M1]: a row does not match when ' + why + ', so the block is the empty string: ' +
    show(candidate))
}

// ── (b) [M2] the header, the order, the join and the verdict, byte for byte ──

{
  const first = {
    id: '01B',
    kind: 'driver:exam-run',
    paths: ['a.txt'],
    evidence: { read: 'the exam ran red twice', against: 'the mutant' },
    verdict: 'flaky',
  }
  const second = {
    id: '01A',
    kind: 'resolver:reply',
    paths: ['a.txt', 'b.txt'],
    evidence: { read: 'the resolver took the frontier hunk', against: 'the incoming side' },
  }

  const expected =
    header(2) +
    '\n- receipt 01A resolver:reply [a.txt, b.txt] ' +
    'read: the resolver took the frontier hunk — against: the incoming side' +
    '\n- receipt 01B driver:exam-run [a.txt] ' +
    'read: the exam ran red twice — against: the mutant — verdict: flaky'

  const block = factsBlock([first, second], ['a.txt'])
  assert.equal(block, expected,
    '(b)/M2: two matching rows, ids `01B` (carrying `verdict: \'flaky\'`) and `01A`, render — ' +
    'byte for byte — the header with `2 receipt(s)`, then the `01A` line, then the `01B` line: ' +
    show(block))

  const lines = receiptLines(block)
  assert.deepEqual(lines.map(idOf), ['01A', '01B'],
    '(b)/M2: the rows render in ascending `id`, `01A` before `01B`, against the order they were ' +
    'handed in: ' + show(lines.map(idOf)))
  assert.equal(lines[1].endsWith(' — verdict: flaky'), true,
    '(b)/M2: the `01B` line ends ` — verdict: flaky`: ' + show(lines[1]))
  assert.equal(lines[0].includes('verdict'), false,
    '(b)/M2: the `01A` line carries no `verdict` — the suffix is rendered only for a row that ' +
    'has one: ' + show(lines[0]))
}

// ── [M2] the verdict suffix is for a STRING `verdict` and no other ──────────

{
  const numeric = row('01A', 'driver:finding', ['a.txt'], { verdict: 7 })
  assert.equal(factsBlock([numeric], ['a.txt']),
    header(1) + rowLine('01A', 'driver:finding', ['a.txt'], READ, AGAINST),
    '[M2]: ` — verdict: <verdict>` follows the line only when the row has a STRING `verdict`, ' +
    'so a row carrying `verdict: 7` renders the line without the suffix: ' +
    show(factsBlock([numeric], ['a.txt'])))
}

// ── (c) [M3] the bound: the 20 with the greatest `id` ───────────────────────

assert.equal(FACTS_MAX_ROWS, 20, '(c)/M3: `FACTS_MAX_ROWS` is exported as `20`')

{
  // Handed newest first — the reverse of the order M2 renders — so a renderer
  // that kept the argument's order cannot pass this leg.
  const ids = Array.from({ length: 25 }, (_, i) => '01A' + String(i).padStart(2, '0'))
  const rows = ids.map((id) => row(id, 'driver:exam-run', ['a.txt'])).reverse()

  const block = factsBlock(rows, ['a.txt'])
  const lines = receiptLines(block)

  assert.equal(lines.length, 20,
    '(c)/M3: 25 matching rows render exactly 20 `- receipt` lines — the block is bounded at ' +
    '`FACTS_MAX_ROWS`: got ' + lines.length)
  assert.equal(idOf(lines[0]), '01A05',
    '(c)/M3: the first of the 20 is `01A05` — the block carries the 20 with the greatest `id`: ' +
    show(idOf(lines[0])))
  assert.equal(idOf(lines[19]), '01A24',
    '(c)/M3: the last of the 20 is `01A24`: ' + show(idOf(lines[19])))
  assert.deepEqual(lines.map(idOf), ids.slice(5),
    '(c)/M3: and the 20 stand in ascending `id`, `01A05` through `01A24`: ' + show(lines.map(idOf)))
  assert.equal(block.startsWith(header(20)), true,
    '(c)/M3: the header says `20 receipt(s)` — `<n>` is the number of rows the block carries, ' +
    'not the number that matched: ' + show(block.slice(0, 260)))
}

// ── (d) [M3] the field cut ─────────────────────────────────────────────────

assert.equal(FACTS_FIELD_MAX, 500, '(d)/M3: `FACTS_FIELD_MAX` is exported as `500`')

{
  const long = 'x'.repeat(700)
  const whole = 'y'.repeat(500)
  const cut = 'x'.repeat(499) + '…'
  const rendered = factsBlock(
    [{ id: '01A', kind: 'driver:finding', paths: ['a.txt'], evidence: { read: long, against: whole } }],
    ['a.txt'])

  assert.equal(rendered, header(1) + rowLine('01A', 'driver:finding', ['a.txt'], cut, whole),
    '(d)/M3: a 700-character `read` is rendered cut to 499 characters plus `…`, and a ' +
    '500-character `against` is rendered whole: ' + show(rendered.slice(0, 300)))

  const line = receiptLines(rendered)[0]
  const body = line.slice(line.indexOf('] read: ') + '] read: '.length)
  const [readField, againstField] = body.split(' — against: ')
  assert.equal(readField.length, 500,
    '(d)/M3: the rendered `read` is exactly 500 characters long: got ' + readField.length)
  assert.equal(readField.endsWith('…'), true,
    '(d)/M3: the rendered `read` ends in `…`: ' + show(readField.slice(-10)))
  assert.equal(againstField, whole,
    '(d)/M3: the 500-character `against` is rendered whole — `FACTS_FIELD_MAX` is a length that ' +
    'is allowed, not one that is cut: got ' + againstField.length + ' characters')
}

// ── (e) [M4] `receiptRows` over one file, and over a path that is not there ──

{
  const receipt = {
    id: '01A',
    kind: 'driver:exam-run',
    paths: ['a.txt'],
    evidence: { read: 'the exam ran red', against: 'the mutant' },
  }
  const log = { id: '01B', kind: 'engine:log', line: 'wave 1 open' }

  const dir = path.join(tmp, 'leg-e')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'events.jsonl')
  fs.writeFileSync(file,
    JSON.stringify(receipt) + '\n' + JSON.stringify(log) + '\n' + 'not json' + '\n')

  // A neighbour in the same directory, and a neighbour one level up, each
  // holding rows of their own: M4's "it reads no other path", asked by what
  // comes back.
  fs.writeFileSync(path.join(dir, 'other.jsonl'),
    JSON.stringify({ id: '01Z', kind: 'driver:finding', paths: ['z.txt'] }) + '\n')
  fs.writeFileSync(path.join(tmp, 'events.jsonl'),
    JSON.stringify({ id: '01Y', kind: 'driver:finding', paths: ['y.txt'] }) + '\n')

  const rows = receiptRows(file)
  assert.deepEqual(rows, [receipt, log],
    '(e)/M4: `receiptRows` over a file of three lines — one receipt row, one `engine:log` row, ' +
    'one line `not json` — returns the two objects in file order, and nothing of any ' +
    'neighbouring file: ' + show(rows))

  assert.deepEqual(receiptRows(path.join(dir, 'absent.jsonl')), [],
    '(e)/M4: a file that does not exist is `[]`, never a throw: ' +
    show(receiptRows(path.join(dir, 'absent.jsonl'))))
}

// ── [M4] a line that is not a JSON OBJECT is skipped, whatever it parses to ──

{
  const kept = { id: '01A', kind: 'driver:finding', paths: ['a.txt'], evidence: { read: 'r', against: 'a' } }
  const file = path.join(tmp, 'shapes.jsonl')
  fs.writeFileSync(file, [
    '',
    '42',
    '"a string"',
    '[1, 2]',
    'null',
    JSON.stringify(kept),
    '{ broken',
    '',
  ].join('\n'))

  assert.deepEqual(receiptRows(file), [kept],
    '[M4]: `receiptRows` skips every line that is not a JSON object — the blank lines, the ' +
    'number, the string, the array, the `null` and the unparseable one — and keeps the object: ' +
    show(receiptRows(file)))
}

console.log('ALL TESTS PASSED')
