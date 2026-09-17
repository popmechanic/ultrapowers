/**
 * fleet/tests/test_run_engine_jev_finding.mjs — the exam for Task 1 of #1096:
 * *a `jev:finding` row beside every reviewer-returned blocking finding*.
 *
 * The Proof named no `EXAM PATHS:` landing of its own, so this file sits where
 * the Proof's `Test:` slot names it and every relative path below is written
 * for `fleet/tests/`: `./_engine_helpers.mjs` is the shared rig,
 * `../jev-client.mjs` is the real client the sims drive.
 *
 * ── what each Machine clause asserts, restated ──────────────────────────────
 *   M1 — in a review round, after the `seenIssue` dedup and before the
 *        no-recognizable-verdict fallback, each reviewer-returned `blocking`
 *        issue calls `jevRow` once with
 *        `row` `{ kind: 'jev:finding', task: task.id, round: iter,
 *                 key: (severity || '') + '|' + (detail || '') }`
 *        and state `{ task: { title, claim, machine, files },
 *                     finding: { text: detail, severity, actor }, hunks }`,
 *        `hunks` being the `diff --git` sections of the captured patch whose
 *        `b/` path is in `pathsNamedIn(detail)` (the whole patch when that list
 *        is empty), and the four questions of the shared literal keyed
 *        `borne_out`, `actor`, `claim_false`, `fixable_in_files`; an answer
 *        appends one `{kind, task, round, key, answers}` row to `events.jsonl`,
 *        in the round's issue order, and posts it on the task's hub issue when
 *        a hub is on.
 *   M2 — no row for a `minor` issue, for a blocking issue the DRIVER minted
 *        itself (a red `Run:`, a red exam, a red `Check:`), when `ask` resolves
 *        `null`, or when the engine was handed no `jev`.
 *   M3 — for the same canned replies, a run with `jev` and a run without it
 *        dispatch the same worker labels in the same order and end with the
 *        same `reviewVerdict`, `fixIterations` and `status` per task, the same
 *        `driver:finding` rows (by `task`, `round`, `detail`) and the same
 *        `judgmentCalls` lines.
 *
 * ── the legs, and where each is answered ────────────────────────────────────
 *   (a) [M1] the fix-round run (one `blocking` + one `minor` in round 1) with
 *       `jev` and a hub on: exactly one `jev:finding` row, its `task`, `round`,
 *       `key` and four answer keys; exactly one recorded request, its four
 *       questions and their types and criteria keys, its `state.finding.text`,
 *       `state.task.files` and the `A.txt`-only `state.hunks`; and the row's
 *       events.jsonl line, verbatim, among the comments on A's issue.
 *   (b) [M1] a second run whose detail names no path: `state.hunks` carries the
 *       whole patch — both `A.txt` and `B.txt`. (Its task body carries neither
 *       a `**Claim:**` nor a `Machine:` line, which is M1's empty-string case.)
 *   (c) [M2] leg (a)'s run has no `minor|` row and made no second call; the
 *       driver-minted run leaves zero rows and zero requests; a `fetchImpl`
 *       answering 500 leaves zero rows and moves nothing; and leg (a)'s
 *       scenario with no `jev` at all leaves zero rows.
 *   (d) [M3] leg (a)'s scenario run twice, with `jev` and without: the same
 *       dispatched labels in the same order, the same per-task triple, the same
 *       `driver:finding` rows and the same `judgmentCalls`.
 *
 * ── two readings of the Proof, settled against the engine at BASE ───────────
 * Both were run at b16dbdb1 before this file was written; both are filed as
 * `unsatisfiable` entries on the task's issue, and neither touches what M1 and
 * M2 assert.
 *
 *  1. Legs (a) and (d) name a `fix:A:1` round and an `A` that ends
 *     `done`/`fixed`/`fixIterations 1`. Since #964 Task 2 the review loop
 *     dispatches NO fix worker from a reviewer's blocking finding
 *     (`fleet/run-engine.mjs`, the `fix-loop-exhausted` exit): the leg-(a)
 *     scenario dispatches exactly `impl:A` then `review:A:1` and ends
 *     `failed`/`fix-loop-exhausted`/`0`, and `review:A:2` is never asked for.
 *     The round-1 `jev:finding` row is minted on that path all the same, so
 *     legs (a), (b) and (c) are untouched by this. Leg (d)'s M3 SAMENESS is
 *     encoded in full below; its parenthesised literals are pinned to what the
 *     engine actually produces for that scenario, because the Global
 *     Constraints forbid this task's row from moving any verdict, route or
 *     status — an exam pinning `fixed`/`1`/`done` could not be passed by a
 *     correct implementation.
 *  2. Leg (c)'s driver-minted run cannot both end `done` and carry a
 *     `driver:finding` row whose detail begins `the Proof's Run: command
 *     failed`. With `proofRuns: ['test -f FIXED']`, an implementer that writes
 *     no `FIXED` and a `fix:A:0` that writes nothing, the pre-review pass is
 *     red twice and the task parks at `proof-red` before any reviewer is
 *     dispatched — `fix:A:1` is never dispatched and no review round mints
 *     anything. The scenario the leg names is kept exactly as it names it; what
 *     is asserted on it is M2's own claim (zero rows, zero requests) plus the
 *     driver's red-`Run:` reading where the engine records it.
 *
 * ── the rig ─────────────────────────────────────────────────────────────────
 * The shared engine rig: real git repositories, real clones, the real capture
 * and the real fold kernel below the agent seam; only the judgments are canned.
 * Jev is the REAL client (`fleet/jev-client.mjs`) over an injected `fetchImpl`
 * that records each request's parsed body, and the hub is `fakeHub` over an
 * in-memory store — so no sim opens a socket and every request's `state` and
 * `questions` are read off the record rather than off the engine.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { rig, makeRepo, passReview, cleanCritic, doneImpl, fakeHub } from './_engine_helpers.mjs'
import { makeJevClient } from '../jev-client.mjs'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-jev-finding-'))
// Removed on exit, red or green.
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }))

// ── the task text the sims grade ────────────────────────────────────────────
// One `**Claim:**` line with no continuation, so `claim` is that line's text
// with the marker removed and nothing else; a `Machine:` block of two lines
// ended by a blank line, with a sentinel past it that `machine` may not carry.
const CLAIM_A = 'do: run the plan; see: `A.txt` still holds line2. (derived)'
const MACHINE_1 = 'M1. `A.txt` holds the line `line2`.'
const MACHINE_2 = 'M2. Nothing outside `A.txt` is read.'
const PAST_THE_BLANK = 'NOT-MACHINE: past the blank line that ends the Machine block.'
const BODY_A = [
  '### Task A: keep line2',
  '',
  '**Files:**',
  '- Modify: `A.txt`',
  '',
  '**Claim:** ' + CLAIM_A,
  'Machine: ' + MACHINE_1,
  MACHINE_2,
  '',
  PAST_THE_BLANK,
  '',
  '**Proof:**',
  '- Legs: (a) `A.txt` holds line2 [M1]',
].join('\n')

const TITLE_A = 'keep line2'
const DETAIL_A = 'the change to `A.txt` drops line2'
const KEY_A = 'blocking|' + DETAIL_A
const DETAIL_NO_PATH = 'the change is incomplete'
const ANSWER_KEYS = ['actor', 'borne_out', 'claim_false', 'fixable_in_files']

// ── the four questions, verbatim (M1) ───────────────────────────────────────
// The shared literal the clause names: the first is `jev_hunks.py`'s
// `borne_out` with `hunk` read as `hunks`, the next two `jev_residuals.py`'s,
// the fourth new. Transcribed from the task text and compared whole.
const QUESTIONS = {
  borne_out: {
    type: 'noul',
    instructions: {
      question: 'Does `hunks` (unified diffs of the files the finding names, or the whole patch)' +
        ' contain the code that `finding.text` describes, so that the finding is about this change?',
      context: 'A code referee wrote `finding` about `task`\'s patch. You are shown the diff of' +
        ' the files the finding names. Judge from the code, not from a path name that may appear' +
        ' in the finding.',
    },
    criteria: {
      true: 'The lines the finding reasons about are in these hunks',
      false: 'These hunks are about something else; the finding does not concern these lines',
    },
  },
  actor: {
    type: 'choice',
    instructions: {
      question: 'Who would have to act to resolve `finding.text`?',
      context: 'The implementer can only edit paths in `task.files`. The plan author owns the' +
        ' task text (Claim, Machine clauses, Files, Proof). The examiner owns the exam file.',
    },
    criteria: {
      implementer: 'An edit inside `task.files` by the implementer resolves it',
      plan: 'Only a change to the task text, its Files set, or its Proof resolves it; no edit' +
        ' inside `task.files` can',
      examiner: 'Only a change to the exam or a Proof leg resolves it',
      nobody: 'It is an observation, a deferral, or already resolved; nothing needs doing',
    },
  },
  claim_false: {
    type: 'noul',
    instructions: 'Taken at face value, does `finding.text` describe a defect that would make' +
      ' `task.claim` false as delivered?',
    criteria: {
      true: 'If the finding is right, the claim is not established',
      false: 'The claim could still hold; the finding is about something else',
    },
  },
  fixable_in_files: {
    type: 'noul',
    instructions: {
      question: 'Can `finding.text` be resolved by one round of edits inside `task.files` alone?',
      context: 'The implementer gets one fix round and may edit only paths in `task.files`.',
    },
    criteria: {
      true: 'One round of edits inside `task.files` resolves it',
      false: 'It needs a file outside `task.files`, a change to the task text, or more than one round',
    },
  },
}

// ── reading the record ──────────────────────────────────────────────────────
const linesOf = (runDir) => {
  const file = path.join(runDir, 'events.jsonl')
  if (!fs.existsSync(file)) return []
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
}
const eventsOf = (runDir) => linesOf(runDir)
  .map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
const ofKind = (events, kind) => events.filter((e) => e && e.kind === kind)
// The `b/` path of every `diff --git` header in a blob of patch text.
const headerPathsIn = (text) => {
  const out = []
  for (const m of String(text == null ? '' : text).matchAll(/^diff --git a\/(\S+) b\/(\S+)$/gm)) {
    out.push(m[2])
  }
  return out.sort()
}
// The five fields M1 names on the row, with `appendEvent`'s own `id`/`ts` off.
const rowShape = (row) => {
  const out = { ...row }
  delete out.id
  delete out.ts
  return out
}

// ── one sim ─────────────────────────────────────────────────────────────────
// `jevOn` false hands the engine no client at all (M2's fourth case); `status`
// is what the fake edge answers. Every request's parsed body is recorded, so
// the assertions read the wire rather than the engine.
let seq = 0
async function scenario ({ task, reply, onLabel = () => {}, jevOn = true, status = 200 }) {
  seq += 1
  const stamp = 'jf' + seq
  const repo = makeRepo(path.join(tmp, 'repo-' + stamp))
  const runDir = path.join(tmp, 'run-' + stamp)
  const requests = []
  const fetchImpl = async (url, opts) => {
    const body = JSON.parse(String((opts || {}).body || 'null'))
    requests.push({ url: String(url), headers: (opts || {}).headers, body })
    if (status !== 200) return { status, text: async () => 'the edge said no' }
    const answers = {}
    for (const [id, q] of Object.entries((body && body.questions) || {})) {
      answers[id] = (q && q.type === 'choice')
        ? { type: 'choice', choice: 'implementer', probabilities: { implementer: 1 }, confidence: 1 }
        : { type: 'noul', noul: 0.5 }
    }
    return { status: 200, text: async () => JSON.stringify({ answers }) }
  }
  const UID = 'UID-' + stamp
  const RUN_UID = 'RUN-' + stamp
  const PROJECT_ID = 'proj-' + stamp
  const hub = fakeHub({ projectId: PROJECT_ID,
    issues: { [UID]: { revision: 1, short_id: 'aa11' },
              [RUN_UID]: { revision: 1, short_id: 'rr11' } } })
  const kataRecord = {
    url: 'https://kata.invalid',
    project: { id: PROJECT_ID, uid: 'PROJ-' + stamp, name: 'ultrapowers' },
    run: { uid: RUN_UID, revision: 1 },
    tasks: { [task.id]: { uid: UID, short_id: 'aa11', revision: 1 } },
  }
  const labels = []
  const stub = (prompt, opts, cwd) => {
    const label = String(opts.label)
    labels.push(label)
    const answer = onLabel(label, cwd)
    if (answer !== undefined) return answer
    if (label.startsWith('impl:') || label.startsWith('fix:')) {
      // The patch two files wide: the detail of leg (a) names `A.txt` only, so
      // `B.txt` is the header `state.hunks` must not carry there and must carry
      // in leg (b).
      fs.writeFileSync(path.join(cwd, 'A.txt'), 'line1\nline3\n')
      fs.writeFileSync(path.join(cwd, 'B.txt'), 'b\n')
      return doneImpl(cwd)
    }
    if (label.startsWith('review:')) return reply(label)
    if (label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + label)
  }
  const { run } = rig({
    repo, runDir, waves: [[task]], stub, stamp,
    kata: hub.kata,
    ...(jevOn ? { jev: makeJevClient({ baseUrl: 'https://jev.invalid', fetchImpl }) } : {}),
    // The worker's raised hand is not this exam's subject: a poll far longer
    // than the sim keeps the hub's call log to the run's own record.
    extraArgs: { kataRecord, attentionPollMs: 3600000 },
  })
  const report = await run()
  const events = eventsOf(runDir)
  return {
    report, events, requests, hub, labels, runDir, uid: UID,
    // `requests` is EVERY call the engine's one Jev client made. The
    // `jev:tier` row rides that same client (#1096 row 2) — one call at
    // dispatch and one at each review dispatch — so a wire-level count of
    // this row's calls reads `findingRequests`: a `jev:finding` call is the
    // one whose `state` carries the `finding` it was raised for, which no
    // `jev:tier` state has. The per-kind counts below (`rows`) already read
    // the row kind; this is the same reading taken on the wire.
    findingRequests: requests.filter((r) => ((r.body || {}).state || {}).finding),
    lines: linesOf(runDir),
    rows: ofKind(events, 'jev:finding'),
    findings: ofKind(events, 'driver:finding'),
    rowOf: (id) => report.tasks.find((r) => r && r.task === id),
  }
}

// The task of legs (a), (c) and (d): one file, a body with a Claim and a
// Machine block, no `Run:` proof of its own.
const taskA = (over = {}) => ({
  id: 'A', title: TITLE_A, files: ['A.txt'], tier: 'standard', review: 'peer',
  writes: ['A.txt'], commutes: [], proofTests: [], proofRuns: [], body: BODY_A, ...over,
})
// The round-1 reply leg (a) names: exactly one `blocking` issue and one
// `minor`. Round 2 answers PASS for the round the Proof expects to be bought.
const fixRoundReply = (detail) => (label) => (label.endsWith(':1')
  ? { verdict: 'FIX_REQUIRED',
      issues: [{ severity: 'blocking', detail, actor: 'implementer' },
               { severity: 'minor', detail: 'style' }] }
  : passReview())

// ════════════════════════════════════════════════════════════════════════════
// (a) [M1] — the row, the request, and the line on the hub issue
// ════════════════════════════════════════════════════════════════════════════
const A = await scenario({ task: taskA(), reply: fixRoundReply(DETAIL_A) })

assert.equal(A.rows.length, 1,
  '(a) [M1] the fix-round run with `jev` and a hub on must leave EXACTLY ONE ' +
  '`jev:finding` row in events.jsonl — the round\'s one reviewer-returned blocking ' +
  'issue. Rows: ' + JSON.stringify(A.rows.map(rowShape)) +
  '; every kind the run recorded: ' + JSON.stringify(A.events.map((e) => e.kind)))

const row = A.rows[0]
assert.equal(row.task, 'A',
  '(a) [M1] the row\'s `task` is the task the finding was raised against: ' + JSON.stringify(rowShape(row)))
assert.equal(row.round, 1,
  '(a) [M1] the row\'s `round` is the review round `iter`, 1: ' + JSON.stringify(rowShape(row)))
assert.equal(row.key, KEY_A,
  '(a) [M1] the row\'s `key` is `(severity || \'\') + \'|\' + (detail || \'\')`, the same dedup ' +
  'key the round counts reviewer-returned blocking issues by: ' + JSON.stringify(rowShape(row)))
assert.deepEqual(Object.keys(row.answers || {}).sort(), ANSWER_KEYS,
  '(a) [M1] the row\'s `answers` carry exactly the four question keys: ' +
  JSON.stringify(row.answers))
assert.deepEqual(Object.keys(rowShape(row)).sort(), ['answers', 'key', 'kind', 'round', 'task'],
  '(a) [M1] and the row is `{kind, task, round, key, answers}` and nothing more (beside ' +
  '`appendEvent`\'s own `id`/`ts`): ' + JSON.stringify(rowShape(row)))
// Jev's own answers, round-tripped: the row carries what the edge returned.
assert.equal((row.answers.actor || {}).choice, 'implementer',
  '(a) [M1] the row\'s `answers` are the edge\'s own reply, not the driver\'s: ' +
  JSON.stringify(row.answers))
assert.equal((row.answers.borne_out || {}).noul, 0.5,
  '(a) [M1] including each noul the fake edge answered: ' + JSON.stringify(row.answers))

// Beside the driver's own finding — the row the record already carried.
assert.deepEqual(A.findings.map((f) => [f.task, f.round, f.detail]), [['A', 1, DETAIL_A]],
  '(a) [M1] the `jev:finding` row sits BESIDE the driver\'s own `driver:finding` row for ' +
  'the same finding, which is unchanged: ' + JSON.stringify(A.findings.map(rowShape)))

// ── the request, read off the wire ──────────────────────────────────────────
assert.equal(A.findingRequests.length, 1,
  '(a) [M1] the fake `fetchImpl` recorded EXACTLY ONE `jev:finding` request — one call per ' +
  'reviewer-returned blocking issue, and the round had one: ' +
  JSON.stringify(A.findingRequests.map((r) => r.url)))
const req = A.findingRequests[0]
assert.deepEqual(Object.keys(req.body.questions || {}).sort(), ANSWER_KEYS,
  '(a) [M1] the request\'s `questions` carry exactly `borne_out`, `actor`, `claim_false` ' +
  'and `fixable_in_files`: ' + JSON.stringify(Object.keys(req.body.questions || {})))
assert.equal(req.body.questions.borne_out.type, 'noul',
  '(a) [M1] `borne_out` is a noul: ' + JSON.stringify(req.body.questions.borne_out))
assert.equal(req.body.questions.actor.type, 'choice',
  '(a) [M1] `actor` is a choice: ' + JSON.stringify(req.body.questions.actor))
assert.deepEqual(Object.keys(req.body.questions.actor.criteria || {}),
  ['implementer', 'plan', 'examiner', 'nobody'],
  '(a) [M1] whose criteria are `implementer`, `plan`, `examiner`, `nobody`: ' +
  JSON.stringify(req.body.questions.actor.criteria))
assert.equal(req.body.questions.claim_false.type, 'noul',
  '(a) [M1] `claim_false` is a noul: ' + JSON.stringify(req.body.questions.claim_false))
assert.equal(req.body.questions.fixable_in_files.type, 'noul',
  '(a) [M1] `fixable_in_files` is a noul: ' + JSON.stringify(req.body.questions.fixable_in_files))
// M1's word is "verbatim": the four questions ARE the shared literal.
assert.deepEqual(req.body.questions, QUESTIONS,
  '(a) [M1] and the four questions are the shared literal VERBATIM — the clause pins their ' +
  'text, not only their shape. Sent: ' + JSON.stringify(req.body.questions, null, 1))

// ── the state, read off the wire ────────────────────────────────────────────
const state = req.body.state
assert.deepEqual(Object.keys(state || {}).sort(), ['finding', 'hunks', 'task'],
  '(a) [M1] the state is `{ task, finding, hunks }`: ' + JSON.stringify(Object.keys(state || {})))
assert.deepEqual(Object.keys(state.task || {}).sort(), ['claim', 'files', 'machine', 'title'],
  '(a) [M1] whose `task` is `{ title, claim, machine, files }`: ' + JSON.stringify(state.task))
assert.deepEqual(Object.keys(state.finding || {}).sort(), ['actor', 'severity', 'text'],
  '(a) [M1] and whose `finding` is `{ text, severity, actor }`: ' + JSON.stringify(state.finding))
assert.equal(state.finding.text, DETAIL_A,
  '(a) [M1] `state.finding.text` equals the reviewer\'s detail: ' + JSON.stringify(state.finding))
assert.equal(state.finding.severity, 'blocking',
  '(a) [M1] `state.finding.severity` is the issue\'s own severity: ' + JSON.stringify(state.finding))
assert.equal(state.finding.actor, 'implementer',
  '(a) [M1] `state.finding.actor` is the actor the reviewer named: ' + JSON.stringify(state.finding))
assert.deepEqual(state.task.files, ['A.txt'],
  '(a) [M1] `state.task.files` deep-equals the task\'s own Files: ' + JSON.stringify(state.task.files))
assert.equal(state.task.title, TITLE_A,
  '(a) [M1] `state.task.title` is the task\'s title: ' + JSON.stringify(state.task.title))
assert.equal(state.task.claim, CLAIM_A,
  '(a) [M1] `state.task.claim` is the `**Claim:**` line with the marker removed and nothing ' +
  'else — this body has no continuation line before `Machine:`: ' + JSON.stringify(state.task.claim))
// `machine` is the `Machine:` block up to the first blank line: both clause
// lines, and nothing from past that blank line.
assert.ok(String(state.task.machine).includes(MACHINE_1),
  '(a) [M1] `state.task.machine` carries the `Machine:` line: ' + JSON.stringify(state.task.machine))
assert.ok(String(state.task.machine).includes(MACHINE_2),
  '(a) [M1] and the clause line following it, up to the first blank line: ' +
  JSON.stringify(state.task.machine))
assert.ok(!String(state.task.machine).includes(PAST_THE_BLANK),
  '(a) [M1] and nothing from past that blank line: ' + JSON.stringify(state.task.machine))

// ── the hunks: the sections the detail's paths name, and no others ──────────
assert.ok(String(state.hunks).includes('diff --git a/A.txt b/A.txt'),
  '(a) [M1] `state.hunks` carries the captured patch\'s `A.txt` section — the one path the ' +
  'detail names: ' + JSON.stringify(String(state.hunks).slice(0, 400)))
assert.deepEqual(headerPathsIn(state.hunks), ['A.txt'],
  '(a) [M1] and NO `diff --git` header for any other path: the implementer stub also wrote ' +
  '`B.txt`, which the detail does not name. Headers sent: ' +
  JSON.stringify(headerPathsIn(state.hunks)))

// ── the same line, verbatim, on the task's hub issue ────────────────────────
const rowLine = A.lines.find((l) => {
  try { return JSON.parse(l).kind === 'jev:finding' } catch { return false }
})
assert.ok(typeof rowLine === 'string' && rowLine.length > 0,
  '(a) [M1] the row has a line of its own in events.jsonl')
assert.ok(A.hub.commentsOn(A.uid).includes(rowLine),
  '(a) [M1] the row\'s line, VERBATIM as it stands in events.jsonl, is among the comments on ' +
  'A\'s hub issue — a `jev:` kind carrying a task the record knows routes to that task\'s ' +
  'issue. Line: ' + rowLine + '\nComments: ' +
  JSON.stringify(A.hub.commentsOn(A.uid), null, 1))

// The Global Constraint the wire can answer: the call carries no key of its
// own — the edge injects the bearer, and no site sends an `Authorization`.
assert.deepEqual(Object.keys(req.headers || {}), ['content-type'],
  '(a) the request carries content-type and no `Authorization` header of its own: ' +
  JSON.stringify(req.headers))

// ════════════════════════════════════════════════════════════════════════════
// (b) [M1] — a detail that names no path sends the whole patch
// ════════════════════════════════════════════════════════════════════════════
// This run's body is a sim body with neither a `**Claim:**` nor a `Machine:`
// line, which is M1's other reading: both fields are the empty string.
const B = await scenario({
  task: taskA({ body: 'sim task A' }),
  reply: fixRoundReply(DETAIL_NO_PATH),
})
assert.equal(B.findingRequests.length, 1,
  '(b) [M1] the second run recorded one `jev:finding` request: ' +
  JSON.stringify(B.findingRequests.map((r) => r.url)))
const stateB = B.findingRequests[0].body.state
assert.ok(String(stateB.hunks).includes('diff --git a/A.txt b/A.txt'),
  '(b) [M1] a detail naming no path sends the WHOLE patch — the `A.txt` section: ' +
  JSON.stringify(String(stateB.hunks).slice(0, 400)))
assert.ok(String(stateB.hunks).includes('diff --git a/B.txt b/B.txt'),
  '(b) [M1] and the `B.txt` section beside it: ' + JSON.stringify(String(stateB.hunks).slice(0, 400)))
assert.deepEqual(headerPathsIn(stateB.hunks), ['A.txt', 'B.txt'],
  '(b) [M1] which is the whole captured patch and nothing else: ' +
  JSON.stringify(headerPathsIn(stateB.hunks)))
assert.equal(stateB.finding.text, DETAIL_NO_PATH,
  '(b) [M1] the state is about that finding: ' + JSON.stringify(stateB.finding))
assert.equal(stateB.task.claim, '',
  '(b) [M1] a body with no `**Claim:**` line makes `claim` the empty string: ' +
  JSON.stringify(stateB.task.claim))
assert.equal(stateB.task.machine, '',
  '(b) [M1] and a body with no `Machine:` line makes `machine` the empty string: ' +
  JSON.stringify(stateB.task.machine))

// ════════════════════════════════════════════════════════════════════════════
// (c) [M2] — the four rows that are never appended
// ════════════════════════════════════════════════════════════════════════════
// (i) the `minor` issue of leg (a)'s own round.
assert.equal(A.rows.length, 1,
  '(c) [M2] leg (a)\'s round carried a `minor` issue (`style`) beside the blocking one, and ' +
  'the `jev:finding` rows still number exactly one: ' + JSON.stringify(A.rows.map(rowShape)))
assert.deepEqual(A.rows.filter((r) => String(r.key || '').startsWith('minor|')), [],
  '(c) [M2] none of them has a `key` beginning `minor|`: ' + JSON.stringify(A.rows.map(rowShape)))
assert.equal(A.findingRequests.length, 1,
  '(c) [M2] and the fake `fetchImpl` recorded exactly one `jev:finding` request — the minor ' +
  'issue bought no call at all: ' + JSON.stringify(A.findingRequests.map((r) =>
    r.body && r.body.state && r.body.state.finding)))
assert.deepEqual(A.findingRequests.filter((r) =>
  r.body.state.finding.severity === 'minor'), [],
  '(c) [M2] none of whose `state.finding.severity` is `minor`: ' +
  JSON.stringify(A.findingRequests.map((r) => ((r.body || {}).state || {}).finding)))

// (ii) the blocking issue the DRIVER minted itself: a red `Run:`.
// The scenario the leg names: `proofRuns: ['test -f FIXED']`, an implementer
// that writes no `FIXED`, a `fix:A:0` that writes nothing, a `fix:A:1` that
// writes it, and a reviewer answering PASS with no issues in every round.
const D = await scenario({
  task: taskA({ title: 'write FIXED', proofRuns: ['test -f FIXED'] }),
  reply: () => passReview(),
  onLabel: (label, cwd) => {
    if (label === 'impl:A') {
      fs.writeFileSync(path.join(cwd, 'A.txt'), 'line1\nline3\n')
      fs.writeFileSync(path.join(cwd, 'B.txt'), 'b\n')
      return doneImpl(cwd)
    }
    if (label === 'fix:A:0') return doneImpl(cwd)
    if (label === 'fix:A:1') {
      fs.writeFileSync(path.join(cwd, 'FIXED'), 'x\n')
      return doneImpl(cwd)
    }
    return undefined
  },
})
assert.deepEqual(D.rows, [],
  '(c) [M2] the driver-minted run leaves ZERO `jev:finding` rows — a red `Run:` is the ' +
  'driver\'s own finding and buys no call: ' + JSON.stringify(D.rows.map(rowShape)))
assert.equal(D.findingRequests.length, 0,
  '(c) [M2] and its fake `fetchImpl` recorded zero `jev:finding` requests: ' +
  JSON.stringify(D.requests.map((r) => ((r.body || {}).state || {}).finding)))
// The leg names a `driver:finding` row and a `done` task here; at BASE the
// still-red repair round parks the task before any reviewer, so the driver's
// red-`Run:` reading is on the record as the row this run ends on. Filed
// `unsatisfiable` — what M2 claims is the two assertions above.
const rowD = D.rowOf('A')
assert.ok(String(rowD.notes || '').startsWith('the Proof\'s Run: command failed'),
  '(c) [M2] the driver\'s own red-`Run:` reading is on the record: ' + JSON.stringify(rowD))
assert.equal(rowD.reviewVerdict, 'proof-red',
  '(c) [M2] as the verdict this scenario ends on at BASE — the leg\'s `done` and its ' +
  '`driver:finding` row are filed unsatisfiable: ' + JSON.stringify(rowD))

// (iii) a call that resolves `null`: the edge answered 500.
const R = await scenario({ task: taskA(), reply: fixRoundReply(DETAIL_A), status: 500 })
assert.deepEqual(R.rows, [],
  '(c) [M2] a run whose `fetchImpl` answers status 500 leaves ZERO `jev:finding` rows — a ' +
  'refused call is one log line and no row: ' + JSON.stringify(R.rows.map(rowShape)))
assert.equal(R.findingRequests.length, 1,
  '(c) [M2] though the call WAS made: the round asked once and the answer was `null`: ' +
  JSON.stringify(R.findingRequests.map((r) => r.url)))
const tripleOf = (r) => ({ status: r.status, reviewVerdict: r.reviewVerdict,
                           fixIterations: r.fixIterations })
assert.deepEqual(tripleOf(R.rowOf('A')), tripleOf(A.rowOf('A')),
  '(c) [M2] and the task ends exactly where the answered run ended — a refused call moves ' +
  'no status, verdict or round count: ' + JSON.stringify(tripleOf(R.rowOf('A'))) + ' vs ' +
  JSON.stringify(tripleOf(A.rowOf('A'))))

// (iv) an engine handed no `jev` at all.
const N = await scenario({ task: taskA(), reply: fixRoundReply(DETAIL_A), jevOn: false })
assert.deepEqual(N.rows, [],
  '(c) [M2] leg (a)\'s scenario run with NO `jev` leaves zero `jev:finding` rows: ' +
  JSON.stringify(N.rows.map(rowShape)))

// ════════════════════════════════════════════════════════════════════════════
// (d) [M3] — the same run, with the seam and without it
// ════════════════════════════════════════════════════════════════════════════
assert.deepEqual(N.labels, A.labels,
  '(d) [M3] the same canned replies dispatch the same worker labels in the same order with ' +
  '`jev` and without it. without: ' + JSON.stringify(N.labels) +
  '; with: ' + JSON.stringify(A.labels))
assert.deepEqual(tripleOf(N.rowOf('A')), tripleOf(A.rowOf('A')),
  '(d) [M3] and end with the same `reviewVerdict`, `fixIterations` and `status` for A. ' +
  'without: ' + JSON.stringify(tripleOf(N.rowOf('A'))) +
  '; with: ' + JSON.stringify(tripleOf(A.rowOf('A'))))
assert.deepEqual(N.findings.map((f) => [f.task, f.round, f.detail]),
  A.findings.map((f) => [f.task, f.round, f.detail]),
  '(d) [M3] the same `driver:finding` rows by `task`, `round` and `detail`. without: ' +
  JSON.stringify(N.findings.map((f) => [f.task, f.round, f.detail])) + '; with: ' +
  JSON.stringify(A.findings.map((f) => [f.task, f.round, f.detail])))
assert.deepEqual(N.report.judgmentCalls, A.report.judgmentCalls,
  '(d) [M3] and the same `judgmentCalls` array. without: ' +
  JSON.stringify(N.report.judgmentCalls) + '; with: ' + JSON.stringify(A.report.judgmentCalls))
// The leg names `fixed`, `1` and `done` for A. The engine dispatches no fix
// worker from a reviewer's blocking finding since #964 Task 2, and this task's
// row may move no verdict, route or status (Global Constraints), so what is
// pinned here is the scenario's outcome as the engine produces it — the leg's
// three literals are filed `unsatisfiable`.
assert.deepEqual(tripleOf(A.rowOf('A')),
  { status: 'failed', reviewVerdict: 'fix-loop-exhausted', fixIterations: 0 },
  '(d) [M3] and that outcome is the one the engine produced before this row existed — a ' +
  'reviewer-returned blocking finding ends the task at the `fix-loop-exhausted` exit. ' +
  'The Proof leg named `done`/`fixed`/1, which no engine since #964 Task 2 produces for ' +
  'this scenario; filed unsatisfiable. Got: ' + JSON.stringify(tripleOf(A.rowOf('A'))))

console.log('ok — fleet/tests/test_run_engine_jev_finding.mjs: ' +
  'the `jev:finding` row beside a reviewer-returned blocking finding (M1), the four rows ' +
  'never appended (M2), and the seam that moves nothing (M3)')
// The sentinel the bridge and the suite's `Run:` line read, printed only if
// every assertion above held.
console.log('ALL TESTS PASSED')
