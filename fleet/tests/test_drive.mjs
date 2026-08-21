// fleet/tests/test_drive.mjs — sentinel-style spec for the W1 drive-one driver.
//
// Concurrency-safe by construction: port 8153 is reserved for this file alone
// (8151-8159 is the fleet test range), and every byte of state — the throwaway
// git repo, the orchestrator's sqlite dir, the gate-read report — lives under
// an `fs.mkdtemp` directory unique to this process. No shared fixtures.
//
// The sandbox is simulated, but nothing about the *verification* is: the
// receipt row carries a REAL sha from a REAL git commit in a REAL repo, and
// `receiptsResolvable` is decided by a REAL `git cat-file -e` executed against
// it. A fabricated sha in the second scenario proves the check can fail.
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
  applyReceipt,
  auxStoreId,
  applyReportedTokens,
  applyStamp,
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
const cleanup = () => fs.rmSync(tmp, { recursive: true, force: true })
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Real shell execution, used for the git commands the spec insists must be real.
const sh = (cmd, cwd) =>
  new Promise((resolve) => {
    execFile('/bin/sh', ['-c', cmd], { cwd }, (error, stdout) =>
      resolve({ code: typeof error?.code === 'number' ? error.code : error ? 1 : 0, stdout: stdout ?? '' }),
    )
  })

try {
  // -- a real one-commit git repo, and a plugin manifest to stamp from --------
  fs.mkdirSync(path.join(repoDir, '.claude-plugin'), { recursive: true })
  fs.writeFileSync(path.join(repoDir, '.claude-plugin', 'plugin.json'), JSON.stringify({ version: '9.9.9' }))
  fs.writeFileSync(path.join(repoDir, 'f.txt'), 'hi\n')
  const init = await sh(
    'git init -q -b main . && git config user.email t@example.com && git config user.name t && ' +
      'git add -A && git -c commit.gpgsign=false commit -q -m init',
    repoDir,
  )
  assert.equal(init.code, 0, `git init/commit failed: ${init.stdout}`)
  const headSha = (await sh('git rev-parse HEAD', repoDir)).stdout.trim()
  assert.match(headSha, /^[0-9a-f]{40}$/, 'the test fixture must produce a real 40-hex commit sha')

  // -- shared exec stub ------------------------------------------------------
  // ssh never happens; `git push`/`git fetch` would need ssh so they are stubbed
  // green; every OTHER git command (cat-file, rev-parse) runs for real, which is
  // what makes the receipt verification an honest check rather than a mock.
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
      if (/^git -C \S+ (push|fetch) /.test(cmd)) return { code: 0, stdout: '' }
      if (cmd.startsWith('git ')) return sh(cmd)
      return { code: 0, stdout: '' }
    }
    exec.cmds = cmds
    exec.delivered = null
    return exec
  }

  // The stand-in sandbox: a real `runShim` against the driver's own orchestrator,
  // over the real ws transport, holding a real claim. `invokeRun` is the only
  // stub — it writes the receipt and reports gate-green instead of launching an
  // engine run. It uses shim-main's own helpers, so the code the live sandbox
  // entrypoint depends on is the code exercised here.
  const startSandbox = ({ assignment, runId, receiptSha, exec }) => {
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

      applyStamp(store, runId, stamp)
      applyReportedTokens(store, runId, 4200)
      await synchronizer.save()
      await synchronizer.stopSync()
      await synchronizer.destroy()
      return outcome
    })()
  }

  // -- 1. the happy path: a full drive, gate-read green ----------------------
  {
    const runId = 'run-drive-1'
    let sandbox = null
    const exec = makeExec((assignment) => {
      // The provisioner's shim start is a detached `nohup … &`, so the sandbox
      // comes up AFTER the command returns — exactly as it does live.
      setTimeout(() => {
        sandbox = startSandbox({ assignment, runId, receiptSha: headSha, exec })
      }, 30)
    })

    const { read, reportPath, detail } = await driveOne({
      planPath: 'docs/superpowers/plans/example.md',
      golden: 'fleet-golden',
      port: PORT,
      dbDir: path.join(tmp, 'db1'),
      repoDir,
      exec,
      clock,
      runId,
      ttlMs: 60_000,
      tickMs: 25,
      settleMs: 500,
      heartbeatTimeoutMs: 20_000,
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

    // The run branch was fetched before any sha was verified, and the sha was
    // verified with a real `git cat-file -e`.
    const fetchIdx = exec.cmds.findIndex((c) => /^git -C \S+ fetch ssh:\/\/exedev@fleet-run-drive-1\.exe\.xyz/.test(c))
    const catIdx = exec.cmds.findIndex((c) => c === `git -C ${repoDir} cat-file -e ${headSha}`)
    assert.ok(fetchIdx >= 0, `expected a run-branch fetch, got: ${JSON.stringify(exec.cmds)}`)
    assert.ok(catIdx >= 0, `expected a cat-file on the receipt sha, got: ${JSON.stringify(exec.cmds)}`)
    assert.ok(fetchIdx < catIdx, 'the branch must be fetched before its receipts are resolved')

    // The sandbox is always torn down.
    assert.ok(
      exec.cmds.includes(`ssh exe.dev "rm fleet-${runId} --json"`),
      `expected the teardown command, got: ${JSON.stringify(exec.cmds)}`,
    )

    // The delivered assignment carried the orchestrator's own ws URL and port.
    assert.equal(exec.delivered.runId, runId)
    assert.equal(exec.delivered.wsUrl, `ws://127.0.0.1:${PORT}/fleet`)
  }

  // -- 2. an unresolvable receipt sinks receiptsResolvable AND o1 ------------
  // Guards against a vacuously-green read: the check must be able to fail.
  {
    const runId = 'run-drive-2'
    const fabricated = '0'.repeat(40)
    let sandbox = null
    const exec = makeExec((assignment) => {
      setTimeout(() => {
        sandbox = startSandbox({ assignment, runId, receiptSha: fabricated, exec })
      }, 30)
    })

    const { read } = await driveOne({
      planPath: 'docs/superpowers/plans/example.md',
      golden: 'fleet-golden',
      port: PORT,
      dbDir: path.join(tmp, 'db2'),
      repoDir,
      exec,
      clock,
      runId,
      ttlMs: 60_000,
      tickMs: 25,
      settleMs: 500,
      heartbeatTimeoutMs: 20_000,
    })
    await sandbox

    assert.equal(read.receiptsResolvable, false, 'a sha absent from the repo must not resolve')
    assert.equal(read.o1, false, 'O1 requires every receipt to bind to a real sha')
    // Everything else still reads honestly — the run itself did reach gate-green.
    assert.equal(read.leaseContinuity, true)
    assert.equal(read.versionStamp, true)
    assert.deepEqual(read.spendObservational, { reported: 4200, ledger: 4200 })
  }

  // -- 3. shim-main's pure helpers -------------------------------------------
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

    // The store writers are surgical cell/row writes, never whole-table churn.
    const store = createMergeableStore('helpers')
    store.setRow('runs', 'run-x', { planPath: 'p', sandboxId: 's', status: 'running', branch: 'b' })
    applyStamp(store, 'run-x', stamp)
    applyReportedTokens(store, 'run-x', 1234)
    applyReceipt(store, 'run-x', 'gate', { sha: headSha, path: 'gate-receipt.json', verdict: 'PASS' })
    assert.deepEqual(store.getRow('runs', 'run-x'), {
      planPath: 'p',
      sandboxId: 's',
      status: 'running',
      branch: 'b',
      pluginVersion: '9.9.9',
      engineSha: headSha,
      reportedTokens: 1234,
    })
    assert.deepEqual(store.getRow('receipts', 'run-x:gate'), {
      sha: headSha,
      path: 'gate-receipt.json',
      verdict: 'PASS',
    })
    // An empty stamp writes nothing rather than blanking a good one.
    applyStamp(store, 'run-x', { pluginVersion: '', engineSha: '' })
    applyReportedTokens(store, 'run-x', null)
    assert.equal(store.getCell('runs', 'run-x', 'pluginVersion'), '9.9.9')
    assert.equal(store.getCell('runs', 'run-x', 'reportedTokens'), 1234)
  }

  console.log('ALL TESTS PASSED')
} finally {
  cleanup()
}
