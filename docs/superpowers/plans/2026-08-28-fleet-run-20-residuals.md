# Fleet Run-20 Residuals Implementation Plan (#362)

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the six run-20 critic residuals on the #337 fitness-at-baseRef preflight (issue #362, closes #362): the production exec seam must stop folding stderr into the stdout the preflight compares byte-for-byte (false-refusal risk), the three untested branches of the preflight conditional get pinned, and the #337 scenarios stop leaving fixture residue.

**Architecture:** Two `implementation` tasks on the fleet drive layer, authored against main at `90061f9` (#368's publish leg landed: `shellExec` is now `(cmd, { env })` and `driveOne` pushes + opens the PR). Task 1 (#362 items 1, 4, 6) changes `shellExec` in `fleet/drive-one.mjs` to return `stderr` as its own field so `stdout` stays exactly what the command printed — keeping the #368 per-command `env` layering — adds one module-local helper `execDiagnostic(result)` to `fleet/drive.mjs` and threads `stderr` through the four diagnostic lines that used to inherit it via the concatenation (the two teardown captures and the publish leg's push / `gh pr create` failures; plus the tunnel-failure line in `fleet/provision.mjs`) so nothing legible is lost, and pins it all: a `shellExec` shape pin, a drive-level scenario that injects stderr chatter on `git show` and asserts the clean plan is NOT refused, the `.gitattributes`-absent assumption, and no-store-dir assertions on the three #337 refusals. Task 2 (#362 items 2, 3, 5) gives the guard-miss branch of the preflight its own honest refusal (a plan path failing `isSafeRepoPath` is a path problem, never "not committed"), pins that text and the `check skipped` narration, and cleans up the branches and `docs/` dir the #337 scenarios mint. Both tasks edit `fleet/drive.mjs` in disjoint regions (Task 1: the `opts.exec` JSDoc line, the `boundedExec`/`captureJson`/`pullLogsOnce` neighbourhood in the teardown-capture section, and the two publish-leg failure lines; Task 2: the preflight block between `let committedText = null` and the four-way conditional, ~170 lines above the nearest Task 1 hunk) — the fold merges disjoint hunks, and neither region is append-shaped, so no `Commutes:` is declared for it. Both tasks add lines to `fleet/tests/test_drive.mjs` purely additively (Task 1 inserts inside scenarios 13a/13b/13c and appends 13e; Task 2 inserts at the tail of 13d and appends 13f/13g) and declare `Commutes:` on it, as the #336/#337 plan did. Neither task touches `fleet/shim-main.mjs` or `fleet/tests/test_drive_lifecycle.mjs` scenario 15 — shim-main's OWN `shellExec` (a different function) is being changed by #373 / PR #375 in parallel.

**Tech Stack:** Node ESM (`fleet/*.mjs`), `node:assert/strict` test files under `fleet/tests/`, joined to CI via `tests/test_fleet_suite.py`.

**Spec:** Issue #362 is the spec (six numbered items, harvested from fleet run-20's `completenessFindings`), read against `fleet/drive.mjs` (the #337 preflight, `driveOne`), `fleet/drive-one.mjs` (`shellExec`, the production exec seam), `fleet/tests/_drive_helpers.mjs` (the fixture — note its `sh` keeps `stderr` OFF `stdout`, which is exactly why the suite never caught item 1), and the prior plan `docs/superpowers/plans/2026-08-29-fleet-park-triage-and-fitness-ref.md` (Task 2 built the preflight being corrected).

**Acceptance:** suite — the committed fleet `.mjs` suite plus per-task review is the verification; every task carries a `Test:` entry and no claim rests on manual judgment (headless-fit per #322).

**Scope note:** fleet-only (`fleet/**`). No plugin behavior changes, no release needed; this plan is the validation payload for a fleet run on a freshly cut engine.

**Closes:** #362

## Global Constraints

- Lane: `fleet/**` only (`fleet/drive.mjs`, `fleet/drive-one.mjs`, `fleet/provision.mjs`, `fleet/tests/`). Never touch `skills/`, `evals/`, `hooks/`, `tests/` at the repo root, `skills/ultrapowers/harnesses/waves.js`, `skills/ultrapowers/scripts/compile_plan.py`, or the frozen verification periphery.
- No `anthropic` SDK and no `ANTHROPIC_API_KEY` anywhere in `fleet/` (repo doctrine: a distributed plugin needs no API key).
- Every `fleet/tests/*.mjs` file must exit 0 within 120 s AND print `ALL TESTS PASSED` (that exact string, #351) — `tests/test_fleet_suite.py` gates on both. Measured on main at 90061f9: `fleet/tests/test_drive.mjs` 61 s. New scenarios must be cheap (reuse `driveDefaults`, short waits, never a scenario that idles a full default timeout); the two tasks together may add at most one full stub-sandbox drive (~6 s) plus pre-provision refusals (<1 s each).
- The §W1d gate-read object stays EXACTLY five keys — `o1`, `receiptsResolvable`, `leaseContinuity`, `versionStamp`, `spendObservational` — existing tests pin it by full `deepEqual`. New drive facts go in `detail` only.
- Edits to `fleet/tests/test_drive.mjs` are PURELY ADDITIVE: no existing line is modified or deleted; new scenario blocks are appended immediately before the file's final `console.log('ALL TESTS PASSED')` line; inserted assertions go at the named anchors only. Each appended scenario is order-independent of its sibling task's appends (unique `runId`, unique `dbDir`, its own side branch, cleans up after itself), because the fold may union them in either order.
- The `exec` seam contract, after this plan: `(cmd: string, opts?: {env?: Record<string,string>}) => Promise<{code: number, stdout: string, stderr?: string}>` — `opts.env` is #368's per-command layered environment and is untouched here; `stdout` is exactly what the command printed on stdout; `stderr` is optional (test stubs may omit it) and is only ever appended to diagnostic lines, never compared or parsed.
- `python3 -m pytest` green (baseline on main at 42734e8 + whatever main has gained) before merge.

---

### Task 1: #362-1/4/6 — the production exec seam keeps stdout pure; pin it, the `.gitattributes` assumption, and the no-store-dir property

**Type:** implementation
**Depends-on:** none
**Commutes:** `fleet/tests/test_drive.mjs`

**Files:**
- Modify: `fleet/drive-one.mjs`
- Modify: `fleet/drive.mjs`
- Modify: `fleet/provision.mjs`
- Test: `fleet/tests/test_drive_one.mjs`
- Test: `fleet/tests/test_drive.mjs`

**Interfaces:**
- Consumes: nothing from sibling tasks.
- Produces: `shellExec(cmd: string, opts?: {env?: Record<string,string>}): Promise<{code: number, stdout: string, stderr: string}>` in `fleet/drive-one.mjs` — `stdout` is exactly the command's stdout, `stderr` exactly its stderr, never concatenated; the #368 `env` layering is unchanged. A module-local (not exported) helper `execDiagnostic(result: {stdout?: string, stderr?: string} | undefined): string` in `fleet/drive.mjs` — the trimmed stdout and stderr of a failed command joined by one space, empty when both are empty. driveOne's signature and the gate-read object are unchanged.

**Why.** `fleet/drive.mjs`'s #337 dirty check compares the working-tree plan byte-for-byte against `exec('git -C <repo> show <baseRef>:<rel>').stdout`, but the PRODUCTION seam `shellExec` (`fleet/drive-one.mjs`) resolves `stdout: \`${stdout}${stderr}\``. Any stderr chatter from `git show` that still exits 0 (a `warning:`/`hint:` from a global config, an advice message) lands in `committedText`, `workingText !== committedText` fires, and the live drive hard-refuses a clean, committed plan with `differs between …` — no override exists for that branch. The fixture never caught it because `_drive_helpers.mjs`'s `sh` keeps `stderr` off `stdout`. The stamp read (`JSON.parse(manifestRes.stdout)`) tolerated the concatenation only by accident; it is unaffected by the fix. Two more unpinned properties ride along: `git show` emits the raw blob while the working tree is the smudged checkout, which only coincide because the repo carries no `.gitattributes` (item 4), and the three #337 refusal scenarios assert `provisioned === false` but not that no orchestrator/store directory was created (item 6; scenario 18 in `fleet/tests/test_drive_lifecycle.mjs` is the pattern).

**Region map for `fleet/drive.mjs`** (a sibling task edits the preflight block in the same file; stay out of it): this task touches ONLY (a) the `@param … opts.exec` JSDoc line above `export const driveOne`, (b) the `errors.push(\`${label}: code …\`)` line inside `captureJson`, and (c) the `else errors.push(\`pull sandbox logs: code …\`)` line inside `pullLogsOnce`. Do not touch anything between `const planFile = …` and the end of the `assessHeadlessFitness` conditional.

Keep `fleet/tests/test_drive.mjs` under the 120 s cap (#351): this task adds exactly one full stub-sandbox drive (13e, ~6 s on a 60 s baseline) and three pairs of `fs.existsSync` assertions.

- [ ] **Step 1: Write the failing `shellExec` shape pin.** In `fleet/tests/test_drive_one.mjs`, add `shellExec` to the import list from `../drive-one.mjs` (alphabetical: after `parseArgs`, before `usage`), then insert this block immediately before the file's final `console.log(\`\nALL TESTS PASSED (${passed})\`)` line:

```js
// --- shellExec (#362-1) ----------------------------------------------------
// The production exec seam keeps stdout PURE. drive.mjs's #337 preflight
// compares the working-tree plan byte-for-byte against `git show`'s stdout,
// so stderr chatter folded into stdout read a clean committed plan as dirty
// and hard-refused the drive (run-20 critic). stderr travels separately and
// is only ever appended to diagnostic lines.
{
  assert.deepEqual(await shellExec('printf out; printf err 1>&2'), { code: 0, stdout: 'out', stderr: 'err' })
  assert.deepEqual(await shellExec('exit 7'), { code: 7, stdout: '', stderr: '' })
  const missing = await shellExec('fleet-no-such-binary-362')
  assert.notEqual(missing.code, 0)
  assert.equal(missing.stdout, '', 'a failure leaves stdout empty — the diagnostic is on stderr')
  assert.ok(missing.stderr.length > 0, 'the shell names the missing binary on stderr')
  ok('shellExec keeps stdout pure and carries stderr separately (#362-1)')
}
```

- [ ] **Step 2: Run it to see it fail.**

Run: `node fleet/tests/test_drive_one.mjs`
Expected: FAIL at the first `deepEqual` — actual `{ code: 0, stdout: 'outerr' }` (stderr concatenated, no `stderr` key).

- [ ] **Step 3: Fix `shellExec`.** In `fleet/drive-one.mjs`, replace the `shellExec` export with:

```js
// #362-1: stdout and stderr travel SEPARATELY. drive.mjs's #337 preflight
// compares the working-tree plan byte-for-byte against `git show`'s stdout;
// folding stderr chatter (a `warning:`/`hint:` line from a global config)
// into it read a clean, committed plan as dirty and hard-refused the drive.
// Callers that want the diagnostic text of a failed command read `stderr`.
export const shellExec = (cmd) =>
  new Promise((resolve) => {
    execFile('/bin/sh', ['-c', cmd], { maxBuffer: 1024 * 1024 * 16 }, (error, stdout, stderr) =>
      resolve({ code: error?.code ?? 0, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') })
    )
  })
```

- [ ] **Step 4: Keep the diagnostics legible.** Three lines used to inherit stderr text through the concatenation; give each the `stderr` field explicitly so a failed teardown capture or tunnel still names its reason.

In `fleet/drive.mjs`, inside `captureJson`, replace the non-zero-code branch:

```js
      if (result?.code !== 0) {
        const diag = [raw.trim(), String(result?.stderr ?? '').trim()].filter(Boolean).join(' ')
        errors.push(`${label}: code ${result?.code} ${diag}`.trim())
        return null
      }
```

In `fleet/drive.mjs`, inside `pullLogsOnce`, replace the `else errors.push(\`pull sandbox logs: …\`)` line:

```js
        else {
          const diag = [String(result?.stdout ?? '').trim(), String(result?.stderr ?? '').trim()].filter(Boolean).join(' ')
          errors.push(`pull sandbox logs: code ${result?.code} ${diag}`.trim())
        }
```

In `fleet/drive.mjs`, replace the `opts.exec` JSDoc line above `export const driveOne`:

```js
 * @param {(cmd: string) => Promise<{stdout: string, code: number, stderr?: string}>} opts.exec -
 *   `stdout` is compared byte-for-byte against the working tree by the #337
 *   preflight, so an exec MUST keep stderr off it (#362); `stderr`, when
 *   present, is only appended to the diagnostic lines the teardown captures push.
```

In `fleet/provision.mjs`, in the reverse-tunnel failure throw, replace the trailing interpolation `${(tunnel?.stdout ?? '').trim()}` with:

```js
${[(tunnel?.stdout ?? '').trim(), (tunnel?.stderr ?? '').trim()].filter(Boolean).join(' ')}
```

- [ ] **Step 5: Run the shape pin and the neighbours.**

Run: `node fleet/tests/test_drive_one.mjs && node fleet/tests/test_provision.mjs && node fleet/tests/test_drive_lifecycle.mjs`
Expected: each prints `ALL TESTS PASSED`. (Lifecycle scenario 15 pins `shim-main.mjs`'s own `shellExec` by `deepEqual` to `{code, stdout}` — that is a DIFFERENT function and is untouched.)

- [ ] **Step 6: Write the failing drive-level scenario + the `.gitattributes` pin.** Append to `fleet/tests/test_drive.mjs` immediately before its final `console.log('ALL TESTS PASSED')` line (inside the `try`, after scenario 13d). Everything used — `tmp`, `repoDir`, `olderSha`, `makeExec`, `startStubSandbox`, `driveDefaults`, `driveOne`, `OLDER_BRANCH`, `sh`, `fs`, `path`, `assert`, and the 13-series locals `commitPlanOnBranch` / `FIT_PLAN` — is already in scope; add no imports.

```js
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
    const exec = async (cmd) => {
      const result = await inner(cmd)
      if (/^git -C \S+ show plan-chatter:/.test(cmd)) {
        chattered += 1
        return { ...result, stderr: `warning: fixture chatter on stderr (#362)\n${result.stderr ?? ''}` }
      }
      return result
    }
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
```

- [ ] **Step 7: Add the no-store-dir assertions to 13a, 13b, 13c (#362-6).** In `fleet/tests/test_drive.mjs`, in each of the three refusal scenarios, insert directly after the line `assert.equal(provisioned, false, 'the refusal must precede provisioning')` (that exact line appears once per scenario) the two assertions below, with `<db>` replaced by that scenario's own `dbDir` basename — `db-337a` in 13a, `db-337b` in 13b, `db-337c` in 13c. Do not modify any existing line.

```js
    // #362-6: the refusal precedes the orchestrator start AND teardown — no
    // store dir, no evidence dir (scenario 18 in test_drive_lifecycle.mjs is
    // the pattern). Pinned so a later reordering of the preflight is caught.
    assert.equal(fs.existsSync(path.join(tmp, '<db>')), false, 'refusal must precede the orchestrator start — no store dir may exist')
    assert.equal(fs.existsSync(path.join(tmp, '<db>-evidence')), false, 'refusal must precede teardown captures — no evidence dir may exist')
```

- [ ] **Step 8: Run the drive spec, then the whole fleet suite, and time it.**

Run: `time node fleet/tests/test_drive.mjs`
Expected: `ALL TESTS PASSED`, wall time under 120 s (target ≤ 70 s). Scenario 13e passes against the fixed preflight because `driveOne` reads only `shown.stdout`; the `chattered === 1` assertion proves the injected branch was the one compared.

Run: `python3 -m pytest tests/test_fleet_suite.py -q`
Expected: green.

- [ ] **Step 9: Commit.**

```bash
git add fleet/drive-one.mjs fleet/drive.mjs fleet/provision.mjs fleet/tests/test_drive_one.mjs fleet/tests/test_drive.mjs
git commit -m "fleet: shellExec keeps stdout pure (#362-1); pin .gitattributes-absent (#362-4) and no-store-dir on the #337 refusals (#362-6)"
```

---

### Task 2: #362-2/3/5 — an honest guard-miss refusal, the `check skipped` narration pinned, and the #337 fixture residue cleaned up

**Type:** implementation
**Depends-on:** none
**Commutes:** `fleet/tests/test_drive.mjs`

**Files:**
- Modify: `fleet/drive.mjs`
- Test: `fleet/tests/test_drive.mjs`
- Test: `fleet/tests/test_drive_lifecycle.mjs`

**Interfaces:**
- Consumes: nothing from sibling tasks.
- Produces: a new driveOne refusal, thrown before any exec call and before the orchestrator starts, whose message matches `/fails the repo-path guard/` and `/#362/` and never `/not committed/`; the pre-existing skip narration `headless-fitness: plan absent at <baseRef>:<rel> and unreadable at <file> — check skipped` is now a pinned literal. driveOne's signature and the gate-read object are unchanged.

**Why.** In the #337 preflight, when `isSafeRepoPath(planRel)` fails (a plan path with a space, or an absolute `planPath` outside `repoDir` whose `planRel` starts with `..`), `committedText` stays null while `workingText` reads fine, so `driveOne` throws `plan <rel> is in the working tree but not committed at <baseRef>` for a plan that IS committed — misleading and non-overridable, and no scenario drives it (item 2). The absent-from-both skip narration is exercised implicitly by every pre-#337 scenario via `driveDefaults.planPath` but asserted nowhere (item 3). And the #337 scenarios leave branches `plan-fit`/`plan-unfit` (test_drive.mjs) and `unfit-plan` (test_drive_lifecycle.mjs) plus a `docs/` dir in `repoDir`, so any future scenario enumerating `refs/heads/*` or asserting a clean tree becomes order-dependent on them (item 5).

**Region map for `fleet/drive.mjs`** (a sibling task edits the `opts.exec` JSDoc line, the `captureJson` error line and the `pull sandbox logs` line in the same file; stay out of those): this task touches ONLY the preflight block — the lines from `let committedText = null` through the closing `}` of the `if (isSafeBranchName(baseRef) && isSafeRepoPath(planRel)) { … }` block. The four-way conditional that follows and its three messages are unchanged.

Keep `fleet/tests/test_drive.mjs` under the 120 s cap (#351): this task adds two pre-provision refusals (13f, no orchestrator started, well under 1 s) and one orchestrator-start-then-abort drive (13g, ~1–2 s). The lifecycle file gains two git commands.

- [ ] **Step 1: Write the failing guard-miss scenario.** Append to `fleet/tests/test_drive.mjs` immediately before its final `console.log('ALL TESTS PASSED')` line (inside the `try`, after scenario 13d). Everything used — `tmp`, `repoDir`, `driveDefaults`, `driveOne`, `fs`, `path`, `assert`, and the 13-series locals `FIT_PLAN` / `neverProvision` — is already in scope; add no imports. Uses the default `baseRef` (`HEAD`) and no side branch, so it is order-independent of 13e and of the cleanup in Step 6.

```js
  // -- 13f. #362-2: a plan path that fails the interpolation guard is refused
  //        AS a path problem — before any exec call, before the orchestrator —
  //        never as "not committed at baseRef" (which it may well be).
  {
    const unsafeRel = 'docs/plan with space.md'
    fs.mkdirSync(path.join(repoDir, 'docs'), { recursive: true })
    fs.writeFileSync(path.join(repoDir, unsafeRel), FIT_PLAN)
    const outside = path.join(tmp, 'outside-362.md')
    fs.writeFileSync(outside, FIT_PLAN)
    for (const [label, planPath, dbName] of [
      ['a space in the path', unsafeRel, 'db-362f-space'],
      ['an absolute path outside repoDir', outside, 'db-362f-outside'],
    ]) {
      const cmds = []
      const exec = async (cmd) => {
        cmds.push(cmd)
        return { code: 0, stdout: '' }
      }
      await assert.rejects(
        driveOne({
          ...driveDefaults,
          planPath,
          dbDir: path.join(tmp, dbName),
          exec,
          runId: `run-drive-362-${dbName}`,
          provision: neverProvision,
        }),
        (error) => {
          assert.match(error.message, /fails the repo-path guard/, `${label}: ${error.message}`)
          assert.match(error.message, /#362/, `${label}: ${error.message}`)
          assert.doesNotMatch(error.message, /not committed/, `${label}: must not claim the plan is uncommitted: ${error.message}`)
          return true
        },
      )
      assert.equal(cmds.length, 0, `${label}: refusal must precede every exec call, got: ${JSON.stringify(cmds)}`)
      assert.equal(fs.existsSync(path.join(tmp, dbName)), false, `${label}: refusal must precede the orchestrator start — no store dir may exist`)
    }
    fs.rmSync(path.join(repoDir, unsafeRel))
    fs.rmSync(outside)
  }
```

- [ ] **Step 2: Run it to see it fail.**

Run: `node fleet/tests/test_drive.mjs`
Expected: FAIL in 13f — the rejection message is `driveOne: plan docs/plan with space.md is in the working tree but not committed at HEAD …` (matches `/not committed/`, does not match `/fails the repo-path guard/`).

- [ ] **Step 3: Give the guard miss its own refusal.** In `fleet/drive.mjs`, replace the block from `let committedText = null` through the closing `}` of the `if (isSafeBranchName(baseRef) && isSafeRepoPath(planRel)) { … }` block (the comment above it included) with:

```js
  let committedText = null
  // Both halves are interpolated into a shell: the ref passes the guard
  // provisionRun applies to it, the path the receipt-pointer guard (same
  // character class, no `..` segment — a path that escapes the checkout can
  // be at no ref). #362: a path that fails its guard is refused AS a path
  // problem, here, before any exec call — not read as "absent at baseRef"
  // and then reported as an uncommitted plan (run-20's critic: misleading,
  // and non-overridable). The ref keeps its guard-miss reading of "absent":
  // the stamp cross-check below skips on it with a narrating errors line.
  if (!isSafeRepoPath(planRel)) {
    throw new Error(
      `driveOne: plan path ${JSON.stringify(planRel)} (from ${planPath}) fails the repo-path guard — ` +
        `[A-Za-z0-9._/-] only, no leading '-', no '..' segment, and inside ${repoDir}; the path is ` +
        `interpolated into 'git show ${baseRef}:<path>' and pushed to the sandbox as-is. Move or rename ` +
        `the plan (#362)`,
    )
  }
  if (isSafeBranchName(baseRef)) {
    try {
      const shown = await exec(`git -C ${repoDir} show ${baseRef}:${planRel}`)
      if (shown?.code === 0 && typeof shown.stdout === 'string') committedText = shown.stdout
    } catch {
      committedText = null
    }
  }
```

- [ ] **Step 4: Run it to see 13f pass.**

Run: `node fleet/tests/test_drive.mjs`
Expected: `ALL TESTS PASSED`. Every pre-existing scenario still passes because every plan path they drive (`driveDefaults.planPath`, `docs/committed-*.md`, `docs/unfit-plan.md`) is guard-safe.

- [ ] **Step 5: Pin the `check skipped` narration (#362-3).** Append to `fleet/tests/test_drive.mjs` immediately after the 13f block from Step 1 (still before the final `console.log('ALL TESTS PASSED')`). A throwing `provision` is CAUGHT by `driveOne` (recorded as `drive: <message>` in `detail.errors`, the drive resolves with `o1: false`), which is what makes this cheap: the orchestrator starts and tears down, nothing is provisioned.

```js
  // -- 13g. #362-3: a plan absent from BOTH baseRef and the working tree skips
  //        the fitness check with exactly this narration — the branch every
  //        pre-#337 scenario reaches implicitly via driveDefaults.planPath,
  //        pinned by its text for the first time.
  {
    const absentRel = 'docs/superpowers/plans/example.md'
    assert.equal(driveDefaults.planPath, absentRel, 'precondition: this IS the default every other scenario drives')
    assert.equal(fs.existsSync(path.join(repoDir, absentRel)), false, 'precondition: absent from the working tree')
    assert.notEqual((await sh(`git cat-file -e HEAD:${absentRel}`, repoDir)).code, 0, 'precondition: absent at HEAD')
    const lines = []
    const { read, detail } = await driveOne({
      ...driveDefaults,
      dbDir: path.join(tmp, 'db-362g'),
      exec: makeExec(() => {}),
      runId: 'run-drive-362-skip',
      progressLog: (line) => lines.push(line),
      // Stop the drive right after the preflight — the narration is what is
      // under test, not a run.
      provision: async () => {
        throw new Error('sentinel-362-skip')
      },
    })
    assert.equal(read.o1, false)
    assert.ok(
      detail.errors.some((e) => e === 'drive: sentinel-362-skip'),
      `the aborted provision is on the record, got: ${JSON.stringify(detail.errors)}`,
    )
    const expected = `headless-fitness: plan absent at HEAD:${absentRel} and unreadable at ${path.join(repoDir, absentRel)} — check skipped`
    assert.ok(
      lines.includes(expected),
      `expected the skip narration verbatim, got: ${JSON.stringify(lines.filter((l) => /headless/.test(l)))}`,
    )
    assert.ok(
      !detail.errors.some((e) => /headless|#337/.test(e)),
      `a skipped check is narration only, never an errors line, got: ${JSON.stringify(detail.errors)}`,
    )
  }
```

Run: `node fleet/tests/test_drive.mjs`
Expected: `ALL TESTS PASSED` — the narration text already exists in `driveOne`; this step pins it (a later rewording fails here, by design).

- [ ] **Step 6: Clean up the #337 fixture residue in `test_drive.mjs` (#362-5).** In scenario 13d, directly after the existing line `fs.rmSync(path.join(repoDir, fitRel))` (the last statement of the block, under the comment `// Leave the fixture as found …`), insert — modifying no existing line:

```js
    // #362-5: and the side branches + the `docs/` dir the 13-series minted —
    // a later scenario enumerating `refs/heads/*` or asserting a clean tree
    // must not be order-dependent on these blocks. (13e–13g mint their own
    // state and clean it up themselves; they never use plan-fit/plan-unfit.)
    assert.equal((await sh('git branch -D plan-fit plan-unfit', repoDir)).code, 0, 'the 13-series side branches are deleted')
    fs.rmSync(path.join(repoDir, 'docs'), { recursive: true, force: true })
    assert.equal(fs.existsSync(path.join(repoDir, 'docs')), false, 'the 13-series leaves no docs/ dir in repoDir')
    assert.equal((await sh('git branch --list "plan-*"', repoDir)).stdout.trim(), '', 'the 13-series leaves no plan-* branch')
```

- [ ] **Step 7: Clean up the residue in `test_drive_lifecycle.mjs` (#362-5).** Directly after the closing `}` of scenario N4 (the block whose `runId` is `'run-drive-unfit-ok'`, which ends with the `headless-fitness: proceeding on operator override` assertion) and before the `// -- 12. shim-main's pure helpers` comment, insert:

```js
  // #362-5: leave the fixture as N3 found it — the side branch and the
  // working-tree copy it minted are gone before the next scenario, so nothing
  // downstream is order-dependent on the N3/N4 pair.
  fs.rmSync(path.join(repoDir, 'docs'), { recursive: true, force: true })
  assert.equal((await sh('git branch -D unfit-plan', repoDir)).code, 0, 'the N3 side branch is deleted')
  assert.equal(fs.existsSync(path.join(repoDir, unfitPlan)), false, 'the N3 working-tree copy is gone')
  assert.equal((await sh('git branch --list unfit-plan', repoDir)).stdout.trim(), '', 'no unfit-plan branch remains')
```

- [ ] **Step 8: Run both drive specs, time them, then the whole fleet suite.**

Run: `time node fleet/tests/test_drive.mjs && time node fleet/tests/test_drive_lifecycle.mjs`
Expected: both print `ALL TESTS PASSED`, each under 120 s (`test_drive.mjs` target ≤ 65 s on the 60 s baseline).

Run: `python3 -m pytest tests/test_fleet_suite.py -q`
Expected: green.

- [ ] **Step 9: Commit.**

```bash
git add fleet/drive.mjs fleet/tests/test_drive.mjs fleet/tests/test_drive_lifecycle.mjs
git commit -m "fleet: honest guard-miss refusal on the #337 preflight (#362-2), pin 'check skipped' (#362-3), clean #337 fixture residue (#362-5)"
```

---

## Execution handoff

2 implementation tasks, widest wave 2, low risk (fleet test/diagnostic surface; no auth, payments, migrations, or public API) → by the ultraplan rubric (T≤2) **Inline (recommended)**. This plan was nevertheless authored as the validation payload for a fleet run on a freshly cut engine — the operator's designation overrides the rubric, and both tasks are headless-fit (every task has a `Test:` entry; no manual-judgment verification).

1. **Ultrapowers** — `/ultrapowers docs/superpowers/plans/2026-08-28-fleet-run-20-residuals.md`: one wave of two tasks, worktree isolation, per-task review, one pre-merge gate; `fleet/tests/test_drive.mjs` is declared `Commutes:` by both so the fold unions the additive edits, and the two disjoint `fleet/drive.mjs` hunks merge as ordinary non-overlapping changes.
2. **Subagent-Driven** — superpowers:subagent-driven-development, sequential, review between tasks.
3. **Inline** — superpowers:executing-plans, continuous inline execution.

## Operator smoke

No observable surface — suite is the whole story. (The only human-visible change is the wording of a `driveOne` refusal on an unsafe plan path, which 13f pins verbatim; a live `drive-one` needs an exe.dev token and is not a smoke probe.)
