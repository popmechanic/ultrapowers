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
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SECOND HALF of this file — everything below the `publish fold` banner —
 * is the exam of a LATER task: "The boot script publishes the folded head and
 * retries the merge once" (#715). Its clauses are numbered M1–M8 and its legs
 * (a)–(j) of their own; every assertion down there names them with a
 * `publish-fold` prefix so the two numberings never read as one. The legs
 * above are unchanged and still pass — M8 of the later task says so.
 */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import * as RIG from './_sandbox_boot_helpers.mjs'
import {
  SCRIPT, TARGET, HEAD_SHA, BASE_SHA, PR_URL, PR_AUTHOR, PLAN_H1, ASSIGNMENT,
  INTEGRATION_BRANCH, VM_NAME,
  makeHome, boot, bootAsync, greenAsync as green,
  readLog, lines, argvLines, stream, statusOf, committed, commitStates, notifies,
  prPosts, engineRuns, unitsRun, gitLog, verbOf, dirOf, isIntegrationPush,
  targetDir, checkReads, mergePuts,
  runTests,
} from './_sandbox_boot_helpers.mjs'

const tests = []
const test = (name, fn) => tests.push([name, fn])

// ── the scenarios, all in flight at once ─────────────────────────────────────
//
// Every scenario this file reads is an independent run of the boot script —
// its own home, its own stub counters, its own logs — so none has to wait for
// another. Each is STARTED where it is declared, at load, and a leg awaits
// only the one it asks about; the boots overlap and the file's wall is the
// slowest of them rather than the sum of all of them.
//
// `started` memoises the PROMISE, never its result, so a scenario several legs
// share is booted once however early they ask. It also settles the promise into
// a thunk, so a scenario whose boot failed throws in the leg that reads it —
// a rejection sitting unread while another leg is on the clock would otherwise
// tear the process down before the failing leg had its say.

const started = (make) => {
  const settled = make().then((value) => () => value, (error) => () => { throw error })
  return () => settled.then((read) => read())
}

/**
 * How many boots are in flight at once, and the only knob this file's wall
 * turns on.
 *
 * A boot is ~40 forks of stub shell around a handful of tenth-of-a-second
 * polls: fork-bound, so the box's cores are what it competes for. Three at a
 * time is what the smallest box the suite runs on — a four-vCPU sandbox — can
 * work on while still leaving a core to the process reading the results. Wider
 * does not finish the forty-seven boots much sooner (they queue in the kernel
 * instead of here) and narrower makes the file's wall the sum of its boots
 * again, which is what this exam stopped being.
 */
const WIDTH = 3
let inFlight = 0
const waiting = []
const pump = () => {
  while (inFlight < WIDTH && waiting.length) {
    inFlight += 1
    waiting.shift()()
  }
}
const acquire = () => new Promise((admit) => {
  waiting.push(admit)
  pump()
})
const release = () => {
  inFlight -= 1
  pump()
}
/** `bootAsync`, behind that gate. */
const gatedBoot = (ctx, args, env) =>
  acquire().then(() => bootAsync(ctx, args, env).finally(release))

/** A boot of `args` under `env`, started now; resolves to its home, the run's
 *  result hung on it as `result`. */
const bootRun = (env = {}, args = ['boot']) => {
  const ctx = makeHome()
  return gatedBoot(ctx, args, env).then((result) => {
    ctx.result = result
    return ctx
  })
}
/** The same, memoised for the legs that share it. */
const scenario = (env = {}, args = ['boot']) => started(() => bootRun(env, args))

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

/** A NEEDS_ACK verdict with no approval: the parked outcome, M3's first half. */
const parked = scenario({ STUB_VERDICT: 'NEEDS_ACK' })

/** The helper's assignment with ` hold=1` appended: M3's second half. */
const held = scenario({ FLEET_ASSIGNMENT: `${ASSIGNMENT} hold=1` })

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

test('the green path GETs the check-runs URL and PUTs one squash merge  [M1 / leg (a)]', async () => {
  const ctx = await green()

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

const threeGreen = scenario({ STUB_CHECKS: body(GREEN_CONCLUSIONS.map((c, i) => done(`check-${i}`, c))) })

test('three completed runs concluding success, neutral and skipped merge  [M1 / leg (b)]', async () => {
  const ctx = await threeGreen()
  const r = ctx.result
  assert.equal(r.status, 0, r.stdout + r.stderr)

  assert.equal(mergeCalls(ctx).length, 1,
    `(b) [M1] every listed run is completed and green, so one PUT is issued${why(ctx)}`)
  assert.equal(statusOf(ctx).merged, mergeSha(),
    '(b) [M1] and the page records the merge sha')
  assert.equal(statusOf(ctx).state, 'done')
})

for (const conclusion of GREEN_CONCLUSIONS) {
  const oneGreen = scenario({ STUB_CHECKS: body([done('test', conclusion)]) })
  test(`a single completed run concluding ${conclusion} merges  [M1 / leg (b)]`, async () => {
    const ctx = await oneGreen()
    const r = ctx.result
    assert.equal(r.status, 0, r.stdout + r.stderr)

    assert.equal(mergeCalls(ctx).length, 1,
      `(b) [M1] ${conclusion} is one of the three green conclusions${why(ctx)}`)
    assert.equal(statusOf(ctx).merged, mergeSha(),
      `(b) [M1] a run concluding ${conclusion} is merged`)
    assert.equal(statusOf(ctx).state, 'done')
  })
}

// ── (c) a pending run keeps the poll going  [M2] ─────────────────────────────

const twoPending = scenario({ STUB_CHECKS_PENDING: '2' })

test('two in_progress answers are polled through, and the PUT follows the third read  [M2 / leg (c)]', async () => {
  const ctx = await twoPending()
  const r = ctx.result
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

const noChecks = scenario({
  STUB_CHECKS: '{"total_count":0,"check_runs":[]}',
  FLEET_MERGE_CHECKS_GRACE: '1',
  FLEET_MERGE_CHECK_WAIT: '5',
})

test('an answer listing no check run waits out the grace, then merges  [M2 / leg (d)]', async () => {
  const ctx = await noChecks()
  const r = ctx.result
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
  const oneRed = scenario({ STUB_CHECKS: body([done('test', conclusion)]) })
  test(`a completed run concluding ${conclusion} leaves the PR open  [M1] [M2] / leg (e)]`, async () => {
    const ctx = await oneRed()
    const r = ctx.result
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

const neverCompletes = scenario({
  STUB_CHECKS_PENDING: '50',
  FLEET_MERGE_CHECK_WAIT: '3',
})

test('a poll still pending after MERGE_CHECK_WAIT stops with no PUT  [M2 / leg (f)]', async () => {
  const ctx = await neverCompletes()
  const r = ctx.result
  assert.equal(r.status, 0, r.stdout + r.stderr)

  assert.equal(checkGets(ctx).length, 4,
    `(f) [M2] three seconds' worth of attempts is four, and then the poll gives up${why(ctx)}`)
  assert.equal(mergeCalls(ctx).length, 0, '(f) [M2] a pending check is never merged')
  assertLeftOpen(ctx, '(f) [M2]')
  assert.ok(stream(ctx).some((l) => l.includes('still pending after 3s')),
    `(f) [M2] and the log says how long it waited${why(ctx)}`)
})

// ── (g) a refused PUT is not retried  [M2] ───────────────────────────────────

const put405 = scenario({ STUB_MERGE_CODE: '405' })

test('a PUT answering 405 gets no second PUT  [M2 / leg (g)]', async () => {
  const ctx = await put405()
  const r = ctx.result
  assert.equal(r.status, 0, r.stdout + r.stderr)

  assert.equal(mergeCalls(ctx).length, 1,
    `(g) [M2] exactly one PUT — a refused merge is not attempted again${why(ctx)}`)
  assertLeftOpen(ctx, '(g) [M2]')
  assert.ok(stream(ctx).some((l) => l.includes('PUT answered 405')),
    `(g) [M2] and the log carries the code the edge answered${why(ctx)}`)
})

// ── (m) one green run beside a red or a pending one  [M1] [M2] ───────────────

const greenBesideRed = scenario({
  STUB_CHECKS: body([done('one', 'success'), done('two', 'failure')]),
})

test('a success beside a failure merges nothing, after one read  [M1] [M2] / leg (m)]', async () => {
  const ctx = await greenBesideRed()
  const r = ctx.result
  assert.equal(r.status, 0, r.stdout + r.stderr)

  assert.equal(mergeCalls(ctx).length, 0,
    `(m) [M1] EVERY listed run has to be green, not merely one of them${why(ctx)}`)
  assert.equal(checkGets(ctx).length, 1,
    '(m) [M2] the completed failure stops the poll at the first answer')
  assertLeftOpen(ctx, '(m) [M2] success beside failure:')
})

const greenBesidePending = scenario({
  STUB_CHECKS: body([done('one', 'success'), running('two')]),
  FLEET_MERGE_CHECK_WAIT: '3',
})

test('a success beside an in_progress run is polled to the deadline and merges nothing  [M1] [M2] / leg (m)]', async () => {
  const ctx = await greenBesidePending()
  const r = ctx.result
  assert.equal(r.status, 0, r.stdout + r.stderr)

  assert.equal(checkGets(ctx).length, 4,
    `(m) [M2] one run still in_progress keeps the poll going to its deadline${why(ctx)}`)
  assert.equal(mergeCalls(ctx).length, 0,
    '(m) [M1] a green run beside a pending one merges nothing')
  assertLeftOpen(ctx, '(m) [M2] success beside in_progress:')
})

// ── (h) a parked outcome never looks at the checks  [M3] ─────────────────────

test('a NEEDS_ACK verdict with no approval reads no checks and issues no PUT  [M3 / leg (h)]', async () => {
  const ctx = await parked()
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

test('hold=1 publishes the PR, reads no checks and leaves it open  [M3 / leg (i)]', async () => {
  const ctx = await held()
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
  const badHold = scenario({ FLEET_ASSIGNMENT: `${ASSIGNMENT} hold=${value}` })
  test(`hold=${value} fails before any clone, with 'assignment' in the error  [M3] [M4] / leg (j)]`, async () => {
    const ctx = await badHold()
    const r = ctx.result
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

test('every green-path evidence commit carries a merged cell, null until the merge  [M4 / leg (k)]', async () => {
  const ctx = await green()
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

test('the green path still commits running, publishing, done and notifies once  [M4 / leg (k)]', async () => {
  const ctx = await green()
  assert.deepEqual(commitStates(ctx), ['running', 'publishing', 'done'],
    `(k) [M4] the merge adds no evidence commit between the PR and done${why(ctx)}`)
  assert.deepEqual(notifies(ctx), [
    { title: 'run-7 done', message: `${TARGET} — ${PR_URL}` },
  ], '(k) [M4] and the run still sends exactly one notification, unchanged')
})

test('the parked page and the held page each carry a null merged cell  [M4 / leg (k)]', async () => {
  for (const [label, ctx] of [['parked', await parked()], ['held', await held()]]) {
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

// ═════════════════════════════════════════════════════════════════════════════
// THE PUBLISH FOLD — the exam of "The boot script publishes the folded head and
// retries the merge once" (#715, spec §3.1, §3.4, §3.6, §4).
//
// Its Machine clauses, restated as this half asserts them:
//
//   M1  after the engine's exit, on ANY outcome with commits ahead of BASE, the
//       script writes `running`/`publish fold`, makes the receipts directory,
//       and starts `fleet-fold-<N>-1` — the folder's unit — with the engine's
//       own bracket (`--pipe --wait --collect`, the memory caps, the working
//       directory, `env -u CLAUDE_CONFIG_DIR` and the three variables), its
//       output teed to `publish-fold/publish-fold-1.log`, no `phase_refresher`
//       beside it and no `ENGINE_DONE_MARKER` write; then awaits the unit and
//       writes `publishing`. Nothing ahead of BASE starts no fold unit.
//   M2  the page is read BEFORE the exit code: a `parked` page is the deadman's
//       and ends the run at 0 with no push and no PR; a non-zero exit with no
//       `disposition` for the invoked attempt restores the branch ref
//       (`engine-head` on attempt 1, attempt 1's `candidate` on attempt 2) and
//       writes a `cannot fold` row carrying the exit code, the log's last line
//       and that same sha as `candidate`; `do_deadman` stops the fold units too
//       and carries `pr`, `prAuthor` and `merged` forward.
//   M3  `push_head` pushes the branch plainly when no attempt names a
//       `pushedHead` and with `--force-with-lease` on the highest one that does,
//       then records the pushed sha as that attempt's `pushedHead`.
//   M4  `render_card` reads the receipt: a `## Publish fold` section before
//       `### Evidence` on every disposition but a resolver-less `folded` and
//       `nothing to join`; the evidence listing names `publish-fold`; the
//       `Closes` lines stay last; a disposition that lands after the POST is
//       PATCHed onto the PR body.
//   M5  `FOLD_HOLD` carries the disposition's note and `merge_pr` treats it
//       exactly as `hold=1` — no check read, no PUT — while the draft flag
//       still follows the gate's outcome.
//   M6  the merge PUT carries `commit_message`.
//   M7  a 405 saying the PR is not mergeable buys ONE retry: a second fold
//       attempt, a leased push, and a second PUT after the checks and the
//       mergeability poll; every other refusal keeps one PUT.
//   M8  the shared rig answers the fold unit as its FIRST branch. That the rig's
//       other sims still pass on it is the SUITE's sentence, not a leg of this
//       file: every one of them is a sim of tests/test_fleet_suite.py already,
//       and re-running them from inside here proved nothing the suite does not
//       and cost more wall than every other leg put together.
//
// WHAT THIS HALF ASKS OF THE RIG (`_sandbox_boot_helpers.mjs`, the implementer's
// file). The stubs are driven by environment knobs only, so nothing here links
// against an export that may not exist yet:
//
//   `systemd-run`  a `fleet-fold-*` unit is its FIRST case (never the engine's):
//                  it says a line naming its unit, says `fold dir present` when
//                  `<evidence>/.ultrapowers/runs/7/publish-fold` already exists,
//                  prints `fold stub speaking` on stdout, writes `engine-head`,
//                  `receipt.json` and (on `suite red`) `suite-<attempt>.txt`,
//                  and exits `STUB_FOLD_CODE` / `STUB_FOLD_CODE_2`.
//   knobs          `STUB_FOLD_DISPOSITION` / `STUB_FOLD_DISPOSITION_2` (SET BUT
//                  EMPTY is a folder that wrote no disposition — read them with
//                  `${VAR-default}`, not `${VAR:-default}`), `STUB_FOLD_PATH`,
//                  `STUB_FOLD_REASON`, `STUB_FOLD_RESOLVERS`, `STUB_FOLD_CODE`,
//                  `STUB_FOLD_CODE_2`, `STUB_FOLD_PARK`, `STUB_FOLD_NO_HEAD`,
//                  `STUB_FOLD_BAD_RECEIPT`, `STUB_FOLD_ACTIVE`,
//                  `STUB_MERGE_MESSAGE`, `STUB_MERGE_CODE` (the FIRST PUT) and
//                  `STUB_MERGE_CODE_2` (the second, default 200),
//                  `STUB_MERGEABLE_NULL`, `STUB_INTEGRATION_PUSH_FAIL`.
//   `git`          records `update-ref` and `--force-with-lease` argv the way it
//                  records every other call, and refuses the integration push
//                  under `STUB_INTEGRATION_PUSH_FAIL`.
//   `curl`         answers `GET …/pulls/<n>` with a `mergeable` body
//                  (`STUB_MERGEABLE_NULL` nulls the first N), appends each
//                  `PATCH …/pulls/<n>` payload as one JSON line of `patch.log`,
//                  and answers the merge PUT with `STUB_MERGE_MESSAGE`.
//   `systemctl`    answers `is-active fleet-fold-*` with `STUB_FOLD_ACTIVE`,
//                  `inactive` by default.
//
// The engine-head file and attempt 1's `candidate` are DISTINCT values in the
// rig — leg (b) is the reason: an exam where they are equal cannot tell the two
// restore targets apart, so it asserts they differ before it reads them.
// ═════════════════════════════════════════════════════════════════════════════

const FOLD_UNIT_1 = 'fleet-fold-7-1'
const FOLD_UNIT_2 = 'fleet-fold-7-2'
const PULL_URL = `${API}/repos/${TARGET}/pulls/1`
const checkUrlFor = (sha) => `${API}/repos/${TARGET}/commits/${sha}/check-runs`
/** The plan header that gives `plan_closes` one ticket to print. */
const CLOSES_EXTRA = '**Goal:** the smoke\n**Closes:** #12'

// ── the fold's own files ─────────────────────────────────────────────────────

const foldDir = (ctx) => path.join(ctx.home, 'evidence', '.ultrapowers', 'runs', '7', 'publish-fold')
const foldPath = (ctx, name) => path.join(foldDir(ctx), name)
const foldRead = (ctx, name, leg) => {
  const f = foldPath(ctx, name)
  assert.ok(fs.existsSync(f), `${leg} ${f} must exist${whyFold(ctx)}`)
  return fs.readFileSync(f, 'utf8')
}
const receiptOf = (ctx, leg) => {
  const raw = foldRead(ctx, 'receipt.json', leg)
  try {
    return JSON.parse(raw)
  } catch {
    return assert.fail(`${leg} publish-fold/receipt.json must parse as JSON; it holds: ${raw}`)
  }
}
const attemptOf = (ctx, n, leg) => {
  const receipt = receiptOf(ctx, leg)
  const row = (receipt.attempts || {})[String(n)]
  assert.ok(row, `${leg} the receipt records attempt ${n}: ${JSON.stringify(receipt)}`)
  return row
}
/** The last non-blank line of a file the boot's own `tee` wrote. */
const tailLine = (text) => {
  const ls = text.split('\n').filter((l) => l.trim() !== '')
  return ls[ls.length - 1] || ''
}

/** The slice of the boot log a fold leg is about. */
const whyFold = (ctx) => {
  const kept = stream(ctx).filter((l) =>
    l.startsWith('CALL curl') || l.startsWith('CALL systemd-run') ||
    l.startsWith('CALL systemctl') || l.startsWith('CALL git') ||
    l.startsWith('status:') || l.startsWith('engine:') || l.startsWith('publish:') ||
    l.startsWith('merge:') || l.startsWith('outcome:') || l.startsWith('FAILED:') ||
    l.includes('fold'))
  return `\n--- fleet-boot.log (calls, states and fold lines) ---\n${kept.join('\n')}`
}

// ── reading the logs ─────────────────────────────────────────────────────────

const at = (ctx, pred, what, leg) => {
  const i = stream(ctx).findIndex(pred)
  assert.ok(i >= 0, `${leg} the boot log must hold ${what}${whyFold(ctx)}`)
  return i
}
const hasPair = (argv, a, b) => argv.some((w, i) => w === a && argv[i + 1] === b)
const foldUnits = (ctx) => unitsRun(ctx).filter((u) => (u || '').startsWith('fleet-fold-'))
const unitArgv = (ctx, unit, leg) => {
  const argv = argvLines(ctx, 'systemd-run').find((a) => a.includes(`--unit=${unit}`))
  assert.ok(argv, `${leg} a systemd-run of --unit=${unit}; the units run were ` +
    `${JSON.stringify(unitsRun(ctx))}${whyFold(ctx)}`)
  return argv
}
/** The stub's own line for a fold unit's start, which names the unit. */
const foldRunLine = (unit) => (l) => l.startsWith('CALL systemd-run') && l.includes(unit)

const updateRefs = (ctx) => gitLog(ctx).filter((a) => verbOf(a) === 'update-ref')
const integrationPushes = (ctx) => gitLog(ctx).filter(isIntegrationPush)
const leaseOf = (argv) => argv.find((w) => w.startsWith('--force-with-lease'))
const isBranchRevParse = (a) => verbOf(a) === 'rev-parse' && a.includes(INTEGRATION_BRANCH)

const curlCalls = (ctx) => argvLines(ctx, 'curl')
const isMergePut = (a) => a.includes(MERGE_URL)
const isPullGet = (a) => a.includes(PULL_URL) && !a.includes('-X')
const isCheckRead = (a) => a.some((w) => w.startsWith(`${API}/repos/${TARGET}/commits/`) && w.endsWith('/check-runs'))
const isPullPatch = (a) => a.includes(PULL_URL) && hasPair(a, '-X', 'PATCH')
const indicesOf = (ctx, pred) => curlCalls(ctx).map((a, i) => (pred(a) ? i : -1)).filter((i) => i >= 0)
/** Every PATCH the run sent, as the JSON payload `patch.log` recorded. */
const patches = (ctx) =>
  lines(readLog(ctx, 'patch.log')).map((l) => {
    try {
      return JSON.parse(l)
    } catch {
      return assert.fail(`each line of patch.log is the PATCH's JSON payload; got: ${l}`)
    }
  })

// ── the runs this half reads ─────────────────────────────────────────────────
//
// One boot per shape, started where it is declared and read by every leg that
// asks about it — the same economy `green()` is, and the same concurrency the
// merge half's scenarios are.

/** A boot with `env` on top of the rig's; `expect` null leaves the exit to the leg. */
const bootWith = (env, expect = 0) => started(() => bootRun(env).then((ctx) => {
  if (expect !== null) assert.equal(ctx.result.status, expect, ctx.result.stdout + ctx.result.stderr)
  return ctx
}))

/** The one 405 that buys a retry (M7). */
const NOT_MERGEABLE = { STUB_MERGE_CODE: '405', STUB_MERGE_MESSAGE: 'Pull Request is not mergeable' }

const noCommits = bootWith({ STUB_NO_COMMITS: '1' })
const foldCrash = bootWith({ STUB_FOLD_CODE: '3', STUB_FOLD_DISPOSITION: '' })
const foldCrashNoHead = bootWith({ STUB_FOLD_CODE: '3', STUB_FOLD_DISPOSITION: '', STUB_FOLD_NO_HEAD: '1' })
const foldCrashFolded = bootWith({ STUB_FOLD_CODE: '3', STUB_FOLD_DISPOSITION: 'folded' })
const foldCrashBadReceipt = bootWith({ STUB_FOLD_CODE: '3', STUB_FOLD_DISPOSITION: '', STUB_FOLD_BAD_RECEIPT: '1' })
const foldPark = bootWith({ STUB_FOLD_PARK: '1' }, null)
const crashOnTwo = bootWith({ ...NOT_MERGEABLE, STUB_FOLD_CODE_2: '3', STUB_FOLD_DISPOSITION_2: '' })
const pushFail = bootWith({ STUB_INTEGRATION_PUSH_FAIL: '1' }, null)
const suiteRed = bootWith({ STUB_FOLD_DISPOSITION: 'suite red', STUB_PLAN_EXTRA: CLOSES_EXTRA })
const conflictParked = bootWith({ STUB_FOLD_DISPOSITION: 'conflict parked', STUB_FOLD_PATH: 'a.txt' })
const foldedResolvers = bootWith({ STUB_FOLD_DISPOSITION: 'folded', STUB_FOLD_RESOLVERS: '1' })
const foldedPlain = bootWith({ STUB_FOLD_DISPOSITION: 'folded', STUB_FOLD_RESOLVERS: '0' })
const nothingToJoin = bootWith({ STUB_FOLD_DISPOSITION: 'nothing to join' })
const cannotFold = bootWith({ STUB_FOLD_DISPOSITION: 'cannot fold', STUB_FOLD_REASON: 'base not an ancestor' })
const suiteRedParked = bootWith({ STUB_FOLD_DISPOSITION: 'suite red', STUB_VERDICT: 'NEEDS_ACK' })
const heldFolded = bootWith({ STUB_FOLD_DISPOSITION: 'folded', FLEET_ASSIGNMENT: `${ASSIGNMENT} hold=1` })
const retryMerged = bootWith({ ...NOT_MERGEABLE })
const retry405Twice = bootWith({ ...NOT_MERGEABLE, STUB_MERGE_CODE_2: '405', STUB_FOLD_RESOLVERS: '1' })
const retryTipUnmoved = bootWith({ ...NOT_MERGEABLE, STUB_FOLD_DISPOSITION_2: 'tip unmoved' })
const retrySuiteRed = bootWith({ ...NOT_MERGEABLE, STUB_FOLD_DISPOSITION_2: 'suite red' })
const mergeableLate = bootWith({ ...NOT_MERGEABLE, STUB_MERGEABLE_NULL: '2' })
const merge405Other = bootWith({ STUB_MERGE_CODE: '405', STUB_MERGE_MESSAGE: 'Base branch was modified' })
const merge409 = bootWith({ STUB_MERGE_CODE: '409' })
const merge422 = bootWith({ STUB_MERGE_CODE: '422' })
const merge500 = bootWith({ STUB_MERGE_CODE: '500' })
const noGateReceipt = bootWith({ STUB_NO_RECEIPT: '1' })

// ── (a) the fold unit, its argv and its place in the order  [M1] ─────────────

test('the green boot runs the engine, then one fold unit  [publish-fold M1 / leg (a)]', async () => {
  const ctx = await green()
  const units = unitsRun(ctx)
  assert.deepEqual(foldUnits(ctx), [FOLD_UNIT_1],
    `(a) [M1] exactly one fold unit, ${FOLD_UNIT_1}; the units run were ` +
      `${JSON.stringify(units)}${whyFold(ctx)}`)
  assert.ok(units.indexOf('fleet-engine-7') >= 0 &&
    units.indexOf('fleet-engine-7') < units.indexOf(FOLD_UNIT_1),
    `(a) [M1] the engine's unit comes first: ${JSON.stringify(units)}`)
})

test("the fold unit's argv is the engine's bracket, pointed at publish-fold.mjs  [publish-fold M1 / leg (a)]", async () => {
  const ctx = await green()
  const argv = unitArgv(ctx, FOLD_UNIT_1, '(a) [M1]')
  const shown = argv.join(' ')
  for (const word of [
    '--pipe', '--wait', '--collect', 'env', '-u', 'CLAUDE_CONFIG_DIR',
    `ANTHROPIC_BASE_URL=https://claude-max.int.exe.xyz`,
    'CLAUDE_CODE_OAUTH_TOKEN=placeholder', 'ULTRAPOWERS_FLEET_RUN=run-7',
  ]) {
    assert.ok(argv.includes(word), `(a) [M1] the fold unit's argv carries '${word}': ${shown}`)
  }
  for (const [flag, value] of [
    ['-p', 'MemoryMax=40G'],
    ['-p', 'MemorySwapMax=0'],
    ['-p', `WorkingDirectory=${targetDir(ctx)}`],
    ['env', '-u'],
    ['-u', 'CLAUDE_CONFIG_DIR'],
    ['--repo', targetDir(ctx)],
    ['--base', BASE_SHA],
    ['--branch', INTEGRATION_BRANCH],
    ['--run', '7'],
    ['--attempt', '1'],
    ['--evidence-dir', `${ctx.home}/evidence/.ultrapowers/runs/7`],
    ['--run-dir', `${targetDir(ctx)}/.claude/ultrapowers/run-run-7`],
  ]) {
    assert.ok(hasPair(argv, flag, value),
      `(a) [M1] '${flag}' and '${value}' are adjacent words of the fold unit's argv: ${shown}`)
  }
  assert.ok(argv.some((w) => w.endsWith('/fleet/publish-fold.mjs')),
    `(a) [M1] the folder the unit runs is a word ending /fleet/publish-fold.mjs: ${shown}`)
})

test("the fold's output is teed into publish-fold/publish-fold-1.log  [publish-fold M1 / leg (a)]", async () => {
  const ctx = await green()
  const log = foldRead(ctx, 'publish-fold-1.log', '(a) [M1]')
  assert.ok(log.includes('fold stub speaking'),
    `(a) [M1] the boot's own tee wrote the unit's stdout into publish-fold-1.log; it holds:\n${log}`)
  assert.ok(stream(ctx).some((l) => l.includes('fold dir present')),
    `(a) [M1] the receipts directory is made BEFORE the bracket — tee -a needs it, and the ` +
      `stub says so only when it already exists${whyFold(ctx)}`)
})

test('running/publish fold, the unit, its await and publishing are in that order  [publish-fold M1 / leg (a)]', async () => {
  const ctx = await green()
  const running = at(ctx, (l) => l.startsWith('status: state=running') && l.includes('phase=publish fold'),
    'a `status: state=running phase=publish fold` line', '(a) [M1]')
  const unit = at(ctx, foldRunLine(FOLD_UNIT_1), `the fold unit's systemd-run line`, '(a) [M1]')
  const active = at(ctx, (l) => l.includes(`systemctl is-active ${FOLD_UNIT_1}.service`),
    `an is-active read of ${FOLD_UNIT_1}.service`, '(a) [M1]')
  const publishing = at(ctx, (l) => l.startsWith('status: state=publishing'),
    'a `status: state=publishing` line', '(a) [M1]')
  assert.ok(running < unit, `(a) [M1] the page says publish fold before the unit starts${whyFold(ctx)}`)
  assert.ok(unit < active, `(a) [M1] the unit is awaited after it is started${whyFold(ctx)}`)
  assert.ok(active < publishing,
    `(a) [M1] publishing is claimed only after the fold unit is inactive${whyFold(ctx)}`)
})

test('no phase_refresher runs beside the fold unit  [publish-fold M1 / leg (a)]', async () => {
  const ctx = await green()
  const s = stream(ctx)
  const exited = s.findIndex((l) => l.startsWith('engine: exited'))
  assert.ok(exited >= 0, `(a) [M1] the engine's exit line is in the log${whyFold(ctx)}`)
  const after = s.slice(exited).filter((l) => l.startsWith('status: state=running'))
  assert.equal(after.length, 1,
    `(a) [M1] exactly one running page is written after the engine exits — a refresher beside ` +
      `the fold would write more, and would erase the deadman's page:\n${after.join('\n')}`)
  assert.ok(after[0].includes('phase=publish fold'),
    `(a) [M1] and that one is the fold's: ${after[0]}`)
})

test("the engine's done marker holds the engine's code, not the fold's  [publish-fold M1 / leg (a)]", async () => {
  for (const [label, ctx] of [['the green boot', await green()], ['a fold that exited 3', await foldCrash()]]) {
    assert.deepEqual(foldUnits(ctx), [FOLD_UNIT_1],
      `(a) [M1] ${label} ran the fold unit${whyFold(ctx)}`)
    const marker = path.join(ctx.home, '.fleet-engine-done')
    assert.ok(fs.existsSync(marker), `(a) [M1] ${label} leaves the engine's marker`)
    assert.equal(fs.readFileSync(marker, 'utf8').trim(), '0',
      `(a) [M1] ${label}: the marker still holds the ENGINE's exit code — a fold that wrote ` +
        `it would be read as an engine failure on re-entry`)
  }
})

test('a parked outcome runs the fold unit too  [publish-fold M1 / leg (a)]', async () => {
  const ctx = await parked()
  assert.equal(statusOf(ctx).state, 'parked')
  assert.deepEqual(foldUnits(ctx), [FOLD_UNIT_1],
    `(a) [M1] gate-green and parked alike fold, as long as there are commits ahead of BASE` +
      `${whyFold(ctx)}`)
})

test('a branch with nothing ahead of BASE starts no fold unit  [publish-fold M1 / leg (a)]', async () => {
  const ctx = await noCommits()
  assert.equal(statusOf(ctx).state, 'parked')
  assert.deepEqual(foldUnits(ctx), [],
    `(a) [M1] nothing to publish is nothing to fold${whyFold(ctx)}`)
  assert.ok(!fs.existsSync(foldDir(ctx)),
    '(a) [M1] and no receipts directory is made for a fold that never runs')
})

// ── (b) the page first, the crash row, and the deadman  [M2] ─────────────────

test('a fold that exits non-zero with no disposition restores the ref and writes a crash row  [publish-fold M2 / leg (b)]', async () => {
  const ctx = await foldCrash()
  const leg = '(b) [M2]'
  const head = foldRead(ctx, 'engine-head', leg).trim()
  const refs = updateRefs(ctx)
  assert.equal(refs.length, 1, `${leg} exactly one update-ref: ${JSON.stringify(refs)}`)
  assert.equal(dirOf(refs[0]), targetDir(ctx), `${leg} run in the target clone: ${refs[0].join(' ')}`)
  assert.deepEqual(refs[0].slice(refs[0].indexOf('update-ref')),
    ['update-ref', `refs/heads/${INTEGRATION_BRANCH}`, head],
    `${leg} the ref goes back to the engine-head file's content (${head})`)

  const row = attemptOf(ctx, 1, leg)
  assert.equal(row.disposition, 'cannot fold', `${leg} the invoked attempt's disposition`)
  assert.ok(String(row.reason).includes('exit 3'),
    `${leg} the reason names the exit code; got: ${row.reason}`)
  const last = tailLine(foldRead(ctx, 'publish-fold-1.log', leg))
  assert.ok(last !== '' && String(row.reason).includes(last),
    `${leg} and the log's last line ('${last}'); got: ${row.reason}`)
  assert.equal(row.candidate, head, `${leg} the candidate is the restored sha`)

  assert.equal(integrationPushes(ctx).length, 1, `${leg} the branch is still pushed${whyFold(ctx)}`)
  assert.equal(prPosts(ctx).length, 1, `${leg} and the PR is still opened`)
  const status = statusOf(ctx)
  assert.equal(status.state, 'done', `${leg} the run still ends done${whyFold(ctx)}`)
  assert.ok(String(status.phase).includes('cannot fold'),
    `${leg} whose phase carries the disposition; got: ${status.phase}`)
})

test('a crash before the folder wrote engine-head reads the branch first  [publish-fold M2 / leg (b)]', async () => {
  const ctx = await foldCrashNoHead()
  const leg = '(b) [M2]'
  const git = gitLog(ctx)
  const revParse = git.findIndex(isBranchRevParse)
  const updateRef = git.findIndex((a) => verbOf(a) === 'update-ref')
  assert.ok(revParse >= 0, `${leg} the branch is read with rev-parse when engine-head is absent`)
  assert.ok(updateRef >= 0, `${leg} and the ref is restored${whyFold(ctx)}`)
  assert.ok(revParse < updateRef,
    `${leg} the rev-parse comes first — the file is written before it is read back`)
  const receipt = receiptOf(ctx, leg)
  assert.equal(receipt.engineHead, HEAD_SHA,
    `${leg} the receipt is created from nothing with engineHead = the rev-parse answer`)
  assert.equal(attemptOf(ctx, 1, leg).disposition, 'cannot fold', `${leg} and carries the crash row`)
})

test('a fold that wrote its disposition and then died keeps its row  [publish-fold M2 / leg (b)]', async () => {
  const ctx = await foldCrashFolded()
  const leg = '(b) [M2]'
  assert.deepEqual(updateRefs(ctx), [],
    `${leg} no ref is restored: the invoked attempt recorded a disposition${whyFold(ctx)}`)
  const row = attemptOf(ctx, 1, leg)
  assert.equal(row.disposition, 'folded',
    `${leg} and the folder's own disposition is not overwritten by a crash row`)
})

test("attempt 2's crash restores attempt 1's candidate, not engine-head  [publish-fold M2 / leg (b)]", async () => {
  const ctx = await crashOnTwo()
  const leg = '(b) [M2]'
  const head = foldRead(ctx, 'engine-head', leg).trim()
  const first = attemptOf(ctx, 1, leg)
  assert.notEqual(first.candidate, head,
    `${leg} the rig writes engine-head and attempt 1's candidate distinct, or this leg proves nothing`)
  const refs = updateRefs(ctx)
  assert.equal(refs.length, 1, `${leg} one update-ref: ${JSON.stringify(refs)}`)
  assert.deepEqual(refs[0].slice(refs[0].indexOf('update-ref')),
    ['update-ref', `refs/heads/${INTEGRATION_BRANCH}`, first.candidate],
    `${leg} attempt 2's restore target is attempt 1's candidate (${first.candidate})`)
  const second = attemptOf(ctx, 2, leg)
  assert.equal(second.disposition, 'cannot fold', `${leg} attempt 2's row`)
  assert.equal(second.candidate, first.candidate, `${leg} carrying that same sha as its candidate`)
  const pushes = integrationPushes(ctx)
  assert.equal(pushes.length, 2, `${leg} two pushes of the integration branch${whyFold(ctx)}`)
  assert.equal(leaseOf(pushes[1]), `--force-with-lease=${INTEGRATION_BRANCH}:${first.pushedHead}`,
    `${leg} and the second carries the lease: ${pushes[1].join(' ')}`)
})

test('an unparsable receipt at crash time is replaced, not read  [publish-fold M2 / leg (b)]', async () => {
  const ctx = await foldCrashBadReceipt()
  const leg = '(b) [M2]'
  const receipt = receiptOf(ctx, leg)
  assert.equal(receipt.engineHead, HEAD_SHA,
    `${leg} the crash row still lands, starting from { engineHead: <rev-parse>, attempts: {} }`)
  assert.equal(attemptOf(ctx, 1, leg).disposition, 'cannot fold', `${leg} with attempt 1's row`)
  const refs = updateRefs(ctx)
  assert.equal(refs.length, 1, `${leg} one update-ref: ${JSON.stringify(refs)}`)
  assert.equal(refs[0][refs[0].length - 1], HEAD_SHA, `${leg} carrying that same sha`)
  const pushes = integrationPushes(ctx)
  assert.equal(pushes.length, 1, `${leg} one push${whyFold(ctx)}`)
  assert.equal(leaseOf(pushes[0]), undefined,
    `${leg} and no attempt names a pushedHead, so the push is plain: ${pushes[0].join(' ')}`)
})

test("the deadman's parked page ends the run at 0 with no push and no PR  [publish-fold M2 / leg (b)]", async () => {
  const ctx = await foldPark()
  const leg = '(b) [M2]'
  assert.equal(ctx.result.status, 0,
    `${leg} the deadman's own exit is taken: ${ctx.result.stdout}${ctx.result.stderr}`)
  assert.equal(statusOf(ctx).state, 'parked', `${leg} the page the deadman wrote stands${whyFold(ctx)}`)

  const unit = at(ctx, foldRunLine(FOLD_UNIT_1), `the fold unit's systemd-run line`, leg)
  const after = stream(ctx).slice(unit).filter((l) => l.startsWith('status: state='))
  assert.deepEqual(after, [],
    `${leg} the boot writes no status line of its own after the deadman's:\n${after.join('\n')}`)

  assert.ok(gitLog(ctx).some((a) => verbOf(a) === 'commit' &&
    a.some((w) => w.includes('parked — deadman'))),
    `${leg} the evidence commit's subject is 'run-7: parked — deadman'${whyFold(ctx)}`)
  assert.ok(gitLog(ctx).some((a) => verbOf(a) === 'ls-remote' && a.includes('--tags')),
    `${leg} record_tags still runs${whyFold(ctx)}`)
  assert.equal(integrationPushes(ctx).length, 0, `${leg} no branch push`)
  assert.equal(prPosts(ctx).length, 0, `${leg} and no PR POST`)
  assert.ok(!fs.existsSync(foldPath(ctx, 'receipt.json.tmp')),
    `${leg} and the receipt's .tmp is removed`)
})

/** A home whose page says a fold is running, and the deadman's own pass over
 *  it — leg (i)'s scenario, started at load like every other. */
const deadmanOverFold = started(() => {
  const ctx = makeHome()
  const page = {
    run: '7', state: 'running', phase: 'publish fold', pr: PR_URL, prAuthor: PR_AUTHOR,
    merged: mergeSha(), branch: INTEGRATION_BRANCH, vm: VM_NAME,
    startedAt: '2026-09-06T00:00:00Z', updatedAt: '2026-09-06T00:00:01Z', error: null,
  }
  fs.mkdirSync(path.join(ctx.home, 'www'), { recursive: true })
  fs.writeFileSync(path.join(ctx.home, 'www', 'status.json'), JSON.stringify(page))
  return gatedBoot(ctx, ['deadman'], { STUB_ENGINE_ACTIVE: 'active', STUB_FOLD_ACTIVE: 'active' })
    .then((dead) => { ctx.dead = dead; return ctx })
})

test('the deadman stops the fold units beside the engine and carries the PR cells forward  [publish-fold M2 / leg (i)]', async () => {
  const ctx = await deadmanOverFold()
  const dead = ctx.dead
  assert.equal(dead.status, 0, dead.stdout + dead.stderr)

  const stops = argvLines(ctx, 'systemctl').filter((a) => a.includes('stop')).map((a) => a.join(' '))
  assert.ok(stops.some((l) => l.endsWith('stop fleet-engine-7.service')),
    `(i) [M2] the engine's unit is stopped:\n${stops.join('\n')}`)
  assert.ok(stops.some((l) => l.endsWith(`stop ${FOLD_UNIT_1}.service`)),
    `(i) [M2] and every active fleet-fold-7-* unit beside it:\n${stops.join('\n')}`)

  const status = statusOf(ctx)
  assert.equal(status.state, 'parked', '(i) [M2] the page is parked')
  assert.equal(status.pr, PR_URL, '(i) [M2] carrying the pr cell the page it overwrote held')
  assert.equal(status.prAuthor, PR_AUTHOR, '(i) [M2] its prAuthor')
  assert.equal(status.merged, mergeSha(), '(i) [M2] and its merged')
})

// ── (c) push_head  [M3] ──────────────────────────────────────────────────────

test('the green boot pushes the branch plainly, then reads it back  [publish-fold M3 / leg (c)]', async () => {
  const ctx = await green()
  const leg = '(c) [M3]'
  const pushes = integrationPushes(ctx)
  assert.equal(pushes.length, 1, `${leg} exactly one push of ${INTEGRATION_BRANCH}${whyFold(ctx)}`)
  assert.equal(leaseOf(pushes[0]), undefined,
    `${leg} no attempt names a pushedHead yet, so no --force-with-lease: ${pushes[0].join(' ')}`)
  const push = at(ctx, (l) => l.startsWith('CALL git') && l.includes('push') &&
    l.includes(INTEGRATION_BRANCH), `the integration branch's push`, leg)
  const visible = at(ctx, (l) => l.startsWith('CALL curl branches'),
    `the branches read await_branch_visible makes`, leg)
  assert.ok(push < visible, `${leg} await_branch_visible follows the push${whyFold(ctx)}`)
  assert.equal(attemptOf(ctx, 1, leg).pushedHead, HEAD_SHA,
    `${leg} and the pushed sha is recorded as attempt 1's pushedHead`)
})

test('a re-entry that already recorded a PR still pushes, and POSTs nothing  [publish-fold M3 / leg (c)]', () => {
  const ctx = makeHome()
  assert.equal(boot(ctx).status, 0)
  const pushesBefore = integrationPushes(ctx).length
  const postsBefore = prPosts(ctx).length
  assert.equal(postsBefore, 1, '(c) [M3] the first pass opened the PR')
  // The unit restarted with the PR already on the page: `publish` is guarded,
  // `push_head` is not.
  fs.writeFileSync(path.join(ctx.home, 'www', 'status.json'),
    JSON.stringify({ ...statusOf(ctx), state: 'running', merged: null }))

  const again = boot(ctx)
  assert.equal(again.status, 0, again.stdout + again.stderr)
  assert.equal(prPosts(ctx).length, postsBefore,
    `(c) [M3] publish keeps only the POST, and a recorded pr still skips it${whyFold(ctx)}`)
  assert.ok(integrationPushes(ctx).length > pushesBefore,
    `(c) [M3] but the head is pushed again — the push left publish with the re-entry${whyFold(ctx)}`)
})

test('a refused integration push fails the run before the PR  [publish-fold M3 / leg (c)]', async () => {
  const ctx = await pushFail()
  const leg = '(c) [M3]'
  assert.notEqual(ctx.result.status, 0, `${leg} a refused push ends the run non-zero`)
  const status = statusOf(ctx)
  assert.equal(status.state, 'failed', `${leg} the page is failed${whyFold(ctx)}`)
  assert.match(String(status.error), /push/, `${leg} the error names the push; got: ${status.error}`)
  assert.ok(String(status.error).includes(INTEGRATION_BRANCH),
    `${leg} and the branch it refused; got: ${status.error}`)
  assert.equal(curlCalls(ctx).filter((a) => a.some((w) => w.includes('/branches/'))).length, 0,
    `${leg} nothing is read back${whyFold(ctx)}`)
  assert.equal(prPosts(ctx).length, 0, `${leg} and no PR is opened`)
})

// ── (d) the PR body  [M4] ────────────────────────────────────────────────────

const bodyOf = (ctx, leg) => {
  const posts = prPosts(ctx)
  assert.equal(posts.length, 1, `${leg} the run opened one PR${whyFold(ctx)}`)
  return posts[0].body
}

test("a suite-red fold puts its section, its tail and publish-fold in the body  [publish-fold M4 / leg (d)]", async () => {
  const ctx = await suiteRed()
  const leg = '(d) [M4]'
  const body = bodyOf(ctx, leg)
  const section = body.indexOf('## Publish fold')
  const evidence = body.indexOf('### Evidence')
  assert.ok(section >= 0, `${leg} the body carries a '## Publish fold' section:\n${body}`)
  assert.ok(evidence >= 0 && section < evidence,
    `${leg} which sits before '### Evidence':\n${body}`)
  assert.ok(body.includes('suite red'), `${leg} it names the disposition:\n${body}`)
  const tail = tailLine(foldRead(ctx, 'suite-1.txt', leg))
  assert.ok(tail !== '' && body.includes(tail),
    `${leg} and the tail of publish-fold/suite-1.txt ('${tail}'):\n${body}`)
  assert.ok(body.split('\n').some((l) => l.trim() === '- publish-fold'),
    `${leg} the evidence listing names publish-fold, without a slash:\n${body}`)
  assert.equal(tailLine(body), 'Closes #12',
    `${leg} and plan_closes' lines are still the body's last:\n${body}`)
})

test('a conflict-parked fold names its path in the body  [publish-fold M4 / leg (d)]', async () => {
  const ctx = await conflictParked()
  const body = bodyOf(ctx, '(d) [M4]')
  assert.ok(body.includes('## Publish fold'), `(d) [M4] the section is rendered:\n${body}`)
  assert.ok(body.includes('conflict parked on a.txt'),
    `(d) [M4] naming the disposition and the path:\n${body}`)
})

test('a folded run renders the section only when it dispatched a resolver  [publish-fold M4 / leg (d)]', async () => {
  const withResolver = bodyOf(await foldedResolvers(), '(d) [M4] folded, one resolver:')
  assert.ok(withResolver.includes('## Publish fold'),
    `(d) [M4] a folded whose resolversDispatched is non-zero gets a section:\n${withResolver}`)
  const plain = bodyOf(await foldedPlain(), '(d) [M4] folded, no resolver:')
  assert.ok(!plain.includes('## Publish fold'),
    `(d) [M4] a folded with zero resolvers gets none — there is nothing to disclose:\n${plain}`)
})

test('nothing to join renders no section  [publish-fold M4 / leg (d)]', async () => {
  const ctx = await nothingToJoin()
  assert.equal(attemptOf(ctx, 1, '(d) [M4]').disposition, 'nothing to join',
    '(d) [M4] the fold ran and recorded its disposition')
  const body = bodyOf(ctx, '(d) [M4] nothing to join:')
  assert.ok(!body.includes('## Publish fold'),
    `(d) [M4] a run with nothing to join says nothing about the fold:\n${body}`)
})

// ── (e) FOLD_HOLD  [M5] ─────────────────────────────────────────────────────

const phaseOf = (ctx) => String(statusOf(ctx).phase)

test('a red suite holds the PR: no check read, no PUT, and the failure in the phase  [publish-fold M5 / leg (e)]', async () => {
  const ctx = await suiteRed()
  const leg = '(e) [M5]'
  assert.equal(checkReads(ctx), 0,
    `${leg} a non-empty FOLD_HOLD reads no check runs at all${whyFold(ctx)}`)
  assert.deepEqual(mergePuts(ctx), [], `${leg} and issues no PUT`)
  assert.equal(prPosts(ctx)[0].draft, false,
    `${leg} a gate-green outcome still opens its PR non-draft`)
  assert.ok(phaseOf(ctx).includes('left open: publish fold — suite red'),
    `${leg} and the done phase is FOLD_HOLD's text; got: ${phaseOf(ctx)}`)
})

test('a parked conflict names its path in the phase  [publish-fold M5 / leg (e)]', async () => {
  const ctx = await conflictParked()
  assert.equal(attemptOf(ctx, 1, '(e) [M5]').disposition, 'conflict parked',
    '(e) [M5] the fold parked on a conflict')
  assert.ok(phaseOf(ctx).includes('left open: publish fold — conflict parked on a.txt'),
    `(e) [M5] got: ${phaseOf(ctx)}`)
  assert.deepEqual(mergePuts(ctx), [], '(e) [M5] and no PUT was issued')
})

test('a cannot-fold names its reason in the phase  [publish-fold M5 / leg (e)]', async () => {
  const ctx = await cannotFold()
  assert.equal(attemptOf(ctx, 1, '(e) [M5]').disposition, 'cannot fold',
    '(e) [M5] the fold could not fold')
  assert.ok(phaseOf(ctx).includes('left open: publish fold — cannot fold: base not an ancestor'),
    `(e) [M5] got: ${phaseOf(ctx)}`)
  assert.deepEqual(mergePuts(ctx), [], '(e) [M5] and no PUT was issued')
})

test('a held run under a fold hold still says hold=1  [publish-fold M5 / leg (e)]', async () => {
  const ctx = await heldFolded()
  assert.deepEqual(foldUnits(ctx), [FOLD_UNIT_1],
    `(e) [M5] a held run folds all the same${whyFold(ctx)}`)
  assert.ok(phaseOf(ctx).includes('left open: hold=1'),
    `(e) [M5] hold=1 keeps its own note whatever the disposition; got: ${phaseOf(ctx)}`)
  assert.deepEqual(mergePuts(ctx), [], '(e) [M5] and no PUT')
})

test('a red suite on a parked outcome still opens a draft  [publish-fold M5 / leg (e)]', async () => {
  const ctx = await suiteRedParked()
  assert.equal(attemptOf(ctx, 1, '(e) [M5]').disposition, 'suite red',
    '(e) [M5] the fold ran and its suite was red')
  assert.equal(prPosts(ctx)[0].draft, true,
    `(e) [M5] the draft flag follows the gate's outcome, not the fold's${whyFold(ctx)}`)
})

for (const [name, folded] of [['folded', foldedPlain], ['nothing to join', nothingToJoin]]) {
  test(`a ${name} fold merges the way the green path does  [publish-fold M5 / leg (e)]`, async () => {
    const ctx = await folded()
    assert.equal(attemptOf(ctx, 1, '(e) [M5]').disposition, name,
      `(e) [M5] the fold ran and disposed of the join as '${name}'`)
    assert.equal(mergePuts(ctx).length, 1,
      `(e) [M5] '${name}' is an empty FOLD_HOLD, so the merge runs${whyFold(ctx)}`)
    assert.equal(statusOf(ctx).merged, mergeSha(), `(e) [M5] and the PR is merged`)
    assert.equal(statusOf(ctx).state, 'done')
  })
}

// ── (f) the merge payload's commit_message  [M6] ─────────────────────────────

test('the merge PUT carries the run and plan tag as its commit_message  [publish-fold M6 / leg (f)]', async () => {
  const ctx = await green()
  const puts = mergePuts(ctx)
  assert.equal(puts.length, 1, '(f) [M6] the green path merges once')
  assert.equal(puts[0].commit_message, 'Fleet-Run: 7\nPlan-Tag: ultra/plan/run-7',
    '(f) [M6] the squash body names the run and the plan tag, exactly')
  assert.equal(puts[0].commit_title, PLAN_H1, "(f) [M6] beside the unchanged commit_title")
  assert.equal(puts[0].merge_method, 'squash', '(f) [M6] merge_method')
  assert.equal(puts[0].sha, HEAD_SHA, '(f) [M6] and sha')
})

// ── (g) the one retry  [M7] ─────────────────────────────────────────────────

test('a 405 saying "not mergeable" buys one more fold, one leased push and one more PUT  [publish-fold M7 / leg (g)]', async () => {
  const ctx = await retryMerged()
  const leg = '(g) [M7]'
  assert.deepEqual(commitStates(ctx), ['running', 'publishing', 'running', 'publishing', 'done'],
    `${leg} the retry's evidence commits${whyFold(ctx)}`)
  const units = foldUnits(ctx)
  assert.deepEqual(units, [FOLD_UNIT_1, FOLD_UNIT_2],
    `${leg} a second fold unit, after the first: ${JSON.stringify(unitsRun(ctx))}`)

  const running2 = at(ctx, (l) => l.includes('phase=publish fold (attempt 2)'),
    'a `running` page with phase `publish fold (attempt 2)`', leg)
  const unit2 = at(ctx, foldRunLine(FOLD_UNIT_2), `the second fold unit's systemd-run line`, leg)
  const active2 = at(ctx, (l) => l.includes(`systemctl is-active ${FOLD_UNIT_2}.service`),
    `an is-active read of ${FOLD_UNIT_2}.service`, leg)
  const lease = at(ctx, (l) => l.startsWith('CALL git') && l.includes('--force-with-lease'),
    'the leased push', leg)
  const s = stream(ctx)
  const publishing2 = s.findIndex((l, i) => i > lease && l.startsWith('status: state=publishing'))
  assert.ok(running2 < unit2 && unit2 < active2 && active2 < lease && lease < publishing2,
    `${leg} running (attempt 2) → the unit → its await → push_head → publishing${whyFold(ctx)}`)

  const puts = indicesOf(ctx, isMergePut)
  assert.equal(puts.length, 2, `${leg} exactly two PUTs${whyFold(ctx)}`)
  const second = attemptOf(ctx, 2, leg)
  const reads = indicesOf(ctx, isCheckRead).filter((i) => i > puts[0])
  assert.ok(reads.length >= 1, `${leg} the check-runs loop is re-entered after the first PUT`)
  assert.ok(curlCalls(ctx)[reads[0]].includes(checkUrlFor(second.pushedHead)),
    `${leg} on the new head (${second.pushedHead}): ${curlCalls(ctx)[reads[0]].join(' ')}`)
  const gets = indicesOf(ctx, isPullGet)
  assert.ok(gets.length >= 1, `${leg} the PR's mergeability is polled${whyFold(ctx)}`)
  assert.ok(reads[0] < gets[0] && gets[gets.length - 1] < puts[1],
    `${leg} the checks, then the mergeable poll, then the second PUT`)
  assert.equal(mergePuts(ctx).length, 2, `${leg} two payloads were recorded`)
  assert.ok(phaseOf(ctx).includes('merged'), `${leg} and the run merged; got: ${phaseOf(ctx)}`)
})

test('a second 405 is the end of it  [publish-fold M7 / leg (g)]', async () => {
  const ctx = await retry405Twice()
  assert.equal(mergePuts(ctx).length, 2,
    `(g) [M7] exactly two PUTs — the retry is bought once${whyFold(ctx)}`)
  assert.ok(phaseOf(ctx).includes('left open: merge PUT answered 405 twice'),
    `(g) [M7] got: ${phaseOf(ctx)}`)
})

test('a tip unmoved on attempt 2 skips the push and the merge  [publish-fold M7 / leg (g)]', async () => {
  const ctx = await retryTipUnmoved()
  const leg = '(g) [M7]'
  assert.equal(attemptOf(ctx, 2, leg).disposition, 'tip unmoved',
    `${leg} the retry ran and found the tip where it left it`)
  assert.equal(integrationPushes(ctx).length, 1, `${leg} exactly one push${whyFold(ctx)}`)
  assert.equal(mergePuts(ctx).length, 1, `${leg} exactly one PUT`)
  assert.deepEqual(commitStates(ctx).slice(-2), ['publishing', 'done'],
    `${leg} publishing is still written before done: ${JSON.stringify(commitStates(ctx))}`)
  assert.ok(phaseOf(ctx).includes('405 twice'), `${leg} got: ${phaseOf(ctx)}`)
})

test('a 405 for any other reason keeps one PUT and starts no second fold  [publish-fold M7 / leg (g)]', async () => {
  const ctx = await merge405Other()
  assert.equal(mergePuts(ctx).length, 1, `(g) [M7] one PUT${whyFold(ctx)}`)
  assert.deepEqual(foldUnits(ctx), [FOLD_UNIT_1],
    `(g) [M7] and the run folded once and only once: ${JSON.stringify(unitsRun(ctx))}`)
  assert.ok(phaseOf(ctx).includes('left open: merge PUT answered 405'),
    `(g) [M7] got: ${phaseOf(ctx)}`)
  assert.ok(!phaseOf(ctx).includes('twice'), `(g) [M7] and not twice: ${phaseOf(ctx)}`)
})

test('a 409 keeps one PUT and starts no second fold  [publish-fold M7 / leg (g)]', async () => {
  const ctx = await merge409()
  assert.equal(mergePuts(ctx).length, 1, `(g) [M7] one PUT${whyFold(ctx)}`)
  assert.deepEqual(foldUnits(ctx), [FOLD_UNIT_1],
    `(g) [M7] and the run folded once and only once: ${JSON.stringify(unitsRun(ctx))}`)
  assert.ok(phaseOf(ctx).includes('left open: merge PUT answered 409'),
    `(g) [M7] got: ${phaseOf(ctx)}`)
})

for (const [code, refused] of [['422', merge422], ['500', merge500]]) {
  test(`a ${code} keeps one PUT, three evidence commits and one note  [publish-fold M7 / leg (g)]`, async () => {
    const ctx = await refused()
    assert.equal(mergePuts(ctx).length, 1, `(g) [M7] one PUT${whyFold(ctx)}`)
    assert.deepEqual(foldUnits(ctx), [FOLD_UNIT_1],
    `(g) [M7] and the run folded once and only once: ${JSON.stringify(unitsRun(ctx))}`)
    assert.deepEqual(commitStates(ctx), ['running', 'publishing', 'done'],
      '(g) [M7] a run with no retry commits the three states it always did')
    assert.ok(phaseOf(ctx).includes(`left open: merge PUT answered ${code}`),
      `(g) [M7] got: ${phaseOf(ctx)}`)
  })
}

test('the mergeable poll runs until GitHub answers something  [publish-fold M7 / leg (g)]', async () => {
  const ctx = await mergeableLate()
  const leg = '(g) [M7]'
  const puts = indicesOf(ctx, isMergePut)
  assert.equal(puts.length, 2, `${leg} the retry ran${whyFold(ctx)}`)
  const gets = indicesOf(ctx, isPullGet).filter((i) => i < puts[1])
  assert.equal(gets.length, 3,
    `${leg} two null answers are waited on and the third is the one it goes on${whyFold(ctx)}`)
})

// ── (h) the body PATCH  [M4] ────────────────────────────────────────────────

test("a disposition that lands after the POST is PATCHed onto the body  [publish-fold M4 / leg (h)]", async () => {
  const ctx = await retrySuiteRed()
  const leg = '(h) [M4]'
  const sent = patches(ctx)
  assert.equal(sent.length, 1, `${leg} exactly one PATCH${whyFold(ctx)}`)
  assert.ok(String(sent[0].body).includes('## Publish fold'),
    `${leg} carrying the re-rendered body:\n${sent[0].body}`)
  assert.ok(String(sent[0].body).includes('suite red'),
    `${leg} which names attempt 2's disposition:\n${sent[0].body}`)
  assert.ok(phaseOf(ctx).includes('suite red'),
    `${leg} and the done page's phase carries it too; got: ${phaseOf(ctx)}`)
})

test('a run refused twice PATCHes its body after the second PUT  [publish-fold M4 / leg (h)]', async () => {
  const ctx = await retry405Twice()
  const leg = '(h) [M4]'
  const sent = patches(ctx)
  assert.equal(sent.length, 1, `${leg} exactly one PATCH${whyFold(ctx)}`)
  assert.ok(String(sent[0].body).includes('## Publish fold'),
    `${leg} the re-rendered body:\n${sent[0].body}`)
  assert.ok(String(sent[0].body).includes('merge PUT answered 405 twice'),
    `${leg} naming what became of the merge:\n${sent[0].body}`)
  const puts = indicesOf(ctx, isMergePut)
  const patch = indicesOf(ctx, isPullPatch)
  assert.equal(patch.length, 1, `${leg} one PATCH call in curl's own record`)
  assert.ok(patch[0] > puts[1],
    `${leg} sent after the second PUT, whose answer it discloses${whyFold(ctx)}`)
})

test('a one-attempt run sends no PATCH at all  [publish-fold M4 / leg (h)]', async () => {
  const ctx = await green()
  assert.deepEqual(Object.keys(receiptOf(ctx, '(h) [M4]').attempts || {}), ['1'],
    '(h) [M4] the green run folded once')
  assert.deepEqual(patches(ctx), [],
    `(h) [M4] every disposition of a one-attempt run landed before the POST${whyFold(ctx)}`)
})

// ── (j) the rig itself  [M8] ────────────────────────────────────────────────

test("the fold unit does not take the engine's branch of the stub  [publish-fold M8 / leg (j)]", async () => {
  const ctx = await noGateReceipt()
  const receipt = path.join(ctx.home, 'target', '.claude', 'ultrapowers', 'run-run-7', 'gate-receipt.json')
  assert.deepEqual(foldUnits(ctx), [FOLD_UNIT_1],
    `(j) [M8] the fold unit ran${whyFold(ctx)}`)
  assert.ok(!fs.existsSync(receipt),
    "(j) [M8] and wrote no gate-receipt.json — the fleet-fold-* case comes FIRST in the stub, " +
      'so a fold never answers as the engine')
})

test('the systemctl stub answers a fold unit inactive  [publish-fold M8 / leg (j)]', () => {
  const ctx = makeHome()
  const r = spawnSync(path.join(ctx.bin, 'systemctl'), ['--user', 'is-active', `${FOLD_UNIT_1}.service`], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, FLEET_HOME: ctx.home },
  })
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.stdout.trim(), 'inactive',
    '(j) [M8] a fold unit is inactive unless STUB_FOLD_ACTIVE says otherwise')
})

// ═════════════════════════════════════════════════════════════════════════════
// THE PULL REQUEST QUOTES THE FOLD SUITE'S FAILING BLOCK
//
// A THIRD numbering, belonging to a third task (#763 narrowed to part (2), on
// top of #715's `suite red` section). Its clauses are M1–M5 and its legs (a)–(e)
// of their own, and every assertion below names them with a `failing-block`
// prefix so none of the three numberings in this file reads as another.
//
//   M1  on a `suite red` fold whose `publish-fold/suite-1.txt` is TAP-shaped —
//       `ok 1 - join`, then `not ok 2 - the recorded text names the failing
//       leg`, then more than twenty indented diagnostic lines, then `# fail 1`
//       as the last line — the PR body's fenced block contains the `not ok 2`
//       line.
//   M2  that fenced block's lines are exactly `suite-1.txt`'s lines from the
//       `not ok 2` line through its last line, `# fail 1` included, in order,
//       and the `ok 1 - join` line is not in the body.
//   M3  `publish-fold/suite-1.txt` on the evidence worktree is still the whole
//       text — twenty-eight lines, the first `ok 1 - join`, the last
//       `# fail 1` — not the excerpt.
//   M4  on a `suite red` fold whose `suite-1.txt` has no line matching the
//       start rule — three plain lines — the fenced block is those three lines
//       whole.
//   M5  the boot log of the `suite red` run carries no `node DIRECT` line: the
//       excerpt is produced by the boot script's own shell and awk.
//
// What the excerpt rule is, spelled once, because these legs read it and not an
// implementation of it: START is the first line matching the ERE
// `^(___+ .+ ___+$|FAILED |FAIL[: ]|not ok |AssertionError)`; END is the line
// before the first LATER line matching `^(___+ .+ ___+$|===+ |(not )?ok [0-9])`,
// or the file's last line when no later line matches; a file with NO start line
// is printed whole.
//
// Every leg below reads the fixture's own file off the evidence worktree and
// compares the body against THAT, so what is pinned is the rule and not a
// particular way of writing it. The one thing pinned as a literal is the
// fixture itself, because leg (a) only discriminates while the `not ok` line
// sits further from the end of the file than twenty lines.
// ═════════════════════════════════════════════════════════════════════════════

/**
 * `FOLD_SUITE_TEXT`'s twenty-eight lines, as the task spells them: `ok 1 -
 * join`, the `not ok 2` line, twenty-four two-space-indented `diagnostic line
 * N` lines for N from 1 to 24, `  ...`, and `# fail 1` last.
 */
const TAP_FIXTURE = [
  'ok 1 - join',
  'not ok 2 - the recorded text names the failing leg',
  ...Array.from({ length: 24 }, (_, i) => `  diagnostic line ${i + 1}`),
  '  ...',
  '# fail 1',
]
/** The line M1 and M2 name, verbatim. */
const NOT_OK_LINE = 'not ok 2 - the recorded text names the failing leg'
/** The first line, which M2 says the body does not carry. */
const OK_LINE = 'ok 1 - join'
/** The last line, which M3 says the record still ends on. */
const FAIL_LINE = '# fail 1'
/** What BASE's `tail -n 20` would have shown, as a number of lines. */
const BASE_TAIL = 20

/** A file's lines, one trailing newline dropped — the stub's `printf '%s\n'`
 *  leaves exactly one, and a blank line inside an excerpt is still a line. */
const fileLines = (text) => text.replace(/\n$/, '').split('\n')

/** `<evidence>/.ultrapowers/runs/7/publish-fold/suite-1.txt`, spelled out the
 *  way leg (c) spells it, read off the evidence worktree. */
const suiteRecord = (ctx, leg) => {
  const p = path.join(ctx.home, 'evidence', '.ultrapowers', 'runs', '7', 'publish-fold', 'suite-1.txt')
  assert.ok(fs.existsSync(p), `${leg} the fold's suite file is on the evidence worktree at ${p}${whyFold(ctx)}`)
  return fs.readFileSync(p, 'utf8')
}

/**
 * The fenced block of the `## Publish fold` section: the lines between the
 * first line that is exactly three backticks AFTER `## Publish fold` and the
 * next such line. The anchor matters — the `### Checks` section above carries a
 * ```json fence of its own, whose closing line is also three backticks.
 */
const foldFence = (body, leg) => {
  const ls = body.split('\n')
  const head = ls.findIndex((l) => l.trim() === '## Publish fold')
  assert.ok(head >= 0, `${leg} the body carries a '## Publish fold' section:\n${body}`)
  const open = ls.findIndex((l, i) => i > head && l === '```')
  assert.ok(open > head,
    `${leg} and a fenced block inside it — a line of exactly three backticks after the ` +
      `heading:\n${body}`)
  const close = ls.findIndex((l, i) => i > open && l === '```')
  assert.ok(close > open, `${leg} and that fence is closed by another such line:\n${body}`)
  return ls.slice(open + 1, close)
}

/** M4's fixture: a suite file with no line matching the start rule. */
const PLAIN_SUITE = ['first line', 'second line', 'third line']
const suiteRedPlain = bootWith({
  STUB_FOLD_DISPOSITION: 'suite red',
  STUB_FOLD_SUITE: PLAIN_SUITE.join('\n'),
})

// ── the fixture M1 describes  [failing-block M1] ─────────────────────────────

test("the rig's FOLD_SUITE_TEXT is the TAP shape, its last line FOLD_SUITE_LAST  [failing-block M1 / leg (a)]", () => {
  const leg = '(a) [failing-block M1]'
  assert.deepEqual(fileLines(String(rig('FOLD_SUITE_TEXT'))), TAP_FIXTURE,
    `${leg} FOLD_SUITE_TEXT is M1's TAP-shaped suite: '${OK_LINE}', the '${NOT_OK_LINE}' line, ` +
      `twenty-four indented 'diagnostic line N' lines, '  ...', and '${FAIL_LINE}' last — ` +
      `twenty-eight lines in all, so the '${NOT_OK_LINE}' line sits further than ${BASE_TAIL} ` +
      `lines from the end and a tail of ${BASE_TAIL} cannot reach it`)
  assert.equal(rig('FOLD_SUITE_LAST'), FAIL_LINE,
    `${leg} FOLD_SUITE_LAST is still that text's last line, which the body still has to carry`)
})

// ── (a) the failing leg's name is in the fenced block  [M1] ──────────────────

test("the fenced block of a suite-red body carries the not-ok line  [failing-block M1 / leg (a)]", async () => {
  const ctx = await suiteRed()
  const leg = '(a) [failing-block M1]'
  const recorded = fileLines(suiteRecord(ctx, leg))
  // The discriminator, asserted before the block is read: this fixture's
  // `not ok` line is OUTSIDE the last twenty lines, so a `tail -n 20` of it
  // cannot be what the body shows.
  assert.ok(!recorded.slice(-BASE_TAIL).includes(NOT_OK_LINE),
    `${leg} the fixture puts the '${NOT_OK_LINE}' line outside suite-1.txt's last ${BASE_TAIL} ` +
      `lines; the file's ${recorded.length} lines are:\n${recorded.join('\n')}`)
  const block = foldFence(bodyOf(ctx, leg), leg)
  assert.ok(block.includes(NOT_OK_LINE),
    `${leg} [M1] the fenced block names the failing leg — it holds the line\n  ${NOT_OK_LINE}\n` +
      `even though that line is the second of the file's ${recorded.length}; a tail of ` +
      `${BASE_TAIL} lacks it. The block is:\n${block.join('\n')}`)
})

// ── (b) the block is the failing test's own block, start to end of file  [M2] ─

test("the fenced block is suite-1.txt's lines from not-ok through its last  [failing-block M2 / leg (b)]", async () => {
  const ctx = await suiteRed()
  const leg = '(b) [failing-block M2]'
  const recorded = fileLines(suiteRecord(ctx, leg))
  const start = recorded.indexOf(NOT_OK_LINE)
  assert.ok(start >= 0, `${leg} the recorded suite holds the '${NOT_OK_LINE}' line:\n${recorded.join('\n')}`)
  assert.equal(recorded[recorded.length - 1], FAIL_LINE,
    `${leg} and ends on '${FAIL_LINE}' — with no later boundary line, the block runs to there`)
  const expected = recorded.slice(start)
  const body = bodyOf(ctx, leg)
  const block = foldFence(body, leg)
  assert.deepEqual(block, expected,
    `${leg} [M2] the block's lines are EXACTLY suite-1.txt's lines from its '${NOT_OK_LINE}' ` +
      `line through '${FAIL_LINE}', in order — ${expected.length} lines, no more and no fewer.\n` +
      `--- the block in the body (${block.length} lines) ---\n${block.join('\n')}\n` +
      `--- suite-1.txt from the not-ok line (${expected.length} lines) ---\n${expected.join('\n')}`)
  assert.ok(!body.includes(OK_LINE),
    `${leg} [M2] and the '${OK_LINE}' line above the start is nowhere in the body — the block ` +
      `begins at the marker, it does not begin at the file:\n${body}`)
})

// ── (c) the record on the evidence branch is still whole  [M3] ───────────────

test('the suite file on the evidence worktree is the whole text, not the excerpt  [failing-block M3 / leg (c)]', async () => {
  const ctx = await suiteRed()
  const leg = '(c) [failing-block M3]'
  const recorded = fileLines(suiteRecord(ctx, leg))
  assert.equal(recorded.length, 28,
    `${leg} [M3] <evidence>/.ultrapowers/runs/7/publish-fold/suite-1.txt has twenty-eight ` +
      `lines; it has ${recorded.length}:\n${recorded.join('\n')}`)
  assert.equal(recorded[0], OK_LINE,
    `${leg} [M3] the first of them is '${OK_LINE}' — the record keeps the lines the body's ` +
      `excerpt drops; got: ${JSON.stringify(recorded[0])}`)
  assert.equal(recorded[recorded.length - 1], FAIL_LINE,
    `${leg} [M3] and the last is '${FAIL_LINE}'; got: ${JSON.stringify(recorded[recorded.length - 1])}`)
  assert.deepEqual(recorded, TAP_FIXTURE,
    `${leg} [M3] the record is the whole of what the fold's suite wrote and nothing the ` +
      `excerpting touched:\n${recorded.join('\n')}`)
  const block = foldFence(bodyOf(ctx, leg), leg)
  assert.ok(block.length < recorded.length,
    `${leg} [M3] the body's block is an EXCERPT of that record, not the record — ` +
      `${block.length} lines against ${recorded.length}`)
})

// ── (d) a file with no start line is printed whole  [M4] ─────────────────────

test('a suite with no marker line is quoted whole  [failing-block M4 / leg (d)]', async () => {
  const ctx = await suiteRedPlain()
  const leg = '(d) [failing-block M4]'
  assert.deepEqual(fileLines(suiteRecord(ctx, leg)), PLAIN_SUITE,
    `${leg} the fixture's suite-1.txt is the three plain lines`)
  const block = foldFence(bodyOf(ctx, leg), leg)
  assert.deepEqual(block, PLAIN_SUITE,
    `${leg} [M4] no line of '${PLAIN_SUITE.join("', '")}' matches the start rule, so the ` +
      `fallback prints the file whole — the fenced block is exactly those three lines.\n` +
      `--- the block (${block.length} lines) ---\n${block.join('\n')}`)
})

// ── (e) the excerpt is shell and awk, never node  [M5] ──────────────────────

test("the suite-red boot calls node directly not once  [failing-block M5 / leg (e)]", async () => {
  const ctx = await suiteRed()
  const leg = '(e) [failing-block M5]'
  const log = lines(readLog(ctx, 'fleet-boot.log'))
  const direct = log.filter((l) => l.includes('node DIRECT'))
  assert.deepEqual(direct, [],
    `${leg} [M5] the stub \`node\` logs 'node DIRECT' whenever the boot script runs it as a ` +
      `command of its own, and the excerpt is the script's own shell and awk — on the sandbox ` +
      `\`node\` is argv to systemd-run only. The direct calls logged were:\n${direct.join('\n')}`)
})

runTests(tests)
