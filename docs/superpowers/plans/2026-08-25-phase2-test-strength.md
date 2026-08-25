# Phase-2 Test-Strength Follow-ups Implementation Plan (#186)

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the mutation-verified test gaps the Phase-2 adversarial reviews named: the `autoResolved` accumulator is discriminated from last-value-wins, the four `compositionRows` negative paths are pinned, the duplicated merged-wave-task join in `waves.js` is hoisted into one helper, and the compiler tests re-pin the write-set behaviors the tier-test deletion orphaned plus strengthen two weak assertions.

**Architecture:** Two independent surfaces. (T1) Engine — `tests/frontier_merge.mjs` gains scenario 11e (fold autoResolved=1 + resolve autoResolved=2 → frontier 3) and four composition-row negatives; `waves.js` gets one non-prompt code change: `mergedWaveTasks(waveIdx, merged)` replaces the join written twice at `contendedMerge` and the `compositionRows` call site. No re-bake (no prompt text changes) — but `waves.js` changed, so the suite-gate runs the `.mjs` sims and they must print their sentinel. (T2) Compiler — tests only in `tests/test_compile_plan.py`: `Config.YAML` stays in `writes`, the `:line-range` suffix is stripped from the write set, a behavioral suppression pin (Consumes/Produces pair with a write-after-create overlap → promoted `interface` edge, no undeclared-dependency finding, in both overlap modes — the docket's `--overlap serialize` premise was falsified by probe: write-after-write is recorded after the interface tier and cannot suppress), and the catch-all did-you-mean assertion tightened to the exact string the compiler emits. `compile_plan.py` logic is not touched (FROZEN diagnostic vocabulary). Every new pin is mutation-verified before commit.

**Tech Stack:** Node (`tests/frontier_merge.mjs` sim harness — `runWorkflow`, `makeAgent`, `argsFor`, `commutesWave`, `cleanFoldReply`, `conflictFoldReply`, `openEntry`, `eq`, `assert`), JavaScript in `waves.js`, Python 3 / pytest for the compiler pins (`compile_plan_text`, `compile_plan_serialize`, `compile_raw_text`, `PLAN_HEADER` helpers in `tests/test_compile_plan.py`).

**Spec:** GitHub issue #186 plus its docket entry `docs/superpowers/docket.md` (`### #186`). Sequenced after #222/#223/#226 on `waves.js` (drain order; this plan's `waves.js` edit is non-prompt code).

**Acceptance:** suite — engine pins are the `.mjs` sim (run by the suite-gate on any `waves.js` change, sentinel-gated) and the compiler pins are pytest; no held-out exam.

## Global Constraints

- The verification periphery is FROZEN: never touch `gate_check.py`, `ultra_gate.py`, `run_lock.sh`, `run_acceptance.sh`, `collect_seal.py`, `seal_hash.py`; `skills/ultrapowers/scripts/compile_plan.py` logic and diagnostic vocabulary are not edited (tests only).
- `waves.js` prompt constants are not edited (no re-bake); `python3 -m pytest tests/test_no_prompt_drift.py tests/test_canary.py` stays green.
- `node tests/frontier_merge.mjs` must exit 0 and print `ALL SCENARIOS PASSED`; the other three sims (`sim_workflow`, `sim_derived_heads`, `wave_ancestry_sim`) must still print their sentinel.
- Every new pin is mutation-verified: apply the named mutation, observe the pin go red, revert, observe green — before committing.
- No Anthropic API calls or SDK anywhere; no new dependencies.
- The full gate is `python3 -m pytest`; every task leaves it green.

---

### Task 1: Engine pins — autoResolved sum, composition negatives, hoisted join

**Type:** implementation
**Depends-on:** none
**Review:** adversarial

**Files:**
- Modify: `skills/ultrapowers/harnesses/waves.js`
- Modify: `tests/frontier_merge.mjs`

**Interfaces:**
- Consumes: nothing from sibling tasks.
- Produces: `mergedWaveTasks(waveIdx, merged)` in `waves.js` — `(Array.isArray(WAVES[waveIdx]) ? WAVES[waveIdx] : []).filter((t) => t && merged.some((r) => r.task === t.id))`; the single join both `contendedMerge` and `mergeWave`'s `compositionRows` call use.

- [ ] **Step 1: Add scenario 11e — autoResolved summed across fold and resolve legs**

In `tests/frontier_merge.mjs`, after `scenarioCommutesArgsOnCommands`, add:

```js
// ── 11e: autoResolved is a SUM, not last-value-wins ─────────────────────────
// 11a/11b each carry the count on ONE leg, so `+=` → `=` in addWall stays green
// there. Here the fold leg reports 1 and the resolve leg 2: frontier must be 3.
async function scenarioAutoResolvedSumsAcrossLegs() {
  const calls = []
  const open = [openEntry(1, 'shared.py', 2)]
  const agent = makeAgent(calls, (label) => {
    if (label === 'merge:wave1:fold') return Object.assign(conflictFoldReply(open, []), { autoResolved: 1 })
    if (label === 'resolve:wave1:1:1') return { status: 'RESOLVED', notes: 'unioned' }
    if (label === 'merge:wave1:apply1:1') {
      return { status: 'FOLDED', complete: true, selfChecks: 'ok', autoResolved: 2,
               open: [], remaining: [] }
    }
    if (label === 'merge:wave1:adopt') return { status: 'MERGED', headSha: 'cand-sum' }
    return undefined
  })
  const r = await runWorkflow({ agent, args: argsFor(commutesWave()), budget: undefined })
  eq(r.waveMerges[0].headSha, 'cand-sum', 'sum: the wave adopted its folded candidate')
  eq(r.frontier[0].autoResolved, 3,
     'sum: autoResolved is 1 (fold) + 2 (resolve) = 3 — a last-value-wins accumulator reads 2')
  console.log('scenario 11e auto-resolved-sums-across-legs: OK')
}
```

- [ ] **Step 2: Add the four composition-row negatives**

After scenario 11d, add:

```js
// ── 11f–11i: composition rows — the four negative paths ─────────────────────
// (f) one writer per path → no row (delete the `ids.length < 2` guard: green today)
// (g) every writer declared → no row (delete the `undeclared.length` guard: green today)
// (h) mixed writes (one task carries `writes`, one does not) → ONE skip note, no row
// (i) partially-merged wave (a writer failed) → the failed writer is excluded, no row
async function scenarioCompositionSingleWriterNoRow() {
  const calls = []
  const agent = makeAgent(calls)
  const waves = [[
    { id: 't1', title: 'one', body: 'b', tier: 'cheap', files: ['a.py'], writes: ['a.py'], commutes: [] },
    { id: 't2', title: 'two', body: 'b', tier: 'cheap', files: ['b.py'], writes: ['b.py'], commutes: [] },
  ]]
  const r = await runWorkflow({ agent, args: argsFor(waves), budget: undefined })
  eq(r.waveMerges[0].status, 'MERGED', 'single-writer: the wave merged')
  assert(!r.judgmentCalls.some((j) => j.startsWith('composition-unpinned:')),
    'single-writer: a path with one writer is never a composition row' +
    ' (got ' + JSON.stringify(r.judgmentCalls) + ')')
  assert(!r.judgmentCalls.some((j) => /composition rows skipped/.test(j)),
    'single-writer: a wave whose tasks all carry writes is never skipped')
  console.log('scenario 11f composition-single-writer-no-row: OK')
}

async function scenarioCompositionAllDeclaredNoRow() {
  const calls = []
  const agent = makeAgent(calls, (label) => {
    if (label === 'merge:wave1:fold') return cleanFoldReply()
    if (label === 'merge:wave1:adopt') return { status: 'MERGED', headSha: 'cand-all' }
    return undefined
  })
  const waves = [[
    { id: 't1', title: 'one', body: 'b', tier: 'cheap', files: ['shared.py'], writes: ['shared.py'], commutes: ['shared.py'] },
    { id: 't2', title: 'two', body: 'b', tier: 'cheap', files: ['shared.py'], writes: ['shared.py'], commutes: ['shared.py'] },
  ]]
  const r = await runWorkflow({ agent, args: argsFor(waves), budget: undefined })
  eq(r.waveMerges[0].headSha, 'cand-all', 'all-declared: the contended wave adopted its candidate')
  assert(!r.judgmentCalls.some((j) => j.startsWith('composition-unpinned:')),
    'all-declared: every writer declared the path — no unpinned composition' +
    ' (got ' + JSON.stringify(r.judgmentCalls) + ')')
  console.log('scenario 11g composition-all-declared-no-row: OK')
}

async function scenarioCompositionMixedWritesSkipNote() {
  const calls = []
  const agent = makeAgent(calls, (label) => {
    if (label === 'merge:wave1:fold') return cleanFoldReply()
    if (label === 'merge:wave1:adopt') return { status: 'MERGED', headSha: 'cand-mixed' }
    return undefined
  })
  const waves = [[
    { id: 't1', title: 'one', body: 'b', tier: 'cheap', files: ['shared.py'], writes: ['shared.py'], commutes: [] },
    { id: 't2', title: 'two', body: 'b', tier: 'cheap', files: ['shared.py'] },   // no writes field
  ]]
  const r = await runWorkflow({ agent, args: argsFor(waves), budget: undefined })
  assert(!r.judgmentCalls.some((j) => j.startsWith('composition-unpinned:')),
    'mixed-writes: no row is guessed when any task lacks writes' +
    ' (got ' + JSON.stringify(r.judgmentCalls) + ')')
  const notes = r.judgmentCalls.filter((j) => /composition rows skipped/.test(j))
  eq(notes, ['wave 1: tasks carry no writes field — composition rows skipped'],
     'mixed-writes: exactly one skip note, naming the wave')
  console.log('scenario 11h composition-mixed-writes-skip-note: OK')
}

async function scenarioCompositionPartiallyMergedExcludesFailedWriter() {
  const calls = []
  const agent = makeAgent(calls, (label) => {
    if (label === 'impl:t2') {
      return { status: 'BLOCKED', summary: 'cannot', branch: 'wt-t2', headSha: 'sha-t2' }
    }
    return undefined
  })
  // both tasks WRITE shared.py and neither declares it — but t2 never merges,
  // so the merged wave has one writer and no composition exists to pin.
  const waves = [[
    { id: 't1', title: 'one', body: 'b', tier: 'cheap', files: ['shared.py'], writes: ['shared.py'], commutes: [] },
    { id: 't2', title: 'two', body: 'b', tier: 'cheap', files: ['shared.py'], writes: ['shared.py'], commutes: [] },
  ]]
  const r = await runWorkflow({ agent, args: argsFor(waves), budget: undefined })
  eq(r.tasks.find((t) => t.task === 't2').status, 'failed', 'partial: t2 failed')
  eq(r.waveMerges[0].status, 'MERGED', 'partial: the wave merged t1 alone')
  assert(!has(calls, 'merge:wave1:fold'), 'partial: one mergeable task is not a contended wave')
  assert(!r.judgmentCalls.some((j) => j.startsWith('composition-unpinned:')),
    'partial: the failed writer is excluded from the row derivation' +
    ' (got ' + JSON.stringify(r.judgmentCalls) + ')')
  assert(!r.judgmentCalls.some((j) => /composition rows skipped/.test(j)),
    'partial: the merged task carries writes — never skipped')
  console.log('scenario 11i composition-partially-merged-excludes-failed-writer: OK')
}
```

Register all five at the bottom, after `await scenarioWritesAbsentSkipsCompositionRows()`:

```js
await scenarioAutoResolvedSumsAcrossLegs()
await scenarioCompositionSingleWriterNoRow()
await scenarioCompositionAllDeclaredNoRow()
await scenarioCompositionMixedWritesSkipNote()
await scenarioCompositionPartiallyMergedExcludesFailedWriter()
```

(`has` and `eq` are the file's existing helpers. If `impl:t2` returning `BLOCKED` routes through a fix round in this engine version, the sim's `makeAgent` default answers `fix:` labels with `DONE` — so return `BLOCKED` from `fix:t2` as well in that scenario's handler; the task must end `failed`.)

- [ ] **Step 3: Run the sim — expect the new scenarios green except where a mutation would bite**

Run: `node tests/frontier_merge.mjs`
Expected: exit 0, `ALL SCENARIOS PASSED`. (All five are pins on current behavior; they must pass as written. If 11i fails because `t2`'s failure took a different path, fix the scenario's handler per the note above — never the engine.)

- [ ] **Step 4: Mutation-verify each pin, then revert**

For each, apply the mutation in `waves.js`, run `node tests/frontier_merge.mjs`, confirm the named scenario fails, revert:

1. `autoResolved += reply.autoResolved` → `autoResolved = reply.autoResolved` — 11e fails (reads 2).
2. delete `if (ids.length < 2) continue` in `compositionRows` — 11f fails (a one-writer row appears).
3. delete `if (undeclared.length)` (push unconditionally) — 11g fails.
4. change `if (withWrites.length !== tasks.length)` to `if (withWrites.length === 0)` — 11h fails (a row is guessed for t1 with t2 skipped silently).
5. change the `compositionRows(...)` call-site filter to pass all of `WAVES[waveIdx]` (drop the `merged.some` filter) — 11i fails.

- [ ] **Step 5: Hoist the join**

In `waves.js`, add above `contendedMerge`:

```js
// The tasks of wave `waveIdx` that actually merged — one join, used by the
// contended-merge routing and the composition rows alike (#186: it was
// written twice, and two copies is where one drifts).
const mergedWaveTasks = (waveIdx, merged) =>
  (Array.isArray(WAVES[waveIdx]) ? WAVES[waveIdx] : [])
    .filter((t) => t && merged.some((r) => r.task === t.id))
```

Replace `const waveTasks = (Array.isArray(WAVES[waveIdx]) ? WAVES[waveIdx] : []).filter((t) => t && merged.some((r) => r.task === t.id))` in `contendedMerge` with `const waveTasks = mergedWaveTasks(waveIdx, merged)`, and the `compositionRows(waveIdx + 1, (Array.isArray(WAVES[waveIdx]) ? WAVES[waveIdx] : []).filter(…))` call in `mergeWave` with `compositionRows(waveIdx + 1, mergedWaveTasks(waveIdx, merged))`. Confirm the old expression no longer appears: `grep -c "merged.some((r) => r.task === t.id)" skills/ultrapowers/harnesses/waves.js` → `1`.

- [ ] **Step 6: Run every sim and the drift/canary pins**

Run: `node tests/frontier_merge.mjs && node tests/sim_workflow.mjs && node tests/sim_derived_heads.mjs && node tests/wave_ancestry_sim.mjs`
Expected: each exits 0 with its sentinel.
Run: `python3 -m pytest tests/test_no_prompt_drift.py tests/test_canary.py -q` — Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add skills/ultrapowers/harnesses/waves.js tests/frontier_merge.mjs
git commit -m "test(engine): autoResolved sum pin, composition-row negatives, hoist mergedWaveTasks (#186)"
```

---

### Task 2: Compiler test re-pins (tests only)

**Type:** implementation
**Depends-on:** none

**Files:**
- Test: `tests/test_compile_plan.py`

**Interfaces:**
- Consumes: nothing from sibling tasks.
- Produces: nothing code-level.

- [ ] **Step 1: Add the write-set and suppression pins**

Append to `tests/test_compile_plan.py`:

```python
def test_uppercase_extension_path_stays_in_write_set():
    # Orphaned by the tier-test deletion (was a Fable-review HIGH regression
    # pin): `Config.YAML` is a file, not a Mixed.Case attribute — two tasks
    # modifying it overlap, and both carry it in `writes`.
    plan = PLAN_HEADER + """### Task 1: A
**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `config/Config.YAML`

- [ ] **Step 1: do it**

### Task 2: B
**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `config/Config.YAML`

- [ ] **Step 1: do it**
"""
    out = compile_plan_text(plan)
    assert [t["writes"] for t in out["tasks"]] == [["config/Config.YAML"], ["config/Config.YAML"]]
    ser = _serialize_text(plan)
    assert [(e["from"], e["to"], e["why"]) for e in ser["dag_edges"]] == [("1", "2", "write-after-write")]


def test_line_range_suffix_is_stripped_from_write_set():
    # `src/existing.py:123-145` and `src/existing.py:200-210` are ONE file:
    # the suffix is stripped, so the write sets match and the pair overlaps.
    plan = PLAN_HEADER + """### Task 1: A
**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `src/existing.py:123-145`

- [ ] **Step 1: do it**

### Task 2: B
**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `src/existing.py:200-210`

- [ ] **Step 1: do it**
"""
    out = compile_plan_text(plan)
    assert [t["writes"] for t in out["tasks"]] == [["src/existing.py"], ["src/existing.py"]]
    assert [e["files"] for w in out["launch_waves"] for e in w] == [["src/existing.py"], ["src/existing.py"]]
    ser = _serialize_text(plan)
    assert [(e["from"], e["to"], e["why"]) for e in ser["dag_edges"]] == [("1", "2", "write-after-write")]


def test_interface_edge_with_file_overlap_suppresses_undeclared_finding():
    # Behavioral twin of the source-grep suppression-set test. The overlap
    # that suppresses is write-after-create (an existence edge recorded
    # BEFORE the interface tier): the pair is already ordered, so the tier
    # promotes the label to `interface` and raises NO undeclared-dependency
    # finding. (The docket imagined `--overlap serialize`'s write-after-write
    # as the suppressor; it cannot be — that tier runs AFTER the interface
    # tier, so a serialize compile of a Modify/Modify pair still raises the
    # finding. Verified by probe at planning; pinned here as it really is.)
    plan = PLAN_HEADER + """### Task 1: A
**Type:** implementation
**Depends-on:** none

**Files:**
- Create: `src/schema.py`

**Interfaces:**
- Produces: `User`

- [ ] **Step 1: do it**

### Task 2: B
**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `src/schema.py`

**Interfaces:**
- Consumes: `User`

- [ ] **Step 1: do it**
"""
    for out in (compile_plan_text(plan), _serialize_text(plan)):
        assert [(e["from"], e["to"], e["why"]) for e in out["dag_edges"]] == [("1", "2", "interface")]
        assert [c["kind"] for c in out["marker_conflicts"]] == ["inference"]
    # the no-overlap twin DOES raise it, in both modes
    twin = plan.replace("- Modify: `src/schema.py`", "- Modify: `src/other.py`")
    for out in (compile_plan_text(twin), _serialize_text(twin)):
        assert [(e["from"], e["to"], e["why"]) for e in out["dag_edges"]] == [("1", "2", "interface")]
        assert sorted(c["kind"] for c in out["marker_conflicts"]) == ["inference", "undeclared-dependency"]
```

Add the small helper next to `compile_plan_text`:

```python
def _serialize_text(plan_md):
    import tempfile, os
    fd, p = tempfile.mkstemp(suffix=".md"); os.close(fd)
    pathlib.Path(p).write_text(plan_md)
    try:
        return compile_plan_serialize(pathlib.Path(p))
    finally:
        pathlib.Path(p).unlink(missing_ok=True)
```

- [ ] **Step 2: Tighten the catch-all did-you-mean assertion**

In `test_catch_all_label_is_a_violation_with_did_you_mean`, replace `assert "unknown Files label" in proc.stderr and "Modify" in proc.stderr` with:

```python
    assert "Task 1: unknown Files label 'catch-all' for `src/` — use Modify" in proc.stderr
```

(`_LABEL_SUGGEST` maps `catch-all` → `Modify`, so this is the exact string the compiler emits; the old bare `"Modify" in proc.stderr` was also satisfied by the generic `Create/Modify/Test` fallback, which is the accidental pass the review named.)

- [ ] **Step 3: Run and mutation-verify**

Run: `python3 -m pytest tests/test_compile_plan.py -q -k "uppercase_extension or line_range or suppresses_undeclared or catch_all"` — Expected: PASS.

Mutation checks (apply in `compile_plan.py`, observe red, revert — the compiler is not edited in the committed result):
1. In `_is_pathlike`, change `if ext == ext.lower() or ext == ext.upper()` to `if ext == ext.lower()` — `test_uppercase_extension_path_stays_in_write_set` fails.
2. Remove `paths = [p.split(":")[0] for p in paths if p]` — `test_line_range_suffix_is_stripped_from_write_set` fails.
3. In the interface tier, change `if not declared and not file_overlap:` to `if not declared:` — the suppression test fails (the overlapping pair now raises the finding).
4. Delete the `"catch-all": "Modify"` entry from `_LABEL_SUGGEST` — the catch-all test fails (the message falls back to `— use Create/Modify/Test`).

- [ ] **Step 4: Commit**

```bash
git add tests/test_compile_plan.py
git commit -m "test(compiler): re-pin Config.YAML + :line-range write sets, serialize suppression behavior, exact catch-all did-you-mean (#186)"
```

---

### Task 3: Suite gate

**Type:** gate
**Depends-on:** 1, 2

**Files:**
- Test: `tests/`

- [ ] **Step 1: Run the full suite and the harness sims**

Run: `python3 -m pytest`
Expected: all green.
Run: `node tests/frontier_merge.mjs && node tests/sim_workflow.mjs && node tests/sim_derived_heads.mjs && node tests/wave_ancestry_sim.mjs`
Expected: each prints its pass sentinel.

---

## Operator smoke

No observable surface — suite is the whole story. (`node tests/frontier_merge.mjs` prints `scenario 11e … OK` through `scenario 11i … OK` before `ALL SCENARIOS PASSED`.)
