// fleet/tests/test_race.mjs — #511 attempt racing v1, the launch verb.
//
// `race.mjs launch <plan> <raceId> --k 3` is the #454 launch shape committed
// once: one plan, K concurrent `driveOne` runs with distinct runId, port,
// db-dir and repo-dir, and a raceId-qualified manifest written BEFORE any
// drive starts so the pre-registered dials cannot be chosen after the results
// are visible.
//
// No live drive, no network, no git remote: `driveOne` and every git
// subprocess (rev-parse, remote get-url/set-url, clone, checkout) ride injected
// seams, exactly as test_drive_one.mjs injects the token reader. The only bytes
// this file writes are the manifests, under fs.mkdtemp dirs it removes at the end.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  DEFAULT_K,
  DIALS,
  RUN_SUFFIXES,
  launchRace,
  main,
  parseRaceArgs,
  raceManifestPath,
  readRaceManifest,
  usage,
} from '../race.mjs'
import { DEFAULTS, buildDriveOptions, parseArgs } from '../drive-one.mjs'

let passed = 0
const ok = (label) => {
  passed += 1
  console.log(`ok - ${label}`)
}

const BASE_SHA = '5f2a9c0d1e3b4a6c8d9e0f1a2b3c4d5e6f708192'
const LAUNCH_CHECKOUT = '/tmp/fleet-race-launch-checkout'
// What the launch checkout's own `origin` points at — the https remote
// drive.mjs's publish leg pushes to and `gh pr create` reads the repo from.
const ORIGIN_URL = 'https://github.com/example/fleet.git'
const TOKEN = 'stub-oauth-token'
const LAUNCHED_AT = '2026-09-01T12:00:00.000Z'

const temps = []
const tmpdir = (tag) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `race-${tag}-`))
  temps.push(dir)
  return dir
}

// A watchdog: the drive stub below only resolves once all K calls are in
// flight, so a sequential launch would hang the suite. Name the failure.
const within = (promise, ms, label) =>
  Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(label)), ms).unref()
    }),
  ])

// Records every git call; answers rev-parse with the fixed base sha and
// `remote get-url origin` with the launch checkout's https remote. Nothing is
// cloned, nothing is checked out, no repo is touched.
const stubGit = ({ originUrl = ORIGIN_URL } = {}) => {
  const calls = []
  const run = async (args, { cwd } = {}) => {
    calls.push({ args, cwd })
    if (args[0] === 'rev-parse') return { code: 0, stdout: `${BASE_SHA}\n`, stderr: '' }
    if (args[0] === 'remote' && args[1] === 'get-url') {
      return originUrl === null
        ? { code: 2, stdout: '', stderr: "error: No such remote 'origin'" }
        : { code: 0, stdout: `${originUrl}\n`, stderr: '' }
    }
    return { code: 0, stdout: '', stderr: '' }
  }
  return { calls, run }
}

// A driveOne stub that resolves only once all K calls have STARTED — the
// overlap-in-flight proof — while recording the options it was handed and
// whether the manifest was already on disk when it was called.
const stubDrive = ({ k = 3, manifestPath, failRunId } = {}) => {
  const state = { calls: [], manifestSeen: [], maxInFlight: 0 }
  let inFlight = 0
  let started = 0
  let release
  const allStarted = new Promise((resolve) => {
    release = resolve
  })
  state.drive = async (opts) => {
    state.calls.push(opts)
    if (manifestPath) state.manifestSeen.push(fs.existsSync(manifestPath))
    inFlight += 1
    state.maxInFlight = Math.max(state.maxInFlight, inFlight)
    started += 1
    if (started >= k) release()
    await allStarted
    inFlight -= 1
    if (failRunId && opts.runId === failRunId) throw new Error(`drive blew up: ${opts.runId}`)
    return { read: { runId: opts.runId, status: 'gate-green' }, reportPath: `/tmp/gate-read-${opts.runId}.json` }
  }
  return state
}

const stubDeps = ({ drive, git, log = () => {} }) => ({
  drive,
  git,
  now: () => LAUNCHED_AT,
  log,
  readToken: () => `  ${TOKEN}  \n`,
  exec: async () => ({ code: 0, stdout: '', stderr: '' }),
})

// --- parseRaceArgs: --k is race.mjs's own flag, everything else passes through

{
  assert.equal(parseRaceArgs(['p.md', 'run-48']).k, DEFAULT_K)
  assert.equal(DEFAULT_K, 3)
  const parsed = parseRaceArgs(['p.md', 'run-48', '--k', '5', '--port', '9000'])
  assert.equal(parsed.k, 5)
  assert.deepEqual(parsed.driveArgv, ['p.md', 'run-48', '--port', '9000'])
  assert.throws(() => parseRaceArgs(['p.md', 'r', '--k']), /--k needs a value/)
  assert.throws(() => parseRaceArgs(['p.md', 'r', '--k', '--port']), /--k needs a value/)
  assert.throws(() => parseRaceArgs(['p.md', 'r', '--k', 'three']), /--k must be an integer/)
  assert.throws(() => parseRaceArgs(['p.md', 'r', '--k', '0']), /--k must be an integer/)
  assert.throws(() => parseRaceArgs(['p.md', 'r', '--k', '2.5']), /--k must be an integer/)
  assert.throws(() => parseRaceArgs(['p.md', 'r', '--k', String(RUN_SUFFIXES.length + 1)]), /--k must be an integer/)
  // Drive-one's own refusals still bite: --k is consumed, nothing else is.
  assert.throws(() => parseRaceArgs(['p.md', 'r', '--bogus', 'x']).driveArgv && parseArgs(parseRaceArgs(['p.md', 'r', '--bogus', 'x']).driveArgv), /unknown flag --bogus/)
  ok('--k is race.mjs\'s only added flag; the rest of argv is drive-one\'s')
}

// --- launch: the manifest, the allocation, the overlap ---------------------

{
  const evidenceDir = tmpdir('launch')
  const raceId = 'run-48'
  const manifestPath = raceManifestPath(evidenceDir, raceId)
  const git = stubGit()
  const drive = stubDrive({ k: 3, manifestPath })
  const argv = [
    'docs/plans/boring.md', raceId, '--k', '3',
    '--evidence-dir', evidenceDir, '--port', '8300',
    '--db-dir', '/tmp/race-store', '--repo-dir', LAUNCH_CHECKOUT,
  ]
  const lines = []
  const { manifest, results } = await within(
    launchRace(argv, stubDeps({ drive: drive.drive, git: git.run, log: (l) => lines.push(l) })),
    10_000,
    'the K drives never overlapped in flight — launchRace awaited them one at a time',
  )

  // (a) the manifest: every field of the shared schema, exactly.
  assert.deepEqual(manifest, {
    raceId: 'run-48',
    planPath: 'docs/plans/boring.md',
    baseCommit: BASE_SHA,
    k: 3,
    launchedAt: LAUNCHED_AT,
    runs: [
      { runId: 'run-48-a', port: 8300, dbDir: '/tmp/race-store-a', repoDir: '/tmp/race-store-a-repo' },
      { runId: 'run-48-b', port: 8301, dbDir: '/tmp/race-store-b', repoDir: '/tmp/race-store-b-repo' },
      { runId: 'run-48-c', port: 8302, dbDir: '/tmp/race-store-c', repoDir: '/tmp/race-store-c-repo' },
    ],
    dials: DIALS,
  })
  assert.ok(Object.keys(DIALS).length > 0, 'the pre-registered dials block must not be empty')
  assert.deepEqual(readRaceManifest(evidenceDir, raceId), manifest)
  assert.equal(path.basename(manifestPath), 'race-run-48.json', 'the manifest name is raceId-qualified (#323)')
  ok('(a) launch writes race-<raceId>.json: base commit from rev-parse, dials pre-registered')

  // (b) pre-registration is mechanical, not a comment: the file was already on
  // disk at the moment of EVERY stub drive call, the first one included.
  assert.deepEqual(drive.manifestSeen, [true, true, true])
  ok('(b) the manifest exists before the first driveOne call')

  // (c) exactly K, and all K in flight at once.
  assert.equal(drive.calls.length, 3)
  assert.equal(drive.maxInFlight, 3)
  assert.deepEqual(results.map((r) => r.read.runId), ['run-48-a', 'run-48-b', 'run-48-c'])
  ok('(c) driveOne is called exactly K times and the calls overlap in flight')

  // (d) allocation: pairwise distinct on every axis, and each repoDir is a
  // clone of the launch checkout parked at the recorded base commit.
  for (const key of ['runId', 'port', 'dbDir', 'repoDir']) {
    assert.equal(new Set(drive.calls.map((o) => o[key])).size, 3, `${key} must be distinct per run`)
    assert.deepEqual(drive.calls.map((o) => o[key]), manifest.runs.map((r) => r[key]))
  }
  assert.deepEqual(git.calls, [
    { args: ['rev-parse', 'HEAD'], cwd: LAUNCH_CHECKOUT },
    { args: ['remote', 'get-url', 'origin'], cwd: LAUNCH_CHECKOUT },
    { args: ['clone', LAUNCH_CHECKOUT, '/tmp/race-store-a-repo'], cwd: LAUNCH_CHECKOUT },
    { args: ['remote', 'set-url', 'origin', ORIGIN_URL], cwd: '/tmp/race-store-a-repo' },
    { args: ['checkout', '--detach', BASE_SHA], cwd: '/tmp/race-store-a-repo' },
    { args: ['clone', LAUNCH_CHECKOUT, '/tmp/race-store-b-repo'], cwd: LAUNCH_CHECKOUT },
    { args: ['remote', 'set-url', 'origin', ORIGIN_URL], cwd: '/tmp/race-store-b-repo' },
    { args: ['checkout', '--detach', BASE_SHA], cwd: '/tmp/race-store-b-repo' },
    { args: ['clone', LAUNCH_CHECKOUT, '/tmp/race-store-c-repo'], cwd: LAUNCH_CHECKOUT },
    { args: ['remote', 'set-url', 'origin', ORIGIN_URL], cwd: '/tmp/race-store-c-repo' },
    { args: ['checkout', '--detach', BASE_SHA], cwd: '/tmp/race-store-c-repo' },
  ])
  ok('(d) runId/port/dbDir/repoDir are pairwise distinct; each repoDir is cloned at baseCommit (spec finding 6)')

  // The remote, not just the contents. `git clone <localpath>` sets the clone's
  // `origin` to that path; drive.mjs's frozen publish leg pushes to `origin` and
  // then runs `gh pr create` there (fleet/drive.mjs:1383-1394), so an unrepointed
  // clone would push every run's branch back into the operator's launch checkout
  // and open no PR at all. Every clone must be repointed at the launch
  // checkout's own origin BEFORE the drive that will push through it starts.
  for (const run of manifest.runs) {
    const cloneAt = git.calls.findIndex((c) => c.args[0] === 'clone' && c.args[2] === run.repoDir)
    const repointAt = git.calls.findIndex(
      (c) => c.cwd === run.repoDir && c.args[0] === 'remote' && c.args[1] === 'set-url')
    assert.ok(cloneAt >= 0 && repointAt > cloneAt, `${run.repoDir}: origin must be repointed after its clone`)
    assert.deepEqual(git.calls[repointAt].args, ['remote', 'set-url', 'origin', ORIGIN_URL])
    assert.notEqual(git.calls[repointAt].args[3], LAUNCH_CHECKOUT, 'origin must not stay the launch checkout')
  }
  // Read once from the launch checkout, not K times from the clones.
  assert.equal(git.calls.filter((c) => c.args[1] === 'get-url').length, 1)
  ok('each clone\'s origin is repointed at the launch checkout\'s own remote, so the publish leg pushes to GitHub')

  // (e) the options come through the REAL buildDriveOptions: the drive-one
  // defaults survive and the overrides are exactly the five.
  const baseline = buildDriveOptions(
    parseArgs(['docs/plans/boring.md', raceId, '--evidence-dir', evidenceDir, '--port', '8300', '--db-dir', '/tmp/race-store', '--repo-dir', LAUNCH_CHECKOUT]),
    { readToken: () => `  ${TOKEN}  \n`, exec: drive.calls[0].exec },
  )
  const first = drive.calls[0]
  assert.equal(first.prBase, DEFAULTS.prBase)
  assert.equal(first.githubTokenPath, DEFAULTS.githubTokenPath)
  assert.equal(first.ttlMs, 4 * 60 * 60 * 1000)
  assert.equal(first.heartbeatTimeoutMs, 30 * 60_000)
  assert.equal(first.evidenceDir, evidenceDir)
  assert.equal(first.engineEnv.CLAUDE_CODE_OAUTH_TOKEN, TOKEN)
  assert.deepEqual(
    Object.keys(first).filter((key) => !(key in baseline)),
    ['progressLog'],
    'launch adds exactly one option drive-one does not build: the attributable progress log',
  )
  // Union across the K calls: run `a` inherits the base port, so only the set
  // of keys ANY run moves says what launch actually overrides.
  const overridden = new Set()
  for (const call of drive.calls) {
    for (const key of Object.keys(baseline)) {
      const mine = call[key]
      const theirs = baseline[key]
      const moved = typeof mine === 'function' || typeof theirs === 'function'
        ? mine !== theirs
        : JSON.stringify(mine) !== JSON.stringify(theirs)
      if (moved) overridden.add(key)
    }
  }
  assert.deepEqual([...overridden].sort(), ['dbDir', 'port', 'repoDir', 'runId'])
  first.progressLog('sandbox up')
  assert.deepEqual(lines, ['[race run-48 run-48-a] sandbox up'])
  ok('(e) options are built through buildDriveOptions; only runId/port/dbDir/repoDir/progressLog differ')

  // (f) the decidable half of the never-reuse convention (#211, finding 12).
  for (const run of manifest.runs) {
    assert.notEqual(run.runId, raceId, 'a suffixed runId must never equal its own raceId')
    assert.match(run.runId, /^[A-Za-z0-9][A-Za-z0-9-]*$/, 'a runId is a clean token (#211)')
    assert.equal(parseArgs(['p.md', run.runId]).runId, run.runId, 'drive-one must accept the allocated runId')
  }
  ok('(f) a suffixed runId is a legal drive-one runId and never equals its own raceId')

  // The token rode engineEnv and nothing else: not argv, not the manifest,
  // not a printed line.
  assert.ok(!fs.readFileSync(manifestPath, 'utf8').includes(TOKEN), 'the manifest must never hold a token')
  assert.ok(!lines.join('\n').includes(TOKEN), 'no printed line may hold a token')
  assert.ok(!argv.includes(TOKEN))
  ok('the OAuth token stays in engineEnv — never the manifest, never a printed line')
}

// --- k=1: the allocation degenerates cleanly -------------------------------

{
  const evidenceDir = tmpdir('k1')
  const git = stubGit()
  const drive = stubDrive({ k: 1 })
  const { manifest } = await within(
    launchRace(['p.md', 'run-49', '--k', '1', '--evidence-dir', evidenceDir], stubDeps({ drive: drive.drive, git: git.run })),
    10_000,
    'k=1 launch hung',
  )
  assert.equal(manifest.k, 1)
  assert.deepEqual(manifest.runs.map((r) => r.runId), ['run-49-a'])
  assert.equal(manifest.runs[0].port, DEFAULTS.port)
  assert.equal(manifest.runs[0].dbDir, `${DEFAULTS.dbDir}-a`)
  assert.equal(drive.calls.length, 1)
  ok('k=1 allocates one suffixed run off the drive-one defaults')
}

// --- (g) a drive rejection is a fast failure -------------------------------

{
  const evidenceDir = tmpdir('fail')
  const git = stubGit()
  const drive = stubDrive({ k: 3, failRunId: 'run-50-b' })
  await assert.rejects(
    within(
      launchRace(['p.md', 'run-50', '--k', '3', '--evidence-dir', evidenceDir], stubDeps({ drive: drive.drive, git: git.run })),
      10_000,
      'the failing launch never settled',
    ),
    /drive blew up: run-50-b/,
  )
  // The manifest still stands: a failed race is evidence, not a rollback.
  assert.equal(readRaceManifest(evidenceDir, 'run-50').k, 3)
  ok('(g) a driveOne rejection propagates out of launchRace as a fast failure')
}

// A git failure refuses before any drive starts.
{
  const evidenceDir = tmpdir('gitfail')
  const drive = stubDrive({ k: 3 })
  const git = async (args) => {
    if (args[0] === 'clone') return { code: 128, stdout: '', stderr: 'fatal: destination path exists' }
    if (args[0] === 'remote') return { code: 0, stdout: `${ORIGIN_URL}\n`, stderr: '' }
    return { code: 0, stdout: `${BASE_SHA}\n`, stderr: '' }
  }
  await assert.rejects(
    launchRace(['p.md', 'run-51', '--evidence-dir', evidenceDir], stubDeps({ drive: drive.drive, git })),
    /git clone .* failed \(128\).*destination path exists/s,
  )
  assert.equal(drive.calls.length, 0, 'no drive may start once a clone failed')
  ok('a failed clone refuses the race before any drive starts')
}

// A launch checkout with no `origin` refuses before anything is cloned: the
// clones would silently inherit it as their remote and no PR could ever open.
{
  const evidenceDir = tmpdir('noorigin')
  const drive = stubDrive({ k: 3 })
  const git = stubGit({ originUrl: null })
  await assert.rejects(
    launchRace(['p.md', 'run-53', '--evidence-dir', evidenceDir, '--repo-dir', LAUNCH_CHECKOUT],
      stubDeps({ drive: drive.drive, git: git.run })),
    /has no `origin` remote.*no PR would open/s,
  )
  assert.equal(drive.calls.length, 0, 'no drive may start without a publishable origin')
  assert.equal(git.calls.filter((c) => c.args[0] === 'clone').length, 0, 'nothing is cloned once origin is missing')
  assert.ok(!fs.existsSync(raceManifestPath(evidenceDir, 'run-53')), 'no manifest is pre-registered for a race that cannot publish')
  ok('a launch checkout with no origin refuses the race before any clone')
}

// --- (h) the CLI entry: the flag path, not just the direct call ------------

{
  const evidenceDir = tmpdir('cli')
  const git = stubGit()
  const drive = stubDrive({ k: 3 })
  const { manifest } = await within(
    main(['launch', 'docs/plans/boring.md', 'run-52', '--k', '3', '--evidence-dir', evidenceDir, '--repo-dir', LAUNCH_CHECKOUT],
      stubDeps({ drive: drive.drive, git: git.run })),
    10_000,
    'the CLI launch verb hung',
  )
  assert.equal(manifest.k, 3)
  assert.equal(manifest.raceId, 'run-52')
  assert.equal(manifest.planPath, 'docs/plans/boring.md')
  assert.equal(drive.calls.length, 3)
  assert.deepEqual(drive.calls.map((o) => o.runId), ['run-52-a', 'run-52-b', 'run-52-c'])
  assert.deepEqual(readRaceManifest(evidenceDir, 'run-52'), manifest)
  ok('(h) `launch <plan> <raceId> --k 3` reaches launchRace through the flag path')
}

{
  await assert.rejects(main([], {}), /unknown verb|usage/)
  await assert.rejects(main(['sprint', 'p.md', 'r'], {}), /unknown verb sprint/)
  assert.match(usage(), /node fleet\/race\.mjs launch <plan\.md> <raceId>/)
  ok('the CLI names its verbs and refuses anything else')
}

for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true })

console.log(`\nALL TESTS PASSED (${passed})`)
