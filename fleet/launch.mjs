#!/usr/bin/env node
/**
 * fleet/launch.mjs — start one run. The whole client, on the laptop.
 *
 * A run is a VM named `fleet-run-<N>` and a comment on it. The launcher does
 * five things, in this order, and then walks away:
 *
 *   1. reads the world (`ls --json`, `billing usage --json`,
 *      `integrations list --json`) and refuses if it does not like it;
 *   2. commits the plan and its verdicts to `popmechanic/fleet-runs` and takes
 *      that commit's sha as `plan=`;
 *   3. `cp` the golden to `fleet-run-<N>` (the `fleet` tag is inherited, and
 *      with it the standing read grants);
 *   4. attaches the run's per-VM, time-boxed grants — `claude-max` for 6 h, the
 *      target's `-ro` object for 4 h when it is not already on the tag;
 *   5. writes the assignment comment — LAST, because the comment IS the start
 *      signal: the sandbox boots inert and polls Reflection until it appears.
 *
 * Nothing here reaches into a VM. There is no ssh session, no rsync, no
 * heredoc; the sandbox learns everything it needs from its own name, its own
 * comment, and GitHub.
 *
 * A refusal (exit 2) always happens before step 3, so the account is exactly as
 * it was. A failure after that (exit 1) names the verb that failed; the run's
 * VM may exist without a comment, which is inert and reaped by the janitor.
 */

import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  CLAUDE_INTEGRATION,
  COMMENT_MAX_BYTES,
  ENGINE_URL,
  FLEET_TAG,
  Refusal,
  LobbyError,
  attachedToTag,
  buildComment,
  defaultExec,
  ensureFleetRuns,
  git,
  highestPlanRun,
  isFullSha,
  isRunNumber,
  isSafeTarget,
  listIntegrations,
  listVms,
  loadFleetConfig,
  lobby,
  parseArgs,
  parseComment,
  roIntegrationFor,
  runCli,
  statusUrlFor,
  vmNameFor
} from './lobby.mjs'

/** One string, so a docs check that reads the first `usage` literal sees every
 *  flag the launch line may carry. */
export const USAGE = `usage: node fleet/launch.mjs <plan.md> --target <owner>/<repo> --base <40-hex>
                             [--engine <40-hex>] [--overlap fold|serialize]
                             [--tier standard|mostCapable] [--golden <vm>]
                             [--run <N>] [--config <path>] [--json]`

export const usage = () => USAGE

/** The two enumerated flags, with the exact spellings the comment carries. */
export const OVERLAP_VALUES = Object.freeze(['fold', 'serialize'])
export const TIER_VALUES = Object.freeze(['standard', 'mostCapable'])

/** How long each grant the launcher attaches lives. Wall clock; it lapses. */
export const CLAUDE_GRANT_FOR = '6h'
export const READ_GRANT_FOR = '4h'

/** Refuse to `cp` when the account is within this many VMs of its plan limit. */
export const VM_HEADROOM = 2

/**
 * Read `vm_count` and `max_vms`. `billing usage --json` is the meter; on the
 * accounts measured so far it also carries the limit, and when it does not the
 * limit comes from `billing plan --json`. Both are read-only and both run
 * before any mutating verb.
 */
async function readCapacity (exec) {
  const usageRes = await lobby(exec, 'billing usage --json')
  if (usageRes.code !== 0) {
    throw new LobbyError(
      `billing usage --json failed (code ${usageRes.code}): ${String(usageRes.stderr).trim()}`
    )
  }
  let payload
  try {
    payload = JSON.parse(String(usageRes.stdout).trim())
  } catch {
    payload = null
  }
  const number = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null)
  const vmCount = number(payload?.vm_count ?? payload?.vmCount)
  let maxVms = number(payload?.max_vms ?? payload?.maxVms)
  if (vmCount !== null && maxVms === null) {
    const planRes = await lobby(exec, 'billing plan --json')
    if (planRes.code === 0) {
      try {
        const plan = JSON.parse(String(planRes.stdout).trim())
        maxVms = number(plan?.max_vms ?? plan?.maxVms)
      } catch { /* an unreadable plan payload is the same as no limit */ }
    }
  }
  return { vmCount, maxVms }
}

/**
 * The engine sha, when `--engine` was not given: the tip of the PUBLIC
 * ultrapowers repository, read with `git ls-remote`.
 *
 * The simplest honest rule. The sandbox clones `https://github.com/popmechanic/
 * ultrapowers.git` at `engine=`, so the only shas that can possibly work are
 * the ones GitHub already has; a local `HEAD` in this checkout is a sha the
 * sandbox cannot fetch. If the operator wants a release commit or an older
 * engine, `--engine <40-hex>` pins it — no rule here can guess that.
 */
async function defaultEngineSha (exec) {
  const res = await exec('git', ['ls-remote', ENGINE_URL, 'HEAD'])
  if (res.code !== 0) {
    throw new Refusal(
      `engine: git ls-remote ${ENGINE_URL} HEAD failed: ${String(res.stderr).trim()}`
    )
  }
  const sha = String(res.stdout).trim().split(/\s+/)[0] ?? ''
  if (!isFullSha(sha)) {
    throw new Refusal(
      `engine: git ls-remote ${ENGINE_URL} HEAD answered no 40-hex sha (got ${JSON.stringify(sha.slice(0, 64))}); pass --engine <40-hex>`
    )
  }
  return sha
}

/**
 * The next run number: one past the highest `run=<N>` visible anywhere. Two
 * sources, because either alone goes stale — a live VM's comment knows about a
 * run whose plan is not yet merged into this clone, and `plans/run-<N>.md`
 * knows about a run whose VM has already been reaped.
 */
export function nextRunNumber ({ vms, highestPlan }) {
  let best = highestPlan
  for (const vm of vms) {
    const fromComment = parseComment(vm.comment).run
    if (isRunNumber(fromComment)) best = Math.max(best, Number(fromComment))
    const fromName = /^fleet-run-([1-9][0-9]*)$/.exec(vm.name ?? '')
    if (fromName) best = Math.max(best, Number(fromName[1]))
  }
  return best + 1
}

/**
 * Everything the launcher does, with the exec seam and the clock injected.
 * Answers `{ run, vm, statusUrl, comment, plan, base, engine, target }`.
 */
export async function launch ({ argv, exec = defaultExec, config, now = () => new Date() }) {
  const { opts, positional } = parseArgs(argv, { flags: ['json'] })

  // ── Local validation. Nothing has been executed at this point, and nothing
  //    will be until every one of these passes. ──────────────────────────────
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
  if (opts.overlap !== undefined && !OVERLAP_VALUES.includes(opts.overlap)) {
    throw new Refusal(`launch: --overlap must be one of ${OVERLAP_VALUES.join('|')}, got ${JSON.stringify(opts.overlap)}`)
  }
  if (opts.tier !== undefined && !TIER_VALUES.includes(opts.tier)) {
    throw new Refusal(`launch: --tier must be one of ${TIER_VALUES.join('|')}, got ${JSON.stringify(opts.tier)}`)
  }
  if (opts.run !== undefined && !isRunNumber(opts.run)) {
    throw new Refusal(`launch: --run must be a positive integer, got ${JSON.stringify(opts.run)}`)
  }
  let planText
  try {
    planText = await fsp.readFile(planPath, 'utf8')
  } catch (error) {
    throw new Refusal(`launch: cannot read plan ${planPath}: ${error?.message ?? error}`)
  }
  if (planText.trim() === '') throw new Refusal(`launch: plan ${planPath} is empty`)

  // The comment's length does not depend on which sha the plan commit gets —
  // every sha is 40 hex — so the ceiling is checked here, before the world is
  // touched, with a placeholder standing in for `plan=`.
  const fields = {
    run: opts.run ?? '0',
    plan: '0'.repeat(40),
    target,
    base: opts.base,
    engine: opts.engine ?? '0'.repeat(40),
    overlap: opts.overlap,
    tier: opts.tier
  }
  const probeComment = buildComment(fields)
  if (Buffer.byteLength(probeComment, 'utf8') > COMMENT_MAX_BYTES) {
    throw new Refusal(
      `launch: assignment comment would be ${Buffer.byteLength(probeComment, 'utf8')} bytes, over the ${COMMENT_MAX_BYTES}-byte ceiling`
    )
  }

  const settings = config ?? await loadFleetConfig({ path: opts.config })
  const golden = opts.golden ?? settings.golden

  // ── Reads. Still nothing mutated. ─────────────────────────────────────────
  const fleetRunsDir = await ensureFleetRuns(exec, settings.fleetRuns)
  const vms = await listVms(exec)
  const run = opts.run ? Number(opts.run) : nextRunNumber({
    vms,
    highestPlan: await highestPlanRun(fleetRunsDir)
  })
  const vm = vmNameFor(run)
  if (vms.some((row) => row.name === vm)) {
    throw new Refusal(`launch: ${vm} already exists — pass --run <N> for a free number`)
  }

  const { vmCount, maxVms } = await readCapacity(exec)
  if (vmCount !== null && maxVms !== null && vmCount >= maxVms - VM_HEADROOM) {
    throw new Refusal(
      `launch: no room — vm_count ${vmCount} of max_vms ${maxVms} (need ${VM_HEADROOM} spare); reap with node fleet/janitor.mjs`
    )
  }

  const integrations = await listIntegrations(exec)
  const roName = roIntegrationFor(target)
  const ro = integrations.find((row) => row.name === roName) ?? null
  const engine = opts.engine ?? await defaultEngineSha(exec)

  // ── The plan commit. A local git failure is still a refusal: exe.dev has
  //    seen nothing but reads. ────────────────────────────────────────────────
  const planName = `run-${run}.md`
  const verdictsName = `run-${run}.gate-verdicts.json`
  const stem = planPath.replace(/\.md$/, '')
  await fsp.mkdir(path.join(fleetRunsDir, 'plans'), { recursive: true })
  await fsp.writeFile(path.join(fleetRunsDir, 'plans', planName), planText)
  const added = [`plans/${planName}`]
  let verdicts = null
  try {
    verdicts = await fsp.readFile(`${stem}.gate-verdicts.json`, 'utf8')
  } catch {
    verdicts = null
  }
  if (verdicts !== null) {
    await fsp.writeFile(path.join(fleetRunsDir, 'plans', verdictsName), verdicts)
    added.push(`plans/${verdictsName}`)
  }
  const planSha = await commitPlan({ exec, dir: fleetRunsDir, added, run })

  // ── The four lobby verbs. The comment is last. ────────────────────────────
  const commands = []
  const verb = async (remote) => {
    commands.push(remote)
    const res = await lobby(exec, remote)
    if (res.code !== 0) {
      throw new LobbyError(`launch: \`${remote}\` failed (code ${res.code}): ${String(res.stderr).trim()}`)
    }
    return res
  }

  await verb(`cp ${golden} ${vm} --json`)
  await verb(`integrations attach ${CLAUDE_INTEGRATION} vm:${vm} --for=${CLAUDE_GRANT_FOR}`)
  let readGrant = 'none'
  if (ro && attachedToTag(ro)) {
    readGrant = `tag:${FLEET_TAG}`
  } else if (ro) {
    await verb(`integrations attach ${roName} vm:${vm} --for=${READ_GRANT_FOR}`)
    readGrant = `vm --for=${READ_GRANT_FOR}`
  } else {
    readGrant = 'none — public target, or run node fleet/target.mjs add ' + target
  }

  const comment = buildComment({ ...fields, run: String(run), plan: planSha, engine })
  await verb(`comment ${vm} '${comment}'`)

  return {
    run,
    runId: `run-${run}`,
    vm,
    golden,
    statusUrl: statusUrlFor(run),
    comment,
    plan: planSha,
    planPath: `plans/${planName}`,
    verdicts: verdicts !== null,
    target,
    base: opts.base,
    engine,
    readGrant,
    fleetRuns: fleetRunsDir,
    launchedAt: now().toISOString(),
    commands
  }
}

/**
 * Commit the plan (and its verdicts) and answer the commit's sha. A push that
 * loses a race is retried once behind a rebase — `plans/` is append-only, so
 * the rebase can only be clean.
 */
async function commitPlan ({ exec, dir, added, run }) {
  const add = await git(exec, dir, ['add', '--', ...added])
  if (add.code !== 0) throw new Refusal(`fleet-runs: git add failed: ${String(add.stderr).trim()}`)
  const commit = await git(exec, dir, ['commit', '-m', `plan run-${run}`])
  if (commit.code !== 0) {
    throw new Refusal(`fleet-runs: git commit failed: ${String(commit.stderr || commit.stdout).trim()}`)
  }
  let push = await git(exec, dir, ['push'])
  if (push.code !== 0) {
    await git(exec, dir, ['pull', '--rebase'])
    push = await git(exec, dir, ['push'])
  }
  if (push.code !== 0) {
    throw new Refusal(`fleet-runs: git push failed: ${String(push.stderr).trim()}`)
  }
  const head = await git(exec, dir, ['rev-parse', 'HEAD'])
  const sha = String(head.stdout).trim()
  if (!isFullSha(sha)) {
    throw new Refusal(`fleet-runs: git rev-parse HEAD answered ${JSON.stringify(sha)}, not a 40-hex sha`)
  }
  return sha
}

/** The three lines a launched run prints: its id, where to watch, what it was told. */
export const renderLaunch = (result) => [
  result.runId,
  result.statusUrl,
  result.comment
].join('\n')

async function main (argv) {
  const { opts } = parseArgs(argv, { flags: ['json'] })
  const result = await launch({ argv })
  process.stdout.write(opts.json ? `${JSON.stringify(result)}\n` : `${renderLaunch(result)}\n`)
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (invokedPath === fileURLToPath(import.meta.url)) {
  await runCli(main, process.argv.slice(2))
}
