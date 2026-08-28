# Fleet Park-Triage Contract + Fitness-at-baseRef Implementation Plan (#336 #337)

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the two run-15 residuals on the fleet drive layer — `detail.parkedPublish` must be non-null only when the parked branch was actually fetched (#336), and the #322 headless-fitness preflight must assess the plan as committed at the pushed `baseRef`, refusing an uncommitted or dirty plan (#337).

**Architecture:** Both fixes live in `fleet/drive.mjs`'s `driveOne`, in two hunks ~500 lines apart (the receipts-resolution tail for #336; the preflight block at the top for #337), each with its RUNBOOK paragraph and drive-test scenarios. Both tasks append pure new scenario blocks to the same test file, `fleet/tests/test_drive.mjs`, and declare it `Commutes:` — this plan doubles as a live check of the fold engine's auto-union on an append-shaped shared test module. The engine, gate scripts, and every frozen-periphery surface are untouched.

**Tech Stack:** Node ESM (`fleet/*.mjs`), `node:assert/strict` test files under `fleet/tests/`, joined to CI via `tests/test_fleet_suite.py`.

**Spec:** The two issues are the spec — #336 and #337 (both from run-15's residual manifest, recorded by the 2026-08-28 sense pass) — read against `fleet/drive.mjs`, `fleet/fitness.mjs`, `fleet/RUNBOOK.md` §Park triage and §Live W1 run "Headless fitness", and the prior plan `docs/superpowers/plans/2026-08-27-fleet-drive-hardening.md` (Tasks 3 and 4, which built the two surfaces being corrected).

**Acceptance:** suite — the committed fleet `.mjs` suite plus per-task review is the verification; every task carries a `Test:` entry and no claim rests on manual judgment (headless-fit per #322).

## Global Constraints

- Lane: `fleet/**` only (`fleet/drive.mjs`, `fleet/RUNBOOK.md`, `fleet/tests/`). Never touch `skills/`, `evals/`, `hooks/`, `tests/` at the repo root, `skills/ultrapowers/harnesses/waves.js`, `skills/ultrapowers/scripts/compile_plan.py`, or the frozen verification periphery.
- No `anthropic` SDK and no `ANTHROPIC_API_KEY` anywhere in `fleet/` (repo doctrine: a distributed plugin needs no API key).
- Every `fleet/tests/*.mjs` file must exit 0 within 120 s AND print `ALL TESTS PASSED` (that exact string) — `tests/test_fleet_suite.py` gates on both. Measured on main at 7e7c034: `test_drive.mjs` 51 s, `test_drive_lifecycle.mjs` 48 s. New scenarios must be cheap (reuse `driveDefaults`, short waits, never a scenario that idles a full default timeout).
- The §W1d gate-read object stays EXACTLY five keys — `o1`, `receiptsResolvable`, `leaseContinuity`, `versionStamp`, `spendObservational` — existing tests pin it by full `deepEqual`. New drive facts go in `detail` only.
- Appends to `fleet/tests/test_drive.mjs` are PURE appends: new top-level scenario blocks inserted immediately before the file's final `console.log('ALL TESTS PASSED')` line, no edits to imports, the fixture destructure, or any existing scenario. Each appended scenario is order-independent of its sibling task's appends (unique `runId`, unique `dbDir`, no shared mutable state), because the fold may union them in either order.
- `python3 -m pytest` green (baseline 1159 + whatever main has gained) before merge.

---

### Task 1: #336 — `detail.parkedPublish` is non-null only when the parked branch was fetched

**Type:** implementation
**Depends-on:** none
**Commutes:** `fleet/tests/test_drive.mjs`

**Files:**
- Modify: `fleet/drive.mjs`
- Modify: `fleet/RUNBOOK.md`
- Test: `fleet/tests/test_drive.mjs`

**Interfaces:**
- Consumes: nothing from sibling tasks.
- Produces: `detail.parkedPublish` contract tightened — `null`, or `{branch: string, fetched: true, receiptsResolvable: boolean, unapproved: true}`; non-null ⟺ the parked run's branch was fetched into `repoDir`. The `driveOne` signature, the gate-read object, and the N1/N2 pins in `fleet/tests/test_drive_lifecycle.mjs` are unchanged.

Run-15's adversarial review + completeness critic: a parked run whose branch fetch FAILED, or whose branch cell was unsafe, still reported `detail.parkedPublish` non-null — `{branch: null, fetched: false, receiptsResolvable: false, unapproved: true}` — while the RUNBOOK routes "non-null → the work survived". The branch dies with the sandbox at teardown, so a failed fetch means the work did NOT survive on this side, and the operator is misdirected away from the evidence-diff recovery exactly when it is needed. The minimal contract change: the object exists only when `fetchedOk` is true (the `fetched: true` field stays, now an invariant, so the N1 `deepEqual` pin in the lifecycle spec is untouched); the reason a fetch did not happen is already in `detail.errors` (`fetch <branch> failed (code N)` / `unsafe branch name in runs.<id>.branch — refusing to fetch`).

- [ ] **Step 1: Write the two failing scenarios.** Append to `fleet/tests/test_drive.mjs` immediately before its final `console.log('ALL TESTS PASSED')` line (inside the `try` block, after scenario 11). Everything used here — `tmp`, `repoDir`, `headSha`, `integrationSha`, `makeExec`, `startStubSandbox`, `driveDefaults`, `driveOne`, `RECEIPT_PATH`, `fs`, `path`, `assert` — is already imported/destructured at the top of the file; add no imports.

```js
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
```

- [ ] **Step 2: Run to see it fail.** `node fleet/tests/test_drive.mjs` → scenario 12 fails on the `parkedPublish` assertion (today it is `{branch: null, fetched: false, receiptsResolvable: false, unapproved: true}`).

- [ ] **Step 3: Tighten the contract in `fleet/drive.mjs`.** In `driveOne`, at the end of the receipts-resolution block (the two-line `if (reachedGateGreen) … else parkedPublish = …` tail, currently lines 736–737), replace:

```js
    if (reachedGateGreen) receiptsResolvable = resolvable
    else parkedPublish = { branch: fetchedBranch, fetched: fetchedOk, receiptsResolvable: resolvable, unapproved: true }
```

with:

```js
    if (reachedGateGreen) receiptsResolvable = resolvable
    // #336: non-null ⟺ the branch was fetched into repoDir. A failed or
    // refused fetch leaves NOTHING on this side — the branch dies with the
    // sandbox at teardown — so it reads null (RUNBOOK park triage step 2:
    // evidence-diff recovery), never a survived-shaped object carrying
    // `branch: null`. Why it was not fetched is already in `errors`.
    else if (fetchedOk) parkedPublish = { branch: fetchedBranch, fetched: true, receiptsResolvable: resolvable, unapproved: true }
```

Then update the `detail` literal's comment above `parkedPublish,` (currently lines 813–815) to:

```js
    // #318: a parked run's published branch, fetched locally but UNAPPROVED —
    // no standing grant covers it; merging it needs an explicit operator ack
    // of the parked gate receipt. null when the park published nothing OR its
    // branch could not be fetched (#336) — `errors` says which.
    parkedPublish,
```

No other line in `drive.mjs` changes in this task (Task 2 edits the preflight block at the top of `driveOne`; keep clear of it).

- [ ] **Step 4: Run to pass.** `node fleet/tests/test_drive.mjs` → `ALL TESTS PASSED`, total under 120 s (`time node fleet/tests/test_drive.mjs`; expect ~57 s). Then `node fleet/tests/test_drive_lifecycle.mjs` → `ALL TESTS PASSED` — N1 (fetched shape, `deepEqual`) and N2 (`null` when nothing published) must be untouched by the change.

- [ ] **Step 5: RUNBOOK park triage.** In `fleet/RUNBOOK.md` §`## Park triage (#318)`, replace the first two numbered triage items (currently):

```markdown
1. Read `detail.parkedPublish`. Non-null → the work survived; review the
   fetched branch and ack-or-reject.
2. `parkedPublish: null` → recover via the run-14 evidence-diff pattern:
   the per-task review diffs in the pulled evidence
   (`sandbox-logs.tgz`: `repo/.claude/ultrapowers/run-*/review/*.diff`)
   apply cleanly to base (PR #317 precedent); reconstruct any
   integration-only fixes from `report.json`.
```

with:

```markdown
1. Read `detail.parkedPublish`. Non-null means exactly one thing (#336): the
   parked run's branch IS fetched into the orchestrator checkout (`fetched`
   is always `true` when the object exists). Review `branch` and
   ack-or-reject; `receiptsResolvable` says whether every receipt pointer
   resolved on it.
2. `parkedPublish: null` → nothing survived on this side, for one of two
   reasons — the park published nothing, or the branch could not be fetched
   before teardown (`detail.errors` carries `fetch <branch> failed (code N)`
   or `unsafe branch name …`). Either way, recover via the run-14
   evidence-diff pattern: the per-task review diffs in the pulled evidence
   (`sandbox-logs.tgz`: `repo/.claude/ultrapowers/run-*/review/*.diff`)
   apply cleanly to base (PR #317 precedent); reconstruct any
   integration-only fixes from `report.json`.
```

Also change the section's opening sentence fragment "reports it as `detail.parkedPublish` — `{branch, fetched, receiptsResolvable, unapproved: true}` — in the gate-read detail." to "reports it as `detail.parkedPublish` — `{branch, fetched: true, receiptsResolvable, unapproved: true}`, or `null` when nothing was fetched — in the gate-read detail." Item 3 (harvest `completenessFindings`) is unchanged. Do not touch the `**Headless fitness (#322).**` paragraph in §Live W1 run — Task 2 owns it.

- [ ] **Step 6: Commit** `git add fleet/drive.mjs fleet/RUNBOOK.md fleet/tests/test_drive.mjs && git commit -m "fleet: parkedPublish is non-null only when the parked branch was fetched (#336)"`

### Task 2: #337 — the headless-fitness preflight assesses the plan as committed at `baseRef`

**Type:** implementation
**Depends-on:** none
**Review:** adversarial
**Commutes:** `fleet/tests/test_drive.mjs`

**Files:**
- Modify: `fleet/drive.mjs`
- Modify: `fleet/RUNBOOK.md`
- Modify: `fleet/tests/test_drive_lifecycle.mjs`
- Test: `fleet/tests/test_drive.mjs`

**Interfaces:**
- Consumes: `assessHeadlessFitness(planText: string): {fit, findings}` (from `fleet/fitness.mjs`, existing), `isSafeBranchName`, `isSafeRepoPath` (from `fleet/shim-main.mjs`, existing, already imported in `drive.mjs`).
- Produces: `driveOne` preflight now reads the plan via `git -C <repoDir> show <baseRef>:<planPath>` and throws — before any provisioning, and NOT overridable by `allowUnfitPlan` — on `not committed at <baseRef>` (plan in the working tree, absent at `baseRef`) or `differs between <baseRef>:<planPath> … and the working tree` (dirty plan). A plan absent from both still skips with narration. `driveOne`'s option signature is unchanged.

Run-15's residual: `driveOne` ran the #322 refusal against `fs.readFileSync(<repoDir>/<planPath>)` — the driver's WORKING TREE — while `provisionRun` pushes `baseRef` and the sandbox executes the plan as committed there. When the two diverge the verdict attaches to text that is never dispatched: a spurious refusal on an uncommitted edit in one direction, a silent pass of an unfit committed plan in the other. The fix reads the committed text (the same source the sandbox gets) and treats the two divergences as operator errors, refused outright: a dirty plan cannot be dispatched honestly, and a plan the pushed ref does not carry cannot be dispatched at all. The fix lives in `driveOne` — where the check is and where the issue points (`drive.mjs:247`) — so every caller gets it; `fleet/drive-one.mjs` needs no change (it already forwards `planPath`/`repoDir`, and `driveOne` owns `baseRef`, default `HEAD`).

The existing N3/N4 scenarios in `fleet/tests/test_drive_lifecycle.mjs` wrote the unfit plan into the working tree WITHOUT committing it — the exact shape the fix now refuses — so this task rewrites that contiguous N3–N4 region (only this task touches that file). The new scenarios proving each direction of #337 are appended to `fleet/tests/test_drive.mjs` (the shared append surface).

- [ ] **Step 1: Write the failing scenarios in `fleet/tests/test_drive.mjs`.** Append immediately before the file's final `console.log('ALL TESTS PASSED')` line (inside the `try` block). Everything used — `tmp`, `repoDir`, `makeExec`, `startStubSandbox`, `driveDefaults`, `driveOne`, `sh`, `OLDER_BRANCH`, `olderSha`, `fs`, `path`, `assert` — is already imported/destructured at the top of the file; add no imports. The helper commits a plan onto a SIDE branch through a temporary index, so `HEAD`/`main`, the working tree, and every other scenario's shas are untouched.

```js
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
```

- [ ] **Step 2: Run to see it fail.** `node fleet/tests/test_drive.mjs` → 13a fails (the working tree has no copy, so today's preflight skips and provisioning is attempted — `neverProvision` throws, and the rejection does not match `/headless-unfit/`).

- [ ] **Step 3: Rewrite the preflight in `fleet/drive.mjs`.** In `driveOne`, replace the whole `#322` preflight block — from the comment line `// #322: headless-fitness preflight. A plan carrying a task whose only` through the closing `}` of its `if (planText === null) { … } else { … }` (currently lines 220–248) — with:

```js
  // #322: headless-fitness preflight. A plan carrying a task whose only
  // evidence is human judgment is GUARANTEED to park an unattended drive —
  // refuse it here, before a sandbox exists, not 200k tokens later.
  //
  // #337: the text assessed is the plan AS COMMITTED AT `baseRef` — the same
  // source `provisionRun` pushes and the sandbox executes — never the working
  // tree. Assessing the working tree let the verdict attach to text that was
  // never dispatched (a spurious refusal on an uncommitted edit; a silent
  // pass of an unfit committed plan). Two divergences are operator errors,
  // refused outright and NOT fitness verdicts, so `allowUnfitPlan` does not
  // cover them: a plan present in the working tree but absent at `baseRef`
  // (uncommitted — the sandbox would receive nothing), and a plan whose
  // working-tree copy differs from the committed one (dirty — nobody can say
  // which text the verdict is about). A plan absent from BOTH skips the check
  // with narration only (the live drive always has the merged plan committed;
  // the in-process tests do not).
  const planFile = path.isAbsolute(planPath) ? planPath : path.join(repoDir, planPath)
  const planRel = path.relative(repoDir, planFile)
  let workingText = null
  try {
    workingText = fs.readFileSync(planFile, 'utf8')
  } catch {
    workingText = null
  }
  let committedText = null
  // Both halves are interpolated into a shell: the ref passes the guard
  // provisionRun applies to it, the path the receipt-pointer guard (same
  // character class, no `..` segment — a path that escapes the checkout can
  // be at no ref). A guard miss reads as "absent at baseRef".
  if (isSafeBranchName(baseRef) && isSafeRepoPath(planRel)) {
    try {
      const shown = await exec(`git -C ${repoDir} show ${baseRef}:${planRel}`)
      if (shown?.code === 0 && typeof shown.stdout === 'string') committedText = shown.stdout
    } catch {
      committedText = null
    }
  }
  if (committedText === null && workingText === null) {
    note(`headless-fitness: plan absent at ${baseRef}:${planRel} and unreadable at ${planFile} — check skipped`)
  } else if (committedText === null) {
    throw new Error(
      `driveOne: plan ${planRel} is in the working tree but not committed at ${baseRef} — the sandbox ` +
        `executes the pushed ${baseRef}, never the working tree; commit it, or pass the ref that carries it (#337)`,
    )
  } else if (workingText !== null && workingText !== committedText) {
    throw new Error(
      `driveOne: plan ${planRel} differs between ${baseRef}:${planRel} (what the sandbox executes) and the ` +
        `working tree ${planFile} — commit or discard the edit so the fitness verdict attaches to the ` +
        `dispatched text (#337)`,
    )
  } else {
    const fitness = assessHeadlessFitness(committedText)
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

Then extend the `@param {boolean} [opts.allowUnfitPlan]` JSDoc entry above `driveOne` (currently lines 124–128) by appending one sentence to it: `The plan is read as committed at \`baseRef\` (#337); an uncommitted or dirty plan is refused regardless of this flag.` No other line in `drive.mjs` changes in this task (Task 1 edits the receipts-resolution tail near `parkedPublish`; keep clear of it). Note `isSafeBranchName` and `isSafeRepoPath` are already imported from `./shim-main.mjs`.

- [ ] **Step 4: Rewrite N3/N4 in `fleet/tests/test_drive_lifecycle.mjs`.** Replace the contiguous region from the comment line `// -- N3. #322: an unfit plan is refused BEFORE any provisioning -------------` through the closing `}` of the N4 block (currently lines 273–330; the blank line and `// -- 12. shim-main's pure helpers` that follow stay) with the version below. The two scenarios keep their contracts (refused before provisioning; override proceeds with the line on the record) but now commit the unfit plan onto a side branch through a temporary index — the shape #337 requires — and drive with `baseRef` naming it, so `HEAD`, the working tree and the fixture shas are untouched. `sh` and `startStubSandbox`'s `stamp` override are already imported/available in this file.

```js
  // -- N3. #322: an unfit plan is refused BEFORE any provisioning -------------
  // #337: the preflight reads the plan as COMMITTED at baseRef, so the unfit
  // plan is committed onto a side branch (temporary index; HEAD, the working
  // tree and every fixture sha stay put) and the drive names that ref. The
  // working-tree copy is written too, identical — the honest live shape.
  const unfitPlan = 'docs/unfit-plan.md'
  const UNFIT_PLAN_TEXT =
    '# P\n\n### Task 1: Docs only\n**Type:** implementation\n**Depends-on:** none\n\n**Files:**\n- Modify: `docs/a.md`\n\n- [ ] **Step 1: edit**\n'
  const unfitSha = await (async () => {
    fs.mkdirSync(path.join(repoDir, 'docs'), { recursive: true })
    fs.writeFileSync(path.join(repoDir, unfitPlan), UNFIT_PLAN_TEXT)
    const idx = path.join(tmp, 'unfit-plan.idx')
    const r = await sh(
      `set -e; blob=$(git hash-object -w ${unfitPlan}); ` +
        `GIT_INDEX_FILE="${idx}" git read-tree main; ` +
        `GIT_INDEX_FILE="${idx}" git update-index --add --cacheinfo 100644,$blob,${unfitPlan}; ` +
        `tree=$(GIT_INDEX_FILE="${idx}" git write-tree); ` +
        `commit=$(git commit-tree $tree -p main -m unfit-plan); ` +
        `git branch unfit-plan $commit; printf '%s' $commit`,
      repoDir,
    )
    assert.equal(r.code, 0, `committing the unfit plan on a side branch failed: ${r.stderr}`)
    return r.stdout.trim()
  })()
  assert.match(unfitSha, /^[0-9a-f]{40}$/)
  {
    const runId = 'run-drive-unfit'
    let provisioned = false
    await assert.rejects(
      driveOne({
        ...driveDefaults,
        planPath: unfitPlan,
        baseRef: 'unfit-plan',
        dbDir: path.join(tmp, 'dbN3'),
        exec: makeExec(() => {}),
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
          // The stamp expectation is resolved from `baseRef` — the side branch.
          stamp: { pluginVersion: '9.9.9', engineSha: unfitSha },
        })
      }, 30)
    })
    const { read, detail } = await driveOne({
      ...driveDefaults,
      planPath: unfitPlan,
      baseRef: 'unfit-plan',
      allowUnfitPlan: true,
      dbDir: path.join(tmp, 'dbN4'),
      exec,
      runId,
    })
    await sandbox
    assert.equal(read.o1, true, 'the override drives normally')
    assert.equal(read.versionStamp, true, 'the expectation resolved from the side branch')
    assert.ok(
      detail.errors.some((e) => /headless-fitness: proceeding on operator override/.test(e)),
      `the override is on the record, got: ${JSON.stringify(detail.errors)}`,
    )
  }
```

- [ ] **Step 5: Run to pass.** `node fleet/tests/test_drive.mjs` and `node fleet/tests/test_drive_lifecycle.mjs` — both `ALL TESTS PASSED`, each under 120 s (`time …`; expect ~55 s and ~48 s). Every pre-existing scenario uses `planPath: 'docs/superpowers/plans/example.md'`, absent from both the fixture repo's `HEAD` and its working tree, so they hit the absent-from-both skip branch exactly as before. Also `node fleet/tests/test_drive_one.mjs` → `ALL TESTS PASSED (11)` (the CLI is untouched; this confirms it).

- [ ] **Step 6: RUNBOOK.** In `fleet/RUNBOOK.md` §`## Live W1 run`, replace the `**Headless fitness (#322).**` paragraph (currently lines 291–299, beginning `**Headless fitness (#322).** \`driveOne\` refuses a plan carrying any task whose` and ending `override is recorded in \`detail.errors\`.`) with:

```markdown
**Headless fitness (#322, #337).** `driveOne` refuses a plan carrying any task
whose verification can only be evidenced by human judgment — the known class
is the instruction-only doc task (`implementation` type, every Files entry a
`.md`, no `Test:` entry). run-14 proved such a task makes a `deferred:manual`
park a certainty, discovered only after ~47 min and 203k tokens. Before
dispatching: rewrite the verification into runtime/external form (add a
pinning test), or route that task to a local drain. `allowUnfitPlan: true`
(`--allow-unfit-plan`) overrides — pass it only with a specific operator
pre-authorization for that manual ack, and the override is recorded in
`detail.errors`. The plan assessed is the one **committed at `baseRef`**
(`git show <baseRef>:<planPath>`, default `HEAD`) — the same text the sandbox
executes — never the working tree. Two operator errors are refused before any
provisioning and are not covered by the override: the plan is in the working
tree but not committed at `baseRef` (`not committed at …` — commit it), or the
working-tree copy differs from the committed one (`differs between …` — commit
or discard the edit). Merge the plan and drive from a clean checkout.
```

Do not touch §`## Park triage (#318)` — Task 1 owns it.

- [ ] **Step 7: Commit** `git add fleet/drive.mjs fleet/RUNBOOK.md fleet/tests/test_drive.mjs fleet/tests/test_drive_lifecycle.mjs && git commit -m "fleet: headless-fitness preflight assesses the plan as committed at baseRef; uncommitted or dirty plans refused (#337)"`

### Task 3: Suite gate

**Type:** gate
**Depends-on:** 1, 2

**Files:**
- Test: `fleet/tests/test_drive.mjs`
- Test: `fleet/tests/test_drive_lifecycle.mjs`
- Test: `fleet/tests/test_drive_one.mjs`

**Interfaces:**
- Consumes: nothing (verification only).
- Produces: nothing.

- [ ] **Step 1: Per-file runtime under the cap.** `cd fleet && time node tests/test_drive.mjs && time node tests/test_drive_lifecycle.mjs && time node tests/test_drive_one.mjs` — each prints `ALL TESTS PASSED` and finishes under 120 s (expected ≈ 61 s / 48 s / <1 s: `test_drive.mjs` carries both tasks' appends after the union).

- [ ] **Step 2: Whole suite.** `python3 -m pytest` from the repo root — green (`tests/test_fleet_suite.py` runs every `fleet/tests/test_*.mjs`; baseline 1159 on main at 7e7c034).

---

## Execution fit

`2 implementation tasks, widest wave 2 (Tasks 1 and 2 are independent; both edit drive.mjs and RUNBOOK.md in disjoint hunks that fold at merge, and both append to test_drive.mjs under Commutes), low risk → by the rubric (T≤2) Inline (recommended).` The operator's stated purpose for this plan — exercising the fold engine's auto-union on an append-shaped shared test file — is a reason to select Ultrapowers deliberately; the rubric's recommendation is rendered honestly and the selection is the operator's.

1. **Ultrapowers** — `/ultrapowers docs/superpowers/plans/2026-08-29-fleet-park-triage-and-fitness-ref.md`: one wave of 2, worktree isolation, per-task review (Task 2 adversarial), one pre-merge gate. Selecting it authorizes execution.
2. **Subagent-Driven** — superpowers:subagent-driven-development, sequential, review between tasks.
3. **Inline (recommended by the rubric)** — superpowers:executing-plans, continuous inline execution.

## Operator smoke

- do: on the next real fleet drive, before `node fleet/drive-one.mjs <plan> <runId>`, edit one character of the plan without committing, then run the command.
  see: it exits 1 immediately with `plan … differs between HEAD:<plan> (what the sandbox executes) and the working tree …` — and no `ssh exe.dev "cp …"` line appears in the log (no sandbox was provisioned).
- do: `git checkout -- <plan>` and re-run the same command.
  see: the drive proceeds (`provisioning fleet-<runId> from fleet-golden` appears) — same plan, same text, no refusal.
- do: on the next park, open `gate-read-<runId>.detail.json`.
  see: `parkedPublish` is either an object whose `fetched` is `true` with a real `branch` name, or `null` with an `errors` line saying why (`fetch … failed` / `unsafe branch name …` / nothing published) — never `{"branch": null, "fetched": false, …}`.
