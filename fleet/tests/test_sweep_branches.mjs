// fleet/tests/test_sweep_branches.mjs — #543 Task 5: the sweep verb's exam.
//
// The sweep is the only fleet verb that DELETES anything, so every leg here is
// about restraint: what it refuses to touch, and that a dry run touches nothing
// at all. Nothing in this file reaches the network — every `git`/`gh` call
// travels through the injected `exec` seam and is answered from a canned table,
// and the gate-read probe reads a real (empty) `fs.mkdtemp` directory, so the
// production `fs.existsSync` path is the one under test.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { shellQuote } from '../drive.mjs'
import { DEFAULTS } from '../drive-one.mjs'
import { parseArgs, sweepBranches, USAGE } from '../sweep-branches.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')

let passed = 0
const ok = (label) => {
  passed += 1
  console.log(`ok - ${label}`)
}

const REPO_DIR = '/tmp/sweep-fixture-repo'
const SHA = (n) => String(n).repeat(40).slice(0, 40)

/** A temp evidence dir holding a `gate-read-<runId>.json` for each named run. */
const evidenceWith = (runIds) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-evidence-'))
  for (const runId of runIds) fs.writeFileSync(path.join(dir, `gate-read-${runId}.json`), '{}\n')
  return dir
}

/**
 * An `exec` that answers from a [needle, result] table and records every
 * command string it was handed. An unmatched command is an explicit failure
 * (code 1) rather than a silent empty success — a sweep that runs a command
 * this fixture did not anticipate must not read as a clean result.
 */
const cannedExec = (table) => {
  const calls = []
  const exec = async (cmd) => {
    calls.push(cmd)
    for (const [needle, result] of table) {
      if (cmd.includes(needle)) return { code: 0, stdout: '', stderr: '', ...result }
    }
    return { code: 1, stdout: '', stderr: `no canned answer for: ${cmd}` }
  }
  exec.calls = calls
  return exec
}

const sink = () => {
  const lines = []
  const write = (line) => lines.push(String(line))
  write.lines = lines
  return write
}

const prJson = (state, number) => JSON.stringify([{ state, number }])

// The five-branch world legs (a), (b) and (f) share:
//   r1  MERGED + pinned + gate read   -> deletable
//   r2  CLOSED + pinned + gate read   -> deletable
//   r3  CLOSED + pinned + NO read     -> kept
//   r4  OPEN   + pinned + gate read   -> kept
//   r5  MERGED + UNPINNED + gate read -> kept
const FIVE_BRANCH_LS_REMOTE = [
  `${SHA(1)}\trefs/heads/ultra/integration-r1`,
  `${SHA(2)}\trefs/heads/ultra/integration-r2`,
  `${SHA(3)}\trefs/heads/ultra/integration-r3`,
  `${SHA(4)}\trefs/heads/ultra/integration-r4`,
  `${SHA(5)}\trefs/heads/ultra/integration-r5`,
  '',
].join('\n')

const fiveBranchTable = () => [
  ['ls-remote', { stdout: FIVE_BRANCH_LS_REMOTE }],
  ['--head ultra/integration-r1 ', { stdout: prJson('MERGED', 1) }],
  ['--head ultra/integration-r2 ', { stdout: prJson('CLOSED', 2) }],
  ['--head ultra/integration-r3 ', { stdout: prJson('CLOSED', 3) }],
  ['--head ultra/integration-r4 ', { stdout: prJson('OPEN', 4) }],
  ['--head ultra/integration-r5 ', { stdout: prJson('MERGED', 5) }],
  ['refs/fleet/r1', { stdout: `${SHA(1)}\n` }],
  ['refs/fleet/r2', { stdout: `${SHA(2)}\n` }],
  ['refs/fleet/r3', { stdout: `${SHA(3)}\n` }],
  ['refs/fleet/r4', { stdout: `${SHA(4)}\n` }],
  // r5's pin points somewhere else: the tip moved on after the run was pinned.
  ['refs/fleet/r5', { stdout: `${SHA(9)}\n` }],
  ['push origin --delete', { stdout: '' }],
]

const fiveBranchLines = (verb, evidenceDir) => [
  `${verb} ultra/integration-r1 [pr=MERGED#1 pinned=yes gate-read=yes]`,
  `${verb} ultra/integration-r2 [pr=CLOSED#2 pinned=yes gate-read=yes]`,
  `keep ultra/integration-r3 [pr=CLOSED#3 pinned=yes gate-read=no]: no gate read at ` +
    `${path.join(evidenceDir, 'gate-read-r3.json')}`,
  'keep ultra/integration-r4 [pr=OPEN#4 pinned=yes gate-read=yes]: PR #4 is OPEN',
  'keep ultra/integration-r5 [pr=MERGED#5 pinned=no gate-read=yes]: tip is not pinned at refs/fleet/r5',
  `swept 5 branches: 2 ${verb === 'delete' ? 'deleted' : 'would-delete'}, 3 kept`,
]

// --- (a) the dry run: no deletes issued, a reason for every kept branch -----

{
  const evidenceDir = evidenceWith(['r1', 'r2', 'r4', 'r5'])
  const exec = cannedExec(fiveBranchTable())
  const log = sink()
  const result = await sweepBranches(
    ['--repo-dir', REPO_DIR, '--evidence-dir', evidenceDir],
    { exec, log },
  )

  assert.deepEqual(
    exec.calls.filter((cmd) => cmd.includes('push origin --delete')),
    [],
    'a dry run must issue no `push origin --delete`',
  )
  assert.deepEqual(result.deleted, [])
  assert.deepEqual(result.wouldDelete, ['ultra/integration-r1', 'ultra/integration-r2'])
  assert.deepEqual(
    result.kept.map((entry) => [entry.branch, entry.reason]),
    [
      ['ultra/integration-r3', `no gate read at ${path.join(evidenceDir, 'gate-read-r3.json')}`],
      ['ultra/integration-r4', 'PR #4 is OPEN'],
      ['ultra/integration-r5', 'tip is not pinned at refs/fleet/r5'],
    ],
  )
  assert.deepEqual(log.lines, fiveBranchLines('would-delete', evidenceDir))

  fs.rmSync(evidenceDir, { recursive: true, force: true })
  ok('(a) a dry run issues zero deletes and prints a reason for each of the three kept branches')
}

// --- (b) --delete: exactly the two deletable branches, exactly that command --

{
  const evidenceDir = evidenceWith(['r1', 'r2', 'r4', 'r5'])
  const exec = cannedExec(fiveBranchTable())
  const log = sink()
  const result = await sweepBranches(
    ['--delete', '--repo-dir', REPO_DIR, '--evidence-dir', evidenceDir],
    { exec, log },
  )

  assert.deepEqual(
    exec.calls.filter((cmd) => cmd.includes('push origin --delete')),
    [
      `git -C ${shellQuote(REPO_DIR)} push origin --delete ultra/integration-r1`,
      `git -C ${shellQuote(REPO_DIR)} push origin --delete ultra/integration-r2`,
    ],
  )
  assert.deepEqual(result.deleted, ['ultra/integration-r1', 'ultra/integration-r2'])
  assert.deepEqual(result.wouldDelete, [])
  assert.deepEqual(
    result.kept.map((entry) => entry.branch),
    ['ultra/integration-r3', 'ultra/integration-r4', 'ultra/integration-r5'],
  )
  assert.deepEqual(log.lines, fiveBranchLines('delete', evidenceDir))

  fs.rmSync(evidenceDir, { recursive: true, force: true })
  ok('(b) --delete issues exactly two `git -C D push origin --delete <branch>` commands')
}

// --- (c) adopt/* carries no runId, so a MERGED PR does not make it deletable -

{
  const evidenceDir = evidenceWith([])
  const exec = cannedExec([
    ['ls-remote', { stdout: `${SHA(7)}\trefs/heads/adopt/x\n` }],
    ['--head adopt/x ', { stdout: prJson('MERGED', 9) }],
  ])
  const log = sink()
  const result = await sweepBranches(
    ['--delete', '--repo-dir', REPO_DIR, '--evidence-dir', evidenceDir],
    { exec, log },
  )

  assert.deepEqual(result.deleted, [])
  assert.deepEqual(
    result.kept.map((entry) => [entry.branch, entry.reason]),
    [['adopt/x', 'no runId — not a run branch']],
  )
  assert.deepEqual(log.lines, [
    'keep adopt/x [pr=MERGED#9 pinned=n/a gate-read=n/a]: no runId — not a run branch',
    'swept 1 branch: 0 deleted, 1 kept',
  ])
  // No pin is read and nothing is pushed for a branch with no runId.
  assert.deepEqual(exec.calls.filter((cmd) => cmd.includes('rev-parse')), [])
  assert.deepEqual(exec.calls.filter((cmd) => cmd.includes('push origin --delete')), [])

  fs.rmSync(evidenceDir, { recursive: true, force: true })
  ok('(c) `adopt/x` with a MERGED PR is kept with reason `no runId`')
}

// --- (d) no PR at all: kept, even pinned and with a gate read ---------------

{
  const evidenceDir = evidenceWith(['r6'])
  const exec = cannedExec([
    ['ls-remote', { stdout: `${SHA(6)}\trefs/heads/ultra/integration-r6\n` }],
    ['--head ultra/integration-r6 ', { stdout: '[]\n' }],
    ['refs/fleet/r6', { stdout: `${SHA(6)}\n` }],
  ])
  const log = sink()
  const result = await sweepBranches(
    ['--delete', '--repo-dir', REPO_DIR, '--evidence-dir', evidenceDir],
    { exec, log },
  )

  assert.deepEqual(result.deleted, [])
  assert.deepEqual(
    result.kept.map((entry) => [entry.branch, entry.reason]),
    [['ultra/integration-r6', 'no PR']],
  )
  assert.deepEqual(log.lines, [
    'keep ultra/integration-r6 [pr=none pinned=yes gate-read=yes]: no PR',
    'swept 1 branch: 0 deleted, 1 kept',
  ])
  assert.deepEqual(exec.calls.filter((cmd) => cmd.includes('push origin --delete')), [])

  fs.rmSync(evidenceDir, { recursive: true, force: true })
  ok('(d) a branch with no PR at all is kept')
}

// --- (e) a branch name outside [A-Za-z0-9._/-] is refused -------------------

{
  const evidenceDir = evidenceWith([])
  const hostile = 'ultra/integration-r7;rm -rf /'
  const exec = cannedExec([
    ['ls-remote', { stdout: `${SHA(8)}\trefs/heads/${hostile}\n${SHA(1)}\trefs/heads/ultra/integration-r1\n` }],
    ['--head ', { stdout: prJson('MERGED', 1) }],
    ['refs/fleet/', { stdout: `${SHA(1)}\n` }],
    ['push origin --delete', { stdout: '' }],
  ])
  const log = sink()

  await assert.rejects(
    () => sweepBranches(['--delete', '--repo-dir', REPO_DIR, '--evidence-dir', evidenceDir], { exec, log }),
    (error) => {
      assert.match(error.message, /unsafe branch name/)
      assert.ok(error.message.includes(hostile), error.message)
      return true
    },
  )
  // The only command that ran is the listing that produced the name: no `gh`,
  // no `rev-parse`, and above all no `push --delete` — not even for the safe
  // sibling branch standing next to it.
  assert.deepEqual(
    exec.calls,
    [
      `git -C ${shellQuote(REPO_DIR)} ls-remote --heads origin ` +
        `'refs/heads/ultra/integration-*' 'refs/heads/adopt/*'`,
    ],
  )
  assert.deepEqual(log.lines, [])

  fs.rmSync(evidenceDir, { recursive: true, force: true })
  ok('(e) a branch name containing `;` is refused before any command runs against it')
}

// --- (f) the summary counts equal the per-branch lines ----------------------

{
  for (const argv of [[], ['--delete']]) {
    const evidenceDir = evidenceWith(['r1', 'r2', 'r4', 'r5'])
    const exec = cannedExec(fiveBranchTable())
    const log = sink()
    await sweepBranches([...argv, '--repo-dir', REPO_DIR, '--evidence-dir', evidenceDir], { exec, log })

    const lines = log.lines
    const summary = lines[lines.length - 1]
    const match = /^swept (\d+) branch(?:es)?: (\d+) (deleted|would-delete), (\d+) kept$/.exec(summary)
    assert.ok(match, `summary line must be countable, got: ${summary}`)
    const [, total, removed, verb, kept] = match

    const perBranch = lines.slice(0, -1)
    const counted = (prefix) => perBranch.filter((line) => line.startsWith(`${prefix} `)).length
    assert.equal(Number(total), perBranch.length)
    assert.equal(Number(removed), counted(verb === 'deleted' ? 'delete' : 'would-delete'))
    assert.equal(Number(kept), counted('keep'))
    assert.equal(Number(removed) + Number(kept), perBranch.length)

    fs.rmSync(evidenceDir, { recursive: true, force: true })
  }
  ok("(f) the summary line's counts match the per-branch lines, dry and live")
}

// --- (g) --help exits 0 and runs no command ---------------------------------

{
  const refuse = async (cmd) => {
    throw new Error(`--help must run no command, got: ${cmd}`)
  }
  const log = sink()
  const result = await sweepBranches(['--help'], { exec: refuse, log })
  assert.deepEqual(result, { kept: [], deleted: [], wouldDelete: [], branches: [] })
  assert.deepEqual(log.lines, [USAGE])

  const run = spawnSync('node', [path.join(ROOT, 'fleet', 'sweep-branches.mjs'), '--help'], {
    encoding: 'utf8',
    timeout: 60_000,
  })
  assert.equal(run.status, 0, run.stdout + run.stderr)
  assert.ok(run.stdout.includes('sweep-branches.mjs'), run.stdout)
  assert.ok(run.stdout.includes('--delete'), run.stdout)
  ok('(g) `node fleet/sweep-branches.mjs --help` exits 0 without calling exec')
}

// --- (h) beyond the Proof: the argument grammar and its defaults ------------

{
  const parsed = parseArgs([])
  assert.equal(parsed.delete, false)
  assert.equal(parsed.help, false)
  assert.equal(parsed.repoDir, DEFAULTS.repoDir)
  assert.equal(parsed.evidenceDir, DEFAULTS.evidenceDir)
  assert.equal(parsed.evidenceDir, '/home/exedev/fleet-evidence')

  assert.throws(() => parseArgs(['--wat']), /unknown argument/)
  assert.throws(() => parseArgs(['--repo-dir']), /--repo-dir requires a value/)
  ok('(h) parseArgs defaults D to the CLI checkout and E to DEFAULTS.evidenceDir, and refuses junk')
}

console.log(`\nALL TESTS PASSED (${passed})`)
