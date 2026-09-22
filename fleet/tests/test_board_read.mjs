/**
 * fleet/tests/test_board_read.mjs — the exam for `fleet/board-read.mjs`: one
 * laptop command that names a run and prints its tasks (state, latest note)
 * and its event timeline, read off the hub through the same ssh-curl door the
 * janitor uses, with no token on the command line (#1174, #876).
 *
 * This file is the Proof's `Test:`, written whole at the path the Proof names.
 * Every relative import is written for THIS directory: `../` is the
 * repository's `fleet/`, `./` is `fleet/tests/`.
 *
 * The Machine clauses under test, restated so a reader can map every
 * assertion back to the contract:
 *
 *   M1 — `projectBoard(events, { runs })` is pure. Over the 31-row fixture
 *        with `runs: [207]`, `tasks` is exactly three rows in order (`zdbs`
 *        `run-207`, `06tw` `task 1`, `vwnn` `task 2`); no row of `tasks` or
 *        `timeline` carries an issue outside run 207 or 206; `runs: [206,
 *        207]` gives five task rows.
 *   M2 — each `tasks` row carries `run`, `issue`, `name`, `title`, `state`,
 *        `closed`, `lastAt`, `last`, with the fixture's three rows' values
 *        pinned.
 *   M3 — `timeline` is 14 rows in feed order for `runs: [207]`, each row's
 *        shape and four pinned rows' contents.
 *   M4 — `cursor` is the last input row's `event_id` regardless of `runs`,
 *        and `null` over an empty input, alongside empty `tasks`/`timeline`.
 *   M5 — `renderBoard(projection)` renders task lines, timeline lines, the
 *        `== now` / `== events` banners in order, and a final `cursor <n>`
 *        line.
 *   M6 — `readBoard({ client, projectId, runs, since })` pages
 *        `client.events` until a short page, and answers the projection over
 *        every row read, falling back to `since` when the projection's
 *        `cursor` is `null`.
 *   M7 — `parseBoardArgs(argv)` and `main(argv, { exec, kataEnvPath, write })`:
 *        argument parsing and its refusals, and the CLI's two-request ssh
 *        round trip with no token in any argv.
 *
 * The legs, in the order they run here:
 *
 *   (a) [M1] the fixture's three-row / five-row `tasks` shape.
 *   (b) [M2] the `tasks` row fields, pinned.
 *   (c) [M3] the `timeline` rows, pinned.
 *   (d) [M4] `cursor`, and the empty-input shape.
 *   (e) [M5] `renderBoard`'s lines.
 *   (f) [M6] `readBoard`'s paging and fallback.
 *   (g) [M7] `parseBoardArgs` and `main`.
 *
 * Nothing here spawns a real process: `main`'s `exec` is a recording fake
 * answering the ssh-curl shape (`{ code, stdout: json + '\n' + status,
 * stderr }`) that `fleet/kata-client.mjs`'s `sshTransport` expects, chosen by
 * which path the remote argv element names — never a shell, never a socket.
 * The env file `main` reads lives under a `mkdtemp` of `os.tmpdir()`, and
 * `write` collects into a plain string. Assumed of the code under test: it
 * builds its client exactly as `fleet/janitor.mjs`'s `openHub` does — one ssh
 * call per hub request, the literal `$KATA_AUTH_TOKEN` in the remote and
 * never a token value in any argv element — so this exam checks that shape
 * rather than importing `sshTransport`/`makeKataClient` itself; the task names
 * `fleet/board-read.mjs` as the only module this exam may import.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

/** The deliverable, imported dynamically: a tree without it reports the
 *  ABSENT MODULE as an assertion of leg (a) rather than dying at load with
 *  no leg named at all. */
let mod = null
let importError = null
try {
  mod = await import('../board-read.mjs')
} catch (error) {
  importError = error
}
assert.ok(importError === null,
  '(a) [M1] `fleet/board-read.mjs` is importable — the module this task creates. Got: ' +
  String(importError && (importError.message || importError)))
const { projectBoard, renderBoard, readBoard, parseBoardArgs, main } = mod
for (const [name, fn] of Object.entries({ projectBoard, renderBoard, readBoard, parseBoardArgs, main })) {
  assert.equal(typeof fn, 'function', '(a) [M1] `' + name + '` is exported as a function')
}

// ══════════════════════════════════════════════════════════════════════════
// The fixture — the hub's own event shape, as given in Context, verbatim.
// ══════════════════════════════════════════════════════════════════════════

const row = (event_id, type, issue_short_id, actor, created_at, payload) =>
  ({ event_id, type, issue_short_id, actor, created_at, payload })

const FIXTURE = [
  row(100, 'issue.created', 'zdbs', 'launch', '2026-09-21T23:58:00.100Z',
    { title: 'run-207: A fold red names its fold', body: '', metadata: { run: 207, target: 'popmechanic/ultrapowers' } }),
  row(101, 'issue.created', '06tw', 'launch', '2026-09-21T23:58:04.000Z',
    { title: 'task 1: The judge reads one question', body: '', metadata: { task: '1', plan: 'p' } }),
  row(102, 'issue.metadata_updated', '06tw', 'launch', '2026-09-21T23:58:05.000Z',
    { diff: { wave: { from: null, to: 1 }, run: { from: null, to: 207 } } }),
  row(103, 'issue.linked', '06tw', 'launch', '2026-09-21T23:58:06.000Z',
    { type: 'parent', to_short_id: 'zdbs' }),
  row(104, 'issue.created', 'vwnn', 'launch', '2026-09-21T23:58:08.000Z',
    { title: 'task 2: A fold round', body: '', metadata: { task: '2', plan: 'p' } }),
  row(105, 'issue.metadata_updated', 'vwnn', 'launch', '2026-09-21T23:58:09.000Z',
    { diff: { run: { from: null, to: 207 }, wave: { from: null, to: 1 } } }),
  row(106, 'issue.created', 'g9xy', 'launch', '2026-09-21T23:58:20.000Z',
    { title: 'run-206: A Check red at base', metadata: { run: 206 } }),
  row(107, 'issue.created', 'z5hh', 'launch', '2026-09-21T23:58:21.000Z',
    { title: 'task 1: Checks at base', metadata: { task: '1', plan: 'q' } }),
  row(108, 'issue.metadata_updated', 'z5hh', 'launch', '2026-09-21T23:58:22.000Z',
    { diff: { run: { from: null, to: 206 }, wave: { from: null, to: 1 } } }),
  row(109, 'issue.metadata_updated', 'z5hh', 'factory', '2026-09-21T23:59:00.000Z',
    { diff: { 'factory.state': { from: null, to: 'dispatched' } } }),
  row(110, 'issue.metadata_updated', '06tw', 'factory', '2026-09-21T23:59:01.000Z',
    { diff: { 'factory.state': { from: null, to: 'dispatched' } } }),
  row(111, 'issue.metadata_updated', 'vwnn', 'factory', '2026-09-21T23:59:02.000Z',
    { diff: { 'factory.state': { from: null, to: 'dispatched' } } }),
  row(112, 'issue.snapshot', '06tw', 'federation', '2026-09-21T23:59:03.000Z', { snapshot: true }),
  row(113, 'issue.commented', 'vwnn', 'factory', '2026-09-22T00:01:10.000Z',
    { body: '[note]\nWrote fleet/tests/test_factory_fold_round.mjs, exam for foldRound.\nCurrently red.\nA fourth line that is not shown.' }),
  row(114, 'issue.commented', 'vwnn', 'factory', '2026-09-22T00:01:20.000Z',
    { body: '[exam-note]\nThe exam is written.' }),
  row(115, 'issue.commented', '06tw', 'factory', '2026-09-22T00:02:00.000Z',
    { body: '[note]\nWrote the judge exam.' }),
  row(116, 'issue.commented', '06tw', 'factory', '2026-09-22T00:03:00.000Z',
    { body: '[landing]\nexit 0\nALL TESTS PASSED\n\nclaim: 0.73' }),
  row(117, 'issue.metadata_updated', '06tw', 'factory', '2026-09-22T00:03:01.000Z',
    { diff: { 'factory.state': { from: 'dispatched', to: 'adopted' } } }),
  row(118, 'issue.commented', 'vwnn', 'factory', '2026-09-22T00:04:00.000Z',
    { body: '[landing]\nexit 1\nAssertionError: expected 2 got 3' }),
  row(119, 'issue.commented', 'vwnn', 'factory', '2026-09-22T00:04:30.000Z',
    { body: '[finding:minor]\nThe module stays pure.' }),
  row(120, 'issue.commented', 'vwnn', 'factory', '2026-09-22T00:05:00.000Z',
    { body: '[fold-red]\nnode fleet/tests/test_factory_fold_round.mjs exit 1' }),
  row(121, 'issue.assigned', 'vwnn', 'factory', '2026-09-22T00:05:01.000Z', { owner: 'factory' }),
  row(122, 'issue.metadata_updated', 'vwnn', 'factory', '2026-09-22T00:06:11.000Z',
    { diff: { 'factory.state': { from: 'dispatched', to: 'adopted' } } }),
  row(123, 'issue.commented', 'z5hh', 'factory', '2026-09-22T00:06:30.000Z', { body: '[landing]\nexit 0' }),
  row(124, 'issue.closed', 'z5hh', 'sandbox:run-206', '2026-09-22T00:06:40.000Z',
    { reason: 'done', message: 'run-206 task 1 done' }),
  row(125, 'issue.closed', 'g9xy', 'sandbox:run-206', '2026-09-22T00:06:41.000Z',
    { reason: 'done', message: 'run-206 done' }),
  row(126, 'issue.commented', '06tw', 'factory', '2026-09-22T00:07:00.000Z', { body: 'plain text, no bracket' }),
  row(127, 'issue.closed', '06tw', 'sandbox:run-207', '2026-09-22T00:09:00.000Z',
    { reason: 'done', message: 'run-207 task 1 done' }),
  row(128, 'issue.labeled', 'vwnn', 'exam:2@run-207', '2026-09-22T00:09:10.000Z', { label: 'needs-review' }),
  row(129, 'issue.commented', 'nrun', 'probe', '2026-09-22T00:09:20.000Z', { body: '[note]\norphan: never attributed' }),
  row(130, 'issue.metadata_updated', 'zdbs', 'janitor', '2026-09-22T00:10:00.000Z',
    { diff: { 'work.state': { from: null, to: 'failed' } } })
]
assert.equal(FIXTURE.length, 31, 'the fixture itself has 31 rows, as Context describes')

// ══════════════════════════════════════════════════════════════════════════
// (a) [M1] the fixture's `tasks` shape
// ══════════════════════════════════════════════════════════════════════════

const p207 = projectBoard(FIXTURE, { runs: [207] })

assert.deepEqual(p207.tasks.map((t) => t.issue), ['zdbs', '06tw', 'vwnn'],
  '(a) [M1] `runs: [207]`: `tasks` is exactly the three rows `zdbs`, `06tw`, `vwnn`, in ' +
  'that order; got ' + JSON.stringify(p207.tasks.map((t) => t.issue)))
assert.deepEqual(p207.tasks.map((t) => t.name), ['run-207', 'task 1', 'task 2'],
  '(a) [M1] their `name`s are `run-207`, `task 1`, `task 2` in that order; got ' +
  JSON.stringify(p207.tasks.map((t) => t.name)))
assert.equal(p207.tasks[0].title, 'A fold red names its fold',
  '(a) [M1] the `zdbs` row\'s `title` is `A fold red names its fold`; got ' +
  JSON.stringify(p207.tasks[0].title))

const strayIssues = ['z5hh', 'g9xy', 'nrun']
for (const stray of strayIssues) {
  assert.ok(!p207.tasks.some((t) => t.issue === stray),
    '(a) [M1] no `tasks` row carries issue ' + JSON.stringify(stray) + ' when `runs: [207]`')
  assert.ok(!p207.timeline.some((t) => t.issue === stray),
    '(a) [M1] no `timeline` row carries issue ' + JSON.stringify(stray) + ' when `runs: [207]`')
}

const p206207 = projectBoard(FIXTURE, { runs: [206, 207] })
assert.equal(p206207.tasks.length, 5,
  '(a) [M1] `runs: [206, 207]`: `tasks` has five rows; got ' + p206207.tasks.length)

// ══════════════════════════════════════════════════════════════════════════
// (b) [M2] the `tasks` row fields
// ══════════════════════════════════════════════════════════════════════════

const TASK_KEYS = ['run', 'issue', 'name', 'title', 'state', 'closed', 'lastAt', 'last']
for (const t of p207.tasks) {
  for (const key of TASK_KEYS) {
    assert.ok(Object.prototype.hasOwnProperty.call(t, key),
      '(b) [M2] every `tasks` row carries `' + key + '`; row ' + JSON.stringify(t.issue) + ' is ' +
      JSON.stringify(t))
  }
}

const byIssue = (list, issue) => list.find((t) => t.issue === issue)
const tw06 = byIssue(p207.tasks, '06tw')
assert.equal(tw06.state, 'adopted', '(b) [M2] `06tw`\'s `state` is `adopted`; got ' + JSON.stringify(tw06.state))
assert.equal(tw06.closed, 'done', '(b) [M2] `06tw`\'s `closed` is `done`; got ' + JSON.stringify(tw06.closed))
assert.equal(tw06.lastAt, '2026-09-22T00:09:00.000Z',
  '(b) [M2] `06tw`\'s `lastAt` is `2026-09-22T00:09:00.000Z`; got ' + JSON.stringify(tw06.lastAt))
assert.equal(tw06.last, 'closed done', '(b) [M2] `06tw`\'s `last` is `closed done`; got ' + JSON.stringify(tw06.last))

const vwnn = byIssue(p207.tasks, 'vwnn')
assert.equal(vwnn.state, 'adopted', '(b) [M2] `vwnn`\'s `state` is `adopted`; got ' + JSON.stringify(vwnn.state))
assert.equal(vwnn.closed, null, '(b) [M2] `vwnn`\'s `closed` is `null`; got ' + JSON.stringify(vwnn.closed))
assert.equal(vwnn.last, 'factory.state dispatched->adopted',
  '(b) [M2] `vwnn`\'s `last` is `factory.state dispatched->adopted`; got ' + JSON.stringify(vwnn.last))

const zdbs = byIssue(p207.tasks, 'zdbs')
assert.equal(zdbs.state, 'failed', '(b) [M2] `zdbs`\'s `state` is `failed`; got ' + JSON.stringify(zdbs.state))
assert.equal(zdbs.closed, null, '(b) [M2] `zdbs`\'s `closed` is `null`; got ' + JSON.stringify(zdbs.closed))

// ══════════════════════════════════════════════════════════════════════════
// (c) [M3] the `timeline` rows
// ══════════════════════════════════════════════════════════════════════════

assert.equal(p207.timeline.length, 14,
  '(c) [M3] `timeline` has exactly 14 rows for `runs: [207]`; got ' + p207.timeline.length)

for (let i = 1; i < p207.timeline.length; i += 1) {
  assert.ok(p207.timeline[i].eventId > p207.timeline[i - 1].eventId,
    '(c) [M3] `timeline` is in feed order — `eventId` strictly ascending; row ' + i +
    ' is ' + JSON.stringify(p207.timeline[i].eventId) + ' after ' +
    JSON.stringify(p207.timeline[i - 1].eventId))
}

const TIMELINE_KEYS = ['eventId', 'at', 'run', 'issue', 'name', 'what']
for (const key of TIMELINE_KEYS) {
  assert.ok(Object.prototype.hasOwnProperty.call(p207.timeline[0], key),
    '(c) [M3] a `timeline` row carries `' + key + '`; first row is ' + JSON.stringify(p207.timeline[0]))
}

const first = p207.timeline[0]
assert.equal(first.eventId, 110, '(c) [M3] the first `timeline` row\'s `eventId` is 110; got ' + JSON.stringify(first.eventId))
assert.equal(first.issue, '06tw', '(c) [M3] the first `timeline` row\'s `issue` is `06tw`; got ' + JSON.stringify(first.issue))
assert.equal(first.what, 'factory.state null->dispatched',
  '(c) [M3] the first `timeline` row\'s `what` is `factory.state null->dispatched`; got ' + JSON.stringify(first.what))

const ev113 = p207.timeline.find((r) => r.eventId === 113)
assert.ok(ev113, '(c) [M3] `timeline` carries a row for event 113')
assert.equal(ev113.at, '2026-09-22T00:01:10.000Z',
  '(c) [M3] event 113\'s `at` is `2026-09-22T00:01:10.000Z`; got ' + JSON.stringify(ev113.at))
assert.equal(ev113.run, 207, '(c) [M3] event 113\'s `run` is 207; got ' + JSON.stringify(ev113.run))
assert.equal(ev113.name, 'task 2', '(c) [M3] event 113\'s `name` is `task 2`; got ' + JSON.stringify(ev113.name))
assert.equal(ev113.what,
  '[note] Wrote fleet/tests/test_factory_fold_round.mjs, exam for foldRound. Currently red.',
  '(c) [M3] event 113\'s `what` is exactly the first three lines joined, trimmed; got ' + JSON.stringify(ev113.what))

const ev127 = p207.timeline.find((r) => r.eventId === 127)
assert.ok(ev127, '(c) [M3] `timeline` carries a row for event 127')
assert.equal(ev127.what, 'closed done', '(c) [M3] event 127\'s `what` is `closed done`; got ' + JSON.stringify(ev127.what))

const last = p207.timeline[p207.timeline.length - 1]
assert.equal(last.eventId, 130, '(c) [M3] the last `timeline` row\'s `eventId` is 130; got ' + JSON.stringify(last.eventId))
assert.equal(last.what, 'work.state null->failed',
  '(c) [M3] the last `timeline` row\'s `what` is `work.state null->failed`; got ' + JSON.stringify(last.what))

// ══════════════════════════════════════════════════════════════════════════
// (d) [M4] `cursor`, and the empty-input shape
// ══════════════════════════════════════════════════════════════════════════

assert.equal(p207.cursor, 130, '(d) [M4] `cursor` is 130 with `runs: [207]`; got ' + JSON.stringify(p207.cursor))
const p999 = projectBoard(FIXTURE, { runs: [999] })
assert.equal(p999.cursor, 130,
  '(d) [M4] `cursor` is the last input row\'s `event_id` (130) whatever `runs` says, even ' +
  'a `runs` matching nothing; got ' + JSON.stringify(p999.cursor))

const empty = projectBoard([], { runs: [207] })
assert.deepEqual(empty.tasks, [], '(d) [M4] over an empty input, `tasks` is `[]`; got ' + JSON.stringify(empty.tasks))
assert.deepEqual(empty.timeline, [], '(d) [M4] over an empty input, `timeline` is `[]`; got ' + JSON.stringify(empty.timeline))
assert.equal(empty.cursor, null, '(d) [M4] over an empty input, `cursor` is `null`; got ' + JSON.stringify(empty.cursor))

// ══════════════════════════════════════════════════════════════════════════
// (e) [M5] `renderBoard`'s lines
// ══════════════════════════════════════════════════════════════════════════

const rendered = renderBoard(p207)
assert.equal(typeof rendered, 'string', '(e) [M5] `renderBoard` answers a string; got ' + typeof rendered)

const TASK_LINE = /^ {2}run-207 task 1 +closed:done +last 00:09:00Z {2}The judge reads one question$/m
assert.ok(TASK_LINE.test(rendered),
  '(e) [M5] a task line matches ' + TASK_LINE + '; got:\n' + rendered)

const TIMELINE_LINE = /^ {2}00:01:10Z run-207 task 2 +\[note\] Wrote fleet\/tests\/test_factory_fold_round\.mjs, exam for foldRound\. Currently red\.$/m
assert.ok(TIMELINE_LINE.test(rendered),
  '(e) [M5] a timeline line matches ' + TIMELINE_LINE + '; got:\n' + rendered)

const nowIdx = rendered.indexOf('== now')
const eventsIdx = rendered.indexOf('== events')
assert.ok(nowIdx !== -1 && eventsIdx !== -1 && nowIdx < eventsIdx,
  '(e) [M5] the line `== now` comes before the line `== events`; got indices ' +
  JSON.stringify({ nowIdx, eventsIdx }))

const trimmedRendered = rendered.endsWith('\n') ? rendered.slice(0, -1) : rendered
const renderedLines = trimmedRendered.split('\n')
assert.equal(renderedLines[renderedLines.length - 1], 'cursor 130',
  '(e) [M5] the last line, after a trailing newline is dropped, is `cursor 130`; got ' +
  JSON.stringify(renderedLines[renderedLines.length - 1]))

// ══════════════════════════════════════════════════════════════════════════
// (f) [M6] `readBoard`'s paging and fallback
// ══════════════════════════════════════════════════════════════════════════

/** A recording `client.events`: `answer(projectId, afterId)` decides each page. */
const recordingClient = (answer) => {
  const calls = []
  return {
    calls,
    client: {
      events: async (projectId, afterId) => {
        calls.push([projectId, afterId])
        return answer(projectId, afterId)
      }
    }
  }
}

const FILLER = Array.from({ length: 1000 }, (_, i) =>
  row(i, 'project.created', null, 'seed', '2026-01-01T00:00:00.000Z', {}))

{
  const { calls, client } = recordingClient((projectId, afterId) => {
    if (afterId === 0) return { events: FILLER, next_after_id: 1000, reset_required: false }
    if (afterId === 1000) return { events: FIXTURE, next_after_id: 130, reset_required: false }
    throw new Error('unexpected afterId ' + afterId)
  })
  const answer = await readBoard({ client, projectId: 31, runs: [207], since: 0 })
  assert.deepEqual(calls, [[31, 0], [31, 1000]],
    '(f) [M6] `readBoard` pages from `after = since` (0) until a page holds fewer than ' +
    '1000 rows, following `next_after_id`; recorded calls are ' + JSON.stringify(calls))
  assert.equal(answer.tasks.length, 3,
    '(f) [M6] the answer is the projection over every row read across both pages: `tasks` ' +
    'has length 3; got ' + answer.tasks.length)
  assert.equal(answer.cursor, 130, '(f) [M6] and its `cursor` is 130; got ' + JSON.stringify(answer.cursor))
}

{
  const { calls, client } = recordingClient(() => ({ events: [], next_after_id: 500, reset_required: false }))
  const answer = await readBoard({ client, projectId: 31, runs: [207], since: 500 })
  assert.deepEqual(calls, [[31, 500]],
    '(f) [M6] `since: 500` against an immediately-short page: exactly one call, `[[31, 500]]`; ' +
    'got ' + JSON.stringify(calls))
  assert.deepEqual(answer.tasks, [], '(f) [M6] `tasks` is `[]`; got ' + JSON.stringify(answer.tasks))
  assert.equal(answer.cursor, 500,
    '(f) [M6] `cursor` falls back to `since` (500) when the projection\'s own cursor is ' +
    '`null`; got ' + JSON.stringify(answer.cursor))
}

// ══════════════════════════════════════════════════════════════════════════
// (g) [M7] `parseBoardArgs` and `main`
// ══════════════════════════════════════════════════════════════════════════

assert.deepEqual(
  parseBoardArgs(['--run', '207', '--run', '208', '--target', 'o/r', '--since', '12', '--json']),
  { runs: [207, 208], target: 'o/r', since: 12, json: true },
  '(g) [M7] the five-flag argv parses to `{ runs: [207, 208], target: \'o/r\', since: 12, json: true }`')

const assertBoardRefusal = (thunk, why) => {
  let threw = null
  try { thunk() } catch (error) { threw = error }
  assert.ok(threw, '(g) [M7] ' + why + ': throws')
  assert.ok(String(threw && threw.message).startsWith('board-read:'),
    '(g) [M7] ' + why + ': message begins `board-read:`; got ' + JSON.stringify(threw && threw.message))
}

assertBoardRefusal(() => parseBoardArgs(['--target', 'o/r']), 'a missing `--run`')
assertBoardRefusal(() => parseBoardArgs(['--run', '207']), 'a missing `--target`')
assertBoardRefusal(() => parseBoardArgs(['--run', 'abc', '--target', 'o/r']),
  'a `--run` that is not a positive integer')
assertBoardRefusal(() => parseBoardArgs(['--run', '207', '--target', 'o/r', '--since', '-1']),
  'a `--since` that is not a non-negative integer')

assert.equal(parseBoardArgs(['--run', '207', '--target', 'o/r']).since, 0,
  '(g) [M7] `since` defaults to `0` with none given')

/** `main`'s `exec`: a recording fake in the ssh-curl shape `sshTransport`
 *  expects, chosen by which path the remote (the last argv element) names. */
const makeMainExec = ({ projectsAnswer, eventsAnswer }) => {
  const calls = []
  const exec = async (cmd, argv) => {
    calls.push({ cmd, argv })
    const remote = argv[argv.length - 1]
    const answer = String(remote).includes('/api/v1/projects?limit=1000')
      ? projectsAnswer
      : eventsAnswer
    return { code: 0, stdout: JSON.stringify(answer) + '\n200', stderr: '' }
  }
  return { calls, exec }
}

const writeKataEnv = async (lines) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'board-read-exam-'))
  const file = path.join(dir, 'kata-hub.env')
  await fs.writeFile(file, lines, 'utf8')
  return file
}

const PROJECTS_ANSWER = { projects: [{ id: 31, uid: 'P', name: 'popmechanic-ultrapowers' }] }
const EVENTS_ANSWER = { events: FIXTURE, next_after_id: 130, reset_required: false }

{
  const kataEnvPath = await writeKataEnv('KATA_URL=https://hub.example\nKATA_TOKEN=deadbeefcafe\n')
  const { calls, exec } = makeMainExec({ projectsAnswer: PROJECTS_ANSWER, eventsAnswer: EVENTS_ANSWER })
  let written = ''
  const write = (s) => { written += s }
  await main(['--run', '207', '--target', 'popmechanic/ultrapowers'], { exec, kataEnvPath, write })

  assert.equal(calls.length, 2,
    '(g) [M7] `main` made exactly two `exec` calls (list projects, then read events); got ' + calls.length)
  for (const call of calls) {
    assert.equal(call.cmd, 'ssh', '(g) [M7] every call\'s `cmd` is `ssh`; got ' + JSON.stringify(call.cmd))
    assert.ok(call.argv.includes('hub.example'),
      '(g) [M7] every call\'s `argv` includes the host `hub.example`; got ' + JSON.stringify(call.argv))
    const remote = call.argv[call.argv.length - 1]
    assert.ok(remote.includes('. /etc/kata/kata.env'),
      '(g) [M7] the remote sources `/etc/kata/kata.env`, the janitor\'s own door; got ' + JSON.stringify(remote))
    assert.ok(remote.includes('Authorization: Bearer $KATA_AUTH_TOKEN'),
      '(g) [M7] the remote carries the literal `$KATA_AUTH_TOKEN`, never a value; got ' + JSON.stringify(remote))
    assert.ok(remote.includes('-X GET'), '(g) [M7] the remote is a GET; got ' + JSON.stringify(remote))
    for (const arg of call.argv) {
      assert.ok(!String(arg).includes('deadbeefcafe'),
        '(g) [M7] no argv element of any call carries the bearer\'s value; got ' + JSON.stringify(call.argv))
    }
  }
  assert.ok(calls[0].argv[calls[0].argv.length - 1].includes('/api/v1/projects?limit=1000'),
    '(g) [M7] the first remote lists the projects; got ' + JSON.stringify(calls[0].argv[calls[0].argv.length - 1]))
  assert.ok(calls[1].argv[calls[1].argv.length - 1].includes('/api/v1/projects/31/events?after_id=0&limit=1000'),
    '(g) [M7] the second remote reads project 31\'s feed from `after_id=0`; got ' +
    JSON.stringify(calls[1].argv[calls[1].argv.length - 1]))

  assert.ok(TASK_LINE.test(written), '(g) [M7] the written text matches leg (e)\'s task-line pattern; got:\n' + written)
  assert.ok(TIMELINE_LINE.test(written), '(g) [M7] the written text matches leg (e)\'s timeline-line pattern; got:\n' + written)
  assert.ok(written.endsWith('cursor 130\n'),
    '(g) [M7] the written text ends `cursor 130\\n`; got ' + JSON.stringify(written.slice(-20)))
}

{
  const kataEnvPath = await writeKataEnv('KATA_URL=https://hub.example\nKATA_TOKEN=deadbeefcafe\n')
  const { exec } = makeMainExec({ projectsAnswer: PROJECTS_ANSWER, eventsAnswer: EVENTS_ANSWER })
  let written = ''
  const write = (s) => { written += s }
  await main(['--run', '207', '--target', 'popmechanic/ultrapowers', '--json'], { exec, kataEnvPath, write })
  const parsed = JSON.parse(written)
  assert.equal(parsed.tasks.length, 3,
    '(g) [M7] `--json` writes `JSON.stringify(projection, null, 2)`: parsed `tasks` has length 3; got ' +
    (parsed.tasks && parsed.tasks.length))
  assert.equal(parsed.cursor, 130, '(g) [M7] and parsed `cursor` is 130; got ' + JSON.stringify(parsed.cursor))
}

{
  const kataEnvPath = await writeKataEnv('KATA_URL=https://hub.example\nKATA_TOKEN=deadbeefcafe\n')
  const { calls, exec } = makeMainExec({ projectsAnswer: PROJECTS_ANSWER, eventsAnswer: EVENTS_ANSWER })
  let rejection = null
  try {
    await main(['--run', '207', '--target', 'nobody/nothing'], { exec, kataEnvPath, write: () => {} })
  } catch (error) {
    rejection = error
  }
  assert.ok(rejection, '(g) [M7] a `--target` the listing does not hold: `main` rejects')
  assert.ok(String(rejection && rejection.message).startsWith('board-read:'),
    '(g) [M7] its message begins `board-read:`; got ' + JSON.stringify(rejection && rejection.message))
  assert.equal(calls.length, 1,
    '(g) [M7] and exactly one `exec` call was made (the listing, never the feed); got ' + calls.length)
}

{
  const missingEnvPath = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'board-read-exam-')), 'nope', 'kata-hub.env')
  let rejection = null
  try {
    await main(['--run', '207', '--target', 'o/r'], { exec: async () => { throw new Error('must not be called') }, kataEnvPath: missingEnvPath, write: () => {} })
  } catch (error) {
    rejection = error
  }
  assert.ok(rejection, '(g) [M7] an env file that cannot be read: `main` rejects')
  assert.ok(String(rejection && rejection.message).startsWith('board-read:'),
    '(g) [M7] its message begins `board-read:`; got ' + JSON.stringify(rejection && rejection.message))
  assert.ok(String(rejection && rejection.message).includes(missingEnvPath),
    '(g) [M7] and names the path it tried; got ' + JSON.stringify(rejection && rejection.message))
}

{
  const noHostEnvPath = await writeKataEnv('KATA_URL=not-a-url\nKATA_TOKEN=deadbeefcafe\n')
  let rejection = null
  try {
    await main(['--run', '207', '--target', 'o/r'], { exec: async () => { throw new Error('must not be called') }, kataEnvPath: noHostEnvPath, write: () => {} })
  } catch (error) {
    rejection = error
  }
  assert.ok(rejection, '(g) [M7] an env file naming no host: `main` rejects')
  assert.ok(String(rejection && rejection.message).startsWith('board-read:'),
    '(g) [M7] its message begins `board-read:`; got ' + JSON.stringify(rejection && rejection.message))
}

console.log('ALL TESTS PASSED')
