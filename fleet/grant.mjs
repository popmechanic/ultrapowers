#!/usr/bin/env node
/**
 * fleet/grant.mjs — the operator's approval, as a fifteen-minute write grant.
 *
 * The pre-merge gate is the operator's act, expressed the way exe.dev
 * expresses trust: an integration attachment, per VM, time-boxed, that lapses
 * on its own with nothing to revoke.
 *
 *   node fleet/grant.mjs <N> [--for 15m] [--live] [--target <owner>/<repo>]
 *
 * One read, one lookup, two verbs:
 *
 *   - `git pull` fleet-runs and require `runs/<N>/status.json` to say
 *     `awaiting-grant`. The sandbox writes that state only after its engine
 *     service is inactive, so a write grant never reaches a running model.
 *     (What bounds a hostile model is still 15 minutes, one repo, a PR rather
 *     than a merge, and a human at the button.)
 *   - the VM by pattern: `ls 'fleet-r<N>-*' --json`, exactly one row.
 *   - `integrations detach t-<owner>-<repo>-ro vm:<vm>` FIRST (a grant that
 *     already lapsed answers "not attached", which is fine), then
 *     `integrations attach t-<owner>-<repo>-rw vm:<vm> --for 15m`. Never both
 *     at once: `github.int.exe.xyz` resolves one credential per repo and no
 *     precedence is documented.
 *
 * `--live` reads `https://<vm>.exe.xyz/status.json` with the VM token at
 * `vmTokenPath` instead of the committed file; tokens are per VM, which is why
 * the committed status is the default.
 */

import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  Refusal,
  defaultExec,
  ensureFleetRuns,
  expandHome,
  isRunNumber,
  isSafeTarget,
  listVms,
  loadFleetConfig,
  lobby,
  output,
  parseArgs,
  parseComment,
  parseDuration,
  readCommittedStatus,
  roIntegrationFor,
  runCli,
  rwIntegrationFor,
  statusUrlFor,
  vmPatternFor
} from './lobby.mjs'

export const USAGE = `usage: node fleet/grant.mjs <N> [--for 15m] [--live] [--target <owner>/<repo>]
                                [--config <path>] [--json]`

export const usage = () => USAGE

/** The state a run must be in before write access is granted. */
export const REQUIRED_STATE = 'awaiting-grant'
/** The default grant window. Wall clock; it lapses with nothing to revoke. */
export const DEFAULT_FOR = '15m'

/** The one VM incarnation of run N, or a refusal naming the pattern. */
async function vmFor (exec, run) {
  const pattern = vmPatternFor(run)
  const rows = await listVms(exec, pattern)
  if (rows.length === 0) {
    throw new Refusal(`grant: ls '${pattern}' --json lists no VM — run ${run} has been reaped, or never launched`)
  }
  if (rows.length > 1) {
    throw new Refusal(
      `grant: ls '${pattern}' --json lists ${rows.length} VMs (${rows.map((r) => r.name).join(', ')}) — rm the dead incarnations first`
    )
  }
  return rows[0]
}

/** Read the status the sandbox committed to `fleet-runs`. */
async function statusFromRepo (exec, settings, run) {
  const dir = await ensureFleetRuns(exec, settings.fleetRuns)
  const status = await readCommittedStatus(dir, run)
  if (!status) {
    throw new Refusal(
      `grant: fleet-runs has no runs/${run}/status.json yet — the sandbox commits it at every transition (or read the live page with --live)`
    )
  }
  return { status, source: `${dir}/runs/${run}/status.json` }
}

/** Read the live status page through the exe.dev proxy with a VM token. */
async function statusFromLive (exec, settings, vm) {
  const tokenPath = expandHome(settings.vmTokenPath)
  let token
  try {
    token = (await fsp.readFile(tokenPath, 'utf8')).trim()
  } catch (error) {
    throw new Refusal(
      `grant: --live needs a VM token at ${tokenPath}: ${error?.message ?? error}. Mint one for this VM with: ssh exe.dev "ssh-key generate-api-key --vm=${vm} --exp=1h"`
    )
  }
  if (token === '') throw new Refusal(`grant: the VM token at ${tokenPath} is empty`)
  const url = statusUrlFor(vm)
  const res = await exec('curl', ['-fsS', '-H', `X-Exedev-Authorization: Bearer ${token}`, url])
  if (res.code !== 0) throw new Refusal(`grant: GET ${url} failed (exit ${res.code}):\n${output(res)}`)
  let status
  try {
    status = JSON.parse(String(res.stdout).trim())
  } catch {
    throw new Refusal(`grant: ${url} did not answer JSON`)
  }
  return { status, source: url }
}

/**
 * The target the run is working on: `--target`, else the `target=` of the
 * assignment comment on the VM's `ls` row — the one place exe.dev records the
 * pairing. `comment` is an undocumented row field, so its absence is a refusal
 * that points at the override, never a crash.
 */
function targetFor (row, override) {
  if (override !== undefined) {
    if (!isSafeTarget(override)) {
      throw new Refusal(`grant: --target must be <owner>/<repo>, got ${JSON.stringify(override)}`)
    }
    return override
  }
  const target = parseComment(row.comment).target
  if (!isSafeTarget(target)) {
    throw new Refusal(
      `grant: ${row.name}'s comment carries no usable target= (got ${JSON.stringify(target ?? null)}); pass --target <owner>/<repo>`
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

  // The committed status is read before any lobby verb, so a run that is not
  // ready refuses with exe.dev untouched; the live page needs the VM's name,
  // so only that path looks the VM up first.
  let status, source, row = null
  if (opts.live) {
    row = await vmFor(exec, run)
    ;({ status, source } = await statusFromLive(exec, settings, row.name))
  } else {
    ;({ status, source } = await statusFromRepo(exec, settings, run))
  }
  if (status?.state !== REQUIRED_STATE) {
    throw new Refusal(
      `grant: run ${run} is ${JSON.stringify(status?.state ?? null)}, not ${REQUIRED_STATE} (${source})`
    )
  }
  row ??= await vmFor(exec, run)

  const vm = row.name
  const target = targetFor(row, opts.target)
  const roName = roIntegrationFor(target)
  const rwName = rwIntegrationFor(target)
  const commands = []
  const verb = async (remote, options) => {
    commands.push(remote)
    return lobby(exec, remote, options)
  }

  // Detach BEFORE attach, always — the two grants never overlap on one VM.
  await verb(`integrations detach ${roName} vm:${vm}`, {
    tolerate: (res) => /not attached|no such attachment|not found/i.test(output(res))
  })
  await verb(`integrations attach ${rwName} vm:${vm} --for ${forWindow}`)
  const expiresAt = new Date(now().getTime() + ms).toISOString()

  return { run: Number(run), vm, target, rw: rwName, ro: roName, for: forWindow, expiresAt, source, commands }
}

export const renderGrant = (result) =>
  `${result.rw} attached to vm:${result.vm} for ${result.for} — expires ${result.expiresAt}`

async function main (argv) {
  const { opts } = parseArgs(argv, { flags: ['live', 'json'] })
  const result = await grant({ argv })
  process.stdout.write(opts.json ? `${JSON.stringify(result)}\n` : `${renderGrant(result)}\n`)
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (invokedPath === fileURLToPath(import.meta.url)) {
  await runCli(main, process.argv.slice(2))
}
