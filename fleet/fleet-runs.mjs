#!/usr/bin/env node
/**
 * fleet/fleet-runs.mjs — the `popmechanic/fleet-runs` clone, and the four
 * readers over it.
 *
 * `lobby.mjs` is the half every laptop CLI shares, and it no longer knows about
 * a side repository: a run's durable identity is N and the target's own
 * `ultra/*` refs. The plan commit and the committed status pages are still
 * where `fleet/CONTRACT.md` says they are — `plans/run-N.md` and
 * `runs/<N>/status.json` in `popmechanic/fleet-runs` — and `launch.mjs` and
 * `janitor.mjs` are the two tools that read them. That is what lives here:
 * the clone and its readers, out of the shared module and beside the only two
 * callers, so neither the lobby's export surface nor the launcher's behaviour
 * has to give way.
 *
 * Like the rest of `fleet/`, every specifier is `node:`-prefixed and the only
 * fleet import is the lobby's exec seam and its small helpers.
 */

import fsp from 'node:fs/promises'
import path from 'node:path'

import { expandHome, git, isRunNumber, output, refuse } from './lobby.mjs'

export const FLEET_RUNS_REPO = 'popmechanic/fleet-runs'
export const FLEET_RUNS_URL = `https://github.com/${FLEET_RUNS_REPO}.git`

/** Where the clone lands when the config names no path — the RUNBOOK's
 *  `fleetRuns` default, so an operator who followed it configures nothing. */
export const DEFAULT_FLEET_RUNS_DIR = '~/.ultrapowers/fleet-runs'

/**
 * Make sure the local `fleet-runs` clone exists and is current: clone it when
 * absent (the laptop's own git credential — the fleet holds no PAT anywhere),
 * and `pull --rebase` when it is there. Answers the resolved absolute path.
 */
export async function ensureFleetRuns (exec, configuredPath) {
  const dir = path.resolve(expandHome(configuredPath ?? DEFAULT_FLEET_RUNS_DIR))
  let present = false
  try {
    const stat = await fsp.stat(path.join(dir, '.git'))
    present = stat.isDirectory() || stat.isFile()
  } catch {
    present = false
  }
  if (!present) {
    await fsp.mkdir(path.dirname(dir), { recursive: true })
    const res = await exec('git', ['clone', FLEET_RUNS_URL, dir])
    if (res.code !== 0) refuse(`fleet-runs: git clone ${FLEET_RUNS_URL} failed:\n${output(res)}`)
    return dir
  }
  const res = await git(exec, dir, ['pull', '--rebase'])
  if (res.code !== 0) refuse(`fleet-runs: git pull --rebase in ${dir} failed:\n${output(res)}`)
  return dir
}

/** The highest `run-<N>` a `plans/` directory holds, or 0. */
export async function highestPlanRun (fleetRunsDir) {
  let names
  try {
    names = await fsp.readdir(path.join(fleetRunsDir, 'plans'))
  } catch {
    return 0
  }
  let best = 0
  for (const name of names) {
    const match = /^run-([1-9][0-9]*)\.md$/.exec(name)
    if (match) best = Math.max(best, Number(match[1]))
  }
  return best
}

/** Read `runs/<N>/status.json` out of the clone. Null when it is not there yet. */
export async function readCommittedStatus (fleetRunsDir, run) {
  try {
    const text = await fsp.readFile(
      path.join(fleetRunsDir, 'runs', String(run), 'status.json'), 'utf8'
    )
    return JSON.parse(text)
  } catch {
    return null
  }
}

/** Every `runs/<N>/status.json` in the clone, as `[{ run, status }]`, N ascending. */
export async function listCommittedStatuses (fleetRunsDir) {
  let names
  try {
    names = await fsp.readdir(path.join(fleetRunsDir, 'runs'))
  } catch {
    return []
  }
  const runs = names.filter(isRunNumber).map(Number).sort((a, b) => a - b)
  const out = []
  for (const run of runs) {
    const status = await readCommittedStatus(fleetRunsDir, run)
    if (status) out.push({ run, status })
  }
  return out
}
