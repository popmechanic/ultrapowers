#!/usr/bin/env node
/**
 * fleet/grant.mjs — the operator's approval, as a fifteen-minute write grant.
 *
 * The pre-merge gate has always been the operator's act. After the lift it is
 * also the only thing standing between a green run and a pull request, and it
 * is expressed the way exe.dev expresses trust: an integration attachment, per
 * VM, time-boxed, that lapses on its own with nothing to revoke.
 *
 *   node fleet/grant.mjs <N> [--for 15m] [--live] [--target <owner>/<repo>]
 *
 * Two reads, then two verbs:
 *
 *   - the run's status must say `awaiting-grant`. That state is written only
 *     after the engine's systemd scope is empty, so granting write access
 *     cannot hand a still-running model a push credential. (Honestly: the
 *     sandbox is asserting about itself. What bounds a hostile model is 15
 *     minutes, one repo, a PR rather than a merge, and a human at the button.)
 *   - `integrations detach t-<owner>-<repo>-ro vm:fleet-run-<N>` FIRST, then
 *     `integrations attach t-<owner>-<repo>-rw vm:fleet-run-<N> --for=15m`.
 *     Never overlapping: `github.int.exe.xyz` resolves one credential per repo.
 *
 * ## Where the status comes from
 *
 * By default, out of the `fleet-runs` clone: the sandbox commits
 * `runs/<N>/status.json` when the engine exits, so a `git pull` answers the
 * question with the laptop's own git credential and no exe.dev token at all.
 * `--live` reads `https://fleet-run-<N>.exe.xyz/status.json` instead, with a VM
 * token from `vmTokenPath` — which the operator must have minted for THAT VM
 * (`ssh exe.dev ssh-key generate-api-key --vm=fleet-run-<N> --exp=…`), because
 * VM tokens are per VM. That per-VM minting is exactly why the committed status
 * is the default: it needs no token, no minting step per run, and it is the
 * same file the janitor reads.
 */

import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  Refusal,
  LobbyError,
  attachedToTag,
  attachedToVm,
  defaultExec,
  ensureFleetRuns,
  expandHome,
  isRunNumber,
  isSafeTarget,
  listIntegrations,
  listVms,
  loadFleetConfig,
  lobby,
  parseArgs,
  parseComment,
  parseDuration,
  readCommittedStatus,
  roIntegrationFor,
  runCli,
  rwIntegrationFor,
  statusUrlFor,
  vmNameFor
} from './lobby.mjs'

export const USAGE = `usage: node fleet/grant.mjs <N> [--for 15m] [--live] [--target <owner>/<repo>]
                                [--config <path>] [--json]`

export const usage = () => USAGE

/** The state a run must be in before write access is granted. */
export const REQUIRED_STATE = 'awaiting-grant'
/** The default grant window. Wall clock; it lapses with nothing to revoke. */
export const DEFAULT_FOR = '15m'

/** Read the status the sandbox committed to `fleet-runs`. */
async function statusFromRepo (exec, settings, run) {
  const dir = await ensureFleetRuns(exec, settings.fleetRuns)
  const status = await readCommittedStatus(dir, run)
  if (!status) {
    throw new Refusal(
      `grant: fleet-runs has no runs/${run}/status.json yet — the sandbox commits it when the engine exits (or read the live page with --live)`
    )
  }
  return { status, source: `${dir}/runs/${run}/status.json` }
}

/** Read the live status page through the exe.dev proxy with a VM token. */
async function statusFromLive (exec, settings, run) {
  const tokenPath = expandHome(settings.vmTokenPath)
  let token
  try {
    token = (await fsp.readFile(tokenPath, 'utf8')).trim()
  } catch (error) {
    throw new Refusal(
      `grant: --live needs a VM token at ${tokenPath}: ${error?.message ?? error}. Mint one for this VM with: ssh exe.dev "ssh-key generate-api-key --vm=${vmNameFor(run)} --exp=1h"`
    )
  }
  if (token === '') throw new Refusal(`grant: the VM token at ${tokenPath} is empty`)
  const url = statusUrlFor(run)
  const res = await exec('curl', [
    '-fsS', '-H', `X-Exedev-Authorization: Bearer ${token}`, url
  ])
  if (res.code !== 0) {
    throw new Refusal(`grant: GET ${url} failed (code ${res.code}): ${String(res.stderr).trim()}`)
  }
  let status
  try {
    status = JSON.parse(String(res.stdout).trim())
  } catch {
    throw new Refusal(`grant: ${url} did not answer JSON`)
  }
  return { status, source: url }
}

/**
 * The target the run is working on. Not in status.json, so it comes from the
 * assignment comment the launcher wrote — read back off the run's `ls` row,
 * which is the one place the pairing of run to repo is recorded on exe.dev.
 * `--target` overrides for a VM whose comment has been overwritten.
 */
async function targetFor (exec, run, override) {
  if (override !== undefined) {
    if (!isSafeTarget(override)) {
      throw new Refusal(`grant: --target must be <owner>/<repo>, got ${JSON.stringify(override)}`)
    }
    return override
  }
  const vm = vmNameFor(run)
  const row = (await listVms(exec)).find((entry) => entry.name === vm)
  if (!row) throw new Refusal(`grant: ${vm} is not in ls --json — it has been reaped, or never existed`)
  const target = parseComment(row.comment).target
  if (!isSafeTarget(target)) {
    throw new Refusal(
      `grant: ${vm}'s comment carries no usable target= (got ${JSON.stringify(target ?? null)}); pass --target <owner>/<repo>`
    )
  }
  return target
}

/** Everything the grant does, with the exec seam and the clock injected. */
export async function grant ({ argv, exec = defaultExec, config, now = () => new Date() }) {
  const { opts, positional } = parseArgs(argv, { flags: ['live', 'json'] })
  const run = positional[0]
  if (!isRunNumber(run)) {
    throw new Refusal(`grant: a run number is required, got ${JSON.stringify(run ?? null)}\n${usage()}`)
  }
  const forWindow = opts.for === undefined || opts.for === true ? DEFAULT_FOR : String(opts.for)
  const ms = parseDuration(forWindow)
  if (ms === null) {
    throw new Refusal(`grant: --for must look like 15m or 2h, got ${JSON.stringify(forWindow)}`)
  }
  const settings = config ?? await loadFleetConfig({ path: opts.config })
  const vm = vmNameFor(run)

  const { status, source } = opts.live
    ? await statusFromLive(exec, settings, run)
    : await statusFromRepo(exec, settings, run)
  if (status?.state !== REQUIRED_STATE) {
    throw new Refusal(
      `grant: ${vm} is ${JSON.stringify(status?.state ?? null)}, not ${REQUIRED_STATE} (${source})`
    )
  }

  const target = await targetFor(exec, run, opts.target)
  const roName = roIntegrationFor(target)
  const rwName = rwIntegrationFor(target)
  const integrations = await listIntegrations(exec)
  const rw = integrations.find((row) => row.name === rwName)
  if (!rw) {
    throw new Refusal(
      `grant: no ${rwName} integration — create the pair with: node fleet/target.mjs add ${target}`
    )
  }
  const ro = integrations.find((row) => row.name === roName) ?? null

  const commands = []
  const warnings = []
  const verb = async (remote, { tolerate = () => false } = {}) => {
    commands.push(remote)
    const res = await lobby(exec, remote)
    if (res.code !== 0 && !tolerate(res)) {
      throw new LobbyError(`grant: \`${remote}\` failed (code ${res.code}): ${String(res.stderr).trim()}`)
    }
    return res
  }

  // Detach BEFORE attach, always — the two grants must never overlap.
  if (ro && attachedToTag(ro) && !attachedToVm(ro, vm)) {
    // A tag attachment cannot be lifted for one VM. The read grant stays; say
    // so out loud rather than pretending the detach happened.
    warnings.push(
      `${roName} rides tag:fleet — a per-VM detach cannot lift it, so read access to ${target} remains on ${vm}`
    )
  } else {
    await verb(`integrations detach ${roName} vm:${vm}`, {
      // The sandbox may already have lost the grant to its own `--for` window,
      // and a public target may never have had one. Neither is a failure.
      tolerate: (res) => /not attached|no such attachment|not found/i.test(String(res.stderr) + String(res.stdout))
    })
  }

  await verb(`integrations attach ${rwName} vm:${vm} --for=${forWindow}`)
  const expiresAt = new Date(now().getTime() + ms).toISOString()

  return { run: Number(run), vm, target, rw: rwName, ro: roName, for: forWindow, expiresAt, source, warnings, commands }
}

export const renderGrant = (result) => [
  ...result.warnings.map((line) => `warning: ${line}`),
  `${result.rw} attached to vm:${result.vm} for ${result.for} — expires ${result.expiresAt}`
].join('\n')

async function main (argv) {
  const { opts } = parseArgs(argv, { flags: ['live', 'json'] })
  const result = await grant({ argv })
  process.stdout.write(opts.json ? `${JSON.stringify(result)}\n` : `${renderGrant(result)}\n`)
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (invokedPath === fileURLToPath(import.meta.url)) {
  await runCli(main, process.argv.slice(2))
}
