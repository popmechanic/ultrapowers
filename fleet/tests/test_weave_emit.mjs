// fleet/tests/test_weave_emit.mjs — the engine's Tier-1 weave leg: after EVERY
// wave adoption, `emit-weave` runs with the head that was actually adopted, and
// its refusal is a judgment-call note rather than a wave status (spec
// 2026-09-01 §2.1, plan task 3).
//
// Same seams as test_run_engine.mjs — real git, real clones, real capture, real
// kernel below the agent stub — plus ONE more: the exec seam is wrapped so the
// kernel argv sequence is recorded, and (scenario 2) `emit-weave` alone is
// answered with a canned exit 2 instead of running. Nothing else is stubbed:
// fold, resolve and materialize are the real subcommands throughout.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execSeam } from '../run-main.mjs'
import { cloneAtBase, makeCwdFor, withPatchCapture, defaultTaskIdOf } from '../run-waves.mjs'
import { runEngine, parseCliJson } from '../run-engine.mjs'
import { makeRepo, gitSync, passReview, cleanCritic, doneImpl } from './_engine_helpers.mjs'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-weave-'))

// _engine_helpers' rig fixes `exec: execSeam`; this variant threads an exec of
// the caller's choosing through the same provisioning so the kernel argv can be
// observed. Everything else is that rig, verbatim.
function weaveRig({ repo, runDir, waves, stub, exec, testCmd = 'bash check.sh', stamp = 'weave' }) {
  const clonesDir = path.join(runDir, 'clones')
  const patchesDir = path.join(runDir, 'patches')
  fs.mkdirSync(patchesDir, { recursive: true })
  const base = gitSync(['rev-parse', 'HEAD'], repo)
  cloneAtBase({ repo, dest: path.join(clonesDir, 'integration'), base })
  for (const t of waves.flat()) cloneAtBase({ repo, dest: path.join(clonesDir, 'task-' + t.id), base })
  const integ = path.join(clonesDir, 'integration')
  const patchBase = { current: base }
  const cwdFor = makeCwdFor({ clonesDir })
  const agent = withPatchCapture({
    agent: async (prompt, opts) => stub(prompt, opts, cwdFor(opts)),
    clonesDir, base: () => patchBase.current, patchesDir, taskIdOf: defaultTaskIdOf,
  })
  const run = () => runEngine({
    args: {
      waves, edges: [], testCmd, acceptance: { mode: 'suite', reason: 'sim' }, stamp,
      integrationBranch: 'ultra/integration-' + stamp, dependencyEdges: [], patchInput: patchesDir,
    },
    agent,
    parallel: (thunks) => Promise.all(thunks.map((t) => t())),
    exec,
    paths: { repoDir: repo, runDir, clonesDir },
    log: () => {},
    patchBase,
  })
  return { run, base, integ, patchesDir }
}

// Records every fold-kernel invocation's subcommand argv, and lets a caller
// answer one of them without running it.
function kernelRecorder(canned = () => null) {
  const calls = []
  const exec = async (cmd, argv, opts) => {
    if (cmd === 'python3' && String(argv[0]).endsWith('fold_wave.py')) {
      const sub = argv.slice(1)
      calls.push(sub)
      const reply = canned(sub)
      if (reply) return { code: reply.code, stdout: reply.stdout || '', stderr: reply.stderr || '' }
    }
    return execSeam(cmd, argv, opts)
  }
  return { calls, exec }
}

const subcommands = (calls) => calls.map((c) => c[0])
const emitCalls = (calls) => calls.filter((c) => c[0] === 'emit-weave')

const waveOf = (id, extra = {}) => ({
  id, title: 'task ' + id, files: [id + '.txt'], tier: 'standard', review: 'lean',
  writes: [id + '.txt'], commutes: [], body: 'sim task ' + id, ...extra,
})

// ── 1. two green waves: one emit-weave per adoption, argv exact ─────────────
{
  const repo = makeRepo(path.join(tmp, 'r1'))
  const runDir = path.join(tmp, 'run1')
  const waves = [[waveOf('T1')], [waveOf('T2')]]
  const stub = (prompt, opts, cwd) => {
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') {
      fs.writeFileSync(path.join(cwd, opts.label.split(':')[1] + '.txt'), 'work\n')
      return doneImpl(cwd)
    }
    if (kind === 'review') return passReview()
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { calls, exec } = kernelRecorder()
  const { run } = weaveRig({ repo, runDir, waves, stub, exec, stamp: 'wv1' })
  const report = await run()

  assert.equal(report.waveMerges.length, 2)
  assert.ok(report.waveMerges.every((m) => m.status === 'MERGED'), JSON.stringify(report.judgmentCalls))
  const [head1, head2] = report.waveMerges.map((m) => m.headSha)

  // Exact argv, both waves, in adoption order.
  assert.deepEqual(emitCalls(calls), [
    ['emit-weave', '--repo', '.', '--run-dir', runDir, '--wave', '1', '--adopt-head', head1],
    ['emit-weave', '--repo', '.', '--run-dir', runDir, '--wave', '2', '--adopt-head', head2],
  ])
  // And each one ran AFTER its own wave's materialize — emit-weave is the
  // adopt leg's last kernel call, not something the fold does.
  assert.deepEqual(subcommands(calls),
    ['fold', 'materialize', 'emit-weave', 'fold', 'materialize', 'emit-weave'])

  // The emitted weave is real: the manifest names the wave that was adopted
  // last, and no weave record ever entered the fold log.
  const manifest = JSON.parse(fs.readFileSync(path.join(runDir, 'frontier', 'weave', 'manifest.json'), 'utf8'))
  assert.equal(manifest.wave, 2)
  const foldLog = fs.readFileSync(path.join(runDir, 'frontier', 'wave-1', 'fold_log.jsonl'), 'utf8')
  assert.deepEqual([...new Set(foldLog.trim().split('\n').map((l) => JSON.parse(l).type))].sort(),
    ['base', 'fold'])
  assert.deepEqual(report.judgmentCalls.filter((j) => j.includes('emit-weave')), [])
}

// ── 2. emit-weave exits 2: the run completes, the wave still MERGED ─────────
{
  const repo = makeRepo(path.join(tmp, 'r2'))
  const runDir = path.join(tmp, 'run2')
  const waves = [[waveOf('T1')]]
  const stub = (prompt, opts, cwd) => {
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') { fs.writeFileSync(path.join(cwd, 'T1.txt'), 'work\n'); return doneImpl(cwd) }
    if (kind === 'review') return passReview()
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { calls, exec } = kernelRecorder((sub) =>
    sub[0] === 'emit-weave' ? { code: 2, stderr: 'emit-weave: refused\n' } : null)
  const { run, integ } = weaveRig({ repo, runDir, waves, stub, exec, stamp: 'wv2' })
  const report = await run()

  assert.equal(emitCalls(calls).length, 1, 'emit-weave was attempted')
  assert.equal(report.waveMerges[0].status, 'MERGED', JSON.stringify(report.judgmentCalls))
  assert.equal(report.tests.passed, true)
  assert.equal(report.coverage.complete, true)
  assert.deepEqual(report.blockedWaves, [])
  // Exactly one note, and it says what was skipped and what was not.
  assert.deepEqual(report.judgmentCalls.filter((j) => j.includes('emit-weave')),
    ['wave 1: emit-weave failed (exit 2) — weave persistence skipped, fold unaffected'])
  // The refusal cost the weave dir and nothing else: the branch still moved.
  assert.equal(gitSync(['rev-parse', 'ultra/integration-wv2'], integ), report.waveMerges[0].headSha)
  assert.equal(fs.existsSync(path.join(runDir, 'frontier', 'weave')), false)
}

// ── 3. TEST_FAILED wave: nothing was adopted, so nothing is emitted ─────────
{
  const repo = makeRepo(path.join(tmp, 'r3'))
  const runDir = path.join(tmp, 'run3')
  const waves = [[waveOf('T1')]]
  const stub = (prompt, opts, cwd) => {
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') {
      fs.writeFileSync(path.join(cwd, 'T1.txt'), 'work\n')
      fs.writeFileSync(path.join(cwd, 'BROKEN'), 'oops\n')   // check.sh goes red
      return doneImpl(cwd)
    }
    if (kind === 'review') return passReview()
    if (kind === 'reconcile') return { status: 'BLOCKED', summary: 'declined' }
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { calls, exec } = kernelRecorder()
  const { run, base, integ } = weaveRig({ repo, runDir, waves, stub, exec, stamp: 'wv3' })
  const report = await run()

  assert.equal(report.waveMerges[0].status, 'TEST_FAILED', JSON.stringify(report.waveMerges[0]))
  assert.deepEqual(emitCalls(calls), [], 'a wave that was never adopted emits no weave')
  assert.deepEqual(subcommands(calls), ['fold', 'materialize'])
  assert.equal(gitSync(['rev-parse', 'HEAD'], integ), base, 'prevHead restored')
  assert.equal(fs.existsSync(path.join(runDir, 'frontier', 'weave')), false)
}

// ── 4. adoption via the RECONCILE leg: the head emitted is the one adopted ──
// The green-first site (scenarios 1-2) hands `emit-weave` the materialize
// candidate; this site hands it the post-reconcile HEAD, and the two differ by
// the fix commit. Getting the variable wrong here is invisible in the argv
// alone, so the manifest is checked too: the reconcile deleted a folded path,
// which is `superseded` against the adopted head and would have been `emitted`
// against the candidate.
{
  const repo = makeRepo(path.join(tmp, 'r4'))
  const runDir = path.join(tmp, 'run4')
  const waves = [[waveOf('T1')]]
  let reconciled = false
  const stub = (prompt, opts, cwd) => {
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') {
      fs.writeFileSync(path.join(cwd, 'T1.txt'), 'useful work\n')
      fs.writeFileSync(path.join(cwd, 'BROKEN'), 'oops\n')   // check.sh goes red
      return doneImpl(cwd)
    }
    if (kind === 'review') return passReview()
    if (kind === 'reconcile') {
      reconciled = true
      fs.rmSync(path.join(cwd, 'BROKEN'))                     // driver commits
      return { status: 'FIXED', summary: 'removed the BROKEN marker' }
    }
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { calls, exec: recorded } = kernelRecorder()
  // The candidate sha is the kernel's own reply to materialize — read it off
  // the wire rather than recomputing it, so the comparison below is against
  // the sha the engine actually held.
  let candidate = null
  const exec = async (cmd, argv, opts) => {
    const r = await recorded(cmd, argv, opts)
    if (cmd === 'python3' && String(argv[0]).endsWith('fold_wave.py') && argv[1] === 'materialize') {
      const parsed = parseCliJson(r.stdout)
      if (parsed && parsed.candidateSha) candidate = parsed.candidateSha
    }
    return r
  }
  const { run, integ } = weaveRig({ repo, runDir, waves, stub, exec, stamp: 'wv4' })
  const report = await run()

  assert.ok(reconciled, 'the reconcile agent was dispatched')
  assert.equal(report.waveMerges[0].status, 'MERGED', JSON.stringify(report.judgmentCalls))
  assert.ok(report.judgmentCalls.some((j) => j.includes('adopted after reconcile')))
  const headSha = report.waveMerges[0].headSha
  assert.ok(candidate, 'materialize named a candidate')
  assert.notEqual(headSha, candidate, 'the reconcile commit moved the head off the candidate')
  assert.equal(gitSync(['rev-parse', 'ultra/integration-wv4'], integ), headSha)

  // One emit-weave, last, carrying the ADOPTED head — not the candidate.
  assert.deepEqual(subcommands(calls), ['fold', 'materialize', 'emit-weave'])
  assert.deepEqual(emitCalls(calls), [
    ['emit-weave', '--repo', '.', '--run-dir', runDir, '--wave', '1', '--adopt-head', headSha],
  ])

  // The seeding is live against the adopted tree: T1.txt survived the
  // reconcile untouched and is seeded; BROKEN did not survive it, so it is
  // superseded and absent from the manifest. (Against `candidate` BROKEN
  // would have been emitted — a seed for a path the wave did not adopt.)
  const weaveDir = path.join(runDir, 'frontier', 'weave')
  const manifest = JSON.parse(fs.readFileSync(path.join(weaveDir, 'manifest.json'), 'utf8'))
  assert.equal(manifest.wave, 1)
  assert.deepEqual(Object.keys(manifest.entries), ['T1.txt'])
  assert.equal(manifest.entries['T1.txt'].visibleSha,
    gitSync(['rev-parse', headSha + ':T1.txt'], integ))
  const events = fs.readFileSync(path.join(weaveDir, 'weave-events.jsonl'), 'utf8')
    .trim().split('\n').map((l) => JSON.parse(l))
  assert.deepEqual(events.filter((e) => e.event === 'superseded').map((e) => e.path), ['BROKEN'])
  assert.deepEqual(report.judgmentCalls.filter((j) => j.includes('emit-weave')), [])

  // Still three event types in the log, and no weave record among them.
  const foldLog = fs.readFileSync(path.join(runDir, 'frontier', 'wave-1', 'fold_log.jsonl'), 'utf8')
  assert.ok(foldLog.trim().split('\n').every((l) => ['base', 'fold', 'resolve'].includes(JSON.parse(l).type)))
}

fs.rmSync(tmp, { recursive: true, force: true })
console.log('ALL TESTS PASSED')
