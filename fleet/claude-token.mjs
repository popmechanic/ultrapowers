#!/usr/bin/env node
// The Claude Max credential for the fleet, the loom way.
//
//   node fleet/claude-token.mjs login     browser consent → code from the clipboard →
//                                         tokens → the edge proxy; nothing printed
//   node fleet/claude-token.mjs login --code-from-clipboard
//                                         the same, with no question at the terminal:
//                                         the process polls the clipboard until the
//                                         copied `code#state` carries THIS login's state
//   node fleet/claude-token.mjs refresh   rotate before a run when < 30 min remain
//   node fleet/claude-token.mjs status    when the current access token expires
//   node fleet/claude-token.mjs accounts  every account the keychain holds, and whether
//                                         its access token is still fresh (`--json`)
//   node fleet/claude-token.mjs usage     one `/api/oauth/usage` read per account, as one
//                                         table (`--json`)
//
// The keychain holds ONE ITEM PER ACCOUNT: service `ultrapowers-claude-oauth`,
// account `<name>`, which is `ultrapowers` (DEFAULT_ACCOUNT) when no `--account`
// is given. `login`, `refresh` and `status` take `--account <name>`; `accounts`
// enumerates the items under the service and `usage` meters each one.
//
// Why this exists: exe.dev has no account-linked Claude integration (it has one
// for ChatGPT), the catalog `anthropic` object is API-key billing, and an
// http-proxy's bearer never refreshes on its own. So the laptop owns the OAuth
// dance and the refresh; exe.dev owns injection at the edge. The access token
// reaches exactly two places — the keychain and `integrations … --bearer -` on
// stdin — and the refresh token rotates on every refresh (a consumed copy is
// dead), so the keychain entry is rewritten each time.
//
// The record grew an `accessToken` so `usage` can meter a fresh account without
// spending a refresh grant. Metering never installs: the edge carries the
// account a launch chose, and installing a second account's bearer to read its
// usage would switch every live sandbox to that account mid-run (the prompt
// cache is per account). So rotation and installation are separate — `refresh`
// installs unless `--no-install`, and `usage` rotates with `install: false`.
//
// The flow, constants and request shapes are popmechanic/loom's
// (skills/loom/references/oauth-reference.md), measured there against claude.ai.

import { createHash, randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'

export const OAUTH = Object.freeze({
  clientId: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
  authorizeUrl: 'https://claude.ai/oauth/authorize',
  tokenUrl: 'https://platform.claude.com/v1/oauth/token',
  redirectUri: 'https://platform.claude.com/oauth/code/callback',
  scopes: 'user:profile user:inference user:sessions:claude_code user:mcp_servers'
})

export const INTEGRATION = 'claude-max'
export const TARGET = 'https://api.anthropic.com'
export const DEFAULT_ACCOUNT = 'ultrapowers'
export const KEYCHAIN = Object.freeze({ service: 'ultrapowers-claude-oauth', account: DEFAULT_ACCOUNT })
export const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
export const LOCK_PATH = path.join(os.homedir(), '.ultrapowers', 'claude-token.lock')
export const LOCK_STALE_MS = 2 * 60 * 1000
export const REFRESH_AHEAD_MS = 30 * 60 * 1000
// `login --code-from-clipboard` reads the clipboard every POLL and gives up after WAIT.
export const CLIPBOARD_POLL_MS = 2 * 1000
export const CLIPBOARD_WAIT_MS = 10 * 60 * 1000

// An account name is the keychain item's `acct` and rides `--comment account=`
// into a lobby verb, so it is checked before anything else happens.
const ACCOUNT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

export function pkce (random = randomBytes) {
  const verifier = b64url(random(32))
  const challenge = b64url(createHash('sha256').update(verifier).digest())
  const state = random(32).toString('hex')
  return { verifier, challenge, state }
}

export function authorizeUrlFor ({ challenge, state }) {
  const q = new URLSearchParams({
    client_id: OAUTH.clientId,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    redirect_uri: OAUTH.redirectUri,
    scope: OAUTH.scopes,
    state,
    response_type: 'code'
  })
  return `${OAUTH.authorizeUrl}?${q}`
}

// The callback page shows `code#state`; the fragment is not part of the code.
export const cleanCode = (pasted) => String(pasted).trim().split('#')[0].trim()

// Matching on the state is what makes polling safe: nothing already on the
// clipboard can carry a state minted milliseconds ago, and neither can a code
// from someone else's flow — so the poll never exchanges a stray value. A value
// with no `#`, or with a different state, answers null and is skipped.
// A value with more than one # is rejected on the same ground: a code#state#extra
// is not this login's code#state. Skipping it is the safe failure — the poll
// waits on until a matching value appears or CLIPBOARD_WAIT_MS elapses, where
// exchanging a value we cannot vouch for would spend the login on a stray code.
// `cleanCode` keeps the looser first-`#` split, and that difference is deliberate.
export function codeForState (pasted, state) {
  const [code, fragment, ...rest] = String(pasted).trim().split('#')
  if (rest.length || fragment === undefined) return null
  if (fragment.trim() !== state) return null
  const clean = code.trim()
  return clean || null
}

// `security dump-keychain` (no `-d`, so no secret is dumped) answers a sequence
// of items, each opened by a `class: "genp"` line and carrying attribute lines
// like `    "acct"<blob>="ultrapowers"` and `    "svce"<blob>="…"`; the `svce`
// line may follow the `acct` line, so an item is only judged when it ends.
export function parseKeychainDump (out, service = KEYCHAIN.service) {
  const names = []
  let acct = null
  let svce = null
  const close = () => {
    if (acct && svce === service && !names.includes(acct)) names.push(acct)
    acct = null
    svce = null
  }
  for (const line of String(out ?? '').split('\n')) {
    if (/^class:/.test(line)) { close(); continue }
    const m = /^\s*"(acct|svce)"<blob>="(.*)"\s*$/.exec(line)
    if (!m) continue
    if (m[1] === 'acct') acct = m[2]
    else svce = m[2]
  }
  close()
  return names
}

// ---- seams: everything that touches the world goes through `deps` ------------

export function defaultDeps () {
  return {
    fetch: globalThis.fetch,
    now: () => Date.now(),
    random: randomBytes,
    open: (url) => spawnSync('open', [url], { stdio: 'ignore' }).status === 0,
    clipboard: () => {
      const r = spawnSync('pbpaste', [], { encoding: 'utf8' })
      return r.status === 0 ? r.stdout : ''
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    prompt: async (question) => {
      const rl = readline.createInterface({ input: process.stdin, output: process.stderr })
      const answer = await new Promise((resolve) => rl.question(question, resolve))
      rl.close()
      return answer
    },
    keychainRead: (name) => {
      const r = spawnSync('security', ['find-generic-password', '-a', name, '-s', KEYCHAIN.service, '-w'], { encoding: 'utf8' })
      return r.status === 0 ? r.stdout.trim() : null
    },
    // `-U` updates in place; the value rides argv for the life of one short
    // process, which is the trade for not writing a file.
    keychainWrite: (name, value) => spawnSync('security', ['add-generic-password', '-U', '-a', name, '-s', KEYCHAIN.service, '-w', value], { stdio: 'ignore' }).status === 0,
    // The accounts under the service, from the attribute dump — never `-d`, so
    // the dump carries names and no secrets.
    keychainList: () => {
      const r = spawnSync('security', ['dump-keychain'], { encoding: 'utf8' })
      return r.status === 0 ? parseKeychainDump(r.stdout) : []
    },
    // The lobby verb runs with the secret on STDIN (`--bearer -`), never in argv.
    lobby: (verb, input) => {
      const r = spawnSync('ssh', ['exe.dev', verb], { encoding: 'utf8', input })
      return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
    },
    log: (line) => process.stderr.write(`${line}\n`),
    // The tables go to stdout so a reader can parse them; every human line goes
    // to stderr through `log`.
    stdout: (text) => process.stdout.write(text),
    // Single-flight across processes: two launches inside the 30-minute window
    // would both refresh, and the second would spend a refresh token the first
    // had already rotated away. The lock is a directory (mkdir is atomic on every
    // filesystem); a lock older than LOCK_STALE_MS belongs to a dead process.
    // One lock for every account: two accounts rotating at once serialize, which
    // is fine, and the single-flight legs stay true.
    lock: () => {
      fs.mkdirSync(path.dirname(LOCK_PATH), { recursive: true })
      const deadline = Date.now() + LOCK_STALE_MS
      for (;;) {
        try { fs.mkdirSync(LOCK_PATH); break } catch (err) {
          if (err.code !== 'EEXIST') throw err
          let age = 0
          try { age = Date.now() - fs.statSync(LOCK_PATH).mtimeMs } catch { continue }
          if (age > LOCK_STALE_MS) { try { fs.rmdirSync(LOCK_PATH) } catch {} ; continue }
          if (Date.now() > deadline) throw new Error(`claude-token: lock ${LOCK_PATH} held for over ${LOCK_STALE_MS / 1000}s`)
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200)
        }
      }
      return () => { try { fs.rmdirSync(LOCK_PATH) } catch {} }
    }
  }
}

// ---- the token endpoint -------------------------------------------------------

async function tokenRequest (deps, body) {
  const resp = await deps.fetch(OAUTH.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`token endpoint answered ${resp.status}: ${text.slice(0, 300)}`)
  }
  const tokens = await resp.json()
  if (!tokens.access_token || !tokens.refresh_token || !tokens.expires_in) {
    throw new Error('token endpoint answered without access_token/refresh_token/expires_in')
  }
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: deps.now() + tokens.expires_in * 1000
  }
}

export const exchange = (deps, { code, verifier, state }) => tokenRequest(deps, {
  grant_type: 'authorization_code',
  code,
  redirect_uri: OAUTH.redirectUri,
  client_id: OAUTH.clientId,
  code_verifier: verifier,
  state
})

export const refreshGrant = (deps, refreshToken) => tokenRequest(deps, {
  grant_type: 'refresh_token',
  refresh_token: refreshToken,
  client_id: OAUTH.clientId,
  scope: OAUTH.scopes
})

// ---- the edge ---------------------------------------------------------------

export function integrationExists (deps) {
  const r = deps.lobby('integrations list --json')
  if (r.code !== 0) throw new Error(`exe.dev integrations list failed (exit ${r.code}):\n${r.out}`)
  let payload
  try { payload = JSON.parse(r.out) } catch { throw new Error(`integrations list --json was not JSON:\n${r.out.slice(0, 300)}`) }
  const rows = Array.isArray(payload) ? payload : Object.values(payload).find(Array.isArray) ?? []
  return rows.some((row) => row?.name === INTEGRATION)
}

// Add or edit — either way the bearer arrives on stdin and is the ONLY header
// the proxy injects: an injected header replaces the client's same-named one
// (measured 2026-09-03), so an injected anthropic-beta list would destroy the
// flags Claude Code sends. `--comment account=<name>` is the one thing in the
// verb that names the account, and it is what lets the doctor say which account
// the edge carries; the token still rides stdin.
export function installBearer (deps, accessToken, account = DEFAULT_ACCOUNT) {
  const comment = `--comment account=${account}`
  const verb = integrationExists(deps)
    ? `integrations edit ${INTEGRATION} --bearer - ${comment}`
    : `integrations add http-proxy --name ${INTEGRATION} --target ${TARGET} --bearer - ${comment}`
  const r = deps.lobby(verb, accessToken)
  if (r.code !== 0) throw new Error(`exe.dev ${verb.split(' --')[0]} failed (exit ${r.code}):\n${r.out}`)
  return verb.startsWith('integrations add') ? 'added' : 'edited'
}

// ---- keychain record ----------------------------------------------------------

export function readRecord (deps, account = DEFAULT_ACCOUNT) {
  const raw = deps.keychainRead(account)
  if (!raw) return null
  try {
    const rec = JSON.parse(raw)
    if (typeof rec.refreshToken === 'string' && typeof rec.expiresAt === 'number') return rec
  } catch {}
  return null
}

export function writeRecord (deps, rec, account = DEFAULT_ACCOUNT) {
  const value = JSON.stringify({ refreshToken: rec.refreshToken, accessToken: rec.accessToken, expiresAt: rec.expiresAt })
  if (!deps.keychainWrite(account, value)) {
    throw new Error('keychain write failed (security add-generic-password)')
  }
}

const iso = (ms) => new Date(ms).toISOString()
const minutes = (ms) => Math.round(ms / 60000)

// ---- verbs ----------------------------------------------------------------

// The chat-driven wait: the agent runs this from a Bash tool that has no
// interactive stdin, so nobody can press Enter. The process polls the clipboard
// itself and only exchanges a value whose `#state` is this login's, which is why
// waiting is safe — see `codeForState`. Returns the clean code.
async function pollClipboardForCode (deps, state) {
  const deadline = deps.now() + CLIPBOARD_WAIT_MS
  for (;;) {
    const code = codeForState(deps.clipboard(), state)
    if (code) return code
    if (deps.now() >= deadline) {
      throw new Error(`--code-from-clipboard: no code for this login appeared on the clipboard within ${CLIPBOARD_WAIT_MS / 60000} minutes — copy the code from the callback page and run login again`)
    }
    await deps.sleep(CLIPBOARD_POLL_MS)
  }
}

export async function login (deps, { codeFromClipboard = false, account = DEFAULT_ACCOUNT, install = true } = {}) {
  const p = pkce(deps.random)
  const url = authorizeUrlFor(p)
  deps.log('Opening claude.ai to authorize the fleet. Approve, then copy the code it shows.')
  if (!deps.open(url) || codeFromClipboard) deps.log(`Open this URL yourself:\n${url}`)
  let code
  if (codeFromClipboard) {
    deps.log('Waiting for the code on the clipboard — approve in the browser and copy it.')
    code = await pollClipboardForCode(deps, p.state)
  } else {
    await deps.prompt('When the code is on your clipboard, press Enter… ')
    code = cleanCode(deps.clipboard())
    if (!code) throw new Error('the clipboard holds no code — copy it from the callback page and run login again')
  }
  const tokens = await exchange(deps, { code, verifier: p.verifier, state: p.state })
  writeRecord(deps, tokens, account)
  // `--no-install` adds an account without moving the edge: the keychain grows
  // an item and no lobby verb is issued at all.
  const how = install ? installBearer(deps, tokens.accessToken, account) : null
  deps.log(how
    ? `${INTEGRATION}: bearer ${how} for ${account}; access token fresh until ${iso(tokens.expiresAt)}; refresh token in the keychain.`
    : `${account}: access token fresh until ${iso(tokens.expiresAt)}; refresh token in the keychain; the edge was not touched (--no-install).`)
  return { expiresAt: tokens.expiresAt, how }
}

export async function refresh (deps, { force = false, account = DEFAULT_ACCOUNT, install = true } = {}) {
  // The record is read AFTER the lock is held: a launch that queued behind a
  // sibling's refresh sees the rotated pair and finds nothing to do.
  const release = deps.lock ? deps.lock() : () => {}
  try {
    const rec = readRecord(deps, account)
    if (!rec) throw new Error('no refresh token in the keychain — run `node fleet/claude-token.mjs login` first')
    const remaining = rec.expiresAt - deps.now()
    if (!force && remaining > REFRESH_AHEAD_MS) {
      deps.log(`${INTEGRATION}: access token fresh until ${iso(rec.expiresAt)} — nothing to do`)
      return { refreshed: false, expiresAt: rec.expiresAt }
    }
    const tokens = await refreshGrant(deps, rec.refreshToken)
    // The rotated pair replaces the old one BEFORE the edge is touched: a consumed
    // refresh token is dead, so a crash between the two steps must not leave the
    // keychain holding it.
    writeRecord(deps, tokens, account)
    if (install) installBearer(deps, tokens.accessToken, account)
    deps.log(`${INTEGRATION}: refreshed ${account}; fresh until ${iso(tokens.expiresAt)}`)
    return { refreshed: true, expiresAt: tokens.expiresAt }
  } finally {
    release()
  }
}

export function status (deps, { account = DEFAULT_ACCOUNT } = {}) {
  const rec = readRecord(deps, account)
  if (!rec) { deps.log(`${account}: no record in the keychain`); return { present: false } }
  deps.log(`${account}: access token expires ${iso(rec.expiresAt)} (${minutes(rec.expiresAt - deps.now())} min)`)
  return { present: true, expiresAt: rec.expiresAt }
}

// One entry per keychain item under the service. Synchronous over the seams: a
// list, then one read each. A name whose record does not parse is skipped.
export function accounts (deps) {
  const rows = []
  for (const name of deps.keychainList() ?? []) {
    const rec = readRecord(deps, name)
    if (!rec) continue
    rows.push({ name, expiresAt: iso(rec.expiresAt), fresh: rec.expiresAt > deps.now() })
  }
  return rows
}

// One row per entry. An entry whose record already holds an unexpired access
// token is read with it; any other is rotated first — under the lock, one grant,
// and never installed at the edge (see the header).
async function usageRow (deps, name) {
  const unread = (reason) => ({ name, fiveHour: null, sevenDay: null, unread: true, reason })
  const rec = readRecord(deps, name)
  let accessToken = rec?.accessToken && rec.expiresAt > deps.now() ? rec.accessToken : null
  if (!accessToken) {
    try {
      await refresh(deps, { force: true, account: name, install: false })
    } catch (err) {
      return unread(err.message)
    }
    accessToken = readRecord(deps, name)?.accessToken
    if (!accessToken) return unread('the keychain holds no access token after the refresh')
  }
  let resp
  try {
    resp = await deps.fetch(USAGE_URL, { method: 'GET', headers: { Authorization: `Bearer ${accessToken}` } })
  } catch (err) {
    return unread(`usage request failed: ${err.message}`)
  }
  const code = resp?.status ?? (resp?.ok ? 200 : 0)
  if (code !== 200) return unread(`usage answered ${code}`)
  let body
  try { body = await resp.json() } catch (err) { return unread(`usage answered unreadable JSON: ${err.message}`) }
  const window = (w) => (w && typeof w === 'object' ? { utilization: w.utilization, resetsAt: w.resets_at } : null)
  const fiveHour = window(body?.five_hour)
  const sevenDay = window(body?.seven_day)
  if (!fiveHour || !sevenDay) return unread('usage answered without five_hour/seven_day')
  return { name, fiveHour, sevenDay, unread: false, reason: null }
}

export async function usage (deps) {
  const rows = []
  // Serial, not parallel: the rotation legs share one lock, and a row that
  // cannot be read is still answered, so no failure takes the table down.
  for (const name of deps.keychainList() ?? []) rows.push(await usageRow(deps, name))
  return rows
}

const USAGE_HEADER = 'account | 5h % | 5h resets | 7d % | 7d resets'

export function renderUsage (rows) {
  const lines = [USAGE_HEADER]
  for (const row of rows ?? []) {
    const cells = row.unread
      ? [row.name, `unread: ${row.reason}`, '', '', '']
      : [row.name, `${row.fiveHour?.utilization}`, `${row.fiveHour?.resetsAt}`, `${row.sevenDay?.utilization}`, `${row.sevenDay?.resetsAt}`]
    lines.push(cells.join(' | ').replace(/[\s|]+$/, ''))
  }
  return lines.join('\n')
}

// ---- the command line ---------------------------------------------------------

const VERBS = ['login', 'refresh', 'status', 'accounts', 'usage']
const USAGE_LINE = 'usage: node fleet/claude-token.mjs login [--code-from-clipboard] [--account <name>] [--no-install] | refresh [--force] [--account <name>] [--no-install] | status [--account <name>] | accounts [--json] | usage [--json]'

// `--account` takes the token after the flag; the rest are bare. Every value is
// checked here, which is before any keychain read, token request or lobby verb.
function parseArgs (rest) {
  const opts = { account: DEFAULT_ACCOUNT, install: true, force: false, codeFromClipboard: false, json: false }
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i]
    if (arg === '--account') {
      const value = rest[i + 1]
      i += 1
      if (value === undefined) throw new Error('--account needs a name: --account <name>')
      if (!ACCOUNT_RE.test(value)) throw new Error(`--account ${JSON.stringify(value)} is not a name matching ${ACCOUNT_RE.source}`)
      opts.account = value
    } else if (arg === '--no-install') opts.install = false
    else if (arg === '--force') opts.force = true
    else if (arg === '--code-from-clipboard') opts.codeFromClipboard = true
    else if (arg === '--json') opts.json = true
    else throw new Error(USAGE_LINE)
  }
  return opts
}

export async function main (argv, deps = defaultDeps()) {
  const [verb, ...rest] = argv
  if (!VERBS.includes(verb)) throw new Error(USAGE_LINE)
  const opts = parseArgs(rest)
  const write = (text) => (deps.stdout ? deps.stdout(text) : process.stdout.write(text))
  if (verb === 'login') return login(deps, { codeFromClipboard: opts.codeFromClipboard, account: opts.account, install: opts.install })
  if (verb === 'refresh') return refresh(deps, { force: opts.force, account: opts.account, install: opts.install })
  if (verb === 'status') return status(deps, { account: opts.account })
  if (verb === 'accounts') {
    const rows = accounts(deps)
    if (opts.json) write(`${JSON.stringify(rows)}\n`)
    else for (const row of rows) deps.log(`${row.name} expires ${row.expiresAt} (${minutes(Date.parse(row.expiresAt) - deps.now())} min)`)
    return rows
  }
  const rows = await usage(deps)
  write(opts.json ? `${JSON.stringify(rows)}\n` : `${renderUsage(rows)}\n`)
  return rows
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main(process.argv.slice(2)).then(() => process.exit(0), (err) => {
    process.stderr.write(`${err.message}\n`)
    process.exit(1)
  })
}
