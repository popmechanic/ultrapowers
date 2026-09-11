// fleet/tests/test_run_engine_referee.mjs — #729, "the engine runs the referee
// before any reviewer".
//
// The referee (`fleet/referee.mjs`) is driver arithmetic over the captured
// patch: no model call, no network, no git write. This file pins the SEAM — how
// `run-engine.mjs` calls it, what it does with the answer, and what a reviewer
// and the report see because of it:
//
//   the pre-review pass runs for every task and ends by grading the patch;
//   an implementer-actor blocking finding takes the one repair round a red
//   `Run:` takes; a plan-actor one is parked for the gate instead; round 2
//   re-grades the repair before any reviewer; every review prompt ends with the
//   `REFEREE:` block; a repaired pair buys one reviewer, not two; and the
//   report counts what all of that found.
//
// Real below the agent seam, like every engine sim: real clones, real captures,
// the real referee and (except where a leg needs a scripted answer) the real
// linker on the engine's own `exec`.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { makeRepo, rig, doneImpl, passReview, cleanCritic } from './_engine_helpers.mjs'
import { refereeBlock } from '../run-engine.mjs'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-referee-'))

// ── the shared literals ─────────────────────────────────────────────────────
// The block's opening sentence and its position are the reviewer's contract;
// the three evidence-block names are what it must never contain, because a
// prompt carrying no such block is read by their absence.
const REFEREE_MARK = '\n\nREFEREE:'
const OPENING = 'REFEREE: the driver\'s own arithmetic over the patch'
const EVIDENCE_BLOCKS = ['EXAM EVIDENCE:', 'RUN EVIDENCE:', 'CHECK EVIDENCE:']
const A_TXT = 'line1\nline2\nline3\n' // what makeRepo seeds at BASE

// ── the rig, once ───────────────────────────────────────────────────────────
const mkTask = (id, files, over = {}) => ({
  id, title: id.toLowerCase(), files, tier: 'standard', review: 'lean',
  writes: files, commutes: [], proofTests: [], proofRuns: [],
  body: 'sim task ' + id, ...over,
})

const write = (cwd, rel, body) => {
  fs.mkdirSync(path.dirname(path.join(cwd, rel)), { recursive: true })
  fs.writeFileSync(path.join(cwd, rel), body)
}
const del = (cwd, rel) => fs.rmSync(path.join(cwd, rel), { force: true })

// A canned agent built from per-kind handlers. `impl` and `fix` leave files
// behind and return DONE with the driver's coordinates; a reviewer that is not
// given a handler passes; an examiner that is not given one returns DONE
// WITHOUT writing anything, which is the shape legs (c) and (d) are built on.
const stubOf = (h) => (prompt, opts, cwd) => {
  const kind = String(opts.label).split(':')[0]
  if (kind === 'review') return h.review ? h.review(opts) : passReview()
  if (kind === 'exam') return h.exam ? h.exam(opts, cwd, prompt) : { status: 'DONE', summary: 'exam written' }
  if (opts.label === 'integration') return cleanCritic()
  if (kind === 'impl' || kind === 'fix') {
    const handler = kind === 'fix' ? h.fix : h.impl
    if (handler) handler(cwd, opts)
    return doneImpl(cwd)
  }
  throw new Error('unexpected dispatch: ' + opts.label)
}

let runNo = 0
// One engine run over one wave, with every dispatch's label and prompt kept in
// order and the runDir handed back so the referee's own records can be read
// off disk beside the report.
const drive = async (name, tasks, handlers, extraArgs = {}) => {
  const stamp = name + (++runNo)
  const repo = makeRepo(path.join(tmp, stamp + '-repo'))
  const runDir = path.join(tmp, stamp + '-run')
  const labels = []
  const prompts = {}
  const inner = stubOf(handlers)
  const stub = (prompt, opts, cwd) => {
    labels.push(opts.label)
    prompts[opts.label] = prompt
    return inner(prompt, opts, cwd)
  }
  const { run } = rig({ repo, runDir, waves: [tasks], stub, stamp, extraArgs })
  const report = await run()
  return {
    report, labels, prompts, runDir, repo,
    row: (id) => report.tasks.find((r) => r.task === id),
    of: (prefix) => labels.filter((l) => l.startsWith(prefix)),
  }
}

// ── reading the driver's own record ─────────────────────────────────────────
const refereeFile = (runDir, id, n) =>
  path.join(runDir, 'referee', 'task-' + id + '-' + n + '.json')
const hasReferee = (runDir, id, n) => fs.existsSync(refereeFile(runDir, id, n))
const readReferee = (runDir, id, n) =>
  JSON.parse(fs.readFileSync(refereeFile(runDir, id, n), 'utf8'))
const findingsOf = (rec, check) => rec.findings.filter((f) => f.check === check)
const settledOf = (rec, check) => rec.settled.filter((s) => s.check === check)
// Every record of the run, summed — the independent count leg (h) compares the
// report's counters against.
const tallyOf = (runDir) => {
  const dir = path.join(runDir, 'referee')
  const names = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')) : []
  let findings = 0
  let blocking = 0
  for (const name of names) {
    const rec = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'))
    for (const f of rec.findings) {
      findings += 1
      if (f.severity === 'blocking') blocking += 1
    }
  }
  return { records: names.length, findings, blocking }
}
const countOf = (hay, needle) => String(hay).split(needle).length - 1
const blockOf = (prompt) => {
  const at = String(prompt).indexOf(REFEREE_MARK)
  return at === -1 ? '' : String(prompt).slice(at)
}

// The `countVowels` shape legs (a) and (e) drive: one `.mjs` file, one Produces:
// bullet, and a linker whose answers the leg scripts.
const VOWEL_BULLET = '`countVowels(s)`'
const WRONG_X = 'export const countVowel = (s) => String(s).length\n'
const RIGHT_X = 'export const countVowels = (s) => String(s).length\n'
const MISS_DETAIL = 'no export named countVowels in x.mjs (found: countVowel)'
const MISSING = { status: 'missing', symbol: 'countVowels', detail: MISS_DETAIL }
const RESOLVED = { status: 'resolved', symbol: 'countVowels', detail: 'x.mjs exports countVowels/1' }
const vowelTask = (over = {}) =>
  mkTask('T1', ['x.mjs'], { interfaces: { consumes: [], produces: [VOWEL_BULLET] }, ...over })
// The linker seam a sim passes as `args.linker`: one scripted answer per call,
// the last one repeating. The engine wraps it with `exec` and the timeout, so
// what arrives here carries them too.
const linkerStub = (answers) => {
  let i = 0
  return async (o) => {
    assert.equal(typeof o.exec, 'function', 'the engine hands the linker its own exec seam')
    assert.equal(typeof o.timeoutMs, 'number', 'and SHELL_TIMEOUT_MS: ' + JSON.stringify(o.timeoutMs))
    const answer = answers[Math.min(i, answers.length - 1)]
    i += 1
    return answer
  }
}

// ── (a) the pass runs for every task, and its finding buys one round [M1, M2] ─
{
  // The lean end of M1: no `Run:`, no `Check:`, no exam — and the record is
  // still on disk, because the driver's arithmetic over the patch is worth
  // having on a lean task too.
  const r = await drive('a1', [mkTask('T1', ['one.txt'])],
    { impl: (cwd) => write(cwd, 'one.txt', 'one\n') })
  assert.equal(r.row('T1').status, 'done', '[M1] the lean task merges: ' + JSON.stringify(r.row('T1')))
  assert.ok(hasReferee(r.runDir, 'T1', 0),
    '[M1] a task with no Run:, no Check: and no exam is still graded at n=0')
  const rec0 = readReferee(r.runDir, 'T1', 0)
  assert.equal(rec0.task, 'T1', '[M1] the record names its task: ' + JSON.stringify(rec0))
  assert.equal(rec0.n, 0, '[M1] and the pre-pass tree is n=0: ' + JSON.stringify(rec0.n))
  assert.deepEqual(rec0.findings, [], '[M1] nothing to find: ' + JSON.stringify(rec0.findings))
  assert.deepEqual(settledOf(rec0, 'footprint'),
    [{ check: 'footprint', detail: 'every touched path is in FILES' }],
    '[M1] and the footprint is settled, not silent: ' + JSON.stringify(rec0.settled))
  assert.deepEqual(r.of('fix:'), [], '[M1] no repair round: ' + r.labels.join(','))
}

{
  // M2 proper: the linker says the promised symbol is not there, so the finding
  // joins the pass's reds, buys ONE `fix:T1:0` round before any reviewer, and
  // the repaired tree is graded again at n=1.
  const r = await drive('a2', [vowelTask()], {
    impl: (cwd) => write(cwd, 'x.mjs', WRONG_X),
    fix: (cwd) => write(cwd, 'x.mjs', RIGHT_X),
  }, { linker: linkerStub([MISSING, RESOLVED]) })
  assert.equal(r.row('T1').status, 'done', '[M2] the repair merges: ' + JSON.stringify(r.row('T1')))
  assert.deepEqual(r.of('fix:'), ['fix:T1:0'],
    '[M2] exactly one pre-review repair round: ' + r.labels.join(','))
  const fix = r.prompts['fix:T1:0']
  const listed = fix.slice(fix.indexOf('Blocking issues to resolve:'))
  assert.ok(listed.includes('countVowels') && listed.includes('countVowel)'),
    '[M2] the fix round is handed the referee\'s detail verbatim: ' + listed)
  assert.ok(r.labels.indexOf('fix:T1:0') < r.labels.findIndex((l) => l.startsWith('review:')),
    '[M2] and no reviewer read the patch before it: ' + r.labels.join(','))

  const rec0 = readReferee(r.runDir, 'T1', 0)
  const found = findingsOf(rec0, 'interface')
  assert.equal(found.length, 1, '[M2] one interface finding at n=0: ' + JSON.stringify(rec0.findings))
  assert.equal(found[0].severity, 'blocking', '[M2] blocking: ' + JSON.stringify(found[0]))
  assert.equal(found[0].actor, 'implementer', '[M2] actor implementer: ' + JSON.stringify(found[0]))
  const rec1 = readReferee(r.runDir, 'T1', 1)
  assert.deepEqual(rec1.findings, [],
    '[M2] and the round after the repair is clean: ' + JSON.stringify(rec1.findings))

  // …and the reviewer reads the record of the tree it is reviewing (M5): the
  // repaired one, not the patch the fix round was dispatched against.
  const block = blockOf(r.prompts['review:T1:1'])
  assert.equal(block, refereeBlock(rec1),
    '[M5] the round-1 block renders `-1.json`: ' + block)
  assert.ok(!block.includes(MISS_DETAIL),
    '[M5] so the finding the fix round already answered is not re-served: ' + block)
}

{
  // A red `Run:` and a referee finding are the same kind of red: one round,
  // both lines, one prompt.
  const r = await drive('a3', [vowelTask({ proofRuns: ['test -e c.txt'] })], {
    impl: (cwd) => write(cwd, 'x.mjs', WRONG_X),
    fix: (cwd) => { write(cwd, 'x.mjs', RIGHT_X); write(cwd, 'c.txt', 'c\n') },
  }, { linker: linkerStub([MISSING, RESOLVED]) })
  assert.deepEqual(r.of('fix:'), ['fix:T1:0'],
    '[M2] one round answers both reds: ' + r.labels.join(','))
  const listed = r.prompts['fix:T1:0']
  assert.ok(listed.includes('the Proof\'s Run: command failed: test -e c.txt'),
    '[M2] the driver\'s own red is listed: ' + listed.slice(-900))
  assert.ok(listed.includes(MISS_DETAIL),
    '[M2] beside the referee\'s: ' + listed.slice(-900))
}

{
  // Still blocking after the round, and nothing but the referee is red: the
  // task fails `referee-red` and no reviewer is ever dispatched.
  const r = await drive('a4', [vowelTask()], {
    impl: (cwd) => write(cwd, 'x.mjs', WRONG_X),
    fix: () => {},
  }, { linker: linkerStub([MISSING]) })
  const row = r.row('T1')
  assert.equal(row.status, 'failed', '[M2] the task fails: ' + JSON.stringify(row))
  assert.equal(row.reviewVerdict, 'referee-red',
    '[M2] with the verdict that names what was red: ' + JSON.stringify(row))
  assert.ok(String(row.notes).includes('countVowels'),
    '[M2] the detail travels in notes: ' + row.notes)
  assert.equal(row.proofFixes, 1,
    '[M2] a referee-only red still bought one repair round: ' + JSON.stringify(row))
  assert.deepEqual(r.of('review:'), [], '[M2] and no reviewer was billed: ' + r.labels.join(','))
  assert.ok(hasReferee(r.runDir, 'T1', 0) && hasReferee(r.runDir, 'T1', 1),
    '[M1] both passes left a record')
}

{
  // The same shape with a red `Run:` beside it: the referee is happy on the
  // second pass, the command is not, and the verdict blames the proof.
  const r = await drive('a5', [vowelTask({ proofRuns: ['test -e c.txt'] })], {
    impl: (cwd) => write(cwd, 'x.mjs', WRONG_X),
    fix: () => {},
  }, { linker: linkerStub([MISSING, RESOLVED]) })
  const row = r.row('T1')
  assert.equal(row.reviewVerdict, 'proof-red',
    '[M2] a still-red command outranks the referee\'s silence: ' + JSON.stringify(row))
  assert.deepEqual(r.of('review:'), [], '[M2] and no reviewer was billed: ' + r.labels.join(','))
}

// ── (b) the footprint at the seam [M2, M5] ──────────────────────────────────
let deletedRun = null
let helperRun = null
{
  // A BASE file deleted from outside FILES is the referee's blocking finding,
  // and restoring it is a repair like any other.
  deletedRun = await drive('b1', [mkTask('T1', ['one.txt'])], {
    impl: (cwd) => { write(cwd, 'one.txt', 'one\n'); del(cwd, 'a.txt') },
    fix: (cwd) => write(cwd, 'a.txt', A_TXT),
  })
  assert.deepEqual(deletedRun.of('fix:'), ['fix:T1:0'],
    '[M2] the deletion bought the round: ' + deletedRun.labels.join(','))
  assert.ok(deletedRun.prompts['fix:T1:0'].includes('a.txt'),
    '[M2] and named the file: ' + deletedRun.prompts['fix:T1:0'].slice(-600))
  assert.equal(deletedRun.row('T1').status, 'done',
    '[M2] the restored tree merges: ' + JSON.stringify(deletedRun.row('T1')))
  assert.deepEqual(readReferee(deletedRun.runDir, 'T1', 1).findings, [],
    '[M2] with a clean record after the round')
}

{
  // The sibling's path: T1 writes what T2 owns. The engine passes the wave's
  // other tasks' `files` arrays STRUCTURALLY — never parsed back out of the
  // rendered siblings line — which is the only way the referee can tell a
  // sibling's path from any other path outside FILES.
  const r = await drive('b2', [mkTask('T1', ['t1.txt']), mkTask('T2', ['t2.txt'])], {
    impl: (cwd, opts) => {
      const id = opts.label.split(':')[1]
      write(cwd, id.toLowerCase() + '.txt', 'from ' + id + '\n')
      if (id === 'T1') write(cwd, 't2.txt', 'trespass\n')
    },
    fix: (cwd) => del(cwd, 't2.txt'),
  })
  assert.deepEqual(r.of('fix:'), ['fix:T1:0'],
    '[M2] only the trespassing task bought a round: ' + r.labels.join(','))
  assert.ok(r.prompts['fix:T1:0'].includes('path owned by a wave sibling and absent from FILES') &&
            r.prompts['fix:T1:0'].includes('t2.txt'),
    '[M2] and it is told whose path it wrote: ' + r.prompts['fix:T1:0'].slice(-600))
  assert.equal(r.row('T1').status, 'done', '[M2] the repair merges: ' + JSON.stringify(r.row('T1')))
}

{
  // The shipped overlap: both tasks were GIVEN the path, so both writing it is
  // settled and named, never a finding.
  const r = await drive('b3', [mkTask('T1', ['shared.txt']), mkTask('T2', ['shared.txt'])], {
    impl: (cwd) => write(cwd, 'shared.txt', 'shared\n'),
  })
  for (const id of ['T1', 'T2']) {
    assert.equal(r.row(id).status, 'done', '[M2] ' + id + ' merges: ' + JSON.stringify(r.row(id)))
    assert.deepEqual(findingsOf(readReferee(r.runDir, id, 0), 'footprint'), [],
      '[M2] and an overlap=fold path is no finding of ' + id + '\'s')
  }
  assert.deepEqual(r.of('fix:'), [], '[M2] no round was bought: ' + r.labels.join(','))
}

{
  // A path outside FILES that nobody else owns is a MINOR: it never opens a fix
  // round, it reaches the reviewer in the block, and it lands in the notes.
  helperRun = await drive('b4', [mkTask('T1', ['one.txt'])],
    { impl: (cwd) => { write(cwd, 'one.txt', 'one\n'); write(cwd, 'helper.txt', 'helper\n') } })
  const row = helperRun.row('T1')
  assert.equal(row.status, 'done', '[M2] a minor merges: ' + JSON.stringify(row))
  assert.equal(row.reviewVerdict, 'clean', '[M2] clean: ' + JSON.stringify(row))
  assert.deepEqual(helperRun.of('fix:'), [], '[M2] and buys no round: ' + helperRun.labels.join(','))
  assert.ok(String(row.notes).includes('helper.txt'),
    '[M5] the advisory is in the report: ' + row.notes)
  const block = blockOf(helperRun.prompts['review:T1:1'])
  assert.ok(block.includes('- minor: ') && block.includes('helper.txt'),
    '[M5] and in the reviewer\'s block, marked minor: ' + block)
}

// ── (c) a `Test:` path nobody was asked to write is the PLAN's [M3, M4] ─────
// The examiner returns DONE and writes nothing, so the handoff copies nothing
// and the driver's exam runs with `t1_test.sh` absent at HEAD, exit 0.
const examTask = (over = {}) =>
  mkTask('T1', ['one.txt'], { proofTests: ['t1_test.sh'], testCmd: 'bash check.sh', ...over })
{
  const r = await drive('c1', [examTask()], { impl: (cwd) => write(cwd, 'one.txt', 'one\n') })
  const row = r.row('T1')
  assert.equal(row.status, 'done',
    '[M3] a plan defect never fails the task: ' + JSON.stringify(row))
  assert.deepEqual(r.of('fix:'), [],
    '[M3] and never opens a fix round — nobody a round can reach was asked to write it: ' +
    r.labels.join(','))
  const found = findingsOf(readReferee(r.runDir, 'T1', 0), 'exam-files')
  assert.equal(found.length, 1, '[M4] exactly one exam-files finding: ' + JSON.stringify(found))
  assert.equal(found[0].severity, 'blocking', '[M4] blocking: ' + JSON.stringify(found[0]))
  assert.equal(found[0].actor, 'plan',
    '[M4] with actor plan, since the path is not in FILES: ' + JSON.stringify(found[0]))

  const call = r.report.judgmentCalls.filter((l) => l.startsWith('task T1: referee exam-files —'))
  assert.equal(call.length, 1,
    '[M3] the judgment call is recorded once, in the shared literal: ' +
    JSON.stringify(r.report.judgmentCalls))
  assert.equal(countOf(row.notes, 'plan-defect: ' + found[0].detail), 1,
    '[M3] the detail is in notes once, prefixed: ' + row.notes)
  const deferred = r.report.deferredVerification.filter((d) => d.reason === 'plan-defect')
  assert.equal(deferred.length, 1, '[M3] one deferral: ' + JSON.stringify(r.report.deferredVerification))
  assert.equal(deferred[0].deliverable, 'T1', '[M3] for this task: ' + JSON.stringify(deferred[0]))
  assert.equal(deferred[0].why, found[0].detail,
    '[M3] carrying the raw detail: ' + JSON.stringify(deferred[0]))
}

// ── (d) the same seam with an implementer actor, and the pair rule [M4, M7] ──
{
  // The path IS in FILES, so it is the implementer's to write and a round is
  // dispatched for it.
  const r = await drive('d1', [examTask({ files: ['one.txt', 't1_test.sh'] })], {
    impl: (cwd) => write(cwd, 'one.txt', 'one\n'),
    fix: (cwd) => write(cwd, 't1_test.sh', 'exit 0\n'),
  })
  assert.deepEqual(r.of('fix:'), ['fix:T1:0'],
    '[M4] the round is dispatched: ' + r.labels.join(','))
  assert.ok(r.prompts['fix:T1:0'].includes('t1_test.sh'),
    '[M4] naming the absent path: ' + r.prompts['fix:T1:0'].slice(-600))
  const row = r.row('T1')
  assert.equal(row.status, 'done', '[M4] and writing it merges: ' + JSON.stringify(row))
  assert.equal(row.proofFixes, 1, '[M4] one pre-review round: ' + JSON.stringify(row))
  assert.equal(row.fixIterations, 0, '[M4] and no review round: ' + JSON.stringify(row))
}

{
  // A BLOCKED examiner: no exam ran, by driver decision. That is a settled line
  // and never a finding — and the pair stands.
  const r = await drive('d2', [examTask({ review: 'peer' })], {
    impl: (cwd) => write(cwd, 'one.txt', 'one\n'),
    exam: () => ({ status: 'BLOCKED', summary: 'no' }),
  })
  const rec0 = readReferee(r.runDir, 'T1', 0)
  assert.deepEqual(rec0.findings, [],
    '[M4] a task the driver left unexamined is graded on nothing: ' + JSON.stringify(rec0.findings))
  const settled = settledOf(rec0, 'exam-files')
  assert.equal(settled.length, 1, '[M4] one settled line: ' + JSON.stringify(rec0.settled))
  assert.ok(settled[0].detail.includes('unexamined'),
    '[M4] saying so: ' + JSON.stringify(settled[0]))
  assert.deepEqual(r.of('review:'), ['review:T1:1:1', 'review:T1:1:2'],
    '[M7] and a pair with nothing to answer buys both reviewers: ' + r.labels.join(','))
}

{
  // The plan-actor shape at a `peer` task: the finding was real, but no fix
  // round answered it, so the second reviewer is not bought back.
  const r = await drive('d3', [examTask({ review: 'peer' })],
    { impl: (cwd) => write(cwd, 'one.txt', 'one\n') })
  assert.deepEqual(r.of('review:'), ['review:T1:1:1', 'review:T1:1:2'],
    '[M7] a plan-actor finding leaves the pair intact: ' + r.labels.join(','))
  assert.equal(r.report.reviewEconomy.refereeSkippedPairs, 0,
    '[M7] and nothing is counted as bought back: ' + JSON.stringify(r.report.reviewEconomy))
}

// ── (e) the block: a pure function, and where it sits [M5] ──────────────────
{
  assert.equal(refereeBlock(null), '', '[M5] null renders nothing (the run-51 rule)')
  assert.equal(refereeBlock(undefined), '', '[M5] and so does undefined')
  const out = refereeBlock({
    findings: [{ check: 'footprint', severity: 'minor', actor: 'implementer', detail: 'd1' }],
    settled: [{ check: 'secrets', detail: 's1' }],
  })
  assert.ok(out.startsWith('\n\n' + OPENING),
    '[M5] the opening sentence is the shared literal: ' + JSON.stringify(out.slice(0, 120)))
  assert.ok(out.includes('\n- minor: d1'), '[M5] one line per finding: ' + out)
  assert.ok(out.includes('\n- settled (secrets): s1'), '[M5] one per settled entry: ' + out)
  for (const name of EVIDENCE_BLOCKS) {
    assert.ok(!out.includes(name), '[M5] and it never names ' + name + ': ' + out)
  }
}

{
  // In a run: last block of the prompt, after CHECK EVIDENCE, exactly once.
  const r = await drive('e1', [mkTask('T1', ['one.txt'])],
    { impl: (cwd) => write(cwd, 'one.txt', 'one\n') },
    { constraintChecks: [{ cmd: 'test -f check.sh' }] })
  const prompt = r.prompts['review:T1:1']
  assert.equal(countOf(prompt, REFEREE_MARK), 1,
    '[M5] exactly one REFEREE: block: ' + prompt.slice(-800))
  assert.ok(prompt.indexOf('CHECK EVIDENCE:') !== -1 &&
            prompt.indexOf('CHECK EVIDENCE:') < prompt.indexOf(REFEREE_MARK),
    '[M5] placed after the CHECK EVIDENCE block: ' + prompt.slice(-800))
  assert.equal(blockOf(prompt), refereeBlock(readReferee(r.runDir, 'T1', 0)),
    '[M5] and it is exactly the rendering of `-0.json`: ' + blockOf(prompt))
}

{
  // A referee minor is an advisory like a reviewer's: round 2 is told it once,
  // although round 2's referee raised the very same minor again, and the row's
  // notes carry it once.
  const BLOCKER = 'the sim reviewer wants a second line in one.txt'
  const r = await drive('e2', [mkTask('T1', ['one.txt'])], {
    impl: (cwd) => { write(cwd, 'one.txt', 'one\n'); write(cwd, 'helper.txt', 'helper\n') },
    fix: (cwd) => write(cwd, 'one.txt', 'one\ntwo\n'),
    review: (opts) => (opts.label === 'review:T1:1'
      ? { verdict: 'FIX_REQUIRED', issues: [{ severity: 'blocking', detail: BLOCKER }] }
      : passReview()),
  })
  const row = r.row('T1')
  assert.equal(row.status, 'done', '[M5] the fix round answered the reviewer: ' + JSON.stringify(row))
  const MINOR = 'path outside FILES: `helper.txt`'
  const prompt2 = r.prompts['review:T1:2']
  const at = prompt2.indexOf('\nPRIOR-ROUND ADVISORIES')
  assert.ok(at !== -1, '[M5] round 2 carries the advisories block: ' + prompt2.slice(-900))
  const advisories = prompt2.slice(at, prompt2.indexOf(REFEREE_MARK))
  assert.equal(countOf(advisories, MINOR), 1,
    '[M5] listing the referee\'s minor exactly once: ' + advisories)
  assert.equal(countOf(row.notes, MINOR), 1,
    '[M5] and the report keeps it once, not once per round: ' + row.notes)
  assert.ok(blockOf(prompt2).includes(MINOR),
    '[M5] round 2\'s own record raised it again, which is why the de-dup is on detail: ' +
    blockOf(prompt2))
}

// ── (f) round 2 re-grades the repair, before any reviewer [M1, M6] ──────────
{
  // The fix round answers the reviewer and breaks the footprint. Round 2's
  // referee runs after that round's evidence and before any reviewer: the task
  // ends there, with the fix loop spent.
  const r = await drive('f1', [mkTask('T1', ['one.txt'])], {
    impl: (cwd) => write(cwd, 'one.txt', 'one\n'),
    fix: (cwd) => { write(cwd, 'one.txt', 'one\ntwo\n'); del(cwd, 'a.txt') },
    review: (opts) => (opts.label === 'review:T1:1'
      ? { verdict: 'FIX_REQUIRED', issues: [{ severity: 'blocking', detail: 'sim: needs a line' }] }
      : passReview()),
  })
  const row = r.row('T1')
  assert.equal(row.status, 'failed', '[M6] the task fails: ' + JSON.stringify(row))
  assert.equal(row.reviewVerdict, 'fix-loop-exhausted',
    '[M6] with the fix loop spent: ' + JSON.stringify(row))
  assert.ok(String(row.notes).includes('a.txt'),
    '[M6] the referee\'s detail is the note: ' + row.notes)
  assert.deepEqual(r.of('review:'), ['review:T1:1'],
    '[M6] and round 2 never bought a reviewer: ' + r.labels.join(','))
  assert.ok(hasReferee(r.runDir, 'T1', 1),
    '[M1] round 2 wrote `-1.json`, since no pre-review round preceded it')
  assert.ok(findingsOf(readReferee(r.runDir, 'T1', 1), 'footprint')
    .some((f) => f.severity === 'blocking'),
    '[M6] and that record holds the finding that ended the task')
}

{
  // The same, one pre-review round earlier: `proofFixes` is 1, so round 2's
  // record is `-2.json` — `n` is the number of fix rounds before the patch.
  const r = await drive('f2', [mkTask('T1', ['one.txt', 'c.txt'], { proofRuns: ['test -e c.txt'] })], {
    impl: (cwd) => write(cwd, 'one.txt', 'one\n'),
    fix: (cwd, opts) => {
      if (opts.label === 'fix:T1:0') { write(cwd, 'c.txt', 'c\n'); return }
      write(cwd, 'one.txt', 'one\ntwo\n')
      del(cwd, 'a.txt')
    },
    review: (opts) => (opts.label === 'review:T1:1'
      ? { verdict: 'FIX_REQUIRED', issues: [{ severity: 'blocking', detail: 'sim: needs a line' }] }
      : passReview()),
  })
  const row = r.row('T1')
  assert.equal(row.proofFixes, 1, '[M1] one pre-review round preceded round 2: ' + JSON.stringify(row))
  assert.equal(row.reviewVerdict, 'fix-loop-exhausted',
    '[M6] and round 2 ends the task: ' + JSON.stringify(row))
  for (const n of [0, 1, 2]) {
    assert.ok(hasReferee(r.runDir, 'T1', n), '[M1] `-' + n + '.json` exists')
  }
  assert.equal(readReferee(r.runDir, 'T1', 2).n, 2,
    '[M6] round 2 wrote `proofFixes + 1`')
}

// ── (g) the default linker: `linkProduces` on the engine's own exec [M9] ────
{
  // No `args.linker`, and no file the real linker can read: `unlinked` is a
  // settled line naming the file nobody looked at, never a finding.
  const r = await drive('g1', [mkTask('T1', ['a.txt'],
    { interfaces: { consumes: [], produces: ['`ONE`'] } })],
    { impl: (cwd) => write(cwd, 'a.txt', A_TXT + 'from T1\n') })
  assert.equal(r.row('T1').status, 'done',
    '[M9] a bullet no linker can read is not a defect: ' + JSON.stringify(r.row('T1')))
  const rec0 = readReferee(r.runDir, 'T1', 0)
  assert.deepEqual(findingsOf(rec0, 'interface'), [],
    '[M9] no interface finding: ' + JSON.stringify(rec0.findings))
  const settled = settledOf(rec0, 'interface')
  assert.equal(settled.length, 1, '[M9] one settled line: ' + JSON.stringify(rec0.settled))
  assert.ok(settled[0].detail.includes('ONE') && /no linkable file|no linker for/.test(settled[0].detail),
    '[M9] naming the bullet and why nothing read it: ' + JSON.stringify(settled[0]))
}

{
  // No `interfaces` key at all.
  const r = await drive('g2', [mkTask('T1', ['one.txt'])],
    { impl: (cwd) => write(cwd, 'one.txt', 'one\n') })
  assert.equal(r.row('T1').status, 'done')
  assert.deepEqual(settledOf(readReferee(r.runDir, 'T1', 0), 'interface'),
    [{ check: 'interface', detail: 'no Produces: to link' }],
    '[M9] the settled line says there was nothing to link')
}

{
  // The real thing: a `.mjs` that exports the promised symbol resolves, and
  // one that exports the neighbouring name buys the repair round.
  const mk = (body) => mkTask('T1', ['lib.mjs'],
    { interfaces: { consumes: [], produces: ['`add(a, b)`'] }, body })
  const ok = await drive('g3', [mk('sim task T1')],
    { impl: (cwd) => write(cwd, 'lib.mjs', 'export function add (a, b) { return a + b }\n') })
  assert.equal(ok.row('T1').status, 'done', '[M9] a resolved symbol raises nothing')
  const rec0 = readReferee(ok.runDir, 'T1', 0)
  assert.deepEqual(findingsOf(rec0, 'interface'), [],
    '[M9] no finding: ' + JSON.stringify(rec0.findings))
  assert.ok(settledOf(rec0, 'interface').some((s) => s.detail.includes('add/2')),
    '[M9] and the settled line records the symbol and its arity: ' + JSON.stringify(rec0.settled))

  const miss = await drive('g4', [mk('sim task T1')], {
    impl: (cwd) => write(cwd, 'lib.mjs', 'export function plus (a, b) { return a + b }\n'),
    fix: (cwd) => write(cwd, 'lib.mjs', 'export function add (a, b) { return a + b }\n'),
  })
  assert.deepEqual(miss.of('fix:'), ['fix:T1:0'],
    '[M9] a missing symbol is blocking and buys the round: ' + miss.labels.join(','))
  const fix = miss.prompts['fix:T1:0']
  assert.ok(fix.includes('add') && fix.includes('plus'),
    '[M9] which is told the promised name and the one the file exports: ' + fix.slice(-800))
}

// ── Task 1 (#842): a placeholder Produces is unlinked, so it is a settled ────
// ── line and never a repair round [M6] ───────────────────────────────────────
// M6. A task whose files are `['lib.mjs']`, whose `interfaces.produces` is
//     exactly `['none']` and whose implementer writes `lib.mjs` exporting
//     `plus` reaches `done` with no `fix:` dispatch, and its `n=0` record has
//     zero `interface` findings and exactly one settled `interface` line whose
//     detail carries the bullet and the word `placeholder` — never the miss
//     wording, which is what a placeholder read as a symbol would have bought.
{
  const r = await drive('r1', [mkTask('T1', ['lib.mjs'],
    { interfaces: { consumes: [], produces: ['none'] } })],
    { impl: (cwd) => write(cwd, 'lib.mjs', 'export function plus (a, b) { return a + b }\n') })

  assert.equal(r.row('T1').status, 'done',
    '[M6] a placeholder Produces: promises no symbol, so the task merges: ' + JSON.stringify(r.row('T1')))
  assert.deepEqual(r.of('fix:'), [],
    '[M6] and no repair round was ever bought for it: ' + r.labels.join(','))

  const rec0 = readReferee(r.runDir, 'T1', 0)
  assert.deepEqual(findingsOf(rec0, 'interface'), [],
    '[M6] zero interface findings at n=0: ' + JSON.stringify(rec0.findings))
  const settled = settledOf(rec0, 'interface')
  assert.equal(settled.length, 1,
    '[M6] exactly one settled interface line: ' + JSON.stringify(rec0.settled))
  const detail = String(settled[0].detail)
  assert.ok(detail.includes('none'),
    '[M6] which names the bullet it answered: ' + JSON.stringify(settled[0]))
  assert.ok(/placeholder/.test(detail),
    '[M6] and says placeholder in one line: ' + JSON.stringify(settled[0]))
  assert.ok(!detail.includes('no export named'),
    '[M6] rather than listing the file\'s exports: ' + JSON.stringify(settled[0]))
}

// ── (h) the report counts what the referee found [M8] ───────────────────────
{
  const cases = [
    ['a clean run', await drive('h1', [mkTask('T1', ['one.txt'])],
      { impl: (cwd) => write(cwd, 'one.txt', 'one\n') }), 0, 0],
    ['the helper.txt run', helperRun, 1, 0],
    ['the deleted-a.txt run', deletedRun, 1, 1],
  ]
  for (const [what, r, findings, blocking] of cases) {
    const eco = r.report.reviewEconomy
    const tally = tallyOf(r.runDir)
    assert.equal(eco.refereeFindings, findings,
      '[M8] ' + what + ' found ' + findings + ': ' + JSON.stringify(eco))
    assert.equal(eco.refereeBlocking, blocking,
      '[M8] of which ' + blocking + ' blocking: ' + JSON.stringify(eco))
    // …and the counters are the records, not a story told beside them.
    assert.equal(eco.refereeFindings, tally.findings,
      '[M8] ' + what + ': the report agrees with every referee/*.json: ' + JSON.stringify(tally))
    assert.equal(eco.refereeBlocking, tally.blocking,
      '[M8] ' + what + ': and so does the blocking count: ' + JSON.stringify(tally))
  }
}

// ── (i) task 2 (#818): an unreadable capture is a driver error [M5] ─────────
// "A patch the referee cannot read is a loud failure": when the captured patch
// is gone by the time the pre-review pass reaches the referee, `referee()`
// rejects, the rejection propagates out of `runTaskInner` to `runTask`'s catch,
// and the task ends as any driver error ends — retried once at the same tier
// and, on the second throw, `failed`/`agent-error` with the message in `notes`.
// The record of a driver error, never of a review.
//
// The way a sim makes a capture vanish: the pre-review pass runs the task's
// `Run:` commands (`bash -lc`, cwd the task clone) BEFORE `runReferee`, the
// clone is `<runDir>/clones/task-T1` and the capture is
// `<runDir>/patches/task-T1.patch`, so this task deletes its own capture on
// every pass. The retry re-captures and re-deletes, so the second throw lands
// the row. No engine change belongs to task 2 — this is that existing route,
// observed through the seam.
{
  const r = await drive('i1', [mkTask('T1', ['one.txt'], {
    proofRuns: ['rm -f "$PWD/../../patches/task-T1.patch"'],
    proofTests: [],
  })], { impl: (cwd) => write(cwd, 'one.txt', 'one\n') })

  const row = r.row('T1')
  assert.equal(row.status, 'failed',
    '[M5] a capture the referee cannot read fails the task: ' + JSON.stringify(row))
  assert.equal(row.reviewVerdict, 'agent-error',
    '[M5] as a driver error, not as a review verdict: ' + JSON.stringify(row))
  assert.ok(String(row.notes).includes('cannot read the captured patch'),
    '[M5] the rethrown message is the note: ' + row.notes)
  assert.ok(String(row.notes).includes('task-T1.patch'),
    '[M5] naming the capture it could not read: ' + row.notes)
  assert.deepEqual(r.of('review:'), [],
    '[M5] and no reviewer was ever dispatched for it: ' + r.labels.join(','))

  const dir = path.join(r.runDir, 'referee')
  const records = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((f) => /^task-T1-.*\.json$/.test(f))
    : []
  assert.deepEqual(records, [],
    '[M5] and nothing was written under <runDir>/referee for it — the read stays ' +
    'ahead of the write: ' + JSON.stringify(records))

  const calls = r.report.judgmentCalls.filter(
    (l) => l.includes('agent error') && l.includes('cannot read the captured patch'))
  assert.ok(calls.length >= 1,
    '[M5] the report says which task erred and why: ' + JSON.stringify(r.report.judgmentCalls))
}

// ── (i) an unguarded exam is read where it LANDED [M3, M4] ──────────────────
// Run-101 (2026-09-11): the Proof named `tests/test_release_0_3_25.py`, the
// exam was unguarded, so the engine sent the examiner to
// `tests/exams/run_101/…` and put the Proof path back to BASE (#777). The exam
// passed, the referee looked for the Proof path at HEAD, found nothing, and
// filed a blocking exam-files finding — the first run whose unguarded exam was
// green at referee time was the first to fail on it. The referee now reads
// existence at the landing path the engine hands it.
{
  let landed = null
  const r = await drive('i1', [examTask({
    proofTests: ['tests/test_rel.py'], files: ['one.txt', 'tests/test_rel.py'],
  })], {
    impl: (cwd) => write(cwd, 'one.txt', 'one\n'),
    exam: (opts, cwd, prompt) => {
      const m = /EXAM PATHS: tests\/test_rel\.py -> (\S+)/.exec(String(prompt))
      assert.ok(m, '[M4] the examiner is told where the exam lands: ' + String(prompt).slice(0, 300))
      landed = m[1]
      write(cwd, landed, '# the peer exam\n')
      return { status: 'DONE', summary: 'exam written' }
    },
  })
  assert.ok(landed && landed.startsWith('tests/exams/') && landed.endsWith('/test_rel.py'),
    '[M4] the landing is under the reserved directory: ' + landed)
  const row = r.row('T1')
  assert.equal(row.status, 'done',
    '[M3] an unguarded exam that landed is no absent path: ' + JSON.stringify(row))
  assert.deepEqual(r.of('fix:'), [],
    '[M4] and buys no repair round: ' + r.labels.join(','))
  const rec = readReferee(r.runDir, 'T1', 0)
  assert.deepEqual(findingsOf(rec, 'exam-files'), [],
    '[M4] no exam-files finding: ' + JSON.stringify(rec.findings))
  const settled = settledOf(rec, 'exam-files')
  assert.equal(settled.length, 1, '[M4] one settled exam-files line: ' + JSON.stringify(rec.settled))
  assert.ok(settled[0].detail.includes('tests/test_rel.py at ' + landed),
    '[M4] naming the Proof path and where it landed: ' + settled[0].detail)
  assert.ok(!fs.existsSync(path.join(r.repo, 'tests', 'test_rel.py')),
    '[M4] and the Proof path itself is not at HEAD — the landing is the only copy')
}

fs.rmSync(tmp, { recursive: true, force: true })
console.log('ALL TESTS PASSED')
