// fleet/tests/test_run_engine_own_proofs.mjs — the implementer runs its OWN
// proofs, not the suite.
//
// After this run an implementer is handed its own task's proofs and iterates
// against those: the `TEST COMMAND:` line is gone from the implementer's and
// the fix round's prompts, replaced by a `PROOFS:` block built from the task's
// Proof `Run:` commands and the run's Global Constraints `Check:` commands.
// The examiner keeps its `TEST COMMAND:` line (it is the one worker that must
// know how the exam is invoked) and so does the reconciler (it is handed the
// run-wide suite, which is the thing it repairs).
//
// Everything below the agent seam is the real thing — real git repos, real
// clones at BASE, real capture, the real fold kernel, the real `sh` — and only
// `agent` is stubbed, so every prompt this file reads is a prompt the engine
// actually built and dispatched.
//
// Machine clauses under test, and the Proof legs that carry them:
//
//   M1 — the implementer's prompt carries no line beginning `TEST COMMAND:`
//        and carries one `PROOFS:` block: one line per Proof `Run:` command of
//        its task and one line per Global Constraints `Check:` command, each
//        verbatim, in plan order, prefixed `- Run: ` and `- Check: `
//        respectively; a task with no `Run:` and a run with no `Check:` gets a
//        `PROOFS:` block that says `(none — the driver runs the exam at
//        handoff)`. Leg (a).
//   M2 — the fix round's prompt has the same shape as M1: no `TEST COMMAND:`
//        line, the same `PROOFS:` block. Leg (b).
//   M3 — the examiner's prompt still carries its `TEST COMMAND:` line naming
//        the exam command, unchanged from BASE. Leg (c).
//   M4 — `capWorkerParallelism`, `sharesRunWideCmd`, `runWideSharers` and
//        `implTestCmdLine` are not defined in `fleet/run-engine.mjs`, and
//        neither `fleet/roles/implementer.md` nor `fleet/roles/fix.md`
//        contains the string `TEST COMMAND`. Leg (d).
//   M5 — the reconciler's prompt still carries the run-wide `TEST COMMAND:`
//        line and no `PROOFS:` block. Leg (e).
//   M6 — the two survivor sims this task may edit each print
//        `ALL TESTS PASSED` on the patched tree. Leg (f) — the Proof's two
//        `Run:` lines are what execute them, in the driver's own clone; what
//        this file pins is that each is still there and still ends in the
//        sentinel those commands grep for.
//
// Two readings are recorded on the kata issue and repeated here, because a
// later session would otherwise have to reconstruct them:
//
//   The block's ORDER. M1 says "one line per Proof `Run:` ... and one line per
//   ... `Check:` ..., each verbatim, in plan order", and the task's Produces
//   interface spells the block `\nPROOFS:\n- Run: <cmd>\n- Check: <cmd>`. That
//   is read here as every `- Run: ` line in `task.proofRuns` order first, then
//   every `- Check: ` line in `constraintChecks` order — not interleaved — and
//   the exact block string is asserted as a substring of the prompt.
//
//   The examiner's prompt. M3's "unchanged from BASE" is asserted as: exactly
//   one line beginning `TEST COMMAND:`, and that line is exactly the exam's
//   own command. Whether the examiner ALSO gains a `PROOFS:` block is
//   deliberately not asserted — nothing in the task asks for one, and pinning
//   its absence would grade a choice the Machine clauses never make. The
//   reconciler is the opposite case: M5 names the absence itself, so leg (e)
//   asserts it.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { rig, makeRepo, passReview, doneImpl } from './_engine_helpers.mjs'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-own-proofs-'))
// rmSync unlinks a tree's `skills` symlink rather than following it.
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }))
const TESTS_DIR = fileURLToPath(new URL('.', import.meta.url))
const ROLES_DIR = fileURLToPath(new URL('../roles/', import.meta.url))
const ENGINE_SRC = fileURLToPath(new URL('../run-engine.mjs', import.meta.url))

// A task body with no `TEST COMMAND` in it: the prompt assertions below read
// LINES, so a mention inside the task text could not be mistaken for the input
// line — but keeping the text clean keeps the failure messages readable.
const BODY = '**Claim:** the tree gains one.txt\n' +
  'Machine: M1. The tree holds `one.txt`.\n\n' +
  '**Proof:**\n- Legs: (a) `one.txt` exists [M1]'
const mkTask = (id, files, over = {}) => ({
  id, title: id.toLowerCase(), files, tier: 'standard', review: 'lean',
  writes: files, commutes: [], proofTests: [], proofRuns: [],
  body: BODY, ...over,
})

// ── reading a prompt the way the contract spells it ──────────────────────────
// An input line is `KEY: value` at the head of a line; the role text above it
// mentions `TEST COMMAND` in prose (implementer.md line 7, reconcile.md line
// 20 at BASE), which is M4's grep to answer, not this one's. So every
// assertion here is about a LINE that BEGINS with the key.
const linesOf = (prompt) => String(prompt || '').split('\n')
const INPUT_KEY = /^[A-Z][A-Z ]*:/
const testCmdLinesOf = (prompt) => linesOf(prompt).filter((l) => l.startsWith('TEST COMMAND:'))
const proofsHeadsOf = (prompt) => linesOf(prompt).filter((l) => l === 'PROOFS:')
// The block's body: the lines under the `PROOFS:` line, up to the next input
// key or a blank line. `null` when the prompt carries no block at all, which
// is a different failure from a block with the wrong lines in it.
const proofsBodyOf = (prompt) => {
  const lines = linesOf(prompt)
  const i = lines.indexOf('PROOFS:')
  if (i === -1) return null
  const body = []
  for (const line of lines.slice(i + 1)) {
    if (line === '' || INPUT_KEY.test(line)) break
    body.push(line)
  }
  return body
}
const NONE_LINE = '(none — the driver runs the exam at handoff)'

// ── S1: legs (a) first half [M1], (b) [M2], (c) [M3] ─────────────────────────
// One task carrying two Proof `Run:` lines, in a run carrying one Global
// Constraints `Check:`, with an exam of its own. The second `Run:` is red on
// the driver's pass and green once the repair round has written its file, so
// this single run records `impl:T1`, `exam:T1` AND `fix:T1:0` — which is why
// leg (b)'s "the same `PROOFS:` block" can be asserted as string equality
// between two prompts of the SAME task rather than across two runs.
{
  const repo = makeRepo(path.join(tmp, 'repo-block'))
  const runDir = path.join(tmp, 'run-block')
  const RUN_A = 'test -f one.txt'
  const RUN_B = 'test -f fixed.txt'
  const CHECK = 'test -f check.sh'
  const EXAM_CMD = 'bash t1_test.sh'
  // Red at BASE (the examiner's clone has no `one.txt`), green on the patch.
  const EXAM = '#!/bin/bash\n[ -f one.txt ]\n'
  const labels = []
  const prompts = {}
  const stub = (prompt, opts, cwd) => {
    labels.push(opts.label)
    prompts[opts.label] = prompt
    const kind = opts.label.split(':')[0]
    if (kind === 'exam') {
      fs.writeFileSync(path.join(cwd, 't1_test.sh'), EXAM)
      return { status: 'DONE', summary: 'exam written' }
    }
    if (kind === 'impl') {
      fs.writeFileSync(path.join(cwd, 'one.txt'), 'from T1\n')
      return doneImpl(cwd)
    }
    // The repair round clears the one red `Run:`; the pass repeats green and
    // the task goes on to its review round exactly as a task that started
    // green does.
    if (kind === 'fix') {
      fs.writeFileSync(path.join(cwd, 'fixed.txt'), 'repaired\n')
      return doneImpl(cwd)
    }
    if (kind === 'review') return passReview()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run } = rig({
    repo, runDir, stub, stamp: 'op1',
    waves: [[mkTask('T1', ['one.txt', 'fixed.txt'], {
      proofTests: ['t1_test.sh'], testCmd: EXAM_CMD, proofRuns: [RUN_A, RUN_B],
    })]],
    extraArgs: { constraintChecks: [{ cmd: CHECK, minor: false }] },
  })
  const report = await run()
  const row = report.tasks.find((r) => r.task === 'T1')

  assert.deepEqual(labels.filter((l) => l === 'impl:T1'), ['impl:T1'],
    'sim precondition: one implementer was dispatched — ' + JSON.stringify(labels))
  assert.deepEqual(labels.filter((l) => l === 'exam:T1'), ['exam:T1'],
    'sim precondition: the examiner was dispatched — ' + JSON.stringify(labels))
  assert.equal(row.proofFixes, 1,
    'sim precondition: the red `Run:` bought one repair round — ' + JSON.stringify(row))
  assert.deepEqual(labels.filter((l) => l === 'fix:T1:0'), ['fix:T1:0'],
    'sim precondition: that round is the recorded `fix:T1:0` dispatch — ' + JSON.stringify(labels))

  // The block this task's two `Run:` lines and this run's one `Check:` line
  // make, spelled the way the Produces interface spells it.
  const BLOCK = '\nPROOFS:\n- Run: ' + RUN_A + '\n- Run: ' + RUN_B + '\n- Check: ' + CHECK
  const BODY_LINES = ['- Run: ' + RUN_A, '- Run: ' + RUN_B, '- Check: ' + CHECK]

  // [M1] leg (a): the implementer's prompt carries no TEST COMMAND line ...
  const implPrompt = prompts['impl:T1']
  assert.deepEqual(testCmdLinesOf(implPrompt), [],
    'the implementer\'s prompt carries NO line beginning `TEST COMMAND:` — it is handed its ' +
    'own task\'s proofs, never the suite: ' + JSON.stringify(testCmdLinesOf(implPrompt)))
  // ... and carries ONE `PROOFS:` block ...
  assert.deepEqual(proofsHeadsOf(implPrompt), ['PROOFS:'],
    'and exactly one `PROOFS:` block: ' + JSON.stringify(proofsHeadsOf(implPrompt)))
  // ... whose lines are the task's `Run:` commands then the run's `Check:`
  // commands, each verbatim, in plan order.
  assert.deepEqual(proofsBodyOf(implPrompt), BODY_LINES,
    'whose lines are exactly the two Proof `Run:` commands and the one Global Constraints ' +
    '`Check:` command, each verbatim, in plan order, prefixed `- Run: ` and `- Check: `: ' +
    JSON.stringify(proofsBodyOf(implPrompt)))
  assert.ok(implPrompt.includes(BLOCK),
    'and the block is that exact string — `' + JSON.stringify(BLOCK) + '` — as the task\'s ' +
    'Produces interface spells it')

  // [M2] leg (b): the fix round's prompt has the same shape and the same block.
  const fixPrompt = prompts['fix:T1:0']
  assert.deepEqual(testCmdLinesOf(fixPrompt), [],
    'the fix round\'s prompt carries no line beginning `TEST COMMAND:` either: ' +
    JSON.stringify(testCmdLinesOf(fixPrompt)))
  assert.deepEqual(proofsHeadsOf(fixPrompt), ['PROOFS:'],
    'it carries exactly one `PROOFS:` block: ' + JSON.stringify(proofsHeadsOf(fixPrompt)))
  assert.deepEqual(proofsBodyOf(fixPrompt), BODY_LINES,
    'and that block is the same one the implementer was handed, line for line: ' +
    JSON.stringify(proofsBodyOf(fixPrompt)))
  assert.ok(fixPrompt.includes(BLOCK),
    'as the same exact string the implementer\'s prompt carried — the repair round iterates ' +
    'against the same proofs the implementer did')

  // [M3] leg (c): the examiner keeps its TEST COMMAND line, naming the exam.
  const examPrompt = prompts['exam:T1']
  assert.deepEqual(testCmdLinesOf(examPrompt), ['TEST COMMAND: ' + EXAM_CMD],
    'the examiner\'s prompt still carries exactly one `TEST COMMAND:` line and it names the ' +
    'exam command, unchanged from BASE: ' + JSON.stringify(testCmdLinesOf(examPrompt)))
}

// ── S2: leg (a), second half [M1] ────────────────────────────────────────────
// A task with no Proof `Run:` in a run with no Global Constraints `Check:`.
// The task still carries a `testCmd` of its own and the run still has its
// run-wide one, so a prompt that kept either would be visible here: what M1
// asks for is the `(none — ...)` sentence and no TEST COMMAND line at all.
{
  const repo = makeRepo(path.join(tmp, 'repo-none'))
  const runDir = path.join(tmp, 'run-none')
  const labels = []
  const prompts = {}
  const stub = (prompt, opts, cwd) => {
    labels.push(opts.label)
    prompts[opts.label] = prompt
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') {
      fs.writeFileSync(path.join(cwd, 'two.txt'), 'from T2\n')
      return doneImpl(cwd)
    }
    if (kind === 'review') return passReview()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run } = rig({
    repo, runDir, stub, stamp: 'op2',
    // No `constraintChecks` at all: the run has no `Check:` to list.
    waves: [[mkTask('T2', ['two.txt'], { testCmd: 'bash check.sh' })]],
  })
  await run()

  assert.deepEqual(labels.filter((l) => l === 'impl:T2'), ['impl:T2'],
    'sim precondition: one implementer was dispatched — ' + JSON.stringify(labels))
  const implPrompt = prompts['impl:T2']
  assert.deepEqual(testCmdLinesOf(implPrompt), [],
    'a task with no `Run:` still carries no line beginning `TEST COMMAND:` — neither its own ' +
    'command nor the run-wide one: ' + JSON.stringify(testCmdLinesOf(implPrompt)))
  assert.deepEqual(proofsHeadsOf(implPrompt), ['PROOFS:'],
    'it still carries exactly one `PROOFS:` block: ' + JSON.stringify(proofsHeadsOf(implPrompt)))
  assert.deepEqual(proofsBodyOf(implPrompt), [NONE_LINE],
    'and with no `Run:` on the task and no `Check:` on the run that block says exactly ' +
    '`' + NONE_LINE + '`: ' + JSON.stringify(proofsBodyOf(implPrompt)))
}

// ── S3: leg (e) [M5] ─────────────────────────────────────────────────────────
// The reconciler is not a graded party and has no proofs of its own: it is
// handed the run-wide suite, which is the thing it repairs. The implementer
// here writes the rig's `BROKEN` marker, so `bash check.sh` is red on the
// FOLDED tree once and a `reconcile:` worker is dispatched; the stub removes
// the marker and reports FIXED, so the wave still adopts and the run ends the
// way every other scenario here does.
{
  const repo = makeRepo(path.join(tmp, 'repo-recon'))
  const runDir = path.join(tmp, 'run-recon')
  const RUN_WIDE = 'bash check.sh'
  const labels = []
  const prompts = {}
  const stub = (prompt, opts, cwd) => {
    labels.push(opts.label)
    prompts[opts.label] = prompt
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') {
      fs.writeFileSync(path.join(cwd, 'BROKEN'), 'the marker check.sh reads\n')
      return doneImpl(cwd)
    }
    if (kind === 'review') return passReview()
    if (kind === 'reconcile') {
      // cwd is the integration clone (the reconcile label carries no
      // `isolation: 'worktree'`), which is where the red candidate lives.
      fs.rmSync(path.join(cwd, 'BROKEN'), { force: true })
      return { status: 'FIXED', summary: 'removed the marker' }
    }
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run } = rig({
    repo, runDir, stub, stamp: 'op3', testCmd: RUN_WIDE,
    waves: [[mkTask('T3', ['BROKEN'])]],
  })
  await run()

  const reconciles = labels.filter((l) => l.startsWith('reconcile:'))
  assert.deepEqual(reconciles, ['reconcile:wave1:1'],
    'sim precondition: the folded tree\'s suite was red once and bought exactly one ' +
    'reconcile dispatch — ' + JSON.stringify(labels))
  const recPrompt = prompts['reconcile:wave1:1']
  assert.deepEqual(testCmdLinesOf(recPrompt), ['TEST COMMAND: ' + RUN_WIDE],
    'the reconciler\'s prompt still carries the run-wide `TEST COMMAND:` line: ' +
    JSON.stringify(testCmdLinesOf(recPrompt)))
  assert.deepEqual(proofsHeadsOf(recPrompt), [],
    'and no `PROOFS:` block — the proofs belong to a task, and the reconciler repairs the ' +
    'fold: ' + JSON.stringify(proofsHeadsOf(recPrompt)))
}

// ── S4: leg (d) [M4] ─────────────────────────────────────────────────────────
// The same two facts the Proof's first two `Run:` lines read, asserted here so
// the sim says what the commands say. Both greps count comment lines too: a
// symbol left behind in a comment paragraph that only exists to explain it is
// as much a hit as a definition.
{
  const src = fs.readFileSync(ENGINE_SRC, 'utf8')
  for (const sym of ['capWorkerParallelism', 'sharesRunWideCmd', 'runWideSharers',
                     'implTestCmdLine']) {
    assert.equal(src.includes(sym), false,
      'the string `' + sym + '` no longer occurs anywhere in fleet/run-engine.mjs — the ' +
      'symbol and the comment paragraph that exists to explain it both go')
  }
  for (const name of ['implementer.md', 'fix.md']) {
    const role = fs.readFileSync(path.join(ROLES_DIR, name), 'utf8')
    assert.equal(role.includes('TEST COMMAND'), false,
      'fleet/roles/' + name + ' contains no `TEST COMMAND` at all — the input it names is ' +
      'the `PROOFS:` block now')
    assert.ok(role.includes('PROOFS:'),
      'and it names `PROOFS:` instead: the worker is told which block to run its proofs from')
  }
}

// ── S5: leg (f) [M6] ─────────────────────────────────────────────────────────
// The Proof's last two `Run:` lines are what actually execute these, in the
// driver's own clone; what this pins is that each file is still there and
// still prints the line those commands grep for, so a survivor this task is
// allowed to edit cannot be dropped or silenced and read as green.
{
  for (const name of ['test_run_engine_proof_runs.mjs', 'test_run_engine_review_economy.mjs']) {
    const file = path.join(TESTS_DIR, name)
    assert.equal(fs.existsSync(file), true, 'the surviving sim ' + name + ' is still here')
    assert.ok(fs.readFileSync(file, 'utf8').includes("console.log('ALL TESTS PASSED')"),
      name + ' still ends in the `ALL TESTS PASSED` sentinel its `Run:` line greps for')
  }
}

console.log('ALL TESTS PASSED')
