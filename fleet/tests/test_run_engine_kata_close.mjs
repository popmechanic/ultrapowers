/**
 * fleet/tests/test_run_engine_kata_close.mjs — the exam for Task 1: *the engine
 * stamps an issue with the run and sha that adopted it, before it closes it*.
 *
 * This file is the Proof's `Test: fleet/tests/test_run_engine_kata_close.mjs`,
 * written where the Proof names it. Every relative import is written for THIS
 * directory: `../` is the repository's `fleet/`, `./` is `fleet/tests/`.
 *
 * The legs, and what each asserts — every assertion below names its leg and the
 * Machine clause it comes from, so a reader can map this file back to the
 * contract:
 *
 *   (a) [M1] With the rig's stamp `run-12`, a fake hub and a record naming
 *       tasks `1` and `2`, task `1` adopted in wave 1: the fake's call log has,
 *       for task 1's uid, a `patchMetadata` whose patch is EXACTLY
 *       `{'work.adopted_run': 12, 'work.adopted_sha': <sha>}` — `<sha>` the
 *       run's wave-1 `headSha`, the one the `driver:wave-adopted` event names —
 *       sent under the revision the fake last answered for that uid, and
 *       immediately followed (in that uid's own call sequence) by that uid's
 *       `close`, whose `evidence` carries `{type: 'commit', sha: <the same
 *       sha>}`.
 *   (b) [M2] Task `2`, whose stub reviewer blocks it into `needs-review`: the
 *       fake's store for its uid has no `work.adopted_run` and no
 *       `work.adopted_sha` key — and no `patchMetadata` for that uid ever
 *       carried either — while it does carry `work.attention: 'needs-human'`.
 *   (c) [M3] The same two-task run with no `kata` and no `kataRecord`: the run
 *       completes (its one wave still adopts) and the fake — still constructed,
 *       never passed — recorded zero calls; the run's log carries no `kata:`
 *       event either.
 *   (d) [M4] `fleet/CONTRACT.md`'s Kata record (engine) bullet, read through
 *       the Proof's own `Run:` range, says in its Closes sentence that the
 *       close is preceded by a metadata patch of `work.adopted_run` and
 *       `work.adopted_sha`.
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
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'engine-kata-close-')))
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }))

// ── M1's literals, spelled once ─────────────────────────────────────────────
// The run stamp the rig is given, and the integer M1 says the engine parses out
// of it (`run-<N>` → N, as a NUMBER).
const STAMP = 'run-12'
const ADOPTED_RUN = 12
const RUN_KEY = 'work.adopted_run'
const SHA_KEY = 'work.adopted_sha'
// The two keys M1 names and NOTHING else — sorted, for a deep-equal on the
// patch's key set.
const ADOPTED_KEYS = [RUN_KEY, SHA_KEY]

const mkTask = (id, files, over = {}) => ({
  id, title: 'task ' + id, files, tier: 'standard', review: 'lean',
  writes: files, commutes: [], proofTests: [], proofRuns: [],
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
// merge and every mutation bumps the issue's revision, which is what makes
// "the revision the fake last answered for that uid" a readable fact below.
function makeFakeKata ({ projectId, issues }) {
  const calls = []
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
    calls.push({ method, uid, ...fields, answer })
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
  }
}

// The two-task wave both of the hub legs are read off. Task `1`'s reviewer
// passes, so it is the wave's one adopted row; task `2`'s reviewer returns a
// blocking finding on EVERY round, so that task is never adopted and ends as
// one of the run's `needs-review` tasks — whichever number of rounds the fix
// loop grants it.
const WAVES = () => [[mkTask('1', ['t1.txt']), mkTask('2', ['t2.txt'])]]
const stubOf = (labels) => async (prompt, opts, cwd) => {
  const label = String(opts.label)
  labels.push(label)
  const kind = label.split(':')[0]
  const id = label.split(':')[1]
  if (kind === 'impl' || kind === 'fix') {
    fs.writeFileSync(path.join(cwd, 't' + id + '.txt'), 'from ' + label + '\n')
    return doneImpl(cwd)
  }
  if (kind === 'review') {
    if (id === '1') return passReview()
    return { verdict: 'FIX_REQUIRED',
             issues: [{ severity: 'blocking', detail: 'task 2 is not adoptable',
                        actor: 'implementer' }] }
  }
  if (label === 'integration') return cleanCritic()
  throw new Error('unexpected dispatch: ' + label)
}

// ══════════════════════════════════════════════════════════════════════════
// (a) [M1] and (b) [M2] — one run, a hub, one adopted task and one marked one
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
  const fake = makeFakeKata({
    projectId: PROJECT_ID,
    issues: {
      RUN0: { revision: 1, short_id: 'run9', metadata: {} },
      'U-1': { revision: 1, short_id: 'aa11', metadata: {} },
      'U-2': { revision: 1, short_id: 'bb22', metadata: {} },
    },
  })
  const labels = []
  const { run } = rig({
    repo, runDir, waves: WAVES(), stub: stubOf(labels), stamp: STAMP,
    kata: fake.kata, extraArgs: { kataRecord: record },
  })
  const report = await run()

  // ── preconditions: the run this sim is asserting about actually happened ──
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
    '(a) [M1] sim precondition: task 1 ended `done` — ' + JSON.stringify(rowOf('1')))
  assert.ok(rowOf('2') && rowOf('2').status !== 'done',
    '(b) [M2] sim precondition: task 2 did not end `done`, so the engine marks it for a ' +
    'person instead of closing it — ' + JSON.stringify(rowOf('2')))

  // The sha M1 names: the wave's adopted head, as the `driver:wave-adopted`
  // event on the run's own log names it.
  const adopted = eventsOf(runDir).filter((e) => e.kind === 'driver:wave-adopted')
  assert.equal(adopted.length, 1,
    '(a) [M1] sim precondition: one `driver:wave-adopted` event — ' + JSON.stringify(adopted))
  const SHA = adopted[0].headSha
  assert.match(String(SHA), /^[0-9a-f]{40}$/,
    '(a) [M1] the wave-1 adopted head is a 40-hex sha: ' + JSON.stringify(SHA))

  // ── (a) [M1] the patch: exactly the two flat keys, exact values ───────────
  const patchesForOne = fake.forUid(UID[1]).filter((c) => c.method === 'patchMetadata')
  const adoptedPatches = patchesForOne.filter(
    (c) => c.patch && Object.prototype.hasOwnProperty.call(c.patch, RUN_KEY))
  assert.equal(adoptedPatches.length, 1,
    '(a) [M1] the engine patched task 1\'s issue with `' + RUN_KEY + '` exactly once — every ' +
    'adopted task is stamped, and stamped once. The patchMetadata calls the fake recorded for ' +
    UID[1] + ' were: ' + JSON.stringify(patchesForOne.map((c) => c.patch)))
  const stamped = adoptedPatches[0]
  assert.deepEqual(Object.keys(stamped.patch).sort(), ADOPTED_KEYS,
    '(a) [M1] that patch carries EXACTLY the two flat keys `' + RUN_KEY + '` and `' + SHA_KEY +
    '` — nothing else rides along: ' + JSON.stringify(stamped.patch))
  assert.deepEqual(stamped.patch, { [RUN_KEY]: ADOPTED_RUN, [SHA_KEY]: SHA },
    '(a) [M1] and its value is exactly {' + RUN_KEY + ': ' + ADOPTED_RUN + ' (the integer ' +
    'parsed from the run stamp `' + STAMP + '`, not the string), ' + SHA_KEY + ': ' + SHA +
    ' (the wave-1 adopted head)}; got ' + JSON.stringify(stamped.patch))
  assert.equal(typeof stamped.patch[RUN_KEY], 'number',
    '(a) [M1] the run number is a number, never a string and never NaN: ' +
    JSON.stringify(stamped.patch[RUN_KEY]))
  assert.ok(Number.isInteger(stamped.patch[RUN_KEY]),
    '(a) [M1] and an integer: ' + JSON.stringify(stamped.patch[RUN_KEY]))

  // ── (a) [M1] the revision it was sent under ──────────────────────────────
  // "The revision the engine last held for that issue" is, from outside, the
  // revision the fake last ANSWERED for that uid before this call — every
  // answer (the read, the claim, each comment, each earlier patch) moves it.
  let lastAnswered = null
  let expectedRevision = 'no answer for ' + UID[1] + ' preceded the patch'
  for (const c of fake.calls) {
    if (c === stamped) { expectedRevision = lastAnswered; break }
    if (c.uid === UID[1] && c.answer && typeof c.answer.revision === 'number') {
      lastAnswered = c.answer.revision
    }
  }
  assert.equal(stamped.revision, expectedRevision,
    '(a) [M1] the patch is sent under the revision the hub last answered for ' + UID[1] +
    ' (' + JSON.stringify(expectedRevision) + ') — the tracker\'s revision, not the record\'s, ' +
    'or the hub answers 412; got ' + JSON.stringify(stamped.revision))

  // ── (a) [M1] and the close that follows it, with the same sha ────────────
  const seq = fake.forUid(UID[1])
  const at = seq.indexOf(stamped)
  const next = seq[at + 1]
  assert.ok(next && next.method === 'close',
    '(a) [M1] the very next call the engine makes on task 1\'s issue is its `close` — the ' +
    'stamp is written BEFORE the close, with nothing else on that issue in between. ' +
    UID[1] + '\'s call sequence was: ' +
    JSON.stringify(seq.map((c) => c.method)))
  const evidence = (next.opts || {}).evidence
  assert.ok(Array.isArray(evidence),
    '(a) [M1] that close carries an `evidence` array: ' + JSON.stringify(next.opts))
  const commit = evidence.find((e) => e && e.type === 'commit')
  assert.deepEqual(commit, { type: 'commit', sha: SHA },
    '(a) [M1] whose commit evidence is the SAME sha the patch wrote — ' +
    '{type: "commit", sha: ' + SHA + '}; got ' + JSON.stringify(commit))
  assert.equal((next.opts || {}).reason, 'done',
    '(a) [M1] and the close is a `done`: ' + JSON.stringify((next.opts || {}).reason))

  // The patch reached the issue, and reached it as a per-key MERGE: every key
  // an earlier patch put on that issue is still there beside the two new ones.
  const metaOne = fake.metaOf(UID[1])
  assert.equal(metaOne[RUN_KEY], ADOPTED_RUN,
    '(a) [M1] task 1\'s issue carries `' + RUN_KEY + '` = ' + ADOPTED_RUN + ': ' +
    JSON.stringify(metaOne))
  assert.equal(metaOne[SHA_KEY], SHA,
    '(a) [M1] and `' + SHA_KEY + '` = ' + SHA + ': ' + JSON.stringify(metaOne))
  for (const c of patchesForOne) {
    if (c === stamped) continue
    for (const k of Object.keys(c.patch || {})) {
      assert.ok(Object.prototype.hasOwnProperty.call(metaOne, k),
        '(a) [M1] the stamp is a per-key merge: the key `' + k + '` an earlier patch set on ' +
        'task 1\'s issue survives it. The issue now reads: ' + JSON.stringify(metaOne))
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // (b) [M2] the task the engine did not close is not stamped
  // ══════════════════════════════════════════════════════════════════════
  const metaTwo = fake.metaOf(UID[2])
  assert.ok(!Object.prototype.hasOwnProperty.call(metaTwo, RUN_KEY),
    '(b) [M2] task 2 was never adopted, so its issue carries NO `' + RUN_KEY + '` key at all: ' +
    JSON.stringify(metaTwo))
  assert.ok(!Object.prototype.hasOwnProperty.call(metaTwo, SHA_KEY),
    '(b) [M2] and no `' + SHA_KEY + '` key: ' + JSON.stringify(metaTwo))
  for (const c of fake.forUid(UID[2]).filter((x) => x.method === 'patchMetadata')) {
    for (const k of ADOPTED_KEYS) {
      assert.ok(!Object.prototype.hasOwnProperty.call(c.patch || {}, k),
        '(b) [M2] no metadata patch on task 2\'s issue ever carried `' + k + '` — the stamp ' +
        'lives only where the adoption does: ' + JSON.stringify(c.patch))
    }
  }
  assert.equal(metaTwo['work.attention'], 'needs-human',
    '(b) [M2] while the issue IS marked for a person — `work.attention: needs-human`, the ' +
    '`needs-review` marking the engine already made at BASE: ' + JSON.stringify(metaTwo))
  assert.equal(fake.forUid(UID[2]).filter((c) => c.method === 'close').length, 0,
    '(b) [M2] and it is left open — no `close` on ' + UID[2] + ': ' +
    JSON.stringify(fake.forUid(UID[2]).map((c) => c.method)))
}

// ══════════════════════════════════════════════════════════════════════════
// (c) [M3] no record, no hub: the engine's hub calls are BASE's — none
// ══════════════════════════════════════════════════════════════════════════
{
  const repo = makeRepo(path.join(tmp, 'repo-nohub'))
  const runDir = path.join(tmp, 'run-nohub')
  // Constructed exactly as above and never passed: a fake that recorded a call
  // could only have been reached by an engine that built its own client.
  const fake = makeFakeKata({
    projectId: 7,
    issues: {
      RUN0: { revision: 1, short_id: 'run9', metadata: {} },
      'U-1': { revision: 1, short_id: 'aa11', metadata: {} },
      'U-2': { revision: 1, short_id: 'bb22', metadata: {} },
    },
  })
  const labels = []
  const { run } = rig({
    repo, runDir, waves: WAVES(), stub: stubOf(labels), stamp: STAMP,
  })
  const report = await run()

  assert.equal(report.waveMerges.length, 1,
    '(c) [M3] sim precondition: the hub-less run folded its one wave — ' +
    JSON.stringify(report.waveMerges))
  assert.equal(report.waveMerges[0].status, 'MERGED',
    '(c) [M3] the run completes and wave 1 still adopts with no hub in sight — ' +
    JSON.stringify(report.waveMerges[0]))
  assert.deepEqual(report.waveMerges[0].branches, ['1'],
    '(c) [M3] adopting the same one task — ' + JSON.stringify(report.waveMerges[0].branches))
  assert.deepEqual(fake.calls, [],
    '(c) [M3] with `kata` absent the engine makes NO hub call at all — exactly what it made ' +
    'at BASE. The fake recorded: ' + JSON.stringify(fake.calls.map((c) => c.method + ' ' + c.uid)))
  const kataEvents = eventsOf(runDir).filter((e) => String(e.kind || '').startsWith('kata:'))
  assert.deepEqual(kataEvents, [],
    '(c) [M3] and no `kata:` event is on the run\'s log either — nothing was attempted and ' +
    'failed: ' + JSON.stringify(kataEvents))
}

// ══════════════════════════════════════════════════════════════════════════
// (d) [M4] the contract sentence, read the way the Proof's `Run:` reads it
// ══════════════════════════════════════════════════════════════════════════
{
  // The Proof's Run: is
  //   sed -n '/Kata record (engine)/,/status.json:/p' fleet/CONTRACT.md \
  //     | tr '\n' ' ' | grep -q 'Closes:.*work.adopted_run.*work.adopted_sha.*done'
  // — the `Kata record (engine)` line through the first `status.json:` line,
  // flattened. This is that range, read the same way.
  const lines = fs.readFileSync(path.join(HERE, '..', 'CONTRACT.md'), 'utf8').split('\n')
  const start = lines.findIndex((l) => l.includes('Kata record (engine)'))
  assert.ok(start !== -1,
    '(d) [M4] fleet/CONTRACT.md carries a `Kata record (engine)` bullet')
  let end = -1
  for (let i = start; i < lines.length; i += 1) {
    if (lines[i].includes('status.json:')) { end = i; break }
  }
  assert.ok(end !== -1,
    '(d) [M4] and the Proof\'s sed range ends at a `status.json:` line after it')
  const bullet = lines.slice(start, end + 1).join(' ')
  assert.match(bullet, /Closes:.*work\.adopted_run.*work\.adopted_sha.*done/,
    '(d) [M4] the bullet\'s Closes sentence says the close is preceded by a metadata patch of ' +
    '`work.adopted_run` and `work.adopted_sha` — in the order the Proof\'s Run greps for ' +
    '(Closes:, work.adopted_run, work.adopted_sha, done). The range reads:\n' + bullet)
}

console.log('ALL TESTS PASSED')
