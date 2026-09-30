#!/usr/bin/env node
/**
 * fleet/retire.mjs — the integration-branch sweep.
 *
 *   node fleet/retire.mjs --target <owner>/<repo> [--dry-run]
 *
 * Nothing on a target is retired into tags any more: the old runs' plan and
 * evidence branches were copied once into the operator's evidence repository
 * (`node fleet/migrate-evidence.mjs`), and this sweep neither tags them, nor
 * deletes them, nor rewrites a pull request body. What it keeps is the one
 * thing still worth sweeping on a target: a run's integration branch whose pull
 * request was closed without merging.
 *
 * It runs on the laptop with no clone. `git ls-remote <url> refs/heads/ultra/*`
 * needs no checkout, and is the ONLY way this tool asks the remote what it
 * holds; nothing lists the heads a second time.
 *
 * For a run whose listing carries `refs/heads/ultra/integration-run-<N>`, the pull
 * request with the highest `number` among the rows of `gh api
 * repos/<t>/pulls?state=all&head=<owner>:ultra/integration-run-<N>` decides:
 * `state` `"open"` keeps the branch; `state` `"closed"` with `merged_at` `null`
 * retires it, and the sweep issues one `gh api -X DELETE
 * repos/<t>/git/refs/heads/ultra/integration-run-<N>`; `merged_at` a string
 * keeps it — a merged PR's branch is delete-on-merge's to take, and one still
 * standing is a repository whose setting is off, which is the operator's to see;
 * no rows keeps it. The rows' ORDER is not the rule: run numbers restarted at 1
 * on 2026-09-04, so one head name carries the pull requests of two runs and only
 * the highest number is this run's. The list endpoint's rows carry `merged_at`
 * and no `merged` boolean — `merged` belongs to the single-PR endpoint, which
 * this tool does not read.
 *
 * A `stays` is the correct state, so it sets no exit code. Every run the listing
 * carries an integration branch for prints one line as it is decided, on this
 * process's stdout, in ascending N; the resolved value carries the same lines
 * under `lines`. The run's line is the whole record of the branch.
 *
 * `--dry-run` says what it would do: the one listing, the fate read per
 * integration branch, and no command that deletes anything. A `stays` prints
 * the same line either way.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { decidingPull } from './janitor.mjs'
import {
  Refusal,
  defaultExec,
  integrationBranchFor,
  isSafeTarget,
  parseArgs,
  runCli,
  runOfBranch
} from './lobby.mjs'

export const USAGE = 'usage: node fleet/retire.mjs --target <owner>/<repo> [--dry-run]'

export const usage = () => USAGE

/** The clone URL a `ls-remote` is given — the only remote name this tool has. */
export const remoteUrlFor = (target) => `https://github.com/${target}.git`

/** The `<sha>\t<ref>` listing as `{ ref: sha }`, peeled `^{}` lines included. */
export function parseLsRemote (stdout) {
  const refs = new Map()
  for (const line of String(stdout ?? '').split('\n')) {
    const [sha, ref] = line.split('\t')
    if (ref === undefined) continue
    const name = ref.trim()
    if (name === '') continue
    refs.set(name, sha.trim())
  }
  return refs
}

/**
 * Every run the listing carries an integration branch for, ascending. The plan
 * and evidence branches a listing may still show are not this sweep's: the
 * migration copied them, and nothing here names them.
 */
export function runsOf (refs) {
  const runs = []
  for (const ref of refs.keys()) {
    if (!ref.startsWith('refs/heads/')) continue
    const run = runOfBranch(ref)
    if (run === null) continue
    if (ref.slice('refs/heads/'.length) !== integrationBranchFor(run)) continue
    runs.push(run)
  }
  return runs.sort((a, b) => a - b)
}

/**
 * The fate of a run's integration branch, off the one read that decides it:
 * every pull request GitHub has for that head, open and closed alike.
 *
 * The deciding row is the one with the highest `number`, whatever order the rows
 * arrive in — run numbers restarted at 1 on 2026-09-04, so one head name carries
 * the pull requests of two runs and the older run's PR must not decide this one.
 * `merged_at` is the list endpoint's field for it; the `merged` boolean belongs
 * to the single-PR endpoint and is not read here.
 *
 * Answers `{ number, why }` with `why` one of `open`, `merged` or `no pull
 * request` for a branch that stays, and `{ number, deletable: true }` for the
 * one case that retires it: closed, and not merged.
 */
async function integrationFate (exec, target, run) {
  const deciding = await decidingPull(exec, target, run)
  if (deciding === null) return { number: null, why: 'no pull request', deletable: false }
  if (typeof deciding.mergedAt === 'string') {
    return { number: deciding.number, why: 'merged', deletable: false }
  }
  if (deciding.state === 'closed') return { number: deciding.number, deletable: true }
  return { number: deciding.number, why: 'open', deletable: false }
}

/**
 * The integration branch's segment of the run's line, and the DELETE that earns
 * the deletable one. A `stays` costs nothing but the read.
 */
async function integrationSegment (exec, target, run, dryRun) {
  const branch = integrationBranchFor(run)
  const fate = await integrationFate(exec, target, run)
  if (!fate.deletable) {
    const line = fate.number === null
      ? `${branch} stays — no pull request`
      : `${branch} stays — PR #${fate.number} ${fate.why}`
    return { line, deleted: false }
  }
  const because = `PR #${fate.number} closed, not merged`
  if (dryRun) return { line: `would delete ${branch} — ${because}`, deleted: false }
  await exec('gh', ['api', '-X', 'DELETE', `repos/${target}/git/refs/heads/${branch}`])
  return { line: `${branch} deleted — ${because}`, deleted: true }
}

/**
 * The sweep. `exec` is the seam every `git` and every `gh` goes through; the
 * lines go to stdout as each run is decided, and the resolved value carries
 * them too.
 */
export async function retire ({ argv = [], exec = defaultExec } = {}) {
  const { opts } = parseArgs(argv, { flags: ['dry-run'] })
  const dryRun = opts['dry-run'] === true
  const target = opts.target
  if (!isSafeTarget(target)) {
    throw new Refusal(
      `retire: --target must be <owner>/<repo>, got ${JSON.stringify(target ?? null)}\n${usage()}`
    )
  }

  // ── One listing, for the whole target. Nothing lists the heads again. ─────
  const listing = await exec('git', [
    'ls-remote', remoteUrlFor(target), 'refs/heads/ultra/*'
  ])
  const refs = parseLsRemote(listing.stdout)

  const deleted = []
  const lines = []
  const say = (line) => {
    lines.push(line)
    process.stdout.write(`${line}\n`)
  }

  for (const run of runsOf(refs)) {
    const segment = await integrationSegment(exec, target, run, dryRun)
    if (segment.deleted) deleted.push(run)
    say(`run ${run}: ${segment.line}`)
  }

  return { target, dryRun, deleted, lines }
}

async function main (argv) {
  await retire({ argv })
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (invokedPath === fileURLToPath(import.meta.url)) {
  await runCli(main, process.argv.slice(2))
}
