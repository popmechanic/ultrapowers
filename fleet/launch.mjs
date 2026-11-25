#!/usr/bin/env node

import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'


import {
  COMMENT_MAX_BYTES,
  ENGINE_URL,
  FLEET_DEFAULTS,
  FLEET_TAG,
  LobbyError,
  PLAN_FILE,
  Refusal,
  buildComment,
  defaultExec,
  evidenceRepoFor,
  evidenceUrlFor,
  git,
  githubIntegrationFor,
  highestRunInEvidence,
  integrationBranchFor,
  isFullSha,
  isRunNumber,
  isSafeSha,
  isSafeTarget,
  isVmName,
  listIntegrations,
  liveBranchFor,
  loadFleetConfig,
  lobby,
  output,
  parseArgs,
  parseMemoryGb,
  readEvidenceSetting,
  readPlanCapacity,
  runCli,
  runFolderFor,
  vmNameFor
} from './lobby.mjs'
import { fleetConfigAccount } from './doctor.mjs'
import { ACCOUNT_RE, DEFAULT_ACCOUNT } from './claude-token.mjs'
import { preflight } from './janitor.mjs'
import { readFleetFiles, renderSetupScript } from './setup-script.mjs'
import { compilePlanForRun, fetchCompilerAt, verifyPlanCompiles } from './compiler.mjs'
import { verifyPlanPins } from './plan-pins.mjs'
import { toolchainViolations } from './toolchain.mjs'
export const USAGE = `usage: node fleet/launch.mjs <plan.md> --target <owner>/<repo> --base <40-hex>
                             [--repo <dir>] [--engine <40-hex>] [--hold] [--again]
                             [--cpu <n>] [--memory <n>GB]
                             [--account <name>]
                             [--evidence-repo <owner>/<repo>] [--json]`

export const usage = () => USAGE

const NEW_INTEGRATION_FLAG = /(^|\s)--integration(=|\s|$)/

const VERDICTS_FILE = 'gate-verdicts.json'

const LAUNCH_FLAGS = [
  'account', 'again', 'base', 'cpu', 'engine', 'evidence-repo', 'hold', 'json', 'memory', 'repo', 'target'
]
const BASE_OFF_MAIN_FIX =
  'relaunch from main; a parked branch is re-driven as a plan on main, not as a base'

const SHALLOW_FIX = 'is a shallow clone — unshallow it by hand and relaunch'

const NEW_ATTEMPTS = 3
const RETRY_MIN_MS = 1_000
const RETRY_MAX_MS = 3_000

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const isPositiveInt = (value) => isRunNumber(value)

const isMemorySize = (value) => /^[1-9][0-9]*GB$/.test(String(value))

function vmSizeFor (width, cap = FLEET_DEFAULTS) {
  const w = Math.max(0, Math.floor(Number(width) || 0))
  const capCpu = Number(cap?.cpu ?? FLEET_DEFAULTS.cpu)
  const capGb = cap?.memoryGb ?? parseMemoryGb(cap?.memory ?? FLEET_DEFAULTS.memory)
  const wantGb = 2 + w
  return {
    cpu: String(Math.min(capCpu, 2 + Math.ceil(w / 3))),
    memory: `${Math.min(Number(capGb), wantGb)}GB`
  }
}

function sizeFromCompile (compiled, { cpuCap, memoryCap, cpu, memory } = {}) {
  const w = Math.max(1, Math.floor(Number(compiled?.payload?.width) || 0))
  const sized = vmSizeFor(w, { cpu: cpuCap, memory: memoryCap })
  return {
    width: w,
    cpu: cpu === undefined ? sized.cpu : cpuCap,
    memory: memory === undefined ? sized.memory : memoryCap
  }
}

function stampWidth (script, { width, cpu, memory }) {
  const note = `# fleet: width=${width} — the most tasks the parsed plan can have ready at once, which this box was cut to: --cpu ${cpu} --memory ${memory}.`
  const text = String(script ?? '')
  const firstLine = text.indexOf('\n')
  return firstLine < 0
    ? `${text}\n${note}\n`
    : `${text.slice(0, firstLine + 1)}${note}\n${text.slice(firstLine + 1)}`
}

const ORIGIN_SPELLINGS = Object.freeze([
  /^https:\/\/github\.com\/(.+?)(?:\.git)?\/?$/,
  /^git@github\.com:(.+?)(?:\.git)?\/?$/,
  /^ssh:\/\/git@github\.com\/(.+?)(?:\.git)?\/?$/
])

function targetOfOriginUrl (url) {
  const text = String(url ?? '').trim()
  for (const pattern of ORIGIN_SPELLINGS) {
    const match = pattern.exec(text)
    if (match && isSafeTarget(match[1])) return match[1]
  }
  return null
}

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

async function defaultEngineSha (exec) {
  const res = await exec('git', ['ls-remote', ENGINE_URL, 'HEAD'])
  if (res.code !== 0) {
    throw new Refusal(`engine: git ls-remote ${ENGINE_URL} HEAD failed:\n${output(res)}`)
  }
  const sha = String(res.stdout).trim().split(/\s+/)[0] ?? ''
  if (!isFullSha(sha)) {
    throw new Refusal(
      `engine: git ls-remote ${ENGINE_URL} HEAD answered no 40-hex sha (got ${JSON.stringify(sha.slice(0, 64))}); pass --engine <40-hex>`
    )
  }
  return sha
}

export function defaultRefreshCredential (account = DEFAULT_ACCOUNT, spawn = spawnSync) {
  const tool = new URL('./claude-token.mjs', import.meta.url).pathname
  const r = spawn(process.execPath, [tool, 'refresh', '--account', account], { encoding: 'utf8' })
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
  if (r.status === 0) {
    const held = out.split('\n').find((line) => line.startsWith('token: fresh until ') && line.endsWith('not rotated'))
    if (held !== undefined) return { ok: true, held, out }
    return { ok: true, out }
  }
  if (/no refresh token in the keychain/.test(out)) {
    const refused = `token: no refresh token in the keychain for account ${account}; ` +
      `pass the account the keychain holds (\`node fleet/claude-token.mjs accounts\`) or sign it in with ` +
      `\`node fleet/claude-token.mjs login --account ${account}\``
    return { ok: false, refused, out }
  }
  const refused = out.split('\n').find((line) => line.startsWith('token: expires '))
  if (refused !== undefined) return { ok: false, refused, out }
  return { ok: false, out }
}

export const USAGE_REFUSE_PCT = 95

export function defaultReadUsage (account = DEFAULT_ACCOUNT, spawn = spawnSync) {
  const tool = new URL('./claude-token.mjs', import.meta.url).pathname
  const r = spawn(process.execPath, [tool, 'usage', '--json', '--account', account, '--no-rotate'], { encoding: 'utf8' })
  if (r.status !== 0) {
    return { unread: true, reason: `claude-token usage --json exited ${r.status}: ${String(r.stderr ?? r.stdout ?? '').trim()}` }
  }
  let parsed
  try {
    parsed = JSON.parse(String(r.stdout ?? ''))
  } catch (error) {
    return { unread: true, reason: `claude-token usage --json answered unparseable stdout: ${error.message}` }
  }
  if (!Array.isArray(parsed) || parsed.length !== 1) {
    return { unread: true, reason: `claude-token usage --json answered no single-row array (got ${JSON.stringify(parsed)})` }
  }
  return parsed[0]
}

function publishRefusal ({ compiled, integrations }) {
  const publish = compiled?.payload?.publish
  if (publish === null || publish === undefined || typeof publish !== 'object') return null
  const rows = Array.isArray(integrations) ? integrations : []
  if (rows.some((row) => row?.name === 'cloudflare')) return null
  return 'launch: the plan carries a **Publish:** line but the fleet has no cloudflare integration — ' +
    'the deploy would have no credential at the edge; first-run.md §cloudflare walks the token, then launch again'
}

async function assetsConfigAtBase ({ exec, repoDir, base, compiled }) {
  const publish = compiled?.payload?.publish
  if (publish === null || publish === undefined || typeof publish !== 'object') return null
  const listed = await git(exec, repoDir, ['ls-tree', '-r', '--name-only', base])
  if (listed.code !== 0) return null
  const paths = String(listed.stdout ?? '').split('\n').map((l) => l.trim())
    .filter((l) => l === 'wrangler.jsonc' || l.endsWith('/wrangler.jsonc'))
  for (const p of paths) {
    const shown = await git(exec, repoDir, ['show', `${base}:${p}`])
    if (shown.code !== 0) continue
    let config
    try {
      config = JSON.parse(stripJsonc(String(shown.stdout ?? '')))
    } catch {
      continue
    }
    if (config !== null && typeof config === 'object' && !Array.isArray(config) &&
        Object.prototype.hasOwnProperty.call(config, 'assets')) return p
  }
  return null
}

function stripJsonc (text) {
  let out = ''
  let i = 0
  while (i < text.length) {
    const c = text[i]
    if (c === '"') {
      let j = i + 1
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1
      out += text.slice(i, j + 1)
      i = j + 1
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2)
      i = end === -1 ? text.length : end + 2
    } else {
      out += c
      i++
    }
  }
  return out.replace(/,(\s*[}\]])/g, '$1')
}

function usageRefusal (account, label, window) {
  return `launch: ${account} is at ${window.utilization}% of its ${label} window (resets ${window.resetsAt}) — ` +
    'a run on it can only die; pick another with --account — no VM was created and nothing was pushed'
}

function validateArgs (argv) {
  const { opts, positional } = parseArgs(argv, { flags: ['json', 'hold', 'again'] })
  for (const name of Object.keys(opts)) {
    if (!LAUNCH_FLAGS.includes(name)) throw new Refusal(`launch: unknown flag --${name}`)
  }

  const planPath = positional[0]
  if (!planPath) throw new Refusal(`launch: a plan path is required\n${usage()}`)
  const target = opts.target
  if (!isSafeTarget(target)) {
    throw new Refusal(`launch: --target must be <owner>/<repo>, got ${JSON.stringify(target ?? null)}`)
  }
  if (!isFullSha(opts.base)) {
    throw new Refusal(`launch: --base must be a 40-hex commit sha, got ${JSON.stringify(opts.base ?? null)}`)
  }
  if (opts.engine !== undefined && !isFullSha(opts.engine)) {
    throw new Refusal(`launch: --engine must be a 40-hex commit sha, got ${JSON.stringify(opts.engine)}`)
  }
  if (opts.hold !== undefined && opts.hold !== true) {
    throw new Refusal(`launch: --hold takes no value, got ${JSON.stringify(opts.hold)}`)
  }
  if (opts.again !== undefined && opts.again !== true) {
    throw new Refusal(`launch: --again takes no value, got ${JSON.stringify(opts.again)}`)
  }
  if (opts.account !== undefined && (opts.account === true || !ACCOUNT_RE.test(opts.account))) {
    throw new Refusal(
      `launch: --account must be a name matching ${ACCOUNT_RE.source}, got ${JSON.stringify(opts.account === true ? null : opts.account)}`
    )
  }
  return { opts, planPath }
}

async function checkCheckout ({ exec, repoDir, target, base }) {
  const shallow = await git(exec, repoDir, ['rev-parse', '--is-shallow-repository'])
  if (shallow.code === 0 && String(shallow.stdout ?? '').trim() === 'true') {
    throw new Refusal(
      `launch: --repo ${repoDir} ${SHALLOW_FIX}: a truncated history cannot answer whether --base ${base} is on ${target}'s default branch`
    )
  }

  const originUrl = await readOriginUrl({ exec, repoDir })
  const originTarget = targetOfOriginUrl(originUrl)
  if (originTarget !== target) {
    throw new Refusal(
      `launch: ${repoDir} has origin ${JSON.stringify(originUrl)}, which does not name ${target}`
    )
  }

  const baseCheck = await git(exec, repoDir, ['rev-parse', '--verify', `${base}^{commit}`])
  if (baseCheck.code !== 0) {
    throw new Refusal(
      `launch: ${repoDir} has no commit ${base}:\n${output(baseCheck)}`
    )
  }
}

async function checkBaseOnDefault ({ exec, repoDir, target, base }) {
  const origin = await readDefaultBranch({ exec, repoDir })
  const fetched = await git(exec, repoDir, ['fetch', 'origin', origin.branch])
  const hasTip = await git(exec, repoDir, ['cat-file', '-e', `${origin.tip}^{commit}`])
  if (hasTip.code !== 0) {
    throw new Refusal(
      `launch: ${repoDir} does not have ${target}'s ${origin.branch} tip ${origin.tip} — git fetch origin ${origin.branch} answered exit ${fetched.code}:\n${output(fetched)}`
    )
  }
  if (fetched.code === 0) {
    await git(exec, repoDir, ['update-ref', `refs/remotes/origin/${origin.branch}`, origin.tip])
  }
  const ancestry = await git(exec, repoDir, ['merge-base', '--is-ancestor', base, origin.tip])
  if (ancestry.code !== 0) {
    throw new Refusal(
      `launch: --base ${base} is not on ${target}'s ${origin.branch} (tip ${origin.tip}) — ${BASE_OFF_MAIN_FIX}`
    )
  }
}

async function refuseUnlaunchable ({ exec, repoDir, base, compiled, integrations, sizing }) {
  const publishRefused = publishRefusal({ compiled, integrations })
  if (publishRefused !== null) {
    throw new Refusal(publishRefused)
  }
  const assetsConfig = await assetsConfigAtBase({ exec, repoDir, base, compiled })
  if (assetsConfig !== null) {
    throw new Refusal(
      `launch: the plan carries a **Publish:** line but ${assetsConfig} at --base declares assets, ` +
      "and the edge refuses wrangler's asset upload (#1312) — add the pack step that serves the page " +
      'from the Worker and drop assets; no VM was created and nothing was pushed'
    )
  }
  const missingRunners = toolchainViolations(compiled)
  if (missingRunners.length) {
    throw new Refusal(missingRunners.map(({ task, word, cmd }) =>
      `launch: task ${task}: probe runner '${word}' is not in the sandbox toolchain — ${cmd}`
    ).join('\n'))
  }
  const size = sizeFromCompile(compiled, sizing)
  const memoryGb = parseMemoryGb(size.memory)

  const capacity = await readPlanCapacity(exec)
  if (capacity.maxCpus < Number(size.cpu)) {
    throw new Refusal(
      `launch: --cpu ${size.cpu} does not fit the plan — billing plan --json says max_cpus ${capacity.maxCpus}`
    )
  }
  if (capacity.maxMemoryGb < memoryGb) {
    throw new Refusal(
      `launch: --memory ${size.memory} does not fit the plan — billing plan --json says max_memory_gb ${capacity.maxMemoryGb}`
    )
  }
}

export function readCredential ({ account, refreshCredential, readUsage }) {
  const cred = refreshCredential(account)
  if (cred.refused) {
    throw new Refusal(`launch: ${cred.refused} — no VM was created and nothing was pushed`)
  }
  if (!cred.ok) {
    throw new LobbyError(`launch: the Claude credential could not be refreshed — no VM was created\n${cred.out}`)
  }

  const usageRow = readUsage(account)
  if (usageRow.unread) {
    return { cred, usageLine: `usage: ${account} unread — ${usageRow.reason}` }
  }
  const { sevenDay, fiveHour } = usageRow
  if (sevenDay && sevenDay.utilization >= USAGE_REFUSE_PCT) {
    throw new Refusal(usageRefusal(account, 'seven-day', sevenDay))
  }
  if (fiveHour && fiveHour.utilization >= USAGE_REFUSE_PCT) {
    throw new Refusal(usageRefusal(account, 'five-hour', fiveHour))
  }
  const shown = (window) => window ? `${window.utilization}% resets ${window.resetsAt}` : 'none'
  const usageLine = `usage: ${account} 7d ${shown(sevenDay)}; 5h ${shown(fiveHour)}`
  return { cred, usageLine }
}

export async function launch (params) {
  const held = { compilerDir: null }
  try {
    return await launchBody({ ...params, held })
  } finally {
    if (held.compilerDir !== null) {
      await fsp.rm(held.compilerDir, { recursive: true, force: true })
    }
  }
}

async function launchBody ({
  argv, exec = defaultExec, config, now = () => new Date(), sleep = defaultSleep, rand,
  refreshCredential = defaultRefreshCredential, readUsage = defaultReadUsage,
  held
}) {
  const { opts, planPath: givenPlanPath } = validateArgs(argv)
  const target = opts.target

  const settings = config ?? await loadFleetConfig()
  let account = opts.account === undefined ? null : String(opts.account)
  if (account === null) {
    const named = config === undefined || config === null
      ? await fleetConfigAccount()
      : config.account
    account = typeof named === 'string' && named !== '' ? named : DEFAULT_ACCOUNT
  }
  const evidenceFlag = opts['evidence-repo']
  if (evidenceFlag !== undefined && !isSafeTarget(evidenceFlag)) {
    throw new Refusal(
      `launch: --evidence-repo must be <owner>/<repo>, got ${JSON.stringify(evidenceFlag === true ? null : evidenceFlag)}`
    )
  }
  const evidenceSetting = config === undefined || config === null
    ? await readEvidenceSetting()
    : config.evidence
  const evidence = evidenceRepoFor({ evidence: evidenceSetting }, evidenceFlag ?? null)
  if (evidence === null) {
    throw new Refusal(
      'launch: no evidence repository — set "evidence": "<owner>/<repo>" in ~/.ultrapowers/fleet.json ' +
      'or pass --evidence-repo <owner>/<repo>; node fleet/doctor.mjs walks the one-time setup — ' +
      'no VM was created and nothing was pushed'
    )
  }
  const cpuCap = String(opts.cpu ?? settings.cpu ?? FLEET_DEFAULTS.cpu)
  const memoryCap = String(opts.memory ?? settings.memory ?? FLEET_DEFAULTS.memory)
  if (!isPositiveInt(cpuCap)) {
    throw new Refusal(`launch: cpu must be a positive integer, got ${JSON.stringify(cpuCap)}`)
  }
  if (!isMemorySize(memoryCap)) {
    throw new Refusal(`launch: memory must be a whole number of gigabytes spelled <int>GB, got ${JSON.stringify(memoryCap)}`)
  }

  const repoDir = path.resolve(String(opts.repo ?? process.cwd()))
  const planPath = path.resolve(repoDir, givenPlanPath)

  let planText
  try {
    planText = await fsp.readFile(planPath, 'utf8')
  } catch (error) {
    throw new Refusal(`launch: cannot read plan ${planPath}: ${error?.message ?? error}`)
  }
  if (planText.trim() === '') throw new Refusal(`launch: plan ${planPath} is empty`)
  let verdictsText = null
  try {
    verdictsText = await fsp.readFile(`${planPath.replace(/\.md$/, '')}.gate-verdicts.json`, 'utf8')
  } catch {
    verdictsText = null
  }

  const fields = {
    run: '0',
    plan: '0'.repeat(40),
    target,
    base: opts.base,
    engine: opts.engine ?? '0'.repeat(40),
    kind: KIND,
    hold: opts.hold === true ? '1' : undefined
  }
  const probeComment = buildComment(fields)
  if (Buffer.byteLength(probeComment, 'utf8') > COMMENT_MAX_BYTES) {
    throw new Refusal(
      `launch: assignment comment would be ${Buffer.byteLength(probeComment, 'utf8')} bytes, over the ${COMMENT_MAX_BYTES}-byte ceiling`
    )
  }

  await checkCheckout({ exec, repoDir, target, base: opts.base })

  await verifyPlanPins({ exec, repoDir, base: opts.base, planText })

  const engineSource = opts.engine === undefined ? 'main-tip' : 'pinned'
  const engine = opts.engine ?? await defaultEngineSha(exec)
  const compiler = await fetchCompilerAt({ exec, engine, pluginRoot: PLUGIN_ROOT })
  if (held !== undefined) held.compilerDir = compiler.dir

  const baseFacts = await verifyPlanCompiles({
    exec, repoDir, base: opts.base, planPath, planText, compilerPath: compiler.scriptPath
  })

  await checkBaseOnDefault({ exec, repoDir, target, base: opts.base })

  const integrations = await listIntegrations(exec)
  const githubName = githubIntegrationFor(target)
  if (!integrations.some((row) => row.name === githubName)) {
    throw new Refusal(
      `launch: no ${githubName} integration — the sandbox could still clone a public ${target} from github.com, but could not push its branch or open its PR. Build it once: node fleet/target.mjs ${target}`
    )
  }
  const evidenceGithubName = githubIntegrationFor(evidence)
  if (!integrations.some((row) => row.name === evidenceGithubName)) {
    throw new Refusal(
      `launch: no ${evidenceGithubName} integration — the run could not write its record to the evidence repository ${evidence}. ` +
      `Build it once: node fleet/target.mjs ${evidence} (node fleet/doctor.mjs walks the setup) — no VM was created and nothing was pushed`
    )
  }

  const { reaped, reapError, again } = await preflight({
    exec, now, evidence, repoDir, target, planText, again: opts.again
  })

  const inEvidence = await highestRunInEvidence(exec, repoDir, evidence, target)
  const firstRun = inEvidence + 1

  const firstCompiled = await compilePlanForRun({
    exec, repoDir, planPath, stamp: `run-${firstRun}`, compilerPath: compiler.parserPath
  })
  const sizing = { cpuCap, memoryCap, cpu: opts.cpu, memory: opts.memory }
  await refuseUnlaunchable({
    exec, repoDir, base: opts.base, compiled: firstCompiled, integrations, sizing
  })
  const { cred, usageLine } = readCredential({ account, refreshCredential, readUsage })

  const commands = []
  const plan = await pushPlan({
    exec,
    repoDir,
    target,
    evidence,
    base: opts.base,
    run: firstRun,
    planText,
    verdictsText,
    commands,
    reread: () => highestRunInEvidence(exec, repoDir, evidence, target)
  })
  const run = plan.run
  const liveBranch = plan.branch
  const planSha = plan.sha
  const { width, cpu, memory } = sizeFromCompile(firstCompiled, sizing)

  const comment = buildComment({ ...fields, run: String(run), plan: planSha, engine })
  const script = stampWidth(
    renderSetupScript({ run: String(run), evidence, ...readFleetFiles() }),
    { width, cpu, memory }
  )
  const remoteFor = (vm) => {
    const remote = `new --name ${vm} --tag ${FLEET_TAG} --comment '${comment}'` +
      ` --cpu ${cpu} --memory ${memory} --setup-script /dev/stdin --json`
    if (NEW_INTEGRATION_FLAG.test(remote)) {
      throw new Refusal(`launch: the \`new\` verb must not carry --integration — exe.dev refuses it since 2026-09-11; integrations reach a fleet VM by their attachment tag:${FLEET_TAG}`)
    }
    return remote
  }

  const minted = new Set()
  const failures = []
  let vm = null
  for (let attempt = 1; attempt <= NEW_ATTEMPTS; attempt += 1) {
    let name = vmNameFor(run, now(), rand)
    while (minted.has(name)) name = vmNameFor(run, now())
    if (!isVmName(name)) {
      throw new Refusal(`launch: minted VM name ${JSON.stringify(name)} is not fleet-r<N>-<yymmddHHMM>-<4 hex>`)
    }
    minted.add(name)
    const remote = remoteFor(name)
    commands.push(remote)
    try {
      await lobby(exec, remote, { input: script })
      vm = name
      break
    } catch (error) {
      failures.push(`attempt ${attempt} of ${NEW_ATTEMPTS} (${name}):\n${error?.message ?? error}`)
      if (attempt === NEW_ATTEMPTS) {
        throw new LobbyError(
          `launch: exe.dev refused \`new\` on all ${NEW_ATTEMPTS} attempts; run ${run}'s plan is on ${liveBranch} of ${evidence}\n${failures.join('\n')}`
        )
      }
      await sleep(retryDelay())
    }
  }

  return {
    run,
    runId: `run-${run}`,
    vm,
    comment,
    plan: planSha,
    evidence,
    liveBranch,
    integrationBranch: integrationBranchFor(run),
    target,
    base: opts.base,
    engine,
    engineSource,
    compiler: engine,
    account,
    usage: usageLine,
    ...(cred.held === undefined ? {} : { token: cred.held }),
    github: githubName,
    cpu,
    memory,
    width,
    launchedAt: now().toISOString(),
    commands,
    reaped,
    reapError,
    again,
    baseFacts
  }
}

const retryDelay = () =>
  RETRY_MIN_MS + Math.floor(Math.random() * (RETRY_MAX_MS - RETRY_MIN_MS + 1))

async function readOriginUrl ({ exec, repoDir }) {
  const res = await git(exec, repoDir, ['remote', 'get-url', 'origin'])
  if (res.code !== 0) {
    throw new Refusal(
      `launch: --repo ${repoDir} is not a git checkout with an origin remote:\n${output(res)}`
    )
  }
  return String(res.stdout ?? '').trim()
}

async function readDefaultBranch ({ exec, repoDir }) {
  const res = await git(exec, repoDir, ['ls-remote', '--symref', 'origin', 'HEAD'])
  if (res.code !== 0) {
    throw new Refusal(
      `launch: git ls-remote --symref origin HEAD in ${repoDir} failed (exit ${res.code}):\n${output(res)}`
    )
  }
  let branch = null
  let tip = null
  for (const line of String(res.stdout ?? '').split('\n')) {
    const symref = /^ref:\s+refs\/heads\/(\S+)\s+HEAD$/.exec(line.trim())
    if (symref) branch ??= symref[1]
    const head = /^([0-9a-f]{40})\s+HEAD$/.exec(line.trim())
    if (head) tip ??= head[1]
  }
  if (branch === null || tip === null || !/^[A-Za-z0-9][A-Za-z0-9._\-/]*$/.test(branch)) {
    throw new Refusal(
      `launch: git ls-remote --symref origin HEAD named no default branch and tip:\n${output(res)}`
    )
  }
  return { branch, tip }
}

async function commitPlan ({ exec, repoDir, target, base, run, planText, verdictsText = null }) {
  const indexDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'fleet-plan-'))
  const env = { ...process.env, GIT_INDEX_FILE: path.join(indexDir, 'index') }
  const plumb = async (argv, options = {}) => {
    const res = await exec('git', ['-C', repoDir, ...argv], { env, ...options })
    if (res.code !== 0) {
      throw new Refusal(`launch: git ${argv.join(' ')} failed (exit ${res.code}):\n${output(res)}`)
    }
    return String(res.stdout ?? '').trim()
  }
  try {
    const folder = runFolderFor(target, run)
    const entries = [[`${folder}/${PLAN_FILE}`, planText]]
    if (verdictsText !== null) entries.push([`${folder}/${VERDICTS_FILE}`, verdictsText])
    for (const [rel, text] of entries) {
      const blob = await plumb(['hash-object', '-w', '--stdin'], { input: text })
      if (!isSafeSha(blob)) {
        throw new Refusal(`launch: git hash-object answered ${JSON.stringify(blob)}, not an object name`)
      }
      await plumb(['update-index', '--add', '--cacheinfo', `100644,${blob},${rel}`])
    }
    const tree = await plumb(['write-tree'])
    if (!isSafeSha(tree)) {
      throw new Refusal(`launch: git write-tree answered ${JSON.stringify(tree)}, not an object name`)
    }
    const sha = await plumb(['commit-tree', tree, '-m', `ultrapowers plan ${target} run-${run} base ${base}`])
    if (!isFullSha(sha)) {
      throw new Refusal(`launch: git commit-tree answered ${JSON.stringify(sha)}, not a 40-hex sha`)
    }
    return sha
  } finally {
    await fsp.rm(indexDir, { recursive: true, force: true })
  }
}

const PUSH_ATTEMPTS = 3

async function pushPlan ({
  exec, repoDir, target, evidence, base, run, planText, verdictsText = null, commands, reread
}) {
  const url = evidenceUrlFor(evidence)
  let n = run
  for (let attempt = 1; attempt <= PUSH_ATTEMPTS; attempt += 1) {
    const branch = liveBranchFor(target, n)
    const sha = await commitPlan({ exec, repoDir, target, base, run: n, planText, verdictsText })
    const pushArgv = ['-C', repoDir, 'push', url, `${sha}:refs/heads/${branch}`]
    commands.push(`git ${pushArgv.join(' ')}`)
    const push = await exec('git', pushArgv)
    if (push.code === 0) {
      return { run: n, sha, branch }
    }

    const refusal = () =>
      new Refusal(
        `launch: git push ${url} ${sha}:refs/heads/${branch} failed` +
        `${attempt > 1 ? ` after ${attempt} tries` : ''} (exit ${push.code}):\n${output(push)}`
      )
    if (attempt === PUSH_ATTEMPTS) throw refusal()
    const highest = await reread()
    if (highest < n) throw refusal()
    n = highest + 1
  }
}

const engineLine = (result) =>
  result.engineSource === 'main-tip'
    ? `engine=${result.engine} (main tip; pass --engine <40-hex> to pin)`
    : null

const KIND = 'flock'

export const renderLaunch = (result) => [
  result.runId,
  result.vm,
  result.comment,
  ...(result.reaped ?? []).map((vm) => `reaped ${vm}`),
  ...(result.again ?? []).map((d) => `again run-${d.run} ${d.vm}`),
  result.account === undefined ? null : `account=${result.account}`,
  result.usage === undefined ? null : result.usage,
  result.token === undefined ? null : result.token,
  engineLine(result),
  result.compiler === undefined || result.compiler === null ? null : `compiler=${result.compiler}`,
  ...(result.baseFacts ?? [])
].filter((line) => line !== null).join('\n')

async function main (argv) {
  const { opts } = parseArgs(argv, { flags: ['json', 'hold', 'again'] })
  const result = await launch({ argv })
  process.stdout.write(opts.json ? `${JSON.stringify(result)}\n` : `${renderLaunch(result)}\n`)
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (invokedPath === fileURLToPath(import.meta.url)) {
  await runCli(main, process.argv.slice(2))
}
