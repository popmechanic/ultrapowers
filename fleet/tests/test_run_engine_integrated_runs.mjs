// fleet/tests/test_run_engine_integrated_runs.mjs — the INTEGRATED `Run:` proofs
// (#604 (b)+(c)): a `Run:` proof is executed twice. Once per task, in the task's
// own clone, before its review (#589 — test_run_engine_proof_runs.mjs owns that
// leg). And once more by the DRIVER on the tree that actually exists: after a
// wave's candidate is adopted, before the completeness critic is dispatched, in
// the integration clone. The critic is then handed the bytes rather than being
// left to establish them by static trace and file the answer as a cannot-verify
// item — the same move #458 made for the driver-run suite, extended to `Run:`.
//
// Everything below the agent seam is real (git, clones, capture, the fold
// kernel, the real `sh`); only the judgments are canned, so every command
// execution the assertions observe is the driver's own.
//
// Machine clauses under test:
//   M1 — after adopt and before the critic, each `done` task's `proofRuns` runs
//        in Proof order in the integration clone through the same `sh` seam,
//        recorded as { task, cmd, exit, stdout } (stdout+stderr, last 4,000
//        characters) under `report.integratedRuns`, plus one
//        `driver:integrated-run` event per command carrying task, cmd, exit, wave.
//   M2 — the critic's prompt carries the block after the `SUITE (driver-run,
//        post-fold)` section: the opening sentence verbatim, then per command
//        `$ <cmd>`, `exit <n>`, the recorded output. No merged task with
//        `proofRuns` ⇒ no block, and a critic prompt byte-identical to BASE's.
//   M3 — a non-zero integrated exit appends the typed completeness finding
//        { severity: 'blocking', detail: 'integrated Run: <cmd> (task <id>)
//        exited <n> on the adopted tree' } to `completenessFindings` and
//        `judgmentCalls`, so the #474 brake refuses the run; never a
//        `deferredVerification` item.
//   M4 — unmerged tasks and unadopted waves contribute nothing; a run with no
//        `proofRuns` anywhere leaves `integratedRuns` as [] and every captured
//        prompt of every role byte-identical to the same run on BASE's engine.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execSeam, criticDecision } from '../run-main.mjs'
import { makeCwdFor, withPatchCapture, defaultTaskIdOf } from '../run-waves.mjs'
// Namespace import on purpose: at BASE the module provides no
// `integratedRunEvidenceBlock`, and a named import would fail to LINK — the
// whole file would die with a SyntaxError that reads like a typo instead of
// like the absent implementation. The first assertion below names it instead.
import * as engineMod from '../run-engine.mjs'
import { rig, makeRepo, provision, passReview, cleanCritic, doneImpl } from './_engine_helpers.mjs'

const { runEngine, integratedRunEvidenceBlock } = engineMod

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-integrated-runs-'))
// Removed on exit, red or green (rmSync unlinks the base-tree's `skills`
// symlink rather than following it into the repo).
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }))
const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const FLEET_DIR = fileURLToPath(new URL('..', import.meta.url))
const ROLES_DIR = fileURLToPath(new URL('../roles/', import.meta.url))
const BASE_SHA = '0e5ccfa87b9838a419459110360da3da10a70b5a'

// [M2] the block's opening sentence, verbatim from the Machine clause. A stub
// that renders a *similar* sentence is not this leg.
const OPENER =
  'INTEGRATED RUN EVIDENCE: the driver executed each merged task\'s Proof `Run:` commands ' +
  'itself, on the adopted integration tree — this is the authoritative result; a cannot-verify ' +
  'item asking for their re-execution is settled by it.'

// The wave-1 pair every scenario uses: A owns a.txt (which BASE already
// carries, so `test -e a.txt` is true in A's clone and on the folded tree), B
// owns b.txt (which exists only after B's implementer writes it).
const B_CONTENT = 'b-content-marker\n'
const mkTask = (id, file, over = {}) => ({
  id, title: id.toLowerCase(), files: [file], tier: 'standard', review: 'lean',
  writes: [file], commutes: [], proofTests: [], proofRuns: [],
  body: 'task ' + id + ' body', ...over,
})
const fileOf = (id) => (id === 'A' ? 'a.txt' : id === 'B' ? 'b.txt' : id)
const contentOf = (id) => (id === 'A' ? 'from-A\n' : B_CONTENT)

// The run's own record. An absent file reads as no records, so a BASE engine
// that writes none fails a count assertion rather than an ENOENT.
const eventsOf = (runDir) => {
  const file = path.join(runDir, 'events.jsonl')
  if (!fs.existsSync(file)) return []
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l) } catch { return null } })
    .filter(Boolean)
}
const integratedEvents = (runDir) => eventsOf(runDir).filter((e) => e.kind === 'driver:integrated-run')
// The four fields M1 names, so an event carrying them plus the appendEvent
// stamp (id, ts) still compares equal.
const eventShape = (e) => ({ task: e.task, cmd: e.cmd, exit: e.exit, wave: e.wave })
const blockOf = (prompt) => {
  const i = String(prompt || '').indexOf(OPENER)
  return i === -1 ? '' : prompt.slice(i)
}

// ── the Produces contract, as a pure function [M2] ───────────────────────────
// `integratedRunEvidenceBlock(runs) -> string` is what this task publishes, so
// it is pinned directly — including the run-51 rule the global constraints
// restate: empty evidence renders nothing at all.
{
  assert.equal(typeof integratedRunEvidenceBlock, 'function',
    'fleet/run-engine.mjs exports no `integratedRunEvidenceBlock(runs) -> string` ' +
    '(the task\'s Produces contract)')
  assert.equal(integratedRunEvidenceBlock([]), '', 'no integrated runs renders nothing')
  assert.equal(integratedRunEvidenceBlock(undefined), '', 'undefined renders nothing')
  assert.equal(integratedRunEvidenceBlock(null), '', 'null renders nothing')

  const out = integratedRunEvidenceBlock([
    { task: 'A', cmd: 'test -e a.txt', exit: 0, stdout: '' },
    { task: 'B', cmd: 'cat b.txt', exit: 1, stdout: 'no such file\n' },
  ])
  assert.equal(typeof out, 'string', 'the block is a string')
  assert.equal(out.trimStart().slice(0, OPENER.length), OPENER,
    'the block must BEGIN with the sentence the Machine clause fixes, verbatim:\n' +
    'want: ' + OPENER + '\ngot:  ' + out.trimStart().slice(0, OPENER.length))
  // Per command: `$ <cmd>`, `exit <n>`, the recorded output — in that order.
  const iFirst = out.indexOf('$ test -e a.txt')
  const iSecond = out.indexOf('$ cat b.txt')
  assert.ok(iFirst > 0, 'the first command is quoted as `$ <cmd>`: ' + out)
  assert.ok(iSecond > iFirst, 'the second command follows the first: ' + out)
  const seg = out.slice(iSecond)
  assert.ok(seg.indexOf('exit 1') > 0, 'the exit code is rendered as `exit <n>`: ' + seg)
  assert.ok(seg.indexOf('no such file') > seg.indexOf('exit 1'),
    'the recorded output follows the exit line, not only the exit line: ' + seg)
  assert.ok(out.indexOf('exit 0') > 0 && out.indexOf('exit 0') < iSecond,
    'each command carries its own exit line: ' + out)
}

// ── leg (a): two merged tasks, three commands, in Proof order [M1] ───────────
{
  const repo = makeRepo(path.join(tmp, 'repo-a'))
  const runDir = path.join(tmp, 'run-a')
  const waves = [[
    mkTask('A', 'a.txt', { proofRuns: ['test -e a.txt'] }),
    mkTask('B', 'b.txt', { proofRuns: ['test -e b.txt', 'cat b.txt'] }),
  ]]
  const stub = (prompt, opts, cwd) => {
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') {
      const id = opts.label.split(':')[1]
      fs.writeFileSync(path.join(cwd, fileOf(id)), contentOf(id))
      return doneImpl(cwd)
    }
    if (kind === 'review') return passReview()
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run } = rig({ repo, runDir, waves, stub, stamp: 'ir1',
                        extraArgs: { shallowLeg: false } })
  const report = await run()
  assert.equal(report.coverage.complete, true, 'sim precondition: both tasks merged')
  assert.equal(report.tests.passed, true, 'sim precondition: the adopted tree is green')

  // [M1] the report key, its contents and their order.
  assert.ok(Array.isArray(report.integratedRuns),
    'the report carries no `integratedRuns` array: ' + JSON.stringify(report.integratedRuns))
  assert.equal(report.integratedRuns.length, 3,
    'exactly one record per Proof `Run:` command of every merged task: ' +
    JSON.stringify(report.integratedRuns))
  assert.deepEqual(report.integratedRuns.map((r) => ({ task: r.task, cmd: r.cmd, exit: r.exit })), [
    { task: 'A', cmd: 'test -e a.txt', exit: 0 },
    { task: 'B', cmd: 'test -e b.txt', exit: 0 },
    { task: 'B', cmd: 'cat b.txt', exit: 0 },
  ], 'the integrated runs are A\'s command then B\'s two, in Proof order')
  for (const r of report.integratedRuns) {
    assert.deepEqual(Object.keys(r).sort(), ['cmd', 'exit', 'stdout', 'task'],
      'each record is exactly { task, cmd, exit, stdout }: ' + JSON.stringify(r))
    assert.equal(typeof r.stdout, 'string', 'stdout is a string: ' + JSON.stringify(r))
  }
  assert.equal(report.integratedRuns[2].stdout, B_CONTENT,
    '`cat b.txt` records what the file actually holds')

  // [M1] one event per command, carrying task, cmd, exit and the wave number.
  const evs = integratedEvents(runDir)
  assert.equal(evs.length, 3, 'three `driver:integrated-run` events: ' + JSON.stringify(evs))
  assert.deepEqual(evs.map(eventShape), [
    { task: 'A', cmd: 'test -e a.txt', exit: 0, wave: 1 },
    { task: 'B', cmd: 'test -e b.txt', exit: 0, wave: 1 },
    { task: 'B', cmd: 'cat b.txt', exit: 0, wave: 1 },
  ], 'each event carries task, cmd, exit and wave')

  // [M1] the integrated pass runs AFTER the per-task pipeline: every
  // `driver:proof-run` (the #589 clone-local execution) is already recorded
  // when the first `driver:integrated-run` lands.
  const kinds = eventsOf(runDir).map((e) => e.kind)
  assert.ok(kinds.includes('driver:proof-run'),
    'sim precondition: the per-task runs still happen: ' + kinds.join(','))
  assert.ok(kinds.indexOf('driver:integrated-run') > kinds.lastIndexOf('driver:proof-run'),
    'the integrated pass follows every per-task run: ' + kinds.join(','))
}

// ── legs (a) + (b): cwd, stderr, truncation, and what the critic reads ───────
// B carries five commands: the two above, `pwd` (the cwd probe), a stderr-only
// command, and one that prints 6,000 characters.
{
  const STDERR_CMD = "sh -c 'echo err >&2; exit 0'"
  const BIG_CMD = "sh -c 'i=0; while [ $i -lt 6000 ]; do printf x; i=$((i+1)); done'"
  const repo = makeRepo(path.join(tmp, 'repo-b'))
  const runDir = path.join(tmp, 'run-b')
  const waves = [[
    mkTask('A', 'a.txt', { proofRuns: ['test -e a.txt'] }),
    mkTask('B', 'b.txt', { proofRuns: ['test -e b.txt', 'cat b.txt', 'pwd', STDERR_CMD, BIG_CMD] }),
  ]]
  const prompts = {}
  const stub = (prompt, opts, cwd) => {
    prompts[opts.label] = prompt
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') {
      const id = opts.label.split(':')[1]
      fs.writeFileSync(path.join(cwd, fileOf(id)), contentOf(id))
      return doneImpl(cwd)
    }
    if (kind === 'review') return passReview()
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run, integ, clonesDir } = rig({ repo, runDir, waves, stub, stamp: 'ir2',
                                          extraArgs: { shallowLeg: false } })
  const report = await run()
  assert.equal(report.coverage.complete, true, 'sim precondition: both tasks merged')
  assert.equal(report.integratedRuns.length, 6,
    'six commands recorded: ' + JSON.stringify(report.integratedRuns.map((r) => r.cmd)))

  // [M1] the cwd is the INTEGRATION clone, not the task's own.
  const pwdRun = report.integratedRuns.find((r) => r.cmd === 'pwd')
  const printed = String(pwdRun.stdout).split('\n').map((l) => l.trim()).filter(Boolean)
  const wanted = [integ, fs.realpathSync(integ)]
  assert.ok(printed.some((l) => wanted.includes(l)),
    '`pwd` must print the integration clone ' + integ + ', got: ' + JSON.stringify(printed))
  assert.ok(!printed.includes(path.join(clonesDir, 'task-B')),
    '`pwd` printed B\'s own clone — the integrated pass ran in the wrong tree')

  // [M1] stderr is combined into stdout, not dropped.
  const errRun = report.integratedRuns.find((r) => r.cmd === STDERR_CMD)
  assert.equal(errRun.exit, 0, 'the command\'s own exit code')
  assert.ok(/(^|\n)err(\r?\n|$)/.test(errRun.stdout),
    'stderr belongs in the `stdout` field: ' + JSON.stringify(errRun.stdout))

  // [M1] 6,000 characters are stored as exactly the last 4,000.
  const bigRun = report.integratedRuns.find((r) => r.cmd === BIG_CMD)
  assert.equal(bigRun.stdout.length, 4000, 'a 6,000-character output is tailed to 4,000')
  assert.equal(bigRun.stdout, 'x'.repeat(4000), 'and it is the LAST 4,000 characters')

  // [M2] the critic prompt: the block, after the suite section.
  const criticPrompt = prompts['integration']
  assert.equal(typeof criticPrompt, 'string', 'sim precondition: the critic was dispatched')
  assert.ok(criticPrompt.includes(OPENER),
    'the critic prompt does not carry the block\'s opening sentence verbatim:\n' + OPENER)
  const iSuite = criticPrompt.indexOf('\nSUITE (driver-run, post-fold)')
  const iBlock = criticPrompt.indexOf(OPENER)
  const iTasks = criticPrompt.indexOf('\n\nTasks:\n')
  const iContracts = criticPrompt.indexOf('\n\nCONTRACTS (')
  const iBlocked = criticPrompt.indexOf('\nBlocked waves:\n')
  assert.ok(iTasks >= 0 && iContracts > iTasks && iBlocked > iContracts && iSuite > iBlocked,
    'the pre-existing critic sections must keep their order (#458, contracts block)')
  assert.ok(iBlock > iSuite,
    'the integrated-run block belongs AFTER the SUITE (driver-run, post-fold) section')

  // [M2] per command: `$ <cmd>`, `exit <n>`, the recorded output — in order.
  const block = blockOf(criticPrompt)
  const at = (cmd) => {
    const i = block.indexOf('$ ' + cmd)
    assert.ok(i > 0, 'the block does not quote `$ ' + cmd + '`:\n' + block.slice(0, 1200))
    return i
  }
  const iA = at('test -e a.txt')
  const iB1 = at('test -e b.txt')
  const iB2 = at('cat b.txt')
  const iB3 = at('pwd')
  const iB4 = at(STDERR_CMD)
  const iB5 = at(BIG_CMD)
  assert.ok(iA < iB1 && iB1 < iB2 && iB2 < iB3 && iB3 < iB4 && iB4 < iB5,
    'A\'s command comes first, then B\'s five in Proof order')
  assert.ok(block.slice(iA, iB1).includes('exit 0'), 'A\'s command carries `exit 0`')
  // The recorded output follows each command's exit line, not only the exit.
  const catSeg = block.slice(iB2, iB3)
  assert.ok(catSeg.indexOf('exit 0') >= 0 && catSeg.indexOf(B_CONTENT.trim()) > catSeg.indexOf('exit 0'),
    'b.txt\'s content must follow `cat b.txt`\'s exit line: ' + catSeg)
  const errSeg = block.slice(iB4, iB5)
  assert.ok(errSeg.indexOf('exit 0') >= 0 && /exit 0[\s\S]*(^|\n)err(\r?\n|$)/.test(errSeg),
    'the stderr proof\'s `err` must follow its exit line: ' + errSeg)
  // Format-agnostic truncation pin: the output is one unbroken run of `x`, so
  // the longest such run in the prompt IS the rendered output's length.
  const xruns = (criticPrompt.match(/x+/g) || []).map((r) => r.length)
  assert.equal(Math.max(0, ...xruns), 4000,
    'the 6,000-character output is shown to the critic as exactly its last 4,000')
}

// ── legs (b) + (d): no proofRuns ⇒ no block, no runs, BASE's prompts [M2, M4] ─
// The BASE engine, written beside its siblings in a temp copy of fleet/ and
// imported from there, is driven by the same canned agents through the same run
// directory (prompts name the patch FILE, so a second directory would differ in
// bytes that are not this change).
// The byte-pin needs BASE in the object store. A depth-1 clone — the engine's
// own shallow leg and `actions/checkout`'s default — has no 0e5ccfa; there the
// leg has nothing to say and says so, rather than failing for a reason
// unrelated to the tree (test_run_engine_proof_runs.mjs guards the same way).
const haveBase = (() => {
  try {
    execFileSync('git', ['cat-file', '-e', BASE_SHA + '^{commit}'],
      { cwd: REPO_ROOT, stdio: 'ignore' })
    return true
  } catch { return false }
})()
let baseRunEngine = null
if (haveBase) {
  const baseTree = path.join(tmp, 'base-tree')
  fs.cpSync(FLEET_DIR, path.join(baseTree, 'fleet'), {
    recursive: true, filter: (src) => path.basename(src) !== 'tests',
  })
  fs.writeFileSync(path.join(baseTree, 'fleet', 'run-engine.mjs'),
    execFileSync('git', ['show', BASE_SHA + ':fleet/run-engine.mjs'],
      { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }))
  fs.symlinkSync(path.join(REPO_ROOT, 'skills'), path.join(baseTree, 'skills'))
  ;({ runEngine: baseRunEngine } =
    await import(pathToFileURL(path.join(baseTree, 'fleet', 'run-engine.mjs')).href))
} else {
  console.log('[M4] BASE ' + BASE_SHA + ' is not in this clone (shallow) — the ' +
    'byte-for-byte comparison against the BASE engine is skipped')
}

const PIN_REPO = makeRepo(path.join(tmp, 'pin-repo'))
const pinRunDir = path.join(tmp, 'pin-run')
// Every prompt of every role the run dispatches, keyed by label — the roles
// this run reaches are impl, review and integration (a task with no proofTests
// dispatches no examiner, as test_run_engine_proof_runs.mjs pins).
async function pinRun(engine, tasks) {
  fs.rmSync(pinRunDir, { recursive: true, force: true })
  const { base, clonesDir, patchesDir } =
    provision({ repo: PIN_REPO, runDir: pinRunDir, taskIds: tasks.map((t) => t.id) })
  const patchBase = { current: base }
  const cwdFor = makeCwdFor({ clonesDir })
  const prompts = {}
  const inner = async (p, opts) => {
    const cwd = cwdFor(opts)
    prompts[opts.label] = p
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') {
      const id = opts.label.split(':')[1]
      fs.writeFileSync(path.join(cwd, fileOf(id)), contentOf(id))
      return doneImpl(cwd)
    }
    if (kind === 'review') return passReview()
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const agent = withPatchCapture({
    agent: inner, clonesDir, base: () => patchBase.current, patchesDir, taskIdOf: defaultTaskIdOf,
  })
  const report = await engine({
    args: {
      waves: [tasks], edges: [], testCmd: 'bash check.sh',
      acceptance: { mode: 'suite', reason: 'sim' }, stamp: 'pin',
      integrationBranch: 'ultra/integration-pin', dependencyEdges: [],
      patchInput: patchesDir, shallowLeg: false,
    },
    agent,
    parallel: (thunks) => Promise.all(thunks.map((t) => t())),
    exec: execSeam,
    paths: { repoDir: PIN_REPO, runDir: pinRunDir, clonesDir },
    log: () => {},
    rolesDir: ROLES_DIR,
    patchBase,
  })
  return { prompts, report, events: integratedEvents(pinRunDir) }
}
{
  const pair = () => [mkTask('A', 'a.txt', { proofRuns: [] }), mkTask('B', 'b.txt', { proofRuns: [] })]
  const absentPair = () => pair().map((t) => { const c = { ...t }; delete c.proofRuns; return c })

  const basePin = haveBase ? await pinRun(baseRunEngine, pair()) : null
  const liveEmpty = await pinRun(runEngine, pair())
  const liveAbsent = await pinRun(runEngine, absentPair())

  for (const [name, p] of [...(basePin ? [['BASE', basePin]] : []),
                           ['proofRuns: []', liveEmpty], ['no proofRuns key', liveAbsent]]) {
    assert.equal(p.report.coverage.complete, true, name + ': sim precondition — both tasks merged')
    assert.ok(!String(p.prompts['integration'] || '').includes('INTEGRATED RUN EVIDENCE:'),
      name + ': a run with no `Run:` proofs must render no block at all (the run-51 rule)')
  }
  // [M4] the report key exists and is empty — not absent, not populated.
  assert.deepEqual(liveEmpty.report.integratedRuns, [],
    'an empty proofRuns leaves integratedRuns as []')
  assert.deepEqual(liveAbsent.report.integratedRuns, [],
    'an absent proofRuns leaves integratedRuns as []')
  assert.deepEqual(liveEmpty.events, [], 'and records no driver:integrated-run event')
  assert.deepEqual(liveAbsent.events, [], 'and records no driver:integrated-run event')

  if (basePin) {
    // [M4] every captured prompt of every role, byte for byte.
    assert.deepEqual(Object.keys(liveEmpty.prompts).sort(), Object.keys(basePin.prompts).sort(),
      'the same roles are dispatched as on BASE\'s engine')
    for (const label of Object.keys(basePin.prompts).sort()) {
      assert.equal(liveEmpty.prompts[label], basePin.prompts[label],
        'proofRuns: [] must leave the ' + label + ' prompt byte-identical to BASE\'s')
      assert.equal(liveAbsent.prompts[label], basePin.prompts[label],
        'an absent proofRuns must leave the ' + label + ' prompt byte-identical to BASE\'s')
    }
  }
}

// ── leg (c): green in the clone, red on the adopted tree [M3] ────────────────
// A's proof asserts b.txt is ABSENT: true in A's own clone (so #589 dispatches
// no fix round), false once B's b.txt is folded in. That difference is the whole
// point of running the proofs a second time.
{
  const CMD = 'test ! -e b.txt'
  const DETAIL = 'integrated Run: ' + CMD + ' (task A) exited 1 on the adopted tree'
  const repo = makeRepo(path.join(tmp, 'repo-c'))
  const runDir = path.join(tmp, 'run-c')
  const waves = [[
    mkTask('A', 'a.txt', { proofRuns: [CMD] }),
    mkTask('B', 'b.txt'),
  ]]
  const prompts = {}
  const calls = []
  const stub = (prompt, opts, cwd) => {
    calls.push(opts.label)
    prompts[opts.label] = prompt
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') {
      const id = opts.label.split(':')[1]
      fs.writeFileSync(path.join(cwd, fileOf(id)), contentOf(id))
      return doneImpl(cwd)
    }
    if (kind === 'review') return passReview()
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run } = rig({ repo, runDir, waves, stub, stamp: 'ir3',
                        extraArgs: { shallowLeg: false } })
  const report = await run()
  // The clone-local run was green: no fix round, and A merged.
  assert.ok(!calls.some((l) => l.startsWith('fix:')),
    'sim precondition: the proof passes in A\'s own clone: ' + calls.join(','))
  assert.equal(report.coverage.complete, true, 'sim precondition: both tasks merged')
  assert.equal(report.tests.passed, true, 'sim precondition: the adopted tree is green')

  // [M3] the integrated execution disagrees with the clone-local one.
  assert.deepEqual(report.integratedRuns.map((r) => ({ task: r.task, cmd: r.cmd, exit: r.exit })),
    [{ task: 'A', cmd: CMD, exit: 1 }],
    'the integrated run records exit 1 on the folded tree')
  assert.deepEqual(integratedEvents(runDir).map(eventShape),
    [{ task: 'A', cmd: CMD, exit: 1, wave: 1 }],
    'and the event carries the non-zero exit')

  // [M3] the typed completeness finding, verbatim.
  const blocking = report.completenessFindings
    .filter((f) => f && typeof f === 'object' && f.severity === 'blocking')
  assert.equal(blocking.length, 1,
    'exactly one blocking completeness finding: ' + JSON.stringify(report.completenessFindings))
  assert.deepEqual(Object.keys(blocking[0]).sort(), ['detail', 'severity'],
    'the finding is the same {severity, detail} shape a critic returns')
  assert.equal(blocking[0].detail, DETAIL,
    'the finding\'s detail is fixed by the Machine clause, verbatim')

  // [M3] the run's judgment calls name it too.
  assert.ok(report.judgmentCalls.some((j) => String(j).includes(DETAIL)),
    'the judgment calls do not name the failed integrated run: ' +
    JSON.stringify(report.judgmentCalls))

  // [M3] never a deferral — the driver has the answer, so nothing is deferred.
  assert.deepEqual(report.deferredVerification, [],
    'a red integrated run is a blocking finding, never a deferredVerification item')

  // [M3] the #474 brake: the gate refuses the run.
  const decision = criticDecision(report)
  assert.equal(decision.approve, false,
    'the completeness brake must refuse a run with a red integrated Run: proof')
  assert.ok(String(decision.reason).includes(CMD),
    'the refusal names the command: ' + decision.reason)

  // [M2] and the critic read the red run before filing anything.
  const block = blockOf(prompts['integration'])
  assert.ok(block.includes('$ ' + CMD) && block.slice(block.indexOf('$ ' + CMD)).includes('exit 1'),
    'the critic prompt shows the failing command and its exit: ' + block.slice(0, 800))
}

// ── leg (d): a task that never merged contributes nothing [M4] ───────────────
{
  const repo = makeRepo(path.join(tmp, 'repo-d1'))
  const runDir = path.join(tmp, 'run-d1')
  const waves = [[
    mkTask('A', 'a.txt', { proofRuns: ['test -e a.txt'] }),
    mkTask('B', 'b.txt', { proofRuns: ['test -e b.txt'] }),
  ]]
  const stub = (prompt, opts, cwd) => {
    const kind = opts.label.split(':')[0]
    const id = opts.label.split(':')[1]
    if (kind === 'impl') {
      fs.writeFileSync(path.join(cwd, fileOf(id)), contentOf(id))
      return doneImpl(cwd)
    }
    if (kind === 'fix') return { status: 'BLOCKED', summary: 'sim: B cannot be repaired' }
    if (kind === 'review') {
      return id === 'A' ? passReview()
        : { verdict: 'FIX_REQUIRED', issues: [{ severity: 'blocking', detail: 'B is not ready' }] }
    }
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run } = rig({ repo, runDir, waves, stub, stamp: 'ir4',
                        extraArgs: { shallowLeg: false } })
  const report = await run()
  const rowB = report.tasks.find((r) => r.task === 'B')
  assert.equal(rowB.status, 'failed', 'sim precondition: B never merged')
  assert.equal(rowB.reviewVerdict, 'blocked-after-fix', 'sim precondition: B is blocked after its fix round')
  assert.equal(report.waveMerges[0].status, 'MERGED', 'sim precondition: A\'s wave was adopted')

  // [M4] only the merged task's commands ran.
  assert.deepEqual(report.integratedRuns.map((r) => ({ task: r.task, cmd: r.cmd, exit: r.exit })),
    [{ task: 'A', cmd: 'test -e a.txt', exit: 0 }],
    'a task that did not merge contributes no integrated run')
  assert.ok(!report.integratedRuns.some((r) => r.task === 'B' || r.cmd === 'test -e b.txt'),
    'B\'s command must not run on a tree that never took B\'s work')
  assert.deepEqual(integratedEvents(runDir).map(eventShape),
    [{ task: 'A', cmd: 'test -e a.txt', exit: 0, wave: 1 }],
    'and no event names B')
}

// ── leg (d): a wave whose candidate was never adopted [M4] ──────────────────
{
  const repo = makeRepo(path.join(tmp, 'repo-d2'))
  const runDir = path.join(tmp, 'run-d2')
  const waves = [[
    mkTask('A', 'a.txt', { proofRuns: ['test -e a.txt'] }),
    // BROKEN is the marker check.sh fails on: the candidate suite goes red.
    mkTask('B', 'BROKEN', { proofRuns: ['test -e BROKEN'] }),
  ]]
  const stub = (prompt, opts, cwd) => {
    const kind = opts.label.split(':')[0]
    const id = opts.label.split(':')[1]
    if (kind === 'impl') {
      fs.writeFileSync(path.join(cwd, id === 'A' ? 'a.txt' : 'BROKEN'), contentOf(id))
      return doneImpl(cwd)
    }
    if (kind === 'review') return passReview()
    if (kind === 'reconcile') return { status: 'BLOCKED', summary: 'sim: no repair' }
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run } = rig({ repo, runDir, waves, stub, stamp: 'ir5',
                        extraArgs: { shallowLeg: false } })
  const report = await run()
  assert.equal(report.waveMerges[0].status, 'TEST_FAILED',
    'sim precondition: the candidate suite went red and was never adopted')
  assert.deepEqual(report.tasks.map((r) => r.status), ['done', 'done'],
    'sim precondition: both tasks passed their own review and carried proofRuns')
  assert.equal(eventsOf(runDir).filter((e) => e.kind === 'driver:proof-run').length, 2,
    'sim precondition: the per-task runs still happened in the clones')

  // [M4] no adopted tree, no integrated runs.
  assert.deepEqual(report.integratedRuns, [],
    'an unadopted candidate contributes no integrated runs')
  assert.deepEqual(integratedEvents(runDir), [],
    'and no driver:integrated-run event is written')
}

console.log('ALL TESTS PASSED')
