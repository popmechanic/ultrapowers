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
    if (cmd.startsWith('ssh -o BatchMode=yes')) {
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
    wsUrl: 'ws://orch.exe.xyz:8151/fleet',
    exec,
    clock: () => 1000,
  })

  assert.equal(result.vmName, 'fleet-r1')
  assert.match(result.token, /^[0-9a-f]{64}$/)
  assert.equal(result.record.sandboxId, 'fleet-r1')
  assert.ok(!('token' in result.record), 'returned record carries only the hash, never the raw token')
  assert.equal(result.record.tokenHash, hashToken(result.token))
  assert.equal(result.record.expiresAt, 1000 + 60000)

  // Exec call count: clone(1) + probe-fail(1) + probe-ok(1) + delivery(1) + push(1) + shim-start(1) = 6.
  assert.equal(cmds.length, 6, `expected 6 exec calls, got ${cmds.length}: ${JSON.stringify(cmds)}`)

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
  assert.equal(payload.wsUrl, 'ws://orch.exe.xyz:8151/fleet')
  assert.equal(payload.ttlMs, 60000)

  // Step 5: base push.
  assert.ok(
    cmds[4].startsWith(
      'git -C /tmp/repo push ssh://exedev@fleet-r1.exe.xyz/home/exedev/repo refs/heads/main:refs/heads/fleet-base'
    ),
    `cmds[4] should be the base push, got: ${cmds[4]}`
  )

  // Step 6: shim start.
  assert.ok(
    cmds[5].startsWith("ssh fleet-r1.exe.xyz 'nohup node /home/exedev/repo/fleet/shim-main.mjs"),
    `cmds[5] should be the shim start, got: ${cmds[5]}`
  )
}

// destroySandbox: single teardown command.
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
