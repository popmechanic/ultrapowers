// fleet/tests/test_factory_engine_select.mjs — exam for "the engine selects —
// the examiner is told what is already proven, and every landing runs the few
// tests its patch touches".
//
// The Machine clauses under test, restated so a reader can map every
// assertion back to the contract:
//
//   M1 — before a task's exam worker is dispatched (policy.select.enabled and
//        a judge answering readCovering): the engine lists the exam clone's
//        tracked files via its own `git ls-files`, calls `candidateTests` with
//        the task's implementation files/symbolsOf(clauses)/proofTests
//        excluded/max_candidates, asks `readCovering` once with each
//        candidate's first 6,000 characters, appends a `select:exam` event,
//        and the exam prompt carries a `COVERED:` block directly after its
//        `TEST COMMAND:` line — one `M<n>: <path>` line per covered clause,
//        no block at all when nothing is covered, and no ask at all with no
//        candidates.
//   M2 — after the best candidate lands: `candidateTests` again, this time
//        over the patch-touched paths and the names `candidatesOf` reads off
//        the patch; `readGuards` once with `hunksCarrying` of the patch; the
//        run set (covering tests, then `selected`, deduplicated, capped at
//        max_run) is run in the candidate's clone with `commandFor`; a
//        `select:landing` event records candidates/selected/ran.
//   M3 — a run-set test red in the candidate's clone is re-run at a
//        once-per-task, lazily cloned base anchor: red there too logs
//        `select:red-at-base` and posts nothing; green there logs `catch` and
//        posts a board comment naming the path, the exit code and the last
//        1,500 characters of the test's output.
//   M4 — a landing with >=1 catch is short and gets exactly one re-dispatch
//        (policy.landing.redispatch.enabled), even with a green exam and
//        coverage above the floor; the run set is read again the same way
//        after it; no task ever gets a third implementer dispatch.
//   M5 — `runEngine` reads its policy from `args.policy` when given, else
//        `POLICY_PATH`; with `select.enabled` false, or a judge answering
//        neither reader, no `select:*`/`catch` event, no `COVERED:` prompt,
//        no `sh` call with `timeout` as its command.
//   M6 — `factory/roles/exam.md` tells the examiner what `COVERED:` means.
//        Proved by the task's own `Run: grep -q 'COVERED:' factory/roles/exam.md`
//        line, not by this file: this exam creates and imports no module of
//        `factory/roles/exam.md`'s own, and a grep over prose is not a claim
//        this file's imports/calls can prove. See the hand-in note.
//
// The Proof's legs, and where each is answered below:
//
//   (a) [M1] the exam-dispatch selection: covered, uncovered, and no
//            candidates at all.
//   (b) [M2] the post-landing selection: readGuards' patch/tests, the run
//            set's order and cap, and the `select:landing` event.
//   (c) [M3] a run-set test red in the candidate's clone: green at the base
//            anchor (`catch`, posted) and red there too (`select:red-at-base`,
//            nothing posted).
//   (d) [M4] a catch alone forces exactly one re-dispatch, still capped at
//            one, even fully green otherwise; the switch off caps it at zero.
//   (e) [M5] the policy switch off, a judge answering neither reader, and the
//            `args.policy` / `POLICY_PATH` fallback.
//
// Everything below drives the real `runEngine` from `factory/engine.mjs` over
// a real git repository (`makeRepo`/`gitSync`/`ENV` from `./_engine_helpers.mjs`,
// exactly as `test_factory_hunks.mjs` already does) and a real `python3` plan
// parse. `worker`, `judge`, `sh` and `board` are fakes; `git` is real, always
// run with `env: ENV` (`simEnv()`, never `process.env`).
//
// Assumptions this exam makes about the code under test, since the task fixes
// the contract but not every internal: `candidatesOf`'s patch-derived names
// plus a task's raw `Produces:` bullet text are what M2's `symbols` draws on
// (already true of `factory/engine.mjs` today, per its own doc comment), so a
// fixture's `Produces: catalog_util` line (a bare word, no backtick) reliably
// seeds a matchable needle without depending on the patch's own diff shape.
// `factory/select.mjs`'s `candidateTests` needle-matching (whole-word for a
// bare symbol) is assumed to work exactly as that module already implements
// it — this exam's fixtures are written so the covering test files are found
// by that existing, already-tested logic, and only the judge's answers are
// canned. Where the Machine clause does not fix an order (M1's/M2's
// `candidates` list), this exam compares the found paths as a set, sorted,
// rather than assuming one tie-break order.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { runEngine } from '../../factory/engine.mjs'
import { makeRepo, ENV, gitSync } from './_engine_helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const REAL_POLICY_PATH = path.join(ROOT, 'factory', 'policy.json')

// ══════════════════════════════════════════════════════════════════════════
// shared fixture plumbing
// ══════════════════════════════════════════════════════════════════════════

/** A minimal claims-v1 task, one or two Machine clauses, one implementation
 *  file and one proof test — the shape `skills/ultrapowers/scripts/plan_parse.py`
 *  (run for real) turns into a single task, single wave. */
function planText (taskId, clauseTexts) {
  const machine = clauseTexts.map((c, i) => `M${i + 1}. ${c}`).join(' ')
  return `### Task ${taskId}: catalog selection fixture

**Type:** implementation

**Files:**
- Create: \`src/catalog.py\`
- Test: \`tests/test_new_catalog.py\`

**Claim:** a dummy claim for this exam only. (derived)
Machine: ${machine}

**Authorized-by:** exam fixture, no real record.

**Interfaces:**
- Consumes: none
- Produces: catalog_util

**Proof:**
- Test: \`tests/test_new_catalog.py\`
`
}

const CLAUSE_1 = 'the patched module exports `catalog_util` for callers.'
const CLAUSE_2 = 'the patched module also exports `helper_util` for callers.'

/** A recording `readerFake`: records every call's argument and answers
 *  `answerFn(arg)`. Used for `readCovering`, `readGuards` and `readLanding`. */
function readerFake (answerFn) {
  const calls = []
  const fn = async (arg) => { calls.push(arg); return answerFn(arg) }
  fn.calls = calls
  return fn
}

/** The board fake: every `post` recorded, everything else the empty value
 *  `makeBoard({})` would answer — never throws, never needs a `kata`. */
function makeFakeBoard () {
  const posts = []
  return {
    posts,
    post: async (taskId, kind, text) => { posts.push({ taskId, kind, text }); return null },
    factsFor: async () => '',
    setState: async () => null,
    states: async () => ({}),
    settled: async () => null,
  }
}

/** Drives one real `runEngine` call over a fresh repo/plan/runDir. `files` is
 *  `makeRepo`'s extra tracked-files map; `sh` is a `({cmd,argv,cwd}) =>
 *  response|undefined` callback for the task's own test command and any
 *  `timeout` run-set command — the fold kernel's two calls are answered here,
 *  once, for every scenario. `usePolicy: false` leaves `args.policy` unset,
 *  to prove the `POLICY_PATH` fallback half of M5. */
async function harness ({
  taskId, clauses, files = {}, worker, judge, sh, policyMutate,
  board = makeFakeBoard(), usePolicy = true,
}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'select-exam-'))
  const repoDir = path.join(tmp, 'repo')
  const runDir = path.join(tmp, 'run')
  const planPath = path.join(tmp, 'plan.md')

  // `makeRepo`'s own `files` map does not mkdir -p a nested path (its own
  // fixtures never nest); every fixture here lives under `tests/`, so the
  // directory is made ahead of it, once, before `makeRepo` writes anything.
  fs.mkdirSync(path.join(repoDir, 'tests'), { recursive: true })
  makeRepo(repoDir, files)
  fs.writeFileSync(planPath, planText(taskId, clauses))
  const baseSha = gitSync(['rev-parse', 'HEAD'], repoDir)

  // Real git, through the sim's own hermetic environment — never
  // `process.env` — exactly like `_engine_helpers.mjs`'s own `gitSync`.
  const git = (argv, cwd) =>
    execFileSync('git', argv, { cwd, env: ENV, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })

  let policyPath
  if (usePolicy) {
    const rawPolicy = JSON.parse(fs.readFileSync(REAL_POLICY_PATH, 'utf8'))
    if (policyMutate) policyMutate(rawPolicy)
    policyPath = path.join(tmp, 'policy.json')
    fs.writeFileSync(policyPath, JSON.stringify(rawPolicy))
  }

  const shCalls = []
  const wrappedSh = (cmd, argv = [], cwd) => {
    shCalls.push({ cmd, argv: [...argv], cwd })
    if (cmd === 'python3' && String(argv[0] || '').endsWith('fold_wave.py')) {
      if (argv[1] === 'fold') return { status: 0, stdout: JSON.stringify({ complete: true }) }
      if (argv[1] === 'materialize') return { status: 0, stdout: JSON.stringify({ candidateSha: baseSha }) }
    }
    if (sh) {
      const custom = sh({ cmd, argv, cwd })
      if (custom !== undefined) return custom
    }
    return { status: 0, stdout: 'ALL TESTS PASSED\n' }
  }

  const args = { plan: planPath, target: repoDir, base: baseSha, runDir }
  if (usePolicy) args.policy = policyPath

  const result = await runEngine(args, { worker, judge, sh: wrappedSh, git, board })

  const events = fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8')
    .split('\n').filter(Boolean).map((l) => JSON.parse(l))

  return { result, events, shCalls, board, runDir, baseSha }
}

const findAll = (events, kind, taskId) => events.filter((e) => e.kind === kind && e.task === taskId)
const findOne = (events, kind, taskId) => findAll(events, kind, taskId)[0]

// ══════════════════════════════════════════════════════════════════════════
// (a) [M1] exam-dispatch selection
// ══════════════════════════════════════════════════════════════════════════

async function legA () {
  const CATALOG_TEXT = 'catalog_util appears here\n' + 'x'.repeat(7000)

  // scenario 1: one candidate found, one clause covered by it.
  {
    const readCovering = readerFake(async () => ({ covered: ['tests/test_catalog.py', null], scores: [[0.9], [0]] }))
    const prompts = []
    const worker = async (opts) => {
      if (opts.role === 'exam') prompts.push(opts.prompt)
      return { result: { total_cost_usd: 0, result: '' }, denials: [] }
    }
    const judge = { readCovering }
    const { result, events } = await harness({
      taskId: 'a1', clauses: [CLAUSE_1, CLAUSE_2],
      files: { 'tests/test_catalog.py': CATALOG_TEXT },
      worker, judge,
    })
    assert.ok(result.adopted.includes('a1'), 'precondition (a): the fixture task must adopt')

    assert.equal(readCovering.calls.length, 1,
      'M1: readCovering is asked exactly once before the exam worker is dispatched')
    const call = readCovering.calls[0]
    assert.equal(call.tests.length, 1,
      'M1: readCovering is handed one test entry, the one candidate `candidateTests` found')
    assert.equal(call.tests[0].path, 'tests/test_catalog.py',
      'M1: the one covering candidate is tests/test_catalog.py, the tracked file matching catalog_util')
    assert.equal(call.tests[0].text, CATALOG_TEXT.slice(0, 6000),
      'M1: each candidate is handed to readCovering as exactly its first 6,000 characters')

    const row = findOne(events, 'select:exam', 'a1')
    assert.ok(row, 'M1: a select:exam event is appended before the exam worker is dispatched')
    assert.deepStrictEqual(row.candidates, ['tests/test_catalog.py'],
      'M1: select:exam\'s candidates is the list of paths candidateTests found')
    assert.deepStrictEqual(row.covered, ['tests/test_catalog.py', null],
      'M1: select:exam\'s covered is readCovering\'s answer verbatim')

    assert.equal(prompts.length, 1, 'precondition (a): the exam worker is dispatched exactly once')
    const testCmd = 'python3 -m pytest -q tests/test_new_catalog.py'
    assert.ok(
      prompts[0].includes('TEST COMMAND: ' + testCmd + '\n\nCOVERED:\nM1: tests/test_catalog.py\n\nINTERFACES:'),
      'M1: the exam prompt carries, directly after its TEST COMMAND: line, a COVERED: block with ' +
      'one M<n>: <path> line per covered clause; got: ' + JSON.stringify(prompts[0]))
    assert.ok(!prompts[0].includes('\nM2:'),
      'M1: an uncovered clause (M2, covered[1] is null) earns no line at all in the COVERED: block')
  }

  // scenario 2: same candidate found, but readCovering answers nothing covered.
  {
    const readCovering = readerFake(async () => ({ covered: [null, null], scores: [[0], [0]] }))
    const prompts = []
    const worker = async (opts) => {
      if (opts.role === 'exam') prompts.push(opts.prompt)
      return { result: { total_cost_usd: 0, result: '' }, denials: [] }
    }
    const judge = { readCovering }
    await harness({
      taskId: 'a2', clauses: [CLAUSE_1, CLAUSE_2],
      files: { 'tests/test_catalog.py': CATALOG_TEXT },
      worker, judge,
    })
    assert.equal(readCovering.calls.length, 1, 'precondition (a2): readCovering was asked (a candidate existed)')
    assert.equal(prompts.length, 1, 'precondition (a2): the exam worker is dispatched exactly once')
    assert.ok(!prompts[0].includes('COVERED:'),
      'M1: with no clause covered, the exam prompt carries no COVERED: block at all; got: ' +
      JSON.stringify(prompts[0]))
  }

  // scenario 3: no tracked file matches any needle — readCovering never asked.
  {
    const readCovering = readerFake(async () => ({ covered: [null, null], scores: [[0], [0]] }))
    const worker = async () => ({ result: { total_cost_usd: 0, result: '' }, denials: [] })
    const judge = { readCovering }
    await harness({ taskId: 'a3', clauses: [CLAUSE_1, CLAUSE_2], files: {}, worker, judge })
    assert.equal(readCovering.calls.length, 0,
      'M1: with no candidates found, the judge is not asked readCovering at all')
  }
}

// ══════════════════════════════════════════════════════════════════════════
// (b) [M2] post-landing selection
// ══════════════════════════════════════════════════════════════════════════

async function legB () {
  const worker = async (opts) => {
    if (opts.role === 'implement') {
      fs.mkdirSync(path.join(opts.cwd, 'src'), { recursive: true })
      fs.writeFileSync(path.join(opts.cwd, 'src', 'catalog.py'), 'def catalog_util():\n    return True\n')
    }
    return { result: { total_cost_usd: 0, result: '' }, denials: [] }
  }
  const readCovering = readerFake(async () => ({ covered: ['tests/test_cover.py'], scores: [[0.9]] }))
  const readGuards = readerFake(async () => ({
    selected: ['tests/test_catalog.py', 'tests/test_b.py'], scores: [0.9, 0.6],
  }))
  const judge = { readCovering, readGuards }
  const files = {
    'tests/test_cover.py': 'about catalog_util indeed\n',
    'tests/test_catalog.py': 'also about catalog_util here\n',
    'tests/test_b.py': 'again mentions catalog_util plainly\n',
  }
  const sh = ({ cmd, argv }) => {
    if (cmd === 'python3' && argv[0] === '-m') return { status: 0, stdout: 'exam ok\n' }
    if (cmd === 'timeout') return { status: 0, stdout: 'select-run ok\n' }
    return undefined
  }
  const { result, events, shCalls } = await harness({
    taskId: 'b1', clauses: [CLAUSE_1], files, worker, judge, sh,
    policyMutate: (p) => { p.select.max_run = 2 },
  })
  assert.ok(result.adopted.includes('b1'), 'precondition (b): the fixture task must adopt')

  assert.equal(readGuards.calls.length, 1,
    'M2: readGuards is asked exactly once after the best candidate lands')
  const call = readGuards.calls[0]
  assert.equal(typeof call.patch, 'string', 'M2: readGuards\' patch is a string (hunksCarrying\'s output)')
  assert.ok(call.patch.length > 0, 'M2: readGuards\' patch is not empty — the candidate did patch something')
  assert.equal(call.tests.length, 3,
    'M2: readGuards is handed one test entry per candidate candidateTests found over the patch-touched paths')
  assert.deepStrictEqual(call.tests.map((t) => t.path).slice().sort(),
    ['tests/test_b.py', 'tests/test_catalog.py', 'tests/test_cover.py'],
    'M2: readGuards\' tests are exactly the three tracked files mentioning catalog_util')
  for (const t of call.tests) {
    assert.equal(typeof t.text, 'string', 'M2: each of readGuards\' tests carries a text string, not just a path')
  }

  const timeoutCalls = shCalls.filter((c) => c.cmd === 'timeout')
  assert.equal(timeoutCalls.length, 2,
    'M2: the run set (covering tests first, then selected, deduplicated, capped at max_run=2) runs exactly 2 tests')
  assert.equal([timeoutCalls[0].cmd, ...timeoutCalls[0].argv].join(' '),
    'timeout 300 python3 -m pytest -q tests/test_cover.py',
    'M2: the covering test runs first, via commandFor(path, policy.select.timeout_seconds)')
  assert.equal([timeoutCalls[1].cmd, ...timeoutCalls[1].argv].join(' '),
    'timeout 300 python3 -m pytest -q tests/test_catalog.py',
    'M2: readGuards\' first selected test runs second, deduplicated against the covering test')
  assert.ok(!timeoutCalls.some((c) => c.argv.includes('tests/test_b.py')),
    'M2: the run set is capped at max_run=2 — the second selected test never runs')

  const row = findOne(events, 'select:landing', 'b1')
  assert.ok(row, 'M2: a select:landing event is appended after the run set is run')
  assert.deepStrictEqual(row.candidates.slice().sort(),
    ['tests/test_b.py', 'tests/test_catalog.py', 'tests/test_cover.py'],
    'M2: select:landing\'s candidates is the set candidateTests found over the patch-touched paths')
  assert.deepStrictEqual(row.selected, ['tests/test_catalog.py', 'tests/test_b.py'],
    'M2: select:landing\'s selected is readGuards\' answer verbatim')
  assert.deepStrictEqual(row.ran, [
    { path: 'tests/test_cover.py', exit: 0 },
    { path: 'tests/test_catalog.py', exit: 0 },
  ], 'M2: select:landing\'s ran is {path, exit} for each run-set test, in run order')
}

// ══════════════════════════════════════════════════════════════════════════
// (c) [M3] a run-set test red in the candidate's clone
// ══════════════════════════════════════════════════════════════════════════

async function legC () {
  const files = { 'tests/test_catalog.py': 'about catalog_util here\n' }
  const worker = async (opts) => {
    if (opts.role === 'implement') {
      fs.mkdirSync(path.join(opts.cwd, 'src'), { recursive: true })
      fs.writeFileSync(path.join(opts.cwd, 'src', 'catalog.py'), 'def catalog_util():\n    return True\n')
    }
    return { result: { total_cost_usd: 0, result: '' }, denials: [] }
  }
  const judge = { readGuards: readerFake(async () => ({ selected: ['tests/test_catalog.py'], scores: [0.9] })) }
  const OUTPUT_TAIL = 'Q'.repeat(2000) + 'ENDMARK123'

  // sub-case 1: red in the candidate's clone, green at the base anchor -> catch.
  {
    const sh = ({ cmd, argv, cwd }) => {
      if (cmd === 'python3' && argv[0] === '-m') return { status: 0, stdout: 'exam ok\n' }
      if (cmd === 'timeout') {
        const base = path.basename(cwd)
        if (base.startsWith('impl-')) return { status: 3, stdout: OUTPUT_TAIL }
        if (base.startsWith('base-')) return { status: 0, stdout: 'base ok\n' }
      }
      return undefined
    }
    const board = makeFakeBoard()
    const { events } = await harness({
      taskId: 'c1', clauses: [CLAUSE_1], files, worker, judge, sh, board,
      policyMutate: (p) => { p.landing.redispatch.enabled = false },
    })

    const catchRow = findOne(events, 'catch', 'c1')
    assert.ok(catchRow, 'M3: a run-set test that stays red at the base anchor logs nothing, ' +
      'but one that is green there logs a catch — expected one here')
    assert.deepStrictEqual(Object.keys(catchRow).sort(), ['exit', 'kind', 'path', 'task'],
      'M3: the catch event is exactly {kind, task, path, exit}')
    assert.equal(catchRow.path, 'tests/test_catalog.py', 'M3: the catch event names the red run-set test')
    assert.equal(catchRow.exit, 3, 'M3: the catch event carries the candidate clone\'s own exit code')
    assert.equal(findAll(events, 'select:red-at-base', 'c1').length, 0,
      'M3: a test green at the base anchor is a catch, not a select:red-at-base')

    const post = board.posts.find((p) => p.taskId === 'c1' && p.kind === 'catch')
    assert.ok(post, 'M3: a catch posts a board comment on the task')
    assert.ok(post.text.includes('tests/test_catalog.py'), 'M3: the catch comment names the path')
    assert.ok(post.text.includes('3'), 'M3: the catch comment carries the exit code')
    assert.ok(post.text.includes(OUTPUT_TAIL.slice(-1500)),
      'M3: the catch comment carries the last 1,500 characters of the test\'s output')
  }

  // sub-case 2: red in the candidate's clone AND red at the base anchor -> red-at-base, no post.
  {
    const sh = ({ cmd, argv, cwd }) => {
      if (cmd === 'python3' && argv[0] === '-m') return { status: 0, stdout: 'exam ok\n' }
      if (cmd === 'timeout') {
        const base = path.basename(cwd)
        if (base.startsWith('impl-')) return { status: 3, stdout: OUTPUT_TAIL }
        if (base.startsWith('base-')) return { status: 3, stdout: 'base also red\n' }
      }
      return undefined
    }
    const board = makeFakeBoard()
    const { events } = await harness({
      taskId: 'c2', clauses: [CLAUSE_1], files, worker, judge, sh, board,
      policyMutate: (p) => { p.landing.redispatch.enabled = false },
    })

    const row = findOne(events, 'select:red-at-base', 'c2')
    assert.ok(row, 'M3: a run-set test red in both the candidate\'s clone and the base anchor ' +
      'logs select:red-at-base')
    assert.deepStrictEqual(Object.keys(row).sort(), ['kind', 'path', 'task'],
      'M3: the select:red-at-base event is exactly {kind, task, path}')
    assert.equal(row.path, 'tests/test_catalog.py', 'M3: select:red-at-base names the still-red run-set test')
    assert.equal(findAll(events, 'catch', 'c2').length, 0,
      'M3: a test red at the base anchor too is not a catch')
    assert.ok(!board.posts.some((p) => p.taskId === 'c2' && p.kind === 'catch'),
      'M3: red-at-base posts nothing to the board')
  }
}

// ══════════════════════════════════════════════════════════════════════════
// (d) [M4] a catch forces exactly one re-dispatch, capped at one
// ══════════════════════════════════════════════════════════════════════════

async function legD () {
  const files = { 'tests/test_catalog.py': 'about catalog_util here\n' }
  const readLanding = readerFake(async () => ({ claim: 1, coverage: [0.9, 0.9] }))
  const readGuards = readerFake(async () => ({ selected: ['tests/test_catalog.py'], scores: [0.9] }))
  const sh = ({ cmd, argv, cwd }) => {
    if (cmd === 'python3' && argv[0] === '-m') return { status: 0, stdout: 'exam ok\n' }
    if (cmd === 'timeout') {
      const base = path.basename(cwd)
      if (base.startsWith('impl-')) return { status: 1, stdout: 'still red\n' }
      if (base.startsWith('base-')) return { status: 0, stdout: 'base ok\n' }
    }
    return undefined
  }

  // Run A: redispatch enabled — a catch alone, with a green exam and coverage
  // [0.9, 0.9] (above the 0.5 floor), still earns exactly one re-dispatch, and
  // the test staying red after it does not earn a third.
  {
    const labels = []
    const worker = async (opts) => {
      labels.push(opts.label)
      if (opts.role === 'implement') {
        fs.mkdirSync(path.join(opts.cwd, 'src'), { recursive: true })
        fs.writeFileSync(path.join(opts.cwd, 'src', 'catalog.py'), 'def catalog_util():\n    return True\n')
      }
      return { result: { total_cost_usd: 0, result: '' }, denials: [] }
    }
    const judge = { readLanding, readGuards }
    const { result, shCalls } = await harness({
      taskId: 'd1', clauses: [CLAUSE_1, CLAUSE_2], files, worker, judge, sh,
      policyMutate: (p) => { p.landing.redispatch.enabled = true },
    })

    const implLabels = labels.filter((l) => l.startsWith('impl:'))
    assert.equal(implLabels.length, 2,
      'M4: a landing with >=1 catch is short and gets exactly one re-dispatch, even with a ' +
      'green exam and coverage above the floor — two impl: dispatches total; got ' + JSON.stringify(implLabels))
    assert.equal(implLabels[1], 'impl:d1:redispatch',
      'M4: the second dispatch is labelled impl:<id>:redispatch')

    const candidateTimeoutCalls = shCalls.filter((c) =>
      c.cmd === 'timeout' && path.basename(c.cwd).startsWith('impl-') && c.argv.includes('tests/test_catalog.py'))
    assert.equal(candidateTimeoutCalls.length, 2,
      'M4: after the re-dispatch the run set is run again the same way — the selected test runs ' +
      'in the candidate\'s clone twice in total, not once')

    assert.ok(result.adopted.includes('d1'),
      'M4: the task is still adopted even though the run-set test is still red after the one ' +
      're-dispatch it is allowed — no task ever gets a third implementer dispatch, and a ' +
      'persistent catch does not block adoption')
  }

  // Run B: redispatch disabled — the same catch, but only the original dispatch.
  {
    const labels = []
    const worker = async (opts) => {
      labels.push(opts.label)
      if (opts.role === 'implement') {
        fs.mkdirSync(path.join(opts.cwd, 'src'), { recursive: true })
        fs.writeFileSync(path.join(opts.cwd, 'src', 'catalog.py'), 'def catalog_util():\n    return True\n')
      }
      return { result: { total_cost_usd: 0, result: '' }, denials: [] }
    }
    const judge = { readLanding, readGuards }
    await harness({
      taskId: 'd2', clauses: [CLAUSE_1, CLAUSE_2], files, worker, judge, sh,
      policyMutate: (p) => { p.landing.redispatch.enabled = false },
    })
    const implLabels = labels.filter((l) => l.startsWith('impl:'))
    assert.equal(implLabels.length, 1,
      'M4: with policy.landing.redispatch.enabled false, the same catch earns no re-dispatch at all')
  }
}

// ══════════════════════════════════════════════════════════════════════════
// (e) [M5] the policy switch, a judge answering neither reader, and the
//     args.policy / POLICY_PATH fallback
// ══════════════════════════════════════════════════════════════════════════

async function legE () {
  const files = {
    'tests/test_cover.py': 'about catalog_util indeed\n',
    'tests/test_catalog.py': 'also about catalog_util here\n',
    'tests/test_b.py': 'again mentions catalog_util plainly\n',
  }
  const worker = () => {
    const prompts = []
    const fn = async (opts) => {
      if (opts.role === 'exam') prompts.push(opts.prompt)
      if (opts.role === 'implement') {
        fs.mkdirSync(path.join(opts.cwd, 'src'), { recursive: true })
        fs.writeFileSync(path.join(opts.cwd, 'src', 'catalog.py'), 'def catalog_util():\n    return True\n')
      }
      return { result: { total_cost_usd: 0, result: '' }, denials: [] }
    }
    fn.prompts = prompts
    return fn
  }
  const sh = ({ cmd, argv }) => {
    if (cmd === 'python3' && argv[0] === '-m') return { status: 0, stdout: 'exam ok\n' }
    return undefined
  }

  // scenario 1: select.enabled false, judge answers BOTH readers — must never be asked.
  {
    const readCovering = readerFake(async () => ({ covered: ['tests/test_cover.py'], scores: [[0.9]] }))
    const readGuards = readerFake(async () => ({ selected: ['tests/test_catalog.py'], scores: [0.9] }))
    const w = worker()
    const { events, shCalls } = await harness({
      taskId: 'e1', clauses: [CLAUSE_1], files, worker: w, judge: { readCovering, readGuards }, sh,
      policyMutate: (p) => { p.select.enabled = false },
    })
    assert.equal(events.filter((e) => String(e.kind).startsWith('select:') || e.kind === 'catch').length, 0,
      'M5: with policy.select.enabled false, the engine appends no select:*/catch event')
    assert.ok(!w.prompts.some((p) => p.includes('COVERED:')),
      'M5: with policy.select.enabled false, no exam prompt carries a COVERED: block')
    assert.ok(!shCalls.some((c) => c.cmd === 'timeout'),
      'M5: with policy.select.enabled false, sh is never called with timeout as its command')
    assert.equal(readCovering.calls.length, 0, 'M5: with the switch off, readCovering is never asked')
    assert.equal(readGuards.calls.length, 0, 'M5: with the switch off, readGuards is never asked')
  }

  // scenario 2: select.enabled true (unchanged), judge answers neither reader.
  {
    const w = worker()
    const { events, shCalls } = await harness({
      taskId: 'e2', clauses: [CLAUSE_1], files, worker: w, judge: {}, sh,
    })
    assert.equal(events.filter((e) => String(e.kind).startsWith('select:') || e.kind === 'catch').length, 0,
      'M5: with a judge answering neither reader, the engine appends no select:*/catch event')
    assert.ok(!w.prompts.some((p) => p.includes('COVERED:')),
      'M5: with a judge answering neither reader, no exam prompt carries a COVERED: block')
    assert.ok(!shCalls.some((c) => c.cmd === 'timeout'),
      'M5: with a judge answering neither reader, sh is never called with timeout as its command')
  }

  // scenario 3: no args.policy at all — runEngine falls back to POLICY_PATH,
  // whose real select.enabled is true, so M1's selection still fires.
  {
    const readCovering = readerFake(async () => ({ covered: ['tests/test_cover.py'], scores: [[0.9]] }))
    const w = worker()
    const { events } = await harness({
      taskId: 'e3', clauses: [CLAUSE_1], files, worker: w, judge: { readCovering }, sh,
      usePolicy: false,
    })
    assert.equal(readCovering.calls.length, 1,
      'M5: with no args.policy given, runEngine reads factory/policy.json\'s own POLICY_PATH, ' +
      'whose select.enabled is true — readCovering is still asked')
    assert.ok(findOne(events, 'select:exam', 'e3'),
      'M5: ...and a select:exam event is still appended, proving the POLICY_PATH fallback ran')
  }
}

await legA()
console.log('(a) [M1] exam-dispatch selection: PASSED')
await legB()
console.log('(b) [M2] post-landing selection: PASSED')
await legC()
console.log('(c) [M3] run-set red in the candidate\'s clone: PASSED')
await legD()
console.log('(d) [M4] catch forces exactly one re-dispatch: PASSED')
await legE()
console.log('(e) [M5] policy switch / neither reader / POLICY_PATH fallback: PASSED')

console.log('ALL TESTS PASSED')
