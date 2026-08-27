# Fleet Shim Scoping & Spend Sentinel Implementation Plan (#190 shim items, #209 interim)

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the shim-side #190 hardening residuals — stale gate-receipt scoping, the newest-wins discovery pin, the untested default-`invokeRun` join — and land #209's defensive interim spend-source sentinel.

**Architecture:** All changes live in `fleet/shim-main.mjs` and its tests. Discovery of the engine's run artifacts becomes scoped to directories the run itself created (a pre-run snapshot excludes leftovers), so a stale gitignored receipt on a dirty golden image can never green a never-gated run. The spend reader grows a source-shape probe so a transcript-layout drift is flagged loudly instead of silently undercounting.

**Tech Stack:** Node ESM, `node:assert/strict` tests under `fleet/tests/`, joined to CI via `tests/test_fleet_suite.py`.

**Spec:** Issues #190 (items: stale-receipt scoping, newest-wins assertion, invokeRun join) and #209 (the "defensive interim" direction — the engine-emits-its-own-total half is engine-lane and explicitly out of scope here).

**Acceptance:** suite — the committed fleet `.mjs` suite plus per-task review; every claim is pinned by an in-process test.

## Global Constraints

- Lane: `fleet/**` only. No engine surfaces, no frozen periphery, no `anthropic` SDK, no `ANTHROPIC_API_KEY`.
- Every `fleet/tests/*.mjs` must exit 0 within 120 s and print `ALL TESTS PASSED`.
- The §W1d gate-read object (five keys) and the shim outcome shape (`{status, delivered}`) are pinned by existing full-equality tests — do not add or rename keys on either.
- Discovery functions stay pure functions of what is on disk (sorted by name, never mtime).

---

### Task 1: Scope artifact discovery to the run's own directories, pin newest-wins

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `fleet/shim-main.mjs`
- Test: `fleet/tests/test_shim_main_gate.mjs`

**Interfaces:**
- Consumes: existing `runArtifactDirs(repoDir, artifactDir)`, `findReceiptFiles`, `findGateReceiptFile`, `findRunReportFile`, `applyRunReceipts`, `invokeEngineRun`, `main`.
- Produces: each discovery function gains an optional trailing `{ excludeDirs }` option (a `Set<string>` of run-directory NAMES to ignore): `runArtifactDirs(repoDir, artifactDir, { excludeDirs })`, `findReceiptFiles(repoDir, artifactDir, { excludeDirs })`, `findGateReceiptFile(repoDir, artifactDir, { excludeDirs })`, `findRunReportFile(repoDir, artifactDir, { excludeDirs })`; `invokeEngineRun` and `applyRunReceipts` gain an optional `excludeDirs` in their options and thread it through; `main()` snapshots `runArtifactDirs(repoDir)` into a `Set` BEFORE `runShim` and passes it to the default `invokeRun` binding and to `applyRunReceipts`.

#190: `findGateReceiptFile` is not scoped to this run's directory — a stale gitignored receipt in a dirty golden image could green a never-gated run. The run's own directories are exactly the ones that did not exist before the engine launched, so the snapshot is the scope. Also #190: the report side pins newest-wins discovery; the receipt side does not.

- [ ] **Step 1: Write the failing tests** — append to `fleet/tests/test_shim_main_gate.mjs` (it already builds tmp run-dir fixtures; follow its existing helpers):

```js
// --- #190: discovery scoping + newest-wins ---------------------------------
{
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-scope-'))
  const dir = (name) => path.join(repo, '.claude/ultrapowers', name)
  const receipt = (name, verdict) => {
    fs.mkdirSync(dir(name), { recursive: true })
    fs.writeFileSync(path.join(dir(name), 'gate-receipt.json'), JSON.stringify({ verdict, stamp: name }))
  }
  receipt('run-20260101000000', 'PASS')   // the stale pre-run leftover
  receipt('run-20260901000000', 'PASS')   // the run's own
  receipt('run-20260902000000', 'PASS')   // an even newer one

  // newest-wins: the LAST run dir by name sort is the one discovered
  assert.equal(
    findGateReceiptFile(repo),
    path.join(repo, '.claude/ultrapowers/run-20260902000000/gate-receipt.json'),
  )

  // excludeDirs scoping: pre-run dirs are invisible to every discovery reader
  const pre = new Set(['run-20260101000000', 'run-20260901000000', 'run-20260902000000'])
  assert.equal(findGateReceiptFile(repo, undefined, { excludeDirs: pre }), '')
  assert.deepEqual(findReceiptFiles(repo, undefined, { excludeDirs: pre }), [])
  assert.deepEqual(runArtifactDirs(repo, undefined, { excludeDirs: pre }), [])
  assert.equal(findRunReportFile(repo, undefined, { excludeDirs: pre }), '')

  const preOnly = new Set(['run-20260101000000'])
  assert.deepEqual(runArtifactDirs(repo, undefined, { excludeDirs: preOnly }), [
    'run-20260901000000',
    'run-20260902000000',
  ])
  assert.equal(
    findGateReceiptFile(repo, undefined, { excludeDirs: preOnly }),
    path.join(repo, '.claude/ultrapowers/run-20260902000000/gate-receipt.json'),
  )
  fs.rmSync(repo, { recursive: true, force: true })
  ok('discovery scoping excludes pre-run dirs; newest-wins pinned (#190)')
}
```

Adjust the import line at the top of the test file to include `runArtifactDirs`, `findReceiptFiles`, `findRunReportFile` (and `os` if absent). Use the file's existing default `RUN_ARTIFACT_DIR` by passing `undefined` for `artifactDir` exactly as above.

- [ ] **Step 2: Run to fail** — `node fleet/tests/test_shim_main_gate.mjs` fails on the new options.

- [ ] **Step 3: Implement.** In `fleet/shim-main.mjs`: add the `{ excludeDirs }` option to `runArtifactDirs` (filter `entry.name` against the set after the existing filter) and thread it through `findReceiptFiles` / `findGateReceiptFile` / `findRunReportFile` (each passes it down). Add `excludeDirs` to `invokeEngineRun`'s options and use it in its `findGateReceiptFile(findGateReceiptFile(repoDir))` resolution; add it to `applyRunReceipts`' options and use it in its `findReceiptFiles(repoDir)` call. In `main()`, immediately before the `runShim` call: `const preRunDirs = new Set(runArtifactDirs(repoDir))`, pass `excludeDirs: preRunDirs` into the default `invokeRun` binding's `invokeEngineRun` call and into the `applyRunReceipts` call. Injected `invokeRun` overrides are unaffected.

- [ ] **Step 4: Run green** — `node fleet/tests/test_shim_main_gate.mjs` then the neighbors: `node fleet/tests/test_shim_main_publish.mjs && node fleet/tests/test_shim_main_tokens.mjs && node fleet/tests/test_shim_transport.mjs && node fleet/tests/test_drive.mjs` all `ALL TESTS PASSED` (drive scenario 1 exercises production `main()` against a sandbox repo whose run dirs are all pre-run fixtures committed to the tree — if it reds, the fixture's receipt dirs exist before `main()` runs, which is exactly the stale case: the fixture stub writes receipts via `applyReceipt` directly, so verify which path reds before changing anything, and prefer adjusting the FIXTURE to mint its run dir post-launch over weakening the scoping).

- [ ] **Step 5: Commit** `git add fleet/shim-main.mjs fleet/tests/test_shim_main_gate.mjs && git commit -m "fleet: scope artifact discovery to the run's own dirs; pin newest-wins (#190)"`

### Task 2: Pin the default `invokeRun` binding — the untested join

**Type:** implementation
**Depends-on:** none

**Files:**
- Test: `fleet/tests/test_shim_main_publish.mjs`

**Interfaces:**
- Consumes: `main()` (from `fleet/shim-main.mjs`), the `runMain`-style live-orchestrator harness already in `fleet/tests/test_shim_main_publish.mjs` (from the run-15 slate).
- Produces: nothing — test-only.

#190: `main()`'s default `invokeRun` binding — the sole join between two tested halves (`main` and `invokeEngineRun`) — has no covering test. Pin it WITHOUT spawning the engine: `invokeEngineRun` refuses before any spawn when the `fleet-base` checkout fails, so an exec seam that fails `git checkout` proves the join threads `repoDir`/`planPath`/`exec` and that its failure parks the run fail-closed.

- [ ] **Step 1: Write the failing scenario** — append to `fleet/tests/test_shim_main_publish.mjs`, reusing its orchestrator harness (extend `runMain` with an optional `omitInvokeRun` + `execOverride` + `planPath` rather than duplicating it — when `omitInvokeRun` is true, do not pass `invokeRun` to `shimMain`):

```js
// --- default invokeRun binding: the join parks fail-closed (#190) -----------
{
  const cmds = []
  const outcome = await runMain({
    runId: 'run-join-1',
    planPath: 'docs/some-plan.md',
    omitInvokeRun: true,
    execOverride: async (cmd) => {
      cmds.push(cmd)
      return { code: 1, stdout: '' }
    },
  })
  // checkout of fleet-base failed => invokeEngineRun refuses before any spawn
  // => runShim parks => status 'failed' (the shim's non-green return shape).
  assert.equal(outcome.status, 'failed')
  assert.ok(
    cmds.some((c) => /git -C \S+ checkout -q fleet-base/.test(c)),
    `the default binding must thread repoDir+exec into invokeEngineRun, got: ${JSON.stringify(cmds)}`,
  )
  ok('default invokeRun binding threads the seams and parks fail-closed')
}
```

`planPath` must reach the assignment: when `runMain` writes `fleet-run.json`, include `planPath` in the payload for this scenario (that is how `main()` learns it).

- [ ] **Step 2: Run to fail, adjust harness, run green** — `node fleet/tests/test_shim_main_publish.mjs` → `ALL TESTS PASSED`. The delivered flag in this scenario is whatever the live aux flush yields — assert only `status`, not full equality, so this pin does not couple to delivery timing.

- [ ] **Step 3: Commit** `git add fleet/tests/test_shim_main_publish.mjs && git commit -m "fleet: pin main()'s default invokeRun binding — parks fail-closed on a dead checkout (#190)"`

### Task 3: Spend-source sentinel — flag transcript-shape drift instead of silently undercounting

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `fleet/shim-main.mjs`
- Test: `fleet/tests/test_shim_main_tokens.mjs`

**Interfaces:**
- Consumes: existing `readSessionTokens(sessionId, { home })` and its transcript-walking internals.
- Produces: `readSessionTokenSources(sessionId, { home }): { total: number|null, mainFound: boolean, subagentFiles: number }` exported from `fleet/shim-main.mjs`; `readSessionTokens` delegates to it (returns `.total`, behavior unchanged); `main()` writes a `spendSentinel` cell on the runs row and logs one warning line when the shape is suspicious.

#209: `readSessionTokens` couples to Claude Code's transcript format on two axes (per-message shape, on-disk layout); a drift reads FEWER tokens and never errors — a silent undercount under a spend hard-cap. The interim defense: report the SHAPE of what was read, and flag the two suspicious cases run-7's data says should not happen on a real engine run — a total with no main transcript, or a completed run with zero subagent transcript files (subagents are ~55% of real spend).

- [ ] **Step 1: Write the failing tests** — append to `fleet/tests/test_shim_main_tokens.mjs` (its fixtures/helpers `writeTranscript`, `home`, `proj`, `RUN` are already in scope; add a fresh session id per case):

```js
// --- #209: source-shape probe ------------------------------------------------
import { readSessionTokenSources } from '../shim-main.mjs'  // move to the top import line

const S1 = '22222222-2222-4222-8222-222222222222'
assert.deepEqual(readSessionTokenSources(S1, { home }), { total: null, mainFound: false, subagentFiles: 0 })
ok('sources: nothing on disk → total null (observational distinction kept)')

writeTranscript(path.join(proj, `${S1}.jsonl`), [100])
assert.deepEqual(readSessionTokenSources(S1, { home }), { total: 100, mainFound: true, subagentFiles: 0 })
ok('sources: main only → mainFound true, zero subagent files (the suspicious shape)')

const wf1 = path.join(proj, S1, 'subagents', 'workflows', 'wf_x-1')
writeTranscript(path.join(wf1, 'agent-b1.jsonl'), [50, 25])
assert.deepEqual(readSessionTokenSources(S1, { home }), { total: 175, mainFound: true, subagentFiles: 1 })
ok('sources: subagent files counted')

// readSessionTokens is unchanged: same totals as the sources probe
assert.equal(readSessionTokens(S1, { home }), 175)
ok('readSessionTokens delegates — no behavior change')
```

- [ ] **Step 2: Run to fail** — `node fleet/tests/test_shim_main_tokens.mjs`.

- [ ] **Step 3: Implement.** Refactor the body of `readSessionTokens` into `readSessionTokenSources` returning the triple (`mainFound` = at least one `<sessionId>.jsonl` existed; `subagentFiles` = count of `agent-*.jsonl` files summed; `total` keeps the exact null-vs-number semantics). `readSessionTokens` becomes `(sessionId, opts) => readSessionTokenSources(sessionId, opts).total`.

- [ ] **Step 4: Wire the sentinel into `main()`.** After `runShim` returns (in the publish block, beside `applyReportedTokens`): compute `const sources = readTokensSources()` where the seam mirrors `readTokens` (add an injectable `readTokensSources` option defaulting to `() => readSessionTokenSources(sessionId)`; when a test injects `readTokens` without `readTokensSources`, skip the sentinel). When `sources.total !== null && (!sources.mainFound || sources.subagentFiles === 0)`: build `const warning = 'spend-source sentinel: suspicious transcript shape — mainFound=' + sources.mainFound + ' subagentFiles=' + sources.subagentFiles + ' (#209: possible silent undercount; verify the transcript layout)'`, then `console.error('fleet: ' + warning)` and `store.setCell('runs', runId, 'spendSentinel', warning)`. No sentinel cell is written when the shape is healthy.

- [ ] **Step 5: Add the main()-level pin** — in the same test file if it can reach `main()` cheaply, otherwise append to `fleet/tests/test_shim_main_publish.mjs` (its live-orchestrator harness): run `main()` with `readTokens: () => 4200` and `readTokensSources: () => ({ total: 4200, mainFound: true, subagentFiles: 0 })`, then assert the orchestrator store reads `spendSentinel` matching `/spend-source sentinel/` on the runs row; a second run with `subagentFiles: 3` leaves the cell unset.

- [ ] **Step 6: Run green** — `node fleet/tests/test_shim_main_tokens.mjs && node fleet/tests/test_shim_main_publish.mjs && node fleet/tests/test_shim_transport.mjs` all `ALL TESTS PASSED`.

- [ ] **Step 7: Commit** `git add fleet/shim-main.mjs fleet/tests/test_shim_main_tokens.mjs fleet/tests/test_shim_main_publish.mjs && git commit -m "fleet: spend-source sentinel flags transcript-shape drift (#209 interim)"`

---

## Operator smoke

- do: `node fleet/tests/test_shim_main_gate.mjs && node fleet/tests/test_shim_main_tokens.mjs && node fleet/tests/test_shim_main_publish.mjs`
  see: three `ALL TESTS PASSED` lines.
- do: on the next real fleet run's evidence, `tar -xzf sandbox-logs.tgz -O shim.log | grep sentinel`
  see: nothing on a healthy run; a `spend-source sentinel` line only if the transcript layout drifted.
