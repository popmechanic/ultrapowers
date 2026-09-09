// fleet/tests/test_run_engine_candidate_bootstrap.mjs — the fold bootstraps a
// candidate whose manifest changed (#825).
//
// A wave whose fold changes `package.json` (or any manifest/lockfile the
// bootstrap ladder reads) leaves the integration clone's `node_modules` one
// install behind the tree the candidate suite is about to run on. The suite
// then dies on `Cannot find module` and the reconcile agent is handed a module
// error instead of the install's own. This sim pins the install that closes
// that gap, and pins that it happens exactly once, in the adopted tree.
//
// Everything below the agent seam is real (real git repos, real clones, the
// real capture, the real fold kernel, the real `sh`); only the judgments are
// canned. No network: the "dependency" is simulated by `install.sh`, which
// reads the `dependencies` keys of `package.json` and writes a module into
// `node_modules/` for each — and exits 3 with `install broke: boom` on stderr
// when one of them is named `boom`.
//
// Machine clauses under test:
//   M1 — `fleet/run-engine.mjs` exports `bootstrapManifestChanged(paths)`, a
//        pure function of an array of repository-relative paths: `true` when at
//        least one path's BASENAME is `package.json`, `package-lock.json`,
//        `bun.lock`, `bun.lockb`, `pnpm-lock.yaml`, `uv.lock`, `pyproject.toml`
//        or `pytest.ini`, or matches `requirements*.txt` — at any directory
//        depth — and `false` otherwise, including for an empty array and for
//        names that merely CONTAIN one of those (`package.json.bak`,
//        `requirements.md`).
//   M2 — in `foldWave`'s adopt sequence, after `git read-tree -u --reset
//        <candidate>^{tree}` into the integration clone and before `testCmd`
//        runs there, when `bootstrapCmd` is set and `bootstrapManifestChanged`
//        is true over the paths of `git diff --name-only <prevHead>
//        <candidate>`, the engine runs `bootstrapCmd` exactly once in the
//        integration clone through the same `sh` seam the suite runs through;
//        with `bootstrapCmd` unset, or with the predicate false, none runs
//        there between the `read-tree` and the suite.
//   M3 — when that bootstrap exits non-zero, `report.judgmentCalls` gains a
//        line containing `wave <N>: candidate bootstrap failed (exit <code>)`,
//        `testCmd` is not run on that candidate, and the failing output handed
//        to the reconcile agent and the wave's `TEST_FAILED` detail carry the
//        bootstrap's stdout and stderr and none of the suite's output.
//   M4 — the install made before the suite is the ADOPTED tree's install:
//        after a wave whose candidate bootstrap ran returns `MERGED`, the
//        module the bootstrap installed is present under the integration clone,
//        and no second bootstrap ran there after the adopt.
//   M5 — `fleet/roles/reconcile.md` carries one sentence naming the project's
//        dependency install as the first move when a manifest or lockfile
//        changed — the words `manifest`, `lockfile` and `install` appear in
//        that order within one sentence.
//
// Proof legs, and where each is asserted below: (a) the predicate's ten true
// rows, bare and one directory deep [M1]; (b) its five false rows [M1]; (c) the
// manifest scenario (MERGED, green, no reconcile, two integration installs),
// the no-manifest scenario (one), and the manifest scenario with no
// `bootstrapCmd` at all (none, and no `candidate bootstrap` judgment call)
// [M2]; (d) the failing scenario — the judgment call, the reconcile brief, the
// `TEST_FAILED` detail, and the one-and-only suite run (the baseline's) [M3];
// (e) the installed module under the integration clone, and no install after
// the adopt [M4]; (f) `reconcile.md`'s sentence [M5]; (g) the two sibling sims
// that pin the reconcile loop and the exam-clone bootstrap still print their
// sentinel [M2, M3].
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { makeRepo, rig, passReview, cleanCritic, doneImpl } from './_engine_helpers.mjs'
// Namespace import on purpose: a missing named export is a link-time
// SyntaxError that reads like a bad import path. This way the absent
// implementation reports itself as the assertion it is, on the line below.
import * as engine from '../run-engine.mjs'

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))
// realpath so the `$PWD` the shell scripts log is byte-equal to the clone paths
// the assertions compare it against.
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'engine-cand-bootstrap-')))
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }))

// ── (a) + (b) the predicate [M1] ─────────────────────────────────────────────
const bootstrapManifestChanged = engine.bootstrapManifestChanged
assert.equal(typeof bootstrapManifestChanged, 'function',
  '[M1] fleet/run-engine.mjs does not export bootstrapManifestChanged(paths) yet')

// (a) every name in the ladder, bare and one directory deep — the TinyApp case
// was `client/package.json`, so depth is part of the clause, not a courtesy.
for (const name of ['package.json', 'package-lock.json', 'bun.lock', 'bun.lockb',
                    'pnpm-lock.yaml', 'uv.lock', 'pyproject.toml', 'pytest.ini',
                    'requirements.txt', 'requirements-dev.txt']) {
  assert.equal(bootstrapManifestChanged([name]), true,
    '[M1] leg (a): bootstrapManifestChanged([' + JSON.stringify(name) + ']) is true')
  assert.equal(bootstrapManifestChanged(['client/' + name]), true,
    '[M1] leg (a): bootstrapManifestChanged(["client/' + name + '"]) is true — ' +
    'the basename matches at any depth')
}

// (b) the false rows: nothing changed, nothing relevant changed, and three
// names that merely CONTAIN a ladder name.
for (const paths of [[], ['README.md', 'src/a.mjs'], ['package.json.bak'],
                     ['requirements.md'], ['docs/pytest.ini.old']]) {
  assert.equal(bootstrapManifestChanged(paths), false,
    '[M1] leg (b): bootstrapManifestChanged(' + JSON.stringify(paths) + ') is false')
}

// ── the sim repo: a simulated dependency, and a log of where things ran ──────
// `install.sh` and `check.sh` each append one marked line naming their own
// `$PWD` to the SAME log file, whose absolute path the sim writes into both
// scripts. `install <dir>` lines count where the bootstrap ran; `check <dir>`
// lines count where the suite ran.
const INSTALL_JS = [
  'const fs = require("fs");',
  'const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));',
  'const deps = Object.keys(pkg.dependencies || {});',
  'if (deps.indexOf("boom") !== -1) { console.error("install broke: boom"); process.exit(3); }',
  'for (const d of deps) {',
  '  fs.mkdirSync("node_modules/" + d, { recursive: true });',
  '  fs.writeFileSync("node_modules/" + d + "/package.json", JSON.stringify({ main: "index.js" }));',
  '  fs.writeFileSync("node_modules/" + d + "/index.js", "module.exports = 1");',
  '}',
].join('\n')

const repoFiles = (log) => ({
  // Replaces makeRepo's default check.sh: same `[ ! -f BROKEN ]` spine, plus
  // the marker line and the module the manifest scenario makes it need.
  'check.sh': '#!/bin/bash\necho "check $PWD" >> ' + log + '\n[ ! -f BROKEN ] && node test.mjs\n',
  'install.sh': '#!/bin/bash\necho "install $PWD" >> ' + log + "\nnode -e '" + INSTALL_JS + "'\n",
  'package.json': '{"dependencies":{}}\n',
  'test.mjs': '// no imports at BASE\n',
  // Without this the implementer's own install rides into the captured patch
  // (`git add -A` then `git diff --cached`).
  '.gitignore': 'node_modules/\n',
})

const logLines = (log) =>
  (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) : [])
const marked = (log, marker, dir) => logLines(log).filter((l) => l === marker + ' ' + dir)

// The three implementer behaviours. Each writes the tracked files and then runs
// the bootstrap in its OWN clone, the way the live implementer did — so the
// task clone is provisioned and only the two tracked files reach the patch.
const runInstall = (cwd) => {
  try {
    execFileSync('bash', ['install.sh'], { cwd, stdio: 'ignore' })
  } catch { /* the boom scenario's install fails here too; the clone is not the leg */ }
}
const addDependency = (name) => (cwd) => {
  fs.writeFileSync(path.join(cwd, 'package.json'), '{"dependencies":{"' + name + '":"1"}}\n')
  fs.writeFileSync(path.join(cwd, 'test.mjs'), "import '" + name + "'\n")
  runInstall(cwd)
}
const touchOnlyText = (cwd) => {
  fs.writeFileSync(path.join(cwd, 'a.txt'), 'line1\nline2\nline3\nline4\n')
}

const entry = (files) => ({
  id: 'T1', title: 'the wave whose fold may change a manifest', files,
  tier: 'standard', review: 'lean', writes: files, commutes: [], body: 'task T1',
})

let seq = 0
async function scenario({ files, onImpl, extraArgs = { bootstrapCmd: 'bash install.sh' } }) {
  seq += 1
  const stamp = 'cb' + seq
  const log = path.join(tmp, 'log-' + stamp + '.txt')
  const repo = makeRepo(path.join(tmp, 'repo-' + stamp), repoFiles(log))
  const runDir = path.join(tmp, 'run-' + stamp)
  const labels = []
  const prompts = {}
  const stub = (prompt, opts, cwd) => {
    labels.push(opts.label)
    prompts[opts.label] = prompt
    const kind = opts.label.split(':')[0]
    if (kind === 'impl') { onImpl(cwd); return doneImpl(cwd) }
    if (kind === 'review') return passReview()
    // A reconcile that gives up: the wave ends TEST_FAILED carrying whatever
    // output the driver decided was the failure.
    if (kind === 'reconcile') return { status: 'BLOCKED', summary: 'sim reconcile gives up' }
    if (opts.label === 'integration') return cleanCritic()
    throw new Error('unexpected dispatch: ' + opts.label)
  }
  const { run, integ } = rig({ repo, runDir, waves: [[entry(files)]], stub, stamp, extraArgs })
  const report = await run()
  return { report, labels, prompts, integ, log, runDir }
}

// ── (c) + (e) the manifest scenario: MERGED, bootstrapped once more [M2][M4] ─
{
  const { report, labels, integ, log } = await scenario({
    files: ['package.json', 'test.mjs'],
    onImpl: addDependency('leftpad'),
  })
  const calls = JSON.stringify(report.judgmentCalls)
  assert.equal(report.waveMerges[0].status, 'MERGED',
    '[M2] leg (c): the candidate whose manifest changed is bootstrapped before its suite, ' +
    'so the suite is green and the wave merges — ' + calls +
    ' detail: ' + report.waveMerges[0].detail)
  assert.equal(report.tests.passed, true,
    '[M2] leg (c): and the run\'s suite passed: ' + report.tests.output)
  assert.deepEqual(labels.filter((l) => l.startsWith('reconcile:')), [],
    '[M2] leg (c): no reconcile agent was dispatched — the install, not a repair, ' +
    'is what made the candidate green: ' + labels.join(','))
  assert.equal(marked(log, 'install', integ).length, 2,
    '[M2] leg (c): the bootstrap ran in the integration clone exactly twice — once from ' +
    'the setup loop, once at the candidate site: ' + JSON.stringify(logLines(log)))

  // [M4] the install before the suite is the ADOPTED tree's install, and it
  // survives the `reset --hard` the adopt does in that same directory.
  assert.ok(fs.existsSync(path.join(integ, 'node_modules', 'leftpad', 'index.js')),
    '[M4] leg (e): the module the candidate bootstrap installed is present under the ' +
    'integration clone after the adopt')
  assert.equal(marked(log, 'install', integ).length, 2,
    '[M4] leg (e): and no third bootstrap ran there — none was added after the adopt: ' +
    JSON.stringify(logLines(log)))
}

// ── (c) the no-manifest scenario: the predicate is false, nothing runs [M2] ──
{
  const { report, integ, log } = await scenario({
    files: ['a.txt'],
    onImpl: touchOnlyText,
  })
  assert.equal(report.waveMerges[0].status, 'MERGED',
    '[M2] leg (c): a fold that touched only a.txt still merges — ' +
    JSON.stringify(report.judgmentCalls) + ' detail: ' + report.waveMerges[0].detail)
  assert.equal(marked(log, 'install', integ).length, 1,
    '[M2] leg (c): with the predicate false the bootstrap ran in the integration clone ' +
    'exactly once — the setup loop\'s, and none between the read-tree and the suite: ' +
    JSON.stringify(logLines(log)))
}

// ── (c) the manifest scenario with no bootstrapCmd at all [M2] ───────────────
// The engine has no install to run, so it runs none — and mints no judgment
// call about one. (The candidate is red on the missing module here; that red is
// the pre-#825 behaviour and is not what this leg reads.)
{
  const { report, integ, log } = await scenario({
    files: ['package.json', 'test.mjs'],
    onImpl: addDependency('leftpad'),
    extraArgs: {},
  })
  assert.equal(marked(log, 'install', integ).length, 0,
    '[M2] leg (c): with bootstrapCmd unset no bootstrap ran in the integration clone: ' +
    JSON.stringify(logLines(log)))
  assert.deepEqual(report.judgmentCalls.filter((j) => j.includes('candidate bootstrap')), [],
    '[M2] leg (c): and no judgment call names a candidate bootstrap: ' +
    report.judgmentCalls.join(' | '))
}

// ── (d) the failing scenario: red on the install's own error [M3] ────────────
{
  const { report, prompts, integ, log } = await scenario({
    files: ['package.json', 'test.mjs'],
    onImpl: addDependency('boom'),
  })
  const calls = report.judgmentCalls
  assert.ok(calls.some((j) => j.includes('wave 1: candidate bootstrap failed (exit 3)')),
    '[M3] leg (d): the failing candidate bootstrap is a judgmentCall naming the exit code: ' +
    calls.join(' | '))

  // The reconcile agent reads the install's own error, not a module error the
  // suite would have minted — because the suite never ran on this candidate.
  const brief = prompts['reconcile:wave1:1']
  assert.equal(typeof brief, 'string',
    '[M3] leg (d): the reconcile agent was dispatched for the failed bootstrap')
  const cut = brief.indexOf('Failing output:')
  assert.ok(cut !== -1, '[M3] leg (d): the reconcile brief carries a Failing output: block')
  const failing = brief.slice(cut + 'Failing output:'.length)
  assert.ok(failing.includes('install broke: boom'),
    '[M3] leg (d): the failing output handed to the reconcile agent is the bootstrap\'s: ' +
    JSON.stringify(failing.slice(0, 600)))
  assert.ok(!failing.includes('Cannot find module'),
    '[M3] leg (d): and none of the suite\'s output: ' + JSON.stringify(failing.slice(0, 600)))

  // The wave's own detail says the same thing.
  assert.equal(report.waveMerges[0].status, 'TEST_FAILED',
    '[M3] leg (d): a reconcile that gives up leaves the wave TEST_FAILED')
  const detail = String(report.waveMerges[0].detail || '')
  assert.ok(detail.includes('install broke: boom'),
    '[M3] leg (d): the TEST_FAILED detail carries the bootstrap\'s output: ' + detail)
  assert.ok(!detail.includes('Cannot find module'),
    '[M3] leg (d): and none of the suite\'s: ' + detail)

  // The suite ran in the integration clone exactly once — the baseline pass on
  // BASE's tree, which the red candidate pays for. The candidate itself was
  // never tested: a bootstrap that failed is the answer already.
  assert.equal(marked(log, 'check', integ).length, 1,
    '[M3] leg (d): the suite ran in the integration clone exactly once — the baseline\'s — ' +
    'so testCmd was never run on the candidate: ' + JSON.stringify(logLines(log)))
}

// ── (f) the reconcile role's sentence [M5] ───────────────────────────────────
// The Proof's fourth `Run:` in JS: `manifest`, `lockfile` and `install` in that
// order, within one sentence (no `.` between them), case-insensitively.
{
  const role = fs.readFileSync(path.join(REPO_ROOT, 'fleet/roles/reconcile.md'), 'utf8')
  assert.ok(/manifest[^.]*lockfile[^.]*install/i.test(role.replace(/\n/g, ' ')),
    '[M5] leg (f): fleet/roles/reconcile.md names the dependency install as the first move ' +
    'when a manifest or lockfile changed — `manifest`, `lockfile`, `install` in that order ' +
    'within one sentence')
}

// ── (g) the sibling sims still print their sentinel [M2][M3] ─────────────────
for (const sim of ['fleet/tests/test_run_engine_reconcile.mjs',
                   'fleet/tests/test_run_engine_exam_together.mjs']) {
  let out
  try {
    out = execFileSync('node', [sim], { cwd: REPO_ROOT, encoding: 'utf8' })
  } catch (e) {
    out = String((e && (e.stdout || e.message)) || e)
  }
  assert.ok(out.includes('ALL TESTS PASSED'),
    '[M2][M3] leg (g): ' + sim + ' still passes — the reconcile loop and the exam-clone ' +
    'bootstrap are unchanged: ' + out.slice(-1200))
}

console.log('ALL TESTS PASSED')
