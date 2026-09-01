// fleet/tests/test_race.mjs — #511 attempt racing v1, the launch and judge verbs.
//
// `race.mjs launch <plan> <raceId> --k 3` is the #454 launch shape committed
// once: one plan, K concurrent `driveOne` runs with distinct runId, port,
// db-dir and repo-dir, and a raceId-qualified manifest written BEFORE any
// drive starts so the pre-registered dials cannot be chosen after the results
// are visible. `race.mjs judge <raceId>` is the ordered rubric over what those
// runs left behind — read-only but for the verdict it appends to the manifest.
//
// No live drive, no network, no git remote, no sqlite: `driveOne`, every git
// subprocess (rev-parse, remote get-url/set-url, clone, checkout) and the
// judge's store read ride injected seams, exactly as test_drive_one.mjs injects
// the token reader. The only bytes this file writes are the manifests and the
// fixture gate reads, under fs.mkdtemp dirs it removes at the end.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  DEFAULT_K,
  DIALS,
  NO_RECORD,
  RUN_SUFFIXES,
  STAGES,
  cli,
  countFixRounds,
  judgeRace,
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

// --- the judge verb: rubric, refusal, scorecard, verdict -------------------
//
// Fixtures only: a launch-shaped manifest, per-run gate-read + detail files,
// and a MergeableStore-shaped JSON per run behind the injected store reader.
// No sqlite, no drive, no git — the judge is read-only over artifacts and its
// single write is the verdict it appends to the manifest.

const stamped = (v) => [v, 'P0Q-hlc', 12345]

// A run's store as `status.mjs` reads it: [[tables, values], hlc, hash], every
// node stamped. `fixRounds` fix ROUNDS — and a round is what the engine
// dispatched, not what it logged: run-worker emits `worker:start` AND
// `worker:end` under the one `fix:<taskId>:<iter>` label, so the fixture emits
// both. `unpairedRounds` many of the last rounds get only their `worker:start`
// (the sandbox died mid-worker), which is exactly the case that makes an
// event count non-uniform across runs. Plus one non-fix event and one SIBLING
// run's fix event that must never be counted against this run.
const runStore = (runId, fixRounds, unpairedRounds = 0) => {
  const events = {
    [`${runId}:01AAA`]: stamped({ kind: stamped('worker:start'), label: stamped('impl:1'), ts: stamped(1), runId: stamped(runId) }),
    'other-run:01AZZ': stamped({ kind: stamped('worker:end'), label: stamped('fix:x:9'), ts: stamped(9), runId: stamped('other-run') }),
  }
  for (let i = 0; i < fixRounds; i += 1) {
    const label = `fix:t${i}:1`
    events[`${runId}:01AB${i}s`] = stamped({
      kind: stamped('worker:start'), label: stamped(label), ts: stamped(2 + i * 2), runId: stamped(runId),
    })
    if (i < fixRounds - unpairedRounds) {
      events[`${runId}:01AB${i}e`] = stamped({
        kind: stamped('worker:end'), label: stamped(label), ts: stamped(3 + i * 2), runId: stamped(runId),
      })
    }
  }
  return [[{ events: stamped(events), runs: stamped({}) }, {}], 'hlc', 0]
}

// Fix rounds are counted by distinct label, not by event. Two runs that each
// dispatched three fix rounds must score three — even when one of them lost a
// sandbox after `worker:start` and so logged five labelled events to the
// other's six. Counting events would score them 6 and 5, hand the fix-round
// stage a difference that does not exist, and print a headline `fix` number in
// units the pre-registered `DIALS.baseline[...].fixRounds` was never in.
{
  const paired = runStore('run-fx-a', 3)
  const halfDead = runStore('run-fx-b', 3, 1)
  const labelledEvents = (store, runId) =>
    Object.values(store[0][0].events[0])
      .filter((e) => String(e[0].label[0]).startsWith('fix:') && String(e[0].runId[0]) === runId).length
  assert.equal(labelledEvents(paired, 'run-fx-a'), 6, 'three paired rounds log six labelled events')
  assert.equal(labelledEvents(halfDead, 'run-fx-b'), 5, 'a round that lost its end logs five')
  assert.equal(countFixRounds(paired, 'run-fx-a'), 3)
  assert.equal(countFixRounds(halfDead, 'run-fx-b'), 3, 'an unpaired round is still one round')
  assert.equal(countFixRounds(runStore('run-fx-c', 0), 'run-fx-c'), 0, 'no fix round, no count')
  // A refused worker logs one event under the label and never starts; the
  // round was still dispatched, so it counts once and only once.
  const refused = runStore('run-fx-d', 1, 1)
  refused[0][0].events[0]['run-fx-d:01ARF'] = stamped({
    kind: stamped('worker:refused'), label: stamped('fix:t0:1'), ts: stamped(99), runId: stamped('run-fx-d'),
  })
  assert.equal(countFixRounds(refused, 'run-fx-d'), 1, 'start + refused under one label is one round')
  // The sibling run's `fix:x:9` event sits in every fixture store and is never
  // this run's round.
  assert.equal(countFixRounds(paired, 'other-run'), 1)
  ok('fix rounds count distinct `fix:` labels — start/end/refused under one label is one round')
}

// specs[i] describes run <raceId>-<suffix>: `missing` writes no gate-read at
// all (a non-terminal run), otherwise the pair drive.mjs writes — the read
// (`spendObservational`) and the detail (`status`, `elapsedMs`, `pullRequest`).
const judgeFixture = (raceId, specs) => {
  const evidenceDir = tmpdir('judge')
  const storeRoot = path.join(evidenceDir, 'store')
  const runs = specs.map((_, i) => ({
    runId: `${raceId}-${RUN_SUFFIXES[i]}`,
    port: 8300 + i,
    dbDir: `${storeRoot}-${RUN_SUFFIXES[i]}`,
    repoDir: `${storeRoot}-${RUN_SUFFIXES[i]}-repo`,
  }))
  const manifest = {
    raceId,
    planPath: 'docs/plans/boring.md',
    baseCommit: BASE_SHA,
    k: runs.length,
    launchedAt: LAUNCHED_AT,
    runs,
    dials: DIALS,
  }
  fs.writeFileSync(raceManifestPath(evidenceDir, raceId), `${JSON.stringify(manifest, null, 2)}\n`)
  const stores = {}
  specs.forEach((spec, i) => {
    const run = runs[i]
    stores[run.dbDir] = runStore(run.runId, spec.fixRounds ?? 0)
    if (spec.missing) return
    fs.writeFileSync(path.join(evidenceDir, `gate-read-${run.runId}.json`), `${JSON.stringify({
      o1: spec.status === 'gate-green',
      receiptsResolvable: true,
      leaseContinuity: true,
      versionStamp: true,
      spendObservational: {
        reported: spec.reported === undefined ? null : spec.reported,
        ledger: spec.ledger === undefined ? null : spec.ledger,
      },
    }, null, 2)}\n`)
    fs.writeFileSync(path.join(evidenceDir, `gate-read-${run.runId}.detail.json`), `${JSON.stringify({
      runId: run.runId,
      planPath: 'docs/plans/boring.md',
      status: spec.status,
      elapsedMs: spec.elapsedMs ?? 1000,
      pullRequest: spec.pr === undefined ? null : {
        number: spec.pr,
        url: `https://github.com/example/fleet/pull/${spec.pr}`,
        draft: spec.status !== 'gate-green',
        branch: `ultra/integration-${run.runId}`,
      },
    }, null, 2)}\n`)
  })
  const printed = []
  const errored = []
  const deps = {
    readStore: (dbDir) => {
      if (!(dbDir in stores)) throw new Error(`no store fixture for ${dbDir}`)
      return stores[dbDir]
    },
    print: (line) => printed.push(line),
    printErr: (line) => errored.push(line),
  }
  const argv = (...extra) => [raceId, '--evidence-dir', evidenceDir, ...extra]
  return { evidenceDir, raceId, runs, manifest, deps, printed, errored, argv }
}

// (a) refusal while a run is non-terminal; --force scores the reporters and
// marks the absentee an automatic loss.
{
  const f = judgeFixture('run-60', [
    { status: 'gate-green', fixRounds: 0, ledger: 100_000, reported: 110_000, pr: 11 },
    { status: 'gate-green', fixRounds: 1, ledger: 50_000, reported: 60_000, pr: 12 },
    { missing: true },
  ])
  await assert.rejects(judgeRace(f.argv(), f.deps), /run-60-c/)
  await assert.rejects(judgeRace(f.argv(), f.deps), /--force/)
  assert.ok(!('verdict' in readRaceManifest(f.evidenceDir, 'run-60')), 'a refused judge writes nothing')

  const forced = await judgeRace(f.argv('--force'), f.deps)
  assert.equal(forced.winner, 'run-60-a')
  assert.equal(forced.decidingStage, STAGES.fixRounds)
  assert.deepEqual(forced.scorecard['run-60-c'], {
    driveStatus: NO_RECORD,
    fixRounds: null,
    tokens: null,
    tokenSource: 'ledger',
    tokenFallback: false,
    elapsedMs: null,
    pullRequest: null,
    winner: false,
    notes: ['no gate read — --force scored this run an automatic loss'],
  })
  assert.deepEqual(Object.keys(forced.scorecard), ['run-60-a', 'run-60-b', 'run-60-c'])
  ok('(a) judge refuses while a gate-read is missing; --force scores the reporters and marks the rest no-record')
}

// (b) the filter: the sole gate-green run beats parked and failed.
{
  const f = judgeFixture('run-61', [
    { status: 'parked', fixRounds: 0, ledger: 10_000, pr: 21 },
    { status: 'gate-green', fixRounds: 9, ledger: 900_000, pr: 22 },
    { status: 'failed', fixRounds: 0, ledger: 1_000 },
  ])
  const v = await judgeRace(f.argv(), f.deps)
  assert.equal(v.winner, 'run-61-b')
  assert.equal(v.decidingStage, STAGES.driveStatus)
  assert.deepEqual(
    Object.fromEntries(Object.entries(v.scorecard).map(([id, e]) => [id, e.driveStatus])),
    { 'run-61-a': 'parked', 'run-61-b': 'gate-green', 'run-61-c': 'failed' },
  )
  ok('(b) the sole gate-green run wins on the drive-status filter, however expensive it was')
}

// (c) two greens: fewest fix: events decides.
{
  const f = judgeFixture('run-62', [
    { status: 'gate-green', fixRounds: 2, ledger: 10_000, pr: 31 },
    { status: 'gate-green', fixRounds: 0, ledger: 900_000, pr: 32 },
    { status: 'parked', fixRounds: 0, ledger: 1_000, pr: 33 },
  ])
  const v = await judgeRace(f.argv(), f.deps)
  assert.equal(v.winner, 'run-62-b')
  assert.equal(v.decidingStage, STAGES.fixRounds)
  assert.equal(v.scorecard['run-62-a'].fixRounds, 2)
  assert.equal(v.scorecard['run-62-b'].fixRounds, 0)
  // The sibling run's `fix:` event in the same store is never counted.
  assert.equal(v.scorecard['run-62-c'].fixRounds, 0)
  ok('(c) among greens, fewest fix: rounds wins and names the fix-round stage')
}

// (d) fix-round tie: fewest ledger tokens decides; a null ledger anywhere in
// the contending set falls the whole comparison back to `reported`.
{
  const f = judgeFixture('run-63', [
    { status: 'gate-green', fixRounds: 1, ledger: 700_000, reported: 10, pr: 41 },
    { status: 'gate-green', fixRounds: 1, ledger: 500_000, reported: 20, pr: 42 },
  ])
  const v = await judgeRace(f.argv(), f.deps)
  assert.equal(v.winner, 'run-63-b')
  assert.equal(v.decidingStage, STAGES.tokens)
  assert.equal(v.scorecard['run-63-b'].tokens, 500_000)
  assert.equal(v.scorecard['run-63-b'].tokenSource, 'ledger')
  assert.equal(v.scorecard['run-63-a'].tokenFallback, false)

  // One contestant's ledger is null: both are compared on `reported`, which
  // reverses the winner — and every scorecard entry says so.
  const g = judgeFixture('run-64', [
    { status: 'gate-green', fixRounds: 1, ledger: null, reported: 400_000, pr: 51 },
    { status: 'gate-green', fixRounds: 1, ledger: 300_000, reported: 900_000, pr: 52 },
  ])
  const w = await judgeRace(g.argv(), g.deps)
  assert.equal(w.winner, 'run-64-a')
  assert.equal(w.decidingStage, STAGES.tokens)
  assert.deepEqual(
    Object.entries(w.scorecard).map(([id, e]) => [id, e.tokens, e.tokenSource, e.tokenFallback]),
    [['run-64-a', 400_000, 'reported', true], ['run-64-b', 900_000, 'reported', true]],
  )
  assert.ok(g.printed.some((l) => l.includes('ledger')), 'the fallback is stated on stdout too')
  ok('(d) fix-round ties go to fewest tokens; one null ledger compares `reported` for all and flags it')
}

// (e) everything ties: lexicographic-least runId, and the output says so.
{
  const f = judgeFixture('run-65', [
    { status: 'gate-green', fixRounds: 1, ledger: 500_000, pr: 61 },
    { status: 'gate-green', fixRounds: 1, ledger: 500_000, pr: 62 },
    { status: 'gate-green', fixRounds: 1, ledger: 500_000, pr: 63 },
  ])
  const v = await judgeRace(f.argv(), f.deps)
  assert.equal(v.winner, 'run-65-a')
  assert.equal(v.decidingStage, STAGES.lexicographic)
  assert.equal(f.printed[1], `decided by: ${STAGES.lexicographic}`)
  ok('(e) a full tie goes to the lexicographic-least runId, named as the deciding stage')
}

// (f) zero greens: the race FAILED — no winner, and the K PRs are listed for
// the operator to close. The judge itself closes nothing and never calls gh.
{
  const f = judgeFixture('run-66', [
    { status: 'parked', fixRounds: 1, ledger: 100, pr: 71 },
    { status: 'failed', fixRounds: 0, ledger: 200 },
    { status: 'parked', fixRounds: 3, ledger: 300, pr: 73 },
  ])
  const v = await judgeRace(f.argv(), f.deps)
  assert.equal(v.winner, null)
  assert.equal(v.decidingStage, STAGES.noGreen)
  assert.deepEqual(Object.keys(v.scorecard), ['run-66-a', 'run-66-b', 'run-66-c'])
  assert.ok(Object.values(v.scorecard).every((e) => e.winner === false), 'a failed race names no winner')
  assert.equal(f.printed[0], 'race run-66: FAILED — no winner')
  assert.equal(f.printed[1], `decided by: ${STAGES.noGreen}`)
  const out = f.printed.join('\n')
  for (const run of f.runs) assert.ok(out.includes(run.runId), `${run.runId} must appear in the failure printout`)
  assert.ok(out.includes('ultra/integration-run-66-a'), 'the parked run\'s PR branch is listed for closing')
  assert.ok(out.includes('https://github.com/example/fleet/pull/73'), 'each open PR is named for the operator')
  assert.ok(out.includes('no PR opened'), 'a run that published nothing says so')
  assert.match(out, /close (all )?3 PRs|nothing merges/)
  assert.equal(readRaceManifest(f.evidenceDir, 'run-66').verdict.winner, null)
  ok('(f) zero greens is a FAILED race: no winner, every run\'s verdict and PR printed for the operator')
}

// (g)+(h) the appended verdict: the pre-registered dials survive byte-for-byte
// and the scorecard is the full per-run card, keyed by runId.
{
  const f = judgeFixture('run-67', [
    { status: 'gate-green', fixRounds: 0, ledger: 480_000, reported: 500_000, elapsedMs: 3_600_000, pr: 81 },
    { status: 'parked', fixRounds: 2, ledger: 610_000, reported: 620_000, elapsedMs: 4_000_000, pr: 82 },
  ])
  const manifestPath = raceManifestPath(f.evidenceDir, 'run-67')
  const before = fs.readFileSync(manifestPath, 'utf8')
  const dialsBlock = before.slice(before.indexOf('  "dials": {'), before.lastIndexOf('\n}'))
  assert.ok(dialsBlock.length > 100, 'the fixture must carry the real pre-registered dials block')

  const v = await judgeRace(f.argv(), f.deps)
  const after = fs.readFileSync(manifestPath, 'utf8')
  assert.ok(after.includes(dialsBlock), 'the pre-registered dials block must survive byte-for-byte')
  const reread = readRaceManifest(f.evidenceDir, 'run-67')
  assert.deepEqual(reread.dials, DIALS)
  for (const key of ['raceId', 'planPath', 'baseCommit', 'k', 'launchedAt', 'runs']) {
    assert.deepEqual(reread[key], f.manifest[key], `${key} must be untouched by the judge`)
  }
  assert.deepEqual(reread.verdict, { winner: v.winner, decidingStage: v.decidingStage, scorecard: v.scorecard })
  assert.deepEqual(Object.keys(reread), [...Object.keys(f.manifest), 'verdict'], 'the verdict is appended, nothing reordered')
  ok('(g) the judge appends its verdict and leaves every pre-registered dial byte-identical')

  assert.deepEqual(v, {
    winner: 'run-67-a',
    decidingStage: STAGES.driveStatus,
    scorecard: {
      'run-67-a': {
        driveStatus: 'gate-green',
        fixRounds: 0,
        tokens: 480_000,
        tokenSource: 'ledger',
        tokenFallback: false,
        elapsedMs: 3_600_000,
        pullRequest: {
          number: 81,
          url: 'https://github.com/example/fleet/pull/81',
          draft: false,
          branch: 'ultra/integration-run-67-a',
        },
        winner: true,
        notes: [],
      },
      'run-67-b': {
        driveStatus: 'parked',
        fixRounds: 2,
        tokens: 610_000,
        tokenSource: 'ledger',
        tokenFallback: false,
        elapsedMs: 4_000_000,
        pullRequest: {
          number: 82,
          url: 'https://github.com/example/fleet/pull/82',
          draft: true,
          branch: 'ultra/integration-run-67-b',
        },
        winner: false,
        notes: [],
      },
    },
  })
  // Judging twice is idempotent: the verdict is replaced, never duplicated.
  const again = await judgeRace(f.argv(), f.deps)
  assert.deepEqual(again, v)
  assert.deepEqual(Object.keys(readRaceManifest(f.evidenceDir, 'run-67')), [...Object.keys(f.manifest), 'verdict'])
  ok('(h) the scorecard is keyed by runId; each entry names drive status, fix rounds and tokens')
}

// (i) the CLI entry: winner, deciding stage and every run's scorecard line on
// stdout, exit 0 — and a non-zero exit naming the missing run without --force.
{
  const f = judgeFixture('run-68', [
    { status: 'gate-green', fixRounds: 0, ledger: 480_000, pr: 91 },
    { status: 'gate-green', fixRounds: 3, ledger: 100_000, pr: 92 },
    { status: 'parked', fixRounds: 0, ledger: 1_000, pr: 93 },
  ])
  const code = await cli(['judge', ...f.argv()], f.deps)
  assert.equal(code, 0)
  assert.equal(f.printed[0], 'race run-68: winner run-68-a')
  assert.equal(f.printed[1], `decided by: ${STAGES.fixRounds}`)
  assert.equal(
    f.printed[2],
    '  run-68-a  gate-green  fix 0  tokens 480000 (ledger)  PR #91 https://github.com/example/fleet/pull/91 (ultra/integration-run-68-a)',
  )
  for (const run of f.runs) {
    const line = f.printed.find((l) => l.trim().startsWith(run.runId))
    assert.ok(line, `${run.runId} must have a scorecard line`)
    assert.match(line, /gate-green|parked/)
  }
  assert.deepEqual(f.errored, [])

  const g = judgeFixture('run-69', [
    { status: 'gate-green', fixRounds: 0, ledger: 1 },
    { missing: true },
  ])
  const failCode = await cli(['judge', ...g.argv()], g.deps)
  assert.equal(failCode, 1, 'a refused judge exits non-zero')
  assert.match(g.errored.join('\n'), /run-69-b/)
  assert.equal(g.printed.length, 0, 'a refused judge prints no verdict')
  assert.ok(!('verdict' in readRaceManifest(g.evidenceDir, 'run-69')))
  ok('(i) `race.mjs judge <raceId>` prints winner, deciding stage and every scorecard line; a missing gate-read exits non-zero')
}

// The judge refuses what it cannot judge, and the CLI names both verbs.
{
  const f = judgeFixture('run-70', [{ status: 'gate-green', fixRounds: 0, ledger: 1 }])
  await assert.rejects(judgeRace(f.argv('--bogus'), f.deps), /unknown judge flag --bogus/)
  await assert.rejects(judgeRace(f.argv('extra'), f.deps), /exactly <raceId>/)
  await assert.rejects(judgeRace([], f.deps), /exactly <raceId>/)
  await assert.rejects(judgeRace(['run-70', '--evidence-dir'], f.deps), /--evidence-dir needs a value/)
  assert.match(usage(), /judge <raceId> \[--force\]/)
  ok('the judge names its own flags and refuses anything else')
}

// Read-only apart from the verdict, and never `gh`: the operator adopts.
{
  const source = fs.readFileSync(new URL('../race.mjs', import.meta.url), 'utf8')
  const code = source.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n')
  assert.ok(!/\bgh\b/.test(code), 'race.mjs must never invoke gh')
  ok('race.mjs never invokes gh — adoption stays the operator\'s, driven by the printout')
}


for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true })

console.log(`\nALL TESTS PASSED (${passed})`)
