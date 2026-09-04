// The Claude Max credential tool: every seam stubbed, no network, no keychain.
import assert from 'node:assert/strict'
import {
  OAUTH, INTEGRATION, REFRESH_AHEAD_MS, pkce, authorizeUrlFor, cleanCode,
  login, refresh, status, installBearer
} from '../claude-token.mjs'

const T0 = 1_800_000_000_000

function harness ({ hasIntegration = true, record = null, clipboard = 'CODE-123#state-xyz', tokenStatus = 200, expiresIn = 3600 } = {}) {
  const calls = { fetch: [], lobby: [], keychain: [], opened: [], logs: [] }
  let stored = record ? JSON.stringify(record) : null
  let n = 0
  const deps = {
    now: () => T0,
    random: (len) => Buffer.alloc(len, 7),
    open: (url) => { calls.opened.push(url); return true },
    clipboard: () => clipboard,
    prompt: async () => '',
    keychainRead: () => stored,
    keychainWrite: (value) => { calls.keychain.push(value); stored = value; return true },
    lobby: (verb, input) => {
      calls.lobby.push({ verb, input })
      if (verb.startsWith('integrations list')) {
        return { code: 0, out: JSON.stringify({ integrations: hasIntegration ? [{ name: INTEGRATION }] : [] }) }
      }
      return { code: 0, out: 'Updated integration\n' }
    },
    fetch: async (url, init) => {
      n += 1
      calls.fetch.push({ url, body: JSON.parse(init.body) })
      const ok = tokenStatus === 200
      return {
        ok,
        status: tokenStatus,
        text: async () => 'nope',
        json: async () => ({ access_token: `access-${n}`, refresh_token: `refresh-${n}`, expires_in: expiresIn })
      }
    },
    log: (line) => calls.logs.push(line)
  }
  return { deps, calls, stored: () => stored }
}

let legs = 0
const leg = (name, fn) => Promise.resolve().then(fn).then(() => { legs += 1; console.log(`ok - ${name}`) })

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

await leg('login: opens the browser, exchanges the clipboard code with the verifier, stores the pair, edits the proxy with the bearer on stdin', async () => {
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
  assert.deepEqual(JSON.parse(h.stored()), { refreshToken: 'refresh-1', expiresAt: T0 + 3600 * 1000 })
  const edit = h.calls.lobby.find((c) => c.verb.startsWith('integrations edit'))
  assert.equal(edit.verb, `integrations edit ${INTEGRATION} --bearer -`)
  assert.equal(edit.input, 'access-1', 'the access token rides stdin, never argv')
  assert.ok(!h.calls.lobby.some((c) => c.verb.includes('access-1')), 'no verb carries the token')
  assert.ok(!h.calls.logs.some((l) => l.includes('access-1') || l.includes('refresh-1')), 'nothing printed carries a token')
  assert.equal(r.how, 'edited')
})

await leg('login with no integration yet: adds the http-proxy with the bearer only — no headers', async () => {
  const h = harness({ hasIntegration: false })
  const r = await login(h.deps)
  const add = h.calls.lobby.find((c) => c.verb.startsWith('integrations add'))
  assert.equal(add.verb, `integrations add http-proxy --name ${INTEGRATION} --target https://api.anthropic.com --bearer -`)
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
  const h = harness({ record: { refreshToken: 'r0', expiresAt: T0 + REFRESH_AHEAD_MS + 60_000 } })
  const r = await refresh(h.deps)
  assert.equal(r.refreshed, false)
  assert.equal(h.calls.fetch.length, 0)
  assert.equal(h.calls.lobby.length, 0)
})

await leg('refresh: inside 30 min → rotate, store the NEW pair before the edge, then edit', async () => {
  const h = harness({ record: { refreshToken: 'r0', expiresAt: T0 + 60_000 } })
  const order = []
  const origWrite = h.deps.keychainWrite; h.deps.keychainWrite = (v) => { order.push('keychain'); return origWrite(v) }
  const origLobby = h.deps.lobby; h.deps.lobby = (verb, input) => { if (verb.startsWith('integrations edit')) order.push('edge'); return origLobby(verb, input) }
  const r = await refresh(h.deps)
  assert.equal(r.refreshed, true)
  assert.equal(h.calls.fetch[0].body.grant_type, 'refresh_token')
  assert.equal(h.calls.fetch[0].body.refresh_token, 'r0')
  assert.equal(h.calls.fetch[0].body.scope, OAUTH.scopes)
  assert.deepEqual(JSON.parse(h.stored()), { refreshToken: 'refresh-1', expiresAt: T0 + 3600 * 1000 }, 'the rotated refresh token replaces the consumed one')
  assert.deepEqual(order, ['keychain', 'edge'])
})

await leg('refresh --force rotates even when fresh', async () => {
  const h = harness({ record: { refreshToken: 'r0', expiresAt: T0 + 10 * REFRESH_AHEAD_MS } })
  const r = await refresh(h.deps, { force: true })
  assert.equal(r.refreshed, true)
})

await leg('refresh with no record names the login verb', async () => {
  const h = harness({ record: null })
  await assert.rejects(() => refresh(h.deps), /run `node fleet\/claude-token.mjs login` first/)
})

await leg('status reports the expiry without a token', () => {
  const h = harness({ record: { refreshToken: 'SECRET', expiresAt: T0 + 90 * 60_000 } })
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
  assert.throws(() => installBearer(h.deps, 'access-9'), (e) => /quota exceeded/.test(e.message) && !/access-9/.test(e.message))
})

console.log(`${legs} legs`)
console.log('ALL TESTS PASSED')
