// fleet/tests/test_race.mjs — #511 attempt racing, the `launch` verb.
//
// Pins the launch shape from #454: one committed plan, K concurrent drives,
// distinct runIds/ports/db-dirs/repo-dirs, and a raceId-qualified manifest
// written BEFORE any drive starts so the measurement dials cannot be chosen
// once results are visible.
//
// No live drive, no network, no git remote: `driveOne` and every git
// subprocess (rev-parse, clone, checkout) are injected, following
// test_drive_one.mjs's deps-injection pattern. Everything this file writes
// lands under one mkdtemp.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DEFAULTS } from '../drive-one.mjs'
import {
  DIALS,
  cloneAtCommit,
  launchRace,
  main,
  raceManifestPath,
  readRaceManifest,
  usage,
} from '../race.mjs'

let passed = 0
const ok = (label) => {
  passed += 1
  console.log(`ok - ${label}`)
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-race-test-'))
const BASE_SHA = 'de1e7ed0'.repeat(5) // 40 hex chars, the stub rev-parse output
const LAUNCHED_AT = '2026-09-01T12:00:00.000Z'

let caseSeq = 0
// One isolated evidence dir / db-dir base / plan per case, so no case can see
// another's manifest or clones.
const makeCase = () => {
  caseSeq += 1
  const root = path.join(TMP, `case-${caseSeq}`)
  const evidenceDir = path.join(root, 'evidence')
  const dbDir = path.join(root, 'db')
  const planPath = path.join(root, 'plan.md')
  fs.mkdirSync(root, { recursive: true })
  fs.writeFileSync(planPath, '# a committed plan\n')
  return { root, evidenceDir, dbDir, planPath }
}

// The injected git runner: `(argv, cwd) => stdout`, the shape run-waves.mjs's
// cloneAtBase already uses. It records every call and never touches a remote.
const makeGit = ({ base = BASE_SHA, headOf = () => base } = {}) => {
  const calls = []
  const git = (argv, cwd) => {
    calls.push({ argv, cwd })
    if (argv[0] === 'clone') {
      fs.mkdirSync(argv[argv.length - 1], { recursive: true })
      return ''
    }
    if (argv[0] === 'rev-parse') return `${headOf(cwd)}\n`
    return ''
  }
  return { git, calls }
}

// A drive stub that refuses to resolve until all K calls are in flight, so a
// serialized launch fails loudly (with a watchdog) instead of hanging.
const makeConcurrentDrive = (k, { ms = 5000, result = (opts) => ({ runId: opts.runId }) } = {}) => {
  const calls = []
  let arrived = 0
  let release
  let fail
  let timer
  const gate = new Promise((resolve, reject) => {
    release = resolve
    fail = reject
  })
  const drive = async (opts) => {
    calls.push(opts)
    arrived += 1
    if (arrived === 1) {
      timer = setTimeout(
        () => fail(new Error(`only ${arrived}/${k} drives were in flight after ${ms}ms — the K drives did not overlap`)),
        ms,
      )
    }
    if (arrived === k) {
      clearTimeout(timer)
      release()
    }
    await gate
    return result(opts)
  }
  return { drive, calls }
}

const stubDeps = (extra) => ({
  readToken: () => '  fake-oauth-token  \n',
  exec: async () => ({ code: 0, stdout: '', stderr: '' }),
  now: () => LAUNCHED_AT,
  ...extra,
})

// --- the launch, end to end ------------------------------------------------

{
  const c = makeCase()
  const { git, calls: gitCalls } = makeGit()
  const seenManifest = []
  const k = 3
  const { drive, calls } = makeConcurrentDrive(k, {
    // (b) pre-registration: the manifest must already be on disk when the
    // first drive starts. Recorded from inside the stub, not after the await.
    result: (opts) => ({ runId: opts.runId, ok: true }),
  })
  const drivePreRegistered = async (opts) => {
    seenManifest.push(fs.existsSync(raceManifestPath(c.evidenceDir, 'race-1')))
    return drive(opts)
  }
  const narrated = []

  const { manifest, results } = await launchRace(
    [c.planPath, 'race-1', '--k', '3', '--port', '9000', '--db-dir', c.dbDir,
      '--evidence-dir', c.evidenceDir, '--repo-dir', '/tmp/launch-checkout'],
    stubDeps({ drive: drivePreRegistered, git, narrate: (line) => narrated.push(line) }),
  )

  const cloneRoot = `${c.dbDir}-repos`
  const expected = {
    raceId: 'race-1',
    planPath: c.planPath,
    baseCommit: BASE_SHA,
    k: 3,
    launchedAt: LAUNCHED_AT,
    runs: [
      { runId: 'race-1-a', port: 9000, dbDir: `${c.dbDir}-a`, repoDir: path.join(cloneRoot, 'race-1-a') },
      { runId: 'race-1-b', port: 9001, dbDir: `${c.dbDir}-b`, repoDir: path.join(cloneRoot, 'race-1-b') },
      { runId: 'race-1-c', port: 9002, dbDir: `${c.dbDir}-c`, repoDir: path.join(cloneRoot, 'race-1-c') },
    ],
    dials: DIALS,
  }
  // (a) the manifest is written, its baseCommit is the stub rev-parse output,
  // and the pre-registered dials block rides along verbatim.
  assert.deepEqual(manifest, expected)
  assert.deepEqual(readRaceManifest(c.evidenceDir, 'race-1'), expected)
  assert.ok(manifest.dials && Object.keys(manifest.dials).length > 0, 'dials must be present')
  ok('(a) launch writes race-<raceId>.json: base commit from rev-parse, dials pre-registered')

  // (b) pre-registration: on disk before the first drive call, K times over.
  assert.deepEqual(seenManifest, [true, true, true])
  ok('(b) the manifest exists at the moment of every driveOne call')

  // (c) exactly K drives, all in flight together.
  assert.equal(calls.length, 3)
  assert.equal(results.length, 3)
  assert.deepEqual(results, [
    { runId: 'race-1-a', ok: true },
    { runId: 'race-1-b', ok: true },
    { runId: 'race-1-c', ok: true },
  ])
  ok('(c) driveOne is called exactly K times and the K calls overlap in flight')

  // (d) the four allocated dials are pairwise distinct and match the manifest.
  for (const field of ['runId', 'port', 'dbDir', 'repoDir']) {
    const seen = calls.map((o) => o[field])
    assert.equal(new Set(seen).size, 3, `${field} must be pairwise distinct: ${JSON.stringify(seen)}`)
    assert.deepEqual(seen, expected.runs.map((r) => r[field]))
  }
  assert.deepEqual(calls.map((o) => o.runId), ['race-1-a', 'race-1-b', 'race-1-c'])
  // ...and every repoDir is a fresh clone of the launch checkout, detached at
  // the recorded base commit (driveOne resolves its base as HEAD of its own
  // repoDir; sharing one repoDir would race the publish leg across siblings).
  assert.deepEqual(gitCalls[0], { argv: ['rev-parse', 'HEAD'], cwd: '/tmp/launch-checkout' })
  for (const run of expected.runs) {
    assert.ok(
      gitCalls.some((c2) => c2.argv[0] === 'clone' && c2.argv.includes('/tmp/launch-checkout') && c2.argv.at(-1) === run.repoDir),
      `no clone into ${run.repoDir}: ${JSON.stringify(gitCalls)}`,
    )
    assert.ok(
      gitCalls.some((c2) => c2.argv[0] === 'checkout' && c2.argv.includes('--detach') && c2.argv.at(-1) === BASE_SHA && c2.cwd === run.repoDir),
      `${run.repoDir} was not checked out at the recorded base commit`,
    )
    assert.ok(
      gitCalls.some((c2) => c2.argv[0] === 'rev-parse' && c2.cwd === run.repoDir),
      `${run.repoDir}'s HEAD was never verified against the base commit`,
    )
  }
  ok('(d) runId/port/dbDir/repoDir are pairwise distinct; repoDirs are clones at baseCommit')

  // (e) options come through the REAL buildDriveOptions — the drive-one
  // defaults and the token seam survive untouched.
  for (const o of calls) {
    assert.equal(o.prBase, DEFAULTS.prBase)
    assert.equal(o.githubTokenPath, DEFAULTS.githubTokenPath)
    assert.equal(o.golden, DEFAULTS.golden)
    assert.equal(o.planPath, c.planPath)
    assert.equal(o.ttlMs, DEFAULTS.ttlHours * 60 * 60 * 1000)
    assert.equal(o.heartbeatTimeoutMs, 30 * 60_000)
    assert.equal(o.claimTimeoutMs, 10 * 60_000)
    assert.equal(o.evidenceDir, c.evidenceDir)
    assert.equal(o.allowUnfitPlan, false)
    assert.equal(o.engineEnv.CLAUDE_CODE_OAUTH_TOKEN, 'fake-oauth-token')
  }
  ok('(e) options are built through the real buildDriveOptions — prBase and the token seam untouched')

  // (f) a suffixed runId is never its own raceId — the race is K attempts,
  // never "the raceId plus K-1 others".
  for (const run of manifest.runs) assert.notEqual(run.runId, manifest.raceId)
  ok('(f) no suffixed runId equals its own raceId')

  // Narration is runId-prefixed so K interleaved drives stay attributable, and
  // it never carries a token.
  calls[1].progressLog('provisioned')
  assert.deepEqual(narrated, ['[race race-1-b] provisioned'])
  assert.ok(!narrated.join('\n').includes('fake-oauth-token'))
  ok('each drive gets a runId-prefixed progressLog')
}

// --- (g) a drive rejection is a fast failure -------------------------------

{
  const c = makeCase()
  const { git } = makeGit()
  const seen = []
  const drive = async (opts) => {
    seen.push(opts.runId)
    if (opts.runId === 'race-2-b') throw new Error('drive refused: plan is dirty (#337)')
    return { runId: opts.runId }
  }
  await assert.rejects(
    () => launchRace(
      [c.planPath, 'race-2', '--k', '3', '--db-dir', c.dbDir, '--evidence-dir', c.evidenceDir],
      stubDeps({ drive, git }),
    ),
    /drive refused: plan is dirty \(#337\)/,
  )
  assert.deepEqual(seen, ['race-2-a', 'race-2-b', 'race-2-c'])
  ok('(g) a driveOne rejection propagates as a fast failure')
}

// --- (h) the CLI entry, through the flag path ------------------------------

{
  const c = makeCase()
  const { git } = makeGit()
  const { drive, calls } = makeConcurrentDrive(3)
  const printed = []
  const { manifest } = await main(
    ['launch', c.planPath, 'race-3', '--k', '3', '--db-dir', c.dbDir, '--evidence-dir', c.evidenceDir],
    stubDeps({ drive, git, log: (line) => printed.push(line) }),
  )
  assert.equal(manifest.k, 3)
  assert.equal(manifest.raceId, 'race-3')
  assert.equal(calls.length, 3)
  assert.deepEqual(calls.map((o) => o.runId), ['race-3-a', 'race-3-b', 'race-3-c'])
  assert.deepEqual(readRaceManifest(c.evidenceDir, 'race-3'), manifest)
  assert.ok(printed.some((l) => l.includes(raceManifestPath(c.evidenceDir, 'race-3'))), printed.join('\n'))
  for (const run of manifest.runs) {
    assert.ok(printed.some((l) => l.includes(run.runId)), `the launch printout must name ${run.runId}`)
  }
  assert.ok(!printed.join('\n').includes('fake-oauth-token'), 'the token must never be printed')
  ok('(h) `launch <plan> <raceId> --k 3` reaches launchRace with that raceId and k=3')
}

// --- the flag path's own refusals ------------------------------------------

{
  const c = makeCase()
  const { git } = makeGit()
  const drive = async (opts) => ({ runId: opts.runId })
  const argv = ['launch', c.planPath, 'race-4', '--db-dir', c.dbDir, '--evidence-dir', c.evidenceDir]
  // --k defaults to the #454 shape: three attempts.
  const { manifest } = await main(argv, stubDeps({ drive, git, log: () => {} }))
  assert.equal(manifest.k, 3)
  assert.deepEqual(manifest.runs.map((r) => r.runId), ['race-4-a', 'race-4-b', 'race-4-c'])
  // The base port is drive-one's own default, offset per attempt.
  assert.deepEqual(manifest.runs.map((r) => r.port), [DEFAULTS.port, DEFAULTS.port + 1, DEFAULTS.port + 2])
  ok('--k defaults to 3 and the ports are base+0/+1/+2')
}

{
  const c = makeCase()
  const { git } = makeGit()
  const drive = async (opts) => ({ runId: opts.runId })
  const deps = stubDeps({ drive, git })
  const at = (raceId, ...flags) => [c.planPath, raceId, '--db-dir', c.dbDir, '--evidence-dir', c.evidenceDir, ...flags]

  await assert.rejects(() => launchRace(at('race-5', '--k'), deps), /--k needs a value/)
  await assert.rejects(() => launchRace(at('race-5', '--k', 'three'), deps), /--k must be a whole number/)
  await assert.rejects(() => launchRace(at('race-5', '--k', '0'), deps), /--k must be a whole number/)
  await assert.rejects(() => launchRace(at('race-5', '--k', '99'), deps), /--k must be a whole number/)
  // Unknown flags still reach drive-one's parser, which owns that vocabulary.
  await assert.rejects(() => launchRace(at('race-5', '--bogus', 'x'), deps), /unknown flag --bogus/)
  // A raceId must be the same clean token a runId is (#211) — it becomes one.
  await assert.rejects(() => launchRace(at('race 5'), deps), /#211/)
  await assert.rejects(() => main(['sprint', c.planPath, 'race-5'], deps), /usage: node fleet\/race\.mjs/)
  await assert.rejects(() => main([], deps), /usage: node fleet\/race\.mjs/)
  ok('--k, unknown flags, a dirty raceId and an unknown verb all refuse with the usage line')
}

// --- pre-registration is one-shot ------------------------------------------

{
  const c = makeCase()
  const { git } = makeGit()
  const drive = async (opts) => ({ runId: opts.runId })
  const argv = [c.planPath, 'race-6', '--k', '2', '--db-dir', c.dbDir, '--evidence-dir', c.evidenceDir]
  const { manifest } = await launchRace(argv, stubDeps({ drive, git }))
  // Re-launching the same raceId must not overwrite the pre-registered dials:
  // a manifest chosen after results are visible is not a pre-registration.
  await assert.rejects(
    () => launchRace(argv, stubDeps({ drive, git, now: () => '2026-09-02T00:00:00.000Z' })),
    /already exists/,
  )
  assert.deepEqual(readRaceManifest(c.evidenceDir, 'race-6'), manifest)
  assert.equal(manifest.launchedAt, LAUNCHED_AT)
  ok('a second launch of the same raceId refuses rather than re-registering the dials')
}

{
  const c = makeCase()
  assert.throws(() => readRaceManifest(c.evidenceDir, 'no-such-race'), /race-no-such-race\.json/)
  // The file is `race-<raceId>.json` — the raceId is qualified, not stripped.
  assert.equal(raceManifestPath('/ev', 'race-9'), '/ev/race-race-9.json')
  assert.equal(raceManifestPath('/ev', 'r9'), '/ev/race-r9.json')
  ok('readRaceManifest names the manifest it could not find')
}

// --- the clone is fresh and verified ---------------------------------------

{
  const c = makeCase()
  const dest = path.join(c.root, 'clone')
  const { git, calls } = makeGit()
  assert.equal(cloneAtCommit({ repo: '/tmp/checkout', dest, base: BASE_SHA, git }), dest)
  assert.deepEqual(calls.map((x) => x.argv[0]), ['clone', 'checkout', 'rev-parse'])
  // An existing directory is never reused and never deleted.
  assert.throws(() => cloneAtCommit({ repo: '/tmp/checkout', dest, base: BASE_SHA, git }), /already exists/)
  assert.ok(fs.existsSync(dest))
  // A clone that did not land on the base commit is a hard refusal (#314).
  const wrong = makeGit({ headOf: () => 'ffffffffffffffffffffffffffffffffffffffff' })
  assert.throws(
    () => cloneAtCommit({ repo: '/tmp/checkout', dest: path.join(c.root, 'clone-2'), base: BASE_SHA, git: wrong.git }),
    /not the recorded base/,
  )
  ok('cloneAtCommit refuses a reused dest and a clone that missed the base commit')
}

// --- the dials block --------------------------------------------------------

{
  const c = makeCase()
  const { git } = makeGit()
  const drive = async (opts) => ({ runId: opts.runId })
  const { manifest } = await launchRace(
    [c.planPath, 'race-7', '--k', '1', '--db-dir', c.dbDir, '--evidence-dir', c.evidenceDir],
    stubDeps({ drive, git }),
  )
  // The manifest carries a COPY: mutating it cannot reach the module constant
  // (and the judge appends its verdict to the file, never to DIALS).
  manifest.dials.rubric.push('vibes')
  assert.deepEqual(readRaceManifest(c.evidenceDir, 'race-7').dials, DIALS)
  assert.deepEqual(DIALS.rubric, ['gate-green', 'fix-rounds', 'tokens', 'runid-lexicographic'])
  assert.throws(() => { DIALS.rubric.push('vibes') }, TypeError)
  ok('dials are a frozen module constant, copied into each manifest')
}

assert.match(usage(), /node fleet\/race\.mjs launch <plan\.md> <raceId>/)
ok('usage names the committed entry point')

fs.rmSync(TMP, { recursive: true, force: true })
console.log(`\nALL TESTS PASSED (${passed})`)
