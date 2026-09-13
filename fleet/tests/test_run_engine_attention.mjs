// fleet/tests/test_run_engine_attention.mjs — the exam for Task 4:
// "The driver reads the worker's hand and posts the review where the fix will
// look".
//
// This file is the Proof's `Test: fleet/tests/test_run_engine_attention.mjs`,
// and it is written FOR that path: `../` is the repository's `fleet/`, `./` is
// `fleet/tests/`.
//
// Everything below the agent seam is real, as in the sibling engine sims: real
// git repositories, real `cloneAtBase` clones, the real capture, the real `sh`,
// the real fold kernel through the real `execSeam`. Only the judgments are
// canned — and `kata`, the hub seam. The engine rig is a COPY of
// `_engine_helpers.rig`'s body with two additions (`kata` and `eventLog` passed
// through to `runEngine`), because that helper is not in this task's Files and
// this exam never edits `test_run_engine_kata.mjs` either. The boot rig is
// `_sandbox_boot_helpers.mjs` as it stands, driven exactly as
// `test_sandbox_boot_viz.mjs` drives the `project` verb.
//
// The Machine clauses, restated, and where each is read:
//
//   M1  While a task's worker runs the engine polls that task's issue metadata
//       every `ATTENTION_POLL_MS` (default 15000, an engine option) and, on
//       each change of `work.attention` to `stuck` / `needs-human` / back to
//       `ok`, appends ONE `driver:attention` event `{task, attention, msg,
//       actor}` — `msg` from `work.attention_msg`, `actor` from the metadata
//       event's actor when the client exposes it, else `''`. An unchanged
//       value appends nothing; a hub read that fails appends nothing and does
//       not end the run.                                          → leg (a)
//   M2  Before each fix round's worker is dispatched the engine posts ONE
//       comment on the task's issue whose body begins `review round <n>:`
//       followed by the blocking findings the fix prompt carries, one per
//       line, through the non-fatal write path; a refused post is one
//       `kata:write-failed` and the fix round still runs.          → leg (b)
//   M3  `sandbox-boot.sh`'s status projection writes, per task cell,
//       `attention: {value, msg, ts}` from that task's latest `driver:attention`
//       event (`null` when none), beside `state`, `role`, `lastProof` and
//       `park`.                                                    → leg (c)
//   M4  `fleet/CONTRACT.md`'s status-cell sentence names the `attention` cell
//       and the kata bullet names the `driver:attention` event and the
//       `review round <n>:` comment.                               → leg (d)
//
// Every assertion below names its leg and its clause.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { execSeam } from '../run-main.mjs'
import { makeCwdFor, withPatchCapture, defaultTaskIdOf, makeEventLog } from '../run-waves.mjs'
import { runEngine } from '../run-engine.mjs'
import { makeRepo, provision, passReview, doneImpl } from './_engine_helpers.mjs'
import {
  makeHome, boot, lines as splitLines,
} from './_sandbox_boot_helpers.mjs'

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'engine-attention-')))
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }))

const sleep = (ms) => new Promise((resolve) => { globalThis.setTimeout(resolve, ms) })

// ── reading what a run left behind ─────────────────────────────────────────
// An absent events file reads as no records, so an engine that appends none
// fails an assertion rather than throwing ENOENT.
const eventLines = (runDir) => {
  const file = path.join(runDir, 'events.jsonl')
  if (!fs.existsSync(file)) return []
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
}
const parseLine = (l) => { try { return JSON.parse(l) } catch { return null } }
const eventsOf = (runDir) => eventLines(runDir).map(parseLine).filter(Boolean)
const kindOf = (runDir, kind) => eventsOf(runDir).filter((e) => e.kind === kind)
/** The four fields M1 names, in M1's order — the shape an assertion compares. */
const attentionShape = (e) => ({ task: e.task, attention: e.attention, msg: e.msg, actor: e.actor })

// ══ the fixtures ═══════════════════════════════════════════════════════════
// The record `fleet/launch.mjs` writes: the project, the run issue, and one
// issue per task with the revision the launcher last saw.
const recordFor = (tasks) => ({
  url: 'https://kata.int.exe.xyz',
  project: { id: 7, uid: 'PROJ0', name: 'ultra-sim' },
  run: { uid: 'RUN0', revision: 1 },
  tasks,
})

// The fact sheet the hub answers for T1. The exam lands at its own Proof path
// (it is a guard), so the exam command the examiner is handed is the task's,
// unremapped, and nothing here depends on `reservedExamPath`.
const SHEET = {
  files: ['one.txt', 'fixed.txt'],
  proofTests: ['tests/test_x.py'],
  guards: ['tests/test_x.py'],
  landing: { 'tests/test_x.py': 'tests/test_x.py' },
  driverOwned: ['tests/test_x.py'],
}

const TASK_BODY = '**Claim:** the tree gains one.txt\n' +
  'Machine: M1. The tree holds `one.txt`.\n\n**Proof:**\n- Test: `tests/test_x.py`\n' +
  '- Legs: (a) `one.txt` exists [M1]'
const entry = (over = {}) => ({
  id: 'T1', title: 'create one', files: ['one.txt'], tier: 'standard', review: 'lean',
  writes: ['one.txt'], commutes: [], proofRuns: [],
  testCmd: 'bash tests/test_x.py',
  proofTests: ['tests/test_x.py'],
  body: TASK_BODY,
  ...over,
})

// Two exams the peer may write. Bash, so the `.py` landing runs with no python
// on the box. `NEEDS_FIXED` is red until a fix round writes `fixed.txt` — which
// is how leg (b) gets a pre-review red without touching the wave suite.
const NEEDS_ONE = '#!/bin/bash\n[ -f one.txt ]\n'
const NEEDS_FIXED = '#!/bin/bash\n[ -f fixed.txt ]\n'

// The actor the hub's metadata event carried. M1 takes it "from the metadata
// event's actor when the client exposes it" and leaves the field the value the
// client handed over — so what this exam pins is the VALUE the event carries,
// not the key the answer happened to spell it in: the stub exposes the same
// string under every plausible spelling, and the no-actor pass exposes none.
const ACTOR = 'impl:1@run-x'
const withActor = (issue) => ({
  ...issue,
  actor: ACTOR,
  metadata_actor: ACTOR,
  updated_by: ACTOR,
  metadata: {
    ...issue.metadata,
    work: { ...((issue.metadata || {}).work || {}), attention_actor: ACTOR },
  },
})

// The three flips leg (a) drives, in order, with the message each carries in
// `work.attention_msg`.
const FLIPS = [
  { at: 120, attention: 'stuck', msg: 'no async API' },
  { at: 260, attention: 'needs-human', msg: 'a human must decide the shape' },
  { at: 400, attention: 'ok', msg: 'resolved — carrying on' },
]
const WORKER_MS = 600

// ══ the fake kata ══════════════════════════════════════════════════════════
// An in-memory object with the client's method names: a store of issues by uid,
// a `calls` array in order, `getIssue` answering the stored revision and
// metadata, and every mutation bumping the revision and answering it.
class FakeKataError extends Error {
  constructor (status, method, p, body) {
    super('kata ' + method + ' ' + p + ' failed: ' + status + ' ' + body)
    this.name = 'KataError'
    this.status = status
    this.method = method
    this.path = p
    this.body = body
  }
}
const POLL_BOOM = 'kata-poll-boom'
const COMMENT_BOOM = 'kata-review-round-boom'

function makeFakeKata ({ record, issues, trace = [], exposeActor = false,
                         pollsThrow = false, failNthRead = 0, refuseReviewRound = false }) {
  const calls = []
  const store = new Map()
  for (const [uid, iss] of Object.entries(issues)) {
    store.set(uid, { uid, revision: iss.revision, metadata: iss.metadata || {},
                     owner: null, status: 'open' })
  }
  const need = (uid) => {
    const iss = store.get(uid)
    if (!iss) throw new Error('fake kata: no issue ' + JSON.stringify(uid) +
      ' — the run asked for an issue the record does not name')
    return iss
  }
  let reads = 0
  const kata = {
    async getIssue (uid) {
      const iss = need(uid)
      reads += 1
      calls.push({ method: 'getIssue', uid, revision: iss.revision, nth: reads })
      trace.push('kata:getIssue:' + uid)
      // The FIRST read is the fact-sheet read at the start of the task's
      // pipeline, which the engine already treats as fatal when it disagrees
      // with the record; only the POLLS are refused, so leg (a)'s failing-read
      // case is a failing poll and not a failing dispatch.
      if ((pollsThrow && reads > 1) || reads === failNthRead) {
        throw new FakeKataError(503, 'GET', '/api/v1/issues/' + uid, POLL_BOOM)
      }
      const answer = { uid, revision: iss.revision, metadata: iss.metadata, status: iss.status,
                       owner: iss.owner, project_id: record.project.id }
      return exposeActor ? withActor(answer) : answer
    },
    async claim (projectId, uid) {
      const iss = need(uid)
      iss.owner = 'engine'
      iss.revision += 1
      calls.push({ method: 'claim', projectId, uid, revision: iss.revision })
      trace.push('kata:claim:' + uid)
      return { uid, revision: iss.revision }
    },
    async patchMetadata (projectId, uid, patch, revision) {
      const iss = need(uid)
      calls.push({ method: 'patchMetadata', projectId, uid, patch, revision })
      trace.push('kata:patchMetadata:' + uid)
      iss.metadata = { ...iss.metadata, ...patch }
      iss.revision += 1
      return { uid, revision: iss.revision }
    },
    async comment (projectId, uid, body) {
      calls.push({ method: 'comment', projectId, uid, body })
      trace.push('kata:comment:' + uid)
      if (refuseReviewRound && String(body).startsWith('review round')) {
        throw new FakeKataError(500, 'POST',
          '/api/v1/projects/' + projectId + '/issues/' + uid + '/comments', COMMENT_BOOM)
      }
      const iss = need(uid)
      iss.revision += 1
      return { uid, revision: iss.revision }
    },
    async close (projectId, uid, opts) {
      const iss = need(uid)
      calls.push({ method: 'close', projectId, uid, opts })
      trace.push('kata:close:' + uid)
      iss.status = 'closed'
      iss.revision += 1
      return { uid, revision: iss.revision }
    },
  }
  return { kata, calls, trace, store, of: (m) => calls.filter((c) => c.method === m) }
}

/** What a worker writes into `work.attention` — the coordinator only reads it. */
const setAttention = (fake, uid, attention, msg) => {
  const iss = fake.store.get(uid)
  iss.metadata = {
    ...iss.metadata,
    work: { ...(iss.metadata.work || {}), attention, attention_msg: msg },
  }
  // A metadata write on the hub moves the issue's revision. The polls read past
  // it: the revision rule is the fact sheet's, at dispatch, and a worker
  // raising its hand is not a disagreement about what this run is.
  iss.revision += 1
}

// ══ the rig ════════════════════════════════════════════════════════════════
// `_engine_helpers.rig`'s body, copied here (that module is not in this task's
// Files) with `kata` and `eventLog` passed through when the scenario supplies
// them, and nothing passed when it does not.
function attentionRig ({ repo, runDir, waves, stub, testCmd = 'bash check.sh',
                         acceptance = { mode: 'suite', reason: 'sim' }, stamp = 'sim',
                         kata = null, extraArgs = {}, eventLog = null }) {
  const taskIds = waves.flat().map((t) => t.id)
  const { base, clonesDir, patchesDir, integ } = provision({ repo, runDir, taskIds })
  const patchBase = { current: base }
  const cwdFor = makeCwdFor({ clonesDir })
  const inner = async (prompt, opts) => stub(prompt, opts, cwdFor(opts))
  const agent = withPatchCapture({
    agent: inner, clonesDir, base: () => patchBase.current, patchesDir,
    taskIdOf: defaultTaskIdOf,
  })
  const logs = []
  const phases = []
  const run = () => runEngine({
    args: {
      waves, edges: [], testCmd, acceptance, stamp,
      integrationBranch: 'ultra/integration-' + stamp,
      dependencyEdges: [],
      patchInput: patchesDir,
      ...extraArgs,
    },
    agent,
    parallel: (thunks) => Promise.all(thunks.map((t) => t())),
    exec: execSeam,
    paths: { repoDir: repo, runDir, clonesDir },
    log: (l) => logs.push(String(l)),
    phase: eventLog ? eventLog.phase : (p) => phases.push(String(p)),
    patchBase,
    ...(kata ? { kata } : {}),
    ...(eventLog ? { eventLog } : {}),
  })
  return { run, base, clonesDir, patchesDir, integ, logs, phases, patchBase }
}

/** Every test path the driver named in the prompt's TEST COMMAND line. */
const examPathsIn = (prompt) => {
  const line = String(prompt).split('\n').filter((l) => l.startsWith('TEST COMMAND: '))[0] || ''
  return (line.match(/(?:fleet\/)?tests\/[\w./-]+/g) || [])
}
/** The examiner reads its landings out of the TEST COMMAND line, as the model
 *  does — a stub that wrote a path this file already knows would prove nothing. */
const writeExamFromCommand = (cwd, prompt, body) => {
  const wrote = []
  for (const p of examPathsIn(prompt)) {
    const dest = path.resolve(cwd, p)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.writeFileSync(dest, body)
    wrote.push(p)
  }
  assert.ok(wrote.length > 0,
    'the examiner was handed a TEST COMMAND naming at least one test path; got: ' +
    JSON.stringify(String(prompt).split('\n').filter((l) => l.startsWith('TEST COMMAND: '))))
  return { status: 'DONE', summary: 'exam written at ' + wrote.join(', ') }
}

let seq = 0
/**
 * One engine run with a fake kata behind it. Answers the report (or the error),
 * the fake's calls, the prompts by label, the labels in dispatch order and the
 * run tree.
 */
async function scenario ({ waves, sheets, stamp = 'sim', examBody = NEEDS_ONE,
                           onImpl, onFix, reviews, extraArgs = {},
                           exposeActor = false, pollsThrow = false, failNthRead = 0,
                           refuseReviewRound = false, kataTasks = null, withLog = false }) {
  seq += 1
  const repo = makeRepo(path.join(tmp, 'repo-' + seq))
  const runDir = path.join(tmp, 'run-' + seq)
  const ids = waves.flat().map((t) => t.id)
  const rows = kataTasks === null
    ? Object.fromEntries(ids.map((id) => [id, { uid: 'U-' + id, revision: 1 }]))
    : kataTasks
  const record = recordFor(rows)
  const issues = { RUN0: { revision: 1, metadata: {} } }
  for (const id of ids) {
    issues['U-' + id] = {
      revision: 1,
      metadata: {
        ...((sheets && sheets[id]) ? { factsheet: sheets[id] } : {}),
        // The baseline every task opens at: `ok`, with no message. A poll that
        // reads it back unchanged is not a change (M1) and appends nothing.
        work: { attention: 'ok', attention_msg: '' },
      },
    }
  }
  const trace = []
  const fake = makeFakeKata({ record, issues, trace, exposeActor, pollsThrow, failNthRead,
                              refuseReviewRound })
  const labels = []
  const prompts = {}
  let reviewCount = 0
  const eventLog = withLog
    ? makeEventLog({ file: path.join(runDir, 'events.jsonl'), runId: stamp, base: '', source: 'sim' })
    : null
  const judge = async (prompt, opts, cwd) => {
    const kind = opts.label.split(':')[0]
    if (kind === 'exam') return writeExamFromCommand(cwd, prompt, examBody)
    if (kind === 'impl') return onImpl(cwd, opts, fake)
    if (kind === 'fix') return (onFix || ((c) => doneImpl(c)))(cwd, opts)
    if (kind === 'review') { reviewCount += 1; return (reviews || passReview)(reviewCount) }
    if (kind === 'reconcile') return { status: 'BLOCKED', summary: 'not fixable here' }
    if (opts.label === 'integration') return { findings: [], deferredVerification: [] }
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const stub = async (prompt, opts, cwd) => {
    labels.push(opts.label)
    prompts[opts.label] = prompt
    trace.push('agent:' + opts.label)
    if (eventLog) {
      eventLog.onEvent({ kind: 'worker:start', label: opts.label, role: opts.label.split(':')[0] })
    }
    const reply = await judge(prompt, opts, cwd)
    if (eventLog) {
      eventLog.onEvent({ kind: 'worker:end', label: opts.label, exitCode: 0, timedOut: false,
                         meter: null })
    }
    return reply
  }
  const rigged = attentionRig({
    repo, runDir, waves, stub, stamp,
    kata: fake.kata,
    extraArgs: { kataRecord: record, ...extraArgs },
    ...(eventLog ? { eventLog } : {}),
  })
  let report = null
  let error = null
  try {
    report = await rigged.run()
  } catch (e) {
    error = e
  }
  if (error) {
    assert.fail('the run was expected to finish and threw instead: ' +
      String((error && error.stack) || error))
  }
  return { report, fake, record, trace, labels, prompts, runDir, repo,
           integ: rigged.integ, logs: rigged.logs }
}

/** An implementer that writes `one.txt`, flips the hand on the way, and holds
 *  the worker open for `WORKER_MS` so the driver's timer has polls to make. */
const raisesItsHand = (flips = FLIPS, ms = WORKER_MS) => async (cwd, opts, fake) => {
  fs.writeFileSync(path.join(cwd, 'one.txt'), 'from T1\n')
  for (const f of flips) {
    globalThis.setTimeout(() => setAttention(fake, 'U-T1', f.attention, f.msg), f.at)
  }
  await sleep(ms)
  return doneImpl(cwd)
}

// ══ (a) [M1] the hand, polled and recorded ═════════════════════════════════
// The poll is set to 50 ms, the worker holds for 600 ms and the three flips
// land at 120/260/400 ms — every flip has several polls of its own before the
// next one, and the last has 200 ms before the worker exits.
{
  const run = await scenario({
    waves: [[entry()]],
    sheets: { T1: SHEET },
    extraArgs: { attentionPollMs: 50 },
    exposeActor: true,
    onImpl: raisesItsHand(),
  })
  const row = run.report.tasks.find((r) => r.task === 'T1')
  assert.ok(row, '(a) [M1] the run produced a row for T1')
  assert.equal(row.status, 'done',
    '(a) [M1] a task whose worker raised its hand still lands: ' + row.reviewVerdict + ' — ' +
    row.notes + '\njudgment calls: ' + JSON.stringify(run.report.judgmentCalls, null, 1))

  const seen = kindOf(run.runDir, 'driver:attention')
  assert.equal(seen.length, 3,
    '(a) [M1] the log carries EXACTLY three driver:attention events — one per change of ' +
    '`work.attention` (ok → stuck → needs-human → ok) and none for the polls that read the ' +
    'same value back; got ' + seen.length + ': ' + JSON.stringify(seen.map(attentionShape)))
  assert.deepEqual(seen.map(attentionShape), [
    { task: 'T1', attention: 'stuck', msg: 'no async API', actor: ACTOR },
    { task: 'T1', attention: 'needs-human', msg: 'a human must decide the shape', actor: ACTOR },
    { task: 'T1', attention: 'ok', msg: 'resolved — carrying on', actor: ACTOR },
  ], '(a) [M1] in that order, each `{task, attention, msg, actor}`: `msg` is that flip\'s ' +
     '`work.attention_msg` and `actor` is the actor the stub\'s metadata answer exposes')
  assert.ok(seen.every((e) => typeof e.ts === 'number' && typeof e.id === 'string'),
    '(a) [M1] each is an ordinary appended event, stamped with the log\'s own id and ts; got ' +
    JSON.stringify(seen))

  // The polls happened while the worker ran, and they are reads: the sheet read
  // at dispatch is one of them, so more than one getIssue is the proof the
  // timer ever ticked.
  assert.ok(run.fake.of('getIssue').length > 1,
    '(a) [M1] the engine polled the task\'s issue while its worker ran — the sheet read at ' +
    'dispatch is getIssue #1 and a run that made no other read never polled; got ' +
    run.fake.of('getIssue').length + ' getIssue calls')
}

// ── (a) [M1] the same run with a client that exposes no actor ──────────────
{
  const run = await scenario({
    waves: [[entry()]],
    sheets: { T1: SHEET },
    extraArgs: { attentionPollMs: 50 },
    exposeActor: false,
    onImpl: raisesItsHand(),
  })
  const seen = kindOf(run.runDir, 'driver:attention')
  assert.equal(seen.length, 3,
    '(a) [M1] the same three changes are recorded when the client exposes no actor; got ' +
    JSON.stringify(seen.map(attentionShape)))
  assert.deepEqual(seen.map(attentionShape), [
    { task: 'T1', attention: 'stuck', msg: 'no async API', actor: '' },
    { task: 'T1', attention: 'needs-human', msg: 'a human must decide the shape', actor: '' },
    { task: 'T1', attention: 'ok', msg: 'resolved — carrying on', actor: '' },
  ], '(a) [M1] with `actor` the empty string — M1\'s "else `\'\'`", never undefined and never ' +
     'a name the driver invented')
}

// ── (a) [M1] a hub read that fails appends nothing and does not end the run ─
{
  const run = await scenario({
    waves: [[entry()]],
    sheets: { T1: SHEET },
    extraArgs: { attentionPollMs: 50 },
    pollsThrow: true,
    onImpl: raisesItsHand(),
  })
  const row = run.report.tasks.find((r) => r.task === 'T1')
  assert.equal(row.status, 'done',
    '(a) [M1] a poll the hub answers with an error does not end the run — the task still ' +
    'completes: ' + row.reviewVerdict + ' — ' + row.notes)
  assert.ok(run.fake.of('getIssue').length > 1,
    '(a) [M1] and the refused reads were really made (getIssue calls past the sheet read); got ' +
    run.fake.of('getIssue').length)
  assert.deepEqual(kindOf(run.runDir, 'driver:attention').map(attentionShape), [],
    '(a) [M1] a failing read appends NOTHING — no driver:attention event is invented for a ' +
    'poll that never answered, even though the hand was raised three times behind it')
}

// ── (a) [M1] and with ONE poll answered by an error ────────────────────────
// The failing read is the first poll, ~50 ms in; the single flip lands at
// 100 ms and stands for the worker's remaining half second, so the polls that
// follow the failed one are the ones that see it.
{
  const run = await scenario({
    waves: [[entry()]],
    sheets: { T1: SHEET },
    extraArgs: { attentionPollMs: 50 },
    exposeActor: true,
    // Read #1 is the fact-sheet read at dispatch; read #2 is the first poll.
    failNthRead: 2,
    onImpl: raisesItsHand([{ at: 100, attention: 'stuck', msg: 'no async API' }]),
  })
  assert.equal(run.report.tasks.find((r) => r.task === 'T1').status, 'done',
    '(a) [M1] the stub answering an error on one poll does not end the run — the task still ' +
    'completes: ' + run.report.tasks.find((r) => r.task === 'T1').notes)
  assert.deepEqual(kindOf(run.runDir, 'driver:attention').map(attentionShape),
    [{ task: 'T1', attention: 'stuck', msg: 'no async API', actor: ACTOR }],
    '(a) [M1] the failed poll appends nothing of its own, and the hand raised behind it is ' +
    'still recorded once by a later poll — one error is not a reason to stop reading')
}

// ── (a) [M1] a task with no kata row is never polled ────────────────────────
{
  const run = await scenario({
    waves: [[entry()]],
    // The record names the project and the run issue but no task row at all.
    kataTasks: {},
    extraArgs: { attentionPollMs: 50 },
    onImpl: raisesItsHand(),
  })
  const row = run.report.tasks.find((r) => r.task === 'T1')
  assert.equal(row.status, 'done',
    '(a) [M1] a task the record does not name still runs: ' + row.notes)
  assert.ok(run.fake.of('comment').length > 0,
    '(a) [M1] with the hub genuinely on — the run\'s own lines were posted on the run issue; ' +
    'a scenario that wired no hub would prove nothing here')
  assert.deepEqual(run.fake.of('getIssue'), [],
    '(a) [M1] and ZERO getIssue calls: a task with no kata row is never polled; got ' +
    JSON.stringify(run.fake.of('getIssue')))
  assert.deepEqual(kindOf(run.runDir, 'driver:attention'), [],
    '(a) [M1] so no driver:attention event is appended for it either')
}

// ── (a) [M1] `ATTENTION_POLL_MS` is an option, and its default is not small ─
{
  const source = fs.readFileSync(fileURLToPath(new URL('../run-engine.mjs', import.meta.url)), 'utf8')
  assert.ok(/^\s*(?:export )?const ATTENTION_POLL_MS = (?:15000|15_000|15 \* 1000)\b/m.test(source),
    '(a) [M1] fleet/run-engine.mjs declares `const ATTENTION_POLL_MS = 15000` — M1\'s name and ' +
    'M1\'s default, spelled as the engine\'s other tunables are (INFRA_BACKOFF_MS)')

  const run = await scenario({
    waves: [[entry()]],
    sheets: { T1: SHEET },
    // No `attentionPollMs`: the default governs, and 600 ms of worker is far
    // inside one 15 s period.
    onImpl: raisesItsHand(),
  })
  assert.equal(run.report.tasks.find((r) => r.task === 'T1').status, 'done',
    '(a) [M1] the default-poll run lands')
  assert.deepEqual(kindOf(run.runDir, 'driver:attention').map(attentionShape), [],
    '(a) [M1] and with no `attentionPollMs` option the default period (15000 ms) never comes ' +
    'round inside a 600 ms worker, so nothing is appended — the 50 ms above is the option ' +
    'being honoured and not a hard-coded interval')
}

// ══ (b) [M2] the review lands where the fix will look ══════════════════════
// The blocking findings the comment must carry are read off the fix prompt the
// engine itself built, which is what M2 names: "the blocking findings the fix
// prompt carries, one per line".
const BLOCK_MARKER = 'Blocking issues to resolve:'
const blockingLinesOf = (prompt) => {
  const at = String(prompt).indexOf(BLOCK_MARKER)
  if (at === -1) return []
  return String(prompt).slice(at + BLOCK_MARKER.length).split('\n')
    .filter((l) => l.startsWith('- ')).map((l) => l.slice(2).trim())
}
/** True when `body` carries `needle` as a line of its own — with or without the
 *  prompt's `- ` bullet, which is the prompt's spelling and not the finding. */
const carriesLine = (body, needle) => String(body).split('\n')
  .some((l) => l.trim() === needle || l.trim() === '- ' + needle)
const roundComments = (fake, n) =>
  fake.of('comment').filter((c) => String(c.body).startsWith('review round ' + n + ':'))
const commentIndexOf = (fake, pred) => fake.of('comment').findIndex(pred)
const startsWorker = (label) => (c) => {
  const e = parseLine(c.body)
  return Boolean(e && e.kind === 'worker:start' && e.label === label)
}

// ── (b) [M2] the pre-review repair round: `review round 0:` ────────────────
{
  const run = await scenario({
    waves: [[entry()]],
    sheets: { T1: SHEET },
    stamp: 'r0',
    // Red until a fix round writes `fixed.txt` — so the driver's pre-review
    // pass is red and buys exactly one repair round.
    examBody: NEEDS_FIXED,
    withLog: true,
    onImpl: (cwd) => {
      fs.writeFileSync(path.join(cwd, 'one.txt'), 'from T1\n')
      return doneImpl(cwd)
    },
    onFix: (cwd) => {
      fs.writeFileSync(path.join(cwd, 'fixed.txt'), 'the repair round\n')
      return doneImpl(cwd)
    },
  })
  assert.ok(run.labels.includes('fix:T1:0'),
    '(b) [M2] the red pre-review pass bought the repair round `fix:T1:0`; labels: ' +
    JSON.stringify(run.labels))
  const findings = blockingLinesOf(run.prompts['fix:T1:0'])
  assert.equal(findings.length, 1,
    '(b) [M2] the repair round\'s prompt carries exactly the one red the pass found; got ' +
    JSON.stringify(findings))
  assert.ok(findings[0].startsWith('the Proof\'s exam failed: '),
    '(b) [M2] and that red is the exam\'s — the fixture is only a fixture if the pass was ' +
    'really red; got ' + JSON.stringify(findings[0]))

  const posted = roundComments(run.fake, 0)
  assert.equal(posted.length, 1,
    '(b) [M2] EXACTLY ONE comment whose body begins `review round 0:` — the pre-review repair ' +
    'round is round 0; bodies posted that begin "review round": ' +
    JSON.stringify(run.fake.of('comment').map((c) => String(c.body).split('\n')[0])
      .filter((l) => l.startsWith('review round'))))
  assert.equal(posted[0].uid, 'U-T1',
    '(b) [M2] on the TASK\'s issue, the uid the record names; got ' + posted[0].uid)
  assert.equal(posted[0].projectId, 7,
    '(b) [M2] comment(project.id, uid, body)')
  for (const f of findings) {
    assert.ok(carriesLine(posted[0].body, f),
      '(b) [M2] the body carries the blocking finding the fix prompt carries, on a line of its ' +
      'own: ' + JSON.stringify(f) + '\nbody: ' + JSON.stringify(posted[0].body))
  }

  // Before the fix worker's `worker:start` — read in the order the hub was
  // written, which is the order the engine pushed the two posts.
  const reviewAt = commentIndexOf(run.fake, (c) => String(c.body).startsWith('review round 0:'))
  const startAt = commentIndexOf(run.fake, startsWorker('fix:T1:0'))
  assert.notEqual(startAt, -1,
    '(b) [M2] the `fix:T1:0` worker:start reached the hub (the rig\'s event log wrote it); ' +
    'labels started: ' + JSON.stringify(run.labels))
  assert.ok(reviewAt !== -1 && reviewAt < startAt,
    '(b) [M2] and the `review round 0:` comment is on the issue BEFORE that worker:start — ' +
    'the findings are where the fix will look before the fix worker exists; review at ' +
    reviewAt + ', worker:start at ' + startAt)
}

// ── (b) [M2] review round 1: two blocking findings, both carried ───────────
{
  const DETAIL_A = 'the resolver never releases the lease'
  const DETAIL_B = 'the second wave reads a path the first deleted'
  const run = await scenario({
    waves: [[entry()]],
    sheets: { T1: SHEET },
    stamp: 'r1',
    withLog: true,
    onImpl: (cwd) => {
      fs.writeFileSync(path.join(cwd, 'one.txt'), 'from T1\n')
      return doneImpl(cwd)
    },
    onFix: (cwd) => {
      fs.writeFileSync(path.join(cwd, 'fixed.txt'), 'the fix round\n')
      return doneImpl(cwd)
    },
    reviews: (n) => (n === 1
      ? { verdict: 'FIX_REQUIRED',
          issues: [{ severity: 'blocking', detail: DETAIL_A },
                   { severity: 'blocking', detail: DETAIL_B }] }
      : passReview()),
  })
  assert.ok(run.labels.includes('fix:T1:1'),
    '(b) [M2] the task was sent to a fix round after review round 1; labels: ' +
    JSON.stringify(run.labels))
  assert.deepEqual(blockingLinesOf(run.prompts['fix:T1:1']), [DETAIL_A, DETAIL_B],
    '(b) [M2] whose prompt carries the two blocking findings, in the reviewer\'s order')

  assert.deepEqual(roundComments(run.fake, 0), [],
    '(b) [M2] a task whose pre-review pass was green posts no `review round 0:` comment')
  const posted = roundComments(run.fake, 1)
  assert.equal(posted.length, 1,
    '(b) [M2] and EXACTLY ONE comment beginning `review round 1:` — `<n>` is the reviewer ' +
    'round the findings came from; got ' + posted.length)
  assert.equal(posted[0].uid, 'U-T1', '(b) [M2] on the task\'s issue')
  for (const d of [DETAIL_A, DETAIL_B]) {
    assert.ok(carriesLine(posted[0].body, d),
      '(b) [M2] the body carries ' + JSON.stringify(d) + ' on a line of its own — both ' +
      'findings, one per line\nbody: ' + JSON.stringify(posted[0].body))
  }

  const reviewAt = commentIndexOf(run.fake, (c) => String(c.body).startsWith('review round 1:'))
  const startAt = commentIndexOf(run.fake, startsWorker('fix:T1:1'))
  assert.notEqual(startAt, -1, '(b) [M2] the `fix:T1:1` worker:start reached the hub')
  assert.ok(reviewAt !== -1 && reviewAt < startAt,
    '(b) [M2] and the comment is on the issue before that worker:start; review at ' + reviewAt +
    ', worker:start at ' + startAt)
}

// ── (b) [M2] a refused post is one kata:write-failed, and the round runs ───
{
  const run = await scenario({
    waves: [[entry()]],
    sheets: { T1: SHEET },
    stamp: 'rx',
    examBody: NEEDS_FIXED,
    refuseReviewRound: true,
    onImpl: (cwd) => {
      fs.writeFileSync(path.join(cwd, 'one.txt'), 'from T1\n')
      return doneImpl(cwd)
    },
    onFix: (cwd) => {
      fs.writeFileSync(path.join(cwd, 'fixed.txt'), 'the repair round\n')
      return doneImpl(cwd)
    },
  })
  assert.equal(roundComments(run.fake, 0).length, 1,
    '(b) [M2] the `review round 0:` post was offered to the hub, which refused it')
  const failed = kindOf(run.runDir, 'kata:write-failed')
  assert.equal(failed.length, 1,
    '(b) [M2] a refused post is EXACTLY ONE kata:write-failed event — the non-fatal write ' +
    'path (#934), not a throw; got ' + JSON.stringify(failed))
  assert.ok(String(failed[0].detail).includes(COMMENT_BOOM),
    '(b) [M2] carrying the KataError\'s message; got ' + JSON.stringify(failed[0]))
  assert.ok(run.labels.includes('fix:T1:0'),
    '(b) [M2] and the fix round still runs; labels: ' + JSON.stringify(run.labels))
  assert.equal(run.report.tasks.find((r) => r.task === 'T1').status, 'done',
    '(b) [M2] and the task still lands')
}

// ══ (c) [M3] the boot's status projection carries the attention cell ═══════
// The verb `sandbox-boot.sh project <events.jsonl> [<args.json>]` is side-effect
// free, so one home serves every call — the rig `test_sandbox_boot_viz.mjs`
// drives, driven the same way and never edited.
{
  const ctx = makeHome()
  const evId = (n) => '0000000002' + String(n).padStart(16, '0')
  const ev = (n, body) => JSON.stringify({ ...body, id: evId(n), ts: n }) + '\n'
  const STUCK_MSG = 'no async API'
  const OK_MSG = 'resolved — carrying on'
  const LOG = [
    ev(1, { kind: 'engine:phase', phase: 'Wave 1' }),
    ev(2, { kind: 'driver:attention', task: '2', attention: 'stuck', msg: STUCK_MSG,
            actor: 'impl:2@run-x' }),
    ev(3, { kind: 'driver:attention', task: '2', attention: 'ok', msg: OK_MSG,
            actor: 'impl:2@run-x' }),
  ].join('')
  const ARGS = JSON.stringify({ waves: [[{ id: '1' }, { id: '2' }]] }) + '\n'
  const logPath = path.join(ctx.home, 'attention-events.jsonl')
  const argsPath = path.join(ctx.home, 'attention-args.json')
  fs.writeFileSync(logPath, LOG)
  fs.writeFileSync(argsPath, ARGS)

  const r = boot(ctx, ['project', logPath, argsPath])
  const tail = '\n--- stdout\n' + (r.stdout || '') + '--- stderr\n' + (r.stderr || '')
  assert.equal(r.status, 0,
    '(c) [M3] `sandbox-boot.sh project <events.jsonl> <args.json>` exits 0' + tail)
  const out = splitLines(r.stdout)
  assert.equal(out.length, 1, '(c) [M3] the verb still prints ONE JSON object' + tail)
  let doc = null
  try {
    doc = JSON.parse(out[0])
  } catch (e) {
    assert.fail('(c) [M3] the one line must parse as JSON: ' + e.message + tail)
  }
  assert.ok(doc && doc.tasks && typeof doc.tasks === 'object',
    '(c) [M3] carrying a `tasks` object' + tail)

  assert.deepEqual(Object.keys(doc.tasks['2']).sort(),
    ['attention', 'lastProof', 'park', 'role', 'state', 'wave'],
    '(c) [M3] every task cell carries `attention` BESIDE `state`, `role`, `lastProof` and ' +
    '`park` — nothing the projection already wrote is dropped; got ' +
    JSON.stringify(doc.tasks['2']))
  assert.deepEqual(doc.tasks['2'], {
    wave: 1, state: 'queued', role: null, lastProof: null, park: null,
    attention: { value: 'ok', msg: OK_MSG, ts: 3 },
  }, '(c) [M3] task 2 saw two driver:attention events (stuck, then ok): its `attention` is ' +
     '`{value, msg, ts}` read from the LATEST of them — the value, its `msg`, and that ' +
     'event\'s own `ts`')
  assert.deepEqual(doc.tasks['1'], {
    wave: 1, state: 'queued', role: null, lastProof: null, park: null, attention: null,
  }, '(c) [M3] and task 1, named by the plan and by no driver:attention event, reads `null`')
}

// ══ (d) [M4] the contract says both ════════════════════════════════════════
{
  const contractPath = fileURLToPath(new URL('../CONTRACT.md', import.meta.url))
  assert.ok(fs.existsSync(contractPath), '(d) [M4] fleet/CONTRACT.md exists at ' + contractPath)
  const text = fs.readFileSync(contractPath, 'utf8')
  const lines = text.split('\n')

  // The Proof's first `Run:` line, read as `sed` reads it: from the kata
  // bullet through the next `- **` bullet, folded to one line.
  const at = lines.findIndex((l) => l.startsWith('- **Kata record (engine)'))
  assert.notEqual(at, -1,
    '(d) [M4] fleet/CONTRACT.md carries a `- **Kata record (engine):**` bullet')
  let end = lines.findIndex((l, i) => i > at && l.startsWith('- **'))
  if (end === -1) end = lines.length - 1
  const block = lines.slice(at, end + 1).join(' ')
  assert.ok(block.includes('driver:attention'),
    '(d) [M4] the kata bullet names the `driver:attention` event; the bullet reads: ' + block)
  assert.ok(block.includes('review round'),
    '(d) [M4] and the `review round <n>:` comment; the bullet reads: ' + block)
  assert.ok(/driver:attention[\s\S]*review round/.test(block),
    '(d) [M4] in that order, which is what the Proof\'s `sed … | tr \'\\n\' \' \' | grep -q ' +
    '\'driver:attention.*review round\'` reads; the bullet reads: ' + block)

  // The Proof's second `Run:` line: `grep -c '"attention"' | xargs test 1 -le`.
  const quoted = lines.filter((l) => l.includes('"attention"')).length
  assert.ok(quoted >= 1,
    '(d) [M4] the status-cell sentence names the `attention` cell as `"attention"` — at least ' +
    'one line of fleet/CONTRACT.md carries it, which is what `grep -c \'"attention"\' | xargs ' +
    'test 1 -le` reads; got ' + quoted + ' such lines')
}

console.log('ALL TESTS PASSED')
