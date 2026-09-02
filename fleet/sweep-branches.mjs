#!/usr/bin/env node
// fleet/sweep-branches.mjs — #543: the sweep verb for run branches.
//
//   node fleet/sweep-branches.mjs [--delete] [--repo-dir D] [--evidence-dir E]
//
// A separate verb, NEVER part of the drive. The drive deletes nothing by
// design — a run that publishes its branch has no business removing anybody
// else's — so branch cleanup is an operator action, taken deliberately, after
// the fact, with the whole fleet's branch list in front of it. (`gh pr merge
// --delete-branch` never works here: the merge lands, the delete does not, so
// the branches accumulate until somebody sweeps.)
//
// The policy, and the reason this file is so cautious: a branch is deleted only
// on POSITIVE evidence, from three independent sources, that its run is over
// and its record is durable —
//
//   1. its PR is MERGED or CLOSED (GitHub says the review is finished),
//   2. its tip equals `refs/fleet/<runId>` in the checkout (the local pin says
//      this is the same commit the fleet recorded, not a branch someone pushed
//      onto afterwards), and
//   3. `E/gate-read-<runId>.json` exists (the evidence bundle outlives the
//      branch, so deleting it loses nothing).
//
// Anything else is KEPT, with the reason printed. An unknown answer — a `gh`
// read that failed, a pin that does not resolve — is a keep, never a delete.
//
// Dry run by default: without `--delete` this issues no `git push origin
// --delete` at all, and prints what it WOULD remove.
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { shellQuote } from './drive.mjs'
import { DEFAULTS, shellExec } from './drive-one.mjs'
import { isSafeBranchName } from './shim-main.mjs'

/** Run branches are `ultra/integration-<runId>`; the runId is the tail. */
export const RUN_BRANCH_PREFIX = 'ultra/integration-'

/** The refspecs the listing asks origin for — run branches and adoptions. */
export const BRANCH_GLOBS = Object.freeze([
  `refs/heads/${RUN_BRANCH_PREFIX}*`,
  'refs/heads/adopt/*',
])

export const USAGE = `usage: node fleet/sweep-branches.mjs [--delete] [--repo-dir D] [--evidence-dir E]

Lists every ${RUN_BRANCH_PREFIX}* and adopt/* branch on origin with its PR state,
whether its tip is pinned at refs/fleet/<runId>, and whether its gate read exists.

  --delete            actually delete; without it nothing is pushed (dry run)
  --repo-dir D        the checkout to read (default: ${DEFAULTS.repoDir})
  --evidence-dir E    where gate-read-<runId>.json lives (default: ${DEFAULTS.evidenceDir})
  --help              print this and exit

A branch is deleted only when its PR is MERGED or CLOSED, its tip is pinned, and
its gate read exists. Every other branch is kept, with the reason printed.`

/**
 * The CLI grammar. Unknown arguments are refused rather than ignored — a
 * mistyped flag on a verb that deletes must not silently become a dry run
 * (or, worse, a live one).
 *
 * @param {string[]} argv
 * @returns {{delete: boolean, help: boolean, repoDir: string, evidenceDir: string}}
 */
export const parseArgs = (argv = []) => {
  const parsed = {
    delete: false,
    help: false,
    repoDir: DEFAULTS.repoDir,
    evidenceDir: DEFAULTS.evidenceDir,
  }
  const valued = { '--repo-dir': 'repoDir', '--evidence-dir': 'evidenceDir' }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--delete') parsed.delete = true
    else if (arg === '--help' || arg === '-h') parsed.help = true
    else if (valued[arg]) {
      const value = argv[i + 1]
      if (value === undefined) throw new Error(`sweepBranches: ${arg} requires a value`)
      parsed[valued[arg]] = value
      i += 1
    } else throw new Error(`sweepBranches: unknown argument ${JSON.stringify(arg)}`)
  }
  return parsed
}

/** `<sha>\trefs/heads/<branch>` lines -> `{branch, tip}` records, in order. */
export const parseLsRemote = (stdout) =>
  String(stdout ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      // Everything after the sha is the ref, INCLUDING any embedded whitespace:
      // git cannot produce such a name, but taking only the first field would
      // silently truncate a hostile one down to a shell-safe prefix and then
      // act on it. Keep it whole so `isSafeBranchName` sees what was listed.
      const [tip, ...rest] = line.split(/\s+/)
      return { tip, branch: rest.join(' ').replace(/^refs\/heads\//, '') }
    })
    .filter((entry) => entry.branch)

/** The runId a run branch carries, or null for anything else (adopt/*). */
export const runIdOf = (branch) =>
  branch.startsWith(RUN_BRANCH_PREFIX) ? branch.slice(RUN_BRANCH_PREFIX.length) : null

/** `[{"state":"MERGED","number":1}]` -> `{state, number}`, or null for none. */
const parsePrList = ({ code, stdout }) => {
  if (code !== 0) return undefined // unknown, which is not the same as none
  let rows
  try {
    rows = JSON.parse(String(stdout ?? '') || '[]')
  } catch {
    return undefined
  }
  if (!Array.isArray(rows) || rows.length === 0) return null
  return { state: String(rows[0]?.state ?? ''), number: rows[0]?.number }
}

const TERMINAL_STATES = new Set(['MERGED', 'CLOSED'])

/** The `[pr=… pinned=… gate-read=…]` fact bracket every line carries. */
const detailOf = ({ pr, runId, pinned, gateRead }) => {
  const prCell = pr === undefined ? 'unknown' : pr === null ? 'none' : `${pr.state}#${pr.number}`
  const na = (value) => (runId === null ? 'n/a' : value ? 'yes' : 'no')
  return `[pr=${prCell} pinned=${na(pinned)} gate-read=${na(gateRead)}]`
}

/**
 * Why this branch is kept, or null when it may be deleted. Checked in the
 * order the evidence is cheapest to explain: identity, then review state,
 * then the pin, then the durable record.
 */
const keepReason = ({ runId, pr, pinned, gateRead, gateReadPath, pinRef }) => {
  if (runId === null) return 'no runId — not a run branch'
  if (pr === undefined) return 'PR state unknown'
  if (pr === null) return 'no PR'
  if (!TERMINAL_STATES.has(pr.state)) return `PR #${pr.number} is ${pr.state}`
  if (!pinned) return `tip is not pinned at ${pinRef}`
  if (!gateRead) return `no gate read at ${gateReadPath}`
  return null
}

/**
 * Sweep the run branches on origin.
 *
 * Every external call goes through the injected `exec` seam (`shellExec` from
 * drive-one is the production runner), so the whole policy is exercisable with
 * canned answers and no network.
 *
 * @param {string[]} argv
 * @param {object} [deps]
 * @param {(cmd: string) => Promise<{code: number, stdout: string, stderr: string}>} [deps.exec]
 * @param {(line: string) => void} [deps.log]
 * @returns {Promise<{kept: object[], deleted: string[], wouldDelete: string[], branches: object[]}>}
 *   `kept` and `deleted` are the contract; `wouldDelete` is what a dry run
 *   would have removed (empty once `--delete` did remove it), and `branches`
 *   is every branch examined, in listing order, with the facts behind its line.
 */
export const sweepBranches = async (argv = [], deps = {}) => {
  const { exec = shellExec, log = console.log } = deps
  const parsed = parseArgs(argv)
  if (parsed.help) {
    log(USAGE)
    return { kept: [], deleted: [], wouldDelete: [], branches: [] }
  }

  const { repoDir, evidenceDir } = parsed
  const git = (args) => `git -C ${shellQuote(repoDir)} ${args}`

  const listed = await exec(
    git(`ls-remote --heads origin ${BRANCH_GLOBS.map((glob) => `'${glob}'`).join(' ')}`),
  )
  if (listed.code !== 0) {
    throw new Error(
      `sweepBranches: ls-remote failed (code ${listed.code}) ${String(listed.stderr ?? '').trim()}`.trim(),
    )
  }
  const branches = parseLsRemote(listed.stdout)

  // Branch names and the runIds derived from them are interpolated into shell
  // strings below. Validate ALL of them here, before the first command that
  // carries one: a hostile name must not cost the safe branch standing next to
  // it a `gh` read, let alone a delete.
  for (const { branch } of branches) {
    const runId = runIdOf(branch)
    if (!isSafeBranchName(branch)) {
      throw new Error(
        `sweepBranches: unsafe branch name ${JSON.stringify(branch)} — refusing before any command runs against it`,
      )
    }
    if (runId !== null && !isSafeBranchName(runId)) {
      throw new Error(
        `sweepBranches: unsafe branch name ${JSON.stringify(branch)} — its runId ${JSON.stringify(runId)} is not safe to interpolate; refusing before any command runs against it`,
      )
    }
  }

  const examined = []
  for (const { branch, tip } of branches) {
    const runId = runIdOf(branch)
    // `gh` resolves the repository from its working directory, so the read is
    // anchored at the checkout under sweep exactly as drive.mjs anchors its
    // `gh pr create` — this CLI must work from any cwd.
    const pr = parsePrList(
      await exec(
        `cd ${shellQuote(repoDir)} && gh pr list --head ${branch} --state all --json state,number --limit 1`,
      ),
    )

    let pinned = false
    let gateRead = false
    const pinRef = runId === null ? null : `refs/fleet/${runId}`
    const gateReadPath = runId === null ? null : path.join(evidenceDir, `gate-read-${runId}.json`)
    if (runId !== null) {
      const resolved = await exec(git(`rev-parse --verify ${pinRef}`))
      pinned = resolved.code === 0 && String(resolved.stdout ?? '').trim() === tip
      gateRead = fs.existsSync(gateReadPath)
    }

    const reason = keepReason({ runId, pr, pinned, gateRead, gateReadPath, pinRef })
    examined.push({
      branch,
      tip,
      runId,
      state: pr === undefined ? null : pr === null ? null : pr.state,
      prNumber: pr && pr.number !== undefined ? pr.number : null,
      pinned,
      gateRead,
      reason,
      detail: detailOf({ pr, runId, pinned, gateRead }),
    })
  }

  const kept = []
  const deleted = []
  const wouldDelete = []
  for (const entry of examined) {
    if (entry.reason !== null) {
      entry.action = 'keep'
      kept.push(entry)
      log(`keep ${entry.branch} ${entry.detail}: ${entry.reason}`)
      continue
    }
    if (!parsed.delete) {
      entry.action = 'would-delete'
      wouldDelete.push(entry.branch)
      log(`would-delete ${entry.branch} ${entry.detail}`)
      continue
    }
    const pushed = await exec(git(`push origin --delete ${entry.branch}`))
    if (pushed.code !== 0) {
      throw new Error(
        `sweepBranches: delete of ${entry.branch} failed (code ${pushed.code}) ${String(pushed.stderr ?? '').trim()}`.trim(),
      )
    }
    entry.action = 'delete'
    deleted.push(entry.branch)
    log(`delete ${entry.branch} ${entry.detail}`)
  }

  const removed = parsed.delete ? deleted.length : wouldDelete.length
  const noun = examined.length === 1 ? 'branch' : 'branches'
  log(
    `swept ${examined.length} ${noun}: ${removed} ${parsed.delete ? 'deleted' : 'would-delete'}, ${kept.length} kept`,
  )

  return { kept, deleted, wouldDelete, branches: examined }
}

export const main = async (argv = process.argv.slice(2), deps = {}) => sweepBranches(argv, deps)

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error?.message ?? error)
    process.exit(1)
  })
}
