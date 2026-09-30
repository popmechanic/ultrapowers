#!/usr/bin/env node
/**
 * fleet/migrate-evidence.mjs — the one-time copy of a target's old runs into
 * the evidence repository (#1395).
 *
 *   node fleet/migrate-evidence.mjs --target <owner>/<repo>
 *     [--evidence-repo <owner>/<repo>] [--config <path>] [--dry-run]
 *
 * A run is every N with an `ultra/evidence/run-<N>` tag or an
 * `ultra/evidence-run-<N>` branch on the target (the tag wins when both
 * exist). Its plan files come from `ultra/plan/run-<N>` (or the branch
 * `ultra/plan-run-<N>`) at `.ultrapowers/plan.md`, `kata.json` and
 * `gate-verdicts.json`, each when present; its record files are every file
 * under `.ultrapowers/runs/<N>/` at the evidence ref. All of them land flat in
 * `runs/<slug>/<N>/`, on a commit with no parent, tagged `<slug>/run-<N>` in
 * the evidence repository.
 *
 * Reads: one `ls-remote` of the target's `ultra/` heads and tags, one of the
 * evidence repository's `refs/tags/<slug>/run-*`. A run whose tag is already
 * there is skipped, so a second pass pushes nothing. Only the refs being
 * copied are fetched (depth 1), into a temporary repository that is removed
 * however the pass ends; each tree is built in a temporary index and each
 * commit made with `commit-tree`. The target is only read, the evidence
 * repository only gains tags — no branch, and never its `main`.
 *
 * The evidence repository is the operator's setting, `evidence` in
 * `~/.ultrapowers/fleet.json`, overridden by `--evidence-repo`; with neither
 * the CLI refuses (exit 2) before any git runs.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  LobbyError,
  defaultExec,
  evidenceRepoFor,
  evidenceUrlFor,
  isSafeTarget,
  output,
  parseArgs,
  readEvidenceSetting,
  refuse,
  runCli,
  runFolderFor,
  runOfBranch,
  runTagFor,
  targetSlug
} from './lobby.mjs'

export const USAGE =
  'usage: node fleet/migrate-evidence.mjs --target <owner>/<repo> ' +
  '[--evidence-repo <owner>/<repo>] [--config <path>] [--dry-run]'

/** The plan files a run carries, each copied when present. */
const PLAN_FILES = ['plan.md', 'kata.json', 'gate-verdicts.json']

/** A git that must succeed; a failure is exit 1 carrying all of its output. */
async function mustGit (exec, argv, options) {
  const res = options === undefined ? await exec('git', argv) : await exec('git', argv, options)
  if (res.code !== 0) {
    throw new LobbyError(`git ${argv.join(' ')} failed (exit ${res.code}):\n${output(res)}`)
  }
  return String(res.stdout ?? '')
}

/** `ls-remote` lines as ref names, the peeled `^{}` lines dropped. */
const refsOf = (stdout) => String(stdout ?? '').split('\n')
  .map((line) => line.split('\t')[1]?.trim())
  .filter((ref) => ref && !ref.endsWith('^{}'))

/**
 * The target's runs, ascending: `{ run, evidence, plan }`, each a full ref
 * name (`plan` null when the run has none). A tag wins over a branch.
 */
export function runsOfListing (refs) {
  const byRun = new Map()
  const entry = (run) => {
    if (!byRun.has(run)) byRun.set(run, {})
    return byRun.get(run)
  }
  for (const ref of refs) {
    const run = runOfBranch(ref)
    if (run === null) continue
    const tag = ref.startsWith('refs/tags/')
    const kind = /ultra\/evidence[/-]run-/.test(ref) ? 'evidence' : /ultra\/plan[/-]run-/.test(ref) ? 'plan' : null
    if (kind === null) continue
    const slot = entry(run)
    if (slot[kind] === undefined || tag) slot[kind] = ref
  }
  return [...byRun.entries()]
    .filter(([, slot]) => slot.evidence !== undefined)
    .sort(([a], [b]) => a - b)
    .map(([run, slot]) => ({ run, evidence: slot.evidence, plan: slot.plan ?? null }))
}

const shortRef = (ref) => ref.replace(/^refs\/(?:heads|tags)\//, '')

/** `ls-tree -r -z` rows as `{ mode, sha, file }`. */
async function filesAt (exec, dir, rev, paths) {
  const out = await mustGit(exec, ['-C', dir, 'ls-tree', '-r', '-z', rev, '--', ...paths])
  return out.split('\0').filter(Boolean).map((row) => {
    const tab = row.indexOf('\t')
    const [mode, type, sha] = row.slice(0, tab).split(' ')
    return { mode, type, sha, file: row.slice(tab + 1) }
  }).filter((row) => row.type === 'blob')
}

/** Fetch, build and push one run; answers the pushed commit's sha. */
async function copyRun (exec, { tmp, target, targetUrl, evidenceUrl, entry }) {
  const { run } = entry
  const local = (kind) => `refs/migrate/${kind}-${run}`
  const refspecs = [`+${entry.evidence}:${local('evidence')}`]
  if (entry.plan !== null) refspecs.push(`+${entry.plan}:${local('plan')}`)
  await mustGit(exec, ['-C', tmp, 'fetch', '--quiet', '--no-tags', '--depth', '1', targetUrl, ...refspecs])

  const rows = []
  if (entry.plan !== null) {
    rows.push(...await filesAt(exec, tmp, `${local('plan')}^{commit}`, PLAN_FILES.map((f) => `.ultrapowers/${f}`)))
  }
  rows.push(...await filesAt(exec, tmp, `${local('evidence')}^{commit}`, [`.ultrapowers/runs/${run}/`]))

  const folder = runFolderFor(target, run)
  const options = { env: { ...process.env, GIT_INDEX_FILE: path.join(tmp, `index-${run}`) } }
  for (const row of rows) {
    await mustGit(exec, [
      '-C', tmp, 'update-index', '--add', '--cacheinfo',
      `${row.mode},${row.sha},${folder}/${path.posix.basename(row.file)}`
    ], options)
  }
  const tree = (await mustGit(exec, ['-C', tmp, 'write-tree'], options)).trim()
  const message = `ultrapowers evidence ${target} run-${run} (migrated from ${shortRef(entry.evidence)})`
  const sha = (await mustGit(exec, ['-C', tmp, 'commit-tree', tree, '-m', message])).trim()
  await mustGit(exec, ['-C', tmp, 'push', '--quiet', evidenceUrl, `${sha}:refs/tags/${runTagFor(target, run)}`])
  return sha
}

/**
 * The migration of one target. `exec` is the seam every git goes through;
 * `urlFor` maps `<owner>/<repo>` to the URL both repositories are reached at.
 * Every line is printed as it is decided and carried under `lines`.
 */
export async function migrateEvidence ({
  exec = defaultExec,
  target,
  evidence,
  dryRun = false,
  urlFor = evidenceUrlFor,
  print = (line) => process.stdout.write(`${line}\n`)
} = {}) {
  if (!isSafeTarget(target)) refuse(`--target must be <owner>/<repo>, got ${JSON.stringify(target ?? null)}`)
  if (!isSafeTarget(evidence)) refuse('no evidence repository: set `evidence` in ~/.ultrapowers/fleet.json or pass --evidence-repo')

  const lines = []
  const say = (line) => {
    lines.push(line)
    print(line)
  }
  let copied = 0
  let skipped = 0

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-migrate-evidence-'))
  try {
    await mustGit(exec, ['init', '--quiet', '--bare', tmp])
    const targetUrl = urlFor(target)
    const evidenceUrl = urlFor(evidence)
    const listing = await mustGit(exec, ['-C', tmp, 'ls-remote', targetUrl, 'refs/heads/ultra/*', 'refs/tags/ultra/*'])
    const runs = runsOfListing(refsOf(listing))
    if (runs.length > 0) {
      const existing = new Set(refsOf(
        await mustGit(exec, ['-C', tmp, 'ls-remote', evidenceUrl, `refs/tags/${targetSlug(target)}/run-*`])
      ))
      for (const entry of runs) {
        if (existing.has(`refs/tags/${runTagFor(target, entry.run)}`)) {
          skipped += 1
          say(`run-${entry.run}: skipped`)
        } else if (dryRun) {
          say(`run-${entry.run}: would copy`)
        } else {
          await copyRun(exec, { tmp, target, targetUrl, evidenceUrl, entry })
          copied += 1
          say(`run-${entry.run}: copied`)
        }
      }
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
  say(`total: ${copied} copied, ${skipped} skipped`)
  return { copied, skipped, lines }
}

async function main (argv) {
  const { opts } = parseArgs(argv, { flags: ['dry-run', 'help'] })
  if (opts.help) {
    process.stdout.write(`${USAGE}\n`)
    return
  }
  if (!isSafeTarget(opts.target)) refuse(`--target <owner>/<repo> is required\n${USAGE}`)
  const override = opts['evidence-repo'] ?? null
  if (override !== null && !isSafeTarget(override)) refuse(`--evidence-repo must be <owner>/<repo>, got ${JSON.stringify(override)}`)
  const configPath = typeof opts.config === 'string' ? opts.config : undefined
  const evidence = evidenceRepoFor({ evidence: await readEvidenceSetting({ path: configPath }) }, override)
  if (evidence === null) {
    refuse(`no evidence repository: set \`evidence\` in ${configPath ?? '~/.ultrapowers/fleet.json'} or pass --evidence-repo <owner>/<repo>`)
  }
  await migrateEvidence({ target: opts.target, evidence, dryRun: opts['dry-run'] === true })
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (invokedPath === fileURLToPath(import.meta.url)) {
  await runCli(main, process.argv.slice(2))
}
