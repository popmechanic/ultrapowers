// fleet/race-clone.mjs — #511 task 3: the clone seam.
//
// Attempt racing runs k drives from ONE commit. Each attempt needs its own
// checkout of that commit, and each attempt must still publish like a normal
// run. Those two needs collide in one git default, found twice on 2026-09-01
// (the run-47 review and the race-48-c critic): `git clone` of a LOCAL path
// sets the clone's `remote.origin.url` to that path, so the drive's publish
// leg — `git push origin …` from the run's repoDir, then `gh pr create` with
// cwd repoDir — pushes into a directory, not GitHub. `driveOne` documents
// `origin` as the orchestrator clone's https remote; a per-run clone silently
// breaks that documented invariant.
//
// So the order here is deliberate: read the launch checkout's origin FIRST,
// refuse an empty one or one that is itself a filesystem path, and re-point
// every clone at it. Same for the plan: `resolvePlan` mirrors driveOne's
// repo-path rule so the launcher fails before any clone rather than after the
// raceId is burned.
//
// Every git call travels through one injectable runner, so callers' tests need
// no repository — they assert the recorded argv sequence. This module fills the
// manifest's `baseCommit` and each run's `repoDir` in `race-<raceId>.json`
// (`raceId`, `planPath`, `baseCommit`, `k`, `launchedAt`, `runs` — an array of
// `{runId, port, dbDir, repoDir}` — `dials`, and after judging `verdict`).
import path from 'node:path'
import { execFile } from 'node:child_process'

/**
 * The default runner: one git subprocess, resolving to its stdout.
 *
 * Never a shell — argv is passed through, so a path or URL with a space in it
 * needs no quoting and can carry no injection. Rejects with git's stderr
 * attached, which is the only diagnostic the launcher gets.
 *
 * @param {string[]} args - the git argv, without the leading `git`.
 * @param {{cwd?: string}} [opts] - `cwd` omitted means this process's cwd
 *   (correct for `clone`, whose destination is an argument).
 * @returns {Promise<string>} stdout.
 */
export const gitRunner = (args, { cwd } = {}) =>
  new Promise((resolve, reject) => {
    execFile('git', args, { cwd, encoding: 'utf8', maxBuffer: 1024 * 1024 * 16 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`git ${args.join(' ')} failed: ${String(stderr ?? '').trim() || error.message}`))
        return
      }
      resolve(String(stdout ?? ''))
    })
  })

const HEX40 = /^[0-9a-f]{40}$/

/**
 * The commit the race is run from, read from the launch checkout's HEAD.
 *
 * A 40-hex sha or nothing: every attempt is checked out at this exact string,
 * and a symbolic answer ('HEAD', a branch name, an abbreviation) would let two
 * attempts race different trees while the manifest claims one `baseCommit`.
 *
 * @param {(args: string[], opts?: {cwd?: string}) => Promise<string>} git
 * @param {string} repoDir - the launch checkout.
 * @returns {Promise<string>}
 */
export const baseCommitOf = async (git, repoDir) => {
  const head = String(await git(['rev-parse', 'HEAD'], { cwd: repoDir })).trim()
  if (!HEX40.test(head)) {
    throw new Error(
      `race-clone: HEAD of ${repoDir} is ${JSON.stringify(head)}, not a 40-hex commit — ` +
        'every attempt is checked out at this exact sha, so a symbolic or abbreviated one is refused',
    )
  }
  return head
}

/** A remote a clone could never push to: unset, a bare path, or a file:// URL. */
const isFilesystemRemote = (url) => url.startsWith('/') || url.startsWith('file://')

/**
 * The launch checkout's `origin` — the URL every per-run clone is re-pointed at.
 *
 * Refused, BEFORE any clone, when it is empty or is itself a filesystem path.
 * Both readings mean the same thing downstream: the attempt's publish leg would
 * have nowhere real to push, and the failure would surface at the end of a paid
 * run instead of at the start of a free one.
 *
 * @param {(args: string[], opts?: {cwd?: string}) => Promise<string>} git
 * @param {string} repoDir - the launch checkout.
 * @returns {Promise<string>}
 */
export const originUrlOf = async (git, repoDir) => {
  let url = ''
  try {
    // `config --get` exits non-zero on an unset key; that is the empty case,
    // not a crash, and it reads identically to a key set to nothing.
    url = String(await git(['config', '--get', 'remote.origin.url'], { cwd: repoDir })).trim()
  } catch {
    url = ''
  }
  if (!url) {
    throw new Error(
      `race-clone: ${repoDir} has no 'origin' remote — every attempt's clone is re-pointed at it, and ` +
        "driveOne's publish leg pushes to 'origin'. Set it to the https remote before racing",
    )
  }
  if (isFilesystemRemote(url)) {
    throw new Error(
      `race-clone: 'origin' of ${repoDir} is ${JSON.stringify(url)} — a filesystem path, not a remote. ` +
        "A clone of a local path inherits that path as its own 'origin', so the publish leg would push " +
        'nowhere real (found twice on 2026-09-01). Point origin at the https remote before racing',
    )
  }
  return url
}

/**
 * One attempt's checkout: clone, detach at the raced commit, re-point origin.
 *
 * The three calls are sequential and awaited, so a failing clone stops the
 * sequence — a half-built repoDir is never checked out into or re-pointed.
 * The set-url is what makes the clone publishable: without it the clone's
 * origin is `sourceRepo` itself.
 *
 * @param {{git: (args: string[], opts?: {cwd?: string}) => Promise<string>,
 *          sourceRepo: string, repoDir: string, baseCommit: string, originUrl: string}} opts
 * @returns {Promise<void>}
 */
export const cloneAtCommit = async ({ git, sourceRepo, repoDir, baseCommit, originUrl }) => {
  await git(['clone', sourceRepo, repoDir])
  await git(['checkout', '--detach', baseCommit], { cwd: repoDir })
  await git(['remote', 'set-url', 'origin', originUrl], { cwd: repoDir })
}

// driveOne's repo-path guard, as a path shape: [A-Za-z0-9._/-] only, no leading
// '-' on any segment, no '..' segment.
const SAFE_REPO_PATH = /^[A-Za-z0-9._/-]+$/

/**
 * The plan, as the repo-relative path each attempt's drive will be handed.
 *
 * `driveOne` resolves a relative `planPath` against the run's own `repoDir` and
 * refuses one that escapes it; this mirrors that rule so the launcher fails
 * here — before the first clone, before the raceId is burned — rather than k
 * drives later.
 *
 * @param {string} repoDir
 * @param {string} planPath - relative to repoDir, or absolute inside it.
 * @returns {string} the path relative to repoDir.
 */
export const resolvePlan = (repoDir, planPath) => {
  const planFile = path.isAbsolute(planPath) ? planPath : path.join(repoDir, planPath)
  const rel = path.relative(repoDir, planFile)
  const segments = rel.split('/')
  if (
    !rel ||
    path.isAbsolute(rel) ||
    !SAFE_REPO_PATH.test(rel) ||
    segments.some((segment) => segment === '..' || segment.startsWith('-'))
  ) {
    throw new Error(
      `race-clone: plan path ${JSON.stringify(rel)} (from ${planPath}) fails the repo-path guard — ` +
        `[A-Za-z0-9._/-] only, no leading '-', no '..' segment, and inside ${repoDir}. ` +
        'Each attempt receives this path relative to its own clone',
    )
  }
  return rel
}
