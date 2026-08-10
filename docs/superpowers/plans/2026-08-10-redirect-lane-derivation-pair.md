# Redirect-Lane Derivation Pair (#131 + #127) Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A redirect relaunch authored through `redirect_args.py` needs zero hand-supplied coordinates in the common case and cannot present a stale `heads/` slot to any consumer of the relaunch's sidecars.

**Architecture:** Two small structural changes to the one deterministic helper in the sanctioned micro-redirect lane: (1) the integration branch derives from the argsFile the helper already loads (flag stays as explicit override, gate-receipt stays as legacy fallback); (2) as the helper's final act after a successful emit, it deletes the prior launch's `heads/` sidecar directory so the completeness critic's highest-numbered-slot detach rule can only resolve to slots the relaunch writes. Plus one prose sentence covering the hand-authored Salvage lane.

**Tech Stack:** Python 3 (stdlib only), pytest.

**Acceptance:** suite — scripts, tests, and SKILL prose only; no harness JS is touched, so the committed pytest suite is the whole verification and the suite-gate's `.mjs` obligation does not arm.

## Global Constraints

- Frozen periphery untouched: no edits to `gate_check.py`, `ultra_gate.py`, `run_lock.sh`, or any sealing script.
- No harness JS edits (`skills/ultrapowers/harnesses/*.js`) and no baked-prompt re-baking — the fix removes the stale slot rather than teaching consumers to detect it.
- `redirect_args.py` keeps its contract: launch artifacts (`args.json`, `launch.json`) are never mutated; the `heads/` deletion is the single sanctioned mutation of run exhaust, and it happens only after `redirect-args.json` is successfully written.
- The `heads/` deletion target is `<dirname(receipt)>/heads/`, independent of `--out-dir`.
- No new CLI flags, no new knobs, no new filesystem conventions.

---

### Task 1: Derive the integration branch from the argsFile

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/scripts/redirect_args.py:57`
- Test: `tests/test_redirect_args.py`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `redirect_args.py` branch-derivation order `--integration-branch` flag → argsFile `integrationBranch` key → `gate-receipt.json` → loud error (the existing error text unchanged).

- [ ] **Step 1: Write the failing test**

Append to `tests/test_redirect_args.py` (the file's `make_run`/`run_helper` fixtures are reused as-is):

```python
def test_argsfile_branch_derived_without_flag_or_gate_receipt(tmp_path):
    # #127: the argsFile the helper already reads carries integrationBranch —
    # the common case needs zero extra inputs.
    run = make_run(tmp_path)
    args_p = run / "args.json"
    args = json.loads(args_p.read_text())
    args["integrationBranch"] = "ultra/int-args"
    args_p.write_text(json.dumps(args))
    (run / "gate-receipt.json").unlink()
    r = run_helper(run, [{"task": "1", "instruction": "x"}])
    assert r.returncode == 0, r.stderr
    out_args = json.loads(Path(r.stdout.strip()).read_text())
    assert out_args["integrationBranch"] == "ultra/int-args"


def test_flag_wins_over_argsfile_value(tmp_path):
    # bare flag-wins: an explicit operator flag outranks the recorded value.
    run = make_run(tmp_path)
    args_p = run / "args.json"
    args = json.loads(args_p.read_text())
    args["integrationBranch"] = "ultra/int-args"
    args_p.write_text(json.dumps(args))
    r = run_helper(run, [{"task": "1", "instruction": "x"}],
                   "--integration-branch", "ultra/int-flag")
    assert r.returncode == 0, r.stderr
    assert json.loads(Path(r.stdout.strip()).read_text())["integrationBranch"] == "ultra/int-flag"
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `python3 -m pytest tests/test_redirect_args.py::test_argsfile_branch_derived_without_flag_or_gate_receipt tests/test_redirect_args.py::test_flag_wins_over_argsfile_value -v`
Expected: the first FAILS (exit 1, "no integration branch" on stderr — the argsFile key is not consulted today); the second may already pass (flag handling exists) — that is fine, it pins the precedence.

- [ ] **Step 3: Implement the derivation**

In `skills/ultrapowers/scripts/redirect_args.py`, replace the line

```python
    branch = a.integration_branch
```

with

```python
    branch = a.integration_branch or (args.get("integrationBranch") or None)
```

(`args` is already loaded two statements earlier; the `or None` collapses an empty-string value so the fallback chain still runs. The `gate-receipt.json` fallback and the `die(...)` error below it are untouched.)

- [ ] **Step 4: Run the full test file to verify green**

Run: `python3 -m pytest tests/test_redirect_args.py -v`
Expected: ALL PASS — including `test_amend_appends_redirect_narrows_files_sets_tier_keeps_siblings` (its fixture argsFile has no `integrationBranch` key, so it still derives from gate-receipt) and `test_no_branch_source_exits_1` (no flag, no argsFile key, no gate-receipt → loud error still binds).

- [ ] **Step 5: Commit**

```bash
git add skills/ultrapowers/scripts/redirect_args.py tests/test_redirect_args.py
git commit -m "feat(#127): redirect_args derives the integration branch from the argsFile it already reads"
```

### Task 2: Clear the prior launch's heads/ after a successful emit

**Type:** implementation
**Depends-on:** 1

**Files:**
- Modify: `skills/ultrapowers/scripts/redirect_args.py`
- Test: `tests/test_redirect_args.py`

**Interfaces:**
- Consumes: the Task-1 state of the helper (this task edits the same two files, hence the dependency — no symbol coupling).
- Produces: `redirect_args.py` post-emit behavior — `<dirname(receipt)>/heads/` is deleted after `redirect-args.json` is written; nothing is deleted on any earlier failure.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_redirect_args.py`:

```python
def make_heads(run):
    heads = run / "heads"
    heads.mkdir()
    (heads / "task-1").write_text("a" * 40 + "\n")
    (heads / "wave-4").write_text("b" * 40 + "\n")
    return heads


def test_heads_cleared_after_successful_emit(tmp_path):
    # #131: a stale wave-4 slot from the prior launch must not survive into
    # the relaunch, where the critic's highest-numbered-slot rule reads it.
    run = make_run(tmp_path)
    heads = make_heads(run)
    r = run_helper(run, [{"task": "1", "instruction": "fix"}])
    assert r.returncode == 0, r.stderr
    assert not heads.exists()
    assert (run / "redirect-args.json").is_file()  # emit happened first


def test_heads_beside_receipt_cleared_even_with_out_dir(tmp_path):
    # the deletion target is pinned to dirname(receipt), never --out-dir
    run = make_run(tmp_path)
    heads = make_heads(run)
    elsewhere = tmp_path / "elsewhere"
    elsewhere.mkdir()
    r = run_helper(run, [{"task": "1", "instruction": "fix"}],
                   "--out-dir", str(elsewhere))
    assert r.returncode == 0, r.stderr
    assert not heads.exists()


def test_heads_untouched_on_validation_failure(tmp_path):
    # a validation death must not strip a healthy run's sidecars
    run = make_run(tmp_path)
    heads = make_heads(run)
    r = run_helper(run, [{"task": "9", "instruction": "x"}])  # unknown task id
    assert r.returncode == 1
    assert heads.exists() and (heads / "wave-4").is_file()


def test_no_heads_dir_is_a_noop(tmp_path):
    run = make_run(tmp_path)
    r = run_helper(run, [{"task": "1", "instruction": "fix"}])
    assert r.returncode == 0, r.stderr
    assert not (run / "heads").exists()  # nothing spuriously created
```

- [ ] **Step 2: Run them to verify the new behavior is missing**

Run: `python3 -m pytest tests/test_redirect_args.py -k heads -v`
Expected: `test_heads_cleared_after_successful_emit` and `test_heads_beside_receipt_cleared_even_with_out_dir` FAIL (heads/ survives); the other two PASS trivially — they pin the failure-path and no-op contracts.

- [ ] **Step 3: Implement the clear**

In `skills/ultrapowers/scripts/redirect_args.py`: add `import shutil` to the imports, then insert between the final `json.dump(out, f, indent=2)` block and the closing `print(new_args_path)`:

```python
    # #131: the relaunch renumbers waves 1..k, so a prior launch's higher
    # wave-<n> slot would win the critic's highest-numbered-slot detach rule.
    # The slots' shas are already durable in the finalized report and the task
    # branches; deleting AFTER a successful emit (never on a validation death)
    # makes the stale-slot state inexpressible for the relaunch.
    heads_dir = os.path.join(os.path.dirname(os.path.abspath(a.receipt)), "heads")
    if os.path.isdir(heads_dir):
        shutil.rmtree(heads_dir)
        print("redirect_args: cleared prior launch's heads/ sidecars", file=sys.stderr)
```

- [ ] **Step 4: Run the full test file**

Run: `python3 -m pytest tests/test_redirect_args.py -v`
Expected: ALL PASS (including `test_second_round_chains_on_first_rounds_output` — chained rounds re-clear whatever heads/ the intervening relaunch wrote, which is exactly the contract).

- [ ] **Step 5: Commit**

```bash
git add skills/ultrapowers/scripts/redirect_args.py tests/test_redirect_args.py
git commit -m "feat(#131): redirect_args clears the prior launch's heads/ after a successful emit"
```

### Task 3: Salvage-lane prose rider in SKILL.md

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/SKILL.md`

**Interfaces:**
- Consumes: nothing from other tasks (prose describes behavior by role, not by the helper's filename).
- Produces: one sentence in the Step-5 Salvage bullet instructing hand-authored relaunches to delete the run's `heads/` sidecar directory before relaunching.

- [ ] **Step 1: Edit the Salvage bullet**

In `skills/ultrapowers/SKILL.md`, Step 5's **Salvage** bullet, replace the exact text

```
  spreading the receipt's argsFile — it carries the mandatory `pluginRoot`/`runDir`
  — never by rebuilding from the report), return here.
```

with

```
  spreading the receipt's argsFile — it carries the mandatory `pluginRoot`/`runDir`
  — never by rebuilding from the report). Before relaunching, delete
  `<runDir>/heads/`: the prior launch's slots would otherwise masquerade as the
  relaunch's sidecar authority, and their shas are already durable in the
  finalized report. Return here.
```

- [ ] **Step 2: Verify no pinned prose broke**

Run: `python3 -m pytest tests/test_recommendation_rubric.py tests/test_no_prompt_drift.py -v`
Expected: ALL PASS (the Salvage bullet is not a pinned span; this run proves it).

- [ ] **Step 3: Commit**

```bash
git add skills/ultrapowers/SKILL.md
git commit -m "docs(#131): Salvage lane deletes stale heads/ before a hand-authored relaunch"
```

### Task 4: Suite gate

**Type:** gate
**Depends-on:** 1, 2, 3

**Files:**
- Test: `tests/`

- [ ] **Step 1: Run the full suite**

Run: `python3 -m pytest`
Expected: exit 0, no failures.
