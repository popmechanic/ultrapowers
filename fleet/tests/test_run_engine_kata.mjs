// fleet/tests/exams/run_109/test_run_engine_kata.mjs — the exam for Task 5's
// M2 through M8: the engine reads each task's fact sheet from the hub, and
// writes the run's record back there.
//
// This file is the Proof's `Test: fleet/tests/test_run_engine_kata.mjs`,
// written at the landing its EXAM PATHS line names. Every relative import is
// written for THIS directory: `../../../` is the repository root's `fleet/`,
// `../../` is `fleet/tests/`.
//
// Everything below the agent seam is real, as in the sibling engine sims: real
// git repositories, real `cloneAtBase` clones, the real capture, the real `sh`,
// the real fold kernel through the real `execSeam`. Only the judgments are
// canned — and `kata`, which is the seam this task adds. The rig is a COPY of
// `_engine_helpers.rig`'s body with one addition (`kata` passed through to
// `runEngine`), because that helper is not in this task's Files.
//
// The legs, and where each is asserted:
//   (b) [M2] `--kata` in `FLAGS` and `usage()`; `runMain` builds the client and
//            hands it over beside `args.kataRecord`; an unreadable file is
//            `kata-unreadable` before provisioning and dispatches no engine;
//            without the flag nothing changes; and `filesFor` answers the
//            sheet's `files` once the engine has set one.
//   (c) [M3] one `getIssue` then one `claim` before any worker; the sheet's
//            `files`, `proofTests`, `guards`, `landing` and `driverOwned` drive
//            the prompts, the handoff and the branch; a stale recorded revision
//            ends the run and claims nothing.
//   (d) [M4] `patchMetadata` at the handoff re-capture and again after the fix
//            round, each with the revision the last answer carried; a 412 is a
//            `kata:write-failed` event and the run goes on.
//   (e) [M5] one `comment` per `driver:*` event, in append order, body for
//            body, on the task's issue or the run's; drained before the close;
//            a throwing post is a `kata:write-failed` event and the run goes on.
//   (f) [M6] the four close shapes: MERGED `done`, TEST_FAILED `wontfix`, a row
//            that is not `done` `wontfix`, and a task of a `SKIPPED` wave left
//            open.
//   (g) [M7] with no `kata` the engine makes no request and behaves as at BASE.
//   (h) [M8] the CONTRACT.md bullet, directly before `- **status.json:**`.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { examSlug, reservedExamPath } from '../exam-paths.mjs'
import { execSeam, parseArgs, usage, runMain } from '../run-main.mjs'
import { makeCwdFor, withPatchCapture, defaultTaskIdOf } from '../run-waves.mjs'
import { runEngine } from '../run-engine.mjs'
import { ENV, gitSync, makeRepo, provision, passReview, cleanCritic, doneImpl }
  from './_engine_helpers.mjs'

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'engine-kata-')))
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }))
const mkdir = (p) => { fs.mkdirSync(p, { recursive: true }); return p }

// ── reading what a run left behind ─────────────────────────────────────────
// An absent events file reads as no records, so an engine that writes none
// fails an assertion rather than throwing ENOENT.
const eventLines = (runDir) => {
  const file = path.join(runDir, 'events.jsonl')
  if (!fs.existsSync(file)) return []
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
}
const parseLine = (l) => { try { return JSON.parse(l) } catch { return null } }
const eventsOf = (runDir) => eventLines(runDir).map(parseLine).filter(Boolean)
const driverLines = (runDir) =>
  eventLines(runDir).filter((l) => {
    const e = parseLine(l)
    return Boolean(e && typeof e.kind === 'string' && e.kind.startsWith('driver:'))
  })
/** Every path a ref's tree holds. */
const treePaths = (cwd, ref) => {
  try {
    return execFileSync('git', ['ls-tree', '-r', '--name-only', ref],
      { cwd, env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
      .split('\n').filter(Boolean)
  } catch (e) {
    return ['ABSENT: ' + String((e && e.message) || e)]
  }
}
/** Every line of a prompt that opens with a marker. */
const linesStarting = (text, marker) =>
  String(text).split('\n').filter((l) => l.startsWith(marker))
/** Where the nth comment call sits in the shared trace (-1 if there is none). */
const traceIndexOfComment = (trace, nth) => {
  let seen = -1
  for (let i = 0; i < trace.length; i += 1) {
    if (trace[i].startsWith('kata:comment:')) { seen += 1; if (seen === nth) return i }
  }
  return -1
}

// ══ the fixtures the sheet legs are built on ═══════════════════════════════
// The record `fleet/launch.mjs` writes (task 4's shape): the project, the run
// issue, and one issue per task with the revision the launcher last saw.
const recordFor = (tasks) => ({
  url: 'https://kata.int.exe.xyz',
  project: { id: 7, uid: 'PROJ0', name: 'ultra-sim' },
  run: { uid: 'RUN0', revision: 1 },
  tasks,
})

// The sheet leg (c) names, verbatim. Its landing for `tests/test_x.py` is one
// `reservedExamPath` would never answer for stamp `sim`, and `tests/test_y.py`
// is a guarded path it WOULD have moved — so a pipeline that recomputed either
// lands somewhere this exam can see.
const SHEET = {
  files: ['one.txt', 'extra.txt'],
  proofTests: ['tests/test_x.py', 'tests/test_y.py'],
  guards: ['tests/test_y.py'],
  landing: {
    'tests/test_x.py': 'tests/exams/custom/test_x.py',
    'tests/test_y.py': 'tests/test_y.py',
  },
  driverOwned: [
    'tests/exams/custom/__init__.py',
    'tests/exams/custom/test_x.py',
    'tests/test_y.py',
  ],
}
// The fixture is only a fixture if the sheet disagrees with the computation it
// replaces: assert that here rather than trusting the two strings to differ.
assert.equal(reservedExamPath('tests/test_x.py', 'sim'), 'tests/exams/sim/test_x.py',
  'fixture: for stamp `sim`, reservedExamPath sends tests/test_x.py to tests/exams/sim/')
assert.notEqual(SHEET.landing['tests/test_x.py'], reservedExamPath('tests/test_x.py', 'sim'),
  'fixture: the sheet\'s landing is NOT what reservedExamPath would compute')
assert.notEqual(SHEET.landing['tests/test_y.py'], reservedExamPath('tests/test_y.py', 'sim'),
  'fixture: the guarded path is one reservedExamPath would have moved')

// The args entry the compiler produced: narrower than the sheet on every field
// the sheet replaces, so an engine that reads the entry instead of the sheet is
// visible in the prompts and on the branch.
const TASK_BODY = '**Claim:** the tree gains one.txt\n' +
  'Machine: M1. The tree holds `one.txt`.\n\n**Proof:**\n- Test: `tests/test_x.py`\n' +
  '- Legs: (a) `one.txt` exists [M1]'
const entry = (over = {}) => {
  const task = {
    id: 'T1', title: 'create one', files: ['one.txt'], tier: 'standard', review: 'lean',
    writes: ['one.txt'], commutes: [], proofRuns: [],
    testCmd: 'bash tests/test_x.py && bash tests/test_y.py',
    proofTests: ['tests/test_x.py'],
    body: TASK_BODY,
    ...over,
  }
  for (const k of Object.keys(task)) if (task[k] === undefined) delete task[k]
  return task
}

// The exam the peer writes: red at BASE, green once `one.txt` exists. Bash, so
// the `.py` landing runs without a python on the box.
const RED_AT_BASE = '#!/bin/bash\n[ -f one.txt ]\n'

// ══ the fake kata ══════════════════════════════════════════════════════════
// An in-memory object with the client's method names: a store of issues by uid,
// a `calls` array in order, `getIssue` answering the stored revision, and
// `claim`/`patchMetadata`/`comment`/`close` bumping the revision and answering
// it. Every call also lands in a shared `trace` beside the worker labels, so
// the ordering legs read one list.
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
const COMMENT_BOOM = 'kata-comment-boom'

function makeFakeKata ({ record, issues, trace = [], always412 = false, commentThrows = false }) {
  const calls = []
  const store = new Map()
  for (const [uid, iss] of Object.entries(issues)) {
    store.set(uid, { uid, revision: iss.revision, metadata: iss.metadata || {},
                     owner: null, status: 'open' })
  }
  // The revision the LAST answer for an issue carried — what M4's patch must
  // send as its `If-Match`.
  const lastAnswered = new Map()
  const answer = (uid, revision) => { lastAnswered.set(uid, revision); return revision }
  const need = (uid) => {
    const iss = store.get(uid)
    if (!iss) throw new Error('fake kata: no issue ' + JSON.stringify(uid) +
      ' — the run asked for an issue the record does not name')
    return iss
  }
  let commentsThrown = 0
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
    async patchMetadata (projectId, uid, patch, revision) {
      const iss = need(uid)
      const expected = lastAnswered.has(uid) ? lastAnswered.get(uid) : null
      calls.push({ method: 'patchMetadata', projectId, uid, patch, revision,
                   expectedRevision: expected })
      trace.push('kata:patchMetadata:' + uid)
      if (always412) {
        throw new FakeKataError(412, 'POST',
          '/api/v1/projects/' + projectId + '/issues/' + uid + '/metadata',
          '{"status":412,"error":{"message":"revision mismatch"}}')
      }
      iss.metadata = { ...iss.metadata, ...patch }
      iss.revision += 1
      return { uid, revision: answer(uid, iss.revision) }
    },
    async comment (projectId, uid, body) {
      calls.push({ method: 'comment', projectId, uid, body })
      trace.push('kata:comment:' + uid)
      if (commentThrows && commentsThrown === 0) {
        commentsThrown += 1
        throw new FakeKataError(500, 'POST',
          '/api/v1/projects/' + projectId + '/issues/' + uid + '/comments', COMMENT_BOOM)
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
// Files) with one addition: `kata` is passed through to `runEngine` when the
// scenario supplies one, and nothing is passed when it does not — which is the
// BASE call, byte for byte, for leg (g).
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

// ── the worker stubs ───────────────────────────────────────────────────────
// The examiner is NOT told where to write: it reads the paths out of the
// `TEST COMMAND` line the driver built, which is what the model does — a stub
// that wrote the paths this file already knows would prove nothing.
const examPathsIn = (prompt) => {
  const line = linesStarting(prompt, 'TEST COMMAND: ')[0] || ''
  return (line.match(/(?:fleet\/)?tests\/[\w./-]+/g) || [])
}
const writeExamFromCommand = (cwd, prompt) => {
  const wrote = []
  for (const p of examPathsIn(prompt)) {
    const dest = path.resolve(cwd, p)
    mkdir(path.dirname(dest))
    fs.writeFileSync(dest, RED_AT_BASE)
    wrote.push(p)
  }
  assert.ok(wrote.length > 0,
    '(c) [M3] the examiner was handed a TEST COMMAND naming at least one test path; got: ' +
    JSON.stringify(linesStarting(prompt, 'TEST COMMAND: ')))
  return { status: 'DONE', summary: 'exam written at ' + wrote.join(', ') }
}

let seq = 0
/**
 * One engine run with a fake kata behind it. Answers the report (or the error),
 * the fake's calls, the shared trace, the prompts by label and the run tree.
 */
async function scenario ({ waves, sheets, recordRevisions, stamp = 'sim', testCmd,
                           onImpl, onFix, reviews, always412 = false, commentThrows = false,
                           edges = [], noKata = false, expectReject = false }) {
  seq += 1
  const repo = makeRepo(path.join(tmp, 'repo-' + seq))
  const runDir = path.join(tmp, 'run-' + seq)
  const ids = waves.flat().map((t) => t.id)
  const record = recordFor(Object.fromEntries(ids.map((id) => [id,
    { uid: 'U-' + id, revision: (recordRevisions && recordRevisions[id]) || 1 }])))
  const issues = { RUN0: { revision: 1, metadata: {} } }
  for (const id of ids) {
    issues['U-' + id] = { revision: (recordRevisions && recordRevisions['store:' + id]) || 1,
                          metadata: (sheets && sheets[id]) ? { factsheet: sheets[id] } : {} }
  }
  const trace = []
  const fake = makeFakeKata({ record, issues, trace, always412, commentThrows })
  const labels = []
  const prompts = {}
  let reviewCount = 0
  const stub = async (prompt, opts, cwd) => {
    labels.push(opts.label)
    prompts[opts.label] = prompt
    trace.push('agent:' + opts.label)
    const kind = opts.label.split(':')[0]
    if (kind === 'exam') return writeExamFromCommand(cwd, prompt)
    if (kind === 'impl') return onImpl(cwd, opts)
    if (kind === 'fix') return (onFix || ((c) => doneImpl(c)))(cwd, opts)
    if (kind === 'review') { reviewCount += 1; return (reviews || passReview)(reviewCount) }
    if (kind === 'reconcile') return { status: 'BLOCKED', summary: 'not fixable here' }
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const rigged = kataRig({
    repo, runDir, waves, edges, stub, stamp,
    ...(testCmd ? { testCmd } : {}),
    ...(noKata ? {} : { kata: fake.kata, extraArgs: { kataRecord: record } }),
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
  return { report, error, fake, record, trace, labels, prompts, runDir, repo,
           integ: rigged.integ, base: rigged.base, logs: rigged.logs,
           branch: 'ultra/integration-' + stamp }
}

// ══ (b) [M2] the flag, the client, and the record ══════════════════════════
{
  // The flag-to-arg map. `parseArgs` REFUSES an unknown flag at BASE, so the
  // failure here names the leg rather than escaping as an unhandled throw.
  let parsed = null
  try {
    parsed = parseArgs(['p.md', 'run-7', '--repo', 'd', '--kata', 'k.json'])
  } catch (e) {
    assert.fail('(b) [M2] fleet/run-main.mjs accepts --kata <path> (in FLAGS): ' +
      'parseArgs(["p.md","run-7","--repo","d","--kata","k.json"]) threw — ' +
      String((e && e.message) || e))
  }
  assert.equal(parsed.kata, 'k.json',
    '(b) [M2] --kata k.json yields .kata === "k.json"')
  assert.equal(parsed.repoDir, 'd', '(b) [M2] --repo still parses beside it')
  assert.equal(parsed.runId, 'run-7', '(b) [M2] and the positional runId is unchanged')
  assert.ok(String(usage()).includes('--kata'),
    '(b) [M2] usage() spells --kata (got: ' + usage() + ')')

  const noFlag = parseArgs(['p.md', 'run-7', '--repo', 'd'])
  assert.equal(noFlag.kata, undefined,
    '(b) [M2] without the flag there is no kata path; got ' + JSON.stringify(noFlag.kata))
}

// The runMain flow, driven exactly as `test_run_main_effort.mjs` and
// `test_run_main_engine_dir.mjs` drive it: a fake `exec` playing the python
// scripts and a fake `runEngineFn` that records what it was handed.
const RUNMAIN_WAVES = () => [[
  { id: 'T1', title: 't1', files: ['a.txt'], tier: null, review: 'lean',
    writes: ['a.txt'], commutes: [] },
]]
async function runMainFlow ({ name, kataPath }) {
  const target = mkdir(path.join(tmp, 'rm-' + name))
  const git = (argv, cwd) => execFileSync('git', argv,
    { cwd, env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  git(['init', '-q', '-b', 'fleet-base'], target)
  git(['config', 'user.email', 't@example.com'], target)
  git(['config', 'user.name', 't'], target)
  fs.writeFileSync(path.join(target, 'a.txt'), 'base\n')
  git(['add', '-A'], target)
  git(['commit', '-q', '-m', 'base'], target)

  const runId = 'run-' + name
  const planPath = path.join(target, 'plan.md')
  fs.writeFileSync(planPath, '# plan\n')
  const runDir = path.join(target, '.claude/ultrapowers', 'run-' + runId)
  const argsFile = path.join(runDir, 'args.json')
  const waves = RUNMAIN_WAVES()
  const exec = async (cmd, argv, opts = {}) => {
    if (cmd === 'git') {
      try {
        return { code: 0, stdout: execFileSync('git', argv,
          { cwd: opts.cwd, env: ENV, encoding: 'utf8' }), stderr: '' }
      } catch (e) {
        return { code: 1, stdout: '', stderr: String((e && (e.stderr || e.message)) || e) }
      }
    }
    if (cmd === 'claude' && argv[0] === 'auth') {
      return { code: 0, stdout: JSON.stringify({ authMethod: 'oauth', subscriptionType: 'max' }),
               stderr: '' }
    }
    const script = path.basename(argv[0])
    if (script === 'ultra_run.py' && argv.includes('--validate-knobs')) {
      return { code: 0, stdout: '{"ok": true}', stderr: '' }
    }
    if (script === 'ultra_run.py') {
      mkdir(runDir)
      fs.writeFileSync(argsFile, JSON.stringify({
        waves, wavesPath: path.join(runDir, 'launch.json'),
        edges: [], acceptance: { mode: 'suite' }, waveLabels: ['w1'],
        globalConstraints: '', planPath: argv[1],
        pluginRoot: target, runDir, testCmd: 'true',
      }, null, 2))
      const receipt = { ok: true, baseBranch: 'fleet-base', argsFile, testCmd: 'true' }
      fs.writeFileSync(path.join(runDir, 'receipt.json'), JSON.stringify(receipt))
      return { code: 0, stdout: JSON.stringify(receipt), stderr: '' }
    }
    if (script === 'finalize_report.py') return { code: 0, stdout: '', stderr: '' }
    if (script === 'ultra_gate.py' && argv.includes('--approve')) {
      return { code: 0, stdout: JSON.stringify({ mode: 'suite', stamp: runId }), stderr: '' }
    }
    if (script === 'ultra_gate.py') {
      fs.writeFileSync(path.join(runDir, 'gate-receipt.json'), JSON.stringify({
        verdict: 'PASS', gateCheck: { verdict: 'PASS', checks: [], acks: [] }, gateCheckExit: 0,
      }))
      return { code: 0, stdout: '', stderr: '' }
    }
    throw new Error('exec stub: unexpected ' + cmd + ' ' + argv.join(' '))
  }
  let received = null
  let filesFor = null
  const out = await runMain(
    { planPath, runId, repoDir: target, tier: 'mostCapable', overlap: null, testCmd: null,
      bootstrapCmd: null, cli: 'claude', ...(kataPath === undefined ? {} : { kata: kataPath }) },
    {
      exec,
      log: () => {},
      runEngineFn: async (deps) => {
        received = deps
        return { integrationBranch: 'ultra/integration-' + runId, waveMerges: [], tasks: [] }
      },
      makeAgent: (opts) => {
        filesFor = opts.filesFor
        return { agent: async () => null, patchInput: opts.patchesDir }
      },
    },
  )
  return { out, received, filesFor: () => filesFor, runDir, target }
}

// ── (b) [M2] with --kata: the client and the record reach the engine ───────
{
  const kataFile = path.join(tmp, 'kata-ok.json')
  const record = recordFor({ T1: { uid: 'U-T1', revision: 3 } })
  fs.writeFileSync(kataFile, JSON.stringify(record, null, 2))
  const { out, received, filesFor } = await runMainFlow({ name: 'ok', kataPath: kataFile })
  assert.equal(out.code, 0,
    '(b) [M2] the flow with --kata is green — ' + out.verdict + ': ' + out.detail)
  assert.ok(received, '(b) [M2] runEngineFn was called')
  assert.ok(received.kata && typeof received.kata === 'object',
    '(b) [M2] runEngineFn receives `kata` — the client built from the record\'s url; got ' +
    JSON.stringify(received.kata))
  assert.equal(typeof received.kata.getIssue, 'function',
    '(b) [M2] and it is a client: an object with a getIssue function (keys seen: ' +
    Object.keys(received.kata || {}).join(', ') + ')')
  assert.deepEqual(received.args.kataRecord, record,
    '(b) [M2] and `args.kataRecord` is the parsed file, deep-equal')

  // M2's last clause: the capture's drop rule follows the sheet once the engine
  // has set one. Before the engine sets a factsheet the compiled `files` is the
  // answer; after, the sheet's.
  const task = received.args.waves[0][0]
  assert.deepEqual(filesFor()({ label: 'impl:T1' }), ['a.txt'],
    '(b) [M2] filesFor answers the compiled `files` while the task has no sheet')
  task.factsheet = { files: ['a.txt', 'sheet-only.txt'] }
  task.files = task.factsheet.files
  assert.deepEqual(filesFor()({ label: 'impl:T1' }), ['a.txt', 'sheet-only.txt'],
    '(b) [M2] and answers `factsheet.files` once the engine has set it — the scope the ' +
    'implementer was told and the scope the capture keeps are one fact')
}

// ── (b) [M2] an unreadable kata file: refused before provisioning ──────────
{
  const bad = path.join(tmp, 'kata-bad.json')
  fs.writeFileSync(bad, 'not json')
  const { out, received, runDir } = await runMainFlow({ name: 'bad', kataPath: bad })
  assert.equal(out.code, 1, '(b) [M2] a malformed kata file fails the run')
  assert.equal(out.verdict, 'kata-unreadable',
    '(b) [M2] with verdict kata-unreadable; got ' + JSON.stringify(out.verdict) +
    ' (' + out.detail + ')')
  assert.equal(received, null, '(b) [M2] and runEngineFn is never called')
  assert.ok(!fs.existsSync(path.join(runDir, 'clones')),
    '(b) [M2] the refusal lands BEFORE the run tree is provisioned — no clones directory at ' +
    path.join(runDir, 'clones'))
}

// ── (b) [M2] without --kata nothing changes ────────────────────────────────
{
  const { out, received } = await runMainFlow({ name: 'none', kataPath: undefined })
  assert.equal(out.code, 0, '(b) [M2] the flow without --kata is green — ' + out.detail)
  assert.equal(received.kata, undefined,
    '(b) [M2] the engine receives no kata; got ' + JSON.stringify(received.kata))
  assert.equal(received.args.kataRecord, undefined,
    '(b) [M2] and no kataRecord; got ' + JSON.stringify(received.args.kataRecord))
}

// ══ the sheet-driven green run: legs (c), (d), (e) and (f) ═════════════════
const green = await scenario({
  waves: [[entry()]],
  sheets: { T1: SHEET },
  onImpl: (cwd) => {
    fs.writeFileSync(path.join(cwd, 'one.txt'), 'from T1\n')
    fs.writeFileSync(path.join(cwd, 'extra.txt'), 'also from T1\n')
    return doneImpl(cwd)
  },
})
// ── (c) [M3] getIssue, then claim, both before any worker ──────────────────
{
  const { calls } = green.fake
  assert.ok(calls.length >= 2,
    '(c) [M3] the engine, handed a kata client and a record, reads the task\'s issue and ' +
    'claims it; it made no request at all. calls: ' + JSON.stringify(calls.map((c) => c.method)))
  assert.equal(calls[0].method, 'getIssue',
    '(c) [M3] the fake\'s FIRST call is getIssue — the sheet is read at the start of the ' +
    'task\'s pipeline; got ' + calls[0].method)
  assert.equal(calls[0].uid, 'U-T1',
    '(c) [M3] getIssue(record.tasks["T1"].uid) — the uid the record names')
  assert.equal(calls[1].method, 'claim',
    '(c) [M3] and its SECOND is claim; got ' + calls[1].method)
  assert.equal(calls[1].uid, 'U-T1', '(c) [M3] claim on the task\'s issue')
  assert.equal(calls[1].projectId, 7,
    '(c) [M3] claim(project.id, uid) — the record\'s project id')
  assert.equal(green.fake.of('getIssue').length, 1,
    '(c) [M3] exactly ONE getIssue per task — the sheet is never read again')

  const firstWorker = green.trace.findIndex((t) => t.startsWith('agent:'))
  assert.ok(firstWorker !== -1, '(c) [M3] the run dispatched at least one worker')
  assert.ok(green.trace.indexOf('kata:getIssue:U-T1') < firstWorker,
    '(c) [M3] the getIssue precedes the first worker label (' + green.trace[firstWorker] +
    '); trace: ' + JSON.stringify(green.trace.slice(0, 6)))
  assert.ok(green.trace.indexOf('kata:claim:U-T1') < firstWorker,
    '(c) [M3] and so does the claim — the issue is claimed before the implementer and the ' +
    'examiner are dispatched; trace: ' + JSON.stringify(green.trace.slice(0, 6)))
}

const greenRow = green.report.tasks.find((r) => r.task === 'T1')
assert.ok(greenRow, '(c) [M3] the sheet-driven run produced a row for T1')
assert.equal(greenRow.status, 'done',
  '(c) [M3] the sheet-driven run merges: ' + greenRow.reviewVerdict + ' — ' + greenRow.notes +
  '\njudgment calls: ' + JSON.stringify(green.report.judgmentCalls, null, 1))
assert.equal(green.report.waveMerges[0].status, 'MERGED',
  '(c) [M3] and wave 1 is adopted: ' + JSON.stringify(green.report.waveMerges[0]))

// ── (c) [M3] the sheet drives the prompts ──────────────────────────────────
{
  const examPrompt = String(green.prompts['exam:T1'] || '')
  const implPrompt = String(green.prompts['impl:T1'] || '')
  assert.ok(examPrompt, '(c) [M3] an examiner was dispatched (labels: ' +
    JSON.stringify(green.labels) + ')')
  assert.deepEqual(linesStarting(examPrompt, 'EXAM PATHS'),
    ['EXAM PATHS: tests/test_x.py -> tests/exams/custom/test_x.py'],
    '(c) [M3] exactly one EXAM PATHS line, the sheet\'s landing for tests/test_x.py — the ' +
    'guarded tests/test_y.py lands at itself and is announced nowhere')
  assert.deepEqual(linesStarting(examPrompt, 'TEST COMMAND: '),
    ['TEST COMMAND: bash tests/exams/custom/test_x.py && bash tests/test_y.py'],
    '(c) [M3] the exam command is remapped through the sheet\'s landing, naming both ' +
    'tests/exams/custom/test_x.py and tests/test_y.py')
  assert.deepEqual(linesStarting(implPrompt, 'FILES: '), ['FILES: one.txt, extra.txt'],
    '(c) [M3] the implementer\'s FILES line is the sheet\'s `files` — extra.txt is in scope ' +
    'because the sheet says so, and the args entry never said it')
}

// ── (c) [M3] the sheet drives the branch ───────────────────────────────────
{
  const paths = treePaths(green.integ, green.branch)
  for (const p of ['tests/exams/custom/test_x.py', 'tests/exams/custom/__init__.py',
                   'tests/test_y.py', 'one.txt', 'extra.txt']) {
    assert.ok(paths.includes(p),
      '(c) [M3] the adopted tree holds ' + p + ' — the sheet\'s landing and its driverOwned ' +
      'package init; tree: ' + JSON.stringify(paths))
  }
  assert.ok(!paths.includes('tests/test_x.py'),
    '(c) [M3] and nothing at the Proof path tests/test_x.py — it was restored to BASE; tree: ' +
    JSON.stringify(paths))
  assert.deepEqual(paths.filter((p) => p.startsWith('tests/exams/' + examSlug('sim') + '/')), [],
    '(c) [M3] and no tests/exams/sim/ directory at all — reservedExamPath and examSlug are ' +
    'consulted for no task that has a sheet; tree: ' + JSON.stringify(paths))
}

// ── (d) [M4] the touched_files patch at the handoff ────────────────────────
{
  const patches = green.fake.of('patchMetadata')
  assert.equal(patches.length, 1,
    '(d) [M4] the green run records exactly one patchMetadata — the handoff re-capture; got ' +
    JSON.stringify(patches.map((p) => p.patch)))
  const p = patches[0]
  assert.equal(p.uid, 'U-T1', '(d) [M4] on the task\'s issue')
  assert.equal(p.projectId, 7, '(d) [M4] patchMetadata(project.id, uid, …)')
  assert.deepEqual(Object.keys(p.patch), ['touched_files'],
    '(d) [M4] the patch is exactly {touched_files: …}; got ' + JSON.stringify(p.patch))
  assert.ok(Array.isArray(p.patch.touched_files),
    '(d) [M4] touched_files is the patch\'s paths as patchPaths reads them')
  for (const want of ['one.txt', 'tests/exams/custom/test_x.py']) {
    assert.ok(p.patch.touched_files.includes(want),
      '(d) [M4] touched_files names ' + want + ' — the graded patch carries the implementer\'s ' +
      'work AND the exam handed over at its landing; got ' +
      JSON.stringify(p.patch.touched_files))
  }
  assert.equal(p.revision, p.expectedRevision,
    '(d) [M4] the patch sends the revision the LAST answer for that issue carried (' +
    p.expectedRevision + ') — the claim already moved it; got ' + JSON.stringify(p.revision))

  // Placed after the handoff comment and before any referee.
  const kinds = green.fake.of('comment').map((c) => (parseLine(c.body) || {}).kind)
  const handoffAt = kinds.indexOf('driver:exam-handoff')
  assert.notEqual(handoffAt, -1,
    '(d) [M4] the driver:exam-handoff event was commented; kinds: ' + JSON.stringify(kinds))
  const patchAt = green.trace.indexOf('kata:patchMetadata:U-T1')
  const handoffTraceAt = traceIndexOfComment(green.trace, handoffAt)
  assert.ok(handoffTraceAt !== -1 && handoffTraceAt < patchAt,
    '(d) [M4] the patch is placed AFTER the driver:exam-handoff comment; trace: ' +
    JSON.stringify(green.trace))
  const firstReview = green.trace.findIndex((t) => t.startsWith('agent:review:'))
  assert.ok(firstReview !== -1, '(d) [M4] a referee was dispatched')
  assert.ok(patchAt < firstReview,
    '(d) [M4] and BEFORE any review: label — the hub has the touched files before the driver ' +
    'takes its next step; trace: ' + JSON.stringify(green.trace))
}

// ── (e) [M5] one comment per driver:* event, in append order ───────────────
{
  const lines = driverLines(green.runDir)
  const comments = green.fake.of('comment')
  assert.ok(lines.length >= 3,
    '(e) [M5] the run appended several driver:* events (found ' + lines.length + ') — a run ' +
    'that appended none would prove nothing')
  assert.equal(comments.length, lines.length,
    '(e) [M5] one comment per driver:* event: ' + lines.length + ' events, ' +
    comments.length + ' comments (kinds appended: ' +
    JSON.stringify(lines.map((l) => (parseLine(l) || {}).kind)) + ', kinds posted: ' +
    JSON.stringify(comments.map((c) => (parseLine(c.body) || {}).kind)) + ')')
  for (let i = 0; i < lines.length; i += 1) {
    const ev = parseLine(lines[i])
    assert.equal(comments[i].body, lines[i],
      '(e) [M5] comment #' + i + ' carries the event\'s JSON LINE as its body, verbatim and ' +
      'in append order (expected the ' + ev.kind + ' line)')
    const wantUid = (typeof ev.task === 'string' && green.record.tasks[ev.task])
      ? green.record.tasks[ev.task].uid : green.record.run.uid
    assert.equal(comments[i].uid, wantUid,
      '(e) [M5] ' + ev.kind + (ev.task ? ' carries task ' + ev.task + ' → the task\'s issue'
        : ' carries no task → the run issue') + ' (expected ' + wantUid + ')')
    assert.equal(comments[i].projectId, 7, '(e) [M5] comment(project.id, uid, body)')
  }

  // M5's drain rule, read where it bites: the event the barrier appended is on
  // the hub before the close the barrier makes.
  const adoptedAt = comments.findIndex((c) =>
    (parseLine(c.body) || {}).kind === 'driver:wave-adopted')
  assert.notEqual(adoptedAt, -1,
    '(e) [M5] the driver:wave-adopted event was commented; kinds: ' +
    JSON.stringify(comments.map((c) => (parseLine(c.body) || {}).kind)))
  const adoptedTraceAt = traceIndexOfComment(green.trace, adoptedAt)
  const firstCloseAt = green.trace.findIndex((t) => t.startsWith('kata:close:'))
  assert.ok(firstCloseAt !== -1, '(e) [M5] the run closed something')
  assert.ok(adoptedTraceAt !== -1 && adoptedTraceAt < firstCloseAt,
    '(e) [M5] every pending post is awaited BEFORE the close — the run issue\'s last comment ' +
    'is on the hub first; trace: ' + JSON.stringify(green.trace))
}

// ── (f) [M6] the MERGED close ──────────────────────────────────────────────
{
  const closes = green.fake.of('close')
  assert.equal(closes.length, 1,
    '(f) [M6] the green run closes exactly the one task it merged; got ' +
    JSON.stringify(closes.map((c) => [c.uid, c.opts && c.opts.reason])))
  const c = closes[0]
  assert.equal(c.uid, 'U-T1', '(f) [M6] on the task\'s issue')
  assert.equal(c.projectId, 7, '(f) [M6] close(project.id, uid, …)')
  assert.equal(c.opts.reason, 'done',
    '(f) [M6] a MERGED wave closes its mergeable rows with reason `done`')
  assert.ok(c.opts.message.startsWith('adopted in wave 1 (' + greenRow.reviewVerdict + '): ') &&
    c.opts.message.includes(' — merged ' + green.report.waveMerges[0].headSha) &&
    c.opts.message.length >= 40,
    '(f) [M6] message `adopted in wave 1 (<its reviewVerdict>): <title> — merged <sha>` (kata ' +
    'refuses a done close under 40 chars); got ' + JSON.stringify(c.opts.message))
  assert.deepEqual(c.opts.evidence, [
    { type: 'commit', sha: green.report.waveMerges[0].headSha },
    { type: 'test', command: entry().testCmd },
  ], '(f) [M6] evidence is the adopted headSha and the task\'s OWN testCmd — `done` needs at ' +
     'least one evidence item and these are the two M6 names')
  assert.equal(c.opts.idempotencyKey, 'sim:T1:close',
    '(f) [M6] idempotencyKey `<runId>:<task id>:close` — the run id is the stamp')
}

// ══ (c) [M3] a stale recorded revision ends the run ════════════════════════
{
  const bad = await scenario({
    waves: [[entry()]],
    sheets: { T1: SHEET },
    // The record remembers revision 1; the hub answers 2.
    recordRevisions: { T1: 1, 'store:T1': 2 },
    onImpl: (cwd) => doneImpl(cwd),
    expectReject: true,
  })
  assert.ok(bad.error,
    '(c) [M3] a revision unequal to the recorded one ENDS the run; it finished instead: ' +
    JSON.stringify(bad.report && bad.report.tasks))
  const msg = String((bad.error && bad.error.message) || bad.error)
  assert.ok(msg.includes('kata-revision-mismatch task T1: recorded 1 found 2'),
    '(c) [M3] with `run-engine: kata-revision-mismatch task <id>: recorded <r> found <r2>`; ' +
    'got: ' + msg)
  assert.deepEqual(bad.fake.of('claim'), [],
    '(c) [M3] and nothing is claimed — the run ends before the dispatch')
}

// ══ (d) [M4] a fix round records a second patch ════════════════════════════
{
  const fixed = await scenario({
    waves: [[entry()]],
    sheets: { T1: SHEET },
    onImpl: (cwd) => {
      fs.writeFileSync(path.join(cwd, 'one.txt'), 'from T1\n')
      fs.writeFileSync(path.join(cwd, 'extra.txt'), 'also from T1\n')
      return doneImpl(cwd)
    },
    onFix: (cwd) => {
      fs.writeFileSync(path.join(cwd, 'fixed.txt'), 'the fix round\n')
      return doneImpl(cwd)
    },
    reviews: (n) => (n === 1
      ? { verdict: 'FIX_REQUIRED', issues: [{ severity: 'blocking', detail: 'v1 is wrong' }] }
      : passReview()),
  })
  const row = fixed.report.tasks.find((r) => r.task === 'T1')
  assert.equal(row.status, 'done',
    '(d) [M4] the fix-round run merges: ' + row.reviewVerdict + ' — ' + row.notes)
  assert.ok(fixed.labels.some((l) => l === 'fix:T1:1'),
    '(d) [M4] one fix round ran; labels: ' + JSON.stringify(fixed.labels))
  const patches = fixed.fake.of('patchMetadata')
  assert.equal(patches.length, 2,
    '(d) [M4] a run with one fix round records TWO patchMetadata calls — the handoff\'s and ' +
    'the fix round\'s; got ' + patches.length + ': ' +
    JSON.stringify(patches.map((p) => p.patch)))
  assert.ok(patches[1].patch.touched_files.includes('fixed.txt'),
    '(d) [M4] the second carries the fix round\'s paths; got ' +
    JSON.stringify(patches[1].patch.touched_files))
  assert.equal(patches[1].revision, patches[1].expectedRevision,
    '(d) [M4] and the LATER revision — the one the last answer for that issue carried (' +
    patches[1].expectedRevision + '), not the one the claim answered; got ' +
    JSON.stringify(patches[1].revision))
  assert.notEqual(patches[1].revision, patches[0].revision,
    '(d) [M4] which is not the first patch\'s revision: every answer in between moved it')
}

// ══ (d) [M4] a 412 at the patch is recorded, not fatal ═════════════════════
{
  const stale = await scenario({
    waves: [[entry()]],
    sheets: { T1: SHEET },
    always412: true,
    onImpl: (cwd) => {
      fs.writeFileSync(path.join(cwd, 'one.txt'), 'from T1\n')
      fs.writeFileSync(path.join(cwd, 'extra.txt'), 'also from T1\n')
      return doneImpl(cwd)
    },
  })
  assert.ok(!stale.error, '(d) [M4] a 412 at the metadata patch no longer ends the run; threw: ' +
    String((stale.error && stale.error.message) || stale.error))
  const row = stale.report.tasks.find((r) => r.task === 'T1')
  assert.equal(row.status, 'done', '(d) [M4] the task still lands: ' + JSON.stringify(row))
  const failed = eventsOf(stale.runDir).filter((e) => e.kind === 'kata:write-failed')
  assert.ok(failed.length >= 1 && failed.every((e) => e.what === 'metadata' && e.status === 412),
    '(d) [M4] every refused patch is one kata:write-failed event with status 412; got ' +
    JSON.stringify(failed))
}

// ══ (e) [M5] a post that throws is recorded, not fatal ═════════════════════
{
  const boom = await scenario({
    waves: [[entry()]],
    sheets: { T1: SHEET },
    commentThrows: true,
    onImpl: (cwd) => {
      fs.writeFileSync(path.join(cwd, 'one.txt'), 'from T1\n')
      fs.writeFileSync(path.join(cwd, 'extra.txt'), 'also from T1\n')
      return doneImpl(cwd)
    },
  })
  assert.ok(!boom.error, '(e) [M5] a comment that throws once no longer ends the run; threw: ' +
    String((boom.error && boom.error.message) || boom.error))
  const failed = eventsOf(boom.runDir).filter((e) => e.kind === 'kata:write-failed')
  assert.equal(failed.length, 1, '(e) [M5] exactly one kata:write-failed event for the one throw; got ' +
    JSON.stringify(failed))
  assert.ok(String(failed[0].detail).includes(COMMENT_BOOM),
    '(e) [M5] carrying the KataError\'s message; got ' + failed[0].detail)
  assert.equal(boom.report.tasks.find((r) => r.task === 'T1').status, 'done',
    '(e) [M5] and the task still lands')
}

// ══ (f) [M6] a blocked wave: wontfix here, nothing for the wave after ══════
{
  const t1 = { id: 'T1', title: 'breaks the suite', files: ['T1.txt'], tier: 'standard',
               review: 'lean', writes: ['T1.txt'], commutes: [], proofRuns: [], body: 'task T1' }
  const t2 = { id: 'T2', title: 'later', files: ['T2.txt'], tier: 'standard', review: 'lean',
               writes: ['T2.txt'], commutes: [], proofRuns: [], body: 'task T2' }
  const flat = (files) => ({ files, proofTests: [], guards: [], landing: {}, driverOwned: [] })
  const blocked = await scenario({
    waves: [[t1], [t2]],
    sheets: { T1: flat(['T1.txt']), T2: flat(['T2.txt']) },
    stamp: 'blk',
    onImpl: (cwd, opts) => {
      fs.writeFileSync(path.join(cwd, opts.label.split(':')[1] + '.txt'), 'work\n')
      fs.writeFileSync(path.join(cwd, 'BROKEN'), 'oops\n')
      return doneImpl(cwd)
    },
  })
  assert.equal(blocked.report.waveMerges[0].status, 'TEST_FAILED',
    '(f) [M6] the candidate suite is red and the reconcile agent refuses: the wave is ' +
    'TEST_FAILED; got ' + JSON.stringify(blocked.report.waveMerges[0]))
  const closes = blocked.fake.of('close')
  const t1Close = closes.find((c) => c.uid === 'U-T1')
  assert.ok(t1Close, '(f) [M6] the blocked wave\'s task is closed; closes: ' +
    JSON.stringify(closes.map((c) => [c.uid, c.opts && c.opts.reason])))
  assert.equal(t1Close.opts.reason, 'wontfix',
    '(f) [M6] a TEST_FAILED wave closes each of its tasks with reason `wontfix`')
  assert.equal(t1Close.opts.message, 'wave 1 blocked: ' + blocked.report.waveMerges[0].detail,
    '(f) [M6] message `wave <n> blocked: <the row\'s detail>`, the row\'s detail verbatim')
  assert.ok(t1Close.opts.message.startsWith('wave 1 blocked:'),
    '(f) [M6] which begins `wave 1 blocked:`')
  assert.deepEqual(t1Close.opts.evidence, [],
    '(f) [M6] and carries NO evidence — kata refuses evidence on a wontfix')

  // The wave after a blocked one never ran: its issue is untouched.
  assert.deepEqual(closes.filter((c) => c.uid === 'U-T2'), [],
    '(f) [M6] a task of a SKIPPED wave is left open — no close call for T2')
  assert.equal(blocked.fake.store.get('U-T2').status, 'open',
    '(f) [M6] and its issue\'s status in the fake\'s store is still `open`')
}

// ══ (f) [M6] a BLOCKED implementer: the row that is not `done` ═════════════
{
  const t1 = { id: 'T1', title: 'cannot', files: ['T1.txt'], tier: 'standard', review: 'lean',
               writes: ['T1.txt'], commutes: [], proofRuns: [], body: 'task T1' }
  const stuck = await scenario({
    waves: [[t1]],
    sheets: { T1: { files: ['T1.txt'], proofTests: [], guards: [], landing: {}, driverOwned: [] } },
    stamp: 'stk',
    onImpl: (cwd) => ({ status: 'BLOCKED', summary: 'cannot proceed',
                        startHead: gitSync(['rev-parse', 'HEAD'], cwd) }),
  })
  const row = stuck.report.tasks.find((r) => r.task === 'T1')
  assert.notEqual(row.status, 'done',
    '(f) [M6] a BLOCKED implementer leaves a row that is not `done`; got ' + row.status)
  const closes = stuck.fake.of('close')
  assert.equal(closes.length, 1,
    '(f) [M6] the task is closed once; got ' +
    JSON.stringify(closes.map((c) => [c.uid, c.opts && c.opts.reason])))
  assert.equal(closes[0].opts.reason, 'wontfix',
    '(f) [M6] a row that is not `done` and is not yet closed is closed `wontfix`')
  assert.equal(closes[0].opts.message,
    row.status + ': ' + row.reviewVerdict + ' — ' + row.notes,
    '(f) [M6] message `<status>: <reviewVerdict> — <notes>`, from the row itself')
  assert.ok(closes[0].opts.message.startsWith('failed:'),
    '(f) [M6] which begins `failed:` for a BLOCKED implementer; got ' +
    JSON.stringify(closes[0].opts.message))
  assert.deepEqual(closes[0].opts.evidence, [],
    '(f) [M6] and carries no evidence')
}

// ══ (f) [M6] the run's own testCmd is the fallback evidence command ════════
{
  const t1 = { id: 'T1', title: 'no exam of its own', files: ['one.txt'], tier: 'standard',
               review: 'lean', writes: ['one.txt'], commutes: [], proofRuns: [], body: 'task T1' }
  const plain = await scenario({
    waves: [[t1]],
    sheets: { T1: { files: ['one.txt'], proofTests: [], guards: [], landing: {}, driverOwned: [] } },
    stamp: 'run',
    testCmd: 'bash check.sh',
    onImpl: (cwd) => {
      fs.writeFileSync(path.join(cwd, 'one.txt'), 'from T1\n')
      return doneImpl(cwd)
    },
  })
  const row = plain.report.tasks.find((r) => r.task === 'T1')
  assert.equal(row.status, 'done', '(f) [M6] the plain run merges: ' + row.notes)
  const c = plain.fake.of('close')[0]
  assert.ok(c, '(f) [M6] the merged task is closed')
  assert.equal(c.opts.reason, 'done', '(f) [M6] with reason `done`')
  assert.deepEqual(c.opts.evidence, [
    { type: 'commit', sha: plain.report.waveMerges[0].headSha },
    { type: 'test', command: 'bash check.sh' },
  ], '(f) [M6] and a task with no testCmd of its own carries the RUN\'s command as the test ' +
     'evidence — `<the task\'s own testCmd, else the run\'s>`')
  assert.equal(c.opts.idempotencyKey, 'run:T1:close',
    '(f) [M6] idempotencyKey `<runId>:<task id>:close` for this run\'s stamp')
}

// ══ (g) [M7] with no kata, the engine behaves as at BASE ═══════════════════
{
  const noKata = await scenario({
    waves: [[entry({ testCmd: 'bash tests/test_x.py', proofTests: ['tests/test_x.py'] })]],
    noKata: true,
    stamp: 'sim',
    onImpl: (cwd) => {
      fs.writeFileSync(path.join(cwd, 'one.txt'), 'from T1\n')
      return doneImpl(cwd)
    },
  })
  const row = noKata.report.tasks.find((r) => r.task === 'T1')
  assert.equal(row.status, 'done',
    '(g) [M7] with no kata dependency the run is the run it was at BASE: ' + row.notes +
    '\njudgment calls: ' + JSON.stringify(noKata.report.judgmentCalls, null, 1))
  assert.deepEqual(noKata.fake.calls, [],
    '(g) [M7] and the engine makes NO request — the fake was never handed to it, and nothing ' +
    'reached for one; got ' + JSON.stringify(noKata.fake.calls))
  const paths = treePaths(noKata.integ, noKata.branch)
  assert.ok(paths.includes(reservedExamPath('tests/test_x.py', 'sim')),
    '(g) [M7] the exam lands where reservedExamPath says for a task with no sheet — the ' +
    'stamp\'s own reserved directory still governs; tree: ' + JSON.stringify(paths))
  assert.ok(paths.includes('tests/exams/' + examSlug('sim') + '/__init__.py'),
    '(g) [M7] with the package init BASE writes there; tree: ' + JSON.stringify(paths))
  assert.deepEqual(linesStarting(String(noKata.prompts['exam:T1']), 'EXAM PATHS'),
    ['EXAM PATHS: tests/test_x.py -> ' + reservedExamPath('tests/test_x.py', 'sim')],
    '(g) [M7] and the EXAM PATHS line is the computed one')
}

// ══ (h) [M8] the contract's bullet ═════════════════════════════════════════
{
  const contractPath = fileURLToPath(new URL('../CONTRACT.md', import.meta.url))
  assert.ok(fs.existsSync(contractPath), '(h) [M8] fleet/CONTRACT.md exists at ' + contractPath)
  const lines = fs.readFileSync(contractPath, 'utf8').split('\n')
  const at = lines.findIndex((l) => l.startsWith('- **Kata record (engine):**'))
  assert.notEqual(at, -1,
    '(h) [M8] fleet/CONTRACT.md carries a `- **Kata record (engine):**` bullet')
  const nextBullet = lines.findIndex((l, i) => i > at && l.startsWith('- **'))
  assert.notEqual(nextBullet, -1, '(h) [M8] a bullet follows it')
  assert.ok(lines[nextBullet].startsWith('- **status.json:**'),
    '(h) [M8] and the bullet DIRECTLY after it is `- **status.json:**`; found ' +
    JSON.stringify(lines[nextBullet]))
  const block = lines.slice(at, nextBullet).join(' ')
  for (const [what, needle] of [
    ['the --kata flag', '--kata'],
    ['the one getIssue per task', 'getIssue'],
    ['the revision rule', 'revision'],
    ['the claim at dispatch', 'claim'],
    ['touched_files at capture', 'touched_files'],
    ['one comment per driver:* event', 'comment'],
    ['the done close', 'done'],
    ['the wontfix close', 'wontfix'],
  ]) {
    assert.ok(block.includes(needle),
      '(h) [M8] the bullet declares ' + what + ' — expected it to name ' +
      JSON.stringify(needle) + '; the bullet reads: ' + block)
  }
  assert.ok(/--kata[\s\S]*touched_files[\s\S]*wontfix/.test(block),
    '(h) [M8] in that order, which is what the Proof\'s `sed … | grep -q -- ' +
    '\'--kata.*touched_files.*wontfix\'` reads; the bullet reads: ' + block)
}

console.log('ALL TESTS PASSED')
