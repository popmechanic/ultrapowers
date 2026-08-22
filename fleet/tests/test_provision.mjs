import assert from 'node:assert/strict'
import { provisionRun, destroySandbox } from '../provision.mjs'
import { hashToken } from '../tokens.mjs'

// provisionRun: recording exec stub. The SSH-probe leg fails once (code 1)
// then succeeds (code 0) to prove the retry loop; every other command
// succeeds immediately. Six logical steps, but the failed probe attempt
// means seven total exec calls (clone, probe-fail, probe-ok, delivery,
// push, shim-start = wait, that's 6 — count them below).
{
  const cmds = []
  let probeCalls = 0
  const exec = async (cmd) => {
    cmds.push(cmd)
    if (cmd.startsWith('ssh -o BatchMode=yes') && cmd.endsWith(' true')) {
      probeCalls++
      if (probeCalls === 1) return { code: 1, stdout: '' }
      return { code: 0, stdout: '' }
    }
    return { code: 0, stdout: '{}' }
  }

  const result = await provisionRun({
    golden: 'fleet-golden',
    runId: 'r1',
    baseRef: 'refs/heads/main',
    repoDir: '/tmp/repo',
    ttlMs: 60000,
    wsUrl: 'ws://127.0.0.1:8151/fleet',
    port: 8151,
    planPath: 'docs/superpowers/plans/2026-08-21-width-w1.md',
    exec,
    clock: () => 1000,
  })

  assert.equal(result.vmName, 'fleet-r1')
  assert.match(result.token, /^[0-9a-f]{64}$/)
  assert.equal(result.record.sandboxId, 'fleet-r1')
  assert.ok(!('token' in result.record), 'returned record carries only the hash, never the raw token')
  assert.equal(result.record.tokenHash, hashToken(result.token))
  assert.equal(result.record.expiresAt, 1000 + 60000)

  // Exec call count: clone(1) + probe-fail(1) + probe-ok(1) + delivery(1) + push(1) + tunnel(1) + shim-start(1) = 7.
  assert.equal(cmds.length, 7, `expected 7 exec calls, got ${cmds.length}: ${JSON.stringify(cmds)}`)

  // Step 1: clone the golden VM.
  assert.ok(
    cmds[0].startsWith('ssh exe.dev "cp fleet-golden fleet-r1 --json"'),
    `cmds[0] should be the golden-clone command, got: ${cmds[0]}`
  )

  // Step 2: wait-for-ssh probe, retried until it succeeds — the identical
  // command re-issued on retry (proving the retry loop, not a different path).
  assert.ok(cmds[1].startsWith('ssh -o BatchMode=yes'), `cmds[1] should be the ssh probe, got: ${cmds[1]}`)
  assert.ok(cmds[1].includes('fleet-r1.exe.xyz true'))
  assert.equal(cmds[2], cmds[1], 'retry re-issues the identical probe command')

  // Step 3: token mint issues no command — already proven by the exec call
  // count above (no seventh call between the probe and the delivery).

  // Step 4: token + assignment delivery, JSON embedded as a heredoc payload.
  assert.ok(
    cmds[3].startsWith("ssh fleet-r1.exe.xyz 'umask 077 && cat > /home/exedev/fleet-run.json'"),
    `cmds[3] should be the delivery command, got: ${cmds[3]}`
  )
  const payloadMatch = cmds[3].match(/<<'FLEET_EOF'\n([\s\S]*?)\nFLEET_EOF/)
  assert.ok(payloadMatch, 'delivery command must embed a FLEET_EOF heredoc payload')
  const payload = JSON.parse(payloadMatch[1])
  assert.equal(payload.runId, 'r1')
  assert.equal(payload.token, result.token, 'the raw token is delivered to the sandbox')
  assert.equal(payload.wsUrl, 'ws://127.0.0.1:8151/fleet')
  assert.equal(payload.ttlMs, 60000)
  assert.equal(payload.planPath, 'docs/superpowers/plans/2026-08-21-width-w1.md', 'the plan path is delivered to the sandbox')

  // Step 5: base push.
  assert.ok(
    cmds[4].startsWith(
      'git -C /tmp/repo push ssh://exedev@fleet-r1.exe.xyz/home/exedev/repo refs/heads/main:refs/heads/fleet-base'
    ),
    `cmds[4] should be the base push, got: ${cmds[4]}`
  )

  // Step 6: the SSH reverse tunnel (#196). exe.dev VMs share no private
  // network, so the sandbox reaches the orchestrator's ws port only through a
  // reverse tunnel mapping sandbox:127.0.0.1:<port> back to the orchestrator's
  // 127.0.0.1:<port> — which is what keeps `wsUrl` true on both ends. It is
  // opened AFTER the reachability probe has passed and BEFORE the shim starts.
  assert.equal(
    cmds[5],
    'ssh -o BatchMode=yes -o ExitOnForwardFailure=yes -fN -R 8151:127.0.0.1:8151 fleet-r1.exe.xyz',
    `cmds[5] should be the reverse tunnel, got: ${cmds[5]}`
  )

  // Step 7: shim start — last, after the tunnel exists to carry its ws.
  assert.ok(
    cmds[6].startsWith("ssh fleet-r1.exe.xyz 'nohup node /home/exedev/repo/fleet/shim-main.mjs"),
    `cmds[6] should be the shim start, got: ${cmds[6]}`
  )
}

// provisionRun: a tunnel that fails to open is surfaced, not swallowed — a run
// whose tunnel never came up would otherwise hang at `claimed` forever. The
// shim is NOT started on top of a dead tunnel.
{
  const cmds = []
  const exec = async (cmd) => {
    cmds.push(cmd)
    if (cmd.includes(' -fN -R ')) return { code: 255, stdout: 'remote port forwarding failed' }
    return { code: 0, stdout: '{}' }
  }
  await assert.rejects(
    provisionRun({
      golden: 'fleet-golden',
      runId: 'r2',
      baseRef: 'refs/heads/main',
      repoDir: '/tmp/repo',
      ttlMs: 60000,
      wsUrl: 'ws://127.0.0.1:8152/fleet',
      port: 8152,
      planPath: 'docs/plan.md',
      exec,
      clock: () => 1000,
    }),
    /tunnel/,
    'a failed tunnel open must reject with an error naming the tunnel'
  )
  assert.ok(
    !cmds.some((cmd) => cmd.includes('shim-main.mjs')),
    `the shim must not be started over a dead tunnel, got: ${JSON.stringify(cmds)}`
  )
}

// destroySandbox: the VM is removed FIRST (the billing clock is what teardown
// protects), then the detached `-fN -R` tunnel process left on the orchestrator
// is killed (#196). The pkill pattern is exact enough to match only the tunnel
// — and it must not be able to match the shell that carries it: a bare
// `pkill -f "-R <port>:…"` matches its own `sh -c` argv and kills the caller
// (it did, in the live run). `[-]R` matches `-R` in the tunnel's argv but not
// the literal `[-]R` in its own.
{
  const cmds = []
  const exec = async (cmd) => {
    cmds.push(cmd)
    return { code: 0, stdout: '' }
  }
  await destroySandbox({ vmName: 'fleet-r1', port: 8151, exec })
  assert.equal(cmds.length, 2, `expected rm + tunnel-kill, got: ${JSON.stringify(cmds)}`)
  assert.equal(cmds[0], 'ssh exe.dev "rm fleet-r1 --json"')
  assert.ok(cmds[1].startsWith('pkill -f '), `cmds[1] should be the tunnel kill, got: ${cmds[1]}`)
  assert.ok(cmds[1].includes('[-]R 8151:127.0.0.1:8151 fleet-r1.exe.xyz'), `tunnel-kill pattern must name port and vm: ${cmds[1]}`)
  assert.ok(!/ -R 8151/.test(cmds[1]), `tunnel-kill pattern must not be matchable by its own argv: ${cmds[1]}`)
  // The pattern really does match the tunnel's argv and really does not match
  // the kill command's own argv.
  const pattern = cmds[1].match(/pkill -f '([^']+)'/)[1]
  const re = new RegExp(pattern)
  assert.ok(re.test('ssh -o BatchMode=yes -o ExitOnForwardFailure=yes -fN -R 8151:127.0.0.1:8151 fleet-r1.exe.xyz'))
  assert.ok(!re.test(`/bin/sh -c ${cmds[1]}`))
}

// destroySandbox without a port (no tunnel was opened): rm only.
{
  const cmds = []
  const exec = async (cmd) => {
    cmds.push(cmd)
    return { code: 0, stdout: '' }
  }
  await destroySandbox({ vmName: 'fleet-r1', exec })
  assert.deepEqual(cmds, ['ssh exe.dev "rm fleet-r1 --json"'])
}

console.log('ALL TESTS PASSED')
