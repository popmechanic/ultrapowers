// fleet/tests/test_drive_evidence.mjs — sentinel-style spec for the W1
// drive-one driver: EVIDENCE CAPTURE and the PUBLISH leg.
//
// The best-effort log pull, the control-plane stat capture (raw and derived,
// refused, malformed, never-connecting), a persisted store, the production
// receipt writer, and the two ways a partial publish must read RED.
//
// Split off from `test_drive.mjs` the way `test_drive_lifecycle.mjs` was
// (#460): the suite schedules whole FILES, so its wall clock is the longest
// file's runtime, and `test_drive.mjs` had grown back to 46.8 s of a 73 s
// wall. Receipt resolution and the parked-run reads stay in `test_drive.mjs`;
// the #337/#362 fitness preflight is in `test_drive_fitness.mjs`.
//
// The fixture (two real git repos, the shared exec stub, the stand-in sandbox)
// lives in `_drive_helpers.mjs` — see its header for the transport shape.
// Scenarios keep the numbering they carried in `test_drive.mjs` (7b–7g, 8–11),
// so the issue threads that name them still find them.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
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
  receiptDestination,
  sandboxIdFor,
} from '../shim-main.mjs'
import {
  clock,
  INTEGRATION_BRANCH,
  OLDER_BRANCH,
  setupDriveFixture,
  sh,
  sleep,
  writeFile,
} from './_drive_helpers.mjs'

const {
  tmp,
  repoDir,
  cleanup,
  headSha,
  olderSha,
  makeExec,
  startStubSandbox,
  driveDefaults,
} = await setupDriveFixture()

try {
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
      if (/tar czf - .*shim\.log/.test(cmd)) {
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

    assert.equal(exec.cmds.filter((c) => /tar czf - .*shim\.log/.test(c)).length, 1, 'the pull is attempted exactly once')
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

  // -- 7c-bis. a REFUSED capture keeps its reason in the artifact (#385 item 3) -
  // #362 made stdout pure, and the artifact is written from stdout alone — so a
  // command that failed with its reason on stderr wrote an EMPTY evidence file,
  // losing exactly what the artifact exists to carry. The failure path now
  // appends stderr under a delimiter. The success path above (7c) asserts the
  // artifact is still byte-for-byte the payload, so this cannot have changed a
  // green capture.
  {
    const runId = 'r1s'
    const evidenceDir = path.join(tmp, 'evidence-r1s')
    const reason = 'exe.dev: unknown flag --range=24h'
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
      { stat: { code: 2, stdout: '', stderr: reason } },
    )

    const res = await driveOne({ ...driveDefaults, dbDir: path.join(tmp, 'db7s'), evidenceDir, exec, runId })
    await sandbox

    // The capture degrades to null and the run proceeds — teardown is never at risk.
    assert.equal(res.detail.sandboxStat, null)
    const artifact = path.join(evidenceDir, `stat-${runId}.json`)
    assert.ok(fs.existsSync(artifact), 'a refused capture still writes its artifact')
    const written = fs.readFileSync(artifact, 'utf8')
    assert.notEqual(written, '', 'the artifact must not be empty when the reason is on stderr')
    assert.ok(
      written.includes(reason),
      `the refusal reason must survive into the artifact, got: ${JSON.stringify(written)}`,
    )
    // The trailer is delimited, so a reader can tell payload from reason.
    assert.ok(written.includes('--- stderr ---'), 'stderr is delimited, not concatenated blind')
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


  console.log('ALL TESTS PASSED')
} finally {
  cleanup()
}
