# Post-#259 Hardening Implementation Plan (#275, #247)

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Acceptance:** suite — advisory hardening on engine internals and tests; the committed suite (pytest + the suite-gate `.mjs` sims) is the verification

**Goal:** Land the eight #275/#247 hardening items: critic-detach idempotency (baked prompt), the vacuous-merge guard + named errors in finalize_report.py, the ancestryMisses render fix, a doc anchor fix, two test-pin repairs, the contended-leg frontier_merge scenario, and the compile-helper folds.

**Architecture:** Six small tasks on already-existing surfaces. No new scripts, one new report field (`baseSha`). The baked completeness prompt is edited in its source (`references/wave-merge.md`) and mirrored verbatim into `waves.js`, keeping `tests/test_no_prompt_drift.py` green. All `waves.js` behavior changes are pinned in the `.mjs` sims the suite-gate runs.

**Tech Stack:** Python 3 (pytest), Node (`.mjs` self-asserting sims), markdown reference docs.

**Spec:** `docs/superpowers/specs/2026-08-26-post-259-hardening.md`

## Global Constraints

- The frozen verification periphery (`gate_check.py`, `ultra_gate.py`, `run_lock.sh`, `collect_seal.py`, `seal_hash.py`, `run_acceptance.sh`) has **zero diff**.
- `fleet/**` is untouched.
- Baked-prompt text in `waves.js` matches its source block in `references/wave-merge.md` (pinned by `tests/test_no_prompt_drift.py`).
- Every `.mjs` sim touched still prints `ALL SCENARIOS PASSED` on success and exits non-zero on any failed expectation.
- Suite runs are serialized — never two concurrent local `python3 -m pytest` invocations (fleet tests bind fixed ports 8151–8153).

---

### Task 1: Critic detach idempotency — baked prompt clause (S1)

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/references/wave-merge.md`
- Modify: `skills/ultrapowers/harnesses/waves.js`
- Test: `tests/test_no_prompt_drift.py`

**Interfaces:**
- Consumes: nothing from other tasks
- Produces: nothing other tasks consume

- [ ] **Step 1: Edit the source block in wave-merge.md.** Inside `<!-- BAKE:COMPLETENESS_PROMPT -->`, replace this exact sentence fragment:

```
Confirm git branch --show-current prints {{INTEGRATION_BRANCH}}; if it does not, report BLOCKED and produce no findings — do not guess a tree.
```

with:

```
Confirm git branch --show-current prints {{INTEGRATION_BRANCH}}; if it prints nothing (a detached HEAD) but git rev-parse HEAD equals git rev-parse {{INTEGRATION_BRANCH}}, you are already detached on the integration tip — proceed; in any other case where it does not print {{INTEGRATION_BRANCH}}, report BLOCKED and produce no findings — do not guess a tree.
```

The following sentences (`Run git rev-parse HEAD: that sha is <derived>… Then run git checkout --detach <derived>…`) stay verbatim — they are correct on both paths (`git checkout --detach <sha>` is idempotent when already detached there).

- [ ] **Step 2: Mirror into waves.js.** In `completenessPrompt`, replace:

```js
  'from git itself — never detach at a sha typed into this prompt. Confirm ' +
  'git branch --show-current prints ' + integrationBranch + '; if it does not, ' +
  'report BLOCKED and produce no findings — do not guess a tree. Run ' +
```

with:

```js
  'from git itself — never detach at a sha typed into this prompt. Confirm ' +
  'git branch --show-current prints ' + integrationBranch + '; if it prints ' +
  'nothing (a detached HEAD) but git rev-parse HEAD equals git rev-parse ' +
  integrationBranch + ', you are already detached on the integration tip — ' +
  'proceed; in any other case where it does not print ' + integrationBranch +
  ', report BLOCKED and produce no findings — do not guess a tree. Run ' +
```

- [ ] **Step 3: Verify the drift pin and sims.** Run `python3 -m pytest tests/test_no_prompt_drift.py -q` → all pass. Run `node tests/wave_ancestry_sim.mjs` and `node tests/frontier_merge.mjs` → `ALL SCENARIOS PASSED`.
- [ ] **Step 4: Commit** `feat: completeness critic accepts an already-detached HEAD at the integration tip (#275)` staging exactly the two modified files.

### Task 2: Report baseSha field + ancestryMisses render fix (S2-half, S3)

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/harnesses/waves.js`
- Modify: `skills/ultrapowers/references/report-format.md`
- Test: `tests/wave_ancestry_sim.mjs`

**Interfaces:**
- Consumes: nothing from other tasks
- Produces: `baseSha` (string, agent-reported setup head) as a top-level key of the workflow's structured return — Task 3's `finalize_report.py` guard reads `target.baseSha` from saved reports at runtime (no compile-time coupling; Task 3's tests construct reports by hand)

**Parallelization rationale:** the report-field producer and its Python consumer meet only through saved JSON at runtime; each side carries its own tests, so they build independently against the field name fixed here.

- [ ] **Step 1: Extend the sim first (failing).** In `tests/wave_ancestry_sim.mjs`:
  - In `scenarioMiss`, change `ancestryMisses` to two entries and update the assertions:

```js
    ancestryMisses: [
      { task: 'A', headSha: 'sha-A' },
      { task: 'C', headSha: "fatal: ambiguous argument 'wt-C': unknown revision or path not in the working tree" },
    ],
```

  and replace the single `named` assertion block with:

```js
  assert(report.gitVerified === false, 'ancestry miss withholds gitVerified (run BLOCKED)')
  assert(Array.isArray(report.ancestryMisses) && report.ancestryMisses.length === 2,
    'report surfaces both ancestry misses')
  const named = report.judgmentCalls.some((j) => /ancestry miss/.test(j) && /task A/.test(j) && /BLOCKED/.test(j))
  assert(named, 'a judgmentCall names the dropped task and marks the run BLOCKED')
  // #275: a resolution-failure message in headSha renders WHOLE — truncation
  // to 12 chars destroyed everything past "fatal: ambig".
  const fullMsg = report.judgmentCalls.some((j) =>
    j.indexOf("fatal: ambiguous argument 'wt-C': unknown revision or path not in the working tree") !== -1)
  assert(fullMsg, 'a resolution-failure headSha reaches the judgmentCall untruncated')
```

  - In `scenarioClean`, after the existing asserts add:

```js
  // #275: the run base rides the report so finalize_report.py can guard
  // vacuous merge claims. Agent-reported (setup reply) — context, not authority.
  assert(report.baseSha === 'int0', 'report carries the setup base sha as baseSha')
```

- [ ] **Step 2: Run `node tests/wave_ancestry_sim.mjs`** → must FAIL (truncated message; missing baseSha).
- [ ] **Step 3: Implement in waves.js.**
  - In the ancestryMisses loop (~line 2216) change `String((m && m.headSha) || '').slice(0, 12)` to `String((m && m.headSha) || '')` (delete the truncation — nothing pins the 12-char form, and a failure message must render whole).
  - In the final return object (~line 2296), add `baseSha: setup.headSha,` directly under `integrationBranch,`.
- [ ] **Step 4: Run `node tests/wave_ancestry_sim.mjs` and `node tests/frontier_merge.mjs`** → `ALL SCENARIOS PASSED` on both.
- [ ] **Step 5: Document the field.** In `skills/ultrapowers/references/report-format.md`, add `"baseSha": { "type": "string" }` to the schema's properties (beside `integrationBranch`) and one prose line near the headSha-provenance row: `baseSha` is the run base (the setup reply's head sha, agent-reported — context that lets `finalize_report.py` refuse a merged claim whose branch carries no commits beyond the run base; the git-derived ancestry checks remain the authority).
- [ ] **Step 6: Commit** `feat: report carries baseSha; ancestryMisses render untruncated (#275)`.

### Task 3: finalize_report.py vacuous-merge guard + named open/parse errors + test pins (S2-half, S5, S6)

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/scripts/finalize_report.py`
- Test: `tests/test_finalize_report.py`

**Interfaces:**
- Consumes: the report key name `baseSha` (string) as fixed by Task 2 — read via `target.get("baseSha")` from hand-built test reports; no import of Task 2's code
- Produces: nothing other tasks consume

- [ ] **Step 1: Write the failing tests.** In `tests/test_finalize_report.py`:
  - Change `make_report` signature to `def make_report(tmp_path, tips, envelope=False, last_status="MERGED", final_recorded="f" * 40, base_sha=None):`; inside, after building `body`, add `if base_sha: body["baseSha"] = base_sha`; and change the write line to `p.write_text(json.dumps({"summary": "ok", "result": body} if envelope else body))` (the sibling-key envelope pin, #275-6).
  - In `test_envelope_shaped_report`, after the existing asserts add:

```python
    full = json.loads(report.read_text())
    assert full["summary"] == "ok"   # the rewrite preserves envelope siblings
```

  - In `test_intermediate_wave_headsha_left_untouched`, change `run(report, repo)` to `r = run(report, repo)` and add `assert r.returncode == 0, r.stderr` before reading the file back.
  - Append these five tests:

```python
def _root_commit(repo):
    return _git(repo, "rev-list", "--max-parents=0", "HEAD")


def test_vacuous_merged_branch_fails_when_base_known(tmp_path):
    repo, tips, tip = make_run(tmp_path)
    base = _root_commit(repo)
    _git(repo, "branch", "worktree-wf_t-4", base)   # zero commits past the run base
    report = make_report(tmp_path, tips, base_sha=base)
    data = json.loads(report.read_text())
    data["waveMerges"][0]["branches"].append("4")
    data["tasks"].append({"task": "4", "status": "done",
                          "branch": "worktree-wf_t-4", "headSha": "e" * 40})
    report.write_text(json.dumps(data))
    before = report.read_text()
    r = run(report, repo)
    assert r.returncode == 1
    assert "already an ancestor of the run base" in r.stderr
    assert "worktree-wf_t-4" in r.stderr
    assert report.read_text() == before


def test_missing_base_sha_skips_guard_with_named_warning(tmp_path):
    repo, tips, tip = make_run(tmp_path)
    _git(repo, "branch", "worktree-wf_t-4", _root_commit(repo))
    report = make_report(tmp_path, tips)   # no baseSha
    data = json.loads(report.read_text())
    data["waveMerges"][0]["branches"].append("4")
    data["tasks"].append({"task": "4", "status": "done",
                          "branch": "worktree-wf_t-4", "headSha": "e" * 40})
    report.write_text(json.dumps(data))
    r = run(report, repo)
    assert r.returncode == 0, r.stderr
    assert "vacuous-merge guard skipped" in r.stderr


def test_genuine_branches_pass_with_base_present(tmp_path):
    repo, tips, tip = make_run(tmp_path)
    report = make_report(tmp_path, tips, base_sha=_root_commit(repo))
    r = run(report, repo)
    assert r.returncode == 0, r.stderr


def test_missing_report_file_names_the_fact(tmp_path):
    repo, tips, tip = make_run(tmp_path)
    r = run(tmp_path / "nope.json", repo)
    assert r.returncode == 1
    assert "finalize_report: cannot read --report" in r.stderr
    assert "Traceback" not in r.stderr


def test_malformed_report_names_the_fact(tmp_path):
    repo, tips, tip = make_run(tmp_path)
    p = tmp_path / "report.json"
    p.write_text("{not json")
    r = run(p, repo)
    assert r.returncode == 1
    assert "not valid JSON" in r.stderr
    assert "Traceback" not in r.stderr
```

- [ ] **Step 2: Run `python3 -m pytest tests/test_finalize_report.py -q`** → the five new tests (and the two amended ones' new asserts) FAIL; the guard/messages don't exist yet.
- [ ] **Step 3: Implement in finalize_report.py.**
  - Replace the bare open with:

```python
    try:
        with open(a.report) as f:
            report = json.load(f)
    except OSError as e:
        print("finalize_report: cannot read --report %s: %s" % (a.report, e),
              file=sys.stderr)
        sys.exit(1)
    except json.JSONDecodeError as e:
        print("finalize_report: --report %s is not valid JSON: %s"
              % (a.report, e), file=sys.stderr)
        sys.exit(1)
```

  - After the integration-tip resolution (`tip = rev_parse(...)` block), add:

```python
    # #275: the run base (agent-reported at setup — context, not authority)
    # lets us refuse a merged claim whose branch carries no commits beyond it.
    base = rev_parse(a.repo, str(target.get("baseSha") or ""))
    if not base:
        warnings.append("report carries no resolvable baseSha — "
                        "vacuous-merge guard skipped")
```

  - In the merged-task loop, immediately after `tip_b` resolves (before the existing `is_ancestor` check), add:

```python
            if base and is_ancestor(a.repo, tip_b, base):
                errors.append(
                    "branch %s (task %s) tip %s is already an ancestor of the "
                    "run base %s — merged claim carries no commits beyond the "
                    "run base" % (branch, tid, tip_b, base))
                continue
```

  Note the warnings list is printed before the errors check — the skip warning keeps its "(context, not blocking)" suffix from the existing print loop.
- [ ] **Step 4: Run `python3 -m pytest tests/test_finalize_report.py -q`** → all pass (existing tests must stay green: reports without `baseSha` only gain the skip warning).
- [ ] **Step 5: Commit** `feat: finalize_report refuses vacuous merged claims; named open/parse errors; envelope + returncode pins (#275)`.

### Task 4: FOLD_LOG.md numbering anchor (S4)

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/kernel/FOLD_LOG.md:10`

**Interfaces:**
- Consumes: nothing
- Produces: nothing

- [ ] **Step 1: Reword line 10.** Replace:

```
`<n>` is **1-based**, matching the `heads/` slot convention. Everything else
```

with:

```
`<n>` is **1-based**, matching the wave numbering the run reports. Everything else
```

- [ ] **Step 2: Verify** `grep -rn "heads/ slot" skills/ultrapowers/kernel/` returns nothing.
- [ ] **Step 3: Commit** `docs: FOLD_LOG numbering anchors to wave numbering, not the deleted heads/ slots (#275)`.

### Task 5: frontier_merge.mjs — contended leg of mergedWaveTasks (S7)

**Type:** implementation
**Depends-on:** none

**Files:**
- Test: `tests/frontier_merge.mjs`

**Interfaces:**
- Consumes: the existing sim fixtures (`makeAgent`, `argsFor`, `conflictFoldReply`, `openEntry`, `promptFor`, `has`, `eq`, `assert`) — all already defined in the file
- Produces: nothing

- [ ] **Step 1: Add scenario 11j** after `scenarioCompositionPartiallyMergedExcludesFailedWriter` and register it in the await list before the sentinel:

```js
// ── 11j: partial merge where the SURVIVORS still contend — pins the contended
// leg of mergedWaveTasks (#247): the failed writer must be excluded from the
// fold command, the --commutes args, and the resolver's CONTENDING TASKS block.
async function scenarioPartialMergeContendedSurvivors() {
  const calls = []
  const open = [openEntry(1, 'shared.py', 1)]
  const agent = makeAgent(calls, (label) => {
    if (label === 'impl:t2' || label === 'fix:t2') {
      return { status: 'BLOCKED', summary: 'cannot', branch: 'wt-t2', headSha: 'sha-t2' }
    }
    if (label === 'merge:wave1:fold') return conflictFoldReply(open, [])
    if (label === 'resolve:wave1:1:1') return { status: 'RESOLVED', notes: 'union' }
    if (label === 'merge:wave1:apply1:1') {
      return { status: 'FOLDED', complete: true, selfChecks: 'ok', open: [], remaining: [] }
    }
    if (label === 'merge:wave1:adopt') return { status: 'MERGED', headSha: 'cand-11j' }
    return undefined
  })
  // Every writer declares commutes on the shared path, INCLUDING the failed
  // one: a drift joining launch tasks instead of merged tasks would emit t2's
  // --commutes entry and its CONTENDING TASKS row. t3 declares nothing — a
  // survivor without a declaration must contribute no --commutes arg.
  const waves = [[
    { id: 't1', title: 'one', body: 'b1', tier: 'cheap', files: ['shared.py'], writes: ['shared.py'], commutes: ['shared.py'] },
    { id: 't2', title: 'two', body: 'b2', tier: 'cheap', files: ['shared.py'], writes: ['shared.py'], commutes: ['shared.py'] },
    { id: 't3', title: 'three', body: 'b3', tier: 'cheap', files: ['shared.py'], writes: ['shared.py'], commutes: [] },
  ]]
  const r = await runWorkflow({ agent, args: argsFor(waves), budget: undefined })
  eq(r.tasks.find((t) => t.task === 't2').status, 'failed', '11j: t2 failed')
  assert(has(calls, 'merge:wave1:fold'), '11j: two surviving same-file writers still contend')
  const fold = promptFor(calls, 'merge:wave1:fold')
  assert(fold.indexOf(' --branch t1=wt-t1:sha-t1 --branch t3=wt-t3:sha-t3') !== -1,
    '11j: the fold command carries both surviving branches, in task-index order')
  assert(fold.indexOf('t2=') === -1, '11j: the failed writer never reaches the fold command')
  assert(fold.indexOf(' --commutes t1=shared.py') !== -1,
    "11j: the surviving declarer's commutes ride the fold command")
  assert(fold.indexOf('--commutes t2=') === -1,
    "11j: the failed writer's commutes are excluded (mergedWaveTasks, not launch tasks)")
  assert(fold.indexOf('--commutes t3=') === -1,
    '11j: a survivor with no declaration contributes no --commutes arg')
  const rp = promptFor(calls, 'resolve:wave1:1:1')
  assert(rp.indexOf('- task t1: one [files: shared.py]') !== -1 &&
    rp.indexOf('- task t3: three [files: shared.py]') !== -1,
    "11j: both survivors' intent reaches the resolver")
  assert(rp.indexOf('- task t2:') === -1,
    '11j: the failed writer is absent from CONTENDING TASKS')
  const adopt = promptFor(calls, 'merge:wave1:adopt')
  assert(adopt.indexOf('--task-head t2') === -1,
    '11j: the failed writer contributes no --task-head to materialize')
  eq(r.waveMerges[0].status, 'MERGED', '11j: the wave merged via the contended path')
  eq(r.waveMerges[0].headSha, 'cand-11j', '11j: the adopted candidate is the wave head')
  console.log('scenario 11j partial-merge-contended-survivors: OK')
}
```

  and add `await scenarioPartialMergeContendedSurvivors()` after `await scenarioCompositionPartiallyMergedExcludesFailedWriter()`.
- [ ] **Step 2: Run `node tests/frontier_merge.mjs`** → `scenario 11j … OK` then `ALL SCENARIOS PASSED`. (If an assertion is wrong about engine behavior, the engine is the authority — fix the scenario's expectations only where they mis-model the pinned contract, never by weakening the three exclusion pins.)
- [ ] **Step 3: Commit** `test: pin the partial-merge contended leg of mergedWaveTasks (#247)`.

### Task 6: test_compile_plan.py helper folds (S8)

**Type:** implementation
**Depends-on:** none

**Files:**
- Test: `tests/test_compile_plan.py`

**Interfaces:**
- Consumes: nothing
- Produces: nothing (public helper names and signatures unchanged)

- [ ] **Step 1: Fold the `*_text` trio (the #247-2 target).** Replace the three seven-line bodies of `compile_plan_text`, `_serialize_text`, and `compile_raw_text` (~line 1159) with:

```python
def _with_plan_file(plan_md, fn):
    """Write `plan_md` to a temp .md file, call `fn(path)`, always clean up."""
    import tempfile, os
    fd, p = tempfile.mkstemp(suffix=".md"); os.close(fd)
    pathlib.Path(p).write_text(plan_md)
    try:
        return fn(pathlib.Path(p))
    finally:
        pathlib.Path(p).unlink(missing_ok=True)


def compile_plan_text(plan_md):
    return _with_plan_file(plan_md, compile_plan)


def _serialize_text(plan_md):
    return _with_plan_file(plan_md, compile_plan_serialize)


def compile_raw_text(plan_md):
    return _with_plan_file(plan_md, compile_plan_raw)
```

- [ ] **Step 2: Fold the path-based four (disclosed bonus, same duplication shape).** Replace the bodies of `compile_plan`, `compile_plan_serialize`, `compile_plan_raw`, `compile_plan_raw_with` (~lines 39–85) with:

```python
def _run_compiler(path, *extra):
    """Run the compiler on `path` (waiver injected when the fixture carries
    none); returns the CompletedProcess."""
    effective, tmp = _with_waiver(path)
    try:
        return subprocess.run(
            [sys.executable, str(COMPILER), str(effective)] + list(extra),
            capture_output=True, text=True)
    finally:
        if tmp:
            pathlib.Path(tmp).unlink(missing_ok=True)


def compile_plan(path):
    p = _run_compiler(path)
    assert p.returncode == 0, p.stderr
    return json.loads(p.stdout)


def compile_plan_serialize(path):
    """Explicit-serialize compile: for tests pinning serialize-mode contention
    semantics (same-file writers serialize), which remain fully supported after
    the spec-§5 default flip to fold."""
    p = _run_compiler(path, "--overlap", "serialize")
    assert p.returncode == 0, p.stderr
    return json.loads(p.stdout)


def compile_plan_raw(path):
    return _run_compiler(path)


def compile_plan_raw_with(path, extra):
    return _run_compiler(path, *extra)
```

  (`--overlap serialize` moves from before the path to after it — `compile_plan_raw_with` already passes trailing flags, so the compiler's argparse accepts either order.)
- [ ] **Step 3: Run `python3 -m pytest tests/test_compile_plan.py -q`** → all pass, no skips introduced.
- [ ] **Step 4: Commit** `refactor: fold the duplicated temp-plan helper bodies in test_compile_plan (#247)`.

### Task 7: Full-suite gate

**Type:** gate
**Depends-on:** 1, 2, 3, 4, 5, 6

**Files:**
- Test: `python3 -m pytest` (expect 1146 + 5 new = 1151 green, zero failures) and `node tests/frontier_merge.mjs`, `node tests/wave_ancestry_sim.mjs`, `node tests/sim_workflow.mjs`, `node tests/sim_derived_heads.mjs` each printing their pass sentinel

## Operator smoke

No observable surface — suite is the whole story (engine-internal hardening; the one behavioral change, the critic's detach clause, is exercised only inside a live `/ultrapowers` run and will be observed on the next run's gate report).
