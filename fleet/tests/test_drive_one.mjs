// fleet/tests/test_drive_one.mjs — #193 item 6: the committed drive CLI
// replaces the hand-typed RUNBOOK heredoc. Pins argv parsing, the driveOne
// option shape the heredoc used to build by hand, and that the OAuth token
// travels only as engineEnv (read via an injected reader — the real path is
// never touched here).
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  DEFAULTS,
  REPO_DIR,
  buildDriveOptions,
  main,
  parseArgs,
  usage,
} from '../drive-one.mjs'

let passed = 0
const ok = (label) => {
  passed += 1
  console.log(`ok - ${label}`)
}

// --- parseArgs ------------------------------------------------------------

{
  const p = parseArgs(['docs/plan.md', 'run-42'])
  assert.equal(p.planPath, 'docs/plan.md')
  assert.equal(p.runId, 'run-42')
  assert.equal(p.golden, DEFAULTS.golden)
  assert.equal(p.port, 8180)
  assert.equal(p.dbDir, '/tmp/fleet-orch-live')
  assert.equal(p.capTokens, 500_000)
  assert.equal(p.ttlHours, 4)
  assert.equal(p.tokenPath, '/home/exedev/.fleet/claude-oauth-token')
  assert.equal(p.repoDir, REPO_DIR)
  assert.equal(p.allowUnfitPlan, false)
  assert.equal(p.evidenceDir, undefined)
  ok('defaults match the RUNBOOK heredoc constants')
}

{
  const p = parseArgs([
    'p.md', 'run-43', '--port', '40109', '--db-dir', '/tmp/x', '--golden', 'g2',
    '--cap-tokens', '250000', '--ttl-hours', '2', '--evidence-dir', '/tmp/ev',
    '--sandbox-cpu', '4', '--sandbox-memory', '8GB', '--token-path', '/tmp/tok',
    '--repo-dir', '/tmp/repo', '--allow-unfit-plan',
  ])
  assert.equal(p.port, 40109)
  assert.equal(p.dbDir, '/tmp/x')
  assert.equal(p.golden, 'g2')
  assert.equal(p.capTokens, 250_000)
  assert.equal(p.ttlHours, 2)
  assert.equal(p.evidenceDir, '/tmp/ev')
  assert.equal(p.sandboxCpu, 4)
  assert.equal(p.sandboxMemory, '8GB')
  assert.equal(p.tokenPath, '/tmp/tok')
  assert.equal(p.repoDir, '/tmp/repo')
  assert.equal(p.allowUnfitPlan, true)
  ok('every flag overrides its default; numeric flags coerce')
}

{
  // Flags may precede the positionals — operators paste them in either order.
  const p = parseArgs(['--port', '1', 'p.md', 'run-1'])
  assert.equal(p.port, 1)
  assert.equal(p.runId, 'run-1')
  ok('flag order is free')
}

assert.throws(() => parseArgs(['p.md']), /expected exactly <plan.md> <runId>/)
assert.throws(() => parseArgs([]), /expected exactly <plan.md> <runId>/)
assert.throws(() => parseArgs(['p.md', 'run-1', 'extra']), /expected exactly/)
ok('missing or surplus positionals refuse with the usage line')

assert.throws(() => parseArgs(['p.md', 'run-1', '--bogus', 'x']), /unknown flag --bogus/)
assert.throws(() => parseArgs(['p.md', 'run-1', '--port']), /--port needs a value/)
assert.throws(() => parseArgs(['p.md', 'run-1', '--port', '--db-dir', '/x']), /--port needs a value/)
assert.throws(() => parseArgs(['p.md', 'run-1', '--port', 'eighty']), /--port must be a number/)
ok('unknown flags, missing values and non-numeric numerics refuse')

assert.throws(() => parseArgs(['p.md', 'run 1']), /#211/)
assert.throws(() => parseArgs(['p.md', 'run/1']), /#211/)
ok('a runId is a clean token — it names the VM and the store row (#211)')

assert.match(usage(), /node fleet\/drive-one\.mjs <plan\.md> <runId>/)
ok('usage names the committed entry point')

// --- buildDriveOptions ----------------------------------------------------

{
  const parsed = parseArgs(['docs/plan.md', 'run-44', '--token-path', '/nowhere/token'])
  const seen = []
  const readToken = (p) => {
    seen.push(p)
    return '  fake-token  \n'
  }
  const exec = async () => ({ code: 0, stdout: '' })
  const o = buildDriveOptions(parsed, { readToken, exec })
  assert.deepEqual(seen, ['/nowhere/token'])
  assert.equal(o.engineEnv.CLAUDE_CODE_OAUTH_TOKEN, 'fake-token')
  assert.equal(o.exec, exec)
  assert.equal(o.planPath, 'docs/plan.md')
  assert.equal(o.runId, 'run-44')
  assert.equal(o.golden, 'fleet-golden')
  assert.equal(o.port, 8180)
  assert.equal(o.dbDir, '/tmp/fleet-orch-live')
  assert.equal(o.repoDir, REPO_DIR)
  assert.equal(o.capTokens, 500_000)
  assert.equal(o.ttlMs, 4 * 60 * 60 * 1000)
  assert.equal(o.heartbeatTimeoutMs, 30 * 60_000)
  assert.equal(o.claimTimeoutMs, 10 * 60_000)
  assert.equal(o.allowUnfitPlan, false)
  assert.equal('evidenceDir' in o, false)
  assert.equal('sandboxCpu' in o, false)
  assert.equal('sandboxMemory' in o, false)
  ok('options reproduce the heredoc shape; token read via the reader, trimmed, engineEnv only')
}

{
  const parsed = parseArgs(['p.md', 'run-45', '--evidence-dir', '/tmp/ev', '--sandbox-cpu', '6', '--sandbox-memory', '12GB', '--ttl-hours', '1'])
  const o = buildDriveOptions(parsed, { readToken: () => 't', exec: async () => ({ code: 0, stdout: '' }) })
  assert.equal(o.evidenceDir, '/tmp/ev')
  assert.equal(o.sandboxCpu, 6)
  assert.equal(o.sandboxMemory, '12GB')
  assert.equal(o.ttlMs, 60 * 60 * 1000)
  ok('optional sandbox/evidence knobs pass through only when given')
}

{
  // The default repoDir is the checkout this module lives in, so the CLI no
  // longer depends on the caller's cwd.
  assert.ok(fs.existsSync(path.join(REPO_DIR, 'fleet', 'drive.mjs')), REPO_DIR)
  assert.ok(fs.existsSync(path.join(REPO_DIR, '.claude-plugin', 'plugin.json')), REPO_DIR)
  ok('REPO_DIR resolves to the repo root from the module location')
}

// --- main -----------------------------------------------------------------

{
  const calls = []
  const lines = []
  const drive = async (opts) => {
    calls.push(opts)
    return { read: { o1: true, runId: opts.runId }, reportPath: '/tmp/r.json', detailPath: '/tmp/d.json' }
  }
  const read = await main(['p.md', 'run-46', '--port', '7'], {
    drive,
    log: (l) => lines.push(l),
    readToken: () => 'tok',
    exec: async () => ({ code: 0, stdout: '' }),
  })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].port, 7)
  assert.equal(calls[0].runId, 'run-46')
  assert.equal(calls[0].engineEnv.CLAUDE_CODE_OAUTH_TOKEN, 'tok')
  assert.deepEqual(read, { o1: true, runId: 'run-46' })
  assert.equal(lines[0], JSON.stringify({ o1: true, runId: 'run-46' }, null, 2))
  assert.equal(lines[1], 'report: /tmp/r.json')
  assert.equal(lines[2], 'detail: /tmp/d.json')
  assert.ok(!lines.join('\n').includes('tok'), 'the token must never be printed')
  ok('main parses, drives once, prints the gate read + paths, never the token')
}

console.log(`\nALL TESTS PASSED (${passed})`)
