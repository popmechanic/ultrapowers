// fleet/tests/test_race.mjs — #511 attempt racing: the `launch` and `judge` verbs.
//
// Pins the launch shape from #454: one committed plan, K concurrent drives,
// distinct runIds/ports/db-dirs/repo-dirs, and a raceId-qualified manifest
// written BEFORE any drive starts so the measurement dials cannot be chosen
// once results are visible.
//
// Then pins the judge that reads what those drives wrote: the ordered rubric
// (gate-green filter, fix rounds, tokens, lexicographic runId), the stage that
// decided, the not-terminal refusal and its `--force` escape, and the verdict
// appended to the manifest without disturbing the pre-registration.
//
// No live drive, no network, no git remote: `driveOne`, every git subprocess
// (rev-parse, clone, checkout) and the judge's store reader are injected,
// following test_drive_one.mjs's deps-injection pattern. Everything this file
// writes lands under one mkdtemp.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { DEFAULTS } from '../drive-one.mjs'
import {
  DIALS,
  SUFFIXES,
  cloneAtCommit,
  judgeRace,
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

// --- the judge --------------------------------------------------------------
//
// Fixtures only: a manifest, per-run gate-read + gate-read detail files, and an
// injected store reader over MergeableStore-shaped JSON. No sqlite, no drive,
// no git — the judge's sqlite access rides the `readStore` seam, exactly as
// status.mjs's own reader does.

// A MergeableStore serializes every node as [value, hlc, hash] (test_status.mjs).
const stamped = (v) => [v, 'P0Q-hlc', 12345]

// One run's store: `fixRounds` events carrying the engine's `fix:<id>:<iter>`
// label, one non-fix worker event, and one `fix:`-labelled event belonging to a
// DIFFERENT run — which must never be counted into this one.
const storeFor = (runId, fixRounds) => {
  const events = {
    [`${runId}:01AAA`]: stamped({
      kind: stamped('worker:start'), label: stamped('impl:1'), ts: stamped(1788245813225), runId: stamped(runId),
    }),
    'other-run:01ZZZ': stamped({
      kind: stamped('worker:start'), label: stamped('fix:9:1'), ts: stamped(1788245813225), runId: stamped('other-run'),
    }),
  }
  for (let i = 0; i < fixRounds; i += 1) {
    events[`${runId}:01FIX${i}`] = stamped({
      kind: stamped('worker:start'),
      label: stamped(`fix:${i + 1}:1`),
      ts: stamped(1788245813226 + i),
      runId: stamped(runId),
    })
  }
  return [[{ events: stamped(events), runs: stamped({}) }, {}], 'hlc', 0]
}

// One finished race's artifacts on disk. Each spec is one attempt:
// `{status, ledger, reported, fix, elapsedMs, runId?, missing?}`, where
// `missing: true` writes no gate-read at all — the run that never reported.
const makeRaceFixture = (raceId, specs) => {
  const c = makeCase()
  const runs = specs.map((spec, i) => {
    const runId = spec.runId ?? `${raceId}-${SUFFIXES[i]}`
    return {
      runId,
      port: 9000 + i,
      dbDir: path.join(c.root, `db-${runId}`),
      repoDir: path.join(c.root, `repo-${runId}`),
    }
  })
  fs.mkdirSync(c.evidenceDir, { recursive: true })
  const manifest = {
    raceId,
    planPath: c.planPath,
    baseCommit: BASE_SHA,
    k: runs.length,
    launchedAt: LAUNCHED_AT,
    runs,
    dials: JSON.parse(JSON.stringify(DIALS)),
  }
  fs.writeFileSync(raceManifestPath(c.evidenceDir, raceId), `${JSON.stringify(manifest, null, 2)}\n`)

  const stores = new Map()
  specs.forEach((spec, i) => {
    const run = runs[i]
    stores.set(path.join(run.dbDir, 'fleet.db'), storeFor(run.runId, spec.fix ?? 0))
    if (spec.missing) return
    // The five-key §W1d gate read: spend lives here...
    fs.writeFileSync(path.join(c.evidenceDir, `gate-read-${run.runId}.json`), `${JSON.stringify({
      o1: spec.status === 'gate-green',
      receiptsResolvable: true,
      leaseContinuity: true,
      versionStamp: true,
      spendObservational: { reported: spec.reported ?? null, ledger: spec.ledger ?? null },
    }, null, 2)}\n`)
    // ...and the drive status, the wall clock and the PR live in the detail.
    fs.writeFileSync(path.join(c.evidenceDir, `gate-read-${run.runId}.detail.json`), `${JSON.stringify({
      runId: run.runId,
      status: spec.status,
      elapsedMs: spec.elapsedMs ?? 60_000,
      pullRequest: {
        number: 500 + i,
        url: `https://example.invalid/pr/${500 + i}`,
        draft: false,
        branch: `ultra/integration-${run.runId}`,
      },
    }, null, 2)}\n`)
  })

  return {
    ...c,
    raceId,
    runs,
    manifest,
    deps: {
      readStore: (dbPath) => {
        if (!stores.has(dbPath)) throw new Error(`no store fixture at ${dbPath}`)
        return stores.get(dbPath)
      },
    },
    argv: (...flags) => [raceId, '--evidence-dir', c.evidenceDir, ...flags],
  }
}

// The verdict as it lands in the manifest — the judge's return adds `raceId`
// and `manifestPath` for the CLI's printout, which the artifact never carries.
const written = ({ winner, decidingStage, scorecard }) => ({ winner, decidingStage, scorecard })

// --- (a) not terminal, and the --force escape ------------------------------

{
  const f = makeRaceFixture('race-j1', [
    { status: 'gate-green', ledger: 500, reported: 510, fix: 0 },
    { status: 'gate-green', ledger: 400, reported: 410, fix: 0 },
    { missing: true },
  ])
  // A run with no gate-read is not terminal, and the refusal names it.
  assert.throws(() => judgeRace(f.argv(), f.deps), /race-j1-c/)
  assert.throws(() => judgeRace(f.argv(), f.deps), /not terminal/)
  // ...and a refused judge writes nothing at all.
  assert.equal(readRaceManifest(f.evidenceDir, 'race-j1').verdict, undefined)

  const verdict = judgeRace(f.argv('--force'), f.deps)
  // The absentee is scored as an automatic loss, in full.
  assert.deepEqual(verdict.scorecard['race-j1-c'], {
    runId: 'race-j1-c',
    status: 'no-record',
    fixRounds: null,
    spend: null,
    tokens: null,
    tokenSource: null,
    tokenFallback: false,
    elapsedMs: null,
    pullRequest: null,
    outcome: 'no-record',
    notes: ['no gate-read-race-j1-c.json: this run never reported — an automatic loss under --force'],
  })
  // The runs that DID report are scored normally, and one of them wins.
  assert.equal(verdict.winner, 'race-j1-b')
  assert.equal(verdict.decidingStage, 'tokens')
  assert.equal(verdict.scorecard['race-j1-b'].outcome, 'winner')
  assert.equal(verdict.scorecard['race-j1-a'].outcome, 'loser')
  ok('(a) judge refuses a missing gate-read; --force scores the reporters and loses the absentee')
}

// --- (b) the gate-green filter comes first ---------------------------------

{
  // The only green is the WORST run by every later stage: 5 fix rounds and 9x
  // the tokens. The filter still hands it the race.
  const f = makeRaceFixture('race-j2', [
    { status: 'parked', ledger: 100, reported: 110, fix: 0 },
    { status: 'gate-green', ledger: 900, reported: 910, fix: 5 },
    { status: 'failed', ledger: 50, reported: 60, fix: 0 },
  ])
  const verdict = judgeRace(f.argv(), f.deps)
  assert.equal(verdict.winner, 'race-j2-b')
  assert.equal(verdict.decidingStage, 'gate-green')
  assert.deepEqual(
    Object.values(verdict.scorecard).map((e) => e.outcome),
    ['loser', 'winner', 'loser'],
  )
  ok('(b) the sole gate-green run beats parked and failed ones; decidingStage is the filter')
}

// --- (c) fewest fix rounds -------------------------------------------------

{
  // Three greens; b has the fewest `fix:` events and the MOST tokens, so only
  // the fix-round stage can be what decided it.
  const f = makeRaceFixture('race-j3', [
    { status: 'gate-green', ledger: 100, reported: 110, fix: 3 },
    { status: 'gate-green', ledger: 900, reported: 910, fix: 1 },
    { status: 'gate-green', ledger: 10, reported: 20, fix: 4 },
  ])
  const verdict = judgeRace(f.argv(), f.deps)
  assert.equal(verdict.winner, 'race-j3-b')
  assert.equal(verdict.decidingStage, 'fix-rounds')
  // Counted from each run's OWN store, and never from a sibling's events.
  assert.deepEqual(Object.values(verdict.scorecard).map((e) => e.fixRounds), [3, 1, 4])
  ok('(c) among greens the fewest `fix:`-labelled events wins; decidingStage names the fix-round stage')
}

// --- (d) fewest tokens, and the null-ledger fallback -----------------------

{
  const f = makeRaceFixture('race-j4', [
    { status: 'gate-green', ledger: 700, reported: 100, fix: 2 },
    { status: 'gate-green', ledger: 600, reported: 999, fix: 2 },
  ])
  const verdict = judgeRace(f.argv(), f.deps)
  assert.equal(verdict.winner, 'race-j4-b')
  assert.equal(verdict.decidingStage, 'tokens')
  assert.deepEqual(Object.values(verdict.scorecard).map((e) => e.tokens), [700, 600])
  assert.deepEqual(Object.values(verdict.scorecard).map((e) => e.tokenSource), ['ledger', 'ledger'])
  assert.deepEqual(Object.values(verdict.scorecard).map((e) => e.tokenFallback), [false, false])
  ok('(d1) a fix-round tie is broken by the fewest ledger tokens')
}

{
  // One null ledger: comparing a's `reported` against b's `ledger` would be
  // comparing unlike things, so BOTH fall back to `reported` — which reverses
  // who would have won on the ledger reading, and the scorecard says so.
  const f = makeRaceFixture('race-j5', [
    { status: 'gate-green', ledger: null, reported: 100, fix: 2 },
    { status: 'gate-green', ledger: 5, reported: 999, fix: 2 },
  ])
  const verdict = judgeRace(f.argv(), f.deps)
  assert.equal(verdict.winner, 'race-j5-a')
  assert.equal(verdict.decidingStage, 'tokens')
  assert.deepEqual(Object.values(verdict.scorecard).map((e) => e.tokens), [100, 999])
  assert.deepEqual(Object.values(verdict.scorecard).map((e) => e.tokenSource), ['reported', 'reported'])
  assert.deepEqual(Object.values(verdict.scorecard).map((e) => e.tokenFallback), [true, true])
  // Both readings stay on the card, so the fallback is auditable.
  assert.deepEqual(verdict.scorecard['race-j5-a'].spend, { reported: 100, ledger: null })
  assert.deepEqual(verdict.scorecard['race-j5-b'].spend, { reported: 999, ledger: 5 })
  ok('(d2) one null ledger falls the whole field back to `reported`, flagged in every entry')
}

// --- (e) the lexicographic tie-break ---------------------------------------

{
  // Identical on every ranked stage, and listed in the manifest in REVERSE
  // lexicographic order — so "first in the manifest" and "lexicographic least"
  // disagree, and only the latter can produce this winner.
  const f = makeRaceFixture('race-j6', [
    { runId: 'race-j6-c', status: 'gate-green', ledger: 42, reported: 42, fix: 1 },
    { runId: 'race-j6-b', status: 'gate-green', ledger: 42, reported: 42, fix: 1 },
    { runId: 'race-j6-a', status: 'gate-green', ledger: 42, reported: 42, fix: 1 },
  ])
  const verdict = judgeRace(f.argv(), f.deps)
  assert.equal(verdict.winner, 'race-j6-a')
  assert.equal(verdict.decidingStage, 'runid-lexicographic')
  assert.deepEqual(Object.keys(verdict.scorecard), ['race-j6-a', 'race-j6-b', 'race-j6-c'])
  ok('(e) a full tie goes to the lexicographic-least runId; decidingStage names the tie-break')
}

// --- (f) zero greens is a FAILED race --------------------------------------

{
  const f = makeRaceFixture('race-j7', [
    { status: 'parked', ledger: 100, reported: 110, fix: 0 },
    { status: 'failed', ledger: 200, reported: 210, fix: 2 },
    { status: 'revoked', ledger: 300, reported: 310, fix: 1 },
  ])
  const verdict = judgeRace(f.argv(), f.deps)
  assert.equal(verdict.winner, null)
  assert.equal(verdict.decidingStage, 'gate-green')
  assert.ok(Object.values(verdict.scorecard).every((e) => e.outcome === 'loser'))
  assert.deepEqual(readRaceManifest(f.evidenceDir, 'race-j7').verdict, written(verdict))

  const printed = []
  await main(['judge', ...f.argv()], { ...f.deps, log: (line) => printed.push(line) })
  const out = printed.join('\n')
  assert.match(out, /FAILED/)
  assert.match(out, /merge nothing/)
  assert.ok(!/winner/.test(out.split('\n')[0]), out)
  // The K PR branches, for the operator to close — the judge never calls gh.
  for (const run of f.runs) {
    assert.ok(out.includes(`ultra/integration-${run.runId}`), `the FAILED printout must list ${run.runId}'s PR branch`)
  }
  assert.match(out, /never calls gh/)
  ok('(f) zero greens: FAILED, no winner named, and all K PR branches listed')
}

// --- (g) the verdict is appended; the pre-registration is untouched --------

{
  const f = makeRaceFixture('race-j8', [
    { status: 'gate-green', ledger: 100, reported: 110, fix: 0 },
    { status: 'parked', ledger: 50, reported: 60, fix: 0 },
  ])
  const manifestPath = raceManifestPath(f.evidenceDir, 'race-j8')
  const before = fs.readFileSync(manifestPath, 'utf8')
  const verdict = judgeRace(f.argv(), f.deps)
  const after = fs.readFileSync(manifestPath, 'utf8')

  // Byte-identical: every byte launch wrote is still there, in order — the
  // verdict is spliced in after them, so the dials block cannot have moved.
  assert.ok(
    after.startsWith(before.slice(0, before.lastIndexOf('}')).trimEnd()),
    'the judge rewrote bytes the launch pre-registration owns',
  )
  const reread = readRaceManifest(f.evidenceDir, 'race-j8')
  assert.deepEqual(reread.dials, DIALS)
  const { verdict: appended, ...preRegistered } = reread
  assert.deepEqual(preRegistered, f.manifest)
  assert.deepEqual(appended, written(verdict))

  // A re-judge replaces the verdict and nothing else.
  const again = judgeRace(f.argv(), f.deps)
  const rereadTwice = readRaceManifest(f.evidenceDir, 'race-j8')
  const { verdict: appendedAgain, ...preRegisteredAgain } = rereadTwice
  assert.deepEqual(preRegisteredAgain, f.manifest)
  assert.deepEqual(appendedAgain, written(again))
  assert.deepEqual(rereadTwice.dials, DIALS)
  ok('(g) the appended verdict leaves every pre-registered dials value byte-identical')
}

// --- (h) the scorecard is keyed by runId and names every ranked metric -----

{
  const f = makeRaceFixture('race-j9', [
    { status: 'gate-green', ledger: 100, reported: 110, fix: 2, elapsedMs: 3_600_000 },
    { status: 'parked', ledger: 50, reported: 60, fix: 7, elapsedMs: 120_000 },
  ])
  const verdict = judgeRace(f.argv(), f.deps)
  assert.deepEqual(Object.keys(verdict.scorecard), ['race-j9-a', 'race-j9-b'])
  assert.deepEqual(verdict.scorecard['race-j9-a'], {
    runId: 'race-j9-a',
    status: 'gate-green',
    fixRounds: 2,
    spend: { reported: 110, ledger: 100 },
    tokens: 100,
    tokenSource: 'ledger',
    tokenFallback: false,
    elapsedMs: 3_600_000,
    pullRequest: {
      number: 500,
      url: 'https://example.invalid/pr/500',
      draft: false,
      branch: 'ultra/integration-race-j9-a',
    },
    outcome: 'winner',
    notes: [],
  })
  assert.deepEqual(verdict.scorecard['race-j9-b'], {
    runId: 'race-j9-b',
    status: 'parked',
    fixRounds: 7,
    spend: { reported: 60, ledger: 50 },
    tokens: 50,
    tokenSource: 'ledger',
    tokenFallback: false,
    elapsedMs: 120_000,
    pullRequest: {
      number: 501,
      url: 'https://example.invalid/pr/501',
      draft: false,
      branch: 'ultra/integration-race-j9-b',
    },
    outcome: 'loser',
    notes: [],
  })
  ok('(h) every scorecard entry names its drive status, fix rounds and tokens')
}

// --- (i) the CLI entry ------------------------------------------------------

{
  const f = makeRaceFixture('race-j10', [
    { status: 'gate-green', ledger: 100, reported: 110, fix: 3 },
    { status: 'gate-green', ledger: 900, reported: 910, fix: 1 },
    { status: 'parked', ledger: 1, reported: 2, fix: 0 },
  ])
  const printed = []
  const verdict = await main(['judge', ...f.argv()], { ...f.deps, log: (line) => printed.push(line) })
  assert.equal(verdict.winner, 'race-j10-b')
  assert.equal(verdict.decidingStage, 'fix-rounds')
  const out = printed.join('\n')
  assert.match(out, /winner race-j10-b/)
  assert.match(out, /decided by fix-rounds/)
  for (const run of f.runs) {
    assert.ok(
      printed.some((line) => line.trimStart().replace(/^\*/, '').startsWith(run.runId)),
      `the printout must carry a scorecard line for ${run.runId}: ${out}`,
    )
  }
  assert.ok(printed.some((line) => line.includes(raceManifestPath(f.evidenceDir, 'race-j10'))), out)
  ok('(i) `judge <raceId>` prints the winner, the deciding stage and every scorecard line')
}

{
  // The same CLI entry over a race that is not terminal: a refusal naming the
  // run that never reported, and — as a real process — a non-zero exit.
  const f = makeRaceFixture('race-j11', [
    { status: 'gate-green', ledger: 100, reported: 110, fix: 0 },
    { missing: true },
  ])
  await assert.rejects(
    () => main(['judge', ...f.argv()], { ...f.deps, log: () => {} }),
    /race-j11-b/,
  )
  const RACE_MJS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'race.mjs')
  const proc = spawnSync(process.execPath, [RACE_MJS, 'judge', 'race-j11', '--evidence-dir', f.evidenceDir], {
    encoding: 'utf8',
  })
  assert.notEqual(proc.status, 0, `expected a non-zero exit, got ${proc.status}: ${proc.stdout}`)
  assert.match(proc.stderr, /race-j11-b/)
  assert.equal(readRaceManifest(f.evidenceDir, 'race-j11').verdict, undefined)
  ok('(i) the CLI refuses a non-terminal race by name and exits non-zero')
}

// --- the judge's own refusals ----------------------------------------------

{
  const f = makeRaceFixture('race-j12', [{ status: 'gate-green', ledger: 1, reported: 2, fix: 0 }])
  assert.throws(() => judgeRace(['race-j12', '--evidence-dir'], f.deps), /--evidence-dir needs a value/)
  assert.throws(() => judgeRace([...f.argv(), '--bogus'], f.deps), /unknown flag --bogus/)
  assert.throws(() => judgeRace(['--evidence-dir', f.evidenceDir], f.deps), /expects exactly <raceId>/)
  assert.throws(() => judgeRace([...f.argv(), 'race-j13'], f.deps), /expects exactly <raceId>/)
  assert.throws(() => judgeRace(['no-such-race', '--evidence-dir', f.evidenceDir], f.deps), /race-no-such-race\.json/)
  // A single terminal contestant is still decided by the filter it survived.
  const solo = judgeRace(f.argv(), f.deps)
  assert.equal(solo.winner, 'race-j12-a')
  assert.equal(solo.decidingStage, 'gate-green')
  ok('judge refuses a valueless flag, an unknown flag, a missing/extra raceId and an unlaunched race')
}

// --- the store seam ---------------------------------------------------------

{
  // A store that cannot be read is not evidence of a clean run: its fix-round
  // count is null (never zero) and it ranks last at that stage, so the run with
  // a readable store and MORE fix rounds still wins.
  const f = makeRaceFixture('race-j14', [
    { status: 'gate-green', ledger: 100, reported: 110, fix: 4 },
    { status: 'gate-green', ledger: 100, reported: 110, fix: 0 },
  ])
  const deps = {
    readStore: (dbPath) => {
      if (dbPath.includes('race-j14-b')) throw new Error('sqlite3 exit 1')
      return f.deps.readStore(dbPath)
    },
  }
  const verdict = judgeRace(f.argv(), deps)
  assert.equal(verdict.scorecard['race-j14-a'].fixRounds, 4)
  assert.equal(verdict.scorecard['race-j14-b'].fixRounds, null)
  assert.equal(verdict.winner, 'race-j14-a')
  assert.equal(verdict.decidingStage, 'fix-rounds')
  assert.match(verdict.scorecard['race-j14-b'].notes.join(' '), /store unreadable: sqlite3 exit 1/)
  ok('an unreadable store scores null fix rounds and ranks last, never zero')
}

assert.match(usage(), /node fleet\/race\.mjs launch <plan\.md> <raceId>/)
assert.match(usage(), /node fleet\/race\.mjs judge <raceId>/)
ok('usage names both committed entry points')

fs.rmSync(TMP, { recursive: true, force: true })
console.log(`\nALL TESTS PASSED (${passed})`)
