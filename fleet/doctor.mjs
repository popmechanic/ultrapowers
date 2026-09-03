#!/usr/bin/env node
/**
 * fleet/doctor.mjs — "do you have a fleet?"
 *
 * The one piece of `fleet/` that runs on a user's laptop, straight out of the
 * installed plugin cache, where no `node_modules` directory under `fleet/` has
 * ever existed. Hence the built-ins-only rule: every specifier here is
 * `node:`-prefixed, and the doctor imports no other fleet module.
 *
 * Three rows, all reads. Running the doctor twice is the same as running it
 * once: nothing here creates, copies or removes a VM, and nothing writes a
 * file. A red row names the `references/first-run.md` section that builds the
 * piece and, where there is one, the exact command.
 *
 * There are no token rows, because after the lift no token is on any disk the
 * doctor could stat: the Claude subscription reaches a sandbox through the
 * `claude-max` http-proxy integration, whose bearer is injected at exe.dev's
 * edge, and GitHub reaches it through the target's one integration
 * `gh-<owner>-<repo>`. What used to be two secret-file rows is one
 * `integrations` row.
 */

import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
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
 *  when nothing else in the fleet does, so it imports nothing. The copy is
 *  pinned by fleet/tests/test_doctor.mjs, which imports both and compares them
 *  — two readers of one config file that disagree about a default would
 *  certify a fleet the launcher never looks at.
 *
 *  The two paths are stored UNEXPANDED so the constant is comparable across
 *  machines. The doctor never resolves either — it reads only `golden` — but a
 *  row that ever opens one of them has to expand `~` first, the way
 *  lobby.mjs's `expandHome` does at the moment of use. */
export const DOCTOR_DEFAULTS = Object.freeze({
  golden: 'fleet-golden',
  fleetRuns: '~/.ultrapowers/fleet-runs',
  vmTokenPath: '~/.ultrapowers/vm-token'
})

/** The three rows, in the order the doctor reports them. Each id is also a
 *  `## ` heading in skills/ultrapowers/references/first-run.md. */
export const ROW_IDS = Object.freeze(['exe-dev', 'integrations', 'golden'])

/** Each row's `fix` is the `## ` heading in first-run.md that repairs it. */
const FIXES = Object.freeze({
  'exe-dev': 'exe-dev',
  integrations: 'integrations',
  golden: 'golden'
})

/** The stamp a golden build leaves: the sha256 of the `golden-setup.sh` that
 *  built it. Comparing the two is the whole of the golden row — an image built
 *  from an older script is the failure mode a hand-built golden had no way to
 *  report. */
const GOLDEN_STAMP = '/home/exedev/.fleet-golden'
const GOLDEN_SCRIPT = fileURLToPath(new URL('./golden-setup.sh', import.meta.url))

/** The integrations every fleet has, whatever it drives. */
const TAG = 'fleet'
const RUNS_INTEGRATION = 'fleet-runs'
const OAUTH_INTEGRATION = 'claude-max'
const NOTIFY_INTEGRATION = 'notify'

const DEFAULT_CONFIG_PATH = () => path.join(os.homedir(), '.ultrapowers', 'fleet.json')

const SHA256 = /^[0-9a-f]{64}$/
/** `owner/repo`, the only shape that may be interpolated into an ssh string. */
const TARGET = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?\/[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/

const row = (id, status, detail) => ({ id, status, detail, fix: FIXES[id] })
const firstLine = (stdout) => String(stdout ?? '').split('\n')[0].trim()

/** `owner/repo` → the target's one integration object, `gh-<owner>-<repo>`.
 *  A copy of lobby.mjs's `githubIntegrationFor`, pinned equal by the exam. */
export const targetIntegration = (target) => `gh-${String(target).replace(/\//g, '-')}`

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

/** The exec seam: resolve `{ code, stdout }`, never reject, so a test drives
 *  every row with a stub and the CLI drives them with a shell. */
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

async function exeDevRow (exec) {
  const res = await exec('ssh exe.dev whoami')
  const who = firstLine(res.stdout)
  if (res.code === 0 && who !== '') return row('exe-dev', 'ok', `signed in as ${who}`)
  return row('exe-dev', 'missing', `ssh exe.dev whoami answered code ${res.code} with no account name`)
}

// ── integrations ─────────────────────────────────────────────────────────────

/**
 * `integrations list --json` read defensively. The doctor asks two questions of
 * each object — does it exist, and is it attached to `tag:fleet` — and both
 * answers have to survive a field rename on exe.dev's side without turning a
 * healthy fleet red for the wrong reason. So the reader takes the top level as
 * either an array or an object with an array under `integrations`, a name from
 * `name` or `id`, and attachments from whichever of the plausible keys is
 * present, each entry either the string `tag:fleet` / `vm:fleet-run-3` or an
 * object carrying a `tag` or `vm` key.
 */
export function parseIntegrations (stdout) {
  let parsed
  try {
    parsed = JSON.parse(String(stdout ?? ''))
  } catch {
    return null
  }
  const list = Array.isArray(parsed)
    ? parsed
    : (Array.isArray(parsed?.integrations) ? parsed.integrations : null)
  if (list === null) return null

  const out = new Map()
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue
    const name = typeof entry.name === 'string' ? entry.name : entry.id
    if (typeof name !== 'string' || name === '') continue
    out.set(name, { name, tags: attachedTags(entry), github: isGithub(entry, name) })
  }
  return out
}

/** Is this entry a GitHub integration? By its declared type, by the
 *  repository field only GitHub objects carry, or by the fleet's own naming. */
function isGithub (entry, name) {
  const type = entry.type ?? entry.kind
  if (type === 'github') return true
  if (typeof entry.repository === 'string' || typeof entry.repo === 'string') return true
  return name === RUNS_INTEGRATION || name.startsWith('gh-')
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

/**
 * One `ssh` and one verdict for every integration a launch needs. The row's
 * detail names the FIRST thing wrong and the command that builds it, because
 * a stranger reading four failures at once cannot tell which one to run first.
 *
 * Only `fleet-runs` rides `tag:fleet`. `claude-max` exists and is on no tag —
 * the launcher attaches it per VM for the run's window. With `--target`, the
 * target's one object `gh-<owner>-<repo>` exists. Any GitHub integration other
 * than `fleet-runs` on the tag is red, whether or not `--target` named it: a
 * tag attachment lands on every fleet VM, and two GitHub integrations naming
 * one repo on one VM leave the edge to pick a credential by no documented rule
 * (measured 2026-09-03).
 */
async function integrationsRow (exec, target) {
  const res = await exec(`ssh exe.dev "integrations list --json"`)
  if (res.code !== 0) {
    return row('integrations', 'missing', `integrations list answered code ${res.code}`)
  }
  const found = parseIntegrations(res.stdout)
  if (found === null) {
    return row('integrations', 'missing', 'integrations list printed no readable JSON')
  }

  const wants = [
    { name: RUNS_INTEGRATION, tagged: true, fix: 'first-run.md §integrations builds it' },
    { name: OAUTH_INTEGRATION, tagged: false, fix: 'first-run.md §integrations builds it' },
    { name: NOTIFY_INTEGRATION, tagged: null, fix: 'enable notify on the exe.dev Integrations page' }
  ]
  if (target !== null) {
    wants.push({ name: targetIntegration(target), tagged: false, fix: `node fleet/target.mjs ${target}` })
  }

  for (const want of wants) {
    const have = found.get(want.name)
    if (have === undefined) {
      return row('integrations', 'missing', `no ${want.name} integration — ${want.fix}`)
    }
    if (want.tagged === true && !have.tags.has(TAG)) {
      return row('integrations', 'missing', `${want.name} is not attached to tag:${TAG} — ${want.fix}`)
    }
    if (want.tagged === false && have.tags.has(TAG)) {
      return row(
        'integrations',
        'missing',
        `${want.name} is attached to tag:${TAG}, which grants it to every fleet VM — ssh exe.dev "integrations detach ${want.name} tag:${TAG}"`
      )
    }
  }
  for (const [name, have] of found) {
    if (have.github && name !== RUNS_INTEGRATION && have.tags.has(TAG)) {
      return row(
        'integrations',
        'missing',
        `${name} is attached to tag:${TAG} — a GitHub integration is attached per VM, by the launcher; ssh exe.dev "integrations detach ${name} tag:${TAG}"`
      )
    }
  }

  const names = wants.map((w) => w.name).join(', ')
  return row('integrations', 'ok', names)
}

// ── golden ───────────────────────────────────────────────────────────────────

/** The sha256 of the checked-in `fleet/golden-setup.sh`, or null when the
 *  script is not readable from this plugin copy. */
export async function goldenScriptSha () {
  try {
    const bytes = await fsp.readFile(GOLDEN_SCRIPT)
    return createHash('sha256').update(bytes).digest('hex')
  } catch {
    return null
  }
}

/**
 * A golden is right when the image was built by the script this plugin ships.
 * The build writes the script's sha256 into `/home/exedev/.fleet-golden`, so
 * one `cat` and one local hash answer it — no probe VM, no inventory of what
 * the image contains, and no way for the two to agree by accident.
 *
 * A stamp that differs is not a broken image, it is an OLD one: the plugin has
 * moved on and the golden has not, which is exactly what `fleet/golden.sh
 * build` then `verify` then `swap` fixes.
 */
async function goldenRow (exec, config) {
  const res = await exec(`ssh ${config.golden}.exe.xyz cat ${GOLDEN_STAMP}`)
  const stamp = firstLine(res.stdout)
  if (res.code !== 0 || !SHA256.test(stamp)) {
    return row(
      'golden',
      'missing',
      `no build stamp at ${GOLDEN_STAMP} on ${config.golden} (code ${res.code}) — fleet/golden.sh build`
    )
  }
  const want = await goldenScriptSha()
  if (want === null) {
    return row('golden', 'missing', `cannot read ${GOLDEN_SCRIPT} to hash it`)
  }
  if (stamp !== want) {
    return row(
      'golden',
      'missing',
      `${config.golden} was built by golden-setup.sh ${stamp.slice(0, 12)}, this plugin ships ${want.slice(0, 12)} — fleet/golden.sh build`
    )
  }
  return row('golden', 'ok', `${config.golden} built by golden-setup.sh ${want.slice(0, 12)}`)
}

/**
 * Run every row against `config` and resolve `{ config, rows, verdict }`.
 * `exec(cmd)` resolves `{ code, stdout }`, so a test drives the doctor with a
 * stub. `target` is `owner/repo` or null; anything else is refused rather than
 * interpolated into an ssh string.
 */
export async function doctor ({ config, exec, target = null } = {}) {
  const cfg = { ...DOCTOR_DEFAULTS, ...(config ?? {}) }
  const run = exec ?? defaultExec
  const want = target === null || target === undefined ? null : String(target)
  if (want !== null && !TARGET.test(want)) {
    throw new Error(`--target takes owner/repo, not ${JSON.stringify(want)}`)
  }

  const rows = [
    await exeDevRow(run),
    await integrationsRow(run, want),
    await goldenRow(run, cfg)
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
  const config = await loadFleetConfig({ path: opts.configPath ?? DEFAULT_CONFIG_PATH() })
  const result = await doctor({ config, exec: defaultExec, target: opts.target })
  process.stdout.write(
    opts.json ? `${JSON.stringify(result)}\n` : `${renderRows(result.rows)}\n`
  )
  process.exitCode = result.verdict === 'ready' ? 0 : 1
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (invokedPath === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2))
}
