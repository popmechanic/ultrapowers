import assert from 'node:assert/strict'
import { preflight } from '../preflight.mjs'

// Exact expected command strings. Full-value equality — every byte of the
// assembled command is asserted, including `-C /home/exedev/repo`, the trailing
// remote path, and the single-quote wrapping that makes the git invocation run
// on the orchestrator VM. Command assembly is the entire deliverable here, so
// nothing about it may be silently deletable.
const sshFetchCmd = (orchVm, probeVm) =>
  `ssh ${orchVm}.exe.xyz 'git -C /home/exedev/repo fetch ssh://exedev@${probeVm}.exe.xyz/home/exedev/repo'`
const httpsLsRemoteCmd = (orchVm, probeVm) =>
  `ssh ${orchVm}.exe.xyz 'git ls-remote https://${probeVm}.exe.xyz/repo.git'`

// Test 1: SSH fetch succeeds (code 0) → verdict='ssh'
{
  const executed = []
  const exec = async (cmd) => {
    executed.push(cmd)
    return { code: 0, stdout: 'ok' }
  }
  const result = await preflight({
    orchVm: 'orch1',
    probeVm: 'probe1',
    exec
  })
  assert.deepEqual(
    result,
    { sshFetch: true, httpsFallback: false, verdict: 'ssh' },
    'ssh success should yield sshFetch=true, httpsFallback=false, verdict=ssh'
  )
  // Exact command sequence — the SSH leg and nothing else.
  assert.deepEqual(
    executed,
    ["ssh orch1.exe.xyz 'git -C /home/exedev/repo fetch ssh://exedev@probe1.exe.xyz/home/exedev/repo'"],
    'ssh success should issue exactly the SSH fetch command and no fallback'
  )
  assert.equal(executed[0], sshFetchCmd('orch1', 'probe1'), 'SSH fetch command must match the interpolated form')
}

// Test 2: SSH fetch fails (code 1), HTTPS fallback succeeds (code 0) → verdict='https-fallback'
{
  const executed = []
  const exec = async (cmd) => {
    executed.push(cmd)
    if (executed.length === 1) {
      return { code: 1, stdout: 'failed' }
    }
    return { code: 0, stdout: 'ok' }
  }
  const result = await preflight({
    orchVm: 'orch2',
    probeVm: 'probe2',
    exec
  })
  assert.deepEqual(
    result,
    { sshFetch: false, httpsFallback: true, verdict: 'https-fallback' },
    'ssh failure + https success should yield verdict=https-fallback'
  )
  // Exact command sequence — SSH leg then HTTPS fallback leg, in order.
  assert.deepEqual(
    executed,
    [
      "ssh orch2.exe.xyz 'git -C /home/exedev/repo fetch ssh://exedev@probe2.exe.xyz/home/exedev/repo'",
      "ssh orch2.exe.xyz 'git ls-remote https://probe2.exe.xyz/repo.git'"
    ],
    'ssh failure should issue exactly the SSH fetch then the HTTPS ls-remote command'
  )
  assert.equal(executed[0], sshFetchCmd('orch2', 'probe2'), 'SSH fetch command must match the interpolated form')
  assert.equal(executed[1], httpsLsRemoteCmd('orch2', 'probe2'), 'HTTPS ls-remote command must match the interpolated form')
}

// Test 3: Both fail (code 1, code 1) → verdict='BLOCKED'
{
  const executed = []
  const exec = async (cmd) => {
    executed.push(cmd)
    return { code: 1, stdout: 'failed' }
  }
  const result = await preflight({
    orchVm: 'orch3',
    probeVm: 'probe3',
    exec
  })
  assert.deepEqual(
    result,
    { sshFetch: false, httpsFallback: false, verdict: 'BLOCKED' },
    'both legs failing should yield verdict=BLOCKED'
  )
  // Exact command sequence — both legs attempted, in order.
  assert.deepEqual(
    executed,
    [
      "ssh orch3.exe.xyz 'git -C /home/exedev/repo fetch ssh://exedev@probe3.exe.xyz/home/exedev/repo'",
      "ssh orch3.exe.xyz 'git ls-remote https://probe3.exe.xyz/repo.git'"
    ],
    'both-fail should issue exactly the SSH fetch then the HTTPS ls-remote command'
  )
}

console.log('ALL TESTS PASSED')
