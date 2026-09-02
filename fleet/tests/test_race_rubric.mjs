// fleet/tests/test_race_rubric.mjs — the comparator's nine legs.
//
// The rubric is an ordered sieve, not a score: each stage drops entries, and
// the first stage that leaves exactly one names itself as `decidingStage`.
// Every leg below asserts the whole returned object by equality, because the
// stage name is half the answer — a run that wins on tokens and a run that
// wins on fix rounds are different findings about the race.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { STAGES, selectWinner, tokenBasis, worstIfNull } from '../race-rubric.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))

// (h) STAGES is the literal, once, frozen. The judge asserts the manifest's
// `dials.rubric` deep-equals this array, so a re-typed string here is a
// judge-time failure there.
assert.deepEqual(STAGES, ['gate-green', 'fix-rounds', 'tokens', 'runid-lexicographic'])
assert.ok(Object.isFrozen(STAGES))
assert.throws(() => STAGES.push('cheapest'), TypeError)
assert.throws(() => {
  STAGES[0] = 'gate-red'
}, TypeError)
assert.deepEqual(STAGES, ['gate-green', 'fix-rounds', 'tokens', 'runid-lexicographic'])

// (a) One green among parked and failed entries: the gate alone decides.
assert.deepEqual(
  selectWinner([
    { runId: 'run-51-a', gateGreen: false, fixRounds: 0, tokens: 100000 },
    { runId: 'run-51-b', gateGreen: true, fixRounds: 4, tokens: 900000 },
    { runId: 'run-51-c', gateGreen: false, fixRounds: 1, tokens: 200000 },
  ]),
  { winner: 'run-51-b', decidingStage: 'gate-green' },
)

// (b) Two greens, fix rounds 2 and 0 — fewest wins.
assert.deepEqual(
  selectWinner([
    { runId: 'run-51-a', gateGreen: true, fixRounds: 2, tokens: 100000 },
    { runId: 'run-51-b', gateGreen: true, fixRounds: 0, tokens: 900000 },
  ]),
  { winner: 'run-51-b', decidingStage: 'fix-rounds' },
)

// (c) Fix-round tie, tokens 500000 vs 400000 — fewest tokens wins.
assert.deepEqual(
  selectWinner([
    { runId: 'run-51-a', gateGreen: true, fixRounds: 1, tokens: 500000 },
    { runId: 'run-51-b', gateGreen: true, fixRounds: 1, tokens: 400000 },
  ]),
  { winner: 'run-51-b', decidingStage: 'tokens' },
)

// (d) Full tie — the lexicographically least runId wins, and says so.
assert.deepEqual(
  selectWinner([
    { runId: 'run-51-c', gateGreen: true, fixRounds: 1, tokens: 400000 },
    { runId: 'run-51-a', gateGreen: true, fixRounds: 1, tokens: 400000 },
    { runId: 'run-51-b', gateGreen: true, fixRounds: 1, tokens: 400000 },
  ]),
  { winner: 'run-51-a', decidingStage: 'runid-lexicographic' },
)

// (e) Zero greens — no winner, and the gate is what decided that.
assert.deepEqual(
  selectWinner([
    { runId: 'run-51-a', gateGreen: false, fixRounds: 0, tokens: 100000 },
    { runId: 'run-51-b', gateGreen: false, fixRounds: 0, tokens: 100000 },
  ]),
  { winner: null, decidingStage: 'gate-green' },
)

// (f) An unknown count never wins a comparison it never entered: `null` loses
// to any number, at either stage.
assert.deepEqual(
  selectWinner([
    { runId: 'run-51-a', gateGreen: true, fixRounds: null, tokens: 100000 },
    { runId: 'run-51-b', gateGreen: true, fixRounds: 3, tokens: 900000 },
  ]),
  { winner: 'run-51-b', decidingStage: 'fix-rounds' },
)
assert.deepEqual(
  selectWinner([
    { runId: 'run-51-a', gateGreen: true, fixRounds: 2, tokens: null },
    { runId: 'run-51-b', gateGreen: true, fixRounds: 2, tokens: 900000 },
  ]),
  { winner: 'run-51-b', decidingStage: 'tokens' },
)

// (i) No entries at all is the zero-green case, not a crash.
assert.deepEqual(selectWinner([]), { winner: null, decidingStage: 'gate-green' })

// (g) The token basis is `ledger` only when every ledger is a number; one null
// drops the whole race to the reported figures and flags the fallback.
assert.deepEqual(
  tokenBasis([
    { runId: 'run-51-a', ledger: 400000 },
    { runId: 'run-51-b', ledger: 0 },
  ]),
  { basis: 'ledger', fallback: false },
)
assert.deepEqual(
  tokenBasis([
    { runId: 'run-51-a', ledger: 400000 },
    { runId: 'run-51-b', ledger: null },
  ]),
  { basis: 'reported', fallback: true },
)
assert.deepEqual(
  tokenBasis([{ runId: 'run-51-a' }]),
  { basis: 'reported', fallback: true },
)

// `worstIfNull` is the whole reason `null` loses: it is the sort key, exported
// so the judge's scorecard orders rows the same way the winner was picked.
assert.equal(worstIfNull(0), 0)
assert.equal(worstIfNull(400000), 400000)
assert.equal(worstIfNull(-1), -1)
assert.equal(worstIfNull(null), Infinity)
assert.equal(worstIfNull(undefined), Infinity)
assert.equal(worstIfNull('400000'), Infinity)
assert.equal(worstIfNull(NaN), Infinity)
assert.equal(worstIfNull(Infinity), Infinity)

// The comparator is pure: it decides over entries handed to it and never reads
// a manifest itself. A filesystem import here would make the judge's evidence
// gathering unreviewable from the judge's own module.
const SOURCE = fs.readFileSync(path.join(HERE, '..', 'race-rubric.mjs'), 'utf8')
assert.ok(!/from ['"]node:(fs|child_process)['"]/.test(SOURCE))
assert.ok(!SOURCE.includes('readFileSync'))

console.log('ALL TESTS PASSED')
