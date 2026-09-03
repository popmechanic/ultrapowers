// fleet/race-launch.mjs — #511 task 8: the launch verb.
//
//   node fleet/race.mjs launch <plan.md> <raceId> --target <owner>/<repo> --base <sha> [--k N]
//
// One committed plan, K concurrent attempts (the #454 launch shape). Every
// attempt gets its own runId, port and db-dir (`allocateRuns`), and every drive
// is built through drive-one's own `parseArgs`/`buildDriveOptions` seam — never
// hand-assembled, because the token read, the TTL, the heartbeat and the
// publish constants all live behind it.
//
// This module runs no git and starts no subprocess of its own. The commit is
// not discovered here — it is NAMED on the launch line as `--base`, and every
// attempt is handed that same sha, the same `--target` and the same engine
// checkout. The drive reaches the target by fetching it into a ref of its own,
// which is what makes one checkout safe for K attempts at once; a race
// therefore needs no per-attempt checkout, and there is none.
//
// Two orderings here are load-bearing:
//
//   1. The manifest is written before any drive starts. The dials are
//      pre-registered; a manifest written after results are visible would let
//      them be chosen to fit what came back.
//   2. Every drive is SETTLED, not raced (`Promise.allSettled`). A preflight
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

/**
 * Launch a race: K drives of one plan at one commit, all in flight together.
 *
 * @param {string[]} argv - the `launch` verb's argv (the raceId rides in as
 *   drive-one's runId positional; `parseLaunchArgs` owns the grammar).
 * @param {object} [deps]
 * @param {(opts: object) => Promise<any>} [deps.drive] - `driveOne`; injected in tests.
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
    evidenceDir: evidenceDirOverride,
    now = () => new Date().toISOString(),
    stdout = (line) => process.stdout.write(`${line}\n`),
    stderr = (line) => process.stderr.write(`${line}\n`),
    progressSink = (line) => stderr(`[race ${new Date().toISOString()}] ${line}`),
    ...driveDeps
  } = deps

  const parsed = parseLaunchArgs(argv)
  const { raceId, k, target, baseSha, planPath } = parsed
  // The one engine checkout every attempt drives out of — drive-one's
  // `REPO_DIR`, defaulted there and no longer a flag anywhere.
  const repoDir = parsed.repoDir
  const evidenceDir = evidenceDirOverride ?? parsed.evidenceDir

  // `allocateRuns` still hands each lane a repo-dir; there are no per-attempt
  // checkouts any more, so the lane record carries the shared one and the
  // manifest says what actually happened.
  const runs = allocateRuns({
    raceId,
    k,
    port: parsed.port,
    dbDir: parsed.dbDir,
    raceDir: repoDir,
  }).map((run) => ({ ...run, repoDir }))

  const manifest = {
    raceId,
    planPath,
    baseCommit: baseSha,
    k,
    launchedAt: now(),
    runs,
    dials: DIALS,
  }
  assertManifest(manifest)
  const manifestFile = writeRaceManifest(evidenceDir, manifest)
  stdout(`race ${raceId}: manifest ${manifestFile}`)
  stdout(`race ${raceId}: ${k} attempts of ${planPath} on ${target} at ${baseSha} (from ${repoDir})`)

  // Built for every attempt BEFORE the first drive starts: an option build that
  // throws (an unreadable token file, say) must refuse the race outright rather
  // than half of it. Exactly four keys differ between attempts — the three
  // allocated lanes and the runId-prefixed narration. `target`, `baseSha` and
  // `repoDir` are shared by construction.
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
