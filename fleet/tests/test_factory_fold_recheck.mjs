#!/usr/bin/env node
// fleet/tests/test_factory_fold_recheck.mjs
//
// Exam for the task "The fold check's second pass runs the checks too, a
// check still red ends the run not-done, and both passes are numbered rows"
// (factory/engine.mjs's `reverifyAfterFold`, Machine M1-M3).
//
// No test on the tree drives `factory/engine.mjs`, and `_engine_helpers.mjs`
// drives a different, older module, so this file builds its own small rig:
// a real one-commit git repository for `target`, a real `git`, a `sh` that
// passes every command but the kernel's through to a real child process
// under `simEnv()`, a hand-rolled fake of the kernel's `fold`/`materialize`
// (`skills/ultrapowers/kernel/fold_wave.py`, invoked by `factory/engine.mjs`
// as `sh('env', ['python3', KERNEL, ...argv], REPO)`), and a `worker` that
// writes real files instead of running a model.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'

import { runEngine, POLICY_PATH } from '../../factory/engine.mjs'
import { simEnv } from './_helpers.mjs'

// One shared, hermetic environment for every real child process this rig
// starts (git, bash, timeout, true, test) -- never `process.env`.
const SIM_ENV = simEnv()

function runGit (argv, cwd) {
  const r = spawnSync('git', argv, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: SIM_ENV })
  if (r.status !== 0) {
    throw new Error('git ' + argv.join(' ') + ' (in ' + cwd + '): ' + String(r.stderr || r.error || '').slice(0, 500))
  }
  return String(r.stdout || '')
}

/** A real tiny git repository, one commit, for `target`; `base` is its HEAD. */
function makeTarget () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fold-recheck-target-'))
  runGit(['init', '-q'], dir)
  runGit(['config', 'user.email', 'a@example.com'], dir)
  runGit(['config', 'user.name', 'Fold Recheck'], dir)
  fs.writeFileSync(path.join(dir, 'README.md'), 'seed\n')
  runGit(['add', '-A'], dir)
  runGit(['commit', '-q', '-m', 'init'], dir)
  const base = runGit(['rev-parse', 'HEAD'], dir).trim()
  return { dir, base }
}

/**
 * The kernel's own two calls, faked: `fold` always answers `complete: true`
 * (no scenario here needs the resolver), and `materialize` really clones
 * `target` at `--prev-head`, applies the patch named in `--patch`
 * (`<id>=<patchfile>@<anchor>`, skipping an empty patch file) with
 * `git apply --binary`, commits (`--allow-empty`, so an empty patch still
 * lands a commit), and fetches that commit back into `target` -- so
 * `factory/engine.mjs`'s own `git reset --hard` onto the answered
 * `candidateSha`, and every later `cloneAt`, see a real, ordinary commit.
 */
function makeKernelFake ({ targetDir, runDir }) {
  let n = 0
  return (argv) => {
    const kernelIdx = argv.findIndex((a) => typeof a === 'string' && a.endsWith('fold_wave.py'))
    const subcommand = argv[kernelIdx + 1]
    if (subcommand === 'fold') {
      return { status: 0, stdout: JSON.stringify({ complete: true }) }
    }
    if (subcommand === 'materialize') {
      const prevHead = argv[argv.indexOf('--prev-head') + 1]
      const patchArg = argv[argv.indexOf('--patch') + 1]
      const eq = patchArg.indexOf('=')
      const rest = patchArg.slice(eq + 1)
      const at = rest.lastIndexOf('@')
      const patchFile = rest.slice(0, at)

      n += 1
      const scratch = path.join(runDir, 'kernel-scratch-' + n)
      runGit(['clone', '--quiet', '--no-checkout', '--local', targetDir, scratch])
      runGit(['checkout', '--quiet', '--detach', prevHead], scratch)
      runGit(['config', 'user.email', 'a@example.com'], scratch)
      runGit(['config', 'user.name', 'Fold Recheck'], scratch)

      let hasPatch = false
      try { hasPatch = fs.statSync(patchFile).size > 0 } catch { hasPatch = false }
      if (hasPatch) runGit(['apply', '--binary', patchFile], scratch)

      runGit(['add', '-A'], scratch)
      runGit(['commit', '-q', '--allow-empty', '-m', 'candidate'], scratch)
      const sha = runGit(['rev-parse', 'HEAD'], scratch).trim()
      runGit(['fetch', '--quiet', scratch, sha], targetDir)
      return { status: 0, stdout: JSON.stringify({ candidateSha: sha }) }
    }
    return { status: 1, stdout: '', stderr: 'unexpected kernel subcommand: ' + subcommand }
  }
}

/**
 * `sh`: records every call into the shared, ordered `callLog` (so the exam
 * can read back where the check's own `bash -lc` calls fall relative to the
 * `impl:T1:fold` dispatch), fakes the kernel, and otherwise runs the command
 * for real under `simEnv()` -- never `process.env`.
 */
function makeSh ({ targetDir, runDir, callLog }) {
  const kernel = makeKernelFake({ targetDir, runDir })
  return (cmd, argv = [], cwd, input, env) => {
    callLog.push({ kind: 'sh', cmd, argv: [...argv] })
    const isKernel = argv.some((a) => typeof a === 'string' && a.endsWith('fold_wave.py'))
    if (isKernel) return kernel(argv)
    return spawnSync(cmd, argv, {
      cwd, input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
      env: { ...SIM_ENV, ...(env || {}) },
    })
  }
}

/**
 * `worker`: never a model. Writes `impl_note.txt` into `opts.cwd` on every
 * `role: 'implement'` dispatch, so the task always has a patch to fold, and
 * -- only when `writeFixedOnFold` is on -- `fixed.txt` too, but only on the
 * one dispatch whose label ends `:fold` (the fold check's own re-attempt).
 */
function makeWorker ({ writeFixedOnFold, callLog }) {
  return async (opts) => {
    callLog.push({ kind: 'dispatch', label: opts.label, role: opts.role })
    if (opts.role === 'implement') {
      fs.writeFileSync(path.join(opts.cwd, 'impl_note.txt'), 'noted\n')
      if (writeFixedOnFold && String(opts.label).endsWith(':fold')) {
        fs.writeFileSync(path.join(opts.cwd, 'fixed.txt'), 'fixed\n')
      }
    }
    return { result: { total_cost_usd: 0.01, result: 'ok' }, denials: [] }
  }
}

const makeBoardFake = () => ({
  post: async () => null,
  factsFor: async () => '',
  setState: async () => null,
  settled: async () => null,
  states: async () => ({}),
})

function makePlan (runDir) {
  const planPath = path.join(runDir, 'plan.md')
  fs.writeFileSync(planPath, '### Task T1: sample\n\nMachine: M1. sample clause.\n\n')
  return planPath
}

function makePolicy (runDir) {
  const doc = JSON.parse(fs.readFileSync(POLICY_PATH, 'utf8'))
  doc.pairs = { ...(doc.pairs || {}), mode: 'off' }
  doc.select = { ...(doc.select || {}), enabled: false }
  const policyPath = path.join(runDir, 'policy.json')
  fs.writeFileSync(policyPath, JSON.stringify(doc))
  return policyPath
}

function compiledFor (checks) {
  return {
    launch_waves: [[{
      id: 'T1', title: 'sample', depends_on: [], files: ['impl_note.txt'],
      testCmd: 'true', proofTests: [], proofRuns: [],
    }]],
    dag_edges: [],
    pairs: [],
    checks,
  }
}

/** One full `runEngine` invocation, its own target repo and run directory,
 *  its own ordered log of `sh` calls and worker dispatches, and its own read
 *  of `events.jsonl`. */
async function runOnce ({ checks, writeFixedOnFold }) {
  const { dir: targetDir, base } = makeTarget()
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fold-recheck-run-'))
  const planPath = makePlan(runDir)
  const policyPath = makePolicy(runDir)
  const callLog = []
  const sh = makeSh({ targetDir, runDir, callLog })
  const worker = makeWorker({ writeFixedOnFold, callLog })

  const result = await runEngine({
    plan: planPath, target: targetDir, runDir, base, policy: policyPath,
  }, {
    sh, git: runGit, board: makeBoardFake(), worker, compiled: compiledFor(checks), log: () => {},
  })

  const rows = fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8')
    .split('\n').filter(Boolean).map((l) => JSON.parse(l))

  return { result, rows, callLog }
}

async function main () {
  // (a) [M1]: a blocking check that exits 1 both before and after the one
  // impl:T1:fold re-attempt -- the worker never writes fixed.txt.
  const a = await runOnce({
    checks: [{ cmd: 'test -f fixed.txt', minor: false }],
    writeFixedOnFold: false,
  })

  const foldDispatchIndexA = a.callLog.findIndex((e) => e.kind === 'dispatch' && e.label === 'impl:T1:fold')
  assert.notEqual(foldDispatchIndexA, -1,
    '[M1] a still-red fold check must buy exactly one impl:T1:fold re-attempt')

  const checkCallsA = a.callLog
    .map((e, i) => ({ ...e, i }))
    .filter((e) => e.kind === 'sh' && e.argv.includes('-lc') && e.argv.includes('test -f fixed.txt'))
  assert.ok(checkCallsA.some((e) => e.i < foldDispatchIndexA),
    '[M1] the check must run under bash -lc once before the impl:T1:fold dispatch')
  assert.ok(checkCallsA.some((e) => e.i > foldDispatchIndexA),
    '[M1] the check must run under bash -lc again after the impl:T1:fold dispatch -- the second pass runs it too')

  const unresolvedA = a.rows.find((r) =>
    r.kind === 'fold:unresolved' && r.cmd === 'test -f fixed.txt' && r.exam === null)
  assert.ok(unresolvedA,
    '[M1] events.jsonl must carry a fold:unresolved row for the still-red check, cmd exactly its command, exam exactly null')
  assert.equal(a.result.done, false,
    '[M1] a run whose checks are still red after the one repair must not answer done: true')

  // (b) [M2]: the impl:T1:fold re-attempt makes the check exit 0.
  const b = await runOnce({
    checks: [{ cmd: 'test -f fixed.txt', minor: false }],
    writeFixedOnFold: true,
  })
  const unresolvedB = b.rows.find((r) => r.kind === 'fold:unresolved')
  assert.equal(unresolvedB, undefined,
    '[M2] no fold:unresolved row when the re-attempt makes the check go green')
  assert.equal(b.result.done, true,
    '[M2] a run whose repaired check goes green must answer done: true')

  // (c) [M3]: in both runs above, the fold check's two passes are their own
  // numbered fold:verify rows, attempt 1 then attempt 2, each carrying `ran`.
  for (const [label, run] of [['A (M1, still red)', a], ['B (M2, repaired)', b]]) {
    const verifyRows = run.rows.filter((r) => r.kind === 'fold:verify' && r.task === 'T1')
    assert.equal(verifyRows.length, 2,
      '[M3] run ' + label + ': exactly two fold:verify rows for task T1 (one per pass)')
    assert.deepEqual(verifyRows.map((r) => r.attempt), [1, 2],
      '[M3] run ' + label + ': the fold:verify rows carry attempt 1 then attempt 2, in that order')
    for (const row of verifyRows) {
      assert.ok(Array.isArray(row.ran),
        '[M3] run ' + label + ': each fold:verify row carries an array `ran`')
    }
  }

  // (c) [M3], continued: a fold check green on its first pass writes exactly
  // one fold:verify row, attempt 1, and never buys the impl:T1:fold
  // re-attempt.
  const c = await runOnce({
    checks: [{ cmd: 'true', minor: false }],
    writeFixedOnFold: false,
  })
  const verifyRowsC = c.rows.filter((r) => r.kind === 'fold:verify' && r.task === 'T1')
  assert.equal(verifyRowsC.length, 1,
    '[M3] a fold check green on its first pass writes exactly one fold:verify row')
  assert.equal(verifyRowsC[0] && verifyRowsC[0].attempt, 1,
    '[M3] that one row carries attempt exactly 1')
  const foldDispatchIndexC = c.callLog.findIndex((e) => e.kind === 'dispatch' && e.label === 'impl:T1:fold')
  assert.equal(foldDispatchIndexC, -1,
    '[M3] a green first pass never dispatches an impl:T1:fold re-attempt')

  console.log('ALL TESTS PASSED')
  process.exit(0)
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err))
  process.exit(1)
})
