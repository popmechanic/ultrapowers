// fleet/tests/test_run_waves.mjs — the driver's shared substrate.
//
// Under test: clones at BASE (the #314 cure — on REAL git, because the defect
// was about what git actually did), the label→cwd routing, the driver-owned
// patch capture, and the event log. (The waves.js loader half died at 0.3.0;
// the engine's own loop is covered by fleet/tests/test_run_engine*.mjs.)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { cloneAtBase, makeCwdFor, defaultTaskIdOf, patchAgainstBase, withPatchCapture, makeEventLog, ulid } from '../run-waves.mjs'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'runwaves-'))
const git = (argv, cwd) => execFileSync('git', argv, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

// ── 2. clones at BASE — the #314 cure ────────────────────────────────────────
// The fixture IS the #314 condition: a repository whose checkout has moved PAST
// the BASE the wave was compiled against. The Workflow runtime cut worktrees
// from that checkout, so a worker started on the newer tree; waves.js:1116 says
// so in its own words. Here the driver cuts from BASE explicitly, and there is
// no step at which it could cut from anywhere else.
const repo = path.join(tmp, 'repo')
fs.mkdirSync(repo, { recursive: true })
git(['init', '-q', '-b', 'main'], repo)
git(['config', 'user.email', 'sim@example.com'], repo)
git(['config', 'user.name', 'sim'], repo)
fs.writeFileSync(path.join(repo, 'a.txt'), 'base\n')
git(['add', '-A'], repo); git(['commit', '-qm', 'base'], repo)
const BASE = git(['rev-parse', 'HEAD'], repo).trim()
// The checkout moves on, exactly as it had in #314.
fs.writeFileSync(path.join(repo, 'a.txt'), 'newer\n')
fs.writeFileSync(path.join(repo, 'b.txt'), 'added after BASE\n')
git(['add', '-A'], repo); git(['commit', '-qm', 'newer'], repo)
const NEWER = git(['rev-parse', 'HEAD'], repo).trim()
assert.notEqual(BASE, NEWER)

const clonesDir = path.join(tmp, 'clones')
const c1 = cloneAtBase({ repo, dest: path.join(clonesDir, 'task-T1'), base: BASE })
assert.equal(git(['rev-parse', 'HEAD'], c1).trim(), BASE, 'the clone is AT BASE, not at the checkout tip')
assert.equal(fs.readFileSync(path.join(c1, 'a.txt'), 'utf8'), 'base\n')
assert.ok(!fs.existsSync(path.join(c1, 'b.txt')), 'a file added after BASE must not be in the clone — this is #314')
// Detached, so the worker's own commits cannot move a branch the parent shares.
assert.equal(git(['branch', '--show-current'], c1).trim(), '')
// An independent .git: N concurrent workers are N OS processes, and worktrees
// of one repository share an object store and a HEAD-reference namespace.
assert.ok(fs.existsSync(path.join(c1, '.git')))
// A clone must be able to COMMIT with no ambient git identity — `git clone`
// copies no local config, and a worker that cannot commit reports BLOCKED for a
// reason no reviewer can act on. (This test failed in CI for exactly that
// reason before cloneAtBase stamped the identity itself.)
assert.equal(git(['config', 'user.name'], c1).trim(), 'fleet')
assert.equal(git(['config', 'commit.gpgsign'], c1).trim(), 'false',
  'a signing prompt in a headless worker blocks until its deadline')

// Two clones at the same BASE do not disturb each other.
const c2 = cloneAtBase({ repo, dest: path.join(clonesDir, 'task-T2'), base: BASE })
fs.writeFileSync(path.join(c1, 'a.txt'), 'T1 worked here\n')
git(['add', '-A'], c1); git(['commit', '-qm', 'T1'], c1)
assert.equal(git(['rev-parse', 'HEAD'], c2).trim(), BASE, "T1's commit must not move T2")
assert.equal(git(['rev-parse', 'HEAD'], repo).trim(), NEWER, 'nor the parent checkout')

// A BASE that does not resolve must fail loudly, never leave a worker on some
// other tree.
assert.throws(() => cloneAtBase({ repo, dest: path.join(clonesDir, 'task-T9'), base: 'deadbeef'.repeat(5) }))

// ── 3. cwdFor: which directory each of the ten call sites runs in ────────────
fs.mkdirSync(path.join(clonesDir, 'integration'), { recursive: true })
const cwdFor = makeCwdFor({ clonesDir })

// The TWO sites carrying isolation:'worktree' get their task's own clone.
assert.equal(cwdFor({ label: 'impl:T1', isolation: 'worktree' }), c1)     // waves.js:1107
assert.equal(cwdFor({ label: 'fix:T2:1', isolation: 'worktree' }), c2)    // waves.js:1265
// Every other role runs in the integration clone (waves.js:232-235).
for (const label of ['setup', 'merge:wave1', 'reconcile:wave1:1', 'resolve:wave1:0:1', 'review:T1:1', 'integration']) {
  assert.equal(cwdFor({ label }), path.join(clonesDir, 'integration'), label + ' runs in the integration clone')
}
// An implementer whose clone was never provisioned must NOT fall back to the
// integration tree — that is the one directory a stray implementer could do
// real damage in.
assert.throws(() => cwdFor({ label: 'impl:NOPE', isolation: 'worktree' }), /no clone provisioned/)
assert.throws(() => cwdFor({ label: 'weird', isolation: 'worktree' }), /no task id could be read/)

assert.equal(defaultTaskIdOf('impl:T1'), 'T1')
assert.equal(defaultTaskIdOf('fix:T1:2'), 'T1')
assert.equal(defaultTaskIdOf('review:T1:1'), null, 'only impl and fix carry isolation')

// ── 4. patchAgainstBase: the worker's tree as content (Amendment 9) ──────────
// Real git on both ends: the driver captures the patch here, and the KERNEL
// (fold_wave.py, Python) must accept it — two processes, one contract, so a
// flag drift on either side fails this test rather than the first live run.
{
  // T1 committed (its clone is at c1, one commit past BASE). T2 does not
  // commit at all: an edit, an untracked new file (executable), a delete, and
  // a binary write, all left in the working tree.
  const patchesDir = path.join(tmp, 'patches')
  const p1 = patchAgainstBase({ cwd: c1, base: BASE, out: path.join(patchesDir, 'task-T1.patch') })
  fs.writeFileSync(path.join(c2, 'a.txt'), 'base\nT2 appended\n')
  fs.writeFileSync(path.join(c2, 'tool.sh'), '#!/bin/sh\necho t2\n', { mode: 0o755 })
  fs.writeFileSync(path.join(c2, 'blob.bin'), Buffer.from([0, 1, 2, 3]))
  const p2 = patchAgainstBase({ cwd: c2, base: BASE, out: path.join(patchesDir, 'task-T2.patch') })
  const text2 = fs.readFileSync(p2, 'utf8')
  assert.ok(text2.includes('+T2 appended'), 'the edit is in the patch')
  assert.ok(text2.includes('new file mode 100755'), 'an untracked executable is in the patch with its mode')
  assert.ok(text2.includes('GIT binary patch'), 'binary content rides --binary')
  assert.ok(!/^index [0-9a-f]{7}\.\./m.test(text2), 'full-index, never abbreviated')
  // The clone's own HEAD did not move: capture is read-only on refs.
  assert.equal(git(['rev-parse', 'HEAD'], c2).trim(), BASE)

  // The kernel folds both patches over BASE in the parent repo — the one place
  // the merge agent runs — with no fetch, no shared refs, and a checkout that
  // is NOT at BASE (it is at NEWER, the #314 shape; --repo only needs objects).
  const kernel = fileURLToPath(new URL('../../skills/ultrapowers/kernel/fold_wave.py', import.meta.url))
  const runDir = path.join(tmp, 'run')
  const fold = spawnSync('python3', [kernel, 'fold', '--repo', repo, '--run-dir', runDir,
    '--wave', '1', '--base', BASE, '--patch', 'T1=' + p1, '--patch', 'T2=' + p2],
    { encoding: 'utf8' })
  assert.equal(fold.status, 0, 'the kernel accepts driver-captured patches: ' + fold.stdout + fold.stderr)
  const reply = JSON.parse(fold.stdout.trim().split('\n').pop())
  // T1 rewrote a.txt's only line; T2 appended to it — a same-file conflict the
  // kernel narrates, which is the CRDT path stage 1's clones could not reach.
  assert.equal(reply.conflicts, 1, 'the contended path is live under patch input: ' + fold.stdout)
  assert.equal(reply.open[0].path, 'a.txt')
  const events = fs.readFileSync(path.join(runDir, 'frontier/wave-1/fold_log.jsonl'), 'utf8')
    .trim().split('\n').map((l) => JSON.parse(l))
  assert.deepEqual(events.filter((e) => e.type === 'fold').map((e) => [e.task, e.patch]),
    [['T1', p1], ['T2', p2]], 'the log records each task by its patch')
  assert.equal(git(['rev-parse', 'HEAD'], repo).trim(), NEWER, 'the fold moved nothing in the parent checkout')
  assert.equal(git(['status', '--porcelain'], repo).trim(), '')
}

// ── 5. withPatchCapture: the driver is the ONLY producer of patch coordinates ─
{
  const patchesDir = path.join(tmp, 'wrap-patches')
  // A fresh clone for the wrap test; the worker edits and COMMITS (moving
  // HEAD), and also types lies into its reply.
  const c3 = cloneAtBase({ repo, dest: path.join(tmp, 'clones', 'task-T3'), base: BASE })
  const wrapped = withPatchCapture({
    agent: async (_prompt, opts) => {
      if (opts.label === 'impl:T3') {
        fs.writeFileSync(path.join(c3, 'a.txt'), 'T3 was here\n')
        git(['add', '-A'], c3); git(['commit', '-qm', 'T3 round 1'], c3)
        // Model-typed lies, all three coordinates:
        return { status: 'DONE', branch: 'wt-T3', headSha: 'deadbeef', patch: '/etc/passwd' }
      }
      if (opts.label === 'fix:T3:1') return { status: 'DONE', branch: 'wt-T3', headSha: 'deadbeef' }
      if (opts.label === 'review:T3:1') return { verdict: 'PASS', typed: true }
      return null
    },
    clonesDir: path.join(tmp, 'clones'), base: BASE, patchesDir,
  })

  const r = await wrapped('p', { label: 'impl:T3', isolation: 'worktree' })
  assert.equal(r.patch, path.join(patchesDir, 'task-T3.patch'), 'the patch path is the DRIVER’s, never the model’s')
  assert.ok(fs.readFileSync(r.patch, 'utf8').includes('+T3 was here'), 'the patch is the clone’s real diff')
  assert.equal(r.branch, '', 'branch is cleared — detached by design, no branch exists')
  assert.equal(r.headSha, git(['rev-parse', 'HEAD'], c3).trim(), 'headSha is derived from the clone, replacing the model-typed sha')
  assert.notEqual(r.headSha, 'deadbeef')

  // A fix round in the SAME clone: uncommitted second edit; capture is against
  // the PROVISIONING BASE, so the round-2 patch is CUMULATIVE.
  fs.writeFileSync(path.join(c3, 'fix.txt'), 'round 2\n')
  const r2 = await wrapped('p', { label: 'fix:T3:1', isolation: 'worktree' })
  const p2 = fs.readFileSync(r2.patch, 'utf8')
  assert.ok(p2.includes('+T3 was here') && p2.includes('+round 2'),
    'a fix-round capture against BASE carries round 1 AND round 2 — cumulative, what the kernel folds')

  // Non-isolated roles pass through untouched; a null reply stays null.
  const rev = await wrapped('p', { label: 'review:T3:1' })
  assert.equal(rev.typed, true); assert.ok(!('patch' in rev), 'no capture for non-worktree roles')
  assert.equal(await wrapped('p', { label: 'impl:OTHER', isolation: 'worktree' }), null,
    'a null reply is returned as-is (AGENT_NULL path intact)')

  // Capture failure = honest loss of ALL THREE coordinates: schema-required
  // model-typed branch/headSha must not survive (they would pass
  // hasCoordinates and hand the merge fabricated coordinates — worst case a
  // model-echoed BASE sha folds the task as a no-op and its work silently
  // vanishes on a green run).
  const broken = withPatchCapture({
    agent: async () => ({ status: 'DONE', branch: 'wt-T9', headSha: 'deadbeef', patch: '/lie' }),
    clonesDir: path.join(tmp, 'no-such-clones'), base: BASE, patchesDir })
  const rb = await broken('p', { label: 'impl:T9', isolation: 'worktree' })
  assert.ok(!('patch' in rb), 'no patch on capture failure — the model-typed one is gone too')
  assert.equal(rb.branch, '', 'model-typed branch cleared on capture failure')
  assert.equal(rb.headSha, '', 'model-typed headSha cleared — the reply must fail hasCoordinates')
  assert.ok(rb.captureError, 'the failure is named on the reply')

  // A worktree dispatch whose label carries no task id still has its
  // model-typed patch stripped — the strip precedes every return.
  const rw = await broken('p', { label: 'weird', isolation: 'worktree' })
  assert.ok(!('patch' in rw), 'unrecognized worktree label: model-typed patch stripped, not passed through')
  assert.ok(rw.captureError, 'and the mapping failure is named')
}

// ── 6. makeEventLog: the run’s record, written while it happens (#414 P1) ────
{
  const file = path.join(tmp, 'run', 'events.jsonl')
  const ev = makeEventLog({ file, runId: 'run-24', base: BASE })
  ev.onEvent({ kind: 'worker:start', label: 'impl:T1', role: 'implementer' })
  ev.log('wave 1 merge MERGED')
  ev.phase('Wave 1')
  ev.onEvent({ kind: 'worker:end', label: 'impl:T1', exitCode: 0 })
  const rows = fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  assert.equal(rows.length, 5)
  assert.deepEqual(rows.map((r) => r.kind),
    ['run:open', 'worker:start', 'engine:log', 'engine:phase', 'worker:end'])
  // Lineage opens the log; every row is id'd and clocked; ids sort by time.
  assert.equal(rows[0].runId, 'run-24'); assert.equal(rows[0].base, BASE)
  for (const r of rows) { assert.equal(r.id.length, 26); assert.ok(r.ts > 0) }
  assert.deepEqual(rows.map((r) => r.id), [...rows.map((r) => r.id)].sort(),
    'ULID ids sort in append order')
  // Append-only: a second maker on the same file appends, never truncates.
  makeEventLog({ file, runId: 'run-24', base: BASE }).log('after reopen')
  const again = fs.readFileSync(file, 'utf8').trim().split('\n')
  assert.equal(again.length, 7, 'reopening appends (a new run:open + the line); nothing is overwritten')
  assert.ok(ulid() !== ulid(), 'ids never collide')
  // Monotonic against a BACKWARDS clock step (NTP on a fresh sandbox): an id
  // minted at an earlier `now` still sorts after everything already minted.
  const before = ulid(Date.now() + 5000)
  const after = ulid(Date.now() - 60000)
  assert.ok(after > before, 'a backwards clock step cannot mint an id that sorts earlier')
}

// ── 7. Task 1 (#714): the capture drops untracked binaries no task named ─────
//
// Claim: the patch the driver captures for a task carries no path outside the
// task's Files block that is untracked at BASE and binary. The run-7 shape this
// makes inexpressible: four implementers each ran `python3 -m pytest` in its
// clone, and `app/__pycache__/registry.cpython-312.pyc` — untracked at BASE,
// named by no task — rode into every one of the four patches.
//
// M1. untracked at the task's base sha + binary as `git diff --numstat` reports
//     it (`-` for both counts) + absent from the task's FILES list ⇒ not in the
//     `.patch` the capture writes, for every worktree label (`impl:`, `exam:`,
//     `fix:`).
// M2. a binary path FILES names, and every text path named or not, IS in the
//     patch with the content it had in the clone.
// M3. one `{ kind: 'capture:dropped', label, paths }` per capture that drops,
//     `paths` listing every dropped path; none when nothing is dropped.
// M4. four clones at one base, one shared untracked `.pyc` named by no task ⇒
//     four patches, no two naming a binary path in common.
{
  // The fixture repo for these legs: `app/registry.py` tracked at BASE2 and
  // nothing else, so every artifact below is untracked-at-base by construction.
  // Its own repo, so §2–§6 keep the tree and the assertions they already have.
  // No `.gitignore` anywhere — an operator's ignore file is the workaround this
  // task replaces, so the exam's fixture must not be carrying one.
  const R2 = path.join(tmp, 'repo2')
  fs.mkdirSync(R2, { recursive: true })
  git(['init', '-q', '-b', 'main'], R2)
  git(['config', 'user.email', 'sim@example.com'], R2)
  git(['config', 'user.name', 'sim'], R2)
  fs.mkdirSync(path.join(R2, 'app'), { recursive: true })
  fs.writeFileSync(path.join(R2, 'app', 'registry.py'), 'registry = {}\n')
  git(['add', '-A'], R2); git(['commit', '-qm', 'base'], R2)
  const BASE2 = git(['rev-parse', 'HEAD'], R2).trim()
  assert.equal(git(['ls-files'], R2).trim(), 'app/registry.py', 'one tracked path at BASE2')

  // Every blob below carries a NUL, so git calls it binary — the definition M1
  // uses (`-` for both counts under --numstat), not a filename heuristic.
  const PYC = Buffer.from([0x03, 0xf3, 0x0d, 0x0a, 0, 0, 0, 0, 0x5a, 0x1f, 0x8b, 0x00, 0x7f])
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49])
  const BLOB = Buffer.from([0, 1, 2, 3, 4, 0xff, 0])
  const TWO = Buffer.from([0xff, 0, 0xff, 0, 0x01])
  const write = (dir, rel, content) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
    fs.writeFileSync(path.join(dir, rel), content)
  }

  // What a patch NAMES, read the way leg (d) asks for it: `git apply --numstat`
  // parses the patch and reports `-`/`-` for a binary hunk. Reading the header
  // lines by hand would let a truncated patch pass as an empty one.
  const numstat = (patchFile) => git(['apply', '--numstat', path.resolve(patchFile)], R2)
    .split('\n').filter(Boolean)
    .map((l) => { const c = l.split('\t'); return { added: c[0], deleted: c[1], path: c.slice(2).join('\t') } })
  const pathsIn = (f) => numstat(f).map((r) => r.path).sort()
  const binaryPathsIn = (f) => numstat(f).filter((r) => r.added === '-' && r.deleted === '-')
    .map((r) => r.path).sort()

  // The task's FILES list reaches the capture BY LABEL: the wrapper is built
  // once in run-main.mjs before the engine runs (composeAgent), so the per-task
  // array — the same `task.files` run-engine's `filesLine` hands the
  // implementer — has to arrive as a lookup, never as a second parse of the
  // plan. These legs grade the DROP, not the name of the plumbing, so the exam
  // hands the same lookup in under each shape the Context allows and any one of
  // them satisfying is a pass.
  const captureFor = ({ clonesDir, patchesDir, filesById, agent, onEvent = () => {} }) => {
    const lookup = (label) => filesById[defaultTaskIdOf(label) || ''] || []
    return withPatchCapture({
      agent, clonesDir, base: BASE2, patchesDir, onEvent,
      filesOf: lookup, filesFor: lookup, taskFilesOf: lookup,
    })
  }
  const dispatch = (label, filesById) => ({
    label, isolation: 'worktree', files: filesById[defaultTaskIdOf(label) || ''] || [],
  })
  const ok = async () => ({ status: 'DONE', branch: 'wt', headSha: 'deadbeef', patch: '/lie' })

  // (a) [M1] one clone, three writes: a text edit to a FILES path, an untracked
  // `__pycache__/*.pyc` outside FILES, an untracked text file outside FILES.
  {
    const clonesDir = path.join(tmp, 'drop-a', 'clones')
    const patchesDir = path.join(tmp, 'drop-a', 'patches')
    const filesById = { T1: ['app/registry.py'] }
    const PYC_PATH = 'app/__pycache__/registry.cpython-312.pyc'
    const seed = (dir) => {
      write(dir, 'app/registry.py', 'registry = {"one": 1}\n')
      write(dir, PYC_PATH, PYC)
      write(dir, 'notes.txt', 'a stray text file no task named\n')
    }
    // Two clones of one task, seeded identically: `exam:T1` captures from
    // `exam-T1` and `impl:`/`fix:` from `task-T1` (defaultCloneNameOf), so the
    // three labels see the same tree.
    const taskClone = cloneAtBase({ repo: R2, dest: path.join(clonesDir, 'task-T1'), base: BASE2 })
    const examClone = cloneAtBase({ repo: R2, dest: path.join(clonesDir, 'exam-T1'), base: BASE2 })
    seed(taskClone); seed(examClone)

    // The difference this task makes, stated as a before/after on ONE tree: the
    // pre-task whole-tree capture (the §4 leg, `patchAgainstBase` with no task
    // list to consult) names the .pyc, and must keep naming it — it is the
    // unfiltered primitive the wrapper composes.
    const whole = patchAgainstBase({ cwd: taskClone, base: BASE2,
      out: path.join(patchesDir, 'whole-tree.patch') })
    assert.deepEqual(pathsIn(whole), ['app/__pycache__/registry.cpython-312.pyc', 'app/registry.py', 'notes.txt'],
      '(a) the pre-task whole-tree capture names the .pyc — that is what run-7 folded')
    assert.deepEqual(binaryPathsIn(whole), [PYC_PATH], '(a) and git calls it binary: - / - under --numstat')

    const wrapped = captureFor({ clonesDir, patchesDir, filesById, agent: ok })
    const r = await wrapped('p', dispatch('impl:T1', filesById))
    assert.equal(r.patch, path.join(patchesDir, 'task-T1.patch'), '(a) the capture is still the driver’s path')
    assert.deepEqual(pathsIn(r.patch), ['app/registry.py', 'notes.txt'],
      '(a) [M1] the captured patch names the FILES text edit and the stray TEXT file, and not the .pyc')
    assert.ok(!fs.readFileSync(r.patch, 'utf8').includes('__pycache__'),
      '(a) [M1] the dropped path is absent from the patch bytes, header line included')
    // All three worktree labels alike — the exam and the fix rounds capture
    // from the same shape and drop the same path.
    for (const label of ['exam:T1', 'fix:T1:0']) {
      const rl = await wrapped('p', dispatch(label, filesById))
      assert.deepEqual(pathsIn(rl.patch), ['app/registry.py', 'notes.txt'],
        '(a) [M1] label ' + label + ' drops the untracked .pyc too — impl:, exam:, fix: alike')
      assert.ok(!fs.readFileSync(rl.patch, 'utf8').includes('__pycache__'),
        '(a) [M1] ' + label + ': the .pyc is absent from the patch bytes')
    }
    // The clone still holds what the worker wrote: the capture filters the
    // PATCH, it does not delete the worker's files.
    assert.ok(fs.existsSync(path.join(taskClone, PYC_PATH)), '(a) the drop is capture-side, not a deletion in the clone')
  }

  // (b) [M2] a FILES list that NAMES a binary: it rides, byte-for-byte; the
  // unnamed binary beside it does not.
  {
    const clonesDir = path.join(tmp, 'drop-b', 'clones')
    const patchesDir = path.join(tmp, 'drop-b', 'patches')
    const filesById = { T2: ['app/registry.py', 'assets/logo.png'] }
    const c = cloneAtBase({ repo: R2, dest: path.join(clonesDir, 'task-T2'), base: BASE2 })
    write(c, 'app/registry.py', 'registry = {"two": 2}\n')
    write(c, 'assets/logo.png', PNG)
    write(c, 'build/blob.bin', BLOB)

    const wrapped = captureFor({ clonesDir, patchesDir, filesById, agent: ok })
    const r = await wrapped('p', dispatch('impl:T2', filesById))
    assert.deepEqual(pathsIn(r.patch), ['app/registry.py', 'assets/logo.png'],
      '(b) [M2] exactly the named binary and the text edit — build/blob.bin is not named')
    assert.deepEqual(binaryPathsIn(r.patch), ['assets/logo.png'],
      '(b) [M2] the named binary rides as a binary hunk')
    assert.ok(!fs.readFileSync(r.patch, 'utf8').includes('build/blob.bin'),
      '(b) [M1] the unnamed binary is absent from the patch bytes')

    // Byte-for-byte: apply the captured patch to a fresh tree at BASE2 and
    // compare against the clone. A header that names the path proves nothing
    // about the bytes underneath it.
    const verify = cloneAtBase({ repo: R2, dest: path.join(tmp, 'drop-b', 'verify'), base: BASE2 })
    git(['apply', '--binary', path.resolve(r.patch)], verify)
    assert.equal(Buffer.compare(fs.readFileSync(path.join(verify, 'assets/logo.png')),
      fs.readFileSync(path.join(c, 'assets/logo.png'))), 0,
      '(b) [M2] the named binary arrives with the same content it had in the clone')
    assert.equal(Buffer.compare(fs.readFileSync(path.join(verify, 'assets/logo.png')), PNG), 0)
    assert.equal(fs.readFileSync(path.join(verify, 'app/registry.py'), 'utf8'), 'registry = {"two": 2}\n',
      '(b) [M2] and the text edit is the clone’s text')
    assert.ok(!fs.existsSync(path.join(verify, 'build/blob.bin')),
      '(b) [M1] applying the patch cannot produce the unnamed binary')
  }

  // (c) [M3] the event: ONE `capture:dropped` per capture that drops, listing
  // every dropped path — a per-path event fails the count, a one-path list
  // fails the equality — and none at all when nothing is dropped.
  {
    const clonesDir = path.join(tmp, 'drop-c', 'clones')
    const patchesDir = path.join(tmp, 'drop-c', 'patches')
    const filesById = { T1: ['app/registry.py'], T2: ['app/registry.py', 'assets/logo.png'] }
    const c1c = cloneAtBase({ repo: R2, dest: path.join(clonesDir, 'task-T1'), base: BASE2 })
    write(c1c, 'app/registry.py', 'registry = {"one": 1}\n')
    write(c1c, 'build/blob.bin', BLOB)
    write(c1c, 'out/two.bin', TWO)

    const events = []
    const wrapped = captureFor({ clonesDir, patchesDir, filesById, agent: ok,
      onEvent: (e) => events.push(e) })
    const r = await wrapped('p', dispatch('impl:T1', filesById))
    const dropped = events.filter((e) => e.kind === 'capture:dropped')
    assert.equal(dropped.length, 1,
      '(c) [M3] one event for the capture, not one per dropped path: ' + JSON.stringify(events))
    assert.equal(dropped[0].label, 'impl:T1', '(c) [M3] the event names the label it dropped for')
    assert.deepEqual([...dropped[0].paths].sort(), ['build/blob.bin', 'out/two.bin'],
      '(c) [M3] `paths` lists EVERY dropped path')
    assert.equal(events.filter((e) => e.kind === 'capture:error').length, 0,
      '(c) a drop is not a capture failure — capture:error stays what it was')
    assert.ok(!('captureError' in r), '(c) the reply carries no captureError for a drop')
    assert.deepEqual(pathsIn(r.patch), ['app/registry.py'], '(c) and the patch is the FILES text edit alone')

    // Nothing dropped ⇒ no event. A clone holding only FILES paths (one of them
    // binary) and text.
    const c2c = cloneAtBase({ repo: R2, dest: path.join(clonesDir, 'task-T2'), base: BASE2 })
    write(c2c, 'app/registry.py', 'registry = {"two": 2}\n')
    write(c2c, 'assets/logo.png', PNG)
    write(c2c, 'notes.txt', 'text, unnamed, kept\n')
    events.length = 0
    const r2 = await wrapped('p', dispatch('impl:T2', filesById))
    assert.deepEqual(events.filter((e) => e.kind === 'capture:dropped'), [],
      '(c) [M3] nothing dropped ⇒ no capture:dropped event at all')
    assert.deepEqual(pathsIn(r2.patch), ['app/registry.py', 'assets/logo.png', 'notes.txt'],
      '(c) [M2] and every one of those paths is in the patch')
  }

  // (d) [M4] the run-7 shape: four clones at one base, one shared untracked
  // `.pyc` named by no task. The defect was four patches naming the same binary.
  {
    const clonesDir = path.join(tmp, 'drop-d', 'clones')
    const patchesDir = path.join(tmp, 'drop-d', 'patches')
    const ids = ['D1', 'D2', 'D3', 'D4']
    const PYC_PATH = 'app/__pycache__/registry.cpython-312.pyc'
    const filesById = {}
    for (const id of ids) filesById[id] = ['app/registry.py']
    for (const id of ids) {
      const dir = cloneAtBase({ repo: R2, dest: path.join(clonesDir, 'task-' + id), base: BASE2 })
      write(dir, 'app/registry.py', 'registry = {}\nregistry["' + id + '"] = 1\n')
      write(dir, PYC_PATH, PYC)  // byte-identical in all four, as pytest wrote it
    }
    const wrapped = captureFor({ clonesDir, patchesDir, filesById, agent: ok })
    const patches = []
    for (const id of ids) patches.push((await wrapped('p', dispatch('impl:' + id, filesById))).patch)
    assert.equal(patches.length, 4)
    for (let i = 0; i < patches.length; i++) {
      assert.ok(pathsIn(patches[i]).includes('app/registry.py'),
        '(d) [M4] ' + ids[i] + ' still carries its own edit to the shared file')
      assert.deepEqual(pathsIn(patches[i]).filter((p) => /\.pyc$|__pycache__/.test(p)), [],
        '(d) [M4] ' + ids[i] + ' names no .pyc')
      assert.deepEqual(binaryPathsIn(patches[i]), [],
        '(d) [M4] ' + ids[i] + ' names no binary path at all — none was in its FILES')
    }
    for (let i = 0; i < patches.length; i++) {
      for (let j = i + 1; j < patches.length; j++) {
        const bi = binaryPathsIn(patches[i]), bj = binaryPathsIn(patches[j])
        assert.deepEqual(bi.filter((p) => bj.includes(p)), [],
          '(d) [M4] ' + ids[i] + ' and ' + ids[j] + ' name no binary path in common')
      }
    }
  }
}

fs.rmSync(tmp, { recursive: true, force: true })
console.log('ALL TESTS PASSED')
