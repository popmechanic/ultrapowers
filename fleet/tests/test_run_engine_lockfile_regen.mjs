// fleet/tests/test_run_engine_lockfile_regen.mjs — the capture drops lockfiles
// and the fold regenerates them (#1050): when several tasks of one run add
// packages, the run's lockfile is REBUILT from the merged manifests at each
// fold, and no worker is ever asked to merge a lockfile by hand.
//
// Everything below the agent seam is real — real git repos, real clones at
// BASE, the real `withPatchCapture` capture, the real fold kernel through the
// real `execSeam`, the real `bash -lc` for the bootstrap and the regenerator.
// Only the judgments are canned, so every ordering these assertions read is the
// driver's own.
//
// Machine clauses under test:
//   M1 — `LOCKFILE_BASENAMES`, exported from `fleet/run-waves.mjs`, is exactly
//        `bun.lock`, `bun.lockb`, `package-lock.json`, `pnpm-lock.yaml`,
//        `uv.lock`. `patchAgainstBase` takes a `dropLockfiles` option and, when
//        it is `true`, excludes from the patch every staged path whose basename
//        is one of them, at any depth, alongside the unnamed binaries it
//        already drops, calling `onDropped` ONCE with the sorted union of both
//        lists; with the option absent or `false` the capture is byte-for-byte
//        BASE's. `withPatchCapture` passes its own `dropLockfiles` through to
//        every capture it makes, and `dropLockfilesFor(argsObj)`, exported from
//        `fleet/run-main.mjs`, is `true` exactly when `argsObj.regenerateCmd`
//        is a non-empty string.
//   M2 — on a wave fold, after `read-tree` of the materialized candidate and
//        before the #825 bootstrap, a manifest-changing candidate in a run that
//        carries a `regenerateCmd` runs that command in the integration clone;
//        on exit `0` with at least one changed lockfile the driver stages those
//        paths, commits them onto the candidate (`wave <n> regenerated
//        <paths>`), makes that commit the candidate every later step uses, and
//        appends one `driver:regenerated {wave, cmd, exit: 0, paths}` with the
//        sorted paths. A command that changed no lockfile appends the event
//        with `paths: []` and commits nothing.
//   M3 — a regenerator that exits non-zero stands in place of the suite exactly
//        as a failed bootstrap does: the candidate is red on the regenerator's
//        output, one `driver:regenerated {wave, cmd, exit, paths: []}` is
//        appended, and the wave takes the route a red bootstrap takes at BASE.
//   M4 — a fold whose candidate changed no manifest runs no regenerator and
//        appends no `driver:regenerated`; a run with no `regenerateCmd` drops
//        no lockfile at capture, runs no regenerator, appends no
//        `driver:regenerated` and folds a lockfile conflict exactly as at BASE;
//        and in a run that carries a regenerator a lockfile a task's tree
//        changed is never a conflict the kernel narrates — no `resolve:` worker
//        is dispatched on it and no `resolver:reply` names it.
//   M5 — `fleet/CONTRACT.md` names `driver:regenerated {wave, cmd, exit,
//        paths}` in the paragraph that names `driver:wave-adopted`, says a
//        patch capture drops lockfile basenames only in a run that carries a
//        `regenerateCmd` and names them on `capture:dropped`, and says the
//        regenerator runs before the candidate's bootstrap and the lockfile it
//        writes is committed onto the candidate.
//
// Legs: (a) M1, (b) M2, (c) M2, (d) M3, (e) M4, (f) M4, (g) M5, (h) M1.
//
// ── three readings this file settles, because the Proof and the Context can be
//    read two ways and a later session would otherwise have to guess ──────────
//
// 1. THE RIG IS LOCAL. Leg (a) reads each task's `capture:dropped` event, and
//    that event is the WRAPPER's — `withPatchCapture`'s `onDropped`. The shared
//    rig in `_engine_helpers.mjs` passes no `onEvent` to `withPatchCapture`, so
//    in a sim that event reaches nothing at all. This file therefore composes
//    `provision` + `withPatchCapture({… dropLockfiles, onEvent})` + `runEngine`
//    itself, the way the pre-review-pass sim's own prompt-pin does. That is the
//    direct pin on M1's "`withPatchCapture` passes its own `dropLockfiles`
//    option through to every capture it makes", and it does not depend on how
//    the passthrough knob the Context asks `_engine_helpers.mjs` for is spelled
//    — that knob is Context, not a Machine clause, so the implementer still
//    owes it and this exam does not grade it.
//
// 2. NO `foldAgeMs: 0`. The Context sketches `extraArgs: { width: 2,
//    foldAgeMs: 0, … }`, but leg (b) needs ONE epoch folding BOTH tasks: `wave`
//    `1`, exactly one `driver:regenerated`, and `resolve:wave1:1:1` at BASE.
//    With `foldAgeMs: 0` the age clause fires at the first landing and folds
//    each task alone — two epochs, no contention, no `resolve:wave1:1:1`. So no
//    `foldAgeMs` is passed at all: the default is at least 60s, the age clause
//    cannot fire inside a sim, and the run's one fold epoch is the `end` fold
//    that takes both results. The Proof leg wins over the Context's sketch.
//
// 3. "ON TOP OF THE MATERIALIZED CANDIDATE" IS READ ON THE TREE, NOT ON THE
//    PARENTAGE. The regenerated commit can sit on `prevHead` carrying the
//    candidate tree (the reconcile commit's own shape, which the Context points
//    at) or on the candidate itself; no Machine clause pins which. So leg (b)
//    is asserted as: the adopted head's subject is exactly `wave 1 regenerated
//    bun.lock`, its `package.json` is the merged manifest byte for byte, and
//    its `bun.lock` is byte for byte the regenerator's output over that
//    manifest. Leg (c)'s "the adopted `headSha` equals the materialized
//    candidate" is asserted as `rev-list --count <base>..<adopted>` of `1` plus
//    an unchanged lockfile — no regenerated commit exists there, so the count
//    is parentage-safe.
//
// Leg (f) names the whole pre-review-pass sim, which the DRIVER runs as the
// Proof's second `Run:`; this file may not spawn a sibling sim (the hermetic
// sims' M4), so what stands for it here is scenario S6 — a run with no
// `regenerateCmd` whose tasks change no manifest folds green, dispatches no
// resolver and appends no `driver:regenerated`, which is the first Global
// Constraint stated directly.
//
// WHY THIS IS RED AT BASE. `LOCKFILE_BASENAMES` and `dropLockfilesFor` do not
// exist; `patchAgainstBase` has no `dropLockfiles` option, so every lockfile
// rides into every patch; the fold runs no regenerator and appends no
// `driver:regenerated`; and `fleet/CONTRACT.md` names neither the event nor the
// drop. The first assertion below says so by name.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import * as waves from '../run-waves.mjs'
import * as runMain from '../run-main.mjs'
import { cloneAtBase, makeCwdFor, withPatchCapture, defaultTaskIdOf,
         patchAgainstBase } from '../run-waves.mjs'
import { execSeam } from '../run-main.mjs'
import { runEngine } from '../run-engine.mjs'
import { ENV, makeRepo, provision, gitSync, passReview, doneImpl } from './_engine_helpers.mjs'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-lockfile-regen-'))
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }))

// ── the two produced symbols, by namespace ──────────────────────────────────
// A NAMED import of a symbol BASE does not export is a link-time error that
// takes the whole file down with it, and legs (g) and (h) — which touch neither
// symbol — would never report. The namespace import plus these two assertions
// is the same red for the same reason, leg by leg.
const LOCKFILE_BASENAMES = waves.LOCKFILE_BASENAMES
const dropLockfilesFor = runMain.dropLockfilesFor
assert.ok(LOCKFILE_BASENAMES != null,
  '[M1] `fleet/run-waves.mjs` exports `LOCKFILE_BASENAMES` — the lockfile names the ' +
  'launcher\'s bootstrap ladder knows. Got: ' + String(LOCKFILE_BASENAMES))
assert.equal(typeof dropLockfilesFor, 'function',
  '[M1] `fleet/run-main.mjs` exports `dropLockfilesFor(argsObj) -> boolean`. Got: ' +
  typeof dropLockfilesFor)

// ══════════════════════════════════════════════════════════════════════════
// fixtures — a manifest whose lockfile is a fixed function of it
// ══════════════════════════════════════════════════════════════════════════
//
// `bun.lock` holds the first 16 hex characters of `sha256(package.json)`, which
// is what the sim's regenerator writes and what its FROZEN bootstrap checks —
// so the bootstrap can pass on a folded candidate ONLY IF the regenerator ran
// on the merged manifest first. That is the whole instrument behind leg (b)'s
// ordering claim, and it is a fact about the files, not about the engine.
const sha16 = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 16)

const PKG_LINES = [
  '{',
  '  "name": "sim-target",',
  '  "private": true,',
  '  "dependencies": {',
  '    "alpha": "1.0.0",',
  '    "bravo": "1.0.0",',
  '    "charlie": "1.0.0",',
  '    "delta": "1.0.0",',
  '    "echo": "1.0.0",',
  '    "foxtrot": "1.0.0",',
  '    "golf": "1.0.0",',
  '    "hotel": "1.0.0"',
  '  }',
  '}',
]
// A adds its dependency near the TOP and B near the BOTTOM — seven lines apart,
// more than twice a diff's three lines of context — so the two manifests fold
// as text with nothing narrated and the only contended path is the lockfile.
const DEPS_LINE = '  "dependencies": {'
const LAST_DEP_LINE = '    "hotel": "1.0.0"'
const withA = (lines) => {
  const out = lines.slice()
  out.splice(out.indexOf(DEPS_LINE) + 1, 0, '    "a-added": "1.0.0",')
  return out
}
const withB = (lines) => {
  const out = lines.slice()
  out.splice(out.indexOf(LAST_DEP_LINE), 0, '    "z-added": "1.0.0",')
  return out
}
const text = (lines) => lines.join('\n') + '\n'
const PKG_BASE = text(PKG_LINES)
const PKG_A = text(withA(PKG_LINES))
const PKG_B = text(withB(PKG_LINES))
const PKG_MERGED = text(withB(withA(PKG_LINES)))
const lockOf = (pkg) => sha16(Buffer.from(pkg)) + '\n'
const LOCK_BASE = lockOf(PKG_BASE)
const LOCK_MERGED = lockOf(PKG_MERGED)

// The shell lines. `>> <order>` is how the regenerator and the bootstrap each
// leave a mark naming the manifest they saw, so leg (b) can read their ORDER
// off the file rather than off a log line's prose.
const regenCmd = (order) =>
  'h=$(sha256sum package.json | cut -c1-16); echo "regenerate $h" >> ' + order +
  '; printf "%s\\n" "$h" > bun.lock'
const frozenBootstrapCmd = (order) =>
  'h=$(sha256sum package.json | cut -c1-16); l=$(cut -c1-16 bun.lock)' +
  '; echo "bootstrap $h $l" >> ' + order + '; test "$l" = "$h"'

// ══════════════════════════════════════════════════════════════════════════
// the sim: provision, the real capture, the real engine
// ══════════════════════════════════════════════════════════════════════════
const RESOLVED_LOCK = 'resolved-by-the-canned-resolver\n'

const allEvents = (runDir) => {
  const file = path.join(runDir, 'events.jsonl')
  if (!fs.existsSync(file)) return []
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l) } catch { return null } })
    .filter(Boolean)
}
const ofKind = (evs, kind) => evs.filter((e) => e.kind === kind)
// Raw bytes out of a tree: `git show` through the sim's own environment, never
// decoded and never trimmed — a lockfile's trailing newline is part of what the
// legs compare.
const showBytes = (cwd, sha, p) =>
  execFileSync('git', ['show', sha + ':' + p],
    { cwd, env: ENV, maxBuffer: 64 * 1024 * 1024 })
// The paths a patch file carries a hunk for, read off its own `diff --git`
// headers.
const patchHeaders = (file) =>
  [...fs.readFileSync(file, 'utf8').matchAll(/^diff --git a\/(\S+) b\/(\S+)$/gm)]
    .map((m) => m[2]).sort()

const entry = (id, files) => ({
  id,
  title: 'task ' + id,
  files,
  writes: files,
  commutes: [],
  tier: 'standard',
  review: 'lean',
  interfaces: { consumes: [], produces: [] },
  testCmd: 'bash check.sh',
  proofTests: [],
  proofRuns: [],
  body: '**Claim:** ' + id + ' adds one dependency\n' +
    'Machine: M1. The manifest gains one line.\n\n' +
    '**Proof:**\n- Legs: (a) the line is in the manifest [M1]',
})

let seq = 0
/**
 * One engine run over a two-task wave.
 *
 *   files          extra tracked files for the target repo
 *   seed           a last commit on the repo, for a tracked path at depth
 *   tasks          the wave's task entries
 *   onImpl         (cwd, id) — what each implementer leaves in its own clone
 *   dropLockfiles  passed to `withPatchCapture` only when true, so a run
 *                  without it reaches the capture BASE reaches
 *   bootstrapCmd / regenerateCmd — the run's own arguments
 *
 * No `foldAgeMs`: reading 2 in the header. `width: 2` so both lanes dispatch at
 * once and both results are pending when the `end` fold takes them.
 */
async function simRun(opts) {
  seq += 1
  const stamp = 'lr' + seq
  const repo = makeRepo(path.join(tmp, 'repo-' + stamp), opts.files || {})
  if (opts.seed) opts.seed(repo)
  const runDir = path.join(tmp, 'run-' + stamp)
  const { base, clonesDir, patchesDir, integ } =
    provision({ repo, runDir, taskIds: opts.tasks.map((t) => t.id) })
  const patchBase = { current: base }
  const cwdFor = makeCwdFor({ clonesDir })
  const calls = []
  const prompts = {}
  const dropped = []
  const inner = async (prompt, o) => {
    const cwd = cwdFor(o)
    calls.push(o.label)
    prompts[o.label] = prompt
    const [kind, id] = String(o.label).split(':')
    if (kind === 'impl') { opts.onImpl(cwd, id); return doneImpl(cwd) }
    if (kind === 'review') return passReview()
    if (kind === 'resolve') {
      // The canned resolver: RESOLVED, with the hunk ids read off the hunks
      // file the driver briefed it on. It exists so that a run which DOES
      // dispatch one (a BASE-shaped run, or this engine at BASE) still folds
      // and the assertion that fires is the one about the dispatch, not an
      // unexpected-dispatch throw three layers down.
      const m = /\nHUNKS FILE: (.*?) \(conflicted path: ([^)]*)\)/.exec(prompt)
      const ids = m && fs.existsSync(m[1])
        ? [...fs.readFileSync(m[1], 'utf8').matchAll(/^HUNK (\S+) /gm)].map((x) => x[1])
        : []
      return { status: 'RESOLVED', notes: '',
               hunks: (ids.length ? ids : ['h1']).map((hid) => ({ id: hid, content: RESOLVED_LOCK })) }
    }
    // The sim never repairs a red candidate: a fold that goes red is a fold
    // this file wants to read the BLOCKED route of.
    if (kind === 'reconcile') return { status: 'BLOCKED', summary: 'the sim never reconciles' }
    throw new Error('unexpected dispatch: ' + o.label)
  }
  const agent = withPatchCapture({
    agent: inner, clonesDir, base: () => patchBase.current, patchesDir,
    taskIdOf: defaultTaskIdOf,
    ...(opts.dropLockfiles ? { dropLockfiles: true } : {}),
    onEvent: (e) => { if (e && e.kind === 'capture:dropped') dropped.push(e) },
  })
  const report = await runEngine({
    args: {
      waves: [opts.tasks], edges: [], testCmd: opts.testCmd || 'bash check.sh',
      acceptance: { mode: 'suite', reason: 'sim' }, stamp,
      integrationBranch: 'ultra/integration-' + stamp,
      dependencyEdges: [], patchInput: patchesDir, width: 2,
      ...(opts.bootstrapCmd ? { bootstrapCmd: opts.bootstrapCmd } : {}),
      ...(opts.regenerateCmd ? { regenerateCmd: opts.regenerateCmd } : {}),
    },
    agent,
    parallel: (thunks) => Promise.all(thunks.map((t) => t())),
    exec: execSeam,
    paths: { repoDir: repo, runDir, clonesDir },
    log: () => {},
    phase: () => {},
    patchBase,
  })
  return { report, base, repo, runDir, patchesDir, integ, calls, prompts, dropped,
           events: allEvents(runDir) }
}

const resolverLabels = (calls) => calls.filter((l) => String(l).startsWith('resolve:'))
const statuses = (report) =>
  report.tasks.map((r) => [r.task, r.status]).sort((x, y) => (x[0] < y[0] ? -1 : 1))

// The manifest tasks, shared by every scenario that folds two manifests.
const MANIFEST_TASKS = [entry('A', ['package.json', 'bun.lock']),
                        entry('B', ['package.json', 'bun.lock'])]
// Each implementer writes its own manifest AND its own lockfile — the lockfile
// being its own regenerator's output over its own manifest, which is why the
// two lockfiles contend at BASE.
const manifestImpl = (cwd, id) => {
  const pkg = id === 'A' ? PKG_A : PKG_B
  fs.writeFileSync(path.join(cwd, 'package.json'), pkg)
  fs.writeFileSync(path.join(cwd, 'bun.lock'), lockOf(pkg))
}
// The non-manifest pair: a text file each, no manifest anywhere near it.
const TEXT_TASKS = [entry('A', ['a.txt']), entry('B', ['b.txt'])]
const textImpl = (cwd, id) => {
  fs.writeFileSync(path.join(cwd, id === 'A' ? 'a.txt' : 'b.txt'), 'written by ' + id + '\n')
}

// ══════════════════════════════════════════════════════════════════════════
// (a) [M1] the names, the gate, and what a capture drops
// ══════════════════════════════════════════════════════════════════════════
{
  assert.deepEqual([...LOCKFILE_BASENAMES].slice().sort(),
    ['bun.lock', 'bun.lockb', 'package-lock.json', 'pnpm-lock.yaml', 'uv.lock'],
    '(a) [M1] `LOCKFILE_BASENAMES` is EXACTLY the five lockfiles the launcher\'s bootstrap ' +
    'ladder knows and derives a regenerator for — no more and no fewer. Got: ' +
    JSON.stringify([...LOCKFILE_BASENAMES]))
  assert.equal([...LOCKFILE_BASENAMES].length, 5,
    '(a) [M1] and it names each of them once: ' + JSON.stringify([...LOCKFILE_BASENAMES]))

  // `true` EXACTLY when `regenerateCmd` is a non-empty string.
  assert.equal(dropLockfilesFor({ regenerateCmd: 'bun install' }), true,
    '(a) [M1] `dropLockfilesFor({ regenerateCmd: \'bun install\' })` is `true` — the run can ' +
    'rebuild what the capture drops')
  assert.equal(dropLockfilesFor({}), false,
    '(a) [M1] `dropLockfilesFor({})` is `false` — a dropped lockfile nobody regenerates is ' +
    'worse than BASE')
  assert.equal(dropLockfilesFor({ regenerateCmd: '' }), false,
    '(a) [M1] `dropLockfilesFor({ regenerateCmd: \'\' })` is `false`')
  assert.equal(dropLockfilesFor({ regenerateCmd: '  ' }), false,
    '(a) [M1] `dropLockfilesFor({ regenerateCmd: \'  \' })` is `false` — whitespace is not a ' +
    'command')
  assert.equal(dropLockfilesFor({ regenerateCmd: true }), false,
    '(a) [M1] and `false` for a `regenerateCmd` that is not a string at all')
}

// ── (a) the direct `patchAgainstBase` calls: the option, and only the option ─
{
  const repo = makeRepo(path.join(tmp, 'direct-repo'),
    { 'package.json': PKG_BASE, 'bun.lock': LOCK_BASE })
  fs.mkdirSync(path.join(repo, 'client'), { recursive: true })
  fs.writeFileSync(path.join(repo, 'client', 'bun.lock'), 'nested-base\n')
  gitSync(['add', '-A'], repo)
  gitSync(['commit', '-q', '-m', 'the nested lockfile'], repo)
  const base = gitSync(['rev-parse', 'HEAD'], repo)
  const clone = path.join(tmp, 'direct-clone')
  cloneAtBase({ repo, dest: clone, base })
  // What a worker's tree looks like after it added a package and ran a test:
  // a changed manifest, a changed lockfile, a changed lockfile AT DEPTH, and
  // an untracked binary no task named.
  fs.writeFileSync(path.join(clone, 'package.json'), PKG_A)
  fs.writeFileSync(path.join(clone, 'bun.lock'), lockOf(PKG_A))
  fs.writeFileSync(path.join(clone, 'client', 'bun.lock'), 'nested-changed\n')
  fs.mkdirSync(path.join(clone, 'out'), { recursive: true })
  // Written as BYTES, never as a literal in this file's own source: a raw NUL
  // in a source file is what #1062 was.
  fs.writeFileSync(path.join(clone, 'out', 'blob.bin'),
    Buffer.from([0x00, 0x01, 0x02, 0xff, 0x00, 0x7f, 0x00]))
  // `bun.lock` is INSIDE the task's Files here, on purpose: the drop is the
  // option's, not the scope's.
  const FILES = ['package.json', 'bun.lock']

  const absentDrops = []
  const absent = patchAgainstBase({ cwd: clone, base, out: path.join(tmp, 'p-absent.patch'),
    files: FILES, onDropped: (p) => absentDrops.push(p) })
  const falseDrops = []
  const withFalse = patchAgainstBase({ cwd: clone, base, out: path.join(tmp, 'p-false.patch'),
    files: FILES, dropLockfiles: false, onDropped: (p) => falseDrops.push(p) })
  const trueDrops = []
  const withTrue = patchAgainstBase({ cwd: clone, base, out: path.join(tmp, 'p-true.patch'),
    files: FILES, dropLockfiles: true, onDropped: (p) => trueDrops.push(p) })

  assert.deepEqual(patchHeaders(absent),
    ['bun.lock', 'client/bun.lock', 'package.json'],
    '(a) [M1] a direct `patchAgainstBase` over a clone that changed `bun.lock`, with NO ' +
    '`dropLockfiles` option, writes a patch that DOES carry the `bun.lock` header — and the ' +
    'nested one, and the manifest. (`out/blob.bin` is the unnamed binary BASE already drops.) ' +
    'Got: ' + JSON.stringify(patchHeaders(absent)))
  assert.deepEqual(absentDrops, [['out/blob.bin']],
    '(a) [M1] and with the option absent the ONLY drop is the unnamed binary, reported once: ' +
    JSON.stringify(absentDrops))
  assert.deepEqual(falseDrops, [['out/blob.bin']],
    '(a) [M1] `dropLockfiles: false` drops the same one thing: ' + JSON.stringify(falseDrops))
  assert.equal(fs.readFileSync(withFalse, 'utf8'), fs.readFileSync(absent, 'utf8'),
    '(a) [M1] with the option absent or `false` the capture is byte-for-byte the same patch — ' +
    'BASE\'s')

  assert.deepEqual(patchHeaders(withTrue), ['package.json'],
    '(a) [M1] with `dropLockfiles: true` the patch carries the manifest and NO lockfile hunk ' +
    'at any depth — not `bun.lock`, which the task\'s own Files name, and not ' +
    '`client/bun.lock`. Got: ' + JSON.stringify(patchHeaders(withTrue)))
  assert.deepEqual(trueDrops, [['bun.lock', 'client/bun.lock', 'out/blob.bin']],
    '(a) [M1] and `onDropped` is called ONCE with the sorted union of both lists — the ' +
    'lockfiles at any depth alongside the unnamed binaries it already drops. Got: ' +
    JSON.stringify(trueDrops))
}

// ══════════════════════════════════════════════════════════════════════════
// S1 — legs (a) and (b) [M1, M2]: the two-task regenerating run
// ══════════════════════════════════════════════════════════════════════════
//
// Two tasks, one wave, both adding a package and both writing their own
// lockfile. The bootstrap is FROZEN: it passes only when `bun.lock` already
// holds the hash of the `package.json` beside it, which on a folded candidate
// is true only after the regenerator ran on the MERGED manifest.
const S1_ORDER = path.join(tmp, 'order-s1.log')
const S1_REGEN = regenCmd(S1_ORDER)
const S1_BOOT = frozenBootstrapCmd(S1_ORDER)
const s1 = await simRun({
  files: { 'package.json': PKG_BASE, 'bun.lock': LOCK_BASE },
  seed: (repo) => {
    // A tracked lockfile AT DEPTH, so leg (a)'s depth clause is read off a real
    // run and not only off the direct call above.
    fs.mkdirSync(path.join(repo, 'client'), { recursive: true })
    fs.writeFileSync(path.join(repo, 'client', 'bun.lock'), 'nested-base\n')
    gitSync(['add', '-A'], repo)
    gitSync(['commit', '-q', '-m', 'the nested lockfile'], repo)
  },
  tasks: [entry('A', ['package.json', 'bun.lock', 'client/bun.lock']),
          entry('B', ['package.json', 'bun.lock'])],
  onImpl: (cwd, id) => {
    manifestImpl(cwd, id)
    if (id === 'A') fs.writeFileSync(path.join(cwd, 'client', 'bun.lock'), 'nested-A\n')
  },
  dropLockfiles: true,
  bootstrapCmd: S1_BOOT,
  regenerateCmd: S1_REGEN,
})

{
  // ── (a) [M1] what each task's capture carried, and what it named ──────────
  for (const id of ['A', 'B']) {
    const patch = path.join(s1.patchesDir, 'task-' + id + '.patch')
    assert.ok(fs.existsSync(patch),
      '(a) [M1] sim precondition — the driver captured ' + id + '\'s patch at ' + patch)
    assert.deepEqual(patchHeaders(patch), ['package.json'],
      '(a) [M1] in the two-task regenerating run, ' + id + '\'s captured patch carries a ' +
      '`diff --git` header for `package.json` and NONE for `bun.lock` — the tree it left had ' +
      'a changed lockfile and the patch carries no hunk for it. Got: ' +
      JSON.stringify(patchHeaders(patch)))
  }
  const dropOf = (label) => s1.dropped.filter((e) => e.label === label)
  for (const id of ['A', 'B']) {
    assert.equal(dropOf('impl:' + id).length, 1,
      '(a) [M1] ' + id + '\'s capture appended exactly one `capture:dropped` event: ' +
      JSON.stringify(s1.dropped))
  }
  assert.deepEqual(dropOf('impl:A')[0].paths, ['bun.lock', 'client/bun.lock'],
    '(a) [M1] A\'s `capture:dropped` names `bun.lock` — and `client/bun.lock`, the same drop ' +
    'at depth, sorted. Got: ' + JSON.stringify(dropOf('impl:A')[0]))
  assert.deepEqual(dropOf('impl:B')[0].paths, ['bun.lock'],
    '(a) [M1] and B\'s names `bun.lock`: ' + JSON.stringify(dropOf('impl:B')[0]))

  // ── (b) [M2] no resolver was asked to merge a lockfile ────────────────────
  assert.deepEqual(resolverLabels(s1.calls), [],
    '(b) [M2, M4] in a run that carries a regenerator, a lockfile a task\'s tree changed is ' +
    'never a conflict the kernel narrates: NO `resolve:` worker is dispatched. Got: ' +
    JSON.stringify(s1.calls))
  assert.deepEqual(
    s1.events.filter((e) => String(e.label || '').startsWith('resolve:')).map((e) => e.kind), [],
    '(b) [M2, M4] and the record carries no row for one either — no `worker:start` and no ' +
    '`resolver:reply` whose label begins `resolve:`: ' +
    JSON.stringify(s1.events.filter((e) => String(e.label || '').startsWith('resolve:'))))
  assert.deepEqual(ofKind(s1.events, 'resolver:reply'), [],
    '(b) [M4] and no `resolver:reply` names anything at all: ' +
    JSON.stringify(ofKind(s1.events, 'resolver:reply')))

  // ── (b) [M2] the one `driver:regenerated` ─────────────────────────────────
  const regen = ofKind(s1.events, 'driver:regenerated')
  assert.equal(regen.length, 1,
    '(b) [M2] exactly one `driver:regenerated` event — one fold, one regenerator run. Got: ' +
    JSON.stringify(regen))
  assert.deepEqual(
    { wave: regen[0].wave, cmd: regen[0].cmd, exit: regen[0].exit, paths: regen[0].paths },
    { wave: 1, cmd: S1_REGEN, exit: 0, paths: ['bun.lock'] },
    '(b) [M2] `driver:regenerated {wave, cmd, exit, paths}` — the 1-based epoch, the command ' +
    'verbatim, exit `0`, and the sorted paths it rebuilt. Got: ' + JSON.stringify(regen[0]))

  // ── (b) [M2] what the epoch adopted ───────────────────────────────────────
  const adopted = ofKind(s1.events, 'driver:wave-adopted')
  assert.equal(adopted.length, 1,
    '(b) [M2] the wave adopted once: ' + JSON.stringify(adopted) + ' from ' +
    JSON.stringify(s1.calls))
  assert.deepEqual([...adopted[0].tasks].sort(), ['A', 'B'],
    '(b) [M2] and `driver:wave-adopted` names both tasks: ' + JSON.stringify(adopted[0]))
  const head = adopted[0].headSha
  assert.equal(showBytes(s1.integ, head, 'package.json').toString(), PKG_MERGED,
    '(b) [M2] the adopted head\'s `package.json` is the merged manifest — A\'s line near the ' +
    'top and B\'s near the bottom, both of them. Got: ' +
    JSON.stringify(showBytes(s1.integ, head, 'package.json').toString()))
  assert.equal(showBytes(s1.integ, head, 'bun.lock').toString(), LOCK_MERGED,
    '(b) [M2] and its `bun.lock` is EXACTLY the regenerator\'s output over that merged ' +
    '`package.json` — not either task\'s lockfile and not BASE\'s. Got: ' +
    JSON.stringify(showBytes(s1.integ, head, 'bun.lock').toString()) + ', wanted ' +
    JSON.stringify(LOCK_MERGED))
  assert.equal(showBytes(s1.integ, head, 'client/bun.lock').toString(), 'nested-base\n',
    '(b) [M2] and the lockfile at depth is BASE\'s — A\'s change to it was dropped at capture ' +
    'and no regenerator rebuilt it')
  assert.equal(gitSync(['log', '-1', '--format=%s', head], s1.integ),
    'wave 1 regenerated bun.lock',
    '(b) [M2] the adopted head IS the regenerated commit: its subject is the line `wave <n> ' +
    'regenerated <paths>`, sitting on the tree the fold materialized. Got: ' +
    JSON.stringify(gitSync(['log', '-1', '--format=%s', head], s1.integ)))
  assert.ok(Number(gitSync(['rev-list', '--count', s1.base + '..' + head], s1.integ)) >= 1,
    '(b) [M2] and it is a descendant of the head the epoch folded onto')

  // ── (b) [M2] the regenerator ran BEFORE the candidate's bootstrap ─────────
  // Each command left a line naming the manifest it saw. The setup pass
  // bootstrapped four clones at BASE, so those lines name BASE's hash; the
  // fold's own pair names the MERGED hash, and only in that order can the
  // frozen check have passed.
  const order = fs.readFileSync(S1_ORDER, 'utf8').split('\n').filter(Boolean)
  const mergedH = sha16(Buffer.from(PKG_MERGED))
  const iRegen = order.indexOf('regenerate ' + mergedH)
  const iBoot = order.indexOf('bootstrap ' + mergedH + ' ' + mergedH)
  assert.ok(iRegen !== -1,
    '(b) [M2] the regenerator ran on the MERGED manifest: ' + JSON.stringify(order))
  assert.ok(iBoot !== -1,
    '(b) [M2] the candidate\'s bootstrap ran on the merged manifest and found the rebuilt ' +
    'lockfile beside it — the FROZEN check, which cannot pass before regeneration: ' +
    JSON.stringify(order))
  assert.ok(iRegen < iBoot,
    '(b) [M2] and the regenerator\'s mark is BEFORE the bootstrap\'s: the regenerator runs ' +
    'after `read-tree` of the candidate and before the #825 bootstrap. Got: ' +
    JSON.stringify(order))

  assert.deepEqual(statuses(s1.report), [['A', 'done'], ['B', 'done']],
    '(b) [M2] and both tasks finish: ' + JSON.stringify(statuses(s1.report)))
}

// ══════════════════════════════════════════════════════════════════════════
// S2 — leg (c) [M2]: a regenerator that rewrites nothing
// ══════════════════════════════════════════════════════════════════════════
//
// Same shape, but the lockfile is already equal to the regenerator's output
// over the merged manifest: the command runs, writes the same bytes, and the
// fold has nothing to commit.
const S2_REGEN = 'printf "lock-v1\\n" > bun.lock'
const S2_BOOT = 'test "$(cat bun.lock)" = "lock-v1"'
{
  const s2 = await simRun({
    files: { 'package.json': PKG_BASE, 'bun.lock': 'lock-v1\n' },
    tasks: MANIFEST_TASKS,
    onImpl: (cwd, id) => {
      fs.writeFileSync(path.join(cwd, 'package.json'), id === 'A' ? PKG_A : PKG_B)
      fs.writeFileSync(path.join(cwd, 'bun.lock'), 'lock-written-by-' + id + '\n')
    },
    dropLockfiles: true,
    bootstrapCmd: S2_BOOT,
    regenerateCmd: S2_REGEN,
  })

  const regen = ofKind(s2.events, 'driver:regenerated')
  assert.equal(regen.length, 1,
    '(c) [M2] the regenerator ran — the candidate changed a manifest — so one ' +
    '`driver:regenerated` is appended even though it rebuilt nothing: ' + JSON.stringify(regen))
  assert.deepEqual(
    { wave: regen[0].wave, cmd: regen[0].cmd, exit: regen[0].exit, paths: regen[0].paths },
    { wave: 1, cmd: S2_REGEN, exit: 0, paths: [] },
    '(c) [M2] and when the command changed no lockfile the event carries `paths: []`. Got: ' +
    JSON.stringify(regen[0]))

  const adopted = ofKind(s2.events, 'driver:wave-adopted')
  assert.equal(adopted.length, 1,
    '(c) [M2] the wave adopted once: ' + JSON.stringify(adopted) + ' from ' +
    JSON.stringify(s2.calls))
  const head = adopted[0].headSha
  assert.equal(gitSync(['rev-list', '--count', s2.base + '..' + head], s2.integ), '1',
    '(c) [M2] nothing was committed: the adopted `headSha` IS the materialized candidate — one ' +
    'commit on the head the epoch folded onto, not two. `git log`: ' +
    JSON.stringify(gitSync(['log', '--format=%s', s2.base + '..' + head], s2.integ)))
  assert.doesNotMatch(gitSync(['log', '-1', '--format=%s', head], s2.integ),
    /^wave \d+ regenerated /,
    '(c) [M2] and no regenerated commit sits on top of it: ' +
    JSON.stringify(gitSync(['log', '-1', '--format=%s', head], s2.integ)))
  assert.equal(showBytes(s2.integ, head, 'bun.lock').toString(), 'lock-v1\n',
    '(c) [M2] the adopted lockfile is the one the candidate already held')
  assert.equal(showBytes(s2.integ, head, 'package.json').toString(), PKG_MERGED,
    '(c) [M2] over the merged manifest')
  assert.deepEqual(resolverLabels(s2.calls), [],
    '(c) [M2, M4] and no resolver was dispatched: ' + JSON.stringify(s2.calls))
}

// ══════════════════════════════════════════════════════════════════════════
// S3 — leg (d) [M3]: a regenerator that exits 2
// ══════════════════════════════════════════════════════════════════════════
const S3_REGEN = 'echo "regen boom"; exit 2'
{
  const s3 = await simRun({
    files: { 'package.json': PKG_BASE, 'bun.lock': LOCK_BASE },
    tasks: MANIFEST_TASKS,
    onImpl: manifestImpl,
    dropLockfiles: true,
    bootstrapCmd: 'true',
    regenerateCmd: S3_REGEN,
  })

  const regen = ofKind(s3.events, 'driver:regenerated')
  assert.equal(regen.length, 1,
    '(d) [M3] one `driver:regenerated` for the failed run: ' + JSON.stringify(regen))
  assert.deepEqual(
    { wave: regen[0].wave, cmd: regen[0].cmd, exit: regen[0].exit, paths: regen[0].paths },
    { wave: 1, cmd: S3_REGEN, exit: 2, paths: [] },
    '(d) [M3] carrying the command\'s own exit `2` and `paths: []`. Got: ' +
    JSON.stringify(regen[0]))

  assert.deepEqual(ofKind(s3.events, 'driver:wave-adopted'), [],
    '(d) [M3] and the epoch adopted nothing — a regenerator that exits non-zero stands in ' +
    'place of the suite exactly as a failed bootstrap does, so the candidate is RED before a ' +
    'reconcile is attempted: ' + JSON.stringify(ofKind(s3.events, 'driver:wave-adopted')))
  const blocked = ofKind(s3.events, 'driver:wave-blocked')
  assert.equal(blocked.length, 1,
    '(d) [M3] the wave took the route a red bootstrap takes at BASE and was blocked once ' +
    '(the sim\'s canned reconcile answers BLOCKED): ' + JSON.stringify(blocked) + ' from ' +
    JSON.stringify(s3.calls))
  assert.deepEqual([...blocked[0].tasks].sort(), ['A', 'B'],
    '(d) [M3] naming both tasks of the epoch: ' + JSON.stringify(blocked[0]))
  assert.ok(String(blocked[0].detail).includes('regen boom'),
    '(d) [M3] and its `detail` quotes the REGENERATOR\'s own output — the candidate is red on ' +
    'the regenerator, not on a suite that never ran. Got: ' + JSON.stringify(blocked[0].detail))
}

// ══════════════════════════════════════════════════════════════════════════
// S4 — leg (e) [M4], first half: a regenerating run that changed no manifest
// ══════════════════════════════════════════════════════════════════════════
const S4_ORDER = path.join(tmp, 'order-s4.log')
{
  const s4 = await simRun({
    files: { 'package.json': PKG_BASE, 'bun.lock': LOCK_BASE },
    tasks: TEXT_TASKS,
    onImpl: textImpl,
    dropLockfiles: true,
    bootstrapCmd: frozenBootstrapCmd(S4_ORDER),
    regenerateCmd: regenCmd(S4_ORDER),
  })

  assert.deepEqual(ofKind(s4.events, 'driver:regenerated'), [],
    '(e) [M4] a fold whose candidate changed no manifest runs no regenerator and appends no ' +
    '`driver:regenerated`: ' + JSON.stringify(ofKind(s4.events, 'driver:regenerated')))
  const order = fs.existsSync(S4_ORDER)
    ? fs.readFileSync(S4_ORDER, 'utf8').split('\n').filter(Boolean) : []
  assert.deepEqual(order.filter((l) => l.startsWith('regenerate ')), [],
    '(e) [M4] and the regenerator left no mark of its own — it was never executed: ' +
    JSON.stringify(order))
  assert.deepEqual(resolverLabels(s4.calls), [],
    '(e) [M4] no `resolve:` dispatch: ' + JSON.stringify(s4.calls))
  const adopted = ofKind(s4.events, 'driver:wave-adopted')
  assert.equal(adopted.length, 1,
    '(e) [M4] the wave adopted once: ' + JSON.stringify(adopted) + ' from ' +
    JSON.stringify(s4.calls))
  const head = adopted[0].headSha
  assert.equal(showBytes(s4.integ, head, 'bun.lock').toString(), LOCK_BASE,
    '(e) [M4] and the adopted `bun.lock` is byte-equal to BASE\'s')
  assert.equal(showBytes(s4.integ, head, 'package.json').toString(), PKG_BASE,
    '(e) [M4] over the manifest BASE had, unchanged')
  assert.deepEqual(statuses(s4.report), [['A', 'done'], ['B', 'done']],
    '(e) [M4] both tasks finish: ' + JSON.stringify(statuses(s4.report)))
}

// ══════════════════════════════════════════════════════════════════════════
// S5 — leg (e) [M4], second half: the same manifests with NO regenerator
// ══════════════════════════════════════════════════════════════════════════
//
// No `regenerateCmd` in the args and no `dropLockfiles` on the capture: the run
// is BASE's, and BASE's is a run whose two lockfiles contend and whose fold
// asks a model to merge one.
{
  const s5 = await simRun({
    files: { 'package.json': PKG_BASE, 'bun.lock': LOCK_BASE },
    tasks: MANIFEST_TASKS,
    onImpl: manifestImpl,
    bootstrapCmd: 'true',
  })

  for (const id of ['A', 'B']) {
    const patch = path.join(s5.patchesDir, 'task-' + id + '.patch')
    assert.deepEqual(patchHeaders(patch), ['bun.lock', 'package.json'],
      '(e) [M4] with no `regenerateCmd` the run drops no lockfile at capture: ' + id + '\'s ' +
      'patch carries the `bun.lock` header. Got: ' + JSON.stringify(patchHeaders(patch)))
  }
  assert.deepEqual(s5.dropped, [],
    '(e) [M4] and nothing was dropped at all: ' + JSON.stringify(s5.dropped))
  assert.deepEqual(resolverLabels(s5.calls), ['resolve:wave1:1:1'],
    '(e) [M4] the fold narrates the lockfile conflict and dispatches `resolve:wave1:1:1` on ' +
    'it, exactly as at BASE: ' + JSON.stringify(s5.calls))
  const brief = s5.prompts['resolve:wave1:1:1']
  const conflicted = /\nHUNKS FILE: .*? \(conflicted path: ([^)]*)\)/.exec(String(brief))
  assert.equal(conflicted && conflicted[1], 'bun.lock',
    '(e) [M4] and the path it was briefed on is `bun.lock`: ' +
    JSON.stringify(conflicted && conflicted[1]))
  assert.deepEqual(ofKind(s5.events, 'driver:regenerated'), [],
    '(e) [M4] no `driver:regenerated` is on the log of a run that carries no regenerator: ' +
    JSON.stringify(ofKind(s5.events, 'driver:regenerated')))
  assert.equal(ofKind(s5.events, 'driver:wave-adopted').length, 1,
    '(e) [M4] and the wave folds with the canned resolver, as it does at BASE: ' +
    JSON.stringify(s5.calls))
  assert.deepEqual(statuses(s5.report), [['A', 'done'], ['B', 'done']],
    '(e) [M4] both tasks finish: ' + JSON.stringify(statuses(s5.report)))
}

// ══════════════════════════════════════════════════════════════════════════
// S6 — leg (f) [M4]: the untouched fold path, stated in file
// ══════════════════════════════════════════════════════════════════════════
//
// Leg (f) is the Proof's second `Run:`, the whole pre-review-pass sim, which
// the DRIVER executes — this file may not spawn a sibling sim. What stands for
// it here is the first Global Constraint said directly: a run whose tasks touch
// no lockfile and whose fold changes no manifest, with no `regenerateCmd`
// anywhere, runs exactly as at BASE — no regenerator, no `driver:regenerated`,
// no resolver, and the lockfile it started with.
{
  const s6 = await simRun({
    files: { 'package.json': PKG_BASE, 'bun.lock': LOCK_BASE },
    tasks: TEXT_TASKS,
    onImpl: textImpl,
    bootstrapCmd: 'true',
  })

  assert.deepEqual(ofKind(s6.events, 'driver:regenerated'), [],
    '(f) [M4] a run with no `regenerateCmd` whose fold changes no manifest appends no ' +
    '`driver:regenerated`: ' + JSON.stringify(ofKind(s6.events, 'driver:regenerated')))
  assert.deepEqual(resolverLabels(s6.calls), [],
    '(f) [M4] and dispatches no resolver: ' + JSON.stringify(s6.calls))
  assert.deepEqual(s6.dropped, [],
    '(f) [M4] and its captures drop nothing: ' + JSON.stringify(s6.dropped))
  const adopted = ofKind(s6.events, 'driver:wave-adopted')
  assert.equal(adopted.length, 1,
    '(f) [M4] the fold path a manifest-free run takes is unchanged — it adopts: ' +
    JSON.stringify(adopted) + ' from ' + JSON.stringify(s6.calls))
  assert.equal(showBytes(s6.integ, adopted[0].headSha, 'bun.lock').toString(), LOCK_BASE,
    '(f) [M4] with BASE\'s lockfile still in the tree')
  assert.deepEqual(statuses(s6.report), [['A', 'done'], ['B', 'done']],
    '(f) [M4] and both tasks finish: ' + JSON.stringify(statuses(s6.report)))
}

// ══════════════════════════════════════════════════════════════════════════
// (g) [M5] the contract — the Proof's third `Run:`, read here too
// ══════════════════════════════════════════════════════════════════════════
{
  const contract = fs.readFileSync(new URL('../CONTRACT.md', import.meta.url), 'utf8')
  assert.ok(contract.includes('driver:regenerated'),
    '(g) [M5] `driver:regenerated` occurs in `fleet/CONTRACT.md` — every new event kind is ' +
    'named there. At BASE it does not, which is what makes this red.')

  const lines = contract.split('\n')
  const from = lines.findIndex((l) => l.includes('An epoch is a fold, not a layer'))
  const to = lines.findIndex((l) => l.includes('three more kinds'))
  assert.ok(from !== -1 && to > from,
    '(g) [M5] sim precondition — the wave-record paragraph runs from `An epoch is a fold, not ' +
    'a layer` to the line before `three more kinds`: ' + JSON.stringify([from, to]))
  const range = lines.slice(from, to).join(' ')
  assert.ok(range.includes('driver:wave-adopted'),
    '(g) [M5] sim precondition — that range is the paragraph naming `driver:wave-adopted`')
  assert.ok(range.includes('driver:regenerated'),
    '(g) [M5] and `driver:regenerated` is named in THAT paragraph, beside it. The range ' +
    'reads: ' + JSON.stringify(range.slice(-1200)))
  assert.match(range, /driver:regenerated.{0,12}\{\s*wave,\s*cmd,\s*exit,\s*paths\s*\}/,
    '(g) [M5] with its four fields, in order — `{wave, cmd, exit, paths}`. The range reads: ' +
    JSON.stringify(range.slice(-1200)))

  // One sentence has to carry both halves of the capture rule: the leg asks
  // that the sentence naming `capture:dropped` also name `bun.lock`.
  const flat = contract.replace(/\s+/g, ' ')
  const sentences = flat.split(/(?<=[.;]) /)
  const dropSentences = sentences.filter((s) => s.includes('capture:dropped'))
  assert.ok(dropSentences.length >= 1,
    '(g) [M5] `fleet/CONTRACT.md` says what a patch capture drops and names it on ' +
    '`capture:dropped`')
  assert.ok(dropSentences.some((s) => s.includes('bun.lock')),
    '(g) [M5] and the sentence naming `capture:dropped` also names `bun.lock`. The sentences ' +
    'naming it read: ' + JSON.stringify(dropSentences))
  assert.ok(dropSentences.some((s) => s.includes('regenerateCmd')),
    '(g) [M5] and says the drop happens only in a run that carries a `regenerateCmd`: ' +
    JSON.stringify(dropSentences))
  assert.ok(sentences.some((s) => /regenerat/i.test(s) && s.includes('bootstrap')),
    '(g) [M5] and one sentence says the regenerator runs before the candidate\'s bootstrap')
  assert.ok(sentences.some((s) => /regenerat/i.test(s) && /commit/i.test(s)),
    '(g) [M5] and one says the lockfile it writes is committed onto the candidate')
}

// ══════════════════════════════════════════════════════════════════════════
// (h) [M1] the guard — the Proof's fourth `Run:`, read here too
// ══════════════════════════════════════════════════════════════════════════
//
// #1053: an exam reached by an `import` line naming a path under
// `fleet/tests/exams/` is stripped at publish and leaves main red. This file
// stands whole at its guarded path, and reads its own text to say so.
{
  const self = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n')
  const pointers = self.filter((l) => /^import .*exams\//.test(l))
  assert.deepEqual(pointers, [],
    '(h) [M1] the guarded sim carries no `import` line naming a path under `exams/` — it ' +
    'imports the engine and the sim helpers by their `fleet/tests/`-relative paths and ' +
    'nothing else. Found: ' + JSON.stringify(pointers))
}

// The sentinel the Proof's first `Run:` greps for: printed only if every
// assertion above held.
console.log('ALL TESTS PASSED')
