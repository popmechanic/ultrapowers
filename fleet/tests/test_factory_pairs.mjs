/**
 * fleet/tests/test_factory_pairs.mjs — the exam for *the pair builder*: given
 * one pair of tasks that could meet, `factory/pairs.mjs` assembles the small
 * picture a judge is shown (the two tasks, the outline of each file they
 * share, and which parts of it each names), decides by itself when the two
 * plainly edit different parts of a shared file, and afterwards labels the
 * pair with what actually happened.
 *
 * This file is the Proof's `Test: fleet/tests/test_factory_pairs.mjs`,
 * written where the Proof names it. Every relative import is written for
 * THIS directory: `../../` is the repository root, so the deliverable is
 * `../../factory/pairs.mjs`.
 *
 * The Machine clauses under test, restated:
 *
 *   M1 — `outlineOf(text, path)` answers the file's top-level constructs in
 *        order as `[{ name, kind }]`, dispatched on `path`'s extension
 *        (`.mjs`/`.js`/`.ts` code lines, `.py` `def`/`class`, `.md` headings,
 *        `.json` top-level keys, anything else `[]`), at most 200 entries.
 *   M2 — `pairState({ pair, tasks, read })` resolves `{ producer, consumer,
 *        shared, shape }`. `producer`/`consumer` are `{ id, title, claim,
 *        machine, interfaces, files, context, legs }` read off the two
 *        tasks' bodies, `legs` only on the consumer, the producer is
 *        `pair.a` for a files-only pair. `shared` is one `{ path,
 *        exists_at_base, outline, producer_hits, consumer_hits }` per
 *        `pair.paths` entry, hits being the outline names that occur as
 *        whole words inside any backticked span of a task's body. `shape`
 *        is `{ symbol, stated_in_consumer }`. The serialized state is at
 *        most 60,000 bytes, outlines cut from the end first.
 *   M3 — `decideByCode(state)` is `'fold'` when the pair has at least one
 *        shared path, no `symbol`, and every shared path's two hit lists
 *        are both non-empty and disjoint; otherwise `null`.
 *   M4 — `labelPair({ pair, tasks, read, folds })` answers `{ a, b, calls,
 *        fold }`: `calls` true when `pair.symbol` occurs as a whole word in
 *        any of the consumer's `proofTests` files (as `read` answers them),
 *        `null` for a symbol-less pair; `fold` is `folds[pair.b]` or
 *        `null`.
 *
 * The Proof legs, in the Proof's own order, and where each is answered
 * below:
 *
 *   (a) [M1] the `.mjs`/`.md`/`.json`/`.txt` outline cases, literally.
 *   (b) [M2] the files-only pair's `shared[0]` and `shape`, the state's
 *       exact key set, and the interface pair's `shape.stated_in_consumer`
 *       true; the 200×1000-char outline's serialized-size cap.
 *   (c) [M3] the leg-(b) state folds; overlapping hits, an interface pair
 *       and an empty hit list all answer `null`.
 *   (d) [M4] the symbol pair's `calls`/`fold`, the non-matching identifier,
 *       and the files-only pair's `calls: null`.
 *
 * Beside the legs, the clause text each leg leaves unasked is asked once,
 * under the clause it comes from and never under a leg's name: M1's `.js`/
 * `.ts` code lines, its top-level-only JSON keys and its 200-entry cap read
 * straight off `outlineOf`; M2's full `producer`/`consumer` field set (and
 * `legs` absent from `producer`), the producer/consumer resolved off
 * `pair.producer`/`pair.consumer` rather than `pair.a`/`pair.b` for an
 * interface pair, `shape.stated_in_consumer` false when the text is not
 * there, hit-list dedup and the whole-word/backtick boundary, and
 * `exists_at_base` false for a path `read` does not carry; M3's "at least
 * one shared path" and "every shared path" (one failing path sinks a pair
 * whose other path alone would fold); M4's "any of" several `proofTests`
 * files and the `folds` fallback to `null`.
 *
 * ── the readings this exam is written on ──────────────────────────────────
 *
 *   • Every task body below puts exactly one line after each of
 *     `**Claim:**`, `**Context:**` and `- Legs:` before the next blank
 *     line, so "read … out of `body` by those markers" has only one
 *     coherent reading regardless of whether an implementation captures a
 *     whole marker paragraph or just its first line — the two readings
 *     agree when there is only one line to capture.
 *   • `machine` comes from `clauses` (M2 says so explicitly), never
 *     reparsed from a body `Machine:` line — so no task body below carries
 *     one; `task.clauses` is set directly to the literal array the state's
 *     `machine` field is checked against.
 *   • The "full `Produces:` bullet text" a consumer must carry is read as
 *     "some literal text, `pair.symbol`-specific, taken off a producer's
 *     `- Produces:` bullet". Rather than guess whether that text includes
 *     the leading `- `, the consumer bodies below embed the *whole* bullet
 *     line verbatim — a superstring of either reading, so the match holds
 *     under both.
 *   • `read` is always an `async` function here (even where it need not
 *     be), matching the Context's "it may be async" — a `pairState` that
 *     forgot to `await` it would see a `Promise` where it expected text and
 *     fail loudly rather than silently.
 *   • This file spawns nothing and touches no path; every `read` is an
 *     in-memory lookup over literal strings built above it.
 *
 * WHY THIS IS RED AT BASE. `factory/pairs.mjs` does not exist, so the
 * dynamic import fails and the first assertion names it as the absent
 * deliverable.
 */
import assert from 'node:assert/strict'

/** A value, cut for an assertion message. */
const show = (value) => {
  const text = JSON.stringify(value ?? null)
  return text.length > 500 ? text.slice(0, 500) + '…' : text
}

// ── the deliverable ─────────────────────────────────────────────────────────
let mod = null
let importError = null
try {
  mod = await import('../../factory/pairs.mjs')
} catch (error) {
  importError = error
}

assert.equal(importError, null,
  '`factory/pairs.mjs` must exist and export `outlineOf`, `pairState`, `decideByCode` ' +
  'and `labelPair` — importing it failed: ' +
  String(importError && importError.message ? importError.message : importError))

const { outlineOf, pairState, decideByCode, labelPair } = mod

for (const [name, value] of [
  ['outlineOf', outlineOf], ['pairState', pairState],
  ['decideByCode', decideByCode], ['labelPair', labelPair],
]) {
  assert.equal(typeof value, 'function',
    '`factory/pairs.mjs` exports `' + name + '` as a function, got ' + typeof value)
}

// ═════════════════════════════════════════════════════════════════════════
// M1 — outlineOf
// ═════════════════════════════════════════════════════════════════════════

// ── (a)/M1: the .mjs case, literally ────────────────────────────────────────
{
  const text = [
    'export function runEngine (opts) {',
    '  const land = async () => {',
    '    const inner = 1',
    '    return inner',
    '  }',
    '  return land',
    '}',
  ].join('\n')
  const got = outlineOf(text, 'factory/engine.mjs')
  assert.deepEqual(got, [{ name: 'runEngine', kind: 'code' }, { name: 'land', kind: 'code' }],
    '(a)/M1: a top-level `export function`, a two-space-indented `const … =`, in order, and a ' +
    'four-space-indented `const` excluded: ' + show(got))
}

// ── (a)/M1: the .md case ─────────────────────────────────────────────────────
{
  const text = [
    '## The proof gate',
    '',
    'Some prose about the gate.',
    '',
    '### Task shape',
    '',
    'More prose.',
  ].join('\n')
  const got = outlineOf(text, 'docs/plan.md')
  assert.deepEqual(got, [{ name: 'The proof gate', kind: 'heading' }, { name: 'Task shape', kind: 'heading' }],
    '(a)/M1: `.md` headings, name without the `#` marks, kind `heading`: ' + show(got))
}

// ── (a)/M1: the .json case ───────────────────────────────────────────────────
{
  const got = outlineOf('{"select":{},"pairs":{}}', 'config.json')
  assert.deepEqual(got, [{ name: 'select', kind: 'key' }, { name: 'pairs', kind: 'key' }],
    '(a)/M1: `.json` top-level keys, in order, kind `key`: ' + show(got))
}

// ── (a)/M1: anything else is [] ──────────────────────────────────────────────
{
  const got = outlineOf('export function foo (x) { return x }', 'notes.txt')
  assert.deepEqual(got, [],
    '(a)/M1: a `.txt` path answers `[]` even when its text would otherwise match a code pattern: ' +
    show(got))
}

// ── [M1] .js and .ts share the code dispatch with .mjs ──────────────────────
{
  const text = 'export const widget = 1'
  for (const path of ['x.js', 'x.ts']) {
    const got = outlineOf(text, path)
    assert.deepEqual(got, [{ name: 'widget', kind: 'code' }],
      '[M1]: `' + path + '` uses the same code dispatch as `.mjs`: ' + show(got))
  }
}

// ── [M1] JSON keys are top-level only ───────────────────────────────────────
{
  const got = outlineOf('{"a":1,"b":{"c":2,"d":3},"e":[1,2,3]}', 'x.json')
  assert.deepEqual(got, [{ name: 'a', kind: 'key' }, { name: 'b', kind: 'key' }, { name: 'e', kind: 'key' }],
    '[M1]: nested keys `c` and `d` are not top-level and are excluded: ' + show(got))
}

// ── [M1] at most 200 entries ─────────────────────────────────────────────────
{
  const names = Array.from({ length: 250 }, (_, i) => 'f' + i)
  const text = names.map((n) => `export function ${n} (x) { return x }`).join('\n\n')
  const got = outlineOf(text, 'huge.mjs')
  assert.equal(got.length, 200,
    '[M1]: `outlineOf` never answers more than 200 entries even when the file names 250: got ' +
    got.length)
  assert.deepEqual(got.slice(0, 3).map((e) => e.name), ['f0', 'f1', 'f2'],
    '[M1]: the 200 kept are the first 200, in source order: ' + show(got.slice(0, 3)))
}

// ═════════════════════════════════════════════════════════════════════════
// M2 — pairState
// ═════════════════════════════════════════════════════════════════════════

const SHARED_PATH = 'factory/engine.mjs'
const SHARED_TEXT = [
  'export function measure (x) {',
  '  return x * 2',
  '}',
  '',
  'export const foldIn = (list) => list.reduce((a, b) => a + b, 0)',
].join('\n')
const SHARED_OUTLINE = [{ name: 'measure', kind: 'code' }, { name: 'foldIn', kind: 'code' }]

const taskA = {
  id: '1',
  title: 'Task A: the shared engine core',
  body: [
    '**Claim:** Task A builds the shared engine pieces other tasks read.',
    '',
    '**Context:** Task A only doubles numbers; nothing else here mentions `measure` directly.',
    '',
    '**Proof:**',
    '- Legs: (a) `measure(2)` is 4 [M1]',
  ].join('\n'),
  files: ['factory/engine.mjs'],
  proofTests: ['fleet/tests/test_a.mjs'],
  interfaces: { consumes: ['none'], produces: ['`measure(x) -> number`'] },
  clauses: ['`measure(x)` doubles `x`.'],
}

const taskB = {
  id: '2',
  title: 'Task B: the folded report',
  body: [
    '**Claim:** Task B assembles the report using values task A computed.',
    '',
    '**Context:** Task B calls `foldIn` on the assembled list.',
    '',
    '**Proof:**',
    '- Legs: (a) the report totals match [M1]',
  ].join('\n'),
  files: ['factory/report.mjs'],
  proofTests: ['fleet/tests/test_b.mjs'],
  interfaces: { consumes: ['`measure`'], produces: ['none'] },
  clauses: ['`foldIn(list)` sums a list.'],
}

const PAIR_FILES_ONLY = {
  a: '1', b: '2', why: 'both touch factory/engine.mjs',
  paths: [SHARED_PATH], symbol: null, producer: null, consumer: null,
}

const readShared = async (path) => (path === SHARED_PATH ? SHARED_TEXT : '')

let stateFilesOnly
{
  stateFilesOnly = await pairState({ pair: PAIR_FILES_ONLY, tasks: [taskA, taskB], read: readShared })

  assert.deepEqual(Object.keys(stateFilesOnly).sort(), ['consumer', 'producer', 'shape', 'shared'],
    '(b)/M2: the state has keys exactly producer, consumer, shared, shape: ' +
    show(Object.keys(stateFilesOnly)))

  assert.equal(stateFilesOnly.shared.length, 1,
    '(b)/M2: one `shared` entry per `pair.paths` entry: ' + show(stateFilesOnly.shared))
  const shared0 = stateFilesOnly.shared[0]
  assert.equal(shared0.path, SHARED_PATH, '(b)/M2: `shared[0].path` is the pair.paths entry')
  assert.equal(shared0.exists_at_base, true,
    '(b)/M2: `exists_at_base` true when `read` answers non-empty text for the path')
  assert.deepEqual(shared0.outline, SHARED_OUTLINE,
    '(b)/M2: `shared[0].outline` is `outlineOf` of the base text: ' + show(shared0.outline))
  assert.deepEqual(shared0.producer_hits, ['measure'],
    '(b)/M2: producer_hits are the outline names occurring as whole words in backticks in ' +
    'task A\'s body: ' + show(shared0.producer_hits))
  assert.deepEqual(shared0.consumer_hits, ['foldIn'],
    '(b)/M2: consumer_hits are the outline names occurring as whole words in backticks in ' +
    'task B\'s body: ' + show(shared0.consumer_hits))

  assert.deepEqual(stateFilesOnly.shape, { symbol: null, stated_in_consumer: false },
    '(b)/M2: a files-only pair\'s `shape` is `{ symbol: null, stated_in_consumer: false }`: ' +
    show(stateFilesOnly.shape))

  // [M2] for a files-only pair, the producer is pair.a and the consumer pair.b.
  assert.equal(stateFilesOnly.producer.id, '1',
    '[M2]: for a files-only pair the producer is `pair.a`, got id ' + show(stateFilesOnly.producer.id))
  assert.equal(stateFilesOnly.consumer.id, '2',
    '[M2]: for a files-only pair the consumer is `pair.b`, got id ' + show(stateFilesOnly.consumer.id))

  // [M2] the full producer/consumer field set, and legs only on the consumer.
  assert.deepEqual(Object.keys(stateFilesOnly.producer).sort(),
    ['claim', 'context', 'files', 'id', 'interfaces', 'machine', 'title'],
    '[M2]: `producer` carries `id, title, claim, machine, interfaces, files, context` and no ' +
    '`legs`: ' + show(Object.keys(stateFilesOnly.producer)))
  assert.deepEqual(Object.keys(stateFilesOnly.consumer).sort(),
    ['claim', 'context', 'files', 'id', 'interfaces', 'legs', 'machine', 'title'],
    '[M2]: `consumer` carries the same seven fields plus `legs`: ' +
    show(Object.keys(stateFilesOnly.consumer)))
  assert.equal(stateFilesOnly.producer.title, taskA.title, '[M2]: producer.title is task A\'s title')
  assert.equal(stateFilesOnly.producer.claim,
    'Task A builds the shared engine pieces other tasks read.',
    '[M2]: producer.claim is read off the `**Claim:**` line: ' + show(stateFilesOnly.producer.claim))
  assert.equal(stateFilesOnly.producer.context,
    'Task A only doubles numbers; nothing else here mentions `measure` directly.',
    '[M2]: producer.context is read off the `**Context:**` line: ' + show(stateFilesOnly.producer.context))
  assert.deepEqual(stateFilesOnly.producer.machine, taskA.clauses,
    '[M2]: producer.machine is task A\'s `clauses`, not reparsed from the body')
  assert.deepEqual(stateFilesOnly.producer.interfaces, taskA.interfaces,
    '[M2]: producer.interfaces is task A\'s `interfaces` verbatim')
  assert.deepEqual(stateFilesOnly.producer.files, taskA.files,
    '[M2]: producer.files is task A\'s `files` verbatim')
  assert.equal(stateFilesOnly.consumer.legs, '(a) the report totals match [M1]',
    '[M2]: consumer.legs is read off the Proof `- Legs:` line: ' + show(stateFilesOnly.consumer.legs))
}

// ── decideByCode reuses this exact state for (c) below ──────────────────────

// ── (b)/M2, second half: an interface pair's shape, and producer/consumer ──
// resolved off pair.producer/pair.consumer rather than pair.a/pair.b ────────
const task20 = {
  id: '20',
  title: 'Task 20: the widget maker',
  body: [
    '**Claim:** Task 20 exposes the widget maker.',
    '',
    '**Context:** Task 20 owns `makeWidget`.',
    '',
    '**Interfaces:**',
    '- Consumes: none',
    '- Produces: `makeWidget(n) -> Widget`',
    '',
    '**Proof:**',
    '- Legs: (a) `makeWidget(1)` returns a Widget [M1]',
  ].join('\n'),
  files: ['factory/widget.mjs'],
  proofTests: [],
  interfaces: { consumes: ['none'], produces: ['`makeWidget(n) -> Widget`'] },
  clauses: ['`makeWidget(n)` builds one Widget.'],
}
const task10 = {
  id: '10',
  title: 'Task 10: the display',
  body: [
    '**Claim:** Task 10 assembles the display using the widget maker.',
    '',
    "**Context:** Task 10 relies on the producer's own line: - Produces: `makeWidget(n) -> Widget` " +
      'for its work.',
    '',
    '**Proof:**',
    '- Legs: (a) the display renders one widget [M1]',
  ].join('\n'),
  files: ['factory/display.mjs'],
  proofTests: [],
  interfaces: { consumes: ['`makeWidget`'], produces: ['none'] },
  clauses: ['the display renders one widget per call.'],
}
const task10NoMention = {
  id: '10b',
  title: 'Task 10b: the display, unaware',
  body: [
    '**Claim:** Task 10b assembles the display without reading the producer\'s interface line.',
    '',
    '**Context:** Task 10b only mentions `Widget` in passing.',
    '',
    '**Proof:**',
    '- Legs: (a) nothing special happens [M1]',
  ].join('\n'),
  files: ['factory/display2.mjs'],
  proofTests: [],
  interfaces: { consumes: ['none'], produces: ['none'] },
  clauses: ['nothing special happens.'],
}

const PAIR_SYMBOL_TRUE = {
  a: '10', b: '20', why: 'symbol makeWidget',
  paths: [], symbol: 'makeWidget', producer: '20', consumer: '10',
}
{
  const state = await pairState({ pair: PAIR_SYMBOL_TRUE, tasks: [task10, task20], read: async () => '' })
  assert.equal(state.producer.id, '20',
    '[M2]: an interface pair\'s producer is `pair.producer` (here `\'20\'`, not `pair.a`)')
  assert.equal(state.consumer.id, '10',
    '[M2]: an interface pair\'s consumer is `pair.consumer` (here `\'10\'`, not `pair.b`)')
  assert.deepEqual(state.shape, { symbol: 'makeWidget', stated_in_consumer: true },
    "(b)/M2: `shape.stated_in_consumer` is true when the consumer's body contains the " +
    "producer's full `Produces:` bullet text for `pair.symbol`: " + show(state.shape))
  assert.deepEqual(state.shared, [],
    '[M2]: an empty `pair.paths` yields an empty `shared`')
}

const PAIR_SYMBOL_FALSE = { ...PAIR_SYMBOL_TRUE, a: '10b', consumer: '10b' }
{
  const state = await pairState({ pair: PAIR_SYMBOL_FALSE, tasks: [task10NoMention, task20], read: async () => '' })
  assert.equal(state.shape.symbol, 'makeWidget', '[M2]: shape.symbol is pair.symbol regardless')
  assert.equal(state.shape.stated_in_consumer, false,
    "[M2]: `shape.stated_in_consumer` is false when the consumer's body does not carry the " +
    "producer's Produces bullet text: " + show(state.shape))
}

// ── [M2] hit-list dedup and the whole-word/backtick boundary ────────────────
const SHARED_PATH2 = 'factory/thing.mjs'
const SHARED_TEXT2 = 'export function measure (x) {\n  return x\n}'
const taskHitsA = {
  id: 'ha',
  title: 'Hits task A',
  body: [
    '**Claim:** Hits task A claims `measure` twice, as `measure` again.',
    '',
    '**Context:** No further mentions here.',
    '',
    '**Proof:**',
    '- Legs: (a) n/a [M1]',
  ].join('\n'),
  files: [], proofTests: [], interfaces: { consumes: ['none'], produces: ['none'] }, clauses: ['n/a'],
}
const taskHitsD = {
  id: 'hd',
  title: 'Hits task D',
  body: [
    '**Claim:** Hits task D writes `measurement` inside code and the word measure only in plain prose.',
    '',
    '**Context:** There is no backticked span containing just the bare word in this body.',
    '',
    '**Proof:**',
    '- Legs: (a) n/a [M1]',
  ].join('\n'),
  files: [], proofTests: [], interfaces: { consumes: ['none'], produces: ['none'] }, clauses: ['n/a'],
}
{
  const pair = { a: 'ha', b: 'hd', why: 'x', paths: [SHARED_PATH2], symbol: null, producer: null, consumer: null }
  const read = async (p) => (p === SHARED_PATH2 ? SHARED_TEXT2 : '')
  const state = await pairState({ pair, tasks: [taskHitsA, taskHitsD], read })
  assert.deepEqual(state.shared[0].producer_hits, ['measure'],
    "[M2]: `measure` mentioned twice in backticks is listed once in producer_hits: " +
    show(state.shared[0].producer_hits))
  assert.deepEqual(state.shared[0].consumer_hits, [],
    '[M2]: a backticked `measurement` (superstring) and a plain-prose `measure` (no backticks) ' +
    'both miss the whole-word-in-backticks test: ' + show(state.shared[0].consumer_hits))
}

// ── [M2] exists_at_base is false for a path read cannot carry ───────────────
{
  const pair = { ...PAIR_FILES_ONLY, paths: ['factory/missing.mjs'] }
  const state = await pairState({ pair, tasks: [taskA, taskB], read: async () => '' })
  assert.equal(state.shared[0].exists_at_base, false,
    "[M2]: `exists_at_base` is false when `read` answers `''` for the path")
}

// ── (b)/M2: the 60,000-byte cap, outlines cut from the end first ───────────
{
  const names = Array.from({ length: 200 }, (_, i) => 'a'.repeat(996) + String(i).padStart(4, '0'))
  const bigPath = 'factory/huge.mjs'
  const bigSource = names.map((n) => `export function ${n} (x) { return x }`).join('\n\n')
  const fullOutline = outlineOf(bigSource, bigPath)
  assert.equal(fullOutline.length, 200, 'setup check: 200 distinct top-level names')

  const pair = { ...PAIR_FILES_ONLY, paths: [bigPath] }
  const state = await pairState({ pair, tasks: [taskA, taskB], read: async (p) => (p === bigPath ? bigSource : '') })
  const bytes = Buffer.byteLength(JSON.stringify(state), 'utf8')
  assert.ok(bytes <= 60000,
    '(b)/M2: the serialized state is at most 60,000 bytes even with a 200×1000-char outline, got ' +
    bytes)
  const kept = state.shared[0].outline
  assert.ok(kept.length > 0 && kept.length < 200,
    '(b)/M2: the outline was cut to fit, got ' + kept.length + ' of 200 entries')
  assert.deepEqual(kept, fullOutline.slice(0, kept.length),
    '(b)/M2: outlines are cut from the end first, so what remains is a prefix of the full outline')
}

// ═════════════════════════════════════════════════════════════════════════
// M3 — decideByCode
// ═════════════════════════════════════════════════════════════════════════

// ── (c)/M3: the leg-(b) files-only state (disjoint, non-empty, no symbol) ──
assert.equal(decideByCode(stateFilesOnly), 'fold',
  "(c)/M3: a files-only pair whose two hit lists are both non-empty and disjoint is 'fold': " +
  show(decideByCode(stateFilesOnly)))

// ── (c)/M3: both tasks naming `measure` (overlap) is null ───────────────────
const taskB2 = {
  id: '2o',
  title: 'Task B, overlapping',
  body: [
    '**Claim:** Task B2 also reads `measure` directly.',
    '',
    '**Context:** Task B2 needs `measure` too.',
    '',
    '**Proof:**',
    '- Legs: (a) n/a [M1]',
  ].join('\n'),
  files: [], proofTests: [], interfaces: { consumes: ['none'], produces: ['none'] }, clauses: ['n/a'],
}
{
  const pair = { ...PAIR_FILES_ONLY, b: '2o' }
  const state = await pairState({ pair, tasks: [taskA, taskB2], read: readShared })
  assert.equal(decideByCode(state), null,
    '(c)/M3: overlapping (non-disjoint) hit lists answer null: ' + show(decideByCode(state)))
}

// ── (c)/M3: an interface pair (a symbol present) is null ────────────────────
{
  const state = await pairState({ pair: PAIR_SYMBOL_TRUE, tasks: [task10, task20], read: async () => '' })
  assert.equal(decideByCode(state), null,
    '(c)/M3: a pair with a `symbol` never folds by code, whatever its hits: ' +
    show(decideByCode(state)))
}

// ── (c)/M3: an empty hit list is null ────────────────────────────────────────
const taskNoHits = {
  id: 'nh',
  title: 'Task with no mentions',
  body: [
    '**Claim:** Task N mentions nothing from the shared file.',
    '',
    '**Context:** Totally unrelated prose.',
    '',
    '**Proof:**',
    '- Legs: (a) n/a [M1]',
  ].join('\n'),
  files: [], proofTests: [], interfaces: { consumes: ['none'], produces: ['none'] }, clauses: ['n/a'],
}
{
  const pair = { ...PAIR_FILES_ONLY, a: 'nh' }
  const state = await pairState({ pair, tasks: [taskNoHits, taskB], read: readShared })
  assert.deepEqual(state.shared[0].producer_hits, [], 'setup check: producer_hits is empty')
  assert.equal(decideByCode(state), null,
    '(c)/M3: an empty hit list on either side answers null: ' + show(decideByCode(state)))
}

// ── [M3] no shared path at all is null ───────────────────────────────────────
{
  const pair = { ...PAIR_FILES_ONLY, paths: [] }
  const state = await pairState({ pair, tasks: [taskA, taskB], read: readShared })
  assert.equal(decideByCode(state), null,
    "[M3]: a pair with no shared path is never 'fold': " + show(decideByCode(state)))
}

// ── [M3] every shared path must qualify: one failing path sinks a pair whose
// other path alone would fold ───────────────────────────────────────────────
const SHARED_PATH4 = 'factory/other.mjs'
const SHARED_TEXT4 = [
  'export function widgetize (x) {',
  '  return x',
  '}',
  '',
  'export function gadgetize (x) {',
  '  return x',
  '}',
].join('\n')
const taskMA = {
  id: 'ma',
  title: 'Task MA',
  body: [
    '**Claim:** Task MA reads `measure` and also touches `widgetize`.',
    '',
    '**Context:** Nothing else to add.',
    '',
    '**Proof:**',
    '- Legs: (a) n/a [M1]',
  ].join('\n'),
  files: [], proofTests: [], interfaces: { consumes: ['none'], produces: ['none'] }, clauses: ['n/a'],
}
const taskMB = {
  id: 'mb',
  title: 'Task MB',
  body: [
    '**Claim:** Task MB also reads `measure`, and separately calls `gadgetize`.',
    '',
    '**Context:** Nothing else to add.',
    '',
    '**Proof:**',
    '- Legs: (a) n/a [M1]',
  ].join('\n'),
  files: [], proofTests: [], interfaces: { consumes: ['none'], produces: ['none'] }, clauses: ['n/a'],
}
{
  const pair = {
    a: 'ma', b: 'mb', why: 'multi', paths: [SHARED_PATH, SHARED_PATH4],
    symbol: null, producer: null, consumer: null,
  }
  const read = async (p) => (p === SHARED_PATH ? SHARED_TEXT : (p === SHARED_PATH4 ? SHARED_TEXT4 : ''))
  const state = await pairState({ pair, tasks: [taskMA, taskMB], read })
  assert.deepEqual(state.shared[0].producer_hits, ['measure'], 'setup check')
  assert.deepEqual(state.shared[0].consumer_hits, ['measure'], 'setup check: overlap on path 1')
  assert.deepEqual(state.shared[1].producer_hits, ['widgetize'], 'setup check')
  assert.deepEqual(state.shared[1].consumer_hits, ['gadgetize'], 'setup check: disjoint on path 2')
  assert.equal(decideByCode(state), null,
    "[M3]: path 2 alone is disjoint and non-empty, but path 1 overlaps — 'every shared path' " +
    'means the whole pair answers null: ' + show(decideByCode(state)))
}

// ═════════════════════════════════════════════════════════════════════════
// M4 — labelPair
// ═════════════════════════════════════════════════════════════════════════

const producerTask1 = {
  id: '1', title: 'Widget producer', body: '**Claim:** produces make_widget.\n\n**Context:** c.\n\n**Proof:**\n- Legs: (a) n/a [M1]',
  files: [], proofTests: [], interfaces: { consumes: ['none'], produces: ['`make_widget(n)`'] }, clauses: ['n/a'],
}
const consumerTask2 = {
  id: '2', title: 'Widget consumer', body: '**Claim:** consumes make_widget.\n\n**Context:** c.\n\n**Proof:**\n- Legs: (a) n/a [M1]',
  files: [], proofTests: ['fleet/tests/test_widget_proof.mjs'],
  interfaces: { consumes: ['`make_widget`'], produces: ['none'] }, clauses: ['n/a'],
}
const PAIR_LABEL = {
  a: '1', b: '2', why: 'symbol make_widget', paths: [], symbol: 'make_widget', producer: '1', consumer: '2',
}

// ── (d)/M4: calls true, fold from folds[pair.b] ─────────────────────────────
{
  const read = async (p) =>
    (p === 'fleet/tests/test_widget_proof.mjs'
      ? "import { make_widget } from '../../factory/widget.mjs'\ntest(() => assert.equal(make_widget(3), 6))\n"
      : '')
  const result = await labelPair({ pair: PAIR_LABEL, tasks: [producerTask1, consumerTask2], read, folds: { 2: 'clean' } })
  assert.deepEqual(result, { a: '1', b: '2', calls: true, fold: 'clean' },
    '(d)/M4: `make_widget(3)` in the consumer\'s one proof test, and `folds[\'2\']`, together ' +
    'give exactly `{ a: \'1\', b: \'2\', calls: true, fold: \'clean\' }`: ' + show(result))
}

// ── (d)/M4: a look-alike identifier does not count as calls ─────────────────
{
  const read = async (p) => (p === 'fleet/tests/test_widget_proof.mjs' ? 'make_widgets(3)' : '')
  const result = await labelPair({ pair: PAIR_LABEL, tasks: [producerTask1, consumerTask2], read, folds: { 2: 'clean' } })
  assert.equal(result.calls, false,
    "(d)/M4: `make_widgets` is not the whole word `make_widget`, so `calls` is false: " +
    show(result))
}

// ── (d)/M4: a files-only pair has calls: null ────────────────────────────────
{
  const pairFilesOnlyLabel = { a: '1', b: '2', why: 'files', paths: ['x.mjs'], symbol: null, producer: null, consumer: null }
  const read = async () => 'make_widget(3)'
  const result = await labelPair({ pair: pairFilesOnlyLabel, tasks: [producerTask1, consumerTask2], read, folds: { 2: 'clean' } })
  assert.equal(result.calls, null,
    '(d)/M4: a pair with no `symbol` has `calls: null`, whatever the proof tests read: ' +
    show(result))
}

// ── [M4] fold falls back to null when folds has no entry for pair.b ─────────
{
  const read = async (p) => (p === 'fleet/tests/test_widget_proof.mjs' ? 'make_widget(3)' : '')
  const result = await labelPair({ pair: PAIR_LABEL, tasks: [producerTask1, consumerTask2], read, folds: {} })
  assert.equal(result.fold, null,
    "[M4]: `fold` is `folds[pair.b]` or `null` — with no entry for `pair.b`, it is null: " +
    show(result))
}

// ── [M4] calls is true if ANY of several proofTests files carries the symbol ─
{
  const consumerMulti = { ...consumerTask2, proofTests: ['a_test.mjs', 'b_test.mjs'] }
  const read = async (p) => {
    if (p === 'a_test.mjs') return 'nothing relevant here'
    if (p === 'b_test.mjs') return 'call make_widget(9) here'
    return ''
  }
  const result = await labelPair({ pair: PAIR_LABEL, tasks: [producerTask1, consumerMulti], read, folds: { 2: 'x' } })
  assert.equal(result.calls, true,
    "[M4]: `calls` is true when ANY of the consumer's proofTests files carries the symbol, not " +
    'only the first: ' + show(result))
}

console.log('ALL TESTS PASSED')
