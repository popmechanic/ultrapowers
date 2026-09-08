/**
 * fleet/tests/test_sandbox_boot_exams.mjs — the boot script strips the
 * reserved exam directories before every push of the run's branch.
 *
 * The exam is written against the task's Machine clauses, leg by leg. Each
 * assertion names the leg it belongs to and the clause it comes from, so a
 * reader can map this file back to the contract:
 *
 *   M3  `push_head` in `fleet/sandbox-boot.sh` runs
 *       `bash "$ENGINE_REPO_DIR/fleet/strip-exams.sh" "$TARGET_DIR" "$BRANCH"
 *       "$RUN_ID" "$EVIDENCE_DIR/$EVIDENCE_PATH"` before its push, on attempt
 *       1 and again on attempt 2, each time after that attempt's fold unit;
 *       and the run's last evidence push (`done`) comes after the strip, so
 *       `exams/` rides the commit the evidence tag marks.
 *
 * M1 and M2 — the script's own behaviour — are proven against real git in
 * `fleet/tests/test_strip_exams.mjs`; M4 (the contract sentence) is proven by
 * the task's scoped `Run:` lines. Nothing here reads a document.
 *
 * The rig is `_sandbox_boot_helpers.mjs` — `makeHome`, `bootAsync`, the log
 * readers and `runTests` — shared with the other halves of the boot exam. The
 * strip is a real script the boot script invokes by path out of the engine
 * checkout, so the rig's `makeHome` writes a STUB of it beside `run-main.mjs`
 * and `publish-fold.mjs`, one that appends a `CALL strip-exams <argv…>` line
 * to `$FLEET_HOME/fleet-boot.log` in the `say` shape of `PRELUDE` and exits 0.
 * That is what puts the call into the ONE STREAM every other external call is
 * in, which is the only place a question about order can be answered.
 *
 * So every assertion below is an index comparison in `stream(ctx)`, and the
 * argv assertion is an equality against the four words M3 spells.
 */

import assert from 'node:assert/strict'

import {
  INTEGRATION_BRANCH, EVIDENCE_BRANCH, RUN_PATH, HEAD_SHA_2,
  makeHome, bootAsync, greenAsync as green,
  stream, gitLog, isEvidencePush, targetDir, evidenceDir,
  runTests,
} from './_sandbox_boot_helpers.mjs'

const tests = []
const test = (name, fn) => tests.push([name, fn])

// ── the run's literals ───────────────────────────────────────────────────────

const RUN_ID = 'run-7'
const FOLD_UNIT_1 = 'fleet-fold-7-1'
const FOLD_UNIT_2 = 'fleet-fold-7-2'
/** The one 405 body that buys the second fold, so the retry this leg reads is
 *  the retry `merge_pr` actually grants (`fleet/sandbox-boot.sh`). */
const NOT_MERGEABLE = 'Pull Request is not mergeable'

// ── readers over the one stream ──────────────────────────────────────────────

/** The four words M3 pins, for this home. */
const expectedArgv = (ctx) => [
  targetDir(ctx),
  INTEGRATION_BRANCH,
  RUN_ID,
  `${evidenceDir(ctx)}/${RUN_PATH}`,
]

const PREFIX = 'CALL strip-exams '
/** Every strip call, as `{ index, argv }` in stream order. */
const stripCalls = (ctx) =>
  stream(ctx)
    .map((l, index) => (l.startsWith(PREFIX) ? { index, argv: l.slice(PREFIX.length).split(' ') } : null))
    .filter(Boolean)

const isFoldLine = (unit) => (l) => l === `CALL systemd-run fold ${unit}`
/** A push of the run's own branch, leased or not. */
const isIntegrationPushLine = (l) =>
  l.startsWith('CALL git ') && l.endsWith(` origin ${INTEGRATION_BRANCH}`)
const isLeasedPushLine = (l) => isIntegrationPushLine(l) && l.includes('--force-with-lease=')
/** The stream's face of `isEvidencePush`: a push of `HEAD` onto the evidence
 *  branch, never one of the two record TAGS. */
const isEvidencePushLine = (l) =>
  l.startsWith('CALL git ') && l.includes(` push origin HEAD:refs/heads/${EVIDENCE_BRANCH}`)

const first = (ctx, pred) => stream(ctx).findIndex(pred)
const last = (ctx, pred) => {
  const s = stream(ctx)
  for (let i = s.length - 1; i >= 0; i -= 1) if (pred(s[i])) return i
  return -1
}
/** The failure sentence every leg hangs off: the stream itself. */
const why = (ctx) => `\n--- the boot's one stream:\n${stream(ctx).map((l, i) => `${i} ${l}`).join('\n')}\n`

const at = (ctx, pred, what, leg) => {
  const i = first(ctx, pred)
  assert.notEqual(i, -1, `${leg} the stream carries ${what}${why(ctx)}`)
  return i
}

// ── the two boots this file reads, both in flight at once ────────────────────

/** The retry: a 405 GitHub calls "not mergeable", and a tip that moves once
 *  attempt 2 has folded, so the second push is a leased one over a new head. */
const retryPromise = (() => {
  const ctx = makeHome()
  return bootAsync(ctx, ['boot'], {
    STUB_MERGE_CODE: '405',
    STUB_MERGE_MESSAGE: NOT_MERGEABLE,
    STUB_HEAD_SHA_2: HEAD_SHA_2,
  }).then((result) => {
    assert.equal(result.status, 0, result.stdout + result.stderr)
    return ctx
  })
})()

/** A run with nothing ahead of base: it parks before the fold and pushes no
 *  branch, so there is nothing to strip. */
const noCommitsPromise = (() => {
  const ctx = makeHome()
  return bootAsync(ctx, ['boot'], { STUB_NO_COMMITS: '1' }).then((result) => {
    assert.equal(result.status, 0, result.stdout + result.stderr)
    return ctx
  })
})()

// ── (d) the green boot  [M3] ─────────────────────────────────────────────────

test('the green boot strips once, with the argv M3 spells  [M3 / leg (d)]', async () => {
  const ctx = await green()
  const leg = '(d) [M3]'
  const calls = stripCalls(ctx)
  assert.equal(calls.length, 1,
    `${leg} exactly one strip — the green run folds once, so push_head runs once${why(ctx)}`)
  assert.deepEqual(calls[0].argv, expectedArgv(ctx),
    `${leg} <target-clone> <branch> <run-id> <evidence-dest>, exactly${why(ctx)}`)
})

test("the strip sits after the fold unit and before the branch's push  [M3 / leg (d)]", async () => {
  const ctx = await green()
  const leg = '(d) [M3]'
  const strip = at(ctx, (l) => l.startsWith(PREFIX), 'a `CALL strip-exams` line', leg)
  const fold = at(ctx, isFoldLine(FOLD_UNIT_1), `the ${FOLD_UNIT_1} unit`, leg)
  const push = at(ctx, isIntegrationPushLine, `a push of ${INTEGRATION_BRANCH}`, leg)
  assert.ok(fold < strip,
    `${leg} the strip comes after attempt 1's fold unit (${fold}) — it strips what the fold left; ` +
      `the strip was at ${strip}${why(ctx)}`)
  assert.ok(strip < push,
    `${leg} and before the first push of the branch (${push}), so the exams never reach the ` +
      `remote; the strip was at ${strip}${why(ctx)}`)
})

test("the run's last evidence push comes after the strip  [M3 / leg (d)]", async () => {
  const ctx = await green()
  const leg = '(d) [M3]'
  const strip = at(ctx, (l) => l.startsWith(PREFIX), 'a `CALL strip-exams` line', leg)
  const evidence = last(ctx, isEvidencePushLine)
  assert.notEqual(evidence, -1, `${leg} the run pushed the evidence branch${why(ctx)}`)
  assert.ok(strip < evidence,
    `${leg} the last (\`done\`) evidence push (${evidence}) is after the strip (${strip}), so ` +
      `exams/ rides the commit the evidence tag marks${why(ctx)}`)
  // The stream's reading of "an evidence push" is the rig's own predicate's.
  assert.equal(stream(ctx).filter(isEvidencePushLine).length,
    gitLog(ctx).filter(isEvidencePush).length,
    `${leg} the stream and isEvidencePush count the same pushes${why(ctx)}`)
})

test('a run with nothing ahead of base strips nothing at all  [M3 / leg (d)]', async () => {
  const ctx = await noCommitsPromise
  const leg = '(d) [M3]'
  assert.deepEqual(stripCalls(ctx).map((c) => c.argv), [],
    `${leg} a parked run pushes no branch, so push_head never runs and nothing is stripped${why(ctx)}`)
  assert.equal(first(ctx, isIntegrationPushLine), -1,
    `${leg} — and indeed it pushed no branch${why(ctx)}`)
})

// ── (e) the retry  [M3] ──────────────────────────────────────────────────────

test('a run that folds twice strips twice  [M3 / leg (e)]', async () => {
  const ctx = await retryPromise
  const leg = '(e) [M3]'
  const calls = stripCalls(ctx)
  assert.equal(calls.length, 2,
    `${leg} the exams return with every re-fold, so the strip is re-applied inside push_head on ` +
      `attempt 2 as well${why(ctx)}`)
  for (const [n, call] of calls.entries()) {
    assert.deepEqual(call.argv, expectedArgv(ctx),
      `${leg} strip ${n + 1} carries the same four words${why(ctx)}`)
  }
})

test("the second strip sits after the second fold and before the leased push  [M3 / leg (e)]", async () => {
  const ctx = await retryPromise
  const leg = '(e) [M3]'
  const calls = stripCalls(ctx)
  assert.equal(calls.length, 2, `${leg} two strips${why(ctx)}`)
  const fold2 = at(ctx, isFoldLine(FOLD_UNIT_2), `the ${FOLD_UNIT_2} unit`, leg)
  const lease = at(ctx, isLeasedPushLine, `a --force-with-lease push of ${INTEGRATION_BRANCH}`, leg)
  assert.ok(fold2 < calls[1].index,
    `${leg} the second strip (${calls[1].index}) is after attempt 2's fold unit (${fold2})${why(ctx)}`)
  assert.ok(calls[1].index < lease,
    `${leg} and before the leased push (${lease}), so the lease is the strip commit the remote ` +
      `actually holds${why(ctx)}`)
  assert.ok(calls[0].index < fold2,
    `${leg} the first strip (${calls[0].index}) belongs to attempt 1, before ${FOLD_UNIT_2} (${fold2})${why(ctx)}`)
})

// ── (f) the sentinel  [M1] ───────────────────────────────────────────────────

await runTests(tests)
