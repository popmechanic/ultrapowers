/**
 * fleet/tests/test_factory_pair_label.mjs — the exam for Task: *A pair's label
 * reads the fold of whichever task folded later, and tells a union from a
 * resolver*.
 *
 * This file is the Proof's `Test:`, written whole at the path the Proof
 * names. The deliverable under test is `factory/pairs.mjs`'s `labelPair`,
 * imported directly — a pure async function, no rig, no child process.
 *
 * The Machine clauses under test, restated so a reader can map every
 * assertion back to the contract:
 *
 *   M1 — `labelPair({ pair: { a: '4', b: '7' }, tasks, read, folds: { '4':
 *        'resolved', '7': 'clean' }, foldOrder: ['7', '4'] })` answers `fold`
 *        exactly `'resolved'` — task `4` folded later, so its outcome is the
 *        pair's — and with `foldOrder: ['4', '7']` the same call answers
 *        `fold` exactly `'clean'`.
 *   M2 — With `foldOrder: ['7']` and `folds: { '7': 'parked' }` — only one of
 *        the pair ever reached the fold — `fold` is exactly `'parked'`; with
 *        `foldOrder: []` and `folds: {}` it is exactly `null`; and a call
 *        that passes no `foldOrder` at all answers what it answers today,
 *        `folds[pair.b]` or `null`.
 *
 * M3 (the `factory/engine.mjs` half of this task — `foldIn`'s three-way
 * outcome, the fold order it keeps, and the `pair:label` block handing that
 * order to `labelPair`) is NOT exercised here: the task says plainly "the
 * exam carries no engine rig" and that M3 is read against the diff at
 * landing. This exam's own `Run:` grep line (`grep -q "foldOrder"
 * factory/engine.mjs`) is the driver's to execute, not this file's.
 *
 * The legs, in the order they run here:
 *
 *   (a) [M1] the later-folded task's outcome wins, both orderings of the same
 *       two-entry `folds`.
 *   (b) [M2] one entry present in `foldOrder`, neither entry present, and no
 *       `foldOrder` key at all (today's behavior, unchanged).
 *
 * What this exam assumes of the code under test: `labelPair` is exported
 * from `factory/pairs.mjs`, is an async function (or ordinary function
 * returning a value/promise — the exam only ever awaits its result), and
 * that `tasks`/`read` are otherwise unused by the part of `labelPair` this
 * exam drives (the task text confirms `read` and `tasks` may be minimal —
 * `read` a no-op resolving `''`, tasks with empty `proofTests` — since
 * `pair.symbol` is absent in the pair fixture used and `calls` therefore
 * comes back `null`, which this exam does not assert, per the task's own
 * instruction).
 */
import assert from 'node:assert/strict'

import { labelPair } from '../../factory/pairs.mjs'

/** The two tasks named in the task text: no `symbol` on `pair` below, so
 *  `proofTests` is never read, but the shape is supplied all the same. */
const tasks = [
  { id: '4', proofTests: [] },
  { id: '7', proofTests: [] },
]

/** `read` is never reached (no `pair.symbol`), but `labelPair` is handed a
 *  real async function per the task's own description of it. */
const read = async () => ''

const pair = { a: '4', b: '7' }

// ══════════════════════════════════════════════════════════════════════════
// (a) [M1] the later-folded task's outcome is the pair's, either ordering
// ══════════════════════════════════════════════════════════════════════════

{
  const folds = { '4': 'resolved', '7': 'clean' }

  const later4 = await labelPair({ pair, tasks, read, folds, foldOrder: ['7', '4'] })
  assert.equal(later4.fold, 'resolved',
    '(a) [M1] with foldOrder [\'7\', \'4\'] task 4 folded later, so `fold` reads ' +
    'its outcome, \'resolved\'; got ' + JSON.stringify(later4.fold))

  const later7 = await labelPair({ pair, tasks, read, folds, foldOrder: ['4', '7'] })
  assert.equal(later7.fold, 'clean',
    '(a) [M1] with foldOrder [\'4\', \'7\'] task 7 folded later, so `fold` reads ' +
    'its outcome, \'clean\'; got ' + JSON.stringify(later7.fold))
}

// ══════════════════════════════════════════════════════════════════════════
// (b) [M2] one side present, neither present, and no foldOrder at all
// ══════════════════════════════════════════════════════════════════════════

{
  // Only task 7 ever reached the fold.
  const onlyOne = await labelPair({
    pair, tasks, read, folds: { '7': 'parked' }, foldOrder: ['7'],
  })
  assert.equal(onlyOne.fold, 'parked',
    '(b) [M2] with foldOrder [\'7\'] and folds { 7: \'parked\' } — only one of ' +
    'the pair present — `fold` is exactly \'parked\'; got ' + JSON.stringify(onlyOne.fold))

  // Neither task ever reached the fold.
  const neither = await labelPair({
    pair, tasks, read, folds: {}, foldOrder: [],
  })
  assert.equal(neither.fold, null,
    '(b) [M2] with foldOrder [] and folds {} — neither of the pair present — ' +
    '`fold` is exactly null; got ' + JSON.stringify(neither.fold))

  // No foldOrder key at all: today's behavior, unchanged — folds[pair.b].
  const noOrderArg = { pair, tasks, read, folds: { '4': 'resolved', '7': 'clean' } }
  assert.ok(!Object.prototype.hasOwnProperty.call(noOrderArg, 'foldOrder'),
    '(b) [M2] sanity: the call below truly omits the `foldOrder` key.')
  const legacy = await labelPair(noOrderArg)
  assert.equal(legacy.fold, 'clean',
    '(b) [M2] a call with no `foldOrder` at all answers what it answers today, ' +
    'folds[pair.b] (here folds[\'7\'] = \'clean\'); got ' + JSON.stringify(legacy.fold))
}

console.log('ALL TESTS PASSED')
