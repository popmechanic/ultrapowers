// The Claude Max credential tool: every seam stubbed, no network, no keychain.
//
// The harness's keychain is a Map of account → stored string, read and written
// through `keychainRead(name)` / `keychainWrite(name, value)` and enumerated by
// `keychainList()`; the `record` option seeds the `ultrapowers` entry and the
// `records` option seeds any set of accounts. `fetch` answers two endpoints: the
// OAuth token URL (as at BASE) and the usage URL.
import assert from 'node:assert/strict'
import * as CT from '../claude-token.mjs'
import {
  OAUTH, INTEGRATION, KEYCHAIN, REFRESH_AHEAD_MS, pkce, authorizeUrlFor, cleanCode, codeForState,
  login, refresh, status, installBearer, main
} from '../claude-token.mjs'

const T0 = 1_800_000_000_000
const DEFAULT = 'ultrapowers'

// The endpoint the exam's stub answers, spelled out here so the harness works
// even before the module exports it; `USAGE_URL` is pinned against it below.
const USAGE_ENDPOINT = 'https://api.anthropic.com/api/oauth/usage'
const FIVE_RESETS_AT = '2027-01-15T13:00:00.000Z'
const SEVEN_RESETS_AT = '2027-01-20T13:00:00.000Z'
// `other keys exist and are ignored` — `oauth_account` is that other key.
const USAGE_BODY = Object.freeze({
  five_hour: { utilization: 76.0, resets_at: FIVE_RESETS_AT },
  seven_day: { utilization: 12.5, resets_at: SEVEN_RESETS_AT },
  oauth_account: 'ignored'
})
const FIVE_ROW = { utilization: 76.0, resetsAt: FIVE_RESETS_AT }
const SEVEN_ROW = { utilization: 12.5, resetsAt: SEVEN_RESETS_AT }
const USAGE_HEADER = 'account | 5h % | 5h resets | 7d % | 7d resets'

const iso = (ms) => new Date(ms).toISOString()

// The harness clock only moves when `advanceOnSleep` is set, so every
// pre-existing leg still sees a frozen `now()` of exactly T0.
function harness ({
  hasIntegration = true, record = null, records = null, accountList = null,
  clipboard = 'CODE-123#state-xyz', clipboardSeq = null, advanceOnSleep = 0,
  tokenStatus = 200, tokenStatusByRefresh = {}, tokensByRefresh = {},
  usageStatus = {}, expiresIn = 3600
} = {}) {
  const calls = {
    fetch: [], usage: [], lobby: [], keychain: [], keychainReads: [], keychainWrites: [],
    keychainLists: 0, opened: [], logs: [], prompts: [], sleeps: [], clipboard: [], trace: []
  }
  const store = new Map()
  if (record) store.set(DEFAULT, JSON.stringify(record))
  if (records) for (const [name, rec] of Object.entries(records)) store.set(name, typeof rec === 'string' ? rec : JSON.stringify(rec))
  let n = 0
  let clock = 0
  let clipN = 0
  const deps = {
    now: () => T0 + clock,
    random: (len) => Buffer.alloc(len, 7),
    open: (url) => { calls.opened.push(url); calls.trace.push('open'); return true },
    clipboard: () => {
      // A sequence answers its values in order and then repeats its last, so an
      // over-eager poll is caught by the call-count assertion, not by a hang.
      const value = clipboardSeq ? clipboardSeq[Math.min(clipN, clipboardSeq.length - 1)] : clipboard
      clipN += 1
      calls.clipboard.push(value)
      calls.trace.push('clipboard')
      return value
    },
    sleep: async (ms) => { calls.sleeps.push(ms); calls.trace.push(`sleep:${ms}`); clock += advanceOnSleep },
    prompt: async (question) => { calls.prompts.push(question); calls.trace.push('prompt'); return '' },
    keychainRead: (name) => {
      calls.keychainReads.push(name)
      calls.trace.push(`read:${name}`)
      return store.has(name) ? store.get(name) : null
    },
    keychainWrite: (name, value) => {
      calls.keychain.push(value)
      calls.keychainWrites.push({ name, value })
      calls.trace.push('keychain')
      store.set(name, value)
      return true
    },
    keychainList: () => {
      calls.keychainLists += 1
      calls.trace.push('list')
      return accountList ? [...accountList] : [...store.keys()]
    },
    lobby: (verb, input) => {
      calls.lobby.push({ verb, input })
      calls.trace.push(`lobby:${verb.split(' ')[1]}`)
      if (verb.startsWith('integrations list')) {
        return { code: 0, out: JSON.stringify({ integrations: hasIntegration ? [{ name: INTEGRATION }] : [] }) }
      }
      return { code: 0, out: 'Updated integration\n' }
    },
    fetch: async (url, init = {}) => {
      if (String(url) === USAGE_ENDPOINT) {
        const headers = init.headers ?? {}
        const authorization = headers.Authorization ?? headers.authorization ?? ''
        const bearer = String(authorization).replace(/^Bearer /, '')
        const st = usageStatus[bearer] ?? 200
        calls.usage.push({ url: String(url), method: init.method ?? 'GET', authorization, headers, body: init.body })
        calls.trace.push('usage')
        return {
          ok: st === 200,
          status: st,
          text: async () => `usage endpoint answered ${st}`,
          json: async () => (st === 200 ? JSON.parse(JSON.stringify(USAGE_BODY)) : { error: { type: `status_${st}` } })
        }
      }
      n += 1
      const body = JSON.parse(init.body)
      calls.fetch.push({ url, body })
      calls.trace.push('fetch')
      const st = tokenStatusByRefresh[body.refresh_token] ?? tokenStatus
      const minted = tokensByRefresh[body.refresh_token] ?? { access: `access-${n}`, refresh: `refresh-${n}` }
      return {
        ok: st === 200,
        status: st,
        text: async () => 'nope',
        json: async () => ({ access_token: minted.access, refresh_token: minted.refresh, expires_in: expiresIn })
      }
    },
    log: (line) => calls.logs.push(line)
  }
  return { deps, calls, store, stored: (name = DEFAULT) => (store.has(name) ? store.get(name) : null) }
}

// `--json` writes to stdout, not through the `log` seam, so the exam captures
// the real stream around the call.
async function captureStdout (fn) {
  const orig = process.stdout.write
  let out = ''
  process.stdout.write = (chunk, enc, cb) => {
    out += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8')
    if (typeof enc === 'function') enc()
    else if (typeof cb === 'function') cb()
    return true
  }
  try {
    const value = await fn()
    return { value, out }
  } finally {
    process.stdout.write = orig
  }
}

const carries = (haystacks, needle) => haystacks.some((h) => String(h).includes(needle))

let legs = 0
const leg = (name, fn) => Promise.resolve().then(fn).then(() => { legs += 1; console.log(`ok - ${name}`) })

await leg('defaultDeps carries the sleep seam the clipboard poll needs (run-73 review advisory)', async () => {
  const { defaultDeps } = await import('../claude-token.mjs')
  assert.equal(typeof defaultDeps().sleep, 'function')
})

await leg('pkce: the challenge is the S256 of the verifier, url-safe, and state is 64 hex', () => {
  const p = pkce((len) => Buffer.alloc(len, 7))
  assert.match(p.verifier, /^[A-Za-z0-9_-]{43}$/)
  assert.match(p.challenge, /^[A-Za-z0-9_-]{43}$/)
  assert.match(p.state, /^[0-9a-f]{64}$/)
})

await leg('the authorize URL carries the loom constants and the S256 challenge', () => {
  const p = pkce((len) => Buffer.alloc(len, 7))
  const u = new URL(authorizeUrlFor(p))
  assert.equal(`${u.origin}${u.pathname}`, OAUTH.authorizeUrl)
  assert.equal(u.searchParams.get('client_id'), OAUTH.clientId)
  assert.equal(u.searchParams.get('redirect_uri'), OAUTH.redirectUri)
  assert.equal(u.searchParams.get('scope'), OAUTH.scopes)
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256')
  assert.equal(u.searchParams.get('code_challenge'), p.challenge)
  assert.equal(u.searchParams.get('response_type'), 'code')
  assert.equal(u.searchParams.get('state'), p.state)
})

await leg('the pasted code loses its #state fragment and whitespace', () => {
  assert.equal(cleanCode('  abc123#deadbeef \n'), 'abc123')
  assert.equal(cleanCode('abc123'), 'abc123')
})

await leg('login: opens the browser, exchanges the clipboard code with the verifier, stores the triple, edits the proxy with the bearer on stdin', async () => {
  const h = harness()
  const r = await login(h.deps)
  assert.equal(h.calls.opened.length, 1)
  const ex = h.calls.fetch[0]
  assert.equal(ex.url, OAUTH.tokenUrl)
  assert.equal(ex.body.grant_type, 'authorization_code')
  assert.equal(ex.body.code, 'CODE-123', 'fragment stripped before exchange')
  assert.equal(ex.body.redirect_uri, OAUTH.redirectUri)
  assert.equal(ex.body.client_id, OAUTH.clientId)
  assert.match(ex.body.code_verifier, /^[A-Za-z0-9_-]{43}$/)
  assert.match(ex.body.state, /^[0-9a-f]{64}$/)
  assert.deepEqual(JSON.parse(h.stored()), { refreshToken: 'refresh-1', accessToken: 'access-1', expiresAt: T0 + 3600 * 1000 })
  const edit = h.calls.lobby.find((c) => c.verb.startsWith('integrations edit'))
  assert.equal(edit.verb, `integrations edit ${INTEGRATION} --bearer - --comment account=${DEFAULT}`)
  assert.equal(edit.input, 'access-1', 'the access token rides stdin, never argv')
  assert.ok(!h.calls.lobby.some((c) => c.verb.includes('access-1')), 'no verb carries the token')
  assert.ok(!h.calls.logs.some((l) => l.includes('access-1') || l.includes('refresh-1')), 'nothing printed carries a token')
  assert.equal(r.how, 'edited')
})

await leg('login with no integration yet: adds the http-proxy with the bearer only — no headers', async () => {
  const h = harness({ hasIntegration: false })
  const r = await login(h.deps)
  const add = h.calls.lobby.find((c) => c.verb.startsWith('integrations add'))
  assert.equal(add.verb, `integrations add http-proxy --name ${INTEGRATION} --target https://api.anthropic.com --bearer - --comment account=${DEFAULT}`)
  assert.ok(!add.verb.includes('--header'), 'no anthropic-beta injection')
  assert.equal(add.input, 'access-1')
  assert.equal(r.how, 'added')
})

await leg('login: an empty clipboard refuses before any exchange', async () => {
  const h = harness({ clipboard: '  ' })
  await assert.rejects(() => login(h.deps), /clipboard holds no code/)
  assert.equal(h.calls.fetch.length, 0)
  assert.equal(h.calls.keychain.length, 0)
})

await leg('login: a failed exchange quotes the status and writes nothing', async () => {
  const h = harness({ tokenStatus: 400 })
  await assert.rejects(() => login(h.deps), /token endpoint answered 400/)
  assert.equal(h.calls.keychain.length, 0)
  assert.equal(h.calls.lobby.filter((c) => !c.verb.startsWith('integrations list')).length, 0)
})

await leg('refresh: fresh for more than 30 min → nothing touched', async () => {
  const h = harness({ record: { refreshToken: 'r0', accessToken: 'a0', expiresAt: T0 + REFRESH_AHEAD_MS + 60_000 } })
  const r = await refresh(h.deps)
  assert.equal(r.refreshed, false)
  assert.equal(h.calls.fetch.length, 0)
  assert.equal(h.calls.lobby.length, 0)
})

await leg('refresh: inside 30 min → rotate, store the NEW triple before the edge, then edit', async () => {
  const h = harness({ record: { refreshToken: 'r0', accessToken: 'a0', expiresAt: T0 + 60_000 } })
  const order = []
  const origWrite = h.deps.keychainWrite; h.deps.keychainWrite = (name, v) => { order.push('keychain'); return origWrite(name, v) }
  const origLobby = h.deps.lobby; h.deps.lobby = (verb, input) => { if (verb.startsWith('integrations edit')) order.push('edge'); return origLobby(verb, input) }
  const r = await refresh(h.deps)
  assert.equal(r.refreshed, true)
  assert.equal(h.calls.fetch[0].body.grant_type, 'refresh_token')
  assert.equal(h.calls.fetch[0].body.refresh_token, 'r0')
  assert.equal(h.calls.fetch[0].body.scope, OAUTH.scopes)
  assert.deepEqual(JSON.parse(h.stored()), { refreshToken: 'refresh-1', accessToken: 'access-1', expiresAt: T0 + 3600 * 1000 }, 'the rotated refresh token replaces the consumed one')
  assert.deepEqual(order, ['keychain', 'edge'])
})

await leg('refresh --force rotates even when fresh', async () => {
  const h = harness({ record: { refreshToken: 'r0', accessToken: 'a0', expiresAt: T0 + 10 * REFRESH_AHEAD_MS } })
  const r = await refresh(h.deps, { force: true })
  assert.equal(r.refreshed, true)
})

await leg('refresh with no record names the login verb', async () => {
  const h = harness({ record: null })
  await assert.rejects(() => refresh(h.deps), /run `node fleet\/claude-token.mjs login` first/)
})

await leg('status reports the expiry without a token', () => {
  const h = harness({ record: { refreshToken: 'SECRET', accessToken: 'SECRET-ACCESS', expiresAt: T0 + 90 * 60_000 } })
  const r = status(h.deps)
  assert.equal(r.present, true)
  assert.ok(h.calls.logs[0].includes('90 min'))
  assert.ok(!h.calls.logs[0].includes('SECRET'))
})

await leg('installBearer: a failing lobby verb surfaces the lobby\'s own words without the token', () => {
  const h = harness()
  h.deps.lobby = (verb) => verb.startsWith('integrations list')
    ? { code: 0, out: JSON.stringify({ integrations: [{ name: INTEGRATION }] }) }
    : { code: 1, out: 'quota exceeded\n' }
  assert.throws(() => installBearer(h.deps, 'access-9', DEFAULT), (e) => /quota exceeded/.test(e.message) && !/access-9/.test(e.message))
})

await leg('refresh is single-flight: the record is read under the lock, so a queued sibling finds the rotated triple and does nothing', async () => {
  const h = harness({ record: { refreshToken: 'r0', accessToken: 'a0', expiresAt: T0 + 60_000 } })
  let held = 0; const trace = []
  h.deps.lock = () => { held += 1; trace.push('lock'); return () => { held -= 1; trace.push('unlock') } }
  const origRead = h.deps.keychainRead
  h.deps.keychainRead = (name) => { assert.equal(held, 1, 'the record is read only while the lock is held'); return origRead(name) }
  const first = await refresh(h.deps)
  const second = await refresh(h.deps)
  assert.equal(first.refreshed, true)
  assert.equal(second.refreshed, false, 'the sibling sees the rotated triple (fresh for 60 min) and does nothing')
  assert.equal(h.calls.fetch.length, 1, 'one refresh grant, not two')
  assert.deepEqual(trace, ['lock', 'unlock', 'lock', 'unlock'])
  assert.equal(held, 0)
})

await leg('the lock is released when the refresh throws', async () => {
  const h = harness({ record: { refreshToken: 'r0', accessToken: 'a0', expiresAt: T0 + 60_000 }, tokenStatus: 500 })
  let held = 0
  h.deps.lock = () => { held += 1; return () => { held -= 1 } }
  await assert.rejects(() => refresh(h.deps), /token endpoint answered 500/)
  assert.equal(held, 0)
})

await leg('the real lock: two processes, one refresh grant', async () => {
  // The default lock is a directory under $HOME; point HOME at a temp dir and
  // race two `refresh` processes with a stubbed keychain and token endpoint.
  const fs = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path')
  const { spawn } = await import('node:child_process')
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-'))
  const rec = path.join(home, 'rec.json'); const grants = path.join(home, 'grants.log')
  fs.writeFileSync(rec, JSON.stringify({ refreshToken: 'r0', accessToken: 'a0', expiresAt: Date.now() + 60_000 }))
  const script = `
    import { refresh, defaultDeps } from ${JSON.stringify(new URL('../claude-token.mjs', import.meta.url).href)}
    import fs from 'node:fs'
    const deps = defaultDeps()
    deps.keychainRead = () => fs.readFileSync(${JSON.stringify(rec)}, 'utf8')
    deps.keychainWrite = (name, v) => { fs.writeFileSync(${JSON.stringify(rec)}, v); return true }
    deps.lobby = (verb) => ({ code: 0, out: verb.startsWith('integrations list') ? JSON.stringify({ integrations: [{ name: 'claude-max' }] }) : 'ok' })
    deps.fetch = async () => { fs.appendFileSync(${JSON.stringify(grants)}, 'grant' + String.fromCharCode(10)); await new Promise(r => setTimeout(r, 300)); return { ok: true, status: 200, text: async () => '', json: async () => ({ access_token: 'a', refresh_token: 'r1', expires_in: 3600 }) } }
    deps.log = () => {}
    const r = await refresh(deps); process.stdout.write(JSON.stringify(r))
  `
  const run = () => new Promise((resolve) => {
    const p = spawn(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, HOME: home }, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = '', err = ''; p.stdout.on('data', (d) => { out += d }); p.stderr.on('data', (d) => { err += d })
    p.on('close', (code) => resolve({ code, out, err }))
  })
  const [a, b] = await Promise.all([run(), run()])
  assert.equal(a.code, 0, a.err); assert.equal(b.code, 0, b.err)
  const results = [JSON.parse(a.out).refreshed, JSON.parse(b.out).refreshed].sort()
  assert.deepEqual(results, [false, true], 'exactly one process refreshed')
  assert.equal(fs.readFileSync(grants, 'utf8').trim().split('\n').length, 1, 'one grant hit the token endpoint')
  assert.ok(!fs.existsSync(path.join(home, '.ultrapowers', 'claude-token.lock')), 'the lock is released')
  fs.rmSync(home, { recursive: true, force: true })
})

// ---- `login --code-from-clipboard`: the credential driven from chat ---------
//
// The stub `random` is the harness's, so the login's own PKCE pair is the one
// the exam can compute: `pkce(deps.random)`. That is what lets the exam mint a
// clipboard value carrying THIS login's state, and a decoy carrying another.

const P = pkce((len) => Buffer.alloc(len, 7))
const AUTHORIZE_URL = authorizeUrlFor(P)
// `''`, `'nope'`, `'CODE-1#wrongstate'`, `'CODE-2#<state>'` — the Proof's sequence.
const SEQ = ['', 'nope', 'CODE-1#wrongstate', `CODE-2#${P.state}`]

await leg('[M1/M3] the poll constants are exported and pinned: CLIPBOARD_POLL_MS 2000, CLIPBOARD_WAIT_MS 600000', () => {
  assert.equal(CT.CLIPBOARD_POLL_MS, 2000, 'M1: the clipboard is read every CLIPBOARD_POLL_MS')
  assert.equal(CT.CLIPBOARD_WAIT_MS, 600_000, 'M3: the poll gives up after CLIPBOARD_WAIT_MS')
  assert.equal(CT.CLIPBOARD_WAIT_MS / CT.CLIPBOARD_POLL_MS, 300, 'leg (c): 300 sleeps is the deadline')
})

await leg('[M1 leg (a)] --code-from-clipboard: no prompt, one open, four clipboard reads with three sleep(2000) between them, then the same exchange/keychain/bearer three calls', async () => {
  const h = harness({ clipboardSeq: SEQ })
  const r = await login(h.deps, { codeFromClipboard: true })

  // M1: `deps.prompt` is never called — the mode exists because there is no
  // interactive stdin; the human answers in chat, not at the process.
  assert.equal(h.calls.prompts.length, 0, 'M1: deps.prompt is called never')

  // M1: the authorize URL is logged and `deps.open(url)` is called once.
  assert.equal(h.calls.opened.length, 1, 'M1: deps.open(url) once')
  assert.equal(h.calls.opened[0], AUTHORIZE_URL, 'M1: opened with this login’s authorize URL')
  assert.ok(h.calls.logs.some((l) => l.includes(AUTHORIZE_URL)), 'leg (a): the log contains the authorize URL')

  // leg (a): four clipboard reads, three sleeps of CLIPBOARD_POLL_MS between them.
  assert.deepEqual(h.calls.clipboard, SEQ, 'leg (a): the poll read each value of the sequence once, in order')
  assert.equal(h.calls.clipboard.length, 4, 'leg (a): four clipboard calls')
  assert.deepEqual(h.calls.sleeps, [2000, 2000, 2000], 'leg (a): three sleep(CLIPBOARD_POLL_MS) calls')
  assert.deepEqual(
    h.calls.trace.filter((e) => e === 'clipboard' || e.startsWith('sleep:')),
    ['clipboard', 'sleep:2000', 'clipboard', 'sleep:2000', 'clipboard', 'sleep:2000', 'clipboard'],
    'leg (a): the sleeps sit BETWEEN the reads — the first read is immediate, the matching read is not followed by a sleep'
  )

  // leg (a): one token request, and it carries exactly `CODE-2` — the fragment
  // is the state, not the code — with this login's verifier and state.
  assert.equal(h.calls.fetch.length, 1, 'leg (a): one token request')
  const ex = h.calls.fetch[0]
  assert.equal(ex.url, OAUTH.tokenUrl)
  assert.equal(ex.body.grant_type, 'authorization_code')
  assert.equal(ex.body.code, 'CODE-2', 'leg (a): exactly the code, the #state fragment stripped')
  assert.equal(ex.body.state, P.state, 'leg (a): the login’s own state')
  assert.equal(ex.body.client_id, OAUTH.clientId)
  assert.equal(ex.body.redirect_uri, OAUTH.redirectUri)
  assert.equal(ex.body.code_verifier, P.verifier, 'leg (a): the verifier of pkce(deps.random)')

  // leg (a): one keychain write holding the rotating refresh token.
  assert.equal(h.calls.keychain.length, 1, 'leg (a): one keychain write')
  assert.deepEqual(JSON.parse(h.calls.keychain[0]), { refreshToken: 'refresh-1', accessToken: 'access-1', expiresAt: T0 + 3600 * 1000 })

  // leg (a): one `integrations … --bearer -` lobby call with `access-1` on stdin.
  const bearer = h.calls.lobby.filter((c) => c.verb.includes('--bearer -'))
  assert.equal(bearer.length, 1, 'leg (a): one bearer install')
  assert.equal(bearer[0].verb, `integrations edit ${INTEGRATION} --bearer - --comment account=${DEFAULT}`)
  assert.equal(bearer[0].input, 'access-1', 'leg (a): the access token on stdin')
  assert.ok(!h.calls.lobby.some((c) => c.verb.includes('access-1')), 'no secret in argv')

  // leg (a): the log carries neither the code nor the access token.
  assert.ok(!h.calls.logs.some((l) => l.includes('CODE-2')), 'leg (a): no log line carries CODE-2')
  assert.ok(!h.calls.logs.some((l) => l.includes('access-1')), 'leg (a): no log line carries access-1')
  assert.ok(!h.calls.logs.some((l) => l.includes('refresh-1')), 'no log line carries the refresh token')

  assert.deepEqual(r, { expiresAt: T0 + 3600 * 1000, how: 'edited' }, 'login resolves { expiresAt, how }')
})

await leg('[M2 leg (b)] a clipboard value with no # or with a different state is skipped: no token request precedes the fourth read', async () => {
  const h = harness({ clipboardSeq: SEQ })
  await login(h.deps, { codeFromClipboard: true })
  const t = h.calls.trace
  const reads = t.map((e, i) => (e === 'clipboard' ? i : -1)).filter((i) => i >= 0)
  assert.equal(reads.length, 4)
  assert.ok(!t.slice(0, reads[3]).includes('fetch'), 'M2: `nope` and `CODE-1#wrongstate` were skipped without an exchange')
  assert.ok(!t.slice(0, reads[3]).includes('keychain'), 'M2: nothing was written before the matching read')
  assert.equal(h.calls.fetch.length, 1, 'M2: exactly one exchange, for the matching value only')
  assert.ok(!h.calls.fetch.some((f) => f.body.code === 'CODE-1'), 'M2: the wrong-state code was never exchanged')
  assert.ok(!h.calls.fetch.some((f) => f.body.code === 'nope'), 'M2: the value with no # was never exchanged')
})

await leg('[M3 leg (c)] CLIPBOARD_WAIT_MS with no match: rejects naming --code-from-clipboard after exactly 300 sleeps, having touched nothing', async () => {
  const h = harness({ clipboard: '', advanceOnSleep: 2000 })
  await assert.rejects(
    () => login(h.deps, { codeFromClipboard: true }),
    (e) => e instanceof Error && e.message.includes('--code-from-clipboard'),
    'M3: an Error whose message names --code-from-clipboard'
  )
  assert.equal(h.calls.sleeps.length, 300, 'leg (c): exactly CLIPBOARD_WAIT_MS / CLIPBOARD_POLL_MS sleeps')
  assert.ok(h.calls.sleeps.every((ms) => ms === 2000), 'leg (c): every sleep is CLIPBOARD_POLL_MS')
  assert.equal(h.calls.fetch.length, 0, 'M3: no token request')
  assert.equal(h.calls.keychain.length, 0, 'M3: no keychain write')
  assert.equal(h.calls.lobby.length, 0, 'M3: no lobby edit')
  assert.equal(h.calls.prompts.length, 0, 'M1: still never prompts')
})

await leg('[M4 leg (d)] main([\'login\', \'--code-from-clipboard\']) reaches login with codeFromClipboard: true', async () => {
  const h = harness({ clipboardSeq: SEQ })
  const r = await main(['login', '--code-from-clipboard'], h.deps)
  assert.equal(h.calls.prompts.length, 0, 'M4: the flag reached login — no prompt')
  assert.deepEqual(h.calls.sleeps, [2000, 2000, 2000], 'M4: the flag reached login — the clipboard was polled')
  assert.equal(h.calls.clipboard.length, 4)
  assert.equal(h.calls.fetch[0].body.code, 'CODE-2', 'M4: the state-matched value was exchanged')
  assert.deepEqual(r, { expiresAt: T0 + 3600 * 1000, how: 'edited' })
})

await leg('[M4 leg (d)] main([\'login\']) without the flag prompts once and reads the clipboard once, as at BASE', async () => {
  const h = harness()
  const r = await main(['login'], h.deps)
  assert.equal(h.calls.prompts.length, 1, 'M4: the interactive login still prompts exactly once')
  assert.equal(h.calls.clipboard.length, 1, 'M4: and reads the clipboard exactly once')
  assert.equal(h.calls.sleeps.length, 0, 'M4: no polling on the interactive path')
  assert.equal(h.calls.fetch[0].body.code, 'CODE-123')
  assert.equal(r.how, 'edited')
})

await leg('[M4 leg (d)] main refresh/status behave as at BASE', async () => {
  const fresh = harness({ record: { refreshToken: 'r0', accessToken: 'a0', expiresAt: T0 + REFRESH_AHEAD_MS + 60_000 } })
  assert.deepEqual(await main(['refresh'], fresh.deps), { refreshed: false, expiresAt: T0 + REFRESH_AHEAD_MS + 60_000 })
  assert.equal(fresh.calls.fetch.length, 0)

  const forced = harness({ record: { refreshToken: 'r0', accessToken: 'a0', expiresAt: T0 + 10 * REFRESH_AHEAD_MS } })
  assert.deepEqual(await main(['refresh', '--force'], forced.deps), { refreshed: true, expiresAt: T0 + 3600 * 1000 })
  assert.equal(forced.calls.fetch[0].body.grant_type, 'refresh_token')

  const st = harness({ record: { refreshToken: 'SECRET', accessToken: 'SECRET-ACCESS', expiresAt: T0 + 90 * 60_000 } })
  assert.deepEqual(await main(['status'], st.deps), { present: true, expiresAt: T0 + 90 * 60_000 })
  assert.ok(!st.calls.logs.some((l) => l.includes('SECRET')))
})

// ---- #618 item 1: the clipboard rule is pinned where it lives ---------------
//
// The decision recorded in #618's 2026-09-05 comment is to KEEP the difference
// between the two splitters — `codeForState` splits on every `#` and rejects a
// value with more than one, `cleanCode` splits on the first `#` and keeps the
// head — and to pin that difference in a comment beside the stricter rule. So
// M1–M3 read the two functions and M4 reads the comment; nothing here asks the
// code to change.

// The twelve lines directly above `export function codeForState`, keeping only
// whole-line `//` comments (indentation allowed) and joining them with spaces —
// the JS twin of the Proof's
//   grep -B12 '^export function codeForState' fleet/claude-token.mjs
//     | grep '^ *//' | tr '\n' ' '
async function commentAboveCodeForState () {
  const fs = await import('node:fs')
  const src = fs.readFileSync(new URL('../claude-token.mjs', import.meta.url), 'utf8')
  const lines = src.split('\n')
  const at = lines.findIndex((l) => /^export function codeForState/.test(l))
  assert.notEqual(at, -1, 'M4: fleet/claude-token.mjs declares `export function codeForState`')
  return lines
    .slice(Math.max(0, at - 12), at)
    .filter((l) => /^ *\/\//.test(l))
    .join(' ')
}

await leg('[clipboard-rule legs (a)(b)(c) / M1 M2 M3] codeForState rejects a value with more than one #, answers the code for code#state, and cleanCode keeps the looser first-# split', () => {
  // leg (a) [M1]: `codeForState('code#state#extra', 'state')` returns null.
  assert.equal(
    codeForState('code#state#extra', 'state'), null,
    'leg (a) [M1]: codeForState(\'code#state#extra\', \'state\') is null — more than one # is rejected, and skipping it is the safe failure'
  )

  // leg (b) [M2]: `codeForState('code#state', 'state')` returns `'code'`.
  assert.equal(
    codeForState('code#state', 'state'), 'code',
    'leg (b) [M2]: codeForState(\'code#state\', \'state\') is \'code\' — this login\'s own code#state is the value the poll exchanges'
  )

  // leg (c) [M3]: `cleanCode('code#state#extra')` returns `'code'` — the looser
  // first-`#` split the stricter rule departs from.
  assert.equal(
    cleanCode('code#state#extra'), 'code',
    'leg (c) [M3]: cleanCode(\'code#state#extra\') is \'code\' — the first-# split cleanCode keeps, which is exactly what codeForState refuses'
  )
})

await leg('[clipboard-rule M4] the whole-line // comment directly above `export function codeForState` says, in order: more than one # / rejected / safe failure', async () => {
  const comment = await commentAboveCodeForState()
  assert.ok(comment.length > 0, 'M4: the twelve lines above the function hold whole-line // comments')

  // M4 names three phrases and their order. Each is pinned on its own first, so
  // a miss reads as which phrase is absent, and then the order is pinned once.
  assert.match(comment, /more than one #/, 'M4: the comment carries the phrase `more than one #` (the # bare, not backticked)')
  assert.match(comment, /rejected/, 'M4: the comment carries the phrase `rejected`')
  assert.match(comment, /safe failure/, 'M4: the comment carries the phrase `safe failure`')
  assert.match(
    comment, /more than one #.*rejected.*safe failure/,
    'M4: the three phrases appear in this order — the value shape, that it is rejected, and the reason'
  )
})

// ---- #513 items 1 and 2: one keychain entry per account, one usage table ----
//
// M1 the named item, M2 the install verb's `--comment account=<name>` and the
// `--no-install` switch, M3 `accounts`, M4 `usage`/`renderUsage`, M5 routing.

await leg('[M1/M3/M4] the module names the service, the default account and the usage endpoint', () => {
  assert.equal(KEYCHAIN.service, 'ultrapowers-claude-oauth', 'M1 / global constraint: the keychain service stays `ultrapowers-claude-oauth`')
  assert.equal(CT.DEFAULT_ACCOUNT, 'ultrapowers', 'M1: the default account is `ultrapowers` — the BASE item')
  assert.equal(KEYCHAIN.account, 'ultrapowers', 'M1: the BASE item (account `ultrapowers`) is still the default')
  assert.equal(CT.USAGE_URL, USAGE_ENDPOINT, 'M4: the read is GET https://api.anthropic.com/api/oauth/usage')
  assert.equal(INTEGRATION, 'claude-max')
  assert.equal(typeof CT.accounts, 'function', 'M3: `accounts` is exported')
  assert.equal(typeof CT.usage, 'function', 'M4: `usage` is exported')
  assert.equal(typeof CT.renderUsage, 'function', 'M4: `renderUsage` is exported')
  assert.equal(typeof CT.defaultDeps().keychainList, 'function', 'M3: the third seam `keychainList()` is a default dep')
  // Every BASE export survives the change.
  for (const name of [
    'OAUTH', 'INTEGRATION', 'TARGET', 'KEYCHAIN', 'LOCK_PATH', 'LOCK_STALE_MS', 'REFRESH_AHEAD_MS',
    'CLIPBOARD_POLL_MS', 'CLIPBOARD_WAIT_MS', 'pkce', 'authorizeUrlFor', 'cleanCode', 'codeForState',
    'defaultDeps', 'exchange', 'refreshGrant', 'integrationExists', 'installBearer', 'readRecord',
    'writeRecord', 'login', 'refresh', 'status', 'main'
  ]) {
    assert.ok(Object.hasOwn(CT, name) && CT[name] !== undefined, `every BASE export is kept: ${name}`)
  }
})

await leg('[M1 leg (a)] login --account b reads and writes the item named `b`, and stores exactly the three keys', async () => {
  const h = harness()
  await main(['login', '--account', 'b'], h.deps)
  assert.ok(h.calls.keychainReads.every((name) => name === 'b'), 'leg (a): every keychainRead call is with `b`')
  assert.deepEqual(h.calls.keychainWrites.map((w) => w.name), ['b'], 'leg (a): every keychainWrite is (`b`, value)')
  assert.deepEqual(
    JSON.parse(h.stored('b')),
    { refreshToken: 'refresh-1', accessToken: 'access-1', expiresAt: T0 + 3600 * 1000 },
    'leg (a) [M1]: the record written is exactly { refreshToken, accessToken, expiresAt }'
  )
  assert.equal(h.stored(DEFAULT), null, 'leg (a): the `ultrapowers` item is untouched by an --account login')
})

await leg('[M1 leg (a)] refresh --account b and status --account b name `b` on every keychain call; with no flag the same calls name `ultrapowers`', async () => {
  const named = harness({ records: { b: { refreshToken: 'r-b', accessToken: 'access-b-old', expiresAt: T0 + 60_000 } } })
  const r = await main(['refresh', '--account', 'b'], named.deps)
  assert.equal(r.refreshed, true, 'leg (a): a `b` inside thirty minutes rotates')
  assert.ok(named.calls.keychainReads.length >= 1, 'leg (a): refresh reads the record')
  assert.ok(named.calls.keychainReads.every((name) => name === 'b'), 'leg (a): every keychainRead call is with `b`')
  assert.deepEqual(named.calls.keychainWrites.map((w) => w.name), ['b'], 'leg (a): every keychainWrite is (`b`, value)')
  assert.deepEqual(
    JSON.parse(named.stored('b')),
    { refreshToken: 'refresh-1', accessToken: 'access-1', expiresAt: T0 + 3600 * 1000 },
    'leg (a) [M1]: the rotated record is exactly the three keys'
  )

  const st = harness({ records: { b: { refreshToken: 'r-b', accessToken: 'access-b', expiresAt: T0 + 90 * 60_000 } } })
  const s = await main(['status', '--account', 'b'], st.deps)
  assert.equal(s.present, true)
  assert.ok(st.calls.keychainReads.length >= 1, 'leg (a): status reads the record')
  assert.ok(st.calls.keychainReads.every((name) => name === 'b'), 'leg (a): status reads the item named `b`')
  assert.equal(st.calls.keychainWrites.length, 0, 'leg (a): status writes nothing')
  assert.ok(carries(st.calls.logs, iso(T0 + 90 * 60_000)), 'M1: status prints the expiry')
  assert.ok(!carries(st.calls.logs, 'r-b') && !carries(st.calls.logs, 'access-b'), 'M1: status prints no token')

  // With no `--account`, the same calls name the BASE item.
  const dflt = harness({ record: { refreshToken: 'r0', accessToken: 'a0', expiresAt: T0 + 60_000 } })
  await main(['refresh'], dflt.deps)
  assert.ok(dflt.calls.keychainReads.every((name) => name === DEFAULT), 'leg (a): with no flag every keychainRead names `ultrapowers`')
  assert.deepEqual(dflt.calls.keychainWrites.map((w) => w.name), [DEFAULT], 'leg (a): with no flag every keychainWrite names `ultrapowers`')

  const dfltStatus = harness({ record: { refreshToken: 'r0', accessToken: 'a0', expiresAt: T0 + 60_000 } })
  await main(['status'], dfltStatus.deps)
  assert.deepEqual(dfltStatus.calls.keychainReads, [DEFAULT], 'leg (a): status with no flag reads `ultrapowers`')

  const dfltLogin = harness()
  await main(['login'], dfltLogin.deps)
  assert.deepEqual(dfltLogin.calls.keychainWrites.map((w) => w.name), [DEFAULT], 'leg (a): login with no flag writes `ultrapowers`')
})

await leg('[M2 leg (b)] installBearer issues the exact edit and add verbs carrying --comment account=<name>, the token on stdin and in no verb', () => {
  const edited = harness()
  assert.equal(installBearer(edited.deps, 'access-1', 'b'), 'edited', 'M2: an existing object is edited')
  const edit = edited.calls.lobby.find((c) => c.verb.startsWith('integrations edit'))
  assert.equal(
    edit.verb, 'integrations edit claude-max --bearer - --comment account=b',
    'leg (b): the edit verb with --account b is exactly this'
  )
  assert.equal(edit.input, 'access-1', 'leg (b): `access-1` on stdin')
  assert.ok(!edited.calls.lobby.some((c) => c.verb.includes('access-1')), 'leg (b): no verb contains access-1')

  const added = harness({ hasIntegration: false })
  assert.equal(installBearer(added.deps, 'access-1', 'b'), 'added', 'M2: a missing object is added')
  const add = added.calls.lobby.find((c) => c.verb.startsWith('integrations add'))
  assert.equal(
    add.verb, 'integrations add http-proxy --name claude-max --target https://api.anthropic.com --bearer - --comment account=b',
    'leg (b): the add verb with --account b is exactly this'
  )
  assert.equal(add.input, 'access-1', 'leg (b): `access-1` on stdin')
  assert.ok(!added.calls.lobby.some((c) => c.verb.includes('access-1')), 'leg (b): no verb contains access-1')

  // The same verbs come out of the account-carrying login.
  const viaLogin = harness()
  return main(['login', '--account', 'b'], viaLogin.deps).then(() => {
    const v = viaLogin.calls.lobby.find((c) => c.verb.includes('--bearer -'))
    assert.equal(v.verb, 'integrations edit claude-max --bearer - --comment account=b', 'leg (b): login --account b installs with the account comment')
    assert.equal(v.input, 'access-1')
  })
})

await leg('[M2 leg (b)] login --no-install writes the keychain and issues no integrations verb at all', async () => {
  const h = harness()
  const r = await main(['login', '--no-install'], h.deps)
  assert.equal(h.calls.fetch.length, 1, 'M2: --no-install still exchanges')
  assert.deepEqual(
    JSON.parse(h.stored()),
    { refreshToken: 'refresh-1', accessToken: 'access-1', expiresAt: T0 + 3600 * 1000 },
    'leg (b): the keychain is written'
  )
  assert.equal(h.calls.lobby.length, 0, 'leg (b): no lobby call at all — not even `integrations list`')
  assert.equal(r.expiresAt, T0 + 3600 * 1000)
})

await leg('[M2 leg (b)] refresh --no-install inside thirty minutes rotates, writes the keychain, and issues no integrations verb at all', async () => {
  const h = harness({ record: { refreshToken: 'r0', accessToken: 'a0', expiresAt: T0 + 60_000 } })
  const r = await main(['refresh', '--no-install'], h.deps)
  assert.equal(r.refreshed, true, 'leg (b): it rotated')
  assert.equal(h.calls.fetch.length, 1, 'leg (b): one refresh grant')
  assert.equal(h.calls.fetch[0].body.grant_type, 'refresh_token')
  assert.deepEqual(
    JSON.parse(h.stored()),
    { refreshToken: 'refresh-1', accessToken: 'access-1', expiresAt: T0 + 3600 * 1000 },
    'leg (b): the keychain holds the new triple'
  )
  assert.equal(h.calls.lobby.length, 0, 'leg (b): no lobby call at all')
})

await leg('[M3 leg (c)] accounts answers one entry per keychain item — name, ISO expiresAt, fresh — and an empty keychain answers []', () => {
  const h = harness({
    records: {
      ultrapowers: { refreshToken: 'r-up', accessToken: 'access-up', expiresAt: T0 + 3600 * 1000 },
      b: { refreshToken: 'r-b', accessToken: 'access-b', expiresAt: T0 - 60_000 }
    }
  })
  const rows = CT.accounts(h.deps)
  assert.deepEqual(
    rows,
    [
      { name: 'ultrapowers', expiresAt: iso(T0 + 3600 * 1000), fresh: true },
      { name: 'b', expiresAt: iso(T0 - 60_000), fresh: false }
    ],
    'leg (c) [M3]: two entries, the ISO strings of the stored instants, fresh true then false'
  )
  assert.equal(h.calls.keychainLists, 1, 'M3: `keychainList()` names them')
  assert.deepEqual(h.calls.keychainReads, ['ultrapowers', 'b'], 'M3: each is read')
  assert.ok(!carries(h.calls.logs, 'r-up') && !carries(h.calls.logs, 'access-up'), 'M3: no output carries a token')
  assert.ok(!carries(h.calls.logs, 'r-b') && !carries(h.calls.logs, 'access-b'), 'M3: no output carries a token')

  const empty = harness()
  assert.deepEqual(CT.accounts(empty.deps), [], 'leg (c): an empty keychain answers []')
})

await leg('[M3 leg (c)] main([\'accounts\', \'--json\']) writes exactly that array as JSON to stdout, and the plain form logs one `<name> expires <ISO> (<n> min)` line per entry', async () => {
  const seeds = {
    ultrapowers: { refreshToken: 'r-up', accessToken: 'access-up', expiresAt: T0 + 3600 * 1000 },
    b: { refreshToken: 'r-b', accessToken: 'access-b', expiresAt: T0 - 60_000 }
  }
  const expected = [
    { name: 'ultrapowers', expiresAt: iso(T0 + 3600 * 1000), fresh: true },
    { name: 'b', expiresAt: iso(T0 - 60_000), fresh: false }
  ]

  const j = harness({ records: seeds })
  const { out } = await captureStdout(() => main(['accounts', '--json'], j.deps))
  assert.deepEqual(
    JSON.parse(out.trim()), expected,
    'leg (c): stdout is exactly that array as JSON — nothing else, so JSON.parse of the whole stream succeeds (the doctor parses this)'
  )
  for (const secret of ['r-up', 'access-up', 'r-b', 'access-b']) {
    assert.ok(!out.includes(secret), `M3: no stdout carries ${secret}`)
    assert.ok(!carries(j.calls.logs, secret), `M3: no log line carries ${secret}`)
  }

  const p = harness({ records: seeds })
  const plain = await captureStdout(() => main(['accounts'], p.deps))
  const lines = [...p.calls.logs, ...plain.out.split('\n')].filter((l) => l.includes('expires'))
  assert.equal(lines.length, 2, 'leg (c): the plain form prints two lines')
  assert.ok(
    lines.some((l) => new RegExp(`^ultrapowers expires ${iso(T0 + 3600 * 1000)} \\(-?\\d+ min\\)$`).test(l.trim())),
    'M3: one `<name> expires <ISO> (<n> min)` line for `ultrapowers`'
  )
  assert.ok(
    lines.some((l) => new RegExp(`^b expires ${iso(T0 - 60_000)} \\(-?\\d+ min\\)$`).test(l.trim())),
    'M3: one `<name> expires <ISO> (<n> min)` line for `b`'
  )
  for (const secret of ['r-up', 'access-up', 'r-b', 'access-b']) {
    assert.ok(!plain.out.includes(secret) && !carries(p.calls.logs, secret), `M3: the plain form carries no ${secret}`)
  }
})

// The four entries of leg (d): a fresh access token, an expired one that rotates,
// an expired one whose refresh grant answers 500, and a fresh one the usage
// endpoint answers 429.
const USAGE_SEEDS = {
  fresh: { refreshToken: 'r-fresh', accessToken: 'access-fresh', expiresAt: T0 + 3600 * 1000 },
  stale: { refreshToken: 'r-stale', accessToken: 'access-stale-1', expiresAt: T0 - 60_000 },
  broken: { refreshToken: 'r-broken', accessToken: 'access-broken-1', expiresAt: T0 - 60_000 },
  limited: { refreshToken: 'r-limited', accessToken: 'access-limited', expiresAt: T0 + 3600 * 1000 }
}
const usageHarness = () => harness({
  records: USAGE_SEEDS,
  tokensByRefresh: { 'r-stale': { access: 'access-stale-2', refresh: 'refresh-stale-2' } },
  tokenStatusByRefresh: { 'r-broken': 500 },
  usageStatus: { 'access-limited': 429 }
})
const USAGE_SECRETS = ['access-fresh', 'access-stale-1', 'access-stale-2', 'access-broken-1', 'access-limited',
  'r-fresh', 'r-stale', 'r-broken', 'r-limited', 'refresh-stale-2']

await leg('[M4 leg (d)] usage: a fresh entry is read with its stored token, a stale one is rotated under the lock first with no integrations verb, and the rows carry the endpoint\'s two windows', async () => {
  const h = usageHarness()
  let held = 0
  let maxHeld = 0
  h.deps.lock = () => { held += 1; maxHeld = Math.max(maxHeld, held); return () => { held -= 1 } }
  const origFetch = h.deps.fetch
  h.deps.fetch = async (url, init = {}) => {
    if (String(url) !== USAGE_ENDPOINT) assert.ok(held >= 1, 'M4: the rotation happens under the lock')
    return origFetch(url, init)
  }

  const rows = await CT.usage(h.deps)
  assert.equal(held, 0, 'M4: the lock is released')
  assert.ok(maxHeld >= 1, 'M4: the rotation took the lock')

  // one row per entry
  assert.equal(rows.length, 4, 'leg (d): one row per entry')
  assert.deepEqual([...rows.map((r) => r.name)].sort(), ['broken', 'fresh', 'limited', 'stale'], 'leg (d): one row per entry, named')
  const by = Object.fromEntries(rows.map((r) => [r.name, r]))

  // the token endpoint: none for `fresh` or `limited`, exactly one for `stale`.
  assert.deepEqual(
    [...h.calls.fetch.map((f) => f.body.refresh_token)].sort(), ['r-broken', 'r-stale'],
    'leg (d): no token request for `fresh` (nor for `limited`), and exactly one refresh_token grant for `stale`'
  )
  for (const f of h.calls.fetch) assert.equal(f.body.grant_type, 'refresh_token', 'M4: the rotation is a refresh grant')
  assert.equal(h.calls.fetch.filter((f) => f.body.refresh_token === 'r-stale').length, 1, 'leg (d): exactly one grant for `stale`')
  assert.deepEqual(
    JSON.parse(h.stored('stale')),
    { refreshToken: 'refresh-stale-2', accessToken: 'access-stale-2', expiresAt: T0 + 3600 * 1000 },
    'leg (d): `stale`\'s stored record holds the new triple'
  )
  assert.equal(h.calls.lobby.length, 0, 'leg (d) [M4]: no integrations verb was issued — metering must not move the edge')

  // the read itself
  assert.deepEqual(
    [...h.calls.usage.map((u) => u.authorization)].sort(),
    ['Bearer access-fresh', 'Bearer access-limited', 'Bearer access-stale-2'].sort(),
    'leg (d): every usage request carries `Bearer <that entry\'s access token>` — `stale`\'s is the rotated one'
  )
  for (const u of h.calls.usage) {
    assert.equal(u.url, USAGE_ENDPOINT, 'leg (d): every usage request is that URL')
    assert.equal(String(u.method).toUpperCase(), 'GET', 'leg (d): every usage request is a GET')
  }
  assert.ok(!h.calls.usage.some((u) => String(u.authorization).includes('access-stale-1')), 'leg (d): the consumed token is never used')
  assert.ok(!h.calls.usage.some((u) => String(u.authorization).includes('access-broken-1')), 'leg (d): a failed rotation reads nothing')

  // the 200 rows
  for (const name of ['fresh', 'stale']) {
    assert.deepEqual(by[name].fiveHour, FIVE_ROW, `leg (d): ${name}.fiveHour is { utilization, resetsAt } from five_hour.utilization/five_hour.resets_at`)
    assert.deepEqual(by[name].sevenDay, SEVEN_ROW, `leg (d): ${name}.sevenDay is { utilization, resetsAt } from seven_day.utilization/seven_day.resets_at`)
    assert.ok(!by[name].unread, `leg (d): ${name} is read`)
  }

  // the unread rows, and every other row still answered
  assert.equal(by.broken.unread, true, 'leg (d): a refresh grant that fails leaves the row unread')
  assert.match(String(by.broken.reason), /500/, 'leg (d): `broken`\'s reason names 500')
  assert.equal(by.limited.unread, true, 'leg (d): a non-200 usage answer leaves the row unread')
  assert.match(String(by.limited.reason), /429/, 'leg (d): `limited`\'s reason names 429')

  const printed = [...h.calls.logs, JSON.stringify(rows)]
  for (const secret of USAGE_SECRETS) {
    assert.ok(!carries(h.calls.logs, secret), `M4: no output carries ${secret}`)
    assert.ok(!printed.slice(1).some((p) => p.includes(secret)), `M4: no row carries ${secret}`)
  }
})

await leg('[M4 leg (d)] renderUsage prints the header line and one line per row, an unread row printing `unread: <reason>`', async () => {
  const h = usageHarness()
  h.deps.lock = () => () => {}
  const rows = await CT.usage(h.deps)
  const text = CT.renderUsage(rows)
  assert.equal(typeof text, 'string', 'M4: renderUsage(rows) -> string')
  const lines = text.split('\n')
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop()
  assert.equal(lines[0], USAGE_HEADER, 'leg (d): the first line is exactly `account | 5h % | 5h resets | 7d % | 7d resets`')
  assert.equal(lines.length, rows.length + 1, 'leg (d): the header and then one line per row')
  rows.forEach((row, i) => {
    assert.ok(lines[i + 1].includes(row.name), `leg (d): the line for ${row.name} names it`)
  })
  const brokenLine = lines.find((l) => l.includes('broken'))
  assert.ok(brokenLine.includes('unread: '), 'leg (d): the `broken` line carries `unread: `')
  assert.match(brokenLine, /unread: .*500/, 'M4: an unread row prints `unread: <reason>` naming the status')
  const limitedLine = lines.find((l) => l.includes('limited'))
  assert.match(limitedLine, /unread: .*429/, 'M4: the 429 row prints `unread: <reason>` too')
  for (const secret of USAGE_SECRETS) {
    assert.ok(!text.includes(secret), `leg (d): no printed line contains ${secret}`)
  }
})

await leg('[M5 leg (e)] main routes refresh/status/usage with their flags', async () => {
  // `['refresh', '--account', 'b', '--no-install']` rotates `b` and issues no lobby verb.
  const rf = harness({ records: { b: { refreshToken: 'r-b', accessToken: 'access-b-old', expiresAt: T0 + 60_000 } } })
  const r = await main(['refresh', '--account', 'b', '--no-install'], rf.deps)
  assert.equal(r.refreshed, true, 'leg (e): `b` rotated')
  assert.ok(rf.calls.keychainReads.every((name) => name === 'b'))
  assert.deepEqual(rf.calls.keychainWrites.map((w) => w.name), ['b'])
  assert.deepEqual(JSON.parse(rf.stored('b')), { refreshToken: 'refresh-1', accessToken: 'access-1', expiresAt: T0 + 3600 * 1000 })
  assert.equal(rf.calls.lobby.length, 0, 'leg (e): --no-install issues no lobby verb')

  // `['status', '--account', 'b']` logs `b`'s expiry.
  const st = harness({ records: { b: { refreshToken: 'r-b', accessToken: 'access-b', expiresAt: T0 + 45 * 60_000 } } })
  const s = await main(['status', '--account', 'b'], st.deps)
  assert.deepEqual(s, { present: true, expiresAt: T0 + 45 * 60_000 })
  assert.ok(carries(st.calls.logs, iso(T0 + 45 * 60_000)), 'leg (e): status logs `b`\'s expiry')
  assert.ok(!carries(st.calls.logs, 'r-b') && !carries(st.calls.logs, 'access-b'), 'M1: and no token')

  // `['usage', '--json']` writes the rows as JSON.
  const u = harness({ records: { solo: { refreshToken: 'r-solo', accessToken: 'access-solo', expiresAt: T0 + 3600 * 1000 } } })
  const { out } = await captureStdout(() => main(['usage', '--json'], u.deps))
  const parsed = JSON.parse(out.trim())
  assert.equal(parsed.length, 1, 'leg (e): one row on stdout')
  assert.equal(parsed[0].name, 'solo')
  assert.deepEqual(parsed[0].fiveHour, FIVE_ROW, 'leg (e): the rows as JSON')
  assert.deepEqual(parsed[0].sevenDay, SEVEN_ROW, 'leg (e): the rows as JSON')
  assert.ok(!parsed[0].unread)
  assert.ok(!out.includes('access-solo') && !out.includes('r-solo'), 'M4: no output carries a token')
  assert.equal(u.calls.fetch.length, 0, 'leg (e): a fresh entry spends no refresh grant')

  // `['accounts']` and `['usage']` reach their verbs without --json too.
  const a = harness({ records: { solo: { refreshToken: 'r-solo', accessToken: 'access-solo', expiresAt: T0 + 3600 * 1000 } } })
  await captureStdout(() => main(['accounts'], a.deps))
  assert.equal(a.calls.keychainLists, 1, 'M5: `accounts` is routed')
})

await leg('[M5 leg (e)] an unknown verb rejects with the usage line naming the five verbs', async () => {
  await assert.rejects(() => main(['nonsense'], harness().deps), (e) => {
    assert.match(e.message, /^usage: node fleet\/claude-token\.mjs /, 'M5: the usage line')
    const routes = e.message.replace(/^usage: node fleet\/claude-token\.mjs /, '')
    for (const verb of ['login', 'refresh', 'status', 'accounts', 'usage']) {
      assert.ok(routes.includes(verb), `M5: the usage line names \`${verb}\``)
    }
    return true
  })
})

await leg('[M5 leg (e)] an absent or malformed --account value rejects before any keychain read, token request or lobby verb', async () => {
  for (const argv of [['refresh', '--account'], ['refresh', '--account', 'bad name'], ['refresh', '--account', '-nope']]) {
    const h = harness({ records: { b: { refreshToken: 'r-b', accessToken: 'access-b', expiresAt: T0 + 60_000 } } })
    await assert.rejects(
      () => main(argv, h.deps),
      (e) => e instanceof Error,
      `M5: ${JSON.stringify(argv)} rejects — the value is absent or outside ^[A-Za-z0-9][A-Za-z0-9._-]*$`
    )
    assert.equal(h.calls.keychainReads.length, 0, `leg (e): ${JSON.stringify(argv)} — zero keychain reads`)
    assert.equal(h.calls.keychainWrites.length, 0, `leg (e): ${JSON.stringify(argv)} — zero keychain writes`)
    assert.equal(h.calls.keychainLists, 0, `leg (e): ${JSON.stringify(argv)} — zero keychain lists`)
    assert.equal(h.calls.fetch.length, 0, `leg (e): ${JSON.stringify(argv)} — zero token requests`)
    assert.equal(h.calls.usage.length, 0, `leg (e): ${JSON.stringify(argv)} — zero usage requests`)
    assert.equal(h.calls.lobby.length, 0, `leg (e): ${JSON.stringify(argv)} — zero lobby calls`)
  }

  // A name that matches the pattern is accepted and reaches the keychain.
  const ok = harness({ records: { 'a.b-c_1': { refreshToken: 'r-x', accessToken: 'access-x', expiresAt: T0 + 90 * 60_000 } } })
  await main(['status', '--account', 'a.b-c_1'], ok.deps)
  assert.deepEqual(ok.calls.keychainReads, ['a.b-c_1'], 'M5: a name matching the pattern is accepted')
})

await leg('[header] the module\'s leading comment lists the five verbs', async () => {
  const fs = await import('node:fs')
  const src = fs.readFileSync(new URL('../claude-token.mjs', import.meta.url), 'utf8')
  const header = src.split('\n').slice(0, src.split('\n').findIndex((l) => /^import /.test(l))).join('\n')
  for (const verb of ['login', 'refresh', 'status', 'accounts', 'usage']) {
    assert.ok(
      new RegExp(`claude-token\\.mjs ${verb}\\b`).test(header),
      `the header comment lists \`node fleet/claude-token.mjs ${verb}\``
    )
  }
})

// [M5] the file ends by printing the leg count and the sentinel; a leg that
// threw never reaches here, so exit 0 and `ALL TESTS PASSED` travel together.
console.log(`${legs} legs`)
console.log('ALL TESTS PASSED')
