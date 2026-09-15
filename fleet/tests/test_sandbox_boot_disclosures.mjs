/**
 * Exam for run-146 task 3 — "An edit a task could not take becomes a ticket the
 * run opens beside its PR" (#992 desired state 3; #711, commit `2cf8bc3b`).
 *
 * CLAIM. An edit a task needed but could not make — the plan froze the file —
 * becomes a ticket the run opens beside its PR, so the follow-up stops waiting
 * for someone to notice it in a note.
 *
 * Five machine clauses, read here leg by leg and nowhere else:
 *
 *   M1  after `publish` has opened the PR and before `merge_pr` is called, the
 *       boot reads the evidence copy of `report.json` for every `judgmentCalls`
 *       entry matching `^task (\S+): out-of-FILES \(not taken\): (.+)$` and,
 *       when there is at least one, makes EXACTLY ONE
 *       `POST https://$GITHUB_INT_HOST/api/v3/repos/$TARGET_REPO/issues` through
 *       `fleet_curl` whose JSON payload has `title`
 *       `fleet <RUN_ID> disclosures: <heading>` — `<heading>` the same
 *       `plan_title` answer `publish` uses for the PR title — `body` the PR URL,
 *       a blank line, then one `- [ ] task <id> — <text>` line per matching
 *       entry IN REPORT ORDER, and no `labels` key; an entry prefixed
 *       `out-of-FILES:` without `(not taken)` — an edit the task DID take — is
 *       not listed                                            → legs (a), (g)
 *   M2  with no matching entry the boot makes no `/issues` POST; a POST answered
 *       non-2xx is logged as `disclosures: POST /repos/<target>/issues answered
 *       <code>` and the run continues to `merge_pr` unchanged  → legs (b), (c)
 *   M3  a POST answered 2xx appends one `publish:disclosures` event
 *       `{url, items}` — `url` the answer's `html_url` — to the run's
 *       `events.jsonl` through `append_event`, AFTER the `publish:pr` line
 *                                                              → leg (d)
 *   M4  `fleet/roles/implementer.md`'s judgment-rules paragraph says an edit
 *       outside FILES the task needed but did not make is disclosed as a
 *       `concerns` entry prefixed `out-of-FILES (not taken):` naming the path
 *       and what is owed; `fleet/CONTRACT.md`'s Publish bullet says the residual
 *       checklist files no issue except the disclosures ticket, and names
 *       `publish:disclosures` beside the three publish event kinds → leg (e)
 *   M5  the residual checklist and `residuals.jsonl` are what they were at BASE:
 *       a run with disclosures and no reviewer notes or acks still renders
 *       `Residuals: none` in its PR card                        → leg (f)
 *
 * THREE BOOTS, NO MORE. A boot is ~40 forks of stub shell, so the seven legs
 * share exactly three of them and each is started once and awaited by everyone
 * who reads it — the shape `test_sandbox_boot_kata_export.mjs` uses:
 *
 *   DISCLOSED  the green run whose `report.json` is the rig's own
 *              `DEFAULT_REPORT` plus a `judgmentCalls` array of FOUR entries:
 *              a `(not taken)` one, a TAKEN `out-of-FILES:` one, a second
 *              `(not taken)` one, and an unrelated `plan-defect:` one. Legs
 *              (a), (d) and (f) read this one.
 *   PLAIN      the rig's shared default green boot (`greenAsync`), whose
 *              report carries no `judgmentCalls` at all. Leg (b) reads it.
 *   REFUSED    the DISCLOSED run with `STUB_ISSUE_CODE=500`. Leg (c) reads it.
 *
 * THE TAKEN ENTRY IS THE POINT, and it sits BETWEEN the two `(not taken)` ones
 * on purpose. It is an `out-of-FILES:` concern the task did take, so the run
 * owes nobody a ticket for it; a reader that matched on `out-of-FILES` rather
 * than on `out-of-FILES (not taken)` would list three items in the wrong order
 * and name a path leg (a) forbids, and a reader that filtered the right entries
 * but re-sorted them would fail the same leg. The `plan-defect:` entry is a
 * judgment call of another kind entirely and belongs to no ticket at all.
 *
 * THE CHECKLIST IS NOT HAND-WRITTEN. `EXPECTED_ITEMS` below is M1's own regex
 * applied to the fixture, so the expectation is the clause and not a second
 * copy of it.
 *
 * LEG (g) IS THE DRIVER'S. It names the second, third and fourth `Run:` lines —
 * the three boot sims of BASE, still green on the edited script — and the bridge
 * runs those three lines itself. This file may not: `test_sims_are_hermetic.mjs`
 * M4 forbids a sim from running, or even naming for an existence check, a
 * sibling sim, and a sim that broke that probe would cost the run more than the
 * leg buys. What is left here is the reading of the edited script this exam can
 * make on its own, and the one all three of them rest on: it still parses.
 */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

import {
  SCRIPT, ENV, DEFAULT_REPORT, PLAN_H1, PR_URL, FOLLOWUP_URL, TARGET,
  makeHome, bootAsync, greenAsync,
  readLog, lines, stream, indexOf, argvLines, events, prPosts, mergePuts,
  runTests,
} from './_sandbox_boot_helpers.mjs'

const tests = []
const test = (name, fn) => tests.push([name, fn])

/** The checkout, from the script the rig points at — `fleet/sandbox-boot.sh`. */
const ROOT = path.resolve(SCRIPT, '..', '..')

// ── the run, and the judgment calls its report carries ───────────────────────

/** The run the rig's `ASSIGNMENT` names (`run=7`), as `RUN_ID` spells it. */
const RUN_ID = 'run-7'

/**
 * The four `judgmentCalls` entries, in the engine's own spelling
 * (`'task ' + task.id + ': ' + c`, `fleet/run-engine.mjs`). Two are edits the
 * task needed and did NOT take; one is an edit it DID take, and sits between
 * them; one is a judgment call of another kind. Each `(not taken)` text carries
 * an em dash of its own, so a reader that split the line on the dash it writes
 * cannot come out with the text M1 asks for.
 */
const JUDGMENT_CALLS = [
  'task 1: out-of-FILES (not taken): skills/ultrapowers/references/report-format.md'
  + ' now carries stale prose — the shape it describes is the old one',
  'task 1: out-of-FILES: fleet/run-engine.mjs — the call site this task needed grew one line',
  'task 1: out-of-FILES (not taken): fleet/CONTRACT.md owes the Publish bullet a sentence'
  + ' — nothing there names the ticket yet',
  'task 2: plan-defect: leg (c) cannot pass — it reads state this task itself creates',
]

/** The path of the TAKEN entry: named by no line of the ticket. */
const TAKEN_PATH = 'fleet/run-engine.mjs'

/** M1's own matcher, applied below to build the expectation. */
const NOT_TAKEN = /^task (\S+): out-of-FILES \(not taken\): (.+)$/

/** The checklist M1 describes, derived from the fixture by M1's own rule. */
const EXPECTED_ITEMS = JUDGMENT_CALLS
  .map((entry) => NOT_TAKEN.exec(entry))
  .filter(Boolean)
  .map((found) => `- [ ] task ${found[1]} — ${found[2]}`)

/** The title M1 spells: the run, the word, and `publish`'s own heading. */
const EXPECTED_TITLE = `fleet ${RUN_ID} disclosures: ${PLAN_H1}`

/** The whole body M1 spells: the PR URL, a blank line, then the checklist. */
const EXPECTED_BODY_LINES = [PR_URL, '', ...EXPECTED_ITEMS]

/** The endpoint M1 spells, with the rig's `GITHUB_INT_HOST` and target. */
const ISSUES_URL = `https://github.int.exe.xyz/api/v3/repos/${TARGET}/issues`

/** M2's refusal line, for the code the REFUSED boot's stub answers with. */
const REFUSAL_LINE = `disclosures: POST /repos/${TARGET}/issues answered 500`

/** The report both disclosing boots run on: the rig's default, plus the calls.
 *  Built off `DEFAULT_REPORT` so the card still renders a whole task row and
 *  the run is green for every reason it is green without this task. */
const DISCLOSED_REPORT = JSON.stringify({
  ...JSON.parse(DEFAULT_REPORT),
  judgmentCalls: JUDGMENT_CALLS,
})

// ── the three boots ──────────────────────────────────────────────────────────

let DISCLOSED = null
/** The green run whose report carries the four judgment calls. Started once. */
const disclosed = () => {
  if (!DISCLOSED) {
    const ctx = makeHome()
    DISCLOSED = bootAsync(ctx, ['boot'], { STUB_REPORT: DISCLOSED_REPORT }).then((r) => {
      assert.equal(r.status, 0, `the disclosing run did not finish\n${r.stdout}${r.stderr}`)
      return ctx
    })
  }
  return DISCLOSED
}

let REFUSED = null
/** The same run whose `/issues` POST is answered 500. Started once. */
const refused = () => {
  if (!REFUSED) {
    const ctx = makeHome()
    REFUSED = bootAsync(ctx, ['boot'], {
      STUB_REPORT: DISCLOSED_REPORT,
      STUB_ISSUE_CODE: '500',
    }).then((r) => {
      assert.equal(r.status, 0, `the refused-ticket run did not finish\n${r.stdout}${r.stderr}`)
      return ctx
    })
  }
  return REFUSED
}

// ── reading the ticket ───────────────────────────────────────────────────────

/** Every POST /issues the run made, as its parsed JSON payload, in order. */
const issuePosts = (ctx) => lines(readLog(ctx, 'issues.log')).map((l) => JSON.parse(l))
/** Every `publish:disclosures` record in the run dir's log, in file order. */
const disclosureEvents = (ctx) => events(ctx).filter((e) => e.kind === 'publish:disclosures')

// ── leg (a) — M1: one ticket, its title, its body, its order ─────────────────

test('(a) [M1] the disclosing run POSTs exactly one issue, titled and bodied as M1 spells it', async () => {
  const ctx = await disclosed()
  const posts = issuePosts(ctx)

  assert.equal(
    posts.length, 1,
    '(a) [M1] a run whose report carries two `out-of-FILES (not taken):` entries must make '
    + `EXACTLY ONE POST /repos/${TARGET}/issues — this run made ${posts.length}`,
  )
  const [payload] = posts

  // The title is the run, the word, and the SAME heading `publish` puts in the
  // PR title — `plan_title`'s answer, which for this plan is its `# ` line.
  assert.equal(
    EXPECTED_TITLE, 'fleet run-7 disclosures: Smoke: the fleet proves itself',
    '(a) [M1] the rig no longer describes the run this leg was written against',
  )
  assert.equal(
    payload.title, EXPECTED_TITLE,
    '(a) [M1] the ticket\'s `title` must be `fleet <RUN_ID> disclosures: <heading>`, the heading '
    + 'being the `plan_title` answer the PR title carries',
  )
  // The SAME answer, tied to this run's own PR rather than to a constant: the
  // ticket's heading is the PR title's heading, word for word.
  const prTitle = prPosts(ctx)[0].title
  assert.equal(
    payload.title, prTitle.replace(`fleet ${RUN_ID}:`, `fleet ${RUN_ID} disclosures:`),
    `(a) [M1] the ticket's heading must be the PR title's heading — the PR was titled \`${prTitle}\``,
  )

  // The body, whole: the PR URL, a blank line, then one `- [ ] task <id> —
  // <text>` line per matching entry in the report's order — and nothing else.
  assert.equal(typeof payload.body, 'string', '(a) [M1] the ticket carries no `body` at all')
  assert.deepEqual(
    payload.body.replace(/\n+$/, '').split('\n'), EXPECTED_BODY_LINES,
    '(a) [M1] the ticket\'s `body` must be the PR URL, a blank line, then exactly the two '
    + '`- [ ] task 1 — <text>` lines of the `(not taken)` entries, in the report\'s order',
  )
  assert.equal(
    EXPECTED_ITEMS.length, 2,
    '(a) [M1] the fixture no longer holds two `(not taken)` entries',
  )
  assert.ok(
    payload.body.startsWith(`${PR_URL}\n\n`),
    `(a) [M1] the body must OPEN with the PR URL (${PR_URL}) and a blank line`,
  )

  // The taken entry is an edit the task made; the run owes no ticket for it,
  // and no line of this body may name it.
  assert.ok(
    !payload.body.includes(TAKEN_PATH),
    `(a) [M1] the body must not name ${TAKEN_PATH} — that entry is an \`out-of-FILES:\` edit the `
    + 'task DID take, and only the `(not taken)` ones are listed',
  )
  assert.ok(
    !payload.body.includes('plan-defect'),
    '(a) [M1] a `plan-defect:` judgment call matches no part of M1\'s pattern and is not listed',
  )

  // And no labels: this ticket inherits none.
  assert.ok(
    !Object.prototype.hasOwnProperty.call(payload, 'labels'),
    `(a) [M1] the payload must have NO \`labels\` key — it carries ${JSON.stringify(payload.labels)}`,
  )
})

test('(a) [M1] the ticket is opened after the PR POST and before the merge PUT', async () => {
  const ctx = await disclosed()
  const pr = indexOf(ctx, 'curl pr create')
  const issue = indexOf(ctx, 'curl issue create')
  const merge = indexOf(ctx, 'curl pr merge')

  assert.ok(pr >= 0, '(a) [M1] the disclosing run opened no PR at all')
  assert.ok(
    issue >= 0,
    `(a) [M1] the disclosing run made no POST /repos/${TARGET}/issues at all\n`
    + stream(ctx).slice(-25).join('\n'),
  )
  assert.ok(merge >= 0, '(a) [M1] the disclosing run made no merge PUT at all')
  assert.ok(
    pr < issue,
    `(a) [M1] the ticket must be opened AFTER \`publish\` opened the PR (pr ${pr}, issue ${issue})`,
  )
  assert.ok(
    issue < merge,
    `(a) [M1] the ticket must be opened BEFORE \`merge_pr\` is called (issue ${issue}, merge ${merge})`,
  )
  assert.equal(
    stream(ctx).filter((l) => l === 'CALL curl issue create').length, 1,
    '(a) [M1] exactly one `/issues` POST goes out, and it goes out once',
  )

  // The endpoint M1 spells, read off the argv the run actually handed `curl`:
  // the edge host, the target's own collection, and a POST.
  const argv = argvLines(ctx, 'curl').find((a) => a.some((s) => s === ISSUES_URL))
  assert.ok(
    argv,
    `(a) [M1] no curl call carried the URL \`${ISSUES_URL}\` — M1 names that endpoint exactly`,
  )
  assert.ok(
    argv.includes('-X') && argv[argv.indexOf('-X') + 1] === 'POST',
    `(a) [M1] the call to ${ISSUES_URL} must be a POST: ${JSON.stringify(argv)}`,
  )
  assert.ok(
    argv.includes('content-type: application/json'),
    `(a) [M1] the POST must carry a JSON content type: ${JSON.stringify(argv)}`,
  )
})

// ── leg (b) — M2: no matching entry, no POST ─────────────────────────────────

test('(b) [M2] a run whose report carries no matching entry files no ticket', async () => {
  const ctx = await greenAsync()

  // The premise, stated rather than assumed: the rig's default report carries
  // no `judgmentCalls` at all, so nothing in it matches M1's pattern.
  assert.ok(
    !Object.prototype.hasOwnProperty.call(JSON.parse(DEFAULT_REPORT), 'judgmentCalls'),
    '(b) [M2] the rig\'s DEFAULT_REPORT is expected to carry no `judgmentCalls`',
  )

  assert.equal(
    readLog(ctx, 'issues.log'), '',
    `(b) [M2] the default green run must make NO POST /repos/${TARGET}/issues — it wrote `
    + `issues.log:\n${readLog(ctx, 'issues.log')}`,
  )
  assert.equal(
    stream(ctx).filter((l) => l === 'CALL curl issue create').length, 0,
    '(b) [M2] the default green run must reach the `/issues` endpoint not once',
  )
  assert.deepEqual(
    disclosureEvents(ctx), [],
    '(b) [M2] a run that filed no ticket appends no `publish:disclosures` event either',
  )
})

// ── leg (c) — M2: a refused POST is logged, and merges anyway ────────────────

test('(c) [M2] a non-2xx /issues answer is logged and the run continues to merge_pr unchanged', async () => {
  const ctx = await refused()

  // It asked — otherwise everything below would hold for a run that never tried.
  assert.equal(
    issuePosts(ctx).length, 1,
    '(c) [M2] the refused run must still make its one `/issues` POST',
  )

  assert.ok(
    stream(ctx).includes(REFUSAL_LINE),
    `(c) [M2] the boot must log exactly \`${REFUSAL_LINE}\`\n`
    + stream(ctx).filter((l) => l.includes('disclosures')).join('\n'),
  )
  assert.deepEqual(
    disclosureEvents(ctx), [],
    '(c) [M2] a POST answered 500 appends no `publish:disclosures` event — M3 records the 2xx only',
  )
  assert.equal(
    mergePuts(ctx).length, 1,
    '(c) [M2] the run continues to `merge_pr` unchanged: one merge PUT, exactly as without the ticket',
  )
  const issue = indexOf(ctx, 'curl issue create')
  const merge = indexOf(ctx, 'curl pr merge')
  assert.ok(
    issue >= 0 && merge > issue,
    `(c) [M2] the merge PUT must still follow the refused POST (issue ${issue}, merge ${merge})`,
  )
})

// ── leg (d) — M3: the record of the ticket ───────────────────────────────────

test('(d) [M3] a 2xx answer appends one publish:disclosures event after publish:pr', async () => {
  const ctx = await disclosed()
  const all = events(ctx)
  const kinds = all.map((e) => e.kind)

  const recorded = disclosureEvents(ctx)
  assert.equal(
    recorded.length, 1,
    `(d) [M3] the run's events.jsonl must carry EXACTLY ONE \`publish:disclosures\` line — `
    + `it carries ${recorded.length}\n${kinds.join('\n')}`,
  )
  const [event] = recorded
  assert.equal(
    event.url, FOLLOWUP_URL,
    '(d) [M3] the event\'s `url` is the `html_url` GitHub answered the POST with',
  )
  assert.equal(
    event.items, EXPECTED_ITEMS.length,
    `(d) [M3] the event's \`items\` is the number of entries the ticket listed (${EXPECTED_ITEMS.length})`,
  )
  assert.equal(
    typeof event.items, 'number',
    '(d) [M3] `items` rides as an int (`items=i:<n>`), not as a string',
  )

  const pr = kinds.indexOf('publish:pr')
  const here = kinds.indexOf('publish:disclosures')
  assert.ok(pr >= 0, '(d) [M3] the run appended no `publish:pr` line at all')
  assert.ok(
    pr < here,
    `(d) [M3] the \`publish:disclosures\` line must sit AFTER the \`publish:pr\` line `
    + `(publish:pr ${pr}, publish:disclosures ${here})\n${kinds.join('\n')}`,
  )
})

// ── leg (e) — M4: the two role and contract readers, verbatim ────────────────

/** The Proof's fifth and sixth `Run:` lines, as the driver runs them. */
const READERS = [
  [
    'fleet/roles/implementer.md\'s judgment-rules paragraph must name the '
    + '`out-of-FILES (not taken):` prefix',
    "sed -n '/^Judgment rules:/,/^$/p' fleet/roles/implementer.md"
    + " | tr '\\n' ' ' | grep -q 'out-of-FILES (not taken):'",
  ],
  [
    'fleet/CONTRACT.md\'s Publish bullet must say the checklist files no issue EXCEPT the '
    + 'disclosures ticket, and name `publish:disclosures`',
    "sed -n '/^- \\*\\*Publish:\\*\\*/,/^- \\*\\*Integration naming:\\*\\*/p' fleet/CONTRACT.md"
    + " | tr '\\n' ' ' | grep -q 'files no issue for them.*except.*disclosures.*publish:disclosures'",
  ],
]

test('(e) [M4] the implementer role and the Publish bullet carry the words M4 names', () => {
  for (const [what, cmd] of READERS) {
    const r = spawnSync('bash', ['-c', cmd], { cwd: ROOT, encoding: 'utf8', timeout: 60000, env: ENV })
    assert.equal(
      r.status, 0,
      `(e) [M4] ${what}\n  $ ${cmd}\n${r.stdout || ''}${r.stderr || ''}`,
    )
  }
})

// ── leg (f) — M5: the checklist is what it was ───────────────────────────────

test('(f) [M5] a run with disclosures and no reviewer notes still renders `Residuals: none`', async () => {
  const ctx = await disclosed()
  const posts = prPosts(ctx)
  assert.equal(posts.length, 1, '(f) [M5] the disclosing run must open exactly one PR')
  const body = posts[0].body

  assert.ok(
    body.split('\n').includes('Residuals: none'),
    '(f) [M5] the card of a run with disclosures and no `deferred:external` ack and no reviewer '
    + 'note must still carry the line `Residuals: none` — the ticket is not a residual',
  )
  assert.ok(
    !/^Residuals: \d/m.test(body),
    '(f) [M5] the disclosures must not be counted into `Residuals: <n> from review`',
  )
  // And the checklist names none of them: the ticket and the checklist do not
  // duplicate each other.
  for (const item of EXPECTED_ITEMS) {
    assert.ok(
      !body.includes(item),
      `(f) [M5] the PR card must not carry the ticket's line \`${item}\``,
    )
  }
})

// ── leg (g) — M1: the edited script, still a script ──────────────────────────

test('(g) [M1] the edited boot script still parses as bash', () => {
  // THE LEG ITSELF IS THE DRIVER'S. It names the Proof's second, third and
  // fourth `Run:` lines — the three boot sims of BASE, still green on the edited
  // script — and the bridge runs those three lines itself. This file may not:
  // `fleet/tests/test_sims_are_hermetic.mjs` M4 forbids a `test_*.mjs` from
  // running, or even naming for an existence check, a sibling sim, and a sim
  // that broke that probe would cost the run more than the leg buys.
  //
  // What is left here is the one reading of the edited script this exam can
  // make on its own, and the one every other boot sim depends on: the script
  // the three of them source still parses. A `publish`-to-`merge_pr` step
  // spliced in with an unbalanced `fi` fails here before it fails there.
  const script = path.relative(ROOT, SCRIPT)
  const r = spawnSync('bash', ['-n', script], { cwd: ROOT, encoding: 'utf8', timeout: 60000, env: ENV })
  assert.equal(
    r.status, 0,
    `(g) [M1] \`bash -n ${script}\` must be clean — the three boot sims the Proof re-runs all `
    + `source this file\n${r.stdout || ''}${r.stderr || ''}`,
  )
})

runTests(tests)
