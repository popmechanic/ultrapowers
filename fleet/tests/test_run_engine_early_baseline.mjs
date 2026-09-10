// fleet/tests/test_run_engine_early_baseline.mjs — Task 1: the baseline runs
// FIRST, on a clone of its own, and a red one parks the run.
//
// The exam is written against the task's Machine clauses, leg by leg; every
// assertion names the leg it belongs to and the clause it comes from, so a
// reader can map this file back to the contract:
//
//   M1  the engine starts the run's suite on BASE's tree in `<runDir>/clones/
//       baseline` (cut at BASE, bootstrapped when `bootstrapCmd` is set, and
//       neither `clones/integration` nor any `clones/task-<id>`) during Setup,
//       and does NOT wait for it before dispatching wave 1.
//   M2  a red BASE parks the run without a reconcile: no `reconcile:` dispatch,
//       `report.baseline` is `{ passed: false, output }` carrying the failing
//       test's own line, one `engine:log` line is exactly
//       `baseline: RED on <baseSha>`, `report.waveMerges[0]` is `TEST_FAILED`
//       with a `detail` beginning `baseline: the suite is RED on BASE`, every
//       later wave is `SKIPPED`, and the integration branch still resolves to
//       BASE.
//   M3  settled red BEFORE wave 1's first chunk → no `impl:` dispatch at all;
//       settled red after → the park happens at the barrier and M2 is unchanged.
//   M4  a green BASE and a red folded candidate still buys exactly one
//       `reconcile:wave1:1`, `report.baseline.passed` is `true`, and FIXED →
//       `MERGED`, as at BASE.
//   M5  the suite runs on BASE's tree exactly once per run — all-green,
//       red-candidate and two-red-waves alike — always in `clones/baseline` and
//       never in `clones/integration`; `report.baseline` is never null.
//
// The instrument is the suite command's own log, as in the #712 sim: `check.sh`
// appends `$PWD`, `$(git write-tree)` (the INDEX's tree — BASE's whenever the
// baseline is what ran) and a nanosecond stamp to an absolute log on every
// execution, then exits by the BROKEN rule. So a logged line says WHICH tree
// ran WHERE and WHEN without this exam knowing how the driver arranged it. The
// engine emits no event for a suite execution, so the count is the command's
// own log and never an event count.
//
// M1's ordering is read from that stamp against the stub's own `Date.now()` on
// its first `impl:` call: the rig emits no `worker:start`, so the dispatch's
// wall clock is the stub's. `$PWD` is compared against a RESOLVED path because
// bash reports the physical cwd.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { makeRepo, rig, gitSync, passReview, cleanCritic, doneImpl } from './_engine_helpers.mjs'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-early-baseline-'))

// The one line a red suite prints. `failingBlock` cuts from `not ok ` onward,
// so this line is what `report.baseline.output` has to carry.
const RED_LINE = 'not ok 1 - the suite is red at BASE'

// The suite the legs count executions from. The log path is absolute and baked
// in at makeRepo time, so the line lands wherever the command is run from.
// `slowInBaseline` makes the run on BASE's own clone take ~2 s and stamp its
// END time — the arm M1 and M3 need, where a driver that awaited the baseline
// could not have dispatched anyone before that stamp.
const checkSh = (logPath, { slowInBaseline = false } = {}) =>
  '#!/bin/bash\n' +
  (slowInBaseline ? 'case "$PWD" in */clones/baseline) sleep 2 ;; esac\n' : '') +
  'printf "%s %s %s\\n" "$PWD" "$(git write-tree)" "$(date +%s%N)" >> ' +
    JSON.stringify(logPath) + '\n' +
  'if [ -f BROKEN ]; then printf "%s\\n" ' + JSON.stringify(RED_LINE) + '; exit 1; fi\n' +
  'exit 0\n'

// makeRepo writes its own check.sh first and the caller's `files` after, so
// `check.sh` here replaces the helper's plain BROKEN-rule script.
const scenario = (name, { files = {}, slowInBaseline = false } = {}) => {
  const dir = path.join(tmp, name)
  const logPath = path.join(tmp, name + '.log')
  const repo = makeRepo(path.join(dir, 'repo'),
    { 'check.sh': checkSh(logPath, { slowInBaseline }), ...files })
  return { repo, runDir: path.join(dir, 'run'), logPath }
}

/** Every logged suite execution, in order: where it ran, on which tree, when. */
const suiteRuns = (logPath) => (fs.existsSync(logPath)
  ? fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map((line) => {
      const m = /^(.*) (\S+) (\S+)$/.exec(line)
      return m ? { dir: m[1], tree: m[2], stamp: m[3] } : { dir: line, tree: '', stamp: '' }
    })
  : [])

/** A directory as bash would report it — and the plain path when it does not
 *  exist, so a driver that never cut the clone fails a COUNT with its own
 *  message rather than an ENOENT from this helper. */
const realOr = (p) => (fs.existsSync(p) ? fs.realpathSync(p) : p)

const baselineDirOf = (runDir) => path.join(runDir, 'clones', 'baseline')
const taskDirOf = (runDir, id) => path.join(runDir, 'clones', 'task-' + id)
const runsIn = (entries, dir) => entries.filter((e) => e.dir === realOr(dir))
const treeOf = (sha, cwd) => gitSync(['rev-parse', sha + '^{tree}'], cwd)

/** A `date +%s%N` stamp as milliseconds, comparable with `Date.now()`. */
const msOf = (stamp, where) => {
  assert.match(String(stamp), /^[0-9]+$/,
    where + ': the rig\'s check.sh stamped a nanosecond clock (`date +%s%N`) — got ' +
    JSON.stringify(stamp))
  return Number(stamp) / 1e6
}

const task = (id) => ({
  id, title: 'task ' + id, files: [id + '.txt'], tier: 'standard', review: 'lean',
  writes: [id + '.txt'], commutes: [], body: 'sim task ' + id,
})

// One recording stub for every leg: it remembers each dispatch (label, cwd) and
// answers with the canned judgment for that kind. A leg overrides only the arm
// it cares about, and every arm the ENGINE AT BASE would take is answered — a
// leg that asserts "no `reconcile:` was called" has to report the call it saw,
// not die inside the stub.
const recording = ({ impl, reconcile } = {}) => {
  const calls = []
  const stub = (prompt, opts, cwd) => {
    calls.push({ label: String(opts.label), prompt, cwd })
    const kind = String(opts.label).split(':')[0]
    if (kind === 'impl') {
      const id = String(opts.label).split(':')[1]
      if (impl) impl(cwd, id)
      else fs.writeFileSync(path.join(cwd, id + '.txt'), 'from ' + id + '\n')
      return doneImpl(cwd)
    }
    if (kind === 'review' || kind === 'fix') return passReview()
    if (kind === 'reconcile') {
      return reconcile
        ? reconcile(cwd, String(opts.label))
        : { status: 'BLOCKED', summary: 'sim: this leg expects no reconcile' }
    }
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch ' + opts.label)
  }
  const labels = () => calls.map((c) => c.label)
  const startingWith = (prefix) => labels().filter((l) => l.startsWith(prefix))
  return { stub, calls, labels, startingWith }
}

// ── (a) the baseline runs in a clone of its own and wave 1 does not wait [M1] ─
{
  const { repo, runDir, logPath } = scenario('a', { slowInBaseline: true })
  let firstImplAt = null
  const rec = recording({
    impl: (cwd, id) => {
      if (firstImplAt === null) firstImplAt = Date.now()
      fs.writeFileSync(path.join(cwd, id + '.txt'), 'from ' + id + '\n')
    },
  })
  const { run, integ, base, phases } = rig({
    repo, runDir, waves: [[task('T1')]], stub: rec.stub, stamp: 'eb-a',
  })
  const report = await run()

  const entries = suiteRuns(logPath)
  const baselineDir = baselineDirOf(runDir)
  const onBaseline = runsIn(entries, baselineDir)
  assert.equal(onBaseline.length, 1,
    'leg (a) [M1]: exactly one suite execution ran in <runDir>/clones/baseline — an engine ' +
    'that never cuts that clone logs none: ' + JSON.stringify(entries))
  assert.equal(onBaseline[0].dir, realOr(baselineDir),
    'leg (a) [M1]: the baseline suite\'s $PWD IS <runDir>/clones/baseline')
  assert.notEqual(onBaseline[0].dir, realOr(integ),
    'leg (a) [M1]: that directory is not clones/integration — an engine that still ' +
    'read-trees BASE into the integration clone fails this line')
  assert.notEqual(onBaseline[0].dir, realOr(taskDirOf(runDir, 'T1')),
    'leg (a) [M1]: that directory is not a clones/task-<id> either')
  assert.equal(onBaseline[0].tree, treeOf(base, integ),
    'leg (a) [M1]: the baseline execution carried BASE\'s tree')

  assert.ok(firstImplAt !== null, 'leg (a) [M1]: wave 1 dispatched an `impl:` agent at all')
  const baselineEnd = msOf(onBaseline[0].stamp, 'leg (a) [M1]')
  assert.ok(firstImplAt < baselineEnd,
    'leg (a) [M1]: wave 1\'s first `impl:` call (' + firstImplAt + ') precedes the end of the ' +
    'baseline suite (' + baselineEnd + ') — an engine that awaits the baseline before ' +
    'dispatching fails this comparison by the suite\'s own two seconds')

  assert.equal(report.waveMerges[0].status, 'MERGED',
    'leg (a) [M1]: a green BASE and a green candidate still merge — ' +
    JSON.stringify(report.judgmentCalls))
  assert.equal(report.baseline.passed, true, 'leg (a) [M1]: report.baseline.passed is true')
  assert.deepEqual(phases, ['Setup', 'Wave 1', 'Integration Review'],
    'leg (a) [M1 / global constraint]: the phases a one-wave green run announces are ' +
    'unchanged — the baseline announces no phase of its own: ' + JSON.stringify(phases))
}

// ── (b) red BASE, settled AFTER dispatch: the park at the barrier [M2, M3] ───
{
  const { repo, runDir, logPath } = scenario('b',
    { files: { BROKEN: 'red at BASE\n' }, slowInBaseline: true })
  const rec = recording()
  const { run, integ, base, logs } = rig({
    repo, runDir, waves: [[task('T1')], [task('T2')]], edges: [], stub: rec.stub, stamp: 'eb-b',
  })
  const report = await run()

  assert.ok(rec.startingWith('impl:').length > 0,
    'leg (b) [M3]: the baseline was still running when wave 1 opened, so the `impl:` stub was ' +
    'called: ' + JSON.stringify(rec.labels()))
  assert.deepEqual(rec.startingWith('reconcile:'), [],
    'leg (b) [M2]: no agent whose label starts `reconcile:` is ever called — the run never ' +
    'reconciles the red it inherited: ' + JSON.stringify(rec.labels()))

  assert.ok(report.baseline && typeof report.baseline === 'object',
    'leg (b) [M2]: report.baseline is the { passed, output } record, not null')
  assert.deepEqual(Object.keys(report.baseline).sort(), ['output', 'passed'],
    'leg (b) [M2]: report.baseline carries exactly passed and output — ' +
    JSON.stringify(report.baseline))
  assert.equal(report.baseline.passed, false, 'leg (b) [M2]: report.baseline.passed is false')
  assert.equal(typeof report.baseline.output, 'string', 'leg (b) [M2]: output is a string')
  assert.ok(report.baseline.output.includes(RED_LINE),
    'leg (b) [M2]: report.baseline.output carries the failing test\'s own line ' +
    JSON.stringify(RED_LINE) + ' — got ' + JSON.stringify(report.baseline.output))

  assert.equal(logs.filter((l) => l === 'baseline: RED on ' + base).length, 1,
    'leg (b) [M2]: exactly one engine:log line is exactly "baseline: RED on <baseSha>" — ' +
    JSON.stringify(logs))

  assert.equal(report.waveMerges[0].status, 'TEST_FAILED',
    'leg (b) [M2]: wave 1 is TEST_FAILED — the run parks at wave 1\'s barrier: ' +
    JSON.stringify(report.waveMerges))
  assert.ok(String(report.waveMerges[0].detail || '')
    .startsWith('baseline: the suite is RED on BASE'),
    'leg (b) [M2]: its detail BEGINS "baseline: the suite is RED on BASE" — the park is ' +
    'attributed to the inherited red, not to the candidate: ' +
    JSON.stringify(report.waveMerges[0].detail))
  assert.ok(report.waveMerges[1] && report.waveMerges[1].status === 'SKIPPED',
    'leg (b) [M2]: the second wave\'s entry is SKIPPED: ' + JSON.stringify(report.waveMerges))

  assert.equal(gitSync(['rev-parse', 'ultra/integration-eb-b'], integ), base,
    'leg (b) [M2]: the integration branch still resolves to BASE')

  // The park is not a reason to run the suite on BASE twice.
  const entries = suiteRuns(logPath)
  assert.equal(runsIn(entries, baselineDirOf(runDir)).length, 1,
    'leg (b) [M2]: the one execution on BASE\'s tree ran in clones/baseline: ' +
    JSON.stringify(entries))
}

// ── (c) red BASE settled BEFORE dispatch: nobody is dispatched at all [M3] ───
{
  const { repo, runDir, logPath } = scenario('c', { files: { BROKEN: 'red at BASE\n' } })
  const rec = recording()
  const { run, integ, base, logs } = rig({
    repo, runDir, waves: [[task('T1')], [task('T2')]], edges: [], stub: rec.stub, stamp: 'eb-c',
  })
  const report = await run()

  assert.deepEqual(rec.startingWith('impl:'), [],
    'leg (c) [M3]: an instant red baseline settles before wave 1\'s first chunk, so no agent ' +
    'whose label starts `impl:` is called at all: ' + JSON.stringify(rec.labels()))
  assert.deepEqual(rec.startingWith('reconcile:'), [],
    'leg (c) [M3]: and none starts `reconcile:` either: ' + JSON.stringify(rec.labels()))

  // M2 holds unchanged on this arm.
  assert.equal(report.baseline.passed, false, 'leg (c) [M2]: report.baseline.passed is false')
  assert.ok(report.baseline.output.includes(RED_LINE),
    'leg (c) [M2]: report.baseline.output carries the failing test\'s own line — ' +
    JSON.stringify(report.baseline.output))
  assert.equal(logs.filter((l) => l === 'baseline: RED on ' + base).length, 1,
    'leg (c) [M2]: exactly one engine:log line is exactly "baseline: RED on <baseSha>" — ' +
    JSON.stringify(logs))
  assert.equal(report.waveMerges[0].status, 'TEST_FAILED',
    'leg (c) [M2]: wave 1 is TEST_FAILED even though nobody was dispatched: ' +
    JSON.stringify(report.waveMerges))
  assert.ok(String(report.waveMerges[0].detail || '')
    .startsWith('baseline: the suite is RED on BASE'),
    'leg (c) [M2]: its detail BEGINS "baseline: the suite is RED on BASE": ' +
    JSON.stringify(report.waveMerges[0].detail))
  assert.ok(report.waveMerges[1] && report.waveMerges[1].status === 'SKIPPED',
    'leg (c) [M2]: the second wave\'s entry is SKIPPED: ' + JSON.stringify(report.waveMerges))
  assert.equal(gitSync(['rev-parse', 'ultra/integration-eb-c'], integ), base,
    'leg (c) [M2]: the integration branch still resolves to BASE')

  const entries = suiteRuns(logPath)
  assert.equal(runsIn(entries, baselineDirOf(runDir)).length, 1,
    'leg (c) [M3]: the baseline ran once, in clones/baseline: ' + JSON.stringify(entries))
  assert.equal(runsIn(entries, integ).length, 0,
    'leg (c) [M3]: a parked run never ran the suite in clones/integration: ' +
    JSON.stringify(entries))
}

// ── (d) green BASE, red candidate: the reconcile is untouched [M4] ───────────
{
  const { repo, runDir } = scenario('d')
  let reconcileCwdHeld = null
  const rec = recording({
    impl: (cwd, id) => {
      fs.writeFileSync(path.join(cwd, id + '.txt'), 'useful work\n')
      fs.writeFileSync(path.join(cwd, 'BROKEN'), 'oops\n')
    },
    reconcile: (cwd) => {
      reconcileCwdHeld = {
        broken: fs.existsSync(path.join(cwd, 'BROKEN')),
        implFile: fs.existsSync(path.join(cwd, 'T1.txt')),
      }
      fs.rmSync(path.join(cwd, 'BROKEN'))
      return { status: 'FIXED', summary: 'removed the BROKEN marker' }
    },
  })
  const { run } = rig({
    repo, runDir, waves: [[task('T1')]], stub: rec.stub, stamp: 'eb-d',
  })
  const report = await run()

  assert.deepEqual(rec.startingWith('reconcile:'), ['reconcile:wave1:1'],
    'leg (d) [M4]: exactly one agent labelled `reconcile:wave1:1` is called: ' +
    JSON.stringify(rec.labels()))
  assert.deepEqual(reconcileCwdHeld, { broken: true, implFile: true },
    'leg (d) [M4]: it is handed a cwd holding BOTH the candidate\'s red marker and the ' +
    'implementer\'s file — the baseline left no tree of its own behind: ' +
    JSON.stringify(reconcileCwdHeld))
  assert.equal(report.baseline.passed, true,
    'leg (d) [M4]: report.baseline.passed is true — BASE itself was green')
  assert.equal(report.waveMerges[0].status, 'MERGED',
    'leg (d) [M4]: FIXED → MERGED, exactly as at BASE — ' +
    JSON.stringify(report.judgmentCalls))
}

// ── (e) one baseline pass per run, in clones/baseline, on three run shapes [M5]
{
  const shapes = [
    {
      name: 'e-green', stamp: 'eb-e1', waves: [[task('T1')]], greenRun: true,
      impl: (cwd, id) => fs.writeFileSync(path.join(cwd, id + '.txt'), 'from ' + id + '\n'),
      reconcile: () => ({ status: 'BLOCKED', summary: 'sim: no candidate is red here' }),
    },
    {
      name: 'e-red-candidate', stamp: 'eb-e2', waves: [[task('T1')]], greenRun: false,
      impl: (cwd, id) => {
        fs.writeFileSync(path.join(cwd, id + '.txt'), 'from ' + id + '\n')
        fs.writeFileSync(path.join(cwd, 'BROKEN'), 'oops\n')
      },
      reconcile: (cwd) => {
        fs.rmSync(path.join(cwd, 'BROKEN'))
        return { status: 'FIXED', summary: 'removed the BROKEN marker' }
      },
    },
    {
      name: 'e-two-red', stamp: 'eb-e3', waves: [[task('T1')], [task('T2')]], greenRun: false,
      impl: (cwd, id) => {
        fs.writeFileSync(path.join(cwd, id + '.txt'), 'from ' + id + '\n')
        fs.writeFileSync(path.join(cwd, 'BROKEN'), 'oops\n')
      },
      reconcile: (cwd, label) => {
        if (label.split(':')[1] === 'wave1') {
          fs.rmSync(path.join(cwd, 'BROKEN'))
          return { status: 'FIXED', summary: 'removed the BROKEN marker' }
        }
        return { status: 'BLOCKED', summary: 'not fixable here' }
      },
    },
  ]

  for (const shape of shapes) {
    const { repo, runDir, logPath } = scenario(shape.name)
    const rec = recording({ impl: shape.impl, reconcile: shape.reconcile })
    const { run, integ, base } = rig({
      repo, runDir, waves: shape.waves, edges: [], stub: rec.stub, stamp: shape.stamp,
    })
    const report = await run()
    const where = 'leg (e) [M5] (' + shape.name + ')'

    const entries = suiteRuns(logPath)
    const baseTree = treeOf(base, integ)
    const onBase = entries.filter((e) => e.tree === baseTree)
    assert.equal(onBase.length, 1,
      where + ': exactly one logged execution carried BASE\'s tree — one baseline pass per ' +
      'run, never two and never none: ' + JSON.stringify(entries))
    assert.equal(onBase[0].dir, realOr(baselineDirOf(runDir)),
      where + ': that execution ran in <runDir>/clones/baseline: ' + JSON.stringify(onBase[0]))
    assert.equal(runsIn(entries, integ).filter((e) => e.tree === baseTree).length, 0,
      where + ': no execution in clones/integration carried BASE\'s tree: ' +
      JSON.stringify(entries))

    assert.ok(report.baseline && typeof report.baseline === 'object',
      where + ': report.baseline is a non-null object after Setup completed — ' +
      JSON.stringify(report.baseline))
    assert.deepEqual(Object.keys(report.baseline).sort(), ['output', 'passed'],
      where + ': report.baseline carries exactly passed and output')
    if (shape.greenRun) {
      assert.equal(report.baseline.passed, true,
        where + ': the all-green run\'s report.baseline.passed is true')
      assert.equal(report.waveMerges[0].status, 'MERGED',
        where + ': and its wave merged — ' + JSON.stringify(report.judgmentCalls))
    }
  }
}

// ── (g) the baseline clone is bootstrapped, before its suite runs [M1] ───────
{
  const bootLog = path.join(tmp, 'g-bootstrap.log')
  const { repo, runDir, logPath } = scenario('g')
  const rec = recording()
  const { run, integ, base } = rig({
    repo, runDir, waves: [[task('T1')]], stub: rec.stub, stamp: 'eb-g',
    extraArgs: {
      bootstrapCmd: 'printf "%s %s\\n" "$PWD" "$(date +%s%N)" >> ' + JSON.stringify(bootLog),
    },
  })
  const report = await run()

  const bootLines = (fs.existsSync(bootLog)
    ? fs.readFileSync(bootLog, 'utf8').split('\n').filter(Boolean)
    : []).map((line) => {
      const m = /^(.*) (\S+)$/.exec(line)
      return m ? { dir: m[1], stamp: m[2] } : { dir: line, stamp: '' }
    })

  const onBaseline = runsIn(bootLines, baselineDirOf(runDir))
  assert.equal(onBaseline.length, 1,
    'leg (g) [M1]: bootstrapCmd ran exactly once in <runDir>/clones/baseline — an engine ' +
    'that cuts the clone but never bootstraps it writes no such line: ' +
    JSON.stringify(bootLines))
  assert.equal(runsIn(bootLines, integ).length, 1,
    'leg (g) [M1]: beside the line Setup already writes for clones/integration: ' +
    JSON.stringify(bootLines))
  assert.equal(runsIn(bootLines, taskDirOf(runDir, 'T1')).length, 1,
    'leg (g) [M1]: and the one for clones/task-T1: ' + JSON.stringify(bootLines))

  const suiteOnBaseline = runsIn(suiteRuns(logPath), baselineDirOf(runDir))
  assert.equal(suiteOnBaseline.length, 1,
    'leg (g) [M1]: the baseline suite ran in that clone: ' + JSON.stringify(suiteOnBaseline))
  assert.ok(msOf(onBaseline[0].stamp, 'leg (g) [M1]') <
              msOf(suiteOnBaseline[0].stamp, 'leg (g) [M1]'),
    'leg (g) [M1]: the bootstrap of clones/baseline precedes the baseline suite\'s own ' +
    'stamped line — a suite started before its dependencies are installed is not the ' +
    'baseline this run reads')
  assert.equal(suiteOnBaseline[0].tree, treeOf(base, integ),
    'leg (g) [M1]: and it ran on BASE\'s tree')
  assert.equal(report.baseline.passed, true, 'leg (g) [M1]: report.baseline.passed is true')
}

fs.rmSync(tmp, { recursive: true, force: true })
console.log('ALL TESTS PASSED')
