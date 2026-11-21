import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { usage, main, USAGE_URL } from '../claude-token.mjs'

const NOW_ISO = '2026-09-21T12:00:00.000Z'
const NOW_MS = Date.parse(NOW_ISO)
const HOUR = 60 * 60 * 1000

const USAGE_BODY = {
  five_hour: { utilization: 12, resets_at: '2026-09-21T18:00:00.000Z' },
  seven_day: { utilization: 34, resets_at: '2026-09-28T12:00:00.000Z' }
}

function makeDeps (records) {
  const fetchCalls = []
  const keychainWrites = []
  const lobbyCalls = []
  const stdoutLines = []
  const logLines = []

  const fetch = async (url, opts) => {
    fetchCalls.push({ url, opts })
    return { ok: true, status: 200, json: async () => USAGE_BODY }
  }

  const lobby = (verb, input) => {
    lobbyCalls.push({ verb, input })
    if (verb.startsWith('integrations edit') || verb.startsWith('integrations add') || verb === "ls 'fleet-r*' --json" || verb === 'integrations list --json') {
      return { code: 0, out: '' }
    }
    throw new Error(`test_claude_token_usage: unexpected lobby verb ${JSON.stringify(verb)}`)
  }

  return {
    now: () => NOW_MS,
    keychainRead: (name) => (Object.prototype.hasOwnProperty.call(records, name) && records[name] ? JSON.stringify(records[name]) : null),
    keychainWrite: (name, value) => { keychainWrites.push({ name, value }); return true },
    keychainList: () => Object.keys(records),
    lobby,
    fetch,
    log: (line) => logLines.push(line),
    stdout: (text) => stdoutLines.push(text),
    fetchCalls,
    keychainWrites,
    lobbyCalls,
    stdoutLines,
    logLines
  }
}

const editVerbs = (lobbyCalls) => lobbyCalls.filter((c) => c.verb.startsWith('integrations edit') || c.verb.startsWith('integrations add'))

{
  const record = { refreshToken: 'r1', accessToken: 'a-fresh', expiresAt: NOW_MS + 2 * HOUR }
  const deps = makeDeps({ acct: record })

  const rows = await usage(deps, { account: 'acct', rotate: false })

  assert.deepEqual(
    rows,
    [{
      name: 'acct',
      fiveHour: { utilization: 12, resetsAt: '2026-09-21T18:00:00.000Z' },
      sevenDay: { utilization: 34, resetsAt: '2026-09-28T12:00:00.000Z' },
      unread: false,
      reason: null
    }],
    `(a) [M1] the resolved row matches the Machine shape exactly. Got: ${JSON.stringify(rows)}`
  )

  assert.equal(deps.fetchCalls.length, 1,
    `(a) [M1] exactly one deps.fetch call is made. Got ${deps.fetchCalls.length}`)
  assert.equal(deps.fetchCalls[0].url, USAGE_URL,
    `(a) [M1] the fetch is of USAGE_URL. Got: ${JSON.stringify(deps.fetchCalls[0].url)}`)
  assert.equal(deps.fetchCalls[0].opts?.headers?.Authorization, 'Bearer a-fresh',
    `(a) [M1] the Authorization header bears the record's accessToken. Got: ${JSON.stringify(deps.fetchCalls[0].opts?.headers)}`)

  assert.equal(deps.keychainWrites.length, 0,
    `(a) [M1] zero deps.keychainWrite calls are made. Got ${deps.keychainWrites.length}`)
  assert.equal(editVerbs(deps.lobbyCalls).length, 0,
    `(a) [M1] zero integrations edit/add lobby verbs are issued. Got: ${JSON.stringify(deps.lobbyCalls.map((c) => c.verb))}`)
}

{
  const record = { refreshToken: 'r1', accessToken: 'a-old', expiresAt: NOW_MS - HOUR }
  const deps = makeDeps({ acct: record })

  const rows = await usage(deps, { account: 'acct', rotate: false })

  assert.equal(rows.length, 1,
    `(b) [M2] exactly one row is resolved. Got ${rows.length}`)
  assert.equal(rows[0].name, 'acct',
    `(b) [M2] the row names the account. Got: ${JSON.stringify(rows[0])}`)
  assert.equal(rows[0].unread, true,
    `(b) [M2] the row's unread is strictly true. Got: ${JSON.stringify(rows[0])}`)
  assert.ok(typeof rows[0].reason === 'string' && rows[0].reason.startsWith('access token expired'),
    `(b) [M2] the row's reason begins "access token expired". Got: ${JSON.stringify(rows[0].reason)}`)

  assert.equal(deps.fetchCalls.length, 0,
    `(b) [M2] zero deps.fetch calls are made. Got ${deps.fetchCalls.length}`)
  assert.equal(deps.keychainWrites.length, 0,
    `(b) [M2] zero deps.keychainWrite calls are made. Got ${deps.keychainWrites.length}`)
}

{
  const record = { refreshToken: 'r1', accessToken: 'a-fresh', expiresAt: NOW_MS + 2 * HOUR }
  const deps = makeDeps({ acct: record })

  await main(['usage', '--json', '--account', 'acct', '--no-rotate'], deps)

  assert.equal(deps.stdoutLines.length, 1,
    `(c) [M3] exactly one line is written to deps.stdout. Got ${deps.stdoutLines.length}: ${JSON.stringify(deps.stdoutLines)}`)
  const parsed = JSON.parse(deps.stdoutLines[0])
  assert.ok(Array.isArray(parsed) && parsed.length === 1,
    `(c) [M3] the line parses as a JSON array of length 1. Got: ${deps.stdoutLines[0]}`)
  assert.equal(parsed[0].name, 'acct',
    `(c) [M3] the one row's name is "acct". Got: ${JSON.stringify(parsed[0])}`)
}

{
  const record1 = { refreshToken: 'r1', accessToken: 'a-fresh-1', expiresAt: NOW_MS + 2 * HOUR }
  const record2 = { refreshToken: 'r2', accessToken: 'a-fresh-2', expiresAt: NOW_MS + 2 * HOUR }
  const deps = makeDeps({ acct1: record1, acct2: record2 })

  await main(['usage', '--json'], deps)

  assert.equal(deps.stdoutLines.length, 1,
    `(d) [M3] exactly one line is written to deps.stdout. Got ${deps.stdoutLines.length}: ${JSON.stringify(deps.stdoutLines)}`)
  const parsed = JSON.parse(deps.stdoutLines[0])
  assert.ok(Array.isArray(parsed) && parsed.length === 2,
    `(d) [M3] the line parses as a JSON array of length 2, one row per listed account. Got: ${deps.stdoutLines[0]}`)
}

{
  const here = path.dirname(fileURLToPath(import.meta.url))
  const src = fs.readFileSync(path.join(here, '..', 'claude-token.mjs'), 'utf8')
  assert.ok(src.includes('usage [--json] [--account <name>] [--no-rotate]'),
    '(e) [M4] the source text carries the exact usage line `usage [--json] [--account <name>] [--no-rotate]`')
}

console.log('ALL TESTS PASSED')
