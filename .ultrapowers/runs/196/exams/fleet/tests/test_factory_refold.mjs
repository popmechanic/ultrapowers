// fleet/tests/test_factory_refold.mjs — the exam for "the engine can fold a
// finished run onto a main that moved, and check it there" (factory/engine.mjs
// `--refold`, exported as `runRefold(args, deps)` beside `runEngine`).
//
// This exam calls `runRefold` (and, for leg d's second half, `runEngine`)
// in-process with injected deps — the same seam `runEngine`'s own
// `overrides`/`deps` parameter already offers, and the one place the Context
// section names as where a sim reaches this code. `main()`'s CLI parsing and
// its stdout/exit-code translation are NOT exercised by subprocess: there is
// no override seam reachable from argv, so this exam treats `runRefold`'s
// resolved value as the object `main` would print, and assumes exit codes
// 0/3/4 are a direct, deterministic function of `refolded`/`reason` on that
// object. That assumption is spelled out again in the hand-in note.
//
// Any process THIS FILE spawns directly (only `git`, for building fixture
// repos) uses `env: simEnv()`, never `process.env`. The kernel and every
// task's own test command are faked via `deps.sh` — never spawned for real —
// exactly as the Context section asks.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { simEnv } from './_helpers.mjs'
import { runRefold, runEngine, defaultGit } from '../../factory/engine.mjs'

const ENV = simEnv()

const gitSync = (argv, cwd) =>
  execFileSync('git', argv, { cwd, env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

const mkdtemp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix))

const writeFile = (p, content) => {
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, content)
}

const readEvents = (runDir) => {
  const p = path.join(runDir, 'events.jsonl')
  if (!fs.existsSync(p)) return []
  return fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
}

// ── a minimal claims-v1 plan.md, verified against the real plan_parse.py ────
// One task, one proof test, no dependencies — enough for the compiler to
// hand back `proofTests: ['tests/test_x.py']` and a derived `testCmd`.
function writePlan (root) {
  const p = path.join(root, 'plan.md')
  writeFile(p, `# Refold exam fixture plan

**Goal:** minimal fixture.
**Tech Stack:** n/a
**Spec:** none
**Acceptance:** n/a

---

### Task T1: a minimal task

**Type:** implementation
**Depends-on:** none

**Files:**
- Create: \`pkg/thing.py\`
- Test: \`tests/test_x.py\`

**Interfaces:**
- Consumes: none
- Produces: none

**Claim:** the thing works.

**Machine:**
- **M1**: the thing works.

**Proof:**
- Test: \`tests/test_x.py\`
- Legs: (a) the thing works.

---
`)
  return p
}

// A `policy.json` with just enough to keep every optional switch OFF except
// `resolve.union.mode: 'live'` (needed for leg c to reach `unionReply` at
// all, per M3's own resolve() code path) so every leg's behaviour is
// otherwise the engine's plain default.
function writePolicy (root) {
  const p = path.join(root, 'policy.json')
  writeFile(p, JSON.stringify({
    resolve: { union: { mode: 'live', independent_additions: 1, shared_anchor_max: 0, ordering_matters_max: 0 } },
  }))
  return p
}

// A `--exams-dir` holding a file the target's own tree never gets: proof for
// M2's "copies every file under --exams-dir ... when the clone lacks it".
function writeExamsDir (root) {
  const dir = path.join(root, 'exams')
  writeFile(path.join(dir, 'tests', 'test_x.py'), '# exam file, lives only under --exams-dir\n')
  return dir
}

// ── the repo topology every leg folds against ───────────────────────────────
//
//   base (B0) ── mainline ── onto (O1, "a main that moved")
//     └──────── run ── C1 (file_a.txt) ── C2 (file_b.txt)   [target's HEAD]
//
//   materialized: a real, resettable commit built on top of `onto`, carrying
//   both files the run's two commits added — what a real kernel merge would
//   produce; the fake kernel's `materialize` answer just names its sha.
function buildTopology (root) {
  const target = path.join(root, 'target')
  fs.mkdirSync(target, { recursive: true })
  gitSync(['init', '-q', '-b', 'main'], target)
  gitSync(['config', 'user.email', 'sim@test'], target)
  gitSync(['config', 'user.name', 'sim'], target)
  writeFile(path.join(target, 'README.md'), 'base\n')
  gitSync(['add', '-A'], target)
  gitSync(['commit', '-q', '-m', 'base'], target)
  const base = gitSync(['rev-parse', 'HEAD'], target)

  gitSync(['checkout', '-q', '-b', 'mainline', base], target)
  writeFile(path.join(target, 'file_o.txt'), 'onto change\n')
  gitSync(['add', '-A'], target)
  gitSync(['commit', '-q', '-m', 'onto moved'], target)
  const onto = gitSync(['rev-parse', 'HEAD'], target)

  gitSync(['checkout', '-q', '-b', 'run', base], target)
  writeFile(path.join(target, 'file_a.txt'), 'a\n')
  gitSync(['add', '-A'], target)
  gitSync(['commit', '-q', '-m', 'commit 1'], target)
  writeFile(path.join(target, 'file_b.txt'), 'b\n')
  gitSync(['add', '-A'], target)
  gitSync(['commit', '-q', '-m', 'commit 2'], target)
  const runHead = gitSync(['rev-parse', 'HEAD'], target)

  gitSync(['checkout', '-q', '-b', 'materialized', onto], target)
  writeFile(path.join(target, 'file_a.txt'), 'a\n')
  writeFile(path.join(target, 'file_b.txt'), 'b\n')
  gitSync(['add', '-A'], target)
  gitSync(['commit', '-q', '-m', 'materialized (fake kernel answer)'], target)
  const materialized = gitSync(['rev-parse', 'HEAD'], target)

  // Leave the target the way a finished run actually leaves it: checked out
  // at its own head.
  gitSync(['checkout', '-q', 'run'], target)
  gitSync(['reset', '-q', '--hard', runHead], target)

  return { target, base, onto, runHead, materialized }
}

// ── fake sh: disambiguates the kernel's own child_process calls (argv[0]
// ends `fold_wave.py`) from a task's test-command invocation ───────────────
function makeFakeSh ({ foldAnswer, materializedSha, examExit = 0, onCall } = {}) {
  const calls = []
  const fn = (cmd, argv = [], cwd, input) => {
    const rec = { cmd, argv: [...argv], cwd, input }
    calls.push(rec)
    if (typeof onCall === 'function') onCall(rec)
    const isKernel = argv[0] !== undefined && String(argv[0]).endsWith('fold_wave.py')
    if (isKernel) {
      const sub = argv[1]
      if (sub === 'fold') return { status: 0, stdout: JSON.stringify(foldAnswer) + '\n' }
      if (sub === 'materialize') return { status: 0, stdout: JSON.stringify({ candidateSha: materializedSha }) + '\n' }
      if (sub === 'resolve') return { status: 0, stdout: JSON.stringify({ complete: true }) + '\n' }
      return { status: 1, stdout: '', stderr: 'sim: unexpected kernel subcommand ' + sub }
    }
    return { status: examExit, stdout: examExit === 0 ? 'ok\n' : 'FAILED\n' }
  }
  fn.calls = calls
  return fn
}

// A generically permissive fake worker: every dispatch succeeds with no
// output. For a `role: 'resolve'` dispatch it answers the RESOLVER_SCHEMA
// shape, configurable so leg c can force it BLOCKED (an unresolved conflict).
function makeFakeWorker ({ resolverStatus = 'BLOCKED' } = {}) {
  const calls = []
  const fn = async (opts) => {
    calls.push({ label: opts.label, role: opts.role, taskId: opts.task })
    if (opts.role === 'resolve') {
      return {
        result: { result: '', structured_output: { status: resolverStatus, hunks: [], notes: 'sim resolver' } },
        denials: [],
      }
    }
    return { result: { result: '', structured_output: null, total_cost_usd: 0 }, denials: [] }
  }
  fn.calls = calls
  return fn
}

async function main () {
  // ── leg (a) [M1]: a clean refold, folded onto a moved main ──────────────
  const rootA = mkdtemp('refold-a-')
  const { target: targetA, base: baseA, onto: ontoA, materialized: matA } = buildTopology(rootA)
  const runDirA = path.join(rootA, 'run')
  const shA = makeFakeSh({ foldAnswer: { complete: true }, materializedSha: matA, examExit: 0 })
  const workerA = makeFakeWorker()
  const answerA = await runRefold(
    { plan: writePlan(rootA), target: targetA, base: baseA, onto: ontoA, runDir: runDirA,
      examsDir: writeExamsDir(rootA), policy: writePolicy(rootA) },
    { sh: shA, git: defaultGit, worker: workerA, log: () => {} },
  )

  // [M1] the kernel's fold is asked --base <onto>, and the --patch argument
  // ends "@<base>" — "the target's HEAD against --base"
  const foldCallA = shA.calls.find((c) => c.argv[1] === 'fold')
  assert.ok(foldCallA, '[M1][leg a] the kernel fold call happened')
  const baseFlagIdx = foldCallA.argv.indexOf('--base')
  assert.equal(foldCallA.argv[baseFlagIdx + 1], ontoA, '[M1][leg a] fold sees --base <onto>')
  const patchFlagIdx = foldCallA.argv.indexOf('--patch')
  const patchArgA = foldCallA.argv[patchFlagIdx + 1]
  assert.ok(patchArgA.endsWith('@' + baseA), '[M1][leg a] the --patch argument ends "@<base>"')

  // [M1] the patch file's text names both files the two run commits added
  const patchFileA = patchArgA.slice(patchArgA.indexOf('=') + 1, patchArgA.lastIndexOf('@'))
  const patchTextA = fs.readFileSync(patchFileA, 'utf8')
  assert.ok(patchTextA.includes('file_a.txt'), '[M1][leg a] the patch names file_a.txt')
  assert.ok(patchTextA.includes('file_b.txt'), '[M1][leg a] the patch names file_b.txt')

  // [M1] target's HEAD is the materialized commit — "resets the target to
  // the resulting commit"
  assert.equal(gitSync(['rev-parse', 'HEAD'], targetA), matA,
    '[M1][leg a] target HEAD is the materialized commit')

  // [M1] the whole printed answer, by equality (the clause fixes it exactly)
  assert.deepEqual(answerA, { refolded: true, head: matA, onto: ontoA },
    '[M1][leg a] the printed answer is exactly {refolded:true, head, onto}')

  // ── leg (b) [M2]: a red re-verify resets the target and reports red ─────
  const rootB = mkdtemp('refold-b-')
  const { target: targetB, base: baseB, onto: ontoB, materialized: matB } = buildTopology(rootB)
  const runDirB = path.join(rootB, 'run')
  const examsDirB = writeExamsDir(rootB) // holds tests/test_x.py, target never does
  const beforeHeadB = gitSync(['rev-parse', 'HEAD'], targetB)
  let sawExamCloneHadOverlay = false
  let sawExamCwd = null
  const shB = makeFakeSh({
    foldAnswer: { complete: true },
    materializedSha: matB,
    examExit: 1, // "fake sh answers 1 to that exam"
    onCall: (rec) => {
      const isKernel = rec.argv[0] !== undefined && String(rec.argv[0]).endsWith('fold_wave.py')
      if (!isKernel) {
        sawExamCwd = rec.cwd
        sawExamCloneHadOverlay = fs.existsSync(path.join(rec.cwd, 'tests', 'test_x.py'))
      }
    },
  })
  const workerB = makeFakeWorker()
  const answerB = await runRefold(
    { plan: writePlan(rootB), target: targetB, base: baseB, onto: ontoB, runDir: runDirB,
      examsDir: examsDirB, policy: writePolicy(rootB) },
    { sh: shB, git: defaultGit, worker: workerB, log: () => {} },
  )

  // [M2] "runs every task's exam" in a clone holding the overlaid file
  assert.ok(sawExamCwd, '[M2][leg b] the exam test command ran somewhere')
  assert.equal(sawExamCloneHadOverlay, true,
    '[M2][leg b] the clone the exam ran in holds the file that only lives under --exams-dir')
  // [M2] "the target's tree does not hold it"
  assert.equal(fs.existsSync(path.join(targetB, 'tests', 'test_x.py')), false,
    '[M2][leg b] the target tree does not hold the exams-dir file')

  const rowsB = readEvents(runDirB)
  const redRow = rowsB.find((r) => r.kind === 'refold:red')
  assert.ok(redRow, '[M2][leg b] a refold:red row is appended')
  assert.equal(redRow.exit, 1, '[M2][leg b] the refold:red row carries the exam exit')
  assert.ok(Object.prototype.hasOwnProperty.call(redRow, 'exam'),
    '[M2][leg b] the refold:red row names the exam')

  // [M2] "resets the target back to the head it had"
  assert.equal(gitSync(['rev-parse', 'HEAD'], targetB), beforeHeadB,
    '[M2][leg b] the target is reset back to the head it had before the failed re-verify')

  // [M2] the answer: refolded false, reason red (an ellipsis follows in the
  // clause, so only these two fields are pinned)
  assert.equal(answerB.refolded, false, '[M2][leg b] refolded is false on a red re-verify')
  assert.equal(answerB.reason, 'red', '[M2][leg b] the reason is red')

  // ── leg (c) [M3]: a fold that never completes leaves the target alone ───
  const rootC = mkdtemp('refold-c-')
  const { target: targetC, base: baseC, onto: ontoC, materialized: matC } = buildTopology(rootC)
  const runDirC = path.join(rootC, 'run')
  const beforeHeadC = gitSync(['rev-parse', 'HEAD'], targetC)
  // A hunksFile with no `HUNK <id>` blocks: `unionReply` (factory/union.mjs)
  // returns null for it, so the union step declines and the code falls
  // through to a real resolver dispatch — which this leg's fake worker
  // answers BLOCKED, so the conflict is never resolved either.
  const hunksFileC = path.join(rootC, 'hunks-0.txt')
  writeFile(hunksFileC, 'no conflict markers in this fixture at all\n')
  const shC = makeFakeSh({
    foldAnswer: { complete: false, open: [{ i: 0, path: 'file_a.txt', hunksFile: hunksFileC }] },
    materializedSha: matC,
    examExit: 0,
  })
  const workerC = makeFakeWorker({ resolverStatus: 'BLOCKED' })
  const readUnionC = async () => ({ union: false })
  const answerC = await runRefold(
    { plan: writePlan(rootC), target: targetC, base: baseC, onto: ontoC, runDir: runDirC,
      examsDir: writeExamsDir(rootC), policy: writePolicy(rootC) },
    { sh: shC, git: defaultGit, worker: workerC, readUnion: readUnionC, log: () => {} },
  )

  const rowsC = readEvents(runDirC)
  const conflictRow = rowsC.find((r) => r.kind === 'refold:conflict')
  assert.ok(conflictRow, '[M3][leg c] a refold:conflict row is appended')
  assert.equal(conflictRow.path, 'file_a.txt', '[M3][leg c] the row names the conflicted path')

  // [M3] "leaves the target at the head it had"
  assert.equal(gitSync(['rev-parse', 'HEAD'], targetC), beforeHeadC,
    '[M3][leg c] the target is left at the head it had')
  assert.equal(answerC.refolded, false, '[M3][leg c] refolded is false on an unresolved conflict')
  assert.equal(answerC.reason, 'conflict', '[M3][leg c] the reason is conflict')

  // ── leg (d) [M4]: no exam/impl dispatch on any refold drive, and a
  //     non-refold drive still resolves the engine's five keys ─────────────
  for (const [label, calls, runDir] of [['leg a', workerA.calls, runDirA], ['leg b', workerB.calls, runDirB], ['leg c', workerC.calls, runDirC]]) {
    for (const call of calls) {
      assert.ok(!String(call.label || '').startsWith('exam:'),
        '[M4][' + label + '] refold dispatches no examiner (label ' + call.label + ')')
      assert.ok(!String(call.label || '').startsWith('impl:'),
        '[M4][' + label + '] refold dispatches no implementer (label ' + call.label + ')')
    }
    for (const row of readEvents(runDir)) {
      if (typeof row.label !== 'string') continue
      assert.ok(!row.label.startsWith('exam:') && !row.label.startsWith('impl:'),
        '[M4][' + label + '] no dispatch:* event names an exam:/impl: label (' + row.label + ')')
    }
  }

  // A plain `runEngine` drive (no --refold at all) on the rig's own fixture
  // plan: "the entry is what it was" — it still resolves the five-key answer
  // shape `runEngine` has always returned.
  const rootD = mkdtemp('refold-d-')
  const { target: targetD, base: baseD, materialized: matD } = buildTopology(rootD)
  const runDirD = path.join(rootD, 'run')
  const shD = makeFakeSh({ foldAnswer: { complete: true }, materializedSha: matD, examExit: 0 })
  const workerD = makeFakeWorker()
  const answerD = await runEngine(
    { plan: writePlan(rootD), target: targetD, base: baseD, runDir: runDirD, policy: writePolicy(rootD) },
    { sh: shD, git: defaultGit, worker: workerD, log: () => {} },
  )
  assert.deepEqual(Object.keys(answerD).sort(), ['adopted', 'cost_usd', 'done', 'head', 'wall_ms'].sort(),
    '[M4][leg d] a drive without --refold still resolves the engine\'s five keys')

  console.log('ALL TESTS PASSED')
}

main().catch((e) => {
  console.error(e && e.stack || e)
  process.exit(1)
})
