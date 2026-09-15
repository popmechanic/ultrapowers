// fleet/tests/test_run_engine_amendment_lens.mjs — the amendments a worker
// DECLARED, rendered into the prompt of the referee who judges them.
//
// A worker that had to step outside its FILES, read a clause otherwise or
// re-aim a sim used to reach the referee as an undisclosed divergence, and the
// referee's only honest move was to call for the revert (run-2, 2026-09-04).
// #990 settles it the other way: the declaration is handed to the referee as a
// LENS — it says what changed and why, and the referee grades the change
// instead of undoing it. This file is that seam, end to end: the renderer, its
// place in the review prompt, and the six rows `fleet/roles/reviewer.md` must
// carry so a referee reads the block the way #990 decided.
//
// Machine clauses under test, restated:
//
//   M1 — `fleet/run-engine.mjs` exports `amendmentBlock(amendments)`: `''`
//        when the argument is not an array or is empty; otherwise
//        `'\n\nAMENDMENTS:'` followed by one line per entry,
//        `'\n- <amends>: <what> — <why>'`, in order.
//   M2 — the review prompt of a task carries `amendmentBlock` over the
//        implementer reply's `amendments` followed by the fix reply's (when a
//        fix round ran), rendered AFTER the exam evidence and after every
//        `EXAM CONCERN:` line; a task whose replies declared none has a review
//        prompt that contains no `AMENDMENTS:` — byte-for-byte the prompt it
//        had at BASE.
//   M3 — `fleet/roles/reviewer.md` says, in its numbered rules, six things:
//        (i) AMENDMENTS is the worker's own declaration and the SECOND
//        exception — beside `EXAM CONCERN:` — to the rule against reading an
//        implementer's report, and the `EXAM CONCERN:` paragraph names it as
//        the other exception; (ii) for each entry the referee checks the diff
//        does what `what` says and that `why` holds against the task text;
//        (iii) a declared amendment the diff bears out is lawful, named in the
//        review, never a finding and never something to revert; (iv) an
//        undeclared divergence the diff shows is a finding prefixed
//        `undeclared amendment:`, graded `minor`, naming the path or the
//        clause; (v) a declared amendment the diff contradicts is `blocking`
//        with actor `implementer`; (vi) deleting a file present at BASE the
//        Files block does not declare with `Delete:` stays blocking as at BASE.
//
// Legs, and the clause each comes from:
//   (a) [M1] the four renderings — two empties, a non-array, and the exact
//       two-entry string.
//   (b) [M2] one green run, one implementer `files` amendment: exactly one
//       `AMENDMENTS:`, after RUN EVIDENCE, carrying that one line.
//   (c) [M2] a red `Run:` bought a fix round: the implementer's entry first,
//       the fix round's second.
//   (d) [M2] the exam-concern shape: the block sits after the LAST
//       `EXAM CONCERN:` line.
//   (e) [M2] no amendments: no `AMENDMENTS` in anything the engine assembled,
//       the prompt byte-for-byte BASE's engine's, and the row and
//       `judgmentCalls` a `passReview` stub's.
//   (f) [M3] row (i), both halves — the third and fourth `Run:` lines.
//   (g) [M2] the evidence blocks a sibling sim pins are untouched on the
//       patched prompt, and the new block sits between EXAM and CHECK
//       EVIDENCE — the second `Run:` line's subject, read here without
//       spawning anything (`test_sims_are_hermetic.mjs` M4: no sim runs
//       another sim; the driver runs that command itself).
//   (h) [M3] row (ii) — the fifth `Run:` line.
//   (i) [M3] row (iii) — the sixth `Run:` line.
//   (j) [M3] row (iv) — the seventh `Run:` line.
//   (k) [M3] row (v) — the eighth `Run:` line.
//   (l) [M3] row (vi) — the ninth `Run:` line.
//
// Two readings this file makes, spelled out so a later session need not
// reconstruct them:
//
//   * M3 puts the word AMENDMENTS into `fleet/roles/reviewer.md`, and the role
//     file is the first thing in every review prompt. So M2's "contains no
//     `AMENDMENTS:`" and leg (e)'s "no `AMENDMENTS` substring" can only be
//     read against what the ENGINE assembled — the prompt with the role text
//     sliced off its front. Every index and every count below is taken on that
//     tail, and `assembled()` is where the slice happens.
//   * M2's "byte-for-byte the prompt it had at BASE" is the same reading: both
//     engines are driven against the SAME roles directory, so the only thing
//     the comparison can see is what the engine itself put in the prompt.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execSeam } from '../run-main.mjs'
import { makeCwdFor, withPatchCapture, defaultTaskIdOf } from '../run-waves.mjs'
import { runEngine, amendmentBlock } from '../run-engine.mjs'
import { ENV, rig, makeRepo, provision, passReview, doneImpl } from './_engine_helpers.mjs'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-amendment-lens-'))
// rmSync unlinks the base tree's `skills` symlink rather than following it.
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }))
const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const FLEET_DIR = fileURLToPath(new URL('..', import.meta.url))
const ROLES_DIR = fileURLToPath(new URL('../roles/', import.meta.url))
const REVIEWER_MD = fileURLToPath(new URL('../roles/reviewer.md', import.meta.url))
const BASE_SHA = '41cb53b606146ee16f7904eaf0440531257426f1'

// ── reading a prompt ────────────────────────────────────────────────────────
// The role text is the literal first bytes of every review prompt (`loadRoles`
// reads the file raw and the assembly starts `roles.reviewer + …`). Slicing it
// off leaves exactly what the engine assembled — the only place an
// `AMENDMENTS:` block the ENGINE rendered can be, and the only place where
// counting the word means anything once M3 has put it in the role text too.
const ROLE_TEXT = fs.readFileSync(REVIEWER_MD, 'utf8')
const assembled = (prompt) => {
  const p = String(prompt || '')
  assert.ok(p.startsWith(ROLE_TEXT),
    'sim precondition: a review prompt opens with fleet/roles/reviewer.md verbatim — ' +
    'the slice below is what the engine itself assembled:\n' + JSON.stringify(p.slice(0, 200)))
  return p.slice(ROLE_TEXT.length)
}
const countOf = (hay, needle) => hay.split(needle).length - 1

// ── the rig ─────────────────────────────────────────────────────────────────
const EXAM_FILE = 'a_test.sh'
const BODY = '**Claim:** the tree carries the implementer\'s line in a.txt\n' +
  'Machine: M1. `a.txt` holds `from-A`.\n\n' +
  '**Proof:**\n- Legs: (a) `a.txt` holds it [M1]'
const entry = (over = {}) => ({
  id: 'T1', title: 'the amendment lens', files: ['a.txt', 'fixed.txt'],
  tier: 'standard', review: 'peer', writes: ['a.txt'], commutes: [],
  interfaces: { consumes: [], produces: [] },
  testCmd: 'bash check.sh', proofTests: [], proofRuns: [], body: BODY, ...over,
})

// The amendment entries the stubs declare — the shared literal of #990:
// `{amends: 'clause'|'files'|'sim', what, why}` under the reply's `amendments`
// key. The rig's stub returns the field whatever any schema says, which is why
// this file needs nothing of the sibling task that adds it to the schema.
const IMPL_AM = { amends: 'files', what: 'edited one path outside FILES', why: 'no other seam existed' }
const FIX_AM = { amends: 'clause', what: 'read M2 the narrow way', why: 'the wide reading has no subject' }
const IMPL_LINE = '\n- files: edited one path outside FILES — no other seam existed'
const FIX_LINE = '\n- clause: read M2 the narrow way — the wide reading has no subject'

let seq = 0
// One canned run. `implAmendments`/`fixAmendments` are put on the reply object
// directly; `fixConcerns`, when given, makes the fix round's reply the
// `DONE_WITH_CONCERNS` + `exam:` shape that buys a referee beside a still-red
// exam. `examScript` is what the canned examiner writes at the task's one Proof
// `Test:` path — the only way to give a sim a RUNNABLE exam.
async function scenario({ task, implAmendments = null, fixAmendments = null,
                          fixConcerns = null, examScript = null,
                          constraintChecks = [], onImpl = () => {}, onFix = () => {} }) {
  seq += 1
  const stamp = 'al' + seq
  const repo = makeRepo(path.join(tmp, 'repo-' + stamp))
  const runDir = path.join(tmp, 'run-' + stamp)
  const calls = []
  const prompts = {}
  const stub = (prompt, opts, cwd) => {
    calls.push(opts.label)
    prompts[opts.label] = prompt
    const kind = opts.label.split(':')[0]
    if (kind === 'exam') {
      fs.writeFileSync(path.join(cwd, EXAM_FILE), String(examScript))
      return { status: 'DONE', summary: 'exam written' }
    }
    if (kind === 'impl') {
      onImpl(cwd)
      const reply = doneImpl(cwd)
      if (implAmendments) reply.amendments = implAmendments
      return reply
    }
    if (kind === 'fix') {
      onFix(cwd)
      const reply = doneImpl(cwd)
      if (fixAmendments) reply.amendments = fixAmendments
      if (fixConcerns) { reply.status = 'DONE_WITH_CONCERNS'; reply.concerns = fixConcerns }
      return reply
    }
    if (kind === 'review') return passReview()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run } = rig({
    repo, runDir, waves: [[task]], stub, stamp,
    // `foldAgeMs: 0` — every run here folds at its landings, as the sims that
    // pace reviewers on the kernel's folds do; the fold trigger is another
    // exam's subject.
    extraArgs: { constraintChecks, foldAgeMs: 0 },
  })
  const report = await run()
  return { report, row: report.tasks[0], calls, prompts }
}

// ════════════════════════════════════════════════════════════════════════════
// leg (a) [M1] — the renderer itself
// ════════════════════════════════════════════════════════════════════════════
{
  assert.equal(amendmentBlock(undefined), '',
    'leg (a) [M1]: `amendmentBlock(undefined)` renders nothing — a reply that declared ' +
    'no amendments must leave the prompt of every other task unchanged')
  assert.equal(amendmentBlock(null), '',
    'leg (a) [M1]: `amendmentBlock(null)` renders nothing')
  assert.equal(amendmentBlock([]), '',
    'leg (a) [M1]: `amendmentBlock([])` renders nothing — empty is not an empty heading')
  assert.equal(amendmentBlock('files: W — Y'), '',
    'leg (a) [M1]: an argument that is not an array renders nothing')
  assert.equal(
    amendmentBlock([{ amends: 'files', what: 'W', why: 'Y' },
                    { amends: 'clause', what: 'X', why: 'Z' }]),
    '\n\nAMENDMENTS:\n- files: W — Y\n- clause: X — Z',
    'leg (a) [M1]: two entries render as the heading and one `- <amends>: <what> — <why>` ' +
    'line each, in the order given')
}

// ════════════════════════════════════════════════════════════════════════════
// leg (b) [M2] — one green run, one declared amendment
// ════════════════════════════════════════════════════════════════════════════
// The implementer declares one `files` amendment beside a green `Run:`. The
// referee's prompt carries exactly one block, after the driver's own run
// evidence, and that block is the ONE line the reply declared and nothing else:
// with no Check: and no state exam, the block is the prompt's last bytes, so
// equality here reads the whole rendering rather than a substring of it.
{
  const CMD = "sh -c 'echo green-from-the-pass'"
  const { row, calls, prompts } = await scenario({
    task: entry({ proofRuns: [CMD] }),
    implAmendments: [IMPL_AM],
    onImpl: (cwd) => fs.writeFileSync(path.join(cwd, 'a.txt'), 'from-A\n'),
  })
  assert.deepEqual(calls, ['impl:T1', 'review:T1:1'],
    'sim precondition: a green pass dispatches the implementer and one referee: ' + calls.join(','))
  const tail = assembled(prompts['review:T1:1'])
  assert.equal(countOf(tail, 'AMENDMENTS:'), 1,
    'leg (b) [M2]: the review prompt carries exactly one `AMENDMENTS:` block:\n' + tail)
  assert.ok(tail.indexOf('AMENDMENTS:') > tail.indexOf('RUN EVIDENCE:'),
    'leg (b) [M2]: and it is rendered AFTER the driver\'s own RUN EVIDENCE, never before it:\n' +
    tail)
  assert.equal(tail.slice(tail.indexOf('\n\nAMENDMENTS:')),
    '\n\nAMENDMENTS:' + IMPL_LINE,
    'leg (b) [M2]: the block is the heading and the one line the implementer declared, ' +
    'rendered `- <amends>: <what> — <why>`:\n' + JSON.stringify(tail.slice(-400)))
  assert.equal(row.reviewVerdict, 'clean',
    'leg (b) [M2]: a declared amendment changes no verdict — the `passReview` stub\'s is ' +
    'what the row carries: ' + JSON.stringify(row))
}

// ════════════════════════════════════════════════════════════════════════════
// leg (c) [M2] — the implementer's entries, then the fix round's
// ════════════════════════════════════════════════════════════════════════════
// A `Run:` red on the implementer's tree and green on the fix round's buys one
// `fix:T1:0` and then a referee. The engine reassigns `impl` to the fix reply,
// so the implementer's own declaration survives only if it was held before the
// round: both reach the prompt, the implementer's first.
{
  const CMD = "sh -c 'test -f fixed.txt'"
  const { row, calls, prompts } = await scenario({
    task: entry({ proofRuns: [CMD] }),
    implAmendments: [IMPL_AM],
    fixAmendments: [FIX_AM],
    onImpl: (cwd) => fs.writeFileSync(path.join(cwd, 'a.txt'), 'from-A\n'),
    onFix: (cwd) => fs.writeFileSync(path.join(cwd, 'fixed.txt'), 'repaired\n'),
  })
  assert.deepEqual(calls, ['impl:T1', 'fix:T1:0', 'review:T1:1'],
    'sim precondition: the red pass bought one repair round and the repair bought the ' +
    'referee: ' + calls.join(','))
  const tail = assembled(prompts['review:T1:1'])
  assert.equal(countOf(tail, 'AMENDMENTS:'), 1,
    'leg (c) [M2]: one block, not one per reply:\n' + tail)
  assert.equal(tail.slice(tail.indexOf('\n\nAMENDMENTS:')),
    '\n\nAMENDMENTS:' + IMPL_LINE + FIX_LINE,
    'leg (c) [M2]: the implementer\'s entry is listed first and the fix round\'s second:\n' +
    JSON.stringify(tail.slice(-500)))
  assert.ok(tail.indexOf(IMPL_LINE.slice(1)) < tail.indexOf(FIX_LINE.slice(1)),
    'leg (c) [M2]: in that order and no other')
  assert.equal(row.reviewVerdict, 'clean', JSON.stringify(row))
}

// ════════════════════════════════════════════════════════════════════════════
// leg (d) [M2] — after the exam evidence, and after every EXAM CONCERN: line
// ════════════════════════════════════════════════════════════════════════════
// The #908 shape: a red exam no output can satisfy, a fix round that says so as
// an `exam:`-prefixed concern, and the referee dispatched to judge the exam
// instead of the run parking `proof-red`. The concern is the graded party's
// claim about the driver's red bytes; the amendments are the graded party's
// declaration about its own diff, and they are rendered after BOTH. `EXAM
// CONCERN:` occurs in the role text as well, so the LAST occurrence is the one
// the engine rendered.
{
  const EXAM_CMD = 'bash ' + EXAM_FILE
  const EXAM = '#!/bin/bash\necho exam-is-red-for-any-output\nexit 1\n'
  const CONCERN = 'exam: the case is red for any output'
  const { calls, prompts } = await scenario({
    task: entry({ proofTests: [EXAM_FILE], testCmd: EXAM_CMD }),
    examScript: EXAM,
    fixAmendments: [FIX_AM],
    fixConcerns: [CONCERN],
    onImpl: (cwd) => fs.writeFileSync(path.join(cwd, 'a.txt'), 'from-A\n'),
  })
  assert.deepEqual(calls, ['exam:T1', 'impl:T1', 'fix:T1:0', 'review:T1:1'],
    'sim precondition: the red exam bought the repair round and its `exam:` concern bought ' +
    'the one review round: ' + calls.join(','))
  const tail = assembled(prompts['review:T1:1'])
  const iAmend = tail.indexOf('AMENDMENTS:')
  const iConcern = tail.lastIndexOf('EXAM CONCERN:')
  const iExamEv = tail.indexOf('EXAM EVIDENCE:')
  assert.ok(iConcern !== -1,
    'sim precondition: the fix round\'s `exam:` concern reached the prompt:\n' + tail)
  assert.ok(tail.includes('EXAM CONCERN: ' + CONCERN),
    'sim precondition: verbatim, one line:\n' + tail.slice(iConcern - 50))
  assert.equal(countOf(tail, 'AMENDMENTS:'), 1,
    'leg (d) [M2]: exactly one block:\n' + tail)
  assert.ok(iAmend > iConcern,
    'leg (d) [M2]: the AMENDMENTS block is rendered after the LAST `EXAM CONCERN:` line ' +
    '(' + iAmend + ' vs ' + iConcern + '):\n' + tail.slice(iExamEv))
  assert.ok(iAmend > iExamEv,
    'leg (d) [M2]: and after the exam evidence itself (' + iAmend + ' vs ' + iExamEv + ')')
  assert.equal(tail.slice(tail.indexOf('\n\nAMENDMENTS:')),
    '\n\nAMENDMENTS:' + FIX_LINE,
    'leg (d) [M2]: carrying the fix round\'s one entry — an implementer that declared none ' +
    'contributes no line:\n' + JSON.stringify(tail.slice(-400)))
}

// ════════════════════════════════════════════════════════════════════════════
// leg (g) [M2] — the evidence blocks are where they were, the new block between
// ════════════════════════════════════════════════════════════════════════════
// The second `Run:` line of the Proof re-runs the sibling sim that pins the RUN,
// EXAM and CHECK EVIDENCE blocks' contents; the driver runs that command itself
// (no sim spawns another — `test_sims_are_hermetic.mjs` M4). What it pins is
// asserted here on the PATCHED prompt: all three blocks still carry the
// pre-review pass's commands, exits and outputs, and the block this task adds
// sits between the exam's evidence and the Check:'s — which is exactly the
// insertion point M2 names, read from the outside.
{
  const RUN_CMD = "sh -c 'echo run-evidence-line'"
  const CHECK_CMD = "sh -c 'echo check-evidence-line'"
  const EXAM_CMD = 'bash ' + EXAM_FILE
  // Red in the examiner's own clone (a.txt is BASE's there), green on the patch.
  const EXAM = '#!/bin/bash\necho exam-evidence-line\ngrep -q from-A a.txt\n'
  const { row, prompts } = await scenario({
    task: entry({ proofRuns: [RUN_CMD], proofTests: [EXAM_FILE], testCmd: EXAM_CMD }),
    examScript: EXAM,
    constraintChecks: [{ cmd: CHECK_CMD, minor: false }],
    implAmendments: [IMPL_AM],
    onImpl: (cwd) => fs.writeFileSync(path.join(cwd, 'a.txt'), 'from-A\n'),
  })
  assert.equal(row.status, 'done', 'sim precondition: the green pass merged: ' + JSON.stringify(row))
  const tail = assembled(prompts['review:T1:1'])
  for (const [label, cmd, out] of [['RUN', RUN_CMD, 'run-evidence-line'],
                                   ['EXAM', EXAM_CMD, 'exam-evidence-line'],
                                   ['CHECK', CHECK_CMD, 'check-evidence-line']]) {
    assert.ok(tail.includes('\n\n$ ' + cmd + '\nexit 0\n'),
      'leg (g) [M2]: the ' + label + ' EVIDENCE block still quotes its command with its exit:\n' +
      tail)
    assert.ok(tail.includes(out),
      'leg (g) [M2]: and what it printed — the ' + label + ' block\'s contents are unchanged ' +
      'by the block this task inserts')
  }
  const iRun = tail.indexOf('RUN EVIDENCE:')
  const iExam = tail.indexOf('EXAM EVIDENCE:')
  const iAmend = tail.indexOf('AMENDMENTS:')
  const iCheck = tail.indexOf('CHECK EVIDENCE:')
  assert.ok(iRun !== -1 && iExam !== -1 && iCheck !== -1 && iAmend !== -1,
    'sim precondition: all four blocks are in the prompt:\n' + tail)
  assert.ok(iRun < iExam && iExam < iAmend && iAmend < iCheck,
    'leg (g) [M2]: RUN, then EXAM, then AMENDMENTS, then CHECK — the new block is inserted ' +
    'after the exam evidence and before the Check:\'s, and the three evidence blocks keep ' +
    'the order they had: ' + JSON.stringify([iRun, iExam, iAmend, iCheck]) + '\n' + tail)
}

// ════════════════════════════════════════════════════════════════════════════
// leg (e) [M2] — a run that declared none is BASE's run
// ════════════════════════════════════════════════════════════════════════════
// Two halves. First: nothing the engine assembled carries the word at all — not
// an empty heading, not a blank line. Second: the prompt is byte-for-byte the
// one BASE's engine built. Both engines are driven through the SAME run
// directory (prompts name the patch FILE) and against the SAME roles directory,
// so the only difference the comparison can see is what the engine put there.
{
  const { report, row, calls, prompts } = await scenario({
    task: entry(),
    onImpl: (cwd) => fs.writeFileSync(path.join(cwd, 'a.txt'), 'from-A\n'),
  })
  assert.deepEqual(calls, ['impl:T1', 'review:T1:1'],
    'sim precondition: one implementer, one referee: ' + calls.join(','))
  const tail = assembled(prompts['review:T1:1'])
  assert.ok(!tail.includes('AMENDMENTS'),
    'leg (e) [M2]: a task whose replies declared none has a review prompt in which the ' +
    'engine assembled no AMENDMENTS at all:\n' + tail)
  assert.equal(row.reviewVerdict, 'clean',
    'leg (e) [M2]: and the row is the `passReview` stub\'s: ' + JSON.stringify(row))
  assert.equal(row.status, 'done', JSON.stringify(row))
  assert.deepEqual(report.judgmentCalls, [],
    'leg (e) [M2]: a clean run buys no judgment call — this seam mints none: ' +
    JSON.stringify(report.judgmentCalls))
}

// The byte-pin needs BASE in the object store. A depth-1 clone — the engine's
// own shallow leg and `actions/checkout`'s default — has no 41cb53b; there this
// half has nothing to say and says so, rather than failing for a reason
// unrelated to the tree.
const haveBase = (() => {
  try {
    execFileSync('git', ['cat-file', '-e', BASE_SHA + '^{commit}'],
      { cwd: REPO_ROOT, env: ENV, stdio: 'ignore' })
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
      { cwd: REPO_ROOT, env: ENV, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }))
  fs.symlinkSync(path.join(REPO_ROOT, 'skills'), path.join(baseTree, 'skills'))
  ;({ runEngine: baseRunEngine } =
    await import(pathToFileURL(path.join(baseTree, 'fleet', 'run-engine.mjs')).href))
} else {
  console.log('[leg (e)] BASE ' + BASE_SHA + ' is not in this clone (shallow) — the ' +
    'byte-for-byte comparison against the BASE engine is skipped')
}

const PIN_REPO = makeRepo(path.join(tmp, 'pin-repo'))
const pinRunDir = path.join(tmp, 'pin-run')
async function pinRun(engine) {
  fs.rmSync(pinRunDir, { recursive: true, force: true })
  const task = entry()
  const { base, clonesDir, patchesDir } =
    provision({ repo: PIN_REPO, runDir: pinRunDir, taskIds: [task.id] })
  const patchBase = { current: base }
  const cwdFor = makeCwdFor({ clonesDir })
  const prompts = {}
  const inner = async (p, opts) => {
    const cwd = cwdFor(opts)
    prompts[opts.label] = p
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') {
      fs.writeFileSync(path.join(cwd, 'a.txt'), 'from-A\n')
      return doneImpl(cwd)
    }
    if (kind === 'review') return passReview()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const agent = withPatchCapture({
    agent: inner, clonesDir, base: () => patchBase.current, patchesDir, taskIdOf: defaultTaskIdOf,
  })
  const report = await engine({
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
    rolesDir: ROLES_DIR,
    patchBase,
  })
  return { prompts, report }
}
{
  const basePin = haveBase ? await pinRun(baseRunEngine) : null
  const live = await pinRun(runEngine)
  assert.ok(live.prompts['review:T1:1'],
    'sim precondition: the live engine dispatched a referee: ' +
    JSON.stringify(Object.keys(live.prompts)))
  if (basePin) {
    assert.deepEqual(Object.keys(live.prompts).sort(), Object.keys(basePin.prompts).sort(),
      'leg (e) [M2]: the same roles are dispatched as on BASE\'s engine')
    for (const label of Object.keys(basePin.prompts)) {
      assert.equal(live.prompts[label], basePin.prompts[label],
        'leg (e) [M2]: a run whose replies declared no amendments leaves the ' + label +
        ' prompt byte-for-byte the one BASE\'s engine built from the same roles directory')
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// legs (f), (h), (i), (j), (k), (l) [M3] — what reviewer.md tells the referee
// ════════════════════════════════════════════════════════════════════════════
// The Proof's third through ninth `Run:` lines are `sed -n '/a/,/b/p' … | tr
// '\n' ' ' | grep -q '<pattern>'`. They are read here the same way, in process:
// the same two ranges, the same newline-to-space fold, and each pattern kept
// VERBATIM as the Proof wrote it, so this file says what those commands say
// rather than a paraphrase of it. Every construct in them (`.` and `.*`) means
// the same in a basic regular expression and in a JS one.
const REVIEWER_TEXT = fs.readFileSync(REVIEWER_MD, 'utf8')
// `sed -n '/start/,/end/p'`: from the first line matching `start` through the
// first LATER line matching `end`, inclusive; `end` is never tested against the
// start line itself, and the range may open again further down.
const sedRange = (text, start, end) => {
  const out = []
  let open = false
  for (const line of text.split('\n')) {
    if (!open) { if (start.test(line)) { open = true; out.push(line) } }
    else { out.push(line); if (end.test(line)) open = false }
  }
  return out
}
// `| tr '\n' ' '` — every newline sed printed, including the last, is a space.
const trNewlines = (lines) => lines.map((l) => l + ' ').join('')
const RANGES = {
  // sed -n '/^1\. /,/^Every issue names its/p'
  rules: trNewlines(sedRange(REVIEWER_TEXT, /^1\. /, /^Every issue names its/)),
  // sed -n '/^An .EXAM CONCERN:. line/,/^CHECK EVIDENCE/p'
  concern: trNewlines(sedRange(REVIEWER_TEXT, /^An .EXAM CONCERN:. line/, /^CHECK EVIDENCE/)),
}
assert.ok(RANGES.rules.length > 0,
  '[M3] sim precondition: fleet/roles/reviewer.md still has a numbered-rules block running ' +
  'from a line starting `1. ` to the line starting `Every issue names its`')
assert.ok(RANGES.concern.length > 0,
  '[M3] sim precondition: and an `EXAM CONCERN:` paragraph running to the `CHECK EVIDENCE` one')

// Each row: the leg, the clause row it encodes, which `Run:` line of the Proof
// it is, the sed range it reads, and that line's grep pattern verbatim.
const ROWS = [
  { leg: '(f)', row: '(i)', run: 'third', range: 'rules',
    pattern: 'AMENDMENTS.*second exception.*EXAM CONCERN',
    says: 'the numbered rules say AMENDMENTS is the SECOND exception, beside EXAM CONCERN:, ' +
      'to the rule against reading an implementer\'s report' },
  { leg: '(f)', row: '(i)', run: 'fourth', range: 'concern',
    pattern: 'AMENDMENTS.*exception',
    says: 'and the EXAM CONCERN: paragraph itself names AMENDMENTS as the other exception, ' +
      'rather than still calling itself the only one' },
  { leg: '(h)', row: '(ii)', run: 'fifth', range: 'rules',
    pattern: 'AMENDMENTS.*diff does what .what. says.*why.*task text',
    says: 'for each entry the referee checks the diff does what `what` says and that `why` ' +
      'holds against the task text' },
  { leg: '(i)', row: '(iii)', run: 'sixth', range: 'rules',
    pattern: 'declared amendment.*lawful.*named in the review.*never a finding.*never.*revert',
    says: 'a declared amendment the diff bears out is lawful, named in the review, never a ' +
      'finding and never something to revert — the whole point of #990' },
  { leg: '(j)', row: '(iv)', run: 'seventh', range: 'rules',
    pattern: 'no entry declares.*undeclared amendment:.*minor.*naming the path or the clause',
    says: 'a divergence the diff shows and no entry declares is a finding prefixed ' +
      '`undeclared amendment:`, graded minor, naming the path or the clause' },
  { leg: '(k)', row: '(v)', run: 'eighth', range: 'rules',
    pattern: 'declared amendment the diff contradicts.*blocking.*actor .implementer.',
    says: 'a declared amendment the diff contradicts is blocking with actor `implementer`' },
  { leg: '(l)', row: '(vi)', run: 'ninth', range: 'rules',
    pattern: 'deleting a file present at BASE.*Delete:.*blocking',
    says: 'and deleting a file present at BASE that the Files block does not declare with ' +
      '`Delete:` stays blocking, as it was at BASE' },
]
for (const r of ROWS) {
  const text = RANGES[r.range]
  assert.ok(new RegExp(r.pattern).test(text),
    'leg ' + r.leg + ' [M3] row ' + r.row + ' — the ' + r.run + ' `Run:` line of the Proof: ' +
    r.says + '. The pattern `' + r.pattern + '` matches nothing in the ' +
    (r.range === 'rules' ? 'numbered rules' : '`EXAM CONCERN:` paragraph') +
    ' of fleet/roles/reviewer.md:\n' + text)
}

console.log('ALL TESTS PASSED')
