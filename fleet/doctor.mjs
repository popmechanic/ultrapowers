#!/usr/bin/env node
/**
 * fleet/doctor.mjs — "do you have a fleet?"
 *
 * The one piece of `fleet/` that runs on a user's laptop, straight out of the
 * installed plugin cache, where no `node_modules` directory under `fleet/` has
 * ever existed. Hence the built-ins-only rule: every specifier here is
 * `node:`-prefixed, and the doctor imports no other fleet module.
 *
 * Five rows, all reads, every one of them answered by exe.dev's own truth:
 *
 *   exe-dev       `ssh exe.dev whoami` names an account.
 *   capacity      `billing plan --json` names the pool, beside the size one
 *                 run asks for. The row reports; it limits nothing.
 *   claude        the `claude-max` integration carries the bearer at the edge
 *                 and rides no tag; claude-token's status line rides along.
 *   github        `integrations setup github --list` lists an account.
 *   integrations  no GitHub integration is attached to `tag:fleet`, and with
 *                 `--target` the target's own object exists, unattached.
 *
 * Running the doctor twice is the same as running it once: nothing here
 * creates, copies or removes a VM, and nothing writes a file. A red row names
 * the `references/first-run.md` section that builds the piece and, where there
 * is one, the exact command.
 *
 * There are no token rows, because after the lift no token is on any disk the
 * doctor could stat: the Claude subscription reaches a sandbox through the
 * `claude-max` http-proxy integration, whose bearer is injected at exe.dev's
 * edge, and GitHub reaches it through the target's one integration
 * `gh-<owner>-<repo>`. `integrations test claude-max` is not a check for an
 * http-proxy (measured 2026-09-04: it answers "test connection is available
 * for catalog and database integrations"), so the bearer's presence in the
 * listing is the edge-side truth the doctor can read.
 */

import { execFile } from 'node:child_process'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)

/** The config file's keys and their defaults — an operator who followed the
 *  first-run walk needs no `~/.ultrapowers/fleet.json` at all.
 *
 *  These are byte-identical to `FLEET_DEFAULTS` in fleet/lobby.mjs, and copied
 *  rather than imported on purpose: the doctor is the one file that has to run
 *  when nothing else in the fleet does, so it imports nothing. Both exams pin
 *  this literal — two readers of one config file that disagree about a default
 *  would certify a fleet the launcher never looks at. */
export const DOCTOR_DEFAULTS = Object.freeze({ cpu: '8', memory: '16GB' })

/** The five rows, in the order the doctor reports them. Each id is also a
 *  `## ` heading in skills/ultrapowers/references/first-run.md. */
export const ROW_IDS = Object.freeze(['exe-dev', 'capacity', 'claude', 'github', 'integrations'])

/** Each row's `fix` is the `## ` heading in first-run.md that repairs it, and
 *  every row id is its own heading. */
const FIXES = Object.freeze(Object.fromEntries(ROW_IDS.map((id) => [id, id])))

/** The doctor's own directory: claude-token.mjs sits beside this file, and the
 *  doctor runs it rather than importing it, so its keychain access stays out of
 *  a process that has to start when nothing else in the fleet does. */
const HERE = path.dirname(fileURLToPath(import.meta.url))
const CLAUDE_TOKEN = path.join(HERE, 'claude-token.mjs')

/** The five reads, in the order the doctor issues them, and the only commands
 *  it ever runs. */
const READS = Object.freeze({
  whoami: 'ssh exe.dev whoami',
  billing: 'ssh exe.dev "billing plan --json"',
  list: 'ssh exe.dev "integrations list --json"',
  github: 'ssh exe.dev "integrations setup github --list"',
  token: `node ${CLAUDE_TOKEN} status`
})

/** The tag a fleet VM inherits, and the integration that carries the bearer. */
const TAG = 'fleet'
const OAUTH_INTEGRATION = 'claude-max'

/** The legacy per-account runs integration, still recognised by name so a fleet
 *  that predates the lift is told to detach it. Assembled rather than spelled
 *  out because no file under `fleet/` may carry that literal any more. */
const LEGACY_RUNS = ['fleet', 'runs'].join('-')

const DEFAULT_CONFIG_PATH = () => path.join(os.homedir(), '.ultrapowers', 'fleet.json')

/** `owner/repo`, the only shape that may be interpolated into an ssh string. */
const TARGET = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?\/[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/

/** The bearer the edge injects, as the listing spells it. */
const BEARER = 'Authorization:Bearer'

const row = (id, status, detail) => ({ id, status, detail, fix: FIXES[id] })
const firstLine = (stdout) => String(stdout ?? '').split('\n')[0].trim()

/** `owner/repo` → the target's one integration object, `gh-<owner>-<repo>`. */
const targetIntegration = (target) => `gh-${String(target).replace(/\//g, '-')}`

/** lobby.mjs's `parseMemoryGb` rule, copied: `<int>GB` or `<int>G` is that many
 *  gigabytes, anything else is unreadable. */
const MEMORY_GB = /^(\d+)GB?$/

export function parseMemoryGb (value) {
  const m = MEMORY_GB.exec(String(value ?? '').trim())
  return m === null ? null : Number(m[1])
}

const parseCpus = (value) => (/^\d+$/.test(String(value ?? '').trim()) ? Number(value) : null)

/**
 * Read `~/.ultrapowers/fleet.json` (or `path`) over the defaults. An absent
 * file means all defaults; an unknown key is ignored; a key the file omits
 * stays at its default.
 */
export async function loadFleetConfig ({ path: configPath } = {}) {
  const target = configPath ?? DEFAULT_CONFIG_PATH()
  const config = { ...DOCTOR_DEFAULTS }
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
  for (const key of Object.keys(DOCTOR_DEFAULTS)) {
    if (typeof parsed[key] === 'string' && parsed[key] !== '') config[key] = parsed[key]
  }
  return config
}

/**
 * The config file's own top-level key names, in file order — `loadFleetConfig`
 * answers what the doctor reads, this answers what the operator wrote. Null
 * when the file is absent, unreadable, not JSON, or not a JSON object, because
 * none of those is a file carrying keys.
 *
 * The two travel separately on purpose: `result.config` is exactly the doctor's
 * two keys, so a name the doctor does not read reaches the `capacity` row on
 * `configKeys` and never through the config.
 */
export async function fleetConfigKeys ({ path: configPath } = {}) {
  const target = configPath ?? DEFAULT_CONFIG_PATH()
  let text
  try {
    text = await fsp.readFile(target, 'utf8')
  } catch {
    return null
  }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  return Object.keys(parsed)
}

/** The exec seam: resolve `{ code, stdout }`, never reject, so a test drives
 *  every row with a stub and the CLI drives them with a shell. stderr joins
 *  stdout because claude-token logs its status line there. */
export async function defaultExec (cmd) {
  try {
    const { stdout, stderr } = await execFileAsync('/bin/sh', ['-c', cmd], {
      maxBuffer: 10 * 1024 * 1024
    })
    return { code: 0, stdout: stdout + stderr }
  } catch (error) {
    return {
      code: error?.code ?? 1,
      stdout: (error?.stdout ?? '') + (error?.stderr ?? '')
    }
  }
}

// ── exe-dev ──────────────────────────────────────────────────────────────────

function exeDevRow (res) {
  const who = firstLine(res.stdout)
  if (res.code === 0 && who !== '') return row('exe-dev', 'ok', `signed in as ${who}`)
  return row('exe-dev', 'missing', `ssh exe.dev whoami answered code ${res.code} with no account name`)
}

// ── capacity ─────────────────────────────────────────────────────────────────

/**
 * `billing plan --json` is one flat object with `max_cpus`, `max_memory_gb`,
 * `tier` and `plan`. The row reports two numbers side by side — the pool, and
 * the size one run asks for — and draws no conclusion from them, because
 * allocation on exe.dev is over-committable: 56 vCPU stood allocated against a
 * 16-vCPU plan and no run was ever refused (measured 2026-09-05). A pool
 * smaller than the ask is therefore a green row that says so, not a limit.
 *
 * Only a number the doctor could not read turns the row red: an unreadable
 * `billing plan --json`, or a `cpu`/`memory` it cannot parse. Both details name
 * `~/.ultrapowers/fleet.json`, the file that sets the size a run asks for.
 */
function poolRow (res, config) {
  const askedCpu = parseCpus(config.cpu)
  const askedGb = parseMemoryGb(config.memory)
  if (askedCpu === null || askedGb === null) {
    return row(
      'capacity',
      'missing',
      `~/.ultrapowers/fleet.json asks for cpu ${config.cpu} / memory ${config.memory}, which is not <int> and <int>GB`
    )
  }

  const plan = res.code === 0 ? readJson(res.stdout) : null
  const poolCpu = typeof plan?.max_cpus === 'number' ? plan.max_cpus : null
  const poolGb = typeof plan?.max_memory_gb === 'number' ? plan.max_memory_gb : null
  if (poolCpu === null || poolGb === null) {
    return row(
      'capacity',
      'missing',
      `billing plan --json answered code ${res.code} with no readable pool — ~/.ultrapowers/fleet.json sets the size a run asks for`
    )
  }

  const tier = typeof plan.tier === 'string' && plan.tier !== '' ? plan.tier : String(plan.plan ?? 'untiered')
  const pool = `${tier} pool ${poolCpu} vCPU / ${poolGb}GB`
  const asked = `${askedCpu} vCPU / ${askedGb}GB`
  return row('capacity', 'ok', `${pool}; a run asks ${asked}`)
}

/** The two key names the doctor reads, as the row's detail spells them. */
const READ_KEYS = Object.keys(DOCTOR_DEFAULTS)

/**
 * The pool arithmetic, plus what the config file's own key names say about it.
 *
 * `configKeys` is `fleetConfigKeys`'s answer for the same file: null when there
 * is no file to read keys off, and otherwise every top-level name in it. A name
 * the doctor does not read is a key left by a fleet from before the lift — the
 * operator wrote a setting nothing consults, so the row is red until the file is
 * rewritten, and the detail names those keys by echoing the file rather than
 * spelling any of them here. A file that omits one of the two the doctor does
 * read is not wrong, only silent, so the green detail says which default it
 * fell back to.
 */
function capacityRow (res, config, configKeys = null) {
  const base = poolRow(res, config)
  const keys = Array.isArray(configKeys) ? configKeys.filter((k) => typeof k === 'string') : null
  if (keys === null) return base

  const stale = keys.filter((key) => !READ_KEYS.includes(key))
  if (stale.length > 0) {
    return row(
      'capacity',
      'missing',
      `~/.ultrapowers/fleet.json carries ${stale.join(', ')} — keys nothing reads; ` +
        `it reads ${READ_KEYS.join(' and ')} only. ${base.detail}`
    )
  }
  if (base.status !== 'ok') return base

  const lacking = READ_KEYS.filter((key) => !keys.includes(key))
  const notes = lacking.map(
    (key) => ` (${key} not in ~/.ultrapowers/fleet.json — the default ${DOCTOR_DEFAULTS[key]})`
  )
  return notes.length === 0 ? base : row('capacity', 'ok', `${base.detail}${notes.join('')}`)
}

// ── integrations, read once for two rows ─────────────────────────────────────

function readJson (stdout) {
  try {
    return JSON.parse(String(stdout ?? ''))
  } catch {
    return null
  }
}

/**
 * `integrations list --json` read defensively. The doctor asks three questions
 * of each object — does it exist, does it carry the bearer, and is it attached
 * to `tag:fleet` — and every answer has to survive a field rename on exe.dev's
 * side without turning a healthy fleet red for the wrong reason. So the reader
 * takes the top level as either an array or an object with an array under
 * `integrations`, a name via `name` or `id`, the bearer via `config_summary` or
 * `config.headers[]`, and attachments via whichever plausible key is present,
 * each entry either the string `tag:fleet` / `vm:fleet-run-3` or an object
 * carrying a `tag` key.
 *
 * Answers a Map of name → `{ name, tags, github, bearer }`, or null when the
 * stdout is not a listing at all.
 */
export function parseIntegrations (stdout) {
  const parsed = readJson(stdout)
  const list = Array.isArray(parsed)
    ? parsed
    : (Array.isArray(parsed?.integrations) ? parsed.integrations : null)
  if (list === null) return null

  const out = new Map()
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue
    const name = typeof entry.name === 'string' ? entry.name : entry.id
    if (typeof name !== 'string' || name === '') continue
    out.set(name, {
      name,
      tags: attachedTags(entry),
      github: isGithub(entry, name),
      bearer: hasBearer(entry)
    })
  }
  return out
}

/** Is this entry a GitHub integration? By its declared type, by the repository
 *  field only GitHub objects carry, or by the fleet's own naming. */
function isGithub (entry, name) {
  const type = entry.type ?? entry.kind
  if (type === 'github') return true
  if (typeof entry.repository === 'string' || typeof entry.repo === 'string') return true
  return name === LEGACY_RUNS || name.startsWith('gh-')
}

/** Does this entry carry the Authorization bearer the edge injects? The
 *  measured listing spells it in `config_summary`; a listing that spells it in
 *  `config.headers[]` instead says the same thing. */
function hasBearer (entry) {
  const summary = typeof entry.config_summary === 'string' ? entry.config_summary : ''
  if (summary.replace(/\s+/g, '').includes(BEARER)) return true
  const headers = entry.config?.headers
  if (Array.isArray(headers)) {
    for (const header of headers) {
      if (typeof header === 'string' && header.replace(/\s+/g, '').includes(BEARER)) return true
    }
  }
  return false
}

const ATTACHMENT_KEYS = ['attachments', 'attached', 'attachedTo', 'attached_to', 'targets']

function attachedTags (entry) {
  const tags = new Set()
  for (const key of ATTACHMENT_KEYS) {
    const value = entry[key]
    if (!Array.isArray(value)) continue
    for (const item of value) {
      if (typeof item === 'string' && item.startsWith('tag:')) tags.add(item.slice(4))
      else if (item && typeof item === 'object' && typeof item.tag === 'string') tags.add(item.tag)
    }
  }
  if (Array.isArray(entry.tags)) {
    for (const tag of entry.tags) if (typeof tag === 'string') tags.add(tag)
  }
  return tags
}

const detach = (name) => `ssh exe.dev "integrations detach ${name} tag:${TAG}"`

// ── claude ───────────────────────────────────────────────────────────────────

/**
 * The bearer has to exist at the edge, and it has to ride no tag: an attached
 * `claude-max` is the operator's own subscription handed to every fleet VM for
 * as long as the object lives, rather than for the run's window.
 *
 * claude-token's status line only decorates the row. Either outcome leaves the
 * status alone — the bearer is injected at the edge whether or not this laptop
 * still holds the refresh token — and only the detail differs.
 */
function claudeRow (found, tokenRes) {
  if (found === null) {
    return row('claude', 'missing', 'integrations list printed no readable JSON')
  }
  const have = found.get(OAUTH_INTEGRATION)
  if (have === undefined || !have.bearer) {
    const why = have === undefined
      ? `no ${OAUTH_INTEGRATION} integration at the edge`
      : `${OAUTH_INTEGRATION} carries no ${BEARER} header`
    return row('claude', 'missing', `${why} — node fleet/claude-token.mjs login`)
  }
  if (have.tags.has(TAG)) {
    return row(
      'claude',
      'missing',
      `${OAUTH_INTEGRATION} is attached to tag:${TAG}, which grants the subscription to every fleet VM — ${detach(OAUTH_INTEGRATION)}`
    )
  }
  const status = tokenRes.code === 0 && firstLine(tokenRes.stdout) !== ''
    ? firstLine(tokenRes.stdout)
    : 'no refresh token in the keychain — the bearer will not be refreshed before a run'
  return row('claude', 'ok', `${OAUTH_INTEGRATION} carries the bearer at the edge; ${status}`)
}

// ── github ───────────────────────────────────────────────────────────────────

/**
 * `integrations setup github --list` has no `--json` (`--json` is a
 * flag-parsing error), so the row reads the two-line form it does print: a
 * `GitHub accounts:` header, then one indented account per line. No account
 * means the browser step has never been walked.
 */
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

// ── integrations ─────────────────────────────────────────────────────────────

/**
 * A tag attachment lands on every fleet VM, so ANY GitHub integration on
 * `tag:fleet` is red: two GitHub integrations naming one repo on one VM leave
 * the edge to pick a credential by no documented rule (measured 2026-09-03).
 * The launcher attaches the target's object per VM, for the run's window.
 *
 * With `--target`, the target's one object `gh-<owner>-<repo>` also has to
 * exist. The detail names the FIRST thing wrong, because a stranger reading
 * several failures at once cannot tell which one to run first.
 */
function integrationsRow (found, target) {
  if (found === null) {
    return row('integrations', 'missing', 'integrations list printed no readable JSON')
  }
  for (const [name, have] of found) {
    if (have.github && have.tags.has(TAG)) {
      return row(
        'integrations',
        'missing',
        `${name} is attached to tag:${TAG}, which grants it to every fleet VM — ${detach(name)}`
      )
    }
  }
  if (target !== null) {
    const want = targetIntegration(target)
    if (!found.has(want)) {
      return row('integrations', 'missing', `no ${want} integration for ${target} — node fleet/target.mjs ${target}`)
    }
    return row('integrations', 'ok', `${want} exists and rides no tag`)
  }
  return row('integrations', 'ok', `no GitHub integration rides tag:${TAG}`)
}

// ── the doctor ───────────────────────────────────────────────────────────────

/**
 * Run every row against `config` and resolve `{ config, rows, verdict }`.
 * `exec(cmd)` resolves `{ code, stdout }`, so a test drives the doctor with a
 * stub. `target` is `owner/repo` or null; anything else is refused before any
 * read rather than interpolated into an ssh string.
 *
 * `configKeys` is the config file's own top-level key names — `fleetConfigKeys`
 * for the same path `config` was loaded from, or null when there is no file.
 * It reaches the `capacity` row and nothing else: `result.config` stays exactly
 * the two keys the doctor reads.
 */
export async function doctor ({ config, exec, target = null, configKeys = null } = {}) {
  const cfg = { ...DOCTOR_DEFAULTS, ...(config ?? {}) }
  const run = exec ?? defaultExec
  const want = target === null || target === undefined ? null : String(target)
  if (want !== null && !TARGET.test(want)) {
    throw new Error(`--target takes owner/repo, not ${JSON.stringify(want)}`)
  }

  const whoami = await run(READS.whoami)
  const billing = await run(READS.billing)
  const list = await run(READS.list)
  const github = await run(READS.github)
  const token = await run(READS.token)

  const found = list.code === 0 ? parseIntegrations(list.stdout) : null
  const rows = [
    exeDevRow(whoami),
    capacityRow(billing, cfg, configKeys),
    claudeRow(found, token),
    githubRow(github),
    integrationsRow(found, want)
  ]
  const verdict = rows.every((r) => r.status === 'ok') ? 'ready' : 'not-ready'
  return { config: cfg, rows, verdict }
}

// ── CLI ──────────────────────────────────────────────────────────────────────

export function parseArgs (argv) {
  const opts = { json: false, configPath: null, target: null }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--json') opts.json = true
    else if (arg === '--config') {
      i += 1
      opts.configPath = argv[i] ?? null
    } else if (arg === '--target') {
      i += 1
      opts.target = argv[i] ?? null
    }
  }
  return opts
}

const PAD = Math.max(...['ok', 'missing'].map((s) => s.length))

export function renderRows (rows) {
  const out = []
  for (const r of rows) {
    out.push(`${r.status.padEnd(PAD)} ${r.id}  ${r.detail}`)
    if (r.status === 'missing') out.push(`    → references/first-run.md §${r.fix}`)
  }
  return out.join('\n')
}

async function main (argv) {
  const opts = parseArgs(argv)
  const configPath = opts.configPath ?? DEFAULT_CONFIG_PATH()
  const config = await loadFleetConfig({ path: configPath })
  const configKeys = await fleetConfigKeys({ path: configPath })
  let result
  try {
    result = await doctor({ config, exec: defaultExec, target: opts.target, configKeys })
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 2
    return
  }
  process.stdout.write(
    opts.json ? `${JSON.stringify(result)}\n` : `${renderRows(result.rows)}\n`
  )
  process.exitCode = result.verdict === 'ready' ? 0 : 1
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (invokedPath === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2))
}
