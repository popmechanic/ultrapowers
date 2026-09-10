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
import { simEnv } from './_helpers.mjs'

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
// The base env carries no FLEET_RUN_DIR: `simEnv` drops every `FLEET_` key of
// this process, and when this suite runs INSIDE a fleet run (the sandbox
// baseline, a worker's testCmd) that process carries the live run's
// FLEET_RUN_DIR. Inherited, every deliberate test denial below would be
// appended to that run's confine-denials.jsonl — 4 of run-25's 6 logged
// denials were this suite, not real escapes, corrupting the confinement
// evidence. A test that needs the log passes FLEET_RUN_DIR explicitly.
const HOOK_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-confine-home-'))
const hookEnv = (env) => ({ ...simEnv({ home: HOOK_HOME }), ...env })
const run = (input, env = {}) => spawnSync('node', [HOOK], {
  input, encoding: 'utf8', cwd: clone, env: hookEnv(env),
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

  // REVIEW FINDINGS 1 + 2 (both HIGH, both verified against main before the fix):
  // an unbalanced parse used to mask to end-of-string, so every write target
  // after it vanished and the hook ALLOWED what main denied. Masking must only
  // ever cost a false deny, never a miss.
  assert.equal(bash('echo $((1 << n))\necho hi > /etc/passwd'), 'deny',
    'an arithmetic shift is not a heredoc introducer')
  assert.equal(bash('cat <<< "x"\necho hi > /etc/passwd'), 'deny',
    'a herestring is not a heredoc introducer')
  assert.equal(bash(`echo "a << b"\necho hi > /etc/passwd`), 'deny',
    'a quoted << does not open a body')
  assert.equal(bash("# don't do that\necho hi > /etc/passwd"), 'deny',
    'an apostrophe in a comment leaves the quote unbalanced — fall back, do not blind')
  assert.equal(bash("cat > f.py <<'PY'\nunterminated body, no closing tag\necho hi > /etc/passwd"), 'deny',
    'an unterminated heredoc is no evidence a heredoc began')
  // and the real heredoc still works even when an arithmetic shift precedes it
  assert.equal(bash("echo $((1 << n))\ncat > ok.py <<'PY'\nd = a -> b\nPY"), 'allow',
    'a false << earlier must not stop a real heredoc from being recognised')

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

// ── #762: a kill whose pattern would match the worker's own `claude -p` ──────
//
// run-34's implementer ran `pkill -f <the TEST COMMAND it had just been given>`
// to clear a stuck test. The worker's own argv IS `claude -p <prompt>` and the
// prompt carries the `TEST COMMAND:` line verbatim, so the pattern matched the
// process running the task and the worker killed itself.
//
// The hook cannot see the prompt — it reads the PreToolUse JSON and its own
// environment. The worker is what tells it: `FLEET_TEST_CMD` (the three
// `createRunWorker` legs live in fleet/tests/test_run_worker.mjs). Here: a kill
// pattern that matches that value, or matches `claude`, is refused; a pattern
// that matches neither, a kill by pid, and a quoted `pkill` are not.
//
// Every leg below names its Proof letter and its Machine clause. The verdict
// shape is `decide()`'s: `{ deny: <string> }` or `{ allow: true }`, so "deny and
// no allow" is asserted on both keys rather than on one.
{
  const TESTCMD = 'node fleet/tests/test_sandbox_boot.mjs'

  // The `decide()` legs read FLEET_TEST_CMD off process.env, so each group
  // toggles it inside a try/finally — the shape the FLEET_RUN_DIR block above
  // uses. `undefined` means DELETE the key, which is leg (g)-(i)'s environment.
  const withEnv = (vars, fn) => {
    const prev = {}
    for (const k of Object.keys(vars)) prev[k] = process.env[k]
    try {
      for (const [k, v] of Object.entries(vars)) {
        if (v === undefined) delete process.env[k]
        else process.env[k] = v
      }
      return fn()
    } finally {
      for (const k of Object.keys(vars)) {
        if (prev[k] === undefined) delete process.env[k]
        else process.env[k] = prev[k]
      }
    }
  }

  // A deny leg: the verdict denies, does not allow, and its reason CONTAINS
  // each needle the leg names. Containment is what the legs specify (the deny
  // string's wording is the implementer's), but the needles are exact — an
  // offending pattern a reader cannot find in the reason is not this fix.
  const denies = (leg, command, needles) => {
    const v = decide({ tool_name: 'Bash', tool_input: { command }, cwd: clone })
    assert.ok(v.deny, leg + ': ' + JSON.stringify(command) + ' must DENY — it would match the ' +
      "worker's own claude -p process; got " + JSON.stringify(v))
    assert.ok(!v.allow, leg + ': a denied kill must not also carry allow; got ' + JSON.stringify(v))
    for (const n of needles) {
      assert.ok(String(v.deny).includes(n),
        leg + ': the reason must name ' + JSON.stringify(n) + '; reason was ' + JSON.stringify(v.deny))
    }
    return String(v.deny)
  }
  const allows = (leg, command) => {
    const v = decide({ tool_name: 'Bash', tool_input: { command }, cwd: clone })
    assert.ok(v.allow, leg + ': ' + JSON.stringify(command) + ' must be ALLOWED — it matches ' +
      'neither the TEST COMMAND nor claude; got ' + JSON.stringify(v))
    assert.ok(!v.deny, leg + ': ' + JSON.stringify(command) + ' must carry no deny; got ' + JSON.stringify(v))
  }

  // (a)-(f) [M1] — the pattern is tried against FLEET_TEST_CMD, as a regular
  // expression or (when the constructor throws) as a literal substring, and the
  // kill is found wherever it sits in the command. Each reason names the
  // offending pattern, `TEST COMMAND` and `claude -p`, because the deny string
  // is the whole of what the model reads back.
  withEnv({ FLEET_TEST_CMD: TESTCMD }, () => {
    denies('(a) [M1]', "pkill -f 'node fleet/tests/test_sandbox_boot.mjs'",
      ['node fleet/tests/test_sandbox_boot.mjs', 'TEST COMMAND', 'claude -p'])
    denies('(b) [M1]', 'pkill -9 -f test_sandbox_boot',
      ['test_sandbox_boot', 'TEST COMMAND', 'claude -p'])
    denies('(c) [M1]', 'killall -q test_sandbox_boot.mjs',
      ['test_sandbox_boot.mjs', 'TEST COMMAND', 'claude -p'])
    // A pattern that matches only as a REGULAR EXPRESSION — no literal
    // substring of the TEST COMMAND looks like this.
    denies('(d) [M1]', "pkill -f 'fleet/tests/.*\\.mjs'",
      ['fleet/tests/.*\\.mjs', 'TEST COMMAND', 'claude -p'])
    // (f) the kill is not the command's first word: `true; pkill …` is the same
    // kill as `pkill …`.
    denies('(f) [M1]', 'true; pkill -f test_sandbox_boot',
      ['test_sandbox_boot', 'TEST COMMAND', 'claude -p'])
  })
  // (e) [M1] the other half of the same sentence: an unbalanced parenthesis is
  // not a valid regular expression, so the LITERAL fallback is the only thing
  // that can match here. A hook that only ever tried `new RegExp` would throw
  // or allow; this leg is the one that fails if the fallback is missing.
  withEnv({ FLEET_TEST_CMD: 'node test_sandbox_boot.mjs (x' }, () => {
    denies('(e) [M1]', "pkill -f 'test_sandbox_boot.mjs (x'",
      ['test_sandbox_boot.mjs (x', 'TEST COMMAND', 'claude -p'])
  })

  // (g)-(i) [M2] — with NO TEST COMMAND known, `claude` is still a target: the
  // worker's process is `claude -p` whatever it was asked to run.
  withEnv({ FLEET_TEST_CMD: undefined }, () => {
    assert.equal(process.env.FLEET_TEST_CMD, undefined, 'sanity: (g)-(i) run with the key deleted')
    denies('(g) [M2]', 'pkill -f claude', ['claude'])
    denies('(h) [M2]', 'pkill claude', ['claude'])
    denies('(i) [M2]', 'killall claude', ['claude'])
  })
  // (j)-(n) [M2] — and `claude` is tried on EVERY kill pattern, not only when
  // no TEST COMMAND is known. `node fleet/tests/test_sandbox_boot.mjs` is the
  // value the worker sets on every live dispatch, and `claude` does not match
  // it — so a hook that stopped at the TEST COMMAND would allow all five.
  withEnv({ FLEET_TEST_CMD: TESTCMD }, () => {
    denies('(j) [M2]', 'pkill -f claude', ['claude'])
    denies('(k) [M2]', 'pkill claude', ['claude'])
    denies('(l) [M2]', 'killall claude', ['claude'])
    denies('(m) [M2]', 'echo x && pkill -f claude', ['claude'])
    denies('(n) [M2]', 'cd /tmp; killall claude', ['claude'])

    // (o)-(s) [M3] — THE OTHER DIRECTION, and the reason this is a rule about
    // self-match rather than a rule about `pkill`. A worker that started its own
    // server must still be able to stop it, a kill BY PID is not the hook's
    // business, and a quoted `pkill` is data (#475's masking rule).
    allows('(o) [M3]', 'pkill -f my-proto-server')
    allows('(p) [M3]', 'kill 1234')
    allows('(q) [M3]', 'kill -TERM 1234')
    allows('(r) [M3]', 'pkill -f prototype && echo done')
    allows('(s) [M3]', 'echo "pkill -f claude"')
  })

  // (t) [M4] — the new reason rides the EXISTING deny path: the CLI prints it as
  // `permissionDecisionReason` and appends one line naming it to the run's
  // confine-denials.jsonl. The expected string is not spelled here — it is read
  // from `decide()` under the same environment, so this leg pins that the two
  // channels carry the SAME reason rather than pinning any wording.
  {
    const killRun = path.join(tmp, 'killrun')
    fs.mkdirSync(killRun, { recursive: true })
    const command = "pkill -f 'node fleet/tests/test_sandbox_boot.mjs'"
    const input = JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd: clone })
    const expected = withEnv({ FLEET_TEST_CMD: TESTCMD, FLEET_RUN_DIR: killRun },
      () => decide({ tool_name: 'Bash', tool_input: { command }, cwd: clone }).deny)
    assert.equal(typeof expected, 'string', '(t) [M4]: decide() must deny this input to begin with')

    const r = run(input, { FLEET_TEST_CMD: TESTCMD, FLEET_RUN_DIR: killRun })
    let out = null
    try { out = JSON.parse(r.stdout).hookSpecificOutput } catch { /* asserted below */ }
    assert.ok(out, '(t) [M4]: the CLI must print a decision envelope; stdout was ' +
      JSON.stringify(r.stdout) + ' stderr ' + JSON.stringify(r.stderr))
    assert.equal(out.permissionDecision, 'deny', '(t) [M4]: the CLI decision is deny')
    assert.equal(out.permissionDecisionReason, expected,
      '(t) [M4]: the printed reason is exactly the string decide() returns for the same input')

    const logged = fs.readFileSync(path.join(killRun, 'confine-denials.jsonl'), 'utf8').trim().split('\n')
    assert.equal(logged.length, 1, '(t) [M4]: exactly one line in the run dir ledger, got ' + logged.length)
    assert.equal(JSON.parse(logged[0]).reason, expected,
      '(t) [M4]: the logged reason is that same string')
  }

  console.log('ok - #762: a kill pattern matching the TEST COMMAND or `claude` is refused')
}

fs.rmSync(tmp, { recursive: true, force: true })
console.log('ALL TESTS PASSED')
