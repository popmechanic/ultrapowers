// fleet/tests/test_factory_exam_skip.mjs — the exam for "A task with no exam
// file gets no examiner."
//
// Machine:
//   M1. For a task whose `proofTests` is empty, `examine` dispatches no
//       worker, posts no `exam-note`, asks no covering reading, appends
//       exactly one `{ kind: 'exam:skipped', task, reason: 'no exam file' }`
//       row, and resolves the same shape it resolves for any task, with
//       `examFiles` `[]` and `taskCovering` `[]`.
//   M2. That task's implementers are dispatched and its landing is measured
//       and adopted as for any other task.
//   M3. A task whose `proofTests` is non-empty is examined exactly as
//       before.
//
// Fixture: one real run of `factory/engine.mjs`'s `runEngine`, on a
// two-task plan — task 1 ("Docs note") names no `- Test:` bullet at all
// (`proofTests: []`, `testCmd: null`); task 2 ("Widget behavior") names one
// (`fleet/tests/test_widget.mjs`). The two tasks touch disjoint files and
// declare no Consumes/Produces, so the plan compiler gives them zero edges:
// both are ready in the very first readiness pass and land independently.
//
// The rig is fake-driven below the agent seam (`worker`, `judge`, `board`)
// and real above it (`makeRepo`'s git repo, the real plan-grammar compiler,
// the real fold kernel over that real repo) — the same split
// `fleet/tests/_engine_helpers.mjs` uses for the older engine, whose
// `makeRepo` this file imports directly.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { runEngine } from '../../factory/engine.mjs'
import { makeRepo } from './_engine_helpers.mjs'
import { simEnv } from './_helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'exam-skip-'))
const target = path.join(tmp, 'target')
const runDir = path.join(tmp, 'run')

makeRepo(target, {
  'NOTES.md': 'before\n',
  'src/widget.js': 'before\n',
})
// Belt-and-braces: the kernel commits inside `target` via `git commit-tree`
// (`skills/ultrapowers/kernel/fold_wave.py`'s materialize step). `makeRepo`
// already gives `target` its own local `user.name`/`user.email`, which
// `commit-tree` reads via `-C target` regardless of the box's own config —
// this just keeps a stray global `commit.gpgsign = true` on the box running
// the exam from turning that into a passphrase prompt.
execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: target, env: simEnv() })

// ── the plan fixture ─────────────────────────────────────────────────────
// Task 1 names no `- Test:` bullet at all: `proofTests` is `[]`, `testCmd`
// is `null` (`skills/ultrapowers/scripts/plan_parse.py`'s `_derive_test_cmd`
// on an empty list). Task 2 names one. Neither task's Interfaces slot names
// a real token ("none"/"nothing" are the parser's own no-token words) and
// their Files bullets touch disjoint paths, so the compiler gives them zero
// dependency edges — both launch in the plan's first wave.
const PLAN = `# Fixture plan

### Task 1: Docs note

**Files:**
- Modify: \`NOTES.md\`

**Claim:** NOTES.md gets a short note. (fixture)

**Interfaces:**
- Consumes: none
- Produces: nothing

**Context:** a fixture task that names no exam file — no \`- Test:\` bullet at all.

### Task 2: Widget behavior

**Files:**
- Modify: \`src/widget.js\`

**Claim:** the widget does the thing. (fixture)

**Interfaces:**
- Consumes: none
- Produces: nothing

**Context:** a fixture task that names an exam file.

**Proof:**
- Test: \`fleet/tests/test_widget.mjs\`
`
const planPath = path.join(tmp, 'plan.md')
fs.writeFileSync(planPath, PLAN)

// ── the policy fixture ───────────────────────────────────────────────────
// A copy of the real `factory/policy.json`, with `pairs.mode` forced `off`
// and `fold.reverify.enabled` / `select.enabled` forced `false`, exactly as
// the task's own Context names. `speculate.exam_at_zero` is left at the
// real default (`true`): `land()` always awaits its own task's exam result
// before dispatching that task's implementers regardless of this flag, so
// leg (c)'s ordering claim holds either way, and exercising the real
// default is the more faithful fixture.
const policyDoc = JSON.parse(fs.readFileSync(path.join(REPO, 'factory', 'policy.json'), 'utf8'))
policyDoc.pairs = { ...(policyDoc.pairs || {}), mode: 'off' }
policyDoc.fold = { ...(policyDoc.fold || {}), reverify: { ...((policyDoc.fold || {}).reverify || {}), enabled: false } }
policyDoc.select = { ...(policyDoc.select || {}), enabled: false }
const policyPath = path.join(tmp, 'policy.json')
fs.writeFileSync(policyPath, JSON.stringify(policyDoc))

// ── the fake-driven rig ──────────────────────────────────────────────────
const dispatchLabels = []
const posts = [] // { taskId, kind, text }

// A fake worker: it records every dispatch's label (the one thing every leg
// below reads to tell an exam dispatch from an implementer one), and, for
// the two roles this run ever dispatches, writes the file content each
// role is trusted to produce — an exam worker writes its task's own proof
// test file(s); an implementer writes its task's own non-proof file(s).
const worker = async (opts) => {
  dispatchLabels.push(opts.label)
  if (opts.role === 'exam') {
    for (const p of opts.files || []) {
      const at = path.join(opts.cwd, p)
      fs.mkdirSync(path.dirname(at), { recursive: true })
      fs.writeFileSync(at, '// exam for task ' + opts.task + '\n')
    }
    return { result: { total_cost_usd: 0, result: 'exam note for task ' + opts.task }, denials: [] }
  }
  if (opts.role === 'implement') {
    for (const p of opts.files || []) {
      const at = path.join(opts.cwd, p)
      fs.mkdirSync(path.dirname(at), { recursive: true })
      fs.writeFileSync(at, 'implemented by task ' + opts.task + '\n')
    }
    return { result: { total_cost_usd: 0, result: 'impl done' }, denials: [] }
  }
  return { result: { total_cost_usd: 0, result: '' }, denials: [] }
}

// A fake judge with only `readCovering` — a spy, so [M1]'s "asks no
// covering reading" is directly observable. No `readTask`/`readLanding`/
// etc: `engine.mjs`'s own `read()` wrapper answers `null` for a name the
// judge does not carry, which is what keeps every candidate at `k = 1`,
// referee-free, and un-redispatched in this fixture (`select.enabled` is
// already `false` above, so `readCovering` would go uncalled for that
// reason alone on any task — see the hand-in note).
const readCoveringCalls = []
const judge = {
  readCovering: async (arg) => { readCoveringCalls.push(arg); return { covered: [] } },
}

// A fake board recording every `post`.
const board = {
  post: async (taskId, kind, text) => { posts.push({ taskId: String(taskId), kind, text }); return null },
  factsFor: async () => '',
  setState: async () => null,
  states: async () => ({}),
  settled: async () => null,
}

// A fake `sh`: every `python3` invocation is the real fold kernel
// (`kernel()` in `engine.mjs` calls `sh('python3', [KERNEL, ...argv], REPO)`
// for `fold`/`materialize`/`resolve`) and runs for real, against the real
// `target` repository `makeRepo` built above, so the two independent,
// single-file patches actually fold and materialize into an adopted commit
// — the shape leg (b) reads. Every other command this file's `sh` seam
// would run is a task's own `testCmd` (`measure()`'s
// `node fleet/tests/test_widget.mjs`), which no candidate's clone actually
// contains (the fake worker above never runs a real test suite); faking
// that command to exit 0 keeps the run's shape (adopt, not park) the same
// without this exam depending on a real Node subprocess finding a real
// test file.
const sh = (cmd, argv = [], cwd, input) => {
  if (cmd === 'python3') {
    return spawnSync(cmd, argv, {
      cwd, input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: simEnv(),
    })
  }
  return { status: 0, stdout: '', stderr: '' }
}

const logs = []
const log = (s) => logs.push(String(s))

const result = await runEngine(
  { plan: planPath, target, runDir, policy: policyPath },
  { worker, judge, board, sh, log },
)

const events = fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line))

// ── (a) [M1] task 1 (proofTests: []) is not sent an examiner ────────────
assert.equal(dispatchLabels.includes('exam:1'), false,
  "(a) [M1] a task with no exam file dispatches no worker labeled 'exam:1'")

const examNotePostsFor1 = posts.filter((p) => p.taskId === '1' && p.kind === 'exam-note')
assert.deepEqual(examNotePostsFor1, [],
  '(a) [M1] a task with no exam file gets no exam-note posted to the board')

assert.equal(readCoveringCalls.length, 0,
  '(a) [M1] a task with no exam file asks no covering reading (readCovering is never called)')

const skippedRows = events.filter((e) => e.kind === 'exam:skipped')
assert.deepEqual(skippedRows, [{ kind: 'exam:skipped', task: '1', reason: 'no exam file' }],
  "(a) [M1] events.jsonl carries exactly one row { kind: 'exam:skipped', task: '1', reason: 'no exam file' }")

// ── (b) [M2] task 1's implementers/landing/adoption run as for any task ──
assert.equal(dispatchLabels.includes('impl:1:0'), true,
  "(b) [M2] task 1's implementer is still dispatched, labeled 'impl:1:0'")

const landingRowsFor1 = events.filter((e) => e.kind === 'landing' && e.task === '1')
assert.equal(landingRowsFor1.length, 1,
  "(b) [M2] task 1's landing is measured and folded like any other task: events.jsonl carries one landing row for it")

assert.equal(result.done, true,
  '(b) [M2] the run resolves the same shape it resolves for any task: done is true')
assert.ok(result.adopted.includes('1'),
  "(b) [M2] task 1 lands in the run's adopted list")

// ── (c) [M3] task 2 (proofTests non-empty) is examined exactly as before ─
const examIndex2 = dispatchLabels.indexOf('exam:2')
const implIndex2 = dispatchLabels.indexOf('impl:2:0')
assert.notEqual(examIndex2, -1, "(c) [M3] task 2 dispatches an examiner, labeled 'exam:2'")
assert.notEqual(implIndex2, -1, "(c) [M3] task 2 dispatches an implementer, labeled 'impl:2:0'")
assert.ok(examIndex2 < implIndex2,
  "(c) [M3] task 2's exam:2 is dispatched strictly before its impl:2:0")

const examNotePostsFor2 = posts.filter((p) => p.taskId === '2' && p.kind === 'exam-note')
assert.equal(examNotePostsFor2.length, 1,
  '(c) [M3] task 2 gets exactly one exam-note posted to the board, as before')

const skippedRowsFor2 = events.filter((e) => e.kind === 'exam:skipped' && e.task === '2')
assert.deepEqual(skippedRowsFor2, [],
  '(c) [M3] task 2 carries no exam:skipped row')

console.log('ALL TESTS PASSED')
