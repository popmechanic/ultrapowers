#!/usr/bin/env node
/**
 * fleet/janitor.mjs — reap finished runs; mark stuck ones.
 *
 *   node fleet/janitor.mjs [--dry-run] [--sweep-grants] [--config <path>] [--json]
 *
 * Twenty lines of intent, run from cron on any machine holding the tag-scoped
 * ssh key (which can act only on `fleet`-tagged VMs — narrower than any lobby
 * API key exe.dev offers):
 *
 *   - `ls --json`, and for each `fleet-run-<N>` read `runs/<N>/status.json` out
 *     of the `fleet-runs` clone. `done` or `failed` → `rm`.
 *   - No status at all and the VM older than six hours → write `state=expired`
 *     onto its comment, once, and print it. Nothing is removed: an expired run
 *     is evidence, and an orphan on exe.dev costs width and average disk, not
 *     hourly money.
 *   - `--sweep-grants` detaches any `-rw` integration still attached to a VM
 *     that no longer exists. `rm` leaves the integration object behind; a write
 *     grant pointing at a dead VM is inert but it is also a lie in the listing.
 *
 * The status is read from git, not from each VM's HTTPS page, because a VM
 * token is per VM: reading twelve status pages means minting twelve tokens,
 * while `git pull` reads all of them with the credential the laptop already
 * has. `--dry-run` issues every read and no mutation.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  LobbyError,
  attachedVms,
  defaultExec,
  ensureFleetRuns,
  git,
  listIntegrations,
  listVms,
  loadFleetConfig,
  lobby,
  parseArgs,
  readCommittedStatus,
  runCli
} from './lobby.mjs'

export const usage = () =>
  'usage: node fleet/janitor.mjs [--dry-run] [--sweep-grants] [--config <path>] [--json]'

/** States that mean the run is over and its VM is ballast. */
export const REAPABLE_STATES = Object.freeze(['done', 'failed'])
/** How long a VM may live with no committed status before it is called expired. */
export const EXPIRY_MS = 6 * 60 * 60 * 1000
/** The token appended to a stuck run's comment — and the mark that stops a second write. */
export const EXPIRED_MARK = 'state=expired'

const RUN_VM = /^fleet-run-([1-9][0-9]*)$/

/**
 * When the VM was created. `ls --json` carries it on the accounts measured so
 * far; when it does not, the plan commit is the honest stand-in — the launcher
 * commits `plans/run-<N>.md` seconds before it copies the golden.
 */
async function createdAt ({ exec, vm, fleetRunsDir, run }) {
  if (vm.createdAt) {
    const parsed = Date.parse(vm.createdAt)
    if (Number.isFinite(parsed)) return { at: parsed, from: 'ls --json' }
  }
  const res = await git(exec, fleetRunsDir, [
    'log', '-1', '--format=%cI', '--', `plans/run-${run}.md`
  ])
  const line = String(res.stdout).trim()
  const parsed = Date.parse(line)
  if (res.code === 0 && Number.isFinite(parsed)) return { at: parsed, from: `plans/run-${run}.md` }
  return { at: null, from: 'unknown' }
}

/** Everything the janitor does, with the exec seam and the clock injected. */
export async function janitor ({ argv = [], exec = defaultExec, config, now = () => new Date() }) {
  const { opts } = parseArgs(argv, { flags: ['dry-run', 'sweep-grants', 'json'] })
  const dryRun = opts['dry-run'] === true
  const settings = config ?? await loadFleetConfig({ path: opts.config })

  const fleetRunsDir = await ensureFleetRuns(exec, settings.fleetRuns)
  const vms = await listVms(exec)
  const nowMs = now().getTime()

  const actions = []
  const act = async (action, remote) => {
    actions.push({ ...action, command: remote, applied: !dryRun })
    if (dryRun) return
    const res = await lobby(exec, remote)
    if (res.code !== 0) {
      throw new LobbyError(`janitor: \`${remote}\` failed (code ${res.code}): ${String(res.stderr).trim()}`)
    }
  }

  const live = new Set(vms.map((vm) => vm.name))
  for (const vm of vms) {
    const match = RUN_VM.exec(vm.name)
    if (!match) continue
    const run = Number(match[1])
    const status = await readCommittedStatus(fleetRunsDir, run)
    if (status && REAPABLE_STATES.includes(status.state)) {
      await act({ vm: vm.name, run, kind: 'rm', state: status.state }, `rm ${vm.name} --json`)
      continue
    }
    if (status) continue
    if (vm.comment.includes(EXPIRED_MARK)) continue
    const { at, from } = await createdAt({ exec, vm, fleetRunsDir, run })
    if (at === null || nowMs - at < EXPIRY_MS) continue
    const marked = vm.comment === '' ? EXPIRED_MARK : `${vm.comment} ${EXPIRED_MARK}`
    await act(
      { vm: vm.name, run, kind: 'expired', ageMs: nowMs - at, ageFrom: from, comment: marked },
      `comment ${vm.name} '${marked}'`
    )
  }

  if (opts['sweep-grants'] === true) {
    for (const integration of await listIntegrations(exec)) {
      if (!integration.name.endsWith('-rw')) continue
      for (const attached of attachedVms(integration)) {
        if (live.has(attached)) continue
        await act(
          { vm: attached, kind: 'detach', integration: integration.name },
          `integrations detach ${integration.name} vm:${attached}`
        )
      }
    }
  }

  return { dryRun, sweepGrants: opts['sweep-grants'] === true, vms: vms.length, actions }
}

export const renderJanitor = (result) => {
  if (result.actions.length === 0) return 'nothing to do'
  return result.actions
    .map((a) => `${result.dryRun ? 'would ' : ''}${a.kind} ${a.vm}: ${a.command}`)
    .join('\n')
}

async function main (argv) {
  const { opts } = parseArgs(argv, { flags: ['dry-run', 'sweep-grants', 'json'] })
  const result = await janitor({ argv })
  process.stdout.write(opts.json ? `${JSON.stringify(result)}\n` : `${renderJanitor(result)}\n`)
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (invokedPath === fileURLToPath(import.meta.url)) {
  await runCli(main, process.argv.slice(2))
}
