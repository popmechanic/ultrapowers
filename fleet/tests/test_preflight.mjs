import assert from 'node:assert/strict'
import { preflight } from '../preflight.mjs'

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
  assert.equal(result.verdict, 'ssh', 'verdict should be ssh when sshFetch succeeds')
  assert.equal(result.sshFetch, true, 'sshFetch should be true when code 0')
  assert.equal(result.httpsFallback, false, 'httpsFallback not attempted when ssh succeeds')
  // Verify first command was issued
  assert.equal(executed.length, 1, 'should issue exactly one command')
  assert.match(executed[0], /ssh orch1\.exe\.xyz/, 'first command should target orch1')
  assert.match(executed[0], /git.*fetch.*ssh:\/\/exedev@probe1\.exe\.xyz/, 'first command should attempt SSH fetch from probe1')
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
  assert.equal(result.verdict, 'https-fallback', 'verdict should be https-fallback when ssh fails but https works')
  assert.equal(result.sshFetch, false, 'sshFetch should be false when code 1')
  assert.equal(result.httpsFallback, true, 'httpsFallback should be true when code 0')
  // Verify both commands were issued
  assert.equal(executed.length, 2, 'should issue two commands')
  assert.match(executed[0], /ssh orch2\.exe\.xyz/, 'first command should target orch2')
  assert.match(executed[0], /git.*fetch.*ssh:\/\/exedev@probe2\.exe\.xyz/, 'first command should attempt SSH fetch from probe2')
  assert.match(executed[1], /ssh orch2\.exe\.xyz/, 'second command should target orch2')
  assert.match(executed[1], /git ls-remote https:\/\/probe2\.exe\.xyz/, 'second command should attempt HTTPS ls-remote')
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
  assert.equal(result.verdict, 'BLOCKED', 'verdict should be BLOCKED when both attempts fail')
  assert.equal(result.sshFetch, false, 'sshFetch should be false')
  assert.equal(result.httpsFallback, false, 'httpsFallback should be false')
  // Verify both commands were issued
  assert.equal(executed.length, 2, 'should issue two commands')
}

console.log('ALL TESTS PASSED')
