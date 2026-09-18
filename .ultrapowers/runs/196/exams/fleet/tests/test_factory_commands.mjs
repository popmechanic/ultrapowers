#!/usr/bin/env node
// fleet/tests/test_factory_commands.mjs — the exam for factory/commands.mjs's
// `runAll`/`bootstrapFor` and for the three places factory/engine.mjs is to
// route through them (measuring a candidate, the fold check, and the
// run_exam tool), plus the bootstrap-every-clone wiring.
//
// Legs (a) and (b) drive the two new exports directly, with a small fake
// `sh` of this file's own. Legs (c) and (d) drive `runEngine` end to end —
// real git clones, a real fold kernel call, a real plan compile — with only
// the model-facing seams (`worker`, `judge`, `sh`, `git`) faked, exactly the
// way the task's Context describes the intended rig.
//
// factory/engine.mjs's own plan compile is NOT an injectable seam: it is a
// hardcoded `spawnSync('python3', [COMPILER, plan])` with no `deps` hook, and
// the real compiler does not yet print a task's `testCmds` array (a sibling
// task's job). So `withCompiledPlan` below puts a directory holding an
// executable literally named `python3` first on `process.env.PATH` for the
// span of one `runEngine()` call, and that shim's only job is to `cat` a
// JSON document this file already built — no shell of the real compiler
// output, no reliance on the sibling task having landed. This is the one
// place this file touches `process.env` rather than `simEnv()`: there is no
// seam to hand an env to that spawnSync at all, so the alternative is not
// "a plain env instead of simEnv()" but "no control over the compiler's
// output whatsoever". PATH is saved and restored in a `finally`, and only a
// `python3` file is added ahead of it, so `git`/`bash`/`sh` resolution is
// untouched. Every process this file starts DIRECTLY (git, for its own
// fixture repos and as the `deps.git` this hands `runEngine`) passes
// `env: GIT_ENV`, built by `simEnv()` — never `process.env`.

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

import { simEnv } from './_helpers.mjs'
import { runAll, bootstrapFor } from '../../factory/commands.mjs'
import { runEngine } from '../../factory/engine.mjs'

const GIT_ENV = simEnv()

// ── shared fixture plumbing (used by legs c and d) ──────────────────────────

function tmp (prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

function gitAt (dir) {
  return (argv) => execFileSync('git', argv, { cwd: dir, env: GIT_ENV, encoding: 'utf8' })
}

/** A target repo with the given files committed on `main`; answers the base sha. */
function initRepo (dir, files) {
  fs.mkdirSync(dir, { recursive: true })
  const git = gitAt(dir)
  git(['init', '-q', '-b', 'main'])
  git(['config', 'user.email', 'sim@test'])
  git(['config', 'user.name', 'sim'])
  for (const [name, content] of Object.entries(files)) {
    const at = path.join(dir, name)
    fs.mkdirSync(path.dirname(at), { recursive: true })
    fs.writeFileSync(at, content)
  }
  git(['add', '-A'])
  git(['commit', '-q', '-m', 'base'])
  return git(['rev-parse', 'HEAD']).trim()
}

/** The engine's own `git` dependency, hermetic: real git, `simEnv()`'s env. */
const gitDep = (argv, cwd) => execFileSync('git', argv, { cwd, env: GIT_ENV, encoding: 'utf8' })

/** A fake `sh`: records every `(cmd, argv, cwd)` call, answers the fold
 *  kernel's two calls without a real kernel, and otherwise answers whatever
 *  the rig configured via `.on(test, exit, out)` (first match wins), falling
 *  back to a quiet exit 0. */
function makeSh ({ baseSha }) {
  const calls = []
  const overrides = []
  function sh (cmd, argv = [], cwd) {
    calls.push({ cmd, argv: argv.slice(), cwd })
    if (cmd === 'python3' && argv[0] && String(argv[0]).endsWith('fold_wave.py')) {
      if (argv[1] === 'materialize') return { status: 0, stdout: JSON.stringify({ candidateSha: baseSha }) }
      return { status: 0, stdout: JSON.stringify({ complete: true }) }
    }
    for (const o of overrides) {
      if (o.test(cmd, argv, cwd)) return { status: o.exit, stdout: o.out || '' }
    }
    return { status: 0, stdout: '' }
  }
  sh.calls = calls
  sh.on = (test, exit, out) => overrides.push({ test, exit, out })
  return sh
}

/** Matches an engine-issued `sh('timeout', [seconds, ...cmd.split(/\s+/)], cwd)`
 *  call by the command text alone (ignoring the timeout seconds and the cwd). */
const argvIs = (expected) => (cmd, argv) => cmd === 'timeout' && argv.slice(1).join(' ') === expected

/** A fake worker: writes each of `opts.files` (the exam's proofTests, or the
 *  implementer's own files) into `opts.cwd` with fixed, non-empty content —
 *  enough for `git add -A` to see a real, capturable change. */
function makeWorker () {
  return async (opts) => {
    for (const p of (opts.files || [])) {
      const at = path.join(opts.cwd, p)
      fs.mkdirSync(path.dirname(at), { recursive: true })
      fs.writeFileSync(at, '// fixture ' + opts.role + ' write for ' + p + '\n')
    }
    return { result: { result: 'ok', total_cost_usd: 0 }, denials: [] }
  }
}

/** One task's compiled view, in the shape `skills/ultrapowers/scripts/plan_parse.py`
 *  prints per task — plus `testCmds` when the fixture supplies it, standing
 *  in for the sibling task that teaches the real parser to print that field. */
function planDoc (task) {
  const view = {
    id: task.id,
    title: task.title || ('task ' + task.id),
    files: task.files || [],
    depends_on: [],
    proofTests: task.proofTests || [],
    testCmd: task.testCmd ?? null,
    interfaces: { consumes: [], produces: [] },
    proofGuards: [],
    runOnlyClauses: [],
  }
  if (task.testCmds !== undefined) view.testCmds = task.testCmds
  return { tasks: [view], dag_edges: [], launch_waves: [[view]], pairs: [] }
}

function planMarkdown (id) {
  return '### Task ' + id + ': fixture task\n\n' +
    'Fixture body text for the exam.\n\n' +
    'Machine: M1. fixture clause.\n\n'
}

/** Puts a directory holding a fake `python3` (that only ever `cat`s the JSON
 *  document this file built) first on PATH for the span of `fn`, so
 *  engine.mjs's hardcoded, non-injectable compiler spawn answers `doc`
 *  exactly, restoring PATH and the marker env var afterwards regardless of
 *  how `fn` ends. */
async function withCompiledPlan (doc, fn) {
  const dir = tmp('factory-shim-')
  const jsonPath = path.join(dir, 'plan.json')
  fs.writeFileSync(jsonPath, JSON.stringify(doc))
  const shimPath = path.join(dir, 'python3')
  fs.writeFileSync(shimPath, '#!/bin/sh\ncat "$FACTORY_TEST_PLAN_JSON"\n')
  fs.chmodSync(shimPath, 0o755)
  const savedPath = process.env.PATH
  const savedJson = process.env.FACTORY_TEST_PLAN_JSON
  process.env.PATH = dir + path.delimiter + savedPath
  process.env.FACTORY_TEST_PLAN_JSON = jsonPath
  try {
    return await fn()
  } finally {
    process.env.PATH = savedPath
    if (savedJson === undefined) delete process.env.FACTORY_TEST_PLAN_JSON
    else process.env.FACTORY_TEST_PLAN_JSON = savedJson
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

function readEvents (runDir) {
  const text = fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8')
  return text.split('\n').filter(Boolean).map((l) => JSON.parse(l))
}

/** One full `runEngine` drive over a single-task plan naming `doc.tasks[0]`. */
async function runRig ({ target, runDir, base, doc, judge, sh, tools, policy }) {
  const planDir = tmp('factory-plan-')
  const planPath = path.join(planDir, 'plan.md')
  fs.writeFileSync(planPath, planMarkdown(doc.tasks[0].id))
  const policyPath = path.join(planDir, 'policy.json')
  fs.writeFileSync(policyPath, JSON.stringify(policy))
  const args = { plan: planPath, target, runDir, base, policy: policyPath }
  const deps = { worker: makeWorker(), judge, sh, git: gitDep, tools }
  return withCompiledPlan(doc, () => runEngine(args, deps))
}

const BASE_POLICY = {
  pairs: { mode: 'off' },
  select: { enabled: false },
  landing: { redispatch: { enabled: false } },
}

async function main () {
  // ── Leg (a) — M1: runAll ──────────────────────────────────────────────
  {
    const calls = []
    const sh = (cmd, argv, cwd) => {
      calls.push([cmd, argv, cwd])
      return calls.length === 1 ? { status: 0, stdout: 'OUT_A' } : { status: 1, stdout: 'OUT_B' }
    }
    const cwd = '/tmp/rig-a1'
    const result = runAll({ cmds: ['node a.mjs', 'python3 -m pytest -q t.py'], cwd, sh, timeoutSeconds: 300 })
    assert.equal(calls.length, 2,
      '[M1] runAll runs each command in cmds, in order, until one fails')
    assert.deepEqual(calls[0], ['timeout', ['300', 'node', 'a.mjs'], cwd],
      '[M1] the first command runs as sh(\'timeout\', [seconds, ...split-on-whitespace], cwd)')
    assert.deepEqual(calls[1], ['timeout', ['300', 'python3', '-m', 'pytest', '-q', 't.py'], cwd],
      '[M1] the second command runs the same way, split on whitespace')
    assert.equal(result.exit, 1,
      '[M1] exit is the first non-zero exit it saw')
    assert.deepEqual(result.ran, [{ cmd: 'node a.mjs', exit: 0 }, { cmd: 'python3 -m pytest -q t.py', exit: 1 }],
      '[M1] ran carries one {cmd, exit} per command actually run, in order')
    assert.equal(typeof result.out, 'string', '[M1] out is a string')
    assert.ok(result.out.includes('OUT_A') && result.out.includes('OUT_B') &&
      result.out.indexOf('OUT_A') < result.out.indexOf('OUT_B'),
      '[M1] out is the concatenated output of every command actually run, in order')
  }
  {
    const calls = []
    const sh = (cmd, argv, cwd) => { calls.push([cmd, argv, cwd]); return { status: 2, stdout: 'X' } }
    const result = runAll({ cmds: ['node a.mjs', 'python3 -m pytest -q t.py'], cwd: '/tmp/rig-a2', sh, timeoutSeconds: 300 })
    assert.equal(calls.length, 1,
      '[M1] runAll stops at the first non-zero exit and never runs the rest of cmds')
    assert.equal(result.exit, 2,
      '[M1] exit is that first non-zero exit')
    assert.deepEqual(result.ran, [{ cmd: 'node a.mjs', exit: 2 }],
      '[M1] ran holds only the one command that actually ran')
  }
  {
    let called = false
    const sh = () => { called = true; return { status: 0 } }
    const result = runAll({ cmds: [], cwd: '/tmp/rig-a3', sh, timeoutSeconds: 300 })
    assert.equal(called, false,
      '[M1] with cmds empty, runAll calls sh nothing')
    assert.deepEqual(result, { exit: 0, out: '', ran: [] },
      '[M1] with cmds empty, runAll answers exactly { exit: 0, out: \'\', ran: [] }')
  }

  // ── Leg (b) — M2: bootstrapFor ───────────────────────────────────────
  assert.equal(bootstrapFor({ planCmd: 'make deps', files: ['bun.lock'] }), 'make deps',
    '[M2] a non-empty planCmd wins over any file evidence')
  assert.equal(bootstrapFor({ planCmd: null, files: ['bun.lock'] }), 'bun install --frozen-lockfile',
    '[M2] with no planCmd, bun.lock among files selects the bun bootstrap')
  assert.equal(bootstrapFor({ planCmd: null, files: ['bun.lockb'] }), 'bun install --frozen-lockfile',
    '[M2] bun.lockb also selects the bun bootstrap')
  assert.equal(bootstrapFor({ planCmd: null, files: ['package-lock.json'] }), 'npm ci',
    '[M2] with no planCmd, package-lock.json among files selects npm ci')
  assert.equal(bootstrapFor({ planCmd: null, files: ['a.py'] }), null,
    '[M2] with no planCmd and no recognized lockfile, bootstrapFor answers null')
  assert.equal(bootstrapFor({ planCmd: '', files: ['bun.lock'] }), 'bun install --frozen-lockfile',
    '[M2] an empty-string planCmd is not a non-empty string, so file evidence still decides')
  assert.equal(bootstrapFor({ planCmd: undefined, files: [] }), null,
    '[M2] undefined planCmd and no files answers null')

  // ── Leg (c) — M3: measuring, the fold check, and run_exam all through runAll
  {
    const targetDir = tmp('factory-target-c-')
    const base = initRepo(targetDir, { 'a.txt': 'x\n' })
    const runDir = tmp('factory-run-c-')
    const sh = makeSh({ baseSha: base })
    sh.on(argvIs('node a.mjs'), 0, 'A_OUT')
    sh.on(argvIs('python3 -m pytest -q t.py'), 1, 'B_OUT')

    let capturedRunExam = null
    const tools = async ({ runExam }) => { capturedRunExam = runExam; return {} }

    const doc = planDoc({
      id: 'T1',
      files: ['impl-note.txt'],
      proofTests: ['exam.txt'],
      testCmd: 'node a.mjs && python3 -m pytest -q t.py',
      testCmds: ['node a.mjs', 'python3 -m pytest -q t.py'],
    })
    const policy = {
      ...BASE_POLICY,
      fold: { reverify: { enabled: true, max_run: 6, timeout_seconds: 5 } },
    }
    const judge = { readTask: async () => ({ k: 1, referee: false }) }

    await runRig({ target: targetDir, runDir, base, doc, judge, sh, tools, policy })

    const events = readEvents(runDir)
    const landing = events.find((e) => e.kind === 'landing' && e.task === 'T1')
    assert.ok(landing, '[M3] the task lands (adopts) so a landing row exists')
    assert.equal(landing.examExit, 1,
      '[M3] measuring the candidate runs every one of testCmds through runAll — the second command\'s non-zero exit is the exam\'s exit')

    const foldVerifyDir = path.join(runDir, 'fold-verify-T1')
    const inFoldVerify = sh.calls.filter((c) => c.cwd === foldVerifyDir)
    assert.ok(inFoldVerify.some((c) => argvIs('node a.mjs')(c.cmd, c.argv)),
      '[M3] the fold check\'s recorded sh calls include the first of the task\'s testCmds')
    assert.ok(inFoldVerify.some((c) => argvIs('python3 -m pytest -q t.py')(c.cmd, c.argv)),
      '[M3] the fold check\'s recorded sh calls include the second of the task\'s testCmds too')

    assert.equal(typeof capturedRunExam, 'function',
      '[M3] the run_exam tool is served to the fake tools dep')
    const runExamResult = await capturedRunExam()
    assert.equal(runExamResult.exit, 1,
      '[M3] the run_exam tool also runs the task\'s testCmds through runAll, and resolves the second command\'s exit')
  }

  // ── Leg (d) part 1 — M4: every clone gets its dependencies installed once,
  //    before its test command runs there ───────────────────────────────
  {
    const targetDir = tmp('factory-target-d1-')
    const base = initRepo(targetDir, { 'bun.lock': 'lockfileVersion 0\n', 'a.txt': 'x\n' })
    const runDir = tmp('factory-run-d1-')
    const sh = makeSh({ baseSha: base })
    sh.on(argvIs('bun install --frozen-lockfile'), 0, 'INSTALLED')
    sh.on(argvIs('node run.mjs'), 0, 'RAN')

    const doc = planDoc({
      id: 'T1', files: ['impl-note.txt'], proofTests: ['exam.txt'], testCmd: 'node run.mjs',
    })
    const policy = { ...BASE_POLICY, fold: { reverify: { enabled: false } } }
    const judge = { readTask: async () => ({ k: 2, referee: false }) }

    await runRig({ target: targetDir, runDir, base, doc, judge, sh, policy })

    const implDirs = [path.join(runDir, 'impl-T1-0'), path.join(runDir, 'impl-T1-1')]
    for (const dir of implDirs) {
      const inDir = sh.calls.filter((c) => c.cwd === dir)
      const testCalls = inDir.filter((c) => argvIs('node run.mjs')(c.cmd, c.argv))
      assert.equal(testCalls.length, 1,
        '[M3][M4] the test command ran exactly once in ' + dir +
        ' (falling back to [task.testCmd], since the parser printed no testCmds here)')
      const bootstrapCalls = inDir.filter((c) => argvIs('bun install --frozen-lockfile')(c.cmd, c.argv))
      assert.equal(bootstrapCalls.length, 1,
        '[M4] the clone\'s dependencies are installed exactly once, in ' + dir)
      assert.ok(inDir.length > 0 && argvIs('bun install --frozen-lockfile')(inDir[0].cmd, inDir[0].argv),
        '[M4] the bootstrap is the first thing that runs in ' + dir + ', before the test command')
    }
  }

  // ── Leg (d) part 2 — M4: a red bootstrap install parks the task, and no
  //    test command runs in that clone ───────────────────────────────────
  {
    const targetDir = tmp('factory-target-d2-')
    const base = initRepo(targetDir, { 'bun.lock': 'lockfileVersion 0\n', 'a.txt': 'x\n' })
    const runDir = tmp('factory-run-d2-')
    const sh = makeSh({ baseSha: base })
    const MARKER = 'BOOTSTRAP_FAIL_MARKER_D2'
    // The specific (implementer-clone) failure is registered before the
    // general success case, so it wins for cwds under an impl- clone and the
    // general case (or the default exit-0 fallback) covers every other clone.
    sh.on((cmd, argv, cwd) => argvIs('bun install --frozen-lockfile')(cmd, argv) &&
      cwd.includes(path.sep + 'impl-'), 1, MARKER)
    sh.on(argvIs('bun install --frozen-lockfile'), 0, 'INSTALLED')
    sh.on(argvIs('node run.mjs'), 0, 'RAN')

    const doc = planDoc({
      id: 'T1', files: ['impl-note.txt'], proofTests: ['exam.txt'], testCmd: 'node run.mjs',
    })
    const policy = { ...BASE_POLICY, fold: { reverify: { enabled: false } } }
    const judge = { readTask: async () => ({ k: 1, referee: false }) }

    await runRig({ target: targetDir, runDir, base, doc, judge, sh, policy })

    const events = readEvents(runDir)
    const red = events.find((e) => e.kind === 'bootstrap:red')
    assert.ok(red, '[M4] a non-zero bootstrap install appends a bootstrap:red row')
    assert.equal(red.exit, 1, '[M4] the bootstrap:red row carries the exit that failed')
    assert.equal(red.clone, path.join(runDir, 'impl-T1-0'),
      '[M4] the bootstrap:red row names the clone whose install failed')

    const parked = events.find((e) => e.kind === 'parked' && e.task === 'T1')
    assert.ok(parked, '[M4] the task that clone was made for parks')
    assert.ok(parked.reason && parked.reason.includes(MARKER),
      '[M4] the park reason carries the failed install\'s output tail')

    const implDir = path.join(runDir, 'impl-T1-0')
    const ranTestThere = sh.calls.some((c) => c.cwd === implDir && argvIs('node run.mjs')(c.cmd, c.argv))
    assert.equal(ranTestThere, false,
      '[M4] no test command ran in the clone whose bootstrap failed')
  }

  // ── Leg (d) part 3 — M4: nothing to bootstrap runs nothing ─────────────
  {
    const targetDir = tmp('factory-target-d3-')
    const base = initRepo(targetDir, { 'a.txt': 'x\n' })
    const runDir = tmp('factory-run-d3-')
    const sh = makeSh({ baseSha: base })
    sh.on(argvIs('node run.mjs'), 0, 'RAN')

    const doc = planDoc({
      id: 'T1', files: ['impl-note.txt'], proofTests: ['exam.txt'], testCmd: 'node run.mjs',
    })
    const policy = { ...BASE_POLICY, fold: { reverify: { enabled: false } } }
    const judge = { readTask: async () => ({ k: 1, referee: false }) }

    await runRig({ target: targetDir, runDir, base, doc, judge, sh, policy })

    const bad = sh.calls.filter((c) => c.argv.includes('install') || c.argv.includes('ci'))
    assert.equal(bad.length, 0,
      '[M4] with no lockfile and no bootstrapCmd, bootstrapFor answers null and nothing runs for it, in any clone')

    const events = readEvents(runDir)
    assert.ok(!events.some((e) => e.kind === 'bootstrap:red'),
      '[M4] with nothing to bootstrap there is no bootstrap:red row')
    const landing = events.find((e) => e.kind === 'landing' && e.task === 'T1')
    assert.ok(landing, '[M4] the task still lands normally when bootstrapFor answers null')
  }

  console.log('ALL TESTS PASSED')
}

main().catch((e) => {
  console.error(e && e.stack ? e.stack : e)
  process.exit(1)
})
