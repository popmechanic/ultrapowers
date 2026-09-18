/**
 * fleet/tests/test_factory_proofs.mjs — the exam for *a plan's proof commands
 * are run*: a task's `Run:` lines after its exam, and a plan's `Check:` lines
 * on every folded tree.
 *
 * This file is the Proof's `Test: fleet/tests/test_factory_proofs.mjs`,
 * written where the Proof names it. Every relative import is written for THIS
 * directory: `../../` is the repository root, `./` is `fleet/tests/`.
 *
 * The legs, and what each asserts — every assertion below names its leg and
 * the Machine clause it comes from:
 *
 *   (a) [M1] `runLines` over two lines with a fake `sh` answering 1 then 0
 *       calls it twice, the first exactly as `('timeout', ['300', 'bash',
 *       '-lc', <line 1>], cwd, undefined, env)`, in order, and answers
 *       `[{cmd, exit, tail}, {cmd, exit, tail}]` with each `tail` the last
 *       1,500 characters of that line's own output.
 *   (b) [M2] On a rig-driven `runEngine` whose one task has an exam (its
 *       `testCmd`) exiting 0 and one `proofRuns` line exiting 1:
 *       `events.jsonl` carries a `run:line` row naming that line and its
 *       exit, a `landing` board post carries the line's own command and its
 *       output tail, and the dispatch labels beginning `impl:` are exactly
 *       two, the second `impl:<id>:redispatch`; with the line exiting 0
 *       instead, there is exactly one.
 *   (c) [M3] With the plan's `checks` the clause names (`git diff --quiet
 *       $ULTRA_BASE -- frozen/`, not minor; `wc -w x.md`, minor): once the
 *       task adopts, the fake `sh` saw both under `bash -lc` in the fold
 *       check's own clone with `env.ULTRA_BASE` equal to the run's base sha;
 *       with the first exiting 1 there is its `check:line` row (exit 1,
 *       minor false), a `fold:red` row for the folded task, and exactly one
 *       `impl:<id>:fold` dispatch; with only the minor one exiting 1 there is
 *       its own `check:line` row and no `fold:red` row at all.
 *   (d) [M4] `factory/policy.json` parses with `proofs` and `publish`
 *       deep-equal to the clause's two literal objects; on the same rig with
 *       a policy copy whose `proofs.run_lines` is false — and a task carrying
 *       both a failing `proofRuns` line and a failing non-minor check — no
 *       recorded `sh` call carries `-lc` among its arguments and no event's
 *       `kind` is `run:line` or `check:line` (nor, since nothing of the kind
 *       ran, `fold:red`).
 *
 * No `COVERED:` block was handed to this task: every clause above is proved
 * here, none elsewhere.
 *
 * ── what this exam assumes of the code under test ───────────────────────────
 *
 * `factory/engine.mjs`'s own compiler call is today an unconditional, real
 * `spawnSync('python3', [COMPILER, plan])` — never `deps.sh`, and the parser
 * in this checkout does not yet print a task's `proofRuns` or a plan's
 * `checks` at all (a sibling task adds that to the parser). The task's own
 * Context is explicit that this task adds a `deps.compiled` seam — the
 * parser's answer, handed in directly, in place of spawning the parser — and
 * that this exam drives `runEngine` by handing one in with those fields
 * already on it. Every engine-level leg below does exactly that, through
 * `runOnce`'s own `compiled` object — legs (b)-(d) all rely on the
 * `deps.compiled` seam existing.
 *
 * The Context also names `fleet/tests/_engine_helpers.mjs`'s rig as the one to
 * drive `runEngine` with — but that file's `rig()` imports `runEngine` from
 * `fleet/run-engine.mjs`, a wholly different, unrelated module with its own
 * `runEngine`, `agent`/`withPatchCapture` choreography and CLI. Every Machine
 * clause here (`measure`, `postLanding`, `reverifyAfterFold`, `defaultSh`'s own
 * fifth argument) names functions that live in `factory/engine.mjs`, the one
 * this task's own Files list modifies — not in `fleet/run-engine.mjs`, and no
 * existing test drives `factory/engine.mjs`'s `runEngine` at all. So this exam
 * builds its own small rig below rather than reuse `_engine_helpers.mjs`'s:
 * real git repositories and real clones (through `cloneAtBase`, which
 * `factory/engine.mjs` already calls via its own `cloneAt`), a hand-rolled
 * `sh` that records every call and passes it through to a real, hermetic
 * child process — except for the kernel's two `fold_wave.py` subcommands,
 * which it answers itself (`fold` always `{complete:true}`; `materialize`
 * really applies the captured patch with `git apply` onto a scratch clone at
 * `--prev-head` and fetches the result back in, so `head` really moves and a
 * fold-verify clone really sees the folded tree) — a fake `worker` that
 * writes real files into the clone it is given, and a fake `board` that
 * records every `post`. `select.enabled` is forced `false` and `pairs.mode`
 * `off` on every policy copy, exactly as the Context asks.
 *
 * Each engine-level leg gives its task a `testCmd` of `true` — a real exam
 * that always exits 0 — so this exam is never checking the wrong knob: every
 * `short`-landing and `fold:red` effect it asserts comes only from a
 * `proofRuns` line or a `checks` entry, never from the exam itself.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { simEnv } from './_helpers.mjs'
import { runEngine, POLICY_PATH } from '../../factory/engine.mjs'
import { runLines } from '../../factory/proofs.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
void HERE

// ── hermetic environment, and the roots this run makes ──────────────────────

const BASE_ENV = simEnv()
const ROOTS = []
process.on('exit', () => {
  for (const dir of ROOTS) {
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* best-effort */ }
  }
})

/** One git command, its stdout, and a throw on anything else — never
 *  `process.env`: every child this file spawns runs on `BASE_ENV`. */
function gitWrap (argv, cwd) {
  const r = spawnSync('git', argv, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: BASE_ENV })
  if (r.status !== 0) {
    throw new Error('git ' + argv.join(' ') + (cwd ? ' (in ' + cwd + ')' : '') + ': ' +
      String(r.stderr || (r.error && r.error.message) || '').slice(0, 500))
  }
  return String(r.stdout || '')
}

/** A real, tiny git repository this exam owns: `seed.txt` always, `x.md`
 *  (five words) only when a scenario wants the `wc -w x.md` check to pass. */
function makeRepo (dir, { xmd = false } = {}) {
  fs.mkdirSync(dir, { recursive: true })
  gitWrap(['init', '-q', '-b', 'main'], dir)
  gitWrap(['config', 'user.email', 'sim@test'], dir)
  gitWrap(['config', 'user.name', 'sim'], dir)
  fs.writeFileSync(path.join(dir, 'seed.txt'), 'seed\n')
  if (xmd) fs.writeFileSync(path.join(dir, 'x.md'), 'one two three four five\n')
  gitWrap(['add', '-A'], dir)
  gitWrap(['commit', '-q', '-m', 'base'], dir)
  return gitWrap(['rev-parse', 'HEAD'], dir).trim()
}

function writePlan (planPath, taskId) {
  fs.writeFileSync(planPath,
    '### Task ' + taskId + ': sample task\n\n' +
    'Machine: M1. sample clause text.\n\n' +
    'A sample task body. This plan is never read by the real parser: the rig\n' +
    'hands the engine a `deps.compiled` answer directly.\n')
}

/** A real copy of `factory/policy.json`, with `pairs.mode` forced `off` and
 *  `select.enabled` forced `false` (per the task's own Context), and its
 *  `proofs` cell replaced by `proofsOverride`. */
function writePolicy (policyPath, proofsOverride) {
  const base = JSON.parse(fs.readFileSync(POLICY_PATH, 'utf8'))
  const merged = {
    ...base,
    pairs: { ...base.pairs, mode: 'off' },
    select: { ...base.select, enabled: false },
    proofs: proofsOverride,
  }
  fs.writeFileSync(policyPath, JSON.stringify(merged))
  return merged
}

/** The one flag inside a `--patch`/`--prev-head` style kernel argv. */
function argFlag (argv, flag) {
  const i = argv.indexOf(flag)
  return i >= 0 ? argv[i + 1] : undefined
}

/** The kernel's two subcommands `factory/engine.mjs` calls, answered without
 *  the real `skills/ultrapowers/kernel/fold_wave.py`: `fold` always completes
 *  (no conflict this exam ever needs), and `materialize` really applies the
 *  patch it was handed, in a scratch clone at `--prev-head`, and fetches the
 *  resulting commit back into `target` — so `head` really moves and a later
 *  clone of it really carries what the candidate wrote. */
function fakeKernel (argv, target) {
  const sub = argv[0]
  if (sub === 'fold') return { status: 0, stdout: JSON.stringify({ complete: true }) }
  if (sub === 'materialize') {
    const prevHead = argFlag(argv, '--prev-head')
    const patchSpec = String(argFlag(argv, '--patch') || '')
    const eq = patchSpec.indexOf('=')
    const rest = eq >= 0 ? patchSpec.slice(eq + 1) : patchSpec
    const at = rest.lastIndexOf('@')
    const patchFile = at >= 0 ? rest.slice(0, at) : rest
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'proofs-exam-scratch-'))
    ROOTS.push(scratch)
    gitWrap(['clone', '-q', '--local', target, scratch])
    gitWrap(['checkout', '-q', '--detach', prevHead], scratch)
    const hasPatch = fs.existsSync(patchFile) && fs.statSync(patchFile).size > 0
    if (hasPatch) gitWrap(['apply', '--binary', patchFile], scratch)
    gitWrap(['add', '-A'], scratch)
    const staged = gitWrap(['diff', '--cached', '--name-only'], scratch).trim()
    const commitArgv = ['-c', 'user.name=proofs-exam', '-c', 'user.email=proofs-exam@localhost',
      'commit', '-q', '-m', 'materialize']
    if (!staged) commitArgv.push('--allow-empty')
    gitWrap(commitArgv, scratch)
    const sha = gitWrap(['rev-parse', 'HEAD'], scratch).trim()
    gitWrap(['fetch', '-q', scratch, 'HEAD:refs/proofs-exam/mat-' + sha.slice(0, 12)], target)
    return { status: 0, stdout: JSON.stringify({ candidateSha: sha }) }
  }
  return { status: 1, stdout: '', stderr: 'fake kernel: unhandled subcommand ' + String(sub) }
}

/** `deps.sh`: records every call `(cmd, argv, cwd, input, env)`, answers the
 *  kernel's two subcommands itself, and otherwise really spawns the command,
 *  hermetically, merging the caller's own `env` (M2/M3's `ULTRA_BASE`, or a
 *  proof line's) over `BASE_ENV` — never over `process.env`. */
function makeSh ({ target }) {
  const calls = []
  const sh = (cmd, argv = [], cwd, input, env) => {
    calls.push({ cmd, argv: Array.isArray(argv) ? [...argv] : argv, cwd, input, env })
    if (cmd === 'python3' && Array.isArray(argv) && String(argv[0]).includes('fold_wave.py')) {
      return fakeKernel(argv, target)
    }
    const mergedEnv = { ...BASE_ENV, ...(env || {}) }
    return spawnSync(cmd, argv || [], { cwd, input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: mergedEnv })
  }
  return { sh, calls }
}

/** `deps.worker`: never a model. Records every dispatch and, for an
 *  `implement` dispatch, calls `onImplement(cwd, opts)` — a scenario's own
 *  hook for writing real files into the clone it was given. */
function makeWorker (onImplement) {
  const calls = []
  const worker = async (opts) => {
    calls.push({ label: opts.label, role: opts.role, cwd: opts.cwd, task: opts.task })
    if (opts.role === 'implement' && typeof onImplement === 'function') onImplement(opts.cwd, opts)
    return { result: { total_cost_usd: 0.01, result: 'ok' }, denials: [] }
  }
  return { worker, calls }
}

/** `deps.board`: records every `post`; every other method a safe no-op —
 *  exactly the shape `factory/board.mjs`'s own `makeBoard` answers. */
function makeBoard () {
  const posts = []
  const board = {
    post: async (taskId, kind, text) => { posts.push({ task: taskId, kind, text: String(text) }); return null },
    factsFor: async () => '',
    setState: async () => null,
    settled: async () => null,
    states: async () => ({}),
  }
  return { board, posts }
}

/**
 * One `runEngine` drive, over a real one-task plan whose `compiled` answer is
 * handed straight to the engine — this is the `deps.compiled` seam the
 * task's own Context asks for, in place of spawning the real parser (which,
 * in this checkout, prints neither `proofRuns` nor `checks` at all).
 */
async function runOnce ({
  taskId = 'T1', testCmd = 'true', proofRuns = [], files, checks,
  proofsOverride, xmd = false, onImplement,
} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'proofs-exam-run-'))
  ROOTS.push(root)
  const target = path.join(root, 'repo')
  const runDir = path.join(root, 'run')
  const base = makeRepo(target, { xmd })
  const planPath = path.join(root, 'plan.md')
  writePlan(planPath, taskId)
  const policyPath = path.join(root, 'policy.json')
  writePolicy(policyPath, proofsOverride)

  const { sh, calls: shCalls } = makeSh({ target })
  const { worker, calls: workerCalls } = makeWorker(onImplement)
  const { board, posts } = makeBoard()

  const compiled = {
    launch_waves: [[{
      id: taskId, title: 'sample', depends_on: [],
      files: files || ['impl_note.txt'],
      testCmd, proofTests: [], proofRuns,
    }]],
    dag_edges: [],
    pairs: [],
    ...(checks !== undefined ? { checks } : {}),
  }

  const result = await runEngine(
    { plan: planPath, target, runDir, base, policy: policyPath },
    { sh, git: gitWrap, board, worker, compiled, log: () => {} },
  )

  const events = fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8')
    .split('\n').filter(Boolean).map((l) => JSON.parse(l))
  return { result, events, posts, shCalls, workerCalls, target, runDir, base }
}

/** `runOnce`, with a thrown error reworded so a run that never gets past the
 *  engine's own real-parser call (no `deps.compiled` seam yet) or never runs
 *  a proof line/check (M2/M3 absent) reads as exactly that, not a stack
 *  trace this exam's own reader has to decode. */
async function expectScenario (name, run) {
  try {
    return await run()
  } catch (e) {
    throw new Error('[' + name + '] runEngine did not complete the way M2-M4 promise ' +
      '(most likely: no deps.compiled seam, or proofRuns/checks not yet run): ' +
      String((e && e.message) || e))
  }
}

// ══════════════════════════════════════════════════════════════════════════
// (a) [M1] runLines
// ══════════════════════════════════════════════════════════════════════════

async function legA () {
  const calls = []
  const fakeSh = (cmd, argv, cwd, input, env) => {
    calls.push({ cmd, argv, cwd, input, env })
    if (calls.length === 1) return { status: 1, stdout: 'A'.repeat(1600) + 'END1' }
    return { status: 0, stdout: 'ok2\n' }
  }
  const LINE1 = "printf '%s' one | grep -q one"
  const LINE2 = "printf '%s' two | grep -q two"
  const cwd = '/tmp/runlines-exam'
  const env = { FOO: 'bar' }

  const out = await runLines({ lines: [LINE1, LINE2], cwd, sh: fakeSh, env, timeoutSeconds: 300 })

  assert.equal(calls.length, 2, '[M1] runLines calls sh exactly once per line')
  assert.deepEqual(calls[0], { cmd: 'timeout', argv: ['300', 'bash', '-lc', LINE1], cwd, input: undefined, env },
    "[M1] the first line runs as sh('timeout', [String(timeoutSeconds),'bash','-lc',line], cwd, undefined, env)")
  assert.deepEqual(calls[1], { cmd: 'timeout', argv: ['300', 'bash', '-lc', LINE2], cwd, input: undefined, env },
    '[M1] the second line runs the same way, in order, after the first one failed')

  const tail1 = ('A'.repeat(1600) + 'END1').slice(-1500)
  assert.deepEqual(out, [
    { cmd: LINE1, exit: 1, tail: tail1 },
    { cmd: LINE2, exit: 0, tail: 'ok2\n' },
  ], '[M1] runLines answers one {cmd,exit,tail} per line, in order, tail the last 1500 characters of its output')
  assert.ok(out.every((r) => r.tail.length <= 1500), '[M1] every tail is at most 1500 characters')
}

// ══════════════════════════════════════════════════════════════════════════
// (b) [M2] the task's own proofRuns, after its exam
// ══════════════════════════════════════════════════════════════════════════

const PROOFS_ON = {
  run_lines: true, timeout_seconds: 5, n: 0, window: 'none',
  basis: 'judgment', experiment: true, rollback: 'run_lines = false',
}

async function legB () {
  const FAIL_LINE = 'echo FAILLINE; exit 1'
  const r1 = await expectScenario('b1', () => runOnce({
    taskId: 'T1', testCmd: 'true', proofRuns: [FAIL_LINE],
    files: ['impl_note.txt'],
    proofsOverride: PROOFS_ON,
    onImplement: (cwd) => fs.writeFileSync(path.join(cwd, 'impl_note.txt'), 'work\n'),
  }))

  const runLineEv1 = r1.events.find((e) => e.kind === 'run:line' && e.task === 'T1' && e.cmd === FAIL_LINE)
  assert.ok(runLineEv1, '[M2] a failing proofRuns line gets its own run:line event')
  assert.equal(runLineEv1.exit, 1, "[M2] that run:line event carries the line's real exit code")

  const implStarts1 = r1.events.filter((e) => e.kind === 'dispatch:start' && String(e.label || '').startsWith('impl:'))
  assert.equal(implStarts1.length, 2,
    '[M2] a failing proofRuns line makes the landing short exactly as a red exam would — one redispatch, two impl: dispatches')
  assert.ok(implStarts1.some((e) => e.label === 'impl:T1:redispatch'),
    '[M2] the second impl: dispatch is the redispatch, labeled impl:T1:redispatch')

  const landingTexts1 = r1.posts.filter((p) => p.task === 'T1' && p.kind === 'landing').map((p) => p.text)
  assert.ok(landingTexts1.some((t) => t.includes(FAIL_LINE)),
    "[M2] a landing board post carries the failing proof line's own command")
  assert.ok(landingTexts1.some((t) => t.includes('FAILLINE')),
    "[M2] a landing board post carries the failing proof line's own output — its output is in the worker's hands")

  const OK_LINE = 'echo OKLINE; exit 0'
  const r2 = await expectScenario('b2', () => runOnce({
    taskId: 'T1', testCmd: 'true', proofRuns: [OK_LINE],
    files: ['impl_note.txt'],
    proofsOverride: PROOFS_ON,
    onImplement: (cwd) => fs.writeFileSync(path.join(cwd, 'impl_note.txt'), 'work\n'),
  }))
  const runLineEv2 = r2.events.find((e) => e.kind === 'run:line' && e.task === 'T1' && e.cmd === OK_LINE)
  assert.ok(runLineEv2, '[M2] a proofRuns line that exits 0 still gets its own run:line event')
  assert.equal(runLineEv2.exit, 0, '[M2] that event carries exit 0')
  const implStarts2 = r2.events.filter((e) => e.kind === 'dispatch:start' && String(e.label || '').startsWith('impl:'))
  assert.equal(implStarts2.length, 1,
    '[M2] a proofRuns line exiting 0 causes no redispatch — exactly one impl: dispatch')
}

// ══════════════════════════════════════════════════════════════════════════
// (c) [M3] the plan's checks, on the folded tree
// ══════════════════════════════════════════════════════════════════════════

const CHECK_NONMINOR = 'git diff --quiet $ULTRA_BASE -- frozen/'
const CHECK_MINOR = 'wc -w x.md'
const CHECKS = [{ cmd: CHECK_NONMINOR, minor: false }, { cmd: CHECK_MINOR, minor: true }]

function assertBothChecksRanUnderBashLc (r, label) {
  const checkCalls = r.shCalls.filter((c) =>
    c.cmd === 'timeout' && Array.isArray(c.argv) && c.argv[1] === 'bash' && c.argv[2] === '-lc' &&
    (c.argv[3] === CHECK_NONMINOR || c.argv[3] === CHECK_MINOR))
  assert.equal(checkCalls.length, 2, '[M3] (' + label + ") both of the plan's checks ran under bash -lc")
  for (const c of checkCalls) {
    assert.ok(String(c.cwd).includes('fold-verify'),
      '[M3] (' + label + ') a check ran in the fold check\'s own clone')
    assert.equal((c.env || {}).ULTRA_BASE, r.base,
      '[M3] (' + label + ") a check's environment carried ULTRA_BASE equal to the run's base sha")
  }
}

async function legC () {
  // (c1) the non-minor check fails: fold:red, and exactly one impl:<id>:fold.
  const r1 = await expectScenario('c1', () => runOnce({
    taskId: 'T1', testCmd: 'true', proofRuns: [],
    files: ['impl_note.txt', 'frozen/guard.txt'],
    checks: CHECKS,
    xmd: true,
    proofsOverride: PROOFS_ON,
    onImplement: (cwd) => {
      fs.writeFileSync(path.join(cwd, 'impl_note.txt'), 'work\n')
      fs.mkdirSync(path.join(cwd, 'frozen'), { recursive: true })
      fs.writeFileSync(path.join(cwd, 'frozen', 'guard.txt'), 'touched\n')
    },
  }))

  assertBothChecksRanUnderBashLc(r1, 'c1')

  const clNonMinor1 = r1.events.find((e) => e.kind === 'check:line' && e.task === 'T1' && e.cmd === CHECK_NONMINOR)
  assert.ok(clNonMinor1, '[M3] the non-minor check gets its own check:line row')
  assert.equal(clNonMinor1.exit, 1, "[M3] that row carries the check's real, nonzero exit")
  assert.equal(clNonMinor1.minor, false, "[M3] that row carries the check's own minor:false")

  const clMinor1 = r1.events.find((e) => e.kind === 'check:line' && e.task === 'T1' && e.cmd === CHECK_MINOR)
  assert.ok(clMinor1, '[M3] the minor check gets its own check:line row too, even though it passed here')
  assert.equal(clMinor1.exit, 0, '[M3] the minor check passed in this scenario (x.md is present)')
  assert.equal(clMinor1.minor, true, "[M3] that row carries the check's own minor:true")

  assert.ok(r1.events.some((e) => e.kind === 'fold:red' && e.task === 'T1'),
    "[M3] the non-minor check's failure is a fold:red row for the folded task")
  const foldDispatches1 = r1.events.filter((e) => e.kind === 'dispatch:start' && e.label === 'impl:T1:fold')
  assert.equal(foldDispatches1.length, 1,
    "[M3] the non-minor check's failure takes exactly the one re-attempt a red exam takes — one impl:T1:fold dispatch")

  // (c2) only the minor check fails: its own row, and no fold:red at all.
  const r2 = await expectScenario('c2', () => runOnce({
    taskId: 'T1', testCmd: 'true', proofRuns: [],
    files: ['impl_note.txt'],
    checks: CHECKS,
    xmd: false,
    proofsOverride: PROOFS_ON,
    onImplement: (cwd) => fs.writeFileSync(path.join(cwd, 'impl_note.txt'), 'work\n'),
  }))

  assertBothChecksRanUnderBashLc(r2, 'c2')

  const clNonMinor2 = r2.events.find((e) => e.kind === 'check:line' && e.task === 'T1' && e.cmd === CHECK_NONMINOR)
  assert.ok(clNonMinor2, '[M3] the non-minor check still gets its own row when it passes')
  assert.equal(clNonMinor2.exit, 0, '[M3] the non-minor check passed in this scenario (frozen/ was never touched)')

  const clMinor2 = r2.events.find((e) => e.kind === 'check:line' && e.task === 'T1' && e.cmd === CHECK_MINOR)
  assert.ok(clMinor2, '[M3] the minor check gets its own check:line row when it alone fails')
  assert.notEqual(clMinor2.exit, 0, "[M3] that row carries the check's real, nonzero exit (x.md is absent)")
  assert.equal(clMinor2.minor, true, "[M3] that row carries the check's own minor:true")

  assert.ok(!r2.events.some((e) => e.kind === 'fold:red' && e.task === 'T1'),
    "[M3] a minor check's failure alone is recorded and nothing more — no fold:red row")
}

// ══════════════════════════════════════════════════════════════════════════
// (d) [M4] the policy document, and the switch
// ══════════════════════════════════════════════════════════════════════════

const EXPECTED_PROOFS = {
  run_lines: true,
  timeout_seconds: 300,
  n: 0,
  window: 'none',
  basis: 'judgment',
  experiment: true,
  rollback: 'run_lines = false',
}

const EXPECTED_PUBLISH = {
  self_merge: {
    enabled: true,
    max_refolds: 3,
    mergeable_wait_seconds: 120,
    n: 0,
    window: 'none',
    basis: 'judgment',
    experiment: true,
    rollback: 'enabled = false',
  },
}

function legD1 () {
  const doc = JSON.parse(fs.readFileSync(POLICY_PATH, 'utf8'))
  assert.deepEqual(doc.proofs, EXPECTED_PROOFS,
    "[M4] factory/policy.json's proofs is deep-equal to the clause's literal object")
  assert.deepEqual(doc.publish, EXPECTED_PUBLISH,
    "[M4] factory/policy.json's publish is deep-equal to the clause's literal object")
}

async function legD2 () {
  const proofsOff = { ...EXPECTED_PROOFS, run_lines: false }
  // Both a failing proofRuns line and a failing non-minor check: if the
  // switch did not actually gate anything, this scenario would show every
  // effect legs (b) and (c) look for. It must show none of them.
  const r = await expectScenario('d2', () => runOnce({
    taskId: 'T1', testCmd: 'true', proofRuns: ['exit 1'],
    files: ['impl_note.txt', 'frozen/guard.txt'],
    checks: CHECKS,
    xmd: true,
    proofsOverride: proofsOff,
    onImplement: (cwd) => {
      fs.writeFileSync(path.join(cwd, 'impl_note.txt'), 'work\n')
      fs.mkdirSync(path.join(cwd, 'frozen'), { recursive: true })
      fs.writeFileSync(path.join(cwd, 'frozen', 'guard.txt'), 'touched\n')
    },
  }))

  assert.ok(!r.shCalls.some((c) => Array.isArray(c.argv) && c.argv.includes('-lc')),
    '[M4] with proofs.run_lines false, no recorded sh call has -lc among its arguments — no proof line, no check, ran')
  assert.ok(!r.events.some((e) => e.kind === 'run:line' || e.kind === 'check:line'),
    '[M4] with proofs.run_lines false, no event is kind run:line or check:line')
  assert.ok(!r.events.some((e) => e.kind === 'fold:red' && e.task === 'T1'),
    '[M4] with the switch off nothing of the kind runs — the non-minor check never fires a fold:red row either')
}

// ══════════════════════════════════════════════════════════════════════════

async function main () {
  await legA()
  await legB()
  await legC()
  legD1()
  await legD2()
  console.log('ALL TESTS PASSED')
}

main().catch((e) => {
  console.error(e && e.stack ? e.stack : e)
  process.exitCode = 1
})
