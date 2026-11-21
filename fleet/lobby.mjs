import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'


const TARGET = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?\/[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/
export const isSafeTarget = (value) => typeof value === 'string' && TARGET.test(value)

export const isSafeSha = (value) => typeof value === 'string' && /^[0-9a-f]{7,64}$/.test(value)

export const isFullSha = (value) => isSafeSha(value) && value.length === 40

export const isRunNumber = (value) => /^[1-9][0-9]*$/.test(String(value))

const VM_NAME = /^fleet-r([1-9][0-9]*)-[0-9]{10}-[0-9a-f]{4}$/

const stamp = (date) => {
  const two = (n) => String(n).padStart(2, '0')
  return `${String(date.getUTCFullYear()).slice(2)}${two(date.getUTCMonth() + 1)}${two(date.getUTCDate())}${two(date.getUTCHours())}${two(date.getUTCMinutes())}`
}

export const vmNameFor = (run, now = new Date(), rand = randomBytes(2).toString('hex')) =>
  `fleet-r${run}-${stamp(now)}-${rand}`

export const isVmName = (value) => typeof value === 'string' && VM_NAME.test(value)

export const runOfVmName = (name) => {
  const match = VM_NAME.exec(String(name ?? ''))
  return match ? Number(match[1]) : null
}

export const FLEET_PATTERN = 'fleet-r*'

export const targetSlug = (target) => String(target).replace('/', '-')

export const githubIntegrationFor = (target) => `gh-${targetSlug(target)}`

export const integrationBranchFor = (run) => `ultra/integration-run-${run}`

const RUN_BRANCH = /^(?:refs\/heads\/)?ultra\/integration-run-([1-9][0-9]*)$/

export const runOfBranch = (ref) => {
  const text = String(ref ?? '')
  const match = RUN_BRANCH.exec(text)
  return match ? Number(match[1]) : null
}

export const evidenceRepoFor = (config, override = null) => {
  if (isSafeTarget(override)) return override
  const setting = config?.evidence
  return isSafeTarget(setting) ? setting : null
}

export async function readEvidenceSetting ({ path: configPath } = {}) {
  const parsed = await readFleetJson(configPath ?? DEFAULT_CONFIG_PATH())
  return parsed === null ? null : evidenceRepoFor(parsed)
}

export const runFolderFor = (target, run) => `runs/${targetSlug(target)}/${run}`
export const liveBranchFor = (target, run) => `live/${targetSlug(target)}/run-${run}`
export const runTagFor = (target, run) => `${targetSlug(target)}/run-${run}`
export const evidenceUrlFor = (repo) => `https://github.com/${repo}.git`
export const PLAN_FILE = 'plan.md'

const escapeRegex = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export const runOfEvidenceRef = (target, ref) => {
  const slug = escapeRegex(targetSlug(target))
  const shape = new RegExp(
    `^(?:(?:refs/heads/)?live/${slug}/run-([1-9][0-9]*)|(?:refs/tags/)?${slug}/run-([1-9][0-9]*))$`
  )
  const match = shape.exec(String(ref ?? ''))
  return match ? Number(match[1] ?? match[2]) : null
}

export const EXE_HOST = 'exe.dev'
export const FLEET_TAG = 'fleet'
export const FLEET_POLICY = `tag:${FLEET_TAG}`
export const CLAUDE_INTEGRATION = 'claude-max'
export const ENGINE_REPO = 'popmechanic/ultrapowers'
export const ENGINE_URL = `https://github.com/${ENGINE_REPO}.git`
export const COMMENT_MAX_BYTES = 200
export const VERBS_RECORD = 'fleet/exe-verbs.json'
export const VERBS_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'exe-verbs.json')

export const FLEET_DEFAULTS = Object.freeze({
  cpu: '8',
  memory: '16GB'
})

export const DEFAULT_CONFIG_PATH = () => path.join(os.homedir(), '.ultrapowers', 'fleet.json')

export async function loadFleetConfig ({ path: configPath } = {}) {
  const parsed = await readFleetJson(configPath ?? DEFAULT_CONFIG_PATH())
  const config = { ...FLEET_DEFAULTS }
  for (const key of Object.keys(FLEET_DEFAULTS)) {
    if (typeof parsed?.[key] === 'string' && parsed[key] !== '') config[key] = parsed[key]
  }
  return config
}

export async function readFleetJson (configPath) {
  try {
    const parsed = JSON.parse(await fsp.readFile(configPath, 'utf8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function defaultExec (cmd, argv = [], options = {}) {
  const { input, ...rest } = options ?? {}
  return new Promise((resolve) => {
    const child = execFile(
      cmd, argv, { maxBuffer: 32 * 1024 * 1024, ...rest },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({ code: 0, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') })
          return
        }
        resolve({
          code: typeof error.code === 'number' ? error.code : 1,
          stdout: String(stdout ?? ''),
          stderr: String(stderr ?? '') || String(error.message ?? error)
        })
      }
    )
    if (input !== undefined && child.stdin) {
      child.stdin.on('error', () => {})
      child.stdin.end(input)
    }
  })
}

export const output = (res) => `${res.stdout ?? ''}${res.stderr ?? ''}`.trim()

export async function lobby (exec, remote, { input } = {}) {
  const res = input === undefined
    ? await exec('ssh', [EXE_HOST, remote])
    : await exec('ssh', [EXE_HOST, remote], { input })
  if (res.code !== 0) {
    const verb = remote.split(/\s+/)[0]
    throw new LobbyError(`exe.dev ${verb} failed (exit ${res.code}):\n${output(res)}`)
  }
  return res
}

export const git = (exec, dir, argv) => exec('git', ['-C', dir, ...argv])

export class Refusal extends Error {
  constructor (message) {
    super(message)
    this.name = 'Refusal'
    this.exitCode = 2
  }
}

export const refuse = (message) => {
  throw new Refusal(message)
}

export class LobbyError extends Error {
  constructor (message) {
    super(message)
    this.name = 'LobbyError'
    this.exitCode = 1
  }
}

export async function runCli (main, argv) {
  try {
    await main(argv)
  } catch (error) {
    process.stderr.write(`${error?.message ?? error}\n`)
    process.exitCode = typeof error?.exitCode === 'number' ? error.exitCode : 1
  }
}

export function parseArgs (argv, { flags = [] } = {}) {
  const opts = {}
  const positional = []
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (!arg.startsWith('--')) {
      positional.push(arg)
      continue
    }
    const body = arg.slice(2)
    const eq = body.indexOf('=')
    if (eq !== -1) {
      opts[body.slice(0, eq)] = body.slice(eq + 1)
      continue
    }
    if (flags.includes(body)) {
      opts[body] = true
      continue
    }
    const value = argv[i + 1]
    if (value === undefined || value.startsWith('--')) {
      opts[body] = true
      continue
    }
    opts[body] = value
    i += 1
  }
  return { opts, positional }
}

export function parseDuration (text) {
  const match = /^([0-9]+)([smhd])$/.exec(String(text ?? ''))
  if (!match) return null
  const unit = { s: 1000, m: 60000, h: 3600000, d: 86400000 }[match[2]]
  return Number(match[1]) * unit
}

export function parseJson (stdout) {
  const text = String(stdout ?? '').trim()
  if (text === '') return null
  try {
    return JSON.parse(text)
  } catch {
    const start = text.search(/[[{]/)
    if (start === -1) return null
    try {
      return JSON.parse(text.slice(start))
    } catch {
      return null
    }
  }
}

const str = (value) => (typeof value === 'string' && value !== '' ? value : null)

export async function listVms (exec, pattern = FLEET_PATTERN) {
  const res = await lobby(exec, `ls '${pattern}' --json`)
  const payload = parseJson(res.stdout)
  const rows = Array.isArray(payload?.vms) ? payload.vms : []
  return rows
    .map((row) => ({
      name: str(row?.vm_name),
      sshDest: str(row?.ssh_dest),
      sshHost: str(row?.ssh_host),
      status: str(row?.status),
      comment: str(row?.comment),
      tags: Array.isArray(row?.tags) ? row.tags : null
    }))
    .filter((row) => row.name)
}

function normaliseAttachment (entry) {
  if (typeof entry === 'string') {
    const [kind, ...rest] = entry.split(':')
    if (rest.length > 0 && (kind === 'vm' || kind === 'tag')) {
      return { kind, value: rest.join(':') }
    }
    return { kind: 'vm', value: entry }
  }
  if (entry && typeof entry === 'object') {
    if (typeof entry.vm === 'string') return { kind: 'vm', value: entry.vm }
    if (typeof entry.tag === 'string') return { kind: 'tag', value: entry.tag }
    const kind = entry.type === 'tag' ? 'tag' : entry.type === 'vm' ? 'vm' : null
    const value = str(entry.name) ?? str(entry.value) ?? str(entry.target)
    if (kind && value) return { kind, value }
  }
  return null
}

const BEARER = 'Authorization:Bearer'

function hasBearer (entry) {
  const carries = (text) => typeof text === 'string' && text.replace(/\s+/g, '').includes(BEARER)
  if (carries(entry?.config_summary)) return true
  const headers = entry?.config?.headers
  return Array.isArray(headers) && headers.some(carries)
}

export async function listIntegrations (exec) {
  const res = await lobby(exec, 'integrations list --json')
  const payload = parseJson(res.stdout)
  const rows = Array.isArray(payload) ? payload
    : Array.isArray(payload?.integrations) ? payload.integrations : []
  return rows.map((row) => {
    const raw = row?.attachments ?? row?.attached ?? row?.attachedTo ?? row?.attached_to ??
      row?.targets ?? []
    const attachments = (Array.isArray(raw) ? raw : [raw]).map(normaliseAttachment).filter(Boolean)
    const tags = attachments.filter((a) => a.kind === 'tag').map((a) => a.value)
    for (const tag of Array.isArray(row?.tags) ? row.tags : []) {
      if (typeof tag === 'string' && !tags.includes(tag)) tags.push(tag)
    }
    return {
      name: str(row?.name) ?? str(row?.integration) ?? str(row?.id),
      repository: str(row?.repository) ?? str(row?.repo),
      attachments,
      bearer: hasBearer(row),
      comment: typeof row?.comment === 'string' ? row.comment : null,
      tags
    }
  }).filter((row) => row.name)
}

export const COMMENT_KEYS = Object.freeze([
  'run', 'plan', 'target', 'base', 'engine', 'kind', 'hold'
])

export function buildComment (fields) {
  return COMMENT_KEYS
    .filter((key) => fields[key] !== undefined && fields[key] !== null && fields[key] !== '')
    .map((key) => `${key}=${fields[key]}`)
    .join(' ')
}

export function parseComment (text) {
  const fields = {}
  for (const token of String(text ?? '').trim().split(/\s+/)) {
    const eq = token.indexOf('=')
    if (eq <= 0) continue
    fields[token.slice(0, eq)] = token.slice(eq + 1)
  }
  return fields
}

export async function highestRunInEvidence (exec, repoDir, evidenceRepo, target) {
  const slug = targetSlug(target)
  const url = evidenceUrlFor(evidenceRepo)
  const patterns = [`refs/heads/live/${slug}/run-*`, `refs/tags/${slug}/run-*`]
  const res = await git(exec, repoDir, ['ls-remote', url, ...patterns])
  if (res.code !== 0) {
    refuse(
      `git ls-remote ${url} ${patterns.map((p) => `'${p}'`).join(' ')} in ${repoDir} ` +
      `failed (exit ${res.code}):\n${output(res)}`
    )
  }
  let best = 0
  for (const line of String(res.stdout ?? '').split('\n')) {
    const ref = line.split('\t')[1]
    if (ref === undefined) continue
    const run = runOfEvidenceRef(target, ref.trim())
    if (run !== null && run > best) best = run
  }
  return best
}

const num = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null)

export const parseMemoryGb = (text) => {
  const match = /^([1-9][0-9]*)\s*G(?:B)?$/i.exec(String(text ?? '').trim())
  return match ? Number(match[1]) : null
}

export async function readPlanCapacity (exec) {
  const res = await lobby(exec, 'billing plan --json')
  const payload = parseJson(res.stdout)
  const maxCpus = num(payload?.max_cpus)
  if (maxCpus === null) {
    throw new LobbyError(
      `exe.dev billing plan --json answered no numeric max_cpus:\n${output(res)}`
    )
  }
  return {
    maxCpus,
    maxMemoryGb: num(payload?.max_memory_gb) ?? 0,
    tier: str(payload?.tier) ?? '',
    plan: str(payload?.plan) ?? ''
  }
}
