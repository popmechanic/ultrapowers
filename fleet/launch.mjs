#!/usr/bin/env node
/**
 * fleet/launch.mjs — start one run. The whole client, on the laptop.
 *
 * A run is a number N. The launcher, in this order:
 *
 *   1. commits the plan and its verdicts to `popmechanic/fleet-runs` as
 *      `plans/run-N.md` and takes that commit's sha as `plan=`;
 *   2. `cp`s the golden to a fresh VM name (`fleet-r<N>-<yymmddHHMM>-<4 hex>`,
 *      `--copy-tags` so the `fleet` tag and `fleet-runs` come with it);
 *   3. attaches the run's per-VM, time-boxed grants — `claude-max` for 6 h and
 *      the target's `-ro` object for 6 h when one exists;
 *   4. writes the assignment comment — the record the sandbox reads once;
 *   5. waits until `ssh <ssh_dest> true` answers, then starts the run:
 *      `systemctl --user --no-block start fleet-run.service`.
 *
 * Start AFTER attach: the boot never races a grant. Nothing on the VM polls;
 * the comment is not a signal, the ssh start is.
 *
 * A refusal (exit 2) happens before step 2, so the account is exactly as it
 * was. A failure after that (exit 1) prints the lobby's own words: exe.dev
 * documents no error envelope, so a refused name or a full account is shown
 * verbatim rather than paraphrased.
 */

import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  CLAUDE_INTEGRATION,
  COMMENT_MAX_BYTES,
  ENGINE_URL,
  Refusal,
  LobbyError,
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
  output,
  parseArgs,
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
export const GRANT_FOR = '6h'

/** The start command, run over ssh on the VM once it answers. The user
 *  manager needs XDG_RUNTIME_DIR set for a non-login ssh session. */
export const START_COMMAND =
  'XDG_RUNTIME_DIR=/run/user/$(id -u) systemctl --user --no-block start fleet-run.service'

/** How long to wait for the fresh VM to answer ssh, and how often to ask. */
export const SSH_WAIT_MS = 120_000
export const SSH_RETRY_MS = 3_000
const SSH_OPTS = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5']

/** `ssh_dest` is an argv element, never shell text — but it is still checked
 *  to be one host-ish token before it is handed to ssh. */
const SSH_DEST = /^[A-Za-z0-9._@:-]+$/

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * The engine sha, when `--engine` was not given: the tip of the PUBLIC
 * ultrapowers repository, read with `git ls-remote`. The sandbox clones from
 * GitHub at `engine=`, so the only shas that can work are the ones GitHub
 * already has; a local `HEAD` is a sha the sandbox cannot fetch.
 */
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

/**
 * Everything the launcher does, with the exec seam, the clock, the sleep and
 * the name's random half injected. Answers the launched run's record.
 */
export async function launch ({
  argv, exec = defaultExec, config, now = () => new Date(), sleep = defaultSleep, rand
}) {
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

  // ── Reads. Still nothing mutated. The run number is one past the highest
  //    plan in fleet-runs: a plan is committed before any VM exists, so the
  //    plans directory is the complete record of runs ever launched. ────────
  const fleetRunsDir = await ensureFleetRuns(exec, settings.fleetRuns)
  const run = opts.run ? Number(opts.run) : await highestPlanRun(fleetRunsDir) + 1
  const roName = roIntegrationFor(target)
  const ro = (await listIntegrations(exec)).some((row) => row.name === roName)
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

  // ── The lobby verbs, then the ssh start. ──────────────────────────────────
  const vm = vmNameFor(run, now(), rand)
  const commands = []
  const verb = async (remote) => {
    commands.push(remote)
    return lobby(exec, remote)
  }

  await verb(`cp ${golden} ${vm} --copy-tags --json`)
  await verb(`integrations attach ${CLAUDE_INTEGRATION} vm:${vm} --for ${GRANT_FOR}`)
  let readGrant = 'none — public target, or run node fleet/target.mjs add ' + target
  if (ro) {
    await verb(`integrations attach ${roName} vm:${vm} --for ${GRANT_FOR}`)
    readGrant = `${roName} vm --for ${GRANT_FOR}`
  }
  const comment = buildComment({ ...fields, run: String(run), plan: planSha, engine })
  await verb(`comment ${vm} '${comment}'`)

  const row = (await listVms(exec, vm)).find((entry) => entry.name === vm)
  if (!row?.sshDest || !SSH_DEST.test(row.sshDest)) {
    throw new LobbyError(
      `launch: ls '${vm}' --json shows no usable ssh_dest for the VM cp just made (got ${JSON.stringify(row?.sshDest ?? null)}); start it by hand: ssh <ssh_dest> '${START_COMMAND}'`
    )
  }
  const sshDest = row.sshDest
  await waitForSsh({ exec, sshDest, vm, now, sleep })
  const start = await exec('ssh', [sshDest, START_COMMAND])
  if (start.code !== 0) {
    throw new LobbyError(`launch: ssh ${sshDest} '${START_COMMAND}' failed (exit ${start.code}):\n${output(start)}`)
  }

  return {
    run,
    runId: `run-${run}`,
    vm,
    sshDest,
    golden,
    statusUrl: statusUrlFor(vm),
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
 * A fresh `cp` answers `ls` before it answers ssh. Ask `ssh <dest> true` until
 * it does, for at most SSH_WAIT_MS; a VM that never answers is reported with
 * the last ssh output and the start command, since the grants and the comment
 * are already in place and only the start is owed.
 */
async function waitForSsh ({ exec, sshDest, vm, now, sleep }) {
  const deadline = now().getTime() + SSH_WAIT_MS
  for (;;) {
    const res = await exec('ssh', [...SSH_OPTS, sshDest, 'true'])
    if (res.code === 0) return
    if (now().getTime() >= deadline) {
      throw new LobbyError(
        `launch: ${vm} did not answer ssh ${sshDest} within ${SSH_WAIT_MS / 1000} s; last answer (exit ${res.code}):\n${output(res)}\nits grants and comment are in place — start it by hand: ssh ${sshDest} '${START_COMMAND}'`
      )
    }
    await sleep(SSH_RETRY_MS)
  }
}

/**
 * Commit the plan (and its verdicts) and answer the commit's sha. A push that
 * loses a race is retried once behind a rebase — `plans/` is append-only, so
 * the rebase can only be clean.
 */
async function commitPlan ({ exec, dir, added, run }) {
  const add = await git(exec, dir, ['add', '--', ...added])
  if (add.code !== 0) throw new Refusal(`fleet-runs: git add failed:\n${output(add)}`)
  const commit = await git(exec, dir, ['commit', '-m', `plan run-${run}`])
  if (commit.code !== 0) throw new Refusal(`fleet-runs: git commit failed:\n${output(commit)}`)
  let push = await git(exec, dir, ['push'])
  if (push.code !== 0) {
    await git(exec, dir, ['pull', '--rebase'])
    push = await git(exec, dir, ['push'])
  }
  if (push.code !== 0) throw new Refusal(`fleet-runs: git push failed:\n${output(push)}`)
  const head = await git(exec, dir, ['rev-parse', 'HEAD'])
  const sha = String(head.stdout).trim()
  if (!isFullSha(sha)) {
    throw new Refusal(`fleet-runs: git rev-parse HEAD answered ${JSON.stringify(sha)}, not a 40-hex sha`)
  }
  return sha
}

/** The four lines a launched run prints: its id, its VM, where to watch, what it was told. */
export const renderLaunch = (result) => [
  result.runId,
  result.vm,
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
