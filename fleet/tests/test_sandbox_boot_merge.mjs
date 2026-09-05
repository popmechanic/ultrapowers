/**
 * fleet/tests/test_sandbox_boot_merge.mjs — the sandbox merges its own pull
 * request once its checks are green.
 *
 * The exam is written against the task's Machine clauses, leg by leg. Each
 * assertion names the leg it belongs to and the clause it comes from, so a
 * reader can map this file back to the contract:
 *
 *   M1  after a gate-green publish the script reads
 *       `https://github.int.exe.xyz/api/v3/repos/<target>/commits/<head>/check-runs`
 *       every `POLL_SECONDS`, and once the answer lists at least one check run
 *       and every listed run is `completed` with a conclusion of `success`,
 *       `neutral` or `skipped`, it issues exactly one
 *       `PUT …/repos/<target>/pulls/<n>/merge` carrying
 *       `"merge_method":"squash"`, `"commit_title":"<the plan's H1>"` and
 *       `"sha":"<head>"`; a 2xx answer's `sha` is the `done` page's `merged`.
 *   M2  a run that is not `completed` keeps the poll going; an answer listing
 *       no run keeps it going through `MERGE_CHECKS_GRACE` seconds' worth of
 *       attempts and is nothing to wait for after them; a completed run
 *       outside the three conclusions stops the poll; a poll still pending
 *       after `MERGE_CHECK_WAIT` seconds' worth of attempts stops; a non-2xx
 *       PUT gets no second PUT — and each of those four ends `done` with
 *       `merged` null and `pr` still the PR URL.
 *   M3  a parked outcome reads no check runs and issues no PUT; `hold=1`
 *       publishes and skips the merge; any other `hold=` value fails the
 *       assignment before any clone.
 *   M4  every status page carries a `merged` cell, null before the merge and
 *       the merge sha on the `done` page; the green path's evidence commits
 *       and its one notification are unchanged.
 *   M5  `fleet/CONTRACT.md` says so, in its status.json, Boot-script and
 *       Publish bullets.
 *   M6  `fleet/RUNBOOK.md` says so, in "The PR.", its States table and Trust.
 *   M7  `skills/ultrapowers/SKILL.md`'s step 4 says so.
 *
 * The rig is `_sandbox_boot_helpers.mjs` — the stub bin dir, `makeHome`,
 * `boot`, the log readers and `runTests` — shared with the other halves of the
 * boot exam. Its curl stub grows the two endpoints this task's script talks to
 * and four readers for them (`MERGE_SHA`, `mergePuts`, `mergeArgv`,
 * `checkReads`); the rig is imported as a namespace so that a tree without
 * them fails these legs with a sentence rather than a module link error.
 *
 * Ground truth for "which call happened" is `curl.log` — the tab-separated
 * argv every stub writes through the shared `argv()` prelude, which no stub
 * case can talk its way out of. The `say` lines in `fleet-boot.log` are read
 * only for ORDER, which is the one thing argv cannot show.
 *
 * No network, no systemd, no real `claude`: `FLEET_POLL_SECONDS=0` makes
 * `poll_attempts` count `timeout + 1` attempts and the whole poll runs in a
 * second.
 */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import * as RIG from './_sandbox_boot_helpers.mjs'
import {
  SCRIPT, TARGET, HEAD_SHA, PR_URL, PLAN_H1, ASSIGNMENT,
  makeHome, boot, green,
  readLog, argvLines, stream, statusOf, committed, commitStates, notifies,
  prPosts, engineRuns,
  runTests,
} from './_sandbox_boot_helpers.mjs'

const tests = []
const test = (name, fn) => tests.push([name, fn])

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CONTRACT = path.join(HERE, '..', 'CONTRACT.md')
const RUNBOOK = path.join(HERE, '..', 'RUNBOOK.md')
const SKILL = path.join(HERE, '..', '..', 'skills', 'ultrapowers', 'SKILL.md')

// ── the two URLs, spelled out ────────────────────────────────────────────────
//
// `GITHUB_INT_HOST` is the boot script's own constant; the PR the stub answers
// with is number 1 (`PR_JSON`'s `number`, and the tail of `PR_URL`).

const API = 'https://github.int.exe.xyz/api/v3'
const CHECK_URL = `${API}/repos/${TARGET}/commits/${HEAD_SHA}/check-runs`
const MERGE_URL = `${API}/repos/${TARGET}/pulls/1/merge`

// ── the rig's new half ───────────────────────────────────────────────────────

/** A named export of the rig, or a failure that says which one is missing. */
const rig = (name, kind = 'value') => {
  const v = RIG[name]
  assert.ok(
    v !== undefined && (kind !== 'function' || typeof v === 'function'),
    `fleet/tests/_sandbox_boot_helpers.mjs exports no ${kind} '${name}' — the rig's ` +
      'check-runs and merge stub cases, and their readers, are part of this task'
  )
  return v
}
const mergeSha = () => rig('MERGE_SHA')

// ── reading curl.log ─────────────────────────────────────────────────────────

/** Every curl argv whose words carry `url`, as recorded words. */
const callsTo = (ctx, url) => argvLines(ctx, 'curl').filter((a) => a.includes(url))
/** How many times the check-runs URL was fetched. */
const checkGets = (ctx) => callsTo(ctx, CHECK_URL)
/** Every curl aimed at the merge endpoint. */
const mergeCalls = (ctx) => callsTo(ctx, MERGE_URL)
/** The word a call carried after `-d`. */
const payloadOf = (argv) => {
  const i = argv.indexOf('-d')
  assert.ok(i >= 0 && i + 1 < argv.length, `this curl carried no -d payload: ${argv.join(' ')}`)
  return argv[i + 1]
}

/** The CALL lines of `fleet-boot.log`, which is where ORDER is readable. */
const calls = (ctx) => stream(ctx).filter((l) => l.startsWith('CALL curl'))
const isCheckCall = (l) => l.includes('check-runs')
const isMergeCall = (l) => l.includes('merge') && !isCheckCall(l)

/**
 * The part of the boot log a merge leg is about — every external call and
 * every line the merge step or the status page wrote. The clone and the
 * evidence commits are forty lines this exam never asks a question about.
 */
const why = (ctx) => {
  const kept = stream(ctx).filter((l) =>
    l.startsWith('CALL curl') || l.startsWith('merge:') || l.startsWith('status:') ||
    l.startsWith('publish:') || l.startsWith('outcome:') || l.startsWith('FAILED:'))
  return `\n--- fleet-boot.log (calls and states) ---\n${kept.join('\n')}`
}

// ── STUB_CHECKS bodies ───────────────────────────────────────────────────────
//
// The shape GitHub answers a check-runs read with: `total_count` a number,
// each run's `status` and `conclusion` quoted strings while it is completed,
// `"conclusion":null` unquoted while it is not.

const done = (name, conclusion) => ({ name, status: 'completed', conclusion })
const running = (name) => ({ name, status: 'in_progress', conclusion: null })
const body = (runs) => JSON.stringify({ total_count: runs.length, check_runs: runs })

/** The three conclusions M1 counts as green. */
const GREEN_CONCLUSIONS = ['success', 'neutral', 'skipped']
/** Three completed conclusions outside them — leg (e)'s allowlist probe. */
const RED_CONCLUSIONS = ['failure', 'cancelled', 'timed_out']

// ── shared runs ──────────────────────────────────────────────────────────────
//
// A boot is ~40 forks of stub shell, so the two runs read by more than one leg
// are made once and read many times, the way the rig's own `green()` is.

let PARKED = null
/** A NEEDS_ACK verdict with no approval: the parked outcome, M3's first half. */
const parked = () => {
  if (!PARKED) {
    PARKED = makeHome()
    PARKED.result = boot(PARKED, ['boot'], { STUB_VERDICT: 'NEEDS_ACK' })
  }
  return PARKED
}

let HELD = null
/** The helper's assignment with ` hold=1` appended: M3's second half. */
const held = () => {
  if (!HELD) {
    HELD = makeHome()
    HELD.result = boot(HELD, ['boot'], { FLEET_ASSIGNMENT: `${ASSIGNMENT} hold=1` })
  }
  return HELD
}

/**
 * The four legs that end `done` with the PR left open say the same three
 * things about the page, so they say them through one reader.
 */
const assertLeftOpen = (ctx, leg) => {
  const status = statusOf(ctx)
  assert.equal(status.state, 'done', `${leg} the run still ends done${why(ctx)}`)
  assert.equal(status.pr, PR_URL, `${leg} and the PR URL is still on the page`)
  assert.ok('merged' in status, `${leg} the page carries a merged cell`)
  assert.equal(status.merged, null, `${leg} whose value is null — nothing was merged`)
}

// ── (l) the script parses ────────────────────────────────────────────────────

test('bash -n accepts fleet/sandbox-boot.sh  [leg (l)]', () => {
  const r = spawnSync('bash', ['-n', SCRIPT], { encoding: 'utf8' })
  assert.equal(r.status, 0, `(l) the boot script must parse:\n${r.stderr}`)
})

test("the rig exports the merge stub's four readers  [legs (a)–(m)]", () => {
  assert.equal(mergeSha(), 'f6'.repeat(20),
    "MERGE_SHA is the sha the merge stub answers with — 'f6' repeated twenty times")
  rig('mergePuts', 'function')
  rig('mergeArgv', 'function')
  rig('checkReads', 'function')
})

// ── (a) the green path reads the checks and merges  [M1] ─────────────────────

test('the green path GETs the check-runs URL and PUTs one squash merge  [M1 / leg (a)]', () => {
  const ctx = green()

  // M1's read: the URL is the target's and the pushed head's, exactly, and it
  // is a GET — `-X` would make it something else.
  const gets = checkGets(ctx)
  assert.ok(gets.length >= 1,
    `(a) [M1] at least one GET of ${CHECK_URL} — the script polls the PR head's check runs` +
      why(ctx))
  for (const argv of gets) {
    assert.ok(!argv.includes('-X'),
      `(a) [M1] the check-runs read carries no -X: ${argv.join(' ')}`)
  }
  assert.equal(rig('checkReads', 'function')(ctx), gets.length,
    "(a) [M1] the rig's checkReads counts the same reads curl.log recorded")

  // M1's write: exactly one PUT, at the merge URL of pull 1.
  const puts = mergeCalls(ctx)
  assert.equal(puts.length, 1,
    `(a) [M1] exactly one curl to ${MERGE_URL}${why(ctx)}`)
  const argv = puts[0]
  const x = argv.indexOf('-X')
  assert.ok(x >= 0 && argv[x + 1] === 'PUT',
    `(a) [M1] the merge call carries -X then PUT: ${argv.join(' ')}`)
  assert.deepEqual(rig('mergeArgv', 'function')(ctx), argv,
    "(a) [M1] and the rig's mergeArgv is that same call")

  // M1's payload: the three fields, as the bytes the script built and as the
  // parsed document the rig recorded.
  const raw = payloadOf(argv)
  assert.ok(raw.includes('"merge_method":"squash"'),
    `(a) [M1] the payload carries "merge_method":"squash" literally: ${raw}`)
  const sent = JSON.parse(raw)
  assert.equal(sent.merge_method, 'squash', '(a) [M1] a squash merge')
  assert.equal(sent.commit_title, PLAN_H1, "(a) [M1] the commit title is the plan's H1")
  assert.equal(sent.sha, HEAD_SHA, '(a) [M1] and the sha is the pushed head')

  const recorded = rig('mergePuts', 'function')(ctx)
  assert.equal(recorded.length, 1, '(a) [M1] one merge PUT was recorded')
  assert.deepEqual(recorded[0], sent, '(a) [M1] and it is the payload curl.log shows')

  // M1's answer: the 2xx `sha` is the page's `merged`.
  const status = statusOf(ctx)
  assert.equal(status.state, 'done', '(a) [M1] the green path ends done')
  assert.equal(status.pr, PR_URL, '(a) [M1] carrying the PR URL')
  assert.ok('merged' in status, '(a) [M1] and a merged cell')
  assert.equal(status.merged, mergeSha(),
    "(a) [M1] whose value is the merge answer's sha")
  assert.ok(stream(ctx).some((l) => l.includes('merge: merged')),
    `(a) [M1] the log says the PR was merged${why(ctx)}`)
})

// ── (b) the three green conclusions  [M1] ────────────────────────────────────

test('three completed runs concluding success, neutral and skipped merge  [M1 / leg (b)]', () => {
  const ctx = makeHome()
  const runs = GREEN_CONCLUSIONS.map((c, i) => done(`check-${i}`, c))
  const r = boot(ctx, ['boot'], { STUB_CHECKS: body(runs) })
  assert.equal(r.status, 0, r.stdout + r.stderr)

  assert.equal(mergeCalls(ctx).length, 1,
    `(b) [M1] every listed run is completed and green, so one PUT is issued${why(ctx)}`)
  assert.equal(statusOf(ctx).merged, mergeSha(),
    '(b) [M1] and the page records the merge sha')
  assert.equal(statusOf(ctx).state, 'done')
})

for (const conclusion of GREEN_CONCLUSIONS) {
  test(`a single completed run concluding ${conclusion} merges  [M1 / leg (b)]`, () => {
    const ctx = makeHome()
    const r = boot(ctx, ['boot'], { STUB_CHECKS: body([done('test', conclusion)]) })
    assert.equal(r.status, 0, r.stdout + r.stderr)

    assert.equal(mergeCalls(ctx).length, 1,
      `(b) [M1] ${conclusion} is one of the three green conclusions${why(ctx)}`)
    assert.equal(statusOf(ctx).merged, mergeSha(),
      `(b) [M1] a run concluding ${conclusion} is merged`)
    assert.equal(statusOf(ctx).state, 'done')
  })
}

// ── (c) a pending run keeps the poll going  [M2] ─────────────────────────────

test('two in_progress answers are polled through, and the PUT follows the third read  [M2 / leg (c)]', () => {
  const ctx = makeHome()
  const r = boot(ctx, ['boot'], { STUB_CHECKS_PENDING: '2' })
  assert.equal(r.status, 0, r.stdout + r.stderr)

  assert.equal(checkGets(ctx).length, 3,
    `(c) [M2] a run that is not completed keeps the poll going: two pending answers, ` +
      `then the completed one — three reads${why(ctx)}`)
  assert.equal(mergeCalls(ctx).length, 1, '(c) [M2] and then exactly one PUT')

  // Order, in the one stream both the stubs and the script write to.
  const c = calls(ctx)
  const reads = c.map((l, i) => (isCheckCall(l) ? i : -1)).filter((i) => i >= 0)
  const put = c.findIndex(isMergeCall)
  assert.equal(reads.length, 3, `(c) [M2] three check-runs calls in the stream${why(ctx)}`)
  assert.ok(put > reads[2],
    `(c) [M2] the PUT follows the third read, not the first${why(ctx)}`)

  assert.equal(statusOf(ctx).merged, mergeSha(), '(c) [M2] the merge is the one that landed')
})

// ── (d) no check runs at all, after the grace  [M2] ──────────────────────────

test('an answer listing no check run waits out the grace, then merges  [M2 / leg (d)]', () => {
  const ctx = makeHome()
  const r = boot(ctx, ['boot'], {
    STUB_CHECKS: '{"total_count":0,"check_runs":[]}',
    FLEET_MERGE_CHECKS_GRACE: '1',
    FLEET_MERGE_CHECK_WAIT: '5',
  })
  assert.equal(r.status, 0, r.stdout + r.stderr)

  // `poll_attempts` is `timeout / step + 1` and `FLEET_POLL_SECONDS=0` makes
  // step 1: the grace is worth two attempts, so the third empty answer is the
  // one taken as nothing to wait for.
  assert.equal(checkGets(ctx).length, 3,
    `(d) [M2] an empty answer is pending through the grace's two attempts and ` +
      `nothing to wait for at the third${why(ctx)}`)
  assert.equal(mergeCalls(ctx).length, 1, '(d) [M2] and one PUT is issued')
  assert.equal(statusOf(ctx).merged, mergeSha(),
    '(d) [M2] a target with no checks at all still merges')
  assert.ok(stream(ctx).some((l) => l.includes('nothing to wait for')),
    `(d) [M2] and the log says why${why(ctx)}`)
})

// ── (e) a completed conclusion outside the three stops the poll  [M1] [M2] ───

for (const conclusion of RED_CONCLUSIONS) {
  test(`a completed run concluding ${conclusion} leaves the PR open  [M1] [M2] / leg (e)]`, () => {
    const ctx = makeHome()
    const r = boot(ctx, ['boot'], { STUB_CHECKS: body([done('test', conclusion)]) })
    assert.equal(r.status, 0, r.stdout + r.stderr)

    assert.equal(mergeCalls(ctx).length, 0,
      `(e) [M1] ${conclusion} is not one of success, neutral or skipped, so no PUT${why(ctx)}`)
    assert.equal(checkGets(ctx).length, 1,
      `(e) [M2] and the poll stops at the first completed answer${why(ctx)}`)
    assertLeftOpen(ctx, `(e) [M2] with ${conclusion}:`)
    assert.ok(stream(ctx).some((l) => l.includes(`concluded ${conclusion} — leaving`)),
      `(e) [M1] the log names the conclusion it refused — a conclusion outside the three ` +
        `green names is refused by allowlist, not by a denylist of failure${why(ctx)}`)
  })
}

// ── (f) a poll that never completes  [M2] ────────────────────────────────────

test('a poll still pending after MERGE_CHECK_WAIT stops with no PUT  [M2 / leg (f)]', () => {
  const ctx = makeHome()
  const r = boot(ctx, ['boot'], {
    STUB_CHECKS_PENDING: '50',
    FLEET_MERGE_CHECK_WAIT: '3',
  })
  assert.equal(r.status, 0, r.stdout + r.stderr)

  assert.equal(checkGets(ctx).length, 4,
    `(f) [M2] three seconds' worth of attempts is four, and then the poll gives up${why(ctx)}`)
  assert.equal(mergeCalls(ctx).length, 0, '(f) [M2] a pending check is never merged')
  assertLeftOpen(ctx, '(f) [M2]')
  assert.ok(stream(ctx).some((l) => l.includes('still pending after 3s')),
    `(f) [M2] and the log says how long it waited${why(ctx)}`)
})

// ── (g) a refused PUT is not retried  [M2] ───────────────────────────────────

test('a PUT answering 405 gets no second PUT  [M2 / leg (g)]', () => {
  const ctx = makeHome()
  const r = boot(ctx, ['boot'], { STUB_MERGE_CODE: '405' })
  assert.equal(r.status, 0, r.stdout + r.stderr)

  assert.equal(mergeCalls(ctx).length, 1,
    `(g) [M2] exactly one PUT — a refused merge is not attempted again${why(ctx)}`)
  assertLeftOpen(ctx, '(g) [M2]')
  assert.ok(stream(ctx).some((l) => l.includes('PUT answered 405')),
    `(g) [M2] and the log carries the code the edge answered${why(ctx)}`)
})

// ── (m) one green run beside a red or a pending one  [M1] [M2] ───────────────

test('a success beside a failure merges nothing, after one read  [M1] [M2] / leg (m)]', () => {
  const ctx = makeHome()
  const r = boot(ctx, ['boot'], {
    STUB_CHECKS: body([done('one', 'success'), done('two', 'failure')]),
  })
  assert.equal(r.status, 0, r.stdout + r.stderr)

  assert.equal(mergeCalls(ctx).length, 0,
    `(m) [M1] EVERY listed run has to be green, not merely one of them${why(ctx)}`)
  assert.equal(checkGets(ctx).length, 1,
    '(m) [M2] the completed failure stops the poll at the first answer')
  assertLeftOpen(ctx, '(m) [M2] success beside failure:')
})

test('a success beside an in_progress run is polled to the deadline and merges nothing  [M1] [M2] / leg (m)]', () => {
  const ctx = makeHome()
  const r = boot(ctx, ['boot'], {
    STUB_CHECKS: body([done('one', 'success'), running('two')]),
    FLEET_MERGE_CHECK_WAIT: '3',
  })
  assert.equal(r.status, 0, r.stdout + r.stderr)

  assert.equal(checkGets(ctx).length, 4,
    `(m) [M2] one run still in_progress keeps the poll going to its deadline${why(ctx)}`)
  assert.equal(mergeCalls(ctx).length, 0,
    '(m) [M1] a green run beside a pending one merges nothing')
  assertLeftOpen(ctx, '(m) [M2] success beside in_progress:')
})

// ── (h) a parked outcome never looks at the checks  [M3] ─────────────────────

test('a NEEDS_ACK verdict with no approval reads no checks and issues no PUT  [M3 / leg (h)]', () => {
  const ctx = parked()
  assert.equal(ctx.result.status, 0, ctx.result.stdout + ctx.result.stderr)

  const status = statusOf(ctx)
  assert.equal(status.state, 'parked', `(h) [M3] the run parks${why(ctx)}`)
  assert.equal(checkGets(ctx).length, 0,
    `(h) [M3] a parked outcome reads no check runs — there is nothing to merge${why(ctx)}`)
  assert.equal(mergeCalls(ctx).length, 0, '(h) [M3] and issues no PUT')
  assert.ok('merged' in status, '(h) [M3] the parked page carries a merged cell')
  assert.equal(status.merged, null, '(h) [M3] whose value is null')
})

// ── (i) hold=1 publishes and stops  [M3] ─────────────────────────────────────

test('hold=1 publishes the PR, reads no checks and leaves it open  [M3 / leg (i)]', () => {
  const ctx = held()
  assert.equal(ctx.result.status, 0,
    `(i) [M3] hold=1 is an accepted value: ${ctx.result.stdout}${ctx.result.stderr}`)

  const status = statusOf(ctx)
  assert.equal(status.state, 'done', `(i) [M3] a held run still reaches done${why(ctx)}`)
  assert.equal(status.pr, PR_URL, '(i) [M3] with its PR on the page')
  assert.equal(prPosts(ctx).length, 1, '(i) [M3] one POST /pulls — the PR is still published')
  assert.equal(checkGets(ctx).length, 0,
    `(i) [M3] hold=1 skips the check-runs read entirely${why(ctx)}`)
  assert.equal(mergeCalls(ctx).length, 0, '(i) [M3] and the PUT')
  assert.ok('merged' in status, '(i) [M3] the held page carries a merged cell')
  assert.equal(status.merged, null, '(i) [M3] whose value is null')
  assert.ok(stream(ctx).some((l) => l.includes('merge: hold=1 — leaving')),
    `(i) [M3] and the log says the PR was left open on purpose${why(ctx)}`)
})

// ── (j) any other hold= value fails the assignment  [M3] [M4] ────────────────

for (const value of ['yes', '0']) {
  test(`hold=${value} fails before any clone, with 'assignment' in the error  [M3] [M4] / leg (j)]`, () => {
    const ctx = makeHome()
    const r = boot(ctx, ['boot'], { FLEET_ASSIGNMENT: `${ASSIGNMENT} hold=${value}` })
    assert.notEqual(r.status, 0, `(j) [M3] hold=${value} must exit non-zero`)

    const status = statusOf(ctx)
    assert.equal(status.state, 'failed', `(j) [M3] the run is failed${why(ctx)}`)
    assert.match(String(status.error), /assignment/,
      `(j) [M3] the failure line names the assignment; got: ${status.error}`)
    assert.equal(readLog(ctx, 'git.log'), '',
      '(j) [M3] nothing is cloned on a refused assignment')
    assert.equal(engineRuns(ctx), 0, '(j) [M3] and no engine is started')

    // M4 reaches every page, including the one a refused assignment leaves.
    assert.ok('merged' in status, '(j) [M4] even the failed page carries a merged cell')
    assert.equal(status.merged, null, '(j) [M4] whose value is null')
  })
}

// ── (k) the merged cell on every page, and nothing else moved  [M4] ──────────

test('every green-path evidence commit carries a merged cell, null until the merge  [M4 / leg (k)]', () => {
  const ctx = green()
  const snaps = committed(ctx)
  assert.equal(snaps.length, 3, `(k) [M4] three evidence commits${why(ctx)}`)
  for (const [i, snap] of snaps.entries()) {
    assert.ok('merged' in snap,
      `(k) [M4] the ${snap.state} snapshot (commit ${i}) carries a merged cell: ` +
        JSON.stringify(snap))
  }
  assert.equal(snaps[0].merged, null, '(k) [M4] null on the running snapshot')
  assert.equal(snaps[1].merged, null, '(k) [M4] null on the publishing snapshot')
  assert.equal(snaps[2].merged, mergeSha(), '(k) [M4] and the merge sha on the last')
})

test('the green path still commits running, publishing, done and notifies once  [M4 / leg (k)]', () => {
  const ctx = green()
  assert.deepEqual(commitStates(ctx), ['running', 'publishing', 'done'],
    `(k) [M4] the merge adds no evidence commit between the PR and done${why(ctx)}`)
  assert.deepEqual(notifies(ctx), [
    { title: 'run-7 done', message: `${TARGET} — ${PR_URL}` },
  ], '(k) [M4] and the run still sends exactly one notification, unchanged')
})

test('the parked page and the held page each carry a null merged cell  [M4 / leg (k)]', () => {
  for (const [label, ctx] of [['parked', parked()], ['held', held()]]) {
    const status = statusOf(ctx)
    assert.ok('merged' in status, `(k) [M4] the ${label} page carries a merged cell`)
    assert.equal(status.merged, null, `(k) [M4] and its value is null`)
  }
})

// ── the documents  [M5] [M6] [M7] ────────────────────────────────────────────
//
// Read the way the Proof's own commands read them: one named slice of one
// document per assertion, its line wraps joined with spaces.

const linesOf = (file) => fs.readFileSync(file, 'utf8').split('\n')

/** `sed -n '/from/,/to/p'`, joined by `tr '\n' ' '`. */
const slice = (file, from, to) => {
  const ls = linesOf(file)
  const start = ls.findIndex((l) => from.test(l))
  assert.ok(start >= 0, `${path.basename(file)}: no line matching ${from}`)
  let end = ls.length - 1
  for (let i = start + 1; i < ls.length; i += 1) {
    if (to.test(ls[i])) { end = i; break }
  }
  return ls.slice(start, end + 1).join(' ')
}

/** `grep -A<n> '<from>'`, joined the same way. */
const withFollowing = (file, from, n) => {
  const ls = linesOf(file)
  const start = ls.findIndex((l) => from.test(l))
  assert.ok(start >= 0, `${path.basename(file)}: no line matching ${from}`)
  return ls.slice(start, start + n + 1).join(' ')
}

test("CONTRACT.md's status.json literal carries the merged cell after prAuthor  [M5]", () => {
  const text = withFollowing(CONTRACT, /^- \*\*status\.json:\*\*/, 2)
  const cell = '"prAuthor":"<GitHub login or null>","merged":"<40-hex or null>"'
  assert.ok(text.includes(cell),
    `[M5] the status.json bullet must carry ${cell}:\n${text}`)
})

test("CONTRACT.md's Boot-script bullet names the read, the PUT and the hold key  [M5]", () => {
  const text = slice(CONTRACT, /^- \*\*Boot script/, /^- \*\*status\.json/)
  assert.match(text, /commits\/<head>\/check-runs.*pulls\/<n>\/merge.*hold=1/,
    `[M5] the Boot-script bullet must name the check-runs read, then the merge PUT, ` +
      `then the hold key:\n${text}`)
})

test("CONTRACT.md's Publish bullet says the sandbox merges the PR itself  [M5]", () => {
  const text = slice(CONTRACT, /^- \*\*Publish:\*\*/, /^- \*\*Integration naming/)
  assert.match(text, /sandbox merges itself once its checks are green, unless the assignment carries.*hold=1/,
    `[M5] the Publish bullet must say a ready PR the sandbox merges itself once its checks ` +
      `are green, unless the assignment carries hold=1:\n${text}`)
})

test('RUNBOOK.md\'s "The PR." paragraph says a ready PR merges itself  [M6]', () => {
  const text = slice(RUNBOOK, /^\*\*The PR\.\*\*/, /^\*\*Reap\.\*\*/)
  assert.match(text, /A ready PR merges itself.*once every check is green, unless the launch said.*--hold/,
    `[M6] "The PR." must say a ready PR merges itself once every check is green, unless the ` +
      `launch said --hold:\n${text}`)
})

test("RUNBOOK.md's States table names merged on the done row  [M6]", () => {
  const row = linesOf(RUNBOOK).find((l) => /^\| .done. \|/.test(l))
  assert.ok(row, '[M6] the States table still has a `done` row')
  assert.ok(row.includes('merged is the squash commit'),
    `[M6] the done row must name the merged cell:\n${row}`)
})

test('RUNBOOK.md\'s Trust section puts --hold, not a human, at the merge button  [M6]', () => {
  const text = slice(RUNBOOK, /^## Trust/, /^## Rollback/)
  assert.match(text, /merge waits on the target.s own checks, and.*--hold.*to keep a human at the merge button/,
    `[M6] Trust must say the PR's merge waits on the target's own checks, and --hold keeps a ` +
      `human at the merge button:\n${text}`)
  assert.doesNotMatch(text, /a pull request rather than a merge/,
    `[M6] and the old sentence is gone:\n${text}`)
})

test("SKILL.md's step 4 says a ready PR merges itself and --hold keeps it open  [M7]", () => {
  const text = slice(SKILL, /^4\. \*\*The PR is the gate/, /^5\. \*\*Reap/)
  assert.match(text, /A ready PR merges itself once its checks are green.*--hold.*on the launch line keeps it open/,
    `[M7] step 4 must say a ready PR merges itself once its checks are green, and that --hold ` +
      `on the launch line keeps it open:\n${text}`)
})

runTests(tests)
