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
// The sandbox's LIVE launch leg — `invokeEngineRun`, `shellExec`,
// `spawnEngineProcess`, and run-report discovery — gets its own scenarios at
// the end, driven over injected exec/spawn recorders. Those functions are what
// every other scenario stubs past, so nothing else here can catch a defect in
// them: which code the run executes (the pushed `fleet-base`, not the golden
// image's HEAD), which plan it is given, and where its report is read from are
// decided there and nowhere else.
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
  BASE_REF,
  detectIntegrationBranch,
  engineArgs,
  ENGINE_COMMAND,
  STANDING_DIRECTIVE,
  findGateReceiptFile,
  findReceiptFiles,
  findRunReportFile,
  invokeEngineRun,
  isSafeBranchName,
  main as shimMain,
  readAssignment,
  readGateGreen,
  receiptDestination,
  readReportTokens,
  readStamp,
  runArtifactDirs,
  sandboxIdFor,
  shellExec,
  spawnEngineProcess,
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
// Both artifacts live in the SAME run directory — that is where `ultra_gate.py`
// writes them, and the whole point of discovery is that neither has a fixed
// path the fleet may assume.
const RUN_DIR = '.claude/ultrapowers/run-20260821125904'
const RECEIPT_PATH = `${RUN_DIR}/gate-receipt.json`
const REPORT_PATH = `${RUN_DIR}/report.json`

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
  // Every sandbox carries this ref: `provisionRun` pushes the driver's base to
  // it, and it is the ONLY name that identifies the code under test once the
  // engine has moved the checkout onto its own integration branch. The stand-in
  // sandboxes below stamp from it exactly as `main()` does.
  assert.equal((await sh(`git branch ${BASE_REF} main`, repoDir)).code, 0)

  // -- the stand-in sandbox repo --------------------------------------------
  // A real clone carrying two `ultra/integration-*` branches with explicit,
  // far-apart committer dates, so `--sort=-committerdate` has an unambiguous
  // winner. The newest one carries the machine-written gate receipt the engine
  // leaves behind.
  const cloned = await sh(`git clone -q "${repoDir}" "${sandboxRepo}"`, tmp)
  assert.equal(cloned.code, 0, `git clone failed: ${cloned.stderr}`)
  await sh('git config user.email t@example.com && git config user.name t', sandboxRepo)
  // The pushed base, as the provisioner leaves it. It stays put for the whole
  // run while HEAD moves twice (base checkout, then the engine's integration
  // branch), which is precisely why the stamp is read from it and not from HEAD.
  assert.equal((await sh(`git branch ${BASE_REF} main`, sandboxRepo)).code, 0)

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

  // The engine's run report — in the run directory beside the gate receipt.
  // Receipt discovery must still not pick it up: it is scoped to the receipt's
  // FILE NAME, not merely to the directory.
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
    // The production entrypoint's own git traffic, so the stamp's SOURCE is
    // pinned end to end and not only in the unit scenario below.
    const shimCalls = []
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
          exec: (cmd) => {
            shimCalls.push(cmd)
            return sh(cmd)
          },
          invokeRun: async () => {
            await sleep(250)
            return { gateGreen: true }
          },
          // The real run reads its cumulative output-token total from the engine
          // SESSION TRANSCRIPTS (`readSessionTokens`); the engine is stubbed here,
          // so no transcript is written. Inject the reader seam — exactly as the
          // production default `() => readSessionTokens(sessionId)` is injectable —
          // so this exercises the spend read without a real engine or a write into
          // the test user's home directory.
          readTokens: () => 4200,
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

    // Evidence BEFORE teardown (#197): shim.log, the assignment, the engine
    // transcripts and the gitignored run dirs die with the VM, and every live
    // diagnosis depended on them. The driver pulls them — small artifacts only,
    // never the whole repo — exactly once, and strictly before the `rm`.
    const pullIdx = exec.cmds.findIndex((c) => /^ssh -o BatchMode=yes -o ConnectTimeout=10 fleet-run-drive-1\.exe\.xyz 'cd \/home\/exedev && tar czf - shim\.log fleet-run\.json \.claude\/projects /.test(c))
    const rmIdx = exec.cmds.findIndex((c) => c === `ssh exe.dev "rm fleet-${runId} --json"`)
    assert.ok(pullIdx >= 0, `expected a sandbox log pull, got: ${JSON.stringify(exec.cmds)}`)
    assert.ok(pullIdx < rmIdx, 'sandbox logs are pulled BEFORE the sandbox is destroyed')
    assert.equal(exec.cmds.filter((c) => /tar czf - shim\.log/.test(c)).length, 1, 'the log pull fires exactly once')
    const pullCmd = exec.cmds[pullIdx]
    assert.ok(/repo\/\.claude\/ultrapowers\/run-/.test(pullCmd) || /run-\*\//.test(pullCmd), `the pull must include the gitignored run dirs, got: ${pullCmd}`)
    assert.ok(/> \S+\/sandbox-logs\.tgz$/.test(pullCmd), `the pull must land in a sandbox-logs.tgz, got: ${pullCmd}`)
    // Destination lives beside the gate read, under dbDir.
    const dest = pullCmd.match(/> (\S+\/sandbox-logs\.tgz)$/)[1]
    assert.ok(dest.startsWith(path.join(tmp, 'db1')), `log destination must be under dbDir, got: ${dest}`)
    assert.ok(fs.existsSync(path.dirname(dest)), 'the destination directory is created before the pull runs')
    assert.equal(detail.sandboxLogs, dest, 'the detail names where the evidence landed')
    // The tunnel is torn down with the sandbox (#196): after the rm.
    const killIdx = exec.cmds.findIndex((c) => c.startsWith('pkill -f ') && c.includes(`[-]R ${PORT}:127.0.0.1:${PORT} fleet-${runId}.exe.xyz`))
    assert.ok(killIdx > rmIdx, `the tunnel kill follows the rm, got: ${JSON.stringify(exec.cmds)}`)
    // And the tunnel was opened before the shim started.
    const tunnelIdx = exec.cmds.findIndex((c) => c === `ssh -o BatchMode=yes -o ExitOnForwardFailure=yes -fN -R ${PORT}:127.0.0.1:${PORT} fleet-${runId}.exe.xyz`)
    const shimIdx = exec.cmds.findIndex((c) => /nohup node .*shim-main\.mjs/.test(c))
    assert.ok(tunnelIdx >= 0 && tunnelIdx < shimIdx, `the reverse tunnel opens before the shim starts, got: ${JSON.stringify(exec.cmds)}`)

    // The delivered assignment carried the orchestrator's own ws URL and port —
    // and the PLAN. `planPath` is the sandbox's only source for what it was
    // dispatched to run: the shim reads its assignment file before it has
    // synced any store row, so a driver that does not forward it launches the
    // engine with a literal `undefined` plan path.
    assert.equal(exec.delivered.runId, runId)
    assert.equal(exec.delivered.wsUrl, `ws://127.0.0.1:${PORT}/fleet`)
    assert.equal(exec.delivered.planPath, driveDefaults.planPath)

    // The stamp names the code under test. `main()` stamps BEFORE the run, and
    // the run is what moves the checkout — first onto the pushed base, then onto
    // the engine's integration branch — so a stamp read from the checkout names
    // whatever the golden image happened to be baked at. It is read from the
    // pushed ref instead, which is stable across both moves.
    assert.ok(
      shimCalls.includes(`git -C ${sandboxRepo} rev-parse ${BASE_REF}`),
      `main() must stamp from ${BASE_REF}, got: ${JSON.stringify(shimCalls)}`,
    )
    assert.ok(
      !shimCalls.some((cmd) => /rev-parse HEAD$/.test(cmd)),
      `the stamp must never be read from the sandbox's HEAD, got: ${JSON.stringify(shimCalls)}`,
    )
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

  // -- 7b. a FAILED log pull never blocks teardown or the report -----------
  // The pull is best-effort: the billing clock is what teardown protects, so a
  // pull that throws (or returns non-zero) is recorded in `errors` and the `rm`
  // still goes out, the orchestrator still stops, and the report is still
  // written. Nothing is thrown.
  {
    const runId = 'run-drive-7b'
    let sandbox = null
    const inner = makeExec((assignment) => {
      setTimeout(() => {
        sandbox = startStubSandbox({ assignment, runId, receiptSha: headSha, exec, publish: true })
      }, 30)
    })
    const exec = async (cmd) => {
      if (/tar czf - shim\.log/.test(cmd)) {
        inner.cmds.push(cmd)
        throw new Error('ssh: connect to host fleet-run-drive-7b.exe.xyz port 22: Connection timed out')
      }
      return inner(cmd)
    }
    exec.cmds = inner.cmds

    const { read, reportPath, detail } = await driveOne({
      ...driveDefaults,
      dbDir: path.join(tmp, 'db7b'),
      exec,
      runId,
    })
    await sandbox

    assert.equal(exec.cmds.filter((c) => /tar czf - shim\.log/.test(c)).length, 1, 'the pull is attempted exactly once')
    assert.ok(
      exec.cmds.includes(`ssh exe.dev "rm fleet-${runId} --json"`),
      `the sandbox is destroyed even though the pull failed, got: ${JSON.stringify(exec.cmds)}`,
    )
    assert.ok(
      detail.errors.some((e) => /sandbox logs/.test(e) && /Connection timed out/.test(e)),
      `the failed pull is recorded, got: ${JSON.stringify(detail.errors)}`,
    )
    assert.equal(detail.sandboxLogs, null, 'no evidence landed')
    assert.ok(fs.existsSync(reportPath), 'the report is still written')
    assert.equal(typeof read.o1, 'boolean')
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

  // -- 12. shim-main's pure helpers -------------------------------------------
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

    // Gate verdict — read from the machine-written gate RECEIPT, never from
    // report.json (which carries no verdict field at all). `NEEDS_ACK` reads
    // false exactly like `BLOCKED`: it parks for operator triage rather than
    // greening, which is the fleet's park-by-default posture.
    const receiptFile = path.join(tmp, 'gate-receipt.json')
    fs.writeFileSync(receiptFile, JSON.stringify({ verdict: 'PASS' }))
    assert.equal(readGateGreen(receiptFile), true)
    fs.writeFileSync(receiptFile, JSON.stringify({ verdict: 'BLOCKED' }))
    assert.equal(readGateGreen(receiptFile), false)
    fs.writeFileSync(receiptFile, JSON.stringify({ verdict: 'NEEDS_ACK' }))
    assert.equal(readGateGreen(receiptFile), false)
    assert.equal(readGateGreen(path.join(tmp, 'does-not-exist.json')), false)

    // The stamp attests THE CODE THAT RUNS — the base ref the driver pushed —
    // and never the checkout it happens to be captured beside. Those differ in
    // every live run: the sandbox boots on the golden image's HEAD, `main()`
    // stamps before `invokeEngineRun` moves the checkout onto `fleet-base`, and
    // the engine then leaves HEAD on its own integration branch. A stamp read
    // from HEAD or from the working tree therefore names a commit the driver
    // never sent, while `versionStamp` (non-emptiness only) still reads true —
    // an attestation of the wrong code that the gate cannot tell from a right
    // one. Both halves are pinned here against a repo built so the two answers
    // cannot coincide.
    const stampRepo = path.join(tmp, 'stamp-repo')
    fs.mkdirSync(stampRepo, { recursive: true })
    writeFile(stampRepo, '.claude-plugin/plugin.json', JSON.stringify({ version: '1.0.0-base' }))
    const stampInit = await sh(
      'git init -q -b main . && git config user.email t@example.com && git config user.name t && ' +
        `git add -A && git -c commit.gpgsign=false commit -q -m base && git branch ${BASE_REF}`,
      stampRepo,
    )
    assert.equal(stampInit.code, 0, `stamp fixture init failed: ${stampInit.stderr}`)
    const baseSha = (await sh(`git rev-parse ${BASE_REF}`, stampRepo)).stdout.trim()

    // …then move the checkout off it, carrying a DIFFERENT manifest — the shape
    // a golden image baked at another sha presents.
    writeFile(stampRepo, '.claude-plugin/plugin.json', JSON.stringify({ version: '2.0.0-image' }))
    const stampMoved = await sh(
      'git checkout -q -b image && git add -A && git -c commit.gpgsign=false commit -q -m image',
      stampRepo,
    )
    assert.equal(stampMoved.code, 0, `stamp fixture move failed: ${stampMoved.stderr}`)
    const imageSha = (await sh('git rev-parse HEAD', stampRepo)).stdout.trim()
    assert.notEqual(imageSha, baseSha, 'the fixture must make HEAD and the base ref disagree')

    const stamp = await readStamp({ repoDir: stampRepo, exec: (cmd) => sh(cmd) })
    assert.deepEqual(stamp, { pluginVersion: '1.0.0-base', engineSha: baseSha })
    assert.notEqual(stamp.engineSha, imageSha, 'the stamped sha must not be the checkout it was read beside')
    assert.notEqual(stamp.pluginVersion, '2.0.0-image', 'the version must come from the ref, not the working tree')

    // A sandbox the base was never pushed to reports an EMPTY stamp rather than
    // falling back to whatever is on disk — a fallback would restore exactly the
    // misattribution above, silently and with no way for the gate to see it.
    assert.deepEqual(await readStamp({ repoDir: stampRepo, exec: (cmd) => sh(cmd), ref: 'no-such-ref' }), {
      pluginVersion: '',
      engineSha: '',
    })
    // A repo with no manifest and a failing git still yields a well-formed,
    // empty stamp rather than throwing inside a live sandbox.
    assert.deepEqual(await readStamp({ repoDir: path.join(tmp, 'nope'), exec: async () => ({ code: 1, stdout: '' }) }), {
      pluginVersion: '',
      engineSha: '',
    })
    // The ref reaches a shell on both legs (`rev-parse` and the manifest read),
    // so an unsafe one is refused before either runs.
    {
      const seen = []
      assert.deepEqual(
        await readStamp({
          repoDir: stampRepo,
          exec: async (cmd) => {
            seen.push(cmd)
            return { code: 0, stdout: '' }
          },
          ref: 'fleet-base; touch /tmp/pwned',
        }),
        { pluginVersion: '', engineSha: '' },
      )
      assert.deepEqual(seen, [], `an unsafe ref must never reach a shell, got: ${JSON.stringify(seen)}`)
    }

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
      pluginVersion: '1.0.0-base',
      engineSha: baseSha,
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
    assert.equal(store.getCell('runs', 'run-x', 'pluginVersion'), '1.0.0-base')
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

  // -- 13. the engine launch itself ------------------------------------------
  // `invokeEngineRun` is the whole live leg of the sandbox: it is what decides
  // WHAT code runs (the pushed base, not the golden image's HEAD), WHICH plan
  // it runs, and whether the result counts as green. It is driven here over
  // injected exec/spawn seams against a real sandbox-shaped repo, with one
  // shared call log so the ORDER of the two side effects is pinned, not just
  // their presence.
  const engineRepo = path.join(tmp, 'engine-repo')
  {
    fs.mkdirSync(engineRepo, { recursive: true })
    writeFile(engineRepo, 'seed.txt', 'seed\n')

    const ENGINE_PLAN = 'docs/superpowers/plans/2026-08-21-width-w1.md'
    const ENGINE_RUN_DIR = '.claude/ultrapowers/run-20990101000000'

    // The recorder: exec and spawn share one array, so "checkout before spawn"
    // is an assertion about a single ordered history rather than two.
    const makeRecorder = ({ checkoutCode = 0, engineCode = 0, onSpawn = null } = {}) => {
      const calls = []
      const logs = []
      return {
        calls,
        logs,
        log: (line) => logs.push(line),
        exec: async (cmd) => {
          calls.push(cmd)
          return { code: checkoutCode, stdout: '' }
        },
        spawnEngine: async ({ command, args, cwd }) => {
          calls.push([command, ...args].join(' '))
          if (onSpawn) await onSpawn({ cwd })
          return engineCode
        },
      }
    }

    // The engine writes its report AND its gate receipt DURING the run, into
    // the same run directory — so both are synthesized by the spawn itself.
    // That is what proves discovery is resolved after the run rather than at
    // boot, when the directory does not exist.
    //
    // The two files are deliberately split: `report.json` carries no verdict
    // field in the real engine, so it is written from `report` alone (the
    // token count) and the receipt — the ONLY source `readGateGreen` reads —
    // is written separately, only when `verdict` is supplied. A subtest that
    // omits `verdict` leaves no receipt behind at all, exactly like an engine
    // run that never reached its gate.
    const writesArtifacts =
      ({ report = {}, verdict } = {}) =>
      async ({ cwd }) => {
        writeFile(cwd, `${ENGINE_RUN_DIR}/report.json`, JSON.stringify(report))
        if (verdict !== undefined) writeFile(cwd, `${ENGINE_RUN_DIR}/gate-receipt.json`, JSON.stringify({ verdict }))
      }

    // -- the happy path --
    {
      const rec = makeRecorder({ onSpawn: writesArtifacts({ report: { outputTokens: 4321 }, verdict: 'PASS' }) })
      const outcome = await invokeEngineRun({
        repoDir: engineRepo,
        planPath: ENGINE_PLAN,
        exec: rec.exec,
        spawnEngine: rec.spawnEngine,
        log: rec.log,
      })

      // Exactly three side effects, in exactly this order: check out the pushed
      // base, read which credential the engine will ride (`claude auth status`,
      // logged — #213), THEN launch the engine. A spawn that preceded the
      // checkout would run the golden image's HEAD and gate it green.
      assert.equal(rec.calls.length, 3, `expected checkout, auth status, then spawn, got: ${JSON.stringify(rec.calls)}`)
      const checkoutIdx = rec.calls.findIndex((c) => c === `git -C ${engineRepo} checkout -q ${BASE_REF}`)
      const authIdx = rec.calls.findIndex((c) => c === `${ENGINE_COMMAND} auth status`)
      const spawnIdx = rec.calls.findIndex((c) => c.startsWith(`${ENGINE_COMMAND} -p`))
      assert.ok(authIdx >= 0 && authIdx < spawnIdx, `auth status must be read before the engine is spawned, got: ${JSON.stringify(rec.calls)}`)
      assert.ok(checkoutIdx >= 0, `expected a ${BASE_REF} checkout, got: ${JSON.stringify(rec.calls)}`)
      assert.ok(spawnIdx >= 0, `expected an engine spawn, got: ${JSON.stringify(rec.calls)}`)
      assert.ok(checkoutIdx < spawnIdx, 'the base must be checked out BEFORE the engine is spawned')
      // The credential read is logged for the evidence pull; an unparseable
      // status (the recorder returns no JSON) degrades to the explicit
      // "unreadable" line and never blocks the launch.
      assert.ok(rec.logs.some((l) => l.includes('fleet: engine auth')), `expected an engine-auth log line, got: ${JSON.stringify(rec.logs)}`)

      // The plan the assignment named, verbatim — never the literal `undefined`
      // a missing assignment field used to produce.
      assert.equal(rec.calls[spawnIdx], `${ENGINE_COMMAND} ${engineArgs(ENGINE_PLAN).join(' ')}`)
      assert.ok(rec.calls[spawnIdx].includes(ENGINE_PLAN), `the spawn must carry the assignment's planPath`)
      assert.ok(!rec.calls[spawnIdx].includes('undefined'))

      assert.deepEqual(outcome, { gateGreen: true })

      // …and the discovered report and receipt are the files the engine
      // actually wrote — the verdict from the receipt, the token count from
      // the report, exactly as the two readers are split.
      const discoveredReport = findRunReportFile(engineRepo)
      assert.equal(discoveredReport, path.join(engineRepo, ENGINE_RUN_DIR, 'report.json'))
      assert.equal(readReportTokens(discoveredReport), 4321)
      const discoveredReceipt = findGateReceiptFile(engineRepo)
      assert.equal(discoveredReceipt, path.join(engineRepo, ENGINE_RUN_DIR, 'gate-receipt.json'))
      assert.equal(readGateGreen(discoveredReceipt), true)
    }

    // -- a non-zero engine exit is never green, however the receipt reads -----
    {
      const rec = makeRecorder({ engineCode: 1, onSpawn: writesArtifacts({ report: { outputTokens: 4321 }, verdict: 'PASS' }) })
      assert.deepEqual(
        await invokeEngineRun({
          repoDir: engineRepo,
          planPath: ENGINE_PLAN,
          exec: rec.exec,
          spawnEngine: rec.spawnEngine,
          log: rec.log,
        }),
        { gateGreen: false },
      )
    }

    // -- a clean exit with a BLOCKED gate receipt is not green either ----------
    {
      const rec = makeRecorder({ onSpawn: writesArtifacts({ report: { outputTokens: 4321 }, verdict: 'BLOCKED' }) })
      assert.deepEqual(
        await invokeEngineRun({
          repoDir: engineRepo,
          planPath: ENGINE_PLAN,
          exec: rec.exec,
          spawnEngine: rec.spawnEngine,
          log: rec.log,
        }),
        { gateGreen: false },
      )
    }

    // -- a clean exit with a NEEDS_ACK gate receipt parks, not greens ----------
    // A `NEEDS_ACK` run gates for operator triage, not a silent pass — the
    // fleet's park-by-default posture reads it exactly like `BLOCKED`.
    {
      const rec = makeRecorder({ onSpawn: writesArtifacts({ report: { outputTokens: 4321 }, verdict: 'NEEDS_ACK' }) })
      assert.deepEqual(
        await invokeEngineRun({
          repoDir: engineRepo,
          planPath: ENGINE_PLAN,
          exec: rec.exec,
          spawnEngine: rec.spawnEngine,
          log: rec.log,
        }),
        { gateGreen: false },
      )
    }

    // -- an ABSENT planPath fails explicitly, before anything is spent --------
    for (const missing of [undefined, null, '', 42]) {
      const rec = makeRecorder()
      assert.deepEqual(
        await invokeEngineRun({
          repoDir: engineRepo,
          planPath: missing,
          exec: rec.exec,
          spawnEngine: rec.spawnEngine,
          log: rec.log,
        }),
        { gateGreen: false, error: 'missing planPath' },
        `planPath ${JSON.stringify(missing)} must fail the run explicitly`,
      )
      // Nothing was checked out and nothing was spawned — the sandbox is not
      // burned on a run that cannot be dispatched.
      assert.deepEqual(rec.calls, [], `nothing may run without a planPath, got: ${JSON.stringify(rec.calls)}`)
      assert.ok(
        rec.logs.some((line) => line.includes('planPath')),
        `expected an explicit planPath failure on the log, got: ${JSON.stringify(rec.logs)}`,
      )
    }

    // -- a FAILED base checkout fails explicitly, before the engine spawns ----
    {
      const rec = makeRecorder({ checkoutCode: 1 })
      assert.deepEqual(
        await invokeEngineRun({
          repoDir: engineRepo,
          planPath: ENGINE_PLAN,
          exec: rec.exec,
          spawnEngine: rec.spawnEngine,
          log: rec.log,
        }),
        { gateGreen: false, error: `checkout ${BASE_REF} failed` },
      )
      // The checkout was attempted; the engine was NOT. Running here would gate
      // the golden image's HEAD green and report it as the driver's base.
      assert.deepEqual(rec.calls, [`git -C ${engineRepo} checkout -q ${BASE_REF}`])
      assert.ok(
        rec.logs.some((line) => line.includes(BASE_REF)),
        `expected an explicit checkout failure on the log, got: ${JSON.stringify(rec.logs)}`,
      )
    }

    // -- an exec seam that THROWS is a failed checkout, not a crash -----------
    // Not a non-zero code — an actually rejecting promise, the case a bare
    // `checkedOut?.code !== 0` check cannot catch and only a try/catch around
    // the await can.
    {
      const rec = makeRecorder()
      assert.deepEqual(
        await invokeEngineRun({
          repoDir: engineRepo,
          planPath: ENGINE_PLAN,
          exec: async () => {
            throw new Error('exec seam exploded')
          },
          spawnEngine: rec.spawnEngine,
          log: rec.log,
        }),
        { gateGreen: false, error: `checkout ${BASE_REF} failed` },
      )
      assert.deepEqual(rec.calls, [], 'the engine must not spawn after a failed checkout')
    }
  }

  // -- 14. run-report discovery ----------------------------------------------
  // The engine names its run directory with a stamp it mints itself, so there
  // is no fixed report path to read — the previous constant
  // (`.claude/ultrapowers/fleet-run/report.json`) named a directory the engine
  // never creates, and every token read came back null.
  {
    const discoRepo = path.join(tmp, 'disco-repo')
    fs.mkdirSync(discoRepo, { recursive: true })

    // No artifact directory at all.
    assert.deepEqual(runArtifactDirs(discoRepo), [])
    assert.equal(findRunReportFile(discoRepo), '')
    assert.equal(readReportTokens(findRunReportFile(discoRepo)), null)
    assert.equal(findGateReceiptFile(discoRepo), '')
    assert.equal(readGateGreen(findGateReceiptFile(discoRepo)), false)

    // Two runs, and a non-`run-` sibling that must be ignored entirely.
    writeFile(discoRepo, '.claude/ultrapowers/run-19990101000000/report.json', JSON.stringify({ totalTokens: 11 }))
    writeFile(discoRepo, '.claude/ultrapowers/run-20990101000000/report.json', JSON.stringify({ totalTokens: 22 }))
    writeFile(discoRepo, '.claude/ultrapowers/fleet-run/report.json', JSON.stringify({ totalTokens: 99 }))
    assert.deepEqual(runArtifactDirs(discoRepo), ['run-19990101000000', 'run-20990101000000'])
    assert.equal(findRunReportFile(discoRepo), path.join(discoRepo, '.claude/ultrapowers/run-20990101000000/report.json'))
    assert.equal(readReportTokens(findRunReportFile(discoRepo)), 22, 'the NEWEST run directory wins')

    // A newer run directory carrying only a gate receipt is skipped for the
    // report — a run that gated but never wrote a report must not blank the
    // reading of one that did.
    writeFile(discoRepo, '.claude/ultrapowers/run-21000101000000/gate-receipt.json', JSON.stringify({ verdict: 'PASS' }))
    assert.equal(readReportTokens(findRunReportFile(discoRepo)), 22)

    // Receipt discovery is scoped by FILE NAME, so a report sharing the run
    // directory is never mistaken for a receipt.
    assert.deepEqual(findReceiptFiles(discoRepo), ['.claude/ultrapowers/run-21000101000000/gate-receipt.json'])
    assert.deepEqual(findReceiptFiles(sandboxRepo), [RECEIPT_PATH])

    // `findGateReceiptFile` follows the SAME newest-with-the-file rule as
    // `findRunReportFile`, against its sibling — the run-21000101000000
    // directory is newest overall AND the only one with a receipt, so it wins
    // even though it has no report.json of its own.
    assert.equal(
      findGateReceiptFile(discoRepo),
      path.join(discoRepo, '.claude/ultrapowers/run-21000101000000/gate-receipt.json'),
    )
    assert.equal(readGateGreen(findGateReceiptFile(discoRepo)), true)
  }

  // -- 15. the default exec and spawn seams ----------------------------------
  // Every other test injects over these two, so without this they are the only
  // code in the sandbox that nothing has ever run.
  {
    // `shellExec` resolves — never rejects — and reports the real exit code.
    assert.deepEqual(await shellExec('echo hi'), { code: 0, stdout: 'hi\n' })
    assert.deepEqual(await shellExec('exit 7'), { code: 7, stdout: '' })
    // stderr is deliberately NOT folded into stdout: callers that parse stdout
    // (`rev-parse`, `for-each-ref`) must see exactly what the command printed.
    assert.deepEqual(await shellExec('echo out; echo err 1>&2'), { code: 0, stdout: 'out\n' })
    // A command the shell cannot find is a non-zero code, not a throw.
    const missing = await shellExec('fleet-no-such-binary-9f3a')
    assert.notEqual(missing.code, 0)

    // `spawnEngineProcess` resolves the child's exit code, and a spawn that
    // fails outright resolves 1 rather than rejecting.
    assert.equal(await spawnEngineProcess({ command: '/bin/sh', args: ['-c', 'exit 3'], cwd: tmp }), 3)
    assert.equal(await spawnEngineProcess({ command: '/bin/sh', args: ['-c', 'exit 0'], cwd: tmp }), 0)
    assert.equal(await spawnEngineProcess({ command: path.join(tmp, 'no-such-binary'), args: [], cwd: tmp }), 1)

    // The engine argv is a pinned shape — the plan path is one argument of a
    // single `/ultrapowers <plan>` prompt (followed by the #280 standing
    // directive), not a bare positional.
    assert.equal(ENGINE_COMMAND, 'claude')
    assert.deepEqual(engineArgs('docs/plan.md'),
      ['-p', `/ultrapowers docs/plan.md\n\n${STANDING_DIRECTIVE}`])
    // The directive itself is load-bearing prompt text (#280): pin the grammar
    // hooks SKILL.md Step 5's standing-grant clause reads.
    for (const literal of ['never end a turn on a question', 'NEEDS_ACK',
      'reason runtime or external', 'standing-approval.json FIRST',
      'Type manual is post-merge runbook material', 'BLOCKED']) {
      assert.ok(STANDING_DIRECTIVE.includes(literal),
        'standing directive lost the literal: ' + literal)
    }
  }

  console.log('ALL TESTS PASSED')
} finally {
  cleanup()
}
