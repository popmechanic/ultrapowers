/**
 * fleet/tests/test_run_engine_re_edge.mjs — the exam for Task 2: *a task whose
 * proof needs a sibling still in flight waits for that sibling and then runs,
 * instead of failing the run*.
 *
 * This file is the Proof's `Test: fleet/tests/test_run_engine_re_edge.mjs`,
 * written where the Proof names it. Every relative import is written for THIS
 * directory: `../` is the repository's `fleet/`, `./` is `fleet/tests/`.
 *
 * The Machine clauses under test, restated:
 *   M1 — the implementer's and the fix round's prompts carry, in the `SIBLING
 *        FILES` line, each sibling's kata reference beside its id —
 *        `<id> (<project>#<short_id>): <files>` — when the run has a hub
 *        record, and the bare `<id>: <files>` shape as at BASE when it has
 *        none.
 *   M2 — `fleet/roles/implementer.md` and `fleet/roles/fix.md` say, in their
 *        issue section, that when a proof runs a file a sibling owns and is red
 *        only because that sibling's work is not in the tree, the worker runs
 *        `kata edit $KATA_REF --blocked-by <that sibling's reference>`, sets
 *        `work.attention` `stuck` with a message naming the sibling, and
 *        returns `BLOCKED` naming it.
 *   M3 — the client's `getIssue` answer carries `links` — each `{type, from:
 *        {uid, short_id}, to: {uid, short_id}}` as the hub answers them —
 *        beside the six keys it carries at BASE.
 *   M4 — when an implementer returns `BLOCKED` and the task's issue, read after
 *        that return, carries a `blocks` link whose `from` is a sibling task of
 *        this run not adopted in the head the dispatch went out on, the driver
 *        records the edge sibling → task,
 *        appends `driver:re-edged {task, blockedBy: [<sibling ids>]}`, marks the
 *        task unstarted (its slot frees, no fix round, no `needs-review`, no
 *        close), and the task is dispatched again — a fresh implementer, clone
 *        re-anchored — only after every such sibling is adopted; a `BLOCKED`
 *        with no such link is the failure it is at BASE; a link whose `from`
 *        names a sibling already failed makes the task `unfinished: blocked —
 *        depends on a failed task`.
 *   M5 — `fleet/CONTRACT.md`'s Kata record (engine) bullet carries, in this
 *        order, the words `SIBLING FILES`, `--blocked-by`, `links`,
 *        `driver:re-edged` and `dispatched again`.
 *
 * The Proof legs, and where each is answered — every assertion below names its
 * leg and the clause it comes from, so a reader can map this file back to the
 * contract:
 *   (c) [M3] the client's projection            — first, over a stub transport
 *   (b) [M2] the two role sections              — the third and fourth `Run:`
 *            lines' own ranges and order, re-read here so the exam grades them
 *   (e) [M5] the contract bullet                — the fifth `Run:` line's own
 *            range and order, re-read here. The leg's other half — "Task 1's
 *            sim by the first `Run:`" — is answered by that `Run:` line ALONE:
 *            a sim may not name a sibling sim (the hermetic probe forbids it),
 *            so that name appears nowhere in this file.
 *   (a) [M1] the two prompt shapes              — two runs, hub and no hub
 *   (d) [M4] the four scheduling scenarios      — four runs
 *
 * The cheap static legs run first on purpose: at that task's BASE the first
 * thing that fails is the client's projection, which is exactly the absent
 * implementation and nothing else.
 *
 * ── the addendum: "the re-edge reads the tree the worker was handed" ─────────
 * The re-edge as M4 above left it reads the LIVE adopted set, so a sibling that
 * was adopted while this task's worker was working reads as "already in the
 * tree it was handed" — which it is not. That task's clauses, restated:
 *   M1 — when an implementer returns `BLOCKED` and the task's issue, read after
 *        that return, carries a `blocks` link whose `from` is a sibling task of
 *        this run that was NOT adopted in the head this task's dispatch went
 *        out on — whether that sibling is still in flight or has been adopted
 *        since — the driver appends one `driver:re-edged {task, blockedBy:
 *        [<sibling ids>]}` naming it, records the edge sibling → task,
 *        dispatches no fix round and no reviewer for that attempt, and
 *        dispatches the task again — a fresh implementer, a second
 *        `worker:start` — on a clone anchored at the head of the epoch that
 *        adopted the sibling, after that epoch's `driver:wave-adopted`; the
 *        task then lands `done` and the run is complete.
 *   M2 — a `blocks` link whose `from` is a sibling that WAS adopted in the head
 *        this task's dispatch went out on is not a re-edge: the task ends
 *        `failed` with `reviewVerdict` `not-reviewed`, as at BASE.
 *   M3 — `fleet/CONTRACT.md`'s "The re-edge (#979)" bullet says the link's
 *        `from` is another task of this run that was not adopted in the head
 *        the task's dispatch went out on, and no longer says `not yet adopted`.
 *
 * and its legs, and where each is answered:
 *   (a) [M1] scenario (d.5), first half   — A is adopted while B is in flight
 *   (b) [M2] scenario (d.5), second half  — A is adopted before B is dispatched
 *   (c) [M1] the whole sim prints the sentinel — (d.1)–(d.4) are untouched
 *            below and hold exactly as at BASE, and this file's last line is
 *            the sentinel the first `Run:` greps for
 *   (d) [M3] the second and third `Run:` lines' own reads of the contract,
 *            re-read here so the exam grades them
 *   (e) [M1] [M2] the fourth `Run:` — this file's own import lines, re-read
 *            here: the guarded sim imports nothing under `exams/`
 *
 * Those legs' assertions run AFTER (d.1)–(d.4) and (d.5), at the foot of the
 * file, so that at that task's BASE the first thing that fails is (d.5) — the
 * scheduling gap M1 names, which is the absent implementation itself — rather
 * than a sentence in a document.
 *
 * ── how this sim reads what the engine did ──────────────────────────────────
 * Nothing here reaches a hub or a network: the client is a fake with the
 * client's method names over an in-memory store, injected through the rig, and
 * the transport leg (c) drives is a stub that answers from a literal. Below the
 * agent seam the rig is real, as in the sibling engine sims — real git
 * repositories, real clones, the real capture, the real fold kernel through the
 * real `execSeam`. Only `agent` is canned.
 *
 * THE ORDERED LOG. The rig does not run `run-worker.mjs`, so no `worker:start`
 * / `worker:end` reaches `<runDir>/events.jsonl` on its own. The canned worker
 * here appends them itself, in production's order — `worker:start` on entry,
 * carrying the clone's HEAD (which is what leg (d) reads the re-anchor off),
 * `worker:end` immediately before returning — into the same file the engine
 * appends its own `driver:` events to. That one file is the total order every
 * ordering assertion below reads. Sim-only synchronisation uses marker FILES
 * beside it, never a new event kind.
 *
 * HOLDS ARE BOUNDED. Every "wait until X is on the log" in a stub gives up
 * after HOLD_MS and returns. At BASE — where no task is ever re-edged — a hold
 * that waited forever would hang the run instead of failing it, and the exam
 * has to be runnable at BASE to be red there. So a lapsed hold falls through
 * and the assertion that wanted the ordering is the thing that fails.
 *
 * THE LINK A WORKER FILES. `kata edit $KATA_REF --blocked-by <sibling>` files
 * ONE `blocks` link, from the blocker's side: `from` is the sibling that must
 * land first, `to` is the blocked task, and the hub answers it on both issues'
 * `links`. The fake below files it exactly that way — the stub implementer
 * calls it the way the CLI would, in the same breath as its `BLOCKED` reply —
 * and its `getIssue` answers `links` from the same store.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { makeRepo, rig, passReview, cleanCritic, doneImpl, gitSync } from './_engine_helpers.mjs'
import { makeKataClient } from '../kata-client.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'engine-re-edge-')))
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }))

// How long a stub waits for the log to say what it is waiting for. Long enough
// that a loaded box is not the reason a correct engine goes red; bounded so a
// BASE engine, which will never say it, fails an assertion instead of hanging.
const HOLD_MS = 8000
const POLL_MS = 20
const sleep = (ms) => new Promise((resolve) => { globalThis.setTimeout(resolve, ms) })
/** Poll `fn` until it is true or `ms` elapses. Never throws, never hangs. */
const waitUntil = async (fn, ms = HOLD_MS) => {
  const deadline = Date.now() + ms
  for (;;) {
    let ok = false
    try { ok = Boolean(fn()) } catch { ok = false }
    if (ok) return true
    if (Date.now() >= deadline) return false
    await sleep(POLL_MS)
  }
}

// ── the record every leg reads ──────────────────────────────────────────────
// An absent file reads as no records, so an engine that writes none fails an
// assertion rather than throwing ENOENT.
const eventsFile = (runDir) => path.join(runDir, 'events.jsonl')
const readEvents = (runDir) => {
  const file = eventsFile(runDir)
  if (!fs.existsSync(file)) return []
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l) } catch { return null } })
    .filter(Boolean)
}
const appendLine = (runDir, e) => {
  fs.appendFileSync(eventsFile(runDir), JSON.stringify(e) + '\n')
}
const openWorker = (runDir, label, extra = {}) =>
  appendLine(runDir, { kind: 'worker:start', label, ...extra })
/** An implementer's envelope carries the clone HEAD it opened on — leg (d)
 *  reads the re-anchor off it. */
const workerStart = (runDir, label, cwd) =>
  openWorker(runDir, label, { cwd, head: gitSync(['rev-parse', 'HEAD'], cwd) })
const workerEnd = (runDir, label, extra = {}) =>
  appendLine(runDir, { kind: 'worker:end', label, ...extra })
const startsOf = (log, prefix) => log.filter((e) => e.kind === 'worker:start' &&
  typeof e.label === 'string' && e.label.startsWith(prefix))
const adoptionsOf = (log) => log.filter((e) => e.kind === 'driver:wave-adopted')
const reEdgesOf = (log) => log.filter((e) => e.kind === 'driver:re-edged')
/** A readable dump for a failed ordering assertion. */
const shownLog = (log) => log
  .map((e, i) => i + ' ' + e.kind + ' ' + (e.label || JSON.stringify(e.tasks || e.task || '')))
  .join(' | ')

// The task shape every scenario uses: one file of its own, no proof paths, so
// the only workers dispatched are `impl:`, `fix:` and `review:`.
const taskOf = (id, over = {}) => ({
  id, title: 'task ' + id, files: [id + '.txt'], tier: 'standard', review: 'lean',
  writes: [id + '.txt'], commutes: [],
  testCmd: 'bash check.sh', proofTests: [], proofRuns: [],
  body: 'sim task ' + id,
  ...over,
})

// ── the fake hub ────────────────────────────────────────────────────────────
// The client's method names over an in-memory store, every call recorded IN
// ORDER with the answer it gave. `getIssue` answers `links` the way the hub
// does — every link touching that issue, each one in the hub's own shape — and
// `fileBlockedBy` is `kata edit <ref> --blocked-by <ref>`: one `blocks` link
// from the blocker's side, the same link twice being the same link once.
function makeFakeKata ({ projectId, projectName, issues }) {
  const calls = []
  const store = new Map()
  const links = []
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
  const refOf = (uid) => {
    const iss = need(uid)
    return { uid, short_id: iss.short_id, project: projectName,
             qualified_id: projectName + '#' + iss.short_id, status: iss.status }
  }
  const linksFor = (uid) => links
    .filter((l) => l.from.uid === uid || l.to.uid === uid)
    .map((l) => ({ ...l, from: { ...l.from }, to: { ...l.to } }))
  const kata = {
    async getIssue (uid) {
      const iss = need(uid)
      return record('getIssue', uid, {}, {
        uid, revision: iss.revision, short_id: iss.short_id, metadata: iss.metadata,
        status: iss.status, owner: iss.owner, project_id: projectId,
        links: linksFor(uid),
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
    links,
    /** What `kata edit <to> --blocked-by <from>` leaves on the hub. */
    fileBlockedBy: (toUid, fromUid) => {
      if (links.some((l) => l.type === 'blocks' && l.from.uid === fromUid && l.to.uid === toUid)) {
        return
      }
      links.push({ id: 'L' + (links.length + 1), type: 'blocks',
                   from: refOf(fromUid), to: refOf(toUid),
                   author: 'implementer', created_at: '2026-09-15T00:00:00Z' })
    },
  }
}

// The record every hub run is handed. Row revisions are the store's at setup,
// or the engine ends the run `kata-revision-mismatch` at that task's first
// read; each row's `short_id` is what `kataRefFor` and M1's reference read.
const PROJECT_ID = 7
const PROJECT_NAME = 'ultrapowers'
const UID = { A: 'U-A', B: 'U-B' }
const SHORT = { A: 'aa11', B: 'bb22' }
const recordFor = () => ({
  url: 'https://kata.int.exe.xyz',
  project: { id: PROJECT_ID, uid: 'PROJ0', name: PROJECT_NAME },
  run: { uid: 'RUN0', revision: 1 },
  tasks: { A: { uid: UID.A, short_id: SHORT.A, revision: 1 },
           B: { uid: UID.B, short_id: SHORT.B, revision: 1 } },
})
const hubFor = () => makeFakeKata({
  projectId: PROJECT_ID,
  projectName: PROJECT_NAME,
  issues: {
    // The run's own issue: every `driver:` event is mirrored to it as a comment.
    RUN0: { revision: 1, short_id: 'run9', metadata: {} },
    'U-A': { revision: 1, short_id: SHORT.A, metadata: {} },
    'U-B': { revision: 1, short_id: SHORT.B, metadata: {} },
  },
})

// ══════════════════════════════════════════════════════════════════════════
// (c) [M3] the client's `getIssue` projection carries `links`
// ══════════════════════════════════════════════════════════════════════════
{
  // The hub's own answer shape, measured: a link carries `id`, `from` and `to`
  // (each `{uid, short_id, project, qualified_id, status}`), `type`, `author`
  // and `created_at`, and a `blocks` link is filed from the blocker's side.
  const LINKS = [
    { id: 'L1', type: 'blocks',
      from: { uid: 'U-A', short_id: 'aa11', project: PROJECT_NAME,
              qualified_id: PROJECT_NAME + '#aa11', status: 'open' },
      to: { uid: 'U-B', short_id: 'bb22', project: PROJECT_NAME,
            qualified_id: PROJECT_NAME + '#bb22', status: 'open' },
      author: 'implementer', created_at: '2026-09-15T00:00:00Z' },
    { id: 'L2', type: 'relates',
      from: { uid: 'U-B', short_id: 'bb22', project: PROJECT_NAME,
              qualified_id: PROJECT_NAME + '#bb22', status: 'open' },
      to: { uid: 'U-C', short_id: 'cc33', project: PROJECT_NAME,
            qualified_id: PROJECT_NAME + '#cc33', status: 'closed' },
      author: 'operator', created_at: '2026-09-15T01:00:00Z' },
  ]
  // The six keys the projection carries at BASE, and the answer's own extras
  // (`title`, `body`, `short_id`) which it does NOT: `links` is added to the
  // projection, and nothing else the hub happens to answer rides in with it.
  const BASE_KEYS = ['uid', 'revision', 'metadata', 'status', 'owner', 'project_id']
  const ISSUE = {
    uid: 'U-B', revision: 4, metadata: { 'work.attention': 'stuck' }, status: 'open',
    owner: 'engine', project_id: PROJECT_ID, short_id: 'bb22',
    title: 'task B', body: 'sim task B',
  }
  const requests = []
  const transportWith = (issue) => ({
    async request (req) {
      requests.push(req)
      return { status: 200, json: { issue }, body: JSON.stringify({ issue }) }
    },
  })

  const client = makeKataClient({ transport: transportWith({ ...ISSUE, links: LINKS }),
                                  actor: 'engine' })
  const answer = await client.getIssue('U-B')

  assert.equal(requests.length, 1,
    '(c) [M3] sim precondition: `getIssue` issued exactly one request — ' +
    JSON.stringify(requests))
  assert.ok(Object.prototype.hasOwnProperty.call(answer, 'links'),
    '(c) [M3] `getIssue`\'s answer carries a `links` key when the hub answered one. It ' +
    'answered: ' + JSON.stringify(answer))
  assert.deepEqual(answer.links, LINKS,
    '(c) [M3] and carries the hub\'s links THROUGH, untouched — both of them, in the hub\'s ' +
    'order and shape. Expected ' + JSON.stringify(LINKS) + '; got ' + JSON.stringify(answer.links))
  assert.equal(answer.links.length, 2,
    '(c) [M3] both links, not the first: ' + JSON.stringify(answer.links))
  for (const [i, want] of LINKS.entries()) {
    const got = answer.links[i]
    assert.equal(got.type, want.type,
      '(c) [M3] link ' + i + ' keeps its `type` (' + want.type + '): ' + JSON.stringify(got))
    assert.equal(got.from.uid, want.from.uid,
      '(c) [M3] link ' + i + ' keeps `from.uid` (' + want.from.uid + ') — the uid M4 matches a ' +
      'sibling row against: ' + JSON.stringify(got))
    assert.equal(got.from.short_id, want.from.short_id,
      '(c) [M3] link ' + i + ' keeps `from.short_id` (' + want.from.short_id + '): ' +
      JSON.stringify(got))
    assert.equal(got.to.uid, want.to.uid,
      '(c) [M3] link ' + i + ' keeps `to.uid` (' + want.to.uid + '): ' + JSON.stringify(got))
    assert.equal(got.to.short_id, want.to.short_id,
      '(c) [M3] link ' + i + ' keeps `to.short_id` (' + want.to.short_id + '): ' +
      JSON.stringify(got))
  }
  for (const k of BASE_KEYS) {
    assert.ok(Object.prototype.hasOwnProperty.call(answer, k),
      '(c) [M3] and the answer STILL carries `' + k + '` — `links` arrives beside the six keys ' +
      'the projection carried at BASE, it does not replace them: ' + JSON.stringify(answer))
    assert.deepEqual(answer[k], ISSUE[k],
      '(c) [M3] with the value the hub answered for `' + k + '`: ' + JSON.stringify(answer))
  }
  assert.deepEqual(Object.keys(answer).sort(), [...BASE_KEYS, 'links'].sort(),
    '(c) [M3] the projection is EXACTLY those six keys plus `links` — `title`, `body` and ' +
    '`short_id` the hub also answered are still dropped: ' + JSON.stringify(Object.keys(answer)))

  // A partial issue answers a partial projection: the key stays ABSENT rather
  // than arriving as `undefined` or as an empty array nobody sent.
  const bare = makeKataClient({ transport: transportWith({ ...ISSUE }), actor: 'engine' })
  const bareAnswer = await bare.getIssue('U-B')
  assert.ok(!Object.prototype.hasOwnProperty.call(bareAnswer, 'links'),
    '(c) [M3] an answer that carries NO `links` yields no `links` key at all — not `undefined`, ' +
    'not `[]`: ' + JSON.stringify(bareAnswer) + ' (keys: ' +
    JSON.stringify(Object.keys(bareAnswer)) + ')')
  assert.deepEqual(Object.keys(bareAnswer).sort(), [...BASE_KEYS].sort(),
    '(c) [M3] and that answer is the BASE projection, unchanged: ' +
    JSON.stringify(Object.keys(bareAnswer)))
}

// ══════════════════════════════════════════════════════════════════════════
// (b) [M2] the two role sections say what a blocked worker does
// ══════════════════════════════════════════════════════════════════════════
{
  const roleText = (name) => fs.readFileSync(path.join(HERE, '..', 'roles', name), 'utf8')
  // The Proof's third `Run:` is
  //   sed -n '/^## The issue/,$p' fleet/roles/implementer.md | tr '\n' ' ' \
  //     | grep -q 'blocked-by.*stuck.*BLOCKED'
  // — the `## The issue` heading through the end of the file, flattened. The
  // fourth is the same over `fleet/roles/fix.md` from its first `KATA_REF`
  // line. These are those ranges, read the same way.
  const sections = [
    { file: 'implementer.md', anchor: 'the `## The issue` heading',
      from: (lines) => lines.findIndex((l) => /^## The issue/.test(l)) },
    { file: 'fix.md', anchor: 'the first `KATA_REF` line',
      from: (lines) => lines.findIndex((l) => l.includes('KATA_REF')) },
  ]
  for (const s of sections) {
    const lines = roleText(s.file).split('\n')
    const start = s.from(lines)
    assert.ok(start !== -1,
      '(b) [M2] sim precondition: fleet/roles/' + s.file + ' has ' + s.anchor +
      ' the Proof\'s sed range starts at')
    const section = lines.slice(start).join(' ')
    assert.match(section, /blocked-by[\s\S]*stuck[\s\S]*BLOCKED/,
      '(b) [M2] fleet/roles/' + s.file + '\'s issue section says, in the order the Proof\'s ' +
      'Run: greps for (`blocked-by`, then `stuck`, then `BLOCKED`), what a worker does when a ' +
      'proof runs a file a sibling owns and is red only because that sibling\'s work is not in ' +
      'the tree. The range from ' + s.anchor + ' reads:\n' + section)
    assert.match(section, /kata edit \$KATA_REF --blocked-by/,
      '(b) [M2] and it names the command verbatim — `kata edit $KATA_REF --blocked-by <that ' +
      'sibling\'s reference>`, which is the write the driver reads back as the link. ' +
      'fleet/roles/' + s.file + '\'s section reads:\n' + section)
    assert.match(section, /work\.attention[\s\S]*stuck/,
      '(b) [M2] and tells the worker to set `work.attention` to `stuck` — the driver-clearable ' +
      'value, not `needs-human`. fleet/roles/' + s.file + '\'s section reads:\n' + section)
    assert.match(section, /work\.attention_msg|attention_msg/,
      '(b) [M2] with a message naming the sibling (`work.attention_msg`). fleet/roles/' +
      s.file + '\'s section reads:\n' + section)
  }
}

// ══════════════════════════════════════════════════════════════════════════
// (e) [M5] the contract bullet, read the way the Proof's `Run:` reads it
// ══════════════════════════════════════════════════════════════════════════
{
  // The Proof's fifth `Run:` is
  //   sed -n '/Kata record (engine)/,/status.json:/p' fleet/CONTRACT.md \
  //     | tr '\n' ' ' \
  //     | grep -q 'SIBLING FILES.*--blocked-by.*links.*driver:re-edged.*dispatched again'
  // — the `Kata record (engine)` line through the first `status.json:` line,
  // flattened. This is that range, read the same way.
  const lines = fs.readFileSync(path.join(HERE, '..', 'CONTRACT.md'), 'utf8').split('\n')
  const start = lines.findIndex((l) => l.includes('Kata record (engine)'))
  assert.ok(start !== -1,
    '(e) [M5] sim precondition: fleet/CONTRACT.md carries a `Kata record (engine)` bullet')
  let end = -1
  for (let i = start; i < lines.length; i += 1) {
    if (lines[i].includes('status.json:')) { end = i; break }
  }
  assert.ok(end !== -1,
    '(e) [M5] sim precondition: the Proof\'s sed range ends at a `status.json:` line after it')
  const bullet = lines.slice(start, end + 1).join(' ')
  assert.match(bullet,
    /SIBLING FILES[\s\S]*--blocked-by[\s\S]*links[\s\S]*driver:re-edged[\s\S]*dispatched again/,
    '(e) [M5] the Kata record (engine) bullet carries, in this order, the words `SIBLING ' +
    'FILES`, `--blocked-by`, `links`, `driver:re-edged` and `dispatched again` — the five ' +
    'halves of the loop, named where the contract names the record. The range reads:\n' + bullet)
}

// ══════════════════════════════════════════════════════════════════════════
// (a) [M1] the `SIBLING FILES` line, with a hub record and without one
// ══════════════════════════════════════════════════════════════════════════
//
// Two tasks, width 2, so both go out before either is adopted and each is the
// other's unadopted sibling. `B` carries a `Run:` command that is red on any
// tree (`false`), so its pre-review pass buys the `fix:B:0` round M1 also
// names — the same `siblingsStr` reaches both prompts, and the leg reads both.
{
  const WAVE = () => [[taskOf('A'), taskOf('B', { proofRuns: ['false'] })]]
  /** The `SIBLING FILES` line of a recorded prompt, or null. */
  const siblingLineOf = (prompt) => {
    const line = String(prompt).split('\n').find((l) => l.startsWith('SIBLING FILES:'))
    return line === undefined ? null : line
  }
  const driveFor = async (tag, extra) => {
    const repo = makeRepo(path.join(tmp, 'repo-' + tag))
    const runDir = path.join(tmp, 'run-' + tag)
    const dispatches = []
    const stub = async (prompt, opts, cwd) => {
      const label = String(opts.label)
      dispatches.push({ label, prompt: String(prompt) })
      const kind = label.split(':')[0]
      const id = label.split(':')[1]
      if (kind === 'review') return passReview()
      if (kind === 'reconcile') return { status: 'BLOCKED', summary: 'sim: no reconcile' }
      if (label === 'integration') return cleanCritic()
      fs.writeFileSync(path.join(cwd, id + '.txt'), 'from ' + label + '\n')
      return doneImpl(cwd)
    }
    const { run } = rig({ repo, runDir, waves: WAVE(), stub, stamp: 'ree-' + tag,
                          extraArgs: { width: 2, infraBackoffMs: 0, ...extra } })
    const report = await run()
    return { report, dispatches, runDir }
  }

  // ── with a hub record: the reference rides beside the id ──────────────────
  const fake = hubFor()
  const withHub = await driveFor('m1-hub', { kataRecord: recordFor() })
  const WANT_HUB = 'SIBLING FILES: A (' + PROJECT_NAME + '#' + SHORT.A + '): A.txt'
  for (const label of ['impl:B', 'fix:B:0']) {
    const d = withHub.dispatches.find((x) => x.label === label)
    assert.ok(d,
      '(a) [M1] sim precondition: the run dispatched `' + label + '` — task B\'s red `Run:` ' +
      'buys the fix round, and both prompts are the leg\'s subject. The labels dispatched ' +
      'were: ' + JSON.stringify(withHub.dispatches.map((x) => x.label)))
    assert.equal(siblingLineOf(d.prompt), WANT_HUB,
      '(a) [M1] with a hub record naming A and B with their short ids, `' + label + '`\'s ' +
      '`SIBLING FILES` line reads exactly `' + WANT_HUB + '` — each sibling\'s kata reference ' +
      '(`<project>#<short_id>`, the project name from the record) beside its id, so the worker ' +
      'can name the sibling it is blocked on. Got: ' + JSON.stringify(siblingLineOf(d.prompt)))
  }
  assert.deepEqual(fake.calls, [],
    '(a) [M1] sim precondition: this run was handed a record and no client, so it made no hub ' +
    'call at all — the reference comes off the RECORD, never a read: ' +
    JSON.stringify(fake.calls.map((c) => c.method)))

  // ── with no record: the BASE shape, unchanged ─────────────────────────────
  const noHub = await driveFor('m1-nohub', {})
  const WANT_BARE = 'SIBLING FILES: A: A.txt'
  for (const label of ['impl:B', 'fix:B:0']) {
    const d = noHub.dispatches.find((x) => x.label === label)
    assert.ok(d,
      '(a) [M1] sim precondition: the hub-less run dispatched `' + label + '`. The labels were: ' +
      JSON.stringify(noHub.dispatches.map((x) => x.label)))
    assert.equal(siblingLineOf(d.prompt), WANT_BARE,
      '(a) [M1] with NO hub record `' + label + '`\'s line is the bare `<id>: <files>` shape it ' +
      'has at BASE — `' + WANT_BARE + '`; a run with no record has no reference to name. Got: ' +
      JSON.stringify(siblingLineOf(d.prompt)))
  }
}

// ══════════════════════════════════════════════════════════════════════════
// (d) [M4] the four scheduling scenarios
// ══════════════════════════════════════════════════════════════════════════
//
// Every scenario is the same two tasks, A and B, with NO plan edge between
// them and width 2: the edge under test is the one the driver records itself,
// from a link a worker filed. The stubs differ only in what B returns and when.
//
// `edges` and `extra` default to what (d.1)–(d.4) already passed — no plan edge
// and no extra engine argument — so those four scenarios reach the engine with
// the arguments they had at BASE; (d.5) is the only caller that passes either.
const driveHub = async ({ tag, makeStub, edges = [], extra = {} }) => {
  const repo = makeRepo(path.join(tmp, 'repo-' + tag))
  const runDir = path.join(tmp, 'run-' + tag)
  const fake = hubFor()
  const labels = []
  const stub = makeStub({ runDir, fake })
  const { run } = rig({
    repo, runDir, waves: [[taskOf('A'), taskOf('B')]], edges, stamp: 'ree-' + tag,
    kata: fake.kata,
    extraArgs: { width: 2, infraBackoffMs: 0, kataRecord: recordFor(), ...extra },
    stub: (prompt, opts, cwd) => { labels.push(String(opts.label)); return stub(prompt, opts, cwd) },
  })
  const report = await run()
  return { report, fake, labels, runDir, log: readEvents(runDir) }
}
/** The canned judgments every scenario shares, enveloped on the ordered log. */
const cannedJudgment = (runDir, label) => {
  openWorker(runDir, label)
  const reply = label === 'integration'
    ? cleanCritic()
    : (label.startsWith('reconcile') ? { status: 'BLOCKED', summary: 'sim: no reconcile' }
                                     : passReview())
  workerEnd(runDir, label)
  return reply
}
/** The plain implementer: open, write the task's own file, close. */
const plainImpl = (runDir, label, cwd, id) => {
  workerStart(runDir, label, cwd)
  fs.writeFileSync(path.join(cwd, id + '.txt'), 'from ' + label + '\n')
  const reply = doneImpl(cwd)
  workerEnd(runDir, label)
  return reply
}
/** B's first implementer, blocked on A: it files the link the way `kata edit
 *  $KATA_REF --blocked-by <A>` does, and returns BLOCKED naming A. */
const blockedOnA = (runDir, label, cwd, fake, { withLink = true } = {}) => {
  workerStart(runDir, label, cwd)
  if (withLink) fake.fileBlockedBy(UID.B, UID.A)
  const reply = { status: 'BLOCKED', summary: 'the proof runs A.txt, which task A owns and ' +
                                              'which is not in this tree yet' }
  workerEnd(runDir, label)
  return reply
}

// ── (d.1) the happy path: re-edged, held, dispatched again, adopted ─────────
{
  const attempts = { B: 0 }
  const d1 = await driveHub({
    tag: 'm4-happy',
    makeStub: ({ runDir, fake }) => async (prompt, opts, cwd) => {
      const label = String(opts.label)
      const kind = label.split(':')[0]
      const id = label.split(':')[1]
      if (kind !== 'impl' && kind !== 'fix') return cannedJudgment(runDir, label)
      if (id === 'B') {
        attempts.B += 1
        if (attempts.B === 1 && kind === 'impl') return blockedOnA(runDir, label, cwd, fake)
        return plainImpl(runDir, label, cwd, id)
      }
      // A holds until B's re-edge is on the log, so B is re-edged while A is
      // still in flight — the whole point of the wait. Bounded: a BASE engine
      // never says it, and the assertions below fail instead of hanging.
      await waitUntil(() => reEdgesOf(readEvents(runDir)).length > 0)
      return plainImpl(runDir, label, cwd, id)
    },
  })
  const log = d1.log
  const rowOf = (id) => d1.report.tasks.find((r) => r && r.task === id)

  // ── the event ────────────────────────────────────────────────────────────
  const edges = reEdgesOf(log)
  assert.equal(edges.length, 1,
    '(d) [M4] the driver appended exactly one `driver:re-edged` — B returned BLOCKED and its ' +
    'issue carried a `blocks` link from A, a sibling of this run not yet adopted, so the edge ' +
    'A -> B is recorded once. The log was: ' + shownLog(log))
  assert.equal(edges[0].task, 'B',
    '(d) [M4] naming the blocked task in `task`: ' + JSON.stringify(edges[0]))
  assert.deepEqual(edges[0].blockedBy, ['A'],
    '(d) [M4] and the sibling ids the link named in `blockedBy` — `[\'A\']`, the TASK id the ' +
    'link\'s `from.uid` resolves to, not a uid and not a short id: ' + JSON.stringify(edges[0]))

  // ── no fix round, no review, no marking, no close for that attempt ───────
  assert.deepEqual(startsOf(log, 'fix:B:').map((e) => e.label), [],
    '(d) [M4] a re-edged BLOCKED buys NO fix round — the task is unstarted, not repaired. The ' +
    'log was: ' + shownLog(log))
  const reviewsBefore = startsOf(log, 'review:B:')
    .filter((e) => log.indexOf(e) < log.indexOf(edges[0]))
  assert.deepEqual(reviewsBefore.map((e) => e.label), [],
    '(d) [M4] and no reviewer read that attempt: nothing of B reached a referee before the ' +
    're-edge. The log was: ' + shownLog(log))
  assert.ok(!d1.fake.labelsOf(UID.B).includes('needs-review'),
    '(d) [M4] B\'s issue is NOT labelled `needs-review` — a task waiting for a sibling is not ' +
    'a question for a person. Its labels are: ' + JSON.stringify(d1.fake.labelsOf(UID.B)))
  // …and the driver raised no hand on it either. Read off the PATCHES rather
  // than the final metadata since #979: B is re-dispatched and does land, and
  // its landing clears `work.attention` to `ok` (the worker's SessionEnd hook
  // stamped `needs-human` on a session that handed off), so the end-of-run
  // metadata carries an `ok` the re-edge did not write. What this leg is about
  // is that no `needs-human` was ever written for B — the re-edge is not a
  // question for a person — and that is a fact about every patch the driver
  // sent, not about the last one.
  const attentionOnB = d1.fake.forUid(UID.B)
    .filter((c) => c.method === 'patchMetadata' &&
                   Object.prototype.hasOwnProperty.call(c.patch || {}, 'work.attention'))
    .map((c) => c.patch['work.attention'])
  assert.deepEqual(attentionOnB.filter((v) => v !== 'ok'), [],
    '(d) [M4] and the driver raised no hand on it either — the only `work.attention` it ever ' +
    'wrote for B is the `ok` its landing clears to, never a `needs-human`. The values it ' +
    'patched were: ' + JSON.stringify(attentionOnB) + '; B\'s metadata ended as ' +
    JSON.stringify(d1.fake.metaOf(UID.B)))
  const closesB = d1.fake.forUid(UID.B).filter((c) => c.method === 'close')
  assert.equal(closesB.length, 1,
    '(d) [M4] B\'s issue is closed exactly once — not at the re-edge, only once the task ' +
    'really landed. The calls on ' + UID.B + ' were: ' +
    JSON.stringify(d1.fake.forUid(UID.B).map((c) => c.method)))
  assert.equal((closesB[0].opts || {}).reason, 'done',
    '(d) [M4] and that close is a `done`: ' + JSON.stringify(closesB[0].opts))

  // ── dispatched again, after A was adopted, on A's head ───────────────────
  const startsB = startsOf(log, 'impl:B')
  assert.equal(startsB.length, 2,
    '(d) [M4] B is dispatched AGAIN — a fresh implementer, so two `worker:start impl:B` on the ' +
    'log. The log was: ' + shownLog(log))
  const adoptedA = adoptionsOf(log).find((e) => Array.isArray(e.tasks) && e.tasks.includes('A'))
  assert.ok(adoptedA,
    '(d) [M4] sim precondition: A was adopted — a `driver:wave-adopted` naming it. The log ' +
    'was: ' + shownLog(log))
  assert.ok(log.indexOf(startsB[1]) > log.indexOf(adoptedA),
    '(d) [M4] and only AFTER every sibling the link named is adopted: B\'s second ' +
    '`worker:start` is after the `driver:wave-adopted` naming A (indexes ' +
    log.indexOf(startsB[1]) + ' and ' + log.indexOf(adoptedA) + '). The log was: ' +
    shownLog(log))
  assert.equal(startsB[1].head, adoptedA.headSha,
    '(d) [M4] with its clone re-anchored at that adopted head — B\'s second worker opened on ' +
    JSON.stringify(startsB[1].head) + ', the epoch adopted ' + JSON.stringify(adoptedA.headSha) +
    '. A re-dispatch into a tree still at the old base is the mis-anchored patch the driver ' +
    'exists to prevent.')
  assert.ok(log.indexOf(startsB[1]) > log.indexOf(edges[0]),
    '(d) [M4] and after the re-edge that owed it: ' + shownLog(log))

  // ── the run's approval ───────────────────────────────────────────────────
  assert.equal(rowOf('A') && rowOf('A').status, 'done',
    '(d) [M4] A ended `done`: ' + JSON.stringify(rowOf('A')))
  assert.equal(rowOf('B') && rowOf('B').status, 'done',
    '(d) [M4] and so did B — the task whose proof needed a sibling WAITED and then ran, ' +
    'instead of failing the run: ' + JSON.stringify(rowOf('B')))
  assert.deepEqual(d1.report.unfinished, [],
    '(d) [M4] nothing is unfinished: ' + JSON.stringify(d1.report.unfinished))
  assert.equal(d1.report.coverage.complete, true,
    '(d) [M4] and the run is complete — both planned tasks adopted: ' +
    JSON.stringify(d1.report.coverage))
  const adoptedIds = new Set(adoptionsOf(log).flatMap((e) => e.tasks || []))
  assert.deepEqual([...adoptedIds].sort(), ['A', 'B'],
    '(d) [M4] both tasks reached an epoch: ' + shownLog(log))
}

// ── (d.2) a BLOCKED with no such link is the failure it is at BASE ──────────
{
  const d2 = await driveHub({
    tag: 'm4-nolink',
    makeStub: ({ runDir, fake }) => async (prompt, opts, cwd) => {
      const label = String(opts.label)
      const kind = label.split(':')[0]
      const id = label.split(':')[1]
      if (kind !== 'impl' && kind !== 'fix') return cannedJudgment(runDir, label)
      // B is blocked and says so — and files NOTHING on its issue.
      if (id === 'B') return blockedOnA(runDir, label, cwd, fake, { withLink: false })
      return plainImpl(runDir, label, cwd, id)
    },
  })
  const rowOf = (id) => d2.report.tasks.find((r) => r && r.task === id)
  assert.deepEqual(d2.fake.links, [],
    '(d) [M4] sim precondition: no link was filed on any issue in this run: ' +
    JSON.stringify(d2.fake.links))
  assert.deepEqual(reEdgesOf(d2.log), [],
    '(d) [M4] a `BLOCKED` whose issue carries no `blocks` link from an unadopted sibling is ' +
    'NOT re-edged — no `driver:re-edged` event anywhere. The log was: ' + shownLog(d2.log))
  assert.equal(startsOf(d2.log, 'impl:B').length, 1,
    '(d) [M4] and the task is not dispatched again: one `worker:start impl:B`. The log was: ' +
    shownLog(d2.log))
  assert.equal(rowOf('B') && rowOf('B').status, 'failed',
    '(d) [M4] it is the failure it is at BASE — B\'s row is `failed`: ' +
    JSON.stringify(rowOf('B')))
  assert.equal(rowOf('B') && rowOf('B').reviewVerdict, 'not-reviewed',
    '(d) [M4] with the BASE verdict `not-reviewed`: ' + JSON.stringify(rowOf('B')))
  assert.ok(d2.fake.labelsOf(UID.B).includes('needs-review'),
    '(d) [M4] and its issue IS marked for a person, exactly as at BASE — `needs-review`: ' +
    JSON.stringify(d2.fake.labelsOf(UID.B)))
  assert.equal(d2.fake.metaOf(UID.B)['work.attention'], 'needs-human',
    '(d) [M4] with `work.attention: needs-human`: ' + JSON.stringify(d2.fake.metaOf(UID.B)))
  assert.equal(rowOf('A') && rowOf('A').status, 'done',
    '(d) [M4] sim precondition: A still ran and landed: ' + JSON.stringify(rowOf('A')))
}

// ── (d.3) the link names a sibling that has already failed ──────────────────
//
// A returns BLOCKED with nothing on its issue, so A is the failure of (d.2);
// B then files the A -> B link and returns BLOCKED. Whichever order the two
// landings interleave — the edge recorded before A's failure is known, or
// after — the record M4 asks for is the same one, and that is what is asserted
// here: B is never dispatched again and the run says why.
{
  const d3 = await driveHub({
    tag: 'm4-failed-sibling',
    makeStub: ({ runDir, fake }) => async (prompt, opts, cwd) => {
      const label = String(opts.label)
      const kind = label.split(':')[0]
      const id = label.split(':')[1]
      if (kind !== 'impl' && kind !== 'fix') return cannedJudgment(runDir, label)
      if (id === 'A') {
        const reply = blockedOnA(runDir, label, cwd, fake, { withLink: false })
        // A marker file, not an event kind: B waits for it so its own BLOCKED
        // follows A's.
        fs.writeFileSync(path.join(runDir, 'A-gave-up'), 'A is a failure\n')
        return reply
      }
      await waitUntil(() => fs.existsSync(path.join(runDir, 'A-gave-up')))
      return blockedOnA(runDir, label, cwd, fake)
    },
  })
  const rowOf = (id) => d3.report.tasks.find((r) => r && r.task === id)
  assert.equal(rowOf('A') && rowOf('A').status, 'failed',
    '(d) [M4] sim precondition: A failed: ' + JSON.stringify(rowOf('A')))
  assert.ok(d3.fake.links.some((l) => l.type === 'blocks' && l.from.uid === UID.A &&
                                      l.to.uid === UID.B),
    '(d) [M4] sim precondition: B filed the `blocks` link from A: ' +
    JSON.stringify(d3.fake.links))
  assert.deepEqual(
    d3.report.unfinished.filter((u) => String(u).startsWith('B')),
    ['B: blocked — depends on a failed task'],
    '(d) [M4] a link whose `from` names a sibling already failed makes the task ' +
    '`unfinished: blocked — depends on a failed task` — the cascade, word for word, not a ' +
    'wait for a landing that will never come. `unfinished` was: ' +
    JSON.stringify(d3.report.unfinished))
  assert.equal(rowOf('B'), undefined,
    '(d) [M4] and B holds no result row of its own — a re-edged task is UNSTARTED, so the ' +
    'run\'s record of it is that `unfinished` line. The rows were: ' +
    JSON.stringify(d3.report.tasks.map((r) => r && r.task + ':' + r.status)))
  assert.equal(startsOf(d3.log, 'impl:B').length, 1,
    '(d) [M4] B is never dispatched again: exactly one `worker:start impl:B` in the whole run. ' +
    'The log was: ' + shownLog(d3.log))
  assert.deepEqual(startsOf(d3.log, 'fix:B:').map((e) => e.label), [],
    '(d) [M4] and no fix round either: ' + shownLog(d3.log))
}

// ── (d.4) a second BLOCKED naming the same link is the failure ──────────────
//
// The re-edge is capped at one per task per sibling: B is re-edged once, waits
// for A, is dispatched again, and blocks again on the SAME link. That second
// BLOCKED is the failure of (d.2) — a second re-edge would be a task that can
// never end.
{
  const d4 = await driveHub({
    tag: 'm4-twice',
    makeStub: ({ runDir, fake }) => async (prompt, opts, cwd) => {
      const label = String(opts.label)
      const kind = label.split(':')[0]
      const id = label.split(':')[1]
      if (kind !== 'impl' && kind !== 'fix') return cannedJudgment(runDir, label)
      if (id === 'B') return blockedOnA(runDir, label, cwd, fake)
      await waitUntil(() => reEdgesOf(readEvents(runDir)).length > 0)
      return plainImpl(runDir, label, cwd, id)
    },
  })
  const rowOf = (id) => d4.report.tasks.find((r) => r && r.task === id)
  assert.equal(reEdgesOf(d4.log).length, 1,
    '(d) [M4] exactly one `driver:re-edged` in the log — the edge A -> B is recorded once, and ' +
    'the second `BLOCKED` naming the same link buys no second wait. The log was: ' +
    shownLog(d4.log))
  assert.equal(startsOf(d4.log, 'impl:B').length, 2,
    '(d) [M4] B was dispatched twice: the re-edge bought it exactly one more implementer. The ' +
    'log was: ' + shownLog(d4.log))
  assert.equal(rowOf('B') && rowOf('B').status, 'failed',
    '(d) [M4] and the second `BLOCKED` is the failure it is at BASE — B\'s row is `failed`: ' +
    JSON.stringify(rowOf('B')))
  assert.equal(rowOf('B') && rowOf('B').reviewVerdict, 'not-reviewed',
    '(d) [M4] with the BASE verdict `not-reviewed`: ' + JSON.stringify(rowOf('B')))
  assert.equal(rowOf('A') && rowOf('A').status, 'done',
    '(d) [M4] A, the sibling it waited for, landed: ' + JSON.stringify(rowOf('A')))
  const adoptedA = adoptionsOf(d4.log).find((e) => Array.isArray(e.tasks) && e.tasks.includes('A'))
  assert.ok(adoptedA,
    '(d) [M4] and was adopted — which is what released B\'s second dispatch: ' +
    shownLog(d4.log))
}

// ══════════════════════════════════════════════════════════════════════════
// (d.5) the re-edge reads the tree the worker was HANDED
// ══════════════════════════════════════════════════════════════════════════
//
// The task: *a task whose worker reports it is blocked on a sibling that has
// landed SINCE the task was sent out is sent out again on the tree that carries
// that sibling, instead of failing.*
//
// (d.1) above is the case where the sibling is still in flight at the moment
// the driver reads the link. This is the other half: the sibling was adopted
// while the blocked worker was working, so by the time the driver reads the
// link the live adopted set already names it — and the question M1 answers is
// whether the sibling was in the head THIS DISPATCH WENT OUT ON, which it was
// not. (b) below is the case where it was, and that one is not a re-edge.
//
// THE RIG. (d.1)'s shape — A and B, no plan edge, width 2, the fake hub — plus
// `foldAgeMs: 0`, the fold rule before #1006: every landing folds at its own
// instant, siblings in flight or not, so A can be adopted while B is still
// being implemented. Both holds are the bounded `waitUntil`, so a BASE engine
// fails an assertion rather than hanging.

// ── (a) [M1] the sibling was adopted AFTER this task's dispatch went out ─────
{
  const attempts = { B: 0 }
  const d5a = await driveHub({
    tag: 'm1-adopted-since',
    extra: { foldAgeMs: 0 },
    makeStub: ({ runDir, fake }) => async (prompt, opts, cwd) => {
      const label = String(opts.label)
      const kind = label.split(':')[0]
      const id = label.split(':')[1]
      if (kind !== 'impl' && kind !== 'fix') return cannedJudgment(runDir, label)
      if (id === 'A') {
        // A holds until B's first implementer has opened, so B's dispatch — and
        // the head that dispatch went out on — is READ before A lands and is
        // adopted. Without this the scenario would be a race between the two
        // lanes, and the leg is about the ordering, not about who won it.
        await waitUntil(() => startsOf(readEvents(runDir), 'impl:B').length > 0)
        return plainImpl(runDir, label, cwd, id)
      }
      attempts.B += 1
      if (attempts.B === 1 && kind === 'impl') {
        workerStart(runDir, label, cwd)
        // …and B's first implementer holds until A has been ADOPTED: at the
        // instant it files the link and returns, A is in the live adopted set
        // and was not in the head B went out on.
        await waitUntil(() => adoptionsOf(readEvents(runDir))
          .some((e) => Array.isArray(e.tasks) && e.tasks.includes('A')))
        fake.fileBlockedBy(UID.B, UID.A)
        const reply = { status: 'BLOCKED', summary: 'the proof runs A.txt, which task A owns ' +
                                                    'and which was not in the tree I was handed' }
        workerEnd(runDir, label)
        return reply
      }
      return plainImpl(runDir, label, cwd, id)
    },
  })
  const log = d5a.log
  const rowOf = (id) => d5a.report.tasks.find((r) => r && r.task === id)
  const startsB = startsOf(log, 'impl:B')
  const adoptedA = adoptionsOf(log).find((e) => Array.isArray(e.tasks) && e.tasks.includes('A'))

  // ── the sim's own preconditions: the ordering the leg is about ────────────
  assert.ok(adoptedA,
    '(a) [M1] sim precondition: A was adopted — a `driver:wave-adopted` naming it. The log ' +
    'was: ' + shownLog(log))
  assert.ok(startsB.length >= 1 && log.indexOf(startsB[0]) < log.indexOf(adoptedA),
    '(a) [M1] sim precondition: B\'s FIRST implementer opened before that adoption — B\'s ' +
    'dispatch went out on a head that did not carry A, which is the whole case this leg is. ' +
    'The log was: ' + shownLog(log))
  assert.ok(d5a.fake.links.some((l) => l.type === 'blocks' && l.from.uid === UID.A &&
                                       l.to.uid === UID.B),
    '(a) [M1] sim precondition: B filed the `blocks` link from A — `kata edit $KATA_REF ' +
    '--blocked-by <A>`: ' + JSON.stringify(d5a.fake.links))

  // ── the event ─────────────────────────────────────────────────────────────
  const edges = reEdgesOf(log)
  assert.equal(edges.length, 1,
    '(a) [M1] the driver appended exactly ONE `driver:re-edged` — B returned BLOCKED and its ' +
    'issue carried a `blocks` link from A, a sibling of this run that was not adopted in the ' +
    'head B\'s dispatch went out on. That A has been adopted SINCE is not the question: an ' +
    'adopted sibling\'s work is in the tree a LATER dispatch is handed, not in the one B was ' +
    'handed. The log was: ' + shownLog(log))
  assert.equal(edges[0].task, 'B',
    '(a) [M1] naming the blocked task in `task`: ' + JSON.stringify(edges[0]))
  assert.deepEqual(edges[0].blockedBy, ['A'],
    '(a) [M1] and the sibling ids the link named in `blockedBy` — `[\'A\']`, the TASK id the ' +
    'link\'s `from.uid` resolves to, not a uid and not a short id: ' + JSON.stringify(edges[0]))

  // ── no fix round and no reviewer for that attempt ─────────────────────────
  assert.deepEqual(startsOf(log, 'fix:B:').map((e) => e.label), [],
    '(a) [M1] a re-edged BLOCKED buys NO fix round — the task is unstarted, not repaired. The ' +
    'log was: ' + shownLog(log))
  const reviewsBefore = startsOf(log, 'review:B:')
    .filter((e) => log.indexOf(e) < log.indexOf(edges[0]))
  assert.deepEqual(reviewsBefore.map((e) => e.label), [],
    '(a) [M1] and no reviewer read that attempt: nothing of B reached a referee before the ' +
    're-edge. The log was: ' + shownLog(log))

  // ── dispatched again, after that adoption, on that adoption's head ────────
  assert.equal(startsB.length, 2,
    '(a) [M1] B is dispatched AGAIN — a fresh implementer, so exactly two `worker:start ' +
    'impl:B` rows on the log. At BASE there is one, and B fails instead. The log was: ' +
    shownLog(log))
  assert.ok(log.indexOf(startsB[1]) > log.indexOf(adoptedA),
    '(a) [M1] the second one AFTER the `driver:wave-adopted` naming A (indexes ' +
    log.indexOf(startsB[1]) + ' and ' + log.indexOf(adoptedA) + '). The log was: ' +
    shownLog(log))
  assert.ok(log.indexOf(startsB[1]) > log.indexOf(edges[0]),
    '(a) [M1] and after the `driver:re-edged` that owed it (indexes ' +
    log.indexOf(startsB[1]) + ' and ' + log.indexOf(edges[0]) + '). The log was: ' +
    shownLog(log))
  assert.equal(startsB[1].head, adoptedA.headSha,
    '(a) [M1] with its clone anchored at the head of the epoch that adopted A — B\'s second ' +
    'worker opened on ' + JSON.stringify(startsB[1].head) + ', that epoch adopted ' +
    JSON.stringify(adoptedA.headSha) + '. The tree the re-dispatch is handed is the one that ' +
    'carries the sibling it was blocked on; anything else is the mis-anchored patch the driver ' +
    'exists to prevent.')

  // ── the run's approval ────────────────────────────────────────────────────
  assert.equal(rowOf('B') && rowOf('B').status, 'done',
    '(a) [M1] B\'s row is `done` — the task whose worker reported it was blocked on a sibling ' +
    'that had landed since was sent out again and RAN, instead of failing: ' +
    JSON.stringify(rowOf('B')))
  assert.equal(rowOf('A') && rowOf('A').status, 'done',
    '(a) [M1] A landed too: ' + JSON.stringify(rowOf('A')))
  assert.deepEqual(d5a.report.unfinished, [],
    '(a) [M1] nothing is unfinished: ' + JSON.stringify(d5a.report.unfinished))
  assert.equal(d5a.report.coverage.complete, true,
    '(a) [M1] and the run is complete — both planned tasks adopted: ' +
    JSON.stringify(d5a.report.coverage))
  const adoptedIds5 = new Set(adoptionsOf(log).flatMap((e) => e.tasks || []))
  assert.deepEqual([...adoptedIds5].sort(), ['A', 'B'],
    '(a) [M1] and the adoptions name both tasks: ' + shownLog(log))
}

// ── (b) [M2] the sibling WAS adopted in the head this dispatch went out on ───
//
// The counterpart, and the line M2 draws: the plan edge A -> B holds B until A
// is adopted, so B's dispatch goes out on a head that CARRIES A. B then files
// the same `blocks` link and returns BLOCKED — and that is not a re-edge,
// because the work the worker says it is waiting for was already in the tree it
// was handed. The BASE failure, unchanged.
{
  const d5b = await driveHub({
    tag: 'm2-adopted-before',
    edges: [['A', 'B']],
    extra: { foldAgeMs: 0 },
    makeStub: ({ runDir, fake }) => async (prompt, opts, cwd) => {
      const label = String(opts.label)
      const kind = label.split(':')[0]
      const id = label.split(':')[1]
      if (kind !== 'impl' && kind !== 'fix') return cannedJudgment(runDir, label)
      if (id === 'B') return blockedOnA(runDir, label, cwd, fake)
      return plainImpl(runDir, label, cwd, id)
    },
  })
  const log = d5b.log
  const rowOf = (id) => d5b.report.tasks.find((r) => r && r.task === id)
  const startsB = startsOf(log, 'impl:B')
  const adoptedA = adoptionsOf(log).find((e) => Array.isArray(e.tasks) && e.tasks.includes('A'))

  assert.equal(rowOf('A') && rowOf('A').status, 'done',
    '(b) [M2] sim precondition: A landed: ' + JSON.stringify(rowOf('A')))
  assert.ok(adoptedA,
    '(b) [M2] sim precondition: A was adopted — a `driver:wave-adopted` naming it. The log ' +
    'was: ' + shownLog(log))
  assert.equal(startsB.length, 1,
    '(b) [M2] B is NOT dispatched again: exactly one `worker:start impl:B` in the whole run — ' +
    'the BASE behaviour, unchanged. The log was: ' + shownLog(log))
  assert.ok(log.indexOf(startsB[0]) > log.indexOf(adoptedA),
    '(b) [M2] sim precondition: the plan edge A -> B held B until A was adopted, so B\'s one ' +
    'dispatch went out on a head that CARRIES A (indexes ' + log.indexOf(startsB[0]) + ' and ' +
    log.indexOf(adoptedA) + '). The log was: ' + shownLog(log))
  assert.equal(startsB[0].head, adoptedA.headSha,
    '(b) [M2] sim precondition: and its clone opened on that very head — ' +
    JSON.stringify(startsB[0].head) + ' is the head the epoch adopting A left (' +
    JSON.stringify(adoptedA.headSha) + '), so A\'s work is in the tree B was handed.')
  assert.ok(d5b.fake.links.some((l) => l.type === 'blocks' && l.from.uid === UID.A &&
                                       l.to.uid === UID.B),
    '(b) [M2] sim precondition: B filed the same `blocks` link from A: ' +
    JSON.stringify(d5b.fake.links))
  assert.deepEqual(reEdgesOf(log), [],
    '(b) [M2] a `blocks` link whose `from` is a sibling that WAS adopted in the head this ' +
    'dispatch went out on is not a re-edge — no `driver:re-edged` event anywhere. Nothing is ' +
    'waiting to arrive: it already arrived before the worker opened. The log was: ' +
    shownLog(log))
  assert.equal(rowOf('B') && rowOf('B').status, 'failed',
    '(b) [M2] the task ends `failed`, as at BASE: ' + JSON.stringify(rowOf('B')))
  assert.equal(rowOf('B') && rowOf('B').reviewVerdict, 'not-reviewed',
    '(b) [M2] with the BASE verdict `not-reviewed`: ' + JSON.stringify(rowOf('B')))
}

// ══════════════════════════════════════════════════════════════════════════
// (d) [M3] the contract bullet, read the way the Proof's `Run:` lines read it
// ══════════════════════════════════════════════════════════════════════════
//
// The Proof's second `Run:` is
//   ! grep -q 'not yet adopted' fleet/CONTRACT.md
// and its third is
//   sed -n '/The re-edge (#979)/,/dispatched again/p' fleet/CONTRACT.md \
//     | tr '\n' ' ' | grep -q 'not adopted in the head'
// — the `The re-edge (#979)` line through the first `dispatched again` line,
// flattened with `tr`, which is a newline replaced by ONE space. These are
// those two reads, done the same way.
{
  const contract = fs.readFileSync(path.join(HERE, '..', 'CONTRACT.md'), 'utf8')
  const lines = contract.split('\n')
  const hits = lines
    .map((l, i) => (l.includes('not yet adopted') ? (i + 1) + ': ' + l.trim() : null))
    .filter(Boolean)
  assert.deepEqual(hits, [],
    '(d) [M3] `not yet adopted` occurs NOWHERE in fleet/CONTRACT.md — the phrase the re-edge ' +
    'bullet carried at BASE is the wrong reading of the rule, and no other line may reintroduce ' +
    'it. These lines still carry it:\n' + hits.join('\n'))

  const start = lines.findIndex((l) => l.includes('The re-edge (#979)'))
  assert.ok(start !== -1,
    '(d) [M3] sim precondition: fleet/CONTRACT.md carries a `The re-edge (#979)` bullet the ' +
    'Proof\'s sed range starts at')
  let end = -1
  for (let i = start; i < lines.length; i += 1) {
    if (lines[i].includes('dispatched again')) { end = i; break }
  }
  assert.ok(end !== -1,
    '(d) [M3] sim precondition: the Proof\'s sed range ends at a `dispatched again` line after it')
  const bullet = lines.slice(start, end + 1).join(' ')
  assert.ok(bullet.includes('not adopted in the head'),
    '(d) [M3] the re-edge bullet says the link\'s `from` is another task of this run NOT ' +
    'ADOPTED IN THE HEAD the task\'s dispatch went out on — the rule the engine now keeps, ' +
    'written where the contract states it. The range from `The re-edge (#979)` to `dispatched ' +
    'again` reads:\n' + bullet)
}

// ══════════════════════════════════════════════════════════════════════════
// (e) [M1] [M2] the guarded sim is self-contained at its guarded path
// ══════════════════════════════════════════════════════════════════════════
//
// The Proof's fourth `Run:` is
//   ! grep -qE "^import .*exams/" fleet/tests/test_run_engine_re_edge.mjs
// — the guarded file imports the engine and the sim helpers by their
// `fleet/tests/`-relative paths and nothing under `fleet/tests/exams/`, so the
// exam that reaches main is the file at the guarded path and it runs there.
// This is that read, over this file itself.
{
  const self = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8')
  const offenders = self.split('\n').filter((l) => /^import .*exams\//.test(l))
  assert.deepEqual(offenders, [],
    '(e) [M1] [M2] this file — the sim at its guarded path — carries no `import` line naming a ' +
    'path under `exams/`: it reaches for the engine and the helpers beside it and for nothing a ' +
    'publish strips. These lines do:\n' + offenders.join('\n'))
}

console.log('ALL TESTS PASSED')
