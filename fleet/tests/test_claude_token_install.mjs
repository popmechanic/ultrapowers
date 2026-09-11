/**
 * fleet/tests/test_claude_token_install.mjs — the exam for
 * "A launch installs the token it holds, whether or not it rotated it".
 *
 * The Claim: when I launch, the token my laptop holds for that account is the
 * one the edge carries — even when a usage read rotated it minutes before — and
 * the launch line says the bearer was installed, never "nothing to do".
 *
 * Every assertion below names the Proof leg it belongs to and the Machine
 * clause it comes from, so a reader can map this file back to the contract:
 *
 *   M1  `refresh(deps, { account })` on a record whose `expiresAt` is more than
 *       `REFRESH_AHEAD_MS` away makes no token request, issues exactly one
 *       `integrations edit claude-max --bearer - --comment account=<account>`
 *       lobby verb (or the `integrations add http-proxy …` form when
 *       `integrations list --json` lists no `claude-max`) with the record's
 *       `accessToken` on that verb's stdin and in no verb's argv, resolves
 *       `{ refreshed: false, installed: true, expiresAt }`, and its log line
 *       contains `bearer edited` (or `bearer added`) and does not contain
 *       `nothing to do`.
 *   M2  `refresh` on a record inside `REFRESH_AHEAD_MS` rotates as today (one
 *       `refresh_token` grant, the rotated triple written to the keychain
 *       before the edge is touched) and installs the NEW `accessToken`,
 *       resolving `{ refreshed: true, installed: true, expiresAt }`.
 *   M3  `refresh(deps, { install: false })` — the `--no-install` flag and
 *       `usage`'s own rotation — issues no lobby verb at all and resolves with
 *       `installed: false`; and `usage(deps)` on an expired account followed by
 *       `refresh(deps, { account })` ends with the lobby verb carrying the token
 *       `usage` rotated to, not the one the record held before.
 *   M4  `refresh` on a fresh record that carries no `accessToken` field rotates
 *       it (one grant) and installs the new token, resolving
 *       `{ refreshed: true, installed: true, expiresAt }`.
 *   M5  `node fleet/tests/test_claude_token.mjs`, `node fleet/tests/test_launch.mjs`
 *       and `node fleet/tests/test_sims_are_hermetic.mjs` each print
 *       `ALL TESTS PASSED` — the Proof's first three `Run:` lines, which the
 *       driver runs. A sim may not spawn another sim (that is
 *       `test_sims_are_hermetic.mjs`'s own M4), so what this file can hold is
 *       the structural half: each of the three is a file under `fleet/tests/`
 *       and each prints that sentinel. The running of them is the `Run:` line's.
 *   M6  `fleet/RUNBOOK.md`'s §3 (from the line beginning ``**3. `claude``` to
 *       the line beginning ``**4. `github```) says the launcher installs the
 *       keychain's access token on `claude-max` at every launch and rotates it
 *       when fewer than four hours remain — the section's text contains, in
 *       order, `every launch` and `four hours` — and no line of
 *       `fleet/RUNBOOK.md` contains `30 minutes of expiry`.
 *
 * Legs: (a) M1, (b) M2, (c) M3, (d) M4, (e) M5, (f) M6.
 *
 * The harness is this file's own — the seams `refresh`, `usage` and `main`
 * touch, and nothing else. It deliberately does not import
 * `fleet/tests/test_claude_token.mjs`: that file is a sim, not a rig. Nothing
 * here starts a process, opens a socket or reads a path outside the checkout.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  INTEGRATION, TARGET, DEFAULT_ACCOUNT, REFRESH_AHEAD_MS,
  OAUTH, refresh, usage, main
} from '../claude-token.mjs'

const T0 = 1_800_000_000_000
const DEFAULT = 'ultrapowers'
/** The usage endpoint, so a `usage` read is told apart from a refresh grant. */
const USAGE_ENDPOINT = 'https://api.anthropic.com/api/oauth/usage'
const USAGE_BODY = Object.freeze({
  five_hour: { utilization: 50.0, resets_at: '2027-01-15T13:00:00.000Z' },
  seven_day: { utilization: 10.0, resets_at: '2027-01-20T13:00:00.000Z' }
})

/**
 * Every seam stubbed: no network, no keychain, no lock on disk (`refresh` falls
 * to its own no-op when `deps.lock` is absent). `record` seeds the
 * `ultrapowers` item, `records` seeds any set; `calls.lobby` records every verb
 * as `{ verb, input }` and `calls.fetch` records every token request.
 */
function harness ({ hasIntegration = true, record = null, records = null, expiresIn = 3600 } = {}) {
  const calls = { fetch: [], usage: [], lobby: [], keychainReads: [], keychainWrites: [], logs: [], order: [] }
  const store = new Map()
  if (record) store.set(DEFAULT, JSON.stringify(record))
  if (records) for (const [name, rec] of Object.entries(records)) store.set(name, JSON.stringify(rec))
  let n = 0
  const deps = {
    now: () => T0,
    keychainRead: (name) => {
      calls.keychainReads.push(name)
      return store.has(name) ? store.get(name) : null
    },
    keychainWrite: (name, value) => {
      calls.keychainWrites.push({ name, value })
      calls.order.push('keychain')
      store.set(name, value)
      return true
    },
    keychainList: () => [...store.keys()],
    lobby: (verb, input) => {
      calls.lobby.push({ verb, input })
      if (verb.startsWith('integrations list')) {
        return { code: 0, out: JSON.stringify({ integrations: hasIntegration ? [{ name: INTEGRATION }] : [] }) }
      }
      calls.order.push('edge')
      return { code: 0, out: 'Updated integration\n' }
    },
    fetch: async (url, init = {}) => {
      if (String(url) === USAGE_ENDPOINT) {
        const headers = init.headers ?? {}
        calls.usage.push({ url: String(url), authorization: headers.Authorization ?? headers.authorization ?? '' })
        return {
          ok: true,
          status: 200,
          text: async () => '',
          json: async () => JSON.parse(JSON.stringify(USAGE_BODY))
        }
      }
      n += 1
      const body = JSON.parse(init.body)
      calls.fetch.push({ url: String(url), body })
      return {
        ok: true,
        status: 200,
        text: async () => '',
        json: async () => ({ access_token: `access-${n}`, refresh_token: `refresh-${n}`, expires_in: expiresIn })
      }
    },
    log: (line) => calls.logs.push(line)
  }
  return { deps, calls, store, stored: (name = DEFAULT) => (store.has(name) ? JSON.parse(store.get(name)) : null) }
}

const bearerVerbs = (calls) => calls.lobby.filter((c) => c.verb.includes('--bearer -'))
const lastLog = (calls) => calls.logs[calls.logs.length - 1] ?? ''
/** The expiry a stub `expires_in` of `seconds` mints against the frozen clock. */
const expiresMs = (seconds) => seconds * 1000

// ── the runner ───────────────────────────────────────────────────────────────

const legs = []
const leg = (name, fn) => { legs.push([name, fn]) }

// ── (a) the fresh path installs, and says so  [M1] ───────────────────────────

const FRESH = Object.freeze({ refreshToken: 'r0', accessToken: 'a0', expiresAt: T0 + REFRESH_AHEAD_MS + 60_000 })

leg('a fresh record (> REFRESH_AHEAD_MS) installs its own access token with one edit verb and logs `bearer edited`  [M1 / leg (a)]', async () => {
  const h = harness({ record: { ...FRESH } })
  const r = await refresh(h.deps, { account: DEFAULT })

  assert.equal(h.calls.fetch.length, 0,
    '(a) [M1] a record fresh for more than REFRESH_AHEAD_MS makes no token request')

  const edits = h.calls.lobby.filter((c) => c.verb.startsWith(`integrations edit ${INTEGRATION} --bearer - --comment account=${DEFAULT}`))
  assert.equal(edits.length, 1,
    `(a) [M1] exactly one lobby verb starts \`integrations edit ${INTEGRATION} --bearer - --comment account=${DEFAULT}\` — ` +
    `got ${JSON.stringify(h.calls.lobby.map((c) => c.verb))}`)
  assert.equal(edits[0].verb, `integrations edit ${INTEGRATION} --bearer - --comment account=${DEFAULT}`,
    '(a) [M1] and that verb is exactly it')
  assert.equal(edits[0].input, 'a0',
    "(a) [M1] the record's accessToken rides that verb's stdin")
  assert.equal(bearerVerbs(h.calls).length, 1,
    `(a) [M1] and it is the only --bearer - verb: ${JSON.stringify(bearerVerbs(h.calls).map((c) => c.verb))}`)
  assert.deepEqual(h.calls.lobby.filter((c) => c.verb.includes('a0')).map((c) => c.verb), [],
    '(a) [M1] and no verb carries the token in its argv (global constraint: the token reaches the edge on stdin only)')

  assert.deepEqual(r, { refreshed: false, installed: true, expiresAt: FRESH.expiresAt },
    '(a) [M1] refresh resolves { refreshed: false, installed: true, expiresAt }')

  assert.match(lastLog(h.calls), /bearer edited/,
    `(a) [M1] the last log line says the bearer was edited: ${JSON.stringify(lastLog(h.calls))}`)
  assert.deepEqual(h.calls.logs.filter((l) => l.includes('nothing to do')), [],
    `(a) [M1 / Claim] and no log line says "nothing to do": ${JSON.stringify(h.calls.logs)}`)
  assert.deepEqual(h.calls.logs.filter((l) => l.includes('a0') || l.includes('r0')), [],
    '(a) [global constraint] and no log line carries a token')

  assert.equal(h.calls.keychainWrites.length, 0,
    '(a) [M1] the fresh path rotates nothing, so the keychain is untouched')
})

leg('the same seed with no `claude-max` at the edge adds the http-proxy instead and logs `bearer added`  [M1 / leg (a)]', async () => {
  const h = harness({ record: { ...FRESH }, hasIntegration: false })
  const r = await refresh(h.deps, { account: DEFAULT })

  assert.equal(h.calls.fetch.length, 0, '(a) [M1] still no token request')
  const adds = h.calls.lobby.filter((c) => c.verb.startsWith('integrations add http-proxy'))
  assert.equal(adds.length, 1,
    `(a) [M1] exactly one \`integrations add http-proxy …\` verb when integrations list --json lists no ${INTEGRATION} — ` +
    `got ${JSON.stringify(h.calls.lobby.map((c) => c.verb))}`)
  assert.match(adds[0].verb, new RegExp(`^integrations add http-proxy --name ${INTEGRATION} .*--bearer - --comment account=${DEFAULT}$`),
    `(a) [M1] the add verb names ${INTEGRATION} and ends --bearer - --comment account=${DEFAULT}: ${JSON.stringify(adds[0].verb)}`)
  assert.ok(adds[0].verb.includes(`--target ${TARGET}`),
    `(a) [M1] at the target the module names: ${JSON.stringify(adds[0].verb)}`)
  assert.equal(adds[0].input, 'a0', "(a) [M1] with the record's accessToken on stdin")
  assert.deepEqual(h.calls.lobby.filter((c) => c.verb.includes('a0')).map((c) => c.verb), [],
    '(a) [M1] and no verb carries it in argv')

  assert.deepEqual(r, { refreshed: false, installed: true, expiresAt: FRESH.expiresAt },
    '(a) [M1] the add form resolves the same { refreshed: false, installed: true, expiresAt }')
  assert.match(lastLog(h.calls), /bearer added/,
    `(a) [M1] and the last log line says the bearer was added: ${JSON.stringify(lastLog(h.calls))}`)
  assert.deepEqual(h.calls.logs.filter((l) => l.includes('nothing to do')), [],
    '(a) [M1 / Claim] never "nothing to do"')
})

leg('a fresh record under --account b installs for `b`, and the comment names it  [M1 / leg (a)]', async () => {
  const h = harness({ records: { b: { refreshToken: 'r-b', accessToken: 'a-b', expiresAt: T0 + REFRESH_AHEAD_MS + 60_000 } } })
  const r = await refresh(h.deps, { account: 'b' })
  const edits = h.calls.lobby.filter((c) => c.verb.includes('--bearer -'))
  assert.equal(edits.length, 1, '(a) [M1] one bearer verb for the named account')
  assert.equal(edits[0].verb, `integrations edit ${INTEGRATION} --bearer - --comment account=b`,
    '(a) [M1] `refresh(deps, { account })` installs with --comment account=<account>')
  assert.equal(edits[0].input, 'a-b', "(a) [M1] carrying that account's own stored access token")
  assert.deepEqual(r, { refreshed: false, installed: true, expiresAt: T0 + REFRESH_AHEAD_MS + 60_000 },
    '(a) [M1] and resolves { refreshed: false, installed: true, expiresAt }')
})

// ── (b) the rotation path installs the NEW token  [M2] ───────────────────────

leg('a record inside REFRESH_AHEAD_MS rotates, writes the keychain before the edge, and installs the NEW access token  [M2 / leg (b)]', async () => {
  const h = harness({ record: { refreshToken: 'r0', accessToken: 'a0', expiresAt: T0 + 60_000 } })
  const r = await refresh(h.deps, { account: DEFAULT })

  assert.equal(h.calls.fetch.length, 1,
    '(b) [M2] one token request')
  assert.equal(h.calls.fetch[0].url, OAUTH.tokenUrl, '(b) [M2] to the token endpoint')
  assert.equal(h.calls.fetch[0].body.grant_type, 'refresh_token',
    "(b) [M2] whose body is a `refresh_token` grant")
  assert.equal(h.calls.fetch[0].body.refresh_token, 'r0',
    "(b) [M2] spending the record's refresh token")

  assert.deepEqual(h.stored(), { refreshToken: 'refresh-1', accessToken: 'access-1', expiresAt: T0 + expiresMs(3600) },
    '(b) [M2] the rotated triple replaces the consumed one in the keychain')
  assert.deepEqual(h.calls.order, ['keychain', 'edge'],
    `(b) [M2] and it is written BEFORE the edge is touched: ${JSON.stringify(h.calls.order)}`)

  const edits = bearerVerbs(h.calls)
  assert.equal(edits.length, 1, '(b) [M2] exactly one --bearer - verb')
  assert.equal(edits[0].verb, `integrations edit ${INTEGRATION} --bearer - --comment account=${DEFAULT}`,
    '(b) [M2] the edit verb')
  assert.equal(edits[0].input, 'access-1',
    "(b) [M2] whose stdin is the FETCHED access token, not the record's old one")
  assert.deepEqual(h.calls.lobby.filter((c) => c.verb.includes('access-1') || c.verb.includes('a0')).map((c) => c.verb), [],
    '(b) [global constraint] and no verb carries a token in argv')

  assert.deepEqual(r, { refreshed: true, installed: true, expiresAt: T0 + expiresMs(3600) },
    '(b) [M2] refresh resolves { refreshed: true, installed: true, expiresAt: <the fetched expiry> }')
  assert.deepEqual(h.calls.logs.filter((l) => l.includes('access-1') || l.includes('refresh-1') || l.includes('r0')), [],
    '(b) [global constraint] and no log line carries a token')
})

// ── (c) metering never moves the edge, and the launch installs what it left  [M3] ──

leg('refresh(deps, { install: false }) on that same fresh record issues no lobby verb at all and resolves installed: false  [M3 / leg (c)]', async () => {
  const h = harness({ record: { ...FRESH } })
  const r = await refresh(h.deps, { install: false })
  assert.equal(h.calls.lobby.length, 0,
    `(c) [M3] --no-install issues no lobby verb at all — not even \`integrations list\`: ${JSON.stringify(h.calls.lobby.map((c) => c.verb))}`)
  assert.equal(h.calls.fetch.length, 0, '(c) [M3] and the fresh path still makes no token request')
  assert.deepEqual(r, { refreshed: false, installed: false, expiresAt: FRESH.expiresAt },
    '(c) [M3] it resolves { refreshed: false, installed: false, expiresAt }')
})

leg('main([\'refresh\', \'--no-install\']) routes the flag: no lobby verb, installed: false  [M3 / leg (c)]', async () => {
  const h = harness({ record: { ...FRESH } })
  const r = await main(['refresh', '--no-install'], h.deps)
  assert.equal(h.calls.lobby.length, 0,
    '(c) [M3] the --no-install flag reaches refresh — zero lobby verbs')
  assert.deepEqual(r, { refreshed: false, installed: false, expiresAt: FRESH.expiresAt },
    '(c) [M3] and the result carries installed: false')
})

leg('refresh --no-install inside the window still rotates, writes the keychain and issues no lobby verb  [M3 / leg (c)]', async () => {
  const h = harness({ record: { refreshToken: 'r0', accessToken: 'a0', expiresAt: T0 + 60_000 } })
  const r = await refresh(h.deps, { install: false })
  assert.equal(h.calls.fetch.length, 1, '(c) [M3] one refresh grant')
  assert.deepEqual(h.stored(), { refreshToken: 'refresh-1', accessToken: 'access-1', expiresAt: T0 + expiresMs(3600) },
    '(c) [M3] the rotated triple is stored')
  assert.equal(h.calls.lobby.length, 0,
    '(c) [M3] and the rotation without install moves the edge not at all')
  assert.deepEqual(r, { refreshed: true, installed: false, expiresAt: T0 + expiresMs(3600) },
    '(c) [M3] resolving { refreshed: true, installed: false, expiresAt }')
})

leg('the run-100 sequence: usage rotates an expired account with zero lobby verbs, and the next refresh installs the token usage rotated TO  [M3 / leg (c)]', async () => {
  // The minted token lives eight hours, as the real one does, so the record
  // `usage` leaves behind is outside REFRESH_AHEAD_MS and the launch that
  // follows takes the fresh path — which is exactly the run-100 shape.
  const h = harness({ records: { [DEFAULT]: { refreshToken: 'r0', accessToken: 'a0', expiresAt: T0 - 1 } }, expiresIn: 8 * 3600 })

  const rows = await usage(h.deps)
  assert.equal(rows.length, 1, '(c) [M3] one usage row for the one account')
  assert.equal(h.calls.lobby.length, 0,
    `(c) [M3] usage issues no integrations verb — metering must not move the edge: ${JSON.stringify(h.calls.lobby.map((c) => c.verb))}`)
  assert.equal(h.calls.fetch.length, 1, '(c) [M3] and exactly one refresh grant for the expired account')
  assert.equal(h.calls.fetch[0].body.grant_type, 'refresh_token', '(c) [M3] a refresh_token grant')
  assert.equal(h.stored().accessToken, 'access-1',
    "(c) [M3] after which the record holds the token usage rotated to")
  assert.deepEqual(h.calls.usage.map((u) => u.authorization), ['Bearer access-1'],
    '(c) [M3] and the usage read used it')

  const r = await refresh(h.deps, { account: DEFAULT })
  const bearers = bearerVerbs(h.calls)
  assert.equal(bearers.length, 1,
    `(c) [M3] the launch that follows issues exactly one --bearer - verb: ${JSON.stringify(bearers.map((b) => b.verb))}`)
  assert.equal(bearers[0].input, 'access-1',
    '(c) [M3 / Claim] carrying the token usage rotated to — the edge ends the sequence holding what the keychain holds')
  assert.deepEqual(h.calls.lobby.filter((c) => c.input === 'a0').map((c) => c.verb), [],
    '(c) [M3] and no verb carries the pre-usage token')
  assert.equal(h.calls.fetch.length, 1,
    '(c) [M3] the launch spends no second grant — the record was already fresh')
  assert.deepEqual(r, { refreshed: false, installed: true, expiresAt: T0 + expiresMs(8 * 3600) },
    '(c) [M3 / M1] resolving { refreshed: false, installed: true, expiresAt }')
})

// ── (d) a record with no accessToken rotates and installs  [M4] ──────────────

leg('a fresh record carrying no accessToken rotates once and installs the new token  [M4 / leg (d)]', async () => {
  const h = harness({ record: { refreshToken: 'r0', expiresAt: T0 + 10 * REFRESH_AHEAD_MS } })
  const r = await refresh(h.deps, { account: DEFAULT })

  assert.equal(h.calls.fetch.length, 1,
    '(d) [M4] the pre-usage record shape falls through to the rotation: one grant')
  assert.equal(h.calls.fetch[0].body.grant_type, 'refresh_token', '(d) [M4] a refresh_token grant')
  assert.equal(h.calls.fetch[0].body.refresh_token, 'r0', '(d) [M4] spending the stored refresh token')

  const edits = bearerVerbs(h.calls)
  assert.equal(edits.length, 1, '(d) [M4] one --bearer - verb')
  assert.equal(edits[0].verb, `integrations edit ${INTEGRATION} --bearer - --comment account=${DEFAULT}`,
    '(d) [M4] the edit verb')
  assert.equal(edits[0].input, 'access-1', '(d) [M4] carrying the newly minted access token on stdin')
  assert.deepEqual(h.stored(), { refreshToken: 'refresh-1', accessToken: 'access-1', expiresAt: T0 + expiresMs(3600) },
    '(d) [M4] and the keychain now holds the whole triple')
  assert.deepEqual(r, { refreshed: true, installed: true, expiresAt: T0 + expiresMs(3600) },
    '(d) [M4] resolving { refreshed: true, installed: true, expiresAt: <the fetched expiry> }')
})

// ── (e) the three sims the Run: lines drive  [M5] ────────────────────────────

leg('the three sims the Run: lines name are files under fleet/tests/ that print the sentinel  [M5 / leg (e)]', () => {
  // `fleet/tests/test_sims_are_hermetic.mjs`'s own M4 forbids a sim from
  // spawning another sim, so this exam names them and never runs them; the
  // Proof's first three `Run:` lines are what pipe each into the grep.
  for (const name of ['test_claude_token.mjs', 'test_launch.mjs', 'test_sims_are_hermetic.mjs']) {
    const url = new URL(`./${name}`, import.meta.url)
    assert.ok(fs.existsSync(url),
      `(e) [M5] ${name} is a sim under fleet/tests/ for the Run: line to drive`)
    const text = fs.readFileSync(url, 'utf8')
    assert.match(text, /ALL TESTS PASSED/,
      `(e) [M5] and it prints the sentinel the Run: line greps for: ${name}`)
  }
})

// ── (f) the RUNBOOK says what the launcher now does  [M6] ────────────────────

const RUNBOOK = new URL('../RUNBOOK.md', import.meta.url)

leg('RUNBOOK §3 carries `every launch` before `four hours`  [M6 / leg (f)]', () => {
  assert.ok(fs.existsSync(RUNBOOK), '(f) [M6] fleet/RUNBOOK.md is the runbook this leg reads')
  const lines = fs.readFileSync(RUNBOOK, 'utf8').split('\n')
  const from = lines.findIndex((l) => /^\*\*3\. .claude. /.test(l))
  assert.notEqual(from, -1, '(f) [M6] §3 opens with the line beginning `**3. `claude``')
  const to = lines.findIndex((l, i) => i > from && /^\*\*4\. .github. /.test(l))
  assert.notEqual(to, -1, '(f) [M6] and §4 opens with the line beginning `**4. `github``')

  // The JS twin of the Proof's
  //   sed -n '/^\*\*3\. .claude. /,/^\*\*4\. .github. /p' fleet/RUNBOOK.md
  //     | tr '\n' ' ' | grep -q 'every launch.*four hours'
  const section = lines.slice(from, to + 1).join(' ')
  assert.ok(section.includes('every launch'),
    '(f) [M6] §3 says the launcher installs the keychain\'s access token at `every launch`')
  assert.ok(section.includes('four hours'),
    '(f) [M6] §3 says it rotates when fewer than `four hours` remain')
  assert.match(section, /every launch.*four hours/,
    '(f) [M6] and the two read in that order — installation every launch first, the rotation window second')
  assert.ok(section.includes(INTEGRATION),
    `(f) [M6] the section names the integration the bearer is installed on (${INTEGRATION})`)
})

leg('no line of fleet/RUNBOOK.md says `30 minutes of expiry`  [M6 / leg (f)]', () => {
  const lines = fs.readFileSync(RUNBOOK, 'utf8').split('\n')
  const surviving = lines
    .map((l, i) => [i + 1, l])
    .filter(([, l]) => l.includes('30 minutes of expiry'))
    .map(([i, l]) => `${i}:${l}`)
  assert.deepEqual(surviving, [],
    '(f) [M6] the retired sentence is gone — the window is four hours, not thirty minutes:\n  ' +
    surviving.join('\n  '))
})

// ── the sentinel ─────────────────────────────────────────────────────────────

let failures = 0
for (const [name, fn] of legs) {
  try {
    await fn()
    console.log(`ok — ${name}`)
  } catch (error) {
    failures += 1
    console.log(`FAIL — ${name}`)
    console.log(String(error && error.stack ? error.stack : error))
  }
}
if (failures) {
  console.log(`${failures} FAILED of ${legs.length} legs`)
  process.exit(1)
}
console.log(`${legs.length} legs`)
console.log('ALL TESTS PASSED')
