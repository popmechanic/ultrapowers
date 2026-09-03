// fleet/tests/test_drive_one_target.mjs — task 4: the CLI names the target and
// the base, and a race shares one cache clone.
//
// The claim: launching a run means naming the repository and the commit;
// nothing else about where the drive runs from is a flag.
//
// Leg -> machine clause:
//   (a) parseArgs demands --target and --base, validates both, and refuses the
//       four deleted flags by name                                        [M1]
//   (b) buildDriveOptions carries target/baseSha/repoDir and drops the three
//       deleted keys, every other key untouched                           [M2]
//   (c) usage() names the two new flags and none of the four deleted ones  [M3]
//   (d) launchRace runs no git, hands every attempt the same target, baseSha
//       and repoDir, and records the given base and plan in the manifest   [M4]
//   (e) the clone seam and its two tests are gone, and no file under fleet/
//       still names the deleted module                                    [M5]
//
// Nothing here provisions, shells out or touches the network: the token read,
// the shell and driveOne are injected, and the only disk write is a manifest in
// a temp evidence dir plus one deliberately planted probe file (leg (e)).
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { REPO_DIR, buildDriveOptions, parseArgs, usage } from '../drive-one.mjs'
import { launchRace } from '../race-launch.mjs'
import { manifestPath } from '../race-manifest.mjs'

let passed = 0
const ok = (label) => {
  passed += 1
  console.log(`ok - ${label}`)
}

// Anchored on THIS file, never on process.cwd(): the exam is run by path from
// wherever the suite happens to sit.
const HERE = fileURLToPath(import.meta.url)
const REPO_ROOT = path.resolve(path.dirname(HERE), '..', '..')
const FLEET_DIR = path.join(REPO_ROOT, 'fleet')

const SHA = '3f'.repeat(20)
const TARGET = 'o/r'
const PLAN = 'docs/plan.md'
const VALID = [PLAN, 'run-1', '--target', TARGET, '--base', SHA]
const options = (argv) => buildDriveOptions(parseArgs(argv), { readToken: () => 't' })

// The thrown message minus the usage tail, so "names the flag" means the
// diagnostic named it — not that usage() happens to list it.
const diagnosticOf = (error) => String(error?.message ?? error).split(usage()).join('')

const throwsNaming = (fn, needle, label) => {
  let error = null
  try {
    fn()
  } catch (thrown) {
    error = thrown
  }
  assert.ok(error, `${label}: expected a throw, got none`)
  const diagnostic = diagnosticOf(error)
  assert.ok(
    diagnostic.includes(needle),
    `${label}: the diagnostic ${JSON.stringify(diagnostic)} must name ${needle}`,
  )
}

const throwsAnything = (fn, label) => {
  assert.throws(fn, (error) => error instanceof Error, `${label}: expected a throw, got none`)
}

// ---------------------------------------------------------------------------
// (a) M1: --target and --base are required and validated; the four flags the
//     task deletes are unknown flags now.
// ---------------------------------------------------------------------------
{
  throwsNaming(() => parseArgs([PLAN, 'run-1', '--base', SHA]), '--target', 'a missing --target')
  throwsNaming(() => parseArgs([PLAN, 'run-1', '--target', TARGET]), '--base', 'a missing --base')

  // /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/: exactly one slash, no spaces.
  throwsAnything(() => parseArgs([PLAN, 'run-1', '--target', 'o r', '--base', SHA]), "--target 'o r'")
  throwsAnything(() => parseArgs([PLAN, 'run-1', '--target', 'a/b/c', '--base', SHA]), "--target 'a/b/c'")
  // isSafeSha: a symbolic base would let two runs claim one commit.
  throwsAnything(() => parseArgs([PLAN, 'run-1', '--target', TARGET, '--base', 'HEAD']), '--base HEAD')

  // The valid pair parses and keeps the #211 runId grammar.
  const parsed = parseArgs(VALID)
  assert.equal(parsed.target, TARGET)
  assert.equal(parsed.baseSha, SHA)
  assert.equal(parsed.planPath, PLAN)
  assert.equal(parsed.runId, 'run-1')

  // Each deleted flag: `unknown flag <flag>`. A flag that PARSES instead of
  // throwing fails this leg — that is the whole point of the clause.
  for (const [flag, value] of [
    ['--repo-dir', '/tmp/elsewhere'],
    ['--pin-repo-dir', '/tmp/elsewhere'],
    ['--plan-from-assignment', null],
    ['--pr-base', 'main'],
  ]) {
    const argv = value === null ? [...VALID, flag] : [...VALID, flag, value]
    throwsNaming(() => parseArgs(argv), `unknown flag ${flag}`, `${flag} must be unknown`)
  }
  ok('(a) --target/--base are required and validated; the four deleted flags are unknown flags [M1]')
}

// ---------------------------------------------------------------------------
// (b) M2: the option shape — two keys in, three keys out, the rest as at BASE.
// ---------------------------------------------------------------------------
{
  // The BASE list, frozen here verbatim: what buildDriveOptions returned at
  // 3fee7e7 for a parse carrying --overlap (and no --plan-from-assignment).
  const FROZEN_BASE_KEYS = [
    'planPath',
    'golden',
    'port',
    'dbDir',
    'repoDir',
    'pinRepoDir',
    'exec',
    'engineEnv',
    'runId',
    'ttlMs',
    'heartbeatTimeoutMs',
    'claimTimeoutMs',
    'evidenceDir',
    'sandboxCpu',
    'sandboxMemory',
    'overlap',
    'allowUnfitPlan',
    'githubTokenPath',
    'prBase',
  ]
  const DELETED_KEYS = ['pinRepoDir', 'prBase', 'planSource']
  const expectedKeys = [...FROZEN_BASE_KEYS.filter((key) => !DELETED_KEYS.includes(key)), 'target', 'baseSha'].sort()

  const o = options([...VALID, '--overlap', 'fold'])
  assert.equal(o.target, TARGET)
  assert.equal(o.baseSha, SHA)
  assert.equal(o.repoDir, REPO_DIR)
  assert.equal(o.overlap, 'fold')
  for (const key of DELETED_KEYS) {
    assert.ok(!(key in o), `buildDriveOptions must carry no ${key} key, got ${JSON.stringify(o[key])}`)
  }
  assert.deepEqual(Object.keys(o).sort(), expectedKeys)

  // The keys that stayed are the same values they were at BASE.
  assert.equal(o.planPath, PLAN)
  assert.equal(o.runId, 'run-1')
  assert.equal(o.golden, 'fleet-golden-next')
  assert.equal(o.port, 8180)
  assert.equal(o.dbDir, '/tmp/fleet-orch-live')
  assert.equal(o.ttlMs, 4 * 60 * 60 * 1000)
  assert.equal(o.heartbeatTimeoutMs, 30 * 60_000)
  assert.equal(o.claimTimeoutMs, 10 * 60_000)
  assert.equal(o.evidenceDir, '/home/exedev/fleet-evidence')
  assert.equal(o.sandboxCpu, 16)
  assert.equal(o.sandboxMemory, '48GB')
  assert.equal(o.allowUnfitPlan, false)
  assert.equal(o.githubTokenPath, '/home/exedev/.fleet/github-token')
  assert.deepEqual(o.engineEnv, { CLAUDE_CODE_OAUTH_TOKEN: 't' })
  assert.equal(typeof o.exec, 'function')

  // An unset --overlap still adds no key at all (#514).
  const bare = options(VALID)
  assert.ok(!('overlap' in bare), 'an unset --overlap must leave no overlap key')
  assert.deepEqual(
    Object.keys(bare).sort(),
    expectedKeys.filter((key) => key !== 'overlap'),
  )
  ok('(b) buildDriveOptions carries target, baseSha and repoDir === REPO_DIR; the three deleted keys are gone [M2]')
}

// ---------------------------------------------------------------------------
// (c) M3: the usage line names what a launch names.
// ---------------------------------------------------------------------------
{
  const text = usage()
  assert.ok(text.includes('--target <owner>/<repo>'), `usage() must name --target <owner>/<repo>: ${text}`)
  assert.ok(text.includes('--base <sha>'), `usage() must name --base <sha>: ${text}`)
  for (const flag of ['--repo-dir', '--pin-repo-dir', '--plan-from-assignment', '--pr-base']) {
    assert.ok(!text.includes(flag), `usage() still advertises the deleted flag ${flag}: ${text}`)
  }
  ok('(c) usage() names --target <owner>/<repo> and --base <sha> and none of the four deleted flags [M3]')
}

// ---------------------------------------------------------------------------
// (d) M4: launchRace runs no git; the attempts share target, baseSha, repoDir.
// ---------------------------------------------------------------------------
{
  const source = fs.readFileSync(path.join(FLEET_DIR, 'race-launch.mjs'), 'utf8')
  // The deleted module's name, never spelled literally in this file — leg (e)
  // walks the tree for it.
  const CLONE_NEEDLE = `race-${'clone'}`
  // `'clone'` carries its quotes on purpose: the banned thing is the git argv
  // literal, not the English word.
  for (const needle of ['node:child_process', 'execFile', 'spawn', "'clone'", 'set-url', '--detach', CLONE_NEEDLE]) {
    assert.ok(
      !source.includes(needle),
      `fleet/race-launch.mjs must run no git at all, but its source contains ${JSON.stringify(needle)}`,
    )
  }

  const RACE_ID = 'race-9'
  const evidenceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drive-one-target-'))
  const argv = [PLAN, RACE_ID, '--k', '3', '--target', TARGET, '--base', SHA]
  const driveCalls = []
  const progress = []
  const { manifest } = await launchRace(argv, {
    drive: async (opts) => {
      driveCalls.push(opts)
      return { read: { runId: opts.runId }, reportPath: `/ev/${opts.runId}.md` }
    },
    git: () => {
      throw new Error('launchRace must run no git')
    },
    evidenceDir,
    now: () => '2026-09-02T00:00:00.000Z',
    readToken: () => 't',
    exec: () => {
      throw new Error('launchRace must not shell out')
    },
    progressSink: (line) => progress.push(line),
    stdout: () => {},
    stderr: () => {},
  })

  assert.equal(driveCalls.length, 3, 'three attempts, three drives')
  for (const opts of driveCalls) {
    assert.equal(opts.target, TARGET)
    assert.equal(opts.baseSha, SHA)
    assert.equal(opts.repoDir, REPO_DIR)
  }

  // Same-value, except that two functions are the same value only when they
  // are the same function — which is what "progressLog differs" has to mean.
  const sameValue = (a, b) => {
    if (typeof a === 'function' || typeof b === 'function') return a === b
    try {
      assert.deepEqual(a, b)
      return true
    } catch {
      return false
    }
  }
  const keys = [...new Set(driveCalls.flatMap((opts) => Object.keys(opts)))].sort()
  const differing = keys.filter(
    (key) => !(sameValue(driveCalls[0][key], driveCalls[1][key]) && sameValue(driveCalls[1][key], driveCalls[2][key])),
  )
  assert.deepEqual(differing, ['dbDir', 'port', 'progressLog', 'runId'])
  for (const key of differing) {
    assert.equal(
      new Set(driveCalls.map((opts) => opts[key])).size,
      3,
      `${key} must be pairwise distinct across the attempts`,
    )
  }
  assert.deepEqual(
    driveCalls.map((opts) => opts.runId),
    ['race-9-a', 'race-9-b', 'race-9-c'],
  )

  // The manifest records the base that was NAMED and the plan path as given.
  assert.equal(manifest.baseCommit, SHA)
  assert.equal(manifest.planPath, PLAN)
  const onDisk = JSON.parse(fs.readFileSync(manifestPath(evidenceDir, RACE_ID), 'utf8'))
  assert.equal(onDisk.baseCommit, SHA)
  assert.equal(onDisk.planPath, PLAN)
  ok('(d) launchRace runs no git; the attempts share target, baseSha and repoDir and differ in the four lanes [M4]')
}

// ---------------------------------------------------------------------------
// (e) M5: the clone seam and its two tests are deleted, and nothing under
//     fleet/ still names the module.
// ---------------------------------------------------------------------------
{
  const CLONE = 'clone'
  const NEEDLE = `race-${CLONE}`
  for (const gone of [
    path.join(FLEET_DIR, `race-${CLONE}.mjs`),
    path.join(FLEET_DIR, 'tests', `test_race_${CLONE}.mjs`),
    path.join(FLEET_DIR, 'tests', 'test_drive_pin_repo.mjs'),
  ]) {
    assert.equal(fs.existsSync(gone), false, `${path.relative(REPO_ROOT, gone)} must not exist`)
  }

  // Every file under fleet/, any extension, node_modules/ and this exam
  // excluded. Read as bytes so a non-text file is scanned, not skipped.
  const walk = (dir, hits, visited) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue
        walk(full, hits, visited)
        continue
      }
      if (!entry.isFile()) continue
      if (full === HERE) continue
      visited.push(full)
      if (fs.readFileSync(full).includes(NEEDLE)) hits.push(full)
    }
    return { hits, visited }
  }
  const scan = () => walk(FLEET_DIR, [], [])

  const clean = scan()
  assert.ok(clean.visited.length >= 20, `the walk visited only ${clean.visited.length} files under fleet/`)
  assert.deepEqual(
    clean.hits.map((hit) => path.relative(REPO_ROOT, hit)),
    [],
    // M5 is a whole-tree property, so this walk is graded on the integrated
    // tree. The last occurrence outside the files deleted here is a prose
    // comment in the #543 mirror block of fleet/drive.mjs, which is not this
    // task's file to edit: the task that owns drive.mjs deletes that block
    // whole, which removes the mention with it. Run alone, before that landed,
    // this assertion names fleet/drive.mjs and that is the expected residue.
    'no file under fleet/ may still name the deleted clone module',
  )

  // The walk is live, not vacuous: a planted file carrying the needle is found.
  const planted = path.join(FLEET_DIR, 'tests', `_needle_probe_${process.pid}.tmp`)
  try {
    fs.writeFileSync(planted, `${NEEDLE}\n`)
    const probed = scan()
    assert.ok(
      probed.hits.includes(planted),
      `the walk missed a planted ${path.relative(REPO_ROOT, planted)} carrying the needle`,
    )
  } finally {
    fs.rmSync(planted, { force: true })
  }
  assert.equal(fs.existsSync(planted), false)
  ok('(e) the clone seam and its two tests are gone and no file under fleet/ names the module [M5]')
}

console.log(`\nALL TESTS PASSED (${passed})`)
