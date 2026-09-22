/**
 * fleet/tests/test_factory_select.mjs — the exam for "The candidate finder
 * offers a test only when it reads a changed file, and a task with nothing to
 * offer writes the row that says so" (#1208).
 *
 * The defect this retires: `stem`, bare-word `symbol` and `dir` needles hit
 * common words — `select`, `settled`, `exit`, `factory`, `fleet` — so nearly
 * every task was offered the same files regardless of what it touched. The
 * rule now: three kinds only — `path` (verbatim path text anywhere), `import`
 * (a touched file's stem, as a whole word, on an import line), `symbol` (one
 * of `symbols`, as a whole word, on an import line). No `stem` kind, no `dir`
 * kind, no `dirNeedles` option.
 *
 * Legs, each naming the Machine clause it comes from:
 *
 *   (a) [M1] a `path` hit — the touched path appears verbatim in a file's text
 *       (an import line here, but `path` doesn't require that);
 *   (b) [M2] an `import` hit — a touched file's stem as a whole word on an
 *       import line; and a `symbol` hit — a `symbols` entry as a whole word on
 *       an import line;
 *   (c) [M3] a stem, a symbol or a directory outside an import line buys
 *       nothing, and needles matching no file answer `[]`;
 *   (d) [M4] `examSelectionRow` — empty `found` answers `candidates: []`,
 *       `why: 'none'`; non-empty `found` answers `candidates` in order and
 *       `why` keyed by path.
 *
 * `candidateTests` and `examSelectionRow` are pure: this exam supplies an
 * in-memory `files` array and a `read` function over a map of fixture texts —
 * no disk, no child process, no network.
 */

import assert from 'node:assert/strict'

import { candidateTests, examSelectionRow } from '../../factory/select.mjs'

/** A `read` function over an in-memory map of fixture texts. */
const readerFor = (texts) => async (path) => {
  if (!(path in texts)) throw new Error(`exam: no fixture text for ${path}`)
  return texts[path]
}

const find = (opts) => candidateTests(opts)

// ── a. [M1] a `path` hit ─────────────────────────────────────────────────
{
  const texts = {
    'fleet/tests/test_a.mjs': "import { candidateTests } from '../../factory/select.mjs'\n",
    'fleet/tests/test_words.mjs':
      "// select the settled exit; see fleet/tests/test_words.mjs and factory/\nconst candidateTests = 1\n"
  }
  const files = Object.keys(texts)
  const result = await find({
    files,
    read: readerFor(texts),
    paths: ['factory/select.mjs'],
    symbols: ['settled', 'exit']
  })
  assert.equal(result.length, 1, '(a) [M1] exactly one candidate is offered')
  assert.equal(result[0].path, 'fleet/tests/test_a.mjs', '(a) [M1] the file whose text holds the path verbatim')
  assert.equal(result[0].why, 'path', "(a) [M1] why is 'path'")
  assert.ok(result[0].hits.includes('factory/select.mjs'), '(a) [M1] the path itself is among the hits')
}

// ── b. [M2] an `import` hit and a `symbol` hit ──────────────────────────
{
  // b1: the stem of a touched Python file, as a whole word, on an import line
  const texts1 = {
    'tests/test_parse.py': 'from plan_parse import parse_plan\n',
    'fleet/tests/test_words.mjs':
      "// select the settled exit; see fleet/tests/test_words.mjs and factory/\nconst candidateTests = 1\n"
  }
  const files1 = Object.keys(texts1)
  const result1 = await find({
    files: files1,
    read: readerFor(texts1),
    paths: ['skills/ultrapowers/scripts/plan_parse.py'],
    symbols: []
  })
  assert.equal(result1.length, 1, '(b) [M2] exactly one candidate is offered (import)')
  assert.equal(result1[0].path, 'tests/test_parse.py', '(b) [M2] the file whose import line holds the stem')
  assert.equal(result1[0].why, 'import', "(b) [M2] why is 'import'")
  assert.ok(result1[0].hits.includes('plan_parse'), '(b) [M2] the stem plan_parse is among the hits')

  // b2: a `symbols` entry, as a whole word, on an import line
  const texts2 = {
    'fleet/tests/test_sym.mjs': "import { candidateTests } from './rig.mjs'\n",
    'fleet/tests/test_words.mjs':
      "// select the settled exit; see fleet/tests/test_words.mjs and factory/\nconst candidateTests = 1\n"
  }
  const files2 = Object.keys(texts2)
  const result2 = await find({
    files: files2,
    read: readerFor(texts2),
    paths: ['factory/select.mjs'],
    symbols: ['candidateTests']
  })
  assert.equal(result2.length, 1, '(b) [M2] exactly one candidate is offered (symbol)')
  assert.equal(result2[0].path, 'fleet/tests/test_sym.mjs', '(b) [M2] the file whose import line holds the symbol')
  assert.equal(result2[0].why, 'symbol', "(b) [M2] why is 'symbol'")
}

// ── c. [M3] a bare stem, symbol or directory buys nothing; no match is `[]` ─
{
  const texts = {
    'fleet/tests/test_words.mjs':
      "// select the settled exit; see fleet/tests/test_words.mjs and factory/\nconst candidateTests = 1\n"
  }
  const files = Object.keys(texts)
  const result = await find({
    files,
    read: readerFor(texts),
    paths: ['factory/select.mjs', 'fleet/launch.mjs'],
    symbols: ['settled', 'exit', 'candidateTests']
  })
  assert.deepEqual(
    result,
    [],
    '(c) [M3] the stem `select`, the words `settled`/`exit`/`candidateTests` outside an import line, ' +
      'and the directories `factory`/`fleet` buy nothing'
  )

  const texts2 = {
    'tests/converge.test.ts': "run('git diff --quiet -- state-exams')\n"
  }
  const files2 = Object.keys(texts2)
  const result2 = await find({
    files: files2,
    read: readerFor(texts2),
    paths: ['state-exams/seeds/three-todos.json'],
    symbols: []
  })
  assert.deepEqual(result2, [], '(c) [M3] needles matching no file answer exactly []')
}

// ── d. [M4] examSelectionRow ─────────────────────────────────────────────
{
  const empty = examSelectionRow({ task: '3', found: [], covered: [] })
  assert.deepEqual(
    empty,
    { kind: 'select:exam', task: '3', candidates: [], covered: [], why: 'none' },
    '(d) [M4] no candidates: candidates [], covered as given, why the string "none"'
  )

  const nonEmpty = examSelectionRow({
    task: '3',
    found: [{ path: 'tests/test_parse.py', hits: ['plan_parse'], why: 'import' }],
    covered: ['tests/test_parse.py', null]
  })
  assert.deepEqual(
    nonEmpty,
    {
      kind: 'select:exam',
      task: '3',
      candidates: ['tests/test_parse.py'],
      covered: ['tests/test_parse.py', null],
      why: { 'tests/test_parse.py': 'import' }
    },
    '(d) [M4] one candidate: candidates the found paths in order, covered as given, why keyed by path'
  )
}

console.log('ALL TESTS PASSED')
