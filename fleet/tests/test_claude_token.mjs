// The Claude Max credential tool: every seam stubbed, no network, no keychain.
import assert from 'node:assert/strict'
import * as CT from '../claude-token.mjs'
import {
  OAUTH, INTEGRATION, REFRESH_AHEAD_MS, pkce, authorizeUrlFor, cleanCode, codeForState,
  login, refresh, status, installBearer, main
} from '../claude-token.mjs'

const T0 = 1_800_000_000_000

// The harness clock only moves when `advanceOnSleep` is set, so every
// pre-existing leg still sees a frozen `now()` of exactly T0.
function harness ({ hasIntegration = true, record = null, clipboard = 'CODE-123#state-xyz', clipboardSeq = null, advanceOnSleep = 0, tokenStatus = 200, expiresIn = 3600 } = {}) {
  const calls = { fetch: [], lobby: [], keychain: [], opened: [], logs: [], prompts: [], sleeps: [], clipboard: [], trace: [] }
  let stored = record ? JSON.stringify(record) : null
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
    keychainRead: () => stored,
    keychainWrite: (value) => { calls.keychain.push(value); calls.trace.push('keychain'); stored = value; return true },
    lobby: (verb, input) => {
      calls.lobby.push({ verb, input })
      calls.trace.push(`lobby:${verb.split(' ')[1]}`)
      if (verb.startsWith('integrations list')) {
        return { code: 0, out: JSON.stringify({ integrations: hasIntegration ? [{ name: INTEGRATION }] : [] }) }
      }
      return { code: 0, out: 'Updated integration\n' }
    },
    fetch: async (url, init) => {
      n += 1
      calls.fetch.push({ url, body: JSON.parse(init.body) })
      calls.trace.push('fetch')
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

await leg('refresh is single-flight: the record is read under the lock, so a queued sibling finds the rotated pair and does nothing', async () => {
  const h = harness({ record: { refreshToken: 'r0', expiresAt: T0 + 60_000 } })
  let held = 0; const trace = []
  h.deps.lock = () => { held += 1; trace.push('lock'); return () => { held -= 1; trace.push('unlock') } }
  const origRead = h.deps.keychainRead
  h.deps.keychainRead = () => { assert.equal(held, 1, 'the record is read only while the lock is held'); return origRead() }
  const first = await refresh(h.deps)
  const second = await refresh(h.deps)
  assert.equal(first.refreshed, true)
  assert.equal(second.refreshed, false, 'the sibling sees the rotated pair (fresh for 60 min) and does nothing')
  assert.equal(h.calls.fetch.length, 1, 'one refresh grant, not two')
  assert.deepEqual(trace, ['lock', 'unlock', 'lock', 'unlock'])
  assert.equal(held, 0)
})

await leg('the lock is released when the refresh throws', async () => {
  const h = harness({ record: { refreshToken: 'r0', expiresAt: T0 + 60_000 }, tokenStatus: 500 })
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
  fs.writeFileSync(rec, JSON.stringify({ refreshToken: 'r0', expiresAt: Date.now() + 60_000 }))
  const script = `
    import { refresh, defaultDeps } from ${JSON.stringify(new URL('../claude-token.mjs', import.meta.url).href)}
    import fs from 'node:fs'
    const deps = defaultDeps()
    deps.keychainRead = () => fs.readFileSync(${JSON.stringify(rec)}, 'utf8')
    deps.keychainWrite = (v) => { fs.writeFileSync(${JSON.stringify(rec)}, v); return true }
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
  assert.deepEqual(JSON.parse(h.calls.keychain[0]), { refreshToken: 'refresh-1', expiresAt: T0 + 3600 * 1000 })

  // leg (a): one `integrations … --bearer -` lobby call with `access-1` on stdin.
  const bearer = h.calls.lobby.filter((c) => c.verb.includes('--bearer -'))
  assert.equal(bearer.length, 1, 'leg (a): one bearer install')
  assert.equal(bearer[0].verb, `integrations edit ${INTEGRATION} --bearer -`)
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
  const fresh = harness({ record: { refreshToken: 'r0', expiresAt: T0 + REFRESH_AHEAD_MS + 60_000 } })
  assert.deepEqual(await main(['refresh'], fresh.deps), { refreshed: false, expiresAt: T0 + REFRESH_AHEAD_MS + 60_000 })
  assert.equal(fresh.calls.fetch.length, 0)

  const forced = harness({ record: { refreshToken: 'r0', expiresAt: T0 + 10 * REFRESH_AHEAD_MS } })
  assert.deepEqual(await main(['refresh', '--force'], forced.deps), { refreshed: true, expiresAt: T0 + 3600 * 1000 })
  assert.equal(forced.calls.fetch[0].body.grant_type, 'refresh_token')

  const st = harness({ record: { refreshToken: 'SECRET', expiresAt: T0 + 90 * 60_000 } })
  assert.deepEqual(await main(['status'], st.deps), { present: true, expiresAt: T0 + 90 * 60_000 })
  assert.ok(!st.calls.logs.some((l) => l.includes('SECRET')))

  await assert.rejects(() => main(['nonsense'], harness().deps), /usage: node fleet\/claude-token.mjs login/)
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

await leg('[global constraint] the credential tool\'s code is unchanged: with every whole-line // comment removed, fleet/claude-token.mjs hashes as it did at BASE', async () => {
  const fs = await import('node:fs')
  const { createHash } = await import('node:crypto')
  const src = fs.readFileSync(new URL('../claude-token.mjs', import.meta.url), 'utf8')
  const stripped = src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')
  assert.equal(
    createHash('sha256').update(stripped).digest('hex'),
    'f045d77ba90bc38229bed200dd69d4eea0e45bc42e69ac200a38a8c30b4f3a1c',
    'the comment is added as whole lines beginning `//` and nothing else moves: any change to a code line, or a comment written as a trailing comment on one, breaks this'
  )
})

// [M5] the file ends by printing the leg count and the sentinel; a leg that
// threw never reaches here, so exit 0 and `ALL TESTS PASSED` travel together.
console.log(`${legs} legs`)
console.log('ALL TESTS PASSED')
