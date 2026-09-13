/**
 * fleet/tests/test_readiness_fold_order.mjs — the fold-order sim (#832, #810
 * Phase C gate).
 *
 * The claim it measures: for every fixture patch set, every sequential
 * adoption order yields the same tree as the simultaneous fold.
 *
 * Model-free by construction: no model process is started here, and no reply to
 * a conflict is produced while the sim runs — every reply is a committed file
 * under `fleet/tests/fixtures/readiness-corpus/replies/`, copied byte for byte
 * into the directory `resolve` is handed. The kernel is the real one
 * (`skills/ultrapowers/kernel/fold_wave.py`), driven over its CLI; the sim
 * measures it and never patches it.
 *
 * The sets, in the order they are run and printed:
 *
 *   wave-1 … wave-5      the corpus `corpuslib.make_fixture_corpus` builds —
 *                        disjoint files, commuting appends at one anchor, the
 *                        rewrite over an inner edit (one `lines` conflict on
 *                        `d.txt`, answered from the committed reply in both
 *                        modes), deletion adjacency plus a binary path, and an
 *                        agreed whole-file deletion.
 *   negative-control     wave 3's conflicting pair with its committed reply
 *                        chosen by the step index at which one side of the
 *                        conflict was adopted. Its orders diverge; the sim
 *                        reports it `caught` and counts that a pass.
 *   <fixture>            one per directory holding a `manifest.json` under
 *                        `READINESS_FIXTURES_DIR`, or under
 *                        `fleet/tests/fixtures/readiness/` when that is unset.
 *                        Absent or empty, the corpus and the control run alone.
 *                        `READINESS_ORDERS=all` runs every sampled order over
 *                        them (the reading); unset it runs the first 2, so a
 *                        suite pass fits the bridge's 300 s cap.
 *
 * The soft-edges pair (wave 2's `2b` re-captured against the head that adopted
 * `2a`, folded with that head as its recorded base) is measured too, but it is
 * not a set: it prints no line, because the set lines are a census and it is a
 * second reading of wave 2.
 *
 * Stdout is exactly one line per set plus the sentinel, so a reader can parse
 * it without knowing anything else about this file. Everything else — what is
 * being built, what failed — goes to stderr.
 *
 * Every set's assertions:
 *   1  every order's candidate `^{tree}` equals the simultaneous fold's
 *      (inverted for the control, which must diverge and must diverge between
 *      orders, not merely from the simultaneous fold)
 *   2  every order's set of narrated `(path, kind)` pairs equals the
 *      simultaneous fold's
 *   3  a wave that spends a reply spends the SAME committed file in both modes
 *   4  the line, and the cost of one order, are printed as the set finishes
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import {
  FIXTURES_ROOT,
  buildCorpus,
  corpusWaveSpec,
  discoverFixtureSets,
  fixtureSetSpec,
  mkTemp,
  negativeControlSpec,
  runSet,
  setLine,
  softEdgesSpec,
  sampledOrders,
} from './_readiness_helpers.mjs'

const note = (message) => process.stderr.write(message + '\n')
const emit = (result) => process.stdout.write(setLine(result) + '\n')

/**
 * The reading every set gets. `expect` is the verdict the set is supposed to
 * carry; a set that diverges when it should not fails the sim here, and is
 * never patched around.
 */
function measure (result, expect) {
  assert.equal(result.verdict, expect,
    result.name + ': expected the fold to read ' + expect + ', got ' + result.verdict
    + ' (sim ' + result.simTree + ', orders '
    + result.orders.map((o) => o.ids.join('>') + '=' + o.tree).join(' ') + ')')

  if (expect === 'ok') {
    for (const order of result.orders) {
      assert.equal(order.tree, result.simTree,
        result.name + ': order ' + order.ids.join('>') + ' folded to ' + order.tree
        + ', the simultaneous fold to ' + result.simTree)
    }
  }

  for (const order of result.orders) {
    assert.deepEqual(order.conflictKeys, result.simConflictKeys,
      result.name + ': order ' + order.ids.join('>') + ' narrated '
      + JSON.stringify(order.conflictKeys) + ', the simultaneous fold '
      + JSON.stringify(result.simConflictKeys))
  }
  return result
}

/** One committed reply, spent identically by both modes (assertion 3). */
function sameReplyBothModes (result) {
  assert.ok(result.repliesUsed.length > 0,
    result.name + ': the simultaneous fold spent no reply')
  for (const order of result.orders) {
    assert.deepEqual(order.repliesUsed, result.repliesUsed,
      result.name + ': order ' + order.ids.join('>') + ' spent '
      + JSON.stringify(order.repliesUsed) + ', the simultaneous fold '
      + JSON.stringify(result.repliesUsed))
  }
}

function main () {
  const work = mkTemp('readiness-fold-order-')
  note('workspace ' + work)

  // The corpus first: it is the cheapest work in the run, and every set that
  // follows is built out of it.
  const corpus = buildCorpus(path.join(work, 'corpus'))
  note('corpus base ' + corpus.base + ' in ' + corpus.repo)

  const trees = new Map()
  for (const wave of corpus.waves) {
    const result = runSet(corpusWaveSpec(corpus, wave, { workDir: path.join(work, 'wave-' + wave) }))
    measure(result, 'ok')
    // Wave 3 is the one corpus wave a resolver answers; its reply is one
    // committed file whichever side the narration labelled `frontier`.
    if (result.repliesUsed.length) sameReplyBothModes(result)
    trees.set(wave, result.simTree)
    emit(result)
  }

  // The control: not a wave that happens to fail, a divergence built on
  // purpose, so `caught` is a reading the sim can produce and not a word it
  // never says.
  const control = measure(
    runSet(negativeControlSpec(corpus, path.join(work, 'negative-control'))), 'caught')
  const controlTrees = new Set(control.orders.map((o) => o.tree))
  assert.ok(controlTrees.size >= 2,
    'negative-control: every order folded to the same tree (' + [...controlTrees].join(', ')
    + '); the control caught nothing')
  emit(control)

  // The soft-edges pair (M7): a task that waited for another, capturing
  // against the head that adopted it, still lands the simultaneous tree.
  const soft = runSet(softEdgesSpec(corpus, path.join(work, 'soft-edges')))
  measure(soft, 'ok')
  assert.equal(soft.simTree, trees.get(2),
    'soft-edges: 2b re-captured against the head that adopted 2a folded to '
    + soft.simTree + ', wave 2 folded to ' + trees.get(2))
  note('soft-edges ' + soft.simTree + ' — wave 2\'s tree from its recorded base')

  // The real-join sets, run exactly like a corpus wave — but the suite's pass
  // over them is capped: a real-join set costs tens of kernel calls per order
  // (contend-wide: 23 × 20 orders, ~6 minutes on a laptop), and the bridge
  // holds every sim file to 300 s. `READINESS_ORDERS=all` is the reading —
  // every order `sampled_orders` returns, what a plan's `Run:` asks for and
  // what the record carries; unset, or a number, the first that many of the
  // kernel's sampled orders run (default 2: the identity and one shuffle), the
  // identity always first, so a suite pass still folds every fixture both ways
  // and the line's `orders=` says how many it read.
  const root = process.env.READINESS_FIXTURES_DIR || FIXTURES_ROOT
  const dirs = discoverFixtureSets(root)
  const ordersKnob = process.env.READINESS_ORDERS || '2'
  const capOrders = (n) => {
    const all = sampledOrders(n)
    if (ordersKnob === 'all') return all
    const k = Math.max(1, parseInt(ordersKnob, 10) || 2)
    return all.slice(0, k)
  }
  note('fixture root ' + root + ': ' + dirs.length + ' set(s); orders '
    + (ordersKnob === 'all' ? 'all (the reading)' : 'first ' + ordersKnob + ' (READINESS_ORDERS=all for the reading)'))
  for (const dir of dirs) {
    const setWork = path.join(work, 'fixtures', path.basename(dir))
    fs.mkdirSync(setWork, { recursive: true })
    const spec = fixtureSetSpec(dir, setWork)
    emit(measure(runSet({ ...spec, orders: capOrders(spec.tasks.length) }), 'ok'))
  }

  process.stdout.write('ALL TESTS PASSED\n')
}

try {
  main()
} catch (error) {
  note(String((error && error.stack) || error))
  process.exitCode = 1
}
