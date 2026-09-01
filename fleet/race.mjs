#!/usr/bin/env node
// fleet/race.mjs — attempt racing (#511): run the SAME committed plan as K
// concurrent drives and judge the winner.
//
//   node fleet/race.mjs launch <plan.md> <raceId> [--k 3] [<drive-one flags>]
//   node fleet/race.mjs judge  <raceId> [--force] [--evidence-dir DIR]
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
//
// The judge verb reads the artifacts those drives already wrote — gate-read,
// gate-read detail, and each run's own store — and applies the manifest's
// pre-registered rubric. It is read-only except for the verdict it appends to
// the manifest, and it never calls `gh`: it prints, the operator adopts.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { driveOne } from './drive.mjs'
import { DEFAULTS, buildDriveOptions, parseArgs } from './drive-one.mjs'
import { runEvents } from './status.mjs'

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
  'usage: node fleet/race.mjs launch <plan.md> <raceId> [--k 3] [<drive-one flags>]\n' +
  '       node fleet/race.mjs judge <raceId> [--force] [--evidence-dir DIR]'

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

// --- the judge -------------------------------------------------------------
//
//   node fleet/race.mjs judge <raceId> [--force] [--evidence-dir DIR]
//
// Read-only over the run artifacts, with exactly one write: the verdict
// appended to `race-<raceId>.json`. It never calls `gh`, never merges and
// never closes anything — adoption is the operator's, driven by the printout.

// The rubric stage names. These ARE `DIALS.rubric`, in order: the judge applies
// the measurement the manifest pre-registered, and `decidingStage` reports
// which stage actually narrowed the field to one. Naming the stage is the
// point — a race decided at stage 1 says nothing about stages 2-4, and "no
// ties" must never be read as rubric quality at n=1.
export const STAGES = Object.freeze({
  filter: 'gate-green',
  fixRounds: 'fix-rounds',
  tokens: 'tokens',
  tieBreak: 'runid-lexicographic',
})

// A run that never wrote a gate-read is not terminal. The judge refuses to
// score the race while one exists, unless `--force` names it an automatic
// loss — the crashed-launch escape, for when the single race process died
// mid-drive and no record will ever appear (spec finding 7).
export const NO_RECORD = 'no-record'

export const gateReadPath = (evidenceDir, runId) =>
  path.join(evidenceDir, `gate-read-${runId}.json`)

export const gateDetailPath = (evidenceDir, runId) =>
  path.join(evidenceDir, `gate-read-${runId}.detail.json`)

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))

// The store read, behind the same seam status.mjs uses: one sqlite3 call for
// the serialized MergeableStore, injectable so tests never need a database.
const defaultReadStore = (dbPath) => {
  const proc = spawnSync('sqlite3', [dbPath, 'SELECT store FROM tinybase LIMIT 1'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  if (proc.status !== 0) {
    throw new Error(`race: cannot read the store at ${dbPath}: ${(proc.stderr || `sqlite3 exit ${proc.status}`).trim()}`)
  }
  return JSON.parse(proc.stdout)
}

// Fix rounds: the run's own events whose label carries the engine's `fix:`
// prefix (run-engine.mjs labels a fix worker `fix:<taskId>:<iter>`), counted
// through status.mjs's `runEvents` so the store unwrapping lives in one place.
export const countFixRounds = (storeJson, runId) =>
  runEvents(storeJson, runId).filter((row) => String(row.label ?? '').startsWith('fix:')).length

// One run's row of the scorecard. `spend` carries BOTH readings so the operator
// can see what the comparison was made from; `tokens` is whichever reading the
// race actually compared (the fallback rule lives in judgeRace).
const scoreRun = (run, { evidenceDir, readStore }) => {
  const finite = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  const entry = {
    runId: run.runId,
    status: NO_RECORD,
    fixRounds: null,
    spend: null,
    tokens: null,
    tokenSource: null,
    tokenFallback: false,
    elapsedMs: null,
    pullRequest: null,
    outcome: NO_RECORD,
    notes: [],
  }
  const readPath = gateReadPath(evidenceDir, run.runId)
  if (!fs.existsSync(readPath)) {
    entry.notes.push(`no ${path.basename(readPath)}: this run never reported — an automatic loss under --force`)
    return entry
  }
  entry.outcome = 'loser'
  const spend = readJson(readPath)?.spendObservational ?? {}
  entry.spend = { reported: finite(spend.reported), ledger: finite(spend.ledger) }

  // The drive status and the wall clock live in the detail file, not in the
  // five-key gate read (#20 residuals: new drive facts go in `detail` only).
  const detailFile = gateDetailPath(evidenceDir, run.runId)
  if (fs.existsSync(detailFile)) {
    const detail = readJson(detailFile)
    entry.status = typeof detail.status === 'string' ? detail.status : 'unknown'
    entry.elapsedMs = finite(detail.elapsedMs)
    entry.pullRequest = detail.pullRequest ?? null
  } else {
    entry.status = 'unknown'
    entry.notes.push(`no ${path.basename(detailFile)}: the drive status is unknown, so this run cannot contest`)
  }

  try {
    entry.fixRounds = countFixRounds(readStore(path.join(run.dbDir, 'fleet.db')), run.runId)
  } catch (error) {
    // Null, never zero: an unreadable store is not evidence of a clean run,
    // and null ranks last at the fix-round stage.
    entry.notes.push(`store unreadable: ${error?.message ?? error}`)
  }
  return entry
}

// Least-value survivors. An unknown measurement (null) ranks last rather than
// best, so a metric nobody could read can never win a stage.
const narrow = (ids, valueOf) => {
  const values = ids.map((id) => valueOf(id) ?? Infinity)
  const min = Math.min(...values)
  return ids.filter((_, i) => values[i] === min)
}

// The ordered rubric: each stage decides only the ties the stage above left,
// and the first stage that narrows the field to exactly one run is the stage
// `decidingStage` names.
const applyRubric = (order, scorecard) => {
  let candidates = order.filter((id) => scorecard[id].status === 'gate-green')
  if (candidates.length <= 1) {
    // Zero greens is a FAILED race — merge nothing — and the filter is still
    // the stage that decided it, against every contestant at once.
    return { winner: candidates[0] ?? null, decidingStage: STAGES.filter }
  }
  candidates = narrow(candidates, (id) => scorecard[id].fixRounds)
  if (candidates.length === 1) return { winner: candidates[0], decidingStage: STAGES.fixRounds }
  candidates = narrow(candidates, (id) => scorecard[id].tokens)
  if (candidates.length === 1) return { winner: candidates[0], decidingStage: STAGES.tokens }
  return { winner: [...candidates].sort()[0], decidingStage: STAGES.tieBreak }
}

// The manifest's one write, and an APPEND in the literal sense: the bytes
// launch wrote — the pre-registered `dials` above all — are left exactly as
// they were and the verdict is spliced in as the last key. A re-judge replaces
// the previous verdict and nothing else.
const appendVerdict = (evidenceDir, raceId, verdict) => {
  const manifestPath = raceManifestPath(evidenceDir, raceId)
  const text = fs.readFileSync(manifestPath, 'utf8')
  const parsed = JSON.parse(text)
  let next
  if (parsed.verdict === undefined) {
    const kept = text.slice(0, text.lastIndexOf('}')).trimEnd()
    next = `${kept},\n  "verdict": ${JSON.stringify(verdict, null, 2).split('\n').join('\n  ')}\n}\n`
  } else {
    const { verdict: _previous, ...rest } = parsed
    next = `${JSON.stringify({ ...rest, verdict }, null, 2)}\n`
  }
  // The re-parse is the splice's own check; the dials comparison is the
  // pre-registration's. This file is the race's only record of both.
  if (JSON.stringify(JSON.parse(next).dials) !== JSON.stringify(parsed.dials)) {
    throw new Error(`race: refusing to write ${manifestPath} — the pre-registered dials would change`)
  }
  fs.writeFileSync(manifestPath, next)
  return manifestPath
}

// The judge's own vocabulary — deliberately not drive-one's `parseArgs`, which
// demands a plan path and a runId the judge has no use for. The evidence dir is
// the one thing it must be told (or take from drive-one's default): that is
// where the manifest and every gate-read live.
const parseJudgeArgs = (argv) => {
  const opts = { force: false, evidenceDir: DEFAULTS.evidenceDir }
  const positional = []
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--force') {
      opts.force = true
      continue
    }
    if (arg === '--evidence-dir') {
      const value = argv[i + 1]
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`race: --evidence-dir needs a value\n${usage()}`)
      }
      opts.evidenceDir = value
      i += 1
      continue
    }
    if (arg.startsWith('--')) throw new Error(`race: unknown flag ${arg}\n${usage()}`)
    positional.push(arg)
  }
  const [raceId, ...extra] = positional
  if (!raceId || extra.length > 0) throw new Error(`race: judge expects exactly <raceId>\n${usage()}`)
  return { raceId, ...opts }
}

/**
 * Judge one race: score every attempt against the pre-registered rubric, name
 * the winner and the stage that decided it, and append the verdict.
 *
 * @param {string[]} argv - `<raceId> [--force] [--evidence-dir DIR]`
 * @param {object} deps - `readStore` (dbPath) => the run store's JSON.
 * @returns {{winner: string|null, decidingStage: string, scorecard: object,
 *   raceId: string, manifestPath: string}} `winner` is null exactly when the
 *   race FAILED (zero greens). `raceId`/`manifestPath` are additive to the
 *   #511 contract, for the CLI's printout; what lands in the manifest is
 *   exactly `{winner, decidingStage, scorecard}`.
 */
export const judgeRace = (argv, { readStore = defaultReadStore } = {}) => {
  const { raceId, force, evidenceDir } = parseJudgeArgs(argv)
  const manifest = readRaceManifest(evidenceDir, raceId)
  const runs = Array.isArray(manifest.runs) ? manifest.runs : []
  if (runs.length === 0) throw new Error(`race: ${raceManifestPath(evidenceDir, raceId)} records no runs`)

  // Terminal means the gate-read file exists — green, parked and failed drives
  // all write one. Anything else is a drive still in flight, and judging it
  // would be judging a race that is not over.
  const missing = runs.filter((run) => !fs.existsSync(gateReadPath(evidenceDir, run.runId)))
  if (missing.length > 0 && !force) {
    throw new Error(
      `race: ${raceId} is not terminal — no gate-read for ${missing.map((r) => r.runId).join(', ')} ` +
      `(expected ${gateReadPath(evidenceDir, missing[0].runId)}); wait for the drive to report, ` +
      `or --force to score the rest and mark these ${NO_RECORD}`,
    )
  }

  // Lexicographic runId order throughout: it is the rubric's final tie-break,
  // so it is also the order the scorecard is keyed and printed in.
  const order = runs.map((run) => run.runId).sort()
  const byId = new Map(runs.map((run) => [run.runId, run]))
  const scorecard = {}
  for (const id of order) scorecard[id] = scoreRun(byId.get(id), { evidenceDir, readStore })

  // Compare like with like: tokens are `spendObservational.ledger`, but one
  // null ledger among the runs that REPORTED makes a ledger comparison
  // unsound, so every scored run falls back to `reported` and every scorecard
  // entry says which reading it is holding.
  const reporting = order.filter((id) => scorecard[id].spend !== null)
  const tokenSource = reporting.some((id) => scorecard[id].spend.ledger === null) ? 'reported' : 'ledger'
  for (const id of reporting) {
    scorecard[id].tokenSource = tokenSource
    scorecard[id].tokenFallback = tokenSource === 'reported'
    scorecard[id].tokens = scorecard[id].spend[tokenSource]
  }

  const { winner, decidingStage } = applyRubric(order, scorecard)
  if (winner) scorecard[winner].outcome = 'winner'
  const verdict = { winner, decidingStage, scorecard }
  return { ...verdict, raceId, manifestPath: appendVerdict(evidenceDir, raceId, verdict) }
}

// One greppable line per contestant: who it is, what its drive did, and every
// ranked metric in rubric order.
export const scorecardLine = (entry) => [
  ` ${entry.outcome === 'winner' ? '*' : ' '}${entry.runId}`,
  entry.status,
  `fix ${entry.fixRounds ?? 'n/a'}`,
  `tokens ${entry.tokens ?? 'n/a'}${entry.tokenSource ? ` (${entry.tokenSource}${entry.tokenFallback ? ', ledger fallback' : ''})` : ''}`,
  `elapsed ${entry.elapsedMs ?? 'n/a'}ms`,
  entry.pullRequest?.branch ?? 'no PR recorded',
].join('  ')

// --- the CLI ---------------------------------------------------------------

export const main = async (argv = process.argv.slice(2), { log = console.log, ...deps } = {}) => {
  const [verb, ...rest] = argv
  if (verb === 'launch') {
    const { manifest, results, manifestPath } = await launchRace(rest, deps)
    log(`race ${manifest.raceId}: ${manifest.k} attempts of ${manifest.planPath} at ${manifest.baseCommit}`)
    log(`manifest: ${manifestPath}`)
    for (const run of manifest.runs) {
      log(`  ${run.runId}  port ${run.port}  db ${run.dbDir}  repo ${run.repoDir}`)
    }
    return { manifest, results, manifestPath }
  }
  if (verb === 'judge') {
    const verdict = judgeRace(rest, deps)
    const { raceId, winner, decidingStage, scorecard, manifestPath } = verdict
    log(winner
      ? `race ${raceId}: winner ${winner} — decided by ${decidingStage}`
      : `race ${raceId}: FAILED — no attempt reached gate-green; merge nothing (decided by ${decidingStage})`)
    for (const id of Object.keys(scorecard)) log(scorecardLine(scorecard[id]))
    if (!winner) {
      // The judge never closes a PR. It names the K branches so the operator
      // can, which is the whole adoption path for a failed race.
      log('close these PRs — the judge never calls gh:')
      for (const id of Object.keys(scorecard)) {
        const pr = scorecard[id].pullRequest
        log(`  ${id}  ${pr?.branch ?? 'no PR recorded'}${pr?.url ? `  ${pr.url}` : ''}`)
      }
    }
    log(`verdict: ${manifestPath}`)
    return verdict
  }
  throw new Error(`race: ${verb ? `unknown verb ${verb}` : 'missing verb'}\n${usage()}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error?.message ?? error)
    process.exit(1)
  })
}
