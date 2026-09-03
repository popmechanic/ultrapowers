// fleet/tests/test_race_launch.mjs — #511 task 8: the launch verb.
//
// The claim: launch the same committed plan as K concurrent runs — distinct
// runIds, ports, db-dirs (the #454 launch shape) — against the target and the
// commit the launch line NAMES.
//
// Three defects this suite makes inexpressible:
//
//   * a manifest written after the results are visible (the dials are
//     pre-registered; leg (b) reads the file from inside the first drive),
//   * a rejecting drive taking the process down while its siblings are still
//     provisioning, orphaning their `fleet-<runId>` VMs — the defect run-47's
//     review and all three race-48 reviews flagged (#535 item 1). Leg (f) has
//     one attempt reject while the other two are in flight and demands the
//     other two still resolve, and
//   * a race that discovers its own commit. #575 deleted the per-attempt
//     checkout: the base is named as `--base`, every attempt drives out of the
//     one engine checkout, and leg (g) refuses any git at all.
//
// No live drive, no network, no git: `driveOne`, the token read and the shell
// are all injected, and the only thing that touches the disk is the manifest,
// in a temp evidence dir.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launchRace } from '../race-launch.mjs'
import { DIALS, manifestPath } from '../race-manifest.mjs'
import { allocateRuns } from '../race-allocate.mjs'
import { DEFAULTS, REPO_DIR } from '../drive-one.mjs'

let passed = 0
const ok = (label) => {
  passed += 1
  console.log(`ok - ${label}`)
}

const SHA = '3f'.repeat(20)
const TARGET = 'o/r'
const RACE_ID = 'race-9'
const LAUNCHED_AT = '2026-09-02T00:00:00.000Z'
const ARGV = ['docs/plan.md', RACE_ID, '--k', '3', '--target', TARGET, '--base', SHA]
const TOKEN = 'oauth-token-value'

const tempEvidenceDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'race-launch-'))

// The three lanes the launcher must allocate, computed the same way the
// launcher's own defaults compute them. There is no per-attempt checkout any
// more, so every lane's repoDir is the one engine checkout.
const expectedRuns = () =>
  allocateRuns({
    raceId: RACE_ID,
    k: 3,
    port: DEFAULTS.port,
    dbDir: DEFAULTS.dbDir,
    raceDir: REPO_DIR,
  }).map((run) => ({ ...run, repoDir: REPO_DIR }))

// A gate that opens only once `n` callers have arrived: awaiting it inside the
// drive stub means the stub cannot resolve until every sibling has STARTED, so
// a launcher that drove the attempts one at a time would deadlock here rather
// than pass. The timeout turns that deadlock into a named failure well inside
// the suite's 120s cap.
const gateFor = (n, label) => {
  let arrived = 0
  let open
  const opened = new Promise((resolve) => {
    open = resolve
  })
  return async () => {
    arrived += 1
    if (arrived === n) open()
    let timer
    const timeout = new Promise((_, reject) => {
      // Deliberately NOT unref'd: a launcher that drove the attempts one at a
      // time would otherwise drain the event loop and exit with no diagnostic
      // at all. The timer is cleared on the way out of every happy path.
      timer = setTimeout(
        () => reject(new Error(`${label}: only ${arrived} of ${n} drives were in flight after 5s`)),
        5000,
      )
    })
    try {
      await Promise.race([opened, timeout])
    } finally {
      clearTimeout(timer)
    }
  }
}

// deepStrictEqual, except that two functions count as the same value only when
// they are the same function — which is what "this key differs between the
// attempts" has to mean for `progressLog`.
const sameValue = (a, b) => {
  if (typeof a === 'function' || typeof b === 'function') return a === b
  try {
    assert.deepEqual(a, b)
    return true
  } catch {
    return false
  }
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// A git runner that must never be called. Passed on every launch below: a
// launcher that reached for git would fail the leg it was called from.
const refusingGit = () => {
  throw new Error('race-launch must run no git')
}

// ---------------------------------------------------------------------------
// (a)-(e) one launch of three attempts, all fulfilling.
// ---------------------------------------------------------------------------
{
  const evidenceDir = tempEvidenceDir()
  const gate = gateFor(3, 'overlap')
  const driveCalls = []
  const manifestOnDiskAtCall = []
  const out = []
  const err = []
  const progress = []
  const drive = async (opts) => {
    driveCalls.push(opts)
    manifestOnDiskAtCall.push(fs.existsSync(manifestPath(evidenceDir, RACE_ID)))
    await gate()
    return { read: { runId: opts.runId }, reportPath: `/ev/${opts.runId}.md` }
  }

  const { manifest, results } = await launchRace(ARGV, {
    drive,
    git: refusingGit,
    evidenceDir,
    now: () => LAUNCHED_AT,
    readToken: () => `${TOKEN}\n`,
    exec: () => {
      throw new Error('race-launch must not shell out')
    },
    progressSink: (line) => progress.push(line),
    stdout: (line) => out.push(line),
    stderr: (line) => err.push(line),
  })

  // (a) the manifest on disk is exactly the schema literal, dials included.
  //     `baseCommit` is the sha the launch line NAMED — nothing read it off a
  //     checkout's HEAD, and nothing could.
  const onDisk = JSON.parse(fs.readFileSync(manifestPath(evidenceDir, RACE_ID), 'utf8'))
  assert.deepEqual(onDisk, {
    raceId: RACE_ID,
    planPath: 'docs/plan.md',
    baseCommit: SHA,
    k: 3,
    launchedAt: LAUNCHED_AT,
    runs: expectedRuns(),
    dials: DIALS,
  })
  assert.equal(onDisk.baseCommit, SHA)
  assert.deepEqual(onDisk.runs, expectedRuns())
  assert.deepEqual(onDisk.dials, DIALS)
  assert.deepEqual(manifest.runs, expectedRuns())
  assert.equal(manifest.raceId, RACE_ID)
  ok('(a) race-race-9.json records the named sha, the plan path as given, the three lanes and the dials')

  // (b) the manifest was on disk before the first drive was called.
  assert.deepEqual(manifestOnDiskAtCall, [true, true, true])
  assert.equal(manifestOnDiskAtCall[0], true, 'the manifest must exist at the first driveOne call')
  ok('(b) the manifest is on disk at the moment of the first driveOne call')

  // (c) exactly three drives, and they overlap in flight.
  assert.equal(driveCalls.length, 3)
  assert.deepEqual(
    results.map((r) => r.status),
    ['fulfilled', 'fulfilled', 'fulfilled'],
  )
  ok('(c) driveOne is called exactly 3 times and all three are in flight together')

  // (d) exactly the four per-attempt keys differ; everything else is shared —
  //     and `repoDir` is now on the shared side, with `target` and `baseSha`.
  const keys = [...new Set(driveCalls.flatMap((opts) => Object.keys(opts)))].sort()
  const differing = keys.filter(
    (key) =>
      !(sameValue(driveCalls[0][key], driveCalls[1][key]) && sameValue(driveCalls[1][key], driveCalls[2][key])),
  )
  assert.deepEqual(differing, ['dbDir', 'port', 'progressLog', 'runId'])
  for (const key of differing) {
    const values = driveCalls.map((opts) => opts[key])
    assert.equal(new Set(values).size, 3, `${key} must be pairwise distinct across the attempts`)
  }
  assert.deepEqual(
    driveCalls.map((opts) => opts.runId),
    ['race-9-a', 'race-9-b', 'race-9-c'],
  )
  for (const opts of driveCalls) {
    assert.equal(opts.target, TARGET)
    assert.equal(opts.baseSha, SHA)
    assert.equal(opts.repoDir, REPO_DIR, 'every attempt drives out of the one engine checkout')
  }
  assert.deepEqual(
    driveCalls.map((opts) => ({ runId: opts.runId, port: opts.port, dbDir: opts.dbDir, repoDir: opts.repoDir })),
    expectedRuns(),
  )
  for (const opts of driveCalls) {
    const before = progress.length
    opts.progressLog('provisioning')
    assert.deepEqual(progress.slice(before), [`${opts.runId}: provisioning`])
    assert.ok(
      progress[before].startsWith(`${opts.runId}`),
      `progressLog must prefix its own runId, got ${JSON.stringify(progress[before])}`,
    )
  }
  ok('(d) runId, port, dbDir and progressLog differ per attempt; target, baseSha and repoDir are shared')

  // (e) the seam's own constants ride through untouched.
  for (const opts of driveCalls) {
    assert.equal(opts.githubTokenPath, DEFAULTS.githubTokenPath)
    assert.equal(opts.golden, DEFAULTS.golden)
    assert.equal(opts.planPath, 'docs/plan.md')
    assert.equal(opts.evidenceDir, evidenceDir)
    assert.equal(opts.ttlMs, DEFAULTS.ttlHours * 60 * 60 * 1000)
    assert.deepEqual(opts.engineEnv, { CLAUDE_CODE_OAUTH_TOKEN: TOKEN })
  }
  // The token is built into engineEnv by the seam and never narrated.
  for (const line of [...out, ...err, ...progress]) {
    assert.ok(!line.includes(TOKEN), `a printed line leaked the token: ${JSON.stringify(line)}`)
  }
  ok("(e) every option object carries drive-one's own defaults, built through the real buildDriveOptions")
}

// ---------------------------------------------------------------------------
// (f) one attempt rejects; its siblings still run to completion.
// ---------------------------------------------------------------------------
{
  const evidenceDir = tempEvidenceDir()
  // Only the two survivors arrive at the gate: 'b' rejects the moment it is
  // called, while 'a' and 'c' are still in flight.
  const gate = gateFor(2, 'siblings')
  const boom = new Error('preflight refused: the plan is dirty')
  const driveCalls = []
  const settledOrder = []
  const valueFor = (runId) => ({ read: { runId }, reportPath: `/ev/${runId}.md` })
  const drive = async (opts) => {
    driveCalls.push(opts.runId)
    if (opts.runId === 'race-9-b') {
      settledOrder.push('race-9-b')
      throw boom
    }
    await gate()
    await delay(10)
    settledOrder.push(opts.runId)
    return valueFor(opts.runId)
  }

  const { results } = await launchRace(ARGV, {
    drive,
    git: refusingGit,
    evidenceDir,
    now: () => LAUNCHED_AT,
    readToken: () => TOKEN,
    exec: () => {
      throw new Error('race-launch must not shell out')
    },
    progressSink: () => {},
    stdout: () => {},
    stderr: () => {},
  })

  assert.deepEqual(driveCalls, ['race-9-a', 'race-9-b', 'race-9-c'])
  assert.deepEqual(results, [
    { runId: 'race-9-a', status: 'fulfilled', value: valueFor('race-9-a') },
    { runId: 'race-9-b', status: 'rejected', reason: boom },
    { runId: 'race-9-c', status: 'fulfilled', value: valueFor('race-9-c') },
  ])
  assert.equal(results[1].reason, boom)
  // 'b' rejected first and the launcher still waited for the other two.
  assert.deepEqual(settledOrder, ['race-9-b', 'race-9-a', 'race-9-c'])
  ok('(f) a rejecting attempt is reported after all K settle — its siblings are neither skipped nor abandoned')
}

// ---------------------------------------------------------------------------
// (g) the launcher runs no git and starts no subprocess: the commit is named,
//     never discovered, and there is no checkout to build.
// ---------------------------------------------------------------------------
{
  const evidenceDir = tempEvidenceDir()
  const gitCalls = []
  const { manifest } = await launchRace(ARGV, {
    drive: async (opts) => ({ read: { runId: opts.runId } }),
    // Recording rather than throwing, so a launcher that DID call git fails
    // with the argv it tried rather than with a stack from inside the stub.
    git: (...args) => {
      gitCalls.push(args)
      return ''
    },
    evidenceDir,
    now: () => LAUNCHED_AT,
    readToken: () => TOKEN,
    exec: () => {
      throw new Error('race-launch must not shell out')
    },
    stdout: () => {},
    stderr: () => {},
  })
  assert.deepEqual(gitCalls, [], `launchRace ran git: ${JSON.stringify(gitCalls)}`)
  assert.equal(manifest.baseCommit, SHA)
  ok('(g) launchRace runs no git — the raced commit is the --base it was given')
}

// ---------------------------------------------------------------------------
// (h) a launch that does not name its target and its base is refused, before
//     the manifest and before any drive.
// ---------------------------------------------------------------------------
{
  const evidenceDir = tempEvidenceDir()
  const driveCalls = []
  const deps = {
    drive: async (opts) => {
      driveCalls.push(opts.runId)
      return {}
    },
    git: refusingGit,
    evidenceDir,
    now: () => LAUNCHED_AT,
    readToken: () => TOKEN,
    exec: () => {
      throw new Error('race-launch must not shell out')
    },
    stdout: () => {},
    stderr: () => {},
  }
  await assert.rejects(launchRace(['docs/plan.md', RACE_ID, '--k', '3', '--base', SHA], deps), /--target/)
  await assert.rejects(launchRace(['docs/plan.md', RACE_ID, '--k', '3', '--target', TARGET], deps), /--base/)
  assert.deepEqual(driveCalls, [])
  assert.equal(fs.existsSync(manifestPath(evidenceDir, RACE_ID)), false)
  ok('(h) a launch missing --target or --base refuses by name — no manifest, no drive')
}

console.log(`\nALL TESTS PASSED (${passed})`)
