# Fleet vmName Entry Guard (#298) Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `driveOne` refuses an unsafe `runId` loudly at entry — before any command is issued — closing the asymmetry where `provisionRun` and `destroySandbox` interpolated the derived `fleet-<runId>` vmName into ssh/git command strings unguarded (#298, from PR #297's final review).

**Architecture:** One guard at the single choke point. `driveOne` derives `vmName = sandboxIdFor(runId)` and validates it with the existing `isSafeVmName` as its first act; an unsafe value throws before the orchestrator starts, before any report path is derived, and before a single `exec` call. Every downstream interpolation site (clone, probe, deliveries, push, tunnel, shim start, destroy, captures, fetch) is covered by construction. The existing defense-in-depth guard inside `pullLogsOnce` stays — it protects against a `vmName` that mutates mid-run, not just a bad input.

**Tech Stack:** Node ESM (`fleet/*.mjs`); sims in `fleet/tests/test_drive.mjs` (auto-discovered by `tests/test_fleet_suite.py`, 120 s cap, `ALL TESTS PASSED` sentinel).

**Spec:** none — issue #298 is the spec (a guard hoist; no new behavior beyond refusal).

**Acceptance:** suite — the committed fleet sims plus the full pytest suite are the verification.

**Verification note (deferred, external):** the live exe.dev command surfaces (`ssh exe.dev "cp …"`, `ssh exe.dev "rm …"`) cannot be exercised against a hostile name in-suite — every sim drives a stubbed `exec` — so "the lobby actually never receives an unsafe name" rests on this entry guard plus reading the emitted command strings, and confirming the real lobby's behavior is external to any sandbox.

## Global Constraints

- Only `fleet/drive.mjs` and `fleet/tests/test_drive.mjs` change. No new npm dependencies.
- `fleet/tests/test_drive.mjs` exits 0 printing `ALL TESTS PASSED` within 120 s; ephemeral ports (`port: 0`) and unique temp paths only; the file currently runs ~65 s — the changes here must not add meaningful wall time (the rewritten scenario gets FASTER: it no longer drives a full run).
- The guard must throw BEFORE any `exec` call and before `startOrchestrator` — zero side effects on refusal.
- Existing behavior for safe runIds is byte-identical: no changed command strings, no changed read/detail fields.

---

### Task 1: Entry guard + scenario rewrite

**Type:** implementation
**Depends-on:** none
**Review:** adversarial

**Files:**
- Modify: `fleet/drive.mjs`
- Modify: `fleet/tests/test_drive.mjs`

**Interfaces:**
- Consumes: `sandboxIdFor(runId)` (fleet/shim-main.mjs, already imported by drive.mjs), `isSafeVmName(value)` (exported from fleet/drive.mjs itself).
- Produces: `driveOne` throws `Error(/unsafe runId/)` on entry for any `runId` whose derived `fleet-<runId>` fails `isSafeVmName`; signature and green-path behavior otherwise unchanged.

- [ ] **Step 1: Rewrite the unsafe-vm-name scenario (the failing test first).** In `fleet/tests/test_drive.mjs`, find scenario 18 (comment header `-- 18. an unsafe vm name is refused BEFORE the tar pull`). Replace the whole scenario block with:

```js
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
```

- [ ] **Step 2: Run to verify it fails** — `node fleet/tests/test_drive.mjs` from the repo root. Expected: the new scenario fails (current code drives the run and issues commands; no throw).

- [ ] **Step 3: Implement the guard.** In `fleet/drive.mjs`, inside `driveOne`, insert as the FIRST statements of the function body (before `resolvedEvidenceDir` is computed):

```js
  // #298: `runId` becomes `fleet-<runId>` and is interpolated into every
  // sandbox-bound ssh/git command string downstream (clone, deliveries,
  // tunnel, shim start, rm, captures, fetch). Validate ONCE at the single
  // choke point, before the orchestrator starts and before any exec call —
  // an unsafe value is an operator input error, refused loudly, never a run
  // outcome. `pullLogsOnce` keeps its own guard as defense in depth.
  const entryVmName = sandboxIdFor(runId)
  if (!isSafeVmName(entryVmName)) {
    throw new Error(
      `driveOne: unsafe runId ${JSON.stringify(runId)} — derived vm name ${JSON.stringify(entryVmName)} ` +
        `fails isSafeVmName; refusing before any command`,
    )
  }
```

Leave every downstream line unchanged (including `vmName = sandboxIdFor(runId)` at provision time and the `pullLogsOnce` guard).

- [ ] **Step 4: Run to verify green** — `node fleet/tests/test_drive.mjs` prints `ALL TESTS PASSED`; then `python3 -m pytest tests/test_fleet_suite.py -q` green.

- [ ] **Step 5: Commit** — `git add fleet/drive.mjs fleet/tests/test_drive.mjs && git commit -m "fix(fleet): refuse an unsafe runId at driveOne entry — one guard covers every vmName interpolation (#298)"`

---

## Operator smoke

- do: from the repo root, `node --input-type=module -e "import { driveOne } from './fleet/drive.mjs'; try { await driveOne({ planPath: 'x.md', golden: 'g', port: 0, dbDir: '/tmp/nope', repoDir: '.', exec: async () => ({ code: 0, stdout: '' }), runId: 'run 1' }) } catch (e) { console.log(e.message) }"`
  see: a one-line `driveOne: unsafe runId "run 1" …` refusal, instantly — no hang, no `/tmp/nope` created
- do: `ls /tmp/nope`
  see: `No such file or directory` — the refusal had zero side effects
