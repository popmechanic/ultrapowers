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
//        re-measuring a tree no agent has touched since. (#964 Task 2: there is
//        no `iter: 2` execution any more — the one review round dispatches no
//        fix worker, so nothing edits the tree after the pass.) A red `iter: 0`
//        pass buys one `fix:<id>:0` round before any referee is dispatched
//        (its re-execution is `iter: 0` too), and a task still red after it
//        never reaches a reviewer at all (`reviewVerdict: 'proof-red'`) — the
//        pre-review sim owned that contract until it was retired for catching
//        nothing, and this file carries the pin now.
//   M2 — the review prompt carries a `RUN EVIDENCE:` block (command verbatim,
//        `exit <n>`, the recorded output); no proofRuns → no block, and a
//        prompt byte-identical to BASE's.
//   M3 — any non-zero exit ⇒ FIX_REQUIRED with a blocking issue naming the
//        command and its exit code, whatever the reviewer's own verdict; the
//        pre-review repair round re-runs the commands and the new evidence
//        replaces the old.
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
import { ENV, rig, makeRepo, provision, gitSync, passReview, cleanCritic, doneImpl } from './_engine_helpers.mjs'

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
// actually left. `examScript2`, when given, is what it writes instead on a
// SECOND examiner round (a label carrying a round field, `exam:<id>:2`), which
// is how #1037 §3's leg (f) gives that round an exam of its own to be graded by.
// `constraintChecks` is the run's executable Global Constraints.
async function scenario({ task, review = () => passReview(), onImpl = () => {},
                          onFix = () => {}, orderFile = null, examScript = null,
                          examScript2 = null, constraintChecks = [] }) {
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
      // A round field on the label (`exam:T1:2`) and a second script given:
      // the second round writes the second body. Every other exam dispatch —
      // including every sim that passes no `examScript2` — writes the first,
      // exactly as it did before this knob existed.
      const second = opts.label.split(':').length > 2 && examScript2 !== null
      fs.writeFileSync(path.join(cwd, 't1_test.sh'), String(second ? examScript2 : examScript))
      return { status: 'DONE', summary: 'exam written' }
    }
    if (kind === 'impl') { onImpl(cwd); return doneImpl(cwd) }
    if (kind === 'fix') { onFix(cwd, opts.label); return doneImpl(cwd) }
    if (kind === 'review') { reviews += 1; return review(reviews) }
    // No `integration` arm: since #964 Task 2 no worker reads the finished run,
    // so an `integration` label here would be a dispatch the engine must not
    // make, and the throw below is the assertion.
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run, clonesDir } = rig({
    repo, runDir, waves: [[task]], stub, stamp,
    // `foldAgeMs: 0` — the fold-at-every-landing reading (#1006). The proof
    // passes this file reads are what an ADOPTED epoch runs, and its fixtures
    // pace reviewers on the kernel's folds; the fold trigger is another exam's
    // subject, so every run here folds at its landings the way it always did.
    extraArgs: { constraintChecks, foldAgeMs: 0 },
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
  // (the wave's own critic dispatch, `integration`, used to be dropped here;
  // there is no such dispatch since #964 Task 2.)
  // There is no trailing `proof-run`: the integrated pass is #887's, and it
  // re-runs a task's commands only when another task of the same wave touched
  // one of its paths. This is a ONE-task wave, so it joins nothing and the
  // driver executes nothing on the adopted tree —
  // `test_run_engine_joined_proofs.mjs` pins that rule in its own sim.
  const order = fs.readFileSync(orderFile, 'utf8').split('\n').filter(Boolean)
  // The single `proof-run` is the driver's own pre-review pass, whose evidence
  // round 1 reads (#713).
  assert.deepEqual(order, ['impl:T1', 'proof-run', 'review:T1:1'],
    'the Run: command executes ONCE, between the implementer and the first review')

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
// The byte-pin needs BASE in the object store. A depth-1 clone — the shape
// `actions/checkout` gives CI by default — has no 0a3559a; there the pin has
// nothing to say and says so, rather than failing for a reason unrelated to
// the tree (the engine's own depth-1 rehearsal, deleted in #712, caught exactly
// this back in run-54).
const haveBase = (() => {
  try {
    execFileSync('git', ['cat-file', '-e', BASE_SHA + '^{commit}'],
      { cwd: REPO_ROOT, env: ENV, stdio: 'ignore' })
    return true
  } catch { return false }
})()
let baseRunEngine = null
// BASE's `loadRoles` reads `fleet/roles/critic.md`, which this release deletes
// (#964 Task 2), so the BASE engine is driven against a copy of the roles dir
// with BASE's own critic.md restored into it. Every other role file in that
// copy is the live tree's byte-for-byte, so the prompt the pin compares is
// still rendered from the live roles.
let baseRolesDir = null
if (haveBase) {
  const baseTree = path.join(tmp, 'base-tree')
  fs.cpSync(FLEET_DIR, path.join(baseTree, 'fleet'), {
    recursive: true, filter: (src) => path.basename(src) !== 'tests',
  })
  fs.writeFileSync(path.join(baseTree, 'fleet', 'run-engine.mjs'),
    execFileSync('git', ['show', BASE_SHA + ':fleet/run-engine.mjs'],
      { cwd: REPO_ROOT, env: ENV, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }))
  fs.symlinkSync(path.join(REPO_ROOT, 'skills'), path.join(baseTree, 'skills'))
  baseRolesDir = path.join(baseTree, 'roles-base')
  fs.cpSync(ROLES_DIR, baseRolesDir, { recursive: true })
  fs.writeFileSync(path.join(baseRolesDir, 'critic.md'),
    execFileSync('git', ['show', BASE_SHA + ':fleet/roles/critic.md'],
      { cwd: REPO_ROOT, env: ENV, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }))
  ;({ runEngine: baseRunEngine } =
    await import(pathToFileURL(path.join(baseTree, 'fleet', 'run-engine.mjs')).href))
} else {
  console.log('[M2] BASE ' + BASE_SHA + ' is not in this clone (shallow) — the ' +
    'byte-for-byte comparison against the BASE engine is skipped')
}

const PIN_REPO = makeRepo(path.join(tmp, 'pin-repo'))
const pinRunDir = path.join(tmp, 'pin-run')
async function pinPrompt(engine, task, rolesDir = ROLES_DIR) {
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
    // BASE's engine still dispatches a completeness critic; the live one never
    // does (#964 Task 2). This arm exists only so the byte-pin can drive BASE.
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
      patchInput: patchesDir,
    },
    agent,
    parallel: (thunks) => Promise.all(thunks.map((t) => t())),
    exec: execSeam,
    paths: { repoDir: PIN_REPO, runDir: pinRunDir, clonesDir },
    log: () => {},
    rolesDir,
    patchBase,
  })
  return { prompt, events: proofRunEvents(pinRunDir) }
}
{
  const absent = entry()
  delete absent.proofRuns
  const basePin = haveBase ? await pinPrompt(baseRunEngine, entry(), baseRolesDir) : null
  const liveEmpty = await pinPrompt(runEngine, entry({ proofRuns: [] }))
  const liveAbsent = await pinPrompt(runEngine, absent)

  for (const [name, p] of [...(basePin ? [['BASE', basePin]] : []),
                           ['proofRuns: []', liveEmpty], ['no proofRuns key', liveAbsent]]) {
    assert.equal(typeof p.prompt, 'string', name + ': the reviewer was dispatched')
    assert.ok(!p.prompt.includes('RUN EVIDENCE:'), name + ': no RUN EVIDENCE: block')
  }
  if (basePin) {
    // An empty `proofRuns` adds nothing of its own.
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
  assert.deepEqual(calls,
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
  // #964 Task 2: this leg lost its second execution and its fix dispatch. The
  // reviewer's FIX_REQUIRED bought `fix:T1:1` and a round 2 that executed the
  // command afresh at `iter: 2`; with one round it ends the task instead, so
  // the driver's own pass is the only execution there is. What the leg is for
  // — an all-zero run contributes no issue of its own, and the recorded notes
  // are the reviewer's alone — is asserted below unchanged.
  assert.deepEqual(events.map((e) => e.exit), [0],
    'green in the driver\'s pass, which is the only execution')
  assert.deepEqual(events.map((e) => e.iter), [0],
    'the one round reads the pass; nothing executes after it')
  assert.ok(!calls.some((l) => l.startsWith('fix:')),
    'and the reviewer\'s FIX_REQUIRED buys no fix round of its own: ' + calls.join(','))
  assert.equal(row.status, 'failed')
  assert.equal(row.reviewVerdict, 'fix-loop-exhausted')
  assert.equal(row.notes, 'the reviewer is not satisfied',
    'the recorded issues are the reviewer\'s own, with nothing added by the runs')
  // #1037 §3 leg (h) [M3] [M4]: this task declares `proofTests: []`, so no
  // examiner was ever dispatched for it — and a row for a task with no examiner
  // carries no `examRounds` key at all. (`examRounds` follows `examEdited`'s
  // presence rule: the key is a fact about a round that could have run, not a
  // zero on every row in the report.) The exit above is BASE's, unchanged.
  assert.equal('examRounds' in row, false,
    'leg (h) [M3]: a task with no examiner carries no examRounds key on its row: ' +
    JSON.stringify(row))
}

// ── leg (f): proofRuns with the proofTests key absent dispatches no examiner [M6]
{
  const task = entry({ proofRuns: ["sh -c 'echo hello-from-run'"] })
  delete task.proofTests
  const { row, calls, events } = await scenario({
    task,
    onImpl: (cwd) => fs.writeFileSync(path.join(cwd, 'one.txt'), 'from T1\n'),
  })
  assert.deepEqual(calls, ['impl:T1', 'review:T1:1'],
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
// `Check:` half belonged to the retired pre-review sim's legs (c), (d), (g).
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
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run, base: rigBase } = rig({
    repo, runDir, stub, stamp: 'ub1',
    waves: [[entry({ proofRuns: [PRINTENV, TEST_EQ] })]],
    extraArgs: { foldAgeMs: 0 },
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

// ── leg (b): a task dispatched after an adoption gets that adopted head; the
// integrated pass gets the run base [M1] [M3]
// The two shas differ only once something has been adopted, which is why this
// leg needs a task that lands before T2 is dispatched: until the first fold
// `waveBaseSha` and `baseSha` coincide and any confusion between them is
// invisible.
//
// Under the ready set (#974 Task 1) a task is dispatched the moment its
// predecessors are adopted, on the head of THAT moment, and the tasks that land
// while a fold is running are folded together as the next epoch. So the shape
// is drawn with edges rather than wave rows: T1 alone is ready at the start and
// is adopted as epoch 1; its three consumers are dispatched together on epoch
// 1's head; the pacer P lands first and folds as epoch 2, and T2 and T3 — whose
// reviews wait for that fold to open — land while it runs and are folded
// together as epoch 3. That co-landing is what the join needs: T3 rides with T2
// for it (#887), declaring `two.txt` in its Files and writing `three.txt`, so
// the two touch sets meet in `two.txt` while the patches stay disjoint, and the
// integrated pass re-runs T2's command at all.
{
  const ECHO = "sh -c 'echo base=$ULTRA_BASE'"
  const repo = makeRepo(path.join(tmp, 'repo-ub2'))
  const runDir = path.join(tmp, 'run-ub2')
  const PACER = 'P'
  const waves = [
    [entry({ id: 'T1', files: ['one.txt'], writes: ['one.txt'] })],
    [entry({ id: PACER, files: ['pacer.txt'], writes: ['pacer.txt'] }),
     entry({ id: 'T2', files: ['two.txt'], writes: ['two.txt'], proofRuns: [ECHO] }),
     entry({ id: 'T3', files: ['two.txt', 'three.txt'], writes: ['three.txt'] })],
  ]
  const fileOf = (id) => (
    id === 'T1' ? 'one.txt' : id === 'T2' ? 'two.txt' : id === 'T3' ? 'three.txt' : 'pacer.txt')
  // The pacer's own fold, seen at the kernel call the exec seam carries.
  const pacerFolding = path.join(tmp, 'ub2-pacer-folding')
  const waitFor = async (file) => {
    for (let i = 0; i < 2000 && !fs.existsSync(file); i += 1) {
      await new Promise((r) => setTimeout(r, 10))
    }
  }
  const prompts = {}
  const stub = async (prompt, opts, cwd) => {
    prompts[opts.label] = prompt
    const kind = opts.label.split(':')[0]
    const id = opts.label.split(':')[1]
    if (kind === 'impl' || kind === 'fix') {
      fs.writeFileSync(path.join(cwd, fileOf(id)), 'from ' + id + '\n')
      return doneImpl(cwd)
    }
    // T2 and T3 hold their reviews until the pacer's fold is under way, so both
    // land inside it and the epoch that follows holds the two of them.
    if (kind === 'review') {
      if (id === 'T2' || id === 'T3') await waitFor(pacerFolding)
      return passReview()
    }
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run, base } = rig({
    repo, runDir, waves, stub, stamp: 'ub2',
    edges: [['T1', PACER], ['T1', 'T2'], ['T1', 'T3']],
    // `foldAgeMs: 0` again: T2's and T3's reviews wait for the PACER's own fold
    // to open, and under the #1006 trigger the pacer's landing releases nobody
    // — the three-epoch shape this leg needs is the fold-at-every-landing one.
    extraArgs: { foldAgeMs: 0 },
    exec: async (cmd, argv, opts) => {
      if (cmd === 'python3' && argv[1] === 'fold' &&
          argv[argv.indexOf('--wave') + 1] === '2') fs.writeFileSync(pacerFolding, '')
      return execSeam(cmd, argv, opts)
    },
  })
  const report = await run()

  assert.equal(report.coverage.complete, true, 'sim precondition: every task adopted')
  assert.equal(report.waveMerges.length, 3,
    'sim precondition: three epochs — T1, the pacer, then T2 with T3: ' +
    JSON.stringify(report.waveMerges))
  assert.deepEqual(report.waveMerges[2].joined, ['two.txt'],
    'sim precondition: the last epoch\'s two tasks meet in two.txt, which is what gives T2 ' +
    'an integrated execution at all (#887): ' + JSON.stringify(report.waveMerges[2]))
  const w1 = report.waveMerges[0].headSha
  const w2 = report.waveMerges[2].headSha
  assert.deepEqual(report.waveMerges[0].branches, ['T1'],
    'sim precondition: epoch 1 is T1 alone: ' + JSON.stringify(report.waveMerges[0]))
  assert.match(String(w1), /^[0-9a-f]{40}$/, 'sim precondition: epoch 1 adopted a head')
  assert.notEqual(w1, base,
    'sim precondition: epoch 1\'s adopted head is not the run base — the two shas the leg ' +
    'distinguishes actually differ here')

  // [M1] the task dispatched after that adoption sees its OWN base: epoch 1's head.
  const ev2 = evidenceOf(prompts['review:T2:1'])
  assert.ok(ev2.includes('base=' + w1),
    'T2\'s `Run:` ran with ULTRA_BASE = the head adopted before it was dispatched (' + w1 +
    '): ' + JSON.stringify(ev2.slice(0, 600)))
  assert.ok(!ev2.includes('base=' + base),
    'and NOT the run base — a task re-anchored onto the adopted head must be handed ' +
    'that head: ' + JSON.stringify(ev2.slice(0, 600)))

  // [M3] the integrated pass sees the RUN base, in every epoch — never the
  // adopted head, against which any diff is a tautology.
  const integrated = report.integratedRuns.filter((r) => r.task === 'T2')
  assert.equal(integrated.length, 1,
    'one integrated run for T2: ' + JSON.stringify(report.integratedRuns))
  assert.ok(String(integrated[0].stdout).includes('base=' + base),
    'the integrated pass runs with ULTRA_BASE = the run base ' + base + ': ' +
    JSON.stringify(integrated[0]))
  assert.ok(!String(integrated[0].stdout).includes(String(w2)),
    'never the epoch\'s own adopted head ' + w2 + ': ' + JSON.stringify(integrated[0]))
  assert.ok(!String(integrated[0].stdout).includes(String(w1)),
    'and never epoch 1\'s: ' + JSON.stringify(integrated[0]))
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
// before its first referee. The clauses below pin the single execution: the one
// review round READS the pass's evidence. (#964 Task 2: the `iter: 2`
// execution that followed a review-round fix is gone with that fix round — the
// one round is the last thing that happens to a task.)
//
//   M1 — a task whose every proofRuns command, exam and non-minor Check: exits 0
//        on the pre-review pass records exactly one `driver:proof-run` per
//        proofRuns entry, one `driver:exam-run` when the exam is runnable and
//        one `driver:check-run` per Check:, all at `iter: 0` and all before the
//        first `review:` dispatch; and the `review:<id>:1` prompt's RUN, EXAM
//        and CHECK EVIDENCE blocks carry that pass's commands, exits and outputs.
//   M2 — a red pass buys one `fix:<id>:0` round and one re-execution, both at
//        `iter: 0`, and round 1 reads the re-execution — no third execution.
//   M3 — RETIRED by #964 Task 2: it read "a review-round fix (`fix:<id>:1`) is
//        followed by one fresh execution at `iter: 2`, and `review:<id>:2`
//        carries it and not round 1's". There is no review-round fix and no
//        round 2 to carry anything, so the clause has no subject; leg (d)
//        below, which was its only leg, goes with it.
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
    .filter(Boolean)
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
    .filter(Boolean)
  // No trailing `proof-run`: a one-task wave joins nothing, so the #887
  // integrated pass executes nothing on the adopted tree.
  assert.deepEqual(order, ['impl:T1', 'proof-run', 'review:T1:1'],
    'the implementer, ONE pre-review execution, then the first review — a BASE engine ' +
    'records a second execution before the review: ' + JSON.stringify(order))
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
  assert.deepEqual(calls,
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

// ── #713 Task 1 leg (d): DELETED by #964 Task 2 ──────────────────────────────
// It drove a `review:T1:1` FIX_REQUIRED into `fix:T1:0`, a fresh execution at
// `iter: 2` and a `review:T1:2` prompt carrying it, and read the row back as
// `fixIterations: 1`, `reviewVerdict: 'fixed'`. Every one of those is a thing
// the engine no longer does: one review round, no fix dispatched from it, so no
// second execution and no second prompt exist to compare. The leg is removed
// rather than loosened — what survives of its subject (the round reads the
// pre-review pass's own output) is leg (b)'s and leg (c)'s already, and the
// no-second-execution half is now asserted by every green leg in this file.

// ── #713 Task 1 leg (e): red on every execution — BASE's shape, unchanged [M2, M4]
{
  const CMD = "sh -c 'echo still-broken; exit 3'"
  const { row, calls, events } = await scenario({
    task: entry({ proofRuns: [CMD] }),
    onImpl: (cwd) => fs.writeFileSync(path.join(cwd, 'one.txt'), 'from T1\n'),
  })
  assert.deepEqual(calls, ['impl:T1', 'fix:T1:0'],
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
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const _r = _h.rig({
    repo: _h.makeRepo(_pp.join(_tmp, 'repo')), runDir: _pp.join(_tmp, 'run'),
    waves: [[_task]], stub: _stub, stamp: '${tag}',
    extraArgs: { constraintChecks: ${JSON.stringify(checks)}, foldAgeMs: 0 },
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
// The rows whose sims were retired for catching nothing are gone with them: a
// probe copy is built by reading the sim's own text, so a row naming a file the
// tree no longer holds is not a weaker pin but an unreadable one.
for (const [leg, simName, probe, pinName] of [
  // (i) the review-economy sim: the TOGGLE's second execution inside round 1.
  ['i', 'test_run_engine_review_economy.mjs',
    probeSource({ tag: 'i713', runs: [TOGGLE],
      pin: 'evs.some((e) => e.kind === \'driver:proof-run\' && e.iter === 1 && e.exit !== 0)',
      why: 'BASE surfaced the toggle\'s red second execution in review round 1' }),
    'the toggle\'s second execution in round 1'],
]) {
  const copy = copyWithProbe(simName, probe)
  const r = spawnSync(process.execPath, [copy], { encoding: 'utf8', env: ENV })
  const out = String(r.stdout || '')
  assert.ok(out.includes(BODY_GREEN),
    'leg (' + leg + '): every leg of ' + simName + ' holds — the sim prints its sentinel: ' +
    String(r.stderr || '').slice(-1200))
  assert.ok(!out.includes('ALL TESTS PASSED'),
    'leg (' + leg + '): a copy of ' + simName + ' still asserting ' + pinName +
    ' prints no sentinel — the re-scoped pin is a pin and not a deletion')
}

// ════════════════════════════════════════════════════════════════════════════
// #1037 §3 — a blocking finding against the EXAM buys the examiner one round
// before the task is called exhausted, and the record shows whether it ran.
//
// Claim: when the reviewer's blocking finding is against the exam file rather
// than the implementation, the peer who WROTE the exam gets the finding and one
// round to rewrite it, the rewritten exam is run and reviewed once more, and
// only then is the task called exhausted. Run-15 task 1 is the case: the one
// blocking finding read "the exam at `…:129-144` substitutes a direct store
// callback", the row was `fix-loop-exhausted, fixIterations: 0`, and the
// examiner — the one party that could have answered it — was never asked.
//
// Machine clauses under test:
//   M1 — a review round whose blocking issues (AFTER plan routing) include at
//        least one whose `detail` names in backticks one of the task's Proof
//        `Test:` LANDING paths — the token equal to the path, or the path
//        followed by `:<digits>` or `:<digits>-<digits>` — on a task whose
//        examiner was dispatched: the driver appends one `driver:exam-rejected`
//        `{task, path, detail}` per such issue and dispatches ONE examiner
//        labelled `exam:<id>:2` in the examiner's own clone, whose prompt is the
//        original examiner prompt followed by an `EXAM REJECTED:` block carrying
//        those details one per line. No `fix:<id>:1`, no second implementer.
//   M2 — after that examiner returns DONE the driver hands the Proof paths over
//        again (a second `driver:exam-handoff`), retakes the capture, runs the
//        exam on the graded tree as `driver:exam-run` at `iter: 2`, and
//        dispatches one `review:<id>:2` whose prompt carries that run's
//        `EXAM EVIDENCE`. Round 2 with no blocking issue ends the task `done`,
//        `clean`; with a blocking issue — or a red exam at `iter: 2`, blocking
//        whatever the reviewer said — `failed`, `fix-loop-exhausted`.
//   M3 — every row returned after an examiner was dispatched carries
//        `examRounds`: `2` when the exam-rejected round ran, `1` otherwise; a
//        row for a task with no examiner carries no `examRounds` key.
//   M4 — a blocking finding naming no exam path ends the task exactly as at
//        BASE: no `exam:<id>:2`, no `review:<id>:2`, `fix-loop-exhausted` with
//        the reviewer's notes.
//   M5 — `fleet/roles/examiner.md` names the `EXAM REJECTED` input.
//   M6 — `fleet/CONTRACT.md`'s exam-environment bullet names `2` as the
//        `ULTRA_EXAM_PASS` value of that round's run, and report-format.md
//        carries a `tasks[].examRounds` row and names the exam-rejected round
//        under `fix-loop-exhausted`.

// The runnable exam the peer writes for legs (a)–(g): red at BASE (no `one.txt`
// in the examiner's clone), green on the implementer's patch — the same shape
// the #713 leg (a) above uses. Four lines, so `t1_test.sh:3` and
// `t1_test.sh:3-4` are real coordinates in it rather than invented ones.
const REJ_EXAM = '#!/bin/bash\n' +
  '# the exam the peer wrote\n' +
  'echo exam-line\n' +
  '[ -f one.txt ]\n'
// A second body for the one leg that needs the rewritten exam to be RED: it is
// what the canned examiner writes on `exam:T1:2`, and only there.
const REJ_EXAM_RED = '#!/bin/bash\nexit 1\n'
const EXAM_CMD_T1 = 'bash t1_test.sh'
// The task every leg below runs: one Proof `Test:` path, a testCmd that runs it.
// `t1_test.sh` is under neither test root, so its landing path is itself — which
// is the path M1 says the reviewer's backticked token is matched against.
const rejTask = () => entry({ proofTests: ['t1_test.sh'], testCmd: EXAM_CMD_T1 })
const rejImpl = (cwd) => fs.writeFileSync(path.join(cwd, 'one.txt'), 'from T1\n')
const blockingWith = (...details) => ({ verdict: 'FIX_REQUIRED',
  issues: details.map((detail) => ({ severity: 'blocking', detail })) })
// The `driver:exam-rejected` records for T1, projected onto the three fields M1
// spells — so the comparison is an equality against the clause's own shape and
// not a containment that a record missing `path` would still satisfy.
const rejectedOf = (evs) => ofKind(evs, 'driver:exam-rejected')
  .map((e) => ({ task: e.task, path: e.path, detail: e.detail }))
// The exam-rejected round's dispatch shape, shared by the legs that get one.
const REJ_LABELS = ['exam:T1', 'impl:T1', 'review:T1:1', 'exam:T1:2', 'review:T1:2']
const assertRejLabels = (leg, calls) => {
  for (const label of REJ_LABELS) {
    assert.ok(calls.includes(label),
      'leg (' + leg + ') [M1] [M2]: `' + label + '` was dispatched: ' + calls.join(','))
  }
  assert.ok(!calls.some((l) => l.startsWith('fix:')),
    'leg (' + leg + ') [M1]: no fix: label at all — the finding is the EXAM\'s, so it buys ' +
    'an examiner round and never a second implementer: ' + calls.join(','))
}

// The reviewer's finding, verbatim from the Proof's leg (a) — a line RANGE
// suffix, which is the shape run-15's own blocking detail carried.
const REJ_DETAIL = 'the exam at `t1_test.sh:3-4` substitutes a store call for the click'

// ── leg (a): the whole round — labels, events, both prompts, the row [M1][M2][M3]
{
  const { row, calls, prompts, evs } = await scenario({
    task: rejTask(), examScript: REJ_EXAM, onImpl: rejImpl,
    review: (n) => (n === 1 ? blockingWith(REJ_DETAIL) : passReview()),
  })

  // [M1] [M2] the five dispatches, and no fix worker of any kind.
  assertRejLabels('a', calls)

  // [M1] exactly one `driver:exam-rejected`, carrying the task, the landing path
  // read off the backticked `t1_test.sh:3-4` token, and the reviewer's detail.
  assert.deepEqual(rejectedOf(evs),
    [{ task: 'T1', path: 't1_test.sh', detail: REJ_DETAIL }],
    'leg (a) [M1]: one driver:exam-rejected {task, path, detail} for the one blocking issue ' +
    'whose detail names the Proof Test: landing path: ' +
    JSON.stringify(ofKind(evs, 'driver:exam-rejected')))

  // [M2] the Proof paths are handed over AGAIN after the second examiner: two
  // handoffs, not one — the rewritten exam has to reach the graded tree.
  assert.equal(ofKind(evs, 'driver:exam-handoff').length, 2,
    'leg (a) [M2]: a second driver:exam-handoff for T1 after the exam-rejected round: ' +
    JSON.stringify(ofKind(evs, 'driver:exam-handoff')))

  // [M2] and the rewritten exam is RUN on the graded tree, at `iter: 2` — the
  // driver's own pre-review pass (`iter: 0`) and that one, and nothing else.
  assert.deepEqual(ofKind(evs, 'driver:exam-run').map((e) => e.iter), [0, 2],
    'leg (a) [M2]: the exam runs at iter 0 (the pre-review pass) and again at iter 2 (the ' +
    'exam-rejected round\'s run on the graded tree): ' +
    JSON.stringify(ofKind(evs, 'driver:exam-run').map((e) => [e.iter, e.exit])))

  // [M1] the second examiner's prompt IS the first's, followed by the block.
  const p2 = prompts['exam:T1:2']
  assert.equal(typeof p2, 'string', 'leg (a) [M1]: the exam:T1:2 prompt was recorded')
  assert.ok(p2.startsWith(prompts['exam:T1']),
    'leg (a) [M1]: the exam-rejected round\'s prompt is the ORIGINAL examiner prompt followed ' +
    'by the rejection — the peer is re-dispatched with everything it had, plus what the ' +
    'referee said: ' + JSON.stringify(p2.slice(0, 200)))
  const rejAt = p2.indexOf('EXAM REJECTED:')
  assert.ok(rejAt !== -1,
    'leg (a) [M1]: the prompt carries an `EXAM REJECTED:` block: ' + JSON.stringify(p2.slice(-400)))
  assert.ok(p2.slice(rejAt).includes(REJ_DETAIL),
    'leg (a) [M1]: `EXAM REJECTED:` is followed by the reviewer\'s detail verbatim: ' +
    JSON.stringify(p2.slice(rejAt)))

  // [M2] round 2's referee reads the run the driver just made, green.
  const r2 = prompts['review:T1:2']
  assert.equal(typeof r2, 'string', 'leg (a) [M2]: the review:T1:2 prompt was recorded')
  assert.ok(r2.includes('EXAM EVIDENCE'),
    'leg (a) [M2]: the round-2 review prompt carries an EXAM EVIDENCE block')
  assert.ok(r2.includes('\n\n$ ' + EXAM_CMD_T1 + '\nexit 0\n'),
    'leg (a) [M2]: and that block is the iter-2 run\'s — the exam command and `exit 0`: ' +
    JSON.stringify(r2.slice(r2.indexOf('EXAM EVIDENCE'), r2.indexOf('EXAM EVIDENCE') + 600)))

  // [M2] [M3] a round 2 with no blocking issue ends the task done, and the row
  // says the exam-rejected round ran.
  assert.equal(row.status, 'done', 'leg (a) [M2]: ' + JSON.stringify(row))
  assert.equal(row.reviewVerdict, 'clean', 'leg (a) [M2]: ' + JSON.stringify(row))
  assert.equal(row.examRounds, 2,
    'leg (a) [M3]: the row records TWO examiner rounds — "exhausted" and "never ran" are ' +
    'different outcomes and the record distinguishes them: ' + JSON.stringify(row))
}

// ── leg (b): the bare token, no suffix at all [M1] ──────────────────────────
{
  const DETAIL = 'the exam at `t1_test.sh` substitutes a store call for the click'
  const { calls, evs } = await scenario({
    task: rejTask(), examScript: REJ_EXAM, onImpl: rejImpl,
    review: (n) => (n === 1 ? blockingWith(DETAIL) : passReview()),
  })
  assert.ok(calls.includes('exam:T1:2'),
    'leg (b) [M1]: a backticked token EQUAL to the Proof Test: path names the exam just as a ' +
    'line-ranged one does: ' + calls.join(','))
  assert.deepEqual(rejectedOf(evs), [{ task: 'T1', path: 't1_test.sh', detail: DETAIL }],
    'leg (b) [M1]: one driver:exam-rejected, its `path` the bare path: ' +
    JSON.stringify(ofKind(evs, 'driver:exam-rejected')))
}

// ── leg (c): two findings against the exam, ONE round, both details [M1] ────
// The round is the examiner's, not the finding's: two blocking issues naming the
// exam buy one rewrite carrying both, never two examiners.
{
  const D1 = 'the exam at `t1_test.sh:3` asserts nothing the Claim names'
  const D2 = 'the exam at `t1_test.sh:3-4` substitutes a store call for the click'
  const { calls, prompts, evs } = await scenario({
    task: rejTask(), examScript: REJ_EXAM, onImpl: rejImpl,
    review: (n) => (n === 1 ? blockingWith(D1, D2) : passReview()),
  })
  assert.deepEqual(rejectedOf(evs),
    [{ task: 'T1', path: 't1_test.sh', detail: D1 },
     { task: 'T1', path: 't1_test.sh', detail: D2 }],
    'leg (c) [M1]: exactly two driver:exam-rejected events, each carrying its OWN detail and ' +
    'the path read off its own token: ' + JSON.stringify(ofKind(evs, 'driver:exam-rejected')))
  assert.equal(calls.filter((l) => l === 'exam:T1:2').length, 1,
    'leg (c) [M1]: and exactly ONE exam:T1:2 dispatch for the two of them: ' + calls.join(','))
  const p2 = prompts['exam:T1:2']
  const rejAt = p2.indexOf('EXAM REJECTED:')
  assert.ok(rejAt !== -1, 'leg (c) [M1]: the prompt carries an `EXAM REJECTED:` block')
  const blockLines = p2.slice(rejAt).split('\n')
  const lineOf = (d) => blockLines.findIndex((l) => l.includes(d))
  assert.ok(lineOf(D1) !== -1 && lineOf(D2) !== -1,
    'leg (c) [M1]: the block carries both details: ' + JSON.stringify(p2.slice(rejAt)))
  assert.notEqual(lineOf(D1), lineOf(D2),
    'leg (c) [M1]: one per LINE — two findings run together on one line are one finding to ' +
    'the peer reading them: ' + JSON.stringify(p2.slice(rejAt)))
}

// ── leg (d): a finding naming no exam path ends the task as at BASE [M1] [M4] ─
// `other_file.sh` is backticked and is not the Proof's `Test:` path, and the
// detail does not start `plan-defect:` — so it is an ordinary blocking finding
// against the IMPLEMENTATION, and the exam-rejected round must not exist for it.
{
  const DETAIL = 'the patch at `other_file.sh` does the wrong thing'
  const { row, calls, evs } = await scenario({
    task: rejTask(), examScript: REJ_EXAM, onImpl: rejImpl,
    review: (n) => (n === 1 ? blockingWith(DETAIL) : passReview()),
  })
  assert.ok(!calls.includes('exam:T1:2'),
    'leg (d) [M1] [M4]: no second examiner for a finding that is not against the exam: ' +
    calls.join(','))
  assert.ok(!calls.includes('review:T1:2'),
    'leg (d) [M4]: and no second reviewer: ' + calls.join(','))
  assert.deepEqual(rejectedOf(evs), [],
    'leg (d) [M1]: and no driver:exam-rejected record at all: ' +
    JSON.stringify(ofKind(evs, 'driver:exam-rejected')))
  assert.equal(row.status, 'failed', 'leg (d) [M4]: ' + JSON.stringify(row))
  assert.equal(row.reviewVerdict, 'fix-loop-exhausted',
    'leg (d) [M4]: exactly the BASE exit: ' + JSON.stringify(row))
  assert.equal(row.notes, DETAIL,
    'leg (d) [M4]: with the reviewer\'s own notes: ' + JSON.stringify(row))
  assert.equal(row.examRounds, 1,
    'leg (d) [M3]: an examiner WAS dispatched for this task, and exactly one round of it ran: ' +
    JSON.stringify(row))
}

// ── leg (e): the round-2 reviewer blocks again — exhausted, and it says so [M2][M3]
{
  const ROUND2 = 'the rewritten exam still does not perform the click the Claim names'
  const { row, calls } = await scenario({
    task: rejTask(), examScript: REJ_EXAM, onImpl: rejImpl,
    review: (n) => (n === 1 ? blockingWith(REJ_DETAIL) : blockingWith(ROUND2)),
  })
  // Leg (e) says "labels as in the previous leg": the shape a leg demanding
  // `examRounds: 2` and a round-2 detail can only have — the exam-rejected
  // round's own, leg (a)'s.
  assertRejLabels('e', calls)
  assert.equal(row.status, 'failed', 'leg (e) [M2]: ' + JSON.stringify(row))
  assert.equal(row.reviewVerdict, 'fix-loop-exhausted',
    'leg (e) [M2]: a blocking issue in round 2 is where the task is finally called exhausted: ' +
    JSON.stringify(row))
  assert.equal(row.examRounds, 2,
    'leg (e) [M3]: and the record shows the rewrite round DID run: ' + JSON.stringify(row))
  assert.equal(row.notes, ROUND2,
    'leg (e) [M2]: the notes are round 2\'s finding, not round 1\'s: ' + JSON.stringify(row))
}

// ── leg (f): a rewritten exam that is RED at iter 2 blocks whatever round 2 said [M2]
// The canned examiner writes a failing body on `exam:T1:2`, and the round-2
// reviewer passes. The exam is the submission's own grading: a red one outranks
// the referee's PASS at round 2 exactly as it does at round 1.
{
  const { row, evs } = await scenario({
    task: rejTask(), examScript: REJ_EXAM, examScript2: REJ_EXAM_RED, onImpl: rejImpl,
    review: (n) => (n === 1 ? blockingWith(REJ_DETAIL) : passReview()),
  })
  assert.deepEqual(ofKind(evs, 'driver:exam-run').map((e) => [e.iter, e.exit]), [[0, 0], [2, 1]],
    'leg (f) [M2]: the green pre-review pass, then the rewritten exam red on the graded tree ' +
    'at iter 2: ' + JSON.stringify(ofKind(evs, 'driver:exam-run').map((e) => [e.iter, e.exit])))
  assert.equal(row.status, 'failed',
    'leg (f) [M2]: a red exam at iter 2 cannot merge on a canned PASS: ' + JSON.stringify(row))
  assert.equal(row.reviewVerdict, 'fix-loop-exhausted', 'leg (f) [M2]: ' + JSON.stringify(row))
  assert.equal(row.examRounds, 2, 'leg (f) [M3]: ' + JSON.stringify(row))
  assert.ok(String(row.notes).includes('the Proof\'s exam failed'),
    'leg (f) [M2]: and the notes name the red exam as the blocking issue: ' + JSON.stringify(row))
}

// ── leg (g): a task WITH an examiner whose finding is not the exam's [M3] [M4] ─
// The plainest reviewer detail there is: no backticks, no path, nothing to read
// a Proof path out of. `examRounds: 1` is the row's record that the examiner
// existed and that the rewrite round did not run — the distinction #1037 §3 asks
// the report to draw between "exhausted" and "never ran".
{
  const DETAIL = 'the reviewer is not satisfied'
  const { row, calls } = await scenario({
    task: rejTask(), examScript: REJ_EXAM, onImpl: rejImpl,
    review: (n) => (n === 1 ? blockingWith(DETAIL) : passReview()),
  })
  assert.ok(!calls.includes('exam:T1:2'),
    'leg (g) [M4]: no exam-rejected round for a finding naming no exam path: ' + calls.join(','))
  assert.ok(!calls.includes('review:T1:2'),
    'leg (g) [M4]: and no second reviewer: ' + calls.join(','))
  assert.equal(row.status, 'failed', 'leg (g) [M4]: ' + JSON.stringify(row))
  assert.equal(row.reviewVerdict, 'fix-loop-exhausted', 'leg (g) [M4]: ' + JSON.stringify(row))
  assert.equal(row.examRounds, 1,
    'leg (g) [M3]: one examiner round ran, and the row says so: ' + JSON.stringify(row))
  assert.equal(row.notes, DETAIL, 'leg (g) [M4]: ' + JSON.stringify(row))
}

// ── legs (i), (j): the role file, the contract and the report format [M5] [M6] ─
// Each is the Proof's own `Run:` grep, re-read here with the same semantics, so
// the ORDER those greps pin is pinned by the exam too: `sed -n '<start>,<end>p'`
// is the first line matching `<start>` through the first line after it matching
// `<end>`, inclusive, and `tr '\n' ' '` folds that span to one line.
const sedRange = (text, startRe, endRe) => {
  const lines = String(text).split('\n')
  const s = lines.findIndex((l) => startRe.test(l))
  if (s === -1) return null
  for (let i = s + 1; i < lines.length; i += 1) {
    if (endRe.test(lines[i])) return lines.slice(s, i + 1).join(' ')
  }
  return lines.slice(s).join(' ')
}
// `a` then `b` then `c`, each after the one before it — `grep 'a.*b.*c'` on one
// line, which is what the Proof runs.
const namesInOrder = (hay, needles) => {
  let at = 0
  for (const n of needles) {
    const i = String(hay).indexOf(n, at)
    if (i === -1) return false
    at = i + n.length
  }
  return true
}

// ── leg (i): examiner.md names the EXAM REJECTED input, and what to do with it [M5]
{
  const examinerMd = fs.readFileSync(path.join(ROLES_DIR, 'examiner.md'), 'utf8')
  // `sed -n '1,/^## The issue/p'`: `/^/` matches line 1, so the span starts there.
  const above = sedRange(examinerMd, /^/, /^## The issue/)
  assert.ok(above !== null, 'leg (i) [M5]: fleet/roles/examiner.md has a `## The issue` section')
  assert.ok(namesInOrder(above, ['EXAM REJECTED', 'as the Proof states it', 'unsatisfiable']),
    'leg (i) [M5]: fleet/roles/examiner.md above `## The issue`, read as one line, names ' +
    '`EXAM REJECTED`, then `as the Proof states it`, then `unsatisfiable`, in that order — the ' +
    'referee\'s finding against the exam AS WRITTEN, answered by rewriting the leg as the Proof ' +
    'states it, with an action the page cannot perform still an `unsatisfiable` entry and never ' +
    'a substituted action (#836). The examiner reads the rejection in its own role file or it ' +
    'reads it nowhere: ' + JSON.stringify(String(above).slice(0, 1200)))
}

// ── leg (j): the contract's exam-environment bullet, and the report format [M6] ─
{
  const contract = fs.readFileSync(path.join(FLEET_DIR, 'CONTRACT.md'), 'utf8')
  const bullet = sedRange(contract, /Exam environment/, /^- \*\*/)
  assert.ok(bullet !== null,
    'leg (j) [M6]: fleet/CONTRACT.md carries an `Exam environment` bullet')
  assert.ok(namesInOrder(bullet, ['ULTRA_EXAM_PASS', 'exam-rejected', '2']),
    'leg (j) [M6]: the exam-environment bullet, read as one line, names `ULTRA_EXAM_PASS`, then ' +
    '`exam-rejected`, then `2`, in that order — the contract wins over the RUNBOOK on any ' +
    'literal, and `2` is a pass value this engine emits again: ' + JSON.stringify(bullet))

  const reportFormat = fs.readFileSync(
    path.join(REPO_ROOT, 'skills', 'ultrapowers', 'references', 'report-format.md'), 'utf8')
  assert.ok(reportFormat.includes('tasks[].examRounds'),
    'leg (j) [M6]: skills/ultrapowers/references/report-format.md carries a `tasks[].examRounds` ' +
    'row — a new report field is named where a reader of the report looks it up')
  const verdictRows = reportFormat.split('\n').filter((l) => l.includes('tasks[].reviewVerdict'))
  assert.ok(verdictRows.length > 0,
    'leg (j) [M6]: report-format.md carries a `tasks[].reviewVerdict` row')
  assert.ok(verdictRows.some((l) => l.includes('exam-rejected')),
    'leg (j) [M6]: and that row names the exam-rejected round under `fix-loop-exhausted` — the ' +
    'exit is reached after the exam\'s own peer has had its round, not before it: ' +
    JSON.stringify(verdictRows.map((l) => l.slice(0, 300))))
}

// ════════════════════════════════════════════════════════════════════════════
// Task 1 of the receipts plan — "a red exam and a resolver miss leave a
// receipt" (kata popmechanic-ultrapowers#d56q).
//
// The Machine clause these legs grade, restated:
//   M1 — `examReceiptOf({ cmd, exit, stdout, headSha, landings, files })`,
//        exported from `fleet/run-engine.mjs`, returns `null` when `exit` is `0`
//        and otherwise `{ paths, evidence }` — `paths` the sorted de-duplicated
//        union of `landings` and `files`, `evidence.read` `exit <n>` followed by
//        a colon, a space and the last non-empty line of `stdout`,
//        `evidence.against` `<cmd> at <headSha>`, each string cut to the
//        500-character bound — and every `driver:exam-run` event spreads that
//        object when it is not `null` and adds no key when it is, so a red row
//        carries `paths` and `evidence` and a green row carries neither.
//
// The Proof legs answered here:
//   (a) [M1] the function itself, with no run at all: the exit-1 shape asserted
//       by full equality, the exit-0 `null`, and the 500-character bound.
//   (b) [M1] the engine's own `driver:exam-run` row at `iter: 0` — a red exam
//       carries the sorted union of the exam's landing path and the task's
//       `files`, an `evidence.read` beginning `exit 1` and an `evidence.against`
//       naming the exam command and the task's captured 40-hex `headSha`; the
//       same task with a green exam carries neither key.
//
// The receipt shape this plan's tasks share: `paths` is an array of
// repo-relative path strings, sorted, de-duplicated, never empty; `evidence` is
// `{ read, against }`, two strings each at most 500 characters, a longer one cut
// to 499 characters plus `…`.

// ── leg (a) [M1]: the pure export, pinned without a run ─────────────────────
// Imported dynamically off the module this file already imports statically, so
// a tree that does not export it yet fails HERE, on the export's own assertion,
// rather than at this file's first import line.
{
  const engineMod = await import('../run-engine.mjs')
  const examReceiptOf = engineMod.examReceiptOf
  assert.equal(typeof examReceiptOf, 'function',
    'leg (a) [M1]: `fleet/run-engine.mjs` exports `examReceiptOf` — the pure function this ' +
    'plan\'s other tasks name, so the shape can be pinned without a run: ' +
    JSON.stringify(Object.keys(engineMod).sort()))

  const SHA = '0123456789abcdef0123456789abcdef01234567'   // 40 hex
  const CMD = 'bash t.sh'

  // The exit-1 case, by full equality: `paths` the sorted de-duplicated union
  // (`tests/t.mjs` is in BOTH lists and appears once), `read` the exit code, a
  // colon, a space and the last NON-EMPTY line of the output (the trailing
  // newline leaves an empty last line, which is not it), `against` the command
  // and the head it was run at.
  const red = examReceiptOf({ cmd: CMD, exit: 1, stdout: 'a\nFAIL x\n', headSha: SHA,
                              landings: ['tests/t.mjs'], files: ['one.txt', 'tests/t.mjs'] })
  assert.deepEqual(red,
    { paths: ['one.txt', 'tests/t.mjs'],
      evidence: { read: 'exit 1: FAIL x', against: CMD + ' at ' + SHA } },
    'leg (a) [M1]: a red exam\'s receipt is exactly `{ paths, evidence }` — the sorted ' +
    'de-duplicated union of `landings` and `files`, `exit 1: FAIL x`, and `' + CMD + ' at ' +
    '<headSha>`: ' + JSON.stringify(red))

  // The exit-0 case: no receipt at all, and `null` rather than an empty object —
  // a green row is what spreads it and must gain no key.
  assert.strictEqual(
    examReceiptOf({ cmd: CMD, exit: 0, stdout: 'a\nFAIL x\n', headSha: SHA,
                    landings: ['tests/t.mjs'], files: ['one.txt', 'tests/t.mjs'] }),
    null,
    'leg (a) [M1]: `exit: 0` returns `null` — a green exam leaves no receipt, which is what ' +
    'keeps every existing pin of the green `driver:exam-run` shape true')

  // The bound: a 900-character last line is cut to 499 characters plus `…`.
  const LONG = 'z'.repeat(900)
  const cut = examReceiptOf({ cmd: CMD, exit: 1, stdout: 'first\n' + LONG + '\n', headSha: SHA,
                              landings: ['tests/t.mjs'], files: ['one.txt'] })
  assert.ok(cut && cut.evidence && typeof cut.evidence.read === 'string',
    'leg (a) [M1]: a red receipt for the long-line case: ' + JSON.stringify(cut))
  assert.equal(cut.evidence.read.length, 500,
    'leg (a) [M1]: a 900-character last line leaves `read` exactly 500 characters long — the ' +
    'block is bounded however long the exam\'s output line was: ' +
    JSON.stringify(cut.evidence.read.slice(0, 40) + '…' + cut.evidence.read.slice(-10)))
  assert.ok(cut.evidence.read.endsWith('…'),
    'leg (a) [M1]: and ends in `…`, so a reader can tell a cut string from a whole one: ' +
    JSON.stringify(cut.evidence.read.slice(-10)))
  assert.equal(cut.evidence.read, ('exit 1: ' + LONG).slice(0, 499) + '…',
    'leg (a) [M1]: the cut is the plan\'s shared literal — the 500-character bound taken as the ' +
    'first 499 characters of `exit <n>: <last non-empty line>` plus `…`: ' +
    JSON.stringify(cut.evidence.read.slice(0, 40)))
}

// ── leg (b) [M1]: the red `driver:exam-run` row carries the receipt ──────────
// The exam is red on the driver's pre-review pass (no `repaired.txt` in the
// implementer's clone) and green on the re-execution the repair round buys, so
// ONE run produces both rows the leg names: a red `iter: 0` row that must carry
// the receipt and a green `iter: 0` row that must carry no key at all.
{
  const RECEIPT_EXAM = '#!/bin/bash\n' +
    'echo exam-opened\n' +
    'echo "FAILED: repaired.txt is missing"\n' +
    '[ -f repaired.txt ]\n'
  const EXAM_CMD = 'bash t1_test.sh'
  const { row, evs } = await scenario({
    task: entry({ proofTests: ['t1_test.sh'], testCmd: EXAM_CMD }),
    examScript: RECEIPT_EXAM,
    onImpl: (cwd) => fs.writeFileSync(path.join(cwd, 'one.txt'), 'from T1\n'),
    onFix: (cwd) => fs.writeFileSync(path.join(cwd, 'repaired.txt'), 'written-by-the-repair-round\n'),
  })

  const exams = ofKind(evs, 'driver:exam-run')
  assert.deepEqual(exams.map((e) => [e.iter, e.exit]), [[0, 1], [0, 0]],
    'leg (b) [M1]: sim precondition — the driver\'s pre-review pass runs the exam red, the ' +
    'repair round it buys makes it green, and both executions belong to that pass (`iter: 0`): ' +
    JSON.stringify(exams.map((e) => [e.iter, e.exit])))
  const redRow = exams[0]

  // [M1] `paths`: the sorted union of the exam's LANDING path (`t1_test.sh` is
  // under neither test root, so its landing is itself) and the task's `files`.
  assert.deepEqual(redRow.paths, ['one.txt', 't1_test.sh'],
    'leg (b) [M1]: the red row\'s `paths` are the sorted union of the exam\'s landing path and ' +
    'the task\'s `files` — which files this row was about: ' + JSON.stringify(redRow))

  // [M1] `evidence.read`: `exit <n>`, then the last non-empty line of the tail
  // the row already carries — read off the row's own `stdout`, so the pin is
  // the clause's rule and not this script's wording.
  assert.ok(redRow.evidence && typeof redRow.evidence.read === 'string',
    'leg (b) [M1]: the red row carries an `evidence` object: ' + JSON.stringify(redRow))
  assert.ok(String(redRow.evidence.read).startsWith('exit 1'),
    'leg (b) [M1]: its `read` begins `exit 1` — the exit the exam returned: ' +
    JSON.stringify(redRow.evidence.read))
  const lastLine = String(redRow.stdout || '').split('\n').filter((l) => l.trim() !== '').pop()
  assert.equal(redRow.evidence.read, 'exit 1: ' + lastLine,
    'leg (b) [M1]: and it is `exit <n>` followed by a colon, a space and the last non-empty ' +
    'line of the output the row already carries: ' + JSON.stringify(redRow.evidence.read) +
    ' against ' + JSON.stringify(redRow.stdout))

  // [M1] `evidence.against`: the exam command and the head the driver ran it
  // at — the task's own captured `headSha`, which the row the run returns
  // carries too.
  const against = String(redRow.evidence.against || '')
  assert.ok(against.includes(EXAM_CMD),
    'leg (b) [M1]: `against` names the exam command: ' + JSON.stringify(against))
  const sha = (against.match(/[0-9a-f]{40}/) || [])[0]
  assert.ok(sha,
    'leg (b) [M1]: `against` names a 40-hex sha — what the driver read, against what: ' +
    JSON.stringify(against))
  assert.equal(against, EXAM_CMD + ' at ' + sha,
    'leg (b) [M1]: spelled `<cmd> at <headSha>`: ' + JSON.stringify(against))
  assert.equal(sha, row.headSha,
    'leg (b) [M1]: and that sha IS the task\'s captured head — the graded tree the exam was run ' +
    'on, not some other coordinate: ' + JSON.stringify({ against, headSha: row.headSha }))

  // [M1] the green re-execution of the SAME run gains no key.
  const greenRow = exams[1]
  assert.equal('paths' in greenRow, false,
    'leg (b) [M1]: the green re-execution\'s row has no `paths` key: ' + JSON.stringify(greenRow))
  assert.equal('evidence' in greenRow, false,
    'leg (b) [M1]: and no `evidence` key: ' + JSON.stringify(greenRow))
}

// ── leg (b) [M1]: a task whose exam is green throughout carries neither key ──
{
  const GREEN_EXAM = '#!/bin/bash\necho exam-line\n[ -f one.txt ]\n'
  const EXAM_CMD = 'bash t1_test.sh'
  const { row, evs } = await scenario({
    task: entry({ proofTests: ['t1_test.sh'], testCmd: EXAM_CMD }),
    examScript: GREEN_EXAM,
    onImpl: (cwd) => fs.writeFileSync(path.join(cwd, 'one.txt'), 'from T1\n'),
  })
  const exams = ofKind(evs, 'driver:exam-run')
  assert.deepEqual(exams.map((e) => [e.cmd, e.exit, e.iter]), [[EXAM_CMD, 0, 0]],
    'leg (b) [M1]: sim precondition — one green exam execution, on the driver\'s own pass: ' +
    JSON.stringify(exams.map((e) => [e.cmd, e.exit, e.iter])))
  assert.equal('paths' in exams[0], false,
    'leg (b) [M1]: a green `driver:exam-run` row has no `paths` key — `examReceiptOf` returned ' +
    '`null` and the spread added nothing: ' + JSON.stringify(exams[0]))
  assert.equal('evidence' in exams[0], false,
    'leg (b) [M1]: and no `evidence` key: ' + JSON.stringify(exams[0]))
  assert.equal(row.status, 'done', 'leg (b) [M1]: sim precondition: ' + JSON.stringify(row))
}

// [M5] leg (f): the sentinel below is this sim's — its existing legs, the #632
// ones, the #713 ones, the #1037 §3 ones and the receipt legs above. It is
// printed only if every assertion above held.
console.log('ALL TESTS PASSED')
