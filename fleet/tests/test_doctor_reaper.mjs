/**
 * fleet/tests/test_doctor_reaper.mjs — the doctor's eleventh row, `reaper`: the exe.dev key the
 * hub removes a finished run's VM with has not expired (the key expired 2026-10-30 and nothing
 * said so; on 2026-11-13 the hub answered eight finished VMs and removed none).
 *
 * Every leg drives `doctor()` through a stub `exec`, with `now` fixed at 2026-11-13T00:00:00Z:
 *   (a) no `lobby-rm` integration: ok, the detail saying a finished VM waits for the janitor;
 *       `ssh-key list --json` is still read once.
 *   (b) `lobby-rm` present, the `hub-reaper` key expired 2026-10-30: missing, the detail naming
 *       the key and the day, and the verdict `not-ready`.
 *   (c) the key good until 2027-11-01: ok, the detail naming the day and `353 days`.
 *   (d) the key good until 2026-11-20: ok, the detail ending `renew it soon`.
 *   (e) two keys, one expired and a `hub-reaper-2` that is not: ok on the one that lasts longest.
 *   (f) no key named `hub-reaper…`: missing. (g) a key with no expiry: ok, `does not expire`.
 *   (h) `ssh-key list --json` answers code 1: missing, the detail naming the code.
 */
import assert from 'node:assert/strict'

import { doctor } from '../doctor.mjs'

const keyOf = (cmd, argv = []) => [cmd, ...argv].join(' ')
const lobbyKey = (remote) => keyOf('ssh', ['exe.dev', remote])
const NOW = Date.parse('2026-11-13T00:00:00Z')
const LOBBY_RM = { name: 'lobby-rm', config_summary: 'target=https://exe.dev/ header=Authorization:Bearer ***' }

function makeExec ({ integrations, keys }) {
  const calls = []
  const exec = async (command, argv) => {
    const cmd = keyOf(command, argv)
    calls.push(cmd)
    if (cmd === lobbyKey('integrations list --json')) return { code: 0, stdout: JSON.stringify(integrations) }
    if (cmd === lobbyKey('ssh-key list --json')) return keys
    return { code: 1, stdout: '' }
  }
  exec.calls = calls
  return exec
}
const keysOf = (...rows) => ({ code: 0, stdout: JSON.stringify({ ssh_keys: rows }) })
const key = (name, expires_at) => ({ name, added_at: '2026-09-30T18:55:40Z', ...(expires_at ? { expires_at } : {}) })
const reaperOf = async (opts) => {
  const exec = makeExec(opts)
  const result = await doctor({ config: {}, exec, configKeys: null, account: null, now: NOW })
  return { row: result.rows.find((r) => r.id === 'reaper'), result, exec }
}

{ // (a)
  const { row, exec } = await reaperOf({ integrations: [], keys: keysOf() })
  assert.ok(row && row.status === 'ok' && row.detail.includes('waits for the janitor'), `(a) absent lobby-rm is ok — got ${JSON.stringify(row)}`)
  assert.equal(exec.calls.filter((c) => c === lobbyKey('ssh-key list --json')).length, 1, '(a) the keys are read once')
  assert.equal(row.fix, 'reaper', '(a) the row\'s fix is its own first-run heading')
}
{ // (b)
  const { row, result } = await reaperOf({ integrations: [LOBBY_RM], keys: keysOf(key('laptop-read'), key('hub-reaper', '2026-10-30T18:55:40Z')) })
  assert.ok(row.status === 'missing' && row.detail.includes('hub-reaper expired 2026-10-30'), `(b) an expired key is missing and named — got ${JSON.stringify(row)}`)
  assert.equal(result.verdict, 'not-ready', '(b) the verdict is not-ready')
}
{ // (c)
  const { row } = await reaperOf({ integrations: [LOBBY_RM], keys: keysOf(key('hub-reaper', '2027-11-01T00:00:00Z')) })
  assert.ok(row.status === 'ok' && row.detail === 'the key hub-reaper is good until 2027-11-01 (353 days)', `(c) a live key is ok with its days — got ${JSON.stringify(row)}`)
}
{ // (d)
  const { row } = await reaperOf({ integrations: [LOBBY_RM], keys: keysOf(key('hub-reaper', '2026-11-20T00:00:00Z')) })
  assert.ok(row.status === 'ok' && row.detail.endsWith('(7 days) — renew it soon'), `(d) a key near its end says so — got ${JSON.stringify(row)}`)
}
{ // (e)
  const { row } = await reaperOf({ integrations: [LOBBY_RM], keys: keysOf(key('hub-reaper', '2026-10-30T18:55:40Z'), key('hub-reaper-2', '2027-01-01T00:00:00Z')) })
  assert.ok(row.status === 'ok' && row.detail.startsWith('the key hub-reaper-2 is good until 2027-01-01'), `(e) the key that lasts longest is the one read — got ${JSON.stringify(row)}`)
}
{ // (f), (g), (h)
  const none = await reaperOf({ integrations: [LOBBY_RM], keys: keysOf(key('laptop-read')) })
  assert.ok(none.row.status === 'missing' && none.row.detail.includes('no exe.dev key named hub-reaper'), `(f) no such key is missing — got ${JSON.stringify(none.row)}`)
  const forever = await reaperOf({ integrations: [LOBBY_RM], keys: keysOf(key('hub-reaper')) })
  assert.ok(forever.row.status === 'ok' && forever.row.detail === 'the key hub-reaper does not expire', `(g) a key with no expiry is ok — got ${JSON.stringify(forever.row)}`)
  const unread = await reaperOf({ integrations: [LOBBY_RM], keys: { code: 1, stdout: '' } })
  assert.ok(unread.row.status === 'missing' && unread.row.detail.includes('answered code 1'), `(h) an unread list is missing — got ${JSON.stringify(unread.row)}`)
}

console.log('ALL TESTS PASSED')
