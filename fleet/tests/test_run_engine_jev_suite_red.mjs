// fleet/tests/test_run_engine_jev_suite_red.mjs — the exam for "a `jev:suite-red`
// row in the unattributed-red branch — whose red is it".
//
// Claim: run a plan whose fold turns a test red that no task of the plan names;
// see, on the record and on the run's hub issue, one `jev:suite-red` row for
// that fold naming each red path with Jev's read of which task's change caused
// it and whether it is an artifact of the harness — while the candidate is
// adopted, recorded and left un-reconciled exactly as it was without the row.
//
// The Machine clauses under test, restated:
//   M1 — in `foldWave`'s unattributed-red branch (`failing` non-empty and every
//        failing path unclaimed), before the candidate is adopted, the driver
//        calls `jevRow` ONCE with `row` `{ kind: 'jev:suite-red', epoch:
//        waveNumber }`, state `{ failing: failingBlock(suite.stdout +
//        suite.stderr), tests: unattributed, tasks: { <id>: { files,
//        proofTests, stat } } }` — one `tasks` entry per result in `merged`,
//        `files`/`proofTests` off the plan, `stat` the `{ path, added, removed }`
//        list read from that task's captured patch text — and questions keyed
//        `cause:<id>:<path>` for every (task, unattributed path) pair and
//        `artifact:<path>` for every unattributed path, each the shared
//        literal's noul. On an answer the appended row is `{ kind:
//        'jev:suite-red', epoch, failing: [{ path, byTask: { <id>: <noul> },
//        artifact: <noul> }] }`, one entry per unattributed path in `failing`
//        order, posted on the run's hub issue when a hub is on.
//   M2 — NO `jev:suite-red` row is appended when the candidate's suite is
//        green, when at least one failing path is claimed by a task of the plan
//        (the reconcile route), when `ask` resolves `null`, or when the engine
//        was handed no `jev`.
//   M3 — for the same canned replies, a run with `jev` and a run without it end
//        the epoch `MERGED` with `suite.passed` `false` and the same
//        `suite.unattributed`, push the same `unattributed red:` judgment
//        lines, dispatch no `reconcile:` worker, and leave the integration
//        clone's HEAD at the same tree.
//
// The Proof legs, and where each is answered:
//   (a) [M1] the loud-red two-task run with `jev` and a hub on: exactly one
//            `jev:suite-red` row, `epoch` 1, `failing` deep-equal to the one
//            entry; exactly one recorded request, its three question keys, each
//            of `type` `noul`; `state.tests`, `state.failing`, the two
//            `state.tasks` entries; the row's line verbatim on the run's issue
//            and on no task's                                    — scenario S1
//   (b) [M2] a green candidate, a claimed red path (the reconcile route), a
//            `fetchImpl` answering 500, and a run handed no `jev`: zero rows
//            each                                   — scenarios S2, S3, S4, S5
//   (c) [M3] S1 against S5 — the same loud-red scenario with `jev` and without:
//            the same epoch status, `suite.passed`, `suite.unattributed`, the
//            same `unattributed red:` judgment lines, no `reconcile:` dispatch
//            in either, and the same file set at the integration clone's HEAD
//                                                           — scenarios S1, S5
//
// ── how this sim provokes the unattributed red ──────────────────────────────
// Everything below the agent seam is real: real git repos, real clones at BASE,
// the real capture, the real fold kernel through the real exec seam. Only the
// judgments are canned, so every dispatch and every fold below is the driver's
// own. Jev is reached through the REAL `makeJevClient` over an injected
// `fetchImpl`, and the hub through the rig's `fakeHub`, so no socket is opened.
//
// The repository's suite is `check.sh`: silent and green while `fA.txt` is
// absent, and once task A's implementer has written it, one line —
// `FAILED tests/test_other.py::test_x` — and a non-zero exit. `failingTestPaths`
// reads only `FAILED <path>::<id>` lines, so that candidate's failing list is
// `['tests/test_other.py']`: a path NO task of the plan names in its `files` or
// its `proofTests`, which is the unattributed-red branch. A second task B in
// the same wave writes `fB.txt`, so the fold's `merged` holds two results and
// the row's `byTask` has two keys.
//
// TWO READINGS THIS FILE SETTLES, because a later session would otherwise have
// to reconstruct them:
//
// 1. WHY TASK B CARRIES `proofTests` AND NO `testCmd`. Leg (a) pins
//    `state.tasks.B.proofTests` at `['tests/test_b.py']`, which the task must
//    therefore DECLARE. A task declaring proof tests AND a `testCmd` dispatches
//    an examiner, whose exam would land in B's clone and show up as a second
//    `stat` entry — and leg (a) pins B's `stat` at the single `fB.txt` entry for
//    "an implementer that wrote two lines to `fB.txt`". `examTestCmd` is the
//    engine's own condition for that dispatch (`proofTests.length &&
//    examTestCmd`), so B declares its proof test and no command of its own: the
//    plan entry the row reads is exactly the one the leg spells, and the patch
//    the `stat` is read from is exactly the implementer's two lines.
//
// 2. WHAT "AN IMPLEMENTER THAT WRITES NOTHING" IS IN S2. The suite's colour is
//    decided by `fA.txt` alone, so the green candidate of leg (b) is the same
//    two-task plan with A's implementer writing nothing at all. B still writes
//    `fB.txt`, so the wave folds a real change and a real candidate suite runs
//    on it — green. A wave that folded nothing would leave "the candidate's
//    suite is green" unexercised, which is the condition M2 names.
//
// WHY THIS IS RED AT BASE. At BASE the unattributed-red branch adopts, records
// and returns without asking Jev anything: no `jev:suite-red` row is appended
// anywhere and the sim's `fetchImpl` is never called. Leg (a) — the falsifier —
// asks S1 for exactly one such row and reports the zero it finds.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  makeRepo, rig, fakeHub, passReview, cleanCritic, doneImpl, gitSync,
} from './_engine_helpers.mjs'
import { makeJevClient } from '../jev-client.mjs'
import { failingBlock } from '../failing-block.mjs'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-jev-suite-red-'))
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }))

// ── the fixture: the loud suite ─────────────────────────────────────────────
// Green at BASE; once `fA.txt` exists it names a failing path no task lists and
// exits non-zero. `test_run_engine_reconcile_retry.mjs` builds the SILENT red
// (an output naming no path, which takes the reconcile route); this is the loud
// one, which takes the branch under test.
const CHECK_SH = '#!/bin/bash\n' +
  'if [ -f fA.txt ]; then echo \'FAILED tests/test_other.py::test_x\'; exit 1; fi; exit 0\n'

/** The one unattributed path this suite names. */
const RED_PATH = 'tests/test_other.py'
/** The line the suite prints when it fails. */
const FAILED_LINE = 'FAILED ' + RED_PATH + '::test_x'
/** The noul every canned answer carries. */
const NOUL = 0.7

/** A wave's task, the shape the rig's sims spell. */
const taskOf = (id, extra = {}) => ({
  id, title: 'task ' + id, files: ['f' + id + '.txt'], tier: 'standard', review: 'lean',
  writes: ['f' + id + '.txt'], commutes: [], testCmd: 'bash check.sh', proofTests: [], proofRuns: [],
  body: 'sim task ' + id, ...extra,
})

/** Task B, in every scenario: `fB.txt`, one proof test the suite never names —
 *  so the red stays unattributed — and no `testCmd`, so no examiner is
 *  dispatched and the captured patch is the implementer's two lines alone. */
const TASK_B = () => taskOf('B', { proofTests: ['tests/test_b.py'], testCmd: null })
/** Task A as the loud-red scenarios declare it: it names `fA.txt` and nothing else. */
const TASK_A = () => taskOf('A')
/** Task A as the CLAIMED scenario declares it: the red path is in its `files`,
 *  so the fold takes the reconcile route instead. */
const TASK_A_CLAIMING = () => taskOf('A', { files: ['fA.txt', RED_PATH] })

// ── the hub, for the scenarios that drive one ───────────────────────────────
const PROJECT_ID = 7
const RUN_UID = 'RUN0'
const UID_A = 'U-A'
const UID_B = 'U-B'
const ISSUES = () => ({
  [RUN_UID]: { revision: 1, short_id: 'run0', metadata: {} },
  [UID_A]: { revision: 1, short_id: 'aa11', metadata: {} },
  [UID_B]: { revision: 1, short_id: 'bb22', metadata: {} },
})
/** The record, spelled as the launcher writes it; its issue revisions are the
 *  fake's, because a sheet read whose revision disagrees is fatal. */
const RECORD = () => ({
  url: 'https://kata.invalid',
  project: { id: PROJECT_ID, uid: 'PROJ0', name: 'ultrapowers' },
  run: { uid: RUN_UID, revision: 1 },
  tasks: {
    A: { uid: UID_A, short_id: 'aa11', revision: 1 },
    B: { uid: UID_B, short_id: 'bb22', revision: 1 },
  },
})

/** The run's record, read back off disk. An absent file reads as no events, so
 *  an engine that wrote none fails an assertion rather than throwing ENOENT. */
const rawLinesIn = (runDir) => {
  const file = path.join(runDir, 'events.jsonl')
  if (!fs.existsSync(file)) return []
  return fs.readFileSync(file, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l.startsWith('{'))
}
const parsed = (line) => { try { return JSON.parse(line) } catch { return null } }

/**
 * One scenario: one engine run over the two-task plan.
 *
 *   waves      the plan
 *   writeA     whether `impl:A` writes `fA.txt` — the suite's colour
 *   jevMode    'ok' (a recording `fetchImpl` answering 200 with a noul for
 *              every question id it was sent), '500' (the same recorder
 *              answering status 500), or 'none' (no `jev` handed in at all)
 *   withHub    a `fakeHub` and the matching record, or neither
 *
 * Returns everything the legs read: the report, the dispatched labels, the
 * recorded requests, the `jev:suite-red` rows (raw lines and parsed), the hub,
 * and the integration clone.
 */
const drive = async ({ tag, waves, writeA = true, jevMode = 'ok', withHub = false }) => {
  const requests = []
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(String((init && init.body) || 'null'))
    requests.push({ url, init, body })
    if (jevMode === '500') return { status: 500, text: async () => 'upstream said no' }
    const answers = {}
    for (const id of Object.keys((body && body.questions) || {})) {
      answers[id] = { type: 'noul', noul: NOUL }
    }
    return { status: 200, text: async () => JSON.stringify({ answers }) }
  }
  const jevLogs = []
  const hub = withHub ? fakeHub({ projectId: PROJECT_ID, issues: ISSUES() }) : null
  const repo = makeRepo(path.join(tmp, 'repo-' + tag), { 'check.sh': CHECK_SH })
  const runDir = path.join(tmp, 'run-' + tag)
  const labels = []
  const { run, integ } = rig({
    repo, runDir, waves, stamp: 'jevred-' + tag,
    ...(hub ? { kata: hub.kata } : {}),
    ...(jevMode === 'none' ? {} : {
      jev: makeJevClient({
        baseUrl: 'https://typesafe.invalid', fetchImpl, log: (l) => jevLogs.push(String(l)),
      }),
    }),
    extraArgs: { ...(hub ? { kataRecord: RECORD(), attentionPollMs: 3600000 } : {}) },
    stub: (prompt, opts, cwd) => {
      const label = String(opts.label)
      labels.push(label)
      if (label === 'impl:A') {
        if (writeA) fs.writeFileSync(path.join(cwd, 'fA.txt'), 'one\n')
        return doneImpl(cwd)
      }
      if (label === 'impl:B') {
        fs.writeFileSync(path.join(cwd, 'fB.txt'), 'one\ntwo\n')
        return doneImpl(cwd)
      }
      if (label === 'integration') return cleanCritic()
      if (label.startsWith('review:')) return passReview()
      if (label.startsWith('fix:')) return doneImpl(cwd)
      // The reconcile route's own dispatch, for the CLAIMED scenario: a reply
      // that repairs nothing, so the epoch ends where BASE ends it.
      if (label.startsWith('reconcile:')) return { status: 'BLOCKED', summary: 'sim: no repair' }
      return { status: 'BLOCKED', summary: 'sim: unexpected dispatch ' + label }
    },
  })
  let report = null
  let threw = null
  try { report = await run() } catch (error) { threw = error }
  const rawRows = rawLinesIn(runDir)
    .filter((l) => { const e = parsed(l); return Boolean(e) && e.kind === 'jev:suite-red' })
  return {
    tag, report, threw, labels, requests, jevLogs, hub, integ, runDir,
    // `requests` is EVERY call the engine's one Jev client made. The
    // `jev:tier` row rides that same client (#1096 row 2) — one call at
    // dispatch and one at each review dispatch — so a wire-level count of
    // this row's calls reads `redRequests`: a `jev:suite-red` call is the one
    // whose `state` carries the suite's `failing` block, which no `jev:tier`
    // state has. The row counts below already read the row kind; this is the
    // same reading taken on the wire.
    redRequests: requests.filter((r) => ((r.body || {}).state || {}).failing !== undefined),
    rawRows, rows: rawRows.map(parsed),
    merge: ((report || {}).waveMerges || [])[0] || null,
    judgments: ((report || {}).judgmentCalls || []).map(String),
  }
}

/** The tree at a clone's HEAD, as a file list. */
const treeAt = (dir) => gitSync(['ls-tree', '-r', '--name-only', 'HEAD'], dir).split('\n').filter(Boolean)

// ── the shared literal, spelled as the Machine spells it ────────────────────
const CTX_S = 'A wave of tasks was folded into one tree and the project\'s suite went red in ' +
  '`tests`, paths no task of the plan names in its files or proof tests. `failing` is the ' +
  'suite\'s failing block; `tasks` holds each folded task\'s files, proof tests and the paths ' +
  'its patch touched.'
const causeQuestion = (id, p) => ({
  type: 'noul',
  instructions: {
    question: 'Did task `' + id + '`\'s change (`tasks.' + id + '`) cause the failure of `' +
      p + '` shown in `failing`?',
    context: CTX_S,
  },
  criteria: {
    true: 'This task\'s change is what made this test fail',
    false: 'This task\'s change is unrelated to this failure',
  },
})
const artifactQuestion = (p) => ({
  type: 'noul',
  instructions: {
    question: 'Is the failure of `' + p + '` in `failing` a harness or environment artifact — ' +
      'a timeout, a missing tool, a flaky resource, a sandbox limit — rather than a defect of ' +
      'the tree?',
    context: CTX_S,
  },
  criteria: {
    true: 'The output reads as the environment\'s failure, not the code\'s',
    false: 'The output reads as a real defect in the tree',
  },
})

// ══════════════════════════════════════════════════════════════════════════
// the five scenarios
// ══════════════════════════════════════════════════════════════════════════

// S1 — the loud red, `jev` on, a hub on. Leg (a); the `jev` half of leg (c).
const S1 = await drive({ tag: 's1', waves: [[TASK_A(), TASK_B()]], withHub: true })
// S5 — the same loud-red scenario, hub on, and NO `jev`. Leg (b)'s fourth case;
// the without-`jev` half of leg (c).
const S5 = await drive({ tag: 's5', waves: [[TASK_A(), TASK_B()]], withHub: true, jevMode: 'none' })
// S2 — A's implementer writes nothing: the candidate's suite is green.
const S2 = await drive({ tag: 's2', waves: [[TASK_A(), TASK_B()]], writeA: false })
// S3 — task A names the red path in its `files`: the reconcile route.
const S3 = await drive({ tag: 's3', waves: [[TASK_A_CLAIMING(), TASK_B()]] })
// S4 — the loud red with a `fetchImpl` answering 500: `ask` resolves `null`.
const S4 = await drive({ tag: 's4', waves: [[TASK_A(), TASK_B()]], jevMode: '500' })

for (const s of [S1, S5, S2, S3, S4]) {
  assert.equal(s.threw, null,
    'sim precondition (' + s.tag + '): the run resolves. It threw: ' +
    String(s.threw && (s.threw.stack || s.threw.message || s.threw)))
}

// ══════════════════════════════════════════════════════════════════════════
// (a) [M1] the row, the call, and where the line lands
// ══════════════════════════════════════════════════════════════════════════

assert.ok(S1.merge && S1.merge.suite && Array.isArray(S1.merge.suite.unattributed),
  '(a) [M1] sim precondition: the loud-red fold took the UNATTRIBUTED-red branch — the epoch ' +
  'carries a `suite.unattributed`. Labels: ' + JSON.stringify(S1.labels) + ' | epoch: ' +
  JSON.stringify(S1.merge))
assert.deepEqual(S1.merge.suite.unattributed, [RED_PATH],
  '(a) [M1] sim precondition: with `' + RED_PATH + '` the one unattributed path; got ' +
  JSON.stringify(S1.merge.suite.unattributed))

assert.equal(S1.rows.length, 1,
  '(a) [M1] the loud-red two-task run with `jev` and a hub on leaves EXACTLY ONE ' +
  '`jev:suite-red` row on the record — `jevRow` is called once, in the unattributed-red ' +
  'branch, before the candidate is adopted. Rows found: ' + JSON.stringify(S1.rows) +
  ' | jev log lines: ' + JSON.stringify(S1.jevLogs) + ' | labels: ' + JSON.stringify(S1.labels))

const ROW = S1.rows[0]
assert.equal(ROW.epoch, 1,
  '(a) [M1] whose `epoch` is the wave number, `1`; got ' + JSON.stringify(ROW.epoch) +
  ' in row ' + JSON.stringify(ROW))
assert.deepEqual(ROW.failing, [{ path: RED_PATH, byTask: { A: NOUL, B: NOUL }, artifact: NOUL }],
  '(a) [M1] and whose `failing` is one entry per unattributed path, in `failing` order, each ' +
  '`{ path, byTask: { <id>: <noul> }, artifact: <noul> }` read off the answers — for this ' +
  'run, the one red path with a `byTask` noul per folded task and the artifact noul; got ' +
  JSON.stringify(ROW.failing))

// ── the one call ───────────────────────────────────────────────────────────
assert.equal(S1.redRequests.length, 1,
  '(a) [M1] the fake `fetchImpl` recorded EXACTLY ONE `jev:suite-red` request — one `jevRow` ' +
  'call for the fold, and no second call from anywhere; got ' + S1.redRequests.length + ': ' +
  JSON.stringify(S1.redRequests.map((r) => Object.keys((r.body || {}).questions || {}))))

const SENT = S1.redRequests[0].body || {}
const QUESTIONS = SENT.questions || {}
const STATE = SENT.state || {}
const CAUSE_A = 'cause:A:' + RED_PATH
const CAUSE_B = 'cause:B:' + RED_PATH
const ARTIFACT = 'artifact:' + RED_PATH

assert.deepEqual(Object.keys(QUESTIONS).slice().sort(), [ARTIFACT, CAUSE_A, CAUSE_B].slice().sort(),
  '(a) [M1] whose `questions` has exactly the keys `' + CAUSE_A + '`, `' + CAUSE_B + '` and `' +
  ARTIFACT + '` — one `cause:<id>:<path>` per (task, unattributed path) pair and one ' +
  '`artifact:<path>` per unattributed path; got ' + JSON.stringify(Object.keys(QUESTIONS)))
for (const key of [CAUSE_A, CAUSE_B, ARTIFACT]) {
  assert.equal((QUESTIONS[key] || {}).type, 'noul',
    '(a) [M1] each of `type` `noul` — `' + key + '` is not; got ' +
    JSON.stringify(QUESTIONS[key]))
}
// The shared literal itself, which M1 spells out: the question the driver asks
// is the task's own words, not a paraphrase of them.
assert.deepEqual(QUESTIONS[CAUSE_A], causeQuestion('A', RED_PATH),
  '(a) [M1] `' + CAUSE_A + '` is the shared literal\'s noul, verbatim as the Machine spells ' +
  'it; got ' + JSON.stringify(QUESTIONS[CAUSE_A]))
assert.deepEqual(QUESTIONS[CAUSE_B], causeQuestion('B', RED_PATH),
  '(a) [M1] and so is `' + CAUSE_B + '`; got ' + JSON.stringify(QUESTIONS[CAUSE_B]))
assert.deepEqual(QUESTIONS[ARTIFACT], artifactQuestion(RED_PATH),
  '(a) [M1] and `' + ARTIFACT + '` is the artifact literal, verbatim; got ' +
  JSON.stringify(QUESTIONS[ARTIFACT]))

// ── the state ──────────────────────────────────────────────────────────────
assert.deepEqual(STATE.tests, [RED_PATH],
  '(a) [M1] whose `state.tests` is `unattributed` — the paths no task of the plan names; got ' +
  JSON.stringify(STATE.tests))
assert.ok(typeof STATE.failing === 'string' && STATE.failing.includes(FAILED_LINE),
  '(a) [M1] whose `state.failing` contains `' + FAILED_LINE + '`; got ' +
  JSON.stringify(STATE.failing))
assert.equal(STATE.failing, failingBlock(S1.merge.suite.output),
  '(a) [M1] and IS `failingBlock(suite.stdout + suite.stderr)` — the same block the reconcile ' +
  'prompt gets — measured against the suite output the epoch recorded; got ' +
  JSON.stringify(STATE.failing) + ' against ' +
  JSON.stringify(failingBlock(S1.merge.suite.output)))
assert.deepEqual(Object.keys(STATE.tasks || {}).slice().sort(), ['A', 'B'],
  '(a) [M1] whose `state.tasks` has one entry per result in `merged` — this wave folded A and ' +
  'B; got ' + JSON.stringify(Object.keys(STATE.tasks || {})))
assert.deepEqual((STATE.tasks || {}).A,
  { files: ['fA.txt'], proofTests: [], stat: [{ path: 'fA.txt', added: 1, removed: 0 }] },
  '(a) [M1] whose `state.tasks.A` is the task\'s `files` and `proofTests` off the plan and the ' +
  '`{ path, added, removed }` list read from its captured patch text — one line written to ' +
  '`fA.txt`; got ' + JSON.stringify((STATE.tasks || {}).A))
assert.deepEqual((STATE.tasks || {}).B,
  { files: ['fB.txt'], proofTests: ['tests/test_b.py'],
    stat: [{ path: 'fB.txt', added: 2, removed: 0 }] },
  '(a) [M1] and whose `state.tasks.B` carries B\'s declared `proofTests` (a path the suite ' +
  'never names, so the red stays unattributed) and the two lines its implementer wrote to ' +
  '`fB.txt`; got ' + JSON.stringify((STATE.tasks || {}).B))

// ── where the line lands ───────────────────────────────────────────────────
const ROW_LINE = S1.rawRows[0]
const onRun = S1.hub.commentsOn(RUN_UID)
assert.ok(onRun.includes(ROW_LINE),
  '(a) [M1] the row\'s line is posted VERBATIM on the run\'s hub issue (' + RUN_UID + ') — the ' +
  'row names no task, so the `driver:` rule routes it to the run. Comments there: ' +
  JSON.stringify(onRun) + ' | the line: ' + JSON.stringify(ROW_LINE))
for (const [id, uid] of [['A', UID_A], ['B', UID_B]]) {
  const onTask = S1.hub.commentsOn(uid)
  assert.equal(onTask.includes(ROW_LINE), false,
    '(a) [M1] and on NO task issue — task ' + id + '\'s (' + uid + ') carries it. Comments ' +
    'there: ' + JSON.stringify(onTask))
}

// ══════════════════════════════════════════════════════════════════════════
// (b) [M2] the four foldings that append no row
// ══════════════════════════════════════════════════════════════════════════

assert.equal(S2.merge && S2.merge.status, 'MERGED',
  '(b) [M2] sim precondition: the run whose implementer writes nothing adopts a GREEN ' +
  'candidate — the epoch merged with no `suite.unattributed`; got ' + JSON.stringify(S2.merge))
assert.equal(Boolean(S2.merge && S2.merge.suite), false,
  '(b) [M2] sim precondition: and that epoch records no unattributed suite at all; got ' +
  JSON.stringify(S2.merge))
assert.deepEqual(S2.rows, [],
  '(b) [M2] a run whose implementer writes nothing (the candidate\'s suite is green) leaves ' +
  'ZERO `jev:suite-red` rows; got ' + JSON.stringify(S2.rows))
assert.equal(S2.redRequests.length, 0,
  '(b) [M2] and zero recorded `jev:suite-red` requests — a green fold asks Jev nothing about ' +
  'the suite; got ' + S2.redRequests.length + ': ' +
  JSON.stringify(S2.redRequests.map((r) => Object.keys((r.body || {}).questions || {}))))

assert.ok(S3.labels.includes('reconcile:wave1:1'),
  '(b) [M2] a run whose task `A` lists `files: [\'fA.txt\', \'' + RED_PATH + '\']` — the red ' +
  'path CLAIMED — dispatches a `reconcile:wave1:1` worker: the reconcile route, not the ' +
  'unattributed one; got ' + JSON.stringify(S3.labels))
assert.deepEqual(S3.rows, [],
  '(b) [M2] and leaves zero `jev:suite-red` rows — the row is the unattributed branch\'s ' +
  'alone; got ' + JSON.stringify(S3.rows))
assert.equal(S3.redRequests.length, 0,
  '(b) [M2] and zero recorded `jev:suite-red` requests; got ' + S3.redRequests.length + ': ' +
  JSON.stringify(S3.redRequests.map((r) => Object.keys((r.body || {}).questions || {}))))

assert.deepEqual(S4.rows, [],
  '(b) [M2] a loud-red run whose `fetchImpl` answers status 500 — `ask` resolves `null` — ' +
  'leaves zero `jev:suite-red` rows; got ' + JSON.stringify(S4.rows) + ' | jev log lines: ' +
  JSON.stringify(S4.jevLogs))
assert.equal(S4.merge && S4.merge.status, 'MERGED',
  '(b) [M2] and the epoch is `MERGED` regardless — a refused call costs the row and nothing ' +
  'else; got ' + JSON.stringify(S4.merge))

assert.deepEqual(S5.rows, [],
  '(b) [M2] and the loud-red run handed NO `jev` leaves zero `jev:suite-red` rows; got ' +
  JSON.stringify(S5.rows))

// ══════════════════════════════════════════════════════════════════════════
// (c) [M3] with `jev` and without: the same fold, the same tree
// ══════════════════════════════════════════════════════════════════════════

assert.ok(S5.merge && S5.merge.suite && Array.isArray(S5.merge.suite.unattributed),
  '(c) [M3] sim precondition: the without-`jev` run took the same unattributed-red branch; ' +
  'got ' + JSON.stringify(S5.merge))
assert.equal(S1.merge.status, 'MERGED',
  '(c) [M3] the run with `jev` ends the epoch `MERGED`; got ' + JSON.stringify(S1.merge.status))
assert.equal(S5.merge.status, S1.merge.status,
  '(c) [M3] and the run without it ends the epoch at the same status; got ' +
  JSON.stringify(S5.merge.status) + ' against ' + JSON.stringify(S1.merge.status))
assert.equal(S1.merge.suite.passed, false,
  '(c) [M3] with `suite.passed` `false`; got ' + JSON.stringify(S1.merge.suite.passed))
assert.equal(S5.merge.suite.passed, S1.merge.suite.passed,
  '(c) [M3] in both; got ' + JSON.stringify(S5.merge.suite.passed) + ' against ' +
  JSON.stringify(S1.merge.suite.passed))
assert.deepEqual(S5.merge.suite.unattributed, S1.merge.suite.unattributed,
  '(c) [M3] and the same `suite.unattributed`; got ' +
  JSON.stringify(S5.merge.suite.unattributed) + ' against ' +
  JSON.stringify(S1.merge.suite.unattributed))

const redJudgments = (s) => s.judgments.filter((c) => c.startsWith('unattributed red:'))
assert.deepEqual(redJudgments(S1),
  ['unattributed red: ' + RED_PATH + ' went red on wave 1\'s fold; no task names it'],
  '(c) [M3] the run with `jev` pushes BASE\'s own `unattributed red:` judgment line, one per ' +
  'path, unchanged; got ' + JSON.stringify(redJudgments(S1)))
assert.deepEqual(redJudgments(S5), redJudgments(S1),
  '(c) [M3] and the run without it pushes the same lines; got ' +
  JSON.stringify(redJudgments(S5)) + ' against ' + JSON.stringify(redJudgments(S1)))

for (const s of [S1, S5]) {
  assert.deepEqual(s.labels.filter((l) => l.startsWith('reconcile:')), [],
    '(c) [M3] neither run dispatches a `reconcile:` worker — the unattributed red is adopted ' +
    'and recorded, never reconciled. The ' + (s === S1 ? 'with-`jev`' : 'without-`jev`') +
    ' run dispatched: ' + JSON.stringify(s.labels))
}

assert.deepEqual(treeAt(S5.integ), treeAt(S1.integ),
  '(c) [M3] and the integration clone\'s HEAD carries the same files in both runs — the row ' +
  'is beside the fold, never in it; got ' + JSON.stringify(treeAt(S5.integ)) + ' against ' +
  JSON.stringify(treeAt(S1.integ)))

console.log('ok - jev:suite-red: the row, the four silences, and the fold that does not change')
// The sentinel the bridge and the suite's `Run:` line read, printed only if
// every assertion above held.
console.log('ALL TESTS PASSED')
