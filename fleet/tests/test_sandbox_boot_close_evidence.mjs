// fleet/tests/test_sandbox_boot_close_evidence.mjs — the boot's `done` close of
// the run issue always carries evidence (#1026, kata-close-evidence task 2).
//
// kata v0.17.2 refuses a `reason: done` close whose `evidence` is empty
// (`evidence required for reason=done`, #1023). The boot's `kata_close_run`
// builds its evidence from the PR URL and the merged sha, so the three shapes a
// run can end in are read here, each from one boot of the rig:
//
//   GREEN   the sandbox merged: evidence is [pr, commit] in that order     [M1]
//   OPEN    the merge PUT was refused (422), the PR left open: [pr]          [M2]
//   MUTANT  neither in hand: the shipped script reaches that state only past
//           its publish guard (`answered $code with no html_url` fails a run
//           whose PR answer carries no URL), so this boot runs a COPY of the
//           script with exactly that one line removed, the PR answer carrying
//           no `html_url` anywhere, and reads the close the SHIPPED function
//           sends: [commit <the integration branch's tip>], never []       [M3]
//
// A boot is ~40 forks of stub shell, so each of the three is started once and
// shared by every leg that reads it. The mutated copy lives under the case's
// own home — not a sibling sim (test_sims_are_hermetic M4).
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import {
  SCRIPT, KATA_URL, PR_JSON, PR_URL, MERGE_SHA, HEAD_SHA,
  makeHome, bootAsync, kataCloses, statusOf,
  runTests,
} from './_sandbox_boot_helpers.mjs'

const tests = []
const test = (name, fn) => tests.push([name, fn])

// ── the run's kata record, so the boot closes at all ─────────────────────────

const PROJECT_ID = 12
const RUN_UID = 'R7'
const TASK_UIDS = { 1: 'T1', 2: 'T2' }
const KATA_RECORD = `${JSON.stringify({
  url: KATA_URL,
  project: { id: PROJECT_ID, uid: 'P7', name: 'popmechanic-smoke' },
  run: { uid: RUN_UID, revision: 1 },
  tasks: {
    1: { uid: TASK_UIDS[1], short_id: 'ab12', revision: 1 },
    2: { uid: TASK_UIDS[2], short_id: 'gh78', revision: 1 },
  },
}, null, 2)}\n`
const ISSUE_ROWS = [
  { id: 41, uid: TASK_UIDS[1], short_id: 'ab12', title: 'Task 1', status: 'closed' },
  { id: 40, uid: RUN_UID, short_id: 'cd34', title: 'Run 7', status: 'open' },
  { id: 42, uid: TASK_UIDS[2], short_id: 'gh78', title: 'Task 2', status: 'closed' },
]
const EVENT_ROWS = [
  { event_id: 1, event_uid: 'EV1', type: 'project.created', project_id: PROJECT_ID, actor: 'laptop:ultra', payload: {} },
  { event_id: 2, event_uid: 'EV2', type: 'issue.created', project_id: PROJECT_ID, issue_id: 41, issue_uid: TASK_UIDS[1], issue_short_id: 'ab12', actor: 'laptop:ultra', payload: {} },
]
const KATA_ENV = {
  STUB_KATA_JSON: KATA_RECORD,
  STUB_KATA_ISSUES: JSON.stringify({ issues: ISSUE_ROWS }),
  STUB_KATA_EVENTS: JSON.stringify({ events: EVENT_ROWS, next_after_id: 2, reset_required: false }),
}

/** PR_JSON with every `html_url` field removed — `json_field` is first-match,
 *  so the user object's `html_url` has to go too or the boot reads it as the PR. */
const stripHtmlUrl = (v) => {
  if (Array.isArray(v)) return v.map(stripHtmlUrl)
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).filter(([k]) => k !== 'html_url').map(([k, x]) => [k, stripHtmlUrl(x)]))
  }
  return v
}
const PR_JSON_NO_URL = JSON.stringify(stripHtmlUrl(JSON.parse(PR_JSON)))
assert.ok(!PR_JSON_NO_URL.includes('html_url'), 'the mutant PR body carries no html_url anywhere')

/** The publish guard: the one line of the shipped script the mutant loses. */
const GUARD = '/pulls answered $code with no html_url'

const started = new Map()
const once = (label, start) => {
  if (!started.has(label)) started.set(label, start())
  return started.get(label)
}

const green = () => once('green', async () => {
  const ctx = makeHome()
  const r = await bootAsync(ctx, ['boot'], KATA_ENV)
  assert.equal(r.status, 0, `the green run did not finish\n${r.stdout}${r.stderr}`)
  return ctx
})

const open = () => once('open', async () => {
  const ctx = makeHome()
  const r = await bootAsync(ctx, ['boot'], { ...KATA_ENV, STUB_MERGE_CODE: '422' })
  assert.equal(r.status, 0, `the left-open run did not finish\n${r.stdout}${r.stderr}`)
  return ctx
})

const mutant = () => once('mutant', async () => {
  const ctx = makeHome()
  const shipped = fs.readFileSync(SCRIPT, 'utf8').split('\n')
  const hits = shipped.filter((l) => l.includes(GUARD))
  assert.equal(hits.length, 1,
    `(c) [M3] exactly one line of the shipped script contains \`${GUARD}\` — got ${hits.length}`)
  const at = shipped.findIndex((l) => l.includes(GUARD))
  const copyLines = shipped.slice(0, at).concat(shipped.slice(at + 1))
  assert.equal(copyLines.length, shipped.length - 1, '(c) [M3] the copy is the shipped line count minus one')
  for (let i = 0; i < copyLines.length; i += 1) {
    assert.equal(copyLines[i], shipped[i < at ? i : i + 1], `(c) [M3] copy line ${i + 1} is the shipped line, in order`)
  }
  const copy = path.join(ctx.home, 'sandbox-boot.mutant.sh')
  fs.writeFileSync(copy, copyLines.join('\n'))
  const r = await bootAsync(ctx, ['boot'], { ...KATA_ENV, STUB_PR_BODY: PR_JSON_NO_URL }, copy)
  assert.equal(r.status, 0, `the mutant run did not finish\n${r.stdout}${r.stderr}`)
  return ctx
})

const theClose = (ctx, label) => {
  const closes = kataCloses(ctx)
  assert.equal(closes.length, 1, `${label}: exactly one close of the run issue — got ${closes.length}`)
  return closes[0]
}

test('(a) [M1] the green run closes done with [pr, commit] in that order', async () => {
  const c = theClose(await green(), '(a) [M1] green')
  assert.equal(c.reason, 'done')
  assert.deepEqual(c.evidence, [{ type: 'pr', url: PR_URL }, { type: 'commit', sha: MERGE_SHA }],
    `(a) [M1] evidence is the PR then the merge sha — got ${JSON.stringify(c.evidence)}`)
})

test('(b) [M2] the left-open run closes done with [pr]', async () => {
  const ctx = await open()
  const s = statusOf(ctx)
  assert.equal(s.state, 'done', `(b) [M2] state done — got ${s.state}`)
  assert.equal(s.merged, null, `(b) [M2] merged null — got ${JSON.stringify(s.merged)}`)
  const c = theClose(ctx, '(b) [M2] left-open')
  assert.deepEqual(c.evidence, [{ type: 'pr', url: PR_URL }],
    `(b) [M2] evidence is the PR alone — got ${JSON.stringify(c.evidence)}`)
})

test('(c) [M3] with neither PR URL nor merged sha the shipped close carries the branch tip, never []', async () => {
  const ctx = await mutant()
  const s = statusOf(ctx)
  assert.equal(s.pr, null, `(c) [M3] pr null — got ${JSON.stringify(s.pr)}`)
  assert.equal(s.merged, null, `(c) [M3] merged null — got ${JSON.stringify(s.merged)}`)
  const c = theClose(ctx, '(c) [M3] mutant')
  assert.deepEqual(c.evidence, [{ type: 'commit', sha: HEAD_SHA }],
    `(c) [M3] evidence is the integration branch's tip as a commit entry — read ${JSON.stringify(c.evidence)}`)
})

test('(d) [M3] every close carries close-v1, a 40+ character message, reason done and evidence', async () => {
  for (const [label, get] of [['green', green], ['left-open', open], ['mutant', mutant]]) {
    const c = theClose(await get(), `(d) [M3] ${label}`)
    assert.equal(c.retry_protocol, 'close-v1', `(d) [M3] ${label}: retry_protocol`)
    assert.ok(String(c.message).length >= 40, `(d) [M3] ${label}: message.length ${String(c.message).length} < 40`)
    assert.equal(c.reason, 'done', `(d) [M3] ${label}: reason`)
    assert.ok(Array.isArray(c.evidence) && c.evidence.length >= 1, `(d) [M3] ${label}: evidence ${JSON.stringify(c.evidence)}`)
  }
})

runTests(tests)
