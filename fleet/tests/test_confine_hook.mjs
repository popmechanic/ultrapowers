// fleet/tests/test_confine_hook.mjs — the implementer's PreToolUse boundary.
//
// Two layers under test, matching the hook's own contract:
//   decide()        the pure verdict, over the documented input shapes
//   the CLI         stdin → exit code (0 allow / 2 deny), including the
//                   fail-closed branch on unparsable input — the half a unit
//                   test of decide() cannot see.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { decide, bashWriteTargets, within } from '../confine-hook.mjs'

const HOOK = fileURLToPath(new URL('../confine-hook.mjs', import.meta.url))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'confine-'))
const clone = path.join(tmp, 'clone')
const runDir = path.join(tmp, 'run')
fs.mkdirSync(clone, { recursive: true })
fs.mkdirSync(runDir, { recursive: true })

// ── within ───────────────────────────────────────────────────────────────────
assert.ok(within([clone], 'src/a.js', clone), 'relative resolves under cwd')
assert.ok(within([clone], clone + '/x', clone))
assert.ok(!within([clone], '/etc/passwd', clone))
// Prefix means PATH prefix, not string prefix: /tmp/clone-evil must not pass
// as inside /tmp/clone.
assert.ok(!within([clone], clone + '-evil/x', clone))
// `..` escapes are resolved before the check.
assert.ok(!within([clone], clone + '/../outside', clone))

// ── bashWriteTargets — the closed denylist's parse ───────────────────────────
assert.deepEqual(bashWriteTargets('echo hi > out.txt'), ['out.txt'])
assert.deepEqual(bashWriteTargets('echo hi >> /etc/motd'), ['/etc/motd'])
assert.deepEqual(bashWriteTargets('echo x>/etc/f'), ['/etc/f'], 'no-space redirection is seen')
assert.deepEqual(bashWriteTargets('cmd 2>/tmp/err'), ['/tmp/err'], 'fd-prefixed redirection is seen')
assert.ok(bashWriteTargets('echo hi | tee /etc/x /etc/y').includes('/etc/x'))
assert.ok(bashWriteTargets('echo hi | tee /etc/x /etc/y').includes('/etc/y'))
assert.ok(bashWriteTargets('curl -o /tmp/dl http://x').includes('/tmp/dl'))
assert.ok(bashWriteTargets('git diff --output=/tmp/d HEAD').includes('/tmp/d'),
  'git diff --output is a write primitive (spec §4)')
assert.ok(bashWriteTargets('git diff --output /tmp/d2 HEAD').includes('/tmp/d2'))
assert.deepEqual(bashWriteTargets('ls -la && pytest -q'), [], 'no write form, no targets')

// ── decide ───────────────────────────────────────────────────────────────────
const D = (tool, ti, cwd = clone) => decide({ tool_name: tool, tool_input: ti, cwd })

assert.ok(D('Edit', { file_path: path.join(clone, 'a.js') }).allow)
assert.ok(D('Edit', { file_path: 'rel/b.js' }).allow, 'relative edit resolves under cwd')
assert.ok(D('Write', { file_path: '/etc/hostile' }).deny, 'absolute outside is denied')
assert.ok(D('Edit', { file_path: clone + '/../escape.js' }).deny, 'dot-dot escape is denied')
assert.ok(D('NotebookEdit', { notebook_path: '/etc/nb.ipynb' }).deny)
assert.ok(D('Bash', { command: 'pytest -q' }).allow)
assert.ok(D('Bash', { command: 'echo x > notes.txt' }).allow, 'relative redirect stays in the clone')
assert.ok(D('Bash', { command: 'echo x > /etc/motd' }).deny)
assert.ok(D('Bash', { command: 'pytest -q 2>/dev/null' }).allow, '/dev/* is a sink, not storage')
assert.ok(D('Bash', { command: 'cat secrets | tee /etc/leak' }).deny)
assert.ok(D('Grep', { pattern: 'x' }).allow, 'a read tool with no path keys passes')

// FLEET_RUN_DIR is the second root: the review packet lands there.
{
  const prev = process.env.FLEET_RUN_DIR
  process.env.FLEET_RUN_DIR = runDir
  try {
    assert.ok(D('Write', { file_path: path.join(runDir, 'review', 'p.md') }).allow,
      'the run scratch dir is writable')
    assert.ok(D('Bash', { command: 'echo x > ' + path.join(runDir, 'review', 'out') }).allow)
    assert.ok(D('Write', { file_path: '/etc/x' }).deny, 'outside both roots still denied')
  } finally {
    if (prev === undefined) delete process.env.FLEET_RUN_DIR
    else process.env.FLEET_RUN_DIR = prev
  }
}

// ── the CLI: stdin → exit code ───────────────────────────────────────────────
const run = (input, env = {}) => spawnSync('node', [HOOK], {
  input, encoding: 'utf8', cwd: clone, env: { ...process.env, ...env },
})
{
  const ok = run(JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: 'a.js' }, cwd: clone }))
  assert.equal(ok.status, 0, 'allow exits 0: ' + ok.stderr)
  const deny = run(JSON.stringify({ tool_name: 'Write', tool_input: { file_path: '/etc/x' }, cwd: clone }))
  assert.equal(deny.status, 2, 'deny exits 2')
  assert.match(deny.stderr, /outside the writable roots/, 'the reason reaches stderr')
  const garbage = run('not json at all')
  assert.equal(garbage.status, 2, 'unparsable input fails CLOSED')
  assert.match(garbage.stderr, /fail-closed/)
}

fs.rmSync(tmp, { recursive: true, force: true })
console.log('ALL TESTS PASSED')
