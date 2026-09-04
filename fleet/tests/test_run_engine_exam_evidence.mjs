// fleet/tests/test_run_engine_exam_evidence.mjs — the exam the DRIVER runs
// (#638). A task whose Proof names `Test:` paths gets an examiner in wave 0;
// until now nobody ever executed what that examiner wrote on the implementer's
// tree, so a verdict could be settled by READING the tests instead of running
// them. This file pins the other half: the driver runs the task's own `testCmd`
// in the task's clone after the patch and before any referee, records the bytes,
// hands them to the review as EXAM EVIDENCE, and sends a patch that fails its
// own exam back for repair before a reviewer is billed for it.
//
// Everything below the agent seam is real (git, clones, capture, the fold
// kernel, the real `sh`); only the judgments are canned, so every exam
// execution the assertions observe is the driver's own.
//
// Machine clauses under test:
//   M1 — for a task with a non-empty `testCmd` and at least one `proofTests`
//        path, `testCmd` runs in the task's clone through the engine's `sh`
//        seam after the implementer and before any referee (`iter: 0`) and
//        again once per review round (`iter: 1`, and `iter: 2` for a second
//        round); each execution is recorded as { cmd, exit, stdout } with
//        stdout and stderr combined and tail-truncated to 4,000 characters,
//        and appended to events.jsonl as one `driver:exam-run` event carrying
//        task, cmd, exit and iter.
//   M2 — the review prompt carries an `EXAM EVIDENCE:` block (the command
//        verbatim, `exit <n>`, the recorded output) immediately after the
//        `RUN EVIDENCE` block's position; a task with a null `testCmd` or an
//        empty `proofTests` gets no event and no `EXAM EVIDENCE` text at all.
//   M3 — a non-zero exit at the pre-review pass is a red of the same standing
//        as a red `Run:`: one `fix:<id>:0` round told `the Proof's exam failed:
//        <cmd> — exit <n>`, and still red ⇒ `reviewVerdict: 'proof-red'` with
//        no reviewer dispatched. A non-zero exit at a review round makes that
//        round FIX_REQUIRED with a blocking issue naming the command and its
//        exit code, whatever the reviewer's own verdict.
//   M4 — fleet/roles/reviewer.md carries the paragraph that tells the referee
//        what EXAM EVIDENCE is and what an `exit 0` settles.
//   M5 — the wave-0 exam verdict and the recorded-edit rule are unchanged: the
//        examiner and exam-edit sims still pass.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { rig, makeRepo, passReview, cleanCritic, doneImpl } from './_engine_helpers.mjs'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-exam-evidence-'))
// Removed on exit, red or green (rmSync unlinks the fleet-copy's `skills`
// symlink rather than following it into the repo).
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }))
const TESTS_DIR = fileURLToPath(new URL('.', import.meta.url))
const REVIEWER_MD = fileURLToPath(new URL('../roles/reviewer.md', import.meta.url))

const EXAM_CMD = 'bash t1_test.sh'

// ── the tasks the sims run ──────────────────────────────────────────────────
const BODY = '**Claim:** the tree gains out.txt\n' +
  'Machine: M1. The tree holds `out.txt`.\n\n' +
  '**Proof:**\n- Test: `t1_test.sh`\n- Legs: (a) `out.txt` exists [M1]'
const entry = (over = {}) => ({
  id: 'T1', title: 'create out', files: ['out.txt'], tier: 'standard', review: 'lean',
  writes: ['out.txt'], commutes: [],
  interfaces: { consumes: ['`BASE_FACTS`'], produces: ['`OUT`'] },
  testCmd: EXAM_CMD, proofTests: ['t1_test.sh'], proofRuns: [],
  body: BODY,
  ...over,
})

// The exam the examiner stub writes into the task's clone. It is red at BASE
// (no `out.txt` until the implementer works), it prints one line to stdout and
// a distinguishable one to stderr, and it `cat`s a file only the task's OWN
// clone holds — so the recorded output is proof of the cwd as well as the exit.
// `orderFile`, when given, gets one `exam-run` line per execution: the ordering
// assertions read the driver's real executions, not a count of dispatches.
// `stampFile`, when given, raises the bar after the exam's first GREEN run —
// from then on it also demands `round2.txt`. That is the only way to make the
// pre-review pass and the review round differ: no agent runs between them, so
// the tree they see is identical by construction.
const examScript = ({ orderFile = null, stampFile = null } = {}) =>
  '#!/bin/bash\n' +
  (orderFile ? "echo exam-run >> '" + orderFile + "'\n" : '') +
  'echo exam-stdout-line\n' +
  'cat where.txt\n' +
  'echo exam-stderr-line 1>&2\n' +
  '[ -f out.txt ] || exit 1\n' +
  (stampFile
    ? "if [ -f '" + stampFile + "' ]; then [ -f round2.txt ] || exit 1; fi\n" +
      "touch '" + stampFile + "'\n"
    : '') +
  'exit 0\n'

// The truncation fixture: 5,000 characters and NOTHING else, on one stream, so
// the recorded output is that run of `x` and only that run of `x`.
const bulkExamScript = (n) =>
  '#!/bin/bash\n' +
  'head -c ' + n + " /dev/zero | tr '\\0' 'x'\n" +
  '[ -f out.txt ]\n'

const writeOut = (cwd) => {
  fs.writeFileSync(path.join(cwd, 'out.txt'), 'from T1\n')
  fs.writeFileSync(path.join(cwd, 'where.txt'), 'inside-task-clone\n')
}

// The run's own record. An absent file reads as no records, so a BASE engine
// that writes none fails the count assertion rather than an ENOENT.
const examRunEvents = (runDir) => {
  const file = path.join(runDir, 'events.jsonl')
  if (!fs.existsSync(file)) return []
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l) } catch { return null } })
    .filter((e) => e && e.kind === 'driver:exam-run')
}

// M2 says a task with no exam carries "no `EXAM EVIDENCE` text anywhere in its
// review prompt", and M4 says reviewer.md carries a paragraph naming
// `EXAM EVIDENCE` — and every review prompt opens with reviewer.md verbatim. So
// the literal "anywhere" is unsatisfiable, and the reading that is not is the
// one leg (b) leads with and the one RUN EVIDENCE already uses: the BLOCK is
// `EXAM EVIDENCE:`, colon and all, while the role's prose is `EXAM EVIDENCE,`.
// The prompt's driver-built tail — everything after the role text — is then
// checked for the phrase in any form at all, which is where "anywhere" bites.
const REVIEWER_ROLE = fs.readFileSync(REVIEWER_MD, 'utf8')
const promptTail = (prompt) => String(prompt || '').slice(REVIEWER_ROLE.length)

// The EXAM EVIDENCE block alone: from its own header up to the next block, so
// an `exit 0` found here came from the exam and not from a neighbour.
const examEvidenceOf = (prompt) => {
  const text = String(prompt || '')
  const i = text.indexOf('EXAM EVIDENCE:')
  if (i === -1) return ''
  const rest = text.slice(i)
  const j = rest.indexOf('\n\nCHECK EVIDENCE:')
  return j === -1 ? rest : rest.slice(0, j)
}

// ── the sim rig: the shared one, plus an exam script per task ───────────────
let seq = 0
async function scenario({ tasks, exams = {}, review = () => passReview(),
                          onImpl = writeOut, onFix = () => {}, orderFile = null,
                          extraArgs = {} }) {
  seq += 1
  const stamp = 'ee' + seq
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
    const id = opts.label.split(':')[1]
    if (kind === 'exam') {
      fs.writeFileSync(path.join(cwd, 't1_test.sh'), exams[id])
      return { status: 'DONE', summary: 'exam written' }
    }
    if (kind === 'impl') { onImpl(cwd, id); return doneImpl(cwd) }
    if (kind === 'fix') { onFix(cwd, opts.label); return doneImpl(cwd) }
    if (kind === 'review') { reviews += 1; return review(reviews, opts.label) }
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run } = rig({
    repo, runDir, waves: [tasks], stub, stamp,
    extraArgs: { shallowLeg: false, ...extraArgs },
  })
  const report = await run()
  const rowOf = (id) => report.tasks.find((t) => t.task === id)
  return { report, row: report.tasks[0], rowOf, calls, prompts, runDir,
           events: examRunEvents(runDir) }
}

// ── leg (a): order, clone, event shape, combined streams [M1] ───────────────
// The exam appends a line of its own to the dispatch log, so where it sits
// relative to `impl:T1` and `review:T1:1` is read off what the driver actually
// ran rather than off anything the engine reports about itself.
{
  const orderFile = path.join(tmp, 'order-a.log')
  const { row, calls, prompts, events } = await scenario({
    tasks: [entry()],
    exams: { T1: examScript({ orderFile }) },
    orderFile,
  })

  // [M1] the exam ran after the implementer and before the first review, twice:
  // the driver's own pre-review pass and review round 1's fresh execution. The
  // FIRST `exam-run` is wave 0's red-at-BASE probe, which M5 leaves as it was.
  const order = fs.readFileSync(orderFile, 'utf8').split('\n')
    .filter(Boolean).filter((l) => l !== 'integration')
  assert.deepEqual(order,
    ['exam:T1', 'exam-run', 'impl:T1', 'exam-run', 'exam-run', 'review:T1:1'],
    'the exam runs at BASE for the wave-0 verdict, then twice after the ' +
    'implementer — the pre-review pass and the review round — both before any referee')

  // [M1] one `driver:exam-run` record per post-patch execution, and only those.
  assert.equal(events.length, 2,
    'both post-patch executions are recorded, and the wave-0 BASE probe is not: ' +
    JSON.stringify(events))
  assert.deepEqual(events.map((e) => e.cmd), [EXAM_CMD, EXAM_CMD],
    'the exam command is recorded verbatim')
  assert.deepEqual(events.map((e) => e.exit), [0, 0])
  assert.deepEqual(events.map((e) => e.task), ['T1', 'T1'])
  assert.deepEqual(events.map((e) => e.iter), [0, 1],
    'the driver\'s own pass is iter 0; the first review round is iter 1')

  // [M1] the recorded output: stdout AND stderr, from the task's own clone.
  const ev = examEvidenceOf(prompts['review:T1:1'])
  assert.ok(ev.includes('exam-stdout-line'), 'what the exam printed to stdout: ' + ev.slice(0, 400))
  assert.ok(ev.includes('exam-stderr-line'),
    'and what it printed to stderr, combined rather than dropped: ' + ev.slice(0, 400))
  assert.ok(ev.includes('inside-task-clone'),
    'the exam ran in the task\'s own clone, after the implementer wrote there')

  // The wave-0 verdict and the row are untouched by any of this [M5].
  assert.equal(row.exam, 'red', 'the exam was red at BASE — it establishes something')
  assert.equal(row.status, 'done')
  assert.equal(row.reviewVerdict, 'clean')
  assert.equal(row.proofFixes, 0)
  assert.ok(!calls.some((l) => l.startsWith('fix:')), 'no repair round: ' + calls.join(','))
}

// ── leg (a): 5,000 characters of output recorded as exactly 4,000 [M1] ──────
// Format-agnostic: the bulk output is one unbroken run of `x`, so the longest
// such run in the review prompt IS the recorded output's length.
{
  const { prompts, events } = await scenario({
    tasks: [entry()],
    exams: { T1: bulkExamScript(5000) },
  })
  assert.deepEqual(events.map((e) => e.iter), [0, 1])
  assert.deepEqual(events.map((e) => e.exit), [0, 0])
  const runs = (prompts['review:T1:1'].match(/x+/g) || []).map((r) => r.length)
  assert.equal(Math.max(0, ...runs), 4000,
    'a 5,000-character exam output is tail-truncated to exactly 4,000 characters')
}

// ── leg (b): the block, its position, and the task that gets none [M2] ──────
// T1 carries a `Run:` command and the run carries a `Check:` constraint, so all
// three evidence blocks are live at once and the exam's place among them is
// observable. T2 is the sibling with no exam at all.
{
  const RUN_CMD = "sh -c 'echo run-evidence-line'"
  const CHECK_CMD = "sh -c 'echo check-evidence-line'"
  const T2 = entry({
    id: 'T2', title: 'create two', files: ['two.txt'], writes: ['two.txt'],
    testCmd: null, proofTests: [], proofRuns: [],
    body: '**Claim:** the tree gains two.txt\nMachine: M1. The tree holds `two.txt`.\n\n' +
      '**Proof:**\n- Legs: (a) `two.txt` exists [M1]',
  })
  const { rowOf, prompts, events } = await scenario({
    tasks: [entry({ proofRuns: [RUN_CMD] }), T2],
    exams: { T1: examScript() },
    onImpl: (cwd, id) => {
      if (id === 'T2') { fs.writeFileSync(path.join(cwd, 'two.txt'), 'from T2\n'); return }
      writeOut(cwd)
    },
    extraArgs: { constraintChecks: [{ cmd: CHECK_CMD, minor: false }] },
  })

  const p1 = prompts['review:T1:1']
  assert.equal(typeof p1, 'string', 'T1 reached a reviewer')
  assert.ok(p1.includes('EXAM EVIDENCE:'), 'the review prompt carries an EXAM EVIDENCE: block')
  const ev = examEvidenceOf(p1)
  assert.ok(ev.includes('$ ' + EXAM_CMD),
    'the block quotes the exam command verbatim, `$ `-prefixed: ' + ev.slice(0, 400))
  assert.ok(ev.includes('exit 0'), 'and the exit code the driver recorded: ' + ev.slice(0, 400))
  assert.ok(ev.includes('exam-stdout-line'), 'and what the exam printed')

  // [M2] placed at the RUN EVIDENCE block's position — after it, before CHECK.
  assert.ok(p1.includes('RUN EVIDENCE:') && p1.includes('CHECK EVIDENCE:'),
    'the neighbouring blocks are live, so the position means something')
  assert.ok(p1.indexOf('RUN EVIDENCE:') < p1.indexOf('EXAM EVIDENCE:'),
    'the EXAM EVIDENCE block follows the RUN EVIDENCE block')
  assert.ok(p1.indexOf('EXAM EVIDENCE:') < p1.indexOf('CHECK EVIDENCE:'),
    'and precedes the CHECK EVIDENCE block')
  assert.ok(ev.includes('run-evidence-line') === false,
    'the exam block is the exam\'s own bytes, not the Run: command\'s: ' + ev.slice(0, 400))

  // [M2] the sibling with `testCmd: null` and `proofTests: []`: nothing at all.
  const p2 = prompts['review:T2:1']
  assert.equal(typeof p2, 'string', 'T2 reached a reviewer too')
  assert.ok(p2.startsWith(REVIEWER_ROLE),
    'the review prompt still opens with reviewer.md verbatim')
  assert.ok(!p2.includes('EXAM EVIDENCE:'),
    'a task with no exam gets no EXAM EVIDENCE: block')
  assert.ok(!promptTail(p2).includes('EXAM EVIDENCE'),
    'and no EXAM EVIDENCE text of any form anywhere the driver built the prompt')
  assert.deepEqual(events.filter((e) => e.task === 'T2'), [],
    'and no driver:exam-run event of its own')
  assert.ok(events.some((e) => e.task === 'T1'), 'while T1 still has its own')
  assert.equal(rowOf('T1').status, 'done')
  assert.equal(rowOf('T2').status, 'done')
}

// ── leg (b): a live `testCmd` with an empty `proofTests` is also no exam [M2] ─
// M2's condition is a disjunction, and this is its other half: the guard is the
// same pair that dispatches the examiner, so a Proof naming no test path buys
// no exam run even though the task carries a command that would work.
{
  const { row, calls, prompts, events } = await scenario({
    tasks: [entry({ proofTests: [] })],
  })
  assert.ok(!calls.some((l) => l.startsWith('exam:')), 'no examiner: ' + calls.join(','))
  assert.deepEqual(events, [], 'and no driver:exam-run event')
  assert.ok(!prompts['review:T1:1'].includes('EXAM EVIDENCE:'),
    'and no EXAM EVIDENCE: block in the review prompt')
  assert.ok(!promptTail(prompts['review:T1:1']).includes('EXAM EVIDENCE'),
    'nor the phrase in any form anywhere the driver built the prompt')
  assert.equal(row.exam, null)
  assert.equal(row.status, 'done')
}

// ── leg (c): a red exam at the pre-review pass buys one repair round [M3] ───
// The implementer never writes `out.txt` and neither does the fix round, so the
// exam is red on both passes: one `fix:T1:0`, no referee, `proof-red`.
{
  const { row, calls, prompts, events } = await scenario({
    tasks: [entry()],
    exams: { T1: examScript() },
    onImpl: (cwd) => fs.writeFileSync(path.join(cwd, 'where.txt'), 'inside-task-clone\n'),
    onFix: () => {},
    review: () => passReview(),
  })
  const fixes = calls.filter((l) => l.startsWith('fix:'))
  assert.deepEqual(fixes, ['fix:T1:0'],
    'one pre-review repair round, and only one: ' + calls.join(','))
  assert.ok(!calls.some((l) => l.startsWith('review:')),
    'no referee reads a patch that fails its own exam: ' + calls.join(','))
  assert.equal(row.reviewVerdict, 'proof-red')
  assert.equal(row.status, 'failed', 'a red exam cannot merge on a canned PASS')
  assert.equal(row.proofFixes, 1)

  // [M3] the blocking line the fix round is handed, verbatim, with the output.
  const fixPrompt = prompts['fix:T1:0']
  assert.ok(fixPrompt.includes('the Proof\'s exam failed: ' + EXAM_CMD + ' — exit 1'),
    'the repair round is told, in the clause\'s own words, which exam failed and ' +
    'with what exit code: ' + fixPrompt.slice(-600))
  assert.ok(fixPrompt.includes('exam-stdout-line') && fixPrompt.includes('exam-stderr-line'),
    'and is handed the output the exam produced, both streams: ' + fixPrompt.slice(-600))
  assert.ok(row.notes.includes('the Proof\'s exam failed: ' + EXAM_CMD + ' — exit 1'),
    'and the run report records the same line: ' + row.notes)

  // [M1] one record per execution: two pre-review passes, both red, both iter 0.
  assert.deepEqual(events.map((e) => e.iter), [0, 0],
    'both executions belong to the driver\'s own pass')
  assert.deepEqual(events.map((e) => e.exit), [1, 1])
  assert.deepEqual(events.map((e) => e.cmd), [EXAM_CMD, EXAM_CMD])
}

// ── leg (c): a repair round that fixes it reaches review at `exit 0` [M3] ───
{
  const { row, calls, prompts, events } = await scenario({
    tasks: [entry()],
    exams: { T1: examScript() },
    onImpl: (cwd) => fs.writeFileSync(path.join(cwd, 'where.txt'), 'inside-task-clone\n'),
    onFix: (cwd) => fs.writeFileSync(path.join(cwd, 'out.txt'), 'from the fix round\n'),
  })
  assert.deepEqual(calls.filter((l) => l !== 'integration'),
    ['exam:T1', 'impl:T1', 'fix:T1:0', 'review:T1:1'],
    'red exam → one repair round → the first review, on a tree the exam passes')
  const ev = examEvidenceOf(prompts['review:T1:1'])
  assert.ok(ev.includes('exit 0'), 'the referee reads a fresh, green execution: ' + ev.slice(0, 400))
  assert.ok(!ev.includes('exit 1'),
    'and the new evidence REPLACES the red one: ' + ev.slice(0, 400))
  assert.deepEqual(events.map((e) => e.exit), [1, 0, 0])
  assert.deepEqual(events.map((e) => e.iter), [0, 0, 1])
  assert.equal(row.status, 'done')
  assert.equal(row.reviewVerdict, 'clean')
  assert.equal(row.proofFixes, 1)
}

// ── leg (c): a red exam in a REVIEW ROUND outranks the reviewer's PASS [M3] ─
// The exam passes the pre-review pass and then demands `round2.txt` from its
// first green run onward — the tree is identical across those two executions,
// so nothing but the exam's own state can tell them apart. Round 1 is therefore
// red on a tree the driver already cleared, and the canned reviewer says PASS
// to both rounds: the blocking issue is the driver's, not the referee's.
{
  const stampFile = path.join(tmp, 'round2-stamp')
  const { row, calls, prompts, events } = await scenario({
    tasks: [entry()],
    exams: { T1: examScript({ stampFile }) },
    onFix: (cwd) => fs.writeFileSync(path.join(cwd, 'round2.txt'), 'from the fix round\n'),
    review: () => passReview(),
  })
  assert.ok(!calls.includes('fix:T1:0'),
    'the pre-review pass was green, so it bought no repair round: ' + calls.join(','))
  assert.ok(calls.includes('fix:T1:1'),
    'round 1 was FIX_REQUIRED although the reviewer answered PASS: ' + calls.join(','))
  assert.equal(row.proofFixes, 0)

  const fixPrompt = prompts['fix:T1:1']
  assert.ok(fixPrompt.includes(EXAM_CMD),
    'the round-1 blocking issue names the exam command: ' + fixPrompt.slice(-600))
  assert.ok(fixPrompt.includes('exit 1'),
    'and its exit code: ' + fixPrompt.slice(-600))

  // [M1] one execution per round, numbered by round: 0, then 1, then 2.
  assert.deepEqual(events.map((e) => e.iter), [0, 1, 2],
    'the pre-review pass and one fresh execution per review round')
  assert.deepEqual(events.map((e) => e.exit), [0, 1, 0],
    'green before review, red in round 1, green again in round 2')
  assert.equal(examEvidenceOf(prompts['review:T1:2']).includes('exit 0'), true,
    'round 2 reads the repaired execution')
  assert.equal(row.status, 'done')
  assert.equal(row.reviewVerdict, 'fixed')
  assert.equal(row.fixIterations, 1)
}

// ── leg (d): the reviewer role's paragraph [M4] ─────────────────────────────
{
  const text = fs.readFileSync(REVIEWER_MD, 'utf8')
  const paras = text.split(/\n[ \t]*\n/)
    .map((p) => p.replace(/[ \t]*\n[ \t]*/g, ' ').trim())   // wraps joined
    .filter(Boolean)
  const withExam = paras.filter((p) => p.includes('EXAM EVIDENCE'))
  assert.equal(withExam.length, 1,
    'reviewer.md carries exactly one paragraph about EXAM EVIDENCE, not none and ' +
    'not a rule split across several: ' + withExam.length)
  const para = withExam[0]

  // The four phrases M4 names, in the order M4 names them: what the block IS,
  // where it ran, what an `exit 0` settles, and whose a non-zero one is.
  const iExam = para.indexOf('EXAM EVIDENCE')
  const iClone = para.indexOf('this task\'s clone', iExam)
  assert.ok(iClone > iExam,
    'the paragraph says the driver ran the exam in this task\'s clone: ' + para)
  const iExit = para.indexOf('exit 0', iClone)
  assert.ok(iExit > iClone, 'then names the settled case, `exit 0`: ' + para)
  const iNotAFinding = para.indexOf('not a finding', iExit)
  assert.ok(iNotAFinding > iExit,
    'then says asking for its re-execution is not a finding: ' + para)
  assert.ok(para.indexOf('fix loop', iNotAFinding) > iNotAFinding,
    'and that a non-zero one is the fix loop\'s: ' + para)

  // Context: the paragraph sits with the other evidence paragraphs, after the
  // `RUN EVIDENCE, when present, …` one and before the `CHECK EVIDENCE` one.
  const idxOf = (needle) => paras.findIndex((p) => p.startsWith(needle))
  assert.ok(idxOf('RUN EVIDENCE') !== -1 && idxOf('CHECK EVIDENCE') !== -1,
    'the RUN and CHECK EVIDENCE paragraphs are still there')
  const iPara = paras.indexOf(para)
  assert.ok(iPara > idxOf('RUN EVIDENCE') && iPara < idxOf('CHECK EVIDENCE'),
    'the EXAM EVIDENCE paragraph sits between them')

  // The prose names the block the way the RUN EVIDENCE paragraph names its own:
  // `EXAM EVIDENCE,` and never `EXAM EVIDENCE:`. The colon form is the driver's
  // block header, and M2's "no EXAM EVIDENCE text" for an exam-less task is only
  // checkable while the role text and the block stay distinguishable.
  assert.ok(!text.includes('EXAM EVIDENCE:'),
    'reviewer.md names the block without the colon that marks the driver\'s header')

  // Global constraint: no shouted imperative is added to this role file. The
  // three words are assembled from pieces so this file itself carries none of
  // them as whole words — the fix-edit sim's leg (g) walks every file the tree
  // changed since BASE, this one included, and a literal here would read as the
  // tree gaining shouting.
  const SHOUT = ['MU' + 'ST', 'NEV' + 'ER', 'ALW' + 'AYS']
  assert.ok(!new RegExp('\\b(' + SHOUT.join('|') + ')\\b').test(text),
    'reviewer.md keeps its register — no all-caps ' + SHOUT.join(', '))
}

// ── leg (e): the wave-0 exam verdict and the recorded-edit rule stand [M5] ──
for (const name of ['test_run_engine_examiner.mjs', 'test_run_engine_exam_edits.mjs']) {
  const out = execFileSync(process.execPath, [path.join(TESTS_DIR, name)],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  assert.ok(out.includes('ALL TESTS PASSED'),
    name + ' still passes unchanged: ' + out.slice(-400))
}

// ── leg (f) ─────────────────────────────────────────────────────────────────
console.log('ALL TESTS PASSED')
