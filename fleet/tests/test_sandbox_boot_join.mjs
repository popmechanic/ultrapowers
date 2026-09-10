/**
 * fleet/tests/test_sandbox_boot_join.mjs — the sandbox owns the join and the
 * hold.
 *
 * The claim: a run's PR merges itself once its own gate is green and main has
 * not moved under it, asks GitHub for no check runs, and a run whose gate
 * passed on an unattributed red publishes a ready PR, says what went red, and
 * waits.
 *
 * The clauses this file pins, and the legs that pin them:
 *
 *   M1  before its merge PUT the script fetches the target's default branch and
 *       compares its tip to the fold receipt's `tip`; when they DIFFER it
 *       issues no PUT, appends `publish:merge` with `sha` null, `left`
 *       `base moved` and `detail` `tip <old> → <new>`, and raises the
 *       fold-again signal; when they are EQUAL it PUTs once.   legs (a), (b)
 *   M2  the script carries none of `check-runs`, `check_runs_verdict`,
 *       `MERGE_CHECKS_GRACE`, `checks red`, `checks pending`, and a gate-green
 *       run whose tip did not move merges with zero requests whose URL carries
 *       `check-runs`.                                          legs (a), (c)
 *   M3  a gate receipt whose `suite.unattributed` is a non-empty list publishes
 *       a ready PR, issues no PUT, sets the note, appends `publish:merge` with
 *       `left` `held`, ends `done` with `merged` null, and the body carries a
 *       `## Held` section of exactly three things in order.           leg  (d)
 *   M4  `hold=1` still publishes and stops; a 405 naming a moved base still
 *       folds again.                                                 leg  (e)
 *   M5  `tests/test_docs_agree_with_code.py`'s publish-record literal list
 *       names `held` and `base moved` and neither retired literal; the
 *       contract's publish bullet and the runbook's merge paragraph name a
 *       `tip` and no check run.                                      leg  (f)
 *
 * THE RIG IS `_sandbox_boot_helpers.mjs`, and this exam reads the tip through
 * ONE KNOB: `STUB_TIP` — what the git stub answers
 * `rev-parse refs/remotes/origin/<default>` with. Every case here sets it, so
 * `STUB_TIP` equal to the fold receipt's `tip` is a base that did not move and
 * `STUB_TIP` set to any other sha is a base that did. Nothing here reads
 * `checkReads`, `STUB_CHECKS` or any other name the check-runs poll left
 * behind: the requests are counted off the `curl` argv log, which answers "how
 * many URLs carried `check-runs`" whether or not the stub still has an arm for
 * one.
 *
 * A boot is ~40 forks of stub shell, so each of the six scenarios below is
 * booted once, memoized, and asked its questions afterwards.
 */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  SCRIPT, ASSIGNMENT, HEAD_SHA, MERGE_SHA, PR_URL, RUN_PATH,
  makeHome, boot,
  stream, statusOf, prPosts, mergePuts, argvLines,
  publishEvents, eventsOfKind, foldUnits, evidenceDir,
  runTests, ENV,
} from './_sandbox_boot_helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CONTRACT = path.join(HERE, '..', 'CONTRACT.md')
const RUNBOOK = path.join(HERE, '..', 'RUNBOOK.md')
const DOC_PINS = path.join(HERE, '..', '..', 'tests', 'test_docs_agree_with_code.py')

const tests = []
const test = (name, fn) => tests.push([name, fn])

// ── the run's literals ───────────────────────────────────────────────────────

/** Where the default branch is when it has NOT moved: the fold stub records
 *  `tip` as `STUB_HEAD_SHA`, so this is the fold receipt's own `tip`. */
const FOLD_TIP = HEAD_SHA
/** Where it is when it HAS moved — some other commit, of no other meaning. */
const MOVED_TIP = '9c'.repeat(20)

/** The suite that went red without a task to blame, and the path it names. */
const RED_PATH = 'tests/other.py'
const SECOND_PATH = 'tests/second.py'

/**
 * The failing test's own block of the engine's suite output — the lines
 * `failing_block` cuts out of it (start: the `___ … ___` header; end: the line
 * before the `===` summary rule). The `## Held` section carries THESE lines and
 * the ones around them are not the block.
 */
const HELD_BLOCK = [
  '_________________________ test_the_other_thing _________________________',
  '',
  '    def test_the_other_thing():',
  '>       assert compute() == 2',
  'E       assert 1 == 2',
  '',
  'tests/other.py:4: AssertionError',
]

/** `report.json`'s `tests.output` — the block above, buried in a whole run. */
const REPORT_OUTPUT = [
  '============================= test session starts ==============================',
  'collected 3 items',
  '',
  'tests/other.py F',
  '',
  '=================================== FAILURES ===================================',
  ...HELD_BLOCK,
  '=========================== short test summary info ============================',
  'FAILED tests/other.py::test_the_other_thing - assert 1 == 2',
  '1 failed, 2 passed in 0.11s',
].join('\n')

/**
 * A DECOY, in the gate receipt's own `suite.output`: a failing block of the
 * same shape, whose header line no card may carry. M3 says the `## Held`
 * section is cut from `report.json`'s `tests.output` — a section cut from the
 * receipt instead would print this header as a line of its own. (The receipt is
 * quoted whole inside the `### Checks` fence, on ONE line, which is why the
 * assertion is over lines and not over the body's bytes.)
 */
const DECOY_HEADER = '____________________ test_the_receipts_copy ____________________'
const RECEIPT_OUTPUT = [
  DECOY_HEADER,
  'E       assert 0 == 1',
  '',
  'tests/other.py:9: AssertionError',
].join('\n')

/** The engine's report, as the fold's suite left it. */
const HELD_REPORT = JSON.stringify({ stamp: 'run-7', tests: { output: REPORT_OUTPUT } })
/** A gate receipt that PASSED on a red suite nobody could attribute. */
const heldReceipt = (unattributed) => JSON.stringify({
  verdict: 'PASS',
  suite: { passed: false, unattributed, output: RECEIPT_OUTPUT },
})

/** M3's note, and the three lines the `## Held` section owes a reader. */
const HELD_NOTE = `left open: suite red, unattributed: ${RED_PATH}`
const MERGE_BODY_LINE = `- merge: ${HELD_NOTE}`
const GH_LINE = `gh pr merge 1 --squash --match-head-commit ${HEAD_SHA}`
const FIX_LINE = `Fix: ${RED_PATH} went red on the fold of run-7`

// ── the six boots ────────────────────────────────────────────────────────────

const CASE_ENV = {
  // (a) the tip the fold folded onto is the tip main is at now.
  join: { STUB_TIP: FOLD_TIP },
  // (b) main moved under the run. The second fold is answered `tip unmoved` so
  // the fold-again loop has a floor that does not depend on the wall clock:
  // `STUB_TIP` cannot come back, and `do_boot` leaves the loop on that
  // disposition without another PUT. What leg (b) reads is the FIRST decision.
  moved: { STUB_TIP: MOVED_TIP, STUB_FOLD_DISPOSITION_2: 'tip unmoved' },
  // (d) the gate passed; the suite did not, and no task owns the file.
  held: {
    STUB_TIP: FOLD_TIP,
    STUB_GATE_RECEIPT: heldReceipt([RED_PATH]),
    STUB_REPORT: HELD_REPORT,
  },
  // (d) two unattributed paths: the note and the fix line name the FIRST, the
  // event's `detail` names both, joined by `, `.
  heldTwo: {
    STUB_TIP: FOLD_TIP,
    STUB_GATE_RECEIPT: heldReceipt([RED_PATH, SECOND_PATH]),
    STUB_REPORT: HELD_REPORT,
  },
  // (e) the operator kept the merge button.
  hold: { STUB_TIP: FOLD_TIP, FLEET_ASSIGNMENT: `${ASSIGNMENT} hold=1` },
  // (e) the tip agreed, the PUT was made, and GitHub refused it for a base that
  // moved between the two. The second PUT is answered 200 by the rig.
  refused: {
    STUB_TIP: FOLD_TIP,
    STUB_MERGE_CODE: '405',
    STUB_MERGE_MESSAGE: 'Base branch was modified',
  },
}

const BOXES = new Map()
/** One case's boot, run once and asserted to have exited 0. */
function ran(key) {
  if (!BOXES.has(key)) {
    const ctx = makeHome()
    const r = boot(ctx, ['boot'], CASE_ENV[key])
    assert.equal(r.status, 0,
      `${key}: the boot exited ${r.status}\n--- stdout\n${r.stdout}\n--- stderr\n${r.stderr}`)
    BOXES.set(key, ctx)
  }
  return BOXES.get(key)
}

// ── readers ──────────────────────────────────────────────────────────────────

/** Every request this run made whose URL carries `check-runs`. */
const checkRunRequests = (ctx) =>
  argvLines(ctx, 'curl').filter((a) => a.some((s) => s.includes('check-runs')))

/** An event without its stamp, so a leg can assert its whole content at once. */
const unstamped = (e) => {
  const rest = { ...e }
  delete rest.id
  delete rest.ts
  return rest
}
const merges = (ctx) => eventsOfKind(ctx, 'publish:merge')
const publishKinds = (ctx) => publishEvents(ctx).map((e) => e.kind)
const publishJson = (ctx) => JSON.stringify(publishEvents(ctx).map(unstamped))

/** The card as `render_card` last left it in the evidence worktree. */
const bodyLines = (ctx) => {
  const file = path.join(evidenceDir(ctx), RUN_PATH, 'pr-body.md')
  assert.ok(fs.existsSync(file), `no card was rendered at ${file}`)
  return fs.readFileSync(file, 'utf8').split('\n')
}
/** The index of the one line equal to `needle`, asserted to be the only one. */
const onlyLine = (lines, needle, where) => {
  const at = lines.reduce((acc, l, i) => (l === needle ? [...acc, i] : acc), [])
  assert.equal(at.length, 1,
    `${where}: expected exactly one line \`${needle}\`, found ${at.length}\n`
    + `--- the card\n${lines.join('\n')}`)
  return at[0]
}

// ═══ (a) the tip agreed: one PUT, no check run  [M1] [M2] ════════════════════

test('a gate-green boot whose tip equals the fold receipt\'s merges once, asking for no check run  [leg (a)] [M1] [M2]', () => {
  const ctx = ran('join')

  assert.deepEqual(checkRunRequests(ctx), [],
    '[M2] a gate-green run whose tip did not move merges with zero requests whose '
    + 'URL contains `check-runs`')

  assert.equal(mergePuts(ctx).length, 1,
    '[M1] the tip and the fold receipt\'s `tip` are equal, so the script PUTs once')

  assert.deepEqual(publishKinds(ctx), ['publish:pr', 'publish:merge'],
    `[M1] the PR, then the one merge decision: ${publishJson(ctx)}`)
  assert.deepEqual(merges(ctx).map(unstamped), [{ kind: 'publish:merge', sha: MERGE_SHA }],
    '[M1] one `publish:merge` carrying the squash sha, and no `left` and no `detail`')

  const status = statusOf(ctx)
  assert.equal(status.state, 'done')
  assert.equal(status.pr, PR_URL)
  assert.equal(status.merged, MERGE_SHA, '[M1] and the page carries the squash commit')
})

// ═══ (b) the tip moved: no PUT, `base moved`, another fold  [M1] ══════════════

test('a boot whose tip moved under it issues no PUT and folds again  [leg (b)] [M1]', () => {
  const ctx = ran('moved')

  assert.deepEqual(mergePuts(ctx), [],
    '[M1] the live tip differs from the fold receipt\'s `tip`, so no PUT is issued')

  const first = merges(ctx)[0]
  assert.ok(first, `[M1] no \`publish:merge\` line at all: ${publishJson(ctx)}`)
  assert.deepEqual(unstamped(first), {
    kind: 'publish:merge',
    sha: null,
    left: 'base moved',
    detail: `tip ${FOLD_TIP} → ${MOVED_TIP}`,
  }, '[M1] `sha` null, `left` `base moved`, and `detail` `tip <old> → <new>` — the fold '
    + 'receipt\'s tip, then the one the default branch is at now')
  assert.ok(String(first.detail).startsWith('tip '),
    `[leg (b)] the detail begins \`tip \`: ${first.detail}`)

  assert.deepEqual(foldUnits(ctx), ['fleet-fold-7-1', 'fleet-fold-7-2'],
    '[M1] the fold-again signal was raised, so a second fold ran')
  assert.ok(stream(ctx).includes('status: state=running phase=publish fold (attempt 2)'),
    '[M1] and the stream shows the second `publish fold (attempt 2)`:\n'
    + stream(ctx).filter((l) => l.startsWith('status: ')).join('\n'))

  assert.deepEqual(checkRunRequests(ctx), [],
    '[M2] and it asked GitHub for no check run on the way')
})

// ═══ (c) the names the script no longer carries  [M2] ════════════════════════

const RETIRED = ['check-runs', 'check_runs_verdict', 'MERGE_CHECKS_GRACE', 'checks red', 'checks pending']
/** What stays: `await_mergeable` still measures itself against MERGE_CHECK_WAIT. */
const SURVIVORS = ['MERGE_CHECK_WAIT', 'await_mergeable']

/** `grep -c <needle> <file>` — the count of lines carrying it. */
const grepCount = (needle, file) => {
  const r = spawnSync('grep', ['-c', needle, file], { encoding: 'utf8', env: ENV })
  assert.ok(r.status === 0 || r.status === 1,
    `grep -c ${needle} exited ${r.status}: ${r.stderr}`)
  const n = Number(String(r.stdout).trim())
  assert.ok(Number.isInteger(n), `grep -c ${needle} printed ${JSON.stringify(r.stdout)}`)
  return n
}

test('the boot script carries none of the check-runs names, and keeps the backstop  [leg (c)] [M2]', () => {
  for (const name of RETIRED) {
    assert.equal(grepCount(name, SCRIPT), 0,
      `[M2] fleet/sandbox-boot.sh still carries \`${name}\` — the check-runs poll, its `
      + 'parser, its grace and its two events are gone')
  }
  for (const name of SURVIVORS) {
    assert.ok(grepCount(name, SCRIPT) > 0,
      `[M2] fleet/sandbox-boot.sh no longer carries \`${name}\` — \`await_mergeable\`, `
      + 'the PUT and the 405 arms stay as the backstop')
  }
})

// ═══ (d) the hold: a ready PR, no PUT, and the card that says why  [M3] ══════

test('an unattributed red publishes a ready PR, issues no PUT and ends done with merged null  [leg (d)] [M3]', () => {
  const ctx = ran('held')

  assert.equal(prPosts(ctx).length, 1, '[M3] one PR was opened')
  assert.equal(prPosts(ctx)[0].draft, false,
    '[M3] and it is READY — the verdict is `PASS`, so the PR is not a draft')

  assert.deepEqual(mergePuts(ctx), [], '[M3] no merge PUT was issued')

  const status = statusOf(ctx)
  assert.equal(status.state, 'done', '[M3] the run ends `done`')
  assert.equal(status.merged, null, '[M3] with `merged` null — the page carries no squash sha')
  assert.equal(status.pr, PR_URL)
  assert.ok(String(status.phase).endsWith(HELD_NOTE),
    `[M3] and the page's phase ends on the note \`${HELD_NOTE}\`: ${status.phase}`)

  assert.deepEqual(publishKinds(ctx), ['publish:pr', 'publish:merge'],
    `[M3] the PR, then the one merge decision: ${publishJson(ctx)}`)
  assert.deepEqual(merges(ctx).map(unstamped), [{
    kind: 'publish:merge', sha: null, left: 'held', detail: RED_PATH,
  }], '[M3] `sha` null, `left` `held`, `detail` the path list joined by `, `')
})

test('the held card carries the merge line and a ## Held of three things, in order  [leg (d)] [M3]', () => {
  const ctx = ran('held')
  const lines = bodyLines(ctx)
  const card = lines.join('\n')

  const merge = onlyLine(lines, MERGE_BODY_LINE, 'the card')
  const held = onlyLine(lines, '## Held', 'the card')
  const block = onlyLine(lines, HELD_BLOCK[0], 'the card')
  const gh = lines.findIndex((l) => l.startsWith('gh pr merge '))
  const fix = lines.findIndex((l) => l.startsWith('Fix: '))

  assert.ok(gh >= 0, `[M3] the card carries no line beginning \`gh pr merge \`:\n${card}`)
  assert.ok(fix >= 0, `[M3] the card carries no line beginning \`Fix: \`:\n${card}`)
  assert.ok(merge >= 0)

  // The failing block, whole and contiguous — the lines `failing_block` cuts out
  // of `report.json`'s `tests.output`, and no others between them.
  assert.deepEqual(lines.slice(block, block + HELD_BLOCK.length), HELD_BLOCK,
    `[M3] the \`## Held\` section does not carry the failing block whole:\n${card}`)
  assert.ok(!lines.includes('collected 3 items'),
    `[M3] the section is the failing BLOCK, not the whole of \`tests.output\`:\n${card}`)
  assert.ok(!lines.includes(DECOY_HEADER),
    '[M3] the block is cut from `report.json`\'s `tests.output`, not from the gate '
    + `receipt's own \`suite.output\`:\n${card}`)

  assert.ok(lines[gh].includes('--squash --match-head-commit'),
    `[leg (d)] the merge command carries \`--squash --match-head-commit\`: ${lines[gh]}`)
  assert.equal(lines[gh], GH_LINE,
    '[M3] `gh pr merge <number> --squash --match-head-commit <head>` — the PR\'s number '
    + 'and the PR\'s head')
  assert.equal(lines[fix], FIX_LINE,
    '[M3] `Fix: <first path> went red on the fold of run-<N>`')

  assert.ok(held < block && block < gh && gh < fix,
    '[M3] `## Held`, then the failing block, then the merge command, then the fix line — '
    + `in that order; found ## Held at ${held}, the block at ${block}, `
    + `the command at ${gh} and the fix at ${fix}:\n${card}`)
})

test('two unattributed paths join with ", " and the note names the first  [leg (d)] [M3]', () => {
  const ctx = ran('heldTwo')

  assert.deepEqual(mergePuts(ctx), [], '[M3] still no PUT')
  assert.deepEqual(merges(ctx).map(unstamped), [{
    kind: 'publish:merge', sha: null, left: 'held',
    detail: `${RED_PATH}, ${SECOND_PATH}`,
  }], '[M3] `detail` is the path list joined by `, `')

  assert.ok(String(statusOf(ctx).phase).endsWith(HELD_NOTE),
    `[M3] the note names the FIRST path: ${statusOf(ctx).phase}`)

  const lines = bodyLines(ctx)
  onlyLine(lines, MERGE_BODY_LINE, 'the card')
  assert.equal(lines[lines.findIndex((l) => l.startsWith('Fix: '))], FIX_LINE,
    '[M3] and so does the fix line')
})

// ═══ (e) the two paths that do not change  [M4] ══════════════════════════════

test('hold=1 still publishes, holds and issues no PUT  [leg (e)] [M4]', () => {
  const ctx = ran('hold')

  assert.equal(prPosts(ctx).length, 1, '[M4] the PR is still opened')
  assert.deepEqual(mergePuts(ctx), [], '[M4] and no PUT is issued')
  assert.deepEqual(publishKinds(ctx), ['publish:pr', 'publish:hold'],
    `[M4] the PR, then the hold: ${publishJson(ctx)}`)
  assert.deepEqual(unstamped(publishEvents(ctx)[1]), { kind: 'publish:hold', why: 'hold=1' },
    '[M4] `publish:hold` with `why` `hold=1`')

  const status = statusOf(ctx)
  assert.equal(status.state, 'done')
  assert.equal(status.pr, PR_URL)
  assert.equal(status.merged, null)
})

test('a 405 whose body names a moved base still folds again and records the refusal  [leg (e)] [M4]', () => {
  const ctx = ran('refused')

  assert.deepEqual(foldUnits(ctx), ['fleet-fold-7-1', 'fleet-fold-7-2'],
    '[M4] the refused PUT raised the fold-again signal')

  const decisions = merges(ctx).map(unstamped)
  assert.deepEqual(decisions[0], {
    kind: 'publish:merge', sha: null, left: 'refused', detail: 'merge PUT answered 405',
  }, `[M4] the refusal is one \`publish:merge\` with \`left\` \`refused\`: ${publishJson(ctx)}`)
  assert.equal(mergePuts(ctx).length, 2,
    '[M4] one PUT per fold — the refused one, then the one the second fold earned')
  assert.deepEqual(decisions[decisions.length - 1], { kind: 'publish:merge', sha: MERGE_SHA },
    '[M4] and the LAST decision is what became of the PR')
  assert.equal(statusOf(ctx).merged, MERGE_SHA)
})

// ═══ (f) the documents  [M5] ═════════════════════════════════════════════════

/** `sed -n '<expr>' <file>` — the range a leg reads, as its text. */
const sedRange = (expr, file) => {
  const r = spawnSync('sed', ['-n', expr, file], { encoding: 'utf8', env: ENV })
  assert.equal(r.status, 0, `sed -n ${expr} exited ${r.status}: ${r.stderr}`)
  return r.stdout
}

/** The literal tuple `PUBLISH_RECORD_LITERALS = ( … )`, as its strings. */
const publishRecordLiterals = () => {
  const source = fs.readFileSync(DOC_PINS, 'utf8')
  const block = /PUBLISH_RECORD_LITERALS\s*=\s*\(([\s\S]*?)\n\)/.exec(source)
  assert.ok(block,
    'tests/test_docs_agree_with_code.py no longer carries a '
    + '`PUBLISH_RECORD_LITERALS = ( … )` tuple — that list is where the `left` '
    + 'vocabulary the contract must name is written down')
  return [...block[1].matchAll(/"([^"]*)"|'([^']*)'/g)].map((m) => m[1] ?? m[2])
}

test('the publish-record literals name held and base moved, and neither retired literal  [leg (f)] [M5]', () => {
  const literals = publishRecordLiterals()
  const shown = JSON.stringify(literals)
  for (const name of ['held', 'base moved']) {
    assert.ok(literals.includes(name),
      `[M5] PUBLISH_RECORD_LITERALS does not name \`${name}\`: ${shown}`)
  }
  for (const name of ['checks red', 'checks pending']) {
    assert.ok(!literals.includes(name),
      `[M5] PUBLISH_RECORD_LITERALS still names \`${name}\` — the sandbox reads no `
      + `check run, so the contract declares no such \`left\`: ${shown}`)
  }
})

test('the contract\'s publish bullet and the runbook\'s merge paragraph name a tip and no check run  [leg (f)] [M5]', () => {
  const cuts = [
    ['fleet/CONTRACT.md\'s publish bullet',
      sedRange('/^- \\*\\*Publish:\\*\\*/,/^- \\*\\*Integration naming/p', CONTRACT)],
    ['fleet/RUNBOOK.md\'s merge paragraph',
      sedRange('/merges itself/,/^$/p', RUNBOOK)],
  ]
  for (const [what, cut] of cuts) {
    assert.ok(cut.trim().split('\n').length > 1, `${what} cut to nothing:\n${cut}`)
    assert.ok(!cut.includes('check run'),
      `[M5] ${what} still names a check run:\n${cut}`)
    assert.ok(cut.includes('tip'),
      `[M5] ${what} does not say the sandbox merges once the default branch's tip is `
      + `the one it folded onto:\n${cut}`)
  }
})

runTests(tests)
