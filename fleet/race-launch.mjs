// fleet/race-launch.mjs — #511 task 8: the launch verb.
//
//   node fleet/race.mjs launch <plan.md> <raceId> [--k N] [--race-dir DIR] [drive-one flags]
//
// One committed plan, K concurrent attempts (the #454 launch shape). Every
// attempt gets its own runId, port, db-dir and checkout (`allocateRuns`), every
// checkout is the same `baseCommit` with origin re-pointed at the launch
// checkout's remote (`cloneAtCommit`), and every drive is built through
// drive-one's own `parseArgs`/`buildDriveOptions` seam — never hand-assembled,
// because the token read, the TTL, the heartbeat and the publish constants all
// live behind it.
//
// Three orderings here are load-bearing:
//
//   1. The origin read and the plan resolution happen BEFORE the manifest is
//      written and before the first clone, so a race that cannot publish fails
//      while it is still free rather than K paid drives later.
//   2. The manifest is written before any drive starts. The dials are
//      pre-registered; a manifest written after results are visible would let
//      them be chosen to fit what came back.
//   3. Every drive is SETTLED, not raced (`Promise.allSettled`). A preflight
//      refusal on one attempt used to take the process down mid-provision and
//      leave the siblings' `fleet-<runId>` VMs orphaned — the defect run-47's
//      review and all three race-48 reviews flagged (#535 item 1). A rejection
//      is reported after all K settle, never by exiting while siblings run.
//
// The drives run in-process, one process per race: the orchestrator dies with
// the drive it is watching, so there is no detached child to outlive it.
import { driveOne as defaultDriveOne } from './drive.mjs'
import { buildDriveOptions } from './drive-one.mjs'
import { parseLaunchArgs } from './race.mjs'
import { DIALS, assertManifest, writeRaceManifest } from './race-manifest.mjs'
import { allocateRuns } from './race-allocate.mjs'
import {
  gitRunner,
  baseCommitOf,
  originUrlOf,
  cloneAtCommit,
  resolvePlan,
} from './race-clone.mjs'

/**
 * Launch a race: K drives of one plan at one commit, all in flight together.
 *
 * @param {string[]} argv - the `launch` verb's argv (the raceId rides in as
 *   drive-one's runId positional; `parseLaunchArgs` owns the grammar).
 * @param {object} [deps]
 * @param {(opts: object) => Promise<any>} [deps.drive] - `driveOne`; injected in tests.
 * @param {(args: string[], opts?: {cwd?: string}) => Promise<string>} [deps.git] -
 *   every git call travels through this one runner.
 * @param {string} [deps.evidenceDir] - overrides the parsed evidence dir for
 *   both the manifest and the drives (tests pass a temp dir).
 * @param {() => string|number} [deps.now] - the `launchedAt` instant.
 * @param {(line: string) => void} [deps.progressSink] - receives every attempt's
 *   progress narration, each line prefixed with its own runId.
 * @param {(line: string) => void} [deps.stdout]
 * @param {(line: string) => void} [deps.stderr]
 *   Anything else (`readToken`, `exec`) is forwarded to `buildDriveOptions`.
 * @returns {Promise<{manifest: object, results: Array<{runId: string, status: 'fulfilled'|'rejected', value?: any, reason?: any}>}>}
 */
export const launchRace = async (argv, deps = {}) => {
  const {
    drive = defaultDriveOne,
    git = gitRunner,
    evidenceDir: evidenceDirOverride,
    now = () => new Date().toISOString(),
    stdout = (line) => process.stdout.write(`${line}\n`),
    stderr = (line) => process.stderr.write(`${line}\n`),
    progressSink = (line) => stderr(`[race ${new Date().toISOString()}] ${line}`),
    ...driveDeps
  } = deps

  const parsed = parseLaunchArgs(argv)
  const { raceId, k } = parsed
  // The launch checkout: drive-one's `--repo-dir`, defaulting to the checkout
  // this CLI lives in. Its HEAD is the raced commit and its origin is the
  // remote every clone is re-pointed at — both read through the injected git,
  // never off process.cwd().
  const sourceRepo = parsed.repoDir
  const evidenceDir = evidenceDirOverride ?? parsed.evidenceDir

  const baseCommit = await baseCommitOf(git, sourceRepo)
  const originUrl = await originUrlOf(git, sourceRepo)
  // Stored repo-relative: each attempt is handed this path against its own clone.
  const planPath = resolvePlan(sourceRepo, parsed.planPath)

  const runs = allocateRuns({
    raceId,
    k,
    port: parsed.port,
    dbDir: parsed.dbDir,
    raceDir: parsed.raceDir,
  })

  const manifest = {
    raceId,
    planPath,
    baseCommit,
    k,
    launchedAt: now(),
    runs,
    dials: DIALS,
  }
  assertManifest(manifest)
  const manifestFile = writeRaceManifest(evidenceDir, manifest)
  stdout(`race ${raceId}: manifest ${manifestFile}`)
  stdout(`race ${raceId}: ${k} attempts of ${planPath} at ${baseCommit} (from ${sourceRepo})`)

  // Sequential, and before any drive: a clone that fails stops the race while
  // the only thing built is a directory. `git clone` creates its destination's
  // leading directories, so the race dir needs no mkdir of its own.
  for (const run of runs) {
    await cloneAtCommit({ git, sourceRepo, repoDir: run.repoDir, baseCommit, originUrl })
    stdout(`race ${raceId}: ${run.runId} -> ${run.repoDir}`)
  }

  // Built for every attempt BEFORE the first drive starts: an option build that
  // throws (an unreadable token file, say) must refuse the race outright rather
  // than half of it. Exactly five keys differ between attempts — the four
  // allocated lanes and the runId-prefixed narration.
  const options = runs.map((run) => ({
    ...buildDriveOptions(
      {
        ...parsed,
        planPath,
        evidenceDir,
        runId: run.runId,
        port: run.port,
        dbDir: run.dbDir,
        repoDir: run.repoDir,
      },
      driveDeps,
    ),
    progressLog: (line) => progressSink(`${run.runId}: ${line}`),
  }))

  // The async arrow calls `drive` synchronously, so all K are in flight in one
  // tick, and a synchronous throw arrives as a rejection like any other.
  const settled = await Promise.allSettled(options.map(async (opts) => drive(opts)))
  const results = runs.map((run, i) => ({ runId: run.runId, ...settled[i] }))

  // Reported only now, with every sibling already settled.
  for (const result of results) {
    if (result.status === 'rejected') {
      stderr(`race ${raceId}: ${result.runId} rejected: ${String(result.reason?.message ?? result.reason)}`)
    } else {
      stdout(`race ${raceId}: ${result.runId} fulfilled`)
    }
  }

  return { manifest, results }
}
