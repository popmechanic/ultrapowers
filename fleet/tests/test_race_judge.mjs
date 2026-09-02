// fleet/tests/test_race_judge.mjs — the judge verb (#511 task 9).
//
// The judge is the only part of a race that writes a verdict, so everything it
// rests on is a fixture here: a manifest written by `writeRaceManifest`, the
// durable gate-read pair per run in a temp evidence dir, and a store reader
// injected as a dep. No live drive, no network, no git remote, no sqlite3
// binary (`readStore` is injected, so the default exec is never reached) and no
// `gh` — the judge never merges or closes, it only appends and prints.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DIALS, manifestPath, writeRaceManifest } from '../race-manifest.mjs'
import { gateReadPath, gateDetailPath } from '../race-evidence.mjs'
import { STAGES } from '../race-rubric.mjs'
import { verdictLines } from '../race-report.mjs'
import { judgeRace } from '../race-judge.mjs'

const RACE = 'race-50'

// A trimmed MergeableStore: [tables, values], every node [value, hlc, hash] —
// the shape `runEvents` unwraps, built the way test_race_evidence.mjs builds one.
const stamped = (v) => [v, 'P0Q-hlc', 12345]
const eventRow = (runId, kind, label) =>
  stamped({ kind: stamped(kind), label: stamped(label), ts: stamped(1788245813225), runId: stamped(runId) })

// `rounds` fix labels, each with the start AND end row the engine really emits.
const storeFor = (runId, rounds) => {
  const events = { [`${runId}:00A`]: eventRow(runId, 'worker:start', 'impl:1') }
  for (let i = 1; i <= rounds; i += 1) {
    events[`${runId}:0${i}A`] = eventRow(runId, 'worker:start', `fix:${i}:1`)
    events[`${runId}:0${i}B`] = eventRow(runId, 'worker:end', `fix:${i}:1`)
  }
  return [[{ events: stamped(events), runs: stamped({}) }, {}], 'hlc', 0]
}

const dbDirOf = (runId) => `/tmp/db-${runId}`

const pr = (runId, number) => ({
  number,
  url: `https://github.com/x/y/pull/${number}`,
  branch: `ultra/integration-${runId}`,
})

/**
 * specs: [{runId, status, ledger, reported, rounds, elapsedMs, prNumber,
 *          absent, storeMissing}]
 * Returns { dir, deps, argv } — argv already carries the temp evidence dir.
 */
const fixture = (specs) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'race-judge-'))
  writeRaceManifest(dir, {
    raceId: RACE,
    planPath: 'docs/plans/2026-09-01-511-attempt-racing.md',
    baseCommit: '62c4c1f1dd5b6fed98ede5a85049fa70d6844f78',
    k: specs.length,
    launchedAt: '2026-09-02T10:00:00.000Z',
    runs: specs.map((s, i) => ({
      runId: s.runId,
      port: 7101 + i,
      dbDir: dbDirOf(s.runId),
      repoDir: `/tmp/repo-${s.runId}`,
    })),
    dials: DIALS,
  })
  const stores = new Map()
  for (const s of specs) {
    if (s.absent) continue                      // no gate-read at all: never reported
    fs.writeFileSync(
      gateReadPath(dir, s.runId),
      JSON.stringify({ o1: true, spendObservational: { ledger: s.ledger ?? null, reported: s.reported ?? null } }),
    )
    fs.writeFileSync(
      gateDetailPath(dir, s.runId),
      JSON.stringify({
        runId: s.runId,
        status: s.status,
        elapsedMs: s.elapsedMs ?? 60000,
        pullRequest: s.prNumber ? pr(s.runId, s.prNumber) : null,
      }),
    )
    if (!s.storeMissing) stores.set(dbDirOf(s.runId), storeFor(s.runId, s.rounds ?? 0))
  }
  const readStore = (dbDir) => Promise.resolve(stores.has(dbDir) ? stores.get(dbDir) : null)
  return { dir, deps: { readStore }, argv: [RACE, '--evidence-dir', dir] }
}

const judge = async (fx, extra = []) => {
  const out = []
  const verdict = await judgeRace([...fx.argv, ...extra], { ...fx.deps, stdout: (line) => out.push(line) })
  return { verdict, out }
}

const onDisk = (dir) => JSON.parse(fs.readFileSync(manifestPath(dir, RACE), 'utf8'))

const GREEN = 'gate-green'

// ---------------------------------------------------------------------------
// (a) A missing gate-read refuses by name; --force scores the reporters and
//     records the absentee as an automatic loss.
{
  const fx = fixture([
    { runId: 'run-50a', status: GREEN, ledger: 240000, reported: 239564, rounds: 1, prNumber: 601 },
    { runId: 'run-50b', status: 'parked', ledger: 250000, reported: 249000, rounds: 0, prNumber: 602 },
    { runId: 'run-50c', absent: true },
  ])
  await assert.rejects(
    judgeRace(fx.argv, { ...fx.deps, stdout: () => {} }),
    (err) => err instanceof Error && err.message.includes('run-50c') && !err.message.includes('run-50a'),
  )
  assert.equal('verdict' in onDisk(fx.dir), false)      // a refusal writes nothing

  const { verdict } = await judge(fx, ['--force'])
  assert.deepEqual(verdict.scorecard['run-50c'], {
    runId: 'run-50c',
    status: null,
    gateGreen: false,
    fixRounds: null,
    tokens: null,
    tokenBasis: null,
    tokenFallback: false,
    elapsedMs: null,
    pullRequest: null,
    verdict: 'no-record',
  })
  // The absentee is not a contestant: it does not drag the token basis down.
  assert.deepEqual(verdict, {
    winner: 'run-50a',
    decidingStage: 'gate-green',
    scorecard: {
      'run-50a': {
        runId: 'run-50a',
        status: GREEN,
        gateGreen: true,
        fixRounds: 1,
        tokens: 240000,
        tokenBasis: 'ledger',
        tokenFallback: false,
        elapsedMs: 60000,
        pullRequest: pr('run-50a', 601),
        verdict: 'winner',
      },
      'run-50b': {
        runId: 'run-50b',
        status: 'parked',
        gateGreen: false,
        fixRounds: 0,
        tokens: 250000,
        tokenBasis: 'ledger',
        tokenFallback: false,
        elapsedMs: 60000,
        pullRequest: pr('run-50b', 602),
        verdict: 'lost',
      },
      'run-50c': verdict.scorecard['run-50c'],
    },
  })
}

// ---------------------------------------------------------------------------
// (b) The sole green beats parked and failed, and the stage says so.
{
  const fx = fixture([
    { runId: 'run-50a', status: 'parked', ledger: 100000, reported: 99000, rounds: 0, prNumber: 611 },
    { runId: 'run-50b', status: GREEN, ledger: 300000, reported: 299000, rounds: 4, prNumber: 612 },
    { runId: 'run-50c', status: 'failed', ledger: 10000, reported: 9000, rounds: 0 },
  ])
  const { verdict } = await judge(fx)
  assert.equal(verdict.winner, 'run-50b')
  assert.equal(verdict.decidingStage, 'gate-green')
  assert.deepEqual(Object.keys(verdict), ['winner', 'decidingStage', 'scorecard'])
  assert.deepEqual(
    Object.keys(verdict.scorecard).map((k) => verdict.scorecard[k].verdict),
    ['lost', 'winner', 'lost'],
  )
  assert.deepEqual(verdict.scorecard['run-50c'].pullRequest, null)
}

// ---------------------------------------------------------------------------
// (c) Two greens: fewer fix rounds wins, counted from the store fixtures.
{
  const fx = fixture([
    { runId: 'run-50a', status: GREEN, ledger: 100000, reported: 99000, rounds: 2, prNumber: 621 },
    { runId: 'run-50b', status: GREEN, ledger: 100000, reported: 99000, rounds: 1, prNumber: 622 },
    { runId: 'run-50c', status: 'parked', ledger: 1, reported: 1, rounds: 0 },
  ])
  const { verdict } = await judge(fx)
  assert.equal(verdict.winner, 'run-50b')
  assert.equal(verdict.decidingStage, 'fix-rounds')
  assert.equal(verdict.scorecard['run-50a'].fixRounds, 2)   // starts only, not starts+ends
  assert.equal(verdict.scorecard['run-50b'].fixRounds, 1)
}

// ---------------------------------------------------------------------------
// (d) Fix-round tie: fewer ledger tokens wins. One null ledger and every entry
//     falls back to `reported`, flagged.
{
  const fx = fixture([
    { runId: 'run-50a', status: GREEN, ledger: 240000, reported: 200000, rounds: 1, prNumber: 631 },
    { runId: 'run-50b', status: GREEN, ledger: 230000, reported: 210000, rounds: 1, prNumber: 632 },
  ])
  const { verdict } = await judge(fx)
  assert.equal(verdict.winner, 'run-50b')
  assert.equal(verdict.decidingStage, 'tokens')
  assert.equal(verdict.scorecard['run-50a'].tokens, 240000)
  assert.equal(verdict.scorecard['run-50b'].tokens, 230000)
  assert.deepEqual(
    Object.values(verdict.scorecard).map((e) => [e.tokenBasis, e.tokenFallback]),
    [['ledger', false], ['ledger', false]],
  )

  const fb = fixture([
    { runId: 'run-50a', status: GREEN, ledger: null, reported: 200000, rounds: 1, prNumber: 641 },
    { runId: 'run-50b', status: GREEN, ledger: 230000, reported: 210000, rounds: 1, prNumber: 642 },
  ])
  const fallback = (await judge(fb)).verdict
  assert.equal(fallback.winner, 'run-50a')      // reported for all, not one basis each
  assert.equal(fallback.decidingStage, 'tokens')
  assert.equal(fallback.scorecard['run-50a'].tokens, 200000)
  assert.equal(fallback.scorecard['run-50b'].tokens, 210000)
  assert.deepEqual(
    Object.values(fallback.scorecard).map((e) => [e.tokenBasis, e.tokenFallback]),
    [['reported', true], ['reported', true]],
  )
}

// ---------------------------------------------------------------------------
// (e) Everything measurable ties: the name breaks it.
{
  const fx = fixture([
    { runId: 'run-50c', status: GREEN, ledger: 100000, reported: 99000, rounds: 1, prNumber: 651 },
    { runId: 'run-50b', status: GREEN, ledger: 100000, reported: 99000, rounds: 1, prNumber: 652 },
    { runId: 'run-50a', status: GREEN, ledger: 100000, reported: 99000, rounds: 1, prNumber: 653 },
  ])
  const { verdict } = await judge(fx)
  assert.equal(verdict.winner, 'run-50a')
  assert.equal(verdict.decidingStage, 'runid-lexicographic')
}

// ---------------------------------------------------------------------------
// (f) Zero greens is a FAILED race: no winner, and the printout hands the
//     operator every PR to close. The judge itself closes nothing.
{
  const fx = fixture([
    { runId: 'run-50a', status: 'parked', ledger: 100000, reported: 99000, rounds: 0, prNumber: 661 },
    { runId: 'run-50b', status: 'failed', ledger: 120000, reported: 119000, rounds: 3, prNumber: 662 },
  ])
  const { verdict, out } = await judge(fx)
  assert.equal(verdict.winner, null)
  assert.equal(verdict.decidingStage, 'gate-green')
  assert.equal(out.filter((line) => line.includes('FAILED')).length, 1)
  const closes = out.filter((line) => line.includes('close #'))
  assert.equal(closes.length, 2)
  assert.ok(closes.some((line) => line.includes('ultra/integration-run-50a')))
  assert.ok(closes.some((line) => line.includes('ultra/integration-run-50b')))
  assert.deepEqual(onDisk(fx.dir).verdict.winner, null)
}

// ---------------------------------------------------------------------------
// (g) The appended verdict leaves the pre-registered dials byte-identical, and
//     the scorecard is keyed by runId with the compared figures named.
// (j) stdout received exactly the lines verdictLines returns, in order.
{
  const fx = fixture([
    { runId: 'run-50a', status: GREEN, ledger: 240000, reported: 239564, rounds: 1, prNumber: 671 },
    { runId: 'run-50b', status: 'parked', ledger: 250000, reported: 249000, rounds: 0, prNumber: 672 },
  ])
  const before = onDisk(fx.dir)
  const { verdict, out } = await judge(fx)
  const after = onDisk(fx.dir)
  for (const key of ['raceId', 'planPath', 'baseCommit', 'k', 'launchedAt', 'runs', 'dials']) {
    assert.equal(JSON.stringify(after[key]), JSON.stringify(before[key]), key)
  }
  assert.deepEqual(Object.keys(after), [...Object.keys(before), 'verdict'])
  assert.deepEqual(after.verdict, verdict)
  assert.deepEqual(Object.keys(after.dials), Object.keys(DIALS))
  assert.deepEqual(Object.keys(verdict.scorecard), ['run-50a', 'run-50b'])
  for (const runId of Object.keys(verdict.scorecard)) {
    const entry = verdict.scorecard[runId]
    assert.equal(entry.runId, runId)
    for (const field of ['status', 'gateGreen', 'fixRounds', 'tokens', 'tokenBasis',
                         'tokenFallback', 'elapsedMs', 'pullRequest', 'verdict']) {
      assert.ok(field in entry, `${runId}.${field}`)
    }
  }
  assert.deepEqual(out, verdictLines({
    raceId: RACE,
    winner: verdict.winner,
    decidingStage: verdict.decidingStage,
    scorecard: verdict.scorecard,
    verdictPath: manifestPath(fx.dir, RACE),
  }))
  assert.equal(out[0], `race ${RACE}: winner run-50a — decided by gate-green`)
}

// ---------------------------------------------------------------------------
// (h) A store the judge cannot read is `fixRounds: null` — a loss at that
//     stage — never an aborted verdict.
{
  const fx = fixture([
    { runId: 'run-50a', status: GREEN, ledger: 100000, reported: 99000, storeMissing: true, prNumber: 681 },
    { runId: 'run-50b', status: GREEN, ledger: 100000, reported: 99000, rounds: 2, prNumber: 682 },
  ])
  const { verdict } = await judge(fx)
  assert.equal(verdict.scorecard['run-50a'].fixRounds, null)
  assert.equal(verdict.scorecard['run-50b'].fixRounds, 2)
  assert.equal(verdict.winner, 'run-50b')
  assert.equal(verdict.decidingStage, 'fix-rounds')
}

// ---------------------------------------------------------------------------
// (i) The rubric assertion binds the pre-registered dials to the comparator
//     that actually ran: a drifted `dials.rubric` throws before any write.
{
  const fx = fixture([
    { runId: 'run-50a', status: GREEN, ledger: 100000, reported: 99000, rounds: 0, prNumber: 691 },
  ])
  const file = manifestPath(fx.dir, RACE)
  const drifted = JSON.parse(fs.readFileSync(file, 'utf8'))
  drifted.dials.rubric = ['gate-green', 'tokens', 'fix-rounds', 'runid-lexicographic']
  assert.notDeepEqual(drifted.dials.rubric, [...STAGES])
  fs.writeFileSync(file, `${JSON.stringify(drifted, null, 2)}\n`)
  await assert.rejects(
    judgeRace(fx.argv, { ...fx.deps, stdout: () => {} }),
    (err) => err instanceof Error && err.message.includes('rubric'),
  )
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), drifted)   // nothing written
}

console.log('ALL TESTS PASSED')
