// fleet/tests/test_race.mjs — #511 attempt racing v1, the launch verb.
//
// The Proof legs of the launch task, in order: (a) the manifest records the
// stub rev-parse output and carries the pre-registered dials; (b) the manifest
// exists at the moment of the FIRST drive call (pre-registration is the whole
// mechanism — dials chosen after results are visible are not dials);
// (c) exactly K drives, overlapping in flight; (d) runId/port/dbDir/repoDir
// pairwise distinct, IDs `<raceId>-a/-b/-c`, each repoDir cloned at
// baseCommit; (e) options come from the REAL buildDriveOptions, so drive-one
// defaults survive; (f) a suffixed runId never equals its own raceId;
// (g) a drive rejection is a fast failure; (h) the CLI flag path reaches
// launchRace with the parsed k and raceId.
//
// Plus the precondition the per-run clones made the launcher's own: the plan
// must exist at the recorded base commit and match any working-tree copy,
// refused BEFORE the first clone — `driveOne`'s #337 preflight cannot see it
// from inside a clone detached at that commit.
//
// Then the judge verb's Proof legs (a)-(i): the refusal on a missing gate read
// and what `--force` does instead, each rubric stage deciding in turn, the
// `reported`-token fallback, the FAILED race that merges nothing, the dials
// surviving the append byte-identically, and the CLI printout.
//
// No live drive, no network, no git remote: `driveOne` and every git call are
// injected (the `deps` pattern of test_drive_one.mjs). The judge's sqlite
// access rides the same seam — `readStore` is injected, so no store, no
// `sqlite3` binary and no fleet.db is ever touched.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  DEFAULT_K,
  DIALS,
  RUBRIC,
  SUFFIXES,
  allocateRuns,
  assertPlanCommittedAtBase,
  countFixRounds,
  gateDetailPath,
  gateReadPath,
  judgeRace,
  launchRace,
  main,
  manifestPath,
  parseJudgeArgs,
  parseLaunchArgs,
  prLine,
  readRaceManifest,
  resolvePlan,
  scorecardLine,
  selectWinner,
  usage,
} from '../race.mjs'
import { DEFAULTS, buildDriveOptions, parseArgs } from '../drive-one.mjs'

let passed = 0
const ok = (label) => {
  passed += 1
  console.log(`ok - ${label}`)
}

const BASE_COMMIT = '4f1c0de9b2a37c5e8d10a6b4f9c3e27d5a8b1c60'
const LAUNCHED_AT_MS = 1_756_684_800_000 // fixed clock — the manifest is asserted whole
const CLOCK = () => LAUNCHED_AT_MS

const tmpDir = (tag) => fs.mkdtempSync(path.join(os.tmpdir(), `fleet-race-${tag}-`))

// A git runner that records every call and never touches a repository. `clone`
// creates the destination so the harness can prove a repoDir exists; nothing
// else needs to happen on disk.
// `planAtBase` models the plan's presence at the recorded commit: a string is
// the committed blob (`cat-file -e` succeeds, `show` returns it), null means
// absent (`cat-file -e` exits non-zero, as the real runner surfaces it).
const makeGit = ({
  originUrl = 'https://github.com/example/repo.git',
  head = BASE_COMMIT,
  planAtBase = '# committed plan\n',
} = {}) => {
  const calls = []
  const git = async (args, { cwd } = {}) => {
    calls.push({ args, cwd })
    if (args[0] === 'rev-parse') return `${head}\n`
    if (args[0] === 'cat-file') {
      if (planAtBase === null) throw new Error(`race: git ${args.join(' ')} failed — Not a valid object name`)
      return ''
    }
    if (args[0] === 'show') {
      if (planAtBase === null) throw new Error(`race: git ${args.join(' ')} failed — Not a valid object name`)
      return planAtBase
    }
    if (args[0] === 'remote' && args[1] === 'get-url') {
      if (originUrl === null) throw new Error('no origin')
      return `${originUrl}\n`
    }
    if (args[0] === 'clone') fs.mkdirSync(args[2], { recursive: true })
    return ''
  }
  return { git, calls }
}

// K stubs that resolve only once all K have STARTED: if the launcher awaited
// each drive in turn, the first would never resolve and the test would hang.
const makeConcurrentDrive = (k, { result = (opts) => ({ read: { runId: opts.runId } }) } = {}) => {
  const calls = []
  let observe = () => undefined
  let release
  const allStarted = new Promise((resolve) => {
    release = resolve
  })
  const drive = async (opts) => {
    calls.push(opts)
    observe(opts)
    if (calls.length === k) release()
    await allStarted
    return result(opts)
  }
  return {
    drive,
    calls,
    onStart: (fn) => {
      observe = fn
    },
  }
}

const deps = (extra = {}) => ({
  readToken: () => '  fake-oauth-token  \n',
  exec: async () => ({ code: 0, stdout: '', stderr: '' }),
  clock: CLOCK,
  progressSink: () => {},
  ...extra,
})

// --- parseLaunchArgs -------------------------------------------------------

{
  const p = parseLaunchArgs(['docs/plan.md', 'race-48', '--k', '3'])
  assert.equal(p.planPath, 'docs/plan.md')
  assert.equal(p.raceId, 'race-48')
  assert.equal(p.runId, 'race-48', 'the raceId rides the drive-one positional, so it inherits #211 grammar')
  assert.equal(p.k, 3)
  // Everything else is drive-one's, untouched.
  assert.equal(p.port, DEFAULTS.port)
  assert.equal(p.dbDir, DEFAULTS.dbDir)
  assert.equal(p.evidenceDir, DEFAULTS.evidenceDir)
  assert.equal(p.prBase, DEFAULTS.prBase)

  assert.equal(parseLaunchArgs(['p.md', 'race-48']).k, DEFAULT_K)
  assert.equal(DEFAULT_K, 3, 'K = 3 for the first race (spec decision summary)')

  // Drive-one passthrough flags survive alongside --k, in any order.
  const q = parseLaunchArgs(['--port', '9100', 'p.md', 'race-49', '--k', '2', '--pr-base', 'release/9'])
  assert.equal(q.port, 9100)
  assert.equal(q.k, 2)
  assert.equal(q.prBase, 'release/9')

  assert.throws(() => parseLaunchArgs(['p.md', 'race-48', '--k']), /--k needs a value/)
  assert.throws(() => parseLaunchArgs(['p.md', 'race-48', '--k', '1']), /--k must be an integer between 2 and 26/)
  assert.throws(() => parseLaunchArgs(['p.md', 'race-48', '--k', '2.5']), /--k must be an integer/)
  assert.throws(() => parseLaunchArgs(['p.md', 'race-48', '--k', '27']), /--k must be an integer between 2 and 26/)
  assert.throws(() => parseLaunchArgs(['p.md', 'race 48', '--k', '3']), /#211/)
  assert.throws(() => parseLaunchArgs(['p.md', 'race-48', '--bogus', 'x']), /unknown flag --bogus/)
  assert.match(usage(), /node fleet\/race\.mjs launch <plan\.md> <raceId>/)
  ok('parseLaunchArgs owns --k and hands everything else to drive-one, grammar included')
}

// --- (d)/(f) allocation ----------------------------------------------------

{
  const runs = allocateRuns({ raceId: 'race-48', k: 3, port: 8180, dbDir: '/tmp/fleet-orch-live' })
  assert.deepEqual(runs, [
    { runId: 'race-48-a', port: 8180, dbDir: '/tmp/fleet-orch-live-a', repoDir: '/tmp/fleet-orch-live-a-repo' },
    { runId: 'race-48-b', port: 8181, dbDir: '/tmp/fleet-orch-live-b', repoDir: '/tmp/fleet-orch-live-b-repo' },
    { runId: 'race-48-c', port: 8182, dbDir: '/tmp/fleet-orch-live-c', repoDir: '/tmp/fleet-orch-live-c-repo' },
  ])
  for (const field of ['runId', 'port', 'dbDir', 'repoDir']) {
    const seen = runs.map((r) => r[field])
    assert.equal(new Set(seen).size, runs.length, `${field} must be pairwise distinct: ${seen.join(', ')}`)
  }
  // (f) The decidable half of the never-reuse convention (spec finding 12): a
  // suffixed ID can never equal the raceId it was derived from.
  for (const run of runs) assert.notEqual(run.runId, 'race-48')
  // Each allocated ID is still a legal drive-one runId (#211).
  for (const run of runs) assert.equal(parseArgs(['p.md', run.runId]).runId, run.runId)
  assert.equal(SUFFIXES.slice(0, 3).join(''), 'abc')
  ok('(d)(f) IDs/ports/db-dirs/repo-dirs are pairwise distinct; a suffixed ID never equals its raceId')
}

// --- (a)(b)(c)(d)(e) the launch itself -------------------------------------

{
  const evidenceDir = path.join(tmpDir('ev'), 'nested-evidence') // created by launch
  const argv = [
    'docs/plan.md', 'race-48', '--k', '3',
    '--evidence-dir', evidenceDir, '--port', '9200',
    '--db-dir', path.join(tmpDir('db'), 'store'),
  ]
  const parsed = parseLaunchArgs(argv)

  const { git, calls: gitCalls } = makeGit()
  const stub = makeConcurrentDrive(3)
  // (b) Pre-registration: sample the manifest AS IT LOOKS at each drive start.
  const manifestAtStart = []
  stub.onStart(() => {
    const p = manifestPath(evidenceDir, 'race-48')
    manifestAtStart.push(fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null)
  })

  const d = deps({ git, drive: stub.drive })
  const { manifest, results } = await launchRace(argv, d)

  // (a) The manifest, asserted whole — schema, base commit and dials together.
  const expectedRuns = allocateRuns({ raceId: 'race-48', k: 3, port: parsed.port, dbDir: parsed.dbDir })
  assert.deepEqual(manifest, {
    raceId: 'race-48',
    planPath: 'docs/plan.md',
    baseCommit: BASE_COMMIT,
    k: 3,
    launchedAt: new Date(LAUNCHED_AT_MS).toISOString(),
    runs: expectedRuns,
    dials: DIALS,
  })
  assert.deepEqual(gitCalls[0], { args: ['rev-parse', 'HEAD'], cwd: parsed.repoDir })
  assert.deepEqual(readRaceManifest(evidenceDir, 'race-48'), manifest, 'the file round-trips to the returned manifest')
  assert.equal(
    manifestPath(evidenceDir, 'race-48'),
    path.join(evidenceDir, 'race-race-48.json'),
    'the manifest name is raceId-qualified — the shared evidence dir clobbers unqualified names (#323)',
  )
  ok('(a) the manifest records the rev-parse base commit and the pre-registered dials')

  // (b) Every drive saw the finished manifest — including the first.
  assert.equal(manifestAtStart.length, 3)
  for (const seen of manifestAtStart) {
    assert.ok(seen !== null, 'the manifest must exist before the first driveOne call')
    assert.deepEqual(JSON.parse(seen).dials, DIALS, 'the dials were pre-registered, not chosen after results')
  }
  ok('(b) the manifest is on disk before the first drive starts — dials are pre-registered')

  // (c) Exactly K, and all K were in flight together: the stubs only resolve
  // once the third has started, so a sequential launcher would deadlock.
  assert.equal(stub.calls.length, 3)
  assert.deepEqual(results, [
    { read: { runId: 'race-48-a' } },
    { read: { runId: 'race-48-b' } },
    { read: { runId: 'race-48-c' } },
  ])
  ok('(c) exactly K drives, overlapping in flight')

  // (d) Distinct identities, and each repoDir was cloned at baseCommit.
  assert.deepEqual(
    stub.calls.map((o) => ({ runId: o.runId, port: o.port, dbDir: o.dbDir, repoDir: o.repoDir })),
    expectedRuns,
  )
  for (const run of expectedRuns) {
    assert.deepEqual(
      gitCalls.filter((c) => c.args[0] === 'clone' && c.args[2] === run.repoDir),
      [{ args: ['clone', parsed.repoDir, run.repoDir], cwd: undefined }],
      `${run.repoDir} must be cloned exactly once from the launch checkout`,
    )
    assert.deepEqual(
      gitCalls.filter((c) => c.cwd === run.repoDir && c.args[0] === 'checkout'),
      [{ args: ['checkout', '--detach', BASE_COMMIT], cwd: run.repoDir }],
      `${run.repoDir} must be checked out at the recorded base commit`,
    )
    assert.deepEqual(
      gitCalls.filter((c) => c.cwd === run.repoDir && c.args[0] === 'remote'),
      [{ args: ['remote', 'set-url', 'origin', 'https://github.com/example/repo.git'], cwd: run.repoDir }],
      "the clone pushes to the launch checkout's origin, not to a filesystem path",
    )
    assert.ok(fs.existsSync(run.repoDir), 'the clone runner produced the repo dir')
  }
  ok('(d) each repoDir is a fresh clone detached at baseCommit, origin re-pointed (spec finding 6)')

  // (e) The options come from the REAL buildDriveOptions: the overrides are
  // EXACTLY runId/port/dbDir/repoDir/progressLog and nothing else drifts.
  const baseline = buildDriveOptions(parsed, { readToken: d.readToken, exec: d.exec })
  const OVERRIDDEN = new Set(['runId', 'port', 'dbDir', 'repoDir', 'progressLog'])
  for (const opts of stub.calls) {
    assert.deepEqual(
      new Set(Object.keys(opts)),
      new Set([...Object.keys(baseline), 'progressLog']),
      "the option shape is drive-one's plus progressLog",
    )
    for (const key of Object.keys(opts)) {
      if (OVERRIDDEN.has(key)) continue
      assert.deepEqual(opts[key], baseline[key], `${key} must survive the race untouched`)
    }
    // Named explicitly: a drive-one default and the token seam.
    assert.equal(opts.prBase, 'main')
    assert.equal(opts.ttlMs, DEFAULTS.ttlHours * 60 * 60 * 1000)
    assert.equal(opts.evidenceDir, evidenceDir)
    assert.equal(opts.engineEnv.CLAUDE_CODE_OAUTH_TOKEN, 'fake-oauth-token')
    assert.equal(opts.exec, d.exec)
    assert.equal(typeof opts.progressLog, 'function')
  }
  ok('(e) options are built through the real buildDriveOptions; overrides are exactly the five')

  // The runId-prefixed progressLog (spec finding 11): three interleaved drives
  // stay attributable on one stderr.
  const lines = []
  const attributed = await launchRace(
    argv.map((a) => (a === 'race-48' ? 'race-50' : a)),
    deps({
      git: makeGit().git,
      drive: async (opts) => {
        opts.progressLog('watch: pending')
        return { read: {} }
      },
      progressSink: (line) => lines.push(line),
    }),
  )
  assert.equal(attributed.manifest.raceId, 'race-50')
  assert.deepEqual(lines, ['[race-50-a] watch: pending', '[race-50-b] watch: pending', '[race-50-c] watch: pending'])
  ok('progressLog is runId-prefixed, so interleaved drives stay attributable (finding 11)')
}

// --- (g) a drive rejection is a fast failure -------------------------------

{
  const evidenceDir = tmpDir('fail')
  const argv = [
    'docs/plan.md', 'race-51', '--k', '3',
    '--evidence-dir', evidenceDir, '--db-dir', path.join(tmpDir('db'), 'store'),
  ]
  const boom = new Error('driveOne: provisionRun failed for race-51-b (#337-adjacent operator error)')
  await assert.rejects(
    launchRace(
      argv,
      deps({
        git: makeGit().git,
        drive: async (opts) => {
          if (opts.runId === 'race-51-b') throw boom
          return { read: {} }
        },
      }),
    ),
    /provisionRun failed/,
  )
  // The manifest still landed: pre-registration precedes the drives, so a
  // failed race is a recorded race.
  assert.equal(readRaceManifest(evidenceDir, 'race-51').k, 3)
  ok('(g) a driveOne rejection propagates as a fast failure, manifest already recorded')
}

// A git precondition failure refuses before any drive runs.
{
  const evidenceDir = tmpDir('nogit')
  const argv = ['p.md', 'race-52', '--evidence-dir', evidenceDir, '--db-dir', path.join(tmpDir('db'), 'store')]
  const drives = []
  await assert.rejects(
    launchRace(
      argv,
      deps({
        git: async (args) => {
          if (args[0] === 'rev-parse') throw new Error('race: git rev-parse HEAD failed — not a git repository')
          return ''
        },
        drive: async (o) => {
          drives.push(o)
          return { read: {} }
        },
      }),
    ),
    /rev-parse HEAD failed/,
  )
  assert.deepEqual(drives, [])
  assert.equal(fs.existsSync(manifestPath(evidenceDir, 'race-52')), false)
  ok('a failed base-commit read refuses before any manifest or drive')
}

{
  const evidenceDir = tmpDir('badsha')
  const argv = ['p.md', 'race-53', '--evidence-dir', evidenceDir, '--db-dir', path.join(tmpDir('db'), 'store')]
  await assert.rejects(
    launchRace(argv, deps({ git: makeGit({ head: 'HEAD' }).git, drive: async () => ({ read: {} }) })),
    /not a commit sha/,
  )
  ok('a rev-parse output that is not a sha refuses rather than being recorded as the base')
}

// --- the plan must be committed AT the recorded base, checked before anything
// --- is spent (the delegation finding 6's per-run clones made unreachable) ---

{
  assert.deepEqual(resolvePlan('/repo', 'docs/plan.md'), {
    planFile: '/repo/docs/plan.md',
    planRel: 'docs/plan.md',
  })
  assert.deepEqual(resolvePlan('/repo', '/repo/docs/plan.md'), {
    planFile: '/repo/docs/plan.md',
    planRel: 'docs/plan.md',
  })
  ok('resolvePlan resolves the plan the way drive.mjs does — the two never disagree about which file')
}

// Absent at baseCommit: the operator wrote the plan but never committed it.
// An unraced `drive-one` refuses before provisioning; the race must too, or it
// burns K clones and K sandbox provisions on a commit carrying no such plan.
{
  const evidenceDir = tmpDir('uncommitted')
  const argv = [
    'docs/plans/foo.md', 'race-56', '--k', '3',
    '--evidence-dir', evidenceDir, '--db-dir', path.join(tmpDir('db'), 'store'),
  ]
  const { git, calls } = makeGit({ planAtBase: null })
  const drives = []
  await assert.rejects(
    launchRace(argv, deps({ git, drive: async (o) => { drives.push(o); return { read: {} } } })),
    /race: plan docs\/plans\/foo\.md does not exist at 4f1c0de.*#337/s,
  )
  assert.deepEqual(calls.map((c) => c.args[0]), ['rev-parse', 'cat-file'], 'nothing past the check ran')
  assert.deepEqual(
    calls.filter((c) => c.args[0] === 'clone'),
    [],
    'the refusal must precede the first clone — K clones is the cost of learning it late',
  )
  assert.deepEqual(drives, [], 'and no drive: no sandbox provision is spent on a plan the sandbox never gets')
  assert.equal(fs.existsSync(manifestPath(evidenceDir, 'race-56')), false)
  ok('an uncommitted plan refuses before any clone, manifest or drive (#337, the launcher owns it)')
}

// Dirty: the plan exists at the base commit but the working-tree copy differs.
// In a clone detached at that commit the two texts are equal by construction,
// so driveOne's own preflight cannot see this either.
{
  const repoDir = tmpDir('dirtyrepo')
  fs.mkdirSync(path.join(repoDir, 'docs'), { recursive: true })
  fs.writeFileSync(path.join(repoDir, 'docs', 'plan.md'), '# edited, not committed\n')
  const evidenceDir = tmpDir('dirty')
  const argv = [
    'docs/plan.md', 'race-57', '--k', '2', '--repo-dir', repoDir,
    '--evidence-dir', evidenceDir, '--db-dir', path.join(tmpDir('db'), 'store'),
  ]
  const { git, calls } = makeGit({ planAtBase: '# committed plan\n' })
  const drives = []
  await assert.rejects(
    launchRace(argv, deps({ git, drive: async (o) => { drives.push(o); return { read: {} } } })),
    /race: plan docs\/plan\.md differs between .*#337/s,
  )
  assert.deepEqual(calls.map((c) => c.args[0]), ['rev-parse', 'cat-file', 'show'])
  assert.deepEqual(drives, [])
  assert.equal(fs.existsSync(manifestPath(evidenceDir, 'race-57')), false)
  ok('a working-tree edit over the committed plan refuses before any clone, manifest or drive (#337)')
}

// The same repo with the working copy matching the committed bytes races.
{
  const repoDir = tmpDir('cleanrepo')
  fs.mkdirSync(path.join(repoDir, 'docs'), { recursive: true })
  fs.writeFileSync(path.join(repoDir, 'docs', 'plan.md'), '# committed plan\n')
  const evidenceDir = tmpDir('clean')
  const argv = [
    'docs/plan.md', 'race-58', '--k', '2', '--repo-dir', repoDir,
    '--evidence-dir', evidenceDir, '--db-dir', path.join(tmpDir('db'), 'store'),
  ]
  const { git, calls } = makeGit({ planAtBase: '# committed plan\n' })
  const { manifest } = await launchRace(argv, deps({ git, drive: async () => ({ read: {} }) }))
  assert.equal(manifest.k, 2)
  const kinds = calls.map((c) => c.args[0])
  assert.ok(
    kinds.indexOf('cat-file') < kinds.indexOf('clone'),
    'the check is a precondition of cloning, not a step beside it',
  )
  assert.deepEqual(
    calls.find((c) => c.args[0] === 'cat-file'),
    { args: ['cat-file', '-e', `${BASE_COMMIT}:docs/plan.md`], cwd: repoDir },
    'the plan is checked at the RECORDED commit, in the launch checkout',
  )
  ok('a committed, unedited plan passes the precondition and the race proceeds')
}

// #362's lesson: a path that fails the repo-path guard is refused AS a path
// problem, never reported as an uncommitted plan.
{
  const evidenceDir = tmpDir('badpath')
  const argv = [
    '../outside.md', 'race-59', '--evidence-dir', evidenceDir, '--db-dir', path.join(tmpDir('db'), 'store'),
  ]
  const { git, calls } = makeGit()
  await assert.rejects(
    launchRace(argv, deps({ git, drive: async () => ({ read: {} }) })),
    /fails the repo-path guard.*#362/s,
  )
  assert.deepEqual(calls.map((c) => c.args[0]), ['rev-parse'], 'refused before the plan is even looked up')
  ok('a plan path escaping the repo is refused as a path problem, not read as uncommitted (#362)')
}

// The precondition standing alone, both refusals and the absent-locally pass.
{
  const repoDir = tmpDir('unit')
  const call = (planAtBase) =>
    assertPlanCommittedAtBase({
      git: makeGit({ planAtBase }).git,
      repoDir,
      planPath: 'docs/plan.md',
      baseCommit: BASE_COMMIT,
    })
  await assert.rejects(call(null), /does not exist at/)
  // No local copy at all: the clones carry the committed text and that is the
  // text the race is about — nothing to disagree with, so no refusal.
  await call('# committed plan\n')
  ok('assertPlanCommittedAtBase refuses an absent plan and passes when only the committed copy exists')
}

// An origin-less checkout still races: the clone simply keeps no origin url.
{
  const evidenceDir = tmpDir('noorigin')
  const dbDir = path.join(tmpDir('db'), 'store')
  const argv = ['p.md', 'race-54', '--k', '2', '--evidence-dir', evidenceDir, '--db-dir', dbDir]
  const { git, calls } = makeGit({ originUrl: null })
  const { manifest } = await launchRace(argv, deps({ git, drive: async () => ({ read: {} }) }))
  assert.equal(manifest.k, 2)
  assert.deepEqual(calls.filter((c) => c.args[0] === 'remote' && c.args[1] === 'set-url'), [])
  ok("a checkout with no origin still races; the publish leg is driveOne's to report")
}

// --- (h) the CLI flag path -------------------------------------------------

{
  const evidenceDir = tmpDir('cli')
  const dbDir = path.join(tmpDir('db'), 'store')
  const stub = makeConcurrentDrive(3)
  const lines = []
  const { manifest, results } = await main(
    ['launch', 'docs/plan.md', 'race-55', '--k', '3', '--evidence-dir', evidenceDir, '--db-dir', dbDir],
    deps({ git: makeGit().git, drive: stub.drive, log: (l) => lines.push(l) }),
  )
  assert.equal(manifest.raceId, 'race-55')
  assert.equal(manifest.k, 3)
  assert.equal(results.length, 3)
  assert.deepEqual(stub.calls.map((o) => o.runId), ['race-55-a', 'race-55-b', 'race-55-c'])
  assert.deepEqual(readRaceManifest(evidenceDir, 'race-55'), manifest)
  assert.equal(lines[0], `race race-55: 3 runs of docs/plan.md at ${BASE_COMMIT}`)
  assert.equal(lines[1], `  race-55-a port=8180 db-dir=${dbDir}-a repo-dir=${dbDir}-a-repo`)
  assert.equal(lines[4], `manifest: ${manifestPath(evidenceDir, 'race-55')}`)
  // No token value ever reaches a printed line.
  assert.ok(!lines.join('\n').includes('fake-oauth-token'), 'the token must never be printed')
  ok('(h) `launch <plan> <raceId> --k 3` reaches launchRace with k=3 and that raceId')

  await assert.rejects(main(['merge', 'race-55'], deps()), /unknown verb "merge"/)
  await assert.rejects(main([], deps()), /unknown verb ""/)
  ok('an unknown verb refuses with the usage line')
}

// --- the dials block is a pinned, frozen pre-registration ------------------

{
  assert.ok(Object.isFrozen(DIALS), 'the dials block must not be mutable at launch time')
  assert.deepEqual(Object.keys(DIALS).sort(), [
    'baseline',
    'comparatorDecisiveness',
    'nOfOne',
    'perRun',
    'raceWall',
    'totalTokens',
    'winnerDefectSurface',
  ])
  // Race wall's derivation is fixed HERE (spec finding 13) so it is computed
  // the way it was pre-registered, not the way the reader later prefers.
  assert.match(DIALS.raceWall, /launch timestamp -> max\(per-run elapsedMs end\)/)
  assert.deepEqual(DIALS.baseline, {
    'run-44': { wallMinutes: 79, tokens: 287_692, fixRounds: 0 },
    'run-45': { wallMinutes: 62, tokens: 232_635, fixRounds: 1, planTracedDefects: 2 },
    'run-47': { wallMinutes: 79, tokens: 239_564, fixRounds: 1, planTracedDefects: 1 },
  })
  ok('the pre-registered dials carry the spec baseline and the fixed race-wall derivation')
}

// ===========================================================================
// The judge verb.
// ===========================================================================

// A trimmed MergeableStore, the shape status.mjs's own test pins: every node
// [value, hlc, hash]. The judge reads it through the injected `readStore`, so
// no sqlite3 and no fleet.db is involved.
const stamped = (v) => [v, 'P0Q-hlc', 12345]
const storeWithLabels = (runId, labels) => {
  const events = {}
  labels.forEach((label, i) => {
    events[`${runId}:01AA${String(i).padStart(2, '0')}`] = stamped({
      kind: stamped(i % 2 === 0 ? 'worker:start' : 'worker:end'),
      label: stamped(label),
      ts: stamped(1_788_245_813_225 + i),
      runId: stamped(runId),
    })
  })
  return [[{ events: stamped(events), runs: stamped({}) }, {}], 'hlc', 0]
}

// A finished race on disk: the launch task's manifest, plus each run's
// `gate-read-<runId>.json` / `.detail.json` — every one of them pre-existing
// input the judge only reads.
const makeRaceFixture = ({ raceId, specs }) => {
  const evidenceDir = tmpDir('judge-ev')
  const dbDir = path.join(tmpDir('judge-db'), 'store')
  const runs = allocateRuns({ raceId, k: specs.length, port: 8180, dbDir })
  const manifest = {
    raceId,
    planPath: 'docs/plan.md',
    baseCommit: BASE_COMMIT,
    k: specs.length,
    launchedAt: new Date(LAUNCHED_AT_MS).toISOString(),
    runs,
    dials: DIALS,
  }
  fs.mkdirSync(evidenceDir, { recursive: true })
  fs.writeFileSync(manifestPath(evidenceDir, raceId), `${JSON.stringify(manifest, null, 2)}\n`)

  const stores = {}
  runs.forEach((run, i) => {
    const spec = specs[i]
    stores[run.dbDir] = storeWithLabels(run.runId, spec.labels ?? [])
    if (spec.absent) return
    const read = {
      o1: spec.status === 'gate-green',
      receiptsResolvable: true,
      leaseContinuity: true,
      versionStamp: true,
      spendObservational: {
        reported: spec.reported === undefined ? null : spec.reported,
        ledger: spec.ledger === undefined ? null : spec.ledger,
      },
    }
    const detail = {
      runId: run.runId,
      planPath: 'docs/plan.md',
      status: spec.status,
      elapsedMs: spec.elapsedMs === undefined ? 1000 : spec.elapsedMs,
      pullRequest: spec.pullRequest ?? null,
    }
    fs.writeFileSync(gateReadPath(evidenceDir, run.runId), `${JSON.stringify(read, null, 2)}\n`)
    fs.writeFileSync(gateDetailPath(evidenceDir, run.runId), `${JSON.stringify(detail, null, 2)}\n`)
  })

  return {
    raceId,
    evidenceDir,
    runs,
    manifest,
    deps: { readStore: (dir) => stores[dir] ?? null },
    argv: (...extra) => [raceId, '--evidence-dir', evidenceDir, ...extra],
  }
}

// --- parseJudgeArgs --------------------------------------------------------

{
  const p = parseJudgeArgs(['race-48', '--evidence-dir', '/ev', '--force'])
  assert.deepEqual(p, { raceId: 'race-48', evidenceDir: '/ev', force: true })
  assert.equal(parseJudgeArgs(['race-48']).force, false)
  assert.equal(parseJudgeArgs(['race-48']).evidenceDir, DEFAULTS.evidenceDir)
  assert.throws(() => parseJudgeArgs([]), /judge expects exactly <raceId>/)
  assert.throws(() => parseJudgeArgs(['race-48', 'race-49']), /judge expects exactly <raceId>/)
  assert.throws(() => parseJudgeArgs(['race 48']), /#211/)
  assert.throws(() => parseJudgeArgs(['race-48', '--k', '3']), /unknown flag --k/)
  assert.throws(() => parseJudgeArgs(['race-48', '--evidence-dir']), /--evidence-dir needs a value/)
  assert.match(usage(), /node fleet\/race\.mjs judge <raceId>/)
  ok('parseJudgeArgs owns <raceId>, --evidence-dir and --force, and nothing else')
}

// --- (a) the refusal, and what --force does instead -------------------------

{
  const f = makeRaceFixture({
    raceId: 'race-60',
    specs: [
      { status: 'gate-green', ledger: 500_000, labels: ['fix:1:2', 'fix:1:2'] },
      { status: 'gate-green', ledger: 400_000, labels: ['impl:1', 'impl:1'] },
      { absent: true },
    ],
  })
  assert.throws(
    () => judgeRace(f.argv(), f.deps),
    /race: judge race-60 refuses — no gate read for race-60-c\b.*not terminal.*--force/s,
    'the refusal must name the run whose gate read is missing',
  )
  assert.equal(
    readRaceManifest(f.evidenceDir, 'race-60').verdict,
    undefined,
    'a refusal writes nothing — the manifest carries no verdict',
  )

  const verdict = judgeRace(f.argv('--force'), f.deps)
  assert.deepEqual(Object.keys(verdict), ['winner', 'decidingStage', 'scorecard'])
  assert.deepEqual(Object.keys(verdict.scorecard), ['race-60-a', 'race-60-b', 'race-60-c'])
  assert.equal(verdict.scorecard['race-60-c'].status, 'no-record')
  assert.equal(verdict.scorecard['race-60-c'].reported, false)
  assert.equal(verdict.scorecard['race-60-c'].gateGreen, false)
  assert.equal(verdict.scorecard['race-60-c'].verdict, 'lost', 'no record is an automatic loss')
  assert.equal(verdict.scorecard['race-60-c'].fixRounds, null)
  assert.equal(verdict.scorecard['race-60-c'].tokens, null)
  // The reporters were scored normally: b ran no fix round, a ran one.
  assert.equal(verdict.winner, 'race-60-b')
  assert.equal(verdict.decidingStage, RUBRIC.fixRounds)
  assert.equal(verdict.scorecard['race-60-a'].fixRounds, 1)
  assert.equal(verdict.scorecard['race-60-b'].fixRounds, 0)
  // An absentee has no ledger BY DEFINITION; it must not drag the reporters
  // onto the `reported` fallback.
  assert.equal(verdict.scorecard['race-60-a'].tokenBasis, 'ledger')
  assert.equal(verdict.scorecard['race-60-a'].tokenFallback, false)
  ok('(a) judge refuses on a missing gate read; --force scores the reporters and marks the rest no-record')
}

// --- (b) the gate-green filter ---------------------------------------------

{
  const f = makeRaceFixture({
    raceId: 'race-61',
    specs: [
      { status: 'parked', ledger: 100_000, labels: [] },
      { status: 'gate-green', ledger: 900_000, labels: ['fix:1:2', 'fix:2:2', 'fix:3:2'] },
      { status: 'failed', ledger: 50_000, labels: [] },
    ],
  })
  const verdict = judgeRace(f.argv(), f.deps)
  // The green run loses BOTH later stages and still wins: the filter is first.
  assert.equal(verdict.winner, 'race-61-b')
  assert.equal(verdict.decidingStage, RUBRIC.green)
  assert.equal(verdict.decidingStage, 'gate-green-filter')
  assert.deepEqual(
    Object.values(verdict.scorecard).map((e) => [e.status, e.verdict]),
    [['parked', 'lost'], ['gate-green', 'winner'], ['failed', 'lost']],
  )
  ok('(b) the sole gate-green run beats parked and failed ones; decidingStage is the filter')
}

// --- (c) fewest fix rounds --------------------------------------------------

{
  const f = makeRaceFixture({
    raceId: 'race-62',
    specs: [
      { status: 'gate-green', ledger: 100_000, labels: ['fix:1:2', 'fix:1:2'] },
      { status: 'gate-green', ledger: 900_000, labels: ['impl:1'] },
    ],
  })
  const verdict = judgeRace(f.argv(), f.deps)
  // b spent 9x the tokens and still wins: fix rounds are ranked above tokens.
  assert.equal(verdict.winner, 'race-62-b')
  assert.equal(verdict.decidingStage, RUBRIC.fixRounds)
  assert.equal(verdict.decidingStage, 'fix-rounds')
  assert.equal(verdict.scorecard['race-62-a'].fixRounds, 1)
  assert.equal(verdict.scorecard['race-62-b'].fixRounds, 0)
  ok('(c) among two greens the fewer fix ROUNDS wins; decidingStage names the fix-round stage')
}

// --- (d) fewest ledger tokens, and the `reported` fallback ------------------

{
  const f = makeRaceFixture({
    raceId: 'race-63',
    specs: [
      { status: 'gate-green', ledger: 700_000, reported: 10, labels: ['fix:1:2'] },
      { status: 'gate-green', ledger: 300_000, reported: 999_999, labels: ['fix:2:2'] },
    ],
  })
  const verdict = judgeRace(f.argv(), f.deps)
  assert.equal(verdict.winner, 'race-63-b')
  assert.equal(verdict.decidingStage, RUBRIC.tokens)
  assert.equal(verdict.decidingStage, 'tokens')
  // `ledger`, not `reported`: a's reported is far smaller and it still loses.
  assert.equal(verdict.scorecard['race-63-b'].tokens, 300_000)
  assert.equal(verdict.scorecard['race-63-b'].tokenBasis, 'ledger')
  assert.equal(verdict.scorecard['race-63-a'].tokenFallback, false)
  ok('(d) among fix-round ties the fewer `ledger` tokens wins; decidingStage names the token stage')
}

{
  // One null ledger: BOTH contestants switch to `reported`, and the switch is
  // flagged. Under `ledger` a would win (300k vs null); under `reported` b does.
  const f = makeRaceFixture({
    raceId: 'race-64',
    specs: [
      { status: 'gate-green', ledger: 300_000, reported: 900_000, labels: ['fix:1:2'] },
      { status: 'gate-green', ledger: undefined, reported: 100_000, labels: ['fix:2:2'] },
    ],
  })
  const verdict = judgeRace(f.argv(), f.deps)
  assert.equal(verdict.winner, 'race-64-b')
  assert.equal(verdict.decidingStage, 'tokens')
  assert.deepEqual(
    Object.values(verdict.scorecard).map((e) => [e.runId, e.tokens, e.tokenBasis, e.tokenFallback]),
    [
      ['race-64-a', 900_000, 'reported', true],
      ['race-64-b', 100_000, 'reported', true],
    ],
    'one null ledger moves EVERY contestant to reported, flagged on every entry',
  )
  ok('(d) a null ledger falls back to `reported` for all contestants and flags it in the scorecard')
}

// --- (e) the lexicographic tie-break ---------------------------------------

{
  const f = makeRaceFixture({
    raceId: 'race-65',
    specs: [
      { status: 'gate-green', ledger: 500_000, labels: ['fix:1:2'] },
      { status: 'gate-green', ledger: 500_000, labels: ['fix:9:2'] },
      { status: 'gate-green', ledger: 500_000, labels: ['fix:4:2'] },
    ],
  })
  const verdict = judgeRace(f.argv(), f.deps)
  assert.equal(verdict.winner, 'race-65-a')
  assert.equal(verdict.decidingStage, RUBRIC.runId)
  assert.equal(verdict.decidingStage, 'runId-lexicographic')
  assert.deepEqual(
    Object.values(verdict.scorecard).map((e) => e.verdict),
    ['winner', 'lost', 'lost'],
  )
  // The stage is recorded precisely so a tie-broken race is not read as a
  // decisive comparator (spec §Measurement, comparatorDecisiveness).
  assert.equal(readRaceManifest(f.evidenceDir, 'race-65').verdict.decidingStage, 'runId-lexicographic')
  ok('(e) among full ties the lexicographic-least runId wins; decidingStage names the tie-break')
}

// --- (f) zero greens: the race FAILED --------------------------------------

{
  const f = makeRaceFixture({
    raceId: 'race-66',
    specs: [
      {
        status: 'parked',
        ledger: 100_000,
        labels: [],
        pullRequest: { number: 71, url: 'https://github.com/example/repo/pull/71', draft: true, branch: 'ultra/integration-a' },
      },
      {
        status: 'failed',
        ledger: 200_000,
        labels: [],
        pullRequest: { number: 72, url: 'https://github.com/example/repo/pull/72', draft: true, branch: 'ultra/integration-b' },
      },
      { status: 'parked', ledger: 300_000, labels: [] },
    ],
  })
  const verdict = judgeRace(f.argv(), f.deps)
  assert.equal(verdict.winner, null, 'a failed race names no winner')
  assert.equal(verdict.decidingStage, RUBRIC.none)
  assert.equal(verdict.decidingStage, 'no-gate-green')
  assert.deepEqual(Object.values(verdict.scorecard).map((e) => e.verdict), ['lost', 'lost', 'lost'])

  const lines = []
  await main(['judge', ...f.argv()], { ...f.deps, log: (l) => lines.push(l) })
  assert.equal(lines[0], 'race race-66: FAILED — no gate-green run; merge nothing')
  assert.equal(lines[1], 'deciding stage: no-gate-green')
  assert.equal(lines[5], 'open PRs for the operator to close (3):')
  assert.deepEqual(lines.slice(6, 9), [
    '  race-66-a pr=#71 branch=ultra/integration-a url=https://github.com/example/repo/pull/71',
    '  race-66-b pr=#72 branch=ultra/integration-b url=https://github.com/example/repo/pull/72',
    '  race-66-c pr=none branch=none url=none',
  ])
  assert.equal(lines[9], `verdict: ${manifestPath(f.evidenceDir, 'race-66')}`)
  ok('(f) zero greens reports FAILED, names no winner, and lists the K PRs for the operator to close')
}

// --- (g) the pre-registered dials survive the append byte-identically -------

{
  const f = makeRaceFixture({
    raceId: 'race-67',
    specs: [
      { status: 'gate-green', ledger: 100_000, labels: [] },
      { status: 'parked', ledger: 200_000, labels: [] },
    ],
  })
  const file = manifestPath(f.evidenceDir, 'race-67')
  const before = fs.readFileSync(file, 'utf8')
  // The literal bytes of the `dials` block, brace-walked out of the file — no
  // dials value contains a brace, so the walk is exact.
  const dialsBytes = (text) => {
    const start = text.indexOf('  "dials": {')
    assert.ok(start > 0, 'the manifest must carry a dials block')
    let depth = 0
    for (let i = start; i < text.length; i += 1) {
      if (text[i] === '{') depth += 1
      else if (text[i] === '}' && (depth -= 1) === 0) return text.slice(start, i + 1)
    }
    throw new Error('unterminated dials block')
  }

  const verdict = judgeRace(f.argv(), f.deps)
  const after = fs.readFileSync(file, 'utf8')
  assert.equal(dialsBytes(after), dialsBytes(before), 'every pre-registered dials value is byte-identical')

  const reread = readRaceManifest(f.evidenceDir, 'race-67')
  assert.deepEqual(reread.dials, DIALS)
  assert.deepEqual(reread.verdict, verdict, 'the verdict is what the judge returned')
  const { verdict: appended, ...preRegistered } = reread
  assert.deepEqual(preRegistered, JSON.parse(before), 'the append disturbs nothing that was already there')
  assert.deepEqual(Object.keys(reread), ['raceId', 'planPath', 'baseCommit', 'k', 'launchedAt', 'runs', 'dials', 'verdict'])
  assert.ok(appended !== undefined)
  ok('(g) the appended verdict leaves every pre-registered dials value byte-identical')
}

// --- (h) the scorecard shape ------------------------------------------------

{
  const f = makeRaceFixture({
    raceId: 'race-68',
    specs: [
      {
        status: 'gate-green',
        ledger: 588_000,
        reported: 600_000,
        elapsedMs: 4_020_000,
        labels: ['fix:1:2'],
        pullRequest: { number: 80, url: 'https://github.com/example/repo/pull/80', draft: false, branch: 'ultra/integration-a' },
      },
      { status: 'parked', ledger: 728_000, reported: 730_000, elapsedMs: 3_960_000, labels: [] },
    ],
  })
  const verdict = judgeRace(f.argv(), f.deps)
  assert.deepEqual(Object.keys(verdict.scorecard), ['race-68-a', 'race-68-b'], 'keyed by runId')
  assert.deepEqual(verdict.scorecard['race-68-a'], {
    runId: 'race-68-a',
    reported: true,
    status: 'gate-green',
    gateGreen: true,
    fixRounds: 1,
    tokens: 588_000,
    tokenBasis: 'ledger',
    tokenFallback: false,
    elapsedMs: 4_020_000,
    pullRequest: { number: 80, url: 'https://github.com/example/repo/pull/80', draft: false, branch: 'ultra/integration-a' },
    verdict: 'winner',
  })
  assert.deepEqual(verdict.scorecard['race-68-b'], {
    runId: 'race-68-b',
    reported: true,
    status: 'parked',
    gateGreen: false,
    fixRounds: 0,
    tokens: 728_000,
    tokenBasis: 'ledger',
    tokenFallback: false,
    elapsedMs: 3_960_000,
    pullRequest: null,
    verdict: 'lost',
  })
  ok('(h) the scorecard is keyed by runId; each entry names its drive status, fix rounds and tokens')
}

// --- the pieces of the rubric, standing alone ------------------------------

{
  const store = storeWithLabels('run-9', ['impl:1', 'fix:1:2', 'fix:1:2', 'review:1'])
  assert.equal(countFixRounds(store, 'run-9'), 1, 'one fix ROUND: only the worker:start row of a `fix:` label counts')
  assert.equal(countFixRounds(store, 'run-8'), 0, "another run's events never leak in")
  assert.equal(countFixRounds(null, 'run-9'), null, 'an unreadable store is an unknown count, not zero')

  // An unknown count loses its comparison rather than winning it.
  const entry = (runId, over) => ({ runId, gateGreen: true, fixRounds: 1, tokens: 10, ...over })
  assert.deepEqual(selectWinner([entry('r-a', { fixRounds: null }), entry('r-b')]), {
    winner: 'r-b',
    decidingStage: 'fix-rounds',
  })
  assert.deepEqual(selectWinner([entry('r-a', { tokens: null }), entry('r-b')]), {
    winner: 'r-b',
    decidingStage: 'tokens',
  })
  assert.deepEqual(selectWinner([entry('r-a', { gateGreen: false })]), {
    winner: null,
    decidingStage: 'no-gate-green',
  })
  ok('an unreadable store or a missing token total loses its stage instead of winning it')
}

// --- (i) the CLI entry ------------------------------------------------------

{
  const f = makeRaceFixture({
    raceId: 'race-69',
    specs: [
      { status: 'gate-green', ledger: 500_000, labels: ['fix:1:2', 'fix:1:2'] },
      { status: 'gate-green', ledger: 400_000, labels: ['impl:1'] },
      { status: 'parked', ledger: 300_000, labels: [] },
    ],
  })
  const lines = []
  const verdict = await main(['judge', ...f.argv()], { ...f.deps, log: (l) => lines.push(l) })
  assert.equal(verdict.winner, 'race-69-b')
  assert.deepEqual(lines, [
    'race race-69: winner race-69-b',
    'deciding stage: fix-rounds',
    '  race-69-a status=gate-green fix-rounds=1 tokens=500000 (ledger) verdict=lost',
    '  race-69-b status=gate-green fix-rounds=0 tokens=400000 (ledger) verdict=winner',
    '  race-69-c status=parked fix-rounds=0 tokens=300000 (ledger) verdict=lost',
    `verdict: ${manifestPath(f.evidenceDir, 'race-69')}`,
  ])
  // A winning race prints no PR list: adoption of the winner is the operator's,
  // and the judge has nothing to hand back for the losers to be closed by hand.
  assert.equal(lines.filter((l) => l.startsWith('open PRs')).length, 0)
  assert.deepEqual(readRaceManifest(f.evidenceDir, 'race-69').verdict, verdict)
  // The line renderers, pinned whole.
  assert.equal(
    scorecardLine(verdict.scorecard['race-69-a']),
    '  race-69-a status=gate-green fix-rounds=1 tokens=500000 (ledger) verdict=lost',
  )
  assert.equal(prLine(verdict.scorecard['race-69-c']), '  race-69-c pr=none branch=none url=none')
  ok('(i) `judge <raceId>` prints the winner, the deciding stage and every runId’s scorecard line')
}

{
  // A `reported`-basis scorecard line says so, so the reader never mistakes a
  // fallback comparison for a ledger one.
  const f = makeRaceFixture({
    raceId: 'race-70',
    specs: [
      { status: 'gate-green', reported: 900_000, labels: [] },
      { status: 'gate-green', reported: 100_000, labels: [] },
    ],
  })
  const lines = []
  await main(['judge', ...f.argv()], { ...f.deps, log: (l) => lines.push(l) })
  assert.deepEqual(lines.slice(0, 4), [
    'race race-70: winner race-70-b',
    'deciding stage: tokens',
    '  race-70-a status=gate-green fix-rounds=0 tokens=900000 (reported, ledger-fallback) verdict=lost',
    '  race-70-b status=gate-green fix-rounds=0 tokens=100000 (reported, ledger-fallback) verdict=winner',
  ])
  ok('the printed scorecard line flags a `reported`-basis comparison as the fallback it is')
}

// The same CLI entry, refusing. Both in-process (the rejection) and as a real
// process (the non-zero exit an operator sees), with no store, no sqlite3 and
// no network involved — the refusal precedes every read but the gate reads.
{
  const f = makeRaceFixture({
    raceId: 'race-71',
    specs: [{ status: 'gate-green', ledger: 100_000, labels: [] }, { absent: true }],
  })
  await assert.rejects(
    main(['judge', ...f.argv()], { ...f.deps, log: () => {} }),
    /no gate read for race-71-b/,
    'the CLI refusal names the missing run',
  )
  assert.equal(readRaceManifest(f.evidenceDir, 'race-71').verdict, undefined)

  const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'race.mjs')
  const proc = spawnSync(process.execPath, [cli, 'judge', ...f.argv()], { encoding: 'utf8' })
  assert.notEqual(proc.status, 0, 'a refusal must exit non-zero')
  assert.match(proc.stderr, /race: judge race-71 refuses — no gate read for race-71-b/)
  assert.equal(proc.stdout, '', 'nothing is printed as if it were a verdict')
  assert.equal(readRaceManifest(f.evidenceDir, 'race-71').verdict, undefined)

  // …and `--force` through the same process is a scored race.
  const forced = spawnSync(process.execPath, [cli, 'judge', ...f.argv('--force')], { encoding: 'utf8' })
  assert.equal(forced.status, 0, forced.stderr)
  assert.match(forced.stdout, /^race race-71: winner race-71-a$/m)
  assert.match(forced.stdout, /^ {2}race-71-b status=no-record fix-rounds=null tokens=null verdict=lost$/m)
  assert.equal(readRaceManifest(f.evidenceDir, 'race-71').verdict.winner, 'race-71-a')
  ok('(i) the CLI exits non-zero with a refusal naming the missing run, and --force scores the rest')
}


console.log(`\nALL TESTS PASSED (${passed})`)
