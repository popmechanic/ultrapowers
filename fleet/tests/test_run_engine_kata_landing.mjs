/**
 * fleet/tests/test_run_engine_kata_landing.mjs — the exam for Task 2: *a task's
 * issue reads `landed` when the driver takes its result and `adopted` when it is
 * folded, and the hook's `needs-human` is cleared*.
 *
 * This file is the Proof's `Test: fleet/tests/test_run_engine_kata_landing.mjs`,
 * written where the Proof names it. Every relative import is written for THIS
 * directory: `../` is the repository's `fleet/`, `./` is `fleet/tests/`.
 *
 * The legs, and what each asserts — every assertion below names its leg and the
 * Machine clause it comes from, so a reader can map this file back to the
 * contract:
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
function makeFakeKata ({ projectId, issues, witness = () => [] }) {
  const calls = []
  const hookStamps = []
  const store = new Map()
  for (const [uid, iss] of Object.entries(issues)) {
    store.set(uid, { uid, revision: iss.revision, short_id: iss.short_id,
                     metadata: { ...(iss.metadata || {}) }, owner: null,
                     status: 'open', labels: [] })
  }
  const need = (uid) => {
    const iss = store.get(uid)
    if (!iss) throw new Error('fake kata: no issue ' + JSON.stringify(uid))
    return iss
  }
  const record = (method, uid, fields, answer) => {
    calls.push({ method, uid, ...fields, answer, ended: witness() })
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
    issues: {
      RUN0: { revision: 1, short_id: 'run9', metadata: {} },
      'U-1': { revision: 1, short_id: 'aa11', metadata: {} },
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
    if (UID[id]) fake.hookStamp(UID[id])
    ended.push(label)
    return reply
  }
  const { run } = rig({
    repo, runDir, waves: WAVES(), stub, stamp: STAMP,
    kata: fake.kata, extraArgs: { kataRecord: record },
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
}

console.log('ALL TESTS PASSED')
