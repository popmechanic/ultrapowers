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
//
// Three hostile/degenerate shapes get their own scenarios, because each is a
// way a green read could be manufactured rather than earned: a branch cell
// carrying shell metacharacters (the sandbox writes that cell, the orchestrator
// shells it), a receipt pointing at a path that does not exist in the tree at
// its sha (which is what a pointer into a GITIGNORED directory looks like), and
// a run that resolves without ever publishing anything.
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
  applyRunReceipts,
  auxStoreId,
  applyReportedTokens,
  applyStamp,
  detectIntegrationBranch,
  findReceiptFiles,
  isSafeBranchName,
  main as shimMain,
  readAssignment,
  readGateGreen,
  receiptDestination,
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

  // A hand-rolled stand-in sandbox, used only where the sandbox must publish
  // something production code would never write: a sha that does not exist, a
  // sha on no fetched branch, a path absent from the tree, a branch cell full of
  // shell metacharacters, or nothing at all. It is a real `runShim` against the
  // driver's own orchestrator, over the real ws transport, holding a real claim,
  // using shim-main's own store writers.
  //
  // `rawBranch` bypasses `applyBranch` deliberately: a hostile sandbox writes
  // the cell directly, so validating only on the write side would leave the
  // orchestrator's shell exposed. `publish: false` writes neither branch nor
  // receipt — the run resolves and publishes nothing.
  const startStubSandbox = ({
    assignment,
    runId,
    receiptSha,
    exec,
    branch = INTEGRATION_BRANCH,
    receiptPath = 'gate-receipt.json',
    rawBranch = null,
    publish = true,
  }) => {
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
          if (publish) applyReceipt(store, runId, 'gate', { sha: receiptSha, path: receiptPath, verdict: 'PASS' })
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
      applyStamp(store, runId, stamp)
      applyReportedTokens(store, runId, 4200)
      if (rawBranch !== null) store.setCell('runs', runId, 'branch', rawBranch)
      else if (publish) applyBranch(store, runId, branch)
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
    publishPollMs: 50,
    publishTimeoutMs: 8_000,
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

    // Production `main()` does not point a receipt at the engine's own artifact
    // path — `.claude/ultrapowers/` is GITIGNORED, so that pointer would not
    // dereference at any sha. It copies the receipt into the tree and commits
    // it on the integration branch, so the branch tip MOVED.
    const receiptsSha = (await sh(`git -C "${sandboxRepo}" rev-parse ${INTEGRATION_BRANCH}`)).stdout.trim()
    assert.match(receiptsSha, /^[0-9a-f]{40}$/)
    assert.notEqual(receiptsSha, integrationSha, 'the receipts commit must advance the integration branch')
    const committedReceipt = `fleet-receipts/${runId}/gate-receipt.json`
    assert.equal(
      (await sh(`git -C "${sandboxRepo}" cat-file -e ${receiptsSha}:${committedReceipt}`)).code,
      0,
      'the committed receipt must exist in the tree at the recorded sha',
    )

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
        sha: receiptsSha,
        path: committedReceipt,
        verdict: 'PASS',
        exists: true,
        reachable: true,
        dereferenced: true,
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
    const catIdx = exec.cmds.findIndex((c) => c === `git -C ${repoDir} cat-file -e ${receiptsSha}`)
    const ancIdx = exec.cmds.findIndex(
      (c) => c === `git -C ${repoDir} merge-base --is-ancestor ${receiptsSha} FETCH_HEAD`,
    )
    // The dereference leg: the recorded PATH must exist in the tree at the
    // recorded sha. Reachability alone would happily green a pointer into a
    // gitignored directory that no commit ever contained.
    const derefIdx = exec.cmds.findIndex((c) => c === `git -C ${repoDir} cat-file -e ${receiptsSha}:${committedReceipt}`)
    assert.ok(fetchIdx >= 0, `expected a run-branch fetch, got: ${JSON.stringify(exec.cmds)}`)
    assert.ok(catIdx >= 0, `expected a cat-file on the receipt sha, got: ${JSON.stringify(exec.cmds)}`)
    assert.ok(ancIdx >= 0, `expected a reachability check on the receipt sha, got: ${JSON.stringify(exec.cmds)}`)
    assert.ok(derefIdx >= 0, `expected a dereference of the receipt path, got: ${JSON.stringify(exec.cmds)}`)
    assert.ok(fetchIdx < catIdx, 'the branch must be fetched before its receipts are resolved')
    assert.ok(fetchIdx < ancIdx, 'reachability is decided against the FETCHED branch')
    assert.ok(fetchIdx < derefIdx, 'the pointer is dereferenced against the FETCHED branch')

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
        dereferenced: false,
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
        dereferenced: false,
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
        // `old.txt` is the file that branch's commit actually introduced, so the
        // pointer dereferences there and nowhere else.
        sandbox = startStubSandbox({
          assignment,
          runId,
          receiptSha: olderSha,
          exec,
          branch: OLDER_BRANCH,
          receiptPath: 'old.txt',
        })
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

  // -- 5. a hostile branch cell never reaches the shell ----------------------
  // `runs.<id>.branch` is written by the SANDBOX and interpolated by the
  // orchestrator into a `/bin/sh -c git fetch`. A branch cell carrying shell
  // metacharacters must fail the read outright — not be quoted, not be escaped,
  // not be executed.
  {
    const runId = 'run-drive-5'
    const pwned = path.join(tmp, 'pwned')
    let sandbox = null
    const exec = makeExec((assignment) => {
      setTimeout(() => {
        sandbox = startStubSandbox({
          assignment,
          runId,
          receiptSha: headSha,
          exec,
          rawBranch: `main; touch ${pwned}`,
        })
      }, 30)
    })

    const { read, detail } = await driveOne({
      ...driveDefaults,
      dbDir: path.join(tmp, 'db5'),
      exec,
      runId,
    })
    await sandbox

    assert.equal(read.receiptsResolvable, false, 'an unsafe branch name must fail the read')
    assert.equal(read.o1, false)
    assert.ok(
      !exec.cmds.some((cmd) => cmd.includes('pwned')),
      `the injected command must never reach exec, got: ${JSON.stringify(exec.cmds)}`,
    )
    assert.equal(fs.existsSync(pwned), false, 'the injected command must not have run')
    assert.ok(
      detail.errors.some((e) => e.includes('unsafe branch')),
      `expected an explicit unsafe-branch error, got: ${JSON.stringify(detail.errors)}`,
    )
    // The receipt was never verified, so it is reported unresolved rather than
    // silently omitted.
    assert.deepEqual(detail.receipts, [
      { rowId: `${runId}:gate`, sha: headSha, path: 'gate-receipt.json', verdict: 'PASS' },
    ])
  }

  // -- 6. a pointer that does not DEREFERENCE fails --------------------------
  // The shape a receipt into a gitignored directory takes: the sha is real and
  // reachable from the fetched branch, and the path simply is not in its tree.
  {
    const runId = 'run-drive-6'
    let sandbox = null
    const exec = makeExec((assignment) => {
      setTimeout(() => {
        sandbox = startStubSandbox({
          assignment,
          runId,
          receiptSha: integrationSha,
          exec,
          receiptPath: '.claude/ultrapowers/run-nope/gate-receipt.json',
        })
      }, 30)
    })

    const { read, detail } = await driveOne({
      ...driveDefaults,
      dbDir: path.join(tmp, 'db6'),
      exec,
      runId,
    })
    await sandbox

    assert.equal(read.receiptsResolvable, false, 'a path absent from the tree at its sha must not resolve')
    assert.equal(read.o1, false)
    assert.deepEqual(detail.receipts, [
      {
        rowId: `${runId}:gate`,
        sha: integrationSha,
        path: '.claude/ultrapowers/run-nope/gate-receipt.json',
        verdict: 'PASS',
        exists: true,
        reachable: true,
        dereferenced: false,
        resolved: false,
      },
    ])
  }

  // -- 7. a run that publishes nothing reads RED, on a bound -----------------
  // The publish/settle race, closed fail-closed: the driver waits for the
  // sandbox to actually publish its branch and receipts, and a run that never
  // does reads red with an explicit error rather than being napped past.
  {
    const runId = 'run-drive-7'
    let sandbox = null
    const exec = makeExec((assignment) => {
      setTimeout(() => {
        sandbox = startStubSandbox({ assignment, runId, receiptSha: headSha, exec, publish: false })
      }, 30)
    })

    const startedAt = Date.now()
    const { read, detail } = await driveOne({
      ...driveDefaults,
      dbDir: path.join(tmp, 'db7'),
      exec,
      runId,
      publishTimeoutMs: 1_000,
    })
    await sandbox

    assert.equal(read.o1, false, 'a run that published nothing is not O1')
    assert.equal(read.receiptsResolvable, false)
    assert.ok(
      detail.errors.includes('publish timeout'),
      `expected an explicit publish timeout, got: ${JSON.stringify(detail.errors)}`,
    )
    assert.deepEqual(detail.receipts, [])
    // Bounded: the wait is capped, not open-ended.
    assert.ok(Date.now() - startedAt < 20_000, 'the publish wait must be bounded')
    // Nothing was fetched, because there was no published branch to fetch.
    assert.ok(
      !exec.cmds.some((cmd) => / fetch /.test(cmd)),
      `nothing may be fetched for an unpublished run, got: ${JSON.stringify(exec.cmds)}`,
    )
  }

  // -- 8. the production receipt writer: copy, commit, point at the tree ------
  // Two `run-*` directories, so the kind must be keyed by directory, and both
  // pointers must dereference at the sha they record.
  {
    const multiRepo = path.join(tmp, 'multi-repo')
    const multiBranch = 'ultra/integration-20260821999999'
    fs.mkdirSync(multiRepo, { recursive: true })
    writeFile(multiRepo, 'seed.txt', 'seed\n')
    const seeded = await sh(
      'git init -q -b main . && git config user.email t@example.com && git config user.name t && ' +
        `git add -A && git -c commit.gpgsign=false commit -q -m seed && git checkout -q -b ${multiBranch}`,
      multiRepo,
    )
    assert.equal(seeded.code, 0, `multi-repo fixture failed: ${seeded.stderr}`)
    // Written but NOT committed — and unreachable to `git add` without `-f`
    // once the directory is ignored, which is exactly the live shape.
    writeFile(multiRepo, '.gitignore', '.claude/ultrapowers/\n')
    writeFile(multiRepo, '.claude/ultrapowers/run-aaa/gate-receipt.json', JSON.stringify({ verdict: 'PASS' }))
    writeFile(multiRepo, '.claude/ultrapowers/run-bbb/gate-receipt.json', JSON.stringify({ verdict: 'BLOCKED' }))

    const store = createMergeableStore('multi-receipts')
    const written = await applyRunReceipts(store, 'run-m', {
      repoDir: multiRepo,
      exec: (cmd) => sh(cmd),
      branch: multiBranch,
    })
    const sha = (await sh(`git -C "${multiRepo}" rev-parse ${multiBranch}`)).stdout.trim()

    assert.deepEqual(written, [
      {
        kind: 'gate-run-aaa',
        sha,
        path: 'fleet-receipts/run-m/run-aaa-gate-receipt.json',
        verdict: 'PASS',
      },
      {
        kind: 'gate-run-bbb',
        sha,
        path: 'fleet-receipts/run-m/run-bbb-gate-receipt.json',
        verdict: 'BLOCKED',
      },
    ])
    assert.deepEqual(store.getRow('receipts', 'run-m:gate-run-aaa'), {
      sha,
      path: 'fleet-receipts/run-m/run-aaa-gate-receipt.json',
      verdict: 'PASS',
    })
    assert.deepEqual(store.getRow('receipts', 'run-m:gate-run-bbb'), {
      sha,
      path: 'fleet-receipts/run-m/run-bbb-gate-receipt.json',
      verdict: 'BLOCKED',
    })
    // Both pointers dereference at the sha they record — the whole point.
    for (const row of written) {
      assert.equal(
        (await sh(`git -C "${multiRepo}" cat-file -e ${sha}:${row.path}`)).code,
        0,
        `${row.path} must exist in the tree at ${sha}`,
      )
    }
    // A run with no receipts writes nothing rather than an empty pointer.
    assert.deepEqual(
      await applyRunReceipts(store, 'run-none', { repoDir: repoDir, exec: (cmd) => sh(cmd), branch: 'main' }),
      [],
    )
  }

  // -- 9. a partial copy failure sinks the WHOLE publish ---------------------
  // Two receipts, the second's copy fails. A survivor row resolving on its
  // own would let `o1` read true for a run that did not finish publishing
  // what it claimed to — the fix must refuse to stage or commit ANY receipt
  // once one copy has failed, not merely skip the failed one.
  {
    const partialRepo = path.join(tmp, 'partial-repo')
    const partialBranch = 'ultra/integration-20260821888888'
    fs.mkdirSync(partialRepo, { recursive: true })
    writeFile(partialRepo, 'seed.txt', 'seed\n')
    const seeded = await sh(
      'git init -q -b main . && git config user.email t@example.com && git config user.name t && ' +
        `git add -A && git -c commit.gpgsign=false commit -q -m seed && git checkout -q -b ${partialBranch}`,
      partialRepo,
    )
    assert.equal(seeded.code, 0, `partial-repo fixture failed: ${seeded.stderr}`)
    writeFile(partialRepo, '.gitignore', '.claude/ultrapowers/\n')
    writeFile(partialRepo, '.claude/ultrapowers/run-aaa/gate-receipt.json', JSON.stringify({ verdict: 'PASS' }))
    writeFile(partialRepo, '.claude/ultrapowers/run-bbb/gate-receipt.json', JSON.stringify({ verdict: 'PASS' }))

    // Block the SECOND file's copy destination by pre-creating a DIRECTORY at
    // exactly the path `receiptDestination` computes for it — `fs.copyFileSync`
    // fails (EISDIR) rather than writing, simulating a real copy failure
    // without touching fs internals.
    const blockedDestRel = receiptDestination('run-p', '.claude/ultrapowers/run-bbb/gate-receipt.json', false)
    fs.mkdirSync(path.join(partialRepo, blockedDestRel), { recursive: true })

    const store = createMergeableStore('partial-receipts')
    const written = await applyRunReceipts(store, 'run-p', {
      repoDir: partialRepo,
      exec: (cmd) => sh(cmd),
      branch: partialBranch,
    })
    assert.deepEqual(written, [], 'a failed copy must sink the whole publish, not just its own row')
    assert.deepEqual(store.getTable('receipts'), {}, 'no receipts row may be written when any copy fails')
    // Nothing was committed either — the failure was caught before add/commit.
    const log = await sh(`git -C "${partialRepo}" log --oneline ${partialBranch}`, partialRepo)
    assert.ok(!log.stdout.includes('fleet: receipts'), 'a partial publish must not be committed')
  }

  // -- 10. …and that partial publish reads RED end to end --------------------
  // The unit-level check above shows `applyRunReceipts` itself refuses to
  // stage anything; this closes the loop through the actual driver — the
  // production writer, wired the way `main()` wires it, against a sandbox
  // that never finishes publishing. It must read exactly like the "published
  // nothing" case (scenario 7): red, on the same bound, for the same reason.
  {
    const runId = 'run-drive-10a'
    const failRepo = path.join(tmp, 'fail-repo')
    const failBranch = 'ultra/integration-20260821777777'
    fs.mkdirSync(failRepo, { recursive: true })
    writeFile(failRepo, 'seed.txt', 'seed\n')
    const seeded = await sh(
      'git init -q -b main . && git config user.email t@example.com && git config user.name t && ' +
        `git add -A && git -c commit.gpgsign=false commit -q -m seed && git checkout -q -b ${failBranch}`,
      failRepo,
    )
    assert.equal(seeded.code, 0, `fail-repo fixture failed: ${seeded.stderr}`)
    writeFile(failRepo, '.gitignore', '.claude/ultrapowers/\n')
    writeFile(failRepo, '.claude/ultrapowers/run-ccc/gate-receipt.json', JSON.stringify({ verdict: 'PASS' }))
    writeFile(failRepo, '.claude/ultrapowers/run-ddd/gate-receipt.json', JSON.stringify({ verdict: 'PASS' }))
    const blockedDestRel2 = receiptDestination(runId, '.claude/ultrapowers/run-ddd/gate-receipt.json', false)
    fs.mkdirSync(path.join(failRepo, blockedDestRel2), { recursive: true })

    let sandbox = null
    const exec = makeExec((assignment) => {
      setTimeout(() => {
        const sandboxId = sandboxIdFor(runId)
        sandbox = (async () => {
          const store = createMergeableStore(auxStoreId(sandboxId))
          const socket = new WebSocket(`${assignment.wsUrl}?token=${assignment.token}`)
          const synchronizer = await createWsSynchronizer(store, socket)
          await synchronizer.startSync()
          const outcome = await runShim({
            wsUrl: assignment.wsUrl,
            token: assignment.token,
            sandboxId,
            runId,
            ttlMs: assignment.ttlMs,
            clock,
            invokeRun: async () => {
              await sleep(250)
              return { gateGreen: true }
            },
            readReportTokens: () => 4200,
          })
          // Exactly what `main()` does after `runShim` returns: publish
          // receipts with the production writer (one of two destinations
          // pre-blocked), then the branch — over the real exec seam against
          // the throwaway repo above.
          await applyRunReceipts(store, runId, { repoDir: failRepo, exec: (cmd) => sh(cmd), branch: failBranch })
          applyBranch(store, runId, failBranch)
          await synchronizer.save()
          await synchronizer.stopSync()
          await synchronizer.destroy()
          return outcome
        })()
      }, 30)
    })

    const { read, detail } = await driveOne({
      ...driveDefaults,
      dbDir: path.join(tmp, 'db10a'),
      exec,
      runId,
      publishTimeoutMs: 1_000,
    })
    await sandbox

    // The branch published, but the receipts table never gained a row — the
    // publish signal requires both, so the driver never fetches and times out
    // exactly as it does for a run that published nothing at all.
    assert.equal(read.o1, false, 'a partial receipts publish must read red, not merely receipt-short')
    assert.equal(read.receiptsResolvable, false)
    assert.deepEqual(detail.receipts, [], 'no receipts row survives a partial publish')
    assert.ok(
      detail.errors.includes('publish timeout'),
      `expected an explicit publish timeout, got: ${JSON.stringify(detail.errors)}`,
    )
  }

  // -- 11. a hostile receipt pointer never reaches the shell -----------------
  // `receipt.sha`/`receipt.path` are rows the SANDBOX wrote (via `applyReceipt`
  // in a stand-in here, production `applyRunReceipts` in the happy path) and
  // the driver interpolates them into `git cat-file`/`merge-base`. A pointer
  // carrying shell metacharacters must fail the read outright, with the
  // payload never once reaching `exec`.
  {
    const runId = 'run-drive-10'
    const pwned = path.join(tmp, 'pwned-receipt')
    let sandbox = null
    const exec = makeExec((assignment) => {
      setTimeout(() => {
        const sandboxId = sandboxIdFor(runId)
        sandbox = (async () => {
          const store = createMergeableStore(auxStoreId(sandboxId))
          const socket = new WebSocket(`${assignment.wsUrl}?token=${assignment.token}`)
          const synchronizer = await createWsSynchronizer(store, socket)
          await synchronizer.startSync()
          const outcome = await runShim({
            wsUrl: assignment.wsUrl,
            token: assignment.token,
            sandboxId,
            runId,
            ttlMs: assignment.ttlMs,
            clock,
            invokeRun: async () => {
              // Both pointer halves carry shell metacharacters — a `; touch`
              // in the sha and a `$( )` in the path — so either check alone
              // failing to guard would let the payload through.
              applyReceipt(store, runId, 'gate', {
                sha: `${headSha}; touch ${pwned}`,
                path: `gate-receipt.json; touch ${pwned}`,
                verdict: 'PASS',
              })
              await sleep(250)
              return { gateGreen: true }
            },
            readReportTokens: () => 4200,
          })
          applyBranch(store, runId, INTEGRATION_BRANCH)
          await synchronizer.save()
          await synchronizer.stopSync()
          await synchronizer.destroy()
          return outcome
        })()
      }, 30)
    })

    const { read, detail } = await driveOne({
      ...driveDefaults,
      dbDir: path.join(tmp, 'db10'),
      exec,
      runId,
    })
    await sandbox

    assert.equal(read.receiptsResolvable, false, 'an unsafe receipt pointer must fail the read')
    assert.equal(read.o1, false)
    assert.ok(
      !exec.cmds.some((cmd) => cmd.includes('pwned')),
      `the injected receipt payload must never reach exec, got: ${JSON.stringify(exec.cmds)}`,
    )
    assert.equal(fs.existsSync(pwned), false, 'the injected command must not have run')
    assert.ok(
      detail.errors.some((e) => e.includes('unsafe receipt pointer')),
      `expected an explicit unsafe-pointer error, got: ${JSON.stringify(detail.errors)}`,
    )
  }

  // -- 11. shim-main's pure helpers -------------------------------------------
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

    // Branch names are validated on the WRITE side too, so a run that somehow
    // detected a hostile ref never publishes it. Rejection leaves the cell as it
    // was — it does not blank a good name.
    for (const hostile of [
      'main; touch /tmp/pwned',
      'main && rm -rf /',
      'main $(id)',
      'main`id`',
      'main | tee /tmp/x',
      'ultra/integration 20260821',
      '--upload-pack=evil',
      'ultra/../../etc/passwd',
      'main\ntouch /tmp/x',
    ]) {
      assert.equal(isSafeBranchName(hostile), false, `${JSON.stringify(hostile)} must be rejected`)
      applyBranch(store, 'run-x', hostile)
      assert.equal(store.getCell('runs', 'run-x', 'branch'), INTEGRATION_BRANCH)
    }
    for (const legal of [INTEGRATION_BRANCH, 'fleet-run', 'main', 'release/1.2.3_rc-4']) {
      assert.equal(isSafeBranchName(legal), true, `${legal} must be accepted`)
    }
    assert.equal(isSafeBranchName(''), false)
    assert.equal(isSafeBranchName(undefined), false)
    assert.equal(isSafeBranchName(42), false)
  }

  console.log('ALL TESTS PASSED')
} finally {
  cleanup()
}
