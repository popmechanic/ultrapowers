/**
 * fleet/lobby.mjs — the laptop's half of the fleet, in one place.
 *
 * There is no orchestrator and no control VM. A run is a number N; its plan is
 * `plans/run-N.md` in `popmechanic/fleet-runs`; its VM is one incarnation
 * named `fleet-r<N>-<yymmddHHMM>-<4 hex>`, found again by the pattern
 * `fleet-r<N>-*`. Everything the laptop does is either a git command against
 * `fleet-runs` or one exe.dev lobby verb issued as `ssh exe.dev "<verb …>"`.
 *
 * This module is what the three laptop CLIs (`launch`, `janitor`, `target`)
 * share: the exec seam, the config file, the name validators, and
 * the two lobby readers. It runs from the installed plugin cache, so — like
 * `doctor.mjs` — every specifier is `node:`-prefixed and there are no npm
 * dependencies.
 *
 * ## The exec seam
 *
 * One function, `exec(cmd, argv)`, resolving `{ code, stdout, stderr }` and
 * never rejecting. It is `execFile`, never a shell string: nothing this process
 * builds is ever parsed by a local shell. The exe.dev lobby still parses the
 * remote half (`ssh exe.dev "cp fleet-golden fleet-r7-… --json"` is one argv
 * element), so every value interpolated into that string is validated first —
 * `isSafeTarget`, `isFullSha`, `isRunNumber`, `isVmName` — and the only quoted
 * field (the assignment comment) is built exclusively from validated parts.
 */

import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

// ── Names and shas ──────────────────────────────────────────────────────────

/** `owner/repo`: exactly one slash, each half a git-safe name. */
export const isSafeTarget = (value) =>
  typeof value === 'string' && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)

/** A git object name, as a pointer half. */
export const isSafeSha = (value) => typeof value === 'string' && /^[0-9a-f]{7,64}$/.test(value)

/**
 * The stricter shape the assignment comment carries. An abbreviation would let
 * two clones resolve one `base=` differently — so `base=` and `engine=` are
 * full shas or nothing.
 */
export const isFullSha = (value) => isSafeSha(value) && value.length === 40

/** A run number: a positive decimal integer with no leading zero. */
export const isRunNumber = (value) => /^[1-9][0-9]*$/.test(String(value))

/**
 * One incarnation of a run: `fleet-r<N>-<yymmddHHMM>-<4 hex>`. exe.dev keeps a
 * deleted name reserved, so a name is minted once per launch and never derived
 * from N alone — the run's durable identity is N, in the comment, the branch
 * and `fleet-runs`; the VM name is only where it is running this time.
 */
const VM_NAME = /^fleet-r([1-9][0-9]*)-[0-9]{10}-[0-9a-f]{4}$/

const stamp = (date) => {
  const two = (n) => String(n).padStart(2, '0')
  return `${String(date.getUTCFullYear()).slice(2)}${two(date.getUTCMonth() + 1)}${two(date.getUTCDate())}${two(date.getUTCHours())}${two(date.getUTCMinutes())}`
}

export const vmNameFor = (run, now = new Date(), rand = randomBytes(2).toString('hex')) =>
  `fleet-r${run}-${stamp(now)}-${rand}`

export const isVmName = (value) => typeof value === 'string' && VM_NAME.test(value)

/** The run number a VM name carries, or null when the name is not a run's. */
export const runOfVmName = (name) => {
  const match = VM_NAME.exec(String(name ?? ''))
  return match ? Number(match[1]) : null
}

/** Every incarnation of run N, as the server-side `ls` pattern. */
export const vmPatternFor = (run) => `fleet-r${run}-*`
/** The whole fleet. */
export const FLEET_PATTERN = 'fleet-r*'

/** `<owner>/<repo>` → `<owner>-<repo>`, the slash-free half of an integration name. */
export const targetSlug = (target) => String(target).replace('/', '-')

/**
 * The ONE GitHub integration a target has: `gh-<owner>-<repo>`, `--act-as-user`,
 * writable, attached per VM for the run's window. Named for the repository so
 * a plain `integrations list` shows two objects naming one repo without any
 * parsing — and two such objects on one VM is the fault the sandbox refuses
 * to boot into (measured 2026-09-03: the GitHub edge routes by repo path and
 * documents no tie-break between two integrations covering the same repo).
 */
export const githubIntegrationFor = (target) => `gh-${targetSlug(target)}`

/** The run's status page, served by `busybox httpd` on the VM's port 8000. */
export const statusUrlFor = (vmName) => `https://${vmName}.exe.xyz/status.json`

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
 * stays at its default. Same shape as `doctor.mjs`'s — copied, not imported,
 * because the doctor imports nothing so that it runs when nothing else does.
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

/** Everything a command printed, in one string — what an error carries. */
export const output = (res) => `${res.stdout ?? ''}${res.stderr ?? ''}`.trim()

/**
 * One lobby verb: `ssh exe.dev "<remote>"`, the remote half as ONE argv
 * element. A non-zero exit is a `LobbyError` carrying ALL of the output,
 * verbatim: exe.dev documents no error envelope, so nothing is parsed out and
 * nothing is dropped.
 */
export async function lobby (exec, remote) {
  const res = await exec('ssh', [EXE_HOST, remote])
  if (res.code !== 0) {
    const verb = remote.split(/\s+/)[0]
    throw new LobbyError(`exe.dev ${verb} failed (exit ${res.code}):\n${output(res)}`)
  }
  return res
}

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

/** A verb that ran and failed: exit 1, its whole output in the message. */
export class LobbyError extends Error {
  constructor (message) {
    super(message)
    this.name = 'LobbyError'
    this.exitCode = 1
  }
}

/** Run a CLI `main`, print a refusal or failure verbatim, set the exit code. */
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

const str = (value) => (typeof value === 'string' && value !== '' ? value : null)

/**
 * `ssh exe.dev "ls '<pattern>' --json"` → the rows under `.vms[]`, and ONLY
 * those: `.shared_vms[]` are other people's machines, and reading every array
 * in the envelope is how run-69 counted a shared VM as fleet. The pattern is
 * matched server-side, so the fleet is `fleet-r*` and one run is `fleet-r<N>-*`.
 * `vm_name`, `ssh_dest`, `ssh_host`, `status` are documented; `comment` and
 * `tags` are not, so they are read as optional and are null when absent.
 */
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

/**
 * One attachment, normalised to `{ kind, value }` where `kind` is `vm` or
 * `tag`. The listing may spell it as a string (`"vm:fleet-r7-…"`, `"tag:fleet"`)
 * or as an object (`{type,name}`, `{vm}`, `{tag}`); all four are read.
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
    const value = str(entry.name) ?? str(entry.value) ?? str(entry.target)
    if (kind && value) return { kind, value }
  }
  return null
}

/** `ssh exe.dev "integrations list --json"` → `[{ name, repository, attachments }]`. */
export async function listIntegrations (exec) {
  const res = await lobby(exec, 'integrations list --json')
  const payload = parseJson(res.stdout)
  const rows = Array.isArray(payload) ? payload
    : Array.isArray(payload?.integrations) ? payload.integrations : []
  return rows.map((row) => {
    const raw = row?.attachments ?? row?.attached ?? row?.attachedTo ?? row?.attached_to ??
      row?.targets ?? []
    const attachments = (Array.isArray(raw) ? raw : [raw]).map(normaliseAttachment).filter(Boolean)
    return {
      name: str(row?.name) ?? str(row?.integration) ?? str(row?.id),
      repository: str(row?.repository) ?? str(row?.repo),
      attachments
    }
  }).filter((row) => row.name)
}

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
    if (res.code !== 0) refuse(`fleet-runs: git clone ${FLEET_RUNS_URL} failed:\n${output(res)}`)
    return dir
  }
  const res = await git(exec, dir, ['pull', '--rebase'])
  if (res.code !== 0) refuse(`fleet-runs: git pull --rebase in ${dir} failed:\n${output(res)}`)
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

/** Every `runs/<N>/status.json` in the clone, as `[{ run, status }]`, N ascending. */
export async function listCommittedStatuses (fleetRunsDir) {
  let names
  try {
    names = await fsp.readdir(path.join(fleetRunsDir, 'runs'))
  } catch {
    return []
  }
  const runs = names.filter(isRunNumber).map(Number).sort((a, b) => a - b)
  const out = []
  for (const run of runs) {
    const status = await readCommittedStatus(fleetRunsDir, run)
    if (status) out.push({ run, status })
  }
  return out
}
