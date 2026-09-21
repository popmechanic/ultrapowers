/**
 * fleet/tests/test_factory_clone.mjs — the exam for *the old engine leaves the
 * tree, and the factory clones at base with its own code*, Machine clause M1
 * only. `factory/clone.mjs` is the one function moved out of the old engine
 * (`fleet/run-waves.mjs`) into the factory: `cloneAtBase({ repo, dest, base,
 * git, identity })` leaves `dest` a real git checkout detached at `base`, and
 * refuses a `base` the repository never held.
 *
 * M2 through M5 of the task are proven by the Proof's `Run:` lines, not by
 * this file — they are shell greps and pytest bridges over the whole tree,
 * not a claim `import`ing and calling `cloneAtBase` can measure.
 *
 * This file is the Proof's `Test:`, written whole at the path the Proof
 * names. Every relative import is written for THIS directory: `../../` is
 * the repository root, `./` is `fleet/tests/`.
 *
 * The Machine clause under test, restated so a reader can map every
 * assertion back to the contract:
 *
 *   M1 — `factory/clone.mjs` exports `cloneAtBase({ repo, dest, base })`:
 *        over a real two-commit repository it leaves `dest` a git checkout
 *        whose `HEAD` is exactly `base` — the FIRST commit, not the tip —
 *        holding the first commit's file and not the second's; and called
 *        with a `base` that is not a commit of `repo` it throws.
 *
 * The legs, in the order they run here:
 *
 *   (a) [M1] the green clone: `HEAD` is the first commit's sha, `one.txt` is
 *       present, `two.txt` is absent.
 *   (b) [M1] the red call: `base` set to forty `0`s throws.
 *
 * Every `git` child this file spawns to build its own fixture repository, or
 * to read `dest`'s `HEAD` back, gets `env: simEnv()` from `./_helpers.mjs` —
 * never `process.env` — so the exam sees only what it built, not the box it
 * runs on. `cloneAtBase` itself is called with no `git` override, so its own
 * default git plumbing runs exactly as a real caller would drive it.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { simEnv } from './_helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'factory-clone-')))
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }))

/** One environment for every git child this exam spawns directly. */
const ENV = simEnv()

/** Runs one git command in `cwd` with the exam's own hermetic environment. */
function git (argv, cwd) {
  return execFileSync('git', argv, { cwd, env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

/** The deliverable, imported dynamically: a tree without `factory/clone.mjs`
 *  reports the ABSENT MODULE as an assertion of leg (a) rather than dying at
 *  load with no leg named at all. */
let clone = null
let cloneImportError = null
try {
  clone = await import('../../factory/clone.mjs')
} catch (error) {
  cloneImportError = error
}
assert.ok(cloneImportError === null,
  '(a) [M1] `factory/clone.mjs` is importable — the module this task creates. Got: ' +
  String(cloneImportError && (cloneImportError.message || cloneImportError)))
assert.equal(typeof clone.cloneAtBase, 'function',
  '(a) [M1] it exports `cloneAtBase({ repo, dest, base })`; got ' +
  JSON.stringify(typeof clone.cloneAtBase))
const { cloneAtBase } = clone

// ══════════════════════════════════════════════════════════════════════════
// Fixture: a real two-commit repository — `one.txt` then `two.txt`.
// ══════════════════════════════════════════════════════════════════════════

const repo = path.join(tmp, 'repo')
fs.mkdirSync(repo, { recursive: true })
git(['init', '--quiet'], repo)
git(['config', 'user.name', 'exam'], repo)
git(['config', 'user.email', 'exam@localhost'], repo)
git(['config', 'commit.gpgsign', 'false'], repo)

fs.writeFileSync(path.join(repo, 'one.txt'), 'one\n')
git(['add', 'one.txt'], repo)
git(['commit', '--quiet', '-m', 'one'], repo)
const firstSha = git(['rev-parse', 'HEAD'], repo).trim()

fs.writeFileSync(path.join(repo, 'two.txt'), 'two\n')
git(['add', 'two.txt'], repo)
git(['commit', '--quiet', '-m', 'two'], repo)
const secondSha = git(['rev-parse', 'HEAD'], repo).trim()

assert.notEqual(firstSha, secondSha,
  '(fixture) the two commits made for this exam have distinct shas; got ' +
  JSON.stringify({ firstSha, secondSha }))

// ══════════════════════════════════════════════════════════════════════════
// (a) [M1] the green clone: HEAD is the FIRST commit, not the tip
// ══════════════════════════════════════════════════════════════════════════

const dest = path.join(tmp, 'dest')
const returned = cloneAtBase({ repo, dest, base: firstSha })
assert.equal(returned, dest,
  '(a) [M1] `cloneAtBase` returns the `dest` it was given; got ' + JSON.stringify(returned))

const destHead = git(['rev-parse', 'HEAD'], dest).trim()
assert.equal(destHead, firstSha,
  '(a) [M1] `dest`\'s `HEAD` is exactly `base`, the FIRST commit — not the tip ' +
  JSON.stringify(secondSha) + '; got ' + JSON.stringify(destHead))
assert.notEqual(destHead, secondSha,
  '(a) [M1] `dest`\'s `HEAD` is not the second (tip) commit; got ' + JSON.stringify(destHead))

assert.equal(fs.existsSync(path.join(dest, 'one.txt')), true,
  '(a) [M1] `dest` holds the first commit\'s file, `one.txt`.')
assert.equal(fs.existsSync(path.join(dest, 'two.txt')), false,
  '(a) [M1] `dest` does NOT hold the second commit\'s file, `two.txt` — the checkout is ' +
  'at BASE, not the tip.')

// ══════════════════════════════════════════════════════════════════════════
// (b) [M1] the red call: a `base` that is not a commit of `repo` throws
// ══════════════════════════════════════════════════════════════════════════

const badBase = '0'.repeat(40)
const badDest = path.join(tmp, 'dest-bad')
assert.throws(() => cloneAtBase({ repo, dest: badDest, base: badBase }),
  '(b) [M1] `cloneAtBase` called with a `base` of forty zeros — not a commit of `repo` — ' +
  'throws rather than silently leaving `dest` at the wrong tree.')

console.log('ALL TESTS PASSED')
