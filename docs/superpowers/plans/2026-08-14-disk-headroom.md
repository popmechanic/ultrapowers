# Disk Headroom Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the disk-exhaustion family (#151, 3rd/4th occurrence, sev-2 twice): sweep just-merged worktrees at the wave barrier, and warn/block at preflight when free disk cannot cover the widest wave's footprint.

**Architecture:** Two independent halves with no shared interface. Half 1 is structural: the engine composes a shape-narrowed `SWEEP PATHS` line from each wave's merged results and both the merge and reconcile prompts gain an identity-checked cleanup step (this deliberately reverses commit `bea1875`'s prompt subtraction — the recurrence record buys the reversal — so both pins of that subtraction are replaced, not deleted). Half 2 is the cycle's one budgeted additive guard: a `disk-headroom` preflight stage after plan compile, advisory by default, blocking only below `min(2 GiB, estimate)`.

**Tech Stack:** Node (committed Dynamic Workflow + `.mjs` sim harness), Python 3 (preflight driver + pytest), baked-prompt discipline (edit the `.md` source, re-bake into the harness, keep the anti-drift pin green).

**Spec:** docs/superpowers/specs/2026-08-14-disk-headroom.md

**Acceptance:** suite — committed suite + harness sims + anti-drift pin are the verification (harness JS + bake source change ⇒ sim scenarios printing ALL SCENARIOS PASSED + re-bake per workflow-template.md + test_no_prompt_drift.py green).

## Global Constraints

- The verification periphery stays FROZEN: `skills/ultrapowers/scripts/ultra_gate.py`, `skills/ultrapowers/scripts/gate_check.py`, `skills/ultrapowers/scripts/run_lock.sh`, and `skills/ultrapowers/scripts/run_acceptance.sh` are byte-identical after this plan.
- `skills/ultrapowers/scripts/sweep_worktrees.sh` is NOT modified; `--run` stays rejected mid-run. The Step-5 sweep remains the deterministic backstop and is already idempotent over worktrees removed at a wave barrier (`[ -e "$wt" ] || continue`).
- Branches are NEVER deleted by the wave-barrier sweep step — branches carry the merged commits; only worktrees are removed.
- Only results the wave actually merged may be listed for sweeping. Blocked, parked, failed, and non-merged tasks' worktrees are never listed — evidence-keeping is unchanged.
- Contended-path machinery is untouched: contended adoptions are explicitly best-effort-excluded from the wave-barrier sweep (declared in the spec, not silent) and wait for the Step-5 sweep.
- Worktree paths derive ONLY from self-reported branch names matching `^worktree-wf_.+-[0-9]+$` by prefix-strip; a malformed name contributes nothing, silently.
- Prompts are baked: any prompt change edits the source `.md` AND the baked constant together; `python3 -m pytest tests/test_no_prompt_drift.py` must be green. The drift pin matches each BAKE block against CONTIGUOUS text in the harness, so the cleanup step is written out in full in BOTH prompt constants — never a shared const.
- Harness sims must print the sentinel `ALL SCENARIOS PASSED` on success only (the suite-gate checks exit code AND sentinel).
- The disk-headroom estimate is hardcoded (`widest_wave_width × 1.5 GiB`); NO env knob (deleted at trim review).
- The preflight warn is `ok: true` with a verdict-stating detail (the #97 receipt-honesty rule; warn shape follows the existing `worktree-audit` stage precedent). Block (`ok: false`) only when `free < min(2 GiB, estimate)`.
- No new dependencies; no direct Anthropic API calls in repo code.

---

### Task 1: Wave-barrier worktree sweep (engine + prompts + sims + drift pin)

**Type:** implementation
**Depends-on:** none
**Review:** adversarial

**Files:**
- Modify: `skills/ultrapowers/references/wave-merge.md`
- Modify: `skills/ultrapowers/harnesses/waves.js`
- Modify: `skills/ultrapowers/harnesses/waves.harness.json`
- Test: `tests/sim_workflow.mjs`
- Test: `tests/test_no_prompt_drift.py`

Touch points: in the wave-merge reference — the BAKE:MERGE_PROMPT block (~:91), the BAKE:RECONCILE_PROMPT block (~:236), and the "Worktree and Branch Facts" paragraph (~:57); in the harness — MERGE_PROMPT (:425–438), RECONCILE_PROMPT (:440–453), a new helper after headsSlotsLine (:466), the mergeWave dispatches (:1461–1489), and the manifest version bump; in the sim — the :153 pin is REPLACED plus one new scenario; in the drift test — `test_merge_prompt_does_not_instruct_cleanup` is REPLACED.

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: the dispatch-appended sweep line, exact format `SWEEP PATHS for this wave: <p1>, <p2>.` (comma-joined, trailing period; omitted entirely when no merged branch matches the shape). Nothing downstream consumes it in code — the merge/reconcile agent reads it from its prompt.

Security note for the reviewer (this is why the task is adversarial): the engine never sees the runtime `wf_<runId>` — every path in the sweep line derives from an implementer's **self-reported branch name**, i.e. model-typed input feeding `git worktree remove --force`. The two required defenses are the regex narrowing on the engine side and the `git worktree list --porcelain` per-path identity check on the prompt side. The sweep line is appended OUTSIDE `fillPaths()` (like the existing `branchList`) so model-typed content is never token-substituted.

- [ ] **Step 1: Write the failing sim assertions**

In `tests/sim_workflow.mjs`, replace line 153 — currently:

```js
  assert(!/git worktree remove/.test(mergePrompt), 'happy: merge prompt no longer instructs cleanup (deterministic Step-5 sweep handles it)')
```

with the new-behavior pin (the stub branches `wt-A`/`wt-B`/`wt-C` are malformed under the sweep regex, so this doubles as the malformed-contributes-nothing pin):

```js
  // #151 (reverses bea1875): the merge prompt now CARRIES the wave-barrier
  // cleanup step; the deterministic Step-5 sweep stays the idempotent
  // backstop. The stub branches (wt-A…) are malformed under the sweep
  // regex, so no SWEEP PATHS line may appear — malformed names contribute
  // nothing, silently.
  assert(/git worktree remove --force/.test(mergePrompt), 'happy: merge prompt carries the wave-barrier cleanup step (#151)')
  assert(!/SWEEP PATHS/.test(mergePrompt), 'happy: malformed stub branches derive no sweep paths')
```

Then add the new scenario immediately after `scenarioHappy`'s closing brace (after current line 158):

```js
// ── Scenario: wave-barrier sweep (#151, reverses bea1875) ────────────────────
// The merge AND reconcile dispatches carry the baked cleanup step plus a
// SWEEP PATHS line listing exactly the just-merged tasks' worktree paths,
// derived by regex from self-reported branch names: a malformed branch
// contributes nothing, a non-merged task's path is never listed, a later
// wave never re-lists an earlier wave's paths, and the step itself carries
// the missing-path skip clause (resume tolerance).
async function scenarioWaveBarrierSweep() {
  const prompts = {}
  const agent = async (prompt, opts) => {
    const label = opts.label || ''
    if (label === 'setup') return { branch: 'ultra/integration-sim', headSha: 'int0' }
    if (label.startsWith('impl:') || label.startsWith('fix:')) {
      const id = taskIdFromLabel(label)
      // A and C: well-formed runtime branch names; M: malformed (regex miss);
      // B: well-formed, but its review fails it out of the merge set.
      const branch = id === 'M' ? 'wt-M' : 'worktree-wf_run9-' + { A: 1, B: 2, C: 4 }[id]
      return { status: 'DONE', summary: 's', branch, headSha: 'sha-' + id, commit: 'c-' + id }
    }
    if (label.startsWith('review:')) {
      const id = taskIdFromLabel(label)
      if (id === 'B') return { verdict: 'FIX_REQUIRED', issues: [{ severity: 'blocking', detail: 'never green' }] }
      return { verdict: 'PASS', issues: [] }
    }
    if (label === 'merge:wave1') {
      prompts['merge:wave1'] = prompt
      return { status: 'CONFLICT', detail: 'conflict in a.txt' } // force a reconcile dispatch
    }
    if (label.startsWith('reconcile:wave1')) {
      prompts['reconcile'] = prompt
      return { status: 'MERGED', headSha: 'm1' }
    }
    if (label.startsWith('merge:')) { prompts['merge:wave2'] = prompt; return { status: 'MERGED', headSha: 'm2' } }
    if (label === 'integration') return { command: 'pytest', testsPassed: true, output: 'ok', findings: [] }
    throw new Error('unexpected agent label: ' + label)
  }
  const waves = [
    [{ id: 'A', title: 'a', body: 'do a', tier: 'cheap' },
     { id: 'B', title: 'b', body: 'do b', tier: 'cheap' },
     { id: 'M', title: 'm', body: 'do m', tier: 'cheap' }],
    [{ id: 'C', title: 'c', body: 'do c', tier: 'cheap' }],
  ]
  const r = await runWorkflow({ agent,
    args: { ...LAUNCH_ARGS, waves, integrationBranch: 'ultra/integration-sim', stamp: 's', edges: [] },
    budget: undefined })
  const w1 = prompts['merge:wave1']
  // Exactly the just-merged, well-formed path: B failed out (never merged),
  // M is malformed (contributes nothing, silently). The trailing period pins
  // the list as exactly one entry.
  assert(w1.includes('SWEEP PATHS for this wave: .claude/worktrees/wf_run9-1.'),
    'sweep: wave-1 SWEEP PATHS lists exactly the merged well-formed path')
  assert(!w1.includes('wf_run9-2'), 'sweep: failed task B is never listed')
  assert(!w1.includes('.claude/worktrees/wt-M'), 'sweep: malformed branch contributes no path')
  // The baked step rides BOTH prompts: identity check, forced removal, resume
  // tolerance (missing path = silent skip), branch preservation.
  for (const [name, p] of [['merge', w1], ['reconcile', prompts['reconcile']]]) {
    assert(/git worktree list --porcelain/.test(p), 'sweep: ' + name + ' prompt carries the per-path identity check')
    assert(/git worktree remove --force/.test(p), 'sweep: ' + name + ' prompt carries the removal command')
    assert(/skip it silently/.test(p), 'sweep: ' + name + ' prompt tolerates an already-swept path (resume)')
    assert(/Never delete any branch/.test(p), 'sweep: ' + name + ' prompt forbids branch deletion')
  }
  assert(prompts['reconcile'].includes('SWEEP PATHS for this wave: .claude/worktrees/wf_run9-1.'),
    'sweep: reconcile dispatch carries the same SWEEP PATHS line')
  // Wave 2 lists only ITS OWN merged path — never a prior wave's.
  assert(prompts['merge:wave2'].includes('SWEEP PATHS for this wave: .claude/worktrees/wf_run9-4.'),
    'sweep: wave-2 lists exactly its own merged path')
  assert(!prompts['merge:wave2'].includes('wf_run9-1'), 'sweep: wave-2 never re-lists wave-1 paths')
  assert(r.tasks.find((t) => t.task === 'A').status === 'done', 'sweep: run completes')
  console.log('scenario wave-barrier-sweep: OK')
}
```

Register it in the runner list: immediately after the existing `await scenarioHappy()` line (currently :1976), add:

```js
await scenarioWaveBarrierSweep()
```

- [ ] **Step 2: Run the sim to verify it fails**

Run: `node tests/sim_workflow.mjs`
Expected: FAIL — `SIM ASSERT FAILED: happy: merge prompt carries the wave-barrier cleanup step (#151)` (exit 1, no sentinel printed).

- [ ] **Step 3: Edit the bake source — wave-merge.md prompt blocks**

In `skills/ultrapowers/references/wave-merge.md`, append the cleanup step to BOTH BAKE blocks. In the `<!-- BAKE:MERGE_PROMPT -->` block (~:91) and the `<!-- BAKE:RECONCILE_PROMPT -->` block (~:236), each of which currently ends:

```
… Shell redirection only — never type a sha by hand.
```

append (same text in both blocks, inside the markers, before `<!-- /BAKE -->`):

```
After the heads are recorded and only if you are reporting MERGED, sweep this wave's consumed worktrees: a SWEEP PATHS line appended to this dispatch names the just-merged worktree paths, derived by the engine from the merged branch names; if no SWEEP PATHS line is appended, sweep nothing. For each listed path, run git worktree list --porcelain and confirm the path appears there with its checked-out branch being one you merged in this wave; only after that per-path check passes, remove it with git worktree remove --force <path>, using the absolute worktree path the porcelain output printed. A listed path absent from the porcelain output was already swept — skip it silently. A path that is present but fails the branch check must not be removed: skip it and name it in your reply detail. Never delete any branch — branches carry the merged commits, and the deterministic Step-5 sweep owns branch cleanup.
```

(`<path>` is literal prose, not a `{{…}}` placeholder — the drift test's `PLACEHOLDER` regex only splits on `{{WORD}}`, and `fillPaths()` only substitutes `<pluginRoot>`/`<runDir>`, so it survives to the agent verbatim.)

- [ ] **Step 4: Edit the bake source — rewrite the "Worktree and Branch Facts" paragraph**

In the same file, replace the paragraph at ~:57 — currently:

```
Branches are locked while their worktree exists (worktrees and branches stay until the deterministic Step-5 sweep removes them; the merge agent itself never removes worktrees or deletes branches). When a task agent finishes with no file changes, its worktree is auto-removed and no branch is reported. When changes exist, the worktree and its branch persist after merge — they are removed by the deterministic `sweep_worktrees.sh` at the Step-5 gate, not by the merge agent. Failed/blocked branches and their worktrees are likewise left for inspection until the orchestrating agent sweeps them after the pre-merge gate.
```

with:

```
Branches are locked while their worktree exists, and no engine role ever deletes a branch — branches carry the commits until the deterministic Step-5 sweep removes them. When a task agent finishes with no file changes, its worktree is auto-removed and no branch is reported. When changes exist, the worktree persists through review and merge; at the wave barrier the merge agent (or, when the wave's final MERGED came from reconciliation, the reconciliation agent) removes the just-merged worktrees named on its dispatch's SWEEP PATHS line — after confirming each path via `git worktree list --porcelain` — so a wide plan no longer accumulates every merged checkout to end-of-run (#151, reversing bea1875's prompt subtraction; disk exhaustion mid-merge misreports as CONFLICT). The SWEEP PATHS line is engine-derived from the self-reported branch names by shape (`worktree-wf_<x>-<n>` → `.claude/worktrees/wf_<x>-<n>`, the same mapping `sweep_worktrees.sh` owns); a malformed name contributes nothing, silently. Contended-wave adoptions are best-effort-excluded: they report MERGED through the contended STEP prompt, which carries no sweep step, so their consumed worktrees wait for the Step-5 sweep. Failed/blocked/parked branches and their worktrees are never swept mid-run — they are left for inspection until the orchestrating agent sweeps them after the pre-merge gate — and the Step-5 `sweep_worktrees.sh` remains idempotent over worktrees already removed at a wave barrier (`[ -e "$wt" ] || continue`).
```

- [ ] **Step 5: Re-bake into the harness — prompt constants**

In `skills/ultrapowers/harnesses/waves.js`, per the re-bake procedure in the workflow-template reference (copy the changed wording into the corresponding `const`; formatting need not match, the words must). The MERGE_PROMPT const (:425–438) currently ends:

```js
  '<runDir>/heads/wave-<waveNumber>. Shell redirection only — never type a sha ' +
  'by hand.'
```

Change that ending to:

```js
  '<runDir>/heads/wave-<waveNumber>. Shell redirection only — never type a sha ' +
  'by hand. After the heads are recorded and only if you are reporting MERGED, ' +
  "sweep this wave's consumed worktrees: a SWEEP PATHS line appended to this " +
  'dispatch names the just-merged worktree paths, derived by the engine from ' +
  'the merged branch names; if no SWEEP PATHS line is appended, sweep ' +
  'nothing. For each listed path, run git worktree list --porcelain and ' +
  'confirm the path appears there with its checked-out branch being one you ' +
  'merged in this wave; only after that per-path check passes, remove it ' +
  'with git worktree remove --force <path>, using the absolute worktree ' +
  'path the porcelain output printed. A listed path absent from the ' +
  'porcelain output was already swept — skip it silently. A path that is ' +
  'present but fails the branch check must not be removed: skip it and name ' +
  'it in your reply detail. Never delete any branch — branches carry the ' +
  'merged commits, and the deterministic Step-5 sweep owns branch cleanup.'
```

Apply the IDENTICAL ending to the RECONCILE_PROMPT const (:440–453), which ends with the same two lines today. Write the full text out in both constants — the drift pin matches each BAKE block against contiguous text, so a shared const would break it (this is the documented reason both prompts already carry the heads sentence verbatim, waves.js:419–424).

- [ ] **Step 6: Re-bake into the harness — sweep-line composition and dispatch**

Still in the harness file: add the helper immediately after `headsSlotsLine` (:458–466):

```js
// #151: the wave-barrier sweep line. The engine never sees the runtime
// wf_<runId>, so worktree paths can only derive from the implementers'
// SELF-REPORTED branch names — model-typed input feeding
// `git worktree remove --force`. Derivation is therefore narrowed by shape:
// a branch matching worktree-wf_<x>-<n> maps to .claude/worktrees/wf_<x>-<n>
// (the same prefix-strip mapping sweep_worktrees.sh owns); a malformed name
// contributes nothing, silently. Only THIS wave's merged results are listed:
// blocked/parked/failed worktrees stay for evidence, and the frozen Step-5
// sweep stays idempotent over paths already removed here. The prompt-side
// `git worktree list --porcelain` identity check is the second defense.
const SWEEP_BRANCH_RE = /^worktree-wf_.+-[0-9]+$/
const sweepPathsLine = (mergedResults) => {
  const paths = mergedResults
    .filter((r) => SWEEP_BRANCH_RE.test(r.branch || ''))
    .map((r) => '.claude/worktrees/' + r.branch.slice('worktree-'.length))
  return paths.length ? ('SWEEP PATHS for this wave: ' + paths.join(', ') + '.') : ''
}
```

In `mergeWave` (:1453), after the existing slots line (:1461):

```js
  const slotsLine = headsSlotsLine(merged, waveIdx + 1)
```

add:

```js
  const sweepLine = sweepPathsLine(merged)
```

Change the merge dispatch (:1470–1473) from:

```js
    merge = await agent(
      fillPaths(GUARD + '\n\n' + MERGE_PROMPT + ' ' + slotsLine) +
        '\nMerge in this order:\n' + branchList,
```

to:

```js
    merge = await agent(
      fillPaths(GUARD + '\n\n' + MERGE_PROMPT + ' ' + slotsLine) +
        (sweepLine ? '\n' + sweepLine : '') +
        '\nMerge in this order:\n' + branchList,
```

and the reconcile dispatch (:1485–1487) from:

```js
      merge = await agent(
        fillPaths(GUARD + '\n\n' + RECONCILE_PROMPT + ' ' + slotsLine) +
          '\nFailure:\n' + (merge.detail || ''),
```

to:

```js
      merge = await agent(
        fillPaths(GUARD + '\n\n' + RECONCILE_PROMPT + ' ' + slotsLine) +
          (sweepLine ? '\n' + sweepLine : '') +
          '\nFailure:\n' + (merge.detail || ''),
```

The sweep line rides OUTSIDE `fillPaths()`, exactly like `branchList`: it is composed from model-typed branch fragments, and `.+` in the regex could legally contain a literal `<runDir>` — path substitution applies to engine-authored text only (waves.js:340–345). Do NOT touch `contendedMerge` or the contended dispatch — the contended path is the declared best-effort exclusion.

- [ ] **Step 7: Replace the drift-pin test**

In `tests/test_no_prompt_drift.py`, replace the final section (:117–123) — currently:

```python
# ── merge/reconcile HEAD-assert + cleanup-out-of-prompt ───────────────────────
def test_merge_prompt_does_not_instruct_cleanup():
    wf = normalize(WORKFLOW.read_text())
    # the merge agent must NOT be told to remove worktrees or delete branches —
    # cleanup is the deterministic sweep at the Step-5 gate, not a merge-prompt step
    for forbidden in ("worktree remove", "git branch d", "delete the branch", "clean up the merged branches"):
        assert normalize(forbidden) not in wf, f"merge prompt still instructs cleanup: {forbidden!r}"
```

with:

```python
# ── merge/reconcile HEAD-assert + wave-barrier sweep (#151, reverses bea1875) ─
def test_merge_prompt_sweeps_worktrees_but_never_branches():
    wf = normalize(WORKFLOW.read_text())
    # #151 reverses bea1875's subtraction: the wave-barrier sweep step is IN
    # the merge/reconcile prompts again, identity-checked and worktree-only.
    # Branch deletion stays forbidden — branches carry the merged commits
    # until the deterministic Step-5 sweep.
    for required in ("git worktree list --porcelain",
                     "git worktree remove --force",
                     "never delete any branch"):
        assert normalize(required) in wf, f"merge prompt lost the sweep step: {required!r}"
    for forbidden in ("git branch d", "delete the branch",
                      "clean up the merged branches"):
        assert normalize(forbidden) not in wf, f"merge prompt instructs branch deletion: {forbidden!r}"
```

(`test_merge_prompt_asserts_head` at :126–128 stays unchanged.)

- [ ] **Step 8: Run the drift pin**

Run: `python3 -m pytest tests/test_no_prompt_drift.py -q`
Expected: all PASS (17 tests). If a `BAKE:MERGE_PROMPT` / `BAKE:RECONCILE_PROMPT` fragment mismatch is reported, the baked const wording drifted from the source block — fix the words (not the formatting) and re-run until green.

- [ ] **Step 9: Run the sims**

Run: `node tests/sim_workflow.mjs`
Expected: exit 0, `scenario happy: OK`, `scenario wave-barrier-sweep: OK` among the scenario lines, final line `ALL SCENARIOS PASSED`.

Run the other harness-referencing sims too (the suite-gate runs them because harness JS changed):
`node tests/sim_derived_heads.mjs` — Expected: `ALL SCENARIOS PASSED` (its stub branches are `wt-…`, malformed under the sweep regex, so no SWEEP PATHS line perturbs its containment assertions).
`node tests/frontier_merge.mjs` — Expected: `ALL SCENARIOS PASSED` (contended prompts untouched).
`node tests/wave_ancestry_sim.mjs` — Expected: `ALL SCENARIOS PASSED`.

- [ ] **Step 10: Bump the harness manifest version**

In `skills/ultrapowers/harnesses/waves.harness.json`, change:

```json
  "version": "0.0.11",
```

to:

```json
  "version": "0.0.12",
```

(the harness changed — precedent set by the workflow-template note on harness code changes).

- [ ] **Step 11: Full suite**

Run: `python3 -m pytest`
Expected: all green (pytest.ini scopes to tests/; the `.mjs` sims are gated separately and already ran in Step 9).

- [ ] **Step 12: Commit**

```bash
git add skills/ultrapowers/references/wave-merge.md \
        skills/ultrapowers/harnesses/waves.js \
        skills/ultrapowers/harnesses/waves.harness.json \
        tests/sim_workflow.mjs tests/test_no_prompt_drift.py
git commit -m "feat(engine): sweep just-merged worktrees at the wave barrier (#151, reverses bea1875)"
```

---

### Task 2: Preflight disk-headroom guard

**Type:** implementation
**Depends-on:** none
**Review:** lean

**Files:**
- Modify: `skills/ultrapowers/scripts/ultra_run.py`
- Test: `tests/test_ultra_run.py`

Touch points: module constants after :35; the new stage sits after the compile stage (immediately after the line that stores the compile object into the receipt, :394) and before the test-command block (:396).

**Interfaces:**
- Consumes: nothing from other tasks (reads `compile_obj["waves"]`, already in scope at the insertion point).
- Produces: the `disk-headroom` receipt stage — `{"stage": "disk-headroom", "ok": <bool>, "detail": <verdict-stating string>}` — ordered immediately after the `compile` stage. Verdict grammar: detail starts `ok:` / `WARN:` / `BLOCKED:` and always states `free <X> GiB vs estimate <Y> GiB (widest wave <N> x 1.5 GiB)`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_ultra_run.py` (follows the file's existing idioms: `make_repo`/`run_driver` for subprocess-level tests, in-process `ultra_run.main` + `monkeypatch` + `capsys` for tests that must fake a syscall — the same pattern as `test_prune_failure_absent_from_removed_list_and_named_in_stage_detail`):

```python
# --- #151: disk-headroom preflight stage (the cycle's one budgeted guard) ---
# free vs estimate = widest_wave_width x 1.5 GiB (hardcoded, no env knob).
# warn stays ok:true (advisory; a tight-but-sufficient host must not
# false-block); block only when free < min(2 GiB, estimate), so a narrow
# run on a small host is never refused by a floor larger than its own need.

GIB = 1024 ** 3

# Two INDEPENDENT tasks -> one wave of width 2 -> estimate 3.0 GiB, floor 2 GiB.
WIDE_PLAN = (
    "# P\n\n**Acceptance:** waived — test fixture\n\n"
    "### Task 1: A\n\n**Type:** implementation\n**Depends-on:** none\n\n"
    "**Files:**\n- Create: `a.py`\n\n- [ ] **Step 1: do**\n\n"
    "### Task 2: B\n\n**Type:** implementation\n**Depends-on:** none\n\n"
    "**Files:**\n- Create: `b.py`\n\n- [ ] **Step 1: do**\n"
)


def make_wide_repo(tmp_path):
    repo = make_repo(tmp_path)
    (repo / "plan.md").write_text(WIDE_PLAN)
    sh(["git", "add", "plan.md"], cwd=repo)
    sh(["git", "commit", "-qm", "wide plan"], cwd=repo)
    return repo


def run_main_with_free(repo, monkeypatch, capsys, free_bytes):
    """Drive ultra_run.main in-process with shutil.disk_usage faked."""
    import ultra_run

    class Usage:
        def __init__(self, free):
            self.free = free

    monkeypatch.setattr(ultra_run.shutil, "disk_usage",
                        lambda path: Usage(free_bytes))
    rc = ultra_run.main(["plan.md", "--stamp", "t1", "--repo", str(repo)])
    return rc, json.loads(capsys.readouterr().out)


def headroom_stage(receipt):
    return next(s for s in receipt["stages"] if s["stage"] == "disk-headroom")


def test_disk_headroom_ok_at_estimate_boundary(tmp_path, monkeypatch, capsys):
    # free == estimate -> ok (Free >= estimate is the ok branch).
    repo = make_wide_repo(tmp_path)
    rc, receipt = run_main_with_free(repo, monkeypatch, capsys, 3 * GIB)
    assert rc == 0
    s = headroom_stage(receipt)
    assert s["ok"] is True
    assert s["detail"].startswith("ok: ")
    assert "free 3.0 GiB vs estimate 3.0 GiB (widest wave 2 x 1.5 GiB)" in s["detail"]


def test_disk_headroom_warns_below_estimate_above_floor(tmp_path, monkeypatch, capsys):
    repo = make_wide_repo(tmp_path)
    rc, receipt = run_main_with_free(repo, monkeypatch, capsys, int(2.5 * GIB))
    assert rc == 0                                   # advisory: never blocks here
    s = headroom_stage(receipt)
    assert s["ok"] is True                           # warn-as-ok:true (worktree-audit shape)
    assert s["detail"].startswith("WARN: ")
    assert "free 2.5 GiB vs estimate 3.0 GiB (widest wave 2 x 1.5 GiB)" in s["detail"]


def test_disk_headroom_warn_not_block_at_floor_boundary(tmp_path, monkeypatch, capsys):
    # free == floor (2 GiB) -> still WARN; block is strictly free < floor.
    repo = make_wide_repo(tmp_path)
    rc, receipt = run_main_with_free(repo, monkeypatch, capsys, 2 * GIB)
    assert rc == 0
    s = headroom_stage(receipt)
    assert s["ok"] is True
    assert s["detail"].startswith("WARN: ")


def test_disk_headroom_blocks_below_floor(tmp_path, monkeypatch, capsys):
    repo = make_wide_repo(tmp_path)
    rc, receipt = run_main_with_free(repo, monkeypatch, capsys, 1 * GIB)
    assert rc != 0
    assert receipt["ok"] is False
    s = headroom_stage(receipt)
    assert s["ok"] is False
    assert s["detail"].startswith("BLOCKED: ")
    assert "free 1.0 GiB vs estimate 3.0 GiB (widest wave 2 x 1.5 GiB)" in s["detail"]
    assert "min(2 GiB, estimate)" in s["detail"]
    # Blocked BEFORE anything expensive: no later stage ran.
    names = [x["stage"] for x in receipt["stages"]]
    assert "test-command" not in names and "lock" not in names


def test_disk_headroom_min_floor_narrow_run_not_blocked_by_flat_floor(
        tmp_path, monkeypatch, capsys):
    # The default PLAN chains 1 -> 2: widest wave 1 -> estimate 1.5 GiB,
    # floor min(2 GiB, 1.5 GiB) = 1.5 GiB. free 1.7 GiB >= estimate -> ok.
    # A flat 2 GiB floor would have false-blocked this narrow run.
    repo = make_repo(tmp_path)
    rc, receipt = run_main_with_free(repo, monkeypatch, capsys, int(1.7 * GIB))
    assert rc == 0
    s = headroom_stage(receipt)
    assert s["ok"] is True
    assert s["detail"].startswith("ok: ")
    assert "widest wave 1" in s["detail"]


def test_disk_headroom_min_floor_narrow_run_blocks_below_own_estimate(
        tmp_path, monkeypatch, capsys):
    # Same narrow plan, free 1.4 GiB < floor (= estimate 1.5 GiB) -> block.
    repo = make_repo(tmp_path)
    rc, receipt = run_main_with_free(repo, monkeypatch, capsys, int(1.4 * GIB))
    assert rc != 0
    s = headroom_stage(receipt)
    assert s["ok"] is False
    assert s["detail"].startswith("BLOCKED: ")


def test_disk_headroom_stage_runs_right_after_compile(tmp_path):
    # Real disk_usage (dev/CI hosts have headroom); ordering is the contract.
    repo = make_repo(tmp_path)
    r = run_driver(repo)
    assert r.returncode == 0, r.stdout + r.stderr
    names = [s["stage"] for s in json.loads(r.stdout)["stages"]]
    assert names.index("disk-headroom") == names.index("compile") + 1
    assert names.index("disk-headroom") < names.index("test-command")
```

Also extend the existing happy-path stage roster: in `test_happy_path_receipt` (:61–64), add `"disk-headroom"` to the `for expected in (...)` tuple, between `"compile"` and `"test-command"`:

```python
    for expected in ("git-repo", "worktree-probe", "engine-skew",
                     "superpowers-compat", "compile", "disk-headroom",
                     "test-command", "install", "lock", "dirty-baseline"):
        assert expected in stage_names
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 -m pytest tests/test_ultra_run.py -q -k disk_headroom`
Expected: FAIL — every test errors with `StopIteration` from `headroom_stage` (no `disk-headroom` stage exists yet) or the ordering `ValueError`.

- [ ] **Step 3: Implement the stage**

In `skills/ultrapowers/scripts/ultra_run.py`, add module constants after `KEEP_RUNS = 10` (:35):

```python
# #151 disk-headroom guard: per-concurrent-worktree footprint envelope and
# the absolute block floor. Hardcoded by design — the env knob was deleted
# at trim review (a tuning surface on an advisory warn is machinery not yet
# earned by field data).
GIB = 1024 ** 3
HEADROOM_PER_TASK = int(1.5 * GIB)
HEADROOM_FLOOR = 2 * GIB
```

Then insert the stage in `main()`, immediately after `receipt["compile"] = compile_obj` (:394) and before the `--test-cmd` block (:396):

```python
    # Disk headroom (#151): the cycle's one budgeted additive guard, placed
    # after compile (it needs compile_obj["waves"] for the widest-wave width)
    # and before anything expensive. The widest wave bounds peak concurrent
    # worktree footprint. Advisory by default — warn stays ok:true with a
    # verdict-stating detail (#97; warn shape per the worktree-audit stage) —
    # because a tight-but-sufficient host must not false-block. Block only
    # when free < min(2 GiB, estimate): the floor never exceeds what the run
    # actually needs, so a narrow run on a small host is never refused by a
    # floor larger than its own estimate.
    widest = max((len(w) for w in (compile_obj.get("waves") or [])), default=0)
    estimate = widest * HEADROOM_PER_TASK
    free = shutil.disk_usage(root).free
    floor = min(HEADROOM_FLOOR, estimate)

    def _gib(n):
        return "%.1f GiB" % (n / GIB)

    headroom = ("free %s vs estimate %s (widest wave %d x 1.5 GiB)"
                % (_gib(free), _gib(estimate), widest))
    if free < floor:
        stage("disk-headroom", False,
              failure="BLOCKED: " + headroom + " — free is below the "
                      "min(2 GiB, estimate) floor; free disk space and relaunch")
        return bail()
    if free < estimate:
        stage("disk-headroom", True,
              success="WARN: " + headroom + " — the run may exhaust disk "
                      "mid-merge; consider freeing space (advisory)")
    else:
        stage("disk-headroom", True, success="ok: " + headroom)
```

No other file changes: no env knob, no receipt top-level field, and the frozen periphery scripts are untouched.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python3 -m pytest tests/test_ultra_run.py -q`
Expected: all PASS — the new disk-headroom tests plus every pre-existing test (the generic `test_green_stages_never_carry_failure_phrasings` covers the new stage automatically; its green details carry none of the failure phrasings).

- [ ] **Step 5: Full suite**

Run: `python3 -m pytest`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add skills/ultrapowers/scripts/ultra_run.py tests/test_ultra_run.py
git commit -m "feat(preflight): disk-headroom stage — warn under widest-wave estimate, block under min(2 GiB, estimate) (#151)"
```
