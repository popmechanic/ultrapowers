import assert from 'node:assert/strict'
import { scorecardLine, prLine, verdictLines } from '../race-report.mjs'

const entry = (runId, over = {}) => ({
  runId,
  status: 'gate-green',
  gateGreen: true,
  fixRounds: 0,
  tokens: 100000,
  tokenBasis: 'ledger',
  tokenFallback: false,
  elapsedMs: 60000,
  pullRequest: { number: 529, url: 'https://x/529', branch: `ultra/integration-${runId}` },
  verdict: 'lost',
  ...over,
})

// (a) the green winner renders every field of the schema literal, in order.
assert.equal(
  scorecardLine(entry('race-48-b', {
    fixRounds: 1,
    tokens: 267351,
    tokenBasis: 'ledger',
    pullRequest: { number: 530, url: 'https://x/530', branch: 'ultra/integration-race-48-b' },
    verdict: 'winner',
  })),
  '  race-48-b status=gate-green fix-rounds=1 tokens=267351 (ledger) pr=#530 ultra/integration-race-48-b verdict=winner',
)

// (b) nulls print as the word null; the ledger fallback is named next to the basis.
const missing = entry('race-48-c', {
  status: 'crashed',
  gateGreen: false,
  fixRounds: null,
  tokens: null,
  tokenBasis: 'reported',
  tokenFallback: true,
  pullRequest: null,
  verdict: 'no-record',
})
const missingLine = scorecardLine(missing)
assert.equal(
  missingLine,
  '  race-48-c status=crashed fix-rounds=null tokens=null (reported, ledger-fallback) pr=none verdict=no-record',
)
for (const part of ['fix-rounds=null', 'tokens=null', '(reported, ledger-fallback)', 'pr=none', 'verdict=no-record']) {
  assert.ok(missingLine.includes(part), part)
}

const scorecard = {                                   // deliberately not in runId order
  'race-48-c': entry('race-48-c', { fixRounds: 3, pullRequest: { number: 531, url: 'https://x/531', branch: 'ultra/integration-race-48-c' } }),
  'race-48-a': entry('race-48-a', { fixRounds: 2 }),
  'race-48-b': entry('race-48-b', {
    fixRounds: 1,
    tokens: 267351,
    pullRequest: { number: 530, url: 'https://x/530', branch: 'ultra/integration-race-48-b' },
    verdict: 'winner',
  }),
}

// (c) a decided race: headline, scorecard in runId order, path. No pr lines.
const won = verdictLines({
  raceId: 'race-48',
  winner: 'race-48-b',
  decidingStage: 'fix-rounds',
  scorecard,
  verdictPath: '/e/race-race-48.json',
})
assert.deepEqual(won, [
  'race race-48: winner race-48-b — decided by fix-rounds',
  '  race-48-a status=gate-green fix-rounds=2 tokens=100000 (ledger) pr=#529 ultra/integration-race-48-a verdict=lost',
  '  race-48-b status=gate-green fix-rounds=1 tokens=267351 (ledger) pr=#530 ultra/integration-race-48-b verdict=winner',
  '  race-48-c status=gate-green fix-rounds=3 tokens=100000 (ledger) pr=#531 ultra/integration-race-48-c verdict=lost',
  'verdict: /e/race-race-48.json',
])
assert.equal(won.filter((l) => l.startsWith('  close ')).length, 0)

// (d) no winner: the FAILED headline, then one pr line per entry for the operator.
const failed = verdictLines({
  raceId: 'race-48',
  winner: null,
  decidingStage: null,
  scorecard,
  verdictPath: '/e/race-race-48.json',
})
assert.deepEqual(failed, [
  'race race-48: FAILED — no attempt reached gate-green',
  '  race-48-a status=gate-green fix-rounds=2 tokens=100000 (ledger) pr=#529 ultra/integration-race-48-a verdict=lost',
  '  race-48-b status=gate-green fix-rounds=1 tokens=267351 (ledger) pr=#530 ultra/integration-race-48-b verdict=winner',
  '  race-48-c status=gate-green fix-rounds=3 tokens=100000 (ledger) pr=#531 ultra/integration-race-48-c verdict=lost',
  '  close #529 ultra/integration-race-48-a (race-48-a)',
  '  close #530 ultra/integration-race-48-b (race-48-b)',
  '  close #531 ultra/integration-race-48-c (race-48-c)',
  'verdict: /e/race-race-48.json',
])
const prLines = failed.filter((l) => l.startsWith('  close '))
assert.equal(prLines.length, 3)
for (const [i, runId] of ['race-48-a', 'race-48-b', 'race-48-c'].entries()) {
  const e = scorecard[runId]
  assert.ok(prLines[i].includes(`#${e.pullRequest.number}`), prLines[i])
  assert.ok(prLines[i].includes(e.pullRequest.branch), prLines[i])
}
// an entry that never opened a PR still gets its line, and names nothing to close.
assert.equal(prLine(missing), '  race-48-c pr=none (nothing to close)')

// (e) every element is one line: the printout is line-per-attempt by construction.
for (const line of [...won, ...failed, scorecardLine(missing), prLine(missing)]) {
  assert.ok(!line.includes('\n'), JSON.stringify(line))
}

// pure: rendering does not touch the entries it was handed.
assert.deepEqual(scorecard['race-48-a'], entry('race-48-a', { fixRounds: 2 }))

console.log('ALL TESTS PASSED')
