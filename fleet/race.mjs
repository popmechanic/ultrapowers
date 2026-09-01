#!/usr/bin/env node
// fleet/race.mjs — #511 attempt racing v1: the launch and judge verbs.
//
// A race is the SAME committed plan launched as K independent `driveOne` runs
// (spec docs/superpowers/specs/2026-09-01-511-attempt-racing.md §New machinery).
// Racing is composition, not modification: no engine file changes, no daemon —
// one process per race, K drives in flight via Promise.all, each starting and
// stopping its own orchestrator.
//
//   node fleet/race.mjs launch <plan.md> <raceId> --k 3 [drive-one flags]
//   node fleet/race.mjs judge <raceId> [--evidence-dir DIR] [--force]
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
import { execFile, spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { driveOne } from './drive.mjs'
import { DEFAULTS, buildDriveOptions, parseArgs } from './drive-one.mjs'
import { runEvents } from './status.mjs'
import { isSafeRepoPath } from './shim-main.mjs'

// Run-ID suffixes: `<raceId>-a`, `-b`, `-c`. Never-reuse stays the #211
// convention — suffixing onto a fresh `run-N` cannot collide with any
// conventionally named prior run (spec finding 12).
export const SUFFIXES = Object.freeze([...'abcdefghijklmnopqrstuvwxyz'])

export const DEFAULT_K = 3

// The pre-registered measurement block (spec §Measurement), copied into every
// manifest AT LAUNCH. The judge appends its verdict without disturbing this.
export const DIALS = Object.freeze({
  // Tokens are OUTPUT tokens per distinct assistant message (the reader was
  // fixed at 1f17c57 — it had counted every streamed content block, ~2.4x high;
  // the pre-fix figures were run-44 728k, run-45 588k, run-47 583k). Wall is
  // the drive's elapsedMs. run-47 is the single-attempt control: the same #511
  // plan, one attempt, serial reviewers. race-48 (2026-09-01) is the first race
  // of this plan: arms 53/68/88 min, 202k/267k/306k, 0/1/2 fix rounds.
  baseline: {
    'run-44': { wallMinutes: 79, tokens: 287_692, fixRounds: 0 },
    'run-45': { wallMinutes: 62, tokens: 232_635, fixRounds: 1, planTracedDefects: 2 },
    'run-47': { wallMinutes: 79, tokens: 239_564, fixRounds: 1, planTracedDefects: 1 },
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
  'usage: node fleet/race.mjs launch <plan.md> <raceId> [--k N] [drive-one passthrough flags]\n' +
  '       node fleet/race.mjs judge <raceId> [--evidence-dir DIR] [--force]'

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

// ── the judge verb ──────────────────────────────────────────────────────────
//
// After the K drives land, `judge <raceId>` reads what they left behind and
// names one winner. Three properties it is built around:
//
//   * It is READ-ONLY except for one append. The gate reads, the details and
//     the K stores are inputs; the only byte the judge writes is the `verdict`
//     object appended to `race-<raceId>.json`. It never calls `gh`, never
//     merges and never closes: adoption is the operator's, driven by the
//     printout. That is why a FAILED race prints the K PRs rather than acting.
//   * It refuses on INCOMPLETE evidence. A missing `gate-read-<runId>.json`
//     means that run is not terminal (green, parked and failed drives all
//     write it), and ranking a race whose slowest contestant is still running
//     is how a mid-race snapshot gets adopted as a result. `--force` is the
//     deliberate override: the reporters are scored and the absentees are
//     marked `no-record`, an automatic loss.
//   * It names the DECIDING STAGE. The rubric is ordered — gate-green filter,
//     then fewest fix rounds, then fewest tokens, then lexicographic runId —
//     and the scorecard records which stage actually separated the winner.
//     A race decided at the tie-break is not evidence of a good comparator
//     (spec §Measurement, `comparatorDecisiveness`); recording the stage is
//     what keeps n=1 from being over-read as rubric quality.
export const gateReadPath = (evidenceDir, runId) => path.join(evidenceDir, `gate-read-${runId}.json`)

export const gateDetailPath = (evidenceDir, runId) =>
  path.join(evidenceDir, `gate-read-${runId}.detail.json`)

// Absent, unreadable and malformed all read the same here: no record. The
// caller distinguishes them where it matters — a missing gate read is the
// refusal, everything else is scored from what did parse.
const readJsonOrNull = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

const numberOrNull = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null)

// The sqlite seam, injectable exactly as `status.mjs`'s own CLI keeps it: the
// judge counts fix rounds out of each run's store, and must stay runnable in a
// test with no sqlite3 binary and no store on disk. A store it cannot read is
// not a failure of the race — it reads as an unknown fix count, which loses
// every fix-round comparison rather than silently winning one.
export const storeReader = (dbDir) => {
  const proc = spawnSync('sqlite3', [path.join(dbDir, 'fleet.db'), 'SELECT store FROM tinybase LIMIT 1'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  if (proc.status !== 0) return null
  const raw = String(proc.stdout ?? '').trim()
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

// The engine's fix-round label grammar: `fix:<taskId>:<iter>`
// (run-engine.mjs:678, the one label besides `impl:` that carries a worktree).
export const FIX_LABEL = /^fix:/

// The ordered rubric, and the name each stage answers to in the scorecard.
export const RUBRIC = Object.freeze({
  green: 'gate-green-filter',
  fixRounds: 'fix-rounds',
  tokens: 'tokens',
  runId: 'runId-lexicographic',
  none: 'no-gate-green',
})

// Counted as the task defines it: EVENTS carrying a `fix:` label, not distinct
// fix labels — one per ROUND, i.e. only the `worker:start` row of each `fix:`
// label (race-48 read: counting start+end rows reported every arm at 2x its
// actual fix rounds, a=4 for 2, b=2 for 1; the ranking survived, the number
// did not). Every contestant is measured the same way.
export const countFixRounds = (storeJson, runId, events = runEvents) =>
  storeJson === null || storeJson === undefined
    ? null
    : events(storeJson, runId).filter((row) =>
        String(row?.kind ?? '') === 'worker:start' && FIX_LABEL.test(String(row?.label ?? ''))).length

// `null` loses: an unknown count or an unknown token total must never win a
// comparison it never entered.
const leastBy = (entries, key) => {
  const rank = (entry) => (typeof entry[key] === 'number' ? entry[key] : Infinity)
  const min = Math.min(...entries.map(rank))
  return entries.filter((entry) => rank(entry) === min)
}

/**
 * The ordered rubric over scored entries. Returns the winner and the stage that
 * separated it — `gate-green-filter` when only one run reached green, then the
 * first stage that leaves a single survivor.
 */
export const selectWinner = (entries) => {
  const greens = entries.filter((entry) => entry.gateGreen)
  if (greens.length === 0) return { winner: null, decidingStage: RUBRIC.none }
  if (greens.length === 1) return { winner: greens[0].runId, decidingStage: RUBRIC.green }
  const byFix = leastBy(greens, 'fixRounds')
  if (byFix.length === 1) return { winner: byFix[0].runId, decidingStage: RUBRIC.fixRounds }
  const byTokens = leastBy(byFix, 'tokens')
  if (byTokens.length === 1) return { winner: byTokens[0].runId, decidingStage: RUBRIC.tokens }
  // Code-point order, not locale order: the tie-break must be the same on every
  // machine that judges the same race.
  const sorted = [...byTokens].sort((a, b) => (a.runId < b.runId ? -1 : a.runId > b.runId ? 1 : 0))
  return { winner: sorted[0].runId, decidingStage: RUBRIC.runId }
}

// `judge` owns exactly two flags. Everything drive-one parses is irrelevant to
// a judgement — the manifest already records what the race was launched with.
export const parseJudgeArgs = (argv) => {
  const positional = []
  let evidenceDir = DEFAULTS.evidenceDir
  let force = false
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--force') {
      force = true
      continue
    }
    if (arg === '--evidence-dir') {
      const value = argv[i + 1]
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`race: --evidence-dir needs a value\n${usage()}`)
      }
      evidenceDir = value
      i += 1
      continue
    }
    if (arg.startsWith('--')) throw new Error(`race: unknown flag ${arg}\n${usage()}`)
    positional.push(arg)
  }
  const [raceId, ...extra] = positional
  if (!raceId || extra.length) throw new Error(`race: judge expects exactly <raceId>\n${usage()}`)
  if (!/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(raceId)) {
    throw new Error(`race: raceId must be [A-Za-z0-9-] (got ${JSON.stringify(raceId)}) — and never reuse one (#211)`)
  }
  return { raceId, evidenceDir, force }
}

/**
 * Judge a finished race: score every run in its manifest, select the winner by
 * the ordered rubric, and APPEND the verdict to `race-<raceId>.json` — the
 * pre-registered `dials` are carried through untouched, which is the whole
 * point of having written them before the drives started.
 *
 * @param {string[]} argv - `<raceId> [--evidence-dir DIR] [--force]`
 * @param {object} [deps] - `readStore` (dbDir -> store JSON), `events`
 *   (status.mjs's `runEvents`).
 * @returns {{winner: (string|null), decidingStage: string, scorecard: object}}
 */
export const judgeRace = (argv, deps = {}) => {
  const { readStore = storeReader, events = runEvents } = deps
  const { raceId, evidenceDir, force } = parseJudgeArgs(argv)
  const manifest = readRaceManifest(evidenceDir, raceId)
  const runs = Array.isArray(manifest.runs) ? manifest.runs : []

  const inputs = runs.map((run) => ({
    run,
    read: readJsonOrNull(gateReadPath(evidenceDir, run.runId)),
    detail: readJsonOrNull(gateDetailPath(evidenceDir, run.runId)),
  }))

  // Terminal ⟺ the gate read exists (green, parked and failed drives all write
  // one). Anything else is a race still in flight, and judging it is how a
  // snapshot becomes a result.
  const absent = inputs.filter((input) => input.read === null).map((input) => input.run.runId)
  if (absent.length > 0 && !force) {
    throw new Error(
      `race: judge ${raceId} refuses — no gate read for ${absent.join(', ')} ` +
        `(${absent.map((runId) => gateReadPath(evidenceDir, runId)).join(', ')}); ` +
        `those runs are not terminal. Wait for them, or --force to score the runs that reported and ` +
        `mark these no-record — an automatic loss.`,
    )
  }

  // The token basis is decided over the CONTESTANTS — the runs that reported.
  // An absentee has no ledger by definition, so letting it force the fallback
  // would make `--force` silently change the comparator for everyone else.
  const contestants = inputs.filter((input) => input.read !== null)
  const ledgerOf = (input) => numberOrNull(input.read?.spendObservational?.ledger)
  const reportedOf = (input) => numberOrNull(input.read?.spendObservational?.reported)
  const tokenFallback = contestants.length > 0 && contestants.some((input) => ledgerOf(input) === null)

  const scorecard = {}
  for (const input of inputs) {
    const { run, read, detail } = input
    const reported = read !== null
    const status = reported ? String(detail?.status ?? 'unknown') : 'no-record'
    scorecard[run.runId] = {
      runId: run.runId,
      reported,
      status,
      gateGreen: status === 'gate-green',
      fixRounds: reported ? countFixRounds(readStore(run.dbDir), run.runId, events) : null,
      tokens: reported ? (tokenFallback ? reportedOf(input) : ledgerOf(input)) : null,
      tokenBasis: reported ? (tokenFallback ? 'reported' : 'ledger') : null,
      tokenFallback: reported && tokenFallback,
      elapsedMs: reported ? numberOrNull(detail?.elapsedMs) : null,
      pullRequest: (reported && detail?.pullRequest) || null,
      verdict: 'lost',
    }
  }

  const { winner, decidingStage } = selectWinner(Object.values(scorecard))
  if (winner !== null) scorecard[winner].verdict = 'winner'

  const verdict = { winner, decidingStage, scorecard }
  // Appended, not rewritten: every pre-registered key — `dials` above all —
  // is carried through by value and re-serialized identically.
  fs.writeFileSync(manifestPath(evidenceDir, raceId), `${JSON.stringify({ ...manifest, verdict }, null, 2)}\n`)
  return verdict
}

export const scorecardLine = (entry) => {
  const tokens = entry.tokens === null ? 'null' : String(entry.tokens)
  const basis =
    entry.tokenBasis === null ? '' : ` (${entry.tokenBasis}${entry.tokenFallback ? ', ledger-fallback' : ''})`
  return (
    `  ${entry.runId} status=${entry.status} fix-rounds=${entry.fixRounds === null ? 'null' : entry.fixRounds} ` +
    `tokens=${tokens}${basis} verdict=${entry.verdict}`
  )
}

// A FAILED race merges nothing, so the K open PRs are the operator's to close.
// The judge prints them and stops there — it never calls `gh`.
export const prLine = (entry) => {
  const pr = entry.pullRequest
  return (
    `  ${entry.runId} pr=${pr?.number === undefined ? 'none' : `#${pr.number}`} ` +
    `branch=${pr?.branch ?? 'none'} url=${pr?.url ?? 'none'}`
  )
}

export const main = async (argv = process.argv.slice(2), deps = {}) => {
  const { log = console.log, ...raceDeps } = deps
  const [verb, ...rest] = argv
  if (verb === 'judge') {
    const { raceId, evidenceDir } = parseJudgeArgs(rest)
    const verdict = judgeRace(rest, raceDeps)
    const entries = Object.values(verdict.scorecard)
    log(
      verdict.winner === null
        ? `race ${raceId}: FAILED — no gate-green run; merge nothing`
        : `race ${raceId}: winner ${verdict.winner}`,
    )
    log(`deciding stage: ${verdict.decidingStage}`)
    for (const entry of entries) log(scorecardLine(entry))
    if (verdict.winner === null) {
      // The judge never merges and never closes: it hands the operator the K
      // PRs and stops.
      log(`open PRs for the operator to close (${entries.length}):`)
      for (const entry of entries) log(prLine(entry))
    }
    log(`verdict: ${manifestPath(evidenceDir, raceId)}`)
    return verdict
  }
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
