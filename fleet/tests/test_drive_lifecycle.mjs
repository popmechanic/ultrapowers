// fleet/tests/test_drive_lifecycle.mjs — sentinel-style spec for the W1
// drive-one driver: the DRIVER LIFECYCLE and the sandbox's launch leg.
//
// Driver refusals and bounds (never-claimed, unsafe runId, sizing flags,
// real-plan defaults, lease expiry, unfit plans), shim-main's pure helpers,
// the engine launch itself, run-report discovery, the default exec/spawn
// seams, the token-gate race (#302), vm-name safety, publish-on-park (#318)
// and the version-stamp cross-check (#282). The gate-read scenarios — receipt
// resolution, publish, evidence capture, the production receipt writer — live
// in `test_drive.mjs`; the two files were one until it ran within a few
// seconds of the suite's 120 s per-file cap. The shared fixture is
// `_drive_helpers.mjs`.
//
// The sandbox's LIVE launch leg — `invokeEngineRun`, `shellExec`,
// `spawnEngineProcess`, and run-report discovery — gets its own scenarios,
// driven over injected exec/spawn recorders. Those functions are what every
// other scenario stubs past, so nothing else can catch a defect in them: which
// code the run executes (the pushed `fleet-base`, not the golden image's HEAD),
// which plan it is given, and where its report is read from are decided there
// and nowhere else.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createMergeableStore } from 'tinybase'
import { driveOne, isSafeVmName } from '../drive.mjs'
import { connectOpenWs } from '../shim.mjs'
import {
  applyBranch,
  applyReceipt,
  applyReportedTokens,
  applyStamp,
  readInstalledPluginVersion,
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
  readAssignment,
  readGateGreen,
  readReportTokens,
  readStamp,
  runArtifactDirs,
  sandboxIdFor,
  shellExec,
  spawnEngineProcess,
} from '../shim-main.mjs'
import {
  INTEGRATION_BRANCH,
  OLDER_BRANCH,
  RECEIPT_PATH,
  setupDriveFixture,
  sh,
  sleep,
  writeFile,
} from './_drive_helpers.mjs'

const {
  tmp,
  repoDir,
  sandboxRepo,
  cleanup,
  headSha,
  olderSha,
  integrationSha,
  makeExec,
  startStubSandbox,
  driveDefaults,
} = await setupDriveFixture()

try {
  // -- 16. a sandbox that never claims fails FAST, not at the heartbeat bound -
  // #288: a sandbox whose ws transport is dead (or whose shim never starts)
  // writes NOTHING to the store — there is no "progress" for the heartbeat
  // check to lose, so without a dedicated claim deadline the only exit was
  // the full heartbeat timeout, with zero output along the way (one live
  // run's nohup log was 0 bytes). Here the shim-start command fires, exactly
  // as it does live, but nothing ever claims the run.
  {
    const runId = 'run-drive-16'
    const exec = makeExec(() => {
      // Deliberately does nothing: the sandbox never connects, never claims.
    })

    const startedAt = Date.now()
    const { reportPath, detailPath, detail } = await driveOne({
      ...driveDefaults,
      dbDir: path.join(tmp, 'db16'),
      exec,
      runId,
      claimTimeoutMs: 500,
      heartbeatTimeoutMs: 60_000,
      tickMs: 50,
    })
    const elapsed = Date.now() - startedAt

    assert.ok(elapsed < 8_000, `a never-claimed sandbox must fail fast, not at the heartbeat bound, took ${elapsed}ms`)
    assert.equal(detail.neverClaimed, true, 'the never-claimed reason must be named in the detail')
    assert.equal(detail.timedOut, false, 'this is a distinct failure from the generic heartbeat timeout')
    assert.ok(
      detail.errors.some((e) => /never claimed/.test(e)),
      `expected an explicit never-claimed error, got: ${JSON.stringify(detail.errors)}`,
    )
    // Teardown still ran (the #197/#288 theme: evidence before teardown, on
    // every stop reason) — the pull and the destroy both fire even though the
    // sandbox never claimed anything.
    assert.ok(
      exec.cmds.some((c) => /tar czf - shim\.log/.test(c)),
      `expected the evidence pull even though the sandbox never claimed, got: ${JSON.stringify(exec.cmds)}`,
    )
    assert.ok(
      exec.cmds.includes(`ssh exe.dev "rm fleet-${runId} --json"`),
      `expected the teardown command even though the sandbox never claimed, got: ${JSON.stringify(exec.cmds)}`,
    )
    assert.ok(fs.existsSync(reportPath), 'the report is still written')
    assert.ok(fs.existsSync(detailPath), 'the detail is still written')
  }

  // -- 17. progressLog narrates a live drive -----------------------------------
  // The fix for one live run's zero-byte nohup log (#288): with no progress
  // narration, a driver watching a dead sandbox produces no output at all
  // until it finally times out (or, now, hits the claim deadline).
  {
    const runId = 'run-drive-17'
    const lines = []
    const exec = makeExec(() => {
      // Never claims — same dead-transport shape as scenario 16.
    })

    await driveOne({
      ...driveDefaults,
      dbDir: path.join(tmp, 'db17'),
      exec,
      runId,
      claimTimeoutMs: 500,
      heartbeatTimeoutMs: 60_000,
      tickMs: 50,
      progressLog: (line) => lines.push(line),
    })

    assert.ok(lines.some((l) => /provision/.test(l)), `expected a provisioning line, got: ${JSON.stringify(lines)}`)
    assert.ok(lines.some((l) => /never claimed/.test(l)), `expected a never-claimed line, got: ${JSON.stringify(lines)}`)
  }

  // -- 18. an unsafe runId is refused at driveOne ENTRY — before ANY command -
  // #298: `sandboxIdFor` derives the vm name straight from `runId`, and
  // provisionRun/destroySandbox interpolate it into ssh/git command strings.
  // The historical guard sat only in pullLogsOnce (teardown captures), so an
  // unsafe name was refused for `stat` but still shelled through the clone,
  // deliveries, tunnel, and rm. One guard at the single choke point covers
  // every site by construction: driveOne refuses before the orchestrator
  // starts and before a single exec call. (pullLogsOnce keeps its own guard
  // as defense in depth — it protects against mid-run mutation, not input.)
  {
    const cmds = []
    const exec = async (cmd) => {
      cmds.push(cmd)
      return { code: 0, stdout: '{}' }
    }

    let threw = null
    try {
      await driveOne({
        ...driveDefaults,
        dbDir: path.join(tmp, 'db18'),
        exec,
        runId: 'run 1',
      })
    } catch (error) {
      threw = error
    }

    assert.ok(threw, 'an unsafe runId must throw, not drive')
    assert.ok(
      /unsafe runId/.test(threw.message),
      `expected an explicit unsafe-runId refusal, got: ${threw?.message}`,
    )
    assert.equal(cmds.length, 0, `refusal must precede every exec call, got: ${JSON.stringify(cmds)}`)
    assert.equal(
      fs.existsSync(path.join(tmp, 'db18')),
      false,
      'refusal must precede the orchestrator start — no store dir may exist',
    )
  }

  // -- 19. sandbox sizing flags reach the clone command unchanged (#290-3) ----
  // The knobs ride straight through `driveOne` -> `provisionRun` -> the clone
  // command with no reshaping in between; a scripted exec that never claims is
  // enough to observe it — the point here is the WIRING, not a full run.
  {
    const runId = 'run-drive-19'
    const exec = makeExec(() => {})

    await driveOne({
      ...driveDefaults,
      dbDir: path.join(tmp, 'db19'),
      exec,
      runId,
      claimTimeoutMs: 500,
      heartbeatTimeoutMs: 60_000,
      tickMs: 50,
      sandboxCpu: 2,
      sandboxMemory: '8GB',
      sandboxDisk: '30GB',
    })

    const cloneCmd = exec.cmds.find((c) => c.startsWith(`ssh exe.dev "cp ${driveDefaults.golden} fleet-${runId}`))
    assert.ok(cloneCmd, `expected a clone command, got: ${JSON.stringify(exec.cmds)}`)
    assert.ok(
      cloneCmd.includes('--cpu=2 --memory=8GB --disk=30GB'),
      `expected the sizing flags on the clone command, got: ${cloneCmd}`,
    )
  }

  // -- 20. real-plan defaults (#279 + W2 charter): ttlMs 4h, capTokens 500k --
  {
    const runId = 'run-drive-20'
    const exec = makeExec(() => {})
    const opts = { ...driveDefaults, dbDir: path.join(tmp, 'db20'), exec, runId, claimTimeoutMs: 500, heartbeatTimeoutMs: 60_000, tickMs: 50, settleMs: 100 }
    delete opts.ttlMs
    const { detail } = await driveOne(opts)

    assert.equal(detail.capTokens, 500_000, 'capTokens default must be the W2 charter constant')
    assert.equal(exec.delivered.ttlMs, 4 * 60 * 60_000, 'ttlMs default must be real-plan scale (4h), not the 15-min smoke constant')
  }

  // -- 21. lease expiry reads as lease expiry, not a generic stall (#279-3) --
  {
    const runId = 'run-drive-21'
    let t21 = 2_000_000
    const clock21 = () => t21
    let sandbox = null
    const exec = makeExec((assignment) => {
      setTimeout(() => {
        sandbox = startStubSandbox({
          assignment,
          runId,
          exec,
          receiptSha: null,
          publish: false,
          clock: clock21,
          invokeRun: async () => {
            t21 += assignment.ttlMs + 1_000 // the claim is now expired on this test's clock
            await sleep(1_500)              // give the watch loop ticks to observe it
            return { gateGreen: false }
          },
        })
      }, 10)
    })

    const { detail } = await driveOne({
      ...driveDefaults,
      dbDir: path.join(tmp, 'db21'),
      exec,
      runId,
      clock: clock21,
      ttlMs: 5_000,
      heartbeatTimeoutMs: 20_000,
      settleMs: 200,
    })
    await sandbox

    assert.ok(
      detail.errors.some((e) => /claim expired mid-watch \(ttlMs=5000\)/.test(e)),
      `expected a named lease-expiry error, got: ${JSON.stringify(detail.errors)}`,
    )
  }

  // -- N3. #322: an unfit plan is refused BEFORE any provisioning -------------
  {
    const runId = 'run-drive-unfit'
    const unfitPlan = path.join('docs', 'unfit-plan.md')
    fs.mkdirSync(path.join(repoDir, 'docs'), { recursive: true })
    fs.writeFileSync(
      path.join(repoDir, unfitPlan),
      '# P\n\n### Task 1: Docs only\n**Type:** implementation\n**Depends-on:** none\n\n**Files:**\n- Modify: `docs/a.md`\n\n- [ ] **Step 1: edit**\n',
    )
    let provisioned = false
    await assert.rejects(
      driveOne({
        ...driveDefaults,
        planPath: unfitPlan,
        dbDir: path.join(tmp, 'dbN3'),
        exec: async () => ({ code: 0, stdout: '' }),
        runId,
        provision: async () => {
          provisioned = true
          throw new Error('must never provision an unfit plan')
        },
      }),
      /headless-unfit/,
    )
    assert.equal(provisioned, false, 'the refusal must precede provisioning')
  }

  // -- N4. #322: allowUnfitPlan proceeds, with the override on the record -----
  {
    const runId = 'run-drive-unfit-ok'
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
        })
      }, 30)
    })
    const { read, detail } = await driveOne({
      ...driveDefaults,
      planPath: path.join('docs', 'unfit-plan.md'),
      allowUnfitPlan: true,
      dbDir: path.join(tmp, 'dbN4'),
      exec,
      runId,
    })
    await sandbox
    assert.equal(read.o1, true, 'the override drives normally')
    assert.ok(
      detail.errors.some((e) => /headless-fitness: proceeding on operator override/.test(e)),
      `the override is on the record, got: ${JSON.stringify(detail.errors)}`,
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

    // -- #190: a PASSING spawn on a DIRTY image greens on ITS OWN receipt ----
    // The positive half of receipt scoping. What landed with #329 was the
    // negative shape — a pre-run directory is invisible to every reader, and
    // a spawn that mints nothing greens nothing (test_shim_main_gate, and
    // scenario 1 of test_drive through `main()`'s receipts publish). None of
    // that can tell a correct scope from an over-eager one: an `excludeDirs`
    // that hid every directory, or the newest, would pass those tests and red
    // every real run. So here the scoped set is the one `main()` snapshots,
    // the image carries a stale receipt in a directory that sorts NEWEST, and
    // the spawn mints its own directory — the verdict must come from the
    // run's own receipt in BOTH directions:
    //   stale BLOCKED + own PASS    → green   (unscoped newest-wins reads red)
    //   stale PASS    + own BLOCKED → red     (unscoped newest-wins reads green)
    {
      const STALE_RUN_DIR = '.claude/ultrapowers/run-29990101000000' // sorts AFTER ENGINE_RUN_DIR
      for (const [label, staleVerdict, ownVerdict, expectGreen] of [
        ['stale BLOCKED, own PASS', 'BLOCKED', 'PASS', true],
        ['stale PASS, own BLOCKED', 'PASS', 'BLOCKED', false],
      ]) {
        const dirtyRepo = path.join(tmp, `dirty-engine-repo-${staleVerdict}`)
        fs.mkdirSync(dirtyRepo, { recursive: true })
        writeFile(dirtyRepo, 'seed.txt', 'seed\n')
        writeFile(dirtyRepo, `${STALE_RUN_DIR}/gate-receipt.json`, JSON.stringify({ verdict: staleVerdict }))
        writeFile(dirtyRepo, `${STALE_RUN_DIR}/report.json`, JSON.stringify({ outputTokens: 1 }))

        // Exactly what `main()` snapshots before launch: the stale directory,
        // and nothing else, predates this run.
        const preRunDirs = new Set(runArtifactDirs(dirtyRepo))
        assert.deepEqual([...preRunDirs], ['run-29990101000000'], label)
        // Control: UNSCOPED newest-wins discovery reads the stale receipt, so
        // any green/red below that agrees with it proves nothing — the
        // expectations are deliberately the opposite of this reading.
        assert.equal(readGateGreen(findGateReceiptFile(dirtyRepo)), staleVerdict === 'PASS', label)

        const rec = makeRecorder({ onSpawn: writesArtifacts({ report: { outputTokens: 4321 }, verdict: ownVerdict }) })
        const outcome = await invokeEngineRun({
          repoDir: dirtyRepo,
          planPath: ENGINE_PLAN,
          exec: rec.exec,
          spawnEngine: rec.spawnEngine,
          log: rec.log,
          excludeDirs: preRunDirs,
        })
        assert.deepEqual(outcome, { gateGreen: expectGreen }, label)

        // The engine ran exactly as it does on a clean image — checkout, auth
        // status, spawn — so the scope changed the READ and nothing about the
        // launch.
        assert.equal(rec.calls.length, 3, `${label}: ${JSON.stringify(rec.calls)}`)
        assert.ok(rec.calls.some((c) => c.startsWith(`${ENGINE_COMMAND} -p`)), `${label}: the engine was spawned`)
        // The receipt the verdict came from is the run's OWN, and the stale one
        // is still on disk, untouched — scoping hides it, never deletes it.
        assert.equal(
          findGateReceiptFile(dirtyRepo, undefined, { excludeDirs: preRunDirs }),
          path.join(dirtyRepo, ENGINE_RUN_DIR, 'gate-receipt.json'),
          label,
        )
        assert.equal(readGateGreen(path.join(dirtyRepo, ENGINE_RUN_DIR, 'gate-receipt.json')), expectGreen, label)
        assert.ok(fs.existsSync(path.join(dirtyRepo, STALE_RUN_DIR, 'gate-receipt.json')), `${label}: stale receipt left in place`)
        // …and the same scope carries through to the receipts the shim would
        // publish: only the run's own receipt is a candidate, never the stale
        // one — `applyRunReceipts` walks this exact list.
        assert.deepEqual(
          findReceiptFiles(dirtyRepo, undefined, { excludeDirs: preRunDirs }),
          [`${ENGINE_RUN_DIR}/gate-receipt.json`],
          label,
        )
      }
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
      'Type manual is post-merge runbook material', 'BLOCKED',
      'never end a turn to wait', 'kills the run']) {
      assert.ok(STANDING_DIRECTIVE.includes(literal),
        'standing directive lost the literal: ' + literal)
    }
  }

  // -- 20. the gate accepts the delivered token DURING the shim start (#302) -
  // The live defect: driveOne registered the token record only after
  // provisionRun returned, while the sandbox's first connect races that push
  // on a millisecond margin — run-10 lost it (instant 401, then a 10-minute
  // never-claimed park). Here the fake sandbox connects at the earliest moment
  // the live one possibly can: synchronously inside the shim-start command,
  // strictly before provisionRun returns — and the gate must already know the
  // token. Deterministic where the live race was not.
  {
    const runId = 'run-drive-20'
    let connectResult = 'not-attempted'
    const exec = async (cmd) => {
      if (cmd.startsWith('ssh ')) {
        const payload = cmd.match(/<<'FLEET_EOF'\n([\s\S]*?)\nFLEET_EOF/)
        if (payload) exec.delivered = JSON.parse(payload[1])
        if (/nohup node .*shim-main\.mjs/.test(cmd)) {
          const a = exec.delivered
          try {
            const ws = await connectOpenWs(`${a.wsUrl}?token=${a.token}`, { timeoutMs: 3_000, log: () => {} })
            connectResult = 'accepted'
            ws.close()
          } catch (error) {
            connectResult = `rejected: ${error?.message ?? error}`
          }
        }
        return { code: 0, stdout: '{}' }
      }
      return { code: 0, stdout: '' }
    }
    exec.delivered = null

    await driveOne({
      ...driveDefaults,
      dbDir: path.join(tmp, 'db20'),
      exec,
      runId,
      claimTimeoutMs: 400,
      heartbeatTimeoutMs: 10_000,
      tickMs: 25,
      progressLog: () => {},
    })
    assert.equal(
      connectResult,
      'accepted',
      `the delivered token must already be registered when the shim starts, got: ${connectResult}`,
    )
  }

  // -- 22. isSafeVmName accept/reject rows (#290-2 residual) ------------------
  {
    for (const good of ['fleet-run-14', 'a', 'A1._-b', 'fleet-run13', 'x'.repeat(64)]) {
      assert.equal(isSafeVmName(good), true, `expected accept: ${good}`)
    }
    for (const bad of ['', ' ', 'fleet run', 'a;b', 'a$(x)', '-leading', '.leading', 'a\nb', 'x'.repeat(65), null, undefined, 42]) {
      assert.equal(isSafeVmName(bad), false, `expected reject: ${JSON.stringify(bad)}`)
    }
  }

  // -- 23. pullLogsOnce refusal branch (#290-2): a provisioner that returns a
  // mutated unsafe vmName gets its sandbox-addressed captures REFUSED (no ssh
  // command ever carries the bad name), the refusal lands in detail.errors,
  // and teardown is still invoked.
  {
    const runId = 'run-drive-23'
    const exec = makeExec(() => {})
    const destroyed = []
    const badName = 'evil;name'

    const { detail } = await driveOne({
      ...driveDefaults,
      dbDir: path.join(tmp, 'db23'),
      exec,
      runId,
      claimTimeoutMs: 500,
      heartbeatTimeoutMs: 60_000,
      tickMs: 50,
      settleMs: 100,
      provision: async () => ({ vmName: badName }),
      destroy: async ({ vmName }) => {
        destroyed.push(vmName)
      },
    })

    assert.ok(
      detail.errors.some((e) => /unsafe vm name/.test(e)),
      `expected an unsafe-vm-name refusal in errors, got: ${JSON.stringify(detail.errors)}`,
    )
    assert.ok(
      !exec.cmds.some((c) => c.includes(badName)),
      `no shelled command may carry the unsafe name, got: ${JSON.stringify(exec.cmds.filter((c) => c.includes(badName)))}`,
    )
    assert.deepEqual(destroyed, [badName], 'teardown must still be invoked exactly once')
  }

  // -- N1. #318 publish-on-park: a parked run's published branch is fetched ---
  // run-14's shape: the engine integrated and left resolvable receipts, then
  // the gate parked. The branch must be fetched and reported — unapproved —
  // while the gate read itself stays exactly as red as before.
  {
    const runId = 'run-drive-park-pub'
    let sandbox = null
    const exec = makeExec((assignment) => {
      setTimeout(() => {
        sandbox = startStubSandbox({
          assignment,
          runId,
          receiptSha: integrationSha,
          receiptPath: RECEIPT_PATH,
          exec,
          gateGreen: false,
        })
      }, 30)
    })

    const { read, detail } = await driveOne({
      ...driveDefaults,
      parkedPublishWaitMs: 8_000,
      dbDir: path.join(tmp, 'dbN1'),
      exec,
      runId,
    })
    await sandbox

    // The read is untouched by the park's publish: still five keys, still red.
    assert.deepEqual(read, {
      o1: false,
      receiptsResolvable: false,
      leaseContinuity: true,
      versionStamp: true,
      spendObservational: { reported: 4200, ledger: 4200 },
    })
    assert.equal(detail.status, 'parked')
    assert.deepEqual(detail.parkedPublish, {
      branch: INTEGRATION_BRANCH,
      fetched: true,
      receiptsResolvable: true,
      unapproved: true,
    })
    // The fetch was REAL: the receipt sha is reachable from FETCH_HEAD.
    assert.equal(
      (await sh(`git -C "${repoDir}" merge-base --is-ancestor ${integrationSha} FETCH_HEAD`)).code,
      0,
      'the parked branch must actually have been fetched',
    )
    assert.ok(
      !detail.errors.includes('publish timeout'),
      `a parked publish must never read as a publish timeout, got: ${JSON.stringify(detail.errors)}`,
    )
  }

  // -- N2. a park that published NOTHING stays quiet and quick ----------------
  {
    const runId = 'run-drive-park-empty'
    let sandbox = null
    const exec = makeExec((assignment) => {
      setTimeout(() => {
        sandbox = startStubSandbox({ assignment, runId, receiptSha: headSha, exec, publish: false, gateGreen: false })
      }, 30)
    })
    const startedAt = Date.now()
    const { read, detail } = await driveOne({
      ...driveDefaults,
      dbDir: path.join(tmp, 'dbN2'),
      exec,
      runId,
    })
    await sandbox
    assert.equal(detail.status, 'parked')
    assert.equal(detail.parkedPublish, null, 'nothing published → nothing claimed')
    assert.equal(read.o1, false)
    assert.ok(
      !detail.errors.includes('publish timeout'),
      'an empty parked publish is an absence, not an error',
    )
    assert.ok(Date.now() - startedAt < 15_000, 'the parked wait is bounded by parkedPublishWaitMs, not the gate-green bound')
  }

  // -- V1. #282/#190: the stamp must NAME THE PUSHED BASE ---------------------
  // The run-16 golden sat four releases stale and nothing said so: `versionStamp`
  // recorded non-emptiness only, so a sandbox that ran the IMAGE's code stamped
  // two perfectly non-empty cells and read GREEN. The driver knows exactly what
  // it pushed — here the sandbox publishes a well-formed stamp naming a
  // different version at a different sha, and the read must go red and say why.
  //
  // Every other leg is the resolvable-receipt shape from scenario 4, so a red
  // `versionStamp` here can only come from the cross-check: `o1` and
  // `receiptsResolvable` stay TRUE alongside it.
  {
    const runId = 'run-drive-stamp-mismatch'
    const wrongSha = 'deadbeef'.repeat(5)
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
          stamp: { pluginVersion: '0.0.1', engineSha: wrongSha },
        })
      }, 30)
    })

    const { read, detail } = await driveOne({
      ...driveDefaults,
      dbDir: path.join(tmp, 'dbV1'),
      exec,
      runId,
    })
    await sandbox

    // Full equality: still exactly the five §W1d keys, and only `versionStamp`
    // moved. A stale-golden run is no longer indistinguishable from a correct one.
    assert.deepEqual(read, {
      o1: true,
      receiptsResolvable: true,
      leaseContinuity: true,
      versionStamp: false,
      spendObservational: { reported: 4200, ledger: 4200 },
    })

    // …and it says WHICH code ran and which was pushed. Pinned in full: the
    // expectation is read from the driver's own `baseRef`, so the fixture's
    // `headSha`/`9.9.9` appearing here is what proves the source.
    const mismatches = detail.errors.filter((e) => /version stamp mismatch/.test(e))
    assert.deepEqual(mismatches, [
      `version stamp mismatch: sandbox ran 0.0.1@${wrongSha}, ` +
        `pushed base is 9.9.9@${headSha} — stale golden or wrong base (#282)`,
    ])
    // The expectation RESOLVED — a skipped cross-check would be a different
    // (and silently green) failure mode.
    assert.ok(
      !detail.errors.some((e) => /version cross-check unavailable/.test(e)),
      `the driver must have resolved its own base, got: ${JSON.stringify(detail.errors)}`,
    )
  }

  // -- V2. #282 image side (distill P5): the INSTALLED plugin must match ------
  // Both cells the V1 cross-check reads derive from the pushed ref, so a
  // plugin baked stale into the golden image passes it. The shim also stamps
  // what `claude plugin list` reports as installed; a disagreement with the
  // pushed manifest reds `versionStamp` and names the fix.
  {
    const runId = 'run-drive-stamp-installed-stale'
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
          installedPluginVersion: '0.0.0-stale-image',
        })
      }, 30)
    })
    const { read, detail } = await driveOne({ ...driveDefaults, dbDir: path.join(tmp, 'dbV2'), exec, runId })
    await sandbox
    assert.equal(read.o1, true, 'the image-side mismatch is a stamp verdict, not an o1 failure')
    assert.equal(read.versionStamp, false)
    assert.equal(detail.installedPluginVersion, '0.0.0-stale-image')
    assert.ok(
      detail.errors.some((e) => /installed plugin mismatch: sandbox has ultrapowers 0\.0\.0-stale-image installed/.test(e) && /#282/.test(e)),
      `expected the installed-plugin mismatch line, got: ${JSON.stringify(detail.errors)}`,
    )
  }
  // A sandbox whose installed plugin matches the pushed manifest stays green,
  // and an older shim that stamps no installed version is skipped, not red.
  {
    const manifest = await sh(`git show HEAD:.claude-plugin/plugin.json`, driveDefaults.repoDir)
    const pushedVersion = manifest.code === 0 ? JSON.parse(manifest.stdout)?.version : null
    for (const [runId, installed] of [
      ['run-drive-stamp-installed-match', pushedVersion],
      ['run-drive-stamp-installed-absent', null],
    ]) {
      if (installed === undefined) continue
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
            installedPluginVersion: installed,
          })
        }, 30)
      })
      const { read, detail } = await driveOne({ ...driveDefaults, dbDir: path.join(tmp, `db-${runId}`), exec, runId })
      await sandbox
      assert.equal(read.versionStamp, true, `${runId}: ${JSON.stringify(detail.errors)}`)
      assert.equal(detail.installedPluginVersion, installed)
      assert.ok(!detail.errors.some((e) => /installed plugin mismatch/.test(e)), runId)
    }
  }
  // readInstalledPluginVersion: the `claude plugin list --json` shape observed
  // on fleet-golden 2026-08-28; anything else reads '' and never throws.
  {
    const listing = JSON.stringify([
      { id: 'ultrapowers@ultrapowers', version: '0.2.23', scope: 'user', enabled: true },
      { id: 'other@market', version: '9.9.9' },
    ])
    assert.equal(await readInstalledPluginVersion({ exec: async () => ({ code: 0, stdout: listing }) }), '0.2.23')
    assert.equal(await readInstalledPluginVersion({ exec: async () => ({ code: 0, stdout: '[]' }) }), '')
    assert.equal(await readInstalledPluginVersion({ exec: async () => ({ code: 1, stdout: 'boom' }) }), '')
    assert.equal(await readInstalledPluginVersion({ exec: async () => ({ code: 0, stdout: 'not json' }) }), '')
    assert.equal(await readInstalledPluginVersion({ exec: async () => { throw new Error('no claude') } }), '')
    const cmds = []
    await readInstalledPluginVersion({ exec: async (cmd) => { cmds.push(cmd); return { code: 0, stdout: '[]' } } })
    assert.deepEqual(cmds, [`${ENGINE_COMMAND} plugin list --json`])
  }

  // -- V2. an unresolvable expectation SKIPS the check, never reddens it ------
  // The cross-check compares against the driver's OWN repo. If that repo cannot
  // answer — a `baseRef` that does not resolve locally, a manifest missing at
  // that ref — the honest reading is "unknown", not "wrong": `versionStamp`
  // keeps its non-emptiness meaning and the gap is narrated instead. Otherwise
  // a driver-side repo problem manufactures a red on a perfectly good run.
  {
    const runId = 'run-drive-stamp-unresolvable'
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
          stamp: { pluginVersion: '0.0.1', engineSha: 'deadbeef'.repeat(5) },
        })
      }, 30)
    })

    const { read, detail } = await driveOne({
      ...driveDefaults,
      baseRef: 'no-such-base-ref',
      dbDir: path.join(tmp, 'dbV2'),
      exec,
      runId,
    })
    await sandbox

    assert.equal(read.versionStamp, true, 'an unresolvable expectation must not manufacture a red stamp')
    assert.ok(
      detail.errors.some((e) => e === 'version cross-check unavailable: could not resolve no-such-base-ref locally'),
      `the skipped cross-check is on the record, got: ${JSON.stringify(detail.errors)}`,
    )
    assert.ok(
      !detail.errors.some((e) => /version stamp mismatch/.test(e)),
      `a skipped check never reports a mismatch, got: ${JSON.stringify(detail.errors)}`,
    )
  }

  // -- V3. an unsafe baseRef never reaches the cross-check's shell ------------
  // `baseRef` is operator input, and the cross-check interpolates it straight
  // into `git -C … rev-parse <ref>` and `git … show <ref>:<manifest>`. It passes
  // the same `isSafeBranchName` guard the pointer halves do BEFORE either
  // command is built; a rejected ref takes the skip path, exactly as an
  // unresolvable one does. `provision` is stubbed to throw so the drive stops
  // right after the cross-check — this scenario is about the two commands only.
  {
    const badRef = 'main; touch /tmp/fleet-pwned'
    const cmds = []
    const { detail } = await driveOne({
      ...driveDefaults,
      baseRef: badRef,
      dbDir: path.join(tmp, 'dbV3'),
      runId: 'run-drive-stamp-unsafe',
      exec: async (cmd) => {
        cmds.push(cmd)
        return { code: 0, stdout: '' }
      },
      provision: async () => {
        throw new Error('provision stubbed off')
      },
    })
    assert.ok(
      !cmds.some((c) => c.includes(badRef)),
      `no command may carry an unsafe baseRef, got: ${JSON.stringify(cmds)}`,
    )
    assert.ok(
      detail.errors.some((e) => e === `version cross-check unavailable: could not resolve ${badRef} locally`),
      `an unsafe ref skips the cross-check on the record, got: ${JSON.stringify(detail.errors)}`,
    )
  }

  // Control: scenario 1 above asserts the full-equality read with
  // `versionStamp: true` and is UNTOUCHED by this change — its stub stamps from
  // `BASE_REF`, which in the fixture repo is exactly the base the driver pushes.

  // -- #211 residual: runId is required, never defaulted ----------------------
  await assert.rejects(
    driveOne({ ...driveDefaults, dbDir: path.join(tmp, 'dbReq'), exec: async () => ({ code: 0, stdout: '' }) }),
    /runId is required/,
  )

  console.log('ALL TESTS PASSED')
} finally {
  cleanup()
}
