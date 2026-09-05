/**
 * Exam for the sandbox finishing its own pull request.
 *
 * At BASE the run stopped at the PR and waited for a human to press merge —
 * on a target whose CI is the only thing left to satisfy, that human added
 * nothing but latency. So after a gate-green publish the boot script polls the
 * PR head's check runs through the target's integration and squash-merges the
 * PR itself once every listed run is green, recording the squash commit as
 * `merged` on the status page. A failed check, half an hour of pending, a
 * merge GitHub refuses, or `hold=1` in the assignment leaves the PR open and
 * the run `done` exactly as before.
 *
 * The clauses this file pins:
 *
 *   M1  the check-runs GET, the merge PUT and its payload, and `merged` on the
 *       `done` page; the three green conclusions as an ALLOWLIST.
 *   M2  the four ways the merge does not happen — a red run, no run at all
 *       inside the grace, checks still pending at the wait, a refused PUT —
 *       and what the poll counts in each.
 *   M3  parked runs and `hold=`: no read and no PUT, and a bad `hold=` value
 *       fails the assignment before any clone.
 *   M4  `merged` is a cell on every page, and the green path's evidence
 *       commits and its one notification are unchanged.
 *   M5–M7  the three operator documents say so.
 *
 * The rig is `_sandbox_boot_helpers.mjs`, shared with the other sandbox-boot
 * sims: `makeHome`, `boot`, the log readers, and the check-runs and merge
 * stubs that answer this script's two new calls. A boot is ~40 forks of stub
 * shell, so the green run is the rig's memoized one and every other case boots
 * once.
 */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  SCRIPT, TARGET, HEAD_SHA, PR_URL, PLAN_H1, MERGE_SHA, ASSIGNMENT,
  makeHome, boot, green,
  stream, statusOf, states, committed, commitStates, notifies, engineRuns,
  readLog, argvLines, prPosts, mergePuts, mergeArgv, checkReads,
  runTests,
} from './_sandbox_boot_helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CONTRACT = path.join(HERE, '..', 'CONTRACT.md')
const RUNBOOK = path.join(HERE, '..', 'RUNBOOK.md')
const SKILL = path.join(HERE, '..', '..', 'skills', 'ultrapowers', 'SKILL.md')

const tests = []
const test = (name, fn) => tests.push([name, fn])

const EDGE = 'https://github.int.exe.xyz/api/v3'
const CHECKS_URL = `${EDGE}/repos/${TARGET}/commits/${HEAD_SHA}/check-runs`
const MERGE_URL = `${EDGE}/repos/${TARGET}/pulls/1/merge`

/** A check-runs document of `[name, status, conclusion]` triples. */
const checksBody = (runs) =>
  JSON.stringify({
    total_count: runs.length,
    check_runs: runs.map(([name, status, conclusion]) => ({ name, status, conclusion })),
  })

const completed = (name, conclusion) => [name, 'completed', conclusion]

/** One boot per case, run and asserted to have exited 0. */
function ran(env) {
  const ctx = makeHome()
  const r = boot(ctx, ['boot'], env)
  assert.equal(r.status, 0, r.stdout + r.stderr)
  return ctx
}

// ── 1. the green path merges  [M1 / leg (a)] ─────────────────────────────────

test('the green path reads the head\'s check runs and squash-merges the PR  [M1 / leg (a)]', () => {
  const ctx = green()
  const curls = argvLines(ctx, 'curl')

  const gets = curls.filter((a) => a.includes(CHECKS_URL))
  assert.ok(gets.length >= 1, `no GET of ${CHECKS_URL}; curls:\n${curls.map((a) => a.join(' ')).join('\n')}`)
  for (const a of gets) assert.ok(!a.includes('-X'), `the check-runs read is a GET: ${a.join(' ')}`)

  const puts = curls.filter((a) => a.includes(MERGE_URL))
  assert.equal(puts.length, 1, 'exactly one merge call')
  const put = puts[0]
  assert.equal(put[put.indexOf('-X') + 1], 'PUT', `the merge is a PUT: ${put.join(' ')}`)
  assert.deepEqual(mergeArgv(ctx), put, 'and it is the one argv whose URL ends /merge')

  assert.deepEqual(mergePuts(ctx), [
    { merge_method: 'squash', commit_title: PLAN_H1, sha: HEAD_SHA },
  ], 'a squash, titled from the plan\'s H1, pinned to the head whose checks were read')

  const status = statusOf(ctx)
  assert.equal(status.state, 'done')
  assert.equal(status.pr, PR_URL)
  assert.equal(status.merged, MERGE_SHA)
  assert.ok(stream(ctx).some((l) => l.startsWith('merge: merged')),
    'one log line says the merge happened: ' + stream(ctx).filter((l) => l.startsWith('merge:')).join(' | '))
})

// ── 2. the three green conclusions  [M1 / leg (b)] ───────────────────────────

const GREEN_CONCLUSIONS = ['success', 'neutral', 'skipped']

test('three completed runs concluding success, neutral and skipped merge  [M1 / leg (b)]', () => {
  const ctx = ran({
    STUB_CHECKS: checksBody(GREEN_CONCLUSIONS.map((c, i) => completed(`check-${i}`, c))),
  })
  assert.equal(mergePuts(ctx).length, 1)
  assert.equal(statusOf(ctx).merged, MERGE_SHA)
})

for (const conclusion of GREEN_CONCLUSIONS) {
  test(`a single run concluding ${conclusion} merges  [M1 / leg (b)]`, () => {
    const ctx = ran({ STUB_CHECKS: checksBody([completed('test', conclusion)]) })
    assert.equal(mergePuts(ctx).length, 1, `a ${conclusion} run is green`)
    assert.equal(statusOf(ctx).merged, MERGE_SHA)
  })
}

// ── 2b. the integration's pretty-printed answer  [M1 / leg (b)] ───────────────
// github.int.exe.xyz answers the check-runs document pretty-printed (one field
// per line, measured 2026-09-05 on runs 19 and 22); api.github.com answers it
// compact. The reader has to see the same run in both spellings — the
// pretty-printed one left every wave-1 PR of 2026-09-05 open as
// "check <unnamed> concluded <none>".

const prettyChecksBody = (runs) =>
  JSON.stringify({
    total_count: runs.length,
    check_runs: runs.map(([name, status, conclusion]) => ({
      name, status, conclusion, output: { title: null, summary: null }, check_suite: { id: 1 },
    })),
  }, null, 2)

test('a pretty-printed check-runs answer with one successful run merges  [M1 / leg (b)]', () => {
  const ctx = ran({ STUB_CHECKS: prettyChecksBody([completed('test', 'success')]) })
  assert.equal(mergePuts(ctx).length, 1, 'the pretty-printed run is read as green: '
    + stream(ctx).filter((l) => l.startsWith('merge:')).join(' | '))
  assert.equal(statusOf(ctx).merged, MERGE_SHA)
})

test('a pretty-printed answer with one failed run leaves the PR open, naming the run  [M1 / leg (b)]', () => {
  const ctx = ran({ STUB_CHECKS: prettyChecksBody([completed('test', 'failure')]) })
  assert.equal(mergePuts(ctx).length, 0)
  assert.ok(stream(ctx).some((l) => l.includes('check test concluded failure')),
    stream(ctx).filter((l) => l.startsWith('merge:')).join(' | '))
})

// ── 3. what the poll waits for  [M2] ─────────────────────────────────────────

test('a run still going keeps the poll going, and the PUT follows the green read  [M2 / leg (c)]', () => {
  const ctx = ran({ STUB_CHECKS_PENDING: '2' })
  assert.equal(checkReads(ctx), 3, 'two pending answers, then the completed one')
  const s = stream(ctx)
  const third = s.findIndex((l) => l === 'CALL curl check-runs 3')
  const put = s.findIndex((l) => l === 'CALL curl pr merge')
  assert.ok(third >= 0 && put > third, `the PUT follows the third read:\n${s.join('\n')}`)
  assert.equal(mergePuts(ctx).length, 1)
  assert.equal(statusOf(ctx).merged, MERGE_SHA)
})

test('an answer with no check run at all is waited out, then merged  [M2 / leg (d)]', () => {
  const ctx = ran({
    STUB_CHECKS: checksBody([]),
    FLEET_MERGE_CHECKS_GRACE: '1',
    FLEET_MERGE_CHECK_WAIT: '5',
  })
  assert.equal(checkReads(ctx), 3, 'the grace is two attempts; the third is past it')
  assert.equal(mergePuts(ctx).length, 1)
  assert.equal(statusOf(ctx).merged, MERGE_SHA)
  assert.ok(stream(ctx).some((l) => l.includes('nothing to wait for')),
    'the log says why it stopped waiting: ' + stream(ctx).filter((l) => l.startsWith('merge:')).join(' | '))
})

// A conclusion outside the three green names stops the poll — including the two
// GitHub spells that are neither `failure` nor green, which a denylist of
// `failure` would merge.
for (const conclusion of ['failure', 'cancelled', 'timed_out']) {
  test(`a run concluding ${conclusion} leaves the PR open  [M1] [M2 / leg (e)]`, () => {
    const ctx = ran({ STUB_CHECKS: checksBody([completed('test', conclusion)]) })
    assert.equal(mergePuts(ctx).length, 0, 'no PUT')
    assert.equal(checkReads(ctx), 1, 'the poll stops at the first red answer')
    const status = statusOf(ctx)
    assert.equal(status.state, 'done')
    assert.equal(status.merged, null)
    assert.equal(status.pr, PR_URL)
    assert.ok(stream(ctx).some((l) => l.includes(`concluded ${conclusion} — leaving`)),
      'the log names the check and its conclusion: ' +
        stream(ctx).filter((l) => l.startsWith('merge:')).join(' | '))
  })
}

test('checks still pending at the wait leave the PR open  [M2 / leg (f)]', () => {
  const ctx = ran({ STUB_CHECKS_PENDING: '50', FLEET_MERGE_CHECK_WAIT: '3' })
  assert.equal(checkReads(ctx), 4, 'three seconds at a zero step is four attempts')
  assert.equal(mergePuts(ctx).length, 0)
  const status = statusOf(ctx)
  assert.equal(status.state, 'done')
  assert.equal(status.merged, null)
  assert.equal(status.pr, PR_URL)
  assert.ok(stream(ctx).some((l) => l.includes('still pending after 3s')),
    'the log says how long it waited: ' + stream(ctx).filter((l) => l.startsWith('merge:')).join(' | '))
})

test('a merge GitHub refuses is not retried  [M2 / leg (g)]', () => {
  const ctx = ran({ STUB_MERGE_CODE: '405' })
  assert.equal(mergePuts(ctx).length, 1, 'one PUT, and no second one')
  const status = statusOf(ctx)
  assert.equal(status.state, 'done')
  assert.equal(status.merged, null)
  assert.equal(status.pr, PR_URL)
  assert.ok(stream(ctx).some((l) => l.includes('PUT answered 405')),
    'the log quotes the code: ' + stream(ctx).filter((l) => l.startsWith('merge:')).join(' | '))
})

test('a green run beside a red or a pending one merges nothing  [M1] [M2 / leg (m)]', () => {
  const red = ran({
    STUB_CHECKS: checksBody([completed('unit', 'success'), completed('lint', 'failure')]),
  })
  assert.equal(mergePuts(red).length, 0)
  assert.equal(checkReads(red), 1)
  assert.equal(statusOf(red).state, 'done')
  assert.equal(statusOf(red).merged, null)
  assert.equal(statusOf(red).pr, PR_URL)

  const pending = ran({
    STUB_CHECKS: checksBody([completed('unit', 'success'), ['lint', 'in_progress', null]]),
    FLEET_MERGE_CHECK_WAIT: '3',
  })
  assert.equal(checkReads(pending), 4, 'polled for the whole wait')
  assert.equal(mergePuts(pending).length, 0)
  assert.equal(statusOf(pending).state, 'done')
  assert.equal(statusOf(pending).merged, null)
  assert.equal(statusOf(pending).pr, PR_URL)
})

// ── 4. parked runs and hold=  [M3] ───────────────────────────────────────────

test('a parked run reads no check and merges nothing  [M3 / leg (h)]', () => {
  const ctx = ran({ STUB_VERDICT: 'NEEDS_ACK' })
  const status = statusOf(ctx)
  assert.equal(status.state, 'parked')
  assert.equal(status.merged, null)
  assert.equal(checkReads(ctx), 0, 'a draft PR is the operator\'s')
  assert.equal(mergePuts(ctx).length, 0)
})

test('hold=1 publishes and stops there  [M3 / leg (i)]', () => {
  const ctx = ran({ FLEET_ASSIGNMENT: `${ASSIGNMENT} hold=1` })
  const status = statusOf(ctx)
  assert.equal(status.state, 'done')
  assert.equal(status.pr, PR_URL)
  assert.equal(status.merged, null)
  assert.equal(prPosts(ctx).length, 1, 'the PR is still opened')
  assert.equal(checkReads(ctx), 0)
  assert.equal(mergePuts(ctx).length, 0)
  assert.ok(stream(ctx).some((l) => l.includes('merge: hold=1 — leaving')),
    'the log says the hold is why: ' + stream(ctx).filter((l) => l.startsWith('merge:')).join(' | '))
})

for (const value of ['yes', '0']) {
  test(`hold=${value} fails the assignment before any clone  [M3] [M4 / leg (j)]`, () => {
    const ctx = makeHome()
    const r = boot(ctx, ['boot'], { FLEET_ASSIGNMENT: `${ASSIGNMENT} hold=${value}` })
    assert.notEqual(r.status, 0)
    const status = statusOf(ctx)
    assert.equal(status.state, 'failed')
    assert.match(status.error, /assignment/)
    assert.equal(readLog(ctx, 'git.log'), '', 'nothing was cloned')
    assert.equal(engineRuns(ctx), 0, 'and no engine was run')
    assert.ok('merged' in status, 'the failed page carries the cell too')
    assert.equal(status.merged, null)
  })
}

// ── 5. the cell on every page  [M4 / leg (k)] ────────────────────────────────

test('every page carries merged, null until the merge  [M4 / leg (k)]', () => {
  const ctx = green()
  const snapshots = committed(ctx)
  assert.deepEqual(commitStates(ctx), ['running', 'publishing', 'done'],
    'the merge adds no evidence commit of its own')
  assert.equal(snapshots.length, 3)
  for (const snapshot of snapshots) assert.ok('merged' in snapshot, 'the cell is on every snapshot')
  assert.equal(snapshots[0].merged, null, 'null on running')
  assert.equal(snapshots[1].merged, null, 'null on publishing')
  assert.equal(snapshots[2].merged, MERGE_SHA, 'the squash commit on done')

  assert.deepEqual(notifies(ctx), [
    { title: 'run-7 done', message: `${TARGET} — ${PR_URL}` },
  ], 'and the run still notifies once')
  assert.deepEqual(states(ctx), ['booting', 'running', 'publishing', 'done'])

  const parked = ran({ STUB_VERDICT: 'NEEDS_ACK' })
  assert.ok('merged' in statusOf(parked))
  assert.equal(statusOf(parked).merged, null)

  const held = ran({ FLEET_ASSIGNMENT: `${ASSIGNMENT} hold=1` })
  assert.ok('merged' in statusOf(held))
  assert.equal(statusOf(held).merged, null)
})

// ── 6. the script parses  [leg (l)] ──────────────────────────────────────────

test('bash -n accepts the script  [leg (l)]', () => {
  const r = spawnSync('bash', ['-n', SCRIPT], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
})

// ── 7. the operator documents  [M5] [M6] [M7] ────────────────────────────────

const read = (file) => fs.readFileSync(file, 'utf8')
/** A document's lines from the first matching one up to the next stop, joined. */
const section = (file, from, to) => {
  const all = read(file).split('\n')
  const start = all.findIndex((l) => from.test(l))
  assert.ok(start >= 0, `${file} has no line matching ${from}`)
  const rest = all.slice(start + 1)
  const end = rest.findIndex((l) => to.test(l))
  return [all[start], ...(end < 0 ? rest : rest.slice(0, end))].join(' ')
}

test('CONTRACT.md carries the cell, the two calls and the hold key  [M5]', () => {
  const contract = read(CONTRACT)
  assert.ok(contract.includes('"prAuthor":"<GitHub login or null>","merged":"<40-hex or null>"'),
    'the status.json literal gains merged right after prAuthor')

  const bootScript = section(CONTRACT, /^- \*\*Boot script/, /^- \*\*status\.json/)
  assert.match(bootScript, /commits\/<head>\/check-runs[\s\S]*pulls\/<n>\/merge[\s\S]*hold=1/,
    'the Boot-script bullet names the read, the PUT and the hold key, in order')

  const publish = section(CONTRACT, /^- \*\*Publish:\*\*/, /^- \*\*Integration naming/)
  assert.match(publish, /sandbox merges itself once its checks are green, unless the assignment carries[\s\S]*hold=1/,
    'and the Publish bullet says the sandbox merges its own ready PR')
})

test('RUNBOOK.md says the PR merges itself, and puts no human at the button  [M6]', () => {
  const pr = section(RUNBOOK, /^\*\*The PR\.\*\*/, /^\*\*Reap\.\*\*/)
  assert.match(pr, /A ready PR merges itself[\s\S]*once every check is green, unless the launch said[\s\S]*--hold/)

  const done = read(RUNBOOK).split('\n').filter((l) => /^\| `done` \|/.test(l))
  assert.equal(done.length, 1, 'one done row in the States table')
  assert.match(done[0], /merged is the squash commit/)

  const trust = section(RUNBOOK, /^## Trust/, /^## Rollback/)
  assert.match(trust, /merge waits on the target.s own checks, and[\s\S]*--hold[\s\S]*to keep a human at the merge button/)
  assert.ok(!trust.includes('a pull request rather than a merge'), 'the old sentence is gone')
})

test('SKILL.md step 4 says a ready PR merges itself  [M7]', () => {
  const step = section(SKILL, /^4\. \*\*The PR is the gate/, /^5\. \*\*Reap/)
  assert.match(step, /A ready PR merges itself once its checks are green[\s\S]*--hold[\s\S]*on the launch line keeps it open/)
})

runTests(tests)
