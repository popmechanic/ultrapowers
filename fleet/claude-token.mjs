#!/usr/bin/env node

import { createHash, randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'

import { CLAUDE_INTEGRATION as INTEGRATION, EXE_HOST, FLEET_PATTERN, parseArgs as parseFlags, runCli } from './lobby.mjs'

const OAUTH = Object.freeze({
  clientId: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
  authorizeUrl: 'https://claude.ai/oauth/authorize',
  tokenUrl: 'https://platform.claude.com/v1/oauth/token',
  redirectUri: 'https://platform.claude.com/oauth/code/callback',
  scopes: 'user:profile user:inference user:sessions:claude_code user:mcp_servers'
})

export const TARGET = 'https://api.anthropic.com'
export const DEFAULT_ACCOUNT = 'ultrapowers'
const KEYCHAIN = Object.freeze({ service: 'ultrapowers-claude-oauth' })
export const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const LOCK_PATH = path.join(os.homedir(), '.ultrapowers', 'claude-token.lock')
const LOCK_STALE_MS = 2 * 60 * 1000
const REFRESH_AHEAD_MS = 4 * 60 * 60 * 1000
const LIVE_FLOOR_MS = 90 * 60 * 1000
const CLIPBOARD_POLL_MS = 2 * 1000
const CLIPBOARD_WAIT_MS = 10 * 60 * 1000

export const ACCOUNT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

function pkce (random = randomBytes) {
  const verifier = b64url(random(32))
  const challenge = b64url(createHash('sha256').update(verifier).digest())
  const state = random(32).toString('hex')
  return { verifier, challenge, state }
}

function authorizeUrlFor ({ challenge, state }) {
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

const cleanCode = (pasted) => String(pasted).trim().split('#')[0].trim()

function codeForState (pasted, state) {
  const [code, fragment, ...rest] = String(pasted).trim().split('#')
  if (rest.length || fragment === undefined) return null
  if (fragment.trim() !== state) return null
  const clean = code.trim()
  return clean || null
}

function parseKeychainDump (out, service = KEYCHAIN.service) {
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

function defaultDeps () {
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
    keychainWrite: (name, value) => spawnSync('security', ['add-generic-password', '-U', '-a', name, '-s', KEYCHAIN.service, '-w', value], { stdio: 'ignore' }).status === 0,
    keychainList: () => {
      const r = spawnSync('security', ['dump-keychain'], { encoding: 'utf8' })
      return r.status === 0 ? parseKeychainDump(r.stdout) : []
    },
    lobby: (verb, input) => {
      const r = spawnSync('ssh', [EXE_HOST, verb], { encoding: 'utf8', input })
      return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
    },
    log: (line) => process.stderr.write(`${line}\n`),
    stdout: (text) => process.stdout.write(text),
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

const exchange = (deps, { code, verifier, state }) => tokenRequest(deps, {
  grant_type: 'authorization_code',
  code,
  redirect_uri: OAUTH.redirectUri,
  client_id: OAUTH.clientId,
  code_verifier: verifier,
  state
})

const refreshGrant = (deps, refreshToken) => tokenRequest(deps, {
  grant_type: 'refresh_token',
  refresh_token: refreshToken,
  client_id: OAUTH.clientId,
  scope: OAUTH.scopes
})

function integrationExists (deps) {
  const r = deps.lobby('integrations list --json')
  if (r.code !== 0) throw new Error(`exe.dev integrations list failed (exit ${r.code}):\n${r.out}`)
  let payload
  try { payload = JSON.parse(r.out) } catch { throw new Error(`integrations list --json was not JSON:\n${r.out.slice(0, 300)}`) }
  const rows = Array.isArray(payload) ? payload : Object.values(payload).find(Array.isArray) ?? []
  return rows.some((row) => row?.name === INTEGRATION)
}

export function installBearer (deps, accessToken, account = DEFAULT_ACCOUNT) {
  const comment = `--comment account=${account}`
  const verb = integrationExists(deps)
    ? `integrations edit ${INTEGRATION} --bearer - ${comment}`
    : `integrations add http-proxy --name ${INTEGRATION} --target ${TARGET} --bearer - ${comment}`
  const r = deps.lobby(verb, accessToken)
  if (r.code !== 0) throw new Error(`exe.dev ${verb.split(' --')[0]} failed (exit ${r.code}):\n${r.out}`)
  return verb.startsWith('integrations add') ? 'added' : 'edited'
}

function listLiveFleet (deps) {
  const verb = `ls '${FLEET_PATTERN}' --json`
  const r = deps.lobby(verb)
  if (r.code !== 0) throw new Error(`${EXE_HOST} ${verb} failed (exit ${r.code}):\n${r.out}`)
  let payload
  try { payload = JSON.parse(r.out) } catch { throw new Error(`${verb} was not JSON:\n${String(r.out).slice(0, 300)}`) }
  const vms = Array.isArray(payload?.vms) ? payload.vms : []
  return vms.map((row) => row?.vm_name).filter((name) => typeof name === 'string')
}

function readRecord (deps, account = DEFAULT_ACCOUNT) {
  const raw = deps.keychainRead(account)
  if (!raw) return null
  try {
    const rec = JSON.parse(raw)
    if (typeof rec.refreshToken === 'string' && typeof rec.expiresAt === 'number') return rec
  } catch {}
  return null
}

function writeRecord (deps, rec, account = DEFAULT_ACCOUNT) {
  const value = JSON.stringify({ refreshToken: rec.refreshToken, accessToken: rec.accessToken, expiresAt: rec.expiresAt })
  if (!deps.keychainWrite(account, value)) {
    throw new Error('keychain write failed (security add-generic-password)')
  }
}

const iso = (ms) => new Date(ms).toISOString()
const minutes = (ms) => Math.round(ms / 60000)

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
  const how = install ? installBearer(deps, tokens.accessToken, account) : null
  deps.log(how
    ? `${INTEGRATION}: bearer ${how} for ${account}; access token fresh until ${iso(tokens.expiresAt)}; refresh token in the keychain.`
    : `${account}: access token fresh until ${iso(tokens.expiresAt)}; refresh token in the keychain; the edge was not touched (--no-install).`)
  return { expiresAt: tokens.expiresAt, how }
}

export async function refresh (deps, { force = false, account = DEFAULT_ACCOUNT, install = true } = {}) {
  const release = deps.lock ? deps.lock() : () => {}
  try {
    const rec = readRecord(deps, account)
    if (!rec) throw new Error('no refresh token in the keychain — run `node fleet/claude-token.mjs login` first')
    const remaining = rec.expiresAt - deps.now()
    if (!force && remaining > REFRESH_AHEAD_MS && typeof rec.accessToken === 'string') {
      const how = install ? installBearer(deps, rec.accessToken, account) : null
      deps.log(how
        ? `${INTEGRATION}: access token fresh until ${iso(rec.expiresAt)} — bearer ${how} for ${account}`
        : `${INTEGRATION}: access token fresh until ${iso(rec.expiresAt)} — nothing to do`)
      return { refreshed: false, installed: install, expiresAt: rec.expiresAt }
    }
    const liveVms = listLiveFleet(deps)
    if (liveVms.length > 0) {
      if (remaining >= LIVE_FLOOR_MS && typeof rec.accessToken === 'string') {
        const how = install ? installBearer(deps, rec.accessToken, account) : null
        deps.log(`token: fresh until ${iso(rec.expiresAt)}; ${liveVms.length} run(s) live — not rotated`)
        return { refreshed: false, installed: install, expiresAt: rec.expiresAt, held: true }
      }
      throw new Error(`token: expires ${iso(rec.expiresAt)}; ${liveVms.length} run(s) live (${liveVms.join(', ')}) — not rotated; under 90 minutes is too short to launch on, so wait for the runs to end or remove their VMs`)
    }
    const tokens = await refreshGrant(deps, rec.refreshToken)
    writeRecord(deps, tokens, account)
    if (install) installBearer(deps, tokens.accessToken, account)
    deps.log(`${INTEGRATION}: refreshed ${account}; fresh until ${iso(tokens.expiresAt)}`)
    return { refreshed: true, installed: install, expiresAt: tokens.expiresAt }
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

export function accounts (deps) {
  const rows = []
  for (const name of deps.keychainList() ?? []) {
    const rec = readRecord(deps, name)
    if (!rec) continue
    rows.push({ name, expiresAt: iso(rec.expiresAt), fresh: rec.expiresAt > deps.now() })
  }
  return rows
}

async function usageRow (deps, name, { rotate = true } = {}) {
  const unread = (reason) => ({ name, fiveHour: null, sevenDay: null, unread: true, reason })
  const rec = readRecord(deps, name)
  const now = deps.now()
  let accessToken = rec?.accessToken && rec.expiresAt > now ? rec.accessToken : null
  if (!accessToken) {
    if (!rotate) {
      return unread(`access token expired ${iso(rec?.expiresAt ?? now)}; not rotated (--no-rotate)`)
    }
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
  if (!fiveHour && !sevenDay) return unread('usage answered without five_hour/seven_day')
  return { name, fiveHour, sevenDay, unread: false, reason: null }
}

export async function usage (deps, { account = null, rotate = true } = {}) {
  const rows = []
  const names = account != null ? [account] : (deps.keychainList() ?? [])
  for (const name of names) rows.push(await usageRow(deps, name, { rotate }))
  return rows
}

const USAGE_HEADER = 'account | 5h % | 5h resets | 7d % | 7d resets'

const windowCells = (w) => (w ? [`${w.utilization}`, `${w.resetsAt}`] : ['none', 'none'])

function renderUsage (rows) {
  const lines = [USAGE_HEADER]
  for (const row of rows ?? []) {
    const cells = row.unread
      ? [row.name, `unread: ${row.reason}`, '', '', '']
      : [row.name, ...windowCells(row.fiveHour), ...windowCells(row.sevenDay)]
    lines.push(cells.join(' | ').replace(/[\s|]+$/, ''))
  }
  return lines.join('\n')
}

const VERBS = ['login', 'refresh', 'status', 'accounts', 'usage']
const USAGE_LINE = 'usage: node fleet/claude-token.mjs login [--code-from-clipboard] [--account <name>] [--no-install] | refresh [--force] [--account <name>] [--no-install] | status [--account <name>] | accounts [--json] | usage [--json] [--account <name>] [--no-rotate]'

const BARE = { 'no-install': ['install', false], force: ['force', true], 'code-from-clipboard': ['codeFromClipboard', true], json: ['json', true], 'no-rotate': ['rotate', false] }

function parseArgs (rest) {
  const opts = { account: DEFAULT_ACCOUNT, accountGiven: false, install: true, force: false, codeFromClipboard: false, json: false, rotate: true }
  const { opts: given, positional } = parseFlags(rest, { flags: Object.keys(BARE) })
  if (positional.length > 0) throw new Error(USAGE_LINE)
  for (const [key, value] of Object.entries(given)) {
    if (key === 'account') {
      if (value === true) throw new Error('--account needs a name: --account <name>')
      if (!ACCOUNT_RE.test(value)) throw new Error(`--account ${JSON.stringify(value)} is not a name matching ${ACCOUNT_RE.source}`)
      opts.account = value
      opts.accountGiven = true
    } else if (Object.hasOwn(BARE, key) && value === true) {
      const [field, set] = BARE[key]
      opts[field] = set
    } else throw new Error(USAGE_LINE)
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
  const rows = await usage(deps, { account: opts.accountGiven ? opts.account : null, rotate: opts.rotate })
  write(opts.json ? `${JSON.stringify(rows)}\n` : `${renderUsage(rows)}\n`)
  return rows
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  runCli(main, process.argv.slice(2)).then(() => process.exit())
}
