#!/usr/bin/env node
// fleet/race.mjs — #511 attempt racing v1: one committed plan, K whole runs.
//
//   node fleet/race.mjs launch <plan.md> <raceId> [--k N] [--race-dir DIR] [drive-one flags]
//   node fleet/race.mjs judge  <raceId> [--force] [--evidence-dir DIR]
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
import { execFile, spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { driveOne } from './drive.mjs'
import { DEFAULTS, buildDriveOptions, parseArgs } from './drive-one.mjs'
import { runEvents } from './status.mjs'

// K = 3 for the first race (#511 operator decision); the suffix alphabet is
// the only ceiling on K.
export const DEFAULT_K = 3
const SUFFIXES = 'abcdefghijklmnopqrstuvwxyz'
export const MAX_K = SUFFIXES.length

// The measurement block, copied verbatim into every manifest at launch — the
// spec's §Measurement list, written down before any result is visible so the
// dials cannot be chosen to fit what came back.
export const DIALS = Object.freeze({
  // Tokens are OUTPUT tokens per distinct assistant message (the reader was
  // fixed at 1f17c57 — it had counted every streamed content block, ~2.4x high;
  // the pre-fix figures were run-44 728k, run-45 588k, run-47 583k). Wall is
  // the drive's elapsedMs. run-47 is the single-attempt control for the first
  // race: the same #511 plan, one attempt, before the reviewer pair went
  // concurrent — so its wall is an upper bound for a K=1 arm, not a like-for-like.
  baseline: Object.freeze({
    'run-44': Object.freeze({ wallMinutes: 79, tokens: 287_692, fixRounds: 0 }),
    'run-45': Object.freeze({ wallMinutes: 62, tokens: 232_635, fixRounds: 1, planTracedDefects: 2 }),
    'run-47': Object.freeze({ wallMinutes: 79, tokens: 239_564, fixRounds: 1, planTracedDefects: 1 }),
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
  'usage: node fleet/race.mjs launch <plan.md> <raceId> [--k N] [--race-dir DIR] [drive-one flags]\n' +
  '       node fleet/race.mjs judge <raceId> [--force] [--evidence-dir DIR]'

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

// ===========================================================================
// judge — the mechanical comparator
// ===========================================================================
//
// Read-only over artifacts the K drives already wrote; it never calls `gh`,
// never merges and never closes. Its one write is the verdict appended to the
// manifest. Adoption stays the operator's, driven by the printout.
//
// TERMINAL means the run's `gate-read-<runId>.json` exists: green, parked and
// failed drives all write it unconditionally, so its absence means no record
// will ever appear for that run (spec review finding 7). `--force` is the
// crashed-launch escape.

// The ordered rubric, named. Which stage decided is a pre-registered dial —
// the verdict says it out loud precisely so a race with zero ties is not
// misread as evidence the rubric is good (§Measurement, n=1 honesty).
export const STAGES = Object.freeze({
  filter: 'stage 1 — drive status gate-green filter',
  fixRounds: 'stage 2 — fewest fix rounds',
  tokens: 'stage 3 — fewest tokens',
  tieBreak: 'stage 4 — lexicographic runId',
  failed: 'no run reached gate-green — race FAILED',
})

export const gateReadPath = (evidenceDir, runId) => path.join(evidenceDir, `gate-read-${runId}.json`)
export const gateDetailPath = (evidenceDir, runId) => path.join(evidenceDir, `gate-read-${runId}.detail.json`)

const readJsonIfPresent = (file) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null)

// The sqlite hop is a seam for the same reason status.mjs makes it one: the
// suite has no store to open. Same table, same query.
export const sqliteStoreJson = (dbPath) => {
  const proc = spawnSync('sqlite3', [dbPath, 'SELECT store FROM tinybase LIMIT 1'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  if (proc.status !== 0) {
    throw new Error(`race: cannot read store at ${dbPath}: ${(proc.stderr || `sqlite3 exit ${proc.status}`).trim()}`)
  }
  return JSON.parse(proc.stdout)
}

// The engine labels every fix-round implementer `fix:<taskId>:<iter>`, and
// nothing else in the event stream carries that prefix. Counting labelled
// events rather than distinct rounds is deliberate: the measure is comparative
// and every run emits the same events per round, so the order it induces IS
// the fix-round order.
export const FIX_LABEL_PREFIX = 'fix:'
export const countFixRounds = (storeJson, runId) =>
  runEvents(storeJson, runId).filter((row) => String(row.label ?? '').startsWith(FIX_LABEL_PREFIX)).length

export const parseJudgeArgs = (argv) => {
  const positional = []
  let force = false
  let evidenceDir = DEFAULTS.evidenceDir
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--force') {
      force = true
      continue
    }
    if (arg === '--evidence-dir') {
      const value = argv[i + 1]
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`race: judge: --evidence-dir needs a value\n${usage()}`)
      }
      evidenceDir = value
      i += 1
      continue
    }
    if (arg.startsWith('--')) throw new Error(`race: judge: unknown flag ${arg}\n${usage()}`)
    positional.push(arg)
  }
  const [raceId, ...extra] = positional
  if (!raceId || extra.length) throw new Error(`race: judge expects exactly <raceId>\n${usage()}`)
  return { raceId, force, evidenceDir }
}

const noRecordEntry = (runId) => ({
  runId,
  status: 'no-record',
  fixRounds: null,
  tokens: null,
  tokenSource: null,
  elapsedMs: null,
  pr: null,
  outcome: 'loser',
})

// A missing number sorts as the worst, never the best: an unmeasurable
// contestant must not win a stage by being unmeasurable.
const worstIfNull = (n) => (typeof n === 'number' ? n : Infinity)

export const scorecardLine = (entry) =>
  `${entry.runId}: ${entry.outcome} status=${entry.status} fix-rounds=${entry.fixRounds ?? 'n/a'} ` +
  `tokens=${entry.tokens ?? 'n/a'} (${entry.tokenSource ?? 'n/a'}) ` +
  `pr=${entry.pr ? `#${entry.pr.number} ${entry.pr.branch}` : '(none)'}`

// APPENDED, never rewritten: the manifest round-trips through JSON in the same
// two-space form it was written in and gains exactly one key, so the
// pre-registered `dials` block comes back out byte-identical.
const appendVerdict = (evidenceDir, raceId, manifest, verdict) => {
  manifest.verdict = verdict
  fs.writeFileSync(raceManifestPath(evidenceDir, raceId), `${JSON.stringify(manifest, null, 2)}\n`)
  return verdict
}

export const judgeRace = (argv, { readStoreJson = sqliteStoreJson } = {}) => {
  const { raceId, force, evidenceDir } = parseJudgeArgs(argv)
  const manifest = readRaceManifest(evidenceDir, raceId)

  const contestants = manifest.runs.map((run) => ({
    run,
    read: readJsonIfPresent(gateReadPath(evidenceDir, run.runId)),
    detail: readJsonIfPresent(gateDetailPath(evidenceDir, run.runId)) ?? {},
  }))
  const absent = contestants.filter((c) => c.read === null)
  const reporters = contestants.filter((c) => c.read !== null)

  if (absent.length > 0 && !force) {
    throw new Error(
      `race: judge ${raceId} refuses — not terminal: ` +
        absent.map((c) => `${c.run.runId} (no ${gateReadPath(evidenceDir, c.run.runId)})`).join(', ') +
        '\nwait for the gate read, or pass --force to score the runs that reported and mark the rest no-record',
    )
  }

  // Like with like (rubric stage 3): the ledger is the meter, but one null
  // ledger among the reporters would compare a real number against nothing, so
  // the WHOLE field falls back to `reported` and every entry says which meter
  // it used. Absentees sit outside this — they have no gate read at all.
  const tokenSource = reporters.every((c) => typeof c.read?.spendObservational?.ledger === 'number')
    ? 'ledger'
    : 'reported'

  const scorecard = {}
  for (const { run, read, detail } of contestants) {
    if (read === null) {
      scorecard[run.runId] = noRecordEntry(run.runId)
      continue
    }
    const tokens = read?.spendObservational?.[tokenSource]
    scorecard[run.runId] = {
      runId: run.runId,
      status: detail.status ?? 'unknown',
      fixRounds: countFixRounds(readStoreJson(path.join(run.dbDir, 'fleet.db')), run.runId),
      tokens: typeof tokens === 'number' ? tokens : null,
      tokenSource,
      elapsedMs: typeof detail.elapsedMs === 'number' ? detail.elapsedMs : null,
      pr: detail.pullRequest ?? null,
      outcome: 'loser',
    }
  }

  const entries = Object.values(scorecard)
  // Stage 1 is a hard cut, not a sort. It already subsumes "gate PASS and no
  // blocking critic finding": a blocking critic decision refuses approval
  // before the shim can green the run (spec review findings 1 and 15).
  let pool = entries.filter((entry) => entry.status === 'gate-green')
  if (pool.length === 0) {
    // Merge nothing. Evidence still harvests; the operator closes the K PRs.
    return appendVerdict(evidenceDir, raceId, manifest, { winner: null, decidingStage: STAGES.failed, scorecard })
  }

  // The deciding stage is the first one that narrows the field to one — the
  // later stages are never even consulted once it has.
  let decidingStage = pool.length === 1 ? STAGES.filter : null
  for (const [stage, measure] of [
    [STAGES.fixRounds, (entry) => worstIfNull(entry.fixRounds)],
    [STAGES.tokens, (entry) => worstIfNull(entry.tokens)],
  ]) {
    if (decidingStage) break
    const best = Math.min(...pool.map(measure))
    pool = pool.filter((entry) => measure(entry) === best)
    if (pool.length === 1) decidingStage = stage
  }
  if (!decidingStage) {
    pool = [pool.slice().sort((a, b) => a.runId.localeCompare(b.runId))[0]]
    decidingStage = STAGES.tieBreak
  }

  pool[0].outcome = 'winner'
  return appendVerdict(evidenceDir, raceId, manifest, { winner: pool[0].runId, decidingStage, scorecard })
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
  if (verb === 'judge') {
    const { raceId, evidenceDir } = parseJudgeArgs(rest)
    const verdict = judgeRace(rest, deps)
    const entries = Object.values(verdict.scorecard)
    if (verdict.winner) {
      log(`race ${raceId}: winner ${verdict.winner} \u2014 decided by ${verdict.decidingStage}`)
    } else {
      log(`race ${raceId}: ${verdict.decidingStage}; merge nothing`)
    }
    for (const entry of entries) log(scorecardLine(entry))
    if (!verdict.winner) {
      // The judge never calls `gh`: this printout IS the adoption instruction.
      log(
        'close these PRs by hand: ' +
          entries.map((e) => (e.pr ? `${e.runId} #${e.pr.number} ${e.pr.branch}` : `${e.runId} (no PR)`)).join(', '),
      )
    }
    log(`verdict appended to ${raceManifestPath(evidenceDir, raceId)}`)
    return { manifest: readRaceManifest(evidenceDir, raceId), verdict }
  }
  throw new Error(`race: unknown verb ${verb ?? '(none given)'}\n${usage()}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error?.message ?? error)
    process.exit(1)
  })
}
