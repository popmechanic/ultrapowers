// fleet/tests/test_run_engine_referee.mjs — the mechanical referee, inside the
// driver's pre-review pass (#729, Task 3).
//
// A reviewer model reads a patch and says what it thinks. Some of what it says
// is not an opinion at all — whether the patch touched a path the task was
// never given, whether the Proof's `Test:` file is on the tree, whether every
// `Produces:` symbol resolves at HEAD. `fleet/referee.mjs` already answers
// those mechanically; this file pins the ENGINE's half of that contract: that
// every task's captured patch is graded before any reviewer is billed, that a
// blocking finding the implementer can act on takes the same one repair round a
// red `Run:` takes, that a plan defect is parked for the gate instead, that the
// reviewer reads the settled facts as a `REFEREE:` block, and that the report
// counts what the referee found.
//
// Everything below the agent seam is real (git, clones, the driver's own
// capture, the real `sh` and `exec` seams); only the judgments are canned, so
// every referee record the assertions read is the driver's own.
//
// Machine clauses under test:
//   M1 — `prePass()` runs for EVERY task (its command, exam and check legs
//        empty when the task declares none) and calls `referee()` with the
//        driver-captured patch, the clone, the wave's other tasks' `files`, the
//        exam and its evidence, `n`, the linker and `runDir` — so
//        `<runDir>/referee/task-<id>-<n>.json` exists for a task with no
//        `Run:`, no `Check:` and no exam, with `n` = the number of fix rounds
//        that preceded the graded patch.
//   M2 — an `implementer`-actor `blocking` finding joins `reds` as `{line:
//        detail, stdout: ''}`: one `fix:<id>:0`, no `review:` before it, the
//        whole pass repeats once, and still-red is `proof-red` (a command,
//        exam or check red) or `referee-red` (only the referee), with no
//        reviewer dispatched.
//   M3 — a `plan`-actor blocking finding never joins `reds`: `planDefects`, a
//        `task <id>: referee <check> — <detail>` judgment call, review anyway,
//        and on a `done` task one `plan-defect: ` note and one
//        `deferredVerification` item with reason `plan-defect`.
//   M4 — the exam-files rule at the seam: an absent `Test:` path with an exam
//        that exited 0 is one blocking finding, actor `implementer` when the
//        path is in FILES and `plan` otherwise; an `exam` of `blocked` is a
//        settled `unexamined` line and no finding.
//   M5 — every review round's prompt ends with the `REFEREE:` block rendered by
//        the exported pure `refereeBlock(result)` from that round's record,
//        after CHECK EVIDENCE; `refereeBlock(null)` is `''`; referee `minor`
//        findings join `priorMinors` (de-dup on `detail`).
//   M6 — round 2 re-runs the referee on the repaired patch, writing
//        `-<proofFixes + 1>.json`; an `implementer`-actor blocking finding
//        there ends the task `fix-loop-exhausted` with no round-2 reviewer.
//   M8 — `report.reviewEconomy.refereeFindings` / `refereeBlocking`.
//   M9 — the linker seam: `args.linker` when it is a function, called with the
//        engine's `exec` seam and `SHELL_TIMEOUT_MS`; otherwise `linkProduces`.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { makeRepo, rig, passReview, cleanCritic, doneImpl } from '../../_engine_helpers.mjs'
// A namespace import, not a named one: a named import of a symbol the engine
// does not export yet is a link-time SyntaxError that reads as a bad import
// rather than as the absent implementation it is. The assertion below says
// which it is, in the contract's own words.
import * as engine from '../../../run-engine.mjs'

const { refereeBlock } = engine

assert.equal(typeof refereeBlock, 'function',
  '[M5] fleet/run-engine.mjs must export the pure function `refereeBlock(result)` — ' +
  'the REFEREE: block every review round\'s prompt ends with is its rendering')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-referee-'))
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }))

// ── the shared literals this file reads ─────────────────────────────────────
// The `REFEREE:` block's opening sentence, verbatim (Task 3's Context).
const REFEREE_OPENING = 'REFEREE: the driver\'s own arithmetic over the patch — the footprint, ' +
  'whether every Produces: symbol resolves at HEAD, and whether every exam file exists and ran. ' +
  'A line marked settled is decided; a line marked as a finding is already the fix loop\'s.'
// The three evidence-block names the REFEREE: block must never contain.
const OTHER_BLOCKS = ['EXAM EVIDENCE:', 'RUN EVIDENCE:', 'CHECK EVIDENCE:']
// `makeRepo`'s own `a.txt`, byte for byte: the fix rounds below that "restore"
// it put exactly these bytes back, so the repaired patch carries no hunk for it.
const A_TXT = 'line1\nline2\nline3\n'

// ── reading the driver's own record ─────────────────────────────────────────
const refereeDir = (runDir) => path.join(runDir, 'referee')
const refereePath = (runDir, id, n) =>
  path.join(refereeDir(runDir), 'task-' + id + '-' + n + '.json')
const readReferee = (runDir, id, n) => {
  const p = refereePath(runDir, id, n)
  assert.ok(fs.existsSync(p), '[M1] no referee record at ' + p +
    ' — every task\'s captured patch is graded inside the driver\'s pre-review pass, ' +
    'and round <n> writes task-<id>-<n>.json')
  return JSON.parse(fs.readFileSync(p, 'utf8'))
}
const refereeRecords = (runDir) => {
  const dir = refereeDir(runDir)
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')))
}
const countOf = (hay, needle) => String(hay).split(needle).length - 1
const checkFindings = (rec, check) => rec.findings.filter((f) => f.check === check)
const settledFor = (rec, check) => rec.settled.filter((s) => s.check === check)
const firstIndexOf = (calls, prefix) => calls.findIndex((l) => l.startsWith(prefix))

const mkTask = (over = {}) => ({
  id: 'T1', title: 't1', files: ['one.txt'], tier: 'standard', review: 'lean',
  writes: ['one.txt'], commutes: [], proofTests: [], proofRuns: [],
  body: 'sim task T1', ...over,
})

// The task leg (a) drives the linker seam with: one `.mjs` file, one Produces:
// bullet, and an implementer that exports the neighbouring name.
const VOWEL_BULLET = '`countVowels(s)`'
const X_WRONG = 'export const countVowel = (s) => String(s).length\n'
const X_RIGHT = 'export const countVowels = (s) => String(s).length\n'
const MISS_DETAIL = 'no export named countVowels in x.mjs (found: countVowel)'
const vowelTask = (over = {}) => mkTask({
  files: ['x.mjs'], writes: ['x.mjs'],
  interfaces: { consumes: [], produces: [VOWEL_BULLET] },
  ...over,
})
// `args.linker` — the in-process seam a sim passes instead of the real
// `linkProduces`. `answers` maps the 1-based call number to the answer.
const linkerStub = (answers) => {
  const seen = []
  const fn = async (o) => { seen.push(o); return answers(seen.length) }
  fn.seen = seen
  return fn
}
const MISSING = { status: 'missing', symbol: 'countVowels', detail: MISS_DETAIL }
const RESOLVED = { status: 'resolved', symbol: 'countVowels',
                   detail: 'x.mjs exports countVowels/1' }

// The runs leg (h) reads back: {report, runDir} of three sims above.
let cleanRun = null
let helperRun = null
let deletedRun = null

// ── (a) the pass runs for every task, and one repair round answers a
//        blocking finding the implementer can act on [M1, M2] ────────────────
{
  // A lean task with no `Run:`, no `Check:` and no exam: BASE's engine defined
  // `prePass()` INSIDE the guard `if (proofRuns.length || constraintChecks.length
  // || examRunnable)`, so nothing ran here at all. It runs now, with empty legs.
  const repo = makeRepo(path.join(tmp, 'a1-repo'))
  const runDir = path.join(tmp, 'a1-run')
  const calls = []
  const stub = (prompt, opts, cwd) => {
    calls.push(opts.label)
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') {
      fs.writeFileSync(path.join(cwd, 'one.txt'), 'from T1\n')
      return doneImpl(cwd)
    }
    if (kind === 'review') return passReview()
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run } = rig({ repo, runDir, waves: [[mkTask()]], stub, stamp: 'rf1' })
  const report = await run()
  cleanRun = { report, runDir }
  const row = report.tasks.find((r) => r.task === 'T1')
  assert.equal(row.status, 'done',
    '[M1] a lean task whose implementer wrote only its FILES entry must merge: ' +
    JSON.stringify(row))
  const rec = readReferee(runDir, 'T1', 0)
  assert.deepEqual(rec.findings, [],
    '[M1] a patch that touched only the task\'s own FILES raises nothing: ' +
    JSON.stringify(rec.findings))
  assert.ok(settledFor(rec, 'footprint').length >= 1,
    '[M1] the record must carry a settled `footprint` line — a review that only prints ' +
    'defects cannot be told apart from one that did not run: ' + JSON.stringify(rec.settled))
  assert.equal(rec.task, 'T1', '[M1] the record names its task: ' + JSON.stringify(rec))
  assert.equal(rec.n, 0,
    '[M1] `n` is the number of fix rounds that preceded the graded patch — 0 for the ' +
    'pre-pass tree: ' + JSON.stringify(rec))
  assert.equal(calls.filter((l) => l.startsWith('fix:')).length, 0,
    '[M2] nothing was found, so no repair round was bought: ' + calls.join(','))
}

{
  // An `interface` blocking finding: one `fix:<id>:0`, no `review:` before it,
  // the whole pass repeated once, and the round-1 prompt carrying the REPAIRED
  // record rather than the one that bought the round.
  const repo = makeRepo(path.join(tmp, 'a2-repo'))
  const runDir = path.join(tmp, 'a2-run')
  const calls = []
  const prompts = {}
  const linker = linkerStub((nth) => (nth === 1 ? MISSING : RESOLVED))
  const stub = (prompt, opts, cwd) => {
    calls.push(opts.label)
    prompts[opts.label] = prompt
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') {
      fs.writeFileSync(path.join(cwd, 'x.mjs'), X_WRONG)
      return doneImpl(cwd)
    }
    if (kind === 'fix') {
      fs.writeFileSync(path.join(cwd, 'x.mjs'), X_RIGHT)
      return doneImpl(cwd)
    }
    if (kind === 'review') return passReview()
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run } = rig({ repo, runDir, waves: [[vowelTask()]], stub, stamp: 'rf2',
                        extraArgs: { linker } })
  const report = await run()
  const row = report.tasks.find((r) => r.task === 'T1')

  assert.deepEqual(calls.filter((l) => l.startsWith('fix:')), ['fix:T1:0'],
    '[M2] a blocking referee finding buys exactly the one pre-review repair round a red ' +
    '`Run:` buys: ' + calls.join(','))
  const fixAt = calls.indexOf('fix:T1:0')
  const reviewAt = firstIndexOf(calls, 'review:')
  assert.ok(reviewAt === -1 || reviewAt > fixAt,
    '[M2] zero `review:` dispatches precede the repair round — the whole point is that no ' +
    'reviewer is billed for a patch the driver already graded red: ' + calls.join(','))
  const fixPrompt = prompts['fix:T1:0']
  const blockingAt = fixPrompt.indexOf('Blocking issues to resolve:')
  assert.ok(blockingAt !== -1,
    '[M2] the fix prompt lists the finding under `Blocking issues to resolve:`')
  const blockingSection = fixPrompt.slice(blockingAt)
  assert.ok(blockingSection.includes('countVowels'),
    '[M2] the fix round is handed the finding\'s detail verbatim (countVowels): ' +
    blockingSection.slice(0, 600))
  assert.ok(blockingSection.includes('countVowel'),
    '[M2] and the name the implementer actually exported (countVowel): ' +
    blockingSection.slice(0, 600))

  const rec0 = readReferee(runDir, 'T1', 0)
  assert.equal(rec0.findings.length, 1,
    '[M1] exactly one finding graded the first patch: ' + JSON.stringify(rec0.findings))
  assert.equal(rec0.findings[0].check, 'interface',
    '[M9] it is the `interface` check: ' + JSON.stringify(rec0.findings[0]))
  assert.equal(rec0.findings[0].severity, 'blocking',
    '[M2] a missing Produces: symbol is blocking: ' + JSON.stringify(rec0.findings[0]))
  assert.equal(rec0.findings[0].actor, 'implementer',
    '[M2] and the implementer is the actor who can act on it: ' + JSON.stringify(rec0.findings[0]))
  const rec1 = readReferee(runDir, 'T1', 1)
  assert.equal(rec1.n, 1,
    '[M1] `n` is 1 after `fix:T1:0`: ' + JSON.stringify(rec1))
  assert.deepEqual(rec1.findings, [],
    '[M2] the whole pass — commands, exam, checks, referee — repeats once after the round, ' +
    'and the repaired patch is clean: ' + JSON.stringify(rec1.findings))
  assert.equal(row.status, 'done', '[M2] so the task merges: ' + JSON.stringify(row))
  assert.equal(row.proofFixes, 1,
    '[M2] a referee-only red still counts as one pre-review repair round: ' + JSON.stringify(row))
  assert.equal(row.fixIterations, 0,
    '[M2] and it is not a review fix iteration: ' + JSON.stringify(row))

  // [M9] `args.linker`, being a function, is the linker the engine hands the
  // referee — asked once per Produces: bullet per round, about this task's own
  // files, in this task's own clone at HEAD. (What the referee puts on that
  // call is the referee's business, and `fleet/referee.mjs` is frozen here; the
  // default path's `exec` seam is what legs (g3) and (g4) exercise instead.)
  assert.ok(linker.seen.length >= 2,
    '[M9] the linker is called once per Produces: bullet per round: ' + linker.seen.length)
  const first = linker.seen[0]
  assert.equal(first.bullet, VOWEL_BULLET,
    '[M9] the bullet goes over verbatim, backticks and all: ' + JSON.stringify(first.bullet))
  assert.deepEqual(first.files, ['x.mjs'],
    '[M9] with the task\'s own files: ' + JSON.stringify(first.files))
  assert.equal(first.cloneDir, path.join(runDir, 'clones', 'task-T1'),
    '[M9] and the task\'s clone at HEAD: ' + JSON.stringify(first.cloneDir))

  // [M1, M5] round 1 reads the REPAIRED record. `-1.json`'s settled interface
  // line quotes the bullet, so `countVowels` is in the block either way — what
  // distinguishes the two renderings is that the repaired one carries no
  // blocking FINDING line at all.
  const p1 = prompts['review:T1:1']
  const at = p1.indexOf('\n\nREFEREE:')
  assert.ok(at !== -1, '[M5] the round-1 review prompt carries a REFEREE: block')
  const block = p1.slice(at)
  assert.equal(block, refereeBlock(rec1),
    '[M5] the block is the rendering of `-1.json` — the record of the patch this round is ' +
    'actually reading: ' + block.slice(0, 600))
  assert.notEqual(block, refereeBlock(rec0),
    '[M5] and not of `-0.json`, the patch the repair round replaced')
  assert.ok(!/\n- blocking: [^\n]*countVowels/.test(block),
    '[M5] so no blocking line names countVowels: ' + block.slice(0, 600))
}

{
  // A red `Run:` and a blocking referee finding are ONE repair round, and the
  // fix prompt lists both lines.
  const repo = makeRepo(path.join(tmp, 'a3-repo'))
  const runDir = path.join(tmp, 'a3-run')
  const calls = []
  const prompts = {}
  const linker = linkerStub((nth) => (nth === 1 ? MISSING : RESOLVED))
  const stub = (prompt, opts, cwd) => {
    calls.push(opts.label)
    prompts[opts.label] = prompt
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') {
      fs.writeFileSync(path.join(cwd, 'x.mjs'), X_WRONG)
      return doneImpl(cwd)
    }
    if (kind === 'fix') {
      fs.writeFileSync(path.join(cwd, 'x.mjs'), X_RIGHT)
      fs.writeFileSync(path.join(cwd, 'c.txt'), 'c\n')
      return doneImpl(cwd)
    }
    if (kind === 'review') return passReview()
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run } = rig({ repo, runDir, waves: [[vowelTask({ proofRuns: ['test -e c.txt'] })]],
                        stub, stamp: 'rf3', extraArgs: { linker } })
  await run()
  assert.deepEqual(calls.filter((l) => l.startsWith('fix:')), ['fix:T1:0'],
    '[M2] a red Run: and a blocking referee finding buy ONE round between them, not two: ' +
    calls.join(','))
  const fixPrompt = prompts['fix:T1:0']
  assert.ok(fixPrompt.includes('the Proof\'s Run: command failed: test -e c.txt'),
    '[M2] whose prompt carries the driver-minted red line: ' + fixPrompt.slice(-1200))
  assert.ok(fixPrompt.includes('countVowels'),
    '[M2] and the referee\'s detail beside it: ' + fixPrompt.slice(-1200))
}

{
  // Still red after the round, and only the referee is red: `referee-red`, and
  // no reviewer is ever dispatched.
  const repo = makeRepo(path.join(tmp, 'a4-repo'))
  const runDir = path.join(tmp, 'a4-run')
  const calls = []
  const linker = linkerStub(() => MISSING)
  const stub = (prompt, opts, cwd) => {
    calls.push(opts.label)
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') {
      fs.writeFileSync(path.join(cwd, 'x.mjs'), X_WRONG)
      return doneImpl(cwd)
    }
    if (kind === 'fix') return doneImpl(cwd)
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run } = rig({ repo, runDir, waves: [[vowelTask()]], stub, stamp: 'rf4',
                        extraArgs: { linker } })
  const report = await run()
  const row = report.tasks.find((r) => r.task === 'T1')
  assert.equal(row.status, 'failed',
    '[M2] still red after the pre-review repair round: ' + JSON.stringify(row))
  assert.equal(row.reviewVerdict, 'referee-red',
    '[M2] `referee-red` names the case where ONLY the referee is red: ' + JSON.stringify(row))
  assert.ok(String(row.notes).includes('countVowels'),
    '[M2] with the detail carried in notes: ' + JSON.stringify(row.notes))
  assert.equal(row.proofFixes, 1,
    '[M2] the referee-only red still bought one pre-review repair round: ' + JSON.stringify(row))
  assert.equal(calls.filter((l) => l.startsWith('review:')).length, 0,
    '[M2] and no reviewer was dispatched: ' + calls.join(','))
}

{
  // The other half of the same branch: the referee is clean the second time but
  // the `Run:` is still red, so the verdict is `proof-red`.
  const repo = makeRepo(path.join(tmp, 'a6-repo'))
  const runDir = path.join(tmp, 'a6-run')
  const calls = []
  const linker = linkerStub((nth) => (nth === 1 ? MISSING : RESOLVED))
  const stub = (prompt, opts, cwd) => {
    calls.push(opts.label)
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') {
      fs.writeFileSync(path.join(cwd, 'x.mjs'), X_WRONG)
      return doneImpl(cwd)
    }
    if (kind === 'fix') return doneImpl(cwd)
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run } = rig({ repo, runDir, waves: [[vowelTask({ proofRuns: ['test -e c.txt'] })]],
                        stub, stamp: 'rf6', extraArgs: { linker } })
  const report = await run()
  const row = report.tasks.find((r) => r.task === 'T1')
  assert.equal(row.reviewVerdict, 'proof-red',
    '[M2] a command, exam or check still red chooses `proof-red` over `referee-red`: ' +
    JSON.stringify(row))
  assert.equal(calls.filter((l) => l.startsWith('review:')).length, 0,
    '[M2] and still no reviewer: ' + calls.join(','))
}

// ── (b) the footprint at the seam [M2, M5] ──────────────────────────────────
{
  // A deleted BASE file outside FILES is blocking, and restoring it clears it.
  const repo = makeRepo(path.join(tmp, 'b1-repo'))
  const runDir = path.join(tmp, 'b1-run')
  const calls = []
  const prompts = {}
  const stub = (prompt, opts, cwd) => {
    calls.push(opts.label)
    prompts[opts.label] = prompt
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') {
      fs.writeFileSync(path.join(cwd, 'one.txt'), 'from T1\n')
      fs.rmSync(path.join(cwd, 'a.txt'))
      return doneImpl(cwd)
    }
    if (kind === 'fix') {
      fs.writeFileSync(path.join(cwd, 'a.txt'), A_TXT)
      return doneImpl(cwd)
    }
    if (kind === 'review') return passReview()
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run } = rig({ repo, runDir, waves: [[mkTask()]], stub, stamp: 'rf7' })
  const report = await run()
  deletedRun = { report, runDir }
  const row = report.tasks.find((r) => r.task === 'T1')
  assert.deepEqual(calls.filter((l) => l.startsWith('fix:')), ['fix:T1:0'],
    '[M2] deleting a BASE file the task was never given is blocking: ' + calls.join(','))
  assert.ok(prompts['fix:T1:0'].includes('a.txt'),
    '[M2] and the fix round is told which path: ' + prompts['fix:T1:0'].slice(-800))
  assert.equal(row.status, 'done',
    '[M2] restoring it clears the round: ' + JSON.stringify(row))
  const rec1 = readReferee(runDir, 'T1', 1)
  assert.deepEqual(rec1.findings, [],
    '[M2] the repaired patch is clean: ' + JSON.stringify(rec1.findings))
}

{
  // A path a wave SIBLING owns: the engine passes the wave's other tasks'
  // `files` arrays as `siblingFiles`, structured — never parsed back out of the
  // rendered SIBLING FILES string.
  const repo = makeRepo(path.join(tmp, 'b2-repo'))
  const runDir = path.join(tmp, 'b2-run')
  const calls = []
  const prompts = {}
  const stub = (prompt, opts, cwd) => {
    calls.push(opts.label)
    prompts[opts.label] = prompt
    const [kind, id] = opts.label.split(':')
    if (kind === 'impl') {
      if (id === 'T1') {
        fs.writeFileSync(path.join(cwd, 't1.txt'), 'from T1\n')
        fs.writeFileSync(path.join(cwd, 't2.txt'), 'T1 wrote this\n')
      } else {
        fs.writeFileSync(path.join(cwd, 't2.txt'), 'from T2\n')
      }
      return doneImpl(cwd)
    }
    if (kind === 'fix') {
      fs.rmSync(path.join(cwd, 't2.txt'), { force: true })
      return doneImpl(cwd)
    }
    if (kind === 'review') return passReview()
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const waves = [[
    mkTask({ id: 'T1', files: ['t1.txt'], writes: ['t1.txt'], body: 'sim task T1' }),
    mkTask({ id: 'T2', files: ['t2.txt'], writes: ['t2.txt'], body: 'sim task T2' }),
  ]]
  const { run } = rig({ repo, runDir, waves, stub, stamp: 'rf8' })
  await run()
  assert.deepEqual(calls.filter((l) => l.startsWith('fix:')), ['fix:T1:0'],
    '[M1] only the task that wrote its sibling\'s path is repaired: ' + calls.join(','))
  const fixPrompt = prompts['fix:T1:0']
  assert.ok(fixPrompt.includes('t2.txt'),
    '[M1] the finding names the sibling path: ' + fixPrompt.slice(-800))
  assert.ok(/sibling/i.test(fixPrompt.slice(fixPrompt.indexOf('Blocking issues to resolve:'))),
    '[M1] and says it belongs to a wave sibling: ' + fixPrompt.slice(-800))
  const rec0 = readReferee(runDir, 'T1', 0)
  assert.ok(checkFindings(rec0, 'footprint').some((f) => f.detail.includes('t2.txt')),
    '[M1] the record carries it as a footprint finding: ' + JSON.stringify(rec0.findings))
}

{
  // Two tasks GIVEN the same path (overlap=fold): settled, never a finding.
  const repo = makeRepo(path.join(tmp, 'b3-repo'))
  const runDir = path.join(tmp, 'b3-run')
  const stub = (prompt, opts, cwd) => {
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') {
      fs.writeFileSync(path.join(cwd, 'shared.txt'), 'shared\n')
      return doneImpl(cwd)
    }
    if (kind === 'review') return passReview()
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const waves = [[
    mkTask({ id: 'T1', files: ['shared.txt'], writes: ['shared.txt'], body: 'sim task T1' }),
    mkTask({ id: 'T2', files: ['shared.txt'], writes: ['shared.txt'], body: 'sim task T2' }),
  ]]
  const { run } = rig({ repo, runDir, waves, stub, stamp: 'rf9' })
  const report = await run()
  for (const id of ['T1', 'T2']) {
    const row = report.tasks.find((r) => r.task === id)
    assert.equal(row.status, 'done',
      '[M1] a path in BOTH tasks\' FILES is the shipped overlap case: ' + JSON.stringify(row))
    const rec = readReferee(runDir, id, 0)
    assert.deepEqual(checkFindings(rec, 'footprint'), [],
      '[M1] so neither record carries a footprint finding (' + id + '): ' +
      JSON.stringify(rec.findings))
    assert.ok(settledFor(rec, 'footprint').length >= 1,
      '[M1] it is settled and named instead (' + id + '): ' + JSON.stringify(rec.settled))
  }
}

{
  // An outside-FILES path that is not a deletion and not a sibling's: a MINOR.
  // It blocks nothing, joins `priorMinors`, and reaches the row's notes and the
  // round-1 REFEREE: block.
  const repo = makeRepo(path.join(tmp, 'b4-repo'))
  const runDir = path.join(tmp, 'b4-run')
  const calls = []
  const prompts = {}
  const stub = (prompt, opts, cwd) => {
    calls.push(opts.label)
    prompts[opts.label] = prompt
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') {
      fs.writeFileSync(path.join(cwd, 'one.txt'), 'from T1\n')
      fs.writeFileSync(path.join(cwd, 'helper.txt'), 'helper\n')
      return doneImpl(cwd)
    }
    if (kind === 'review') return passReview()
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run } = rig({ repo, runDir, waves: [[mkTask()]], stub, stamp: 'rf10' })
  const report = await run()
  helperRun = { report, runDir }
  const row = report.tasks.find((r) => r.task === 'T1')
  assert.equal(row.status, 'done', '[M2] a minor blocks nothing: ' + JSON.stringify(row))
  assert.equal(row.reviewVerdict, 'clean',
    '[M2] and costs no fix round, so round 1 is clean: ' + JSON.stringify(row))
  assert.equal(calls.filter((l) => l.startsWith('fix:')).length, 0,
    '[M2] no `fix:` dispatch: ' + calls.join(','))
  const rec0 = readReferee(runDir, 'T1', 0)
  const minor = rec0.findings.find((f) => f.severity === 'minor')
  assert.ok(minor && minor.detail.includes('helper.txt'),
    '[M2] the record carries one minor naming the path: ' + JSON.stringify(rec0.findings))
  assert.ok(String(row.notes).includes('helper.txt'),
    '[M5] referee minors join `priorMinors`, which the row\'s notes joins: ' +
    JSON.stringify(row.notes))
  const block = prompts['review:T1:1'].slice(prompts['review:T1:1'].indexOf('\n\nREFEREE:'))
  assert.ok(block.includes('minor'),
    '[M5] the REFEREE: block carries the severity: ' + block)
  assert.ok(block.includes('helper.txt'),
    '[M5] and the detail: ' + block)
}

// ── (c) the exam-files rule with a plan actor [M3, M4] ──────────────────────
// The examiner returns DONE and writes NOTHING, so the handoff copies nothing
// and the driver's exam runs with `t1_test.sh` absent at HEAD and exit 0. The
// path is not in the task's FILES, so nobody a fix round can reach was ever
// asked to create it: a plan defect, not a red.
const examTask = (over = {}) => mkTask({
  files: ['one.txt'], writes: ['one.txt'],
  proofTests: ['t1_test.sh'], testCmd: 'bash check.sh',
  body: '**Proof:**\n- Test: `t1_test.sh`\n- Legs: (a) one.txt exists [M1]',
  ...over,
})
{
  const repo = makeRepo(path.join(tmp, 'c-repo'))
  const runDir = path.join(tmp, 'c-run')
  const calls = []
  const stub = (prompt, opts, cwd) => {
    calls.push(opts.label)
    const kind = opts.label.split(':')[0]
    if (kind === 'exam') return { status: 'DONE', summary: 'exam written' }
    if (kind === 'impl') {
      fs.writeFileSync(path.join(cwd, 'one.txt'), 'from T1\n')
      return doneImpl(cwd)
    }
    if (kind === 'review') return passReview()
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run } = rig({ repo, runDir, waves: [[examTask()]], stub, stamp: 'rf11' })
  const report = await run()
  const row = report.tasks.find((r) => r.task === 'T1')
  assert.equal(row.status, 'done',
    '[M3] a plan-actor finding never joins `reds`, so the task proceeds to review and ' +
    'merges: ' + JSON.stringify(row))
  assert.equal(calls.filter((l) => l.startsWith('fix:')).length, 0,
    '[M3] and buys no fix round — no agent the loop can reach was asked to write that ' +
    'file: ' + calls.join(','))
  const rec0 = readReferee(runDir, 'T1', 0)
  const findings = checkFindings(rec0, 'exam-files')
  assert.equal(rec0.findings.length, 1,
    '[M4] exactly one finding: ' + JSON.stringify(rec0.findings))
  assert.equal(findings.length, 1,
    '[M4] it is the `exam-files` check: ' + JSON.stringify(rec0.findings))
  assert.equal(findings[0].severity, 'blocking',
    '[M4] blocking: ' + JSON.stringify(findings[0]))
  assert.equal(findings[0].actor, 'plan',
    '[M4] with actor `plan`, because `t1_test.sh` is not in the task\'s FILES: ' +
    JSON.stringify(findings[0]))
  const detail = findings[0].detail
  // The judgment-call literal for a blocking referee finding: the prefix is
  // `task <id>: referee <check> — `, and what follows it is the referee's own
  // detail, unrewritten.
  const prefix = 'task T1: referee exam-files — '
  const raised = report.judgmentCalls.filter((j) => String(j).startsWith(prefix))
  assert.equal(raised.length, 1,
    '[M3] exactly one judgment call begins `' + prefix + '`: ' +
    JSON.stringify(report.judgmentCalls))
  assert.equal(raised[0], prefix + detail,
    '[M3] and it is `task <id>: referee <check> — <detail>`: ' + JSON.stringify(raised[0]))
  assert.equal(countOf(row.notes, 'plan-defect: ' + detail), 1,
    '[M3] the raw detail appears once in notes, prefixed `plan-defect: `: ' +
    JSON.stringify(row.notes))
  assert.equal(report.deferredVerification.length, 1,
    '[M3] and once in deferredVerification: ' + JSON.stringify(report.deferredVerification))
  assert.equal(report.deferredVerification[0].deliverable, 'T1',
    '[M3] against this deliverable: ' + JSON.stringify(report.deferredVerification[0]))
  assert.equal(report.deferredVerification[0].reason, 'plan-defect',
    '[M3] with reason `plan-defect`: ' + JSON.stringify(report.deferredVerification[0]))
  assert.equal(report.deferredVerification[0].why, detail,
    '[M3] carrying the referee\'s raw detail: ' + JSON.stringify(report.deferredVerification[0]))
}

// ── (d) the same seam with an implementer actor, and the pair rule [M4, M7] ──
{
  // `t1_test.sh` IS in this task's FILES, so the finding is the implementer's
  // and takes the one repair round.
  const repo = makeRepo(path.join(tmp, 'd1-repo'))
  const runDir = path.join(tmp, 'd1-run')
  const calls = []
  const prompts = {}
  const stub = (prompt, opts, cwd) => {
    calls.push(opts.label)
    prompts[opts.label] = prompt
    const kind = opts.label.split(':')[0]
    if (kind === 'exam') return { status: 'DONE', summary: 'exam written' }
    if (kind === 'impl') {
      fs.writeFileSync(path.join(cwd, 'one.txt'), 'from T1\n')
      return doneImpl(cwd)
    }
    if (kind === 'fix') {
      fs.writeFileSync(path.join(cwd, 't1_test.sh'), '#!/bin/bash\ntest -f one.txt\n')
      return doneImpl(cwd)
    }
    if (kind === 'review') return passReview()
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const task = examTask({ files: ['one.txt', 't1_test.sh'], writes: ['one.txt', 't1_test.sh'] })
  const { run } = rig({ repo, runDir, waves: [[task]], stub, stamp: 'rf12' })
  const report = await run()
  const row = report.tasks.find((r) => r.task === 'T1')
  const rec0 = readReferee(runDir, 'T1', 0)
  assert.equal(checkFindings(rec0, 'exam-files').length, 1,
    '[M4] one exam-files finding: ' + JSON.stringify(rec0.findings))
  assert.equal(checkFindings(rec0, 'exam-files')[0].actor, 'implementer',
    '[M4] actor `implementer` when the Test: path is in the task\'s FILES: ' +
    JSON.stringify(rec0.findings))
  assert.deepEqual(calls.filter((l) => l.startsWith('fix:')), ['fix:T1:0'],
    '[M4] so a fix round follows: ' + calls.join(','))
  assert.ok(prompts['fix:T1:0'].includes('t1_test.sh'),
    '[M4] whose prompt names the path: ' + prompts['fix:T1:0'].slice(-800))
  assert.equal(row.status, 'done', '[M4] writing it ends the task done: ' + JSON.stringify(row))
  assert.equal(row.proofFixes, 1,
    '[M4] as one pre-review repair round: ' + JSON.stringify(row))
  assert.equal(row.fixIterations, 0,
    '[M4] and no review fix iteration: ' + JSON.stringify(row))
}

{
  // A BLOCKED examiner: the task proceeds unexamined by driver decision, which
  // is a settled line and never a finding — and a `peer` task with a clean
  // referee gets its two reviewers.
  const repo = makeRepo(path.join(tmp, 'd2-repo'))
  const runDir = path.join(tmp, 'd2-run')
  const calls = []
  const stub = (prompt, opts, cwd) => {
    calls.push(opts.label)
    const kind = opts.label.split(':')[0]
    if (kind === 'exam') return { status: 'BLOCKED', summary: 'no' }
    if (kind === 'impl') {
      fs.writeFileSync(path.join(cwd, 'one.txt'), 'from T1\n')
      return doneImpl(cwd)
    }
    if (kind === 'review') return passReview()
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run } = rig({ repo, runDir, waves: [[examTask({ review: 'peer' })]], stub,
                        stamp: 'rf13' })
  const report = await run()
  const rec0 = readReferee(runDir, 'T1', 0)
  assert.deepEqual(rec0.findings, [],
    '[M4] an `exam` of `blocked` yields no finding — the implementer did not choose it: ' +
    JSON.stringify(rec0.findings))
  const settled = settledFor(rec0, 'exam-files')
  assert.equal(settled.length, 1,
    '[M4] one settled exam-files line: ' + JSON.stringify(rec0.settled))
  assert.ok(settled[0].detail.includes('unexamined'),
    '[M4] saying the task proceeds unexamined: ' + JSON.stringify(settled[0]))
  assert.equal(calls.filter((l) => l.startsWith('review:T1:1:')).length, 2,
    '[M7] and a pass with no blocking implementer finding still buys two reviewers: ' +
    calls.join(','))
  assert.equal(report.reviewEconomy.refereeSkippedPairs, 0,
    '[M7] nothing was skipped: ' + JSON.stringify(report.reviewEconomy))
}

{
  // The plan-actor shape on a `peer` task: two reviewers, and the skip counter
  // stays 0 — a plan defect is not a repair the pair rule may charge for.
  const repo = makeRepo(path.join(tmp, 'd3-repo'))
  const runDir = path.join(tmp, 'd3-run')
  const calls = []
  const stub = (prompt, opts, cwd) => {
    calls.push(opts.label)
    const kind = opts.label.split(':')[0]
    if (kind === 'exam') return { status: 'DONE', summary: 'exam written' }
    if (kind === 'impl') {
      fs.writeFileSync(path.join(cwd, 'one.txt'), 'from T1\n')
      return doneImpl(cwd)
    }
    if (kind === 'review') return passReview()
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run } = rig({ repo, runDir, waves: [[examTask({ review: 'peer' })]], stub,
                        stamp: 'rf14' })
  const report = await run()
  assert.equal(calls.filter((l) => l.startsWith('review:T1:1:')).length, 2,
    '[M7] a pass whose only blocking finding had actor `plan` gets two reviewers: ' +
    calls.join(','))
  assert.equal(report.reviewEconomy.refereeSkippedPairs, 0,
    '[M7] and nothing is counted as a skipped pair: ' + JSON.stringify(report.reviewEconomy))
}

// ── (e) the block, as a pure function and in the prompt [M5] ────────────────
{
  assert.equal(refereeBlock(null), '',
    '[M5] `refereeBlock(null)` renders nothing at all — a task with no record keeps the ' +
    'prompt it had before this existed')
  assert.equal(refereeBlock(undefined), '', '[M5] and neither does undefined')
  const out = refereeBlock({
    findings: [{ check: 'footprint', severity: 'minor', actor: 'implementer', detail: 'd1' }],
    settled: [{ check: 'secrets', detail: 's1' }],
  })
  assert.ok(out.startsWith('\n\nREFEREE: the driver\'s own arithmetic over the patch'),
    '[M5] the block opens on its own paragraph with the opening sentence: ' +
    JSON.stringify(out.slice(0, 120)))
  assert.ok(out.startsWith('\n\n' + REFEREE_OPENING),
    '[M5] which is verbatim: ' + JSON.stringify(out.slice(0, REFEREE_OPENING.length + 8)))
  assert.ok(out.includes('\n- minor: d1'),
    '[M5] one line per finding, carrying its severity and detail: ' + JSON.stringify(out))
  assert.ok(out.includes('\n- settled (secrets): s1'),
    '[M5] then one line per settled entry: ' + JSON.stringify(out))
  assert.ok(out.indexOf('\n- minor: d1') < out.indexOf('\n- settled (secrets): s1'),
    '[M5] findings first, settled after: ' + JSON.stringify(out))
  for (const name of OTHER_BLOCKS) {
    assert.ok(!out.includes(name),
      '[M5] the block must never contain `' + name + '` — the pre-review and exam-evidence ' +
      'sims assert those block names are absent from a prompt that carries no such block: ' +
      JSON.stringify(out))
  }
}

{
  // In a run: the block is the LAST thing in the prompt, it is the rendering of
  // that round's record, and it sits after CHECK EVIDENCE when checks exist.
  const repo = makeRepo(path.join(tmp, 'e2-repo'))
  const runDir = path.join(tmp, 'e2-run')
  const prompts = {}
  const stub = (prompt, opts, cwd) => {
    prompts[opts.label] = prompt
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') {
      fs.writeFileSync(path.join(cwd, 'one.txt'), 'from T1\n')
      return doneImpl(cwd)
    }
    if (kind === 'review') return passReview()
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run } = rig({ repo, runDir, waves: [[mkTask()]], stub, stamp: 'rf15',
                        extraArgs: { constraintChecks: [{ cmd: 'true', minor: false }] } })
  await run()
  const p = prompts['review:T1:1']
  const at = p.indexOf('\n\nREFEREE:')
  assert.ok(at !== -1, '[M5] the round-1 review prompt carries the block')
  assert.equal(countOf(p, '\n\nREFEREE:'), 1,
    '[M5] exactly once: ' + countOf(p, '\n\nREFEREE:'))
  assert.equal(p.slice(at), refereeBlock(readReferee(runDir, 'T1', 0)),
    '[M5] and it is the rendering of that round\'s `referee/task-T1-0.json`, to the byte')
  const checksAt = p.indexOf('\n\nCHECK EVIDENCE:')
  assert.ok(checksAt !== -1, '[M5] sim precondition: the run declared a Check:')
  assert.ok(checksAt < at,
    '[M5] the block goes last, AFTER the CHECK EVIDENCE block — the pre-review sim pins ' +
    'CHECK EVIDENCE as following RUN EVIDENCE to the byte, which is why it sits here and ' +
    'nowhere else')
}

{
  // A minor the referee re-raises in round 2 is recorded ONCE: `priorMinors`
  // de-duplicates on `detail`, so round 2's advisories block and the row's
  // notes each list it a single time.
  const repo = makeRepo(path.join(tmp, 'e3-repo'))
  const runDir = path.join(tmp, 'e3-run')
  const prompts = {}
  let reviews = 0
  const stub = (prompt, opts, cwd) => {
    prompts[opts.label] = prompt
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') {
      fs.writeFileSync(path.join(cwd, 'one.txt'), 'v1\n')
      fs.writeFileSync(path.join(cwd, 'helper.txt'), 'helper\n')
      return doneImpl(cwd)
    }
    if (kind === 'fix') {
      fs.writeFileSync(path.join(cwd, 'one.txt'), 'v2\n')
      return doneImpl(cwd)
    }
    if (kind === 'review') {
      reviews += 1
      return reviews === 1
        ? { verdict: 'FIX_REQUIRED', issues: [{ severity: 'blocking', detail: 'v1 is wrong' }] }
        : passReview()
    }
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run } = rig({ repo, runDir, waves: [[mkTask()]], stub, stamp: 'rf16' })
  const report = await run()
  const row = report.tasks.find((r) => r.task === 'T1')
  const rec0 = readReferee(runDir, 'T1', 0)
  const minor = rec0.findings.find((f) => f.severity === 'minor')
  assert.ok(minor && minor.detail.includes('helper.txt'),
    '[M5] sim precondition: round 1\'s referee raised the outside-FILES minor: ' +
    JSON.stringify(rec0.findings))
  const rec1 = readReferee(runDir, 'T1', 1)
  assert.ok(rec1.findings.some((f) => f.detail === minor.detail),
    '[M6] and round 2\'s referee raised the same minor again: ' + JSON.stringify(rec1.findings))
  const p2 = prompts['review:T1:2']
  assert.ok(p2.includes('PRIOR-ROUND ADVISORIES'),
    '[M5] round 2 carries the advisories block: ' + p2.slice(-1200))
  assert.equal(countOf(p2.slice(p2.indexOf('PRIOR-ROUND ADVISORIES')), '\n- ' + minor.detail), 1,
    '[M5] listing the minor exactly once, de-duplicated on detail: ' +
    p2.slice(p2.indexOf('PRIOR-ROUND ADVISORIES'), p2.indexOf('PRIOR-ROUND ADVISORIES') + 800))
  assert.equal(row.notes, minor.detail,
    '[M5] and the row carries it once, not once per round: ' + JSON.stringify(row.notes))
}

// ── (f) round 2 re-runs the referee before any reviewer [M1, M6] ────────────
{
  const repo = makeRepo(path.join(tmp, 'f1-repo'))
  const runDir = path.join(tmp, 'f1-run')
  const calls = []
  const stub = (prompt, opts, cwd) => {
    calls.push(opts.label)
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') {
      fs.writeFileSync(path.join(cwd, 'one.txt'), 'v1\n')
      return doneImpl(cwd)
    }
    if (kind === 'fix') {
      fs.writeFileSync(path.join(cwd, 'one.txt'), 'v2\n')
      fs.rmSync(path.join(cwd, 'a.txt'))
      return doneImpl(cwd)
    }
    if (kind === 'review') {
      return { verdict: 'FIX_REQUIRED', issues: [{ severity: 'blocking', detail: 'v1 is wrong' }] }
    }
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run } = rig({ repo, runDir, waves: [[mkTask()]], stub, stamp: 'rf17' })
  const report = await run()
  const row = report.tasks.find((r) => r.task === 'T1')
  assert.equal(row.status, 'failed',
    '[M6] a blocking implementer finding in round 2 ends the task: ' + JSON.stringify(row))
  assert.equal(row.reviewVerdict, 'fix-loop-exhausted',
    '[M6] as `fix-loop-exhausted`: ' + JSON.stringify(row))
  assert.ok(String(row.notes).includes('a.txt'),
    '[M6] with the detail in notes: ' + JSON.stringify(row.notes))
  assert.equal(calls.filter((l) => l.startsWith('review:T1:2')).length, 0,
    '[M6] and no round-2 reviewer is dispatched: ' + calls.join(','))
  const rec1 = readReferee(runDir, 'T1', 1)
  assert.equal(rec1.n, 1,
    '[M1] proofFixes is 0, so round 2\'s record is `-1.json`: ' + JSON.stringify(rec1))
  assert.ok(rec1.findings.some((f) => f.severity === 'blocking' && f.actor === 'implementer'),
    '[M6] carrying the blocking finding that ended it: ' + JSON.stringify(rec1.findings))
}

{
  // The same, with a red `Run:` first: `proofFixes` is 1, so round 2's record
  // is `-2.json`.
  const repo = makeRepo(path.join(tmp, 'f2-repo'))
  const runDir = path.join(tmp, 'f2-run')
  const calls = []
  const stub = (prompt, opts, cwd) => {
    calls.push(opts.label)
    if (opts.label === 'impl:T1') {
      fs.writeFileSync(path.join(cwd, 'one.txt'), 'v1\n')
      return doneImpl(cwd)
    }
    if (opts.label === 'fix:T1:0') {
      fs.writeFileSync(path.join(cwd, 'c.txt'), 'c\n')
      return doneImpl(cwd)
    }
    if (opts.label === 'fix:T1:1') {
      fs.writeFileSync(path.join(cwd, 'one.txt'), 'v2\n')
      fs.rmSync(path.join(cwd, 'a.txt'))
      return doneImpl(cwd)
    }
    if (opts.label.startsWith('review:')) {
      return { verdict: 'FIX_REQUIRED', issues: [{ severity: 'blocking', detail: 'v1 is wrong' }] }
    }
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const task = mkTask({ files: ['one.txt', 'c.txt'], writes: ['one.txt', 'c.txt'],
                        proofRuns: ['test -e c.txt'] })
  const { run } = rig({ repo, runDir, waves: [[task]], stub, stamp: 'rf18' })
  const report = await run()
  const row = report.tasks.find((r) => r.task === 'T1')
  assert.equal(row.proofFixes, 1,
    '[M1] sim precondition: the pre-review pass was red once: ' + JSON.stringify(row))
  assert.equal(row.reviewVerdict, 'fix-loop-exhausted',
    '[M6] round 2\'s referee ended the task: ' + JSON.stringify(row))
  const rec2 = readReferee(runDir, 'T1', 2)
  assert.equal(rec2.n, 2,
    '[M6] round 2 writes `-<proofFixes + 1>.json`: ' + JSON.stringify(rec2))
  assert.ok(rec2.findings.some((f) => f.severity === 'blocking' && f.actor === 'implementer'),
    '[M6] with the blocking finding: ' + JSON.stringify(rec2.findings))
  assert.equal(calls.filter((l) => l.startsWith('review:T1:2')).length, 0,
    '[M6] and no round-2 reviewer: ' + calls.join(','))
}

// ── (g) the default linker: `linkProduces`, on the engine's own exec seam [M9]
{
  // `args.linker` absent, and no file the linker can read: `unlinked` is not a
  // finding, and the settled line says which file nobody looked at.
  const repo = makeRepo(path.join(tmp, 'g1-repo'))
  const runDir = path.join(tmp, 'g1-run')
  const stub = (prompt, opts, cwd) => {
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') {
      fs.writeFileSync(path.join(cwd, 'a.txt'), 'from T1\n')
      return doneImpl(cwd)
    }
    if (kind === 'review') return passReview()
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const task = mkTask({ files: ['a.txt'], writes: ['a.txt'],
                        interfaces: { consumes: [], produces: ['`ONE`'] } })
  const { run } = rig({ repo, runDir, waves: [[task]], stub, stamp: 'rf19' })
  const report = await run()
  const row = report.tasks.find((r) => r.task === 'T1')
  assert.equal(row.status, 'done',
    '[M9] a bullet no linker can read is not a defect in the patch: ' + JSON.stringify(row))
  const rec0 = readReferee(runDir, 'T1', 0)
  assert.deepEqual(checkFindings(rec0, 'interface'), [],
    '[M9] so no `interface` finding is raised: ' + JSON.stringify(rec0.findings))
  const settled = settledFor(rec0, 'interface')
  assert.equal(settled.length, 1,
    '[M9] one settled interface line instead: ' + JSON.stringify(rec0.settled))
  assert.ok(settled[0].detail.includes('ONE'),
    '[M9] naming the bullet: ' + JSON.stringify(settled[0]))
  // The linker's answer for a file with no linkable extension is `unlinked`;
  // what the settled line carries is that answer's reason, naming the file
  // nobody could read.
  assert.ok(/no linkable file|no linker for/.test(settled[0].detail),
    '[M9] and saying no linker read it: ' + JSON.stringify(settled[0]))
}

{
  // No `interfaces` key at all.
  const repo = makeRepo(path.join(tmp, 'g2-repo'))
  const runDir = path.join(tmp, 'g2-run')
  const stub = (prompt, opts, cwd) => {
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') {
      fs.writeFileSync(path.join(cwd, 'one.txt'), 'from T1\n')
      return doneImpl(cwd)
    }
    if (kind === 'review') return passReview()
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run } = rig({ repo, runDir, waves: [[mkTask()]], stub, stamp: 'rf20' })
  const report = await run()
  assert.equal(report.tasks.find((r) => r.task === 'T1').status, 'done')
  const rec0 = readReferee(runDir, 'T1', 0)
  assert.deepEqual(settledFor(rec0, 'interface'),
    [{ check: 'interface', detail: 'no Produces: to link' }],
    '[M9] a task with no Produces: records exactly that settled line: ' +
    JSON.stringify(rec0.settled))
}

{
  // The real `linkProduces`, on the engine's own `exec` seam: a `.mjs` file
  // that exports the promised symbol resolves.
  const repo = makeRepo(path.join(tmp, 'g3-repo'))
  const runDir = path.join(tmp, 'g3-run')
  const stub = (prompt, opts, cwd) => {
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') {
      fs.writeFileSync(path.join(cwd, 'lib.mjs'), 'export function add (a, b) { return a + b }\n')
      return doneImpl(cwd)
    }
    if (kind === 'review') return passReview()
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const task = mkTask({ files: ['lib.mjs'], writes: ['lib.mjs'],
                        interfaces: { consumes: [], produces: ['`add(a, b)`'] } })
  const { run } = rig({ repo, runDir, waves: [[task]], stub, stamp: 'rf21' })
  const report = await run()
  assert.equal(report.tasks.find((r) => r.task === 'T1').status, 'done',
    '[M9] a resolved Produces: symbol raises nothing')
  const rec0 = readReferee(runDir, 'T1', 0)
  assert.deepEqual(checkFindings(rec0, 'interface'), [],
    '[M9] no interface finding: ' + JSON.stringify(rec0.findings))
  assert.ok(settledFor(rec0, 'interface').some((s) => s.detail.includes('add/2')),
    '[M9] and the settled line records the symbol and its arity: ' +
    JSON.stringify(rec0.settled))
}

{
  // …and one that exports the neighbouring name does not.
  const repo = makeRepo(path.join(tmp, 'g4-repo'))
  const runDir = path.join(tmp, 'g4-run')
  const calls = []
  const prompts = {}
  const stub = (prompt, opts, cwd) => {
    calls.push(opts.label)
    prompts[opts.label] = prompt
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') {
      fs.writeFileSync(path.join(cwd, 'lib.mjs'), 'export function plus (a, b) { return a + b }\n')
      return doneImpl(cwd)
    }
    if (kind === 'fix') {
      fs.writeFileSync(path.join(cwd, 'lib.mjs'), 'export function add (a, b) { return a + b }\n')
      return doneImpl(cwd)
    }
    if (kind === 'review') return passReview()
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const task = mkTask({ files: ['lib.mjs'], writes: ['lib.mjs'],
                        interfaces: { consumes: [], produces: ['`add(a, b)`'] } })
  const { run } = rig({ repo, runDir, waves: [[task]], stub, stamp: 'rf22' })
  await run()
  assert.deepEqual(calls.filter((l) => l.startsWith('fix:')), ['fix:T1:0'],
    '[M9] a missing Produces: symbol is blocking and buys the repair round: ' + calls.join(','))
  const fixPrompt = prompts['fix:T1:0']
  assert.ok(fixPrompt.includes('add'),
    '[M9] the fix round is told the promised name: ' + fixPrompt.slice(-800))
  assert.ok(fixPrompt.includes('plus'),
    '[M9] and the one the file actually exports: ' + fixPrompt.slice(-800))
}

// ── (h) the report counts what the referee found [M8] ───────────────────────
{
  const totals = (runDir) => {
    const recs = refereeRecords(runDir)
    const all = recs.flatMap((r) => r.findings)
    return { findings: all.length, blocking: all.filter((f) => f.severity === 'blocking').length }
  }
  for (const [name, held] of [['clean', cleanRun], ['helper.txt', helperRun],
                              ['deleted a.txt', deletedRun]]) {
    const eco = held.report.reviewEconomy
    const t = totals(held.runDir)
    assert.equal(eco.refereeFindings, t.findings,
      '[M8] `refereeFindings` counts every referee finding of the run, all severities and ' +
      'all rounds (' + name + '): ' + JSON.stringify(eco))
    assert.equal(eco.refereeBlocking, t.blocking,
      '[M8] and `refereeBlocking` the blocking ones (' + name + '): ' + JSON.stringify(eco))
  }
  assert.equal(cleanRun.report.reviewEconomy.refereeFindings, 0,
    '[M8] both are 0 on a run whose only task is clean: ' +
    JSON.stringify(cleanRun.report.reviewEconomy))
  assert.equal(cleanRun.report.reviewEconomy.refereeBlocking, 0,
    '[M8] both are 0 on a run whose only task is clean: ' +
    JSON.stringify(cleanRun.report.reviewEconomy))
  assert.equal(helperRun.report.reviewEconomy.refereeFindings, 1,
    '[M8] 1 on the helper.txt run: ' + JSON.stringify(helperRun.report.reviewEconomy))
  assert.equal(helperRun.report.reviewEconomy.refereeBlocking, 0,
    '[M8] and 0 blocking, because the outside-FILES path is a minor: ' +
    JSON.stringify(helperRun.report.reviewEconomy))
  assert.equal(deletedRun.report.reviewEconomy.refereeFindings, 1,
    '[M8] 1 on the deleted-a.txt run, whose `-1.json` is clean: ' +
    JSON.stringify(deletedRun.report.reviewEconomy))
  assert.equal(deletedRun.report.reviewEconomy.refereeBlocking, 1,
    '[M8] and 1 blocking: ' + JSON.stringify(deletedRun.report.reviewEconomy))
}

console.log('ALL TESTS PASSED')
