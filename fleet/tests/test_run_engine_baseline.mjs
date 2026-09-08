// fleet/tests/test_run_engine_baseline.mjs — #712 Task 2: the baseline runs
// once, only when a wave's suite is red.
//
// The claim: a run whose every wave's suite is green never runs the suite on
// BASE; when a wave's candidate suite is red the driver runs the suite on BASE
// exactly once per run, before that wave's first `reconcile:` dispatch, and the
// record says whether BASE itself was red or green.
//
// Every leg below is its own `rig()` run over a repo whose `check.sh` appends
// `$PWD` and `$(git write-tree)` to an absolute log under the sim's temp dir on
// every execution, then exits by the BROKEN rule. `git write-tree` names the
// INDEX's tree — the candidate's after the driver's `read-tree`, BASE's during
// the baseline however it is run, the reconciled commit's after the driver's
// commit — so a logged line says WHICH tree ran without the exam knowing how
// the driver arranged it. Every count is over the lines whose directory is
// `<runDir>/clones/integration` (the "integration lines"): the depth-1 leg runs
// the same command in `<runDir>/clones/shallow`, and an implementer's clone is
// a different directory again. The engine emits no event for a suite execution,
// so the count is the command's own log, never an event count.
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

// makeRepo writes its own check.sh first and the caller's `files` after, so
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

// The integration lines, in execution order, as the trees they ran on. The
// directory is compared against the resolved path because bash reports the
// physical cwd in $PWD.
const integrationTrees = (logPath, integ) => {
  const real = fs.realpathSync(integ)
  return logEntries(logPath).filter((e) => e.dir === real).map((e) => e.tree)
}

const treeOf = (sha, integ) => gitSync(['rev-parse', sha + '^{tree}'], integ)

const task = (id) => ({
  id, title: 'task ' + id, files: [id + '.txt'], tier: 'standard', review: 'lean',
  writes: [id + '.txt'], commutes: [], body: 'sim task ' + id,
})

// ── (a) every wave green: the suite never runs on BASE [M1] ─────────────────
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
  const { run, integ, base, logs } = rig({
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
    'leg (a) [M1]: exactly one integration-clone execution per MERGED wave, each on that ' +
    'wave\'s adopted tree — an engine that still runs the suite in Setup fails this line count')
  assert.ok(!trees.includes(treeOf(base, integ)),
    'leg (a) [M1]: no integration-clone execution carried BASE\'s tree')
  assert.ok(!logs.some((l) => l.includes('baseline')),
    'leg (a) [M1]: no engine:log line contains "baseline" on an all-green run — ' +
    JSON.stringify(logs))
  assert.strictEqual(report.baseline, null,
    'leg (a) [M1]: report.baseline is null (strict — an engine that drops the key fails)')
}

// ── (b) a red candidate: one BASE run before the reconcile dispatch [M2, M3] ─
{
  const { repo, runDir, logPath } = scenario('b')
  const ctx = {}
  let dispatchCount = null
  let criticPrompt = null
  const stub = (prompt, opts, cwd) => {
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') {
      fs.writeFileSync(path.join(cwd, 'T1.txt'), 'useful work\n')
      fs.writeFileSync(path.join(cwd, 'BROKEN'), 'oops\n')
      return doneImpl(cwd)
    }
    if (kind === 'review') return passReview()
    if (kind === 'reconcile') {
      dispatchCount = integrationTrees(logPath, ctx.integ).length
      // The agent edits files in the integration clone and the driver commits
      // what it finds there, so the worktree it is handed holds the CANDIDATE
      // tree — not whatever tree the baseline run left behind.
      assert.ok(fs.existsSync(path.join(cwd, 'BROKEN')),
        'leg (b) [M2]: the reconcile agent\'s cwd holds the candidate\'s red marker')
      assert.ok(fs.existsSync(path.join(cwd, 'T1.txt')),
        'leg (b) [M2]: the reconcile agent\'s cwd holds the implementer\'s file')
      fs.rmSync(path.join(cwd, 'BROKEN'))
      return { status: 'FIXED', summary: 'removed the BROKEN marker' }
    }
    if (opts.label === 'integration') { criticPrompt = prompt; return cleanCritic() }
    throw new Error('leg (b): unexpected dispatch ' + opts.label)
  }
  const r = rig({ repo, runDir, waves: [[task('T1')]], stub, stamp: 'bl-b' })
  ctx.integ = r.integ
  const report = await r.run()
  const { integ, base, logs } = r

  const trees = integrationTrees(logPath, integ)
  assert.equal(trees.length, 3,
    'leg (b) [M2]: three integration-clone executions — candidate, BASE, reconciled head — ' +
    JSON.stringify(trees))
  assert.equal(trees[1], treeOf(base, integ),
    'leg (b) [M2]: the SECOND execution ran on BASE\'s tree')
  assert.equal(trees[2], treeOf(report.waveMerges[0].headSha, integ),
    'leg (b) [M2]: the third execution ran on the reconciled head\'s tree')
  assert.notEqual(trees[0], treeOf(base, integ),
    'leg (b) [M2]: the first execution is the wave\'s red candidate, not BASE')
  assert.notEqual(trees[0], trees[2],
    'leg (b) [M2]: the candidate\'s tree is not the reconciled head\'s tree')
  assert.equal(dispatchCount, 2,
    'leg (b) [M2]: the BASE run happened BEFORE the first reconcile: dispatch — an engine ' +
    'that runs the baseline after the reconcile sees a count of 1 here')

  assert.equal(report.waveMerges[0].status, 'MERGED',
    'leg (b) [M2]: the wave ends as at BASE — FIXED → MERGED — ' +
    JSON.stringify(report.judgmentCalls))
  assert.equal(report.tests.passed, true, 'leg (b) [M2]: report.tests.passed is true')

  assert.ok(report.baseline && typeof report.baseline === 'object',
    'leg (b) [M2]: report.baseline is the { passed, output } record')
  assert.deepEqual(Object.keys(report.baseline).sort(), ['output', 'passed'],
    'leg (b) [M2]: report.baseline carries exactly passed and output')
  assert.equal(report.baseline.passed, true, 'leg (b) [M2]: BASE itself was green')
  assert.equal(typeof report.baseline.output, 'string', 'leg (b) [M2]: output is a string')

  assert.ok(logs.includes('baseline: green on ' + base),
    'leg (b) [M2]: one engine:log line is exactly "baseline: green on <baseSha>" — ' +
    JSON.stringify(logs))
  assert.ok(!report.judgmentCalls.some((j) => String(j).startsWith('baseline:')),
    'leg (b) [M3]: a green baseline draws no judgmentCalls entry starting "baseline:" — ' +
    JSON.stringify(report.judgmentCalls))
  assert.ok(criticPrompt !== null, 'leg (b) [M3]: the completeness critic was dispatched')
  assert.ok(!criticPrompt.split('\n').some((l) => l.startsWith('Baseline:')),
    'leg (b) [M3]: a green baseline puts no line starting "Baseline:" in the critic\'s brief')
}

// ── (c) BASE itself red: the record says so [M2, M3] ────────────────────────
{
  const { repo, runDir, logPath } = scenario('c', { BROKEN: 'red at BASE\n' })
  let criticPrompt = null
  const stub = (prompt, opts, cwd) => {
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') {
      fs.writeFileSync(path.join(cwd, 'T1.txt'), 'useful work\n')
      return doneImpl(cwd)
    }
    if (kind === 'review') return passReview()
    if (kind === 'reconcile') {
      fs.rmSync(path.join(cwd, 'BROKEN'))
      return { status: 'FIXED', summary: 'removed the BROKEN marker' }
    }
    if (opts.label === 'integration') { criticPrompt = prompt; return cleanCritic() }
    throw new Error('leg (c): unexpected dispatch ' + opts.label)
  }
  const { run, integ, base, logs } = rig({
    repo, runDir, waves: [[task('T1')]], stub, stamp: 'bl-c',
  })
  const report = await run()

  const trees = integrationTrees(logPath, integ)
  assert.equal(trees.length, 3,
    'leg (c) [M2]: three integration-clone executions — ' + JSON.stringify(trees))
  assert.equal(trees[1], treeOf(base, integ),
    'leg (c) [M2]: the second execution ran on BASE\'s tree')
  assert.equal(trees[2], treeOf(report.waveMerges[0].headSha, integ),
    'leg (c) [M2]: the third execution ran on the reconciled head\'s tree')

  assert.equal(report.waveMerges[0].status, 'MERGED',
    'leg (c) [M2]: a red baseline changes nothing about the wave — FIXED → MERGED — ' +
    JSON.stringify(report.judgmentCalls))
  assert.equal(report.baseline.passed, false, 'leg (c) [M3]: report.baseline.passed is false')
  assert.ok(logs.includes('baseline: RED on ' + base),
    'leg (c) [M2]: one engine:log line is exactly "baseline: RED on <baseSha>" — ' +
    JSON.stringify(logs))

  const redCalls = report.judgmentCalls.filter(
    (j) => String(j).startsWith('baseline: the suite is RED on BASE'))
  assert.equal(redCalls.length, 1,
    'leg (c) [M3]: exactly one judgmentCalls entry starts with "baseline: the suite is RED ' +
    'on BASE" — ' + JSON.stringify(report.judgmentCalls))

  assert.ok(criticPrompt !== null, 'leg (c) [M3]: the completeness critic was dispatched')
  assert.ok(criticPrompt.split('\n').some(
    (l) => l.startsWith('Baseline: the suite is RED on BASE')),
    'leg (c) [M3]: the critic\'s brief carries a line starting "Baseline: the suite is RED ' +
    'on BASE"')
}

// ── (d) BASE red and the reconcile BLOCKED: the wave ends as at BASE [M2] ───
{
  const { repo, runDir, logPath } = scenario('d', { BROKEN: 'red at BASE\n' })
  const stub = (prompt, opts, cwd) => {
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') {
      fs.writeFileSync(path.join(cwd, 'T1.txt'), 'useful work\n')
      return doneImpl(cwd)
    }
    if (kind === 'review') return passReview()
    if (kind === 'reconcile') return { status: 'BLOCKED', summary: 'not fixable here' }
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('leg (d): unexpected dispatch ' + opts.label)
  }
  const { run, integ, base } = rig({
    repo, runDir, waves: [[task('T1')]], stub, stamp: 'bl-d',
  })
  const report = await run()

  const trees = integrationTrees(logPath, integ)
  assert.equal(trees.length, 2,
    'leg (d) [M2]: two integration-clone executions — candidate, then BASE — ' +
    JSON.stringify(trees))
  assert.equal(trees[1], treeOf(base, integ),
    'leg (d) [M2]: the second execution ran on BASE\'s tree')
  assert.notEqual(trees[0], treeOf(base, integ),
    'leg (d) [M2]: the first execution is the wave\'s red candidate, not BASE')

  assert.equal(report.waveMerges[0].status, 'TEST_FAILED',
    'leg (d) [M2]: BLOCKED → TEST_FAILED, exactly as at BASE — ' +
    JSON.stringify(report.judgmentCalls))
  assert.equal(gitSync(['rev-parse', 'ultra/integration-bl-d'], integ), base,
    'leg (d) [M2]: the integration branch is back at its previous head')
  assert.equal(report.baseline.passed, false, 'leg (d) [M2]: report.baseline.passed is false')
}

// ── (e) two red waves: the baseline runs at most once per run [M4] ──────────
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
  const { run, integ, base } = rig({
    repo, runDir, waves: [[task('T1')], [task('T2')]], edges: [], stub, stamp: 'bl-e',
  })
  const report = await run()

  assert.equal(report.waveMerges[0].status, 'MERGED',
    'leg (e) [M4]: wave 1 reconciles and merges — ' + JSON.stringify(report.judgmentCalls))
  assert.equal(report.waveMerges[1].status, 'TEST_FAILED',
    'leg (e) [M4]: wave 2 blocks — ' + JSON.stringify(report.judgmentCalls))

  const trees = integrationTrees(logPath, integ)
  const baseTree = treeOf(base, integ)
  assert.equal(trees.length, 4,
    'leg (e) [M4]: four integration-clone executions — wave-1 candidate, BASE, wave-1 ' +
    'reconciled, wave-2 candidate — an engine that runs the baseline again on wave 2 fails ' +
    'this count: ' + JSON.stringify(trees))
  assert.equal(trees.filter((t) => t === baseTree).length, 1,
    'leg (e) [M4]: exactly one execution carried BASE\'s tree across two red waves')
  assert.equal(trees[1], baseTree,
    'leg (e) [M4]: its position is the second, after wave 1\'s candidate — an engine that ' +
    'runs it on wave 1\'s head instead of BASE fails this equality')
  assert.equal(trees[2], treeOf(report.waveMerges[0].headSha, integ),
    'leg (e) [M4]: the third execution is wave 1\'s reconciled head')
}

// ── (f) the documents and the two source literals the Run: legs grep [M5] ────
// The fifth and sixth Run: legs (`node fleet/tests/test_run_engine.mjs` and
// `python3 -m pytest tests/test_docs_agree_with_code.py`) are executed by the
// driver as commands of their own; what is pinned here is the re-scoped
// baseline assertion the fifth exists for.
{
  const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8')
  const doc = read('../../skills/ultrapowers/references/report-format.md')
  const engineSrc = read('../run-engine.mjs')
  const simSrc = read('./test_run_engine.mjs')

  assert.ok(doc.includes('"baseline": { "oneOf": [{"type":"null"}, '),
    'leg (f) [M5]: the report-format schema line admits null — a line that keeps BASE\'s ' +
    'bare object shape fails the first Run: leg')

  const lines = doc.split('\n')
  const fieldRow = lines.filter((l) => /^\| `baseline` \|/.test(l))
  assert.equal(fieldRow.length, 1, 'leg (f) [M5]: exactly one `baseline` field row')
  assert.ok(fieldRow[0].includes('only when a wave') && fieldRow[0].includes('null'),
    'leg (f) [M5]: the `baseline` field row carries BOTH "only when a wave" (the trigger) ' +
    'and "null" (the value otherwise) — a row naming only one of them fails the second ' +
    'Run: leg: ' + fieldRow[0])

  const item3 = lines.filter((l) => l.startsWith('3. '))
  assert.equal(item3.length, 1, 'leg (f) [M5]: exactly one Presentation item 3 line')
  assert.ok(item3[0].includes('only when a wave') && item3[0].includes('null'),
    'leg (f) [M5]: Presentation item 3 carries BOTH "only when a wave" and "null" — an item ' +
    'that keeps BASE\'s "before wave 1" sentence fails the third Run: leg: ' + item3[0])

  assert.ok(!engineSrc.includes('already failing before any task ran'),
    'leg (f) [M5]: BASE\'s judgment-call literal is gone from fleet/run-engine.mjs')
  assert.ok(engineSrc.includes('the suite is RED on BASE'),
    'leg (f) [M5]: fleet/run-engine.mjs carries the new judgment-call literal')

  assert.ok(simSrc.includes('assert.strictEqual(report.baseline, null)'),
    'leg (f) [M5]: test_run_engine.mjs\'s baseline pin is re-scoped to a strict null')
  assert.ok(!simSrc.includes('report.baseline.passed'),
    'leg (f) [M5]: test_run_engine.mjs no longer pins report.baseline.passed — its run is ' +
    'all-green, so the suite never ran on BASE there')
}

fs.rmSync(tmp, { recursive: true, force: true })
console.log('ALL TESTS PASSED')
