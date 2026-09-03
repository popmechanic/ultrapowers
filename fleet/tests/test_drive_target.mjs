// fleet/tests/test_drive_target.mjs — task 3 (#575): the orchestrator builds
// any target from its cache clone and publishes there.
//
// The claim: the orchestrator pushes the engine and the target to the sandbox
// as two refs, refuses a base that is not on GitHub before it spends a VM,
// and opens the pull request on the target's own repository.
//
// Leg -> machine clause:
//   (a) provisionRun: git init + engine push + target push, in order, between
//       the assignment delivery and the tunnel; no `engine` key; the shim
//       start checks out fleet-engine; symbolic shas refuse before any exec [M1]
//   (b) driveOne: a bad target or symbolic base refuses before any exec; the
//       four deleted options change nothing about the command sequence    [M2]
//   (c) a dirty engine checkout refuses, naming it and `clean`, before any
//       command reaches exe.dev                                            [M3]
//   (d) the cache clone: first-use clone (token in the env iff the file
//       exists), fetch on reuse, a base absent from origin refused          [M4]
//   (e) the engine identity: HEAD + manifest read before the first exe.dev
//       command, handed to provisionRun, cross-checked against the stamp    [M5]
//   (f) the plan is always shipped: any readable file, by basename, bytes
//       intact, never read out of git                                       [M6]
//   (g) the publish leg: fetch into refs/fleet/<runId>, rev-parse it, resolve
//       receipts, push from the cache clone, `gh pr create --repo` no base  [M7]
//   (h) the rescue card and the RUNBOOK spell the pin's home as the target's
//       cache clone                                                         [M8]
//   (i) the sandbox log pull renames target/ to repo/ on the way in         [M9]
//
// Nothing here provisions, shells to exe.dev or touches the network: the
// `_drive_helpers.mjs` fixture stubs every ssh, retargets the target's clone
// onto a bare repo on disk and the run-branch fetch onto a stand-in sandbox
// repo, and runs every other git verb for real.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { driveOne, GH_CREDENTIAL, cacheDirNameFor, renderPullRequestBody, sandboxLogPullCommand } from '../drive.mjs'
import { provisionRun, shimStartCommand, SANDBOX_SSH_OPTS, sandboxGitSsh } from '../provision.mjs'
import {
  CACHE_DIR_NAME,
  GITHUB_TOKEN,
  OLDER_BRANCH,
  TARGET,
  setupDriveFixture,
  sh,
} from './_drive_helpers.mjs'

let passed = 0
const ok = (label) => {
  passed += 1
  console.log(`ok - ${label}`)
}

const HERE = path.dirname(fileURLToPath(import.meta.url))
const RUNBOOK = path.join(HERE, '..', 'RUNBOOK.md')
const isExeDev = (cmd) => /exe\.dev|\.exe\.xyz/.test(cmd)

// A green drive on the fixture's OLDER branch — receipt `old.txt` at
// `olderSha`, which is exactly what that branch's commit introduced.
const greenDrive = async (fixture, { runId, overrides = {}, stamp = null, provision } = {}) => {
  const { tmp, olderSha, makeExec, startStubSandbox, driveDefaults } = fixture
  let sandbox = null
  const exec = makeExec((assignment) => {
    setTimeout(() => {
      sandbox = startStubSandbox({
        assignment,
        runId,
        receiptSha: olderSha,
        exec,
        branch: OLDER_BRANCH,
        receiptPath: 'old.txt',
        ...(stamp ? { stamp } : {}),
      })
    }, 30)
  })
  const result = await driveOne({
    ...driveDefaults,
    dbDir: path.join(tmp, `db-${runId}`),
    evidenceDir: path.join(tmp, `evidence-${runId}`),
    exec,
    runId,
    ...(provision ? { provision } : {}),
    ...overrides,
  })
  await sandbox
  return { ...result, exec }
}

// ---------------------------------------------------------------------------
// (a) M1: provisionRun's three sandbox writes, their order, and its refusals.
// ---------------------------------------------------------------------------
{
  const E = 'e'.repeat(40)
  const B = 'b'.repeat(40)
  const cmds = []
  const exec = async (cmd) => {
    cmds.push(cmd)
    return { code: 0, stdout: '{}' }
  }
  await provisionRun({
    golden: 'fleet-golden',
    runId: 'r1',
    engineDir: '/eng',
    engineSha: E,
    targetDir: '/tg/o--r',
    baseSha: B,
    ttlMs: 60000,
    wsUrl: 'ws://127.0.0.1:8151/fleet',
    port: 8151,
    planPath: 'p.md',
    exec,
    clock: () => 1000,
  })
  const deliveryIdx = cmds.findIndex((c) => c.includes('/home/exedev/fleet-run.json'))
  const tunnelIdx = cmds.findIndex((c) => / -fN -R /.test(c))
  const initIdx = cmds.indexOf(`ssh ${SANDBOX_SSH_OPTS} fleet-r1.exe.xyz 'git init -q /home/exedev/target'`)
  const engineIdx = cmds.indexOf(
    `git -C /eng -c core.sshCommand="${sandboxGitSsh}" push ssh://exedev@fleet-r1.exe.xyz/home/exedev/repo ${E}:refs/heads/fleet-engine`,
  )
  const targetIdx = cmds.indexOf(
    `git -C /tg/o--r -c core.sshCommand="${sandboxGitSsh}" push ssh://exedev@fleet-r1.exe.xyz/home/exedev/target ${B}:refs/heads/fleet-base`,
  )
  for (const [name, idx] of [['delivery', deliveryIdx], ['git init', initIdx], ['engine push', engineIdx], ['target push', targetIdx], ['tunnel', tunnelIdx]]) {
    assert.ok(idx >= 0, `the ${name} command is issued byte for byte, got: ${JSON.stringify(cmds)}`)
  }
  assert.ok(deliveryIdx < initIdx && initIdx < engineIdx && engineIdx < targetIdx && targetIdx < tunnelIdx, `order: delivery, init, engine, target, tunnel — got ${JSON.stringify(cmds)}`)
  const payload = JSON.parse(cmds[deliveryIdx].match(/<<'FLEET_EOF'\n([\s\S]*?)\nFLEET_EOF/)[1])
  assert.equal('engine' in payload, false, 'the delivered payload has no engine key')
  const start = shimStartCommand({ vmName: 'fleet-r1' })
  assert.ok(start.includes('checkout -q fleet-engine'), start)
  assert.ok(!start.includes('fleet-base'), start)
  assert.equal(cmds[cmds.length - 1], start, 'the shim start is the last command')

  for (const [label, override] of [['a symbolic base', { baseSha: 'HEAD' }], ['a symbolic engine', { engineSha: 'main' }]]) {
    const seen = []
    await assert.rejects(
      provisionRun({
        golden: 'fleet-golden', runId: 'r2', engineDir: '/eng', engineSha: E, targetDir: '/tg/o--r', baseSha: B,
        ttlMs: 60000, wsUrl: 'ws://127.0.0.1:8151/fleet', port: 8151, planPath: 'p.md',
        exec: async (cmd) => { seen.push(cmd); return { code: 0, stdout: '{}' } },
        clock: () => 1000,
        ...override,
      }),
      /isSafeSha/,
      label,
    )
    assert.deepEqual(seen, [], `${label}: refused before any exec`)
  }
  ok('(a) provisionRun issues init, engine push, target push in order; no engine key; fleet-engine checkout; symbolic shas refuse [M1]')
}

// ---------------------------------------------------------------------------
// (b) M2: entry refusals, and the deleted options are read by nothing.
// ---------------------------------------------------------------------------
{
  const fixture = await setupDriveFixture()
  try {
    const { tmp, driveDefaults } = fixture
    for (const [label, override, pattern] of [
      ['target with a space', { target: 'bad name' }, /must be <owner>\/<repo>/],
      ['target with two slashes', { target: 'a/b/c' }, /must be <owner>\/<repo>/],
      ['symbolic base', { baseSha: 'HEAD' }, /fails isSafeSha/],
    ]) {
      const cmds = []
      await assert.rejects(
        driveOne({
          ...driveDefaults,
          ...override,
          dbDir: path.join(tmp, 'db-b-refuse'),
          runId: 'run-b-refuse',
          exec: async (cmd) => { cmds.push(cmd); return { code: 0, stdout: '' } },
        }),
        pattern,
        label,
      )
      assert.deepEqual(cmds, [], `${label}: refused before any exec`)
      assert.equal(fs.existsSync(path.join(tmp, 'db-b-refuse')), false, `${label}: before the orchestrator start`)
    }
  } finally {
    fixture.cleanup()
  }

  // Two full green runs with the same runId, each against a fresh copy of the
  // fixture, one passing every deleted option and one passing none: the
  // recorded command sequences deep-equal once the per-copy temp root, the
  // minted token, the ephemeral port and the log-pull stamp are normalised —
  // the only four things two fresh fixtures cannot share.
  const normalize = (cmds, root) =>
    cmds.map((cmd) =>
      cmd
        .split(root).join('<root>')
        .replace(/"token":"[0-9a-f]{64}"/g, '"token":"<tok>"')
        .replace(/\b[0-9a-f]{40}\b/g, '<sha>')
        .replace(/ws:\/\/127\.0\.0\.1:\d+/g, 'ws://127.0.0.1:<port>')
        .replace(/-R \d+:127\.0\.0\.1:\d+/g, '-R <port>:127.0.0.1:<port>')
        .replace(/\[-\]R \d+:127\.0\.0\.1:\d+/g, '[-]R <port>:127.0.0.1:<port>')
        .replace(/(\/fleet-[A-Za-z0-9-]+)-\d+\//, '$1-<ts>/'),
    )
  const sequences = []
  for (const overrides of [{ pinRepoDir: '/nope', prBase: 'x', planSource: 'assignment', baseRef: 'nope' }, {}]) {
    const fixture = await setupDriveFixture()
    try {
      const { read, exec } = await greenDrive(fixture, { runId: 'run-b-same', overrides })
      assert.equal(read.o1, true, `the ${Object.keys(overrides).length ? 'with-deleted' : 'plain'} drive is green: ${JSON.stringify(read)}`)
      sequences.push(normalize(exec.cmds, fixture.tmp))
    } finally {
      fixture.cleanup()
    }
  }
  assert.deepEqual(sequences[0], sequences[1], 'pinRepoDir, prBase, planSource and baseRef are read by nothing')
  ok('(b) a bad target or symbolic base refuses before any exec; the four deleted options change no command [M2]')
}

// ---------------------------------------------------------------------------
// (c) M3: a dirty engine checkout refuses before anything reaches exe.dev.
// ---------------------------------------------------------------------------
{
  const fixture = await setupDriveFixture()
  try {
    const { tmp, repoDir, driveDefaults, makeExec } = fixture
    const stray = path.join(repoDir, 'uncommitted.txt')
    fs.writeFileSync(stray, 'not in HEAD\n')
    const exec = makeExec(() => assert.fail('no sandbox may start behind a dirty engine checkout'))
    await assert.rejects(
      driveOne({ ...driveDefaults, dbDir: path.join(tmp, 'db-c'), exec, runId: 'run-c-dirty' }),
      (error) => {
        assert.ok(error.message.includes(repoDir), `names the checkout: ${error.message}`)
        assert.ok(error.message.includes('clean'), `names the remedy: ${error.message}`)
        return true
      },
    )
    assert.ok(!exec.cmds.some(isExeDev), `no command addressed to exe.dev, got: ${JSON.stringify(exec.cmds)}`)
    assert.equal(fs.existsSync(path.join(tmp, 'db-c')), false, 'refusal precedes the orchestrator start')
    fs.rmSync(stray)
  } finally {
    fixture.cleanup()
  }
  ok('(c) a dirty engine checkout refuses, naming it and `clean`, with no exe.dev command [M3]')
}

// ---------------------------------------------------------------------------
// (d) M4: the cache clone — first use, reuse, and a base origin lacks.
// ---------------------------------------------------------------------------
{
  const fixture = await setupDriveFixture()
  try {
    const { tmp, targetsDir, unreachableSha, driveDefaults, makeExec } = fixture
    const cloneCmd = (target) =>
      `git ${GH_CREDENTIAL} clone https://github.com/${target}.git ${path.join(targetsDir, cacheDirNameFor(target))}`
    // Stops at the provision hop: the cache legs are what is under test.
    const toProvision = async ({ runId, overrides = {} }) => {
      const exec = makeExec(() => {})
      let seen = null
      await driveOne({
        ...driveDefaults,
        dbDir: path.join(tmp, `db-${runId}`),
        exec,
        runId,
        provision: async (options) => { seen = options; throw new Error('stop-at-provision') },
        ...overrides,
      })
      assert.ok(seen, `${runId}: the provision hop was reached`)
      return exec
    }

    // First run, token present: the clone, byte for byte, with GH_TOKEN in
    // its env and nowhere on its command line.
    const first = await toProvision({ runId: 'run-d-first', overrides: { target: 'octo/gadgets' } })
    const clone = first.calls.find((c) => c.cmd === cloneCmd('octo/gadgets'))
    assert.ok(clone, `the first-use clone is issued byte for byte, got: ${JSON.stringify(first.cmds.filter((c) => / clone /.test(c)))}`)
    assert.equal(clone.env?.GH_TOKEN, GITHUB_TOKEN, 'the token rides the clone env')
    assert.ok(!clone.cmd.includes(GITHUB_TOKEN), 'and never its command line')
    assert.ok(fs.existsSync(path.join(targetsDir, 'octo--gadgets', '.git')), 'the cache clone is real')

    // First run, token ABSENT: the same command, an env with no GH_TOKEN key.
    const anon = await toProvision({ runId: 'run-d-anon', overrides: { target: 'octo/gizmos', githubTokenPath: path.join(tmp, 'no-such-token') } })
    const anonClone = anon.calls.find((c) => c.cmd === cloneCmd('octo/gizmos'))
    assert.ok(anonClone, 'the anonymous clone is the same command')
    assert.equal('GH_TOKEN' in (anonClone.env ?? {}), false, `no token file → no GH_TOKEN key: ${JSON.stringify(anonClone.env)}`)

    // Second run of the first target: fetch, never clone.
    const second = await toProvision({ runId: 'run-d-second', overrides: { target: 'octo/gadgets' } })
    assert.ok(second.cmds.includes(`git -C ${path.join(targetsDir, 'octo--gadgets')} ${GH_CREDENTIAL} fetch origin`), `the cache is fetched, credentialed: ${JSON.stringify(second.cmds)}`)
    assert.ok(!second.cmds.some((c) => / clone /.test(c)), 'and never re-cloned')

    // A real sha that origin does not hold: refused with the remedy and the
    // sha, and nothing addressed to exe.dev.
    {
      const exec = makeExec(() => assert.fail('no sandbox may start behind an absent base'))
      await assert.rejects(
        driveOne({ ...driveDefaults, baseSha: unreachableSha, dbDir: path.join(tmp, 'db-d-absent'), exec, runId: 'run-d-absent' }),
        (error) => {
          assert.ok(error.message.includes('push'), `names the remedy: ${error.message}`)
          assert.ok(error.message.includes(unreachableSha), `names the base: ${error.message}`)
          return true
        },
      )
      assert.ok(exec.cmds.some((c) => c.endsWith(`cat-file -e ${unreachableSha}^{commit}`)), `the cache was asked: ${JSON.stringify(exec.cmds)}`)
      assert.ok(!exec.cmds.some(isExeDev), `no command addressed to exe.dev, got: ${JSON.stringify(exec.cmds)}`)
      assert.equal(fs.existsSync(path.join(tmp, 'db-d-absent')), false, 'refusal precedes the orchestrator start')
    }
  } finally {
    fixture.cleanup()
  }
  ok('(d) first-use clone with the token in the env iff present, fetch on reuse, absent base refused before any VM [M4]')
}

// ---------------------------------------------------------------------------
// (e) M5: the engine identity — read first, pushed, cross-checked.
// ---------------------------------------------------------------------------
{
  const fixture = await setupDriveFixture()
  try {
    const { repoDir, cacheDir, headSha, driveDefaults } = fixture
    const provisionCalls = []
    const provision = async (options) => {
      provisionCalls.push(options)
      return provisionRun(options)
    }
    const { read, exec } = await greenDrive(fixture, { runId: 'run-e-green', provision })
    assert.equal(read.o1, true, JSON.stringify(read))
    assert.equal(read.versionStamp, true, 'the stamp check is green against the engine checkout')
    const firstExeDev = exec.cmds.findIndex(isExeDev)
    const headIdx = exec.cmds.indexOf(`git -C ${repoDir} rev-parse HEAD`)
    const manifestIdx = exec.cmds.indexOf(`git -C ${repoDir} show HEAD:.claude-plugin/plugin.json`)
    assert.ok(headIdx >= 0 && manifestIdx >= 0, `both engine reads are issued: ${JSON.stringify(exec.cmds.slice(0, 8))}`)
    assert.ok(firstExeDev > headIdx && firstExeDev > manifestIdx, 'both precede the first exe.dev command')
    assert.equal(provisionCalls.length, 1)
    assert.equal(provisionCalls[0].engineDir, repoDir)
    assert.equal(provisionCalls[0].engineSha, headSha)
    assert.equal(provisionCalls[0].targetDir, cacheDir)
    assert.equal(provisionCalls[0].baseSha, driveDefaults.baseSha)

    const wrongSha = await greenDrive(fixture, { runId: 'run-e-wrong-sha', stamp: { pluginVersion: '9.9.9', engineSha: 'deadbeef'.repeat(5) } })
    assert.equal(wrongSha.read.versionStamp, false, 'a sandbox stamping another sha reads red')
    assert.ok(wrongSha.detail.errors.some((e) => /version stamp mismatch/.test(e) && e.includes(headSha)), JSON.stringify(wrongSha.detail.errors))

    const wrongVersion = await greenDrive(fixture, { runId: 'run-e-wrong-version', stamp: { pluginVersion: '0.0.0', engineSha: headSha } })
    assert.equal(wrongVersion.read.versionStamp, false, 'the right sha with the wrong manifest version reads red')
  } finally {
    fixture.cleanup()
  }
  ok('(e) HEAD and the manifest are read before exe.dev, handed to provisionRun, and cross-checked against the stamp [M5]')
}

// ---------------------------------------------------------------------------
// (f) M6: the plan is always shipped — any file, by basename, bytes intact.
// ---------------------------------------------------------------------------
{
  const fixture = await setupDriveFixture()
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-plan-outside-'))
  try {
    const { tmp, driveDefaults, makeExec } = fixture
    const planFile = path.join(outside, 'deep', '2026-09-02-anywhere.md')
    const PLAN =
      '# Anywhere\n\n### Task 1: Code\n**Type:** implementation\n**Depends-on:** none\n\n**Files:**\n- Modify: `fleet/x.mjs`\n- Test: `fleet/tests/test_x.mjs`\n\n- [ ] **Step 1: edit**\n'
    fs.mkdirSync(path.dirname(planFile), { recursive: true })
    fs.writeFileSync(planFile, PLAN)
    const exec = makeExec(() => {})
    let seen = null
    await driveOne({
      ...driveDefaults,
      planPath: planFile,
      dbDir: path.join(tmp, 'db-f'),
      exec,
      runId: 'run-f-plan',
      provision: async (options) => { seen = options; throw new Error('stop-at-provision') },
    })
    assert.ok(seen, 'the provision hop was reached')
    assert.equal(seen.planPath, '2026-09-02-anywhere.md', 'the payload names the basename')
    assert.equal(seen.plan.text, PLAN, "the file's bytes are what ships")
    assert.ok(!exec.cmds.some((c) => / show \S+:\S*\.md/.test(c)), `no command reads a plan out of git: ${JSON.stringify(exec.cmds.filter((c) => / show /.test(c)))}`)
  } finally {
    fixture.cleanup()
    fs.rmSync(outside, { recursive: true, force: true })
  }
  ok('(f) a plan file outside every repo ships by basename, bytes intact, never read out of git [M6]')
}

// ---------------------------------------------------------------------------
// (g) M7: the publish leg, from the cache clone, with the fetch as the pin.
// ---------------------------------------------------------------------------
{
  const fixture = await setupDriveFixture()
  try {
    const { tmp, cacheDir, olderSha, originRepo } = fixture
    const runId = 'run-g-publish'
    const { read, detail, exec } = await greenDrive(fixture, { runId })
    assert.equal(read.o1, true, JSON.stringify(read))
    const fetchCmd = `git -C ${cacheDir} -c core.sshCommand="${sandboxGitSsh}" fetch ssh://exedev@fleet-${runId}.exe.xyz/home/exedev/target +${OLDER_BRANCH}:refs/fleet/${runId}`
    const revParse = `git -C ${cacheDir} rev-parse refs/fleet/${runId}`
    const deref = `git -C ${cacheDir} cat-file -e ${olderSha}:old.txt`
    const push = `git -C ${cacheDir} -c credential.helper= -c credential.helper='!gh auth git-credential' push origin ${olderSha}:refs/heads/${OLDER_BRANCH}`
    for (const cmd of [fetchCmd, revParse, deref, push]) {
      assert.ok(exec.cmds.includes(cmd), `expected byte for byte: ${cmd}\ngot: ${JSON.stringify(exec.cmds.filter((c) => /fetch|rev-parse|cat-file|push/.test(c)))}`)
    }
    const gh = exec.cmds.find((c) => c.startsWith(`cd '${cacheDir}' && gh pr create --repo ${TARGET} --head ${OLDER_BRANCH} `))
    assert.ok(gh, `gh pr create on the target's repo from the cache clone, got: ${JSON.stringify(exec.cmds.filter((c) => / gh /.test(c)))}`)
    assert.equal(detail.pullRequest?.number, 4242)
    // The tip the drive pinned is what the ref answers on disk, and what origin holds.
    const onDisk = (await sh(`git -C "${cacheDir}" rev-parse refs/fleet/${runId}`)).stdout.trim()
    assert.equal(onDisk, olderSha, 'the fetch really wrote refs/fleet/<runId>')
    assert.equal((await sh(`git -C "${originRepo}" rev-parse refs/heads/${OLDER_BRANCH}`)).stdout.trim(), olderSha, 'the push really landed on origin')
    // After provisioning — the two pushes and the shim start that checks the
    // engine out of `/home/exedev/repo` — nothing names FETCH_HEAD, update-ref,
    // a base branch, or the engine clone's sandbox path: the run comes back
    // from `/home/exedev/target`, and only from there.
    const lastProvisionPush = exec.cmds.map((c, i) => [c, i]).filter(([c]) => / push ssh:\/\//.test(c)).map(([, i]) => i).pop()
    assert.ok(lastProvisionPush >= 0, 'the provisioning pushes were issued')
    const shimStart = exec.cmds.findIndex((c, i) => i > lastProvisionPush && /nohup node .*shim-main\.mjs/.test(c))
    assert.ok(shimStart > lastProvisionPush, 'the shim start follows the pushes')
    const after = exec.cmds.slice(shimStart + 1)
    for (const needle of ['FETCH_HEAD', 'update-ref', ' --base ', '/home/exedev/repo ']) {
      assert.ok(!after.some((c) => c.includes(needle)), `${JSON.stringify(needle)} appears after the provisioning pushes: ${JSON.stringify(after.filter((c) => c.includes(needle)))}`)
    }
    assert.ok(exec.cmds.some((c) => c === `git -C ${cacheDir} cat-file -e ${olderSha}`), 'the receipt sha is checked in the cache clone')
    assert.ok(!fs.existsSync(path.join(tmp, 'repo', '.git', 'refs', 'fleet')), 'the engine checkout carries no run refs')
  } finally {
    fixture.cleanup()
  }
  ok('(g) fetch into refs/fleet/<runId>, rev-parse it, resolve receipts, push and open the PR from the cache clone with no base [M7]')
}

// ---------------------------------------------------------------------------
// (h) M8: the rescue card and the RUNBOOK name the target's cache clone.
// ---------------------------------------------------------------------------
{
  const RUN_ID = 'run-9'
  const BRANCH = 'ultra/integration-run-9'
  const HOST = 'fleet-orchestrator.exe.xyz'
  const TIP = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'
  const body = renderPullRequestBody({
    runId: RUN_ID,
    planPath: 'p.md',
    branch: BRANCH,
    vmName: `fleet-${RUN_ID}`,
    parked: true,
    receipt: { verdict: 'NEEDS_ACK', gateCheck: { verdict: 'NEEDS_ACK', checks: [], acks: [] } },
    receiptSource: `${TIP}:fleet-receipts/${RUN_ID}/gate-receipt.json`,
    read: { o1: false, receiptsResolvable: false, leaseContinuity: true, versionStamp: true, spendObservational: { reported: 1, ledger: 1 } },
    receipts: [],
    closes: [],
    errors: [`push ${BRANCH} to origin failed (code 128) fatal: no workflow scope`],
    rescue: { runId: RUN_ID, tip: TIP, branch: BRANCH, host: HOST, target: 'octo/widgets' },
  })
  const block = body.slice(body.indexOf('```bash\n') + 8, body.indexOf('```', body.indexOf('```bash\n') + 8))
  const lines = block.split('\n')
  assert.equal(lines[1], `ssh ${HOST} 'cd /home/exedev/targets/octo--widgets && git rev-parse refs/fleet/${RUN_ID}'`, block)
  assert.equal(lines[4], `git fetch ssh://exedev@${HOST}/home/exedev/targets/octo--widgets refs/fleet/${RUN_ID}:refs/heads/${BRANCH}`, block)
  assert.ok(!block.includes('/home/exedev/repo'), block)

  const runbook = fs.readFileSync(RUNBOOK, 'utf8')
  const triage = runbook.slice(runbook.indexOf('## Park triage'), runbook.indexOf('## Teardown guarantee'))
  const fence = triage.slice(triage.indexOf('```bash'), triage.indexOf('```', triage.indexOf('```bash') + 7))
  assert.ok(fence.includes('cd /home/exedev/targets/<owner>--<repo> && git rev-parse refs/fleet/run-<N>'), fence)
  assert.ok(fence.includes('ssh://exedev@fleet-orchestrator.exe.xyz/home/exedev/targets/<owner>--<repo> refs/fleet/run-<N>:'), fence)
  ok('(h) the rescue card and §Park triage spell the pin\'s home as /home/exedev/targets/<owner>--<repo> [M8]')
}

// ---------------------------------------------------------------------------
// (i) M9: the log pull renames the target's run dirs to the repo/ prefix.
// ---------------------------------------------------------------------------
{
  const cmd = sandboxLogPullCommand({ vmName: 'fleet-r1', dest: '/d' })
  assert.ok(cmd.includes(`--transform 's,^target/,repo/,'`), cmd)
  assert.ok(cmd.includes(`--exclude="target/.claude/ultrapowers/run-*/clones"`), cmd)
  assert.ok(cmd.includes('cd target && ls -d .claude/ultrapowers/run-*/'), cmd)
  assert.ok(!cmd.replace(`--transform 's,^target/,repo/,'`, '').includes('repo/.claude'), `repo/.claude appears outside the transform: ${cmd}`)
  assert.ok(cmd.includes('fleet-r1.exe.xyz') && cmd.includes(' > /d '), cmd)
  ok('(i) sandboxLogPullCommand tars target/ as repo/ and excludes the clones [M9]')
}

// The fixture's own cache-dir name is the driver's spelling.
assert.equal(CACHE_DIR_NAME, cacheDirNameFor(TARGET))

console.log(`\nALL TESTS PASSED (${passed})`)
