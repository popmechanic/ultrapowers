/**
 * fleet/lobby.mjs — the laptop's half of the fleet, in one place.
 *
 * After the lift there is no orchestrator and no control VM. A run's identity
 * is its VM name (`fleet-run-<N>`), which is also its DNS name, its status URL,
 * its `comment` key, its `ls` row and its `rm` argument. Everything the laptop
 * does is either a git command against `popmechanic/fleet-runs` or one exe.dev
 * lobby verb issued as `ssh exe.dev "<verb …>"`.
 *
 * This module is what the four laptop CLIs (`launch`, `grant`, `janitor`,
 * `target`) share: the exec seam, the config file, the two name validators, and
 * tolerant readers for the two JSON payloads the lobby answers with. It runs
 * from the installed plugin cache, so — like `doctor.mjs` — every specifier is
 * `node:`-prefixed and there are no npm dependencies.
 *
 * ## The exec seam
 *
 * One function, `exec(cmd, argv)`, resolving `{ code, stdout, stderr }` and
 * never rejecting. It is `execFile`, never a shell string: nothing this process
 * builds is ever parsed by a local shell. The exe.dev lobby still parses the
 * remote half (`ssh exe.dev "cp fleet-golden fleet-run-7 --json"` is one argv
 * element), so every value interpolated into that string is validated first —
 * `isSafeTarget`, `isFullSha`, `isRunNumber` — and the only quoted field (the
 * assignment comment) is built exclusively from validated parts.
 */

import { execFile } from 'node:child_process'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

// ── Names and shas ──────────────────────────────────────────────────────────

/**
 * `owner/repo`: exactly one slash, each half a git-safe name. Copied verbatim
 * from `fleet/drive.mjs` (deleted by the lift). The target is spelled into the
 * clone URL, the integration object's name and the assignment comment, so it is
 * checked before anything is provisioned.
 */
export const isSafeTarget = (value) =>
  typeof value === 'string' && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)

/**
 * A git object name, as a pointer half. Copied verbatim from
 * `fleet/shim-main.mjs` (deleted by the lift).
 */
export const isSafeSha = (value) => typeof value === 'string' && /^[0-9a-f]{7,64}$/.test(value)

/**
 * The stricter shape the assignment comment carries. `isSafeSha` admits an
 * abbreviation, and an abbreviation would let two clones resolve one `base=`
 * differently — so `base=` and `engine=` are full shas or nothing.
 */
export const isFullSha = (value) => isSafeSha(value) && value.length === 40

/** A run number: a positive decimal integer with no leading zero. */
export const isRunNumber = (value) => /^[1-9][0-9]*$/.test(String(value))

/** `fleet-run-<N>` — the run's VM name, DNS name, comment key and `rm` argument. */
export const vmNameFor = (run) => `fleet-run-${run}`

/** `<owner>/<repo>` → `<owner>-<repo>`, the slash-free half of an integration name. */
export const targetSlug = (target) => String(target).replace('/', '-')

/** The two per-target integration objects: read-only and writable. */
export const roIntegrationFor = (target) => `t-${targetSlug(target)}-ro`
export const rwIntegrationFor = (target) => `t-${targetSlug(target)}-rw`

/** The run's status page, served by `busybox httpd` on the VM's port 8000. */
export const statusUrlFor = (run) => `https://${vmNameFor(run)}.exe.xyz/status.json`

// ── Constants the whole laptop side agrees on ───────────────────────────────

export const EXE_HOST = 'exe.dev'
export const FLEET_TAG = 'fleet'
export const FLEET_RUNS_REPO = 'popmechanic/fleet-runs'
export const FLEET_RUNS_URL = `https://github.com/${FLEET_RUNS_REPO}.git`
export const ENGINE_REPO = 'popmechanic/ultrapowers'
export const ENGINE_URL = `https://github.com/${ENGINE_REPO}.git`
/** The http-proxy integration that injects the Claude OAuth token at the edge. */
export const CLAUDE_INTEGRATION = 'claude-max'
/** The assignment comment's hard ceiling — exe.dev's `comment` field. */
export const COMMENT_MAX_BYTES = 200

// ── Config ──────────────────────────────────────────────────────────────────

/** The config file's three keys and their defaults — an operator who followed
 *  the RUNBOOK needs no `~/.ultrapowers/fleet.json` at all. */
export const FLEET_DEFAULTS = Object.freeze({
  golden: 'fleet-golden',
  fleetRuns: '~/.ultrapowers/fleet-runs',
  vmTokenPath: '~/.ultrapowers/vm-token'
})

export const DEFAULT_CONFIG_PATH = () => path.join(os.homedir(), '.ultrapowers', 'fleet.json')

/** `~/x` → `<home>/x`. The config file is hand-edited, so it may hold either. */
export const expandHome = (value) => {
  const text = String(value ?? '')
  if (text === '~') return os.homedir()
  if (text.startsWith('~/')) return path.join(os.homedir(), text.slice(2))
  return text
}

/**
 * Read `~/.ultrapowers/fleet.json` (or `path`) over the defaults. An absent
 * file means all defaults; an unknown key is ignored; a key the file omits
 * stays at its default. Same shape as the pre-lift `doctor.mjs` — copied, not
 * imported, because the doctor is being rewritten and neither file should be
 * able to break the other.
 */
export async function loadFleetConfig ({ path: configPath } = {}) {
  const target = configPath ?? DEFAULT_CONFIG_PATH()
  const config = { ...FLEET_DEFAULTS }
  let text
  try {
    text = await fsp.readFile(target, 'utf8')
  } catch {
    return config
  }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return config
  }
  if (!parsed || typeof parsed !== 'object') return config
  for (const key of Object.keys(FLEET_DEFAULTS)) {
    if (typeof parsed[key] === 'string' && parsed[key] !== '') config[key] = parsed[key]
  }
  return config
}

// ── The exec seam ───────────────────────────────────────────────────────────

/** The seam's real implementation: `execFile`, resolving, never a shell. */
export async function defaultExec (cmd, argv = [], options = {}) {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, argv, {
      maxBuffer: 32 * 1024 * 1024,
      ...options
    })
    return { code: 0, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') }
  } catch (error) {
    return {
      code: typeof error?.code === 'number' ? error.code : 1,
      stdout: String(error?.stdout ?? ''),
      stderr: String(error?.stderr ?? error?.message ?? error)
    }
  }
}

/** One lobby verb: `ssh exe.dev "<remote>"`, the remote half as ONE argv element. */
export const lobby = (exec, remote) => exec('ssh', [EXE_HOST, remote])

/** A git command against a checkout, through the same seam. */
export const git = (exec, dir, argv) => exec('git', ['-C', dir, ...argv])

// ── Refusals ────────────────────────────────────────────────────────────────

/**
 * A refusal: one line naming why, exit 2, and — for the launcher — nothing on
 * exe.dev mutated. Distinguished from a failure (exit 1), which is a lobby verb
 * that ran and answered non-zero.
 */
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

/** A lobby verb that ran and failed: exit 1, the verb and its stderr named. */
export class LobbyError extends Error {
  constructor (message) {
    super(message)
    this.name = 'LobbyError'
    this.exitCode = 1
  }
}

/** Run a CLI `main`, print a refusal or failure as one line, set the exit code. */
export async function runCli (main, argv) {
  try {
    await main(argv)
  } catch (error) {
    process.stderr.write(`${error?.message ?? error}\n`)
    process.exitCode = typeof error?.exitCode === 'number' ? error.exitCode : 1
  }
}

// ── Argument parsing ────────────────────────────────────────────────────────

/**
 * `--key value`, `--key=value` and `--flag`. `flags` names the valueless ones;
 * everything else takes the next argv element. Unknown keys are kept, so each
 * CLI decides for itself what it refuses.
 */
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

/** `15m` → 900000 ms. Accepts s/m/h/d; anything else answers null. */
export function parseDuration (text) {
  const match = /^([0-9]+)([smhd])$/.exec(String(text ?? ''))
  if (!match) return null
  const unit = { s: 1000, m: 60000, h: 3600000, d: 86400000 }[match[2]]
  return Number(match[1]) * unit
}

// ── Reading what the lobby answers ──────────────────────────────────────────

/** Parse a `--json` payload, tolerating a leading banner line. Null on failure. */
export function parseJson (stdout) {
  const text = String(stdout ?? '').trim()
  if (text === '') return null
  try {
    return JSON.parse(text)
  } catch {
    // Some verbs print a line before the document; take from the first bracket.
    const start = text.search(/[[{]/)
    if (start === -1) return null
    try {
      return JSON.parse(text.slice(start))
    } catch {
      return null
    }
  }
}

/**
 * The rows of a `--json` listing, whatever wrapper the verb chose: a bare
 * array, or the first array-valued property of an object (`{"vms": […]}`,
 * `{"integrations": […]}`). Written tolerantly on purpose — the payload shape
 * is the lobby's to change, and a launcher that dies on a new wrapper key is
 * worse than one that reads the array it can see.
 */
export function jsonRows (payload) {
  if (Array.isArray(payload)) return payload
  if (payload && typeof payload === 'object') {
    // `ls --json` is `{ shared_vms: [...], vms: [...] }` — key order put the
    // one shared VM first and hid every fleet VM from grant (run-69). Every
    // array in the envelope is rows; the one named for the verb is not special.
    const rows = []
    for (const value of Object.values(payload)) {
      if (Array.isArray(value)) rows.push(...value)
    }
    return rows
  }
  return []
}

const firstString = (row, keys) => {
  for (const key of keys) {
    if (typeof row?.[key] === 'string' && row[key] !== '') return row[key]
  }
  return null
}

/** `ssh exe.dev "ls --json"` → `[{ name, comment, createdAt, raw }]`. */
export async function listVms (exec) {
  const res = await lobby(exec, 'ls --json')
  if (res.code !== 0) {
    throw new LobbyError(`ls --json failed (code ${res.code}): ${String(res.stderr).trim()}`)
  }
  return jsonRows(parseJson(res.stdout)).map((row) => ({
    name: firstString(row, ['name', 'vm', 'vm_name', 'id']),
    comment: firstString(row, ['comment']) ?? '',
    createdAt: firstString(row, ['created_at', 'createdAt', 'created', 'creation_time']),
    raw: row
  })).filter((row) => row.name)
}

/**
 * One attachment of an integration object, normalised to `{ kind, value }`
 * where `kind` is `vm` or `tag`. The lobby may spell an attachment as a string
 * (`"vm:fleet-run-7"`, `"tag:fleet"`) or as an object (`{type,name}`, `{vm}`,
 * `{tag}`); all four are read. Shape agreed with the doctor's `integrations`
 * row, which reads the same payload the same way.
 */
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
    const value = firstString(entry, ['name', 'value', 'target'])
    if (kind && value) return { kind, value }
  }
  return null
}

/** `ssh exe.dev "integrations list --json"` → `[{ name, repository, attachments }]`. */
export async function listIntegrations (exec) {
  const res = await lobby(exec, 'integrations list --json')
  if (res.code !== 0) {
    throw new LobbyError(
      `integrations list --json failed (code ${res.code}): ${String(res.stderr).trim()}`
    )
  }
  return jsonRows(parseJson(res.stdout)).map((row) => {
    const raw = row?.attachments ?? row?.attached ?? row?.attachedTo ?? row?.attached_to ??
      row?.targets ?? []
    const attachments = (Array.isArray(raw) ? raw : [raw]).map(normaliseAttachment).filter(Boolean)
    return {
      name: firstString(row, ['name', 'integration', 'id']),
      repository: firstString(row, ['repository', 'repo']),
      attachments,
      raw: row
    }
  }).filter((row) => row.name)
}

/** Is this integration attached to `vm:<vm>` right now? */
export const attachedToVm = (integration, vm) =>
  (integration?.attachments ?? []).some((a) => a.kind === 'vm' && a.value === vm)

/** Is this integration attached to any tag (a grant no per-VM detach can lift)? */
export const attachedToTag = (integration) =>
  (integration?.attachments ?? []).some((a) => a.kind === 'tag')

/** Every VM name this integration is attached to. */
export const attachedVms = (integration) =>
  (integration?.attachments ?? []).filter((a) => a.kind === 'vm').map((a) => a.value)

// ── The assignment comment ──────────────────────────────────────────────────

/** The comment's keys, in the order the contract spells them. */
export const COMMENT_KEYS = Object.freeze([
  'run', 'plan', 'target', 'base', 'engine', 'overlap', 'tier'
])

/**
 * Build the assignment comment: single line, space-separated `key=value`, keys
 * in contract order, optional `overlap=`/`tier=` last. Every value has already
 * been validated by the caller; nothing here can introduce a quote or a space.
 */
export function buildComment (fields) {
  return COMMENT_KEYS
    .filter((key) => fields[key] !== undefined && fields[key] !== null && fields[key] !== '')
    .map((key) => `${key}=${fields[key]}`)
    .join(' ')
}

/** Read a comment back into its fields. Unknown keys are kept; junk is ignored. */
export function parseComment (text) {
  const fields = {}
  for (const token of String(text ?? '').trim().split(/\s+/)) {
    const eq = token.indexOf('=')
    if (eq <= 0) continue
    fields[token.slice(0, eq)] = token.slice(eq + 1)
  }
  return fields
}

// ── The fleet-runs clone ────────────────────────────────────────────────────

/**
 * Make sure the local `fleet-runs` clone exists and is current: clone it when
 * absent (the laptop's own git credential — the fleet holds no PAT anywhere),
 * and `pull --rebase` when it is there. Answers the resolved absolute path.
 */
export async function ensureFleetRuns (exec, configuredPath) {
  const dir = path.resolve(expandHome(configuredPath ?? FLEET_DEFAULTS.fleetRuns))
  let present = false
  try {
    const stat = await fsp.stat(path.join(dir, '.git'))
    present = stat.isDirectory() || stat.isFile()
  } catch {
    present = false
  }
  if (!present) {
    await fsp.mkdir(path.dirname(dir), { recursive: true })
    const res = await exec('git', ['clone', FLEET_RUNS_URL, dir])
    if (res.code !== 0) {
      refuse(`fleet-runs: git clone ${FLEET_RUNS_URL} failed: ${String(res.stderr).trim()}`)
    }
    return dir
  }
  const res = await git(exec, dir, ['pull', '--rebase'])
  if (res.code !== 0) {
    refuse(`fleet-runs: git pull --rebase in ${dir} failed: ${String(res.stderr).trim()}`)
  }
  return dir
}

/** The highest `run-<N>` a `plans/` directory holds, or 0. */
export async function highestPlanRun (fleetRunsDir) {
  let names
  try {
    names = await fsp.readdir(path.join(fleetRunsDir, 'plans'))
  } catch {
    return 0
  }
  let best = 0
  for (const name of names) {
    const match = /^run-([1-9][0-9]*)\.md$/.exec(name)
    if (match) best = Math.max(best, Number(match[1]))
  }
  return best
}

/** Read `runs/<N>/status.json` out of the clone. Null when it is not there yet. */
export async function readCommittedStatus (fleetRunsDir, run) {
  try {
    const text = await fsp.readFile(
      path.join(fleetRunsDir, 'runs', String(run), 'status.json'), 'utf8'
    )
    return JSON.parse(text)
  } catch {
    return null
  }
}
