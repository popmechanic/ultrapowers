import assert from 'node:assert/strict'

import { doctor, ROW_IDS } from '../doctor.mjs'

const keyOf = (cmd, argv = []) => [cmd, ...argv].join(' ')
const lobbyKey = (remote) => keyOf('ssh', ['exe.dev', remote])

const BASE_KNOWN = new Map([
  [lobbyKey('whoami'), { code: 1, stdout: '' }],
  [lobbyKey('billing plan --json'), { code: 1, stdout: '' }],
  [lobbyKey('integrations setup github --list'), { code: 1, stdout: '' }]
])

function makeExec (listStdout) {
  const known = new Map([
    ...BASE_KNOWN,
    [lobbyKey('integrations list --json'), { code: 0, stdout: listStdout }]
  ])
  const calls = []
  const exec = async (command, argv) => {
    const cmd = keyOf(command, argv)
    calls.push(cmd)
    if (known.has(cmd)) return known.get(cmd)
    return { code: 1, stdout: '' }
  }
  exec.calls = calls
  return exec
}

const cloudflareRowOf = (result) => result.rows.find((r) => r.id === 'cloudflare')

{
  const want = ['exe-dev', 'capacity', 'claude', 'accounts', 'github', 'integrations', 'evidence', 'verb-drift', 'cloudflare']
  assert.deepEqual(
    [...ROW_IDS], want,
    `(a) [M1] ROW_IDS is exactly the nine pinned ids in order — got: ${JSON.stringify([...ROW_IDS])}`
  )

  const exec = makeExec(JSON.stringify([]))
  const result = await doctor({ config: {}, exec, configKeys: null, account: null })
  assert.equal(result.rows.length, 9, `(a) [M1] doctor() answers nine rows — got ${result.rows.length}`)
  assert.deepEqual(
    result.rows.map((r) => r.id), want,
    `(a) [M1] doctor()'s rows are in ROW_IDS order — got: ${JSON.stringify(result.rows.map((r) => r.id))}`
  )
}

{
  const exec = makeExec(JSON.stringify([{ name: 'claude-max', config_summary: 'Authorization:Bearer xyz' }]))
  const result = await doctor({ config: {}, exec, configKeys: null, account: null })
  const cloudflare = cloudflareRowOf(result)
  assert.ok(cloudflare, '(b) [M2] the result carries a cloudflare row')
  assert.equal(cloudflare.status, 'ok', `(b) [M2] absent is ok — got: ${JSON.stringify(cloudflare)}`)
  assert.ok(
    cloudflare.detail.includes('absent'),
    `(b) [M2] detail names "absent" — got: ${JSON.stringify(cloudflare.detail)}`
  )
  assert.ok(
    cloudflare.detail.includes('Publish:'),
    `(b) [M2] detail names "Publish:" — got: ${JSON.stringify(cloudflare.detail)}`
  )
}

{
  const listStdout = JSON.stringify([
    { name: 'claude-max', config_summary: 'Authorization:Bearer xyz' },
    { name: 'cloudflare', config_summary: 'Authorization:Bearer cf', attachments: ['tag:fleet'] }
  ])
  const result = await doctor({ config: {}, exec: makeExec(listStdout), configKeys: null, account: null })
  const cloudflare = cloudflareRowOf(result)
  assert.equal(cloudflare.status, 'ok', `(c) [M2] present on tag:fleet is ok — got: ${JSON.stringify(cloudflare)}`)
}

{
  const listStdout = JSON.stringify([
    { name: 'claude-max', config_summary: 'Authorization:Bearer xyz' },
    { name: 'cloudflare', config_summary: 'Authorization:Bearer cf', attachments: ['vm:one'] }
  ])
  const result = await doctor({ config: {}, exec: makeExec(listStdout), configKeys: null, account: null })
  const cloudflare = cloudflareRowOf(result)
  assert.equal(cloudflare.status, 'missing', `(d) [M2] present off tag:fleet is missing — got: ${JSON.stringify(cloudflare)}`)
  assert.ok(
    cloudflare.detail.includes('integrations attach cloudflare tag:fleet'),
    `(d) [M2] detail names the attach — got: ${JSON.stringify(cloudflare.detail)}`
  )
}

console.log('ALL TESTS PASSED')
