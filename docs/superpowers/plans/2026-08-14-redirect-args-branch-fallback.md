# redirect_args gate-receipt `branch` fallback (#153) Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the flag-less `redirect_args.py` integration-branch derivation actually fire against real gate receipts, which store the branch under `branch`, not `integrationBranch`.

**Architecture:** One reader-side fix: the gate-receipt fallback accepts `branch` as well as `integrationBranch` (legacy key keeps precedence). The writer (`ultra_gate.py`) is FROZEN and is not touched. A regression test uses a real-shaped receipt fixture — the existing fixture's `integrationBranch` key is exactly why the dead path passed green.

**Tech Stack:** Python 3 stdlib, pytest.

**Spec:** none — issue #153 is the spec (deterministic one-line schema-mismatch fix; sweep-recorded per the #124 precedent). Issue body: gh issue #153; triage notes in docs/superpowers/docket.md.

**Acceptance:** suite — the committed pytest suite (including the new real-shaped-fixture regression test) is the verification; no held-out exam for a one-line reader fix.

## Global Constraints

- `skills/ultrapowers/scripts/ultra_gate.py`, `gate_check.py`, `run_lock.sh`, `run_acceptance.sh` are FROZEN — this plan must not modify them (the fix is reader-side only, per the issue and operator directive).
- Explicit `--integration-branch` flag precedence and the argsFile `integrationBranch` fallback are existing covered behavior and must not change.

---

### Task 1: Accept `branch` in the gate-receipt fallback + real-shaped regression test

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/scripts/redirect_args.py:60-64`
- Test: `tests/test_redirect_args.py`

**Interfaces:**
- Consumes: nothing from other tasks (single-task plan).
- Produces: nothing consumed downstream; behavior only — flag-less `redirect_args.py` derives the integration branch from a real `gate-receipt.json` (`branch` key).

- [ ] **Step 1: Write the failing regression tests**

Append to `tests/test_redirect_args.py` (it already defines `make_run` and `run_helper` at the top of the file):

```python
def test_real_shaped_gate_receipt_branch_key_derived(tmp_path):
    # #153: real receipts (written by ultra_gate.py) store the integration
    # branch under "branch"; the fallback must accept it. The default
    # make_run fixture's "integrationBranch" key is the legacy/hand-built
    # shape and stays covered by the tests above.
    run = make_run(tmp_path)
    (run / "gate-receipt.json").write_text(json.dumps(
        {"mode": "gate", "verdict": "BLOCKED", "branch": "ultra/int-real"}))
    r = run_helper(run, [{"task": "1", "instruction": "x"}])
    assert r.returncode == 0, r.stderr
    out_args = json.loads(Path(r.stdout.strip()).read_text())
    assert out_args["integrationBranch"] == "ultra/int-real"


def test_legacy_integrationbranch_key_wins_over_branch(tmp_path):
    # Precedence inside the receipt fallback: legacy integrationBranch first,
    # then branch — hand-built fixtures keep working unchanged.
    run = make_run(tmp_path)
    (run / "gate-receipt.json").write_text(json.dumps(
        {"branch": "ultra/int-real", "integrationBranch": "ultra/int-legacy"}))
    r = run_helper(run, [{"task": "1", "instruction": "x"}])
    assert r.returncode == 0, r.stderr
    out_args = json.loads(Path(r.stdout.strip()).read_text())
    assert out_args["integrationBranch"] == "ultra/int-legacy"
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `python3 -m pytest tests/test_redirect_args.py -k "real_shaped or legacy_integrationbranch" -v`
Expected: `test_real_shaped_gate_receipt_branch_key_derived` FAILS (the helper dies with "no integration branch: pass --integration-branch or provide gate-receipt.json next to the receipt", exit != 0). The precedence test passes already (legacy key is read today) — that is expected; it pins the precedence so the fix cannot regress it.

- [ ] **Step 3: Implement the one-line fix**

In `skills/ultrapowers/scripts/redirect_args.py`, the fallback currently reads (around line 60):

```python
        if os.path.isfile(gr_path):
            branch = (load_json(gr_path, "gate receipt") or {}).get("integrationBranch")
```

Replace the `.get(...)` line so both keys are accepted, legacy first:

```python
        if os.path.isfile(gr_path):
            gr = load_json(gr_path, "gate receipt") or {}
            # #153: real receipts (ultra_gate.py) store the branch under
            # "branch"; hand-built/legacy fixtures use "integrationBranch".
            branch = gr.get("integrationBranch") or gr.get("branch")
```

Do not touch the `--integration-branch` flag handling, the argsFile fallback, or the fail-loud `die(...)` below it.

- [ ] **Step 4: Run the new tests to verify they pass**

Run: `python3 -m pytest tests/test_redirect_args.py -v`
Expected: ALL tests in the file PASS (the two new ones plus every existing test — flag precedence, argsFile derivation, legacy-receipt derivation all still green).

- [ ] **Step 5: Run the full suite**

Run: `python3 -m pytest`
Expected: PASS (no other surface touched).

- [ ] **Step 6: Commit**

```bash
git add skills/ultrapowers/scripts/redirect_args.py tests/test_redirect_args.py
git commit -m "fix(redirect_args): accept 'branch' from real gate receipts in the integration-branch fallback (#153)"
```
