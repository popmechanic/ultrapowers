#!/usr/bin/env node
/**
 * fleet/tests/test_factory_reverify.mjs — exam for the fold-verify reflex.
 *
 * Machine (from the task that names this exam):
 *
 *   M1. `factory/reverify.mjs` exports `examsTouched({ folded, touched,
 *       adopted, tasks, cap })`: the adopted tasks that share at least one
 *       file path with `touched` and carry a non-empty string `testCmd`,
 *       the folded task first and the rest in adoption order, capped at
 *       `cap`.
 *   M2. After every fold `factory/engine.mjs` adopts, it takes the folded
 *       patch's touched paths, calls `examsTouched`, and for every task it
 *       answers runs `timeout <policy.fold.reverify.timeout_seconds>
 *       <task.testCmd>` through `sh`, in a clone of the new head — and
 *       appends `{ kind: 'fold:verify', task: <folded>, ran: [{task,
 *       exit}, ...] }`.
 *   M3. A red re-run appends `{ kind: 'fold:red', task, exam, exit }`,
 *       posts `fold-red` to the board, dispatches exactly one implementer
 *       labelled `impl:<folded>:fold`, folds its patch through the same
 *       kernel path and runs the same exams again.
 *   M4. A fold-verify exam still red after that one re-attempt (or a
 *       refold that never completes) appends `{ kind: 'fold:unresolved',
 *       task, exam }`, never buys a second `impl:<folded>:fold`, and
 *       forces the run's resolved `done` to `false` even when every task
 *       is adopted.
 *   M5. With `policy.fold.reverify.enabled` false, none of this runs: no
 *       `timeout` call, no `fold:` event.
 *
 * The rig below is self-contained on purpose (per this repository's own
 * convention, restated in `fleet/tests/test_run_engine_fold_policy.mjs`:
 * a sim never imports another sim's harness — that would report one
 * file's failure under two names). It drives the real `runEngine` from
 * `factory/engine.mjs` over:
 *
 *   - a real git repository (`makeRepo`-style, built with `execFileSync`)
 *   - a real two-task plan compiled by the real `plan_parse.py`, whose
 *     tasks both touch `shared.py` (task 1 creates it, task 2 modifies
 *     it), so a fold of task 2 always touches a path task 1's exam cares
 *     about
 *   - a policy document handed in as `args.policy`, with `select.enabled`
 *     and `landing.redispatch.enabled` both false in every drive (so the
 *     only `timeout` commands recorded are this task's fold-verify ones)
 *     and `fold.reverify` set per leg
 *   - a fake `worker` that writes stub files for the exam/implement roles
 *     `factory/engine.mjs` dispatches
 *   - a fake `sh` that passes real kernel (`fold_wave.py`) invocations
 *     through to a real subprocess, and answers every other command
 *     (including the fold-verify `timeout` calls) from a script, while
 *     recording every `(cmd, argv, cwd)` triple
 *   - a fake `board` recording every `post`
 *   - the real `git` dependency (a real subprocess), since `cloneAtBase`
 *     drives every git operation through it
 *
 * It prints `ALL TESTS PASSED` as its last line when every assertion
 * held.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'

import { runEngine } from '../../factory/engine.mjs'
import { examsTouched } from '../../factory/reverify.mjs'
import { simEnv } from './_helpers.mjs'

const ENV = simEnv()

const gitSync = (argv, cwd) => execFileSync('git', argv, { cwd, encoding: 'utf8', env: ENV }).trim()

// A two-task plan whose tasks both touch `shared.py`: task 1 creates it
// (forcing a `write-after-create` edge, so task 1 always adopts before task
// 2 starts — deterministic ordering with no explicit `depends_on` field),
// task 2 modifies it. A fold of task 2 therefore always touches a path task
// 1's own exam is about, which is exactly the shape M1-M4 are stated over.
const PLAN_TEXT = `# fixture plan

### Task 1: base task

**Type:** implementation

**Files:**
- Create: \`shared.py\`
- Test: \`fleet/tests/test_task1_exam.mjs\`

Machine: M1. shared.py exists.

**Claim:** task one claim text.

**Proof:**
- Test: \`fleet/tests/test_task1_exam.mjs\`

### Task 2: second task

**Type:** implementation

**Files:**
- Modify: \`shared.py\`
- Test: \`fleet/tests/test_task2_exam.mjs\`

Machine: M1. shared.py is extended.

**Claim:** task two claim text.

**Proof:**
- Test: \`fleet/tests/test_task2_exam.mjs\`
`

/** A fresh, real git repository with one commit, plus the plan fixture
 *  next to it. Returns the repo path, its base sha, and the plan path. */
function buildFixture (tmpRoot) {
  const repo = path.join(tmpRoot, 'repo')
  fs.mkdirSync(repo, { recursive: true })
  gitSync(['init', '-q', '-b', 'main'], repo)
  gitSync(['config', 'user.email', 'sim@test'], repo)
  gitSync(['config', 'user.name', 'sim'], repo)
  fs.writeFileSync(path.join(repo, 'README.md'), 'fixture\n')
  gitSync(['add', '-A'], repo)
  gitSync(['commit', '-q', '-m', 'base'], repo)
  const base = gitSync(['rev-parse', 'HEAD'], repo)
  const planPath = path.join(tmpRoot, 'plan.md')
  fs.writeFileSync(planPath, PLAN_TEXT)
  return { repo, base, planPath }
}

/** The policy document handed in as `args.policy`: selection and landing
 *  redispatch off in every drive, so the only `timeout` commands recorded
 *  are this task's fold-verify ones; `fold.reverify` set per leg. */
function writePolicy (tmpRoot, { reverifyEnabled = true, maxRun = 6, timeoutSeconds = 300 } = {}) {
  const policyPath = path.join(tmpRoot, 'policy.json')
  fs.writeFileSync(policyPath, JSON.stringify({
    select: { enabled: false },
    landing: { redispatch: { enabled: false } },
    fold: { reverify: { enabled: reverifyEnabled, max_run: maxRun, timeout_seconds: timeoutSeconds } },
  }))
  return policyPath
}

/** The fake worker: writes the exam's proof file for an `exam` dispatch,
 *  writes/extends `shared.py` for each task's own first `implement`
 *  dispatch, and drops a harmless marker file for any other dispatch
 *  (in particular the fold-fix `impl:<task>:fold` dispatch M3 names —
 *  a non-empty patch is enough for the real kernel to fold). Records
 *  every dispatch's `label`. */
function makeFakeWorker (dispatchLabels) {
  return async (opts) => {
    dispatchLabels.push(opts.label)
    if (opts.role === 'exam') {
      for (const p of opts.files || []) {
        const at = path.join(opts.cwd, p)
        fs.mkdirSync(path.dirname(at), { recursive: true })
        fs.writeFileSync(at, '// exam stub for ' + p + '\n')
      }
    } else if (opts.role === 'implement') {
      if (opts.task === '1' && !opts.label.endsWith(':fold')) {
        fs.writeFileSync(path.join(opts.cwd, 'shared.py'), 'shared v1\n')
      } else if (opts.task === '2' && !opts.label.endsWith(':fold')) {
        fs.appendFileSync(path.join(opts.cwd, 'shared.py'), 'shared v2\n')
      } else {
        fs.writeFileSync(path.join(opts.cwd, 'fold-fix-marker.txt'), 'fix for ' + opts.label + '\n')
      }
    }
    return { result: { result: 'ok ' + opts.label, total_cost_usd: 0 }, denials: [] }
  }
}

/** The fake board: records every `post({task, kind, text})`. */
function makeFakeBoard () {
  const posts = []
  const states = new Map()
  return {
    board: {
      post: async (taskId, kind, text) => { posts.push({ task: String(taskId), kind, text }); return null },
      factsFor: async () => '',
      setState: async (taskId, state) => { states.set(String(taskId), state); return null },
      states: async () => Object.fromEntries(states),
      settled: async () => null,
    },
    posts,
  }
}

/**
 * The fake `sh`: records every `(cmd, argv, cwd)`. A `python3 .../fold_wave.py`
 * call is the real kernel — too complex and too load-bearing to fake — so it
 * is passed straight through to a real subprocess (`env: simEnv()`, never
 * `process.env`). Every `timeout ...` call (M2's fold-verify re-run) is
 * answered from `timeoutExit(marker, occurrence)`, keyed by which task's exam
 * path the call names and a 1-based per-task occurrence count, so a scenario
 * can make the *second* time task 1's exam runs (the sibling check M2/M3
 * triggers on task 2's fold) red while its *first* run (task 1's own
 * post-adoption self-check) and any later run (M3's re-check) stay green.
 * Any other command (in particular the bare `node <test>` a landing's own
 * `measure()` runs before folding) always answers green — this exam is about
 * the fold-verify reflex, not about landing itself.
 */
function makeFakeSh ({ timeoutExit } = {}) {
  const calls = []
  const counts = { task1: 0, task2: 0 }
  const sh = (cmd, argv = [], cwd, input) => {
    calls.push({ cmd, argv: [...argv], cwd })
    if (cmd === 'python3' && String(argv[0] || '').endsWith('fold_wave.py')) {
      return spawnSync(cmd, argv, { cwd, input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: ENV })
    }
    if (cmd === 'timeout') {
      const joined = argv.join(' ')
      let marker = null
      if (joined.includes('test_task1_exam.mjs')) marker = 'task1'
      else if (joined.includes('test_task2_exam.mjs')) marker = 'task2'
      let exit = 0
      if (marker) {
        counts[marker] += 1
        exit = timeoutExit ? timeoutExit(marker, counts[marker]) : 0
      }
      const stdout = exit !== 0
        ? ('exam output for ' + marker + ' occurrence ' + counts[marker] + '\nREDMARK\n')
        : 'ok\n'
      return { status: exit, stdout, stderr: '' }
    }
    return { status: 0, stdout: 'stub[' + cmd + ' ' + argv.join(' ') + ']\n', stderr: '' }
  }
  return { sh, calls }
}

/** The real `git` dependency: `cloneAtBase` (inside `factory/engine.mjs`)
 *  drives every clone/config/checkout/rev-parse through this. */
const gitDep = (argv, cwd) => {
  const r = spawnSync('git', argv, { cwd, encoding: 'utf8', env: ENV, maxBuffer: 64 * 1024 * 1024 })
  if (r.status !== 0) throw new Error('git ' + argv.join(' ') + ': ' + String(r.stderr || r.error || '').slice(0, 500))
  return String(r.stdout || '')
}

/** One full drive of `runEngine` over a fresh fixture. `timeoutExit`
 *  scripts the fold-verify re-run exits (see `makeFakeSh`); `reverifyEnabled`
 *  goes straight into the policy document at `args.policy`. */
async function drive ({ reverifyEnabled = true, timeoutExit } = {}) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-reverify-exam-'))
  const { repo, base, planPath } = buildFixture(tmpRoot)
  const policyPath = writePolicy(tmpRoot, { reverifyEnabled })
  const runDir = path.join(tmpRoot, 'run')
  const dispatchLabels = []
  const worker = makeFakeWorker(dispatchLabels)
  const { board, posts } = makeFakeBoard()
  const { sh, calls } = makeFakeSh({ timeoutExit })
  const answer = await runEngine(
    { plan: planPath, target: repo, base, runDir, policy: policyPath },
    { worker, judge: {}, sh, git: gitDep, board, log: () => {} },
  )
  const events = fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8')
    .split('\n').map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l))
  return { answer, events, calls, posts, dispatchLabels }
}

// ── leg (a): M1, examsTouched as a pure unit ────────────────────────────────

function testLegA_M1 () {
  const tasks = [
    { id: '1', files: ['shared.py'], testCmd: 'node fleet/tests/test_task1_exam.mjs' },
    { id: '2', files: ['shared.py', 'other2.py'], testCmd: 'node fleet/tests/test_task2_exam.mjs' },
    { id: '3', files: ['other.py'], testCmd: 'node fleet/tests/test_task3_exam.mjs' },
    { id: '4', files: ['shared.py'], testCmd: null },
  ]

  const full = examsTouched({ folded: '2', touched: ['shared.py'], adopted: ['1', '2', '3', '4'], tasks, cap: 6 })
  assert.deepEqual(full.map((t) => t.id), ['2', '1'],
    '[M1] examsTouched answers the folded task first, then the tasks sharing a touched path, in adoption order')
  assert.equal(full[0], tasks[1],
    '[M1] the folded task answered is the actual task object out of `tasks`, not a copy')
  assert.equal(full[1], tasks[0],
    '[M1] the sibling answered is the actual task object out of `tasks`, not a copy')
  assert.equal(full.length, 2,
    '[M1] task 3 (no shared path) and task 4 (no testCmd) are excluded')

  const capped = examsTouched({ folded: '2', touched: ['shared.py'], adopted: ['1', '2', '3', '4'], tasks, cap: 1 })
  assert.deepEqual(capped.map((t) => t.id), ['2'],
    '[M1] a cap of 1 answers only the folded task, dropping the sibling')

  console.log('leg (a) [M1] OK')
}

// ── leg (b): M2, the green re-verify after every fold ───────────────────────

async function testLegB_M2 () {
  const { answer, events, calls } = await drive({ reverifyEnabled: true, timeoutExit: () => 0 })
  assert.equal(answer.done, true, 'sanity: a fully green fixture drive resolves done=true')

  const timeoutCalls = calls.filter((c) => c.cmd === 'timeout')
  assert.ok(timeoutCalls.length >= 2,
    '[M2] at least the two commands task 2\'s own adoption must trigger were run through sh with cmd=timeout')
  const afterTask2 = timeoutCalls.slice(-2)
  assert.equal(afterTask2[0].argv.join(' '), '300 node fleet/tests/test_task2_exam.mjs',
    '[M2] after task 2 is adopted, the first fold-verify run is `timeout 300 <task 2\'s own testCmd>`')
  assert.equal(afterTask2[1].argv.join(' '), '300 node fleet/tests/test_task1_exam.mjs',
    '[M2] after task 2 is adopted, the second fold-verify run is `timeout 300 <task 1\'s testCmd>` (the sibling examsTouched answers)')

  const newHead = answer.head
  for (const c of afterTask2) {
    const headOfClone = gitSync(['rev-parse', 'HEAD'], c.cwd)
    assert.equal(headOfClone, newHead,
      '[M2] each fold-verify run happens in a clone whose HEAD is the new (folded) head')
  }

  const verifyEvent = events.find((e) => e.kind === 'fold:verify' && e.task === '2')
  assert.ok(verifyEvent, '[M2] an events.jsonl row of kind fold:verify for the folded task must exist')
  assert.deepEqual(verifyEvent, { kind: 'fold:verify', task: '2', ran: [{ task: '2', exit: 0 }, { task: '1', exit: 0 }] },
    '[M2] the fold:verify row is exactly { kind, task: <folded>, ran: [{task, exit}, ...] }, in the order the exams ran')

  console.log('leg (b) [M2] OK')
}

// ── leg (c): M3, one red re-run buys exactly one fix, which resolves it ────

async function testLegC_M3 () {
  const timeoutExit = (marker, n) => {
    if (marker !== 'task1') return 0
    // occurrence 1: task 1's own post-adoption self-check — stays green so it
    // never confounds this leg's scenario; occurrence 2: the sibling check
    // task 2's fold triggers — red, buying the one fix attempt; occurrence 3+:
    // the re-check after the fix — green again.
    if (n === 2) return 1
    return 0
  }
  const { answer, events, posts, dispatchLabels, calls } = await drive({ reverifyEnabled: true, timeoutExit })

  const redEvent = events.find((e) => e.kind === 'fold:red')
  assert.deepEqual(redEvent, { kind: 'fold:red', task: '2', exam: '1', exit: 1 },
    '[M3] a red fold-verify run appends { kind: fold:red, task: <folded>, exam: <red exam\'s task>, exit }')

  const post = posts.find((p) => p.task === '2' && p.kind === 'fold-red')
  assert.ok(post, '[M3] the board is posted kind=fold-red on the folded task')
  assert.ok(post.text.includes('1'), '[M3] the fold-red post names the red exam\'s task (1)')
  assert.ok(post.text.includes('REDMARK'), '[M3] the fold-red post carries the red run\'s own output')

  const foldDispatches = dispatchLabels.filter((l) => l === 'impl:2:fold')
  assert.equal(foldDispatches.length, 1,
    '[M3] exactly one implementer is dispatched for the fix, labelled impl:<folded task>:fold')

  const task1TimeoutCalls = calls.filter((c) => c.cmd === 'timeout' && c.argv.join(' ').includes('test_task1_exam.mjs'))
  assert.equal(task1TimeoutCalls.length, 3,
    '[M3] task 1\'s exam is run a third time after the fix folds — the same exams, run again')

  assert.equal(answer.done, true,
    '[M3] once the one re-attempt turns the exam green again, the run still resolves done=true')

  console.log('leg (c) [M3] OK')
}

// ── leg (d): M4, still red after the one attempt — unresolved, done=false ──

async function testLegD_M4 () {
  const timeoutExit = (marker, n) => {
    if (marker !== 'task1') return 0
    if (n === 1) return 0 // task 1's own self-check stays green
    return 1 // every sibling check and re-check after that stays red
  }
  const { answer, events, dispatchLabels } = await drive({ reverifyEnabled: true, timeoutExit })

  const foldDispatches = dispatchLabels.filter((l) => l === 'impl:2:fold')
  assert.equal(foldDispatches.length, 1,
    '[M4] still exactly one impl:<folded task>:fold dispatch is bought — never a second attempt')

  const unresolved = events.find((e) => e.kind === 'fold:unresolved')
  assert.deepEqual(unresolved, { kind: 'fold:unresolved', task: '2', exam: '1' },
    '[M4] an exam still red after the one re-attempt appends { kind: fold:unresolved, task: <folded>, exam }')

  assert.equal(answer.done, false,
    '[M4] the run\'s resolved done is forced to false when a fold-verify exam is unresolved')
  assert.deepEqual([...answer.adopted].sort(), ['1', '2'],
    '[M4] every task is still adopted even though the run is unresolved')

  console.log('leg (d) [M4] OK')
}

// ── leg (e): M5, reverify off means none of this runs at all ───────────────

async function testLegE_M5 () {
  const { calls, events } = await drive({ reverifyEnabled: false, timeoutExit: () => 0 })

  const timeoutCalls = calls.filter((c) => c.cmd === 'timeout')
  assert.equal(timeoutCalls.length, 0,
    '[M5] with policy.fold.reverify.enabled=false, sh is never called with cmd=timeout')

  const foldRows = events.filter((e) => String(e.kind || '').startsWith('fold:'))
  assert.deepEqual(foldRows, [],
    '[M5] with policy.fold.reverify.enabled=false, no events.jsonl row of kind fold: is appended')

  console.log('leg (e) [M5] OK')
}

testLegA_M1()
await testLegB_M2()
await testLegC_M3()
await testLegD_M4()
await testLegE_M5()

console.log('ALL TESTS PASSED')
