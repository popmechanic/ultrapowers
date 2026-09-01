#!/usr/bin/env node
// fleet/race.mjs — attempt racing (#511): run the SAME committed plan as K
// concurrent drives and judge the winner.
//
//   node fleet/race.mjs launch <plan.md> <raceId> [--k 3] [<drive-one flags>]
//
// The launch verb is the #454 shape, committed: K distinct runIds, ports,
// db-dirs and repo-dirs derived from one raceId, and a raceId-qualified
// manifest — `race-<raceId>.json` in the resolved evidence dir — written
// BEFORE the first drive starts. That ordering is the point of the file: the
// `dials` block is the pre-registered measurement, and a measurement chosen
// after the results are visible is not one.
//
// Three constraints shape the rest:
//
//   * Options are built through drive-one's `parseArgs`/`buildDriveOptions`
//     seam, never hand-assembled. The token read, the TTL, the heartbeat and
//     publish constants live behind that seam; a second hand-typed option
//     literal is exactly the drift #193 item 6 deleted. A race overrides
//     exactly four fields — runId, port, dbDir, repoDir — plus a
//     runId-prefixed progressLog so K interleaved narrations stay readable.
//
//   * Each attempt gets its OWN clone of the launch checkout, detached at the
//     recorded base commit. `driveOne` resolves its base as HEAD of its own
//     repoDir, and the publish leg's FETCH_HEAD window is per-repository:
//     sharing one repoDir would race the siblings against each other (spec
//     finding 6).
//
//   * One process per race. The K drives are in-process promises awaited
//     together — no daemon, no scheduler. Plan cleanliness is `driveOne`'s own
//     preflight; a race only fails fast when a drive throws it.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { driveOne } from './drive.mjs'
import { buildDriveOptions, parseArgs } from './drive-one.mjs'

// Attempt suffixes, in the order they are allocated: `<raceId>-a`, `-b`, `-c`.
// A letter rather than an index because the runId names a sandbox VM and a
// store row, and `race-1-1` reads as a typo of the raceId.
export const SUFFIXES = Object.freeze('abcdefghijklmnopqrstuvwxyz'.split(''))

// #454's shape and the spec's default: three attempts.
export const DEFAULT_K = 3

// THE PRE-REGISTERED MEASUREMENT (spec §Measurement), copied verbatim into
// every manifest at launch. It is recorded because the judge's rubric is only
// evidence if it was fixed before the results existed — the manifest is the
// receipt for that. The judge reads the artifacts and applies this order; it
// appends its verdict to the manifest and never rewrites these values.
export const DIALS = Object.freeze({
  // The ordered rubric: each stage decides only the ties the one above leaves.
  rubric: Object.freeze(['gate-green', 'fix-rounds', 'tokens', 'runid-lexicographic']),
  metrics: Object.freeze({
    status: 'gate-read-<runId>.json: the drive status; only gate-green contests',
    fixRounds: "the run's events whose label carries the engine's `fix:` prefix",
    tokens: 'spendObservational.ledger, falling back to .reported for ALL contestants (flagged) when any is null',
    elapsedMs: 'gate-read-<runId>.json: wall clock, reported but not ranked',
  }),
  terminal: 'a run is terminal when its gate-read file exists — green, parked and failed drives all write one',
  success: 'the race succeeds when at least one attempt reaches gate-green; zero greens is a FAILED race, merge nothing',
  interpretation: 'one race is n=1 — the scorecard names the deciding stage precisely so a decisive rubric is not read as rubric quality',
})

export const usage = () =>
  'usage: node fleet/race.mjs launch <plan.md> <raceId> [--k 3] [<drive-one flags>]'

export const raceManifestPath = (evidenceDir, raceId) =>
  path.join(evidenceDir, `race-${raceId}.json`)

export const readRaceManifest = (evidenceDir, raceId) => {
  const manifestPath = raceManifestPath(evidenceDir, raceId)
  let text
  try {
    text = fs.readFileSync(manifestPath, 'utf8')
  } catch {
    throw new Error(`race: no manifest at ${manifestPath} — was this race launched?`)
  }
  return JSON.parse(text)
}

// Pull a race-only flag out of argv before drive-one's parser sees it.
// Consuming `<flag> <value>` matches drive-one's own rule exactly: a value
// beginning with `--` is a missing value there too, so a token equal to
// `flag` can only ever be a flag position.
const takeFlag = (argv, flag) => {
  const rest = []
  let value
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] !== flag) {
      rest.push(argv[i])
      continue
    }
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) {
      throw new Error(`race: ${flag} needs a value\n${usage()}`)
    }
    value = next
    i += 1
  }
  return { value, rest }
}

// The four dials that make K attempts independent. Ports are base+0/+1/+2 (one
// orchestrator each), db-dirs are `<base>-a/-b/-c` (one store each), and each
// repo-dir is a clone named by the globally-unique runId, so two races sharing
// a db-dir base still never share a checkout.
export const planRuns = ({ raceId, k, port, dbDir }) => {
  if (!Number.isInteger(k) || k < 1 || k > SUFFIXES.length) {
    throw new Error(`race: --k must be a whole number in 1..${SUFFIXES.length} (got ${JSON.stringify(k)})`)
  }
  const cloneRoot = `${dbDir}-repos`
  return SUFFIXES.slice(0, k).map((suffix, i) => {
    const runId = `${raceId}-${suffix}`
    if (runId === raceId) {
      // Unreachable while every suffix is non-empty — pinned because an
      // attempt that reused the raceId would collide with the manifest's own
      // identity and, being a runId, could never be retried (#211).
      throw new Error(`race: attempt ${i} took its own raceId ${raceId} as a runId`)
    }
    return { runId, port: port + i, dbDir: `${dbDir}-${suffix}`, repoDir: path.join(cloneRoot, runId) }
  })
}

const defaultGit = (argv, cwd) =>
  execFileSync('git', argv, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

// One attempt's checkout: a fresh clone of the launch checkout, detached at the
// recorded base commit. `--local` hardlinks objects (cheap) while leaving refs
// and HEAD independent; `--no-checkout` means the only tree ever written is the
// detached one. An existing dest is refused, never reused and never removed:
// a half-driven checkout is evidence, and the race does not own it.
export const cloneAtCommit = ({ repo, dest, base, git = defaultGit }) => {
  if (fs.existsSync(dest)) {
    throw new Error(`race: ${dest} already exists — every attempt gets a fresh clone`)
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  git(['clone', '--quiet', '--no-checkout', '--local', repo, dest])
  git(['checkout', '--quiet', '--detach', base], dest)
  const head = String(git(['rev-parse', 'HEAD'], dest)).trim()
  if (head !== base) {
    // Loudly, rather than let an attempt run against a tree that is not the
    // one every sibling is racing (the #314 condition).
    throw new Error(`race: ${dest} is at ${head}, not the recorded base ${base}`)
  }
  return dest
}

const writeManifest = (evidenceDir, manifest) => {
  const manifestPath = raceManifestPath(evidenceDir, manifest.raceId)
  fs.mkdirSync(evidenceDir, { recursive: true })
  // `wx`: the write itself refuses an existing manifest, so a re-launch can
  // never overwrite a pre-registration — not even one racing this process.
  try {
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' })
  } catch (error) {
    if (error?.code === 'EEXIST') throw new Error(`race: ${manifestPath} already exists — a raceId is launched once`)
    throw error
  }
  return manifestPath
}

/**
 * Launch one race: K concurrent drives of one committed plan.
 *
 * @param {string[]} argv - `<plan.md> <raceId> [--k N] [<drive-one flags>]`
 * @param {object} deps - `drive` (default driveOne), `git` (argv, cwd) => stdout,
 *   `narrate` (per-drive progress lines, default stderr), `now` (the launch
 *   stamp), plus drive-one's own `readToken`/`exec` seam.
 * @returns {Promise<{manifest: object, results: any[], manifestPath: string}>}
 *   `manifestPath` is additive to the #511 contract: it is where the manifest
 *   the caller is holding was written, so the CLI can print it without
 *   re-parsing argv for the evidence dir.
 */
export const launchRace = async (argv, {
  drive = driveOne,
  git = defaultGit,
  narrate = (line) => console.error(line),
  now = () => new Date().toISOString(),
  ...deps
} = {}) => {
  const { value: rawK, rest } = takeFlag(argv, '--k')
  const k = rawK === undefined ? DEFAULT_K : Number(rawK)
  // drive-one owns the rest of the vocabulary — including the #211 rule, which
  // the raceId must satisfy because every runId is built out of it.
  const parsed = parseArgs(rest)
  const raceId = parsed.runId
  const runs = planRuns({ raceId, k, port: parsed.port, dbDir: parsed.dbDir })

  // Fail before making K clones if this raceId was already registered; the
  // write below is what actually forecloses the overwrite.
  const manifestPath = raceManifestPath(parsed.evidenceDir, raceId)
  if (fs.existsSync(manifestPath)) {
    throw new Error(`race: ${manifestPath} already exists — a raceId is launched once`)
  }

  const baseCommit = String(git(['rev-parse', 'HEAD'], parsed.repoDir)).trim()
  if (!baseCommit) throw new Error(`race: could not read HEAD of the launch checkout ${parsed.repoDir}`)
  for (const run of runs) cloneAtCommit({ repo: parsed.repoDir, dest: run.repoDir, base: baseCommit, git })

  const manifest = {
    raceId,
    planPath: parsed.planPath,
    baseCommit,
    k,
    launchedAt: now(),
    runs,
    // A copy: the manifest is the race's record, and the module constant is
    // not the place a race writes anything.
    dials: JSON.parse(JSON.stringify(DIALS)),
  }
  const written = writeManifest(parsed.evidenceDir, manifest)

  // Every option object is built before the first await, so all K drives are
  // in flight together — Promise.all is the whole scheduler, and a drive that
  // throws (a dirty plan, a refused preflight) fails the race fast.
  const results = await Promise.all(runs.map((run) => drive({
    ...buildDriveOptions({ ...parsed, ...run }, deps),
    progressLog: (line) => narrate(`[race ${run.runId}] ${line}`),
  })))
  return { manifest, results, manifestPath: written }
}

export const main = async (argv = process.argv.slice(2), { log = console.log, ...deps } = {}) => {
  const [verb, ...rest] = argv
  if (verb !== 'launch') {
    throw new Error(`race: ${verb ? `unknown verb ${verb}` : 'missing verb'}\n${usage()}`)
  }
  const { manifest, results, manifestPath } = await launchRace(rest, deps)
  log(`race ${manifest.raceId}: ${manifest.k} attempts of ${manifest.planPath} at ${manifest.baseCommit}`)
  log(`manifest: ${manifestPath}`)
  for (const run of manifest.runs) {
    log(`  ${run.runId}  port ${run.port}  db ${run.dbDir}  repo ${run.repoDir}`)
  }
  return { manifest, results, manifestPath }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error?.message ?? error)
    process.exit(1)
  })
}
