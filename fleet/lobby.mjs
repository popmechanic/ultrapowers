/**
 * fleet/lobby.mjs — the laptop's half of the fleet, in one place.
 *
 * There is no orchestrator and no control VM. A run is a number N; it lives on
 * the *target* repository as three branches — `ultra/plan-run-N`,
 * `ultra/integration-run-N`, `ultra/evidence-run-N` — and its VM is one
 * incarnation named `fleet-r<N>-<yymmddHHMM>-<4 hex>`, found again by the
 * pattern `fleet-r<N>-*`. Everything the laptop does is either a git command
 * against the target's clone or one exe.dev lobby verb issued as
 * `ssh exe.dev "<verb …>"`. There is no side repository: the run's durable
 * record is the target's own refs.
 *
 * This module is what the three laptop CLIs (`launch`, `janitor`, `target`)
 * share: the exec seam, the config file, the name validators, the branch
 * names, and the lobby readers. It runs from the installed plugin cache, so —
 * like `doctor.mjs` — every specifier is `node:`-prefixed and there are no npm
 * dependencies.
 *
 * ## The exec seam
 *
 * One function, `exec(cmd, argv, options?)`, resolving `{ code, stdout, stderr }`
 * and never rejecting. It is `execFile`, never a shell string: nothing this
 * process builds is ever parsed by a local shell. `options.input` is the only
 * way a secret reaches a child — written to its stdin, never to its argv. The
 * exe.dev lobby still parses the remote half (`ssh exe.dev "new fleet-r7-… --json"`
 * is one argv element), so every value interpolated into that string is
 * validated first — `isSafeTarget`, `isFullSha`, `isRunNumber`, `isVmName` —
 * and the only quoted field (the assignment comment) is built exclusively from
 * validated parts.
 */

import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

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
 * from N alone — the run's durable identity is N, in the comment and in the
 * target's three branches; the VM name is only where it is running this time.
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

// ── The three branches a run has on the target ──────────────────────────────

/**
 * A run's whole durable record is three branches on the target repository, all
 * under one `ultra/` prefix so a single `ls-remote refs/heads/ultra/*` sees the
 * fleet's entire history of that repo:
 *
 *   `ultra/plan-run-N`         the plan the launcher pushed before the VM booted
 *   `ultra/integration-run-N`  the work the run integrated
 *   `ultra/evidence-run-N`     what the run recorded about itself
 */
export const planBranchFor = (run) => `ultra/plan-run-${run}`
export const integrationBranchFor = (run) => `ultra/integration-run-${run}`
export const evidenceBranchFor = (run) => `ultra/evidence-run-${run}`

/** The three shapes, in one regex — with or without a `refs/heads/` head. */
const RUN_BRANCH = /^(?:refs\/heads\/)?ultra\/(?:plan|integration|evidence)-run-([1-9][0-9]*)$/

/**
 * The run a branch carries, or null. `main` is null and so is a non-numeric
 * tail like `ultra/plan-run-x` — a run number is never guessed, so anything
 * that is not one of the three shapes answers null rather than a number.
 */
export const runOfBranch = (ref) => {
  const match = RUN_BRANCH.exec(String(ref ?? ''))
  return match ? Number(match[1]) : null
}

// ── Constants the whole laptop side agrees on ───────────────────────────────

export const EXE_HOST = 'exe.dev'
export const FLEET_TAG = 'fleet'
export const ENGINE_REPO = 'popmechanic/ultrapowers'
export const ENGINE_URL = `https://github.com/${ENGINE_REPO}.git`
/** The http-proxy integration that injects the Claude OAuth token at the edge. */
export const CLAUDE_INTEGRATION = 'claude-max'
/** The assignment comment's hard ceiling — exe.dev's `comment` field. */
export const COMMENT_MAX_BYTES = 200

// ── Config ──────────────────────────────────────────────────────────────────

/**
 * The config file's two keys and their defaults — the size a run asks of the
 * plan's pool, and nothing else. An operator who followed the RUNBOOK needs no
 * `~/.ultrapowers/fleet.json` at all. `doctor.mjs` pins the same literal by
 * copy, because it imports nothing so that it runs when nothing else does.
 */
export const FLEET_DEFAULTS = Object.freeze({
  cpu: '8',
  memory: '16GB'
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

/**
 * The seam's real implementation: `execFile`, resolving, never a shell.
 *
 * `options.input` is written to the child's stdin and the stream is then
 * ended — a child that reads stdin to EOF (`cat`, `gh pr create --body-file -`)
 * must see one, or the promise never settles. Every other option is passed
 * through to `execFile`. Without `input` the child's stdin is left exactly as
 * `execFile` opened it.
 */
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

/** Everything a command printed, in one string — what an error carries. */
export const output = (res) => `${res.stdout ?? ''}${res.stderr ?? ''}`.trim()

/**
 * One lobby verb: `ssh exe.dev "<remote>"`, the remote half as ONE argv
 * element. A non-zero exit is a `LobbyError` carrying ALL of the output,
 * verbatim: exe.dev documents no error envelope, so nothing is parsed out and
 * nothing is dropped.
 *
 * `options.input` is handed to the seam as its third argument, so a verb that
 * must be fed a secret gets it on stdin and never in an argv a `ps` could read.
 * A verb with nothing to feed carries no third argument at all.
 */
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
  'run', 'plan', 'target', 'base', 'engine', 'overlap', 'tier', 'effort', 'hold'
])

/**
 * Build the assignment comment: single line, space-separated `key=value`, keys
 * in contract order, optional `overlap=`/`tier=`/`effort=`/`hold=` last. Every
 * value has already been validated by the caller; nothing here can introduce a
 * quote or a space.
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

// ── Reading the target's runs ───────────────────────────────────────────────

/**
 * The highest run number the target already carries, over all three branch
 * shapes, or 0 when it carries none. One `ls-remote` against the clone's
 * `origin` — the refs are the truth, so nothing here reads a local branch that
 * a stale fetch might have left behind.
 *
 * A non-zero `ls-remote` is a *refusal*, not a zero: answering 0 for a
 * repository we could not read would hand the next launch a run number that is
 * already taken.
 */
export async function highestRunOnTarget (exec, repoDir) {
  const res = await git(exec, repoDir, ['ls-remote', 'origin', 'refs/heads/ultra/*'])
  if (res.code !== 0) {
    refuse(`git ls-remote origin 'refs/heads/ultra/*' in ${repoDir} failed (exit ${res.code}):\n${output(res)}`)
  }
  let best = 0
  // `<sha>\t<ref>` per line; only the ref half carries the run.
  for (const line of String(res.stdout ?? '').split('\n')) {
    const ref = line.split('\t')[1]
    if (ref === undefined) continue
    const run = runOfBranch(ref.trim())
    if (run !== null && run > best) best = run
  }
  return best
}

// ── The plan's capacity ─────────────────────────────────────────────────────

const num = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null)

/**
 * `16GB` and `16G` are 16. A bare `16` carries no unit and a fractional
 * `1.5GB` is not a whole number of gigabytes — both answer null rather than a
 * number a caller would then size a VM with.
 */
export const parseMemoryGb = (text) => {
  const match = /^([1-9][0-9]*)\s*G(?:B)?$/i.exec(String(text ?? '').trim())
  return match ? Number(match[1]) : null
}

/**
 * `ssh exe.dev "billing plan --json"` → the four fields a launch sizes a VM
 * against. The payload (measured 2026-09-04) is one flat object with a dozen
 * keys; these four are read and the rest ignored, so a new key upstream is not
 * a failure here. A payload with no numeric `max_cpus` is a `LobbyError`
 * carrying the whole output: the verb answered, but not with a plan.
 */
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
