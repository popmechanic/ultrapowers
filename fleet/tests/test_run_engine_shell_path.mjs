/**
 * fleet/tests/test_run_engine_shell_path.mjs — the sandbox toolchain rides first
 * on the PATH of every shell command the driver runs (#1051).
 *
 * Everything below the agent seam is real: real git repos, real clones, the real
 * `sh` adapter (`bash -lc`) through the real `execSeam`. Only the judgments are
 * canned — so the PATH these assertions read is the PATH the driver's own
 * commands actually saw.
 *
 * How PATH is observed, once, for every leg: each command the sim hands the rig
 * is `printf %s "$PATH" > <absolute temp file>`, and the exam reads the first
 * `:`-separated entry of the file the command wrote. The command carries no
 * `PATH=` token and never names the toolchain directory, which is also what
 * makes leg (g)'s reading of the recorded `cmd` honest.
 *
 * Machine clauses under test:
 *   M1  every shell command the engine runs through its `bash -lc` adapter —
 *       the suite (`testCmd`), a Proof `Run:` command, a Global `Check:`
 *       command and a task's exam command — sees a `PATH` whose first entry is
 *       `args.toolchainBin` when that is a non-empty string, else
 *       `TOOLCHAIN_BIN`, followed by the PATH it would otherwise have had.
 *   M2  `fleet/run-engine.mjs` exports `TOOLCHAIN_BIN` equal to `/usr/local/bin`.
 *   M3  the prefix survives a login profile that reassigns `PATH`: with a `HOME`
 *       whose `.bash_profile` prepends a sentinel directory, the command's first
 *       entry is still the toolchain directory and the sentinel appears after it.
 *   M4  the `cmd` recorded on `driver:proof-run`, `driver:check-run` and
 *       `driver:exam-run` carries no PATH prefix: the first two are the command
 *       as the plan wrote it, the third is the `examRunCmd` the driver composes
 *       (the task's `testCmd` with its Proof `Test:` path substituted by the
 *       exam's landing path), and none of the three contains the toolchain
 *       directory or the token `PATH=`.
 *   M5  `fleet/CONTRACT.md` names `TOOLCHAIN_BIN` and its default.
 *
 * Legs, in the order they run below:
 *   (a) toolchainBin set, the suite writes `$PATH`: first entry is that
 *       directory, the remainder non-empty [M1] — the falsifier of BASE, where
 *       the first entry is whatever the profile left.
 *   (b) a task's `proofRuns` command: first entry is that directory [M1].
 *   (c) a `constraintChecks` command: first entry is that directory [M1].
 *   (d) a task's exam command (`testCmd` with a `proofTests` path): first entry
 *       is that directory [M1].
 *   (e) no toolchainBin: the suite's first entry is `/usr/local/bin`, and
 *       `engine.TOOLCHAIN_BIN === '/usr/local/bin'` [M1, M2].
 *   (f) a `HOME` whose `.bash_profile` prepends a sentinel: the suite's first
 *       entry is still the toolchain directory, the sentinel later in the same
 *       PATH [M3].
 *   (g) the recorded `cmd` of runs (b), (c) and (d) [M4].
 *   (h) `fleet/CONTRACT.md` names `TOOLCHAIN_BIN` within 200 characters of
 *       `/usr/local/bin`, newlines joined — the same read the Proof's `Run:`
 *       makes [M5].
 *
 * `engine` is imported as a NAMESPACE on purpose: leg (e) reads
 * `engine.TOOLCHAIN_BIN`, and a BASE that exports no such name has to fail that
 * leg's assertion rather than fail to link this module.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSeam } from '../run-main.mjs'
import * as engine from '../run-engine.mjs'
import { simEnv } from './_helpers.mjs'
import { rig, makeRepo, passReview, doneImpl } from './_engine_helpers.mjs'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-shell-path-'))
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }))

const CONTRACT_MD = fileURLToPath(new URL('../CONTRACT.md', import.meta.url))

// The one command shape every leg hands the rig. No `PATH=` token and no
// mention of any toolchain directory: whatever the recorded `cmd` of leg (g)
// carries beyond this string came from the driver.
const writesPath = (file) => 'printf %s "$PATH" > ' + file

/** The `:`-separated entries of the PATH a command wrote to `file`. */
const pathEntriesIn = (file) => {
  assert.ok(fs.existsSync(file),
    'the command that writes $PATH never ran — nothing at ' + file)
  const seen = fs.readFileSync(file, 'utf8')
  assert.notEqual(seen.trim(), '', 'the command wrote an empty PATH to ' + file)
  return seen.split(path.delimiter)
}

/** Every record the run wrote, in the order it wrote them. */
const allEvents = (runDir) => {
  const file = path.join(runDir, 'events.jsonl')
  if (!fs.existsSync(file)) return []
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l) } catch { return null } })
    .filter(Boolean)
}
const ofKind = (evs, kind) => evs.filter((e) => e.kind === kind)

// ── the exec seam the sims hand the rig ──────────────────────────────────────
// Every shell the engine spawns goes out with an environment this file built:
// `simEnv`'s, with the engine's OWN env laid over it — whatever keys it set,
// PATH included, so an implementation that arranges PATH through the env is
// read as it wrote it — and HOME, TMPDIR and FLEET_HOME pinned to a directory
// the sim owns. Never `process.env`. The pinned HOME is what leg (f) needs:
// `bash -l` sources the profile the sim wrote there and never the box's, so
// every leg's reading of the first entry is a fact about the driver rather than
// about the box.
//
// Everything else the engine spawns (git, the fold kernel) goes through
// untouched — this seam is about the shell adapter, and git identity is the
// rig's business. The adapter is recognised by its argv as well as by its
// argv[0], so a command handed to `bash -lc` through a wrapper is still the
// sim's shell.
const shellEnvFor = (home, env) =>
  simEnv({ home, env: { ...env, HOME: home, TMPDIR: home, FLEET_HOME: home } })
const isShell = (cmd, argv) =>
  cmd === 'bash' || (Array.isArray(argv) && argv.includes('bash'))
const execFor = (home) => (cmd, argv, opts = {}) =>
  isShell(cmd, argv)
    ? execSeam(cmd, argv, { ...opts, env: shellEnvFor(home, opts.env) })
    : execSeam(cmd, argv, opts)

// ── the task the sims run ────────────────────────────────────────────────────
// `t1_test.sh` is under neither test root, so its landing path is itself — the
// substitution leg (g) reads is the identity here, and the exam is handed back
// at the path the Proof named.
const EXAM_PATH = 't1_test.sh'
const BODY = '**Claim:** the tree gains one.txt\n' +
  'Machine: M1. The tree holds `one.txt` whose content is "from T1".\n\n' +
  '**Proof:**\n- Legs: (a) the tree holds one.txt [M1]'
const entry = (over = {}) => ({
  id: 'T1', title: 'write one.txt', files: ['one.txt'], tier: 'standard', review: 'lean',
  writes: ['one.txt'], commutes: [],
  interfaces: { consumes: [], produces: ['`ONE`'] },
  proofTests: [], proofRuns: [],
  body: BODY,
  ...over,
})

let seq = 0
/**
 * One engine run. `profile`, when given, is written to the sim's own HOME as
 * `.bash_profile` before anything runs; `examScript` is what the canned
 * examiner leaves at the task's Proof `Test:` path.
 */
async function scenario ({ task, testCmd, extraArgs = {}, profile = null, examScript = null }) {
  seq += 1
  const stamp = 'sp' + seq
  const home = fs.mkdtempSync(path.join(tmp, 'home-' + stamp + '-'))
  if (profile !== null) fs.writeFileSync(path.join(home, '.bash_profile'), profile)
  const repo = makeRepo(path.join(tmp, 'repo-' + stamp))
  const runDir = path.join(tmp, 'run-' + stamp)
  const calls = []
  const stub = (prompt, opts, cwd) => {
    calls.push(opts.label)
    const kind = opts.label.split(':')[0]
    if (kind === 'exam') {
      fs.writeFileSync(path.join(cwd, EXAM_PATH), String(examScript))
      return { status: 'DONE', summary: 'exam written' }
    }
    if (kind === 'impl' || kind === 'fix') {
      fs.writeFileSync(path.join(cwd, 'one.txt'), 'from T1\n')
      return doneImpl(cwd)
    }
    if (kind === 'review') return passReview()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run } = rig({
    repo, runDir, waves: [[task]], stub, stamp, testCmd,
    exec: execFor(home),
    // `foldAgeMs: 0` — the fold-at-every-landing reading (#1006), so the run
    // folds and reaches its integrated pass deterministically.
    extraArgs: { foldAgeMs: 0, ...extraArgs },
  })
  const report = await run()
  return { report, row: report.tasks[0], calls, runDir, home,
           evs: allEvents(runDir) }
}

// ── leg (a): the suite's PATH begins with `toolchainBin` [M1] ────────────────
// The falsifier of BASE: there the first entry is whatever the login profile
// left, and never a directory this sim minted a moment ago.
{
  const toolchain = fs.mkdtempSync(path.join(tmp, 'toolchain-a-'))
  const suiteFile = path.join(tmp, 'path-a.txt')
  await scenario({
    task: entry(),
    testCmd: writesPath(suiteFile),
    extraArgs: { toolchainBin: toolchain },
  })
  const entries = pathEntriesIn(suiteFile)
  assert.equal(entries[0], toolchain,
    'leg (a) [M1]: the suite command\'s PATH starts with `args.toolchainBin` — ' +
    'the first `:` entry of what it printed: ' + JSON.stringify(entries.slice(0, 3)))
  assert.ok(entries.length > 1 && entries.slice(1).join(path.delimiter) !== '',
    'leg (a) [M1]: …followed by the PATH it would otherwise have had, which is ' +
    'not empty: ' + JSON.stringify(entries))
}

// ── leg (b): a Proof `Run:` command's PATH [M1], and its record [M4] ─────────
{
  const toolchain = fs.mkdtempSync(path.join(tmp, 'toolchain-b-'))
  const runFile = path.join(tmp, 'path-b.txt')
  const RUN_CMD = writesPath(runFile)
  const { evs } = await scenario({
    task: entry({ proofRuns: [RUN_CMD] }),
    extraArgs: { toolchainBin: toolchain },
  })
  const entries = pathEntriesIn(runFile)
  assert.equal(entries[0], toolchain,
    'leg (b) [M1]: the Proof `Run:` command\'s PATH starts with `args.toolchainBin`: ' +
    JSON.stringify(entries.slice(0, 3)))

  // [M4] the record is the command as the plan wrote it — the prefix stayed
  // inside the adapter.
  const runs = ofKind(evs, 'driver:proof-run')
  assert.ok(runs.length >= 1, 'leg (g) [M4]: the run was recorded at all')
  for (const e of runs) {
    assert.equal(e.cmd, RUN_CMD,
      'leg (g) [M4]: `driver:proof-run` carries the command the sim handed the rig, verbatim')
    assert.ok(!e.cmd.includes(toolchain),
      'leg (g) [M4]: and no toolchain directory: ' + e.cmd)
    assert.ok(!e.cmd.includes('PATH='),
      'leg (g) [M4]: and no `PATH=` token: ' + e.cmd)
  }
}

// ── leg (c): a Global `Check:` command's PATH [M1], and its record [M4] ──────
{
  const toolchain = fs.mkdtempSync(path.join(tmp, 'toolchain-c-'))
  const checkFile = path.join(tmp, 'path-c.txt')
  const CHECK_CMD = writesPath(checkFile)
  const { evs } = await scenario({
    task: entry(),
    extraArgs: { toolchainBin: toolchain, constraintChecks: [{ cmd: CHECK_CMD, minor: false }] },
  })
  const entries = pathEntriesIn(checkFile)
  assert.equal(entries[0], toolchain,
    'leg (c) [M1]: the Global `Check:` command\'s PATH starts with `args.toolchainBin`: ' +
    JSON.stringify(entries.slice(0, 3)))

  const checks = ofKind(evs, 'driver:check-run')
  assert.ok(checks.length >= 1, 'leg (g) [M4]: the check was recorded at all')
  for (const e of checks) {
    assert.equal(e.cmd, CHECK_CMD,
      'leg (g) [M4]: `driver:check-run` carries the command the sim handed the rig, verbatim')
    assert.ok(!e.cmd.includes(toolchain),
      'leg (g) [M4]: and no toolchain directory: ' + e.cmd)
    assert.ok(!e.cmd.includes('PATH='),
      'leg (g) [M4]: and no `PATH=` token: ' + e.cmd)
  }
}

// ── leg (d): the task's exam command's PATH [M1], and its record [M4] ────────
// The exam is red at BASE (no `one.txt` in the examiner's clone) and green on
// the implementer's tree, so the graded exam pass is the one whose PATH the
// file below holds.
{
  const toolchain = fs.mkdtempSync(path.join(tmp, 'toolchain-d-'))
  const examFile = path.join(tmp, 'path-d.txt')
  const EXAM_TEST_CMD = writesPath(examFile) + ' && bash ' + EXAM_PATH
  const EXAM_SCRIPT = '#!/bin/bash\n[ -f one.txt ]\n'
  const { evs } = await scenario({
    task: entry({ proofTests: [EXAM_PATH], testCmd: EXAM_TEST_CMD }),
    examScript: EXAM_SCRIPT,
    extraArgs: { toolchainBin: toolchain },
  })
  const entries = pathEntriesIn(examFile)
  assert.equal(entries[0], toolchain,
    'leg (d) [M1]: the exam command\'s PATH starts with `args.toolchainBin`: ' +
    JSON.stringify(entries.slice(0, 3)))

  // [M4] the recorded `cmd` is the `examRunCmd` the driver composes: the task's
  // testCmd with its Proof `Test:` path substituted by the exam's landing path.
  // `t1_test.sh` is under no test root, so the landing IS the path and the
  // substitution below is the identity — which is what makes the expected
  // string the one the sim handed.
  const LANDING = EXAM_PATH
  const EXPECTED = EXAM_TEST_CMD.split(EXAM_PATH).join(LANDING)
  const exams = ofKind(evs, 'driver:exam-run')
  assert.ok(exams.length >= 1, 'leg (g) [M4]: the exam run was recorded at all')
  for (const e of exams) {
    assert.equal(e.cmd, EXPECTED,
      'leg (g) [M4]: `driver:exam-run` carries the examRunCmd — the task\'s testCmd ' +
      'with its Proof `Test:` path substituted by the exam\'s landing path')
    assert.ok(!e.cmd.includes(toolchain),
      'leg (g) [M4]: and no toolchain directory: ' + e.cmd)
    assert.ok(!e.cmd.includes('PATH='),
      'leg (g) [M4]: and no `PATH=` token: ' + e.cmd)
  }
}

// ── leg (e): no `toolchainBin` — the default, and the export [M1, M2] ────────
// The first-entry half of this leg is weak on a box that already puts
// `/usr/local/bin` first (one whose `node` lives there, say): it can read green
// at BASE by coincidence. The export is what makes the leg discriminating, and
// legs (a) and (f) — whose directory is one this sim minted a moment ago —
// carry the falsification.
{
  const suiteFile = path.join(tmp, 'path-e.txt')
  await scenario({ task: entry(), testCmd: writesPath(suiteFile) })
  const entries = pathEntriesIn(suiteFile)
  assert.equal(entries[0], '/usr/local/bin',
    'leg (e) [M1]: with no `toolchainBin` the first entry is `TOOLCHAIN_BIN`: ' +
    JSON.stringify(entries.slice(0, 3)))
  assert.equal(engine.TOOLCHAIN_BIN, '/usr/local/bin',
    'leg (e) [M2]: `fleet/run-engine.mjs` exports `TOOLCHAIN_BIN` equal to `/usr/local/bin`')
}

// ── leg (f): a login profile that reassigns PATH does not win [M3] ───────────
// The `.bash_profile` of the HOME the sim hands every `bash` prepends a
// sentinel directory. `bash -lc` sources it BEFORE it runs the command, so a
// prefix that rides in `env.PATH` is gone by then and one that rides inside the
// command string is not: the first entry must still be the toolchain
// directory, with the sentinel somewhere after it — which is also the proof
// that the profile ran at all.
{
  const toolchain = fs.mkdtempSync(path.join(tmp, 'toolchain-f-'))
  const sentinel = fs.mkdtempSync(path.join(tmp, 'sentinel-f-'))
  const suiteFile = path.join(tmp, 'path-f.txt')
  await scenario({
    task: entry(),
    testCmd: writesPath(suiteFile),
    extraArgs: { toolchainBin: toolchain },
    profile: 'PATH=' + sentinel + ':$PATH\n',
  })
  const entries = pathEntriesIn(suiteFile)
  assert.equal(entries[0], toolchain,
    'leg (f) [M3]: the profile reassigned PATH and the toolchain directory is ' +
    'STILL the first entry: ' + JSON.stringify(entries.slice(0, 3)))
  const at = entries.indexOf(sentinel)
  assert.ok(at > 0,
    'leg (f) [M3]: and the sentinel the profile prepended occurs after it in the ' +
    'same PATH — the profile ran and did not win: ' + JSON.stringify(entries))
}

// ── leg (h): the contract names TOOLCHAIN_BIN and its default [M5] ──────────
// The same read the Proof's `Run:` makes, newlines joined to spaces.
{
  const joined = fs.readFileSync(CONTRACT_MD, 'utf8').split('\n').join(' ')
  assert.ok(/TOOLCHAIN_BIN.{0,200}\/usr\/local\/bin/.test(joined),
    'leg (h) [M5]: `fleet/CONTRACT.md` names `TOOLCHAIN_BIN` within 200 characters ' +
    'of its default `/usr/local/bin`')
}

console.log('ALL TESTS PASSED')
