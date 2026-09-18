/**
 * fleet/tests/test_factory_select.mjs — the exam for "The candidate finder —
 * code names the test files a set of paths and symbols touches" (#1133).
 *
 * `factory/select.mjs` is pure: it never touches disk, git or the network. It
 * is driven here with plain in-memory `files` arrays and an in-memory `read`,
 * and it spawns nothing — `commandFor` only returns an argv array, it never
 * runs it. No `simEnv()` is needed: nothing under test starts a process.
 *
 * Legs, each naming the Machine clause it comes from:
 *
 *   (a)  [M1] the worked example: a real hit set, ordered by hits.length
 *        descending then path ascending; `exclude` removes a candidate; `cap`
 *        truncates; `read` is never called on a non-test file; the default
 *        cap is 8 when twelve test files all match.
 *   (a2) [M1] all eight recognized test-file basename shapes are candidates,
 *        a ninth shape is not (and is never `read`); with every one holding a
 *        single hit this also exercises the path-ascending tie-break.
 *   (b)  [M2] whole-word vs substring matching: `catalogue` does not match
 *        the needle `catalog`; a needle containing `/` matches as a
 *        substring, and the plain needle still matches the same span as a
 *        whole word.
 *   (b2) [M2] a `paths` entry that is itself a test file contributes no path
 *        or stem needle, so a second test file that merely mentions that
 *        stem is not a candidate.
 *   (b3) [M2] matching is case-sensitive (Context, read together with M2):
 *        a needle differing only in case does not match.
 *   (c)  [M3] `symbolsOf` over two clause texts: whole path+extension spans
 *        kept whole, plain spans reduced to their leading identifier,
 *        too-short spans dropped, appearance order, deduplication.
 *   (d)  [M4] `commandFor` for each extension and for a non-runnable path.
 *
 * Assumptions this exam makes about the code under test: `read` may be
 * called with any file `select.mjs` decides is a candidate, and the exam
 * treats every such call as observable through a shared `calls` log rather
 * than assuming a particular traversal order; `commandFor`'s `null` case is
 * read as "no known runner", not as a thrown error.
 */

import assert from 'node:assert/strict'

import { candidateTests, commandFor, symbolsOf } from '../../factory/select.mjs'

// ── A tiny in-memory `read`, recording every path it was asked for ─────────

function makeReader (map) {
  const calls = []
  const read = async (path) => {
    calls.push(path)
    return map.has(path) ? map.get(path) : ''
  }
  return { read, calls }
}

// ── a. [M1] the worked example ──────────────────────────────────────────────
{
  const files = [
    'src/catalog.py',
    'tests/test_catalog.py',
    'tests/test_other.py',
    'tests/helpers.py',
    'fleet/tests/test_engine.mjs'
  ]
  const texts = new Map([
    ['tests/test_catalog.py', 'from src.catalog import catalog'],
    ['tests/test_other.py', 'nothing here'],
    ['tests/helpers.py', 'catalog make_widget'],
    ['fleet/tests/test_engine.mjs', 'catalog(); make_widget()']
  ])
  const paths = ['src/catalog.py']
  const symbols = ['make_widget', 'abc']

  {
    const { read, calls } = makeReader(texts)
    const result = await candidateTests({ files, read, paths, symbols })
    assert.deepEqual(
      result,
      [
        { path: 'fleet/tests/test_engine.mjs', hits: ['catalog', 'make_widget'] },
        { path: 'tests/test_catalog.py', hits: ['catalog'] }
      ],
      '(a) [M1] ordered by hits.length descending then path ascending, with the exact hit sets'
    )
    assert.ok(!calls.includes('tests/helpers.py'), '(a) [M1] read() is called for test files only — not tests/helpers.py')
    assert.ok(!calls.includes('src/catalog.py'), '(a) [M1] and not for a path named in `paths` that is not itself a test file')
  }

  {
    const { read } = makeReader(texts)
    const result = await candidateTests({ files, read, paths, symbols, exclude: ['tests/test_catalog.py'] })
    assert.deepEqual(
      result,
      [{ path: 'fleet/tests/test_engine.mjs', hits: ['catalog', 'make_widget'] }],
      '(a) [M1] a path in `exclude` is dropped from the candidates'
    )
  }

  {
    const { read } = makeReader(texts)
    const result = await candidateTests({ files, read, paths, symbols, cap: 1 })
    assert.deepEqual(
      result,
      [{ path: 'fleet/tests/test_engine.mjs', hits: ['catalog', 'make_widget'] }],
      '(a) [M1] `cap` truncates to the top entries after ordering'
    )
  }

  {
    const twelve = Array.from({ length: 12 }, (_, i) => `tests/test_dup_${String(i).padStart(2, '0')}.py`)
    const twelveTexts = new Map(twelve.map((p) => [p, 'this file mentions catalog once']))
    const { read } = makeReader(twelveTexts)
    const result = await candidateTests({ files: twelve, read, paths, symbols })
    assert.equal(result.length, 8, '(a) [M1] with twelve matching test files and no `cap`, the default cap of 8 applies')
  }
}

// ── a2. [M1] the eight recognized basename shapes, and a ninth that is not ──
{
  const matching = [
    'tests/test_a.py',   // test_*.py
    'tests/test_b.mjs',  // test_*.mjs
    'tests/test_c.js',   // test_*.js
    'tests/test_d.ts',   // test_*.ts
    'tests/e_test.py',   // *_test.py
    'tests/f.test.ts',   // *.test.ts
    'tests/g.test.js',   // *.test.js
    'tests/h.test.mjs'   // *.test.mjs
  ]
  const notMatching = 'tests/i.py'
  const files = [...matching, notMatching]
  const texts = new Map(files.map((p) => [p, 'a lone mention of catalog here']))
  const { read, calls } = makeReader(texts)
  const result = await candidateTests({ files, read, paths: ['src/catalog.py'], symbols: [] })

  const expected = [...matching].sort().map((path) => ({ path, hits: ['catalog'] }))
  assert.deepEqual(
    result,
    expected,
    '(a2) [M1] all eight basename shapes are candidates; with equal hits.length they sort by path ascending'
  )
  assert.ok(!calls.includes(notMatching), '(a2) [M1] a ninth, non-matching basename is never read()')
}

// ── b. [M2] whole-word vs substring matching ────────────────────────────────
{
  {
    const files = ['tests/test_no_match.py']
    const texts = new Map([['tests/test_no_match.py', 'catalogue abc']])
    const { read } = makeReader(texts)
    const result = await candidateTests({ files, read, paths: ['src/catalog.py'], symbols: ['abc'] })
    assert.deepEqual(
      result,
      [],
      '(b) [M2] `catalog` is flanked by identifier characters in `catalogue`, so it is not a whole-word match'
    )
  }

  {
    const files = ['tests/test_sees_path.py']
    const texts = new Map([['tests/test_sees_path.py', 'see src/catalog.py']])
    const { read } = makeReader(texts)
    const result = await candidateTests({ files, read, paths: ['src/catalog.py'], symbols: [] })
    assert.deepEqual(
      result,
      [{ path: 'tests/test_sees_path.py', hits: ['src/catalog.py', 'catalog'] }],
      '(b) [M2] a `/`-bearing needle matches as a substring, and the stem still matches the same span as a whole word'
    )
  }
}

// ── b2. [M2] a `paths` entry that is itself a test file adds no needle ──────
{
  const files = ['tests/test_marker.py', 'tests/test_other2.py']
  const texts = new Map([
    ['tests/test_marker.py', 'widgetkit'],
    ['tests/test_other2.py', 'test_marker mentioned here']
  ])
  const { read } = makeReader(texts)
  const result = await candidateTests({
    files, read, paths: ['tests/test_marker.py'], symbols: ['widgetkit']
  })
  assert.deepEqual(
    result,
    [{ path: 'tests/test_marker.py', hits: ['widgetkit'] }],
    '(b2) [M2] `tests/test_marker.py` names itself in `paths` but is itself a test file, so neither its path nor ' +
      'its stem `test_marker` becomes a needle — tests/test_other2.py, which only mentions that stem, is not a candidate'
  )
}

// ── b3. [M2] matching is case-sensitive ──────────────────────────────────────
{
  const files = ['tests/test_case.py']
  const texts = new Map([['tests/test_case.py', 'catalog appears here, lowercase only']])
  const { read } = makeReader(texts)
  const result = await candidateTests({ files, read, paths: [], symbols: ['Catalog'] })
  assert.deepEqual(result, [], '(b3) [M2] `Catalog` does not match a text that only holds the lowercase `catalog`')
}

// ── c. [M3] symbolsOf ────────────────────────────────────────────────────────
{
  const clauses = [
    '`catalog([1, 3])` returns two `Widget`s from `widgetkit/catalog.py`',
    '`x` is `ok` and `catalog` again'
  ]
  assert.deepEqual(
    symbolsOf(clauses),
    ['catalog', 'Widget', 'widgetkit/catalog.py'],
    '(c) [M3] leading identifiers for plain spans, the whole span for a `/`-bearing file-extension span, ' +
      'too-short spans (`x`, `ok`) dropped, appearance order, and the repeated `catalog` deduplicated'
  )
}

// ── d. [M4] commandFor ───────────────────────────────────────────────────────
{
  assert.deepEqual(
    commandFor('tests/test_a.py', 300),
    ['timeout', '300', 'python3', '-m', 'pytest', '-q', 'tests/test_a.py'],
    '(d) [M4] a .py path runs under pytest'
  )
  assert.deepEqual(
    commandFor('fleet/tests/test_b.mjs', 300),
    ['timeout', '300', 'node', 'fleet/tests/test_b.mjs'],
    '(d) [M4] a .mjs path runs under node'
  )
  assert.deepEqual(
    commandFor('tests/c.test.ts', 60),
    ['timeout', '60', 'bun', 'test', 'tests/c.test.ts'],
    '(d) [M4] a .test.ts path runs under `bun test`, and `seconds` is stringified into the timeout argv'
  )
  assert.equal(
    commandFor('README.md', 300),
    null,
    '(d) [M4] a path with no known runner answers null'
  )
}

console.log('ALL TESTS PASSED')
