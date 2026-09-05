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
//
// Why this exists: exe.dev has no account-linked Claude integration (it has one
// for ChatGPT), the catalog `anthropic` object is API-key billing, and an
// http-proxy's bearer never refreshes on its own. So the laptop owns the OAuth
// dance and the refresh; exe.dev owns injection at the edge. The access token
// reaches exactly two places — the keychain and `integrations … --bearer -` on
// stdin — and the refresh token rotates on every refresh (a consumed copy is
// dead), so the keychain entry is rewritten each time.
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
export const KEYCHAIN = Object.freeze({ service: 'ultrapowers-claude-oauth', account: 'ultrapowers' })
export const LOCK_PATH = path.join(os.homedir(), '.ultrapowers', 'claude-token.lock')
export const LOCK_STALE_MS = 2 * 60 * 1000
export const REFRESH_AHEAD_MS = 30 * 60 * 1000
// `login --code-from-clipboard` reads the clipboard every POLL and gives up after WAIT.
export const CLIPBOARD_POLL_MS = 2 * 1000
export const CLIPBOARD_WAIT_MS = 10 * 60 * 1000

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
    keychainRead: () => {
      const r = spawnSync('security', ['find-generic-password', '-a', KEYCHAIN.account, '-s', KEYCHAIN.service, '-w'], { encoding: 'utf8' })
      return r.status === 0 ? r.stdout.trim() : null
    },
    // `-U` updates in place; the value rides argv for the life of one short
    // process, which is the trade for not writing a file.
    keychainWrite: (value) => spawnSync('security', ['add-generic-password', '-U', '-a', KEYCHAIN.account, '-s', KEYCHAIN.service, '-w', value], { stdio: 'ignore' }).status === 0,
    // The lobby verb runs with the secret on STDIN (`--bearer -`), never in argv.
    lobby: (verb, input) => {
      const r = spawnSync('ssh', ['exe.dev', verb], { encoding: 'utf8', input })
      return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
    },
    log: (line) => process.stderr.write(`${line}\n`),
    // Single-flight across processes: two launches inside the 30-minute window
    // would both refresh, and the second would spend a refresh token the first
    // had already rotated away. The lock is a directory (mkdir is atomic on every
    // filesystem); a lock older than LOCK_STALE_MS belongs to a dead process.
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
// flags Claude Code sends.
export function installBearer (deps, accessToken) {
  const verb = integrationExists(deps)
    ? `integrations edit ${INTEGRATION} --bearer -`
    : `integrations add http-proxy --name ${INTEGRATION} --target ${TARGET} --bearer -`
  const r = deps.lobby(verb, accessToken)
  if (r.code !== 0) throw new Error(`exe.dev ${verb.split(' --')[0]} failed (exit ${r.code}):\n${r.out}`)
  return verb.startsWith('integrations add') ? 'added' : 'edited'
}

// ---- keychain record ----------------------------------------------------------

export function readRecord (deps) {
  const raw = deps.keychainRead()
  if (!raw) return null
  try {
    const rec = JSON.parse(raw)
    if (typeof rec.refreshToken === 'string' && typeof rec.expiresAt === 'number') return rec
  } catch {}
  return null
}

export function writeRecord (deps, rec) {
  if (!deps.keychainWrite(JSON.stringify({ refreshToken: rec.refreshToken, expiresAt: rec.expiresAt }))) {
    throw new Error('keychain write failed (security add-generic-password)')
  }
}

const iso = (ms) => new Date(ms).toISOString()

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

export async function login (deps, { codeFromClipboard = false } = {}) {
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
  writeRecord(deps, tokens)
  const how = installBearer(deps, tokens.accessToken)
  deps.log(`${INTEGRATION}: bearer ${how}; access token fresh until ${iso(tokens.expiresAt)}; refresh token in the keychain.`)
  return { expiresAt: tokens.expiresAt, how }
}

export async function refresh (deps, { force = false } = {}) {
  // The record is read AFTER the lock is held: a launch that queued behind a
  // sibling's refresh sees the rotated pair and finds nothing to do.
  const release = deps.lock ? deps.lock() : () => {}
  try {
    const rec = readRecord(deps)
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
    writeRecord(deps, tokens)
    installBearer(deps, tokens.accessToken)
    deps.log(`${INTEGRATION}: refreshed; fresh until ${iso(tokens.expiresAt)}`)
    return { refreshed: true, expiresAt: tokens.expiresAt }
  } finally {
    release()
  }
}

export function status (deps) {
  const rec = readRecord(deps)
  if (!rec) { deps.log('no record in the keychain'); return { present: false } }
  deps.log(`access token expires ${iso(rec.expiresAt)} (${Math.round((rec.expiresAt - deps.now()) / 60000)} min)`)
  return { present: true, expiresAt: rec.expiresAt }
}

export async function main (argv, deps = defaultDeps()) {
  const [verb, ...rest] = argv
  if (verb === 'login') return login(deps, { codeFromClipboard: rest.includes('--code-from-clipboard') })
  if (verb === 'refresh') return refresh(deps, { force: rest.includes('--force') })
  if (verb === 'status') return status(deps)
  throw new Error('usage: node fleet/claude-token.mjs login [--code-from-clipboard] | refresh [--force] | status')
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main(process.argv.slice(2)).then(() => process.exit(0), (err) => {
    process.stderr.write(`${err.message}\n`)
    process.exit(1)
  })
}
