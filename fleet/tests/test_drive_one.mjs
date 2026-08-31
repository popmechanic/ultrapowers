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
  shellExec,
  usage,
} from '../drive-one.mjs'
import { reapDecision } from '../drive.mjs'

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
  assert.equal(p.ttlHours, 4)
  assert.equal(p.tokenPath, '/home/exedev/.fleet/claude-oauth-token')
  assert.equal(p.repoDir, REPO_DIR)
  assert.equal(p.allowUnfitPlan, false)
  assert.equal(p.evidenceDir, '/home/exedev/fleet-evidence')
  // #368: the GitHub token sits beside the OAuth token; the PR targets main.
  assert.equal(p.githubTokenPath, '/home/exedev/.fleet/github-token')
  assert.equal(p.prBase, 'main')
  ok('defaults match the RUNBOOK heredoc constants')
}

{
  // #466: the evidence corpus is the only durable record of what each run did
  // — 18 bundles, runs 10-32, everything the sense pass reads. It lived in
  // /tmp for 23 runs on luck alone, because the default DERIVED from dbDir and
  // the store dir is /tmp by design. Both halves are pinned here: the shipped
  // default must be unreapable, and it must not be a function of dbDir.
  assert.ok(
    DEFAULTS.evidenceDir !== '/tmp' && !DEFAULTS.evidenceDir.startsWith('/tmp/'),
    `the shipped evidence default is reapable: ${DEFAULTS.evidenceDir}`,
  )
  assert.notEqual(
    DEFAULTS.evidenceDir,
    `${DEFAULTS.dbDir}-evidence`,
    'the evidence default must not be derived from dbDir',
  )
  ok('#466: the shipped evidence default is durable and independent of dbDir')
}

{
  const p = parseArgs(['p.md', 'run-47', '--github-token-path', '/tmp/gh-tok', '--pr-base', 'release/1'])
  assert.equal(p.githubTokenPath, '/tmp/gh-tok')
  assert.equal(p.prBase, 'release/1')
  const o = buildDriveOptions(p, { readToken: () => 't', exec: async () => ({ code: 0, stdout: '' }) })
  assert.equal(o.githubTokenPath, '/tmp/gh-tok')
  assert.equal(o.prBase, 'release/1')
  assert.match(usage(), /--github-token-path FILE/)
  // The GitHub token is NOT read here: driveOne reads it itself (fs) and hands
  // it to git/gh as an env — buildDriveOptions only forwards the PATH.
  assert.equal('GH_TOKEN' in o, false)
  assert.ok(!JSON.stringify(o).includes('gh-tok-contents'))
  ok('#368: --github-token-path / --pr-base ride through as paths and names, never as a token')
}

{
  // #368: shellExec layers a per-command env over the process environment —
  // the channel GH_TOKEN rides — and leaves the process itself untouched.
  const withEnv = await shellExec('printf %s "$FLEET_TEST_VAR"', { env: { FLEET_TEST_VAR: 'rode-the-env' } })
  assert.deepEqual(withEnv, { code: 0, stdout: 'rode-the-env', stderr: '' })
  const without = await shellExec('printf %s "${FLEET_TEST_VAR-unset}"')
  assert.deepEqual(without, { code: 0, stdout: 'unset', stderr: '' })
  assert.equal(process.env.FLEET_TEST_VAR, undefined, 'the per-command env must not leak into the process')
  const inherits = await shellExec('printf %s "$PATH"', { env: { FLEET_TEST_VAR: 'x' } })
  assert.equal(inherits.stdout, process.env.PATH, 'the process env is inherited under the layered one')
  ok('#368: shellExec(cmd, {env}) layers env per command; no env → process env, nothing leaks')
}

{
  const p = parseArgs([
    'p.md', 'run-43', '--port', '40109', '--db-dir', '/tmp/x', '--golden', 'g2',
    '--ttl-hours', '2', '--evidence-dir', '/tmp/ev',
    '--sandbox-cpu', '4', '--sandbox-memory', '8GB', '--token-path', '/tmp/tok',
    '--repo-dir', '/tmp/repo', '--allow-unfit-plan',
  ])
  assert.equal(p.port, 40109)
  assert.equal(p.dbDir, '/tmp/x')
  assert.equal(p.golden, 'g2')
  assert.equal(p.ttlHours, 2)
  assert.equal(p.evidenceDir, '/tmp/ev')
  assert.equal(p.sandboxCpu, 4)
  assert.equal(p.sandboxMemory, '8GB')
  assert.equal(p.tokenPath, '/tmp/tok')
  assert.equal(p.repoDir, '/tmp/repo')
  assert.equal(p.allowUnfitPlan, true)
  // The cap is DELETED, not defaulted away (#400). `--cap-tokens` is refused
  // loudly rather than ignored: an operator who still passes it must find out,
  // and a flag that parses into nothing is how a deleted subsystem comes back.
  assert.throws(() => parseArgs(['p.md', 'run-43', '--cap-tokens', '250000']), /unknown flag --cap-tokens/)
}

// --- reapDecision (#400): the guard between a reaper and someone's live VM ---
{
  const entryVmName = 'fleet-run-24'

  // Our own sandbox, before and after provisioning: teardown owns it.
  assert.equal(reapDecision({ target: undefined, vmName: null, entryVmName }).action, 'own')
  assert.equal(reapDecision({ target: 'fleet-run-24', vmName: 'fleet-run-24', entryVmName }).action, 'own')

  // THE RACE. The startup sweep runs before provisioning, so `vmName` is still
  // null; on a re-drive of a runId whose old claim is stale, reaping here would
  // fire an unawaited `rm fleet-run-24` ~200ms before the drive `cp`s a fresh
  // VM into that exact name — and the rm can land after the cp, destroying the
  // sandbox we just made. `entryVmName` exists so this check works during that
  // window.
  const race = reapDecision({ target: 'fleet-run-24', vmName: null, entryVmName })
  assert.equal(race.action, 'refuse', 'must never reap the VM name this drive owns, even before it exists')
  assert.match(race.reason, /this drive owns that VM name/)

  // A holder read out of the synced CRDT is sandbox-authored and reaches
  // `ssh exe.dev "rm ${...}"`. Validate before the shell, never after.
  for (const hostile of ['fleet-x; rm -rf /', 'fleet-$(whoami)', '../../etc', '-rf', '', 'a'.repeat(65), null, 42]) {
    const d = reapDecision({ target: hostile, vmName: 'fleet-run-24', entryVmName })
    assert.equal(d.action, 'refuse', `must refuse ${JSON.stringify(hostile)}`)
    assert.match(d.reason, /isSafeVmName/)
  }

  // A genuine foreign leftover is reaped.
  assert.equal(reapDecision({ target: 'fleet-run-19', vmName: 'fleet-run-24', entryVmName }).action, 'reap')
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

// (--engine died at 0.3.0: one engine, no flag — a flag with one legal value
// is prose pretending to be an option.)


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
  assert.equal(o.ttlMs, 4 * 60 * 60 * 1000)
  assert.equal(o.heartbeatTimeoutMs, 30 * 60_000)
  assert.equal(o.claimTimeoutMs, 10 * 60_000)
  assert.equal(o.allowUnfitPlan, false)
  // #466: drive-one now ALWAYS supplies evidenceDir, so drive.mjs never falls
  // back to `${dbDir}-evidence`. That fallback is what put the corpus in /tmp.
  assert.equal(o.evidenceDir, '/home/exedev/fleet-evidence')
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

// --- shellExec (#362-1) ----------------------------------------------------
// The production exec seam keeps stdout PURE. drive.mjs's #337 preflight
// compares the working-tree plan byte-for-byte against `git show`'s stdout,
// so stderr chatter folded into stdout read a clean committed plan as dirty
// and hard-refused the drive (run-20 critic). stderr travels separately and
// is only ever appended to diagnostic lines.
{
  assert.deepEqual(await shellExec('printf out; printf err 1>&2'), { code: 0, stdout: 'out', stderr: 'err' })
  assert.deepEqual(await shellExec('exit 7'), { code: 7, stdout: '', stderr: '' })
  const missing = await shellExec('fleet-no-such-binary-362')
  assert.notEqual(missing.code, 0)
  assert.equal(missing.stdout, '', 'a failure leaves stdout empty — the diagnostic is on stderr')
  assert.ok(missing.stderr.length > 0, 'the shell names the missing binary on stderr')
  ok('shellExec keeps stdout pure and carries stderr separately (#362-1)')
}

console.log(`\nALL TESTS PASSED (${passed})`)
