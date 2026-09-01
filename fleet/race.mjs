#!/usr/bin/env node
// fleet/race.mjs — #511 attempt racing v1: the launch verb.
//
//   node fleet/race.mjs launch <plan.md> <raceId> [--k N] [drive-one flags]
//
// The same committed plan, driven K times concurrently, one process per race
// (no daemon — each drive still starts and stops its own orchestrator). This
// is the #454 launch shape committed once: K run identities allocated off the
// raceId, K clones of the launch checkout at one recorded base commit, and a
// raceId-qualified manifest written BEFORE any drive starts so the
// pre-registered dials cannot be chosen after the results are visible.
//
// Racing is composition, not modification: no engine file changes, and the
// option objects are built by drive-one's own `parseArgs`/`buildDriveOptions`
// — the token read, TTL, heartbeat and publish constants live behind that one
// seam and are never re-typed here.
import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { driveOne } from './drive.mjs'
import { buildDriveOptions, parseArgs } from './drive-one.mjs'

// K = 3 for the first race (operator decision, 2026-09-01 sitting).
export const DEFAULT_K = 3

// Run IDs are `<raceId>-a`, `-b`, `-c`. The alphabet is the ceiling on K: a
// suffix is one letter so the ID stays a readable, sortable token.
export const RUN_SUFFIXES = 'abcdefghijklmnopqrstuvwxyz'

// The pre-registered measurement block (spec §Measurement), copied verbatim
// into every manifest at launch. Written before the drives so a dial cannot
// be chosen once the results are visible; the judge appends its verdict
// beside this block and never rewrites it.
export const DIALS = Object.freeze({
  baseline: Object.freeze({
    'run-44': Object.freeze({ elapsedMinutes: 66, tokens: 728_000, fixRounds: 0 }),
    'run-45': Object.freeze({ elapsedMinutes: 67, tokens: 588_000, fixRounds: 1, planTracedDefects: 2 }),
  }),
  raceWall: 'launchedAt → max(per-run gate-read elapsedMs end)',
  totalTokens: 'summed across the K runs; expect ≈K× a single run',
  perRun: Object.freeze(['driveStatus', 'fixRounds', 'tokens']),
  comparatorDecisiveness: 'name the rubric stage that decided — never read "zero ties" as rubric quality',
  winnerDefectSurface: 'defects traced back to the winner within the next two sittings',
  // n=1: the first race detects catastrophe-or-not. It cannot rank racing
  // against single-run driving.
  honesty: 'n=1 — a smooth first race is not validation',
})

// #323: the evidence dir is shared across runs, so an unqualified `race.json`
// would be clobbered by the next race.
export const raceManifestPath = (evidenceDir, raceId) => path.join(evidenceDir, `race-${raceId}.json`)

export const readRaceManifest = (evidenceDir, raceId) =>
  JSON.parse(fs.readFileSync(raceManifestPath(evidenceDir, raceId), 'utf8'))

export const usage = () =>
  'usage: node fleet/race.mjs launch <plan.md> <raceId> [--k N] [drive-one flags]'

// `--k` is the only flag race.mjs owns; everything else is drive-one's and
// passes through untouched, so its refusals (unknown flag, bad runId, missing
// value) stay the single copy of that contract.
export const parseRaceArgs = (argv) => {
  const driveArgv = []
  let k = DEFAULT_K
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg !== '--k') {
      driveArgv.push(arg)
      continue
    }
    const value = argv[i + 1]
    if (value === undefined || value.startsWith('--')) throw new Error(`race: --k needs a value\n${usage()}`)
    k = Number(value)
    if (!Number.isInteger(k) || k < 1 || k > RUN_SUFFIXES.length) {
      throw new Error(`race: --k must be an integer 1..${RUN_SUFFIXES.length}, got ${value}`)
    }
    i += 1
  }
  return { k, driveArgv }
}

// The K run identities. Distinct on every axis a drive can collide on: the
// runId names the sandbox VM and the store row, the port and db-dir are the
// orchestrator's, and the repo-dir is the checkout the publish leg fetches
// into — sharing one would race the sibling drives' FETCH_HEAD window
// (spec finding 6).
export const allocateRuns = ({ raceId, k, port, dbDir }) =>
  Array.from({ length: k }, (_, i) => {
    const suffix = RUN_SUFFIXES[i]
    return {
      runId: `${raceId}-${suffix}`,
      port: port + i,
      dbDir: `${dbDir}-${suffix}`,
      repoDir: `${dbDir}-${suffix}-repo`,
    }
  })

// The git seam: rev-parse, remote read/write, clone and checkout, injectable so
// the spec runs with no repo and no remote. Mirrors drive-one's shellExec
// contract — the caller reads `code` rather than catching, and stderr travels
// separately.
export const gitRunner = (args, { cwd } = {}) =>
  new Promise((resolve) => {
    execFile('git', args, { cwd, maxBuffer: 1024 * 1024 * 16 }, (error, stdout, stderr) =>
      resolve({ code: error?.code ?? 0, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') }))
  })

const git = async (run, args, opts) => {
  const { code, stdout, stderr } = await run(args, opts)
  if (code !== 0) throw new Error(`race: git ${args.join(' ')} failed (${code}): ${stderr.trim()}`)
  return stdout.trim()
}

// The launch checkout's own `origin` URL, read once and stamped onto every
// clone. `git clone <localpath>` points the clone's `origin` at that path, and
// drive.mjs's publish leg pushes to `origin` and then runs `gh pr create` in
// the same dir on the documented assumption that "`origin` is the orchestrator
// clone's https remote" (fleet/drive.mjs:1379). Left alone, each racing run
// would push its branch ref back into the operator's launch checkout, report
// the push green, and fail `gh pr create` with no GitHub host in sight — K runs
// and no PR to adopt or close. The engine is frozen, so the repoint happens
// here. Cloning still reads the local path (fast, and it holds base commits
// that may not be on the remote yet); only the remote is rewritten.
const originUrl = async (run, repoDir) => {
  const { code, stdout, stderr } = await run(['remote', 'get-url', 'origin'], { cwd: repoDir })
  const url = stdout.trim()
  if (code !== 0 || url === '') {
    throw new Error(
      `race: ${repoDir} has no \`origin\` remote (${stderr.trim() || `code ${code}`}) — ` +
      'each racing clone would inherit the launch checkout as its origin, so every push would land ' +
      'inside it and no PR would open')
  }
  return url
}

// Launch: record the base commit, allocate and clone K checkouts, pre-register
// the manifest, then drive K times concurrently. Plan cleanliness is NOT
// re-verified here — driveOne's own #337 preflight is the single enforcement;
// a race only fails fast when a drive throws it.
export const launchRace = async (argv, deps = {}) => {
  const {
    drive = driveOne,
    git: gitRun = gitRunner,
    now = () => new Date().toISOString(),
    log = (line) => console.error(line),
    ...driveDeps
  } = deps
  const { k, driveArgv } = parseRaceArgs(argv)
  const parsed = parseArgs(driveArgv)
  const raceId = parsed.runId

  const baseCommit = await git(gitRun, ['rev-parse', 'HEAD'], { cwd: parsed.repoDir })
  // Read before the first clone: a checkout with no publishable origin refuses
  // the race outright rather than K runs deep, with nothing written yet.
  const origin = await originUrl(gitRun, parsed.repoDir)
  const runs = allocateRuns({ raceId, k, port: parsed.port, dbDir: parsed.dbDir })
  for (const run of runs) {
    fs.mkdirSync(path.dirname(run.repoDir), { recursive: true })
    await git(gitRun, ['clone', parsed.repoDir, run.repoDir], { cwd: parsed.repoDir })
    await git(gitRun, ['remote', 'set-url', 'origin', origin], { cwd: run.repoDir })
    await git(gitRun, ['checkout', '--detach', baseCommit], { cwd: run.repoDir })
  }

  const manifest = {
    raceId,
    planPath: parsed.planPath,
    baseCommit,
    k,
    launchedAt: now(),
    runs,
    dials: DIALS,
  }
  fs.mkdirSync(parsed.evidenceDir, { recursive: true })
  fs.writeFileSync(raceManifestPath(parsed.evidenceDir, raceId), `${JSON.stringify(manifest, null, 2)}\n`)

  // Every drive is started before the first is awaited: K in flight, one
  // process, no daemon. A rejection fails the race fast.
  const results = await Promise.all(runs.map((run) => drive({
    ...buildDriveOptions({ ...parsed, ...run }, driveDeps),
    // Three interleaved drives share one stderr; the runId prefix is what
    // makes a line attributable (spec finding 11).
    progressLog: (line) => log(`[race ${raceId} ${run.runId}] ${line}`),
  })))

  return { manifest, results }
}

export const main = async (argv = process.argv.slice(2), deps = {}) => {
  const [verb, ...rest] = argv
  if (verb === 'launch') return launchRace(rest, deps)
  throw new Error(`race: unknown verb ${verb ?? '(none)'}\n${usage()}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error?.message ?? error)
    process.exit(1)
  })
}
