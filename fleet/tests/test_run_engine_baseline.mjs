// fleet/tests/test_run_engine_baseline.mjs — #862: the baseline runs FIRST, on
// a clone of its own, exactly once per run.
//
// The claim: every run reads BASE's own verdict — the suite is started in Setup,
// in `<runDir>/clones/baseline`, and never in the integration clone; it runs
// once per run whatever the waves do; a green BASE leaves the wave's reconcile /
// `MERGED` / `TEST_FAILED` choreography exactly as it was; and a red BASE parks
// the run with no reconcile dispatched at a red the run inherited.
//
// (This file was #712's lazy-baseline sim. #862 widened the shape — read the
// baseline first rather than buy it only when a candidate is red — so the legs
// that counted BASE's tree among the INTEGRATION clone's executions now assert
// the opposite: the integration clone never runs the suite on BASE's tree at
// all. The instrument is unchanged, which is the point of keeping it.)
//
// Every leg below is its own `rig()` run over a repo whose `check.sh` appends
// `$PWD` and `$(git write-tree)` to an absolute log under the sim's temp dir on
// every execution, then exits by the BROKEN rule. `git write-tree` names the
// INDEX's tree — the candidate's after the driver's `read-tree`, BASE's in the
// baseline clone, the reconciled commit's after the driver's commit — so a
// logged line says WHICH tree ran without the exam knowing how the driver
// arranged it. Counts are taken per directory: the "integration lines" are the
// ones whose directory is `<runDir>/clones/integration`, the "baseline lines"
// those in `<runDir>/clones/baseline`. The engine emits no event for a suite
// execution, so the count is the command's own log, never an event count.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { makeRepo, rig, gitSync, passReview, cleanCritic, doneImpl } from './_engine_helpers.mjs'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-baseline-'))

// The suite the legs count executions from. The log path is absolute and baked
// in at makeRepo time, so the line lands wherever the command is run from.
const checkSh = (logPath) =>
  '#!/bin/bash\n' +
  'printf "%s %s\\n" "$PWD" "$(git write-tree)" >> ' + JSON.stringify(logPath) + '\n' +
  '[ ! -f BROKEN ]\n'

// makeRepo writes its own check.sh first and the caller's files after, so
// `check.sh` here replaces the helper's plain BROKEN-rule script.
const scenario = (name, files = {}) => {
  const dir = path.join(tmp, name)
  const logPath = path.join(tmp, name + '.log')
  const repo = makeRepo(path.join(dir, 'repo'), { 'check.sh': checkSh(logPath), ...files })
  return { repo, runDir: path.join(dir, 'run'), logPath }
}

const logEntries = (logPath) => (fs.existsSync(logPath)
  ? fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map((line) => {
      const i = line.lastIndexOf(' ')
      return { dir: line.slice(0, i), tree: line.slice(i + 1) }
    })
  : [])

// The executions that ran in one directory, in execution order, as the trees
// they ran on. The directory is compared against the resolved path because bash
// reports the physical cwd in $PWD.
const treesIn = (logPath, dir) => {
  const real = fs.realpathSync(dir)
  return logEntries(logPath).filter((e) => e.dir === real).map((e) => e.tree)
}
const integrationTrees = (logPath, integ) => treesIn(logPath, integ)
const baselineTrees = (logPath, clonesDir) => treesIn(logPath, path.join(clonesDir, 'baseline'))

const treeOf = (sha, integ) => gitSync(['rev-parse', sha + '^{tree}'], integ)

const task = (id) => ({
  id, title: 'task ' + id, files: [id + '.txt'], tier: 'standard', review: 'lean',
  writes: [id + '.txt'], commutes: [], body: 'sim task ' + id,
})

// ── (a) every wave green: BASE ran once, in its own clone [M1, M5] ──────────
{
  const { repo, runDir, logPath } = scenario('a')
  const stub = (prompt, opts, cwd) => {
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') {
      const id = opts.label.split(':')[1]
      fs.writeFileSync(path.join(cwd, id + '.txt'), 'from ' + id + '\n')
      return doneImpl(cwd)
    }
    if (kind === 'review') return passReview()
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('leg (a): unexpected dispatch ' + opts.label)
  }
  const { run, integ, clonesDir, base, logs } = rig({
    repo, runDir, waves: [[task('T1')], [task('T2')]], edges: [['T1', 'T2']],
    stub, stamp: 'bl-a',
  })
  const report = await run()

  assert.equal(report.waveMerges[0].status, 'MERGED',
    'leg (a) [M1]: wave 1 merges — ' + JSON.stringify(report.judgmentCalls))
  assert.equal(report.waveMerges[1].status, 'MERGED',
    'leg (a) [M1]: wave 2 merges — ' + JSON.stringify(report.judgmentCalls))

  const trees = integrationTrees(logPath, integ)
  assert.deepEqual(trees,
    [treeOf(report.waveMerges[0].headSha, integ), treeOf(report.waveMerges[1].headSha, integ)],
    'leg (a) [M5]: exactly one integration-clone execution per MERGED wave, each on that ' +
    'wave\'s adopted tree — an engine that still read-trees BASE into this clone fails the ' +
    'line count')
  assert.ok(!trees.includes(treeOf(base, integ)),
    'leg (a) [M5]: no integration-clone execution carried BASE\'s tree')

  assert.deepEqual(baselineTrees(logPath, clonesDir), [treeOf(base, integ)],
    'leg (a) [M1]: exactly one execution in <runDir>/clones/baseline, and it ran on BASE\'s ' +
    'tree — an engine that never cuts the baseline clone logs none: ' +
    JSON.stringify(logEntries(logPath)))
  const baselineDir = fs.realpathSync(path.join(clonesDir, 'baseline'))
  assert.notEqual(baselineDir, fs.realpathSync(integ),
    'leg (a) [M1]: the baseline clone is not the integration clone')
  for (const id of ['T1', 'T2']) {
    assert.notEqual(baselineDir, fs.realpathSync(path.join(clonesDir, 'task-' + id)),
      'leg (a) [M1]: the baseline clone is not task ' + id + '\'s clone')
  }

  assert.ok(logs.includes('baseline: green on ' + base),
    'leg (a) [M1]: one engine:log line is exactly "baseline: green on <baseSha>" — ' +
    JSON.stringify(logs))
  assert.ok(report.baseline && typeof report.baseline === 'object',
    'leg (a) [M5]: report.baseline is the { passed, output } record on an all-green run — ' +
    'never null after Setup completed: ' + JSON.stringify(report.baseline))
  assert.deepEqual(Object.keys(report.baseline).sort(), ['output', 'passed'],
    'leg (a) [M5]: report.baseline carries exactly passed and output')
  assert.strictEqual(report.baseline.passed, true, 'leg (a) [M5]: BASE itself was green')
}

// ── (b) a green BASE and a red candidate: the wave reconciles [M4, M5] ──────
{
  const { repo, runDir, logPath } = scenario('b')
  const ctx = {}
  let baselineRunsAtReconcile = null
  let criticPrompt = null
  const labels = []
  const stub = (prompt, opts, cwd) => {
    labels.push(opts.label)
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') {
      fs.writeFileSync(path.join(cwd, 'T1.txt'), 'useful work\n')
      fs.writeFileSync(path.join(cwd, 'BROKEN'), 'oops\n')
      return doneImpl(cwd)
    }
    if (kind === 'review') return passReview()
    if (kind === 'reconcile') {
      baselineRunsAtReconcile = baselineTrees(logPath, ctx.clonesDir).length
      // The agent edits files in the integration clone and the driver commits
      // what it finds there, so the worktree it is handed holds the CANDIDATE
      // tree — the baseline never touched this clone at all.
      assert.ok(fs.existsSync(path.join(cwd, 'BROKEN')),
        'leg (b) [M4]: the reconcile agent\'s cwd holds the candidate\'s red marker')
      assert.ok(fs.existsSync(path.join(cwd, 'T1.txt')),
        'leg (b) [M4]: the reconcile agent\'s cwd holds the implementer\'s file')
      fs.rmSync(path.join(cwd, 'BROKEN'))
      return { status: 'FIXED', summary: 'removed the BROKEN marker' }
    }
    if (opts.label === 'integration') { criticPrompt = prompt; return cleanCritic() }
    throw new Error('leg (b): unexpected dispatch ' + opts.label)
  }
  const r = rig({ repo, runDir, waves: [[task('T1')]], stub, stamp: 'bl-b' })
  ctx.clonesDir = r.clonesDir
  const report = await r.run()
  const { integ, clonesDir, base, logs } = r

  const trees = integrationTrees(logPath, integ)
  assert.equal(trees.length, 2,
    'leg (b) [M5]: two integration-clone executions — the red candidate, then the reconciled ' +
    'head — and BASE is not among them: ' + JSON.stringify(trees))
  assert.notEqual(trees[0], treeOf(base, integ),
    'leg (b) [M5]: the first execution is the wave\'s red candidate, not BASE')
  assert.equal(trees[1], treeOf(report.waveMerges[0].headSha, integ),
    'leg (b) [M5]: the second execution ran on the reconciled head\'s tree')

  assert.deepEqual(baselineTrees(logPath, clonesDir), [treeOf(base, integ)],
    'leg (b) [M5]: the run\'s one execution on BASE\'s tree happened in clones/baseline')
  assert.equal(baselineRunsAtReconcile, 1,
    'leg (b) [M4]: BASE had already been read when the first reconcile: was dispatched — ' +
    'an engine that starts the baseline after the reconcile sees a count of 0 here')

  assert.equal(labels.filter((l) => l === 'reconcile:wave1:1').length, 1,
    'leg (b) [M4]: exactly one agent labelled reconcile:wave1:1 — ' + JSON.stringify(labels))
  assert.equal(report.waveMerges[0].status, 'MERGED',
    'leg (b) [M4]: FIXED → MERGED, as at BASE — ' + JSON.stringify(report.judgmentCalls))
  assert.equal(report.tests.passed, true, 'leg (b) [M4]: report.tests.passed is true')
  assert.strictEqual(report.baseline.passed, true, 'leg (b) [M4]: report.baseline.passed is true')

  assert.ok(logs.includes('baseline: green on ' + base),
    'leg (b) [M4]: one engine:log line is exactly "baseline: green on <baseSha>" — ' +
    JSON.stringify(logs))
  assert.ok(!report.judgmentCalls.some((j) => String(j).startsWith('baseline:')),
    'leg (b) [M4]: a green baseline draws no judgmentCalls entry starting "baseline:" — ' +
    JSON.stringify(report.judgmentCalls))
  assert.ok(criticPrompt !== null, 'leg (b) [M4]: the completeness critic was dispatched')
  assert.ok(!criticPrompt.split('\n').some((l) => l.startsWith('Baseline:')),
    'leg (b) [M4]: a green baseline puts no line starting "Baseline:" in the critic\'s brief')
}

// ── (c) BASE itself red: the run parks, and no reconcile is asked [M2, M3] ──
// `check.sh` is instant here, so the baseline settles during Setup — before the
// chunk loop can dispatch anything.
{
  const { repo, runDir, logPath } = scenario('c', { BROKEN: 'red at BASE\n' })
  const labels = []
  const stub = (prompt, opts) => {
    labels.push(opts.label)
    throw new Error('leg (c): nothing may be dispatched — got ' + opts.label)
  }
  const { run, integ, clonesDir, base, logs } = rig({
    repo, runDir, waves: [[task('T1')], [task('T2')]], edges: [], stub, stamp: 'bl-c',
  })
  const report = await run()

  assert.deepEqual(labels.filter((l) => l.startsWith('impl:')), [],
    'leg (c) [M3]: not one implementer is dispatched into a repository that was already ' +
    'red — ' + JSON.stringify(labels))
  assert.deepEqual(labels.filter((l) => l.startsWith('reconcile:')), [],
    'leg (c) [M2]: no reconcile: agent is dispatched at a red the run inherited — ' +
    JSON.stringify(labels))

  assert.deepEqual(baselineTrees(logPath, clonesDir), [treeOf(base, integ)],
    'leg (c) [M5]: the one execution on BASE\'s tree happened in clones/baseline')
  assert.deepEqual(integrationTrees(logPath, integ), [],
    'leg (c) [M2]: the integration clone ran no suite at all — no candidate was tested')

  assert.strictEqual(report.baseline.passed, false, 'leg (c) [M2]: report.baseline.passed is false')
  assert.ok(logs.includes('baseline: RED on ' + base),
    'leg (c) [M2]: one engine:log line is exactly "baseline: RED on <baseSha>" — ' +
    JSON.stringify(logs))
  const redCalls = report.judgmentCalls.filter(
    (j) => String(j).startsWith('baseline: the suite is RED on BASE'))
  assert.equal(redCalls.length, 1,
    'leg (c) [M2]: exactly one judgmentCalls entry starts with "baseline: the suite is RED ' +
    'on BASE" — ' + JSON.stringify(report.judgmentCalls))

  assert.equal(report.waveMerges[0].status, 'TEST_FAILED',
    'leg (c) [M2]: wave 1 is TEST_FAILED — ' + JSON.stringify(report.waveMerges))
  assert.ok(String(report.waveMerges[0].detail).startsWith('baseline: the suite is RED on BASE'),
    'leg (c) [M2]: its detail begins "baseline: the suite is RED on BASE" — ' +
    JSON.stringify(report.waveMerges[0].detail))
  assert.equal(report.waveMerges[1].status, 'SKIPPED',
    'leg (c) [M2]: every later wave is SKIPPED — ' + JSON.stringify(report.waveMerges))
  assert.equal(gitSync(['rev-parse', 'ultra/integration-bl-c'], integ), base,
    'leg (c) [M2]: the integration branch still resolves to BASE')
}

// ── (d) a green BASE and a reconcile that BLOCKED: TEST_FAILED [M4] ─────────
{
  const { repo, runDir, logPath } = scenario('d')
  const stub = (prompt, opts, cwd) => {
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') {
      fs.writeFileSync(path.join(cwd, 'T1.txt'), 'useful work\n')
      fs.writeFileSync(path.join(cwd, 'BROKEN'), 'oops\n')
      return doneImpl(cwd)
    }
    if (kind === 'review') return passReview()
    if (kind === 'reconcile') return { status: 'BLOCKED', summary: 'not fixable here' }
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('leg (d): unexpected dispatch ' + opts.label)
  }
  const { run, integ, clonesDir, base } = rig({
    repo, runDir, waves: [[task('T1')]], stub, stamp: 'bl-d',
  })
  const report = await run()

  const trees = integrationTrees(logPath, integ)
  assert.equal(trees.length, 1,
    'leg (d) [M4]: one integration-clone execution — the red candidate: ' +
    JSON.stringify(trees))
  assert.notEqual(trees[0], treeOf(base, integ),
    'leg (d) [M4]: it is the wave\'s candidate, not BASE')
  assert.deepEqual(baselineTrees(logPath, clonesDir), [treeOf(base, integ)],
    'leg (d) [M5]: BASE was still read exactly once, in clones/baseline')

  assert.equal(report.waveMerges[0].status, 'TEST_FAILED',
    'leg (d) [M4]: BLOCKED → TEST_FAILED, exactly as at BASE — ' +
    JSON.stringify(report.judgmentCalls))
  assert.ok(String(report.waveMerges[0].detail)
    .startsWith('candidate suite failed after reconcile attempts: '),
    'leg (d) [M4]: the detail is the candidate\'s, not the baseline\'s — ' +
    JSON.stringify(report.waveMerges[0].detail))
  assert.equal(gitSync(['rev-parse', 'ultra/integration-bl-d'], integ), base,
    'leg (d) [M4]: the integration branch is back at its previous head')
  assert.strictEqual(report.baseline.passed, true, 'leg (d) [M4]: report.baseline.passed is true')
}

// ── (e) two red waves: the baseline still runs once per run [M5] ────────────
{
  const { repo, runDir, logPath } = scenario('e')
  const stub = (prompt, opts, cwd) => {
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') {
      const id = opts.label.split(':')[1]
      fs.writeFileSync(path.join(cwd, id + '.txt'), 'from ' + id + '\n')
      fs.writeFileSync(path.join(cwd, 'BROKEN'), 'oops\n')
      return doneImpl(cwd)
    }
    if (kind === 'review') return passReview()
    if (kind === 'reconcile') {
      if (opts.label.split(':')[1] === 'wave1') {
        fs.rmSync(path.join(cwd, 'BROKEN'))
        return { status: 'FIXED', summary: 'removed the BROKEN marker' }
      }
      return { status: 'BLOCKED', summary: 'not fixable here' }
    }
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('leg (e): unexpected dispatch ' + opts.label)
  }
  const { run, integ, clonesDir, base } = rig({
    repo, runDir, waves: [[task('T1')], [task('T2')]], edges: [], stub, stamp: 'bl-e',
  })
  const report = await run()

  assert.equal(report.waveMerges[0].status, 'MERGED',
    'leg (e) [M5]: wave 1 reconciles and merges — ' + JSON.stringify(report.judgmentCalls))
  assert.equal(report.waveMerges[1].status, 'TEST_FAILED',
    'leg (e) [M5]: wave 2 blocks — ' + JSON.stringify(report.judgmentCalls))

  const trees = integrationTrees(logPath, integ)
  const baseTree = treeOf(base, integ)
  assert.equal(trees.length, 3,
    'leg (e) [M5]: three integration-clone executions — wave-1 candidate, wave-1 reconciled ' +
    'head, wave-2 candidate: ' + JSON.stringify(trees))
  assert.equal(trees.filter((t) => t === baseTree).length, 0,
    'leg (e) [M5]: none of them carried BASE\'s tree')
  assert.equal(trees[1], treeOf(report.waveMerges[0].headSha, integ),
    'leg (e) [M5]: the second execution is wave 1\'s reconciled head')
  assert.deepEqual(baselineTrees(logPath, clonesDir), [baseTree],
    'leg (e) [M5]: exactly one execution on BASE\'s tree across two red waves, and it is the ' +
    'baseline clone\'s — an engine that re-reads BASE on wave 2 fails this count')
  assert.strictEqual(report.baseline.passed, true, 'leg (e) [M5]: report.baseline.passed is true')
}

// ── (f) the documents and the source literals the Run: legs grep ────────────
// The `Run:` legs execute the sibling sims and `test_docs_agree_with_code.py` as
// commands of their own; what is pinned here is the eager shape the documents
// have to state, and the literals the engine keeps.
{
  const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8')
  const doc = read('../../skills/ultrapowers/references/report-format.md')
  const engineSrc = read('../run-engine.mjs')
  const simSrc = read('./test_run_engine.mjs')

  assert.ok(doc.includes('"baseline": { "oneOf": [{"type":"null"}, '),
    'leg (f): the report-format schema line still admits null — a run that never completed ' +
    'Setup has no baseline to report')

  const lines = doc.split('\n')
  const fieldRow = lines.filter((l) => /^\| `baseline` \|/.test(l))
  assert.equal(fieldRow.length, 1, 'leg (f): exactly one `baseline` field row')
  for (const phrase of ['clones/baseline', 'Setup', 'once per run', 'SKIPPED']) {
    assert.ok(fieldRow[0].includes(phrase),
      'leg (f): the `baseline` field row states the eager shape — it must name ' +
      JSON.stringify(phrase) + ': ' + fieldRow[0])
  }
  assert.ok(!fieldRow[0].includes('only when a wave'),
    'leg (f): and no longer says the baseline is bought "only when a wave" went red: ' +
    fieldRow[0])

  const item3 = lines.filter((l) => l.startsWith('3. '))
  assert.equal(item3.length, 1, 'leg (f): exactly one Presentation item 3 line')
  assert.ok(item3[0].includes('once per run') && item3[0].includes('Setup'),
    'leg (f): Presentation item 3 states the eager shape — once per run, during Setup: ' +
    item3[0])
  assert.ok(!item3[0].includes('only when a wave'),
    'leg (f): and no longer says "only when a wave": ' + item3[0])

  assert.ok(!doc.includes('runs the suite on BASE at all'),
    'leg (f): the document no longer says a run may not run the suite on BASE at all — ' +
    'the eleventh Run: leg greps for exactly this phrase')

  assert.ok(!engineSrc.includes('already failing before any task ran'),
    'leg (f): BASE\'s judgment-call literal is gone from fleet/run-engine.mjs')
  assert.ok(engineSrc.includes('the suite is RED on BASE'),
    'leg (f): fleet/run-engine.mjs carries the judgment-call literal')

  assert.ok(!simSrc.includes('assert.strictEqual(report.baseline, null)'),
    'leg (f): test_run_engine.mjs\'s null pin is gone — its run completes Setup, so the ' +
    'baseline is a record there')
  assert.ok(simSrc.includes('report.baseline.passed'),
    'leg (f): test_run_engine.mjs pins report.baseline.passed instead — its run is all-green ' +
    'and BASE is green under it')
}

fs.rmSync(tmp, { recursive: true, force: true })
console.log('ALL TESTS PASSED')
