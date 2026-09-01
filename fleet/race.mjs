#!/usr/bin/env node
// fleet/race.mjs — #511 attempt racing v1: the launch and judge verbs.
//
//   node fleet/race.mjs launch <plan.md> <raceId> [--k N] [drive-one flags]
//   node fleet/race.mjs judge <raceId> [--force] [--evidence-dir DIR]
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
import { execFile, spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { driveOne } from './drive.mjs'
import { DEFAULTS, buildDriveOptions, parseArgs } from './drive-one.mjs'
import { runEvents } from './status.mjs'

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
  'usage: node fleet/race.mjs launch <plan.md> <raceId> [--k N] [drive-one flags]\n' +
  '       node fleet/race.mjs judge <raceId> [--force] [--evidence-dir DIR]'

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

// ---------------------------------------------------------------------------
// The judge verb. Read-only over artifacts every drive already wrote; its one
// write is the verdict appended to the manifest. It never calls `gh`, never
// merges and never closes: adoption is the operator's, driven by the printout.

// A run is TERMINAL when its gate read exists — drive.mjs writes that file
// unconditionally, so green, parked and failed runs all have one. A missing
// file means the drive never finished writing it, not that the run lost.
export const gateReadPath = (evidenceDir, runId) => path.join(evidenceDir, `gate-read-${runId}.json`)
export const gateDetailPath = (evidenceDir, runId) => path.join(evidenceDir, `gate-read-${runId}.detail.json`)

// The engine labels its fix workers `fix:<taskId>:<iter>` (run-engine.mjs:678),
// one label per dispatched fix round. A round is a LABEL, not an event: the
// worker seam emits `worker:start` and `worker:end` under the same label
// (run-worker.mjs:581,596) and `worker:refused` under it with no end
// (run-worker.mjs:542,547), and the events bridge promotes every one of them
// with its `label` cell intact (events-bridge.mjs). Counting events would read
// ~2x the rounds and — because a sandbox that dies after `worker:start` leaves
// an unpaired event — not even a uniform 2x across runs, so the pre-registered
// `fixRounds` dial (DIALS.baseline, above) would be compared against a number
// in different units. Distinct labels is the count that survives both.
export const FIX_LABEL_PREFIX = 'fix:'

// What `--force` records for a run that never reported: an automatic loss,
// distinguishable in the scorecard from a drive that ran and failed.
export const NO_RECORD = 'no-record'

// The rubric, in order. These strings ARE the output: the scorecard names the
// stage that decided precisely so a decisive rubric is never re-read as rubric
// quality — at n=1 "zero ties" says nothing (spec §Measurement).
export const STAGES = Object.freeze({
  driveStatus: 'drive status: only `gate-green` runs contend',
  fixRounds: 'fix rounds: fewest distinct `fix:` worker labels',
  tokens: 'tokens: fewest spendObservational tokens',
  lexicographic: 'tie-break: lexicographic-least runId',
  noGreen: 'FAILED: no run reached `gate-green`',
})

export const judgeUsage = () =>
  'usage: node fleet/race.mjs judge <raceId> [--force] [--evidence-dir DIR]'

// `--evidence-dir` is spelled as drive-one spells it, and defaults to the same
// place, so the judge reads the dir the drives wrote into without being told.
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
        throw new Error(`race: --evidence-dir needs a value\n${judgeUsage()}`)
      }
      evidenceDir = value
      i += 1
      continue
    }
    if (arg.startsWith('--')) throw new Error(`race: unknown judge flag ${arg}\n${judgeUsage()}`)
    positional.push(arg)
  }
  const [raceId, ...extra] = positional
  if (!raceId || extra.length) throw new Error(`race: judge expects exactly <raceId>\n${judgeUsage()}`)
  return { raceId, force, evidenceDir }
}

// The store seam, mirroring status.mjs's own sqlite read so tests judge fixture
// stores with no sqlite3 and no db on disk.
export const storeReader = (dbDir) => {
  const dbPath = path.join(dbDir, 'fleet.db')
  const proc = spawnSync('sqlite3', [dbPath, 'SELECT store FROM tinybase LIMIT 1'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (proc.status !== 0) {
    throw new Error(`race: cannot read store at ${dbPath}: ${(proc.stderr || `sqlite3 exit ${proc.status}`).trim()}`)
  }
  return JSON.parse(proc.stdout)
}

export const countFixRounds = (storeJson, runId) =>
  new Set(
    runEvents(storeJson, runId)
      .map((row) => String(row?.label ?? ''))
      .filter((label) => label.startsWith(FIX_LABEL_PREFIX)),
  ).size

const readJsonFile = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    throw new Error(`race: cannot read ${file}: ${error?.message ?? error}`)
  }
}

const numberOrNull = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null)

// One row per manifest run: what the two gate-read files and the run's own
// store say. Nothing is compared here — scoring is the rubric's job below.
const scoreRun = (run, { evidenceDir, readStore }) => {
  const notes = []
  const readFile = gateReadPath(evidenceDir, run.runId)
  if (!fs.existsSync(readFile)) {
    notes.push('no gate read — --force scored this run an automatic loss')
    return {
      run,
      reported: false,
      driveStatus: NO_RECORD,
      fixRounds: null,
      spend: {},
      elapsedMs: null,
      pullRequest: null,
      notes,
    }
  }
  const read = readJsonFile(readFile)
  const detailFile = gateDetailPath(evidenceDir, run.runId)
  let detail = null
  if (fs.existsSync(detailFile)) detail = readJsonFile(detailFile)
  else notes.push(`no detail beside ${path.basename(readFile)} — drive status unknown`)

  let fixRounds = null
  try {
    fixRounds = countFixRounds(readStore(run.dbDir), run.runId)
  } catch (error) {
    notes.push(`store unreadable (${error?.message ?? error}) — fix rounds unknown`)
  }
  return {
    run,
    reported: true,
    driveStatus: typeof detail?.status === 'string' ? detail.status : 'unknown',
    fixRounds,
    spend: read?.spendObservational ?? {},
    elapsedMs: numberOrNull(detail?.elapsedMs),
    pullRequest: detail?.pullRequest ?? null,
    notes,
  }
}

// Compare like with like (spec rubric 3): the contestants are the runs that
// can still win — the gate-green ones — so if any of THEIR ledgers is null,
// every run on the card is priced in `reported` instead, flagged. With no
// green at all there is no winner to price, so the whole reporting field sets
// the source and the card stays internally comparable.
const tokenSourceFor = (contenders, scored) => {
  const basis = contenders.length > 0 ? contenders : scored
  return basis.some((row) => numberOrNull(row.spend?.ledger) === null) ? 'reported' : 'ledger'
}

const fewest = (rows, value) => {
  const best = Math.min(...rows.map((row) => value(row) ?? Infinity))
  return rows.filter((row) => (value(row) ?? Infinity) === best)
}

const prLabel = (entry) =>
  entry.pullRequest
    ? `PR #${entry.pullRequest.number} ${entry.pullRequest.url} (${entry.pullRequest.branch})`
    : 'no PR opened'

const scorecardLine = (runId, entry) =>
  `  ${runId}  ${entry.driveStatus}  fix ${entry.fixRounds ?? 'n/a'}  ` +
  `tokens ${entry.tokens ?? 'n/a'} (${entry.tokenSource})  ${prLabel(entry)}`

export const judgeRace = async (argv, deps = {}) => {
  const { readStore = storeReader, print = (line) => console.log(line) } = deps
  const { raceId, force, evidenceDir } = parseJudgeArgs(argv)
  const manifest = readRaceManifest(evidenceDir, raceId)

  const missing = manifest.runs
    .filter((run) => !fs.existsSync(gateReadPath(evidenceDir, run.runId)))
    .map((run) => run.runId)
  if (missing.length > 0 && !force) {
    throw new Error(
      `race: ${raceId} is not judgeable — no gate read for ${missing.join(', ')} ` +
      `(${missing.map((runId) => path.basename(gateReadPath(evidenceDir, runId))).join(', ')} absent). ` +
      'Every drive writes one when it ends, green or not: judge again once they land, or pass --force to ' +
      'score the runs that reported and mark the rest an automatic loss.')
  }

  const rows = manifest.runs.map((run) => scoreRun(run, { evidenceDir, readStore }))
  const contenders = rows.filter((row) => row.driveStatus === 'gate-green')
  const tokenSource = tokenSourceFor(contenders, rows.filter((row) => row.reported))
  const tokenFallback = tokenSource === 'reported'
  for (const row of rows) row.tokens = numberOrNull(row.spend?.[tokenSource])

  // The ordered rubric. A stage is named as the decider only when it actually
  // narrowed the field; the filter is the floor, since nothing but a green run
  // can win at all.
  let decidingStage = STAGES.driveStatus
  let winner = null
  let pool = contenders
  if (pool.length === 0) {
    decidingStage = STAGES.noGreen
  } else {
    for (const [stage, value] of [[STAGES.fixRounds, (r) => r.fixRounds], [STAGES.tokens, (r) => r.tokens]]) {
      if (pool.length === 1) break
      const next = fewest(pool, value)
      if (next.length < pool.length) {
        pool = next
        decidingStage = stage
      }
    }
    if (pool.length > 1) {
      pool = [[...pool].sort((a, b) => (a.run.runId < b.run.runId ? -1 : 1))[0]]
      decidingStage = STAGES.lexicographic
    }
    winner = pool[0].run.runId
  }

  const scorecard = {}
  for (const row of rows) {
    scorecard[row.run.runId] = {
      driveStatus: row.driveStatus,
      fixRounds: row.fixRounds,
      tokens: row.tokens,
      tokenSource,
      tokenFallback,
      elapsedMs: row.elapsedMs,
      pullRequest: row.pullRequest,
      winner: row.run.runId === winner,
      notes: row.notes,
    }
  }

  const verdict = { winner, decidingStage, scorecard }
  // The only write. `dials` round-trips untouched — same parse, same indent,
  // same key order — so the pre-registered block survives byte for byte.
  fs.writeFileSync(raceManifestPath(evidenceDir, raceId), `${JSON.stringify({ ...manifest, verdict }, null, 2)}\n`)

  print(winner ? `race ${raceId}: winner ${winner}` : `race ${raceId}: FAILED — no winner`)
  print(`decided by: ${decidingStage}`)
  for (const [runId, entry] of Object.entries(scorecard)) print(scorecardLine(runId, entry))
  if (tokenFallback) {
    print('note: a contestant\'s spendObservational.ledger was null — every run is priced on `reported`')
  }
  for (const [runId, entry] of Object.entries(scorecard)) {
    for (const note of entry.notes) print(`note: ${runId}: ${note}`)
  }
  if (winner) {
    print(`adopt: merge ${winner}'s ${prLabel(scorecard[winner])}, then close the other ` +
      `${manifest.runs.length - 1} PR(s) with a comment naming race ${raceId} and the winner`)
  } else {
    print(`nothing merges: close all ${manifest.runs.length} PRs above and harvest the evidence`)
  }
  return verdict
}

export const main = async (argv = process.argv.slice(2), deps = {}) => {
  const [verb, ...rest] = argv
  if (verb === 'launch') return launchRace(rest, deps)
  if (verb === 'judge') return judgeRace(rest, deps)
  throw new Error(`race: unknown verb ${verb ?? '(none)'}\n${usage()}`)
}

// The process entry, exported so the exit code is a tested value rather than a
// spawned subprocess: a refusal prints to stderr and exits non-zero.
export const cli = async (argv = process.argv.slice(2), deps = {}) => {
  const printErr = deps.printErr ?? ((line) => console.error(line))
  try {
    await main(argv, deps)
    return 0
  } catch (error) {
    printErr(String(error?.message ?? error))
    return 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  cli().then((code) => {
    if (code !== 0) process.exit(code)
  })
}
