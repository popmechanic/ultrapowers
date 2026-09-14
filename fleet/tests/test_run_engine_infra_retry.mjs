// fleet/tests/test_run_engine_infra_retry.mjs — one bounded retry for the
// three single-dispatch judgments (#830).
//
// The only infra signal the engine reads is a `null` reply from `agent()` (the
// AGENT_NULL doctrine at the top of fleet/run-engine.mjs). A judgment whose
// death parks or fail-closes a whole run — the examiner of the wave-0 pair, a
// reviewer — is dispatched exactly once at BASE, so one overloaded minute costs
// the run its judgment. These legs pin the second, coarser tier: ONE
// re-dispatch after a backoff, the record naming both attempts with the status
// code the worker's own `worker:end` event carried, and a second death that is
// fail-closed exactly as today.
//
// #964 Task 2 retired the completeness critic, which was the third such
// judgment and the vehicle most of these legs drove (`criticRun`, a lean
// one-task run whose one `integration` call was canned per attempt). The legs
// that were ABOUT the critic are gone — the second reply as the attestation,
// its findings verbatim, the fail-closed twice-dead run and the frozen
// `gate_check.py` BLOCKED/exit-1 pin over it — and so is the pair, with the leg
// that priced two dead halves at one backoff. Every leg that needed only a
// single-dispatch judgment is unchanged except for its vehicle: the lean
// reviewer, which has the same `null` -> backoff -> one re-dispatch seam and is
// the one such judgment left.
//
// Everything below the agent seam is real (git, clones, capture, the fold
// kernel, the real exec seam, the frozen gate_check.py); only the judgments are
// canned. The sim's canned worker mirrors the production order for a death: it
// appends `{"kind":"worker:end","label":<label>,"class":"infra","status":429}`
// to `<runDir>/events.jsonl` and THEN returns `null` — the status code never
// travels in the return value, so the engine reads it back off the log.
//
// The Machine clauses under test, restated:
//   M1 — `fleet/run-engine.mjs` exports `INFRA_BACKOFF_MS` equal to `60000`,
//        and `runEngine` waits `args.infraBackoffMs` ms when that is a finite
//        number >= 0, else `INFRA_BACKOFF_MS`, between a judgment call's `null`
//        reply and its re-dispatch.
//   M2 — a `null` judgment call is dispatched a second time with a
//        byte-identical prompt and the same `model` and `schema`; a second
//        reply that is an object IS the judgment. (Its critic half — the
//        attestation and `completenessFindings` — went with #964 Task 2.)
//   M3 — two `null`s buy no third dispatch. (Its critic half — `gitVerified`
//        false, the fail-closed finding, `gate_check.py` BLOCKED/exit 1 — went
//        with #964 Task 2; the reviewer's own two-null lane is leg (i).)
//   M4 — each `null` attempt leaves one `judgmentCalls` entry (attempt 1
//        re-dispatched, attempt 2 fail-closed), carrying the status of the most
//        recent `worker:end` for that label (`unknown` when there is none), a
//        task-scoped entry prefixed `task <id>: `; and each re-dispatch appends
//        one `driver:infra-retry` event `{label, attempt: 1, status}`.
//   M5 — a THROWN judgment call is dispatched once and leaves no
//        `infra-retry:` entry; a run that never sees a `null` leaves neither
//        entry nor event.
//   M6 — a `null` `exam:<id>` beside a KEPT implementer reply re-cuts and
//        bootstraps the examiner's clone at BASE and dispatches the examiner a
//        second time, the implementer exactly once; a second `null` proceeds
//        unexamined as at BASE.
//   M7 — a `null` review is re-dispatched, the implementer exactly once and no
//        barrier park; a second `null` parks and the barrier retry recovers it
//        as at BASE. (Its pair half — only the null half of a pair is re-asked
//        — went with the pair, #964 Task 2.)
//   M8 — the backoff elapses BEFORE the re-dispatch. Leg (j) pins what a sim
//        can hold still: that a configured backoff still buys the one
//        re-dispatch, and that the record names the milliseconds waited. The
//        wall-clock gap itself is not measured — a timer pin that had caught
//        nothing failed CI on a one-millisecond miss (#892).
//
// Every assertion below names its Proof leg and the clause it comes from.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
// A namespace import, so a BASE that exports no `INFRA_BACKOFF_MS` fails leg
// (a)'s assertion — the absent implementation — rather than failing to link.
import * as engine from '../run-engine.mjs'
import { simEnv } from './_helpers.mjs'
import {
  makeRepo, rig, passReview, doneImpl,
} from './_engine_helpers.mjs'
import { createRunWorker, ATTACHMENT_WINDOW_MS } from '../run-worker.mjs'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-infra-retry-'))
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }))

// ── the record the sims read ────────────────────────────────────────────────
// The driver's own append-only log. An absent file reads as no records, so an
// engine that writes none fails an assertion rather than throwing ENOENT.
const readEvents = (runDir) => {
  const file = path.join(runDir, 'events.jsonl')
  if (!fs.existsSync(file)) return []
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l) } catch { return null } })
    .filter(Boolean)
}
const infraMarks = (runDir) => readEvents(runDir).filter((e) => e.kind === 'driver:infra-retry')
const countOf = (labels, label) => labels.filter((l) => l === label).length
const withRetry = (report) => report.judgmentCalls.filter((j) => String(j).includes('infra-retry:'))
const shown = (report) => report.judgmentCalls.join(' | ')

// The canned death, in production's order: the `worker:end` line first, the
// `null` second. A stub that skips the line is the `status unknown` row.
const dieNull = (runDir, label, status = 429) => {
  fs.appendFileSync(path.join(runDir, 'events.jsonl'),
    JSON.stringify({ kind: 'worker:end', label, class: 'infra', status }) + '\n')
  return null
}

// The two `judgmentCalls` literals of M4, spelled once.
const attempt1 = (label, status, ms) =>
  'infra-retry: ' + label + ' attempt 1 returned null (status ' + status +
  ') — re-dispatched once after ' + ms + ' ms'
const attempt2 = (label, status) =>
  'infra-retry: ' + label + ' attempt 2 returned null (status ' + status +
  ') — no third attempt; fail-closed'

// ── the tasks the sims run ──────────────────────────────────────────────────
const plainTask = (review) => ({
  id: 'T1', title: 't', files: ['T1.txt'], tier: 'standard', review,
  writes: ['T1.txt'], commutes: [], proofTests: [], proofRuns: [],
  body: 'sim task T1',
})
// A task with a Proof `Test:` path, so the wave-0 examiner is dispatched.
const EXAM_BODY = '**Claim:** the tree gains one.txt\n' +
  'Machine: M1. The tree holds `one.txt`.\n\n' +
  '**Proof:**\n- Test: `t1_test.sh`\n- Legs: (a) `one.txt` exists [M1]'
const examTask = () => ({
  id: 'T1', title: 'create one', files: ['one.txt'], tier: 'standard', review: 'peer',
  writes: ['one.txt'], commutes: [],
  testCmd: 'bash t1_test.sh', proofTests: ['t1_test.sh'], proofRuns: [],
  body: EXAM_BODY,
})
// The exam the second examiner writes: red at BASE until one.txt exists.
const RED_AT_BASE = '#!/bin/bash\n[ -f one.txt ]\n'

let seq = 0
const freshNames = (tag) => {
  seq += 1
  const stamp = 'ir' + seq + tag
  return { stamp, repo: makeRepo(path.join(tmp, 'repo-' + stamp)), runDir: path.join(tmp, 'run-' + stamp) }
}

// ── a one-task run whose reviewer call is canned per attempt ────────────────
// `review({ label, n, runDir })` answers the n-th dispatch OF THAT LABEL, and
// `opts` records the dispatch options of each. `extraArgs` is merged after the
// default `infraBackoffMs: 0`, so the #857 scenarios can ask for a distinctive
// backoff.
//
// Until #964 Task 2 the legs below drove `criticRun`: the same one-task run,
// with one `integration` call canned per attempt. No such worker is dispatched
// any more, so every leg that needed only a single-dispatch judgment drives the
// lean reviewer instead — the same `null` -> backoff -> one re-dispatch seam,
// on the one single-dispatch judgment the run still has. Its entries are
// task-scoped (`task T1: `), which the critic's were not.
async function reviewerRun({ profile, review, extraArgs = {} }) {
  const { stamp, repo, runDir } = freshNames('r')
  const labels = []
  const perLabel = new Map()
  const prompts = new Map()
  const opts = new Map()
  const stub = (prompt, o, cwd) => {
    labels.push(o.label)
    const kind = o.label.split(':')[0]
    if (kind === 'impl') { fs.writeFileSync(path.join(cwd, 'T1.txt'), 'v1\n'); return doneImpl(cwd) }
    if (kind === 'review') {
      const n = (perLabel.get(o.label) || 0) + 1
      perLabel.set(o.label, n)
      prompts.set(o.label + '#' + n, prompt)
      opts.set(o.label + '#' + n, o)
      return review({ label: o.label, n, runDir })
    }
    throw new Error('unexpected dispatch: ' + o.label)
  }
  const { run } = rig({
    repo, runDir, waves: [[plainTask(profile)]], stub, stamp,
    extraArgs: { infraBackoffMs: 0, ...extraArgs },
  })
  const report = await run()
  return { report, labels, prompts, opts, runDir }
}
// The lean one-task run the retargeted legs use, and the one label it reviews.
const leanRun = (review, extraArgs = {}) => reviewerRun({ profile: 'lean', review, extraArgs })
const LEAN = 'review:T1:1'

// ══ (a) the constant, and the backoff the engine falls back to [M1] ═════════
assert.equal(engine.INFRA_BACKOFF_MS, 60000,
  '(a)/M1: run-engine.mjs must export INFRA_BACKOFF_MS equal to 60000, got ' +
  String(engine.INFRA_BACKOFF_MS))

// A non-numeric `args.infraBackoffMs` falls back to INFRA_BACKOFF_MS: the
// re-dispatch still happens, and the delay the engine ASKED for is 60000.
// `globalThis.setTimeout` is stubbed for this scenario alone — firing
// immediately so the sim does not sleep a minute — and records every delay.
{
  const realSetTimeout = globalThis.setTimeout
  const delays = []
  // The callback is scheduled immediately on a handle the sim keeps to itself,
  // and the caller is handed an inert one: whatever the backoff does with the
  // handle it is given — `unref()` above all — the sim's own timer still fires,
  // so this scenario measures the delay ASKED FOR and never sleeps a minute.
  globalThis.setTimeout = function (fn, ms, ...rest) {
    delays.push(ms)
    realSetTimeout(fn, 0, ...rest)
    return { unref: () => {}, ref: () => {}, hasRef: () => false, refresh: () => {} }
  }
  let r
  try {
    r = await leanRun(
      ({ label, n, runDir }) => (n === 1 ? dieNull(runDir, label, 429) : passReview()),
      { infraBackoffMs: 'x' })
  } finally {
    globalThis.setTimeout = realSetTimeout
  }
  assert.equal(countOf(r.labels, LEAN), 2,
    '(a)/M1: a non-numeric infraBackoffMs still buys the one re-dispatch: ' + r.labels.join(','))
  assert.deepEqual(withRetry(r.report), ['task T1: ' + attempt1(LEAN, 429, 60000)],
    '(a)/M1: and the call names the fallback backoff: ' + shown(r.report))
  assert.equal(delays.filter((d) => d === 60000).length, 1,
    '(a)/M1: the engine asked setTimeout for exactly 60000 ms once, got delays [' +
    delays.join(',') + ']')
}

// ══ (b) one null, then an answer: the second reply IS the judgment [M2] ═════
// Also carries leg (e)'s first half: the attempt-1 entry, no attempt-2 entry,
// and the one `driver:infra-retry` event [M4]. The critic half of M2 — that the
// second reply is the run's attestation and its `findings` the report's — went
// with the critic (#964 Task 2), and so did leg (c), which pinned those
// findings verbatim.
{
  const { report, labels, prompts, opts, runDir } = await leanRun(
    ({ label, n, runDir: rd }) => (n === 1 ? dieNull(rd, label, 429) : passReview()))
  assert.equal(countOf(labels, LEAN), 2,
    '(b)/M2: the review label is dispatched exactly twice: ' + labels.join(','))
  assert.equal(prompts.get(LEAN + '#2'), prompts.get(LEAN + '#1'),
    '(b)/M2: the second prompt is byte-identical to the first')
  assert.equal(opts.get(LEAN + '#2').model, opts.get(LEAN + '#1').model,
    '(b)/M2: dispatched under the first call\'s model')
  assert.deepEqual(opts.get(LEAN + '#2').schema, opts.get(LEAN + '#1').schema,
    '(b)/M2: and the first call\'s schema')
  assert.equal(report.tasks[0].reviewVerdict, 'clean',
    '(b)/M2: the second reply is the judgment: ' + JSON.stringify(report.tasks[0]))
  assert.equal(report.tasks[0].status, 'done',
    '(b)/M2: and the task ends done: ' + JSON.stringify(report.tasks[0]))

  // [M4] the record of the one attempt that died.
  assert.deepEqual(withRetry(report), ['task T1: ' + attempt1(LEAN, 429, 0)],
    '(e)/M4: exactly one infra-retry judgment call, the attempt-1 line: ' + shown(report))
  assert.deepEqual(report.judgmentCalls.filter((j) => String(j).includes('attempt 2')), [],
    '(e)/M4: and no attempt-2 entry: ' + shown(report))
  const marks = infraMarks(runDir)
  assert.equal(marks.length, 1,
    '(e)/M4: exactly one driver:infra-retry event: ' + JSON.stringify(marks))
  assert.equal(marks[0].label, LEAN, '(e)/M4: labelled ' + LEAN + ': ' + JSON.stringify(marks[0]))
  assert.equal(marks[0].attempt, 1, '(e)/M4: attempt 1: ' + JSON.stringify(marks[0]))
  assert.equal(marks[0].status, 429, '(e)/M4: carrying the status it read: ' + JSON.stringify(marks[0]))
}

// ══ (c) and (d) went with the critic (#964 Task 2) ══════════════════════════
// (c) pinned the re-dispatched critic's `findings` as the report's, verbatim.
// (d) pinned the twice-dead critic: no third dispatch, `gitVerified` withheld,
// the one fail-closed finding of BASE, and the FROZEN `gate_check.py` over that
// report — exit 1, verdict BLOCKED, `git-verified` among the failed checks.
// Neither has a subject any more: no worker reads the finished run, and
// `gitVerified` is derived from the fold receipts rather than attested. The
// reviewer's own two-null lane — no third dispatch, then the park and the
// barrier retry — is leg (i) below, which is unchanged.

// ══ (e) a null with no `worker:end` line reads `status unknown` [M4] ════════
{
  const { report, labels } = await leanRun(({ n }) => (n === 1 ? null : passReview()))
  assert.equal(countOf(labels, LEAN), 2,
    '(e)/M4: a status-less null is still one re-dispatch: ' + labels.join(','))
  assert.deepEqual(withRetry(report), ['task T1: ' + attempt1(LEAN, 'unknown', 0)],
    '(e)/M4: with `unknown` where no worker:end event carried the label: ' + shown(report))
}

// ══ (f) a throw is not a null, and a clean run records nothing [M5] ═════════
{
  // A throw is not a null: the retry lane never opens. On the critic's vehicle
  // that read as one dispatch and a withheld attestation; on the reviewer the
  // throw parks the task, so the label is dispatched once per task attempt and
  // the barrier retry re-runs the task WHOLE — implementer first. Either way
  // the thing under test is the same: no back-to-back re-dispatch, no entry.
  const { report, labels } = await leanRun(({ n }) => {
    if (n === 1) throw new Error('sim: the reviewer died')
    return passReview()
  })
  assert.deepEqual(labels, ['impl:T1', LEAN, 'impl:T1', LEAN],
    '(f)/M5: a judgment that THROWS is dispatched once per task attempt, never twice ' +
    'in a row off the backoff: ' + labels.join(','))
  assert.deepEqual(withRetry(report), [],
    '(f)/M5: a throw leaves no infra-retry entry: ' + shown(report))
}
{
  const { report, labels, runDir } = await leanRun(() => passReview())
  assert.equal(countOf(labels, LEAN), 1,
    '(f)/M5: an all-green run dispatches the reviewer once: ' + labels.join(','))
  assert.deepEqual(withRetry(report), [],
    '(f)/M5: and leaves no infra-retry entry: ' + shown(report))
  assert.deepEqual(infraMarks(runDir), [],
    '(f)/M5: and no driver:infra-retry event: ' + JSON.stringify(infraMarks(runDir)))
}

// ── the examiner scenarios [M6] ─────────────────────────────────────────────
// A peer task with a Proof `Test:` path: `exam:T1` and `impl:T1` go out
// together. `exam({ n, runDir, cwd })` answers the n-th examiner dispatch;
// `impl(cwd)` is the implementer's canned reply.
async function examinerRun({ exam, impl }) {
  const { stamp, repo, runDir } = freshNames('e')
  const labels = []
  const examSeen = []
  const stub = (prompt, opts, cwd) => {
    labels.push(opts.label)
    const kind = opts.label.split(':')[0]
    if (kind === 'exam') {
      // Read BEFORE the reply: what this attempt found in the clone it was
      // given is the whole of leg (g)'s re-cut question.
      examSeen.push({
        prompt,
        cwd,
        stale: fs.existsSync(path.join(cwd, 'stale.txt')),
        booted: fs.existsSync(path.join(cwd, 'booted.txt')),
      })
      return exam({ n: examSeen.length, runDir, cwd })
    }
    if (kind === 'impl') { fs.writeFileSync(path.join(cwd, 'one.txt'), 'from T1\n'); return impl(cwd) }
    if (kind === 'fix') { fs.writeFileSync(path.join(cwd, 'one.txt'), 'from T1\n'); return doneImpl(cwd) }
    if (kind === 'review') return passReview()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run } = rig({
    repo, runDir, waves: [[examTask()]], stub, stamp,
    extraArgs: { infraBackoffMs: 0, bootstrapCmd: 'touch booted.txt' },
  })
  const report = await run()
  return { report, labels, examSeen, runDir }
}

// ══ (g) a null examiner beside a kept implementer: the examiner alone [M6] ══
for (const [name, implReply] of [
  ['DONE', (cwd) => doneImpl(cwd)],
  ['DONE_WITH_CONCERNS', (cwd) => ({ ...doneImpl(cwd), status: 'DONE_WITH_CONCERNS', concerns: ['sim concern'] })],
]) {
  const { report, labels, examSeen } = await examinerRun({
    impl: implReply,
    exam: ({ n, runDir, cwd }) => {
      if (n === 1) {
        // What a reused clone would still be holding on the second attempt.
        fs.writeFileSync(path.join(cwd, 'stale.txt'), 'the dead examiner was here\n')
        return dieNull(runDir, 'exam:T1', 429)
      }
      fs.writeFileSync(path.join(cwd, 't1_test.sh'), RED_AT_BASE)
      return { status: 'DONE', summary: 'sim' }
    },
  })
  const row = report.tasks[0]
  assert.equal(countOf(labels, 'exam:T1'), 2,
    '(g)/M6 [' + name + ']: the examiner is dispatched exactly twice: ' + labels.join(','))
  assert.equal(countOf(labels, 'impl:T1'), 1,
    '(g)/M6 [' + name + ']: and the implementer whose reply was kept exactly once: ' +
    labels.join(','))
  assert.equal(examSeen.length, 2, '(g)/M6 [' + name + ']: both exam dispatches were observed')
  assert.equal(examSeen[1].prompt, examSeen[0].prompt,
    '(g)/M6 [' + name + ']: the re-dispatched examiner is handed the same prompt')
  assert.equal(examSeen[1].stale, false,
    '(g)/M6 [' + name + ']: the second examiner\'s clone was re-cut at BASE — a reused ' +
    'clone would still hold stale.txt')
  assert.equal(examSeen[1].booted, true,
    '(g)/M6 [' + name + ']: and bootstrapped again')
  assert.equal(row.status, 'done', '(g)/M6 [' + name + ']: the task ends done: ' + row.notes)
  if (name === 'DONE') {
    assert.notEqual(row.exam, 'blocked',
      '(g)/M6: the second examiner answered first time — the exam is not blocked: ' +
      JSON.stringify(row))
    assert.notEqual(row.exam, null,
      '(g)/M6: nor absent: ' + JSON.stringify(row))
    assert.deepEqual(withRetry(report), ['task T1: ' + attempt1('exam:T1', 429, 0)],
      '(g)/M4: exactly one task-scoped infra-retry call: ' + shown(report))
    assert.deepEqual(
      report.judgmentCalls.filter((j) => String(j).includes('re-dispatching the examiner alone')),
      [],
      '(g)/M6: the null lane is not the #762 rejected-examiner lane: ' + shown(report))
  }
}

// ══ (h) a null examiner twice: unexamined, as at BASE [M6] ═════════════════
{
  const { report, labels } = await examinerRun({
    impl: (cwd) => doneImpl(cwd),
    exam: ({ runDir }) => dieNull(runDir, 'exam:T1', 429),
  })
  const row = report.tasks[0]
  assert.equal(countOf(labels, 'exam:T1'), 2,
    '(h)/M6: a second null examiner buys no third dispatch: ' + labels.join(','))
  assert.equal(countOf(labels, 'impl:T1'), 1,
    '(h)/M6: and the implementer is still dispatched exactly once: ' + labels.join(','))
  assert.equal(row.exam, 'blocked', '(h)/M6: the exam is blocked: ' + JSON.stringify(row))
  assert.ok(report.judgmentCalls.some((j) => String(j).includes('proceeds unexamined')),
    '(h)/M6: and the run proceeds unexamined, as at BASE: ' + shown(report))
  assert.equal(report.judgmentCalls.filter((j) => j === 'task T1: ' + attempt2('exam:T1', 429)).length, 1,
    '(h)/M4: exactly one task-scoped attempt-2 call, `task T1: ' + attempt2('exam:T1', 429) +
    '`: ' + shown(report))
}

// ── the reviewer scenarios [M7] ────────────────────────────────────────────
// `reviewerRun` is defined above, where `criticRun` used to be (#964 Task 2):
// the legs that drove the critic drive it now, so the helper leads the file.

// ══ (i) a lean single, and a second null [M7] ══════════════════════════════
// The pair block that stood here — only the null half of a `peer` pair is
// re-dispatched, the half that answered exactly once — went with the pair
// (#964 Task 2). A `peer` task is reviewed by one worker now, which is the lean
// lane below.
{
  // The lean single review.
  const { report, labels } = await reviewerRun({
    profile: 'lean',
    review: ({ label, n, runDir }) => (n === 1 ? dieNull(runDir, label, 429) : passReview()),
  })
  assert.equal(countOf(labels, 'review:T1:1'), 2,
    '(i)/M7: a null lean review is dispatched exactly twice: ' + labels.join(','))
  assert.equal(countOf(labels, 'impl:T1'), 1,
    '(i)/M7: and the implementer exactly once: ' + labels.join(','))
  assert.equal(report.tasks[0].status, 'done',
    '(i)/M7: the task ends done: ' + JSON.stringify(report.tasks[0]))
  assert.deepEqual(report.judgmentCalls.filter((j) => String(j).includes('parked for one barrier retry')),
    [], '(i)/M7: and no barrier park was taken: ' + shown(report))
}
{
  // Two nulls: the attempt and its one re-dispatch. The task parks and the
  // BARRIER retry re-runs it whole — implementer included — as at BASE.
  const { report, labels } = await reviewerRun({
    profile: 'lean',
    review: ({ label, n, runDir }) => (n <= 2 ? dieNull(runDir, label, 429) : passReview()),
  })
  assert.equal(report.judgmentCalls.filter((j) => j === 'task T1: ' + attempt2('review:T1:1', 429)).length, 1,
    '(i)/M4: exactly one call equal to `task T1: ' + attempt2('review:T1:1', 429) + '`: ' +
    shown(report))
  assert.ok(report.judgmentCalls.some((j) => String(j).includes('parked for one barrier retry')),
    '(i)/M7: the second null parks the task, as at BASE: ' + shown(report))
  assert.ok(report.judgmentCalls.some((j) => String(j).includes('recovered at the barrier retry')),
    '(i)/M7: and the barrier retry recovers it: ' + shown(report))
  assert.equal(countOf(labels, 'impl:T1'), 2,
    '(i)/M7: the barrier retry re-runs the whole task, implementer included: ' + labels.join(','))
  assert.equal(countOf(labels, 'review:T1:1'), 3,
    '(i)/M7: three reviewer dispatches — the attempt, its one re-dispatch, and the ' +
    'barrier retry\'s: ' + labels.join(','))
  assert.equal(report.tasks[0].status, 'done',
    '(i)/M7: and the task ends done: ' + JSON.stringify(report.tasks[0]))
}

// ══ (j) a configured backoff still buys the one re-dispatch [M8] ═══════════
{
  const { report, labels } = await leanRun(
    ({ label, n, runDir }) => (n === 1 ? dieNull(runDir, label, 429) : passReview()),
    { infraBackoffMs: 300 })
  assert.equal(countOf(labels, LEAN), 2,
    '(j)/M8: the reviewer is dispatched twice: ' + labels.join(','))
  assert.deepEqual(withRetry(report), ['task T1: ' + attempt1(LEAN, 429, 300)],
    '(j)/M8: and the call names the backoff it waited: ' + shown(report))
}

// ════ the ref'd timer, the pair's one wait, and the `kept` helper (#857) ═════
// The residuals of the retry above, measured. The clauses of that task are
// restated here as R1–R4 so they do not collide with the M1–M8 of the header,
// and every assertion below names its own leg and the clause it comes from:
//   R1 — between a judgment call's `null` reply and its re-dispatch,
//        `fleet/run-engine.mjs` calls `fs.watch` ZERO times: with `fs.watch`
//        replaced by a counting, throwing stub, a lean one-task run whose
//        review call returns `null` once and then answers dispatches that label
//        exactly twice, ends with the reviewer's verdict in hand, and leaves the
//        stub's count at 0.
//   R2 — the wait is held by the backoff's TIMER ALONE: with `fs.watch` stubbed
//        to throw and `globalThis.setTimeout` left real, that same run with
//        `args.infraBackoffMs` of 50 reaches its report (the sim process is
//        still alive to assert the verdict); and with
//        `globalThis.setTimeout` stubbed to hand back handles that record
//        `unref` calls, the handle returned for the delay equal to
//        `args.infraBackoffMs` receives NO `unref` call.
//   R3 — (the pair leg: two dead halves waited the backoff exactly once. Gone
//        with the pair, #964 Task 2 — R2's legs carry what is left of the
//        timer's behaviour.)
//   R4 — the kept-reply condition is spelled ONCE: exactly one line of
//        `fleet/run-engine.mjs` contains both `'DONE_WITH_CONCERNS')` and
//        `&& hasCoordinates(`, and both examiner lanes still re-dispatch the
//        examiner once and the implementer never.
//
// Leg order: the source pin (857-e) runs FIRST on purpose. At BASE the two
// real-timer legs below end the process at Node's exit 13 ("unsettled top-level
// await", measured) rather than at an assertion, so the crisp red — a count of
// 2 where the contract says 1 — is the one a reader meets first. Leg (857-f) is
// carried by the scenarios already above: the thrown-examiner and null-examiner
// lanes of leg (g) (examiner twice, implementer once, for both kept statuses),
// the lean single of leg (i), and the configured backoff of leg (j) — all of
// which must stay green.
//
// The two process-wide stubs, each restored in a `finally` before the next
// scenario runs. No assertion here reads a clock: a backoff is measured by the
// delay `globalThis.setTimeout` was ASKED for and how many times (#892, #885).
const ENGINE_SRC = fileURLToPath(new URL('../run-engine.mjs', import.meta.url))

// Every delay the engine asks for is recorded; the callback is fired at once on
// a handle the sim keeps to itself, so the sim never sleeps the backoff, and the
// caller is handed a fresh inert handle per call whose `unref()` is counted
// against the delay that handle was asked for.
const withTimerStub = async (body) => {
  const realSetTimeout = globalThis.setTimeout
  const delays = []
  const unrefs = new Map()
  globalThis.setTimeout = function (fn, ms, ...rest) {
    delays.push(ms)
    realSetTimeout(fn, 0, ...rest)
    const handle = {
      unref: () => { unrefs.set(ms, (unrefs.get(ms) || 0) + 1); return handle },
      ref: () => handle,
      hasRef: () => true,
      refresh: () => handle,
    }
    return handle
  }
  try {
    return { value: await body(), delays, unrefs: (ms) => unrefs.get(ms) || 0 }
  } finally {
    globalThis.setTimeout = realSetTimeout
  }
}

// The box where `fs.watch` is not available: it counts the call and throws, the
// way an inotify limit does. The engine imports `fs` from `node:fs` as the
// module object this file imports, so the assignment replaces what it calls.
const withWatchStub = async (body) => {
  const realWatch = fs.watch
  const state = { calls: 0 }
  fs.watch = function () {
    state.calls += 1
    throw new Error('sim: fs.watch is unavailable on this box')
  }
  try {
    return { value: await body(), watch: state }
  } finally {
    fs.watch = realWatch
  }
}

// ══ (857-e) the kept-reply condition is spelled on exactly one line [R4] ═════
// The same count the Proof's `Run:` line takes with `grep -c`, read here so the
// suite carries it too. At BASE it is 2 — `:1872` (the examiner that threw) and
// `:1902` (the examiner that returned null) spell the condition twice. The
// `&& hasCoordinates(` fragment deliberately excludes the `&& !hasCoordinates(`
// lines, which are a different condition (a success that lost its capture).
{
  const lines = fs.readFileSync(ENGINE_SRC, 'utf8').split('\n')
  const runPattern = "DONE_WITH_CONCERNS') && hasCoordinates("
  const grepped = lines.filter((l) => l.includes(runPattern))
  assert.equal(grepped.length, 1,
    '(857-e)/R4: exactly one line of fleet/run-engine.mjs may contain `' + runPattern +
    '` — the Proof\'s `Run:` grep -c reads this count — got ' + grepped.length + ':\n' +
    grepped.map((l) => '  ' + l.trim()).join('\n'))
  const bothFragments = lines.filter((l) =>
    l.includes("'DONE_WITH_CONCERNS')") && l.includes('&& hasCoordinates('))
  assert.equal(bothFragments.length, 1,
    '(857-e)/R4: and exactly one line contains both `\'DONE_WITH_CONCERNS\')` and ' +
    '`&& hasCoordinates(` — the condition lives in one helper — got ' +
    bothFragments.length + ':\n' + bothFragments.map((l) => '  ' + l.trim()).join('\n'))
}

// ══ (857-a) the backoff calls `fs.watch` zero times [R1] ════════════════════
// At BASE the engine opens `fs.watch(runDir, () => {})` to hold the loop, so the
// count is 1 — and on the real timer left over there the process never reaches
// this assertion at all.
{
  const { value: r, watch } = await withWatchStub(() => leanRun(
    ({ label, n, runDir: rd }) => (n === 1 ? dieNull(rd, label, 429) : passReview()),
    { infraBackoffMs: 0 }))
  assert.equal(countOf(r.labels, LEAN), 2,
    '(857-a)/R1: on a box where fs.watch throws, the null review is still dispatched ' +
    'exactly twice: ' + r.labels.join(','))
  assert.equal(r.report.tasks[0].reviewVerdict, 'clean',
    '(857-a)/R1: and the run ends with the reviewer\'s verdict in hand: ' + shown(r.report))
  assert.deepEqual(withRetry(r.report), ['task T1: ' + attempt1(LEAN, 429, 0)],
    '(857-a)/R1: by the same one re-dispatch, recorded unchanged: ' + shown(r.report))
  assert.equal(watch.calls, 0,
    '(857-a)/R1: and the backoff called fs.watch zero times, got ' + watch.calls)
}

// ══ (857-b) the wait is the timer alone: the run reaches its report [R2] ════
// No `setTimeout` stub at all — the REAL timer holds the loop for the 50 ms. At
// BASE the timer is unref'd and the watch that stood in for it throws, so node
// ends the process with exit 13 ("unsettled top-level await", measured) and this
// assertion is never reached; nor is the `ALL TESTS PASSED` sentinel printed.
{
  const { value: r } = await withWatchStub(() => leanRun(
    ({ label, n, runDir: rd }) => (n === 1 ? dieNull(rd, label, 429) : passReview()),
    { infraBackoffMs: 50 }))
  assert.equal(countOf(r.labels, LEAN), 2,
    '(857-b)/R2: a real 50 ms backoff on a watch-less box still buys the one ' +
    're-dispatch: ' + r.labels.join(','))
  assert.equal(r.report.tasks[0].reviewVerdict, 'clean',
    '(857-b)/R2: and the sim process is still alive to read the verdict off the ' +
    'report — a wait that does not hold the loop never gets here: ' + shown(r.report))
  assert.deepEqual(withRetry(r.report), ['task T1: ' + attempt1(LEAN, 429, 50)],
    '(857-b)/R2: the call naming the 50 ms it waited: ' + shown(r.report))
}

// ══ (857-c) the backoff's own timer is never unref'd [R2] ═══════════════════
// 4321 ms, because the engine asks for other delays (the baseline head start's
// 500 ms is unref'd ON PURPOSE) and this leg reads the handle the BACKOFF was
// handed. At BASE `waitInfraBackoff` unrefs it, so the counter is 1.
{
  const BACKOFF = 4321
  const { value: r, delays, unrefs } = await withTimerStub(() => leanRun(
    ({ label, n, runDir: rd }) => (n === 1 ? dieNull(rd, label, 429) : passReview()),
    { infraBackoffMs: BACKOFF }))
  assert.equal(countOf(r.labels, LEAN), 2,
    '(857-c)/R2: the reviewer is dispatched exactly twice: ' + r.labels.join(','))
  assert.equal(delays.filter((d) => d === BACKOFF).length, 1,
    '(857-c)/R2: exactly one handle was asked for ' + BACKOFF + ' ms, got delays [' +
    delays.join(',') + ']')
  assert.equal(unrefs(BACKOFF), 0,
    '(857-c)/R2: and the handle returned for ' + BACKOFF + ' ms received no unref() ' +
    'call — a ref\'d timer is what holds the loop for the wait — got ' + unrefs(BACKOFF))
}

// ══ (857-d) went with the pair (#964 Task 2) ════════════════════════════════
// It paid both halves of a `peer` pair to die on their first dispatch and
// pinned what that cost: `setTimeout` asked for the backoff exactly once for
// the two concurrent retries, one `driver:infra-retry` event and one
// `infra-retry:` entry per half, each carrying its own half's status, and the
// task still done with no barrier park. One worker reviews a task now, so there
// is no second half to wait for and nothing here to measure; (857-c) above
// keeps the timer's own behaviour on the one retry that remains.

// ══ #903 — an edge 403 rides the infra lane, with the REAL worker in the rig ═
// Everything above cans the agent seam. These legs put `createRunWorker`
// itself under the implementer label, driving a fake `claude` that answers
// exe.dev's plain-text `403 integration not found or not attached to this VM
// (trace: <32 hex>)`, with a `curl` stub first on PATH standing in for
// reflection. The reviews stay canned. What is proved is the whole
// path: envelope -> classify -> reflection probe -> `null` -> AGENT_NULL ->
// parked-infra -> the barrier retry -> a second dispatch that finishes the
// task -> the run completes, the trace id on the event log.
{
  const TRACE = '53af9083708deefaa364aa37e112695d'
  const edgeTmp = fs.mkdtempSync(path.join(tmp, 'edge-'))
  const bin = path.join(edgeTmp, 'bin')
  fs.mkdirSync(bin)
  // reflection, canned by FAKE_REFLECTION.
  fs.writeFileSync(path.join(bin, 'curl'), `#!/bin/bash
case "$FAKE_REFLECTION" in
  attached) printf '%s' '{"integrations":[{"name":"github"},{"name":"claude-max"}]}' ;;
  absent) printf '%s' '{"integrations":[{"name":"github"}]}' ;;
  *) exit 22 ;;
esac
`)
  fs.chmodSync(path.join(bin, 'curl'), 0o755)
  // The fake CLI: its scenario is the file named after its cwd's basename
  // (`task-T1`) under FAKE_SCENARIO_DIR, which the stub writes before each
  // dispatch. `success` writes the task's file and answers doneImpl's shape.
  const fakeCli = path.join(edgeTmp, 'fake-claude')
  fs.writeFileSync(fakeCli, `#!/usr/bin/env node
const fs = require('fs')
const path = require('path')
const out = (line, code) => process.stdout.write(line + '\\n', () => process.exit(code))
const id = path.basename(process.cwd()).replace(/^task-/, '')
const s = fs.readFileSync(path.join(process.env.FAKE_SCENARIO_DIR, id), 'utf8').trim()
if (s === 'edge403') { out(JSON.stringify({type:'result',subtype:'success',is_error:true,terminal_reason:'api_error',api_error_status:403,result:'API Error: 403 integration not found or not attached to this VM (trace: ${TRACE})',modelUsage:{}}), 1); return }
if (s === 'auth403') { out(JSON.stringify({type:'result',subtype:'success',is_error:true,terminal_reason:'api_error',api_error_status:403,result:'API Error: 403 {"type":"error","error":{"type":"authentication_error","message":"OAuth token has been revoked"}}',modelUsage:{}}), 1); return }
fs.writeFileSync(path.join(process.cwd(), id + '.txt'), 'v1\\n')
out(JSON.stringify({type:'result',subtype:'success',is_error:false,terminal_reason:'completed',api_error_status:null,structured_output:{status:'DONE',summary:'sim work done',startHead:process.env.FAKE_START_HEAD},total_cost_usd:0,modelUsage:{}}), 0)
`)
  fs.chmodSync(fakeCli, 0o755)

  const taskOf = (id) => ({
    id, title: 't', files: [id + '.txt'], tier: 'standard', review: 'lean',
    writes: [id + '.txt'], commutes: [], proofTests: [], proofRuns: [], body: 'sim task ' + id,
  })
  const readAll = (runDir) => readEvents(runDir)

  // One run: `plan` maps a task id to the scenario of each of its implementer
  // dispatches in order (the last one repeats); `reflection` cans the probe;
  // `clock` is the worker's `now`.
  async function edgeRun({ ids, plan, reflection, clock }) {
    const { stamp, repo, runDir } = freshNames('e')
    const scenDir = path.join(runDir, 'scenarios')
    fs.mkdirSync(scenDir, { recursive: true })
    const labels = []
    const counts = new Map()
    let worker = null
    const stub = (prompt, opts, cwd) => {
      labels.push(opts.label)
      const kind = opts.label.split(':')[0]
      if (kind === 'review') return passReview()
      if (kind !== 'impl') throw new Error('unexpected dispatch: ' + opts.label)
      const id = opts.label.split(':')[1]
      const n = (counts.get(id) || 0) + 1
      counts.set(id, n)
      const steps = plan[id]
      fs.writeFileSync(path.join(scenDir, id), steps[Math.min(n, steps.length) - 1])
      return worker(prompt, opts)
    }
    const built = rig({
      repo, runDir, waves: [ids.map(taskOf)], stub, stamp, extraArgs: { infraBackoffMs: 0 },
    })
    const eventsFile = path.join(runDir, 'events.jsonl')
    worker = createRunWorker({
      runId: 'run-' + stamp, workersDir: path.join(runDir, 'workers'),
      cwdFor: (opts) => path.join(built.clonesDir, 'task-' + opts.label.split(':')[1]),
      cli: fakeCli,
      env: simEnv({ bin, env: { FAKE_SCENARIO_DIR: scenDir, FAKE_REFLECTION: reflection, FAKE_START_HEAD: built.base } }),
      onEvent: (e) => fs.appendFileSync(eventsFile, JSON.stringify(e) + '\n'),
      ...(clock ? { now: clock } : {}),
    })
    const report = await built.run()
    return { report, labels, runDir, events: readAll(runDir) }
  }
  const kinds = (events, kind) => events.filter((e) => e.kind === kind)

  // (a) one edge 403, reflection lists claude-max -> retried in the infra
  // lane, the run completes, the trace id on the event log.
  {
    const { report, labels, events } = await edgeRun({
      ids: ['T1'], plan: { T1: ['edge403', 'success'] }, reflection: 'attached',
    })
    assert.equal(countOf(labels, 'impl:T1'), 2,
      '#903 (a): the implementer is dispatched twice — once refused, once at the barrier: ' + labels.join(','))
    assert.equal(report.tasks[0].status, 'done',
      '#903 (a): the run completes: ' + JSON.stringify(report.tasks[0]) + ' | ' + shown(report))
    assert.ok(report.judgmentCalls.some((j) => String(j).includes('parked on infra-death, recovered at the barrier retry')),
      '#903 (a): recovered through the infra lane: ' + shown(report))
    const sightings = kinds(events, 'worker:edge-403')
    assert.equal(sightings.length, 1, '#903 (a): one worker:edge-403 event: ' + JSON.stringify(sightings))
    assert.equal(sightings[0].trace, TRACE, '#903 (a): the trace id is on the event log')
    assert.equal(sightings[0].probe, 'attached')
    assert.equal(sightings[0].resolution, 'infra')
    const ends = kinds(events, 'worker:end').filter((e) => e.label === 'impl:T1')
    assert.equal(ends[0].class, 'infra', '#903 (a): worker:end is the infra shape: ' + JSON.stringify(ends[0]))
    assert.equal(ends[0].status, 403)
    assert.equal(ends[0].trace, TRACE, '#903 (a): and carries the trace id')
    assert.equal(kinds(events, 'run:fatal').length, 0, '#903 (a): no run:fatal on one worker\'s 403')
  }

  // (b) reflection answers without claude-max -> the run fails naming the
  // attachment; the trace id is on the record.
  {
    const { report, events } = await edgeRun({
      ids: ['T1'], plan: { T1: ['edge403', 'success'] }, reflection: 'absent',
    })
    assert.equal(report.tasks[0].status, 'failed',
      '#903 (b): the run fails: ' + JSON.stringify(report.tasks[0]))
    assert.match(String(report.tasks[0].notes), /claude-max is not attached to this VM/,
      '#903 (b): naming the attachment: ' + JSON.stringify(report.tasks[0]))
    const fatal = kinds(events, 'run:fatal')
    assert.equal(fatal.length, 1, '#903 (b): one run:fatal: ' + JSON.stringify(fatal))
    assert.equal(fatal[0].class, 'attachment')
    assert.equal(fatal[0].trace, TRACE, '#903 (b): the trace id rides on run:fatal')
    assert.ok(kinds(events, 'worker:refused').some((e) => e.why === 'run-fatal'),
      '#903 (b): the retry is refused before spawning')
  }

  // (c) Anthropic's JSON authentication_error 403 -> fatal as today, no sighting.
  {
    const { report, events } = await edgeRun({
      ids: ['T1'], plan: { T1: ['auth403', 'success'] }, reflection: 'attached',
    })
    assert.equal(report.tasks[0].status, 'failed', '#903 (c): fatal as today: ' + JSON.stringify(report.tasks[0]))
    assert.match(String(report.tasks[0].notes), /API refused with 403 \(credential or config\)/)
    assert.equal(kinds(events, 'worker:edge-403').length, 0, '#903 (c): no attachment sighting')
    assert.equal(kinds(events, 'run:fatal')[0].class, 'credential')
  }

  // (d) two independent workers refused inside the window, reflection
  // attached -> the run fails; 121 s apart -> both recover at the barrier.
  {
    const { report, events } = await edgeRun({
      ids: ['T1', 'T2'], plan: { T1: ['edge403', 'success'], T2: ['edge403', 'success'] },
      reflection: 'attached', clock: () => 5_000_000,
    })
    assert.deepEqual(report.tasks.map((t) => t.status), ['failed', 'failed'],
      '#903 (d): two sightings inside the window fail the run: ' + JSON.stringify(report.tasks) + ' | ' + shown(report))
    const fatal = kinds(events, 'run:fatal')
    assert.equal(fatal.length, 1, '#903 (d): one run:fatal: ' + JSON.stringify(fatal))
    assert.match(fatal[0].detail, /two workers within 120 s/)
    assert.equal(fatal[0].trace, TRACE)
    assert.equal(kinds(events, 'worker:edge-403').length, 2)
  }
  {
    let t = 6_000_000
    const { report, events } = await edgeRun({
      ids: ['T1', 'T2'], plan: { T1: ['edge403', 'success'], T2: ['edge403', 'success'] },
      reflection: 'attached', clock: () => { t += ATTACHMENT_WINDOW_MS + 1000; return t },
    })
    assert.deepEqual(report.tasks.map((t) => t.status), ['done', 'done'],
      '#903 (d): 121 s apart is two blinks — both recover: ' + JSON.stringify(report.tasks) + ' | ' + shown(report))
    assert.equal(kinds(events, 'run:fatal').length, 0)
    assert.equal(kinds(events, 'worker:edge-403').length, 2)
    assert.ok(kinds(events, 'worker:edge-403').every((e) => e.resolution === 'infra' && e.trace === TRACE))
  }

  console.log('ok - #903: the edge 403 rides the infra lane end to end; the trace id reaches the event log')
}

console.log('ALL TESTS PASSED')
