// fleet/tests/test_run_engine_integrated_clean.mjs — the integration clone is
// SWEPT of cache directories before the integrated proofs (#631 option (d)).
//
// The driver runs the suite in the integration clone (baseline, then the
// candidate suite of every wave). A python suite leaves `__pycache__` and
// `.pytest_cache` behind in that clone, and the integrated `Run:` pass then
// executes on a tree carrying artifacts no task wrote — so a task whose proof
// asserts a cache directory is ABSENT is parked by the driver's own suite run
// rather than by anything in the adopted tree. This sim pins the sweep that
// runs immediately before the integrated pass.
//
// Everything below the agent seam is real (git, clones, capture, the fold
// kernel, the real `sh`); only the judgments are canned, so every command
// execution the assertions observe is the driver's own — the same rig the
// existing integrated-runs sim uses.
//
// Machine clauses under test:
//   M1 — before the first integrated `Run:` command of a wave executes in the
//        integration clone, every directory named `__pycache__` or
//        `.pytest_cache` under the clone (outside `.git`) has been removed, and
//        one event `driver:integrated-clean` carrying `wave` and `removed` (the
//        count of directories removed) is appended to `events.jsonl`.
//   M2 — a merged task whose `Run:` is `test ! -e pkg/__pycache__` exits 0 on a
//        run whose suite command creates `pkg/__pycache__` every time it runs,
//        so the run reports no completeness finding for it.
//   M3 — tracked files and other untracked files in the clone survive the
//        sweep: a file `notes.txt` the suite command creates untracked is still
//        present when the integrated `Run:` executes.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { rig, makeRepo, passReview, cleanCritic, doneImpl } from './_engine_helpers.mjs'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-integrated-clean-'))
// Removed on exit, red or green.
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }))

// The suite command of this run: it plants every artifact on EVERY execution —
// once at baseline, once more for the wave candidate — and only then runs the
// repo's real check. `.git/__pycache__` is planted deliberately: the sweep must
// skip `.git` entirely, so that one is the control that must survive.
const PLANT = 'mkdir -p pkg/__pycache__ pkg/sub/__pycache__ .pytest_cache .git/__pycache__ && ' +
  'touch notes.txt && bash check.sh'

// The three cache directories the sweep is responsible for. `.git/__pycache__`
// is a fourth match by NAME and must not be counted or removed.
const REMOVED_COUNT = 3

// Leg (a)'s proof command, verbatim: the two `__pycache__` directories and the
// pytest cache are gone, the one under `.git` survives.
const CMD_A = 'test ! -e pkg/__pycache__ && test ! -e pkg/sub/__pycache__ && ' +
  'test ! -e .pytest_cache && test -e .git/__pycache__'
// Leg (b)'s proof command, verbatim from M2.
const CMD_B = 'test ! -e pkg/__pycache__'
// Leg (c)'s proof command: `notes.txt` is the untracked file the suite command
// touches, `check.sh` a file the rig commits at BASE.
const CMD_C = 'test -e notes.txt && test -e check.sh'

const mkTask = (id, file, over = {}) => ({
  id, title: id.toLowerCase(), files: [file], tier: 'standard', review: 'lean',
  writes: [file], commutes: [], proofTests: [], proofRuns: [],
  body: 'task ' + id + ' body', ...over,
})

// The run's own record. An absent file reads as no records, so a BASE engine
// that writes none fails a count assertion rather than an ENOENT.
const eventsOf = (runDir) => {
  const file = path.join(runDir, 'events.jsonl')
  if (!fs.existsSync(file)) return []
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l) } catch { return null } })
    .filter(Boolean)
}
const isDir = (p) => { try { return fs.statSync(p).isDirectory() } catch { return false } }
const exists = (p) => fs.existsSync(p)
const runOf = (report, task) =>
  (Array.isArray(report.integratedRuns) ? report.integratedRuns : []).find((r) => r.task === task)

// ── the run ──────────────────────────────────────────────────────────────────
// One wave, three merged tasks, one per leg. `.gitignore` is committed at BASE
// so the planted artifacts stay UNTRACKED everywhere: nothing the suite command
// creates is ever captured into a task's patch, which is what makes leg (c) a
// statement about the sweep rather than about the fold.
const repo = makeRepo(path.join(tmp, 'repo'), {
  '.gitignore': '__pycache__/\n.pytest_cache/\nnotes.txt\n',
})
const runDir = path.join(tmp, 'run')
const waves = [[
  mkTask('A', 'a.txt', { proofRuns: [CMD_A] }),
  mkTask('B', 'b.txt', { proofRuns: [CMD_B] }),
  mkTask('C', 'c.txt', { proofRuns: [CMD_C] }),
]]
const fileOf = (id) => (id === 'A' ? 'a.txt' : id === 'B' ? 'b.txt' : 'c.txt')
const stub = (prompt, opts, cwd) => {
  const kind = opts.label.split(':')[0]
  if (kind === 'impl') {
    const id = opts.label.split(':')[1]
    fs.writeFileSync(path.join(cwd, fileOf(id)), 'from-' + id + '\n')
    // The driver's pre-review pass executes each task's `Run:` in the task's
    // OWN clone, where the suite command never ran. A's proof asks for
    // `.git/__pycache__` and C's for `notes.txt`; both are planted here so the
    // clone-local pass is green and the task reaches the fold. Neither is
    // capturable (`.git` is never diffed, `notes.txt` is gitignored), so the
    // integration clone gets them from the suite command alone.
    if (id === 'A') fs.mkdirSync(path.join(cwd, '.git', '__pycache__'), { recursive: true })
    if (id === 'C') fs.writeFileSync(path.join(cwd, 'notes.txt'), '')
    return doneImpl(cwd)
  }
  if (kind === 'review') return passReview()
  if (opts.label === 'integration') return cleanCritic()
  throw new Error('unexpected dispatch: ' + opts.label)
}
const { run, integ } = rig({ repo, runDir, waves, stub, testCmd: PLANT, stamp: 'ic1',
                             extraArgs: { shallowLeg: false } })
const report = await run()

// ── sim preconditions ────────────────────────────────────────────────────────
assert.equal(report.coverage.complete, true,
  'sim precondition: all three tasks merged: ' + JSON.stringify(report.tasks))
assert.equal(report.waveMerges[0].status, 'MERGED',
  'sim precondition: wave 1 was adopted: ' + JSON.stringify(report.waveMerges))
assert.equal(report.tests.passed, true, 'sim precondition: the adopted tree is green')
assert.ok(Array.isArray(report.integratedRuns) && report.integratedRuns.length === 3,
  'sim precondition: one integrated run per merged task: ' +
  JSON.stringify(report.integratedRuns))

const events = eventsOf(runDir)

// ── leg (a): the sweep's event [M1] ──────────────────────────────────────────
const cleanEvents = events.filter((e) => e.kind === 'driver:integrated-clean')
assert.equal(cleanEvents.length, 1,
  'the engine appended no single `driver:integrated-clean` event for wave 1 — the ' +
  'integration clone is not swept before the integrated pass: ' + JSON.stringify(cleanEvents))
assert.equal(cleanEvents[0].wave, 1,
  'the sweep event carries the wave number it swept for: ' + JSON.stringify(cleanEvents[0]))
assert.equal(cleanEvents[0].removed, REMOVED_COUNT,
  '`removed` is the count of directories removed — `pkg/__pycache__`, ' +
  '`pkg/sub/__pycache__` and `.pytest_cache`, and NOT `.git/__pycache__`: ' +
  JSON.stringify(cleanEvents[0]))

// [M1] the sweep precedes every integrated `Run:` of that wave.
const iClean = events.findIndex((e) => e.kind === 'driver:integrated-clean' && e.wave === 1)
const runIdxs = events
  .map((e, i) => (e.kind === 'driver:integrated-run' && e.wave === 1 ? i : -1))
  .filter((i) => i >= 0)
assert.equal(runIdxs.length, 3,
  'sim precondition: three `driver:integrated-run` events for wave 1: ' + runIdxs.join(','))
assert.ok(iClean >= 0 && iClean < runIdxs[0],
  'the `driver:integrated-clean` event must precede every `driver:integrated-run` ' +
  'event of wave 1 (clean at ' + iClean + ', first run at ' + runIdxs[0] + ')')

// [M1] and the proof that reads the swept tree agrees.
const rA = runOf(report, 'A')
assert.deepEqual({ task: rA && rA.task, cmd: rA && rA.cmd, exit: rA && rA.exit },
  { task: 'A', cmd: CMD_A, exit: 0 },
  'A\'s integrated `Run:` must exit 0 on the swept tree — the nested cache and the ' +
  'pytest cache are gone, the one under `.git` survives: ' + JSON.stringify(rA))

// [M1] the same statement read off the clone itself, after the run.
assert.ok(!exists(path.join(integ, 'pkg', '__pycache__')),
  'pkg/__pycache__ still exists in the integration clone')
assert.ok(!exists(path.join(integ, 'pkg', 'sub', '__pycache__')),
  'pkg/sub/__pycache__ still exists — the sweep is a full walk, not a top-level scan')
assert.ok(!exists(path.join(integ, '.pytest_cache')),
  '.pytest_cache still exists in the integration clone')
assert.ok(isDir(path.join(integ, '.git', '__pycache__')),
  'the sweep must skip `.git` entirely: .git/__pycache__ was removed')
// [M1] nothing of any other name is touched.
assert.ok(isDir(path.join(integ, 'pkg')),
  'the containing `pkg` directory must survive — only the matching names are removed')
assert.ok(isDir(path.join(integ, 'pkg', 'sub')),
  'the containing `pkg/sub` directory must survive — only the matching names are removed')

// ── leg (b): no completeness finding for the swept-away cache [M2] ───────────
const rB = runOf(report, 'B')
assert.deepEqual({ task: rB && rB.task, cmd: rB && rB.cmd, exit: rB && rB.exit },
  { task: 'B', cmd: CMD_B, exit: 0 },
  'a merged task whose `Run:` is `' + CMD_B + '` must exit 0 even though the suite ' +
  'command creates pkg/__pycache__ on every run: ' + JSON.stringify(rB))
const findings = Array.isArray(report.completenessFindings) ? report.completenessFindings : []
assert.ok(!findings.some((f) => JSON.stringify(f).includes('(task B)')),
  'no completeness finding may name task B: ' + JSON.stringify(findings))
assert.deepEqual(findings, [],
  'a green run over a swept tree reports no completeness finding at all: ' +
  JSON.stringify(findings))

// ── leg (c): tracked and untracked survivors [M3] ────────────────────────────
const rC = runOf(report, 'C')
assert.deepEqual({ task: rC && rC.task, cmd: rC && rC.cmd, exit: rC && rC.exit },
  { task: 'C', cmd: CMD_C, exit: 0 },
  '`notes.txt` (untracked, created by the suite command) and `check.sh` (tracked at ' +
  'BASE) must both still be present when the integrated `Run:` executes: ' +
  JSON.stringify(rC))
assert.ok(exists(path.join(integ, 'notes.txt')),
  'the untracked notes.txt was swept away — the sweep removes directories of two ' +
  'names, never files')
assert.ok(exists(path.join(integ, 'check.sh')),
  'the tracked check.sh was swept away — the sweep removes directories of two ' +
  'names, never files')

// ── leg (d) ──────────────────────────────────────────────────────────────────
console.log('ALL TESTS PASSED')
