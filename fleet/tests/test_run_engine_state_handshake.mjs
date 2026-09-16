/**
 * fleet/tests/test_run_engine_state_handshake.mjs — the state handshake's exam
 * (run-155, task 2), inlined at its guarded path on 2026-09-16: publish strips
 * `fleet/tests/exams/<run>/` from the pull request, so the pointer this file
 * used to be imported a module main does not carry, and the plugin's own suite
 * was red on main (fleet run-158 parked at open on it). Relative imports are
 * rewritten for this depth; the assertions are the examiner's, unchanged.
 */
/**
 * fleet/tests/exams/run_155/test_run_engine_state_handshake.mjs — the exam for
 * Task 2: *the driver's two reads — seed the consumer from the post, refuse a
 * post the expected file contradicts*.
 *
 * This file is the Proof's `Test: fleet/tests/test_run_engine_state_handshake.mjs`,
 * written where the run's `EXAM PATHS:` line sends it —
 * `fleet/tests/exams/run_155/` — and nothing is left at the path the Proof
 * named. Every relative path below is written for THIS directory:
 * `../../../` is the repository's `fleet/`, `../../` is `fleet/tests/`, and
 * `../../../../` is the checkout root.
 *
 * ── what each Machine clause asserts, restated ──────────────────────────────
 *   M1 — before a consumer task's exam command first runs, for each task the
 *        consumer consumes from (the run's dependency edges) the driver's
 *        `getIssue` of that producer's recorded uid yields
 *        `metadata['state.reached']`; a well-formed value (M5) is written, as
 *        JSON, to `state-exams/posted/<producer task id>.json` in the
 *        consumer's task clone AND in its examiner's clone; a producer whose
 *        issue carries no `state.reached` writes no file and appends one
 *        `handshake:absent {task, producer}` event.
 *   M2 — at a producer's pre-review pass, when its issue carries
 *        `state.reached`, the driver reads the file `expected` names from the
 *        tree the captured patch describes and compares its parsed JSON with
 *        `content`: equal appends one `handshake:settled {task, expected}` and
 *        adds no finding; unequal raises one `blocking` finding on the
 *        producer, `actor` `implementer`, prefixed `handshake:`, whose detail
 *        carries the first differing cell as
 *        `<table>/<row>/<cell> got <posted> wanted <file>`, routed to the
 *        task's `fix:<id>:0` round exactly as any blocking finding is; an
 *        `expected` path absent from the captured tree raises the same finding
 *        naming the path.
 *   M3 — every post the driver reads under M1 or M2 is appended once to
 *        `events.jsonl` as `fact:state.reached {task, expected, sha256}`,
 *        `sha256` over the canonical JSON of `content`; a run with no
 *        `state.reached` on any issue appends no `fact:state.reached` and no
 *        `handshake:settled`, writes nothing under `state-exams/posted/`, and
 *        every worker prompt is byte-identical to the prompt the same run
 *        produces at BASE.
 *   M4 — a run started without `--kata` makes no `getIssue` for the handshake,
 *        appends no `handshake:*` event of any kind, and satisfies M3's
 *        no-post half.
 *   M5 — a `state.reached` value is well-formed exactly when it is an object
 *        whose `expected` is a string beginning `state-exams/expected/` and
 *        whose `content` is an array of exactly two elements; a malformed
 *        value writes no seed file under M1 and, at the producer's pre-review
 *        pass, raises the same `blocking` `handshake:` finding with `actor`
 *        `implementer` whose detail names the malformed field (`content` or
 *        `expected`) — never M2's cell comparison, and never a
 *        `fact:state.reached` event.
 *
 * ── the legs, and where each is answered ────────────────────────────────────
 * Every assertion below names its leg and the clause it comes from, so a
 * reader can map this file back to the contract.
 *   (0) [M5, `Produces:`] `handshakeOf(issue)` on the well-formed value and on
 *       each malformed one the clause names.
 *   (a) [M1] run A: the two-task plan, the producer's issue carrying
 *       `state.reached`, the seed read by an exam command in both clones.
 *   (b) [M1] run B: no `state.reached` anywhere — no seed file, one
 *       `handshake:absent` naming the pair.
 *   (c) [M2] run A again: no `handshake:` finding on the producer, exactly one
 *       `handshake:settled`.
 *   (d) [M2] run D: one cell of the expected file differs.
 *   (e) [M2] run E: `expected` names a path the captured tree has not got.
 *   (f) [M5] run F: `content` is a three-element array.
 *   (f2) [M5] run F2: `expected` does not begin `state-exams/expected/`.
 *   (g) [M3] runs A, D and E: one `fact:state.reached` per post read, its
 *       `sha256` computed independently here.
 *   (h) [M3] run B's prompts against the same run under the BASE engine.
 *   (i) [M4] run I: the same plan with no kata record at all.
 *
 * ── the rig ─────────────────────────────────────────────────────────────────
 * One sim shape for every leg: a two-task plan — producer `1`, consumer `2` —
 * with the one dependency edge `1 -> 2`, which is the edge the compiler emits
 * from the consumer's `Consumes:` of the producer's symbol. Below the agent
 * seam the rig is REAL, as in the sibling engine sims: real git repositories,
 * real `cloneAtBase` clones, the real capture, the real fold kernel through
 * the real `execSeam`. Only `agent` is stubbed, and the hub is a fake with the
 * client's method names over an in-memory store — the shape
 * `fleet/tests/test_worker_kata_env.mjs` builds and
 * `test_run_engine_kata_landing.mjs` drives, copied here because neither file
 * is in this task's Files.
 *
 * The consumer's Proof path is a shell exam the examiner stub writes into its
 * own clone; its command records what it can read of
 * `state-exams/posted/1.json` into a witness directory under `$ULTRA_RUN_DIR`,
 * at both passes the driver runs it — `base`, in `clones/exam-2`, and `0`, in
 * `clones/task-2`. That witness is leg (a)'s "measured by an exam command that
 * reads the file": it makes "before the consumer's exam command first runs" a
 * fact about the moment the command ran rather than about the tree afterwards.
 * The exam script always exits 0, so a missing seed is recorded rather than
 * turned into a red that would change the shape of the run around it.
 *
 * ── four readings this file is written on ───────────────────────────────────
 *   • The post is the producer's IMPLEMENTER's, made during its session (the
 *     run's global constraint says so, with `--json-value`, on that task's own
 *     issue). The stub writes it into the fake's store as the `impl:1` session
 *     returns — so the driver's Setup-time `getIssue` (`openKataTask`, one per
 *     task before wave 1) cannot be the read M1 and M2 name, and the handshake
 *     needs a read of its own. That write bumps no revision, exactly as the
 *     attention-hook's SessionEnd write does not in the landing sim.
 *   • M3's "every post the driver reads under M1 or M2 is appended once" is
 *     read as once per POST, not once per read: in run A the same post is read
 *     twice — once to seed the consumer, once to compare at the producer's
 *     pre-review pass — and this file asserts EXACTLY ONE `fact:state.reached`.
 *   • M2's detail names "the first differing cell". Run D's fixtures differ in
 *     exactly ONE cell, so the cell named is the same under any traversal
 *     order: this file pins the detail string, not an iteration order the
 *     clause never fixes. That cell holds a boolean, so `true`/`false` renders
 *     identically under `String` and under `JSON.stringify` and the detail has
 *     one spelling.
 *   • `blocking` and `actor: implementer` are asserted through the routing the
 *     same clause defines — "routes to the task's `fix:<id>:0` round exactly as
 *     any blocking finding does". The engine keeps no per-task findings array a
 *     sim can read, so the finding is read where the driver's own blocking
 *     findings are read at BASE: the pre-review pass's red list, which is the
 *     `fix:<id>:0` prompt's `Blocking issues to resolve:` block, the
 *     `review round 0:` comment the driver posts on that task's issue, and the
 *     failed row's `notes`. An `actor: plan` finding is the one that would go
 *     elsewhere — to `deferredVerification` as a `plan-defect`, with no fix
 *     round — so its absence there is what "actor `implementer`" asserts.
 *
 * Leg (h)'s "byte-identical to the prompt the same run produces at BASE" is
 * measured by importing the BASE engine out of a `git archive` of the checkout
 * at BASE and running the same plan through it, in the same run-directory PATH
 * (run B's tree is removed and re-provisioned from the same repository), so the
 * patch paths the reviewer's prompt carries are identical by construction. Git
 * author and committer dates are pinned for the process, so the fold commit
 * each wave adopts — and therefore the BASE sha wave 2 is dispatched against —
 * is the same sha in both runs. Both engines are handed the same `rolesDir`, a
 * temporary one written here, so no role file of the checkout (one of which a
 * sibling task of this run is editing) can move the comparison.
 *
 * ── why this is red at BASE, for one reason ─────────────────────────────────
 * `fleet/run-engine.mjs` exports no `handshakeOf` at BASE, so the named import
 * below fails to link and the file is red before a single assertion runs: the
 * implementation does not exist yet. With it present and the rest of the task
 * unbuilt, the same file is red on leg (a)'s seed.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// The task's `Produces:` — the one symbol later tasks rely on, and the reason
// this file cannot link at BASE.
import { handshakeOf } from '../run-engine.mjs'
import { runEngine as headEngine } from '../run-engine.mjs'
import { execSeam } from '../run-main.mjs'
import { makeCwdFor, withPatchCapture, defaultTaskIdOf } from '../run-waves.mjs'
import { makeRepo, provision, passReview, cleanCritic, doneImpl } from './_engine_helpers.mjs'
import { simEnv } from './_helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')

// Pinned for the process, before any repository is built: the fold kernel's
// commits are then a pure function of their content and parents, which is what
// makes leg (h)'s two runs land on the same wave-2 BASE sha. Nothing else in
// this file depends on the clock.
process.env.GIT_AUTHOR_DATE = '2026-01-01T00:00:00 +0000'
process.env.GIT_COMMITTER_DATE = '2026-01-01T00:00:00 +0000'

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'engine-state-handshake-')))
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }))

// ── the literals the clauses spell, spelled once ────────────────────────────
const PRODUCER = '1'
const CONSUMER = '2'
const UID = { 1: 'U-1', 2: 'U-2' }
const RUN_UID = 'RUN0'
const PROJECT_ID = 7
const STAMP = 'run-155'
// M1: where the seed lands in each of the consumer's clones, named for the
// PRODUCING task as the plan numbers it.
const SEED_REL = 'state-exams/posted/' + PRODUCER + '.json'
// M5: the prefix a well-formed `expected` begins with.
const EXPECTED_DIR = 'state-exams/expected/'
const EXPECTED_PATH = EXPECTED_DIR + 'prod.json'
// The `getContent()` pair a post carries: `[tables, values]`. The keys are
// deliberately NOT in sorted order here, so M3's canonical JSON (keys sorted at
// every level) is a different string from `JSON.stringify(content)` and leg
// (g)'s digest can tell them apart.
const CONTENT = [
  { todos: { 0: { text: 'buy milk', completed: true }, 1: { text: 'buy bread', completed: false } } },
  { nextId: 2 },
]
// Run D's expected file: run A's content with exactly ONE cell moved —
// `todos/0/completed`, a boolean, so the detail has one spelling.
const CONTENT_ONE_CELL_OFF = [
  { todos: { 0: { text: 'buy milk', completed: false }, 1: { text: 'buy bread', completed: false } } },
  { nextId: 2 },
]
const DIFF_CELL = 'todos/0/completed got true wanted false'
const FINDING_PREFIX = 'handshake:'
// The events this task mints.
const ABSENT_KIND = 'handshake:absent'
const SETTLED_KIND = 'handshake:settled'
const FACT_KIND = 'fact:state.reached'
// The consumer's Proof path — under neither test root, so it lands at itself
// and the driver's `EXAM PATHS` remap leaves this run's own sim alone.
const EXAM_PATH = 'exam_check.sh'
const EXAM_CMD = 'bash ' + EXAM_PATH

// ── canonical JSON and the digest, computed independently of the engine ─────
// "JSON.stringify with keys sorted at every level" — arrays keep their order.
const canonical = (v) => {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']'
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort()
      .map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}'
  }
  return JSON.stringify(v)
}
const sha256Of = (value) => createHash('sha256').update(canonical(value)).digest('hex')

// ── reading a run back ──────────────────────────────────────────────────────
const eventsOf = (runDir) => {
  const file = path.join(runDir, 'events.jsonl')
  if (!fs.existsSync(file)) return []
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
}
const kindsOf = (events, kind) => events.filter((e) => e && e.kind === kind)
// `appendEvent` stamps every line with an `id` and a `ts` of its own; the
// clause's fields are what a deep-equal is taken over.
const fieldsOf = (e, keys) => {
  const out = {}
  for (const k of keys) out[k] = (e || {})[k]
  return out
}
const walk = (dir, pre = '') => {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((ent) => {
    if (ent.name === '.git') return []
    return ent.isDirectory()
      ? walk(path.join(dir, ent.name), pre + ent.name + '/')
      : [pre + ent.name]
  })
}
// Every file under any `state-exams/posted/` directory anywhere in the run's
// clones — the whole tree, so "no seed file was written" is answered about the
// run and not only about the one directory a leg happens to name.
const postedPathsIn = (clonesDir) => {
  if (!fs.existsSync(clonesDir)) return []
  return fs.readdirSync(clonesDir)
    .flatMap((clone) => walk(path.join(clonesDir, clone))
      .filter((rel) => rel.startsWith('state-exams/posted/'))
      .map((rel) => clone + '/' + rel))
    .sort()
}

// ── the fake hub ────────────────────────────────────────────────────────────
// The client's method names over an in-memory store, every call recorded in
// order. `post` is the producing implementer's own `kata meta set
// state.reached --json-value` — from OUTSIDE the engine, so it is not in the
// call log and it does not move the revision the fake answers.
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
      return record('comment', uid, { projectId: project, body }, { uid, revision: iss.revision })
    },
    async addLabel (project, uid, label) {
      const iss = need(uid)
      iss.labels.push(label); iss.revision += 1
      return record('addLabel', uid, { projectId: project, label }, { uid, revision: iss.revision })
    },
    async close (project, uid, opts) {
      const iss = need(uid)
      iss.status = 'closed'; iss.revision += 1
      return record('close', uid, { projectId: project, opts }, { uid, revision: iss.revision })
    },
  }
  return {
    kata,
    calls,
    of: (m) => calls.filter((c) => c.method === m),
    commentsOn: (uid) => calls.filter((c) => c.method === 'comment' && c.uid === uid)
      .map((c) => String(c.body || '')),
    // The producing implementer's post, mid-session.
    post: (uid, value) => { need(uid).metadata = { ...need(uid).metadata, 'state.reached': value } },
  }
}

// ── the roles, written here ─────────────────────────────────────────────────
// Both engines of leg (h) read THESE six files, so no role file of the checkout
// can move a prompt this exam compares.
const ROLES_DIR = path.join(tmp, 'roles')
fs.mkdirSync(ROLES_DIR, { recursive: true })
for (const name of ['implementer', 'reviewer', 'fix', 'resolver', 'reconcile', 'examiner']) {
  fs.writeFileSync(path.join(ROLES_DIR, name + '.md'), 'ROLE ' + name + '\n')
}

// ── the consumer's exam, as the examiner stub writes it ─────────────────────
// It reads the seed and records what it found, in the clone it is running in,
// at the pass it is running as. Always exit 0: this exam's subject is what the
// driver put there, not whether the command is happy about it.
const EXAM_SH = [
  '#!/usr/bin/env bash',
  '[ -n "$ULTRA_RUN_DIR" ] || exit 0',
  'd="$ULTRA_RUN_DIR/witness/$ULTRA_TASK-$ULTRA_EXAM_PASS"',
  'mkdir -p "$d"',
  'pwd > "$d/cwd"',
  'if [ -f ' + SEED_REL + ' ]; then cp ' + SEED_REL + ' "$d/seed.json"; else : > "$d/absent"; fi',
  'exit 0',
  '',
].join('\n')

const mkTask = (id, files, over = {}) => ({
  id, title: 'task ' + id, files, tier: 'standard', review: 'lean',
  writes: files, commutes: [], proofTests: [], proofRuns: [],
  body: 'task ' + id + ' body', ...over,
})

// The plan every leg runs: the producer, whose Files carry the expected file
// its post names, and the consumer, whose Proof is the exam above.
const wavesFor = (expectedPath) => [[
  mkTask(PRODUCER, ['t1.txt', expectedPath]),
  mkTask(CONSUMER, ['t2.txt'], { proofTests: [EXAM_PATH], testCmd: EXAM_CMD }),
]]

const ABSENT = Symbol('the producer writes no expected file')

/**
 * One run of the plan.
 *   `post`          the value the producing implementer writes to
 *                   `state.reached` mid-session, or `null` for a producer that
 *                   posts nothing.
 *   `expectedPath`  the path the producer's Files declare and (unless
 *                   `expectedFile` is ABSENT) writes.
 *   `expectedFile`  the JSON value written there, or ABSENT.
 *   `kataOn`        false runs with the client and NO record — `--kata` absent.
 *   `engine`        the engine under test; leg (h) passes the BASE one.
 */
async function driveRun ({ label, repo, runDir, post = null, expectedPath = EXPECTED_PATH,
                           expectedFile = ABSENT, kataOn = true, engine = headEngine,
                           promptDir = null }) {
  fs.rmSync(runDir, { recursive: true, force: true })
  if (promptDir) fs.mkdirSync(promptDir, { recursive: true })
  const waves = wavesFor(expectedPath)
  const taskIds = waves.flat().map((t) => t.id)
  const { base, clonesDir, patchesDir } = provision({ repo, runDir, taskIds })
  const patchBase = { current: base }
  const cwdFor = makeCwdFor({ clonesDir })
  const fake = makeFakeKata({
    projectId: PROJECT_ID,
    issues: {
      [RUN_UID]: { revision: 1, short_id: 'run0', metadata: {} },
      [UID[PRODUCER]]: { revision: 1, short_id: 'aa11', metadata: {} },
      [UID[CONSUMER]]: { revision: 1, short_id: 'bb22', metadata: {} },
    },
  })
  const record = {
    url: 'https://kata.invalid',
    project: { id: PROJECT_ID, uid: 'PROJ0', name: 'ultrapowers' },
    run: { uid: RUN_UID, revision: 1 },
    tasks: { [PRODUCER]: { uid: UID[PRODUCER], short_id: 'aa11', revision: 1 },
             [CONSUMER]: { uid: UID[CONSUMER], short_id: 'bb22', revision: 1 } },
  }
  const dispatched = []
  let seq = 0
  const inner = async (prompt, opts) => {
    const cwd = cwdFor(opts)
    const name = String(opts.label)
    dispatched.push({ label: name, prompt: String(prompt) })
    if (promptDir) {
      fs.writeFileSync(path.join(promptDir,
        String(seq++).padStart(3, '0') + '-' + name.replace(/[^\w]/g, '_') + '.txt'), String(prompt))
    }
    const [kind, id] = name.split(':')
    if (kind === 'impl' || kind === 'fix') {
      fs.writeFileSync(path.join(cwd, 't' + id + '.txt'), 'from ' + name + '\n')
      if (id === PRODUCER) {
        if (expectedFile !== ABSENT) {
          fs.mkdirSync(path.dirname(path.join(cwd, expectedPath)), { recursive: true })
          fs.writeFileSync(path.join(cwd, expectedPath), JSON.stringify(expectedFile))
        }
        // The producing implementer's own post, on its own issue, mid-session.
        if (post !== null) fake.post(UID[PRODUCER], post)
      }
      return doneImpl(cwd)
    }
    if (kind === 'exam') {
      fs.writeFileSync(path.join(cwd, EXAM_PATH), EXAM_SH)
      return { status: 'DONE', summary: 'exam written', unsatisfiable: [] }
    }
    if (kind === 'review') return passReview()
    if (name === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + name)
  }
  const agent = withPatchCapture({
    agent: inner, clonesDir, base: () => patchBase.current, patchesDir,
    taskIdOf: defaultTaskIdOf,
  })
  const logs = []
  const report = await engine({
    args: {
      waves,
      edges: [[PRODUCER, CONSUMER]],
      dependencyEdges: [PRODUCER + ' -> ' + CONSUMER],
      testCmd: 'bash check.sh',
      acceptance: { mode: 'suite', reason: 'sim' },
      stamp: STAMP,
      integrationBranch: 'ultra/integration-' + STAMP,
      patchInput: patchesDir,
      // The worker's raised hand is not this exam's subject: a poll far longer
      // than the sim keeps the hub's call log to the calls the handshake and
      // the run's own record make.
      attentionPollMs: 3600000,
      ...(kataOn ? { kataRecord: record } : {}),
    },
    agent,
    parallel: (thunks) => Promise.all(thunks.map((t) => t())),
    exec: execSeam,
    paths: { repoDir: repo, runDir, clonesDir },
    rolesDir: ROLES_DIR,
    log: (l) => logs.push(String(l)),
    phase: () => {},
    patchBase,
    kata: fake.kata,
  })
  const witnessDir = path.join(runDir, 'witness')
  const witness = {}
  for (const rel of walk(witnessDir)) {
    witness[rel] = fs.readFileSync(path.join(witnessDir, rel), 'utf8')
  }
  return {
    label, report, fake, clonesDir, runDir, dispatched, logs, witness,
    events: eventsOf(runDir),
    rowOf: (id) => report.tasks.find((r) => r && r.task === id),
    labels: dispatched.map((d) => d.label),
    promptOf: (name) => dispatched.filter((d) => d.label === name).map((d) => d.prompt),
  }
}

// The lines a red list renders as, wherever the driver renders it: the
// `fix:<id>:0` prompt's blocking block, and the `review round 0:` comment.
const handshakeLinesIn = (text) => String(text).split('\n')
  .map((l) => l.trim())
  .filter((l) => l.startsWith('- ' + FINDING_PREFIX))
  .map((l) => l.slice(2).trim())
// The substantive half of a finding: everything after the `handshake:` prefix.
const detailBody = (line) => String(line).slice(FINDING_PREFIX.length).trim()

// ════════════════════════════════════════════════════════════════════════════
// (0) [M5] + `Produces:` — handshakeOf, the predicate every other leg rests on
// ════════════════════════════════════════════════════════════════════════════
{
  const well = { expected: EXPECTED_PATH, content: CONTENT }
  assert.deepEqual(handshakeOf({ metadata: { 'state.reached': well } }),
    { expected: EXPECTED_PATH, content: CONTENT },
    '(0) [M5] `handshakeOf(issue)` answers the issue\'s own `state.reached` — ' +
    '`{expected, content}` — when it is well-formed: an object whose `expected` ' +
    'is a string beginning `' + EXPECTED_DIR + '` and whose `content` is an ' +
    'array of exactly two elements')

  // The key is the flat `state.reached` and nothing else carries it.
  assert.equal(handshakeOf({ metadata: {} }), null,
    '(0) [M5] an issue whose metadata carries no `state.reached` has no post: null')
  assert.equal(handshakeOf({}), null,
    '(0) [M5] an issue with no metadata at all has no post: null')
  assert.equal(handshakeOf({ metadata: { 'state.reached': null } }), null,
    '(0) [M5] a null value is not an object: null')
  assert.equal(handshakeOf({ metadata: { 'state.reached': [EXPECTED_PATH, CONTENT] } }), null,
    '(0) [M5] an ARRAY is not the object the clause names: null')
  assert.equal(handshakeOf({ metadata: { 'state.reached': 'state-exams/expected/prod.json' } }), null,
    '(0) [M5] a bare string is not that object either: null')

  // M5's two malformed halves, one at a time.
  assert.equal(handshakeOf({ metadata: { 'state.reached': { expected: EXPECTED_PATH, content: [CONTENT[0]] } } }), null,
    '(0) [M5] `content` of one element is not an array of exactly two: null')
  assert.equal(handshakeOf({ metadata: { 'state.reached': { expected: EXPECTED_PATH, content: [...CONTENT, {}] } } }), null,
    '(0) [M5] `content` of three elements is not an array of exactly two: null')
  assert.equal(handshakeOf({ metadata: { 'state.reached': { expected: EXPECTED_PATH, content: { tables: {}, values: {} } } } }), null,
    '(0) [M5] `content` that is an object and not an array: null')
  assert.equal(handshakeOf({ metadata: { 'state.reached': { expected: EXPECTED_PATH } } }), null,
    '(0) [M5] no `content` at all: null')
  assert.equal(handshakeOf({ metadata: { 'state.reached': { expected: 'expected/prod.json', content: CONTENT } } }), null,
    '(0) [M5] an `expected` that does not begin `' + EXPECTED_DIR + '`: null')
  assert.equal(handshakeOf({ metadata: { 'state.reached': { expected: 'state-exams/seeds/prod.json', content: CONTENT } } }), null,
    '(0) [M5] and `state-exams/seeds/` is not `' + EXPECTED_DIR + '` either: null')
  assert.equal(handshakeOf({ metadata: { 'state.reached': { expected: 42, content: CONTENT } } }), null,
    '(0) [M5] an `expected` that is not a string: null')
  assert.equal(handshakeOf({ metadata: { 'state.reached': { content: CONTENT } } }), null,
    '(0) [M5] no `expected` at all: null')

  // Well-formedness is exactly those two conditions: a value carrying more than
  // the two keys is not malformed, and what it answers is still the pair.
  const extra = handshakeOf({ metadata: { 'state.reached': { expected: EXPECTED_PATH, content: CONTENT, note: 'run-155' } } })
  assert.ok(extra && typeof extra === 'object',
    '(0) [M5] well-formed is EXACTLY the two conditions the clause names, so a ' +
    'value carrying a third key is well-formed — got ' + JSON.stringify(extra))
  assert.equal(extra.expected, EXPECTED_PATH,
    '(0) [M5] and its `expected` is the path the post named')
  assert.deepEqual(extra.content, CONTENT,
    '(0) [M5] and its `content` is the pair the post carried')
  // The two elements are the `getContent()` pair, whatever they hold.
  const emptyPair = handshakeOf({ metadata: { 'state.reached': { expected: EXPECTED_DIR + 'empty.json', content: [{}, {}] } } })
  assert.deepEqual(emptyPair, { expected: EXPECTED_DIR + 'empty.json', content: [{}, {}] },
    '(0) [M5] two empty objects are an array of exactly two elements: well-formed')
}

// ════════════════════════════════════════════════════════════════════════════
// run A — the producer posts, its expected file agrees
// legs (a) [M1], (c) [M2], (g) [M3]
// ════════════════════════════════════════════════════════════════════════════
const repoA = makeRepo(path.join(tmp, 'repo-a'))
const A = await driveRun({
  label: 'A', repo: repoA, runDir: path.join(tmp, 'run-a'),
  post: { expected: EXPECTED_PATH, content: CONTENT },
  expectedFile: CONTENT,
})
{
  // ── sim preconditions: the run these legs assert about actually happened ──
  assert.deepEqual(A.labels.filter((l) => l.startsWith('impl:')).sort(), ['impl:1', 'impl:2'],
    '(a) [M1] sim precondition: both tasks ran an implementer — the consumer is ' +
    'dispatched at all, which is what makes the seeding question askable. ' +
    'Dispatched: ' + JSON.stringify(A.labels))
  assert.ok(A.labels.indexOf('impl:' + PRODUCER) < A.labels.indexOf('impl:' + CONSUMER),
    '(a) [M1] sim precondition: the edge `' + PRODUCER + ' -> ' + CONSUMER + '` held — the ' +
    'producer ran first, so its post exists before the consumer is dispatched. ' +
    JSON.stringify(A.labels))
  assert.equal(A.rowOf(PRODUCER).status, 'done',
    '(c) [M2] sim precondition: the producer ended `done` — its post and its expected ' +
    'file agree, so nothing blocked it: ' + JSON.stringify(A.rowOf(PRODUCER)))
  assert.equal(A.rowOf(CONSUMER).status, 'done',
    '(a) [M1] sim precondition: the consumer ended `done`: ' + JSON.stringify(A.rowOf(CONSUMER)))
  assert.ok(A.labels.includes('exam:' + CONSUMER),
    '(a) [M1] sim precondition: the consumer had an examiner, so it has an exam command ' +
    'at all: ' + JSON.stringify(A.labels))

  // ── (a) [M1] the seed, read by the exam command, in both clones ──────────
  // The witness the exam wrote at each pass: `base` in the examiner's clone,
  // `0` in the task clone. Its presence IS "before the exam command first
  // runs" — the file was there when the command read it.
  const passes = [
    ['base', path.join(A.clonesDir, 'exam-' + CONSUMER), 'the examiner\'s clone'],
    ['0', path.join(A.clonesDir, 'task-' + CONSUMER), 'the consumer\'s task clone'],
  ]
  for (const [pass, clone, what] of passes) {
    const cwd = A.witness[CONSUMER + '-' + pass + '/cwd']
    assert.ok(cwd !== undefined,
      '(a) [M1] sim precondition: the consumer\'s exam command ran at pass `' + pass +
      '`, which is the moment this leg measures. The witness held: ' +
      JSON.stringify(Object.keys(A.witness)))
    assert.equal(cwd.trim(), fs.realpathSync(clone),
      '(a) [M1] and pass `' + pass + '` ran in ' + what + ' — ' + clone +
      '; got ' + JSON.stringify(cwd.trim()))
    const seen = A.witness[CONSUMER + '-' + pass + '/seed.json']
    assert.ok(seen !== undefined,
      '(a) [M1] ' + what + ' held `' + SEED_REL + '` when the consumer\'s exam command ' +
      'read it at pass `' + pass + '`: the driver writes the producer\'s posted ' +
      '`content` there BEFORE that command first runs. The exam found no such file. ' +
      'Witness: ' + JSON.stringify(Object.keys(A.witness)))
    assert.deepEqual(JSON.parse(seen), CONTENT,
      '(a) [M1] and what it read parses to EXACTLY the `content` the producer posted — ' +
      canonical(CONTENT) + '; got ' + seen)
  }

  // The same two files, read off the clones after the run: one seed per clone,
  // named for the producing task, and nothing else under `state-exams/posted/`.
  assert.deepEqual(postedPathsIn(A.clonesDir),
    ['exam-' + CONSUMER + '/' + SEED_REL, 'task-' + CONSUMER + '/' + SEED_REL],
    '(a) [M1] the run\'s clones hold exactly two seeds — `' + SEED_REL + '` in the ' +
    'consumer\'s task clone and in its examiner\'s clone, named for the PRODUCING ' +
    'task id as the plan numbers it, and none anywhere else. Got: ' +
    JSON.stringify(postedPathsIn(A.clonesDir)))
  for (const clone of ['exam-' + CONSUMER, 'task-' + CONSUMER]) {
    const onDisk = fs.readFileSync(path.join(A.clonesDir, clone, SEED_REL), 'utf8')
    assert.deepEqual(JSON.parse(onDisk), CONTENT,
      '(a) [M1] `' + clone + '/' + SEED_REL + '` is the posted `content`, as JSON: ' + onDisk)
  }

  // ── (c) [M2] the producer settled: one event, no finding ─────────────────
  const settled = kindsOf(A.events, SETTLED_KIND)
  assert.equal(settled.length, 1,
    '(c) [M2] the producer\'s expected file parses equal to its posted `content`, so the ' +
    'pre-review pass appends EXACTLY ONE `' + SETTLED_KIND + '` event. Got ' +
    settled.length + ': ' + JSON.stringify(settled))
  assert.deepEqual(fieldsOf(settled[0], ['kind', 'task', 'expected']),
    { kind: SETTLED_KIND, task: PRODUCER, expected: EXPECTED_PATH },
    '(c) [M2] and it is `' + SETTLED_KIND + ' {task, expected}` for the producing task ' +
    'and the path its post named. Got: ' + JSON.stringify(settled[0]))

  // "adds no finding": no red reached the producer at all. A blocking finding
  // would have bought it the `fix:1:0` round, posted a `review round 0:`
  // comment on its issue and ended it with notes; none of the three happened.
  assert.ok(!A.labels.includes('fix:' + PRODUCER + ':0'),
    '(c) [M2] an equal comparison adds no finding, so the producer bought no ' +
    '`fix:' + PRODUCER + ':0` round: ' + JSON.stringify(A.labels))
  assert.equal(A.rowOf(PRODUCER).reviewVerdict, 'clean',
    '(c) [M2] and its row is clean: ' + JSON.stringify(A.rowOf(PRODUCER)))
  assert.equal(A.rowOf(PRODUCER).notes, '',
    '(c) [M2] with nothing in its notes: ' + JSON.stringify(A.rowOf(PRODUCER).notes))
  for (const body of A.fake.commentsOn(UID[PRODUCER])) {
    assert.ok(!body.includes(FINDING_PREFIX),
      '(c) [M2] and no `' + FINDING_PREFIX + '` finding was posted on the producer\'s ' +
      'issue: ' + JSON.stringify(body))
  }
  for (const d of A.dispatched) {
    assert.ok(!d.prompt.includes(FINDING_PREFIX),
      '(c) [M2] and no worker of the run was handed one either — `' + d.label + '`\'s ' +
      'prompt names `' + FINDING_PREFIX + '`')
  }

  // ── (g) [M3] one fact per post, and the digest ──────────────────────────
  const facts = kindsOf(A.events, FACT_KIND)
  assert.equal(facts.length, 1,
    '(g) [M3] the run holds one post, read twice — once to seed the consumer (M1) and ' +
    'once to compare at the producer\'s pre-review pass (M2) — and every post the ' +
    'driver reads is appended ONCE: exactly one `' + FACT_KIND + '` event. Got ' +
    facts.length + ': ' + JSON.stringify(facts))
  assert.deepEqual(fieldsOf(facts[0], ['kind', 'task', 'expected', 'sha256']),
    { kind: FACT_KIND, task: PRODUCER, expected: EXPECTED_PATH, sha256: sha256Of(CONTENT) },
    '(g) [M3] and it is `' + FACT_KIND + ' {task, expected, sha256}` where `sha256` is ' +
    'over the canonical JSON of `content` — keys sorted at every level, which for this ' +
    'post is ' + canonical(CONTENT) + ' and NOT `JSON.stringify(content)` (' +
    JSON.stringify(CONTENT) + '). Got: ' + JSON.stringify(facts[0]))
  assert.notEqual(canonical(CONTENT), JSON.stringify(CONTENT),
    '(g) [M3] sim precondition: this fixture\'s keys are not in sorted order, so the ' +
    'canonical digest and the naive one are different strings and the assertion above ' +
    'can tell them apart')
  assert.equal(kindsOf(A.events, ABSENT_KIND).length, 0,
    '(g) [M1] a producer that posted is not an absent one: no `' + ABSENT_KIND +
    '` event. Got: ' + JSON.stringify(kindsOf(A.events, ABSENT_KIND)))
}

// ════════════════════════════════════════════════════════════════════════════
// run B — no issue of the run carries `state.reached`
// legs (b) [M1], (h) [M3]
// ════════════════════════════════════════════════════════════════════════════
const repoB = makeRepo(path.join(tmp, 'repo-b'))
const runDirB = path.join(tmp, 'run-b')
const promptsHead = path.join(tmp, 'prompts-head')
const B = await driveRun({
  label: 'B', repo: repoB, runDir: runDirB, post: null, expectedFile: ABSENT,
  promptDir: promptsHead,
})
{
  assert.deepEqual(B.labels.filter((l) => l.startsWith('impl:')).sort(), ['impl:1', 'impl:2'],
    '(b) [M1] sim precondition: the same two-task plan ran both tasks, the consumer ' +
    'included: ' + JSON.stringify(B.labels))

  // ── (b) [M1] no post: no seed anywhere, one `handshake:absent` ───────────
  assert.deepEqual(postedPathsIn(B.clonesDir), [],
    '(b) [M1] the producer\'s issue carries no `state.reached`, so NO file is written ' +
    'under `state-exams/posted/` in either of the consumer\'s clones — nor anywhere ' +
    'else in the run\'s clones. Found: ' + JSON.stringify(postedPathsIn(B.clonesDir)))
  for (const [pass] of [['base'], ['0']]) {
    assert.ok(B.witness[CONSUMER + '-' + pass + '/absent'] !== undefined,
      '(b) [M1] and the consumer\'s own exam command found no seed at pass `' + pass +
      '`: ' + JSON.stringify(Object.keys(B.witness)))
  }
  const absent = kindsOf(B.events, ABSENT_KIND)
  assert.equal(absent.length, 1,
    '(b) [M1] and EXACTLY ONE `' + ABSENT_KIND + '` event is appended — one per ' +
    'consumer/producer pair the run could not seed. Got ' + absent.length + ': ' +
    JSON.stringify(absent))
  assert.deepEqual(fieldsOf(absent[0], ['kind', 'task', 'producer']),
    { kind: ABSENT_KIND, task: CONSUMER, producer: PRODUCER },
    '(b) [M1] naming the pair: `task` is the consumer being seeded (' + CONSUMER +
    ') and `producer` is the task it consumes from (' + PRODUCER + '). Got: ' +
    JSON.stringify(absent[0]))

  // ── (h) [M3] the three absences of a run with no post ────────────────────
  assert.equal(kindsOf(B.events, FACT_KIND).length, 0,
    '(h) [M3] a run with no `state.reached` on any issue appends no `' + FACT_KIND +
    '`. Got: ' + JSON.stringify(kindsOf(B.events, FACT_KIND)))
  assert.equal(kindsOf(B.events, SETTLED_KIND).length, 0,
    '(h) [M3] and no `' + SETTLED_KIND + '` — its `' + ABSENT_KIND + '` events are ' +
    'M1\'s. Got: ' + JSON.stringify(kindsOf(B.events, SETTLED_KIND)))
  assert.deepEqual(postedPathsIn(B.clonesDir), [],
    '(h) [M3] and it writes nothing under `state-exams/posted/`')

  // ── (h) [M3] and every worker prompt is the one BASE produces ────────────
  // The BASE engine, out of a `git archive` of the checkout at the BASE this
  // exam was written against, run over the SAME plan, the SAME repository and
  // the SAME run-directory path — so the patch file paths the reviewer's
  // prompt carries are identical by construction rather than by normalisation.
  const BASE_SHA = '901fc874923210207e041f947407b8ea519c1ab2'
  const baseTree = path.join(tmp, 'base-tree')
  fs.mkdirSync(baseTree, { recursive: true })
  // Both spawns take `simEnv()` rather than this process's environment: the
  // sweep in `fleet/tests/test_sims_are_hermetic.mjs` reaches
  // `exams/<slug>/test_*.mjs` (#890, its leg (j)) and holds an exam to the same
  // hermeticity rule as a curated sim. `git` and `tar` both resolve on the PATH
  // it builds, and neither reads a key of the parent.
  const tar = execFileSync('git', ['-C', ROOT, 'archive', BASE_SHA],
    { maxBuffer: 1 << 30, encoding: 'buffer', env: simEnv() })
  execFileSync('tar', ['-x', '-C', baseTree], { input: tar, env: simEnv() })
  const { runEngine: baseEngine } = await import(path.join(baseTree, 'fleet', 'run-engine.mjs'))

  const promptsBase = path.join(tmp, 'prompts-base')
  const BB = await driveRun({
    label: 'B-at-base', repo: repoB, runDir: runDirB, post: null, expectedFile: ABSENT,
    engine: baseEngine, promptDir: promptsBase,
  })
  assert.equal(BB.report.baseSha, B.report.baseSha,
    '(h) [M3] sim precondition: both runs were cut at the same BASE — ' +
    BB.report.baseSha + ' vs ' + B.report.baseSha)
  assert.deepEqual(BB.labels, B.labels,
    '(h) [M3] sim precondition: the same run — the same workers, in the same order, ' +
    'under both engines. BASE dispatched ' + JSON.stringify(BB.labels) + ', HEAD ' +
    JSON.stringify(B.labels))
  const listing = (d) => fs.readdirSync(d).sort()
  assert.ok(listing(promptsHead).length > 0,
    '(h) [M3] sim precondition: prompts were recorded at all — ' +
    JSON.stringify(listing(promptsHead)))
  assert.deepEqual(listing(promptsHead), listing(promptsBase),
    '(h) [M3] the same prompt files, one per dispatch, under both engines')
  for (const file of listing(promptsBase)) {
    const head = fs.readFileSync(path.join(promptsHead, file))
    const atBase = fs.readFileSync(path.join(promptsBase, file))
    assert.ok(head.equals(atBase),
      '(h) [M3] every worker prompt of a run with no post is BYTE-IDENTICAL to the one ' +
      'the same run produces under the BASE engine\'s prompt builder: `' + file +
      '` differs.\n--- at BASE ---\n' + atBase.toString('utf8') +
      '\n--- with this task ---\n' + head.toString('utf8'))
  }
}

// ════════════════════════════════════════════════════════════════════════════
// run D — one cell of the expected file differs from the post
// leg (d) [M2], and (g) [M3] once more
// ════════════════════════════════════════════════════════════════════════════
{
  const repoD = makeRepo(path.join(tmp, 'repo-d'))
  const D = await driveRun({
    label: 'D', repo: repoD, runDir: path.join(tmp, 'run-d'),
    post: { expected: EXPECTED_PATH, content: CONTENT },
    expectedFile: CONTENT_ONE_CELL_OFF,
  })
  const row = D.rowOf(PRODUCER)
  assert.ok(row,
    '(d) [M2] sim precondition: the producer has a row in the report: ' +
    JSON.stringify(D.report.tasks))

  // ── the finding, where the driver's own blocking findings are read ───────
  const fixPrompts = D.promptOf('fix:' + PRODUCER + ':0')
  assert.equal(fixPrompts.length, 1,
    '(d) [M2] the finding routes to the task\'s `fix:' + PRODUCER + ':0` round exactly ' +
    'as any blocking finding does: exactly one such round was dispatched. Dispatched: ' +
    JSON.stringify(D.labels))
  const inPrompt = handshakeLinesIn(fixPrompts[0])
  assert.equal(inPrompt.length, 1,
    '(d) [M2] and the round is handed EXACTLY ONE `' + FINDING_PREFIX + '` finding — ' +
    'one differing cell is one finding. The prompt\'s blocking block held: ' +
    JSON.stringify(handshakeLinesIn(fixPrompts[0])) + '\n' + fixPrompts[0])
  assert.equal(detailBody(inPrompt[0]), DIFF_CELL,
    '(d) [M2] whose detail is prefixed `' + FINDING_PREFIX + '` and carries the differing ' +
    'cell as `<table>/<row>/<cell> got <posted> wanted <file>`: `' + DIFF_CELL +
    '` — the post reads `true` at `todos/0/completed`, the file reads `false`. Got: ' +
    JSON.stringify(inPrompt[0]))

  // The same one finding on the record the fix worker reads.
  const rounds = D.fake.commentsOn(UID[PRODUCER]).filter((b) => b.startsWith('review round 0:'))
  assert.equal(rounds.length, 1,
    '(d) [M2] one pre-review round is posted on the producer\'s issue, as any blocking ' +
    'finding\'s round is. Got: ' + JSON.stringify(rounds))
  assert.deepEqual(handshakeLinesIn(rounds[0]).map(detailBody), [DIFF_CELL],
    '(d) [M2] and that post carries the one finding, spelled the same way: ' +
    JSON.stringify(rounds[0]))

  // …and on the row the run reports, which is the red that ended the task.
  const noteLines = String(row.notes || '').split('; ').filter((l) => l.startsWith(FINDING_PREFIX))
  assert.deepEqual(noteLines.map(detailBody), [DIFF_CELL],
    '(d) [M2] the producer ends the run carrying that one finding and no other: ' +
    JSON.stringify(row))

  // ── `blocking`, and `actor` `implementer` ────────────────────────────────
  // A `blocking` finding is one that stops the task where a minor one would
  // not: the pass bought a repair round and, still unequal, the task never
  // reached a reviewer.
  assert.equal(row.status, 'failed',
    '(d) [M2] the finding is `blocking`: the producer is stopped at review rather than ' +
    'merged with a note. Got: ' + JSON.stringify(row))
  assert.ok(!D.labels.some((l) => l.startsWith('review:' + PRODUCER + ':')),
    '(d) [M2] and no referee was asked to read a patch whose own proof the driver had ' +
    'already refused: ' + JSON.stringify(D.labels))
  // `actor: implementer` is who the finding is routed TO. An `actor: plan`
  // finding drives no fix round and travels to the gate as a `plan-defect`
  // deferral instead; this one did the opposite, in both halves.
  assert.deepEqual(D.report.deferredVerification.filter((d) => d && d.deliverable === PRODUCER), [],
    '(d) [M2] `actor` is `implementer`, not `plan`: the finding is the implementer\'s to ' +
    'clear, so it buys that fix round and reaches the gate as no `plan-defect` deferral. ' +
    'Got: ' + JSON.stringify(D.report.deferredVerification))
  assert.notEqual(row.actor, 'plan',
    '(d) [M2] and the row is not parked for the plan: ' + JSON.stringify(row))

  // ── (g) [M3] the post was read, so it is a fact on the log ──────────────
  const facts = kindsOf(D.events, FACT_KIND)
  assert.equal(facts.length, 1,
    '(g) [M3] the post the pre-review pass read is appended once. Got: ' + JSON.stringify(facts))
  assert.deepEqual(fieldsOf(facts[0], ['kind', 'task', 'expected', 'sha256']),
    { kind: FACT_KIND, task: PRODUCER, expected: EXPECTED_PATH, sha256: sha256Of(CONTENT) },
    '(g) [M3] with the digest of the POSTED content — what the issue carried, not what ' +
    'the file held. Got: ' + JSON.stringify(facts[0]))
  assert.equal(kindsOf(D.events, SETTLED_KIND).length, 0,
    '(d) [M2] an unequal comparison settles nothing: no `' + SETTLED_KIND + '` event. ' +
    'Got: ' + JSON.stringify(kindsOf(D.events, SETTLED_KIND)))
}

// ════════════════════════════════════════════════════════════════════════════
// run E — `expected` names a path the captured tree has not got
// leg (e) [M2], and (g) [M3] once more
// ════════════════════════════════════════════════════════════════════════════
{
  const MISSING = EXPECTED_DIR + 'never-written.json'
  const repoE = makeRepo(path.join(tmp, 'repo-e'))
  const E = await driveRun({
    label: 'E', repo: repoE, runDir: path.join(tmp, 'run-e'),
    post: { expected: MISSING, content: CONTENT },
    expectedPath: MISSING, expectedFile: ABSENT,
  })
  const row = E.rowOf(PRODUCER)
  const fixPrompts = E.promptOf('fix:' + PRODUCER + ':0')
  assert.equal(fixPrompts.length, 1,
    '(e) [M2] an `expected` path absent from the captured tree raises the SAME finding, ' +
    'so it buys the same one `fix:' + PRODUCER + ':0` round. Dispatched: ' +
    JSON.stringify(E.labels))
  const lines = handshakeLinesIn(fixPrompts[0])
  assert.equal(lines.length, 1,
    '(e) [M2] exactly one `' + FINDING_PREFIX + '` finding: ' + fixPrompts[0])
  assert.ok(detailBody(lines[0]).includes(MISSING),
    '(e) [M2] and it NAMES THE PATH the post asked for — `' + MISSING + '`, which the ' +
    'producer\'s captured tree has not got. Got: ' + JSON.stringify(lines[0]))
  assert.ok(!detailBody(lines[0]).includes(' wanted '),
    '(e) [M2] and it is not a cell comparison: there is no file to compare against. ' +
    'Got: ' + JSON.stringify(lines[0]))
  assert.equal(row.status, 'failed',
    '(e) [M2] the same `blocking` standing: the producer is stopped at review. ' +
    JSON.stringify(row))
  assert.deepEqual(E.report.deferredVerification.filter((d) => d && d.deliverable === PRODUCER), [],
    '(e) [M2] and the same `actor` `implementer` routing — no `plan-defect` deferral: ' +
    JSON.stringify(E.report.deferredVerification))
  assert.equal(kindsOf(E.events, SETTLED_KIND).length, 0,
    '(e) [M2] nothing settled: ' + JSON.stringify(kindsOf(E.events, SETTLED_KIND)))
  const facts = kindsOf(E.events, FACT_KIND)
  assert.deepEqual(facts.map((f) => fieldsOf(f, ['kind', 'task', 'expected', 'sha256'])),
    [{ kind: FACT_KIND, task: PRODUCER, expected: MISSING, sha256: sha256Of(CONTENT) }],
    '(g) [M3] the post was well-formed and the driver read it, so it is one ' +
    '`' + FACT_KIND + '` on the log — the file it named being absent is M2\'s finding, ' +
    'not a reason to forget the post. Got: ' + JSON.stringify(facts))
}

// ════════════════════════════════════════════════════════════════════════════
// runs F and F2 — the two malformed halves [M5]
// ════════════════════════════════════════════════════════════════════════════
const malformed = async (leg, label, post, names) => {
  const repo = makeRepo(path.join(tmp, 'repo-' + label))
  const R = await driveRun({
    label, repo, runDir: path.join(tmp, 'run-' + label),
    post, expectedFile: CONTENT,
  })
  const fixPrompts = R.promptOf('fix:' + PRODUCER + ':0')
  assert.equal(fixPrompts.length, 1,
    leg + ' [M5] a malformed value raises the same `' + FINDING_PREFIX + '` finding at ' +
    'the producer\'s pre-review pass, which buys the one `fix:' + PRODUCER + ':0` round ' +
    'any blocking finding buys. Dispatched: ' + JSON.stringify(R.labels))
  const lines = handshakeLinesIn(fixPrompts[0])
  assert.equal(lines.length, 1,
    leg + ' [M5] exactly one such finding: ' + fixPrompts[0])
  assert.ok(detailBody(lines[0]).includes(names),
    leg + ' [M5] whose detail NAMES THE MALFORMED FIELD — `' + names + '`. Got: ' +
    JSON.stringify(lines[0]))
  assert.ok(!detailBody(lines[0]).includes(' wanted '),
    leg + ' [M5] and never M2\'s cell comparison — a malformed post is refused before ' +
    'any file is compared. Got: ' + JSON.stringify(lines[0]))
  assert.equal(R.rowOf(PRODUCER).status, 'failed',
    leg + ' [M5] the same `blocking` standing: ' + JSON.stringify(R.rowOf(PRODUCER)))
  assert.deepEqual(R.report.deferredVerification.filter((d) => d && d.deliverable === PRODUCER), [],
    leg + ' [M5] and the same `actor` `implementer` routing — no `plan-defect` deferral: ' +
    JSON.stringify(R.report.deferredVerification))
  assert.deepEqual(postedPathsIn(R.clonesDir), [],
    leg + ' [M5] a malformed value writes NO seed file under M1: nothing under ' +
    '`state-exams/posted/` anywhere in the run\'s clones. Found: ' +
    JSON.stringify(postedPathsIn(R.clonesDir)))
  assert.deepEqual(kindsOf(R.events, FACT_KIND), [],
    leg + ' [M5] and never a `' + FACT_KIND + '` event: a malformed post is not a fact ' +
    'the run reached. Got: ' + JSON.stringify(kindsOf(R.events, FACT_KIND)))
  assert.deepEqual(kindsOf(R.events, SETTLED_KIND), [],
    leg + ' [M5] and nothing settled: ' + JSON.stringify(kindsOf(R.events, SETTLED_KIND)))
  return R
}
await malformed('(f)', 'f', { expected: EXPECTED_PATH, content: [...CONTENT, { extra: true }] }, 'content')
await malformed('(f2)', 'f2', { expected: 'expected/prod.json', content: CONTENT }, 'expected')

// ════════════════════════════════════════════════════════════════════════════
// run I — the same plan, started without `--kata`
// leg (i) [M4]
// ════════════════════════════════════════════════════════════════════════════
{
  const repoI = makeRepo(path.join(tmp, 'repo-i'))
  // The hub's client is handed to the engine and its RECORD is not, which is
  // what a run started without `--kata` is: the engine reads `kataOn` off both
  // halves. The client is present only so that "makes no `getIssue`" is a
  // counted zero rather than an absence nothing could have counted.
  const I = await driveRun({
    label: 'I', repo: repoI, runDir: path.join(tmp, 'run-i'),
    post: { expected: EXPECTED_PATH, content: CONTENT },
    expectedFile: CONTENT, kataOn: false,
  })
  assert.deepEqual(I.labels.filter((l) => l.startsWith('impl:')).sort(), ['impl:1', 'impl:2'],
    '(i) [M4] sim precondition: the same two-task plan ran both tasks: ' +
    JSON.stringify(I.labels))
  assert.deepEqual(I.fake.of('getIssue'), [],
    '(i) [M4] a run with no kata record makes NO `getIssue` for the handshake — nor for ' +
    'anything else. The fake hub recorded: ' + JSON.stringify(I.fake.calls.map((c) => c.method)))
  const handshakeEvents = I.events.filter((e) => String(e.kind || '').startsWith('handshake:'))
  assert.deepEqual(handshakeEvents, [],
    '(i) [M4] and appends no event whose kind begins `handshake:` — of any kind, the ' +
    'absent one included. Got: ' + JSON.stringify(handshakeEvents))
  assert.deepEqual(kindsOf(I.events, FACT_KIND), [],
    '(i) [M4] and M3\'s no-post half holds: no `' + FACT_KIND + '` event. Got: ' +
    JSON.stringify(kindsOf(I.events, FACT_KIND)))
  assert.deepEqual(postedPathsIn(I.clonesDir), [],
    '(i) [M4] and nothing is written under `state-exams/posted/`: ' +
    JSON.stringify(postedPathsIn(I.clonesDir)))
  for (const [pass] of [['base'], ['0']]) {
    assert.ok(I.witness[CONSUMER + '-' + pass + '/absent'] !== undefined,
      '(i) [M4] read from the consumer\'s own exam command at pass `' + pass + '`, which ' +
      'found no seed: ' + JSON.stringify(Object.keys(I.witness)))
  }
}

// ════════════════════════════════════════════════════════════════════════════
// fleet run-160 Task A — *a blocking finding and a refuted finding are events*
// legs (i) and (j) [M4]: the `handshake:finding` row this file's own rigs
// already raise now carries the run's receipt shape.
//
// ── what M4 asserts, restated ───────────────────────────────────────────────
//   A `handshake:finding` event raised on a post that NAMES an `expected` path
//   carries `paths` `[<that expected path>]` and `evidence` with `read` the
//   finding's `detail` and `against` `the captured tree at <headSha>`; one
//   raised on a `state.reached` that names no `expected` path — its content is
//   not an array of exactly two elements — carries NO `paths` key and NO
//   `evidence` key.
//
// The shared receipt shape of this run: `paths` is repo-relative, sorted,
// de-duplicated and never empty; `evidence` is exactly `{read, against}`, two
// strings. So both assertions below are deep-equals over the whole value, not
// containments: a row carrying a third evidence key, or a path list with
// something extra on it, is not the shape.
//
// ── two readings this block is written on ───────────────────────────────────
//   • `<headSha>` is the task's CAPTURED head — `impl.headSha`, which
//     `withPatchCapture` overwrites with `git rev-parse HEAD` in the task's own
//     clone (run-waves.mjs:239). `patchAgainstBase` stages and diffs but never
//     commits, and `cloneAtBase` leaves the clone detached at BASE, so that sha
//     is the repository's HEAD at provision time for the whole run. This block
//     therefore reads it straight off the repository, before the run, rather
//     than out of a report row: a blocked producer's row carries no `headSha`
//     of its own.
//   • Each leg drives a run OF ITS OWN rather than reaching into run E's or run
//     F's block, whose bindings are local to them. The posts are theirs,
//     though: leg (i) is run E's rig — an `expected` the captured tree lacks —
//     and leg (j) is run F's — a three-element `content`.
// ════════════════════════════════════════════════════════════════════════════
const A_FINDING_KIND = 'handshake:finding'
const aHeadShaOf = (repo) =>
  execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, env: simEnv(), encoding: 'utf8' }).trim()
// The one `handshake:finding` a rig raised, with the row asserted to be alone
// on the log: every leg below is about ONE finding's receipt.
const aLoneFinding = (R, leg) => {
  const rows = kindsOf(R.events, A_FINDING_KIND)
  assert.equal(rows.length, 1,
    'Task A leg ' + leg + ' [M4] sim precondition — the rig raised exactly one `' +
    A_FINDING_KIND + '` event, which is the row this leg is about. Got: ' +
    JSON.stringify(rows))
  return rows[0]
}

// ── Task A leg (i) [M4]: a post whose `expected` the captured tree lacks ─────
{
  const MISSING = EXPECTED_DIR + 'never-written.json'
  const repo = makeRepo(path.join(tmp, 'repo-ta-i'))
  const headSha = aHeadShaOf(repo)
  assert.match(headSha, /^[0-9a-f]{40}$/,
    'Task A leg (i) [M4] sim precondition — the repository the producer\'s clone is ' +
    'provisioned from is at a 40-hex head, which is the `headSha` the capture hands the ' +
    'driver: ' + JSON.stringify(headSha))
  const R = await driveRun({
    label: 'TA-i', repo, runDir: path.join(tmp, 'run-ta-i'),
    post: { expected: MISSING, content: CONTENT },
    expectedPath: MISSING, expectedFile: ABSENT,
  })
  const row = aLoneFinding(R, '(i)')
  assert.equal(row.detail, FINDING_PREFIX + ' ' + MISSING + ' is absent from the captured tree',
    'Task A leg (i) [M4] sim precondition — that row is the finding M2 raises on an ' +
    '`expected` path the captured tree has not got, which is a post that NAMES an ' +
    '`expected` path: ' + JSON.stringify(row))
  assert.deepEqual(row.paths, [MISSING],
    'Task A leg (i) [M4]: a `' + A_FINDING_KIND + '` raised on a post that names an ' +
    '`expected` path carries `paths` equal to `[<that expected path>]` — the one ' +
    'repo-relative path the finding is about, and nothing else: ' + JSON.stringify(row))
  assert.deepEqual(row.evidence,
    { read: row.detail, against: 'the captured tree at ' + headSha },
    'Task A leg (i) [M4]: and `evidence` is exactly `{read, against}` — `read` the ' +
    'finding\'s own `detail`, `against` `the captured tree at ` followed by the task\'s ' +
    'captured `headSha` (' + headSha + '): ' + JSON.stringify(row))
}

// ── Task A leg (j) [M4]: a `state.reached` naming no `expected` path ─────────
{
  const repo = makeRepo(path.join(tmp, 'repo-ta-j'))
  const R = await driveRun({
    label: 'TA-j', repo, runDir: path.join(tmp, 'run-ta-j'),
    post: { expected: EXPECTED_PATH, content: [...CONTENT, { extra: true }] },
    expectedFile: CONTENT,
  })
  const row = aLoneFinding(R, '(j)')
  assert.equal(row.detail,
    FINDING_PREFIX + ' state.reached content is not an array of exactly two elements',
    'Task A leg (j) [M4] sim precondition — that row is M5\'s refusal of a `state.reached` ' +
    'whose content is a THREE-element array, which is the case that names no `expected` ' +
    'path: ' + JSON.stringify(row))
  assert.equal(Object.prototype.hasOwnProperty.call(row, 'paths'), false,
    'Task A leg (j) [M4]: that row has NO `paths` key at all — not an empty array and not ' +
    'a null, since `paths` is never empty and the refused post named no path to carry. ' +
    'Keys: ' + JSON.stringify(Object.keys(row)))
  assert.equal(Object.prototype.hasOwnProperty.call(row, 'evidence'), false,
    'Task A leg (j) [M4]: and NO `evidence` key either — there is no captured tree read ' +
    'to record when the post was refused on shape. Keys: ' + JSON.stringify(Object.keys(row)))
}

// Task A leg (k) [M1] [M4]: every `import` line in this file names `../run-engine.mjs`,
// `../run-main.mjs`, `../run-waves.mjs`, `./_engine_helpers.mjs` or
// `./_helpers.mjs` — `fleet/tests/` depth, nothing under `exams/`. Asserted
// over the file's own text in the proof-runs sim, which greps both guarded
// paths at once; here the rule is kept by construction.

console.log('ALL TESTS PASSED')
