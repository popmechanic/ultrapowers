/**
 * fleet/tests/test_run_engine_kata_landing.mjs — the exam for Task 2: *a task's
 * issue reads `landed` when the driver takes its result and `adopted` when it is
 * folded, and the hook's `needs-human` is cleared*.
 *
 * This file is the Proof's `Test: fleet/tests/test_run_engine_kata_landing.mjs`,
 * written where the Proof names it. Every relative import is written for THIS
 * directory: `../` is the repository's `fleet/`, `./` is `fleet/tests/`.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ TWO exams share this path, and their leg letters collide, so every       │
 * │ assertion message says which one it belongs to:                          │
 * │                                                                          │
 * │   • the LANDING exam (#1005) — legs `(a)`…`(d)`, clauses `[M1]`…`[M4]`,  │
 * │     labelled bare, exactly as they were written. `work.state` reads       │
 * │     `landed` at the capture and `adopted` at the fold.                   │
 * │   • the SETUP-CLEAR exam (this task) — legs `(a)`…`(g)`, clauses `[M1]`  │
 * │     …`[M5]`, every one of them labelled `setup-clear (x) [Mn]`. A        │
 * │     relaunch never shows the earlier run's verdict on a task its own     │
 * │     workers have not touched yet.                                        │
 * │                                                                          │
 * │ A bare `(a) [M1]` is therefore the landing exam's; a `setup-clear (a)    │
 * │ [M1]` is this one's.                                                     │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ── the SETUP-CLEAR legs, and what each asserts ────────────────────────────
 *
 *   (a) [M1] Run HUB (the two-task run the landing legs also read): task 1's
 *       issue OPENS at `work.attention: needs-human`, `work.attention_msg:
 *       'failed: fix-loop-exhausted'` — the mark an earlier run's `kataMark`
 *       left on a reused issue — and task 2's opens with no `work.attention`
 *       key at all. For task 1's uid the fake's call log holds ONE
 *       `patchMetadata` whose patch deep-equals `{'work.attention': 'ok',
 *       'work.attention_msg': ''}` — two flat keys, nothing else — and that
 *       call went out BEFORE the first worker dispatch of task 1, read off the
 *       stub's own label order (each recorded call is stamped with the labels
 *       the stub had been handed by then). `events.jsonl` holds EXACTLY ONE
 *       `driver:attention-cleared` for task 1, `{task: '1', was: 'needs-human',
 *       msg: 'failed: fix-loop-exhausted'}`. Task 2's uid gets no such two-key
 *       patch and no `driver:attention-cleared` at all.
 *   (b) [M1] Run STUCK, a second run: task 1's issue opens at `work.attention:
 *       stuck`, `work.attention_msg: 'waiting on task 2'` and task 2's opens at
 *       `work.attention: 'ok'` EXPLICITLY — the key present, reading rest. Same
 *       two-key patch on task 1's uid before its first worker dispatch, exactly
 *       one `driver:attention-cleared` with `was: 'stuck'`, `msg: 'waiting on
 *       task 2'`; task 2's uid gets neither.
 *   (c) [M1] Run CLOSED, a third run: task 1's issue is `status: 'closed'`,
 *       carries neither `work.adopted_run` nor `work.adopted_sha` (so the reuse
 *       pass does not take it and the task is worked) and opens at
 *       `work.attention: needs-human`. No `driver:attention-cleared` at all, no
 *       patch anywhere in the run deep-equal to the two-key clear, and — the
 *       Setup window M1 names — NO `patchMetadata` whatsoever on that uid
 *       before the first worker dispatch of task 1. `impl:1` is still
 *       dispatched.
 *   (d) [M2] In run HUB: no `driver:attention` event for task 1 carries
 *       `msg: 'failed: fix-loop-exhausted'` and none carries `attention: 'ok'`.
 *       A poll whose baseline was the stale value records the clear as a move
 *       to `ok`; a poll that never read the clear records the stale mark
 *       itself. Either one fails this leg.
 *   (e) [M3] Run MIDRUN, a fourth run at `attentionPollMs: 50` whose `impl:1`
 *       stub writes `work.attention: stuck`, `work.attention_msg: 'mid-run'`
 *       into the fake's store and then waits 200 ms: `events.jsonl` holds
 *       EXACTLY ONE `driver:attention` for task 1, `attention: 'stuck'`,
 *       `msg: 'mid-run'` — the worker's raised hand is still recorded, exactly
 *       as at BASE.
 *   (f) [M4] In run HUB: task 2, whose reviewer blocks, ends the run with its
 *       issue reading `work.attention: needs-human` and a `work.attention_msg`
 *       beginning `failed:` — `kataMark`'s own, so the Setup clear is not a
 *       suppression of THIS run's marks — and task 1, whose SessionEnd hook
 *       stamped `session ended without hand-off` at every session's end, ends
 *       `status: 'done'`, `reviewVerdict: 'clean'`, its issue reading
 *       `work.attention: 'ok'`.
 *   (g) [M5] `fleet/CONTRACT.md`'s worker's-raised-hand paragraph — the lines
 *       from `The worker's raised hand:` through `The re-edge (#979)`, the
 *       Proof's own sed range — read as one line names `driver:attention-
 *       cleared`, then `work.attention`, then `ok`, then `work.attention_msg`,
 *       then `closed`, in that order.
 *
 * Two readings of the SETUP-CLEAR legs that a later session would otherwise
 * have to reconstruct, both settled against BASE rather than assumed:
 *
 *   • Leg (d) needs a LIVE poll. At the default `ATTENTION_POLL_MS` (15000)
 *     this sim finishes before a single read, so the leg would be vacuously
 *     green whatever the engine does. Run HUB therefore passes
 *     `attentionPollMs: 50` and holds each of task 1's sessions ~250 ms, and
 *     the leg opens on a precondition that at least one `driver:attention` for
 *     task 1 WAS recorded — the poll is proven live before its readings are
 *     read.
 *   • Leg (c)'s "no `patchMetadata` on its uid" is taken over the Setup window
 *     M1 names, not over the whole run. A task the engine dispatches always
 *     ends with a metadata patch on its issue, whichever way it goes:
 *     `kataLanded` then `kataAdopted` on an adopted task, `kataMark` on one the
 *     run could not finish. Asserting zero patches across the run would be red
 *     at BASE for a reason that is not the missing Setup clear, so the leg is
 *     encoded as exactly what M1 says a `closed` issue gets — neither the
 *     event nor the patch, nothing at all on that uid before its first worker —
 *     and the absolute phrasing is returned under `unsatisfiable`.
 *
 * ── the LANDING legs, and what each asserts ─────────────────────────────────
 *
 * Every assertion below names its leg and the Machine clause it comes from, so
 * a reader can map this file back to the contract:
 *
 *   (a) [M1] One run, a fake hub, two tasks: task 1's reviewer passes, task 2's
 *       blocks. For task 1's uid the fake's call log holds EXACTLY ONE
 *       `patchMetadata` whose patch deep-equals `{'work.state': 'landed',
 *       'work.attention': 'ok', 'work.attention_msg': ''}` — three flat keys and
 *       nothing else — and its index in that uid's own call sequence is AFTER
 *       the last `comment` the driver posted for task 1 before its result
 *       settled, and BEFORE the call carrying `work.adopted_run`. The window
 *       M1 names is read twice more, from either end: every worker session the
 *       stub ever ran for task 1 had already ended when that patch was sent,
 *       and the patch precedes (in the fake's GLOBAL order) the
 *       `driver:wave-adopted` comment, which is the instant the fold adopted.
 *   (b) [M2] The call carrying `work.adopted_run` has sorted keys
 *       `['work.adopted_run', 'work.adopted_sha', 'work.state']`, carries
 *       `work.state: 'adopted'`, appears exactly once, and the call after it on
 *       that issue is the `close`, whose `reason` is `done` and whose commit
 *       evidence is still the wave's adopted head — the close is unchanged.
 *   (c) [M3] For task 2, whose reviewer blocks it into `needs-review`: NO
 *       `patchMetadata` call for its uid carries a `work.state` key at all, and
 *       exactly one carries `work.attention: 'needs-human'` — `kataMark`'s
 *       stamp, with the two keys it always had — so its issue still reads
 *       `needs-human` at the end of the run.
 *   (d) [M4] `fleet/CONTRACT.md`, read through the Proof's own second `Run:`
 *       line: the kata section's re-edge range carries M4's sentence in the
 *       order that line greps for, the old words "exactly the two flat keys"
 *       occur zero times in the file (once at BASE, line 559), and the `Closes:`
 *       range names the three flat keys in order.
 *
 * Two readings this file is written on, both measured against BASE rather than
 * assumed, because neither is visible from the Machine clauses alone:
 *
 *   • "after the result's last worker has ended" has no `worker:end` comment to
 *     stand on here. The rig passes no `eventLog`, so the engine's mirror
 *     subscription (`MIRRORED_ENVELOPES` — `worker:start`, `worker:end`) is
 *     never installed and those envelopes reach no issue. What DOES reach one is
 *     the driver's own narration: `appendEvent` mirrors every `driver:` event
 *     naming a task onto that task's issue. So both tasks carry one `Run:`
 *     command, which puts a `driver:proof-run` comment on task 1's issue at its
 *     grading — the last comment the driver posts for task 1 before its result
 *     settles, and the one leg (a) reads the landed patch against.
 *   • "before any fold adopts it" is pinned on the RUN's issue, not the task's:
 *     `driver:wave-adopted` carries no `task`, so `kataUidFor` routes it to the
 *     run's uid and it lands there as a comment. The fold's adoption is
 *     therefore a readable instant in the fake's global call order, and the
 *     landed patch has to precede it.
 *
 * The `needs-human` that M1 clears is NOT the engine's: each worker session runs
 * kata's attention-hook, and its SessionEnd stamp is what survives a clean task.
 * The stub models it where it happens — it writes `work.attention: 'needs-human'`
 * and `work.attention_msg: 'session ended without hand-off'` straight into the
 * fake's store as each session ends, so that write is the hook's and not an
 * engine call: it is not recorded in the call log and it does not move the
 * revision the fake answers (the fake enforces no `If-Match`; which revision the
 * engine's patches carry is the adoption sim's leg, not this one's).
 *
 * M2's "…and passes" for the sim this task also edits is the Proof's FIRST
 * `Run:` line, which the driver runs; leg (b) below pins the same patch from the
 * engine's side. This file names no sibling sim.
 *
 * Nothing here reaches a hub: the client is a fake with the client's method
 * names over an in-memory store, injected through the rig. Below the agent seam
 * the rig is real, as in the sibling engine sims — real git repositories, real
 * clones, the real capture, the real fold kernel through the real `execSeam`.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { rig, makeRepo, passReview, cleanCritic, doneImpl } from './_engine_helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'engine-kata-landing-')))
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }))

// ── the literals the Machine clauses spell, spelled once ────────────────────
const STAMP = 'run-12'
const ADOPTED_RUN = 12
const STATE_KEY = 'work.state'
const ATTENTION_KEY = 'work.attention'
const ATTENTION_MSG_KEY = 'work.attention_msg'
const RUN_KEY = 'work.adopted_run'
const SHA_KEY = 'work.adopted_sha'
// M1: the landing patch, whole — the three flat keys and their exact values.
const LANDED_PATCH = { [STATE_KEY]: 'landed', [ATTENTION_KEY]: 'ok', [ATTENTION_MSG_KEY]: '' }
const LANDED_KEYS = [ATTENTION_KEY, ATTENTION_MSG_KEY, STATE_KEY]
// M2: the adoption patch's key set, sorted — the two it always carried plus
// `work.state`, and nothing else.
const ADOPTED_KEYS = [RUN_KEY, SHA_KEY, STATE_KEY]
// The stamp kata's attention-hook leaves on a session that handed off to the
// driver, which is the state M1's landing patch has to clear.
const HOOK_ATTENTION = 'needs-human'
const HOOK_MSG = 'session ended without hand-off'
// One `Run:` per task: its `driver:proof-run` event is the driver's own
// narration of that task's grading, and the comment leg (a) reads against.
const PROOF_RUN = "sh -c 'echo proof-ok'"

// ── the SETUP-CLEAR literals ────────────────────────────────────────────────
// M1's patch, whole: the two flat keys and their exact values, and nothing
// else. `kataLanded`'s patch carries a third key (`work.state`) and
// `kataMark`'s carries `needs-human`, so a deep-equal against this object
// names the Setup clear and nothing the engine already sent at BASE.
const CLEAR_PATCH = { [ATTENTION_KEY]: 'ok', [ATTENTION_MSG_KEY]: '' }
const CLEARED = 'driver:attention-cleared'
// The marks an earlier run left on the issues this run reuses. (a)'s is the
// one run-16 of popmechanic/tinyapp-fixture actually read at Setup — run-15's
// `kataMark` after that task's fix loop ran out.
const STALE_A = { was: 'needs-human', msg: 'failed: fix-loop-exhausted' }
const STALE_B = { was: 'stuck', msg: 'waiting on task 2' }
// (e)'s: what a worker moves `work.attention` to WHILE it runs, which M3 keeps
// recorded exactly as at BASE.
const MIDRUN = { attention: 'stuck', msg: 'mid-run' }

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms) })

// Deep equality over a flat metadata patch: the same key set and the same value
// under every key. `assert.deepEqual` states it in the message; this is the
// predicate the `filter`s below need.
const eqPatch = (patch, want) => {
  const got = (patch && typeof patch === 'object') ? patch : {}
  const ks = Object.keys(got).sort()
  const ws = Object.keys(want).sort()
  return ks.length === ws.length && ks.every((k, i) => k === ws[i] && got[k] === want[k])
}
// The Setup clear, as a call: a `patchMetadata` whose patch IS `CLEAR_PATCH`.
const isClear = (c) => c.method === 'patchMetadata' && eqPatch(c.patch, CLEAR_PATCH)
// "before the first worker dispatch of task <id>", read off the stub's own
// label order: no session whose label's second colon-segment names that task
// had been handed to the stub when this call went out.
const beforeAnyWorkerOf = (call, id) =>
  !(call.dispatchedBy || []).some((l) => String(l).split(':')[1] === id)
const kindsOf = (runDir, kind) => eventsOf(runDir).filter((e) => e.kind === kind)

const mkTask = (id, files, over = {}) => ({
  id, title: 'task ' + id, files, tier: 'standard', review: 'lean',
  writes: files, commutes: [], proofTests: [], proofRuns: [PROOF_RUN],
  body: 'task ' + id + ' body', ...over,
})

const eventsOf = (runDir) => {
  const file = path.join(runDir, 'events.jsonl')
  if (!fs.existsSync(file)) return []
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
}

// The fake hub: the client's method names over an in-memory store, every call
// recorded IN ORDER with the answer it gave — `patchMetadata` is a per-key
// merge and every mutation bumps the issue's revision.
//
// Two things beyond the client's own surface, both marked where they are used:
// `witness`, which stamps each recorded call with what the stub had finished by
// then (so "after the last worker ended" is a fact about the call, not a guess),
// and `hookStamp`, the worker's SessionEnd write — the hook's, not the engine's,
// so it is neither recorded nor revision-bumping.
function makeFakeKata ({ projectId, issues, witness = () => [], seen = () => [] }) {
  const calls = []
  const hookStamps = []
  const store = new Map()
  for (const [uid, iss] of Object.entries(issues)) {
    // `status` is the issue's as the hub holds it — `open` unless the sim opens
    // it `closed`, which is setup-clear leg (c)'s whole subject.
    store.set(uid, { uid, revision: iss.revision, short_id: iss.short_id,
                     metadata: { ...(iss.metadata || {}) }, owner: null,
                     status: iss.status || 'open', labels: [] })
  }
  const need = (uid) => {
    const iss = store.get(uid)
    if (!iss) throw new Error('fake kata: no issue ' + JSON.stringify(uid))
    return iss
  }
  const record = (method, uid, fields, answer) => {
    // `ended`: what the stub had FINISHED by then (the landing legs' "after the
    // last worker"). `dispatchedBy`: what the stub had been HANDED by then —
    // the setup-clear legs' "before the first worker dispatch of task 1", read
    // off the stub's own label order rather than guessed.
    calls.push({ method, uid, ...fields, answer, ended: witness(), dispatchedBy: seen() })
    return answer
  }
  const kata = {
    async getIssue (uid) {
      const iss = need(uid)
      return record('getIssue', uid, {}, {
        uid, revision: iss.revision, short_id: iss.short_id, metadata: iss.metadata,
        status: iss.status, owner: iss.owner, project_id: projectId,
      })
    },
    async claim (project, uid) {
      const iss = need(uid)
      iss.owner = 'engine'; iss.revision += 1
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
      const iss = need(uid)
      iss.revision += 1
      return record('comment', uid, { projectId: project, body },
        { uid, revision: iss.revision })
    },
    async addLabel (project, uid, label) {
      const iss = need(uid)
      iss.labels.push(label); iss.revision += 1
      return record('addLabel', uid, { projectId: project, label },
        { uid, revision: iss.revision })
    },
    async close (project, uid, opts) {
      const iss = need(uid)
      iss.status = 'closed'; iss.revision += 1
      return record('close', uid, { projectId: project, opts },
        { uid, revision: iss.revision })
    },
  }
  return {
    kata,
    calls,
    of: (m) => calls.filter((c) => c.method === m),
    forUid: (uid) => calls.filter((c) => c.uid === uid),
    metaOf: (uid) => ({ ...store.get(uid).metadata }),
    labelsOf: (uid) => store.get(uid).labels.slice(),
    // The attention-hook's SessionEnd write, from outside the engine — kept in
    // its own log, because once the landing patch clears it the issue itself no
    // longer shows that it was ever written.
    hookStamps,
    hookStamp: (uid) => {
      const iss = store.get(uid)
      if (!iss) return
      hookStamps.push(uid)
      iss.metadata = { ...iss.metadata,
                       [ATTENTION_KEY]: HOOK_ATTENTION, [ATTENTION_MSG_KEY]: HOOK_MSG }
    },
    // The same door, for a worker that raises its hand mid-run with
    // `kata meta set $KATA_REF work.attention stuck` (setup-clear leg (e)): the
    // WORKER's write, so it is not an engine call and not in the call log.
    storeSet: (uid, patch) => {
      const iss = store.get(uid)
      if (!iss) return
      iss.metadata = { ...iss.metadata, ...patch }
    },
  }
}

// The two-task wave both hub legs are read off. Task `1`'s reviewer passes, so
// it is the wave's one adopted row; task `2`'s reviewer returns a blocking
// finding on EVERY round, so that task is never adopted and ends as one of the
// run's `needs-review` tasks — whichever number of rounds the fix loop grants.
const WAVES = () => [[mkTask('1', ['t1.txt']), mkTask('2', ['t2.txt'])]]

// ══════════════════════════════════════════════════════════════════════════
// (a) [M1], (b) [M2], (c) [M3] — one run, a hub, one landed-and-adopted task
// and one the run could not finish
// ══════════════════════════════════════════════════════════════════════════
{
  const repo = makeRepo(path.join(tmp, 'repo-hub'))
  const runDir = path.join(tmp, 'run-hub')
  const PROJECT_ID = 7
  const UID = { 1: 'U-1', 2: 'U-2' }
  const record = {
    url: 'https://kata.int.exe.xyz',
    project: { id: PROJECT_ID, uid: 'PROJ0', name: 'ultrapowers' },
    run: { uid: 'RUN0', revision: 1 },
    // Each row's `revision` is the store's at setup, or the engine ends the run
    // `kata-revision-mismatch` at that task's first read.
    tasks: { 1: { uid: UID[1], short_id: 'aa11', revision: 1 },
             2: { uid: UID[2], short_id: 'bb22', revision: 1 } },
  }
  // Every worker session the stub ran, and every one that has ENDED — the
  // second is what each recorded hub call is stamped with.
  const dispatched = []
  const ended = []
  const fake = makeFakeKata({
    projectId: PROJECT_ID,
    witness: () => ended.slice(),
    seen: () => dispatched.slice(),
    issues: {
      RUN0: { revision: 1, short_id: 'run9', metadata: {} },
      // setup-clear (a) [M1]: this is a RELAUNCH. Task 1's issue is the one the
      // earlier run's `kataMark` left marked when its fix loop ran out — the
      // issue `openKataTask` reads at Setup, sixteen seconds before its own
      // first worker starts. Task 2's carries no `work.attention` key at all.
      'U-1': { revision: 1,
               short_id: 'aa11',
               metadata: { [ATTENTION_KEY]: STALE_A.was, [ATTENTION_MSG_KEY]: STALE_A.msg } },
      'U-2': { revision: 1, short_id: 'bb22', metadata: {} },
    },
  })
  // The worker seam. Each session ends the way a real one does: its reply, and
  // then kata's attention-hook stamping `needs-human` on the issue the session
  // named — the task in the label's second colon-segment, as `kataUidFor`
  // reads it (`integration` names none).
  const stub = async (prompt, opts, cwd) => {
    const label = String(opts.label)
    dispatched.push(label)
    const kind = label.split(':')[0]
    const id = label.split(':')[1]
    let reply
    if (kind === 'impl' || kind === 'fix') {
      fs.writeFileSync(path.join(cwd, 't' + id + '.txt'), 'from ' + label + '\n')
      reply = doneImpl(cwd)
    } else if (kind === 'review') {
      reply = (id === '1')
        ? passReview()
        : { verdict: 'FIX_REQUIRED',
            issues: [{ severity: 'blocking', detail: 'task 2 is not adoptable',
                       actor: 'implementer' }] }
    } else if (label === 'integration') {
      reply = cleanCritic()
    } else {
      throw new Error('unexpected dispatch: ' + label)
    }
    // setup-clear (d) [M2] needs a poll that actually READ this issue while a
    // worker of task 1 was in flight: with `attentionPollMs: 50` below, holding
    // each of task 1's sessions ~250 ms puts several readings inside the
    // dispatch. Without the hold the sim outruns the timer and (d) would be
    // vacuously green whatever the engine does.
    if (id === '1') await sleep(250)
    if (UID[id]) fake.hookStamp(UID[id])
    ended.push(label)
    return reply
  }
  const { run } = rig({
    repo, runDir, waves: WAVES(), stub, stamp: STAMP,
    kata: fake.kata, extraArgs: { kataRecord: record, attentionPollMs: 50 },
  })
  const report = await run()

  // ── preconditions: the run these legs are asserting about actually happened ──
  assert.equal(report.waveMerges.length, 1,
    '(a) [M1] sim precondition: the run folded its one wave — ' +
    JSON.stringify(report.waveMerges))
  const wm = report.waveMerges[0]
  assert.equal(wm.status, 'MERGED',
    '(a) [M1] sim precondition: wave 1 adopted — ' + JSON.stringify(wm))
  assert.deepEqual(wm.branches, ['1'],
    '(a) [M1] sim precondition: task 1 is the wave\'s one adopted row (task 2\'s reviewer ' +
    'blocked it) — ' + JSON.stringify(wm.branches))
  const rowOf = (id) => report.tasks.find((r) => r && r.task === id)
  assert.equal(rowOf('1').status, 'done',
    '(a) [M1] sim precondition: task 1 ended `done`, so its result is the mergeable one — ' +
    JSON.stringify(rowOf('1')))
  assert.ok(rowOf('2') && rowOf('2').status !== 'done',
    '(c) [M3] sim precondition: task 2 did not end `done`, so its result is not mergeable and ' +
    'the engine marks it for a person instead of closing it — ' + JSON.stringify(rowOf('2')))
  assert.ok(ended.includes('impl:1'),
    '(a) [M1] sim precondition: task 1\'s implementer session ran and ended — ' +
    JSON.stringify(dispatched))
  assert.ok(ended.some((l) => l.startsWith('review:1')),
    '(a) [M1] sim precondition: task 1 reached a reviewer, which is its last worker — ' +
    JSON.stringify(dispatched))
  assert.ok(fake.hookStamps.includes(UID[1]),
    '(a) [M1] sim precondition: the attention-hook DID stamp `' + ATTENTION_KEY + ': ' +
    HOOK_ATTENTION + '` on task 1\'s issue as its sessions ended — that stamp is what the ' +
    'landing patch has to clear, and a sim in which it was never written would prove nothing. ' +
    'The hook wrote on: ' + JSON.stringify(fake.hookStamps))

  // The sha the adoption patch and the close both name: the wave's adopted
  // head, as the `driver:wave-adopted` event on the run's own log names it.
  const adoptedEvents = eventsOf(runDir).filter((e) => e.kind === 'driver:wave-adopted')
  assert.equal(adoptedEvents.length, 1,
    '(b) [M2] sim precondition: one `driver:wave-adopted` event — ' +
    JSON.stringify(adoptedEvents))
  const SHA = adoptedEvents[0].headSha
  assert.match(String(SHA), /^[0-9a-f]{40}$/,
    '(b) [M2] the wave-1 adopted head is a 40-hex sha: ' + JSON.stringify(SHA))

  const seqOne = fake.forUid(UID[1])
  const patchesOne = seqOne.filter((c) => c.method === 'patchMetadata')
  const patchOf = (c) => (c && c.patch) || {}
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k)

  // ── (a) [M1] the landing patch: one call, exactly three flat keys ─────────
  const landedPatches = patchesOne.filter((c) => patchOf(c)[STATE_KEY] === 'landed')
  assert.equal(landedPatches.length, 1,
    '(a) [M1] the driver settled a mergeable result for task 1, which has a kata row, so it ' +
    'patched that issue with `' + STATE_KEY + ': landed` exactly ONCE. The patchMetadata calls ' +
    'the fake recorded for ' + UID[1] + ' were: ' +
    JSON.stringify(patchesOne.map((c) => c.patch)))
  const landed = landedPatches[0]
  assert.deepEqual(Object.keys(landed.patch).sort(), LANDED_KEYS,
    '(a) [M1] that patch carries EXACTLY the three flat keys `' + STATE_KEY + '`, `' +
    ATTENTION_KEY + '` and `' + ATTENTION_MSG_KEY + '` — nothing else rides along: ' +
    JSON.stringify(landed.patch))
  assert.deepEqual(landed.patch, LANDED_PATCH,
    '(a) [M1] and its value is exactly ' + JSON.stringify(LANDED_PATCH) + ' — `landed`, the ' +
    'attention cleared to `ok` and its message emptied, because the worker\'s SessionEnd hook ' +
    'stamped `' + HOOK_ATTENTION + '` on a session that handed off to the driver. Got ' +
    JSON.stringify(landed.patch))

  // ── (a) [M1] where it sits: after task 1's last worker, before the fold ──
  const landedAt = seqOne.indexOf(landed)
  const commentsBefore = seqOne
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => c.method === 'comment')
  assert.ok(commentsBefore.length > 0,
    '(a) [M1] sim precondition: the driver posted at least one comment on task 1\'s issue — ' +
    'its `driver:proof-run` narration — so "after the last comment" is a real ordering and not ' +
    'a vacuous one. ' + UID[1] + '\'s call sequence was: ' +
    JSON.stringify(seqOne.map((c) => c.method)))
  const lastCommentAt = commentsBefore[commentsBefore.length - 1].i
  assert.ok(landedAt > lastCommentAt,
    '(a) [M1] the landing patch comes AFTER the last comment the driver posted for task 1\'s ' +
    'worker end (index ' + lastCommentAt + '), not before it — the issue reads in run order. ' +
    UID[1] + '\'s call sequence was: ' + JSON.stringify(seqOne.map((c) => c.method)))
  const taskOneWorkers = dispatched.filter((l) => l.split(':')[1] === '1')
  for (const worker of taskOneWorkers) {
    assert.ok((landed.ended || []).includes(worker),
      '(a) [M1] the patch is sent after the result\'s LAST worker has ended: the session `' +
      worker + '` had already returned when it went out. Ended by then: ' +
      JSON.stringify(landed.ended) + '; task 1\'s sessions were: ' +
      JSON.stringify(taskOneWorkers))
  }
  // "…and before any fold adopts it", read where the fold's adoption is
  // visible: `driver:wave-adopted` names no task, so the engine mirrors it onto
  // the RUN's issue, which puts it in the fake's global order.
  const globalAt = (c) => fake.calls.indexOf(c)
  const waveAdoptedComment = fake.calls.find(
    (c) => c.method === 'comment' && String(c.body || '').includes('driver:wave-adopted'))
  assert.ok(waveAdoptedComment,
    '(a) [M1] sim precondition: the engine mirrored its `driver:wave-adopted` line to the hub, ' +
    'which is where the fold\'s adoption is readable from the call log — ' +
    JSON.stringify(fake.calls.map((c) => c.method + ' ' + c.uid)))
  assert.ok(globalAt(landed) < globalAt(waveAdoptedComment),
    '(a) [M1] and BEFORE any fold adopts that result: the landing patch (global index ' +
    globalAt(landed) + ') precedes the `driver:wave-adopted` line (global index ' +
    globalAt(waveAdoptedComment) + '), because a task is `landed` from the driver\'s capture ' +
    'of its result and only then `adopted` from its fold')

  // ── (b) [M2] the adoption patch, and the close that still follows it ──────
  const adoptionPatches = patchesOne.filter((c) => has(patchOf(c), RUN_KEY))
  assert.equal(adoptionPatches.length, 1,
    '(b) [M2] the adoption patch goes out once per adopted task — one patchMetadata for ' +
    UID[1] + ' carrying `' + RUN_KEY + '`. Got: ' +
    JSON.stringify(patchesOne.map((c) => c.patch)))
  const stamped = adoptionPatches[0]
  assert.deepEqual(Object.keys(stamped.patch).sort(), ADOPTED_KEYS,
    '(b) [M2] that patch carries EXACTLY the three flat keys ' + JSON.stringify(ADOPTED_KEYS) +
    ' — the two it always had plus `' + STATE_KEY + '`, and nothing else: ' +
    JSON.stringify(stamped.patch))
  assert.deepEqual(stamped.patch, { [RUN_KEY]: ADOPTED_RUN, [SHA_KEY]: SHA,
                                    [STATE_KEY]: 'adopted' },
    '(b) [M2] and its value is exactly {' + RUN_KEY + ': ' + ADOPTED_RUN + ', ' + SHA_KEY +
    ': ' + SHA + ' (the wave-1 adopted head), ' + STATE_KEY + ': adopted}; got ' +
    JSON.stringify(stamped.patch))
  assert.ok(landedAt < seqOne.indexOf(stamped),
    '(b) [M2] the landing patch precedes the call carrying `' + RUN_KEY + '` — `landed` from ' +
    'the capture, then `adopted` from the fold, in that order on the issue. ' + UID[1] +
    '\'s patches were, in order: ' + JSON.stringify(patchesOne.map((c) => c.patch)))
  const next = seqOne[seqOne.indexOf(stamped) + 1]
  assert.ok(next && next.method === 'close',
    '(b) [M2] the close that follows the adoption patch is unchanged: the very next call the ' +
    'engine makes on task 1\'s issue is its `close`, with nothing else in between. ' + UID[1] +
    '\'s call sequence was: ' + JSON.stringify(seqOne.map((c) => c.method)))
  assert.equal((next.opts || {}).reason, 'done',
    '(b) [M2] and that close is a `done`: ' + JSON.stringify((next.opts || {}).reason))
  const evidence = (next.opts || {}).evidence
  assert.ok(Array.isArray(evidence),
    '(b) [M2] the close still carries an `evidence` array: ' + JSON.stringify(next.opts))
  assert.deepEqual(evidence.find((e) => e && e.type === 'commit'), { type: 'commit', sha: SHA },
    '(b) [M2] whose commit evidence is still the adopted head — {type: "commit", sha: ' + SHA +
    '}; got ' + JSON.stringify(evidence))

  // ── (a) [M1] + (b) [M2] what the issue reads at the end of the run ───────
  const metaOne = fake.metaOf(UID[1])
  assert.equal(metaOne[STATE_KEY], 'adopted',
    '(b) [M2] task 1\'s issue ends the run reading `' + STATE_KEY + ': adopted`: ' +
    JSON.stringify(metaOne))
  assert.equal(metaOne[ATTENTION_KEY], 'ok',
    '(a) [M1] and reading `' + ATTENTION_KEY + ': ok` — the task landed and was adopted, so it ' +
    'never reads as needing a human, whatever the SessionEnd hook stamped: ' +
    JSON.stringify(metaOne))
  assert.equal(metaOne[ATTENTION_MSG_KEY], '',
    '(a) [M1] with the hook\'s message (`' + HOOK_MSG + '`) emptied: ' + JSON.stringify(metaOne))
  assert.equal(metaOne[RUN_KEY], ADOPTED_RUN,
    '(b) [M2] beside the adoption stamp it always carried, `' + RUN_KEY + '` = ' + ADOPTED_RUN +
    ': ' + JSON.stringify(metaOne))
  assert.equal(metaOne[SHA_KEY], SHA,
    '(b) [M2] and `' + SHA_KEY + '` = ' + SHA + ': ' + JSON.stringify(metaOne))

  // ══════════════════════════════════════════════════════════════════════
  // (c) [M3] the task whose result is not mergeable is never `landed`
  // ══════════════════════════════════════════════════════════════════════
  const seqTwo = fake.forUid(UID[2])
  const patchesTwo = seqTwo.filter((c) => c.method === 'patchMetadata')
  for (const c of patchesTwo) {
    assert.ok(!has(patchOf(c), STATE_KEY),
      '(c) [M3] task 2\'s reviewer blocked it, so its result is not mergeable and NO metadata ' +
      'patch on its issue carries `' + STATE_KEY + '` at all — neither `landed` nor `adopted`: ' +
      JSON.stringify(c.patch))
  }
  const metaTwo = fake.metaOf(UID[2])
  assert.ok(!has(metaTwo, STATE_KEY),
    '(c) [M3] and its issue carries no `' + STATE_KEY + '` key at the end of the run: ' +
    JSON.stringify(metaTwo))
  const marks = patchesTwo.filter((c) => patchOf(c)[ATTENTION_KEY] === HOOK_ATTENTION)
  assert.equal(marks.length, 1,
    '(c) [M3] while `kataMark`\'s stamp for it is unchanged: exactly one patch carrying `' +
    ATTENTION_KEY + ': ' + HOOK_ATTENTION + '`. ' + UID[2] + '\'s patches were: ' +
    JSON.stringify(patchesTwo.map((c) => c.patch)))
  assert.deepEqual(Object.keys(marks[0].patch).sort(), [ATTENTION_KEY, ATTENTION_MSG_KEY],
    '(c) [M3] with the two keys it always had and no third — the landing patch\'s keys are not ' +
    'on this issue: ' + JSON.stringify(marks[0].patch))
  assert.equal(typeof marks[0].patch[ATTENTION_MSG_KEY], 'string',
    '(c) [M3] its message is the result\'s own `<status>: <verdict>`: ' +
    JSON.stringify(marks[0].patch))
  assert.equal(metaTwo[ATTENTION_KEY], HOOK_ATTENTION,
    '(c) [M3] so the issue still reads `' + ATTENTION_KEY + ': ' + HOOK_ATTENTION + '` — a task ' +
    'the run could not finish IS one that needs a person: ' + JSON.stringify(metaTwo))
  assert.equal(seqTwo.filter((c) => c.method === 'close').length, 0,
    '(c) [M3] sim precondition: and it is left open — no `close` on ' + UID[2] + ': ' +
    JSON.stringify(seqTwo.map((c) => c.method)))
  assert.ok(fake.labelsOf(UID[2]).includes('needs-review'),
    '(c) [M3] sim precondition: with the `needs-review` label the mark always added: ' +
    JSON.stringify(fake.labelsOf(UID[2])))

  // ══════════════════════════════════════════════════════════════════════
  // setup-clear (a) [M1] — the stale mark is cleared at Setup, before any
  // worker of that task is dispatched
  // ══════════════════════════════════════════════════════════════════════
  const clearsOne = seqOne.filter(isClear)
  assert.equal(clearsOne.length, 1,
    'setup-clear (a) [M1] task 1\'s issue opened at `' + ATTENTION_KEY + ': ' + STALE_A.was +
    '`, `' + ATTENTION_MSG_KEY + ': ' + STALE_A.msg + '` — an earlier run\'s mark on an issue ' +
    'this relaunch reuses — so `openKataTask` sent EXACTLY ONE `patchMetadata` on ' + UID[1] +
    ' whose patch deep-equals ' + JSON.stringify(CLEAR_PATCH) + '. The patches the fake ' +
    'recorded for ' + UID[1] + ' were: ' +
    JSON.stringify(seqOne.filter((c) => c.method === 'patchMetadata').map((c) => c.patch)))
  assert.deepEqual(clearsOne[0].patch, CLEAR_PATCH,
    'setup-clear (a) [M1] and that patch carries exactly the two flat keys `' + ATTENTION_KEY +
    '` and `' + ATTENTION_MSG_KEY + '` with exactly the values ' + JSON.stringify(CLEAR_PATCH) +
    ' — no `' + STATE_KEY + '`, nothing else: ' + JSON.stringify(clearsOne[0].patch))
  assert.ok(beforeAnyWorkerOf(clearsOne[0], '1'),
    'setup-clear (a) [M1] and it went out BEFORE the first worker dispatch of task 1: the issue ' +
    'is cleared when the run OPENS it, so no window exists in which this run\'s record shows the ' +
    'earlier run\'s verdict on a task its own workers have not touched yet. The stub had been ' +
    'handed these labels when that patch was sent: ' + JSON.stringify(clearsOne[0].dispatchedBy) +
    '; task 1\'s sessions were: ' + JSON.stringify(taskOneWorkers))

  const clearedOne = kindsOf(runDir, CLEARED).filter((e) => e.task === '1')
  assert.equal(clearedOne.length, 1,
    'setup-clear (a) [M1] and the run NARRATES it: exactly one `' + CLEARED + '` event for ' +
    'task 1 on events.jsonl. Got: ' + JSON.stringify(clearedOne))
  assert.equal(clearedOne[0].was, STALE_A.was,
    'setup-clear (a) [M1] whose `was` is the value the issue actually held (`' + STALE_A.was +
    '`): ' + JSON.stringify(clearedOne[0]))
  assert.equal(clearedOne[0].msg, STALE_A.msg,
    'setup-clear (a) [M1] and whose `msg` is the message it held (`' + STALE_A.msg +
    '`) — the earlier run\'s reading, kept on the record as history: ' +
    JSON.stringify(clearedOne[0]))

  // …and task 2, whose issue carries no `work.attention` key at all, gets
  // neither: an absent key is a resting task, not a stale mark.
  const clearsTwo = seqTwo.filter(isClear)
  assert.deepEqual(clearsTwo.map((c) => c.patch), [],
    'setup-clear (a) [M1] task 2\'s issue carries NO `' + ATTENTION_KEY + '` key, so nothing is ' +
    'cleared on it — no `patchMetadata` on ' + UID[2] + ' deep-equal to ' +
    JSON.stringify(CLEAR_PATCH) + '. Got: ' + JSON.stringify(clearsTwo.map((c) => c.patch)))
  assert.deepEqual(kindsOf(runDir, CLEARED).filter((e) => e.task === '2'), [],
    'setup-clear (a) [M1] and no `' + CLEARED + '` event for task 2 at all')

  // ══════════════════════════════════════════════════════════════════════
  // setup-clear (d) [M2] — the poll's first reading for a cleared task is
  // against `ok`
  // ══════════════════════════════════════════════════════════════════════
  const attnOne = kindsOf(runDir, 'driver:attention').filter((e) => e.task === '1')
  assert.ok(attnOne.length > 0,
    'setup-clear (d) [M2] sim precondition: the attention poll RAN for task 1 and recorded at ' +
    'least one reading — this run passes `attentionPollMs: 50` and holds each of task 1\'s ' +
    'sessions ~250 ms precisely so that it did. A run in which the poll never read is one where ' +
    'this leg proves nothing. events.jsonl\'s `driver:attention` rows: ' +
    JSON.stringify(kindsOf(runDir, 'driver:attention')))
  for (const e of attnOne) {
    assert.notEqual(e.msg, STALE_A.msg,
      'setup-clear (d) [M2] no `driver:attention` event of this run carries the message the ' +
      'issue held at Setup (`' + STALE_A.msg + '`): the poll\'s first reading for a cleared task ' +
      'is against `ok`, and a run that records the earlier run\'s verdict as its own reading is ' +
      'exactly what M2 forbids. This event was: ' + JSON.stringify(e))
    assert.notEqual(e.attention, 'ok',
      'setup-clear (d) [M2] and none carries `attention: "ok"` — a poll whose baseline was the ' +
      'stale value would record the clear itself as a move BACK to `ok`, which is the same stale ' +
      'reading wearing the other face. This event was: ' + JSON.stringify(e))
  }

  // ══════════════════════════════════════════════════════════════════════
  // setup-clear (f) [M4] — the Setup clear is not a suppression of THIS
  // run's marks, and the hook's stamp still ends clean
  // ══════════════════════════════════════════════════════════════════════
  assert.equal(metaTwo[ATTENTION_KEY], HOOK_ATTENTION,
    'setup-clear (f) [M4] task 2\'s reviewer blocked it, so the run marks it for a person: its ' +
    'issue ends the run reading `' + ATTENTION_KEY + ': ' + HOOK_ATTENTION + '`. The Setup clear ' +
    'drops the EARLIER run\'s verdict, never this one\'s: ' + JSON.stringify(metaTwo))
  assert.equal(typeof metaTwo[ATTENTION_MSG_KEY], 'string',
    'setup-clear (f) [M4] with a message of its own: ' + JSON.stringify(metaTwo))
  assert.ok(String(metaTwo[ATTENTION_MSG_KEY]).startsWith('failed:'),
    'setup-clear (f) [M4] and that message is `kataMark`\'s own `<status>: <verdict>` — task 2 ' +
    'ended `failed`, so it begins `failed:`. Got ' + JSON.stringify(metaTwo[ATTENTION_MSG_KEY]))
  assert.equal(rowOf('1').status, 'done',
    'setup-clear (f) [M4] while task 1 — the task whose stale mark was cleared, and whose ' +
    'SessionEnd hook stamped `' + HOOK_MSG + '` at every session\'s end — ends `status: "done"`: ' +
    JSON.stringify(rowOf('1')))
  assert.equal(rowOf('1').reviewVerdict, 'clean',
    'setup-clear (f) [M4] and `reviewVerdict: "clean"`: ' + JSON.stringify(rowOf('1')))
  assert.equal(metaOne[ATTENTION_KEY], 'ok',
    'setup-clear (f) [M4] with its issue reading `' + ATTENTION_KEY + ': ok` at the end of the ' +
    'run — the landing patch cleared the hook\'s stamp, as at BASE: ' + JSON.stringify(metaOne))
}

// ══════════════════════════════════════════════════════════════════════════
// setup-clear (b) [M1] — run STUCK: the other value M1 names is cleared the
// same way, and an issue reading `ok` EXPLICITLY is not touched
// ══════════════════════════════════════════════════════════════════════════
{
  const repo = makeRepo(path.join(tmp, 'repo-stuck'))
  const runDir = path.join(tmp, 'run-stuck')
  const PROJECT_ID = 7
  const UID = { 1: 'S-1', 2: 'S-2' }
  const record = {
    url: 'https://kata.int.exe.xyz',
    project: { id: PROJECT_ID, uid: 'PROJ0', name: 'ultrapowers' },
    run: { uid: 'RUNS', revision: 1 },
    tasks: { 1: { uid: UID[1], short_id: 'ss11', revision: 1 },
             2: { uid: UID[2], short_id: 'ss22', revision: 1 } },
  }
  const dispatched = []
  const fake = makeFakeKata({
    projectId: PROJECT_ID,
    seen: () => dispatched.slice(),
    issues: {
      RUNS: { revision: 1, short_id: 'runS', metadata: {} },
      // The other value M1 names: a worker of the EARLIER run raised its hand
      // and the run ended with the hand still up.
      'S-1': { revision: 1,
               short_id: 'ss11',
               metadata: { [ATTENTION_KEY]: STALE_B.was, [ATTENTION_MSG_KEY]: STALE_B.msg } },
      // And the case the absent key does not cover: the key is PRESENT and
      // reads `ok`. A task at rest is not a stale mark, so it is not cleared.
      'S-2': { revision: 1, short_id: 'ss22', metadata: { [ATTENTION_KEY]: 'ok' } },
    },
  })
  const stub = async (prompt, opts, cwd) => {
    const label = String(opts.label)
    dispatched.push(label)
    const kind = label.split(':')[0]
    const id = label.split(':')[1]
    if (kind === 'impl' || kind === 'fix') {
      fs.writeFileSync(path.join(cwd, 't' + id + '.txt'), 'from ' + label + '\n')
      return doneImpl(cwd)
    }
    if (kind === 'review') return passReview()
    if (label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + label)
  }
  const { run } = rig({
    repo, runDir, waves: WAVES(), stub, stamp: 'run-13',
    // The poll is silenced here: leg (b) is about the Setup clear itself, and
    // the poll's own readings are leg (d)'s and leg (e)'s subject.
    kata: fake.kata, extraArgs: { kataRecord: record, attentionPollMs: 600000 },
  })
  const report = await run()

  assert.ok(dispatched.includes('impl:1'),
    'setup-clear (b) [M1] sim precondition: task 1 was worked — ' + JSON.stringify(dispatched))
  assert.ok(report && Array.isArray(report.tasks),
    'setup-clear (b) [M1] sim precondition: the run produced a report — ' + JSON.stringify(report))

  const seqOne = fake.forUid(UID[1])
  const clearsOne = seqOne.filter(isClear)
  assert.equal(clearsOne.length, 1,
    'setup-clear (b) [M1] task 1\'s issue opened at `' + ATTENTION_KEY + ': ' + STALE_B.was +
    '` — `stuck` is the other value M1 names — so exactly one `patchMetadata` on ' + UID[1] +
    ' deep-equals ' + JSON.stringify(CLEAR_PATCH) + '. The patches the fake recorded for ' +
    UID[1] + ' were: ' +
    JSON.stringify(seqOne.filter((c) => c.method === 'patchMetadata').map((c) => c.patch)))
  assert.deepEqual(clearsOne[0].patch, CLEAR_PATCH,
    'setup-clear (b) [M1] carrying exactly ' + JSON.stringify(CLEAR_PATCH) + ': ' +
    JSON.stringify(clearsOne[0].patch))
  assert.ok(beforeAnyWorkerOf(clearsOne[0], '1'),
    'setup-clear (b) [M1] and sent before the first worker dispatch of task 1. The stub had been ' +
    'handed these labels when it went out: ' + JSON.stringify(clearsOne[0].dispatchedBy))

  const clearedOne = kindsOf(runDir, CLEARED).filter((e) => e.task === '1')
  assert.equal(clearedOne.length, 1,
    'setup-clear (b) [M1] with exactly one `' + CLEARED + '` event for task 1: ' +
    JSON.stringify(clearedOne))
  assert.equal(clearedOne[0].was, STALE_B.was,
    'setup-clear (b) [M1] whose `was` is `' + STALE_B.was + '`: ' + JSON.stringify(clearedOne[0]))
  assert.equal(clearedOne[0].msg, STALE_B.msg,
    'setup-clear (b) [M1] and whose `msg` is `' + STALE_B.msg + '`: ' +
    JSON.stringify(clearedOne[0]))

  const clearsTwo = fake.forUid(UID[2]).filter(isClear)
  assert.deepEqual(clearsTwo.map((c) => c.patch), [],
    'setup-clear (b) [M1] task 2\'s issue reads `' + ATTENTION_KEY + ': ok` already, so there is ' +
    'nothing to clear and no `patchMetadata` on ' + UID[2] + ' deep-equal to ' +
    JSON.stringify(CLEAR_PATCH) + ' — an engine that patched every issue it opened would write ' +
    'one here. Got: ' + JSON.stringify(clearsTwo.map((c) => c.patch)))
  assert.deepEqual(kindsOf(runDir, CLEARED).filter((e) => e.task === '2'), [],
    'setup-clear (b) [M1] and no `' + CLEARED + '` event for task 2 at all')
}

// ══════════════════════════════════════════════════════════════════════════
// setup-clear (c) [M1] — run CLOSED: a closed issue is never patched, and the
// task is worked anyway
// ══════════════════════════════════════════════════════════════════════════
{
  const repo = makeRepo(path.join(tmp, 'repo-closed'))
  const runDir = path.join(tmp, 'run-closed')
  const PROJECT_ID = 7
  const UID_ONE = 'C-1'
  const record = {
    url: 'https://kata.int.exe.xyz',
    project: { id: PROJECT_ID, uid: 'PROJ0', name: 'ultrapowers' },
    run: { uid: 'RUNC', revision: 1 },
    tasks: { 1: { uid: UID_ONE, short_id: 'cc11', revision: 1 } },
  }
  const dispatched = []
  const fake = makeFakeKata({
    projectId: PROJECT_ID,
    seen: () => dispatched.slice(),
    issues: {
      RUNC: { revision: 1, short_id: 'runC', metadata: {} },
      // Closed, marked, and carrying NEITHER `work.adopted_run` nor
      // `work.adopted_sha` — so the reuse pass does not take it (those two keys
      // are what a `done` close writes) and this run works the task itself.
      // A closed issue is not this run's to patch, whatever its attention reads.
      'C-1': { revision: 1,
               short_id: 'cc11',
               status: 'closed',
               metadata: { [ATTENTION_KEY]: STALE_A.was, [ATTENTION_MSG_KEY]: STALE_A.msg } },
    },
  })
  const stub = async (prompt, opts, cwd) => {
    const label = String(opts.label)
    dispatched.push(label)
    const kind = label.split(':')[0]
    const id = label.split(':')[1]
    if (kind === 'impl' || kind === 'fix') {
      fs.writeFileSync(path.join(cwd, 't' + id + '.txt'), 'from ' + label + '\n')
      return doneImpl(cwd)
    }
    if (kind === 'review') return passReview()
    if (label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + label)
  }
  const { run } = rig({
    repo, runDir, waves: [[mkTask('1', ['t1.txt'])]], stub, stamp: 'run-14',
    kata: fake.kata, extraArgs: { kataRecord: record, attentionPollMs: 600000 },
  })
  await run()

  assert.ok(dispatched.includes('impl:1'),
    'setup-clear (c) [M1] `impl:1` is still dispatched: a closed issue that carries neither `' +
    RUN_KEY + '` nor `' + SHA_KEY + '` is not a reusable task, so the run works it exactly as it ' +
    'would have. The stub was handed: ' + JSON.stringify(dispatched))
  assert.deepEqual(kindsOf(runDir, 'driver:reuse'), [],
    'setup-clear (c) [M1] sim precondition: nothing was reused — the reuse pass found no ' +
    'candidate and made no event, so this task went through the ordinary pipeline: ' +
    JSON.stringify(kindsOf(runDir, 'driver:reuse')))

  assert.deepEqual(kindsOf(runDir, CLEARED), [],
    'setup-clear (c) [M1] a `closed` issue gets NO `' + CLEARED + '` event at all — not for this ' +
    'task, not for any. Got: ' + JSON.stringify(kindsOf(runDir, CLEARED)))
  const seqOne = fake.forUid(UID_ONE)
  assert.deepEqual(seqOne.filter(isClear).map((c) => c.patch), [],
    'setup-clear (c) [M1] and no `patchMetadata` anywhere in the run deep-equal to ' +
    JSON.stringify(CLEAR_PATCH) + ' on ' + UID_ONE + ': ' +
    JSON.stringify(seqOne.filter((c) => c.method === 'patchMetadata').map((c) => c.patch)))
  // "gets neither", read over the window M1 names: the Setup pass, which ends
  // at the first worker of this task. (The whole run cannot be the window —
  // every dispatched task ends with a metadata patch on its issue whichever way
  // it goes, `kataLanded` + `kataAdopted` when it is adopted and `kataMark`
  // when the run could not finish it, and those are BASE's own writes.)
  const atSetup = seqOne.filter((c) => c.method === 'patchMetadata' && beforeAnyWorkerOf(c, '1'))
  assert.deepEqual(atSetup.map((c) => c.patch), [],
    'setup-clear (c) [M1] and NO `patchMetadata` whatsoever on ' + UID_ONE + ' before the first ' +
    'worker dispatch of task 1 — the Setup pass reads a `closed` issue and writes nothing to it. ' +
    'Got, with the labels the stub had been handed by then: ' +
    JSON.stringify(atSetup.map((c) => ({ patch: c.patch, dispatchedBy: c.dispatchedBy }))))
}

// ══════════════════════════════════════════════════════════════════════════
// setup-clear (e) [M3] — run MIDRUN: a worker that raises its hand WHILE it
// runs is still recorded, exactly as at BASE
// ══════════════════════════════════════════════════════════════════════════
{
  const repo = makeRepo(path.join(tmp, 'repo-midrun'))
  const runDir = path.join(tmp, 'run-midrun')
  const PROJECT_ID = 7
  const UID_ONE = 'M-1'
  const record = {
    url: 'https://kata.int.exe.xyz',
    project: { id: PROJECT_ID, uid: 'PROJ0', name: 'ultrapowers' },
    run: { uid: 'RUNM', revision: 1 },
    tasks: { 1: { uid: UID_ONE, short_id: 'mm11', revision: 1 } },
  }
  const dispatched = []
  const fake = makeFakeKata({
    projectId: PROJECT_ID,
    seen: () => dispatched.slice(),
    issues: {
      RUNM: { revision: 1, short_id: 'runM', metadata: {} },
      // Nothing stale here: this issue opens at rest, so the Setup clear has
      // nothing to do and the only attention the record shows is the one this
      // run's own worker raises.
      'M-1': { revision: 1, short_id: 'mm11', metadata: {} },
    },
  })
  const stub = async (prompt, opts, cwd) => {
    const label = String(opts.label)
    dispatched.push(label)
    const kind = label.split(':')[0]
    const id = label.split(':')[1]
    if (kind === 'impl' || kind === 'fix') {
      fs.writeFileSync(path.join(cwd, 't' + id + '.txt'), 'from ' + label + '\n')
      // `kata meta set $KATA_REF work.attention stuck`, from inside the worker:
      // the WORKER's write, straight into the fake's store, so it is not an
      // engine call. Then the session stays up longer than one poll interval,
      // which is what gives the timer a reading to take.
      fake.storeSet(UID_ONE,
        { [ATTENTION_KEY]: MIDRUN.attention, [ATTENTION_MSG_KEY]: MIDRUN.msg })
      await sleep(200)
      return doneImpl(cwd)
    }
    if (kind === 'review') return passReview()
    if (label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + label)
  }
  const { run } = rig({
    repo, runDir, waves: [[mkTask('1', ['t1.txt'])]], stub, stamp: 'run-15',
    kata: fake.kata, extraArgs: { kataRecord: record, attentionPollMs: 50 },
  })
  await run()

  assert.ok(dispatched.includes('impl:1'),
    'setup-clear (e) [M3] sim precondition: task 1\'s implementer ran — ' +
    JSON.stringify(dispatched))
  const attnOne = kindsOf(runDir, 'driver:attention').filter((e) => e.task === '1')
  assert.equal(attnOne.length, 1,
    'setup-clear (e) [M3] the implementer moved `' + ATTENTION_KEY + '` to `' + MIDRUN.attention +
    '` while it ran and stayed up 200 ms with the poll at 50 ms, so the run recorded EXACTLY ONE ' +
    '`driver:attention` event for task 1 — the Setup clear is a Setup-time correction of a ' +
    'PRIOR run\'s mark and touches nothing the poll does afterwards. events.jsonl\'s ' +
    '`driver:attention` rows: ' + JSON.stringify(kindsOf(runDir, 'driver:attention')))
  assert.equal(attnOne[0].attention, MIDRUN.attention,
    'setup-clear (e) [M3] whose `attention` is `' + MIDRUN.attention + '`: ' +
    JSON.stringify(attnOne[0]))
  assert.equal(attnOne[0].msg, MIDRUN.msg,
    'setup-clear (e) [M3] and whose `msg` is the worker\'s own (`' + MIDRUN.msg + '`): ' +
    JSON.stringify(attnOne[0]))
  assert.equal(attnOne[0].task, '1',
    'setup-clear (e) [M3] on task 1: ' + JSON.stringify(attnOne[0]))
  assert.deepEqual(kindsOf(runDir, CLEARED), [],
    'setup-clear (e) [M3] and this issue opened at rest, so no `' + CLEARED + '` event was ' +
    'written for it: ' + JSON.stringify(kindsOf(runDir, CLEARED)))
}

// ══════════════════════════════════════════════════════════════════════════
// (d) [M4] the contract sentences, read the way the Proof's second `Run:`
// line reads them
// ══════════════════════════════════════════════════════════════════════════
{
  // The Proof's second `Run:` reads CONTRACT.md three ways:
  //   sed -n '/^  The re-edge (#979)/,/^- \*\*/p' … | tr '\n' ' ' \
  //     | grep -q 'work.state.*landed.*adopted.*work.attention.*ok.*SessionEnd'
  //   test "$(grep -c 'exactly the two flat keys' fleet/CONTRACT.md)" = 0
  //   sed -n '/^  Closes: an adopted task/,/idempotency key/p' … | tr '\n' ' ' \
  //     | grep -q 'three flat keys.*work.adopted_run.*work.adopted_sha.*work.state'
  // Those are the same three reads, taken here on the same ranges.
  const text = fs.readFileSync(path.join(HERE, '..', 'CONTRACT.md'), 'utf8')
  const lines = text.split('\n')
  const flatten = (from, to) => lines.slice(from, to + 1).join(' ')
  const rangeFrom = (startsWith, endsWhen, label) => {
    const start = lines.findIndex((l) => l.startsWith(startsWith))
    assert.ok(start !== -1,
      '(d) [M4] fleet/CONTRACT.md carries the ' + label + ' line the Proof\'s `Run:` seds from')
    let end = -1
    for (let i = start + 1; i < lines.length; i += 1) {
      if (endsWhen(lines[i])) { end = i; break }
    }
    assert.ok(end !== -1,
      '(d) [M4] and a line the ' + label + ' sed range ends at')
    return flatten(start, end)
  }

  // The kata section's re-edge range — where M4's new sentence belongs.
  const kataRange = rangeFrom('  The re-edge (#979)', (l) => l.startsWith('- **'), 'kata section')
  assert.match(kataRange,
    /work\.state[\s\S]*landed[\s\S]*adopted[\s\S]*work\.attention[\s\S]*ok[\s\S]*SessionEnd/,
    '(d) [M4] the kata section says, in one sentence, that a task issue\'s `work.state` reads ' +
    '`landed` from the driver\'s capture of its result and `adopted` from its fold, and that ' +
    'the capture clears `work.attention` to `ok` because the worker\'s SessionEnd hook stamped ' +
    '`needs-human` on a session that handed off to the driver — in the order the Proof\'s `Run:` ' +
    'greps for (work.state, landed, adopted, work.attention, ok, SessionEnd). The range reads:\n' +
    kataRange)

  // The words the old two-key sentence used, which M4 retires outright: one
  // occurrence at BASE (line 559), none once the Closes sentence is rewritten.
  const OLD = 'exactly the two flat keys'
  const stale = lines
    .map((l, i) => ({ l, n: i + 1 }))
    .filter(({ l }) => l.includes(OLD))
  assert.deepEqual(stale, [],
    '(d) [M4] and "' + OLD + '" is gone from fleet/CONTRACT.md — the adoption patch carries ' +
    'three now, so the old words describe a patch the engine no longer sends. Still at: ' +
    JSON.stringify(stale.map(({ n }) => 'line ' + n)))

  // The `Closes:` sentence itself — its first line through its `idempotency
  // key` line, the Proof's own range.
  const closesRange = rangeFrom('  Closes: an adopted task',
    (l) => l.includes('idempotency key'), 'Closes:')
  assert.match(closesRange,
    /three flat keys[\s\S]*work\.adopted_run[\s\S]*work\.adopted_sha[\s\S]*work\.state/,
    '(d) [M4] the `Closes:` sentence names the adoption patch\'s THREE flat keys — ' +
    '`work.adopted_run`, `work.adopted_sha`, `work.state` — in that order. The range reads:\n' +
    closesRange)

  // ══════════════════════════════════════════════════════════════════════
  // setup-clear (g) [M5] — the worker's-raised-hand paragraph names the
  // Setup clear
  // ══════════════════════════════════════════════════════════════════════
  // The Proof's own range and its own read, taken here:
  //   sed -n '/The worker.s raised hand/,/re-edge (#979)/p' fleet/CONTRACT.md \
  //     | tr '\n' ' ' \
  //     | grep -q 'driver:attention-cleared.*work\.attention.*ok.*work\.attention_msg.*closed'
  const handStart = lines.findIndex((l) => /The worker.s raised hand/.test(l))
  assert.ok(handStart !== -1,
    'setup-clear (g) [M5] fleet/CONTRACT.md carries the `The worker\'s raised hand:` line the ' +
    'Proof\'s `Run:` seds from — M5 names that paragraph of the `Kata record (engine)` bullet as ' +
    'where the Setup clear is written down')
  let handEnd = -1
  for (let i = handStart + 1; i < lines.length; i += 1) {
    if (lines[i].includes('re-edge (#979)')) { handEnd = i; break }
  }
  assert.ok(handEnd !== -1,
    'setup-clear (g) [M5] and the `The re-edge (#979)` line that closes the sed range')
  const handRange = flatten(handStart, handEnd)
  assert.match(handRange,
    /driver:attention-cleared[\s\S]*work\.attention[\s\S]*ok[\s\S]*work\.attention_msg[\s\S]*closed/,
    'setup-clear (g) [M5] the worker\'s-raised-hand paragraph, read as one line, names the Setup ' +
    'clear: `driver:attention-cleared`, then the two flat keys it writes (`work.attention` set to ' +
    '`ok`, `work.attention_msg` emptied), then that a `closed` issue is never patched — in that ' +
    'order, the order the Proof\'s second `Run:` line greps for. A paragraph lacking any of the ' +
    'five fails this leg. The range reads:\n' + handRange)
}

console.log('ALL TESTS PASSED')
