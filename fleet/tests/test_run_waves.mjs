// fleet/tests/test_run_waves.mjs — #401 step 2.
//
// Two things are under test and they are different in kind:
//
//   the loader        that waves.js runs on the driver's six globals, and that
//                     `budget` stays undefined (the deleted cap, #400)
//   clones at BASE    the #314 cure — on REAL git, because the defect was about
//                     what git actually did, and a mocked git cannot be wrong
//                     in the way the runtime was
//
// The loop-level proof lives in tests/sim_{workflow,base_ancestry,derived_heads}
// .mjs, which now run through this same loader.

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { runWaves, loadWavesSource, defaultWavesPath, defaultParallel, cloneAtBase, makeCwdFor, defaultTaskIdOf, patchAgainstBase, withPatchCapture, makeEventLog, ulid } from '../run-waves.mjs'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'runwaves-'))
const git = (argv, cwd) => execFileSync('git', argv, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

// ── 1. the loader ────────────────────────────────────────────────────────────
{
  const src = loadWavesSource(defaultWavesPath())
  assert.ok(src.includes('const meta'), 'the export is stripped so the body can run as a function body')
  assert.ok(!src.includes('export const meta'))
  assert.ok(src.includes('agent('), 'the real waves.js was loaded, not a stub')
}

// The six globals, observed from inside the program. waves.js refuses to launch
// without args.waves, so the smallest honest probe is a source of our own that
// simply reports what it was handed.
{
  const probe = 'return { agentIs: typeof agent, parallelIs: typeof parallel, ' +
    'phaseIs: typeof phase, logIs: typeof log, budgetIs: typeof budget, waves: args.waves }'
  const seen = await runWaves({ agent: () => {}, args: { waves: [['A']] }, source: probe })
  assert.deepEqual(seen, {
    agentIs: 'function', parallelIs: 'function', phaseIs: 'function',
    logIs: 'function',
    // NOT an object. The per-run token cap is deleted (#400, Amendment 4), and
    // waves.js:1839 reads `typeof budget === 'undefined'` as "not exhausted" —
    // so every budget checkpoint is a no-op with no edit to waves.js. Handing
    // it a live-looking budget object here (as two of the three sims used to)
    // would quietly re-arm a subsystem the design deleted.
    budgetIs: 'undefined',
    waves: [['A']],
  })
}

// parallel runs the thunks it is handed, concurrently. The measured width bound
// of 8 (#398) belongs to the driver's scheduler, not here — this is the
// Workflow runtime's `parallel`, and nothing more.
{
  let live = 0, peak = 0
  const thunk = () => async () => {
    live++; peak = Math.max(peak, live)
    await new Promise((r) => setTimeout(r, 20))
    live--
    return 'x'
  }
  const out = await defaultParallel([thunk(), thunk(), thunk()])
  assert.deepEqual(out, ['x', 'x', 'x'])
  assert.equal(peak, 3, 'parallel must not serialize')
}

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

  // Capture failure = honest loss: no patch, a named captureError — the
  // engine's lost-coordinates guard does the rest.
  const broken = withPatchCapture({ agent: async () => ({ status: 'DONE', patch: '/lie' }),
    clonesDir: path.join(tmp, 'no-such-clones'), base: BASE, patchesDir })
  const rb = await broken('p', { label: 'impl:T9', isolation: 'worktree' })
  assert.ok(!('patch' in rb), 'no patch on capture failure — the model-typed one is gone too')
  assert.ok(rb.captureError, 'the failure is named on the reply')
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
}

fs.rmSync(tmp, { recursive: true, force: true })
console.log('ALL TESTS PASSED')
