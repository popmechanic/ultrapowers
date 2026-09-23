/**
 * fleet/tests/test_claude_token_usage.mjs — the exam for "The token tool reads
 * one account's window without rotating" (#1114).
 *
 * In-process only: `import { usage, main, USAGE_URL } from '../claude-token.mjs'`,
 * every call handed a fake `deps` — no child process is spawned, so there is no
 * `simEnv()` to route through (`fleet/claude-token.mjs`'s own `main()` is
 * guarded on `process.argv[1] === import.meta.url`, so importing the module
 * runs nothing by itself). `deps.lock` is omitted, matching `refresh`'s own
 * `deps.lock ? deps.lock() : () => {}` fallback — none of these legs reach
 * `refresh` at all, since every record handed in either already carries an
 * unexpired `accessToken` or is read with `rotate: false`.
 *
 * The Machine clauses under test, restated:
 *   M1 — `usage(deps, { account, rotate: false })` over an unexpired record:
 *        one row shaped exactly `{ name, fiveHour, sevenDay, unread: false,
 *        reason: null }`, one fetch of USAGE_URL bearing that record's
 *        `accessToken`, zero keychain writes, zero edit/add lobby verbs.
 *   M2 — the same over an expired record: one row `unread: true`, `reason`
 *        starting `access token expired`, zero fetches, zero keychain writes.
 *   M3 — `main` with `--account --no-rotate` writes one JSON line, an array
 *        of length 1 named for that account; `main` with plain `--json` over
 *        two listed accounts writes an array of length 2.
 *   M4 — `USAGE_LINE`'s text spells the `usage` verb's flags exactly.
 *
 * Legs, each naming the Machine clause it comes from:
 *   (a) [M1] one unexpired record, `account` + `rotate: false`.
 *   (b) [M2] one expired record, `account` + `rotate: false`.
 *   (c) [M3] `main(['usage', '--json', '--account', 'acct', '--no-rotate'])`.
 *   (d) [M3] `main(['usage', '--json'])` over two listed accounts.
 *   (e) [M4] the source text carries the exact `usage` line.
 *
 * What the exam assumes about the code under test: that `usage(deps, opts)`
 * reads the record through `deps.keychainRead`/`deps.keychainList` (the same
 * seams `refresh`/`accounts` use, per `fleet/claude-token.mjs`'s own header),
 * that an unexpired record's window is read straight off `deps.fetch(USAGE_URL,
 * …)` without touching `deps.lobby` or `deps.keychainWrite` at all, and that
 * `main` still funnels its one JSON line through `deps.stdout` (the seam
 * `accounts`'s branch already uses). None of that is pinned as a clause here,
 * only used as scaffolding to reach the clauses that are.
 */

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

/**
 * A fake `deps` over the named keychain `records` (name -> record, or name ->
 * null for "listed, unreadable"). Records every fetch, every keychain write
 * and every lobby verb, plus the stdout lines a `main` call writes, so a leg
 * can assert on all four. A lobby verb that isn't `integrations edit/add`
 * throws — no leg here should ever need the fleet listing or the integration
 * probe, since `rotate: false` never reaches `refresh`.
 */
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

// ══════════════════════════════════════════════════════════════════════════
// (a) [M1] unexpired record, account + rotate:false: one row, one fetch,
//     zero keychain writes, zero edit/add verbs
// ══════════════════════════════════════════════════════════════════════════
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

// ══════════════════════════════════════════════════════════════════════════
// (b) [M2] expired record, account + rotate:false: unread, reason prefix,
//     zero fetches, zero keychain writes
// ══════════════════════════════════════════════════════════════════════════
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

// ══════════════════════════════════════════════════════════════════════════
// (c) [M3] main(['usage', '--json', '--account', 'acct', '--no-rotate']):
//     one stdout line, array of length 1, named for the account
// ══════════════════════════════════════════════════════════════════════════
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

// ══════════════════════════════════════════════════════════════════════════
// (d) [M3] main(['usage', '--json']) over two listed accounts: array of
//     length 2
// ══════════════════════════════════════════════════════════════════════════
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

// ══════════════════════════════════════════════════════════════════════════
// (e) [M4] USAGE_LINE spells the usage verb exactly
// ══════════════════════════════════════════════════════════════════════════
{
  const here = path.dirname(fileURLToPath(import.meta.url))
  const src = fs.readFileSync(path.join(here, '..', 'claude-token.mjs'), 'utf8')
  assert.ok(src.includes('usage [--json] [--account <name>] [--no-rotate]'),
    '(e) [M4] the source text carries the exact usage line `usage [--json] [--account <name>] [--no-rotate]`')
}

console.log('ALL TESTS PASSED')
