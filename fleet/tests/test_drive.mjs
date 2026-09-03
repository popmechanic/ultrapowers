// fleet/tests/test_drive.mjs — sentinel-style spec for the W1 drive-one driver:
// the GATE READ. Receipt resolution and the two parked-run reads.
//
// The fixture (two real git repos, the shared exec stub, the stand-in sandbox)
// lives in `_drive_helpers.mjs` — see its header for the transport shape. The
// driver-lifecycle, engine-launch, park and version-stamp scenarios live in
// `test_drive_lifecycle.mjs`; evidence capture and the publish leg live in
// `test_drive_evidence.mjs`; the #337/#362 fitness preflight lives in
// `test_drive_fitness.mjs`. All four were one file until it ran within a few
// seconds of the suite's 120 s per-file cap — and, once split, grew back to
// 46.8 s of a 73 s suite wall, since the suite schedules whole FILES (#460).
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
import { driveOne } from '../drive.mjs'
import { SANDBOX_SSH_OPTS, sandboxGitSsh } from '../provision.mjs'
import { ENGINE_REF, main as shimMain } from '../shim-main.mjs'
import {
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
          // Live these are two directories — the golden's engine clone and the
          // pushed target. The one stand-in repo carries both refs, so it plays
          // both ends and the stamp stays the fixture checkout's own identity.
          engineDir: sandboxRepo,
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
    // #497 follow-up: the operand is the tip PINNED AT FETCH TIME, never
    // `FETCH_HEAD`. `repoDir` has one default and the RUNBOOK tells operators
    // that concurrent drains take distinct ports and db-dirs — never a distinct
    // repo dir — so two concurrent drives share one `FETCH_HEAD`. Drive B's
    // fetch lands over drive A's, and A's reachability check then answers a
    // question about B's branch: a green run reads `receiptsResolvable: false`
    // and strands. #368 pinned the sha for the PUSH leg for exactly this
    // reason; this leg was left behind.
    // The fetched tip IS `receiptsSha` here — line ~145 pins that the receipts
    // commit advances the integration branch — so the operand is that sha.
    const ancIdx = exec.cmds.findIndex(
      (c) => c === `git -C ${repoDir} merge-base --is-ancestor ${receiptsSha} ${receiptsSha}`,
    )
    assert.ok(
      !exec.cmds.some((c) => c.includes('merge-base --is-ancestor') && c.includes('FETCH_HEAD')),
      `no reachability check may read FETCH_HEAD, got: ${JSON.stringify(exec.cmds.filter((c) => c.includes('merge-base')))}`,
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
    const pullIdx = exec.cmds.findIndex((c) => c.startsWith(`ssh -o BatchMode=yes -o ConnectTimeout=10 ${SANDBOX_SSH_OPTS} fleet-run-drive-1.exe.xyz 'cd /home/exedev && tar czf - --exclude="repo/.claude/ultrapowers/run-*/clones" shim.log fleet-run.json .claude/projects `))
    const rmIdx = exec.cmds.findIndex((c) => c === `ssh exe.dev "rm fleet-${runId} --json"`)
    assert.ok(pullIdx >= 0, `expected a sandbox log pull, got: ${JSON.stringify(exec.cmds)}`)
    assert.ok(pullIdx < rmIdx, 'sandbox logs are pulled BEFORE the sandbox is destroyed')
    assert.equal(exec.cmds.filter((c) => /tar czf - --exclude=[^ ]* shim\.log/.test(c)).length, 1, 'the log pull fires exactly once')
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

    // The stamp names the code that RAN. `main()` stamps BEFORE the run, and
    // the run is what moves the target's checkout — first onto the pushed base,
    // then onto the engine's integration branch — so a stamp read from a
    // checkout names whatever the golden image happened to be baked at. It is
    // read from the engine ref instead, which nothing in a run moves.
    assert.ok(
      shimCalls.includes(`git -C ${sandboxRepo} rev-parse ${ENGINE_REF}`),
      `main() must stamp from ${ENGINE_REF}, got: ${JSON.stringify(shimCalls)}`,
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


  console.log('ALL TESTS PASSED')
} finally {
  cleanup()
}
