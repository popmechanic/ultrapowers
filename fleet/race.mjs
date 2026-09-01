#!/usr/bin/env node
// fleet/race.mjs — #511 attempt racing v1: one committed plan, K whole runs.
//
//   node fleet/race.mjs launch <plan.md> <raceId> [--k N] [--race-dir DIR] [drive-one flags]
//
// Racing is COMPOSITION, not modification: no engine file changes. The launch
// verb allocates K non-colliding run identities, clones the checkout K times at
// one recorded base commit (each clone kept on the launch checkout's own
// GitHub origin, so the publish leg has somewhere real to push), writes the
// race manifest (with its pre-registered dials) BEFORE any drive starts, and
// then runs the K `driveOne` calls concurrently in this one process — no
// daemon, the orchestrator-dies-with-the-drive rule intact.
//
// Two things deliberately do NOT live here. Plan cleanliness: `driveOne`'s own
// #337 preflight is the enforcement, so there is no second copy of that
// contract — a race merely fails fast when a drive throws it. Drive constants:
// the token read, TTL, heartbeat and publish knobs come off `drive-one.mjs`'s
// `parseArgs`/`buildDriveOptions` seam, never re-typed here.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { driveOne } from './drive.mjs'
import { buildDriveOptions, parseArgs } from './drive-one.mjs'

// K = 3 for the first race (#511 operator decision); the suffix alphabet is
// the only ceiling on K.
export const DEFAULT_K = 3
const SUFFIXES = 'abcdefghijklmnopqrstuvwxyz'
export const MAX_K = SUFFIXES.length

// The measurement block, copied verbatim into every manifest at launch — the
// spec's §Measurement list, written down before any result is visible so the
// dials cannot be chosen to fit what came back.
export const DIALS = Object.freeze({
  baseline: Object.freeze({
    'run-44': Object.freeze({ wallMinutes: 66, tokens: 728_000, fixRounds: 0 }),
    'run-45': Object.freeze({ wallMinutes: 67, tokens: 588_000, fixRounds: 1, planTracedDefects: 2 }),
  }),
  // Fixed here so the wall is computed the way it was pre-registered.
  raceWall: 'manifest launchedAt -> max over runs of the per-run elapsedMs end',
  totalTokens: 'sum of per-run tokens across the K runs (expect about K x a single run)',
  perRun: 'per-run drive status, fix rounds, tokens',
  comparatorDecisiveness:
    'which rubric stage decided — name the stage; never read "zero ties" as rubric quality',
  winnerDefectSurface: "the winner's post-merge defect surface — anything traced back within the next two sittings",
})

export const usage = () =>
  'usage: node fleet/race.mjs launch <plan.md> <raceId> [--k N] [--race-dir DIR] [drive-one flags]'

// Every git call the race makes (rev-parse, clone, checkout) goes through this
// one seam, so the tests need no remote, no clone and no checkout.
export const gitExec = (args) =>
  new Promise((resolve, reject) => {
    execFile('git', args, { maxBuffer: 1024 * 1024 * 16 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`race: git ${args.join(' ')} failed: ${String(stderr ?? '').trim() || error.message}`))
        return
      }
      resolve(String(stdout ?? ''))
    })
  })

// #323: the evidence dir is shared across runs, so an unqualified `race.json`
// would be clobbered by the next race.
export const raceManifestPath = (evidenceDir, raceId) => path.join(evidenceDir, `race-${raceId}.json`)

export const readRaceManifest = (evidenceDir, raceId) =>
  JSON.parse(fs.readFileSync(raceManifestPath(evidenceDir, raceId), 'utf8'))

// #211 is a convention (never reuse a run ID), and the decidable half of it is
// this: a suffixed contestant ID can never be its own raceId.
export const runIdFor = (raceId, index) => `${raceId}-${SUFFIXES[index]}`

// A local `git clone` points the new clone's `origin` at the source checkout's
// filesystem path. `driveOne`'s publish leg pushes to `origin` and then runs
// `gh pr create` with cwd=repoDir, both of which need the GitHub https remote
// ("`origin` is the orchestrator clone's https remote", drive.mjs) — left
// alone, every race branch would land in the operator's own launch checkout
// (silently: it isn't the checked-out branch there) and `gh pr create` would
// refuse for want of a known GitHub host, so the race would finish with zero
// PRs and nothing to merge or close. Carry the real URL onto each clone.
export const originUrlOf = async (git, repoDir) => {
  let url = ''
  try {
    url = (await git(['-C', repoDir, 'remote', 'get-url', 'origin'])).trim()
  } catch (error) {
    throw new Error(
      `race: cannot read origin of ${repoDir} — the per-run clones would have nowhere to publish: ${error?.message ?? error}`,
    )
  }
  if (!url) {
    throw new Error(`race: ${repoDir} has no origin URL — the per-run clones would have nowhere to publish`)
  }
  return url
}

// Per-run repo-dirs are not a nicety: `driveOne` resolves its base as HEAD of
// its own repoDir, and siblings sharing one would race the publish leg's
// fetch -> rev-parse FETCH_HEAD window (spec finding 6, the #497 zone).
export const allocateRuns = ({ raceId, k, port, dbDir, raceDir }) =>
  Array.from({ length: k }, (_, i) => {
    const runId = runIdFor(raceId, i)
    return { runId, port: port + i, dbDir: `${dbDir}-${SUFFIXES[i]}`, repoDir: path.join(raceDir, runId) }
  })

// `--k` and `--race-dir` belong to the race; everything else is drive-one's,
// parsed by drive-one, including its refusals. The raceId rides in as the
// runId positional, so it gets the #211 grammar check for free.
export const parseLaunchArgs = (argv) => {
  const rest = []
  let k = DEFAULT_K
  let raceDir
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg !== '--k' && arg !== '--race-dir') {
      rest.push(arg)
      continue
    }
    const value = argv[i + 1]
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`race: ${arg} needs a value\n${usage()}`)
    }
    if (arg === '--k') {
      k = Number(value)
      if (!Number.isInteger(k) || k < 1 || k > MAX_K) {
        throw new Error(`race: --k must be an integer in 1..${MAX_K}, got ${value}`)
      }
    } else {
      raceDir = value
    }
    i += 1
  }
  const parsed = parseArgs(rest)
  return {
    ...parsed,
    raceId: parsed.runId,
    k,
    raceDir: raceDir ?? path.join(os.tmpdir(), `fleet-race-${parsed.runId}`),
  }
}

export const launchRace = async (
  argv,
  {
    drive = driveOne,
    git = gitExec,
    now = () => new Date().toISOString(),
    narrate = (line) => console.error(line),
    ...deps
  } = {},
) => {
  const launch = parseLaunchArgs(argv)
  const { raceId, k, raceDir, planPath, evidenceDir } = launch

  // One base commit for the whole race. Cleanliness is driveOne's #337 job.
  const baseCommit = (await git(['-C', launch.repoDir, 'rev-parse', 'HEAD'])).trim()
  const originUrl = await originUrlOf(git, launch.repoDir)
  const runs = allocateRuns({ raceId, k, port: launch.port, dbDir: launch.dbDir, raceDir })

  fs.mkdirSync(raceDir, { recursive: true })
  for (const run of runs) {
    await git(['clone', '--no-hardlinks', launch.repoDir, run.repoDir])
    await git(['-C', run.repoDir, 'checkout', '--detach', baseCommit])
    // Undo the local-path origin the clone just wrote, or the publish leg
    // pushes into the launch checkout instead of GitHub.
    await git(['-C', run.repoDir, 'remote', 'set-url', 'origin', originUrl])
  }

  const manifest = { raceId, planPath, baseCommit, k, launchedAt: now(), runs, dials: DIALS }
  fs.mkdirSync(evidenceDir, { recursive: true })
  fs.writeFileSync(raceManifestPath(evidenceDir, raceId), `${JSON.stringify(manifest, null, 2)}\n`)

  // Only after the dials are on disk. Promise.all is the fast failure: a
  // drive that throws its preflight takes the race down with it.
  const results = await Promise.all(
    runs.map((run) =>
      drive({
        ...buildDriveOptions({ ...launch, ...run }, deps),
        // Three drives narrate onto one stderr; the runId prefix is what makes
        // the interleaved lines attributable (spec review finding 11).
        progressLog: (line) => narrate(`[race ${run.runId} ${new Date().toISOString()}] ${line}`),
      }),
    ),
  )
  return { manifest, results }
}

export const main = async (argv = process.argv.slice(2), deps = {}) => {
  const [verb, ...rest] = argv
  const { log = console.log } = deps
  if (verb === 'launch') {
    const { evidenceDir } = parseLaunchArgs(rest)
    const { manifest, results } = await launchRace(rest, deps)
    log(`race ${manifest.raceId}: ${manifest.k} runs of ${manifest.planPath} at ${manifest.baseCommit}`)
    log(`manifest: ${raceManifestPath(evidenceDir, manifest.raceId)}`)
    manifest.runs.forEach((run, i) => {
      log(`${run.runId}: port=${run.port} db=${run.dbDir} repo=${run.repoDir} report=${results[i]?.reportPath ?? '(none)'}`)
    })
    return { manifest, results }
  }
  throw new Error(`race: unknown verb ${verb ?? '(none given)'}\n${usage()}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error?.message ?? error)
    process.exit(1)
  })
}
