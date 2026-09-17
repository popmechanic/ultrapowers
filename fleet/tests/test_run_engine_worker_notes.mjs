/**
 * fleet/tests/test_run_engine_worker_notes.mjs — the exam for Task 2: *the note
 * is the attention signal — each worker note is read as it lands, the hand is
 * raised from the note, and the SessionEnd hook's stamp lands as its own row*.
 *
 * This file is the Proof's `Test: fleet/tests/test_run_engine_worker_notes.mjs`
 * and its `Guard:`. The run left no `EXAM PATHS:` line for it, so it is written
 * where the Proof names it, and every relative path below is written for THIS
 * directory: `../` is the repository's `fleet/`, `../../` is the checkout root.
 *
 * ── what each Machine clause asserts, restated ──────────────────────────────
 *   M1 — with a `jev` client and a hub client carrying `events`, the engine
 *        polls `kata.events(projectId, cursor)` on ONE project-wide timer every
 *        `attentionPollMs` for as long as at least one worker runs. The cursor
 *        is initialized at Setup — walk `events(projectId, after)` from `0`
 *        through each answer's `next_after_id` until a page whose `events` is
 *        empty; the cursor is the LAST NON-EMPTY page's `next_after_id` — and
 *        is thereafter the last `next_after_id` a non-empty poll answered.
 *        Every event of `type` `issue.commented` whose `issue_uid` is a task
 *        row's `uid` and whose `actor` begins `impl:`, `exam:` or `fix:` is
 *        read EXACTLY ONCE through `readNote(jev, { title, claim, role, note:
 *        payload.body }, log)` — `role` that prefix, `claim` from
 *        `taskClaimOf(<the plan file's text>, task)` — and appended as one
 *        `jev:note` row `{ task, role, actor, commentUid, eventId, chars,
 *        read: true, stuck, plan_defect, divergence, note_kind,
 *        operator_should_read, sentence }`, `sentence` being the note's first
 *        200 characters with newlines flattened to spaces. A comment by any
 *        other actor, an event of any other type, and a comment on an issue no
 *        task row names append nothing and are never sent to Jev.
 *   M2 — a `readNote` resolving `null` appends `jev:note` with `read: false`,
 *        the same `task`, `role`, `actor`, `commentUid`, `eventId`, `chars` and
 *        `sentence`, NO answer fields, and one `log` line; it raises no hand.
 *   M3 — a `read: true` row from an `impl` or `fix` note reading `stuck ≥ 0.7`,
 *        or from an `exam` note reading `stuck ≥ 0.7` AND `note_kind`
 *        `blocker`, while the task's recorded attention is not already
 *        `needs-human`, appends one `driver:attention` `{ task, attention:
 *        'needs-human', msg: 'note: ' + sentence, actor, source: 'note' }`,
 *        sets the poll's recorded value to `needs-human`, and patches that
 *        task's issue metadata with exactly the two flat keys under the
 *        revision a FRESH `getIssue` answers. A patch the hub refuses is one
 *        `kata:write-failed` (`what` `metadata`), the `driver:attention` row
 *        stands and the run resolves. An `exam` note with any other
 *        `note_kind`, any note under 0.7, and a qualifying note on a task
 *        already recorded `needs-human` append no `driver:attention` and make
 *        no patch.
 *   M4 — a poll reading `work.attention` `needs-human` with `work.attention_msg`
 *        exactly `session ended without hand-off` appends one
 *        `driver:attention-hook` `{ task, msg, actor }` per ARRIVAL of that
 *        stamp (an unchanged reading appends nothing), never a
 *        `driver:attention`, and leaves the recorded attention as it was; a
 *        reading of `stuck` or `needs-human` with any other message appends
 *        `driver:attention` exactly as at BASE with the one added field
 *        `source: 'worker'`.
 *   M5 — without a `jev` client, or with a hub client that has no `events`
 *        function, no `events` request is made and no `jev:note` row is
 *        appended; M4 holds regardless.
 *   M6 — `fleet/CONTRACT.md`'s raised-hand paragraph says the note is the
 *        attention signal, and its `Kata facts (measured)` list gains one
 *        `events-page` row.
 *
 * ── the legs, and where each is answered ────────────────────────────────────
 * Every assertion below names its leg and the clause it comes from, so a
 * reader can map this file back to the contract.
 *   (a) [M1] run A — two tasks in one wave, the hub on with an `events` method,
 *       a `jev` whose `ask` is canned, and an `impl:1` stub that appends the
 *       leg's seven events and then sleeps while the poll reads them: the walk,
 *       the cursor, three `ask` calls with their exact `state` and `questions`,
 *       three `jev:note` rows with every named field, the two sentences, and no
 *       `events` call after the last worker has ended.
 *   (b) [M2] run B — run A with the fake `ask` answering `null` for task 2's
 *       note.
 *   (c) [M3] `attentionFromNote` on the six rows; run A's hand-raise, its one
 *       patch and its revision; run C — run A plus a second qualifying note by
 *       `impl:1@run-sim` landing later; run E — run A with a `patchMetadata`
 *       that throws `412 revision_conflict` for the one call carrying
 *       `work.attention` `needs-human`.
 *   (d) [M4] run D (the hook's stamp), run W (`stuck` / `waiting on task 2`)
 *       and run N (`needs-human` / `blocked on a decision`); and
 *       `HOOK_STAMP_MSG`.
 *   (e) [M5] run E1 (no `jev`) and run E2 (a hub with no `events`), each the
 *       stamp-shaped run of (d).
 *   (f) [M6] the two CONTRACT `Run:` lines.
 *
 * ── the rig, and the readings this file is written on ───────────────────────
 * One sim shape for every run leg, built on `_engine_helpers.mjs`'s `rig`:
 * below the agent seam the rig is REAL — real git repositories, real
 * `cloneAtBase` clones, the real capture, the real fold kernel through the real
 * `execSeam`. Only `agent` is stubbed; the hub is an in-memory fake of this
 * file's own (the shape `test_run_engine_re_edge.mjs`'s `makeFakeKata` has,
 * plus the `events(projectId, afterId)` the Context names and a `setMeta` that
 * moves an issue's metadata from OUTSIDE the engine's call log — which is what
 * the SessionEnd hook's own write is); the Jev client is the `{ ask }` fake
 * run-177's sims use, answering canned answer objects. Nothing here opens a
 * socket and nothing here spawns a process.
 *
 *   • The walk's empty page answers `next_after_id: 0`, not the non-empty
 *     page's 100. That is what makes "the walk's last NON-EMPTY page's
 *     `next_after_id`" a reading and not a coincidence: an implementation that
 *     takes the FINAL page's value would poll from `0` and the leg's
 *     `after_id` assertion names it.
 *   • One of the 100 old events is an `issue.commented` by `impl:1@run-old` on
 *     task 1's uid. The walk is a cursor initialisation and its events are
 *     history, so reading one as a note would take `ask` to four calls — which
 *     is exactly what the leg's "exactly three times" refuses.
 *   • "no `events` call is started after the last worker has ended" is asserted
 *     as post-run quiescence: the call count is snapshotted the instant `run()`
 *     resolves and re-read after six poll intervals. A stricter "nothing after
 *     the last stub returned" would race the tick between a stub returning and
 *     the engine's `attentionStop`, and would be red on a slow box for a right
 *     implementation.
 *   • `chars` is the note body's own character count — the field has no other
 *     carrier at BASE — and `eventId` is compared String-normalised, since no
 *     clause pins its type; every other field the clause names is asserted as a
 *     full value.
 *   • Leg (f)'s two `Run:` lines are emulated HERE, in process — the
 *     `sed -n '/a/,/b/p' | tr '\n' ' ' | grep` shape translated pattern for
 *     pattern (the shell's BRE has `(`, `)`, `<`, `>` and `#` literal; only `.`
 *     and `\.` carry meaning). That is the convention every sibling CONTRACT
 *     leg in this directory already uses, and it keeps this sim free of child
 *     processes.
 *
 * `attentionFromNote` and `HOOK_STAMP_MSG` are reached through a NAMESPACE
 * import of `../run-engine.mjs`: a named import of an export BASE has not got
 * is a link-time error that would take every other leg down with it and name no
 * leg at all.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import * as engine from '../run-engine.mjs'
import { NOTE_QUESTIONS } from '../jev-questions.mjs'
import { makeRepo, rig, passReview, cleanCritic, doneImpl } from './_engine_helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'worker-notes-')))
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ══════════════════════════════════════════════════════════════════════════
// the shared literals: the record, the plan, the notes, the events
// ══════════════════════════════════════════════════════════════════════════

const PROJECT_ID = 31
const RUN_UID = 'RUN-UID'
const T1 = 'TASK-1-UID'
const T2 = 'TASK-2-UID'
/** The fake's issues; their revisions must equal the record's, since a sheet
 *  read whose revision disagrees is fatal to the engine. */
const ISSUES = () => ({
  [RUN_UID]: { revision: 1, short_id: 'run1', metadata: {} },
  [T1]: { revision: 1, short_id: 'tk11', metadata: {} },
  [T2]: { revision: 1, short_id: 'tk12', metadata: {} },
})
/** The record, spelled as the launcher writes it. */
const RECORD = () => ({
  url: 'https://kata.invalid',
  project: { id: PROJECT_ID, uid: 'PROJ', name: 'ultrapowers' },
  run: { uid: RUN_UID, revision: 1 },
  tasks: { 1: { uid: T1, short_id: 'tk11', revision: 1 },
           2: { uid: T2, short_id: 'tk12', revision: 1 } },
})

// The run's plan file. Its `### Task <id>:` headings are deliberately NOT the
// compiled tasks' titles: `title` is the compiled task's and `claim` is the
// plan's, and a state carrying both proves each came from its own source.
const CLAIM_1 = 'do: watch a run whose implementer writes that it is stuck; ' +
  'see: that task reads needs-human within a poll. (derived)'
const CLAIM_2 = "do: read an examiner's hand-in; see: no hand raised by a red suite at BASE."
const PLAN = [
  '# the note is the attention signal',
  '',
  '### Task 1: the engine reads each worker note as it lands',
  '',
  '**Claim:** ' + CLAIM_1,
  '',
  '### Task 2: the examiner note under its own criterion',
  '',
  '**Claim:** ' + CLAIM_2,
  '',
].join('\n')

/** The implementer's note: the whole body is its sentence (53 characters). */
const IMPL_BODY = 'I cannot proceed: the leg names a file absent at base'
/** The fix session's note. */
const FIX_BODY = 'retrying the leg'
/** Exactly `n` characters of readable text. */
const pad = (text, n) => (text + ' ' + 'the leg reads as written '.repeat(24)).slice(0, n)
/** The examiner's note: 300 characters over three lines — 120, a newline, 120,
 *  a newline, 58. */
const EXAM_BODY = pad('the base has no such export and the leg cannot be written', 120) + '\n' +
  pad('I am writing the exam against the clause and will say so on the issue', 120) + '\n' +
  pad('red at BASE is an examiner resting state', 58)
/** The second qualifying implementer note of leg (c), landing later. */
const IMPL_BODY_2 = 'still blocked: the same file is still absent at base'

const A_IMPL = 'impl:1@run-sim'
const A_EXAM = 'exam:2@run-sim'
const A_FIX = 'fix:1:0@run-sim'

/** The canned answers, keyed by the note the reader was given — the shape
 *  run-177's sims use, and the shape `readNote` flattens. The three readings
 *  are #1095's: the implementer's note is a blocker at 0.96, the examiner's is
 *  a hand-in at 0.92 (`stuck` over the threshold, `note_kind` not `blocker`),
 *  the fix session's is progress at 0.10. Every other field is distinct per
 *  note, so a row carrying the wrong note's reading cannot pass. */
const ANSWERS = {
  [IMPL_BODY]: { stuck: { type: 'noul', noul: 0.96 }, plan_defect: { type: 'noul', noul: 0.3 },
    divergence: { type: 'noul', noul: 0.02 }, kind: { type: 'choice', choice: 'blocker' },
    operator_should_read: { type: 'score', score: 3 } },
  [EXAM_BODY]: { stuck: { type: 'noul', noul: 0.92 }, plan_defect: { type: 'noul', noul: 0.11 },
    divergence: { type: 'noul', noul: 0.22 }, kind: { type: 'choice', choice: 'handin' },
    operator_should_read: { type: 'score', score: 1 } },
  [FIX_BODY]: { stuck: { type: 'noul', noul: 0.1 }, plan_defect: { type: 'noul', noul: 0.05 },
    divergence: { type: 'noul', noul: 0.06 }, kind: { type: 'choice', choice: 'progress' },
    operator_should_read: { type: 'score', score: 0 } },
  [IMPL_BODY_2]: { stuck: { type: 'noul', noul: 0.98 }, plan_defect: { type: 'noul', noul: 0.4 },
    divergence: { type: 'noul', noul: 0.01 }, kind: { type: 'choice', choice: 'blocker' },
    operator_should_read: { type: 'score', score: 3 } },
}
/** What the row carries once `readNote` has flattened the answer. */
const flat = (body) => {
  const a = ANSWERS[body]
  return { stuck: a.stuck.noul, plan_defect: a.plan_defect.noul, divergence: a.divergence.noul,
           note_kind: a.kind.choice, operator_should_read: a.operator_should_read.score }
}

/** The note's first 200 characters with each newline flattened to one space. */
const sentenceOf = (body) => body.slice(0, 200).replace(/\n/g, ' ')

const commentEvent = (id, uid, actor, commentUid, body) => ({
  event_id: id, type: 'issue.commented', issue_uid: uid, actor,
  payload: { comment_uid: commentUid, author: actor, body,
             created_at: '2026-09-17T00:49:5' + (id % 10) + 'Z' },
})

/** The leg's seven events, appended to the hub once task 1's implementer is
 *  running: three worker comments (one each by an `impl:`, an `exam:` and a
 *  `fix:` actor), the engine's own mirror comment, a reviewer's comment, an
 *  event of another type, and a comment on an issue no task row names. */
const BATCH = () => [
  commentEvent(101, T1, A_IMPL, 'C-IMPL', IMPL_BODY),
  commentEvent(102, T2, A_EXAM, 'C-EXAM', EXAM_BODY),
  commentEvent(103, T1, A_FIX, 'C-FIX', FIX_BODY),
  commentEvent(104, T1, 'engine:run-sim', 'C-ENGINE', '{"kind":"driver:proof-run","task":"1"}'),
  commentEvent(105, T1, 'review:1:1@run-sim', 'C-REVIEW', 'the exam is green on the fix'),
  { event_id: 106, type: 'issue.metadata_updated', issue_uid: T1, actor: A_IMPL,
    payload: { key: 'work.state', value: 'landed' } },
  commentEvent(107, 'NO-SUCH-UID', 'impl:9@run-sim', 'C-ORPHAN', 'a note on no task row'),
]

/** The hub's history at Setup: 100 events, one of them a worker comment of an
 *  EARLIER run. The walk reads them for the cursor alone; a note read out of
 *  them would be a fourth `ask`. */
const OLD_EVENTS = () => {
  const out = []
  for (let i = 1; i <= 100; i += 1) {
    out.push(i === 42
      ? commentEvent(i, T1, 'impl:1@run-old', 'C-OLD', 'a note from the run before this one')
      : { event_id: i, type: 'issue.updated', issue_uid: T1, actor: 'launch', payload: {} })
  }
  return out
}

// ══════════════════════════════════════════════════════════════════════════
// the fake hub, the fake Jev, and one run of the sim
// ══════════════════════════════════════════════════════════════════════════

/**
 * The client's method names over an in-memory store, every call recorded IN
 * ORDER with the answer it gave. `events(projectId, afterId)` answers pages out
 * of an array the sim appends to mid-run, in the hub's own measured shape
 * (`{reset_required, events, next_after_id}`, `next_after_id` the last event's
 * `event_id`); `setMeta` moves an issue's metadata from OUTSIDE the engine's
 * call log, which is what the SessionEnd hook's own write is.
 */
function makeHub ({ withEvents = true } = {}) {
  const calls = []
  const eventsCalls = []
  const hubEvents = []
  const store = new Map()
  for (const [uid, iss] of Object.entries(ISSUES())) {
    store.set(uid, { uid, revision: iss.revision, short_id: iss.short_id,
                     metadata: { ...(iss.metadata || {}) }, owner: null,
                     status: 'open', labels: [] })
  }
  const need = (uid) => {
    const iss = store.get(uid)
    if (!iss) throw new Error('fake hub: no issue ' + JSON.stringify(uid))
    return iss
  }
  const record = (method, uid, fields, answer) => {
    calls.push({ method, uid, ...fields, answer })
    return answer
  }
  const kata = {
    async getIssue (uid) {
      const iss = need(uid)
      return record('getIssue', uid, {}, {
        uid, revision: iss.revision, short_id: iss.short_id, metadata: { ...iss.metadata },
        status: iss.status, owner: iss.owner, project_id: PROJECT_ID,
      })
    },
    async claim (project, uid) {
      const iss = need(uid); iss.owner = 'engine'; iss.revision += 1
      return record('claim', uid, { projectId: project },
        { uid, revision: iss.revision, short_id: iss.short_id })
    },
    async patchMetadata (project, uid, patch, revision) {
      const iss = need(uid)
      iss.metadata = { ...iss.metadata, ...patch }; iss.revision += 1
      return record('patchMetadata', uid, { projectId: project, patch, revision },
        { uid, revision: iss.revision, short_id: iss.short_id })
    },
    async comment (project, uid, body) {
      const iss = need(uid); iss.revision += 1
      return record('comment', uid, { projectId: project, body }, { uid, revision: iss.revision })
    },
    async addLabel (project, uid, label) {
      const iss = need(uid); iss.labels.push(label); iss.revision += 1
      return record('addLabel', uid, { projectId: project, label }, { uid, revision: iss.revision })
    },
    async close (project, uid, opts) {
      const iss = need(uid); iss.status = 'closed'; iss.revision += 1
      return record('close', uid, { projectId: project, opts }, { uid, revision: iss.revision })
    },
  }
  if (withEvents) {
    kata.events = async (projectId, afterId) => {
      const after = Number(afterId)
      const page = hubEvents.filter((e) => Number(e.event_id) > after)
      // The empty page answers `0`, not the cursor it was asked from: the rule
      // is the last NON-EMPTY page's `next_after_id`, and a fake that answered
      // 100 to both would not tell the two readings apart.
      const nextAfterId = page.length ? page[page.length - 1].event_id : 0
      eventsCalls.push({ projectId, afterId, at: Date.now(), count: page.length, nextAfterId })
      return { reset_required: false,
               events: page.map((e) => JSON.parse(JSON.stringify(e))),
               next_after_id: nextAfterId }
    }
  }
  return {
    kata, calls, eventsCalls,
    push: (...evs) => { for (const e of evs) hubEvents.push(e) },
    setMeta: (uid, meta) => { need(uid).metadata = { ...need(uid).metadata, ...meta } },
    of: (m) => calls.filter((c) => c.method === m),
    forUid: (uid) => calls.filter((c) => c.uid === uid),
  }
}

/** The run's own record, read back off disk. */
const eventsIn = (runDir) => {
  let text = ''
  try { text = fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8') } catch { return [] }
  return text.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('{'))
    .map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
}
const rowsOfKind = (runDir, kind) => eventsIn(runDir).filter((e) => String(e.kind || '') === kind)

/** A wave's task, the shape the rig's sims spell. */
const taskOf = (id) => ({
  id, title: 'task ' + id, files: [id + '.txt'], tier: 'standard', review: 'lean',
  writes: [id + '.txt'], commutes: [], testCmd: 'bash check.sh', proofTests: [], proofRuns: [],
  body: 'sim task ' + id,
})

/**
 * One run of the sim: two tasks in one wave, the hub on with the record in the
 * args, `attentionPollMs` 50, the plan on `args.planPath`. `onImpl1` runs
 * inside task 1's implementer — while the run is live and the poll is up — and
 * is where a leg appends its events or moves an issue's metadata. `wrapPatch`
 * may replace the fake's `patchMetadata`; `withJev` and `withEvents` are M5's
 * two halves.
 */
const simRun = async ({ tag, onImpl1, withJev = true, withEvents = true, wrapPatch,
                        answerFor = (body) => ANSWERS[body] || null }) => {
  const repo = makeRepo(path.join(tmp, 'repo-' + tag))
  const runDir = path.join(tmp, 'run-' + tag)
  fs.mkdirSync(runDir, { recursive: true })
  const planPath = path.join(tmp, 'plan-' + tag + '.md')
  fs.writeFileSync(planPath, PLAN)

  const hub = makeHub({ withEvents })
  hub.push(...OLD_EVENTS())
  if (wrapPatch) hub.kata.patchMetadata = wrapPatch(hub.kata.patchMetadata)

  const asks = []
  const jev = {
    ask: async ({ state, questions }) => {
      asks.push({ state: JSON.parse(JSON.stringify(state)), questions })
      return answerFor(state && state.note)
    },
  }

  const labels = []
  let firstDispatchAt = 0
  const { run, logs } = rig({
    repo, runDir, waves: [[taskOf('1'), taskOf('2')]], stamp: 'run-sim',
    kata: hub.kata,
    ...(withJev ? { jev } : {}),
    extraArgs: { kataRecord: RECORD(), attentionPollMs: 50, planPath, width: 4 },
    stub: async (prompt, opts, cwd) => {
      const label = String(opts.label)
      labels.push(label)
      if (!firstDispatchAt) firstDispatchAt = Date.now()
      if (label === 'impl:1') {
        fs.writeFileSync(path.join(cwd, '1.txt'), 'from ' + label + '\n')
        if (onImpl1) await onImpl1(hub)
        return doneImpl(cwd)
      }
      if (label === 'impl:2') {
        fs.writeFileSync(path.join(cwd, '2.txt'), 'from ' + label + '\n')
        // Task 2's worker stays alive while task 1's notes are read, so the
        // project-wide timer is up for a run with two running workers.
        await sleep(350)
        return doneImpl(cwd)
      }
      if (label === 'integration') return cleanCritic()
      if (label.startsWith('review:')) return passReview()
      if (label.startsWith('fix:')) return doneImpl(cwd)
      return { status: 'BLOCKED', summary: 'sim: unexpected dispatch ' + label }
    },
  })
  const report = await run()
  // Snapshotted with no wait of any kind between `run()` resolving and this
  // line: what the poll has done by here is what it did while workers ran.
  const eventsAtReturn = hub.eventsCalls.length
  return { report, hub, asks, labels, logs, runDir, planPath, firstDispatchAt, eventsAtReturn,
           statusOf: (id) => {
             const row = report.tasks.find((t) => t && t.task === id)
             return row && row.status
           } }
}

/** The stub that appends the leg's seven events and then waits out several
 *  polls. 400 ms at `attentionPollMs` 50 is eight of them. */
const appendBatch = async (hub) => { hub.push(...BATCH()); await sleep(400) }

/** The `jev:note` row's named fields, `eventId` String-normalised (no clause
 *  pins its type; the row names WHICH event it came from). */
const NOTE_FIELDS = ['task', 'role', 'actor', 'commentUid', 'eventId', 'chars', 'read',
                     'stuck', 'plan_defect', 'divergence', 'note_kind', 'operator_should_read',
                     'sentence']
const pick = (row, keys) => {
  const out = {}
  for (const k of keys) if (Object.prototype.hasOwnProperty.call(row || {}, k)) out[k] = row[k]
  if (Object.prototype.hasOwnProperty.call(out, 'eventId')) out.eventId = String(out.eventId)
  return out
}
/** The row a read note earns, as M1 spells it. */
const readRow = ({ task, role, actor, commentUid, eventId, body }) => ({
  task, role, actor, commentUid, eventId: String(eventId), chars: body.length, read: true,
  ...flat(body), sentence: sentenceOf(body),
})

// ══════════════════════════════════════════════════════════════════════════
// (a) [M1] the walk, the cursor, the three reads, the three rows
// ══════════════════════════════════════════════════════════════════════════

assert.equal(EXAM_BODY.length, 300,
  '(a) [M1] sim precondition: the examiner\'s note is the leg\'s own 300 characters over three ' +
  'lines — a 120-character first line, a newline, a 120-character second line, a newline, a ' +
  '58-character third line. Got ' + EXAM_BODY.length)
assert.equal(IMPL_BODY.length, 53,
  '(a) [M1] sim precondition: the implementer\'s note is the leg\'s own 53-character body. Got ' +
  IMPL_BODY.length)

const runA = await simRun({ tag: 'a', onImpl1: appendBatch })

assert.deepEqual([runA.statusOf('1'), runA.statusOf('2')], ['done', 'done'],
  '(a) [M1] sim precondition: the two-task run with the hub on, a `jev` client and the seven ' +
  'events appended mid-run took both tasks to `done` — Jev answers no fact and gates nothing. ' +
  'Labels dispatched: ' + JSON.stringify(runA.labels) + '. Got ' + JSON.stringify(runA.report.tasks))

// ── the walk at Setup, and the cursor the first poll carries ────────────────
const callsA = runA.hub.eventsCalls
assert.ok(callsA.length >= 3,
  '(a) [M1] the engine reads the hub\'s events page: two calls for the Setup walk and at least ' +
  'one poll while a worker runs. Calls made: ' + JSON.stringify(callsA))
assert.equal(Number(callsA[0].afterId), 0,
  '(a) [M1] the cursor is initialized at Setup by walking `events(projectId, after)` from `0`. ' +
  'The first call\'s `after_id`: ' + JSON.stringify(callsA[0].afterId))
assert.deepEqual([callsA[0].count, callsA[1].count], [100, 0],
  '(a) [M1] the walk reads two pages — 100 old events, then a page whose `events` is empty, ' +
  'which is where it stops. Got ' + JSON.stringify(callsA.slice(0, 3)))
assert.equal(Number(callsA[1].afterId), callsA[0].nextAfterId,
  '(a) [M1] the walk\'s second call carries the first page\'s `next_after_id` (' +
  callsA[0].nextAfterId + '). Got ' + JSON.stringify(callsA[1].afterId))
assert.ok(callsA[1].at <= runA.firstDispatchAt,
  '(a) [M1] the walk happens at Setup, BEFORE wave 1: both of its calls are made before the ' +
  'first worker is dispatched. Walk at ' + callsA[1].at + ', first dispatch at ' +
  runA.firstDispatchAt)
assert.equal(Number(callsA[2].afterId), callsA[0].nextAfterId,
  '(a) [M1] the first `events` call after Setup carries `after_id` equal to the walk\'s last ' +
  'NON-EMPTY page\'s `next_after_id` (' + callsA[0].nextAfterId + ') — not the empty page\'s ' +
  'answer (' + callsA[1].nextAfterId + '), which is what the walk\'s rule distinguishes. Got ' +
  JSON.stringify(callsA[2].afterId))
for (const call of callsA) {
  assert.equal(call.projectId, PROJECT_ID,
    '(a) [M1] every events read is `kata.events(projectId, cursor)` with the record\'s project ' +
    'id (' + PROJECT_ID + '). Got ' + JSON.stringify(call.projectId))
}

// ── the three reads, and the state each carried ─────────────────────────────
assert.equal(runA.asks.length, 3,
  '(a) [M1] the fake `jev.ask` is called EXACTLY THREE TIMES — once for each of the three ' +
  'comments by an `impl:`, `exam:` or `fix:` actor on an issue a task row names. The comment ' +
  'by `engine:run-sim`, the one by `review:1:1@run-sim`, the `issue.metadata_updated` event, ' +
  'the comment on an issue no task row names, and the worker comment among the 100 events the ' +
  'Setup walk read are never sent to Jev; and each note is read exactly once across every poll ' +
  'of the run. The states asked: ' + JSON.stringify(runA.asks.map((a) => a.state)))

const EXPECT_STATES = [
  { task: { title: 'task 1', claim: CLAIM_1 }, note: IMPL_BODY, role: 'impl' },
  { task: { title: 'task 2', claim: CLAIM_2 }, note: EXAM_BODY, role: 'exam' },
  { task: { title: 'task 1', claim: CLAIM_1 }, note: FIX_BODY, role: 'fix' },
]
for (let i = 0; i < EXPECT_STATES.length; i += 1) {
  assert.deepEqual(runA.asks[i].state, EXPECT_STATES[i],
    '(a) [M1] ask #' + (i + 1) + '\'s `state` is `readNote`\'s own shape, deep-equal to ' +
    JSON.stringify(EXPECT_STATES[i]) + ' — `title` the compiled task\'s, `claim` that task\'s ' +
    '`**Claim:**` line from the run\'s plan file (`taskClaimOf`), `note` the event\'s ' +
    '`payload.body`, `role` the actor\'s prefix — and the three reads happen in event order. ' +
    'Got ' + JSON.stringify(runA.asks[i].state))
  assert.deepEqual(runA.asks[i].questions, NOTE_QUESTIONS,
    '(a) [M1] ask #' + (i + 1) + '\'s `questions` are deep-equal to `NOTE_QUESTIONS` — the note ' +
    'is put to Jev through `readNote` and nothing else. Got ' +
    JSON.stringify(runA.asks[i].questions))
}

// ── the three rows ──────────────────────────────────────────────────────────
const notesA = rowsOfKind(runA.runDir, 'jev:note')
assert.equal(notesA.length, 3,
  '(a) [M1] `events.jsonl` carries EXACTLY THREE `jev:note` rows — one per note read, and none ' +
  'for the four events that are nobody\'s note. Got ' + JSON.stringify(notesA))
assert.deepEqual(notesA.map((r) => [r.role, r.actor]),
  [['impl', A_IMPL], ['exam', A_EXAM], ['fix', A_FIX]],
  '(a) [M1] their `role` values are `impl`, `exam`, `fix` and their `actor` values the three ' +
  'worker actors, in the order the events landed. Got ' +
  JSON.stringify(notesA.map((r) => [r.role, r.actor])))

const EXPECT_ROWS = [
  readRow({ task: '1', role: 'impl', actor: A_IMPL, commentUid: 'C-IMPL', eventId: 101,
    body: IMPL_BODY }),
  readRow({ task: '2', role: 'exam', actor: A_EXAM, commentUid: 'C-EXAM', eventId: 102,
    body: EXAM_BODY }),
  readRow({ task: '1', role: 'fix', actor: A_FIX, commentUid: 'C-FIX', eventId: 103,
    body: FIX_BODY }),
]
for (let i = 0; i < EXPECT_ROWS.length; i += 1) {
  assert.deepEqual(pick(notesA[i], NOTE_FIELDS), EXPECT_ROWS[i],
    '(a) [M1] `jev:note` row #' + (i + 1) + ' carries `task`, `role`, `actor`, `commentUid` ' +
    '(the event\'s `payload.comment_uid`), `eventId` (the event\'s own id), `chars` (the note\'s ' +
    'character count), `read: true` and the reader\'s five flattened answers — ' +
    JSON.stringify(EXPECT_ROWS[i]) + '. Got ' + JSON.stringify(pick(notesA[i], NOTE_FIELDS)))
}

const sentenceImpl = notesA[0].sentence
const sentenceExam = notesA[1].sentence
assert.equal(sentenceImpl, IMPL_BODY,
  '(a) [M1] the implementer\'s `sentence` is the whole 53-character body — a note under 200 ' +
  'characters is not cut. Got ' + JSON.stringify(sentenceImpl))
assert.equal(sentenceExam, sentenceOf(EXAM_BODY),
  '(a) [M1] the examiner\'s `sentence` is the body\'s first 200 characters with each newline ' +
  'replaced by ONE space: ' + JSON.stringify(sentenceOf(EXAM_BODY)) + '. Got ' +
  JSON.stringify(sentenceExam))
assert.equal(String(sentenceExam).length, 200,
  '(a) [M1] and it is exactly 200 characters long. Got ' + String(sentenceExam).length)
assert.ok(!String(sentenceExam).includes('\n'),
  '(a) [M1] and it contains no newline. Got ' + JSON.stringify(sentenceExam))

// ── the timer stops with the last worker ────────────────────────────────────
await sleep(300)
assert.equal(runA.hub.eventsCalls.length, runA.eventsAtReturn,
  '(a) [M1] no `events` call is started after the last worker has ended: the count the instant ' +
  '`run()` resolved (' + runA.eventsAtReturn + ') is unmoved six poll intervals later — the ' +
  'project-wide timer runs for as long as at least one worker runs, and not one tick longer. ' +
  'Got ' + runA.hub.eventsCalls.length)

// ══════════════════════════════════════════════════════════════════════════
// (b) [M2] a note Jev did not answer
// ══════════════════════════════════════════════════════════════════════════

const runB = await simRun({
  tag: 'b',
  onImpl1: appendBatch,
  answerFor: (body) => (body === EXAM_BODY ? null : (ANSWERS[body] || null)),
})
assert.deepEqual([runB.statusOf('1'), runB.statusOf('2')], ['done', 'done'],
  '(b) [M2] sim precondition: a note Jev did not answer is no run\'s failure — both tasks are ' +
  'still `done`. Got ' + JSON.stringify(runB.report.tasks))

const unreadB = rowsOfKind(runB.runDir, 'jev:note').filter((r) => r.task === '2')
assert.equal(unreadB.length, 1,
  '(b) [M2] a `readNote` that resolves `null` still appends ONE `jev:note` row for task 2. Got ' +
  JSON.stringify(rowsOfKind(runB.runDir, 'jev:note')))
assert.deepEqual(
  pick(unreadB[0], ['task', 'role', 'actor', 'commentUid', 'eventId', 'chars', 'read', 'sentence']),
  { task: '2', role: 'exam', actor: A_EXAM, commentUid: 'C-EXAM', eventId: '102',
    chars: EXAM_BODY.length, read: false, sentence: sentenceOf(EXAM_BODY) },
  '(b) [M2] that row reads `read: false` and carries the same `task`, `role`, `actor`, ' +
  '`commentUid`, `eventId`, `chars` and `sentence` the read row would have. Got ' +
  JSON.stringify(unreadB[0]))
for (const key of ['stuck', 'plan_defect', 'divergence', 'note_kind', 'operator_should_read']) {
  assert.ok(!Object.prototype.hasOwnProperty.call(unreadB[0], key),
    '(b) [M2] and it carries no answer field — no `' + key + '` key at all, the leg naming ' +
    '`stuck` by name. Got ' + JSON.stringify(unreadB[0]))
}

const namesTask2 = (l) => /(^|[^0-9])2([^0-9]|$)/.test(l) || l.includes(T2) || l.includes('C-EXAM')
const jevLinesB = runB.logs.filter((l) => l.startsWith('jev:') && namesTask2(l))
assert.equal(jevLinesB.length, 1,
  '(b) [M2] the unanswered read is EXACTLY ONE `log` line beginning `jev:` that names task 2 — ' +
  'one line, not a throw and not silence. Every line the rig captured beginning `jev:`: ' +
  JSON.stringify(runB.logs.filter((l) => l.startsWith('jev:'))))

assert.deepEqual(rowsOfKind(runB.runDir, 'driver:attention').filter((r) => r.task === '2'), [],
  '(b) [M2] and a note that was not read raises no hand: no `driver:attention` row names task ' +
  '2. Got ' + JSON.stringify(rowsOfKind(runB.runDir, 'driver:attention')))

// ══════════════════════════════════════════════════════════════════════════
// (c) [M3] the rule, the hand it raises, the patch, and the refusal
// ══════════════════════════════════════════════════════════════════════════

assert.equal(typeof engine.attentionFromNote, 'function',
  '(c) [M3] `fleet/run-engine.mjs` exports `attentionFromNote({ role, stuck, note_kind })` at ' +
  'module scope — the task\'s `Produces:`, and the rule the six rows below drive directly. Got ' +
  JSON.stringify(typeof engine.attentionFromNote))

const RULE_ROWS = [
  [{ role: 'impl', stuck: 0.7 }, true,
    'an implementer at the threshold itself raises the hand'],
  [{ role: 'impl', stuck: 0.69 }, false,
    'an implementer just under it does not — 0.7 is #1095\'s threshold and it is inclusive'],
  [{ role: 'fix', stuck: 0.7 }, true,
    'a fix session reads by the same rule as an implementer'],
  [{ role: 'exam', stuck: 0.7, note_kind: 'blocker' }, true,
    'an examiner raises the hand only on `stuck` >= 0.7 AND `note_kind` `blocker`'],
  [{ role: 'exam', stuck: 0.9, note_kind: 'handin' }, false,
    'an examiner\'s hand-in does not, however stuck it reads: a red suite at BASE is the ' +
    'examiner\'s resting state, never a raised hand'],
  [{ role: 'exam', stuck: 0.9, note_kind: 'reading' }, false,
    'nor does an examiner\'s reading of the legs'],
]
for (const [input, expected, why] of RULE_ROWS) {
  assert.equal(engine.attentionFromNote(input), expected,
    '(c) [M3] `attentionFromNote(' + JSON.stringify(input) + ')` is ' + expected + ': ' + why +
    '. Got ' + JSON.stringify(engine.attentionFromNote(input)))
}

// ── the hand run A raised ───────────────────────────────────────────────────
const MSG_A = 'note: ' + IMPL_BODY
const attentionA = rowsOfKind(runA.runDir, 'driver:attention')
const attentionA1 = attentionA.filter((r) => r.task === '1')
assert.equal(attentionA1.length, 1,
  '(c) [M3] the implementer\'s note reading `stuck` 0.96 raises the hand EXACTLY ONCE for task ' +
  '1 — and the poll, whose recorded value the note read set to `needs-human`, records no ' +
  'second row of its own when it next reads the issue. Every `driver:attention` row of the ' +
  'run: ' + JSON.stringify(attentionA))
assert.deepEqual(pick(attentionA1[0], ['task', 'attention', 'msg', 'actor', 'source']),
  { task: '1', attention: 'needs-human', msg: MSG_A, actor: A_IMPL, source: 'note' },
  '(c) [M3] that row is `{ task, attention: \'needs-human\', msg: \'note: \' + sentence, actor, ' +
  'source: \'note\' }` — the worker\'s own sentence as the message, and the note\'s actor. Got ' +
  JSON.stringify(attentionA1[0]))

const patchesA1 = runA.hub.forUid(T1)
  .filter((c) => c.method === 'patchMetadata' && c.patch &&
                 c.patch['work.attention'] === 'needs-human')
assert.equal(patchesA1.length, 1,
  '(c) [M3] and EXACTLY ONE `patchMetadata` on task 1\'s uid carries `work.attention` ' +
  '`needs-human`. Every metadata patch on that uid: ' +
  JSON.stringify(runA.hub.forUid(T1).filter((c) => c.method === 'patchMetadata')
    .map((c) => c.patch)))
assert.deepEqual(patchesA1[0].patch,
  { 'work.attention': 'needs-human', 'work.attention_msg': MSG_A },
  '(c) [M3] its `patch` is deep-equal to exactly the two flat keys `work.attention` and ' +
  '`work.attention_msg` and carries no others. Got ' + JSON.stringify(patchesA1[0].patch))
{
  const onT1 = runA.hub.forUid(T1)
  const at = onT1.indexOf(patchesA1[0])
  assert.ok(at > 0 && onT1[at - 1].method === 'getIssue',
    '(c) [M3] the fake\'s call just before it on that uid is a `getIssue`: the patch goes out ' +
    'under the revision a FRESH read answers, the worker\'s own comments having moved the ' +
    'issue past the tracker\'s. The calls on ' + T1 + ': ' +
    JSON.stringify(onT1.map((c) => c.method)))
  assert.equal(patchesA1[0].revision, patchesA1[0].answer.revision - 1,
    '(c) [M3] and its `revision` argument equals the revision the fake held for that issue at ' +
    'the patch — one less than the patch\'s own answer (' + patchesA1[0].answer.revision + '). ' +
    'Got ' + JSON.stringify(patchesA1[0].revision))
}

const attentionA2 = attentionA.filter((r) => r.task === '2')
assert.deepEqual(attentionA2, [],
  '(c) [M3] the examiner\'s note reading `stuck` 0.92 with `note_kind` `handin` raises NO ' +
  'hand: no `driver:attention` row names task 2. Got ' + JSON.stringify(attentionA2))
assert.deepEqual(runA.hub.forUid(T2).filter((c) => c.method === 'patchMetadata' && c.patch &&
    c.patch['work.attention'] === 'needs-human'), [],
  '(c) [M3] and no `patchMetadata` on task 2\'s uid carries `work.attention` `needs-human`. ' +
  'Every metadata patch on that uid: ' +
  JSON.stringify(runA.hub.forUid(T2).filter((c) => c.method === 'patchMetadata')
    .map((c) => c.patch)))

// ── a second qualifying note on a task already recorded needs-human ─────────
const runC = await simRun({
  tag: 'c',
  onImpl1: async (hub) => {
    hub.push(...BATCH())
    await sleep(300)
    hub.push(commentEvent(108, T1, A_IMPL, 'C-IMPL-2', IMPL_BODY_2))
    await sleep(300)
  },
})
assert.deepEqual([runC.statusOf('1'), runC.statusOf('2')], ['done', 'done'],
  '(c) [M3] sim precondition: the run with a second qualifying note took both tasks to `done`. ' +
  'Got ' + JSON.stringify(runC.report.tasks))
assert.equal(rowsOfKind(runC.runDir, 'jev:note').filter((r) => r.commentUid === 'C-IMPL-2').length, 1,
  '(c) [M3] sim precondition: the second note by `' + A_IMPL + '`, landing later, WAS read — ' +
  'its own `jev:note` row is on the record. Rows: ' +
  JSON.stringify(rowsOfKind(runC.runDir, 'jev:note').map((r) => r.commentUid)))
assert.equal(rowsOfKind(runC.runDir, 'driver:attention').filter((r) => r.task === '1').length, 1,
  '(c) [M3] and it appends NO second `driver:attention`: the task\'s recorded attention is ' +
  'already `needs-human`. Got ' +
  JSON.stringify(rowsOfKind(runC.runDir, 'driver:attention')))
assert.equal(runC.hub.forUid(T1).filter((c) => c.method === 'patchMetadata' && c.patch &&
    c.patch['work.attention'] === 'needs-human').length, 1,
  '(c) [M3] and no second such patch either. Every metadata patch on ' + T1 + ': ' +
  JSON.stringify(runC.hub.forUid(T1).filter((c) => c.method === 'patchMetadata')
    .map((c) => c.patch)))

// ── a patch the hub refuses ─────────────────────────────────────────────────
const refused = []
const runE = await simRun({
  tag: 'e',
  onImpl1: appendBatch,
  wrapPatch: (real) => async (project, uid, patch, revision) => {
    if (patch && patch['work.attention'] === 'needs-human') {
      refused.push({ uid, patch, revision })
      throw new Error('412 revision_conflict')
    }
    return real(project, uid, patch, revision)
  },
})
assert.deepEqual(refused.map((r) => r.uid), [T1],
  '(c) [M3] sim precondition: the fake was asked for exactly one metadata patch carrying ' +
  '`work.attention` `needs-human`, on task 1\'s uid, and refused it with a ' +
  '`412 revision_conflict`. Got ' + JSON.stringify(refused))
assert.equal(runE.report.tasks.length, 2,
  '(c) [M3] a patch the hub refuses is not the run\'s end: the run still resolves with ' +
  '`report.tasks.length` 2. Got ' + JSON.stringify(runE.report.tasks))
{
  const rows = rowsOfKind(runE.runDir, 'driver:attention').filter((r) => r.task === '1')
  assert.equal(rows.length, 1,
    '(c) [M3] and the `driver:attention` row stands: `events.jsonl` still carries it for task ' +
    '1. Got ' + JSON.stringify(rowsOfKind(runE.runDir, 'driver:attention')))
  assert.equal(rows[0].source, 'note',
    '(c) [M3] with `source` `note`. Got ' + JSON.stringify(rows[0]))
  const failures = rowsOfKind(runE.runDir, 'kata:write-failed')
  assert.deepEqual(failures.filter((f) => f.what === 'metadata' && f.uid === T1).length, 1,
    '(c) [M3] and the refusal is EXACTLY ONE `kata:write-failed` row whose `what` is ' +
    '`metadata` and whose `uid` is task 1\'s. Every `kata:write-failed` row of the run: ' +
    JSON.stringify(failures))
}

// ══════════════════════════════════════════════════════════════════════════
// (d) [M4] the SessionEnd hook's stamp, and the readings that are not it
// ══════════════════════════════════════════════════════════════════════════

assert.equal(engine.HOOK_STAMP_MSG, 'session ended without hand-off',
  '(d) [M4] `fleet/run-engine.mjs` exports `HOOK_STAMP_MSG` — the task\'s `Produces:`, the one ' +
  'literal the SessionEnd hook writes — equal to `session ended without hand-off`. Got ' +
  JSON.stringify(engine.HOOK_STAMP_MSG))

/** A run whose task-1 metadata is moved mid-run, from outside the engine, the
 *  way a worker session's hook moves it — and then left unchanged across
 *  several further polls. */
const stampRun = (tag, meta, opts = {}) => simRun({
  tag,
  onImpl1: async (hub) => {
    hub.setMeta(T1, { ...meta, attention_actor: 'hook@run-sim' })
    await sleep(400)
  },
  ...opts,
})

const HOOK_META = { 'work.attention': 'needs-human',
                    'work.attention_msg': 'session ended without hand-off' }
const runD = await stampRun('d', HOOK_META)
assert.deepEqual([runD.statusOf('1'), runD.statusOf('2')], ['done', 'done'],
  '(d) [M4] sim precondition: the run whose task-1 metadata carries the hook\'s stamp took ' +
  'both tasks to `done`. Got ' + JSON.stringify(runD.report.tasks))

const hookRows = rowsOfKind(runD.runDir, 'driver:attention-hook')
assert.equal(hookRows.length, 1,
  '(d) [M4] a poll reading `work.attention` `needs-human` with `work.attention_msg` exactly ' +
  '`session ended without hand-off` appends ONE `driver:attention-hook` row per arrival of ' +
  'that stamp — and across the three and more further polls of the unchanged stamp that this ' +
  'run makes, no second row lands. Got ' + JSON.stringify(hookRows))
assert.deepEqual(pick(hookRows[0], ['task', 'msg', 'actor']),
  { task: '1', msg: 'session ended without hand-off', actor: 'hook@run-sim' },
  '(d) [M4] that row is `{ task, msg, actor }`. Got ' + JSON.stringify(hookRows[0]))
assert.deepEqual(rowsOfKind(runD.runDir, 'driver:attention').filter((r) => r.task === '1'), [],
  '(d) [M4] and never a `driver:attention`: no such row names task 1 at all across the run ' +
  '(this leg\'s run makes no qualifying note). Got ' +
  JSON.stringify(rowsOfKind(runD.runDir, 'driver:attention')))

const runW = await stampRun('w', { 'work.attention': 'stuck',
                                   'work.attention_msg': 'waiting on task 2' })
{
  const rows = rowsOfKind(runW.runDir, 'driver:attention').filter((r) => r.task === '1')
  assert.equal(rows.length, 1,
    '(d) [M4] a reading of `stuck` with any other message is a `driver:attention` exactly as ' +
    'at BASE: exactly one names task 1. Got ' +
    JSON.stringify(rowsOfKind(runW.runDir, 'driver:attention')))
  assert.deepEqual(pick(rows[0], ['task', 'attention', 'msg', 'source']),
    { task: '1', attention: 'stuck', msg: 'waiting on task 2', source: 'worker' },
    '(d) [M4] with `attention` `stuck`, `msg` `waiting on task 2` and the one added field ' +
    '`source` `worker`. Got ' + JSON.stringify(rows[0]))
}

const runN = await stampRun('n', { 'work.attention': 'needs-human',
                                   'work.attention_msg': 'blocked on a decision' })
{
  const rows = rowsOfKind(runN.runDir, 'driver:attention').filter((r) => r.task === '1')
  assert.equal(rows.length, 1,
    '(d) [M4] and a reading of `needs-human` whose message is NOT the hook\'s stamp is the ' +
    'same: exactly one `driver:attention` names task 1. Got ' +
    JSON.stringify(rowsOfKind(runN.runDir, 'driver:attention')))
  assert.deepEqual(pick(rows[0], ['task', 'attention', 'msg', 'source']),
    { task: '1', attention: 'needs-human', msg: 'blocked on a decision', source: 'worker' },
    '(d) [M4] with `attention` `needs-human`, `msg` `blocked on a decision` and `source` ' +
    '`worker`. Got ' + JSON.stringify(rows[0]))
  assert.deepEqual(rowsOfKind(runN.runDir, 'driver:attention-hook'), [],
    '(d) [M4] and no `driver:attention-hook` lands: only the stamp\'s exact message is the ' +
    'hook\'s row. Got ' + JSON.stringify(rowsOfKind(runN.runDir, 'driver:attention-hook')))
}

// ══════════════════════════════════════════════════════════════════════════
// (e) [M5] no Jev, or no `events` on the hub
// ══════════════════════════════════════════════════════════════════════════

const NO_JEV = [
  ['no `jev` client at all', await stampRun('e1', HOOK_META, { withJev: false })],
  ['a `jev` client but a hub client with no `events` function',
    await stampRun('e2', HOOK_META, { withEvents: false })],
]
for (const [why, run] of NO_JEV) {
  assert.deepEqual([run.statusOf('1'), run.statusOf('2')], ['done', 'done'],
    '(e) [M5] sim precondition: the same run driven with ' + why + ' took both tasks to ' +
    '`done`. Got ' + JSON.stringify(run.report.tasks))
  assert.deepEqual(run.hub.eventsCalls, [],
    '(e) [M5] with ' + why + ', NO `events` request is made — not the Setup walk, not a poll. ' +
    'Got ' + JSON.stringify(run.hub.eventsCalls))
  assert.deepEqual(rowsOfKind(run.runDir, 'jev:note'), [],
    '(e) [M5] and no `jev:note` row is appended. Got ' +
    JSON.stringify(rowsOfKind(run.runDir, 'jev:note')))
  assert.equal(rowsOfKind(run.runDir, 'driver:attention-hook').length, 1,
    '(e) [M5] while M4 holds regardless: the hook row of (d) still lands, exactly once. Got ' +
    JSON.stringify(rowsOfKind(run.runDir, 'driver:attention-hook')))
  assert.deepEqual(rowsOfKind(run.runDir, 'driver:attention').filter((r) => r.task === '1'), [],
    '(e) [M5] and the stamp is still no `driver:attention`. Got ' +
    JSON.stringify(rowsOfKind(run.runDir, 'driver:attention')))
}
assert.equal(NO_JEV[1][1].asks.length, 0,
  '(e) [M5] and a hub with no `events` sends nothing to Jev: the client was handed in and ' +
  '`ask` was never called. Got ' + JSON.stringify(NO_JEV[1][1].asks))

// ══════════════════════════════════════════════════════════════════════════
// (f) [M6] the CONTRACT paragraph, and the measured row
// ══════════════════════════════════════════════════════════════════════════
// The Proof's two `Run:` lines, emulated in process. `sed`'s range is inclusive
// of both matching lines; `tr '\n' ' '` turns every newline into a space; the
// shell's BRE has `(`, `)`, `<`, `>` and `#` literal, so only `.` and `\.` are
// translated.

const CONTRACT = fs.readFileSync(path.join(ROOT, 'fleet', 'CONTRACT.md'), 'utf8').split('\n')
const sedRange = (from, to) => {
  const a = CONTRACT.findIndex((l) => from.test(l))
  if (a < 0) return null
  const b = CONTRACT.findIndex((l, i) => i > a && to.test(l))
  return CONTRACT.slice(a, b < 0 ? CONTRACT.length : b + 1)
}

{
  //   sed -n '/^  The worker.s raised hand:/,/^  The re-edge (#979):/p' fleet/CONTRACT.md \
  //     | tr '\n' ' ' \
  //     | grep -q 'events.*jev:note.*impl.*fix.*stuck.*0\.7.*exam.*blocker.*red at BASE.*driver:attention-hook.*session ended without hand-off.*no longer sets.*source'
  const range = sedRange(/^ {2}The worker.s raised hand:/, /^ {2}The re-edge \(#979\):/)
  assert.ok(range && range.length > 1,
    '(f) [M6] sim precondition: `fleet/CONTRACT.md` still has the `  The worker\'s raised ' +
    'hand:` line the Proof\'s `sed` range starts at and the `  The re-edge (#979):` line that ' +
    'closes it')
  const paragraph = range.join(' ') + ' '
  assert.match(paragraph,
    /events.*jev:note.*impl.*fix.*stuck.*0\.7.*exam.*blocker.*red at BASE.*driver:attention-hook.*session ended without hand-off.*no longer sets.*source/,
    '(f) [M6] the raised-hand paragraph of the `**Kata record (engine):**` bullet says the ' +
    'note is the attention signal — in this order: the events poll, the `jev:note` row, the ' +
    'two-role rule (`impl`/`fix` on `stuck` 0.7) with the examiner\'s `blocker` criterion, the ' +
    'examiner\'s reason (a red suite at BASE is the examiner\'s resting state, never a raised ' +
    'hand), the `driver:attention-hook` row, the stamp `session ended without hand-off` it is ' +
    'raised by, that the hook no longer sets attention, and the `source` field. The paragraph ' +
    'as it stands: ' + JSON.stringify(paragraph))
}

{
  //   sed -n '/^- \*\*Kata facts (measured):\*\*/,/^- \*\*Laptop config/p' fleet/CONTRACT.md \
  //     | grep -q '^  - events-page — .*reset_required.*events.*next_after_id.*issue.commented.*comment_uid.*2026-09-17'
  const range = sedRange(/^- \*\*Kata facts \(measured\):\*\*/, /^- \*\*Laptop config/)
  assert.ok(range && range.length > 1,
    '(f) [M6] sim precondition: `fleet/CONTRACT.md` still has the `Kata facts (measured)` ' +
    'bullet and the `Laptop config` bullet that closes the Proof\'s `sed` range')
  const hit = range.filter((l) =>
    /^ {2}- events-page — .*reset_required.*events.*next_after_id.*issue.commented.*comment_uid.*2026-09-17/.test(l))
  assert.equal(hit.length, 1,
    '(f) [M6] the `Kata facts (measured)` list carries one `events-page` row, in the list\'s ' +
    'own shape, recording that the events page answers `{reset_required, events, ' +
    'next_after_id}` and that a comment event is `type` `issue.commented` with `actor` and ' +
    '`payload: {comment_uid, author, body, created_at}`, read 2026-09-17. Every ' +
    '`events-page` line in the range: ' +
    JSON.stringify(range.filter((l) => l.includes('events-page'))))
}

// The sentinel the suite greps for (`tests/test_fleet_suite.py`): printed only
// if every assertion above held.
console.log('ALL TESTS PASSED')
