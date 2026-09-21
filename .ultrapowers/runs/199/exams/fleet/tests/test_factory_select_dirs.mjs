/**
 * fleet/tests/test_factory_select_dirs.mjs — the exam for *the candidate
 * finder offers tests that name a changed file's directory, ranked last, and
 * says why each candidate matched*.
 *
 * This file is the Proof's `Test:`, written whole at the path the Proof
 * names. Every relative import is written for THIS directory: `../../` is
 * the repository root, so `../../factory/select.mjs` is `factory/select.mjs`.
 *
 * The Machine clauses under test, restated so a reader can map every
 * assertion back to the contract:
 *
 *   M1 — `candidateTests` over the files `['tests/converge.test.ts',
 *        'tests/other.test.ts']`, where `converge.test.ts` reads
 *        `run('git diff --quiet -- state-exams')` and `other.test.ts` reads
 *        `nothing here`, with `paths: ['state-exams/seeds/three-todos.json']`
 *        and no symbols, answers exactly one result, for
 *        `tests/converge.test.ts`, whose `why` is exactly `'dir'`; with
 *        `dirNeedles: false` the same call answers `[]`.
 *   M2 — with a third file `tests/seed.test.ts` reading
 *        `load('state-exams/seeds/three-todos.json')`, the same call answers
 *        `tests/seed.test.ts` first with `why` exactly `'path'` and
 *        `tests/converge.test.ts` second with `why` `'dir'`; and with
 *        `cap: 1` it answers only `tests/seed.test.ts` — a directory match
 *        never takes a closer match's place.
 *   M3 — every result still carries `path` and `hits` as today, and a result
 *        matched only by a symbol has `why` exactly `'symbol'`; a needle
 *        shorter than 4 characters is still no needle, so a changed
 *        `src/a.ts` makes no `src` needle.
 *   M4 — (engine/policy wiring) asserted by the Proof's own `Run:` lines,
 *        not by this file: `grep -q "dirNeedles" factory/engine.mjs` and a
 *        `python3` read of `factory/policy.json`'s `select.dir_needles`.
 *        Nothing in M4 is encoded here.
 *
 * The Proof's legs, and where each is answered below:
 *
 *   (a) [M1] the two-file call answers length exactly 1, `path`
 *            `tests/converge.test.ts`, `why` exactly `'dir'`; the same call
 *            with `dirNeedles: false` answers length exactly 0.
 *   (b) [M2] the three-file call answers paths exactly
 *            `['tests/seed.test.ts', 'tests/converge.test.ts']` with `why`
 *            values exactly `['path', 'dir']`; with `cap: 1` it answers paths
 *            exactly `['tests/seed.test.ts']`.
 *   (c) [M3] every answered entry has a string `path` and an array `hits`; a
 *            call with `paths: []`, `symbols: ['orderTodos']` over a file
 *            reading `orderTodos(ids)` answers one entry with `why` exactly
 *            `'symbol'`; a call with `paths: ['src/a.ts']` over a file
 *            reading `import x from 'src'` answers length exactly 0.
 *   (d) [M4] not this file's concern — the Proof's two `Run:` lines.
 *
 * Pure throughout: `files` is a plain array of paths, `read` is
 * `async (p) => TEXTS[p]` over a fixed object of strings. No rig, no child
 * process, no disk beyond this file's own static import.
 */
import assert from 'node:assert/strict'

/** The deliverable, imported dynamically: a tree without it (or without the
 *  `candidateTests` export) reports the ABSENT MODULE/EXPORT as an assertion
 *  rather than dying at load with no leg named at all. */
let mod = null
let modImportError = null
try {
  mod = await import('../../factory/select.mjs')
} catch (error) {
  modImportError = error
}
assert.ok(modImportError === null,
  'sim precondition: `factory/select.mjs` is importable. Got: ' +
  String(modImportError && (modImportError.message || modImportError)))

const { candidateTests } = mod
assert.equal(typeof candidateTests, 'function',
  'sim precondition: it exports `candidateTests(...)`; got ' +
  JSON.stringify(typeof candidateTests))

/** `read` over a fixed table of file texts — pure, no disk. */
function readerOver (texts) {
  return async (p) => texts[p]
}

// ══════════════════════════════════════════════════════════════════════════
// (a) [M1] a directory-only match, ranked in, and gone under dirNeedles:false
// ══════════════════════════════════════════════════════════════════════════

const M1_FILES = ['tests/converge.test.ts', 'tests/other.test.ts']
const M1_TEXTS = {
  'tests/converge.test.ts': "run('git diff --quiet -- state-exams')",
  'tests/other.test.ts': 'nothing here',
}

const m1Result = await candidateTests({
  files: M1_FILES,
  read: readerOver(M1_TEXTS),
  paths: ['state-exams/seeds/three-todos.json'],
  symbols: [],
})

assert.equal(m1Result.length, 1,
  '(a) [M1] the two-file call answers exactly one result — the directory-only match on ' +
  '`converge.test.ts`. Got: ' + JSON.stringify(m1Result))
assert.equal(m1Result[0].path, 'tests/converge.test.ts',
  "(a) [M1] the one result is for `tests/converge.test.ts`. Got: " + JSON.stringify(m1Result[0]))
assert.equal(m1Result[0].why, 'dir',
  "(a) [M1] its `why` is exactly `'dir'`. Got: " + JSON.stringify(m1Result[0].why))

const m1NoDir = await candidateTests({
  files: M1_FILES,
  read: readerOver(M1_TEXTS),
  paths: ['state-exams/seeds/three-todos.json'],
  symbols: [],
  dirNeedles: false,
})
assert.equal(m1NoDir.length, 0,
  '(a) [M1] with `dirNeedles: false` the same call answers `[]` — no directory needles are ' +
  'built. Got: ' + JSON.stringify(m1NoDir))

// ══════════════════════════════════════════════════════════════════════════
// (b) [M2] a closer match outranks the directory match, and survives the cap
// ══════════════════════════════════════════════════════════════════════════

const M2_FILES = [...M1_FILES, 'tests/seed.test.ts']
const M2_TEXTS = {
  ...M1_TEXTS,
  'tests/seed.test.ts': "load('state-exams/seeds/three-todos.json')",
}

const m2Result = await candidateTests({
  files: M2_FILES,
  read: readerOver(M2_TEXTS),
  paths: ['state-exams/seeds/three-todos.json'],
  symbols: [],
})

assert.deepEqual(m2Result.map((c) => c.path), ['tests/seed.test.ts', 'tests/converge.test.ts'],
  '(b) [M2] `tests/seed.test.ts` (a closer, non-directory match) ranks first and ' +
  '`tests/converge.test.ts` (the directory-only match) ranks second. Got: ' +
  JSON.stringify(m2Result.map((c) => c.path)))
assert.deepEqual(m2Result.map((c) => c.why), ['path', 'dir'],
  "(b) [M2] their `why` values are exactly `'path'` then `'dir'`. Got: " +
  JSON.stringify(m2Result.map((c) => c.why)))

const m2Capped = await candidateTests({
  files: M2_FILES,
  read: readerOver(M2_TEXTS),
  paths: ['state-exams/seeds/three-todos.json'],
  symbols: [],
  cap: 1,
})
assert.deepEqual(m2Capped.map((c) => c.path), ['tests/seed.test.ts'],
  '(b) [M2] with `cap: 1` the answer is only `tests/seed.test.ts` — a directory match never ' +
  "takes a closer match's place. Got: " + JSON.stringify(m2Capped.map((c) => c.path)))

// ══════════════════════════════════════════════════════════════════════════
// (c) [M3] `path`/`hits` still carried, symbol-only `why`, and the 4-char floor
// ══════════════════════════════════════════════════════════════════════════

for (const c of m2Result) {
  assert.equal(typeof c.path, 'string',
    '(c) [M3] every answered entry carries a string `path`. Got: ' + JSON.stringify(c))
  assert.ok(Array.isArray(c.hits),
    '(c) [M3] every answered entry carries an array `hits`. Got: ' + JSON.stringify(c))
}

const SYMBOL_FILES = ['tests/uses.test.ts']
const SYMBOL_TEXTS = { 'tests/uses.test.ts': 'orderTodos(ids)' }
const symbolResult = await candidateTests({
  files: SYMBOL_FILES,
  read: readerOver(SYMBOL_TEXTS),
  paths: [],
  symbols: ['orderTodos'],
})
assert.equal(symbolResult.length, 1,
  '(c) [M3] a symbol-only call over a matching file answers exactly one entry. Got: ' +
  JSON.stringify(symbolResult))
assert.equal(symbolResult[0].why, 'symbol',
  "(c) [M3] a result matched only by a symbol has `why` exactly `'symbol'`. Got: " +
  JSON.stringify(symbolResult[0].why))

const SHORT_DIR_FILES = ['tests/imports.test.ts']
const SHORT_DIR_TEXTS = { 'tests/imports.test.ts': "import x from 'src'" }
const shortDirResult = await candidateTests({
  files: SHORT_DIR_FILES,
  read: readerOver(SHORT_DIR_TEXTS),
  paths: ['src/a.ts'],
  symbols: [],
})
assert.equal(shortDirResult.length, 0,
  '(c) [M3] a needle shorter than 4 characters is still no needle, so a changed `src/a.ts` ' +
  "makes no `src` needle — even though the file's text carries the word `src`. Got: " +
  JSON.stringify(shortDirResult))

console.log('ALL TESTS PASSED')
