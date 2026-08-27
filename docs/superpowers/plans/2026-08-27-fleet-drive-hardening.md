# Fleet Drive Hardening Implementation Plan (#318 #319 #320 #322)

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the four run-14 drive-hardening follow-ups — publish-on-park (#318), headless-fitness preflight (#322), graceful credits-capture skip (#319), and exit-code/delivered-conjunction coverage (#320) — before any concurrent AFK drain.

**Architecture:** All changes live in the fleet drive layer (`fleet/drive.mjs`, `fleet/shim-main.mjs`, a new `fleet/fitness.mjs`) plus the RUNBOOK. The engine, the gate scripts, and every frozen-periphery surface are untouched. Each behavior is a pure function or an injectable seam so the whole slate is provable by the in-process `.mjs` suite with no VMs and no credentials.

**Tech Stack:** Node ESM (`fleet/*.mjs`), `node:assert/strict` test files under `fleet/tests/`, joined to CI via `tests/test_fleet_suite.py`.

**Spec:** The four issues are the spec — #318, #319, #320, #322 (each carries run-14 evidence: `.claude/ultrapowers/fleet-runs-2026-08-27/`, `fleet-receipts/run-14/`, narrative on #189) — plus handoff `.claude/ultrapowers/handoffs/2026-08-27-A-drive-hardening.md`.

**Acceptance:** suite — the committed fleet `.mjs` suite plus per-task review is the verification; no manual-judgment claims (this plan is authored headless-fit, practicing #322 before Task 4 enforces it).

## Global Constraints

- Lane: `fleet/**` + `fleet/RUNBOOK.md` only. Never touch `skills/ultrapowers/harnesses/waves.js`, `skills/ultrapowers/references/reviewer-prompts.md`, `skills/ultrapowers/scripts/compile_plan.py`, or the frozen verification periphery (sealing subsystem, gate scripts).
- No `anthropic` SDK and no `ANTHROPIC_API_KEY` anywhere in `fleet/` (repo doctrine: distributed plugin needs no API key).
- Every `fleet/tests/*.mjs` file must exit 0 within 120 s AND print `ALL TESTS PASSED` (that exact string) — `tests/test_fleet_suite.py` gates on both.
- `fleet/tests/test_drive.mjs` currently runs ~72 s of its 120 s cap. New scenarios must be cheap: reuse `driveDefaults`, keep waits short, never add a scenario that idles a full default timeout.
- The §W1d gate-read object stays EXACTLY five keys — `o1`, `receiptsResolvable`, `leaseContinuity`, `versionStamp`, `spendObservational` — existing tests pin it by full `deepEqual`. New drive facts go in `detail` only.
- `python3 -m pytest` green (baseline 1183 + whatever main has gained) before merge.

---

### Task 1: #320 — pin shim-main's exit-code mapping and the aux delivered-false conjunction

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `fleet/shim-main.mjs`
- Create: `fleet/tests/test_shim_main_publish.mjs`

**Interfaces:**
- Consumes: `startOrchestrator({port, dbDir, tokenRecords, actions, clock})` and `FLEET_PATH` (from `fleet/orchestrator.mjs`), `mintToken({sandboxId, ttlMs, now})` (from `fleet/tokens.mjs`), `deliverAndClose` (from `fleet/shim.mjs`) — all existing.
- Produces: `shimExitCode(outcome): 0|1` exported from `fleet/shim-main.mjs`; `main()` gains an optional injectable seam `auxDeliver` (default `deliverAndClose`) used for the aux publish flush.

Run-14's completeness critic: (1) the `invokedDirectly` exit-code mapping (`gate-green && delivered===true → 0, else 1`) is module top-level, unexported, untested; (2) `main()`'s conjunction `outcome.delivered === true && auxDelivered` is covered only when both halves are true — the aux-publish-failure case the field exists to surface has no test.

- [ ] **Step 1: Extract the exit-code mapping as an exported pure function.** In `fleet/shim-main.mjs`, immediately above the `invokedDirectly` block, add:

```js
/**
 * The process exit-code contract (#320): a run is a success ONLY when it is
 * gate-green AND its publish actually reached the orchestrator. Everything
 * else — parked, failed, no-store, undelivered, malformed — is 1.
 */
export const shimExitCode = (outcome) =>
  outcome?.status === 'gate-green' && outcome?.delivered === true ? 0 : 1
```

and change the `invokedDirectly` `.then` to use it: `process.exit(shimExitCode(outcome))` (replacing the inline ternary; keep the surrounding comment).

- [ ] **Step 2: Make the aux deliver injectable.** In `main()`'s destructured options add `auxDeliver = deliverAndClose,` and change the aux publish line to `const auxDelivered = await auxDeliver({ store, synchronizer, ws, url, log: console.error })`. No other behavior change.

- [ ] **Step 3: Write the failing test** `fleet/tests/test_shim_main_publish.mjs`:

```js
// fleet/tests/test_shim_main_publish.mjs — #320: the exit-code mapping is a
// pinned pure function, and main()'s delivered field is the CONJUNCTION of the
// shim's own delivery and the aux publish — an aux flush that never reached
// the orchestrator must read delivered:false even on a gate-green run.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { startOrchestrator, FLEET_PATH } from '../orchestrator.mjs'
import { mintToken } from '../tokens.mjs'
import { main as shimMain, shimExitCode, sandboxIdFor } from '../shim-main.mjs'

let passed = 0
const ok = (label) => {
  passed += 1
  console.log(`ok - ${label}`)
}

// --- 1. the exit-code truth table -------------------------------------------
assert.equal(shimExitCode({ status: 'gate-green', delivered: true }), 0)
assert.equal(shimExitCode({ status: 'gate-green', delivered: false }), 1)
assert.equal(shimExitCode({ status: 'gate-green' }), 1)
assert.equal(shimExitCode({ status: 'failed', delivered: true }), 1)
assert.equal(shimExitCode({ status: 'no-store' }), 1)
assert.equal(shimExitCode(null), 1)
assert.equal(shimExitCode(undefined), 1)
assert.equal(shimExitCode({}), 1)
ok('shimExitCode: gate-green && delivered===true → 0, everything else → 1')

// --- shared harness: a real orchestrator + real main() ----------------------
const runMain = async ({ runId, auxDeliver }) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-aux-'))
  const now = Date.now()
  const { token, record } = mintToken({ sandboxId: sandboxIdFor(runId), ttlMs: 60_000, now })
  const orch = await startOrchestrator({
    port: 0,
    dbDir: path.join(tmp, 'db'),
    tokenRecords: [record],
    actions: { page: () => {}, revokeAndPark: () => {}, destroySandbox: () => {} },
  })
  orch.store.setRow('runs', runId, { planPath: 'p.md', sandboxId: '', status: 'pending', branch: 'fleet-run' })
  orch.store.setRow('budgets', runId, { capTokens: 1_000_000 })
  const assignmentPath = path.join(tmp, 'fleet-run.json')
  fs.writeFileSync(
    assignmentPath,
    JSON.stringify({ runId, token, wsUrl: `ws://127.0.0.1:${orch.port}/${FLEET_PATH}`, ttlMs: 60_000 }),
  )
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-aux-repo-'))
  try {
    return await shimMain({
      assignmentPath,
      repoDir,
      exec: async () => ({ code: 1, stdout: '' }),
      invokeRun: async () => {
        await new Promise((r) => setTimeout(r, 250))
        return { gateGreen: true }
      },
      readTokens: () => 4200,
      ...(auxDeliver ? { auxDeliver } : {}),
    })
  } finally {
    await orch.stop()
    fs.rmSync(tmp, { recursive: true, force: true })
    fs.rmSync(repoDir, { recursive: true, force: true })
  }
}

// --- 2. aux publish fails ⇒ delivered:false, exit 1 --------------------------
{
  const outcome = await runMain({ runId: 'run-aux-fail', auxDeliver: async () => false })
  assert.deepEqual(outcome, { status: 'gate-green', delivered: false })
  assert.equal(shimExitCode(outcome), 1)
  ok('aux publish failure sinks delivered and the exit code (gate-green notwithstanding)')
}

// --- 3. control: the default aux deliver against a live server → true --------
{
  const outcome = await runMain({ runId: 'run-aux-ok' })
  assert.deepEqual(outcome, { status: 'gate-green', delivered: true })
  assert.equal(shimExitCode(outcome), 0)
  ok('default aux deliver over a live socket keeps delivered:true, exit 0')
}

console.log(`\nALL TESTS PASSED (${passed})`)
```

- [ ] **Step 4: Run** `node fleet/tests/test_shim_main_publish.mjs` — expect exit 0, `ALL TESTS PASSED (3)`. If scenario 3's real `deliverAndClose` needs the orchestrator's heartbeat, mirror whatever `fleet/tests/test_shim_transport.mjs` scenario 7's harness does around `startOrchestrator` — but change assertions only if the CONTRACT above is wrong, not to make the test pass.

- [ ] **Step 5: Run the neighbors** `node fleet/tests/test_shim_transport.mjs && node fleet/tests/test_shim_main_gate.mjs && node fleet/tests/test_shim_main_tokens.mjs` — all `ALL TESTS PASSED` (the refactor must not move their pins).

- [ ] **Step 6: Commit** `git add fleet/shim-main.mjs fleet/tests/test_shim_main_publish.mjs && git commit -m "fleet: pin shim exit-code mapping + aux delivered conjunction (#320)"`

### Task 2: #319 — credits capture skips gracefully on the orchestrator key's refusal

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `fleet/drive.mjs`
- Test: `fleet/tests/test_drive.mjs`

**Commutes:** `fleet/tests/test_drive.mjs`

**Interfaces:**
- Consumes: nothing from sibling tasks.
- Produces: `CREDITS_REFUSAL_RE: RegExp` and `CREDITS_REFUSAL_NOTE: string` exported from `fleet/drive.mjs`; `captureJson` (module-internal) gains an optional `refusal: {re, note}` param.

Every run-13/14 logged `credits usage: code 1 command not allowed by SSH key permissions` in `detail.errors` and read `creditSpendUsd: null` — structural noise, because the orchestrator key's refusal is BY DESIGN (#213: no billing capability on fleet boxes; the real canary runs from the operator's local machine). Option (b) from #319: detect the refusal and record ONE documented line instead. Do NOT touch any ssh key or permit any command — option (a) is the operator's credential call.

- [ ] **Step 1: Add the exported signature and note** near `creditsUsageCommand` in `fleet/drive.mjs`:

```js
/**
 * The orchestrator key's deliberate refusal of billing reads (#213). When the
 * credits capture fails WITH this signature, the failure is posture, not a
 * defect — recorded as the single documented note below instead of raw noise,
 * so W2 spend reads never special-case it (#319). `creditSpendUsd` stays null.
 */
export const CREDITS_REFUSAL_RE = /not allowed by SSH key permissions/
export const CREDITS_REFUSAL_NOTE =
  'credits usage: skipped — orchestrator key refuses billing reads by design (#213); ' +
  'read spend from the LOCAL billing canary: ssh exe.dev "billing credits usage --group=box --json"'
```

- [ ] **Step 2: Thread it through `captureJson`.** Give `captureJson` an optional `refusal` field: `const captureJson = async ({ label, cmd, file, refusal }) => {` and in its non-zero-code branch, before the existing `errors.push`, insert: when `refusal && refusal.re.test(raw)`, push `refusal.note` instead of the default `` `${label}: code …` `` line (still `return null`; still write the raw artifact). Pass `refusal: { re: CREDITS_REFUSAL_RE, note: CREDITS_REFUSAL_NOTE }` ONLY at the credits call site in `pullLogsOnce`. The stat capture and every other failure mode keep their current lines.

- [ ] **Step 3: Write the failing scenario** — append to `fleet/tests/test_drive.mjs`, after scenario 7e (mirror 7d/7e's `makeCaptureExec` shape; import `CREDITS_REFUSAL_NOTE` from `../drive.mjs` at the top):

```js
  // -- 7f. #319: the orchestrator key's refusal is ONE documented line ---------
  {
    const runId = 'r1f'
    const evidenceDir = path.join(tmp, 'evidence-r1f')
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
        stat: { code: 0, stdout: STAT_FIXTURE },
        credits: { code: 1, stdout: 'command not allowed by SSH key permissions' },
      },
    )

    const res = await driveOne({ ...driveDefaults, dbDir: path.join(tmp, 'db7f2'), evidenceDir, exec, runId })
    await sandbox

    assert.equal(res.detail.creditSpendUsd, null, 'a refused capture is unknown, never 0')
    const creditLines = res.detail.errors.filter((e) => /credits/.test(e))
    assert.deepEqual(creditLines, [CREDITS_REFUSAL_NOTE], 'exactly one documented line, no raw noise')
    // The raw artifact still lands — the refusal is diagnosable from disk.
    assert.equal(
      fs.readFileSync(path.join(evidenceDir, `credits-${runId}.json`), 'utf8'),
      'command not allowed by SSH key permissions',
    )
    // A NON-refusal failure keeps the raw default line (the note is not a blanket).
  }
  {
    const runId = 'r1g'
    const evidenceDir = path.join(tmp, 'evidence-r1g')
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
      { stat: { code: 0, stdout: STAT_FIXTURE }, credits: { code: 255, stdout: 'ssh: connection reset' } },
    )
    const res = await driveOne({ ...driveDefaults, dbDir: path.join(tmp, 'db7g'), evidenceDir, exec, runId })
    await sandbox
    assert.ok(
      res.detail.errors.some((e) => /credits usage: code 255 ssh: connection reset/.test(e)),
      `a non-refusal failure keeps the raw line, got: ${JSON.stringify(res.detail.errors)}`,
    )
    assert.equal(res.detail.creditSpendUsd, null)
  }
```

(If `makeCaptureExec`'s `credits` entry does not accept a plain `{code, stdout}` object for non-zero codes, extend it the way its `stat` entry already handles function/object forms — a harness-only change.)

- [ ] **Step 4: Run** `node fleet/tests/test_drive.mjs` — expect FAIL on the new scenario (raw line still present), then implement Steps 1–2 if not already done, re-run, expect `ALL TESTS PASSED`, total runtime < 120 s.

- [ ] **Step 5: Commit** `git add fleet/drive.mjs fleet/tests/test_drive.mjs && git commit -m "fleet: credits capture skips gracefully on the restricted key's refusal (#319)"`

### Task 3: #318 — publish-on-park: a parked-with-receipts run's branch is fetched, marked unapproved

**Type:** implementation
**Depends-on:** none
**Review:** adversarial

**Files:**
- Modify: `fleet/drive.mjs`
- Modify: `fleet/RUNBOOK.md`
- Test: `fleet/tests/test_drive.mjs`

**Commutes:** `fleet/RUNBOOK.md`

**Interfaces:**
- Consumes: nothing from sibling tasks.
- Produces: `driveOne` gains opt `parkedPublishWaitMs` (default `60_000`) and `detail.parkedPublish` (`null`, or `{branch, fetched, receiptsResolvable, unapproved: true}`). The gate-read object is UNCHANGED (five keys; `read.receiptsResolvable` stays a gate-green-only fact).

**Parallelization rationale:** drive-side read/fetch logic, independent of the shim (#320), the capture path (#319), and the preflight (#322) — contract is the existing store/publish protocol, already fixed.

Run-14: the engine went fully green but parked on one `deferred:manual` ack; park-by-default destroyed the sandbox and the integration branch died with it — recovery cost a manual evidence-diff reconstruction (PR #317). The shim ALREADY publishes branch + receipts on a parked run (`main()` publishes after `runShim` returns regardless of verdict); the two gaps are drive-side: the publish wait runs only for `gate-green`, and the fetch leg refuses non-green. Close both; mark the result clearly unapproved.

- [ ] **Step 1: Extend the publish wait.** In `fleet/drive.mjs`, add `parkedPublishWaitMs = 60_000,` to `driveOne`'s options (after `publishTimeoutMs`). Replace the step-4 publish-wait block (`if (!timedOut && status === 'gate-green') { … }`) with:

```js
    // 4. Wait for the PUBLISH, not for a nap.
    //
    //    (existing rationale comment — keep it verbatim)
    //
    //    #318: a PARKED run publishes too — main() detects the branch and
    //    commits the receipts after runShim returns, whatever the verdict —
    //    and that branch died with the sandbox in run-14. So the wait now
    //    covers parked as well, on its own tighter bound: a parked run that
    //    publishes nothing (parked before the engine ran, cap park) must not
    //    idle out the full gate-green bound, and a cap park has already
    //    destroyed the sandbox, so `destroyed` breaks the wait immediately.
    //    Only the gate-green path can set publishTimedOut — a silent parked
    //    publish is an absence, not a red read.
    if (!timedOut && (status === 'gate-green' || status === 'parked')) {
      const bound =
        status === 'gate-green'
          ? Math.min(publishTimeoutMs, heartbeatTimeoutMs)
          : Math.min(parkedPublishWaitMs, heartbeatTimeoutMs)
      const publishDeadline = Date.now() + bound
      note(`publish wait (${status}): up to ${bound}ms for branch+receipts`)
      for (;;) {
        runSweep()
        observeClaim()
        const published = store.getCell('runs', runId, 'branch')
        if (isNonEmptyString(published) && published !== branch && receiptsFor().length > 0) {
          note(`publish wait: received ${published}`)
          break
        }
        if (status === 'parked' && destroyed) {
          note('publish wait: sandbox already destroyed — nothing will publish')
          break
        }
        if (Date.now() >= publishDeadline) {
          if (status === 'gate-green') {
            publishTimedOut = true
            errors.push('publish timeout')
          }
          note('publish wait: timed out')
          break
        }
        await sleep(publishPollMs)
      }
    }
```

- [ ] **Step 2: Extend the fetch leg.** Replace the receipts-resolution block (from `let receiptsResolvable = false` through its closing brace) with the version below. The changes: the guard admits parked-with-receipts; the inner loop writes to a local `resolvable`; the outcome routes to `read.receiptsResolvable` ONLY on gate-green, and to a new `parkedPublish` otherwise. The validation posture is IDENTICAL — same `isSafeBranchName` / `isSafeSha` / `isSafeRepoPath` refusals on the same sandbox-authored data, exercised on the new path exactly as on the old:

```js
  // #318: a parked-with-receipts run resolves the same way — the branch is
  // fetched so a post-hoc human ack can land the work without a ~200k
  // re-drive — but the result lands ONLY in detail.parkedPublish, marked
  // unapproved. The gate read's receiptsResolvable stays a gate-green fact:
  // nothing about a park may brighten the read.
  let receiptsResolvable = false
  let parkedPublish = null
  const parkedWithReceipts = status === 'parked' && receipts.length > 0
  if (((reachedGateGreen && !publishTimedOut) || parkedWithReceipts) && receipts.length > 0 && vmName) {
    let resolvable = false
    let fetchedOk = false
    let fetchedBranch = null
    try {
      const runBranch = store.getCell('runs', runId, 'branch') ?? branch
      if (!isSafeBranchName(runBranch)) {
        errors.push(`unsafe branch name in runs.${runId}.branch — refusing to fetch`)
      } else {
        const fetched = await exec(
          `git -C ${repoDir} -c core.sshCommand="${sandboxGitSsh}" fetch ssh://exedev@${vmName}.exe.xyz/home/exedev/repo ${runBranch}`,
        )
        if (fetched?.code !== 0) {
          errors.push(`fetch ${runBranch} failed (code ${fetched?.code})`)
        } else {
          fetchedOk = true
          fetchedBranch = runBranch
          resolvable = true
          for (const receipt of receipts) {
            if (!isSafeSha(receipt.sha) || !isSafeRepoPath(receipt.path)) {
              errors.push(`unsafe receipt pointer in ${receipt.rowId} — refusing to verify`)
              receiptChecks.push({ ...receipt, exists: false, reachable: false, dereferenced: false, resolved: false })
              resolvable = false
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
            if (!resolved) resolvable = false
          }
        }
      }
    } catch (error) {
      errors.push(`receipts: ${error?.message ?? error}`)
      resolvable = false
    }
    if (reachedGateGreen) receiptsResolvable = resolvable
    else parkedPublish = { branch: fetchedBranch, fetched: fetchedOk, receiptsResolvable: resolvable, unapproved: true }
  }
```

- [ ] **Step 3: Surface it in `detail`.** In the `detail` object literal, after `receipts:` add:

```js
    // #318: a parked run's published branch, fetched locally but UNAPPROVED —
    // no standing grant covers it; merging it needs an explicit operator ack
    // of the parked gate receipt. null when the park published nothing.
    parkedPublish,
```

- [ ] **Step 4: Keep the test file fast.** In `fleet/tests/test_drive.mjs`, add `parkedPublishWaitMs: 500,` to the shared `driveDefaults` object — every pre-existing parked scenario then pays ≤0.5 s for the new wait, keeping total runtime inside the 120 s cap.

- [ ] **Step 5: Let the stub sandbox park with receipts.** In `startStubSandbox`, add option `gateGreen = true,` (after `publish = true,`) and change the default `invokeRun`'s return from `return { gateGreen: true }` to `return { gateGreen }`. All existing callers are unchanged (`gateGreen` defaults true).

- [ ] **Step 6: Write the two failing scenarios** — append to `fleet/tests/test_drive.mjs` before the final summary line:

```js
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
```

- [ ] **Step 7: Run** `node fleet/tests/test_drive.mjs` — expect the new scenarios to FAIL before Steps 1–3 are in, then PASS after; confirm the final line prints `ALL TESTS PASSED` and total runtime stays under 120 s (`time node fleet/tests/test_drive.mjs`).

- [ ] **Step 8: RUNBOOK park-triage.** Append to `fleet/RUNBOOK.md`, as a new section immediately after `## Gate read`:

```markdown
## Park triage (#318)

A parked run that published receipts is not lost work. `driveOne` fetches the
parked run's integration branch exactly as it does a gate-green run's, and
reports it as `detail.parkedPublish` — `{branch, fetched, receiptsResolvable,
unapproved: true}` — in the gate-read detail. **`unapproved` means exactly
that:** no standing grant covers the branch, so merging it requires an
explicit operator ack of the parked gate receipt's `acks` (read them in
`fleet-receipts/<runId>/` on the fetched branch). With the ack given, land
the branch by normal PR — no re-drive needed.

On every park, triage in this order:

1. Read `detail.parkedPublish`. Non-null → the work survived; review the
   fetched branch and ack-or-reject.
2. `parkedPublish: null` → recover via the run-14 evidence-diff pattern:
   the per-task review diffs in the pulled evidence
   (`sandbox-logs.tgz`: `repo/.claude/ultrapowers/run-*/review/*.diff`)
   apply cleanly to base (PR #317 precedent); reconstruct any
   integration-only fixes from `report.json`.
3. **Harvest `report.json`'s `completenessFindings` into issues explicitly**
   — run-14's carried a real socket-leak defect that existed nowhere else.
```

- [ ] **Step 9: Commit** `git add fleet/drive.mjs fleet/RUNBOOK.md fleet/tests/test_drive.mjs && git commit -m "fleet: publish-on-park — fetch a parked run's branch, marked unapproved (#318)"`

### Task 4: #322 — headless-fitness preflight refuses manual-judgment plans at dispatch

**Type:** implementation
**Depends-on:** none

**Files:**
- Create: `fleet/fitness.mjs`
- Create: `fleet/tests/test_fitness.mjs`
- Modify: `fleet/drive.mjs`
- Modify: `fleet/RUNBOOK.md`
- Test: `fleet/tests/test_drive.mjs`

**Commutes:** `fleet/tests/test_drive.mjs`, `fleet/RUNBOOK.md`

**Interfaces:**
- Consumes: nothing from sibling tasks.
- Produces: `assessHeadlessFitness(planText: string): {fit: boolean, findings: Array<{task: string, reason: string}>}` exported from `fleet/fitness.mjs`; `driveOne` gains opt `allowUnfitPlan = false` and refuses (throws before any provisioning) a plan with findings.

Run-14 root cause: the plan's Task 4 (instruction-only doc edits) could only be verified by human judgment, so the gate honestly emitted `deferred:manual` — outside the standing grant — making the park a certainty from the moment the plan was authored, discovered after ~47 min and 203k tokens. Prevention companion to #318. Scope is DISPATCH-side only: the gate's ack classing is correct and stays; `compile_plan.py` and the periphery are untouched — `fleet/fitness.mjs` parses the plan text independently.

- [ ] **Step 1: Write the failing pure-function tests** `fleet/tests/test_fitness.mjs`:

```js
// fleet/tests/test_fitness.mjs — #322: a plan task whose only evidence would
// be human judgment (the instruction-only doc class: implementation type,
// every Files entry a .md, no Test: entry) is guaranteed to park an
// unattended drive. assessHeadlessFitness names those tasks BEFORE a sandbox
// exists.
import assert from 'node:assert/strict'
import { assessHeadlessFitness } from '../fitness.mjs'

let passed = 0
const ok = (label) => {
  passed += 1
  console.log(`ok - ${label}`)
}

const plan = (tasks) => `# A Plan\n\n**Acceptance:** suite — x\n\n---\n\n${tasks.join('\n\n')}`

const docOnlyTask = `### Task 1: Extend the skill text
**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: \`skills/ultralearn/SKILL.md\`
- Modify: \`skills/ultralearn/references/reading-lenses.md\`

- [ ] **Step 1: append the paragraph**`

const codeTask = `### Task 2: Fix the thing
**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: \`fleet/drive.mjs\`
- Test: \`fleet/tests/test_drive.mjs\`

- [ ] **Step 1: write the failing test**`

const docWithTestTask = `### Task 3: Document + pin
**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: \`fleet/RUNBOOK.md\`
- Test: \`fleet/tests/test_drive.mjs\`

- [ ] **Step 1: write the failing test**`

const manualDocTask = `### Task 4: Owner updates the wiki
**Type:** manual
**Depends-on:** none

**Files:**
- Modify: \`docs/wiki.md\`

- [ ] **Step 1: the owner edits the page**`

// 1. run-14's shape is flagged, by task heading
{
  const res = assessHeadlessFitness(plan([docOnlyTask, codeTask]))
  assert.equal(res.fit, false)
  assert.equal(res.findings.length, 1)
  assert.equal(res.findings[0].task, 'Task 1: Extend the skill text')
  assert.match(res.findings[0].reason, /instruction-only/)
  ok('instruction-only doc task flagged (run-14 class)')
}

// 2. code tasks and doc tasks WITH a Test: entry pass
{
  const res = assessHeadlessFitness(plan([codeTask, docWithTestTask]))
  assert.deepEqual(res, { fit: true, findings: [] })
  ok('code task and doc-with-test task are fit')
}

// 3. Type: manual is post-merge runbook material, never waved — not flagged
{
  const res = assessHeadlessFitness(plan([codeTask, manualDocTask]))
  assert.deepEqual(res, { fit: true, findings: [] })
  ok('manual-typed tasks are excluded (they never reach the sandbox waves)')
}

// 4. fenced content never drives classification — a code task EMBEDDING a
//    doc-only Files block inside a fence stays fit
{
  const fenced = `### Task 5: Ship a checker
**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: \`fleet/fitness.mjs\`
- Test: \`fleet/tests/test_fitness.mjs\`

- [ ] **Step 1: embed an example**

\`\`\`markdown
**Files:**
- Modify: \`docs/only.md\`
\`\`\`
`
  const res = assessHeadlessFitness(plan([fenced]))
  assert.deepEqual(res, { fit: true, findings: [] })
  ok('fenced example Files blocks are ignored')
}

// 5. a plan with no tasks at all is fit (nothing to flag)
assert.deepEqual(assessHeadlessFitness('# empty\n'), { fit: true, findings: [] })
ok('an empty plan is fit')

console.log(`\nALL TESTS PASSED (${passed})`)
```

- [ ] **Step 2: Run it to fail** — `node fleet/tests/test_fitness.mjs` → module-not-found.

- [ ] **Step 3: Implement `fleet/fitness.mjs`.** Sketch (glue is routine; the CONTRACT is the test above):
  - Strip fenced blocks first: remove every ```` ``` … ``` ```` and `~~~ … ~~~` span (non-greedy, multiline) so fenced content never drives classification.
  - Split tasks on `/^### Task /m`; the task label is the heading text up to end-of-line (e.g. `Task 1: Extend the skill text`).
  - Per task: `Type` = first `/^\*\*Type:\*\*\s*(\S+)/m` capture, default `implementation`. Files entries = lines matching `/^-\s*(Create|Modify|Test|Delete):\s*`([^`]+)`/` after the `**Files:**` line and before the next blank-then-non-list boundary (matching within the task slice is sufficient once fences are stripped).
  - Finding when: type is `implementation` AND at least one Files entry AND every entry's path ends in `.md` AND no `Test:` entry. Reason string must contain `instruction-only` and say the fix: rewrite the verification into runtime/external form, add a pinning test, or route the task to a local drain.
  - Return `{fit: findings.length === 0, findings}`.

- [ ] **Step 4: Run** `node fleet/tests/test_fitness.mjs` → `ALL TESTS PASSED (5)`.

- [ ] **Step 5: Wire into `driveOne`.** In `fleet/drive.mjs`: import `{ assessHeadlessFitness }` from `./fitness.mjs`; add `allowUnfitPlan = false,` to the options. Place the check after the `note` helper is defined and before `const tokenRecords = []` — i.e. before `startOrchestrator` and before any `exec` call, so a refusal provisions nothing and leaks nothing:

```js
  // #322: headless-fitness preflight. A plan carrying a task whose only
  // evidence is human judgment is GUARANTEED to park an unattended drive —
  // refuse it here, before a sandbox exists, not 200k tokens later. An
  // unreadable plan file skips the check with narration only (the live drive
  // always has the merged plan on disk; the in-process tests do not).
  const planFile = path.isAbsolute(planPath) ? planPath : path.join(repoDir, planPath)
  let planText = null
  try {
    planText = fs.readFileSync(planFile, 'utf8')
  } catch {
    planText = null
  }
  if (planText === null) {
    note(`headless-fitness: plan unreadable at ${planFile} — check skipped`)
  } else {
    const fitness = assessHeadlessFitness(planText)
    if (!fitness.fit) {
      const summary = fitness.findings.map((f) => `${f.task}: ${f.reason}`).join('; ')
      if (!allowUnfitPlan) {
        throw new Error(
          `driveOne: plan is headless-unfit — ${summary} — rewrite the verification into ` +
            `runtime/external form, route the task to a local drain, or pass allowUnfitPlan: true ` +
            `with a specific operator pre-authorization (#322)`,
        )
      }
      errors.push(`headless-fitness: proceeding on operator override — ${summary}`)
      note('headless-fitness: unfit plan allowed by allowUnfitPlan')
    }
  }
```

  Note the placement constraint: `errors` is declared just below `note` in the current layout — declare the `tokenRecords`/`pages`/`errors` block ABOVE this check (moving those declarations up is fine; they have no dependencies).

- [ ] **Step 6: Append the two driveOne scenarios to `fleet/tests/test_drive.mjs`:**

```js
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
```

  (These reuse the `docs/unfit-plan.md` file written in N3 — keep N4 after N3. All existing scenarios use `planPath: 'docs/superpowers/plans/example.md'`, absent from the fixture repo, so they hit the unreadable-skip branch and are untouched.)

- [ ] **Step 7: Run** `node fleet/tests/test_drive.mjs` and `node fleet/tests/test_fitness.mjs` — both `ALL TESTS PASSED`, `test_drive.mjs` under 120 s.

- [ ] **Step 8: RUNBOOK.** In `fleet/RUNBOOK.md`, append to the end of the `## Live W1 run` section:

```markdown
**Headless fitness (#322).** `driveOne` refuses a plan carrying any task whose
verification can only be evidenced by human judgment — the known class is the
instruction-only doc task (`implementation` type, every Files entry a `.md`,
no `Test:` entry). run-14 proved such a task makes a `deferred:manual` park a
certainty, discovered only after ~47 min and 203k tokens. Before dispatching:
rewrite the verification into runtime/external form (add a pinning test), or
route that task to a local drain. `allowUnfitPlan: true` overrides — pass it
only with a specific operator pre-authorization for that manual ack, and the
override is recorded in `detail.errors`.
```

- [ ] **Step 9: Commit** `git add fleet/fitness.mjs fleet/tests/test_fitness.mjs fleet/drive.mjs fleet/RUNBOOK.md fleet/tests/test_drive.mjs && git commit -m "fleet: headless-fitness preflight refuses manual-judgment plans at dispatch (#322)"`

---

## Operator smoke

- do: `node fleet/tests/test_drive.mjs && node fleet/tests/test_fitness.mjs && node fleet/tests/test_shim_main_publish.mjs`
  see: three `ALL TESTS PASSED` lines, each file finishing well under 120 s.
- do: on the next real fleet drive that parks, open `gate-read-<runId>.detail.json`
  see: a `parkedPublish` field — either the fetched branch marked `"unapproved": true`, or `null` with the errors naming why nothing published; no `credits usage: code 1 command not allowed…` noise line, only the documented skip note.
- do: point `driveOne` at a plan containing one instruction-only doc task
  see: it throws `plan is headless-unfit — …` before any `ssh exe.dev "cp …"` appears in the log.
