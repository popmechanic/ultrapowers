// fleet/drive.mjs — drive one remote run end to end and produce the §W1d gate
// read.
//
// This is the W1 integration point: start the orchestrator, provision a
// sandbox, watch the synced store until the run resolves, then answer the five
// pre-registered questions the W1 gate asks and write them to disk.
//
// Every side effect that leaves this process rides the injected `exec(cmd)`
// seam (via the provisioner) or the orchestrator's injected `actions`, so the
// whole driver is exercisable with no VMs and no credentials in reach. It holds
// no credentials of its own: the sandbox's store token is minted inside
// `provisionRun` and delivered over ssh, and this module only ever handles the
// resulting record (a hash and an expiry).
import fs from 'node:fs'
import path from 'node:path'
import { startOrchestrator, FLEET_PATH } from './orchestrator.mjs'
import { provisionRun, destroySandbox } from './provision.mjs'
import { isSafeBranchName, isSafeRepoPath, isSafeSha, sandboxIdFor } from './shim-main.mjs'
import { claimState, totalSpent } from './store.mjs'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Statuses the driver stops watching on. `folded` is not reachable in W1 (the
// fold happens above the run) but is terminal wherever it appears.
const TERMINAL = new Set(['gate-green', 'parked', 'revoked', 'folded'])

const isNonEmptyString = (value) => typeof value === 'string' && value.length > 0

/**
 * The evidence-before-teardown pull (#197), as proven in the live run: tar the
 * SMALL sandbox artifacts — shim.log, the delivered assignment, the engine's
 * session transcripts (`~/.claude/projects`), and the gitignored
 * `.claude/ultrapowers/run-*` dirs inside the repo — back to the orchestrator
 * as one archive. Never the repo itself. Every diagnosis in the live run
 * depended on exactly these files, and they die with the VM.
 */
export const sandboxLogPullCommand = ({ vmName, dest }) =>
  `ssh -o BatchMode=yes -o ConnectTimeout=10 ${vmName}.exe.xyz ` +
  `'cd /home/exedev && tar czf - shim.log fleet-run.json .claude/projects ` +
  `$(cd repo && ls -d .claude/ultrapowers/run-*/ 2>/dev/null | sed "s|^|repo/|") 2>/dev/null' ` +
  `> ${dest}`

/**
 * Drive one remote run and return its §W1d gate read.
 *
 * @param {object} opts
 * @param {string} opts.planPath - the plan the sandbox is dispatched to run.
 * @param {string} opts.golden - the golden VM to clone the sandbox from.
 * @param {number} opts.port - port the orchestrator's ws-server binds.
 * @param {string} opts.dbDir - directory for the orchestrator's sqlite store.
 * @param {string} opts.repoDir - local checkout the base is pushed from and the
 *   run branch is fetched back into.
 * @param {(cmd: string) => Promise<{stdout: string, code: number}>} opts.exec
 * @param {() => number} [opts.clock] - the logical clock. Frozen under test; an
 *   input to claim/guard decisions, never to timeouts.
 * @param {number} [opts.publishTimeoutMs] - how long to wait, after the run
 *   reaches a terminal status, for the sandbox to publish what it produced.
 *   Clamped to `heartbeatTimeoutMs`.
 * @param {number} [opts.logPullTimeoutMs] - bound on the evidence pull that
 *   precedes teardown. A pull that outruns it is recorded as an error and the
 *   sandbox is destroyed anyway — the pull must never keep a VM alive.
 * @returns {Promise<{read: object, reportPath: string, detailPath: string, detail: object}>}
 */
export const driveOne = async ({
  planPath,
  golden,
  port,
  dbDir,
  repoDir,
  exec,
  clock = Date.now,
  runId = 'run-1',
  branch = 'fleet-run',
  baseRef = 'HEAD',
  ttlMs = 15 * 60_000,
  capTokens = 2_000_000,
  wsHost = '127.0.0.1',
  wsUrl,
  reportPath,
  tickMs = 1_000,
  settleMs = 750,
  heartbeatTimeoutMs = 30 * 60_000,
  publishPollMs = 250,
  publishTimeoutMs = heartbeatTimeoutMs,
  logPullTimeoutMs = 120_000,
}) => {
  const resolvedWsUrl = wsUrl ?? `ws://${wsHost}:${port}/${FLEET_PATH}`
  const resolvedReportPath = reportPath ?? path.join(dbDir, `gate-read-${runId}.json`)
  const detailPath = `${resolvedReportPath.replace(/\.json$/, '')}.detail.json`

  // Handed to the orchestrator by reference — a token minted mid-run is honored
  // on the next handshake without restarting the server.
  const tokenRecords = []
  const pages = []
  const convergedAway = []
  const receiptChecks = []
  const errors = []

  let vmName = null
  let destroyed = false
  let pulled = false
  let sandboxLogs = null

  // Evidence BEFORE teardown (#197). Best-effort and bounded: a failed or slow
  // pull is pushed to `errors` and teardown proceeds — the billing clock is the
  // thing teardown protects, and the pull must not risk leaving a VM alive.
  // Guarded once, like the destroy, because it is wired to every teardown path
  // (the cap-overshoot action and the normal end of run).
  const pullLogsOnce = async () => {
    if (pulled || !vmName) return
    pulled = true
    const dir = path.join(dbDir, 'sandbox-logs', `${vmName}-${Date.now()}`)
    const dest = path.join(dir, 'sandbox-logs.tgz')
    try {
      fs.mkdirSync(dir, { recursive: true })
      let timer
      const timeout = new Promise((resolve) => {
        timer = setTimeout(() => resolve({ code: -1, stdout: `timed out after ${logPullTimeoutMs}ms` }), logPullTimeoutMs)
      })
      const result = await Promise.race([exec(sandboxLogPullCommand({ vmName, dest })), timeout]).finally(() =>
        clearTimeout(timer),
      )
      if (result?.code === 0) sandboxLogs = dest
      else errors.push(`pull sandbox logs: code ${result?.code} ${(result?.stdout ?? '').trim()}`.trim())
    } catch (error) {
      errors.push(`pull sandbox logs: ${error?.message ?? error}`)
    }
  }

  const destroyOnce = async () => {
    if (destroyed || !vmName) return
    destroyed = true
    await pullLogsOnce()
    await destroySandbox({ vmName, port, exec })
  }

  const actions = {
    page: (cls, text) => pages.push([cls, text]),
    revokeAndPark: (scopeId, why) => pages.push(['revoke-and-park', `${scopeId} ${why}`]),
    // The orchestrator's hard action against a cap overshoot. Fire-and-forget
    // by contract (the sweep is synchronous); the same guard keeps the teardown
    // in `finally` from destroying an already-destroyed sandbox.
    destroySandbox: () => {
      void destroyOnce().catch((error) => errors.push(`destroySandbox: ${error?.message ?? error}`))
    },
  }

  const orchestrator = await startOrchestrator({ port, dbDir, tokenRecords, actions, clock })
  const { store, sweep, heartbeat, stop } = orchestrator

  let sweeping = false
  const runSweep = () => {
    // The sweep writes to the store when it converges a row away or parks a
    // run, which re-enters this listener. The outer sweep re-baselines at its
    // end, so a nested pass has nothing left to judge — skip it rather than
    // recurse.
    if (sweeping) return
    sweeping = true
    try {
      for (const description of sweep(clock())) {
        if (description.startsWith('converge-away')) convergedAway.push(description)
      }
    } finally {
      sweeping = false
    }
  }

  // Sweep on every change, not merely on the tick.
  //
  // The guard judges the NET delta between one sweep and the next, so two legal
  // transitions that land inside a single sweep interval collapse into one
  // illegal hop. `runShim` writes `claimed` and `running` as synchronous
  // neighbours, so a timer-only driver sees `pending -> running`, converges the
  // run back to `pending`, and pages security on a perfectly legal run — no
  // tick rate can separate two writes made in the same tick. Measured against
  // the real orchestrator: with a change listener the sweep observes
  // `pending, claimed, running, running, gate-green` one hop at a time and
  // converges nothing. The tick sweep stays as a floor, for the spend pass and
  // for a store that has gone quiet.
  const sweepListenerId = store.addTablesListener(() => runSweep())

  // --- lease continuity ----------------------------------------------------
  // "No false expiry" is decided by the claim's own history, not by catching a
  // moment: exactly one epoch ever existed (a reclaim increments it), the claim
  // was never observed expired, and it was never revoked. Sampling is a
  // best-effort supplement — the FINAL row is always sampled, so a run that
  // resolves between two polls is still judged.
  const epochs = new Set()
  let sawExpired = false
  let sawRevoked = false
  const observeClaim = () => {
    const row = store.getRow('claims', `claim:${runId}`)
    if (!row || row.holder === undefined) return
    epochs.add(row.epoch)
    const state = claimState(row, clock())
    if (state === 'expired') sawExpired = true
    if (state === 'revoked') sawRevoked = true
  }

  let status = 'unknown'
  let timedOut = false
  let publishTimedOut = false
  const startedAt = Date.now()

  // The rows this run published, by the same filter the read uses — so "has it
  // published its receipts yet" and "which receipts am I verifying" can never
  // disagree.
  const receiptsFor = () =>
    Object.entries(store.getTable('receipts'))
      .filter(([rowId, row]) => rowId.startsWith(`${runId}:`) || row.runId === runId)
      .map(([rowId, row]) => ({ rowId, sha: row.sha, path: row.path, verdict: row.verdict }))

  try {
    // 1. Seed the run and its budget, and let them reach the server before any
    //    sandbox arrives — `runShim` silently no-ops its status writes against a
    //    runs row it has not synced.
    store.setRow('runs', runId, { planPath, sandboxId: '', status: 'pending', branch })
    store.setRow('budgets', runId, { capTokens })
    runSweep()
    await sleep(Math.min(settleMs, 200))

    // 2. Provision. The VM's name is claimed BEFORE the attempt, not after it,
    //    so the teardown guarantee survives a provisioner that throws partway
    //    (clone succeeded, ssh never came up) and would otherwise leave a
    //    billed sandbox running with nothing holding its name.
    vmName = sandboxIdFor(runId)
    //    The last thing `provisionRun` does is start the sandbox's shim
    //    detached, so the token record is registered here — one microtask after
    //    that command returns and well before a remote node process can boot,
    //    import, and complete a ws handshake.
    //    `planPath` rides the assignment because the sandbox has no other way
    //    to learn which plan it was dispatched to run — the store row carries
    //    one, but the shim reads its assignment file before it has synced
    //    anything. Without it the engine is launched with a literal
    //    `undefined` plan path.
    const provisioned = await provisionRun({
      golden,
      runId,
      baseRef,
      repoDir,
      ttlMs,
      wsUrl: resolvedWsUrl,
      port,
      planPath,
      exec,
      clock,
    })
    vmName = provisioned.vmName
    tokenRecords.push(provisioned.record)
    store.setRow('runs', runId, { ...store.getRow('runs', runId), sandboxId: vmName })

    // 3. Watch until the run resolves, or until nothing has moved for
    //    `heartbeatTimeoutMs`. Progress is any change to the run's status,
    //    claim, spend, or receipts — a live-but-slow run is never timed out.
    let progressKey = ''
    let lastProgressAt = Date.now()
    for (;;) {
      heartbeat(clock())
      runSweep()
      observeClaim()

      status = store.getCell('runs', runId, 'status') ?? 'unknown'
      if (TERMINAL.has(status)) break

      const key = JSON.stringify([
        status,
        store.getRow('claims', `claim:${runId}`) ?? null,
        Object.keys(store.getTable('spend')).length,
        Object.keys(store.getTable('receipts')).length,
      ])
      if (key !== progressKey) {
        progressKey = key
        lastProgressAt = Date.now()
      }
      if (Date.now() - lastProgressAt > heartbeatTimeoutMs) {
        timedOut = true
        break
      }
      await sleep(tickMs)
    }

    // 4. Wait for the PUBLISH, not for a nap.
    //
    //    The status flip and the run's output are separate writes: the sandbox
    //    reaches `gate-green` first and only then detects its integration
    //    branch, commits the receipts onto it, and publishes both. A fixed
    //    settle is a bet that all of that fits inside one constant — and it
    //    silently loses that bet on a slow sandbox, reading red for a run that
    //    was merely late. So the driver waits for the signal itself: the branch
    //    cell moved off the fallback AND the receipts table has rows for this
    //    run. The wait is BOUNDED by the heartbeat timeout, and a run that never
    //    publishes inside it reads red with `publish timeout` — fail-closed, and
    //    honest about which failure it was.
    if (!timedOut && status === 'gate-green') {
      const publishDeadline = Date.now() + Math.min(publishTimeoutMs, heartbeatTimeoutMs)
      for (;;) {
        runSweep()
        observeClaim()
        const published = store.getCell('runs', runId, 'branch')
        if (isNonEmptyString(published) && published !== branch && receiptsFor().length > 0) break
        if (Date.now() >= publishDeadline) {
          publishTimedOut = true
          errors.push('publish timeout')
          break
        }
        await sleep(publishPollMs)
      }
    }

    // 5. Settle the trailing scalars. `main()` writes the stamp and the token
    //    total AHEAD of the publish signal, so they have normally arrived by
    //    now; this is the margin for their sync round-trip, not the mechanism.
    await sleep(settleMs)
    runSweep()
    observeClaim()
    status = store.getCell('runs', runId, 'status') ?? status
  } catch (error) {
    errors.push(`drive: ${error?.message ?? error}`)
  }

  // --- the read ------------------------------------------------------------
  const reachedGateGreen = status === 'gate-green'

  const receipts = receiptsFor()

  // Receipts resolve only against a branch actually fetched back from the
  // sandbox, and only sha-by-sha. No receipts at all is NOT resolvable: an
  // empty set must never read as vacuously green.
  //
  // The branch is the one the SANDBOX published (the engine integrates to
  // `ultra/integration-<stamp>`, a name nothing on this side chose); `branch` is
  // only a fallback for a run that never published one, and it is expected to
  // fail the fetch rather than quietly resolve against something else.
  //
  // Resolution is three checks, and each closes a way the one before it can be
  // satisfied by something that is not this run's receipt:
  //
  //   exists       `cat-file -e <sha>` — is this object in the local store at
  //                all. Any commit that ever arrived here satisfies it,
  //                including one from an unrelated branch, so it is only an
  //                existence pre-check: it makes "no such commit" legible as
  //                distinct from the failures below.
  //   reachable    `merge-base --is-ancestor <sha> FETCH_HEAD` — is the commit
  //                on the branch this run actually produced.
  //   dereferenced `cat-file -e <sha>:<path>` — does the recorded PATH exist in
  //                the tree at that commit. Without it, a pointer into a
  //                gitignored directory (which is where the engine writes its
  //                receipts) passes both checks above while naming a file no
  //                commit ever contained and nothing can ever fetch.
  //
  // The branch name and both pointer halves are SANDBOX-authored data that this
  // process interpolates into a shell. They are validated here — not quoted,
  // not escaped — and a value that fails validation fails the read without ever
  // reaching `exec`.
  let receiptsResolvable = false
  if (reachedGateGreen && !publishTimedOut && receipts.length > 0 && vmName) {
    try {
      const runBranch = store.getCell('runs', runId, 'branch') ?? branch
      if (!isSafeBranchName(runBranch)) {
        errors.push(`unsafe branch name in runs.${runId}.branch — refusing to fetch`)
      } else {
        const fetched = await exec(
          `git -C ${repoDir} fetch ssh://exedev@${vmName}.exe.xyz/home/exedev/repo ${runBranch}`,
        )
        if (fetched?.code !== 0) {
          errors.push(`fetch ${runBranch} failed (code ${fetched?.code})`)
        } else {
          receiptsResolvable = true
          for (const receipt of receipts) {
            if (!isSafeSha(receipt.sha) || !isSafeRepoPath(receipt.path)) {
              errors.push(`unsafe receipt pointer in ${receipt.rowId} — refusing to verify`)
              receiptChecks.push({ ...receipt, exists: false, reachable: false, dereferenced: false, resolved: false })
              receiptsResolvable = false
              continue
            }
            const seen = await exec(`git -C ${repoDir} cat-file -e ${receipt.sha}`)
            const exists = seen?.code === 0
            let reachable = false
            let dereferenced = false
            if (exists) {
              const ancestry = await exec(`git -C ${repoDir} merge-base --is-ancestor ${receipt.sha} FETCH_HEAD`)
              reachable = ancestry?.code === 0
            }
            if (reachable) {
              const blob = await exec(`git -C ${repoDir} cat-file -e ${receipt.sha}:${receipt.path}`)
              dereferenced = blob?.code === 0
            }
            const resolved = exists && reachable && dereferenced
            receiptChecks.push({ ...receipt, exists, reachable, dereferenced, resolved })
            if (!resolved) receiptsResolvable = false
          }
        }
      }
    } catch (error) {
      errors.push(`receipts: ${error?.message ?? error}`)
      receiptsResolvable = false
    }
  }

  const leaseContinuity = epochs.size === 1 && epochs.has(1) && !sawExpired && !sawRevoked

  const versionStamp =
    isNonEmptyString(store.getCell('runs', runId, 'pluginVersion')) &&
    isNonEmptyString(store.getCell('runs', runId, 'engineSha'))

  const reportedCell = store.getCell('runs', runId, 'reportedTokens')
  const spendObservational = {
    reported: typeof reportedCell === 'number' && Number.isFinite(reportedCell) ? reportedCell : null,
    ledger: totalSpent(store.getTable('spend'), runId),
  }

  const read = {
    // O1: provision -> claim -> run -> gate-green -> receipts, every receipt
    // binding to a real, reachable, dereferenceable pointer on the fetched
    // branch, published inside the bound, and zero store-caused failures
    // (nothing the guard had to converge away).
    o1:
      reachedGateGreen &&
      receipts.length > 0 &&
      receiptsResolvable &&
      convergedAway.length === 0 &&
      !timedOut &&
      !publishTimedOut,
    receiptsResolvable,
    leaseContinuity,
    versionStamp,
    // Observational at n=1 by construction (§W1d, finding F6): the tolerance
    // this read sets is derived from this same run. Pass/fail from W2 on.
    spendObservational,
  }

  const detail = {
    runId,
    planPath,
    vmName,
    status,
    timedOut,
    publishTimedOut,
    elapsedMs: Date.now() - startedAt,
    receipts: receiptChecks.length > 0 ? receiptChecks : receipts,
    convergedAway,
    pages,
    errors,
    epochs: [...epochs],
    capTokens,
    // Where the pre-teardown evidence pull landed (`sandbox-logs.tgz`), or
    // null when it failed — the failure is in `errors`.
    sandboxLogs: null,
  }

  // Tear down BEFORE the report is written, so a failed teardown — the one
  // failure that keeps costing money after the run is over — is recorded in the
  // detail the operator reads rather than thrown into an empty room. `detail`
  // holds `errors` by reference, so late pushes still serialize below. Each leg
  // is caught separately: a sandbox that will not die must not also stop the
  // orchestrator from shutting down and freeing its port.
  store.delListener(sweepListenerId)
  try {
    await destroyOnce()
  } catch (error) {
    errors.push(`destroySandbox: ${error?.message ?? error}`)
  }
  detail.sandboxLogs = sandboxLogs
  try {
    await stop()
  } catch (error) {
    errors.push(`stop: ${error?.message ?? error}`)
  }

  fs.mkdirSync(path.dirname(resolvedReportPath), { recursive: true })
  // The report file is EXACTLY the read — it round-trips to it. Triage context
  // lives beside it so the gate read stays the contract it declares.
  fs.writeFileSync(resolvedReportPath, `${JSON.stringify(read, null, 2)}\n`)
  fs.writeFileSync(detailPath, `${JSON.stringify(detail, null, 2)}\n`)

  return { read, reportPath: resolvedReportPath, detailPath, detail }
}
