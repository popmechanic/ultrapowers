// fleet/tests/test_run_engine_kata_close.mjs — Task 5's exam: a task that
// failed waits for a person, and only a task adopted into the tree is closed.
//
// This file is the Proof's `Test: fleet/tests/test_run_engine_kata_close.mjs`,
// written where the Proof names it (no EXAM PATHS line maps it elsewhere), so
// every relative import below is written for `fleet/tests/`: `../` is the
// repository's `fleet/`, `./` is this directory.
//
// The sim rig is `test_run_engine_kata.mjs`'s, COPIED here and not edited
// there: real git repositories, real `cloneAtBase` clones, the real capture and
// the real fold through the real `execSeam` — only the judgments are canned,
// and `kata`, which is the seam this task writes against. The fake client is
// that file's, with `addLabel` added and per-call refusal predicates so a leg
// can refuse ONE write and read what the engine did with the other two.
//
// The legs, and where each is asserted:
//   (a)  [M1] a two-task run where task 2 fails `fix-loop-exhausted`: exactly
//             one `addLabel` with `needs-review`, one metadata patch with
//             `work.attention` `needs-human` and `work.attention_msg`
//             beginning `failed: fix-loop-exhausted`, one comment of its own
//             carrying the notes (the fix round's `review round <n>:` post on
//             the same issue is a different write), zero `close` calls; a wave
//             the barrier blocks marks both
//             its tasks the same way and closes neither; and one refusal each
//             of the label, the patch and the comment is one
//             `kata:write-failed` with that `what`, the other two writes still
//             happen, and the engine still returns its report.
//   (a3) [M1] one row per remaining outcome: dependency-skipped → `skipped:`,
//             never attempted (absent from `taskResults`, present in the
//             record) → `unattempted:`, barrier-blocked → `blocked:`, none of
//             them closed.
//   (a4) [M1] the 200-character cap on `work.attention_msg`.
//   (a2) [M2] task 1 in the same run is closed `done` — one `close`, reason
//             `done`, BASE's message and evidence — and an all-green run makes
//             zero `addLabel` calls.
//   (b)  [M3] `addLabel` issues `POST /api/v1/projects/<id>/issues/<uid>/labels`
//             with a body naming the label and `comment`'s headers, and
//             `Object.keys(makeKataClient(...))` is BASE's set plus `addLabel`.
//   (c)  [M4] `fleet/CONTRACT.md`: the kata bullet's `needs-review` /
//             `needs-human`, every `wontfix` line qualified (and `a person` and
//             `#940` each still spelled), exactly one `412` line and it names
//             `kata:write-failed`, and the contradicting sentence gone.
//
// One note on (a4). M1 caps `work.attention_msg` at the first 200 characters of
// `<status>: <reviewVerdict>`, and no lane of `run-engine.mjs` produces a
// `reviewVerdict` longer than a short literal (`fix-loop-exhausted`,
// `proof-red`, `plan-defect`, …) — a 300-character verdict cannot be driven
// through the agent seam at all. So (a4) drives the cap with the only long text
// a failed row carries, its `notes` (a 300-character blocking detail), and
// asserts the message is never longer than 200 characters and is exactly the
// first 200 of the row's own reading, whichever of M1's two readings of that
// reading the engine writes.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { makeKataClient } from '../kata-client.mjs'
import { execSeam } from '../run-main.mjs'
import { makeCwdFor, withPatchCapture, defaultTaskIdOf } from '../run-waves.mjs'
import { runEngine, attentionMsg } from '../run-engine.mjs'
import { makeRepo, provision, passReview, cleanCritic, doneImpl }
  from './_engine_helpers.mjs'

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'engine-kata-close-')))
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }))

// ── reading what a run left behind ─────────────────────────────────────────
const eventLines = (runDir) => {
  const file = path.join(runDir, 'events.jsonl')
  if (!fs.existsSync(file)) return []
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
}
const parseLine = (l) => { try { return JSON.parse(l) } catch { return null } }
const eventsOf = (runDir) => eventLines(runDir).map(parseLine).filter(Boolean)
const writeFailures = (runDir, what) => eventsOf(runDir)
  .filter((e) => e.kind === 'kata:write-failed' && (what === undefined || e.what === what))

// ══ the fake kata ══════════════════════════════════════════════════════════
// `test_run_engine_kata.mjs`'s fake, plus `addLabel` and a `refuse` map: a
// predicate per method that makes THAT write — and only that write — throw the
// way the hub refusing it would.
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
const LABEL_BOOM = 'kata-label-boom'
const META_BOOM = 'kata-metadata-boom'
const COMMENT_BOOM = 'kata-comment-boom'

function makeFakeKata ({ record, issues, trace = [], refuse = {} }) {
  const calls = []
  const store = new Map()
  for (const [uid, iss] of Object.entries(issues)) {
    store.set(uid, { uid, revision: iss.revision, metadata: iss.metadata || {},
                     labels: [], owner: null, status: 'open' })
  }
  const lastAnswered = new Map()
  const answer = (uid, revision) => { lastAnswered.set(uid, revision); return revision }
  const need = (uid) => {
    const iss = store.get(uid)
    if (!iss) throw new Error('fake kata: no issue ' + JSON.stringify(uid) +
      ' — the run asked for an issue the record does not name')
    return iss
  }
  const issuePath = (projectId, uid) => '/api/v1/projects/' + projectId + '/issues/' + uid
  const kata = {
    async getIssue (uid) {
      const iss = need(uid)
      calls.push({ method: 'getIssue', uid, revision: iss.revision })
      trace.push('kata:getIssue:' + uid)
      answer(uid, iss.revision)
      return { uid, revision: iss.revision, metadata: iss.metadata, status: iss.status,
               owner: iss.owner, project_id: record.project.id }
    },
    async claim (projectId, uid) {
      const iss = need(uid)
      iss.owner = 'engine'
      iss.revision += 1
      calls.push({ method: 'claim', projectId, uid, revision: iss.revision })
      trace.push('kata:claim:' + uid)
      return { uid, revision: answer(uid, iss.revision) }
    },
    // The method M3 adds. Recorded BEFORE the refusal, so a leg can read what
    // the engine tried as well as what the hub allowed.
    async addLabel (projectId, uid, label) {
      calls.push({ method: 'addLabel', projectId, uid, label })
      trace.push('kata:addLabel:' + uid)
      if (refuse.label && refuse.label(label, uid)) {
        throw new FakeKataError(422, 'POST', issuePath(projectId, uid) + '/labels', LABEL_BOOM)
      }
      const iss = need(uid)
      iss.labels.push(label)
      iss.revision += 1
      return { uid, revision: answer(uid, iss.revision) }
    },
    async patchMetadata (projectId, uid, patch, revision) {
      calls.push({ method: 'patchMetadata', projectId, uid, patch, revision,
                   expectedRevision: lastAnswered.has(uid) ? lastAnswered.get(uid) : null })
      trace.push('kata:patchMetadata:' + uid)
      if (refuse.metadata && refuse.metadata(patch, uid)) {
        throw new FakeKataError(412, 'POST', issuePath(projectId, uid) + '/metadata', META_BOOM)
      }
      const iss = need(uid)
      iss.metadata = { ...iss.metadata, ...patch }
      iss.revision += 1
      return { uid, revision: answer(uid, iss.revision) }
    },
    async comment (projectId, uid, body) {
      calls.push({ method: 'comment', projectId, uid, body })
      trace.push('kata:comment:' + uid)
      if (refuse.comment && refuse.comment(body, uid)) {
        throw new FakeKataError(500, 'POST', issuePath(projectId, uid) + '/comments', COMMENT_BOOM)
      }
      const iss = need(uid)
      iss.revision += 1
      return { uid, revision: answer(uid, iss.revision) }
    },
    async close (projectId, uid, opts) {
      const iss = need(uid)
      calls.push({ method: 'close', projectId, uid, opts })
      trace.push('kata:close:' + uid)
      iss.status = 'closed'
      iss.revision += 1
      return { uid, revision: answer(uid, iss.revision) }
    },
  }
  return { kata, calls, trace, store, of: (m) => calls.filter((c) => c.method === m) }
}

// ══ the rig ════════════════════════════════════════════════════════════════
// `_engine_helpers.rig`'s body, copied here (that module is not in this task's
// Files) with `kata` and `kataRecord` passed through to `runEngine`.
function kataRig ({ repo, runDir, waves, edges = [], stub, testCmd = 'bash check.sh',
                    acceptance = { mode: 'suite', reason: 'sim' }, stamp = 'sim',
                    kata = null, extraArgs = {} }) {
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
      waves, edges, testCmd, acceptance, stamp,
      integrationBranch: 'ultra/integration-' + stamp,
      dependencyEdges: edges.map(([a, b]) => a + ' -> ' + b),
      patchInput: patchesDir,
      ...extraArgs,
    },
    agent,
    parallel: (thunks) => Promise.all(thunks.map((t) => t())),
    exec: execSeam,
    paths: { repoDir: repo, runDir, clonesDir },
    log: (l) => logs.push(String(l)),
    phase: (p) => phases.push(String(p)),
    patchBase,
    ...(kata ? { kata } : {}),
  })
  return { run, base, clonesDir, patchesDir, integ, logs, phases, patchBase }
}

// The record `fleet/launch.mjs` writes: the project, the run issue, and one
// issue per task with the revision the launcher last saw.
const PROJECT_ID = 7
const recordFor = (tasks) => ({
  url: 'https://kata.int.exe.xyz',
  project: { id: PROJECT_ID, uid: 'PROJ0', name: 'ultra-sim' },
  run: { uid: 'RUN0', revision: 1 },
  tasks,
})

// A compiled entry with no Proof paths of its own: no examiner is dispatched,
// so the only comments an issue can carry are this task's own writes and the
// `review round <n>:` post a fix round makes (`isReviewRound`, told apart
// there). The sheet the hub answers is the same list, flat.
const entry = (id, title, files) => ({
  id, title, files, tier: 'standard', review: 'lean',
  writes: files, commutes: [], proofRuns: [], body: 'sim task ' + id,
})
const sheetFor = (files) => ({ files, proofTests: [], guards: [], landing: {}, driverOwned: [] })

let seq = 0
/**
 * One engine run with the fake hub behind it. `reviewFor(id, n)` answers the
 * nth referee of task `id`; `onImpl(cwd, opts)` and `onFix(cwd, opts)` are the
 * implementer and the fix round; `refuse` is handed to the fake.
 */
async function scenario ({ waves, edges = [], stamp, onImpl, onFix, reviewFor,
                           refuse = {}, expectReject = false }) {
  seq += 1
  const repo = makeRepo(path.join(tmp, 'repo-' + seq))
  const runDir = path.join(tmp, 'run-' + seq)
  const ids = waves.flat().map((t) => t.id)
  const record = recordFor(Object.fromEntries(ids.map((id) => [id, { uid: 'U-' + id, revision: 1 }])))
  const issues = { RUN0: { revision: 1, metadata: {} } }
  for (const t of waves.flat()) {
    issues['U-' + t.id] = { revision: 1, metadata: { factsheet: sheetFor(t.files) } }
  }
  const trace = []
  const fake = makeFakeKata({ record, issues, trace, refuse })
  const labels = []
  const seen = new Map()
  const stub = async (prompt, opts, cwd) => {
    labels.push(opts.label)
    trace.push('agent:' + opts.label)
    const kind = opts.label.split(':')[0]
    const id = opts.label.split(':')[1]
    if (kind === 'impl') return onImpl(cwd, opts)
    if (kind === 'fix') return (onFix || ((c) => doneImpl(c)))(cwd, opts)
    if (kind === 'review') {
      const n = (seen.get(id) || 0) + 1
      seen.set(id, n)
      return (reviewFor || (() => passReview()))(id, n)
    }
    if (kind === 'reconcile') return { status: 'BLOCKED', summary: 'not fixable here' }
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const rigged = kataRig({
    repo, runDir, waves, edges, stub, stamp,
    kata: fake.kata, extraArgs: { kataRecord: record },
  })
  let report = null
  let error = null
  try {
    report = await rigged.run()
  } catch (e) {
    error = e
  }
  if (!expectReject && error) {
    assert.fail('the run was expected to finish and threw instead: ' +
      String((error && error.stack) || error))
  }
  return { report, error, fake, record, trace, labels, runDir, repo,
           integ: rigged.integ, logs: rigged.logs, branch: 'ultra/integration-' + stamp }
}

// ── what the hub holds for one task ────────────────────────────────────────
const ATTENTION = 'work.attention'
const ATTENTION_MSG = 'work.attention_msg'
const isAttentionPatch = (c) => c.method === 'patchMetadata' && c.patch &&
  typeof c.patch === 'object' &&
  (Object.prototype.hasOwnProperty.call(c.patch, ATTENTION) ||
   Object.prototype.hasOwnProperty.call(c.patch, ATTENTION_MSG))
// The engine's OTHER post on a task's issue: the findings a fix round is handed,
// posted before its worker starts as `review round <n>:` (#810 Phase A, M2 of
// `test_run_engine_attention.mjs`). A task whose referee refused it has one of
// those per round, and its body quotes the same blocking detail the mark's
// comment carries — so the mark is told from it by this prefix, not by its text.
const isReviewRound = (body) => /^review round \d+:/.test(String(body))
const marksFor = (sc, id) => {
  const uid = 'U-' + id
  const on = (pred) => sc.fake.calls.filter((c) => c.uid === uid && pred(c))
  const comments = on((c) => c.method === 'comment')
  return {
    uid,
    labels: on((c) => c.method === 'addLabel'),
    patches: on(isAttentionPatch),
    comments: comments.filter((c) => !isReviewRound(c.body)),
    roundComments: comments.filter((c) => isReviewRound(c.body)),
    closes: on((c) => c.method === 'close'),
  }
}

/**
 * M1's three writes, for one task, as every marking leg reads them: the label,
 * the two metadata keys with the message the leg's prefix names, one comment,
 * and no close. Answers the message so a leg can say more about it.
 */
function assertMarked (sc, id, leg, prefix) {
  const m = marksFor(sc, id)
  assert.equal(m.labels.length, 1,
    leg + ' [M1] task ' + id + ' is marked for review exactly once: one addLabel on ' + m.uid +
    '; got ' + JSON.stringify(m.labels.map((c) => c.label)))
  assert.equal(m.labels[0].label, 'needs-review',
    leg + ' [M1] the label is `needs-review`; got ' + JSON.stringify(m.labels[0].label))
  assert.equal(m.labels[0].projectId, PROJECT_ID,
    leg + ' [M1] addLabel(project.id, uid, label) — the record\'s project id')

  assert.equal(m.patches.length, 1,
    leg + ' [M1] and exactly one metadata patch carrying the attention keys (kata\'s metadata is ' +
    'a merge-patch, so the two keys are ONE call); got ' +
    JSON.stringify(m.patches.map((c) => c.patch)))
  const patch = m.patches[0].patch
  assert.deepEqual(Object.keys(patch).sort(), [ATTENTION, ATTENTION_MSG],
    leg + ' [M1] the patch is exactly the two keys; got ' + JSON.stringify(Object.keys(patch)))
  assert.equal(patch[ATTENTION], 'needs-human',
    leg + ' [M1] `work.attention` is exactly `needs-human` (the values are `ok`, `needs-human`, ' +
    '`stuck`); got ' + JSON.stringify(patch[ATTENTION]))
  assert.equal(m.patches[0].projectId, PROJECT_ID,
    leg + ' [M1] patchMetadata(project.id, uid, …)')
  const msg = patch[ATTENTION_MSG]
  assert.equal(typeof msg, 'string',
    leg + ' [M1] `work.attention_msg` is a plain string; got ' + JSON.stringify(msg))
  assert.ok(msg.startsWith(prefix),
    leg + ' [M1] `work.attention_msg` begins ' + JSON.stringify(prefix) + ' — `<status>: …` for ' +
    'the outcome this task had; got ' + JSON.stringify(msg))
  assert.ok(msg.length <= 200,
    leg + ' [M1] and is the FIRST 200 characters at most; got ' + msg.length)

  assert.equal(m.comments.length, 1,
    leg + ' [M1] and exactly one comment of the MARK\'s on ' + m.uid + ' — no `driver:*` event ' +
    'of this run names task ' + id + ', so the only comments its issue can carry are the ' +
    'mark\'s and the fix rounds\' `review round <n>:` posts; got ' +
    JSON.stringify(m.comments.map((c) => c.body)))

  assert.deepEqual(m.closes, [],
    leg + ' [M1] and the issue is NOT closed — a task the run could not finish is left open for ' +
    'a person; got ' + JSON.stringify(m.closes.map((c) => c.opts)))
  return { msg, comment: m.comments[0], patch }
}

// ══ (a)/(a2) [M1][M2] two tasks, task 2 fails its fix loop ═════════════════
// T1 passes review and is adopted; T2's referee refuses it twice, which is the
// `fix-loop-exhausted` row (`status` `failed`).
const T1_TITLE = 'write T1.txt into the tree, the adopted half of the wave'
const T2_TITLE = 'write T2.txt, the half the referee never accepts'
const T2_NOTES = 'T2 is wrong in a way the sim reviewer never accepts'
const failT2 = (id, n) => (id === 'T2'
  ? { verdict: 'FIX_REQUIRED', issues: [{ severity: 'blocking', detail: T2_NOTES }] }
  : passReview())
const writeOwn = (cwd, opts) => {
  fs.writeFileSync(path.join(cwd, opts.label.split(':')[1] + '.txt'), 'work from ' + opts.label + '\n')
  return doneImpl(cwd)
}

const pair = () => [[entry('T1', T1_TITLE, ['T1.txt']), entry('T2', T2_TITLE, ['T2.txt'])]]

const s1 = await scenario({
  waves: pair(), stamp: 'one', onImpl: writeOwn, onFix: writeOwn, reviewFor: failT2,
})
{
  const row2 = s1.report.tasks.find((r) => r.task === 'T2')
  assert.ok(row2, '(a) [M1] the run produced a row for T2; rows: ' +
    JSON.stringify(s1.report.tasks.map((r) => [r.task, r.status])))
  assert.equal(row2.status, 'failed',
    '(a) fixture: a referee that refuses twice leaves T2 `failed`; got ' + row2.status)
  assert.equal(row2.reviewVerdict, 'fix-loop-exhausted',
    '(a) fixture: with reviewVerdict `fix-loop-exhausted`; got ' + row2.reviewVerdict)
  assert.equal(row2.notes, T2_NOTES,
    '(a) fixture: and the blocking detail as its notes; got ' + JSON.stringify(row2.notes))

  const marked = assertMarked(s1, 'T2', '(a)', 'failed: fix-loop-exhausted')
  assert.ok(marked.comment.body.includes(T2_NOTES),
    '(a) [M1] the comment carries the result\'s NOTES — the honest reading of why the task did ' +
    'not finish; got ' + JSON.stringify(marked.comment.body))
  assert.equal(marked.comment.projectId, PROJECT_ID,
    '(a) [M1] comment(project.id, uid, body)')

  // (a2) [M2] the adopted half of the same run closes exactly as at BASE.
  const row1 = s1.report.tasks.find((r) => r.task === 'T1')
  assert.equal(row1.status, 'done',
    '(a2) fixture: T1 is adopted — ' + row1.reviewVerdict + ': ' + row1.notes +
    '\njudgment calls: ' + JSON.stringify(s1.report.judgmentCalls, null, 1))
  const merge = s1.report.waveMerges[0]
  assert.equal(merge.status, 'MERGED',
    '(a2) fixture: wave 1 adopts T1; got ' + JSON.stringify(merge))
  const closes = s1.fake.of('close')
  assert.equal(closes.length, 1,
    '(a2) [M2] the run makes EXACTLY ONE close — the task it adopted, and nothing else; got ' +
    JSON.stringify(closes.map((c) => [c.uid, c.opts && c.opts.reason])))
  assert.equal(closes[0].uid, 'U-T1', '(a2) [M2] on T1\'s issue')
  assert.equal(closes[0].projectId, PROJECT_ID, '(a2) [M2] close(project.id, uid, …)')
  assert.equal(closes[0].opts.reason, 'done',
    '(a2) [M2] with reason `done` — the one reason a run\'s own close may carry')
  assert.equal(closes[0].opts.message,
    'adopted in wave 1 (' + row1.reviewVerdict + '): ' + T1_TITLE + ' — merged ' + merge.headSha,
    '(a2) [M2] BASE\'s message, `adopted in wave <n> (<verdict>): <title> — merged <sha>`; got ' +
    JSON.stringify(closes[0].opts.message))
  assert.ok(closes[0].opts.message.length >= 40,
    '(a2) [M2] which kata needs at least 40 characters of; got ' + closes[0].opts.message.length)
  assert.deepEqual(closes[0].opts.evidence,
    [{ type: 'commit', sha: merge.headSha }, { type: 'test', command: 'bash check.sh' }],
    '(a2) [M2] and BASE\'s evidence — the merge sha and the command the task is measured by; got ' +
    JSON.stringify(closes[0].opts.evidence))
  assert.equal(closes[0].opts.idempotencyKey, 'one:T1:close',
    '(a2) [M2] under `<runId>:<task>:close`; got ' + JSON.stringify(closes[0].opts.idempotencyKey))

  const t1 = marksFor(s1, 'T1')
  assert.deepEqual(t1.labels, [],
    '(a2) [M2] the adopted task is NOT labelled `needs-review`; got ' + JSON.stringify(t1.labels))
  assert.deepEqual(t1.patches, [],
    '(a2) [M2] nor given an attention; got ' + JSON.stringify(t1.patches.map((c) => c.patch)))
}

// ══ (a) [M1] one refusal at a time: the other two writes still happen ═══════
for (const [what, refuse, boom] of [
  ['label', { label: () => true }, LABEL_BOOM],
  // Only the ATTENTION patch is refused: the `touched_files` patches the fix
  // round makes are a different write and a different `kata:write-failed`.
  ['metadata', { metadata: (p) => Object.prototype.hasOwnProperty.call(p, ATTENTION) }, META_BOOM],
  // Likewise the mark's own comment, not every mirrored `driver:*` line — and
  // not the fix round's `review round <n>:` post, which quotes the same
  // blocking detail and is a different write with its own refusal leg.
  ['comment', { comment: (b) => String(b).includes(T2_NOTES) && !isReviewRound(b) }, COMMENT_BOOM],
]) {
  const sc = await scenario({
    waves: pair(), stamp: 'ref-' + what, onImpl: writeOwn, onFix: writeOwn,
    reviewFor: failT2, refuse,
  })
  const leg = '(a) refusing ' + what + ':'
  assert.ok(sc.report && typeof sc.report === 'object',
    leg + ' [M1] the engine still RETURNS its report — a write the hub refuses is not the run\'s ' +
    'failure; got ' + JSON.stringify(sc.report))
  assert.equal(sc.report.tasks.find((r) => r.task === 'T1').status, 'done',
    leg + ' [M1] and the run goes on: T1 is still adopted')

  const failures = writeFailures(sc.runDir, what)
  assert.equal(failures.length, 1,
    leg + ' [M1] exactly one `kata:write-failed` event with `what: ' + JSON.stringify(what) +
    '`; got ' + JSON.stringify(writeFailures(sc.runDir)))
  assert.equal(failures[0].uid, 'U-T2',
    leg + ' [M1] naming the issue the write was for; got ' + JSON.stringify(failures[0].uid))
  assert.ok(String(failures[0].detail).includes(boom),
    leg + ' [M1] and carrying the KataError\'s own message; got ' +
    JSON.stringify(failures[0].detail))

  // The other two writes are attempted and land.
  const m = marksFor(sc, 'T2')
  assert.equal(m.labels.length, 1,
    leg + ' [M1] the label write still happens; got ' + JSON.stringify(m.labels))
  assert.equal(m.patches.length, 1,
    leg + ' [M1] the metadata patch still happens; got ' + JSON.stringify(m.patches.map((c) => c.patch)))
  assert.equal(m.comments.length, 1,
    leg + ' [M1] the comment still happens; got ' + JSON.stringify(m.comments.map((c) => c.body)))
  assert.deepEqual(m.closes, [],
    leg + ' [M1] and nothing is closed; got ' + JSON.stringify(m.closes.map((c) => c.opts)))
}

// ══ (a)/(a3) [M1] a wave the barrier blocks, and the wave after it ═════════
// B1 breaks the suite the fold runs, B2 is clean; the reconcile agent refuses,
// so the wave is TEST_FAILED and neither task landed. B3 sits in wave 2, which
// the run never reaches: absent from `taskResults`, present in the record.
{
  const waves = [
    [entry('B1', 'the half that breaks the fold', ['B1.txt']),
     entry('B2', 'the half that is clean', ['B2.txt'])],
    [entry('B3', 'the wave the run never reached', ['B3.txt'])],
  ]
  const sc = await scenario({
    waves, stamp: 'blk',
    onImpl: (cwd, opts) => {
      const id = opts.label.split(':')[1]
      fs.writeFileSync(path.join(cwd, id + '.txt'), 'work from ' + id + '\n')
      if (id === 'B1') fs.writeFileSync(path.join(cwd, 'BROKEN'), 'oops\n')
      return doneImpl(cwd)
    },
  })
  assert.equal(sc.report.waveMerges[0].status, 'TEST_FAILED',
    '(a) fixture: the candidate suite is red and the reconcile agent refuses, so wave 1 is ' +
    'TEST_FAILED; got ' + JSON.stringify(sc.report.waveMerges[0]))
  for (const id of ['B1', 'B2']) {
    assertMarked(sc, id, '(a) wave-blocked', 'blocked:')
  }
  assert.deepEqual(sc.fake.of('close'), [],
    '(a) [M1] a wave the barrier could not make green closes NOTHING; got ' +
    JSON.stringify(sc.fake.of('close').map((c) => [c.uid, c.opts && c.opts.reason])))
  for (const uid of ['U-B1', 'U-B2', 'U-B3']) {
    assert.equal(sc.fake.store.get(uid).status, 'open',
      '(a) [M1] every issue of the run is still `open` on the hub — ' + uid)
  }

  // (a3) the task the run never attempted.
  assert.ok(!sc.report.tasks.some((r) => r && r.task === 'B3'),
    '(a3) fixture: B3 produced no row — the run died before its wave; rows: ' +
    JSON.stringify(sc.report.tasks.map((r) => r.task)))
  assert.ok(Object.prototype.hasOwnProperty.call(sc.record.tasks, 'B3'),
    '(a3) fixture: and the record names it')
  assertMarked(sc, 'B3', '(a3) unattempted', 'unattempted:')
}

// ══ (a3) [M1] a task skipped because its wave-1 dependency failed ══════════
{
  const waves = [
    [entry('D1', 'the dependency that fails its fix loop', ['D1.txt'])],
    [entry('D2', 'the dependent the engine skips', ['D2.txt'])],
  ]
  const sc = await scenario({
    waves, edges: [['D1', 'D2']], stamp: 'dep', onImpl: writeOwn, onFix: writeOwn,
    reviewFor: () => ({ verdict: 'FIX_REQUIRED',
                        issues: [{ severity: 'blocking', detail: 'D1 never gets there' }] }),
  })
  const d1 = sc.report.tasks.find((r) => r.task === 'D1')
  assert.equal(d1 && d1.status, 'failed',
    '(a3) fixture: D1\'s fix loop is exhausted; got ' + JSON.stringify(d1))
  assert.ok(!sc.report.tasks.some((r) => r && r.task === 'D2'),
    '(a3) fixture: D2 was never dispatched — its wave-1 dependency failed; rows: ' +
    JSON.stringify(sc.report.tasks.map((r) => r.task)))
  assertMarked(sc, 'D1', '(a3) failed', 'failed: fix-loop-exhausted')
  assertMarked(sc, 'D2', '(a3) skipped', 'skipped:')
  assert.deepEqual(sc.fake.of('close'), [],
    '(a3) [M1] and neither is closed; got ' +
    JSON.stringify(sc.fake.of('close').map((c) => [c.uid, c.opts && c.opts.reason])))
}

// ══ (a4) [M1] the 200-character cap ════════════════════════════════════════
// The long text a failed row carries is its `notes` (see the header note: no
// engine lane makes a `reviewVerdict` longer than a short literal). The message
// is the first 200 characters of the row's own reading and never more.
{
  const LONG = 'the referee refuses this patch for the same reason twice over; '.repeat(8).slice(0, 300)
  assert.equal(LONG.length, 300, 'fixture: the blocking detail is 300 characters long')
  const sc = await scenario({
    waves: [[entry('L1', 'the task whose reading runs long', ['L1.txt'])]],
    stamp: 'cap', onImpl: writeOwn, onFix: writeOwn,
    reviewFor: () => ({ verdict: 'FIX_REQUIRED', issues: [{ severity: 'blocking', detail: LONG }] }),
  })
  const row = sc.report.tasks.find((r) => r.task === 'L1')
  assert.equal(row && row.status, 'failed', '(a4) fixture: L1 failed; got ' + JSON.stringify(row))
  assert.equal(row.notes, LONG, '(a4) fixture: carrying the 300-character detail as its notes')
  const { msg } = assertMarked(sc, 'L1', '(a4)', 'failed: fix-loop-exhausted')
  const short = 'failed: ' + row.reviewVerdict
  const long = short + ' — ' + row.notes
  assert.ok(long.length > 200,
    '(a4) fixture: the row\'s full reading is longer than 200 characters (' + long.length + ')')
  assert.ok(msg === short.slice(0, 200) || msg === long.slice(0, 200),
    '(a4) [M1] `work.attention_msg` is the FIRST 200 CHARACTERS of the row\'s own reading — ' +
    JSON.stringify(short.slice(0, 200)) + ' or ' + JSON.stringify(long.slice(0, 200)) + '; got ' +
    JSON.stringify(msg))
  assert.ok(msg.length <= 200,
    '(a4) [M1] and is never longer than 200 characters; got ' + msg.length)
  if (msg !== short) {
    assert.equal(msg.length, 200,
      '(a4) [M1] a reading this long is stored at exactly 200 characters; got ' + msg.length)
  }

  // The cap itself, driven directly. No engine lane makes a `reviewVerdict`
  // longer than a short literal (`fix-loop-exhausted`, `proof-red`, …), so the
  // run above cannot reach the truncation; this asserts it on the helper the
  // engine writes with, so deleting the `.slice(0, 200)` fails this leg.
  const LONG_VERDICT = 'v'.repeat(300)
  assert.equal(attentionMsg('failed', LONG_VERDICT).length, 200,
    '(a4) [M1] a 300-character verdict stores EXACTLY 200 characters; got ' +
    attentionMsg('failed', LONG_VERDICT).length)
  assert.equal(attentionMsg('failed', LONG_VERDICT), ('failed: ' + LONG_VERDICT).slice(0, 200),
    '(a4) [M1] equal to the first 200 characters of `failed: <verdict>`')
  assert.equal(attentionMsg('failed', 'fix-loop-exhausted'), 'failed: fix-loop-exhausted',
    '(a4) [M1] and a verdict shorter than the cap is stored whole')
}

// ══ (a2) [M2] a run where every task is done marks nothing ═════════════════
{
  const sc = await scenario({
    waves: [[entry('G1', 'the first green task of the run', ['G1.txt']),
             entry('G2', 'the second green task of the run', ['G2.txt'])]],
    stamp: 'grn', onImpl: writeOwn,
  })
  assert.deepEqual(sc.report.tasks.map((r) => r.status), ['done', 'done'],
    '(a2) fixture: both tasks are done; rows: ' +
    JSON.stringify(sc.report.tasks.map((r) => [r.task, r.status, r.notes])) +
    '\njudgment calls: ' + JSON.stringify(sc.report.judgmentCalls, null, 1))
  assert.deepEqual(sc.fake.of('addLabel'), [],
    '(a2) [M2] a run where every task is done makes ZERO addLabel calls; got ' +
    JSON.stringify(sc.fake.of('addLabel')))
  assert.deepEqual(sc.fake.calls.filter(isAttentionPatch), [],
    '(a2) [M2] and no attention patch at all; got ' +
    JSON.stringify(sc.fake.calls.filter(isAttentionPatch).map((c) => c.patch)))
  const closes = sc.fake.of('close')
  assert.deepEqual(closes.map((c) => c.uid).sort(), ['U-G1', 'U-G2'],
    '(a2) [M2] both adopted tasks are closed; got ' + JSON.stringify(closes.map((c) => c.uid)))
  assert.ok(closes.every((c) => c.opts.reason === 'done'),
    '(a2) [M2] each with reason `done`; got ' + JSON.stringify(closes.map((c) => c.opts.reason)))
}

// ══ (b) [M3] the client's new method ═══════════════════════════════════════
{
  // BASE's key set, read from `fleet/kata-client.mjs` at
  // f262d60f4d0575aa94acc31ad42705333fa04419 and spelled here so the leg can
  // say "that set, plus addLabel" without a second checkout.
  const BASE_KEYS = ['ping', 'createProject', 'purgeProject', 'createIssue', 'link', 'getIssue',
                     'claim', 'patchMetadata', 'comment', 'close', 'listProjects', 'listIssues',
                     'events']
  const sent = []
  const transport = {
    async request (spec) {
      sent.push(spec)
      return { status: 200, json: { issue: { uid: spec.path.split('/')[5], revision: 9 } }, body: '{}' }
    },
  }
  const client = makeKataClient({ transport, actor: 'sim-actor' })

  assert.deepEqual(Object.keys(client).sort(), BASE_KEYS.concat(['addLabel']).sort(),
    '(b) [M3] Object.keys(makeKataClient(…)) is BASE\'s set PLUS addLabel and nothing else — no ' +
    'other method changes; got ' + JSON.stringify(Object.keys(client)))
  assert.equal(typeof client.addLabel, 'function',
    '(b) [M3] addLabel(projectId, uid, label) is a function on the client')

  await client.comment(PROJECT_ID, 'U-1', 'the comment method\'s conventions')
  const commentSpec = sent[sent.length - 1]
  await client.addLabel(PROJECT_ID, 'U-1', 'needs-review')
  const labelSpec = sent[sent.length - 1]

  assert.equal(labelSpec.method, 'POST', '(b) [M3] addLabel POSTs; got ' + labelSpec.method)
  assert.equal(labelSpec.path, '/api/v1/projects/' + PROJECT_ID + '/issues/U-1/labels',
    '(b) [M3] to /api/v1/projects/<id>/issues/<uid>/labels; got ' + JSON.stringify(labelSpec.path))
  assert.deepEqual(labelSpec.headers, commentSpec.headers,
    '(b) [M3] with the SAME headers the comment method sends (' +
    JSON.stringify(commentSpec.headers) + '); got ' + JSON.stringify(labelSpec.headers))
  assert.ok(labelSpec.body && typeof labelSpec.body === 'object' && !Array.isArray(labelSpec.body),
    '(b) [M3] and a JSON body; got ' + JSON.stringify(labelSpec.body))
  const names = (v) => (v === 'needs-review') ||
    (Array.isArray(v) && v.some(names)) ||
    (v && typeof v === 'object' && Object.values(v).some(names))
  assert.ok(names(labelSpec.body),
    '(b) [M3] whose body NAMES the label; got ' + JSON.stringify(labelSpec.body))
  assert.ok(Object.prototype.hasOwnProperty.call(labelSpec.body, 'actor'),
    '(b) [M3] and carries `actor`, as every mutation of this client\'s does (the daemon runs in ' +
    'static-token mode); got ' + JSON.stringify(labelSpec.body))
}

// ══ (c) [M4] the contract ══════════════════════════════════════════════════
{
  const contractPath = fileURLToPath(new URL('../CONTRACT.md', import.meta.url))
  assert.ok(fs.existsSync(contractPath), '(c) [M4] fleet/CONTRACT.md exists at ' + contractPath)
  const text = fs.readFileSync(contractPath, 'utf8')
  const lines = text.split('\n')

  // The kata bullet says a failed task stays open, marked.
  const at = lines.findIndex((l) => l.startsWith('- **Kata record (engine):**'))
  assert.notEqual(at, -1, '(c) [M4] the file carries a `- **Kata record (engine):**` bullet')
  const nextBullet = lines.findIndex((l, i) => i > at && l.startsWith('- **'))
  assert.notEqual(nextBullet, -1, '(c) [M4] a bullet follows it')
  const block = lines.slice(at, nextBullet).join(' ')
  assert.ok(/needs-review[\s\S]*needs-human/.test(block),
    '(c) [M4] and the bullet says a failed task stays open with `needs-review` and `needs-human`, ' +
    'in that order — what the Proof\'s `sed … | grep -q \'needs-review.*needs-human\'` reads; the ' +
    'bullet reads: ' + block)

  // `wontfix` is reserved: the run issue's park (#940) and a person's decision.
  const wontfix = lines.filter((l) => l.includes('wontfix'))
  assert.ok(wontfix.length > 0,
    '(c) [M4] the contract still speaks about `wontfix` — the reservation is a rule, not a deletion')
  const unqualified = wontfix.filter((l) =>
    !(l.includes('run issue') || l.includes('#940') || l.includes('a person')))
  assert.deepEqual(unqualified, [],
    '(c) [M4] every line that contains `wontfix` also contains `run issue`, `#940` or `a person`; ' +
    'these do not: ' + JSON.stringify(unqualified))
  assert.ok(wontfix.some((l) => l.includes('a person')),
    '(c) [M4] at least one `wontfix` line names `a person` — a decision, not the driver\'s own ' +
    'close; lines: ' + JSON.stringify(wontfix))
  assert.ok(wontfix.some((l) => l.includes('#940')),
    '(c) [M4] and at least one names `#940`, the run issue\'s own park; lines: ' +
    JSON.stringify(wontfix))

  // One sentence on a 412 at `touched_files`, and the contradicting one gone.
  const fourTwelve = lines.filter((l) => l.includes('412'))
  assert.equal(fourTwelve.length, 1,
    '(c) [M4] exactly ONE line of the contract contains `412`; got ' + fourTwelve.length + ': ' +
    JSON.stringify(fourTwelve))
  assert.ok(fourTwelve[0].includes('kata:write-failed'),
    '(c) [M4] and that line says what a 412 on `touched_files` does — recorded as ' +
    '`kata:write-failed`, the run goes on; got ' + JSON.stringify(fourTwelve[0]))
  assert.ok(!text.includes('a 412 there ends the run'),
    '(c) [M4] and the contradicting sentence `a 412 there ends the run` is gone')
}

console.log('ALL TESTS PASSED')
