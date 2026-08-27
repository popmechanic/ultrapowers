# Fleet Orchestrator & Driver Hardening Implementation Plan (#190 orch items, #282 item 1)

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the orchestrator/provision/driver #190 residuals — the page-storm latch, the missing-runs-row destructive fall-through, provision payload validation — plus #282's version cross-check and the runId-default footgun.

**Architecture:** Four independent hardening seams in `fleet/orchestrator.mjs`, `fleet/provision.mjs`, and `fleet/drive.mjs`, each pinned by its existing in-process test file. No engine surfaces; no protocol/shape changes to the store schema or the gate-read keys.

**Tech Stack:** Node ESM, `node:assert/strict` tests under `fleet/tests/`, joined to CI via `tests/test_fleet_suite.py`.

**Spec:** Issue #190 (items: park-refusal page latch, missing-runs-row spend edge, provision payload validation, versionStamp cross-check) and issue #282 item 1 (silent golden/plugin staleness — the driver-side half). Issue #211's chosen fix (no-pin ssh flags) is already on main; this plan removes its named residual footgun (`driveOne` defaulting `runId` to `run-1`).

**Acceptance:** suite — the committed fleet `.mjs` suite plus per-task review; every claim pinned in-process.

## Global Constraints

- Lane: `fleet/**` only. No engine surfaces, no frozen periphery, no `anthropic` SDK, no `ANTHROPIC_API_KEY`.
- Every `fleet/tests/*.mjs` must exit 0 within 120 s and print `ALL TESTS PASSED`; `fleet/tests/test_drive.mjs` is near ~75 s of that cap — new scenarios must be cheap (short waits, reuse `driveDefaults`).
- The §W1d gate-read object stays EXACTLY five keys (`o1`, `receiptsResolvable`, `leaseContinuity`, `versionStamp`, `spendObservational`) — pinned by full `deepEqual` in existing tests. `versionStamp` may become FALSE in new mismatch cases but the key set never changes.
- The orchestrator sweep's page/action contract is asserted by full-equality logs in `fleet/tests/test_orchestrator.mjs` — new pages must be added to expectations there, never left as surprise entries.

---

### Task 1: Page latch + missing-runs-row refusal in the spend pass

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `fleet/orchestrator.mjs`
- Test: `fleet/tests/test_orchestrator.mjs`

**Interfaces:**
- Consumes: the existing sweep closure in `startOrchestrator` (`actions.page`, `guardViolation`, `revoke`, `totalSpent`).
- Produces: no new exports — behavioral guarantees only: (1) each distinct supervisor-refusal page fires ONCE per `(scopeId, kind)` for the orchestrator's lifetime; (2) an overshoot whose runs row is ABSENT pages and touches nothing.

#190, both confirmed live at `fleet/orchestrator.mjs:222-251`: (a) a park refusal `continue`s, so every subsequent sweep re-detects the same overshoot and re-pages — a page storm with no latch; (b) when the runs row is absent, the `if (runRow)` guard skips the park but FALLS THROUGH to revoke + destroy — destructive action without the park that is supposed to gate it.

- [ ] **Step 1: Write the failing tests** — append to `fleet/tests/test_orchestrator.mjs`, using its existing `orch`, `pageLog`, `actionsLog`, frozen clock `T`, and direct store writes (mirror the existing spend-overshoot scenario's setup: a budgets row, a claims row via the claim protocol or direct guarded write, spend rows over cap):

```js
// --- #190: missing-runs-row overshoot pages, never destroys ------------------
{
  const pagesBefore = pageLog.length
  const actionsBefore = actionsLog.length
  // budget + claim + overshooting spend for a scope with NO runs row
  orch.store.setRow('budgets', 'ghost', { capTokens: 10 })
  // claim held by sb-ghost (use the same write path the existing claim scenarios use)
  // ... spend rows totalling > 10 under the claimant's namespace ...
  orch.sweep(T)
  assert.equal(actionsLog.length, actionsBefore, 'no revoke/destroy without a parkable runs row')
  const newPages = pageLog.slice(pagesBefore)
  assert.ok(
    newPages.some(([cls, text]) => cls === 'security' && /ghost/.test(text) && /missing runs row/.test(text)),
    `the missing-row refusal must page security, got: ${JSON.stringify(newPages)}`,
  )
  // --- the latch: a second sweep re-detects the same overshoot silently ------
  const pagesAfterFirst = pageLog.length
  orch.sweep(T + 1)
  orch.sweep(T + 2)
  assert.equal(pageLog.length, pagesAfterFirst, 'the same refusal must page ONCE, not per sweep')
}
```

Adapt the claim/spend setup lines to the file's existing helpers verbatim (it already stages claims and spend rows for the overshoot scenario — copy that shape with the `ghost` scope and simply never create `runs.ghost`). Also extend the latch assertion to the existing park-refusal scenario if one exists: after its first refusal page, two more sweeps add zero pages.

- [ ] **Step 2: Run to fail** — `node fleet/tests/test_orchestrator.mjs`.

- [ ] **Step 3: Implement.** In `startOrchestrator`, beside `lastKnownGood`, add `const pagedRefusals = new Set()`. A helper inside the sweep closure:

```js
    const pageOnce = (key, cls, text) => {
      if (pagedRefusals.has(key)) return
      pagedRefusals.add(key)
      actions.page(cls, text)
    }
```

Then in the spend pass: replace the `if (runRow) { … }` block so the missing-row case is an explicit refusal — `if (!runRow) { pageOnce(`missing-row:${scopeId}`, 'security', `supervisor park refused for ${scopeId}: missing runs row — leaving claim and sandbox untouched`); continue }` — and route the existing park-refusal and revoke-refusal pages through `pageOnce` with keys `park-refusal:${scopeId}` / `revoke-refusal:${scopeId}`. The overshoot-success path (`actions.page('spend', …)`) is already once-per-run by construction (the claim is revoked) — leave it direct.

- [ ] **Step 4: Run green** — `node fleet/tests/test_orchestrator.mjs` → `ALL TESTS PASSED` (update any full-equality page expectations the new wording touches).

- [ ] **Step 5: Commit** `git add fleet/orchestrator.mjs fleet/tests/test_orchestrator.mjs && git commit -m "fleet: latch supervisor-refusal pages; missing runs row refuses destructive spend action (#190)"`

### Task 2: Validate the provision payload before delivery

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `fleet/provision.mjs`
- Test: `fleet/tests/test_provision.mjs`

**Interfaces:**
- Consumes: `provisionRun({golden, runId, baseRef, repoDir, ttlMs, wsUrl, port, planPath, …})` as-is.
- Produces: no new exports — `provisionRun` throws `provisionRun: invalid payload — <field> is <problem>` BEFORE issuing any exec command when `runId`/`wsUrl`/`planPath` is not a non-empty string or `ttlMs` is not a positive finite number. (`token` is minted internally and needs no caller validation.)

#190: the provision payload fields (including `planPath`) are unvalidated, and `JSON.stringify` silently drops `undefined` — the sandbox then boots with a payload missing the field, and the failure surfaces two stages later (a literal `undefined` plan path burns a sandbox; a missing `ttlMs` breaks the lease math). Refuse loudly before the first ssh, exactly as `driveOne`'s runId guard does.

- [ ] **Step 1: Write the failing tests** — append to `fleet/tests/test_provision.mjs` (its exec-recording harness is in scope):

```js
// --- #190: payload validation refuses before any command ---------------------
{
  const base = { golden: 'fleet-golden', runId: 'run-v1', baseRef: 'HEAD', repoDir: '/tmp/x', ttlMs: 60_000, wsUrl: 'ws://127.0.0.1:1/fleet', port: 1, planPath: 'docs/p.md', registerToken: () => {}, clock: () => 0 }
  for (const [field, value, problem] of [
    ['runId', undefined, 'missing'],
    ['planPath', undefined, 'missing'],
    ['planPath', '', 'missing'],
    ['wsUrl', undefined, 'missing'],
    ['ttlMs', undefined, 'missing'],
    ['ttlMs', -5, 'not a positive finite number'],
  ]) {
    const cmds = []
    const exec = async (cmd) => {
      cmds.push(cmd)
      return { code: 0, stdout: '{}' }
    }
    await assert.rejects(
      provisionRun({ ...base, [field]: value, exec }),
      new RegExp(`invalid payload — ${field}`),
      `${field}=${String(value)} must refuse`,
    )
    assert.deepEqual(cmds, [], `${field}=${String(value)} must refuse BEFORE any exec call`)
  }
}
```

(If an existing green scenario in this file calls `provisionRun` WITHOUT `planPath`, give that fixture a `planPath` — the validation is the new contract and the fixture predates it.)

- [ ] **Step 2: Run to fail** — `node fleet/tests/test_provision.mjs`.

- [ ] **Step 3: Implement.** At the top of `provisionRun`, before the clone command: a small guard block that checks `runId`, `wsUrl`, `planPath` with the same `isNonEmptyString` idiom the module already uses (add the helper if absent) and `Number.isFinite(ttlMs) && ttlMs > 0`; throw `new Error('provisionRun: invalid payload — <field> is missing')` (or `'… — ttlMs is not a positive finite number'`) on the first failure.

- [ ] **Step 4: Run green** — `node fleet/tests/test_provision.mjs && node fleet/tests/test_drive.mjs` (drive scenarios pass full payloads and stay green).

- [ ] **Step 5: Commit** `git add fleet/provision.mjs fleet/tests/test_provision.mjs && git commit -m "fleet: provisionRun validates its payload before the first command (#190)"`

### Task 3: versionStamp cross-check — the stamp must name the pushed base

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `fleet/drive.mjs`
- Test: `fleet/tests/test_drive.mjs`

**Commutes:** `fleet/tests/test_drive.mjs`

**Interfaces:**
- Consumes: `driveOne`'s existing `baseRef`, `repoDir`, `exec`, the `runs` row cells `pluginVersion`/`engineSha`, `MANIFEST_PATH` (from `fleet/shim-main.mjs`, already imported into `fleet/drive.mjs`'s module scope or import it).
- Produces: `read.versionStamp` strengthens from "both cells non-empty" to "both cells non-empty AND `engineSha` equals the driver's own `rev-parse <baseRef>` AND `pluginVersion` equals the manifest version at `<baseRef>`"; a mismatch also records one `detail.errors` line `version stamp mismatch: …`. When the driver cannot resolve its own expectation (`rev-parse`/`show` fails), the cross-check is SKIPPED with an errors line and versionStamp keeps the non-emptiness meaning — never a false red from the driver's own repo state.

#282 item 1 + #190: the golden sat four releases stale and nothing said so — `versionStamp` records non-emptiness only, so a sandbox that ran the IMAGE's code instead of the pushed base reads green. The driver knows exactly what it pushed; make the stamp attest THAT commit.

- [ ] **Step 1: Resolve the expectation at drive start.** In `driveOne`, right after the fitness preflight (before `startOrchestrator`): resolve once —

```js
  // #282/#190: what the stamp MUST name — resolved at drive start, from the
  // same ref provisionRun is about to push, so a repo that moves mid-drive
  // cannot shift the expectation.
  let expectedStamp = null
  try {
    const shaRes = await exec(`git -C ${repoDir} rev-parse ${baseRef}`)
    const manifestRes = await exec(`git -C ${repoDir} show ${baseRef}:${MANIFEST_PATH}`)
    if (shaRes?.code === 0 && manifestRes?.code === 0) {
      const version = JSON.parse(manifestRes.stdout)?.version
      const sha = String(shaRes.stdout ?? '').trim()
      if (/^[0-9a-f]{7,64}$/.test(sha) && typeof version === 'string' && version.length > 0) {
        expectedStamp = { engineSha: sha, pluginVersion: version }
      }
    }
  } catch {
    expectedStamp = null
  }
  if (expectedStamp === null) errors.push(`version cross-check unavailable: could not resolve ${baseRef} locally`)
```

(`errors` must already be declared — this sits with the fitness block, which the run-15 slate placed after the declarations.) Import `MANIFEST_PATH` from `./shim-main.mjs` alongside the existing imports. `baseRef` is operator input interpolated into the shell here exactly as `provisionRun` already interpolates it — guard it with the same `isSafeBranchName` import and skip the cross-check (with the errors line) when it fails.

- [ ] **Step 2: Strengthen the read.** Replace the `versionStamp` computation:

```js
  const stampedVersion = store.getCell('runs', runId, 'pluginVersion')
  const stampedSha = store.getCell('runs', runId, 'engineSha')
  let versionStamp = isNonEmptyString(stampedVersion) && isNonEmptyString(stampedSha)
  if (versionStamp && expectedStamp !== null) {
    const match = stampedSha === expectedStamp.engineSha && stampedVersion === expectedStamp.pluginVersion
    if (!match) {
      errors.push(
        `version stamp mismatch: sandbox ran ${stampedVersion}@${stampedSha}, ` +
          `pushed base is ${expectedStamp.pluginVersion}@${expectedStamp.engineSha} — stale golden or wrong base (#282)`,
      )
      versionStamp = false
    }
  }
```

- [ ] **Step 3: Write the failing scenario** — append to `fleet/tests/test_drive.mjs`: a stub-sandbox run (mirror the resolvable-receipt shape: `receiptSha: olderSha, branch: OLDER_BRANCH, receiptPath: 'old.txt'`) whose stub writes a WRONG stamp — pass the existing harness a way to override the stamp (add an optional `stamp` param to `startStubSandbox`, defaulting to the `readStamp` result; the scenario passes `stamp: { pluginVersion: '0.0.1', engineSha: 'deadbeef'.repeat(5) }`). Assert `read.versionStamp === false`, `read.o1` unchanged by this scenario's other legs, and one `detail.errors` entry matching `/version stamp mismatch/`. Then a control assertion: the FIRST existing scenario's full-equality `read` (versionStamp `true`) still passes untouched — the fixture repo's stub stamps from `BASE_REF`, which IS the pushed base.

- [ ] **Step 4: Run green** — `node fleet/tests/test_drive.mjs` → `ALL TESTS PASSED`, under 120 s.

- [ ] **Step 5: Commit** `git add fleet/drive.mjs fleet/tests/test_drive.mjs && git commit -m "fleet: versionStamp attests the pushed base, not mere non-emptiness (#282 #190)"`

### Task 4: runId becomes required — delete the `run-1` default footgun

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `fleet/drive.mjs`
- Modify: `fleet/RUNBOOK.md`
- Test: `fleet/tests/test_drive.mjs`

**Commutes:** `fleet/tests/test_drive.mjs`

**Interfaces:**
- Consumes: `driveOne`'s existing entry guard (`sandboxIdFor` + `isSafeVmName` refusal).
- Produces: `driveOne` throws `driveOne: runId is required — never reuse one (#211)` when `runId` is absent/empty; the `runId = 'run-1'` default is deleted.

#211 named the residual: `driveOne` defaults `runId` to `'run-1'` — one absent argument and a second run reuses a name, which under host-key/naming rules is a footgun the RUNBOOK already warns about in prose. Make the API refuse instead.

- [ ] **Step 1: Failing scenario** — append to `fleet/tests/test_drive.mjs`:

```js
  // -- #211 residual: runId is required, never defaulted ----------------------
  await assert.rejects(
    driveOne({ ...driveDefaults, dbDir: path.join(tmp, 'dbReq'), exec: async () => ({ code: 0, stdout: '' }) }),
    /runId is required/,
  )
```

- [ ] **Step 2: Implement.** In `driveOne`'s options, change `runId = 'run-1',` to `runId,` and extend the entry guard: before deriving `entryVmName`, `if (typeof runId !== 'string' || runId.length === 0) throw new Error('driveOne: runId is required — never reuse one (#211)')`.

- [ ] **Step 3: RUNBOOK.** In `fleet/RUNBOOK.md`, in the paragraph after the drive snippet that currently says driveOne "defaults `runId` to `run-1`", rewrite that sentence to: `driveOne` requires an explicit `runId` (it refuses to run without one — runIds are unique per account lifetime, #211) and defaults `capTokens` to `500_000` (W2 charter constant) and `ttlMs` to 4h.

- [ ] **Step 4: Run green** — `node fleet/tests/test_drive.mjs` → `ALL TESTS PASSED`.

- [ ] **Step 5: Commit** `git add fleet/drive.mjs fleet/RUNBOOK.md fleet/tests/test_drive.mjs && git commit -m "fleet: driveOne requires an explicit runId — delete the run-1 default (#211 residual)"`

---

## Operator smoke

- do: `node fleet/tests/test_orchestrator.mjs && node fleet/tests/test_provision.mjs && node fleet/tests/test_drive.mjs`
  see: three `ALL TESTS PASSED` lines, `test_drive.mjs` under 120 s.
- do: drive any future run against a deliberately stale golden (or wrong base)
  see: `versionStamp: false` with a `version stamp mismatch` errors line naming both versions — never a silent green.
- do: run the RUNBOOK driver snippet with the `runId` line deleted
  see: an immediate `driveOne: runId is required` refusal, no sandbox provisioned.
