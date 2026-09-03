#!/usr/bin/env node
/**
 * fleet/doctor.mjs — "do you have a fleet?"
 *
 * The one piece of `fleet/` that runs on a user's laptop, straight out of the
 * installed plugin cache, where no `node_modules` directory under `fleet/` has
 * ever existed. Hence the built-ins-only rule: every specifier here is
 * `node:`-prefixed or exactly `./preflight.mjs`.
 *
 * `fleet/preflight.mjs` asks whether the orchestrator can fetch from a sandbox,
 * which presupposes that both VMs exist. The doctor checks that they do, and
 * that the posture the RUNBOOK builds is still in place, without changing
 * anything: every read-only row is a read, so running it twice is the same as
 * running it once. On a miss a row names the RUNBOOK section that fixes it.
 */

import { execFile } from 'node:child_process'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

import { preflight } from './preflight.mjs'

const execFileAsync = promisify(execFile)

/** The config file's four keys and their defaults — an operator who followed
 *  the RUNBOOK needs no `~/.ultrapowers/fleet.json` at all. */
export const DOCTOR_DEFAULTS = Object.freeze({
  orchestrator: 'fleet-orchestrator',
  golden: 'fleet-golden',
  repoDir: '/home/exedev/repo',
  tokenPath: '/home/exedev/.fleet/claude-oauth-token'
})

/** The six rows, in the order the doctor reports them. */
export const ROW_IDS = Object.freeze([
  'exe-dev',
  'orchestrator',
  'golden',
  'token',
  'github-token',
  'preflight'
])

/** Each row's `fix` is the exact `## ` heading in fleet/RUNBOOK.md that repairs it. */
const FIXES = Object.freeze({
  'exe-dev': 'exe.dev account',
  orchestrator: 'Orchestrator VM',
  golden: 'Golden VM build',
  token: 'Engine auth — the Max subscription, delivered per run (#213)',
  'github-token': 'GitHub auth (#368) — the orchestrator opens the PR',
  preflight: 'Preflight'
})

const PROBE_VM = 'fleet-doctor-probe'
/** Where every sandbox keeps its engine clone — a fixed path on the golden,
 *  not the orchestrator's `repoDir`. */
const ENGINE_DIR = '/home/exedev/repo'
/** The GitHub token a publish actually opens — a literal here, mirroring
 *  `GITHUB_TOKEN_PATH` in fleet/drive.mjs rather than importing it, because
 *  doctor.mjs may import nothing but `node:` and ./preflight.mjs. It is
 *  deliberately not a config key: a doctor that let the path be overridden
 *  would certify a file the run never opens. */
const GITHUB_TOKEN_PATH = '/home/exedev/.fleet/github-token'
const DEFAULT_CONFIG_PATH = () => path.join(os.homedir(), '.ultrapowers', 'fleet.json')

const HEX40 = /^[0-9a-f]{40}/
const MODE = /^[0-7]{3,4}$/
/** A GitHub login: alphanumerics and inner hyphens, nothing else. Anything a
 *  failing `gh` prints — a JSON error body, a usage line — falls outside it. */
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/

const row = (id, status, detail) => ({ id, status, detail, fix: FIXES[id] })
const firstLine = (stdout) => String(stdout ?? '').split('\n')[0].trim()

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

/** The RUNBOOK §Preflight exec shape: resolve `{ code, stdout }`, never reject. */
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

/** The `version` of the manifest the `show` command printed, or null when the
 *  command failed, printed no JSON, or carried no version string. */
function manifestVersion (stdout) {
  try {
    const version = JSON.parse(String(stdout ?? ''))?.version
    return typeof version === 'string' && version !== '' ? version : null
  } catch {
    return null
  }
}

/**
 * Three commands rather than one. The HEAD is what makes the row green; the
 * manifest and the tag are what make it useful — the version read is the
 * manifest at the orchestrator checkout's HEAD, the same commit a run pushes
 * as the engine, so what the doctor prints is what a run will execute. A
 * checkout that predates `.claude-plugin/plugin.json`, or a repo with no tags
 * to describe, is still an orchestrator: a failed read of either leaves the
 * row green and says only that the version is unreadable.
 */
async function orchestratorRow (exec, config) {
  const host = `${config.orchestrator}.exe.xyz`
  const res = await exec(`ssh ${host} 'git -C ${config.repoDir} rev-parse HEAD'`)
  const manifest = await exec(`ssh ${host} 'git -C ${config.repoDir} show HEAD:.claude-plugin/plugin.json'`)
  const described = await exec(`ssh ${host} 'git -C ${config.repoDir} describe --tags --always'`)

  const head = firstLine(res.stdout)
  if (res.code !== 0 || !HEX40.test(head)) {
    return row(
      'orchestrator',
      'missing',
      `no repo HEAD at ${config.repoDir} on ${config.orchestrator} (code ${res.code}: ${head || 'no output'})`
    )
  }

  const version = manifest.code === 0 ? manifestVersion(manifest.stdout) : null
  const describe = described.code === 0 ? firstLine(described.stdout) : ''
  const at = `${config.orchestrator} at ${head.slice(0, 40)}`
  return row(
    'orchestrator',
    'ok',
    version !== null && describe !== ''
      ? `${at} — ultrapowers ${version} (${describe})`
      : `${at} — version unreadable`
  )
}

/**
 * Three commands rather than one compound line: a single shell line makes the
 * first failure indistinguishable from the others, and a red golden row has to
 * name which of the three checks failed. The settings check is the one that
 * costs money — auth precedence is ANTHROPIC_API_KEY > apiKeyHelper >
 * CLAUDE_CODE_OAUTH_TOKEN, so a stray key in the golden's settings.json
 * silently bills a gateway instead of the subscription.
 *
 * The first command asks what a run actually consumes: an engine clone at
 * /home/exedev/repo whose `fleet/node_modules` is installed. The golden keeps an
 * inert plugin from earlier builds, and the doctor does not look for it —
 * a plugin list answers a question no run asks.
 */
async function goldenRow (exec, config) {
  const host = `${config.golden}.exe.xyz`
  const engine = await exec(`ssh ${host} 'test -d ${ENGINE_DIR}/fleet/node_modules && git -C ${ENGINE_DIR} rev-parse HEAD'`)
  const xdist = await exec(`ssh ${host} 'python3 -c "import xdist"'`)
  const settings = await exec(`ssh ${host} 'cat ~/.claude/settings.json'`)

  const failures = []
  const engineHead = firstLine(engine.stdout)
  if (engine.code !== 0 || !HEX40.test(engineHead)) {
    failures.push(
      `engine: no engine clone with fleet/node_modules at ${ENGINE_DIR} on ${config.golden} (code ${engine.code}: ${engineHead || 'no output'})`
    )
  }
  if (xdist.code !== 0) {
    failures.push(`xdist: python3 -c "import xdist" answered code ${xdist.code}`)
  }
  if (settings.code !== 0) {
    failures.push(`settings: could not read ~/.claude/settings.json (code ${settings.code})`)
  } else {
    const text = String(settings.stdout ?? '')
    const stray = ['ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL'].filter((k) => text.includes(k))
    if (stray.length > 0) {
      failures.push(`settings: ${stray.join(' and ')} in ~/.claude/settings.json would outrank the subscription token`)
    }
  }

  if (failures.length === 0) {
    return row('golden', 'ok', `${config.golden}: engine clone, xdist and settings all clean`)
  }
  return row('golden', 'missing', failures.join('; '))
}

/**
 * The token value never leaves the remote shell — `head -c 10` feeds `grep -q`
 * there, and only the yes/no result travels back. This row refuses to
 * propagate stdout into `detail` beyond the mode line and `prefix-ok`, so even
 * a mis-built command cannot echo the secret into a transcript.
 */
async function tokenRow (exec, config) {
  const res = await exec(
    `ssh ${config.orchestrator}.exe.xyz 'stat -c %a ${config.tokenPath} && head -c 10 ${config.tokenPath} | grep -q ^sk-ant-oat && echo prefix-ok'`
  )
  const lines = String(res.stdout ?? '').split('\n').map((l) => l.trim())
  const mode = lines.find((l) => MODE.test(l)) ?? null
  const prefixOk = lines.includes('prefix-ok')
  const modePart = mode === null ? 'mode unreadable' : `mode ${mode}`
  const prefixPart = prefixOk ? 'prefix-ok' : 'prefix check failed'

  if (res.code === 0 && lines.includes('600') && prefixOk) {
    return row('token', 'ok', `${modePart}, ${prefixPart}`)
  }
  return row('token', 'missing', `${modePart}, ${prefixPart} (code ${res.code})`)
}

/**
 * The GitHub token the orchestrator publishes with, checked the way the OAuth
 * row checks its own: one command, `$(cat …)` expanded in the orchestrator's
 * shell so the token value never travels to the laptop, and a detail that
 * carries only the mode and the one name the command was asked for.
 *
 * Without a target the question is "is this token still valid" and the answer
 * is a login. With one it is the sharper "can this token see the repo I am
 * about to drive" — a fine-grained token can be valid and still 404 on the
 * repository, which is a failed publish at the end of a run rather than a red
 * row before it. On a 404 `gh` prints a JSON error body to stdout, so the row
 * reads the mode as the first `^[0-7]{3,4}$` line, the login as the first
 * other line that looks like a login, and the repository as a line strictly
 * equal to the target; every other line is dropped unread.
 */
async function githubTokenRow (exec, config, target) {
  const query = target === null
    ? 'gh api user -q .login'
    : `gh api repos/${target} -q .full_name`
  const res = await exec(
    `ssh ${config.orchestrator}.exe.xyz 'stat -c %a ${GITHUB_TOKEN_PATH} && GH_TOKEN=$(cat ${GITHUB_TOKEN_PATH}) ${query}'`
  )

  const lines = String(res.stdout ?? '').split('\n').map((l) => l.trim())
  const modeAt = lines.findIndex((l) => MODE.test(l))
  const mode = modeAt === -1 ? null : lines[modeAt]
  const rest = lines.filter((_, i) => i !== modeAt)
  const name = target === null
    ? (rest.find((l) => LOGIN.test(l)) ?? null)
    : (rest.includes(target) ? target : null)

  const modePart = mode === null ? 'mode unreadable' : `mode ${mode}`
  if (res.code === 0 && mode === '600' && name !== null) {
    return row(
      'github-token',
      'ok',
      target === null ? `${modePart}, token valid as ${name}` : `${modePart}, reaches ${target}`
    )
  }
  return row(
    'github-token',
    'missing',
    target === null
      ? `${modePart}, token rejected (code ${res.code})`
      : `${modePart}, cannot reach ${target} (code ${res.code})`
  )
}

/**
 * The only row that creates anything, so it is opt-in via `probe` and stays
 * out of the way while an earlier row is red — a missing golden cannot be
 * cloned, and a missing orchestrator cannot fetch. The `rm` runs in a
 * `finally`, so a rejected preflight never strands a probe VM on the account.
 */
async function preflightRow (exec, config, probe, priorAllOk) {
  if (!probe) return row('preflight', 'skipped', 'not requested — pass --probe to clone a probe VM')
  if (!priorAllOk) return row('preflight', 'skipped', 'skipped while an earlier row is red')

  let status = 'missing'
  let detail = ''
  try {
    const cp = await exec(`ssh exe.dev "cp ${config.golden} ${PROBE_VM} --json"`)
    if (cp.code !== 0) {
      detail = `could not clone ${config.golden} into ${PROBE_VM} (code ${cp.code})`
    } else {
      const { verdict } = await preflight({
        orchVm: config.orchestrator,
        probeVm: PROBE_VM,
        exec
      })
      detail = verdict
      status = verdict === 'BLOCKED' ? 'missing' : 'ok'
    }
  } catch (error) {
    detail = `probe failed: ${error?.message ?? error}`
  } finally {
    try {
      await exec(`ssh exe.dev "rm ${PROBE_VM} --json"`)
    } catch {
      // The probe row is already red; a failed teardown adds nothing to say.
    }
  }
  return row('preflight', status, detail)
}

/**
 * Run every row against `config` and resolve `{ config, rows, verdict }`.
 * `exec(cmd)` resolves `{ code, stdout }` exactly as fleet/preflight.mjs
 * consumes it, so a test drives the doctor with a stub.
 */
export async function doctor ({ config, exec, probe = false, target = null } = {}) {
  const cfg = { ...DOCTOR_DEFAULTS, ...(config ?? {}) }
  const run = exec ?? defaultExec

  const readOnly = [
    await exeDevRow(run),
    await orchestratorRow(run, cfg),
    await goldenRow(run, cfg),
    await tokenRow(run, cfg),
    await githubTokenRow(run, cfg, target ?? null)
  ]
  const priorAllOk = readOnly.every((r) => r.status === 'ok')
  const last = await preflightRow(run, cfg, probe === true, priorAllOk)
  const rows = [...readOnly, last]

  const verdict = priorAllOk && (last.status === 'ok' || last.status === 'skipped')
    ? 'ready'
    : 'not-ready'

  return { config: cfg, rows, verdict }
}

// ── CLI ──────────────────────────────────────────────────────────────────────

export function parseArgs (argv) {
  const opts = { json: false, probe: false, configPath: null, target: null }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--json') opts.json = true
    else if (arg === '--probe') opts.probe = true
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

const PAD = Math.max(...['ok', 'missing', 'skipped'].map((s) => s.length))

export function renderRows (rows) {
  const out = []
  for (const r of rows) {
    out.push(`${r.status.padEnd(PAD)} ${r.id}  ${r.detail}`)
    if (r.status === 'missing') out.push(`    → RUNBOOK §${r.fix}`)
  }
  return out.join('\n')
}

async function main (argv) {
  const opts = parseArgs(argv)
  const config = await loadFleetConfig({ path: opts.configPath ?? DEFAULT_CONFIG_PATH() })
  const result = await doctor({
    config,
    exec: defaultExec,
    probe: opts.probe,
    target: opts.target
  })
  process.stdout.write(
    opts.json ? `${JSON.stringify(result)}\n` : `${renderRows(result.rows)}\n`
  )
  process.exitCode = result.verdict === 'ready' ? 0 : 1
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (invokedPath === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2))
}
