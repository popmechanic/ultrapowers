/**
 * fleet/lobby.mjs — the laptop's half of the fleet, in one place.
 *
 * There is no orchestrator and no control VM. A run is a number N per target;
 * its VM is `fleet-r<N>-<yymmddHHMM>-<4 hex>`, found again by `fleet-r<N>-*`.
 * Where its plan and record live (the operator's evidence repository; the
 * target receives only `ultra/integration-run-N`) is `fleet/CONTRACT.md`
 * section "The shape in one paragraph"; this file does not restate it.
 *
 * This module is what the three laptop CLIs (`launch`, `janitor`, `target`)
 * share: the exec seam, the config file, the name validators, the branch
 * names, the lobby readers, and the hub opened from its env file (`hubFromEnv`).
 * It runs from the installed plugin cache, so every specifier is
 * `node:`-prefixed or `./kata-client.mjs` (itself import-free), and there are
 * no npm dependencies.
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
import { fileURLToPath } from 'node:url'

import { makeKataClient, sshTransport } from './kata-client.mjs'

// ── Names and shas ──────────────────────────────────────────────────────────

/** `owner/repo`: exactly one slash, each half a git-safe name that starts and
 *  ends with a letter or digit — the only shape that may be interpolated into
 *  an ssh string, so `..` and a dot-led half are refused. */
const TARGET = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?\/[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/
export const isSafeTarget = (value) => typeof value === 'string' && TARGET.test(value)

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
 * One incarnation of a run: `fleet-r<N>-<yymmddHHMM>-<4 hex>`. exe.dev does not
 * reserve a deleted name, but a name is still minted once per launch and never
 * derived from N alone — the run's durable identity is N, in the comment and in the
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

/** The whole fleet, as the server-side `ls` pattern. */
export const FLEET_PATTERN = 'fleet-r*'

/** `<owner>/<repo>` → `<owner>-<repo>`, the slash-free half of an integration name,
 *  and the name of the target's one kata hub project (every run against one target
 *  files into it; a name the hub already holds answers the existing project). */
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

// ── The refs a run has on the target ────────────────────────────────────────

/**
 * The one branch a run pushes to the target: the work it integrated. It is
 * transient: delete-on-merge drops it, and `retire.mjs` sweeps the
 * closed-unmerged ones.
 */
export const integrationBranchFor = (run) => `ultra/integration-run-${run}`

/** The three branch shapes, in one regex — with or without a `refs/heads/` head. */
const RUN_BRANCH = /^(?:refs\/heads\/)?ultra\/(?:plan|integration|evidence)-run-([1-9][0-9]*)$/

/** The two tag shapes, likewise — with or without a `refs/tags/` head. */
const RUN_TAG = /^(?:refs\/tags\/)?ultra\/(?:plan|evidence)\/run-([1-9][0-9]*)$/

/**
 * The run a ref carries, or null — over both the branch shapes and the tag
 * shapes. `main` is null and so is a non-numeric tail like `ultra/plan-run-x`
 * or `ultra/plan/run-x`; so are a shape that exists in neither family
 * (`ultra/integration/run-7`) and the peeled `^{}` line an annotated tag adds
 * to an `ls-remote` listing. A run number is never guessed: anything that is
 * not one of the five shapes answers null rather than a number.
 */
export const runOfBranch = (ref) => {
  const text = String(ref ?? '')
  const match = RUN_BRANCH.exec(text) ?? RUN_TAG.exec(text)
  return match ? Number(match[1]) : null
}

// ── The evidence repository ─────────────────────────────────────────────────

/**
 * The evidence repository is the operator's setting (#1395): the key
 * `evidence` (`<owner>/<repo>`) in `~/.ultrapowers/fleet.json`, overridden for
 * one launch by `--evidence-repo`. Nothing derives it from the target, and
 * there is no default. Pure: the override when it is a safe target, else
 * `config.evidence` when it is one, else null.
 */
export const evidenceRepoFor = (config, override = null) => {
  if (isSafeTarget(override)) return override
  const setting = config?.evidence
  return isSafeTarget(setting) ? setting : null
}

/**
 * The one reader of the `evidence` key: its value, or null when the file is
 * absent, unreadable or not a JSON object, names no key, or names a value
 * `isSafeTarget` refuses. Beside `loadFleetConfig`, which stays the pool's.
 */
export async function readEvidenceSetting ({ path: configPath } = {}) {
  const parsed = await readFleetJson(configPath ?? DEFAULT_CONFIG_PATH())
  return parsed === null ? null : evidenceRepoFor(parsed)
}

/**
 * A run's place in the evidence repository, keyed by the TARGET's slug
 * (collision-free across owners — `facebook/react` lands in
 * `runs/facebook-react/<N>/`):
 *
 *   `runs/<slug>/<N>`       the run's folder
 *   `live/<slug>/run-<N>`   the branch the run writes while it flies
 *   `<slug>/run-<N>`        the tag that outlives it
 */
export const runFolderFor = (target, run) => `runs/${targetSlug(target)}/${run}`
export const liveBranchFor = (target, run) => `live/${targetSlug(target)}/run-${run}`
export const runTagFor = (target, run) => `${targetSlug(target)}/run-${run}`
export const evidenceUrlFor = (repo) => `https://github.com/${repo}.git`

const escapeRegex = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * The run an evidence-repository ref carries for `target`, or null — the live
 * branch or the tag, with or without its `refs/heads/` / `refs/tags/` head.
 * The slug is matched literally and as a whole path segment, so a foreign
 * slug, a peeled `^{}` line and a non-numeric tail are all null.
 */
export const runOfEvidenceRef = (target, ref) => {
  const slug = escapeRegex(targetSlug(target))
  const shape = new RegExp(
    `^(?:(?:refs/heads/)?live/${slug}/run-([1-9][0-9]*)|(?:refs/tags/)?${slug}/run-([1-9][0-9]*))$`
  )
  const match = shape.exec(String(ref ?? ''))
  return match ? Number(match[1] ?? match[2]) : null
}

// ── Constants the whole laptop side agrees on ───────────────────────────────

export const EXE_HOST = 'exe.dev'
export const FLEET_TAG = 'fleet'
/** The attachment policy every fleet integration carries: the tag a fleet VM is created with. */
export const FLEET_POLICY = `tag:${FLEET_TAG}`
/** The http-proxy integration that carries the Claude bearer at the edge. */
export const CLAUDE_INTEGRATION = 'claude-max'
export const ENGINE_REPO = 'popmechanic/ultrapowers'
export const ENGINE_URL = `https://github.com/${ENGINE_REPO}.git`
/** The assignment comment's hard ceiling — exe.dev's `comment` field. */
export const COMMENT_MAX_BYTES = 200
/** The lobby-verb record: the flag set per lobby verb, captured from the live
 *  lobby and committed beside this file. `VERBS_RECORD` is how a message names it. */
export const VERBS_RECORD = 'fleet/exe-verbs.json'
export const VERBS_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'exe-verbs.json')

// ── Config ──────────────────────────────────────────────────────────────────

/**
 * The config file's two keys and their defaults — the size a run asks of the
 * plan's pool, and nothing else. An operator who followed the RUNBOOK needs no
 * `~/.ultrapowers/fleet.json` at all. `doctor.mjs` imports this literal, so
 * the doctor and the launcher read one config file with one set of defaults.
 */
export const FLEET_DEFAULTS = Object.freeze({
  cpu: '8',
  memory: '16GB'
})

export const DEFAULT_CONFIG_PATH = () => path.join(os.homedir(), '.ultrapowers', 'fleet.json')

// ── The kata hub, as the laptop knows it ────────────────────────────────────

/** The one command that builds the hub, named by every refusal about it. */
export const KATA_HUB_FIX = 'node fleet/kata-hub.mjs'

/** Where `fleet/kata-hub.mjs` leaves the hub's address and bearer. */
export const defaultKataEnvPath = () => path.join(os.homedir(), '.ultrapowers', 'kata-hub.env')

/**
 * `~/.ultrapowers/kata-hub.env`, parsed: `{ url, token }` from its `KATA_URL=`
 * and `KATA_TOKEN=` lines, each `null` when the line is missing. The first
 * spelling of a key wins. Deciding what a missing line means is the caller's:
 * the launcher refuses, the janitor reads the target instead.
 */
export function parseKataEnv (text) {
  const fields = {}
  for (const line of String(text ?? '').split('\n')) {
    const m = /^(KATA_URL|KATA_TOKEN)=(.*)$/.exec(line.trim())
    if (m && !(m[1] in fields)) fields[m[1]] = m[2].trim()
  }
  return { url: fields.KATA_URL || null, token: fields.KATA_TOKEN || null }
}

/** The host `ssh` reaches the hub at: the `KATA_URL`'s hostname, or null. */
export const kataHostOf = (url) => {
  try {
    return new URL(String(url ?? '')).hostname || null
  } catch {
    return null
  }
}

/**
 * The hub, opened from its env file: read `kataEnvPath` (default
 * `defaultKataEnvPath()`), take its `KATA_URL`'s host, and build a kata client
 * for `actor` over `sshTransport` on that host. Resolves
 * `{ client, host, transport, dark }` and never throws on a missing or hostless
 * env: then `client`, `host` and `transport` are null and `dark` is the reason,
 * in the words every caller refuses or reports with.
 */
export async function hubFromEnv ({ exec, actor, kataEnvPath } = {}) {
  const envPath = kataEnvPath ?? defaultKataEnvPath()
  const none = (dark) => ({ client: null, host: null, transport: null, dark })
  let text
  try {
    text = await fsp.readFile(envPath, 'utf8')
  } catch (error) {
    return none(`no kata hub env at ${envPath} (${error?.code ?? error?.message ?? error}) — ${KATA_HUB_FIX}`)
  }
  const env = parseKataEnv(text)
  const host = kataHostOf(env.url)
  if (host === null) {
    return none(`${envPath} names KATA_URL ${JSON.stringify(env.url)}, not a url with a host — ${KATA_HUB_FIX}`)
  }
  const transport = sshTransport({ sshHost: host, exec })
  return { client: makeKataClient({ transport, actor }), host, transport, dark: null }
}

/**
 * Read `~/.ultrapowers/fleet.json` (or `path`) over the defaults. An absent
 * file means all defaults; an unknown key is ignored; a key the file omits
 * stays at its default. The doctor reads the config through this function too.
 */
export async function loadFleetConfig ({ path: configPath } = {}) {
  const parsed = await readFleetJson(configPath ?? DEFAULT_CONFIG_PATH())
  const config = { ...FLEET_DEFAULTS }
  for (const key of Object.keys(FLEET_DEFAULTS)) {
    if (typeof parsed?.[key] === 'string' && parsed[key] !== '') config[key] = parsed[key]
  }
  return config
}

/**
 * The one read of `~/.ultrapowers/fleet.json` (or `configPath`): the parsed
 * JSON object, or null when the file is absent, unreadable, not JSON, or not a
 * JSON object. Every reader of the file — the pool, the evidence key, the
 * doctor's key names and the default account — goes through it.
 */
export async function readFleetJson (configPath) {
  try {
    const parsed = JSON.parse(await fsp.readFile(configPath, 'utf8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
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

/** The bearer the edge injects, as the listing spells it (spaces ignored). */
const BEARER = 'Authorization:Bearer'

/** Does this entry carry the Authorization bearer the edge injects? The
 *  measured listing spells it in `config_summary`; a listing that spells it in
 *  `config.headers[]` instead says the same thing. */
function hasBearer (entry) {
  const carries = (text) => typeof text === 'string' && text.replace(/\s+/g, '').includes(BEARER)
  if (carries(entry?.config_summary)) return true
  const headers = entry?.config?.headers
  return Array.isArray(headers) && headers.some(carries)
}

/**
 * `ssh exe.dev "integrations list --json"` →
 * `[{ name, repository, attachments, bearer, comment, tags }]`. `bearer` is
 * whether the entry carries the edge's Authorization bearer, `comment` its own
 * comment string or null (the credential tool writes `account=<name>` into
 * `claude-max`'s), and `tags` the tag names its attachments and its own `tags`
 * field name.
 */
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

// ── The assignment comment ──────────────────────────────────────────────────

/** The comment's seven keys, in the order the contract spells them. The
 *  launcher always writes `kind=flock` (an older boot reads a missing `kind=`
 *  as the retired factory); `hold` is optional, and a comment read back may
 *  lack `kind=` when an older launcher wrote it. */
export const COMMENT_KEYS = Object.freeze([
  'run', 'plan', 'target', 'base', 'engine', 'kind', 'hold'
])

/**
 * Build the assignment comment: single line, space-separated `key=value`, keys
 * in contract order, optional `kind=` before optional `hold=` last. Every
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
 * The highest run number the target already carries, over the three branch
 * shapes *and* the two tag shapes, or 0 when it carries none. One `ls-remote`
 * against the clone's `origin`, carrying both patterns in the one call — the
 * refs are the truth, so nothing here reads a local branch that a stale fetch
 * might have left behind. The branches are transient, so a target whose runs
 * have all published carries only tags; reading the branches alone would hand
 * the next launch a number that is already taken.
 *
 * A non-zero `ls-remote` is a *refusal*, not a zero, for the same reason.
 */
export async function highestRunOnTarget (exec, repoDir) {
  const res = await git(exec, repoDir, ['ls-remote', 'origin', 'refs/heads/ultra/*', 'refs/tags/ultra/*'])
  if (res.code !== 0) {
    refuse(
      `git ls-remote origin 'refs/heads/ultra/*' 'refs/tags/ultra/*' in ${repoDir} ` +
      `failed (exit ${res.code}):\n${output(res)}`
    )
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

/**
 * The highest run `target` has in the evidence repository: one `ls-remote`
 * over its live branches and tags (run from `repoDir`), the highest
 * `runOfEvidenceRef` or 0. A non-zero listing is a refusal, never a zero.
 */
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

// ── Integration policy ──────────────────────────────────────────────────────

/**
 * `integrations policy get <name> --json` → `{ selector, revision }`, read
 * defensively: the selector is `policy.selector`, or `policy.wire` when a
 * listing spells it that way alone; `revision` is the top-level string. Either
 * field is null when absent; the whole answer is null when the stdout is not
 * JSON or carries neither. A caller that writes under `--if-revision` refuses
 * a null `revision` itself.
 */
export function parsePolicy (stdout) {
  let parsed
  try { parsed = JSON.parse(String(stdout ?? '')) } catch { return null }
  const policy = parsed?.policy
  const selector = typeof policy?.selector === 'string' ? policy.selector
    : typeof policy?.wire === 'string' ? policy.wire : null
  const revision = typeof parsed?.revision === 'string' ? parsed.revision : null
  if (selector === null && revision === null) return null
  return { selector, revision }
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
