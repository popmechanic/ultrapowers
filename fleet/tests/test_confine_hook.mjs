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

// #475 — DATA IS NOT CODE. Six of eleven post-cutover denials were the scan
// reading a redirect character out of a heredoc body, a quoted string or a
// glob. Each of these is legitimate in-clone work that used to be denied.
assert.deepEqual(bashWriteTargets(`echo "a -> b"`), [],
  'a quoted arrow is text, not a redirect (run-30, reproduced against the shipped hook)')
assert.deepEqual(bashWriteTargets("cat > f.py <<'PY'\nx = {}\nd = a -> b\nprint(1 > 0)\nPY"), ['f.py'],
  'the heredoc BODY is data; only the real redirect target survives')
assert.deepEqual(bashWriteTargets("cat > f.md <<'EOF'\nrun `ls` and see /*/ globs\nEOF"), ['f.md'],
  'backticks and globs inside a heredoc body are not write targets')
assert.deepEqual(bashWriteTargets(`echo 'cost > budget'`), [],
  'single-quoted text is data too')

// THE OTHER DIRECTION — the fix must not buy quiet by going blind. Masking
// preserves indices and the target is sliced from the ORIGINAL, so a
// legitimately quoted target is still found. Deleting the span instead would
// erase the target and turn a false-deny fix into a HOLE.
assert.deepEqual(bashWriteTargets('echo hi > "/tmp/f"'), ['/tmp/f'],
  'a QUOTED target is still a target')
assert.deepEqual(bashWriteTargets("echo hi > '/tmp/f'"), ['/tmp/f'])
assert.deepEqual(bashWriteTargets('echo hi | tee "/etc/x"'), ['/etc/x'],
  'a quoted tee target is still a target')
assert.deepEqual(bashWriteTargets("cat > /tmp/out <<'EOF'\nbody\nEOF"), ['/tmp/out'],
  'a heredoc does not launder the redirect in front of it')
assert.deepEqual(bashWriteTargets('echo x > $O'), ['$O'],
  'an unresolvable expansion in a real target still reaches the deny path')
assert.deepEqual(bashWriteTargets("echo 'quoted' > /etc/f"), ['/etc/f'],
  'a quoted ARGUMENT does not hide the redirect that follows it')
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

// /dev/.. is not a device: the exemption tests the RESOLVED path (finding 2).
assert.ok(D('Bash', { command: 'echo x > /dev/../etc/passwd' }).deny, '/dev/.. escapes are denied')
assert.ok(D('Bash', { command: 'echo x > /dev/../../root/x' }).deny)

// A relative redirect after a `cd` out of the clone is the CONCEDED limit (the
// VM is the backstop): the target resolves under cwd and passes. A heuristic to
// catch it was bypassable AND false-denied `git commit -m "...cd .."`, so it is
// not attempted — pinned here so a future reviewer does not re-add it blind.
assert.ok(D('Bash', { command: 'cd /tmp && echo x > out.txt' }).allow,
  'cd-escape is the conceded incomplete-parsing class, not a claimed guarantee')
assert.ok(D('Bash', { command: 'git commit -m "refactor cd .. handling" && echo done > log.txt' }).allow,
  'a command whose text mentions cd .. must not lose an unrelated in-clone write')

// A redirect target with a shell expansion is not statically resolvable → deny:
// the literal token would resolve inside the clone and pass while the shell
// writes elsewhere. This DOES close the enumerated redirect form.
assert.ok(D('Bash', { command: 'O=/etc/x; echo pwned > $O' }).deny, '$VAR redirect target is refused')
assert.ok(D('Bash', { command: 'echo pwned > $(printf /etc)/passwd' }).deny, 'command-substitution target is refused')
assert.ok(D('Bash', { command: 'echo pwned > `echo /etc`/x' }).deny, 'backtick target is refused')

// FLEET_RUN_DIR is the second root — but clones/ and patches/ are carved out
// of it, so a worker cannot reach a sibling's tree or the trust-anchored
// patch files (finding 1).
{
  const prev = process.env.FLEET_RUN_DIR
  process.env.FLEET_RUN_DIR = runDir
  try {
    assert.ok(D('Write', { file_path: path.join(runDir, 'review', 'p.md') }).allow,
      'the run scratch dir is writable')
    assert.ok(D('Write', { file_path: path.join(runDir, 'frontier', 'wave-1', 'c') }).allow,
      'the fold candidate dir is writable')
    assert.ok(D('Bash', { command: 'echo x > ' + path.join(runDir, 'review', 'out') }).allow)
    assert.ok(D('Write', { file_path: '/etc/x' }).deny, 'outside both roots still denied')
    // The carve-outs: a sibling clone and a sibling's patch file.
    assert.ok(D('Write', { file_path: path.join(runDir, 'clones', 'task-B', 'x') }).deny,
      'a sibling clone is not writable even though it is under the run dir')
    assert.ok(D('Write', { file_path: path.join(runDir, 'patches', 'task-B.patch') }).deny,
      'the trust-anchored patch dir is not writable at the file layer')
    assert.ok(D('Bash', { command: 'echo evil > ' + path.join(runDir, 'patches', 'task-B.patch') }).deny)
    // The worker's OWN clone is always writable — via cwd, even though it is
    // under the carved-out clones/ subtree.
    const ownClone = path.join(runDir, 'clones', 'task-A')
    assert.ok(decide({ tool_name: 'Write', tool_input: { file_path: path.join(ownClone, 'a.js') }, cwd: ownClone }).allow,
      "a worker's own clone is reachable via cwd despite the clones/ carve-out")
    // The write-side role's cwd is the integration clone — writable via cwd.
    const integ = path.join(runDir, 'clones', 'integration')
    assert.ok(decide({ tool_name: 'Write', tool_input: { file_path: path.join(integ, 'm.js') }, cwd: integ }).allow,
      'the integration clone is writable by the role whose cwd it is')
  } finally {
    if (prev === undefined) delete process.env.FLEET_RUN_DIR
    else process.env.FLEET_RUN_DIR = prev
  }
}

// ── the CLI: stdin → exit code ───────────────────────────────────────────────
// The base env STRIPS FLEET_RUN_DIR: when this suite runs INSIDE a fleet run
// (the sandbox baseline, a worker's testCmd), the worker env carries the live
// run's FLEET_RUN_DIR, and every deliberate test denial below would then be
// appended to that run's confine-denials.jsonl — 4 of run-25's 6 logged
// denials were this suite, not real escapes, corrupting the confinement
// evidence. A test that needs the log passes FLEET_RUN_DIR explicitly.
const baseEnv = { ...process.env }
delete baseEnv.FLEET_RUN_DIR
const run = (input, env = {}) => spawnSync('node', [HOOK], {
  input, encoding: 'utf8', cwd: clone, env: { ...baseEnv, ...env },
})
{
  // The CLI must AUTHORITATIVELY allow/deny via the PreToolUse decision JSON —
  // a silent exit-0 leaves the permission flow to prompt, which blocks a
  // headless worker (the first self-hosted run parked exactly there).
  const decisionOf = (r) => {
    try { return JSON.parse(r.stdout).hookSpecificOutput.permissionDecision } catch { return null }
  }
  const ok = run(JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: 'a.js' }, cwd: clone }))
  assert.equal(ok.status, 0, 'allow exits 0: ' + ok.stderr)
  assert.equal(decisionOf(ok), 'allow', 'an in-root call is explicitly ALLOWED, not left silent')
  // A non-write Bash (git worktree add) — the exact call the first run blocked on.
  const worktree = run(JSON.stringify({ tool_name: 'Bash',
    tool_input: { command: 'git worktree add .claude/worktrees/wf-x -b b fleet-base' }, cwd: clone }))
  assert.equal(decisionOf(worktree), 'allow', 'git worktree add is auto-approved headless')
  const deny = run(JSON.stringify({ tool_name: 'Write', tool_input: { file_path: '/etc/x' }, cwd: clone }))
  assert.equal(deny.status, 0, 'deny uses the JSON decision, exit 0')
  assert.equal(decisionOf(deny), 'deny', 'an out-of-root write is explicitly DENIED')
  assert.match(JSON.parse(deny.stdout).hookSpecificOutput.permissionDecisionReason, /outside the writable roots/)
  // #475 THE COOPERATIVE MIRROR. probe_confine_live.mjs proves the boundary
  // holds against a HOSTILE task; nothing proved the shipped hook lets ordinary
  // work through, so six false denials rode five runs unseen. These are the
  // reproduced cases, against the real binary rather than the parser.
  const bash = (command) => decisionOf(run(JSON.stringify({
    tool_name: 'Bash', tool_input: { command }, cwd: clone })))
  assert.equal(bash(`echo "a -> b"`), 'allow', 'a quoted arrow is not a redirect (run-30)')
  assert.equal(bash("cat > notes.py <<'PY'\nd = a -> b\nassert 1 > 0\nPY"), 'allow',
    'a heredoc body containing redirect characters is data (run-32, 3 of 6 implementers)')
  assert.equal(bash("cat > r.md <<'EOF'\nsee `ls` and /*/ globs\nEOF"), 'allow',
    'backticks and globs inside a heredoc body are data (run-28, run-32)')
  // ...and the boundary is unchanged by all of that.
  assert.equal(bash('echo hi > "/tmp/escape"'), 'deny', 'a QUOTED out-of-root target still denies')
  assert.equal(bash("cat > /tmp/escape <<'EOF'\nbody\nEOF"), 'deny',
    'a heredoc does not launder the redirect in front of it')
  assert.equal(bash('echo x > $O'), 'deny', 'an unresolvable expansion still denies')

  const garbage = run('not json at all')
  assert.equal(garbage.status, 2, 'unparsable input fails CLOSED (exit 2)')
  assert.equal(decisionOf(garbage), 'deny', 'and emits a deny decision too')

  // A deny is recorded to <FLEET_RUN_DIR>/confine-denials.jsonl — the probe's
  // only readable signal (the decision JSON is consumed by Claude Code).
  const logRun = path.join(tmp, 'logrun')
  fs.mkdirSync(logRun, { recursive: true })
  run(JSON.stringify({ tool_name: 'Write', tool_input: { file_path: '/etc/x' }, cwd: clone }),
    { FLEET_RUN_DIR: logRun })
  const logged = fs.readFileSync(path.join(logRun, 'confine-denials.jsonl'), 'utf8').trim().split('\n')
  assert.equal(logged.length, 1, 'the denial is recorded')
  assert.match(JSON.parse(logged[0]).reason, /outside the writable roots/)
}

fs.rmSync(tmp, { recursive: true, force: true })
console.log('ALL TESTS PASSED')
