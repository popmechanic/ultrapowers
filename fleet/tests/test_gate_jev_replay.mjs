// The gate Jev replay's scoring (#1528): which rounds are replayed, how they are scored, the exit code
// and the summary line. Pure: no spawn, no file reads.
import assert from 'node:assert/strict'
import { exitCode, replayRounds, score, summary } from './_gate_replay_helpers.mjs'

const rec = {
  tasks: {
    1: {
      gate_rounds: [
        { agent: 'pass', jev: 'fail', right: 'agent' },
        { agent: 'pass', jev: 'fail', right: 'jev' },
        { agent: 'fail', jev: 'fail' },
        { agent: 'pass', jev: 'pass' },
        { agent: 'pass', jev: 'fail' },
        { agent: 'fail', jev: 'pass', right: 'agent' },
      ],
    },
    2: { gate_rounds: [{ agent: 'fail', jev: null }] },
  },
}
const items = replayRounds(rec)
assert.deepEqual(items.map((x) => [x.task, x.round, x.side]),
  [['1', 1, 'wrong'], ['1', 2, 'right'], ['1', 3, 'agreed'], ['1', 6, 'other']])

const byRound = { 1: ['pass', 'pass', 'fail'], 2: ['fail'], 3: ['pass', 'pass', 'fail'], 6: ['fail'] }
const s = score(items, (item) => byRound[item.round])
assert.deepEqual(s, { wrong: 1, wrongPass: 1, right: 1, rightFail: 1, agreed: 1, agreedPass: 1 })

assert.equal(exitCode(s, true), 1)
assert.equal(exitCode({ ...s, agreedPass: 0 }, true), 0)
assert.equal(exitCode({ ...s, agreedPass: 0 }, false), 1)
assert.equal(exitCode({ wrong: 3, wrongPass: 1, agreedPass: 0 }, true), 1)
assert.equal(exitCode({ wrong: 0, wrongPass: 0, agreed: 0, agreedPass: 0 }, true), 2)
assert.equal(exitCode({ agreed: 2, agreedPass: 0, wrong: 0, wrongPass: 0 }, true), 0)

assert.equal(summary(s, '2026-09-29..2026-09-30', true),
  'gate-jev replay: n=3 rounds (2026-09-29..2026-09-30), wrong fails now pass 1 of 1, right fails now fail 1 of 1, '
  + 'agreed fails now pass 1 of 1, controls ok')

console.log('ALL TESTS PASSED')
