#!/usr/bin/env node
// fleet/race.mjs — #511 attempt racing v1: the launch verb.
//
// A race is the SAME committed plan launched as K independent `driveOne` runs
// (spec docs/superpowers/specs/2026-09-01-511-attempt-racing.md §New machinery).
// Racing is composition, not modification: no engine file changes, no daemon —
// one process per race, K drives in flight via Promise.all, each starting and
// stopping its own orchestrator.
//
//   node fleet/race.mjs launch <plan.md> <raceId> --k 3 [drive-one flags]
//
// The three things this file is careful about:
//
//   * Option-building goes through drive-one's `parseArgs`/`buildDriveOptions`
//     seam (spec finding 10). The token read, TTL, heartbeat and publish
//     constants live behind that seam and must not be re-typed here — the race
//     overrides EXACTLY runId, port, dbDir, repoDir and a runId-prefixed
//     `progressLog`, so three interleaved drives stay attributable on one
//     stderr (finding 11).
//   * Per-run repo-dir clones at the recorded base commit (finding 6, the
//     review's most valuable). A shared `repoDir` races the publish leg's
//     fetch→rev-parse window across siblings — last-writer-wins `FETCH_HEAD`,
//     exactly the #497 zone. K fresh clones close it.
//   * The manifest is written BEFORE any drive starts, so the pre-registered
//     dials cannot be chosen once results are visible.
//
//   * Plan cleanliness IS re-verified here, once, before anything is spent.
//     Spec finding 9 delegated it to `driveOne`'s #337 preflight, but finding
//     6's per-run clones made that delegation structurally unreachable: the
//     preflight compares the working tree of its OWN repoDir against
//     `git show HEAD:<plan>`, and in a clone detached at `baseCommit` those
//     are the same bytes by construction — the "uncommitted" and "dirty"
//     refusals can never fire, and a plan absent at the base only narrates
//     "check skipped". So an uncommitted plan would clone K repos, write the
//     manifest, and burn K sandbox provisions before failing, where an
//     unraced `drive-one` refuses before provisioning anything. The launcher
//     owns the check now; `driveOne`'s preflight still runs per clone and
//     still owns the fitness verdict.
import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { driveOne } from './drive.mjs'
import { buildDriveOptions, parseArgs } from './drive-one.mjs'
import { isSafeRepoPath } from './shim-main.mjs'

// Run-ID suffixes: `<raceId>-a`, `-b`, `-c`. Never-reuse stays the #211
// convention — suffixing onto a fresh `run-N` cannot collide with any
// conventionally named prior run (spec finding 12).
export const SUFFIXES = Object.freeze([...'abcdefghijklmnopqrstuvwxyz'])

export const DEFAULT_K = 3

// The pre-registered measurement block (spec §Measurement), copied into every
// manifest AT LAUNCH. The judge appends its verdict without disturbing this.
export const DIALS = Object.freeze({
  baseline: {
    'run-44': { wallMinutes: 66, tokens: 728_000, fixRounds: 0 },
    'run-45': { wallMinutes: 67, tokens: 588_000, fixRounds: 1, planTracedDefects: 2 },
  },
  raceWall: 'launch timestamp -> max(per-run elapsedMs end)',
  totalTokens: 'sum of per-run spendObservational across K (expect ~Kx)',
  perRun: ['drive status', 'fix rounds', 'tokens'],
  comparatorDecisiveness:
    'which rubric stage decided — name the stage; never read "zero ties" as rubric quality',
  winnerDefectSurface: "defects traced back to the merged winner within the next two sittings",
  nOfOne: 'the first race detects catastrophe-or-not; it cannot rank racing against single-run driving',
})

// raceId-qualified: the evidence dir is shared, and an unqualified `race.json`
// is clobbered by the next race (spec finding 8).
export const manifestPath = (evidenceDir, raceId) => path.join(evidenceDir, `race-${raceId}.json`)

export const readRaceManifest = (evidenceDir, raceId) =>
  JSON.parse(fs.readFileSync(manifestPath(evidenceDir, raceId), 'utf8'))

// The injectable git seam. Arguments travel as an argv ARRAY, never through a
// shell — nothing here needs quoting, and no operator path can become a word
// boundary. A non-zero exit rejects: every git call this file makes is a
// precondition of the race, so failing fast is the only correct answer.
export const gitRunner = (args, { cwd } = {}) =>
  new Promise((resolve, reject) => {
    execFile('git', args, { cwd, maxBuffer: 1024 * 1024 * 16 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`race: git ${args.join(' ')} failed — ${String(stderr ?? error.message).trim()}`))
        return
      }
      resolve(String(stdout ?? ''))
    })
  })

// The plan as `driveOne` will resolve it: a relative `planPath` is repo-dir
// relative, an absolute one is made relative to the same repo dir (drive.mjs's
// own resolution, mirrored so the two never disagree about which file is meant).
export const resolvePlan = (repoDir, planPath) => {
  const planFile = path.isAbsolute(planPath) ? planPath : path.join(repoDir, planPath)
  return { planFile, planRel: path.relative(repoDir, planFile) }
}

/**
 * The #337 precondition, hoisted to the launcher (see the header note): the
 * plan must EXIST at the recorded base commit, and any working-tree copy must
 * match it byte-for-byte. Both refusals are operator errors, not fitness
 * verdicts, so `--allow-unfit-plan` does not cover them — and both must land
 * before the first clone, because K clones and K sandbox provisions are the
 * cost of learning it late.
 *
 * @param {object} args - `git` (the injectable runner), `repoDir` (the launch
 *   checkout), `planPath` (as parsed), `baseCommit` (the recorded sha).
 */
export const assertPlanCommittedAtBase = async ({ git, repoDir, planPath, baseCommit }) => {
  const { planFile, planRel } = resolvePlan(repoDir, planPath)
  // #362's lesson: a path that fails the guard is refused AS a path problem,
  // never read as "absent at the base commit" and reported as uncommitted.
  if (!isSafeRepoPath(planRel)) {
    throw new Error(
      `race: plan path ${JSON.stringify(planRel)} (from ${planPath}) fails the repo-path guard — ` +
        `[A-Za-z0-9._/-] only, no leading '-', no '..' segment, and inside ${repoDir} (#362)`,
    )
  }
  try {
    await git(['cat-file', '-e', `${baseCommit}:${planRel}`], { cwd: repoDir })
  } catch {
    throw new Error(
      `race: plan ${planRel} does not exist at ${baseCommit} — every run clones that commit and every ` +
        `sandbox executes it, so a race of an uncommitted plan is K sandboxes running nothing; commit it ` +
        `and relaunch (#337)`,
    )
  }
  let workingText = null
  try {
    workingText = fs.readFileSync(planFile, 'utf8')
  } catch {
    // No local copy to disagree with the committed one; the clones carry the
    // committed text and that is the text the race is about.
    return
  }
  const committedText = String(await git(['show', `${baseCommit}:${planRel}`], { cwd: repoDir }))
  if (workingText !== committedText) {
    throw new Error(
      `race: plan ${planRel} differs between ${baseCommit}:${planRel} (what the K sandboxes execute) and ` +
        `the working tree ${planFile} — every run would race the committed text while you read the edited ` +
        `one; commit or discard the edit and relaunch (#337)`,
    )
  }
}

export const usage = () =>
  'usage: node fleet/race.mjs launch <plan.md> <raceId> [--k N] [drive-one passthrough flags]'

// `--k` is the one flag race.mjs owns; everything else is drive-one's, parsed
// by drive-one. The raceId rides the positional drive-one calls `runId`, so it
// inherits the #211 token grammar for free.
export const parseLaunchArgs = (argv) => {
  const passthrough = []
  let k = DEFAULT_K
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] !== '--k') {
      passthrough.push(argv[i])
      continue
    }
    const value = argv[i + 1]
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`race: --k needs a value\n${usage()}`)
    }
    const n = Number(value)
    if (!Number.isInteger(n) || n < 2 || n > SUFFIXES.length) {
      throw new Error(
        `race: --k must be an integer between 2 and ${SUFFIXES.length} (got ${value}) — a race needs contestants`,
      )
    }
    k = n
    i += 1
  }
  const parsed = parseArgs(passthrough)
  return { ...parsed, raceId: parsed.runId, k }
}

// Ports base+0/+1/+2…, db-dirs `<base>-a/-b/-c`, and a per-run repo-dir
// beside each run's db-dir. Pairwise distinct by construction, and a suffixed
// run ID can never equal its own raceId.
export const allocateRuns = ({ raceId, k, port, dbDir }) =>
  SUFFIXES.slice(0, k).map((suffix, i) => {
    const runDbDir = `${dbDir}-${suffix}`
    return {
      runId: `${raceId}-${suffix}`,
      port: port + i,
      dbDir: runDbDir,
      repoDir: `${runDbDir}-repo`,
    }
  })

// One fresh clone per run, checked out DETACHED at the recorded base commit:
// `driveOne` resolves its base as HEAD of its own repoDir, so the detached
// HEAD is the whole point. `origin` is re-pointed at the launch checkout's own
// origin — a local clone would otherwise name a filesystem path, and the
// publish leg pushes to `origin`.
const cloneRunRepo = async ({ git, sourceRepo, originUrl, repoDir, baseCommit }) => {
  fs.mkdirSync(path.dirname(repoDir), { recursive: true })
  await git(['clone', sourceRepo, repoDir])
  if (originUrl) await git(['remote', 'set-url', 'origin', originUrl], { cwd: repoDir })
  await git(['checkout', '--detach', baseCommit], { cwd: repoDir })
}

/**
 * Launch a race: record the base commit, allocate K run identities, write the
 * raceId-qualified manifest, then drive K times concurrently.
 *
 * @param {string[]} argv - `<plan.md> <raceId> [--k N] [drive-one flags]`
 * @param {object} [deps] - `drive` (driveOne), `git` (gitRunner), `clock`,
 *   `progressSink`, plus drive-one's `readToken`/`exec`.
 * @returns {Promise<{manifest: object, results: object[]}>}
 */
export const launchRace = async (argv, deps = {}) => {
  const {
    drive = driveOne,
    git = gitRunner,
    clock = Date.now,
    progressSink = (line) => console.error(line),
    ...driveDeps
  } = deps

  const parsed = parseLaunchArgs(argv)
  const { raceId, k, planPath, evidenceDir } = parsed

  // 1. The base commit, recorded ONCE, and the plan checked AT it — before a
  //    single clone, manifest byte or sandbox provision is spent.
  const baseCommit = String(await git(['rev-parse', 'HEAD'], { cwd: parsed.repoDir })).trim()
  if (!/^[0-9a-f]{7,40}$/.test(baseCommit)) {
    throw new Error(`race: rev-parse HEAD gave ${JSON.stringify(baseCommit)}, not a commit sha`)
  }
  await assertPlanCommittedAtBase({ git, repoDir: parsed.repoDir, planPath, baseCommit })

  // 2. K run identities, and K clones of the launch checkout at that commit.
  const runs = allocateRuns({ raceId, k, port: parsed.port, dbDir: parsed.dbDir })
  let originUrl = null
  try {
    originUrl = String(await git(['remote', 'get-url', 'origin'], { cwd: parsed.repoDir })).trim() || null
  } catch {
    // A checkout with no origin still races; only its publish leg has nowhere
    // to push, and that is driveOne's business to report, not ours to refuse.
    originUrl = null
  }
  for (const run of runs) {
    await cloneRunRepo({ git, sourceRepo: parsed.repoDir, originUrl, repoDir: run.repoDir, baseCommit })
  }

  // 3. The manifest, BEFORE any drive — pre-registration is the whole point.
  const manifest = {
    raceId,
    planPath,
    baseCommit,
    k,
    launchedAt: new Date(clock()).toISOString(),
    runs,
    dials: DIALS,
  }
  fs.mkdirSync(evidenceDir, { recursive: true })
  fs.writeFileSync(manifestPath(evidenceDir, raceId), `${JSON.stringify(manifest, null, 2)}\n`)

  // 4. K drives, concurrent and in-process. Promise.all is also the fast
  //    failure: the first drive to throw (a provisioning refusal, say)
  //    rejects the race rather than being swallowed into a scorecard.
  const results = await Promise.all(
    runs.map((run) =>
      drive({
        ...buildDriveOptions({ ...parsed, ...run }, driveDeps),
        progressLog: (line) => progressSink(`[${run.runId}] ${line}`),
      }),
    ),
  )

  return { manifest, results }
}

export const main = async (argv = process.argv.slice(2), deps = {}) => {
  const { log = console.log, ...raceDeps } = deps
  const [verb, ...rest] = argv
  if (verb !== 'launch') {
    throw new Error(`race: unknown verb ${JSON.stringify(verb ?? '')}\n${usage()}`)
  }
  const { evidenceDir } = parseLaunchArgs(rest)
  const { manifest, results } = await launchRace(rest, raceDeps)
  log(`race ${manifest.raceId}: ${manifest.k} runs of ${manifest.planPath} at ${manifest.baseCommit}`)
  for (const run of manifest.runs) {
    log(`  ${run.runId} port=${run.port} db-dir=${run.dbDir} repo-dir=${run.repoDir}`)
  }
  log(`manifest: ${manifestPath(evidenceDir, manifest.raceId)}`)
  return { manifest, results }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error?.message ?? error)
    process.exit(1)
  })
}
