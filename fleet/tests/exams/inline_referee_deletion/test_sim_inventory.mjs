// Exam for Task 2 of the referee-deletion plan (#911): the referee's fixture
// tree is gone from the suite, and the hermetic probe no longer looks for the
// linker sim.
//
//   (a) [M1] `git ls-files fleet/tests/fixtures/referee` prints nothing and the
//       directory does not exist — one surviving tracked fixture file, or the
//       directory itself, fails it.
//   (b) [M2] `fleet/tests/test_sims_are_hermetic.mjs` contains no occurrence of
//       `test_referee_linker`.
//
// An inventory sim: a sim's own git read is lawful (Amendment 10 binds models,
// not sims). It lands under `fleet/tests/exams/<slug>/`, so the repository
// root is three levels above this file's directory.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..', '..', '..')
assert.ok(fs.existsSync(path.join(ROOT, 'fleet', 'tests', '_engine_helpers.mjs')),
  'the repository root resolves from this exam\'s depth: ' + ROOT)

const FIXTURES = 'fleet/tests/fixtures/referee'
const PROBE = 'fleet/tests/test_sims_are_hermetic.mjs'

// ── (a) the fixture tree is neither tracked nor on disk [M1] ─────────────────
{
  const tracked = execFileSync('git', ['ls-files', FIXTURES],
    { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  assert.equal(tracked, '', '(a) [M1] no tracked file under ' + FIXTURES + ':\n' + tracked)
  assert.ok(!fs.existsSync(path.join(ROOT, FIXTURES)),
    '(a) [M1] ' + FIXTURES + ' is not a directory on the tree')
}

// ── (b) the hermetic probe names no linker sim [M2] ──────────────────────────
{
  const text = fs.readFileSync(path.join(ROOT, PROBE), 'utf8')
  assert.ok(!text.includes('test_referee_linker'),
    '(b) [M2] ' + PROBE + ' no longer asserts that test_referee_linker.mjs exists')
}

console.log('ALL TESTS PASSED')
