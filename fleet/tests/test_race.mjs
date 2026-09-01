// fleet/tests/test_race.mjs — #511 attempt racing v1, the launch verb.
//
// A race is K whole runs of one committed plan, driven concurrently from one
// process. What has to be true before any of that is worth measuring: the
// dials are written down BEFORE the results exist, the K identities cannot
// collide (runId, port, db-dir and — spec finding 6 — repo-dir), and the
// per-run options come off `drive-one.mjs`'s seam rather than a second
// hand-typed copy of the drive constants.
//
// No live drive, no network, no git remote: `driveOne` and every git
// subprocess are injected, as in test_drive_one.mjs.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { REPO_DIR, buildDriveOptions, parseArgs } from '../drive-one.mjs'
import {
  DIALS,
  allocateRuns,
  launchRace,
  main,
  parseLaunchArgs,
  raceManifestPath,
  readRaceManifest,
  runIdFor,
  usage,
} from '../race.mjs'

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

fs.rmSync(TMP, { recursive: true, force: true })
console.log(`\nALL TESTS PASSED (${passed})`)
