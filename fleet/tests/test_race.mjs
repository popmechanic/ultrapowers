// fleet/tests/test_race.mjs — #511 attempt racing v1: the launch and judge verbs.
//
// A race is K whole runs of one committed plan, driven concurrently from one
// process. What has to be true before any of that is worth measuring: the
// dials are written down BEFORE the results exist, the K identities cannot
// collide (runId, port, db-dir and — spec finding 6 — repo-dir), and the
// per-run options come off `drive-one.mjs`'s seam rather than a second
// hand-typed copy of the drive constants.
//
// The judge half: the ordered rubric decides mechanically over pre-existing
// per-run artifacts (gate-read, its detail, the run's own store), it names WHICH
// stage decided — the #511 dial that keeps n=1 from being over-read as "the
// rubric is good" — and it appends its verdict to the manifest without touching
// the dials that were pre-registered before any result existed.
//
// No live drive, no network, no git remote: `driveOne`, every git subprocess and
// the sqlite store read are injected, as in test_drive_one.mjs.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { REPO_DIR, buildDriveOptions, parseArgs } from '../drive-one.mjs'
import {
  DIALS,
  STAGES,
  allocateRuns,
  gateReadPath,
  judgeRace,
  launchRace,
  main,
  parseJudgeArgs,
  parseLaunchArgs,
  raceManifestPath,
  readRaceManifest,
  runIdFor,
  scorecardLine,
  usage,
} from '../race.mjs'

const RACE_MJS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'race.mjs')

let passed = 0
const ok = (label) => {
  passed += 1
  console.log(`ok - ${label}`)
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-race-test-'))
const scratch = (name) => {
  const dir = path.join(TMP, name)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

const SHA = '0123456789abcdef0123456789abcdef01234567'
const LAUNCHED_AT = '2026-09-01T12:00:00.000Z'
// What the launch checkout's `origin` is: the GitHub https remote the publish
// leg pushes to and `gh pr create` reads the host from.
const ORIGIN_URL = 'https://github.com/acme/fleet.git'

// The remote configuration the git calls actually leave behind. `git clone
// <src> <dst>` writes `origin = <src>` — a filesystem path — and `remote
// set-url origin <url>` replaces it; replaying the calls is what lets this
// suite assert the resulting config and not merely the command sequence.
const originsAfter = (gitCalls) => {
  const origins = {}
  for (const args of gitCalls) {
    if (args[0] === 'clone') origins[args.at(-1)] = args.at(-2)
    else if (args[0] === '-C' && args[2] === 'remote' && args[3] === 'set-url' && args[4] === 'origin') {
      origins[args[1]] = args[5]
    }
  }
  return origins
}

// The two seams drive-one already owns; identical references so the option
// comparison below can be an equality, not a shape check.
const exec = async () => ({ code: 0, stdout: '', stderr: '' })
const readToken = () => '  fake-token  \n'

const makeDeps = ({ drive, narrate } = {}) => {
  const gitCalls = []
  const driveCalls = []
  const lines = []
  const deps = {
    git: async (args) => {
      gitCalls.push(args)
      if (args.includes('rev-parse')) return `${SHA}\n`
      if (args.includes('get-url')) return `${ORIGIN_URL}\n`
      return ''
    },
    drive:
      drive ??
      (async (opts) => {
        driveCalls.push(opts)
        return {
          read: { runId: opts.runId, status: 'gate-green' },
          reportPath: `/tmp/gate-read-${opts.runId}.json`,
          detailPath: `/tmp/gate-read-${opts.runId}.detail.json`,
        }
      }),
    readToken,
    exec,
    now: () => LAUNCHED_AT,
    narrate: narrate ?? ((line) => lines.push(line)),
    log: (line) => lines.push(line),
  }
  return { deps, gitCalls, driveCalls, lines }
}

// --- (a) the manifest: base commit + pre-registered dials -------------------

{
  const evidenceDir = scratch('ev-a')
  const raceDir = path.join(TMP, 'race-a')
  const { deps } = makeDeps()
  const { manifest, results } = await launchRace(
    ['docs/plan.md', 'race-90', '--k', '3', '--evidence-dir', evidenceDir, '--race-dir', raceDir],
    deps,
  )

  const file = path.join(evidenceDir, 'race-race-90.json')
  assert.equal(raceManifestPath(evidenceDir, 'race-90'), file)
  assert.ok(fs.existsSync(file), `${file} must exist`)

  const expected = {
    raceId: 'race-90',
    planPath: 'docs/plan.md',
    baseCommit: SHA,
    k: 3,
    launchedAt: LAUNCHED_AT,
    runs: [
      { runId: 'race-90-a', port: 8180, dbDir: '/tmp/fleet-orch-live-a', repoDir: path.join(raceDir, 'race-90-a') },
      { runId: 'race-90-b', port: 8181, dbDir: '/tmp/fleet-orch-live-b', repoDir: path.join(raceDir, 'race-90-b') },
      { runId: 'race-90-c', port: 8182, dbDir: '/tmp/fleet-orch-live-c', repoDir: path.join(raceDir, 'race-90-c') },
    ],
    dials: JSON.parse(JSON.stringify(DIALS)),
  }
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), expected)
  assert.deepEqual(readRaceManifest(evidenceDir, 'race-90'), expected)
  assert.deepEqual(manifest, expected)
  // The pre-registered block is the spec's §Measurement list, not an empty hull.
  assert.deepEqual(
    Object.keys(DIALS).sort(),
    ['baseline', 'comparatorDecisiveness', 'perRun', 'raceWall', 'totalTokens', 'winnerDefectSurface'],
  )
  assert.match(DIALS.raceWall, /launchedAt/)
  assert.match(DIALS.raceWall, /elapsedMs/)
  assert.equal(results.length, 3)
  ok('(a) launch writes race-<raceId>.json: base commit from git, dials pre-registered')
}

// --- (b) pre-registration: the manifest exists before the first drive -------

{
  const evidenceDir = scratch('ev-b')
  const raceDir = path.join(TMP, 'race-b')
  const seen = []
  const drive = async (opts) => {
    seen.push(fs.existsSync(path.join(evidenceDir, 'race-race-91.json')))
    return { read: { runId: opts.runId } }
  }
  const { deps } = makeDeps({ drive })
  await launchRace(
    ['docs/plan.md', 'race-91', '--k', '3', '--evidence-dir', evidenceDir, '--race-dir', raceDir],
    deps,
  )
  assert.deepEqual(seen, [true, true, true], 'dials must not be choosable after results are visible')
  ok('(b) the manifest is on disk at the moment of the first driveOne call')
}

// --- (c) K calls, all in flight together ------------------------------------

{
  const evidenceDir = scratch('ev-c')
  const raceDir = path.join(TMP, 'race-c')
  let started = 0
  let inFlight = 0
  let maxInFlight = 0
  let release
  const allStarted = new Promise((resolve) => {
    release = resolve
  })
  const drive = async (opts) => {
    started += 1
    inFlight += 1
    maxInFlight = Math.max(maxInFlight, inFlight)
    if (started === 3) release()
    await allStarted // a sequential launcher deadlocks here; the guard names it
    inFlight -= 1
    return { read: { runId: opts.runId } }
  }
  const guard = new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error('the K drives never overlapped in flight')), 10_000)
    timer.unref()
  })
  const { deps } = makeDeps({ drive })
  await Promise.race([
    launchRace(['docs/plan.md', 'race-92', '--k', '3', '--evidence-dir', evidenceDir, '--race-dir', raceDir], deps),
    guard,
  ])
  assert.equal(started, 3, 'driveOne is called exactly K times')
  assert.equal(maxInFlight, 3, 'the K drives run concurrently, not one after another')
  ok('(c) driveOne is called exactly K times and the K calls overlap in flight')
}

// --- (d) allocation: pairwise distinct, cloned at the base commit -----------

{
  const evidenceDir = scratch('ev-d')
  const raceDir = path.join(TMP, 'race-d')
  const { deps, gitCalls, driveCalls } = makeDeps()
  await launchRace(
    ['docs/plan.md', 'race-93', '--k', '3', '--evidence-dir', evidenceDir, '--race-dir', raceDir],
    deps,
  )

  assert.deepEqual(driveCalls.map((o) => o.runId), ['race-93-a', 'race-93-b', 'race-93-c'])
  assert.deepEqual(driveCalls.map((o) => o.port), [8180, 8181, 8182])
  assert.deepEqual(driveCalls.map((o) => o.dbDir), [
    '/tmp/fleet-orch-live-a',
    '/tmp/fleet-orch-live-b',
    '/tmp/fleet-orch-live-c',
  ])
  assert.deepEqual(driveCalls.map((o) => o.repoDir), [
    path.join(raceDir, 'race-93-a'),
    path.join(raceDir, 'race-93-b'),
    path.join(raceDir, 'race-93-c'),
  ])
  for (const key of ['runId', 'port', 'dbDir', 'repoDir']) {
    assert.equal(new Set(driveCalls.map((o) => o[key])).size, 3, `${key} must be pairwise distinct`)
  }

  // Every repoDir is a fresh clone of the launch checkout, detached at the sha
  // the manifest recorded — sharing one repoDir would race the publish leg's
  // FETCH_HEAD window across siblings (spec finding 6).
  assert.deepEqual(gitCalls, [
    ['-C', REPO_DIR, 'rev-parse', 'HEAD'],
    ['-C', REPO_DIR, 'remote', 'get-url', 'origin'],
    ['clone', '--no-hardlinks', REPO_DIR, path.join(raceDir, 'race-93-a')],
    ['-C', path.join(raceDir, 'race-93-a'), 'checkout', '--detach', SHA],
    ['-C', path.join(raceDir, 'race-93-a'), 'remote', 'set-url', 'origin', ORIGIN_URL],
    ['clone', '--no-hardlinks', REPO_DIR, path.join(raceDir, 'race-93-b')],
    ['-C', path.join(raceDir, 'race-93-b'), 'checkout', '--detach', SHA],
    ['-C', path.join(raceDir, 'race-93-b'), 'remote', 'set-url', 'origin', ORIGIN_URL],
    ['clone', '--no-hardlinks', REPO_DIR, path.join(raceDir, 'race-93-c')],
    ['-C', path.join(raceDir, 'race-93-c'), 'checkout', '--detach', SHA],
    ['-C', path.join(raceDir, 'race-93-c'), 'remote', 'set-url', 'origin', ORIGIN_URL],
  ])

  // The configuration those calls leave behind, not just their order: a clone
  // of a local path points `origin` at that path, and `driveOne`'s publish leg
  // pushes to `origin` and then runs `gh pr create` in the same dir. Left as
  // cloned, the race's branches would land in the operator's launch checkout
  // and every run would end `gh pr create ... failed` with no PR to merge or
  // close — the whole adoption path gone.
  const origins = originsAfter(gitCalls)
  for (const repoDir of driveCalls.map((o) => o.repoDir)) {
    assert.equal(origins[repoDir], ORIGIN_URL, `${repoDir} must publish to the GitHub remote`)
    assert.notEqual(origins[repoDir], REPO_DIR, 'a race must never push into the launch checkout')
  }
  ok('(d) runIds/ports/db-dirs/repo-dirs are pairwise distinct; each repo-dir is a clone at baseCommit')
  ok('(d) each clone keeps the launch checkout\'s GitHub origin, not the local clone path')
}

// --- (d2) a launch checkout with no origin is refused, not published nowhere -

{
  const evidenceDir = scratch('ev-d2')
  const raceDir = path.join(TMP, 'race-d2')
  for (const broken of [
    async (args) => {
      if (args.includes('get-url')) throw new Error("error: No such remote 'origin'")
      return args.includes('rev-parse') ? `${SHA}\n` : ''
    },
    async (args) => (args.includes('rev-parse') ? `${SHA}\n` : ''), // get-url returns nothing
  ]) {
    const { deps, driveCalls } = makeDeps()
    deps.git = broken
    await assert.rejects(
      launchRace(['docs/plan.md', 'race-93b', '--k', '3', '--evidence-dir', evidenceDir, '--race-dir', raceDir], deps),
      /nowhere to publish/,
    )
    assert.equal(driveCalls.length, 0, 'the refusal comes before any drive starts')
  }
  assert.ok(!fs.existsSync(path.join(evidenceDir, 'race-race-93b.json')), 'no manifest for a race that cannot publish')
  ok('(d2) a launch checkout without an origin URL refuses before any drive starts')
}

// --- (e) the options come off buildDriveOptions, overrides only -------------

{
  const evidenceDir = scratch('ev-e')
  const raceDir = path.join(TMP, 'race-e')
  const narrated = []
  const { deps, driveCalls } = makeDeps({ narrate: (line) => narrated.push(line) })
  await launchRace(
    ['docs/plan.md', 'race-94', '--k', '3', '--evidence-dir', evidenceDir, '--race-dir', raceDir],
    deps,
  )

  const baseline = buildDriveOptions(
    parseArgs(['docs/plan.md', 'race-94', '--evidence-dir', evidenceDir]),
    { readToken, exec },
  )
  const OVERRIDDEN = new Set(['runId', 'port', 'dbDir', 'repoDir', 'progressLog'])
  for (const opts of driveCalls) {
    assert.deepEqual(Object.keys(opts).sort(), [...Object.keys(baseline), 'progressLog'].sort())
    for (const key of Object.keys(baseline)) {
      if (!OVERRIDDEN.has(key)) assert.deepEqual(opts[key], baseline[key], `${key} must survive untouched`)
    }
    // A drive-one default nobody re-types here (#368), and the token seam.
    assert.equal(opts.prBase, 'main')
    assert.equal(opts.ttlMs, 4 * 60 * 60 * 1000)
    assert.equal(opts.exec, exec)
    assert.equal(opts.engineEnv.CLAUDE_CODE_OAUTH_TOKEN, 'fake-token')
    // #511 review finding 11: three interleaved drives on one stderr.
    assert.equal(typeof opts.progressLog, 'function')
    opts.progressLog('provisioning')
    const line = narrated.at(-1)
    assert.ok(line.startsWith(`[race ${opts.runId} `), line)
    assert.ok(line.endsWith('] provisioning'), line)
  }
  assert.equal(narrated.length, 3)
  ok('(e) options are built through the real buildDriveOptions; only the five keys are overridden')
}

// --- (f) the suffixed runIds are legal and never their own raceId ----------

{
  const raceId = 'race-95'
  const runs = allocateRuns({ raceId, k: 3, port: 8180, dbDir: '/tmp/db', raceDir: '/tmp/race' })
  assert.deepEqual(runs.map((r) => r.runId), ['race-95-a', 'race-95-b', 'race-95-c'])
  assert.equal(runIdFor(raceId, 0), 'race-95-a')
  for (const run of runs) {
    assert.notEqual(run.runId, raceId, 'a suffixed runId must never equal its own raceId (#211 never-reuse)')
    // The #211 grammar drive-one enforces: parseArgs must accept every one.
    assert.equal(parseArgs(['p.md', run.runId]).runId, run.runId)
  }
  ok('(f) suffixed runIds match the #211 grammar and never equal their own raceId')
}

// --- (g) a drive rejection is a fast failure --------------------------------

{
  const evidenceDir = scratch('ev-g')
  const raceDir = path.join(TMP, 'race-g')
  const drive = async (opts) => {
    if (opts.runId === 'race-96-b') throw new Error('drive-one: plan is dirty at baseRef (#337)')
    return { read: { runId: opts.runId } }
  }
  const { deps } = makeDeps({ drive })
  await assert.rejects(
    launchRace(['docs/plan.md', 'race-96', '--k', '3', '--evidence-dir', evidenceDir, '--race-dir', raceDir], deps),
    /plan is dirty at baseRef/,
  )
  ok('(g) a driveOne rejection propagates as a fast failure')
}

// --- (h) the CLI entry: the flag path, not just the direct call ------------

{
  const evidenceDir = scratch('ev-h')
  const raceDir = path.join(TMP, 'race-h')
  const { deps, driveCalls, lines } = makeDeps()
  const { manifest } = await main(
    ['launch', 'docs/plan.md', 'race-97', '--k', '3', '--evidence-dir', evidenceDir, '--race-dir', raceDir],
    deps,
  )
  assert.equal(manifest.raceId, 'race-97')
  assert.equal(manifest.k, 3)
  assert.equal(manifest.runs.length, 3)
  assert.equal(driveCalls.length, 3)
  assert.ok(fs.existsSync(path.join(evidenceDir, 'race-race-97.json')))
  const printed = lines.join('\n')
  assert.ok(printed.includes('race-97-a'), printed)
  assert.ok(printed.includes(path.join(evidenceDir, 'race-race-97.json')), printed)
  assert.ok(!printed.includes('fake-token'), 'the token must never be printed')
  ok('(h) `launch <plan> <raceId> --k 3` reaches launchRace with that raceId and k=3')
}

{
  const { deps } = makeDeps()
  await assert.rejects(main(['sprint', 'docs/plan.md', 'race-98'], deps), /unknown verb sprint/)
  await assert.rejects(main([], deps), /usage: node fleet\/race\.mjs/)
  assert.match(usage(), /launch <plan\.md> <raceId>/)
  ok('an unknown or missing verb refuses with the usage line')
}

// --- launch-arg parsing -----------------------------------------------------

{
  const parsed = parseLaunchArgs(['docs/plan.md', 'race-99', '--k', '2', '--race-dir', '/tmp/rd', '--pr-base', 'release/1'])
  assert.equal(parsed.raceId, 'race-99')
  assert.equal(parsed.planPath, 'docs/plan.md')
  assert.equal(parsed.k, 2)
  assert.equal(parsed.raceDir, '/tmp/rd')
  assert.equal(parsed.prBase, 'release/1', 'drive-one flags pass through untouched')
  assert.equal(parseLaunchArgs(['p.md', 'race-99']).k, 3, 'K defaults to 3 (#511 operator decision)')
  assert.equal(parseLaunchArgs(['p.md', 'race-99']).raceDir, path.join(os.tmpdir(), 'fleet-race-race-99'))

  assert.throws(() => parseLaunchArgs(['p.md', 'race-99', '--k', '0']), /--k must be an integer/)
  assert.throws(() => parseLaunchArgs(['p.md', 'race-99', '--k', '2.5']), /--k must be an integer/)
  assert.throws(() => parseLaunchArgs(['p.md', 'race-99', '--k', '27']), /--k must be an integer/)
  assert.throws(() => parseLaunchArgs(['p.md', 'race-99', '--k']), /--k needs a value/)
  assert.throws(() => parseLaunchArgs(['p.md', 'race-99', '--race-dir']), /--race-dir needs a value/)
  // Everything else is drive-one's business, refusals included.
  assert.throws(() => parseLaunchArgs(['p.md', 'race-99', '--bogus', 'x']), /unknown flag --bogus/)
  assert.throws(() => parseLaunchArgs(['p.md']), /expected exactly <plan\.md> <runId>/)
  assert.throws(() => parseLaunchArgs(['p.md', 'race 99']), /#211/)
  ok('--k and --race-dir are race flags; every other flag is drive-one passthrough')
}

// ===========================================================================
// The judge verb — `race.mjs judge <raceId> [--force]`
// ===========================================================================
//
// Read-only over artifacts the drives already wrote. The rubric is ordered and
// mechanical, so what these legs pin is not "the winner looked best" but that
// each stage is reached only when the one above it tied, and that the verdict
// says WHICH stage decided (spec §Measurement: never read "zero ties" as
// rubric quality — name the stage).

// A trimmed MergeableStore shape, as test_status.mjs uses: [tables, values],
// every node [value, hlc, hash]. The judge reads it through `runEvents`.
const stamped = (v) => [v, 'P0Q-hlc', 12345]

// A run's store: two ordinary events, `fixRounds` events carrying the engine's
// `fix:<taskId>:<iter>` worker label, and one decoy from a DIFFERENT run in the
// same store — the per-run count must not absorb a sibling's fix rounds.
const storeFor = (runId, fixRounds) => {
  const events = {
    [`${runId}:01AAA`]: stamped({ kind: stamped('engine:phase'), phase: stamped('Wave 1'), ts: stamped(1), runId: stamped(runId) }),
    [`${runId}:01AAB`]: stamped({ kind: stamped('worker:start'), label: stamped('impl:1'), ts: stamped(2), runId: stamped(runId) }),
    'other-run:01AAZ': stamped({ kind: stamped('worker:start'), label: stamped('fix:9:1'), ts: stamped(9), runId: stamped('other-run') }),
  }
  for (let i = 0; i < fixRounds; i += 1) {
    events[`${runId}:01AB${i}`] =
      stamped({ kind: stamped('worker:start'), label: stamped(`fix:${i + 1}:1`), ts: stamped(3 + i), runId: stamped(runId) })
  }
  return [[{ events: stamped(events), runs: stamped({}) }, {}], 'hlc', 0]
}

const prFor = (runId, number) => ({
  number,
  url: `https://github.com/acme/fleet/pull/${number}`,
  draft: false,
  branch: `ultra/integration-${runId}`,
})

// Stage a whole race from the real launch verb, then lay down exactly the
// per-run artifacts the spec names. A `null` spec means that drive never wrote
// a gate read at all — the not-terminal case the judge refuses over.
let raceSeq = 0
const stageRace = async (specs) => {
  raceSeq += 1
  const raceId = `race-2${raceSeq}0`
  const evidenceDir = scratch(`ev-judge-${raceSeq}`)
  const { deps } = makeDeps()
  const { manifest } = await launchRace(
    [
      'docs/plan.md',
      raceId,
      '--k',
      String(specs.length),
      '--evidence-dir',
      evidenceDir,
      '--race-dir',
      path.join(TMP, `rd-${raceSeq}`),
    ],
    deps,
  )
  const stores = {}
  manifest.runs.forEach((run, i) => {
    const spec = specs[i]
    if (spec === null) return
    // `read` is EXACTLY drive.mjs's gate read; `detail` is its sibling triage file.
    fs.writeFileSync(
      path.join(evidenceDir, `gate-read-${run.runId}.json`),
      `${JSON.stringify(
        {
          o1: spec.status === 'gate-green',
          spendObservational: { reported: spec.reported ?? null, ledger: spec.ledger ?? null },
        },
        null,
        2,
      )}\n`,
    )
    fs.writeFileSync(
      path.join(evidenceDir, `gate-read-${run.runId}.detail.json`),
      `${JSON.stringify(
        {
          runId: run.runId,
          status: spec.status,
          elapsedMs: spec.elapsedMs ?? 60_000,
          pullRequest: prFor(run.runId, 100 + i),
        },
        null,
        2,
      )}\n`,
    )
    stores[path.join(run.dbDir, 'fleet.db')] = storeFor(run.runId, spec.fixRounds)
  })
  const judgeDeps = {
    readStoreJson: (dbPath) => {
      if (!(dbPath in stores)) throw new Error(`test: no store fixture for ${dbPath}`)
      return stores[dbPath]
    },
  }
  return { raceId, evidenceDir, manifest, judgeDeps, args: [raceId, '--evidence-dir', evidenceDir] }
}

// --- (j) refusal until every run is terminal; --force scores the reporters ---

{
  const { raceId, evidenceDir, judgeDeps, args } = await stageRace([
    { status: 'gate-green', fixRounds: 1, ledger: 500_000, reported: 510_000 },
    null, // the race process died mid-drive: no gate read will ever appear
    { status: 'gate-green', fixRounds: 1, ledger: 400_000, reported: 410_000 },
  ])
  const missing = `${raceId}-b`

  assert.throws(
    () => judgeRace(args, judgeDeps),
    (error) => {
      assert.match(error.message, /refuses/)
      assert.ok(error.message.includes(missing), error.message)
      assert.ok(error.message.includes(gateReadPath(evidenceDir, missing)), error.message)
      assert.match(error.message, /--force/)
      return true
    },
  )
  // A refused judge writes nothing: no verdict may reach the manifest.
  assert.equal(readRaceManifest(evidenceDir, raceId).verdict, undefined)

  const verdict = judgeRace([...args, '--force'], judgeDeps)
  // The absentee is scored, and it is an automatic loss — it can never win.
  assert.deepEqual(verdict.scorecard[missing], {
    runId: missing,
    status: 'no-record',
    fixRounds: null,
    tokens: null,
    tokenSource: null,
    elapsedMs: null,
    pr: null,
    outcome: 'loser',
  })
  assert.equal(verdict.winner, `${raceId}-c`)
  assert.equal(verdict.decidingStage, STAGES.tokens)
  assert.deepEqual(Object.keys(verdict.scorecard), [`${raceId}-a`, missing, `${raceId}-c`])
  ok('(j) judge refuses while a gate-read is missing; --force scores reporters and marks the rest no-record losses')
}

// --- (k) stage 1: the gate-green filter beats everything else ---------------

{
  // The green run is the WORST on both later stages: only the filter can pick it.
  const { raceId, judgeDeps, args } = await stageRace([
    { status: 'parked', fixRounds: 0, ledger: 100_000, reported: 100_000 },
    { status: 'gate-green', fixRounds: 4, ledger: 900_000, reported: 900_000 },
    { status: 'unknown', fixRounds: 0, ledger: 100_000, reported: 100_000 },
  ])
  const verdict = judgeRace(args, judgeDeps)
  assert.equal(verdict.winner, `${raceId}-b`)
  assert.equal(verdict.decidingStage, STAGES.filter)
  assert.match(STAGES.filter, /gate-green/)
  assert.deepEqual(Object.values(verdict.scorecard).map((e) => e.outcome), ['loser', 'winner', 'loser'])
  ok('(k) the sole gate-green run beats parked and failed drives; decidingStage is the filter')
}

// --- (l) stage 2: fewest fix: events, only among the greens -----------------

{
  // b wins on tokens by a mile and loses anyway: stage 2 is reached first.
  const { raceId, judgeDeps, args } = await stageRace([
    { status: 'gate-green', fixRounds: 0, ledger: 800_000, reported: 800_000 },
    { status: 'gate-green', fixRounds: 2, ledger: 100_000, reported: 100_000 },
    { status: 'parked', fixRounds: 0, ledger: 1_000, reported: 1_000 },
  ])
  const verdict = judgeRace(args, judgeDeps)
  assert.equal(verdict.winner, `${raceId}-a`)
  assert.equal(verdict.decidingStage, STAGES.fixRounds)
  assert.match(STAGES.fixRounds, /fix rounds/)
  // The count is per-run: the decoy `fix:9:1` event of `other-run` never lands.
  assert.equal(verdict.scorecard[`${raceId}-a`].fixRounds, 0)
  assert.equal(verdict.scorecard[`${raceId}-b`].fixRounds, 2)
  ok('(l) among greens the fewest fix:-labeled events wins; decidingStage names the fix-round stage')
}

// --- (m) stage 3: fewest tokens, and the like-with-like ledger fallback -----

{
  const { raceId, judgeDeps, args } = await stageRace([
    { status: 'gate-green', fixRounds: 1, ledger: 700_000, reported: 10 },
    { status: 'gate-green', fixRounds: 1, ledger: 300_000, reported: 999_999 },
  ])
  const verdict = judgeRace(args, judgeDeps)
  assert.equal(verdict.winner, `${raceId}-b`)
  assert.equal(verdict.decidingStage, STAGES.tokens)
  assert.match(STAGES.tokens, /tokens/)
  assert.equal(verdict.scorecard[`${raceId}-a`].tokens, 700_000)
  assert.equal(verdict.scorecard[`${raceId}-a`].tokenSource, 'ledger')
  assert.equal(verdict.scorecard[`${raceId}-b`].tokens, 300_000)
  ok('(m) among fix-round ties the fewest spendObservational.ledger tokens wins')
}

{
  // One null ledger: comparing 300_000 against nothing is not a comparison, so
  // the WHOLE field falls back to `reported` — which reverses the winner.
  const { raceId, judgeDeps, args } = await stageRace([
    { status: 'gate-green', fixRounds: 1, ledger: null, reported: 200_000 },
    { status: 'gate-green', fixRounds: 1, ledger: 300_000, reported: 900_000 },
  ])
  const verdict = judgeRace(args, judgeDeps)
  assert.equal(verdict.winner, `${raceId}-a`)
  assert.equal(verdict.decidingStage, STAGES.tokens)
  assert.deepEqual(
    Object.values(verdict.scorecard).map((e) => [e.tokens, e.tokenSource]),
    [[200_000, 'reported'], [900_000, 'reported']],
  )
  ok('(m) one null ledger falls the whole field back to reported tokens, flagged in every scorecard entry')
}

// --- (n) stage 4: lexicographic runId, stated as the tie-break --------------

{
  const { raceId, judgeDeps, args } = await stageRace([
    { status: 'gate-green', fixRounds: 1, ledger: 500_000, reported: 500_000 },
    { status: 'gate-green', fixRounds: 1, ledger: 500_000, reported: 500_000 },
  ])
  const verdict = judgeRace(args, judgeDeps)
  assert.equal(verdict.winner, `${raceId}-a`)
  assert.ok(`${raceId}-a` < `${raceId}-b`, 'the tie-break is lexicographic, not positional')
  assert.equal(verdict.decidingStage, STAGES.tieBreak)
  assert.match(STAGES.tieBreak, /lexicographic/)
  ok('(n) a full tie is broken by lexicographic runId, and the verdict says so')
}

// --- (o) zero greens: the race FAILED, no winner, K PRs to close ------------

{
  const { raceId, evidenceDir, judgeDeps, args } = await stageRace([
    { status: 'parked', fixRounds: 0, ledger: 1_000, reported: 1_000 },
    { status: 'running', fixRounds: 3, ledger: 2_000, reported: 2_000 },
    { status: 'unknown', fixRounds: 1, ledger: 3_000, reported: 3_000 },
  ])
  const verdict = judgeRace(args, judgeDeps)
  assert.equal(verdict.winner, null)
  assert.equal(verdict.decidingStage, STAGES.failed)
  assert.match(STAGES.failed, /FAILED/)
  assert.deepEqual(Object.values(verdict.scorecard).map((e) => e.outcome), ['loser', 'loser', 'loser'])

  const { deps, lines } = makeDeps()
  await main(['judge', ...args], { ...deps, ...judgeDeps })
  const printed = lines.join('\n')
  assert.match(printed, /FAILED/)
  assert.match(printed, /merge nothing/)
  for (const run of readRaceManifest(evidenceDir, raceId).runs) {
    assert.ok(printed.includes(`ultra/integration-${run.runId}`), `the operator needs every PR branch: ${printed}`)
  }
  ok('(o) zero greens is a FAILED race: no winner, and all K PR branches are printed for the operator to close')
}

// --- (p) the verdict is APPENDED: the pre-registered dials stay byte-identical

{
  const { raceId, evidenceDir, judgeDeps, args } = await stageRace([
    { status: 'gate-green', fixRounds: 0, ledger: 100_000, reported: 100_000 },
    { status: 'parked', fixRounds: 0, ledger: 1_000, reported: 1_000 },
  ])
  const file = raceManifestPath(evidenceDir, raceId)
  const before = fs.readFileSync(file, 'utf8')
  const beforeManifest = JSON.parse(before)

  const verdict = judgeRace(args, judgeDeps)

  const after = fs.readFileSync(file, 'utf8')
  const afterManifest = JSON.parse(after)
  // Byte-identical, not merely deep-equal: the dials block IS the pre-registration.
  // The one byte the append may add to it is JSON's own key separator; every
  // other byte of the block has to survive the rewrite untouched.
  const dialsBytes = (text, end) => text.slice(text.indexOf('"dials"'), text.indexOf(end)).replace(/,$/, '')
  assert.equal(dialsBytes(after, '\n  "verdict"'), dialsBytes(before, '\n}\n'))
  assert.ok(before.includes(dialsBytes(after, '\n  "verdict"')), 'the dials block must be a verbatim substring of both')
  assert.deepEqual(afterManifest.dials, JSON.parse(JSON.stringify(DIALS)))
  // ...and nothing else the launch pre-registered moved either.
  const { verdict: appended, ...rest } = afterManifest
  assert.deepEqual(rest, beforeManifest)
  assert.deepEqual(appended, verdict)
  assert.deepEqual(Object.keys(verdict), ['winner', 'decidingStage', 'scorecard'])
  ok('(p) the verdict is appended to race-<raceId>.json and every pre-registered dial stays byte-identical')
}

// --- (q) the scorecard is keyed by runId and names status/fix rounds/tokens --

{
  const { raceId, judgeDeps, args } = await stageRace([
    { status: 'gate-green', fixRounds: 2, ledger: 640_000, reported: 650_000, elapsedMs: 3_960_000 },
    { status: 'parked', fixRounds: 5, ledger: 120_000, reported: 130_000, elapsedMs: 1_800_000 },
  ])
  const verdict = judgeRace(args, judgeDeps)
  assert.deepEqual(verdict.scorecard, {
    [`${raceId}-a`]: {
      runId: `${raceId}-a`,
      status: 'gate-green',
      fixRounds: 2,
      tokens: 640_000,
      tokenSource: 'ledger',
      elapsedMs: 3_960_000,
      pr: prFor(`${raceId}-a`, 100),
      outcome: 'winner',
    },
    [`${raceId}-b`]: {
      runId: `${raceId}-b`,
      status: 'parked',
      fixRounds: 5,
      tokens: 120_000,
      tokenSource: 'ledger',
      elapsedMs: 1_800_000,
      pr: prFor(`${raceId}-b`, 101),
      outcome: 'loser',
    },
  })
  assert.equal(
    scorecardLine(verdict.scorecard[`${raceId}-a`]),
    `${raceId}-a: winner status=gate-green fix-rounds=2 tokens=640000 (ledger) pr=#100 ultra/integration-${raceId}-a`,
  )
  ok('(q) the scorecard is keyed by runId; each entry names its drive status, fix rounds and tokens')
}

// --- (r) the CLI entry: the printout the operator actually adopts from ------

{
  const { raceId, evidenceDir, judgeDeps, args } = await stageRace([
    { status: 'gate-green', fixRounds: 1, ledger: 700_000, reported: 700_000, elapsedMs: 4_020_000 },
    { status: 'gate-green', fixRounds: 0, ledger: 800_000, reported: 800_000, elapsedMs: 3_600_000 },
    { status: 'parked', fixRounds: 0, ledger: 10_000, reported: 10_000, elapsedMs: 600_000 },
  ])
  const { deps, lines } = makeDeps()
  const { verdict } = await main(['judge', ...args], { ...deps, ...judgeDeps })
  assert.equal(verdict.winner, `${raceId}-b`)
  assert.equal(verdict.decidingStage, STAGES.fixRounds)

  assert.equal(lines[0], `race ${raceId}: winner ${raceId}-b — decided by ${STAGES.fixRounds}`)
  assert.deepEqual(lines.slice(1, 4), Object.values(verdict.scorecard).map(scorecardLine))
  assert.equal(lines.at(-1), `verdict appended to ${raceManifestPath(evidenceDir, raceId)}`)
  // Every contestant gets a line, winner and losers alike.
  for (const runId of Object.keys(verdict.scorecard)) {
    assert.ok(lines.some((line) => line.startsWith(`${runId}:`)), `${runId} has no scorecard line`)
  }
  assert.ok(!lines.join('\n').includes('fake-token'), 'the token must never be printed')
  ok('(r) `judge <raceId>` prints the winner, the deciding stage and every runId’s scorecard line')
}

// --- (r2) the refusal is a non-zero exit of the real process, not a log line -

{
  const { raceId, evidenceDir } = await stageRace([
    { status: 'gate-green', fixRounds: 0, ledger: 100_000, reported: 100_000 },
    null,
  ])
  // No injection at all here: fixtures on disk, no drive, no network, no git,
  // and the refusal lands before any store read, so nothing calls sqlite3.
  const proc = spawnSync('node', [RACE_MJS, 'judge', raceId, '--evidence-dir', evidenceDir], { encoding: 'utf8' })
  assert.equal(proc.status, 1, proc.stdout + proc.stderr)
  assert.match(proc.stderr, /refuses/)
  assert.ok(proc.stderr.includes(`${raceId}-b`), proc.stderr)
  assert.equal(readRaceManifest(evidenceDir, raceId).verdict, undefined)
  ok('(r2) the CLI exits non-zero on a missing gate-read, naming the run that never reported')
}

// --- judge-arg parsing ------------------------------------------------------

{
  const parsed = parseJudgeArgs(['race-99', '--force', '--evidence-dir', '/tmp/ev'])
  assert.deepEqual(parsed, { raceId: 'race-99', force: true, evidenceDir: '/tmp/ev' })
  assert.equal(parseJudgeArgs(['race-99']).force, false)
  assert.equal(parseJudgeArgs(['race-99']).evidenceDir, '/home/exedev/fleet-evidence')
  assert.throws(() => parseJudgeArgs([]), /expects exactly <raceId>/)
  assert.throws(() => parseJudgeArgs(['race-99', 'race-98']), /expects exactly <raceId>/)
  assert.throws(() => parseJudgeArgs(['race-99', '--bogus', 'x']), /unknown flag --bogus/)
  assert.throws(() => parseJudgeArgs(['race-99', '--evidence-dir']), /--evidence-dir needs a value/)
  assert.match(usage(), /judge <raceId> \[--force\]/)
  ok('judge takes exactly <raceId> plus --force/--evidence-dir; anything else refuses with the usage line')
}

fs.rmSync(TMP, { recursive: true, force: true })
console.log(`\nALL TESTS PASSED (${passed})`)
