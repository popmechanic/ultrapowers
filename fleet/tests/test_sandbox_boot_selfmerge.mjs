/**
 * Exam for the sandbox finishing its own pull request.
 *
 * At BASE the run asked GitHub to run the target's suite again and waited half
 * an hour for the answer. It already held that answer: the publish fold rebased
 * the head onto the base's tip and the run's own gate greened the target's
 * suite on the tree that produced. So the merge is decided here, on this box,
 * from two facts the run itself measured — its gate is green, and the default
 * branch's tip is still the one the fold joined onto. It asks for no check run
 * at all.
 *
 * The clauses this file pins:
 *
 *   M1  the tip read before the PUT: equal merges once, moved PUTs nothing,
 *       records `base moved` and folds again.
 *   M2  the retired names are gone from the script, and a green merge makes
 *       zero requests naming a head's check runs.
 *   M3  a gate receipt carrying an unattributed red publishes a READY PR, holds
 *       the merge, and says on the card what went red and how to finish it.
 *   M4  `hold=1`, a parked run, and a 405 whose body names a moved base.
 *   M5–M7  the operator documents say so.
 *
 * The rig is `_sandbox_boot_helpers.mjs`, shared with the other sandbox-boot
 * sims: `makeHome`, `boot`, the log readers, and the `STUB_TIP` knob that moves
 * the base under a run. A boot is ~40 forks of stub shell, so the green run is
 * the rig's memoized one and every other case boots once.
 */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  SCRIPT, TARGET, HEAD_SHA, OTHER_SHA, PR_URL, PLAN_H1, MERGE_SHA, ASSIGNMENT,
  RUN_PATH,
  makeHome, boot, green,
  stream, statusOf, states, committed, commitStates, notifies, engineRuns,
  readLog, argvLines, prPosts, mergePuts, mergeArgv, checkRunRequests, directCalls,
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
const MERGE_URL = `${EDGE}/repos/${TARGET}/pulls/1/merge`

/** One boot per case, run and asserted to have exited 0. */
function ran(env) {
  const ctx = makeHome()
  const r = boot(ctx, ['boot'], env)
  assert.equal(r.status, 0, r.stdout + r.stderr)
  return ctx
}

/** The `merge:` lines of a run's log, for an assertion's failure message. */
const merges = (ctx) => stream(ctx).filter((l) => l.startsWith('merge:')).join(' | ')

// ── 1. the green path merges, and asks nobody  [M1] [M2 / leg (a)] ───────────

test('a gate-green run whose tip did not move squash-merges the PR  [M1 / leg (a)]', () => {
  const ctx = green()
  const curls = argvLines(ctx, 'curl')

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
  ], 'a squash, titled from the plan\'s H1, pinned to the head the gate greened')

  const status = statusOf(ctx)
  assert.equal(status.state, 'done')
  assert.equal(status.pr, PR_URL)
  assert.equal(status.merged, MERGE_SHA)
  assert.ok(stream(ctx).some((l) => l.startsWith('merge: merged')),
    'one log line says the merge happened: ' + merges(ctx))
})

test('the merge asks GitHub for no check run at all  [M2 / leg (a)]', () => {
  const ctx = green()
  assert.equal(checkRunRequests(ctx), 0,
    'a request naming a head\'s check runs went out: '
      + argvLines(ctx, 'curl').map((a) => a.join(' ')).join('\n'))
  assert.ok(stream(ctx).some((l) => l.includes('still the base\'s tip')),
    'and the log says what it merged on instead: ' + merges(ctx))
})

// ── 2. the join is the whole check  [M1 / leg (b)] ───────────────────────────

test('a base that moved under the run PUTs nothing and folds again  [M1 / leg (b)]', () => {
  const ctx = ran({ STUB_TIP: OTHER_SHA })
  assert.deepEqual(mergePuts(ctx), [], 'no PUT was made')
  assert.equal(checkRunRequests(ctx), 0)

  const s = stream(ctx)
  assert.ok(s.some((l) => l.includes(`the base moved under ${PR_URL} — tip ${HEAD_SHA} → ${OTHER_SHA}`)),
    'the log names both tips: ' + merges(ctx))
  assert.ok(s.some((l) => l.includes(`merge: folding again onto ${OTHER_SHA}`)),
    'and says what it does about it: ' + merges(ctx))
  assert.ok(s.some((l) => l.includes('systemd-run fold fleet-fold-7-2')),
    `a second fold unit ran:\n${s.join('\n')}`)

  const status = statusOf(ctx)
  assert.equal(status.state, 'done')
  assert.equal(status.merged, null)
  assert.equal(status.pr, PR_URL)
  assert.match(String(status.phase), /left open: base moved$/)
})

test('a base that keeps moving stops on the fold that came back the same  [M1 / leg (b)]', () => {
  // STUB_TIP never changes, so the second fold rebases onto the same tip it
  // already offered — a folder that cannot reach the base. One more fold, not
  // an unbounded chase.
  const ctx = ran({ STUB_TIP: OTHER_SHA })
  const s = stream(ctx)
  assert.equal(s.filter((l) => l.startsWith('CALL systemd-run fold fleet-fold-7-')).length, 2,
    `two fold units, no third:\n${s.filter((l) => l.includes('fleet-fold')).join('\n')}`)
  assert.ok(s.some((l) => l.includes(`the fold came back on ${HEAD_SHA} again`)),
    'and it says why it stopped: ' + merges(ctx))
})

// ── 3. the retired names  [M2 / leg (c)] ─────────────────────────────────────
//
// Assembled rather than written, so this file's own assertion is not the hit
// its `grep` finds — the same trick `RETIRED_NAMES` plays in the rig.

const RETIRED_MERGE_NAMES = [
  'check' + '-runs',
  'check' + '_runs_verdict',
  'MERGE' + '_CHECKS_GRACE',
  'checks' + ' red',
  'checks' + ' pending',
]

test('the boot script carries none of the check-run names  [M2 / leg (c)]', () => {
  const source = fs.readFileSync(SCRIPT, 'utf8')
  for (const name of RETIRED_MERGE_NAMES) {
    const hits = source.split('\n').filter((l) => l.includes(name))
    assert.equal(hits.length, 0,
      `sandbox-boot.sh still names \`${name}\`:\n${hits.join('\n')}`)
  }
  assert.ok(source.includes('MERGE' + '_CHECK_WAIT'),
    'the survivor is the mergeability wait, which is not a check run')
})

// ── 4. the run's own hold  [M3 / leg (d)] ────────────────────────────────────
//
// The gate greened the work the plan named and the target's suite still went
// red on a path no task owns. The verdict is PASS, so the PR is READY; what is
// withheld is the claim that this box may finish it.

const HELD_PATH = 'tests/other.py'
const HELD_HEADER = '________________________ test_other_thing ________________________'
const HELD_OUTPUT = [
  '============================= test session starts ==============================',
  'collected 3 items',
  '',
  `${HELD_PATH} ..F                                                        [100%]`,
  '',
  '=================================== FAILURES ===================================',
  HELD_HEADER,
  '    def test_other_thing():',
  '>       assert 1 == 2',
  'E       assert 1 == 2',
  '',
  `${HELD_PATH}:4: AssertionError`,
  '=========================== short test summary info ============================',
  `FAILED ${HELD_PATH}::test_other_thing - assert 1 == 2`,
].join('\n')

const HELD_ENV = {
  STUB_GATE_RECEIPT: JSON.stringify({
    verdict: 'PASS', suite: { unattributed: [HELD_PATH] },
  }),
  STUB_REPORT: JSON.stringify({
    stamp: 'run-7',
    tests: { command: 'python3 -m pytest', passed: false, output: HELD_OUTPUT },
  }),
}

/** The PR body as it stands after the run's last patch. */
const prBody = (ctx) =>
  fs.readFileSync(path.join(evidenceDir(ctx), RUN_PATH, 'pr-body.md'), 'utf8')

test('an unattributed red publishes a ready PR, holds the merge and says why  [M3 / leg (d)]', () => {
  const ctx = ran(HELD_ENV)

  assert.deepEqual(prPosts(ctx).map((p) => p.draft), [false], 'the PR is READY, not a draft')
  assert.deepEqual(mergePuts(ctx), [], 'and no PUT was made')
  assert.equal(checkRunRequests(ctx), 0)

  const status = statusOf(ctx)
  assert.equal(status.state, 'done')
  assert.equal(status.merged, null, 'no squash commit on the page')
  assert.equal(status.pr, PR_URL)
  assert.match(String(status.phase),
    new RegExp(`left open: suite red, unattributed: ${HELD_PATH}$`))
  assert.ok(stream(ctx).some((l) => l.includes(`went red on ${HELD_PATH} with no task to charge it to`)),
    'the log names the path: ' + merges(ctx))
})

test('the held PR\'s card carries the block, the command and the fix  [M3 / leg (d)]', () => {
  const body = prBody(heldRun())
  assert.ok(body.includes(`- merge: left open: suite red, unattributed: ${HELD_PATH}`),
    `the fold section records the hold:\n${body}`)

  const lines = body.split('\n')
  const held = lines.findIndex((l) => l === '## Held')
  assert.ok(held >= 0, `the card has no \`## Held\` section:\n${body}`)
  const after = lines.slice(held + 1)

  const block = after.findIndex((l) => l === HELD_HEADER)
  assert.ok(block >= 0, `the failing block's header is not quoted:\n${after.join('\n')}`)
  assert.ok(!after.slice(0, block).some((l) => l.startsWith('===')),
    'and the section quotes the failing block, not the whole log')

  const command = after.findIndex((l) => l.startsWith('gh pr merge '))
  assert.ok(command > block, `the merge command follows the block:\n${after.join('\n')}`)
  assert.ok(after[command].includes('--squash --match-head-commit'),
    `pinned to the head the gate greened: ${after[command]}`)
  assert.ok(after[command].includes(HEAD_SHA) && after[command].includes(' 1 '),
    `and it names this PR's number and head: ${after[command]}`)

  const fix = after.findIndex((l) => l.startsWith('Fix: '))
  assert.ok(fix > command, `the fix line comes last:\n${after.join('\n')}`)
  assert.equal(after[fix], `Fix: ${HELD_PATH} went red on the fold of run-7`)
})

test('a green run\'s card carries no Held section  [M3 / leg (d)]', () => {
  assert.ok(!prBody(green()).includes('## Held'),
    'nothing was held, so the section is not there')
})

// ── 5. hold=, parked runs, and a 405  [M4 / leg (e)] ─────────────────────────

test('a parked run reads no tip and merges nothing  [M4 / leg (e)]', () => {
  const ctx = ran({ STUB_VERDICT: 'NEEDS_ACK' })
  const status = statusOf(ctx)
  assert.equal(status.state, 'parked')
  assert.equal(status.merged, null)
  assert.equal(checkRunRequests(ctx), 0, 'a draft PR is the operator\'s')
  assert.equal(mergePuts(ctx).length, 0)
})

test('hold=1 publishes and stops there  [M4 / leg (e)]', () => {
  const ctx = ran({ FLEET_ASSIGNMENT: `${ASSIGNMENT} hold=1` })
  const status = statusOf(ctx)
  assert.equal(status.state, 'done')
  assert.equal(status.pr, PR_URL)
  assert.equal(status.merged, null)
  assert.equal(prPosts(ctx).length, 1, 'the PR is still opened')
  assert.equal(checkRunRequests(ctx), 0)
  assert.equal(mergePuts(ctx).length, 0)
  assert.ok(stream(ctx).some((l) => l.includes('merge: hold=1 — leaving')),
    'the log says the hold is why: ' + merges(ctx))
})

for (const value of ['yes', '0']) {
  test(`hold=${value} fails the assignment before any clone  [M4 / leg (e)]`, () => {
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

test('a merge GitHub refuses out of hand is not retried  [M4 / leg (e)]', () => {
  const ctx = ran({ STUB_MERGE_CODE: '405' })
  assert.equal(mergePuts(ctx).length, 1, 'one PUT, and no second one')
  const status = statusOf(ctx)
  assert.equal(status.state, 'done')
  assert.equal(status.merged, null)
  assert.equal(status.pr, PR_URL)
  assert.ok(stream(ctx).some((l) => l.includes('PUT answered 405')),
    'the log quotes the code: ' + merges(ctx))
})

test('a 405 whose body names a moved base folds again and merges  [M4 / leg (e)]', () => {
  const ctx = ran({
    STUB_MERGE_CODE: '405',
    STUB_MERGE_MESSAGE: 'Base branch was modified. Review and try the merge again.',
  })
  assert.equal(mergePuts(ctx).length, 2, 'the refused PUT, then the one after the fold')
  assert.ok(stream(ctx).some((l) => l.includes('systemd-run fold fleet-fold-7-2')),
    'a second fold unit ran')
  assert.equal(statusOf(ctx).merged, MERGE_SHA)
})

// ── 6. the cell on every page  [M4 / leg (e)] ────────────────────────────────

test('every page carries merged, null until the merge  [M4 / leg (e)]', () => {
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

// ── 7. the script parses  [leg (l)] ──────────────────────────────────────────

test('bash -n accepts the script  [leg (l)]', () => {
  const r = spawnSync('bash', ['-n', SCRIPT], { encoding: 'utf8', env: ENV })
  assert.equal(r.status, 0, r.stderr)
})

// ── 8. the operator documents  [M5] [M6] [M7] ────────────────────────────────

const read = (file) => fs.readFileSync(file, 'utf8')
/** A document's lines from the first matching one up to the next stop, joined.
 *
 *  One space between them and one space wherever the source wrapped: a prose
 *  assertion here is about the sentence, and a sentence that reads the same is
 *  the same however its author broke the line under it. */
const section = (file, from, to) => {
  const all = read(file).split('\n')
  const start = all.findIndex((l) => from.test(l))
  assert.ok(start >= 0, `${file} has no line matching ${from}`)
  const rest = all.slice(start + 1)
  const end = rest.findIndex((l) => to.test(l))
  return [all[start], ...(end < 0 ? rest : rest.slice(0, end))].join(' ').replace(/\s+/g, ' ')
}

test('CONTRACT.md carries the cell, the merge call and the hold key  [M5]', () => {
  const contract = read(CONTRACT)
  assert.ok(contract.includes('"prAuthor":"<GitHub login or null>","merged":"<40-hex or null>"'),
    'the status.json literal gains merged right after prAuthor')

  const bootScript = section(CONTRACT, /^- \*\*Boot script/, /^- \*\*status\.json/)
  assert.match(bootScript, /pulls\/<n>\/merge[\s\S]*hold=1/,
    'the Boot-script bullet names the PUT and the hold key, in order')
  assert.ok(!bootScript.includes('check' + '-runs'),
    `and no check-runs endpoint: ${bootScript}`)

  const publish = section(CONTRACT, /^- \*\*Publish:\*\*/, /^- \*\*Integration naming/)
  assert.match(publish, /sandbox merges its own ready PR once its gate is green and the default branch.s tip is the one it folded onto[\s\S]*hold=1/,
    'and the Publish bullet says what the merge is decided on')
  assert.ok(!publish.includes('check run'), `and names no check run: ${publish}`)
})

test('RUNBOOK.md says the PR merges itself on its own gate  [M6]', () => {
  const pr = section(RUNBOOK, /^\*\*The PR\.\*\*/, /^\*\*Reap\.\*\*/)
  assert.match(pr, /A ready PR merges itself[\s\S]*gate is green[\s\S]*tip[\s\S]*--hold/)
  assert.ok(!pr.includes('check run'), `and names no check run: ${pr}`)

  const done = read(RUNBOOK).split('\n').filter((l) => /^\| `done` \|/.test(l))
  assert.equal(done.length, 1, 'one done row in the States table')
  assert.match(done[0], /merged is the squash commit/)

  const trust = section(RUNBOOK, /^## Trust/, /^## Rollback/)
  assert.match(trust, /--hold[\s\S]*to keep a human at the merge button/)
  assert.ok(!trust.includes('a pull request rather than a merge'), 'the old sentence is gone')
})

test('SKILL.md step 4 says a ready PR merges itself  [M7]', () => {
  const step = section(SKILL, /^4\. \*\*The PR is the gate/, /^5\. \*\*Reap/)
  assert.match(step, /A ready PR merges itself[\s\S]*--hold[\s\S]*on the launch line keeps it open/)
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
//   M3  one `publish:merge` per merge decision — the squash sha, `held`,
//       `base moved`, `refused` — and the retry's two, in order, the last
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
  held: HELD_ENV,
  baseMoved: { STUB_TIP: OTHER_SHA },
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
/** The held run, booted once and shared with the card leg above. */
function heldRun() { return ctxOf('held') }

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
  held: {
    kind: 'publish:merge', sha: null, left: 'held', detail: HELD_PATH,
  },
  baseMoved: {
    kind: 'publish:merge', sha: null, left: 'base moved',
    detail: `tip ${HEAD_SHA} → ${OTHER_SHA}`,
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
  const list = ofKind(ctx, 'publish:merge')
  assert.equal(list.length, 1)
  assert.deepEqual(unstamped(list[0]), { kind: 'publish:merge', sha: MERGE_SHA },
    'the answer\'s sha, and no `left` and no `detail`')
  assert.ok(!('left' in list[0]) && !('detail' in list[0]), 'a merge that happened leaves neither')
  assert.equal(statusOf(ctx).merged, MERGE_SHA, 'the page says the same')
})

test('an unattributed red appends publish:merge left=held, and no PUT  [#703 M3 / leg (d)]', () => {
  const ctx = ctxOf('held')
  assert.deepEqual(ofKind(ctx, 'publish:merge').map(unstamped), [{
    kind: 'publish:merge', sha: null, left: 'held', detail: HELD_PATH,
  }])
  assert.deepEqual(mergePuts(ctx), [], 'no PUT was made')
})

test('a base that moved appends publish:merge left=base moved  [#703 M3 / leg (e)]', () => {
  const ctx = ctxOf('baseMoved')
  const list = ofKind(ctx, 'publish:merge').map(unstamped)
  assert.ok(list.length >= 1, 'the refusal is recorded')
  for (const record of list) {
    assert.equal(record.left, 'base moved')
    assert.equal(record.sha, null)
    assert.ok(String(record.detail).startsWith('tip '),
      `the detail is the two tips: ${record.detail}`)
  }
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
  const list = ofKind(ctx, 'publish:merge')
  assert.equal(list.length, 2, 'one per merge decision, in order: '
    + JSON.stringify(list.map(unstamped)))
  assert.deepEqual(unstamped(list[0]), {
    kind: 'publish:merge', sha: null, left: 'refused', detail: 'merge PUT answered 405',
  }, 'the 405 the second fold answered')
  assert.deepEqual(unstamped(list[1]), { kind: 'publish:merge', sha: MERGE_SHA },
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
    'held', 'base moved', 'refused',
  ]) {
    assert.ok(publish.includes(word),
      `the Publish bullet does not name \`${word}\`: ${publish}`)
  }
  for (const retired of ['checks' + ' red', 'checks' + ' pending']) {
    assert.ok(!publish.includes(retired),
      `the Publish bullet still names \`${retired}\`: ${publish}`)
  }
})

runTests(tests)
