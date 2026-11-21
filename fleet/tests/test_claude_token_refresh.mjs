import assert from 'node:assert/strict'

import { refresh, usage } from '../claude-token.mjs'

const NOW_ISO = '2026-09-21T12:00:00.000Z'
const NOW_MS = Date.parse(NOW_ISO)
const HOUR = 60 * 60 * 1000
const MIN = 60 * 1000

const INTEGRATIONS_LIST_OK = { code: 0, out: JSON.stringify([{ name: 'claude-max' }]) }

function makeDeps ({ record, vmNames = [], lsResult = null }) {
  const lobbyCalls = []
  const fetchCalls = []
  const keychainWrites = []
  const logLines = []

  const lsAnswer = lsResult ?? { code: 0, out: JSON.stringify({ vms: vmNames.map((vm_name) => ({ vm_name, status: 'running' })) }) }

  const lobby = (verb, input) => {
    lobbyCalls.push({ verb, input })
    if (verb === "ls 'fleet-r*' --json") return lsAnswer
    if (verb === 'integrations list --json') return INTEGRATIONS_LIST_OK
    if (verb.startsWith('integrations edit') || verb.startsWith('integrations add')) return { code: 0, out: '' }
    throw new Error(`test_claude_token_refresh: unexpected lobby verb ${JSON.stringify(verb)}`)
  }

  const fetch = async (url, opts) => {
    fetchCalls.push({ url, opts })
    return { ok: true, json: async () => ({ access_token: 'a2', refresh_token: 'r2', expires_in: 28800 }) }
  }

  const deps = {
    now: () => NOW_MS,
    keychainRead: (name) => (name === 'acct' ? JSON.stringify(record) : null),
    keychainWrite: (name, value) => { keychainWrites.push({ name, value }); return true },
    keychainList: () => ['acct'],
    lobby,
    fetch,
    log: (line) => logLines.push(line)
  }

  return { deps, lobbyCalls, fetchCalls, keychainWrites, logLines }
}

const editVerbs = (lobbyCalls) => lobbyCalls.filter((c) => c.verb.startsWith('integrations edit') || c.verb.startsWith('integrations add'))

let legA
{
  const record = { refreshToken: 'r1', accessToken: 'a1', expiresAt: NOW_MS + 2 * HOUR }
  const rig = makeDeps({ record, vmNames: ['fleet-r1-2609211200-ab12'] })
  const result = await refresh(rig.deps, { account: 'acct' })
  legA = rig

  assert.equal(rig.fetchCalls.length, 0,
    `(a) [M1] a held rotation makes zero token-endpoint requests. Got ${rig.fetchCalls.length}`)
  assert.equal(rig.keychainWrites.length, 0,
    `(a) [M1] a held rotation makes zero keychain writes. Got ${rig.keychainWrites.length}`)

  const edit = editVerbs(rig.lobbyCalls)
  assert.equal(edit.length, 1,
    `(a) [M1] exactly one integrations edit/add verb is issued. Got: ${JSON.stringify(rig.lobbyCalls.map((c) => c.verb))}`)
  assert.ok(edit[0].verb.startsWith('integrations edit claude-max --bearer -'),
    `(a) [M1] the verb begins \`integrations edit claude-max --bearer -\`. Got: ${JSON.stringify(edit[0].verb)}`)
  assert.equal(edit[0].input, 'a1',
    `(a) [M1] the verb's stdin is the cached access token \`a1\`. Got: ${JSON.stringify(edit[0].input)}`)

  assert.ok(rig.logLines.includes('token: fresh until 2026-09-21T14:00:00.000Z; 1 run(s) live — not rotated'),
    `(a) [M1] the hold line is logged exactly. Got lines: ${JSON.stringify(rig.logLines)}`)

  assert.equal(result.refreshed, false,
    `(a) [M1] the call resolves with refreshed strictly false. Got: ${JSON.stringify(result)}`)
}

{
  const record = { refreshToken: 'r1', accessToken: 'a1', expiresAt: NOW_MS + 6 * HOUR }
  const rig = makeDeps({ record, vmNames: ['fleet-r1-2609211200-ab12'] })
  await refresh(rig.deps, { account: 'acct', force: true })

  assert.equal(rig.fetchCalls.length, 0,
    `(b) [M2] \`force: true\` under a listed VM still makes zero token-endpoint requests. Got ${rig.fetchCalls.length}`)
  assert.ok(rig.logLines.includes('token: fresh until 2026-09-21T18:00:00.000Z; 1 run(s) live — not rotated'),
    `(b) [M2] the hold line reflects the six-hour expiry, logged exactly. Got lines: ${JSON.stringify(rig.logLines)}`)
}

{
  const record = { refreshToken: 'r1', accessToken: 'a1', expiresAt: NOW_MS + 60 * MIN }
  const vmNames = ['fleet-r7-2609211100-ab12', 'fleet-r8-2609211130-cd34']
  const rig = makeDeps({ record, vmNames })

  let error = null
  try {
    await refresh(rig.deps, { account: 'acct' })
  } catch (err) {
    error = err
  }

  const expectedMessage = 'token: expires 2026-09-21T13:00:00.000Z; 2 run(s) live ' +
    '(fleet-r7-2609211100-ab12, fleet-r8-2609211130-cd34) — not rotated; under 90 minutes ' +
    'is too short to launch on, so wait for the runs to end or remove their VMs'

  assert.ok(error, '(c) [M3] under 90 minutes with live VMs, refresh() rejects')
  assert.equal(error.message, expectedMessage,
    `(c) [M3] the refusal message is exactly the shared refusal line. Got: ${JSON.stringify(error?.message)}`)
  assert.equal(rig.fetchCalls.length, 0,
    `(c) [M3] the refusal makes zero token-endpoint requests. Got ${rig.fetchCalls.length}`)
  assert.equal(rig.keychainWrites.length, 0,
    `(c) [M3] the refusal makes zero keychain writes. Got ${rig.keychainWrites.length}`)
  assert.equal(editVerbs(rig.lobbyCalls).length, 0,
    `(c) [M3] no \`integrations edit\` or \`integrations add\` verb is issued. Got: ${JSON.stringify(rig.lobbyCalls.map((c) => c.verb))}`)
}

{
  const record = { refreshToken: 'r1', accessToken: 'a1', expiresAt: NOW_MS + 2 * HOUR }
  const rig = makeDeps({ record, vmNames: [] })
  const result = await refresh(rig.deps, { account: 'acct' })

  assert.equal(rig.fetchCalls.length, 1,
    `(d) [M4] no VM listed spends exactly one token-endpoint request. Got ${rig.fetchCalls.length}`)
  assert.equal(rig.keychainWrites.length, 1,
    `(d) [M4] no VM listed writes the keychain exactly once. Got ${rig.keychainWrites.length}`)
  const written = JSON.parse(rig.keychainWrites[0].value)
  assert.equal(written.accessToken, 'a2',
    `(d) [M4] the written record carries the new access token \`a2\`. Got: ${JSON.stringify(written)}`)
  assert.equal(written.refreshToken, 'r2',
    `(d) [M4] the written record carries the new refresh token \`r2\`. Got: ${JSON.stringify(written)}`)

  const edit = editVerbs(rig.lobbyCalls)
  assert.equal(edit.length, 1,
    `(d) [M4] exactly one integrations edit/add verb is issued. Got: ${JSON.stringify(rig.lobbyCalls.map((c) => c.verb))}`)
  assert.ok(edit[0].verb.startsWith('integrations edit claude-max --bearer -'),
    `(d) [M4] the verb begins \`integrations edit claude-max --bearer -\`. Got: ${JSON.stringify(edit[0].verb)}`)
  assert.equal(edit[0].input, 'a2',
    `(d) [M4] the new access token is installed at the edge. Got: ${JSON.stringify(edit[0].input)}`)

  assert.equal(result.refreshed, true,
    `(d) [M4] the call resolves with refreshed strictly true. Got: ${JSON.stringify(result)}`)
}

{
  assert.ok(legA.lobbyCalls.length > 0,
    "(e) [M5] leg (a)'s rotation-eligible call issued at least one lobby verb")
  assert.equal(legA.lobbyCalls[0].verb, "ls 'fleet-r*' --json",
    `(e) [M5] the first lobby verb of a call that would rotate is the fleet listing. Got: ${JSON.stringify(legA.lobbyCalls[0])}`)

  const record = { refreshToken: 'r1', accessToken: 'a1', expiresAt: NOW_MS + 2 * HOUR }
  const rig = makeDeps({ record, lsResult: { code: 1, out: 'boom' } })

  let error = null
  try {
    await refresh(rig.deps, { account: 'acct' })
  } catch (err) {
    error = err
  }

  assert.ok(error, '(e) [M5] a listing that exits non-zero makes refresh() reject')
  assert.equal(rig.fetchCalls.length, 0,
    `(e) [M5] the rejected listing spends zero token-endpoint requests. Got ${rig.fetchCalls.length}`)
}

{
  const record = { refreshToken: 'r1', accessToken: 'a1', expiresAt: NOW_MS - HOUR }
  const rig = makeDeps({ record, vmNames: ['fleet-r1-2609211200-ab12'] })
  const rows = await usage(rig.deps)

  assert.equal(rows.length, 1,
    `(f) [M6] usage() answers one row for the one account. Got ${rows.length}`)
  assert.equal(rows[0].unread, true,
    `(f) [M6] the row's unread is strictly true. Got: ${JSON.stringify(rows[0])}`)
  assert.ok(typeof rows[0].reason === 'string' && rows[0].reason.startsWith('token: expires'),
    `(f) [M6] the row's reason begins \`token: expires\`. Got: ${JSON.stringify(rows[0].reason)}`)
  assert.equal(rig.fetchCalls.length, 0,
    `(f) [M6] the read makes zero token-endpoint requests. Got ${rig.fetchCalls.length}`)
}

console.log('ALL TESTS PASSED')
