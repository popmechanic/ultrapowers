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
//        to 4,000 characters.
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
import { execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execSeam } from '../run-main.mjs'
import { makeCwdFor, withPatchCapture, defaultTaskIdOf } from '../run-waves.mjs'
import { runEngine } from '../run-engine.mjs'
import { rig, makeRepo, provision, passReview, cleanCritic, doneImpl } from './_engine_helpers.mjs'

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

// ── the sim rig: the shared one, plus a call log the proof command can join ──
let seq = 0
async function scenario({ task, review = () => passReview(), onImpl = () => {},
                          onFix = () => {}, orderFile = null }) {
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
    if (kind === 'impl') { onImpl(cwd); return doneImpl(cwd) }
    if (kind === 'fix') { onFix(cwd); return doneImpl(cwd) }
    if (kind === 'review') { reviews += 1; return review(reviews) }
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run, clonesDir } = rig({
    repo, runDir, waves: [[task]], stub, stamp, extraArgs: { shallowLeg: false },
  })
  const report = await run()
  return { report, row: report.tasks[0], calls, prompts, runDir, clonesDir,
           events: proofRunEvents(runDir) }
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
  const order = fs.readFileSync(orderFile, 'utf8').split('\n')
    .filter(Boolean).filter((l) => l !== 'integration')
  assert.deepEqual(order, ['impl:T1', 'proof-run', 'review:T1:1'],
    'the Run: command executes between the implementer and the first review')

  // [M1, M5] exactly one recorded execution, exit 0, the command verbatim.
  assert.equal(events.length, 1, 'exactly one execution recorded: ' + JSON.stringify(events))
  assert.equal(events[0].cmd, CMD, 'the command is recorded verbatim')
  assert.equal(events[0].exit, 0)
  assert.equal(events[0].task, 'T1')
  assert.equal(events[0].iter, 1, 'the first review round is iter 1')

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
  assert.deepEqual(events.map((e) => e.cmd), [FIRST, SECOND], 'recorded in Proof order')
  assert.deepEqual(events.map((e) => e.exit), [0, 0])
  const ev = evidenceOf(prompts['review:T1:1'])
  assert.ok(ev.includes(FIRST) && ev.includes(SECOND), 'both commands are in the block')
  assert.ok(ev.indexOf(FIRST) < ev.indexOf(SECOND), 'and in the order the Proof gave them')
  assert.ok(ev.includes('first') && ev.includes('second'), 'with both outputs')
  assert.equal(row.status, 'done')
}

// ── leg (a): stderr is combined, not dropped [M1, M2] ───────────────────────
{
  const CMD = "sh -c 'echo out; echo err 1>&2; exit 1'"
  const { prompts, events } = await scenario({
    task: entry({ proofRuns: [CMD] }),
    onImpl: (cwd) => fs.writeFileSync(path.join(cwd, 'one.txt'), 'from T1\n'),
    // The failing command drives the fix loop; the fix changes nothing.
  })
  assert.equal(events.length >= 1, true, 'the failing command is recorded')
  assert.equal(events[0].exit, 1, 'the command\'s own exit code, not a boolean')
  const ev = evidenceOf(prompts['review:T1:1'])
  assert.ok(/(^|\n)out(\r?\n|$)/.test(ev), 'stdout is in the evidence: ' + ev.slice(0, 400))
  assert.ok(/(^|\n)err(\r?\n|$)/.test(ev), 'stderr is combined into it, not dropped: ' + ev.slice(0, 400))
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
  assert.equal(events.length, 1)
  assert.equal(events[0].exit, 0)
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

// ── legs (c), (e): a non-zero exit overrides the reviewer's PASS [M3, M5] ───
{
  const CMD = "sh -c 'echo broken; exit 3'"
  const { row, report, calls, prompts, events } = await scenario({
    task: entry({ proofRuns: [CMD] }),
    onImpl: (cwd) => fs.writeFileSync(path.join(cwd, 'one.txt'), 'from T1\n'),
    review: () => passReview(),          // the reviewer says PASS, every round
  })
  assert.ok(calls.includes('fix:T1:1'), 'the fix round is dispatched: ' + calls.join(','))
  assert.ok(calls.includes('review:T1:2'), 'and the task is re-reviewed: ' + calls.join(','))
  // The canned PASS does not survive a red command.
  assert.equal(row.status, 'failed', 'a failing Run: command cannot merge on a canned PASS')
  assert.equal(row.reviewVerdict, 'fix-loop-exhausted')
  assert.equal(report.coverage.tasks_merged, 0)
  // The blocking issue names the command and its exit code.
  assert.ok(row.notes.includes(CMD), 'the recorded issue names the command: ' + row.notes)
  assert.ok(row.notes.includes('exit 3'), 'and its exit code: ' + row.notes)
  const fixPrompt = prompts['fix:T1:1']
  assert.ok(fixPrompt.includes(CMD), 'the fix round is told which command failed')
  assert.ok(fixPrompt.includes('exit 3'), 'and with what exit code')
  // [M5] one record per execution — the commands run again for round 2.
  assert.deepEqual(events.map((e) => e.exit), [3, 3])
  assert.deepEqual(events.map((e) => e.iter), [1, 2], 'one execution per review round')
  assert.deepEqual(events.map((e) => e.cmd), [CMD, CMD])
  assert.deepEqual(events.map((e) => e.task), ['T1', 'T1'])
}

// ── leg (c): the fix round's work is re-run, new evidence replaces old [M3] ─
{
  // The command READS a file the fix round writes, so round 2's output is a
  // string the command text itself does not contain: fresh evidence, not the
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
    ['impl:T1', 'review:T1:1', 'fix:T1:1', 'review:T1:2'],
    'red command → fix round → re-review')
  assert.equal(row.status, 'done', 'the second run is green, so the reviewer\'s PASS stands')
  assert.equal(row.reviewVerdict, 'fixed')
  assert.equal(row.fixIterations, 1)
  const first = evidenceOf(prompts['review:T1:1'])
  const second = evidenceOf(prompts['review:T1:2'])
  assert.ok(first.includes('exit 1'), 'round 1 read the failing run')
  assert.ok(!first.includes('repaired-by-the-fix-round'),
    'and nothing from a run that had not happened yet')
  assert.ok(second.includes('exit 0'), 'round 2 reads a fresh execution')
  assert.ok(second.includes('repaired-by-the-fix-round'),
    'carrying what the command printed after the fix round')
  assert.ok(!second.includes('exit 1'), 'the new evidence REPLACES the old: ' + second.slice(0, 400))
  assert.deepEqual(events.map((e) => e.exit), [1, 0])
  assert.deepEqual(events.map((e) => e.iter), [1, 2])
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
  assert.deepEqual(events.map((e) => e.exit), [0, 0], 'green in both rounds')
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
  assert.equal(events.length, 1, 'the command still ran')
  assert.equal(row.status, 'done')
}

console.log('ALL TESTS PASSED')
