import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { simEnv } from './_helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FLOCK = path.join(HERE, '..', '..', 'factory', 'flock')
const env = simEnv({ bin: path.join(FLOCK, 'nogit') })

{
  const r = spawnSync('sh', ['-c', 'true && git status'], { encoding: 'utf8', env })
  assert.equal(r.status, 1, '(a) git behind && exits 1')
  assert.match(r.stderr, /agents never run git/, '(a) the refusal is on stderr')
}

{
  const r = spawnSync('python3', ['-c', 'import subprocess, sys; sys.exit(subprocess.run(["git", "status"]).returncode)'], { encoding: 'utf8', env })
  assert.equal(r.status, 1, '(b) git run by a python3 subprocess exits 1')
}

const engine = fs.readFileSync(path.join(FLOCK, 'engine.mjs'), 'utf8')

assert.match(engine, /const NOGIT = path\.join\(HERE, 'nogit'\)/, '(c) NOGIT is the flock nogit directory')
assert.match(engine, /env: \{ \.\.\.process\.env, PATH: NOGIT \+ path\.delimiter \+ process\.env\.PATH/, '(c) the builder PATH starts with NOGIT')

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
