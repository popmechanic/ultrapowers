/**
 * fleet/tests/test_factory_nogit.mjs — the exam for "models never run git"
 * (#1443, replacing `factory/gitblock.mjs`'s reading of the Bash line).
 *
 * A builder's session env puts `factory/flock/nogit` first on its PATH, so a
 * git reached from inside a script is refused as surely as one typed at the
 * prompt; the engine's `PreToolUse` hook denies what the PATH cannot see, a
 * git named by its absolute path.
 *
 *   (a) `git status` behind `&&` in `sh -c` exits 1 with the refusal on stderr;
 *   (b) git run by a python3 subprocess — invisible to any reading of the
 *       command line — is refused too;
 *   (c) the engine puts the shim first on the builder's PATH;
 *   (d) the engine's absolute-path check matches `/usr/bin/git` and not a
 *       `.git` path, a `git` directory or a bare `git` word.
 *
 * No network; every spawn runs under `simEnv`.
 */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { simEnv } from './_helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FLOCK = path.join(HERE, '..', '..', 'factory', 'flock')
const env = simEnv({ bin: path.join(FLOCK, 'nogit') })

// ── a. a git behind && is refused ───────────────────────────────────────────
{
  const r = spawnSync('sh', ['-c', 'true && git status'], { encoding: 'utf8', env })
  assert.equal(r.status, 1, '(a) git behind && exits 1')
  assert.match(r.stderr, /agents never run git/, '(a) the refusal is on stderr')
}

// ── b. a git inside a script is refused ─────────────────────────────────────
{
  const r = spawnSync('python3', ['-c', 'import subprocess, sys; sys.exit(subprocess.run(["git", "status"]).returncode)'], { encoding: 'utf8', env })
  assert.equal(r.status, 1, '(b) git run by a python3 subprocess exits 1')
}

const engine = fs.readFileSync(path.join(FLOCK, 'engine.mjs'), 'utf8')

// ── c. the engine puts the shim first on the builder's PATH ─────────────────
assert.match(engine, /const NOGIT = path\.join\(HERE, 'nogit'\)/, '(c) NOGIT is the flock nogit directory')
assert.match(engine, /env: \{ \.\.\.process\.env, PATH: NOGIT \+ path\.delimiter \+ process\.env\.PATH/, '(c) the builder PATH starts with NOGIT')

// ── d. the absolute-path check ──────────────────────────────────────────────
{
  const m = engine.match(/input\.tool_name === 'Bash' && \/(.+)\/\.test\(ti\.command/)
  assert.ok(m, '(d) the engine carries the absolute-path check')
  const abs = new RegExp(m[1])
  assert.ok(abs.test('/usr/bin/git status'), '(d) /usr/bin/git is caught')
  assert.ok(abs.test('cd x && /usr/local/bin/git diff'), '(d) an absolute git behind && is caught')
  assert.ok(!abs.test('cat /tmp/repo/.git/HEAD'), '(d) a .git path is not')
  assert.ok(!abs.test('ls /srv/docs/git/README'), '(d) a git directory is not')
  assert.ok(!abs.test('grep -rn git factory/'), '(d) a bare git word is left to the PATH shim')
}

console.log('ALL TESTS PASSED')
