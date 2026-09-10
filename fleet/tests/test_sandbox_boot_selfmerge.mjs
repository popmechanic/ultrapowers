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
  SCRIPT, TARGET, HEAD_SHA, PR_URL, PLAN_H1, MERGE_SHA, ASSIGNMENT, RUN_PATH,
  makeHome, boot, green,
  stream, statusOf, states, committed, commitStates, notifies, engineRuns,
  readLog, argvLines, prPosts, mergePuts, mergeArgv, checkReads, directCalls,
  targetDir, evidenceDir,
  runTests, ENV,
} from './_sandbox_boot_helpers.mjs'

// The clock before any boot of this process: leg (h) bounds every appended
// `ts` between a `Date.now()` taken before its boot and one taken after it,
// and the rig's `green()` is memoized, so its "before" is this.
const SUITE_STARTED = Date.now()

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

  // run-32 (#715) added the fourth field: the squashed commit on the base
  // names the run and the plan tag, which is where a reader of `git log` on
  // the base starts. The other three are this case's original claim.
  assert.deepEqual(mergePuts(ctx), [
    {
      merge_method: 'squash',
      commit_title: PLAN_H1,
      commit_message: 'Fleet-Run: 7\nPlan-Tag: ultra/plan/run-7',
      sha: HEAD_SHA,
    },
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
  const r = spawnSync('bash', ['-n', SCRIPT], { encoding: 'utf8', env: ENV })
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

// ═══ #703 Task 1 — the boot writes its publish decisions as events ═══════════
//
// The claim: the boot writes the publish decisions into the run's event log —
// `publish:pr` (url, number, draft), `publish:hold` (why) and `publish:merge`
// (sha, or the reason the PR was left open) — so a held run, a merged run and a
// merge that failed are three different records. The page and the log lines the
// legs above pin stay exactly as they are; these events are added BESIDE them.
//
//   M1  a POST'd PR appends exactly one `publish:pr`; a parked run's record is
//       that line alone with `draft` true; a run with nothing ahead of base
//       appends no `publish:` line at all.                        legs (a)
//   M2  `hold=1` and each of the three fold holds append exactly one
//       `publish:hold`, whose `why` is the phase's text after `left open: `,
//       and no `publish:merge`; a green run holds none.            leg  (b)
//   M3  one `publish:merge` per merge decision — the squash sha, `checks red`,
//       `checks pending`, `refused` — and the retry's two, in order, the last
//       being what became of the PR.                              legs (c)–(g)
//   M4  the stamp: a ULID-shaped `id` whose first ten characters are `ts`,
//       ascending in file order, sorting after every engine line, the engine's
//       own line untouched, and no direct `node`/`gh` call.        leg  (h)
//   M5  the evidence copy is byte-identical to the run dir's file. leg  (i)
//   M6  ultralearn's own reader renders the three records.         leg  (j)
//   M7  the `- **Publish:**` bullet names the three kinds and their fields;
//       the rest of that document, the reader and the engine's writer are the
//       `Run:` commands' business — they are the ones the driver hands the
//       base commit to. This file reads no environment variable naming a
//       commit and embeds no sha: a frozen base literal would go red on the
//       first unrelated commit to the contract or the engine.      leg  (k)

const HOME_TARGET_RUN = ['.claude', 'ultrapowers', 'run-run-7']
/** The run directory the engine and the boot both write, `run_dir_path()`. */
const runDirOf = (ctx) => path.join(targetDir(ctx), ...HOME_TARGET_RUN)
const runEventsPath = (ctx) => path.join(runDirOf(ctx), 'events.jsonl')
/** The copy `collect_evidence` commits with the terminal page. */
const evidenceEventsPath = (ctx) => path.join(evidenceDir(ctx), RUN_PATH, 'events.jsonl')

const eventLines = (file) =>
  (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter((l) => l !== '') : [])
/** One event log, parsed; a line that is not one JSON object is the failure. */
const eventsAt = (file) =>
  eventLines(file).map((line, i) => {
    try {
      const record = JSON.parse(line)
      assert.ok(record && typeof record === 'object' && !Array.isArray(record),
        `${file} line ${i + 1} is not a JSON object: ${line}`)
      return record
    } catch (error) {
      throw new Error(`${file} line ${i + 1} is not one JSON object: ${line}\n${error}`)
    }
  })
const events = (ctx) => eventsAt(runEventsPath(ctx))
const evidenceEvents = (ctx) => eventsAt(evidenceEventsPath(ctx))
const isPublish = (e) => typeof e.kind === 'string' && e.kind.startsWith('publish:')
const publishOf = (list) => list.filter(isPublish)
const publishIn = (ctx) => publishOf(events(ctx))
const ofKind = (ctx, kind) => events(ctx).filter((e) => e.kind === kind)
/** A record without the stamp, so a leg can assert its whole content at once. */
const unstamped = (e) => {
  const rest = { ...e }
  delete rest.id
  delete rest.ts
  return rest
}

// The engine's line as the rig leaves it: `makeEventLog`'s shape, so the boot's
// ids sort after it and ultralearn's reader orders the file the way production
// orders it. `b32(1, 10)` is nine zeros and a one; the stub's own sixteen
// characters are zeros.
const ENGINE_EVENT = {
  kind: 'engine:phase', phase: 'gate', id: `${'0'.repeat(9)}1${'0'.repeat(16)}`, ts: 1,
}
/** Crockford base 32, `B32` in `fleet/run-waves.mjs`. */
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const ID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/
/** An id's leading `b32(ts, 10)`, read back most-significant-first. */
const tsOfId = (id) => {
  let n = 0
  for (const c of id.slice(0, 10)) n = n * 32 + B32.indexOf(c)
  return n
}

const FLEET_EVENTS_PY = path.join(HERE, '..', '..', 'skills', 'ultralearn', 'scripts', 'fleet_events.py')

// The eleven boots these legs read, one each, memoized: every assertion below
// asks its questions of a run that was booted once. `green` is the rig's own
// memoized green boot and costs nothing.
const CASE_ENV = {
  parked: { STUB_VERDICT: 'NEEDS_ACK' },
  noCommits: { STUB_NO_COMMITS: '1' },
  hold: { FLEET_ASSIGNMENT: `${ASSIGNMENT} hold=1` },
  suiteRed: { STUB_FOLD_DISPOSITION: 'suite red' },
  conflict: { STUB_FOLD_DISPOSITION: 'conflict parked', STUB_FOLD_PATH: 'a.txt' },
  cannotFold: { STUB_FOLD_DISPOSITION: 'cannot fold', STUB_FOLD_REASON: 'base not an ancestor' },
  checksRed: { STUB_CHECKS: checksBody([completed('test', 'failure')]) },
  pending: { STUB_CHECKS_PENDING: '50', FLEET_MERGE_CHECK_WAIT: '3' },
  refused: { STUB_MERGE_CODE: '405' },
  retry: { STUB_MERGE_CODE: '405', STUB_MERGE_MESSAGE: 'Pull Request is not mergeable' },
}
const BOXES = new Map()
/** One case's boot, with the clock read either side of it — leg (h)'s bounds. */
function box(key) {
  if (key === 'green') return { ctx: green(), before: SUITE_STARTED, after: Date.now() }
  if (!BOXES.has(key)) {
    const before = Date.now()
    const ctx = ran(CASE_ENV[key])
    BOXES.set(key, { ctx, before, after: Date.now() })
  }
  return BOXES.get(key)
}
const ctxOf = (key) => box(key).ctx

/** The one `publish:pr` a run that opened a PR appends. */
const PR_EVENT = { kind: 'publish:pr', url: PR_URL, number: 1, draft: false }
const DRAFT_PR_EVENT = { ...PR_EVENT, draft: true }
/** What each case's LAST `publish:` line has to be — its outcome, one record. */
const OUTCOME = {
  green: { kind: 'publish:merge', sha: MERGE_SHA },
  parked: DRAFT_PR_EVENT,
  hold: { kind: 'publish:hold', why: 'hold=1' },
  suiteRed: { kind: 'publish:hold', why: 'publish fold — suite red' },
  conflict: { kind: 'publish:hold', why: 'publish fold — conflict parked on a.txt' },
  cannotFold: { kind: 'publish:hold', why: 'publish fold — cannot fold: base not an ancestor' },
  checksRed: {
    kind: 'publish:merge', sha: null, left: 'checks red',
    detail: 'check test concluded failure',
  },
  pending: {
    kind: 'publish:merge', sha: null, left: 'checks pending',
    detail: 'still pending after 3s',
  },
  refused: {
    kind: 'publish:merge', sha: null, left: 'refused', detail: 'merge PUT answered 405',
  },
  retry: { kind: 'publish:merge', sha: MERGE_SHA },
}
/** Every case that opens a PR — `noCommits` opens none, which is its own leg. */
const PUBLISHING_CASES = Object.keys(OUTCOME)

/** A held run's `why` is the phase's own text after `left open: `. */
const phaseHold = (ctx) => {
  const phase = String(statusOf(ctx).phase || '')
  const at = phase.indexOf('left open: ')
  assert.ok(at >= 0, `the page's phase says nothing was left open: ${phase}`)
  return phase.slice(at + 'left open: '.length)
}

// ── #703 (a) the PR record  [M1] ─────────────────────────────────────────────

test('the POST\'d PR appends exactly one publish:pr, url number draft  [#703 M1 / leg (a)]', () => {
  const ctx = ctxOf('green')
  const prs = ofKind(ctx, 'publish:pr')
  assert.equal(prs.length, 1, 'one line, after the POST\'s 2xx answer: '
    + JSON.stringify(publishIn(ctx)))
  assert.deepEqual(unstamped(prs[0]), PR_EVENT,
    'the answer\'s html_url, its integer number, and the boolean the POST carried')
  assert.equal(prPosts(ctx).length, 1, 'and one POST behind it')
})

test('a parked run\'s record is one draft publish:pr and nothing else  [#703 M1 / leg (a)]', () => {
  const ctx = ctxOf('parked')
  assert.equal(statusOf(ctx).state, 'parked')
  assert.deepEqual(publishIn(ctx).map(unstamped), [DRAFT_PR_EVENT],
    'one publish:pr with draft true, no publish:hold, no publish:merge')
})

test('a run with nothing ahead of base appends no publish: line  [#703 M1 / leg (a)]', () => {
  const ctx = ctxOf('noCommits')
  assert.deepEqual(prPosts(ctx), [], 'no PR was opened')
  assert.deepEqual(publishIn(ctx), [], 'so nothing named its publication: '
    + JSON.stringify(publishIn(ctx)))
  assert.ok(events(ctx).length >= 1, 'the engine\'s own line is still there')
})

// ── #703 (b) the holds  [M2] ─────────────────────────────────────────────────

test('hold=1 appends publish:pr then publish:hold why=hold=1, and no merge  [#703 M2 / leg (b)]', () => {
  const ctx = ctxOf('hold')
  assert.deepEqual(publishIn(ctx).map((e) => e.kind), ['publish:pr', 'publish:hold'],
    'in file order')
  const [, held] = publishIn(ctx)
  assert.deepEqual(unstamped(held), { kind: 'publish:hold', why: 'hold=1' })
  assert.equal(held.why, phaseHold(ctx), 'the same string the phase carries')
  assert.deepEqual(mergePuts(ctx), [], 'no PUT')
  assert.deepEqual(ofKind(ctx, 'publish:merge'), [], 'and no publish:merge')
})

for (const [key, why] of [
  ['suiteRed', 'publish fold — suite red'],
  ['conflict', 'publish fold — conflict parked on a.txt'],
  ['cannotFold', 'publish fold — cannot fold: base not an ancestor'],
]) {
  test(`a publish fold ending "${why}" appends that hold  [#703 M2 / leg (b)]`, () => {
    const ctx = ctxOf(key)
    assert.deepEqual(publishIn(ctx).map((e) => e.kind), ['publish:pr', 'publish:hold'],
      'a gate-green run held by its fold: the PR, then the hold')
    const [, held] = publishIn(ctx)
    assert.deepEqual(unstamped(held), { kind: 'publish:hold', why },
      'the phrase `fold_phrase` renders for that attempt')
    assert.equal(held.why, phaseHold(ctx),
      'and it is the done page\'s phase text after `left open: `')
    assert.deepEqual(mergePuts(ctx), [], 'no PUT')
    assert.deepEqual(ofKind(ctx, 'publish:merge'), [], 'and no publish:merge')
  })
}

test('a green run appends no publish:hold at all  [#703 M2 / leg (b)]', () => {
  assert.deepEqual(ofKind(ctxOf('green'), 'publish:hold'), [])
})

// ── #703 (c)–(g) the merge decisions  [M3] ───────────────────────────────────

test('a merged PR appends one publish:merge carrying the squash sha  [#703 M3 / leg (c)]', () => {
  const ctx = ctxOf('green')
  const merges = ofKind(ctx, 'publish:merge')
  assert.equal(merges.length, 1)
  assert.deepEqual(unstamped(merges[0]), { kind: 'publish:merge', sha: MERGE_SHA },
    'the answer\'s sha, and no `left` and no `detail`')
  assert.ok(!('left' in merges[0]) && !('detail' in merges[0]), 'a merge that happened leaves neither')
  assert.equal(statusOf(ctx).merged, MERGE_SHA, 'the page says the same')
})

test('a red check run appends publish:merge left=checks red, and no PUT  [#703 M3 / leg (d)]', () => {
  const ctx = ctxOf('checksRed')
  assert.deepEqual(ofKind(ctx, 'publish:merge').map(unstamped), [{
    kind: 'publish:merge', sha: null, left: 'checks red',
    detail: 'check test concluded failure',
  }])
  assert.deepEqual(mergePuts(ctx), [], 'no PUT was made')
})

test('checks pending at the wait append publish:merge left=checks pending  [#703 M3 / leg (e)]', () => {
  const ctx = ctxOf('pending')
  assert.deepEqual(ofKind(ctx, 'publish:merge').map(unstamped), [{
    kind: 'publish:merge', sha: null, left: 'checks pending',
    detail: 'still pending after 3s',
  }])
  assert.deepEqual(mergePuts(ctx), [], 'no PUT was made')
})

test('a refused PUT appends publish:merge left=refused with the code  [#703 M3 / leg (f)]', () => {
  const ctx = ctxOf('refused')
  assert.deepEqual(ofKind(ctx, 'publish:merge').map(unstamped), [{
    kind: 'publish:merge', sha: null, left: 'refused', detail: 'merge PUT answered 405',
  }])
  assert.equal(mergePuts(ctx).length, 1, 'the one PUT that was refused')
})

test('the one retry leaves two publish:merge lines, refusal then outcome  [#703 M3 / leg (g)]', () => {
  const ctx = ctxOf('retry')
  const merges = ofKind(ctx, 'publish:merge')
  assert.equal(merges.length, 2, 'one per merge decision, in order: '
    + JSON.stringify(merges.map(unstamped)))
  assert.deepEqual(unstamped(merges[0]), {
    kind: 'publish:merge', sha: null, left: 'refused', detail: 'merge PUT answered 405',
  }, 'the 405 the second fold answered')
  assert.deepEqual(unstamped(merges[1]), { kind: 'publish:merge', sha: MERGE_SHA },
    'and the second PUT\'s outcome, with no `left`')
  assert.equal(mergePuts(ctx).length, 2)
  assert.equal(statusOf(ctx).merged, MERGE_SHA)
})

test('every publishing run holds one publish:pr, and its last publish: line is its outcome  [#703 M3 / leg (g)]', () => {
  for (const key of PUBLISHING_CASES) {
    const ctx = ctxOf(key)
    const prs = ofKind(ctx, 'publish:pr')
    assert.equal(prs.length, 1, `${key}: exactly one publish:pr`)
    assert.deepEqual(unstamped(prs[0]), key === 'parked' ? DRAFT_PR_EVENT : PR_EVENT,
      `${key}: the PR record`)
    const lines = publishIn(ctx)
    assert.deepEqual(unstamped(lines[lines.length - 1]), OUTCOME[key],
      `${key}: the last publish: line is what became of the PR`)
  }
})

// ── #703 (h) the stamp and the order  [M4] ───────────────────────────────────

test('every appended line carries a ULID-shaped id encoding its own ts  [#703 M4 / leg (h)]', () => {
  for (const key of [...PUBLISHING_CASES, 'noCommits']) {
    const { ctx, before, after } = box(key)
    const all = events(ctx)
    const mine = publishOf(all)
    for (const e of mine) {
      assert.equal(typeof e.id, 'string', `${key}: ${e.kind} has no string id`)
      assert.match(e.id, ID_RE, `${key}: ${e.kind}'s id is not 26 Crockford base-32 characters`)
      assert.ok(Number.isInteger(e.ts), `${key}: ${e.kind}'s ts is not an integer: ${e.ts}`)
      assert.equal(tsOfId(e.id), e.ts,
        `${key}: ${e.kind}'s first ten id characters are not b32(ts, 10)`)
      assert.ok(e.ts >= before && e.ts <= after,
        `${key}: ${e.kind}'s ts ${e.ts} is outside the boot [${before}, ${after}]`)
    }
    for (let i = 1; i < mine.length; i += 1) {
      assert.ok(mine[i].id > mine[i - 1].id,
        `${key}: the ids do not ascend in file order: ${mine[i - 1].id} then ${mine[i].id}`)
    }
    // Sorted the way `fleet_events.read_events` sorts — by `id`, as strings —
    // every boot line lands after every line the engine wrote.
    const sorted = [...all].sort((a, b) => (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0))
    const lastEngine = sorted.reduce((acc, e, i) => (isPublish(e) ? acc : i), -1)
    const firstPublish = sorted.findIndex(isPublish)
    if (firstPublish >= 0) {
      assert.ok(firstPublish > lastEngine,
        `${key}: sorted by id, a publish: line precedes an engine line`)
    }
    // The engine's own line is left exactly as it was written: the boot only
    // appends. (The rig's engine writes one line; this is that line.)
    assert.deepEqual(all[0], ENGINE_EVENT, `${key}: the first line is not the engine's`)
    assert.ok(!eventLines(runEventsPath(ctx)).some((l) => l.includes('"id":"x"')),
      `${key}: a line still carries the stub's un-ULID id`)
    assert.deepEqual(directCalls(ctx), [],
      `${key}: the boot minted its ids with a direct node or gh call`)
  }
})

// ── #703 (i) the evidence copy  [M5] ─────────────────────────────────────────

test('the committed events.jsonl is byte-identical to the run dir\'s  [#703 M5 / leg (i)]', () => {
  for (const key of ['green', 'hold', 'refused']) {
    const ctx = ctxOf(key)
    const mine = fs.readFileSync(runEventsPath(ctx))
    const committedCopy = fs.readFileSync(evidenceEventsPath(ctx))
    assert.deepEqual(committedCopy, mine, `${key}: the evidence copy differs from the run dir's file`)
    assert.deepEqual(publishOf(evidenceEvents(ctx)).map(unstamped),
      publishIn(ctx).map(unstamped), `${key}: publish lines included`)
    assert.ok(publishOf(evidenceEvents(ctx)).length > 0, `${key}: and there are some`)
  }
})

// ── #703 (j) ultralearn's reader  [M6] ───────────────────────────────────────

/** `fleet_events.py` over a run directory, as its non-empty stdout lines. */
const timeline = (ctx) => {
  const r = spawnSync('python3', [FLEET_EVENTS_PY, runDirOf(ctx)], { encoding: 'utf8', env: ENV })
  assert.equal(r.status, 0, `fleet_events.py exited ${r.status}: ${r.stderr}`)
  return r.stdout.split('\n').filter((l) => l.trim() !== '')
}

test('fleet_events.py renders the merge, the hold and the refusal  [#703 M6 / leg (j)]', () => {
  const merged = timeline(ctxOf('green'))
  const last = merged[merged.length - 1]
  assert.ok(last.includes('publish:merge') && last.includes(MERGE_SHA),
    `the last line names the merge and the squash sha: ${last}`)
  const before = merged[merged.length - 2]
  assert.ok(before.includes('publish:pr') && before.includes(PR_URL),
    `and the line before it carries the PR URL: ${before}`)

  const held = timeline(ctxOf('hold'))
  const heldLast = held[held.length - 1]
  assert.ok(heldLast.includes('publish:hold') && heldLast.includes('hold=1'),
    `a held run ends on its hold: ${heldLast}`)

  const refused = timeline(ctxOf('refused'))
  const refusedLast = refused[refused.length - 1]
  assert.ok(refusedLast.includes('publish:merge') && refusedLast.includes('refused')
    && refusedLast.includes('405'), `a refused merge names the code: ${refusedLast}`)
})

// ── #703 (k) the contract's Publish bullet  [M7] ─────────────────────────────
//
// The `- **Publish:**` bullet ALONE, the same range the first `Run:` cuts. What
// the rest of that document, ultralearn's reader and the engine's event writer
// still are is the `Run:` commands' business — the driver hands those the base
// commit, and this file compares nothing to a commit.

test('the Publish bullet names the three kinds and their fields  [#703 M7 / leg (k)]', () => {
  const publish = section(CONTRACT, /^- \*\*Publish:\*\*/, /^- \*\*Integration naming/)
  for (const word of [
    'publish:pr', 'publish:hold', 'publish:merge',
    'url', 'number', 'draft', 'why', 'left', 'detail',
    'checks red', 'checks pending', 'refused',
  ]) {
    assert.ok(publish.includes(word),
      `the Publish bullet does not name \`${word}\`: ${publish}`)
  }
})

runTests(tests)
