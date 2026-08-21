// fleet/tests/test_drive.mjs — sentinel-style spec for the W1 drive-one driver.
//
// Concurrency-safe by construction: port 8153 is reserved for this file alone
// (8151-8159 is the fleet test range), and every byte of state — the throwaway
// git repos, the orchestrator's sqlite dir, the gate-read report — lives under
// an `fs.mkdtemp` directory unique to this process. No shared fixtures.
//
// The sandbox VM is simulated; nothing about the *verification* is. Two REAL
// git repos stand in for the two ends of the transport — `repoDir` is the
// orchestrator-side checkout, `sandboxRepo` is the sandbox's `/home/exedev/repo`
// — and the driver's fetch is retargeted from the ssh URL onto the second one
// and executed for real. So `FETCH_HEAD` is a real ref, and every receipt is
// resolved by a real `git cat-file -e` plus a real
// `git merge-base --is-ancestor <sha> FETCH_HEAD`. The three ways that can fail
// (absent sha, present-but-unreachable sha, wrong branch) each get a scenario.
//
// Scenario 1 drives the PRODUCTION sandbox entrypoint — `shim-main.mjs`'s
// `main()` — not a hand-rolled stand-in, so the receipts rows and the
// integration-branch name under test are written by the code that will write
// them in a live run. Only the engine invocation itself is stubbed.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { WebSocket } from 'ws'
import { createMergeableStore } from 'tinybase'
import { createWsSynchronizer } from 'tinybase/synchronizers/synchronizer-ws-client'
import { driveOne } from '../drive.mjs'
import { runShim } from '../shim.mjs'
import {
  applyBranch,
  applyReceipt,
  auxStoreId,
  applyReportedTokens,
  applyStamp,
  detectIntegrationBranch,
  findReceiptFiles,
  main as shimMain,
  readAssignment,
  readGateGreen,
  readReportTokens,
  readStamp,
  sandboxIdFor,
} from '../shim-main.mjs'

const PORT = 8153

// A frozen clock. Every claim/guard decision in the fleet is a pure function of
// it, so freezing removes all wall-clock flake from lease continuity; the
// driver's own timeouts deliberately use wall time and are unaffected.
const T = 2_000_000
const clock = () => T

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-drive-'))
const repoDir = path.join(tmp, 'repo')
const sandboxRepo = path.join(tmp, 'sandbox-repo')
const cleanup = () => fs.rmSync(tmp, { recursive: true, force: true })
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// The engine integrates to `ultra/integration-<stamp>` and never to a name the
// fleet chose — these are the two such branches the stand-in sandbox carries.
const INTEGRATION_BRANCH = 'ultra/integration-20260821125904'
const OLDER_BRANCH = 'ultra/integration-19990101000000'
const RECEIPT_PATH = '.claude/ultrapowers/run-20260821125904/gate-receipt.json'
const REPORT_PATH = '.claude/ultrapowers/fleet-run/report.json'

// Real shell execution, used for the git commands the spec insists must be real.
const sh = (cmd, cwd) =>
  new Promise((resolve) => {
    execFile('/bin/sh', ['-c', cmd], { cwd }, (error, stdout, stderr) =>
      resolve({
        code: typeof error?.code === 'number' ? error.code : error ? 1 : 0,
        stdout: stdout ?? '',
        // Kept off `stdout` so command output stays exactly what git printed;
        // it is here only to make a failed fixture command legible.
        stderr: stderr ?? '',
      }),
    )
  })

const writeFile = (root, rel, contents) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
  fs.writeFileSync(path.join(root, rel), contents)
}

try {
  // -- the orchestrator-side checkout: a real one-commit repo ----------------
  fs.mkdirSync(repoDir, { recursive: true })
  writeFile(repoDir, '.claude-plugin/plugin.json', JSON.stringify({ version: '9.9.9' }))
  writeFile(repoDir, 'f.txt', 'hi\n')
  const init = await sh(
    'git init -q -b main . && git config user.email t@example.com && git config user.name t && ' +
      'git add -A && git -c commit.gpgsign=false commit -q -m init',
    repoDir,
  )
  assert.equal(init.code, 0, `git init/commit failed: ${init.stderr}`)
  const headSha = (await sh('git rev-parse HEAD', repoDir)).stdout.trim()
  assert.match(headSha, /^[0-9a-f]{40}$/, 'the test fixture must produce a real 40-hex commit sha')

  // -- the stand-in sandbox repo --------------------------------------------
  // A real clone carrying two `ultra/integration-*` branches with explicit,
  // far-apart committer dates, so `--sort=-committerdate` has an unambiguous
  // winner. The newest one carries the machine-written gate receipt the engine
  // leaves behind.
  const cloned = await sh(`git clone -q "${repoDir}" "${sandboxRepo}"`, tmp)
  assert.equal(cloned.code, 0, `git clone failed: ${cloned.stderr}`)
  await sh('git config user.email t@example.com && git config user.name t', sandboxRepo)

  await sh(`git checkout -q -b ${OLDER_BRANCH}`, sandboxRepo)
  writeFile(sandboxRepo, 'old.txt', 'old\n')
  const older = await sh(
    "git add -A && GIT_COMMITTER_DATE='2020-01-01T00:00:00Z' git -c commit.gpgsign=false commit -q -m older",
    sandboxRepo,
  )
  assert.equal(older.code, 0, `older-branch commit failed: ${older.stderr}`)
  const olderSha = (await sh('git rev-parse HEAD', sandboxRepo)).stdout.trim()

  await sh(`git checkout -q main && git checkout -q -b ${INTEGRATION_BRANCH}`, sandboxRepo)
  writeFile(sandboxRepo, RECEIPT_PATH, JSON.stringify({ verdict: 'PASS', gate: 'ultra_gate' }))
  const integrated = await sh(
    "git add -A && GIT_COMMITTER_DATE='2030-01-01T00:00:00Z' git -c commit.gpgsign=false commit -q -m integration",
    sandboxRepo,
  )
  assert.equal(integrated.code, 0, `integration commit failed: ${integrated.stderr}`)
  const integrationSha = (await sh('git rev-parse HEAD', sandboxRepo)).stdout.trim()
  assert.notEqual(integrationSha, olderSha)

  // The engine's run report. It lives under `.claude/ultrapowers/fleet-run/`,
  // NOT under a `run-*` directory, so receipt discovery must not pick it up.
  writeFile(sandboxRepo, REPORT_PATH, JSON.stringify({ usage: { outputTokens: 4200 } }))

  // -- a sha that EXISTS locally but is reachable from no fetched branch -----
  // Built with `commit-tree` so it never touches a working tree: `cat-file -e`
  // will find it, `merge-base --is-ancestor` against FETCH_HEAD will not.
  const dangling = await sh("git commit-tree 'HEAD^{tree}' -p HEAD -m unreachable", repoDir)
  const unreachableSha = dangling.stdout.trim()
  assert.match(unreachableSha, /^[0-9a-f]{40}$/, `commit-tree failed: ${dangling.stderr}`)
  await sh(`git branch fleet-unreachable ${unreachableSha}`, repoDir)

  // -- shared exec stub ------------------------------------------------------
  // ssh never happens, and `git push` would need it, so that leg is stubbed
  // green. The FETCH leg is real — retargeted from the sandbox's ssh URL onto
  // the stand-in sandbox repo on disk — which is what makes FETCH_HEAD a real
  // ref and reachability a real answer. Every other git command runs for real.
  const makeExec = (onShimStart) => {
    const cmds = []
    const exec = async (cmd) => {
      cmds.push(cmd)
      if (cmd.startsWith('ssh ')) {
        const payload = cmd.match(/<<'FLEET_EOF'\n([\s\S]*?)\nFLEET_EOF/)
        if (payload) exec.delivered = JSON.parse(payload[1])
        if (/nohup node .*shim-main\.mjs/.test(cmd)) onShimStart(exec.delivered)
        return { code: 0, stdout: '{}' }
      }
      if (/^git -C \S+ push /.test(cmd)) return { code: 0, stdout: '' }
      const fetched = cmd.match(/^git -C (\S+) fetch ssh:\/\/\S+ (\S+)$/)
      if (fetched) return sh(`git -C "${fetched[1]}" fetch "${sandboxRepo}" ${fetched[2]}`)
      if (cmd.startsWith('git ')) return sh(cmd)
      return { code: 0, stdout: '' }
    }
    exec.cmds = cmds
    exec.delivered = null
    return exec
  }

  // A hand-rolled stand-in sandbox, used only where the receipt must carry a
  // sha production code would never write (an absent one, an unreachable one).
  // It is a real `runShim` against the driver's own orchestrator, over the real
  // ws transport, holding a real claim, using shim-main's own store writers.
  const startStubSandbox = ({ assignment, runId, receiptSha, exec, branch = INTEGRATION_BRANCH }) => {
    const sandboxId = sandboxIdFor(runId)
    return (async () => {
      // Distinct store id — see shim-main's `auxStoreId`: two live
      // MergeableStores sharing an id mint colliding HLCs and lose writes.
      const store = createMergeableStore(auxStoreId(sandboxId))
      const socket = new WebSocket(`${assignment.wsUrl}?token=${assignment.token}`)
      const synchronizer = await createWsSynchronizer(store, socket)
      await synchronizer.startSync()

      const stamp = await readStamp({ repoDir, exec })
      // Stamped before the run so a crashed run still carries its identity, and
      // again after, because `runShim`'s status `setRow` replaces the whole row
      // and can drop cells it has not yet synced.
      applyStamp(store, runId, stamp)

      const outcome = await runShim({
        wsUrl: assignment.wsUrl,
        token: assignment.token,
        sandboxId,
        runId,
        ttlMs: assignment.ttlMs,
        clock,
        invokeRun: async () => {
          applyReceipt(store, runId, 'gate', { sha: receiptSha, path: 'gate-receipt.json', verdict: 'PASS' })
          // A real run takes minutes; this one must at least take a tick. The
          // shim's teardown does not await its synchronizer, so a run that
          // resolves inside the same tick it started leaves `running`,
          // `gate-green` and the spend row un-flushed and they never reach the
          // orchestrator at all. Sleeping here keeps the harness faithful to
          // the timescale the shim is actually written against.
          await sleep(250)
          return { gateGreen: true }
        },
        readReportTokens: () => 4200,
      })

      // Published AFTER the run, exactly as `main()` does: `runShim`'s status
      // writes replace the whole row from their own synced view.
      applyBranch(store, runId, branch)
      applyStamp(store, runId, stamp)
      applyReportedTokens(store, runId, 4200)
      await synchronizer.save()
      await synchronizer.stopSync()
      await synchronizer.destroy()
      return outcome
    })()
  }

  const driveDefaults = {
    planPath: 'docs/superpowers/plans/example.md',
    golden: 'fleet-golden',
    port: PORT,
    repoDir,
    clock,
    ttlMs: 60_000,
    tickMs: 25,
    settleMs: 1_200,
    heartbeatTimeoutMs: 20_000,
  }

  // -- 1. the happy path, driven by the PRODUCTION sandbox entrypoint --------
  {
    const runId = 'run-drive-1'
    let sandbox = null
    const exec = makeExec((assignment) => {
      // The provisioner's shim start is a detached `nohup … &`, so the sandbox
      // comes up AFTER the command returns — exactly as it does live.
      setTimeout(() => {
        const assignmentPath = path.join(tmp, `assignment-${runId}.json`)
        fs.writeFileSync(assignmentPath, JSON.stringify(assignment))
        // `main()` itself: it reads the assignment the provisioner delivered,
        // stamps, claims, runs, then detects the integration branch and writes
        // the receipts rows. Only the engine launch is replaced.
        sandbox = shimMain({
          assignmentPath,
          repoDir: sandboxRepo,
          exec: (cmd) => sh(cmd),
          invokeRun: async () => {
            await sleep(250)
            return { gateGreen: true }
          },
        })
      }, 30)
    })

    const { read, reportPath, detail } = await driveOne({
      ...driveDefaults,
      dbDir: path.join(tmp, 'db1'),
      exec,
      runId,
    })
    // The sandbox's own verdict, so a red read is never ambiguous between "the
    // shim failed" and "the driver misread a good run".
    assert.deepEqual(await sandbox, { status: 'gate-green' })

    // The §W1d gate read, asserted by FULL equality — the contract is these five
    // keys and nothing else, so an added or renamed key fails here.
    assert.deepEqual(read, {
      o1: true,
      receiptsResolvable: true,
      leaseContinuity: true,
      versionStamp: true,
      spendObservational: { reported: 4200, ledger: 4200 },
    })

    // The report file round-trips to the same object.
    assert.deepEqual(JSON.parse(fs.readFileSync(reportPath, 'utf8')), read)

    // The run walked its whole legal path with the guard watching and nothing
    // was converged away. This is the regression pin for change-driven
    // sweeping: on a tick-only sweep the shim's same-tick `claimed`+`running`
    // writes collapse to an illegal `pending -> running`, the guard reverts the
    // run to `pending`, and the driver times out here instead.
    assert.equal(detail.status, 'gate-green')
    assert.equal(detail.timedOut, false)
    assert.deepEqual(detail.convergedAway, [])
    assert.deepEqual(detail.pages, [])

    // PRODUCTION `main()` wrote the receipts row: one row per machine-written
    // gate receipt, pointing at the integration branch tip and at the receipt's
    // repo-relative path, carrying the receipt file's own verdict.
    assert.deepEqual(detail.receipts, [
      {
        rowId: `${runId}:gate`,
        sha: integrationSha,
        path: RECEIPT_PATH,
        verdict: 'PASS',
        exists: true,
        reachable: true,
        resolved: true,
      },
    ])

    // The branch leg: the driver fetched the branch the run ACTUALLY integrated
    // to — detected from the sandbox's own refs — and never the `fleet-run`
    // fallback.
    assert.ok(
      exec.cmds.includes(
        `git -C ${repoDir} fetch ssh://exedev@fleet-${runId}.exe.xyz/home/exedev/repo ${INTEGRATION_BRANCH}`,
      ),
      `expected a fetch of ${INTEGRATION_BRANCH}, got: ${JSON.stringify(exec.cmds)}`,
    )
    assert.ok(
      !exec.cmds.some((cmd) => / fleet-run$/.test(cmd)),
      `the fleet-run fallback must never be fetched, got: ${JSON.stringify(exec.cmds)}`,
    )

    // The run branch was fetched before any sha was verified, and the sha was
    // verified with a real existence pre-check AND a real reachability check
    // against the fetched branch.
    const fetchIdx = exec.cmds.findIndex((c) => /^git -C \S+ fetch ssh:\/\/exedev@fleet-run-drive-1\.exe\.xyz/.test(c))
    const catIdx = exec.cmds.findIndex((c) => c === `git -C ${repoDir} cat-file -e ${integrationSha}`)
    const ancIdx = exec.cmds.findIndex(
      (c) => c === `git -C ${repoDir} merge-base --is-ancestor ${integrationSha} FETCH_HEAD`,
    )
    assert.ok(fetchIdx >= 0, `expected a run-branch fetch, got: ${JSON.stringify(exec.cmds)}`)
    assert.ok(catIdx >= 0, `expected a cat-file on the receipt sha, got: ${JSON.stringify(exec.cmds)}`)
    assert.ok(ancIdx >= 0, `expected a reachability check on the receipt sha, got: ${JSON.stringify(exec.cmds)}`)
    assert.ok(fetchIdx < catIdx, 'the branch must be fetched before its receipts are resolved')
    assert.ok(fetchIdx < ancIdx, 'reachability is decided against the FETCHED branch')

    // The sandbox is always torn down.
    assert.ok(
      exec.cmds.includes(`ssh exe.dev "rm fleet-${runId} --json"`),
      `expected the teardown command, got: ${JSON.stringify(exec.cmds)}`,
    )

    // The delivered assignment carried the orchestrator's own ws URL and port.
    assert.equal(exec.delivered.runId, runId)
    assert.equal(exec.delivered.wsUrl, `ws://127.0.0.1:${PORT}/fleet`)
  }

  // -- 2. an ABSENT sha sinks receiptsResolvable AND o1 ----------------------
  // Guards against a vacuously-green read: the check must be able to fail.
  {
    const runId = 'run-drive-2'
    const fabricated = '0'.repeat(40)
    let sandbox = null
    const exec = makeExec((assignment) => {
      setTimeout(() => {
        sandbox = startStubSandbox({ assignment, runId, receiptSha: fabricated, exec })
      }, 30)
    })

    const { read, detail } = await driveOne({
      ...driveDefaults,
      dbDir: path.join(tmp, 'db2'),
      exec,
      runId,
    })
    await sandbox

    assert.equal(read.receiptsResolvable, false, 'a sha absent from the repo must not resolve')
    assert.equal(read.o1, false, 'O1 requires every receipt to bind to a real sha')
    assert.deepEqual(detail.receipts, [
      {
        rowId: `${runId}:gate`,
        sha: fabricated,
        path: 'gate-receipt.json',
        verdict: 'PASS',
        exists: false,
        reachable: false,
        resolved: false,
      },
    ])
    // Everything else still reads honestly — the run itself did reach gate-green.
    assert.equal(read.leaseContinuity, true)
    assert.equal(read.versionStamp, true)
    assert.deepEqual(read.spendObservational, { reported: 4200, ledger: 4200 })
  }

  // -- 3. a PRESENT but UNREACHABLE sha also sinks receiptsResolvable --------
  // The weakness `cat-file -e` alone leaves open: any commit that ever landed in
  // the local object store answers it, including one on an unrelated branch that
  // the fetched run branch does not contain. Reachability from FETCH_HEAD is
  // what actually binds a receipt to the run.
  {
    const runId = 'run-drive-3'
    let sandbox = null
    const exec = makeExec((assignment) => {
      setTimeout(() => {
        sandbox = startStubSandbox({ assignment, runId, receiptSha: unreachableSha, exec })
      }, 30)
    })

    const { read, detail } = await driveOne({
      ...driveDefaults,
      dbDir: path.join(tmp, 'db3'),
      exec,
      runId,
    })
    await sandbox

    assert.equal(read.receiptsResolvable, false, 'a sha unreachable from the fetched branch must not resolve')
    assert.equal(read.o1, false)
    // The distinction is recorded, so triage can tell "no such commit" from
    // "that commit is not on this run's branch".
    assert.deepEqual(detail.receipts, [
      {
        rowId: `${runId}:gate`,
        sha: unreachableSha,
        path: 'gate-receipt.json',
        verdict: 'PASS',
        exists: true,
        reachable: false,
        resolved: false,
      },
    ])
  }

  // -- 4. the driver fetches EXACTLY the branch named in the store -----------
  // A second, differently-named integration branch, carrying a receipt sha that
  // IS reachable from it — so a green read here is only possible if the driver
  // followed the store's branch cell rather than any built-in name.
  {
    const runId = 'run-drive-4'
    let sandbox = null
    const exec = makeExec((assignment) => {
      setTimeout(() => {
        sandbox = startStubSandbox({ assignment, runId, receiptSha: olderSha, exec, branch: OLDER_BRANCH })
      }, 30)
    })

    const { read } = await driveOne({
      ...driveDefaults,
      dbDir: path.join(tmp, 'db4'),
      exec,
      runId,
    })
    await sandbox

    assert.ok(
      exec.cmds.includes(`git -C ${repoDir} fetch ssh://exedev@fleet-${runId}.exe.xyz/home/exedev/repo ${OLDER_BRANCH}`),
      `expected a fetch of ${OLDER_BRANCH}, got: ${JSON.stringify(exec.cmds)}`,
    )
    assert.ok(
      !exec.cmds.some((cmd) => cmd.includes(INTEGRATION_BRANCH) || / fleet-run$/.test(cmd)),
      `only the branch named in the store may be fetched, got: ${JSON.stringify(exec.cmds)}`,
    )
    assert.equal(read.receiptsResolvable, true, 'a sha reachable from the named branch resolves')
    assert.equal(read.o1, true)
  }

  // -- 5. shim-main's pure helpers -------------------------------------------
  {
    const assignmentFile = path.join(tmp, 'fleet-run.json')
    fs.writeFileSync(
      assignmentFile,
      JSON.stringify({ runId: 'run-x', token: 'tok', wsUrl: 'ws://h:1/fleet', ttlMs: 5 }),
    )
    assert.deepEqual(readAssignment(assignmentFile), {
      runId: 'run-x',
      token: 'tok',
      wsUrl: 'ws://h:1/fleet',
      ttlMs: 5,
    })

    // The sandbox id is derived from the run id exactly as the provisioner names
    // the VM — the assignment payload does not carry it.
    assert.equal(sandboxIdFor('run-x'), 'fleet-run-x')

    // Token totals: the engine's report carries no counter today, so a missing
    // one must read as null (never 0, which would look like a free run).
    const reportFile = path.join(tmp, 'report.json')
    assert.equal(readReportTokens(path.join(tmp, 'does-not-exist.json')), null)
    fs.writeFileSync(reportFile, 'not json')
    assert.equal(readReportTokens(reportFile), null)
    fs.writeFileSync(reportFile, JSON.stringify({ waveMerges: [] }))
    assert.equal(readReportTokens(reportFile), null)
    fs.writeFileSync(reportFile, JSON.stringify({ usage: { outputTokens: 99 } }))
    assert.equal(readReportTokens(reportFile), 99)
    fs.writeFileSync(reportFile, JSON.stringify({ totalTokens: 7 }))
    assert.equal(readReportTokens(reportFile), 7)

    // Gate verdict.
    fs.writeFileSync(reportFile, JSON.stringify({ gateGreen: true }))
    assert.equal(readGateGreen(reportFile), true)
    fs.writeFileSync(reportFile, JSON.stringify({ gate: { verdict: 'PASS' } }))
    assert.equal(readGateGreen(reportFile), true)
    fs.writeFileSync(reportFile, JSON.stringify({ gate: { verdict: 'BLOCKED' } }))
    assert.equal(readGateGreen(reportFile), false)
    assert.equal(readGateGreen(path.join(tmp, 'does-not-exist.json')), false)

    // The stamp: version from the manifest on disk, sha from the exec seam.
    const stamp = await readStamp({ repoDir, exec: async () => ({ code: 0, stdout: `${headSha}\n` }) })
    assert.deepEqual(stamp, { pluginVersion: '9.9.9', engineSha: headSha })
    // A repo with no manifest and a failing git still yields a well-formed,
    // empty stamp rather than throwing inside a live sandbox.
    assert.deepEqual(await readStamp({ repoDir: path.join(tmp, 'nope'), exec: async () => ({ code: 1, stdout: '' }) }), {
      pluginVersion: '',
      engineSha: '',
    })

    // Branch detection is MECHANICAL — the newest `ultra/integration-*` ref in
    // the sandbox's own repo, never a parse of engine output.
    assert.equal(await detectIntegrationBranch({ repoDir: sandboxRepo, exec: (cmd) => sh(cmd) }), INTEGRATION_BRANCH)
    // A repo that never integrated (no such ref) reports no branch rather than
    // guessing one.
    assert.equal(await detectIntegrationBranch({ repoDir, exec: (cmd) => sh(cmd) }), '')
    assert.equal(await detectIntegrationBranch({ repoDir, exec: async () => ({ code: 1, stdout: '' }) }), '')

    // Receipt discovery finds the machine-written gate receipts and nothing
    // else — the run report shares the artifact directory and must not be
    // mistaken for one.
    assert.deepEqual(findReceiptFiles(sandboxRepo), [RECEIPT_PATH])
    assert.deepEqual(findReceiptFiles(repoDir), [])
    assert.deepEqual(findReceiptFiles(path.join(tmp, 'nope')), [])

    // The store writers are surgical cell/row writes, never whole-table churn.
    const store = createMergeableStore('helpers')
    store.setRow('runs', 'run-x', { planPath: 'p', sandboxId: 's', status: 'running', branch: 'fleet-run' })
    applyStamp(store, 'run-x', stamp)
    applyReportedTokens(store, 'run-x', 1234)
    applyBranch(store, 'run-x', INTEGRATION_BRANCH)
    applyReceipt(store, 'run-x', 'gate', { sha: headSha, path: 'gate-receipt.json', verdict: 'PASS' })
    assert.deepEqual(store.getRow('runs', 'run-x'), {
      planPath: 'p',
      sandboxId: 's',
      status: 'running',
      branch: INTEGRATION_BRANCH,
      pluginVersion: '9.9.9',
      engineSha: headSha,
      reportedTokens: 1234,
    })
    assert.deepEqual(store.getRow('receipts', 'run-x:gate'), {
      sha: headSha,
      path: 'gate-receipt.json',
      verdict: 'PASS',
    })
    // An empty stamp/branch writes nothing rather than blanking a good one.
    applyStamp(store, 'run-x', { pluginVersion: '', engineSha: '' })
    applyReportedTokens(store, 'run-x', null)
    applyBranch(store, 'run-x', '')
    assert.equal(store.getCell('runs', 'run-x', 'pluginVersion'), '9.9.9')
    assert.equal(store.getCell('runs', 'run-x', 'reportedTokens'), 1234)
    assert.equal(store.getCell('runs', 'run-x', 'branch'), INTEGRATION_BRANCH)
  }

  console.log('ALL TESTS PASSED')
} finally {
  cleanup()
}
