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
//
// A SECOND task's clauses were added below on 2026-09-17 — "implementers run
// their own task's proofs, and the driver counts who ran the whole suite
// anyway", whose own M1–M5 and legs (a)–(h) are restated at the section marker
// `── Task 3 (2026-09-17) ──` further down. Everything above that marker is
// this file as it stood at that task's BASE, unchanged: its leg (a) is the
// `TEST COMMAND` half of S4 below, which is why S4 is left where it is.
//
// A THIRD task's clauses were added on 2026-09-17 under the next marker down,
// `── Task 1 (2026-09-17, #1100) ──` — "the engine reads each task's body from
// the launch file once and hands it inline to every worker" — whose own M1–M5
// and legs (a)–(e) are restated there. Everything above THAT marker is this
// file as it stood at that task's BASE, unchanged.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { rig, makeRepo, passReview, doneImpl } from './_engine_helpers.mjs'
// A namespace import, not a named one: at a BASE where the engine exports no
// `bareSuiteRunCount` a named import is a link-time SyntaxError before a line
// of this file runs, and the first thing a reader should see is the assertion
// that says which export is missing.
import * as engine from '../run-engine.mjs'

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

// ═══ Task 3 (2026-09-17) ═════════════════════════════════════════════════════
// "Implementers run their own task's proofs, and the driver counts who ran the
// whole suite anyway." Claim: both briefs say to run the task's own proofs and
// never the project's whole suite because the fold runs it once per merge, and
// the record carries, for every task an implementer worked, one row counting
// how many times its workers ran the bare suite anyway — a reading, not a
// block.
//
// The clauses this section carries, and the legs that carry them:
//
//   M1 — `fleet/roles/implementer.md` carries, ABOVE `## The issue`, one
//        sentence saying the worker runs the commands the `PROOFS:` block
//        lists and never the project's whole suite — a bare `bun test`, `bun
//        run test` or `python3 -m pytest` with no path — because the fold runs
//        the suite once per merge; the file does not contain the string `TEST
//        COMMAND`. Leg (a) — whose second half is the existing S4 above.
//   M2 — `fleet/roles/fix.md` carries the same sentence, above its `## The
//        issue`, and does not contain `TEST COMMAND`. Leg (b) — same split.
//   M3 — `bareSuiteRunCount(sliceJsonl)`, exported from `fleet/run-engine.mjs`,
//        counts the `tool_use` blocks of the slice's `assistant` records whose
//        `name` is `Bash` and whose `input.command`, split on `&&`, `||`, `;`
//        and `|` with each segment trimmed, has at least one segment that is
//        exactly `bun test`, `bun run test`, `npm test`, `pnpm test`, `pytest`
//        or `python3 -m pytest`, or one of those followed only by tokens
//        beginning `-`; a segment followed by any token not beginning `-` is
//        not counted; a line that is not JSON, or a record with no such block,
//        counts nothing. Legs (c) and (d).
//   M4 — once per task, after the implementer returned and after the
//        pre-review fix round when the pass bought one, and BEFORE any
//        reviewer is dispatched, the driver reads `<runDir>/events.jsonl` for
//        `transcript:slice` rows labelled `impl:<id>` or `fix:<id>:…`, sums
//        `bareSuiteRunCount` over `<runDir>/transcripts/<sessionId>.jsonl` for
//        each such row whose file exists, and appends exactly one
//        `driver:suite-runs {task, count, slices}` — both `0` when no row or
//        file exists — and nothing about the row changes the task's status,
//        its review, or the run's verdict. Legs (e), (f), (g).
//   M5 — `fleet/CONTRACT.md` names `driver:suite-runs {task, count, slices}`
//        in the paragraph that names `driver:amendment`, as a reported sensor
//        that gates nothing, with the M3 definition and the M4 sites. Leg (h).
//
// Three readings, recorded here and on the kata issue:
//
//   Leg (e)'s "position before the run's first `review:T1:1` dispatch". The
//   labels list and `events.jsonl` are two different records, so "before" is
//   asserted where the two meet: the `review:T1:1` stub snapshots the event log
//   AT THE MOMENT IT IS DISPATCHED, and the row must already be in that
//   snapshot. That is M4's "before any reviewer is dispatched" exactly, and it
//   cannot be satisfied by a row appended after the review round returns.
//
//   Leg (e)'s "the task's report row is `merged`". The engine's report rows
//   carry no literal `merged` status; a task the run merged is `status: 'done'`
//   with a clean review verdict and counted in `coverage.tasks_merged`, which
//   is what the sim's existing scenarios leave. All three are asserted, so the
//   sensor is pinned as a reading that gates nothing.
//
//   Legs (a), (b) and (h) restate the Proof's own `Run:` lines. Those commands
//   execute in the driver's clone; what these blocks pin is the same fact in
//   the same words — the sed/grep window and the pattern, transliterated — so
//   the sim says what the commands say.
const CONTRACT_SRC = fileURLToPath(new URL('../CONTRACT.md', import.meta.url))

// One `assistant` record of the reduced shape `sliceTranscript` writes: `type`,
// `sessionId` and `message.content` as blocks, a `tool_use` block keeping
// `name` and an `input` whose `command` is the string the count reads.
const recordOf = (cmds, { name = 'Bash', sessionId = 'sess-x' } = {}) =>
  JSON.stringify({
    type: 'assistant',
    sessionId,
    message: {
      role: 'assistant',
      content: cmds.map((command, i) => ({
        type: 'tool_use', id: 't' + (i + 1), name, input: { command },
      })),
    },
  }) + '\n'
// The same commands as one record each, which is what a real slice looks like.
const perRecordSlice = (cmds, opts) => cmds.map((c) => recordOf([c], opts)).join('')

// ── S6: leg (c) [M3] ─────────────────────────────────────────────────────────
// The counter, over one assistant record carrying thirteen Bash commands in
// the Proof's order: ten of them are bare suite runs.
{
  assert.equal(typeof engine.bareSuiteRunCount, 'function',
    'fleet/run-engine.mjs exports `bareSuiteRunCount(sliceJsonl) -> number` — the counter M3 ' +
    'defines and the Produces interface names')

  // The Proof's thirteen, in the Proof's order. The comment on each says which
  // sentence of M3 decides it.
  const CMDS = [
    'bun test',                             // counted — exactly a named runner
    'bun run test',                         // counted — exactly a named runner
    'bun test tests/state-exams/a.test.ts', // not — a token not beginning `-` follows
    'python3 -m pytest -q',                 // counted — only `-` tokens follow
    'python3 -m pytest tests/test_a.py',    // not — a path follows
    'bunx tsc --noEmit && bun test',        // counted — the `&&` segment is bare
    'pytest',                               // counted — exactly a named runner
    'npm test -- --watch',                  // counted — only `-` tokens follow
    'pnpm test',                            // counted — exactly a named runner
    'cd app; bun test',                     // counted — the `;` segment is bare
    'bun test || true',                     // counted — the `||` segment is bare
    'echo start | pytest',                  // counted — the `|` segment is bare
    'ls',                                   // not — no named runner at all
  ]
  assert.equal(engine.bareSuiteRunCount(recordOf(CMDS)), 10,
    'bareSuiteRunCount over one assistant record carrying those thirteen Bash commands is ' +
    'exactly 10 — one for each of the `&&`, `;`, `||` and `|` separators and one per named ' +
    'runner; the three with a path or no runner count nothing')
}

// ── S7: leg (d) [M3] ─────────────────────────────────────────────────────────
// The four slices that count nothing.
{
  const PATHED = ['bun test tests/x.test.ts', 'bun test 2>&1', 'pytest tests', 'cat bun.lock']
  assert.equal(engine.bareSuiteRunCount(recordOf(PATHED)), 0,
    'a slice whose Bash commands each carry a token that does not begin `-` — ' +
    JSON.stringify(PATHED) + ' — counts 0: none of them is the project\'s whole suite')

  const READ_ONLY = JSON.stringify({
    type: 'assistant',
    sessionId: 'sess-read',
    message: {
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'r1', name: 'Read', input: { file_path: 'a.txt' } }],
    },
  }) + '\n'
  assert.equal(engine.bareSuiteRunCount(READ_ONLY), 0,
    'a slice whose only tool_use block is a `Read` counts 0 — a record with no Bash block ' +
    'counts nothing')

  assert.equal(engine.bareSuiteRunCount(''), 0,
    'the empty string counts 0 — an absent or empty slice is no runs, never a throw')

  const NOT_JSON = '{"type":"assistant","message":{"content":[{"type":"tool_u\n'
  assert.equal(engine.bareSuiteRunCount(NOT_JSON), 0,
    'a line that is not JSON counts 0 — a truncated record is skipped, never a throw')
}

// ── the record legs (e), (f) and (g) read ────────────────────────────────────
// The `readEvents` shape of test_run_engine_amendments.mjs: the run's own
// `events.jsonl`, a row per line, unparseable lines dropped. An absent file
// reads as no rows, so a run that appended nothing fails the count assertion
// rather than throwing ENOENT.
const readEvents = (runDir) => {
  const file = path.join(runDir, 'events.jsonl')
  if (!fs.existsSync(file)) return []
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l) } catch { return null } })
    .filter(Boolean)
}
const suiteRunsOf = (log, id) => log.filter((e) => e.kind === 'driver:suite-runs' && e.task === id)
// The row projected onto the three fields the contract names, so the assertion
// reads the FIELD NAMES M4 spells and nothing the engine hangs beside them.
const rowOf = (e) => ({ task: e.task, count: e.count, slices: e.slices })
// What a worker leaves behind: the reduced slice at `<runDir>/transcripts/
// <sessionId>.jsonl` and the `transcript:slice` row run-main's event log
// appends for it. In a sim the stubbed agent is wrapped by `withPatchCapture`,
// not by the run worker, so nothing exists unless the stub plants it.
const plantSlice = (runDir, { label, sessionId, cmds }) => {
  fs.mkdirSync(runDir, { recursive: true })
  if (cmds) {
    fs.mkdirSync(path.join(runDir, 'transcripts'), { recursive: true })
    fs.writeFileSync(path.join(runDir, 'transcripts', sessionId + '.jsonl'),
      perRecordSlice(cmds, { sessionId }))
  }
  fs.appendFileSync(path.join(runDir, 'events.jsonl'),
    JSON.stringify({ kind: 'transcript:slice', label, sessionId, bytes: 1 }) + '\n')
}

// ── S8: leg (e) [M4] ─────────────────────────────────────────────────────────
// One run, one task, the S1 shape: two Proof `Run:` lines, the second red on
// the driver's pass and green once the repair round has written its file, so
// this single run records `impl:T1`, `fix:T1:0` and `review:T1:1`. The
// implementer's slice carries two bare runs, the fix round's one — 3 over 2
// slice files, on one row, before the reviewer, and the task merges anyway.
{
  const repo = makeRepo(path.join(tmp, 'repo-suite-runs'))
  const runDir = path.join(tmp, 'run-suite-runs')
  const labels = []
  // The event log as it stood when the FIRST reviewer was dispatched.
  let atFirstReview = null
  const stub = (prompt, opts, cwd) => {
    labels.push(opts.label)
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') {
      fs.writeFileSync(path.join(cwd, 'one.txt'), 'from T1\n')
      plantSlice(runDir, {
        label: 'impl:T1', sessionId: 'sess-impl', cmds: ['bun test', 'python3 -m pytest -q'],
      })
      return doneImpl(cwd)
    }
    if (kind === 'fix') {
      fs.writeFileSync(path.join(cwd, 'fixed.txt'), 'repaired\n')
      plantSlice(runDir, { label: 'fix:T1:0', sessionId: 'sess-fix', cmds: ['pnpm test'] })
      return doneImpl(cwd)
    }
    if (kind === 'review') {
      if (atFirstReview === null) atFirstReview = readEvents(runDir)
      return passReview()
    }
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run } = rig({
    repo, runDir, stub, stamp: 'op4',
    waves: [[mkTask('T1', ['one.txt', 'fixed.txt'], {
      proofRuns: ['test -f one.txt', 'test -f fixed.txt'],
    })]],
  })
  const report = await run()
  const row = report.tasks.find((r) => r.task === 'T1')

  assert.deepEqual(labels, ['impl:T1', 'fix:T1:0', 'review:T1:1'],
    'sim precondition: the implementer, the pre-review fix round and one reviewer, in that ' +
    'order — ' + JSON.stringify(labels))

  const rows = suiteRunsOf(readEvents(runDir), 'T1')
  assert.equal(rows.length, 1,
    'the run\'s record carries exactly ONE `driver:suite-runs` row for T1 — once per task, ' +
    'after the implementer and after the fix round the pass bought: ' + JSON.stringify(rows))
  assert.deepEqual(rowOf(rows[0]), { task: 'T1', count: 3, slices: 2 },
    'and it counts both workers\' slices: `slices` 2 (the `impl:T1` and `fix:T1:0` rows whose ' +
    'file exists) and `count` 3 (two bare runs in the implementer\'s slice, one in the fix ' +
    'round\'s): ' + JSON.stringify(rowOf(rows[0])))

  // Before any reviewer is dispatched — read at the reviewer's own dispatch.
  assert.notEqual(atFirstReview, null,
    'sim precondition: a reviewer was dispatched and snapshotted the record')
  const atReview = suiteRunsOf(atFirstReview, 'T1')
  assert.equal(atReview.length, 1,
    'the row was already in `events.jsonl` when `review:T1:1` was dispatched — the driver ' +
    'counts before it hands the patch to a reviewer, never after: ' + JSON.stringify(atReview))
  assert.deepEqual(rowOf(atReview[0]), { task: 'T1', count: 3, slices: 2 },
    'and it was already the finished count, not a placeholder the driver amended later: ' +
    JSON.stringify(rowOf(atReview[0])))

  // A reading, not a block: the task ends exactly as the sim's existing
  // scenarios end — merged.
  assert.equal(row.status, 'done',
    'and nothing about the row changes the task\'s status: it is `done` — merged — exactly as ' +
    'the same scenario without a slice is: ' + JSON.stringify(row))
  assert.equal(row.reviewVerdict, 'clean',
    'nor its review: the canned PASS still reads `clean`: ' + JSON.stringify(row))
  assert.equal(report.coverage.tasks_merged, 1,
    'nor the run\'s verdict: the one task merged: ' + JSON.stringify(report.coverage))
}

// ── S9: leg (f) [M4] ─────────────────────────────────────────────────────────
// A run whose stubs plant no slice at all. The row is still written, and both
// its numbers are 0 — the sensor reports "nobody ran the suite", which is a
// different record from no record.
{
  const repo = makeRepo(path.join(tmp, 'repo-no-slice'))
  const runDir = path.join(tmp, 'run-no-slice')
  const labels = []
  const stub = (prompt, opts, cwd) => {
    labels.push(opts.label)
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') {
      fs.writeFileSync(path.join(cwd, 'one.txt'), 'from T1\n')
      return doneImpl(cwd)
    }
    if (kind === 'review') return passReview()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run } = rig({
    repo, runDir, stub, stamp: 'op5',
    waves: [[mkTask('T1', ['one.txt'])]],
  })
  const report = await run()

  assert.deepEqual(labels.filter((l) => l === 'impl:T1'), ['impl:T1'],
    'sim precondition: one implementer was dispatched — ' + JSON.stringify(labels))
  const rows = suiteRunsOf(readEvents(runDir), 'T1')
  assert.equal(rows.length, 1,
    'a run whose workers left no slice still carries exactly one `driver:suite-runs` row for ' +
    'T1: ' + JSON.stringify(rows))
  assert.deepEqual(rowOf(rows[0]), { task: 'T1', count: 0, slices: 0 },
    'with `count` 0 and `slices` 0 — no `transcript:slice` row to read: ' +
    JSON.stringify(rowOf(rows[0])))
  assert.equal(report.tasks.find((r) => r.task === 'T1').status, 'done',
    'and the task merges as before')
}

// ── S10: leg (g) [M4] ────────────────────────────────────────────────────────
// A `transcript:slice` row naming a `sessionId` with no file under
// `transcripts/`: the row is read, the file is not there, and the sensor says
// so — `slices` counts files READ, not rows seen.
{
  const repo = makeRepo(path.join(tmp, 'repo-missing-slice'))
  const runDir = path.join(tmp, 'run-missing-slice')
  const labels = []
  const stub = (prompt, opts, cwd) => {
    labels.push(opts.label)
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') {
      fs.writeFileSync(path.join(cwd, 'one.txt'), 'from T1\n')
      // The row, and deliberately no file for it.
      plantSlice(runDir, { label: 'impl:T1', sessionId: 'sess-gone', cmds: null })
      return doneImpl(cwd)
    }
    if (kind === 'review') return passReview()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run } = rig({
    repo, runDir, stub, stamp: 'op6',
    waves: [[mkTask('T1', ['one.txt'])]],
  })
  const report = await run()

  assert.deepEqual(labels.filter((l) => l === 'impl:T1'), ['impl:T1'],
    'sim precondition: one implementer was dispatched — ' + JSON.stringify(labels))
  assert.equal(fs.existsSync(path.join(runDir, 'transcripts', 'sess-gone.jsonl')), false,
    'sim precondition: the slice the row names was never written')
  const rows = suiteRunsOf(readEvents(runDir), 'T1')
  assert.equal(rows.length, 1,
    'a slice row whose file is missing still leaves exactly one `driver:suite-runs` row: ' +
    JSON.stringify(rows))
  assert.deepEqual(rowOf(rows[0]), { task: 'T1', count: 0, slices: 0 },
    'with `slices` 0 — the number of slice FILES read — and `count` 0: an absent file is ' +
    'skipped, never a throw and never a row the run lost: ' + JSON.stringify(rowOf(rows[0])))
  assert.equal(report.tasks.find((r) => r.task === 'T1').status, 'done',
    'and the task merges as before')
}

// ── S11: legs (a) and (b), first halves [M1, M2] ─────────────────────────────
// The sentence each brief gains, above `## The issue`, in the words M1 spells:
// the worker runs the `PROOFS:` block's commands and NEVER the project's WHOLE
// SUITE — a bare `bun test`, `bun run test` or `python3 -m pytest` with no path
// — because the FOLD RUNS THE SUITE once per merge. The Proof's first two
// `Run:` lines read the region through the first `## The issue` line, join it
// to one line and grep `never.*whole suite.*fold runs the suite`; this reads
// the same region the same way. (The `TEST COMMAND` half of both legs is S4
// above, which is the leg this file already carried.)
{
  const SENTENCE = /never.*whole suite.*fold runs the suite/
  for (const name of ['implementer.md', 'fix.md']) {
    const lines = fs.readFileSync(path.join(ROLES_DIR, name), 'utf8').split('\n')
    const end = lines.findIndex((l) => l.startsWith('## The issue'))
    assert.ok(end > 0, 'fleet/roles/' + name + ' still has its `## The issue` heading')
    // `sed -n '1,/^## The issue/p' | tr '\n' ' '` — through the heading line.
    const head = lines.slice(0, end + 1).join(' ')
    assert.match(head, SENTENCE,
      'fleet/roles/' + name + ' says, ABOVE `## The issue`, that the worker runs the commands ' +
      'the `PROOFS:` block lists and `never` the project\'s `whole suite` because the `fold ' +
      'runs the suite` once per merge — the three operative phrases in that order, which is ' +
      'what the Proof\'s `Run:` line greps for')
    for (const cmd of ['bun test', 'bun run test', 'python3 -m pytest']) {
      assert.ok(head.includes(cmd),
        'and it spells the bare command it forbids — `' + cmd + '` with no path — in that same ' +
        'region of fleet/roles/' + name + ', which is how the sentence names the suite without ' +
        'naming `TEST COMMAND`')
    }
  }
}

// ── S12: leg (h) [M5] ────────────────────────────────────────────────────────
// The contract names the new kind where the other reported-sensor kind is
// named. The Proof's two `Run:` lines are `grep -q 'driver:suite-runs'` over
// the file and `grep -A12 'driver:amendment. .{task, amends' | tr '\n' ' ' |
// grep -q 'driver:suite-runs.*task.*count.*slices.*gates nothing'`; both are
// transliterated here.
{
  const contract = fs.readFileSync(CONTRACT_SRC, 'utf8')
  assert.ok(contract.includes('driver:suite-runs'),
    'fleet/CONTRACT.md names `driver:suite-runs` — every new event kind the engine appends is ' +
    'named in the contract by the task that adds it')

  const lines = contract.split('\n')
  const ANCHOR = /driver:amendment. .\{task, amends/
  const hits = lines.map((l, i) => (ANCHOR.test(l) ? i : -1)).filter((i) => i >= 0)
  assert.ok(hits.length > 0,
    'sim precondition: the contract still carries the `driver:amendment` `{task, amends, what, ' +
    'why}` line the new kind is named beside')
  // `grep -A12`: each matching line and the twelve after it, joined to one line.
  const window = hits.map((i) => lines.slice(i, i + 13).join(' ')).join(' ')
  assert.match(window, /driver:suite-runs.*task.*count.*slices.*gates nothing/,
    'and within twelve lines of it names `driver:suite-runs` with its `task`, `count` and ' +
    '`slices` fields and says it `gates nothing` — a reported sensor in the paragraph that ' +
    'already holds one')
}

// ═══ Task 1 (2026-09-17, #1100) ═══════════════════════════════════════════════
// "The engine reads each task's body from the launch file once and hands it
// inline to every worker." Claim: do: launch a plan whose task bodies ride the
// launch file, as every launch does; see: each of a task's four workers — its
// implementer, its examiner, its fix round and, first among them, its reviewer
// — is handed `TASK:` followed by the task's own text, and none of those four
// is told to go and read that text out of a JSON file; the resolver's brief
// over a conflicted wave is not one of the four and still names the file
// exactly as it did.
//
// The clauses this section carries, and the legs that carry them:
//
//   M1 — for a task whose `args.waves` entry carries no `body` and whose text
//        lives under `tasks[].body` in the JSON file at `args.wavesPath`, each
//        of the four prompts the engine dispatches for that task — labels
//        `impl:<id>`, `exam:<id>`, `fix:<id>:0` and `review:<id>:1` — contains
//        the string `\nTASK:\n` immediately followed by that task's `body`
//        string from the file, byte for byte. Leg (a).
//   M2 — no prompt the engine dispatches contains the phrase `read your
//        verbatim task text from the JSON file`, and `fleet/run-engine.mjs`
//        contains no line carrying the phrase `read your verbatim task text`.
//        Leg (b).
//   M3 — a task whose `body` is inline in its `args.waves` entry, with no
//        `args.wavesPath` given, is dispatched with the same `\nTASK:\n`
//        followed by that body in its implementer and reviewer prompts. Leg (c).
//   M4 — when `args.wavesPath` names a file whose `tasks` array carries no
//        entry for a task and that task's `args.waves` entry carries no `body`,
//        `runEngine` rejects before any worker is dispatched, with an error
//        message naming the task id and the path. Leg (d).
//   M5 — `waveContendingBlock({ waveTasks, wavesPath, receipts })` renders
//        exactly as at BASE: the resolver brief sim prints `ALL TESTS PASSED`
//        on the patched tree. Leg (e).
//
// Four readings, recorded here and on the kata issue:
//
//   Leg (a)'s "byte for byte". Asserted as `prompt.includes('\nTASK:\n' +
//   LAUNCH_BODY)` — the clause's own words, a substring of the prompt with the
//   separator immediately before it — one label at a time, so a failure names
//   WHICH of the four workers was still handed a pointer. `LAUNCH_BODY` ends in
//   a newline and the launch file carries a DECOY entry ahead of the task's
//   own, so neither a trimmed body nor a `tasks[0]` read can satisfy it: M1
//   says the body string from the file, for that task's id.
//
//   Leg (b)'s two halves. The per-prompt half reads the full phrase `read your
//   verbatim task text from the JSON file` on every prompt of BOTH runs — S13's
//   four and S14's — because M2 says NO prompt the engine dispatches carries
//   it, not just the four of the body-less run. The source half transliterates
//   the Proof's first `Run:` (`test "$(grep -c 'read your verbatim task text'
//   fleet/run-engine.mjs)" = 0`) as: zero LINES of `fleet/run-engine.mjs`
//   contain the shorter phrase — `grep -c` counts lines, and a comment line
//   that quotes the phrase is as much a hit as the code that renders it.
//
//   Leg (d)'s "the stub recorded no label at all". M4 says the rejection comes
//   BEFORE any worker is dispatched, so S15's stub does NOT throw on an
//   unexpected dispatch: it records its label and returns the benign reply its
//   kind would. At BASE, where nothing rejects, the failure is then
//   `assert.rejects` finding no rejection — not a stub error whose own text
//   happens to contain `T3` and would read as a spurious pass.
//
//   Leg (e). The Proof's second `Run:` executes `test_resolver_brief.mjs` in
//   the driver's own clone; an exam neither runs a sibling sim nor names one,
//   so this block pins the one half that is its own to check:
//   `waveContendingBlock` is PURE and exported, so its BASE render is asserted
//   here by equality against the literal string — the `wavesPath` sentence
//   included, which is the thing M5 protects. Whether the sim that `Run:` line
//   invokes is present and green is that command's own answer, given in the
//   driver's clone; a sim of this tree may not name a sibling sim even to check
//   that it exists (`test_sims_are_hermetic.mjs`, leg (e) [M4]).
const PHRASE = 'read your verbatim task text from the JSON file'
const PHRASE_SHORT = 'read your verbatim task text'
// The task text as the compiler's `--emit-launch` file carries it: multi-line,
// with the backticks and quotes a real body has, and a trailing newline.
const LAUNCH_BODY = '### Task T1: the body rides the prompt\n' +
  '\n' +
  '**Claim:** do: launch a plan whose task bodies ride the launch file; see: the worker is ' +
  'handed the text.\n' +
  'Machine: M1. The tree holds `one.txt`.\n' +
  '\n' +
  '**Proof:**\n' +
  '- Legs: (a) `one.txt` exists [M1]\n'
// A different body, under a different id, sitting FIRST in the `tasks` array.
const DECOY_BODY = '### Task T0: not this one\nMachine: M1. The tree holds `zero.txt`.\n'
const launchFileAt = (file, tasks) => {
  fs.writeFileSync(file, JSON.stringify({ tasks }, null, 2))
  return file
}

// ── S13: legs (a) and (b) [M1, M2] ───────────────────────────────────────────
// The S1 shape, with the body moved OFF the wave entry and into a launch file:
// one task with `proofTests`, a `testCmd` and two `proofRuns` of which the
// second is red on the implementer's tree and green once the fix round has
// written its file, so this single run records all four of `impl:T1`,
// `exam:T1`, `fix:T1:0` and `review:T1:1`. `extraArgs` is how `wavesPath`
// reaches `runEngine`.
{
  const repo = makeRepo(path.join(tmp, 'repo-launch-body'))
  const runDir = path.join(tmp, 'run-launch-body')
  const LAUNCH = launchFileAt(path.join(tmp, 'launch-body.json'), [
    { id: 'T0', title: 'decoy', files: ['zero.txt'], body: DECOY_BODY },
    { id: 'T1', title: 't1', files: ['one.txt', 'fixed.txt'], body: LAUNCH_BODY },
  ])
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
    if (kind === 'fix') {
      fs.writeFileSync(path.join(cwd, 'fixed.txt'), 'repaired\n')
      return doneImpl(cwd)
    }
    if (kind === 'review') return passReview()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run } = rig({
    repo, runDir, stub, stamp: 'op7',
    // `body: undefined` — the wave entry the compiler's `--emit-args` payload
    // actually carries: LIGHT, with the text only in the launch file.
    waves: [[mkTask('T1', ['one.txt', 'fixed.txt'], {
      body: undefined, proofTests: ['t1_test.sh'], testCmd: EXAM_CMD,
      proofRuns: ['test -f one.txt', 'test -f fixed.txt'],
    })]],
    extraArgs: { wavesPath: LAUNCH },
  })
  await run()

  // [M1] leg (a): the four labels are all recorded ...
  const FOUR = ['impl:T1', 'exam:T1', 'fix:T1:0', 'review:T1:1']
  for (const label of FOUR) {
    assert.deepEqual(labels.filter((l) => l === label), [label],
      'sim precondition: the run dispatched exactly one `' + label + '` — the task\'s four ' +
      'workers are its implementer, its examiner, its fix round and its reviewer: ' +
      JSON.stringify(labels))
  }

  // ... and each of the four prompts carries `\nTASK:\n` immediately followed
  // by the task's `body` string FROM THE LAUNCH FILE, byte for byte. Asserted
  // one label at a time, so the failure names the worker still handed a pointer.
  for (const label of FOUR) {
    assert.ok(prompts[label].includes('\nTASK:\n' + LAUNCH_BODY),
      'the `' + label + '` prompt contains `\\nTASK:\\n` immediately followed by T1\'s `body` ' +
      'from the JSON file at `args.wavesPath`, byte for byte — the engine read that file once ' +
      'and handed the text inline, and this worker is not told to go and read it')
  }

  // [M2] leg (b): none of the four is told to go and read the file.
  for (const label of FOUR) {
    assert.equal(prompts[label].includes(PHRASE), false,
      'and the `' + label + '` prompt does not contain `' + PHRASE + '` — no prompt the engine ' +
      'dispatches carries the pointer sentence, by any path')
  }
}

// ── S14: leg (c) [M3], and leg (b) over an inline-body run ───────────────────
// The shape every engine sim at BASE already drives: `body` inline on the wave
// entry and no `wavesPath` at all. Nothing about this run changes — which is
// the point of M3 — and its prompts are read for the pointer phrase too,
// because M2 says NO prompt the engine dispatches carries it.
{
  const repo = makeRepo(path.join(tmp, 'repo-inline-body'))
  const runDir = path.join(tmp, 'run-inline-body')
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
    repo, runDir, stub, stamp: 'op8',
    // `mkTask`'s default `body` is the module's inline `BODY`; no `extraArgs`,
    // so `args.wavesPath` is absent.
    waves: [[mkTask('T2', ['two.txt'])]],
  })
  await run()

  for (const label of ['impl:T2', 'review:T2:1']) {
    assert.deepEqual(labels.filter((l) => l === label), [label],
      'sim precondition: the run dispatched exactly one `' + label + '` — ' +
      JSON.stringify(labels))
    // [M3] leg (c)
    assert.ok(prompts[label].includes('\nTASK:\n' + BODY),
      'the `' + label + '` prompt of a task whose `body` is inline in its `args.waves` entry, ' +
      'with no `args.wavesPath` given, still contains `\\nTASK:\\n` followed by that body — the ' +
      'shape every engine sim at BASE already drives is unchanged')
  }
  // [M2] leg (b), over this run's prompts as well.
  for (const label of Object.keys(prompts)) {
    assert.equal(prompts[label].includes(PHRASE), false,
      'and the `' + label + '` prompt of the inline-body run does not contain `' + PHRASE +
      '` either — no prompt the engine dispatches carries it')
  }
}

// ── S15: leg (d) [M4] ────────────────────────────────────────────────────────
// A launch file whose `tasks` array holds only an entry for `T9`, while the
// wave's body-less task is `T3`: the body is nowhere, which is malformed
// input, and `runEngine` is async so the refusal is a REJECTION. The stub
// records its label and returns the benign reply its kind would rather than
// throwing, so at a tree where nothing rejects the failure reads as
// `assert.rejects` finding no rejection rather than as a stub error.
{
  const repo = makeRepo(path.join(tmp, 'repo-no-body'))
  const runDir = path.join(tmp, 'run-no-body')
  const LAUNCH = launchFileAt(path.join(tmp, 'launch-no-body.json'), [
    { id: 'T9', title: 'someone else', files: ['nine.txt'], body: DECOY_BODY },
  ])
  const labels = []
  const stub = (prompt, opts, cwd) => {
    labels.push(opts.label)
    const kind = opts.label.split(':')[0]
    if (kind === 'impl' || kind === 'fix') {
      fs.writeFileSync(path.join(cwd, 'three.txt'), 'from T3\n')
      return doneImpl(cwd)
    }
    if (kind === 'review') return passReview()
    return { status: 'DONE', summary: 'sim stub' }
  }
  const { run } = rig({
    repo, runDir, stub, stamp: 'op9',
    waves: [[mkTask('T3', ['three.txt'], { body: undefined })]],
    extraArgs: { wavesPath: LAUNCH },
  })

  await assert.rejects(run, (err) => {
    assert.ok(err instanceof Error,
      'the refusal is a thrown Error, not a resolved report: ' + JSON.stringify(err))
    assert.ok(err.message.includes('T3'),
      'and its message names the task whose body is nowhere — `T3` — so the operator knows ' +
      'which entry of the plan is malformed: ' + err.message)
    assert.ok(err.message.includes(LAUNCH),
      'and it names the launch file it looked in — `' + LAUNCH + '` — so the operator knows ' +
      'where it looked: ' + err.message)
    return true
  }, 'a task whose `args.waves` entry carries no `body` and whose id is not in the `tasks` ' +
     'array of the file at `args.wavesPath` makes `runEngine` reject')

  assert.deepEqual(labels, [],
    'and it rejected BEFORE any worker was dispatched — the stub recorded no label at all: ' +
    JSON.stringify(labels))
}

// ── S16: leg (e) [M5] ────────────────────────────────────────────────────────
// The resolver's brief over a conflicted wave is NOT one of the four workers,
// and it still names the file exactly as it did. `waveContendingBlock` is pure
// and exported, so its BASE render is pinned here by equality — the `wavesPath`
// sentence included, which is the whole of what M5 protects. That equality is
// all this block asserts: the sim the Proof's second `Run:` line invokes is a
// sibling of this one, and a sim of this tree may not name a sibling sim — not
// to run it, and not to check that it exists (`test_sims_are_hermetic.mjs`, leg
// (e) [M4]). That half of leg (e) is the `Run:` line's own answer, given in the
// driver's clone rather than here.
{
  const WAVE_TASKS = [
    { id: 'A', title: 'alpha', files: ['a.txt', 'b.txt'] },
    { id: 'B', title: 'beta', files: [] },
  ]
  const WP = '/tmp/run-op10/launch.json'
  // The BASE string, byte for byte. With `receipts: []` — a run that recorded
  // no failure — `factsBlock` contributes nothing, so this is the whole render.
  const BASE_RENDER = '\nCONTENDING TASKS:' +
    '\n- task A: alpha [files: a.txt, b.txt]' +
    '\n- task B: beta' +
    '\nTheir full verbatim task text lives in the JSON file at ' + WP +
    ' — read the "tasks" array entry whose "id" matches.'
  assert.equal(typeof engine.waveContendingBlock, 'function',
    'sim precondition: `waveContendingBlock` is still exported from fleet/run-engine.mjs')
  const render = engine.waveContendingBlock({
    waveTasks: WAVE_TASKS, wavesPath: WP, receipts: [],
  })
  assert.equal(render({ path: 'a.txt' }), BASE_RENDER,
    '`waveContendingBlock({ waveTasks, wavesPath, receipts })` renders EXACTLY as at BASE — ' +
    'the resolver is not one of the task\'s four workers and is still pointed at the JSON ' +
    'file by name, in the same sentence')
}

// ── S17: leg (b), source half [M2] ───────────────────────────────────────────
// The Proof's first `Run:` transliterated: `grep -c` counts LINES, so a comment
// line in the engine that quotes the phrase is as much a hit as the code that
// renders it — which is why the pointer branch is deleted rather than kept as a
// fallback, and why the engine's comment says what changed without quoting it.
{
  const carriers = fs.readFileSync(ENGINE_SRC, 'utf8').split('\n')
    .filter((l) => l.includes(PHRASE_SHORT))
  assert.deepEqual(carriers, [],
    'fleet/run-engine.mjs contains NO line carrying `' + PHRASE_SHORT + '` — the phrase cannot ' +
    'reach a prompt by any path, in code or in a comment, which is what the Proof\'s first ' +
    '`Run:` line counts: ' + JSON.stringify(carriers))
}

console.log('ALL TESTS PASSED')
