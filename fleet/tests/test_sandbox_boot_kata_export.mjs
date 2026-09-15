/**
 * Exam for run-131 task 4 — "The boot exports the run's own slice of a shared
 * project" (#978; #810 rule 9 and move 1).
 *
 * CLAIM. After this run, the `kata.jsonl` a run leaves on its evidence tag
 * holds only that run's issues and events, even though the project on the hub
 * holds every run of the repository.
 *
 * Four machine clauses, read here leg by leg and nowhere else:
 *
 *   M1  `kata_export` writes one `{"kind":"issue", …}` line per issue whose
 *       `uid` is the run issue's uid or one of the task uids named by the plan
 *       commit's `.ultrapowers/kata.json`, and no line for any other issue the
 *       project answers                                          → leg (a)
 *   M2  it writes one `{"kind":"event", …}` line per event whose `issue_uid`
 *       is one of those uids, in the log's order, and no line for an event on
 *       another issue or for an event that names no issue         → leg (b)
 *   M3  the export still pages the events endpoint from `after_id=0` following
 *       `next_after_id` until an empty page, and an export whose issues fetch
 *       fails keeps the previously written `kata.jsonl` byte-identical
 *                                                                 → leg (c)
 *   M4  `fleet/CONTRACT.md`'s `kata.jsonl` bullet carries, in this order, the
 *       words `the run's issues`, `named by` and `events on them` → leg (d)
 *
 * TWO BOOTS, NO MORE. A boot is ~40 forks of stub shell, so the four legs share
 * exactly two of them and each is started once and awaited by everyone who
 * reads it:
 *
 *   KEPT   the green run, with a plan commit whose `.ultrapowers/kata.json`
 *          names run uid `R7` and task uids `T1`/`T2`, a hub answering four
 *          issues (`T1`, `R7`, `X9`, `T2`) and five events (a `project.created`
 *          that names no issue, then events on `T1`, `X9`, `R7`, `T2`). Legs
 *          (a), (b) and the paging half of (c) read this one.
 *   DARK   the same run with `STUB_KATA_ISSUES_EXIT_FROM=2` and a non-zero
 *          `STUB_KATA_ISSUES_EXIT`: the first export succeeds and every later
 *          one fails at its issues fetch. The kept half of leg (c) reads it.
 *          BOTH knobs are set on purpose — the rig's `STUB_KATA_ISSUES_EXIT`
 *          defaults to 0, so `_FROM` on its own fails no call at all.
 *
 * `X9` IS THE POINT. It is a sibling run's task on the SAME kata project — the
 * project the launcher now shares across every run of the repository — so it is
 * answered by the hub's issues endpoint and carried by the hub's event log, and
 * it is the one uid this run's record must not mention.
 *
 * THE HUB'S ORDER IS A LIVE CHECK. Leg (a) names which issues the hub answers;
 * the ORDER the rig answers them in (`T1`, `R7`, `X9`, `T2`) is chosen to be
 * neither the record's order (`R7`, `T1`, `T2`) nor a sorted one, so an export
 * that emitted the record's uids in the record's order instead of the hub's
 * rows in the hub's order fails leg (a) rather than passing it by coincidence.
 * Leg (b)'s order is the task's own.
 */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

import {
  SCRIPT, ENV, KATA_URL,
  makeHome, bootAsync,
  kataJsonl, kataJsonlRaw, kataUrls,
  runTests,
} from './_sandbox_boot_helpers.mjs'

const tests = []
const test = (name, fn) => tests.push([name, fn])

/** The checkout, from the script the rig points at — `fleet/sandbox-boot.sh`. */
const ROOT = path.resolve(SCRIPT, '..', '..')

// ── the run's slice, and the project around it ───────────────────────────────

/** The project every run of this repository files into — one id, many runs. */
const PROJECT_ID = 12
/** The run issue's uid, as the plan commit's record names it. */
const RUN_UID = 'R7'
/** The task uids that record names, keyed by the plan's task ids. */
const TASK_UIDS = { 1: 'T1', 2: 'T2' }
/** A sibling run's task on the same project: answered by the hub, kept by no
 *  line of THIS run's export. */
const OTHER_UID = 'X9'
const OTHER_SHORT_ID = 'ef56'

/** The run's uid set — the run issue's uid plus every task uid, which is what
 *  M1 and M2 filter on. Written out of the record below, never hand-listed. */
const KEPT_UIDS = new Set([RUN_UID, ...Object.values(TASK_UIDS)])

/**
 * The plan commit's `.ultrapowers/kata.json`, in the shape the Global
 * Constraints pin: `{"url", "project": {id, uid, name}, "run": {uid, revision},
 * "tasks": {"<id>": {uid, short_id, revision}}}`, `JSON.stringify(…, null, 2)`
 * plus a trailing newline. The rig's `git show` arm prints these bytes verbatim.
 */
const KATA_RECORD = `${JSON.stringify({
  url: KATA_URL,
  project: { id: PROJECT_ID, uid: 'P7', name: 'popmechanic-smoke' },
  run: { uid: RUN_UID, revision: 1 },
  tasks: {
    1: { uid: TASK_UIDS[1], short_id: 'ab12', revision: 1 },
    2: { uid: TASK_UIDS[2], short_id: 'gh78', revision: 1 },
  },
}, null, 2)}\n`

/** The issues endpoint's answer — the whole project's, not the run's. */
const ISSUE_ROWS = [
  { id: 41, uid: TASK_UIDS[1], short_id: 'ab12', title: 'Task 1', status: 'closed' },
  { id: 40, uid: RUN_UID, short_id: 'cd34', title: 'Run 7', status: 'open' },
  { id: 77, uid: OTHER_UID, short_id: OTHER_SHORT_ID, title: 'a sibling task', status: 'closed' },
  { id: 42, uid: TASK_UIDS[2], short_id: 'gh78', title: 'Task 2', status: 'closed' },
]

/**
 * The events endpoint's first page, in the hub's own envelope (measured
 * 2026-09-14 on kata v0.17.2): `event_id`, `event_uid`, `type`, `project_id`,
 * `issue_id`, `issue_uid`, `issue_short_id`, `actor`, `payload`. The
 * `project.created` row carries NO `issue_uid` — it is the event M2's last
 * words are about.
 */
const EVENT_ROWS = [
  { event_id: 1, event_uid: 'EV1', type: 'project.created', project_id: PROJECT_ID, actor: 'laptop:ultra', payload: {} },
  { event_id: 2, event_uid: 'EV2', type: 'issue.created', project_id: PROJECT_ID, issue_id: 41, issue_uid: TASK_UIDS[1], issue_short_id: 'ab12', actor: 'laptop:ultra', payload: {} },
  { event_id: 3, event_uid: 'EV3', type: 'issue.closed', project_id: PROJECT_ID, issue_id: 77, issue_uid: OTHER_UID, issue_short_id: OTHER_SHORT_ID, actor: 'engine:run-8', payload: {} },
  { event_id: 4, event_uid: 'EV4', type: 'issue.closed', project_id: PROJECT_ID, issue_id: 40, issue_uid: RUN_UID, issue_short_id: 'cd34', actor: 'sandbox:run-7', payload: {} },
  { event_id: 5, event_uid: 'EV5', type: 'issue.closed', project_id: PROJECT_ID, issue_id: 42, issue_uid: TASK_UIDS[2], issue_short_id: 'gh78', actor: 'engine:run-7', payload: {} },
]
/** The cursor that first page hands back — the second call's `after_id`. */
const NEXT_AFTER_ID = 5

const STUB_KATA_ISSUES = JSON.stringify({ issues: ISSUE_ROWS })
const STUB_KATA_EVENTS = JSON.stringify({
  events: EVENT_ROWS, next_after_id: NEXT_AFTER_ID, reset_required: false,
})

/** The environment both boots share: the record on the plan commit, and the
 *  hub answering the two endpoints the export asks. */
const KATA_ENV = { STUB_KATA_JSON: KATA_RECORD, STUB_KATA_ISSUES, STUB_KATA_EVENTS }

// ── what the export must hold ────────────────────────────────────────────────
//
// `kind` first and the object's own fields spread after it, one compact line
// each — the shape `kata_assemble` already writes and `fleet/CONTRACT.md`
// already promises. Both lists are FILTERED HERE BY THE RULE M1 and M2 state,
// so the expectation is the clause applied to the fixture and not a second
// hand-written copy of it.

const keptIssues = ISSUE_ROWS.filter((row) => KEPT_UIDS.has(row.uid))
const keptEvents = EVENT_ROWS.filter((row) => KEPT_UIDS.has(row.issue_uid))

const issueLine = (row) => JSON.stringify({ kind: 'issue', ...row })
const eventLine = (row) => JSON.stringify({ kind: 'event', ...row })

const EXPECTED_LINES = [...keptIssues.map(issueLine), ...keptEvents.map(eventLine)]

// ── the two boots ────────────────────────────────────────────────────────────

let KEPT = null
/** The green run, exported against the hub above. Started once. */
const kept = () => {
  if (!KEPT) {
    const ctx = makeHome()
    KEPT = bootAsync(ctx, ['boot'], KATA_ENV).then((r) => {
      assert.equal(r.status, 0, `the green kata run did not finish\n${r.stdout}${r.stderr}`)
      return ctx
    })
  }
  return KEPT
}

let DARK = null
/** The same run whose issues fetch fails from the SECOND export on. Started once. */
const dark = () => {
  if (!DARK) {
    const ctx = makeHome()
    DARK = bootAsync(ctx, ['boot'], {
      ...KATA_ENV,
      STUB_KATA_ISSUES_EXIT_FROM: '2',
      STUB_KATA_ISSUES_EXIT: '7',
    }).then((r) => {
      assert.equal(r.status, 0, `the dark-hub kata run did not finish\n${r.stdout}${r.stderr}`)
      return ctx
    })
  }
  return DARK
}

// ── reading the export's calls ───────────────────────────────────────────────

const ISSUES_URL = `${KATA_URL}/api/v1/projects/${PROJECT_ID}/issues?limit=1000`
const EVENTS_PREFIX = `${KATA_URL}/api/v1/projects/${PROJECT_ID}/events?after_id=`

/** The `after_id` of an events call, or null for any other kata URL. */
const cursorOf = (url) =>
  url.startsWith(EVENTS_PREFIX) ? url.slice(EVENTS_PREFIX.length).split('&')[0] : null

/**
 * The run's kata calls grouped into exports: one group per issues fetch,
 * holding the `after_id` of every events call that followed it. The ping, the
 * metadata patch and the close are not export calls and fall out here.
 */
const exportCursors = (ctx) => {
  const groups = []
  for (const url of kataUrls(ctx)) {
    if (url === ISSUES_URL) { groups.push([]); continue }
    const cursor = cursorOf(url)
    if (cursor !== null && groups.length) groups[groups.length - 1].push(cursor)
  }
  return groups
}

// ── leg (a) — M1: the issues of this run, and no other ───────────────────────

test('(a) [M1] the export keeps one issue line per uid the record names, in the hub\'s order', async () => {
  const ctx = await kept()
  const issues = kataJsonl(ctx).map((l) => JSON.parse(l)).filter((row) => row.kind === 'issue')

  // The hub answered four issues; three of them are this run's.
  assert.deepEqual(
    issues.map((row) => row.uid), ['T1', 'R7', 'T2'],
    '(a) [M1] the `kind: issue` lines must be exactly the run issue and the two task issues the ' +
    'record names, in the order the hub answered them',
  )
  // ONE LINE PER ISSUE, whole — the row the hub answered with `kind` in front.
  assert.deepEqual(
    issues.map((row) => JSON.stringify(row)), keptIssues.map(issueLine),
    '(a) [M1] each kept issue line must be the hub\'s row with `kind` first and its own fields after',
  )
  // And no line for any other issue the project answers.
  assert.ok(
    !issues.some((row) => row.uid === OTHER_UID),
    `(a) [M1] no issue line may carry uid ${OTHER_UID} — a sibling run's task on the same project`,
  )
  assert.ok(
    !kataJsonlRaw(ctx).includes(OTHER_UID) && !kataJsonlRaw(ctx).includes(OTHER_SHORT_ID),
    `(a) [M1] the export must not mention ${OTHER_UID} (or its short id) anywhere at all`,
  )
})

// ── leg (b) — M2: the events on those issues, in the log's order ─────────────

test('(b) [M2] the export keeps one event line per event on those issues, in the log\'s order', async () => {
  const ctx = await kept()
  const events = kataJsonl(ctx).map((l) => JSON.parse(l)).filter((row) => row.kind === 'event')

  // The hub's log ran project.created, T1, X9, R7, T2; three of those are ours,
  // and they keep the log's order — not the record's, not the issues' order.
  assert.deepEqual(
    events.map((row) => row.issue_uid), ['T1', 'R7', 'T2'],
    '(b) [M2] the `kind: event` lines must be the events on this run\'s issues, in the log\'s order',
  )
  assert.deepEqual(
    events.map((row) => JSON.stringify(row)), keptEvents.map(eventLine),
    '(b) [M2] each kept event line must be the hub\'s envelope with `kind` first and its own fields after',
  )
  // No event on another issue…
  assert.ok(
    !events.some((row) => row.issue_uid === OTHER_UID),
    `(b) [M2] no event line may be an event on ${OTHER_UID}`,
  )
  // …and no event that names no issue at all.
  assert.ok(
    !events.some((row) => row.issue_uid === undefined),
    '(b) [M2] no event line may be an event that carries no `issue_uid` — the `project.created` row',
  )
  assert.ok(
    !events.some((row) => row.type === 'project.created'),
    '(b) [M2] the project\'s own `project.created` event belongs to no issue and must not be exported',
  )
})

// ── legs (a)+(b) together — the file, whole ──────────────────────────────────

test('(a,b) [M1,M2] the exported kata.jsonl is exactly the three issues then the three events', async () => {
  const ctx = await kept()
  assert.deepEqual(
    kataJsonl(ctx), EXPECTED_LINES,
    '[M1,M2] every issue line first, then the event log, and nothing of any other run',
  )
  assert.equal(
    kataJsonlRaw(ctx), EXPECTED_LINES.map((l) => `${l}\n`).join(''),
    '[M1,M2] one compact JSON object per line, newline-terminated, and no other byte',
  )
})

// ── leg (c) — M3: the paging, and the file a failed export must not touch ────

test('(c) [M3] every export pages the events endpoint from 0, follows next_after_id, and stops', async () => {
  const ctx = await kept()
  const groups = exportCursors(ctx)
  assert.ok(groups.length >= 1, '(c) [M3] the run made no export at all')
  for (const [i, cursors] of groups.entries()) {
    assert.deepEqual(
      cursors, ['0', String(NEXT_AFTER_ID)],
      `(c) [M3] export ${i + 1} must ask the events endpoint at after_id=0, then at the ` +
      `next_after_id the first page handed back (${NEXT_AFTER_ID}), and no further`,
    )
  }
})

test('(c) [M3] an export whose issues fetch fails keeps the previous kata.jsonl byte-identical', async () => {
  const [good, bad] = await Promise.all([kept(), dark()])
  const groups = exportCursors(bad)

  // The first export got through; every later one died at its issues fetch and
  // so asked the events endpoint nothing.
  assert.ok(groups.length >= 2, '(c) [M3] the dark-hub run attempted fewer than two exports')
  assert.deepEqual(
    groups[0], ['0', String(NEXT_AFTER_ID)],
    '(c) [M3] the dark-hub run\'s FIRST export must page the events endpoint as any other export does',
  )
  for (const [i, cursors] of groups.slice(1).entries()) {
    assert.deepEqual(
      cursors, [],
      `(c) [M3] export ${i + 2} failed at its issues fetch and must ask the events endpoint nothing`,
    )
  }

  // And what it left behind is the export that succeeded, byte for byte: the
  // same bytes a run whose hub never went dark wrote for the same answers.
  const left = kataJsonlRaw(bad)
  assert.ok(left.length > 0, '(c) [M3] the failed exports left no kata.jsonl at all')
  assert.equal(
    left, kataJsonlRaw(good),
    '(c) [M3] the three failed exports must leave the first export\'s kata.jsonl exactly as it was',
  )
})

// ── leg (d) — M4: the contract's own words ───────────────────────────────────

test('(d) [M4] the CONTRACT.md kata.jsonl bullet says the run\'s issues, named by, events on them', () => {
  // The Proof's `Run:` line, verbatim — the reader the driver runs.
  const cmd =
    "sed -n '/THE HUB.S OWN RECORD/,/Exported at every/p' fleet/CONTRACT.md" +
    " | tr '\\n' ' ' | grep -q 'the run.s issues.*named by.*events on them'"
  const r = spawnSync('bash', ['-c', cmd], { cwd: ROOT, encoding: 'utf8', timeout: 60000, env: ENV })
  assert.equal(
    r.status, 0,
    '(d) [M4] the `kata.jsonl` bullet, from its `THE HUB\'S OWN RECORD` line down to its ' +
    '`Exported at every`, must carry `the run\'s issues`, then `named by`, then `events on them`' +
    `\n  $ ${cmd}\n${r.stdout || ''}${r.stderr || ''}`,
  )
})

runTests(tests)
