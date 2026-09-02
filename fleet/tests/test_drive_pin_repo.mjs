// fleet/tests/test_drive_pin_repo.mjs — the run tip is pinned in ONE canonical
// repo, whatever `repoDir` this drive happens to be running out of (#543).
//
// #497 made the fetched tip durable by writing `refs/fleet/<runId>` — but it
// writes it in `repoDir`, and a race hands every attempt a THROWAWAY clone
// under /tmp (`fleet/race-clone.mjs`). The rescue ref then lives in the one
// directory nobody looks in and /tmp reaps: the same "reachable by nothing"
// outcome #497 exists to prevent. `pinRepoDir` mirrors the ref into a
// well-known checkout once the local pin has landed.
//
// A ref is always fetchable from a local path and a bare sha is not
// (`uploadpack.allowAnySHA1InWant`), so the mirror fetches the REF.
//
// Offline by construction: no ssh, no `gh`, no network beyond the drive's own
// loopback ws server. Legs (a)-(e) and (g) run against a pure recording stub —
// no git process at all — and leg (f) drives two REAL temp repos, with the
// mirror fetch executed for real.
//
// Legs:
//   (a) `pinRepoDir: '/canon'` issues exactly one mirror fetch, immediately
//       after the `update-ref` in `/r`, and the notes name both repos
//   (b) omitted, and again `pinRepoDir: '/r'`, reproduce the command sequence
//       frozen from BASE byte for byte; `/canon` is that sequence plus the one
//       mirror fetch and nothing else
//   (c) a mirror fetch that fails names `/canon` in `detail.errors` and the
//       drive still completes
//   (d) an unsafe `pinRepoDir` issues no fetch at all and records a refusal
//   (e) `--pin-repo-dir` parses and rides `buildDriveOptions`; without it the
//       CLI pins into the checkout it lives in (`REPO_DIR`)
//   (f) END TO END: the mirror really makes `git -C canon rev-parse
//       refs/fleet/run-1` resolve to the tip
//   (g) `launchRace` hands every attempt the launch checkout
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { WebSocket } from 'ws'
import { createMergeableStore } from 'tinybase'
import { createWsSynchronizer } from 'tinybase/synchronizers/synchronizer-ws-client'
import { driveOne } from '../drive.mjs'
import { buildDriveOptions, parseArgs, usage, REPO_DIR } from '../drive-one.mjs'
import { launchRace } from '../race-launch.mjs'
import { runShim } from '../shim.mjs'
import { mintToken } from '../tokens.mjs'
import {
  applyBranch,
  applyReceipt,
  applyReportedTokens,
  applyStamp,
  auxStoreId,
  sandboxIdFor,
} from '../shim-main.mjs'

const ok = (label) => console.log(`ok - ${label}`)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const sh = (cmd, cwd) =>
  new Promise((resolve) => {
    execFile('/bin/sh', ['-c', cmd], { cwd }, (error, stdout, stderr) =>
      resolve({
        code: typeof error?.code === 'number' ? error.code : error ? 1 : 0,
        stdout: stdout ?? '',
        stderr: stderr ?? '',
      }),
    )
  })

// The values the stubbed drive resolves to. `repoDir` is the literal `/r` the
// claim names: nothing here reads a directory, every command is a string the
// stub answers.
const TIP = '0123456789abcdef0123456789abcdef01234567'
const BRANCH = 'ultra/integration-20260902101112'
const RECEIPT_PATH = '.claude/ultrapowers/run-x/gate-receipt.json'
const RUN_ID = 'run-pin'
const T = 2_000_000
const clock = () => T

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-pin-'))

// The mirror the pin leg must issue, verbatim: a REF-to-REF fetch out of the
// drive's own checkout into the canonical one.
const MIRROR = `git -C /canon fetch /r refs/fleet/${RUN_ID}:refs/fleet/${RUN_ID}`

// The sequence a stubbed drive issued at BASE — recorded from this same stub
// before the pin-mirror existed, so any command this task adds, drops or
// rewords on the `pinRepoDir`-absent path fails leg (b) rather than passing
// unnoticed. Two spans cannot be frozen and are normalized away below: the
// `mkdtemp` evidence dir and the log archive's `Date.now()` stamp.
const BASE_SEQUENCE = [
  'git -C /r show HEAD:docs/plan.md',
  'git -C /r rev-parse HEAD',
  'git -C /r show HEAD:.claude-plugin/plugin.json',
  'git -C /r -c core.sshCommand="ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null" ' +
    `fetch ssh://exedev@fleet-${RUN_ID}.exe.xyz/home/exedev/repo ${BRANCH}`,
  'git -C /r rev-parse FETCH_HEAD',
  `git -C /r check-ref-format refs/fleet/${RUN_ID}`,
  `git -C /r update-ref refs/fleet/${RUN_ID} ${TIP}`,
  `git -C /r cat-file -e ${TIP}`,
  `git -C /r merge-base --is-ancestor ${TIP} ${TIP}`,
  `git -C /r cat-file -e ${TIP}:${RECEIPT_PATH}`,
  'ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null ' +
    `fleet-${RUN_ID}.exe.xyz 'cd /home/exedev && tar czf - --exclude="repo/.claude/ultrapowers/run-*/clones" ` +
    'shim.log fleet-run.json .claude/projects $(cd repo && ls -d .claude/ultrapowers/run-*/ 2>/dev/null | ' +
    'sed "s|^|repo/|") 2>/dev/null\' > <EVIDENCE>/sandbox-logs/fleet-' + RUN_ID + '-<T>/sandbox-logs.tgz',
  `ssh -o BatchMode=yes -o ConnectTimeout=10 exe.dev "stat fleet-${RUN_ID} --json --range=24h"`,
]

/**
 * The recording stub: every command the drive issues is pushed onto `cmds` and
 * nothing is executed. The answers are exactly the ones that carry a drive to a
 * fetched, pinned tip — the state the mirror leg hangs off.
 */
const makeExec = ({ mirrorCode = 0 } = {}) => {
  const cmds = []
  const exec = async (cmd) => {
    cmds.push(cmd)
    // Both `git show` reads (the plan at baseRef, the version manifest) are
    // absent: the fitness check is skipped and the version cross-check is
    // unavailable. Both are narration, neither is a refusal.
    if (/^git -C \S+ show \S+:/.test(cmd)) return { code: 1, stdout: '', stderr: 'fatal: path does not exist' }
    if (/^git -C \S+ rev-parse FETCH_HEAD$/.test(cmd)) return { code: 0, stdout: `${TIP}\n` }
    if (/^git -C \S+ fetch \S+ refs\/fleet\//.test(cmd)) {
      return { code: mirrorCode, stdout: '', stderr: mirrorCode === 0 ? '' : 'fatal: mirror refused' }
    }
    if (/^ssh .* exe\.dev "stat /.test(cmd)) return { code: 0, stdout: JSON.stringify({ points: [] }) }
    return { code: 0, stdout: '' }
  }
  exec.cmds = cmds
  return exec
}

/**
 * A real `runShim` against the drive's own orchestrator, over the real ws
 * transport: it claims, runs, reports gate-green and publishes one receipt on
 * one branch — the minimum that makes the drive fetch and pin.
 */
const startStubSandbox = ({ wsUrl, token, ttlMs, runId }) => {
  const sandboxId = sandboxIdFor(runId)
  return (async () => {
    // A distinct store id: two live MergeableStores sharing one mint colliding
    // HLCs and lose writes (shim-main's `auxStoreId`).
    const store = createMergeableStore(auxStoreId(sandboxId))
    const socket = new WebSocket(`${wsUrl}?token=${token}`)
    const synchronizer = await createWsSynchronizer(store, socket)
    await synchronizer.startSync()
    const stamp = { engineSha: TIP, pluginVersion: '9.9.9' }
    applyStamp(store, runId, stamp)
    const outcome = await runShim({
      wsUrl,
      token,
      sandboxId,
      runId,
      ttlMs,
      clock,
      invokeRun: async () => {
        applyReceipt(store, runId, 'gate', { sha: TIP, path: RECEIPT_PATH, verdict: 'PASS' })
        // A run that resolves inside the tick it started leaves its status
        // writes unflushed; the shim is written against a slower timescale.
        await sleep(250)
        return { gateGreen: true }
      },
      readReportTokens: () => 4200,
    })
    applyStamp(store, runId, stamp)
    applyReportedTokens(store, runId, 4200)
    applyBranch(store, runId, BRANCH)
    await synchronizer.save()
    await synchronizer.stopSync()
    await synchronizer.destroy()
    return outcome
  })()
}

/**
 * One drive to a fetched, pinned tip. `lane` names this drive's own store and
 * evidence dirs so the same `runId` can be driven repeatedly — leg (b) compares
 * three command sequences, and a runId that moved between them would be the
 * only difference in every line.
 */
const drive = async (lane, options = {}) => {
  const exec = options.exec ?? makeExec()
  const runId = options.runId ?? RUN_ID
  let sandbox = null
  const dbDir = path.join(tmpRoot, `db-${lane}`)
  const evidenceDir = path.join(tmpRoot, `ev-${lane}`)
  fs.mkdirSync(dbDir, { recursive: true })
  const provision = async ({ wsUrl, ttlMs, registerToken }) => {
    const vmName = sandboxIdFor(runId)
    const { token, record } = mintToken({ sandboxId: vmName, ttlMs, now: clock() })
    registerToken(record)
    setTimeout(() => {
      sandbox = startStubSandbox({ wsUrl, token, ttlMs, runId })
    }, 30)
    return { vmName, token, record }
  }
  const notes = []
  const result = await driveOne({
    planPath: 'docs/plan.md',
    golden: 'fleet-golden',
    port: 0,
    dbDir,
    evidenceDir,
    repoDir: '/r',
    clock,
    runId,
    ttlMs: 60_000,
    tickMs: 25,
    settleMs: 150,
    heartbeatTimeoutMs: 20_000,
    publishPollMs: 50,
    publishTimeoutMs: 8_000,
    progressLog: (line) => notes.push(line),
    provision,
    destroy: async () => ({}),
    // No token file: the publish leg records `github-token missing` and issues
    // no command at all, so the sequence is the drive's git work alone.
    githubTokenPath: path.join(tmpRoot, 'no-such-github-token'),
    ...options,
    exec,
  })
  await sandbox
  return { ...result, exec, notes, evidenceDir, cmds: normalize(exec.cmds, evidenceDir) }
}

/**
 * The two spans no literal can carry: the evidence dir (an `mkdtemp` path) and
 * the log archive's `Date.now()` stamp. Everything else in every command is
 * compared as it was issued.
 */
const normalize = (cmds, evidenceDir) =>
  cmds.map((cmd) => cmd.split(evidenceDir).join('<EVIDENCE>').replace(/(sandbox-logs\/[^/]+)-\d+\//, '$1-<T>/'))

try {
  // -- (a) the mirror, and where it sits ------------------------------------
  const canon = await drive('canon', { pinRepoDir: '/canon' })
  assert.deepEqual(
    canon.cmds.filter((cmd) => cmd === MIRROR),
    [MIRROR],
    `exactly one mirror fetch, verbatim: ${JSON.stringify(canon.cmds)}`,
  )
  assert.equal(
    canon.cmds.indexOf(MIRROR),
    canon.cmds.indexOf(`git -C /r update-ref refs/fleet/${RUN_ID} ${TIP}`) + 1,
    `the mirror follows the local update-ref: ${JSON.stringify(canon.cmds)}`,
  )
  const mirrorNote = canon.notes.find((line) => line.includes('/canon'))
  assert.ok(mirrorNote, `a note names the canonical repo: ${JSON.stringify(canon.notes)}`)
  assert.ok(mirrorNote.includes('/r'), `and the repo it came from: ${mirrorNote}`)
  assert.ok(mirrorNote.includes(`refs/fleet/${RUN_ID}`), `and the ref: ${mirrorNote}`)
  assert.ok(
    canon.notes.some((line) => line.startsWith(`pinned run tip: refs/fleet/${RUN_ID} -> ${TIP}`)),
    `the #497 local pin is still narrated: ${JSON.stringify(canon.notes)}`,
  )
  assert.deepEqual(
    canon.detail.errors.filter((e) => e.includes('/canon')),
    [],
    `a mirror that succeeded records no error: ${JSON.stringify(canon.detail.errors)}`,
  )
  ok('(a) pinRepoDir mirrors refs/fleet/<runId> into the canonical repo, once, right after the local pin')

  // -- (b) the absent-flag sequence is byte-identical to BASE ---------------
  const omitted = await drive('omitted')
  assert.deepEqual(omitted.cmds, BASE_SEQUENCE, 'pinRepoDir omitted must issue exactly the BASE commands')
  const same = await drive('same', { pinRepoDir: '/r' })
  assert.deepEqual(same.cmds, BASE_SEQUENCE, 'pinRepoDir === repoDir must issue exactly the BASE commands')
  const withoutMirror = canon.cmds.filter((cmd) => cmd !== MIRROR)
  assert.deepEqual(withoutMirror, BASE_SEQUENCE, 'the canonical run adds the mirror and changes nothing else')
  assert.equal(canon.cmds.length, BASE_SEQUENCE.length + 1)
  ok('(b) omitted and self-valued pinRepoDir leave the exec sequence exactly as BASE left it')

  // -- (c) a failing mirror is recorded and never fatal ---------------------
  const failed = await drive('failed', { pinRepoDir: '/canon', exec: makeExec({ mirrorCode: 1 }) })
  assert.deepEqual(failed.cmds, canon.cmds, 'a failing mirror issues the same commands as a passing one')
  const failure = failed.detail.errors.find((e) => e.includes('/canon'))
  assert.ok(failure, `the failure is on the record: ${JSON.stringify(failed.detail.errors)}`)
  assert.ok(failure.includes(`refs/fleet/${RUN_ID}`), `and names the ref: ${failure}`)
  assert.ok(failure.includes('code 1'), `and the exit code: ${failure}`)
  assert.equal(failed.detail.status, 'gate-green', 'the run reached its terminal status anyway')
  assert.equal(failed.read.o1, true, 'and the read is untouched by a failed mirror')
  assert.ok(
    failed.notes.some((line) => line.startsWith(`pinned run tip: refs/fleet/${RUN_ID} -> ${TIP}`)),
    'the local pin still landed',
  )
  ok('(c) a mirror that fails lands in detail.errors naming the repo, and the drive completes')

  // -- (d) an unsafe path is refused, never interpolated --------------------
  const unsafe = await drive('unsafe', { pinRepoDir: '/bad path;x' })
  assert.deepEqual(unsafe.cmds, BASE_SEQUENCE, 'an unsafe pinRepoDir issues no command of its own')
  assert.equal(
    unsafe.cmds.some((cmd) => cmd.includes('bad path')),
    false,
    'and reaches no shell at all',
  )
  const refusal = unsafe.detail.errors.find((e) => e.includes('/bad path;x'))
  assert.ok(refusal, `the refusal is on the record: ${JSON.stringify(unsafe.detail.errors)}`)
  assert.equal(unsafe.detail.status, 'gate-green', 'and the drive completes')
  ok('(d) an unsafe pinRepoDir is refused and recorded, never interpolated')

  // -- (e) the CLI flag ------------------------------------------------------
  {
    const parsed = parseArgs(['plan', 'run-1', '--pin-repo-dir', '/p'])
    assert.equal(parsed.pinRepoDir, '/p')
    const built = buildDriveOptions(parsed, { readToken: () => 't', exec: async () => ({ code: 0, stdout: '' }) })
    assert.equal(built.pinRepoDir, '/p', 'buildDriveOptions forwards the flag')
    const bare = buildDriveOptions(parseArgs(['plan', 'run-1']), {
      readToken: () => 't',
      exec: async () => ({ code: 0, stdout: '' }),
    })
    assert.equal(bare.pinRepoDir, REPO_DIR, 'without the flag the CLI pins into the checkout it lives in')
    assert.equal(parseArgs(['plan', 'run-1']).pinRepoDir, REPO_DIR)
    assert.match(usage(), /--pin-repo-dir DIR/)
    ok('(e) --pin-repo-dir parses, rides buildDriveOptions, and defaults to REPO_DIR')
  }

  // -- (f) the mirror, for real ---------------------------------------------
  // Two real repos and a real sandbox stand-in: the ssh fetch is retargeted
  // onto a repo on disk and every other git command runs for real, so the
  // mirror `git -C canon fetch repo refs/fleet/run-1:refs/fleet/run-1` is
  // executed by git itself and read back with `rev-parse`.
  {
    const root = path.join(tmpRoot, 'real')
    const repoDir = path.join(root, 'repo')
    const sandboxRepo = path.join(root, 'sandbox')
    const canonDir = path.join(root, 'canon')
    fs.mkdirSync(repoDir, { recursive: true })
    fs.writeFileSync(path.join(repoDir, 'f.txt'), 'hi\n')
    const init = await sh(
      'git init -q -b main . && git config user.email t@example.com && git config user.name t && ' +
        'git add -A && git -c commit.gpgsign=false commit -q -m init',
      repoDir,
    )
    assert.equal(init.code, 0, `git init failed: ${init.stderr}`)
    assert.equal((await sh(`git clone -q "${repoDir}" "${sandboxRepo}"`, root)).code, 0)
    const branched = await sh(
      `git config user.email t@example.com && git config user.name t && git checkout -q -b ${BRANCH} && ` +
        'echo work > w.txt && git add -A && git -c commit.gpgsign=false commit -q -m work',
      sandboxRepo,
    )
    assert.equal(branched.code, 0, `sandbox branch failed: ${branched.stderr}`)
    const tip = (await sh('git rev-parse HEAD', sandboxRepo)).stdout.trim()
    assert.match(tip, /^[0-9a-f]{40}$/)
    assert.equal((await sh(`git init -q --bare "${canonDir}"`, root)).code, 0)

    const runId = 'run-1'
    const realExec = async (cmd) => {
      const fetched = cmd.match(/^git -C (\S+) -c core\.sshCommand="[^"]*" fetch ssh:\/\/\S+ (\S+)$/)
      if (fetched) return sh(`git -C "${fetched[1]}" fetch "${sandboxRepo}" ${fetched[2]}`)
      if (cmd.startsWith('git ')) return sh(cmd)
      if (/ exe\.dev "stat /.test(cmd)) return { code: 0, stdout: JSON.stringify({ points: [] }) }
      return { code: 0, stdout: '' }
    }
    realExec.cmds = []
    const wrapped = async (cmd, opts) => {
      realExec.cmds.push(cmd)
      return realExec(cmd, opts)
    }
    wrapped.cmds = realExec.cmds

    const real = await drive('real', { runId, repoDir, pinRepoDir: canonDir, exec: wrapped })
    assert.equal(
      (await sh(`git -C "${repoDir}" rev-parse refs/fleet/${runId}`)).stdout.trim(),
      tip,
      '#497: the local pin still names the fetched tip',
    )
    assert.equal(
      (await sh(`git -C "${canonDir}" rev-parse refs/fleet/${runId}`)).stdout.trim(),
      tip,
      `the canonical repo resolves the ref to the tip: ${JSON.stringify(real.detail.errors)}`,
    )
    assert.equal(
      (await sh(`git -C "${canonDir}" cat-file -e ${tip}`)).code,
      0,
      'and carries the object itself, not merely the name',
    )
    assert.ok(
      wrapped.cmds.includes(`git -C ${canonDir} fetch ${repoDir} refs/fleet/${runId}:refs/fleet/${runId}`),
      `the mirror is the ref-to-ref fetch: ${JSON.stringify(wrapped.cmds)}`,
    )
    assert.deepEqual(
      real.detail.errors.filter((e) => e.includes(canonDir)),
      [],
      `a real mirror records no error: ${JSON.stringify(real.detail.errors)}`,
    )
    ok('(f) the mirror really makes refs/fleet/run-1 resolve to the tip in the canonical repo')
  }
} finally {
  fs.rmSync(tmpRoot, { recursive: true, force: true })
}

// -- (g) the race pins into the launch checkout ------------------------------
{
  const LAUNCH_DIR = '/launch'
  const RACE_ID = 'race-pin'
  const evidenceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'race-pin-'))
  try {
    const git = async (args) => {
      if (args[0] === 'rev-parse') return `${'3f'.repeat(20)}\n`
      const asksOrigin =
        (args[0] === 'config' && args[1] === '--get' && args[2] === 'remote.origin.url') ||
        (args[0] === 'remote' && args[1] === 'get-url' && args[2] === 'origin')
      return asksOrigin ? 'https://github.com/x/y.git\n' : ''
    }
    const driveCalls = []
    const { results } = await launchRace(['docs/plan.md', RACE_ID, '--k', '3', '--repo-dir', LAUNCH_DIR], {
      drive: async (opts) => {
        driveCalls.push(opts)
        return { read: { runId: opts.runId }, reportPath: `/ev/${opts.runId}.md` }
      },
      git,
      evidenceDir,
      now: () => '2026-09-02T00:00:00.000Z',
      readToken: () => 'oauth-token-value\n',
      exec: () => {
        throw new Error('race-launch must not shell out')
      },
      stdout: () => {},
      stderr: () => {},
      progressSink: () => {},
    })
    assert.deepEqual(
      results.map((r) => r.status),
      ['fulfilled', 'fulfilled', 'fulfilled'],
    )
    assert.equal(driveCalls.length, 3)
    assert.deepEqual(
      driveCalls.map((opts) => opts.pinRepoDir),
      [LAUNCH_DIR, LAUNCH_DIR, LAUNCH_DIR],
      'every attempt pins into the launch checkout',
    )
    // The throwaway clones are exactly what must NOT hold the only copy.
    for (const opts of driveCalls) {
      assert.notEqual(opts.repoDir, opts.pinRepoDir, `${opts.runId} drives out of its own clone`)
    }
    ok('(g) launchRace pins every attempt into the launch checkout, never its throwaway clone')
  } finally {
    fs.rmSync(evidenceDir, { recursive: true, force: true })
  }
}

console.log('ALL TESTS PASSED')
