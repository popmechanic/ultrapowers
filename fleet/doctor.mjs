#!/usr/bin/env node

import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  CLAUDE_INTEGRATION,
  DEFAULT_CONFIG_PATH,
  EXE_HOST,
  FLEET_DEFAULTS,
  FLEET_POLICY,
  FLEET_TAG,
  Refusal,
  VERBS_PATH,
  VERBS_RECORD,
  defaultExec,
  githubIntegrationFor,
  isSafeTarget,
  listIntegrations,
  loadFleetConfig,
  parseArgs,
  parseJson,
  parseMemoryGb,
  readEvidenceSetting,
  readFleetJson,
  readPlanCapacity,
  runCli
} from './lobby.mjs'

export const ROW_IDS = Object.freeze([
  'exe-dev', 'capacity', 'claude', 'accounts', 'github', 'integrations', 'evidence', 'verb-drift', 'cloudflare'
])

const FIXES = Object.freeze(Object.fromEntries(ROW_IDS.map((id) => [id, id])))

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CLAUDE_TOKEN = path.join(HERE, 'claude-token.mjs')

const READS = Object.freeze({
  whoami: 'whoami',
  github: 'integrations setup github --list'
})

const lobbyRead = (exec, remote) => exec('ssh', [EXE_HOST, remote])

async function tokenRead (exec, argv) {
  const res = await exec('node', [CLAUDE_TOKEN, ...argv])
  return { code: res.code, stdout: `${res.stdout ?? ''}${res.stderr ?? ''}` }
}

const BEARER = 'Authorization:Bearer'

const row = (id, status, detail) => ({ id, status, detail, fix: FIXES[id] })
const firstLine = (stdout) => String(stdout ?? '').split('\n')[0].trim()

const parseCpus = (value) => (/^\d+$/.test(String(value ?? '').trim()) ? Number(value) : null)

export async function fleetConfigAccount ({ path: configPath } = {}) {
  const account = (await readFleetJson(configPath ?? DEFAULT_CONFIG_PATH()))?.account
  return typeof account === 'string' && account !== '' ? account : null
}

function exeDevRow (res) {
  const who = firstLine(res.stdout)
  if (res.code === 0 && who !== '') return row('exe-dev', 'ok', `signed in as ${who}`)
  return row('exe-dev', 'missing', `ssh exe.dev whoami answered code ${res.code} with no account name`)
}

async function readPool (res) {
  if (res.code !== 0) return null
  let capacity
  try {
    capacity = await readPlanCapacity(async () => res)
  } catch {
    return null
  }
  const payload = parseJson(res.stdout)
  return {
    maxCpus: capacity.maxCpus,
    maxMemoryGb: typeof payload?.max_memory_gb === 'number' ? capacity.maxMemoryGb : null,
    tier: capacity.tier !== '' ? capacity.tier : String(payload?.plan ?? 'untiered')
  }
}

function poolRow (res, pool, config) {
  const askedCpu = parseCpus(config.cpu)
  const askedGb = parseMemoryGb(config.memory)
  if (askedCpu === null || askedGb === null) {
    return row(
      'capacity',
      'missing',
      `~/.ultrapowers/fleet.json asks for cpu ${config.cpu} / memory ${config.memory}, which is not <int> and <int>GB`
    )
  }

  if (pool === null || pool.maxMemoryGb === null) {
    return row(
      'capacity',
      'missing',
      `billing plan --json answered code ${res.code} with no readable pool — ~/.ultrapowers/fleet.json sets the size a run asks for`
    )
  }

  const described = `${pool.tier} pool ${pool.maxCpus} vCPU / ${pool.maxMemoryGb}GB`
  const asked = `${askedCpu} vCPU / ${askedGb}GB`
  return row('capacity', 'ok', `${described}; a run asks ${asked}`)
}

const READ_KEYS = Object.keys(FLEET_DEFAULTS)

const LAUNCHER_KEYS = Object.freeze(['account', 'evidence'])

const CONFIG_KEYS = Object.freeze([...READ_KEYS, ...LAUNCHER_KEYS])

function capacityRow (res, pool, config, configKeys = null) {
  const base = poolRow(res, pool, config)
  const keys = Array.isArray(configKeys) ? configKeys.filter((k) => typeof k === 'string') : null
  if (keys === null) return base

  const stale = keys.filter((key) => !CONFIG_KEYS.includes(key))
  if (stale.length > 0) {
    return row(
      'capacity',
      'missing',
      `~/.ultrapowers/fleet.json carries ${stale.join(', ')} — keys nothing reads; ` +
        `it reads ${READ_KEYS.join(' and ')} only, and the launcher reads ` +
        `${LAUNCHER_KEYS.join(' and ')}. ${base.detail}`
    )
  }
  if (base.status !== 'ok') return base

  const lacking = READ_KEYS.filter((key) => !keys.includes(key))
  const notes = lacking.map(
    (key) => ` (${key} not in ~/.ultrapowers/fleet.json — the default ${FLEET_DEFAULTS[key]})`
  )
  return notes.length === 0 ? base : row('capacity', 'ok', `${base.detail}${notes.join('')}`)
}

async function readIntegrations (res) {
  if (res.code !== 0) return null
  const payload = parseJson(res.stdout)
  if (!Array.isArray(payload) && !Array.isArray(payload?.integrations)) return null
  const out = new Map()
  for (const entry of await listIntegrations(async () => res)) {
    out.set(entry.name, {
      name: entry.name,
      tags: entry.tags,
      bearer: entry.bearer,
      comment: entry.comment
    })
  }
  return out
}

const attachFix = (name) => `ssh exe.dev "integrations attach ${name} ${FLEET_POLICY}"`

export function attachRowFor (name, { id, found, absentIsOk = false, absentDetail = null } = {}) {
  const have = found === null || found === undefined ? undefined : found.get(name)
  if (have === undefined) {
    return row(id, absentIsOk ? 'ok' : 'missing', absentDetail ?? `no ${name} integration at the edge`)
  }
  if (have.tags.includes(FLEET_TAG)) return null
  return row(id, 'missing', `${name} is not attached to ${FLEET_POLICY}, so no fleet VM is granted it — ${attachFix(name)}`)
}

export function usageSuffix (usageRes) {
  if (usageRes.code !== 0) {
    return `; usage unread — usage answered code ${usageRes.code}`
  }
  let parsed
  try {
    parsed = JSON.parse(usageRes.stdout)
  } catch {
    parsed = null
  }
  const first = Array.isArray(parsed) ? parsed[0] : undefined
  if (first === undefined || first.unread) {
    const reason = first?.reason ?? 'no readable JSON'
    return `; usage unread — ${reason}`
  }
  const { sevenDay, fiveHour } = first
  const windowText = (w) => w === null ? 'none' : `${w.utilization}% resets ${w.resetsAt}`
  return `; 7d ${windowText(sevenDay)}; 5h ${windowText(fiveHour)}`
}

function claudeRow (found, tokenRes, usageRes) {
  const suffix = usageSuffix(usageRes)
  if (found === null) {
    return row('claude', 'missing', `integrations list printed no readable JSON${suffix}`)
  }
  const have = found.get(CLAUDE_INTEGRATION)
  if (have === undefined || !have.bearer) {
    const why = have === undefined
      ? `no ${CLAUDE_INTEGRATION} integration at the edge`
      : `${CLAUDE_INTEGRATION} carries no ${BEARER} header`
    return row('claude', 'missing', `${why} — node fleet/claude-token.mjs login${suffix}`)
  }
  const status = tokenRes.code === 0 && firstLine(tokenRes.stdout) !== ''
    ? firstLine(tokenRes.stdout)
    : 'no refresh token in the keychain — a launch on this account refuses until it is signed in'
  return row('claude', 'ok', `${CLAUDE_INTEGRATION} carries the bearer at the edge; ${status}${suffix}`)
}

const LOGIN = 'node fleet/claude-token.mjs login'

const ACCOUNT_TOKEN = 'account='

function parseAccounts (res) {
  if (res.code !== 0) return null
  const parsed = parseJson(res.stdout)
  return Array.isArray(parsed) ? parsed : null
}

const accountName = (entry) => (entry && typeof entry.name === 'string' ? entry.name : '')

const describeAccount = (entry) =>
  `${accountName(entry)} ${entry?.fresh === true ? 'fresh until' : 'expired'} ${String(entry?.expiresAt ?? '')}`

function edgeAccount (found) {
  const comment = found?.get(CLAUDE_INTEGRATION)?.comment
  if (typeof comment !== 'string') return null
  for (const word of comment.split(/\s+/)) {
    if (!word.startsWith(ACCOUNT_TOKEN)) continue
    const name = word.slice(ACCOUNT_TOKEN.length)
    return name === '' ? null : name
  }
  return null
}

function accountsRow (res, found, account) {
  const entries = parseAccounts(res)
  if (entries === null) {
    return row(
      'accounts',
      'missing',
      `claude-token.mjs accounts --json answered code ${res.code} with no JSON array of keychain entries — ${LOGIN}`
    )
  }
  if (entries.length === 0) {
    return row('accounts', 'missing', `the keychain holds no account — ${LOGIN}`)
  }

  const listed = entries.map(describeAccount).join(', ')
  const edge = edgeAccount(found)
  const carries = edge === null ? '; edge account unrecorded' : `; edge carries ${edge}`
  if (account !== null && !entries.map(accountName).includes(account)) {
    return row(
      'accounts',
      'missing',
      `~/.ultrapowers/fleet.json names ${account}, which no keychain entry carries — ` +
        `${listed}${carries} — ${LOGIN} --account ${account}`
    )
  }
  const named = account === null ? '' : `; fleet.json names ${account}`
  return row('accounts', 'ok', `${listed}${carries}${named}`)
}

const VERB = /^[a-z][a-z0-9 -]*$/

const FLAG_LINE = /^[ \t]+(--[A-Za-z0-9-]+)/gm

function helpFlags (stdout) {
  const flags = []
  for (const match of String(stdout ?? '').matchAll(FLAG_LINE)) {
    if (!flags.includes(match[1])) flags.push(match[1])
  }
  return flags
}

export async function verbDrift ({ help, recordPath } = {}) {
  const target = recordPath ?? VERBS_PATH
  const unreadable = (why) => ({
    readable: false,
    capturedAt: null,
    findings: [],
    detail: `${VERBS_RECORD} ${why} — re-capture it from ssh exe.dev "help <verb>" output`
  })

  let text
  try {
    text = await fsp.readFile(target, 'utf8')
  } catch {
    return unreadable('is not there')
  }
  let record
  try {
    record = JSON.parse(text)
  } catch {
    return unreadable('is not JSON')
  }
  const verbs = record && typeof record === 'object' ? record.verbs : null
  if (!verbs || typeof verbs !== 'object' || Array.isArray(verbs)) {
    return unreadable('carries no verbs object')
  }
  const capturedAt = typeof record.capturedAt === 'string' ? record.capturedAt : null

  const names = Object.keys(verbs)
  const findings = []
  const segments = []
  for (const verb of names) {
    const recorded = Array.isArray(verbs[verb]) ? verbs[verb].filter((f) => typeof f === 'string') : []

    if (!VERB.test(verb)) {
      findings.push({ verb, appeared: [], vanished: [], unreadable: -1 })
      segments.push(`${verb}: help unreadable (code -1)`)
      continue
    }

    const res = await help(verb)
    const live = helpFlags(res?.stdout)
    if (res?.code !== 0 || live.length === 0) {
      const code = typeof res?.code === 'number' ? res.code : -1
      findings.push({ verb, appeared: [], vanished: [], unreadable: code })
      segments.push(`${verb}: help unreadable (code ${code})`)
      continue
    }

    const appeared = live.filter((flag) => !recorded.includes(flag))
    const vanished = recorded.filter((flag) => !live.includes(flag))
    if (appeared.length === 0 && vanished.length === 0) continue
    findings.push({ verb, appeared, vanished, unreadable: null })
    if (appeared.length > 0) segments.push(`${verb}: ${appeared.join(', ')} appeared`)
    if (vanished.length > 0) segments.push(`${verb}: ${vanished.join(', ')} vanished`)
  }

  const detail = segments.length === 0
    ? `${names.length} verbs match ${VERBS_RECORD} (captured ${capturedAt})`
    : `drift since ${capturedAt}: ${segments.join('; ')} — re-measure the behaviours with node fleet/tests/probe_exe_facts.mjs`
  return { readable: true, capturedAt, findings, detail }
}

const verbDriftRow = (drift) => row('verb-drift', drift.readable ? 'ok' : 'missing', drift.detail)

function githubAccounts (stdout) {
  const lines = String(stdout ?? '').split('\n')
  const header = lines.findIndex((line) => /accounts\s*:\s*$/i.test(line))
  const body = header === -1 ? lines : lines.slice(header + 1)
  const names = []
  for (const line of body) {
    if (!/^\s+\S/.test(line)) continue
    names.push(line.trim())
  }
  return names
}

function githubRow (res) {
  const accounts = res.code === 0 ? githubAccounts(res.stdout) : []
  if (accounts.length === 0) {
    return row(
      'github',
      'missing',
      `integrations setup github --list answered code ${res.code} with no account — ssh exe.dev integrations setup github walks the browser step`
    )
  }
  return row('github', 'ok', `GitHub accounts ${accounts.join(', ')}`)
}

function attachNames (target) {
  const names = [CLAUDE_INTEGRATION]
  if (target !== null) names.push(githubIntegrationFor(target))
  return names
}

function integrationsRow (found, target) {
  if (found === null) {
    return row('integrations', 'missing', 'integrations list printed no readable JSON')
  }
  if (target !== null) {
    const want = githubIntegrationFor(target)
    if (!found.has(want)) {
      return row('integrations', 'missing', `no ${want} integration for ${target} — node fleet/target.mjs ${target}`)
    }
  }
  const names = attachNames(target)
  for (const name of names) {
    if (!found.has(name)) continue
    const off = attachRowFor(name, { id: 'integrations', found })
    if (off !== null) return off
  }
  return row('integrations', 'ok', `${names.filter((n) => found.has(n)).join(', ')} attached to ${FLEET_POLICY}`)
}

const evidenceRepoRead = (evidence) => ['api', `repos/${evidence}`]

function evidenceRow (evidence, repoRes, found) {
  if (evidence === null) {
    return row(
      'evidence',
      'missing',
      'no evidence repository set — add "evidence": "<owner>/<repo>" to ~/.ultrapowers/fleet.json'
    )
  }
  if (repoRes === null || repoRes.code !== 0) {
    return row(
      'evidence',
      'missing',
      `gh api repos/${evidence} answered code ${repoRes?.code ?? 1} — gh repo create ${evidence} --private`
    )
  }
  if (found === null) {
    return row('evidence', 'missing', 'integrations list printed no readable JSON')
  }
  const name = githubIntegrationFor(evidence)
  if (!found.has(name)) {
    return row('evidence', 'missing', `no ${name} integration for ${evidence} — node fleet/target.mjs ${evidence}`)
  }
  const off = attachRowFor(name, { id: 'evidence', found })
  return off ?? row('evidence', 'ok', `${evidence} exists and ${name} is attached to ${FLEET_POLICY}`)
}

const CLOUDFLARE_INTEGRATION = 'cloudflare'

function cloudflareRow (found) {
  const off = attachRowFor(CLOUDFLARE_INTEGRATION, {
    id: 'cloudflare',
    found,
    absentIsOk: true,
    absentDetail: 'cloudflare integration absent — only a plan with a **Publish:** line needs it; ' +
      'first-run.md §cloudflare walks the token'
  })
  return off ?? row('cloudflare', 'ok', `${CLOUDFLARE_INTEGRATION} http-proxy attached to ${FLEET_POLICY}`)
}

export async function doctor ({
  config, exec, target = null, configKeys = null, account = null, verbsPath = null, evidence = null
} = {}) {
  const cfg = { ...FLEET_DEFAULTS, ...(config ?? {}) }
  const run = exec ?? defaultExec
  const want = target === null || target === undefined ? null : String(target)
  if (want !== null && !isSafeTarget(want)) {
    throw new Error(`--target takes owner/repo, not ${JSON.stringify(want)}`)
  }
  const wantAccount = account === null || account === undefined ? null : String(account)
  const wantEvidence = evidence === null || evidence === undefined ? null : String(evidence)
  if (wantEvidence !== null && !isSafeTarget(wantEvidence)) {
    throw new Error(`evidence takes owner/repo, not ${JSON.stringify(wantEvidence)}`)
  }

  const read = (remote) => lobbyRead(run, remote)
  const whoami = await read(READS.whoami)
  const billing = await read('billing plan --json')
  const pool = await readPool(billing)
  const list = await read('integrations list --json')
  const found = await readIntegrations(list)
  const github = await read(READS.github)
  const token = await tokenRead(run, wantAccount ? ['status', '--account', wantAccount] : ['status'])
  const usage = await tokenRead(run, wantAccount
    ? ['usage', '--json', '--account', wantAccount, '--no-rotate']
    : ['usage', '--json', '--no-rotate'])
  const accounts = await tokenRead(run, ['accounts', '--json'])
  const evidenceRepo = wantEvidence === null ? null : await run('gh', evidenceRepoRead(wantEvidence))
  const drift = await verbDrift({
    help: (verb) => read(`help ${verb}`),
    recordPath: verbsPath
  })

  const rows = [
    exeDevRow(whoami),
    capacityRow(billing, pool, cfg, configKeys),
    claudeRow(found, token, usage),
    accountsRow(accounts, found, wantAccount),
    githubRow(github),
    integrationsRow(found, want),
    evidenceRow(wantEvidence, evidenceRepo, found),
    verbDriftRow(drift),
    cloudflareRow(found)
  ]
  const verdict = rows.every((r) => r.status === 'ok') ? 'ready' : 'not-ready'
  return { config: cfg, rows, verdict }
}

const PAD = Math.max(...['ok', 'missing'].map((s) => s.length))

function renderRows (rows) {
  const out = []
  for (const r of rows) {
    out.push(`${r.status.padEnd(PAD)} ${r.id}  ${r.detail}`)
    if (r.status === 'missing') out.push(`    → references/first-run.md §${r.fix}`)
  }
  return out.join('\n')
}

const valueOf = (opt) => (typeof opt === 'string' ? opt : null)

async function main (argv) {
  const { opts } = parseArgs(argv, { flags: ['json'] })
  const configPath = valueOf(opts.config) ?? DEFAULT_CONFIG_PATH()
  const config = await loadFleetConfig({ path: configPath })
  const written = await readFleetJson(configPath)
  const configKeys = written === null ? null : Object.keys(written)
  const account = await fleetConfigAccount({ path: configPath })
  const evidence = await readEvidenceSetting({ path: configPath })
  let result
  try {
    result = await doctor({ config, exec: defaultExec, target: valueOf(opts.target), configKeys, account, evidence })
  } catch (error) {
    throw new Refusal(error?.message ?? String(error))
  }
  process.stdout.write(
    opts.json === true ? `${JSON.stringify(result)}\n` : `${renderRows(result.rows)}\n`
  )
  process.exitCode = result.verdict === 'ready' ? 0 : 1
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (invokedPath === fileURLToPath(import.meta.url)) {
  await runCli(main, process.argv.slice(2))
}
