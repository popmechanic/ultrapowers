// fleet/tests/test_run_engine_cap_width.mjs — #547: the divide-by-width cap is
// a legacy-path guard. Per-task `testCmd` (#515, run-51) means an implementer
// with its own command never sees the capped one, so dividing the machine by
// `args.width` over-divides: it counts workers that are not sharing the
// run-wide suite at all. The width is now the number of wave entries that will
// actually run the run-wide command, and a run where every task carries its
// own command is not capped (nor logged) at all.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execSeam } from '../run-main.mjs'
import { cloneAtBase, makeCwdFor, withPatchCapture, defaultTaskIdOf } from '../run-waves.mjs'
import { runEngine, capWorkerParallelism } from '../run-engine.mjs'
import { makeRepo, provision, gitSync, passReview, cleanCritic, doneImpl } from './_engine_helpers.mjs'

void cloneAtBase // (provision uses it; kept in the import list for parity with the rig)

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-capw-'))
const CPUS = os.cpus().length
// The arithmetic legs below distinguish width-1 from width-2 shares, which is
// only observable on a host with at least two cpus.
assert.ok(CPUS >= 2, 'this sim assumes a host with at least 2 cpus (saw ' + CPUS + ')')

// A run-wide command carrying `-n auto` — the only shape capWorkerParallelism
// touches — that the sim repo's check.sh happily ignores.
const RUN_WIDE = 'bash check.sh -n auto'

// The rig from _engine_helpers, plus an injectable `exec` (leg c records every
// shell the driver ran) and per-task fields the sims need.
function rigWithExec ({ repo, runDir, waves, stub, testCmd = RUN_WIDE, stamp = 'cw',
                        extraArgs = {}, exec = execSeam }) {
  const taskIds = waves.flat().map((t) => t.id)
  const { base, clonesDir, patchesDir, integ } = provision({ repo, runDir, taskIds })
  const patchBase = { current: base }
  const cwdFor = makeCwdFor({ clonesDir })
  const inner = async (prompt, opts) => stub(prompt, opts, cwdFor(opts))
  const agent = withPatchCapture({
    agent: inner, clonesDir, base: () => patchBase.current, patchesDir,
    taskIdOf: defaultTaskIdOf,
  })
  const logs = []
  const run = () => runEngine({
    args: {
      waves, edges: [], testCmd, acceptance: { mode: 'suite', reason: 'sim' }, stamp,
      integrationBranch: 'ultra/integration-' + stamp, dependencyEdges: [],
      patchInput: patchesDir, ...extraArgs,
    },
    agent,
    parallel: (thunks) => Promise.all(thunks.map((t) => t())),
    exec,
    paths: { repoDir: repo, runDir, clonesDir },
    log: (l) => logs.push(String(l)),
    patchBase,
  })
  return { run, base, clonesDir, patchesDir, integ, logs, patchBase }
}

const task = (id, extra = {}) => ({
  id, title: 'task ' + id, files: [id + '.txt'], tier: 'standard', review: 'lean',
  writes: [id + '.txt'], commutes: [], body: 'task ' + id, ...extra,
})

// The prompt's TEST COMMAND line. No role file has a line starting with
// `TEST COMMAND: `, so the first match is the engine's own.
const testCommandLine = (prompt) =>
  String(prompt).split('\n').find((l) => l.startsWith('TEST COMMAND: ')) || null

// A stub that records impl prompts and does the minimum to reach a green fold.
const recordingStub = (implPrompts, extraImpl = () => {}) => (prompt, opts, cwd) => {
  const kind = opts.label.split(':')[0]
  if (kind === 'impl') {
    const id = opts.label.split(':')[1]
    implPrompts.set(id, prompt)
    fs.writeFileSync(path.join(cwd, id + '.txt'), 'work by ' + id + '\n')
    extraImpl(id, cwd)
    return doneImpl(cwd)
  }
  if (kind === 'review') return passReview()
  if (opts.label === 'integration') return cleanCritic()
  throw new Error('unexpected label: ' + opts.label)
}

// ── (a) M1: capWorkerParallelism itself is untouched ─────────────────────────
{
  assert.equal(capWorkerParallelism('pytest -n auto', 8, 8), 'pytest -p no:xdist',
    'eight workers on eight cpus get one core each — xdist off')
  assert.equal(capWorkerParallelism('pytest -n auto', 2, 8), 'pytest -n 4',
    'two workers on eight cpus split the machine in half')
}

// ── (b) M2: the width is the count of entries without their own testCmd ──────
{
  const implPrompts = new Map()
  const repo = makeRepo(path.join(tmp, 'rb'))
  const waves = [[
    task('T1', { testCmd: 'bash t1.sh' }),   // its own command — not a sharer
    task('T2', { testCmd: '' }),             // empty string — falls back, a sharer
    task('T3'),                              // no key at all — a sharer
  ]]
  const { run, logs } = rigWithExec({
    repo, runDir: path.join(tmp, 'runb'), waves, stub: recordingStub(implPrompts),
    stamp: 'cwb', extraArgs: { width: 8 },
  })
  const report = await run()
  assert.equal(report.waveMerges[0].status, 'MERGED', JSON.stringify(report.judgmentCalls))

  const sharedTwo = capWorkerParallelism(RUN_WIDE, 2, CPUS)
  assert.equal(testCommandLine(implPrompts.get('T2')), 'TEST COMMAND: ' + sharedTwo,
    'T2 (empty testCmd) runs the run-wide command capped by the two sharers, not by width 8')
  assert.equal(testCommandLine(implPrompts.get('T3')), 'TEST COMMAND: ' + sharedTwo,
    'T3 (no testCmd) runs the same capped command')
  assert.equal(testCommandLine(implPrompts.get('T1')), 'TEST COMMAND: bash t1.sh',
    'T1 keeps its own command verbatim')
  assert.ok(logs.some((l) => l.includes('capped for concurrency') && l.includes(sharedTwo)),
    'the cap is still logged when someone shares the run-wide command: ' + JSON.stringify(logs))

  // Variant: T2 carries a real command too, so only T3 shares — width 1.
  const implPrompts1 = new Map()
  const repo1 = makeRepo(path.join(tmp, 'rb1'))
  const waves1 = [[
    task('T1', { testCmd: 'bash t1.sh' }),
    task('T2', { testCmd: 'bash t2.sh' }),
    task('T3'),
  ]]
  const { run: run1 } = rigWithExec({
    repo: repo1, runDir: path.join(tmp, 'runb1'), waves: waves1,
    stub: recordingStub(implPrompts1), stamp: 'cwb1', extraArgs: { width: 8 },
  })
  const report1 = await run1()
  assert.equal(report1.waveMerges[0].status, 'MERGED', JSON.stringify(report1.judgmentCalls))
  const sharedOne = capWorkerParallelism(RUN_WIDE, 1, CPUS)
  assert.notEqual(sharedOne, sharedTwo,
    'the one-sharer and two-sharer shares differ at ' + CPUS + ' cpus — the leg is observable')
  assert.equal(testCommandLine(implPrompts1.get('T3')), 'TEST COMMAND: ' + sharedOne,
    'the sole sharer gets the whole machine')
}

// ── (c) M3: every task carries its own command → no cap, no log, uncapped
//        reconcile brief and uncapped driver suite runs ─────────────────────
{
  const repo = makeRepo(path.join(tmp, 'rc'))
  const shells = []
  const recordingExec = (cmd, argv, opts) => {
    if (cmd === 'bash' && Array.isArray(argv) && argv[0] === '-lc') shells.push(argv[1])
    return execSeam(cmd, argv, opts)
  }
  let reconcilePrompt = null
  const stub = (prompt, opts, cwd) => {
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') {
      const id = opts.label.split(':')[1]
      fs.writeFileSync(path.join(cwd, id + '.txt'), 'work by ' + id + '\n')
      // T1 also drops the BROKEN marker: the candidate goes red and the
      // reconcile agent is dispatched (the test_run_engine_reconcile shape).
      if (id === 'T1') fs.writeFileSync(path.join(cwd, 'BROKEN'), 'oops\n')
      return doneImpl(cwd)
    }
    if (kind === 'review') return passReview()
    if (kind === 'reconcile') {
      reconcilePrompt = prompt
      fs.rmSync(path.join(cwd, 'BROKEN'))
      return { status: 'FIXED', summary: 'removed the BROKEN marker' }
    }
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected label: ' + opts.label)
  }
  const waves = [[
    task('T1', { testCmd: 'bash t1.sh' }),
    task('T2', { testCmd: 'bash t2.sh' }),
  ]]
  const { run, logs } = rigWithExec({
    repo, runDir: path.join(tmp, 'runc'), waves, stub, stamp: 'cwc',
    extraArgs: { width: 8 }, exec: recordingExec,
  })
  const report = await run()
  assert.equal(report.waveMerges[0].status, 'MERGED', JSON.stringify(report.judgmentCalls))
  assert.equal(logs.filter((l) => l.includes('capped for concurrency')).length, 0,
    'nobody shares the run-wide command, so nothing is capped: ' + JSON.stringify(logs))
  assert.ok(reconcilePrompt, 'the reconcile agent was dispatched')
  assert.equal(testCommandLine(reconcilePrompt), 'TEST COMMAND: ' + RUN_WIDE,
    'the reconcile brief carries the run-wide command verbatim')
  assert.ok(shells.length >= 2, 'the driver ran the suite at least twice (baseline + candidate)')
  assert.deepEqual([...new Set(shells)], [RUN_WIDE],
    'every driver suite run was the run-wide command verbatim: ' + JSON.stringify(shells))
}

// ── (d) M4: no per-task commands → width is the task count (#436 arithmetic) ─
{
  const implPrompts = new Map()
  const repo = makeRepo(path.join(tmp, 'rd'))
  const ids = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8']
  const { run, logs } = rigWithExec({
    repo, runDir: path.join(tmp, 'rund'), waves: [ids.map((id) => task(id))],
    stub: recordingStub(implPrompts), stamp: 'cwd',
  })
  const report = await run()
  assert.equal(report.waveMerges[0].status, 'MERGED', JSON.stringify(report.judgmentCalls))
  const shared = capWorkerParallelism(RUN_WIDE, 8, CPUS)
  const capLines = logs.filter((l) => l.includes('capped for concurrency'))
  assert.equal(capLines.length, 1, JSON.stringify(logs))
  assert.equal(capLines[0], 'run-engine: worker testCmd capped for concurrency (#436) — ' + shared)
  for (const id of ids) {
    assert.equal(testCommandLine(implPrompts.get(id)), 'TEST COMMAND: ' + shared,
      id + ' shares the machine with the other seven')
  }
  // #436's own arithmetic: eight sharers on eight cpus turn xdist off.
  assert.equal(capWorkerParallelism(RUN_WIDE, 8, 8), 'bash check.sh -p no:xdist')
}

fs.rmSync(tmp, { recursive: true, force: true })
console.log('ALL TESTS PASSED')
