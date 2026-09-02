import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DIALS, manifestPath, writeRaceManifest, readRaceManifest, assertManifest,
         appendVerdict } from '../race-manifest.mjs'

// No live drive, no network, no git, no sqlite3, no sibling module: the manifest
// is a file and a schema, so the only substrate this test needs is a temp dir.
const evidenceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'race-manifest-'))

const complete = () => ({
  raceId: 'race-1',
  planPath: 'docs/plans/some-plan.md',
  baseCommit: '9f719fa5d056ddf2a831baf0f143539f1a7df767',
  k: 3,
  launchedAt: '2026-09-02T10:00:00.000Z',
  runs: [
    { runId: 'run-50a', port: 7101, dbDir: '/tmp/db-a', repoDir: '/tmp/repo-a' },
    { runId: 'run-50b', port: 7102, dbDir: '/tmp/db-b', repoDir: '/tmp/repo-b' },
    { runId: 'run-50c', port: 7103, dbDir: '/tmp/db-c', repoDir: '/tmp/repo-c' },
  ],
  dials: DIALS,
})

// (e) manifestPath is <evidenceDir>/race-<raceId>.json
assert.equal(manifestPath(evidenceDir, 'race-1'), `${evidenceDir}/race-race-1.json`)
assert.equal(manifestPath('/home/exedev/fleet-evidence', 'r7'),
             '/home/exedev/fleet-evidence/race-r7.json')

// (a) write -> read round-trips deep-equal, and the on-disk dials text is the
// frozen DIALS block byte-for-byte.
const written = writeRaceManifest(evidenceDir, complete())
assert.equal(written, manifestPath(evidenceDir, 'race-1'))
assert.deepEqual(readRaceManifest(evidenceDir, 'race-1'), complete())
const onDisk = JSON.parse(fs.readFileSync(written, 'utf8'))
assert.equal(JSON.stringify(onDisk.dials), JSON.stringify(DIALS))

// (b) DIALS is frozen and carries the pre-registered values.
assert.ok(Object.isFrozen(DIALS))
assert.throws(() => { DIALS.rubric = [] }, TypeError)          // ESM is strict mode
assert.throws(() => { DIALS.baseline['run-47'].tokens = 1 }, TypeError)   // deeply frozen
assert.equal(DIALS.baseline['run-47'].tokens, 239564)
assert.deepEqual(DIALS.baseline['run-44'], { wallMinutes: 79, tokens: 287692, fixRounds: 0 })
assert.deepEqual(DIALS.baseline['run-45'],
  { wallMinutes: 62, tokens: 232635, fixRounds: 1, planTracedDefects: 2 })
assert.deepEqual(DIALS.baseline['run-47'],
  { wallMinutes: 79, tokens: 239564, fixRounds: 1, planTracedDefects: 1 })
assert.deepEqual(DIALS.rubric, ['gate-green', 'fix-rounds', 'tokens', 'runid-lexicographic'])
assert.equal(DIALS.raceWall, 'manifest launchedAt -> max over runs of the per-run elapsedMs end')
assert.equal(DIALS.totalTokens,
  'sum of per-run tokens across the K runs (expect about K x a single run)')
assert.equal(DIALS.perRun, 'per-run drive status, fix rounds, tokens')
assert.equal(DIALS.comparatorDecisiveness,
  "which rubric stage decided — name the stage; never read 'zero ties' as rubric quality")
assert.equal(DIALS.winnerDefectSurface,
  "the winner's post-merge defect surface — anything traced back within the next two sittings")

// (c) assertManifest names the FIRST missing or mis-typed field, and returns a
// complete manifest unchanged.
const noRuns = complete()
delete noRuns.runs
assert.throws(() => assertManifest(noRuns), (err) => err instanceof Error && /\bruns\b/.test(err.message))
const strPort = complete()
strPort.runs[1].port = '7102'
assert.throws(() => assertManifest(strPort),
  (err) => err instanceof Error && err.message.includes('runs[1].port'))
const good = complete()
assert.equal(assertManifest(good), good)

// (d) appendVerdict leaves every pre-existing key byte-identical and adds
// exactly one new key.
const before = JSON.parse(fs.readFileSync(written, 'utf8'))
const verdict = {
  winner: 'run-50b',
  decidingStage: 'fix-rounds',
  scorecard: {
    'run-50a': { status: 'gate-green', fixRounds: 2, tokens: 240000 },
    'run-50b': { status: 'gate-green', fixRounds: 0, tokens: 251000 },
    'run-50c': { status: 'parked', fixRounds: 1, tokens: 90000 },
  },
}
const judged = appendVerdict(evidenceDir, 'race-1', verdict)
const after = JSON.parse(fs.readFileSync(written, 'utf8'))
for (const key of ['raceId', 'planPath', 'baseCommit', 'k', 'launchedAt', 'runs', 'dials']) {
  assert.equal(JSON.stringify(after[key]), JSON.stringify(before[key]), key)
}
assert.deepEqual(Object.keys(after), [...Object.keys(before), 'verdict'])
assert.deepEqual(after.verdict, verdict)
assert.deepEqual(Object.keys(after.verdict), ['winner', 'decidingStage', 'scorecard'])
assert.deepEqual(judged, after)
assert.deepEqual(readRaceManifest(evidenceDir, 'race-1').verdict, verdict)

// (g) writeRaceManifest is synchronous: the file is on disk with its full
// content at the moment it returns, and a second call observably replaces it.
const fresh = complete()
fresh.raceId = 'race-2'
fresh.launchedAt = '2026-09-02T11:00:00.000Z'
const p2 = writeRaceManifest(evidenceDir, fresh)
assert.deepEqual(JSON.parse(fs.readFileSync(p2, 'utf8')), fresh)   // very next statement
const replaced = complete()
replaced.raceId = 'race-2'
replaced.launchedAt = '2026-09-02T12:34:56.000Z'
writeRaceManifest(evidenceDir, replaced)
assert.equal(JSON.parse(fs.readFileSync(p2, 'utf8')).launchedAt, '2026-09-02T12:34:56.000Z')
assert.equal(readRaceManifest(evidenceDir, 'race-2').launchedAt, '2026-09-02T12:34:56.000Z')

// (f) reading a manifest that was never written names the path it looked for.
assert.throws(() => readRaceManifest(evidenceDir, 'nope'),
  (err) => err instanceof Error && err.message.includes(manifestPath(evidenceDir, 'nope')))
assert.throws(() => appendVerdict(evidenceDir, 'nope', verdict),
  (err) => err instanceof Error && err.message.includes(manifestPath(evidenceDir, 'nope')))

fs.rmSync(evidenceDir, { recursive: true, force: true })
console.log('ALL TESTS PASSED')
