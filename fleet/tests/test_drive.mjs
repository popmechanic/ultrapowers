// fleet/tests/test_drive.mjs — sentinel-style spec for the W1 drive-one driver:
// the GATE READ. Receipt resolution, the publish/settle race, evidence capture
// before teardown, a persisted store, and the production receipt writer.
//
// The fixture (two real git repos, the shared exec stub, the stand-in sandbox)
// lives in `_drive_helpers.mjs` — see its header for the transport shape. The
// driver-lifecycle, engine-launch, park and version-stamp scenarios live in
// `test_drive_lifecycle.mjs`; the two files were one until it ran within a few
// seconds of the suite's 120 s per-file cap.
//
// Scenario 1 drives the PRODUCTION sandbox entrypoint — `shim-main.mjs`'s
// `main()` — not a hand-rolled stand-in, so the receipts rows and the
// integration-branch name under test are written by the code that will write
// them in a live run. Only the engine invocation itself is stubbed.
//
// The three ways receipt resolution can fail (absent sha, present-but-unreachable
// sha, wrong branch) each get a scenario. Three hostile/degenerate shapes get
// their own too, because each is a way a green read could be manufactured
// rather than earned: a branch cell carrying shell metacharacters (the sandbox
// writes that cell, the orchestrator shells it), a receipt pointing at a path
// that does not exist in the tree at its sha (which is what a pointer into a
// GITIGNORED directory looks like), and a run that resolves without ever
// publishing anything.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { WebSocket } from 'ws'
import { createMergeableStore } from 'tinybase'
import { createWsSynchronizer } from 'tinybase/synchronizers/synchronizer-ws-client'
import { driveOne } from '../drive.mjs'
import { runShim } from '../shim.mjs'
import { SANDBOX_SSH_OPTS, sandboxGitSsh } from '../provision.mjs'
import {
  applyBranch,
  applyReceipt,
  applyRunReceipts,
  auxStoreId,
  BASE_REF,
  main as shimMain,
  receiptDestination,
  sandboxIdFor,
} from '../shim-main.mjs'
import {
  clock,
  GITHUB_TOKEN,
  INTEGRATION_BRANCH,
  OLDER_BRANCH,
  RECEIPT_PATH,
  RUN_DIR,
  setupDriveFixture,
  sh,
  sleep,
  writeFile,
} from './_drive_helpers.mjs'

const {
  tmp,
  repoDir,
  sandboxRepo,
  originRepo,
  cleanup,
  headSha,
  olderSha,
  integrationSha,
  unreachableSha,
  makeExec,
  startStubSandbox,
  driveDefaults,
} = await setupDriveFixture()

try {
  // -- 1. the happy path, driven by the PRODUCTION sandbox entrypoint --------
  {
    const runId = 'run-drive-1'
    let sandbox = null
    // The run directory THIS run mints. The fixture's `RUN_DIR` already exists
    // before the shim starts — it is the stale leftover a dirty golden image
    // carries, and since #190 production discovery is scoped to the dirs that
    // did not exist at launch, so a stub engine that mints nothing publishes
    // nothing. The stub therefore writes its own receipt mid-run, exactly where
    // the real engine writes one, and the scenario removes it afterwards so the
    // shared sandbox fixture is left as it was found.
    const OWN_RUN_DIR = '.claude/ultrapowers/run-20260821130000'
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
            writeFile(
              sandboxRepo,
              `${OWN_RUN_DIR}/gate-receipt.json`,
              JSON.stringify({ verdict: 'PASS', gate: 'ultra_gate' }),
            )
            return { gateGreen: true }
          },
          // The real run reads its cumulative output-token total from the engine
          // SESSION TRANSCRIPTS (`readSessionTokens`); the engine is stubbed here,
          // so no transcript is written. Inject the reader seam — exactly as the
          // production default `() => readSessionTokens(sessionId)` is injectable —
          // so this exercises the spend read without a real engine or a write into
          // the test user's home directory.
          readTokens: () => 4200,
          // #282 image side: the fixture manifest is 9.9.9; a test must never
          // consult the host machine's real `claude plugin list`.
          readInstalledPlugin: async () => '9.9.9',
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
    // Full equality on purpose — an added or renamed key in the shim outcome
    // must fail here loudly, never slide by a partial match. `delivered: true`
    // is part of the contract since #299 (deliverAndClose consumed).
    assert.deepEqual(await sandbox, { status: 'gate-green', delivered: true })

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
        `git -C ${repoDir} -c core.sshCommand="${sandboxGitSsh}" fetch ssh://exedev@fleet-${runId}.exe.xyz/home/exedev/repo ${INTEGRATION_BRANCH}`,
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
    const fetchIdx = exec.cmds.findIndex((c) => /^git -C \S+ -c core\.sshCommand="[^"]*" fetch ssh:\/\/exedev@fleet-run-drive-1\.exe\.xyz/.test(c))
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
    const pullIdx = exec.cmds.findIndex((c) => c.startsWith(`ssh -o BatchMode=yes -o ConnectTimeout=10 ${SANDBOX_SSH_OPTS} fleet-run-drive-1.exe.xyz 'cd /home/exedev && tar czf - shim.log fleet-run.json .claude/projects `))
    const rmIdx = exec.cmds.findIndex((c) => c === `ssh exe.dev "rm fleet-${runId} --json"`)
    assert.ok(pullIdx >= 0, `expected a sandbox log pull, got: ${JSON.stringify(exec.cmds)}`)
    assert.ok(pullIdx < rmIdx, 'sandbox logs are pulled BEFORE the sandbox is destroyed')
    assert.equal(exec.cmds.filter((c) => /tar czf - shim\.log/.test(c)).length, 1, 'the log pull fires exactly once')
    const pullCmd = exec.cmds[pullIdx]
    assert.ok(/repo\/\.claude\/ultrapowers\/run-/.test(pullCmd) || /run-\*\//.test(pullCmd), `the pull must include the gitignored run dirs, got: ${pullCmd}`)
    assert.ok(/> \S+\/sandbox-logs\.tgz$/.test(pullCmd), `the pull must land in a sandbox-logs.tgz, got: ${pullCmd}`)
    // Destination lives beside the gate read, in the EVIDENCE dir — never
    // inside `dbDir`, which is the persister dir an operator wipes for a
    // fresh-store experiment. Evidence must survive that wipe.
    const dest = pullCmd.match(/> (\S+\/sandbox-logs\.tgz)$/)[1]
    assert.ok(dest.startsWith(path.join(tmp, 'db1-evidence')),
      'log destination must be under evidenceDir, never under dbDir: ' + dest)
    assert.ok(!dest.startsWith(path.join(tmp, 'db1', 'sandbox-logs')),
      'evidence must not live inside the persister dir')
    assert.ok(fs.existsSync(path.dirname(dest)), 'the destination directory is created before the pull runs')
    // ...and the gate read defaults there too, beside the archive.
    assert.equal(reportPath, path.join(tmp, 'db1-evidence', `gate-read-${runId}.json`))
    assert.equal(detail.sandboxLogs, dest, 'the detail names where the evidence landed')
    // The tunnel is torn down with the sandbox (#196): after the rm. The
    // orchestrator bound an ephemeral port (`port: 0`); `detail.effectivePort`
    // is the read-back channel for the port it actually bound.
    const killIdx = exec.cmds.findIndex((c) => c.startsWith('pkill -f ') && c.includes(`[-]R ${detail.effectivePort}:127.0.0.1:${detail.effectivePort} fleet-${runId}.exe.xyz`))
    assert.ok(killIdx > rmIdx, `the tunnel kill follows the rm, got: ${JSON.stringify(exec.cmds)}`)
    // And the tunnel was opened before the shim started.
    const tunnelIdx = exec.cmds.findIndex((c) => c === `ssh -o BatchMode=yes -o ExitOnForwardFailure=yes ${SANDBOX_SSH_OPTS} -fN -R ${detail.effectivePort}:127.0.0.1:${detail.effectivePort} fleet-${runId}.exe.xyz`)
    const shimIdx = exec.cmds.findIndex((c) => /nohup node .*shim-main\.mjs/.test(c))
    assert.ok(tunnelIdx >= 0 && tunnelIdx < shimIdx, `the reverse tunnel opens before the shim starts, got: ${JSON.stringify(exec.cmds)}`)

    // The delivered assignment carried the orchestrator's own ws URL and port —
    // and the PLAN. `planPath` is the sandbox's only source for what it was
    // dispatched to run: the shim reads its assignment file before it has
    // synced any store row, so a driver that does not forward it launches the
    // engine with a literal `undefined` plan path.
    assert.equal(exec.delivered.runId, runId)
    assert.equal(exec.delivered.wsUrl, `ws://127.0.0.1:${detail.effectivePort}/fleet`)
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

    // Scoping, end to end (#190): the stale `RUN_DIR` receipt sat on disk the
    // whole run and was NOT the one published — the committed copy is this
    // run's own, and the pre-run leftover stayed exactly where it was.
    assert.equal(
      (await sh(`git -C "${sandboxRepo}" show ${receiptsSha}:${committedReceipt}`)).stdout,
      JSON.stringify({ verdict: 'PASS', gate: 'ultra_gate' }),
    )
    assert.ok(fs.existsSync(path.join(sandboxRepo, RECEIPT_PATH)), 'the stale leftover must be left untouched')

    // #368, on the PRODUCTION publish path: the receipt row `main()` wrote is
    // the pointer the publish leg reads the body from, the receipts commit it
    // made is the tip that reaches origin as-is, and the PR is a normal one.
    // The leg's full contract is pinned in test_drive_pr.mjs; this pins that
    // the production writer and the leg agree on the pointer.
    assert.deepEqual(detail.pullRequest, { number: 4242, url: 'https://github.com/popmechanic/ultrapowers/pull/4242', draft: false, branch: INTEGRATION_BRANCH })
    assert.ok(
      exec.cmds.includes(`git -C ${repoDir} -c credential.helper= -c credential.helper='!gh auth git-credential' push origin ${receiptsSha}:refs/heads/${INTEGRATION_BRANCH}`),
      `the receipts commit is the tip pushed to origin, got: ${JSON.stringify(exec.cmds.filter((c) => / push origin /.test(c)))}`,
    )
    assert.equal((await sh(`git -C "${originRepo}" rev-parse refs/heads/${INTEGRATION_BRANCH}`)).stdout.trim(), receiptsSha)
    assert.ok(exec.cmds.includes(`git -C ${repoDir} show ${receiptsSha}:${committedReceipt}`), 'the body is rendered from the committed receipt')
    assert.ok(!exec.cmds.some((c) => c.includes(GITHUB_TOKEN)), 'the token never reaches a command line')

    // Hand the shared fixture back the way it was found: the run's own dir is
    // scenario-local, and later scenarios pin discovery against `RUN_DIR` alone.
    fs.rmSync(path.join(sandboxRepo, OWN_RUN_DIR), { recursive: true, force: true })
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
      exec.cmds.includes(`git -C ${repoDir} -c core.sshCommand="${sandboxGitSsh}" fetch ssh://exedev@fleet-${runId}.exe.xyz/home/exedev/repo ${OLDER_BRANCH}`),
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
    // #368: a gate-green status whose receipts do not resolve is a defect to
    // diagnose, not a PR to open — nothing is pushed, and the detail says why.
    assert.equal(detail.pullRequest, null)
    assert.ok(!exec.cmds.some((c) => / push origin | gh pr create /.test(c)), 'no push, no PR for unresolvable receipts')
    assert.ok(
      detail.errors.includes(`PR not opened: gate-green but receipts unresolvable on ${INTEGRATION_BRANCH} — diagnose before publishing`),
      JSON.stringify(detail.errors),
    )
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

  // -- the control-plane capture fixtures ------------------------------------
  // Trimmed copies of the REAL payloads captured off exe.dev on 2026-08-26 —
  // shape, key names and units are the control plane's, not this spec's, so a
  // shape change upstream fails here rather than silently reading null in a
  // live run. `stat` is a 10-minute sampler, which is why the derived peaks are
  // a floor estimate; two points is enough to pin peak AND mean.
  //
  // The VM these were captured from is `fleet-r1`, so the scenarios below drive
  // `runId: 'r1'` — `sandboxIdFor` derives `fleet-<runId>`.
  const STAT_FIXTURE = JSON.stringify({
    name: 'fleet-r1',
    status: 'running',
    range: '24h',
    points: [
      {
        timestamp: '2026-08-25T08:10:56Z',
        cpu_cores: 0.01,
        cpu_nominal: 8,
        mem_used_bytes: 1064488960,
        mem_total_bytes: 17179869184,
      },
      {
        timestamp: '2026-08-25T08:20:56Z',
        cpu_cores: 3.5,
        cpu_nominal: 8,
        mem_used_bytes: 9064488960,
        mem_total_bytes: 17179869184,
      },
    ],
  })
  const STAT_CMD = /"stat \S+ --json --range=24h"/

  // `makeExec` with the control-plane stat capture stubbed. Anything the stub
  // does NOT claim falls through to the shared exec, so the rest of the run —
  // the tunnel, the shim start, the real git traffic, the teardown — is
  // unchanged. The stub may be a result object or a function (which may throw,
  // standing in for an ssh that never connected).
  const makeCaptureExec = (onShimStart, { stat }) => {
    const inner = makeExec(onShimStart)
    const exec = async (cmd) => {
      if (STAT_CMD.test(cmd) && stat !== undefined) {
        inner.cmds.push(cmd)
        return typeof stat === 'function' ? stat(cmd) : stat
      }
      return inner(cmd)
    }
    exec.cmds = inner.cmds
    return exec
  }

  // -- 7c. stat is captured BEFORE teardown, raw and derived ------------------
  // The sandbox's own resource peak exists only while the VM does. It is
  // captured on the same pre-teardown leg as the log pull, the RAW payload is
  // kept so an upstream shape change is diagnosable from the artifact, and the
  // derived field rides the detail.
  {
    const runId = 'r1'
    const evidenceDir = path.join(tmp, 'evidence-r1')
    let sandbox = null
    const exec = makeCaptureExec(
      (assignment) => {
        setTimeout(() => {
          sandbox = startStubSandbox({
            assignment,
            runId,
            receiptSha: olderSha,
            exec,
            branch: OLDER_BRANCH,
            receiptPath: 'old.txt',
          })
        }, 30)
      },
      { stat: { code: 0, stdout: STAT_FIXTURE } },
    )

    const res = await driveOne({ ...driveDefaults, dbDir: path.join(tmp, 'db7c'), evidenceDir, exec, runId })
    await sandbox

    assert.deepEqual(res.detail.sandboxStat, { peakCores: 3.5, meanCores: 1.755, peakMemBytes: 9064488960 })
    assert.ok(fs.existsSync(path.join(evidenceDir, `stat-${runId}.json`)), 'raw stat.json written')
    // RAW, byte for byte — the artifact is the control plane's answer, not a
    // re-serialization of what this process managed to parse out of it.
    assert.equal(fs.readFileSync(path.join(evidenceDir, `stat-${runId}.json`), 'utf8'), STAT_FIXTURE)
    // The capture names THIS vm and rides the validated command builder. It
    // targets `exe.dev` (the lobby control plane, not the sandbox itself), so
    // it carries none of the sandbox no-pin host-key flags (#211).
    assert.ok(
      exec.cmds.includes(`ssh -o BatchMode=yes -o ConnectTimeout=10 exe.dev "stat fleet-${runId} --json --range=24h"`),
      `expected the stat capture, got: ${JSON.stringify(exec.cmds)}`,
    )
    for (const cmd of exec.cmds.filter((c) => STAT_CMD.test(c))) {
      assert.ok(
        !cmd.includes('StrictHostKeyChecking') && !cmd.includes('UserKnownHostsFile'),
        `the lobby stat capture must carry no host-key flags, got: ${cmd}`,
      )
    }
    // The capture happens while the VM still exists.
    const rmIdx = exec.cmds.findIndex((c) => c === `ssh exe.dev "rm fleet-${runId} --json"`)
    const statIdx = exec.cmds.findIndex((c) => STAT_CMD.test(c))
    assert.ok(rmIdx >= 0, `expected the teardown command, got: ${JSON.stringify(exec.cmds)}`)
    assert.ok(statIdx >= 0 && statIdx < rmIdx, 'stat is captured before the sandbox is destroyed')
    // Evidence never lands in the persister dir.
    assert.ok(!fs.existsSync(path.join(tmp, 'db7c', `stat-${runId}.json`)), 'evidence must not live inside dbDir')
    assert.equal(res.reportPath, path.join(evidenceDir, `gate-read-${runId}.json`))
    assert.equal(res.detailPath, path.join(evidenceDir, `gate-read-${runId}.detail.json`))
    assert.deepEqual(JSON.parse(fs.readFileSync(res.detailPath, 'utf8')).sandboxStat, res.detail.sandboxStat)
  }

  // -- 7d. a malformed-but-valid stat payload degrades to null, never throws ---
  // `points` as an OBJECT parses fine and then explodes any code that assumes an
  // array. An unguarded throw here would escape `pullLogsOnce` and skip
  // `destroySandbox` — leaking a billed VM, which is the one outcome teardown
  // exists to prevent (#280, run-9b's in-sandbox critic).
  {
    const runId = 'r1d'
    const evidenceDir = path.join(tmp, 'evidence-r1d')
    const malformed = JSON.stringify({ name: 'fleet-r1d', points: { '0': { cpu_cores: 1.5 } } })
    let sandbox = null
    const exec = makeCaptureExec(
      (assignment) => {
        setTimeout(() => {
          sandbox = startStubSandbox({
            assignment,
            runId,
            receiptSha: olderSha,
            exec,
            branch: OLDER_BRANCH,
            receiptPath: 'old.txt',
          })
        }, 30)
      },
      { stat: { code: 0, stdout: malformed } },
    )

    const res = await driveOne({ ...driveDefaults, dbDir: path.join(tmp, 'db7d'), evidenceDir, exec, runId })
    await sandbox

    assert.equal(res.detail.sandboxStat, null, 'a payload with no usable sample reads null')
    assert.ok(
      res.detail.errors.some((e) => /stat/.test(e)),
      `the failed derivation is recorded, got: ${JSON.stringify(res.detail.errors)}`,
    )
    // The raw artifact survives regardless — that is how an upstream shape
    // change gets diagnosed rather than guessed at.
    assert.equal(fs.readFileSync(path.join(evidenceDir, `stat-${runId}.json`), 'utf8'), malformed)
    assert.ok(
      exec.cmds.includes(`ssh exe.dev "rm fleet-${runId} --json"`),
      `the sandbox is destroyed anyway, got: ${JSON.stringify(exec.cmds)}`,
    )
  }

  // -- 7e. a stat capture that never connects never blocks teardown ----------
  {
    const runId = 'r1e'
    const evidenceDir = path.join(tmp, 'evidence-r1e')
    let sandbox = null
    const exec = makeCaptureExec(
      (assignment) => {
        setTimeout(() => {
          sandbox = startStubSandbox({
            assignment,
            runId,
            receiptSha: olderSha,
            exec,
            branch: OLDER_BRANCH,
            receiptPath: 'old.txt',
          })
        }, 30)
      },
      {
        stat: () => {
          throw new Error('ssh: connect to host exe.dev port 22: Connection timed out')
        },
      },
    )

    const res = await driveOne({ ...driveDefaults, dbDir: path.join(tmp, 'db7e'), evidenceDir, exec, runId })
    await sandbox

    assert.equal(res.detail.sandboxStat, null)
    assert.ok(
      res.detail.errors.some((e) => /stat/.test(e) && /Connection timed out/.test(e)),
      `the failed stat capture is recorded, got: ${JSON.stringify(res.detail.errors)}`,
    )
    assert.ok(
      exec.cmds.includes(`ssh exe.dev "rm fleet-${runId} --json"`),
      `destroySandbox still runs after a failed capture, got: ${JSON.stringify(exec.cmds)}`,
    )
    // A capture that never returned has no raw payload to keep.
    assert.ok(!fs.existsSync(path.join(evidenceDir, `stat-${runId}.json`)), 'no stat.json for a capture that never ran')
  }

  // -- 7g. a PERSISTED dbDir does not perturb the next run's gate read --------
  // `dbDir` is a persister dir, kept across runs — the RUNBOOK tells operators
  // never to `rm` it. That is only safe if every read the gate makes is scoped
  // by `runId`: run 2 must sum its own receipts, judge its own claim, and see
  // the guard converge nothing about run 1's rows. Evidence lives outside the
  // store, so each run gets its own `evidenceDir` while the store is shared.
  {
    const sharedDb = path.join(tmp, 'db-persist')
    const runIdA = 'run-persist-a'
    const runIdB = 'run-persist-b'

    let sandboxA = null
    const execA = makeExec((assignment) => {
      setTimeout(() => {
        sandboxA = startStubSandbox({
          assignment,
          runId: runIdA,
          receiptSha: olderSha,
          exec: execA,
          branch: OLDER_BRANCH,
          receiptPath: 'old.txt',
        })
      }, 30)
    })
    const first = await driveOne({
      ...driveDefaults,
      dbDir: sharedDb,
      evidenceDir: path.join(tmp, 'evidence-persist-a'),
      exec: execA,
      runId: runIdA,
    })
    await sandboxA
    assert.equal(first.read.o1, true, 'run 1 must be green, or run 2 proves nothing')
    assert.deepEqual(first.read.spendObservational, { reported: 4200, ledger: 4200 })
    assert.ok(fs.existsSync(sharedDb), 'the store dir persists after run 1')

    let sandboxB = null
    const execB = makeExec((assignment) => {
      setTimeout(() => {
        sandboxB = startStubSandbox({
          assignment,
          runId: runIdB,
          receiptSha: olderSha,
          exec: execB,
          branch: OLDER_BRANCH,
          receiptPath: 'old.txt',
        })
      }, 30)
    })
    const second = await driveOne({
      ...driveDefaults,
      dbDir: sharedDb,
      evidenceDir: path.join(tmp, 'evidence-persist-b'),
      exec: execB,
      runId: runIdB,
    })
    await sandboxB

    // The spend read sums run 2's receipts ONLY — an unscoped sum would read
    // 8400 here, because run 1's spend rows are still in the store.
    assert.deepEqual(second.read.spendObservational, { reported: 4200, ledger: 4200 })
    // The claim read judges run 2's claim only: one epoch, never expired,
    // never revoked. Run 1's resolved claim is still a row in the same table.
    assert.equal(second.read.leaseContinuity, true)
    assert.deepEqual(second.detail.epochs, [1])
    // And the guard raises nothing about run 1's rows: a persisted store is
    // baselined, not re-judged.
    assert.deepEqual(second.detail.convergedAway, [])
    assert.deepEqual(second.detail.pages, [])
    assert.equal(second.read.o1, true, 'a persisted store must not sink the next run')
    // The receipts under verification are run 2's, by row id.
    assert.deepEqual(
      second.detail.receipts.map((r) => r.rowId),
      [`${runIdB}:gate`],
    )
    // Run 1's evidence was never touched by run 2 — that is the whole point of
    // keeping it outside `dbDir`.
    assert.ok(fs.existsSync(first.reportPath), "run 1's gate read survives run 2")
    assert.notEqual(first.reportPath, second.reportPath)
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

  // -- 12. #336: a parked run whose branch could NOT be fetched reads null ----
  // run-15's residual: the fetch leg failed (or the branch cell was unsafe)
  // and parkedPublish still came back non-null, shaped {branch:null,
  // fetched:false} — which the RUNBOOK reads as "the work survived". It did
  // not: the branch dies with the sandbox at teardown. Non-null now means
  // exactly "fetched into repoDir"; the reason it was not is in `errors`.
  // (The fetched shape is pinned by N1 in test_drive_lifecycle.mjs.)
  {
    const runId = 'run-drive-336-nofetch'
    // A perfectly safe branch name that exists in NO repo — the real
    // `git fetch` (retargeted onto the stand-in sandbox repo) fails on it.
    const ghostBranch = 'ultra/integration-00000000000000'
    let sandbox = null
    const exec = makeExec((assignment) => {
      setTimeout(() => {
        sandbox = startStubSandbox({
          assignment,
          runId,
          receiptSha: integrationSha,
          receiptPath: RECEIPT_PATH,
          exec,
          branch: ghostBranch,
          gateGreen: false,
        })
      }, 30)
    })

    const { read, detail } = await driveOne({
      ...driveDefaults,
      parkedPublishWaitMs: 8_000,
      dbDir: path.join(tmp, 'db-336-nofetch'),
      exec,
      runId,
    })
    await sandbox

    assert.equal(detail.status, 'parked')
    assert.ok(
      exec.cmds.some((cmd) => new RegExp(` fetch ssh://\\S+ ${ghostBranch}$`).test(cmd)),
      `the fetch must have been ATTEMPTED (this is the fetch-failed path, not the unsafe path), got: ${JSON.stringify(exec.cmds.filter((c) => c.includes('fetch')))}`,
    )
    assert.equal(detail.parkedPublish, null, 'a branch that was not fetched did not survive — null, never {branch:null, fetched:false}')
    assert.ok(
      detail.errors.some((e) => new RegExp(`^fetch ${ghostBranch} failed \\(code \\d+\\)$`).test(e)),
      `the failed fetch is on the record, got: ${JSON.stringify(detail.errors)}`,
    )
    assert.equal(read.o1, false)
    assert.equal(read.receiptsResolvable, false, 'a park never brightens the gate read')
    assert.ok(!detail.errors.includes('publish timeout'), 'a parked publish is never a publish timeout')
  }

  // -- 12b. …and an UNSAFE branch cell on a parked run reads null the same way
  // The guard refuses before the shell (scenario 5's posture, on the parked
  // path); the object must not exist for a branch nothing fetched.
  {
    const runId = 'run-drive-336-unsafe'
    const pwned = path.join(tmp, 'pwned-336')
    let sandbox = null
    const exec = makeExec((assignment) => {
      setTimeout(() => {
        sandbox = startStubSandbox({
          assignment,
          runId,
          receiptSha: headSha,
          exec,
          rawBranch: `main; touch ${pwned}`,
          gateGreen: false,
        })
      }, 30)
    })

    const { read, detail } = await driveOne({
      ...driveDefaults,
      parkedPublishWaitMs: 8_000,
      dbDir: path.join(tmp, 'db-336-unsafe'),
      exec,
      runId,
    })
    await sandbox

    assert.equal(detail.status, 'parked')
    assert.equal(detail.parkedPublish, null, 'an unsafe branch cell was never fetched — null')
    assert.ok(
      detail.errors.some((e) => e.includes('unsafe branch')),
      `expected an explicit unsafe-branch error, got: ${JSON.stringify(detail.errors)}`,
    )
    assert.ok(!exec.cmds.some((cmd) => cmd.includes('pwned-336')), 'the injected command must never reach exec')
    assert.equal(fs.existsSync(pwned), false, 'the injected command must not have run')
    assert.equal(read.o1, false)
  }

  // -- 13. #337: the fitness preflight reads the plan AS COMMITTED AT baseRef --
  // The sandbox executes the plan the driver PUSHES (baseRef), never the
  // driver's working tree. These four scenarios pin the source and the two
  // divergences that are refused as operator errors. Plans are committed onto
  // side branches through a temporary index — HEAD, the working tree and the
  // fixture shas every other scenario relies on are untouched.
  const commitPlanOnBranch = async ({ branch, relPath, text }) => {
    const tag = branch.replace(/[^A-Za-z0-9]/g, '_')
    const idx = path.join(tmp, `${tag}.idx`)
    const blobFile = path.join(tmp, `${tag}.blob`)
    fs.writeFileSync(blobFile, text)
    const r = await sh(
      `set -e; blob=$(git hash-object -w "${blobFile}"); ` +
        `GIT_INDEX_FILE="${idx}" git read-tree main; ` +
        `GIT_INDEX_FILE="${idx}" git update-index --add --cacheinfo 100644,$blob,${relPath}; ` +
        `tree=$(GIT_INDEX_FILE="${idx}" git write-tree); ` +
        `commit=$(git commit-tree $tree -p main -m ${branch}); ` +
        `git branch ${branch} $commit; printf '%s' $commit`,
      repoDir,
    )
    assert.equal(r.code, 0, `commitPlanOnBranch(${branch}) failed: ${r.stderr}`)
    const sha = r.stdout.trim()
    assert.match(sha, /^[0-9a-f]{40}$/)
    return sha
  }
  const UNFIT_PLAN =
    '# P\n\n### Task 1: Docs only\n**Type:** implementation\n**Depends-on:** none\n\n**Files:**\n- Modify: `docs/a.md`\n\n- [ ] **Step 1: edit**\n'
  const FIT_PLAN =
    '# P\n\n### Task 1: Code\n**Type:** implementation\n**Depends-on:** none\n\n**Files:**\n- Modify: `fleet/x.mjs`\n- Test: `fleet/tests/test_x.mjs`\n\n- [ ] **Step 1: edit**\n'
  const unfitRel = 'docs/committed-unfit.md'
  const fitRel = 'docs/committed-fit.md'
  await commitPlanOnBranch({ branch: 'plan-unfit', relPath: unfitRel, text: UNFIT_PLAN })
  const fitSha = await commitPlanOnBranch({ branch: 'plan-fit', relPath: fitRel, text: FIT_PLAN })
  const neverProvision = async () => {
    throw new Error('must never provision on a #337 refusal')
  }

  // 13a. the silent-pass direction: an UNFIT plan committed at baseRef with NO
  //      working-tree copy at all is refused — the source is baseRef, not disk.
  {
    assert.equal(fs.existsSync(path.join(repoDir, unfitRel)), false, 'precondition: absent from the working tree')
    let provisioned = false
    await assert.rejects(
      driveOne({
        ...driveDefaults,
        planPath: unfitRel,
        baseRef: 'plan-unfit',
        dbDir: path.join(tmp, 'db-337a'),
        exec: makeExec(() => {}),
        runId: 'run-drive-337-committed-unfit',
        provision: async () => {
          provisioned = true
          return neverProvision()
        },
      }),
      /headless-unfit/,
    )
    assert.equal(provisioned, false, 'the refusal must precede provisioning')
    // #362-6: the refusal precedes the orchestrator start AND teardown — no
    // store dir, no evidence dir (scenario 18 in test_drive_lifecycle.mjs is
    // the pattern). Pinned so a later reordering of the preflight is caught.
    assert.equal(fs.existsSync(path.join(tmp, 'db-337a')), false, 'refusal must precede the orchestrator start — no store dir may exist')
    assert.equal(fs.existsSync(path.join(tmp, 'db-337a-evidence')), false, 'refusal must precede teardown captures — no evidence dir may exist')
  }

  // 13b. the dirty direction: a FIT plan at baseRef whose working-tree copy
  //      differs is refused, naming both sides — and allowUnfitPlan does NOT
  //      cover it (it is an operator error, not a fitness verdict).
  {
    fs.mkdirSync(path.join(repoDir, 'docs'), { recursive: true })
    fs.writeFileSync(path.join(repoDir, fitRel), UNFIT_PLAN)
    let provisioned = false
    await assert.rejects(
      driveOne({
        ...driveDefaults,
        planPath: fitRel,
        baseRef: 'plan-fit',
        allowUnfitPlan: true,
        dbDir: path.join(tmp, 'db-337b'),
        exec: makeExec(() => {}),
        runId: 'run-drive-337-dirty',
        provision: async () => {
          provisioned = true
          return neverProvision()
        },
      }),
      (error) => {
        assert.match(error.message, /differs between plan-fit:docs\/committed-fit\.md/)
        assert.ok(error.message.includes(path.join(repoDir, fitRel)), `must name the working-tree path, got: ${error.message}`)
        assert.match(error.message, /#337/)
        return true
      },
    )
    assert.equal(provisioned, false, 'the refusal must precede provisioning')
    // #362-6: the refusal precedes the orchestrator start AND teardown — no
    // store dir, no evidence dir (scenario 18 in test_drive_lifecycle.mjs is
    // the pattern). Pinned so a later reordering of the preflight is caught.
    assert.equal(fs.existsSync(path.join(tmp, 'db-337b')), false, 'refusal must precede the orchestrator start — no store dir may exist')
    assert.equal(fs.existsSync(path.join(tmp, 'db-337b-evidence')), false, 'refusal must precede teardown captures — no evidence dir may exist')
  }

  // 13c. the uncommitted direction: a plan in the working tree but ABSENT at
  //      baseRef (HEAD here — main never carried it) is refused: the sandbox
  //      would receive nothing.
  {
    let provisioned = false
    await assert.rejects(
      driveOne({
        ...driveDefaults,
        planPath: fitRel,
        allowUnfitPlan: true,
        dbDir: path.join(tmp, 'db-337c'),
        exec: makeExec(() => {}),
        runId: 'run-drive-337-uncommitted',
        provision: async () => {
          provisioned = true
          return neverProvision()
        },
      }),
      /not committed at HEAD/,
    )
    assert.equal(provisioned, false, 'the refusal must precede provisioning')
    // #362-6: the refusal precedes the orchestrator start AND teardown — no
    // store dir, no evidence dir (scenario 18 in test_drive_lifecycle.mjs is
    // the pattern). Pinned so a later reordering of the preflight is caught.
    assert.equal(fs.existsSync(path.join(tmp, 'db-337c')), false, 'refusal must precede the orchestrator start — no store dir may exist')
    assert.equal(fs.existsSync(path.join(tmp, 'db-337c-evidence')), false, 'refusal must precede teardown captures — no evidence dir may exist')
  }

  // 13d. control: a FIT plan at baseRef with an IDENTICAL working-tree copy
  //      drives normally — no refusal, no override line, stamp cross-check
  //      against the side branch resolves.
  {
    fs.writeFileSync(path.join(repoDir, fitRel), FIT_PLAN)
    const runId = 'run-drive-337-clean'
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
          stamp: { pluginVersion: '9.9.9', engineSha: fitSha },
        })
      }, 30)
    })
    const { read, detail } = await driveOne({
      ...driveDefaults,
      planPath: fitRel,
      baseRef: 'plan-fit',
      dbDir: path.join(tmp, 'db-337d'),
      exec,
      runId,
    })
    await sandbox
    assert.equal(read.o1, true, 'a clean committed plan drives normally')
    assert.equal(read.versionStamp, true, 'the stamp expectation resolved from the side branch')
    assert.ok(
      !detail.errors.some((e) => /headless|#337/.test(e)),
      `no fitness or #337 noise on the clean path, got: ${JSON.stringify(detail.errors)}`,
    )
    assert.ok(
      exec.cmds.some((cmd) => cmd === `git -C ${repoDir} show plan-fit:${fitRel}`),
      `the plan must have been read from baseRef, got: ${JSON.stringify(exec.cmds.filter((c) => c.includes(' show ')))}`,
    )
    // Leave the fixture as found for whatever scenario is unioned after this.
    fs.rmSync(path.join(repoDir, fitRel))
  }

  // -- 13e. #362-1: stderr chatter on `git show` must not read as a dirty plan
  // The production seam used to fold stderr into stdout, so a `warning:` line
  // from `git show <baseRef>:<plan>` made `workingText !== committedText`
  // fire on a clean, committed plan — a hard refusal with no override. The
  // seam is pinned pure in test_drive_one.mjs; this pins the other half: the
  // preflight compares `stdout` ONLY and ignores a `stderr` field. Own side
  // branch, own file, cleaned up below — order-independent of 13f/13g.
  {
    const chatterRel = 'docs/committed-chatter.md'
    const chatterSha = await commitPlanOnBranch({ branch: 'plan-chatter', relPath: chatterRel, text: FIT_PLAN })
    fs.mkdirSync(path.join(repoDir, 'docs'), { recursive: true })
    fs.writeFileSync(path.join(repoDir, chatterRel), FIT_PLAN)
    const runId = 'run-drive-362-chatter'
    let sandbox = null
    let chattered = 0
    const inner = makeExec((assignment) => {
      setTimeout(() => {
        sandbox = startStubSandbox({
          assignment,
          runId,
          receiptSha: olderSha,
          exec,
          branch: OLDER_BRANCH,
          receiptPath: 'old.txt',
          stamp: { pluginVersion: '9.9.9', engineSha: chatterSha },
        })
      }, 30)
    })
    // Wraps the fixture exec; `opts` (#368's per-command env) rides through.
    // Matched by exact command (not a `show plan-chatter:` prefix, which the
    // #282 stamp cross-check's own `git show plan-chatter:<manifest>` also
    // satisfies) so only the #337 preflight's read of the plan itself chatters.
    const exec = async (cmd, opts) => {
      const result = await inner(cmd, opts)
      if (cmd === `git -C ${repoDir} show plan-chatter:${chatterRel}`) {
        chattered += 1
        return { ...result, stderr: `warning: fixture chatter on stderr (#362)\n${result.stderr ?? ''}` }
      }
      return result
    }
    exec.cmds = inner.cmds
    exec.calls = inner.calls
    const { read, detail } = await driveOne({
      ...driveDefaults,
      planPath: chatterRel,
      baseRef: 'plan-chatter',
      dbDir: path.join(tmp, 'db-362e'),
      exec,
      runId,
    })
    await sandbox
    assert.equal(chattered, 1, 'the plan must have been read from baseRef through the chattering exec')
    assert.equal(read.o1, true, 'stderr chatter on git show must not refuse a clean committed plan')
    assert.equal(read.versionStamp, true, 'the stamp expectation resolved from the side branch')
    assert.ok(
      !detail.errors.some((e) => /headless|#337|differs between/.test(e)),
      `no fitness or #337 noise on the clean path, got: ${JSON.stringify(detail.errors)}`,
    )

    // #362-4: `git show` emits the raw blob; the working tree is the smudged
    // checkout. The byte-for-byte comparison above assumes they coincide,
    // which holds only while NO .gitattributes (eol/text/filter) covers the
    // plans. Pinned here so adding one surfaces as this line, not as every
    // clean live drive refusing with `differs between …`.
    const repoRoot = decodeURIComponent(new URL('../..', import.meta.url).pathname)
    const attrs = await sh('git ls-files -- .gitattributes "*/.gitattributes"', repoRoot)
    assert.equal(attrs.code, 0, `git ls-files failed: ${attrs.stderr}`)
    assert.equal(
      attrs.stdout.trim(),
      '',
      'a .gitattributes entered the repo — the #337 byte-equality check now needs to compare smudged text (#362-4)',
    )

    // Leave the fixture as found.
    fs.rmSync(path.join(repoDir, chatterRel))
    assert.equal((await sh('git branch -D plan-chatter', repoDir)).code, 0)
  }

  console.log('ALL TESTS PASSED')
} finally {
  cleanup()
}
