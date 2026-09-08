// fleet/tests/test_run_engine_proof_runs.mjs — the `Run:` proofs (#589): when a
// task's Proof is a command, the DRIVER runs it — after the implementer, before
// the review, in the task's own clone, through the engine's own `sh` seam — and
// the reviewer reads exactly what it printed. A non-zero exit sends the task
// back to be fixed no matter what the reviewer itself said.
//
// Everything below the agent seam is real (git, clones, capture, the fold
// kernel, the real `sh`); only the judgments are canned, so the command
// execution the assertions observe is the driver's own.
//
// Machine clauses under test:
//   M1 — after the implementer, before the first review, each `task.proofRuns`
//        string is executed in order with the engine's `sh` seam in the task's
//        clone, recording { cmd, exit, stdout }, stdout combined and truncated
//        to 4,000 characters. Since #713 that execution happens ONCE before
//        the first review on a task that starts green: the driver's own pass
//        (`iter: 0`), whose evidence review round 1 reads rather than
//        re-measuring a tree no agent has touched since. A fresh execution
//        comes only at `iter: 2`, after a review-round fix. A red `iter: 0`
//        pass buys one `fix:<id>:0` round before any referee is dispatched
//        (its re-execution is `iter: 0` too), and a task still red after it
//        never reaches a reviewer at all (`reviewVerdict: 'proof-red'`) —
//        test_run_engine_pre_review.mjs owns that contract; this file is
//        pinned to it so the two cannot drift.
//   M2 — the review prompt carries a `RUN EVIDENCE:` block (command verbatim,
//        `exit <n>`, the recorded output); no proofRuns → no block, and a
//        prompt byte-identical to BASE's.
//   M3 — any non-zero exit ⇒ FIX_REQUIRED with a blocking issue naming the
//        command and its exit code, whatever the reviewer's own verdict; the
//        fix round re-runs the commands and the new evidence replaces the old.
//   M4 — all-zero ⇒ the reviewer's own verdict, unchanged.
//   M5 — one `driver:proof-run` record per execution in the run's events.jsonl,
//        carrying task, cmd, exit, iter.
//   M6 — proofRuns without proofTests dispatches no examiner and is not marked
//        as an edited exam.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execSeam } from '../run-main.mjs'
import { makeCwdFor, withPatchCapture, defaultTaskIdOf } from '../run-waves.mjs'
import { runEngine } from '../run-engine.mjs'
import { rig, makeRepo, provision, gitSync, passReview, cleanCritic, doneImpl } from './_engine_helpers.mjs'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-proof-runs-'))
// Removed on exit, red or green (rmSync unlinks the fleet-copy's `skills`
// symlink rather than following it into the repo).
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }))
const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const FLEET_DIR = fileURLToPath(new URL('..', import.meta.url))
const ROLES_DIR = fileURLToPath(new URL('../roles/', import.meta.url))
const BASE_SHA = '0a3559a2e0c9998553c0c725e5510e20e5802b1b'

// ── the task the sims run ───────────────────────────────────────────────────
// `proofTests: []` throughout: a `Run:` proof is not a test path, and M6 says
// that combination dispatches no examiner (as at BASE for an empty proofTests).
const BODY = '**Claim:** the tree gains one.txt\n' +
  'Machine: M1. The tree holds `one.txt` whose content is "from T1".\n\n' +
  '**Proof:**\n- Run: `sh -c \'echo hello-from-run\'`\n- Legs: (a) the command exits 0 [M1]'
const entry = (over = {}) => ({
  id: 'T1', title: 'run the proof', files: ['one.txt'], tier: 'standard', review: 'lean',
  writes: ['one.txt'], commutes: [],
  interfaces: { consumes: ['`BASE_FACTS`'], produces: ['`ONE`'] },
  testCmd: 'bash check.sh', proofTests: [], proofRuns: [],
  body: BODY,
  ...over,
})

// The run's own record. Absent file reads as no records, so a BASE engine that
// writes none fails the count assertion rather than an ENOENT.
const proofRunEvents = (runDir) => {
  const file = path.join(runDir, 'events.jsonl')
  if (!fs.existsSync(file)) return []
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l) } catch { return null } })
    .filter((e) => e && e.kind === 'driver:proof-run')
}

const evidenceOf = (prompt) => {
  const i = String(prompt || '').indexOf('RUN EVIDENCE:')
  return i === -1 ? '' : prompt.slice(i)
}

// Every record the run wrote, in the order it wrote them — the `driver:exam-run`
// and `driver:check-run` kinds the #713 legs count beside the `Run:` ones.
const allEvents = (runDir) => {
  const file = path.join(runDir, 'events.jsonl')
  if (!fs.existsSync(file)) return []
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l) } catch { return null } })
    .filter(Boolean)
}
const ofKind = (evs, kind, task = 'T1') =>
  evs.filter((e) => e.kind === kind && e.task === task)

// ── the sim rig: the shared one, plus a call log the proof command can join ──
let seq = 0
// `examScript`, when given, is what the canned examiner writes at the task's
// one Proof `Test:` path (`t1_test.sh`) — the only way to give a sim a RUNNABLE
// exam, since `examRunnable` needs proofTests, a testCmd and blobs the examiner
// actually left. `constraintChecks` is the run's executable Global Constraints.
async function scenario({ task, review = () => passReview(), onImpl = () => {},
                          onFix = () => {}, orderFile = null, examScript = null,
                          constraintChecks = [] }) {
  seq += 1
  const stamp = 'pr' + seq
  const repo = makeRepo(path.join(tmp, 'repo-' + stamp))
  const runDir = path.join(tmp, 'run-' + stamp)
  const calls = []
  const prompts = {}
  let reviews = 0
  const stub = (prompt, opts, cwd) => {
    calls.push(opts.label)
    prompts[opts.label] = prompt
    if (orderFile) fs.appendFileSync(orderFile, opts.label + '\n')
    const kind = opts.label.split(':')[0]
    if (kind === 'exam') {
      fs.writeFileSync(path.join(cwd, 't1_test.sh'), String(examScript))
      return { status: 'DONE', summary: 'exam written' }
    }
    if (kind === 'impl') { onImpl(cwd); return doneImpl(cwd) }
    if (kind === 'fix') { onFix(cwd, opts.label); return doneImpl(cwd) }
    if (kind === 'review') { reviews += 1; return review(reviews) }
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run, clonesDir } = rig({
    repo, runDir, waves: [[task]], stub, stamp,
    extraArgs: { shallowLeg: false, constraintChecks },
  })
  const report = await run()
  return { report, row: report.tasks[0], calls, prompts, runDir, clonesDir,
           events: proofRunEvents(runDir), evs: allEvents(runDir) }
}

// ── legs (a), (b), (d), (e), (f): one command — order, clone, evidence, event ─
// The command joins the stub's call log (it appends a line of its own) and
// reads a file only the implementer's clone holds: both the ordering and the
// cwd are read off what the driver actually ran.
{
  const orderFile = path.join(tmp, 'order-a1.log')
  const CMD = "sh -c 'echo hello-from-run; cat where.txt; echo proof-run >> " + orderFile + "'"
  const { row, calls, prompts, events } = await scenario({
    task: entry({ proofRuns: [CMD] }),
    onImpl: (cwd) => {
      fs.writeFileSync(path.join(cwd, 'one.txt'), 'from T1\n')
      fs.writeFileSync(path.join(cwd, 'where.txt'), 'inside-task-clone\n')
    },
    orderFile,
  })

  // [M1] after the implementer returned, before the reviewer was called.
  // (the wave's own critic dispatch, `integration`, is not part of the task's
  // own order and is dropped.)
  // The trailing `proof-run` is the DRIVER's own second execution on the
  // adopted tree (#604 (b)+(c), test_run_engine_integrated_runs.mjs owns it):
  // T1 merges, so the same command runs once more in the integration clone
  // after the whole task pipeline. It is pinned here because this file's order
  // log cannot tell the two executions apart, and dropping it would let the
  // integrated pass move without any pin noticing.
  const order = fs.readFileSync(orderFile, 'utf8').split('\n')
    .filter(Boolean).filter((l) => l !== 'integration')
  // The single `proof-run` before the review is the driver's own pre-review
  // pass, whose evidence round 1 reads (#713); the last is the integrated pass
  // on the adopted tree.
  assert.deepEqual(order, ['impl:T1', 'proof-run', 'review:T1:1', 'proof-run'],
    'the Run: command executes ONCE between the implementer and the first review, ' +
    'and again on the adopted tree after it')

  // [M1, M5] one record per execution, exit 0, the command verbatim.
  assert.equal(events.length, 1, 'the one pre-review execution recorded: ' + JSON.stringify(events))
  assert.deepEqual(events.map((e) => e.cmd), [CMD], 'the command is recorded verbatim')
  assert.deepEqual(events.map((e) => e.exit), [0])
  assert.deepEqual(events.map((e) => e.task), ['T1'])
  assert.deepEqual(events.map((e) => e.iter), [0],
    'the driver\'s own pass is iter 0, and round 1 reads it rather than re-executing')

  // [M1, M2] the evidence the reviewer reads: the block, the command, the exit,
  // the output — including the line only the TASK'S OWN CLONE could print.
  const prompt = prompts['review:T1:1']
  assert.ok(prompt.includes('RUN EVIDENCE:'), 'the review prompt carries a RUN EVIDENCE: block')
  const ev = evidenceOf(prompt)
  assert.ok(ev.includes(CMD), 'the block quotes the command verbatim: ' + ev.slice(0, 400))
  assert.ok(ev.includes('exit 0'), 'the block carries `exit 0`: ' + ev.slice(0, 400))
  assert.ok(ev.includes('hello-from-run'), 'the block carries what the command printed')
  assert.ok(ev.includes('inside-task-clone'),
    'the command ran in the task\'s own clone, after the implementer wrote there')

  // [M4] every exit zero → the reviewer's own PASS, unchanged.
  assert.equal(row.status, 'done')
  assert.equal(row.reviewVerdict, 'clean')
  assert.equal(row.fixIterations, 0)
  assert.ok(!calls.some((l) => l.startsWith('fix:')), 'no fix round: ' + calls.join(','))

  // [M6] proofRuns with no proofTests: no examiner, no edited-exam mark.
  assert.ok(!calls.some((l) => l.startsWith('exam:')), 'no exam worker: ' + calls.join(','))
  assert.equal(row.exam, null, 'no exam was recorded')
  assert.equal('examEdited' in row, false, 'and the row is not marked as an edited exam')
}

// ── leg (a): two commands run in Proof order [M1, M5] ───────────────────────
{
  const FIRST = "sh -c 'echo first'"
  const SECOND = "sh -c 'echo second'"
  const { row, prompts, events } = await scenario({
    task: entry({ proofRuns: [FIRST, SECOND] }),
    onImpl: (cwd) => fs.writeFileSync(path.join(cwd, 'one.txt'), 'from T1\n'),
  })
  assert.deepEqual(events.map((e) => e.cmd), [FIRST, SECOND],
    'recorded in Proof order, once, in the driver\'s own pre-review pass')
  assert.deepEqual(events.map((e) => e.exit), [0, 0])
  assert.deepEqual(events.map((e) => e.iter), [0, 0])
  const ev = evidenceOf(prompts['review:T1:1'])
  assert.ok(ev.includes(FIRST) && ev.includes(SECOND), 'both commands are in the block')
  assert.ok(ev.indexOf(FIRST) < ev.indexOf(SECOND), 'and in the order the Proof gave them')
  assert.ok(ev.includes('first') && ev.includes('second'), 'with both outputs')
  assert.equal(row.status, 'done')
}

// ── leg (a): stderr is combined, not dropped [M1, M2] ───────────────────────
// The command is red on every execution, so the driver's pre-review pass takes
// it: one `fix:T1:0` round (the stub's fix changes nothing), still red, and the
// task ends `proof-red` without a referee ever being dispatched. The recorded
// output is what the fix round reads, and it is the same bytes the review
// prompt would have carried.
{
  const CMD = "sh -c 'echo out; echo err 1>&2; exit 1'"
  const { row, calls, prompts, events } = await scenario({
    task: entry({ proofRuns: [CMD] }),
    onImpl: (cwd) => fs.writeFileSync(path.join(cwd, 'one.txt'), 'from T1\n'),
  })
  assert.equal(events.length >= 1, true, 'the failing command is recorded')
  assert.equal(events[0].exit, 1, 'the command\'s own exit code, not a boolean')
  assert.ok(calls.includes('fix:T1:0'), 'the pre-review pass bought one repair round: ' + calls.join(','))
  assert.ok(!calls.some((l) => l.startsWith('review:')),
    'and no referee read a patch whose own proof fails: ' + calls.join(','))
  assert.equal(row.reviewVerdict, 'proof-red')
  const ev = prompts['fix:T1:0']
  assert.ok(/(^|\n)out(\r?\n|$)/.test(ev), 'stdout is in the evidence: ' + ev.slice(-400))
  assert.ok(/(^|\n)err(\r?\n|$)/.test(ev), 'stderr is combined into it, not dropped: ' + ev.slice(-400))
  assert.ok(ev.includes('exit 1'), 'and the exit code the command returned')
}

// ── leg (a): 6,000 characters of output recorded as exactly 4,000 [M1] ──────
// Format-agnostic on purpose: the output is one unbroken run of `x`, so the
// longest such run in the prompt IS the recorded output's length.
{
  const CMD = "sh -c 'i=0; while [ $i -lt 6000 ]; do printf x; i=$((i+1)); done'"
  const { prompts, events } = await scenario({
    task: entry({ proofRuns: [CMD] }),
    onImpl: (cwd) => fs.writeFileSync(path.join(cwd, 'one.txt'), 'from T1\n'),
  })
  assert.equal(events.length, 1, 'the driver\'s own pre-review pass, once')
  assert.deepEqual(events.map((e) => e.exit), [0])
  const runs = (prompts['review:T1:1'].match(/x+/g) || []).map((r) => r.length)
  assert.equal(Math.max(0, ...runs), 4000,
    'a 6,000-character output is truncated to exactly 4,000 characters')
}

// ── legs (b), (e): no proofRuns → no block, no record, and the BASE engine's
// prompt byte for byte [M2, M5]
// The BASE engine, written beside its siblings in a temp copy of fleet/ and
// imported from there, is driven by the same canned agents through the same run
// directory (the review prompt names the patch FILE, so a second directory
// would differ in bytes that are not this change).
// The byte-pin needs BASE in the object store. A depth-1 clone — the engine's
// own shallow leg (run-engine.mjs:1437) and `actions/checkout`'s default — has
// no 0a3559a; there the leg has nothing to say and says so, rather than failing
// for a reason unrelated to the tree (test_run_engine_exam_fix_edit.mjs guards
// the same way, after run-54's depth-1 leg caught exactly this).
const haveBase = (() => {
  try {
    execFileSync('git', ['cat-file', '-e', BASE_SHA + '^{commit}'],
      { cwd: REPO_ROOT, stdio: 'ignore' })
    return true
  } catch { return false }
})()
let baseRunEngine = null
if (haveBase) {
  const baseTree = path.join(tmp, 'base-tree')
  fs.cpSync(FLEET_DIR, path.join(baseTree, 'fleet'), {
    recursive: true, filter: (src) => path.basename(src) !== 'tests',
  })
  fs.writeFileSync(path.join(baseTree, 'fleet', 'run-engine.mjs'),
    execFileSync('git', ['show', BASE_SHA + ':fleet/run-engine.mjs'],
      { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }))
  fs.symlinkSync(path.join(REPO_ROOT, 'skills'), path.join(baseTree, 'skills'))
  ;({ runEngine: baseRunEngine } =
    await import(pathToFileURL(path.join(baseTree, 'fleet', 'run-engine.mjs')).href))
} else {
  console.log('[M2] BASE ' + BASE_SHA + ' is not in this clone (shallow) — the ' +
    'byte-for-byte comparison against the BASE engine is skipped')
}

const PIN_REPO = makeRepo(path.join(tmp, 'pin-repo'))
const pinRunDir = path.join(tmp, 'pin-run')
async function pinPrompt(engine, task) {
  fs.rmSync(pinRunDir, { recursive: true, force: true })
  const { base, clonesDir, patchesDir } = provision({ repo: PIN_REPO, runDir: pinRunDir, taskIds: ['T1'] })
  const patchBase = { current: base }
  const cwdFor = makeCwdFor({ clonesDir })
  let prompt = null
  const inner = async (p, opts) => {
    const cwd = cwdFor(opts)
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') { fs.writeFileSync(path.join(cwd, 'one.txt'), 'from T1\n'); return doneImpl(cwd) }
    if (kind === 'review') { prompt = p; return passReview() }
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const agent = withPatchCapture({
    agent: inner, clonesDir, base: () => patchBase.current, patchesDir, taskIdOf: defaultTaskIdOf,
  })
  await engine({
    args: {
      waves: [[task]], edges: [], testCmd: 'bash check.sh',
      acceptance: { mode: 'suite', reason: 'sim' }, stamp: 'pin',
      integrationBranch: 'ultra/integration-pin', dependencyEdges: [],
      patchInput: patchesDir, shallowLeg: false,
    },
    agent,
    parallel: (thunks) => Promise.all(thunks.map((t) => t())),
    exec: execSeam,
    paths: { repoDir: PIN_REPO, runDir: pinRunDir, clonesDir },
    log: () => {},
    rolesDir: ROLES_DIR,
    patchBase,
  })
  return { prompt, events: proofRunEvents(pinRunDir) }
}
{
  const absent = entry()
  delete absent.proofRuns
  const basePin = haveBase ? await pinPrompt(baseRunEngine, entry()) : null
  const liveEmpty = await pinPrompt(runEngine, entry({ proofRuns: [] }))
  const liveAbsent = await pinPrompt(runEngine, absent)

  for (const [name, p] of [...(basePin ? [['BASE', basePin]] : []),
                           ['proofRuns: []', liveEmpty], ['no proofRuns key', liveAbsent]]) {
    assert.equal(typeof p.prompt, 'string', name + ': the reviewer was dispatched')
    assert.ok(!p.prompt.includes('RUN EVIDENCE:'), name + ': no RUN EVIDENCE: block')
  }
  if (basePin) {
    assert.equal(liveEmpty.prompt, basePin.prompt,
      'proofRuns: [] leaves the reviewer prompt byte-identical to BASE\'s')
    assert.equal(liveAbsent.prompt, basePin.prompt,
      'an absent proofRuns leaves the reviewer prompt byte-identical to BASE\'s')
  }
  // [M5] and nothing is recorded for a task with no commands.
  assert.deepEqual(liveEmpty.events, [], 'an empty proofRuns records no driver:proof-run')
  assert.deepEqual(liveAbsent.events, [], 'an absent proofRuns records no driver:proof-run')
}

// ── legs (c), (e): a non-zero exit outranks the reviewer's PASS [M3, M5] ────
// The canned PASS never gets the chance: the driver's own pass is red, buys one
// repair round, is red again, and the task fails without a referee. Same fact
// the leg always pinned — a red command cannot merge on a canned PASS — one
// repair round earlier and two reviewer calls cheaper.
{
  const CMD = "sh -c 'echo broken; exit 3'"
  const { row, report, calls, prompts, events } = await scenario({
    task: entry({ proofRuns: [CMD] }),
    onImpl: (cwd) => fs.writeFileSync(path.join(cwd, 'one.txt'), 'from T1\n'),
    review: () => passReview(),          // the reviewer says PASS, every round
  })
  assert.ok(calls.includes('fix:T1:0'), 'the repair round is dispatched: ' + calls.join(','))
  assert.ok(!calls.some((l) => l.startsWith('review:')),
    'and no reviewer minute is spent on it: ' + calls.join(','))
  assert.equal(row.status, 'failed', 'a failing Run: command cannot merge on a canned PASS')
  assert.equal(row.reviewVerdict, 'proof-red')
  assert.equal(row.proofFixes, 1, 'one pre-review repair round, and only one')
  assert.equal(report.coverage.tasks_merged, 0)
  // The recorded issue names the command and its exit code.
  assert.ok(row.notes.includes(CMD), 'the recorded issue names the command: ' + row.notes)
  assert.ok(row.notes.includes('exit 3'), 'and its exit code: ' + row.notes)
  const fixPrompt = prompts['fix:T1:0']
  assert.ok(fixPrompt.includes(CMD), 'the fix round is told which command failed')
  assert.ok(fixPrompt.includes('exit 3'), 'and with what exit code')
  // [M5] one record per execution — the commands run again for the second pass.
  assert.deepEqual(events.map((e) => e.exit), [3, 3])
  assert.deepEqual(events.map((e) => e.iter), [0, 0], 'both in the driver\'s own pass')
  assert.deepEqual(events.map((e) => e.cmd), [CMD, CMD])
  assert.deepEqual(events.map((e) => e.task), ['T1', 'T1'])
}

// ── leg (c): the fix round's work is re-run, new evidence replaces old [M3] ─
{
  // The command READS a file the fix round writes, so the post-repair output is
  // a string the command text itself does not contain: fresh evidence, not the
  // same block twice.
  // No digit in the command text, so an exit code found in the block is one the
  // driver recorded rather than the command quoted back.
  const CMD = "sh -c 'cat fixed.txt'"
  const { row, calls, prompts, events } = await scenario({
    task: entry({ proofRuns: [CMD] }),
    onImpl: (cwd) => fs.writeFileSync(path.join(cwd, 'one.txt'), 'from T1\n'),
    onFix: (cwd) => fs.writeFileSync(path.join(cwd, 'fixed.txt'), 'repaired-by-the-fix-round\n'),
    review: () => passReview(),
  })
  assert.deepEqual(calls.filter((l) => l !== 'integration'),
    ['impl:T1', 'fix:T1:0', 'review:T1:1'],
    'red command → repair round → the first review, on a green tree')
  assert.equal(row.status, 'done', 'the second run is green, so the reviewer\'s PASS stands')
  assert.equal(row.reviewVerdict, 'clean',
    'the referee saw the repaired tree once and passed it — no fix round of its own')
  assert.equal(row.fixIterations, 0)
  assert.equal(row.proofFixes, 1)
  const repair = prompts['fix:T1:0']
  const reviewed = evidenceOf(prompts['review:T1:1'])
  assert.ok(repair.includes('exit 1'), 'the repair round read the failing run')
  assert.ok(!repair.includes('repaired-by-the-fix-round'),
    'and nothing from a run that had not happened yet')
  assert.ok(reviewed.includes('exit 0'), 'the review round reads the repeated pass')
  assert.ok(reviewed.includes('repaired-by-the-fix-round'),
    'carrying what the command printed after the fix round')
  assert.ok(!reviewed.includes('exit 1'),
    'the new evidence REPLACES the old: ' + reviewed.slice(0, 400))
  assert.deepEqual(events.map((e) => e.exit), [1, 0])
  assert.deepEqual(events.map((e) => e.iter), [0, 0],
    'the red pass and the repeat that follows the repair round, both iter 0 — and no ' +
    'third execution before round 1')
}

// ── leg (d): all-zero runs leave the reviewer's verdict alone [M4] ──────────
{
  // Green command, canned FIX_REQUIRED: the verdict is the reviewer's own, and
  // the driver contributes no issue of its own.
  const CMD = "sh -c 'echo hello-from-run'"
  const { row, calls, events } = await scenario({
    task: entry({ proofRuns: [CMD] }),
    onImpl: (cwd) => fs.writeFileSync(path.join(cwd, 'one.txt'), 'from T1\n'),
    review: () => ({ verdict: 'FIX_REQUIRED',
                     issues: [{ severity: 'blocking', detail: 'the reviewer is not satisfied' }] }),
  })
  assert.deepEqual(events.map((e) => e.exit), [0, 0],
    'green in the driver\'s pass and in the fresh execution round 2 takes after the fix')
  assert.deepEqual(events.map((e) => e.iter), [0, 2],
    'round 1 reads the pass; only the post-fix round executes afresh')
  assert.ok(calls.includes('fix:T1:1'), 'the reviewer\'s FIX_REQUIRED still drives the fix loop')
  assert.equal(row.status, 'failed')
  assert.equal(row.reviewVerdict, 'fix-loop-exhausted')
  assert.equal(row.notes, 'the reviewer is not satisfied',
    'the recorded issues are the reviewer\'s own, with nothing added by the runs')
}

// ── leg (f): proofRuns with the proofTests key absent dispatches no examiner [M6]
{
  const task = entry({ proofRuns: ["sh -c 'echo hello-from-run'"] })
  delete task.proofTests
  const { row, calls, events } = await scenario({
    task,
    onImpl: (cwd) => fs.writeFileSync(path.join(cwd, 'one.txt'), 'from T1\n'),
  })
  assert.deepEqual(calls, ['impl:T1', 'review:T1:1', 'integration'],
    'no exam worker starts for a Run:-only proof')
  assert.equal(row.exam, null)
  assert.equal('examEdited' in row, false, 'and no exam-edited entry is recorded')
  assert.equal(events.length, 1, 'the command still ran, once, in the driver\'s own pass')
  assert.equal(row.status, 'done')
}

// ── Task 1 (#632 part 2): the driver hands its `Run:` commands the base sha ──
// The Claim: `ULTRA_BASE` is set by the engine from the wave's base — the task
// clone's BASE for the per-task pass, the run base for the integrated pass —
// so a Global Constraint like `git diff --quiet $ULTRA_BASE -- fleet/` is
// writable at all. This file owns the `Run:` half (legs (a), (b), (e)); the
// `Check:` half is test_run_engine_pre_review.mjs's legs (c), (d), (g).
//
// One command's evidence, read out of a rendered block: everything from
// `\n\n$ <cmd>\n` up to the next `\n\n$ ` (or the block's end) is that
// command's `exit <n>` line and its recorded output, and nothing else's.
const segmentOf = (block, cmd) => {
  const marker = '\n\n$ ' + cmd + '\n'
  const i = String(block || '').indexOf(marker)
  if (i === -1) return null
  const rest = block.slice(i + marker.length)
  const j = rest.indexOf('\n\n$ ')
  return j === -1 ? rest : rest.slice(0, j)
}

// ── leg (a): the value in the environment IS the task clone's BASE [M1] ──────
// `printenv ULTRA_BASE` carries no `$` anywhere in its text, so a value that
// appears in the evidence cannot have been substituted into the command by the
// shell or quoted back by the driver — only the process environment can have
// supplied it. The second command is the same fact as an exit code.
{
  const PRINTENV = 'printenv ULTRA_BASE'
  const repo = makeRepo(path.join(tmp, 'repo-ub1'))
  const runDir = path.join(tmp, 'run-ub1')
  const base = gitSync(['rev-parse', 'HEAD'], repo)
  assert.match(base, /^[0-9a-f]{40}$/,
    'sim precondition: the repo\'s BASE is forty lowercase hex characters')
  const TEST_EQ = 'test "$ULTRA_BASE" = ' + base
  assert.equal(PRINTENV.includes('$'), false,
    'the printenv command text holds no `$`: the sha it prints can only have come from ' +
    'the process environment')

  const prompts = {}
  const stub = (prompt, opts, cwd) => {
    prompts[opts.label] = prompt
    const kind = opts.label.split(':')[0]
    if (kind === 'impl' || kind === 'fix') {
      fs.writeFileSync(path.join(cwd, 'one.txt'), 'from T1\n')
      return doneImpl(cwd)
    }
    if (kind === 'review') return passReview()
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run, base: rigBase } = rig({
    repo, runDir, stub, stamp: 'ub1', extraArgs: { shallowLeg: false },
    waves: [[entry({ proofRuns: [PRINTENV, TEST_EQ] })]],
  })
  assert.equal(rigBase, base, 'sim precondition: every clone was provisioned at that sha')
  const report = await run()
  const row = report.tasks[0]
  const events = proofRunEvents(runDir)

  // [M1] both commands are green on the driver's own pass (`iter: 0`), whose
  // evidence round 1 reads — `test "$ULTRA_BASE" = <BASE>` exits 0 only if the
  // engine put that sha in the environment.
  assert.deepEqual(events.map((e) => e.exit), [0, 0],
    'each Proof `Run:` executes with ULTRA_BASE set to the task clone\'s BASE — an unset ' +
    'variable makes `printenv ULTRA_BASE` and `test "$ULTRA_BASE" = <BASE>` both red: ' +
    JSON.stringify(events.map((e) => ({ cmd: e.cmd, exit: e.exit, iter: e.iter }))))
  assert.deepEqual(events.map((e) => e.cmd), [PRINTENV, TEST_EQ],
    'both commands, in Proof order, on the one pre-review pass')
  assert.deepEqual(events.map((e) => e.iter), [0, 0],
    'the driver\'s own pass is iter 0, and round 1 reads it rather than re-executing')
  assert.equal(row.status, 'done', 'the task merges: ' + JSON.stringify(row))
  assert.equal(row.reviewVerdict, 'clean', JSON.stringify(row))

  // [M1] and the recorded evidence carries the sha itself, on a line of its own.
  const ev = evidenceOf(prompts['review:T1:1'])
  assert.ok(ev.includes('RUN EVIDENCE:'), 'sim precondition: the RUN EVIDENCE block is rendered')
  const seg = segmentOf(ev, PRINTENV)
  assert.ok(seg !== null,
    'the block quotes `' + PRINTENV + '` verbatim: ' + JSON.stringify(ev.slice(0, 600)))
  const lines = seg.split('\n')
  assert.equal(lines[0], 'exit 0', 'printenv found the variable: ' + JSON.stringify(seg))
  assert.ok(lines.slice(1).includes(base),
    'an output line under `' + PRINTENV + '` is exactly the rig\'s base ' + base + ': ' +
    JSON.stringify(seg))
  assert.ok(lines.slice(1).some((l) => /^[0-9a-f]{40}$/.test(l)),
    'and that value is forty lowercase hex characters: ' + JSON.stringify(seg))
}

// ── leg (b): wave 2 gets wave 1's adopted head; the integrated pass gets the
// run base [M1] [M3]
// The two shas differ only from wave 2 onward, which is why this leg is
// two-wave: in wave 1 `waveBaseSha` and `baseSha` coincide and any confusion
// between them is invisible.
{
  const ECHO = "sh -c 'echo base=$ULTRA_BASE'"
  const repo = makeRepo(path.join(tmp, 'repo-ub2'))
  const runDir = path.join(tmp, 'run-ub2')
  const waves = [
    [entry({ id: 'T1', files: ['one.txt'], writes: ['one.txt'] })],
    [entry({ id: 'T2', files: ['two.txt'], writes: ['two.txt'], proofRuns: [ECHO] })],
  ]
  const prompts = {}
  const stub = (prompt, opts, cwd) => {
    prompts[opts.label] = prompt
    const kind = opts.label.split(':')[0]
    const id = opts.label.split(':')[1]
    if (kind === 'impl' || kind === 'fix') {
      fs.writeFileSync(path.join(cwd, id === 'T1' ? 'one.txt' : 'two.txt'), 'from ' + id + '\n')
      return doneImpl(cwd)
    }
    if (kind === 'review') return passReview()
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run, base } = rig({ repo, runDir, waves, edges: [['T1', 'T2']], stub, stamp: 'ub2',
                              extraArgs: { shallowLeg: false } })
  const report = await run()

  assert.equal(report.coverage.complete, true, 'sim precondition: both waves adopted')
  assert.equal(report.waveMerges.length, 2, 'sim precondition: two folded waves')
  const w1 = report.waveMerges[0].headSha
  const w2 = report.waveMerges[1].headSha
  assert.match(String(w1), /^[0-9a-f]{40}$/, 'sim precondition: wave 1 adopted a head')
  assert.notEqual(w1, base,
    'sim precondition: wave 1\'s adopted head is not the run base — the two shas the leg ' +
    'distinguishes actually differ here')

  // [M1] the per-task pass in wave 2 sees the task's OWN base: wave 1's head.
  const ev2 = evidenceOf(prompts['review:T2:1'])
  assert.ok(ev2.includes('base=' + w1),
    'wave 2\'s `Run:` ran with ULTRA_BASE = waveMerges[0].headSha (' + w1 + '): ' +
    JSON.stringify(ev2.slice(0, 600)))
  assert.ok(!ev2.includes('base=' + base),
    'and NOT the run base — a wave-2 task re-anchored onto the adopted head must be handed ' +
    'that head: ' + JSON.stringify(ev2.slice(0, 600)))

  // [M3] the integrated pass sees the RUN base, in wave 2 as in wave 1 — never
  // the adopted head, against which any diff is a tautology.
  const integrated = report.integratedRuns.filter((r) => r.task === 'T2')
  assert.equal(integrated.length, 1,
    'one integrated run for T2: ' + JSON.stringify(report.integratedRuns))
  assert.ok(String(integrated[0].stdout).includes('base=' + base),
    'the integrated pass runs with ULTRA_BASE = the run base ' + base + ': ' +
    JSON.stringify(integrated[0]))
  assert.ok(!String(integrated[0].stdout).includes(String(w2)),
    'never wave 2\'s own adopted head ' + w2 + ': ' + JSON.stringify(integrated[0]))
  assert.ok(!String(integrated[0].stdout).includes(String(w1)),
    'and never wave 1\'s: ' + JSON.stringify(integrated[0]))
}

// ── leg (e): the header comment names the variable [M4] ──────────────────────
// Read only above the first line beginning `import `, so a mention anywhere in
// the body of the module does not satisfy it.
{
  const src = fs.readFileSync(fileURLToPath(new URL('../run-engine.mjs', import.meta.url)), 'utf8')
  const srcLines = src.split('\n')
  const firstImport = srcLines.findIndex((l) => l.startsWith('import '))
  assert.ok(firstImport > 0, 'sim precondition: run-engine.mjs has a first `import ` line')
  const header = srcLines.slice(0, firstImport).join('\n')
  assert.ok(header.includes('ULTRA_BASE'),
    'the header comment of fleet/run-engine.mjs, above its first import, must name ' +
    'ULTRA_BASE — the seam a reader arriving at the file needs told:\n' +
    JSON.stringify(header.slice(-400)))
}

// ════════════════════════════════════════════════════════════════════════════
// #713 Task 1 — the driver runs a green proof ONCE before the first review.
//
// The BASE mechanism, by line: `prePass` calls `runCommands(0)`, `runExam(0)`
// and `runChecks(0)` and returns only the reds, discarding the evidence; the
// review loop then calls all three again at `iter: 1` before building the round-1
// prompt, on the same clone and the same tree the pass just measured, with no
// agent in between. So every command a green task declares is executed twice
// before its first referee. The clauses below pin the single execution: round 1
// READS the pass's evidence, and a fresh execution happens only at `iter: 2`,
// after a review-round fix.
//
//   M1 — a task whose every proofRuns command, exam and non-minor Check: exits 0
//        on the pre-review pass records exactly one `driver:proof-run` per
//        proofRuns entry, one `driver:exam-run` when the exam is runnable and
//        one `driver:check-run` per Check:, all at `iter: 0` and all before the
//        first `review:` dispatch; and the `review:<id>:1` prompt's RUN, EXAM
//        and CHECK EVIDENCE blocks carry that pass's commands, exits and outputs.
//   M2 — a red pass buys one `fix:<id>:0` round and one re-execution, both at
//        `iter: 0`, and round 1 reads the re-execution — no third execution.
//   M3 — a review-round fix (`fix:<id>:1`) is followed by one fresh execution at
//        `iter: 2`, and `review:<id>:2` carries it and not round 1's.
//   M4 — the order around the referee and the row's proofFixes / fixIterations /
//        reviewVerdict / status are BASE's for the same canned judgments.
//   M5 — the five sims this re-scopes still print `ALL TESTS PASSED`, and a copy
//        of each that still asserts its BASE-era second execution prints none.

// ── #713 Task 1 leg (a): two Run:, one Check:, one runnable exam, all green [M1]
// Every execution the driver makes appends its own line to the dispatch log, so
// how many there are and where they sit relative to `review:T1:1` is read off
// what the driver actually ran rather than off anything it reports about itself.
{
  const orderFile = path.join(tmp, 'order-713a.log')
  const EXAM_CMD = 'bash t1_test.sh'
  const FIRST = "sh -c 'echo first-command; cat where.txt; echo run-1 >> " + orderFile + "'"
  const SECOND = "sh -c 'echo second-command; echo run-2 >> " + orderFile + "'"
  const CHECK = "sh -c 'echo check-line; echo check-run >> " + orderFile + "'"
  // Red at BASE (no `one.txt` in the examiner's clone), green on the patch.
  const EXAM = '#!/bin/bash\n' +
    "echo exam-run >> '" + orderFile + "'\n" +
    'echo exam-line\n' +
    '[ -f one.txt ]\n'
  const { row, prompts, evs } = await scenario({
    task: entry({ proofRuns: [FIRST, SECOND], proofTests: ['t1_test.sh'], testCmd: EXAM_CMD }),
    examScript: EXAM,
    constraintChecks: [{ cmd: CHECK, minor: false }],
    onImpl: (cwd) => {
      fs.writeFileSync(path.join(cwd, 'one.txt'), 'from T1\n')
      fs.writeFileSync(path.join(cwd, 'where.txt'), 'inside-task-clone\n')
    },
    orderFile,
  })

  // [M1] one execution of each kind, all of them before the first referee. The
  // FIRST `exam-run` is the examiner's own red-at-BASE probe in the examiner's
  // clone, which this change leaves exactly as it was.
  const order = fs.readFileSync(orderFile, 'utf8').split('\n')
    .filter(Boolean).filter((l) => l !== 'integration')
  assert.deepEqual(order.slice(0, order.indexOf('review:T1:1') + 1),
    ['exam:T1', 'impl:T1', 'exam-run', 'run-1', 'run-2', 'exam-run', 'check-run', 'review:T1:1'],
    'both Run: commands, the exam and the Check: each execute ONCE, in that order, between ' +
    'the implementer and the first review: ' + JSON.stringify(order))

  // [M1] exactly one `driver:proof-run` per proofRuns entry, in Proof order.
  const runs = ofKind(evs, 'driver:proof-run')
  assert.deepEqual(runs.map((e) => e.cmd), [FIRST, SECOND],
    'exactly two driver:proof-run events, the first command then the second: ' +
    JSON.stringify(runs.map((e) => [e.cmd, e.exit, e.iter])))
  assert.deepEqual(runs.map((e) => e.exit), [0, 0])
  assert.deepEqual(runs.map((e) => e.iter), [0, 0])

  // [M1] exactly one `driver:exam-run` and exactly one `driver:check-run`.
  const exams = ofKind(evs, 'driver:exam-run')
  assert.deepEqual(exams.map((e) => [e.cmd, e.exit, e.iter]), [[EXAM_CMD, 0, 0]],
    'one driver:exam-run for a task with a runnable exam, at iter 0: ' + JSON.stringify(exams))
  const checks = ofKind(evs, 'driver:check-run')
  assert.deepEqual(checks.map((e) => [e.cmd, e.exit, e.iter]), [[CHECK, 0, 0]],
    'one driver:check-run per Check:, at iter 0: ' + JSON.stringify(checks))

  // [M1] and nothing of the three kinds belongs to a review round at all.
  const KINDS = ['driver:proof-run', 'driver:exam-run', 'driver:check-run']
  assert.deepEqual(
    evs.filter((e) => KINDS.indexOf(e.kind) !== -1 && e.task === 'T1' && e.iter === 1), [],
    'no driver execution of any of the three kinds carries iter 1 — round 1 reads the pass ' +
    'the driver already made rather than measuring the same tree twice')

  // [M1] the three evidence blocks the referee reads are that pass's bytes.
  const prompt = prompts['review:T1:1']
  const ev = evidenceOf(prompt)
  assert.ok(ev.includes('\n\n$ ' + FIRST + '\nexit 0\n'),
    'the RUN EVIDENCE block quotes the first command with exit 0: ' + ev.slice(0, 600))
  assert.ok(ev.includes('\n\n$ ' + SECOND + '\nexit 0\n'),
    'and the second: ' + ev.slice(0, 600))
  assert.ok(ev.indexOf(FIRST) < ev.indexOf(SECOND), 'in the order the Proof gave them')
  assert.ok(ev.includes('first-command') && ev.includes('second-command'),
    'with what each printed')
  assert.ok(ev.includes('inside-task-clone'),
    'including the line only the task\'s own clone could print — the pass ran there, after ' +
    'the implementer wrote it: ' + ev.slice(0, 600))
  assert.ok(prompt.includes('\n\n$ ' + EXAM_CMD + '\nexit 0\n') && prompt.includes('exam-line'),
    'the EXAM EVIDENCE block carries the pass\'s exam command, exit and output')
  assert.ok(prompt.includes('\n\n$ ' + CHECK + '\nexit 0\n') && prompt.includes('check-line'),
    'and the CHECK EVIDENCE block the pass\'s Check: command, exit and output')

  assert.equal(row.status, 'done', JSON.stringify(row))
  assert.equal(row.proofFixes, 0)
}

// ── #713 Task 1 leg (b): one green command, the whole order, the whole row [M1, M4]
{
  const orderFile = path.join(tmp, 'order-713b.log')
  const CMD = "sh -c 'echo green-every-time; echo proof-run >> " + orderFile + "'"
  const { row, calls, events } = await scenario({
    task: entry({ proofRuns: [CMD] }),
    onImpl: (cwd) => fs.writeFileSync(path.join(cwd, 'one.txt'), 'from T1\n'),
    orderFile,
  })
  const order = fs.readFileSync(orderFile, 'utf8').split('\n')
    .filter(Boolean).filter((l) => l !== 'integration')
  assert.deepEqual(order, ['impl:T1', 'proof-run', 'review:T1:1', 'proof-run'],
    'the implementer, ONE pre-review execution, the first review, and the integrated pass ' +
    'on the adopted tree — a BASE engine records a second execution before the review: ' +
    JSON.stringify(order))
  assert.deepEqual(events.map((e) => e.iter), [0], JSON.stringify(events))
  // [M4] the row is BASE's for the same canned judgments.
  assert.equal(row.status, 'done', JSON.stringify(row))
  assert.equal(row.reviewVerdict, 'clean')
  assert.equal(row.fixIterations, 0)
  assert.equal(row.proofFixes, 0)
  assert.ok(!calls.some((l) => l.startsWith('fix:')), 'no fix: label was dispatched: ' + calls.join(','))
}

// ── #713 Task 1 leg (c): a red pass, its repair round, and its ONE repeat [M2] ─
// The command reads a file only the repair round writes, so the second reading
// is a string the command text does not contain: the evidence round 1 is handed
// is the re-execution's, and no third execution happened before it.
{
  const CMD = "sh -c 'cat repaired.txt'"
  const { row, calls, prompts, events } = await scenario({
    task: entry({ proofRuns: [CMD] }),
    onImpl: (cwd) => fs.writeFileSync(path.join(cwd, 'one.txt'), 'from T1\n'),
    onFix: (cwd) => fs.writeFileSync(path.join(cwd, 'repaired.txt'), 'written-by-the-repair-round\n'),
  })
  assert.deepEqual(calls.filter((l) => l !== 'integration'),
    ['impl:T1', 'fix:T1:0', 'review:T1:1'],
    'implementer, one repair round, the first review: ' + calls.join(','))
  assert.equal(events.length, 2,
    'exactly two executions — the red pass and the repeat after the repair; an engine that ' +
    'executes a third time before round 1 records three: ' + JSON.stringify(events))
  assert.deepEqual(events.map((e) => e.exit), [1, 0])
  assert.deepEqual(events.map((e) => e.iter), [0, 0], 'both belong to the driver\'s own pass')
  const ev = evidenceOf(prompts['review:T1:1'])
  assert.ok(ev.includes('exit 0'), 'round 1 reads the green re-execution: ' + ev.slice(0, 400))
  assert.ok(ev.includes('written-by-the-repair-round'),
    'carrying what the command printed after the repair: ' + ev.slice(0, 400))
  assert.ok(!ev.includes('exit 1'), 'and not the red reading it replaced: ' + ev.slice(0, 400))
  assert.equal(row.proofFixes, 1)
  assert.equal(row.fixIterations, 0, 'a pre-review repair is not a review fix iteration')
}

// ── #713 Task 1 leg (d): a review-round fix buys the fresh execution [M3] ────
// The command prints a file the review fix rewrites — the only thing that can
// tell round 2's evidence from round 1's, since no agent runs between the pass
// and round 1.
{
  const CMD = "sh -c 'cat v.txt'"
  const BEFORE = 'content-before-the-review-fix'
  const AFTER = 'content-after-the-review-fix'
  const { row, calls, prompts, events } = await scenario({
    task: entry({ proofRuns: [CMD] }),
    onImpl: (cwd) => {
      fs.writeFileSync(path.join(cwd, 'one.txt'), 'from T1\n')
      fs.writeFileSync(path.join(cwd, 'v.txt'), BEFORE + '\n')
    },
    onFix: (cwd) => fs.writeFileSync(path.join(cwd, 'v.txt'), AFTER + '\n'),
    review: (n) => (n === 1
      ? { verdict: 'FIX_REQUIRED',
          issues: [{ severity: 'blocking', detail: 'round 1 wants v.txt rewritten' }] }
      : passReview()),
  })
  assert.deepEqual(calls.filter((l) => l !== 'integration'),
    ['impl:T1', 'review:T1:1', 'fix:T1:1', 'review:T1:2'],
    'no pre-review repair round, one review fix, two rounds: ' + calls.join(','))
  assert.equal(events.length, 2,
    'two executions in all: the pre-review pass and round 2\'s fresh one: ' + JSON.stringify(events))
  assert.deepEqual(events.map((e) => e.iter), [0, 2],
    'the pass is iter 0 and the post-fix execution is iter 2 — the number of the round that ' +
    'produced it, so a sense pass counting executions per iter keeps its meaning')
  const r1 = evidenceOf(prompts['review:T1:1'])
  assert.ok(r1.includes(BEFORE), 'round 1 read the pre-review pass\'s own output: ' + r1.slice(0, 400))
  const r2 = evidenceOf(prompts['review:T1:2'])
  assert.ok(r2.includes(AFTER),
    'round 2 reads the execution that followed the fix: ' + r2.slice(0, 400))
  assert.ok(!r2.includes(BEFORE),
    'and not round 1\'s, which predates the repair: ' + r2.slice(0, 400))
  assert.equal(row.fixIterations, 1, JSON.stringify(row))
  assert.equal(row.reviewVerdict, 'fixed', JSON.stringify(row))
}

// ── #713 Task 1 leg (e): red on every execution — BASE's shape, unchanged [M2, M4]
{
  const CMD = "sh -c 'echo still-broken; exit 3'"
  const { row, calls, events } = await scenario({
    task: entry({ proofRuns: [CMD] }),
    onImpl: (cwd) => fs.writeFileSync(path.join(cwd, 'one.txt'), 'from T1\n'),
  })
  assert.deepEqual(calls.filter((l) => l !== 'integration'), ['impl:T1', 'fix:T1:0'],
    'one repair round and no referee at all: ' + calls.join(','))
  assert.ok(!calls.some((l) => l.startsWith('review:')), calls.join(','))
  assert.equal(events.length, 2, JSON.stringify(events))
  assert.deepEqual(events.map((e) => e.exit), [3, 3])
  assert.deepEqual(events.map((e) => e.iter), [0, 0])
  assert.equal(row.status, 'failed', JSON.stringify(row))
  assert.equal(row.reviewVerdict, 'proof-red')
  assert.equal(row.proofFixes, 1)
}

// ── #713 Task 1 legs (f)–(j): the five re-scoped sims, and their controls [M5] ─
// Each leg has two halves. The first is the `Run:` proof itself — the sim still
// prints `ALL TESTS PASSED` — and the driver executes those five commands. The
// second is the half a green sentinel cannot show on its own: that the sim's
// re-scoped pin is a pin and not a deletion. So each sim is COPIED, its own
// sentinel line is preceded by a marker and by a self-contained probe that still
// asserts the BASE-era second execution the leg names, and the copy must print
// the marker (its own legs held, exactly as its sentinel says) and NOT the
// sentinel (the BASE-era pin no longer holds). At BASE both are printed, which
// is the reading of "prints none" that has any content.
//
// The copy is rebased rather than moved: relative specifiers become absolute
// URLs into the real fleet/ and fleet/tests/, and `import.meta.url` becomes the
// original file's URL, so the copy reads the same helpers, roles and repo root
// the sim does and nothing is written inside the repo.
const TESTS_DIR = fileURLToPath(new URL('.', import.meta.url))
const TESTS_URL = new URL('.', import.meta.url).href
const FLEET_URL = new URL('..', import.meta.url).href
const HELPERS_URL = new URL('./_engine_helpers.mjs', import.meta.url).href
const BODY_GREEN = 'SIM-BODY-GREEN'

// The probe spliced into a copy: its own imports, its own repo and its own run
// directory (so it cannot collide with the sim it sits in), one task through the
// real engine, then `pin` — an expression over `evs`, the run's own records.
const probeSource = ({ tag, runs = [], checks = [], exam = false, pin, why }) => `
{ // #713 Task 1 — the BASE-era pin this copy still asserts
  const _assert = (await import('node:assert/strict')).default
  const _fs = (await import('node:fs')).default
  const _os = (await import('node:os')).default
  const _pp = (await import('node:path')).default
  const _h = await import(${JSON.stringify(HELPERS_URL)})
  const _tmp = _fs.mkdtempSync(_pp.join(_os.tmpdir(), 'probe-${tag}-'))
  const _task = {
    id: 'T1', title: 'probe', files: ['one.txt'], tier: 'standard', review: 'lean',
    writes: ['one.txt'], commutes: [],
    interfaces: { consumes: ['\`BASE_FACTS\`'], produces: ['\`ONE\`'] },
    testCmd: ${exam ? "'bash t1_test.sh'" : "'bash check.sh'"},
    proofTests: ${exam ? "['t1_test.sh']" : '[]'},
    proofRuns: ${JSON.stringify(runs)},
    body: '**Claim:** the tree gains one.txt\\n' +
      'Machine: M1. The tree holds \\\`one.txt\\\`.\\n\\n' +
      '**Proof:**\\n- Legs: (a) it does [M1]',
  }
  const _stub = (prompt, opts, cwd) => {
    const kind = opts.label.split(':')[0]
    if (kind === 'exam') {
      _fs.writeFileSync(_pp.join(cwd, 't1_test.sh'), '#!/bin/bash\\n[ -f one.txt ]\\n')
      return { status: 'DONE', summary: 'exam written' }
    }
    if (kind === 'impl' || kind === 'fix') {
      _fs.writeFileSync(_pp.join(cwd, 'one.txt'), 'from T1\\n')
      return _h.doneImpl(cwd)
    }
    if (kind === 'review') return _h.passReview()
    if (opts.label === 'integration') return _h.cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const _r = _h.rig({
    repo: _h.makeRepo(_pp.join(_tmp, 'repo')), runDir: _pp.join(_tmp, 'run'),
    waves: [[_task]], stub: _stub, stamp: '${tag}',
    extraArgs: { shallowLeg: false, constraintChecks: ${JSON.stringify(checks)} },
  })
  await _r.run()
  const evs = _fs.readFileSync(_pp.join(_tmp, 'run', 'events.jsonl'), 'utf8')
    .split('\\n').filter(Boolean).map((l) => JSON.parse(l))
  _fs.rmSync(_tmp, { recursive: true, force: true })
  _assert.ok(${pin}, ${JSON.stringify(why)} + ': ' +
    JSON.stringify(evs.filter((e) => String(e.kind).indexOf('driver:') === 0)
      .map((e) => [e.kind, e.iter, e.exit])))
}
`

const rebase = (text, simName) => text
  .replace(/from '\.\.\//g, () => 'from \'' + FLEET_URL)
  .replace(/from '\.\//g, () => 'from \'' + TESTS_URL)
  .replace(/import\.meta\.url/g, () => JSON.stringify(new URL(simName, TESTS_URL).href))

const copyWithProbe = (simName, probe) => {
  const lines = fs.readFileSync(path.join(TESTS_DIR, simName), 'utf8').split('\n')
  let k = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('console.log(') && lines[i].includes('ALL TESTS PASSED')) k = i
  }
  assert.ok(k !== -1,
    simName + ' ends with a top-level `console.log` of its sentinel — the copy is built ' +
    'by splicing the probe in ahead of that line')
  const out = path.join(tmp, 'copy-' + simName)
  fs.writeFileSync(out,
    rebase(lines.slice(0, k).join('\n'), simName) +
    '\nconsole.log(' + JSON.stringify(BODY_GREEN) + ')\n' + probe + '\n' +
    rebase(lines.slice(k).join('\n'), simName) + '\n')
  return out
}

const TOGGLE = "sh -c 'if [ -e seen.txt ]; then exit 1; else : > seen.txt; fi'"
for (const [leg, simName, probe, pinName] of [
  // (f) the pre-review sim: its `[M3]` review-round `driver:check-run` at iter 1.
  ['f', 'test_run_engine_pre_review.mjs',
    probeSource({ tag: 'f713', checks: [{ cmd: 'test -e one.txt', minor: false }],
      pin: 'evs.some((e) => e.kind === \'driver:check-run\' && e.task === \'T1\' && e.iter === 1)',
      why: 'BASE ran the Check: again for the review round' }),
    'a `driver:check-run` at `iter` 1'],
  // (g) the exam-evidence sim: two post-patch `driver:exam-run` events.
  ['g', 'test_run_engine_exam_evidence.mjs',
    probeSource({ tag: 'g713', exam: true,
      pin: 'evs.filter((e) => e.kind === \'driver:exam-run\' && e.task === \'T1\').length === 2',
      why: 'BASE recorded two post-patch driver:exam-run events' }),
    'two post-patch `driver:exam-run` events'],
  // (h) the implementer-suite sim: a `driver:exam-run` at iter 1.
  ['h', 'test_run_engine_implementer_suite.mjs',
    probeSource({ tag: 'h713', exam: true,
      pin: 'evs.some((e) => e.kind === \'driver:exam-run\' && e.task === \'T1\' && e.iter === 1)',
      why: 'BASE ran the exam again for the review round' }),
    'a `driver:exam-run` at `iter` 1'],
  // (i) the review-economy sim: the TOGGLE's second execution inside round 1.
  ['i', 'test_run_engine_review_economy.mjs',
    probeSource({ tag: 'i713', runs: [TOGGLE],
      pin: 'evs.some((e) => e.kind === \'driver:proof-run\' && e.iter === 1 && e.exit !== 0)',
      why: 'BASE surfaced the toggle\'s red second execution in review round 1' }),
    'the toggle\'s second execution in round 1'],
  // (j) the integrated-runs sim: four `driver:proof-run` events, two at iter 1.
  ['j', 'test_run_engine_integrated_runs.mjs',
    probeSource({ tag: 'j713', runs: ["sh -c 'echo one'", "sh -c 'echo two'"],
      pin: 'evs.filter((e) => e.kind === \'driver:proof-run\' && e.task === \'T1\').length === 4 && ' +
        'evs.filter((e) => e.kind === \'driver:proof-run\' && e.iter === 1).length === 2',
      why: 'BASE recorded four driver:proof-run events, two of them at iter 1' }),
    'four `driver:proof-run` events with two at `iter` 1'],
]) {
  const copy = copyWithProbe(simName, probe)
  const r = spawnSync(process.execPath, [copy], { encoding: 'utf8' })
  const out = String(r.stdout || '')
  assert.ok(out.includes(BODY_GREEN),
    'leg (' + leg + '): every leg of ' + simName + ' holds — the sim prints its sentinel: ' +
    String(r.stderr || '').slice(-1200))
  assert.ok(!out.includes('ALL TESTS PASSED'),
    'leg (' + leg + '): a copy of ' + simName + ' still asserting ' + pinName +
    ' prints no sentinel — the re-scoped pin is a pin and not a deletion')
}

// [M5] leg (f): the sentinel below is this sim's — its existing legs, the #632
// ones and the #713 ones. It is printed only if every assertion above held.
console.log('ALL TESTS PASSED')
