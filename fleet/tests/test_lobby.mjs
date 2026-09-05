/**
 * fleet/tests/test_lobby.mjs — the lobby's shared half: three branches on the
 * target, the plan's capacity, stdin, and none of the six deleted readers.
 *
 * One block per Proof leg; every assertion names its leg and the Machine clause
 * it comes from.
 *
 *   (a1) (a2) (a3) [M1] the three branch names and `runOfBranch`;
 *   (b)        [M2] `highestRunOnTarget` over canned `ls-remote` listings;
 *   (c)        [M3] `readPlanCapacity` and `parseMemoryGb`;
 *   (d)        [M4] `input` through the seam, and to a real child's stdin;
 *   (e)        [M5] the defaults, the two config keys, the six deleted names,
 *                   and `makeTargetRepo`.
 *
 * Then the legs of **Task 5, "The lobby reads tags"** — a run's durable record
 * is two tags, `ultra/plan/run-N` and `ultra/evidence/run-N`, and the launcher
 * reads N over the tags as well as the transient branches. Its legs (a)–(f)
 * carry its own clauses [M1]–[M4] and are written `task-5 (x) [Mn]` so a reader
 * never confuses them with the blocks above:
 *
 *   task-5 (a) [M1] `planTagFor` and `evidenceTagFor` spell the two tags;
 *   task-5 (b) [M2] `runOfBranch` reads the two tag shapes, bare and `refs/tags/`;
 *   task-5 (c) [M2] and still reads the three branch shapes;
 *   task-5 (d) [M2] and answers null for what carries no run — including a
 *                   peeled `^{}` line and the integration tag that does not exist;
 *   task-5 (e) [M3] `highestRunOnTarget` over one two-pattern `ls-remote`;
 *   task-5 (f) [M4] the three branch names are unchanged.
 *
 * Both modules are imported as namespaces because (e) reads their export
 * *names*: a name the module no longer provides must be absent, not a link
 * error. Nothing here opens a socket — `ssh` and `git ls-remote` reach a
 * recording seam that answers canned text, and the only real children are
 * `cat` (M4) and the local `git` that builds `makeTargetRepo`'s repository.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import * as L from '../lobby.mjs'
import * as H from './_lobby_helpers.mjs'

/** A seam that runs nothing: it records `(cmd, argv, options)` and answers. */
const recorder = (reply = () => ({ code: 0, stdout: '', stderr: '' })) => {
  const calls = []
  const exec = async (cmd, argv = [], options = undefined) => {
    calls.push({ cmd, argv: [...argv], options })
    return reply(cmd, argv, options)
  }
  exec.calls = calls
  return exec
}

/** `<sha>\t<ref>` per line — what `git ls-remote` prints. */
const lsRemote = (refs) =>
  refs.map((ref, i) => `${(i + 1).toString(16).padStart(40, '0')}\t${ref}`).join('\n') + '\n'

/** Fail loudly instead of hanging when a promise never settles. */
const settles = async (promise, what, ms = 20000) => {
  let timer
  const guard = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} did not settle within ${ms}ms`)), ms)
  })
  try {
    return await Promise.race([promise, guard])
  } finally {
    clearTimeout(timer)
  }
}

/** The error `body` threw, or null. */
const thrown = async (body) => {
  try {
    await body()
  } catch (error) {
    return error
  }
  return null
}

// ── (a1) [M1] the plan branch ───────────────────────────────────────────────
{
  assert.equal(typeof L.planBranchFor, 'function', '(a1) [M1] lobby.mjs exports planBranchFor')
  assert.equal(typeof L.runOfBranch, 'function', '(a1) [M1] lobby.mjs exports runOfBranch')

  assert.equal(L.planBranchFor(7), 'ultra/plan-run-7', '(a1) [M1] planBranchFor(7) is exactly ultra/plan-run-7')
  assert.equal(L.planBranchFor('7'), 'ultra/plan-run-7', '(a1) [M1] a run may be spelled as a string')
  assert.equal(L.runOfBranch('ultra/plan-run-7'), 7, '(a1) [M1] runOfBranch of the plan branch is 7')
}

// ── (a2) [M1] the integration branch ────────────────────────────────────────
{
  assert.equal(typeof L.integrationBranchFor, 'function', '(a2) [M1] lobby.mjs exports integrationBranchFor')

  assert.equal(
    L.integrationBranchFor(7), 'ultra/integration-run-7',
    '(a2) [M1] integrationBranchFor(7) is exactly ultra/integration-run-7'
  )
  assert.equal(L.runOfBranch('ultra/integration-run-7'), 7, '(a2) [M1] runOfBranch of the integration branch is 7')
}

// ── (a3) [M1] the evidence branch, and what carries no run ──────────────────
{
  assert.equal(typeof L.evidenceBranchFor, 'function', '(a3) [M1] lobby.mjs exports evidenceBranchFor')

  assert.equal(
    L.evidenceBranchFor(7), 'ultra/evidence-run-7',
    '(a3) [M1] evidenceBranchFor(7) is exactly ultra/evidence-run-7'
  )
  assert.equal(L.runOfBranch('ultra/evidence-run-7'), 7, '(a3) [M1] runOfBranch of the evidence branch is 7')
  assert.equal(L.runOfBranch('main'), null, '(a3) [M1] main carries no run — null, not a number')
  assert.equal(
    L.runOfBranch('ultra/plan-run-x'), null,
    '(a3) [M1] a non-numeric tail carries no run — null, not a number'
  )
}

// ── (b) [M2] the highest run on the target, over one ls-remote ──────────────
{
  assert.equal(typeof L.highestRunOnTarget, 'function', '(b) [M2] lobby.mjs exports highestRunOnTarget')

  const listings = [
    {
      refs: [
        'refs/heads/ultra/integration-run-3',
        'refs/heads/ultra/evidence-run-71',
        'refs/heads/ultra/plan-run-9'
      ],
      highest: 71
    },
    {
      refs: ['refs/heads/ultra/evidence-run-7', 'refs/heads/ultra/plan-run-42'],
      highest: 42
    },
    {
      refs: ['refs/heads/ultra/plan-run-2', 'refs/heads/ultra/integration-run-5'],
      highest: 5
    },
    { refs: ['refs/heads/main'], highest: 0 }
  ]

  for (const { refs, highest } of listings) {
    const exec = recorder(() => ({ code: 0, stdout: lsRemote(refs), stderr: '' }))
    const answered = await L.highestRunOnTarget(exec, '/tmp/target-clone')
    assert.equal(
      answered, highest,
      `(b) [M2] the highest N over ${refs.join(', ')} is ${highest}`
    )
  }

  const exec = recorder(() => ({ code: 0, stdout: lsRemote(['refs/heads/ultra/plan-run-9']), stderr: '' }))
  await L.highestRunOnTarget(exec, '/tmp/target-clone')
  assert.equal(exec.calls.length, 1, '(b) [M2] exactly one command reaches the seam')
  assert.equal(exec.calls[0].cmd, 'git', '(b) [M2] and it is git')
  assert.deepEqual(
    exec.calls[0].argv,
    ['-C', '/tmp/target-clone', 'ls-remote', 'origin', 'refs/heads/ultra/*', 'refs/tags/ultra/*'],
    '(b) [M2] git -C <dir> ls-remote origin refs/heads/ultra/* refs/tags/ultra/*'
  )

  const failing = recorder(() => ({
    code: 128,
    stdout: '',
    stderr: "fatal: 'origin' does not appear to be a git repository\n"
  }))
  const error = await thrown(() => L.highestRunOnTarget(failing, '/tmp/target-clone'))
  assert.ok(error instanceof L.Refusal, '(b) [M2] a non-zero ls-remote is a Refusal')
  assert.equal(error.exitCode, 2, '(b) [M2] which exits 2')
  assert.match(
    error.message, /does not appear to be a git repository/,
    "(b) [M2] carrying git's own output"
  )
}

// ── (c) [M3] the plan's capacity, and the memory it is spelled with ─────────
{
  assert.equal(typeof L.readPlanCapacity, 'function', '(c) [M3] lobby.mjs exports readPlanCapacity')
  assert.equal(typeof L.parseMemoryGb, 'function', '(c) [M3] lobby.mjs exports parseMemoryGb')

  // The measured 2026-09-04 shape: one flat object, four keys read, the rest ignored.
  const billing = {
    plan: 'Individual',
    tier: 'XLarge',
    max_cpus: 16,
    max_memory_gb: 64,
    max_disk_gb: 500,
    max_vms: 20,
    credits_remaining: 812.5,
    email: 'someone@example.invalid'
  }
  const exec = recorder(() => ({ code: 0, stdout: JSON.stringify(billing), stderr: '' }))
  const capacity = await L.readPlanCapacity(exec)
  assert.deepEqual(
    capacity, { maxCpus: 16, maxMemoryGb: 64, tier: 'XLarge', plan: 'Individual' },
    '(c) [M3] four fields, numbers as numbers and strings as strings, nothing else'
  )
  assert.equal(exec.calls.length, 1, '(c) [M3] exactly one command reaches the seam')
  assert.equal(exec.calls[0].cmd, 'ssh', '(c) [M3] and it is ssh')
  assert.deepEqual(
    exec.calls[0].argv, ['exe.dev', 'billing plan --json'],
    '(c) [M3] one lobby verb: billing plan --json, as one argv element'
  )

  const empty = recorder(() => ({ code: 0, stdout: '{}', stderr: '' }))
  const error = await thrown(() => L.readPlanCapacity(empty))
  assert.ok(error instanceof L.LobbyError, '(c) [M3] a payload with no numeric max_cpus is a LobbyError')
  assert.equal(error.exitCode, 1, '(c) [M3] which exits 1')

  assert.equal(L.parseMemoryGb('16GB'), 16, '(c) [M3] 16GB is 16')
  assert.equal(L.parseMemoryGb('16G'), 16, '(c) [M3] 16G is 16')
  assert.equal(L.parseMemoryGb('16'), null, '(c) [M3] a bare 16 carries no unit — null')
  assert.equal(L.parseMemoryGb('1.5GB'), null, '(c) [M3] a fractional 1.5GB is null')
}

// ── (d) [M4] stdin: through the seam, and into a real child ─────────────────
{
  const remote = 'new fleet-r7-2609032215-a1b2 --json'

  const exec = recorder(() => ({ code: 0, stdout: '{}', stderr: '' }))
  await L.lobby(exec, remote, { input: 'X' })
  assert.equal(exec.calls.length, 1, '(d) [M4] one lobby verb, one call')
  assert.equal(exec.calls[0].cmd, 'ssh', '(d) [M4] issued as ssh')
  assert.deepEqual(exec.calls[0].argv, ['exe.dev', remote], '(d) [M4] the remote half as one argv element')
  assert.equal(
    exec.calls[0].options?.input, 'X',
    "(d) [M4] input reaches exec as its third argument's input"
  )

  const plain = recorder(() => ({ code: 0, stdout: '{}', stderr: '' }))
  await L.lobby(plain, 'ls \'fleet-r*\' --json')
  assert.equal(
    plain.calls[0].options?.input, undefined,
    '(d) [M4] options are optional — a verb with no input carries none'
  )

  const res = await settles(
    L.defaultExec('cat', [], { input: 'hello' }),
    "(d) [M4] defaultExec must end the child's stdin"
  )
  assert.equal(res.code, 0, '(d) [M4] cat exits 0 — its stdin was closed')
  assert.equal(res.stdout, 'hello', '(d) [M4] and it answered the input back')
}

// ── (e) [M5] the two config keys, the six deleted names, makeTargetRepo ─────
{
  assert.deepEqual(
    { ...L.FLEET_DEFAULTS }, { cpu: '8', memory: '16GB' },
    '(e) [M5] FLEET_DEFAULTS is exactly cpu and memory'
  )

  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'fleet-exam-lobby-'))
  try {
    const configPath = path.join(dir, 'fleet.json')
    fs.writeFileSync(configPath, '{"cpu":"4","memory":"8GB","golden":"x"}')
    assert.deepEqual(
      await L.loadFleetConfig({ path: configPath }), { cpu: '4', memory: '8GB' },
      '(e) [M5] only cpu and memory are read — an unknown key is ignored'
    )
    assert.deepEqual(
      await L.loadFleetConfig({ path: path.join(dir, 'absent.json') }), { cpu: '8', memory: '16GB' },
      '(e) [M5] a missing file means the defaults'
    )

    const deleted = [
      'FLEET_RUNS_REPO', 'FLEET_RUNS_URL', 'ensureFleetRuns',
      'highestPlanRun', 'readCommittedStatus', 'listCommittedStatuses'
    ]
    const exported = Object.keys(L)
    for (const name of deleted) {
      assert.ok(!exported.includes(name), `(e) [M5] lobby.mjs no longer exports ${name}`)
    }

    const helperNames = Object.keys(H)
    assert.ok(helperNames.includes('makeTargetRepo'), '(e) [M5] the helpers export makeTargetRepo')
    assert.ok(!helperNames.includes('makeFleetRuns'), '(e) [M5] and no longer makeFleetRuns')

    const repo = H.makeTargetRepo({ root: dir, files: { 'README.md': '# target\n', 'a.txt': 'x\n' } })
    assert.equal(typeof repo.base, 'string', '(e) [M5] makeTargetRepo answers the seed sha as base')
    assert.ok(fs.existsSync(repo.origin), '(e) [M5] with a real bare origin behind it')
    assert.equal(
      repo.git(['rev-parse', 'HEAD']), repo.base,
      "(e) [M5] the clone's HEAD is base"
    )
    const branches = repo.branches()
    assert.equal(
      Object.keys(branches).length, 1,
      '(e) [M5] the origin carries exactly one branch after the seed'
    )
    assert.equal(
      Object.values(branches)[0], repo.base,
      '(e) [M5] pointing at the seed commit'
    )
    assert.match(repo.git(['ls-files']), /a\.txt/, '(e) [M5] the files map is in the seed commit')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Task 5 — "The lobby reads tags": a run's record is `ultra/plan/run-N` and
// `ultra/evidence/run-N` on the target, and `highestRunOnTarget` must see the
// tags as well as the three transient branches or the next launch would reuse
// a number. Legs (a)–(f), clauses [M1]–[M4], of that task.
// ════════════════════════════════════════════════════════════════════════════

// ── task-5 (a) [M1] the two tag spellers ────────────────────────────────────
{
  assert.equal(typeof L.planTagFor, 'function', 'task-5 (a) [M1] lobby.mjs exports planTagFor')
  assert.equal(typeof L.evidenceTagFor, 'function', 'task-5 (a) [M1] lobby.mjs exports evidenceTagFor')

  assert.equal(
    L.planTagFor(7), 'ultra/plan/run-7',
    'task-5 (a) [M1] planTagFor(7) is exactly ultra/plan/run-7'
  )
  assert.equal(
    L.planTagFor('7'), 'ultra/plan/run-7',
    'task-5 (a) [M1] planTagFor of the string 7 is the same tag — a number and its string spell alike'
  )
  assert.equal(
    L.evidenceTagFor(7), 'ultra/evidence/run-7',
    'task-5 (a) [M1] evidenceTagFor(7) is exactly ultra/evidence/run-7'
  )
  assert.equal(
    L.evidenceTagFor('7'), 'ultra/evidence/run-7',
    'task-5 (a) [M1] evidenceTagFor of the string 7 is the same tag'
  )
}

// ── task-5 (b) [M2] runOfBranch reads the two tag shapes ────────────────────
{
  assert.equal(
    L.runOfBranch('ultra/plan/run-7'), 7,
    'task-5 (b) [M2] runOfBranch of the plan tag is 7'
  )
  assert.equal(
    L.runOfBranch('ultra/evidence/run-7'), 7,
    'task-5 (b) [M2] runOfBranch of the evidence tag is 7'
  )
  assert.equal(
    L.runOfBranch('refs/tags/ultra/plan/run-7'), 7,
    'task-5 (b) [M2] and of the plan tag under its refs/tags/ head'
  )
  assert.equal(
    L.runOfBranch('refs/tags/ultra/evidence/run-7'), 7,
    'task-5 (b) [M2] and of the evidence tag under its refs/tags/ head'
  )
}

// ── task-5 (c) [M2] and still reads the three branch shapes ─────────────────
{
  assert.equal(
    L.runOfBranch('ultra/plan-run-7'), 7,
    'task-5 (c) [M2] runOfBranch still answers 7 for the plan branch'
  )
  assert.equal(
    L.runOfBranch('ultra/integration-run-7'), 7,
    'task-5 (c) [M2] and for the integration branch'
  )
  assert.equal(
    L.runOfBranch('ultra/evidence-run-7'), 7,
    'task-5 (c) [M2] and for the evidence branch'
  )
  assert.equal(
    L.runOfBranch('refs/heads/ultra/evidence-run-7'), 7,
    'task-5 (c) [M2] and for the evidence branch under its refs/heads/ head'
  )
}

// ── task-5 (d) [M2] what carries no run — null, never a guessed number ──────
{
  assert.equal(
    L.runOfBranch('main'), null,
    'task-5 (d) [M2] main carries no run'
  )
  assert.equal(
    L.runOfBranch('ultra/plan-run-x'), null,
    'task-5 (d) [M2] a branch with a non-numeric tail carries no run'
  )
  assert.equal(
    L.runOfBranch('ultra/plan/run-x'), null,
    'task-5 (d) [M2] a tag with a non-numeric tail carries no run'
  )
  assert.equal(
    L.runOfBranch('ultra/integration/run-7'), null,
    'task-5 (d) [M2] there is no integration tag — that shape carries no run'
  )
  assert.equal(
    L.runOfBranch('refs/tags/ultra/plan/run-7^{}'), null,
    "task-5 (d) [M2] an annotated tag's peeled ^{} line carries no run"
  )
}

// ── task-5 (e) [M3] the highest run, over one two-pattern ls-remote ─────────
{
  assert.equal(
    typeof L.highestRunOnTarget, 'function',
    'task-5 (e) [M3] lobby.mjs exports highestRunOnTarget'
  )

  const exec = recorder(() => ({
    code: 0,
    stdout: lsRemote(['refs/tags/ultra/plan/run-18']),
    stderr: ''
  }))
  await L.highestRunOnTarget(exec, '/tmp/target-clone')
  assert.equal(exec.calls.length, 1, 'task-5 (e) [M3] exactly one call reaches the seam')
  assert.equal(exec.calls[0].cmd, 'git', 'task-5 (e) [M3] and it is git')
  assert.deepEqual(
    exec.calls[0].argv,
    ['-C', '/tmp/target-clone', 'ls-remote', 'origin', 'refs/heads/ultra/*', 'refs/tags/ultra/*'],
    'task-5 (e) [M3] git -C <dir> ls-remote origin refs/heads/ultra/* refs/tags/ultra/* — each pattern its own argv element'
  )

  const listings = [
    {
      refs: ['refs/tags/ultra/plan/run-18', 'refs/tags/ultra/evidence/run-18'],
      highest: 18,
      what: 'a listing of tags only answers their maximum'
    },
    {
      refs: ['refs/tags/ultra/evidence/run-18', 'refs/heads/ultra/plan-run-19'],
      highest: 19,
      what: 'a branch above the tags wins'
    },
    {
      refs: ['refs/heads/ultra/evidence-run-20', 'refs/tags/ultra/plan/run-3'],
      highest: 20,
      what: 'and the highest of either is the answer whichever comes first'
    }
  ]
  for (const { refs, highest, what } of listings) {
    const seam = recorder(() => ({ code: 0, stdout: lsRemote(refs), stderr: '' }))
    assert.equal(
      await L.highestRunOnTarget(seam, '/tmp/target-clone'), highest,
      `task-5 (e) [M3] ${what}: ${refs.join(', ')} is ${highest}`
    )
  }

  const nothing = recorder(() => ({ code: 0, stdout: '', stderr: '' }))
  assert.equal(
    await L.highestRunOnTarget(nothing, '/tmp/target-clone'), 0,
    'task-5 (e) [M3] an empty listing answers 0'
  )

  const failing = recorder(() => ({
    code: 128,
    stdout: '',
    stderr: "fatal: 'origin' does not appear to be a git repository\n"
  }))
  const error = await thrown(() => L.highestRunOnTarget(failing, '/tmp/target-clone'))
  assert.ok(
    error instanceof L.Refusal,
    'task-5 (e) [M3] a seam answering exit 128 is a Refusal, never a 0 the next launch would reuse'
  )
}

// ── task-5 (f) [M4] the three branch names answer what they answer at BASE ──
{
  assert.equal(
    L.planBranchFor(7), 'ultra/plan-run-7',
    'task-5 (f) [M4] planBranchFor(7) is exactly ultra/plan-run-7'
  )
  assert.equal(
    L.integrationBranchFor(7), 'ultra/integration-run-7',
    'task-5 (f) [M4] integrationBranchFor(7) is exactly ultra/integration-run-7'
  )
  assert.equal(
    L.evidenceBranchFor(7), 'ultra/evidence-run-7',
    'task-5 (f) [M4] evidenceBranchFor(7) is exactly ultra/evidence-run-7'
  )
}

console.log('ALL TESTS PASSED')
